/**
 * 线上验收：直接对着 GitHub Pages 上的真实页面跑关键回归。
 *
 * 为什么要在线上再跑一遍：本地套件走的是本地 http 服务，
 * 而线上是 https + CDN 缓存。要确认「用户实际打开的那一份」里
 * 展开/收起都正常、且上拉栏没闪烁。
 */
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const URL_LIVE = 'https://tong-xiangjie.github.io/chat-demo-v0.1.2/';
const CDP_PORT = 9410;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'cdp-live-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', '--hide-scrollbars', URL_LIVE], { stdio: 'ignore' });
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(6000);
const ev = (e) => cdp.evaluate(e);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

console.log('\n=== 线上验收 ' + URL_LIVE + ' ===\n');

check('页面加载出侧栏', !!(await ev(`!!document.querySelector('.sider-ac14ac')`)));
check('动效层已启用', (await ev(`document.documentElement.classList.contains('ls-motion')`)) === true);
check('桥接层版本', (await ev(`window.__localstore && window.__localstore.version`)) === '1.2.0',
  await ev(`String(window.__localstore && window.__localstore.version)`));

// --- 收起：主区宽度必须渐变 ---
const collapse = JSON.parse(await ev(`
  (async () => {
    const main = () => document.querySelector('.main-_9fdf5');
    const trace = [];
    document.querySelector('.top-ac14ac button[aria-label]').click();
    for (let i = 0; i < 20; i++) { await new Promise(r => requestAnimationFrame(() => r())); trace.push(Math.round(main().getBoundingClientRect().width)); }
    await new Promise(r => setTimeout(r, 800));
    return JSON.stringify({ trace, distinct: [...new Set(trace)].length,
      siderGone: !document.querySelector('.sider-ac14ac'),
      mainW: Math.round(main().getBoundingClientRect().width),
      collapsedShown: !!document.querySelector('.collapsed-ac14ac') });
  })()
`));
check('收起时主区渐变（≥5 个中间值）', collapse.distinct >= 5, '不同值 ' + collapse.distinct);
check('收起后侧栏已移除', collapse.siderGone === true);
check('收起后主区铺满', collapse.mainW > 1300, '宽度 ' + collapse.mainW);

// --- 展开：主区左边缘必须渐变（本次修复的核心） ---
const expand = JSON.parse(await ev(`
  (async () => {
    const main = () => document.querySelector('.main-_9fdf5');
    const trace = [], times = [];
    document.querySelector('.collapsed-ac14ac button[aria-label]').click();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      trace.push(Math.round(main().getBoundingClientRect().left));
      times.push(Math.round(performance.now()));
    }
    await new Promise(r => setTimeout(r, 800));
    const s = document.querySelector('.sider-ac14ac');
    const gaps = times.map((t, i) => i ? t - times[i-1] : 0).slice(1);
    return JSON.stringify({ trace, distinct: [...new Set(trace)].length,
      maxJump: Math.max(...trace.map((v, i) => i ? Math.abs(v - trace[i-1]) : 0)),
      maxGap: Math.max(...gaps), avgGap: Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length),
      frames: gaps.length,
      siderW: s ? Math.round(s.getBoundingClientRect().width) : null,
      mainX: Math.round(main().getBoundingClientRect().left),
      inlineW: s ? s.style.width : 'x' });
  })()
`));
console.log('    展开逐帧: ' + JSON.stringify(expand.trace));
console.log('    帧间隔: 平均 ' + expand.avgGap + 'ms 最大 ' + expand.maxGap + 'ms（' + expand.frames + ' 帧）');
check('展开时主区渐变（≥5 个中间值）', expand.distinct >= 5, '不同值 ' + expand.distinct);
// 单帧位移要结合真实帧间隔判断：200ms 动画走 261px，
// 若某帧间隔 100ms（CDN 首屏时常见），单帧走 140px 属于正常，
// 不是「瞬跳」。所以按「像素/毫秒」比较动画的平均速度，允许 2.5 倍余量。
const avgSpeed = 261 / 200;
const allowed = Math.ceil(avgSpeed * Math.max(expand.maxGap, 17) * 2.5);
check('展开时没有瞬跳（单帧位移不超过按帧间隔折算的合理值）',
  expand.maxJump <= allowed,
  '最大 ' + expand.maxJump + 'px，允许 ' + allowed + 'px（最大帧间隔 ' + expand.maxGap + 'ms）');
check('展开后侧栏宽度归位 261', expand.siderW === 261, '宽度 ' + expand.siderW);
check('展开后主区左边缘归位 261', expand.mainX === 261, 'x=' + expand.mainX);
check('展开后清掉接管用的内联宽度', !expand.inlineW, '内联 width=' + String(expand.inlineW));

// --- 上拉栏不能闪烁（元素重建次数必须为 0） ---
const flicker = JSON.parse(await ev(`
  (async () => {
    let added = 0, removed = 0;
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.nodeType === 1 && n.id === 'ls-composer-model') added++;
        for (const n of r.removedNodes) if (n.nodeType === 1 && n.id === 'ls-composer-model') removed++;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    await new Promise(r => setTimeout(r, 3000));
    obs.disconnect();
    const node = document.getElementById('ls-composer-model');
    return JSON.stringify({ added, removed, present: !!node,
      onBody: !!node && node.parentElement === document.body,
      pos: node ? getComputedStyle(node).position : null,
      label: node ? node.getAttribute('data-ls-label') : null });
  })()
`));
check('3 秒内上拉栏零重建（不闪烁）', flicker.added === 0 && flicker.removed === 0,
  JSON.stringify(flicker));
check('上拉栏挂在 body 上且 fixed 定位',
  flicker.onBody === true && flicker.pos === 'fixed', JSON.stringify(flicker));

// --- 收起过程中，替身必须自己画背景，不能在左边露出 frame 底色 ---
const leak = JSON.parse(await ev(`
  (async () => {
    const real = document.querySelector('.sider-ac14ac');
    const rcs = getComputedStyle(real);
    const realBg = rcs.backgroundColor;
    const out = { realBg, samples: [] };
    document.querySelector('.top-ac14ac button[aria-label]').click();
    for (let i = 0; i < 8; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      const g = document.querySelector('.ls-sider-ghost');
      if (!g) continue;
      const gr = g.getBoundingClientRect();
      out.samples.push({ w: Math.round(gr.width), bg: getComputedStyle(g).backgroundColor });
    }
    await new Promise(r => setTimeout(r, 900));
    return JSON.stringify(out);
  })()
`));
console.log('    真侧栏背景 ' + leak.realBg + ' / 替身逐帧: ' + JSON.stringify(leak.samples));
check('替身自带侧栏背景色（不透明，宽 > 0 时）',
  leak.samples.length > 0 && leak.samples.filter((s) => s.w > 4).every((s) => s.bg === leak.realBg),
  '真身 ' + leak.realBg + ' 替身 ' + JSON.stringify(leak.samples.map((s) => s.bg)));
check('替身背景不是透明的',
  leak.samples.filter((s) => s.w > 4).every((s) => s.bg !== 'rgba(0, 0, 0, 0)'),
  JSON.stringify(leak.samples.map((s) => s.bg)));

console.log('\n' + '='.repeat(46));
console.log(`线上验收: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
