const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9437;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
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

  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','语文');
    set('choiceTotal','12'); set('subjStart',''); set('subjCount','3');
    set('subjScore','10,10,10'); set('subjLines','8,8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page=document.querySelector('.as-page');
    const face=page.querySelector('.as-face');
    const ft=face.querySelector('.as-footer');
    const cs=getComputedStyle(ft);
    const S=page.getBoundingClientRect().width/210;
    const M=v=>Math.round(v/S*1000)/1000;
    const fb=face.getBoundingClientRect();
    /* 找出所有作用于该元素的 .as-footer 规则 */
    var rules=[];
    for (const sh of document.styleSheets) {
      let rs; try { rs = sh.cssRules; } catch { continue; }
      for (const r of rs) {
        if (r.selectorText && r.selectorText.indexOf('as-footer') >= 0) {
          rules.push({ href: sh.href, sel: r.selectorText,
            bottom: r.style.bottom, cssText: r.cssText.slice(0, 300) });
        }
      }
    }
    return {
      S: S,
      footerTop: M(ft.getBoundingClientRect().top - fb.top),
      computedBottom: cs.bottom,
      cornerBottomY: getComputedStyle(page).getPropertyValue('--corner-bottom-y').trim(),
      paperH: getComputedStyle(page).getPropertyValue('--paper-h').trim(),
      oldVar: getComputedStyle(page).getPropertyValue('--corner-bottom').trim(),
      rules: rules
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0,700));
  else console.log(JSON.stringify(res.result.result.value, null, 2));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
