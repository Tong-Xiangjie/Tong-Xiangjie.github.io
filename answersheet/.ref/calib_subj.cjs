/* 标定「非选择题单题高」的真实公式：在 1/4/8/12/16 行上各量一次 DOM 高度，
   反推 itemHeight(lines) = A + lines × B 的 A、B。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9505;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL }); await sleep(5000);

  const run = async (lines) => {
    const E = `(() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','0'); set('choiceStart','1');
      set('subjStart','21'); set('subjCount','1');
      set('subjScore','10'); set('subjLines','${lines}');
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const face = document.querySelector('.preview-stage .as-page .as-face');
      const fb = face.getBoundingClientRect();
      const S = fb.width / 210;
      const mm = v => Math.round((v / S) * 1000) / 1000;
      const trs = Array.from(face.querySelectorAll('.as-subject-inner-table tr'));
      const table = face.querySelector('.as-subject-inner-table');
      const head = face.querySelector('.as-subject-header');
      const outer = face.querySelector('.as-subject-outer');
      const R = e => { if (!e) return null; const q = e.getBoundingClientRect();
        return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top), h: mm(q.height) }; };
      return {
        lines: ${lines},
        rows: trs.map(R),
        table: R(table), head: R(head), outer: R(outer),
        vars: (() => { const cs = getComputedStyle(face); const o = {};
          ['--answer-line-h','--inner-pad-y','--subj-head-h','--subj-head-mb',
           '--subj-header-h','--subj-header-mb','--subj-pad-y','--subj-pad-y-bottom',
           '--box-border','--subj-box-gap'].forEach(v => o[v] = cs.getPropertyValue(v).trim());
          return o; })(),
        itemHeightAPI: (() => { const S2 = window.AS.subject;
          return { h: S2.itemHeight(${lines}, 7.7), HEAD_H: S2.HEAD_H, cellPad: S2.cellPad() }; })()
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 600)); return null; }
    return r.result.result.value;
  };

  const rows = [];
  for (const L of [1, 2, 4, 6, 8, 10, 12, 16]) {
    const d = await run(L);
    if (d) rows.push(d);
  }
  console.log('── 单题（非选择题）实高标定 ─────────────────────────');
  console.log('lines | tr.h  | table.h | 反推 A+lines*B | API 算的 | 差');
  const pts = [];
  rows.forEach(d => {
    const tr = d.rows[0];
    if (!tr) return;
    pts.push([d.lines, tr.h]);
    console.log('%5d | %6s | %7s |                | %8s | %s',
      d.lines, tr.h, d.table ? d.table.h : '-', d.itemHeightAPI.h,
      Math.round((tr.h - d.itemHeightAPI.h) * 1000) / 1000);
  });
  // 最小二乘拟合 tr.h = A + lines*B
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0);
  const sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const B = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const A = (sy - B * sx) / n;
  console.log('\n拟合 tr.h = %s + %s × lines', A.toFixed(4), B.toFixed(4));
  console.log('残差:');
  pts.forEach(([x, y]) => console.log('   lines=%d  实测 %.3f  拟合 %.3f  差 %.3f',
    x, y, A + B * x, y - (A + B * x)));
  console.log('\nCSS 变量:', JSON.stringify(rows[0] && rows[0].vars, null, 1));
  console.log('\n结构（12 行那次）:');
  const last = rows[rows.length - 1];
  console.log('  outer %s  head %s  table %s',
    JSON.stringify(last.outer), JSON.stringify(last.head), JSON.stringify(last.table));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
