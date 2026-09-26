const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9663;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD'); try { chrome.kill(); } catch {} process.exit(3); }, 300000);
(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 40000).then(() => ({ __to: true }))]);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() }, 30000);
  let rdy = false;
  for (let i = 0; i < 60 && !rdy; i++) {
    await sleep(400);
    const q = await send('Runtime.evaluate', { expression: 'typeof (window.AS && window.AS.pdfVector)', returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'object';
  }
  say('ready =', rdy);
  if (!rdy) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }

  /* 直接用页面自己的导出器跑一次，把 draw-list 与服务端的一致性彻底排除 */
  const expr = `(async () => {
    const d = document;
    const set=(i,v)=>{const e=d.getElementById(i);if(e) e.value=v;};
    const seg = d.querySelector('#segFormat button[data-val="A4"]'); if (seg) seg.click();
    const th = d.querySelector('#themePick [data-theme="color"]'); if (th) th.click();
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    d.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2600));
    const st = d.getElementById('stage');
    const paper = AS.config.PAPER.A4;
    const r = await AS.pdfVector.render({ stage: st, format: 'A4', theme: 'color' });
    const P0 = AS.pdfMeasure.measurePage(st.querySelector('.as-page'), paper);
    /* 第一行气泡：量出来的坐标 */
    const fills = P0.fills.filter(function (f) { return /as-bubble/.test(f.cls || ''); });
    const firstBubble = P0.fills.filter(function (f) { return /as-bubble/.test(f.cls||''); })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; }).slice(0, 5);
    const firstTop = P0.fills.filter(function (f) { return /as-mark-top/.test(f.cls||''); })
      .sort(function (a, b) { return a.x - b.x; }).slice(0, 3);
    const corner = P0.fills.filter(function (f) { return /as-corner/.test(f.cls||''); })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; })[0];
    /* 直接从 DOM 量第一行气泡：transform 关掉后 offsetTop */
    const stage = st;
    const savedT = stage.style.transform, savedW = stage.style.width;
    stage.style.transform = 'none'; stage.style.width = 'auto';
    void stage.offsetHeight;
    const pageEl = st.querySelector('.as-page');
    const pr = pageEl.getBoundingClientRect();
    const PXMM = 96 / 25.4;
    const bubbles = Array.prototype.slice.call(pageEl.querySelectorAll('.as-bubble'))
      .map(function (el) {
        var b = el.getBoundingClientRect();
        return { x: +( (b.left - pr.left) / PXMM ).toFixed(4),
                 y: +((b.top  - pr.top ) / PXMM ).toFixed(4),
                 w: +(b.width / PXMM).toFixed(4), h: +(b.height / PXMM).toFixed(4) };
      }).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).slice(0, 5);
    stage.style.transform = savedT; stage.style.width = savedW;
    return {
      svgLike: false,
      measuredFirstBubbles: firstBubble.map(function (f) {
        return { cls: f.cls, x: f.x, y: f.y, w: f.w, h: f.h, color: f.color };
      }),
      domFirstBubbles: bubbles,
      measuredTopMarks: firstTop,
      measuredCorner: corner,
      pageTop: +pr.top.toFixed(3),
      paper: AS.config.PAPER.A4
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 180000);
  const v = r.result?.result?.value;
  say('RESULT =', JSON.stringify(v ?? r.result?.exceptionDetails, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
