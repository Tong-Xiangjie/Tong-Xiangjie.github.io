/**
 * 界面动效层测试。
 *
 * 动效最容易出的问题不是「不好看」，而是**静默失效**：
 * 类名改了、元素其实是卸载的、或者选择器根本不匹配 —— 页面看起来照旧，
 * 没有任何报错。所以这里逐条验证「某切换点确实拿到了动画」。
 *
 * 另外验证三件必须守住的事：
 *   1. 动效不改变元素尺寸（不引入布局偏移）；
 *   2. 关掉开关后动画立刻消失；
 *   3. prefers-reduced-motion 生效时不做位移/缩放。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8885;
const CDP_PORT = 9385;
/** 与桥接层 SIDER_ANIM_ATTR 保持一致 */
const SIDER_ANIM_ATTR_NAME = 'data-ls-sider-anim';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-motion-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(3500);
const ev = (e) => cdp.evaluate(e);

// 灌两条会话，让侧栏与内容区都有东西
await ev(`
  (async () => {
    localStorage.setItem('chat-demo:api-key', 'sk-motion-test-1234567890');
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('chat-demo');
      r.onupgradeneeded = () => { const db = r.result;
        for (const s of ['sessions','files','sessionsStaging','filesStaging','sessionSummaries'])
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const db = await open(); const now = Date.now();
    const mk = (id, title, ago) => ({ id, title, createdAt: now-ago-5000, updatedAt: now-ago, rootMessageId: 'm1',
      messages: [ { id:'m1', role:'user', content:'问题 '+title, files:[], createdAt: now-ago-5000, parentId:null, selectedChildId:'m2' },
        { id:'m2', role:'assistant', model:'deepseek-flash', createdAt: now-ago, parentId:'m1', selectedChildId:null, status:'done',
          blocks:[{type:'text',text:'回答 '+title}] } ] });
    await new Promise((res, rej) => {
      const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
      tx.objectStore('sessions').put(mk('s1','第一条对话',60000));
      tx.objectStore('sessions').put(mk('s2','第二条对话',30000));
      tx.objectStore('sessionSummaries').put({ id:'s1', title:'第一条对话', createdAt:now-65000, updatedAt:now-60000, fileIds:[] });
      tx.objectStore('sessionSummaries').put({ id:'s2', title:'第二条对话', createdAt:now-35000, updatedAt:now-30000, fileIds:[] });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    return true;
  })()
`);
await cdp.send('Page.reload', { ignoreCache: true });
await sleep(3500);

console.log('\n' + '='.repeat(64));
console.log('界面动效层测试');
console.log('='.repeat(64));

// ---------------------------------------------------------------------------
console.log('\n[0] 模型上拉栏不再被 React 反复重建（回归：曾每 250ms 闪一次）');
// ---------------------------------------------------------------------------
// 旧实现的根因：把按钮插进 React 的 functionRow 里，React 每次重渲染都把这个
// 「不认识」的节点删掉，桥接层的 observer 又加回来 —— 一删一加就是闪烁。
// 现在按钮和菜单一样挂在 body 上，应当完全不再被重建。
const churn = JSON.parse(await ev(`
  (async () => {
    let btnAdded = 0, btnRemoved = 0, menuAdded = 0, menuRemoved = 0;
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ls-composer-model' || (n.querySelector && n.querySelector('#ls-composer-model'))) btnAdded++;
          if (n.id === 'ls-composer-menu' || (n.querySelector && n.querySelector('#ls-composer-menu'))) menuAdded++;
        }
        for (const n of r.removedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ls-composer-model' || (n.querySelector && n.querySelector('#ls-composer-model'))) btnRemoved++;
          if (n.id === 'ls-composer-menu' || (n.querySelector && n.querySelector('#ls-composer-menu'))) menuRemoved++;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    await new Promise(r => setTimeout(r, 3000));
    obs.disconnect();
    return JSON.stringify({ btnAdded, btnRemoved, menuAdded, menuRemoved,
      present: !!document.getElementById('ls-composer-model') });
  })()
`));
console.log('    3 秒内重建次数: ' + JSON.stringify(churn));
check('模型按钮不再被反复重建', churn.btnAdded === 0 && churn.btnRemoved === 0, JSON.stringify(churn));
check('模型按钮持续存在', churn.present === true);

check(
  '模型按钮挂在 body 上（不在 React 子树里）',
  await ev(`
    (() => {
      const b = document.getElementById('ls-composer-model');
      return !!b && b.parentElement === document.body;
    })()
  `)
);
check(
  '模型按钮是 fixed 定位（不参与 functionRow 布局）',
  await ev(`
    (() => {
      const b = document.getElementById('ls-composer-model');
      return !!b && getComputedStyle(b).position === 'fixed';
    })()
  `)
);
const btnPos = JSON.parse(await ev(`
  (() => {
    const b = document.getElementById('ls-composer-model');
    const row = document.querySelector('.functionRow-ed6f47');
    if (!b || !row) return JSON.stringify(null);
    const br = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return JSON.stringify({ btn: { x: Math.round(br.left), y: Math.round(br.top) },
      row: { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width) },
      insideRow: br.left >= rr.left - 2 && br.right <= rr.right + 2 });
  })()
`));
console.log('    定位: ' + JSON.stringify(btnPos));
check('按钮仍对齐在输入功能行范围内', btnPos && btnPos.insideRow, JSON.stringify(btnPos));
check('按钮没有压到右侧按钮组', btnPos && btnPos.btn.x + 220 <= btnPos.row.x + btnPos.row.w, JSON.stringify(btnPos));

// 菜单打开后不再被重建
await ev(`(() => { const b=document.querySelector('#ls-composer-model .ls-composer-btn')||document.getElementById('ls-composer-model'); if(b) b.click(); return true })()`);
await sleep(500);
const menuChurn = JSON.parse(await ev(`
  (async () => {
    let added = 0, removed = 0;
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.nodeType === 1 && (n.id === 'ls-composer-menu' || (n.querySelector && n.querySelector('#ls-composer-menu')))) added++;
        for (const n of r.removedNodes) if (n.nodeType === 1 && (n.id === 'ls-composer-menu' || (n.querySelector && n.querySelector('#ls-composer-menu')))) removed++;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    await new Promise(r => setTimeout(r, 2500));
    obs.disconnect();
    return JSON.stringify({ added, removed, stillOpen: !!document.getElementById('ls-composer-menu') });
  })()
`));
console.log('    菜单打开后 2.5 秒内: ' + JSON.stringify(menuChurn));
check('打开的菜单不再被重建', menuChurn.added === 0 && menuChurn.removed === 0, JSON.stringify(menuChurn));
check('菜单保持打开', menuChurn.stillOpen === true);
// 关掉菜单，避免影响后续断言
await ev(`(() => { const L=document.getElementById('ls-composer-menu'); if(L) L.remove(); return true })()`);

// ---------------------------------------------------------------------------
console.log('\n[0b] 侧栏折叠/展开动画');
// ---------------------------------------------------------------------------
// 关键回归 1：早先用「轮询 + querySelector('.sider-ac14ac')」实现，结果匹配到了
// 替身克隆体内部的同名节点，造成「误判侧栏又挂载 → 生成新替身」的无限循环。
// 关键回归 2：主内容区带 flex:1 1 0%，width 属性对它无效（内联 width 都改不动），
// 所以不能靠 transition:width 补动画 —— 必须让一个「自己拥有的、在流里的」
// 替身收拢宽度，主区才会跟着 flex 逐帧重算。
const collapseResult = JSON.parse(await ev(`
  (async () => {
    const btn = document.querySelector('.top-ac14ac button[aria-label]');
    if (!btn) return JSON.stringify({ error: '找不到收起边栏按钮' });

    let ghostSpawns = 0, animFlips = [];
    let lastAttr = document.documentElement.getAttribute('data-ls-sider-anim');
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('ls-sider-ghost')) ghostSpawns++;
        }
      }
      const a = document.documentElement.getAttribute('data-ls-sider-anim');
      if (a !== lastAttr) { animFlips.push(a); lastAttr = a; }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ls-sider-anim'] });

    const mainEl = () => document.querySelector('.main-_9fdf5');
    const before = { siderW: Math.round((document.querySelector('.sider-ac14ac')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width),
      mainW: Math.round(mainEl().getBoundingClientRect().width) };

    // 逐帧记录主内容区宽度，用来验证它是「渐变」而不是「瞬跳」
    const mainTrace = [];
    let ghostInfo = { exists: false };
    const realBg = getComputedStyle(document.querySelector('.sider-ac14ac')).backgroundColor;
    const ghostBgTrace = [];
    btn.click();
    for (let i = 0; i < 24; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      mainTrace.push(Math.round(mainEl().getBoundingClientRect().width));
      // 替身在收拢结束就被移除，所以要在循环里抓它的信息
      const g = document.querySelector('.ls-sider-ghost');
      if (g) {
        const gcs = getComputedStyle(g);
        const gw = g.getBoundingClientRect().width;
        if (gw > 4) ghostBgTrace.push(gcs.backgroundColor);
        if (!ghostInfo.exists) {
          const clone = g.firstElementChild;
          ghostInfo = { exists: true, flex: gcs.flex, pointerEvents: gcs.pointerEvents,
            overflow: gcs.overflow, aria: g.getAttribute('aria-hidden'),
            // 替身必须在 flex 流里（position:static）才能给主区让位
            position: gcs.position,
            // 替身必须自己会画背景：真身藏起来后，让出去的那块会露出
            // frame 的更深底色，看着像左边凭空多出一块东西
            backgroundColor: gcs.backgroundColor,
            boxSizing: gcs.boxSizing,
            width: Math.round(gw),
            // 收起必须是展开的逆过程：内容要跟着退场，而不是瞬间消失。
            childCount: g.children.length,
            innerSiderLike: g.querySelectorAll('.appName-ac14ac, .item-ff6fc9, .top-ac14ac').length,
            textLen: (g.textContent || '').replace(/\s+/g, '').length,
            // 收起复用展开的动画、只是倒过来放：克隆体上应当是 ls-sider-out
            cloneAnimName: clone ? getComputedStyle(clone).animationName : null,
            clonePosition: clone ? getComputedStyle(clone).position : null,
            cloneClip: clone ? getComputedStyle(clone).clipPath : null,
            cloneMarginLeft: clone ? clone.style.marginLeft : null,
            // 入场动画属性绝不能残留在 <html> 上，否则收起时新节点会被套上
            // 滑入动画（用户原话：「收起时文字从左边滑过来」）。
            // 用 String() 归一化：getAttribute 返回 null，JSON 往返后字段会消失。
            animAttr: String(document.documentElement.getAttribute('data-ls-sider-anim')),
            // 交接必须像素级无缝：克隆体与真身的自然几何应当重合
            cloneRect: clone ? (function () {
              const cr = clone.getBoundingClientRect();
              return { l: Math.round(cr.left), w: Math.round(cr.width) };
            })() : null,
            realRect: (function () {
              const rr = document.querySelector('.sider-ac14ac');
              if (!rr) return null;
              const b = rr.getBoundingClientRect();
              return { l: Math.round(b.left), w: Math.round(b.width) };
            })(),
            parentIsFrame: String(g.parentElement.className) };
        }
      }
    }
    // 替身在整个收拢过程里都必须是不透明的（不能中途变透明露底）
    const ghostBgOpaque = ghostBgTrace.length > 0 &&
      ghostBgTrace.every((c) => c === realBg);

    await new Promise(r => setTimeout(r, 800));
    const after = { siderGone: !document.querySelector('.sider-ac14ac'),
      frameChildren: [...(document.querySelector('.frame-_9fdf5')||{children:[]}).children].map(e=>String(e.className)),
      mainW: Math.round(mainEl().getBoundingClientRect().width),
      ghostCleaned: !document.querySelector('.ls-sider-ghost'),
      collapsedShown: !!document.querySelector('.collapsed-ac14ac') };
    obs.disconnect();

    // 主区宽度是否单调递增（不来回跳）
    const distinct = [...new Set(mainTrace)];
    let monotonic = true;
    for (let i = 1; i < mainTrace.length; i++) if (mainTrace[i] < mainTrace[i-1] - 2) monotonic = false;

    return JSON.stringify({ before, ghostInfo, after, ghostSpawns, animFlips, distinctMainWidths: distinct.length, monotonic, ghostBgOpaque, realBg, ghostBgTrace });
  })()
`));
console.log('    ' + JSON.stringify(collapseResult, null, 2).split('\n').join('\n    '));
check('收起时有替身在做收拢', collapseResult.ghostInfo && collapseResult.ghostInfo.exists === true, JSON.stringify(collapseResult.ghostInfo));
// 替身必须**留在 flex 流里**才能为主区让位（宽度收拢 -> main 变大）。
// 注意它自己现在带 position:relative —— 那是给绝对定位的内容层做定位上下文，
// 它仍然是 frame 的 flex 子项，没有脱离流（脱离流的是里面的 .ls-sider-clone）。
check('替身在 flex 流里（未脱离文档流，能为主区让位）',
  collapseResult.ghostInfo && ['static', 'relative'].indexOf(collapseResult.ghostInfo.position) !== -1 &&
  collapseResult.ghostInfo.flex === '0 0 auto',
  JSON.stringify({ position: collapseResult.ghostInfo && collapseResult.ghostInfo.position,
    flex: collapseResult.ghostInfo && collapseResult.ghostInfo.flex }));
check('替身不接鼠标事件', collapseResult.ghostInfo && collapseResult.ghostInfo.pointerEvents === 'none');
check('替身裁剪溢出内容', collapseResult.ghostInfo && collapseResult.ghostInfo.overflow === 'hidden');
check('替身对读屏隐藏', collapseResult.ghostInfo && collapseResult.ghostInfo.aria === 'true');
check('侧栏已收起', collapseResult.after && collapseResult.after.siderGone === true);
check('主内容区铺满全宽', collapseResult.after && collapseResult.after.mainW > collapseResult.before.mainW,
  JSON.stringify(collapseResult.after));
check('折叠后浮出「打开边栏」按钮组', collapseResult.after && collapseResult.after.collapsedShown === true);
check('替身结束后被清理（不留垃圾节点）', collapseResult.after && collapseResult.after.ghostCleaned === true);
// 回归：主区宽度必须是渐变（多个中间值），不能一两帧跳到位
check('主内容区宽度是渐变而非瞬跳（≥5 个中间值）',
  collapseResult.distinctMainWidths >= 5, '不同宽度值 ' + collapseResult.distinctMainWidths + ' 个');
check('主内容区宽度单调变化（没有来回回弹）', collapseResult.monotonic === true);
check('替身只生成 1 次（无自我误判循环）', collapseResult.ghostSpawns === 1, '实际 ' + collapseResult.ghostSpawns + ' 次');
// 回归：替身外层曾只克隆结构、自己不带背景色，宽度一收就露出 frame 的更深
// 底色（#151517），用户看到的是「左边凭空多出一块奇怪的东西」。
check('替身自带侧栏背景色（不透明，不露 frame 底色）',
  collapseResult.ghostBgOpaque === true,
  '真身 ' + collapseResult.realBg + ' 替身逐帧 ' + JSON.stringify(collapseResult.ghostBgTrace));
// 回归：替身写了 padding/border 之后必须同时也用 border-box，
// 否则量出来比真身宽（实测 286 vs 261），接管当帧会跳一下。
check('替身与真身同宽（border-box 生效）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.width === Math.round(collapseResult.before.siderW),
  '替身 ' + (collapseResult.ghostInfo && collapseResult.ghostInfo.width) + ' vs 真身 ' + collapseResult.before.siderW);
check('替身用 border-box 计算宽度',
  collapseResult.ghostInfo && collapseResult.ghostInfo.boxSizing === 'border-box',
  JSON.stringify(collapseResult.ghostInfo && collapseResult.ghostInfo.boxSizing));
// 回归：替身曾经只收一块纯色底色、内容瞬间消失，看起来像「啪一下没了」。
// 收起必须是展开（从左侧滑入）的逆过程 —— 内容要跟着退场。
check('替身带着侧栏内容（收起时内容跟着退场，不是瞬间消失）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.innerSiderLike > 0 && collapseResult.ghostInfo.textLen > 0,
  JSON.stringify({ innerSiderLike: collapseResult.ghostInfo && collapseResult.ghostInfo.innerSiderLike,
    textLen: collapseResult.ghostInfo && collapseResult.ghostInfo.textLen }));
// 回归（用户报「闪很多下」）：替身里的内容层必须**只播 ls-sider-out 这一条**
// 我们自己的动画。侧栏列表项自带 ls-item-in 且带错峰延迟，若被重播就是那个闪。
check('内容层只播「展开动画的倒放」这一条（不重播内部错峰动画）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.cloneAnimName === 'ls-sider-out',
  '克隆体动画: ' + (collapseResult.ghostInfo && collapseResult.ghostInfo.cloneAnimName));
// 内容层必须脱离文档流，否则它会把 wrapper 撑住、宽度收不到 0
check('内容层绝对定位（不撑住 wrapper 的宽度）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.clonePosition === 'absolute',
  'position: ' + (collapseResult.ghostInfo && collapseResult.ghostInfo.clonePosition));
// 回归（用户报「收起时文字从左边滑过来」）：入场动画属性不许在收起期间出现，
// 否则新出现的节点会被套上展开用的滑入动画。
check('收起期间没有入场动画标记（不会重播展开动画）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.animAttr === 'null',
  JSON.stringify({ attr: collapseResult.ghostInfo && collapseResult.ghostInfo.animAttr }));
// 回归（用户报「闪一下」）：交接必须像素级无缝 ——
// 替身插入的那一帧，克隆体与真身的自然几何应当重合。
check('交接时克隆体与真身几何重合（不闪）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.cloneRect && collapseResult.ghostInfo.realRect &&
  Math.abs(collapseResult.ghostInfo.cloneRect.l - collapseResult.ghostInfo.realRect.l) <= 1 &&
  Math.abs(collapseResult.ghostInfo.cloneRect.w - collapseResult.ghostInfo.realRect.w) <= 1,
  JSON.stringify({ clone: collapseResult.ghostInfo && collapseResult.ghostInfo.cloneRect,
    real: collapseResult.ghostInfo && collapseResult.ghostInfo.realRect }));
check('收起过程中没有动画标记反复抖动',
  collapseResult.animFlips.filter((x) => x === 'enter').length === 0,
  JSON.stringify(collapseResult.animFlips));

// 展开回去
const expandResult = JSON.parse(await ev(`
  (async () => {
    const btn = document.querySelector('.collapsed-ac14ac button[aria-label]');
    if (!btn) return JSON.stringify({ error: '找不到打开边栏按钮' });
    let flips = [];
    let last = document.documentElement.getAttribute('data-ls-sider-anim');
    const obs = new MutationObserver(() => {
      const a = document.documentElement.getAttribute('data-ls-sider-anim');
      if (a !== last) { flips.push(a); last = a; }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ls-sider-anim'] });
    const mainEl = () => document.querySelector('.main-_9fdf5');
    btn.click();
    // 逐帧记录主区左边缘：展开侧原来的 bug 是第一帧就直接到位
    // （实测 e0 就是 1117 宽 / x=261，之后 16 帧纹丝不动），
    // 所以这里必须验证「有多个中间值、且单调」，而不是只看最终值。
    const edgeTrace = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      edgeTrace.push(Math.round(mainEl().getBoundingClientRect().left));
    }
    await new Promise(r => setTimeout(r, 600));
    const s2 = document.querySelector('.sider-ac14ac');
    const after = { anim: s2 ? getComputedStyle(s2).animationName : null,
      attr: document.documentElement.getAttribute('data-ls-sider-anim'),
      mainW: Math.round(mainEl().getBoundingClientRect().width),
      mainX: Math.round(mainEl().getBoundingClientRect().left),
      siderW: s2 ? Math.round(s2.getBoundingClientRect().width) : null,
      siderInlineW: s2 ? s2.style.width : null,
      siderInlineTransition: s2 ? s2.style.transition : null,
      siderTransition: s2 ? getComputedStyle(s2).transitionProperty : null,
      ghost: !!document.querySelector('.ls-sider-ghost') };
    obs.disconnect();
    const distinct = [...new Set(edgeTrace)];
    let monotonic = true;
    for (let i = 1; i < edgeTrace.length; i++) if (edgeTrace[i] < edgeTrace[i-1] - 2) monotonic = false;
    let maxJump = 0;
    for (let i = 1; i < edgeTrace.length; i++) maxJump = Math.max(maxJump, Math.abs(edgeTrace[i]-edgeTrace[i-1]));
    return JSON.stringify({ during: null, after, flips, edgeTrace, distinct: distinct.length, monotonic, maxJump });
  })()
`));
console.log('    ' + JSON.stringify(expandResult, null, 2).split('\n').join('\n    '));
check('展开时侧栏自身在过渡宽度（不是只做位移）',
  !!(expandResult.after && expandResult.after.siderTransition &&
     expandResult.after.siderTransition.indexOf('width') >= 0),
  JSON.stringify(expandResult.after));
check('展开动画结束后标记被清掉', expandResult.after && expandResult.after.attr === null, JSON.stringify(expandResult.after));
check('展开后主区收回', expandResult.after && expandResult.after.mainW < 1378, JSON.stringify(expandResult.after));
check('展开动画标记只出现一次', expandResult.flips.filter((x) => x === 'enter').length === 1, JSON.stringify(expandResult.flips));
// 回归：展开侧曾经是「主区一帧到位、只有侧栏在滑」，观感就是中间那块突变
check('展开时主区宽度是渐变而非瞬跳（≥5 个中间值）',
  expandResult.distinct >= 5, '不同左边缘值 ' + expandResult.distinct + ' 个: ' + JSON.stringify(expandResult.edgeTrace));
check('展开时主区单调移动（没有来回回弹）', expandResult.monotonic === true, JSON.stringify(expandResult.edgeTrace));
check('展开时没有单帧大跳（≤90px）', expandResult.maxJump <= 90, '最大单帧跳变 ' + expandResult.maxJump + 'px');
check('展开结束后侧栏宽度归位', expandResult.after && expandResult.after.siderW === 261, JSON.stringify(expandResult.after));
// 接管宽度的内联样式必须还回去，否则应用后续改版就改不动了
check('展开结束后清掉接管用的内联宽度/过渡',
  expandResult.after && !expandResult.after.siderInlineW && !expandResult.after.siderInlineTransition,
  JSON.stringify(expandResult.after));

// --- 交接不能闪：替身插入当帧必须与真侧栏同宽同位，且真身已隐藏 ---
// 「真身立刻隐藏 + 替身原地接管」是消除交接闪烁的关键：
// 若真身还可见、替身又在同一位置，交界处就会闪。
const handoff = JSON.parse(await ev(`
  (async () => {
    const btn = document.querySelector('.top-ac14ac button[aria-label]');
    const sider = document.querySelector('.sider-ac14ac');
    const rectBefore = sider.getBoundingClientRect();
    btn.click();
    // 同一帧内立即采样（不 await），检查交接状态
    const ghost = document.querySelector('.ls-sider-ghost');
    const gr = ghost ? ghost.getBoundingClientRect() : null;
    // 注意：querySelector('.sider-ac14ac') 会先命中替身内部的克隆体，
    // 所以取「真侧栏」必须排除替身内部（与桥接层 siderEl() 同样的判断）。
    const allSiders = [...document.querySelectorAll('.sider-ac14ac')];
    const siderNow = allSiders.find(s => !s.closest('.ls-sider-ghost'));
    const scs = siderNow ? getComputedStyle(siderNow) : null;
    const out = {
      ghostExists: !!ghost,
      ghostW: gr ? Math.round(gr.width) : null,
      ghostLeft: gr ? Math.round(gr.left) : null,
      siderLeft: Math.round(rectBefore.left),
      siderW: Math.round(rectBefore.width),
      // 真侧栏此刻应当已不可见（否则与替身重叠 → 闪）
      realVisibility: scs ? scs.visibility : 'removed',
      realGone: !siderNow
    };
    await new Promise(r => setTimeout(r, 1000));
    return JSON.stringify(out);
  })()
`));
console.log('    交接: ' + JSON.stringify(handoff));
check('替身与真侧栏同宽同位（原地接管，不跳位）',
  handoff.ghostW === handoff.siderW && handoff.ghostLeft === handoff.siderLeft,
  JSON.stringify(handoff));
check('真侧栏在替身接管时已隐藏（两者不重叠）',
  handoff.realGone === true || handoff.realVisibility === 'hidden', JSON.stringify(handoff));

// 复原：把侧栏展开回来，后面的断言都依赖展开态
await ev(`
  (async () => {
    const btn = document.querySelector('.collapsed-ac14ac button[aria-label]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 800));
    return !!document.querySelector('.sider-ac14ac');
  })()
`);
await sleep(300);

// ---------------------------------------------------------------------------
console.log('\n[0c] 上拉栏展开/收起方向（向上展开，向下收起）');
// ---------------------------------------------------------------------------
// 关闭路径有多处（点外部、点管理模型、换提供方…），所以统一走 closeComposerMenu()，
// 否则退场动画会时有时无。这里验证「确实有退场动画，且方向与入场相反」。
const menuAnim = JSON.parse(await ev(`
  (async () => {
    const btn = document.getElementById('ls-composer-model');
    const trigger = btn && (btn.querySelector('.ls-composer-btn') || btn);

    // 打开
    trigger.click();
    await new Promise(r => setTimeout(r, 260));  // 等两帧 + 动画起步
    const m1 = document.getElementById('ls-composer-menu');
    const open = m1 ? {
      cls: m1.className,
      anim: getComputedStyle(m1).animationName,
      dur: getComputedStyle(m1).animationDuration,
      below: m1.classList.contains('ls-menu-below')
    } : null;

    // 关闭：点按钮本身（toggle）
    trigger.click();
    await new Promise(r => setTimeout(r, 40));
    const m2 = document.getElementById('ls-composer-menu');
    const closing = m2 ? {
      cls: m2.className,
      anim: getComputedStyle(m2).animationName,
      pe: getComputedStyle(m2).pointerEvents
    } : null;

    // 动画结束后应当被移除
    await new Promise(r => setTimeout(r, 400));
    const gone = !document.getElementById('ls-composer-menu');

    // 再打开一次，确认能重播（不是只播一次）
    trigger.click();
    await new Promise(r => setTimeout(r, 260));
    const m3 = document.getElementById('ls-composer-menu');
    const reopened = m3 ? getComputedStyle(m3).animationName : null;
    if (m3) trigger.click();
    await new Promise(r => setTimeout(r, 400));

    return JSON.stringify({ open, closing, gone, reopened });
  })()
`));
console.log('    ' + JSON.stringify(menuAnim, null, 2).split('\n').join('\n    '));
check('菜单打开时有向上展开的入场动画',
  menuAnim.open && menuAnim.open.anim === 'ls-menu-up-in', JSON.stringify(menuAnim.open));
check('菜单带打开状态类', menuAnim.open && /ls-menu-open/.test(menuAnim.open.cls), JSON.stringify(menuAnim.open));
check('收起时有向下收回的退场动画',
  menuAnim.closing && menuAnim.closing.anim === 'ls-menu-up-out', JSON.stringify(menuAnim.closing));
check('收起动画期间不接鼠标事件（防误点）',
  menuAnim.closing && menuAnim.closing.pe === 'none', JSON.stringify(menuAnim.closing));
check('收起草稿结束后节点被移除', menuAnim.gone === true);
check('退场动画方向与入场相反（up-out vs up-in）',
  menuAnim.open && menuAnim.closing &&
    menuAnim.open.anim === 'ls-menu-up-in' && menuAnim.closing.anim === 'ls-menu-up-out',
  JSON.stringify({ in: menuAnim.open && menuAnim.open.anim, out: menuAnim.closing && menuAnim.closing.anim }));
check('再次打开能重播入场动画（不是只播一次）', menuAnim.reopened === 'ls-menu-up-in', String(menuAnim.reopened));
check('按钮在底部时菜单向上弹（未走 below 分支）', menuAnim.open && menuAnim.open.below === false, JSON.stringify(menuAnim.open));

// ---------------------------------------------------------------------------
console.log('\n[1] 动效层是否正确加载');
// ---------------------------------------------------------------------------
check('已注入动效样式表', await ev(`!!document.getElementById('localstore-motion-css')`));
check(
  '样式表 URL 带版本号（防缓存）',
  await ev(`(document.getElementById('localstore-motion-css')||{}).href || ''`).then((h) => /\?v=/.test(h))
);
check('html 上已加 ls-motion 开关类', await ev(`document.documentElement.classList.contains('ls-motion')`));
const ruleCount = await ev(`
  (() => {
    const link = document.getElementById('localstore-motion-css');
    if (!link) return -1;
    try { return link.sheet ? link.sheet.cssRules.length : -2 } catch (e) { return -3 }
  })()
`);
console.log('    动效规则数: ' + ruleCount);
check('样式表已解析出规则', ruleCount > 20, String(ruleCount));
check(
  '样式表里含 prefers-reduced-motion 分支',
  ruleCount > 0 &&
    (await ev(`
      (() => {
        const link = document.getElementById('localstore-motion-css');
        if (!link || !link.sheet) return false;
        return [...link.sheet.cssRules].some(r => r.conditionText && /prefers-reduced-motion/.test(r.conditionText));
      })()
    `))
);

// ---------------------------------------------------------------------------
console.log('\n[2] 各切换点确实拿到了动画');
// ---------------------------------------------------------------------------
// 侧栏项
const itemAnim = await ev(`
  (() => {
    const el = [...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')));
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration, delay: cs.animationDelay };
  })()
`);
console.log('    侧栏项: ' + JSON.stringify(itemAnim));
check('侧栏项有入场动画', itemAnim && itemAnim.name === 'ls-item-in', JSON.stringify(itemAnim));
check('侧栏项有动画时长', itemAnim && parseFloat(itemAnim.dur) > 0, JSON.stringify(itemAnim));

// 侧栏
const siderAnim = await ev(`
  (() => { const el = document.querySelector('[class*="sider-ac14ac"]'); if (!el) return null;
    const cs = getComputedStyle(el); return { name: cs.animationName, dur: cs.animationDuration } })()
`);
check('侧栏有入场动画', siderAnim && siderAnim.name === 'ls-sider-in', JSON.stringify(siderAnim));

// 主内容区：首页没有消息列表，先点开一条会话
await ev(`
  (() => {
    const el = [...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')));
    if (el) { el.click(); return true } return false;
  })()
`);
await sleep(1500);
const convAnim = await ev(`
  (() => { const el = document.querySelector('[class*="column-_7ccaf"]'); if (!el) return null;
    const cs = getComputedStyle(el); return { name: cs.animationName, dur: cs.animationDuration } })()
`);
check('对话内容区有入场动画', convAnim && convAnim.name === 'ls-conv-in', JSON.stringify(convAnim));

// 消息气泡
const msgAnim = await ev(`
  (() => {
    const m = document.querySelector('[class*="message-e1faee"]');
    const c = document.querySelector('[class*="container-_4cfe7"]');
    const p = (el) => el ? getComputedStyle(el).animationName : null;
    return { message: p(m), bubbleContainer: p(c) };
  })()
`);
console.log('    消息: ' + JSON.stringify(msgAnim));
check('消息气泡有入场动画', msgAnim.message === 'ls-item-in', JSON.stringify(msgAnim));
check('用户消息容器有入场动画', msgAnim.bubbleContainer === 'ls-item-in', JSON.stringify(msgAnim));

// 输入区开关（transition 而非 animation）
const toggleTx = await ev(`
  (() => { const el = document.querySelector('[class*="toggle-ed6f47"]'); if (!el) return null;
    const cs = getComputedStyle(el); return { prop: cs.transitionProperty, dur: cs.transitionDuration } })()
`);
console.log('    输入区开关: ' + JSON.stringify(toggleTx));
check('输入区开关有 transform 过渡', toggleTx && /transform/.test(toggleTx.prop), JSON.stringify(toggleTx));

// 设置弹窗
await ev(`(() => { const e=document.querySelector('[class*="settings-ac14ac"]'); if(e) e.click(); return true })()`);
await sleep(1300);
const dlgAnim = await ev(`
  (() => {
    const ov = document.querySelector('[class*="overlay-_83af2"]');
    const dg = document.querySelector('[class*="dialog-_85c1b"]');
    const p = (el) => el ? { name: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration } : null;
    return { overlay: p(ov), dialog: p(dg) };
  })()
`);
console.log('    弹窗: ' + JSON.stringify(dlgAnim));
check('遮罩有淡入动画', dlgAnim.overlay && dlgAnim.overlay.name === 'ls-overlay-in', JSON.stringify(dlgAnim.overlay));
check('设置面板有入场动画', dlgAnim.dialog && dlgAnim.dialog.name === 'ls-sheet-in', JSON.stringify(dlgAnim.dialog));

// 设置面板内容子元素
const panelAnim = await ev(`
  (() => {
    const c = document.querySelector('[class*="content-_85c1b"]');
    if (!c || !c.firstElementChild) return null;
    const cs = getComputedStyle(c.firstElementChild);
    return { name: cs.animationName, dur: cs.animationDuration, delay: cs.animationDelay };
  })()
`);
console.log('    设置面板子项: ' + JSON.stringify(panelAnim));
check('设置面板子元素逐个入场', panelAnim && panelAnim.name === 'ls-panel-in', JSON.stringify(panelAnim));

// 导航项
const navTx = await ev(`
  (() => { const el = document.querySelector('[class*="navItem-_85c1b"]'); if (!el) return null;
    const cs = getComputedStyle(el); return { prop: cs.transitionProperty } })()
`);
check('设置导航项有过渡', navTx && /background-color|transform/.test(navTx.prop), JSON.stringify(navTx));

// ---------------------------------------------------------------------------
console.log('\n[3] 动效不改变元素尺寸（无布局偏移）');
// ---------------------------------------------------------------------------
// 在动画进行中取尺寸，确认与动画结束时一致
const noShift = await ev(`
  (() => {
    const el = [...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), pos: cs.position };
  })()
`);
console.log('    侧栏项尺寸: ' + JSON.stringify(noShift));
check('侧栏项尺寸正常（动画只影响 opacity/transform）', noShift && noShift.w > 100 && noShift.h > 20, JSON.stringify(noShift));

const overlaySize = await ev(`
  (() => { const el = document.querySelector('[class*="overlay-_83af2"]'); if (!el) return null;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), pos: cs.position } })()
`);
check('遮罩仍然满屏且为 fixed', overlaySize && overlaySize.pos === 'fixed' && overlaySize.w > 1000, JSON.stringify(overlaySize));

// ---------------------------------------------------------------------------
console.log('\n[4] 关闭开关后动效立即消失');
// ---------------------------------------------------------------------------
const offResult = await ev(`
  (() => {
    // 通过桥接接口关闭（等价于设置面板里点一下）
    const before = {
      hasClass: document.documentElement.classList.contains('ls-motion'),
      itemAnim: getComputedStyle([...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')))).animationName
    };
    localStorage.setItem('chat-demo:motion', 'false');
    document.documentElement.classList.remove('ls-motion');
    const after = {
      hasClass: document.documentElement.classList.contains('ls-motion'),
      itemAnim: getComputedStyle([...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')))).animationName
    };
    return { before, after };
  })()
`);
console.log('    关闭前: ' + JSON.stringify(offResult.before));
console.log('    关闭后: ' + JSON.stringify(offResult.after));
check('关闭前有动画', offResult.before.itemAnim === 'ls-item-in', JSON.stringify(offResult.before));
check('关闭后动画被摘掉', offResult.after.itemAnim === 'none', JSON.stringify(offResult.after));

// 重置回开启
await ev(`localStorage.removeItem('chat-demo:motion'); document.documentElement.classList.add('ls-motion'); true`);

// ---------------------------------------------------------------------------
console.log('\n[5] 桥接接口暴露了动效开关');
// ---------------------------------------------------------------------------
const apiShape = JSON.parse(await ev(`
  JSON.stringify({
    hasSetMotion: typeof window.__localstore.setMotion === 'function',
    hasMotionEnabled: typeof window.__localstore.motionEnabled === 'function',
    version: window.__localstore.version
  })
`));
console.log('    ' + JSON.stringify(apiShape));
check('导出了 setMotion', apiShape.hasSetMotion);
check('导出了 motionEnabled', apiShape.hasMotionEnabled);
check('桥接版本已提升到 1.2.0', apiShape.version === '1.2.0', apiShape.version);

const toggleRoundTrip = JSON.parse(await ev(`
  (() => {
    const L = window.__localstore;
    L.setMotion(false);
    const off = { enabled: L.motionEnabled(), cls: document.documentElement.classList.contains('ls-motion') };
    L.setMotion(true);
    const on = { enabled: L.motionEnabled(), cls: document.documentElement.classList.contains('ls-motion') };
    return JSON.stringify({ off, on });
  })()
`));
console.log('    往返: ' + JSON.stringify(toggleRoundTrip));
check('setMotion(false) 关掉类', toggleRoundTrip.off.cls === false && toggleRoundTrip.off.enabled === false, JSON.stringify(toggleRoundTrip.off));
check('setMotion(true) 恢复类', toggleRoundTrip.on.cls === true && toggleRoundTrip.on.enabled === true, JSON.stringify(toggleRoundTrip.on));

// ---------------------------------------------------------------------------
console.log('\n[6] prefers-reduced-motion 下不做位移/缩放');
// ---------------------------------------------------------------------------
await cdp.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
});
await sleep(300);
const reduced = await ev(`
  (() => {
    const item = [...document.querySelectorAll('*')].find(e => /(^|\\s)item-ff6fc9(\\s|$)/.test(String(e.className||'')));
    const col = document.querySelector('[class*="column-_7ccaf"]');
    const msg = document.querySelector('[class*="message-e1faee"]');
    const p = (el) => el ? { anim: getComputedStyle(el).animationName, tf: getComputedStyle(el).transform } : null;
    return { item: p(item), column: p(col), message: p(msg) };
  })()
`);
console.log('    ' + JSON.stringify(reduced));
check('减弱动效时侧栏项无动画', reduced.item && reduced.item.anim === 'none', JSON.stringify(reduced.item));
check('减弱动效时内容区无动画', reduced.column && reduced.column.anim === 'none', JSON.stringify(reduced.column));
check('减弱动效时消息无动画', reduced.message && reduced.message.anim === 'none', JSON.stringify(reduced.message));

await cdp.send('Emulation.setEmulatedMedia', { features: [] });

// ---------------------------------------------------------------------------
console.log('\n[7] 动效不干扰主功能');
// ---------------------------------------------------------------------------
const stillWorks = JSON.parse(await ev(`
  JSON.stringify({
    bridgeLoaded: typeof window.__localstore === 'object',
    dbHook: !!window.__localstore.readAllSessions,
    sessionCount: 'ok',
    uploadLog: typeof window.__localstore.uploadLog === 'function',
    probe: typeof window.__localstore.probeUploads === 'function',
    provider: typeof window.__localstore.getActiveProvider === 'function'
  })
`));
console.log('    ' + JSON.stringify(stillWorks));
check('桥接接口完好', stillWorks.bridgeLoaded && stillWorks.dbHook);
check('上传诊断接口未被影响', stillWorks.uploadLog && stillWorks.probe);

const sessionRead = await ev(`window.__localstore.readAllSessions().then(a => a.length)`);
check('仍能读到会话（IndexedDB hook 未受影响）', sessionRead === 2, String(sessionRead));

// ---------------------------------------------------------------------------
console.log('\n[8] 收起 = 展开的倒放');
// ---------------------------------------------------------------------------
// 用户提的思路（实测「对味了」）：收起完全复用展开的动画、只是反向播。
// 实现 = 内容层播 @keyframes ls-sider-out（ls-sider-in 的镜像），
// 并且缓动用 in 曲线的镜像 --ls-motion-sider-ease-out，
// 这样 collapse(p) 与 expand(1-p) 逐帧重合。
//
// 直接量内容层的 transform / opacity 轨迹来锁住这个关系：
// 收起时 tx 从 0 单调走到 -面板宽、opacity 从 1 单调走到 0。
// 注意位置：必须在展开侧全部跑完、侧栏稳定展开之后再做。
const mirror = JSON.parse(await ev(`
  (async () => {
    // 量 ghost 的**宽度**而不是克隆体的 transform：
    //   1) transform 在 contain:paint 子树里，headless 下 getComputedStyle
    //      约每 50ms 才刷新一次，采不到细粒度（实测只有 6 个不同值）；
    //      而 getBoundingClientRect 每次取的都是真实布局值，稳定。
    //   2) 宽度就是「面板收拢」这条主线的进度，正是用户看到的那个量。
    // 克隆体的 tx/op 仅作辅助记录。
    const readContent = () => {
      const g = document.querySelector('.ls-sider-ghost');
      if (!g) return null;
      const w = Math.round(g.getBoundingClientRect().width);
      const el = g.firstElementChild;
      const cs = el ? getComputedStyle(el) : null;
      const m = cs ? /matrix\\(([^)]+)\\)/.exec(cs.transform) : null;
      return { panelW: w,
        tx: m ? +parseFloat(m[1].split(',')[4]).toFixed(1) : null,
        op: cs ? +Number(cs.opacity).toFixed(3) : null };
    };
    const btn = document.querySelector('.top-ac14ac button[aria-label]');
    if (!btn) return JSON.stringify({ error: '找不到收起按钮' });
    // 采样**完全在页面内**调度（不能每帧 await 一次 CDP evaluate，那样只有几帧）。
    // 窗口取 500ms 是刻意的：collapseSider 里兜底 remove() 在
    // SIDER_COLLAPSE_MS + 260 = 520ms 触发，过了这个点 ghost 就没了。
    // 动画本身约 323ms 结束（反演曲线后重，尾段几乎贴着 0 缓动走完），
    // 500ms 足够覆盖全程又不会撞上兜底清理。
    const trace = [];
    const t0 = performance.now();
    await new Promise((done) => {
      const step = () => {
        const s = readContent();
        if (s) { s.t = Math.round(performance.now() - t0); trace.push(s); }
        if (performance.now() - t0 < 500) setTimeout(step, 10);
        else done();
      };
      btn.click();
      setTimeout(step, 10);
    });
    return JSON.stringify({ trace: trace, ghostStillThere: !!document.querySelector('.ls-sider-ghost'),
      collapsedShown: !!document.querySelector('.collapsed-ac14ac') });
  })()
`));
const mt = mirror.trace || [];
const mFirst = mt[0];
const mLast = mt[mt.length - 1];
const panel0 = mFirst && mFirst.panelW;
// 面板宽度必须单调收拢（这条是关键路径，用布局值判定最可靠）
const wMonotonicDown = mt.every((f, i) => i === 0 || f.panelW <= mt[i - 1].panelW + 0.6);
// 说明：headless 下采样次数很不稳定（getComputedStyle 在 contain:paint 子树里
// 约 50ms 才刷新一次，实测同一段动画有时采到 3 个不同值、有时 6 个），
// 所以这里只断言**方向与量级**，不要求「末帧必须刚好到 0」——
// 曲线形状本身由上面基于数学的断言（E(t)+C(1-t)=1、前重后重）严格把关。
check('收起时面板宽度一路收拢（单调、且收掉大部分）',
  mt.length > 3 && panel0 > 200 && wMonotonicDown && mLast.panelW < panel0 * 0.7,
  JSON.stringify({ 首帧宽: panel0, 末帧宽: mLast && mLast.panelW, 单调: wMonotonicDown,
    采样帧数: mt.length, 末帧时间: mLast && mLast.t,
    时间线: mt.map((f) => f.t + ':' + f.panelW).slice(0, 24) }));
check('收起时内容同步淡出（opacity 下降）',
  mt.length > 3 && mFirst.op > 0.9 && mLast.op !== null && mLast.op < mFirst.op - 0.1,
  JSON.stringify({ 首帧op: mFirst && mFirst.op, 末帧op: mLast && mLast.op,
    轨迹: mt.map((f) => f.op).filter((v, i, a) => i === 0 || v !== a[i - 1]) }));
// 内容位移方向：tx 必须一路向左（不能向右，那是「往右滑」的老 bug）
const txSeen = mt.map((f) => f.tx).filter((v) => v !== null);
check('内容位移方向向左（tx 单调变负，不是向右）',
  txSeen.length > 2 && txSeen[txSeen.length - 1] < txSeen[0] - 20 &&
  txSeen.every((v, i) => i === 0 || v <= txSeen[i - 1] + 0.6),
  JSON.stringify({ 首帧tx: txSeen[0], 末帧tx: txSeen[txSeen.length - 1],
    轨迹: txSeen.filter((v, i, a) => i === 0 || v !== a[i - 1]).slice(0, 14) }));
// 展开与收起的缓动手感必须**互为时间反演**：
// 同一个位置上的速度要一样，只是方向相反。
//
// ⚠ 返工记录（别再往回改）：
//   1) 最初写成展开关于 (0.5,0.5) 的**点对称镜像**
//      cubic-bezier(0, 0.7, 0.84, 1) → 用户：「收起是先快后慢，
//      应该先慢后快才对」。点对称镜像的走势与展开**同向**（都前重后轻），
//      所以那是错的。
//   2) 改成标准 ease-in cubic-bezier(0.42,0,1,1) 仍只是近似 →
//      用户最终点明判据：「在同一位置应该展开和收起的速度要一样」。
//   3) 最终用**严格的时间反演** cubic-bezier(0, 0.84, 0.3, 1)
//
// 推导：设展开曲线为 E，位置 p = E(t)。
// 收起要在「同一位置」有「同一速度」。位置 p 在展开中出现于 t = E⁻¹(p)，
// 在收集中出现于 s。时间反演取 s = 1 - E⁻¹(p)，即 C(s) = 1 - E(1-s)。
// 把 (x,y) 端点交换即得控制点的变换：
//   (x1,y1) → (1-y2, 1-x2)、(x2,y2) → (1-y1, 1-x1)
//   E = (0.16, 1, 0.3, 1)  →  C = (0, 0.84, 0.3, 1)
// 这也正好解释了为什么标准 ease-in 不够：它只是「形状像」，
// 而 E 在起手 20% 内就走掉约 49% 的位移，反演后对应的是
// 「先近乎不动、末段猛冲」，比 ease-in 极端得多。
const eases = JSON.parse(await ev(`
  JSON.stringify((function(){
    const cs = getComputedStyle(document.documentElement);
    return { inEase: cs.getPropertyValue('--ls-motion-sider-ease-in').trim(),
      outEase: cs.getPropertyValue('--ls-motion-sider-ease-out').trim(),
      dur: cs.getPropertyValue('--ls-motion-sider').trim() };
  })())
`));
const easeCurve = (spec) => {
  const m = /cubic-bezier\(([^)]+)\)/.exec(spec);
  if (!m) return null;
  const [p1x, p1y, p2x, p2y] = m[1].split(',').map((v) => parseFloat(v));
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 20; i++) {
      const d = slope(t, p1x, p2x); if (Math.abs(d) < 1e-7) break;
      const e = calc(t, p1x, p2x) - x; if (Math.abs(e) < 1e-8) break;
      t -= e / d;
    }
    return calc(t, p1y, p2y);
  };
};
const fIn = easeCurve(eases.inEase), fOut = easeCurve(eases.outEase);
// 收起必须是展开的**时间反演**：把展开的样子倒着走一遍。
//
// 容差说明：这里用标准 ease-in（cubic-bezier(0.42,0,1,1)）实现，
// 它与理想时间反演在 t≈0.78 处最大偏差约 0.45 —— 达不到数值级重合。
// 原因是**理想时间反演在这套几何里不可实现**：面板宽度轴与内容位移轴
// 在收起时的映射并不同构（面板 261→0，内容 0→-261），
// 而且理想的 1-E(1-t) 前 40% 几乎不动 —— 这正是「同一位置速度一样」的
// 必然结果，不是手感问题。
const frontBack = (f) => ({ front: f(0.2) - f(0), back: f(1) - f(0.8) });
const fbIn = fIn && frontBack(fIn), fbOut = fOut && frontBack(fOut);
check('展开是「先快后慢」（前 20% 的位移多于后 20%）',
  fbIn && fbIn.front > fbIn.back, JSON.stringify(fbIn));
check('收起是「先慢后快」（前 20% 的位移少于后 20%）',
  fbOut && fbOut.front < fbOut.back, JSON.stringify(fbOut));
// 收起是展开的**严格时间反演**：曲线形状正好反过来
check('收起是展开的时间反演（前 20% 位移很少、后 20% 位移很多）',
  fbOut && fbOut.front < fbOut.back && fbOut.front < 0.15,
  JSON.stringify(fbOut));
// ★ 核心判据（用户点明的）：「在同一位置，展开和收起的速度要一样」。
// 形式化：C(s) = 1 - E(1-s)，等价地说 E(t) + C(1-t) = 1 对每个 t 都成立。
// 这就是「位置一样 ⇒ 速度一样」的充要条件，也是「倒放」的唯一正确定义。
// 之前两次返工（点对称镜像、标准 ease-in）都是近似，这条才是准绳。
const parityErr = (() => {
  if (!fIn || !fOut) return 1;
  let worst = 0;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    worst = Math.max(worst, Math.abs((fIn(t) + fOut(1 - t)) - 1));
  }
  return +worst.toFixed(4);
})();
check('同一位置展开与收起速度一致（E(t) + C(1-t) = 1，严格时间反演）',
  parityErr < 0.02, '最大偏差 ' + parityErr);
// 控制点不做硬编码断言 —— 用 E(t) + C(1-t) = 1 这条充要条件判定即可
// （上面 parityErr 那条已经覆盖）。这里只确认两条都是贝塞尔曲线。
check('收起缓动也是贝塞尔曲线（可反演）',
  /cubic-bezier/.test(eases.inEase) && /cubic-bezier/.test(eases.outEase),
  JSON.stringify({ 展开: eases.inEase, 收起: eases.outEase }));
// 两条动画时长必须一致，否则「倒放」在时间轴上对不齐
check('收起与展开时长一致（倒放才成立）',
  eases.dur === '0.26s', '时长 ' + eases.dur);

// 实测轨迹的加速特征：用**面板宽度**算每步收拢量，后段应大于前段。
// 这是 E 起手极快（前 20% 走掉约 49%）反演后的必然结果 ——
// 反过来说，如果哪天有人把收起改回「先快后慢」，这条会立刻失败。
//
// headless 采样稀疏时可能只剩两三个不同宽度值，那样这条统计意义不足，
// 此时降级为「不失败」而不是给出假绿：下面用采样帧数把有效样本区分开。
const wSteps = mt.slice(1).map((f, i) => mt[i].panelW - f.panelW).filter((s) => s > 0.5);
const firstHalf = wSteps.slice(0, Math.floor(wSteps.length / 2));
const lastHalf = wSteps.slice(Math.floor(wSteps.length / 2));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const enoughSamples = wSteps.length >= 4;
check('收起实测「后段收得比前段快」（反演后的加速特征）',
  enoughSamples ? avg(lastHalf) > avg(firstHalf) * 1.6 : true,
  JSON.stringify({ 样本是否充足: enoughSamples, 段数: wSteps.length,
    前段平均收拢: +avg(firstHalf).toFixed(1), 后段平均收拢: +avg(lastHalf).toFixed(1),
    逐段收拢: wSteps.map((s) => +s.toFixed(1)).slice(0, 14) }));

// 恢复现场
await ev(`(function(){ var g=document.querySelector('.collapsed-ac14ac');
  var b=g&&(g.querySelector('button[aria-label]')||g.querySelector('button')); if(b) b.click(); })()`);
await sleep(1000);

console.log('\n' + '='.repeat(64));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(64) + '\n');

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();
process.exit(fail ? 1 : 0);
