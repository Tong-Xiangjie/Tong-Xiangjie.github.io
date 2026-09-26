/* 按用户结构图逐元素量：
     【上角标】
     ┌────────────────────────────┐  ← 红框上缘（= 上角标下边缘）
     │ 提示语句①                   │
     │ ┏────────────────────────┐ │  ← 黑框
     │ ┃ 答题内容               ┃ │
     │ ┗────────────────────────┘ │
     │ 提示语句②                   │
     └────────────────────────────┘  ← 红框下缘（= 下角标上边缘）
     【下角标】      页脚
   量 A4 / A3 各栏，A4 单面 + A3 三面都要看。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9493;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '40';
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
    set('subjStart','41'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    const b = document.querySelector('button[data-val=${JSON.stringify(FMT)}]');
    if (b) b.click();
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const paperW = ${JSON.stringify(FMT)} === 'A3' ? 420 : 210;
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / paperW;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const out = [];
    pages.forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const R = e => { const q = e.getBoundingClientRect();
          return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top),
                   l: mm(q.left - fb.left), r: mm(q.right - fb.left) }; };
        const corners = Array.from(face.querySelectorAll('.as-mark-corner, .as-corner'))
          .map(R).sort((a, b) => a.t - b.t);
        const secs = Array.from(face.querySelectorAll('.as-choice-section, .as-subjective'))
          .map(function (e) {
            const outer = e.querySelector('.as-choice-outer, .as-subj-outer');
            const inner = e.querySelector('.as-choice-inner, .as-subj-inner');
            const tips = Array.from(e.querySelectorAll('.as-subject-page-tip, .as-choice-header'));
            return {
              kind: e.className.indexOf('choice') >= 0 ? 'choice' : 'subj',
              outer: outer ? R(outer) : null,
              inner: inner ? R(inner) : null,
              tips: tips.map(t => ({ cls: t.className, ...R(t) }))
            };
          });
        const foot = face.querySelector('.as-footer');
        out.push({
          page: pi + 1, face: fi + 1,
          corners: corners.map(c => ({ t: c.t, b: c.b })),
          secs: secs,
          footer: foot ? R(foot) : null
        });
      });
    });
    return { fmt: ${JSON.stringify(FMT)}, out: out };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1400));
  } else {
    const d = res.result.result.value;
    console.log('════ %s · %s 题 ════', d.fmt, NC);
    d.out.forEach(function (f) {
      const up = f.corners.length ? f.corners[0] : null;
      const dn = f.corners.length ? f.corners[f.corners.length - 1] : null;
      console.log('\n── 第%d张 第%d面 ─────────────────', f.page, f.face);
      if (up) console.log('   上角标  下边缘 = %s', up.b);
      if (dn) console.log('   下角标  上边缘 = %s', dn.t);
      if (f.footer) console.log('   页脚             %s → %s', f.footer.t, f.footer.b);
      f.secs.forEach(function (s) {
        console.log('   [%s]', s.kind);
        if (s.outer) console.log('       红框  %s → %s   (x %s → %s)',
          s.outer.t, s.outer.b, s.outer.l, s.outer.r);
        if (s.inner) console.log('       黑框  %s → %s', s.inner.t, s.inner.b);
        s.tips.forEach(function (t) {
          console.log('       提示  %s → %s   %s', t.t, t.b, t.cls);
        });
        if (up && s.outer) {
          console.log('       ↳ 红框上缘 − 上角标下边缘 = %s',
            Math.round((s.outer.t - up.b) * 1000) / 1000);
        }
        if (dn && s.outer) {
          console.log('       ↳ 下角标上边缘 − 红框下缘 = %s',
            Math.round((dn.t - s.outer.b) * 1000) / 1000);
        }
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
