/* 标定「行间空档」：把 lineGapH 强制成两个值，量出真实的
   「上行末气泡底缘 → 下行题号盒顶缘」净空，解出 净空 = lineGapH + C 里的 C。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9459;
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

  const MEASURE = (forceGap) => `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','40'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','0');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const lines = Array.from(face.querySelectorAll('.as-choice-line'));
    const bub = e => { const b = e.getBoundingClientRect();
      return { t: mm(b.top - fb.top), b: mm(b.bottom - fb.top) }; };
    const a = lines[0], b = lines[1];
    const aBubs = Array.from(a.querySelectorAll('.as-bubble')).map(bub);
    const bNums = Array.from(b.querySelectorAll('.as-choice-num')).map(bub);
    const lastBubBottom = Math.max.apply(null, aBubs.map(x => x.b));
    const nextNumTop = Math.min.apply(null, bNums.map(x => x.t));
    const marks = Array.from(face.querySelectorAll('.as-mark-left'))
      .map(e => { const r = e.getBoundingClientRect();
        return mm((r.top + r.bottom)/2 - fb.top); }).sort((x,y)=>x-y);
    return { lastBubBottom: lastBubBottom, nextNumTop: nextNumTop,
             net: Math.round((nextNumTop - lastBubBottom) * 1000) / 1000,
             lineTop1: mm(a.getBoundingClientRect().top - fb.top),
             lineTop2: mm(b.getBoundingClientRect().top - fb.top),
             marks: marks,
             forced: ${forceGap === null ? 'null' : forceGap},
             lineGapH: window.AS.geometry.lineGapH(window.AS.config.PRESETS.A4) };
  })()`;

  /* 强制 lineGapH：直接改 geometry 导出的函数不可行（内部闭包），
     改用 CSS 覆盖 row-gap 来注入任意行距。 */
  const results = [];
  for (const rg of [null, '4mm', '8mm']) {
    const expr = `(() => {
      const style = document.getElementById('__rowgap_probe') ||
        (function(){ const s=document.createElement('style'); s.id='__rowgap_probe';
          document.head.appendChild(s); return s; })();
      style.textContent = ${JSON.stringify(rg)} === null ? ''
        : '.as-choice-grid { row-gap: ' + ${JSON.stringify(rg)} + ' !important; }';
      return true;
    })()`;
    await send('Runtime.evaluate', { expression: expr });
    const res = await send('Runtime.evaluate',
      { expression: MEASURE(rg === null ? null : parseFloat(rg)), returnByValue: true });
    if (res.result?.exceptionDetails) {
      console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 500));
    } else {
      results.push(res.result.result.value);
    }
  }

  console.log('row-gap 覆盖  行顶距   末气泡底   下行题号顶   净空');
  results.forEach(function (r) {
    console.log('  %-10s  %s   %s   %s   %s',
      r.forced === null ? '(默认)' : r.forced + 'mm',
      Math.round((r.lineTop2 - r.lineTop1) * 1000) / 1000,
      r.lastBubBottom, r.nextNumTop, r.net);
  });
  const A = results[0], B = results[1];
  if (A && B) {
    const dl = (B.lineTop2 - B.lineTop1) - (A.lineTop2 - A.lineTop1);
    const dn = B.net - A.net;
    console.log('\n▶ 行距变化 %s → 净空变化 %s   (斜率 %s)',
      Math.round(dl * 1000) / 1000, Math.round(dn * 1000) / 1000,
      Math.round((dn / dl) * 1000) / 1000);
    console.log('▶ 净空 = lineGapH + C  ⇒ C = %s',
      Math.round((A.net - (A.lineTop2 - A.lineTop1) +
                  window.AS.geometry.columnHeight(window.AS.config.PRESETS.A4) -
                  window.AS.geometry.columnHeight(window.AS.config.PRESETS.A4)) * 1000) / 1000);
    console.log('   （用 A 组反解：C = 净空 − lineGapH = %s − %s）',
      A.net, Math.round((A.lineTop2 - A.lineTop1 -
        window.AS.geometry.columnHeight(window.AS.config.PRESETS.A4)) * 1000) / 1000);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
