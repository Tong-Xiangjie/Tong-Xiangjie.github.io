/* 直接从几何层读 builder 实际用的 gridTop / margin-top，并与 DOM 对照。
   用法：node .ref\chk_gridtop.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9409;
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
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${N}'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0'); set('subjScore',''); set('subjLines','');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const G = window.AS.geometry, C = window.AS.config, P = window.AS.paginator;
    const pre = C.PRESETS['${FMT}'];
    const off = G.boxOffsets(pre);
    const faceW = C.PAPER['${FMT}'].w / ('${FMT}'==='A3'?3:1);
    /* 从分页器拿这一面的 choice 块 */
    const dbg = P.lastDebug;
    const fb = dbg.faces[0].body.find(b => b.kind === 'choice');
    const gridTop = fb ? fb.gridTop - fb.boxTop : null;
    const expectedMargin = gridTop === null ? null :
      Math.round((gridTop - off.border - off.outerPadY - off.headerH -
                  off.headerGap - off.border - off.innerPadTop) * 1000)/1000;
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const T = e => mm(e.getBoundingClientRect().top - pr.top);
    const inner = card.querySelector('.as-choice-inner'), grid = card.querySelector('.as-choice-grid');
    const cs = getComputedStyle(inner), gcs = getComputedStyle(grid);
    return {
      boxOffsets: off,
      choiceHeadH: G.choiceHeadH(pre), choiceChromeH: G.choiceChromeH(pre),
      choiceFootH: G.choiceFootH(pre),
      faceBlock: fb ? { boxTop: fb.boxTop, contentTop: fb.contentTop,
                        gridTop: fb.gridTop, rows: fb.rows, gridH: fb.gridH,
                        lineGap: fb.lineGap, colH: fb.colH } : null,
      gridTopRel: gridTop, expectedMargin,
      innerInline: inner.getAttribute('style'),
      gridInline: grid.getAttribute('style'),
      dom: { innerTop: T(inner), gridTop: T(grid),
             innerMarginTop: mm(parseFloat(cs.marginTop)),
             innerPadTop: mm(parseFloat(cs.paddingTop)),
             gridMarginTop: mm(parseFloat(gcs.marginTop)) },
      gap: mm(T(grid) - (T(inner) + mm(parseFloat(cs.borderTopWidth))))
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    console.log(JSON.stringify(res.result.result.value, null, 1));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
