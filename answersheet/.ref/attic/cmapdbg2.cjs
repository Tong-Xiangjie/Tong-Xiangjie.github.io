const fs = require('node:fs');
const path = require('node:path');
const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'SimHei.subset.ttf')));
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const numTables = dv.getUint16(4);
let cmapOff = 0;
for (let i = 0; i < numTables; i++) {
  const off = 12 + i * 16;
  const tag = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
  if (tag === 'cmap') { cmapOff = dv.getUint32(off + 8); break; }
}
console.log('cmapOff =', cmapOff, 'version =', dv.getUint16(cmapOff), 'numTables =', dv.getUint16(cmapOff+2));
const n = dv.getUint16(cmapOff + 2);
for (let j = 0; j < n; j++) {
  const rec = cmapOff + 4 + j * 8;
  const pid = dv.getUint16(rec), eid = dv.getUint16(rec + 2);
  const sub = cmapOff + dv.getUint32(rec + 4);
  const fmt = dv.getUint16(sub);
  console.log(`sub ${j}: pid=${pid} eid=${eid} offset=${sub} format=${fmt}`);
  if (fmt === 4) {
    const length = dv.getUint16(sub + 2);
    const lang = dv.getUint16(sub + 4);
    const segX2 = dv.getUint16(sub + 6);
    const seg = segX2 / 2;
    const searchRange = dv.getUint16(sub + 8);
    const entrySel = dv.getUint16(sub + 10);
    const rangeShift = dv.getUint16(sub + 12);
    console.log(`   length=${length} lang=${lang} segCountX2=${segX2} segCount=${seg} searchRange=${searchRange} entrySelector=${entrySel} rangeShift=${rangeShift}`);
    const ends = sub + 14;
    const starts = ends + seg * 2 + 2;
    const deltas = starts + seg * 2;
    const ranges = deltas + seg * 2;
    console.log(`   ends@${ends} starts@${starts} deltas@${deltas} ranges@${ranges} (font len ${bytes.length}, 末段 ranges 需到 ${ranges + seg*2})`);
    let shown = 0, nonzero = 0, mapped = 0;
    for (let s = 0; s < seg; s++) {
      const e = dv.getUint16(ends + s*2), st = dv.getUint16(starts + s*2);
      const ro = dv.getUint16(ranges + s*2), dl = dv.getInt16(deltas + s*2);
      if (shown < 6) { console.log(`   seg ${s}: start=${st} end=${e} idDelta=${dl} idRangeOffset=${ro}`); shown++; }
      if (st === 0xFFFF) continue;
      if (e === 0xFFFF && st === 0xFFFF) continue;
      for (let c = st; c <= e && c !== 0xFFFF; c++) {
        let gi;
        if (ro === 0) { gi = (c + dl) & 0xFFFF; }
        else {
          const idx = ranges + s*2 + ro + (c - st)*2;
          if (idx + 1 >= bytes.length) { gi = 0; }
          else gi = dv.getUint16(idx);
          if (gi !== 0) gi = (gi + dl) & 0xFFFF;
        }
        if (gi !== 0) mapped++;
      }
      if (e !== 0xFFFF) nonzero++;
    }
    console.log(`   非 0xFFFF 段数=${nonzero}  可映射码位=${mapped}`);
  }
}
