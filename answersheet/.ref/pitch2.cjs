const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9557;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(4500);
  const E = `(() => {
    const S = window.AS.subject;
    const st = document.querySelector('.preview-stage');
    st.style.transform = 'none';
    /* 用**真实卡片**的父容器宽度，把单题表格挂进去量（不用脱离流量的隐藏 host） */
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:175.99mm;background:#fff';
    document.body.appendChild(host);
    const probe = document.querySelector('.preview-stage .as-page');
    const S2 = probe ? probe.getBoundingClientRect().width / 210 : 1;
    const mm = v => Math.round((v / S2) * 1000) / 1000;
    const out = [];
    [1, 2, 3, 4, 6, 8, 10, 12, 16].forEach(function (n) {
      host.innerHTML = S.render([{ no: 13, score: 10, lines: n, scoreShow: true }],
        { lineH: 7.7008, showHeader: false, pageTip: false, tailExtra: 0, frameH: 0 });
      const outer = host.querySelector('.as-subject-outer');
      const tab = host.querySelector('.as-subject-inner-table');
      const body = host.querySelector('.as-subj-body');
      out.push({
        lines: n,
        model: S.itemHeight(n, 7.7008),
        bodyCSS: mm(body.getBoundingClientRect().height),
        bodyDeclared: body.style.height,
        table: mm(tab.getBoundingClientRect().height),
        outer: mm(outer.getBoundingClientRect().height)
      });
    });
    host.remove();
    return { S2: S2, lineVar: getComputedStyle(st).getPropertyValue('--answer-line-h'), out: out,
      rowOverhead: S.ROW_OVERHEAD, headH: S.HEAD_H, cellPad: S.cellPad() };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const d = r.result.result.value;
    console.log('S2(px/mm)=' + d.S2 + '  --answer-line-h=' + d.lineVar.trim() +
                '  ROW_OVERHEAD=' + d.rowOverhead + '  HEAD_H=' + d.headH + '  cellPad=' + d.cellPad);
    console.log('');
    console.log('lines  model    bodyCSS  bodyDecl  table    outer    table-model  outer-table');
    d.out.forEach(x => console.log(
      String(x.lines).padEnd(6) + String(x.model).padEnd(9) +
      String(x.bodyCSS).padEnd(9) + String(x.bodyDeclared).padEnd(10) +
      String(x.table).padEnd(9) + String(x.outer).padEnd(9) +
      String(Math.round((x.table - x.model) * 1000) / 1000).padEnd(13) +
      String(Math.round((x.outer - x.table) * 1000) / 1000)));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
