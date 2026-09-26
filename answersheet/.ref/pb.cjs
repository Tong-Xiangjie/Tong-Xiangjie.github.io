const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9573;
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
    const S = window.AS.subject, Pg = window.AS.paginator, C = window.AS.config, G = window.AS.geometry;
    const p = C.PRESETS.A4;
    const items = [
      { no: 13, score: 10, lines: 6, lineH: 7.7008 },
      { no: 14, score: 10, lines: 6, lineH: 7.7008 }
    ];
    const blocks = Pg.planBlocks({ preset: p, group: C.GROUPS.A4, faceW: 210,
      choiceTotal: 0, choiceStart: 1, subjItems: items });
    return {
      SRC_HAS_PITCH: Pg.paginate.toString().indexOf('SUBJ_ITEM_PITCH') >= 0,
      PITCH: Pg.SUBJ_ITEM_PITCH,
      BOX_CHROME: Pg.SUBJ_BOX_CHROME,
      ITEM_FIX: Pg.SUBJ_ITEM_FIX,
      itemHeight6: S.itemHeight(6, 7.7008),
      itemHeight1: S.itemHeight(1, 7.7008),
      blocks: blocks,
      segH: (function () {
        /* 复算分页器内部用的段高，看差在哪 */
        const PITCH = Pg.SUBJ_ITEM_PITCH;
        return { h: blocks[0].h, baseH: Math.round((blocks[0].h + PITCH) * 1000) / 1000,
                 six: Math.round((blocks[0].h + PITCH + 6 * 7.7008) * 1000) / 1000 };
      })(),
      F_TOP: G.frameTopLimit(p), F_BOT: G.frameBottomLimit(p, 297),
      foot: Pg.footReserve()
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
