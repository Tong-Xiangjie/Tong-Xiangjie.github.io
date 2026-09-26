/* 探针：非选择题红框的上下沿、框内每题的位置与高度。
   用法：node .ref\subj_probe.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9391;
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
    set('subjStart','13'); set('subjCount','3'); set('subjScore','10,12,12'); set('subjLines','8');
    window.AS.app.generate();
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const rel = e => { const r = e.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left),
               t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };
    const faces = Array.from(card.querySelectorAll('.as-face'));
    return {
      nFaces: faces.length,
      faces: faces.map((fc, i) => {
        const sub = fc.querySelector('.as-subjective');
        const rows = Array.from(fc.querySelectorAll('.as-subj-head')).map(h => ({
          txt: h.textContent.trim().slice(0, 12),
          ...rel(h.parentElement ? h.parentElement.closest('tr') || h.parentElement : h)
        }));
        return {
          i,
          subj: sub ? rel(sub) : null,
          heads: Array.from(fc.querySelectorAll('.as-subj-head')).map(h => ({
            txt: h.textContent.trim().slice(0, 14), ...rel(h)
          })),
          nRows: fc.querySelectorAll('.as-subj-head').length,
          detail: (() => {
            const out = {};
            const g = (sel, k) => { const e = fc.querySelector(sel); if (e) out[k] = rel(e); };
            g('.as-subject-outer', 'outer'); g('.as-subject-header', 'hdr');
            g('.as-subject-inner-table', 'tbl');
            const b = fc.querySelector('.as-subj-body'); if (b) out.body = rel(b);
            const td = fc.querySelector('.as-subject-inner-table td'); if (td) out.td = rel(td);
            const tr = fc.querySelector('.as-subject-inner-table tr'); if (tr) out.tr = rel(tr);
            const tb = fc.querySelector('.as-subject-inner-table tbody'); if (tb) out.tbody = rel(tb);
            return out;
          })(),
          choice: fc.querySelector('.as-choice-section') ? rel(fc.querySelector('.as-choice-section')) : null
        };
      })
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 800));
  } else {
    const d = res.result.result.value;
    console.log('格式=%s  面数=%d', FMT, d.nFaces);
    d.faces.forEach(f => {
      console.log('\n面 %d:', f.i);
      console.log('  选择题红框  ', f.choice ? f.choice.t + ' → ' + f.choice.b : '(无)');
      console.log('  非选择题红框', f.subj ? f.subj.t + ' → ' + f.subj.b +
                  '  (高 ' + (f.subj.b - f.subj.t).toFixed(3) + ')' : '(无)');
      console.log('  框内题头 %d 个:', f.nRows);
      f.heads.forEach(h => console.log('     head    ' + h.t + ' → ' + h.b + '   ' + h.txt));
      if (f.detail) Object.keys(f.detail).forEach(k => {
        const v = f.detail[k];
        console.log('     ' + k.padEnd(7) + ' x ' + String(v.l).padStart(7) + '-' +
                    String(v.r).padStart(7) + '   y ' + String(v.t).padStart(8) + ' → ' +
                    String(v.b).padStart(8) + '  (高 ' + (v.b - v.t).toFixed(3) + ')');
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
