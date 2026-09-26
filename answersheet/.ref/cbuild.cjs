const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9581;
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
  await sleep(4500);
  const E = `(() => {
    const C = window.AS.config, G = window.AS.geometry, Pg = window.AS.paginator, Ch = window.AS.choice;
    const p = C.PRESETS.A4;
    const faceW = 210;
    const perLine = G.maxBlocksPerLine(p, faceW, C.GROUPS.A4);
    const bp = G.blockPlan(1, 300, C.GROUPS.A4);
    const lineCount = Math.ceil(bp.length / perLine);
    /* 复算 lineRanges */
    const lineRanges = [];
    for (let li = 0; li < lineCount; li++) {
      const seg = bp.slice(li * perLine, (li + 1) * perLine);
      lineRanges.push({ from: seg[0].from, to: seg[seg.length-1].from + seg[seg.length-1].count - 1 });
    }
    /* 直接调 builder，模拟「续排面第 8..14 行」 */
    const build = (fromLine, rows, first) => {
      const r = Ch.build({ startNo: lineRanges[fromLine].from,
        endNo: lineRanges[fromLine + rows - 1].to, rows: rows, fromLine: fromLine,
        group: { size: 5, perLine: perLine, gap: C.GROUPS.A4.gap }, preset: p,
        faceW: faceW, first: first,
        gridTop: 6.1, gridH: 20.503 * rows + (rows-1) * 2.436, colCenters: null });
      return { htmlLen: r.html.length, lines: (r.html.match(/as-choice-line/g)||[]).length,
               items: (r.html.match(/as-choice-item/g)||[]).length,
               head: r.html.slice(0, 200) };
    };
    return {
      perLine: perLine, bpLen: bp.length, lineCount: lineCount,
      lineRanges: lineRanges,
      face1First8: build(0, 8, true),
      face2Next7: build(8, 7, false),
      face2Last7: build(8, 7, true),
      bpTail: bp.slice(-3),
      bpAt8: bp.slice(perLine*8, perLine*8+2)
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1500));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
