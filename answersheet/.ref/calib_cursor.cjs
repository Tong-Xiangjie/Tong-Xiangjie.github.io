/* 分页器游标 vs 真实红框底：多配置扫描，看偏差是否随「本面题数」累积。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9511;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
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
  await send('Page.navigate', { url: URL }); await sleep(5000);

  const run = async (nc, ns, nl) => {
    const E = `(() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','${nc}'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','${ns}');
      set('subjScore', Array.from({length:${ns}},()=>'10').join(','));
      set('subjLines', Array.from({length:${ns}},()=>'${nl}').join(','));
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const out = [];
      const dbg = window.AS.paginator.lastDebug;
      const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
      let fi = 0;
      pages.forEach(function (pg) {
        pg.querySelectorAll('.as-face').forEach(function (faceEl) {
          const fb = faceEl.getBoundingClientRect();
          const S = fb.width / 210;
          const mm = v => Math.round((v / S) * 1000) / 1000;
          const red = faceEl.querySelector('.as-subject-outer');
          const table = faceEl.querySelector('.as-subject-inner-table');
          const bodies = faceEl.querySelectorAll('.as-subj-body');
          const d = dbg.faces[fi];
          out.push({
            face: fi + 1,
            hasSubj: !!red,
            cursor: d ? d.cursor : null,
            subjRows: d ? d.body.filter(b => b.kind === 'subj').length : 0,
            subjLines: d ? d.body.filter(b => b.kind === 'subj')
              .reduce((a, b) => a + b.lines, 0) : 0,
            frameBot: red ? mm(red.getBoundingClientRect().bottom - fb.top) : null,
            tableBot: table ? mm(table.getBoundingClientRect().bottom - fb.top) : null,
            lastBodyBot: bodies.length
              ? mm(bodies[bodies.length - 1].getBoundingClientRect().bottom - fb.top) : null
          });
          fi++;
        });
      });
      return { nc: ${nc}, ns: ${ns}, nl: ${nl}, out };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 400)); return null; }
    return r.result.result.value;
  };

  console.log('选择 | 题数 | 行 | 面 | 本面非选行数 | 游标 | 末行body底 | 游标−body底 | 红框底 | 游标→红框底');
  for (const [nc, ns, nl] of [[0, 1, 8], [0, 2, 8], [0, 3, 8], [0, 4, 8],
                              [0, 2, 4], [0, 2, 12], [0, 3, 6],
                              [12, 2, 8], [12, 1, 8], [40, 2, 8], [40, 3, 8],
                              [40, 4, 8], [0, 5, 8]]) {
    const d = await run(nc, ns, nl);
    if (!d) continue;
    d.out.forEach(f => {
      if (!f.hasSubj) return;
      const diff = f.cursor !== null && f.lastBodyBot !== null
        ? Math.round((f.cursor - f.lastBodyBot) * 1000) / 1000 : null;
      const tail = f.cursor !== null && f.frameBot !== null
        ? Math.round((f.frameBot - f.cursor) * 1000) / 1000 : null;
      console.log(String(nc).padStart(4) + ' | ' + String(ns).padStart(4) + ' | ' +
        String(nl).padStart(2) + ' | ' + String(f.face).padStart(2) + ' | ' +
        String(f.subjLines).padStart(12) + ' | ' + String(f.cursor).padStart(8) + ' | ' +
        String(f.lastBodyBot).padStart(10) + ' | ' + String(diff).padStart(11) + ' | ' +
        String(f.frameBot).padStart(7) + ' | ' + String(tail).padStart(10));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
