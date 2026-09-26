const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9623;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
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

  const E1 = `(() => {
    window.__PDF = null;
    const proto = HTMLAnchorElement.prototype, orig = proto.click;
    proto.click = function () { if (this.download && /\\.pdf$/.test(this.download)) {
      window.__PDF = { name: this.download, uri: this.href }; return; } return orig.apply(this, arguments); };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`;
  await send('Runtime.evaluate', { expression: E1, returnByValue: true }, 20000);
  await sleep(1800);
  const rpre = await send('Runtime.evaluate', { expression: `(() => {
    /* 导出前先记录**预览**里关键元素的 mm 坐标（用 offsetTop/offsetHeight ÷ 3.779528） */
    const PPM = 96 / 25.4;
    const S = (document.querySelector('#stage .as-page').offsetWidth) / 210;
    const mm = el => el ? { top: Math.round(el.offsetTop / S * 100) / 100,
                            h: Math.round(el.offsetHeight / S * 100) / 100 } : null;
    const pg = document.querySelector('#stage .as-page');
    const face = pg.querySelectorAll('.as-face')[0];
    const reds = face.querySelectorAll('.as-frame');
    const out = { pageW: pg.offsetWidth, S: Math.round(S * 10000) / 10000, frames: [] };
    face.querySelectorAll('*').forEach(function (el) {
      const cs = getComputedStyle(el);
      if (cs.borderTopWidth !== '0px' && parseFloat(cs.borderTopWidth) > 0 &&
          el.offsetWidth > pg.offsetWidth * 0.6) {
        out.frames.push({ cls: el.className, border: cs.borderTopWidth,
          color: cs.borderTopColor, top: Math.round(el.offsetTop / S * 100) / 100,
          h: Math.round(el.offsetHeight / S * 100) / 100 });
      }
    });
    return out;
  })()`, returnByValue: true }, 20000);
  say('PREVIEW =', JSON.stringify(rpre.result?.result?.value, null, 1));

  await send('Runtime.evaluate', { expression: `document.getElementById('btnPdf').click(); 'clicked'`, returnByValue: true }, 20000);
  let got = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression:
      `(() => window.__PDF ? window.__PDF.uri.length : null)()`, returnByValue: true }, 20000);
    if (r.result?.result?.value) { got = r.result.result.value; break; }
  }
  say('pdf dataURI len =', got);
  if (!got) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }

  /* 在页面内把 PDF 的每一页图像解出来做像素分析。
     pdf.js 没有，但 HTMLImageElement 能直接解码 data URI：
     我们改为分析「导出链路里拼接用的那张大画布」——
     它和进 PDF 的像素是同一份。用 __PDF 反推不方便，
     所以这里改用 Image 解码 + 逐行统计的方式分析拼合前的单张。
     最直接：重新跑一次单张 toCanvas（与导出同参数）并统计。 */
  const E2 = `(() => {
    window.__A = null;
    const pg = document.querySelector('#stage .as-page');
    const w = html2pdf().set({
      margin: 0, image: { type: 'png' },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
    }).from(pg);
    w.toCanvas().then(function () {
      const cv = w.prop.canvas;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const W = cv.width, H = cv.height, PPM = W / 210;
      const mm = px => Math.round(px / PPM * 100) / 100;
      const red = new Array(H).fill(0), blk = new Array(H).fill(0), nw = new Array(H).fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4, r = d[k], g = d[k+1], b = d[k+2];
          if (r > 245 && g > 245 && b > 245) continue;
          nw[y]++;
          if (r > 120 && r - g > 50 && r - b > 50) red[y]++;
          else if (r < 100 && g < 100 && b < 100) blk[y]++;
        }
      }
      function lines(arr, frac) {
        const a = [];
        for (let y = 0; y < H; y++) if (arr[y] > W * frac) a.push(y);
        const out = []; let s = null;
        for (let i = 0; i < a.length; i++) {
          if (s === null) s = a[i];
          if (i === a.length - 1 || a[i+1] !== a[i] + 1) { out.push(mm((s + a[i]) / 2)); s = null; }
        }
        return out;
      }
      let last = null, first = null;
      for (let y = 0; y < H; y++) if (nw[y] > 2) { first = mm(y); break; }
      for (let y = H - 1; y >= 0; y--) if (nw[y] > 2) { last = mm(y); break; }
      window.__A = { canvas: [W, H], firstInkMM: first, lastInkMM: last,
        redLinesMM: lines(red, 0.55), blackLinesMM: lines(blk, 0.55) };
    }).catch(function (e) { window.__A = { ERR: String(e) }; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E2, returnByValue: true }, 20000);
  let a = null;
  for (let i = 0; i < 60; i++) {
    await sleep(800);
    const r = await send('Runtime.evaluate', { expression: 'window.__A', returnByValue: true }, 20000);
    if (r.result?.result?.value) { a = r.result.result.value; break; }
  }
  say('EXPORT-PIXELS =', JSON.stringify(a, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
