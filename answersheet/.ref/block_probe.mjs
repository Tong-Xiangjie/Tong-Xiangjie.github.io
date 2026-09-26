/* 直接读出每个块的 left/width/margin-left，定位「空太多」的来源。
   用法：node .ref\block_probe.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9379;
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
    set('cardTitle', 'T'); set('cardSubject', '数学');
    set('choiceTotal', '${N}'); set('choiceStart', '1');
    set('subjStart', '999'); set('subjCount', '0');
    window.AS.app.generate();
    const card = document.querySelector('#stage .as-page');
    card.closest('.preview-stage').style.transform = 'none';
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v*25.4/96*1000)/1000;
    const line = card.querySelector('.as-choice-line');
    const grid = card.querySelector('.as-choice-grid');
    const inner = card.querySelector('.as-choice-inner');
    const outer = card.querySelector('.as-choice-outer');
    const info = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { l: mm(r.left-pr.left), w: mm(r.width),
               ml: cs.marginLeft, pl: cs.paddingLeft, bl: cs.borderLeftWidth,
               disp: cs.display, box: cs.boxSizing, flex: cs.flex, pos: cs.position };
    };
    return {
      outer: info(outer), inner: info(inner), grid: info(grid), line: info(line),
      blocks: Array.from(line.children).map(info),
      gridChildren: Array.from(grid.children).map(info),
      plan: window.AS.geometry.blockPlan(1, ${N}, window.AS.config.GROUPS['${FMT}'])
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  }
  console.log(JSON.stringify(res.result?.result?.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
