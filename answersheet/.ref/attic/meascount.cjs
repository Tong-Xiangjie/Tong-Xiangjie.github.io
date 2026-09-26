const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9659;
const CFG = JSON.parse(process.env.CFG || '{"format":"A4","theme":"mono","choiceTotal":0,"subjCount":3,"lines":8}');
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
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 400));
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
  const expr = `(async () => {
    const d = document;
    const set=(i,v)=>{const e=d.getElementById(i);if(e) e.value=v;};
    const seg = d.querySelector('#segFormat button[data-val="${CFG.format}"]'); if (seg) seg.click();
    const th = d.querySelector('#themePick [data-theme="${CFG.theme}"]'); if (th) th.click();
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','${CFG.choiceTotal}'); set('choiceStart','1');
    set('subjStart','${CFG.choiceTotal + 1}'); set('subjCount','${CFG.subjCount}');
    set('subjScore','${new Array(CFG.subjCount).fill('10').join(',')}');
    set('subjLines','${CFG.lines}');
    d.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2600));
    const st = d.getElementById('stage');
    const pages = st.querySelectorAll('.as-page');
    const paper = AS.config.PAPER['${CFG.format}'];
    const out = { pages: [], theme: AS.theme.current(), format: AS.app.state.format };
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const m = AS.pdfMeasure.measurePage(p, paper);
      out.pages.push({
        i: i,
        rects: m.strokes.length, fills: m.fills.length, texts: m.texts.length,
        markAny: p.querySelectorAll('.as-mark').length,
        markTop: p.querySelectorAll('.as-mark-top').length,
        markLeft: p.querySelectorAll('.as-mark-left').length,
        corners: p.querySelectorAll('.as-corner').length,
        allDark: Array.from(p.querySelectorAll('*')).filter(function (e) {
          var bg = getComputedStyle(e).backgroundColor;
          return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        }).length,
        head: p.innerHTML.slice(0, 420)
      });
    }
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 120000);
  say('MEASURE =', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails, null, 1));
  logs.filter(l => /EXC|失败/.test(l)).slice(-6).forEach(l => say('  log:', l.slice(0, 250)));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
