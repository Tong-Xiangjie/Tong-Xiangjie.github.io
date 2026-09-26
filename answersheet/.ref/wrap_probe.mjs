/* 量选择题换行后的结构：每行的左侧定位点、行心、行间空档。
   用法：node .ref\wrap_probe.mjs [A4|A3] [题数] */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9397;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const FMT = process.argv[2] || 'A4';
const N = process.argv[3] || '40';

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
    set('choiceTotal','${N}'); set('choiceStart','1');
    set('subjStart','999'); set('subjCount','0'); set('subjScore',''); set('subjLines','');
    window.AS.app.generate();
    const st = document.querySelector('#stage'); st.style.transform = 'none';
    const card = document.querySelector('#stage .as-face');
    const pr = card.getBoundingClientRect();
    const mm = v => Math.round(v * 25.4 / 96 * 1000) / 1000;
    const rel = e => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };
    // 左侧定位点（只取选择题网格范围内 y 90~160 的）
    const marks = Array.from(card.querySelectorAll('.as-mark-left'))
      .map(rel).filter(m => m.t > 85 && m.t < 180);
    // 每行的行心
    const lines = Array.from(card.querySelectorAll('.as-choice-line')).map(ln => {
      const nums = Array.from(ln.querySelectorAll('.as-choice-num'));
      const opts = Array.from(ln.querySelectorAll('.as-bubble'));
      return {
        top: rel(ln).t,
        numCy: nums.length ? mm((nums[0].getBoundingClientRect().top +
                                 nums[0].getBoundingClientRect().bottom)/2 - pr.top) : null,
        firstNo: nums.length ? nums[0].textContent.trim() : '',
        lastOptCy: opts.length ? mm((opts[opts.length-1].getBoundingClientRect().top +
                                     opts[opts.length-1].getBoundingClientRect().bottom)/2 - pr.top) : null,
        nOpt: opts.length
      };
    });
    const grid = card.querySelector('.as-choice-grid');
    const gr = grid.getBoundingClientRect();
    return { marks, lines, gridT: mm(gr.top - pr.top), gridB: mm(gr.bottom - pr.top) };
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description?.slice(0, 700));
  } else {
    const d = res.result.result.value;
    console.log('格式=%s  题数=%s', FMT, N);
    console.log('网格 y %s → %s', d.gridT, d.gridB);
    console.log('\n左侧定位点（选择题区内）共 %d 个:', d.marks.length);
    d.marks.forEach(m => console.log('   y %8s → %8s   心 %8s',
      m.t, m.b, Math.round((m.t + m.b) / 2 * 1000) / 1000));
    console.log('\n各行:');
    d.lines.forEach((L, i) => {
      console.log('  第%d行 top=%s  首题号=%s  题号心=%s  末选项心=%s  (%d 个气泡)',
        i, L.top, L.firstNo, L.numCy, L.lastOptCy, L.nOpt);
    });
    if (d.lines.length > 1) {
      const a = d.lines[0], b = d.lines[1];
      console.log('\n换行处：上一行末选项心 %s → 下一行题号心 %s   Δ=%s',
        a.lastOptCy, b.numCy, Math.round((b.numCy - a.lastOptCy) * 1000) / 1000);
      console.log('        上一行 top %s → 下一行 top %s   Δ=%s',
        a.top, b.top, Math.round((b.top - a.top) * 1000) / 1000);
    }
  }
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
