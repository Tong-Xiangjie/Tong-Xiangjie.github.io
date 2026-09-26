/* 顶部定标带与选择题第一列的对齐关系：逐个列出定标块心与列心。
   用法：node .ref\band_probe.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9423;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';

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

  const EXPR = `(() => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','40'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const cx = e => { const r = e.getBoundingClientRect();
      return mm(r.left + r.width/2 - pr.left); };
    /* 顶部定标带：只取 y 在纸顶附近的定位块 */
    const all = Array.from(card.querySelectorAll('.as-mark, .as-top-mark, [class*=mark]'))
      .filter(e => /mark/.test(e.className));
    const seen = {};
    const marks = [];
    all.forEach(e => {
      const r = e.getBoundingClientRect();
      const t = mm(r.top - pr.top), c = mm(r.left + r.width/2 - pr.left);
      if (t > 20) return;
      /* 同一 x 只留一个 */
      if (seen[c.toFixed(3)]) return;
      seen[c.toFixed(3)] = 1;
      marks.push({ x: c, t: t, w: mm(r.width) });
    });
    marks.sort((a, b) => a.x - b.x);
    const cols = Array.from(card.querySelectorAll('.as-choice-num')).map(e => ({
      x: cx(e), no: e.textContent.trim()
    }));
    const firstCol = cols[0];
    const outer = card.querySelector('.as-choice-outer');
    const inner = card.querySelector('.as-choice-inner');
    const redL = mm(outer.getBoundingClientRect().left - pr.left);
    const redR = mm(outer.getBoundingClientRect().right - pr.left);
    const blkL = mm(inner.getBoundingClientRect().left - pr.left);
    const blkR = mm(inner.getBoundingClientRect().right - pr.left);
    /* 第一列落在第几个定标点上 */
    let hit = -1;
    marks.forEach((m, i) => { if (Math.abs(m.x - firstCol.x) < 0.25) hit = i + 1; });
    return {
      nMarks: marks.length, nCols: cols.length,
      markX: marks.map(m => m.x),
      colX: cols.slice(0, 4).map(c => c.x),
      firstColX: firstCol.x, firstColNo: firstCol.no,
      hitOrdinal: hit,
      redL, redR, blkL, blkR,
      bandL: Math.round((marks[0].x - marks[0].w/2) * 1000)/1000,
      bandR: Math.round((marks[marks.length-1].x + marks[0].w/2) * 1000)/1000
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('格式 %s   定标点 %d 个   气泡列 %d 个', FMT, d.nMarks, d.nCols);
    console.log('红框 %s → %s     黑框 %s → %s', d.redL, d.redR, d.blkL, d.blkR);
    console.log('定标带 %s → %s', d.bandL, d.bandR);
    console.log('\n定标点 x: %s', d.markX.slice(0, 8).join(', '));
    console.log('           ... %s', d.markX.slice(-4).join(', '));
    console.log('气泡列 x: %s', d.colX.join(', '));
    console.log('\n▶ 第一列（%s）x = %s   落在第 %s 个定标点上  %s',
      d.firstColNo, d.firstColX, d.hitOrdinal,
      d.hitOrdinal === 2 ? '✓ 就是第二个' : '✗ 不是第二个');
    console.log('  第一个定标点 x = %s', d.markX[0]);
    console.log('  第二个定标点 x = %s', d.markX[1]);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
