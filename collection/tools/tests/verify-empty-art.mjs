// 空状态插图验证：11 张自绘 SVG 是否都接进了空状态、能不能真显示出来、颜色是否跟主题走。
// 已进仓库：collection/tools/tests（A4）。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const KINDS = ['search', 'notes', 'coins', 'articles', 'special', 'shanhe', 'region', 'timeline', 'tag', 'stats', 'color'];

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ─────────── ① 静态：文件、XML、图元、CSS 规则、接线 ───────────
console.log('══════ ① 插图文件与 CSS 规则 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8');
const coreSrc = readFileSync('collection/core.js', 'utf8');
ok(/function emptyArt\s*\(/.test(coreSrc), 'core.js 里有 emptyArt() 助手');
const sites = [...readFileSync('collection/category-view.js', 'utf8') + readFileSync('collection/overview.js', 'utf8') +
  readFileSync('collection/search.js', 'utf8') + readFileSync('collection/article.js', 'utf8') +
  readFileSync('collection/special.js', 'utf8') + readFileSync('collection/stats.js', 'utf8') +
  readFileSync('collection/settings.js', 'utf8')].length; // 只为下面计数，占位
const allJs = ['category-view', 'overview', 'search', 'article', 'special', 'stats', 'settings']
  .map(f => readFileSync(`collection/${f}.js`, 'utf8')).join('\n');
const callCount = (allJs.match(/emptyArt\(/g) || []).length;
ok(callCount >= 19, `空状态接线处 ${callCount} 个（期望 ≥19：分类3页级+1行内/概览1/搜索1/文章2/专题7/统计3/设置1）`);

for (const k of KINDS) {
  const p = `collection/empty-${k}.svg`;
  if (!existsSync(p)) { ok(false, `${p} 存在`); continue; }
  const src = readFileSync(p, 'utf8');
  const good = /<svg[^>]*viewBox="0 0 200 200"/.test(src) && /stroke="#000000"/.test(src) &&
               !/<text/.test(src) && !/<path/.test(src) &&
               (src.match(/<(circle|rect|line|polyline|polygon)\b/g) || []).length >= 3;
  ok(good, `empty-${k}.svg：viewBox/纯黑线条/无文字/无 path/图元≥3`);
  const hasRule = new RegExp(`\\.empty-art-${k}\\s*\\{[^}]*mask-image:\\s*url\\('empty-${k}\\.svg'\\)`).test(css);
  ok(hasRule, `layout.css 里 .empty-art-${k} 指向 empty-${k}.svg`);
}
ok(/\.empty-art\s*\{[^}]*width:\s*84px/.test(css), '.empty-art 主尺寸 84px（块级）');
ok(/\.empty-art-sm\s*\{[^}]*inline-block[^}]*width:\s*18px/.test(css), '.empty-art-sm 行内小图 18px');
// 注意：不能用 indexOf('.empty-art-sm {') —— 合并选择器 ".empty-art, .empty-art-sm {" 里也有这个子串
ok(css.indexOf('.empty-art-sm { display: inline-block') > css.indexOf('.empty-art { display: block'),
   '.empty-art-sm 单独成块并排在 .empty-art 之后（才能覆盖尺寸）');

// ─────────── 起服务 + 无头浏览器 ───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpEA-'));
const DP = 11300 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
await send('Runtime.enable');
await send('Page.enable');

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(500);
}

// ─────────── ② 实时：逐个 kind 注入，量蒙版/解码/尺寸/主题色 ───────────
console.log('\n══════ ② 真浏览器里逐个 kind 渲染 ══════\n');
await boot('notes/rmb/rmb3');
const live = {};
for (const k of KINDS) {
  const html = `<span class="empty-art empty-art-${k}" aria-hidden="true"></span>`;
  const r = JSON.parse(await evaluate(`(async () => {
    const host = document.querySelector('.view-container, #categoryView, #listView, main') || document.body;
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.innerHTML = ${JSON.stringify(html)} + '文案';
    host.appendChild(d);
    const e = d.querySelector('.empty-art');
    const cs = getComputedStyle(e);
    const mask = (cs.maskImage && cs.maskImage !== 'none') ? cs.maskImage : (cs.webkitMaskImage || '');
    const m = /url\\(["']?([^"')]+)["']?\\)/.exec(mask);
    let svgOk = 'no-url', w = 0, h = 0;
    if (m) {
      const im = new Image();
      svgOk = await new Promise(res => { im.onload = () => res('load'); im.onerror = () => res('error'); im.src = m[1]; setTimeout(() => res('timeout'), 5000); });
      w = im.naturalWidth; h = im.naturalHeight;
    }
    const rect = e.getBoundingClientRect();
    const prev = (typeof getColorSchemeMode === 'function') ? getColorSchemeMode() : 'system';
    let light = '', dark = '';
    if (typeof setColorSchemeMode === 'function') {
      // ★ 切换后要**等调色板稳定**再采数，两侧都要等。
      //   明暗切换现在带 0.3s 的颜色补间（layout.css 用 @property 让变量逐帧插值），
      //   切完立刻读到的还是**切换前**的值。原来的写法只等了 dark 那一侧，于是：
      //   页面本来就在 dark 时，切 light 后立刻采样拿到的是 dark 值，
      //   再切回 dark 时颜色根本没动过 → 两次采到同一个颜色 → 假红。
      //   两侧都等到不动为止；如果真的一直一样，dark 仍等于 light，断言照旧会红，不会掩盖问题。
      const settle = async (read) => {
        let last = read(), stable = 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
          await new Promise(r => setTimeout(r, 40));
          const now = read();
          if (now === last) { if (++stable >= 3) return now; }
          else { stable = 0; last = now; }
        }
        return last;
      };
      const bgc = () => getComputedStyle(e).backgroundColor;
      setColorSchemeMode('light');
      light = await settle(bgc);
      setColorSchemeMode('dark');
      dark = await settle(bgc);
      setColorSchemeMode(prev);
    }
    const sm = document.createElement('span');
    sm.className = 'empty-art empty-art-sm empty-art-color';
    d.appendChild(sm);
    const smRect = sm.getBoundingClientRect();
    const out = { url: m ? m[1] : null, svgOk, w, h, bw: Math.round(rect.width), bh: Math.round(rect.height),
      display: cs.display, light, dark, smDisplay: getComputedStyle(sm).display, smW: Math.round(smRect.width), text: d.textContent };
    d.remove();
    return JSON.stringify(out);
  })()`));
  live[k] = r;
  const urlOk = r.url && r.url.endsWith(`collection/empty-${k}.svg`);
  const boxOk = r.bw === 84 && r.bh === 84;
  const themeOk = r.light && r.light !== 'rgba(0, 0, 0, 0)' && r.dark && r.light !== r.dark;
  ok(urlOk && r.svgOk === 'load' && boxOk && r.display === 'block' && themeOk,
     `empty-${k}：蒙版=${(r.url || '').split('/').pop()} 解码=${r.svgOk}(${r.w}x${r.h}) 盒=${r.bw}x${r.bh} display=${r.display} 浅=${r.light} 深=${r.dark}`);
  ok(r.smDisplay === 'inline-block' && r.smW === 18, `empty-${k}：行内小图 18px、display=inline-block`);
  ok(r.text === '文案', `empty-${k}：插图不带任何文字（textContent 只有外层的「文案」）`);
}

// ─────────── ③ 真实端到端：搜索一个不存在的词 ───────────
console.log('\n══════ ③ 真实触发：搜索无结果 ══════\n');
const typed = await evaluate(`(()=>{const i=document.getElementById('searchInput'); if(!i) return 'no-input'; i.focus(); i.value='zqxjw不存在的关键词'; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
ok(typed === 'ok', `找得到搜索框并输入（${typed}）`);
await sleep(1400);
const searched = JSON.parse(await evaluate(`(()=>{
  const a = document.querySelector('.empty-state .empty-art-search');
  const es = [...document.querySelectorAll('.empty-state')];
  return JSON.stringify({ hasArt: !!a, mask: a ? (getComputedStyle(a).webkitMaskImage || getComputedStyle(a).maskImage || '') : '',
    texts: es.map(e => (e.textContent || '').trim()).slice(0, 3) });
})()`));
ok(searched.hasArt, '搜索无结果时，空状态里出现了放大镜那张图（.empty-art-search）');
ok(/empty-search\.svg/.test(searched.mask), `它的蒙版指向 empty-search.svg（${(searched.mask || '').split('/').pop()}）`);
ok(searched.texts.some(t => t.includes('空空如也')), `原有文案没动：「${(searched.texts[0] || '').slice(0, 24)}」`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 5).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
