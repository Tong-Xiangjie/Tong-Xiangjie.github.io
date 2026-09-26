/* 走真实 exportPdf()，用 CDP 监听 console 拿到它产出的 data URI，落地成 PDF。
   用法：node .ref\export_pdf_check.mjs <out.pdf> [A4|A3] [color|mono] */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9359;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUTPDF = process.argv[2] || '.ref/out_real.pdf';
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
  const logs = [];
  const errs = [];
  let pdfUri = null;

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const parts = m.params.args.map(a => a.value !== undefined ? String(a.value)
        : (a.description || a.type));
      const text = parts.join(' ');
      logs.push(text);
      /* 多参数 console.log 会在 args 里分成多段，data URI 只可能出现在最后一段，
         所以把整次调用拼起来再找。 */
      const all = parts.join('');
      const k = all.indexOf('data:application/pdf');
      if (k >= 0) {
        const comma = all.indexOf(',', k);
        if (comma > 0) pdfUri = all.slice(k, comma + 1) + all.slice(comma + 1);
      }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push(d.exception && d.exception.description || d.text);
    }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const setup = `(() => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const t = document.querySelector('#themePick .theme-card[data-theme="${THEME}"]'); if (t) t.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试');
    set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');
    /* 在导出前挂上点击拦截：把下载 href 存到 window 上，比解析 console 可靠 */
    window.__pdfHref = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && /\\.pdf$/.test(this.download)) {
        window.__pdfHref = this.href;
        return;
      }
      return orig.apply(this, arguments);
    };
    window.AS.app.generate();
    return { pages: document.querySelectorAll('#stage .as-page').length,
             bubbles: document.querySelectorAll('#stage .as-bubble').length };
  })()`;
  const r1 = await send('Runtime.evaluate', { expression: setup, returnByValue: true });
  console.log('STAGE', JSON.stringify(r1.result?.result?.value));
  await sleep(900);

  await send('Runtime.evaluate', {
    expression: `(() => { window.AS.app.exportPdf(); return 1; })()`, returnByValue: true
  });

  for (let i = 0; i < 900; i++) {
    await sleep(100);
    if (i % 5 === 0) {
      const r = await send('Runtime.evaluate', {
        expression: 'window.__pdfHref || null', returnByValue: true
      });
      const h = r.result?.result?.value;
      if (h) { pdfUri = h; break; }
    }
  }

  console.log('captured =', !!pdfUri);
  console.log('dataUriLen =', pdfUri ? pdfUri.length : 0);
  console.log('errors =', JSON.stringify(errs));
  logs.filter(l => l.indexOf('[答题卡]') === 0).forEach(l => console.log('  ', l));

  if (pdfUri) {
    const m = /base64,(.*)$/s.exec(pdfUri);
    writeFileSync(OUTPDF, Buffer.from(m[1], 'base64'));
    console.log('WROTE', OUTPDF);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
