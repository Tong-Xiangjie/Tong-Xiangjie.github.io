// 方寸山河地图：深色模式适配验证（真实 Chrome，含像素采样 + 截图）
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_URL = process.env.TEST_URL || null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let server = null, PORT = 0;
if (!TARGET_URL) {
  server = createServer(async (req, res) => {
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
  PORT = server.address().port;
}
const BASE = TARGET_URL || `http://127.0.0.1:${PORT}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpMap-'));
const DP = 9441;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const warns = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) {
    warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 120));
  }
});

let fail = 0;
const chk = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};
// 颜色归一化：getComputedStyle 给 rgb()/rgba()，CSS 变量给 hex/简写，
// 直接比字符串会把"同一个颜色"判成不等（假失败）。统一成 [r,g,b]。
// ★ 必须先判 hex：用 /(\d+)/ 去解析 "#020c19" 会得到 [2,12,25]（把 c19 当十进制），
//   和 rgb(2,12,25) 恰好"看起来相等"，修 bug 时能骗过自己。
const toRGB = (c) => {
  if (!c) return null;
  const s = String(c).trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const m = s.match(/\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) return null;
  return [Math.round(+m[0]), Math.round(+m[1]), Math.round(+m[2])];
};
const chkColor = (label, got, want) => {
  const a = toRGB(got), b = toRGB(want);
  const ok = a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};

// 相对亮度 + WCAG 对比度（用于"省名是否看得见"这类判断）
const COLOR_FN = `
function __lum(c) {
  const s = String(c || '').trim();
  let rgb = null;
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    rgb = [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)];
  } else {
    const m = s.match(/\\d+(?:\\.\\d+)?/g);
    if (m && m.length >= 3) rgb = [+m[0], +m[1], +m[2]];
  }
  if (!rgb) return null;
  const ch = v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
function __contrast(a, b) {
  const la = __lum(a), lb = __lum(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
`;

async function openMapAt(scheme) {
  await send('Page.navigate', { url: BASE + '?m=' + Date.now() });
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 320));
    try { if (await evaluate(`document.querySelectorAll('.search-result-item').length > 0 && typeof switchToCurrentContainer === 'function'`)) break; } catch (e) {}
  }
  // 切到指定明暗
  await evaluate(`setColorSchemeMode(${JSON.stringify(scheme)})`);
  await new Promise(r => setTimeout(r, 500));
  // 进专题板块（专题概览，不是侧边栏项）
  await evaluate(`onTabClick('special')`);
  await new Promise(r => setTimeout(r, 1200));
  // 直接进"方寸山河"（专题卡片在概览里，onSpecialOverviewItemClick 是正式入口）
  await evaluate(`onSpecialOverviewItemClick('shanhe')`);
  // 等地图 SVG 就绪
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 400));
    try { if (await evaluate(`!!document.querySelector('.shanhe-map-wrap svg .state')`)) break; } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 1500));
  return evaluate(`(() => {
    ${COLOR_FN}
    const root = getComputedStyle(document.documentElement);
    const cs = p => root.getPropertyValue(p).trim();
    const wrap = document.querySelector('.shanhe-map-wrap');
    const states = [...wrap.querySelectorAll('svg .state')];
    // ★ 用省份元素上的 data-count 判断哪些省是空的。
    //   不要去"反推数据源"：空数组时 pid 全判成空省，而我第一版还把
    //   class="state jiangxi" 按"去掉 state 后剩下的那段"解析，正好取到
    //   "state" 自己，等于永远匹配不上任何省份。
    const countOf = el => Number(el.getAttribute('data-count') || 0);
    const pidOf = el => el.getAttribute('data-pid') || '';
    const emptyEl = states.find(el => countOf(el) <= 0);
    const filledEl = states.find(el => countOf(el) > 0);
    const maxCount = Math.max(0, ...states.map(countOf));
    const label = wrap.querySelector('.shanhe-label');
    const labelCount = wrap.querySelector('.shanhe-label-count');
    const labelCs = label ? getComputedStyle(label) : null;
    const strokeLayer = [...wrap.querySelectorAll('svg polygon:not(.state)')].find(p => (p.getAttribute('fill') || '') === 'none');
    const greyBlock = [...wrap.querySelectorAll('svg polygon:not(.state)')].find(p => p.hasAttribute('fill-rule'));
    return {
      scheme: document.documentElement.getAttribute('data-color-scheme'),
      dark: isDarkScheme(),
      vars: { bg: cs('--bg'), bgLight: cs('--bg-light'), cardBg: cs('--card-bg'), border: cs('--border'),
              theme: cs('--theme'), themeLight: cs('--theme-light'), text: cs('--text') },
      stateCount: states.length,
      emptyCount: states.filter(el => countOf(el) <= 0).length,
      maxCount,
      empty: emptyEl ? { pid: pidOf(emptyEl), count: countOf(emptyEl), fill: emptyEl.style.fill } : null,
      filled: filledEl ? { pid: pidOf(filledEl), count: countOf(filledEl), fill: filledEl.style.fill } : null,
      stateStrokeInline: states[0] ? states[0].style.stroke : null,
      labelFill: labelCs ? labelCs.fill : null,
      labelStroke: labelCs ? labelCs.stroke : null,
      labelCountFill: labelCount ? getComputedStyle(labelCount).fill : null,
      strokeLayerStroke: strokeLayer ? getComputedStyle(strokeLayer).stroke : null,
      strokeLayerFill: strokeLayer ? getComputedStyle(strokeLayer).fill : null,
      greyBlockFill: greyBlock ? getComputedStyle(greyBlock).fill : null,
      legendBar: (() => { const b = document.querySelector('.shanhe-legend-bar'); return b ? getComputedStyle(b).backgroundImage.slice(0, 90) : null; })(),
      contrastLabelVsBg: labelCs ? __contrast(labelCs.fill, cs('--bg')) : null,
      contrastLabelVsFilled: (labelCs && filledEl) ? __contrast(labelCs.fill, filledEl.style.fill) : null,
      contrastEmptyVsBg: emptyEl ? __contrast(emptyEl.style.fill, cs('--bg')) : null,
      contrastFilledVsEmpty: (emptyEl && filledEl) ? __contrast(filledEl.style.fill, emptyEl.style.fill) : null,
      // 诊断用：把参与计算的原始值一起带回来，免得对比度算出来是 null 还不知道为什么
      dbg: {
        labelFillRaw: labelCs ? labelCs.fill : null,
        bgRaw: cs('--bg'), bgLightRaw: cs('--bg-light'),
        lumLabel: labelCs ? __lum(labelCs.fill) : null,
        lumBg: __lum(cs('--bg')), lumBgLight: __lum(cs('--bg-light')),
        lumEmpty: emptyEl ? __lum(emptyEl.style.fill) : null,
        lumFilled: filledEl ? __lum(filledEl.style.fill) : null,
        emptyPid: emptyEl ? pidOf(emptyEl) : null,
        filledPid: filledEl ? pidOf(filledEl) : null,
        counts: states.map(countOf).filter(n => n > 0).slice(0, 12)
      }
    };
  })()`);
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(name, Buffer.from(r.data, 'base64'));
  return name;
}

console.log('目标: ' + BASE);

// ================= 深色 =================
console.log('\n=== 深色模式 ===');
const d = await openMapAt('dark');
chk('data-color-scheme = dark', d.scheme, 'dark');
chk('isDarkScheme() 为真', d.dark, true);
console.log('  · 变量: ' + JSON.stringify(d.vars));
console.log('  · 省份数 = ' + d.stateCount + '（空省 ' + d.emptyCount + ' 个），空省 = ' + JSON.stringify(d.empty) + '，有色省 = ' + JSON.stringify(d.filled));
console.log('  · 对比度: 省名/底色 = ' + d.contrastLabelVsBg + '，省名/满色省 = ' + d.contrastLabelVsFilled +
            '，空省/底色 = ' + d.contrastEmptyVsBg + '，满色省/空省 = ' + d.contrastFilledVsEmpty);
console.log('  · 诊断: ' + JSON.stringify(d.dbg));
chkColor('空省填色 = --bg-light', d.empty && d.empty.fill, d.vars.bgLight);
chk('空省与底色对比度低（是"留白"而不是"高光"）', d.contrastEmptyVsBg < 2, true);
chk('有数据的省明显亮于空省（热力图方向对）', d.contrastFilledVsEmpty > 1.5, true);
chkColor('省名 fill 走 --text', d.labelFill, d.vars.text);
chk('省名有描边垫底', !!d.labelStroke && d.labelStroke !== 'none', true);
chk('省名 vs 底色对比度 ≥ 4.5', d.contrastLabelVsBg >= 4.5, true);
chk('省名 vs 满色省份对比度 ≥ 3（靠描边垫底兜住）', d.contrastLabelVsFilled >= 3, true);
chk('省份描边内联为 var(--border)', d.stateStrokeInline, 'var(--border, #999)');
chkColor('SVG 自带白描边层已改成 --border', d.strokeLayerStroke, d.vars.border);
chk('SVG 自带描边层仍是"纯描边"（没被填实）', d.strokeLayerFill, 'none');
chkColor('无 class 的灰块已改成 --bg-light', d.greyBlockFill, d.vars.bgLight);
chk('图例渐变条已渲染', !!d.legendBar && d.legendBar.includes('gradient'), true);
await shot('map-dark.png');

// ================= 亮色 =================
console.log('\n=== 亮色模式（确认没把原来正常的亮色改坏） ===');
const l = await openMapAt('light');
chk('data-color-scheme = light', l.scheme, 'light');
chk('isDarkScheme() 为假', l.dark, false);
console.log('  · 变量: ' + JSON.stringify(l.vars));
console.log('  · 对比度: 省名/底色 = ' + l.contrastLabelVsBg + '，省名/满色省 = ' + l.contrastLabelVsFilled);
chk('空省仍是白色（亮色行为未变）', toRGB(l.empty && l.empty.fill), [255, 255, 255]);
chkColor('省名 fill 走 --text', l.labelFill, l.vars.text);
chk('省名 vs 底色对比度 ≥ 4.5', l.contrastLabelVsBg >= 4.5, true);
chk('省份描边内联为 var(--border)', l.stateStrokeInline, 'var(--border, #999)');
chkColor('SVG 白描边层已改成 --border', l.strokeLayerStroke, l.vars.border);
await shot('map-light.png');

// ================= 主题刷新（省份详情页/列表视图下的盲区） =================
console.log('\n=== 在列表视图下切明暗，返回地图后颜色必须是新主题（原来会留在旧配色） ===');
await evaluate(`setColorSchemeMode('light')`);
await new Promise(r => setTimeout(r, 400));
await evaluate(`shanheSwitchView('list')`);
await new Promise(r => setTimeout(r, 800));
const inList = await evaluate(`({ view: shanheViewMode, hash: location.hash })`);
console.log('  · 已切到列表视图: ' + JSON.stringify(inList));
await evaluate(`setColorSchemeMode('dark')`);
await new Promise(r => setTimeout(r, 700));
await evaluate(`shanheSwitchView('map')`);
await new Promise(r => setTimeout(r, 1200));
const after = await evaluate(`(() => {
  const states = [...document.querySelectorAll('.shanhe-map-wrap svg .state')];
  const empty = states.find(el => el.style.fill === 'rgb(255, 255, 255)');
  const anyFill = states[0] ? states[0].style.fill : null;
  return { scheme: document.documentElement.getAttribute('data-color-scheme'),
           anyFill, stillHasWhite: !!empty, bgLight: getComputedStyle(document.documentElement).getPropertyValue('--bg-light').trim() };
})()`);
chk('切回后主题是 dark', after.scheme, 'dark');
chk('缓存里的地图已跟着重算（没有残留白色空省）', after.stillHasWhite, false);

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 地图深色适配全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0, 6).join(' | ') : '（无）'));
console.log('截图: map-dark.png / map-light.png');
ws.close(); child.kill(); if (server) server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
