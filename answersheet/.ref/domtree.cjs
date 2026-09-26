/* 直接 dump 预览区的 DOM 骨架，看纸/面/块的层级。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9519;
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
    const set=(i,v)=>{const e=document.getElementById(i);if(e)e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','300'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const dump = (el, d, out, max) => {
      if (d > max) return;
      const cls = typeof el.className === 'string' ? el.className : '';
      out.push('  '.repeat(d) + el.tagName.toLowerCase() +
        (cls ? '.' + cls.split(/\\s+/).slice(0, 3).join('.') : '') +
        (el.id ? '#' + el.id : ''));
      Array.from(el.children).forEach(c => dump(c, d + 1, out, max));
    };
    const out = [];
    const stage = document.getElementById('stage');
    dump(stage, 0, out, 3);
    return {
      tree: out,
      counts: {
        pageWrap: document.querySelectorAll('.page-wrap').length,
        asPage: document.querySelectorAll('.as-page').length,
        asFace: document.querySelectorAll('.as-face').length,
        previewStageFace: document.querySelectorAll('.preview-stage .as-face').length,
        noanswer: document.querySelectorAll('.as-noanswer').length,
        choiceOuter: document.querySelectorAll('.as-choice-outer').length,
        subjOuter: document.querySelectorAll('.as-subject-outer').length,
        secTip: document.querySelectorAll('.as-section-tip').length,
        pageTip: document.querySelectorAll('.as-subject-page-tip').length
      }
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else {
    const d = r.result.result.value;
    console.log('计数:', JSON.stringify(d.counts, null, 1));
    console.log('\nDOM 骨架:');
    d.tree.slice(0, 60).forEach(l => console.log(l));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
