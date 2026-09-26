/* 数一数「提示」语句与「请在各题目的答题区域内作答…」各出现几次，
   并量出后者的字号/颜色/字体，以及它是否夹在红框与黑框之间。
   用法：node .ref\tip_probe.mjs [A4|A3] [选择题数] [非选择题数] [行数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9415;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '12';
const NS = process.argv[4] || '3';
const LINES = process.argv[5] || '10';

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
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart', String(${NC} + 1)); set('subjCount','${NS}');
    set('subjScore', Array.from({length:${NS}},()=>'10').join(','));
    set('subjLines', Array.from({length:${NS}},()=>'${LINES}').join(','));
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const faces = Array.from(document.querySelectorAll('#stage .as-page'));
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const out = faces.map((card, i) => {
      const pr = card.getBoundingClientRect();
      const T = e => mm(e.getBoundingClientRect().top - pr.top);
      const B = e => mm(e.getBoundingClientRect().bottom - pr.top);
      const q = s => Array.from(card.querySelectorAll(s));
      const choiceTips = q('.as-section-tip').map(e => ({
        text: e.textContent.trim().slice(0, 24),
        fs: getComputedStyle(e).fontSize,
        ff: getComputedStyle(e).fontFamily.split(',')[0],
        color: getComputedStyle(e).color
      }));
      const subjTips = q('.as-subject-tip').map(e => ({
        text: e.textContent.trim().slice(0, 24),
        fs: getComputedStyle(e).fontSize,
        ff: getComputedStyle(e).fontFamily.split(',')[0],
        color: getComputedStyle(e).color
      }));
      const pageTips = q('.as-subject-page-tip').map(e => {
        const cs = getComputedStyle(e);
        const outer = e.closest('.as-subject-outer');
        const tbl = outer ? outer.querySelector('.as-subject-inner-table') : null;
        return {
          text: e.textContent.trim().slice(0, 30),
          fs: cs.fontSize, ff: cs.fontFamily.split(',')[0], color: cs.color,
          align: cs.textAlign,
          tipTop: T(e), tipBottom: B(e),
          outerTop: outer ? T(outer) : null,
          tableTop: tbl ? T(tbl) : null,
          tableBottom: tbl ? B(tbl) : null,
          /* 语句是否夹在红框内缘与黑框之间 */
          insideRedBox: outer ? (T(e) > T(outer) && B(e) < B(outer)) : null,
          aboveTable: tbl ? (B(e) <= T(tbl) + 0.6) : null,
          belowTable: tbl ? (T(e) >= B(tbl) - 0.6) : null
        };
      });
      return { page: i + 1, choiceTips, subjTips, pageTips };
    });
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    let nChoice = 0, nSubj = 0, nPage = 0;
    d.forEach(P => {
      console.log('\n=== 第 %d 面 ===', P.page);
      P.choiceTips.forEach(t => { nChoice++; console.log('  选择题提示: %s  [%s %s %s]',
        t.text, t.fs, t.ff, t.color); });
      P.subjTips.forEach(t => { nSubj++; console.log('  非选择题提示: %s  [%s %s %s]',
        t.text, t.fs, t.ff, t.color); });
      P.pageTips.forEach(t => { nPage++;
        console.log('  页内语句: %s', t.text);
        console.log('     [%s %s %s align=%s]', t.fs, t.ff, t.color, t.align);
        console.log('     红框 %s → %s   黑框 %s → %s', t.outerTop, t.outerBottom,
          t.tableTop, t.tableBottom);
        console.log('     语句 %s → %s   在红框内=%s  在黑框上=%s  在黑框下=%s',
          t.tipTop, t.tipBottom, t.insideRedBox, t.aboveTable, t.belowTable);
      });
    });
    console.log('\n—— 合计 ——');
    console.log('  选择题提示出现 %d 次（要求 1）', nChoice);
    console.log('  非选择题提示出现 %d 次（要求 1）', nSubj);
    console.log('  页内语句出现 %d 次（= 有非选择题的面数）', nPage);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
