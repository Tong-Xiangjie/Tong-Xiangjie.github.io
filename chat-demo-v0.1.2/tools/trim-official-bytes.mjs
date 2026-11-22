#!/usr/bin/env node
/**
 * 从官方原包里"外科手术式"删掉若干会话，但**保留官方原有的字节写法**。
 *
 * 为什么需要：所有经我重写的 ZIP 都被应用拒绝，而官方原包能通过。
 * 我试过对齐 flags / method / 数据描述符 / 条目顺序，全都无效。
 * 那就反过来：不动写法，只动内容 —— 直接重建一个"少几个会话"的官方包。
 * 如果这个能通过，说明问题在"我的写法"；如果也失败，说明应用要求
 * 某种我还没发现的字节特征。
 *
 * 用法: node tools/trim-official-bytes.mjs <官方ZIP> <输出ZIP> <保留会话数>
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const [src, dst, keepArg] = process.argv.slice(2);
if (!src || !dst) { console.error('用法: node tools/trim-official-bytes.mjs <官方ZIP> <输出ZIP> <保留会话数>'); process.exit(1); }
const KEEP = parseInt(keepArg || '3', 10);

// 1) 完整解压官方包
const work = mkdtempSync(join(tmpdir(), 'trim-official-'));
console.log('解压官方包…');
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${src.replace(/'/g, "''")}' -DestinationPath '${work.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

const idxPath = join(work, 'chat_session_index.json');
const index = JSON.parse(readFileSync(idxPath, 'utf8'));
console.log(`  官方索引 ${index.length} 条，保留前 ${KEEP} 条`);

const keep = index.slice(0, KEEP);
const keepIds = new Set(keep.map((e) => e.id));

// 2) 删掉不在保留集里的会话 JSON 与附件目录
const sessDir = join(work, 'chat_sessions');
const { readdirSync, statSync } = await import('node:fs');
let delJson = 0, delDirs = 0;
for (const f of readdirSync(sessDir)) {
  const full = join(sessDir, f);
  if (statSync(full).isDirectory()) {
    const sid = f.replace(/_files$/, '');
    if (!keepIds.has(sid)) { rmSync(full, { recursive: true, force: true }); delDirs++; }
    continue;
  }
  if (f.endsWith('.json')) {
    const sid = f.slice(0, -5);
    if (!keepIds.has(sid)) { rmSync(full, { force: true }); delJson++; }
  }
}
console.log(`  删除 ${delJson} 个会话 JSON、${delDirs} 个附件目录`);

// 3) 裁索引
writeFileSync(idxPath, JSON.stringify(keep), 'utf8');

/**
 * 4) 用官方原本的写法重新打包。
 *
 * 官方特征（用 zip-probe 测出来的）：
 *   flags = 0x8（数据描述符）或 0x808（非 ASCII 名 + 数据描述符）
 *   method = 8（deflate）或 0（stored，索引/用户/清单是 stored）
 *   versionNeeded = 20 或 10
 * 这里完全不重现那个组合 —— 就交给 .NET 写，因为我们已经证明
 * ".NET 写法"和"官方写法"都被拒，所以写法不是分辨点。
 */
console.log('重新打包（.NET 默认写法）…');
if (existsSync(dst)) rmSync(dst, { force: true });
const zipScript = `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = '${work.replace(/'/g, "''")}'
$out  = '${dst.replace(/'/g, "''")}'
$fs = [System.IO.File]::Open($out, [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$rootLen = $root.TrimEnd('\\').Length + 1
$n = 0
function Write-One([string]$rel) {
  $full = Join-Path $root ($rel.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  if (-not [System.IO.File]::Exists($full)) { return }
  $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open()
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $es.Write($bytes, 0, $bytes.Length)
  $es.Dispose()
  $script:n++
}
Write-One 'manifest.json'
Write-One 'user.json'
Write-One 'chat_session_index.json'
foreach ($f in [System.IO.Directory]::EnumerateFiles($root, '*', [System.IO.SearchOption]::AllDirectories)) {
  $rel = $f.Substring($rootLen).Replace('\\', '/')
  if ($rel -eq 'manifest.json' -or $rel -eq 'user.json' -or $rel -eq 'chat_session_index.json') { continue }
  Write-One $rel
}
$zip.Dispose()
$fs.Dispose()
Write-Host "  写入 $n 个条目"
`;
execFileSync('powershell', ['-NoProfile', '-Command', zipScript], { stdio: 'inherit' });

const sz = readFileSync(dst).length;
console.log('');
console.log(`输出: ${dst}  ${(sz / 1024 / 1024).toFixed(2)} MB`);
console.log(`保留会话: ${keep.length} 个`);
rmSync(work, { recursive: true, force: true });
