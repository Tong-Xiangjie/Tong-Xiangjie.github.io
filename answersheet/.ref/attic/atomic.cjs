const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9665;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD'); try { chrome.kill(); } catch {} process.exit(3); }, 300000);
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
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 60000).then(() => ({ __to: true }))]);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() }, 30000);
  let rdy = false;
  for (let i = 0; i < 60 && !rdy; i++) {
    await sleep(400);
    const q = await send('Runtime.evaluate', { expression: 'typeof (window.AS && window.AS.pdfVector)', returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'object';
  }
  say('ready =', rdy);
  if (!rdy) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }
  const expr = `(async () => {
    const d = document;
    const set=(i,v)=>{const e=d.getElementById(i);if(e) e.value=v;};
    d.querySelector('#segFormat button[data-val="A4"]').click();
    d.querySelector('#themePick [data-theme="color"]').click();
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    d.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2800));
    const st = d.getElementById('stage');
    const paper = AS.config.PAPER.A4;
    const pageEl = st.querySelector('.as-page');
    /* 1) 拿绘制清单（不复用任何缓存） */
    const M = AS.pdfMeasure.measurePage(pageEl, paper);
    /* 2) 生成 PDF，并在**同一会话**里把内容流里的矩形解出来 */
    const r = await AS.pdfVector.render({ stage: st, format: 'A4', theme: 'color' });
    const uri = r.pdf.output('datauristring');
    const b64 = uri.slice(uri.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    /* 极简 PDF 扫描：找 page 1 的 re 操作符。
       这里不做解压 —— jsPDF 的内容流是未压缩的（compress 只压字体/图像流）。 */
    let txt = '';
    for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
    const firstPageEnd = txt.indexOf('/Type /Page');
    const streams = [];
    const sre = /stream\\r?\\n/g; let mm2;
    while ((mm2 = sre.exec(txt)) !== null) {
      const e = txt.indexOf('endstream', mm2.index);
      streams.push(txt.slice(mm2.index + mm2[0].length, e));
    }
    const MM = 72 / 25.4, PH = 841.8898;
    const got = [];
    streams.forEach(function (s, si) {
      if (!/ re/.test(s)) return;
      const rex = /(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+re\\b/g;
      let q;
      while ((q = rex.exec(s)) !== null) {
        const x = +q[1], y = +q[2], w = +q[3], h = +q[4];
        got.push({ s: si, x: x / MM, y: (PH - y) / MM, w: Math.abs(w) / MM, h: Math.abs(h) / MM });
      }
    });
    const want = M.fills.map(function (o) { return { cls: o.cls, x: o.x, y: o.y, w: o.w, h: o.h }; })
      .concat(M.strokes.map(function (o) {
        const lw = o.lw || 0.3;
        return { cls: o.cls, x: o.x + lw / 2, y: o.y + lw / 2,
                 w: Math.max(0, o.w - lw), h: Math.max(0, o.h - lw) };
      }));

    /* 3) 按**页**配对：清单每一页的矩形数应当正好等于某个流的矩形数。
          不假设页序与流序一致 —— 按「条数相等」把页与流绑定，再逐条比。 */
    const pages = [
      M.fills.map(function (o) { return { cls: o.cls, x: o.x, y: o.y, w: o.w, h: o.h }; })
        .concat(M.strokes.map(function (o) {
          const lw = o.lw || 0.3;
          return { cls: o.cls, x: o.x + lw / 2, y: o.y + lw / 2,
                   w: Math.max(0, o.w - lw), h: Math.max(0, o.h - lw) };
        }))
    ];
    /* 默认只比第 1 面；把每页都算出来（调用方按需取） */
    const pageEls = st.querySelectorAll('.as-page');
    for (let i = 1; i < pageEls.length; i++) {
      const Mi = AS.pdfMeasure.measurePage(pageEls[i], paper);
      pages.push(Mi.fills.map(function (o) { return { cls: o.cls, x: o.x, y: o.y, w: o.w, h: o.h }; })
        .concat(Mi.strokes.map(function (o) {
          const lw = o.lw || 0.3;
          return { cls: o.cls, x: o.x + lw / 2, y: o.y + lw / 2,
                   w: Math.max(0, o.w - lw), h: Math.max(0, o.h - lw) };
        })));
    }
    const streamRects = streams.map(function (s) {
      const out = [];
      if (!/ re/.test(s)) return out;
      const rex = /(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+re\\b/g;
      let q;
      while ((q = rex.exec(s)) !== null) {
        out.push({ x: +q[1] / MM, y: (PH - +q[2]) / MM,
                   w: Math.abs(+q[3]) / MM, h: Math.abs(+q[4]) / MM });
      }
      return out;
    });

    const byClass = {};
    let maxd = 0, unmatched = 0, matched = 0, total = 0;
    const pageReport = [];
    for (let pi = 0; pi < pages.length; pi++) {
      /* 找到条数相等的流 */
      let si = -1;
      for (let j = 0; j < streamRects.length; j++) {
        if (streamRects[j].length === pages[pi].length) { si = j; break; }
      }
      if (si < 0) {
        pageReport.push({ page: pi, want: pages[pi].length,
                          streams: streamRects.map(function (r) { return r.length; }),
                          bound: null });
        continue;
      }
      const got = streamRects[si];
      const used = new Array(got.length).fill(false);
      let pd = 0, pu = 0;
      pages[pi].forEach(function (u) {
        total++;
        let bi = -1, bd = null;
        for (let j = 0; j < got.length; j++) {
          if (used[j]) continue;
          const g = got[j];
          const dd = Math.max(Math.abs(u.x - g.x), Math.abs(u.y - g.y),
                              Math.abs(u.w - g.w), Math.abs(u.h - g.h));
          if (bd === null || dd < bd) { bi = j; bd = dd; if (dd === 0) break; }
        }
        if (bi < 0 || bd > 0.02) { pu++; unmatched++; return; }
        used[bi] = true; matched++;
        const g = got[bi];
        pd = Math.max(pd, bd);
        const k = (u.cls || '?') + '|dx' + (g.x - u.x).toFixed(3) + '|dy' + (g.y - u.y).toFixed(3);
        byClass[k] = (byClass[k] || 0) + 1;
      });
      pageReport.push({ page: pi, want: pages[pi].length, stream: si,
                        streamCount: got.length, unmatched: pu,
                        maxDev: +pd.toFixed(4) });
      maxd = Math.max(maxd, pd);
    }
    return {
      appearStreams: r.stats,
      streamRectCounts: streamRects.map(function (r) { return r.length; }),
      pages: pages.map(function (p) { return p.length; }),
      total: total, matched: matched, unmatched: unmatched,
      maxDevMM: +maxd.toFixed(4), pageReport: pageReport, deltas: byClass
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 240000);
  const v = r.result?.result?.value;
  if (!v) {
    say('EXC =', JSON.stringify(r.result?.exceptionDetails || r).slice(0, 900));
  } else {
    say('清单各页 = ' + JSON.stringify(v.pages));
    say('流矩形数 = ' + JSON.stringify(v.streamRectCounts));
    say('合计 want=%d matched=%d unmatched=%d maxDev=%s mm',
      v.total, v.matched, v.unmatched, v.maxDevMM);
    say('逐页 = ' + JSON.stringify(v.pageReport));
    say('流统计 = ' + JSON.stringify(v.appearStreams));
    say('偏差分布：');
    Object.keys(v.deltas).sort().forEach(k => say('   %-46s %d', k, v.deltas[k]));
  }
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
