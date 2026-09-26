/* 实测 CSS 列内行距：在真实浏览器里量 .as-choice-col 的实际 gap 与行心。 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const URL = 'http://127.0.0.1:8137/index.html?fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'asgap-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('no devtools');
}
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(4000);
// 等字体就绪并重新生成，避免读到 fallback 字体的度量
await send('Runtime.evaluate', { expression: `(async () => {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  if (window.AS && window.AS.app && window.AS.app.generate) { window.AS.app.generate(); }
  await new Promise(r => setTimeout(r, 400));
})()`, awaitPromise: true, returnByValue: true });
await sleep(600);

const EXPR = `(() => {
  const col = document.querySelector('.as-choice-col');
  if (!col) return { err: 'no col' };
  const cs = getComputedStyle(col);
  const num = col.querySelector('.as-choice-num');
  const ns = num ? getComputedStyle(num) : null;
  const stage = col.closest('.preview-stage');
  const m = stage ? getComputedStyle(stage).transform : 'none';
  let scale = 1;
  if (m && m !== 'none') { const p = m.match(/matrix\\(([^,]+)/); if (p) scale = parseFloat(p[1]) || 1; }
  const px2mm = 25.4 / 96 / scale;   // 除以缩放，还原真实毫米
  const kids = Array.from(col.children).map(e => {
    const r = e.getBoundingClientRect();
    return { cls: e.className, top: r.top, bot: r.bottom, h: r.height };
  });
  const gaps = [];
  for (let i = 1; i < kids.length; i++) gaps.push(kids[i].top - kids[i-1].bot);
  const rects = Array.from(col.children).map(e => e.getBoundingClientRect());
  const pitch = [];
  for (let i = 1; i < rects.length; i++) pitch.push(rects[i].top - rects[i-1].top);
  return {
    scale: scale,
    colGapComputed: cs.gap,
    colGapMM: Math.round(parseFloat(cs.gap) * 25.4 / 96 * 10000) / 10000,
    varColGap: cs.getPropertyValue('--col-gap').trim(),
    varFsNum: cs.getPropertyValue('--fs-num').trim(),
    colWidthMM: Math.round(col.getBoundingClientRect().width * px2mm * 1000) / 1000,
    bubbleHMM: (() => { const b = col.querySelector('.as-bubble'); return b ? Math.round(b.getBoundingClientRect().height * px2mm * 1000) / 1000 : null; })(),
    numFontSize: ns ? ns.fontSize : null,
    numLineHeight: ns ? ns.lineHeight : null,
    numHMM: num ? Math.round(num.getBoundingClientRect().height * px2mm * 1000) / 1000 : null,
    rowHeightsMM: kids.map(k => Math.round(k.h * px2mm * 1000) / 1000),
    gapsMM: gaps.map(g => Math.round(g * px2mm * 1000) / 1000),
    pitchMM: pitch.map(g => Math.round(g * px2mm * 1000) / 1000),
    totalHMM: Math.round(col.getBoundingClientRect().height * px2mm * 1000) / 1000
  };
})()`;
const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const out = 'GAP PROBE = ' + JSON.stringify(r.result?.result?.value, null, 1);
writeFileSync('.ref/gap_probe.txt', out, 'utf8');
console.log(out);
ws.close(); chrome.kill(); process.exit(0);
