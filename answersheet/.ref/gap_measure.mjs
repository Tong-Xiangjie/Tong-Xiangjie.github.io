/* 量出选择题各块之间实际空了多少，以及一「题」的宽度是多少。
   用法：node .ref\gap_measure.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9377;
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
    const st = card.closest('.preview-stage');
    st.style.transform = 'none';
    const pr = card.getBoundingClientRect();
    const mm = (v) => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const G = window.AS.geometry, C = window.AS.config;
    const opt = window.AS.app.readOptions();
    const p = C.PRESETS[opt.format];
    const faceW = opt.format === 'A3' ? C.PAPER.A3.w / C.A3_COLUMNS : C.PAPER.A4.w;

    const out = { format: opt.format, total: ${N} };
    out.step = p.step;
    out.blockW = p.blockW;
    out.cols = G.columnsPerLine(p, faceW);
    out.plan = G.blockPlan(1, ${N}, C.GROUPS[opt.format]);
    out.contentBox = G.contentBox(p, faceW);

    /* 每个气泡的列心（第 1 个选项行） */
    const bubbles = Array.from(card.querySelectorAll('.as-choice-line:first-child .as-bubble'));
    const byRow = {};
    bubbles.forEach(e => {
      const r = e.getBoundingClientRect();
      const top = mm(r.top - pr.top);
      (byRow[top] = byRow[top] || []).push(mm((r.left + r.right) / 2 - pr.left));
    });
    const firstRowTop = Object.keys(byRow).map(Number).sort((a,b)=>a-b)[0];
    const centers = byRow[firstRowTop].sort((a,b)=>a-b);
    out.bubbleCenters = centers;
    out.pitches = centers.slice(1).map((c,i)=>Math.round((c-centers[i])*1000)/1000);

    /* 块的位置 */
    const blocks = Array.from(card.querySelectorAll('.as-choice-line:first-child .as-choice-col'));
    out.blockSpans = blocks.map(b => {
      const r = b.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left), w: mm(r.width) };
    });
    out.gapsBetweenBlocks = out.blockSpans.slice(1).map((b,i)=>
      Math.round((b.l - out.blockSpans[i].r)*1000)/1000);
    /* 块之间「空了几题」= gap / step */
    out.gapsInQuestions = out.gapsBetweenBlocks.map(g=>Math.round(g/p.step*100)/100);
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 800));
  }
  console.log(JSON.stringify(res.result?.result?.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
