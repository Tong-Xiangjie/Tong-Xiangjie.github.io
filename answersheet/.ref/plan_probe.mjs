/* 打印分页器内部的每一面规划（题号 / 段行数 / boxTop / 游标 / 续排标记）。
   用法：node .ref\plan_probe.mjs [A4|A3] [选择题数] [非选择题数] [行数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9429;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '12';
const NS = process.argv[4] || '4';
const LINES = process.argv[5] || '10';

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
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart', String(${NC} + 1)); set('subjCount','${NS}');
    set('subjScore', Array.from({length:${NS}},()=>'10').join(','));
    set('subjLines', Array.from({length:${NS}},()=>'${LINES}').join(','));
    const P = window.AS.paginator;
    /* 直接调分页器，拿到面规划（不渲染） */
    const opt = window.AS.__lastOptions || {};
    const faces = window.AS.app.__lastFaces || null;
    window.AS.app.generate();
    const dbg = P.lastDebug;
    return {
      usable: dbg && dbg.usable,
      subjBoxChrome: dbg && dbg.subjBoxChrome,
      items: dbg && dbg.items,
      faces: (dbg && dbg.faces || []).map(fc => ({
        first: fc.first, cursor: fc.cursor,
        body: fc.body.map(x => x.kind === 'subj'
          ? { k: 'subj', no: x.no, top: x.top, h: x.h, lines: x.lines, first: x.first, cont: x.cont }
          : { k: 'choice', boxTop: x.boxTop, rows: x.rows })
      }))
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    console.log('usable=%s   SUBJ_BOX_CHROME=%s', d.usable, d.subjBoxChrome);
    console.log('题目: %s', JSON.stringify(d.items));
    d.faces.forEach((F, i) => {
      if (i > 12 && i < d.faces.length - 2) { if (i === 13) console.log('   ...'); return; }
      console.log('\n面 %d  first=%s  游标=%s', i + 1, F.first, F.cursor);
      F.body.forEach(x => console.log('   %s', JSON.stringify(x)));
    });
    console.log('\n总面数 = %d', d.faces.length);
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
