// 回归：历史记录 0 增长 + 手风琴 + 概览跳转，合并一次跑
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end(); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpX-'));
const DP = 9416;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const warns = [];
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(m.params.type)) warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0,110)); });

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/collection/` });
for (let i = 0; i < 220; i++) { await new Promise(r => setTimeout(r, 320)); try { if (await evaluate(`document.querySelectorAll('.search-result-item').length > 0 && typeof switchToCurrentContainer === 'function'`)) break; } catch (e) {} }

// ══════════════════════════════════════════════════════════════
// ★ E. 概览 → 详情 之间必须有**可测量的过渡**（本轮修的"突变"）
//
//   用户原话：「从概览页点进去详情条目似乎没有动画，是突变的。」
//
//   逐帧实测（改前，rAF 采样 #view-notes_category_commemorative 的容器）：
//     点下概览条目后 73 帧里容器 computed opacity 全程 = 1、animationName 全程 = none，
//     没有任何中间帧 —— 一帧内就换完了（对照：侧边栏切分类那条路有 16 帧斜坡）。
//   根因：navigateFromOverview() 把概览容器清空、切到分类容器、调
//   renderCurrentCategory() 直接写新 DOM，**全程没有触发任何进入动画**
//   （renderCurrentCategory → renderSeriesList 本身不带动画；带动画的是
//     renderOverview / renderCategoryOverview 那些分支，以及各侧边栏入口）。
//
//   修法：renderCurrentCategory() 之后调一次 core.js 的 triggerNavTransition()
//   （.content-enter-nav → navContentIn，0.2s 的淡入 + 6px 上移）。
//   ★ 只放在"概览点条目"这一条路上，不放进 renderSeriesList()：
//     那个函数是深链接冷启动（applyInitialRoute）等多条路径的公共出口，
//     给它们加动画会把"首帧就是终态"这件事弄回去（仓库刚修好的首帧零位移）。
//
//   这一段是本文件里唯一"逐帧采样"的地方，采样窗口必须**只覆盖本次导航**：
//   下面这一小节跑在 B 段那个循环**之前**，此时全页没有任何在播的动画，
//   所以只要采到 navContentIn 就一定是这次点击引起的。
// ══════════════════════════════════════════════════════════════
console.log('\nE. 概览 → 详情：过渡必须是"逐帧渐变"而不是突变');
const navAnim = JSON.parse(await evaluate(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (typeof navigateFromOverview !== 'function') return JSON.stringify({ err: 'navigateFromOverview 不存在' });
  // 回到全局概览（上一轮 E 可能已经走掉）
  currentMode = 'notes'; isSettingsMode = false;
  currentView = 'overview'; currentCategoryId = null; currentSubId = null;
  switchToCurrentContainer(); renderOverview();
  await sleep(250);
  const el = document.querySelector('.search-result-item');
  if (!el) return JSON.stringify({ err: '概览里没有条目' });
  const onclick = el.getAttribute('onclick') || '';
  const preKey = getContainerKey();
  const frames = [];
  const frame = tag => {
    const c = getRenderContainer();
    if (c) { const cs = getComputedStyle(c); frames.push({ tag: tag, t: Math.round(performance.now()),
      op: cs.opacity, anim: cs.animationName, dur: cs.animationDuration,
      kids: c.children.length, cls: c.className, id: c.id }); }
  };
  // ★ 同步钉首帧：click() 会让动画在**本次任务**里开始，而 requestAnimationFrame 的
  //   回调落在动画已经跑过几帧之后 —— 取不到 t=0 那个值。所以下面用
  //   "rAF + 25ms 轮询"两条腿：rAF 保证一定在**动画进行中**取到至少一帧，
  //   25ms 轮询保证斜坡的形状（改前两条腿都只会看到 op=1、anim=none）。
  const tick = () => new Promise(res => requestAnimationFrame(() => { frame('raf'); res(); }));
  el.click();
  const t0 = performance.now();
  await tick();
  for (let i = 0; i < 14; i++) { await sleep(25); frame('poll'); }
  await sleep(350);                 // 0.2s 动画收尾
  frame('end');
  const c = getRenderContainer();
  const cs = c ? getComputedStyle(c) : null;
  return JSON.stringify({ onclick: onclick, preKey: preKey, frames: frames, t0: Math.round(t0),
    endAnim: cs ? cs.animationName : '', endOp: cs ? cs.opacity : '',
    endKey: getContainerKey(), endHash: location.hash,
    endFirstChild: c && c.firstElementChild ? c.firstElementChild.className : '',
    hasTrigger: typeof triggerNavTransition === 'function' });
})()`));

let fail = 0;
{
  const F = navAnim.frames || [];
  const srcSnap = F.find(f => f.id === 'view-notes_overview');
  const winFrames = F.filter(f => f.tag !== 'end');
  const ops = winFrames.map(f => parseFloat(f.op));
  const mid = ops.filter(v => v > 0.02 && v < 0.98);
  const anims = [...new Set(F.map(f => f.anim))];
  const durs = [...new Set(F.map(f => f.dur))];
  const drops = [];
  for (let i = 1; i < ops.length; i++) drops.push(+(ops[i - 1] - ops[i]).toFixed(4));
  const maxDrop = drops.length ? Math.max(...drops) : 0;
  const endFrame = F[F.length - 1] || {};
  console.log(`  导航源：${navAnim.onclick || navAnim.err || '—'}（改前 preKey=${navAnim.preKey}）`);
  console.log(`  采样 ${F.length} 帧（窗口内 ${winFrames.length} 帧 + 收尾 1 帧），opacity：${ops.join(' / ')}`);
  console.log(`  本轮出现过的 animationName：${JSON.stringify(anims)}；animationDuration：${JSON.stringify(durs)}`);
  console.log(`  收尾：容器 key=${navAnim.endKey}、animationName=${navAnim.endAnim}、opacity=${navAnim.endOp}、hash=${navAnim.endHash}`);

  const chk = (cond, msg) => { if (cond) { console.log('   ✓ ' + msg); } else { console.log('   ✗ ' + msg); fail++; } };

  chk(!navAnim.err, `E1 概览点条目这条路走得通${navAnim.err ? '（' + navAnim.err + '）' : `（点的是 ${navAnim.onclick.slice(0, 46)}…）`}`);
  chk(navAnim.hasTrigger === true, 'E2 core.js 里确实有 triggerNavTransition()（导航过渡的入口）');
  chk(winFrames.length >= 8, `E3 采样窗口够长（窗口内 ${winFrames.length} 帧）—— 否则下面的"斜坡"没有分辨力`);
  // —— 核心：中间帧 ——
  chk(mid.length >= 3,
    `★ E4 概览 → 详情有**逐帧渐变**：中间态帧数 ${mid.length}（改前是 0 —— 73 帧全程 opacity=1、animationName=none）`);
  chk(mid.length >= 1 && mid[0] <= 0.5 && mid[mid.length - 1] >= 0.5,
    `★ E5 渐变方向是"由暗到亮"（首个中间值 ${mid.length ? mid[0] : '-'} ≤ 0.5、末个 ${mid.length ? mid[mid.length - 1] : '-'} ≥ 0.5）`);
  chk(maxDrop <= 0.6, `★ E6 没有单帧跳变（窗口内相邻帧最大跌幅 ${maxDrop} ≤ 0.6；0.2s 的缓动实测单帧跌幅约 0.2）`);
  // —— 动画名与时长 ——
  chk(anims.indexOf('navContentIn') >= 0, `★ E7 用的是这条导航专用的动画（animationName 里出现过 navContentIn：${JSON.stringify(anims)}）`);
  chk(anims.filter(a => a !== 'none' && a !== 'navContentIn').length === 0,
    `★ E8 这一场里没有别的动画混进来（只允许 navContentIn，实际 ${JSON.stringify(anims.filter(a => a !== 'none'))}）`);
  const d200 = durs.some(d => { const v = parseFloat(d); return Math.abs(v - 0.2) <= 1e-6 || Math.abs(v - 200) <= 1e-6; });
  chk(d200, `★ E9 时长就是"短、克制"的那一档 0.2s（实际 animationDuration=${JSON.stringify(durs)}；换板块用的 --dur-enter 是 0.36s —— 这里没误用它）`);
  // —— 收尾 ——
  chk(navAnim.endOp === '1', `E10 过渡结束后容器停在 opacity=1（实际 ${navAnim.endOp}）`);
  chk(navAnim.endKey !== navAnim.preKey && /^notes_category_/.test(navAnim.endKey),
    `E11 确实切到了分类容器（${navAnim.preKey} → ${navAnim.endKey}）—— 这条过渡没有被"根本没导航"蒙混过去`);
  chk(/content-enter-nav/.test(endFrame.cls || ''), `E12 过渡类名挂在这个容器上（class="${(endFrame.cls || '').slice(0, 60)}"）`);
  chk(navAnim.endFirstChild !== 'overview-header', `E13 容器里装的确实是目标分类的内容（首个孩子=${navAnim.endFirstChild}）`);
  if (srcSnap) console.log(`  （源容器快照：${srcSnap.id} / ${srcSnap.cls}）`);
}

const r = await evaluate(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const startLen = history.length;
  const hashSteps = [];
  const rec = () => hashSteps.push(location.hash);

  // ---- A. 侧边栏逐行开关手风琴（每条都点开、再收起）----
  let rowsTested = 0; const rowBad = [];
  const entries = [...document.querySelectorAll('.sidebar [onclick]')].filter(e => /onSidebarItemClick|onSidebarChildClick/.test(e.getAttribute('onclick')||''));
  for (const el of entries) {
    const label = (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,14);
    el.click(); await sleep(330);
    const c = getRenderContainer();
    for (const h of [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'))) {
      const body = h.parentNode.querySelector('.series-body');
      if (!body) continue;
      if (body.classList.contains('open')) { h.click(); await sleep(25); }
      const before = Math.round(body.getBoundingClientRect().height);
      h.click(); await sleep(300);
      const after = Math.round(body.getBoundingClientRect().height);
      rowsTested++;
      if (after <= before) rowBad.push({ label, before, after });
      // 顺便验证"展开时地址栏带 s、收起后去掉"
      const openNow = body.classList.contains('open');
      if (openNow && !/\\/s\\d+/.test(location.hash)) rowBad.push({ label, why: '展开但 hash 无 s', hash: location.hash });
      h.click(); await sleep(260);      // 收起，保持干净状态进入下一行
      if (/\\/s\\d+/.test(location.hash)) rowBad.push({ label, why: '收起后 hash 仍有 s', hash: location.hash });
    }
    rec();
  }

  // ---- B. 概览跳转全部数据源 ----
  let ovTested = 0; const ovBad = [];
  for (const mode of ['notes','coins']) {
    const map = mode==='notes' ? window.DATA_MAP : window.COIN_DATA_MAP;
    for (const dataKey of Object.keys(map)) {
      if (!map[dataKey] || !map[dataKey].series) continue;
      currentMode=mode; isSettingsMode=false; currentView='overview'; currentCategoryId=null; currentSubId=null;
      switchToCurrentContainer(); renderOverview(); await sleep(150);
      const t=[...document.querySelectorAll('.search-result-item')].find(el=>(el.getAttribute('onclick')||'').includes("'"+dataKey+"', 0,"));
      if(!t) continue;
      t.click(); await sleep(620);
      const c=getRenderContainer(); const b=c.querySelector('.series-body');
      if(!b){ovBad.push({dataKey,why:'无body'});continue;}
      ovTested++;
      if(b.getBoundingClientRect().height<=0||b.scrollHeight<=0) ovBad.push({mode,dataKey,h:Math.round(b.getBoundingClientRect().height),sh:b.scrollHeight});
      rec();
    }
  }

  // ---- C. 搜索连续输入 ----
  const sInput = document.getElementById('searchInput');
  for (const kw of ['人民','人民币','人民币五']) { sInput.value=kw; doSearch({replace:true}); await sleep(600); rec(); }

  // ---- D. 切板块 ----
  onTabClick('coins'); await sleep(500); rec();
  onTabClick('notes'); await sleep(700); rec();
  onTabClick('special'); await sleep(600); rec();
  onTabClick('notes'); await sleep(700); rec();

  return { startLen, endLen: history.length, hashSteps, rowsTested, rowBad,
           ovTested, ovBad, finalHash: location.hash };
})()`);

console.log(`A. 侧边栏逐行开关：${r.rowsTested} 行，问题 ${r.rowBad.length}`);
for (const b of r.rowBad.slice(0,8)) { console.log('   ✗ ' + JSON.stringify(b)); fail++; }
console.log(`B. 概览跳转：${r.ovTested} 个数据源，失败 ${r.ovBad.length}`);
for (const b of r.ovBad.slice(0,6)) { console.log('   ✗ ' + JSON.stringify(b)); fail++; }
console.log(`C. 历史记录：起始 ${r.startLen} → 结束 ${r.endLen}（增长 ${r.endLen - r.startLen}，应为 0）`);
if (r.endLen !== r.startLen) fail++;
console.log(`D. 地址栏共更新 ${new Set(r.hashSteps).size} 种不同 hash（说明确实在跟随）`);
console.log('');
console.log(fail === 0 ? '🟢 全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0,6).join(' | ') : '（无）'));
ws.close(); child.kill(); server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
