/* 极端情况：选择题换页（300+ 题）时，逐面量「红框 vs 黑框」的相对位置。
   目标不变量（每一面都必须成立）：
     · 红框内容盒左 → 黑框外缘左 = boxGap             （左右各一）
     · 红框内容盒右 − 黑框外缘右 = boxGap
     · 红框内容盒底 − 黑框外缘底 = outerPadYBottom
     · 黑框内缘上 → 网格（题号行）上缘 = innerPadTop
     · 黑框内缘下 → 末行选项下缘 = innerPadBottom
     · 红框外缘底 ≤ 273.3（页脚地盘）
   并把每一面的红框顶/底、黑框顶/底都打出来。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9475;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '300';
const FMT = process.argv[3] || 'A4';
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
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','10'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6,6');
    const fmtBtn = document.querySelector('#formatPick button[data-val="${FMT}"]') ||
                   document.querySelector('button[data-val="${FMT}"]');
    if (fmtBtn) fmtBtn.click();
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    if (!pages.length) return [{ err: '预览里没有 .as-page' }];
    const pr = pages[0].getBoundingClientRect();
    const paperW = ${JSON.stringify(FMT)} === 'A3' ? 420 : 210;
    const S = pr.width / paperW;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const faces = [];
    pages.forEach(function (pg) {
      Array.from(pg.querySelectorAll('.as-face')).forEach(function (f) { faces.push(f); });
    });
    const B = (e, b) => { const r = e.getBoundingClientRect(), q = b.getBoundingClientRect();
      return { t: mm(r.top - q.top), b: mm(r.bottom - q.top),
               l: mm(r.left - q.left), r: mm(r.right - q.left) }; };
    return faces.map(function (face, fi) {
      const out = { face: fi + 1, reds: [], faceLeft: mm(face.getBoundingClientRect().left - pr.left) };
      const sections = Array.from(face.querySelectorAll('.as-choice-section'));
      out.redCount = sections.length;
      sections.forEach(function (sec) {
        const outer = sec.querySelector('.as-choice-outer');
        const inner = sec.querySelector('.as-choice-inner');
        const grid  = sec.querySelector('.as-choice-grid');
        const head  = sec.querySelector('.as-choice-header');
        if (!outer || !inner) { out.reds.push({ err: 'missing outer/inner' }); return; }
        const O = B(outer, face), I = B(inner, face), G0 = B(grid, face);
        /* 网格首行题号、末行气泡 */
        const lines = Array.from(sec.querySelectorAll('.as-choice-line'));
        const firstNum = sec.querySelector('.as-choice-num');
        const bubbles = Array.from(sec.querySelectorAll('.as-bubble'));
        const lastBub = bubbles.length ? bubbles.reduce((a, b) =>
          b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a) : null;
        const fn = firstNum ? B(firstNum, face) : null;
        const lb = lastBub ? B(lastBub, face) : null;
        out.reds.push({
          boxTopStyle: sec.style.top,
          outer: O, inner: I, grid: G0,
          headH: head ? B(head, face).b - B(head, face).t : null,
          firstNumTop: fn ? fn.t : null,
          lastBubBottom: lb ? lb.b : null,
          lines: lines.length,
          innerH: mm(inner.getBoundingClientRect().height),
          outerH: mm(outer.getBoundingClientRect().height)
        });
      });
      return out;
    });
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    const d = res.result.result.value;
    console.log('%s 题 · %s · 共 %d 面\n', NC, FMT, d.length);
    const BOX_GAP = 3.0, PAD_T = 3.0, PAD_B = 3.0, PAD_YB = 1.0, BORDER = 0.2646;
    console.log('面 段  红框(l→r, t→b)            黑框(l→r, t→b)            左隙   右隙   下隙   上内距  下内距  行 红框底');
    let bad = 0;
    d.forEach(function (f) {
      f.reds.forEach(function (x, si) {
        if (x.err) { console.log(' %d  %d  %s', f.face, si + 1, x.err); bad++; return; }
        const gapL = Math.round((x.inner.l - x.outer.l - BORDER) * 1000) / 1000;
        const gapR = Math.round((x.outer.r - BORDER - x.inner.r) * 1000) / 1000;
        const gapB = Math.round((x.outer.b - BORDER - x.inner.b) * 1000) / 1000;
        const padT = x.firstNumTop === null ? null
          : Math.round((x.firstNumTop - x.inner.t - BORDER) * 1000) / 1000;
        const padB = x.lastBubBottom === null ? null
          : Math.round((x.inner.b - BORDER - x.lastBubBottom) * 1000) / 1000;
        const ok = (v, t) => v === null ? '?' : (Math.abs(v - t) <= 0.06 ? '' : '**');
        let flag = '';
        if (ok(gapL, BOX_GAP) === '**') flag += 'L';
        if (ok(gapR, BOX_GAP) === '**') flag += 'R';
        if (ok(gapB, PAD_YB) === '**') flag += 'B';
        if (ok(padT, PAD_T) === '**') flag += 'T';
        if (ok(padB, PAD_B) === '**') flag += 'b';
        if (x.outer.b > 273.3 + 0.05) flag += '!';
        if (flag) bad++;
        console.log(' %s  %s  %s→%s  %s→%s   %s→%s  %s→%s   %s%s  %s%s  %s%s  %s%s  %s%s  %s  %s  %s',
          String(f.face).padStart(2), si + 1,
          String(x.outer.l).padStart(6), String(x.outer.r).padStart(6),
          String(x.outer.t).padStart(6), String(x.outer.b).padStart(6),
          String(x.inner.l).padStart(6), String(x.inner.r).padStart(6),
          String(x.inner.t).padStart(6), String(x.inner.b).padStart(6),
          String(gapL).padStart(4), ok(gapL, BOX_GAP),
          String(gapR).padStart(4), ok(gapR, BOX_GAP),
          String(gapB).padStart(4), ok(gapB, PAD_YB),
          String(padT).padStart(4), ok(padT, PAD_T),
          String(padB).padStart(4), ok(padB, PAD_B),
          String(x.lines).padStart(3), String(x.outer.b).padStart(7), flag);
      });
    });
    console.log('\n▶ 目标：左隙=右隙=%s  下隙=%s  上内距=%s  下内距=%s  红框底 ≤ 273.3', BOX_GAP, PAD_YB, PAD_T, PAD_B);
    console.log('▶ 异常段数 = %d %s', bad, bad ? '** 有问题 **' : 'OK');
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
