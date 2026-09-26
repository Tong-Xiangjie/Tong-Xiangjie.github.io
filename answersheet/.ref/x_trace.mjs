/* 精确定位「顶部定标块列心」与「气泡列心」之间那 0.075mm 的来源：
   逐层量 .as-choice-outer → inner → grid → line → col → item → optrow → bubble 的
   边框盒 left/width，并与 geometry 算出的值对照。
   用法：node .ref\x_trace.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9371;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';

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
    set('cardTitle', '2026届高三第一次模拟考试'); set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    window.AS.app.generate();

    const card = document.querySelector('#stage .as-page');
    const st = card.closest('.preview-stage');
    st.style.transform = 'none';           // 去掉预览缩放，量 1:1
    const pr = card.getBoundingClientRect();
    const mm = (v) => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const at = (sel, n) => {
      const list = card.querySelectorAll(sel);
      const e = list[n || 0];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return {
        sel: sel,
        l: mm(r.left - pr.left), r: mm(r.right - pr.left),
        w: mm(r.width), cx: mm((r.left + r.right) / 2 - pr.left),
        ml: cs.marginLeft, pl: cs.paddingLeft, bl: cs.borderLeftWidth,
        pos: cs.position, disp: cs.display
      };
    };
    const out = { layers: [] };
    ['.as-choice-outer', '.as-choice-inner', '.as-choice-grid',
     '.as-choice-line', '.as-choice-col', '.as-choice-item',
     '.as-choice-optrow', '.as-bubble', '.as-mark-top'].forEach(s => {
      out.layers.push(at(s));
    });

    const G = window.AS.geometry, C = window.AS.config;
    const opt = window.AS.app.readOptions();
    const p = C.PRESETS[opt.format];
    const cols = G.columnCenters(p, C.PAPER[opt.format].w);
    const off = G.boxOffsets(p);
    out.expected = {
      colCenters: cols.slice(0, 5),
      blockW: p.blockW,
      outerLeft: off.outerLeft,
      outerPadX: off.outerPadX,
      innerPadX: off.innerPadX,
      gridLeft: off.gridLeft,
      /* 期望：网格左边框盒 = outerLeft + border + outerPadX */
      gridBorderLeft: Math.round((off.outerLeft + off.border + off.outerPadX) * 1000) / 1000,
      /* 期望：第 1 列左边 = 列心 − blockW/2 */
      colLeft: Math.round((cols[0] - p.blockW / 2) * 1000) / 1000
    };
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 800));
  }
  const D = res.result?.result?.value;
  if (D) {
    D.layers.forEach(L => {
      if (!L) return;
      console.log(L.sel.padEnd(20), 'l=' + String(L.l).padStart(9), 'w=' + String(L.w).padStart(8),
        'cx=' + String(L.cx).padStart(9), 'ml=' + L.ml, 'pl=' + L.pl, 'bl=' + L.bl, L.pos, L.disp);
    });
    console.log('EXPECTED', JSON.stringify(D.expected, null, 1));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
