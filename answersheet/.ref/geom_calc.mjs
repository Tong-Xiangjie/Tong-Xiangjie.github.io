/* 在 Node 里直接跑 geometry.js，把关键推导量打出来（不起浏览器）。
   用法：node .ref\geom_calc.mjs [A4|A3] */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fmt = process.argv[2] || 'A4';
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);

for (const f of ['js/config.js', 'js/geometry.js']) {
  vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f });
}
const C = ctx.window.AS.config;
const G = ctx.window.AS.geometry;
const p = C.PRESETS[fmt];
const paper = C.PAPER[fmt];
const n = fmt === 'A3' ? C.A3_COLUMNS : 1;
const faceW = paper.w / n;

console.log('格式 %s  纸宽 %s  面数 %s  面宽 %s', fmt, paper.w, n, faceW);
console.log('preset:', JSON.stringify(p));
console.log('boxOffsets:', JSON.stringify(G.boxOffsets(p)));
console.log('contentBox(faceW=%s):', faceW, JSON.stringify(G.contentBox(p, faceW)));
console.log('gridShiftX=%s  markShiftX=%s', G.gridShiftX(p), G.markShiftX(p));
console.log('columnsPerLine =', G.columnsPerLine(p, faceW));
console.log('gridLeft =', G.gridLeft(p, faceW));
console.log('markColCenters 前 4 =', G.markColumnCenters(p, faceW).slice(0, 4));
console.log('colCenters 前 4 =', G.columnCenters(p, faceW).slice(0, 4));
console.log('columnHeight =', G.columnHeight(p), ' lineGapH =', G.lineGapH(p),
            ' lineHeight =', G.lineHeight(p));
