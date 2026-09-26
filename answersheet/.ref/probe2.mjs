/* 直接问浏览器：一个绝对定位子元素放在 .as-choice-outer 里，top:0 落在哪？ */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'asprobe-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const t = (await r.json()).find(x => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('no devtools');
}
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(4000);

const EXPR = `(() => {
  const outer = document.querySelector('.as-choice-outer');
  if (!outer) return { err: 'no outer' };
  const sec = outer.closest('.as-choice-section');
  const scale = (() => {
    const st = outer.closest('.preview-stage');
    const m = st ? getComputedStyle(st).transform : 'none';
    if (!m || m === 'none') return 1;
    const p = m.match(/matrix\\(([^,]+)/); return p ? parseFloat(p[1]) : 1;
  })();
  const mm = (v) => Math.round(v * 25.4 / 96 / scale * 1000) / 1000;

  const pageTop = (el) => {
    const p = el.closest('.as-page');
    const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
    return (a.top - b.top) / scale;
  };

  const out = {
    scale: scale,
    secTop: mm(pageTop(sec) * 96 / 25.4 * scale) ,
    outerTopMM: Math.round(pageTop(outer) * 25.4 / 96 * 1000) / 1000
  };
  // 修正：直接用 px 换算
  const toMM = (px) => px * 25.4 / 96 / scale;
  out.secTopMM = Math.round(toMM(sec.getBoundingClientRect().top - sec.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  out.outerTopMM = Math.round(toMM(outer.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;

  const os = getComputedStyle(outer);
  out.outer = { position: os.position, borderTop: os.borderTopWidth, padTop: os.paddingTop, boxSizing: os.boxSizing };

  // 造一个绝对定位探针，看看 top:0 落在哪
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
  outer.appendChild(probe);
  const probeTop = toMM(probe.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top);
  out.probeAbsTopMM = Math.round(probeTop * 1000) / 1000;
  probe.style.top = '5mm';
  const probe5 = toMM(probe.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top);
  out.probeAbs5MM = Math.round(probe5 * 1000) / 1000;
  // 探针的 offsetParent 是谁？
  out.probeOffsetParent = probe.offsetParent ? (probe.offsetParent.className || probe.offsetParent.tagName) : null;
  out.probeOffsetTopPx = probe.offsetTop;
  probe.remove();

  // 普通流子元素（栏目头）落在哪
  const hdr = outer.querySelector('.as-choice-header');
  if (hdr) out.headerTopMM = Math.round(toMM(hdr.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  const innerEl = outer.querySelector('.as-choice-inner');
  if (innerEl) out.innerTopMM = Math.round(toMM(innerEl.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;

  // 直接问：以 .as-choice-section 为定位祖先时，绝对定位子元素 top:0 落在哪？
  const sp = document.createElement('div');
  sp.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
  sec.appendChild(sp);
  out.secAbs0MM = Math.round(toMM(sp.getBoundingClientRect().top - sec.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  sp.style.top = '5mm';
  out.secAbs5MM = Math.round(toMM(sp.getBoundingClientRect().top - sec.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  out.secOffsetParent = sp.offsetParent ? (sp.offsetParent.className || sp.offsetParent.tagName) : null;
  sp.remove();
  const ss = getComputedStyle(sec);
  out.sec = { position: ss.position, padTop: ss.paddingTop, borderTop: ss.borderTopWidth, top: ss.top, marginTop: ss.marginTop };

  /* 横向：黑框（.as-choice-inner）的内边距盒左缘、网格左缘、第一列气泡左缘 */
  const pageL = (el) => toMM(el.getBoundingClientRect().left - el.closest('.as-page').getBoundingClientRect().left);
  const innerEl2 = outer.querySelector('.as-choice-inner');
  const gridEl = outer.querySelector('.as-choice-grid');
  const bub = outer.querySelector('.as-bubble');
  const num0 = outer.querySelector('.as-choice-num');
  const is = innerEl2 ? getComputedStyle(innerEl2) : null;
  out.innerBox = innerEl2 ? {
    attr: innerEl2.getAttribute('style'),
    topMM: Math.round(toMM(innerEl2.getBoundingClientRect().top - innerEl2.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000,
    contentTopMM: (() => {
      /* 在 inner 里塞一个静态块，量它的上缘 = inner 的内容盒上缘 */
      const t = document.createElement('div');
      t.style.cssText = 'height:0;margin:0;padding:0;border:0;';
      innerEl2.insertBefore(t, innerEl2.firstChild);
      const y = toMM(t.getBoundingClientRect().top - innerEl2.closest('.as-page').getBoundingClientRect().top);
      t.remove();
      return Math.round(y * 1000) / 1000;
    })(),
    padTop: is.paddingTop, padLeft: is.paddingLeft,
    borderTop: is.borderTopWidth, boxSizing: is.boxSizing, height: is.height
  } : null;
  out.horiz = {
    secLeftMM: Math.round(pageL(sec) * 1000) / 1000,
    outerLeftMM: Math.round(pageL(outer) * 1000) / 1000,
    innerLeftMM: innerEl2 ? Math.round(pageL(innerEl2) * 1000) / 1000 : null,
    innerBorderLeft: is ? is.borderLeftWidth : null,
    innerPadLeft: is ? is.paddingLeft : null,
    gridLeftMM: gridEl ? Math.round(pageL(gridEl) * 1000) / 1000 : null,
    gridLeftComputed: gridEl ? getComputedStyle(gridEl).left : null,
    gridMarginLeft: gridEl ? getComputedStyle(gridEl).marginLeft : null,
    gridAttr: gridEl ? gridEl.getAttribute('style') : null,
    gridPos: gridEl ? getComputedStyle(gridEl).position : null,
    gridParent: gridEl && gridEl.parentElement ? gridEl.parentElement.className : null,
    outerPadLeft: getComputedStyle(outer).paddingLeft,
    outerBorderLeft: getComputedStyle(outer).borderLeftWidth,
    gridRightComputed: gridEl ? getComputedStyle(gridEl).right : null,
    gridWidthMM: gridEl ? Math.round(toMM(gridEl.getBoundingClientRect().width) * 1000) / 1000 : null,
    bubble0LeftMM: bub ? Math.round(pageL(bub) * 1000) / 1000 : null,
    bubble0CxMM: bub ? Math.round((pageL(bub) + toMM(bub.getBoundingClientRect().width) / 2) * 1000) / 1000 : null,
    num0CxMM: num0 ? Math.round((pageL(num0) + toMM(num0.getBoundingClientRect().width) / 2) * 1000) / 1000 : null,
    leftMarkCxMM: (() => { const m = document.querySelector('.as-mark-left'); return m ? Math.round((pageL(m) + toMM(m.getBoundingClientRect().width) / 2) * 1000) / 1000 : null; })(),
    varOuterPadX: getComputedStyle(outer).getPropertyValue('--outer-pad-x').trim(),
    varInnerPadX: is ? is.getPropertyValue('--inner-pad-x').trim() : null,
    varShift: getComputedStyle(outer).getPropertyValue('--grid-shift').trim()
  };

  // 直接问：outer 的 padding box 相对 page 顶在哪？用 clientTop/clientLeft 反推
  out.outerRect = (() => { const r = outer.getBoundingClientRect(); const p = outer.closest('.as-page').getBoundingClientRect();
    return { top: Math.round(toMM(r.top - p.top)*1000)/1000, h: Math.round(toMM(r.height)*1000)/1000,
             clientTop: outer.clientTop, offsetTop: outer.offsetTop,
             parentCls: outer.parentElement.className }; })();

  // 现有 grid
  const g = outer.querySelector('.as-choice-grid');
  if (g) {
    const gs = getComputedStyle(g);
    out.grid = {
      inlineTop: g.style.top, computedTop: gs.top, position: gs.position,
      topMM: Math.round(toMM(g.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000
    };
    const save = g.style.top;
    g.style.top = '0mm';
    out.gridAt0MM = Math.round(toMM(g.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
    g.style.top = '5mm';
    out.gridAt5MM = Math.round(toMM(g.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
    g.style.top = save;
    // 网格里第一行题号
    const nums = g.querySelector('.as-choice-nums');
    if (nums) out.numsTopMM = Math.round(toMM(nums.getBoundingClientRect().top - outer.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  }
  // 左侧第一个定标块
  const mk = document.querySelector('.as-mark-left');
  if (mk) out.firstLeftMarkMM = Math.round(toMM(mk.getBoundingClientRect().top - mk.closest('.as-page').getBoundingClientRect().top) * 1000) / 1000;
  return out;
})()`;
const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
const out = 'PROBE2 = ' + JSON.stringify(r.result?.result?.value, null, 1);
writeFileSync('.ref/probe2.txt', out, 'utf8');
console.log(out);
ws.close(); chrome.kill(); process.exit(0);
