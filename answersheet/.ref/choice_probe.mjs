/* 量选择题网格的结构：每条线上各列的位置、行心、以及换行处（下一行）的起始列。
   用法：node .ref\choice_probe.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9395;
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
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const cx = e => { const r = e.getBoundingClientRect(); return mm((r.left + r.right) / 2 - pr.left); };
    const cy = e => { const r = e.getBoundingClientRect(); return mm((r.top + r.bottom) / 2 - pr.top); };
    const lines = Array.from(card.querySelectorAll('.as-choice-line')).map((ln, i) => {
      const items = Array.from(ln.querySelectorAll('.as-choice-item')).map(it => ({
        no: it.querySelector('.as-choice-num') ? it.querySelector('.as-choice-num').textContent.trim() : '',
        cx: cx(it)
      }));
      const spacers = Array.from(ln.querySelectorAll('.as-choice-spacer')).map(sp => ({
        w: mm(sp.getBoundingClientRect().width), cx: cx(sp)
      }));
      return { i, items, spacers, top: mm(ln.getBoundingClientRect().top - pr.top) };
    });
    const marks = Array.from(card.querySelectorAll('.as-mark-left')).map(m => cy(m));
    const topMarks = Array.from(card.querySelectorAll('.as-mark-top')).map(m => cx(m));
    const grid = card.querySelector('.as-choice-grid');
    const gr = grid ? grid.getBoundingClientRect() : null;
    return {
      lines, marks,
      topMarks: topMarks.slice(0, 6),
      nTopMarks: topMarks.length,
      gridL: gr ? mm(gr.left - pr.left) : null,
      gridR: gr ? mm(gr.right - pr.left) : null
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('格式=%s  题数=%s', FMT, N);
    console.log('网格 x %s → %s   顶部定标块 %d 个，前 6 心: %s',
      d.gridL, d.gridR, d.nTopMarks, d.topMarks.join(', '));
    d.lines.forEach(L => {
      console.log('\n第 %d 行 (top %s):', L.i, L.top);
      console.log('   题号: %s', L.items.map(x => x.no + '@' + x.cx).join('  '));
      if (L.spacers.length) {
        console.log('   空列: %s', L.spacers.map(s => 'w' + s.w + '@' + s.cx).join('  '));
      }
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
