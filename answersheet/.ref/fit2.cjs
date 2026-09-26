/* 用 stretch=0 的稳定态，回归「游标 → 真实红框底」。
   自变量试两种：本面非选择题**行数** 与 **题数**。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9513;
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

  const run = async (nc, ns, nl) => {
    const E = `(() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','${nc}'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','${ns}');
      set('subjScore', Array.from({length:${ns}},()=>'10').join(','));
      set('subjLines', Array.from({length:${ns}},()=>'${nl}').join(','));
      document.getElementById('btnGenerate').click();
      /* 压掉下拉，量「未下拉」的稳定态 */
      const faceEl = document.querySelector('.preview-stage .as-page .as-face');
      const bodies = faceEl.querySelectorAll('.as-subj-body');
      Array.from(bodies).forEach(function (b) {
        b.style.height = (b.dataset.h ? +b.dataset.h : parseFloat(getComputedStyle(b).height) / 3.7795275591) + 'mm';
      });
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const out = [];
      const dbg = window.AS.paginator.lastDebug;
      const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
      let fi = 0;
      pages.forEach(function (pg) {
        pg.querySelectorAll('.as-face').forEach(function (fe) {
          const fb = fe.getBoundingClientRect();
          const S = fb.width / 210;
          const mm = v => Math.round((v / S) * 1000) / 1000;
          const red = fe.querySelector('.as-subject-outer');
          const trs = fe.querySelectorAll('.as-subject-inner-table tr');
          const d = dbg.faces[fi];
          const subs = d ? d.body.filter(b => b.kind === 'subj') : [];
          out.push({
            face: fi + 1,
            hasSubj: !!red,
            cursor: d ? d.cursor : null,
            rows: subs.length,
            lines: subs.reduce((a, b) => a + b.lines, 0),
            frameBot: red ? mm(red.getBoundingClientRect().bottom - fb.top) : null,
            trCount: trs.length
          });
          fi++;
        });
      });
      return out;
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 400)); return null; }
    return r.result.result.value;
  };

  const cases = [];
  for (const nc of [0, 12, 40]) {
    for (const ns of [1, 2, 3, 4]) {
      for (const nl of [6, 8, 10]) cases.push([nc, ns, nl]);
    }
  }
  const rows = [];
  for (const c of cases) {
    const d = await run(c[0], c[1], c[2]);
    if (!d) continue;
    d.forEach(f => { if (f.hasSubj && f.cursor !== null) rows.push({ ...f, nc: c[0], ns: c[1], nl: c[2] }); });
  }
  console.log('选择|题|行|面| 题数| 行数| 游标 | 红框底 | off | off−2.5×题数 | off/行数');
  rows.forEach(f => {
    const off = Math.round((f.frameBot - f.cursor) * 1000) / 1000;
    console.log(String(f.nc).padStart(4) + '|' + String(f.ns).padStart(2) + '|' +
      String(f.nl).padStart(2) + '|' + String(f.face).padStart(2) + '|' +
      String(f.rows).padStart(4) + '|' + String(f.lines).padStart(5) + '|' +
      String(f.cursor).padStart(8) + '|' + String(f.frameBot).padStart(7) + '|' +
      String(off).padStart(6) + '|' + String(Math.round((off - 2.5 * f.rows) * 1000) / 1000).padStart(15) +
      '|' + (f.lines ? (off / f.lines).toFixed(4) : '—'));
  });
  // 回归：off = A + B*rows + C*lines
  const n = rows.length;
  const offs = rows.map(f => f.frameBot - f.cursor);
  const X = rows.map(f => [1, f.rows, f.lines]);
  // 解 3x3 正规方程
  const XtX = [[0,0,0],[0,0,0],[0,0,0]], Xty = [0,0,0];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) XtX[a][b] += X[i][a] * X[i][b];
      Xty[a] += X[i][a] * offs[i];
    }
  }
  const det3 = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
                  - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
                  + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D = det3(XtX);
  const solve = (col) => {
    const m = XtX.map(r => r.slice());
    for (let i = 0; i < 3; i++) m[i][col] = Xty[i];
    return det3(m) / D;
  };
  const A = solve(0), B = solve(1), C = solve(2);
  console.log('\n回归 off = ' + A.toFixed(4) + ' + ' + B.toFixed(4) + '×题数 + ' + C.toFixed(4) + '×行数');
  let worst = 0;
  rows.forEach(f => {
    const pred = A + B * f.rows + C * f.lines;
    const err = (f.frameBot - f.cursor) - pred;
    worst = Math.max(worst, Math.abs(err));
  });
  console.log('最大残差 =', worst.toFixed(3), 'mm');
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
