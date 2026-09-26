/* A4 选择题多行：行间距 + 左侧定位点数量。
   用户要求：上一行最后一个选项与下一行题号之间空出一个定位点的高度，
   左侧相应也要有定位点。
   用法：node .ref\rowgap.cjs [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9453;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '40';
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
    set('subjStart',''); set('subjCount','0');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const page = document.querySelector('.as-page');
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const face = page.querySelector('.as-face');
    const fb = face.getBoundingClientRect();
    const R = e => { const b = e.getBoundingClientRect();
      return { t: mm(b.top - fb.top), b: mm(b.bottom - fb.top),
               l: mm(b.left - fb.left), cx: mm((b.left+b.right)/2 - fb.left),
               cy: mm((b.top+b.bottom)/2 - fb.top), h: mm(b.height) }; };
    const grid = face.querySelector('.as-choice-grid');
    const cs = grid ? getComputedStyle(grid) : null;
    const lines = Array.from(face.querySelectorAll('.as-choice-line')).map(function (l, i) {
      const items = Array.from(l.querySelectorAll('.as-choice-item')).map(R);
      const bubbles = Array.from(l.querySelectorAll('.as-bubble')).map(R);
      const nums = Array.from(l.querySelectorAll('.as-choice-num')).map(R);
      const tops = [...new Set(items.map(x => x.t))].sort((a,b)=>a-b);
      return { i: i, n: items.length,
               top: mm(l.getBoundingClientRect().top - fb.top),
               bot: mm(l.getBoundingClientRect().bottom - fb.top),
               itemTop: tops[0], itemBot: mm(Math.max(...items.map(x=>x.b))),
               firstNum: nums.length ? nums[0].t : null,
               lastBubBot: bubbles.length ? mm(Math.max(...bubbles.map(x=>x.b))) : null,
               bubRowsTop: [...new Set(bubbles.map(x=>x.cy))].sort((a,b)=>a-b) };
    });
    const left = Array.from(face.querySelectorAll('.as-mark-left')).map(R)
      .sort((a,b)=>a.cy-b.cy);
    return { gridGap: cs ? cs.rowGap : null, gridH: cs ? cs.height : null,
             colH: window.AS.geometry.columnHeight(window.AS.config.PRESETS.A4),
             lineGapH: window.AS.geometry.lineGapH(window.AS.config.PRESETS.A4),
             lineH: window.AS.geometry.lineHeight(window.AS.config.PRESETS.A4),
             bubbleH: window.AS.geometry.bubbleH(window.AS.config.PRESETS.A4),
             lines: lines, left: left };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('A4  %s 题', NC);
    console.log('几何: columnHeight=%s  lineGapH=%s  lineHeight=%s  bubbleH=%s',
      d.colH, d.lineGapH, d.lineH, d.bubbleH);
    console.log('网格 CSS row-gap = %s', d.gridGap);
    console.log('\n选择题行:');
    d.lines.forEach(function (l) {
      console.log('  行%d  itemTop=%s  itemBot=%s  首题号t=%s  末气泡b=%s  气泡行心=%s',
        l.i + 1, l.itemTop, l.itemBot, l.firstNum, l.lastBubBot, l.bubRowsTop.join(','));
    });
    if (d.lines.length > 1) {
      const a = d.lines[0], b = d.lines[1];
      console.log('\n▶ 第 1 行末气泡底 %s  →  第 2 行题号行顶 %s', a.lastBubBot, b.firstNum);
      console.log('   净空 = %s mm   (要求 = 一个定位点高 %s)',
        Math.round((b.firstNum - a.lastBubBot) * 1000) / 1000, d.bubbleH);
      console.log('▶ 行间距（item 顶到 item 顶）= %s   (lineHeight = %s)',
        Math.round((b.itemTop - a.itemTop) * 1000) / 1000, d.lineH);
    }
    console.log('\n左侧定位点（共 %d 个）:', d.left.length);
    d.left.forEach(function (m, i) {
      console.log('   #%d 块心y=%s', i + 1, m.cy);
    });
    const expect = d.lines.length * 5 + 1;
    console.log('\n▶ 左侧定位点数量 %d   (行数×5 + 缺考1 = %d)  %s',
      d.left.length, expect, d.left.length === expect ? 'OK' : '** 数量不对 **');
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
