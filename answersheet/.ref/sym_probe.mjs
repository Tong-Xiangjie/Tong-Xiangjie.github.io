/* 量「红框 → 黑框 → 气泡」这条链的左右对称性。
   用法：node .ref\sym_probe.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9399;
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
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-page');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const R = e => { const r = e.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left) }; };
    const outer = R(card.querySelector('.as-choice-outer'));
    const inner = R(card.querySelector('.as-choice-inner'));
    const grid  = R(card.querySelector('.as-choice-grid'));
    /* 各盒的线宽 —— 用 border-box 边缘自己减，不要写死 0.3。
       写死 0.3 一旦 CSS 的 --box-border 变了，量出来的数就全是错的。 */
    const bw = e => {
      const cs = getComputedStyle(e);
      return { l: parseFloat(cs.borderLeftWidth) * 25.4 / 96,
               r: parseFloat(cs.borderRightWidth) * 25.4 / 96 };
    };
    const eOuter = card.querySelector('.as-choice-outer');
    const eInner = card.querySelector('.as-choice-inner');
    const bO = bw(eOuter), bI = bw(eInner);
    /* 气泡块的实际左右边缘：取**最长的那一行**（列数最多的行），
       它的首/末列就是整个网格的横向极值。 */
    let best = null;
    card.querySelectorAll('.as-choice-line').forEach(ln => {
      const cs = ln.querySelectorAll('.as-choice-col');
      if (!best || cs.length > best.n) best = { n: cs.length, cs: cs };
    });
    const cols = Array.from(best.cs);
    const firstCol = R(cols[0]), lastCol = R(cols[cols.length - 1]);
    const rd = (a,b) => Math.round((b-a)*1000)/1000;
    const cw = e => Math.round(parseFloat(getComputedStyle(e).width) * 25.4 / 96 * 1000)/1000;
    const cm = e => {
      const cs = getComputedStyle(e);
      return { ml: Math.round(parseFloat(cs.marginLeft)*25.4/96*1000)/1000,
               pl: Math.round(parseFloat(cs.paddingLeft)*25.4/96*1000)/1000,
               pr: Math.round(parseFloat(cs.paddingRight)*25.4/96*1000)/1000,
               w: cw(e) };
    };
    const eg = card.querySelector('.as-choice-grid');
    return {
      outer, inner, grid, firstCol, lastCol, maxCols: best.n,
      diag: { outer: cm(eOuter), inner: cm(eInner), grid: cm(eg),
              outerW: cw(eOuter), innerW: cw(eInner), gridW: cw(eg) },
      /* ① 红框内缘 → 黑框外缘（左右各应 = boxGap） */
      gL: rd(outer.l + bO.l, inner.l),
      gR: rd(inner.r + bI.r, outer.r - bO.r),
      /* ② 黑框内缘 → 网格边缘（靠左还是居中，看这两个数） */
      nL: rd(inner.l + bI.l, grid.l),
      nR: rd(grid.r, inner.r - bI.r),
      /* ③ 黑框内缘 → 气泡块边缘（用户实际看到的间距） */
      bL: rd(inner.l + bI.l, firstCol.l),
      bR: rd(lastCol.r, inner.r - bI.r),
      /* ④ 红框内缘 → 气泡块边缘 */
      tL: rd(outer.l + bO.l, firstCol.l),
      tR: rd(lastCol.r, outer.r - bO.r),
      boxGapProp: getComputedStyle(document.documentElement)
                    .getPropertyValue('--box-gap').trim(),
      nCols: cols.length
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('格式=%s  题数=%s  最长行 %s 列', FMT, N, d.maxCols);
    console.log('  红框     %8s → %8s', d.outer.l, d.outer.r);
    console.log('  黑框     %8s → %8s', d.inner.l, d.inner.r);
    console.log('  网格     %8s → %8s', d.grid.l, d.grid.r);
    console.log('  首列块   %8s → %8s', d.firstCol.l, d.firstCol.r);
    console.log('  末列块   %8s → %8s', d.lastCol.l, d.lastCol.r);
    console.log('\n  ① 红框内缘 → 黑框外缘     左 %s   右 %s   (应 = boxGap)',
      d.gL, d.gR);
    console.log('  ② 黑框内缘 → 网格边缘     左 %s   右 %s   (居中则相等)',
      d.nL, d.nR);
    console.log('  ③ 黑框内缘 → 气泡块边缘   左 %s   右 %s', d.bL, d.bR);
    console.log('  ④ 红框内缘 → 气泡块边缘   左 %s   右 %s   ← 用户看到的间距',
      d.tL, d.tR);
    console.log('  左右不对称量（②）：%s mm', Math.round((d.nR - d.nL)*1000)/1000);
    if (d.boxGapProp) console.log('  --box-gap =', d.boxGapProp);
    if (d.diag) {
      const D = d.diag;
      console.log('\n  盒模型（mm）:');
      console.log('    红框 w=%s  padding L/R=%s/%s  margin-left=%s',
        D.outerW, D.outer.pl, D.outer.pr, D.outer.ml);
      console.log('    黑框 w=%s  padding L/R=%s/%s  margin-left=%s',
        D.innerW, D.inner.pl, D.inner.pr, D.inner.ml);
      console.log('    网格 w=%s  padding L/R=%s/%s  margin-left=%s',
        D.gridW, D.grid.pl, D.grid.pr, D.grid.ml);
      console.log('    校验 红框宽 − 2×boxGap = %s   vs 黑框宽 %s  → 差 %s',
        Math.round((D.outerW - 2*3)*1000)/1000, D.innerW,
        Math.round((D.outerW - 2*3 - D.innerW)*1000)/1000);
      console.log('    校验 黑框内缘左 + margin-left = %s  vs 网格左 %s',
        Math.round((d.inner.l + 0.3 + D.grid.ml)*1000)/1000, d.grid.l);
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
