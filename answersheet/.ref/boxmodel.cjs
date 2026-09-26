/* 红框/黑框的盒模型逐项实测：margin-left、border、padding、以及黑框
   相对红框内容盒的实际偏移。用于定位「红框内缘 → 黑框外缘」为何不是 boxGap。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9479;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '300';
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
    set('subjStart','21'); set('subjCount','1'); set('subjScore','10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const out = [];
    pages.forEach(function (pg, pi) {
      Array.from(pg.querySelectorAll('.as-face')).forEach(function (face, fi) {
        const sec = face.querySelector('.as-choice-section');
        if (!sec) return;
        const outer = sec.querySelector('.as-choice-outer');
        const inner = sec.querySelector('.as-choice-inner');
        const grid = sec.querySelector('.as-choice-grid');
        const head = sec.querySelector('.as-choice-header');
        const cs = e => getComputedStyle(e);
        const r = e => { const q = e.getBoundingClientRect();
          return { l: mm(q.left - pr.left), t: mm(q.top - pr.top),
                   w: mm(q.width), h: mm(q.height),
                   r: mm(q.right - pr.left), b: mm(q.bottom - pr.top) }; };
        out.push({
          face: pi + 1,
          secLeft: cs(sec).left, secTop: sec.style.top,
          outer: r(outer), inner: r(inner), grid: r(grid),
          head: head ? r(head) : null,
          innerMarginLeft: cs(inner).marginLeft,
          innerMarginTop: cs(inner).marginTop,
          innerMarginBottom: cs(inner).marginBottom,
          innerWidth: cs(inner).width,
          innerHeight: cs(inner).height,
          innerPadTop: cs(inner).paddingTop,
          innerPadBottom: cs(inner).paddingBottom,
          gridMarginLeft: cs(grid).marginLeft,
          gridMarginTop: cs(grid).marginTop,
          gridWidth: cs(grid).width,
          outerPadTop: cs(outer).paddingTop,
          outerPadBottom: cs(outer).paddingBottom,
          outerPadLeft: cs(outer).paddingLeft,
          vars: {
            outerLeft: cs(sec.parentElement).getPropertyValue('--outer-left'),
            boxGap: cs(sec.parentElement).getPropertyValue('--box-gap'),
            boxBorder: cs(sec.parentElement).getPropertyValue('--box-border'),
            headerH: cs(sec.parentElement).getPropertyValue('--choice-header-h'),
            headerGap: cs(sec.parentElement).getPropertyValue('--choice-header-gap'),
            padY: cs(sec.parentElement).getPropertyValue('--outer-pad-y'),
            padYb: cs(sec.parentElement).getPropertyValue('--outer-pad-y-bottom'),
            innerPadTop: cs(sec.parentElement).getPropertyValue('--inner-pad-top'),
            innerPadBottom: cs(sec.parentElement).getPropertyValue('--inner-pad-bottom')
          }
        });
      });
    });
    return out;
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    res.result.result.value.forEach(function (x) {
      console.log('── 面 %d ─────────────────────────────', x.face);
      console.log('  section left=%s  top=%s', x.secLeft, x.secTop);
      console.log('  红框 outer : l=%s r=%s t=%s b=%s  w=%s h=%s',
        x.outer.l, x.outer.r, x.outer.t, x.outer.b, x.outer.w, x.outer.h);
      console.log('  黑框 inner : l=%s r=%s t=%s b=%s  w=%s h=%s',
        x.inner.l, x.inner.r, x.inner.t, x.inner.b, x.inner.w, x.inner.h);
      console.log('  网格 grid  : l=%s r=%s t=%s b=%s  w=%s h=%s',
        x.grid.l, x.grid.r, x.grid.t, x.grid.b, x.grid.w, x.grid.h);
      if (x.head) console.log('  栏目头     : t=%s b=%s h=%s', x.head.t, x.head.b, x.head.h);
      console.log('  inner margin L/T/B = %s / %s / %s', x.innerMarginLeft, x.innerMarginTop, x.innerMarginBottom);
      console.log('  grid  margin L/T   = %s / %s', x.gridMarginLeft, x.gridMarginTop);
      console.log('  实际左隙 = inner.l − (outer.l + border) = %s',
        Math.round((x.inner.l - x.outer.l - 0.2646) * 1000) / 1000);
      console.log('  实际下隙 = (outer.b − border) − inner.b = %s',
        Math.round((x.outer.b - 0.2646 - x.inner.b) * 1000) / 1000);
      console.log('  上内距   = grid.t − (inner.t + border) = %s',
        Math.round((x.grid.t - x.inner.t - 0.2646) * 1000) / 1000);
      console.log('  变量: %s', JSON.stringify(x.vars));
      console.log('');
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
