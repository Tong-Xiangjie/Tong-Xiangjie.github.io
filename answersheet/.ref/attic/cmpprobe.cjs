const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 9649);
const CFG = JSON.parse(process.env.CFG || '{"format":"A4","theme":"color","choiceTotal":12,"subjCount":2,"lines":6}');
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 280000);
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 700));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/.ref/cmp.html?cb=' + Date.now() }, 30000);
  let rdy = false;
  for (let i = 0; i < 60 && !rdy; i++) {
    await sleep(400);
    const q = await send('Runtime.evaluate', { expression: 'typeof window.runCompare', returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'function';
  }
  say('runCompare ready =', rdy);
  if (!rdy) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }
  const expr = `(async () => { try { return await window.runCompare(${JSON.stringify(CFG)}); }
    catch (e) { return { thrown: String(e && e.stack ? e.stack : e) }; } })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 180000);
  if (r.__to) say('EVAL TIMEOUT');
  say('RESULT =', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails, null, 1));
  logs.filter(l => /答题卡|EXC|Error/i.test(l)).slice(-8).forEach(l => say('  log:', l.slice(0, 260)));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
