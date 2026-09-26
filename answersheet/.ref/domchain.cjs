const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9563;
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
    const S = window.AS.subject, Pg = window.AS.paginator;
    const stage = document.querySelector('.preview-stage');
    stage.style.transform = 'none';
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    const face = document.querySelector('.preview-stage .as-face');
    const fb = face.getBoundingClientRect();
    const S2 = fb.width / 210;
    const mm = v => Math.round((v / S2) * 1000) / 1000;

    const walk = (el, depth, acc) => {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      acc.push({
        d: depth,
        cls: (el.className || '').toString().slice(0, 42),
        top: mm(r.top - fb.top), h: mm(r.height),
        pad: mm(parseFloat(c.paddingTop) || 0) + '/' + mm(parseFloat(c.paddingBottom) || 0),
        bord: c.borderTopWidth + '/' + c.borderBottomWidth,
        styleH: el.style && el.style.height ? el.style.height : '',
        display: c.display, box: c.boxSizing
      });
      if (depth < 5) Array.from(el.children).forEach(ch => walk(ch, depth + 1, acc));
    };
    const acc = [];
    const ip = face.querySelector('.as-subject-outer');
    walk(ip, 0, acc);
    const d = Pg.lastDebug.faces[0];
    return {
      S2: S2,
      itemHeight6: S.itemHeight(6, 7.7008),
      SUBJ_ITEM_FIX: Pg.SUBJ_ITEM_FIX,
      SUBJ_BOX_CHROME: Pg.SUBJ_BOX_CHROME,
      dbg: d,
      tree: acc
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 1200));
  else {
    const v = r.result.result.value;
    console.log('S2=' + v.S2 + '  itemHeight(6)=' + v.itemHeight6 +
                '  SUBJ_ITEM_FIX=' + v.SUBJ_ITEM_FIX + '  SUBJ_BOX_CHROME=' + v.SUBJ_BOX_CHROME);
    console.log('dbg=' + JSON.stringify(v.dbg.body));
    console.log('');
    console.log('d  cls'.padEnd(50) + 'top'.padEnd(9) + 'h'.padEnd(9) + 'padT/B'.padEnd(16) + 'bord'.padEnd(14) + 'styleH');
    v.tree.forEach(x => console.log(
      (String(x.d) + '  ' + x.cls).padEnd(50) + String(x.top).padEnd(9) +
      String(x.h).padEnd(9) + x.pad.padEnd(16) + x.bord.padEnd(14) + x.styleH));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
