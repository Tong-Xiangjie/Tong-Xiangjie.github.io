#!/usr/bin/env node
/**
 * 复刻应用自己的 ZIP 校验规则，逐条检查，指出是哪个条目、哪个字段会被拒。
 *
 * 规则来源：static/js/async/925.548cc1b9.js 里的 j()（中央目录解析）、
 * q()（本地头校验）、B()（路径校验）、G()（条目遍历）。
 *
 * 为什么值得复刻：应用报「文件导入失败，可能是文件格式错误…」时
 * 完全不说哪里不对，而 PowerShell/.NET 读同一个 ZIP 一切正常。
 * 把规则本地化之后就能直接定位，不用反复在浏览器里试。
 *
 * 用法: node tools/zip-validate-app-rules.mjs <file.zip>
 */

import { readFileSync } from 'node:fs';

let buf;
const problems = [];
const warnings = [];

/** 对应应用里的 P()：抛错 */
function fail(where, msg) {
  problems.push(`${where}: ${msg}`);
}

/** 中央目录 / 本地头里读路径的那段（B 函数） */
function checkPath(raw, where) {
  // 应用：UTF-8 fatal 解码 + NFC 归一化；反斜杠/空字节/盘符 → 报错
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(raw).normalize('NFC');
  } catch (e) {
    fail(where, '路径不是合法 UTF-8');
    return null;
  }
  if (s.includes('\\')) fail(where, `路径含反斜杠: ${JSON.stringify(s)}`);
  if (s.includes('\0')) fail(where, '路径含空字节');
  if (/^[A-Za-z]:/.test(s)) fail(where, `路径是盘符开头: ${JSON.stringify(s)}`);
  const parts = (s.endsWith('/') ? s.slice(0, -1) : s).split('/');
  for (const seg of parts) {
    if (!seg || seg === '.' || seg === '..') { fail(where, `路径含空段/. /.. : ${JSON.stringify(s)}`); break; }
  }
  return s;
}

function main(path) {
  buf = readFileSync(path);
  console.log(`文件: ${path}`);
  console.log(`大小: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log('');

  // ---- j(): 找 EOCD ----
  if (buf.length < 22) { fail('EOCD', '文件小于 22 字节'); return; }
  const tailStart = Math.max(0, buf.length - 22 - 65535);
  let searchFrom = buf.length - 22;
  let a = -1;
  while (searchFrom >= tailStart) {
    if (buf.readUInt32LE(searchFrom) === 0x06054b50) {
      const clen = buf.readUInt16LE(searchFrom + 20);
      if (searchFrom + 22 + clen === buf.length) { a = searchFrom; break; }
    }
    searchFrom--;
  }
  if (a < 0) { fail('EOCD', '找不到签名正确、且注释长度与文件尾对齐的 EOCD'); return; }
  console.log(`EOCD 位置: ${a}（距文件尾 ${buf.length - a} 字节）`);

  const totalEntries = buf.readUInt16LE(a + 10);
  const cenSize = buf.readUInt32LE(a + 12);
  const cenOff = buf.readUInt32LE(a + 16);
  const diskNo = buf.readUInt16LE(a + 4);
  const diskCen = buf.readUInt16LE(a + 6);
  const diskEntries = buf.readUInt16LE(a + 8);

  console.log(`  条目数(本盘) : ${diskEntries}`);
  console.log(`  条目数(总)   : ${totalEntries}`);
  console.log(`  中央目录大小 : ${cenSize}`);
  console.log(`  中央目录偏移 : ${cenOff}`);
  console.log('');

  // 应用这一串条件任何一个成立就 P()
  if (diskNo !== 0) fail('EOCD', `本盘号必须为 0，实际 ${diskNo}`);
  if (diskCen !== 0) fail('EOCD', `中央目录起始盘号必须为 0，实际 ${diskCen}`);
  if (diskEntries !== totalEntries) fail('EOCD', `本盘条目数 ${diskEntries} != 总条目数 ${totalEntries}`);
  if (totalEntries === 0xffff) fail('EOCD', '条目数是 0xFFFF（需要 ZIP64，应用不支持）');
  if (cenSize === 0xffffffff) fail('EOCD', '中央目录大小是 0xFFFFFFFF（需要 ZIP64）');
  if (cenOff === 0xffffffff) fail('EOCD', '中央目录偏移是 0xFFFFFFFF（需要 ZIP64）');
  if (cenOff + cenSize !== a) {
    fail('EOCD', `中央目录偏移+大小 (${cenOff + cenSize}) != EOCD 绝对位置 (${a})`);
  }

  // ---- 走中央目录 ----
  const entries = [];
  const seenPaths = new Set();
  let c = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (c + 46 > cenSize) { fail('中央目录', `第 ${i} 条: 读头部超出中央目录范围`); break; }
    const t = buf.subarray(cenOff + c, cenOff + c + 46);
    if (t.readUInt32LE(0) !== 0x02014b50) { fail('中央目录', `第 ${i} 条: 签名不是 0x02014b50`); break; }

    const flags = t.readUInt16LE(8);
    const method = t.readUInt16LE(10);
    const crc = t.readUInt32LE(16);
    const compSize = t.readUInt32LE(20);
    const size = t.readUInt32LE(24);
    const nameLen = t.readUInt16LE(28);
    const extraLen = t.readUInt16LE(30);
    const commentLen = t.readUInt16LE(32);
    const diskStart = t.readUInt16LE(34);
    const extAttr = t.readUInt32LE(38);
    const localOff = t.readUInt32LE(42);
    const recLen = 46 + nameLen + extraLen + commentLen;
    const recEnd = c + recLen;

    const nameRaw = buf.subarray(cenOff + c + 46, cenOff + c + 46 + nameLen);
    const where = `第 ${i} 条 <${nameRaw.toString('utf8').slice(0, 60)}>`;

    // 应用原文: (-2063 & s) —— 注意 -2063 的 16 位补码是 0xDF9，即允许
    // bit0(加密)、bit1/2(压缩级别)、bit3(数据描述符)、bit4-7、bit11(UTF-8)。
    // 千万别写成 0x2063（那正好把 bit3 当成禁位，官方包会被误判）。
    const ALLOWED_FLAGS = 0xDF9;
    if ((flags & ~ALLOWED_FLAGS) !== 0) {
      fail(where, `flags=0x${flags.toString(16)} 含应用不接受的位（允许 0x${ALLOWED_FLAGS.toString(16)}）`);
    }
    if (method !== 0 && method !== 8) fail(where, `压缩方法 ${method} 不是 0(stored) 或 8(deflate)`);
    if (compSize === 0xffffffff) fail(where, '压缩大小是 0xFFFFFFFF（ZIP64）');
    if (size === 0xffffffff) fail(where, '原始大小是 0xFFFFFFFF（ZIP64）');
    // method=0 时 compSize 必须等于 size（压缩=原始）。
    // 注意：官方的 stored 条目满足这一点（未压缩），但它们的 crc 当然不等于 size ——
    // 我一开始把规则误读成 crc===size，结果把官方包 1000 个条目全判成错的。
    if (method === 0 && compSize !== size) {
      fail(where, `method=0 但压缩大小 ${compSize} != 原始大小 ${size}`);
    }
    if (localOff >= cenOff) fail(where, `本地头偏移 ${localOff} >= 中央目录偏移 ${cenOff}`);
    if (diskStart !== 0) fail(where, `diskStart=${diskStart}（应用要求 0）`);
    if (((extAttr >>> 16) & 0xF000) === 0xA000) fail(where, '外部属性标成符号链接');
    if (recEnd > cenSize) fail(where, `条目记录结束 ${recEnd} 超出中央目录 ${cenSize}`);

    const p = checkPath(nameRaw, where);
    if (p != null) {
      const key = p.endsWith('/') ? p.slice(0, -1) : p;
      if (seenPaths.has(key)) fail(where, `路径重复: ${JSON.stringify(key)}`);
      seenPaths.add(key);
    }

    entries.push({ idx: i, name: p, nameRaw, flags, method, crc, compSize, size, localOff, raw: buf.subarray(cenOff + c, cenOff + recEnd) });
    c = recEnd;
  }
  if (c !== cenSize) fail('中央目录', `解析结束位置 ${c} != 中央目录大小 ${cenSize}`);
  console.log(`解析条目: ${entries.length} / 声明 ${totalEntries}`);
  console.log('');

  // ---- q(): 逐条校验本地头 ----
  const byOffset = entries.slice().sort((x, y) => x.localOff - y.localOff);
  for (let i = 0; i < byOffset.length; i++) {
    const e = byOffset[i];
    const where = `本地头 #${e.idx} <${(e.name || '').slice(0, 50)}>`;
    const limit = (byOffset[i + 1] ? byOffset[i + 1].localOff : cenOff);

    if (e.localOff + 30 > limit) { fail(where, `本地头超出范围`); continue; }
    const h = buf.subarray(e.localOff, e.localOff + 30);
    if (h.readUInt32LE(0) !== 0x04034b50) { fail(where, '本地头签名不是 0x04034b50'); continue; }
    const hFlags = h.readUInt16LE(6);
    const hMethod = h.readUInt16LE(8);
    const hNameLen = h.readUInt16LE(26);
    const hExtraLen = h.readUInt16LE(28);
    const dataStart = e.localOff + 30 + hNameLen + hExtraLen;
    const dataEnd = dataStart + e.compSize;

    if (hFlags !== e.flags) fail(where, `本地头 flags 0x${hFlags.toString(16)} != 中央目录 0x${e.flags.toString(16)}`);
    if (hMethod !== e.method) fail(where, `本地头 method ${hMethod} != 中央目录 ${e.method}`);
    if (hNameLen !== e.nameRaw.length) fail(where, `本地头文件名长度 ${hNameLen} != 中央目录 ${e.nameRaw.length}`);
    if (dataEnd > limit) fail(where, `数据结束位置 ${dataEnd} 超出下一条目起点 ${limit}`);

    // 三个字段：0 或与中央目录一致
    for (const [off, label, want] of [[14, 'crc', e.crc], [18, '压缩大小', e.compSize], [22, '原始大小', e.size]]) {
      const got = h.readUInt32LE(off);
      if (got === want) continue;
      if ((e.flags & 0x08) && got === 0) continue;
      fail(where, `本地头 ${label} ${got} != 中央目录 ${want}（且 flags 未置数据描述符位）`);
    }

    // 数据描述符
    if (e.flags & 0x08) {
      if (dataEnd + 12 > limit) fail(where, '数据描述符超出范围');
      else {
        const d = buf.subarray(dataEnd, Math.min(dataEnd + 16, limit));
        const skip = d.readUInt32LE(0) === 0x08074b50 ? 4 : 0;
        if (skip + 12 > d.length) fail(where, '数据描述符读不全');
        else if (d.readUInt32LE(skip) !== e.crc || d.readUInt32LE(skip + 4) !== e.compSize || d.readUInt32LE(skip + 8) !== e.size) {
          fail(where, '数据描述符里的 crc/大小与中央目录不一致');
        }
      }
    }
  }

  // ---- 汇总 ----
  console.log('================ 结果 ================');
  if (!problems.length) {
    console.log('✅ 按应用自己的规则逐条检查：全部通过');
  } else {
    console.log(`❌ 发现 ${problems.length} 个会被应用拒绝的问题：`);
    for (const p of problems.slice(0, 40)) console.log('   · ' + p);
    if (problems.length > 40) console.log(`   …还有 ${problems.length - 40} 条`);
  }
  if (warnings.length) {
    console.log('');
    for (const w of warnings) console.log('   ! ' + w);
  }

  // 统计
  const methods = new Map(), flagSet = new Map(), sizes = entries.map((e) => e.size);
  for (const e of entries) {
    methods.set(e.method, (methods.get(e.method) || 0) + 1);
    flagSet.set(e.flags, (flagSet.get(e.flags) || 0) + 1);
  }
  console.log('');
  console.log('统计:');
  console.log('  压缩方法 : ' + [...methods].map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  flags    : ' + [...flagSet].map(([k, v]) => `0x${k.toString(16)}=${v}`).join(', '));
  console.log('  最大条目 : ' + (Math.max(...sizes) / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  最大压缩 : ' + (Math.max(...entries.map((e) => e.compSize)) / 1024 / 1024).toFixed(2) + ' MB');

  process.exit(problems.length ? 1 : 0);
}

main(process.argv[2]);
