/* 一个面里气泡的真实排布：第几行、每行几列、列心是多少。
   用法：node .ref\a3_cols.cjs [A4|A3] [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9445;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A3';
const NC = process.argv[3] || '23';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
        .find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const f0 = document.querySelector('#segFormat button[data-val="${FMT}"]');
    if (f0) f0.click();
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    /* ⚠ 缩放比的基准是**纸张宽度**（A4 210 / A3 420），不是硬编码的 210。
       写成 /210 会把 A3（420mm 宽）也按 210 折算，比例整个差一倍。 */
    const PAPER_W = window.AS.config.PAPER['${FMT}'].w;
    const S = pr.width / PAPER_W;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const faces = Array.from(page.querySelectorAll('.as-face'));
    return {
      pageW: mm(pr.width),
      paperW: PAPER_W,
      scale: S,
      faceCount: faces.length,
      faces: faces.map(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const fw = mm(fb.width);
        const items = Array.from(face.querySelectorAll('.as-choice-item'));
        const rec = items.map(function (e) {
          const b = e.getBoundingClientRect();
          return { cx: mm((b.left + b.right) / 2 - fb.left),
                   cy: mm((b.top + b.bottom) / 2 - fb.top),
                   w: mm(b.width), top: mm(b.top - fb.top) };
        }).sort((a, b) => a.top - b.top || a.cx - b.cx);
        /* 按 top 分组成「行」 */
        const lines = [];
        rec.forEach(function (r) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.top - r.top) < 1) { last.items.push(r); }
          else { lines.push({ top: r.top, items: [r] }); }
        });
        return {
          face: fi + 1, faceW: fw,
          lineCount: lines.length,
          lines: lines.map(function (l) {
            const xs = l.items.map(i => i.cx).sort((a, b) => a - b);
            const d = xs.slice(1).map((v, i) => Math.round((v - xs[i]) * 1000) / 1000);
            return { top: Math.round(l.top * 1000) / 1000, n: l.items.length,
                     xs: xs, pitch: d.slice(0, 4),
                     widths: l.items.map(i => i.w).slice(0, 3) };
          })
        };
      })
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('%s  %s 题   纸宽 %s (缩放 %s)   面数 %d', FMT, NC, d.paperW,
      Math.round(d.scale * 10000) / 10000, d.faceCount);
    d.faces.forEach(function (f) {
      console.log('\n=== 第 %d 面  (面宽 %s)  选择题行数 %d ===', f.face, f.faceW, f.lineCount);
      f.lines.forEach(function (l, li) {
        console.log('  行%d  top=%s  %d 列  列宽=%s',
          li + 1, l.top, l.n, l.widths.join(','));
        console.log('      x = %s', l.xs.join(', '));
        console.log('      列距 = %s', l.pitch.join(', '));
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
