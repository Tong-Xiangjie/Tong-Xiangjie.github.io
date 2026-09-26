/* A4 考生信息行（姓名 / 班级 / 准考证号）实测各元素的横向位置与间距。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9463;
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
    const row = face.querySelector('.as-info-row');
    const rc = getComputedStyle(row);
    const kids = Array.from(row.children).map(function (e) {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { cls: e.className, txt: e.textContent.trim(),
               l: mm(b.left - fb.left), r: mm(b.right - fb.left),
               w: mm(b.width), cy: mm((b.top+b.bottom)/2 - fb.top),
               h: mm(b.height), mb: cs.marginBottom, ml: cs.marginRight,
               bl: cs.borderBottomWidth, type: e.tagName };
    });
    const zk = face.querySelector('.as-zk');
    const zr = zk ? zk.getBoundingClientRect() : null;
    return { rowGap: rc.gap, columnGap: rc.columnGap, display: rc.display,
             rowL: mm(row.getBoundingClientRect().left - fb.left),
             rowR: mm(row.getBoundingClientRect().right - fb.left),
             kids: kids,
             zkL: zr ? mm(zr.left - fb.left) : null,
             zkR: zr ? mm(zr.right - fb.left) : null,
             zkW: zr ? mm(zr.width) : null };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('信息行 gap=%s (columnGap=%s)  display=%s   行范围 %s → %s',
      d.rowGap, d.columnGap, d.display, d.rowL, d.rowR);
    console.log('\n序号  class                      文本       左缘     右缘     宽    marginBottom  marginRight  下边框');
    d.kids.forEach(function (k, i) {
      console.log('%s  %s  %s  %s  %s  %s  %s  %s  %s',
        String(i + 1).padStart(3), k.cls.padEnd(24), (k.txt || '-').padEnd(8),
        k.l, k.r, k.w, k.mb, k.ml, k.bl);
    });
    console.log('\n准考证号书写栏 .as-zk  %s → %s  (宽 %s)', d.zkL, d.zkR, d.zkW);
    console.log('\n--- 相邻元素的水平净空 ---');
    for (let i = 1; i < d.kids.length; i++) {
      const gap = Math.round((d.kids[i].l - d.kids[i - 1].r) * 1000) / 1000;
      console.log('  %s  →  %s   = %s mm', (d.kids[i - 1].cls || d.kids[i - 1].txt).slice(0, 22),
        (d.kids[i].cls || d.kids[i].txt).slice(0, 22), gap);
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
