/* 选择题换行布局探针：每行题号 / 左侧定标点 / 气泡列 / 行间距。
   用法：node .ref\row_probe.cjs [A4|A3] [选择题数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9431;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '14';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      target = (await r.json()).find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const EXPR = `(() => {
    document.querySelector('#segFormat button[data-val="${FMT}"]').click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart', String(${NC} + 1)); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    document.getElementById('btnGenerate').click();
    const root = document.querySelector('.as-page') || document.body;
    const stage = document.querySelector('.preview-stage');
    if (stage) stage.style.transform = 'none';
    /* 纸面 210mm 宽，用它反推 mm/px，避免被预览缩放骗到 */
    const paper = root.getBoundingClientRect();
    const S = paper.width / 210;                 // px per mm
    const M = v => Math.round((v / S) * 1000) / 1000;   // px → mm
    const Rmm = e => { const b = e.getBoundingClientRect();
      return { l: M(b.left), t: M(b.top), r: M(b.right), b: M(b.bottom),
               cx: M((b.left+b.right)/2), cy: M((b.top+b.bottom)/2),
               w: M(b.width), h: M(b.height) }; };

    const gridEl = root.querySelector('.as-choice-grid');
    const lineEls = Array.from(root.querySelectorAll('.as-choice-line'));
    const gridInfo = {
      scale: S,
      lineCount: lineEls.length,
      gridRowGap: gridEl ? getComputedStyle(gridEl).rowGap : null,
      lines: lineEls.map(e => { const b = e.getBoundingClientRect();
        return { t: M(b.top), b: M(b.bottom), h: M(b.height), li: e.style.cssText }; })
    };

    const topMarks = Array.from(root.querySelectorAll('.as-mark-top'))
      .map(e => Rmm(e).cx);

    const leftMarks = Array.from(root.querySelectorAll('.as-mark-left')).map(e => ({
      cy: Rmm(e).cy, cx: Rmm(e).cx, h: Rmm(e).h
    }));

    /* 每一个 .as-choice-item 就是一道题的列 */
    const items = Array.from(root.querySelectorAll('.as-choice-item')).map(e => {
      const nums = e.querySelector('.as-choice-nums');
      const bub = e.querySelector('.as-bubble');
      const it = Rmm(e);
      return {
        no: (e.querySelector('.as-choice-num') || {}).textContent || '',
        itemTop: it.t, itemBot: it.b,
        l: it.l, cx: it.cx,
        numTop: nums ? Rmm(nums).t : null,
        numBot: nums ? Rmm(nums).b : null,
        bubTop: bub ? Rmm(bub).t : null,
        bubBot: bub ? Rmm(bub).b : null,
        bubCx: bub ? Rmm(bub).cx : null
      };
    });

    /* 行分组：按 itemTop 聚簇 */
    const lines = [];
    items.forEach(it => {
      let g = lines.find(L => Math.abs(L.top - it.itemTop) < 2);
      if (!g) { g = { top: it.itemTop, bot: it.itemBot, items: [] }; lines.push(g); }
      g.items.push(it);
      g.bot = Math.max(g.bot, it.itemBot);
    });
    lines.sort((a, b) => a.top - b.top);
    lines.forEach(g => g.items.sort((a, b) => a.l - b.l));
    return { topMarks, leftMarks, lines, gridInfo };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('格式 %s   选择题 %s 题   共 %d 行', FMT, NC, d.lines.length);
    console.log('scale = %s px/mm', d.gridInfo.scale);
    console.log('.as-choice-line 个数 = %d   grid row-gap = %s',
      d.gridInfo.lineCount, d.gridInfo.gridRowGap);
    d.gridInfo.lines.forEach((L, i) => console.log('   line#%d  y %s→%s  h=%s',
      i, L.t, L.b, L.h));
    console.log('顶部定标点 %d 个  前 5: %s', d.topMarks.length, d.topMarks.slice(0, 5).join(', '));
    console.log('\n左侧定标带 %d 个:', d.leftMarks.length);
    d.leftMarks.forEach((m, i) => console.log('   #%d cy=%s  cx=%s  h=%s', i, m.cy, m.cx, m.h));

    console.log('\n选择题各行:');
    d.lines.forEach((g, i) => {
      console.log('   第 %d 行  题号 %s', i + 1, g.items.map(x => x.no).join(','));
      console.log('       列心 x: %s', g.items.map(x => x.bubCx).join(', '));
      console.log('       题号行 y %s→%s   首气泡 y %s→%s',
        g.items[0].numTop, g.items[0].numBot, g.items[0].bubTop, g.items[0].bubBot);
    });

    console.log('\n▶ 行间距（上一行末气泡底 → 下一行题号顶）:');
    for (let i = 1; i < d.lines.length; i++) {
      const gap = Math.round((d.lines[i].items[0].numTop -
                              d.lines[i-1].items[0].bubBot) * 1000) / 1000;
      console.log('   行%d → 行%d = %s mm', i, i + 1, gap);
    }

    console.log('\n▶ 左侧定标点 vs 每行:');
    d.lines.forEach((g, i) => {
      const numY = g.items[0].numTop, bubY = g.items[0].bubTop;
      const near = d.leftMarks.filter(m => m.cy > numY - 6 && m.cy < g.bot + 6);
      console.log('   行%d  题号顶 %s  气泡顶 %s  行底 %s', i + 1, numY, bubY, g.bot);
      near.forEach(m => console.log('        左点 cy=%s  与题号顶差 %s  与气泡顶差 %s',
        m.cy, Math.round((m.cy - numY) * 1000) / 1000,
        Math.round((m.cy - bubY) * 1000) / 1000));
      if (!near.length) console.log('        ** 本行附近没有左侧定标点 **');
    });

    console.log('\n▶ 首列列心 vs 顶部定标点:');
    if (d.lines.length) {
      const c0 = d.lines[0].items[0].bubCx;
      const nearest = d.topMarks.reduce((a, b) =>
        Math.abs(b - c0) < Math.abs(a - c0) ? b : a, d.topMarks[0]);
      console.log('   首列列心 %s   最近定标点 %s   差 %s mm',
        c0, nearest, Math.round(Math.abs(c0 - nearest) * 1000) / 1000);
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
