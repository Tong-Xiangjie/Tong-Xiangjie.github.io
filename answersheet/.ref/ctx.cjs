const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9561;
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
    const stage = document.querySelector('.preview-stage');
    stage.style.transform = 'none';
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const page = document.querySelector('.preview-stage .as-page');
    const S2 = page.getBoundingClientRect().width / 210;
    const mm = v => Math.round((v / S2) * 1000) / 1000;

    /* 真实卡片里的作答区 */
    const realBody = document.querySelector('.preview-stage .as-subj-body');
    const realRect = realBody.getBoundingClientRect().height;
    const realCS = getComputedStyle(realBody);
    const realPage = realBody.closest('.as-page');
    const realVar = getComputedStyle(realPage).getPropertyValue('--answer-line-h');

    /* 同一个 builder 输出，挂到 document.body 上量 */
    const mk = () => {
      const h = document.createElement('div');
      h.style.cssText = 'position:absolute;left:0;top:0;width:175.99mm;background:#fff';
      h.innerHTML = S.render([{ no: 13, score: 10, lines: 6, scoreShow: true }],
        { lineH: 7.7008, showHeader: false, pageTip: false, tailExtra: 0, frameH: 0 });
      return h;
    };
    const hOut = mk(); document.body.appendChild(hOut);
    const outBody = hOut.querySelector('.as-subj-body');
    /* 挂到 stage 里（继承 CSS 自定义属性） */
    const hIn = mk(); document.querySelector('.preview-stage').appendChild(hIn);
    const inBody = hIn.querySelector('.as-subj-body');

    const d = {
      realBodyH: mm(realRect),
      realBodyCSHeight: realCS.height,
      realBodyInline: realBody.style.height,
      realVar: realVar.trim(),
      outerBodyH: mm(outBody.getBoundingClientRect().height),
      outerBodyDecl: outBody.style.height,
      innerBodyH: mm(inBody.getBoundingClientRect().height),
      innerBodyDecl: inBody.style.height,
      innerVar: getComputedStyle(inBody).getPropertyValue('--answer-line-h').trim(),
      realHeadH: mm(document.querySelector('.preview-stage .as-subj-head').getBoundingClientRect().height),
      outerHeadH: mm(hOut.querySelector('.as-subj-head').getBoundingClientRect().height),
      innerHeadH: mm(hIn.querySelector('.as-subj-head').getBoundingClientRect().height),
      realTdPad: (function(){const c=getComputedStyle(realBody.closest('td'));return c.paddingTop+'/'+c.paddingBottom;})(),
      outerTdPad: (function(){const c=getComputedStyle(outBody.closest('td'));return c.paddingTop+'/'+c.paddingBottom;})()
    };
    hOut.remove(); hIn.remove();
    return d;
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else console.log(JSON.stringify(r.result.result.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
