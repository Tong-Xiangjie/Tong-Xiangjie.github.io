const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9619;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 700000);
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
  await send('Network.enable'); await send('Runtime.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);

  /* ── 1. .page-tag 到底在不在导出件里 ── */
  const T = `(() => {
    const pg = document.querySelector('#stage .as-page');
    const wrap = document.querySelector('#stage .page-wrap');
    if (!pg || !wrap) return { err: 'no page' };
    const tag = wrap.querySelector('.page-tag');
    const S = pg.offsetWidth / 210;
    const out = { scale: Math.round(S * 10000) / 10000,
      pageTopMm: null, tagTopMm: null, tagBottomMm: null, tagVisible: !!tag };
    if (tag) {
      const r = tag.getBoundingClientRect();
      const pr = pg.getBoundingClientRect();
      out.tagTopMm = Math.round((r.top - pr.top) / S * 100) / 100;
      out.tagBottomMm = Math.round((r.bottom - pr.top) / S * 100) / 100;
      const cs = getComputedStyle(tag);
      out.tagPos = cs.position; out.tagDisplay = cs.display;
    }
    return out;
  })()`;
  const r0 = await send('Runtime.evaluate', { expression: T, returnByValue: true }, 20000);
  say('TAG =', JSON.stringify(r0.result?.result?.value));

  /* ── 2. 多配置导出：页数 + 尺寸 + 墨迹范围 ── */
  const cases = [
    { fmt: 'A4', theme: 'color', ct: 12, sc: 2 },
    { fmt: 'A4', theme: 'color', ct: 0, sc: 3 },
    { fmt: 'A4', theme: 'mono', ct: 40, sc: 4 },
    { fmt: 'A3', theme: 'color', ct: 40, sc: 4 },
    { fmt: 'A4', theme: 'color', ct: 300, sc: 4 }
  ];
  const results = [];
  for (const c of cases) {
    const pw = c.fmt === 'A3' ? 420 : 210;
    const E = `(() => {
      window.__R = null;
      const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
      document.querySelector('#segFormat button[data-val="${c.fmt}"]').click();
      document.querySelector('#themePick [data-theme="${c.theme}"]').click();
      set('cardTitle','测试卷'); set('cardSubject','物理');
      set('choiceTotal','${c.ct}'); set('choiceStart','1');
      set('subjStart','${c.ct + 1}'); set('subjCount','${c.sc}');
      set('subjScore','${new Array(c.sc).fill('10').join(',')}');
      document.getElementById('btnGenerate').click();
      return document.querySelectorAll('#stage .as-page').length;
    })()`;
    const rg = await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
    const sheets = rg.result?.result?.value;
    await sleep(1800);
    /* 用与导出完全相同的链路逐张 toCanvas，取尺寸 + 墨迹范围 */
    const E2 = `(() => {
      window.__R = null;
      const pages = Array.from(document.querySelectorAll('#stage .as-page'));
      const out = [];
      let chain = Promise.resolve();
      pages.forEach(function (pg, i) {
        chain = chain.then(function () {
          const w = html2pdf().set({
            margin: 0, image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: [${pw}, 297], orientation: '${c.fmt === 'A3' ? 'landscape' : 'portrait'}' }
          }).from(pg);
          return w.toCanvas().then(function () {
            const cv = w.prop.canvas;
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            const W = cv.width, H = cv.height;
            let nonWhite = 0, nw = new Array(H).fill(0);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
              const k = (y * W + x) * 4;
              if (d[k] > 245 && d[k+1] > 245 && d[k+2] > 245) continue;
              nonWhite++; nw[y]++;
            }
            let f = -1, l = -1;
            for (let y = 0; y < H; y++) if (nw[y] > 2) { f = y; break; }
            for (let y = H - 1; y >= 0; y--) if (nw[y] > 2) { l = y; break; }
            const mm = W / ${pw};
            out.push({ i: i + 1, w: W, h: H,
              inkPct: Math.round(nonWhite / (W * H) * 10000) / 100,
              firstMM: Math.round(f / mm * 100) / 100,
              lastMM: Math.round(l / mm * 100) / 100 });
          });
        });
      });
      chain.then(function () { window.__R = out; }).catch(function (e) { window.__R = [{ ERR: String(e) }]; });
      return 'started';
    })()`;
    await send('Runtime.evaluate', { expression: E2, returnByValue: true }, 20000);
    let px = null;
    for (let i = 0; i < 60; i++) {
      await sleep(800);
      const r = await send('Runtime.evaluate', { expression: 'window.__R', returnByValue: true }, 20000);
      if (r.result?.result?.value) { px = r.result.result.value; break; }
    }
    results.push({ config: c, sheets, px });
    say('CASE', JSON.stringify(c), 'sheets =', sheets);
    (px || []).forEach(p => say('   ', JSON.stringify(p)));
  }
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
