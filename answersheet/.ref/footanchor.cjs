const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9575;
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
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const mm = v => Math.round(v / PX * 1000) / 1000;
    const face = document.querySelector('.preview-stage .as-face');
    const offTop = (el) => { let y = 0, e = el;
      while (e && e !== face) { y += e.offsetTop; e = e.offsetParent; } return y; };
    const foot = face.querySelector('.as-footer');
    const marks = Array.from(face.querySelectorAll('.as-mark-corner, .as-corner'));
    const m = marks.map(x => ({ top: mm(offTop(x)), h: mm(x.offsetHeight),
                                cy: mm(offTop(x) + x.offsetHeight/2) }))
                   .sort((a,b) => a.top - b.top);
    const ft = mm(offTop(foot)), fh = mm(foot.offsetHeight);
    const lb = m[m.length-1];
    return {
      cornerCount: m.length,
      lowerMarks: m.slice(-2),
      footer: { top: ft, h: fh, cy: Math.round((ft + fh/2)*1000)/1000,
                bot: Math.round((ft+fh)*1000)/1000 },
      markCy: lb.cy,
      footerCyDelta: Math.round(((ft + fh/2) - lb.cy)*1000)/1000,
      footerInline: foot.getAttribute('style'),
      footerText: foot.textContent.trim().slice(0, 40),
      paperH: 297,
      footerBottomGap: Math.round((297 - (ft+fh))*1000)/1000
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
