/* 模型存档：把 TinyTransformer 的权重 + Adam 状态打包成一个自包含的字符串。
 *
 * 设计要点：
 *  - 只存"数字"，不存代码。存档里带上 shape 和词表，读档时先校验形状再灌权重，
 *    形状不符直接报错——安静地读进一个尺寸不对的模型，比报错危险得多。
 *  - 权重先量化成 float32 字节，再 gzip 压缩，最后 base64。
 *    实测 D=32/L=2/H=4/ctx=32/V=1233 的模型约 67k 参数：
 *    纯 JSON 约 1.4MB，字节+gzip+base64 约 200KB，能塞进 localStorage。
 *  - gzip 用平台自带实现：浏览器 DecompressionStream / Node zlib，
 *    都不需要第三方库，file:// 下也能用。
 */

const MAGIC = 'TXJLLM2';
const VERSION = 1;
const STORE_KEY = 'txj-llm-v2-checkpoint';

/* ---------------- base64 ---------------- */

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64LOOKUP = (() => { const t = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) t[B64CHARS.charCodeAt(i)] = i; return t; })();

export function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + B64CHARS[(n >> 6) & 63] + B64CHARS[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + B64CHARS[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(str) {
  const clean = String(str).replace(/[\s=]/g, '');
  const n = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(n);
  let p = 0, acc = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64LOOKUP[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[p++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, p);
}

/* ---------------- gzip：浏览器与 Node 各走一条路 ---------------- */

const hasWebStreams = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function gzip(bytes) {
  if (hasWebStreams) {
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import('node:zlib');
  const { promisify } = await import('node:util');
  return new Uint8Array(await promisify(zlib.gzip)(Buffer.from(bytes)));
}

async function gunzip(bytes) {
  if (hasWebStreams) {
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import('node:zlib');
  const { promisify } = await import('node:util');
  return new Uint8Array(await promisify(zlib.gunzip)(Buffer.from(bytes)));
}

/* ---------------- 权重 <-> 字节 ---------------- */

/** 把 saveState() 的结果编码成紧凑字节流：头部 JSON + 各块的 float32 原始字节 */
function packState(state) {
  const enc = new TextEncoder();
  const chunks = [];
  const blocks = [];
  const add = (prefix, name, data) => {
    blocks.push([prefix + name, data.length]);
    chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  };
  for (const { name, data } of state.params) add('p:', name, data);
  if (state.adam && state.adam.entries) for (const [name, data] of state.adam.entries) add('a:', name, data);
  const meta = JSON.stringify({
    v: VERSION, shape: state.shape, step: state.step,
    adamStep: state.adam ? state.adam.step : 0,
    blocks,
  });
  const metaBytes = enc.encode(meta);
  const metaLen = new Uint8Array(4);
  new DataView(metaLen.buffer).setUint32(0, metaBytes.length, true);
  const total = 4 + metaBytes.length + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  out.set(metaLen, off); off += 4;
  out.set(metaBytes, off); off += metaBytes.length;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function unpackState(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen)));
  if (meta.v !== VERSION) throw new Error(`存档版本 ${meta.v} 与当前代码 ${VERSION} 不符`);
  let off = 4 + metaLen;
  const params = [], adamEntries = [];
  for (const [name, len] of meta.blocks) {
    // 逐元素读，不依赖内存对齐：gzip 解出来的 buffer 起点不保证 4 字节对齐
    const copy = new Float32Array(len);
    for (let i = 0; i < len; i++) copy[i] = dv.getFloat32(off + i * 4, true);
    off += len * 4;
    if (name.startsWith('p:')) params.push({ name: name.slice(2), data: copy });
    else adamEntries.push([name.slice(2), copy]);
  }
  return {
    shape: meta.shape, step: meta.step,
    params,
    adam: meta.adamStep ? { step: meta.adamStep, entries: adamEntries } : null,
  };
}

/* ---------------- 对外接口 ---------------- */

/** 词表指纹：不存整份词表，只存一个哈希，够用来判断"是不是同一份语料" */
export function vocabFingerprint(strs) {
  let h = 0x811c9dc5;
  const s = strs.join('\u0001');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return { n: strs.length, x: (h >>> 0).toString(16), sample: strs.slice(0, 8).join('') };
}

/**
 * 把模型打包成字符串。
 * @param {object} model TinyTransformer 实例
 * @param {object} meta 额外元数据（语料指纹、训练步数、时间等），读档时会校验
 */
export async function encodeCheckpoint(model, meta = {}) {
  const packed = packState(model.saveState());
  const gz = await gzip(packed);
  const header = JSON.stringify({ m: MAGIC, v: VERSION, meta, raw: packed.length, gz: gz.length });
  const headerB64 = bytesToBase64(new TextEncoder().encode(header));
  return `${MAGIC}.${headerB64}.${bytesToBase64(gz)}`;
}

/** 解析字符串，返回 { state, meta, bytes } */
export async function decodeCheckpoint(str) {
  const s = String(str).trim();
  const first = s.indexOf('.');
  const second = s.indexOf('.', first + 1);
  if (first < 0 || second < 0 || s.slice(0, first) !== MAGIC) throw new Error('不是本页导出的存档');
  const header = JSON.parse(new TextDecoder().decode(base64ToBytes(s.slice(first + 1, second))));
  const gz = base64ToBytes(s.slice(second + 1));
  const packed = await gunzip(gz);
  return { state: unpackState(packed), meta: header.meta || {}, bytes: packed.length };
}

/** 读档到已有模型（形状与词表必须一致），返回元数据 */
export async function loadInto(model, str) {
  const { state, meta } = await decodeCheckpoint(str);
  checkVocab(meta);
  model.loadState(state);
  return meta;
}

/** 按存档形状新建模型并读档 */
export async function modelFromCheckpoint(str) {
  const { state, meta } = await decodeCheckpoint(str);
  checkVocab(meta);
  const { TinyTransformer } = await import('./tiny-transformer.js');
  const m = new TinyTransformer({ ...state.shape, seed: 1 });
  m.loadState(state);
  return { model: m, meta };
}

/**
 * 词表校验：id 只在同一份词表下才有意义。
 * 语料变了导致词表错位却照样把权重读进去，模型会输出完全无意义的字，
 * 而且不报任何错 —— 所以这里必须硬性拦住。
 */
export function checkVocab(meta, expected) {
  if (!meta || !meta.vocabHead) return;
  if (expected && expected.x !== undefined && meta.vocabHead.x !== expected.x) {
    throw new Error(`存档的词表与当前语料不一致（存档 ${meta.vocabHead.n} 字 / 当前 ${expected.x} 字符，指纹 ${meta.vocabHead.x} vs ${expected.x}）。请用同一份语料。`);
  }
}

/* ---------------- 浏览器 localStorage ---------------- */

export function hasStorage() {
  try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
}

export function saveToStorage(str, key = STORE_KEY) {
  if (!hasStorage()) throw new Error('当前环境不支持 localStorage（file:// 下某些浏览器会禁用）');
  try {
    localStorage.setItem(key, str);
  } catch (e) {
    throw new Error(`浏览器存储写入失败（可能超出配额，存档约 ${(str.length / 1024).toFixed(0)}KB）：${e.message}`);
  }
  return str.length;
}

export function loadFromStorage(key = STORE_KEY) {
  if (!hasStorage()) return null;
  return localStorage.getItem(key);
}

export function clearStorage(key = STORE_KEY) {
  if (hasStorage()) localStorage.removeItem(key);
}

export function storageInfo(key = STORE_KEY) {
  const s = loadFromStorage(key);
  return s ? { bytes: s.length, meta: null } : null;
}

/** 浏览器里触发下载 */
export function downloadCheckpoint(str, filename) {
  const blob = new Blob([str], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || `txj-llm-${Date.now()}.ckpt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 浏览器里弹出文件选择，返回文件内容 */
export function pickCheckpointFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.ckpt,.txt,text/plain';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { resolve(null); return; }
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsText(f);
    };
    inp.click();
  });
}
