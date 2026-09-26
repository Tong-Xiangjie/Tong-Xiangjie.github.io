/* 顶部定标带 / 气泡列节距的纯几何核算（不开浏览器）。
   用法：node .ref\band_calc.mjs */
const fs = require('fs');
const vm = require('vm');
const ctx = vm.createContext({ window: {}, console });
ctx.window = ctx;
for (const f of ['js/config.js', 'js/geometry.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const G = ctx.AS.geometry, P = ctx.AS.config.PRESETS;

for (const k of ['A4', 'A3']) {
  const p = P[k];
  const faceW = (k === 'A4') ? 210 : 140;
  console.log('\n=== ' + k + '  面宽 ' + faceW + 'mm ===');
  const step = G.topBandStep(p, faceW);
  const b = G.boxOffsets(p), cb = G.contentBox(p, faceW);
  const marks = G.markColumnCenters(p, faceW, 0);
  const cols = G.columnCenters(p, faceW, 0);
  console.log('  顶部方块数        = %d   (要求 29)', marks.length);
  console.log('  节距 step         = %s mm', step);
  console.log('  气泡列距          = %s mm  (与方块距相等: %s)',
    G.choiceStep(p, faceW), G.choiceStep(p, faceW) === step);
  console.log('  网格右移 gridShift= %s mm  (= 一个节距)', G.gridShiftX(p, faceW));
  console.log('  气泡列数          = %d', cols.length);

  const cl = G.r3(cb.left + p.cornerW), cr = G.r3(cb.right - p.cornerW);
  const bl = G.r3(marks[0] - p.blockW / 2);
  const br = G.r3(marks[marks.length - 1] + p.blockW / 2);
  /* 端空隙 = 顶角大方块**外缘**（左角标右缘 / 右角标左缘）→ 首末方块缘 */
  const cornerR = G.r3(p.cornerInsetX + p.cornerW / 2);       // 左角标右缘
  const cornerL = G.r3(faceW - p.cornerInsetX - p.cornerW / 2); // 右角标左缘
  const endGapL = G.r3(bl - cornerR), endGapR = G.r3(cornerL - br);
  const midGap = G.r3(step - p.blockW);
  console.log('  顶角大方块        R缘=%s  L缘=%s', cornerR, cornerL);
  console.log('  带子左右缘        L=%s  R=%s', bl, br);
  console.log('  端空隙  L=%s  R=%s      块间空隙=%s', endGapL, endGapR, midGap);
  const ok = Math.abs(endGapL - midGap) < 0.02 && Math.abs(endGapR - midGap) < 0.02;
  console.log('  ▶ 端空隙 == 块间空隙 : %s', ok ? 'OK' : '** 不等 **');
  console.log('  ▶ 端空隙来源: 首块左缘 %s = 左角标右缘 %s + g %s', bl, cornerR, midGap);
  console.log('  ▶ 第一列 %s == 第二块 %s : %s', cols[0], marks[1],
    Math.abs(cols[0] - marks[1]) < 0.02 ? 'OK' : '** MISMATCH **');
  console.log('  ▶ 带子在纸内: %s', (bl >= 0 && br <= faceW) ? 'OK' : '** 越界 **');

  /* 气泡网格不得越出黑框内容盒 */
  const off = G.boxOffsets(p);
  const blkL = G.r3(cb.left + off.border + off.boxGap + off.border);
  const blkR = G.r3(cb.right - off.border - off.boxGap - off.border);
  const gridL = G.r3(cols[0] - p.blockW / 2);
  const gridR = G.r3(cols[cols.length - 1] + p.blockW / 2);
  console.log('  黑框内容盒        L=%s  R=%s', blkL, blkR);
  console.log('  网格左右缘        L=%s  R=%s', gridL, gridR);
  console.log('  ▶ 网格在黑框内: %s',
    (gridL >= blkL - 0.05 && gridR <= blkR + 0.05) ? 'OK' : '** 溢出 **');
}
