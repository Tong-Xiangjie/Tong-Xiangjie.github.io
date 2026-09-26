const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9611;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
try { require('node:fs').mkdirSync(outDir, { recursive: true }); } catch {}
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 240000);
(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  if (!t) { say('NO TARGET'); process.exit(2); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 700));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p),
    sleep(ms || 15000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 20000);
  await sleep(5500);
  const E1 = `(() => {
    window.__PDF = null;
    const proto = HTMLAnchorElement.prototype, orig = proto.click;
    proto.click = function () { if (this.download && /\\.pdf$/.test(this.download)) {
      window.__PDF = { name: this.download, uri: this.href }; return; } return orig.apply(this, arguments); };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    const fmt = '${process.env.FMT || 'A4'}';
    const theme = '${process.env.THEME || 'color'}';
    const ct = '${process.env.CT || '12'}';
    const sc = '${process.env.SC || '2'}';
    document.querySelector('#segFormat button[data-val="' + fmt + '"]').click();
    document.querySelector('#themePick [data-theme="' + theme + '"]').click();
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal', ct); set('choiceStart','1');
    set('subjStart', String(Number(ct) + 1)); set('subjCount', sc);
    const scs = []; for (let i = 0; i < Number(sc); i++) scs.push('10');
    set('subjScore', scs.join(',')); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return { pages: document.querySelectorAll('#stage .as-page').length };
  })()`;
  const r1 = await send('Runtime.evaluate', { expression: E1, returnByValue: true }, 20000);
  say('gen =', JSON.stringify(r1.result?.result?.value));
  await sleep(1200);
  await send('Runtime.evaluate', { expression: `document.getElementById('btnPdf').click(); 'clicked'`, returnByValue: true }, 20000);
  let got = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression:
      `(() => window.__PDF ? window.__PDF.name + '|' + window.__PDF.uri.length : null)()`, returnByValue: true }, 15000);
    if (r.__to) { say('eval timeout at', i); break; }
    if (r.result?.result?.value) { got = r.result.result.value; break; }
  }
  say('RESULT =', got);
  say('--- console ---');
  logs.slice(-25).forEach(l => say('  ' + l.slice(0, 300)));
  if (got) {
    const r = await send('Runtime.evaluate', { expression: 'window.__PDF.uri', returnByValue: true }, 30000);
    const uri = r.result.result.value;
    const buf = Buffer.from(uri.split(',')[1], 'base64');
    const name = got.split('|')[0];
    writeFileSync(join(outDir, name), buf);
    say('WROTE', join(outDir, name), buf.length, 'bytes');
  }
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
