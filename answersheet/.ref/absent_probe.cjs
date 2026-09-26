/* 缺考框 vs 左侧小方块：逐个列出块心 y，看缺考框该对齐哪一块。
   用法：node .ref\absent_probe.cjs [A4|A3] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9443;
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
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const CY = e => { const b = e.getBoundingClientRect();
      return mm((b.top + b.bottom) / 2 - fb.top); };
    const T = e => mm(e.getBoundingClientRect().top - fb.top);
    const B = e => mm(e.getBoundingClientRect().bottom - fb.top);
    const left = Array.from(face.querySelectorAll('.as-mark-left'))
      .map(e => ({ cy: CY(e), w: mm(e.getBoundingClientRect().width),
                   h: mm(e.getBoundingClientRect().height) }))
      .sort((a,b)=>a.cy-b.cy);
    const cb = face.querySelector('.as-check-box');
    const note = face.querySelector('.as-note');
    const CX = e => { const b = e.getBoundingClientRect();
      return mm((b.left + b.right) / 2 - pr.left); };
    const L = e => mm(e.getBoundingClientRect().left - pr.left);
    const topMarks = Array.from(document.querySelectorAll('.as-mark-top'))
      .map(e => ({ cx: CX(e), l: L(e) })).sort((a, b) => a.cx - b.cx);
    const G = window.AS.geometry, p = window.AS.config.PRESETS['${FMT}'];
    const fw = window.AS.config.PAPER['${FMT}'].w /
      ('${FMT}' === 'A3' ? window.AS.config.A3_COLUMNS : 1);
    return {
      left: left,
      rowOffsets: G.rowOffsets(p),
      choiceLines: (face.querySelectorAll('.as-choice-line') || []).length,
      checkBox: cb ? { t: T(cb), b: B(cb), cy: CY(cb),
                       l: L(cb), cx: CX(cb),
                       w: mm(cb.getBoundingClientRect().width),
                       h: mm(cb.getBoundingClientRect().height) } : null,
      topMarks: topMarks,
      band: G.topBandGeom(p, window.AS.config.PAPER['${FMT}'].w /
        ('${FMT}' === 'A3' ? window.AS.config.A3_COLUMNS : 1), 0),
      note: note ? { t: T(note), b: B(note) } : null,
      gridTop: (function () {
        const g = face.querySelector('.as-choice-grid');
        return g ? T(g) : null;
      })(),
      absentCy: window.AS.page && window.AS.page.special ? null : null
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('格式 %s', FMT);
    console.log('rowOffsets = %s', d.rowOffsets.join(', '));
    console.log('网格顶 y = %s', d.gridTop);
    console.log('注意事项框 %s → %s', d.note && d.note.t, d.note && d.note.b);
    console.log('\n左侧小方块（共 %d 个）:', d.left.length);
    d.left.forEach((m, i) => {
      const fromGrid = d.gridTop === null ? null : Math.round((m.cy - d.gridTop) * 1000) / 1000;
      console.log('   #%d  块心 y=%s  (相对网格顶 %s)  %s×%s',
        i + 1, m.cy, fromGrid, m.w, m.h);
    });
    if (d.checkBox) {
      console.log('\n缺考填涂框  y=%s → %s   块心 (x=%s, y=%s)   %s×%s',
        d.checkBox.t, d.checkBox.b, d.checkBox.cx, d.checkBox.cy,
        d.checkBox.w, d.checkBox.h);
      const hit = d.left.reduce((a, m) =>
        Math.abs(m.cy - d.checkBox.cy) < Math.abs(a.cy - d.checkBox.cy) ? m : a, d.left[0]);
      const idx = d.left.indexOf(hit) + 1;
      console.log('   ▶ 纵向对齐左侧第 %d 个小方块 (差 %s)',
        idx, Math.round((d.checkBox.cy - hit.cy) * 1000) / 1000);
      console.log('\n顶部定标带（前 5 块）: %s  共 %d 块',
        d.topMarks.slice(0, 5).map(m => 'x=' + m.cx).join('  '), d.topMarks.length);
      console.log('几何预测: first=%s step=%s', d.band.first, d.band.step);
      const m3 = d.topMarks[2];
      console.log('\n▶ 缺考框块心 x=%s   第 3 个顶部小方块块心 x=%s  差 %s',
        d.checkBox.cx, m3 && m3.cx,
        m3 ? Math.round((d.checkBox.cx - m3.cx) * 1000) / 1000 : '-');
      console.log('   ▶ 横向对齐第 3 个顶部小方块: %s',
        m3 && Math.abs(d.checkBox.cx - m3.cx) < 0.1 ? 'OK' : '** 没对齐 **');
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
