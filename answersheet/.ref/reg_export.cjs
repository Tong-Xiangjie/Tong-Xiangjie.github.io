const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 9657);
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out', 'reg');
mkdirSync(outDir, { recursive: true });
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };

/* 回归用的配置表：覆盖 A4/A3、双色/黑白、普通/超多题、末页非答题区/续排 */
const CASES = JSON.parse(process.env.CASES || JSON.stringify([
  { id: 'a4-color-12+2',   format: 'A4', theme: 'color', choiceTotal: 12, subjCount: 2, lines: 6 },
  { id: 'a4-mono-0+3',     format: 'A4', theme: 'mono',  choiceTotal: 0,  subjCount: 3, lines: 8 },
  { id: 'a4-color-40+4',   format: 'A4', theme: 'color', choiceTotal: 40, subjCount: 4, lines: 6 },
  { id: 'a4-color-300+4',  format: 'A4', theme: 'color', choiceTotal: 300, subjCount: 4, lines: 5 },
  { id: 'a4-mono-15+1',    format: 'A4', theme: 'mono',  choiceTotal: 15, subjCount: 1, lines: 12 },
  { id: 'a3-color-40+4',   format: 'A3', theme: 'color', choiceTotal: 40, subjCount: 4, lines: 8 },
  { id: 'a3-mono-90+6',    format: 'A3', theme: 'mono',  choiceTotal: 90, subjCount: 6, lines: 6 }
]));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 900000);

(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 400));
    }
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
    const q = await send('Runtime.evaluate',
      { expression: 'typeof (window.AS && window.AS.app && window.AS.app.exportPdf)',
        returnByValue: true }, 10000);
    rdy = q.result?.result?.value === 'function';
  }
  say('页面就绪 =', rdy);
  if (!rdy) { clearTimeout(HARD); try { chrome.kill(); } catch {} process.exit(4); }

  /* 拦下 a.click() 触发的下载：改成把 dataURI 存到一个全局，
     免得真的落盘（也免得 headless 的下载行为干扰）。 */
  await send('Runtime.evaluate', { expression: `
    (() => {
      if (window.__dlHooked) return 1;
      window.__dlHooked = 1;
      window.__dl = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.href && this.href.slice(0, 5) === 'data:') {
          window.__dl.push({ name: this.download, uri: this.href });
          return;
        }
        return orig.apply(this, arguments);
      };
      window.__alertMsg = null;
      window.alert = function (m) { window.__alertMsg = String(m); };
      return 2;
    })()
  `, returnByValue: true }, 10000);

  const results = [];
  for (const c of CASES) {
    logs.length = 0;
    const expr = `(async () => {
      const d = document;
      const set=(i,v)=>{const e=d.getElementById(i);if(e) e.value=v;};
      window.__dl.length = 0; window.__alertMsg = null;
      const seg = d.querySelector('#segFormat button[data-val="${c.format}"]'); if (seg) seg.click();
      const th = d.querySelector('#themePick [data-theme="${c.theme}"]'); if (th) th.click();
      set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
      set('choiceTotal','${c.choiceTotal}'); set('choiceStart','1');
      set('subjStart','${c.choiceTotal + 1}'); set('subjCount','${c.subjCount}');
      set('subjScore','${new Array(c.subjCount).fill('10').join(',')}');
      set('subjLines','${c.lines}');
      d.getElementById('btnGenerate').click();
      await new Promise(r => setTimeout(r, 2600));
      const st = d.getElementById('stage');
      const faces = st.querySelectorAll('.as-page');
      const noAns = st.querySelectorAll('.as-noanswer').length;
      d.getElementById('btnPdf').click();
      const t0 = Date.now();
      while (!window.__dl.length && Date.now() - t0 < 90000) await new Promise(r => setTimeout(r, 200));
      if (!window.__dl.length) return { id: '${c.id}', FAIL: '90 秒内没有产出 PDF',
        alert: window.__alertMsg, domPages: faces.length };
      const uri = window.__dl[0].uri;
      return { id: '${c.id}', name: window.__dl[0].name,
        bytes: Math.round((uri.length - uri.indexOf(',') - 1) * 0.75),
        uri: uri,
        domPages: faces.length,
        noanswer: noAns,
        alert: window.__alertMsg };
    })()`;
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, 150000);
    const v = r.result?.result?.value;
    if (!v) {
      say('CASE %s 无输出：%s', c.id, JSON.stringify(r.result?.exceptionDetails || r).slice(0, 400));
      results.push({ id: c.id, FAIL: 'no result' });
      continue;
    }
    if (v.uri) {
      const buf = Buffer.from(v.uri.split(',')[1], 'base64');
      writeFileSync(join(outDir, c.id + '.pdf'), buf);
      delete v.uri;
      v.saved = c.id + '.pdf';
    }
    results.push(v);
    say('CASE %-16s pages(dom)=%s noanswer=%s bytes=%s alert=%s',
      c.id, v.domPages, v.noanswer, v.bytes, v.alert ? String(v.alert).slice(0, 60) : '-');
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
  say('\n=== 结果 ===');
  say(JSON.stringify(results, null, 1));
  const errs = logs.filter(l => /EXC|失败|退回位图/.test(l));
  if (errs.length) { say('控制台异常：'); errs.slice(-10).forEach(l => say('  ' + l.slice(0, 260))); }
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
