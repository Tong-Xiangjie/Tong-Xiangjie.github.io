/**
 * tasks.js —— 探索与任务的结算
 *
 * 一次任务结算 = 基础产出 + 稀有掉落 + 随机事件 + 状态消耗 + 成长经验
 * 所有随机都来自确定性 rng，因此"刷新页面结果不变"。
 */

import { EVOLUTION_BRANCHES, OFFLINE, ZONE_MAP, ZONES, getTask } from './data.js';
import { autoResolveEvent } from './events.js';
import { rngFrom } from './rng.js';
import {
  addAffinity,
  addAttr,
  addExp,
  addItem,
  applyDeltas,
  checkAutoAchievements,
  markZoneVisited,
  store,
  syncZoneUnlocks,
} from './state.js';
import { now } from './time.js';
import { describeItems } from './utils.js';

/** 任务类型对"基础产出量"的倍率 */
const TASK_YIELD = {
  gather: { base: 1, rare: 0.8, stardust: 0.7 },
  explore: { base: 0.8, rare: 1.9, stardust: 0.9 },
  study: { base: 0.2, rare: 0.4, stardust: 1.5 },
  rest: { base: 0.05, rare: 0.1, stardust: 0.2 },
};

/** 每小时经验（按任务类型区分，学习最高） */
const TASK_EXP_PER_HOUR = { gather: 18, explore: 26, study: 34, rest: 8 };

/** 每小时状态消耗（休息是恢复，单独处理） */
const TASK_DRAIN_PER_HOUR = {
  gather: { hunger: 7, mood: 2.5, energy: 9 },
  explore: { hunger: 9, mood: 4.5, energy: 14 },
  study: { hunger: 5, mood: 1.8, energy: 8 },
  rest: { hunger: 3.5, mood: 0, energy: -26 },
};

/** 状态安全下限：低于该值时星兽会自行"放弃"消耗，避免变成负值 */
const STAT_FLOOR = { hunger: 12, mood: 8, energy: 6 };

/**
 * 计算一次任务的实际时长（毫秒）
 * @param {object} taskDef
 * @param {number} hours 实际经过的时长（离线结算时可能超过任务时长）
 */
export function elapsedForTask(taskDef, hours) {
  return Math.max(0, hours * 60 * 60 * 1000);
}

/**
 * 生成区域采集产出
 * @param {any} rng
 * @param {string|null} zoneId
 * @param {object} taskDef
 * @param {number} hours 实际耗时（小时）
 * @param {object} state
 * @returns {{items: Array<{id:string, amount:number}>, rareFound: Array<{id:string, amount:number}>}}
 */
export function rollZoneDrops(rng, zoneId, taskDef, hours, state) {
  const zone = zoneId ? ZONE_MAP[zoneId] : null;
  if (!zone) return { items: [], rareFound: [] };

  const yieldCfg = TASK_YIELD[taskDef.id] ?? TASK_YIELD.gather;
  // 时长倍率：以 1 小时为 1 份产出；额外部分收益递减，避免长挂机收益爆炸
  const hoursFactor = hours <= 1 ? hours : 1 + (hours - 1) * 0.65;

  const items = [];
  for (const drop of zone.drops) {
    const [min, max] = drop.amount;
    const base = rng.int(min, max);
    const amount = Math.round(base * yieldCfg.base * hoursFactor);
    if (amount > 0) items.push({ id: drop.id, amount });
  }

  // 稀有掉落：每个稀有项独立判定，探险类有额外加成
  const rareFound = [];
  const rareBonus = branchRareBonus(state);
  for (const rare of zone.rare) {
    const times = Math.max(1, Math.round(hours));
    let got = 0;
    for (let i = 0; i < times; i++) {
      if (rng.chance(Math.min(0.9, rare.chance * yieldCfg.rare * rareBonus))) got += 1;
    }
    if (got > 0) rareFound.push({ id: rare.id, amount: got });
  }

  // 星尘：所有任务都会带一点回来
  const stardust = Math.round((1.5 + hours * 2.2) * yieldCfg.stardust * rng.int(80, 120) / 100);
  if (stardust > 0) items.push({ id: 'stardust', amount: stardust });

  return { items, rareFound };
}

/** 进化分支带来的稀有掉落加成 */
function branchRareBonus(state) {
  const branch = state.pet.branch ? EVOLUTION_BRANCHES[state.pet.branch] : null;
  return 1 + (branch?.bonus?.researchYield ?? 0);
}

/**
 * 结算一次任务（在线完成 或 离线补算，使用同一套代码）
 * @param {object} state
 * @param {{ taskId?: string, zoneId?: string|null, startedAt?: number, endsAt?: number, now?: number, rng: any }} opts
 */
export function resolveTask(state, opts) {
  const ts = opts.now ?? now();
  const taskDef = getTask(opts.taskId);
  if (!taskDef) return { ok: false, reason: 'unknown-task' };

  const startedAt = opts.startedAt ?? state.task.startedAt ?? ts;
  const endsAt = opts.endsAt ?? state.task.endsAt ?? ts;
  const zoneId = taskDef.zone ? (opts.zoneId ?? state.task.zoneId ?? null) : null;

  // 任务实际经过的时长（可能因为离线很久而超过原计划）
  const hours = Math.max(0, Math.min(24, (ts - startedAt) / 3600000));
  // 计划时长，用于计算"完成度"
  const plannedHours = taskDef.duration / 60;
  const overtime = Math.max(0, hours - plannedHours);
  const effectiveHours = Math.min(hours, plannedHours) + overtime * 0.35;

  const rng = opts.rng;
  const { items, rareFound } = rollZoneDrops(rng, zoneId, taskDef, hours, state);

  // 1. 发放产出
  const gainedItems = [];
  for (const drop of [...items, ...rareFound]) {
    const real = addItem(state, drop.id, drop.amount);
    if (real > 0) gainedItems.push({ id: drop.id, amount: real });
  }

  // 2. 状态消耗 / 休息恢复
  const drain = TASK_DRAIN_PER_HOUR[taskDef.id] ?? TASK_DRAIN_PER_HOUR.gather;
  const deltas = {};
  for (const [key, perHour] of Object.entries(drain)) {
    let raw = perHour * effectiveHours;
    if (perHour > 0) {
      // 消耗类：不会跌破安全下限
      const room = Math.max(0, state.pet.stats[key] - STAT_FLOOR[key]);
      raw = -Math.min(raw, room);
    }
    if (raw !== 0) deltas[key] = Math.round(raw);
  }
  // 休息额外加成来自孵化舱
  if (taskDef.tags?.includes('rest')) {
    const restBonus = 1 + (state.buildings.nursery >= 2 ? 0.25 : 0);
    if (deltas.energy) deltas.energy = Math.round(deltas.energy * restBonus);
  }
  const appliedDeltas = applyDeltas(state, deltas);

  // 3. 成长属性
  const attrGain = {};
  for (const gain of taskDef.gains) {
    const amount = Math.max(1, Math.round(gain.amount * Math.max(0.6, effectiveHours)));
    addAttr(state, gain.stat, amount);
    attrGain[gain.stat] = (attrGain[gain.stat] ?? 0) + amount;
  }

  // 4. 经验与升级
  const exp = Math.round((TASK_EXP_PER_HOUR[taskDef.id] ?? 20) * Math.max(0.5, effectiveHours));
  const levelUps = addExp(state, exp);

  // 5. 倾向
  addAffinity(state, taskDef.tags?.includes('study') ? { study: 2 } : { explore: 2 });

  // 6. 随机事件（离线补算时按时间片多次判定）
  const events = [];
  const sliceHours = OFFLINE.sliceMs / 3600000;
  const slices = Math.max(1, Math.min(Math.ceil(hours / sliceHours), 48));
  for (let i = 0; i < slices; i++) {
    if (!rng.chance(OFFLINE.eventChancePerSlice)) continue;
    const result = autoResolveEvent(state, rng, zoneId, startedAt + i * OFFLINE.sliceMs);
    if (result.ok) events.push(result.detail);
  }

  // 7. 记忆与统计
  state.pet.memory.totalExplorations += 1;
  if (zoneId) markZoneVisited(state, zoneId);
  if (taskDef.tags?.includes('study')) state.progress.researchPoints += 2;

  // 8. 成就与区域解锁
  const unlockedAchievements = checkAutoAchievements(state);
  const newZones = syncZoneUnlocks(state);

  // 9. 叙事：优先使用区域故事碎片，其次用事件文本
  const zone = zoneId ? ZONE_MAP[zoneId] : null;
  const story = zone?.story?.length ? rng.pick(zone.story) : '星兽按你留下的坐标走完了路线，带回一身星尘味。';

  return {
    ok: true,
    taskId: taskDef.id,
    taskName: taskDef.name,
    zoneId,
    zoneName: zone?.name ?? '小岛周边',
    hours,
    items: gainedItems,
    deltas: appliedDeltas,
    attrs: attrGain,
    exp,
    levelUps,
    events,
    story,
    newZones,
    achievements: unlockedAchievements,
  };
}

/**
 * 在线完成当前任务（由一个 tick 触发）
 * rng 由存档固定种子 + 任务起点时间推导，因此同一任务的结算结果恒定。
 * @param {object} state
 * @param {number} [ts]
 * @param {number} [seed] 存档随机种子
 */
export function completeActiveTask(state, ts = now(), seed = 0) {
  if (!state.task.active) return { ok: false, reason: 'no-active-task' };
  const rng = rngFrom(seed, state.task.active, state.task.startedAt, state.task.zoneId ?? 'none', 'complete');
  const result = resolveTask(state, {
    taskId: state.task.active,
    zoneId: state.task.zoneId,
    startedAt: state.task.startedAt,
    endsAt: state.task.endsAt,
    now: ts,
    rng,
  });
  state.task.active = null;
  state.task.startedAt = 0;
  state.task.endsAt = 0;
  state.task.zoneId = null;
  return result;
}

/** 已解锁的区域列表 */
export function unlockedZoneList(state) {
  return ZONES.filter((z) => state.unlockedZones.includes(z.id));
}

/** 在 store 上执行一次任务（供 UI 调用），失败时返回提示信息 */
export function runCompleteActiveTask() {
  let output = { ok: false, message: '没有进行中的任务。' };
  store.set((state) => {
    const result = completeActiveTask(state, now(), store.save?.randomSeed ?? 0);
    output = result.ok
      ? {
          ok: true,
          message: `「${result.taskName}」完成！带回：${describeItems(result.items) || '一点星尘'}`,
          result,
        }
      : { ok: false, message: '任务结算失败。' };
  });
  return output;
}

/** 计算剩余时间（毫秒） */
export function taskRemainingMs(state, ts = now()) {
  if (!state.task.active) return 0;
  return Math.max(0, state.task.endsAt - ts);
}

/** 任务进度 0~1 */
export function taskProgress(state, ts = now()) {
  if (!state.task.active) return 0;
  const total = state.task.endsAt - state.task.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (ts - state.task.startedAt) / total));
}
