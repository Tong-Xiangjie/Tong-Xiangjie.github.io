/* 量选择区各层盒子的实际宽度（诊断「网格是否跨面 / 是否被挤出黑框」）。
   用法：node .ref\grid_box.cjs [A4|A3] [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9451;
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
    const PAGE_W = window.AS.config.PAPER['${FMT}'].w;
    const NF = '${FMT}' === 'A3' ? window.AS.config.A3_COLUMNS : 1;
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / PAGE_W;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face1 = page.querySelector('.as-face');
    const fb = face1.getBoundingClientRect();
    /* 内联 style 里的 width 值直接读出来，避免被其他规则覆盖看不出来 */
    const inlineW = e => (e.getAttribute('style') || '').match(/width:([0-9.]+)mm/);
    const box = (sel) => Array.from(face1.querySelectorAll(sel)).map(function (e, i) {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { i: i, cls: e.className,
               x: mm(b.left - fb.left), r: mm(b.right - fb.left), w: mm(b.width),
               cssW: cs.width, pos: cs.position, disp: cs.display,
               inlineW: inlineW(e) ? inlineW(e)[1] : null };
    });
    return { faceW: PAGE_W / NF,
             outer: box('.as-choice-outer'),
             inner: box('.as-choice-inner'),
             grid: box('.as-choice-grid'),
             line0: box('.as-choice-line').slice(0, 2),
             col0: box('.as-choice-col').slice(0, 4),
             spacer: box('.as-choice-spacer'),
             section: box('.as-choice-section') };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('%s  面宽 %s', FMT, d.faceW);
    const show = (name, arr) => {
      console.log('\n%s (%d):', name, arr.length);
      arr.forEach(o => console.log('   x=%s → %s  w=%s  cssW=%s  pos=%s disp=%s  inlineW=%s',
        o.x, o.r, o.w, o.cssW, o.pos, o.disp, o.inlineW));
    };
    show('outer', d.outer); show('inner', d.inner); show('grid', d.grid);
    show('line', d.line0); show('col', d.col0); show('spacer', d.spacer);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
