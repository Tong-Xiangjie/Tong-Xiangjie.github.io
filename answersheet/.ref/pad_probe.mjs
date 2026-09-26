/* 量选择题黑框的**内边距**：题号行上缘 → 黑框上内缘，末行选项下缘 → 黑框下内缘。
   用法：node .ref\pad_probe.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9407;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const N = process.argv[3] || '12';

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
    set('choiceTotal','${N}'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0'); set('subjScore',''); set('subjLines','');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const T = e => mm(e.getBoundingClientRect().top - pr.top);
    const B = e => mm(e.getBoundingClientRect().bottom - pr.top);
    const inner = card.querySelector('.as-choice-inner');
    const cs = getComputedStyle(inner);
    const bw = mm(parseFloat(cs.borderTopWidth));
    /* 网格整体（题号行上缘 → 末行选项下缘） */
    const grid = card.querySelector('.as-choice-grid');
    const lines = Array.from(card.querySelectorAll('.as-choice-line'));
    const last = lines[lines.length - 1];
    const lastBubbles = Array.from(last.querySelectorAll('.as-choice-col'))
      .map(c => c.querySelectorAll('.as-bubble'));
    let maxBottom = -1e9;
    lastBubbles.forEach(list => list.forEach(b => {
      const v = B(b); if (v > maxBottom) maxBottom = v;
    }));
    const firstNum = lines[0].querySelector('.as-choice-num');
    return {
      innerTop: T(inner), innerBottom: B(inner), borderTop: bw,
      gridTop: T(grid), gridBottom: B(grid),
      firstNumTop: T(firstNum),
      lastBubbleBottom: maxBottom,
      innerPadTop_css: mm(parseFloat(cs.paddingTop)),
      innerPadBottom_css: mm(parseFloat(cs.paddingBottom)),
      /* 实际空档：黑框内缘（= 边框盒内缩一道线）到内容的距离 */
      padTop_real: mm(T(grid) - (T(inner) + bw)),
      padBottom_real: mm((B(inner) - bw) - maxBottom),
      __raw: { innerT: T(inner), gridT: T(grid), borderTopMM: bw,
               innerPlusBorder: mm(T(inner) + bw) },
      nLines: lines.length
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('格式=%s  题数=%s  行数=%s', FMT, N, d.nLines);
    console.log('  黑框     %s → %s   (线宽 %s)', d.innerTop, d.innerBottom, d.borderTop);
    console.log('  网格     %s → %s', d.gridTop, d.gridBottom);
    console.log('  首行题号上缘 %s   末行气泡下缘 %s', d.firstNumTop, d.lastBubbleBottom);
    console.log('  CSS padding: top %s  bottom %s', d.innerPadTop_css, d.innerPadBottom_css);
    console.log('  ▶ 题号行上缘 → 黑框上内缘 = %s mm  (要求 3)', d.padTop_real);
    console.log('  ▶ 末行选项下缘 → 黑框下内缘 = %s mm  (要求 3)', d.padBottom_real);
    console.log('  RAW', JSON.stringify(d.__raw));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
