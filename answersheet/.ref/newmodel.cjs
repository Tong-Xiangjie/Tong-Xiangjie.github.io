/* 全面核对新模型：答题区基准 / 红框撑满 / 非答题区 / 页脚 / 提示间隙 / 信息行。 */
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9501;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const NC = process.argv[3] || '12';
const SC = process.argv[4] || '2';
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
    const errs = [];
    window.onerror = (m, s, l, c, e) => { errs.push(String(m)); };
    const set=(id,v)=>{const e=document.getElementById(id); if(e) e.value=v;};
    set('cardTitle','测试'); set('cardSubject','物理');
    set('choiceTotal','${NC}'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','${SC}');
    set('subjScore', Array.from({length:${SC}},()=>'10').join(','));
    set('subjLines', '6');
    const b = document.querySelector('button[data-val=${JSON.stringify(FMT)}]');
    if (b) b.click();
    document.getElementById('btnGenerate').click();
    const st=document.querySelector('.preview-stage'); if(st) st.style.transform='none';
    const pages = Array.from(document.querySelectorAll('.preview-stage .as-page'));
    const paperW = ${JSON.stringify(FMT)} === 'A3' ? 420 : 210;
    const pr = pages[0].getBoundingClientRect();
    const S = pr.width / paperW;
    const mm = v => Math.round((v / S) * 1000) / 1000;
    const G = window.AS.geometry, Pg = window.AS.paginator;
    const out = [];
    pages.forEach(function (pg, pi) {
      pg.querySelectorAll('.as-face').forEach(function (face, fi) {
        const fb = face.getBoundingClientRect();
        const R = e => { const q = e.getBoundingClientRect();
          return { t: mm(q.top - fb.top), b: mm(q.bottom - fb.top),
                   l: mm(q.left - fb.left), r: mm(q.right - fb.left) }; };
        const corners = Array.from(face.querySelectorAll('.as-mark-corner, .as-corner'))
          .map(R).sort((a, b) => a.t - b.t);
        const reds = Array.from(face.querySelectorAll('.as-choice-outer, .as-subject-outer'))
          .map(e => ({ cls: e.className.replace('as-','').replace('-outer',''), ...R(e) }));
        const na = face.querySelector('.as-noanswer');
        const naT = face.querySelector('.as-noanswer-text');
        const foot = face.querySelector('.as-footer');
        const tips = Array.from(face.querySelectorAll('.as-subject-page-tip')).map(R);
        const blacks = Array.from(face.querySelectorAll('.as-choice-inner, .as-subject-inner-table'))
          .map(e => ({ cls: e.className, ...R(e) }));
        out.push({
          page: pi + 1, face: fi + 1,
          up: corners.length ? corners[0].b : null,
          dn: corners.length ? corners[corners.length-1].t : null,
          reds, blacks, tips,
          na: na ? { ...R(na), fontSize: naT ? getComputedStyle(naT).fontSize : null,
                     writing: naT ? getComputedStyle(naT).writingMode : null,
                     text: naT ? naT.textContent.slice(0,12) : null } : null,
          footer: foot ? R(foot) : null
        });
      });
    });
    const info = document.querySelector('.as-info-row');
    return {
      errs, fmt: ${JSON.stringify(FMT)},
      A_TOP: G.answerTop(window.AS.config.PRESETS[${JSON.stringify(FMT)}]),
      A_BOT: G.answerBottom(window.AS.config.PRESETS[${JSON.stringify(FMT)}], 297),
      F_TOP: G.frameTopLimit(window.AS.config.PRESETS[${JSON.stringify(FMT)}]),
      F_BOT: G.frameBottomLimit(window.AS.config.PRESETS[${JSON.stringify(FMT)}], 297),
      FOOTER_H: Pg.FOOTER_H, FRAME_V: Pg.FRAME_V, MIN: Pg.NOANSWER_MIN_H,
      dbg: Pg.lastDebug,
      infoText: info ? Array.from(info.children).map(c => c.className + ':' + c.textContent.trim().slice(0,6)) : null,
      hasClass: info ? info.innerHTML.indexOf('班级') >= 0 : null,
      emptyNA: document.querySelectorAll('.as-noanswer').length,
      out
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXC', res.result.exceptionDetails.exception?.description?.slice(0, 1600));
  } else {
    const d = res.result.result.value;
    if (d.errs && d.errs.length) console.log('JS 错误:', d.errs);
    console.log('答题区 ' + d.A_TOP + ' .. ' + d.A_BOT + '   红框可达 ' + d.F_TOP + ' .. ' + d.F_BOT + '   FRAME_V=' + d.FRAME_V + ' MIN=' + d.MIN);
    console.log('页脚块数 %s   信息行含「班级」=%s', d.emptyNA, d.hasClass);
    console.log('信息行子元素:', JSON.stringify(d.infoText));
    console.log('\nlastDebug.faces =');
    (d.dbg && d.dbg.faces || []).forEach((f, i) => {
      console.log('  面' + (i+1) + ' first=' + f.first + ' cursor=' + f.cursor + ' frameBot=' + f.frameBot + ' rest=' + f.rest + ' stretch=' + f.stretch + ' noAnswer=' + f.noAnswer + ' h=' + f.noAnswerH);
      f.body.forEach(b => console.log('       ', JSON.stringify(b)));
    });
    console.log('');
    d.out.forEach(f => {
      console.log('── 第%d张 第%d面   上角标下缘 %s   下角标上缘 %s',
        f.page, f.face, f.up, f.dn);
      f.reds.forEach(r => {
        const pad = (s, n) => String(s).padEnd(n);
        console.log('   红框 ' + pad(r.cls, 8) + ' y ' + r.t + ' → ' + r.b +
          '   x ' + r.l + ' → ' + r.r);
        if (f.dn !== null) console.log('         ↳ 下角标上缘 − 红框下缘 = ' +
          (Math.round((f.dn - r.b) * 1000) / 1000));
      });
      f.blacks.forEach(b => console.log('   黑框 ' + String(b.cls).slice(0, 26).padEnd(27) +
        ' y ' + b.t + ' → ' + b.b));
      f.tips.forEach((t, i) => console.log('   提示' + (i + 1) + '  y ' + t.t + ' → ' + t.b));
      if (f.na) console.log('   非答题区 y ' + f.na.t + ' → ' + f.na.b + '  h=' +
        (Math.round((f.na.b - f.na.t) * 1000) / 1000) + '  x ' + f.na.l + ' → ' + f.na.r +
        '  字号 ' + f.na.fontSize + '  排向 ' + f.na.writing + '  「' + f.na.text + '」');
      if (f.footer) console.log('   页脚   y ' + f.footer.t + ' → ' + f.footer.b);
      if (f.up !== null) console.log('   ↳ 上角标下缘 ' + f.up + ' → 第一红框上缘 ' +
        (f.reds.length ? f.reds[0].t : '—') + '  差 ' +
        (f.reds.length ? Math.round((f.reds[0].t - f.up) * 1000) / 1000 : '—'));
    });
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
