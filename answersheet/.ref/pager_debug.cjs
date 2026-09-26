/* 分页器内部量：总共几行、每面排几行、每面红框/黑框的几何输入。
   直接读 AS.paginator.lastDebug 与 AS.geometry，不经 DOM。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9477;
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
    set('subjStart','21'); set('subjCount','1'); set('subjScore','10'); set('subjLines','6');
    const fmtBtn = document.querySelector('button[data-val=${FMT}]');
    if (fmtBtn) fmtBtn.click();
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const G = window.AS.geometry, C = window.AS.config, Pg = window.AS.paginator;
    const p = C.PRESETS[${JSON.stringify(FMT)}];
    const g = C.GROUPS[${JSON.stringify(FMT)}];
    const faceW = G.r3(C.PAPER[${JSON.stringify(FMT)}].w / (${JSON.stringify(FMT)}==='A3'?C.A3_COLUMNS:1));
    const plans = G.blockPlan(1, ${NC}, g);
    const maxB = G.maxBlocksPerLine(p, faceW, g);
    const cols = G.columnsPerLine(p, faceW, g);
    /* 分页器自己的 perLine 算法（planBlocks 里那段） */
    let used=0, perLine=0;
    for (let i=0;i<plans.length;i++){
      const need=plans[i].count;
      if (used>0 && used + g.gap + need > cols) break;
      used += (used>0?g.gap:0) + need;
      perLine++;
    }
    perLine = Math.max(1, Math.min(g.perLine, perLine));
    const page = document.querySelector('.as-page');
    const domLines = page.querySelectorAll('.as-choice-line').length;
    return {
      choiceTotal: ${NC},
      blockCount: plans.length,
      maxBlocksPerLine: maxB,
      columnsPerLine: cols,
      groupPerLineDeprecated: g.perLine,
      paginatorPerLine: perLine,
      expectTotalLines: Math.ceil(plans.length / perLine),
      domChoiceLinesTotal: domLines,
      colH: G.columnHeight(p), lineGap: G.lineGapH(p), lineH: G.lineHeight(p),
      chromeH: G.choiceChromeH(p), footH: G.choiceFootH(p),
      usable: Pg.PAGE_H - Pg.BOTTOM_RESERVE,
      chromeFirst: window.AS.page.chromeHeight(true),
      chromeOther: window.AS.page.chromeHeight(false),
      trace: window.__PAGER_TRACE || null,
      faces: Pg.lastDebug ? Pg.lastDebug.faces.map(f => ({
        first: f.first, cursor: f.cursor,
        body: f.body.map(x => x.kind === 'choice'
          ? {kind:'choice', boxTop:x.boxTop, rows:x.rows}
          : {kind:'subj', no:x.no, top:x.top, lines:x.lines, first:x.first, cont:x.cont})
      })) : null,
      domFaceCount: page.querySelectorAll('.as-face').length
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    console.log(JSON.stringify(res.result.result.value, null, 1));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
