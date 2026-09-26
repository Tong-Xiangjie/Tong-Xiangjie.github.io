/* 逐层打印选择题区「红框 → 黑框 → 网格 → 首列 → 气泡」的
   左边框盒 x 与宽度，以及每层的 padding/margin，找出水平偏移从哪来。
   用法：node .ref\chain_probe.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9385;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const N = process.argv[3] || '12';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      target = (await r.json()).find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const EXPR = `(() => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','T'); set('cardSubject','数学');
    set('choiceTotal','${N}'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0');
    window.AS.app.generate();
    const st = document.querySelector('#stage');
    st.style.transform = 'none';

    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const chain = [];
    const push = (label, el) => {
      if (!el) { chain.push({ label, missing: true }); return; }
      const r = el.getBoundingClientRect(), c = getComputedStyle(el);
      chain.push({
        label,
        left: mm(r.left - pr.left),
        right: mm(r.right - pr.left),
        w: mm(r.width),
        pad: c.paddingLeft + '/' + c.paddingRight,
        mar: c.marginLeft + '/' + c.marginRight,
        bw: c.borderLeftWidth + '/' + c.borderRightWidth,
        box: c.boxSizing,
        pos: c.position,
        disp: c.display,
        flex: c.flex
      });
    };
    push('.as-face', card.querySelector('.as-face'));
    push('.as-choice-section', card.querySelector('.as-choice-section'));
    push('.as-choice-outer', card.querySelector('.as-choice-outer'));
    push('.as-choice-header', card.querySelector('.as-choice-header'));
    push('.as-choice-inner', card.querySelector('.as-choice-inner'));
    push('.as-choice-grid', card.querySelector('.as-choice-grid'));
    push('.as-choice-line', card.querySelector('.as-choice-line'));
    push('.as-choice-block', card.querySelector('.as-choice-block'));
    push('.as-choice-col', card.querySelector('.as-choice-col'));
    push('.as-choice-item', card.querySelector('.as-choice-item'));
    push('.as-bubble', card.querySelector('.as-bubble'));
    push('.as-mark-left', card.querySelector('.as-mark-left'));
    push('.as-corner', card.querySelector('.as-corner'));

    const G = window.AS.geometry, C = window.AS.config;
    const p = C.PRESETS['${FMT}'];
    const faceW = '${FMT}' === 'A3' ? C.PAPER.A3.w / C.A3_COLUMNS : C.PAPER.A4.w;
    const off = G.boxOffsets(p);
    const cb = G.contentBox(p, faceW);
    return {
      chain,
      off,
      contentBox: cb,
      cols: G.columnsPerLine(p, faceW),
      gridLeft: G.gridLeft(p, faceW),
      colCenters: G.columnCenters(p, faceW).slice(0, 3),
      step: p.step,
      blockW: p.blockW,
      faceW
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
    ws.close(); chrome.kill(); process.exit(1);
  }
  const d = res.result.result.value;

  console.log('format=%s  faceW=%s  cols=%d  blockW=%s  step=%s',
              FMT, d.faceW, d.cols, d.blockW, d.step);
  console.log('gridLeft=%s  colCenters=%j', d.gridLeft, d.colCenters);
  console.log('contentBox=%j', d.contentBox);
  console.log('\n--- boxOffsets ---');
  Object.keys(d.off).forEach(k => console.log('  %s = %s', k.padEnd(18), d.off[k]));

  console.log('\n--- 盒模型链（相对纸面左缘, mm）---');
  console.log('  %s %9s %9s %9s  %-14s %-14s %-14s %s',
              'layer'.padEnd(22), 'left', 'right', 'w', 'padding', 'margin', 'border', 'position');
  d.chain.forEach(c => {
    if (c.missing) { console.log('  %s  (missing)', c.label); return; }
    console.log('  %s %9s %9s %9s  %-14s %-14s %-14s %s/%s',
      c.label.padEnd(22), c.left, c.right, c.w, c.pad, c.mar, c.bw, c.pos, c.disp);
  });

  /* 逐层推演：每一层左缘 = 上一层内容盒左缘 + 本层 margin */
  console.log('\n--- 偏移归因 ---');
  for (let i = 1; i < d.chain.length; i++) {
    const a = d.chain[i - 1], b = d.chain[i];
    if (a.missing || b.missing) continue;
    const dLeft = Math.round((b.left - a.left) * 1000) / 1000;
    console.log('  %s → %s : Δleft = %s mm',
                a.label, b.label, dLeft);
  }

  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
