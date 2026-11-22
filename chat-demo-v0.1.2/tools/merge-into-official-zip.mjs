#!/usr/bin/env node
/**
 * 把「现有对话」并进 DeepSeek 官方导出 ZIP，得到一个可被应用原生导入的包。
 *
 * 为什么需要这个：
 *   应用原生的「导入历史对话」会**覆盖全部本地对话和附件**。用户现有对话不能丢，
 *   所以先把现有对话转成官方格式追加进 ZIP，再走原生导入，一次拿到全部。
 *
 * 用法：
 *   node tools/merge-into-official-zip.mjs <官方ZIP> <现有对话导出.json> <输出ZIP>
 *
 * 输出格式必须严格满足应用的 checkArchiveFormat / importArchive：
 *   manifest.json              {"export_format_version":3}
 *   user.json                  原样保留
 *   chat_session_index.json    [{id,title,pinned,message_count,inserted_at,updated_at}]
 *   chat_sessions/<id>.json    {id,title,pinned,current_message_id,inserted_at,updated_at,messages[]}
 *   chat_sessions/<id>_files/  附件
 *
 * 关键约束（来自 static/js/async/925.548cc1b9.js，读代码得到，不是猜的）：
 *   · 版本必须正好是 3（>3 报"过新"，!==3 报"无效"）
 *   · id 过 U()：非空字符串、不含 / 或 \、不是 "." 或 ".."
 *   · inserted_at/updated_at 必须匹配 YYYY-MM-DDTHH:MM:SS[.mmm]Z 且能被 Date 解析回来
 *   · current_message_id 必须是 safe integer >= 0，且指向当前分支末端
 *   · messages 按 id 升序；parent_id 是数字（根为 null）；同 parent 下不能有同 role 的两个子节点
 *   · 附件：**只有 is_image=true 的会被校验 export_path**；export_path 必须
 *     startsWith(`chat_sessions/<sid>_files/`)，且同一路径只能对应一个 file id
 *   · chat_session_index 里每个会话都要有对应 JSON，数量必须一致（否则 backupIncomplete）
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const [zipIn, bundlePath, zipOut] = process.argv.slice(2);
if (!zipIn || !bundlePath || !zipOut) {
  console.error('用法: node tools/merge-into-official-zip.mjs <官方ZIP> <现有对话导出.json> <输出ZIP>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 毫秒 → 官方要求的 ISO 串（必须能被 Date 解析回同一时刻） */
function iso(ms) {
  const d = new Date(typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now());
  return d.toISOString().replace(/\.(\d{3})Z$/, '.$1Z');
}

/** 官方 id 规则：非空、不含斜杠、不是点 */
function safeId(s) {
  const t = String(s == null ? '' : s);
  if (!t || /[/\\]/.test(t) || t === '.' || t === '..') throw new Error('非法 id: ' + JSON.stringify(s));
  return t;
}

/** 附件路径规则：chat_sessions/<sid>_files/<fileId>_<name>，NFC 归一化 */
function attachPath(sid, fileId, name) {
  const clean = (e) => {
    const t = String(e == null ? '' : e).replace(/[/\\]/g, '_');
    return (t === '' || t === '.' || t === '..') ? 'unnamed' : t;
  };
  return `chat_sessions/${sid}_files/${clean(fileId)}_${clean(name)}`.normalize('NFC');
}

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp'
};
function extFor(f) {
  if (f.name && /\.[a-z0-9]{1,8}$/i.test(f.name)) return '';
  return MIME_EXT[f.mimeType] || '';
}

// ---------------------------------------------------------------------------
// 1. 读现有对话导出（我们自己的 chat-demo-export@1 格式）
// ---------------------------------------------------------------------------
console.log('读取现有对话导出…');
// 注意：用户的导出文件可能带 UTF-8 BOM，JSON.parse 会因 \uFEFF 直接报错
let raw = readFileSync(bundlePath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const bundle = JSON.parse(raw);
if (bundle.schema !== 'chat-demo-export@1') {
  console.error('✗ 这不是 chat-demo-export@1 格式（页面「导出」产出的那个）');
  process.exit(1);
}
const localSessions = Array.isArray(bundle.sessions) ? bundle.sessions : [];
const localFiles = new Map();
for (const f of (Array.isArray(bundle.files) ? bundle.files : [])) {
  if (f && f.id) localFiles.set(f.id, f);
}
console.log(`  对话 ${localSessions.length} 个，附件 ${localFiles.size} 个`);

// ---------------------------------------------------------------------------
// 2. 我们的会话 → 官方格式
// ---------------------------------------------------------------------------

/**
 * 把我们的消息链转成官方的 messages[]（数字 id + parent_id 链）。
 *
 * 我们的结构：rootMessageId + 每个消息的 selectedChildId（往后指），id 是字符串。
 * 官方结构：每条消息有数字 id 和数字 parent_id，current_message_id 指向分支末端。
 *
 * 做法：顺 selectedChildId 走出当前分支，按顺序编号 0,1,2…，
 * 父指向 i-1，current_message_id 指向最后一条。
 * 只带当前分支 —— 官方导入器的分支校验很严（同 parent 下同 role 双胞胎会直接
 * 报 backupInvalidBranches 导致整个导入失败），不做无谓的冒险。
 */
function sessionToOfficial(s) {
  const sid = safeId(s.id);
  const byId = new Map();
  for (const m of (s.messages || [])) byId.set(m.id, m);

  const path = [];
  let cur = s.rootMessageId;
  let guard = 0;
  while (cur != null && byId.has(cur) && guard++ < 100000) {
    const m = byId.get(cur);
    path.push(m);
    cur = m.selectedChildId;
  }
  // rootMessageId 缺失时退回第一条
  if (!path.length && (s.messages || []).length) path.push(s.messages[0]);

  const files = [];
  const messages = path.map((m, i) => {
    const isUser = m.role === 'user';
    const fragments = [];

    if (isUser) {
      fragments.push({ type: 'REQUEST', content: typeof m.content === 'string' ? m.content : '' });
      // 附件：官方放在同一消息的 FILE 片段里
      const atts = Array.isArray(m.files) ? m.files : [];
      if (atts.length) {
        const rows = [];
        for (const a of atts) {
          const src = localFiles.get(a.id);
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
          // 只有图片才会被应用校验 export_path —— 非图片不带，避免 backupInvalidFiles
          if (a.isImage && src && src.blobB64) {
            const name = (rec.file_name || rec.id) + extFor(a);
            rec.file_name = name;
            rec.export_path = attachPath(sid, rec.id, name);
            files.push({ path: rec.export_path, b64: src.blobB64 });
          }
          rows.push(rec);
        }
        fragments.push({ type: 'FILE', files: rows });
      }
    } else {
      // 助手：blocks → 官方片段
      const blocks = Array.isArray(m.blocks) ? m.blocks
        : (Array.isArray(m.content) ? m.content : []);
      for (const bl of blocks) {
        if (!bl) continue;
        if (bl.type === 'thinking' && typeof bl.thinking === 'string') {
          fragments.push({ type: 'THINK', content: bl.thinking, elapsed_secs: null });
        } else if (bl.type === 'text' && typeof bl.text === 'string') {
          fragments.push({ type: 'RESPONSE', content: bl.text });
        } else if (bl.type === 'server_tool_use') {
          // 搜索步骤：还原成 TOOL_SEARCH 片段（只保留查询词；
          // 官方导出里 results 恒为空，所以这里也不编造来源）
          const input = bl.input || {};
          const queries = Array.isArray(input.queries) ? input.queries
            : (input.query ? [input.query] : []);
          fragments.push({
            type: 'TOOL_SEARCH',
            queries: queries,
            results: [],
            status: 'FINISHED'
          });
        }
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
      fragments: fragments
    };
  });

  const ts = iso(s.createdAt);
  return {
    session: {
      id: sid,
      title: s.title == null ? '' : String(s.title),
      pinned: false,
      current_message_id: messages.length ? messages[messages.length - 1].id : 0,
      inserted_at: ts,
      updated_at: iso(s.updatedAt),
      messages: messages
    },
    files: files
  };
}

console.log('转换成官方格式…');
const addedSessions = [];
const addedFiles = [];
for (const s of localSessions) {
  try {
    const r = sessionToOfficial(s);
    addedSessions.push(r.session);
    for (const f of r.files) addedFiles.push(f);
  } catch (e) {
    console.log(`  ! 跳过「${s.title}」: ${e.message}`);
  }
}
console.log(`  转出 ${addedSessions.length} 个对话，附件原件 ${addedFiles.length} 个`);

// ---------------------------------------------------------------------------
// 3. 解压官方 ZIP
// ---------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'merge-zip-'));
console.log(`解压官方 ZIP 到临时目录…`);
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zipIn.replace(/'/g, "''")}' -DestinationPath '${work.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

const manPath = join(work, 'manifest.json');
if (!existsSync(manPath)) { console.error('✗ ZIP 里没有 manifest.json'); process.exit(1); }
const man = JSON.parse(readFileSync(manPath, 'utf8'));
console.log(`  manifest: export_format_version=${man.export_format_version}`);
if (man.export_format_version !== 3) {
  console.error(`✗ 版本不是 3（是 ${man.export_format_version}）—— 应用会拒绝`);
  process.exit(1);
}

const idxPath = join(work, 'chat_session_index.json');
const index = JSON.parse(readFileSync(idxPath, 'utf8'));
console.log(`  官方索引: ${index.length} 个对话`);

// ---------------------------------------------------------------------------
// 4. 合并
// ---------------------------------------------------------------------------
console.log('写入现有对话…');
const sessDir = join(work, 'chat_sessions');
if (!existsSync(sessDir)) mkdirSync(sessDir, { recursive: true });

const existingIds = new Set(index.map((e) => e.id));
let added = 0, renamed = 0;
for (const s of addedSessions) {
  let id = s.id;
  while (existingIds.has(id)) {           // 极小概率撞 id，加后缀
    id = s.id + '-local' + (++renamed);
  }
  existingIds.add(id);
  s.id = id;
  writeFileSync(join(sessDir, `${id}.json`), JSON.stringify(s), 'utf8');
  index.push({
    id: id,
    title: s.title,
    pinned: false,
    message_count: s.messages.length,
    inserted_at: s.inserted_at,
    updated_at: s.updated_at
  });
  added++;
}

// 附件字节
let wroteFiles = 0;
for (const f of addedFiles) {
  const abs = join(work, f.path.split('/').join('\\'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(f.b64, 'base64'));
  wroteFiles++;
}
console.log(`  新增 ${added} 个对话，${wroteFiles} 个附件文件`);

writeFileSync(idxPath, JSON.stringify(index), 'utf8');

// ---------------------------------------------------------------------------
// 5. 重新打包
// ---------------------------------------------------------------------------
/**
 * ★ 必须手工写条目，不能图省事用现成命令 ★
 *
 * ZIP 规范要求条目名用**正斜杠**，而 Windows 上两个"方便"的办法都会写成反斜杠：
 *
 *   Compress-Archive                          → [chat_sessions\xxx.json]
 *   ZipFile::CreateFromDirectory              → [chat_sessions\xxx.json]
 *   官方原包                                   → [chat_sessions/xxx.json]
 *
 * 反斜杠的后果很严重：应用解压后按 `/` 切路径，一个会话都找不到。
 * 而且这个错误**不会报错**，导入会"成功"但变成空的。
 *
 * 所以这里用 Node 自己走目录，逐条 CreateEntry，路径手工换成 `/`。
 */
console.log('重新打包 ZIP…');
if (existsSync(zipOut)) rmSync(zipOut, { force: true });

const zipScript = `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = '${work.replace(/'/g, "''")}'
$out  = '${zipOut.replace(/'/g, "''")}'
$fs = [System.IO.File]::Open($out, [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$rootLen = $root.TrimEnd('\\').Length + 1
$n = 0
foreach ($f in [System.IO.Directory]::EnumerateFiles($root, '*', [System.IO.SearchOption]::AllDirectories)) {
  # ★ 关键：手工把反斜杠换成正斜杠
  $rel = $f.Substring($rootLen).Replace('\\', '/')
  $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open()
  $bytes = [System.IO.File]::ReadAllBytes($f)
  $es.Write($bytes, 0, $bytes.Length)
  $es.Dispose()
  $n++
}
$zip.Dispose()
$fs.Dispose()
Write-Host "  写入 $n 个条目"
`;
execFileSync('powershell', ['-NoProfile', '-Command', zipScript], { stdio: 'inherit' });

const outStat = readFileSync(zipOut);
console.log('');
console.log('================ 完成 ================');
console.log(`  官方对话    : ${index.length - added} 个（原有）`);
console.log(`  现有对话    : ${added} 个（并入）`);
console.log(`  索引总数    : ${index.length} 个`);
console.log(`  输出 ZIP    : ${zipOut}`);
console.log(`  大小        : ${(outStat.length / 1024 / 1024).toFixed(1)} MB`);
console.log('');
console.log('下一步：应用里「设置 → 数据管理 → 导入历史对话」，选这个 ZIP，导入后刷新页面。');
console.log('⚠ 原生导入会覆盖当前全部对话 —— 这正是我们把现有对话并进去的原因。');

try { rmSync(work, { recursive: true, force: true }); } catch { }
