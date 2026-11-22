#!/usr/bin/env node
/**
 * 从官方导出 ZIP 里裁出一个"结构完全一样但很小"的 ZIP，用来做对照实验。
 *
 * 目的：把「内容不对」和「体积太大」这两类原因分开。
 * 如果这个小包能导入成功 → 说明格式是对的，问题在体积；
 * 如果也失败 → 说明是内容/结构问题。
 *
 * 因为 importArchive 要求索引里的 id 集合与 ZIP 里的会话 JSON 集合**完全一致**，
 * 裁剪时必须同时裁索引和会话文件，不能只删文件。
 *
 * 用法: node tools/make-mini-archive.mjs <官方ZIP> <输出ZIP> [会话数=3] [是否带附件=0|1]
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const [zipIn, zipOut, nSessionsArg, withAttachArg] = process.argv.slice(2);
if (!zipIn || !zipOut) {
  console.error('用法: node tools/make-mini-archive.mjs <官方ZIP> <输出ZIP> [会话数=3] [带附件=0|1]');
  process.exit(1);
}
const N = Math.max(1, parseInt(nSessionsArg || '3', 10));
const withAttach = String(withAttachArg || '0') === '1';

const work = mkdtempSync(join(tmpdir(), 'mini-archive-'));
console.log(`解压官方 ZIP…（${zipIn}）`);
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zipIn.replace(/'/g, "''")}' -DestinationPath '${work.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

const idxPath = join(work, 'chat_session_index.json');
const index = JSON.parse(readFileSync(idxPath, 'utf8'));
console.log(`  官方索引 ${index.length} 条`);

// 挑前 N 条（前几条通常带附件，便于测附件路径）
const keep = index.slice(0, N);
const keepIds = new Set(keep.map((e) => e.id));

// 删掉不在 keep 里的会话 JSON
const sessDir = join(work, 'chat_sessions');
let removedSess = 0, removedDirs = 0;
for (const f of readdirSync(sessDir)) {
  const full = join(sessDir, f);
  const st = statSync(full);
  if (st.isDirectory()) {
    const sid = f.replace(/_files$/, '');
    if (!keepIds.has(sid) || (!withAttach && process.env.KEEP_EXPORT_PATH !== '1')) {
      rmSync(full, { recursive: true, force: true });
      removedDirs++;
    }
    continue;
  }
  if (f.endsWith('.json')) {
    const sid = f.slice(0, -5);
    if (!keepIds.has(sid)) { rmSync(full, { force: true }); removedSess++; }
  }
}
console.log(`  删除 ${removedSess} 个会话 JSON，${removedDirs} 个附件目录`);

// 如果不带附件，还要把会话 JSON 里图片的 export_path 清掉，
// 否则 importArchive 会去要那些文件而找不到 → backupIncomplete
if (!withAttach && process.env.KEEP_EXPORT_PATH !== '1') {
  for (const e of keep) {
    const p = join(sessDir, `${e.id}.json`);
    if (!existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, 'utf8'));
    let cleared = 0;
    for (const m of (s.messages || [])) {
      for (const fr of (m.fragments || [])) {
        if (fr.type !== 'FILE') continue;
        for (const fl of (fr.files || [])) {
          if (fl.export_path) { fl.export_path = null; cleared++; }
        }
      }
    }
    if (cleared) writeFileSync(p, JSON.stringify(s), 'utf8');
  }
  console.log('  已清空附件引用（不带附件模式）');
}

// 索引裁剪
writeFileSync(idxPath, JSON.stringify(keep), 'utf8');
console.log(`  索引裁到 ${keep.length} 条`);

// 打包：条目名必须正斜杠（用和 merge 工具同样的手工写法）
console.log('打包…');
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

const sz = readFileSync(zipOut).length;
console.log('');
console.log('================ 完成 ================');
console.log(`  输出: ${zipOut}`);
console.log(`  大小: ${(sz / 1024 / 1024).toFixed(2)} MB`);
console.log(`  会话: ${keep.length} 个，附件: ${withAttach ? '带' : '不带'}`);
console.log('');
console.log('下一步: node tools/probe-native-import.mjs "' + zipOut + '"');

rmSync(work, { recursive: true, force: true });
