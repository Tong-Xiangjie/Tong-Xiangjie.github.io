/* 反复生成，检查页眉/正文高度是否稳定（防止实测值回灌造成正反馈）。
   用法：node .ref\stability.mjs [A4|A3] [rounds] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9369;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const ROUNDS = parseInt(process.argv[3] || '6', 10);

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

  const EXPR = `(async () => {
    const f = document.querySelector('#segFormat button[data-val="${FMT}"]'); if (f) f.click();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('cardTitle', '2026届高三第一次模拟考试'); set('cardSubject', '数学');
    set('choiceTotal', '12'); set('choiceStart', '1');
    set('subjStart', '13'); set('subjCount', '5');
    set('subjScore', '10,12,12,12,12'); set('subjLines', '8');

    const rows = [];
    for (let i = 0; i < ${ROUNDS}; i++) {
      window.AS.app.generate();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = document.querySelector('#stage .as-page');
      const head = card.querySelector('.as-head');
      const t = card.querySelector('.as-head-title');
      const ch = card.querySelector('.as-choice-section');
      rows.push({
        round: i + 1,
        titleVar: card.style.getPropertyValue('--head-title-h'),
        headH: Math.round(head.getBoundingClientRect().height * 100) / 100,
        titleRowH: Math.round(t.getBoundingClientRect().height * 100) / 100,
        choiceTop: Math.round(ch.getBoundingClientRect().top * 100) / 100,
        pages: document.querySelectorAll('#stage .as-page').length
      });
    }
    const first = rows[0], last = rows[rows.length - 1];
    return { rows: rows, stable: first.headH === last.headH &&
      first.titleRowH === last.titleRowH && first.choiceTop === last.choiceTop };
  })()`;

  const res = await send('Runtime.evaluate', {
    expression: EXPR, returnByValue: true, awaitPromise: true
  });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  }
  const D = res.result?.result?.value;
  if (D) {
    D.rows.forEach(r => console.log(
      'round ' + r.round + ': var=' + r.titleVar + ' headH=' + r.headH +
      ' titleRowH=' + r.titleRowH + ' choiceTop=' + r.choiceTop + ' pages=' + r.pages));
    console.log('STABLE =', D.stable);
  } else {
    console.log(JSON.stringify(res).slice(0, 800));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
