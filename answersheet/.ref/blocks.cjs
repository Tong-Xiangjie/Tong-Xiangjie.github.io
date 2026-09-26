/* 逐元素列出第 1 面所有绝对定位块，与 paginator 的 lastDebug 对照。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9507;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '12';
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
  const E = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const face = document.querySelector('.preview-stage .as-page .as-face');
    const fb = face.getBoundingClientRect();
    const S = fb.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const R = e => { const q = e.getBoundingClientRect();
      return mm(q.top - fb.top) + ' -> ' + mm(q.bottom - fb.top) + '  (h=' + mm(q.height) + ')'; };
    const blocks = Array.from(face.querySelectorAll(
      '.as-choice-section, .as-subjective, .as-noanswer')).map(function (e) {
      const cs = getComputedStyle(e);
      return {
        cls: e.className, top: cs.top, inlineTop: e.style.top, box: R(e)
      };
    });
    const subj = face.querySelector('.as-subjective');
    const inner = [];
    if (subj) {
      Array.from(subj.querySelectorAll('*')).slice(0, 30).forEach(function (e) {
        if (!e.className && e.tagName !== 'TABLE' && e.tagName !== 'TR') return;
        inner.push({ tag: e.tagName, cls: String(e.className).slice(0, 24), box: R(e) });
      });
    }
    return { blocks, inner, dbg: window.AS.paginator.lastDebug };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const d = r.result.result.value;
    console.log('══ paginator lastDebug ══');
    d.dbg.faces.forEach((f, i) => {
      console.log(' 面%d cursor=%s frameBot=%s noAnswer=%s h=%s', i + 1, f.cursor, f.frameBot, f.noAnswer, f.noAnswerH);
      f.body.forEach(b => console.log('    ', JSON.stringify(b)));
    });
    console.log('\n══ DOM 块（绝对定位）══');
    d.blocks.forEach(b => console.log('  %s  top=%s   %s', b.cls.padEnd(24), String(b.top).padEnd(10), b.box));
    console.log('\n══ 非选择题内部 ══');
    d.inner.forEach(x => console.log('  %-6s %-24s %s', x.tag, x.cls, x.box));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
