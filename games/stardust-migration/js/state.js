/**
 * state.js —— 游戏状态与规则
 *
 * 职责：
 * 1. 定义 GameState 结构与初始状态（createDefaultState）
 * 2. 提供全局 store（store.get / store.set / store.subscribe），
 *    所有变更走 store.set，便于自动存档与 UI 重绘挂接
 * 3. 实现纯规则函数：行动点、喂食/清洁/抚摸、好感与经验、进化判定、区域解锁
 *
 * 注意：本模块不做任何 IO（不读写 localStorage），IO 全部在 save.js。
 */

import {
  ACTION,
  AFFINITY_KEYS,
  BRANCH_BY_AFFINITY,
  BUILDING_LEVEL_SOFT_CAP,
  BUILDING_MAP,
  COMFORT_MAX,
  EVOLUTION_BRANCHES,
  ITEM_MAP,
  RARITY,
  RECIPES,
  SAVE_VERSION,
  STAGE_MAP,
  STAGES,
  STAT_OVERFLOW_CAP,
  ZONES,
  buildCostForLevel,
  evolutionRequirement,
  expForLevel,
  stageById,
  stageDefForLevel,
} from './data.js';
import { dayIndex, now } from './time.js';

/** 生成一个足够随机的设备标识（首次启动时写入存档） */
export function makeDeviceId() {
  return `dev_${randomHex(8)}`;
}

/** 生成 32 位随机种子（只在开新档时用一次，之后由存档固定，保证结算可复现） */
export function makeRandomSeed() {
  const bytes = new Uint8Array(4);
  fillRandom(bytes);
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

/** 用 crypto 填充随机字节；不可用时退回 Math.random（仅用于开新档，不影响结算确定性） */
function fillRandom(bytes) {
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
}

/** 随机十六进制串 */
function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  fillRandom(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 深拷贝（存档需要的结构都是 JSON 安全的） */
export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* 回退到 JSON 方案 */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** 把数值限制在 [min, max] */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 创建一份全新的游戏状态
 * @param {{ name?: string, ts?: number }} [opts]
 */
export function createDefaultState({ name = '未命名星兽', ts = now() } = {}) {
  return {
    /** 星兽本体 */
    pet: {
      name,
      /** 状态条 0-100 */
      stats: { hunger: 72, mood: 70, energy: 80, intimacy: 10 },
      /** 成长属性 0-99 */
      attrs: { physique: 1, agility: 1, wisdom: 1, perception: 1 },
      level: 1,
      exp: 0,
      /** 进化阶段与分支 */
      stage: STAGES[0].id,
      branch: null,
      /** 记忆：上次离开多久、换过几台设备、去过哪些区域 */
      memory: {
        lastAwayMs: 0,
        lastAwayAt: 0,
        deviceCount: 1,
        /** 去过的区域 id，顺序即首次到访顺序 */
        zonesVisited: [],
        /** 累计探索次数 */
        totalExplorations: 0,
        /** 见过的访客 id */
        visitors: [],
        /** 一次性剧情标记 */
        flags: [],
      },
      bornAt: ts,
    },
    /** 资源与物品：id -> 数量 */
    inventory: { stardust: 24, moss_ball: 3, crystal_shard: 1 },
    /** 房屋等级 */
    buildings: { nursery: 1, kitchen: 1, workshop: 1, observatory: 1, garden: 0 },
    /** 行动点 */
    actionPoints: ACTION.base,
    lastApReset: ts,
    /** 已解锁的探索区域 */
    unlockedZones: ['shallow'],
    /** 当前编排中的任务（离线也只保留这一条时间戳） */
    task: {
      active: null,
      startedAt: 0,
      endsAt: 0,
      zoneId: null,
      /** 已领取过结算结果的任务终点时间，用于防止重复领取 */
      consumedEndsAt: 0,
    },
    /** 图鉴（永久合并，导入存档时也合并） */
    codex: {
      items: {},
      encounters: {},
      visitors: {},
      recipes: {},
    },
    /** 成就 */
    achievements: {},
    /** 倾向与统计 */
    progress: {
      affinity: { explore: 0, study: 0, care: 0 },
      careCounts: { feed: 0, clean: 0, touch: 0 },
      researchPoints: 0,
      eventsSeen: {},
    },
    /** 导入历史（多设备识别） */
    imports: { count: 0, lastAt: 0, lastSourceDevice: null, history: [] },
    /** 上次"离开"的时间（用于报告里的"你离开的第 N 小时"） */
    lastSeen: ts,
    version: SAVE_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* 全局 store                                                          */
/* ------------------------------------------------------------------ */

/** 内部持有完整存档对象 Save，而不是裸的 GameState */
let currentSave = null;
const listeners = new Set();

export const store = {
  /** 当前存档（含 v / savedAt / deviceId / lastSettleTime / data） */
  get save() {
    return currentSave;
  },
  /** 当前游戏状态 */
  get state() {
    return currentSave?.data;
  },
  /** 覆盖整个存档（导入时使用） */
  replaceSave(save) {
    currentSave = save;
    emit();
  },
  /**
   * 修改状态：回调直接改 state，之后统一通知订阅者
   * @param {(state: any) => void} mutator
   */
  set(mutator) {
    if (!currentSave) throw new Error('store 尚未初始化');
    mutator(currentSave.data);
    emit();
  },
  /** 仅通知（例如领取离线报告后） */
  notify() {
    emit();
  },
  /**
   * 订阅变更
   * @param {(save: any) => void} fn
   * @returns {() => void} 取消订阅
   */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function emit() {
  for (const fn of listeners) {
    try {
      fn(currentSave);
    } catch (err) {
      console.error('[store] 订阅者执行出错：', err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 规则函数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 读取某个状态条
 *
 * 注意：状态条**不是硬上限 100**。100 是"舒适线"，超过之后进入"溢出区"
 * （最多 COMFORT_MAX + STAT_OVERFLOW_CAP），离线时会先消耗溢出部分。
 */
export function getStat(state, key) {
  return Math.max(0, Number(state.pet.stats[key]) || 0);
}

/** 状态条的绝对上限（舒适线 + 溢出区） */
export const STAT_ABSOLUTE_MAX = COMFORT_MAX + STAT_OVERFLOW_CAP;

/**
 * 按"先吃溢出、再吃本体"的顺序扣除状态
 *
 * 因为状态可以超过舒适线 100，超出的部分就是留给离线的缓冲：
 * 先把 100 以上的部分吃掉，再动 100 以下的核心值，最多扣到 floor 为止。
 *
 * @param {object} state
 * @param {string} key
 * @param {number} amount 想要扣除的量（正数）
 * @param {number} [floor] 核心值的最低保留线
 * @returns {number} 实际扣掉的量
 */
export function absorbStat(state, key, amount, floor = 0) {
  if (!(amount > 0)) return 0;
  const current = getStat(state, key);
  const target = Math.max(floor, current - amount);
  state.pet.stats[key] = target;
  return current - target;
}

/** 修改状态条，返回实际变化量（上限为绝对上限，不是 100） */
export function addStat(state, key, delta) {
  const before = getStat(state, key);
  state.pet.stats[key] = clamp(before + delta, 0, STAT_ABSOLUTE_MAX);
  return state.pet.stats[key] - before;
}

/**
 * 修改成长属性（**无上限**）
 *
 * 属性可以一直涨，用来支撑"无上限养成"。它只影响展示与稀有掉落加成。
 */
export function addAttr(state, key, delta) {
  const before = Math.max(0, Number(state.pet.attrs[key]) || 0);
  state.pet.attrs[key] = Math.max(0, before + delta);
  return state.pet.attrs[key] - before;
}

/** 增加倾向值（无上限） */
export function addAffinity(state, tendency, amount = 1) {
  if (!tendency) return;
  for (const [key, value] of Object.entries(tendency)) {
    state.progress.affinity[key] = (state.progress.affinity[key] ?? 0) + value * amount;
  }
}

/** 建筑等级 */
export function buildingLevel(state, id) {
  return state.buildings?.[id] ?? 0;
}

/**
 * 取建筑在指定等级下的效果值
 *
 * effects 表只覆盖前几级；超出后用"最后两档的正向增量"继续线性外推，
 * 保证"等级越高效果越好"这条性质永远不会被破坏（哪怕最后一档是递减的
 * 布尔/递减序列，也会退化为按 +1 增长）。
 */
export function buildingEffect(state, id, effectKey) {
  const def = BUILDING_MAP[id];
  const level = buildingLevel(state, id);
  const table = def?.effects?.[effectKey];
  if (!table || table.length === 0) return 0;
  if (level < table.length) return table[level] ?? 0;

  const last = table[table.length - 1] ?? 0;
  const prev = table.length >= 2 ? table[table.length - 2] ?? 0 : 0;
  // 增量必须为正，否则"升级反而变差"
  let step = last - prev;
  if (!(step > 0)) step = typeof last === 'number' && last > 0 ? Math.max(1, Math.round(last * 0.5)) : 1;
  return last + step * (level - table.length + 1);
}

/** 行动点上限 */
export function maxActionPoints(state) {
  return Math.round(ACTION.baseMax + (buildingEffect(state, 'nursery', 'apBonus') || 0));
}

/** 进化是否可用；返回 { ok, reasons, next } */
export function checkEvolution(state) {
  const level = state.pet.level;
  const next = stageDefForLevel(level).id;
  if (next === state.pet.stage) return { ok: false, reasons: [], next: null };
  const req = evolutionRequirement(next);
  const reasons = [];
  if (level < req.level) reasons.push(`等级不足（需要 ${req.level} 级）`);
  if (getStat(state, 'intimacy') < req.intimacy) reasons.push(`亲密不足（需要 ${req.intimacy}）`);
  if (req.item && (state.inventory[req.item.id] ?? 0) < req.item.amount) {
    reasons.push(`缺少「${ITEM_MAP[req.item.id]?.name ?? req.item.id}」×${req.item.amount}`);
  }
  return { ok: reasons.length === 0, reasons, next };
}

/**
 * 根据倾向选出进化分支
 * 取倾向值最高的那一项；若最高值同时达到多个分支的门槛，按
 * EVOLUTION_BRANCHES 的声明顺序（旅者 → 学者 → 园丁）取第一个。
 * @returns {object|null} 满足条件的分支；都不满足则返回 null
 */
export function decideBranch(state) {
  const affinity = state.progress.affinity ?? {};
  const candidates = AFFINITY_KEYS.map((k) => ({ id: k.id, value: affinity[k.id] ?? 0 })).sort(
    (a, b) => b.value - a.value,
  );
  for (const candidate of candidates) {
    const branch = BRANCH_BY_AFFINITY[candidate.id];
    if (!branch) continue;
    const req = branch.requirements.affinity[candidate.id] ?? 0;
    if (candidate.value >= req && req > 0) return branch;
  }
  return null;
}

/**
 * 执行进化（由 UI 调用）
 * @returns {{ok: boolean, message: string, stage?: string, branch?: any}}
 */
export function evolve(state) {
  const { ok, reasons, next } = checkEvolution(state);
  if (!ok || !next) {
    return { ok: false, message: reasons[0] ?? '现在还不到进化的时候。' };
  }
  const req = evolutionRequirement(next);
  if (req.item) {
    state.inventory[req.item.id] = (state.inventory[req.item.id] ?? 0) - req.item.amount;
    if (state.inventory[req.item.id] <= 0) delete state.inventory[req.item.id];
  }
  state.pet.stage = next;
  const stageDef = STAGE_MAP[next] ?? stageById(next);
  let branchMsg = '';
  if (next === 'adult') {
    const branch = decideBranch(state);
    if (branch) {
      state.pet.branch = branch.id;
      branchMsg = ` 它选择了「${branch.name}」的道路 —— ${branch.title}。`;
    } else {
      branchMsg = ' 它还没有想清楚自己要走哪条路（提升某种倾向值就能确定分支）。';
    }
  }
  if (next === 'guardian') {
    state.codex.encounters['evolution_guardian'] = true;
  }
  // 记一笔"形态"图鉴，让无上限的进化也能被收集
  discoverEncounter(state, `stage_${next}`);
  return {
    ok: true,
    stage: next,
    branch: state.pet.branch,
    message: `星兽进化了：${stageDef?.name ?? next}。${branchMsg}`,
  };
}

/** 增加经验并处理升级，返回升级次数 */
export function addExp(state, amount) {
  if (amount <= 0) return 0;
  state.pet.exp += amount;
  let ups = 0;
  // 经验曲线随等级增长，单次可能连升多级（离线久时会发生）
  let guard = 0;
  while (state.pet.exp >= expForLevel(state.pet.level) && guard < 100) {
    state.pet.exp -= expForLevel(state.pet.level);
    state.pet.level += 1;
    ups += 1;
    guard += 1;
  }
  return ups;
}

/**
 * 添加物品（带数量限制与图鉴记录）
 * @returns {number} 实际添加数量
 */
export function addItem(state, id, amount = 1) {
  if (!id || amount <= 0) return 0;
  if (!ITEM_MAP[id]) return 0;
  const before = state.inventory[id] ?? 0;
  const after = before + Math.floor(amount);
  state.inventory[id] = after;
  // 图鉴：记录曾经见过（数量 > 0 即算发现）
  if (after > 0) discoverItem(state, id);
  return after - before;
}

/** 扣除物品，数量不足返回 false */
export function removeItem(state, id, amount = 1) {
  const have = state.inventory[id] ?? 0;
  if (have < amount) return false;
  state.inventory[id] = have - amount;
  if (state.inventory[id] <= 0) delete state.inventory[id];
  return true;
}

/** 图鉴：记录物品 */
export function discoverItem(state, id) {
  if (!state.codex.items[id]) state.codex.items[id] = { firstAt: now() };
}

/** 图鉴：记录见闻 / 访客 / 配方 */
export function discoverEncounter(state, id) {
  if (!state.codex.encounters[id]) state.codex.encounters[id] = { firstAt: now() };
}

export function discoverRecipe(state, id) {
  if (!state.codex.recipes[id]) state.codex.recipes[id] = { firstAt: now() };
}

export function discoverVisitor(state, id) {
  if (!state.codex.visitors[id]) state.codex.visitors[id] = { firstAt: now() };
  if (!state.pet.memory.visitors.includes(id)) state.pet.memory.visitors.push(id);
}

/** 记录去过的区域 */
export function markZoneVisited(state, zoneId) {
  if (!zoneId) return;
  if (!state.pet.memory.zonesVisited.includes(zoneId)) {
    state.pet.memory.zonesVisited.push(zoneId);
  }
}

/** 记录剧情标记（去重） */
export function setFlag(state, flag) {
  if (!flag) return;
  if (!state.pet.memory.flags.includes(flag)) state.pet.memory.flags.push(flag);
}

export function hasFlag(state, flag) {
  return state.pet.memory.flags.includes(flag);
}

/** 授予成就，返回新解锁的成就 id 数组 */
export function grantAchievements(state, ids) {
  const unlocked = [];
  for (const id of ids) {
    if (!id || state.achievements[id]) continue;
    state.achievements[id] = { at: now() };
    unlocked.push(id);
  }
  return unlocked;
}

/** 每次状态变更后检查一遍"可由数据推导"的成就 */
export function checkAutoAchievements(state) {
  const ids = [];
  if (state.pet.memory.totalExplorations >= 1) ids.push('first_light');
  if ((state.imports?.count ?? 0) >= 1) ids.push('device_drifter');
  if (Object.keys(state.codex.items).length >= 15) ids.push('collector');
  if (Object.keys(state.codex.encounters).length >= 5) ids.push('archivist');
  if (state.pet.stage === 'guardian') ids.push('guardian_born');
  return grantAchievements(state, ids);
}

/** 区域是否解锁 */
export function isZoneUnlocked(state, zone) {
  if (state.unlockedZones.includes(zone.id)) return true;
  if (!zone.unlock) return true;
  const needBuilding = zone.unlock.building;
  if (needBuilding) {
    if (buildingLevel(state, needBuilding.id) >= needBuilding.level) return true;
  }
  const needItem = zone.unlock.item;
  if (needItem && (state.inventory[needItem] ?? 0) > 0) return true;
  return false;
}

/**
 * 区域解锁检查：满足条件时写回 unlockedZones
 * @returns {string[]} 本次新解锁的区域 id
 */
export function syncZoneUnlocks(state) {
  const unlocked = [];
  for (const zone of ZONES) {
    if (state.unlockedZones.includes(zone.id)) continue;
    if (isZoneUnlocked(state, zone)) {
      state.unlockedZones.push(zone.id);
      unlocked.push(zone.id);
    }
  }
  return unlocked;
}

/** 每日刷新：行动点恢复、花园产出 */
export function applyDailyReset(state, ts = now()) {
  const today = dayIndex(ts);
  if (state.lastApReset && dayIndex(state.lastApReset) === today) return { apGained: 0, gardenItems: [] };

  // 行动点按"跨过的自然日数量"恢复，离线多天也能补，但受上限约束
  const days = Math.max(1, today - dayIndex(state.lastApReset ?? ts));
  const max = maxActionPoints(state);
  const before = state.actionPoints;
  const gained = Math.min(max, before + ACTION.base * days) - before;
  state.actionPoints = clamp(before + ACTION.base * days, 0, max);
  state.lastApReset = ts;

  // 苔藓花园每日产出（等级无上限，走 buildingEffect 的外推，而不是直接查表）
  const gardenItems = [];
  const gardenLevel = buildingLevel(state, 'garden');
  if (gardenLevel > 0) {
    const perDayMoss = buildingEffect(state, 'garden', 'dailyMoss');
    const perDayIntimacy = buildingEffect(state, 'garden', 'dailyIntimacy');
    const moss = perDayMoss * days;
    const intimacy = perDayIntimacy * days;
    if (moss > 0) {
      addItem(state, 'moss_ball', moss);
      gardenItems.push({ id: 'moss_ball', amount: moss });
    }
    if (intimacy > 0) addStat(state, 'intimacy', intimacy);
  }

  return { apGained: gained, gardenItems, days };
}

/**
 * 安排一次任务（消耗行动点）
 * @returns {{ok: boolean, message: string, task?: any}}
 */
export function startTask(state, taskDef, zoneId, ts = now()) {
  if (!taskDef) return { ok: false, message: '任务不存在。' };
  if (state.task.active) return { ok: false, message: '星兽已经在执行任务了，先等它回来。' };
  if (getStat(state, 'energy') < (taskDef.danger ? 15 : 8)) {
    return { ok: false, message: '星兽精力不足，先让它休息一会儿吧。' };
  }
  if (taskDef.zone && !zoneId) return { ok: false, message: '请选择一个探索区域。' };
  if (state.actionPoints < taskDef.cost) {
    return { ok: false, message: `行动点不足（需要 ${taskDef.cost} 点）。` };
  }
  state.actionPoints -= taskDef.cost;
  const duration = taskDuration(state, taskDef);
  state.task.active = taskDef.id;
  state.task.startedAt = ts;
  state.task.endsAt = ts + duration;
  state.task.zoneId = taskDef.zone ? zoneId : null;
  if (taskDef.zone) markZoneVisited(state, zoneId);
  return { ok: true, message: `已安排「${taskDef.name}」，预计 ${Math.round(duration / 60000)} 分钟。`, task: state.task };
}

/** 取消任务（不退还行动点，但返还一半） */
export function cancelTask(state) {
  if (!state.task.active) return { ok: false, message: '当前没有任务。' };
  const def = state.task.active;
  state.task.active = null;
  state.task.startedAt = 0;
  state.task.endsAt = 0;
  state.task.zoneId = null;
  return { ok: true, message: `已召回星兽，任务「${def}」取消。` };
}

/** 计算任务实际时长（考虑建筑与分支加成） */
export function taskDuration(state, taskDef) {
  let duration = taskDef.duration * 60 * 1000;
  const branch = state.pet.branch ? EVOLUTION_BRANCHES[state.pet.branch] : null;
  if (branch?.bonus?.exploreSpeed && taskDef.tags?.includes('explore')) {
    duration *= 1 - branch.bonus.exploreSpeed;
  }
  return Math.max(30 * 60 * 1000, Math.round(duration));
}

/**
 * 喂食 / 清洁 / 抚摸
 * @param {'feed'|'clean'|'touch'} kind
 * @param {string} [itemId] 喂食时指定的食物
 */
export function careAction(state, kind, itemId = null) {
  const cost = ACTION.cost[kind] ?? 1;
  if (state.actionPoints < cost) return { ok: false, message: `行动点不足（需要 ${cost} 点）。` };
  if (state.task.active) return { ok: false, message: '星兽正在任务中，等它回来再照顾它吧。' };

  const branch = state.pet.branch ? EVOLUTION_BRANCHES[state.pet.branch] : null;
  const careBonus = 1 + (branch?.bonus?.careGain ?? 0);

  if (kind === 'feed') {
    if (getStat(state, 'hunger') >= STAT_ABSOLUTE_MAX) return { ok: false, message: '它已经撑到极限了，别再喂了。' };
    const food = itemId ? ITEM_MAP[itemId] : null;
    if (itemId) {
      if (!food || !food.use?.hunger) return { ok: false, message: '这个不能吃。' };
      if (!removeItem(state, itemId, 1)) return { ok: false, message: '背包里没有这个食物。' };
    }
    const kitchenBonus = 1 + (buildingEffect(state, 'kitchen', 'foodBonus') || 0);
    const baseHunger = food ? food.use.hunger : ACTION.gain.feed.hunger;
    const baseMood = (food?.use?.mood ?? 0) + ACTION.gain.feed.mood;
    const baseEnergy = food?.use?.energy ?? 0;
    const baseIntimacy = food?.use?.intimacy ?? 0;
    const applied = {
      hunger: Math.round(baseHunger * kitchenBonus * careBonus),
      mood: Math.round(baseMood * careBonus),
      energy: Math.round(baseEnergy * careBonus),
      intimacy: Math.round(baseIntimacy * careBonus) + 1,
    };
    applyDeltas(state, applied);
    state.progress.careCounts.feed += 1;
    addAffinity(state, { care: 1 });
    state.actionPoints -= cost;
    addExp(state, 4);
    return { ok: true, message: `喂了${food ? `「${food.name}」` : '一份苔藓团'}，它吃得很认真。`, deltas: applied };
  }

  if (kind === 'clean') {
    if (getStat(state, 'mood') >= STAT_ABSOLUTE_MAX) return { ok: false, message: '它现在开心得快溢出来了。' };
    const applied = {
      mood: Math.round(ACTION.gain.clean.mood * careBonus),
      intimacy: Math.round(ACTION.gain.clean.intimacy * careBonus),
    };
    applyDeltas(state, applied);
    state.progress.careCounts.clean += 1;
    addAffinity(state, { care: 1 });
    state.actionPoints -= cost;
    addExp(state, 4);
    return { ok: true, message: '替它梳理了数据绒毛，掉下来的星尘都收进瓶子里了。', deltas: applied };
  }

  // touch
  const applied = {
    mood: Math.round(ACTION.gain.touch.mood * careBonus),
    intimacy: Math.round(ACTION.gain.touch.intimacy * careBonus),
  };
  applyDeltas(state, applied);
  state.progress.careCounts.touch += 1;
  addAffinity(state, { care: 1 });
  state.actionPoints -= cost;
  addExp(state, 3);
  return { ok: true, message: '你摸了摸它的额头，它的光晕慢慢变成了暖色。', deltas: applied };
}

/** 批量应用状态变化，返回实际生效的量 */
export function applyDeltas(state, deltas) {
  const actual = {};
  for (const [key, value] of Object.entries(deltas || {})) {
    if (!value) continue;
    const real = addStat(state, key, value);
    if (real !== 0) actual[key] = real;
  }
  return actual;
}

/** 是否已解锁某个配方（需要对应建筑等级） */
export function isRecipeUnlocked(state, recipe) {
  return buildingLevel(state, recipe.building) >= recipe.level;
}

/** 当前可制作的配方列表 */
export function availableRecipes(state) {
  return RECIPES.filter((r) => isRecipeUnlocked(state, r));
}

/** 合成费用（含工作台折扣） */
export function recipeCost(state, recipe) {
  const discount = buildingEffect(state, 'workshop', 'craftDiscount') || 0;
  return Math.max(0, Math.round(recipe.cost * (1 - discount)));
}

/**
 * 制作物品
 * @returns {{ok: boolean, message: string}}
 */
export function craft(state, recipeId) {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { ok: false, message: '配方不存在。' };
  if (!isRecipeUnlocked(state, recipe)) {
    const def = BUILDING_MAP[recipe.building];
    return { ok: false, message: `需要「${def?.name ?? recipe.building}」达到 ${recipe.level} 级。` };
  }
  const cost = recipeCost(state, recipe);
  if ((state.inventory.stardust ?? 0) < cost) return { ok: false, message: `星尘不足（需要 ${cost}）。` };
  for (const input of recipe.inputs) {
    if ((state.inventory[input.id] ?? 0) < input.amount) {
      return { ok: false, message: `缺少「${ITEM_MAP[input.id]?.name ?? input.id}」×${input.amount}。` };
    }
  }
  removeItem(state, 'stardust', cost);
  for (const input of recipe.inputs) removeItem(state, input.id, input.amount);
  addItem(state, recipe.output.id, recipe.output.amount);
  discoverRecipe(state, recipe.id);
  addExp(state, 8);
  return { ok: true, message: `制作完成：${ITEM_MAP[recipe.output.id].name} ×${recipe.output.amount}` };
}

/**
 * 建筑升级所需星尘（等级无上限）
 * @param {string} buildingId
 * @param {number} targetLevel 目标等级
 */
export function buildingUpgradeCost(buildingId, targetLevel) {
  const def = BUILDING_MAP[buildingId];
  if (!def) return Infinity;
  return buildCostForLevel(def, Math.max(1, targetLevel));
}

/**
 * 升级建筑（最多可升到 BUILDING_LEVEL_SOFT_CAP，实际上等于没有上限）
 * @returns {{ok: boolean, message: string}}
 */
export function upgradeBuilding(state, buildingId) {
  const def = BUILDING_MAP[buildingId];
  if (!def) return { ok: false, message: '建筑不存在。' };
  const level = buildingLevel(state, buildingId);
  if (level >= BUILDING_LEVEL_SOFT_CAP) {
    return { ok: false, message: `已经到 ${BUILDING_LEVEL_SOFT_CAP} 级了，再高会把岛压沉。` };
  }
  const cost = buildingUpgradeCost(buildingId, level + 1);
  if ((state.inventory.stardust ?? 0) < cost) return { ok: false, message: `星尘不足（需要 ${cost}）。` };
  removeItem(state, 'stardust', cost);
  state.buildings[buildingId] = level + 1;
  addExp(state, 10);
  return {
    ok: true,
    message: `「${def.name}」升到 ${level + 1} 级。${def.effectText[level] ?? ''}`,
  };
}

/** 使用物品（食物 / 礼物） */
export function useItem(state, itemId) {
  const item = ITEM_MAP[itemId];
  if (!item) return { ok: false, message: '物品不存在。' };
  if (item.use?.hunger) return careAction(state, 'feed', itemId);
  if (item.use) {
    if (!removeItem(state, itemId, 1)) return { ok: false, message: '背包里没有这个物品。' };
    const actual = applyDeltas(state, { mood: item.use.mood ?? 0, energy: item.use.energy ?? 0, intimacy: item.use.intimacy ?? 0 });
    addAffinity(state, { care: 1 });
    addExp(state, 5);
    return { ok: true, message: `使用了「${item.name}」。`, deltas: actual };
  }
  return { ok: false, message: '这个物品现在用不上。' };
}

/** 稀有度排序值（用于背包排序） */
export function rarityOrder(id) {
  const rarity = ITEM_MAP[id]?.rarity ?? 'common';
  return RARITY[rarity]?.order ?? 0;
}
