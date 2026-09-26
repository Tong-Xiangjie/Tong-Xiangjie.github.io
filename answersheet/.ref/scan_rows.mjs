/* 逐行像素扫描：把「所有左侧定标块」与「所有气泡行」的真实 y 全部列出来，
   再算最近邻偏差。不做任何过滤猜测 —— 目的是看全貌，而不是确认某个假设。
   用法：node .ref\scan_rows.mjs [A4|A3] [color|mono] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9351;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const THEME = process.argv[3] || 'color';
const OUT = process.argv[4] || '.ref/scan_rows.txt';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      target = (await r.json()).find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  if (!target) throw new Error('no chrome target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const EXPR = `(async () => {
    const C = window.AS.config, Theme = window.AS.theme;
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const t = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (t) t.click();
    if (typeof generate === 'function') generate();
    await new Promise(r => setTimeout(r, 700));

    const stage = document.getElementById('stage');
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '0'; wrap.style.top = '0'; wrap.style.zIndex = '-1';
    wrap.innerHTML = stage.innerHTML;
    document.body.appendChild(wrap);
    Theme.apply(wrap, window.AS.app.state.theme);
    Theme.applyPreset(wrap, C.PRESETS[window.AS.app.state.format], window.AS.app.state.format);
    Theme.applyFonts(wrap);
    wrap.querySelectorAll('.preview-stage').forEach(el => { el.style.transform = 'none'; });

    const card = wrap.querySelector('.as-page');
    const cv = await html2pdf().set({
      margin: 0, image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' }
    }).from(card).toCanvas().get('canvas');
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, W, H).data;
    const paperW = ${FMT === 'A3' ? 420 : 210};
    const mm = W / paperW;
    wrap.remove();

    const isInk = (i) => d[i] < 210 && d[i+1] < 210 && d[i+2] < 210;
    const profile = (x0mm, x1mm) => {
      const x0 = Math.round(x0mm*mm), x1 = Math.round(x1mm*mm);
      const rows = [];
      for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) { if (isInk((y*W+x)*4)) n++; }
        rows.push(n);
      }
      const runs = []; let s = -1;
      for (let i = 0; i <= rows.length; i++) {
        const v = i < rows.length ? rows[i] : 0;
        if (v > 0) { if (s < 0) s = i; }
        else if (s >= 0) { runs.push([s, i-1]); s = -1; }
      }
      return runs.map(([a,b]) => ({
        cy: Math.round(((a+b)/2)/mm*100)/100,
        h: Math.round((b-a+1)/mm*100)/100,
        maxInk: Math.max.apply(null, rows.slice(a, b+1))
      }));
    };
    /* 横向扫描：在某段 y 范围内，逐列统计墨量，用于找竖直的块/框 */
    const hprofile = (y0mm, y1mm) => {
      const y0 = Math.round(y0mm*mm), y1 = Math.round(y1mm*mm);
      const cols = [];
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let y = y0; y < y1; y++) { if (isInk((y*W+x)*4)) n++; }
        cols.push(n);
      }
      const runs = []; let s = -1;
      for (let i = 0; i <= cols.length; i++) {
        const v = i < cols.length ? cols[i] : 0;
        if (v > 0) { if (s < 0) s = i; }
        else if (s >= 0) { runs.push([s, i-1]); s = -1; }
      }
      return runs.map(([a,b]) => ({
        cx: Math.round(((a+b)/2)/mm*100)/100,
        w: Math.round((b-a+1)/mm*100)/100
      }));
    };

    const out = { pxPerMM: Math.round(mm*100)/100, canvas: {w: W, h: H} };
    out.leftBand = profile(6.6, 9.4);          // 左侧定标带
    out.bubbleBand = profile(14.2, 18.5);      // 第 1 列气泡
    out.topBandCols = hprofile(13.0, 18.0);    // 顶部定标带（逐列）
    out.gridCols = hprofile(128.0, 143.0);     // 选择题网格逐列
    out.cornerRows = profile(3.0, 6.5);        // 角标所在 x 段
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 500));
  }
  const D = res.result?.result?.value;
  const lines = ['SCAN ' + FMT + ' ' + THEME, JSON.stringify(D, null, 1)];
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
