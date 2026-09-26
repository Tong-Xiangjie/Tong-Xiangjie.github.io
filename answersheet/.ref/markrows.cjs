/* 左侧定位点 vs 右侧每一行：逐行并排，直接看哪一块没跟自己的行对齐、哪两块挤在一起。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9469;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '40';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
        .find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','0');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const R = e => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - fb.top), b: mm(r.bottom - fb.top),
               cy: mm((r.top + r.bottom) / 2 - fb.top), h: mm(r.height) }; };
    /* 左侧每块：cy + 自身高度 */
    const marks = Array.from(face.querySelectorAll('.as-mark-left')).map(R)
      .sort((a, b) => a.cy - b.cy);
    /* 右侧：逐行给出「题号」和 A/B/C/D 各自的行心 */
    const rows = [];   /* {kind, label, cy} */
    const lines = Array.from(face.querySelectorAll('.as-choice-line'));
    lines.forEach(function (l, li) {
      const num = l.querySelector('.as-choice-num');
      if (num) { const r = R(num); rows.push({ line: li, kind: 'num',
        label: num.textContent, cy: r.cy, t: r.t, b: r.b }); }
      const bubs = Array.from(l.querySelectorAll('.as-bubble'));
      const seen = [];
      bubs.forEach(function (b, i) {
        const r = R(b);
        const opt = 'ABCD'[i % 4];
        const qno = bubs.length / 4;
        if (i % 4 === 0) { /* 每道题的第一个选项代表该选项行 */ }
      });
      /* 按行分组：同 cy 的归一个选项行，取第一个气泡的题号 */
      const byCy = [];
      bubs.forEach(function (b, i) {
        const r = R(b);
        const hit = byCy.find(x => Math.abs(x.cy - r.cy) < 0.01);
        if (hit) { hit.n++; } else { byCy.push({ cy: r.cy, t: r.t, b: r.b, n: 1, opt: 'ABCD'[i % 4] }); }
      });
      byCy.sort((a, b2) => a.cy - b2.cy);
      byCy.forEach(x => rows.push({ line: li, kind: 'opt', label: x.opt,
        cy: x.cy, t: x.t, b: x.b, n: x.n }));
    });
    return { marks: marks, rows: rows };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('A4 %s 题\n', NC);
    console.log(' 左侧定位点 (%d 块)             右侧的行                 对齐差', d.marks.length);
    console.log('  idx   块心      块高          行                 行心       (块心−行心)');
    const used = new Set();
    d.marks.forEach(function (m, i) {
      /* 找最近的未占用行 */
      let best = null, bd = 1e9;
      d.rows.forEach(function (r, j) {
        if (used.has(j)) return;
        const dd = Math.abs(r.cy - m.cy);
        if (dd < bd) { bd = dd; best = j; }
      });
      let desc = '（无对应行 —— 行间空档块）', cy = '';
      if (best !== null && bd < 1.0) {
        used.add(best);
        const r = d.rows[best];
        desc = '行' + (r.line + 1) + ' ' + (r.kind === 'num' ? '题号 ' + r.label : r.label + ' 选项行');
        cy = r.cy;
      }
      console.log('  %s  %s  h=%s   %s  %s  %s',
        String(i + 1).padStart(3), String(m.cy).padEnd(8), String(m.h).padEnd(6),
        desc.padEnd(24), String(cy).padEnd(8),
        cy === '' ? '—' : (Math.round((m.cy - cy) * 1000) / 1000));
    });
    console.log('\n▶ 相邻块心间距: %s',
      d.marks.slice(1).map((m, i) => Math.round((m.cy - d.marks[i].cy) * 1000) / 1000).join(', '));
    console.log('▶ 块高: %s', d.marks.map(m => m.h).join(', '));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
