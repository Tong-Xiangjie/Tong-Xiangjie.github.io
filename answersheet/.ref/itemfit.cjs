const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9549;
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

  /* 在真实卡片里逐题量：题块黑框（含题头）实际高 */
  const E = `(() => {
    const S = window.AS.subject, Pg = window.AS.paginator, G = window.AS.geometry;
    const out = [];
    [1,2,3,4,6,8,10,12,16].forEach(function (n) {
      /* 用 builder 生成 n 行单题，塞到一个脱离文档流的容器里量高 */
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:175.99mm';
      host.innerHTML = S.render(
        Array.from({length: 1}, (_, i) => ({ no: 13 + i, score: 10, lines: n, scoreShow: true })),
        { lineH: 7.7008, showHeader: false, pageTip: false, tailExtra: 0, frameH: 0 });
      document.body.appendChild(host);
      const outer = host.querySelector('.as-subject-outer');
      const tab = host.querySelector('.as-subject-inner-table');
      /* 用真实 mm：拿纸宽做换算 */
      const probe = document.querySelector('.preview-stage .as-page');
      const S2 = probe ? probe.getBoundingClientRect().width / 210 : 1;
      const mm = v => Math.round((v / S2) * 1000) / 1000;
      out.push({
        lines: n,
        modelItemH: S.itemHeight(n, 7.7008),
        realOuterH: mm(outer.getBoundingClientRect().height),
        realTableH: mm(tab.getBoundingClientRect().height),
        /* 红框内容盒高 = 外围高 − 上下边框(0.3×2) */
        realContentH: mm(outer.getBoundingClientRect().height) - 0.6
      });
      host.remove();
    });
    return {
      SUBJ_BOX_CHROME: Pg.SUBJ_BOX_CHROME,
      SUBJ_ITEM_FIX: Pg.SUBJ_ITEM_FIX,
      SUBJ_CHROME: Pg.SUBJ_CHROME,
      rowOverhead: S.ROW_OVERHEAD, headH: S.HEAD_H, cellPad: S.cellPad(),
      out: out
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const d = r.result.result.value;
    console.log('SUBJ_BOX_CHROME=' + d.SUBJ_BOX_CHROME + '  SUBJ_ITEM_FIX=' + d.SUBJ_ITEM_FIX);
    console.log('HEAD_H=' + d.headH + ' ROW_OVERHEAD=' + d.rowOverhead + ' cellPad=' + d.cellPad);
    console.log('SUBJ_CHROME=' + JSON.stringify(d.SUBJ_CHROME));
    console.log('');
    console.log('lines  modelItemH  realOuterH  realTableH  realContentH  realOuterH-modelItemH');
    d.out.forEach(x => {
      console.log(String(x.lines).padEnd(6) + String(x.modelItemH).padEnd(12) +
        String(x.realOuterH).padEnd(12) + String(x.realTableH).padEnd(12) +
        String(x.realContentH).padEnd(14) + (Math.round((x.realOuterH - x.modelItemH)*1000)/1000));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
