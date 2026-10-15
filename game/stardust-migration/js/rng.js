/**
 * rng.js —— 确定性随机数
 *
 * 目标：同一份存档 + 同一段离线时间 + 同一个任务 => 结算结果永远一致。
 * 做法：把（randomSeed, 任务开始时间, 时间片序号, 用途标签）哈希成 32 位种子，
 *      再用 mulberry32 生成序列。不使用 Math.random，因此刷新页面结果不变。
 */

/**
 * 字符串 / 数字混合哈希（FNV-1a 变体），返回 32 位无符号整数
 * @param {...(string|number)} parts
 * @returns {number}
 */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  const text = parts.map((p) => String(p)).join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 再混一次，避免短字符串低位规律过强
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * 由种子创建随机数发生器
 * @param {number} seed
 * @returns {{next: () => number, int: (min:number,max:number)=>number, pick: (arr:any[])=>any, chance: (p:number)=>boolean, weighted: (list:any[], weightOf?:(item:any)=>number)=>any}}
 */
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;

  /** 返回 [0,1) */
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] 闭区间整数 */
  function int(min, max) {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(next() * (max - min + 1));
  }

  /** 从数组里等概率取一个 */
  function pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  /** 以概率 p 返回 true */
  function chance(p) {
    return next() < p;
  }

  /** 按权重抽取 */
  function weighted(list, weightOf = (item) => item.weight ?? 1) {
    const items = (list || []).filter((it) => weightOf(it) > 0);
    if (items.length === 0) return undefined;
    const total = items.reduce((sum, it) => sum + weightOf(it), 0);
    let roll = next() * total;
    for (const it of items) {
      roll -= weightOf(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** 洗牌（返回新数组，不修改入参） */
  function shuffle(arr) {
    const out = [...(arr || [])];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  return { next, int, pick, chance, weighted, shuffle };
}

/**
 * 便捷函数：直接根据若干标签创建一个确定性 rng
 * @param {...(string|number)} parts
 */
export function rngFrom(...parts) {
  return createRng(hash32(...parts));
}
