const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9661;
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
    const q = await send('Runtime.evaluate', { expression: 'typeof (window.AS && window.AS.pdfMeasure)', returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'object';
  }
  say('ready =', rdy);
  if (!rdy) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }
  const expr = `(async () => {
    const d = document;
    const set=(i,v)=>{const e=d.getElementById(i);if(e) e.value=v;};
    const seg = d.querySelector('#segFormat button[data-val="A4"]'); if (seg) seg.click();
    const th = d.querySelector('#themePick [data-theme="mono"]'); if (th) th.click();
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','0'); set('choiceStart','1');
    set('subjStart','1'); set('subjCount','3');
    set('subjScore','10,10,10'); set('subjLines','8');
    d.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2600));
    const st = d.getElementById('stage');
    const pages = st.querySelectorAll('.as-page');
    const paper = AS.config.PAPER.A4;
    const m = AS.pdfMeasure.measurePage(pages[1], paper);
    const vert = m.texts.filter(function (t) { return t.vertical; });
    const na = pages[1].querySelector('.as-noanswer-text');
    return {
      vertCount: vert.length,
      vert: vert.map(function (t) {
        return { s: t.text, x: t.x, y: t.y, size: +t.size.toFixed(2), align: t.align };
      }),
      naRect: na ? (function () {
        var r = na.getBoundingClientRect();
        var cs = getComputedStyle(na);
        return { wm: cs.writingMode, to: cs.textOrientation,
                 fs: cs.fontSize, lh: cs.lineHeight, w: r.width, h: r.height,
                 text: na.textContent };
      })() : null,
      /* 标题里的「第」 */
      titleTexts: m.texts.filter(function (t) { return /模拟考试/.test(t.text); })
        .map(function (t) { return { s: t.text, x: t.x, y: t.y, font: t.font, size: t.size }; })
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 120000);
  say('RESULT =', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
