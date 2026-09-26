/* Node integration test: run the real module pipeline (no DOM) and verify
 * geometry self-test passes for every face across several configurations. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const win = {};
globalThis.window = win;
for (const f of [
  'js/config.js', 'js/geometry.js', 'js/theme.js', 'js/marks.js',
  'js/builders/choice.js', 'js/builders/subject.js', 'js/builders/page.js',
  'js/paginator.js'
]) {
  new Function('window', readFileSync(join(root, f), 'utf8'))(win);
}

const AS = win.AS;
const C = AS.config, G = AS.geometry, P = AS.paginator, Page = AS.page,
      Choice = AS.choice, Subject = AS.subject, M = AS.marks;

let totalViolations = 0;
let totalFaces = 0;

function runCase(label, opt) {
  const preset = C.PRESETS[opt.format];
  const blocks = P.planBlocks({
    preset,
    group: C.GROUPS[opt.format],
    faceW: C.PAPER[opt.format].w,
    choiceTotal: opt.choiceTotal,
    choiceStart: opt.choiceStart,
    subjItems: opt.subjItems
  });
  const faces = P.paginate({
    blocks,
    preset,
    chromeFirst: Page.chromeHeight(true),
    chromeOther: Page.chromeHeight(false)
  });

  const topBandY = opt.format === 'A3'
    ? G.r3(preset.cornerH / 2 + 8.3)
    : G.r3(preset.cornerH / 2 + 13.55);

  const perSheet = opt.format === 'A3' ? C.A3_COLUMNS : 1;
  const sheetCount = Math.ceil(faces.length / perSheet) || 1;
  const paper = C.PAPER[opt.format];

  let violations = [];
  let html = '';
  let marksRendered = 0;
  let bubblesRendered = 0;

  for (let s = 0; s < sheetCount; s++) {
    const faceViews = [];
    for (let fi = 0; fi < perSheet; fi++) {
      const idx = s * perSheet + fi;
      const face = faces[idx];
      const gridTop = (face && face.body.length && face.body[0].kind === 'choice')
        ? face.body[0].gridTop : 120;

      const page = G.layoutPage({
        format: opt.format, preset,
        padX: preset.padX, cornerInsetX: preset.cornerInsetX,
        topBandY, gridTop,
        extraRows: (face && face.first) ? [
          { kind: 'absent', cy: Page.SPECIAL.absentCy },
          { kind: 'sample', cy: Page.SPECIAL.sampleCy }
        ] : []
      });
      const L = page.faces[fi];
      if (face) violations = violations.concat(G.selfTest({ format: opt.format, paper, faces: [L] }));

      let body = '';
      if (face) {
        for (const b of face.body) {
          if (b.kind === 'choice') {
            const r = Choice.build({
              startNo: b.startNo,
              endNo: b.startNo + b.total - 1,
              rows: b.rows,
              fromLine: b.fromLine,
              group: b.group,
              preset,
              first: b.head,
              gridTop: G.r3(b.gridTop - b.boxTop),
              gridH: G.r3(b.colH * b.rows)
            });
            body += r.html;
            bubblesRendered += (r.html.match(/as-bubble/g) || []).length;
          } else {
            body += Subject.renderItem(b.item.no, b.item.score, b.item.lines, { lineH: b.item.lineH });
          }
        }
      }
      const markHtml = M.all(L, paper.h - L.corner.y - L.corner.h);
      marksRendered += (markHtml.match(/class="as-mark/g) || []).length +
                       (markHtml.match(/class="as-corner/g) || []).length;

      faceViews.push({ L, html: body, first: face ? face.first : false });
    }
    html += Page.render({
      format: opt.format, paperH: paper.h, faces: faceViews,
      meta: { title: 'T', subject: 'S', zkLength: 9, footer: '' },
      pageNo: s + 1, total: sheetCount
    });
  }

  totalViolations += violations.length;
  totalFaces += faces.length;

  const status = violations.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n[${status}] ${label}`);
  console.log(`    format=${opt.format} choice=${opt.choiceTotal} subj=${opt.subjItems.length}` +
              ` -> ${faces.length} faces on ${sheetCount} sheet(s)`);
  console.log(`    rendered: ${bubblesRendered} bubbles, ${marksRendered} positioning marks,` +
              ` html ${html.length} chars`);
  console.log(`    layout:`);
  faces.forEach((f, i) => {
    const parts = f.body.map(b => b.kind === 'choice'
      ? `choice[${b.rows}行 @${b.gridTop}mm]`
      : `subj#${b.item.no}[@${b.top}mm h=${b.item.lines * b.item.lineH + 10}]`);
    console.log(`      face${i} ${f.first ? '(首页)' : '      '} cursor=${f.cursor.toFixed(1)}  ${parts.join(' ')}`);
  });
  if (violations.length) {
    violations.slice(0, 6).forEach(v => console.log('      !! ' + v));
    if (violations.length > 6) console.log(`      ... +${violations.length - 6} more`);
  }
  return { faces, sheetCount, html, violations };
}

const subj = (n, lines = 8) => Array.from({ length: n }, (_, i) => ({
  no: 13 + i, score: 10, lines, lineH: 7.7
}));

// ── cases ──
runCase('A4 · 12 choice + 5 subjective', {
  format: 'A4', choiceTotal: 12, choiceStart: 1, subjItems: subj(5)
});
runCase('A4 · 0 choice + 5 subjective', {
  format: 'A4', choiceTotal: 0, choiceStart: 1, subjItems: subj(5)
});
runCase('A4 · 20 choice + 0 subjective', {
  format: 'A4', choiceTotal: 20, choiceStart: 1, subjItems: []
});
runCase('A4 · 60 choice (multi-page)', {
  format: 'A4', choiceTotal: 60, choiceStart: 1, subjItems: []
});
runCase('A4 · 12 choice + 20 tall subjective (multi-page)', {
  format: 'A4', choiceTotal: 12, choiceStart: 1, subjItems: subj(20, 12)
});
runCase('A3 · 20 choice + 5 subjective', {
  format: 'A3', choiceTotal: 20, choiceStart: 1, subjItems: subj(5)
});
runCase('A3 · 40 choice + 10 subjective', {
  format: 'A3', choiceTotal: 40, choiceStart: 1, subjItems: subj(10)
});

console.log('\n' + '='.repeat(72));
console.log(totalViolations === 0
  ? `ALL PASS — ${totalFaces} faces, 0 alignment violations`
  : `${totalViolations} ALIGNMENT VIOLATIONS across ${totalFaces} faces`);
console.log('='.repeat(72));
process.exit(totalViolations === 0 ? 0 : 1);
