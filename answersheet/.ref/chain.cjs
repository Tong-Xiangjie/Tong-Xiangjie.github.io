const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9559;
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
    const S = window.AS.subject, Pg = window.AS.paginator, C = window.AS.config;
    const p = C.PRESETS.A4;
    /* 1. 模型：单题 itemHeight（应 = 6.7 + 7.7n） */
    const model = [1, 2, 4, 6, 8, 12].map(n => ({ n: n, ih: S.itemHeight(n, 7.7008) }));
    /* 2. 真实卡片里同一题的黑框高 */
    const st = document.querySelector('.preview-stage');
    st.style.transform = 'none';
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const page = document.querySelector('.preview-stage .as-page');
    const fb = page.getBoundingClientRect();
    const S2 = fb.width / 210;
    const mm = v => Math.round((v / S2) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fbb = face.getBoundingClientRect();
    const tab = face.querySelector('.as-subject-inner-table');
    const outer = face.querySelector('.as-subject-outer');
    const bodies = Array.from(face.querySelectorAll('.as-subj-body'))
      .map(e => mm(e.getBoundingClientRect().height));
    const held = Array.from(face.querySelectorAll('.as-subj-head'))
      .map(e => mm(e.getBoundingClientRect().height));
    return {
      model: model,
      ROW_OVERHEAD: S.ROW_OVERHEAD,
      chain: {
        outerInline: outer.style.height,
        outerTop: mm(outer.getBoundingClientRect().top - fbb.top),
        outerBot: mm(outer.getBoundingClientRect().bottom - fbb.top),
        tableTop: mm(tab.getBoundingClientRect().top - fbb.top),
        tableBot: mm(tab.getBoundingClientRect().bottom - fbb.top),
        tableH: mm(tab.getBoundingClientRect().height),
        bodies: bodies, heads: held
      },
      dbg: Pg.lastDebug.faces[0]
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
