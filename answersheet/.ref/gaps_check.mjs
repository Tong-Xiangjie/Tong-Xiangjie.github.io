/* 量页眉三行（标题 / 信息 / 注意事项）与三个正文版块之间的**净间距**。
   用法：node .ref\gaps_check.mjs [A4|A3] [mono] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9387;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const THEME = process.argv[3] || 'color';

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
    const th = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (th) th.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','2026届高三第二次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','3'); set('subjScore','10,12,12'); set('subjLines','8');
    window.AS.app.generate();
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const box = sel => { const e = card.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };
    return {
      title: box('.as-head-title'),
      info:  box('.as-info'),
      note:  box('.as-note-row'),
      head:  box('.as-head'),
      choice: box('.as-choice-section'),
      subj:  box('.as-subjective'),
      footer: box('.as-footer')
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 700));
    ws.close(); chrome.kill(); process.exit(1);
  }
  const d = res.result.result.value;
  const gap = (a, b) => (a && b) ? Math.round((b.t - a.b) * 1000) / 1000 : null;

  console.log('format=%s theme=%s', FMT, THEME);
  console.log('\n--- 各块上下沿（mm，相对纸面顶）---');
  ['title', 'info', 'note', 'head', 'choice', 'subj', 'footer'].forEach(k => {
    if (!d[k]) { console.log('  %s  (无)', k.padEnd(8)); return; }
    console.log('  ' + k.padEnd(8) + '  ' + String(d[k].t).padStart(8) + ' → ' +
                String(d[k].b).padStart(8) + '   (高 ' +
                (Math.round((d[k].b - d[k].t) * 1000) / 1000) + ')');
  });

  console.log('\n--- 净间距（mm）---');
  const rows = [
    ['标题行 → 信息行', gap(d.title, d.info)],
    ['信息行 → 注意事项', gap(d.info, d.note)],
    ['注意事项 → 选择题', gap(d.note, d.choice)],
    ['选择题 → 非选择题', gap(d.choice, d.subj)],
    ['非选择题 → 页脚', gap(d.subj, d.footer)]
  ];
  let zero = 0;
  rows.forEach(([label, v]) => {
    const flag = (v !== null && v < 0.5) ? '   ← 间距为 0！' : '';
    if (flag) zero++;
    console.log('  ' + label.padEnd(20) + '  ' + String(v).padStart(8) + flag);
  });
  console.log('\n间距为 0 的处数: ' + zero);

  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
