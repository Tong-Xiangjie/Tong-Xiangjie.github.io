const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9605;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
try { require('node:fs').mkdirSync(outDir, { recursive: true }); } catch {}
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
    if (m.method === 'Runtime.consoleAPICalled') logs.push('[t+' + Date.now() % 100000 + '] ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 700));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(5500);
  const E1 = `(() => {
    window.__PDF = null;
    const proto = HTMLAnchorElement.prototype, orig = proto.click;
    proto.click = function () { if (this.download && /\\.pdf$/.test(this.download)) {
      window.__PDF = { name: this.download, uri: this.href }; return; } return orig.apply(this, arguments); };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`;
  await send('Runtime.evaluate', { expression: E1, returnByValue: true });
  await sleep(1200);
  await send('Runtime.evaluate', { expression: `document.getElementById('btnPdf').click(); 'clicked'`, returnByValue: true });
  let got = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression:
      `(() => window.__PDF ? window.__PDF.name + '|' + window.__PDF.uri.length : null)()`, returnByValue: true });
    if (r.result?.result?.value) { got = r.result.result.value; break; }
  }
  console.log('RESULT =', got);
  console.log('--- console (最后 20 条) ---');
  logs.slice(-20).forEach(l => console.log(l.slice(0, 320)));
  if (got) {
    const r = await send('Runtime.evaluate', { expression: 'window.__PDF.uri', returnByValue: true });
    const uri = r.result.result.value;
    const buf = Buffer.from(uri.split(',')[1], 'base64');
    const name = got.split('|')[0];
    writeFileSync(join(outDir, name), buf);
    console.log('WROTE', join(outDir, name), buf.length, 'bytes');
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
