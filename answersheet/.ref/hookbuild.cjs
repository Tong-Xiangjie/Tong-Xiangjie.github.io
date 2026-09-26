/* 直击：把 .as-choice-inner 的内联 style 属性与 computed marginTop 打出来，
   并复算 builder 应该给出的值。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9485;
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

    /* 钩住 Choice.build，记录每次调用的入参与算出来的 margin */
    const G = window.AS.geometry, C = window.AS.config;
    const p = C.PRESETS.A4, off = G.boxOffsets(p);
    const calls = [];
    const origBuild = window.AS.choice.build;
    window.AS.choice.build = function (o) {
      const gt = (o.gridTop !== undefined && o.gridTop !== null) ? o.gridTop : G.choiceChromeH(p);
      const m = G.snapMM(G.r3(gt - off.border - off.outerPadY - off.headerH -
                              off.headerGap - off.border - off.innerPadTop));
      calls.push({ rows: o.rows, fromLine: o.fromLine, first: o.first,
                   gridTopIn: o.gridTop, gridTopUsed: gt, marginTop: m });
      return origBuild.apply(this, arguments);
    };
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const inners = Array.from(document.querySelectorAll('.preview-stage .as-choice-inner'))
      .map(e => ({
        styleAttr: e.getAttribute('style'),
        inlineMarginTop: e.style.marginTop,
        computedMarginTop: getComputedStyle(e).marginTop,
        offTop: e.offsetTop,
        sectTop: e.parentElement.style.top
      }));
    return { calls: calls, inners: inners, chromeH: G.choiceChromeH(p) };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    const d = res.result.result.value;
    console.log('choiceChromeH=%s\n', d.chromeH);
    console.log('Choice.build 调用记录：');
    d.calls.forEach(function (c, i) {
      console.log('  #%d rows=%s fromLine=%s first=%s  gridTopIn=%s gridTopUsed=%s → marginTop=%s',
        i + 1, c.rows, c.fromLine, c.first, c.gridTopIn, c.gridTopUsed, c.marginTop);
    });
    console.log('\n渲染出的 .as-choice-inner：');
    d.inners.forEach(function (x, i) {
      console.log('  #%d sectionTop=%s offTop=%s', i + 1, x.sectTop, x.offTop);
      console.log('     inline marginTop = %s   computed = %s', x.inlineMarginTop, x.computedMarginTop);
      console.log('     style = %s', x.styleAttr);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
