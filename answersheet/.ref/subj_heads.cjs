/* 逐面列出非选择题的题头，核对「续xx.」不重复、不丢题。
   用法：node .ref\subj_heads.cjs [A4|A3] [非选择数] [每题行数] */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9447;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NS = parseInt(process.argv[3] || '4', 10);
const LN = process.argv[4] || '10';
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
    set('choiceTotal','12'); set('choiceStart','1');
    /* subjStart 故意留空 —— 默认值应为 choiceStart + choiceTotal = 13 */
    set('subjStart',''); set('subjCount','${NS}');
    set('subjScore', Array.from({length:${NS}},()=>'10').join(','));
    set('subjLines', Array.from({length:${NS}},()=>'${LN}').join(','));
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const PAGE_W = window.AS.config.PAPER['${FMT}'].w;
    const NF = '${FMT}' === 'A3' ? window.AS.config.A3_COLUMNS : 1;
    const FACEW = PAGE_W / NF;
    const out = [];
    document.querySelectorAll('.as-page').forEach(function (page, pi) {
      const pr = page.getBoundingClientRect();
      const S = pr.width / PAGE_W;
      const mm = v => Math.round((v / S) * 1000) / 1000;
      Array.from(page.querySelectorAll('.as-face')).forEach(function (face, fi) {
        const heads = Array.from(face.querySelectorAll('.as-subj-head'))
          .map(function (h) {
            const no = h.querySelector('.as-subj-no');
            const sc = h.querySelector('.as-subj-score');
            return { text: h.textContent.trim(), no: no ? no.textContent : null,
                     cls: no ? no.className : null,
                     color: no ? getComputedStyle(no).color : null,
                     fs: no ? getComputedStyle(no).fontSize : null,
                     score: sc ? sc.textContent : null };
          });
        out.push({ page: pi + 1, face: fi + 1, heads: heads });
      });
    });
    return { faceW: FACEW, faces: out };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    let contCount = 0, plainDup = [];
    const seen = [];
    d.faces.forEach(function (f) {
      if (!f.heads.length) return;
      console.log('\n=== 第 %d 张 第 %d 面 ===', f.page, f.face);
      f.heads.forEach(function (h) {
      console.log('   %s  分值=%s  色=%s  字号=%s', JSON.stringify(h.text),
          h.score === null ? '(无)' : h.score, h.color, h.fs);
        if (h.text.indexOf('续') === 0) contCount++;
        seen.push(h.text);
      });
    });
    console.log('\n▶ 题头总数 %d  其中「续xx.」%d 个', seen.length, contCount);
    console.log('▶ 题头序列: %s', seen.join('  |  '));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
