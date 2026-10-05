// 验收：head 里的防闪脚本必须把 applyTheme() 会写的**整套**主题变量都预置上。
//
// 背景（用户报的 bug，比最初以为的大）：
//   head 脚本原来只 setProperty('--theme', t)，其余派生变量全靠 theme.js 补。
//   于是从"head 脚本跑完"到"theme.js 的 applyTheme() 跑完"这段窗口期里，
//   所有派生变量都还是 layout.css 里那套**按默认蓝算出来**的值 ——
//   自定义主题（如铜 #b87333）下整页背景会先闪一次蓝底再跳成暖底：
//     亮色 --bg #eef4ff → #f9f4ef、--sidebar-bg #e4edf8 → #f5ebe2、--border #d5dce8 → #efe0d2
//     暗色 --bg #0f1115 → #0b0703、--card-bg #22262e → #1a1007、--border #2c313a → #736557
//   外加首屏 .mode-toggle、各处 hover 边框、山河图例渐变先蓝一下。
//
// 判据（确定、灵敏，不靠"碰运气采样那一瞬间"）：
//   ★ "不闪" 的定义 = head 预置的值 与 theme.js 最终算出的值**完全相等**。
//   做法：用 CDP 的 Network.setBlockedURLs 把 theme.js 拦掉，页面就永久停在
//   "head 脚本刚跑完"的那一刻，读到的就是窗口期用户会看到的颜色；再放开
//   theme.js 正常加载读最终值。两者必须逐变量一模一样。
//
//   ★ 这个验收同时是"head 与 theme.js 两份实现不许漂移"的守卫：
//     遍历**全部预设主题色 × 明暗两模式**（预设色直接从 settings.js 里读，
//     以后新增预设色会自动纳入），任何一处对不上都失败。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// 预设主题色从 settings.js 里读出来 —— 以后加预设色，这个验收自动覆盖到
const settingsSrc = await readFile(join(ROOT, 'collection', 'settings.js'), 'utf8');
const presetBlock = settingsSrc.match(/const presetColors = \[([\s\S]*?)\];/);
if (!presetBlock) throw new Error('没在 settings.js 里找到 presetColors');
const PRESETS = [...presetBlock[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map(m => m[1]);
if (PRESETS.length < 2) throw new Error('预设色解析异常：' + JSON.stringify(PRESETS));
// #abc 是 3 位缩写（app-theme 实际不会存这个格式，但 head 与 theme.js 都支持，
// 顺带确认两边那条"展开成 6 位"的分支也一致）
const COLORS = [...PRESETS, '#abc'];

// applyTheme() 会写的全部变量
const THEME_VARS = ['--theme', '--theme-light', '--row-hover-bg', '--bg', '--bg-light',
  '--sidebar-bg', '--card-bg', '--border', '--thumb-bg', '--text', '--text-secondary'];

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpThemeInit-'));
const DP = 10871;
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

const PROBE = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of ${JSON.stringify(THEME_VARS)}) out[n] = cs.getPropertyValue(n).trim();
  const e = document.querySelector('.mode-toggle');
  out['.mode-toggle 颜色'] = e ? getComputedStyle(e).color : '(无此元素)';
  return JSON.stringify(out);
})()`;

// 写好偏好 → 按需拦掉 theme.js → 刷新
async function load(color, mode, blockThemeJs) {
  await send('Network.setBlockedURLs', { urls: blockThemeJs ? ['*theme.js*'] : [] });
  await evaluate(`(()=>{ localStorage.setItem('app-theme', ${JSON.stringify(color)});
    localStorage.setItem('collection-color-scheme', ${JSON.stringify(mode)}); return true; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1900);
  const ran = await evaluate(`(()=>typeof applyTheme === 'function')()`);
  return { ran, vars: JSON.parse(await evaluate(PROBE)) };
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const errs = [];
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(JSON.stringify(m.params.args.map(a => a.value || a.description))); });

  // 先落地一次，之后靠 localStorage + reload 切颜色
  await send('Network.setBlockedURLs', { urls: [] });
  await send('Page.navigate', { url: BASE + 'index.html' });
  await sleep(2200);

  console.log(`══════ 全部预设色 × 明暗两模式：head 预置值必须逐变量等于 theme.js 最终值 ══════`);
  console.log(`  预设色 ${PRESETS.length} 个：${PRESETS.join(' ')}`);
  console.log(`  变量 ${THEME_VARS.length} 个：${THEME_VARS.join(' ')}\n`);

  const allBad = [];
  for (const mode of ['light', 'dark']) {
    for (const color of COLORS) {
      const blocked = await load(color, mode, true);
      const normal = await load(color, mode, false);
      if (blocked.ran || !normal.ran) {
        allBad.push(`${mode}/${color} 探针失效(blocked.ran=${blocked.ran}, normal.ran=${normal.ran})`);
        continue;
      }
      const bad = [...THEME_VARS, '.mode-toggle 颜色'].filter(n => blocked.vars[n] !== normal.vars[n]);
      const tag = `${mode === 'dark' ? '暗' : '亮'} ${color}`;
      if (bad.length) {
        allBad.push(`${tag}: ${bad.map(n => `${n} ${blocked.vars[n]}→${normal.vars[n]}`).join('；')}`);
        console.log(`  ✗ ${tag}  ${bad.length} 个变量会闪`);
      } else {
        console.log(`  ✓ ${tag}  全部 ${THEME_VARS.length} 个变量窗口期值与最终值完全一致`);
      }
      // 第一个组合额外打一张完整对照表，方便人看
      if (color === COLORS[0] && mode === 'light') {
        console.log('      ── 明细（' + tag + '）');
        for (const n of THEME_VARS) {
          console.log(`         ${n.padEnd(20)} 窗口期 ${String(blocked.vars[n]).padEnd(22)} 最终 ${String(normal.vars[n]).padEnd(22)} ${blocked.vars[n] === normal.vars[n] ? '✓' : '✗'}`);
        }
      }
    }
  }

  ok(allBad.length === 0,
    `★ ${COLORS.length * 2} 个「颜色 × 模式」组合全部逐变量一致（head 与 theme.js 没有漂移）`);
  if (allBad.length) { console.log('    不一致明细：'); allBad.forEach(x => console.log('      · ' + x)); }

  // 探针灵敏度：修复前的实现（只设 --theme）必须能被测出来
  console.log('\n══════ 反向验证：把 head 退回"只设 --theme"，探针必须报错 ══════');
  const normalCopper = await load('#b87333', 'light', false);   // theme.js 的最终值
  await load('#b87333', 'light', true);                          // 让页面停在 head 刚跑完
  // 在页面上把派生变量摘掉、只留 --theme —— 这就是修复前的 head 留下的状态
  const oldImpl = JSON.parse(await evaluate(`(()=>{
    const el = document.documentElement;
    for (const n of ${JSON.stringify(THEME_VARS.slice(1))}) el.style.removeProperty(n);
    el.style.setProperty('--theme', '#b87333');
    const cs = getComputedStyle(el);
    const out = {};
    for (const n of ${JSON.stringify(THEME_VARS)}) out[n] = cs.getPropertyValue(n).trim();
    return JSON.stringify(out);
  })()`));
  const wouldFlash = THEME_VARS.filter(n => oldImpl[n] !== normalCopper.vars[n]);
  console.log(`  模拟旧实现（只设 --theme）时，窗口期不一致的变量 ${wouldFlash.length} 个：`);
  for (const n of wouldFlash) console.log(`      ${n.padEnd(20)} 窗口期 ${String(oldImpl[n]).padEnd(22)} 最终 ${normalCopper.vars[n]}`);
  ok(wouldFlash.length >= 6,
    `★ 反向验证：退回"只设 --theme"确实有 ${wouldFlash.length} 个变量会闪（修复前实测 6~7 个）—— 探针是灵敏的`);

  // 兜底：没存过主题色时不该多写内联变量
  console.log('\n══════ 兜底：没存过主题色时不许多写内联变量 ══════');
  // ★ 明暗必须显式指定：headless Chrome 的 prefers-color-scheme 默认是**暗色**，
  //   不指定的话量到的是暗色默认值，按亮色断言就会误报（我第一版就踩了这个）。
  const CSS_DEFAULTS = {
    light: { '--theme': '#1677ff', '--theme-light': '#4096ff', '--bg': '#eef4ff' },
    dark: { '--theme': '#1677ff', '--theme-light': '#4096ff', '--bg': '#0f1115' }
  };
  for (const mode of ['light', 'dark']) {
    await send('Network.setBlockedURLs', { urls: [] });
    await evaluate(`(()=>{ localStorage.removeItem('app-theme');
      localStorage.setItem('collection-color-scheme', ${JSON.stringify(mode)}); return true; })()`);
    await send('Network.setBlockedURLs', { urls: ['*theme.js*'] });
    await send('Page.reload', { ignoreCache: true });
    await sleep(1900);
    const want = CSS_DEFAULTS[mode];
    // ★ 颜色必须**归一化后**再比：layout.css 为了做明暗补间，把这些变量用
    //   @property 注册成了 <color>，于是同一个颜色读出来的序列化形态变了
    //   （#eef4ff → rgb(238, 244, 255)）。直接比字符串会误报，
    //   归一到 getComputedStyle 的 color 形态后，断言的**原意**（CSS 默认值
    //   有没有被多余的内联值覆盖）保持不变。
    const fresh = JSON.parse(await evaluate(`(()=>{
      const cs = getComputedStyle(document.documentElement);
      const d = document.createElement('span'); document.body.appendChild(d);
      const norm = v => { d.style.color = ''; d.style.color = v; return getComputedStyle(d).color; };
      const keys = ${JSON.stringify(Object.keys(want))};
      const raw = {}, normalized = {};
      for (const k of keys) { raw[k] = cs.getPropertyValue(k).trim(); normalized[k] = norm(raw[k]); }
      d.remove();
      return JSON.stringify({ raw, normalized });
    })()`));
    const wantNorm = JSON.parse(await evaluate(`(()=>{
      const d = document.createElement('span'); document.body.appendChild(d);
      const norm = v => { d.style.color = ''; d.style.color = v; return getComputedStyle(d).color; };
      const want = ${JSON.stringify(want)}, out = {};
      for (const k of Object.keys(want)) out[k] = norm(want[k]);
      d.remove();
      return JSON.stringify(out);
    })()`));
    const bad = Object.keys(want).filter(k => fresh.normalized[k] !== wantNorm[k]);
    console.log(`  [${mode === 'dark' ? '暗' : '亮'}色 + 无主题色偏好 + theme.js 被拦] --theme=${fresh.raw['--theme']}  --theme-light=${fresh.raw['--theme-light']}  --bg=${fresh.raw['--bg']}`
      + (bad.length ? `  ✗ 归一化后不一致：${bad.map(k => k + ' ' + fresh.normalized[k] + ' vs ' + wantNorm[k]).join('；')}` : '  （归一化后与 CSS 默认一致）'));
    ok(bad.length === 0,
      `没存过主题色时（${mode === 'dark' ? '暗' : '亮'}色），CSS 默认值原样保留、没有多余的内联覆盖`);
  }

  // ══════════════ 明暗切换的颜色补间 ══════════════
  // ★ 用户报："切换白天黑夜的时候，有一部分的颜色是突变的（那些框的背景色，
  //   比如评级/年代柱状图的背景）"。
  //   那些框吃的是 --thumb-bg / --theme 等变量，变量瞬间换值就一起跳。
  //   layout.css 用 @property 把颜色变量注册成可插值类型、只给变量加过渡，
  //   theme.js 在切换的那一小段时间挂 .theme-anim。
  //   这里验三件事：切换期间变量**真的在插值**（不是瞬间到位）、
  //   消费者（body 底色）跟着补间、切完把类摘掉。
  console.log('\n══════ 明暗切换的颜色补间 ══════');
  await send('Network.setBlockedURLs', { urls: [] });
  const SAMPLE = `(()=>{ const el=document.documentElement, cs=getComputedStyle(el);
    return JSON.stringify({
      body: getComputedStyle(document.body).backgroundColor,
      bg: cs.getPropertyValue('--bg').trim(),
      thumb: cs.getPropertyValue('--thumb-bg').trim(),
      cls: el.classList.contains('theme-anim')
    }); })()`;

  // ① 允许动效：变量必须"走"过去
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await evaluate(`(()=>{ localStorage.setItem('collection-color-scheme','light'); return true; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2200);
  const cLight = JSON.parse(await evaluate(SAMPLE));
  await evaluate(`(()=>{ setColorSchemeMode('dark'); return true; })()`);
  // ★ 不要死等固定毫秒再采样：机器忙的时候 120ms 可能还没开始变（第一次写就抖过）。
  //   改成轮询到"值第一次发生变化"那一帧 —— 这一帧是什么，正好能区分
  //   "在插值"（中间色）和"直接到位"（终值）。
  async function sampleFirstChange(fromBody, ms = 1500) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < ms) {
      last = JSON.parse(await evaluate(SAMPLE));
      if (last.body !== fromBody) return last;
      await sleep(25);
    }
    return last;
  }
  const cMid = await sampleFirstChange(cLight.body);
  await sleep(700);
  const cEnd = JSON.parse(await evaluate(SAMPLE));
  console.log(`  亮 body=${cLight.body} bg=${cLight.bg} thumb=${cLight.thumb}`);
  console.log(`  变化第一帧 body=${cMid.body} bg=${cMid.bg} thumb=${cMid.thumb}  类=${cMid.cls}`);
  console.log(`  暗 body=${cEnd.body} bg=${cEnd.bg} thumb=${cEnd.thumb}  类=${cEnd.cls}`);
  ok(cLight.cls === false, '切换前没有挂 .theme-anim（不常驻）');
  ok(cMid.cls === true, '★ 切换过程中挂着 .theme-anim');
  ok(cEnd.cls === false, '★ 切完把 .theme-anim 摘掉（不常驻，免得以后改这些变量都变慢）');
  ok(cMid.bg !== cLight.bg && cMid.bg !== cEnd.bg,
     `★ 变化第一帧 --bg 就是中间值 = 变量真的在插值（${cLight.bg} → ${cMid.bg} → ${cEnd.bg}）`);
  ok(cMid.thumb !== cLight.thumb && cMid.thumb !== cEnd.thumb,
     `★ 柱状图底色用的 --thumb-bg 同样在插值（${cLight.thumb} → ${cMid.thumb} → ${cEnd.thumb}）`);
  ok(cMid.body !== cLight.body && cMid.body !== cEnd.body,
     `★ 消费者跟着补间：body 背景第一帧就是中间色（${cLight.body} → ${cMid.body} → ${cEnd.body}）—— 用户看到的"突变"就是这里`);

  // ② 减弱动效：直接到位，不许有中间值
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const rLight = JSON.parse(await evaluate(SAMPLE));
  await evaluate(`(()=>{ setColorSchemeMode('light'); return true; })()`);
  const rMid = await sampleFirstChange(rLight.body);
  await sleep(500);
  const rEnd = JSON.parse(await evaluate(SAMPLE));
  console.log(`  减弱动效：变化第一帧 body=${rMid.body}（起点 ${rLight.body} / 终点 ${rEnd.body}）类=${rMid.cls}`);
  ok(rMid.cls === false, '★ 减弱动效时不挂 .theme-anim');
  ok(rMid.body === rEnd.body, `★ 减弱动效时直接到位，没有中间色（第一帧已是终值 ${rMid.body}）`);
  await send('Emulation.setEmulatedMedia', { features: [] });

  console.log(`\nconsole.error: ${errs.length ? errs.join(' | ') : '（无）'}`);
  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  await sleep(400);
  process.exit(fail ? 1 : 0);
}
