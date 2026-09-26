/* 查非选择题红框内部的实际盒模型：为什么黑框比 paginator 算的低 2.25mm。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9503;
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
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL }); await sleep(5000);
  const E = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','40'); set('choiceStart','1');
    set('subjStart','41'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const face = document.querySelector('.preview-stage .as-page .as-face');
    const fb = face.getBoundingClientRect();
    const S = fb.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const walk = (el, depth, out) => {
      const cs = getComputedStyle(el);
      const q = el.getBoundingClientRect();
      out.push({
        d: depth, cls: el.className || el.tagName,
        t: mm(q.top - fb.top), b: mm(q.bottom - fb.top), h: mm(q.height),
        mt: cs.marginTop, mb: cs.marginBottom,
        pt: cs.paddingTop, pb: cs.paddingBottom, bt: cs.borderTopWidth, bb: cs.borderBottomWidth,
        pos: cs.position
      });
      Array.from(el.children).forEach(c => walk(c, depth + 1, out));
    };
    const subj = face.querySelector('.as-subjective');
    const out = [];
    if (subj) walk(subj, 0, out);
    const vars = {};
    ['--subj-pad-y','--subj-pad-y-bottom','--subj-tip-gap','--subj-tip-h',
     '--subj-header-h','--subj-header-mb','--outer-pad-y','--outer-pad-y-bottom',
     '--subj-box-gap','--box-border'].forEach(v => {
      vars[v] = getComputedStyle(face).getPropertyValue(v).trim();
    });
    return { out: out.slice(0, 14), vars };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const d = r.result.result.value;
    console.log('CSS 变量:', JSON.stringify(d.vars, null, 1));
    console.log('');
    d.out.forEach(o => {
      console.log('  '.repeat(o.d) + String(o.cls).slice(0, 26).padEnd(27) +
        ' y ' + String(o.t).padStart(8) + ' -> ' + String(o.b).padStart(8) +
        '  h=' + String(o.h).padStart(7) +
        '  mt=' + String(o.mt).padEnd(8) + ' mb=' + String(o.mb).padEnd(8) +
        ' pt=' + String(o.pt).padEnd(10) + ' pb=' + String(o.pb).padEnd(10) +
        ' bt=' + String(o.bt).padEnd(8) + ' bb=' + o.bb);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
