const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9565;
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
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const face = document.querySelector('.preview-stage .as-face');
    const g = el => { const c = getComputedStyle(el);
      return { oh: el.offsetHeight, rect: Math.round(el.getBoundingClientRect().height * 1000) / 1000,
        pt: c.paddingTop, pb: c.paddingBottom, bt: c.borderTopWidth, bb: c.borderBottomWidth,
        h: c.height, minH: c.minHeight, lh: c.lineHeight, fs: c.fontSize, disp: c.display };
    };
    const td1 = face.querySelector('.as-subject-inner-table td');
    const b1 = face.querySelector('.as-subj-body');
    const h1 = face.querySelector('.as-subj-head');
    const tr1 = td1.parentElement;
    const table = face.querySelector('.as-subject-inner-table');
    const outer = face.querySelector('.as-subject-outer');
    return {
      pxPerMM: face.getBoundingClientRect().width / 210,
      outer: g(outer), table: g(table), tr1: g(tr1), td1: g(td1), head1: g(h1), body1: g(b1),
      bodyInlineH: b1.style.height,
      tdCount: face.querySelectorAll('.as-subject-inner-table td').length,
      allRows: Array.from(face.querySelectorAll('.as-subject-inner-table tr'))
        .map(r => Math.round(r.getBoundingClientRect().height * 1000) / 1000),
      innerPadX: getComputedStyle(document.querySelector('.preview-stage')).getPropertyValue('--inner-pad-x').trim(),
      innerPadY: getComputedStyle(document.querySelector('.preview-stage')).getPropertyValue('--inner-pad-y').trim()
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
