#!/usr/bin/env node
/**
 * 逐字段对比两个 ZIP 的中央目录，找出让 JS 解压库读不出来的差异。
 *
 * 为什么需要：应用报"文件格式错误"，但 PowerShell/.NET 都能正常打开我的 ZIP。
 * 说明差异在 ZIP 的**字段层面**（标志位、版本、压缩方法、ZIP64 等），
 * 而不是"能不能打开"。所以这里自己解析，不依赖任何库。
 *
 * 用法: node tools/zip-probe.mjs <a.zip> [b.zip]
 */

import { readFileSync } from 'node:fs';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;

function probe(path) {
  const buf = readFileSync(path);
  const out = { path, size: buf.length, entries: [], notes: [] };

  // 从尾部找 EOCD（最多找 64KB，因为可能有注释）
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) { out.notes.push('找不到 EOCD —— 不是有效 ZIP'); return out; }

  out.diskEntries = buf.readUInt16LE(eocd + 10);
  out.totalEntries = buf.readUInt16LE(eocd + 8);
  out.cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffsetRaw = buf.readUInt32LE(eocd + 16);
  out.cenOffsetRaw = cenOffsetRaw;
  out.commentLen = buf.readUInt16LE(eocd + 20);

  // ZIP64：EOCD 里的偏移/数量是 0xFFFF/0xFFFFFFFF 时要去 ZIP64 EOCD 取
  let cenOffset = cenOffsetRaw;
  const eocd64Loc = eocd - 20;
  if (eocd64Loc >= 0 && buf.readUInt32LE(eocd64Loc) === EOCD64_LOC) {
    const e64 = Number(buf.readBigUInt64LE(eocd64Loc + 8));
    if (e64 >= 0 && e64 + 56 <= buf.length && buf.readUInt32LE(e64) === EOCD64_SIG) {
      out.notes.push('存在 ZIP64 EOCD');
      out.hasZip64Eocd = true;
      const n = Number(buf.readBigUInt64LE(e64 + 32));
      const sz = Number(buf.readBigUInt64LE(e64 + 40));
      const off = Number(buf.readBigUInt64LE(e64 + 48));
      out.zip64TotalEntries = n;
      out.zip64CenSize = sz;
      out.zip64CenOffset = off;
      if (cenOffsetRaw === 0xFFFFFFFF || out.totalEntries === 0xFFFF) cenOffset = off;
    }
  }
  if (cenOffsetRaw === 0xFFFFFFFF) out.notes.push('⚠ EOCD 偏移是 0xFFFFFFFF（需要 ZIP64）');
  if (out.totalEntries === 0xFFFF) out.notes.push('⚠ EOCD 条目数是 0xFFFF（需要 ZIP64）');

  // 走中央目录
  let p = cenOffset;
  let count = 0;
  while (count < 200000 && p + 46 <= buf.length && buf.readUInt32LE(p) === CEN_SIG) {
    const e = {};
    e.versionMadeBy = buf.readUInt16LE(p + 4);
    e.versionNeeded = buf.readUInt16LE(p + 6);
    e.flags = buf.readUInt16LE(p + 8);
    e.method = buf.readUInt16LE(p + 10);
    e.crc = buf.readUInt32LE(p + 16);
    e.compSize = buf.readUInt32LE(p + 20);
    e.size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    e.name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    e.localOff = localOff;
    e.extraLen = extraLen;
    e.hasZip64Extra = false;
    // 扫 extra 字段找 ZIP64 (0x0001)
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const hid = buf.readUInt16LE(x);
      const hsz = buf.readUInt16LE(x + 2);
      if (hid === 0x0001) e.hasZip64Extra = true;
      x += 4 + hsz;
    }
    out.entries.push(e);
    p = p + 46 + nameLen + extraLen + commentLen;
    count++;
  }
  out.parsedEntries = count;

  // 汇总
  const flags = new Set(), methods = new Set(), verNeeded = new Set();
  let utf8Flag = 0, zip64Extra = 0, dataDesc = 0;
  for (const e of out.entries) {
    flags.add(e.flags); methods.add(e.method); verNeeded.add(e.versionNeeded);
    if (e.flags & 0x0800) utf8Flag++;
    if (e.hasZip64Extra) zip64Extra++;
    if (e.flags & 0x0008) dataDesc++;
  }
  out.summary = {
    uniqueFlags: [...flags].map((f) => '0x' + f.toString(16)),
    uniqueMethods: [...methods],
    uniqueVersionNeeded: [...verNeeded],
    utf8FlagCount: utf8Flag,
    zip64ExtraCount: zip64Extra,
    dataDescriptorCount: dataDesc,
    sampleNames: out.entries.slice(0, 3).map((e) => e.name),
    nonAsciiNames: out.entries.filter((e) => /[^\x00-\x7F]/.test(e.name)).slice(0, 3).map((e) => e.name),
    nonAsciiCount: out.entries.filter((e) => /[^\x00-\x7F]/.test(e.name)).length
  };

  // 检查第一个条目能不能按本地头正确解出（只验证结构，不做 inflate）
  if (out.entries.length) {
    const e0 = out.entries[0];
    if (e0.localOff + 30 <= buf.length) {
      const sig = buf.readUInt32LE(e0.localOff);
      out.firstLocalHeaderOk = sig === 0x04034b50;
      if (out.firstLocalHeaderOk) {
        out.firstLocalName = buf.toString('utf8', e0.localOff + 30, e0.localOff + 30 + buf.readUInt16LE(e0.localOff + 26));
      }
    }
  }
  return out;
}

const [a, b] = process.argv.slice(2);
if (!a) { console.error('用法: node tools/zip-probe.mjs <a.zip> [b.zip]'); process.exit(1); }

const ra = probe(a);
console.log('================ A: ' + ra.path);
console.log('  大小            : ' + (ra.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('  EOCD 声明条目数 : ' + ra.totalEntries + '  实际解析: ' + ra.parsedEntries);
console.log('  EOCD 中央目录偏移: ' + ra.cenOffsetRaw + (ra.cenOffsetRaw === 0xFFFFFFFF ? '  ★ZIP64' : ''));
console.log('  ZIP64 EOCD      : ' + (ra.hasZip64Eocd ? '有' : '无') + (ra.zip64TotalEntries != null ? '  条目数=' + ra.zip64TotalEntries : ''));
console.log('  备注            : ' + (ra.notes.join('; ') || '（无）'));
if (ra.summary) {
  console.log('  唯一 flags      : ' + ra.summary.uniqueFlags.join(', '));
  console.log('  唯一 method     : ' + ra.summary.uniqueMethods.join(', '));
  console.log('  唯一 verNeeded  : ' + ra.summary.uniqueVersionNeeded.join(', '));
  console.log('  UTF-8 标志条目  : ' + ra.summary.utf8FlagCount + ' / ' + ra.parsedEntries);
  console.log('  ZIP64 extra 条目: ' + ra.summary.zip64ExtraCount);
  console.log('  数据描述符条目  : ' + ra.summary.dataDescriptorCount);
  console.log('  非 ASCII 名条目 : ' + ra.summary.nonAsciiCount);
  if (ra.summary.nonAsciiNames.length) console.log('    例: ' + ra.summary.nonAsciiNames.join(' | '));
  console.log('  前 3 个名字     : ' + ra.summary.sampleNames.join(' | '));
  console.log('  首个本地头 OK   : ' + ra.firstLocalHeaderOk + '  名字=' + ra.firstLocalName);
}

if (b) {
  const rb = probe(b);
  console.log('');
  console.log('================ B: ' + rb.path);
  console.log('  大小            : ' + (rb.size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  EOCD 声明条目数 : ' + rb.totalEntries + '  实际解析: ' + rb.parsedEntries);
  console.log('  EOCD 中央目录偏移: ' + rb.cenOffsetRaw + (rb.cenOffsetRaw === 0xFFFFFFFF ? '  ★ZIP64' : ''));
  console.log('  ZIP64 EOCD      : ' + (rb.hasZip64Eocd ? '有' : '无') + (rb.zip64TotalEntries != null ? '  条目数=' + rb.zip64TotalEntries : ''));
  console.log('  备注            : ' + (rb.notes.join('; ') || '（无）'));
  if (rb.summary) {
    console.log('  唯一 flags      : ' + rb.summary.uniqueFlags.join(', '));
    console.log('  唯一 method     : ' + rb.summary.uniqueMethods.join(', '));
    console.log('  唯一 verNeeded  : ' + rb.summary.uniqueVersionNeeded.join(', '));
    console.log('  UTF-8 标志条目  : ' + rb.summary.utf8FlagCount + ' / ' + rb.parsedEntries);
    console.log('  ZIP64 extra 条目: ' + rb.summary.zip64ExtraCount);
    console.log('  数据描述符条目  : ' + rb.summary.dataDescriptorCount);
    console.log('  非 ASCII 名条目 : ' + rb.summary.nonAsciiCount);
    if (rb.summary.nonAsciiNames.length) console.log('    例: ' + rb.summary.nonAsciiNames.join(' | '));
    console.log('  前 3 个名字     : ' + rb.summary.sampleNames.join(' | '));
    console.log('  首个本地头 OK   : ' + rb.firstLocalHeaderOk + '  名字=' + rb.firstLocalName);
  }

  console.log('');
  console.log('================ 差异 ================');
  const keys = ['totalEntries', 'parsedEntries', 'cenOffsetRaw', 'hasZip64Eocd', 'zip64TotalEntries'];
  for (const k of keys) {
    if (String(ra[k]) !== String(rb[k])) console.log(`  ${k}: A=${ra[k]}  B=${rb[k]}`);
  }
  if (ra.summary && rb.summary) {
    for (const k of Object.keys(ra.summary)) {
      if (k === 'sampleNames' || k === 'nonAsciiNames') continue;
      if (String(ra.summary[k]) !== String(rb.summary[k])) {
        console.log(`  summary.${k}: A=${ra.summary[k]}  B=${rb.summary[k]}`);
      }
    }
  }
  // 逐个条目比较前 3 个的 flags/method/verNeeded
  console.log('');
  console.log('  逐条目前 3 个对比（官方 → 我的）:');
  for (let i = 0; i < Math.min(3, ra.entries.length, rb.entries.length); i++) {
    const x = ra.entries[i], y = rb.entries[i];
    console.log(`    [${i}] 官方 flags=0x${x.flags.toString(16)} method=${x.method} verNeed=${x.versionNeeded} zip64=${x.hasZip64Extra}`);
    console.log(`        我的 flags=0x${y.flags.toString(16)} method=${y.method} verNeed=${y.versionNeeded} zip64=${y.hasZip64Extra}`);
    if (x.name !== y.name) console.log(`        名字不同: <${x.name}> vs <${y.name}>`);
  }
}
