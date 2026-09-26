/* 检查字体是否真的加载（SimHei/SimSun），以及标题是否换行。
   用法：node .ref\font_check.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9367;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
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
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试'); set('cardSubject', '数学');
    set('choiceTotal', '12'); set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    window.AS.app.generate();

    const out = {};
    /* 字体可用性：用 canvas 量同一段文字在「目标字体」与「明显不同字体」下的宽度 */
    const probe = (fam, text, px) => {
      const c = document.createElement('canvas').getContext('2d');
      c.font = px + 'px ' + fam;
      return Math.round(c.measureText(text).width * 100) / 100;
    };
    const T = '2026届高三第一次模拟考试';
    out.fontProbe = {
      SimHei: probe('SimHei', T, 24),
      SimSun: probe('SimSun', T, 24),
      serif: probe('serif', T, 24),
      monospace: probe('monospace', T, 24),
      sans: probe('sans-serif', T, 24)
    };

    const card = document.querySelector('#stage .as-page');
    const t = card.querySelector('.as-title-main');
    const sub = card.querySelector('.as-title-sub');
    const st = card.closest('.preview-stage');
    const m = getComputedStyle(st).transform;
    const k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\\(([^,]+)/) || [0,1])[1]);
    const mm = (v) => Math.round(v * 25.4 / 96 / k * 1000) / 1000;

    const tr = t.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    const rowEl = card.querySelector('.as-head-title');
    const row = rowEl.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(t).lineHeight);
    out.title = {
      text: t.textContent,
      fontFamily: getComputedStyle(t).fontFamily,
      fontSize: getComputedStyle(t).fontSize,
      lineHeightPx: lineH,
      w: mm(tr.width), h: mm(tr.height),
      rowW: mm(row.width), rowH: mm(row.height),
      rowPadTop: mm(parseFloat(getComputedStyle(rowEl).paddingTop)),
      rowMinH: mm(parseFloat(getComputedStyle(rowEl).minHeight)),
      pageTitleVar: card.style.getPropertyValue('--head-title-h'),
      pagePadVar: getComputedStyle(card).getPropertyValue('--head-title-pad-top'),
      mainMT: mm(parseFloat(getComputedStyle(t).marginTop) || 0),
      mainMB: mm(parseFloat(getComputedStyle(t).marginBottom) || 0),
      subMT: mm(parseFloat(getComputedStyle(sub).marginTop) || 0),
      subMB: mm(parseFloat(getComputedStyle(sub).marginBottom) || 0),
      subW: mm(sr.width), subH: mm(sr.height)
    };
    /* 单行需要的宽度：直接量不换行时的宽度 */
    const span = document.createElement('span');
    const cs = getComputedStyle(t);
    span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize +
      ';font-weight:' + cs.fontWeight + ';letter-spacing:' + cs.letterSpacing;
    span.textContent = t.textContent;
    document.body.appendChild(span);
    out.title.singleLineW = mm(span.getBoundingClientRect().width);
    span.textContent = sub.textContent;
    out.title.subSingleLineW = mm(span.getBoundingClientRect().width);
    document.body.removeChild(span);
    out.title.availableW = mm(row.width);
    out.title.wraps = out.title.singleLineW > out.title.availableW;

    /* 注意事项框内部：缺考框与左侧定标块是否同心 */
    const note = card.querySelector('.as-note');
    const cbox = card.querySelector('.as-check-box');
    const noteBottom = card.querySelector('.as-note-bottom');
    const abs = (e) => e ? { t: mm(e.getBoundingClientRect().top - card.getBoundingClientRect().top),
                             b: mm(e.getBoundingClientRect().bottom - card.getBoundingClientRect().top),
                             h: mm(e.getBoundingClientRect().height) } : null;
    out.note = {
      note: abs(note),
      noteBottom: abs(noteBottom),
      checkBox: abs(cbox),
      noteStyleTop: cbox ? cbox.style.top : null,
      bottomH: noteBottom ? getComputedStyle(noteBottom).height : null,
      bottomPos: noteBottom ? getComputedStyle(noteBottom).position : null
    };
    /* 左侧定标块 y 列表 */
    out.leftMarkCy = Array.from(card.querySelectorAll('.as-mark-left')).map(e =>
      Math.round((e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2
        - card.getBoundingClientRect().top) * 25.4 / 96 / k * 1000) / 1000);

    /* JS 侧的权威值 vs DOM */
    const A = window.AS;
    out.special = JSON.parse(JSON.stringify(A.page.SPECIAL));
    out.chrome = JSON.parse(JSON.stringify(A.page.CHROME));
    out.specialRows = A.page.specialRows();
    out.leftMarkSpec = A.__faces[0] ? A.__faces[0].leftMarks.map(m => ({
      kind: m.kind, cy: m.cy, cx: m.cx })) : null;
    out.topMarkCount = A.__faces[0] ? A.__faces[0].topMarks.length : null;
    out.boxDbg = (() => {
      if (!cbox) return null;
      const cs = getComputedStyle(cbox);
      const par = cbox.offsetParent;
      return {
        offsetParent: par ? (par.className || par.tagName) : null,
        styleTop: cbox.style.top,
        computedTop: cs.top,
        borderTop: cs.borderTopWidth,
        boxSizing: cs.boxSizing,
        marginTop: cs.marginTop,
        parentRectTop: par ? mm(par.getBoundingClientRect().top - card.getBoundingClientRect().top) : null,
        selfRectTop: mm(cbox.getBoundingClientRect().top - card.getBoundingClientRect().top),
        parentBorderTop: par ? getComputedStyle(par).borderTopWidth : null,
        parentPadTop: par ? getComputedStyle(par).paddingTop : null
      };
    })();

    /* 页眉三行各自的实测位置 + 解析后的 CSS 变量 */
    const headEl = card.querySelector('.as-head');
    const cs2 = getComputedStyle(card);
    const headRows = Array.from(headEl.children).map(e => ({
      cls: e.className,
      t: mm(e.getBoundingClientRect().top - card.getBoundingClientRect().top),
      b: mm(e.getBoundingClientRect().bottom - card.getBoundingClientRect().top),
      h: mm(e.getBoundingClientRect().height)
    }));
    out.headRows = {
      rows: headRows,
      headTop: mm(headEl.getBoundingClientRect().top - card.getBoundingClientRect().top),
      gridTemplate: getComputedStyle(headEl).gridTemplateRows,
      vars: {
        titleH: cs2.getPropertyValue('--head-title-h').trim(),
        infoH: cs2.getPropertyValue('--head-info-h').trim(),
        noteH: cs2.getPropertyValue('--head-note-h').trim(),
        padTop: cs2.getPropertyValue('--head-title-pad-top').trim()
      },
      noteTopVar: card.style.getPropertyValue('--head-note-h')
    };
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  }
  console.log(JSON.stringify(res.result?.result?.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
