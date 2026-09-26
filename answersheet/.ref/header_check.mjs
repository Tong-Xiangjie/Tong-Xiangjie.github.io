/* =============================================================================
 * 页眉碰撞检查：首页页眉里「注意事项框 / 准考证号栏 / 条形码框 / 标题」是否互相重叠。
 * 用 CDP 打开页面，量各块的实际矩形，两两求交，报告任何 > 0.3mm 的重叠。
 * ========================================================================== */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const URL = 'http://127.0.0.1:8137/index.html?cb=' + Date.now() + '&fresh=1';
const OUT = process.argv[2] || '.ref/header_check.txt';

const profile = mkdtempSync(join(tmpdir(), 'ascdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--disable-application-cache', '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      target = list.find(t => t.type === 'page');
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('no chrome target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const EXPR = `(() => {
    const out = { blocks: [], overlaps: [] };
    const card = document.querySelector('.as-page');
    if (!card) { out.err = 'no .as-page'; return out; }
    const pr = card.getBoundingClientRect();
    const st = card.closest('.preview-stage');
    const m = st ? getComputedStyle(st).transform : 'none';
    const k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\\(([^,]+)/) || [0,1])[1]);
    const mm = (v) => Math.round(v * 25.4 / 96 / k * 1000) / 1000;
    const pick = [
      ['标题', '.as-title'],
      ['信息行', '.as-info'],
      ['准考证号表', '.as-zk'],
      ['注意事项框', '.as-note'],
      ['示例提示', '.as-note-sample-tip'],
      ['缺考提示', '.as-note-absent-tip'],
      ['示例方框', '.as-check-box'],
      ['条形码框', '.as-barcode'],
      ['页脚', '.as-footer']
    ];
    pick.forEach(([name, sel]) => {
      const e = card.querySelector(sel);
      if (!e) return;
      const r = e.getBoundingClientRect();
      out.blocks.push({ name, l: mm(r.left - pr.left), r: mm(r.right - pr.left),
                        t: mm(r.top - pr.top), b: mm(r.bottom - pr.top),
                        w: mm(r.width), h: mm(r.height) });
    });
    for (let i = 0; i < out.blocks.length; i++) {
      for (let j = i + 1; j < out.blocks.length; j++) {
        const A = out.blocks[i], B = out.blocks[j];
        const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
        const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t);
        if (ox > 0.3 && oy > 0.3) {
          out.overlaps.push({ a: A.name, b: B.name,
                              ox: Math.round(ox * 1000) / 1000, oy: Math.round(oy * 1000) / 1000 });
        }
      }
    }
    return out;
  })()`;

  const res = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  const D = res.result?.result?.value;
  const lines = ['HEADER CHECK', JSON.stringify(D, null, 1)];
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
