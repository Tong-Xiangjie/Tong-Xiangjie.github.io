/* 填好表单 → 生成 → 报告每块的真实位置，用于定位「整体移位」。
   用法：node .ref\layout_report.mjs [A4|A3] [color|mono] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const THEME = process.argv[3] || 'color';
const OUT = process.argv[4] || '.ref/layout_report.txt';

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
  if (!target) throw new Error('no chrome target');
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
    const t = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (t) t.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    window.AS.app.generate();

    const card = document.querySelector('#stage .as-page');
    if (!card) return { err: 'no page' };
    const pr = card.getBoundingClientRect();
    const st = card.closest('.preview-stage');
    const m = st ? getComputedStyle(st).transform : 'none';
    const k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\\(([^,]+)/) || [0,1])[1]);
    const mm = (v) => Math.round(v * 25.4 / 96 / k * 1000) / 1000;
    const rel = (e) => { const r = e.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left),
               t: mm(r.top - pr.top), b: mm(r.bottom - pr.top),
               w: mm(r.width), h: mm(r.height),
               cx: mm((r.left+r.right)/2 - pr.left), cy: mm((r.top+r.bottom)/2 - pr.top) }; };
    const one = (sel) => { const e = card.querySelector(sel); return e ? rel(e) : null; };
    const many = (sel, n) => Array.from(card.querySelectorAll(sel)).slice(0, n || 8).map(rel);

    const out = { zoom: k, page: rel(card) };
    out.head = one('.as-head');
    out.headTitle = one('.as-head-title');
    out.info = one('.as-info');
    out.zk = one('.as-zk');
    out.noteRow = one('.as-note-row');
    out.note = one('.as-note');
    out.barcode = one('.as-barcode');
    out.outer = one('.as-choice-outer');
    out.inner = one('.as-choice-inner');
    out.grid = one('.as-choice-grid');
    out.faceBody = one('.as-face-body');
    out.subj = one('.as-subjective');
    out.footer = one('.as-footer');
    out.topMarks = many('.as-mark-top', 3);
    out.leftMarks = many('.as-mark-left', 8);
    out.corners = many('.as-corner', 4);
    out.nums = many('.as-choice-num', 3);
    out.bubbles = many('.as-bubble', 4);
    /* 顶栏块心 x 与第一列气泡列心 x */
    const tm0 = card.querySelector('.as-mark-top');
    const b0 = card.querySelector('.as-bubble');
    out.compare = {
      topMarkCx: tm0 ? rel(tm0).cx : null,
      bubbleCx: b0 ? rel(b0).cx : null
    };
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 600));
  }
  const D = res.result?.result?.value;
  const txt = JSON.stringify(D, null, 1);
  writeFileSync(OUT, txt, 'utf8');
  console.log(txt);
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
