const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9593;
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
  const E1 = `(() => {
    window.__B = [];
    const Ch = window.AS.choice; const orig = Ch.build;
    Ch.build = function (o) { const out = orig.apply(this, arguments);
      window.__B.push({ at: Date.now() % 100000, startNo: o.startNo, endNo: o.endNo,
        rows: o.rows, fromLine: o.fromLine, htmlLen: out.html.length,
        classes: (out.html.match(/class="as-choice-[a-z-]+"/g) || []).slice(0, 12) });
      return out; };
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','300'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`;
  await send('Runtime.evaluate', { expression: E1, returnByValue: true });
  await sleep(2000);
  const E2 = `(() => {
    /* 用 hook 抓到的**同一组**参数手工调一次 builder */
    const Ch = window.AS.choice, C = window.AS.config, G = window.AS.geometry;
    const o2 = window.__B.find(b => b.endNo === 300);
    const manual = o2 ? Ch.build({ startNo: o2.startNo, endNo: o2.endNo, rows: o2.rows,
      fromLine: o2.fromLine, group: { size: 5, perLine: 4, gap: C.GROUPS.A4.gap },
      preset: C.PRESETS.A4, faceW: 210, first: false,
      gridTop: 6.1, gridH: 164.657, colCenters: null }) : null;
    return { builds: window.__B,
      manualLen: manual ? manual.html.length : null,
      manualClasses: manual ? (manual.html.match(/class="as-choice-[a-z-]+"/g) || []).slice(0,12) : null,
      maxBlocksPerLine: G.maxBlocksPerLine(C.PRESETS.A4, 210, C.GROUPS.A4),
      blockPlanLen: G.blockPlan(161, 300, C.GROUPS.A4).length,
      blockPlanLenTo280: G.blockPlan(161, 280, C.GROUPS.A4).length };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E2, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1500));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
