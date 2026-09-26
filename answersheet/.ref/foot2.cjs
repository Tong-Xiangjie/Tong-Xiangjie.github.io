const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9577;
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
    /* 关掉舞台整体缩放，用 getBoundingClientRect 量（含页脚自身 transform） */
    const st = document.querySelector('.preview-stage'); st.style.transform = 'none';
    const face = document.querySelector('.preview-stage .as-face');
    const fb = face.getBoundingClientRect();
    const PX = fb.width / 210;
    const mm = v => Math.round(v / PX * 1000) / 1000;
    const R = el => { const r = el.getBoundingClientRect();
      return { top: mm(r.top - fb.top), h: mm(r.height),
               cy: mm(r.top - fb.top + r.height / 2) }; };
    const foot = face.querySelector('.as-footer');
    const marks = Array.from(face.querySelectorAll('.as-mark-corner, .as-corner'))
      .map(R).sort((a, b) => a.top - b.top);
    const f = R(foot);
    const low = marks[marks.length - 1];
    return { pxPerMM: PX, footer: f, lowerMark: low,
      deltaCy: Math.round((f.cy - low.cy) * 1000) / 1000,
      footerBotGap: Math.round((297 - (f.top + f.h)) * 1000) / 1000,
      inline: foot.getAttribute('style') };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
