/* 量清楚：四角定位块的上下边缘 y、现在各区红框的上下缘、页脚位置。
   用来核对「红框上抵上角标下边缘、下达下角标上边缘」这条新规则的影响面。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9491;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '12';
const SC = process.argv[3] || '2';
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
    set('subjStart','13'); set('subjCount','${SC}');
    set('subjScore', Array.from({length:${SC}},()=>'10').join(','));
    set('subjLines', Array.from({length:${SC}},()=>'4').join(','));
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const G = window.AS.geometry, C = window.AS.config, P = window.AS.page;
    const p = C.PRESETS.A4;
    const out = [];
    pages.forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const R = e => { const q = e.getBoundingClientRect();
          return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top),
                   l: mm(q.left - fb.left), r: mm(q.right - fb.left) }; };
        const corners = Array.from(face.querySelectorAll('.as-mark-corner, .as-corner'))
          .map(R).sort((a, b) => a.t - b.t);
        const reds = Array.from(face.querySelectorAll('.as-choice-outer, .as-subj-outer'))
          .map(function (e) {
            const r = R(e);
            return { cls: e.className, t: r.t, b: r.b, l: r.l, r: r.r };
          });
        const foot = face.querySelector('.as-footer');
        const body = face.querySelector('.as-face-body');
        out.push({
          page: pi + 1,
          corners: corners.map(c => ({ t: c.t, b: c.b })),
          reds: reds,
          footer: foot ? R(foot) : null,
          body: body ? R(body) : null
        });
      });
    });
    /* 几何给的关建量 */
    const off = G.boxOffsets(p);
    return {
      out: out,
      topBandY: 11,
      cornerH: p.cornerH,
      footerBottom: window.AS.page ? null : null,
      usable: window.AS.paginator.PAGE_H - window.AS.paginator.BOTTOM_RESERVE,
      PAGE_H: window.AS.paginator.PAGE_H,
      BOTTOM_RESERVE: window.AS.paginator.BOTTOM_RESERVE
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1400));
  } else {
    const d = res.result.result.value;
    console.log('PAGE_H=%s  BOTTOM_RESERVE=%s  可用高度=%s  cornerH=%s',
      d.PAGE_H, d.BOTTOM_RESERVE, d.usable, d.cornerH);
    console.log('顶部定标带行心 y = %s  →  上角标 上缘 %s / 下缘 %s',
      d.topBandY,
      Math.round((d.topBandY - d.cornerH / 2) * 1000) / 1000,
      Math.round((d.topBandY + d.cornerH / 2) * 1000) / 1000);
    console.log('下角标 上缘 = 297 − 11 − %s = %s   下缘 = %s',
      d.cornerH,
      Math.round((297 - 11 - d.cornerH / 2) * 1000) / 1000,
      Math.round((297 - 11 + d.cornerH / 2) * 1000) / 1000);
    console.log('');
    d.out.forEach(function (f) {
      console.log('── 第%d张 面 ────────────────', f.page);
      f.corners.forEach(function (c, i) {
        console.log('   角标%d  y %s → %s', i + 1, c.t, c.b);
      });
      f.reds.forEach(function (r) {
        console.log('   红框 %s  y %s → %s   x %s → %s',
          r.cls.replace('as-', '').replace('-outer', ''), r.t, r.b, r.l, r.r);
      });
      if (f.footer) console.log('   页脚      y %s → %s', f.footer.t, f.footer.b);
      if (f.body) console.log('   正文层    y %s → %s', f.body.t, f.body.b);
      console.log('');
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
