import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const win = {}; globalThis.window = win;
for (const f of ['js/config.js','js/geometry.js','js/theme.js','js/marks.js',
  'js/builders/choice.js','js/builders/subject.js','js/builders/page.js','js/paginator.js']) {
  new Function('window', readFileSync(join(root, f), 'utf8'))(win);
}
const AS = win.AS, C = AS.config, G = AS.geometry, P = AS.paginator, Page = AS.page;

const preset = C.PRESETS.A4;
const blocks = P.planBlocks({ preset, choiceTotal: 60, choiceStart: 1, subjItems: [] });
console.log('blocks:', JSON.stringify(blocks, null, 2));
console.log('chromeFirst =', Page.chromeHeight(true), ' chromeOther =', Page.chromeHeight(false));
console.log('usable =', P.PAGE_H - P.BOTTOM_RESERVE);
console.log('columnHeight =', G.columnHeight(preset));

const faces = P.paginate({ blocks, chromeFirst: Page.chromeHeight(true), chromeOther: Page.chromeHeight(false) });
console.log('faces =', faces.length);
faces.forEach((f, i) => {
  console.log(`  face${i} first=${f.first} cursor=${f.cursor} body=`,
    f.body.map(b => b.kind === 'choice' ? `choice(rows=${b.rows},from=${b.fromLine},top=${b.gridTop})` : `subj(no=${b.item.no})`).join(' '));
});
