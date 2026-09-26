/* 页脚颜色 + 位置校验 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9473;
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
    const foot = face.querySelector('.as-footer');
    const cs = foot ? getComputedStyle(foot) : null;
    const f = foot ? foot.getBoundingClientRect() : null;
    /* 下角标 */
    const corners = Array.from(face.querySelectorAll('.as-corner, .as-mark-corner'))
      .map(e => e.getBoundingClientRect()).filter(r => r.top - fb.top > 200);
    const low = corners.length ? Math.max.apply(null, corners.map(r => r.bottom - fb.top)) : null;
    /* 主题 */
    const theme = (document.querySelector('#themePick button[data-val]') || {}).dataset;
    return {
      text: foot ? foot.textContent.trim() : null,
      color: cs ? cs.color : null,
      fontSize: cs ? cs.fontSize : null,
      inlineBottom: foot ? foot.style.bottom : null,
      footTop: f ? mm(f.top - fb.top) : null,
      footBottom: f ? mm(f.bottom - fb.top) : null,
      lowCornerBottom: low === null ? null : mm(low),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
      themeVar: getComputedStyle(document.documentElement).getPropertyValue('--fc-footer'),
      rgb: cs ? cs.color : null,
      theme: theme ? theme.val : null
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('页脚文字: %s', d.text);
    console.log('颜色      = %s   (--fc-footer = %s, --accent = %s)', d.color, d.themeVar, d.accent);
    console.log('字号      = %s', d.fontSize);
    console.log('inline bottom = %s', d.inlineBottom);
    console.log('位置      = %s → %s', d.footTop, d.footBottom);
    console.log('下角标底  = %s', d.lowCornerBottom);
    if (d.lowCornerBottom !== null && d.footBottom !== null) {
      console.log('▶ 页脚底边 − 下角标底边 = %s mm   %s',
        Math.round((d.footBottom - d.lowCornerBottom) * 1000) / 1000,
        Math.abs(d.footBottom - d.lowCornerBottom) <= 0.05 ? '对齐 OK' : '** 未对齐 **');
    }
    const isRed = /rgb\\(217, 48, 37\\)|#d93025/i.test(d.color || '');
    const isBlack = /rgb\\(0, 0, 0\\)|#000/i.test(d.color || '');
    console.log('▶ 页脚颜色 = %s', isRed ? '红色 OK' : (isBlack ? '** 仍是黑色 **' : '未知'));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
