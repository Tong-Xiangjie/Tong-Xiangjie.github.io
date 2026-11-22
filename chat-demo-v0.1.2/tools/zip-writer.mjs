#!/usr/bin/env node
/**
 * 手工写 ZIP，不经过 .NET / Compress-Archive。
 *
 * 为什么需要：我所有用 PowerShell + .NET 写出来的 ZIP 都被应用拒绝，
 * 而应用自己导出的官方 ZIP 用了一组很特别的字段组合
 * （flags=0x8 数据描述符、method=0 不压缩的索引文件、verNeeded=20/10）。
 * .NET 写的是另一组（flags=0、全 deflate、CRC 前置）。
 * 要判断"是 .NET 写法的问题"还是"我的数据的问题"，
 * 必须能用另一套完全不同的写法产出同一个包 —— 就是这里。
 *
 * 本文件自己实现 deflate(raw)、CRC32 和全部 ZIP 字段，逐字节可控。
 *
 * 用法（作为模块使用）：
 *   import { writeZip } from './zip-writer.mjs';
 *   writeZip('out.zip', [{ name: 'a.json', data: Buffer|string, method: 8, zip64:false }], opts)
 */

import { writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

// ---- CRC32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 写一个 ZIP。
 *
 * @param {string} outPath
 * @param {Array<{name:string, data:Buffer|string, method?:0|8,
 *                dataDescriptor?:boolean, setUtf8Flag?:boolean}>} entries
 * @param {{versionNeeded?:number, dosTime?:number}} [opts]
 */
export function writeZip(outPath, entries, opts = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.method === 0 ? 0 : 8;
    const compressed = method === 0 ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    // UTF-8 标志位（bit 11）：条目名含非 ASCII 时必须置上，否则应用直接拒绝
    const needsUtf8 = e.setUtf8Flag !== false && nameBuf.some((b) => b > 127);
    // 数据描述符（bit 3）：把 crc/大小放到数据之后，本地头里写 0
    const useDD = e.dataDescriptor === true;

    let flags = 0;
    if (needsUtf8) flags |= 0x0800;
    if (useDD) flags |= 0x0008;

    const versionNeeded = opts.versionNeeded != null ? opts.versionNeeded : useDD ? 20 : 20;
    const dosTime = opts.dosTime != null ? opts.dosTime : 0x5A210000; // 2025-01-11 00:00:00 附近，固定值便于复现

    // ---- 本地头 ----
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(versionNeeded, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime & 0xffff, 10);
    lh.writeUInt16LE((dosTime >>> 16) & 0xffff, 12);
    lh.writeUInt32LE(useDD ? 0 : crc, 14);
    lh.writeUInt32LE(useDD ? 0 : compressed.length, 18);
    lh.writeUInt32LE(useDD ? 0 : data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra 长度 0

    const parts = [lh, nameBuf, compressed];
    // 数据描述符：可选签名 0x08074b50
    if (useDD) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc, 4);
      dd.writeUInt32LE(compressed.length, 8);
      dd.writeUInt32LE(data.length, 12);
      parts.push(dd);
    }
    const localBytes = Buffer.concat(parts);

    // ---- 中央目录记录 ----
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);            // version made by
    ch.writeUInt16LE(versionNeeded, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime & 0xffff, 12);
    ch.writeUInt16LE((dosTime >>> 16) & 0xffff, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);            // extra
    ch.writeUInt16LE(0, 32);            // comment
    ch.writeUInt16LE(0, 34);            // disk number start —— 应用要求必须是 0
    ch.writeUInt16LE(0, 36);            // internal attrs
    ch.writeUInt32LE(0, 38);            // external attrs（不能是符号链接）
    ch.writeUInt32LE(offset, 42);       // 本地头偏移

    locals.push(localBytes);
    centrals.push(Buffer.concat([ch, nameBuf]));
    offset += localBytes.length;
  }

  const cenBuf = Buffer.concat(centrals);
  const cenOffset = offset;
  const cenSize = cenBuf.length;

  // ---- EOCD ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                 // 本盘号
  eocd.writeUInt16LE(0, 6);                 // 中央目录起始盘号
  eocd.writeUInt16LE(entries.length, 8);    // 本盘条目数
  eocd.writeUInt16LE(entries.length, 10);   // 总条目数
  eocd.writeUInt32LE(cenSize, 12);
  eocd.writeUInt32LE(cenOffset, 16);
  eocd.writeUInt16LE(0, 20);                // 注释长度

  const all = Buffer.concat([...locals, cenBuf, eocd]);
  writeFileSync(outPath, all);
  return {
    bytes: all.length,
    entries: entries.length,
    cenOffset,
    cenSize,
    list: entries.map((e) => e.name)
  };
}
