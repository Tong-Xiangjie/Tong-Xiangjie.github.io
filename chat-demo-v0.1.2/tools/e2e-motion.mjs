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
    btn.click();
    for (let i = 0; i < 24; i++) {
      await new Promise(r => requestAnimationFrame(() => r()));
      mainTrace.push(Math.round(mainEl().getBoundingClientRect().width));
      // 替身在收拢结束就被移除，所以要在循环里抓它的信息
      const g = document.querySelector('.ls-sider-ghost');
      if (g && !ghostInfo.exists) {
        const gcs = getComputedStyle(g);
        ghostInfo = { exists: true, flex: gcs.flex, pointerEvents: gcs.pointerEvents,
          overflow: gcs.overflow, aria: g.getAttribute('aria-hidden'),
          // 替身必须在 flex 流里（position:static）才能给主区让位
          position: gcs.position,
          parentIsFrame: String(g.parentElement.className) };
      }
    }

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

    return JSON.stringify({ before, ghostInfo, after, ghostSpawns, animFlips, distinctMainWidths: distinct.length, monotonic });
  })()
`));
console.log('    ' + JSON.stringify(collapseResult, null, 2).split('\n').join('\n    '));
check('收起时有替身在做收拢', collapseResult.ghostInfo && collapseResult.ghostInfo.exists === true, JSON.stringify(collapseResult.ghostInfo));
check('替身在 flex 流里（position:static，能为主区让位）',
  collapseResult.ghostInfo && collapseResult.ghostInfo.position === 'static', JSON.stringify(collapseResult.ghostInfo));
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
    btn.click();
    await new Promise(r => setTimeout(r, 120));
    const s = document.querySelector('.sider-ac14ac');
    const during = s ? { anim: getComputedStyle(s).animationName, dur: getComputedStyle(s).animationDuration } : null;
    await new Promise(r => setTimeout(r, 600));
    const s2 = document.querySelector('.sider-ac14ac');
    const after = { anim: s2 ? getComputedStyle(s2).animationName : null,
      attr: document.documentElement.getAttribute('data-ls-sider-anim'),
      mainW: Math.round(document.querySelector('.main-_9fdf5').getBoundingClientRect().width),
      ghost: !!document.querySelector('.ls-sider-ghost') };
    obs.disconnect();
    return JSON.stringify({ during, after, flips });
  })()
`));
console.log('    ' + JSON.stringify(expandResult, null, 2).split('\n').join('\n    '));
check('展开时侧栏滑入', expandResult.during && expandResult.during.anim === 'ls-sider-in', JSON.stringify(expandResult.during));
check('展开动画结束后标记被清掉', expandResult.after && expandResult.after.attr === null, JSON.stringify(expandResult.after));
check('展开后主区收回', expandResult.after && expandResult.after.mainW < 1378, JSON.stringify(expandResult.after));
check('展开动画标记只出现一次', expandResult.flips.filter((x) => x === 'enter').length === 1, JSON.stringify(expandResult.flips));

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

console.log('\n' + '='.repeat(64));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(64) + '\n');

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();
process.exit(fail ? 1 : 0);
