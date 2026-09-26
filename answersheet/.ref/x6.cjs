const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9615;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 200000);
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
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);
  /* 用一个 210×297 的探针画布跑真 toPdf()，读回每页图像的真实像素高。
     这是唯一不依赖 html2pdf 内部推断的办法。 */
  const E = `(() => {
    window.__R = null;
    try {
      const W = 794, Hh = 1123;              // 一张 A4 的 CSS 像素
      const c = document.createElement('canvas');
      c.width = W; c.height = Hh;
      const c2 = c.getContext('2d');
      c2.fillStyle = '#ddd'; c2.fillRect(0, 0, W, Hh);
      const w = html2pdf().set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.6 },
        jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
      });
      w.prop.canvas = c;
      w.prop.pageSize = null;
      /* toPdf 需要 src 才会走 thenList；给个空 div */
      w.opt.jsPDF = { unit: 'mm', format: [210, 297], orientation: 'portrait' };
      w.toPdf().then(function () {
        const pdf = w.prop.pdf;
        const n = pdf.internal.getNumberOfPages();
        const out = [];
        for (let p = 1; p <= n; p++) {
          pdf.setPage(p);
          out.push({ page: p, w: pdf.internal.pageSize.getWidth(), h: pdf.internal.pageSize.getHeight() });
        }
        window.__R = { pages: n, out: out, ratio: w.prop.pageSize && w.prop.pageSize.inner.ratio,
          innerPx: w.prop.pageSize && w.prop.pageSize.inner.px,
          o: w.prop.pageSize ? Math.floor(c.width * w.prop.pageSize.inner.ratio) : null };
      }).catch(function (e) { window.__R = { ERR: String(e) }; });
      return 'started';
    } catch (e) { return 'THROW ' + e; }
  })()`;
  const r0 = await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
  say('kick =', JSON.stringify(r0.result?.result?.value));
  let m = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: 'window.__R', returnByValue: true }, 15000);
    if (r.result?.result?.value) { m = r.result.result.value; break; }
  }
  say('MEASURED =', JSON.stringify(m, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
