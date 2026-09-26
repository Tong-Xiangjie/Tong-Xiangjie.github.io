/* 一次把 A4 选择题多行的纵向几何量全部量出来。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9455;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '40';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
        .find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','0');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const R = e => { const b = e.getBoundingClientRect();
      return { t: mm(b.top - fb.top), b: mm(b.bottom - fb.top), h: mm(b.height),
               cy: mm((b.top+b.bottom)/2 - fb.top),
               cls: e.className }; };
    const grid = face.querySelector('.as-choice-grid');
    const gr = R(grid);
    const lines = Array.from(face.querySelectorAll('.as-choice-line')).map(function (l, i) {
      const lr = R(l);
      const col = l.querySelector('.as-choice-col');
      const cr = col ? R(col) : null;
      const items = Array.from(l.querySelectorAll('.as-choice-item')).map(R);
      const nums = l.querySelector('.as-choice-nums');
      const nr = nums ? R(nums) : null;
      const nspan = l.querySelector('.as-choice-num');
      const nsr = nspan ? R(nspan) : null;
      const bubs = Array.from(l.querySelectorAll('.as-bubble')).map(R);
      return { i: i, line: lr, col: cr, nItems: items.length,
               numRow: nr, numSpan: nsr,
               firstItemTop: items.length ? items[0].t : null,
               bubCys: [...new Set(bubs.map(x => x.cy))].sort((a,b)=>a-b),
               lastBub: bubs.length ? R(l.querySelectorAll('.as-bubble')[bubs.length-1]) : null,
               lastBubBottom: bubs.length ? Math.max.apply(null, bubs.map(x=>x.b)) : null };
    });
    const left = Array.from(face.querySelectorAll('.as-mark-left')).map(R)
      .sort((a,b)=>a.cy-b.cy);
    return { grid: gr, rowGap: getComputedStyle(grid).rowGap,
             gridH: getComputedStyle(grid).height,
             lines: lines, left: left,
             geo: { colH: window.AS.geometry.columnHeight(window.AS.config.PRESETS.A4),
                    lineGapH: window.AS.geometry.lineGapH(window.AS.config.PRESETS.A4),
                    lineH: window.AS.geometry.lineHeight(window.AS.config.PRESETS.A4),
                    bubbleH: window.AS.geometry.bubbleH(window.AS.config.PRESETS.A4),
                    rowOffsets: window.AS.geometry.rowOffsets(window.AS.config.PRESETS.A4) } };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('A4 %s 题', NC);
    console.log('几何 colH=%s lineGapH=%s lineH=%s bubbleH=%s',
      d.geo.colH, d.geo.lineGapH, d.geo.lineH, d.geo.bubbleH);
    console.log('rowOffsets = %s', d.geo.rowOffsets.join(', '));
    console.log('网格 top=%s h=%s  row-gap=%s (css h=%s)',
      d.grid.t, d.grid.h, d.rowGap, d.gridH);
    d.lines.forEach(function (l) {
      console.log('\n行%d  line t=%s b=%s h=%s', l.i + 1, l.line.t, l.line.b, l.line.h);
      console.log('   col  t=%s b=%s h=%s', l.col && l.col.t, l.col && l.col.b, l.col && l.col.h);
      console.log('   题号行 t=%s b=%s h=%s   题号 span t=%s b=%s h=%s',
        l.numRow && l.numRow.t, l.numRow && l.numRow.b, l.numRow && l.numRow.h,
        l.numSpan && l.numSpan.t, l.numSpan && l.numSpan.b, l.numSpan && l.numSpan.h);
      console.log('   item 数=%d  首 item.t=%s', l.nItems, l.firstItemTop);
      console.log('   气泡行心 = %s', l.bubCys.join(', '));
      console.log('   末气泡底 = %s', l.lastBubBottom);
      console.log('   行内量: 题号行top−line.top=%s   末气泡底−line.top=%s',
        Math.round((l.numRow.t - l.line.t) * 1000) / 1000,
        Math.round((l.lastBubBottom - l.line.t) * 1000) / 1000);
    });
    if (d.lines.length > 1) {
      const a = d.lines[0], b = d.lines[1];
      const gap = Math.round((b.numRow.t - a.lastBubBottom) * 1000) / 1000;
      console.log('\n▶ 净空 = 行2 题号行顶 %s − 行1 末气泡底 %s = %s mm  (要求 %s)',
        b.numRow.t, a.lastBubBottom, gap, d.geo.bubbleH);
      console.log('   = %s 个气泡高', Math.round((gap / d.geo.bubbleH) * 1000) / 1000);
      console.log('▶ 行顶到行顶 = %s   (lineHeight = %s)',
        Math.round((b.line.t - a.line.t) * 1000) / 1000, d.geo.lineH);
    }
    console.log('\n左侧定位点（%d 个）: %s', d.left.length,
      d.left.map(m => m.cy).join(', '));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
