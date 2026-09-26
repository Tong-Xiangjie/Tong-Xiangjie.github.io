/* 行间空档：把「上一行末气泡」与「下一行题号」的真实 DOM 上下缘量出来，
   算出可用空隙区间，从而决定空档定位点该放哪。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9471;
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
    const T = e => mm(e.getBoundingClientRect().top - fb.top);
    const B = e => mm(e.getBoundingClientRect().bottom - fb.top);
    const CY = e => { const r = e.getBoundingClientRect();
      return mm((r.top + r.bottom) / 2 - fb.top); };
    const lines = Array.from(face.querySelectorAll('.as-choice-line'));
    const L1 = lines[0], L2 = lines[1];
    if (!L2) return { err: '只有一行，请把题数调大' };
    const l1bub = Array.from(L1.querySelectorAll('.as-bubble'));
    const lastBub = l1bub.reduce((a, b) => B(b) > B(a) ? b : a);
    const l2nums = Array.from(L2.querySelectorAll('.as-choice-num'));
    const firstNum = l2nums.reduce((a, b) => T(b) < T(a) ? b : a);
    const l2bub = Array.from(L2.querySelectorAll('.as-bubble'));
    const firstBubL2 = l2bub.reduce((a, b) => T(b) < T(a) ? b : a);
    const marks = Array.from(face.querySelectorAll('.as-mark-left'))
      .map(e => ({ cy: CY(e), h: mm(e.getBoundingClientRect().height) }))
      .sort((a, b) => a.cy - b.cy);
    const geo = window.AS.geometry, P = window.AS.config.PRESETS.A4;
    return {
      lastBubTop: T(lastBub), lastBubBot: B(lastBub), lastBubCy: CY(lastBub),
      firstNumTop: T(firstNum), firstNumBot: B(firstNum), firstNumCy: CY(firstNum),
      firstBubL2Top: T(firstBubL2), firstBubL2Cy: CY(firstBubL2),
      l1Top: T(L1), l2Top: T(L2),
      marks: marks,
      blockH: geo.bubbleH(P),
      rowPitch: geo.rowPitch(P),
      gapMarkCy: (function () {
        const all = Array.from(face.querySelectorAll('.as-mark-left'))
          .map(e => CY(e)).sort((a, b) => a - b);
        return all[6];
      })(),
      lineH: geo.lineHeight(P), colH: geo.columnHeight(P),
      rowOffsets: geo.rowOffsets(P), NUM_BIAS: geo.NUM_BIAS
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    if (d.err) { console.log(d.err); }
    else {
      console.log('块高 = %s   rowPitch = %s   lineHeight = %s   columnHeight = %s',
        d.blockH, d.rowPitch, d.lineH, d.colH);
      console.log('rowOffsets = %s   NUM_BIAS = %s', d.rowOffsets.join(', '), d.NUM_BIAS);
      console.log('\n行1 top=%s   行2 top=%s   （差 %s，lineHeight=%s）',
        d.l1Top, d.l2Top, Math.round((d.l2Top - d.l1Top) * 1000) / 1000, d.lineH);
      console.log('行1 末气泡: top=%s bot=%s cy=%s', d.lastBubTop, d.lastBubBot, d.lastBubCy);
      console.log('行2 首气泡: top=%s        cy=%s', d.firstBubL2Top, d.firstBubL2Cy);
      console.log('行2 题号  : top=%s bot=%s cy=%s',
        d.firstNumTop, d.firstNumBot, d.firstNumCy);
      const winTop = d.lastBubBot, winBot = d.firstNumTop;
      console.log('\n▶ 可用空隙区间（末气泡底缘 → 题号上缘）= %s → %s，高度 %s',
        winTop, winBot, Math.round((winBot - winTop) * 1000) / 1000);
      console.log('▶ 块高 %s，区间高 %s → %s',
        d.blockH, Math.round((winBot - winTop) * 1000) / 1000,
        (winBot - winTop) >= d.blockH ? '放得下一块' : '** 区间比块还小，必然与上下块相撞 **');
      const mid = Math.round(((winTop + winBot) / 2) * 1000) / 1000;
      console.log('\n▶ 区间中点 = %s', mid);
      console.log('▶ 当前空档块心 = %s', d.gapMarkCy);
      console.log('   到上一块(末气泡) %s，到下一块(题号) %s，块高 %s',
        Math.round((d.gapMarkCy - d.lastBubCy) * 1000) / 1000,
        Math.round((d.firstNumCy - d.gapMarkCy) * 1000) / 1000, d.blockH);
      /* 若把空档块放在区间中点，两侧净空 */
      console.log('\n▶ 若放中点 %s： 上净空 %s   下净空 %s',
        mid,
        Math.round((mid - d.blockH / 2 - d.lastBubBot) * 1000) / 1000,
        Math.round((d.firstNumTop - mid - d.blockH / 2) * 1000) / 1000);
      console.log('\n左侧块心: %s', d.marks.map(m => m.cy).join(', '));
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
