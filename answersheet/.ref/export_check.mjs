/* =============================================================================
 * 导出链路检查：真实走一遍 html2canvas，量出「卡片在导出图里的实际几何」。
 * 用 CDP 打开页面，注入 html2canvas，对 #stage 里的 .as-page 截图并测像素。
 * ========================================================================== */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
// 换查询串绕开 http.server 的缓存，否则改了 css/js 仍量到旧版
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUT = process.argv[2] || '.ref/export_check.txt';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const t = list.find(x => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('chrome devtools not reachable');
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(3500);

const lines = [];
const log = (...a) => lines.push(a.join(' '));

/* 在页面里用 html2canvas 截 .as-page，再读像素统计 */
const EXPR = `(async () => {
  const out = {};
  try {
    out.globals = {
      html2pdf: typeof html2pdf,
      html2canvas: typeof html2canvas,
      jsPDF: typeof jspdf
    };
    const stage = document.getElementById('stage');
    const card = stage.querySelector('.as-page');
    if (!card) { out.err = 'no .as-page'; return out; }
    out.pageRect = (() => { const r = card.getBoundingClientRect(); return { w: r.width, h: r.height }; })();
    out.format = card.getAttribute('data-format');
    /* 预览容器的 fit-zoom 缩放比。getBoundingClientRect 量到的是缩放后的 CSS 像素，
       换成纸面毫米时必须除掉它（漏掉会让所有 DOM 坐标整体偏小）。 */
    const ZOOM = (() => {
      const st = card.closest('.preview-stage');
      const m = st ? getComputedStyle(st).transform : 'none';
      if (!m || m === 'none') return 1;
      const q = m.match(/matrix\\(([^,]+)/);
      return q ? parseFloat(q[1]) : 1;
    })();
    out.zoom = Math.round(ZOOM * 10000) / 10000;
    /* DOM 侧的定标块位置（用于和像素检测结果对照，判断是渲染问题还是检测问题） */
    out.domMarks = (() => {
      const pr = card.getBoundingClientRect();
      const mm = (v) => Math.round(v * 25.4 / 96 / ZOOM * 1000) / 1000;
      return Array.from(card.querySelectorAll('.as-mark-left')).map(e => {
        const r = e.getBoundingClientRect();
        return { cy: mm(r.top - pr.top + r.height / 2),
                 cx: mm(r.left - pr.left + r.width / 2),
                 l: mm(r.left - pr.left), rr: mm(r.right - pr.left),
                 w: mm(r.width), h: mm(r.height),
                 color: getComputedStyle(e).backgroundColor };
      });
    })();

    // 走 html2pdf 自己的 canvas 管线（html2canvas 被 bundle 私有化，不挂 window）
    const cv = await html2pdf().set({
      margin: 0,
      /* 用 PNG 而不是 JPEG：JPEG 的有损压缩会把 0.3mm 的细红线糊掉，
         导致像素级检查漏检定标块（实测漏了 5 个选择题行定标块）。
         这里检查的是几何，不是最终编码，PNG 才无损可信。 */
      image: { type: 'png' },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' }
    }).from(card).toCanvas().get('canvas');
    out.canvas = { w: cv.width, h: cv.height };
    /* 导出前 DOM 里的元素计数：判断「导出图缺内容」是渲染问题还是 DOM 本来就空 */
    out.domCounts = {
      lines: card.querySelectorAll('.as-choice-line').length,
      cols: card.querySelectorAll('.as-choice-col').length,
      items: card.querySelectorAll('.as-choice-item').length,
      bubbles: card.querySelectorAll('.as-bubble').length,
      nums: card.querySelectorAll('.as-choice-num').length,
      grids: card.querySelectorAll('.as-choice-grid').length,
      sections: card.querySelectorAll('.as-choice-section').length,
      subjTables: card.querySelectorAll('.as-subject-inner-table').length
    };
    out.firstBubbleRect = (() => {
      const b = card.querySelector('.as-bubble');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
               border: s.borderWidth, color: s.borderColor, bg: s.backgroundColor };
    })();
    out.leftMarkInfo = (() => {
      const m = card.querySelectorAll('.as-mark-left')[2];
      if (!m) return null;
      const r = m.getBoundingClientRect();
      const pr = card.getBoundingClientRect();
      const s = getComputedStyle(m);
      return {
        cls: m.className, attr: m.getAttribute('style'),
        w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        leftMM: Math.round((r.left - pr.left) * 25.4 / 96 * 100) / 100,
        topMM: Math.round((r.top - pr.top) * 25.4 / 96 * 100) / 100,
        /* 同一个元素在**导出画布**上的预期像素范围（scale=2 的 html2canvas 画布） */
        canvasLeftPx: Math.round((r.left - pr.left) * 2),
        canvasRightPx: Math.round((r.right - pr.left) * 2),
        canvasTopPx: Math.round((r.top - pr.top) * 2),
        canvasBotPx: Math.round((r.bottom - pr.top) * 2),
        pos: s.position, bg: s.backgroundColor, border: s.borderWidth,
        display: s.display, visibility: s.visibility, opacity: s.opacity,
        zIndex: s.zIndex, overflow: s.overflow,
        parentCls: m.parentElement ? m.parentElement.className : null,
        parentRect: (() => { const q = m.parentElement.getBoundingClientRect();
          return { l: Math.round((q.left - pr.left) * 25.4/96*100)/100,
                   t: Math.round((q.top - pr.top) * 25.4/96*100)/100,
                   w: Math.round(q.width * 25.4/96*100)/100,
                   h: Math.round(q.height * 25.4/96*100)/100,
                   pos: getComputedStyle(m.parentElement).position }; })(),
        faceRect: (() => { const q = card.querySelector('.as-face').getBoundingClientRect();
          return { l: Math.round((q.left - pr.left) * 25.4/96*100)/100,
                   w: Math.round(q.width * 25.4/96*100)/100,
                   pos: getComputedStyle(card.querySelector('.as-face')).position,
                   padL: getComputedStyle(card.querySelector('.as-face')).paddingLeft }; })()
      };
    })();
    out.pageStyle = (() => {
      const s = getComputedStyle(card);
      return { pos: s.position, overflow: s.overflow, transform: s.transform,
               w: s.width, h: s.height, bg: s.backgroundColor };
    })();
    const ctx = cv.getContext('2d');
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    const W = cv.width, H = cv.height;
    const mmx = W / (out.format === 'A3' ? 420 : 210);
    const mmy = H / 297;
    out.pxPerMM = { x: Math.round(mmx * 1000) / 1000, y: Math.round(mmy * 1000) / 1000 };

    // 暗像素（卡片墨色）分布
    const dark = new Uint8Array(W * H);
    let darkCount = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
      if (g < 128) { dark[p] = 1; darkCount++; }
    }
    out.darkRatio = Math.round(darkCount / (W * H) * 10000) / 10000;

    /* 非白像素统计（含浅色）：看看导出图里到底有没有红框/气泡的墨 */
    let nonWhite = 0, redish = 0;
    let rminX = 1e9, rmaxX = -1, rminY = 1e9, rmaxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const R = d[i], G2 = d[i+1], B = d[i+2];
        if (R < 250 || G2 < 250 || B < 250) nonWhite++;
        if (R > 120 && R - G2 > 60 && R - B > 60) {
          redish++;
          if (x < rminX) rminX = x; if (x > rmaxX) rmaxX = x;
          if (y < rminY) rminY = y; if (y > rmaxY) rmaxY = y;
        }
      }
    }
    out.nonWhiteRatio = Math.round(nonWhite / (W * H) * 10000) / 10000;
    out.redPixels = redish;
    out.redBBoxMM = redish ? {
      l: Math.round(rminX / mmx * 10) / 10, r: Math.round(rmaxX / mmx * 10) / 10,
      t: Math.round(rminY / mmy * 10) / 10, b: Math.round(rmaxY / mmy * 10) / 10
    } : null;

    // 逐行/逐列是否有暗像素
    const rowHit = [], colHit = [];
    for (let y = 0; y < H; y++) { let any = 0; for (let x = 0; x < W; x++) if (dark[y*W+x]) { any = 1; break; } rowHit.push(any); }
    for (let x = 0; x < W; x++) { let any = 0; for (let y = 0; y < H; y++) if (dark[y*W+x]) { any = 1; break; } colHit.push(any); }

    // 找 >2mm 的空白带
    const bands = (hit, ppm) => {
      const runs = []; let s = -1;
      for (let i = 0; i < hit.length; i++) {
        if (!hit[i]) { if (s < 0) s = i; }
        else { if (s >= 0 && (i - s) / ppm > 2) runs.push([Math.round(s/ppm*10)/10, Math.round(i/ppm*10)/10]); s = -1; }
      }
      if (s >= 0 && (hit.length - s) / ppm > 2) runs.push([Math.round(s/ppm*10)/10, Math.round(hit.length/ppm*10)/10]);
      return runs;
    };
    out.blankRowsMM = bands(rowHit, mmy);
    out.blankColsMM = bands(colHit, mmx);

    const first = (hit) => { for (let i = 0; i < hit.length; i++) if (hit[i]) return i; return -1; };
    const last = (hit) => { for (let i = hit.length - 1; i >= 0; i--) if (hit[i]) return i; return -1; };
    out.inkTopMM = Math.round(first(rowHit) / mmy * 10) / 10;
    out.inkBottomMM = Math.round(last(rowHit) / mmy * 10) / 10;
    out.inkLeftMM = Math.round(first(colHit) / mmx * 10) / 10;
    out.inkRightMM = Math.round(last(colHit) / mmx * 10) / 10;

    // 四角像素：确认纸面是白的
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i+1], d[i+2]]; };
    out.corners = { tl: px(2,2), tr: px(W-3,2), bl: px(2,H-3), br: px(W-3,H-3) };

    /* ── 定标块 ↔ 气泡 的像素级对齐检查 ──
       左侧定标块占 x≈6.94~11.0mm。x≥10.3 是黑框左边线，必须排除；
       x≥8.97 之后会撞上题号/气泡文字，也会把相邻行连起来。
       所以只扫 x=6.9~8.5mm —— 定标块左半幅，无任何其它墨迹。 */
    const x0 = Math.round(7.0 * mmx), x1 = Math.round(8.0 * mmx);
    const bandRows = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) if (dark[y*W+x]) n++;
      bandRows.push(n);
    }
    const runsOf = (arr, thresh) => {
      const out2 = []; let s = -1;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > thresh) { if (s < 0) s = i; }
        else { if (s >= 0) { out2.push([s, i - 1]); s = -1; } }
      }
      if (s >= 0) out2.push([s, arr.length - 1]);
      return out2;
    };
    const markRuns = runsOf(bandRows, 1)
      .map(([a, b]) => ({ top: Math.round(a/mmy*100)/100, bot: Math.round(b/mmy*100)/100,
                          cy: Math.round((a+b)/2/mmy*100)/100, h: Math.round((b-a+1)/mmy*100)/100 }))
      /* 定标块高 = 气泡高 ≈ 2.4mm；滤掉黑框线（0.3mm）与文字等碎块 */
      .filter(r => r.h > 1.5 && r.h < 4 && r.top < 250);

    /* 气泡：选择区网格的列心 x 附近，逐行统计 */
    const gridX0 = Math.round(14 * mmx), gridX1 = Math.round(20 * mmx);
    const gRows = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = gridX0; x < gridX1; x++) if (dark[y*W+x]) n++;
      gRows.push(n);
    }
    const bubbleRuns = runsOf(gRows, 1)
      .map(([a, b]) => ({ top: Math.round(a/mmy*100)/100, bot: Math.round(b/mmy*100)/100,
                          cy: Math.round((a+b)/2/mmy*100)/100, h: Math.round((b-a+1)/mmy*100)/100 }))
      .filter(r => r.top < 200);

    out.markRuns = markRuns;
    out.bubbleRuns = bubbleRuns;

    /* ── 导出图里的网格行：整条选择网格横向铺开统计暗像素 ──
       用来确认「网格本身有没有被画出来」（html2canvas 曾整块漏渲染）。
       气泡只占 x≈13~204mm 中的细边线，所以阈值取 3 个像素以上。 */
    const gx0 = Math.round(13 * mmx), gx1 = Math.round(200 * mmx);
    const gridRows = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = gx0; x < gx1; x++) if (dark[y*W+x]) n++;
      gridRows.push(n);
    }
    out.gridRowRuns = runsOf(gridRows, 3)
      .map(([a, b]) => ({ top: Math.round(a/mmy*100)/100, bot: Math.round(b/mmy*100)/100,
                          cy: Math.round((a+b)/2/mmy*100)/100, h: Math.round((b-a+1)/mmy*100)/100 }))
      .filter(r => r.top > 100 && r.top < 250);

    // 每个定标块是否都能找到一个气泡/题号行与之共线（±0.3mm）
    out.align = markRuns.map(m => {
      let best = 99;
      bubbleRuns.forEach(b => { best = Math.min(best, Math.abs(b.cy - m.cy)); });
      return { markCy: m.cy, nearestDelta: Math.round(best * 1000) / 1000 };
    });
  } catch (e) { out.err = String(e && e.stack || e); }
  return out;
})()`;

const res = await send('Runtime.evaluate', {
  expression: EXPR, awaitPromise: true, returnByValue: true
});
if (res.result?.exceptionDetails) {
  log('EXCEPTION = ' + JSON.stringify(res.result.exceptionDetails).slice(0, 1200));
}
const D = res.result?.result?.value;
log('EXPORT CHECK = ' + JSON.stringify(D, null, 1));

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
ws.close();
chrome.kill();
process.exit(0);
