/* 页脚 / 角标纵向位置核对（自算 mm，不依赖预览缩放）。
   用法：node .ref\footer_pos.cjs [A4|A3] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9435;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
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
    const f0 = document.querySelector('#segFormat button[data-val="${FMT}"]');
    if (f0) f0.click();
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','语文');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','3');
    set('subjScore','10,10,10'); set('subjLines','8,8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const out = { paperH: window.AS.config.PAPER.A4.h,
                  cornerH: window.AS.config.PRESETS.A4.cornerH,
                  footers: [] };
    document.querySelectorAll('.as-page').forEach(function (page) {
      const pr = page.getBoundingClientRect();
      const S = pr.width / 210;
      const M = v => Math.round((v / S) * 1000) / 1000;
      const face = page.querySelector('.as-face');
      const fb = face.getBoundingClientRect();
      const corners = Array.from(face.querySelectorAll('.as-corner')).map(function (e) {
        const b = e.getBoundingClientRect();
        return { t: M(b.top - fb.top), b: M(b.bottom - fb.top) };
      });
      const ft = face.querySelector('.as-footer');
      const fbb = ft.getBoundingClientRect();
      out.footers.push({
        inlineStyle: ft.getAttribute('style'),
        corners: corners,
        faceH: M(fb.height),
        footerTop: M(fbb.top - fb.top),
        footerBottom: M(fbb.bottom - fb.top),
        cssBottom: getComputedStyle(ft).bottom
      });
    });
    return out;
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('PAPER.A4.h = %s   PRESETS.A4.cornerH = %s', d.paperH, d.cornerH);
    d.footers.forEach(function (F, i) {
      const bot = F.corners.length >= 4 ? F.corners[2].b : F.corners[F.corners.length - 1].b;
      const top = F.corners.length >= 4 ? F.corners[3].b : null;
      console.log('\n=== 第 %d 张纸  (面高 %s) ===', i + 1, F.faceH);
      F.corners.forEach(function (c, ci) {
        console.log('   角标#%d  %s → %s', ci, c.t, c.b);
      });
      console.log('   页脚   %s → %s   inline=%s   cssBottom=%s',
        F.footerTop, F.footerBottom, JSON.stringify(F.inlineStyle), F.cssBottom);
      console.log('   ▶ 与上方角标底差 %s   与下角标底差 %s',
        top === null ? '-' : Math.round((F.footerBottom - top) * 1000) / 1000,
        Math.round((F.footerBottom - bot) * 1000) / 1000);
      console.log('   ▶ 与**下**角标底对齐: %s',
        Math.abs(F.footerBottom - bot) < 0.15 ? 'OK' : '** 没对齐 **');
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
