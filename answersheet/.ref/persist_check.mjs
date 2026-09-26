/* 验证「刷新后保留先前所填内容」。
   流程：
     ① 清空 localStorage，首次加载 → 面板应全空、A4、双色
     ② 填入一整套参数 + 切到 A3 + 黑白 → 重新加载 → 应完全还原
     ③ 点「清空参数」→ 面板应回到初始空状态，且存档被删
     ④ 再重新加载 → 应仍是空状态（存档确实删掉了）
   用法：node .ref\persist_check.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9383;
const BASE = 'http://127.0.0.1:8137/index.html';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let id = 0; const pending = new Map(); let ws = null;
const send = (method, params) => new Promise(res => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const ed = r.result?.exceptionDetails;
  if (ed) return { __err: ed.exception?.description?.slice(0, 400) || 'exception' };
  return r.result?.result?.value;
}
async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(3000);
}

/* 读面板快照 */
const SNAP = `(() => {
  const ids = ['cardTitle','cardSubject','zkLength','cardFooter','choiceTotal',
               'choiceStart','subjStart','subjCount','subjScore','subjLines'];
  const vals = {}; ids.forEach(i => { const e = document.getElementById(i); vals[i] = e ? e.value : null; });
  const seg = document.querySelector('#segFormat button.on');
  const th  = document.querySelector('#themePick .theme-card.on');
  let raw = null; try { raw = localStorage.getItem('as.form.v1'); } catch(e) { raw = 'ERR'; }
  const cb = document.getElementById('btnClear');
  const cbs = cb ? getComputedStyle(cb) : null;
  return {
    vals,
    format: seg ? seg.dataset.val : null,
    theme: th ? th.dataset.theme : null,
    statFormat: document.getElementById('statFormat').textContent,
    statChoice: document.getElementById('statChoice').textContent,
    statSubj: document.getElementById('statSubj').textContent,
    hasCard: !!document.querySelector('#stage .as-page'),
    clearBtn: cb ? { text: cb.textContent.trim(), bg: cbs.backgroundColor,
                     display: cbs.display, w: Math.round(cb.getBoundingClientRect().width) } : null,
    stored: raw
  };
})()`;

const FILL = `(() => {
  const set = (i,v) => { const e = document.getElementById(i); e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true})); };
  set('cardTitle','2026届高三第二次模拟考试');
  set('cardSubject','物理');
  set('zkLength','12');
  set('cardFooter','');
  set('choiceTotal','17');
  set('choiceStart','1');
  set('subjStart','18');
  set('subjCount','4');
  set('subjScore','10-12,12,14,16');
  set('subjLines','10');
  document.querySelector('#segFormat button[data-val="A3"]').click();
  document.querySelector('#themePick .theme-card[data-theme="mono"]').click();
  return 'filled';
})()`;

function cmp(label, got, want) {
  if (!got || !got.vals) {
    console.log(`FAIL ${label} —— 快照没取到（got=${JSON.stringify(got).slice(0, 200)}）`);
    return false;
  }
  const bad = [];
  for (const k of Object.keys(want)) {
    /* 输入框在 got.vals 里，format/theme 在顶层 */
    const g = (k in got.vals) ? got.vals[k] : got[k];
    if (JSON.stringify(g) !== JSON.stringify(want[k])) {
      bad.push(`    ${k}: got ${JSON.stringify(g)}  want ${JSON.stringify(want[k])}`);
    }
  }
  console.log(`${bad.length ? 'FAIL' : ' OK '} ${label}`);
  bad.forEach(b => console.log(b));
  return bad.length === 0;
}

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      target = (await r.json()).find(t => t.type === 'page');
    } catch { /* not up */ }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');

  const EMPTY = {
    cardTitle: '', cardSubject: '', zkLength: '9', cardFooter: '',
    choiceTotal: '', choiceStart: '', subjStart: '', subjCount: '',
    subjScore: '', subjLines: '',
    format: 'A4', theme: 'color'
  };

  let pass = 0, fail = 0;

  /* ① 首次加载（先清空存档） */
  await goto(BASE);
  await evalJS(`try{localStorage.removeItem('as.form.v1')}catch(e){}; 'cleared'`);
  await goto(BASE + '?cb=' + Date.now());
  let s = await evalJS(SNAP);
  if (typeof s === 'string' || s.__err) { console.log('EVAL ERR', s); process.exit(1); }
  console.log('--- ① 首次加载（无存档）');
  cmp('面板应为空、A4、双色', s, EMPTY) ? pass++ : fail++;

  /* ② 填参数 → 重新加载 → 应还原 */
  console.log('--- ② 填入参数并重新加载');
  await evalJS(FILL);
  await sleep(1200);
  const before = await evalJS(SNAP);
  console.log('   存档长度', before.stored ? before.stored.length : 0,
              ' statChoice=', before.statChoice, ' statFormat=', before.statFormat);
  await goto(BASE + '?cb=' + Date.now());
  const after = await evalJS(SNAP);
  const WANT = {
    cardTitle: '2026届高三第二次模拟考试', cardSubject: '物理', zkLength: '12',
    cardFooter: '', choiceTotal: '17', choiceStart: '1',
    subjStart: '18', subjCount: '4', subjScore: '10-12,12,14,16', subjLines: '10',
    format: 'A3', theme: 'mono'
  };
  cmp('刷新后应完整还原', after, WANT) ? pass++ : fail++;
  console.log('   刷新后 statFormat=%s statChoice=%s statSubj=%s hasCard=%s',
              after.statFormat, after.statChoice, after.statSubj, after.hasCard);
  if (after.statChoice !== '17' || after.statFormat !== 'A3' || !after.hasCard) {
    console.log('FAIL 刷新后答题卡未按还原的参数重新生成');
    fail++;
  } else { pass++; console.log(' OK  刷新后按还原参数重新生成了答题卡'); }

  /* ③ 点「清空参数」 */
  console.log('--- ③ 点「清空参数」');
  await evalJS(`document.getElementById('btnClear').click(); 'clicked'`);
  await sleep(1200);
  const cleared = await evalJS(SNAP);
  cmp('应回到初始空状态', cleared, EMPTY) ? pass++ : fail++;
  if (cleared.stored !== null) { console.log('FAIL 存档未删除:', cleared.stored); fail++; }
  else { pass++; console.log(' OK  存档已删除'); }

  /* ④ 再重新加载 → 仍应为空 */
  console.log('--- ④ 清空后重新加载');
  await goto(BASE + '?cb=' + Date.now());
  const reloaded = await evalJS(SNAP);
  cmp('应仍为空（存档确实没了）', reloaded, EMPTY) ? pass++ : fail++;

  console.log('\n清空按钮: ' + JSON.stringify(reloaded.clearBtn));
  console.log('=== pass %d / fail %d ===', pass, fail);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
