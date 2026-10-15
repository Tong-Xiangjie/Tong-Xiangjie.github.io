/**
 * events.js —— 随机事件
 *
 * 事件的抽取与结算全部由"确定性随机"驱动：
 * 只要传入相同的 rng（同一个存档 + 同一段时间 + 同一个任务），结果就完全一致。
 */

import { EVENTS, EVENT_MAP, ITEMS, ITEM_MAP, ZONE_MAP } from './data.js';
import {
  addAffinity,
  addAttr,
  addExp,
  addItem,
  applyDeltas,
  checkAutoAchievements,
  discoverEncounter,
  discoverVisitor,
  grantAchievements,
  removeItem,
  setFlag,
} from './state.js';
import { now } from './time.js';

/**
 * 该区域可触发的事件 id 列表
 * @param {string|null} zoneId
 * @returns {string[]}
 */
export function zoneEventIds(zoneId) {
  const zone = zoneId ? ZONE_MAP[zoneId] : null;
  if (zone?.events?.length) return zone.events;
  return EVENTS.map((e) => e.id);
}

/**
 * 按区域挑选一个可触发的事件（确定性）
 * @param {any} rng
 * @param {string|null} zoneId
 */
export function pickEventForZone(rng, zoneId) {
  const poolIds = zoneEventIds(zoneId);
  if (poolIds.length === 0) return null;
  const id = rng.pick(poolIds);
  return EVENT_MAP[id] ?? null;
}

/**
 * 结算玩家在事件中的二选一
 * @param {object} state
 * @param {object} event 事件定义
 * @param {number} optionIndex
 * @param {{ rng: any, zoneId: string|null, ts?: number }} ctx
 * @returns {{ok: boolean, message: string, detail: object}}
 */
export function resolveEventOption(state, event, optionIndex, ctx) {
  const option = event?.options?.[optionIndex];
  if (!option) return { ok: false, message: '选项不存在。', detail: {} };

  const { rng, zoneId = null, ts = now() } = ctx;
  const outcome =
    typeof option.outcome === 'function' ? option.outcome({ rng, zoneId, ts }) : option.outcome ?? {};

  // 1. 需要支付的代价（例如用星尘交换）
  const paid = [];
  if (outcome.cost) {
    for (const [id, amount] of Object.entries(outcome.cost)) {
      if ((state.inventory[id] ?? 0) < amount) {
        return {
          ok: false,
          message: `资源不足，暂时无法选择这一项（需要 ${ITEM_MAP[id]?.name ?? id} ×${amount}）。`,
          detail: {},
        };
      }
    }
    for (const [id, amount] of Object.entries(outcome.cost)) {
      removeItem(state, id, amount);
      paid.push({ id, amount });
    }
  }

  // 2. 物品收获
  const gained = [];
  for (const drop of outcome.items ?? []) {
    const real = addItem(state, drop.id, drop.amount);
    if (real > 0) gained.push({ id: drop.id, amount: real });
  }

  // 3. 状态变化（applyDeltas 返回"实际生效量"，避免报告里出现无效数字）
  const applied = applyDeltas(state, outcome.delta ?? {});

  // 4. 成长属性
  for (const [key, value] of Object.entries(outcome.stats ?? {})) addAttr(state, key, value);

  // 5. 倾向 / 研究点 / 剧情标记 / 访客 / 区域解锁
  addAffinity(state, outcome.tendency);
  if (outcome.research) state.progress.researchPoints += outcome.research;
  for (const flag of outcome.flags ?? []) setFlag(state, flag);
  for (const visitor of outcome.visited ?? []) discoverVisitor(state, visitor);
  for (const zone of outcome.unlockZones ?? []) {
    if (!state.unlockedZones.includes(zone)) state.unlockedZones.push(zone);
  }

  // 6. 经验与图鉴
  addExp(state, 6);
  discoverEncounter(state, event.id);
  state.progress.eventsSeen[event.id] = (state.progress.eventsSeen[event.id] ?? 0) + 1;

  const unlockedAchievements = [
    ...grantAchievements(state, outcome.achievements ?? []),
    ...checkAutoAchievements(state),
  ];

  return {
    ok: true,
    message: outcome.text ?? option.text,
    detail: {
      eventId: event.id,
      eventName: event.name,
      eventEmoji: event.emoji,
      optionText: option.text,
      text: outcome.text ?? '',
      items: gained,
      cost: paid,
      deltas: applied,
      achievements: unlockedAchievements,
    },
  };
}

/**
 * 离线结算用：让星兽自己做决定（确定性）
 * 离线时玩家不在场，因此由随机替它选择，保证同一段离线时间结果恒定。
 * @returns {{ok: boolean, detail: object, message: string}}
 */
export function autoResolveEvent(state, rng, zoneId, ts = now()) {
  const event = pickEventForZone(rng, zoneId);
  if (!event) return { ok: false, detail: {}, message: '' };
  const index = rng.int(0, event.options.length - 1);
  const result = resolveEventOption(state, event, index, { rng, zoneId, ts });
  return { ok: result.ok, detail: result.detail, message: result.message };
}

/** 事件可能产出的物品（图鉴页展示用） */
export function eventItemPreview(event) {
  const ids = new Set();
  for (const option of event.options ?? []) {
    const outcome = typeof option.outcome === 'function' ? null : option.outcome;
    for (const drop of outcome?.items ?? []) ids.add(drop.id);
  }
  return [...ids].map((id) => ITEMS.find((it) => it.id === id)).filter(Boolean);
}
