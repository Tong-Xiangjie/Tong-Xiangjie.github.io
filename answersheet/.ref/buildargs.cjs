/* 记录每次 Choice.build 的完整入参，重点是 gridTop / boxTop 来源。
   同时把分页器 lastDebug 的 body 原样打出来。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9487;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const NC = process.argv[2] || '300';
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
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','21'); set('subjCount','1'); set('subjScore','10'); set('subjLines','6');

    /* 拦截 paginate：记录 faces 的 body 原样 */
    const Pg = window.AS.paginator;
    const calls = [];
    const origBuild = window.AS.choice.build;
    window.AS.choice.build = function (o) {
      calls.push(JSON.parse(JSON.stringify(o, function (k, v) {
        return (k === 'colCenters') ? undefined : v;
      })));
      return origBuild.apply(this, arguments);
    };
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    return {
      calls: calls,
      debugFaces: Pg.lastDebug ? Pg.lastDebug.faces.map(f => ({
        first: f.first, cursor: f.cursor,
        body: f.body.map(x => x.kind === 'choice'
          ? { kind: 'choice', boxTop: x.boxTop, rows: x.rows }
          : { kind: 'subj', no: x.no, top: x.top })
      })) : null
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1200));
  } else {
    const d = res.result.result.value;
    console.log('=== Choice.build 入参 ===');
    d.calls.forEach(function (c, i) {
      console.log('  #%d  rows=%s fromLine=%s first=%s gridTop=%s gridH=%s faceW=%s startNo=%s endNo=%s',
        i + 1, c.rows, c.fromLine, c.first, c.gridTop, c.gridH, c.faceW, c.startNo, c.endNo);
    });
    console.log('\n=== paginator.lastDebug.faces ===');
    console.log(JSON.stringify(d.debugFaces, null, 1));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
