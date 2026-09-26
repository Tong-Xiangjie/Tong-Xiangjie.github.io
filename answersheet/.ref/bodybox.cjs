const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9553;
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
    const S = window.AS.subject;
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:175.99mm';
    host.innerHTML = S.render([{ no: 13, score: 10, lines: 1, scoreShow: true }],
      { lineH: 7.7008, showHeader: false, pageTip: false, tailExtra: 0, frameH: 0 });
    document.body.appendChild(host);
    const body = host.querySelector('.as-subj-body');
    const cs = getComputedStyle(body);
    const out = {
      inlineH: body.style.height,
      csHeight: cs.height,
      csMinHeight: cs.minHeight,
      csDisplay: cs.display,
      csBoxSizing: cs.boxSizing,
      csPadding: cs.paddingTop + '/' + cs.paddingBottom,
      csMargin: cs.marginTop + '/' + cs.marginBottom,
      csBorder: cs.borderTopWidth + '/' + cs.borderBottomWidth,
      offsetH: body.offsetHeight,
      clientH: body.clientHeight,
      scrollH: body.scrollHeight,
      rectH: body.getBoundingClientRect().height,
      /* 用 injection 量：设成 1mm 看是否可缩 */
      test: (function () {
        body.style.height = '1mm';
        const r1 = body.getBoundingClientRect().height;
        body.style.height = '20mm';
        const r2 = body.getBoundingClientRect().height;
        body.style.height = '7.7mm';
        return { h1mm: r1, h20mm: r2 };
      })(),
      /* 父 td / tr 的盒 */
      td: (function () { const e = body.closest('td'); const c = getComputedStyle(e);
        return { h: e.getBoundingClientRect().height, pt: c.paddingTop, pb: c.paddingBottom,
                 minH: c.minHeight, display: c.display }; })(),
      tr: (function () { const e = body.closest('tr'); const c = getComputedStyle(e);
        return { h: e.getBoundingClientRect().height, minH: c.minHeight }; })(),
      table: (function () { const e = body.closest('table'); const c = getComputedStyle(e);
        return { h: e.getBoundingClientRect().height, bs: c.borderSpacing, bc: c.borderCollapse }; })()
    };
    host.remove();
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
