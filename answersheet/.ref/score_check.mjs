/* 复现「（undefined–undefined分）」：把各种分值写法喂进去看渲染结果。
   用法：node .ref\score_check.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9375;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';

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
    const S = window.AS.subject;
    const out = { parse: {}, render: [] };
    const cases = ['', '10,12,12', '10-12', '10-12,13,14', '10,12,12,12,12',
                   'abc', '10、12', '10 12', '1O,12'];
    cases.forEach(c => { out.parse[JSON.stringify(c)] = S.parseScores(c); });

    /* 用「留空分值 + 5 题」渲染一次，看题头实际输出什么 */
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', 'T'); set('cardSubject', '数学');
    set('choiceTotal', '12'); set('subjStart', '13'); set('subjCount', '5');
    set('subjLines', '8');
    cases.forEach(c => {
      set('subjScore', c);
      window.AS.app.generate();
      const heads = Array.from(document.querySelectorAll('#stage .as-subj-head'))
        .slice(0, 3).map(e => e.textContent);
      out.render.push({ score: c, heads: heads });
    });
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 800));
  }
  console.log(JSON.stringify(res.result?.result?.value, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
