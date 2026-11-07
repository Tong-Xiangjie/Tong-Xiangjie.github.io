// 验收：文章正文里的"引用 / 注释块"必须真的有一层与其他地方不同的底色。
//
// 用户报的：文章板块"引用块"的文字格式，原本应该底色填充和其他不同，
//   现在似乎只剩下左边那条主题色竖线。
//
// 查下来是**内容里的行内样式**把底色写成了页面底色，不是渲染环节坏了：
//   正文是 readmes/*.html 里的原始 HTML，这些块写作
//     <p style="background:var(--bg);border-left:3px solid var(--theme);padding:…">
//   而 --bg 就是页面底色（实测 .content / body 都是 --bg，.article-reader 自己没有底色），
//   所以那块"填充"铺上去等于没铺 —— 实测填充色与页面底色**逐字节相同**（对比度 1.00:1）。
//   左边竖线用的是 var(--theme)，所以那条还在 —— 正好就是用户看到的"只剩一条竖线"。
//   （全仓 23 处、18 个 div + 5 个 p，分散在 11 个 readme 里。）
//
// 修法：不改内容（23 处 + 以后新文章照抄还会错），在阅读器这一层统一给底色，
//   见 layout.css 里 `.article-reader [style*="border-left"][style*="solid var(--theme)"]`
//   那条（!important 压行内样式，底色取 --row-hover-bg）。
//
// 本用例守三件事：
//   ① 真实文章里的引用块，明暗两种模式下**都**要拿到填充，且与页面底色的对比度
//      达到站里自己认可的"看得出来"档（≥1.2；实测 1.25 / 1.40）。
//      比较时**必须把 alpha 合到页面底色上**再算 —— 填充是半透明浮层，
//      直接拿 rgba(0,0,0,.1) 当实色算会得出 18:1 这种假数字。
//   ② 标签无关：注入的 <div> 与 <p> 两种写法都要命中（readmes 里两种都有）。
//   ③ 不许误伤：不属于这个写法的（gkq_zhihu.html 里那条金色描边 #daa520）底色必须保持透明。
//   另：填充要跟着主题走 —— 切明暗后取值随之改变，且方向相反（浅色偏暗、深色偏亮）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, readdir } from 'node:fs/promises';
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpQuoteFill-'));
const DP = 17440;
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

// 把（可能是半透明的）填充色合到页面底色上再算对比度：
// 直接拿 rgba(0,0,0,.1) 当实色算会得到 18:1 这种假数字（第一版探针就踩了）。
function rgba(s) { const n = (s.match(/[\d.]+/g) || []).map(Number); return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; }
function over(f, b) { return [f.r * f.a + b.r * (1 - f.a), f.g * f.a + b.g * (1 - f.a), f.b * f.a + b.b * (1 - f.a)]; }
// ★ 入参可能是数组（over() 的结果）也可能是 {r,g,b}（rgba() 的结果），统一一下 ——
//   第一版混用，lum() 按数组取值拿到 undefined，对比度全算成 NaN。
function toArr(c) { return Array.isArray(c) ? c : [c.r, c.g, c.b]; }
function lum(c0) { const c = toArr(c0); const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const round2 = x => Math.round(x * 100) / 100;

try {
  // ─────────── 静态：内容里的写法有多少处、CSS 里那条规则在不在 ───────────
  console.log('\n══════ ⓪ 前提自检（静态）══════\n');
  const readmesDir = join(ROOT, 'notecollection', 'readmes');
  const files = (await readdir(readmesDir)).filter(f => f.endsWith('.html'));
  let hits = 0, divs = 0, ps = 0, hitFiles = 0;
  for (const f of files) {
    const src = await readFile(join(readmesDir, f), 'utf8');
    const re = /<(div|p)\b[^>]*style="[^"]*border-left:\s*3px solid var\(--theme\)/gi;
    let m, before = hits;
    while ((m = re.exec(src))) { hits++; if (m[1].toLowerCase() === 'div') divs++; else ps++; }
    if (hits > before) hitFiles++;
  }
  ok(hits >= 20 && divs > 0 && ps > 0,
    `正文里这种引用块共 ${hits} 处（div ${divs} + p ${ps}，分布在 ${hitFiles} 个 readme 里）—— 两种标签都要覆盖`);
  const css = await readFile(join(ROOT, 'collection', 'layout.css'), 'utf8');
  ok(/\.article-reader\s*\[style\*="border-left"\]\[style\*="solid var\(--theme\)"\]\s*\{[^}]*background-color:[^;}]*!important/.test(css),
    `layout.css 里有那条统一下发底色的规则（选择器 + !important 都在）`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + 'index.html#articles' });
  await sleep(4000);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };`);

  const OUT = {};
  for (const mode of ['light', 'dark']) {
    const r = await J(`
      var idx = -1;
      for (var i = 0; i < collectedArticles.length; i++) { if ((collectedArticles[i].contentPath || '').indexOf('republic_1914_5_yuan_fake_note_zhihu_lee') >= 0) { idx = i; break; } }
      if (idx < 0) return { error: '找不到那篇样本文章（共 ' + collectedArticles.length + ' 篇）' };
      setColorSchemeMode(${JSON.stringify(mode)});
      openArticleReader(idx);
      await __sleep(1300);
      var reader = document.querySelector('.article-reader');
      if (!reader) return { error: '没有 .article-reader' };
      var sel = '[style*="border-left"][style*="solid var(--theme)"]';
      var blocks = [].slice.call(reader.querySelectorAll('[style*="border-left"]'));
      var pageBg = getComputedStyle(document.querySelector('.content')).backgroundColor;
      // ① 真实文章里的引用块
      var real = blocks.map(function (b) {
        var s = getComputedStyle(b);
        return { tag: b.tagName, bg: s.backgroundColor, matched: b.matches(sel),
          inReader: reader.contains(b), h: Math.round(b.getBoundingClientRect().height) };
      });
      // ② 注入两种标签的写法，验证选择器与标签无关（同样的行内样式，只是标签不同）
      var probe = document.createElement('div');
      probe.id = '__probeQuote';
      probe.setAttribute('style', 'background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;');
      probe.textContent = '用例注入的引用块';
      reader.appendChild(probe);
      var probeP = document.createElement('p');
      probeP.id = '__probeQuoteP';
      probeP.setAttribute('style', 'background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;');
      probeP.textContent = '用例注入的引用块（p）';
      reader.appendChild(probeP);
      // ③ 反向：金色描边那种写法不属于此列，不许被加上底色
      var gold = document.createElement('div');
      gold.id = '__probeGold';
      gold.setAttribute('style', 'background:var(--bg);border-left: 3px solid #daa520;padding:0.5rem 1rem;');
      gold.textContent = '用例注入的金色描边块';
      reader.appendChild(gold);
      await __sleep(60);
      var g = function (id) { return getComputedStyle(document.getElementById(id)).backgroundColor; };
      var out = { pageBg: pageBg, bgVar: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        real: real, divBg: g('__probeQuote'), pBg: g('__probeQuoteP'), goldBg: g('__probeGold'),
        goldMatches: document.getElementById('__probeGold').matches(sel) };
      probe.remove(); probeP.remove(); gold.remove();
      return out;
    `);
    if (r.error) { ok(false, `${mode}：${r.error}`); continue; }
    OUT[mode] = r;
  }

  console.log('\n══════ ① 真实文章里的引用块：明暗两种模式都要有填充 ══════\n');
  for (const mode of ['light', 'dark']) {
    const r = OUT[mode];
    if (!r) { ok(false, `${mode}：没有取到数据`); continue; }
    const name = mode === 'light' ? '浅色' : '深色';
    const page = rgba(r.pageBg);
    ok(r.real.length >= 3, `${name}：样本文章里找到 ${r.real.length} 个引用块（够不够对比用）`);
    ok(r.real.every(x => x.matched), `${name}：${r.real.length} 个块全部命中新规则的选择器（不会漏掉没改到的写法）`);
    const bad = r.real.filter(x => rgba(x.bg).a === 0);
    ok(bad.length === 0, `${name}：没有"透明底"的引用块（透明 = 用户报的"只剩一条竖线"）`);
    const worst = r.real.map(x => ratio(over(rgba(x.bg), page), page)).sort((a, b) => a - b)[0];
    ok(worst >= 1.2, `${name}：填充与页面底色的对比度最低 ${round2(worst)}:1（≥1.2 才算"看得出来"；修前是 1.00:1）`);
    console.log(`      页面底 = ${r.pageBg}（--bg = ${r.bgVar}）  块底色 = ${r.real[0].bg}  块数 = ${r.real.length}`);
  }
  ok(OUT.light && OUT.dark && OUT.light.real[0].bg !== OUT.dark.real[0].bg,
    `填充跟着主题走：浅色 ${OUT.light && OUT.light.real[0].bg} ≠ 深色 ${OUT.dark && OUT.dark.real[0].bg}`);
  ok(OUT.light && OUT.dark && rgba(OUT.light.real[0].bg).r < rgba(OUT.dark.real[0].bg).r,
    `而且明暗方向是反的（浅色偏暗、深色偏亮）—— 与 theme.js 里"整行悬停底色按模式反着来"同一口径`);

  console.log('\n══════ ② 与标签无关：div 和 p 两种写法都要命中 ══════\n');
  for (const mode of ['light', 'dark']) {
    const r = OUT[mode]; if (!r) continue;
    const name = mode === 'light' ? '浅色' : '深色';
    const page = rgba(r.pageBg);
    ok(rgba(r.divBg).a > 0 && ratio(over(rgba(r.divBg), page), page) >= 1.2,
      `${name}：<div style="…border-left:3px solid var(--theme)"> 有填充（${r.divBg}）`);
    ok(rgba(r.pBg).a > 0 && ratio(over(rgba(r.pBg), page), page) >= 1.2,
      `${name}：<p style="…"> 同样有填充（${r.pBg}）`);
  }

  console.log('\n══════ ③ 不许误伤：金色描边那种写法保持原样 ══════\n');
  for (const mode of ['light', 'dark']) {
    const r = OUT[mode]; if (!r) continue;
    const name = mode === 'light' ? '浅色' : '深色';
    ok(r.goldMatches === false, `${name}：金色描边块不匹配这条选择器`);
    // ★ 期望不是"透明"：金色那块的**行内样式自己也写了 background:var(--bg)**，
    //   所以正确期望是"仍旧等于页面底色"（即没被新规则改成浮层色）。
    ok(r.goldBg === r.pageBg,
      `${name}：金色描边块底色仍是它自己行内的 --bg（${r.goldBg}），没被这条规则顺手改掉`);
    ok(r.goldBg !== r.real[0].bg, `${name}：而且与引用块的填充明显不是同一个值`);
  }
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 引用块填充检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 引用块填充检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
