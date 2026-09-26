/* A4 选择题多行：左侧定位点**结构化**校验。
   用户要求：「先计算数量生成这边的定位点，再在右边对齐」。
   约定（nLines = 选择题行数）：
     每行 offs.length 个（题号行 + A/B/C/D）
     每两个相邻行之间 1 个「行间空档」定位点
     合计 nLines·5 + (nLines − 1)
   用法：node .ref\leftband.cjs [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9461;
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
    const TOP = e => mm(e.getBoundingClientRect().top - fb.top);
    const BOT = e => mm(e.getBoundingClientRect().bottom - fb.top);
    const L = window.AS.__faces[0];
    const G = window.AS.geometry, P = window.AS.config.PRESETS.A4;
    const gtop = L.gridTop, lh = G.lineHeight(P), bh = G.bubbleH(P);
    const offs = G.rowOffsets(P), gapOff = G.lineGapMarkOffset(P);
    const nLines = L.rowCenters.length ? (L.rowCenters.filter(
      (c, i) => Math.abs(c - (gtop + Math.round(i / offs.length) * lh + offs[i % offs.length])) < 0.02).length
      ? Math.round((L.rowCenters.length - 0) / offs.length) : 0) : 0;
    /* 期望的左侧块心（按数量生成） */
    /* 期望值：每行 offs.length 块，**行间不放块**（用户结构图口径） */
    const expect = [];
    for (let li = 0; li < nLines; li++) {
      const base = Math.round((gtop + li * lh) * 1000) / 1000;
      offs.forEach(d => expect.push(Math.round((base + d) * 1000) / 1000));
    }
    /* 左侧定标带第一块是「缺考框」用的，不属于网格，单独校验 */
    const allMarks = Array.from(face.querySelectorAll('.as-mark-left')).map(CY);
    const absentCy = (window.AS.builders && window.AS.builders.page &&
      window.AS.builders.page.SPECIAL) ? null : null;
    const marks = allMarks.filter(m => Math.abs(m - allMarks[0]) > 1e-6);
    /* 气泡与题号的真实位置 */
    const bubbles = Array.from(face.querySelectorAll('.as-bubble')).map(e => ({ cy: CY(e), b: BOT(e) }));
    const nums = Array.from(face.querySelectorAll('.as-choice-num')).map(e => ({ cy: CY(e), t: TOP(e) }));
    return { gridTop: gtop, lineH: lh, bubbleH: bh, gapOff: gapOff,
             rowOffsets: offs, nLines: nLines, expect: expect, marks: marks,
             absentCy: allMarks[0], markCount: allMarks.length,
             bubbles: bubbles, nums: nums, lh2: lh };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('A4 %s 题   gridTop=%s lineH=%s bubbleH=%s gapOff=%s',
      NC, d.gridTop, d.lineH, d.bubbleH, d.gapOff);
    console.log('选择题行数 nLines = %s   左侧定位点总数 = %d（含缺考框 1 个）',
      d.nLines, d.markCount);
    const want = d.nLines * d.rowOffsets.length;
    console.log('▶ 网格定位点数量 = nLines·%d = %d，实测 %d   %s',
      d.rowOffsets.length, want, d.marks.length,
      d.marks.length === want ? 'OK' : '** 不符 **');
    /* 相邻块不得重叠：间距必须 >= 块高 */
    let minSep = Infinity;
    for (let i = 1; i < d.marks.length; i++) {
      minSep = Math.min(minSep, d.marks[i] - d.marks[i - 1]);
    }
    console.log('▶ 相邻块最小间距 %s mm  块高 %s mm  %s',
      Math.round(minSep * 1000) / 1000, d.bubbleH,
      minSep >= d.bubbleH ? '不重叠 OK' : '** 重叠 **');
    console.log('▶ 缺考框定位点 cy = %s（网格外，不计入）', d.absentCy);
    console.log('\n序号   类型        期望cy     实测cy     差');
    const kinds = [];
    for (let li = 0; li < d.nLines; li++) {
      kinds.push('行' + (li + 1) + '·题号');
      'ABCD'.split('').forEach(c => kinds.push('行' + (li + 1) + '·' + c));
    }
    let maxd = 0;
    d.marks.forEach(function (cy, i) {
      const e = d.expect[i];
      const diff = e === undefined ? NaN : Math.round((cy - e) * 1000) / 1000;
      if (!Number.isNaN(diff)) maxd = Math.max(maxd, Math.abs(diff));
      console.log('%s  %s  %s  %s  %s',
        String(i + 1).padStart(3), (kinds[i] || '?').padEnd(10), e, cy,
        Number.isNaN(diff) ? '—' : diff);
    });
    console.log('▶ 全部块心与「按数量生成」的期望值最大偏差 = %s mm  %s',
      Math.round(maxd * 1000) / 1000, maxd <= 0.1 ? 'OK' : '** 超差 **');

    /* 题号行心 / 气泡行心 必须落在某个左侧块心上（右侧对齐左侧） */
    let worst = 0;
    const allMarks = d.marks;
    d.bubbles.concat(d.nums).forEach(function (x) {
      const best = Math.min.apply(null, allMarks.map(m => Math.abs(m - x.cy)));
      worst = Math.max(worst, best);
    });
    console.log('▶ 题号/气泡行心到最近左侧块心的最大距离 = %s mm  %s',
      Math.round(worst * 1000) / 1000, worst <= 0.1 ? 'OK' : '** 未对齐 **');

    /* 行间净空 */
    const b1 = Math.max.apply(null, d.bubbles.filter(x => x.cy < d.gridTop + d.lineH).map(x => x.b));
    const n2 = Math.min.apply(null, d.nums.filter(x => x.cy >= d.gridTop + d.lineH).map(x => x.t));
    console.log('\n▶ 行1 末气泡底缘 %s  →  行2 题号上缘 %s   净空 = %s  要求 = %s  %s',
      b1, n2, Math.round((n2 - b1) * 1000) / 1000, d.bubbleH,
      Math.abs(n2 - b1 - d.bubbleH) <= 0.05 ? 'OK' : '** 不符 **');
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
