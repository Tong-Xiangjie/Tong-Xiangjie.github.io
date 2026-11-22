#!/usr/bin/env node
/**
 * 逐条解压并校验 CRC —— 应用（fflate）会在解压时校验 CRC，
 * 而我原来的 zip-validate-app-rules.mjs 只查头部字段，不查数据本身。
 *
 * 用法: node tools/zip-verify-crc.mjs <file.zip> [只查名字含此子串的条目]
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { crc32 } from './zip-writer.mjs';

const [path, filter] = process.argv.slice(2);
if (!path) { console.error('用法: node tools/zip-verify-crc.mjs <file.zip> [名字过滤]'); process.exit(1); }

const b = readFileSync(path);
let eocd = -1;
for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
  if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { eocd = i; break; }
}
if (eocd < 0) { console.error('✗ 找不到 EOCD'); process.exit(1); }

const n = b.readUInt16LE(eocd + 10);
const cenOff = b.readUInt32LE(eocd + 16);
console.log(`文件: ${path}  ${(b.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`条目: ${n}，中央目录 @${cenOff}`);
console.log('');

let p = cenOff;
let checked = 0, bad = 0, skipped = 0;
const badList = [];

for (let i = 0; i < n; i++) {
  const flags = b.readUInt16LE(p + 8);
  const method = b.readUInt16LE(p + 10);
  const crc = b.readUInt32LE(p + 16);
  const compSize = b.readUInt32LE(p + 20);
  const size = b.readUInt32LE(p + 24);
  const nameLen = b.readUInt16LE(p + 28);
  const extraLen = b.readUInt16LE(p + 30);
  const commentLen = b.readUInt16LE(p + 32);
  const localOff = b.readUInt32LE(p + 42);
  const name = b.toString('utf8', p + 46, p + 46 + nameLen);
  p += 46 + nameLen + extraLen + commentLen;

  if (filter && !name.includes(filter)) continue;

  const hnl = b.readUInt16LE(localOff + 26);
  const hel = b.readUInt16LE(localOff + 28);
  const ds = localOff + 30 + hnl + hel;
  const comp = b.subarray(ds, ds + compSize);

  let data;
  try {
    data = method === 0 ? Buffer.from(comp) : inflateRawSync(comp);
  } catch (e) {
    bad++; badList.push({ name: name.slice(0, 80), why: '解压失败: ' + e.message, method });
    continue;
  }
  checked++;
  if (data.length !== size) {
    bad++; badList.push({ name: name.slice(0, 80), why: `长度不符 解出 ${data.length} != 声明 ${size}`, method });
    continue;
  }
  const c = crc32(data);
  if (c !== crc) {
    bad++; badList.push({ name: name.slice(0, 80), why: `CRC 不符 算出 0x${c.toString(16)} != 声明 0x${crc.toString(16)}`, method });
  }
}

console.log(`检查 ${checked} 条，失败 ${bad} 条` + (filter ? `（过滤: ${filter}）` : ''));
if (badList.length) {
  console.log('');
  console.log('❌ 有问题的条目：');
  for (const x of badList.slice(0, 20)) console.log('   · ' + x.name + '  →  ' + x.why);
  if (badList.length > 20) console.log(`   …还有 ${badList.length - 20} 条`);
} else {
  console.log('✅ 全部解压正确、CRC 一致');
}
process.exit(bad ? 1 : 0);
