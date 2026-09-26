const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9613;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
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
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(5500);
  const E = `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`;
  await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
  await sleep(1500);
  const E2 = `(() => {
    window.__M = null;
    const page = document.querySelector('#stage .as-page');
    const probe = html2pdf().set({ margin: 0,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' } }).from(page);
    probe.toCanvas(page).then(function () {
      const cv = probe.prop.canvas;
      const ps = probe.prop.pageSize;
      const ratio = ps.inner.ratio;
      /* 在页面里**原生重放** html2pdf 的 toPdf() 切页数学，不靠外部推断 */
      const H = cv.height;
      const o = Math.floor(cv.width * ratio);
      const s = Math.ceil(H / o);
      const out = [];
      for (let u = 0; u < s; u++) {
        const last = (u === s - 1);
        let hRow = o, iMM = ps.inner.height;
        if (last && H % o !== 0) { hRow = H % o; iMM = hRow * ps.inner.width / cv.width; }
        out.push({ page: u + 1, slicePx: hRow, mm: Math.round(iMM * 1000) / 1000 });
      }
      window.__M = {
        canvas: [cv.width, cv.height],
        inner: [ps.inner.width, ps.inner.height],
        innerPx: ps.inner.px,
        ratio: ratio,
        H: H, o: o, s: s,
        slices: out
      };
    }).catch(function (e) { window.__M = { ERR: String(e) }; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E2, returnByValue: true }, 20000);
  let m = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: 'window.__M', returnByValue: true }, 15000);
    if (r.result?.result?.value) { m = r.result.result.value; break; }
  }
  say('MEASURED =', JSON.stringify(m, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
