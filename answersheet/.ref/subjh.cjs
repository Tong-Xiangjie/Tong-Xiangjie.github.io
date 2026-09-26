/* 实测非选择题「一题 n 行」真实渲染高（单值 subjLines）。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9535;
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

  const run = async (lines, n) => {
    const E = `(() => {
      const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
      set('cardTitle','语文'); set('cardSubject','数学');
      set('choiceTotal','0'); set('choiceStart','1');
      set('subjStart','1'); set('subjCount','${n}');
      set('subjScore', Array.from({length:${n}},()=>'10').join(','));
      set('subjLines','${lines}');
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const Sub = window.AS.subject;
      const fe = document.querySelector('.preview-stage .as-face');
      const fb = fe.getBoundingClientRect();
      const S = fb.width / 210;
      const mm = v => Math.round((v / S) * 1000) / 1000;
      const trs = Array.from(fe.querySelectorAll('.as-subject-inner-table tr'));
      const outer = fe.querySelector('.as-subject-outer');
      return {
        readLines: document.getElementById('subjLines').value,
        predict: Sub.itemHeight(${lines}, 7.7008),
        rows: trs.map(tr => mm(tr.getBoundingClientRect().height)),
        outerTop: outer ? mm(outer.getBoundingClientRect().top - fb.top) : null,
        outerBot: outer ? mm(outer.getBoundingClientRect().bottom - fb.top) : null,
        outerH: outer ? mm(outer.getBoundingClientRect().height) : null,
        inlineH: outer ? outer.style.height : null,
        tableH: (() => { const tb = fe.querySelector('.as-subject-inner-table');
          return tb ? mm(tb.getBoundingClientRect().height) : null; })()
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 600)); return null; }
    return r.result.result.value;
  };

  for (const L of [4, 6, 8, 10, 12, 16]) {
    const d = await run(L, 3);
    if (!d) continue;
    console.log('n=' + String(L).padStart(2) + ' 行(读回 ' + d.readLines + ')  预测一题 ' +
      String(d.predict).padStart(7) + '   各行 [' + d.rows.map(x => x.toFixed(3)).join(', ') +
      ']   表高 ' + String(d.tableH).padStart(7) + '   框 ' + d.outerTop + '..' + d.outerBot +
      '  h=' + d.outerH + '  inline=' + d.inlineH);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
