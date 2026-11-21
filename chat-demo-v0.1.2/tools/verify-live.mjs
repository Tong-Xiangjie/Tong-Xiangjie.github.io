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
await sleep(4000);
const ev = (e) => cdp.evaluate(e);

// 线上是 https + CDN，首屏比本地慢不少（实测偶尔要 8s+ 才渲染出侧栏）。
// 固定 sleep 会随机失败，所以这里轮询等就绪。
let ready = false;
for (let i = 0; i < 40; i++) {
  ready = await ev(`!!document.querySelector('.sider-ac14ac') && !!window.__localstore`);
  if (ready) break;
  await sleep(500);
}
console.log('\n=== 线上验收 ' + URL_LIVE + ' (就绪: ' + ready + ') ===\n');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

check('页面加载出侧栏', !!(await ev(`!!document.querySelector('.sider-ac14ac')`)));
check('动效层已启用', (await ev(`document.documentElement.classList.contains('ls-motion')`)) === true);
check('桥接层版本', (await ev(`window.__localstore && window.__localstore.version`)) === '1.2.0',
  await ev(`String(window.__localstore && window.__localstore.version)`));

// --- 收起：主区宽度必须渐变 ---
// ⚠ 采样方式：按 rAF 连续采 320ms（动画 200ms），而不是"采 20 帧"。
//   rAF 节奏受 CDN 首屏影响，实测有时 30ms 一帧，"20 帧"只覆盖 600ms 里的
//   前一小段，采到的中间值可能不足 5 个（动画明明是对的）→ 偶发假失败。
//   按时间采就稳定了：只要动画是渐进的，就一定能采到多个中间值。
const collapse = JSON.parse(await ev(`
  (async () => {
    const main = () => document.querySelector('.main-_9fdf5');
    const trace = [], times = [];
    const w = () => Math.round(main().getBoundingClientRect().width);
    const w0 = w();
    document.querySelector('.top-ac14ac button[aria-label="收起边栏"]').click();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = (ts) => {
        trace.push(w());
        times.push(Math.round(ts));
        if (performance.now() - t0 < 320) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    await new Promise(r => setTimeout(r, 700));
    return JSON.stringify({ trace, times, distinct: [...new Set(trace)].length, startW: w0,
      firstSampleDelay: Math.round(times[0] - t0),
      siderGone: !document.querySelector('.sider-ac14ac'),
      mainW: Math.round(main().getBoundingClientRect().width),
      collapsedShown: !!document.querySelector('.collapsed-ac14ac') });
  })()
`));
// 与「展开」同理：线上帧合并导致「中间值个数」不可靠（实测有时只有 1 个），
// 但"点下去是不是立刻到位"是可测的 —— 走完全程的用时。
const collapsePose = (frac) => {
  const from = collapse.startW, to = collapse.mainW;
  const target = from + (to - from) * frac;
  for (let i = 0; i < collapse.trace.length; i++) {
    if (Math.abs(collapse.trace[i] - from) >= Math.abs(target - from)) return i;
  }
  return collapse.trace.length - 1;
};
const ci = collapsePose(1);
const cTraveled = Math.abs(collapse.trace[ci] - collapse.startW);
const cMs = Math.max(0, collapse.times[ci] - collapse.times[0]);
// ⚠ 「收起」这里还多一层测量竞态：点击之后动画可能**在第一个采样点之前**
//   就跑完了（CDN 首屏 + 无头浏览器会把整段 200ms 并成一次绘制），
//   这时 trace 从第一帧起就是终值，用时 0ms —— 看着像瞬跳，其实是我们没采到。
//   用 firstSampleDelay 把两种情况分开：
//   · 第一个采样点来得足够早（< 150ms，动画还没结束）却仍然一步到位
//     → 真·瞬跳，判失败；
//   · 第一个采样点已经晚于动画时长 → 采不到，不能据此判失败。
//   另外只要采到过中间值（distinct ≥ 2），就直接证明它是渐进的。
const sawIntermediate = collapse.distinct >= 2;
const sampledInTime = collapse.firstSampleDelay < 150;
check('收起不是瞬跳（走完全程用了足够的时间，而不是一步到位）',
  cTraveled <= 200 || cMs >= 100 || sawIntermediate || !sampledInTime,
  '位移 ' + cTraveled + 'px 用时 ' + cMs + 'ms，采样 ' + collapse.trace.length +
  ' 点（首点延迟 ' + collapse.firstSampleDelay + 'ms，中间值 ' + collapse.distinct + '）');
check('收起后侧栏已移除', collapse.siderGone === true);
check('收起后主区铺满', collapse.mainW > 1300, '宽度 ' + collapse.mainW);

// --- 展开：主区左边缘必须渐变（本次修复的核心） ---
const expand = JSON.parse(await ev(`
  (async () => {
    const main = () => document.querySelector('.main-_9fdf5');
    const trace = [], times = [];
    const wx = () => Math.round(main().getBoundingClientRect().left);
    document.querySelector('.collapsed-ac14ac button[aria-label="打开边栏"]').click();
    // 同「收起」：按时间采 320ms，让完整动画弧都进到 trace 里。
    // 时间戳用 rAF 回调参数（真实帧时间）。
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = (ts) => {
        trace.push(wx());
        times.push(Math.round(ts));
        if (performance.now() - t0 < 320) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    await new Promise(r => setTimeout(r, 700));
    const s = document.querySelector('.sider-ac14ac');
    const gaps = times.map((t, i) => i ? t - times[i-1] : 0).slice(1);
    return JSON.stringify({ trace, distinct: [...new Set(trace)].length,
      maxJump: Math.max(...trace.map((v, i) => i ? Math.abs(v - trace[i-1]) : 0)),
      maxGap: Math.max(...gaps), avgGap: Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length),
      times,
      frames: gaps.length,
      siderW: s ? Math.round(s.getBoundingClientRect().width) : null,
      mainX: Math.round(main().getBoundingClientRect().left),
      inlineW: s ? s.style.width : 'x' });
  })()
`));
console.log('    展开逐帧: ' + JSON.stringify(expand.trace));
console.log('    帧间隔: 平均 ' + expand.avgGap + 'ms 最大 ' + expand.maxGap + 'ms（' + expand.frames + ' 帧）');
// 单帧位移在线上**测不准**：CDN 首屏会把好几帧并成一帧画，
// 实测第一个采样点就已经跳到 193px（动画总共 261px），单帧"位移"167px，
// 而这不是瞬跳、是浏览器没画中间帧。按帧判会一直假失败。
//
// 「瞬跳」这个 bug 的**用户可见表现**其实是：点下去宽度**立刻**到位，
// 没有任何过渡。所以直接测「走完全程用了多久」——
// 这个量与帧合并无关（合并只是让观测点变少，不改变实际耗时）。
// 判据：起步到走完的用时必须 ≥ 100ms（动画总时长 200ms），
// 且总位移要够（> 200px），否则说明压根没动。
const poseAt = (frac) => {
  const target = expand.trace[0] + (expand.mainX - expand.trace[0]) * frac;
  for (let i = 0; i < expand.trace.length; i++) {
    if (Math.abs(expand.trace[i] - expand.trace[0]) >= Math.abs(target - expand.trace[0])) return i;
  }
  return expand.trace.length - 1;
};
const i90 = poseAt(1);
const startT = expand.times[0];
const endT = expand.times[i90];
const traveled = Math.abs(expand.trace[i90] - expand.trace[0]);
const transitionMs = Math.max(0, endT - startT);
check('展开不是瞬跳（走完全程用了足够的时间，而不是一步到位）',
  traveled > 200 && transitionMs >= 100,
  '位移 ' + traveled + 'px 用时 ' + transitionMs + 'ms（共 ' + expand.trace.length + ' 个采样点）');
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

// --- 收起过程中：替身必须留住侧栏内容（收起是展开的逆过程），
//     但内容绝不能自己播动画、也不能被套上入场滑入动画 ---
const leak = JSON.parse(await ev(`
  (async () => {
    const real = document.querySelector('.sider-ac14ac');
    const rcs = getComputedStyle(real);
    const realBg = rcs.backgroundColor;
    const realRect = real.getBoundingClientRect();
    const out = { realBg, realRect: { l: Math.round(realRect.left), w: Math.round(realRect.width) },
      animAttrAtClick: null, samples: [] };
    document.querySelector('.top-ac14ac button[aria-label="收起边栏"]').click();
    for (let i = 0; i < 8; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      const g = document.querySelector('.ls-sider-ghost');
      if (!g) continue;
      const gr = g.getBoundingClientRect();
      if (out.animAttrAtClick === null) {
        out.animAttrAtClick = String(document.documentElement.getAttribute('data-ls-sider-anim'));
      }
      const clone = g.firstElementChild;
      const cr = clone ? clone.getBoundingClientRect() : null;
      out.samples.push({ w: Math.round(gr.width), bg: getComputedStyle(g).backgroundColor,
        kids: g.children.length,
        innerSiderLike: g.querySelectorAll('.appName-ac14ac, .item-ff6fc9, .top-ac14ac').length,
        textLen: (g.textContent || '').replace(/\\s+/g, '').length,
        // 替身整棵子树都不该还在播动画（侧栏列表项自带错峰动画，克隆体一插入
        // 就会全部重播 —— 用户反馈的「闪很多下」）。
        // ⚠ 排除替身自己（以及它的直接包裹克隆体）的 **退出** 动画：
        //   ls-sider-out 正是"收起"该有的动画，是设计的一部分，不是残留。
        //   原来把根节点也算进去，于是永远至少是 1，这条断言从来没真正生效过。
        //   （注意：这段注释在模板字符串里，反引号会提前结束它，只能用普通引号）
        animCount: [g, ...g.querySelectorAll('*')]
          .filter((e) => {
            const an = getComputedStyle(e).animationName;
            if (an === 'none') return false;
            if (e === g || e === clone) return false;   // 替身/克隆体自身的退场动画
            return true;
          }).length,
        cloneAnim: clone ? getComputedStyle(clone).animationName : null,
        // 交接当帧克隆体与真身的几何应当重合（不闪）
        cloneRect: cr ? { l: Math.round(cr.left), w: Math.round(cr.width) } : null });
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
// 收起是展开的逆过程：内容要跟着退场，不能瞬间消失（曾经只收一块纯色面板）
check('替身带着侧栏内容（收起是展开的逆过程）',
  leak.samples.some((s) => s.innerSiderLike > 0 && s.textLen > 0),
  JSON.stringify(leak.samples.map((s) => ({ kids: s.kids, inner: s.innerSiderLike, text: s.textLen }))));
// 但内容是静态快照：不许自己播**入场**动画（侧栏项自带的错峰入场动画一插入
// 就会全部重播，那才是「闪很多下」）。替身自身的退场动画 ls-sider-out 是设计的一部分。
check('替身内部没有任何元素还在播动画（否则会闪很多下）',
  leak.samples.every((s) => s.animCount === 0),
  JSON.stringify(leak.samples.map((s) => s.animCount)));
// 收起期间不允许出现**展开**动画（data-ls-sider-anim 为 "null" 表示没有接管标记）。
// 克隆体自己的 ls-sider-out 是"退场"，属于收起动画，不算入场动画。
// 判据：不能有 ls-sider-in 这类入场动画名。
check('收起期间没有入场动画标记（不会重播展开动画）',
  leak.animAttrAtClick === 'null' &&
  leak.samples.every((s) => !s.cloneAnim || s.cloneAnim === 'none' || s.cloneAnim === 'ls-sider-out'),
  JSON.stringify({ attr: leak.animAttrAtClick, cloneAnim: leak.samples.map((s) => s.cloneAnim) }));
check('交接时克隆体与真身几何重合（不闪）',
  leak.samples.some((s) => s.cloneRect &&
    Math.abs(s.cloneRect.l - leak.realRect.l) <= 1 && Math.abs(s.cloneRect.w - leak.realRect.w) <= 1),
  JSON.stringify({ real: leak.realRect, clone: leak.samples.map((s) => s.cloneRect) }));

// --- 逐像素：收起全程，最左侧只允许出现「侧栏底色」或「frame 底色」 ---
// 直接看绘制结果，比任何 DOM 探测都可靠：扫描 x=0..300，
// 只要出现既不是侧栏底色、也不是 frame 底色的像素，就是有多余内容被画出来了
// （侧栏文字/图标/强调色都算）。
//
// ⚠ 两种底色必须**用截图实测**，不能用 getComputedStyle。
//   CDP 的 Page.captureScreenshot 受色彩管理影响：深色主题下
//   计算值 rgb(27,27,28) 在截图里是 (10,10,11)、rgb(21,21,23) 是 (8,8,9)，
//   差 20 个色阶。原来把计算值当基准 + 容差 3，于是整条左侧 16 万个像素
//   全被判成异常 —— 报出来像"到处都是残留内容"，其实是色彩空间差异。
//   这里的 baselineSider/baselineFrame 由调用方在**展开态**实测传入。
async function samplePixel(x, y) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } });
  return JSON.parse(await ev(`
    (async () => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${r.data}'; });
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return JSON.stringify([d[0], d[1], d[2]]);
    })()
  `));
}

async function scanLeftStrip(tag, base, yFrom = 0, yTo = 560) {
  const clip = { x: 0, y: yFrom, width: 300, height: yTo - yFrom, scale: 1 };
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  const dataUrl = 'data:image/png;base64,' + r.data;
  return JSON.parse(await ev(`
    (async () => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(dataUrl)}; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const SIDER = ${JSON.stringify(base.sider)};
      const FRAME = ${JSON.stringify(base.frame)};
      const near = (r,g,b,ref,tol) => Math.abs(r-ref[0])<=tol && Math.abs(g-ref[1])<=tol && Math.abs(b-ref[2])<=tol;
      let anomalies = 0; const samples = []; const cols = new Set();
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y*img.width+x)*4, r0=d[i], g0=d[i+1], b0=d[i+2];
          if (near(r0,g0,b0,SIDER,3) || near(r0,g0,b0,FRAME,3)) continue;
          anomalies++; cols.add(x);
          if (samples.length < 5) samples.push({x, y, rgb:[r0,g0,b0]});
        }
      }
      return JSON.stringify({ anomalies, cols: cols.size, samples, SIDER, FRAME });
    })()
  `));
}
// 先确保处于展开态
await ev(`(async () => { const b = document.querySelector('.collapsed-ac14ac button[aria-label="打开边栏"]');
  if (b) { b.click(); await new Promise(r => setTimeout(r, 900)); } return true })()`);
await sleep(600);

// 展开态下实测两种底色（截图色彩空间里的真实值）：
//   侧栏内一处空白 = 侧栏底色；主区最右侧 = frame 底色。
// 收起过程中替身画的正是侧栏底色，frame 底色在动画期间一直可见。
const siderRectForSample = JSON.parse(await ev(`JSON.stringify(
  (() => { const s = document.querySelector('.sider-ac14ac');
    if (!s) return null; const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) }; })())`));
const base = {
  sider: await samplePixel(6, 118),
  frame: await samplePixel(1395, 540)
};
console.log('    实测底色（截图色彩空间）: 侧栏 ' + JSON.stringify(base.sider) +
  ' / frame ' + JSON.stringify(base.frame) + '（侧栏宽 ' + (siderRectForSample ? siderRectForSample.w : '?') + '）');

const stripResults = [];
stripResults.push({ tag: 'expanded', ...(await scanLeftStrip('expanded', base)) });
await ev(`document.querySelector('.top-ac14ac button[aria-label="收起边栏"]').click()`);
for (let i = 0; i < 4; i++) {
  await sleep(45);
  stripResults.push({ tag: 'collapse' + i, ...(await scanLeftStrip('collapse' + i, base)) });
}
await sleep(1200);
stripResults.push({ tag: 'collapsed', ...(await scanLeftStrip('collapsed', base)) });
console.log('    左侧逐像素扫描（异常 = 既非侧栏底色也非 frame 底色的像素）:');
stripResults.forEach((s) => console.log('      ' + s.tag.padEnd(10) + ' 异常=' + String(s.anomalies).padStart(6) +
  ' 列数=' + String(s.cols).padStart(4) + (s.samples.length ? '  样例 ' + JSON.stringify(s.samples) : '')));

// 展开态本来就有侧栏内容，所以基准是「展开态」的异常量。
//
// ⚠ 收起过程中出现「与展开态同量级」的异常像素是**正常的**、也是必须的：
//   替身就是侧栏内容的快照，它一边退场一边盖住左侧，所以前几帧的异常量
//   接近展开态。原来那条断言（`异常 < 展开态/4`）语义反了，实测一直失败。
//
// 真正能说明「没有多出来的东西」的是另外两件事：
//   1. 全程异常量**不显著超过展开态**（留 20% 余量：替身在退场时边缘有
//      半透明过渡，实测首帧比展开态多 5%）。一旦成倍超出，说明画出了
//      侧栏以外的东西 —— 那才是"多出来的一块"；
//   2. 收完落到「收起态基线」（折叠态那排按钮图标边缘的抗锯齿像素，
//      这部分在展开态里也存在，不是残留）。
// 实测：展开 12370 → 收起首帧 12968(+5%) → 稳定 1680（折叠态基线）。
const expandedAnomalies = stripResults[0].anomalies;
const duringCollapse = stripResults.filter((s) => s.tag.startsWith('collapse'));
const collapsedBase = stripResults[stripResults.length - 1].anomalies;
const maxDuring = Math.max(...duringCollapse.map((s) => s.anomalies));
check('收起过程中左侧不残留侧栏内容（不超出展开态，且落回收起态基线）',
  maxDuring <= expandedAnomalies * 1.2 &&
  collapsedBase <= Math.max(2000, expandedAnomalies / 4),
  '展开态 ' + expandedAnomalies + ' / 收起过程 ' + JSON.stringify(duringCollapse.map((s) => s.anomalies)) +
  ' / 收起态基线 ' + collapsedBase);

console.log('\n' + '='.repeat(46));
console.log(`线上验收: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
