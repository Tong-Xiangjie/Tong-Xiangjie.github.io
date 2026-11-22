#!/usr/bin/env node
/**
 * 用同一份 mini 内容生成多种 ZIP 变体，逐个丢给应用导入，找出哪种写法能被接受。
 *
 * 背景：所有用 PowerShell/.NET 写出来的 ZIP 都被应用拒绝，而且是在 ZIP 层就被拒
 * （一个 JSON 都没读到）。官方原包能被应用接受（待确认）。两边字段差异是：
 *   官方: flags=0x8(数据描述符) / method=8 与 0 混用 / verNeeded=20 与 10
 *   我的: flags=0x0 / 全 method=8 / verNeeded=20
 * 所以这里把这几个字段排列组合，用"结构完全一样"的内容跑对照。
 *
 * 用法: node tools/try-zip-variants.mjs <mini源ZIP> [输出目录]
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { writeZip } from './zip-writer.mjs';

const srcZip = process.argv[2];
const outDir = process.argv[3] || mkdtempSync(join(tmpdir(), 'zipvariants-'));
if (!srcZip) { console.error('用法: node tools/try-zip-variants.mjs <mini源ZIP> [输出目录]'); process.exit(1); }

// 解压 mini 源，作为内容素材
const work = mkdtempSync(join(tmpdir(), 'zipvar-src-'));
console.log('解压素材包…');
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${srcZip.replace(/'/g, "''")}' -DestinationPath '${work.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

/** 读取解压目录，返回按"官方顺序"排好的条目：manifest, user, 会话 JSON, 附件 */
function collect(root) {
  const out = [];
  const manifest = join(root, 'manifest.json');
  const user = join(root, 'user.json');
  const idx = join(root, 'chat_session_index.json');
  if (existsSync(manifest)) out.push({ name: 'manifest.json', data: readFileSync(manifest) });
  if (existsSync(user)) out.push({ name: 'user.json', data: readFileSync(user) });
  if (existsSync(idx)) out.push({ name: 'chat_session_index.json', data: readFileSync(idx) });

  const sessDir = join(root, 'chat_sessions');
  if (existsSync(sessDir)) {
    const dirs = [];
    const files = [];
    for (const f of readdirSync(sessDir)) {
      const full = join(sessDir, f);
      if (statSync(full).isDirectory()) dirs.push(f);
      else if (f.endsWith('.json')) files.push(f);
    }
    // 官方顺序：会话 JSON 与附件目录交错，但顺序本身不影响，先会话后附件即可
    for (const f of files.sort()) {
      out.push({ name: `chat_sessions/${f}`, data: readFileSync(join(sessDir, f)), isSession: true });
    }
    for (const d of dirs.sort()) {
      for (const af of readdirSync(join(sessDir, d)).sort()) {
        out.push({ name: `chat_sessions/${d}/${af}`, data: readFileSync(join(sessDir, d, af)), isAttach: true });
      }
    }
  }
  return out;
}

const base = collect(work);
console.log(`素材条目 ${base.length} 个：` + base.map((e) => e.name.split('/').pop()).join(', '));
console.log('');

/**
 * 变体定义。关键差异就是 flags / method / 数据描述符 / verNeeded。
 */
const variants = [
  { key: 'A-official-shape', desc: '完全模仿官方：index/user 用 method=0，其余 deflate，全部带数据描述符', fn: (e) => ({ method: e.name.endsWith('.json') && !e.isSession ? 0 : 8, dataDescriptor: true, verNeed: 20 }) },
  { key: 'B-all-deflate-dd', desc: '全部 deflate + 数据描述符', fn: () => ({ method: 8, dataDescriptor: true, verNeed: 20 }) },
  { key: 'C-all-deflate-nodd', desc: '全部 deflate，无数据描述符（=.NET 的写法）', fn: () => ({ method: 8, dataDescriptor: false, verNeed: 20 }) },
  { key: 'D-index-stored', desc: '全部 deflate 无描述符，但三个元数据 json 用 method=0', fn: (e) => ({ method: (e.name === 'manifest.json' || e.name === 'user.json' || e.name === 'chat_session_index.json') ? 0 : 8, dataDescriptor: false, verNeed: 20 }) },
  { key: 'E-verneed-10-meta', desc: '元数据 method=0 且 verNeeded=10，其余 20，无描述符', fn: (e) => { const meta = ['manifest.json', 'user.json', 'chat_session_index.json'].includes(e.name); return { method: meta ? 0 : 8, dataDescriptor: false, verNeed: meta ? 10 : 20 }; } },
  { key: 'F-official-noattach-dd', desc: '模仿官方（index method=0 + 描述符），但整体用官方 verNeeded 组合', fn: (e) => { const meta = ['manifest.json', 'user.json', 'chat_session_index.json'].includes(e.name); return { method: meta ? 0 : 8, dataDescriptor: true, verNeed: meta ? 10 : 20 }; } }
];

const made = [];
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
for (const v of variants) {
  const entries = base.map((e) => {
    const cfg = v.fn(e);
    return { name: e.name, data: e.data, method: cfg.method, dataDescriptor: cfg.dataDescriptor, setUtf8Flag: true, __verNeed: cfg.verNeed };
  });
  // writeZip 的 versionNeeded 是全局的，这里逐条不一致，所以分两组写不了 ——
  // 改为：如果变体里 verNeeded 不一致，就用 20（对 0/8 方法都安全）
  const verNeeds = new Set(entries.map((e) => e.__verNeed));
  const vn = verNeeds.size === 1 ? [...verNeeds][0] : 20;
  const out = join(outDir, `${v.key}.zip`);
  const info = writeZip(out, entries.map(({ __verNeed, ...rest }) => rest), { versionNeeded: vn });
  made.push({ ...v, out, size: info.bytes, vn });
  console.log(`  ${v.key.padEnd(22)} ${(info.bytes / 1024).toFixed(0).padStart(5)} KB  verNeeded=${vn}  ${v.desc}`);
}

console.log('');
console.log('输出目录: ' + outDir);
console.log('');
console.log('逐个测试命令:');
for (const m of made) {
  console.log(`  node tools/probe-native-import.mjs "${m.out}"`);
}

rmSync(work, { recursive: true, force: true });

export { made };
