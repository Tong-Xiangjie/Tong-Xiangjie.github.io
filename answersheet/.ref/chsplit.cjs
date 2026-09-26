const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PORT = 9597;
async function run(n, subjN) {
  const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
  PORT += 2;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--disable-extensions', '--disable-application-cache',
    '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
  await sleep(4200);
  const E = `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${n}'); set('choiceStart','1');
    set('subjStart','1'); set('subjCount','${subjN}');
    set('subjScore','10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const faces = Array.from(document.querySelectorAll('.preview-stage .as-face'));
    const nums = Array.from(document.querySelectorAll('.preview-stage .as-choice-num'))
      .map(e => parseInt(e.textContent, 10));
    const gaps = [];
    for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i-1] + 1) gaps.push(nums[i-1] + '->' + nums[i]);
    return { choiceTotal: ${n},
      faces: faces.length,
      facesWithChoice: faces.filter(f => f.querySelector('.as-choice-section')).length,
      numCount: nums.length,
      first: nums[0], last: nums[nums.length-1],
      contiguous: gaps.length === 0, gaps: gaps.slice(0, 5),
      emptyGrids: faces.map((f,i) => { const g = f.querySelector('.as-choice-grid');
        return g && g.children.length === 0 ? i : null; }).filter(v => v !== null),
      faceSummary: faces.map((f,i) => ({ i: i,
        choiceLines: f.querySelectorAll('.as-choice-line').length,
        subjRows: f.querySelectorAll('.as-subject-inner-table tr').length,
        na: !!f.querySelector('.as-noanswer') }))
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  ws.close(); chrome.kill();
  if (r.result?.exceptionDetails) return { err: (r.result.exceptionDetails.exception?.description || '').slice(0, 300) };
  return r.result.result.value;
}
(async () => {
  for (const [n, s] of [[300, 2], [200, 0], [120, 0], [100, 0], [40, 0]]) {
    console.log(JSON.stringify(await run(n, s)));
    await sleep(300);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
