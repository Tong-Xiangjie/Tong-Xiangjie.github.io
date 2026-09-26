/* 验证分块规则：给定题数，检查实际渲染出的块数与每块题数。
   期望（用户指定）：5→[5] 6→[6] 7→[5,2] 8→[5,3] 9→[5,4] 10→[5,5]
                     11→[5,6] 12→[5,7] 13→[5,5,3] 14→[5,5,4] 15→[5,5,5]
   用法：node .ref\group_check.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9381;
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
    set('cardTitle', 'T'); set('cardSubject', '数学');
    set('subjStart', '999'); set('subjCount', '0');
    const C = window.AS.config, G = window.AS.geometry;
    const g = C.GROUPS['${FMT}'];
    const faceW = '${FMT}' === 'A3' ? C.PAPER.A3.w / C.A3_COLUMNS : C.PAPER.A4.w;
    const out = { format: '${FMT}', cols: G.columnsPerLine(C.PRESETS['${FMT}'], faceW),
                  group: g, plan: [], rendered: [] };
    for (let n = 4; n <= 22; n++) {
      out.plan.push({ n: n, blocks: G.blockPlan(1, n, g).map(b => b.count) });
    }
    /* 实际渲染：数一数每行的块和块内气泡列数 */
    [5, 7, 8, 11, 12, 13, 15, 22].forEach(n => {
      set('choiceTotal', String(n)); set('choiceStart', '1');
      window.AS.app.generate();
      const lines = Array.from(document.querySelectorAll('#stage .as-choice-line'));
      out.rendered.push({
        n: n,
        lines: lines.map(ln => Array.from(ln.querySelectorAll('.as-choice-col'))
                              .map(c => c.querySelectorAll('.as-choice-item').length))
      });
    });
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 800));
  }
  const d = res.result?.result?.value;
  if (d) {
    console.log('format=%s  cols/line=%d  group=%j', d.format, d.cols, d.group);
    console.log('--- blockPlan ---');
    d.plan.forEach(p => console.log('  %s -> [%s]', String(p.n).padStart(2), p.blocks.join(',')));
    console.log('--- rendered ---');
    d.rendered.forEach(r => console.log('  %s -> lines [%s]',
      String(r.n).padStart(2), r.lines.map(l => l.join('+')).join(' | ')));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
