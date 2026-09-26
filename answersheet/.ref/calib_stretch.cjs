/* 标定收口用的两个常数：frameTail（游标 → 红框底）与 STRETCH_K
   （答题区加高 → 红框底下移）。
   做法：直接覆写分页器算出的 face.stretch，扫一组值，量每次红框底 y。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9509;
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

  const measure = async (S) => {
    const E = `(() => {
      const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','12'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','2');
      set('subjScore','10,10'); set('subjLines','8,8');
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      /* 直接改 DOM：找到最后一行 .as-subj-body，加高 S 毫米 */
      const faceEl = document.querySelector('.preview-stage .as-page .as-face');
      const bodies = faceEl.querySelectorAll('.as-subj-body');
      const last = bodies[bodies.length - 1];
      const oldH = parseFloat(getComputedStyle(last).height);
      last.style.height = (oldH + ${S} * 3.7795275591) + 'px';
      const fb = faceEl.getBoundingClientRect();
      const S2 = fb.width / 210;
      const mm = v => Math.round((v / S2) * 1000) / 1000;
      const outer = faceEl.querySelector('.as-subject-outer');
      const table = faceEl.querySelector('.as-subject-inner-table');
      const q = outer.getBoundingClientRect();
      return {
        S: ${S},
        bodyOldH: mm(oldH * 1),   /* px → mm 用同一比例 */
        frameTop: mm(q.top - fb.top), frameBot: mm(q.bottom - fb.top),
        tableBot: mm(table.getBoundingClientRect().bottom - fb.top),
        cursor: window.AS.paginator.lastDebug.faces[0].cursor,
        rest: window.AS.paginator.lastDebug.faces[0].rest
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 700)); return null; }
    return r.result.result.value;
  };

  const out = [];
  for (const S of [0, 1, 2, 3, 4, 6]) { const d = await measure(S); if (d) out.push(d); }
  console.log('S(加高mm) | 红框底 y | Δy | Δy/S | 黑框底 y');
  let base = null;
  out.forEach(d => {
    if (base === null) base = d;
    const dy = Math.round((d.frameBot - base.frameBot) * 1000) / 1000;
    console.log(String(d.S).padStart(8) + '  | ' + String(d.frameBot).padStart(8) +
      ' | ' + String(dy).padStart(6) + ' | ' + (d.S ? (dy / d.S).toFixed(4) : '—') +
      ' | ' + d.tableBot);
  });
  const d0 = out[0];
  console.log('\n游标 cursor =', d0.cursor, '  rest =', d0.rest);
  console.log('frameTail(游标 → 红框底，S=0) =',
    Math.round((d0.frameBot - d0.cursor) * 1000) / 1000);
  console.log('目标下界 = 283.885');
  const k = (out[out.length - 1].frameBot - d0.frameBot) / out[out.length - 1].S;
  console.log('STRETCH_K 应为 1/' + k.toFixed(4) + ' = ' + (1 / k).toFixed(4));
  const need = 283.885 - d0.frameBot;
  console.log('需要的 Δy =', Math.round(need * 1000) / 1000,
    ' → S =', Math.round((need / k) * 1000) / 1000);
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
