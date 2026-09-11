/**
 * save.js —— 本地存档 / 版本迁移 / 迁徙胶囊（导出导入）
 *
 * 存档结构（与需求一致）：
 *   type Save = {
 *     v: number;              // 存档版本，从 1 开始
 *     savedAt: number;        // 保存时间
 *     deviceId: string;       // 设备标识
 *     lastSettleTime: number; // 上次结算时间
 *     randomSeed: number;     // 确定性随机种子（额外字段，用于"刷新结果不变"）
 *     data: GameState;        // 所有游戏状态
 *   }
 *
 * 安全要点：
 * - 自动保存 debounce 500ms；visibilitychange / pagehide 立即保存。
 * - 不把 beforeunload 当作唯一保存方式。
 * - 导入时 try/catch + 白名单校验 + 剥离 __proto__ / constructor / prototype，防原型污染。
 * - migrateSave 逐版本升级，以后加字段不会坏旧档。
 */

import { GAME_NAME, GAME_NAME_EN, SAVE_VERSION } from './data.js';
import { createDefaultState, deepClone, makeDeviceId, makeRandomSeed, store } from './state.js';
import { formatClock, now } from './time.js';

/** localStorage 键名（加版本前缀，方便以后替换存储方案） */
export const STORAGE_KEY = 'stardust-migration:save:v1';
/** 备份键：导入前自动留一份，防止误覆盖 */
export const BACKUP_KEY = 'stardust-migration:backup:v1';
/** 自动保存防抖时间 */
export const AUTOSAVE_DEBOUNCE = 500;

/** 危险键名（原型污染防护） */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 递归剥离危险键，返回新对象（不修改入参） */
export function sanitize(value, depth = 0) {
  if (depth > 24) return null;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) continue;
    out[key] = sanitize(val, depth + 1);
  }
  return out;
}

/** 安全的数值读取 */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 安全的字符串读取 */
function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* 创建 / 校验 / 迁移                                                  */
/* ------------------------------------------------------------------ */

/**
 * 创建一份全新存档
 * @param {{ name?: string, ts?: number }} [opts]
 */
export function createNewSave({ name = '未命名星兽', ts = now() } = {}) {
  return {
    v: SAVE_VERSION,
    savedAt: ts,
    deviceId: makeDeviceId(),
    lastSettleTime: ts,
    randomSeed: makeRandomSeed(),
    data: createDefaultState({ name, ts }),
  };
}

/**
 * 把任意来源的对象补全成合法存档（不做版本迁移，只做结构补齐）
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeSave(raw) {
  if (!isPlainObject(raw)) return null;
  const clean = sanitize(raw);
  const data = isPlainObject(clean.data) ? clean.data : null;
  if (!data) return null;

  const save = {
    v: Math.max(1, Math.floor(num(clean.v, 1))),
    savedAt: num(clean.savedAt, num(clean.data?.savedAt, now())),
    deviceId: str(clean.deviceId, 'unknown-device'),
    lastSettleTime: num(clean.lastSettleTime, num(clean.savedAt, now())),
    randomSeed: Math.floor(num(clean.randomSeed, 0)) >>> 0,
    data,
  };
  if (!save.randomSeed) save.randomSeed = makeRandomSeed();
  return save;
}

/**
 * 版本迁移
 *
 * 规则：MIGRATIONS[n] 负责把 v = n 的存档升级到 v = n + 1。
 * 以后新增字段时，只需要加一个 MIGRATIONS 条目，旧档就能平滑升级。
 *
 * @param {object} save 已经过 normalizeSave 的存档
 * @returns {{save: object, migrated: boolean, from: number, to: number}}
 */
export function migrateSave(save) {
  const from = save.v;
  let current = save;
  let guard = 0;
  while (current.v < SAVE_VERSION && guard < 50) {
    const migrate = MIGRATIONS[current.v];
    if (typeof migrate !== 'function') {
      // 没有对应的迁移函数：直接把版本号提到当前，后续由 fillDefaults 补齐字段
      console.warn(`[save] 缺少 v${current.v} 的迁移函数，将直接补齐默认字段。`);
      current.v = SAVE_VERSION;
      break;
    }
    current = migrate(current);
    current.v += 1;
    guard += 1;
  }
  if (current.v > SAVE_VERSION) {
    // 来自更新版本的存档：保守处理，只提示不破坏数据
    current.v = SAVE_VERSION;
  }
  return { save: current, migrated: from !== current.v, from, to: current.v };
}

/**
 * 版本迁移表
 * 示例：MIGRATIONS[1] = (save) => { save.data.newField = ...; return save; }  // v1 -> v2
 * 目前只有 v1，因此表为空；保留结构以便将来扩展。
 */
export const MIGRATIONS = {
  // 1: (save) => {
  //   save.data.progress.dailyStreak = 0; // 例如 v2 新增字段
  //   return save;
  // },
};

/**
 * 用默认值补齐缺失字段（对旧档 / 手改档都安全）
 * 只补结构，不覆盖已有数值。
 */
export function fillDefaults(save) {
  const base = createDefaultState({ name: save?.data?.pet?.name ?? '未命名星兽', ts: save.savedAt });
  const data = save.data;

  data.pet = data.pet ?? {};
  data.pet.name = str(data.pet.name, base.pet.name);
  data.pet.stats = { ...base.pet.stats, ...(isPlainObject(data.pet.stats) ? data.pet.stats : {}) };
  data.pet.attrs = { ...base.pet.attrs, ...(isPlainObject(data.pet.attrs) ? data.pet.attrs : {}) };
  data.pet.level = Math.max(1, Math.floor(num(data.pet.level, 1)));
  data.pet.exp = Math.max(0, num(data.pet.exp, 0));
  data.pet.stage = str(data.pet.stage, base.pet.stage);
  data.pet.branch = data.pet.branch ? str(data.pet.branch, null) : null;
  data.pet.bornAt = num(data.pet.bornAt, base.pet.bornAt);
  data.pet.memory = { ...base.pet.memory, ...(isPlainObject(data.pet.memory) ? data.pet.memory : {}) };
  data.pet.memory.zonesVisited = Array.isArray(data.pet.memory.zonesVisited) ? data.pet.memory.zonesVisited : [];
  data.pet.memory.visitors = Array.isArray(data.pet.memory.visitors) ? data.pet.memory.visitors : [];
  data.pet.memory.flags = Array.isArray(data.pet.memory.flags) ? data.pet.memory.flags : [];

  data.inventory = isPlainObject(data.inventory) ? data.inventory : { ...base.inventory };
  for (const [id, amount] of Object.entries(data.inventory)) {
    data.inventory[id] = Math.max(0, Math.floor(num(amount, 0)));
  }

  data.buildings = { ...base.buildings, ...(isPlainObject(data.buildings) ? data.buildings : {}) };
  for (const [id, level] of Object.entries(data.buildings)) {
    data.buildings[id] = Math.max(0, Math.floor(num(level, 0)));
  }

  data.actionPoints = Math.max(0, num(data.actionPoints, base.actionPoints));
  data.lastApReset = num(data.lastApReset, base.lastApReset);

  data.task = { ...base.task, ...(isPlainObject(data.task) ? data.task : {}) };
  data.task.active = data.task.active ? str(data.task.active, null) : null;

  data.codex = { ...base.codex, ...(isPlainObject(data.codex) ? data.codex : {}) };
  for (const key of ['items', 'encounters', 'visitors', 'recipes']) {
    data.codex[key] = isPlainObject(data.codex[key]) ? data.codex[key] : {};
  }

  data.achievements = isPlainObject(data.achievements) ? data.achievements : {};

  data.progress = { ...base.progress, ...(isPlainObject(data.progress) ? data.progress : {}) };
  data.progress.affinity = { ...base.progress.affinity, ...(isPlainObject(data.progress.affinity) ? data.progress.affinity : {}) };
  data.progress.careCounts = { ...base.progress.careCounts, ...(isPlainObject(data.progress.careCounts) ? data.progress.careCounts : {}) };
  data.progress.eventsSeen = isPlainObject(data.progress.eventsSeen) ? data.progress.eventsSeen : {};

  data.unlockedZones = Array.isArray(data.unlockedZones) && data.unlockedZones.length
    ? [...new Set(data.unlockedZones.map((z) => str(z)).filter(Boolean))]
    : [...base.unlockedZones];

  data.imports = { ...base.imports, ...(isPlainObject(data.imports) ? data.imports : {}) };
  data.imports.history = Array.isArray(data.imports.history) ? data.imports.history : [];

  data.lastSeen = num(data.lastSeen, base.lastSeen);
  data.version = SAVE_VERSION;
  return save;
}

/**
 * 校验一份存档是否可用
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function validateSave(save) {
  const reasons = [];
  if (!isPlainObject(save)) reasons.push('存档不是一个对象。');
  else {
    if (!isPlainObject(save.data)) reasons.push('缺少 data 字段。');
    if (!isPlainObject(save.data?.pet)) reasons.push('缺少星兽数据（data.pet）。');
    if (num(save.v, 0) < 1) reasons.push('版本号非法。');
  }
  return { ok: reasons.length === 0, reasons };
}

/** 完整流程：校验 -> 归一化 -> 迁移 -> 补齐默认值 */
export function loadFromObject(raw) {
  const normalized = normalizeSave(raw);
  if (!normalized) return { ok: false, reasons: ['存档格式无法识别。'] };
  const check = validateSave(normalized);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const { save, migrated, from, to } = migrateSave(normalized);
  fillDefaults(save);
  return { ok: true, save, migrated, from, to };
}

/* ------------------------------------------------------------------ */
/* localStorage 读写                                                   */
/* ------------------------------------------------------------------ */

/**
 * 内存兜底存储
 *
 * 场景：某些浏览器在 file:// 协议下会禁用 localStorage（Firefox / Safari 会直接抛
 * SecurityError）。这时游戏必须还能玩，只是存档不会持久化——我们会明确提示玩家
 * 用「迁徙胶囊」保存进度。
 */
const memoryStore = new Map();

/** 探测 localStorage 是否真的可用 */
function probeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    const probe = '__stardust_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

let persistent = null; // 惰性探测结果

/** 当前存储是否持久化（false = 只存在内存里，刷新就丢） */
export function isPersistentStorage() {
  if (persistent === null) persistent = probeLocalStorage();
  return persistent;
}

/** 重置探测缓存（例如从持久化切到内存模式后想让 UI 重新判断） */
export function resetStorageProbe() {
  persistent = null;
}

/** 统一读取 */
function readRaw(key) {
  if (isPersistentStorage()) {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return memoryStore.get(key) ?? null;
    }
  }
  return memoryStore.get(key) ?? null;
}

/** 统一写入，返回是否真正持久化成功 */
function writeRaw(key, value) {
  memoryStore.set(key, value);
  if (!isPersistentStorage()) return false;
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // 配额满 / 被禁用：退回内存模式，本局仍可继续玩
    console.error('[save] 写入本地存储失败，本局进度只在内存中：', err);
    persistent = false;
    return false;
  }
}

/** 统一删除 */
function removeRaw(key) {
  memoryStore.delete(key);
  if (!isPersistentStorage()) return;
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/** 读取最近自动存档 */
export function readLocalSave() {
  let text = null;
  try {
    text = readRaw(STORAGE_KEY);
  } catch (err) {
    return { ok: false, reasons: ['读取本地存档失败：' + err.message] };
  }
  if (!text) return { ok: false, reasons: ['本地还没有存档。'], empty: true };
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reasons: ['本地存档已损坏（JSON 解析失败）。'], corrupted: true };
  }
  return loadFromObject(raw);
}

/** 写入本地存档 */
export function writeLocalSave(save) {
  try {
    save.savedAt = now();
    writeRaw(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch (err) {
    console.error('[save] 写入失败：', err);
    return false;
  }
}

/** 删除本地存档（默认保留备份） */
export function clearLocalSave({ keepBackup = true } = {}) {
  try {
    if (keepBackup) {
      const current = readRaw(STORAGE_KEY);
      if (current) writeRaw(BACKUP_KEY, current);
    }
    removeRaw(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** 读取自动备份 */
export function readBackup() {
  const text = readRaw(BACKUP_KEY);
  if (!text) return { ok: false, reasons: ['没有备份。'] };
  try {
    return loadFromObject(JSON.parse(text));
  } catch {
    return { ok: false, reasons: ['备份已损坏。'] };
  }
}

/* ------------------------------------------------------------------ */
/* 自动保存（debounce + 立即保存）                                      */
/* ------------------------------------------------------------------ */

let autosaveTimer = null;
let unsubscribe = null;

/** 立即保存（用于 visibilitychange / pagehide） */
export function saveNow() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  const save = store.save;
  if (!save) return false;
  return writeLocalSave(save);
}

/** debounce 保存 */
export function scheduleAutosave(delay = AUTOSAVE_DEBOUNCE) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const save = store.save;
    if (save) writeLocalSave(save);
  }, delay);
}

/**
 * 启动自动存档：状态一变就安排一次 debounce 写入
 * @returns {() => void} 停止函数
 */
export function startAutosave() {
  stopAutosave();
  unsubscribe = store.subscribe(() => scheduleAutosave());
  return stopAutosave;
}

export function stopAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

/**
 * 绑定页面生命周期事件（不使用 beforeunload 作为唯一手段）
 *
 * 说明：这里优先使用 window，而不是 globalThis。
 * 浏览器里两者等价，但显式写 window 更清楚，也方便在无 DOM 环境（测试 / SSR）中跳过。
 *
 * @param {{ onSaved?: () => void }} [hooks]
 * @returns {() => boolean} 手动保存函数
 */
export function bindLifecycle({ onSaved } = {}) {
  const flush = (reason) => {
    const ok = saveNow();
    if (ok && onSaved) onSaved(reason);
    return ok;
  };

  if (typeof document !== 'undefined') {
    // 切到后台 / 锁屏：立即保存
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush('visibilitychange');
    });
  }

  const win = typeof window !== 'undefined' ? window : null;
  if (win?.addEventListener) {
    // 页面被卸载 / 进入往返缓存：立即保存
    win.addEventListener('pagehide', () => flush('pagehide'));
    // 失去焦点（切到别的 App）：顺手保存一次
    win.addEventListener('blur', () => flush('blur'));
    // 移动端常见：被系统直接冻结前最后一搏（不作为唯一手段）
    win.addEventListener('beforeunload', () => flush('beforeunload'));
  }

  return () => flush('manual');
}

/* ------------------------------------------------------------------ */
/* 迁徙胶囊：导出 / 导入 / 合并                                         */
/* ------------------------------------------------------------------ */

/** 胶囊文件格式标识 */
export const CAPSULE_KIND = 'stardust-migration-capsule';

/**
 * 生成"迁徙胶囊"对象
 * @param {object} save
 */
export function buildCapsule(save) {
  return {
    kind: CAPSULE_KIND,
    game: GAME_NAME,
    gameEn: GAME_NAME_EN,
    v: save.v,
    exportedAt: now(),
    /** 简短的世界观文案，导出文件本身也是一份纪念品 */
    note: '这是一枚迁徙胶囊。把它带到新的星门，星兽就会在那里醒来。',
    save: deepClone(save),
  };
}

/**
 * 导出为可下载文件
 * @param {object} save
 * @param {{ pretty?: boolean }} [opts]
 * @returns {{filename: string, text: string}}
 */
export function exportCapsuleFile(save, { pretty = true } = {}) {
  const capsule = buildCapsule(save);
  const text = JSON.stringify(capsule, null, pretty ? 2 : 0);
  const stamp = new Date(now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const petName = save?.data?.pet?.name || '星兽';
  const safeName = petName.replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 12);
  return { filename: `迁徙胶囊_${safeName}_${stamp}.json`, text };
}

/** 触发浏览器下载 */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Base64 存档码（UTF-8 安全）
 * @param {object} save
 */
export function encodeCapsuleCode(save) {
  const json = JSON.stringify(buildCapsule(save));
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 解析 Base64 存档码
 * @param {string} code
 */
export function decodeCapsuleCode(code) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!clean) throw new Error('存档码为空。');
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

/**
 * 从任意来源解析胶囊 / 裸存档
 *
 * 兼容三种输入：
 * 1. 胶囊 JSON（导出文件的内容）
 * 2. 裸存档 JSON（早期手写的存档）
 * 3. Base64 存档码（"生成存档码"按钮产出的那串字符）
 *
 * @param {string} text
 * @returns {{ok: boolean, reasons?: string[], save?: object, migrated?: boolean, from?: number, to?: number}}
 */
export function parseCapsuleText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, reasons: ['内容为空。'] };

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // 不是 JSON，尝试当作 Base64 存档码
    try {
      data = decodeCapsuleCode(raw);
    } catch (err) {
      return { ok: false, reasons: ['无法解析：既不是 JSON，也不是有效的存档码。（' + err.message + '）'] };
    }
  }

  const candidate = isPlainObject(data?.save) ? data.save : data;
  return loadFromObject(candidate);
}

/**
 * 合并两份存档的"可合并部分"，资源与进度只取一份（避免刷档）
 *
 * 规则：
 * - 主档（base）：资源、状态、任务、行动点 —— 全部保留
 * - 副档（incoming）：只贡献 图鉴 / 成就 / 星兽记忆（去过的区域、访客、换设备次数）
 *
 * @param {object} base 保留的那一份
 * @param {object} incoming 被合并进来的那一份
 * @returns {object} 合并后的 base（原地修改）
 */
export function mergeCodex(base, incoming) {
  const a = base.data;
  const b = incoming.data;

  // 图鉴：合并条目，首次发现时间取更早的
  for (const key of ['items', 'encounters', 'visitors', 'recipes']) {
    for (const [id, meta] of Object.entries(b.codex?.[key] ?? {})) {
      const existing = a.codex[key][id];
      if (!existing) {
        a.codex[key][id] = { ...meta };
      } else if (num(meta?.firstAt, Infinity) < num(existing.firstAt, Infinity)) {
        existing.firstAt = meta.firstAt;
      }
    }
  }

  // 成就：取并集
  for (const [id, meta] of Object.entries(b.achievements ?? {})) {
    if (!a.achievements[id]) a.achievements[id] = { ...meta };
  }

  // 星兽记忆：去过的区域、访客、换设备次数
  const az = new Set(a.pet.memory.zonesVisited);
  for (const z of b.pet.memory.zonesVisited ?? []) az.add(z);
  a.pet.memory.zonesVisited = [...az];

  const av = new Set(a.pet.memory.visitors);
  for (const v of b.pet.memory.visitors ?? []) av.add(v);
  a.pet.memory.visitors = [...av];

  a.pet.memory.deviceCount = Math.max(num(a.pet.memory.deviceCount, 1), num(b.pet.memory.deviceCount, 1));

  // 解锁区域取并集（导入的档如果解锁过遗迹，主档也能去）
  const au = new Set([...(a.unlockedZones ?? []), ...(b.unlockedZones ?? [])]);
  a.unlockedZones = [...au];

  // 见闻计数取较大值
  for (const [id, count] of Object.entries(b.progress?.eventsSeen ?? {})) {
    a.progress.eventsSeen[id] = Math.max(num(a.progress.eventsSeen[id], 0), num(count, 0));
  }

  return base;
}

/**
 * 导入结果类型
 * @typedef {{ok: boolean, reasons?: string[], save?: object, migrated?: boolean, conflict?: object, needsChoice?: boolean}}
 */

/**
 * 准备导入：解析文本、与当前存档比较、判断是否需要玩家选择
 *
 * @param {string} text 文件或存档码内容
 * @param {object|null} currentSave 当前存档
 * @returns {import('./save.js').ImportPreview}
 */
export function prepareImport(text, currentSave) {
  let parsed;
  try {
    parsed = parseCapsuleText(text);
  } catch (err) {
    return { ok: false, reasons: ['无法解析：' + err.message] };
  }
  if (!parsed.ok) return { ok: false, reasons: parsed.reasons };

  const incoming = parsed.save;
  if (!currentSave) {
    return { ok: true, save: incoming, migrated: parsed.migrated, from: parsed.from, to: parsed.to };
  }

  const currentSettle = num(currentSave.lastSettleTime, 0);
  const incomingSettle = num(incoming.lastSettleTime, 0);
  const newer = incomingSettle === currentSettle
    ? num(incoming.savedAt, 0) >= num(currentSave.savedAt, 0)
      ? 'incoming'
      : 'current'
    : incomingSettle > currentSettle
      ? 'incoming'
      : 'current';

  return {
    ok: true,
    save: incoming,
    migrated: parsed.migrated,
    from: parsed.from,
    to: parsed.to,
    conflict: {
      newer,
      currentDevice: currentSave.deviceId,
      incomingDevice: incoming.deviceId,
      currentSettle,
      incomingSettle,
      currentSavedAt: num(currentSave.savedAt, 0),
      incomingSavedAt: num(incoming.savedAt, 0),
      currentLevel: num(currentSave.data?.pet?.level, 1),
      incomingLevel: num(incoming.data?.pet?.level, 1),
      currentItems: Object.keys(currentSave.data?.codex?.items ?? {}).length,
      incomingItems: Object.keys(incoming.data?.codex?.items ?? {}).length,
    },
    needsChoice: true,
  };
}

/**
 * 应用导入
 * @param {object} incoming 已校验的存档
 * @param {'replace'|'merge'|'keep'} mode
 * @param {object|null} currentSave
 * @returns {{save: object, message: string}}
 */
export function applyImport(incoming, mode, currentSave) {
  const importStamp = now();
  const next = deepClone(incoming);
  fillDefaults(next);
  next.deviceId = makeDeviceId();
  next.lastSettleTime = importStamp;
  next.savedAt = importStamp;
  next.data.imports = next.data.imports ?? { count: 0, lastAt: 0, lastSourceDevice: null, history: [] };
  next.data.imports.count = num(next.data.imports.count, 0) + 1;
  next.data.imports.lastAt = importStamp;
  next.data.imports.lastSourceDevice = incoming.deviceId;
  next.data.imports.history = [
    ...(next.data.imports.history ?? []).slice(-9),
    { at: importStamp, sourceDevice: incoming.deviceId, mode },
  ];
  next.data.pet.memory.deviceCount = Math.max(num(next.data.pet.memory.deviceCount, 1), num(currentSave?.data?.pet?.memory?.deviceCount, 1)) + (currentSave ? 1 : 0);

  if (mode === 'merge' && currentSave) {
    mergeCodex(currentSave, next);
    // 合并结果以主档的时间线继续，避免"领取离线收益"被重置
    currentSave.data.pet.memory.deviceCount = next.data.pet.memory.deviceCount;
    currentSave.data.imports = next.data.imports;
    return { save: currentSave, message: '已合并图鉴与成就，资源与进度保留当前星门这一份。' };
  }

  return {
    save: next,
    message: mode === 'keep' ? '已保留当前存档（导入内容未应用）。' : '已在新星门唤醒星兽。',
  };
}

/* ------------------------------------------------------------------ */
/* 导入预览类型注释（供 IDE 提示）                                      */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} ImportPreview
 * @property {boolean} ok
 * @property {string[]} [reasons]
 * @property {object} [save]
 * @property {boolean} [migrated]
 * @property {number} [from]
 * @property {number} [to]
 * @property {object} [conflict]
 * @property {boolean} [needsChoice]
 */

/** 存档摘要（设置页展示用） */
export function summarizeSave(save) {  if (!save) return null;
  return {
    petName: save.data?.pet?.name ?? '未知',
    level: save.data?.pet?.level ?? 1,
    stage: save.data?.pet?.stage ?? 'larva',
    stardust: save.data?.inventory?.stardust ?? 0,
    items: Object.keys(save.data?.codex?.items ?? {}).length,
    achievements: Object.keys(save.data?.achievements ?? {}).length,
    deviceId: save.deviceId,
    savedAt: save.savedAt,
    lastSettleTime: save.lastSettleTime,
    savedAtText: formatClock(num(save.savedAt, now())),
    version: save.v,
  };
}
