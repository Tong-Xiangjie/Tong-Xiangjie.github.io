// 验收：「币海拾年」时间轴在手机宽度下不超出屏幕。
//
// 背景（用户报的 bug）：手机上 .timeline-img 的宽度撑破了屏幕。
//   原因：手机规则里写的是 `.timeline-img { width: 100% }`，但
//     · 父级 .timeline-images 是 `display:flex; flex-shrink:0`（不允许收缩）
//     · .timeline-card 在手机上变成 `flex-direction: column`，
//       而它的 `align-items: flex-start` 让子项按**内容宽度**排
//   于是 .timeline-images 的宽度要按"内容最大宽度"算，而 width:100% 的图片
//   其最大宽度恰恰是图片自身的固有宽度（大图上千 px），两者互相撑 → 超出屏幕。
//
// 所以这个验收用**真实浏览器 + 真实手机视口**量几何，而不是读 CSS 文本：
//   1. 文档不许有横向溢出
//   2. 每个 .timeline-images / .timeline-img 都必须落在视口和卡片内
//   3. 图片要有合理的可见宽度（别缩成 0）
//   4. 桌面宽度下不能改坏（仍然是 80x60 的小图）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpTimeline-'));
const DP = 10841;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// 在当前视口下量时间轴的几何
async function measure() {
  return JSON.parse(await evaluate(`(()=>{
    const vw = window.innerWidth;
    const de = document.documentElement;
    const items = [...document.querySelectorAll('.timeline-item')];
    const cards = [...document.querySelectorAll('.timeline-card')];
    const wraps = [...document.querySelectorAll('.timeline-images')];
    const imgs = [...document.querySelectorAll('.timeline-img')];
    const r = el => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    // 全文档扫描：还有没有别的元素横向溢出（不只是时间轴）
    const over = [];
    for (const el of document.querySelectorAll('.timeline-item *')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > vw + 0.5) over.push({ cls: el.className || el.tagName, right: +b.right.toFixed(1), w: +b.width.toFixed(1) });
    }
    return JSON.stringify({
      vw,
      scrollW: de.scrollWidth, clientW: de.clientWidth,
      itemCount: items.length, imgCount: imgs.length,
      wrapW: wraps.map(x => r(x).w), wrapRight: wraps.map(x => r(x).r),
      cardW: cards.map(x => r(x).w), cardRight: cards.map(x => r(x).r),
      img: imgs.slice(0, 6).map(x => r(x)),
      imgMaxRight: imgs.length ? Math.max(...imgs.map(x => x.getBoundingClientRect().right)) : 0,
      imgMaxW: imgs.length ? Math.max(...imgs.map(x => x.getBoundingClientRect().width)) : 0,
      overflow: over.slice(0, 5)
    });
  })()`));
}

try {
  await send('Page.enable'); await send('Runtime.enable');

  // ---------- 手机视口 ----------
  const PHONES = [{ w: 320, h: 568, n: '320（小屏手机）' }, { w: 375, h: 812, n: '375（iPhone）' }, { w: 414, h: 896, n: '414（大屏手机）' }];
  for (const ph of PHONES) {
    await send('Emulation.setDeviceMetricsOverride', { width: ph.w, height: ph.h, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE + 'index.html#special/timeline' });
    await sleep(3500);
    // 等时间轴真的渲染出来
    for (let i = 0; i < 40; i++) {
      const n = await evaluate(`(()=>document.querySelectorAll('.timeline-img').length)()`).catch(() => 0);
      if (n > 0) break;
      await sleep(400);
    }
    await sleep(600);
    const m = await measure();
    console.log(`\n══════ 手机视口 ${ph.n} ══════`);
    console.log(`  视口宽 ${m.vw}；文档 scrollWidth=${m.scrollW} clientWidth=${m.clientW}；条目 ${m.itemCount}，图片 ${m.imgCount}`);
    console.log(`  .timeline-images 宽 ${JSON.stringify(m.wrapW)}（卡片宽 ${JSON.stringify(m.cardW)}）`);
    console.log(`  图片几何（前 6 个）: ${JSON.stringify(m.img)}`);
    if (m.overflow.length) console.log(`  ⚠ 溢出元素: ${JSON.stringify(m.overflow)}`);

    ok(m.imgCount > 0, `时间轴图片渲染出来了（${m.imgCount} 张）`);
    ok(m.scrollW <= m.clientW + 1, `文档没有横向溢出（scrollWidth ${m.scrollW} <= clientWidth ${m.clientW}）`);
    ok(m.imgMaxRight <= m.vw + 0.5, `所有图片右边缘都在视口内（最右 ${m.imgMaxRight.toFixed(1)} <= ${m.vw}）`);
    ok(m.overflow.length === 0, `时间轴里没有任何元素横向溢出（${m.overflow.length} 个）`);
    ok(m.wrapW.every((w, i) => w <= m.cardW[i] + 0.5), `.timeline-images 没有超出所属卡片`);
    ok(m.imgMaxW > 40, `图片没有被压成 0 宽（最宽 ${m.imgMaxW.toFixed(1)}px）`);
    ok(m.img.every(x => x.h > 0 && x.h <= 162), `图片高度受控（最大 ${Math.max(...m.img.map(x => x.h)).toFixed(1)} <= 162）`);
  }

  // ---------- 反向验证：把旧规则注入回去，确认这个探针真的能测出溢出 ----------
  // 不这么做的话，"全部通过"有可能只是因为探针根本没量到东西。
  // 旧规则就是修复前的那两行：
  //   .timeline-images { flex-shrink: 0 }   .timeline-img { width: 100% }
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE + 'index.html#special/timeline' });
  await sleep(3500);
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`(()=>document.querySelectorAll('.timeline-img').length)()`).catch(() => 0);
    if (n > 0) break;
    await sleep(400);
  }
  await sleep(600);
  const before = await measure();
  await evaluate(`(()=>{
    const st = document.createElement('style');
    st.id = 'simulate-old-rule';
    st.textContent = '@media (max-width:600px){'
      + '.timeline-images{width:auto !important;flex-shrink:0 !important;align-items:stretch !important;}'
      + '.timeline-img{width:100% !important;flex:none !important;max-width:none !important;height:auto !important;max-height:160px !important;}'
      + '}';
    document.head.appendChild(st);
    return true;
  })()`);
  await sleep(500);
  const after = await measure();
  console.log(`\n══════ 反向验证（把旧规则注入回去，375 宽） ══════`);
  console.log(`  修复后：图片最宽 ${before.imgMaxW.toFixed(1)}px，最右 ${before.imgMaxRight.toFixed(1)}，文档 scrollWidth ${before.scrollW}`);
  console.log(`  注入旧规则后：图片最宽 ${after.imgMaxW.toFixed(1)}px，最右 ${after.imgMaxRight.toFixed(1)}，文档 scrollWidth ${after.scrollW}`);
  ok(after.scrollW > after.clientW + 1 || after.imgMaxRight > after.vw + 0.5,
    `注入旧规则后确实溢出（scrollWidth ${after.scrollW} > ${after.clientW} 或最右 ${after.imgMaxRight.toFixed(1)} > ${after.vw}）—— 探针是灵敏的`);
  ok(before.scrollW <= before.clientW + 1 && before.imgMaxRight <= before.vw + 0.5,
    `而修复后的同一条件下不溢出（scrollWidth ${before.scrollW}，最右 ${before.imgMaxRight.toFixed(1)}）`);

  // ---------- 桌面视口（确认没改坏） ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + 'index.html#special/timeline' });
  await sleep(3500);
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`(()=>document.querySelectorAll('.timeline-img').length)()`).catch(() => 0);
    if (n > 0) break;
    await sleep(400);
  }
  await sleep(600);
  const d = await measure();
  console.log(`\n══════ 桌面视口 1280（确认没改坏） ══════`);
  console.log(`  图片几何（前 6 个）: ${JSON.stringify(d.img)}`);
  ok(d.imgCount > 0, `桌面下时间轴图片也在（${d.imgCount} 张）`);
  ok(d.img.every(x => Math.abs(x.w - 80) < 1.5 && Math.abs(x.h - 60) < 1.5),
    `桌面下仍然是原来的 80x60 小图（实测 ${JSON.stringify(d.img.slice(0, 2).map(x => [x.w, x.h]))}）`);
  ok(d.scrollW <= d.clientW + 1, `桌面下也没有横向溢出（${d.scrollW} <= ${d.clientW}）`);

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  await sleep(400);
  // ★ 必须显式退出：本地 HTTP server 还开着的话 node 不会自己结束，
  //   进程会一直挂在那儿（之前就因此留下过三个残留进程白占资源）。
  process.exit(fail ? 1 : 0);
}
