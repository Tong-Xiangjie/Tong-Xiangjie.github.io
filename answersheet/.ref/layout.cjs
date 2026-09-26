/* 用**布局值**（offsetHeight / offsetTop，不受 stage transform 影响）量真实几何。
   1mm = 96/25.4 = 3.779528 CSS px。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PX = 96 / 25.4;
const PORT = 9569;
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

  const run = async (nc, ns) => {
    const E = `(() => {
      const PX = 96/25.4;
      const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','${nc}'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','${ns}');
      set('subjScore', Array.from({length:${ns}},()=>'10').join(','));
      set('subjLines','6');
      document.getElementById('btnGenerate').click();
      const mm = v => Math.round(v / PX * 1000) / 1000;
      /* 用 offsetTop 逐级累加到面（offsetParent 链），完全不受 transform 影响 */
      const offTop = (el, root) => { let y = 0, e = el;
        while (e && e !== root) { y += e.offsetTop; e = e.offsetParent; }
        return y; };
      const out = [];
      document.querySelectorAll('.preview-stage .as-page').forEach(function (pg, pi) {
        pg.querySelectorAll('.as-face').forEach(function (face, fi) {
          const rows = [];
          const push = (label, el) => { if (!el) return;
            rows.push(label + '  top=' + mm(offTop(el, face)) + '  h=' + mm(el.offsetHeight)); };
          push('corners-top', face.querySelector('.as-mark-corner'));
          push('choice-red', face.querySelector('.as-choice-outer'));
          push('choice-black', face.querySelector('.as-choice-inner'));
          push('subj-red', face.querySelector('.as-subject-outer'));
          push('subj-black', face.querySelector('.as-subject-inner-table'));
          push('noanswer', face.querySelector('.as-noanswer'));
          push('footer', face.querySelector('.as-footer'));
          out.push({ page: pi + 1, face: fi + 1, rows: rows });
        });
      });
      return out;
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description?.slice(0, 300) };
    return r.result.result.value;
  };

  console.log('目标：红框 16.076..280.924（首页顶 84.949）  黑框必须 ≤ 红框底\n');
  for (const [nc, ns] of [[12, 2], [0, 2], [40, 2], [0, 3], [12, 1], [0, 1], [20, 4]]) {
    const d = await run(nc, ns);
    if (d.err) { console.log('选择' + nc + '+非选' + ns + ' ERR ' + d.err); continue; }
    console.log('=== 选择 ' + nc + ' + 非选 ' + ns + ' 题 ===');
    d.forEach(f => {
      console.log('  第' + f.page + '张 第' + f.face + '面');
      f.rows.forEach(x => console.log('    ' + x));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
