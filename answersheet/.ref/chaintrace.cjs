/* builder 的输入：分页器给出的 boxTop / gridTop，以及由此算出的
   gridTop 相对红框顶、innerMarginTop。看点 2 到底错在哪一步。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9483;
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
    const G = window.AS.geometry, C = window.AS.config;
    const p = C.PRESETS.A4, off = G.boxOffsets(p);
    const Pg = window.AS.paginator;
    const chromeH = G.choiceChromeH(p), footH = G.choiceFootH(p);
    const expectMargin = G.snapMM(G.r3(chromeH - off.border - off.outerPadY -
      off.headerH - off.headerGap - off.border - off.innerPadTop));
    return {
      chromeH: chromeH,
      expectMarginTop: expectMargin,
      headerH: off.headerH, headerGap: off.headerGap,
      border: off.border, outerPadY: off.outerPadY, innerPadTop: off.innerPadTop,
      note: 'chromeH 已含 红框线+outerPadY+headerH+headerGap+黑框线+innerPadTop',
      faces: Pg.lastDebug.faces.map(function (f) {
        return {
          first: f.first, cursor: f.cursor,
          body: f.body.map(function (x) {
            if (x.kind !== 'choice') return { kind: x.kind };
            return {
              kind: 'choice', boxTop: x.boxTop, rows: x.rows,
              gridTopAbs: x.gridTop,
              gridTopRel: G.r3(x.gridTop - x.boxTop),
              head: x.head
            };
          })
        };
      })
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    const d = res.result.result.value;
    console.log('choiceChromeH = %s   期望 innerMarginTop = %s', d.chromeH, d.expectMarginTop);
    console.log('红框线=%s outerPadY=%s headerH=%s headerGap=%s 黑框线=%s innerPadTop=%s',
      d.border, d.outerPadY, d.headerH, d.headerGap, d.border, d.innerPadTop);
    console.log('%s\n', d.note);
    d.faces.forEach(function (f, i) {
      console.log('面 %d  first=%s  cursor=%s', i + 1, f.first, f.cursor);
      f.body.forEach(function (x) {
        if (x.kind !== 'choice') { console.log('   subj'); return; }
        console.log('   choice boxTop=%s rows=%s  gridTopAbs=%s  gridTopRel=%s  head=%s',
          x.boxTop, x.rows, x.gridTopAbs, x.gridTopRel, x.head);
        console.log('      → 实际 innerMarginTop = gridTopRel − (border+padY+headerH+headerGap+border+innerPadTop) = %s',
          Math.round((x.gridTopRel - (d.border + d.outerPadY + d.headerH + d.headerGap +
            d.border + d.innerPadTop)) * 1000) / 1000);
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
