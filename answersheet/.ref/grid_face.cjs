/* 列出所有选择题网格的父链与宽度，用于诊断 A3 网格是否跨面。
   用法：node .ref\grid_face.cjs [A4|A3] [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9449;
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
    const FACEW = PAGE_W / NF;
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / PAGE_W;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const chainOf = e => { const out = []; let c = e;
      while (c && c !== page) { out.push(c.className || c.tagName); c = c.parentElement; }
      return out; };
    const grids = Array.from(page.querySelectorAll('.as-choice-grid')).map(function (g, i) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { i: i, left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), pos: cs.position, ml: cs.marginLeft, disp: cs.display,
               chain: chainOf(g).join(' < ') };
    });
    const inner = Array.from(page.querySelectorAll('.as-choice-inner')).map(function (g) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left), w: mm(b.width),
               pos: cs.position, chain: chainOf(g).join(' < ') };
    });
    const lines = Array.from(page.querySelectorAll('.as-choice-line')).map(function (g) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left), w: mm(b.width),
               pos: cs.position, disp: cs.display, chain: chainOf(g).join(' < ') };
    });
    const others = Array.from(page.querySelectorAll('.as-choice-outer')).map(function (g) {
      const b = g.getBoundingClientRect();
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), chain: chainOf(g).join(' < ') };
    });
    const faces = Array.from(page.querySelectorAll('.as-face')).map(function (f) {
      const b = f.getBoundingClientRect();
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), cls: f.className };
    });
    return { faceW: FACEW, pageW: mm(pr.width), faces: faces,
             grids: grids, outers: others, inners: inner, lines: lines };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('%s  纸宽 %s   面宽 %s', FMT, d.pageW, d.faceW);
    console.log('\n面:');
    d.faces.forEach(function (f, i) {
      console.log('   #%d  %s → %s  (宽 %s)  cls=%s', i + 1, f.left, f.right, f.w, f.cls);
    });
    console.log('\n.as-choice-outer:');
    d.outers.forEach(function (o) {
      console.log('   %s → %s (宽 %s)', o.left, o.right, o.w);
      console.log('      父链: %s', o.chain);
    });
    console.log('\n.as-choice-grid:');
    d.grids.forEach(function (g) {
      console.log('   #%d %s → %s (宽 %s)', g.i + 1, g.left, g.right, g.w);
      console.log('      父链: %s', g.chain);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
