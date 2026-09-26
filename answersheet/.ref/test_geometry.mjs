/* Node harness: load the browser modules under a fake `window`, verify the
 * geometry self-test passes, and print the computed layout in mm. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const win = {};
globalThis.window = win;
for (const f of ['js/config.js', 'js/geometry.js']) {
  new Function('window', readFileSync(join(root, f), 'utf8'))(win);
}

const AS = win.AS;
const C = AS.config;
const G = AS.geometry;

let failures = 0;

function show(title, page) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
  const bad = G.selfTest(page);
  if (bad.length === 0) {
    console.log('  SELF-TEST: PASS  (0 violations)');
  } else {
    failures += bad.length;
    console.log(`  SELF-TEST: FAIL  (${bad.length} violations)`);
    bad.slice(0, 12).forEach(b => console.log('    !! ' + b));
    if (bad.length > 12) console.log(`    ... and ${bad.length - 12} more`);
  }

  console.log(`  page ${page.paper.w}x${page.paper.h}mm  faces=${page.faceCount}  faceW=${page.faceW}`);
  page.faces.forEach((L, fi) => {
    const p = L.preset;
    console.log(`\n  --- face ${fi}  (x ${L.faceX} .. ${L.faceX + L.faceW}) ---`);
    console.log(`  block=${p.blockW}x${p.blockH}  step=${p.step}  rowPitch=${p.rowPitch}`);
    console.log(`  content  L=${L.contentL}  R=${L.contentR}`);
    console.log(`  corner   x=${L.corner.x} y=${L.corner.y} w=${L.corner.w} h=${L.corner.h}` +
                `  center=(${L.corner.cx}, ${L.corner.cy})`);
    console.log(`  rowCenters  (${L.rowCenters.length}): ${L.rowCenters.join(', ')}`);
    console.log(`  colCenters  (${L.colCenters.length}): ${L.colCenters.slice(0, 5).join(', ')}` +
                ` ... ${L.colCenters.slice(-2).join(', ')}`);
    console.log(`  topBand  left=${L.topBand.left} right=${L.topBand.right} span=${L.topBand.span}`);
    console.log(`           whitespace L=${G.r3(L.topBand.left - L.contentL)}` +
                `  R=${G.r3(L.contentR - L.topBand.right)}`);
    console.log(`  topMarks (${L.topMarks.length})  first=(${L.topMarks[0].cx}, ${L.topMarks[0].cy})` +
                `  last=(${L.topMarks[L.topMarks.length-1].cx}, ${L.topMarks[L.topMarks.length-1].cy})`);
    console.log(`  leftMarks (${L.leftMarks.length}) at x=${L.leftBandX}`);
    L.leftMarks.forEach((m, i) => {
      const nm = i === 0 ? '题号' : String.fromCharCode(64 + i);
      console.log(`      ${nm.padEnd(3)}  cx=${m.cx}  cy=${m.cy}  rowCenter=${L.rowCenters[i]}`);
    });
  });
}

show('A4 portrait (1 face/page)', G.layoutPage({
  format: 'A4', preset: C.PRESETS.A4,
  padX: C.PRESETS.A4.padX, cornerInsetX: C.PRESETS.A4.cornerInsetX,
  topBandY: 15.665, gridTop: 86.5
}));

show('A3 landscape (3 faces/page)', G.layoutPage({
  format: 'A3', preset: C.PRESETS.A3,
  padX: C.PRESETS.A3.padX, cornerInsetX: C.PRESETS.A3.cornerInsetX,
  topBandY: 10.415, gridTop: 99.0
}));

console.log('\n' + '='.repeat(80));
console.log(failures === 0 ? 'ALL GEOMETRY CHECKS PASSED' : `${failures} GEOMETRY VIOLATIONS`);
console.log('='.repeat(80));
process.exit(failures === 0 ? 0 : 1);
