/* 顶部定标带：端空隙 vs 块间空隙，直接量 DOM。
   用法：node .ref\band_gap.cjs [A4|A3] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9441;
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
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','20'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const R = e => { const b = e.getBoundingClientRect();
      return { l: mm(b.left - pr.left), r: mm(b.right - pr.left), cx: mm((b.left+b.right)/2 - pr.left) }; };
    const faceW = window.AS.config.PAPER['${FMT}'].w /
      ('${FMT}' === 'A3' ? window.AS.config.A3_COLUMNS : 1);
    const onFace0 = e => R(e).cx < faceW;
    const marks = Array.from(document.querySelectorAll('.as-mark-top')).map(R).filter(m => m.cx < faceW)
      .sort((a,b)=>a.cx-b.cx);
    const corners = Array.from(document.querySelectorAll('.as-corner')).map(R)
      .filter(c => c.cx < faceW).sort((a,b)=>a.cx-b.cx);
    const G = window.AS.geometry, p = window.AS.config.PRESETS['${FMT}'];
    const band = G.topBandGeom(p, faceW, 0);
    const cb = G.contentBox(p, faceW);
    return {
      faceW: faceW,
      markW: mm(document.querySelector('.as-mark-top').getBoundingClientRect().width),
      cornerW: mm(document.querySelector('.as-corner').getBoundingClientRect().width),
      marks: marks,
      corners: corners,
      pred: band,
      contentBox: cb,
      cornerInnerL: window.AS.config.PRESETS['${FMT}'].cornerInsetX,
      blockW: p.blockW
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('格式 %s   面宽 %s   块宽(实测) %s   角标宽 %s',
      FMT, d.faceW, d.markW, d.cornerW);
    console.log('\n几何预测 topBandGeom: %s', JSON.stringify(d.pred));
    console.log('contentBox: %s', JSON.stringify(d.contentBox));
    console.log('\n角标(第一面): %s', d.corners.map(c => `cx=${c.cx} l=${c.l} r=${c.r}`).join('  |  '));
    console.log('定标块数 %d', d.marks.length);
    console.log('  首块 %s   次块 %s   末块 %s',
      JSON.stringify(d.marks[0]), JSON.stringify(d.marks[1]),
      JSON.stringify(d.marks[d.marks.length - 1]));
    const m = d.marks;
    const leftCorner = d.corners[0], rightCorner = d.corners[1];
    if (m.length > 1 && leftCorner && rightCorner) {
      /* 端空隙：左角标**右缘** → 首块**左缘** */
      const gapL = Math.round((m[0].l - leftCorner.r) * 1000) / 1000;
      /* 端空隙：末块**右缘** → 右角标**左缘** */
      const gapR = Math.round((rightCorner.l - m[m.length-1].r) * 1000) / 1000;
      const midGap = Math.round((m[1].l - m[0].r) * 1000) / 1000;
      console.log('\n▶ 端空隙 L = 左角标右缘(%s) → 首块左缘(%s) = %s',
        leftCorner.r, m[0].l, gapL);
      console.log('▶ 端空隙 R = 末块右缘(%s) → 右角标左缘(%s) = %s',
        m[m.length-1].r, rightCorner.l, gapR);
      console.log('▶ 块间空隙 = %s', midGap);
      console.log('▶ 三者相等: %s', (Math.abs(gapL-midGap) < 0.15 && Math.abs(gapR-midGap) < 0.15)
        ? 'OK' : '** 不等 **');
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
