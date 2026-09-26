/* 把「红框内容盒」的真实宽度量出来（不靠推导）。
   用法：node .ref\contentbox_probe.mjs [A4|A3] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9405;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';

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
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0'); set('subjScore',''); set('subjLines','');
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const G = window.AS.geometry, C = window.AS.config;
    const P = C.PRESETS['${FMT}'];
    const faceW = C.PAPER['${FMT}'].w / ('${FMT}'==='A3'?3:1);
    /* 用一个零尺寸探针元素测出红框的真实内容盒宽度：
       把它放进 .as-choice-outer，width:100% → 得到内容盒宽度。 */
    const outer = document.querySelector('.as-choice-outer');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;width:100%;height:0;visibility:hidden';
    /* 绝对定位会不参与内容盒计算，改用静态插入再移除 */
    outer.insertBefore(probe, outer.firstChild);
    probe.style.position = 'static';
    const gm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const contentW = gm(probe.getBoundingClientRect().width);
    probe.remove();
    const or = outer.getBoundingClientRect();
    const cs = getComputedStyle(outer);
    const bw = gm(parseFloat(cs.borderLeftWidth));
    /* 用 clientWidth 直接读内容盒（含 padding，本处 padding=0） */
    const clientW = gm(outer.clientWidth);
    return {
      jsContentBoxW: G.contentBox(P, faceW).width,
      jsOuterBoxW: G.outerBoxW(P, faceW),
      jsInnerBoxW: G.innerBoxW(P, faceW),
      jsGridOriginX: G.gridOriginX(P, faceW),
      border: bw,
      outerBorderBoxW: gm(or.width),
      outerClientW: clientW,          // = 内容盒宽（padding=0）
      probe100pctW: contentW,         // = 内容盒宽（另一把尺子）
      predictedContentW: gm(gm(or.width) - 2 * bw),
      delta: gm(clientW - (gm(or.width) - 2 * bw))
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    console.log('格式', FMT);
    console.log(JSON.stringify(res.result.result.value, null, 1));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
