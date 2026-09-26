/* 页脚与最后一个红框的实际位置、以及页脚里的所有文字。
   用法：node .ref\footer_probe.mjs [A4|A3] [选择题数] [非选择题数] [行数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9421;
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
    window.AS.app.generate();
    document.querySelector('#stage').style.transform = 'none';
    const mm = v => Math.round(v * 25.4 / 96 * 1000)/1000;
    const faces = Array.from(document.querySelectorAll('#stage .as-face'));
    return faces.map((face, i) => {
      const pr = face.getBoundingClientRect();
      const T = e => mm(e.getBoundingClientRect().top - pr.top);
      const B = e => mm(e.getBoundingClientRect().bottom - pr.top);
      const ft = face.querySelector('.as-footer');
      const boxes = Array.from(face.querySelectorAll('.as-subject-outer, .as-choice-outer'));
      return {
        face: i + 1,
        faceH: mm(pr.height),
        footerTop: ft ? T(ft) : null, footerBottom: ft ? B(ft) : null,
        footerText: ft ? ft.textContent : null,
        boxes: boxes.map(b => ({ cls: b.className, top: T(b), bottom: B(b) })),
        /* 红框底与页脚顶之间的净空 */
        lastBoxBottom: boxes.length ? B(boxes[boxes.length - 1]) : null
      };
    });
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    res.result.result.value.forEach(P => {
      console.log('\n=== 第 %d 面 (纸高 %s) ===', P.face, P.faceH);
      P.boxes.forEach(b => console.log('  %s  %s → %s', b.cls, b.top, b.bottom));
      console.log('  页脚 %s → %s   %s', P.footerTop, P.footerBottom,
        JSON.stringify(P.footerText));
      if (P.lastBoxBottom !== null)
        console.log('  ▶ 末框底 → 页脚顶 = %s mm',
          Math.round((P.footerTop - P.lastBoxBottom) * 1000) / 1000);
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
