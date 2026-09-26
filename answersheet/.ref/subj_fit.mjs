/* 用两组不同的行数测「单题高」的真实斜率与截距，反解出
   分页器 itemHeight 应该用的公式。
   用法：node .ref\subj_fit.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9393;
const BASE = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
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
  await send('Page.navigate', { url: BASE });
  await sleep(4500);

  const measure = (lines) => `(() => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','0');
    set('subjStart','13'); set('subjCount','1'); set('subjScore','10'); set('subjLines','${lines}');
    window.AS.app.generate();
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const box = sel => { const e = card.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };
    const out = box('.as-subject-outer');
    const hd = box('.as-subj-head');
    const bd = box('.as-subj-body');
    const tb = box('.as-subject-inner-table');
    const tr = box('.as-subject-inner-table tr');
    const td = box('.as-subject-inner-table td');
    const hm = window.AS.subject.HEAD_H;
    const cp = window.AS.subject.cellPad();
    const oel = card.querySelector('.as-subject-outer');
    const ocs = getComputedStyle(oel);
    const hel = card.querySelector('.as-subject-header');
    const hcs = getComputedStyle(hel);
    const tbl = card.querySelector('.as-subject-inner-table');
    const tcs = getComputedStyle(tbl);
    const d = card.querySelector('.as-subject-inner-table td');
    const dcs = getComputedStyle(d);
    return { lines: ${lines}, outer: out, hd, bd, tb, tr, td, HEAD_H: hm, cellPad: cp,
             subjChrome: window.AS.paginator.SUBJ_BOX_CHROME,
             css: {
               outerPadTop: ocs.paddingTop, outerPadBottom: ocs.paddingBottom,
               outerBorderTop: ocs.borderTopWidth, outerBorderBottom: ocs.borderBottomWidth,
               hdrH: hcs.height, hdrMb: hcs.marginBottom, hdrPadTop: hcs.paddingTop,
               tblBorderTop: tcs.borderTopWidth, tblBorderBottom: tcs.borderBottomWidth,
               tblBorderSpacing: tcs.borderSpacing, tblCollapse: tcs.borderCollapse,
               tdPadTop: dcs.paddingTop, tdPadBottom: dcs.paddingBottom,
               tdBorderTop: dcs.borderTopWidth, tdBorderBottom: dcs.borderBottomWidth
             },
             modelH: window.AS.subject.itemHeight(${lines}, 7.7) };
  })()`;

  const rows = [];
  for (const L of [4, 8, 12]) {
    const res = await send('Runtime.evaluate', { expression: measure(L), returnByValue: true });
    if (res.result?.exceptionDetails) {
      console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 600));
      break;
    }
    rows.push(res.result.result.value);
  }

  console.log('格式=%s   HEAD_H=%s  cellPad=%s  SUBJ_BOX_CHROME=%s',
    FMT, rows[0]?.HEAD_H, rows[0]?.cellPad, rows[0]?.subjChrome);
  console.log('');
  console.log('lines  红框高    模型 itemHeight  差     题头高   作答区高   tr高     td高');
  rows.forEach(r => {
    const outerH = r.outer.b - r.outer.t;
    console.log('%s   %s   %s   %s   %s   %s   %s   %s',
      String(r.lines).padStart(4),
      outerH.toFixed(3).padStart(8),
      String(r.modelH).padStart(12),
      (outerH - r.subjChrome - r.modelH).toFixed(3).padStart(7),
      (r.hd.b - r.hd.t).toFixed(3).padStart(8),
      (r.bd.b - r.bd.t).toFixed(3).padStart(8),
      (r.tr.b - r.tr.t).toFixed(3).padStart(8),
      (r.td.b - r.td.t).toFixed(3).padStart(8));
  });

  if (rows[0] && rows[0].css) {
    console.log('\n--- 第 1 组（%d 行）的 CSS 计算值 ---', rows[0].lines);
    Object.keys(rows[0].css).forEach(k => console.log('  %s = %s', k.padEnd(18), rows[0].css[k]));
    const c = rows[0].css;
    const px2mm = 25.4 / 96;
    const sum = ['outerBorderTop','outerPadTop','hdrH','hdrMb','tblBorderTop','tdBorderTop',
                 'tdPadTop','tdPadBottom','tblBorderBottom','outerPadBottom','outerBorderBottom']
      .reduce((a, k) => a + (parseFloat(c[k]) || 0) * px2mm, 0);
    const outerH = rows[0].outer.b - rows[0].outer.t;
    console.log('  CSS 各段之和（不含作答区）= %s', sum.toFixed(3));
    console.log('  红框高 − 作答区 − 各行高和 = %s', (outerH - (rows[0].bd.b - rows[0].bd.t)).toFixed(3));
  }

  // 反解：outerH - subjChrome = a + b*lines
  if (rows.length >= 2) {
    const r0 = rows[0], r1 = rows[rows.length - 1];
    const y0 = (r0.outer.b - r0.outer.t) - r0.subjChrome;
    const y1 = (r1.outer.b - r1.outer.t) - r1.subjChrome;
    const b = (y1 - y0) / (r1.lines - r0.lines);
    const a = y0 - b * r0.lines;
    console.log('\n实测拟合：单题高 = %s + %s × 行数   （lineH = %s）',
      a.toFixed(3), b.toFixed(3), b.toFixed(3));
    console.log('模型用的： 单题高 = %s + 7.7 × 行数', (rows[0].modelH - 7.7 * rows[0].lines).toFixed(3));
    console.log('固定项偏差 = %s mm/题', (a - (rows[0].modelH - 7.7 * rows[0].lines)).toFixed(3));
    console.log('斜率偏差   = %s mm/行', (b - 7.7).toFixed(3));
  }

  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
