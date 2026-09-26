const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9551;
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
    const probe = document.querySelector('.preview-stage .as-page');
    const S2 = probe ? probe.getBoundingClientRect().width / 210 : 1;
    const mm = v => Math.round((v / S2) * 1000) / 1000;
    /* n=1 与 n=2，逐组件分解 */
    const res = [];
    [1, 2].forEach(function (n) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:175.99mm';
      host.innerHTML = S.render([{ no: 13, score: 10, lines: n, scoreShow: true }],
        { lineH: 7.7008, showHeader: false, pageTip: false, tailExtra: 0, frameH: 0 });
      document.body.appendChild(host);
      const outer = host.querySelector('.as-subject-outer');
      const tab = host.querySelector('.as-subject-inner-table');
      const tr = host.querySelector('tr');
      const td = host.querySelector('td');
      const head = host.querySelector('.as-subj-head');
      const body = host.querySelector('.as-subj-body');
      const cs = el => { const c = getComputedStyle(el);
        return { pt: c.paddingTop, pb: c.paddingBottom, mt: c.marginTop, mb: c.marginBottom,
                 bt: c.borderTopWidth, h: c.height, lh: c.lineHeight, fs: c.fontSize }; };
      res.push({
        n: n,
        outerH: mm(outer.getBoundingClientRect().height),
        tableH: mm(tab.getBoundingClientRect().height),
        trH: mm(tr.getBoundingClientRect().height),
        tdH: mm(td.getBoundingClientRect().height),
        headH: mm(head.getBoundingClientRect().height),
        bodyH: mm(body.getBoundingClientRect().height),
        bodyInlineH: body.style.height,
        tdCS: cs(td), headCS: cs(head), bodyCS: cs(body),
        tableCS: cs(tab),
        lineVar: getComputedStyle(document.querySelector('.preview-stage'))
          .getPropertyValue('--answer-line-h')
      });
      host.remove();
    });
    return res;
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
