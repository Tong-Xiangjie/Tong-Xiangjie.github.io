/**
 * utils.js —— 跨模块共用的小工具
 *
 * 这里放"多个模块都需要、且不属于任何单一业务"的纯函数。
 * 单独成文件的好处：tasks.js / offline.js / ui.js 都能直接用，
 * 不需要为了解决一处重复定义而互相 import 出循环依赖。
 */

import { ITEM_MAP } from './data.js';

/**
 * 合并同名物品
 * @param {Array<{id: string, amount: number}>} list
 * @returns {Array<{id: string, amount: number}>}
 */
export function mergeItems(list) {
  const map = new Map();
  for (const it of list ?? []) {
    if (!it?.id || !it.amount) continue;
    map.set(it.id, (map.get(it.id) ?? 0) + it.amount);
  }
  return [...map.entries()].map(([id, amount]) => ({ id, amount }));
}

/**
 * 物品列表转可读文本，例如 "🟢苔藓团×3、✨星尘×5"
 * @param {Array<{id: string, amount: number}>} list
 */
export function describeItems(list) {
  return (list ?? [])
    .map((it) => `${ITEM_MAP[it.id]?.emoji ?? '❔'}${ITEM_MAP[it.id]?.name ?? it.id}×${it.amount}`)
    .join('、');
}

/**
 * 状态变化转可读文本，只显示真正发生变化的项
 * @param {Record<string, number>} deltas
 */
export function describeDeltas(deltas) {
  const labels = { hunger: '饱食', mood: '心情', energy: '精力', intimacy: '亲密' };
  return Object.entries(deltas ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${labels[k] ?? k} ${v > 0 ? '+' : ''}${v}`)
    .join('、');
}
