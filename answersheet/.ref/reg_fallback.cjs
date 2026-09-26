const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 8137);
const CDP = Number(process.env.CDP || 9669);
const profile = mkdtempSync(join(tmpdir(), 'asfb-'));
const outDir = join(process.cwd(), '.ref', 'out');
mkdirSync(outDir, { recursive: true });
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 300000);

(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  if (!t) { say('CDP 起不来'); chrome.kill(); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await raw('Runtime.enable');
  await raw('Page.enable');
  await raw('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?fb=${Date.now()}` });

  let ok = false;
  for (let i = 0; i < 140 && !ok; i++) {
    const r = await raw('Runtime.evaluate', {
      expression: `!!(window.AS && AS.pdfVector && AS.app && document.getElementById('btnPdf'))`,
      returnByValue: true
    });
    ok = !!r.result?.result?.value;
    if (!ok) await sleep(250);
  }
  if (!ok) { say('页面未就绪'); ws.close(); chrome.kill(); process.exit(1); }
  say('页面就绪');

  const expr = `(async () => {
    const out = { steps: [] };
    /* ① 挂掉矢量链路 —— 用注入的失败替换 render */
    const orig = AS.pdfVector.render;
    AS.pdfVector.render = function () { return Promise.reject(new Error('注入的矢量失败')); };
    out.steps.push('已注入矢量失败');

    /* ② 拦住下载，抓 data: URI */
    let captured = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href && this.href.indexOf('data:') === 0) captured = this.href;
    };
    const warns = [], alerts = [];
    const realWarn = console.warn, realAlert = window.alert;
    console.warn = function () { warns.push([].slice.call(arguments).join(' ')); return realWarn.apply(console, arguments); };
    window.alert = function (m) { alerts.push(String(m).slice(0, 100)); };

    /* ③ 生成一张卡 */
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '物理');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '2'); set('subjScore', '10,10');
    document.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 2500));

    /* ④ 点真按钮 */
    document.getElementById('btnPdf').click();
    for (let i = 0; i < 160 && !captured; i++) await new Promise(r => setTimeout(r, 500));

    HTMLAnchorElement.prototype.click = realClick;
    console.warn = realWarn; window.alert = realAlert;
    AS.pdfVector.render = orig;
    out.captured = !!captured;
    out.len = captured ? captured.length : 0;
    out.warns = warns; out.alerts = alerts; out.uri = captured;
    return out;
  })()`;

  const r = await raw('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 150000 });
  const v = r.result?.result?.value;
  if (!v) {
    say('EVAL 失败:', JSON.stringify(r.result?.exceptionDetails || r).slice(0, 1200));
  } else {
    say('捕获到下载:', v.captured, 'dataURI 长度', v.len);
    say('console.warn:', JSON.stringify(v.warns));
    say('alert:', JSON.stringify(v.alerts));
    if (v.uri) {
      const b = Buffer.from(v.uri.split(',')[1], 'base64');
      const f = join(outDir, 'fallback.pdf');
      writeFileSync(f, b);
      const s = b.toString('latin1');
      const imgs = (s.match(/\/Subtype\s*\/Image/g) || []).length;
      const ff2 = (s.match(/\/FontFile2/g) || []).length;
      say('写入', f, b.length, '字节');
      say('  /Subtype /Image =', imgs, '（位图链路应 >0）');
      say('  /FontFile2      =', ff2, '（位图链路应 =0）');
      say(imgs > 0 && ff2 === 0 ? '\n✅ 确实退回了位图链路' : '\n❌ 退回后的产物不像位图 PDF');
    }
  }
  clearTimeout(HARD);
  ws.close(); chrome.kill();
})();
