/* 把导出用包装里**每一个** .as-bubble / .as-choice-optrow / .as-choice-num
   的盒子逐个列出来，看它们到底被排到了哪里（而不是看某一段扫描的统计）。
   用法：node .ref\dump_bubbles.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9353;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const OUT = process.argv[3] || '.ref/dump_bubbles.txt';

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

  const EXPR = `(() => {
    const C = window.AS.config, Theme = window.AS.theme;
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    if (typeof generate === 'function') generate();

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
    const pr = card.getBoundingClientRect();
    const mm = (v) => Math.round(v * 25.4 / 96 * 100) / 100;
    const rel = (e) => {
      const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr.top), b: mm(r.bottom - pr.top),
               l: mm(r.left - pr.left), rr: mm(r.right - pr.left),
               w: mm(r.width), h: mm(r.height), cy: mm((r.top+r.bottom)/2 - pr.top),
               cx: mm((r.left+r.right)/2 - pr.left) };
    };
    const out = {};
    out.page = { w: mm(pr.width), h: mm(pr.height) };
    out.grid = (() => { const g = card.querySelector('.as-choice-grid'); if (!g) return null;
      const s = getComputedStyle(g); return { rect: rel(g), margin: s.margin, pos: s.position }; })();
    out.inner = (() => { const g = card.querySelector('.as-choice-inner'); if (!g) return null;
      const s = getComputedStyle(g); return { rect: rel(g), h: s.height, pad: s.padding, border: s.borderTopWidth }; })();
    out.outer = (() => { const g = card.querySelector('.as-choice-outer'); if (!g) return null;
      const s = getComputedStyle(g); return { rect: rel(g), h: s.height, pad: s.padding, border: s.borderTopWidth }; })();
    out.cols = Array.from(card.querySelectorAll('.as-choice-col')).map(rel);
    out.items = Array.from(card.querySelectorAll('.as-choice-item')).slice(0, 3).map(rel);
    out.nums = Array.from(card.querySelectorAll('.as-choice-nums')).slice(0, 3).map(rel);
    out.optrows = Array.from(card.querySelectorAll('.as-choice-optrow')).slice(0, 6).map(rel);
    out.bubbles = Array.from(card.querySelectorAll('.as-bubble')).slice(0, 6).map(e => {
      const s = getComputedStyle(e);
      return Object.assign(rel(e), { border: s.borderTopWidth, bg: s.backgroundColor,
                                     txt: JSON.stringify(e.textContent) });
    });
    out.markLeft = Array.from(card.querySelectorAll('.as-mark-left')).slice(0, 8).map(rel);
    wrap.remove();
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0,600));
  const D = res.result?.result?.value;
  const txt = JSON.stringify(D, null, 1);
  writeFileSync(OUT, txt, 'utf8');
  console.log(txt);
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
