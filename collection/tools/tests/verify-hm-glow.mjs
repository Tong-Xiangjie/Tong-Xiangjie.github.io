// 币海拾年 · 「只有单个月份那个格子发光」验收（用户最终口径，两轮修正后的收口版）
//   「拾年那里，假如选取了单个月份，可以让这个热力图的边缘有发光效果。**仅限于选取单个月**。」
//   「不是，发光效果是要求热力图那个**月份的小方块**边缘发光，怎么变成了热力图发光？」
//   「**只有单个月分发光**」+ 追问里明确选「选"历年 X 月"（年份=全部）时，干脆不发光」。
//
// ★★★ 判定规则（唯一口径）：
//   只有"年份"与"月份"**都落在具体的某一个值上**（唯一确定一个格子）时，才给**那一格**发光；
//   其余情况一律不发光。发光对象永远是**格子自己**（不是整块热力图/网格外框）。
//   | 筛选状态                        | 发光格子数 |
//   | 某一年 + 某一月（2026 年 10 月） | 恰好 1 格（就是那一格） |
//   | 历年 X 月（年份=全部、月=07）    | 0 格 |
//   | 只筛某一年（年=2026、月=全部）   | 0 格 |
//   | 全部时间                        | 0 格 |
//
// 光色：浅色主题 = 站点主题色 var(--theme)；**暗色主题 = 白光**（用户：「暗色下不太显眼，可以调成白光」），
//   暗色判定沿用站点既有机制 html[data-color-scheme="dark"]（theme.js 的 applyColorScheme() 写的）。
// 光形：**只有一层柔光**（blur > 0、无 blur = 0 的"实圈"）—— 用户：「好像原来的那圈无渐变的光圈还在，
//   和渐变的叠在一起，我希望只有一层」。（更早还要求过"最外围淡化，不要硬边"，单层高斯柔光天然满足。）
//
// 断言覆盖：
//   ① 静态：判定判据源码（必须"年月都具体"+ 逐格比对格子自己的 data-year/data-month）、类只加在格子上、
//      "放松判定（历年 X 月也亮）"的那一版必须已经不在了、发光只用出流伪元素 + box-shadow + 不参与布局；
//   ② 上表四种状态**逐格枚举**（0/0/0/1）；
//   ③ 零位移：容器/每一行/图例/每一个格子的 rect 与 client/scroll 尺寸逐值不变（含 rAF 逐帧）；
//   ④ **发光格的四边外发光都可见**（对四个"角"上的格子逐个取像素证据：最上/最下/最左/最右），
//      并给"没选中的格子四边零变化"的反向证据；
//   ⑤ 命中测试与交互：发光格命中仍是它自己、邻格不漂移、hover 高亮/悬浮泡照旧；
//   ⑥ 两种主题：光色正确且互相排除 + 按距离分箱的强度剖面（峰值够、衰减快）；
//   ⑦ reduced-motion 下发光静止无动画；⑧ 其它板块不误伤 + 重回拾年/重新加载；⑨ 手机 375px 断点。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { decodePng, pixelAt } from './lib/pixel.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// box-shadow / 颜色解析（rgba() 与 Chrome 的 color(srgb …) 两种序列化都认）—— 静态节与运行时节共用
// 顶层逗号切分（括号感知：color-mix(in srgb, var(--theme) 30%, transparent) 里的逗号不算分隔符）
const splitTop = (s) => {
  const out = []; let d = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') d++;
    else if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
};
// 取一层的颜色 token：函数式的（color-mix()/rgba()）要**配平括号**地整段取出来，
// 否则 `p.replace(color,'')` 会把后面的 px 数字一起吃掉（color-mix 里还有 var(--theme) 嵌套）。
const pickColorToken = (p) => {
  const m = /color-mix\(|color\(|rgba?\(|#[0-9a-fA-F]{3,8}|transparent|currentcolor/.exec(p);
  if (!m) return '';
  if (/\($/.test(m[0])) {
    let d = 0;
    for (let i = m.index; i < p.length; i++) {
      if (p[i] === '(') d++;
      else if (p[i] === ')') { d--; if (d === 0) return p.slice(m.index, i + 1); }
    }
    return p.slice(m.index);
  }
  return m[0];
};
const parseShadow = (s) => {
  const str = String(s || '').trim();
  if (!str || str === 'none') return [];
  return splitTop(str).map(part => {
    const p = part.trim();
    const inset = /(^|\s)inset(\s|$)/.test(p);
    const color = pickColorToken(p);
    const nums = (p.replace(color, '').replace(/\binset\b/, '').match(/-?[\d.]+px/g) || []).map(v => parseFloat(v));
    return { inset, color, nums, blur: nums[2] ?? 0, spread: nums[3] ?? 0, raw: p };
  });
};
// 源码里 color-mix(in srgb, var(--theme) 30%, transparent) 的强度 = 括号里那个百分比
const srcAlpha = (layer) => {
  const s = String(layer);
  if (/color-mix\(/.test(s)) { const m = s.match(/var\(--theme\)\s+([\d.]+)%/); return m ? +m[1] / 100 : NaN; }
  return alphaOf(s);
};
const rgbOf = (c) => {
  const s = String(c);
  const srgb = s.match(/color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  if (srgb) return [+srgb[1], +srgb[2], +srgb[3]].map(x => Math.round(x * 255));
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return null;
  return m[1].split(/[,\s/]+/).filter(x => x !== '').slice(0, 3).map(x => Math.round(parseFloat(x)));
};
const alphaOf = (c) => {
  const s = String(c);
  const srgb = s.match(/color\(\s*srgb\s+[\d.eE+-]+\s+[\d.eE+-]+\s+[\d.eE+-]+\s*\/\s*([\d.eE+-]+%?)/);
  if (srgb) return /%$/.test(srgb[1]) ? parseFloat(srgb[1]) / 100 : parseFloat(srgb[1]);
  if (/^color\(\s*srgb/.test(s) && !/\//.test(s)) return 1;
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[,\s/]+/).filter(x => x !== '').map(parseFloat);
  return parts.length >= 4 ? parts[3] : 1;
};
// 源码里的偏移量写的是**无单位的 0**（CSS 合法），补上 px 再解析
const withPx = (s) => String(s).replace(/(^|[\s,(])0(?=[\s,)])/g, '$10px');

// ─────────── ① 静态 ───────────
console.log('══════ ① 静态：判定判据（年月都必须具体）+ 只给"格子"加发光 ══════\n');
const sp = readFileSync('collection/special.js', 'utf8');
const css = readFileSync('collection/layout.css', 'utf8');
// 静态分析前先去掉注释（这次改动的长注释里也提到这些选择器/类名，不去掉会把"规则有几条/有没有旧写法"带偏）
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const spCode = sp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const builder = sp.slice(sp.indexOf('function buildMonthHeatmap'), sp.indexOf('\nfunction applyTimelineFilter'));
ok(/const\s+glowYear\s*=\s*\(\s*timelineFilterYear\s*===\s*'全部'\s*\)\s*\?\s*''\s*:\s*String\(timelineFilterYear\)/.test(builder),
  `① ★★★ 判据源码原文：年份必须落在具体某一个值上才取出（glowYear，'全部' ⇒ 空串）`);
ok(/const\s+glowMonth\s*=\s*\(\s*timelineFilterMonth\s*!==\s*'全部'\s*\)\s*\?\s*Number\(timelineFilterMonth\)\s*:\s*0/.test(builder),
  `① ★★★ 判据源码原文：月份必须落在唯一一个月上（timelineFilterMonth !== '全部'）并归一化成月份数字`);
ok(/const\s+glowOne\s*=\s*\(\s*glowYear\s*!==\s*''\s*&&\s*glowMonth\s*>\s*0\s*\)/.test(builder),
  `① ★★★ 判据源码原文：**年月都具体**才发光（glowOne）—— 「历年 X 月」（年份=全部）与「只筛某一年」（月份=全部）都**不**发光`);
ok(/const\s+glow\s*=\s*\(\s*glowOne\s*&&\s*glowMonth\s*===\s*m\s*\+\s*1\s*&&\s*String\(y\)\s*===\s*glowYear\s*\)\s*\?\s*'\s*hm-month-glow'\s*:\s*''/.test(builder),
  `① ★★★ 逐格判据原文：glowOne && glowMonth === m + 1 && String(y) === glowYear（拿**格子自己的年月**比对）—— 唯一确定的那一格才亮`);
ok(!/glowYear\s*===\s*''\s*\|\|/.test(builder),
  '① ★★★ 上一版"放松判定"的写法（glowYear === \'\' || …，即历年 X 月每格都亮）**已经不在了**（不许留成过时的绿）');
ok(/tl-heatmap-cell\$\{edge\}\$\{onClass\}\$\{glow\}/.test(builder),
  '① ★★★ 状态类加在**格子** `.tl-heatmap-cell` 的 class 上（不是容器/行/标签）');
ok((spCode.match(/hm-month-glow/g) || []).length === 1,
  `① 全站只有这一处**代码**写这个类（出现 ${(spCode.match(/hm-month-glow/g) || []).length} 次）`);
ok(/<div class="tl-heatmap">/.test(builder) && !/hm-single-month/.test(spCode) && !/hm-single-month/.test(cssCode),
  '① ★★ 容器上没有发光状态类：`.hm-single-month` 那套（罩住整块网格的外框发光）在 JS 与 CSS 里都已撤掉');
ok(!/--hm-gap/.test(cssCode), '① ★★ 为"算整块发光框宽度"引入的 --hm-gap 也已删除（容器样式回到改动前）');

// ★ 只取"顶层、以 .tl-heatmap-cell.hm-month-glow 开头"的那条（浅色/默认）；暗色覆盖那条单独断言，
//   媒体查询里的兜底那条带缩进、也排除掉。
const cellGlowRules = cssCode.match(/(?:^|\n)\.tl-heatmap-cell\.hm-month-glow[^{]*\{[^}]*\}/g) || [];
ok(cellGlowRules.length === 1 && /::after/.test(cellGlowRules[0]),
  `① ★★★ 浅色/默认的发光规则作用在**格子自己的 ::after** 上（顶层规则共 ${cellGlowRules.length} 条）`);
const glowBody = cellGlowRules.join('\n');
ok(/box-shadow\s*:/.test(glowBody), '① 发光用 box-shadow 实现（不参与布局）');
const effective = withPx(([...glowBody.matchAll(/box-shadow\s*:([^;]*);/g)].pop() || [])[1] || '');
ok(/var\(--theme\)/.test(effective),
  `① ★★ 浅色生效的那条 box-shadow 取站点既有主题色 var(--theme)：${effective.replace(/\s+/g, ' ')}`);
ok(!/255,\s*255,\s*255/.test(effective),
  '① ★★★ 浅色那条**不是白光**（白光照在白底/浅底上几乎看不见）—— 与暗色白光互相排除');
ok(/position\s*:\s*absolute/.test(glowBody), '① ★ 发光伪元素出流（position: absolute）⇒ 不占宽高、不推挤任何元素');
ok(/pointer-events\s*:\s*none/.test(glowBody), '① ★★ 发光伪元素 `pointer-events: none`（不吃 hover/点击，命中不漂移）');
ok(/inset\s*:\s*-1px/.test(glowBody), '① ★ 伪元素 `inset: -1px` 盖到格子那 1px 边框上 ⇒ 光圈贴住可见小方块的边缘');
ok(/content\s*:/.test(glowBody), "① 发光伪元素有 `content: ''`");
const declared = [...glowBody.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)].map(m => m[2]);
// 注意：border-radius 只是"画成圆角"，不影响任何元素的尺寸/位置 ⇒ 不在禁止名单里
const flowProps = declared.filter(p => /^(margin|margin-\w+|padding|padding-\w+|border|border-(?!radius)\w+|height|min-height|max-height|width|min-width|max-width|float|display|font|font-\w+|line-height|letter-spacing|gap|row-gap|column-gap|flex|flex-\w+|grid|grid-\w+|zoom|contain|box-sizing|aspect-ratio|transform|top|right|bottom|left)$/.test(p));
ok(flowProps.length === 0,
  `① ★★★ 发光规则里没有会改动版式的属性（声明的属性：${[...new Set(declared)].join(', ')}${flowProps.length ? '；违规：' + flowProps.join(',') : ''}）`);
const lightLayers0 = parseShadow(effective);
const lA = lightLayers0.map(l => srcAlpha(l.raw));
// ★★★ 用户第三次追加口径（最终）：「好像原来的那圈无渐变的光圈还在，和渐变的叠在一起，我希望只有一层」
//   ⇒ 去掉所有 blur = 0 的"实圈"层，**只留一层柔和的光**（blur > 0、spread 适中）。
//   浅色 = 0 0 10px 2px color-mix(--theme 50%)（一层柔光，强度一处来源）。
console.log(`     浅色发光层：${lightLayers0.map((l, i) => `${l.blur}px/${l.spread}px@${lA[i]}`).join(' → ') || '(无)'}`);
ok(lightLayers0.length === 1 && !lightLayers0[0].inset,
  `① ★★★ 浅色发光**只有一层**（${lightLayers0.length} 层，只向外/无 inset）—— 用户否掉的就是"实圈 + 柔光"两圈叠在一起`);
ok(lightLayers0.every(l => l.blur > 0),
  `① ★★★ 浅色这一层是**柔光**（blur ${lightLayers0.map(l => l.blur).join('/')}px > 0）—— 不存在 0 blur 的"无渐变实圈"`);
ok(lightLayers0.every(l => l.spread >= 1),
  `① ★★ 这一层有 spread（${lightLayers0.map(l => l.spread).join('/')}px ≥ 1）⇒ 光贴着格子边缘，而不是缩在远处`);
ok(lA.every(a => a > 0.2 && a <= 0.9),
  `① ★★ 单层强度克制（alpha ${lA.join('/')} ∈ (0.2, 0.9]）：够看得见、又不糊成一团`);
ok(lightLayers0.some(l => l.blur >= 8 && l.spread >= 1),
  '① ★★ blur ≥ 8px ⇒ 从贴边往外是连续变淡的梯度（这是"渐变柔光"本身，不是硬边）');
const rmGuard = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]{0,400}?\.tl-heatmap-cell\.hm-month-glow::after\s*\{[^}]*\}/.exec(cssCode);
ok(!!rmGuard && /animation\s*:\s*none/.test(rmGuard[0]),
  `① ★ reduced-motion 兜底：${rmGuard ? rmGuard[0].replace(/\s+/g, ' ').slice(0, 140) : '（没有）'}`);
// 暗色 = 白光
const darkRule = (cssCode.match(/html\[data-color-scheme="dark"\]\s*\.tl-heatmap-cell\.hm-month-glow::after\s*\{[^}]*\}/) || [''])[0];
ok(/255,\s*255,\s*255/.test(darkRule),
  '① ★★★ 暗色主题下发光改成白光，选择器原文 = `html[data-color-scheme="dark"] .tl-heatmap-cell.hm-month-glow::after`（站点既有的明暗机制，theme.js 写的同一个属性）');
const darkShadow = withPx(([...darkRule.matchAll(/box-shadow\s*:([^;]*);/g)].pop() || [])[1] || '');
console.log(`     暗色白光：${darkShadow.replace(/\s+/g, ' ')}`);
const dParsed = parseShadow(darkShadow);
const dA = dParsed.map(l => srcAlpha(l.raw));
console.log(`     暗色发光层：${dParsed.map((l, i) => `${l.blur}px/${l.spread}px@${dA[i]}`).join(' → ') || '(无)'}`);
ok(dParsed.length === 1 && !dParsed[0].inset && dParsed.every(l => l.blur > 0),
  `① ★★★ 暗色白光同样是**只有一层柔光**（${dParsed.length} 层，blur ${dParsed.map(l => l.blur).join('/')}px > 0）—— 暗色下也不再有实圈`);
ok(dParsed.every(l => l.spread >= 1),
  `① ★★ 暗色这一层也带 spread（${dParsed.map(l => l.spread).join('/')}px ≥ 1）`);
ok(dA.every(a => a > 0.2 && a <= 0.95),
  `① ★★ 暗色白光单层强度克制（alpha ${dA.join(' / ')}，白光在深底上要够亮）`);
ok(dParsed.some(l => l.blur >= 8),
  '① ★★ 暗色 blur ≥ 8px ⇒ 同样是贴边往外连续变淡的柔光');
ok(!/html\[data-color-scheme="dark"\]\s*\.tl-heatmap-cell\.hm-month-glow::after[^}]*var\(--theme\)/.test(darkRule),
  '① ★★ 暗色那条不掺主题色（覆盖整条 box-shadow，暗色下不会蓝白叠加）');

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpGL3-'));
const DP = 13300 + Math.floor(Math.random() * 90);
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// 页面侧探针：容器信息 + **逐格**信息（含自己 ::after 的计算样式）
const PROBE_FN = `window.__glow = ()=>{
  const root = (typeof getRenderContainer === 'function' && getRenderContainer()) || document;
  const all = [...root.querySelectorAll('.tl-heatmap')];
  const hm = all.find(e => e.getBoundingClientRect().width > 1) || all[0] || null;
  const info = { hmCount: all.length, glowOnContainer: root.querySelectorAll('.hm-single-month').length,
    glowClassAnywhere: document.querySelectorAll('.hm-month-glow').length };
  if (!hm) return Object.assign(info, { found: false });
  const cs = getComputedStyle(hm);
  const R = (e) => { const x = e.getBoundingClientRect(); return [+x.left.toFixed(3), +x.top.toFixed(3), +x.width.toFixed(3), +x.height.toFixed(3)]; };
  const row = hm.querySelector('.tl-heatmap-row');
  const lg = hm.querySelector('.tl-heatmap-legend');
  const ys = document.getElementById('timelineYearFilter');
  const ms = document.getElementById('timelineMonthFilter');
  const rowCs = row ? getComputedStyle(row) : null;
  const tracks = rowCs ? rowCs.gridTemplateColumns.split(/\\s+/).map(parseFloat) : [];
  const gap = rowCs ? parseFloat(rowCs.columnGap) : 0;
  const trackTotal = tracks.reduce((a, b) => a + b, 0) + gap * Math.max(0, tracks.length - 1);
  const rr = row ? row.getBoundingClientRect() : null;
  const dataRows = [...hm.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')];
  const cells = [...hm.querySelectorAll('.tl-heatmap-cell')].map(c => {
    const after = getComputedStyle(c, '::after');
    const before = getComputedStyle(c, '::before');
    const fill = c.querySelector('.tl-hm-fill');
    const fcs = fill ? getComputedStyle(fill) : null;
    const own = getComputedStyle(c);
    return { year: c.dataset.year, month: c.dataset.month, amount: +c.dataset.amount,
      glow: c.classList.contains('hm-month-glow'), cls: c.className,
      rect: R(c), afterContent: after.content, afterShadow: after.boxShadow,
      afterPosition: after.position, afterPointer: after.pointerEvents,
      // ★ 用户第三次追加口径："原来那圈无渐变的光圈还在、和渐变的叠在一起" ⇒ 逐项取证：
      //   发光格上**全部**可能的描边/阴影来源（元素自身 + ::before + ::after + 色块子元素）。
      ownShadow: own.boxShadow, ownOutline: own.outlineStyle, ownOutlineW: own.outlineWidth,
      ownBorder: [own.borderTopStyle, own.borderTopWidth, own.borderTopColor].join('|'),
      ownRadius: own.borderRadius,
      beforeContent: before.content, beforeShadow: before.boxShadow,
      fillShadow: fcs ? fcs.boxShadow : '(无色块)',
      fillOutline: fcs ? fcs.outlineStyle : 'none', fillOutlineW: fcs ? fcs.outlineWidth : '0px',
      fillBorder: fcs ? [fcs.borderTopStyle, fcs.borderTopWidth].join('|') : 'none|0px' };
  });
  const ps = getComputedStyle(hm, '::before');
  return Object.assign(info, {
    found: true, cls: hm.className, shadow: cs.boxShadow, position: cs.position,
    padding: cs.padding, margin: cs.margin, filter: cs.filter,
    rect: R(hm), rectDoc: [+hm.getBoundingClientRect().left.toFixed(3), +(hm.getBoundingClientRect().top + window.scrollY).toFixed(3)],
    rows: [...hm.querySelectorAll('.tl-heatmap-row')].map(R), rowCount: dataRows.length,
    legend: lg ? R(lg) : null, cells,
    cellCount: cells.length, glowCells: cells.filter(c => c.glow).length,
    client: [hm.clientWidth, hm.clientHeight, hm.scrollWidth, hm.scrollHeight],
    cols: rowCs ? rowCs.gridTemplateColumns : null, gap, trackTotal: +trackTotal.toFixed(3),
    gridLeft: rr ? +(rr.left + (rr.width - trackTotal) / 2).toFixed(3) : null,
    anim: cs.animationName,
    containerBefore: { content: ps.content, shadow: ps.boxShadow },
    year: ys ? ys.value : null, month: ms ? ms.value : null,
    filterYear: (typeof timelineFilterYear !== 'undefined') ? timelineFilterYear : null,
    filterMonth: (typeof timelineFilterMonth !== 'undefined') ? timelineFilterMonth : null,
    theme: getComputedStyle(document.documentElement).getPropertyValue('--theme').trim(),
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    dpr: window.devicePixelRatio, innerW: window.innerWidth, innerH: window.innerHeight,
    docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    hScroll: (() => { const rc = (typeof getRenderContainer === 'function' && getRenderContainer()); return rc ? [rc.clientWidth, rc.scrollWidth, Math.round(rc.scrollTop)] : null; })()
  });
}; 1`;
const injectProbe = async () => { await evaluate(PROBE_FN); };
const probe = async () => JSON.parse(await evaluate(`JSON.stringify(window.__glow())`));
const shot = async () => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', background: 'white' })).data, 'base64'));

const boot = async (hash) => {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(700);
  await injectProbe();
};
const openYears = async () => {
  const id = await evaluate(`(()=>{
    const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
    const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'timeline');
    if (!hit) return '';
    if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
    return hit.id;
  })()`);
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`(()=>{ const r=(typeof getRenderContainer==='function'&&getRenderContainer())||document;
      return !!r.querySelector('.tl-heatmap') && !!document.getElementById('timelineMonthFilter'); })()`).catch(() => false);
    if (ready) break;
    await sleep(300);
  }
  await sleep(700);
  return id;
};
const setFilter = async (y, m) => {
  await evaluate(`(()=>{ if (typeof applyTimelineFilter==='function') applyTimelineFilter(${JSON.stringify(y)}, ${JSON.stringify(m)}); return 1; })()`);
  await sleep(1100);
};
// 明暗外观（站点既有机制：collection/theme.js 的 applyColorScheme() 把 data-color-scheme 写到 <html> 上）
const setScheme = async (mode) => {
  await evaluate(`(()=>{ try{ localStorage.setItem('collection-color-scheme', ${JSON.stringify(mode)}); }catch(e){}
    if (typeof applyColorScheme==='function') applyColorScheme(false);
    return document.documentElement.getAttribute('data-color-scheme'); })()`);
  await sleep(900);
  return await evaluate(`document.documentElement.getAttribute('data-color-scheme')`);
};
const rectEq = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const cellsEq = (a, b, tol) => a.length === b.length && a.every((r, i) => rectEq(r, b[i], tol));
const glowSetReport = (p, pick) => {
  const want = p.cells.filter(pick);
  const got = p.cells.filter(c => c.glow);
  const key = (c) => `${c.year}/${c.month}`;
  const wantK = want.map(key).sort(), gotK = got.map(key).sort();
  return { want, got, wantK, gotK, equal: JSON.stringify(wantK) === JSON.stringify(gotK) };
};
// "没有发光"的统一判据：0 格带类 + 每个格子的发光伪元素压根没生成
const zeroGlow = (p) => p.glowCells === 0 && p.glowClassAnywhere === 0 && p.cells.every(c => c.afterContent === 'none' && c.afterShadow === 'none');

// ─────────── ② 上表四种状态：逐格枚举（0 / 0 / 0 / 1） ───────────
console.log('\n══════ ② 四种筛选状态的发光格数：全部 0、只筛年 0、历年某月 0、某年某月 1 ══════\n');
await boot('notes');
const sid = await openYears();
ok(!!sid, `② 进入币海拾年（${sid || '没找到'}）`);
// ★ ②-⑧ 与 ⑪ 一律在**浅色主题**下跑（浅色 = 主题色发光；暗色白光单独在 ⑥ 里测）
const initScheme = await setScheme('light');
ok(initScheme === 'light', `② 环境已切到浅色主题（html[data-color-scheme]="${initScheme}"）`);
await setFilter('全部', '全部');
const base = await probe();
ok(base.found, '② 页面上有热力图容器 .tl-heatmap');
ok(base.cellCount === base.rowCount * 12, `② 热力图共 ${base.rowCount} 行 × 12 = ${base.cellCount} 个月份格子（每格带 data-year/data-month）`);
const yearsSorted = [...new Set(base.cells.map(c => +c.year))].sort((a, b) => a - b);
const TOP_Y = yearsSorted[0], BOT_Y = yearsSorted[yearsSorted.length - 1];
console.log(`     数据年份（升序）=${yearsSorted.join(', ')}；容器 rect=${JSON.stringify(base.rect)}；格子 ${base.cells[0].rect[2]}×${base.cells[0].rect[3]}；列间距 ${base.gap}px`);
ok(zeroGlow(base) && base.shadow === 'none' && /none/.test(base.containerBefore.content),
  `② ★★★ ①「全部时间」：**0 格**发光（.hm-month-glow=${base.glowClassAnywhere}、容器也无任何发光）`);
await setFilter(TOP_Y, '全部');
const yOnly = await probe();
ok(yOnly.filterYear === String(TOP_Y) && yOnly.filterMonth === '全部' && zeroGlow(yOnly),
  `② ★★★ ②「只筛某一年」（${TOP_Y} 年、月份=全部）：**0 格**发光`);
await setFilter('全部', '07');
const histM = await probe();
ok(histM.filterYear === '全部' && histM.filterMonth === '07' && zeroGlow(histM),
  `② ★★★ ③「历年 7 月」（年份=全部、月=07）：**0 格**发光 —— 用户明确选了口径「干脆不发光」，不是一排都亮`);
ok(histM.glowOnContainer === 0, '② ★★ 「历年 7 月」时容器上也没有任何发光状态类');
await setFilter(TOP_Y, '10');
const one = await probe();
const rOne = glowSetReport(one, c => c.year === String(TOP_Y) && c.month === '10');
ok(one.filterYear === String(TOP_Y) && one.filterMonth === '10', `② 年 + 月都筛上（${one.filterYear}/${one.filterMonth}）`);
ok(rOne.got.length === 1, `② ★★★ ④「${TOP_Y} 年 10 月」：**恰好 1 格**发光（实测 ${rOne.got.length} 格：${rOne.gotK.join(' , ') || '无'}）`);
ok(rOne.equal && rOne.got[0] && rOne.got[0].year === String(TOP_Y) && rOne.got[0].month === '10',
  `② ★★★ 发光的就是"${TOP_Y} 年 10 月"那一格（data-year=${rOne.got[0] && rOne.got[0].year}、data-month=${rOne.got[0] && rOne.got[0].month}）`);
ok(one.cells.filter(c => !c.glow).every(c => c.afterContent === 'none'),
  `② ★★★ 其余 ${one.cells.length - 1} 个格子一个都不发光（连发光伪元素都没生成）`);
ok(one.shadow === 'none' && one.glowOnContainer === 0 && /none/.test(one.containerBefore.content),
  `② ★★ 容器始终没有发光（box-shadow=${one.shadow}）—— 光只在那一格上，不是整块热力图`);

// ─────────── ③ 发光格样式与形态 ───────────
console.log('\n══════ ③ 发光形态：格子自己的边缘发光（出流伪元素 + 一层柔光，且只有一个光源）══════\n');
const gCell = rOne.got[0] || { afterShadow: 'none', afterContent: 'none', afterPosition: '', afterPointer: '' };
const gShadow = parseShadow(gCell.afterShadow);
console.log(`     发光格样式：::after content=${gCell.afterContent}｜position=${gCell.afterPosition}｜pointer-events=${gCell.afterPointer}`);
console.log(`     box-shadow：${gShadow.map(l => l.raw).join('\n                 ')}`);
ok(gCell.afterPosition === 'absolute' && gCell.afterPointer === 'none',
  `③ ★★ 发光伪元素出流且不吃事件（position=${gCell.afterPosition}、pointer-events=${gCell.afterPointer}）`);
ok(gShadow.length === 1 && gShadow.every(l => !l.inset),
  `③ ★★★ 发光**只有一层**（${gShadow.length} 层，无 inset ⇒ 只向外）：用户要的"只有一层"`);
ok(gShadow.every(l => l.blur > 0 && l.spread >= 1),
  `③ ★★★ 这一层是 blur > 0 的**柔光**（blur ${gShadow.map(l => l.blur).join('/')}px、spread ${gShadow.map(l => l.spread).join('/')}px）—— 没有任何 0 blur 的实圈`);
// ★ 用户第三次追加口径：排查"是不是还有别的光源" —— 发光格上除了这个 ::after，不许有第二处描边/阴影
const gState = (probeObj) => probeObj.cells.find(c => c.glow) || {};
const gNow = gState(one);
console.log(`     发光格自身：box-shadow=${gNow.ownShadow}｜outline=${gNow.ownOutline}(${gNow.ownOutlineW})｜border=${gNow.ownBorder}`);
console.log(`     ::before：content=${gNow.beforeContent}｜box-shadow=${gNow.beforeShadow}`);
console.log(`     .tl-hm-fill 色块：box-shadow=${gNow.fillShadow}｜outline=${gNow.fillOutline}(${gNow.fillOutlineW})｜border=${gNow.fillBorder}`);
const gOther = one.cells.find(c => !c.glow) || {};
ok(gNow.beforeShadow === 'none' && (gNow.beforeContent === 'none' || gNow.beforeContent === 'normal'),
  `③ ★★★ 发光格**没有别的伪元素光源**（::before content=${gNow.beforeContent}、box-shadow=${gNow.beforeShadow}）`);
ok((gNow.fillShadow === 'none' || !gNow.fillShadow) && gNow.fillOutline === 'none' && /^none\|/.test(gNow.fillBorder || 'none|'),
  `③ ★★★ 色块子元素 .tl-hm-fill 没有阴影/描边（box-shadow=${gNow.fillShadow}、outline-style=${gNow.fillOutline}、border=${gNow.fillBorder}）—— 不是第二个光源`);
ok(gNow.ownShadow === 'none' || gNow.ownShadow === gOther.ownShadow,
  `③ ★★★ 发光格**元素自身**没有额外阴影（自身 box-shadow=${gNow.ownShadow}；与同图未发光格 ${gOther.ownShadow} 一致或为 none）`);
ok(gNow.ownBorder === gOther.ownBorder && gNow.ownOutline === 'none',
  `③ ★★★ 发光格的自身描边 = 全站格子的既有 1px 网格边框（${gNow.ownBorder}，与未发光格逐值相同）、outline-style=${gNow.ownOutline} ⇒ 发光**没有**引入第二圈`);
ok(gNow.ownRadius === gOther.ownRadius,
  `③ ★★ 圆角也与未发光格一致（${gNow.ownRadius}）`);
const themeRgb = rgbOf(base.theme);
ok(gShadow.every(l => { const t = rgbOf(l.color); return t && themeRgb && t.join(',') === themeRgb.join(','); }),
  `③ ★★ 浅色发光颜色 = 主题色 --theme=${base.theme}（不写死新品牌色）：${gShadow.map(l => l.color).join(' ｜ ')}`);
ok(gShadow.map(l => alphaOf(l.color)).every(a => a > 0.2 && a <= 0.9),
  `③ ★ 强度克制：alpha ∈ (0.2, 0.9]（实测 ${gShadow.map(l => alphaOf(l.color)).join(' / ')}）`);

// ─────────── ④ 零位移（逐值 + 逐帧） ───────────
console.log('\n══════ ④ 零位移：容器/每行/图例/每一个格子的矩形与尺寸逐值不变 ══════\n');
await setFilter('全部', '全部');
await evaluate(`(()=>{ window.__glowSeq=[]; window.__glowOn=true;
  (function tick(){ if(!window.__glowOn) return;
    const root=(typeof getRenderContainer==='function'&&getRenderContainer())||document;
    const hm=[...root.querySelectorAll('.tl-heatmap')].find(e=>e.getBoundingClientRect().width>1);
    if (hm) { const r=hm.getBoundingClientRect(); const cells=[...hm.querySelectorAll('.tl-heatmap-cell')].map(c=>{const b=c.getBoundingClientRect();return [+b.left.toFixed(3),+b.top.toFixed(3),+b.width.toFixed(3),+b.height.toFixed(3)];});
      window.__glowSeq.push([+r.left.toFixed(3),+r.top.toFixed(3),+r.width.toFixed(3),+r.height.toFixed(3),JSON.stringify(cells)]); }
    requestAnimationFrame(tick); })(); return 1; })()`);
await sleep(60);
await setFilter(TOP_Y, '10');
await evaluate(`window.__glowOn=false; 1`);
const seq = JSON.parse(await evaluate(`JSON.stringify(window.__glowSeq||[])`));
const oneState = await probe();
ok(JSON.stringify(base.rect) === JSON.stringify(oneState.rect),
  `④ ★★★ 切到"唯一一格发光"前后容器矩形逐值不变（${JSON.stringify(base.rect)} → ${JSON.stringify(oneState.rect)}）`);
ok(JSON.stringify(base.rows) === JSON.stringify(oneState.rows), `④ ★★ 每一行的矩形逐值不变（${base.rows.length} 行）`);
ok(JSON.stringify(base.legend) === JSON.stringify(oneState.legend), `④ ★★ 图例矩形逐值不变（${JSON.stringify(base.legend)}）`);
ok(cellsEq(base.cells.map(c => c.rect), oneState.cells.map(c => c.rect), 0.001),
  `④ ★★★ 全部 ${base.cellCount} 个格子的矩形逐值不变（首格 ${JSON.stringify(base.cells[0].rect)} → ${JSON.stringify(oneState.cells[0].rect)}）`);
ok(JSON.stringify(base.client) === JSON.stringify(oneState.client), `④ ★★ 容器 client/scroll 尺寸不变（${JSON.stringify(base.client)}）`);
ok(base.cols === oneState.cols && base.gap === oneState.gap, `④ ★★ 13 条轨道与列间距不变（gap ${oneState.gap}）`);
ok(JSON.stringify(base.hScroll) === JSON.stringify(oneState.hScroll), `④ ★★ 滚动容器尺寸/滚动位置不变（${JSON.stringify(oneState.hScroll)}）`);
ok(seq.length > 3, `④ 逐帧采样拿到 ${seq.length} 帧`);
const seqVals = [...new Set(seq.map(f => JSON.stringify(f)))];
const seqBad = seq.filter(f => Math.abs(f[0] - base.rect[0]) > 0.51 || Math.abs(f[1] - base.rect[1]) > 0.51 ||
  Math.abs(f[2] - base.rect[2]) > 0.51 || Math.abs(f[3] - base.rect[3]) > 0.51 ||
  !cellsEq(JSON.parse(f[4]), base.cells.map(c => c.rect), 0.51));
console.log(`     逐帧矩形：${seqVals.length} 种取值（共 ${seq.length} 帧）`);
ok(seqBad.length === 0,
  `④ ★★★ 切到发光的**整个过程中**（逐帧）容器与 ${base.cellCount} 个格子的矩形从未偏离基线（偏差帧 ${seqBad.length} 个）—— 发光零位移`);

// ─────────── ⑤ 逐格四边像素证据（四个角 + 反向证据） ───────────
console.log('\n══════ ⑤ 发光格四边外发光可见性（最上/最下/最左/最右的四个角）══════\n');
// 距离 [dLo, dHi) px 之外的四条带（带子落在格子外侧）
const bandAt = (baseImg, img, rect, dpr, dLo, dHi) => {
  const sc = (v) => Math.round(v * dpr);
  const x0 = sc(rect[0]), x1 = sc(rect[0] + rect[2]), y0 = sc(rect[1]), y1 = sc(rect[1] + rect[3]);
  const a = sc(dLo), b = Math.max(a + 1, sc(dHi));
  const inset = Math.max(2, sc(6));
  const out = {};
  const scan = (name, ax0, ax1, ay0, ay1) => {
    let n = 0, area = 0, maxd = 0, sum = 0;
    for (let y = Math.max(0, ay0); y < Math.min(img.height, ay1); y++) for (let x = Math.max(0, ax0); x < Math.min(img.width, ax1); x++) {
      area++;
      const p = pixelAt(baseImg, x, y), q = pixelAt(img, x, y);
      const dd = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      if (dd > 0) n++;
      if (dd > maxd) maxd = dd;
      sum += dd;
    }
    out[name] = { n, area, maxd, sum };
  };
  scan('上', x0 + inset, x1 - inset, y0 - b, y0 - a);
  scan('下', x0 + inset, x1 - inset, y1 + a, y1 + b);
  scan('左', x0 - b, x0 - a, y0 + inset, y1 - inset);
  scan('右', x1 + a, x1 + b, y0 + inset, y1 - inset);
  return out;
};
// ★ 同态对比：一张"有发光"、一张在页面里**临时摘掉发光类**（只动 DOM class，不改仓库文件、不碰样式）
//   ⇒ 两张之差只剩发光本身（不会掺进"换筛选导致的热力图数据变化"这个混淆项）。
const pairFor = async (p, label) => {
  const withGlow = await shot();
  const removed = await evaluate(`(()=>{ const els=[...document.querySelectorAll('.tl-heatmap-cell.hm-month-glow')];
    els.forEach(e => e.classList.remove('hm-month-glow')); return els.length; })()`);
  await sleep(250);
  const noGlowProbe = await probe();
  const withoutGlow = await shot();
  ok(removed === p.glowCells,
    `⑤ ★★ ${label}：临时摘掉的正好是那 ${removed} 个发光格（同态对比取证用）`);
  ok(cellsEq(noGlowProbe.cells.map(c => c.rect), p.cells.map(c => c.rect), 0.001) && JSON.stringify(noGlowProbe.rect) === JSON.stringify(p.rect),
    `⑤ ★★ ${label}：摘掉发光类前后容器与 ${p.cells.length} 个格子的矩形逐值不变（零位移，反向也成立）`);
  return { withGlow, withoutGlow };
};
// 重新应用筛选把发光类还原（applyTimelineFilter 对"同一年月"会提前 return ⇒ 必须先切到别的态）
const restoreGlow = async (y, m) => { await setFilter('全部', '全部'); await setFilter(y, m); };
const cornerCheck = async (y, m, label, corners) => {
  await setFilter(y, m);
  const p = await probe();
  const rep = glowSetReport(p, c => c.year === String(y) && c.month === m);
  ok(rep.got.length === 1 && rep.equal, `⑤ ★★★ ${label}（${y} 年 ${m} 月）：恰好 1 格发光且就是那一格（${rep.gotK.join('') || '无'}）`);
  const pair = await pairFor(p, label);
  const cell = rep.got[0];
  if (!cell) return null;
  const st = bandAt(pair.withoutGlow, pair.withGlow, cell.rect, p.dpr, 0, 2);
  const sides = ['上', '下', '左', '右'];
  const want = sides.filter(s => !corners || corners.includes(s));
  console.log(`       ${label} ${cell.year}/${cell.month} 四边差异（变化像素/带宽像素、最大通道差）：` +
    sides.map(s => `${s}${st[s].n}/${st[s].area}(Δ${st[s].maxd})`).join('  '));
  ok(sides.every(s => st[s].n >= st[s].area * 0.4 && st[s].maxd >= 8),
    `⑤ ★★★ ${label}：四边外发光**都可见**（含被关注的那几边 ${want.join('/')}）—— 没有被滚动容器/网格边界裁掉`);
  // 反向证据：同一张图里，**离发光格最远**的那个没被选中的格子四边应当**零变化**
  //   （取"最远"而不是"第一个没发光的"：相邻格的一侧本来就贴着发光格的光圈，那不算"光跑错地方"）
  const dist = (c) => Math.hypot(c.rect[0] - cell.rect[0], c.rect[1] - cell.rect[1]);
  const candidates = p.cells.filter(c => !c.glow);
  if (!candidates.length) {
    ok(false, `⑤ ★★★ ${label}：同一张图里**一个没发光的格子都没有**（全亮），给不出"别处零变化"的反向证据`);
    await restoreGlow(y, m);
    return { p, st, cell };
  }
  const other = candidates.sort((a, b) => dist(b) - dist(a))[0];
  const st2 = bandAt(pair.withoutGlow, pair.withGlow, other.rect, p.dpr, 0, 2);
  ok(sides.every(s => st2[s].maxd === 0),
    `⑤ ★★★ ${label}：同一张图里离得最远、没选中的 ${other.year}/${other.month} 格四边**零变化**（${sides.map(s => s + st2[s].n + '/' + st2[s].area).join(' ')}）—— 光只贴在选中的那一格上`);
  await restoreGlow(y, m);
  return { p, st, cell };
};
await cornerCheck(TOP_Y, '01', '左上角格（最上一行 + 最左一列）', ['上', '左']);
await cornerCheck(TOP_Y, '12', '右上角格（最上一行 + 最右一列）', ['上', '右']);
await cornerCheck(BOT_Y, '01', '左下角格（最下一行 + 最左一列）', ['下', '左']);
const br = await cornerCheck(BOT_Y, '12', '右下角格（最下一行 + 最右一列）', ['下', '右']);
ok(!!br, '⑤ ★★★ 四个角上的格子都量到了（最上/最下/最左/最右四边各有像素证据）');

// ─────────── ⑥ 两种主题：暗色白光 / 浅色主题色 ───────────
console.log('\n══════ ⑥ 暗色 = 白光、浅色 = 主题色（强度剖面 + 颜色互相排除）══════\n');
// ★★ 细分箱强度剖面（用户口径："最外围要淡化、末端不能有硬边" + "不要那圈无渐变的实圈"）：
//   14 档连续分箱，**末端（6-20px）用 2px 细档** —— 单层高斯柔光的尾巴就落在这里，
//   粗档（2-4px 宽）会把"最后一档非零/峰值"这个残留比算高（实测 0.088 vs 细分后 0.015），
//   那是测量分辨率的假象、不是硬边。每档给四边合计的平均通道差（meanD）与最大通道差（maxd）：
//   单调性看 meanD（对单像素噪声稳），阶梯类指标看 maxd（= 档内缘处的强度，不受档宽影响）。
const BINS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20], [20, 26], [26, 32]];
const profileOf = (baseImg, img, p, label) => {
  const cell = p.cells.find(c => c.glow);
  const sides = ['上', '下', '左', '右'];
  if (!cell) {
    console.log(`     ${label} 强度剖面：**没有发光格可量**（这一态一个都没发光）`);
    const dummy = (lo, hi) => ({ lo, hi, n: 0, area: 0, maxd: -1, meanD: -1 });
    return { cell: { year: '(无)', month: '' }, rows: BINS.map(([a, b]) => dummy(a, b)), peak: dummy(0, 1), far: dummy(20, 26) };
  }
  const rows = BINS.map(([lo, hi]) => {
    const st = bandAt(baseImg, img, cell.rect, p.dpr, lo, hi);
    const area = sides.reduce((a, s) => a + st[s].area, 0);
    const sum = sides.reduce((a, s) => a + st[s].sum, 0);
    return { lo, hi, n: sides.reduce((a, s) => a + st[s].n, 0), area, sum,
      maxd: Math.max(...sides.map(s => st[s].maxd)), meanD: +(sum / area).toFixed(2) };
  });
  console.log(`     ${label} 强度剖面（离 ${cell.year}/${cell.month} 格边缘的距离 → 四边合计）：`);
  rows.forEach(r => console.log(`       ${String(r.lo).padStart(2)}-${String(r.hi).padStart(2)}px : 平均Δ${String(r.meanD).padStart(6)} 最大Δ${String(r.maxd).padStart(4)}（变化像素 ${r.n}/${r.area}）`));
  return { cell, rows, peak: rows[0], far: rows[rows.length - 1] };
};
// "没有实圈 / 没有硬边"的量化（用户第二次「最外围淡化」+ 第三次「只留一层、不要那圈无渐变的光圈」）：
//   ① 末端残留比 = 最后一个非零档 / 第一档（硬边 ⇒ 接近 1）
//   ② 最大相邻落差比 = max(meanD[i]-meanD[i+1]) / meanD[0]
//   ③ 外圈（3px 起）每一步的落差比
//   ④ ★ 头部台阶比 = 贴边三档内的最大落差比（"实圈"特征：前两档几乎一样高 = 平台，第三档突然掉一半）
//   阈值依据（均为本次实测）：
//     实圈版（旧）：头部台阶比 0.4342/0.4081… 见报告；只留实圈：1.0；无发光：峰值≈0
//     单层柔光版（新）：见运行输出
const NO_HARD_EDGE = { tailResid: 0.06, stepRatio: 0.45, outerStep: 0.4, headStep: 0.25, plateau: 0.97, tailMax: 2 };
const hardEdgeMetrics = (P) => {
  // ★ 阶梯类指标用**每档的峰值**当profile值（= 该档内缘处的强度）：分箱宽度不等（1/1/1/1/2/3/3/4/4/6/6px），
  //   用"档内平均"会把宽档的均值拉低、凭空造出一个台阶（实测把 0.20 抬成 0.41）。峰值对"硬边"同样敏感，
  //   且不受档宽影响。平均值仍然照常打印，并用来判"单调不增"。
  const m = P.rows.map(r => Math.max(0, r.meanD));
  const v = P.rows.map(r => Math.max(0, r.maxd));
  const first = Math.max(1e-9, v[0]);
  // 末端残留比 = **归零前那一档**的强度 / 峰值（就是"最后掉到 0 的那一步有多高"）：
  //   硬边（只留实圈）⇒ 1.0；单层柔光 ⇒ 尾巴已经衰减到峰值的几个百分点才归零。
  //   （不用"最后一档非零"是因为它取决于探测阈值，会随分箱粗细漂移。）
  let lastNZ = 0;
  for (let i = v.length - 2; i >= 0; i--) { if (v[i] > 0 && v[i + 1] === 0) { lastNZ = i; break; } }
  if (!v[lastNZ]) lastNZ = v.findIndex(x => x > 0);
  let step = 0, stepAt = '', outer = 0, outerAt = '';
  for (let i = 0; i + 1 < v.length; i++) {
    const d = (v[i] - v[i + 1]) / first;
    if (d > step) { step = d; stepAt = `${P.rows[i].lo}-${P.rows[i].hi}→${P.rows[i + 1].lo}-${P.rows[i + 1].hi}px`; }
    if (P.rows[i].lo >= 3 && d > outer) { outer = d; outerAt = `${P.rows[i].lo}-${P.rows[i].hi}→${P.rows[i + 1].lo}-${P.rows[i + 1].hi}px`; }
  }
  // 头部（离格边 4px 以内）的最大落差比 + 前两档的"平台度"（v[1]/v[0]，越接近 1 越像实圈）
  const headEnd = P.rows.findIndex(r => r.lo >= 4);
  const head = v.slice(0, headEnd < 0 ? 4 : headEnd);
  let headStep = 0, headAt = '';
  for (let i = 0; i + 1 < head.length; i++) {
    const d = (head[i] - head[i + 1]) / first;
    if (d > headStep) { headStep = d; headAt = `${P.rows[i].lo}-${P.rows[i].hi}→${P.rows[i + 1].lo}-${P.rows[i + 1].hi}px`; }
  }
  return { tailResid: +(v[lastNZ] / first).toFixed(4), lastNZ, stepRatio: +step.toFixed(4), stepAt,
    outerStep: +outer.toFixed(4), outerAt, headStep: +headStep.toFixed(4), headAt,
    plateau: +(v[1] / first).toFixed(4), tailMax: Math.max(...P.rows.slice(-2).map(r => r.maxd)), m, v };
};
const assertNoHardEdge = (P, label, theme) => {
  const H = hardEdgeMetrics(P);
  const monoM = H.m.every((x, i) => i === 0 || x <= H.m[i - 1] + 0.6);
  const monoV = H.v.every((x, i) => i === 0 || x <= H.v[i - 1] + 2);
  console.log(`     ${label} 无实圈量化：头部(≤4px)最大落差比 ${H.headStep}（阈值 ≤${NO_HARD_EDGE.headStep}，出现在 ${H.headAt}）｜平台度 band1/band0 = ${H.plateau}（硬边特征≈1；阈值 ≤${NO_HARD_EDGE.plateau}）｜末端残留比 ${H.tailResid}（≤${NO_HARD_EDGE.tailResid}）｜最大相邻落差比 ${H.stepRatio}（≤${NO_HARD_EDGE.stepRatio}，${H.stepAt}）｜外圈(≥3px) ${H.outerStep}（≤${NO_HARD_EDGE.outerStep}）｜末端两档最大Δ ${H.tailMax}（≤${NO_HARD_EDGE.tailMax}）`);
  ok(monoM && monoV, `⑥ ★★★ ${theme}：强度**随距离单调不增**（${H.m.length} 档平均Δ：${H.m.join(' → ')}｜峰值Δ：${H.v.join(' → ')}）`);
  ok(H.headStep <= NO_HARD_EDGE.headStep,
    `⑥ ★★★ ${theme}：贴边 4px 内**没有"平台后骤降"**（头部最大落差比 ${H.headStep} ≤ ${NO_HARD_EDGE.headStep}，出现在 ${H.headAt}）—— 这正是"无渐变实圈"的特征：旧实圈版实测 0.43/0.41、只留实圈 1.0`);
  ok(H.plateau <= NO_HARD_EDGE.plateau,
    `⑥ ★★★ ${theme}：贴边前两档不是平台（band1/band0 = ${H.plateau} ≤ ${NO_HARD_EDGE.plateau}）⇒ 从第一档起就在变淡，是渐变而不是实圈（旧实圈版 0.96/0.98 就是那个平台）`);
  ok(H.tailMax <= NO_HARD_EDGE.tailMax, `⑥ ★★★ ${theme}：20px 之外两档最大Δ ${H.tailMax} ≤ ${NO_HARD_EDGE.tailMax} ⇒ 末端**已经淡到 0**（连续趋近，不是截断）`);
  ok(H.tailResid <= NO_HARD_EDGE.tailResid, `⑥ ★★★ ${theme}：末端残留比 ${H.tailResid} ≤ ${NO_HARD_EDGE.tailResid}（归零前那一档 ${P.rows[H.lastNZ].lo}-${P.rows[H.lastNZ].hi}px 的强度只有峰值的 ${(H.tailResid * 100).toFixed(1)}%）⇒ 最外围是"淡到看不见才归零"，不是硬边`);
  ok(H.stepRatio <= NO_HARD_EDGE.stepRatio, `⑥ ★★★ ${theme}：最大相邻落差比 ${H.stepRatio} ≤ ${NO_HARD_EDGE.stepRatio}（没有"一整档还亮着、下一档突然归零"的台阶；只留实圈的写法是 1.0）`);
  ok(H.outerStep <= NO_HARD_EDGE.outerStep, `⑥ ★★★ ${theme}：3px 以外每一步落差比 ${H.outerStep} ≤ ${NO_HARD_EDGE.outerStep}（出现在 ${H.outerAt}）⇒ 外围是连续梯度`);
  ok(P.peak.meanD >= 25 && P.peak.n >= P.peak.area * 0.5,
    `⑥ ★★★ ${theme}：贴边那 0-1px 仍然够亮（平均Δ${P.peak.meanD}、最大Δ${P.peak.maxd}，变化像素 ${P.peak.n}/${P.peak.area}）⇒ 只有一层也看得见`);
};
// 颜色（像素级）：边缘 0-1px 带上的平均亮度与通道极差 ⇒ 白光 vs 主题色互相排除
const edgeColorStats = (baseImg, img, rect, dpr) => {
  if (!Array.isArray(rect)) return { lum: -1, spread: -1, area: 0 };   // 没有发光格可量
  const sc = (v) => Math.round(v * dpr);
  const x0 = sc(rect[0]), x1 = sc(rect[0] + rect[2]), y0 = sc(rect[1]), y1 = sc(rect[1] + rect[3]);
  const inset = Math.max(2, sc(6)), b = Math.max(1, sc(1));
  let lum = 0, spread = 0, area = 0;
  const scan = (ax0, ax1, ay0, ay1) => {
    for (let y = Math.max(0, ay0); y < Math.min(img.height, ay1); y++) for (let x = Math.max(0, ax0); x < Math.min(img.width, ax1); x++) {
      const q = pixelAt(img, x, y);
      lum += 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2];
      spread += Math.max(q[0], q[1], q[2]) - Math.min(q[0], q[1], q[2]);
      area++;
    }
  };
  scan(x0 + inset, x1 - inset, y0 - b, y0);
  scan(x0 + inset, x1 - inset, y1, y1 + b);
  scan(x0 - b, x0, y0 + inset, y1 - inset);
  scan(x1, x1 + b, y0 + inset, y1 - inset);
  return { lum: +(lum / area).toFixed(1), spread: +(spread / area).toFixed(1), area };
};
await setFilter(TOP_Y, '10');
// ── 浅色 ──
const lightAttr = await setScheme('light');
const lightProbe = await probe();
const lightCell = lightProbe.cells.find(c => c.glow) || { afterShadow: 'none' };
const lightLayers = parseShadow(lightCell.afterShadow);
ok(lightAttr === 'light' && lightProbe.scheme === 'light',
  `⑥ ★★ 站点的"明暗"机制切到浅色（html[data-color-scheme]="${lightAttr}"，由 theme.js 的 applyColorScheme() 写）`);
ok(lightLayers.length === 1 && lightLayers.every(l => l.blur > 0) && lightLayers.every(l => (rgbOf(l.color) || []).join(',') === themeRgb.join(',')),
  `⑥ ★★★ 浅色下发光 = **一层主题色柔光**（${lightLayers.length} 层、blur ${lightLayers.map(l => l.blur).join('/')}px；${lightLayers.map(l => l.color).join(' ｜ ')} == --theme=${lightProbe.theme}）`);
ok(lightLayers.every(l => !(rgbOf(l.color) || []).every(v => v === 255)),
  '⑥ ★★★ 浅色下发光**不是白光**（白光照在白底/浅底上几乎看不见）');
const lightPair = await pairFor(lightProbe, '浅色');
const lightP = profileOf(lightPair.withoutGlow, lightPair.withGlow, lightProbe, '浅色');
const lightEdge = edgeColorStats(lightPair.withoutGlow, lightPair.withGlow, lightCell.rect, lightProbe.dpr);
assertNoHardEdge(lightP, '浅色', '浅色');
ok(lightEdge.spread >= 40, `⑥ ★★★ 浅色边缘像素明显带蓝色（平均通道极差 ${lightEdge.spread} ≥ 40、平均亮度 ${lightEdge.lum}）⇒ 不是白光（像素级互相排除）`);
await restoreGlow(TOP_Y, '10');
// 浅色下"用户改主题色 ⇒ 发光跟着变"仍然成立
const themeSaved = await evaluate(`(()=>{ const de=document.documentElement; const s=de.style.getPropertyValue('--theme');
  de.style.setProperty('--theme','rgb(200, 30, 90)'); return s; })()`);
await sleep(1000);
const swapped = await probe();
await evaluate(`(()=>{ const de=document.documentElement; const s=${JSON.stringify(themeSaved)};
  if (s) de.style.setProperty('--theme', s); else de.style.removeProperty('--theme'); return 1; })()`);
await sleep(1000);
const restored = await probe();
const swCell = swapped.cells.find(c => c.glow) || { afterShadow: 'none' };
const swLayers = parseShadow(swCell.afterShadow);
ok(swapped.theme.replace(/\s/g, '') === 'rgb(200,30,90)', `⑥ 临时把 --theme 改成 ${swapped.theme}`);
ok(swLayers.length === 1 && swLayers.every(l => (rgbOf(l.color) || []).join(',') === '200,30,90'),
  `⑥ ★★ 浅色下格子发光跟着 --theme 变（${swLayers.map(l => l.color).join(' ｜ ')}）⇒ 用的是站点变量，不是写死色`);
const restoredCell = restored.cells.find(c => c.glow) || { afterShadow: 'none' };
ok(JSON.stringify(parseShadow(restoredCell.afterShadow).map(l => rgbOf(l.color))) === JSON.stringify(gShadow.map(l => rgbOf(l.color))),
  '⑥ 主题色还原后发光颜色也还原');
// ── 暗色 ──
const darkAttr = await setScheme('dark');
const darkProbe = await probe();
const darkCell = darkProbe.cells.find(c => c.glow) || { afterShadow: 'none' };
const darkLayers = parseShadow(darkCell.afterShadow);
ok(darkAttr === 'dark' && darkProbe.scheme === 'dark', `⑥ ★★ 站点的"明暗"机制切到暗色（html[data-color-scheme]="${darkAttr}"）`);
ok(darkLayers.length === 1 && darkLayers.every(l => (rgbOf(l.color) || []).join(',') === '255,255,255'),
  `⑥ ★★★ 暗色下发光 = **一层白光**（${darkLayers.length} 层；${darkLayers.map(l => l.color).join(' ｜ ')}）`);
const dRgb = darkLayers.map(l => rgbOf(l.color) || []);
ok(dRgb.every(c => c[0] === 255 && c[1] === 255 && c[2] === 255) && !dRgb.some(c => c.join(',') === themeRgb.join(',')),
  `⑥ ★★★ 暗色下**不是蓝色/主题色**（互相排除：${dRgb.map(c => c.join(',')).join(' ｜ ')} ≠ --theme=${darkProbe.theme}）`);
ok(darkLayers.every(l => l.blur > 0 && l.spread >= 1) && darkLayers.map(l => alphaOf(l.color)).every(a => a > 0.2 && a <= 0.95),
  `⑥ ★★★ 暗色这一层同样是 blur > 0 的柔光、无实圈（blur ${darkLayers.map(l => l.blur).join('/')}px、spread ${darkLayers.map(l => l.spread).join('/')}px、alpha ${darkLayers.map(l => alphaOf(l.color)).join(' / ')}）`);
const dpAlphas = darkLayers.map(l => alphaOf(l.color));
ok(dpAlphas.length === 1,
  `⑥ ★★★ 暗色实际渲染也只有 ${darkLayers.length} 层（alpha ${dpAlphas.join(' / ')}）⇒ 暗色下不会出现"实圈 + 柔光"两圈`);
const darkPair = await pairFor(darkProbe, '暗色');
const darkP = profileOf(darkPair.withoutGlow, darkPair.withGlow, darkProbe, '暗色');
const darkEdge = edgeColorStats(darkPair.withoutGlow, darkPair.withGlow, darkCell.rect, darkProbe.dpr);
assertNoHardEdge(darkP, '暗色', '暗色');
ok(darkP.peak.maxd >= 100,
  `⑥ ★★★ 暗色：0-1px 峰值更高（最大Δ${darkP.peak.maxd}）—— 比浅色那档（Δ${lightP.peak.maxd}）更"一眼看得见"`);
ok(darkEdge.spread <= 40 && darkEdge.lum >= 140,
  `⑥ ★★★ 暗色边缘像素是"白光"（平均通道极差 ${darkEdge.spread} ≤ 40、平均亮度 ${darkEdge.lum} ≥ 140）⇒ 在白底上看不见的白光在这里正好显眼`);
await restoreGlow(TOP_Y, '10');
// 系统跟随：明暗=system 时由 prefers-color-scheme 决定（证明用的是站点既有机制，而不是另加的死类名）
await setScheme('system');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await sleep(900);
const sysDark = await evaluate(`document.documentElement.getAttribute('data-color-scheme')`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await sleep(900);
const sysLight = await evaluate(`document.documentElement.getAttribute('data-color-scheme')`);
ok(sysDark === 'dark' && sysLight === 'light',
  `⑥ ★★ "跟随系统"时站点跟着 prefers-color-scheme 走（模拟暗色 ⇒ ${sysDark}、模拟浅色 ⇒ ${sysLight}）—— 发光判定用的是同一个站点机制`);
await send('Emulation.setEmulatedMedia', { features: [] });
// 换肤不挪盒子
await setScheme('dark');
const darkGeo = await probe();
await setScheme('light');
const lightGeo = await probe();
ok(JSON.stringify(darkGeo.rect) === JSON.stringify(lightGeo.rect) && JSON.stringify(darkGeo.rows) === JSON.stringify(lightGeo.rows) &&
  cellsEq(darkGeo.cells.map(c => c.rect), lightGeo.cells.map(c => c.rect), 0.001),
  `⑥ ★★ 明暗切换前后容器/每一行/每个格子的矩形逐值不变（${darkGeo.cells.length} 格）—— 换光色不挪盒子`);
ok(lightGeo.glowCells === 1, `⑥ 回到浅色后仍是那 1 格发光（状态没丢）`);

// ─────────── ⑦ A→B 切换与两条点击路径 ───────────
console.log('\n══════ ⑦ 换格子：A→B 正确切换；→ 全部熄灭；点表头/点格子两条真实路径 ══════\n');
await setFilter(TOP_Y, '10');
const a10 = await probe();
await setFilter(TOP_Y, '02');
const b02 = await probe();
const rA = glowSetReport(a10, c => c.year === String(TOP_Y) && c.month === '10');
const rB = glowSetReport(b02, c => c.year === String(TOP_Y) && c.month === '02');
ok(rA.got.length === 1 && rB.got.length === 1 && rB.equal && b02.cells.filter(c => c.month === '10').every(c => !c.glow),
  `⑦ ★★★ 单格 A→B：${TOP_Y}/10 那格熄灭、${TOP_Y}/02 那格亮起（各恰好 1 格，集合完全对上）`);
await setFilter(BOT_Y, '02');
const bot = await probe();
const rBot = glowSetReport(bot, c => c.year === String(BOT_Y) && c.month === '02');
ok(rBot.got.length === 1 && rBot.got[0].year === String(BOT_Y) && bot.cells.filter(c => c.year === String(TOP_Y)).every(c => !c.glow),
  `⑦ ★★ 换年份也正确：现在只有 ${BOT_Y}/02 那一格发光（${TOP_Y} 年整行都不亮）`);
await setFilter('全部', '全部');
const back = await probe();
ok(zeroGlow(back), `⑦ ★★★ →「全部时间」：**0 格**发光、连伪元素都不生成（.hm-month-glow=${back.glowClassAnywhere}）`);
await setFilter('全部', '07');
const backHist = await probe();
ok(zeroGlow(backHist) && backHist.filterMonth === '07', '⑦ ★★★ →「历年 7 月」：**0 格**发光（最终口径：年份=全部 ⇒ 不发光）');
// 点月份表头（它只筛月份、年份保持"全部"）⇒ 按最终口径应当**0 格**发光
const mLabel = await evaluate(`(()=>{ const m=document.querySelectorAll('.tl-heatmap-mlabel')[6]; if(!m) return ''; m.click(); return m.dataset.label; })()`);
await sleep(1100);
const afterLabel = await probe();
ok(String(mLabel) === '7' && afterLabel.filterMonth === '07' && afterLabel.filterYear === '全部' && zeroGlow(afterLabel),
  `⑦ ★★★ 点月份表头「${mLabel}」⇒ 年份=全部、月=07 ⇒ **0 格**发光（这是最终口径最关键的一条：不是一排都亮）`);
// 点格子（年月都筛上）⇒ 恰好 1 格
const clickInfo = await evaluate(`(()=>{
  const c=[...document.querySelectorAll('.tl-heatmap-cell')].find(x=>+x.dataset.amount>0);
  if(!c) return null; const y=c.dataset.year, m=c.dataset.month; c.click(); return y+'/'+m; })()`);
await sleep(1100);
const afterCell = await probe();
ok(!!clickInfo && afterCell.filterYear === clickInfo.split('/')[0] && afterCell.filterMonth === clickInfo.split('/')[1],
  `⑦ 点格子（${clickInfo}）⇒ 年+月都筛上（${afterCell.filterYear}/${afterCell.filterMonth}）`);
const rClick = glowSetReport(afterCell, c => c.year === clickInfo.split('/')[0] && c.month === clickInfo.split('/')[1]);
ok(rClick.got.length === 1 && rClick.equal, `⑦ ★★★ 这条点击路径只让那一格发光（${rClick.gotK.join('')}）`);

// ─────────── ⑧ 命中测试与 hover 交互 ───────────
console.log('\n══════ ⑧ 命中测试与 hover 交互不受发光影响 ══════\n');
await setFilter(TOP_Y, '10');
const hit = JSON.parse(await evaluate(`(()=>{
  const cells=[...document.querySelectorAll('.tl-heatmap-cell')];
  const glow=cells.filter(c=>c.classList.contains('hm-month-glow'));
  const other=cells.find(c=>!c.classList.contains('hm-month-glow'));
  if(!glow.length || !other) return JSON.stringify({ glowSelf:false, glowCls:'(没有发光格)', otherSelf:false, neighbour:false, neighbourCls:'', labelSelf:false });
  const mid=(e)=>{const r=e.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2];};
  const nm=(e)=>document.elementFromPoint(...mid(e));
  const g=glow[0], gNear=cells[cells.indexOf(g)+1];
  const y=document.querySelector('.tl-heatmap-row .tl-heatmap-ylabel');
  return JSON.stringify({ glowSelf: nm(g)===g, glowCls: nm(g)?nm(g).className:null, otherSelf: nm(other)===other,
    neighbour: nm(gNear)===gNear, neighbourCls: nm(gNear)?nm(gNear).className:null, labelSelf: nm(y)===y });
})()`));
ok(hit.glowSelf && /tl-heatmap-cell/.test(hit.glowCls || ''), `⑧ ★★★ 发光格中心命中它自己（elementFromPoint=${hit.glowCls}）—— 光圈没有吃掉命中`);
ok(hit.neighbour, `⑧ ★★★ 紧挨发光格的邻格中心命中邻格自己（${hit.neighbourCls}）—— 没有"盖住邻格导致命中漂移"`);
ok(hit.otherSelf, '⑧ ★★ 未发光格中心命中也正常');
ok(hit.labelSelf, '⑧ ★★ 年份标签中心命中也正常');
const hoverProbe = async (sel) => {
  const pt = JSON.parse(await evaluate(`(()=>{ const e=${sel}; if(!e) return JSON.stringify(null); const r=e.getBoundingClientRect();
    return JSON.stringify([Math.round((r.left+r.width/2)*100)/100, Math.round((r.top+r.height/2)*100)/100]); })()`));
  if (!pt) return null;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1], button: 'none' });
  await sleep(500);
  return JSON.parse(await evaluate(`(()=>{
    const cell=document.elementFromPoint(${pt[0]}, ${pt[1]});
    if(!cell) return JSON.stringify(null);
    const cs=getComputedStyle(cell);
    const fill=cell.querySelector('.tl-hm-fill');
    const tip=cell.querySelector('.tl-heatmap-tip');
    return JSON.stringify({ cls: cell.className, hoverShadow: cs.boxShadow, zIndex: cs.zIndex,
      fillTransform: fill?getComputedStyle(fill).transform:null,
      tipOpacity: tip?getComputedStyle(tip).opacity:null, tipVis: tip?getComputedStyle(tip).visibility:null,
      afterShadow: getComputedStyle(cell,'::after').boxShadow }); })()`));
};
const hGlow = await hoverProbe(`document.querySelector('.tl-heatmap-cell.hm-month-glow')`);
ok(hGlow && /rgba?\(0, 0, 0/.test(hGlow.hoverShadow || '') && /matrix\(1\.0[1-9]/.test(hGlow.fillTransform || ''),
  `⑧ ★★★ 悬浮发光格：既有的悬浮投影与"色块放大 4%"照旧生效（box-shadow=${hGlow && hGlow.hoverShadow}｜fill transform=${hGlow && hGlow.fillTransform}）`);
ok(hGlow && parseShadow(hGlow.afterShadow).length === 1,
  `⑧ ★★ 悬浮时发光**没有被悬浮样式顶掉**（::after 仍是那一层柔光：${hGlow && String(hGlow.afterShadow).slice(0, 60)}…）`);
ok(hGlow && hGlow.tipOpacity === '1' && hGlow.tipVis === 'visible',
  `⑧ ★★★ 悬浮泡照常弹出（opacity=${hGlow && hGlow.tipOpacity}、visibility=${hGlow && hGlow.tipVis}）`);
const hPlain = await hoverProbe(`[...document.querySelectorAll('.tl-heatmap-cell')].find(c=>!c.classList.contains('hm-month-glow'))`);
ok(hPlain && /rgba?\(0, 0, 0/.test(hPlain.hoverShadow || '') && parseShadow(hPlain.afterShadow).length === 0,
  `⑧ ★★ 未发光格的悬浮行为完全不变（投影照旧、::after 仍为 none）`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
await sleep(400);

// ─────────── ⑨ reduced-motion ───────────
console.log('\n══════ ⑨ prefers-reduced-motion：发光静止、无动画 ══════\n');
await setFilter(TOP_Y, '10');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await sleep(400);
const np = await probe();
const npShadow = (np.cells.find(c => c.glow) || { afterShadow: 'none' }).afterShadow;
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(400);
const rd = await probe();
const rdShadow = (rd.cells.find(c => c.glow) || { afterShadow: 'none' }).afterShadow;
ok(parseShadow(npShadow).length === 1, `⑨ no-preference 下那一层柔光在（${String(npShadow).slice(0, 50)}…）`);
ok(rdShadow === npShadow, `⑨ ★★★ reduce 下发光**完全静止**（::after box-shadow 与 no-preference 逐字相同）`);
const anim = JSON.parse(await evaluate(`(()=>{ const c=document.querySelector('.tl-heatmap-cell.hm-month-glow');
  if(!c) return JSON.stringify({ cell:'(无发光格)', after:'(无发光格)', cellTr:'(无发光格)' });
  return JSON.stringify({ cell: getComputedStyle(c).animationName, after: getComputedStyle(c,'::after').animationName,
    cellTr: getComputedStyle(c).transitionProperty }); })()`));
ok(anim.after === 'none' && anim.cell === 'none', `⑨ ★★★ reduce 下没有动画（格子 animation-name=${anim.cell}、发光伪元素=${anim.after}；格子的 transition 只含 transform/box-shadow=${anim.cellTr}）`);
await send('Emulation.setEmulatedMedia', { features: [] });
await sleep(300);

// ─────────── ⑩ 手机 375px ───────────
console.log('\n══════ ⑩ 手机 375px：断点不同（格子更小、列间距 2px），发光同样正确且不溢出 ══════\n');
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: true });
await sleep(1000);
await setFilter(TOP_Y, '10');
const mob = await probe();
const rmob = glowSetReport(mob, c => c.year === String(TOP_Y) && c.month === '10');
ok(mob.gap === 2 && mob.cells[0].rect[2] !== base.cells[0].rect[2],
  `⑩ ★★ 手机断点确实不同（列间距 ${mob.gap}px、格子 ${mob.cells[0].rect[2]}px vs 桌面 ${base.cells[0].rect[2]}px）—— 光圈贴着每格自己的盒子，自动跟着断点走`);
ok(rmob.got.length === 1 && rmob.equal, `⑩ ★★★ 375px 下仍是**恰好 1 格**发光且就是 ${TOP_Y}/10 那一格`);
ok(zeroGlow(await (async () => { await setFilter('全部', '07'); const p = await probe(); await setFilter(TOP_Y, '10'); return p; })()),
  '⑩ ★★★ 375px 下「历年 7 月」同样是 0 格发光');
const mobGlowProbe = await probe();
const mobPair = await pairFor(mobGlowProbe, '375px');
const mobCell = mobGlowProbe.cells.find(c => c.glow) || { rect: [0, 0, 1, 1] };
const mobSt = bandAt(mobPair.withoutGlow, mobPair.withGlow, mobCell.rect, mobGlowProbe.dpr, 0, 1);
ok(['上', '下', '左', '右'].every(s => mobSt[s].n >= mobSt[s].area * 0.4 && mobSt[s].maxd >= 8),
  `⑩ ★★★ 375px 下那一格四边都能看见光圈（带宽按手机 2px 间隙取 1px；${['上', '下', '左', '右'].map(s => `${s}${mobSt[s].n}/${mobSt[s].area}(Δ${mobSt[s].maxd})`).join(' ')}）`);
await restoreGlow(TOP_Y, '10');
const mobOverflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
ok(mobOverflow <= 1, `⑩ ★★ 手机上加发光也不横向溢出（scrollWidth - innerWidth = ${mobOverflow}）`);
ok((await probe()).glowOnContainer === 0, '⑩ ★★ 手机上容器依然没有任何发光（光只在格子上）');

// ─────────── ⑪ 其它板块 / 重进 / 重载 ───────────
console.log('\n══════ ⑪ 其它板块不带这个类；重进与重新加载的行为 ══════\n');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(800);
await setFilter(TOP_Y, '10');
const beforeLeave = await probe();
ok(beforeLeave.glowCells === 1, `⑪ 离开拾年之前，那一格正在发光（${beforeLeave.glowCells} 格）`);
const leak = async (label) => {
  const r = JSON.parse(await evaluate(`(()=>{
    const root=(typeof getRenderContainer==='function'&&getRenderContainer())||document;
    const hms=[...root.querySelectorAll('.tl-heatmap')];
    return JSON.stringify({ glow: root.querySelectorAll('.hm-month-glow').length,
      glowInDoc: document.querySelectorAll('.hm-month-glow').length, hmCount: hms.length,
      shadows: hms.map(e=>getComputedStyle(e).boxShadow) });
  })()`));
  ok(r.glow === 0 && r.glowInDoc === 0, `⑪ ★★ ${label}：没有任何 .hm-month-glow（当前容器 ${r.glow} / 整篇文档 ${r.glowInDoc}）`);
  ok(r.shadows.every(s => s === 'none') || r.hmCount === 0, `⑪ ${label}：热力图容器（${r.hmCount} 个）也没有发光阴影`);
};
await evaluate(`(()=>{ const t=(typeof specialCategoryTree!=='undefined'&&specialCategoryTree)||[];
  const hit=t.find(c=>c.id==='denom')||t.find(c=>/面额/.test(c.name||''));
  if (hit && typeof onSpecialOverviewItemClick==='function') onSpecialOverviewItemClick(hit.id); return hit?hit.id:''; })()`);
await sleep(1200);
await leak('面额大观专题');
await evaluate(`(()=>{ if (typeof backFromTimeline==='function') backFromTimeline(); return 1; })()`);
await sleep(900);
await evaluate(`(()=>{ const t=(typeof specialCategoryTree!=='undefined'&&specialCategoryTree)||[];
  const hit=t.find(c=>c.id==='shanhe')||t.find(c=>/山河/.test(c.name||''));
  if (hit && typeof onSpecialOverviewItemClick==='function') onSpecialOverviewItemClick(hit.id); return hit?hit.id:''; })()`);
await sleep(1400);
await leak('方寸山河专题');
await evaluate(`(()=>{ if (typeof onTabClick==='function') onTabClick('notes'); return 1; })()`);
await sleep(1200);
await leak('普通板块（笔记首页）');
await evaluate(`(()=>{ const t=(typeof specialCategoryTree!=='undefined'&&specialCategoryTree)||[];
  const hit=t.find(c=>/拾年|时间轴/.test(c.name||''))||t.find(c=>c.id==='timeline');
  if (hit && typeof onSpecialOverviewItemClick==='function') onSpecialOverviewItemClick(hit.id); return hit?hit.id:''; })()`);
for (let i = 0; i < 40; i++) { if (await evaluate(`!!document.querySelector('.tl-heatmap')`).catch(() => false)) break; await sleep(300); }
await sleep(900);
const reenter = await probe();
ok(reenter.filterMonth === '10' && reenter.glowCells === 1,
  `⑪ ★★ 重回拾年：筛选仍是 ${reenter.filterYear}/${reenter.filterMonth} ⇒ 仍然恰好 1 格发光`);
ok(JSON.stringify(base.rect) === JSON.stringify(reenter.rect) && cellsEq(base.cells.map(c => c.rect), reenter.cells.map(c => c.rect), 0.5),
  '⑪ ★★ 重回拾年后容器/格子矩形仍与最初基线一致（容差 0.5px）');
await boot('notes');
await openYears();
// 重新加载后 app 启动是异步的：等热力图（24 格）真的渲染出来再取状态，别把"还没渲染"当成结论
for (let i = 0; i < 40; i++) {
  const p = await probe().catch(() => null);
  if (p && p.found && Array.isArray(p.cells) && p.cells.length === 24) break;
  await sleep(300);
}
await sleep(400);
const cold = await probe();
ok(cold.filterMonth === '全部' && zeroGlow(cold), `⑪ ★ 重新加载页面后月份筛选回到"全部" ⇒ 0 格发光（${cold.glowCells} 格）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
