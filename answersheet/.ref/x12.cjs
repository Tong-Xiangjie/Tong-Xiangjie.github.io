const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9627;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 500000);
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

  /* 对同一张纸跑真 toPdf()，量「进 PDF 的图像字节 + 解出来的像素是否完好」 */
  const E = `(() => {
    window.__S = null;
    const pg = document.querySelector('#stage .as-page');
    const modes = [
      { tag: 'png', image: { type: 'png' } },
      { tag: 'j98', image: { type: 'jpeg', quality: 0.98 } },
      { tag: 'j92', image: { type: 'jpeg', quality: 0.92 } }
    ];
    const out = [];
    let chain = Promise.resolve();
    modes.forEach(function (m) {
      chain = chain.then(function () {
        const w = html2pdf().set({
          margin: 0, image: m.image,
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' }
        }).from(pg);
        return w.toCanvas().then(function () {
          const cv = w.prop.canvas;
          const c2 = cv.getContext('2d');
          /* 先记下「编码前」的关键像素：左上第一个定位点中心 + 一处红框线 */
          const W = cv.width, PPM = W / 210;
          const mx = Math.round(16.5 * PPM), my = Math.round(10.5 * PPM);
          const pre = c2.getImageData(mx, my, 1, 1).data;
          /* 编码 → 解码，量往返损失 */
          const uri = cv.toDataURL('image/' + m.image.type, m.image.quality);
          return new Promise(function (res) {
            const img = new Image();
            img.onload = function () {
              const t2 = document.createElement('canvas');
              t2.width = W; t2.height = cv.height;
              const g2 = t2.getContext('2d');
              g2.fillStyle = '#fff'; g2.fillRect(0, 0, W, cv.height);
              g2.drawImage(img, 0, 0);
              const post = g2.getImageData(mx, my, 1, 1).data;
              /* 统计整幅图的「下发灰」：原本纯白、解码后 200~250 的像素数 */
              const a = c2.getImageData(0, 0, W, cv.height).data;
              const b = g2.getImageData(0, 0, W, cv.height).data;
              let dirty = 0, changed = 0, maxDiff = 0;
              for (let i = 0; i < a.length; i += 4) {
                const d0 = Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
                if (d0 > 12) changed++;
                if (d0 > maxDiff) maxDiff = d0;
                if (a[i] > 250 && a[i+1] > 250 && a[i+2] > 250 &&
                    b[i] < 248) dirty++;
              }
              out.push({ tag: m.tag, uriBytes: uri.length,
                pre: [pre[0], pre[1], pre[2]], post: [post[0], post[1], post[2]],
                changedPx: changed, dirtyWhitePx: dirty, maxDiff: maxDiff });
              res();
            };
            img.onerror = function () { out.push({ tag: m.tag, ERR: 'decode' }); res(); };
            img.src = uri;
          });
        });
      });
    });
    chain.then(function () { window.__S = out; }).catch(function (e) { window.__S = [{ ERR: String(e) }]; });
    return 'started';
  })()`;
  await send('Runtime.evaluate', { expression: E, returnByValue: true }, 20000);
  let s = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'window.__S', returnByValue: true }, 30000);
    if (r.result?.result?.value) { s = r.result.result.value; break; }
  }
  say('ENCODE =', JSON.stringify(s, null, 1));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
