/**
 * time.js —— 时间工具
 *
 * 设计要点：
 * 1. 所有"当前时间"都通过 now() 获取，方便测试时注入假时钟。
 * 2. 结算逻辑（离线胶囊、任务）只依赖"时间戳差值"，不依赖 setInterval，
 *    因此关掉网页后游戏逻辑完全停止，不会在后台运行。
 */

/** 一天的毫秒数 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 一小时 */
export const HOUR_MS = 60 * 60 * 1000;
/** 一分钟 */
export const MINUTE_MS = 60 * 1000;

/** 可注入的时钟（默认取系统时间） */
let clock = () => Date.now();

/** 当前时间戳（ms） */
export function now() {
  return clock();
}

/**
 * 替换时钟（仅用于自动化测试 / 调试）
 * @param {() => number} fn
 */
export function setClock(fn) {
  clock = typeof fn === 'function' ? fn : () => Date.now();
}

/** 当前时间戳的秒级版本，用于生成随机种子 */
export function nowSeconds() {
  return Math.floor(now() / 1000);
}

/**
 * 自然日序号（按本地时区），用于"每天恢复行动点"
 * @param {number} [ts]
 */
export function dayIndex(ts = now()) {
  const d = new Date(ts);
  // 使用本地 0 点作为分界，避免跨时区 UTC 偏移造成体感错乱
  return Math.floor((ts - d.getTimezoneOffset() * MINUTE_MS) / DAY_MS);
}

/** 距离下一个自然日 0 点还有多少毫秒 */
export function msUntilNextDay(ts = now()) {
  const d = new Date(ts);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - ts);
}

/**
 * 把毫秒格式化为中文可读时长，例如 "3 小时 12 分钟"
 * @param {number} ms
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin ? `${hours} 小时 ${restMin} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const restHour = hours % 24;
  return restHour ? `${days} 天 ${restHour} 小时` : `${days} 天`;
}

/**
 * 把时间戳格式化为 "MM-DD HH:mm"
 * @param {number} ts
 */
export function formatClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
