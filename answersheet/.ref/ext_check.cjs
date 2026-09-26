/* 核对本轮两条改动：
   ① 红框上/下缘各可超出答题区 0.7×cornerH（A4 = 2.961mm）
   ② 页脚固定在下方定位点**中心**高度（286），与红框解耦 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9523;
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

  const run = async (nc, ns) => {
    const E = `(() => {
      const set=(i,v)=>{const e=document.getElementById(i);if(e)e.value=v;};
      set('cardTitle','测试'); set('cardSubject','物理');
      set('choiceTotal','${nc}'); set('choiceStart','1');
      set('subjStart','13'); set('subjCount','${ns}');
      set('subjScore', Array.from({length:${ns}},()=>'10').join(','));
      set('subjLines', Array.from({length:${ns}},()=>'8').join(','));
      document.getElementById('btnGenerate').click();
      const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
      const P = window.AS.config.PRESETS.A4, G = window.AS.geometry, C = window.AS.config;
      const out = [];
      const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
      let fi = 0;
      pages.forEach(function (pg) {
        pg.querySelectorAll('.as-face').forEach(function (fe) {
          const fb = fe.getBoundingClientRect();
          const S = fb.width / 210;
          const mm = v => Math.round((v / S) * 1000) / 1000;
          const corners = Array.from(fe.querySelectorAll('.as-corner, .as-mark-corner'))
            .map(e => { const q = e.getBoundingClientRect();
              return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top) }; })
            .sort((a, b) => a.t - b.t);
          const reds = Array.from(fe.querySelectorAll('.as-choice-outer, .as-subject-outer, .as-noanswer'))
            .map(e => { const q = e.getBoundingClientRect();
              return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top) }; });
          const foot = fe.querySelector('.as-footer');
          out.push({
            face: fi + 1,
            topMarkBot: corners.length ? corners[0].b : null,
            botMarkTop: corners.length ? corners[corners.length - 1].t : null,
            botMarkBot: corners.length ? corners[corners.length - 1].b : null,
            topMarkCy: corners.length ? mm((corners[0].t + corners[0].b) / 2 * 1) : null,
            redTop: reds.length ? Math.min.apply(null, reds.map(r => r.t)) : null,
            redBot: reds.length ? Math.max.apply(null, reds.map(r => r.b)) : null,
            footT: foot ? mm(foot.getBoundingClientRect().top - fb.top) : null,
            footB: foot ? mm(foot.getBoundingClientRect().bottom - fb.top) : null
          });
          fi++;
        });
      });
      return {
        A_TOP: G.answerTop(P), A_BOT: G.answerBottom(P, 297),
        F_TOP: G.frameTopLimit(P), F_BOT: G.frameBottomLimit(P, 297),
        EXT: G.frameExtend(P), cornerH: P.cornerH, out
      };
    })()`;
    const r = await send('Runtime.evaluate', { expression: E, returnByValue: true });
    if (r.result?.exceptionDetails) { console.log('EXC', r.result.exceptionDetails.exception?.description?.slice(0, 700)); return null; }
    return r.result.result.value;
  };

  for (const [nc, ns] of [[12, 2], [0, 2], [300, 2]]) {
    const d = await run(nc, ns);
    if (!d) continue;
    console.log('\n═══ 选择 ' + nc + ' + 非选 ' + ns + ' 题 ═══');
    console.log('cornerH=' + d.cornerH + '  0.7×cornerH = ' + d.EXT);
    console.log('答题区 ' + d.A_TOP + ' .. ' + d.A_BOT);
    console.log('红框可达 ' + d.F_TOP + ' .. ' + d.F_BOT +
      '   (上界 − 上角标下缘 = ' + (Math.round((d.F_TOP - d.A_TOP) * 1000) / 1000) +
      ', 下界 − 下角标上缘 = ' + (Math.round((d.F_BOT - d.A_BOT) * 1000) / 1000) + ')');
    d.out.forEach(f => {
      console.log('  面' + f.face + '  上角标下缘 ' + f.topMarkBot + '  下角标 ' +
        f.botMarkTop + '..' + f.botMarkBot + ' (心 ' +
        (Math.round((f.botMarkTop + f.botMarkBot) / 2 * 1000) / 1000) + ')');
      console.log('        红框 ' + f.redTop + ' .. ' + f.redBot);
      console.log('        页脚 ' + f.footT + ' .. ' + f.footB + '  中线 ' +
        (f.footT !== null ? Math.round((f.footT + f.footB) / 2 * 1000) / 1000 : '—'));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
