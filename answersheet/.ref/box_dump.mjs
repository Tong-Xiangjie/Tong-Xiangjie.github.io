/* 直接 dump 三个盒子的内联样式与计算样式（排查 0.3mm 残差）。
   用法：node .ref\box_dump.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9403;
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
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0'); set('subjScore',''); set('subjLines','');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const P = window.AS.config.PRESETS['${FMT}'];
    const G = window.AS.geometry;
    const faceW = (window.AS.config.PAPER['${FMT}'].w) / ('${FMT}'==='A3'?3:1);
    const q = s => document.querySelector(s);
    const dump = sel => {
      const e = q(sel); if (!e) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
      return { sel, inline: e.getAttribute('style'),
        width: mm(parseFloat(cs.width)), ml: mm(parseFloat(cs.marginLeft)),
        pl: mm(parseFloat(cs.paddingLeft)), pr: mm(parseFloat(cs.paddingRight)),
        bl: mm(parseFloat(cs.borderLeftWidth)), br: mm(parseFloat(cs.borderRightWidth)),
        boxSizing: cs.boxSizing, display: cs.display, pos: cs.position,
        left: mm(r.left), right: mm(r.right) };
    };
    return {
      geom: { contentBox: G.contentBox(P, faceW), innerBoxW: G.innerBoxW(P, faceW),
              gridOriginX: G.gridOriginX(P, faceW), gridShiftX: G.gridShiftX(P),
              columnsPerLine: G.columnsPerLine(P, faceW), outerLeft: G.boxOffsets(P).outerLeft,
              boxGap: G.boxOffsets(P).boxGap, border: G.boxOffsets(P).border },
      boxes: [dump('.as-choice-section'), dump('.as-choice-outer'),
              dump('.as-choice-inner'), dump('.as-choice-grid'),
              dump('.as-choice-line'), dump('.as-choice-col')]
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('几何:', JSON.stringify(d.geom, null, 1));
    console.log('\n盒:');
    d.boxes.filter(Boolean).forEach(b => console.log(' ', JSON.stringify(b)));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
