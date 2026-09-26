const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9591;
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
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(4500);
  const E = `(() => {
    window.__CLTRACE = [];
    /* 直接用真实入参跑一次 paginate，避开所有 UI 时序 */
    const C = window.AS.config, G = window.AS.geometry, Pg = window.AS.paginator,
          Page = window.AS.page;
    const p = C.PRESETS.A4;
    const blocks = Pg.planBlocks({ preset: p, group: C.GROUPS.A4, faceW: 210,
      choiceTotal: 300, choiceStart: 1, subjItems: [
        { no: 301, score: 10, lines: 8, lineH: 7.7008 },
        { no: 302, score: 10, lines: 8, lineH: 7.7008 }] });
    const faces = Pg.paginate({ blocks: blocks, preset: p,
      chromeFirst: Page.chromeHeight(true), chromeOther: Page.chromeHeight(false) });
    return {
      chromeFirst: Page.chromeHeight(true),
      trace: window.__CLTRACE,
      faceSummary: faces.map(f => ({
        first: f.first,
        body: f.body.map(b => b.kind === 'choice'
          ? 'choice rows=' + b.rows + ' from=' + b.fromLine + ' no=' + b.startNo + '..' + b.endNo
          : 'subj ' + b.item.no + ' ' + b.lines + 'L') })),
      choiceTotalLines: blocks[0].totalLines,
      choiceRowsField: blocks[0].rows
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1500));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
