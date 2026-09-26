const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9625;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 500000);
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
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);
  await send('Runtime.evaluate', { expression: `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`, returnByValue: true }, 20000);
  await sleep(1800);

  /* 对同一张纸分别走 png / jpeg(0.98) / jpeg(0.92) / jpeg(0.85)，
     读回脏（jpg 往返）后的像素，统计关键要素是否还「成形」。 */
  const E = `(() => {
    window.__C = null;
    const pg = document.querySelector('#stage .as-page');
    const modes = [
      { tag: 'png',  image: { type: 'png' } },
      { tag: 'j98',  image: { type: 'jpeg', quality: 0.98 } },
      { tag: 'j92',  image: { type: 'jpeg', quality: 0.92 } },
      { tag: 'j85',  image: { type: 'jpeg', quality: 0.85 } }
    ];
    const out = [];
    let chain = Promise.resolve();
    modes.forEach(function (m) {
      chain = chain.then(function () {
        const w = html2pdf().set({
          margin: 0, image: m.image,
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
        }).from(pg);
        return w.toCanvas().then(function () {
          const cv = w.prop.canvas;
          const W = cv.width, H = cv.height, PPM = W / 210;
          const mm = px => Math.round(px / PPM * 1000) / 1000;
          const d = cv.getContext('2d').getImageData(0, 0, W, H).data;
          const at = (x, y) => { const k = (y * W + x) * 4; return [d[k], d[k+1], d[k+2]]; };
          /* 1) 顶部定位点带：找每一列的红色像素数，看 29 个点是否各自成形 */
          /*    定位点是**黑色**块，取 y = 10.5mm 那一行扫过去 */
          const yMark = Math.round(10.5 * PPM);
          const runs = []; let s = -1;
          for (let x = 0; x < W; x++) {
            const c = at(x, yMark);
            const dark = c[0] < 150 && c[1] < 150 && c[2] < 150;
            if (dark && s < 0) s = x;
            if (!dark && s >= 0) { runs.push([s, x - 1]); s = -1; }
          }
          if (s >= 0) runs.push([s, W - 1]);
          /* 2) 红框线：在 x = 50mm 处沿 y 扫，找红色段（红框左右两侧的横线的 y） */
          const xCol = Math.round(50 * PPM);
          const redRuns = []; s = -1;
          for (let y = 0; y < H; y++) {
            const c = at(xCol, y);
            const isRed = c[0] > 110 && (c[0] - c[1]) > 40 && (c[0] - c[2]) > 40;
            if (isRed && s < 0) s = y;
            if (!isRed && s >= 0) { redRuns.push([mm(s), mm(y - 1), y - s]); s = -1; }
          }
          if (s >= 0) redRuns.push([mm(s), mm(H - 1), H - s]);
          /* 3) 黑框线：同一条 x 列上的黑色段 */
          const blkRuns = []; s = -1;
          for (let y = 0; y < H; y++) {
            const c = at(xCol, y);
            const isBlk = c[0] < 110 && c[1] < 110 && c[2] < 110;
            if (isBlk && s < 0) s = y;
            if (!isBlk && s >= 0) { blkRuns.push([mm(s), mm(y - 1), y - s]); s = -1; }
          }
          if (s >= 0) blkRuns.push([mm(s), mm(H - 1), H - s]);
          /* 4) 定位点对比度：取第一个点中心，看最黑像素值 */
          let minLum = 255;
          if (runs.length) {
            const cx = Math.round((runs[0][0] + runs[0][1]) / 2);
            for (let y = yMark - 8; y <= yMark + 8; y++) {
              const c = at(cx, y);
              const lum = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
              if (lum < minLum) minLum = lum;
            }
          }
          out.push({ tag: m.tag,
            markCount: runs.length,
            markWidthsMM: runs.slice(0, 4).map(function (r) { return mm(r[1] - r[0] + 1); }),
            markMinLum: Math.round(minLum),
            redSegMM: redRuns.map(function (r) { return [r[0], r[1]]; }),
            blkSegMM: blkRuns.map(function (r) { return [r[0], r[1]]; })
          });
        });
      });
    });
    chain.then(function () { window.__C = out; }).catch(function (e) { window.__C = [{ ERR: String(e) }]; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
  let c = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'window.__C', returnByValue: true }, 25000);
    if (r.result?.result?.value) { c = r.result.result.value; break; }
  }
  say('COMPARE =', JSON.stringify(c, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
