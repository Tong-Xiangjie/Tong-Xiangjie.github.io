const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9641;
const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const say = (...a) => { try { process.stderr.write(a.join(' ') + '\n'); } catch {} };
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--disable-application-cache',
  '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HARD = setTimeout(() => { say('HARD TIMEOUT'); try { chrome.kill(); } catch {} process.exit(3); }, 260000);
(async () => {
  let t = null;
  for (let i = 0; i < 80 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 600));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const raw = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const send = (m, p, ms) => Promise.race([raw(m, p), sleep(ms || 20000).then(() => ({ __to: true }))]);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1' }, 25000);
  await sleep(6000);
  await send('Runtime.evaluate', { expression: `(() => {
    const set=(i,v)=>{const e=document.getElementById(i);if(e) e.value=v;};
    set('cardTitle','2026届高三第一次模拟考试'); set('cardSubject','物理');
    set('choiceTotal','12'); set('choiceStart','1');
    set('subjStart','13'); set('subjCount','2'); set('subjScore','10,10'); set('subjLines','6');
    document.getElementById('btnGenerate').click();
    return 'ok';
  })()`, returnByValue: true }, 20000);
  await sleep(2200);

  const E = `(() => {
    const page = document.querySelector('#stage .as-page');
    const stage = page.closest('.preview-stage');
    const st = stage.style.transform, sw = stage.style.width;
    stage.style.transform = 'none';
    void page.offsetHeight;
    const pr = page.getBoundingClientRect();
    const S = pr.width / 210;
    const mm = v => Math.round(v / S * 1000) / 1000;

    function probeBaseline(el, refRect) {
      const p = document.createElement('span');
      p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden;margin:0;padding:0;border:0;';
      el.insertBefore(p, el.firstChild);
      const r = p.getBoundingClientRect();
      const top = r.bottom;
      el.removeChild(p);
      return top - refRect.top;
    }

    /* 三个代表性元素：
       ① 标题（黑体 24px，line-height 28.8px，居中）
       ② 注意事项正文（宋体 10.67px，多行）
       ③ 选择题题号（黑体 12.67px，line-height 12.67px，居中） */
    const targets = ['.as-title-main', '.as-note-main', '.as-choice-num'];
    const out = [];
    targets.forEach(function (sel) {
      const el = page.querySelector(sel);
      if (!el) { out.push({ sel: sel, ERR: 'not found' }); return; }
      const cs = getComputedStyle(el);
      const er = el.getBoundingClientRect();
      const baseOff = probeBaseline(el, er);
      const tn = Array.from(el.childNodes).filter(n => n.nodeType === 3 && n.nodeValue.trim())[0];
      const rec = { sel: sel, cls: String(el.className),
        fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontFamily: cs.fontFamily.split(',')[0],
        elTopMM: mm(er.top - pr.top), elHMM: mm(er.height), baseOffMM: mm(baseOff),
        baselineMM: mm(er.top - pr.top + baseOff),
        ranges: [] };
      if (tn) {
        const r = document.createRange();
        r.selectNodeContents(tn);
        const rs = r.getClientRects();
        for (let i = 0; i < Math.min(rs.length, 4); i++) {
          const rc = rs[i];
          rec.ranges.push({ i: i, topMM: mm(rc.top - pr.top), hMM: mm(rc.height),
            leftMM: mm(rc.left - pr.left), wMM: mm(rc.width), text: rc.width });
        }
      }
      out.push(rec);
    });

    /* 顺便验证：把文字换成 SimSun/SimHei 之外的同尺寸，宽度是否一致 → 略 */
    /* 再说一件事：确认字体真的用上了 SimHei/SimSun（不是回退） */
    const used = {};
    page.querySelectorAll('*').forEach(function (el) {
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3 && n.nodeValue.trim());
      if (!own.length) return;
      const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '');
      used[f] = (used[f] || 0) + 1;
    });

    stage.style.transform = st; stage.style.width = sw;
    return { scale: Math.round(S * 10000) / 10000, pageH: mm(pr.height), samples: out, fontsUsed: used };
  })()`;
  const r = await send('Runtime.evaluate', { expression: E, returnByValue: true }, 30000);
  say('MEASURE =', JSON.stringify(r.result?.result?.value, null, 1));
  logs.forEach(l => say('  log:', l.slice(0, 220)));
  clearTimeout(HARD);
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0);
})().catch(e => { say('ERR', e && e.stack ? e.stack : e); try { chrome.kill(); } catch {} process.exit(1); });
