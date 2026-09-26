const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9585;
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
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(4500);
  const E = `(() => {
    /* 挂钩 Choice.build，把每次实参记下来 */
    const Ch = window.AS.choice;
    const orig = Ch.build;
    const seen = [];
    Ch.build = function (o) {
      const out = orig.apply(this, arguments);
      seen.push({ startNo: o.startNo, endNo: o.endNo, rows: o.rows, fromLine: o.fromLine,
                  first: o.first, htmlLen: out.html.length,
                  lines: (out.html.match(/as-choice-line"/g) || []).length,
                  items: (out.html.match(/as-choice-item"/g) || []).length });
      return out;
    };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','300'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8');
    document.getElementById('btnGenerate').click();
    return { seen: seen, dbg: window.AS.paginator.lastDebug.faces.map(f =>
      f.body.map(b => b.kind + ':' + JSON.stringify(
        b.kind === 'choice' ? {rows: b.rows, boxTop: b.boxTop} : {no: b.no}))),
      lr: (function () {
        const C = window.AS.config, G = window.AS.geometry, Pg = window.AS.paginator;
        const p = C.PRESETS.A4;
        const bl = Pg.planBlocks({ preset: p, group: C.GROUPS.A4, faceW: 210,
          choiceTotal: 300, choiceStart: 1, subjItems: [] });
        const cb = bl[0];
        return { planLineRangesLen: cb.lineRanges ? cb.lineRanges.length : null,
                 totalLines: cb.totalLines, rows: cb.rows,
                 planStart: bl[0] && bl.map(b => b.kind),
                 last3: cb.lineRanges ? cb.lineRanges.slice(-3) : null,
                 t14: cb.lineRanges ? cb.lineRanges[14] : null };
      })() };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1500));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
