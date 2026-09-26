/* 量「题号」与「（分值）」之间的真实视觉间隙（含全角括号自带的左空白）。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9465;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
        .find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const heads = Array.from(face.querySelectorAll('.as-subj-head')).slice(0, 3).map(function (h) {
      const no = h.querySelector('.as-subj-no');
      const sc = h.querySelector('.as-subj-score');
      const nb = no.getBoundingClientRect(), sb = sc.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return { no: no.textContent, score: sc ? sc.textContent : null,
               noR: mm(nb.right - fb.left), scL: mm(sb.left - fb.left),
               boxGap: mm(sb.left - nb.right),
               gap: cs.gap, fsNo: getComputedStyle(no).fontSize,
               fsSc: sc ? getComputedStyle(sc).fontSize : null };
    });
    /* 用 canvas 量「（」字形本身的左空白，算出真实视觉间隙 */
    const c = document.createElement('canvas').getContext('2d');
    const fsNo = heads[0] ? heads[0].fsNo : '12.5pt';
    c.font = fsNo + ' "SimSun", serif';
    const mOpen = c.measureText('（');
    const inkL = mOpen.actualBoundingBoxLeft === undefined ? 0 : mOpen.actualBoundingBoxLeft;
    const mClose = c.measureText('）');
    return { heads: heads, openAdvance: mm(mOpen.width), inkL: mm(inkL) };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('全角「（」字形盒宽 = %s mm   左空白 = %s mm', d.openAdvance, d.inkL);
    d.heads.forEach(function (h, i) {
      console.log('\n题头%d  %s%s', i + 1, h.no, h.score || '');
      console.log('   题号右缘 %s   分值左缘 %s   盒间隙 = %s mm   CSS gap = %s',
        h.noR, h.scL, h.boxGap, h.gap);
      console.log('   视觉间隙 ≈ %s mm（盒间隙 + 全角括号左空白）',
        Math.round((h.boxGap + d.inkL) * 1000) / 1000);
      console.log('   字号 题号=%s 分值=%s', h.fsNo, h.fsSc);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
