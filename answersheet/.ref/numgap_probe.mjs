/* 量「14.」与「（9分）」之间的实际空隙（mm）。
   用法：node .ref\numgap_probe.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9427;
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
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','9,11'); set('subjLines','6,6');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const R = e => e.getBoundingClientRect();
    const head = card.querySelector('.as-subj-head');
    const no = head.querySelector('.as-subj-no');
    const sc = head.querySelector('.as-subj-score');
    const rn = R(no), rs = R(sc), rh = R(head);
    const csn = getComputedStyle(no), css = getComputedStyle(sc);
    /* 用 Range 把文字节点单独量出来，排除元素盒的空白 */
    const rangeBox = el => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const r = rg.getBoundingClientRect();
      return { left: mm(r.left - pr.left), right: mm(r.right - pr.left), w: mm(r.width) };
    };
    const bn = rangeBox(no), bs = rangeBox(sc);
    return {
      headGapCss: getComputedStyle(head).gap,
      noFs: csn.fontSize, noLh: csn.lineHeight, noLs: csn.letterSpacing,
      scFs: css.fontSize, scLs: css.letterSpacing,
      noTextWidth: bn.w, scTextWidth: bs.w,
      /* 题号文字右缘 → 分值文字左缘 */
      visualGap: Math.round((bs.left - bn.right) * 1000) / 1000,
      /* 元素盒间隙 */
      boxGap: Math.round((mm(rs.left - pr.left) - mm(rn.right - pr.left)) * 1000) / 1000,
      headText: head.textContent,
      headW: mm(rh.width)
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('题头文本: %s', JSON.stringify(d.headText));
    console.log('  flex gap        = %s', d.headGapCss);
    console.log('  题号 字号 %s  行高 %s  字距 %s  文字宽 %s',
      d.noFs, d.noLh, d.noLs, d.noTextWidth);
    console.log('  分值 字号 %s  字距 %s  文字宽 %s', d.scFs, d.scLs, d.scTextWidth);
    console.log('  元素盒间隙      = %s mm', d.boxGap);
    console.log('  ▶ 题号文字 → 分值文字 视觉间隙 = %s mm', d.visualGap);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
