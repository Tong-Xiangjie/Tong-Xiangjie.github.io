/* 检查第 N 面（sheet）的定位块与页眉是否存在、是否被正文盖住。
   用法：node .ref\page_check.mjs [A4|A3] [sheetIndex 0-based] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9373;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const SHEET = parseInt(process.argv[3] || '1', 10);

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

    const sheets = document.querySelectorAll('#stage .as-page');
    const card = sheets[${SHEET}];
    if (!card) return { err: 'no sheet ' + ${SHEET} + ', total=' + sheets.length };
    const st = card.closest('.preview-stage');
    st.style.transform = 'none';
    const pr = card.getBoundingClientRect();
    const mm = (v) => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const out = { sheetCount: sheets.length, sheet: ${SHEET} };

    out.counts = {
      topMarks: card.querySelectorAll('.as-mark-top').length,
      leftMarks: card.querySelectorAll('.as-mark-left').length,
      corners: card.querySelectorAll('.as-corner').length,
      faces: card.querySelectorAll('.as-face').length
    };
    out.marks = Array.from(card.querySelectorAll('.as-mark-top')).slice(0, 4).map(e => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { l: mm(r.left - pr.left), t: mm(r.top - pr.top),
               w: mm(r.width), h: mm(r.height), bg: cs.backgroundColor,
               z: cs.zIndex, disp: cs.display, vis: cs.visibility };
    });
    /* 每面的直接子元素概览，看看页眉在不在 */
    out.faces = Array.from(card.querySelectorAll('.as-face')).map(fe => ({
      kids: Array.from(fe.children).map(k => {
        const r = k.getBoundingClientRect();
        return k.className + '[t=' + mm(r.top - pr.top) + ',h=' + mm(r.height) +
               ',z=' + getComputedStyle(k).zIndex + ']';
      })
    }));
    /* 点命中测试：顶部定标带位置最上层是谁 */
    const probe = (x, y) => {
      const el = document.elementFromPoint(pr.left + x * 96 / 25.4, pr.top + y * 96 / 25.4);
      return el ? (el.className || el.tagName) : null;
    };
    const bx = card.querySelector('.as-check-box');
    const nb = card.querySelector('.as-note-bottom');
    const nt = card.querySelector('.as-note');
    const rel2 = el => { if(!el) return null; const r=el.getBoundingClientRect(), c=getComputedStyle(el);
      return { l: mm(r.left-pr.left), w: mm(r.width), ml: c.marginLeft, pl: c.paddingLeft,
               bl: c.borderLeftWidth, pos: c.position }; };
    out.checkBox = rel2(bx);
    out.noteBottom = rel2(nb);
    out.note = rel2(nt);
    out.hitTest = {
      atBand: probe(15.4, 15.66),
      atTitle: probe(105, 20)
    };
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
