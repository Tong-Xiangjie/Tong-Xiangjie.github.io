const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 9653);
const CFG = JSON.parse(process.env.CFG || '{"format":"A4","theme":"color","choiceTotal":12,"subjCount":2,"lines":6}');
const OUT = process.env.OUT || '.ref/out/png/prev96';
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
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 30000).then(() => ({ __to: true }))]);
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() }, 30000);
  await sleep(6000);
  const scores = new Array(CFG.subjCount).fill('10').join(',');
  await send('Runtime.evaluate', { expression: `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','${CFG.choiceTotal}'); set('choiceStart','1');
    set('subjStart','${CFG.choiceTotal + 1}'); set('subjCount','${CFG.subjCount}');
    set('subjScore','${scores}');
    document.getElementById('btnGenerate').click();
    return 1;
  })()`, returnByValue: true }, 20000);
  await sleep(2500);

  /* 把 stage 关掉缩放、定位到原点，用 clip 截出干净的一页。
     ⚠ 外壳是深色主题，`.as-page` 外面有底色；直接按页面矩形截图会把
       深色背景一起截进来（每行 3000+ 个深像素）。所以先把页面搬到
       一个白底容器里，脱离 shell 的配色。 */
  const info = await send('Runtime.evaluate', { expression: `(() => {
    const st = document.querySelector('.preview-stage');
    st.style.transform='none'; st.style.width='auto';
    st.style.gap='0';
    const pages = document.querySelectorAll('#stage .as-page');
    const p = pages[0];
    const host = document.createElement('div');
    host.id = '__shot';
    host.style.cssText = 'position:fixed;left:0;top:0;background:#fff;' +
      'z-index:2147483000;margin:0;padding:0;';
    document.body.appendChild(host);
    host.appendChild(p);
    const r = p.getBoundingClientRect();
    return { n: pages.length, x: r.left, y: r.top, w: r.width, h: r.height };
  })()`, returnByValue: true }, 20000);
  const v = info.result?.result?.value;
  say('PAGE =', JSON.stringify(v));
  if (!v) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(1); }
  /* ⚠ 两个坑叠加过：
       ① clip.scale 与 deviceScaleFactor **相乘**（3.125×3.125=936dpi）；
       ② clip 的 x/y/w/h 会被当成**设备像素**，于是只采样了页面的
          1/3.125，剩下的区域从页面下方取 —— 症状是整页内容整体上移
          2.109mm、横线位置全对不上。
     正确做法：clip 用**逻辑 CSS 坐标**、scale 留 1，缩放全部交给
     deviceScaleFactor。 */
  const DSF = 1;
  await send('Emulation.setDeviceMetricsOverride',
    { width: Math.ceil(v.w), height: Math.ceil(v.h), deviceScaleFactor: DSF, mobile: false });
  await sleep(900);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: v.x, y: v.y, width: v.w, height: v.h, scale: 1 },
    captureBeyondViewport: true
  }, 60000);
  const data = shot.result?.data;
  if (!data) { say('截图失败', JSON.stringify(shot).slice(0, 300)); }
  else {
    const buf = Buffer.from(data, 'base64');
    writeFileSync(join(process.cwd(), OUT + '-1.png'), buf);
    say('WROTE', OUT + '-1.png', buf.length, v.w + 'x' + v.h + ' CSS px');
  }
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
