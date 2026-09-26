/* 走一遍**真实导出路径**（点 #btnPdf 用的那条：html2pdf().from(wrap).save()），
   拦下它生成的 datauristring，落地成 PDF 文件，再统计每页的墨量。
   用途：确认「导出是白纸」到底是渲染问题还是页面本身空白。
   用法：node .ref/pdf_check.mjs <out.pdf> [A4|A3] [color|mono] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9349;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUTPDF = process.argv[2] || '.ref/out.pdf';
const FMT = process.argv[3] || 'A4';
const THEME = process.argv[4] || 'color';

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
  if (!target) throw new Error('no chrome target');
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

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  /* 复刻 exportPdf() 的包装逻辑，但把 save() 换成 outputPdf('datauristring') */
  const EXPR = `(async () => {
    const out = {};
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const t = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (t) t.click();
    if (typeof generate === 'function') generate();
    await new Promise(r => setTimeout(r, 600));

    const C = window.AS.config, Theme = window.AS.theme;
    const state = window.AS.app.state;
    const stage = document.getElementById('stage');
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-10000px';
    wrap.style.top = '0';
    wrap.innerHTML = stage.innerHTML;
    document.body.appendChild(wrap);

    Theme.apply(wrap, state.theme);
    Theme.applyPreset(wrap, C.PRESETS[state.format], state.format);
    Theme.applyFonts(wrap);
    wrap.querySelectorAll('.as-page').forEach(function (el) {
      Theme.apply(el, state.theme);
      Theme.applyPreset(el, C.PRESETS[state.format], state.format);
      Theme.applyFonts(el);
    });
    wrap.querySelectorAll('.as-face-guide').forEach(el => { el.style.display = 'none'; });
    wrap.querySelectorAll('.preview-stage').forEach(el => { el.style.transform = 'none'; });

    /* 导出前先量一下 wrap 里第一张纸的几何 —— 空白页面往往就是这里塌了 */
    const p0 = wrap.querySelector('.as-page');
    const r0 = p0.getBoundingClientRect();
    out.wrapPageRect = { w: Math.round(r0.width*100)/100, h: Math.round(r0.height*100)/100 };
    out.wrapCounts = {
      pages: wrap.querySelectorAll('.as-page').length,
      bubbles: wrap.querySelectorAll('.as-bubble').length,
      marks: wrap.querySelectorAll('.as-mark').length,
      grids: wrap.querySelectorAll('.as-choice-grid').length,
      subjTables: wrap.querySelectorAll('.as-subject-inner-table').length
    };
    /* 逐层量 wrap → .page-wrap → .as-page 的盒子，找出高度为什么是 0 */
    out.chain = (() => {
      const res = [];
      let e = wrap.querySelector('.as-page');
      while (e && e !== document.body) {
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        res.push({ cls: e.className || e.tagName,
                   pos: s.position, disp: s.display, h: s.height, w: s.width,
                   rectH: Math.round(r.height*100)/100, rectW: Math.round(r.width*100)/100,
                   rectTop: Math.round(r.top*100)/100, overflow: s.overflow,
                   float: s.float, contain: s.contain });
        e = e.parentElement;
      }
      return res;
    })();
    const b0 = wrap.querySelector('.as-bubble');
    if (b0) { const rb = b0.getBoundingClientRect();
      out.firstBubble = { w: Math.round(rb.width*100)/100, h: Math.round(rb.height*100)/100,
                          bg: getComputedStyle(b0).backgroundColor }; }
    const g0 = wrap.querySelector('.as-choice-grid');
    if (g0) { const rg = g0.getBoundingClientRect();
      out.gridRect = { w: Math.round(rg.width*100)/100, h: Math.round(rg.height*100)/100 }; }

    const fmt = state.format;
    const meta = window.AS.app.readMeta();
    const name = (meta.title + '_' + meta.subject + '答题卡').replace(/[\\\\/:*?"<>|]/g, '');

    /* 分步跑，定位空白发生在哪一步 */
    const worker = html2pdf().set({
      margin: 0,
      filename: name + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 3, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: [C.PAPER[fmt].w, C.PAPER[fmt].h],
               orientation: C.PAPER[fmt].orientation },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(wrap);

    /* 对照实验 A：直接截 wrap 里的第一张 .as-page（export_check.mjs 就是这么做的，能出图） */
    try {
      const card = wrap.querySelector('.as-page');
      const cvA = await html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1, useCORS: true, backgroundColor: '#ffffff' }
      }).from(card).toCanvas().get('canvas');
      out.canvasCard = { w: cvA.width, h: cvA.height };
    } catch (e) { out.canvasCardErr = String(e); }

    /* 对照实验 B：截舞台里原本那张 .as-page（未经 wrap 克隆） */
    try {
      const live = document.querySelector('#stage .as-page');
      const cvB = await html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1, useCORS: true, backgroundColor: '#ffffff' }
      }).from(live).toCanvas().get('canvas');
      out.canvasLive = { w: cvB.width, h: cvB.height };
    } catch (e) { out.canvasLiveErr = String(e); }

    /* 对照实验：把整叠纸交给 html2canvas，看容器高度到底是不是 0。
       分别试三种包装方式，定位是哪一种让容器塌成 0 高。 */
    const variants = [
      ['fixed-offscreen', { position: 'fixed', left: '-10000px', top: '0' }],
      ['absolute-origin', { position: 'absolute', left: '0', top: '0' }],
      ['static-flow', { position: 'static' }],
      ['absolute-origin-visible', { position: 'absolute', left: '0', top: '0' }]
    ];
    out.variants = {};
    for (const [name, style] of variants) {
      try {
        const w2 = document.createElement('div');
        for (const k in style) w2.style[k] = style[k];
        if (name === 'absolute-origin-visible') { w2.style.opacity = '0'; }
        w2.innerHTML = stage.innerHTML;
        document.body.appendChild(w2);
        Theme.apply(w2, state.theme);
        Theme.applyPreset(w2, C.PRESETS[state.format], state.format);
        Theme.applyFonts(w2);
        w2.querySelectorAll('.as-face-guide').forEach(el => { el.style.display = 'none'; });
        w2.querySelectorAll('.preview-stage').forEach(el => {
          el.style.transform = 'none'; el.style.width = 'auto';
        });
        const wr = w2.getBoundingClientRect();
        const wk = html2pdf().set({
          margin: 0, image: { type: 'png' },
          html2canvas: { scale: 1, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: [C.PAPER[state.format].w, C.PAPER[state.format].h],
                   orientation: C.PAPER[state.format].orientation },
          pagebreak: { mode: ['css', 'legacy'] }
        }).from(w2);
        await wk.toCanvas();
        out.variants[name] = {
          wrapRect: { w: Math.round(wr.width), h: Math.round(wr.height) },
          container: (function () { const c = wk.prop.container;
            if (!c) return null; const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
          canvas: wk.prop.canvas ? { w: wk.prop.canvas.width, h: wk.prop.canvas.height } : null
        };
        w2.remove();
      } catch (e) { out.variants[name] = 'ERR ' + e.message; }
    }

    const cv = await worker.toCanvas().get('canvas');
    out.canvas = { w: cv.width, h: cv.height };
    /* 对照实验：换成「就地可见、绝对定位在文档原点」的包装 */
    try {
      const w2 = wrap.cloneNode(true);
      w2.style.position = 'absolute';
      w2.style.left = '0';
      w2.style.top = '0';
      w2.style.zIndex = '-1';
      document.body.appendChild(w2);
      const cv2 = await html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1, useCORS: true, backgroundColor: '#ffffff' }
      }).from(w2).toCanvas().get('canvas');
      out.canvasAlt = { w: cv2.width, h: cv2.height };
      w2.remove();
    } catch (e) { out.canvasAltErr = String(e); }
    try {
      const cx = cv.getContext('2d');
      const im = cx.getImageData(0, 0, cv.width, cv.height).data;
      let nw = 0;
      for (let i = 0; i < im.length; i += 4) {
        if (im[i] < 250 || im[i+1] < 250 || im[i+2] < 250) nw++;
      }
      out.canvasNonWhite = nw;
      out.canvasNonWhiteRatio = Math.round(nw / (cv.width * cv.height) * 10000) / 10000;
    } catch (e) { out.canvasErr = String(e); }

    const dataUri = await worker.outputPdf('datauristring');

    out.dataUriLen = dataUri.length;
    document.body.removeChild(wrap);
    return { out, dataUri };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', JSON.stringify(res.result.exceptionDetails).slice(0, 800));
  }
  const v = res.result?.result?.value;
  if (!v) { console.log('no value'); ws.close(); chrome.kill(); process.exit(1); }
  console.log('PROBE', JSON.stringify(v.out, null, 1));
  writeFileSync(OUTPDF.replace(/\.pdf$/, '_probe.json'), JSON.stringify(v.out, null, 1), 'utf8');

  const m = /base64,(.*)$/s.exec(v.dataUri);
  if (!m) { console.log('dataUri head:', String(v.dataUri).slice(0, 200)); }
  else {
    writeFileSync(OUTPDF, Buffer.from(m[1], 'base64'));
    console.log('WROTE', OUTPDF);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
