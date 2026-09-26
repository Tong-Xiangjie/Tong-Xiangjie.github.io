/* 快速确认：定位块在**浏览器预览**里的层叠是否真的高于正文块白底。
   只看计算样式（z-index / 背景 / 定位），不做像素取样 —— 像素取样受
   fit-zoom 缩放与裁剪坐标影响，容易得出误导结论。
   用法：node .ref/z_check.mjs */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUT = process.argv[2] || '.ref/z_check.txt';

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
    const out = {};
    const info = (sel, i) => {
      const e = document.querySelectorAll(sel)[i || 0];
      if (!e) return null;
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return { sel, z: s.zIndex, pos: s.position, bg: s.backgroundColor,
               vis: s.visibility, disp: s.display, op: s.opacity,
               w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    out.mark = info('.as-mark-left');
    out.markTop = info('.as-mark-top');
    out.corner = info('.as-corner');
    out.choiceSection = info('.as-choice-section');
    out.choiceOuter = info('.as-choice-outer');
    out.choiceInner = info('.as-choice-inner');
    out.subjective = info('.as-subjective');
    out.bubble = info('.as-bubble');
    /* 左侧定标块与「会盖住它的白底块」的层叠对比 */
    out.verdict = (() => {
      const m = document.querySelector('.as-mark-left');
      const blocks = ['.as-choice-section', '.as-choice-outer', '.as-choice-inner', '.as-subjective'];
      const res = [];
      blocks.forEach(sel => {
        const e = document.querySelector(sel);
        if (!e) return;
        res.push({ over: sel, markZ: getComputedStyle(m).zIndex, blockZ: getComputedStyle(e).zIndex,
                   ok: (parseInt(getComputedStyle(m).zIndex, 10) || 0) >
                       (parseInt(getComputedStyle(e).zIndex, 10) || 0) });
      });
      return res;
    })();
    return out;
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  const D = res.result?.result?.value;
  const lines = ['Z CHECK', JSON.stringify(D, null, 1)];
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
