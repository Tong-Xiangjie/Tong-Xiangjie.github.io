/* 量页眉底缘、页脚高、以及面容器顶。定「答题区」纵向基准要用。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9497;
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
    set('cardTitle','2025年普通高等学校招生全国统一考试模拟演练');
    set('cardSubject','数学');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const out = [];
    pages.forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const R = e => { const q = e.getBoundingClientRect();
          return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top), h: mm(q.height) }; };
        const head = face.querySelector('.as-head');
        const title = face.querySelector('.as-title');
        const foot = face.querySelector('.as-footer');
        const body = face.querySelector('.as-face-body');
        out.push({
          page: pi + 1, face: fi + 1,
          head: head ? R(head) : null,
          title: title ? R(title) : null,
          footer: foot ? R(foot) : null,
          body: body ? R(body) : null,
          bodyTop: body ? getComputedStyle(body).top : null,
          faceOverflow: getComputedStyle(face).overflow
        });
      });
    });
    const P = window.AS.page;
    return { out: out, CHROME: {
      firstBottom: P.CHROME.firstBottom, otherBottom: P.CHROME.otherBottom,
      rowTitle: P.CHROME.rowTitle, rowInfo: P.CHROME.rowInfo,
      rowNote: P.CHROME.rowNote, rowGap: P.CHROME.rowGap,
      titlePadTop: P.CHROME.titlePadTop, noteTop: P.CHROME.noteTop
    } };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1400));
  } else {
    const d = res.result.result.value;
    console.log('CHROME = %s', JSON.stringify(d.CHROME, null, 1));
    d.out.forEach(function (f) {
      console.log('\n第%d张 第%d面  (overflow=%s)', f.page, f.face, f.faceOverflow);
      if (f.head) console.log('   页眉   %s → %s   h=%s', f.head.t, f.head.b, f.head.h);
      if (f.title) console.log('   提示行 %s → %s   h=%s  top=%s', f.title.t, f.title.b, f.title.h, f.bodyTop);
      if (f.body) console.log('   正文层 %s → %s', f.body.t, f.body.b);
      if (f.footer) console.log('   页脚   %s → %s   h=%s', f.footer.t, f.footer.b, f.footer.h);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
