const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9539;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(5000);
  const E = `(() => {
    const G = window.AS.geometry, C = window.AS.config, Pg = window.AS.paginator;
    const p = C.PRESETS.A4;
    const faceW = 210;
    const mark = G.markColumnCenters(p, faceW, 0);
    const col  = G.columnCenters(p, faceW, 0);
    const step = G.choiceStep(p, faceW);
    const shift = G.gridShiftX(p, faceW);
    const off = G.boxOffsets(p);
    const cb = G.contentBox(p, faceW, 0);
    return {
      markCount: mark.length,
      colCount: col.length,
      markFirst3: mark.slice(0, 4),
      colFirst6: col.slice(0, 6),
      step: step, shift: shift,
      colGap: p.colGap, blockW: p.blockW,
      off_outerLeft: off.outerLeft,
      off_leftBandX: off.leftBandX,
      bandRightEdge: off.bandRightEdge,
      cb_left: cb.left,
      /* 「首块对齐某个列心」的成立条件 */
      markIsColHit: mark.map(m => col.some(c => Math.abs(c - m) < 0.02)),
      colStepDelta: [col[1]-col[0], col[2]-col[1]],
      markStepDelta: [mark[1]-mark[0], mark[2]-mark[1]],
      frameTopLimit: G.frameTopLimit(p),
      frameBottomLimit: G.frameBottomLimit(p, 297),
      frameHeight: G.frameHeight(p, 297),
      answerTop: G.answerTop(p),
      answerBottom: G.answerBottom(p, 297)
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
