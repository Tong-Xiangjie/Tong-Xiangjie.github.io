const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9629;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const outDir = join(process.cwd(), '.ref', 'out');
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 400000);
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
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);
  await send('Runtime.evaluate', { expression: `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试卷'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`, returnByValue: true }, 20000);
  await sleep(1800);

  const variants = [
    { tag: 'png_nocomp', image: { type: 'png' }, jsPDF: { unit: 'mm', format: [210,297], orientation: 'portrait' } },
    { tag: 'png_fast', image: { type: 'png' }, jsPDF: { unit: 'mm', format: [210,297], orientation: 'portrait', compress: true, compression: 'FAST' } },
    { tag: 'png_medium', image: { type: 'png' }, jsPDF: { unit: 'mm', format: [210,297], orientation: 'portrait', compress: true, compression: 'MEDIUM' } },
    { tag: 'jpeg98', image: { type: 'jpeg', quality: 0.98 }, jsPDF: { unit: 'mm', format: [210,297], orientation: 'portrait', compress: true } }
  ];
  const E = `(() => {
    window.__V = null;
    const pg = document.querySelector('#stage .as-page');
    const vs = ${JSON.stringify(variants)};
    const out = [];
    let chain = Promise.resolve();
    vs.forEach(function (v) {
      chain = chain.then(function () {
        const w = html2pdf().set({
          margin: 0, image: v.image,
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: v.jsPDF
        }).from(pg);
        return w.toCanvas().then(function () {
          const cv = w.prop.canvas;
          const t0 = Date.now();
          const w2 = html2pdf().set({
            margin: 0, image: v.image,
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: v.jsPDF
          }).from(pg);
          return w2.toContainer().then(function () {
            w2.prop.canvas = cv;
            w2.prop.pdf = null;
            return w2.toPdf().outputPdf('datauristring').then(function (uri) {
              out.push({ tag: v.tag, dataUriBytes: uri.length,
                pdfBytes: Math.round((uri.length - uri.indexOf(',') - 1) * 0.75),
                ms: Date.now() - t0 });
              return out;
            });
          });
        });
      });
    });
    chain.then(function () { window.__V = out; }).catch(function (e) { window.__V = [{ ERR: String(e) }]; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
  let v = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'window.__V', returnByValue: true }, 30000);
    if (r.result?.result?.value) { v = r.result.result.value; break; }
  }
  say('VARIANTS =', JSON.stringify(v, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
