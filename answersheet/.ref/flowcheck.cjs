/* 直接看续页红框内部各元素的真实盒：section / outer / header / inner 的
   offsetTop 与 offsetHeight，判断「黑框为何会跑到红框顶之上」。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9481;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '300';
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
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','21'); set('subjCount','1'); set('subjScore','10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const out = [];
    document.querySelectorAll('.preview-stage .as-page').forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const sec = face.querySelector('.as-choice-section');
        if (!sec) return;
        const outer = sec.querySelector('.as-choice-outer');
        const inner = sec.querySelector('.as-choice-inner');
        const head = sec.querySelector('.as-choice-header');
        const body = face.querySelector('.as-face-body');
        out.push({
          page: pi + 1,
          section: { offTop: sec.offsetTop, h: sec.offsetHeight,
                     topStyle: sec.style.top, pos: getComputedStyle(sec).position },
          bodyOffTop: body ? body.offsetTop : null,
          outer: { offTop: outer.offsetTop, h: outer.offsetHeight,
                   marginTop: getComputedStyle(outer).marginTop,
                   padTop: getComputedStyle(outer).paddingTop,
                   border: getComputedStyle(outer).borderTopWidth },
          head: head ? { cls: head.className, offTop: head.offsetTop,
                         h: head.offsetHeight, marginBottom: getComputedStyle(head).marginBottom,
                         pos: getComputedStyle(head).position,
                         display: getComputedStyle(head).display } : null,
          inner: { cls: inner.className, offTop: inner.offsetTop, h: inner.offsetHeight,
                   marginTop: getComputedStyle(inner).marginTop,
                   marginLeft: getComputedStyle(inner).marginLeft,
                   pos: getComputedStyle(inner).position },
          /* 父链：inner.offsetParent 是谁 */
          innerOffsetParent: inner.offsetParent ? (inner.offsetParent.className || inner.offsetParent.tagName) : null,
          outerOffsetParent: outer.offsetParent ? (outer.offsetParent.className || outer.offsetParent.tagName) : null,
          headOffsetParent: head && head.offsetParent ? (head.offsetParent.className || head.offsetParent.tagName) : null
        });
      });
    });
    return out;
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    res.result.result.value.forEach(function (x) {
      console.log('── 第%d张 面 ────────────────────', x.page);
      console.log('  section  offTop=%s h=%s top=%s pos=%s  (body offTop=%s)',
        x.section.offTop, x.section.h, x.section.topStyle, x.section.pos, x.bodyOffTop);
      console.log('  outer    offTop=%s h=%s mt=%s padTop=%s border=%s  parent=%s',
        x.outer.offTop, x.outer.h, x.outer.marginTop, x.outer.padTop, x.outer.border, x.outerOffsetParent);
      if (x.head) {
        console.log('  header   offTop=%s h=%s mb=%s pos=%s display=%s  parent=%s',
          x.head.offTop, x.head.h, x.head.marginBottom, x.head.pos, x.head.display, x.headOffsetParent);
        console.log('           cls=%s', x.head.cls);
      } else console.log('  header   ** 没有 **');
      console.log('  inner    offTop=%s h=%s mt=%s ml=%s pos=%s  parent=%s',
        x.inner.offTop, x.inner.h, x.inner.marginTop, x.inner.marginLeft, x.inner.pos, x.innerOffsetParent);
      console.log('');
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
