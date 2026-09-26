const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9521;
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
  await sleep(5000);
  const E = `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e)e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','300'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const dbg = window.AS.paginator.lastDebug;
    const html = document.getElementById('stage').innerHTML;
    return {
      choiceTotalRead: document.getElementById('choiceTotal').value,
      faceCountDbg: dbg ? dbg.faces.length : null,
      pagesInHtml: (html.match(/class="page-wrap"/g) || []).length,
      facesInHtml: (html.match(/class="as-face"/g) || []).length,
      htmlLen: html.length,
      firstPageCount: (html.match(/class="as-page"/g) || []).length,
      dbgFaces: dbg ? dbg.faces.map(f => f.body.map(b => b.kind + ':' + (b.rows || b.lines)).join(',')) : null
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1500));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
