// 把 draw.js 的 cmap 解析器按**同样逻辑**独立实现，对照 fontTools
const fs = require('node:fs');
const path = require('node:path');

function cmapCharsOfTTF(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    if (tag === 'cmap') { cmapOff = dv.getUint32(off + 8); break; }
  }
  if (!cmapOff) return { err: 'no cmap', chars: '' };
  const n = dv.getUint16(cmapOff + 2);
  const subs = [];
  for (let j = 0; j < n; j++) {
    const rec = cmapOff + 4 + j * 8;
    const pid = dv.getUint16(rec), eid = dv.getUint16(rec + 2);
    const sub = cmapOff + dv.getUint32(rec + 4);
    const fmt = dv.getUint16(sub);
    subs.push({ pid, eid, sub, fmt });
  }
  // 选 subtable
  let pick = null, best = -1;
  for (const s of subs) {
    if (s.fmt !== 4 && s.fmt !== 12) continue;
    let score = 0;
    if (s.pid === 3 && s.eid === 10) score = 40;
    else if (s.pid === 3 && s.eid === 1) score = 30;
    else if (s.pid === 0) score = 20;
    else if (s.pid === 3 && s.eid === 0) score = 5;
    else continue;
    score += (s.fmt === 12 ? 2 : 1);
    if (score > best) { best = score; pick = s; }
  }
  if (!pick) return { err: 'no usable subtable', chars: '', subs };
  const out = [];
  if (pick.fmt === 4) {
    const segX2 = dv.getUint16(pick.sub + 6) / 2;
    const ends = pick.sub + 14;
    const starts = ends + segX2 * 2 + 2;
    const deltas = starts + segX2 * 2;
    const ranges = deltas + segX2 * 2;
    for (let s = 0; s < segX2; s++) {
      const e = dv.getUint16(ends + s * 2), st = dv.getUint16(starts + s * 2);
      if (st === 0xFFFF) continue;
      const ro = dv.getUint16(ranges + s * 2);
      const dl = dv.getInt16(deltas + s * 2);
      for (let c = st; c <= e && c !== 0xFFFF; c++) {
        const gi = (ro === 0) ? dv.getUint16(ranges + s * 2 + (c - st) * 2) : ((c + dl) & 0xFFFF);
        if (gi !== 0) out.push(c);
      }
    }
  } else {
    const nGroups = dv.getUint32(pick.sub + 12);
    for (let g = 0; g < nGroups; g++) {
      const b = pick.sub + 16 + g * 12;
      const sc = dv.getUint32(b), ec = dv.getUint32(b + 4);
      for (let c = sc; c <= ec && c <= 0x10FFFF; c++) out.push(c);
    }
  }
  return { chars: out.map(c => String.fromCodePoint(c)).join(''), count: out.length, pick, segX2: pick.fmt === 4 ? dv.getUint16(pick.sub + 6) / 2 : null };
}

for (const f of ['SimHei.subset.ttf', 'SimSun.subset.ttf']) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', f)));
  const r = cmapCharsOfTTF(bytes);
  console.log('===', f, '字符数 =', r.count, '子表 =', JSON.stringify((r.subs||[]).map(s => `${s.pid}/${s.eid}/f${s.fmt}`)));
  console.log('   选中 =', JSON.stringify(r.pick), 'segCountX2 =', r.segX2);
  console.log('   前 80 字 =', JSON.stringify((r.chars || '').slice(0, 80)));
  console.log('   含「物理」?', (r.chars || '').includes('物'), (r.chars || '').includes('理'));
}
