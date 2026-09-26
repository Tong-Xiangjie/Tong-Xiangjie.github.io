/* 统计非选择题两句话的出现次数与位置。
   「非选择题（提示：…）」全卡只允许 1 次；
   「请在各题目的答题区域内作答…」应出现在每面非选择题红黑框之间。
   用法：node .ref\tip_count.cjs [A4|A3] [选择题数] [非选择题数] [行数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9439;
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
    const f0 = document.querySelector('#segFormat button[data-val="${FMT}"]');
    if (f0) f0.click();
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart',''); set('subjCount','${NS}');
    set('subjScore', Array.from({length:${NS}},()=>'10').join(','));
    set('subjLines', Array.from({length:${NS}},()=>'${LINES}').join(','));
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const HEAD = '非选择题';
    const SENT = '请在各题目的答题区域内作答';
    const heads = [], sents = [], pages = [];
    document.querySelectorAll('.as-page').forEach(function (page, pi) {
      const pr = page.getBoundingClientRect();
      const S = pr.width / 210;
      const M = v => Math.round((v / S) * 1000) / 1000;
      page.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const out = face.querySelector('.as-subject-outer');
        const tbl = face.querySelector('.as-subject-inner-table');
        const hdr = face.querySelector('.as-subject-header');
        const tips = Array.from(face.querySelectorAll('.as-subject-page-tip'));
        pages.push({ page: pi + 1, face: fi + 1,
          hasSubj: !!out,
          hdr: hdr ? M(hdr.getBoundingClientRect().top - fb.top) : null,
          tblTop: tbl ? M(tbl.getBoundingClientRect().top - fb.top) : null,
          tblBot: tbl ? M(tbl.getBoundingClientRect().bottom - fb.top) : null,
          outerTop: out ? M(out.getBoundingClientRect().top - fb.top) : null,
          outerBot: out ? M(out.getBoundingClientRect().bottom - fb.top) : null,
          tips: tips.map(function (t) {
            const b = t.getBoundingClientRect();
            return { top: M(b.top - fb.top), bot: M(b.bottom - fb.top) };
          }) });
        if (hdr) heads.push({ page: pi + 1, face: fi + 1 });
        tips.forEach(function (t) {
          sents.push({ page: pi + 1, face: fi + 1,
            top: M(t.getBoundingClientRect().top - fb.top) });
        });
      });
    });
    return { heads: heads, sents: sents, pages: pages,
             headTotal: heads.length, sentTotal: sents.length };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('格式 %s  选择 %s 题  非选择 %s 题 × %s 行', FMT, NC, NS, LINES);
    console.log('\n▶「非选择题（提示：…）」栏目头出现 %d 次  (要求 1 次)  %s',
      d.headTotal, d.headTotal === 1 ? 'OK' : '** 次数不对 **');
    d.heads.forEach(h => console.log('     第%d张 第%d面', h.page, h.face));
    console.log('\n▶「请在各题目的答题区域内作答…」出现 %d 次', d.sentTotal);
    d.sents.forEach(s => console.log('     第%d张 第%d面  y=%s', s.page, s.face, s.top));
    console.log('\n各面情况:');
    d.pages.forEach(p => {
      if (!p.hasSubj) { console.log('   第%d张 第%d面  无非选择题', p.page, p.face); return; }
      console.log('   第%d张 第%d面  红框 %s→%s  黑框 %s→%s  栏目头 %s',
        p.page, p.face, p.outerTop, p.outerBot, p.tblTop, p.tblBot,
        p.hdr === null ? '无' : p.hdr);
      p.tips.forEach(t => {
        const where = t.bot <= p.tblTop ? '黑框**上**方' :
                      (t.top >= p.tblBot ? '黑框**下**方' : '** 压在黑框里 **');
        console.log('        语句 y=%s→%s  %s', t.top, t.bot, where);
      });
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
