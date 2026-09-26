const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 9643);
const OUTPDF = process.env.OUTPDF || 'vector.pdf';
const CFG = JSON.parse(process.env.CFG || '{"format":"A4","theme":"color","choiceTotal":12,"subjCount":2,"lines":6}');
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 300000);
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
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 25000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/.ref/vecprobe.html?cb=' + Date.now() }, 30000);
  /* ⚠ 不能只 sleep 固定时间：CDN 上的两个 bundle 解析完之前
     window.runProbe 还不存在，会报 "not a function"。
     这里轮询等它出现。 */
  let rdy = false;
  for (let i = 0; i < 60 && !rdy; i++) {
    await sleep(400);
    const q = await send('Runtime.evaluate',
      { expression: 'typeof window.runProbe', returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'function';
  }
  say('runProbe ready =', rdy);
  if (!rdy) { say('页面脚本未就绪'); clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }
  const expr = `(async () => { try { return await window.runProbe(${JSON.stringify(CFG)}); }
    catch (e) { return { ok:false, thrown: String(e && e.stack ? e.stack : e) }; } })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 120000);
  if (r.__to) say('EVAL TIMEOUT');
  const v = r.result?.result?.value;
  if (v) {
    const slim = Object.assign({}, v);
    delete slim.uri; delete slim.measure; delete slim.dom;
    say('RESULT =', JSON.stringify(slim, null, 1));
    if (v.uri) {
      const buf = Buffer.from(v.uri.split(',')[1], 'base64');
      writeFileSync(join(outDir, OUTPDF), buf);
      say('WROTE', join(outDir, OUTPDF), buf.length);
    }
    if (v.measure) {
      const mj = join(outDir, OUTPDF.replace(/\.pdf$/, '.measure.json'));
      writeFileSync(mj, JSON.stringify(v.measure));
      say('WROTE', mj);
    }
    /* DOM 真值单独一份 —— 存进 measure.json 里会和「绘制清单」混在一起，
       而这两份是要互相独立比对的，必须分开落盘。 */
    if (v.dom) {
      const dj = join(outDir, OUTPDF.replace(/\.pdf$/, '.dom.json'));
      writeFileSync(dj, JSON.stringify(v.dom));
      say('WROTE', dj, v.dom.pages.map(p => p.boxes.length).join('/') + ' 个元素盒');
    } else if (v.domErr) {
      say('domErr =', v.domErr);
    }
  } else {
    say('RAW =', JSON.stringify(r.result?.exceptionDetails || r, null, 1).slice(0, 1500));
  }
  logs.filter(l => /答题卡|EXC|Error|warning/i.test(l)).slice(-14).forEach(l => say('  log:', l.slice(0, 300)));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
