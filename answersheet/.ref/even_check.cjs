/* 核对：① 选择题续页提示语句字号 == 非选择题提示语句字号
        ② 总面数为偶数（凑偶数的空白面存在且整面是非答题区） */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9517;
const NC = process.argv[2] || '300';
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' });
  await sleep(5000);
  const E = `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e)e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','301'); set('subjCount','2');
    set('subjScore','10,10'); set('subjLines','8,8');
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const choiceTips = Array.from(document.querySelectorAll('.as-choice-header-no-example .as-section-tip'));
    const subjTips = Array.from(document.querySelectorAll('.as-subject-page-tip'));
    const info = document.getElementById('previewInfo').textContent;
    const faces = Array.from(document.querySelectorAll('.preview-stage .as-face'));
    const blank = faces.map(function (f, i) {
      const na = f.querySelector('.as-noanswer');
      const subj = f.querySelector('.as-subject-outer');
      const choice = f.querySelector('.as-choice-outer');
      const title = f.querySelector('.as-title-sub');
      const fb = f.getBoundingClientRect();
      const S = fb.width / 210;
      const mm = v => Math.round((v / S) * 1000) / 1000;
      return {
        face: i + 1,
        na: na ? mm(na.getBoundingClientRect().height) : 0,
        subj: !!subj, choice: !!choice,
        hasTitle: !!title,
        naTop: na ? mm(na.getBoundingClientRect().top - fb.top) : null,
        naBot: na ? mm(na.getBoundingClientRect().bottom - fb.top) : null
      };
    });
    return {
      info: info,
      faceCount: faces.length,
      choiceTipSizes: [...new Set(choiceTips.map(e => getComputedStyle(e).fontSize))],
      choiceTipCount: choiceTips.length,
      subjTipSizes: [...new Set(subjTips.map(e => getComputedStyle(e).fontSize))],
      blank: blank
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 900));
  else {
    const d = r.result.result.value;
    console.log('previewInfo:', d.info);
    console.log('总面数:', d.faceCount, '(偶数 =', d.faceCount % 2 === 0, ')');
    console.log('选择题续页提示：出现 ' + d.choiceTipCount + ' 次，字号',
      JSON.stringify(d.choiceTipSizes));
    console.log('非选择题提示：字号', JSON.stringify(d.subjTipSizes));
    console.log('字号一致:', JSON.stringify(d.choiceTipSizes) === JSON.stringify(d.subjTipSizes));
    console.log('\n各面：');
    d.blank.forEach(f => console.log('  面' + f.face + '  非答题区高 ' + f.na +
      '  顶 ' + f.naTop + ' 底 ' + f.naBot +
      '  非选红框=' + f.subj + ' 选择红框=' + f.choice + ' 页眉标题=' + f.hasTitle));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
