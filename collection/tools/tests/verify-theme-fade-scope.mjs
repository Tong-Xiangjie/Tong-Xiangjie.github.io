// 验收：主题的"溶解遮罩"(theme-fade-overlay) 只许在**用户主动改主题**时出现。
//
// 背景（用户报的 bug）：
//   开屏加载屏从"正在准备……"切到进度条那一下，整块文字消失约 100ms 再淡回来。
//   用 CDP screencast 逐帧量出来，是这么回事：t≈120ms 页面上被铺了一层
//   position:fixed;inset:0;z-index:2147483000、底色 = --bg-solid 的**整屏不透明**
//   遮罩（themeFadeOverlay），360ms 才淡完 —— 加载屏被整个盖住，
//   所以文字是"被抹掉再淡回来"，而不是"切换得不顺"。
//   本来有两层门该拦住它，两层都没拦住：
//     ① themeSignature() 前后根本不是一回事：变之前存的是 4 段签名，
//        变之后只取 data-ui-style ⇒ 永远不相等 ⇒ 连开机那一趟 applyTheme
//        都被当成"主题变了"；
//     ② applyTheme() 自己就会把 window.__glassUserAction 开闸，
//        所以"只有用户点开关才放行"那句注释形同虚设。
//   补第二个洞的时候还发现反向的坑：签名原来读 getComputedStyle，而
//   --theme/--theme-light 是 layout.css 里用 @property 注册的可过渡颜色，
//   改完变量的**同一帧**读到的还是过渡起点 ⇒ 又把"用户真换主题"整片漏掉
//   （实测换铜色后签名仍是 rgb(22,119,255)）。所以签名必须读内联样式。
//
// 判据（确定，不靠"碰运气采样那一瞬间"）：
//   ★ 开屏期间（从 document-start 起就挂 MutationObserver）**一次都不许**
//     创建 .theme-fade-overlay。这一条直接等于"加载屏有没有被盖住"。
//   ★ 用户主动改主题色 / 明暗时**必须**创建，而且它确实是"整屏不透明"的
//     （否则前一条就变得没有意义 —— 先证明这层遮罩真的能盖住整屏）。
//   ★ 反过来的坑也要守：#ffffff 这种色 L(0.35) 和 L(0.4) 都是 #ffffff，
//     只靠 --theme-light 分辨不出日夜切换，--bg-solid 必须算进签名。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpThemeFade-'));
const DP = 17350;
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

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// 从 document-start 起盯着 body：谁铺了溶解遮罩、铺的时候加载屏是不是还亮着
const WATCH = `window.__fadeWatch = { total: 0, duringSplash: 0, geo: null };
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
    window.__fadeWatch.total++;
    if (splashUp()) window.__fadeWatch.duringSplash++;
    try {
      var cs = getComputedStyle(n);
      var bg = cs.backgroundColor || '';
      var a = bg.match(/rgba?\\(([^)]+)\\)/);
      var parts = a ? a[1].split(',').map(function (v) { return parseFloat(v); }) : [];
      var alpha = parts.length === 4 ? parts[3] : 1;
      window.__fadeWatch.geo = {
        position: cs.position, zIndex: parseInt(cs.zIndex, 10) || 0,
        inset: [cs.top, cs.right, cs.bottom, cs.left].join('/'),
        width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height,
        opaque: alpha >= 1 && bg.indexOf('rgba(0, 0, 0, 0)') < 0,
        background: bg
      };
    } catch (e) { }
  }
  var mo = new MutationObserver(function (rs) {
    for (var i = 0; i < rs.length; i++) for (var j = 0; j < rs[i].addedNodes.length; j++) note(rs[i].addedNodes[j]);
  });
  function arm() { if (document.body) mo.observe(document.body, { childList: true }); else setTimeout(arm, 0); }
  arm();
})();`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  // 动画类断言一律先声明 no-preference：CI/无头环境的默认值不一定是我们以为的那个
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
  await send('Page.navigate', { url: BASE + 'index.html#notes' });
  await sleep(2800);

  console.log(`══════ 溶解遮罩的作用域：开屏不许铺，用户改主题必须铺 ══════\n`);

  const boot = JSON.parse(await evaluate('JSON.stringify(window.__fadeWatch)'));
  ok(boot.duringSplash === 0,
    `★ 开屏（加载屏还亮着）期间没有铺过整屏溶解遮罩 —— 实测 ${boot.duringSplash} 次（铺了就等于把"正在准备/进度"整块字盖住）`);
  ok(boot.total === 0, `开屏到首屏渲染完，遮罩总铺设次数 = ${boot.total}（期望 0）`);

  const first = await evaluate(`(async function(){
    // ★ MutationObserver 是**异步**投递的（微任务），所以读计数前必须让出一轮任务，
    //   否则刚铺上的遮罩还没被记到，会得到"没铺"的假通过/假失败。
    window.__step = function (fn) {
      var before = window.__fadeWatch.total, err = null;
      var sigBefore = themeSignature();
      try { fn(); } catch (e) { err = String(e && e.message); }
      var sigAfter = themeSignature();
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ added: window.__fadeWatch.total - before,
            live: document.querySelectorAll('.theme-fade-overlay').length,
            sigBefore: sigBefore, sigAfter: sigAfter,
            geo: window.__fadeWatch.geo, err: err });
        }, 40);
      });
    };
    var theme = localStorage.getItem('app-theme') || '#1677ff';
    var sig = '(themeSignature 不存在)';
    try { sig = themeSignature(); } catch (e) { }
    return JSON.stringify({
      theme: theme, sig: sig,
      hasApplyTheme: typeof applyTheme === 'function',
      hasSig: typeof themeSignature === 'function',
      bgSolid: document.documentElement.style.getPropertyValue('--bg-solid').trim(),
      themeVar: document.documentElement.style.getPropertyValue('--theme').trim()
    });
  })()`);
  const info = JSON.parse(first);
  const theme = info.theme;
  console.log(`  当前主题 ${theme}，签名 ${info.sig}\n`);

  // ★ 前置条件：这一刻 theme.js 必须真的跑起来了、applyTheme 也真的落过值。
  //   少了这一条，"开屏没铺遮罩"可能是因为整支 theme.js 根本没执行而**假通过**
  //   （实测：用编辑器把 theme.js 写坏一次，前两条断言照样是绿的）。
  ok(info.hasApplyTheme && info.hasSig && !!theme && !!info.bgSolid && !!info.themeVar,
    `前置条件：theme.js 已执行且 applyTheme 落过值（applyTheme=${info.hasApplyTheme} themeSignature=${info.hasSig} 内联 --theme=${info.themeVar || '(空)'} --bg-solid=${info.bgSolid || '(空)'}）`);

  // 同一主题重复调用：一次都不许铺（"我的"每次重绘都会调 applyTheme 的历史坑）
  //   ★ 这一步必须放在任何"真改主题"之前，否则就不是"同一主题"了
  const repeat = JSON.parse(await evaluate(`(async function(){
    var a = await window.__step(function () { applyTheme(${JSON.stringify(theme)}); });
    var b = await window.__step(function () { applyTheme(${JSON.stringify(theme)}); });
    return JSON.stringify([a, b]);
  })()`));
  ok(repeat.every(r => r.added === 0), `同一主题重复 applyTheme 两次，铺设次数 = [${repeat.map(r => r.added)}]（期望 [0,0]）`);
  ok(repeat.every(r => r.sigBefore === r.sigAfter), `  且签名确实一字未变：${repeat[0].sigBefore}`);

  // 再证明这层遮罩确实能盖住整屏（否则"开屏不许铺"这条守卫就只是个形式）
  const c = JSON.parse(await evaluate(`(async function(){
    return JSON.stringify(await window.__step(function () { setTheme('#b87333'); }));
  })()`));
  ok(c.added === 1, `用户换主题色（→ 铜色）铺了溶解遮罩：${c.added} 次（期望 1）`);
  ok(!!c.geo && c.geo.position === 'fixed' && c.geo.zIndex >= 1000000 && c.geo.opaque && c.geo.width > 1000 && c.geo.height > 700,
    `  且它确实是"整屏不透明覆盖"：position=${c.geo && c.geo.position} z-index=${c.geo && c.geo.zIndex} inset=${c.geo && c.geo.inset} ${c.geo && Math.round(c.geo.width)}x${c.geo && Math.round(c.geo.height)} 底色=${c.geo && c.geo.background} —— 所以铺在开屏上必然盖掉文字`);

  // 用户主动改主题：色相、明暗都得铺（每一步都必须真的换了主题，否则不铺是对的）
  const cases = [
    ['setColorSchemeMode 切白天', `setColorSchemeMode('light')`],
    ['setColorSchemeMode 切回黑夜', `setColorSchemeMode('dark')`],
    ['setTheme 换纯白（#ffffff）', `setTheme('#ffffff')`],
    ['纯白下切白天（--theme-light 分辨不出的对抗用例）', `setColorSchemeMode('light')`],
    ['纯白下切回黑夜', `setColorSchemeMode('dark')`],
    ['setTheme 换回默认蓝', `setTheme('${theme}')`]
  ];
  for (const [name, call] of cases) {
    const r = JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await window.__step(function () { ${call}; })); })()`));
    const changed = r.sigBefore !== r.sigAfter;
    ok(r.added === 1 && changed && !r.err,
      `${name}：铺设次数 = ${r.added}（期望 1）签名已变=${changed}${r.err ? ' 错误:' + r.err : ''}`);
  }

  const after = JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await window.__step(function () { applyTheme(${JSON.stringify(theme)}); })); })()`));
  ok(after.added === 0, `改完再重复一次：铺设次数 = ${after.added}（期望 0，不能残留"每次都铺"）`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
if (fail) { console.log(`✗ 溶解遮罩作用域检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 溶解遮罩作用域检查全部通过（${pass} 项断言）`);
