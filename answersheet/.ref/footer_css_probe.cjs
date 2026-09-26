const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9433;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
      .find(t => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','语文');
    set('choiceTotal','12'); set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page=document.querySelector('.as-page');
    const f=document.querySelector('.as-footer');
    const cs=f?getComputedStyle(f):null;
    const pd=page?getComputedStyle(page):null;
    var corners=[];
    document.querySelectorAll('.as-corner').forEach(function(e){
      var b=e.getBoundingClientRect(); corners.push(Math.round(b.top*1000)/1000);
    });
    const S=(page?page.getBoundingClientRect().width:1)/210;
    const M=v=>Math.round(v/S*1000)/1000;
    const M2=v=>Math.round(v*1000)/1000;
    return {
      scale:S,
      pageStyle:(page?page.getAttribute('style'):'').slice(0,600),
      cornerBottomVar: pd?pd.getPropertyValue('--corner-bottom'):'(no page)',
      footerBottomCss: cs?cs.bottom:null,
      footerTop: f?M(f.getBoundingClientRect().top):null,
      footerBot: f?M(f.getBoundingClientRect().bottom):null,
      cornerTopsMm: corners.map(M),
      cornerBotsMm: corners.map(function(t){ return Math.round((M(t)+4.23)*1000)/1000; })
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0,700));
  else console.log(JSON.stringify(res.result.result.value, null, 2));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
