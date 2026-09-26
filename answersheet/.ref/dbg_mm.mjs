/* 最小复现：打印 mm() 与 getBoundingClientRect 的原始值。
   用法：node .ref\dbg_mm.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9411;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';

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
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('choiceTotal','12'); set('subjStart','999'); set('subjCount','0');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const inner = card.querySelector('.as-choice-inner');
    const grid  = card.querySelector('.as-choice-grid');
    const col   = card.querySelector('.as-choice-col');
    const num   = card.querySelector('.as-choice-num');
    const R = e => { const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height }; };
    return {
      cardTop: pr.top,
      innerRect: R(inner), gridRect: R(grid), colRect: R(col), numRect: R(num),
      innerStyleTop: getComputedStyle(inner).top,
      innerPosition: getComputedStyle(inner).position,
      gridPosition: getComputedStyle(grid).position,
      gridOffsetTop: grid.offsetTop,
      innerOffsetTop: inner.offsetTop,
      colPosition: getComputedStyle(col).position,
      colOffsetTop: col.offsetTop,
      gridOffsetParent: grid.offsetParent ? grid.offsetParent.className : null,
      colOffsetParent: col.offsetParent ? col.offsetParent.className : null
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    const MM = 25.4 / 96;
    console.log('cardTop(px) =', d.cardTop);
    for (const k of ['innerRect', 'gridRect', 'colRect', 'numRect']) {
      const r = d[k];
      console.log('%s  top=%s px = %s mm   bottom=%s px = %s mm   h=%s mm',
        k.padEnd(10), r.top.toFixed(3), ((r.top - d.cardTop) * MM).toFixed(3),
        r.bottom.toFixed(3), ((r.bottom - d.cardTop) * MM).toFixed(3),
        (r.h * MM).toFixed(3));
    }
    console.log('inner position=%s offsetTop=%s', d.innerPosition, d.innerOffsetTop);
    console.log('grid  position=%s offsetTop=%s offsetParent=%s',
      d.gridPosition, d.gridOffsetTop, d.gridOffsetParent);
    console.log('col   position=%s offsetTop=%s offsetParent=%s',
      d.colPosition, d.colOffsetTop, d.colOffsetParent);
    console.log('\n黑框内缘(mm) = %s', (((d.innerRect.top - d.cardTop) * MM) + 0.2646).toFixed(3));
    console.log('网格上缘(mm) = %s', ((d.gridRect.top - d.cardTop) * MM).toFixed(3));
    console.log('=> 空档 = %s mm',
      (((d.gridRect.top - d.innerRect.top) * MM) - 0.2646).toFixed(3));
    console.log('题号块上缘(mm) = %s  首列上缘(mm) = %s',
      ((d.numRect.top - d.cardTop) * MM).toFixed(3),
      ((d.colRect.top - d.cardTop) * MM).toFixed(3));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
