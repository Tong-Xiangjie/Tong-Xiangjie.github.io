const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9567;
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
    const R = el => { const r = el.getBoundingClientRect();
      return { top: Math.round(r.top*1000)/1000, bot: Math.round(r.bottom*1000)/1000,
               h: Math.round(r.height*1000)/1000 }; };
    const rows = Array.from(face.querySelectorAll('.as-subject-inner-table tr'));
    const td = face.querySelector('.as-subject-inner-table td');
    const body = face.querySelector('.as-subj-body');
    const head = face.querySelector('.as-subj-head');
    const tbody = face.querySelector('.as-subject-inner-table tbody');
    const table = face.querySelector('.as-subject-inner-table');
    /* 把 td 的 padding 归零，看行高变化 —— 直接验证 padding 是否被计入 */
    const before = table.getBoundingClientRect().height;
    const tdCS = getComputedStyle(td);
    const padSave = td.style.padding;
    td.style.padding = '0';
    const after = table.getBoundingClientRect().height;
    td.style.padding = padSave;
    return {
      table: R(table), tbody: tbody ? R(tbody) : null,
      row0: R(rows[0]), row1: R(rows[1]),
      td0: R(td), body0: R(body), head0: R(head),
      tdPadding: tdCS.paddingTop + ' / ' + tdCS.paddingBottom,
      tdHasBorder: tdCS.borderTopWidth,
      tableH_before: Math.round(before*1000)/1000,
      tableH_afterPadZero: Math.round(after*1000)/1000,
      padDelta: Math.round((before - after)*1000)/1000,
      tableHTMLhead: table.outerHTML.slice(0, 200)
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
