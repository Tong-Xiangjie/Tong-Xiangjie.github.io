/* 量「网格顶 vs 左侧定位点」「网格顶 vs 题号行」的原始关系。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9457;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '40';
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
    set('subjStart',''); set('subjCount','0');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const top = e => mm(e.getBoundingClientRect().top - fb.top);
    const grid = face.querySelector('.as-choice-grid');
    const lines = Array.from(face.querySelectorAll('.as-choice-line'));
    const marks = Array.from(face.querySelectorAll('.as-mark-left'))
      .map(e => mm(e.getBoundingClientRect().top - fb.top + e.getBoundingClientRect().height/2))
      .sort((a,b)=>a-b);
    const L = window.AS.__faces[0];
    const geo = { rowOffsets: window.AS.geometry.rowOffsets(window.AS.config.PRESETS.A4),
                  lineH: window.AS.geometry.lineHeight(window.AS.config.PRESETS.A4),
                  lineGapH: window.AS.geometry.lineGapH(window.AS.config.PRESETS.A4),
                  gapMarkOffset: window.AS.geometry.lineGapMarkOffset(window.AS.config.PRESETS.A4) };
    return {
      gridTop: top(grid),
      lineTops: lines.map(top),
      numRowTops: lines.map(l => top(l.querySelector('.as-choice-nums'))),
      numSpanTops: lines.map(l => top(l.querySelector('.as-choice-num'))),
      numSpanCys: lines.map(l => { const b=l.querySelector('.as-choice-num').getBoundingClientRect(); const fb2=fb; return mm((b.top+b.bottom)/2 - fb2.top); }),
      jsGridTop: L.gridTop,
      jsLineTops: [L.gridTop, Math.round((L.gridTop + geo.lineH)*1000)/1000],
      jsRowCenters: L.rowCenters,
      marks: marks, geo: geo,
      numRowHtml: lines[0].querySelector('.as-choice-nums').outerHTML.slice(0, 200),
      numRowStyleTop: lines[0].querySelector('.as-choice-nums').style.top,
      numRowCsTop: getComputedStyle(lines[0].querySelector('.as-choice-nums')).top,
      numRowCsTF: getComputedStyle(lines[0].querySelector('.as-choice-nums')).transform,
      optRow0StyleTop: lines[0].querySelector('.as-choice-optrow').style.top,
      optRow0CsTop: getComputedStyle(lines[0].querySelector('.as-choice-optrow')).top,
      innerPadTop: getComputedStyle(face.querySelector('.as-choice-inner')).paddingTop,
      innerMarginTop: face.querySelector('.as-choice-inner').style.marginTop,
      gridMarginTop: grid.style.marginTop
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('JS gridTop          = %s', d.jsGridTop);
    console.log('JS 行顶(算)          = %s', d.jsLineTops.join(', '));
    console.log('JS rowCenters       = %s', d.jsRowCenters.join(', '));
    console.log('DOM 网格 top        = %s', d.gridTop);
    console.log('DOM 行 top          = %s', d.lineTops.join(', '));
    console.log('DOM 题号行 top      = %s', d.numRowTops.join(', '));
    console.log('DOM 题号 span top   = %s', d.numSpanTops.join(', '));
    console.log('DOM 题号 span 行心   = %s', d.numSpanCys.join(', '));
    console.log('DOM 左侧定位点 cy    = %s', d.marks.join(', '));
    console.log('geo rowOffsets      = %s', d.geo.rowOffsets.join(', '));
    console.log('geo lineH=%s lineGapH=%s gapMarkOffset=%s',
      d.geo.lineH, d.geo.lineGapH, d.geo.gapMarkOffset);
    console.log('\\n题号行 html = %s', d.numRowHtml);
    console.log('题号行 style.top=%s  computed top=%s  transform=%s',
      d.numRowStyleTop, d.numRowCsTop, d.numRowCsTF);
    console.log('选项行 style.top=%s  computed top=%s', d.optRow0StyleTop, d.optRow0CsTop);
    console.log('inner paddingTop=%s marginTop=%s gridMarginTop=%s',
      d.innerPadTop, d.innerMarginTop, d.gridMarginTop);
    const o0 = d.geo.rowOffsets[0];
    console.log('\n▶ DOM 题号行1 top − DOM 网格 top = %s   (rowOffsets[0] = %s)',
      Math.round((d.numRowTops[0] - d.gridTop) * 1000) / 1000, o0);
    console.log('▶ DOM 行顶1 → 行顶2 = %s   (lineH = %s)',
      Math.round((d.lineTops[1] - d.lineTops[0]) * 1000) / 1000, d.geo.lineH);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
