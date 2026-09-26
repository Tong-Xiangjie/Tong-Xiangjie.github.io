/* 截图：把 #stage 里的 .as-page 渲染成 PNG，用于人工目视确认。
   用法：node .ref/shot.mjs <out.png> [A3] [mono] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUT = process.argv[2] || '.ref/shot.png';
const FMT = process.argv[3] || 'A4';
const THEME = process.argv[4] || 'color';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      target = list.find(t => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('no chrome target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  /* 先切纸张/主题，再重新生成；最后把预览缩放到 1:1 便于截图 */
  const setup = `(() => {
    const fmt = document.querySelector('#segFormat button[data-val="${FMT}"]');
    if (fmt) fmt.click();
    const th = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]');
    if (th) th.click();
    if (typeof generate === 'function') generate();
    const st = document.querySelector('.preview-stage');
    if (st) { st.style.transform = 'none'; st.style.width = 'auto'; }
    return { fmt: '${FMT}', theme: '${THEME}', pages: document.querySelectorAll('.as-page').length };
  })()`;
  const r1 = await send('Runtime.evaluate', { expression: setup, returnByValue: true });
  console.log('SETUP', JSON.stringify(r1.result?.result?.value));
  await sleep(1200);

  /* 逐张纸截图 */
  const n = (r1.result?.result?.value?.pages) || 1;
  for (let i = 0; i < n; i++) {
    const rect = await send('Runtime.evaluate', {
      expression: `(() => { const p = document.querySelectorAll('.as-page')[${i}];
        const r = p.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`,
      returnByValue: true
    });
    const rc = rect.result?.result?.value;
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rc.x, y: rc.y, width: rc.w, height: rc.h, scale: 1 }
    });
    const data = shot.result?.data;
    if (!data) { console.log('shot failed for page', i); continue; }
    const path = n > 1 ? OUT.replace(/\.png$/, '_p' + (i + 1) + '.png') : OUT;
    writeFileSync(path, Buffer.from(data, 'base64'));
    console.log('WROTE', path, Math.round(rc.w) + 'x' + Math.round(rc.h));
  }
  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
