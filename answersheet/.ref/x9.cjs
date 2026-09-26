const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9621;
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
  const E = `(() => {
    window.__G = null;
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    /* 与导出完全相同的包装流程 */
    const stage = document.getElementById('stage');
    const wrap = document.createElement('div');
    wrap.className = 'as-export-wrap';
    wrap.style.background = '#fff';
    wrap.innerHTML = stage.innerHTML;
    document.body.appendChild(wrap);
    Theme.apply(wrap, state.theme);
    Theme.applyPreset(wrap, C.PRESETS[state.format], state.format);
    Theme.applyFonts(wrap);
    wrap.querySelectorAll('.as-page').forEach(function (el) {
      Theme.apply(el, state.theme);
      Theme.applyPreset(el, C.PRESETS[state.format], state.format);
      Theme.applyFonts(el);
    });
    wrap.querySelectorAll('.as-face-guide').forEach(function (el) { el.style.display = 'none'; });
    wrap.querySelectorAll('.page-tag').forEach(function (el) { el.style.display = 'none'; });
    wrap.querySelectorAll('.preview-stage').forEach(function (el) {
      el.style.transform = 'none'; el.style.width = 'auto';
    });
    const pg = wrap.querySelector('.as-page');
    const cw = pg.offsetWidth;                    // 未缩放，CSS px
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
      /* 逐行统计：红像素（红框/红字）、黑像素、非白像素 */
      const rows = [];
      for (let y = 0; y < H; y++) {
        let red = 0, blk = 0, nw = 0;
        for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4, r = d[k], g = d[k+1], b = d[k+2];
          if (r > 245 && g > 245 && b > 245) continue;
          nw++;
          if (r > 120 && r - g > 50 && r - b > 50) red++; else if (r < 100 && g < 100 && b < 100) blk++;
        }
        rows.push([red, blk, nw]);
      }
      /* 找「几乎是横线」的行：该行红色像素占比 > 60% 画宽 */
      const redLines = [], blkLines = [];
      for (let y = 0; y < H; y++) {
        if (rows[y][0] > W * 0.55) redLines.push(y);
        if (rows[y][1] > W * 0.55) blkLines.push(y);
      }
      /* 把连续行并成一条线，取中心 */
      function group(a) {
        const out = []; let s = null;
        for (let i = 0; i < a.length; i++) {
          if (s === null) s = a[i];
          if (i === a.length - 1 || a[i+1] !== a[i] + 1) { out.push([s, a[i]]); s = null; }
        }
        return out.map(function (g) { return mm((g[0] + g[1]) / 2); });
      }
      window.__G = {
        canvas: [W, H],
        redBoxLinesMM: group(redLines),
        blackBoxLinesMM: group(blkLines),
        /* 页脚：最底部那一簇非白像素的行范围 */
        lastInkMM: (function () { for (let y = H-1; y >= 0; y--) if (rows[y][2] > 2) return mm(y); return null; })()
      };
    }).catch(function (e) { window.__G = { ERR: String(e) }; });
    return 'started';
  })()`;
  const r0 = await send('Runtime.evaluate', { expression: E, returnByValue: true }, 25000);
  say('kick =', JSON.stringify(r0.result?.result?.value));
  let g = null;
  for (let i = 0; i < 60; i++) {
    await sleep(800);
    const r = await send('Runtime.evaluate', { expression: 'window.__G', returnByValue: true }, 20000);
    if (r.result?.result?.value) { g = r.result.result.value; break; }
  }
  say('GEOM =', JSON.stringify(g, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
