/* 截取预览第一面 PNG（去掉缩放，1:1 物理像素）。
   用法：node .ref\shot_card.mjs <out.png> [A4|A3] [color|mono] [pageIndex] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9363;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUT = process.argv[2] || '.ref/card.png';
const FMT = process.argv[3] || 'A4';
const THEME = process.argv[4] || 'color';
const PG = process.argv[5] || '0';

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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const prep = `(() => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const t = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (t) t.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    window.AS.app.generate();
    /* 关键：把预览缩放还原成 1:1，并让目标面从视口 (0,0) 开始 */
    const st = document.querySelector('.preview-stage');
    st.style.transform = 'none';
    document.querySelectorAll('.as-face-guide').forEach(e => e.style.display = 'none');
    const pages = document.querySelectorAll('#stage .as-page');
    const pg = pages[${PG}];
    const r = pg.getBoundingClientRect();
    window.scrollTo(r.left + window.scrollX, r.top + window.scrollY);
    return { n: pages.length, w: Math.round(r.width), h: Math.round(r.height) };
  })()`;
  const r1 = await send('Runtime.evaluate', { expression: prep, returnByValue: true });
  console.log('PREP', JSON.stringify(r1.result?.result?.value));
  await sleep(500);

  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 420 * 96 / 25.4, height: 297 * 96 / 25.4, scale: 1 }
  });
  const data = shot.result?.data;
  if (!data) { console.log('NO SHOT', JSON.stringify(shot).slice(0, 400)); }
  else { writeFileSync(OUT, Buffer.from(data, 'base64')); console.log('WROTE', OUT); }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
