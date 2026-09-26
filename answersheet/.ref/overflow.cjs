/* A4/A3 各面：分页器给出的「红框底」是否越过可用高度，
   以及 canFit 公式有没有算进 choiceFootH。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9489;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
        .find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  const EXPR = `(() => {
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    const fmt = ${JSON.stringify(process.argv[2] || 'A4')};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${process.argv[3] || '300'}'); set('choiceStart','1');
    set('subjStart','21'); set('subjCount','1'); set('subjScore','10'); set('subjLines','6');
    const b = document.querySelector('button[data-val=' + fmt + ']');
    if (b) b.click();
    document.getElementById('btnGenerate').click();
    const G = window.AS.geometry, C = window.AS.config;
    const p = C.PRESETS[fmt] || C.PRESETS.A4;
    const Pg = window.AS.paginator;
    const usable = Pg.PAGE_H - Pg.BOTTOM_RESERVE;
    const chromeH = G.choiceChromeH(p), footH = G.choiceFootH(p);
    const colH = G.columnHeight(p), lineGap = G.lineGapH(p), lineH = G.lineHeight(p);
    const faces = Pg.lastDebug ? Pg.lastDebug.faces : [];
    const out = [];
    faces.forEach(function (f, i) {
      f.body.forEach(function (x) {
        if (x.kind !== 'choice') return;
        const room = usable - x.boxTop - (x.rows && x.head ? chromeH : 0);
        const realH = x.rows * colH + Math.max(0, x.rows - 1) * lineGap;
        const canFitPlain = Math.floor((usable - x.boxTop - chromeH + lineGap) / lineH);
        const canFitBox = Math.floor((usable - x.boxTop - chromeH - footH + lineGap) / lineH);
        out.push({
          face: i + 1, rows: x.rows, boxTop: x.boxTop,
          redBottom: Math.round((x.boxTop + chromeH + realH + footH) * 1000) / 1000,
          usable: usable,
          over: Math.round((x.boxTop + chromeH + realH + footH - usable) * 1000) / 1000,
          canFitPlain: canFitPlain, canFitBox: canFitBox
        });
      });
    });
    return { fmt: fmt, usable: usable, chromeH: chromeH, footH: footH,
             colH: colH, lineGap: lineGap, lineH: lineH, faces: out };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    const d = res.result.result.value;
    console.log('%s: usable=%s chromeH=%s footH=%s  colH=%s lineGap=%s lineH=%s',
      d.fmt, d.usable, d.chromeH, d.footH, d.colH, d.lineGap, d.lineH);
    console.log('面  行   boxTop  红框底    超出    canFit(现)  canFit(含footH)');
    let bad = 0;
    d.faces.forEach(function (x) {
      if (x.over > 0.01) bad++;
      console.log(' %s  %s  %s  %s  %s  %s  %s',
        String(x.face).padStart(2), String(x.rows).padStart(3),
        String(x.boxTop).padStart(7), String(x.redBottom).padStart(8),
        String(x.over).padStart(7), String(x.canFitPlain).padStart(9),
        String(x.canFitBox).padStart(12), x.over > 0.01 ? '  ** 压到页脚 **' : '');
    });
    console.log('\n▶ 越界面数 = %d %s', bad, bad ? '** 有问题 **' : 'OK');
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
