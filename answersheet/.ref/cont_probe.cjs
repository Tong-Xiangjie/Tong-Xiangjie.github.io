/* 续排面（第 2 面起）：红框上缘应顶到 frameTopLimit 10.154。
   注意别把「第 N 面」那行标题盖住。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9531;
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
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','语文'); set('cardSubject','数学');
    set('choiceTotal','300'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const d = window.AS.paginator.lastDebug;
    const out = [];
    let i = 0;
    document.querySelectorAll('.preview-stage .as-page').forEach(function (pg) {
      pg.querySelectorAll('.as-face').forEach(function (fe) {
        i++;
        const fb = fe.getBoundingClientRect();
        const S = fb.width / 210;
        const mm = v => Math.round((v / S) * 1000) / 1000;
        const reds = Array.from(fe.querySelectorAll('.as-choice-outer, .as-subject-outer, .as-noanswer'))
          .map(e => { const r = e.getBoundingClientRect();
            return { t: mm(r.top - fb.top), b: mm(r.bottom - fb.top) }; });
        const title = fe.querySelector('.as-title');
        const head = fe.querySelector('.as-head');
        out.push({
          face: i,
          redTop: reds.length ? Math.min.apply(null, reds.map(r => r.t)) : null,
          redBot: reds.length ? Math.max.apply(null, reds.map(r => r.b)) : null,
          titleT: title ? mm(title.getBoundingClientRect().top - fb.top) : null,
          titleB: title ? mm(title.getBoundingClientRect().bottom - fb.top) : null,
          titleText: title ? title.innerText.trim().slice(0, 20) : null,
          headB: head ? mm(head.getBoundingClientRect().bottom - fb.top) : null
        });
      });
    });
    return { F_TOP: d.frameTopLimit, F_BOT: d.frameBottomLimit, out: out };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else {
    const d = r.result.result.value;
    console.log('红框可达 ' + d.F_TOP + ' .. ' + d.F_BOT + '\n');
    d.out.forEach(f => console.log('面' + f.face +
      '  红框 ' + f.redTop + ' .. ' + f.redBot +
      '   页眉底 ' + f.headB +
      '   标题 ' + f.titleT + '..' + f.titleB + ' «' + f.titleText + '»'));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
