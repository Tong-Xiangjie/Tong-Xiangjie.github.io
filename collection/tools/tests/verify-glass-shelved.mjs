// 验收：液态玻璃已封存 ——「我的」里不该再出现它的任何痕迹。
//
// 用户报的问题（原话）：「现在液态玻璃功能暂时封存，然而界面风格……还是显示在"我的"」。
//
// 原因：封存是通过 CSS 藏的（layout.css 末尾三条 display:none），但
//   renderToggleRow() 生成的行是 `.toggle-card`，那条
//   `.settings-row:has(#uiStyleSwitch)` **永远匹配不上** ⇒ 只藏掉了小开关，
//   「界面风格」标题 + 「液态玻璃」标签 + 那段说明照旧显示。
// 修法：theme.js 的封存段挂出 isLiquidGlassShelved()，settings.js 用它**整块不渲染**
//   （连小节标题一起），而不是继续猜 CSS 藏没藏住。
//
// 判据：
//   ★ ① 认的是**渲染结果**（DOM 与可见性），不是"源码里有没有 if" ——
//     上一版就是源码看着没问题、界面上还挂着。
//   ★ ② 扫的是整个 document.body 的文本，不只是设置容器：别处再冒出来一样算失败。
//   ★ ③ 要证"封存是有牙齿的"：程序化点开关、以及本地残留 = glass 时刷新，
//     都必须回到标准风格 —— 否则只是把入口藏起来，功能还活着。
//   ★ ④ 反向守一句：不能靠"把整片设置删掉"来让 ① 通过 ——「外观」「主题色」
//     这些必须还在。
//
// 想恢复液态玻璃功能时：这个用例应当**一起删掉或改写**（它守的就是"已封存"这个状态）。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpGlassShelved-'));
const DP = 17390;
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

const boot = async hash => {
  await send('Page.navigate', { url: BASE + 'index.html' + hash });
  await sleep(3800);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };`);
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await boot('#settings');

  // ─────────── ⓪ 前提自检 ───────────
  console.log('\n══════ ⓪ 前提自检 ══════\n');
  const pre = await J(`return { shelvedFn: (typeof isLiquidGlassShelved === 'function'),
    shelved: (typeof isLiquidGlassShelved === 'function') ? isLiquidGlassShelved() : null,
    uiStyle: document.documentElement.getAttribute('data-ui-style'),
    sections: getRenderContainer().querySelectorAll('.settings-section').length,
    isSettings: isSettingsMode };`);
  ok(pre.isSettings && pre.sections > 5, `确实在设置页上（${pre.sections} 个小节）`);
  ok(pre.shelvedFn && pre.shelved === true, `封存判据存在且为真（isLiquidGlassShelved=${pre.shelved}）`);
  ok(pre.uiStyle === 'standard', `当前风格是标准实色（data-ui-style=${pre.uiStyle}）`);

  // ─────────── ① 「我的」里没有任何液态玻璃痕迹 ───────────
  console.log('\n══════ ① 「我的」里不留痕迹（DOM 与文本都算）══════\n');
  const gone = await J(`var app = getRenderContainer();
    var bodyText = document.body.textContent || '';
    return {
      label: [...app.querySelectorAll('.toggle-label')].some(l => l.textContent.trim() === '液态玻璃'),
      desc: [...app.querySelectorAll('.toggle-desc')].some(d => d.textContent.indexOf('液态玻璃') >= 0),
      h3Jiemian: [...app.querySelectorAll('h3')].some(h => h.textContent.trim() === '界面风格'),
      h3Bg: [...app.querySelectorAll('h3')].some(h => h.textContent.trim() === '背景风格'),
      switchEl: !!document.getElementById('uiStyleSwitch'),
      bgSection: !!document.getElementById('glassBgSection'),
      cards: document.querySelectorAll('.glass-preview-card').length,
      previews: document.querySelectorAll('[data-glass-preview]').length,
      orbs: !!document.getElementById('glassOrbs'),
      bodyMentions: bodyText.indexOf('液态玻璃') >= 0,
      bodyMentionsGlassword: bodyText.indexOf('backdrop-filter') >= 0
    };`);
  ok(gone.label === false && gone.desc === false,
    `没有「液态玻璃」标签，也没有那段说明文字 —— 用户报的就是这两行还在`);
  ok(gone.h3Jiemian === false && gone.h3Bg === false,
    `「界面风格」「背景风格」两个小节标题都没渲染（不留空标题）`);
  ok(gone.switchEl === false && gone.bgSection === false && gone.cards === 0 && gone.previews === 0,
    `开关 / 背景风格区块 / 四张预览卡都不在 DOM 里（不是靠 CSS 藏着）`);
  ok(gone.bodyMentions === false && gone.bodyMentionsGlassword === false,
    `整个页面的可见文本里都搜不到"液态玻璃"，也没有 backdrop-filter 那段描述`);
  ok(gone.orbs === false, `背景层元素（#glassOrbs）也不存在`);

  // ─────────── ② 封存是有牙齿的：程序化也打不开 ───────────
  console.log('\n══════ ② 程序化点开关 / 本地残留都回不到玻璃 ══════\n');
  const teeth = await J(`try { if (typeof toggleUIStyle === 'function') toggleUIStyle(); } catch (e) { }
    try { if (typeof setUIStyle === 'function') setUIStyle('glass'); } catch (e) { }
    try { if (typeof setGlassBg === 'function') setGlassBg('nebula'); } catch (e) { }
    await __sleep(300);
    return { uiStyle: document.documentElement.getAttribute('data-ui-style'),
             isGlass: (typeof isGlassStyle === 'function') ? isGlassStyle() : null,
             orbs: !!document.getElementById('glassOrbs') };`);
  ok(teeth.uiStyle === 'standard' && teeth.isGlass === false && teeth.orbs === false,
    `调 toggleUIStyle()/setUIStyle('glass') 之后仍然是标准风格（data-ui-style=${teeth.uiStyle}）`);

  // 本地残留：写一个 =glass 再**真刷新**，开机必须强制回标准。
  //   ★ 必须用 Page.reload 而不是再 navigate 一次同样的 '#settings' ——
  //     同 URL 同 hash 是**同文档导航**，文档根本不重载，开机那段强制不会跑
  //     （第一版就是这么写的，读回来的还是 glass；这是用例自己的坑，不是功能的问题）。
  await evaluate(`try { localStorage.setItem('collection-ui-style', 'glass'); } catch (e) { }`);
  await send('Page.reload');
  await sleep(3800);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };`);
  const stale = await J(`return { uiStyle: document.documentElement.getAttribute('data-ui-style'),
    isGlass: (typeof isGlassStyle === 'function') ? isGlassStyle() : null,
    ls: (function(){ try { return localStorage.getItem('collection-ui-style'); } catch(e) { return null; } })(),
    orbs: !!document.getElementById('glassOrbs') };`);
  ok(stale.uiStyle === 'standard' && stale.isGlass === false && stale.ls === 'standard',
    `本地残留 = glass 时刷新也回标准（读到 ${stale.ls}，样式 ${stale.uiStyle}）`);

  // ─────────── ③ 反向守一句：别把整片设置删了 ───────────
  console.log('\n══════ ③ 「外观」「主题色」等照旧在（不是把整片设置删了）══════\n');
  const rest = await J(`var app = getRenderContainer();
    var heads = [...app.querySelectorAll('h3')].map(h => h.textContent.trim());
    return { heads: heads,
      hasAppearance: heads.indexOf('外观') >= 0,
      hasThemeColor: heads.indexOf('主题色') >= 0,
      schemeSeg: !!document.getElementById('colorSchemeSeg'),
      swatches: document.querySelectorAll('#settingsThemeColors > *').length,
      settingsRows: app.querySelectorAll('.toggle-card').length };`);
  ok(rest.hasAppearance && rest.schemeSeg, `「外观」（明暗三态）还在`);
  ok(rest.hasThemeColor && rest.swatches > 5, `「主题色」还在（${rest.swatches} 个色块）`);
  ok(rest.settingsRows > 3, `其它开关行照旧渲染（共 ${rest.settingsRows} 行）—— 只摘掉了玻璃那两节`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 液态玻璃封存检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 液态玻璃封存检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
