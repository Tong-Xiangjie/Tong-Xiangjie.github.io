#!/usr/bin/env node
/**
 * 二进制级"复制式"合并：原封不动保留官方 ZIP 的字节，只在末尾追加新条目。
 *
 * 为什么不能用常规重打包：
 *   实测（tools/probe-native-import.mjs，真浏览器走应用自己的导入 UI）：
 *     官方原包                                → ✅ 已导入 2763 个对话
 *     官方原包 + 1 个本地会话（重打包）        → ❌ 失败
 *     官方数据 0 改动、只过一遍重打包          → ❌ 失败
 *     官方原包字节外科手术删到 3 个会话（重打包）→ ❌ 失败
 *     手写 ZIP（6 种 flags/method/描述符组合）  → ❌ 全部失败
 *   也就是说：**只要重新打包就失败，哪怕内容一比一相同**。
 *   应用对官方导出的包有某种"重打包即失去"的字节特征（未查明）。
 *
 * 所以这个工具换思路：不重新打包。
 *   - 官方原包的每个字节（本地头 + 压缩数据 + 数据描述符）**原样复制**
 *   - 新增条目（索引 / 本地会话 / 本地附件）用 zip-writer 生成，追加在末尾
 *   - 只重写 EOCD，其余字节一律不动
 *
 * ZIP 格式允许任意顺序的本地条目 + 末尾中央目录，应用按偏移读取，
 * 所以"追加 + 重写 EOCD"是完全合规的。
 *
 * 用法: node tools/append-into-official-zip.mjs <官方ZIP> <现有对话导出.json> <输出ZIP>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { crc32 } from './zip-writer.mjs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// 0. 参数
// ---------------------------------------------------------------------------
const [zipIn, bundleIn, zipOut] = process.argv.slice(2);
if (!zipIn || !bundleIn || !zipOut) {
  console.error('用法: node tools/append-into-official-zip.mjs <官方ZIP> <现有对话导出.json> <输出ZIP>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. 解析原 ZIP 的中央目录（不改动任何数据字节）
// ---------------------------------------------------------------------------
const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50;
const src = readFileSync(zipIn);
console.log(`官方原包: ${zipIn}  ${(src.length / 1024 / 1024).toFixed(2)} MB`);

let eocd = -1;
for (let i = src.length - 22; i >= Math.max(0, src.length - 22 - 65535); i--) {
  if (src.readUInt32LE(i) === EOCD_SIG) {
    if (i + 22 + src.readUInt16LE(i + 20) === src.length) { eocd = i; break; }
  }
}
if (eocd < 0) { console.error('✗ 找不到 EOCD'); process.exit(1); }

const cenCount = src.readUInt16LE(eocd + 10);
const cenSize = src.readUInt32LE(eocd + 12);
const cenOffset = src.readUInt32LE(eocd + 16);
console.log(`  条目 ${cenCount}，中央目录 @${cenOffset} (${cenSize} 字节)`);

if (cenOffset + cenSize !== eocd) {
  console.error(`✗ 中央目录位置异常：${cenOffset}+${cenSize} != ${eocd}`);
  process.exit(1);
}

/** 读取原 ZIP 的全部中央目录记录（原样保留字节，仅记录解析结果） */
const srcEntries = [];
{
  let p = cenOffset;
  for (let i = 0; i < cenCount; i++) {
    if (src.readUInt32LE(p) !== CEN_SIG) { console.error(`✗ 第 ${i} 条中央目录签名错误`); process.exit(1); }
    const nameLen = src.readUInt16LE(p + 28);
    const extraLen = src.readUInt16LE(p + 30);
    const commentLen = src.readUInt16LE(p + 32);
    const recLen = 46 + nameLen + extraLen + commentLen;
    srcEntries.push({
      name: src.toString('utf8', p + 46, p + 46 + nameLen),
      flags: src.readUInt16LE(p + 8),
      method: src.readUInt16LE(p + 10),
      crc: src.readUInt32LE(p + 16),
      compSize: src.readUInt32LE(p + 20),
      size: src.readUInt32LE(p + 24),
      localOff: src.readUInt32LE(p + 42),
      raw: src.subarray(p, p + recLen)      // ★ 中央目录记录原始字节
    });
    p += recLen;
  }
}
console.log(`  解析 ${srcEntries.length} 个条目`);

/** 从原 ZIP 里取某个条目的解压内容（只读，不修改源字节） */
function readSrc(path) {
  const e = srcEntries.find((x) => x.name === path);
  if (!e) return null;
  const hnl = src.readUInt16LE(e.localOff + 26);
  const hel = src.readUInt16LE(e.localOff + 28);
  const ds = e.localOff + 30 + hnl + hel;
  const comp = src.subarray(ds, ds + e.compSize);
  return e.method === 0 ? Buffer.from(comp) : inflateRaw(comp);
}
function inflateRaw(buf) {
  return inflateRawSync(buf);
}

// ---------------------------------------------------------------------------
// 2. 读现有对话导出
// ---------------------------------------------------------------------------
let bundleRaw = readFileSync(bundleIn, 'utf8');
if (bundleRaw.charCodeAt(0) === 0xFEFF) bundleRaw = bundleRaw.slice(1);
const bundle = JSON.parse(bundleRaw);
const localSessions = bundle.sessions || [];
console.log(`现有对话: ${localSessions.length} 个会话`);
if (!localSessions.length) { console.log('  ★ 无本地会话：只重写索引做对照'); }

// 本地附件字节（导出里的 base64）
const localFiles = new Map();
for (const f of (bundle.files || [])) {
  if (f && f.id && f.blobB64) localFiles.set(f.id, f.blobB64);
}

// ---------------------------------------------------------------------------
// 3. 把本地会话转成官方 v3 格式（与 merge-into-official-zip.mjs 同一套规则）
// ---------------------------------------------------------------------------
const iso = (ms) => {
  const d = ms == null ? new Date() : new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();
  return d.toISOString();
};
const safeId = (s) => {
  const t = String(s == null ? '' : s).normalize('NFC');
  if (!t || /[/\\]/.test(t) || t === '.' || t === '..') {
    return 'local-' + Math.random().toString(16).slice(2, 10);
  }
  return t;
};
const attachPath = (sid, fileId, name) => `chat_sessions/${sid}_files/${fileId}_${name}`;
const extFor = (a) => {
  const n = String(a.name || '');
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(n);
  if (m) return '.' + m[1].toLowerCase();
  const t = String(a.mimeType || '');
  if (t.includes('png')) return '.png';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  if (t.includes('svg')) return '.svg';
  return '.bin';
};

const addedSessions = [];
const addedFiles = [];   // { path, buf }
for (const s of localSessions) {
  const sid = safeId(s.id);
  const byId = new Map();
  for (const m of (s.messages || [])) byId.set(m.id, m);

  // 顺 selectedChildId 走出当前分支
  const path = [];
  let cur = s.rootMessageId;
  let guard = 0;
  while (cur != null && byId.has(cur) && guard++ < 100000) {
    const m = byId.get(cur);
    path.push(m);
    cur = m.selectedChildId;
  }
  if (!path.length && (s.messages || []).length) path.push(s.messages[0]);
  if (!path.length) continue;

  const files = [];
  const messages = path.map((m, i) => {
    const isUser = m.role === 'user';
    const fragments = [];
    if (isUser) {
      fragments.push({ type: 'REQUEST', content: typeof m.content === 'string' ? m.content : '' });
      const atts = Array.isArray(m.files) ? m.files : [];
      if (atts.length) {
        const rows = [];
        for (const a of atts) {
          const src64 = localFiles.get(a.id);
          const rec = {
            id: safeId(a.id),
            file_name: a.name == null ? '' : String(a.name),
            file_size: typeof a.size === 'number' ? a.size : 0,
            token_usage: null,
            inserted_at: iso(m.createdAt),
            export_path: null,
            is_image: !!a.isImage,
            width: null,
            height: null
          };
          if (a.isImage && src64) {
            const name = (rec.file_name || rec.id) + extFor(a);
            rec.file_name = name;
            rec.export_path = attachPath(sid, rec.id, name);
            addedFiles.push({ path: rec.export_path, buf: Buffer.from(src64, 'base64') });
          }
          rows.push(rec);
        }
        fragments.push({ type: 'FILE', files: rows });
      }
    } else {
      const blocks = Array.isArray(m.blocks) ? m.blocks
        : (Array.isArray(m.content) ? m.content : []);
      for (const bl of blocks) {
        if (!bl) continue;
        if (bl.type === 'thinking' && typeof bl.thinking === 'string') {
          fragments.push({ type: 'THINK', content: bl.thinking, elapsed_secs: null });
        } else if (bl.type === 'text' && typeof bl.text === 'string') {
          fragments.push({ type: 'RESPONSE', content: bl.text });
        } else if (bl.type === 'server_tool_use') {
          const input = bl.input || {};
          const queries = Array.isArray(input.queries) ? input.queries
            : (input.query ? [input.query] : []);
          fragments.push({ type: 'TOOL_SEARCH', queries, results: [], status: 'FINISHED' });
        }
      }
      // ★ 官方 12341 条消息里 fragments 为空的是 0 条；空片段会让整个导入失败
      if (fragments.length === 0) {
        const errText = m.error
          ? `（此条回复未生成内容：${m.error.message || m.error.kind || '未知错误'}）`
          : '（此条回复没有内容）';
        fragments.push({ type: 'RESPONSE', content: errText });
      }
    }
    return {
      id: i,
      parent_id: i === 0 ? null : i - 1,
      role: isUser ? 'USER' : 'ASSISTANT',
      status: 'FINISHED',
      thinking_enabled: !!m.thinking,
      search_enabled: !!m.search,
      accumulated_token_usage: typeof m.tokens === 'number' ? m.tokens : null,
      inserted_at: iso(m.createdAt),
      fragments
    };
  });

  const ts = iso(s.createdAt);
  addedSessions.push({
    id: sid,
    title: s.title == null ? '' : String(s.title),
    pinned: false,
    current_message_id: messages[messages.length - 1].id,
    inserted_at: ts,
    updated_at: iso(s.updatedAt),
    messages
  });
}
console.log(`  转出 ${addedSessions.length} 个会话，附件原件 ${addedFiles.length} 个`);

// ---------------------------------------------------------------------------
// 4. 新索引 = 原索引 + 新会话
// ---------------------------------------------------------------------------
const srcIdxBuf = readSrc('chat_session_index.json');
if (!srcIdxBuf) { console.error('✗ 原包里没有 chat_session_index.json'); process.exit(1); }
const srcIndex = JSON.parse(srcIdxBuf.toString('utf8'));
console.log(`  原索引 ${srcIndex.length} 条`);

const existingIds = new Set(srcIndex.map((e) => e.id));
let renamed = 0;
for (const s of addedSessions) {
  let id = s.id;
  while (existingIds.has(id)) id = s.id + '-local' + (++renamed);
  existingIds.add(id);
  s.id = id;
  // 会话内的附件路径要跟着改
  for (const m of s.messages) {
    for (const f of m.fragments) {
      if (f.type !== 'FILE') continue;
      for (const r of f.files) {
        if (r.export_path) r.export_path = r.export_path.replace(/^chat_sessions\/[^/]+_files\//, `chat_sessions/${id}_files/`);
      }
    }
  }
  srcIndex.push({
    id,
    title: s.title,
    pinned: false,
    message_count: s.messages.length,
    inserted_at: s.inserted_at,
    updated_at: s.updated_at
  });
}
const newIndexBuf = Buffer.from(JSON.stringify(srcIndex), 'utf8');
console.log(`  新索引 ${srcIndex.length} 条`);

/**
 * KEEP_INDEX_BYTES=1：本地会话数为 0 时，索引条目**原样复用官方字节**。
 * 用于对照实验：如果这样出来的包能被导入，说明问题是"索引被重新压缩"；
 * 如果仍失败，说明只要中央目录被动过就不行。
 */
const reuseOriginalIndexEntry = process.env.KEEP_INDEX_BYTES === '1' && addedSessions.length === 0;
console.log(`  索引处理: ${reuseOriginalIndexEntry ? '原样复用官方字节（对照）' : '重写（' + newIndexBuf.length + ' 字节）'}`);

// ---------------------------------------------------------------------------
// 5. 组装新条目（追加在末尾）
// ---------------------------------------------------------------------------
/**
 * 生成一个本地条目（本地头 + 数据 + 可选数据描述符）。
 * 写法与官方保持一致：数据描述符（flags bit3）—— 官方 3766 条全部如此。
 */
function localEntry(name, data, useDD, stored) {
  const nameBuf = Buffer.from(name, 'utf8');
  // ★ 官方把元数据（manifest/user/index）用 method=0（不压缩）存，
  //   INDEX_STORED=1 时对齐这一行为
  const method = stored ? 0 : 8;
  const comp = stored ? Buffer.from(data) : deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const flags = 0x0008 | (nameBuf.some((b) => b > 127) ? 0x0800 : 0);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(method === 0 ? 20 : 20, 4);
  lh.writeUInt16LE(flags, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(0, 10);
  lh.writeUInt16LE(0x5A21, 12);
  lh.writeUInt32LE(0, 14);
  lh.writeUInt32LE(0, 18);
  lh.writeUInt32LE(0, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);

  const dd = Buffer.alloc(16);
  dd.writeUInt32LE(0x08074b50, 0);
  dd.writeUInt32LE(crc, 4);
  dd.writeUInt32LE(comp.length, 8);
  dd.writeUInt32LE(data.length, 12);

  const body = useDD === false
    ? (() => { const h = Buffer.from(lh); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(flags & ~0x0008, 6); return Buffer.concat([h, nameBuf, comp]); })()
    : Buffer.concat([lh, nameBuf, comp, dd]);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(useDD === false ? (flags & ~0x0008) : flags, 8);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(0, 12);
  cen.writeUInt16LE(0x5A21, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt16LE(0, 30);
  cen.writeUInt16LE(0, 32);
  cen.writeUInt16LE(0, 34);
  cen.writeUInt16LE(0, 36);
  cen.writeUInt32LE(0, 38);
  // 本地头偏移稍后回填
  return { local: body, cen: Buffer.concat([cen, nameBuf]), name };
}

const toAdd = [];
if (reuseOriginalIndexEntry) {
  // 原样复用：把官方那条本地头（含压缩数据/描述符）与中央目录记录直接搬过来
  const orig = srcEntries.find((e) => e.name === 'chat_session_index.json');
  // 它后面最近的一个本地头偏移，作为它的数据结束位置
  let end = cenOffset;
  for (const e of srcEntries) {
    if (e.localOff > orig.localOff && e.localOff < end) end = e.localOff;
  }
  toAdd.push({ rawLocal: Buffer.from(src.subarray(orig.localOff, end)), rawCen: Buffer.from(orig.raw), name: 'chat_session_index.json' });
} else {
  toAdd.push({ name: 'chat_session_index.json', buf: newIndexBuf });
}
for (const s of addedSessions) toAdd.push({ name: `chat_sessions/${s.id}.json`, buf: Buffer.from(JSON.stringify(s), 'utf8') });
for (const f of addedFiles) toAdd.push({ name: f.path, buf: f.buf });
console.log(`  追加 ${toAdd.length} 个条目`);

// ---------------------------------------------------------------------------
// 6. 写输出：原字节 + 原中央目录 + 新条目
// ---------------------------------------------------------------------------
const origDataEnd = cenOffset;              // 原文件里"数据 + 旧中央目录"到此为止
const origCenBuf = src.subarray(cenOffset, eocd);

const newLocals = [];
const newCens = [];
// 新条目的数据紧跟在官方数据区之后
let cursor = origDataEnd;

for (const item of toAdd) {
  if (item.rawLocal) {
    // 原样复用：中央目录里的 localOff 需要改指到新位置
    const cen = Buffer.from(item.rawCen);
    cen.writeUInt32LE(cursor, 42);
    newLocals.push(item.rawLocal);
    newCens.push(cen);
    cursor += item.rawLocal.length;
    continue;
  }
  const e = localEntry(item.name, item.buf, true, process.env.INDEX_STORED === '1');
  const cen = Buffer.from(e.cen);
  cen.writeUInt32LE(cursor, 42);            // 回填本地头偏移
  newLocals.push(e.local);
  newCens.push(cen);
  cursor += e.local.length;
}

const newCenBuf = Buffer.concat(newCens);
// ★ 原索引条目必须从原中央目录里剔除，否则同名条目重复 →
//   应用的 o.has(m) 判重会直接拒绝整个文件
const keptCen = srcEntries.filter((e) => e.name !== 'chat_session_index.json').map((e) => e.raw);
const keptCenBuf = Buffer.concat(keptCen);
const totalEntries = keptCen.length + newCens.length;
const cenSizeOut = keptCenBuf.length + newCenBuf.length;
console.log(`  原中央目录 ${srcEntries.length} 条 → 剔除索引后 ${keptCen.length} 条，加新增 ${newCens.length} 条 = ${totalEntries} 条`);

// 新条目数据总长与新的中央目录起点（新条目数据排在中央目录之前）
const newLocalsLen = newLocals.reduce((a, b) => a + b.length, 0);
const newCenOffset = origDataEnd + newLocalsLen;

const eocdOut = Buffer.alloc(22);
eocdOut.writeUInt32LE(EOCD_SIG, 0);
eocdOut.writeUInt16LE(0, 4);
eocdOut.writeUInt16LE(0, 6);
eocdOut.writeUInt16LE(totalEntries, 8);
eocdOut.writeUInt16LE(totalEntries, 10);
eocdOut.writeUInt32LE(cenSizeOut, 12);
eocdOut.writeUInt32LE(newCenOffset, 16);    // ★ 中央目录起点（新条目数据插在它前面）
eocdOut.writeUInt16LE(0, 20);

if (totalEntries > 0xffff) { console.error(`✗ 条目数 ${totalEntries} 超过 65535，需要 ZIP64（应用不支持）`); process.exit(1); }
if (newCenOffset + cenSizeOut > 0xffffffff) { console.error('✗ 中央目录超出 4GB，需要 ZIP64'); process.exit(1); }

/**
 * ★ 布局 ★
 *   [官方数据字节] [新条目数据] [官方中央目录记录(剔除旧索引)] [新中央目录记录] [EOCD]
 *
 * 中央目录起点 = origDataEnd + 新条目数据总长（新条目数据排在中央目录之前）。
 * 官方数据区在文件开头、一字不动，所以官方中央目录里那些 localOff 全部依然有效。
 */
const newLocalsLen2 = 0; // 占位保持下面注释位置
const out = Buffer.concat([
  src.subarray(0, origDataEnd),   // ★ 官方原始数据字节，一字不改
  ...newLocals,                   // 新条目的数据
  keptCenBuf,                     // ★ 官方中央目录记录（仅剔除旧索引），一字不改
  newCenBuf,                      // 新条目的中央目录记录
  eocdOut
]);

// 自检：中央目录起点必须有签名，且"偏移+大小"要正好落在 EOCD 上
{
  const chkEocd = out.length - 22;
  const chkCen = out.readUInt32LE(chkEocd + 16);
  const chkSize = out.readUInt32LE(chkEocd + 12);
  const sigOk = out.readUInt32LE(chkCen) === CEN_SIG;
  console.log('');
  console.log('自检:');
  console.log(`  中央目录偏移+大小 = ${chkCen + chkSize}，EOCD 位置 = ${chkEocd}  ${chkCen + chkSize === chkEocd ? '✅' : '❌'}`);
  console.log(`  中央目录起点签名 = 0x${out.readUInt32LE(chkCen).toString(16)}  ${sigOk ? '✅' : '❌'}`);
  if (chkCen + chkSize !== chkEocd || !sigOk) {
    console.error('✗ 自检失败，输出不可用');
    process.exit(1);
  }
}

writeFileSync(zipOut, out);

console.log('');
console.log('================ 完成 ================');
console.log(`  官方对话    : ${srcIndex.length - addedSessions.length} 个（原有，字节未动）`);
console.log(`  现有对话    : ${addedSessions.length} 个（追加）`);
console.log(`  条目总数    : ${totalEntries}`);
console.log(`  索引总数    : ${srcIndex.length}`);
console.log(`  输出        : ${zipOut}`);
console.log(`  大小        : ${(out.length / 1024 / 1024).toFixed(2)} MB（原包 ${(src.length / 1024 / 1024).toFixed(2)} MB）`);
