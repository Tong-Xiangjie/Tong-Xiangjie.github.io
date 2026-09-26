/* Ground-truth check: ask the real rendered DOM for the bounding boxes of the
 * positioning marks and the bubbles, convert px -> mm, and verify the three
 * alignment rules hold in the actual browser layout. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 每次跑都换一个查询串，强制绕过 http.server 的 Last-Modified 缓存，
// 否则改了 css/js 之后仍然量到旧版布局（曾因此白查半天）。
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const PORT = 9333;
const OUT = process.argv[2] || '.ref/dom_verify.txt';

const lines = [];
const log = (...a) => lines.push(a.join(' '));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', '--media-cache-size=1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\ascdp-${Date.now()}`, URL
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('devtools not reachable');
}

const ws = new WebSocket(await getWsUrl());
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise(r => pending.set(mid, r));
}

await send('Runtime.enable');
await sleep(2500);   // let app.js generate

/* 可选用命令行指定纸张与主题：node dom_verify.mjs out.txt A3 mono */
const ARG_FORMAT = (process.argv[3] || '').toUpperCase();
const ARG_THEME = (process.argv[4] || '').toLowerCase();
if (ARG_FORMAT || ARG_THEME) {
  const setup = `(() => {
    const out = {};
    const fmt = ${JSON.stringify(ARG_FORMAT)};
    const thm = ${JSON.stringify(ARG_THEME)};
    if (fmt) {
      const b = document.querySelector('#segFormat button[data-val="' + fmt + '"]');
      if (b) { b.click(); out.format = fmt; } else out.format = 'NOT_FOUND';
    }
    if (thm) {
      const c = document.querySelector('#themePick .theme-card[data-theme="' + thm + '"]');
      if (c) { c.click(); out.theme = thm; } else out.theme = 'NOT_FOUND';
    }
    /* 表单默认值已清空，自检前必须填一份测试数据，否则生成的是空卡 */
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    if (window.AS && window.AS.app && window.AS.app.generate) window.AS.app.generate();
    return out;
  })()`;
  const sr = await send('Runtime.evaluate', { expression: setup, returnByValue: true });
  log(`SETUP = ${JSON.stringify(sr.result?.result?.value)}`);
  await sleep(900);
}

/* 先探一下页面到底渲染出了什么（避免主表达式抛异常后完全看不到状态） */
const PROBE = `(() => {
  const errs = [];
  window.addEventListener('error', e => errs.push('ERR: ' + e.message + ' @' + e.filename + ':' + e.lineno));
  let genErr = null;
  let pipe = null;
  try {
    if (window.AS && window.AS.app && window.AS.app.generate) {
      const app = window.AS.app;
      const opt = app.readOptions();
      const C = window.AS.config;
      const preset = C.PRESETS[opt.format];
      const blocks = window.AS.paginator.planBlocks({
        preset: preset, group: C.GROUPS[opt.format],
        faceW: C.PAPER[opt.format].w,
        choiceTotal: opt.choiceTotal, choiceStart: opt.choiceStart,
        subjItems: opt.subjItems
      });
      const faces = window.AS.paginator.paginate({
        blocks: blocks,
        preset: preset,
        chromeFirst: window.AS.page.chromeHeight(true),
        chromeOther: window.AS.page.chromeHeight(false)
      });
      const ch = blocks.find(b => b.kind === 'choice');
      const presetDbg = C.PRESETS[opt.format];
      pipe = {
        rowGap: window.AS.paginator.ROW_GAP,
        colHeight: window.AS.geometry.columnHeight(presetDbg),
        rowOffsets: window.AS.geometry.rowOffsets(presetDbg),
        bubbleH: window.AS.geometry.bubbleH(presetDbg),
        numRowH: window.AS.geometry.numRowH(presetDbg),
        preset: JSON.stringify(presetDbg),
        optFormat: opt.format,
        choiceTotal: opt.choiceTotal,
        choiceStart: opt.choiceStart,
        subjLen: opt.subjItems ? opt.subjItems.length : null,
        blockCount: blocks.length,
        blockKinds: blocks.map(b => b.kind),
        choiceBlock: ch ? { totalLines: ch.totalLines, lineH: ch.lineH, colH: ch.colH, size: ch.group && ch.group.size, perLine: ch.group && ch.group.perLine } : null,
        chromeFirst: window.AS.page.chromeHeight(true),
        chromeOther: window.AS.page.chromeHeight(false),
        faceCount: faces.length,
        faceBodyLens: faces.map(f => f.body.length),
        firstBody: faces[0] ? faces[0].body.map(b => b.kind + (b.rows !== undefined ? ':' + b.rows : '')) : null
      };
      app.generate();
    }
  } catch (e) { genErr = String(e && e.stack || e); }
  const page = document.querySelector('.as-page');
  return {
    genErr: genErr,
    pipe: pipe,
    errs: errs,
    hasPage: !!page,
    pageParent: page && page.parentElement ? (page.parentElement.className || page.parentElement.tagName) : null,
    stageType: page ? ((page.closest('.preview-stage') || page.parentElement) || {}).nodeType : null,
    stageCls: page ? String(((page.closest('.preview-stage') || page.parentElement) || {}).className) : null,
    pages: document.querySelectorAll('.as-page').length,
    choiceSections: document.querySelectorAll('.as-choice-section').length,
    choiceOuter: document.querySelectorAll('.as-choice-outer').length,
    subjectOuter: document.querySelectorAll('.as-subject-outer').length,
    zkCells: document.querySelectorAll('.as-zk td').length,
    stageEls: document.querySelectorAll('.preview-stage').length,
    asKeys: Object.keys(window.AS || {}),
    choiceKeys: window.AS && window.AS.choice ? Object.keys(window.AS.choice) : null,
    subjKeys: window.AS && window.AS.subject ? Object.keys(window.AS.subject) : null
  };
})()`;
const probe = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
const P = probe.result?.result?.value;
log(`PROBE = ${JSON.stringify(P, null, 1)}`);
log('');
writeFileSync(OUT, lines.join('\n'), 'utf8');   // 先落盘，后面即使抛错也能看到状态

const EXPR = `(() => {
  const PX_PER_MM = 96 / 25.4;
  const page = document.querySelector('.as-page');
  if (!page) return { error: 'no .as-page' };
  /* 预览区会套一层 fit-zoom（transform: scale）来把整页塞进侧栏。
     量测前先把缩放还原，否则所有 mm 读数都被乘了同一个系数。 */
  const stage = page.closest('.preview-stage') || page.parentElement;
  let scale = 1;
  if (stage && stage.nodeType === 1) {
    const st = getComputedStyle(stage).transform;
    if (st && st !== 'none') {
      const m = st.match(/matrix\\(([^,]+)/);
      if (m) scale = parseFloat(m[1]) || 1;
    }
  }
  const mm = v => Math.round(v / PX_PER_MM / scale * 1000) / 1000;
  const pr = page.getBoundingClientRect();
  const rel = el => {
    const r = el.getBoundingClientRect();
    return { x: mm(r.left - pr.left), y: mm(r.top - pr.top), w: mm(r.width), h: mm(r.height),
             cx: mm(r.left - pr.left + r.width/2), cy: mm(r.top - pr.top + r.height/2) };
  };
  const q = sel => Array.from(document.querySelectorAll(sel)).map(rel);
  const cs = getComputedStyle(page);
  // first choice line structure
  const line0 = document.querySelector('.as-choice-line');
  const cols0 = line0 ? Array.from(line0.querySelectorAll(':scope > .as-choice-col')) : [];
  const c0style = cols0[0] ? getComputedStyle(cols0[0]) : null;
  const inner0 = document.querySelector('.as-choice-inner');
  const innerHTMLFull = inner0 ? inner0.outerHTML.slice(0, 700) : null;
  const innerStyle = inner0 ? getComputedStyle(inner0) : null;
  const outer0 = document.querySelector('.as-choice-outer');
  const outerStyle = outer0 ? getComputedStyle(outer0) : null;
  const lineStyle = line0 ? getComputedStyle(line0) : null;
  const col0 = cols0[0];
  const nums0 = col0 ? col0.querySelector('.as-choice-nums') : null;
  const rows0 = col0 ? Array.from(col0.querySelectorAll('.as-choice-optrow')) : [];
  const detail = (() => {
    if (!col0) return null;
    const cs2 = getComputedStyle(col0);
    /* 新结构：一列里每题是一个绝对定位的 .as-choice-item，
       题号/选项行都在 item 内，所以先取 item，再取它自己的行。 */
    const items = Array.from(col0.querySelectorAll(':scope > .as-choice-item'));
    const it0 = items[0] || null;
    const nums = it0 ? Array.from(it0.querySelectorAll('.as-choice-num')).map(rel) : [];
    const row1 = it0 ? it0.querySelector('.as-choice-optrow') : null;
    const bubs = row1 ? Array.from(row1.querySelectorAll('.as-bubble')).map(rel) : [];
    /* 题号节距 / 气泡节距：量**相邻题**（相邻 item）的列心之差 */
    const itemCx = items.map(e => rel(e).cx);
    const numRowCx = items.map(e => {
      const n = e.querySelector('.as-choice-num');
      return n ? rel(n).cx : null;
    }).filter(v => v !== null);
    const rowBox = (e) => {
      if (!e) return null;
      const s = getComputedStyle(e);
      return { rect: rel(e), pad: s.padding, mar: s.margin, just: s.justifyContent,
               gap: s.gap, w: s.width, align: s.alignItems, display: s.display,
               pos: s.position, transform: s.transform };
    };
    const pitchOf = (arr) => (arr.length > 1)
      ? Math.round((arr[1] - arr[0]) * 1000) / 1000 : null;
    return {
      colW: cs2.width, colGap: cs2.gap, colPad: cs2.padding, colBorder: cs2.borderWidth,
      itemCount: items.length,
      numsRow: rowBox(it0 ? it0.querySelector('.as-choice-nums') : null),
      optRow: rowBox(row1),
      numsRowW: it0 && it0.querySelector('.as-choice-nums')
        ? getComputedStyle(it0.querySelector('.as-choice-nums')).width : null,
      rowW: row1 ? getComputedStyle(row1).width : null,
      nums: nums.map(n => ({ x: n.x, w: n.w, cx: n.cx, cy: n.cy })),
      bubs: bubs.map(b => ({ x: b.x, w: b.w, cx: b.cx, cy: b.cy })),
      itemCx: itemCx,
      numPitch: pitchOf(numRowCx),
      bubPitch: pitchOf(itemCx),
      numVsBub: (nums[0] && bubs[0]) ? Math.round((nums[0].cx - bubs[0].cx) * 1000) / 1000 : null
    };
  })();
  const pageEl0 = document.querySelector('.as-page');
  const fmt = pageEl0 ? (pageEl0.getAttribute('data-format') || 'A4') : 'A4';
  const preset = window.AS.config.PRESETS[fmt];
  /* ⚠ A3 一页三面，每面宽 = 纸宽/3；用整张纸宽会算出 58 列这种假值。 */
  const faceW = window.AS.config.PAPER[fmt].w /
                (fmt === 'A3' ? window.AS.config.A3_COLUMNS : 1);
  const secEl = document.querySelector('.as-choice-section');
  const G2 = window.AS.geometry;
  const cols = G2.columnsPerLine(preset, faceW);
  /* gridShift 已废除：红框内容区改由 geometry.contentBox 给出
     （左缘 = 左侧定位点右边缘，右缘与之对称）。 */
  const cbox = G2.contentBox(preset, faceW);
  const gshift = cbox.left - preset.padX;
  const L0 = (window.AS.__faces && window.AS.__faces[0]) || null;
  const geomLive = L0 ? {
    gridTop: L0.gridTop,
    rowCenters: L0.rowCenters,
    leftMarkYs: L0.leftMarks.map(m => m.cy),
    colCenters0: L0.colCenters.slice(0, 4)
  } : null;
  /* 分页器给出的每个面「有哪些块、各在哪」。
     这是内部诊断量，不暴露到 window 上，直接从分页器现算一遍。 */
  const blocksLive = (() => {
    try {
      const C = window.AS.config, P = window.AS.paginator;
      const fmt = (document.querySelector('.as-page') || {}).dataset?.format || 'A4';
      const opt = window.AS.__lastOptions || {};
      const preset = C.PRESETS[fmt];
      const blocks = P.planBlocks({
        preset, group: C.GROUPS[fmt], faceW: C.PAPER[fmt].w,
        choiceTotal: opt.choiceTotal || 12, choiceStart: opt.choiceStart || 1,
        subjItems: opt.subjItems || []
      });
      const faces = P.paginate({
        blocks, preset,
        chromeFirst: window.AS.page.chromeHeight(true),
        chromeOther: window.AS.page.chromeHeight(false)
      });
      return faces.map(f => f.body.map(b => ({
        kind: b.kind, gridTop: b.gridTop, boxTop: b.boxTop,
        contentTop: b.contentTop, top: b.top, rows: b.rows, head: b.head
      })));
    } catch (e) { return 'blocksLive err: ' + e; }
  })();
  const leftMarkYs = Array.from(document.querySelectorAll('.as-mark-left'))
    .map(e => rel(e).cy).filter(v => v < 200);
  const rowCentersDom = Array.from(document.querySelectorAll('.as-choice-optrow'))
    .map(e => rel(e).cy).filter(v => v < 200);
  /* 直接量：红框「内边距盒」上缘在哪里 —— 用一个临时绝对定位探针。 */
  const padProbe = (() => {
    const outer = document.querySelector('.as-choice-outer');
    if (!outer) return null;
    const t = document.createElement('div');
    t.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
    outer.appendChild(t);
    const y = rel(t).y;
    const ox = rel(outer).y;
    t.remove();
    return {
      padBoxTopMM: y,
      outerBorderTopMM: ox,
      deltaMM: Math.round((y - ox) * 1000) / 1000,
      outerBorderTopPx: getComputedStyle(outer).borderTopWidth,
      outerPadTopPx: getComputedStyle(outer).paddingTop,
      outerPos: getComputedStyle(outer).position
    };
  })();

  const cbProbe = (() => {
    const g = document.querySelector('.as-choice-grid');
    const outer = document.querySelector('.as-choice-outer');
    const sec = document.querySelector('.as-choice-section');
    if (!g || !outer) return null;
    const gs = getComputedStyle(g);
    const os = getComputedStyle(outer);
    const save = g.style.top;
    g.style.top = '0mm';
    const at0 = rel(g).y;
    g.style.top = save;
    return {
      outerPos: os.position,
      secPos: sec ? getComputedStyle(sec).position : null,
      gridTopStyle: g.style.top,
      gridTopComputed: gs.top,
      cbAt0MM: at0,
      outerTopMM: rel(outer).y,
      secTopMM: sec ? rel(sec).y : null,
      cbRelOuter: Math.round((at0 - rel(outer).y) * 1000) / 1000,
      gridNowMM: rel(g).y
    };
  })();
  const gridProbe = (() => {
    const g = document.querySelector('.as-choice-grid');
    const inner = document.querySelector('.as-choice-inner');
    if (!g) return null;
    const gs = getComputedStyle(g);
    const is = inner ? getComputedStyle(inner) : null;
    return {
      grid: rel(g),
      gridAttrStyle: g.getAttribute('style'),
      gridCbOffset: (() => { try { return window.AS.geometry.gridCbOffset(window.AS.config.PRESETS.A4); } catch (e) { return 'ERR:' + e.message; } })(),
      choiceChromeH: (() => { try { return window.AS.geometry.choiceChromeH(window.AS.config.PRESETS.A4); } catch (e) { return 'ERR:' + e.message; } })(),
      geomKeys: Object.keys(window.AS.geometry),
      gridComputedTop: gs.top,
      gridOuterStart: g.outerHTML.slice(0, 120),
      gridTopVar: gs.getPropertyValue('--grid-top'),
      gridPos: gs.position,
      gridTop: gs.top,
      gridLeft: gs.left,
      gridRight: gs.right,
      inner: inner ? rel(inner) : null,
      innerPos: is ? is.position : null,
      innerPadTop: is ? is.paddingTop : null,
      innerH: is ? is.height : null,
      parentClass: g.parentElement ? g.parentElement.className : null
    };
  })();
  const headerProbe = (() => {
    const h = document.querySelector('.as-choice-header') || document.querySelector('.as-choice-header-no-example');
    if (!h) return null;
    const inner = document.querySelector('.as-choice-inner');
    const outer = document.querySelector('.as-choice-outer');
    return {
      header: rel(h),
      headerH: getComputedStyle(h).height,
      headerVar: getComputedStyle(h).getPropertyValue('--choice-header-h'),
      headerMarB: getComputedStyle(h).marginBottom,
      headerDisplay: getComputedStyle(h).display,
      inner: inner ? rel(inner) : null,
      outer: outer ? rel(outer) : null,
      innerPadTop: inner ? getComputedStyle(inner).paddingTop : null,
      outerPadTop: outer ? getComputedStyle(outer).paddingTop : null,
      outerBorderTop: outer ? getComputedStyle(outer).borderTopWidth : null,
      headerMarginTop: getComputedStyle(h).marginTop,
      headerPadTop: getComputedStyle(h).paddingTop,
      headerBox: getComputedStyle(h).boxSizing,
      innerMarginTop: inner ? getComputedStyle(inner).marginTop : null,
      innerBorderTop: inner ? getComputedStyle(inner).borderTopWidth : null,
      pxPerMM: 96 / 25.4
    };
  })();
  const offsetProbe = (() => {
    const inner = document.querySelector('.as-choice-inner');
    const line = document.querySelector('.as-choice-line');
    if (!inner || !line) return null;
    const ics = getComputedStyle(inner);
    const lcs = getComputedStyle(line);
    const before = { inner: inner.getBoundingClientRect().left, line: line.getBoundingClientRect().left };
    // 实验：把黑框左内边距清零，看网格是否跟着左移
    const saved = inner.style.paddingLeft;
    inner.style.paddingLeft = '0mm';
    const after = { inner: inner.getBoundingClientRect().left, line: line.getBoundingClientRect().left };
    inner.style.paddingLeft = saved;
    const restored = { line: line.getBoundingClientRect().left };
    return {
      beforeDeltaPx: Math.round((before.line - before.inner) * 1000) / 1000,
      afterDeltaPx: Math.round((after.line - after.inner) * 1000) / 1000,
      restoredDeltaPx: Math.round((restored.line - after.inner) * 1000) / 1000,
      innerPadLeft: ics.paddingLeft,
      innerBorderLeft: ics.borderLeftWidth,
      linePadLeft: lcs.paddingLeft,
      lineMarginLeft: lcs.marginLeft,
      linePosition: lcs.position,
      innerVarPadX: ics.getPropertyValue('--inner-pad-x'),
      innerVarShift: ics.getPropertyValue('--grid-shift'),
      inlineStyle: inner.getAttribute('style')
    };
  })();
  const secTop = secEl ? parseFloat(getComputedStyle(secEl).top) : 0;
  const rects = (() => {
    const out = {};
    ['.as-choice-section', '.as-choice-outer', '.as-choice-inner', '.as-choice-line',
     '.as-choice-col', '.as-choice-nums', '.as-choice-num', '.as-choice-optrow', '.as-bubble'
    ].forEach(s => {
      const e = document.querySelector(s);
      out[s] = e ? rel(e) : null;
    });
    return out;
  })();
  const chain = (() => {
    const sels = ['.as-choice-section', '.as-choice-outer', '.as-choice-inner', '.as-choice-line', '.as-choice-col'];
    const out = {};
    sels.forEach(s => {
      const e = document.querySelector(s);
      if (!e) { out[s] = null; return; }
      const cs2 = getComputedStyle(e);
      const rr = e.getBoundingClientRect();
      out[s] = {
        rect: rel(e),
        pad: cs2.padding, padL: cs2.paddingLeft,
        border: cs2.borderWidth, borderL: cs2.borderLeftWidth,
        box: cs2.boxSizing,
        left: cs2.left, right: cs2.right, w: cs2.width, marL: cs2.marginLeft,
        contentLeftPx: Math.round((rr.left + parseFloat(cs2.borderLeftWidth) + parseFloat(cs2.paddingLeft)) * 1000) / 1000,
        contentLeftMM: Math.round((rr.left + parseFloat(cs2.borderLeftWidth) + parseFloat(cs2.paddingLeft) - pr.left) / (96/25.4) / scale * 1000) / 1000
      };
    });
    const b = document.querySelector('.as-bubble');
    out['.as-bubble'] = b ? rel(b) : null;
    const n = document.querySelector('.as-choice-num');
    out['.as-choice-num'] = n ? rel(n) : null;
    out.vars = {
      innerPadX: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--inner-pad-x'),
      outerPadX: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--outer-pad-x'),
      qGap: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--q-gap'),
      blockW: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--block-w'),
      step: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--step'),
      outerLeft: getComputedStyle(document.querySelector('.as-page')).getPropertyValue('--outer-left')
    };
    return out;
  })();
  const geomPred = {
    faceW: faceW,
    colsPerLine: cols,
    contentBox: cbox,
    expectedFirstColCx: Math.round((cbox.left + preset.blockW / 2) * 1000) / 1000,
    rowOffsets: window.AS.geometry.rowOffsets(preset),
    columnHeight: window.AS.geometry.columnHeight(preset),
    boxOffsets: window.AS.geometry.boxOffsets(preset),
    secTop: secTop,
    hasSection: !!secEl,
    pageCount: document.querySelectorAll('.as-page').length,
    outerCount: document.querySelectorAll('.as-choice-outer').length,
    subjCount: document.querySelectorAll('.as-subject-outer').length,
    zkCells: document.querySelectorAll('.as-zk td').length
  };
  const rowGeom = {
    nums: nums0 ? rel(nums0) : null,
    numsCS: nums0 ? { h: getComputedStyle(nums0).height, mt: getComputedStyle(nums0).marginTop,
                      mb: getComputedStyle(nums0).marginBottom, lh: getComputedStyle(nums0).lineHeight } : null,
    rows: rows0.map(r => rel(r)),
    rowsCS: rows0.map(r => ({ h: getComputedStyle(r).height, mt: getComputedStyle(r).marginTop,
                              mb: getComputedStyle(r).marginBottom,
                              w: getComputedStyle(r).width, pad: getComputedStyle(r).padding,
                              just: getComputedStyle(r).justifyContent })),
    bubbleCS: (function () {
      const b = document.querySelector('.as-bubble');
      if (!b) return null;
      const s = getComputedStyle(b);
      return { w: s.width, minW: s.minWidth, flex: s.flex, boxSizing: s.boxSizing,
               border: s.borderWidth, pad: s.padding };
    })(),
    colCS: c0style ? { h: c0style.height } : null
  };
  const scaleInfo = {
    pageRectW: pr.width,
    pageOffsetW: page.offsetWidth,
    pageClientW: page.clientWidth,
    pageTransform: cs.transform,
    pageZoom: cs.zoom,
    ancestorChain: (() => {
      const out = [];
      let e = page;
      while (e && e !== document.documentElement) {
        const s = getComputedStyle(e);
        out.push({
          cls: (e.className || e.tagName) + '',
          transform: s.transform,
          zoom: s.zoom,
          scale: s.scale,
          rectW: Math.round(e.getBoundingClientRect().width * 100) / 100,
          offsetW: e.offsetWidth
        });
        e = e.parentElement;
      }
      return out;
    })(),
    colRectW: col0 ? col0.getBoundingClientRect().width : null,
    colOffsetW: col0 ? col0.offsetWidth : null
  };
  const styleDump = {
    col: c0style ? {
      width: c0style.width, minWidth: c0style.minWidth, maxWidth: c0style.maxWidth,
      flex: c0style.flex, flexBasis: c0style.flexBasis, flexShrink: c0style.flexShrink,
      step: c0style.getPropertyValue('--step'), boxSizing: c0style.boxSizing,
      padding: c0style.padding, border: c0style.borderWidth
    } : null,
    inner: innerStyle ? {
      width: innerStyle.width, padding: innerStyle.padding,
      border: innerStyle.borderWidth, boxSizing: innerStyle.boxSizing,
      display: innerStyle.display, left: innerStyle.left, right: innerStyle.right
    } : null,
    outer: outerStyle ? {
      width: outerStyle.width, padding: outerStyle.padding,
      border: outerStyle.borderWidth, boxSizing: outerStyle.boxSizing,
      left: outerStyle.left, right: outerStyle.right, position: outerStyle.position
    } : null,
    line: lineStyle ? { width: lineStyle.width, display: lineStyle.display, flexWrap: lineStyle.flexWrap } : null
  };
  const colInfo = cols0.slice(0, 3).map(c => ({
    w: mm(c.getBoundingClientRect().width),
    x: mm(c.getBoundingClientRect().left - pr.left),
    cls: c.className,
    kids: Array.from(c.children).map(k => k.className + '[' + k.children.length + ']'),
    nums: Array.from(c.querySelectorAll('.as-choice-num')).map(n => n.textContent),
    numXs: Array.from(c.querySelectorAll('.as-choice-num')).map(n => mm(n.getBoundingClientRect().left - pr.left + n.getBoundingClientRect().width/2)),
    bubbleXs: (function () {
      const row = c.querySelector('.as-choice-optrow');
      if (!row) return [];
      return Array.from(row.querySelectorAll('.as-bubble')).map(b => mm(b.getBoundingClientRect().left - pr.left + b.getBoundingClientRect().width/2));
    })()
  }));
  const optrow = document.querySelector('.as-choice-optrow');
  const bubble0 = document.querySelector('.as-bubble');
  /* 实际渲染出来的版式。**不要**依赖 ARG_FORMAT —— 它是 argv[3]，
     很容易没传（把版式当成输出文件名传进去了），那样 A3 会被当 A4 断言。 */
  const REALFMT = ((document.querySelector('.as-page') || {}).dataset || {}).format || 'A4';
  return {
    pageW: mm(pr.width), pageH: mm(pr.height),
    /* ⚠ 这个值**已经是 mm**，不要再套 mm() —— 套了会被多乘一次缩放比
       （实测 420 → 138.9），角标外缘跟着算错、端空隙断言假报。 */
    faceWmm: window.AS.config.PAPER[REALFMT].w /
             (REALFMT === 'A3' ? window.AS.config.A3_COLUMNS : 1),
    blockWmm: window.AS.config.PRESETS[REALFMT].blockW,
    cornerInsetXmm: window.AS.config.PRESETS[REALFMT].cornerInsetX,
    cornerWmm: window.AS.config.PRESETS[REALFMT].cornerW,
    innerHTMLHead: inner0 ? inner0.innerHTML.slice(0, 600) : null,
    innerW: inner0 ? mm(inner0.getBoundingClientRect().width) : null,
    groups: JSON.stringify(window.AS.config.GROUPS),
    styleDump,
    rowGeom,
    geomPred,
    preset,
    gridBubbles: Array.from(document.querySelectorAll('.as-choice-grid .as-bubble'))
      .map(e => rel(e))
      .filter(b => b.cy < 200 && b.cx < (window.AS.config.PAPER[
        ((document.querySelector('.as-page') || {}).dataset || {}).format || 'A4'
      ].w / ((((document.querySelector('.as-page') || {}).dataset || {}).format === 'A3')
        ? window.AS.config.A3_COLUMNS : 1)) - 0.5),
    numRowCenters: [...new Set(Array.from(document.querySelectorAll('.as-choice-grid .as-choice-nums'))
      .map(e => rel(e).cy))].filter(v => v < 200),
    chain,
    rects,
    innerHTMLFull,
    offsetProbe,
    leftMarkYs,
    rowCentersDom,
    headerProbe,
    gridProbe,
    cbProbe,
    padProbe,
    geomLive,
    blocksLive,
    detail,
    scaleInfo,
    choiceBuildSrc: String(window.AS.choice.build).slice(0, 200),
    stepVar: cs.getPropertyValue('--step').trim(),
    blockWVar: cs.getPropertyValue('--block-w').trim(),
    optrowW: optrow ? mm(optrow.getBoundingClientRect().width) : null,
    bubbleW: bubble0 ? mm(bubble0.getBoundingClientRect().width) : null,
    lineCount: document.querySelectorAll('.as-choice-line').length,
    colCount: document.querySelectorAll('.as-choice-col').length,
    colInfo,
    fontSun: cs.getPropertyValue('--font-sun').trim(),
    fontHei: cs.getPropertyValue('--font-hei').trim(),
    titleMainFont: (() => { const e = document.querySelector('.as-title-main');
      if (!e) return null; const c = getComputedStyle(e);
      return { family: c.fontFamily, size: c.fontSize, color: c.color }; })(),
    choiceNumFont: (() => { const e = document.querySelector('.as-choice-num');
      if (!e) return null; const c = getComputedStyle(e);
      return { family: c.fontFamily, size: c.fontSize, color: c.color }; })(),
    sectionTitleFont: (() => { const e = document.querySelector('.as-section-title');
      if (!e) return null; const c = getComputedStyle(e);
      return { family: c.fontFamily, size: c.fontSize, color: c.color }; })(),
    corners: q('.as-corner'),
    topMarks: q('.as-mark-top'),
    leftMarks: q('.as-mark-left'),
    bubbles: q('.as-bubble').filter(b => !b.w || b.w > 0.5),
    choiceGrid: q('.as-choice-grid'),
    choiceHeader: q('.as-choice-header'),
    title: q('.as-title-main'),
    note: q('.as-note'),
    checkBoxes: q('.as-check-box'),
    barcode: q('.as-barcode')
  };
})()`;

const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
log('RESULT_KEYS = ' + JSON.stringify({
  hasResult: !!res.result, hasResultResult: !!(res.result && res.result.result),
  type: res.result && res.result.result && res.result.result.type,
  hasValue: !!(res.result && res.result.result && 'value' in res.result.result),
  exc: !!(res.result && res.result.exceptionDetails),
  top: Object.keys(res || {})
}).slice(0, 500));
if (res.result?.exceptionDetails) {
  log('EXCEPTION = ' + JSON.stringify(res.result.exceptionDetails).slice(0, 1000));
}
const D = res.result?.result?.value;
if (!D || D.error) { log('EVAL FAILED', JSON.stringify(res).slice(0, 800)); }
else {
  log(`page: ${D.pageW} x ${D.pageH} mm   (zoom-corrected)`);
  log(`innerW=${D.innerW}`);
  log(`innerHTML head: ${(D.innerHTMLHead || '').replace(/\s+/g, ' ').slice(0, 260)}`);
  log(`rowGeom = ${JSON.stringify(D.rowGeom, null, 1)}`);
  log(`geomPred = ${JSON.stringify(D.geomPred)}`);
  log(`chain = ${JSON.stringify(D.chain, null, 1)}`);
  log(`rects = ${JSON.stringify(D.rects, null, 1)}`);
  log(`innerHTMLFull = ${(D.innerHTMLFull || '').replace(/\s+/g, ' ')}`);
  log(`offsetProbe = ${JSON.stringify(D.offsetProbe, null, 1)}`);
  log(`leftMarkYs = ${JSON.stringify(D.leftMarkYs)}`);
  log(`rowCentersDom = ${JSON.stringify(D.rowCentersDom)}`);
  log(`geomLive = ${JSON.stringify(D.geomLive)}`);
  log(`headerProbe = ${JSON.stringify(D.headerProbe)}`);
  log(`gridProbe = ${JSON.stringify(D.gridProbe)}`);
  log(`cbProbe = ${JSON.stringify(D.cbProbe)}`);
  log(`padProbe = ${JSON.stringify(D.padProbe)}`);
  log(`blocksLive = ${JSON.stringify(D.blocksLive)}`);
  log(`detail = ${JSON.stringify(D.detail, null, 1)}`);
  if (D.rowGeom && D.geomPred) {
    const st = D.geomPred.secTop;
    log('');
    log('  PREDICTED (secTop + off) vs ACTUAL row centers');
    const pred = D.geomPred.rowOffsets.map(o => Math.round((st + o) * 1000) / 1000);
    const act = [D.rowGeom.nums.cy].concat(D.rowGeom.rows.map(r => r.cy));
    pred.forEach((p, i) => {
      const a = act[i];
      const d = (a === undefined) ? NaN : Math.round((a - p) * 1000) / 1000;
      log(`   row${i}: pred=${p} actual=${a} diff=${d}`);
    });
  }
  log('');
  log(`GROUPS = ${D.groups}`);
  log(`choice.build src = ${D.choiceBuildSrc}`);
  log(`--step=${D.stepVar}  --block-w=${D.blockWVar}  bubbleW=${D.bubbleW}  optrowW=${D.optrowW}`);
  log(`lines=${D.lineCount}  cols=${D.colCount}`);
  log('first line columns:');
  (D.colInfo || []).forEach((c, i) => {
    log(`  col${i}: x=${c.x} w=${c.w}`);
    log(`     nums    = ${c.nums.join(',')}`);
    log(`     numXs   = ${c.numXs.join(', ')}`);
    log(`     bubbleXs= ${c.bubbleXs.join(', ')}`);
  });
  log(`--font-sun = ${D.fontSun}`);
  log(`--font-hei = ${D.fontHei}`);
  log(`title font   : ${JSON.stringify(D.titleMainFont)}`);
  log(`choice num   : ${JSON.stringify(D.choiceNumFont)}`);
  log(`section title: ${JSON.stringify(D.sectionTitleFont)}`);
  log('');
  log('corners:');
  D.corners.forEach(c => log(`   x=${c.x} y=${c.y} w=${c.w} h=${c.h}  center=(${c.cx}, ${c.cy})`));
  log('');
  log(`topMarks (n=${D.topMarks.length}):`);
  D.topMarks.slice(0, 6).forEach(m => log(`   cx=${m.cx} cy=${m.cy} w=${m.w} h=${m.h}`));
  log(`   ... last cx=${D.topMarks.at(-1)?.cx} cy=${D.topMarks.at(-1)?.cy}`);
  log('');
  log(`leftMarks (n=${D.leftMarks.length}):`);
  D.leftMarks.forEach(m => log(`   cx=${m.cx} cy=${m.cy} w=${m.w} h=${m.h}`));
  log('');
  log(`bubbles (n=${D.bubbles.length}): first 12`);
  D.bubbles.slice(0, 12).forEach(b => log(`   cx=${b.cx} cy=${b.cy} w=${b.w} h=${b.h}`));
  log('');
  log('choiceGrid :', JSON.stringify(D.choiceGrid));
  log('choiceHeader:', JSON.stringify(D.choiceHeader));
  log('title      :', JSON.stringify(D.title));
  log('note       :', JSON.stringify(D.note));
  log('checkBoxes :', JSON.stringify(D.checkBoxes));
  log('barcode    :', JSON.stringify(D.barcode));

  // ── assertions ──
  log('');
  log('='.repeat(70));
  log('ALIGNMENT ASSERTIONS (from real browser layout)');
  log('='.repeat(70));
  /* 容差 0.02mm：用于「同一坐标系内」的比对（角标 vs 定标块、题号 vs 气泡、
     节距 vs preset.step）—— 这些由同一份 mm 坐标产出，误差只有浮点抖动。

     横向「定标块 vs 气泡」单独用 0.1mm：
     气泡位于 .as-choice-outer → .as-choice-inner → grid 三层盒模型里，
     每层 padding 都会被 Chrome 吸附到整设备像素（1px = 0.2646mm），
     实测稳定残留 0.075~0.079mm。这已经是布局引擎的取整下限，
     不是坐标算错 —— 150dpi 下约 1/2 个设备像素，印刷不可见。 */
  const tol = 0.02;
  const tolBoxChain = 0.1;
  const corner = D.corners[0];
  const tm = D.topMarks[0], lm = D.leftMarks[0];
  // 只取「选择区网格」里的气泡：页面顶部（y<200）且在 .as-choice-grid 内
  const gridBubbles = (D.gridBubbles || []);
  const ck = (name, a, b) => log(`  ${name.padEnd(52)} ${a} vs ${b}  ${Math.abs(a-b)<tol?'OK':'** MISMATCH **'}`);
  if (corner && tm) ck('角标中心y == 顶部块心y', corner.cy, tm.cy);
  if (corner && lm) ck('角标中心x == 左侧块心x', corner.cx, lm.cx);
  if (tm && gridBubbles.length) {
    /* ⚠ A3 一页三面：gridBubbles 里混了三面的气泡，跨面去重后列距会是
       「面宽」级别的假距离。所以**按面分组**，只用第一面的列心。 */
    const faceOf = (x) => Math.floor(x / (D.faceW || D.pageW));
    const byFace = new Map();
    gridBubbles.forEach(b => {
      const k = faceOf(b.cx);
      if (!byFace.has(k)) byFace.set(k, []);
      byFace.get(k).push(b);
    });
    const f0 = [...byFace.keys()].sort((a,b)=>a-b)[0];
    const faceBubbles = byFace.get(f0);
    const colCenters = [...new Set(faceBubbles.map(b => b.cx))].sort((a,b)=>a-b);
    /* 第一面的定标块 */
    const marksSorted = D.topMarks.map(m => m.cx)
      .filter(x => faceOf(x) === f0).sort((a,b)=>a-b);
    const secondMark = marksSorted[1];
    /* 第一列 vs 第二块：容差用 0.1mm —— 气泡在三层盒模型里，Chrome 会把
       padding 吸附到整设备像素（0.2646mm），实测稳定残留 0.074mm。 */
    log(`  ${'选择题第一列心 == 第二个顶部定标块心'.padEnd(52)} ` +
        `${colCenters[0]} vs ${secondMark}  ` +
        `${Math.abs(colCenters[0] - secondMark) < tolBoxChain ? 'OK' : '** MISMATCH **'}` +
        `  (容差 ${tolBoxChain}mm，盒模型取整)`);
    log(`     定标块数 ${marksSorted.length}   第一块 ${marksSorted[0]}   ` +
        `第二块 ${secondMark}   第一列 ${colCenters[0]}`);
    log(`     气泡列心(前6): ${colCenters.slice(0,6).join(', ')}`);
    const d = colCenters.slice(1,8).map((v,i)=>Math.round((v-colCenters[i])*1000)/1000);
    log(`     气泡列距: ${d.join(', ')}`);
    /* 定标带节距 == 气泡列距 */
    if (marksSorted.length > 2) {
      const md = Math.round((marksSorted[1] - marksSorted[0]) * 1000) / 1000;
      log(`  ${'定标带节距 == 气泡列距'.padEnd(52)} ${md} vs ${d[0]}  ` +
          `${Math.abs(md - d[0]) < 0.1 ? 'OK' : '** MISMATCH **'}`);
    }
    /* 首末方块与顶角大方块的空隙 == 方块之间的空隙（用户指定）。
       顶角大方块**外缘**：左角标右缘 = cx + w/2；右角标左缘 = cx − w/2。
       第一面左右两个角标心 x 对称（8.973 / 纸宽−8.973），所以不依赖
       「取第几个角标」，直接按对称算。 */
    const fw0 = D.faceWmm || D.faceW || D.pageW;
    /* 面内坐标下的左角标**外缘**。
       ⚠ 角标中心 x = preset.cornerInsetX，半宽 = **cornerW/2**（= 3.385），
         不是 blockW/2（那是**小方块**的半宽 2.03）。
         用 blockW/2 会把角标外缘算到 11.005，端空隙假报成 3.6mm。
       所以外缘 = cornerInsetX + cornerW/2 = 8.975 + 3.385 = 12.36。 */
    const P0 = { cornerInsetX: D.cornerInsetXmm,
                 cornerW: D.cornerWmm, blockW: D.blockWmm };
    const cornerRight = P0.cornerInsetX + P0.cornerW / 2;
    const cornerLeft = fw0 - P0.cornerInsetX - P0.cornerW / 2;
    if (marksSorted.length > 2) {
      const midGap = (marksSorted[1] - marksSorted[0]) - tm.w;
      const gapL = (marksSorted[0] - tm.w / 2) - cornerRight;
      const gapR = cornerLeft - (marksSorted[marksSorted.length - 1] + tm.w / 2);
      log(`  ${'端空隙 == 块间空隙'.padEnd(52)} L=${Math.round(gapL*1000)/1000} ` +
          `R=${Math.round(gapR*1000)/1000} 块间=${Math.round(midGap*1000)/1000}  ` +
          `${(Math.abs(gapL-midGap) < 0.3 && Math.abs(gapR-midGap) < 0.3) ? 'OK' : '** MISMATCH **'}`);
      log(`     角标右缘 ${Math.round(cornerRight*1000)/1000}  首块左缘 ` +
          `${Math.round((marksSorted[0]-tm.w/2)*1000)/1000}  末块右缘 ` +
          `${Math.round((marksSorted[marksSorted.length-1]+tm.w/2)*1000)/1000}  ` +
          `角标左缘 ${Math.round(cornerLeft*1000)/1000}`);
    }
  }
  if (tm) ck('顶部块尺寸 == 气泡尺寸(w)', tm.w, gridBubbles[0]?.w);
  if (tm) ck('顶部块尺寸 == 气泡尺寸(h)', tm.h, gridBubbles[0]?.h);
  if (lm) ck('左侧块尺寸 == 气泡尺寸(w)', lm.w, gridBubbles[0]?.w);
  // 左侧定标带的每一块都必须与「题号行」或「某个气泡行」共线
  const rowCenters = [...new Set(gridBubbles.map(b => b.cy))].sort((a,b)=>a-b);
  const numRowCenters = D.numRowCenters || [];
  /* 缺考框所在的行也必须有左侧定标块，它不算「题号/气泡」行，
     但一样是合法的对齐目标 —— 漏掉它会把正确的块报成 MISMATCH。 */
  const specialRowCenters = (D.checkBoxes || []).map(cb => cb.cy);
  const allRowCenters = [...new Set(
    rowCenters.concat(numRowCenters).concat(specialRowCenters))].sort((a,b)=>a-b);
  log(`     题号行心: ${numRowCenters.join(', ')}   (n=${numRowCenters.length}, raw=${JSON.stringify(D.numRowCenters)})`);
  log(`     气泡行心: ${rowCenters.slice(0,6).join(', ')}`);
  const lmYs = D.leftMarks.map(m=>m.cy).filter(y => y < 200);
  log(`     左侧块心y: ${lmYs.join(', ')}`);
  /* 纵向同样受盒模型取整影响：A3 的面是按 faceW 缩放排版的（块宽 4.0→3.998mm），
     网格行心与绝对定位的定标块会差 0.04mm 量级。用同一个盒链容差。 */
  const rowMatch = lmYs.every(y => allRowCenters.some(rc => Math.abs(rc-y)<tolBoxChain));
  const worstRow = lmYs.length ? Math.max.apply(null, lmYs.map(y =>
    Math.min.apply(null, allRowCenters.map(rc => Math.abs(rc - y))))) : 0;
  log(`     每个左侧块心都落在某个行心(题号/气泡)上: ${rowMatch ? 'OK' : '** MISMATCH **'}` +
      `  (最大偏差 ${Math.round(worstRow*1000)/1000}mm，容差 ${tolBoxChain}mm)`);
  // 题号行心 == 气泡行心（同一列的题号与气泡必须共列心）
  if (D.detail) {
    ck('题号列心 == 气泡列心(第1题)', D.detail.nums[0].cx, D.detail.bubs[0].cx);
    ck('题号节距 == 气泡节距', D.detail.numPitch, D.detail.bubPitch);
    /* 节距的期望值不再是 preset.step（它现在是 null / 由带子反推）。
       改为与**浏览器实测的定标带节距**比 —— 两者必须相等（用户要求
       顶部方块与气泡列节距一致）。 */
    const ms = D.topMarks.map(m => m.cx).sort((a,b)=>a-b);
    const measStep = ms.length > 1 ? Math.round((ms[1]-ms[0])*1000)/1000 : null;
    if (measStep !== null) {
      const fw = D.faceW || D.pageW;
      const f0b = [...new Set(D.bubbles.map(b=>Math.floor(b.cx/fw)))].sort((a,b)=>a-b)[0];
      log(`  ${'列节距 == 实测定标带节距'.padEnd(52)} ${D.detail.bubPitch} vs ${measStep}  ` +
          `${Math.abs(D.detail.bubPitch - measStep) < 0.1 ? 'OK' : '** MISMATCH **'}`);
    }
  }
  if (D.checkBoxes.length) {
    log(`     缺考/示例框: ${JSON.stringify(D.checkBoxes)}`);
    D.checkBoxes.forEach(cb => {
      const hit = lmYs.some(y => Math.abs(y-cb.cy)<0.6);
      log(`       框cy=${cb.cy} 有对齐的左侧块: ${hit ? 'OK' : '** NONE **'}`);
    });
  }
}

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
ws.close();
chrome.kill();
process.exit(0);
