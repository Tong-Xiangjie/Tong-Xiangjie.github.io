const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9617;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 400000);
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
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);

  const cfg = {
    theme: process.env.THEME || 'color',
    format: process.env.FMT || 'A4',
    choiceTotal: process.env.CT || '12',
    subjCount: process.env.SC || '2'
  };
  const E1 = `(() => {
    window.__PDF = null;
    const proto = HTMLAnchorElement.prototype, orig = proto.click;
    proto.click = function () { if (this.download && /\\.pdf$/.test(this.download)) {
      window.__PDF = { name: this.download, uri: this.href }; return; } return orig.apply(this, arguments); };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','${cfg.choiceTotal}'); set('choiceStart','1');
    set('subjStart','${+cfg.choiceTotal + 1}'); set('subjCount','${cfg.subjCount}');
    set('subjScore','${new Array(+cfg.subjCount).fill('10').join(',')}'); set('subjLines','6');
    ${cfg.theme === 'mono' ? "document.querySelector('[data-theme=mono]')?.click();" : ''}
    document.getElementById('btnGenerate').click();
    return { pages: document.querySelectorAll('#stage .as-page').length };
  })()`;
  const r1 = await send('Runtime.evaluate', { expression: E1, returnByValue: true }, 20000);
  say('gen =', JSON.stringify(r1.result?.result?.value));
  await sleep(1500);
  /* 先把每张纸单独 toCanvas 出来（与导出同一条链路），再逐张做像素统计。
     这样验的是「PNG/JPEG 里到底有没有东西」，不靠 PDF 解析。 */
  const E2 = `(() => {
    window.__PX = null;
    const pages = Array.from(document.querySelectorAll('#stage .as-page'));
    const out = [];
    let chain = Promise.resolve();
    pages.forEach(function (pg, i) {
      chain = chain.then(function () {
        const w = html2pdf().set({
          margin: 0, image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
        }).from(pg);
        return w.toCanvas().then(function () {
          const cv = w.prop.canvas;
          const c2 = cv.getContext('2d');
          const W = cv.width, H = cv.height;
          const d = c2.getImageData(0, 0, W, H).data;
          let nonWhite = 0, dark = 0, reddish = 0;
          const rowInk = new Array(H).fill(0);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const k = (y * W + x) * 4;
              const r = d[k], g = d[k+1], b = d[k+2];
              if (r > 245 && g > 245 && b > 245) continue;
              nonWhite++; rowInk[y]++;
              if (r < 110 && g < 110 && b < 110) dark++;
              if (r > 130 && r - g > 45 && r - b > 45) reddish++;
            }
          }
          /* 找第一行和最后一行有墨的行 */
          let firstInk = -1, lastInk = -1;
          for (let y = 0; y < H; y++) if (rowInk[y] > 2) { firstInk = y; break; }
          for (let y = H - 1; y >= 0; y--) if (rowInk[y] > 2) { lastInk = y; break; }
          out.push({ page: i + 1, w: W, h: H,
            nonWhitePct: Math.round(nonWhite / (W * H) * 10000) / 100,
            dark, reddish,
            firstInk, lastInk,
            firstInkMM: Math.round(firstInk / (W / 210) * 100) / 100,
            lastInkMM: Math.round(lastInk / (W / 210) * 100) / 100 });
        });
      });
    });
    chain.then(function () { window.__PX = out; })
      .catch(function (e) { window.__PX = [{ ERR: String(e) }]; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E2, returnByValue: true }, 20000);
  let px = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'window.__PX', returnByValue: true }, 20000);
    if (r.result?.result?.value) { px = r.result.result.value; break; }
  }
  say('PIXELS =', JSON.stringify(px, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
