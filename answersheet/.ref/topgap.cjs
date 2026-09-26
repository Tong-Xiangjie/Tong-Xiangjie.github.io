/* 查首页红框上缘：内联 top 值 vs 实际渲染 top，找出那 0.918mm 的差。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9527;
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
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const d = window.AS.paginator.lastDebug;
    const face = document.querySelector('.preview-stage .as-face');
    const fb = face.getBoundingClientRect();
    const S = fb.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const pick = sel => {
      const e = face.querySelector(sel); if (!e) return null;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return { sel: sel, inlineTop: e.style.top, cssTop: cs.top,
               position: cs.position, marginTop: cs.marginTop,
               borderTop: cs.borderTopWidth, paddingTop: cs.paddingTop,
               renderedTop: mm(r.top - fb.top), renderedBot: mm(r.bottom - fb.top),
               h: mm(r.height) };
    };
    const chrome = face.querySelector('.as-head, .as-chrome, .as-notes-outer');
    return {
      debug: { answerTop: d.answerTop, answerBottom: d.answerBottom,
               frameTopLimit: d.frameTopLimit, frameBottomLimit: d.frameBottomLimit },
      firstFaceCursorFromDbg: d.faces[0] && d.faces[0].cursor,
      boxes: ['.as-choice-outer', '.as-subject-outer', '.as-noanswer', '.as-choice-inner',
              '.as-choice-header', '.as-subject-page-tip'].map(pick).filter(Boolean),
      headBottom: (() => {
        const hs = Array.from(face.children).map(c => ({ cls: c.className,
          t: mm(c.getBoundingClientRect().top - fb.top),
          b: mm(c.getBoundingClientRect().bottom - fb.top) }));
        return hs;
      })()
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
