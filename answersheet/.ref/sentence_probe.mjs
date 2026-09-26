/* 全卡「请在各题目的答题区域内作答…」出现位置逐面清点：
     · 页脚里出现几次 —— 必须 0
     · 红框/黑框之间的空档里出现几次 —— 非选择题面每面 1 次
   同时清点两处栏目头提示的次数。
   用法：node .ref\sentence_probe.mjs [A4|A3] [选择题数] [非选择题数] [行数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9417;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '12';
const NS = process.argv[4] || '3';
const LINES = process.argv[5] || '10';
const SENT = '请在各题目的答题区域内作答';

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
    const SENT = ${JSON.stringify(SENT)};
    const faces = Array.from(document.querySelectorAll('#stage .as-face'));
    return faces.map((face, i) => {
      /* 每个文字节点所属的最近「有类名」祖先，用来判断它落在哪一层 */
      const hits = [];
      face.querySelectorAll('*').forEach(e => {
        if (e.children.length) return;            // 只取叶子
        if (e.textContent.indexOf(SENT) < 0) return;
        const cls = [];
        let p = e;
        for (let k = 0; k < 4 && p && p !== face; k++, p = p.parentElement) {
          if (p.className && typeof p.className === 'string') cls.push(p.className);
        }
        hits.push(cls.join(' < '));
      });
      const tips = [];
      face.querySelectorAll('.as-section-tip, .as-subject-tip').forEach(e => {
        tips.push((e.className || '?') + ' :: ' + e.textContent.trim().slice(0, 18));
      });
      return { face: i + 1, hits, tips,
               footerText: (face.querySelector('.as-footer') || {}).textContent || '' };
    });
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 900));
  } else {
    const d = res.result.result.value;
    let inFooter = 0, inGap = 0;
    d.forEach(P => {
      console.log('\n=== 第 %d 面 ===', P.face);
      console.log('  页脚文本: %s', JSON.stringify(P.footerText));
      P.hits.forEach(h => {
        const isFooter = /as-footer/.test(h);
        if (isFooter) inFooter++; else inGap++;
        console.log('  语句所在: %s   %s', h, isFooter ? '← ** 在页脚，不该有 **' : '← 在红黑框之间');
      });
      P.tips.forEach(t => console.log('  栏目头提示: %s', t));
    });
    console.log('\n—— 合计 ——');
    console.log('  页脚里的语句      = %d  (要求 0)', inFooter);
    console.log('  红黑框之间的语句  = %d  (要求 = 有非选择题的面数)', inGap);
    console.log('  栏目头提示        = %d  (要求 2：选择题 1 + 非选择题 1)',
      d.reduce((a, P) => a + P.tips.length, 0));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
