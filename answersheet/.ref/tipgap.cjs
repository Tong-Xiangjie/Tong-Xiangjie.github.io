/* 量「请在各题目的答题区域内作答…」这句的两处排布，以及红/黑框的上下内边距。
   用户说「这句话留空比较多，可以贴近黑框和红框的上下界」。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9495;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '12';
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
    set('subjStart','13'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','6,6');
    const b = document.querySelector('button[data-val=${JSON.stringify(FMT)}]');
    if (b) b.click();
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const paperW = ${JSON.stringify(FMT)} === 'A3' ? 420 : 210;
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / paperW;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const out = [];
    pages.forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const R = e => { const q = e.getBoundingClientRect();
          return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top),
                   l: mm(q.left - fb.left), r: mm(q.right - fb.left) }; };
        const subj = face.querySelector('.as-subjective');
        if (!subj) return;
        /* 红框 / 黑框：把子元素按类名全部列出，先看清结构 */
        const kids = Array.from(subj.children).map(function (e) {
          const cs = getComputedStyle(e);
          const r = R(e);
          return { cls: e.className, t: r.t, b: r.b, h: Math.round((r.b - r.t) * 1000) / 1000,
                   padTop: cs.paddingTop, padBottom: cs.paddingBottom,
                   border: cs.borderTopWidth, pos: cs.position };
        });
        const tips = Array.from(subj.querySelectorAll('.as-subject-page-tip')).map(function (e) {
          const cs = getComputedStyle(e);
          const r = R(e);
          return { t: r.t, b: r.b, h: Math.round((r.b - r.t) * 1000) / 1000,
                   mt: cs.marginTop, mb: cs.marginBottom };
        });
        const head = subj.querySelector('.as-subj-header, .as-subject-header');
        const table = subj.querySelector('table');
        out.push({
          page: pi + 1, face: fi + 1,
          subj: R(subj),
          kids: kids,
          tips: tips,
          head: head ? R(head) : null,
          table: table ? R(table) : null,
          firstRowCell: (function () {
            const tr = subj.querySelector('tr');
            return tr ? R(tr) : null;
          })()
        });
      });
    });
    return { fmt: ${JSON.stringify(FMT)}, out: out };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1400));
  } else {
    const d = res.result.result.value;
    console.log('════ %s ════', d.fmt);
    d.out.forEach(function (f) {
      console.log('\n── 第%d张 第%d面 非选择题 ─────────────', f.page, f.face);
      console.log('   容器 .as-subjective  y %s → %s', f.subj.t, f.subj.b);
      f.kids.forEach(function (k) {
        console.log('   子元素 %-28s y %s → %s  h=%s  pad=%s/%s border=%s',
          (k.cls || '').slice(0, 28), k.t, k.b, k.h, k.padTop, k.padBottom, k.border);
      });
      if (f.head) console.log('   栏目头   y %s → %s', f.head.t, f.head.b);
      if (f.table) console.log('   表格     y %s → %s', f.table.t, f.table.b);
      if (f.firstRowCell) console.log('   首行     y %s → %s', f.firstRowCell.t, f.firstRowCell.b);
      f.tips.forEach(function (t, i) {
        console.log('   提示%d    y %s → %s  h=%s  margin %s / %s',
          i + 1, t.t, t.b, t.h, t.mt, t.mb);
      });
      /* 提示与上下界的关系 */
      const tbl = f.table;
      f.tips.forEach(function (t, i) {
        const above = t.b <= (tbl ? tbl.t : 1e9);
        const near = above ? (tbl ? tbl.t : null) : (tbl ? tbl.b : null);
        console.log('     ↳ 提示%d 在%s，与最近的黑框边差 %s',
          i + 1, above ? '黑框上方' : '黑框下方',
          near === null ? '—' : Math.round(Math.abs(near - (above ? t.b : t.t)) * 1000) / 1000);
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
