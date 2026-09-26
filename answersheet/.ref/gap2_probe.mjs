/* 非选择题红框与黑框之间的**上、下**两处空档各有多高，语句现在落在哪里。
   用法：node .ref\gap2_probe.mjs [A4|A3] [选择题数] [非选择题数] [行数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9419;
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
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const faces = Array.from(document.querySelectorAll('#stage .as-face'));
    return faces.map((face, i) => {
      const outer = face.querySelector('.as-subject-outer');
      if (!outer) return { face: i + 1, hasSubj: false };
      const pr = face.getBoundingClientRect();
      const T = e => mm(e.getBoundingClientRect().top - pr.top);
      const B = e => mm(e.getBoundingClientRect().bottom - pr.top);
      const bw = mm(parseFloat(getComputedStyle(outer).borderTopWidth));
      const hdr = outer.querySelector('.as-subject-header');
      const tbl = outer.querySelector('.as-subject-inner-table');
      const tip = outer.querySelector('.as-subject-page-tip');
      const kids = Array.from(outer.children).map(e => ({
        cls: e.className, top: T(e), bottom: B(e)
      }));
      const rowNos = Array.from(outer.querySelectorAll('.as-subj-head .as-subj-no'))
        .map(e => e.textContent.trim());
      return {
        face: i + 1, hasSubj: true,
        outerTop: T(outer), outerBottom: B(outer), borderW: bw,
        hdrTop: hdr ? T(hdr) : null, hdrBottom: hdr ? B(hdr) : null,
        tblTop: T(tbl), tblBottom: B(tbl),
        tipTop: tip ? T(tip) : null, tipBottom: tip ? B(tip) : null,
        /* 上 gap = 红框内缘 → 黑框外缘（若无栏目头，就是红框内缘 → 黑框外缘）*/
        gapTop: hdr ? mm(T(tbl) - B(hdr)) : mm(T(tbl) - (T(outer) + bw)),
        gapTopTotal: mm(T(tbl) - (T(outer) + bw)),
        /* 下 gap = 黑框外缘 → 红框内缘 */
        gapBottom: mm((B(outer) - bw) - B(tbl)),
        kids,
        rowNos
      };
    });
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    d.forEach(P => {
      console.log('\n=== 第 %d 面 ===', P.face);
      if (!P.hasSubj) { console.log('  无选择题区'); return; }
      console.log('  红框 %s → %s  (线宽 %s)   内缘 %s → %s',
        P.outerTop, P.outerBottom, P.borderW,
        Math.round((P.outerTop + P.borderW) * 1000) / 1000,
        Math.round((P.outerBottom - P.borderW) * 1000) / 1000);
      if (P.hdrTop !== null) console.log('  栏目头 %s → %s', P.hdrTop, P.hdrBottom);
      console.log('  黑框   %s → %s', P.tblTop, P.tblBottom);
      console.log('  ▶ 上 gap（红框内缘 → 黑框外缘）= %s mm', P.gapTopTotal);
      console.log('     └ 其中栏目头占 %s，净空 %s',
        P.hdrTop !== null ? Math.round((P.hdrBottom - P.hdrTop) * 1000) / 1000 : 0,
        P.gapTop);
      console.log('  ▶ 下 gap（黑框外缘 → 红框内缘）= %s mm', P.gapBottom);
      console.log('  语句 %s', P.tipTop === null ? '** 本面没有 **'
        : (P.tipTop + ' → ' + P.tipBottom +
           '   在上 gap=' + (P.tipBottom <= P.tblTop) +
           '   在下 gap=' + (P.tipTop >= P.tblBottom)));
      console.log('  题目行: %s', (P.rowNos || []).join(' | '));
      console.log('  outer 直接子元素: %s',
        P.kids.map(k => k.cls + '@' + k.top).join('  '));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
