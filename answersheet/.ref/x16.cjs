const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9635;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 200000);
(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 400));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);
  await send('Runtime.evaluate', { expression: `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`, returnByValue: true }, 20000);
  await sleep(2000);

  /* 关键调研：把面内**每个可见元素**的盒子、字体、颜色、文本都量出来，
     看能不能支撑一个矢量重绘器；顺便统计有多少种「绘制原语」。 */
  const E = `(() => {
    const page = document.querySelector('#stage .as-page');
    const face = page.querySelector('.as-face');
    const S = page.offsetWidth / 210;                 // px per mm（用 offsetWidth 避 transform）
    const mm = v => Math.round(v / S * 1000) / 1000;
    /* 面的左上角（用 offsetTop 链） */
    function absTop(el) { let v = 0; while (el && el !== face) { v += el.offsetTop; el = el.offsetParent; } return v; }
    function absLeft(el) { let v = 0; while (el && el !== face) { v += el.offsetLeft; el = el.offsetParent; } return v; }
    const prim = {};    // 绘制原语统计
    const texts = [];
    const boxes = [];
    face.querySelectorAll('*').forEach(function (el) {
      const cs = getComputedStyle(el);
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim()).join('').trim();
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const w = el.offsetWidth, h = el.offsetHeight;
      const isBubble = /as-bubble|as-mark|as-block|as-opt|as-num/.test(el.className);
      const key = (own ? 'text' : '') + (hasBorder ? '|border' : '') +
                  (hasBg ? '|bg' : '') + (isBubble ? '|bubble' : '');
      if (key) prim[key] = (prim[key] || 0) + 1;
      if (own) {
        texts.push({ cls: String(el.className).slice(0, 40), t: own.slice(0, 28),
          x: mm(absLeft(el)), y: mm(absTop(el)), w: mm(w), h: mm(h),
          fs: cs.fontSize, ff: cs.fontFamily.split(',')[0].replace(/"/g, ''),
          fw: cs.fontWeight, col: cs.color, lh: cs.lineHeight, ta: cs.textAlign,
          ls: cs.letterSpacing, va: cs.verticalAlign, disp: cs.display });
      }
      if (hasBorder || hasBg) {
        boxes.push({ cls: String(el.className).slice(0, 40),
          x: mm(absLeft(el)), y: mm(absTop(el)), w: mm(w), h: mm(h),
          bw: cs.borderTopWidth, bc: cs.borderTopColor, bg: cs.backgroundColor,
          br: cs.borderRadius });
      }
    });
    return {
      scale: Math.round(S * 10000) / 10000,
      faceW: mm(face.offsetWidth), faceH: mm(face.offsetHeight),
      primitives: prim,
      textCount: texts.length,
      boxCount: boxes.length,
      textSamples: texts.slice(0, 12),
      boxSamples: boxes.slice(0, 12)
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true }, 30000);
  say('DOM =', JSON.stringify(r.result?.result?.value, null, 1));
  logs.forEach(l => say('  log:', l.slice(0, 250)));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
