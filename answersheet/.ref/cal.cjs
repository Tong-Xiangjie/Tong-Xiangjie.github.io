/* 在真实卡片里量「单题黑框高」，与 subject.itemHeight() 逐档对比。
   全部用 offsetHeight（不受 transform 影响）。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9571;
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
    const PX = 96/25.4;
    const S = window.AS.subject;
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    const mm = v => Math.round(v / PX * 1000) / 1000;
    const res = [];
    [1,2,3,4,5,6,8,10,12,16].forEach(function (n) {
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','0'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','1');
      set('subjScore','10'); set('subjLines', String(n));
      document.getElementById('btnGenerate').click();
      const face = document.querySelector('.preview-stage .as-face');
      const tab = face.querySelector('.as-subject-inner-table');
      const outer = face.querySelector('.as-subject-outer');
      const td = face.querySelector('.as-subject-inner-table td');
      const head = face.querySelector('.as-subj-head');
      const body = face.querySelector('.as-subj-body');
      res.push({
        n: n,
        model: S.itemHeight(n, 7.7008),
        tableH: mm(tab.offsetHeight),
        outerH: mm(outer.offsetHeight),
        tdH: mm(td.offsetHeight),
        headH: mm(head.offsetHeight),
        bodyH: mm(body.offsetHeight),
        outerInline: outer.style.height,
        gapOuterToTable: mm(tab.offsetTop - outer.offsetTop)
      });
    });
    return res;
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const d = r.result.result.value;
    console.log('n   model    tableH   outerH   tdH      headH   bodyH   gapO→T   table-model');
    d.forEach(x => console.log(
      String(x.n).padEnd(4) + String(x.model).padEnd(9) + String(x.tableH).padEnd(9) +
      String(x.outerH).padEnd(9) + String(x.tdH).padEnd(9) + String(x.headH).padEnd(8) +
      String(x.bodyH).padEnd(8) + String(x.gapOuterToTable).padEnd(9) +
      String(Math.round((x.tableH - x.model) * 1000) / 1000)));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
