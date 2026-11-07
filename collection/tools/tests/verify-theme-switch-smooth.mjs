// 验收：切换明暗/主题色「平滑但没遮罩」—— 两个方向都要守。
//
// 用户报的：切换亮暗的时候整体文字等等会闪动。
//
// 逐帧实测（亮→暗，55 帧，requestAnimationFrame 采样）定位到根因：
//   1) t≈96~116ms，页面上被铺了一块 position:fixed;inset:0;z-index:2147483000、
//      底色 = 旧 --bg-solid 的**整屏不透明**遮罩（.theme-fade-overlay），360ms 才淡完；
//   2) 同一时刻 #app 被 WAAPI 压到 opacity 0.5 再淡回 1。
//   两者相乘，"文字可见度"在 t≈116ms **归零** —— 用户看到的是整页文字先被抹掉再淡出来。
//   它盖的是文字，不只是底色，所以这套手段本身就是闪烁源。
//
// 为什么现在敢直接撤掉（不是"眼不见为净"）：底色/文字/卡片色都是 CSS 变量，
//   layout.css 用 @property 把它们注册成可插值类型、html.theme-anim 那一小段挂过渡。
//   实测同一次切换：body 底色 / --text / h3 文字色**各有 18 个中间值**，
//   而且"有遮罩"与"无遮罩"两种跑法中间值个数**完全一样** ——
//   平滑来自变量插值，遮罩一点没帮忙，只是把文字盖住了。
//
// 所以本用例守两件事，缺一条都不算通过：
//   A. 切换全程**不许**出现整屏遮罩、#app 不透明度**不许**掉下来（文字不能被盖/被淡化）；
//   B. 但同一次切换**必须**真的是补间出来的（底色/文字色要有足够多中间值、首尾确实不同）
//      —— 否则"删干净了"就退化成"更快但更硬的突变"，那是更糟的结果。
//   ★ 顺带守住开屏：加载屏亮着的那段时间一次都不许有遮罩（老问题的复发口）。
//
// 历史：本文件的前身是 verify-theme-fade-scope.mjs，它守的是"遮罩只许在用户改主题时出现"。
//   那条守卫当年解决的是"开屏加载屏被遮罩盖住"，但把"用户切换时盖住文字"当成了正确行为 ——
//   现在整块遮罩都撤了，所以那个用例的前提消失，替换成本用例（开屏那条并进来了）。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpThemeSmooth-'));
const DP = 17420;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await (async function(){ ${e} })()); })()`));

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ★ 从 document-start 起盯着 body：谁铺了整屏遮罩、铺的时候加载屏是不是还亮着
const WATCH = `window.__ovWatch = { total: 0, duringSplash: 0, geo: null };
(function () {
  function splashUp() {
    try {
      if (!window.__booting) return false;
      var lc = document.getElementById('loadingContainer');
      if (!lc) return false;
      return getComputedStyle(lc).display !== 'none';
    } catch (e) { return false; }
  }
  function note(n) {
    if (!(n.nodeType === 1 && n.classList && n.classList.contains('theme-fade-overlay'))) return;
    window.__ovWatch.total++;
    if (splashUp()) window.__ovWatch.duringSplash++;
    try {
      var cs = getComputedStyle(n);
      var bg = cs.backgroundColor || '';
      var a = bg.match(/rgba?\\(([^)]+)\\)/);
      var parts = a ? a[1].split(',').map(function (v) { return parseFloat(v); }) : [];
      window.__ovWatch.geo = { position: cs.position, zIndex: parseInt(cs.zIndex, 10) || 0,
        width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height,
        opaque: (parts.length === 4 ? parts[3] : 1) >= 1 && bg.indexOf('rgba(0, 0, 0, 0)') < 0, background: bg };
    } catch (e) { }
  }
  var mo = new MutationObserver(function (rs) {
    for (var i = 0; i < rs.length; i++) for (var j = 0; j < rs[i].addedNodes.length; j++) note(rs[i].addedNodes[j]);
  });
  function arm() { if (document.body) mo.observe(document.body, { childList: true }); else setTimeout(arm, 0); }
  arm();
})();`;

// 在页面里逐帧采样一次切换：底色/文字色中间值 + #app 不透明度 + 遮罩不透明度
const SAMPLER = `window.__sampleSwitch = function (clickExpr, ms) {
  return (async function () {
    var app = document.getElementById('app');
    // ★ 取"当前可见容器里的标题"。不能图省事用 document.querySelector('#app h3') ——
    //   那会命中**隐藏的**其它视图容器里的标题，隐藏元素不跑过渡，颜色只有 1 个取值，
    //   于是断言永远红（第一版就是这么写的）。这里按"量得到高度"筛出可见的那个。
    var rc = (typeof getRenderContainer === 'function') ? getRenderContainer() : app;
    var h3 = null;
    if (rc) {
      h3 = [].slice.call(rc.querySelectorAll('h3')).filter(function (h) { return h.getBoundingClientRect().height > 0; })[0] || null;
    }
    var h3label = h3 ? (h3.textContent || '').trim().slice(0, 12) : '(没找到可见标题)';
    var s = [];
    var t0 = performance.now();
    function sample() {
      try {
        var cs = getComputedStyle(document.documentElement);
        var body = getComputedStyle(document.body);
        var ov = document.querySelector('.theme-fade-overlay');
        var ovOp = ov ? Number(getComputedStyle(ov).opacity) : 0;
        var appOp = app ? Number(getComputedStyle(app).opacity) : 1;
        s.push({ t: Math.round(performance.now() - t0),
          bodyBg: body.backgroundColor,
          text: cs.getPropertyValue('--text').trim(),
          h3: h3 ? getComputedStyle(h3).color : null,
          appOp: appOp, ovOp: ovOp, ovLive: !!ov,
          seen: Math.round((1 - ovOp) * appOp * 1000) / 1000,
          appAnims: app && app.getAnimations ? app.getAnimations().filter(function (a) { return a.playState === 'running'; }).length : 0 });
      } catch (e) { }
      if (performance.now() - t0 < ms) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    await new Promise(function (r) { setTimeout(r, 50); });
    var err = null;
    try { (new Function(clickExpr))(); } catch (e) { err = String(e && e.message); }
    await new Promise(function (r) { setTimeout(r, ms + 150); });
    function uniq(key) { var o = []; s.forEach(function (x) { if (o.indexOf(x[key]) < 0) o.push(x[key]); }); return o; }
    return { err: err, frames: s.length, h3label: h3label,
      bodyVals: uniq('bodyBg'), textVals: uniq('text'), h3Vals: uniq('h3'),
      ovFrames: s.filter(function (x) { return x.ovLive; }).length,
      ovMax: Math.max.apply(null, s.map(function (x) { return x.ovOp; })),
      minAppOp: Math.min.apply(null, s.map(function (x) { return x.appOp; })),
      minSeen: Math.min.apply(null, s.map(function (x) { return x.seen; })),
      appAnimFrames: s.filter(function (x) { return x.appAnims > 0; }).length };
  })();
};`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
  // 起始：亮色（先写偏好再重载，保证是"从亮切到暗"）
  await send('Page.navigate', { url: BASE + 'index.html?_=1#settings' });
  await sleep(3800);
  await evaluate(`try { localStorage.setItem('collection-color-scheme','light'); } catch(e){}`);
  await send('Page.reload');
  await sleep(3800);
  await evaluate(WATCH.replace('window.__ovWatch', 'window.__ovWatch') + '\n' + SAMPLER);

  console.log('\n══════ ⓪ 前提自检 ══════\n');
  const pre = await J(`var btn = document.querySelector('#colorSchemeSeg .seg-btn[data-value="dark"]');
    var cs = getComputedStyle(document.documentElement);
    return { hasBtn: !!btn, scheme: document.documentElement.getAttribute('data-color-scheme'),
      inlineTheme: document.documentElement.style.getPropertyValue('--theme').trim(),
      bg: getComputedStyle(document.body).backgroundColor,
      text: cs.getPropertyValue('--text').trim(),
      hasSampler: typeof window.__sampleSwitch === 'function',
      animClass: document.documentElement.classList.contains('theme-anim') };`);
  ok(pre.hasBtn && pre.scheme === 'light', `在「我的」上、当前是亮色（data-color-scheme=${pre.scheme}）`);
  ok(!!pre.inlineTheme && pre.hasSampler, `theme.js 跑过并落过调色板（内联 --theme=${pre.inlineTheme}），采样器就绪`);
  ok(pre.animClass === false, `平时不挂 .theme-anim（只在切换那一小段挂）`);

  console.log('\n══════ ① 开屏期间不许铺整屏遮罩 ══════\n');
  const boot = JSON.parse(await evaluate('JSON.stringify(window.__ovWatch)'));
  ok(boot.duringSplash === 0 && boot.total === 0,
    `开屏到渲染完，遮罩铺设次数 = ${boot.total}（加载屏亮着时 = ${boot.duringSplash}）—— 期望都是 0`);

  console.log('\n══════ ② 亮 → 暗：不许盖文字，但必须真的在补间 ══════\n');
  const a = await J(`return await window.__sampleSwitch("document.querySelector('#colorSchemeSeg .seg-btn[data-value=\\\\'dark\\\\']').click()", 900);`);
  ok(a.err === null, `切换调用没有报错${a.err ? '：' + a.err : ''}（采样 ${a.frames} 帧）`);
  ok(a.ovFrames === 0 && a.ovMax === 0,
    `★ 全程没有整屏遮罩（有遮罩的帧 ${a.ovFrames}/${a.frames}，最高不透明度 ${a.ovMax}）—— 用户报的"文字被抹掉"就是这个`);
  ok(a.minAppOp === 1 && a.appAnimFrames === 0,
    `★ #app 不透明度全程为 1、也没有动画在压它（最低 ${a.minAppOp}，有动画的帧 ${a.appAnimFrames}）`);
  ok(a.minSeen === 1, `★"文字可见度"（不透明度 × 未被遮罩盖住）全程 = ${a.minSeen}（期望 1）`);
  ok(a.bodyVals.length >= 6 && a.bodyVals[0] !== a.bodyVals[a.bodyVals.length - 1],
    `底色的确是补间出来的：${a.bodyVals.length} 个中间值，${a.bodyVals[0]} → ${a.bodyVals[a.bodyVals.length - 1]}`);
  ok(a.textVals.length >= 6 && a.textVals[0] !== a.textVals[a.textVals.length - 1],
    `文字色也是补间的：${a.textVals.length} 个中间值，${a.textVals[0]} → ${a.textVals[a.textVals.length - 1]}`);
  ok(a.h3Vals.length >= 6, `具体文字节点（"${a.h3label}"）也跟着插值：h3 有 ${a.h3Vals.length} 个中间色`);

  console.log('\n══════ ③ 暗 → 亮：同样两条都要成立 ══════\n');
  await sleep(700);
  const b = await J(`return await window.__sampleSwitch("document.querySelector('#colorSchemeSeg .seg-btn[data-value=\\\\'light\\\\']').click()", 900);`);
  ok(b.ovFrames === 0 && b.minAppOp === 1 && b.minSeen === 1,
    `回亮色同样：无遮罩（${b.ovFrames} 帧）、#app 不透明度最低 ${b.minAppOp}、文字可见度最低 ${b.minSeen}`);
  ok(b.bodyVals.length >= 6 && b.textVals.length >= 6,
    `而且仍然在补间：底色 ${b.bodyVals.length} 个中间值、文字色 ${b.textVals.length} 个`);

  console.log('\n══════ ④ 同一主题重复 applyTheme：调色板不该动 ══════\n');
  await sleep(700);
  const rep = await J(`var el = document.documentElement.style;
    function sig() { return [el.getPropertyValue('--bg'), el.getPropertyValue('--text'), el.getPropertyValue('--theme'), el.getPropertyValue('--card-bg')].join('|'); }
    var before = sig();
    applyTheme(localStorage.getItem('app-theme') || '#1677ff');
    var after = sig();
    await new Promise(function (r) { setTimeout(r, 500); });
    var ov = document.querySelectorAll('.theme-fade-overlay').length;
    return { same: before === after, before: before, ov: ov };`);
  ok(rep.same, `重复调用同一主题，调色板一字未变（${rep.before.split('|')[0]}…）`);
  ok(rep.ov === 0, `也没有留下任何遮罩（${rep.ov} 个）`);

  console.log('\n══════ ⑤ 减弱动效：直接到位，但仍不许有遮罩 ══════\n');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(200);
  const c = await J(`return await window.__sampleSwitch("document.querySelector('#colorSchemeSeg .seg-btn[data-value=\\\\'dark\\\\']').click()", 700);`);
  ok(c.ovFrames === 0 && c.minSeen === 1,
    `减弱动效下也没有遮罩、文字全程可见（遮罩 ${c.ovFrames} 帧，可见度最低 ${c.minSeen}）`);
  ok(c.bodyVals.length <= 3,
    `而且是"直接到位"（底色只有 ${c.bodyVals.length} 个取值，不补间）—— 尊重系统设置`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 明暗切换平滑性检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 明暗切换平滑性检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
