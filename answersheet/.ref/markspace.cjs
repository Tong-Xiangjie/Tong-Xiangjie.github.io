/* 把左侧定位点的**相邻间距**逐段列出来，定位「不均匀」在哪一段。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9467;
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
    const CY = e => { const r = e.getBoundingClientRect();
      return mm((r.top + r.bottom) / 2 - fb.top); };
    const G = window.AS.geometry, P = window.AS.config.PRESETS.A4;
    const L = window.AS.__faces[0];
    /* right side: per line, the number row center and each bubble row center */
    const lines = Array.from(face.querySelectorAll('.as-choice-line')).map(function (l, i) {
      const num = l.querySelector('.as-choice-num');
      const bubs = Array.from(l.querySelectorAll('.as-bubble'));
      const byRow = [];
      bubs.forEach(function (b) { const c = CY(b);
        if (!byRow.some(x => Math.abs(x.c - c) < 1e-6)) byRow.push({ c: c, n: 0 });
        byRow.find(x => Math.abs(x.c - c) < 1e-6).n++;
      });
      byRow.sort((a,b)=>a.c-b.c);
      return { i: i, numCy: num ? CY(num) : null,
               bubRows: byRow.map(x => x.c) };
    });
    const marks = Array.from(face.querySelectorAll('.as-mark-left')).map(CY);
    /* 网格用的定位点 = 去掉「缺考框」那一块（最上面、离网格最远的那块） */
    const gridMarks = marks.slice(1);
    const geo = { rowOffsets: G.rowOffsets(P), lineH: G.lineHeight(P),
                  gapOff: G.lineGapMarkOffset(P), bubbleH: G.bubbleH(P),
                  colH: G.columnHeight(P), gridTop: L.gridTop,
                  rowCenters: L.rowCenters };
    return { lines: lines, marks: marks, gridMarks: gridMarks, geo: geo,
             absentCy: marks[0] };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('A4 %s 题   bubbleH=%s columnHeight=%s rowOffsets=%s',
      NC, d.geo.bubbleH, d.geo.colH, d.geo.rowOffsets.join(', '));
    console.log('缺考框定位点 cy=%s（在网格之上，不参与网格节距）', d.absentCy);
    console.log('\n── 右侧每一行的行心 ──────────────────────────────');
    d.lines.forEach(function (l) {
      console.log('  行%d  题号行心 %s   气泡行心 %s', l.i + 1, l.numCy, l.bubRows.join(', '));
    });
    console.log('\n── 左侧定位点逐段间距 ────────────────────────────');
    console.log('序号  块心      与上一块的间距');
    d.gridMarks.forEach(function (m, i) {
      const gap = i === 0 ? null : Math.round((m - d.gridMarks[i - 1]) * 1000) / 1000;
      console.log('%s  %s  %s', String(i + 1).padStart(4), m, gap === null ? '—' : gap);
    });
    console.log('\n▶ 段距集合: %s',
      d.gridMarks.slice(1).map((m, i) =>
        Math.round((m - d.gridMarks[i]) * 1000) / 1000).join(', '));
    /* 右侧：行内题号→A 与 A→B 的间距 */
    console.log('\n── 右侧行内行心间距 ──────────────────────────────');
    d.lines.forEach(function (l) {
      const all = [l.numCy].concat(l.bubRows);
      const segs = all.slice(1).map((c, i) => Math.round((c - all[i]) * 1000) / 1000);
      console.log('  行%d: %s', l.i + 1, segs.join(', '));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
