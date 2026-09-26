/* 结构体检：检查各主要区块是否重叠/越界，并核对「无选择题」等空值行为。
   用法：node .ref\sanity.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9365;
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
    const out = {};
    const fill = (o) => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('cardTitle', o.title); set('cardSubject', o.subject);
      set('choiceTotal', o.ct); set('choiceStart', o.cs || '1');
      set('subjStart', o.ss || ''); set('subjCount', o.sc || '');
      set('subjScore', o.score || ''); set('subjLines', o.lines || '');
      window.AS.app.generate();
    };
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();

    /* 场景 1：空表单 —— 不应崩，且不应凭空出现选择题 */
    fill({ title: '', subject: '', ct: '' });
    const p0 = document.querySelector('#stage .as-page');
    out.emptyForm = {
      pages: document.querySelectorAll('#stage .as-page').length,
      choiceSections: document.querySelectorAll('#stage .as-choice-section').length,
      topMarks: document.querySelectorAll('#stage .as-mark-top').length,
      leftMarks: document.querySelectorAll('#stage .as-mark-left').length,
      hasNote: !!document.querySelector('.as-note'),
      hasBarcode: !!document.querySelector('.as-barcode')
    };

    /* 场景 2：正常数据 —— 检查区块重叠 */
    fill({ title: '2026届高三第一次模拟考试', subject: '数学',
           ct: '12', cs: '1', ss: '13', sc: '5',
           score: '10,12,12,12,12', lines: '8' });

    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const st = card.closest('.preview-stage');
    const m = getComputedStyle(st).transform;
    const k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\\(([^,]+)/) || [0,1])[1]);
    const mm = (v) => Math.round(v * 25.4 / 96 / k * 1000) / 1000;
    const rel = (e) => { const r = e.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left),
               t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };

    const rects = [];
    const grab = (sel, name) => card.querySelectorAll(sel).forEach((e, i) =>
      rects.push(Object.assign({ name: name + (i ? '#' + i : '') }, rel(e))));
    grab('.as-head', 'head');
    grab('.as-choice-section', 'choice');
    grab('.as-subjective', 'subj');
    grab('.as-footer', 'footer');

    /* 重叠检测：只报「有意义」的重叠（面积 > 4mm²） */
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 0.5 && h > 0.5 && w * h > 4) {
          overlaps.push(a.name + ' × ' + b.name + ' = ' + (w*h).toFixed(1) + 'mm²');
        }
      }
    }

    /* 越界检测：任何块超出纸张可视区 */
    const page = rel(card);
    const outOfBounds = rects.filter(x =>
      x.l < -0.05 || x.t < -0.05 || x.r > page.r + 0.05 || x.b > page.b + 0.05)
      .map(x => x.name + ' [' + x.l + ',' + x.t + ' → ' + x.r + ',' + x.b + ']');

    out.normal = {
      pages: document.querySelectorAll('#stage .as-page').length,
      rects: rects.map(x => x.name + ' t=' + x.t + ' b=' + x.b + ' l=' + x.l + ' r=' + x.r),
      overlaps: overlaps,
      outOfBounds: outOfBounds
    };

    /* 场景 3：标题很长（换行）—— 检查是否与信息行重叠 */
    fill({ title: '某某省某某市某某区2026届高三年级第某次模拟统一考试质量检测',
           subject: '数学', ct: '12', ss: '13', sc: '5',
           score: '10,12,12,12,12', lines: '8' });
    const card3 = document.querySelector('#stage .as-page');
    const t3 = card3.querySelector('.as-head-title');
    const i3 = card3.querySelector('.as-info');
    const n3 = card3.querySelector('.as-note-row');
    const pr3 = card3.getBoundingClientRect();
    const rel3 = (e) => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr3.top), b: mm(r.bottom - pr3.top), h: mm(r.height) }; };
    out.longTitle = {
      title: rel3(t3), info: rel3(i3), noteRow: rel3(n3),
      infoStartsAfterTitleRow: rel3(i3).t >= rel3(t3).b - 0.01,
      noteRowStartsAfterInfo: rel3(n3).t >= rel3(i3).b - 0.01,
      titleOverflowsRow: rel3(t3).b > rel3(i3).t + 0.01
    };

    /* 场景 4：长标题 + 有选择题 —— 检查选择题是否被页眉压住 */
    fill({ title: '某某省某某市某某区2026届高三年级第某次模拟统一考试质量检测',
           subject: '数学', ct: '12', ss: '13', sc: '5',
           score: '10,12,12,12,12', lines: '8' });
    const c4 = document.querySelector('#stage .as-page');
    const pr4 = c4.getBoundingClientRect();
    const rel4 = (e) => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr4.top), b: mm(r.bottom - pr4.top) }; };
    const head4 = rel4(c4.querySelector('.as-head'));
    const ch4 = rel4(c4.querySelector('.as-choice-section'));
    out.longTitleWithChoice = {
      head: head4, choice: ch4,
      headOverlapsChoice: head4.b > ch4.t + 0.01
    };

    /* 场景 5：从长标题切回一行标题 —— 页眉高度必须收回去 */
    fill({ title: '2026届高三第一次模拟考试', subject: '数学',
           ct: '12', ss: '13', sc: '5',
           score: '10,12,12,12,12', lines: '8' });
    const c5 = document.querySelector('#stage .as-page');
    const pr5 = c5.getBoundingClientRect();
    const rel5 = (e) => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr5.top), b: mm(r.bottom - pr5.top) }; };
    const head5 = rel5(c5.querySelector('.as-head'));
    const ch5 = rel5(c5.querySelector('.as-choice-section'));
    out.backToShortTitle = {
      head: head5, choice: ch5,
      headBottomIsDefault: Math.abs(head5.b - 60.267) < 0.2,
      headOverlapsChoice: head5.b > ch5.t + 0.01
    };
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  }
  console.log(JSON.stringify(res.result?.result?.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
