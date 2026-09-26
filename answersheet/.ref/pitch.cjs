const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9555;
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

  const run = async (sc, sl) => {
    const E = `(() => {
      const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','0'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','${sc}');
      set('subjScore', Array.from({length:${sc}},()=>'10').join(','));
      set('subjLines','${sl}');
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const page = document.querySelector('.preview-stage .as-page');
      const pr = page.getBoundingClientRect();
      const S = pr.width / 210;
      const mm = v => Math.round((v / S) * 1000) / 1000;
      const face = page.querySelector('.as-face');
      const fb = face.getBoundingClientRect();
      const tab = face.querySelector('.as-subject-inner-table');
      const outer = face.querySelector('.as-subject-outer');
      const bodies = Array.from(face.querySelectorAll('.as-subj-body'))
        .map(e => mm(e.getBoundingClientRect().height));
      const tds = Array.from(face.querySelectorAll('.as-subject-inner-table td'))
        .map(e => mm(e.getBoundingClientRect().height));
      const heads = Array.from(face.querySelectorAll('.as-subj-head'))
        .map(e => mm(e.getBoundingClientRect().height));
      return { S: S,
        tableH: tab ? mm(tab.getBoundingClientRect().height) : null,
        outerH: outer ? mm(outer.getBoundingClientRect().height) : null,
        outerInline: outer ? outer.style.height : null,
        bodies: bodies, tds: tds, heads: heads,
        headCS: (function(){ const e=face.querySelector('.as-subj-head');
          const c=getComputedStyle(e); return {h:c.height, mb:c.marginBottom, fs:c.fontSize, lh:c.lineHeight}; })(),
        tdPad: (function(){ const e=face.querySelector('.as-subject-inner-table td');
          const c=getComputedStyle(e); return {pt:c.paddingTop, pb:c.paddingBottom, bt:c.borderTopWidth}; })(),
        lineVar: getComputedStyle(document.querySelector('.preview-stage')).getPropertyValue('--answer-line-h')
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description?.slice(0, 400) };
    return r.result.result.value;
  };

  for (const [sc, sl] of [[1, 1], [1, 2], [1, 4], [2, 6], [1, 8], [1, 12], [1, 16]]) {
    const d = await run(sc, sl);
    if (d.err) { console.log(sc + '题/' + sl + '行 ERR', d.err); continue; }
    console.log('subj=' + sc + ' lines=' + sl +
      '  tableH=' + d.tableH + '  outerH=' + d.outerH + '  inline=' + d.outerInline +
      '  bodies=' + JSON.stringify(d.bodies) +
      '  tds=' + JSON.stringify(d.tds) +
      '  heads=' + JSON.stringify(d.heads));
  }
  console.log('\nheadCS=' + JSON.stringify((await run(1, 4)).headCS));
  console.log('tdPad=' + JSON.stringify((await run(1, 4)).tdPad));
  console.log('lineVar=' + (await run(1, 4)).lineVar);
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
