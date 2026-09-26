/* 用矢量导出那条链路（已由 DOM 真值验证过）列出「每面有哪些元素、各在哪」，
   用来核对第 2 面 y 244-255 / x 105-189 那一带到底该有什么。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP = 9671;
const profile = mkdtempSync(join(tmpdir(), 'asinsp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); chrome.kill(); process.exit(3); }, 180000);

(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await raw('Runtime.enable'); await raw('Page.enable');
  await raw('Page.navigate', { url: `http://127.0.0.1:8137/index.html?insp=${Date.now()}` });

  let ok = false;
  for (let i = 0; i < 140 && !ok; i++) {
    const r = await raw('Runtime.evaluate', {
      expression: `!!(window.AS && AS.pdfMeasure && document.getElementById('btnGenerate'))`,
      returnByValue: true
    });
    ok = !!r.result?.result?.value;
    if (!ok) await sleep(250);
  }
  if (!ok) { say('未就绪'); ws.close(); chrome.kill(); process.exit(1); }

  const expr = `(async () => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '物理');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '2'); set('subjScore', '10,10');
    document.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2600));

    const PXMM = 96 / 25.4;
    const pgs = document.querySelectorAll('.as-page');
    const res = { pages: pgs.length, detail: [] };
    for (let i = 0; i < pgs.length; i++) {
      const pg = pgs[i];
      const st = pg.closest('.preview-stage') || pg.parentNode;
      const sT = st.style.transform, sW = st.style.width;
      st.style.transform = 'none'; st.style.width = 'auto';
      void st.offsetHeight;
      const pr = pg.getBoundingClientRect();
      const items = [];
      pg.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        const y0 = (b.top - pr.top) / PXMM, y1 = (b.bottom - pr.top) / PXMM;
        const x0 = (b.left - pr.left) / PXMM, x1 = (b.right - pr.left) / PXMM;
        // 只收第 2 面 y 243..256 这一带 / 或整面的大块
        if (i === 1 && (y1 > 240 && y0 < 258)) {
          items.push({ cls: String(el.className).slice(0, 34),
                       x: [+x0.toFixed(1), +x1.toFixed(1)],
                       y: [+y0.toFixed(1), +y1.toFixed(1)],
                       txt: (el.textContent || '').trim().slice(0, 24) });
        }
      });
      st.style.transform = sT; st.style.width = sW;
      res.detail.push({ page: i + 1, n: items.length, items: items.slice(0, 14) });
    }
    return res;
  })()`;

  const r = await raw('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
  const v = r.result?.result?.value;
  if (!v) say('EVAL 失败:', JSON.stringify(r.result?.exceptionDetails || r).slice(0, 800));
  else {
    say('总面数', v.pages);
    v.detail.forEach(d => {
      say(`\n第 ${d.page} 面 y240-258 带内元素 ${d.n} 个：`);
      d.items.forEach(it => say(`   ${String(it.cls).padEnd(34)} x ${it.x[0]}-${it.x[1]}  y ${it.y[0]}-${it.y[1]}  "${it.txt}"`));
    });
  }
  clearTimeout(HARD); ws.close(); chrome.kill();
})();
