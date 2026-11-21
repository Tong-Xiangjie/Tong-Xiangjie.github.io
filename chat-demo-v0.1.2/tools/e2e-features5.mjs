#!/usr/bin/env node
/**
 * e2e-features5.mjs —— 5 个新功能的端到端测试。
 *
 * 环境要求和其它 e2e 一样：起一个 headless Chrome 打开构建产物。
 * 关键点：应用在没配 API Key 时会拦住发送，所以这里先塞一个假 Key；
 * 会话数据直接写 IndexedDB（用应用认可的 message 树形状），
 * 不走网络，因此这套测试完全离线可跑。
 *
 * 覆盖：
 *   [1] 模块加载与开关
 *   [2] 消息索引轨道：编号数 == 消息数、点击能定位、active 跟随滚动
 *   [3] 置顶：菜单多一条、点击后置顶项排到最前、徽标出现、取消后复原
 *   [4] 长消息折叠：超过 8 行才折叠、展开/收起切换、动画属性存在
 *   [5] 粘贴转 .txt：过大粘贴直接变成应用自己的 .txt 附件（不自建 UI）
 *   [5b] 启动时侧栏还没渲染完，置顶不能丢（「置顶看不到」的回归）
 *   [6] 搜索：按标题、按正文、面板开合、高亮、点击跳转
 */
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from 'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/tools/minimal-cdp.mjs';

const TARGET = process.argv[2] ||
  'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/index.html';
const PORT = 9463;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('  ✓ ' + name); }
  else {
    fails.push(name);
    console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : ''));
  }
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-f5-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
   '--disable-gpu', '--no-first-run', '--window-size=1400,900', '--hide-scrollbars', TARGET],
  { stdio: 'ignore' });

let cdp;
try {
  const t = await fetchPageTarget(PORT);
  cdp = await CDP.connect(t.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(4000);
  const ev = (e) => cdp.evaluate(e);

  console.log('\n=== 5 个新功能 e2e ===\n');

  // 假 Key：不配 Key 时应用会拦住发送，功能测试也拿不到会话
  await ev(`localStorage.setItem('chat-demo:api-key', 'sk-e2e-features5-fake')`);
  await cdp.send('Page.reload');
  await sleep(6000);

  // 干净环境
  await ev(`
    (async () => {
      try {
        localStorage.removeItem('chat-demo:ls-pinned');
        localStorage.removeItem('chat-demo:ls-pasted-texts');
        localStorage.removeItem('chat-demo:ls-features');
      } catch (e) {}
      await new Promise((res) => {
        const rq = indexedDB.deleteDatabase('chat-demo');
        rq.onsuccess = () => res(); rq.onerror = () => res(); rq.onblocked = () => res();
      });
      return 'cleared';
    })()
  `);
  await cdp.send('Page.reload');
  await sleep(6500);
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.sider-ac14ac')`)) break;
    await sleep(500);
  }
  await sleep(1500);

  /* ---------------------------------------------------------------- */
  console.log('[1] 模块加载与开关');

  const load = JSON.parse(await ev(`JSON.stringify({
    api: !!window.__lsFeatures,
    version: window.__lsFeatures && window.__lsFeatures.version,
    css: !!document.getElementById('localstore-features-css'),
    js: !!document.getElementById('localstore-features-js'),
    searchEntry: !!document.querySelector('.ls-search-btn')
  })`));
  check('扩展模块已加载并暴露 __lsFeatures', load.api, JSON.stringify(load));
  check('样式表已注入', load.css);
  check('侧栏有搜索入口', load.searchEntry);
  check('模块版本非 dev（带指纹）', load.version && load.version !== 'dev', load.version);

  // 造 3 条会话：甲 A 有 6 轮（第 2 轮是 20 行长文本），乙 B 3 轮，丙 C 2 轮
  await ev(`
    (async () => {
      const now = Date.now();
      const LONG = Array.from({ length: 20 }, (_, i) =>
        '这是第 ' + (i + 1) + ' 行，用来测试长消息折叠功能是否生效。').join('\\n');
      const mk = (id, title, age, n, longOn) => {
        const msgs = [];
        for (let i = 1; i <= n; i++) {
          msgs.push({ id: 'u-' + id + '-' + i, role: 'user',
            content: (longOn && i === 2) ? LONG : (title + ' 的第 ' + i + ' 个问题'),
            files: [], createdAt: now - age + i,
            parentId: i === 1 ? null : 'a-' + id + '-' + (i - 1),
            selectedChildId: 'a-' + id + '-' + i });
          msgs.push({ id: 'a-' + id + '-' + i, role: 'assistant', createdAt: now - age + i + 1,
            parentId: 'u-' + id + '-' + i, selectedChildId: i === n ? null : 'u-' + id + '-' + (i + 1),
            model: 'deepseek-flash', status: 'done',
            blocks: [{ type: 'text', text: title + ' 的第 ' + i + ' 个回答' }] });
        }
        return { id, title, createdAt: now - age, updatedAt: now - age,
          rootMessageId: 'u-' + id + '-1', messages: msgs };
      };
      const db = await new Promise((res) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); });
      await new Promise((res) => {
        const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
        [['s-A', '甲对话', 9000, 6, true], ['s-B', '乙对话', 90000, 3, false],
         ['s-C', '丙对话', 30000, 2, false]].forEach(([id, title, age, n, lo]) => {
          tx.objectStore('sessions').put(mk(id, title, age, n, lo));
          tx.objectStore('sessionSummaries').put({ id, title, createdAt: now - age, updatedAt: now - age, fileIds: [] });
        });
        tx.oncomplete = () => res(); tx.onerror = () => res();
      });
      db.close();
      return 'ok';
    })()
  `);
  const tokA = JSON.parse(await ev(`JSON.stringify((function(){
    const l = window.__localstore.readSidebarSessions();
    const t = l.find(x => x.title === '甲对话');
    return t ? t.token : null;
  })())`));

  await cdp.send('Page.navigate', { url: TARGET + '#c=' + tokA });
  await sleep(2000);
  await cdp.send('Page.reload');
  await sleep(7000);
  for (let i = 0; i < 50; i++) {
    if (await ev(`document.querySelectorAll('.item-ff6fc9').length >= 3`)) break;
    await sleep(500);
  }
  await sleep(1500);
  if (!(await ev(`document.querySelectorAll('[class*="bubble-"]').length > 0`))) {
    await ev(`(function(){
      const its = document.querySelectorAll('.item-ff6fc9');
      for (const it of its) {
        const t = it.querySelector('.title-ff6fc9');
        if (t && t.textContent.trim() === '甲对话') { it.click(); return 'clicked'; }
      }
      return 'not found';
    })()`);
    await sleep(4000);
  }
  await sleep(1500);

  /* ---------------------------------------------------------------- */
  console.log('\n[2] 消息索引轨道');

  // 轨道的最终形态（用户明确要求）：
  //   · 一条横线 = 一条**用户提问**，助手回答不进轨道
  //   · 不要框框，就是一条条横线
  //   · 悬浮显示该条提问的内容
  //   · data-ls-index 是「在全部消息里的真实序号」，用于点击定位
  const rail = JSON.parse(await ev(`JSON.stringify({
    exists: !!document.querySelector('.ls-msg-rail'),
    lines: window.__lsFeatures.railCount(),
    msgs: window.__lsFeatures.collectMessages().length,
    userMsgs: window.__lsFeatures.collectMessages().filter(m => m.role === 'user').length,
    indexes: [].slice.call(document.querySelectorAll('.ls-msg-rail__line')).map(b => Number(b.dataset.lsIndex)),
    tips: [].slice.call(document.querySelectorAll('.ls-msg-rail__line')).map(b => b.dataset.lsTip || ''),
    active: document.querySelectorAll('.ls-msg-rail__line.is-active').length,
    rightEdge: (function(){ const r=document.querySelector('.ls-msg-rail').getBoundingClientRect();
      const m=document.querySelector('.main-_9fdf5').getBoundingClientRect();
      return Math.round(m.right - r.right); })(),
    scrollerHasRail: !!document.querySelector('.container-_7ccaf .ls-msg-rail'),
    // 「不要框框」：轨道本身不能有背景/边框/圆角
    boxStyle: (function(){ const c=getComputedStyle(document.querySelector('.ls-msg-rail'));
      return { bg: c.backgroundColor, border: c.borderTopWidth, radius: c.borderTopLeftRadius }; })(),
    // 横线是伪元素画的
    lineStyle: (function(){ const l=document.querySelector('.ls-msg-rail__line');
      if(!l) return null; const b=getComputedStyle(l,'::before');
      return { w: b.width, h: b.height, bg: b.backgroundColor, content: b.content }; })()
  })`));
  check('轨道已挂载到消息区', rail.exists, JSON.stringify(rail));
  check('一条横线 == 一条用户提问（助手回答不进轨道）',
    rail.lines === rail.userMsgs && rail.userMsgs > 0 && rail.lines < rail.msgs,
    JSON.stringify({ 线数: rail.lines, 用户消息: rail.userMsgs, 全部消息: rail.msgs }));
  check('每条线记住的是「全部消息里的真实序号」（1,3,5...）',
    rail.indexes.length > 1 && rail.indexes[0] === 1 && rail.indexes.every((v, i) => i === 0 || v === rail.indexes[i - 1] + 2),
    JSON.stringify(rail.indexes));
  check('轨道没有框框（无背景、无边框、无圆角）',
    rail.boxStyle.bg === 'rgba(0, 0, 0, 0)' && parseFloat(rail.boxStyle.border) === 0 &&
      parseFloat(rail.boxStyle.radius) === 0,
    JSON.stringify(rail.boxStyle));
  check('横线是用伪元素画的（不是带框的按钮）',
    !!rail.lineStyle && rail.lineStyle.content !== 'none' && parseFloat(rail.lineStyle.h) <= 4,
    JSON.stringify(rail.lineStyle));
  check('每条线都有悬浮提示文案（用户提问原文）',
    rail.tips.length === rail.lines && rail.tips.every((t) => t.length > 0),
    JSON.stringify(rail.tips));
  check('有一个编号处于 active', rail.active === 1, String(rail.active));
  check('轨道在消息区最右侧（不遮挡正文，且没落在滚动容器里）',
    rail.rightEdge >= 0 && rail.rightEdge <= 40 && !rail.scrollerHasRail,
    JSON.stringify({ 距右边缘: rail.rightEdge, 在滚动容器内: rail.scrollerHasRail }));

  // 悬浮一条线 → 出现我们自绘的提示，且文案就是那条提问
  const hoverTip = JSON.parse(await ev(`
    (async function(){
      const line = document.querySelectorAll('.ls-msg-rail__line')[1];
      const r = line.getBoundingClientRect();
      const want = line.dataset.lsTip;
      line.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
      await new Promise(res => setTimeout(res, 400));
      const tip = document.querySelector('.ls-tip');
      const cs = tip ? getComputedStyle(tip) : null;
      return JSON.stringify({
        want: want,
        got: tip ? tip.textContent : null,
        visible: !!(tip && cs && cs.visibility !== 'hidden' && cs.opacity !== '0' && tip.getBoundingClientRect().width > 0),
        onRight: !!(tip && tip.classList.contains('ls-tip--right'))
      });
    })()
  `));
  check('悬浮一条横线会弹出提示，文案是该条用户提问',
    hoverTip.got === hoverTip.want && hoverTip.visible,
    JSON.stringify(hoverTip));
  check('轨道的提示朝左展开（不跑出屏幕右侧）', hoverTip.onRight, JSON.stringify(hoverTip));

  // 点击最后一条线 → 应滚到底部
  const jump = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const sc = document.querySelector('.container-_7ccaf');
      sc.scrollTop = 0;
      await new Promise(r => setTimeout(r, 400));
      const before = sc.scrollTop;
      const lines = document.querySelectorAll('.ls-msg-rail__line');
      const last = lines[lines.length - 1];
      const wantIdx = Number(last.dataset.lsIndex);
      last.click();
      await new Promise(r => setTimeout(r, 900));
      const msgs = F.collectMessages();
      return JSON.stringify({ before: before, after: Math.round(sc.scrollTop),
        maxScroll: sc.scrollHeight - sc.clientHeight,
        wantIdx: wantIdx,
        // 目标消息应在视口内（允许一点误差）
        targetVisible: (function(){
          const el = msgs[wantIdx - 1].el;
          const r = el.getBoundingClientRect();
          const sr = sc.getBoundingClientRect();
          return r.top >= sr.top - 30 && r.bottom <= sr.bottom + 30;
        })(),
        filled: F.railCount(),
        flashed: document.querySelectorAll('.ls-msg-flash').length });
    })()
  `));
  check('点最后一条线能定位到对应的用户提问',
    jump.after > jump.before + 50 && jump.targetVisible,
    JSON.stringify(jump));
  check('定位时目标消息会高亮闪一下', jump.flashed >= 1, JSON.stringify({ flashed: jump.flashed }));

  // 点击中间一条线 → 定位后 active 线必须与目标一致（防错位回归）
  const railSync = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const read = () => {
        const lines = [].slice.call(document.querySelectorAll('.ls-msg-rail__line'));
        const on = lines.findIndex(l => l.classList.contains('is-active'));
        return on < 0 ? -1 : Number(lines[on].dataset.lsIndex);
      };
      const lines = document.querySelectorAll('.ls-msg-rail__line');
      const targets = [0, Math.floor(lines.length / 2), lines.length - 1]
        .map(i => Number(lines[i].dataset.lsIndex));
      const out = [];
      const sc = document.querySelector('.container-_7ccaf');
      // 等「平滑滚动真的停下来」再读，不要用固定延时赌。
      // 实测无头 Chrome 关掉硬件加速后，应用的平滑滚动 2.6 秒都还没停，
      // 固定延时会读到动画中间态，高亮还停在上面那条线上。
      const settle = async () => {
        let last = -1, still = 0;
        for (let i = 0; i < 60 && still < 3; i++) {
          await new Promise(r => setTimeout(r, 120));
          if (Math.abs(sc.scrollTop - last) < 1) still++;
          else still = 0;
          last = sc.scrollTop;
        }
        await new Promise(r => setTimeout(r, 300));
      };
      for (const idx of targets) {
        F.scrollToMessage(idx - 1);
        await settle();
        out.push({ 目标序号: idx, active序号: read() });
      }
      return JSON.stringify(out);
    })()
  `));
  check('active 横线与定位目标一致（不会错位到别的消息）',
    railSync.every((r) => Math.abs(r.active序号 - r.目标序号) <= 1), JSON.stringify(railSync));

  /* ---------------------------------------------------------------- */
  console.log('\n[3] 置顶对话');

  const pinProbe = `(function(){
    var sec = document.querySelector('.ls-pin-section');
    var head = sec ? sec.querySelector('.ls-pin-head') : null;
    var body = sec ? sec.querySelector('.ls-pin-body') : null;
    return {
      hasSection: !!sec,
      firstChildIsPin: !!(document.querySelector('.list-ac14ac') &&
        document.querySelector('.list-ac14ac').firstElementChild === sec),
      headText: head ? (head.querySelector('.ls-pin-text') || {}).textContent : null,
      countText: head ? (head.querySelector('.ls-pin-count') || {}).textContent : null,
      hasChevron: !!(head && head.querySelector('.ls-pin-chev svg')),
      bodyItems: body ? [].slice.call(body.querySelectorAll('.item-ff6fc9'))
        .map(function(i){ return i.querySelector('.title-ff6fc9').textContent.trim(); }) : [],
      hiddenReal: document.querySelectorAll('.item-ff6fc9.ls-pin-hidden').length,
      collapsed: sec ? sec.classList.contains('is-collapsed') : null,
      visibleOrder: [].slice.call(document.querySelectorAll('.list-ac14ac .item-ff6fc9'))
        .filter(function(i){ return getComputedStyle(i).display !== 'none'; })
        .map(function(i){ return i.querySelector('.title-ff6fc9').textContent.trim(); })
    };
  })()`;

  const pinMenu = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      F.setPinned([]);
      await new Promise(r => setTimeout(r, 300));
      const before = [].slice.call(document.querySelectorAll('.item-ff6fc9'))
        .map(i => i.querySelector('.title-ff6fc9').textContent.trim());
      const its = [].slice.call(document.querySelectorAll('.item-ff6fc9'));
      const target = its.find(i => i.querySelector('.title-ff6fc9').textContent.trim() === '乙对话');
      target.querySelector('.action-ff6fc9 button').click();
      await new Promise(r => setTimeout(r, 600));
      const menu = document.querySelector('.menu-_5f384');
      const opts = menu ? [].slice.call(menu.querySelectorAll('.option-_5f384')).map(o => o.textContent.trim()) : [];
      const pinOpt = menu && menu.querySelector('.ls-pin-option');
      const label = pinOpt ? pinOpt.textContent.trim() : null;
      if (pinOpt) pinOpt.click();
      await new Promise(r => setTimeout(r, 1000));
      return JSON.stringify({ before: before, menuOptions: opts, pinLabel: label,
        pins: F.readPins(), probe: ${pinProbe},
        menuClosed: !document.querySelector('.ls-pin-option') });
    })()
  `));
  check('「...」菜单里多了「置顶」（在重命名/删除之前）',
    pinMenu.menuOptions.length >= 3 && pinMenu.menuOptions[0] === '置顶',
    JSON.stringify(pinMenu.menuOptions));

  // 置顶不是「把真身搬到最前」，而是单独开一个和「今天/昨天」同级的分节。
  // 真身留在原日期分节里、隐藏起来占位；「置顶」分节里放的是克隆。
  check('多了一个「置顶」分节，并且在列表最上面',
    pinMenu.probe.hasSection && pinMenu.probe.firstChildIsPin,
    JSON.stringify(pinMenu.probe));
  // 展开态标题就是「置顶」；「N 个对话」是收起后才出现的（用户的意思是
  // 收起后要能看出里面有多少条，展开时列表就在眼前，重复显示反而啰嗦）。
  check('分节标题是「置顶」（展开态不带计数）',
    pinMenu.probe.headText === '置顶' && String(pinMenu.probe.countText) === '',
    JSON.stringify({ 标题: pinMenu.probe.headText, 计数: pinMenu.probe.countText }));
  check('分节标题旁边有一个 ^ 形状的收起符号',
    pinMenu.probe.hasChevron === true, String(pinMenu.probe.hasChevron));
  check('置顶的对话出现在「置顶」分节里',
    pinMenu.probe.bodyItems.join(',') === '乙对话' && pinMenu.probe.hiddenReal === 1,
    JSON.stringify({ 分身里: pinMenu.probe.bodyItems, 隐藏的真身: pinMenu.probe.hiddenReal }));
  // 只有「置顶」分节里的那份能看见；原日期分节里那份被 display:none 藏掉，
  // 但仍然留在 DOM 里给 React 占位（不能搬走，见 localstore-features.js 的注释）。
  check('原日期分节里的真身被隐藏，只剩「置顶」分节里那一份可见',
    pinMenu.probe.visibleOrder.join(',') === '乙对话,甲对话,丙对话' &&
      pinMenu.probe.hiddenReal === 1,
    JSON.stringify({ 可见: pinMenu.probe.visibleOrder, 隐藏: pinMenu.probe.hiddenReal }));
  check('置顶状态写入 localStorage', pinMenu.pins.join(',') === '乙对话', JSON.stringify(pinMenu.pins));
  check('点完菜单自动关闭', pinMenu.menuClosed);

  // 置顶状态在刷新后保持
  await cdp.send('Page.reload');
  await sleep(7000);
  for (let i = 0; i < 40; i++) {
    if (await ev(`document.querySelectorAll('.item-ff6fc9').length >= 3`)) break;
    await sleep(500);
  }
  await sleep(2000);
  const persisted = JSON.parse(await ev(`JSON.stringify(${pinProbe})`));
  check('刷新后置顶分节仍在最上面，且还是那一条',
    persisted.hasSection && persisted.firstChildIsPin && persisted.bodyItems.join(',') === '乙对话',
    JSON.stringify(persisted));

  // 收起 / 展开：整行可点，收起后仍能看到「置顶 N 个对话」
  const pinToggle = JSON.parse(await ev(`
    (async function(){
      const read = () => JSON.stringify(${pinProbe});
      const head = document.querySelector('.ls-pin-section .ls-pin-head');
      // 点标题栏（不是里面的文字节点）——用户要求整行都能点
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      const collapsedState = JSON.parse(read());
      const storedCollapsed = localStorage.getItem('chat-demo:ls-pin-open');
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      const expandedState = JSON.parse(read());
      return JSON.stringify({ collapsedState, storedCollapsed, expandedState });
    })()
  `));
  check('点标题栏收起后分节多出收起态',
    pinToggle.collapsedState.collapsed === true, JSON.stringify(pinToggle.collapsedState));
  check('收起后仍然显示「置顶」和「N 个对话」（信息不丢）',
    pinToggle.collapsedState.headText === '置顶' &&
      /个对话/.test(String(pinToggle.collapsedState.countText)),
    JSON.stringify({ 标题: pinToggle.collapsedState.headText, 计数: pinToggle.collapsedState.countText }));
  check('收起状态记进 localStorage（刷新后保持）',
    pinToggle.storedCollapsed === 'false', String(pinToggle.storedCollapsed));
  check('再点一次展开回来',
    pinToggle.expandedState.collapsed === false &&
      pinToggle.expandedState.bodyItems.join(',') === '乙对话',
    JSON.stringify(pinToggle.expandedState));

  // 取消置顶
  const unpin = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const its = [].slice.call(document.querySelectorAll('.item-ff6fc9'));
      const target = its.find(i => i.querySelector('.title-ff6fc9').textContent.trim() === '乙对话' &&
        !i.classList.contains('ls-pin-clone'));
      target.querySelector('.action-ff6fc9 button').click();
      await new Promise(r => setTimeout(r, 600));
      const pinOpt = document.querySelector('.ls-pin-option');
      const label = pinOpt ? pinOpt.textContent.trim() : null;
      if (pinOpt) pinOpt.click();
      await new Promise(r => setTimeout(r, 1000));
      return JSON.stringify({ label: label, pins: F.readPins(),
        hasSection: !!document.querySelector('.ls-pin-section'),
        hiddenReal: document.querySelectorAll('.item-ff6fc9.ls-pin-hidden').length });
    })()
  `));
  check('已置顶的项菜单显示「取消置顶」', unpin.label === '取消置顶', JSON.stringify(unpin));
  check('取消置顶后「置顶」分节消失、隐藏的真身恢复显示',
    unpin.hasSection === false && unpin.hiddenReal === 0 && unpin.pins.length === 0,
    JSON.stringify(unpin));

  /* ---------------------------------------------------------------- */
  console.log('\n[4] 长消息折叠（超过 8 行）');

  // 回到甲对话（有长消息那条）
  await ev(`(function(){
    const its = document.querySelectorAll('.item-ff6fc9');
    for (const it of its) {
      const t = it.querySelector('.title-ff6fc9');
      if (t && t.textContent.trim() === '甲对话') { it.click(); return 'clicked'; }
    }
    return 'x';
  })()`);
  await sleep(3500);

  const clamp = JSON.parse(await ev(`
    (function(){
      const boxes = document.querySelectorAll('.ls-clamp');
      const body = document.querySelector('.ls-clamp__body');
      const bubble = body ? body.querySelector('[class*="bubble-"]') : null;
      const cs = bubble ? getComputedStyle(bubble) : null;
      const lh = cs ? parseFloat(cs.lineHeight) : 0;
      const btn = document.querySelector('.ls-clamp__toggle');
      return JSON.stringify({
        boxes: boxes.length,
        bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
        limit8: lh ? Math.round(lh * 8) : null,
        fullVar: body ? body.style.getPropertyValue('--ls-clamp-full') : null,
        collapsedVar: body ? body.style.getPropertyValue('--ls-clamp-h') : null,
        maxHeight: body ? getComputedStyle(body).maxHeight : null,
        transition: body ? getComputedStyle(body).transitionProperty + ' ' + getComputedStyle(body).transitionDuration : null,
        isOpen: body ? body.classList.contains('is-open') : null,
        btnLabel: (document.querySelector('.ls-clamp__label') || {}).textContent,
        expanded: btn ? btn.getAttribute('aria-expanded') : null,
        userBoxes: document.querySelectorAll('.container-_4cfe7').length
      });
    })()
  `));
  check('只有超长的那条被折叠（其余 5 条用户消息不动）',
    clamp.boxes === 1 && clamp.userBoxes === 6, JSON.stringify(clamp));
  check('折叠高度约等于 8 行 + 内边距', clamp.bodyH != null && clamp.limit8 != null &&
    clamp.bodyH <= clamp.limit8 + 80 && clamp.bodyH >= clamp.limit8 - 10,
    JSON.stringify({ 折叠高: clamp.bodyH, '8行': clamp.limit8 }));
  check('完整高度确实远超折叠高度', clamp.fullVar &&
    parseInt(clamp.fullVar, 10) > clamp.limit8 * 2,
    JSON.stringify({ full: clamp.fullVar, limit8: clamp.limit8 }));
  check('折叠用 max-height 过渡（可动画）',
    /max-height/.test(String(clamp.maxHeight)) || /max-height/.test(String(clamp.transition)),
    JSON.stringify({ maxHeight: clamp.maxHeight, transition: clamp.transition }));
  check('初始是折叠态且按钮写「展开全文」',
    clamp.isOpen === false && clamp.btnLabel === '展开全文' && clamp.expanded === 'false',
    JSON.stringify(clamp));

  const toggle = JSON.parse(await ev(`
    (async function(){
      const body = document.querySelector('.ls-clamp__body');
      const btn = document.querySelector('.ls-clamp__toggle');
      const label = () => document.querySelector('.ls-clamp__label').textContent;
      const h = () => Math.round(body.getBoundingClientRect().height);
      const h0 = h();
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      const h1 = h();
      const openLabel = label();
      const exp = btn.getAttribute('aria-expanded');
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      const h2 = h();
      return JSON.stringify({ h0: h0, h1: h1, h2: h2, openLabel: openLabel,
        closedLabel: label(), ariaAfterOpen: exp });
    })()
  `));
  check('展开后高度变大', toggle.h1 > toggle.h0 + 100, JSON.stringify(toggle));
  check('展开后按钮变「收起」，aria-expanded=true',
    toggle.openLabel === '收起' && toggle.ariaAfterOpen === 'true', JSON.stringify(toggle));
  check('再次点击能收回原高度', Math.abs(toggle.h2 - toggle.h0) <= 4,
    JSON.stringify({ 折叠: toggle.h0, 展开: toggle.h1, 收回归位: toggle.h2 }));
  check('长文本内容没丢（20 行都在）',
    await ev(`(function(){ const b=document.querySelector('.ls-clamp__body'); return /第 20 行/.test(b.textContent); })()`));

  /* ---------------------------------------------------------------- */
  console.log('\n[5] 粘贴文本过大 → 原生 .txt 附件');

  const paste = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const ta = document.querySelector('textarea');
      if (!ta) return JSON.stringify({ err: 'no textarea' });
      ta.focus();
      const big = Array.from({ length: 60 }, (_, i) =>
        '粘贴进来的第 ' + (i + 1) + ' 行文字内容，这一行写得长一点好让总字数超过 1200 的阈值。').join('\\n');
      const dt = new DataTransfer();
      dt.setData('text/plain', big);
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      ta.dispatchEvent(evt);
      await new Promise(r => setTimeout(r, 1500));
      // 「自带 UI」的判定：DOM 里不该出现任何 ls-paste-* 节点
      const inner = document.body.innerText || '';
      const out = {
        defaultPrevented: evt.defaultPrevented,
        textareaLen: ta.value.length,
        ownUiNodes: document.querySelectorAll('[class*=ls-paste]').length,
        cards: (inner.split(String.fromCharCode(10)) || []).filter(l => l.indexOf('.txt') >= 0).slice(0, 4),
        uploadInputFound: !!F.findUploadInput(),
        acceptHasTxt: ((F.findUploadInput() || {}).accept || '').indexOf('.txt') >= 0,
        seq: localStorage.getItem('chat-demo:ls-paste-seq'),
        bigChars: big.length
      };
      // 小文本不该被拦
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', '就一行小文本');
      const e2 = new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true });
      ta.dispatchEvent(e2);
      await new Promise(r => setTimeout(r, 400));
      out.smallPrevented = e2.defaultPrevented;
      out.smallLooksBig = F.looksBig('就一行小文本');
      return JSON.stringify(out);
    })()
  `));
  check('大段粘贴被拦下（不再灌进输入框）',
    paste.defaultPrevented === true && paste.textareaLen === 0 && paste.bigChars > 1200,
    JSON.stringify(paste));
  check('不自建任何 UI（DOM 里没有 ls-paste-* 节点）',
    paste.ownUiNodes === 0, JSON.stringify({ ownUiNodes: paste.ownUiNodes }));
  // 命名规则（用户要求，与官方一致）：取首句/前几个字作为标题，
  // 第一份不加编号，从第二份起才有「（N）」；官方同款行为。
  check('标题取自首句（第一行前几个字）',
    /^粘贴进来的第 1 行文字内容/.test(String((paste.cards || [])[0] || '').trim()),
    JSON.stringify(paste.cards));
  check('走的是应用自己的附件输入框（accept 含 .txt）',
    paste.uploadInputFound === true && paste.acceptHasTxt === true,
    JSON.stringify({ f: paste.uploadInputFound, a: paste.acceptHasTxt }));
  check('序号写进 localStorage（刷新后不重名）', Number(paste.seq) >= 1, String(paste.seq));
  check('小段粘贴不受影响（不拦、不判为大）',
    paste.smallPrevented === false && paste.smallLooksBig === false, JSON.stringify(paste));

  // 再粘一段：序号要递增
  const paste2 = JSON.parse(await ev(`
    (async function(){
      const ta = document.querySelector('textarea');
      ta.focus();
      const big = Array.from({ length: 60 }, (_, i) => '第二段第一行的内容 ' + i + ' 补足字数').join('\\n');
      const dt = new DataTransfer();
      dt.setData('text/plain', big);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 1500));
      const inner = document.body.innerText || '';
      return JSON.stringify({
        cards: (inner.split(String.fromCharCode(10)) || []).filter(l => l.indexOf('.txt') >= 0),
        seq: localStorage.getItem('chat-demo:ls-paste-seq')
      });
    })()
  `));
  // 第二段的首句与第一段不同，标题自然不同；
  // 同名前会有「（2）」编号，这里两段首句不同，所以不该带编号。
  check('第二段标题取自它自己的首句（内容不同则标题不同）',
    (paste2.cards || []).some((c) => /^第二段第一行的内容/.test(c.trim())) &&
      !(paste2.cards || []).some((c) => /（2）/.test(c)),
    JSON.stringify(paste2));

  /* ---------------------------------------------------------------- */
  console.log('\n[5b] 启动时侧栏还是空的，置顶不能丢（回归）');

  // 这条是用户报的「置顶对话看不到」的回归测试。
  // 复现：置顶一个会话后，在侧栏还没渲染出来的时候让功能层跑一遍
  // （真实触发是启动那几秒 / 反向同步后的 reload）。
  // 旧写法在这种情况下会把整个 .ls-pin-section remove() 掉，之后永久消失。
  const pinBoot = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const items = [].slice.call(document.querySelectorAll('.item-ff6fc9'));
      const target = items.find(i => !i.classList.contains('ls-pin-clone'));
      if (!target) return JSON.stringify({ err: 'no item' });
      const title = target.querySelector('.title-ff6fc9').textContent.trim();
      F.setPinned([title]);
      await new Promise(r => setTimeout(r, 900));
      return JSON.stringify({ title, pinned: F.readPins() });
    })()
  `));
  check('先置顶一条对话', pinBoot.pinned && pinBoot.pinned.length === 1, JSON.stringify(pinBoot));

  // 把侧栏项整个挪走，模拟"应用还没读完 IndexedDB"的那一瞬间。
  // 注意置顶小节里的克隆也要清掉 —— 它也算 .item-ff6fc9，
  // 只要还剩一个克隆，功能层就仍能"认到"这条置顶，模拟就不成立。
  const emptied = JSON.parse(await ev(`
    (function(){
      const list = document.querySelector('.list-ac14ac');
      if (!list) return JSON.stringify({ err: 'no list' });
      window.__pinStash = document.createDocumentFragment();
      window.__pinStashNodes = [].slice.call(list.children)
        .filter(c => !c.classList.contains('ls-pin-section'));
      window.__pinStashNodes.forEach(n => window.__pinStash.appendChild(n));
      const body = document.querySelector('.ls-pin-body');
      if (body) body.textContent = '';
      return JSON.stringify({ moved: window.__pinStashNodes.length,
        itemsNow: document.querySelectorAll('.item-ff6fc9').length,
        sectionStillThere: !!document.querySelector('.ls-pin-section') });
    })()
  `));
  check('把侧栏项暂时移走（模拟未渲染完）',
    emptied.moved > 0 && emptied.itemsNow === 0, JSON.stringify(emptied));

  // 空侧栏时跑一遍功能重放 —— 旧实现在这里会删掉置顶小节
  const duringEmpty = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      F.refreshPinOrder();
      window.dispatchEvent(new Event('resize'));
      await new Promise(r => setTimeout(r, 700));
      return JSON.stringify({
        sectionDuringEmpty: !!document.querySelector('.ls-pin-section'),
        cloneDuringEmpty: document.querySelectorAll('.ls-pin-clone').length,
        pending: !!(F.pendingPins && F.pendingPins.length)
      });
    })()
  `));
  check('侧栏为空时不去删置顶小节（关键回归点）',
    duringEmpty.sectionDuringEmpty === true, JSON.stringify(duringEmpty));
  check('侧栏为空时把过期的克隆清掉（不留幽灵行）',
    duringEmpty.cloneDuringEmpty === 0, JSON.stringify(duringEmpty));
  check('记下了「还在等哪些置顶」（便于诊断）',
    duringEmpty.pending === true, JSON.stringify(duringEmpty));

  // 放回去，重试轮询应该把置顶重新显示出来
  const restored = JSON.parse(await ev(`
    (async function(){
      const list = document.querySelector('.list-ac14ac');
      const frag = window.__pinStash;
      while (frag.firstChild) list.appendChild(frag.firstChild);
      await new Promise(r => setTimeout(r, 2500));
      const sec = document.querySelector('.ls-pin-section');
      const clone = document.querySelector('.ls-pin-clone');
      return JSON.stringify({
        hasSection: !!sec,
        firstChildIsPin: !!(list && list.firstElementChild === sec),
        cloneTitle: clone ? clone.querySelector('.title-ff6fc9').textContent.trim() : null,
        hiddenReal: document.querySelectorAll('.item-ff6fc9.ls-pin-hidden').length,
        cloneHasAction: clone ? !!clone.querySelector('.action-ff6fc9') : null
      });
    })()
  `));
  check('侧栏回来后置顶自动重新出现（重试轮询生效）',
    restored.hasSection === true && restored.cloneTitle === pinBoot.title,
    JSON.stringify(restored));
  check('置顶小节仍在最前面', restored.firstChildIsPin === true, JSON.stringify(restored));
  check('置顶行里保留「...」按钮（否则没法取消置顶）',
    restored.cloneHasAction === true, JSON.stringify(restored));

  // 从「置顶」这一行点「...」→ 菜单里应该有「取消置顶」，点了要能取消。
  // 这是用户明确指出的：置顶行没有「...」就没法取消置顶。
  //
  // ⚠ 必须用**真指针事件**（Input.dispatchMouseEvent）。
  //   应用的菜单按钮监听的是真实的点击事件链，`el.click()` 是合成点击，
  //   实测弹不出菜单（真身、克隆都一样）。所以这里走 CDP 真指针。
  const cloneBtnBox = JSON.parse(await ev(`
    (function(){
      const clone = document.querySelector('.ls-pin-clone');
      if (!clone) return JSON.stringify({ err: 'no clone' });
      const b = clone.querySelector('.action-ff6fc9 button');
      if (!b) return JSON.stringify({ err: 'no action button' });
      const r = b.getBoundingClientRect();
      return JSON.stringify({ hasBtn: true, w: Math.round(r.width),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()
  `));
  check('置顶行里有可用的「...」按钮', cloneBtnBox.hasBtn === true && cloneBtnBox.w > 0,
    JSON.stringify(cloneBtnBox));

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cloneBtnBox.x, y: cloneBtnBox.y, buttons: 0 });
  await sleep(250);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cloneBtnBox.x, y: cloneBtnBox.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cloneBtnBox.x, y: cloneBtnBox.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1200);

  const unpinFromClone = JSON.parse(await ev(`
    (function(){
      // 菜单的 class 是 menu-_5f384（不是 b81146，那是另一个组件的）
      const menus = [].slice.call(document.querySelectorAll('.menu-_5f384'));
      const clone = document.querySelector('.ls-pin-clone');
      const btn = clone && clone.querySelector('.action-ff6fc9 button');
      const br = btn ? btn.getBoundingClientRect() : null;
      const out = { menus: menus.length };
      if (br) out.cloneBtn = [Math.round(br.x), Math.round(br.y), Math.round(br.width), Math.round(br.height)];
      if (menus.length) {
        const mr = menus[0].getBoundingClientRect();
        out.menuRect = [Math.round(mr.x), Math.round(mr.y), Math.round(mr.width), Math.round(mr.height)];
        // 菜单左边缘应该贴着按钮左边缘（align:start）
        out.dxToButtonLeft = Math.round(mr.x - br.left);
        // 菜单应该在按钮下方（dy 为正且不太远）
        out.dyFromButtonTop = Math.round(mr.top - br.top);
        out.options = [].slice.call(menus[0].querySelectorAll('[role=menuitem]'))
          .map(o => o.textContent.trim());
        out.firstOption = out.options[0];
        const pinOpt = menus[0].querySelector('.ls-pin-option');
        out.hasPinOption = !!pinOpt;
        if (pinOpt) {
          pinOpt.click();
          out.pinsAfter = JSON.parse(localStorage.getItem('chat-demo:ls-pinned') || '[]');
        }
      }
      return JSON.stringify(out);
    })()
  `));
  check('置顶行点「...」能弹出应用菜单', unpinFromClone.menus === 1, JSON.stringify(unpinFromClone));
  check('菜单第一项是「取消置顶」',
    unpinFromClone.firstOption === '取消置顶', JSON.stringify(unpinFromClone.options));
  // 位置：用户报的是「不是点不开，是位置不对」——菜单跑到屏幕左上角。
  // 所以这里必须断言它贴着那个按钮，而不是 (8,4) 那种角落。
  check('菜单出现在置顶行的「...」旁边（不再跑到左上角）',
    typeof unpinFromClone.dxToButtonLeft === 'number' &&
    Math.abs(unpinFromClone.dxToButtonLeft) <= 24 &&
    unpinFromClone.dyFromButtonTop > 0 && unpinFromClone.dyFromButtonTop < 80,
    JSON.stringify({ dx: unpinFromClone.dxToButtonLeft, dy: unpinFromClone.dyFromButtonTop,
      cloneBtn: unpinFromClone.cloneBtn, menuRect: unpinFromClone.menuRect }));

  await sleep(900);
  const afterUnpin = JSON.parse(await ev(`JSON.stringify({
    sectionGone: !document.querySelector('.ls-pin-section'),
    pins: JSON.parse(localStorage.getItem('chat-demo:ls-pinned') || '[]')
  })`));
  check('从置顶行取消置顶后分节消失、置顶清空',
    afterUnpin.sectionGone === true && afterUnpin.pins.length === 0,
    JSON.stringify(afterUnpin));

  // 切换对话时，置顶行不能被删掉重建（用户报「点别的对话，置顶那个也在跳」）
  const rePin = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const items = [].slice.call(document.querySelectorAll('.item-ff6fc9'));
      const target = items.find(i => !i.classList.contains('ls-pin-clone'));
      if (!target) return JSON.stringify({ err: 'no item' });
      F.setPinned([target.querySelector('.title-ff6fc9').textContent.trim()]);
      await new Promise(r => setTimeout(r, 900));
      const clone = document.querySelector('.ls-pin-clone');
      if (!clone) return JSON.stringify({ err: 'no clone after repin' });
      // 记住这个节点本体，切换对话后核对还是同一个
      window.__cloneRef = clone;
      return JSON.stringify({ ok: true, title: clone.dataset.lsPinTitle });
    })()
  `));
  check('重新置顶一条以做「切换对话不重建」验证', rePin.ok === true, JSON.stringify(rePin));

  const otherTitle = await ev(`
    (function(){
      const items = [].slice.call(document.querySelectorAll('.item-ff6fc9'))
        .filter(i => !i.classList.contains('ls-pin-clone') && !i.classList.contains('ls-pin-hidden'));
      const other = items.find(i => i.querySelector('.title-ff6fc9').textContent.trim() !== ${JSON.stringify(rePin.title)});
      return other ? other.querySelector('.title-ff6fc9').textContent.trim() : '';
    })()
  `);
  if (otherTitle) {
    await ev(`
      (function(){
        const items = [].slice.call(document.querySelectorAll('.item-ff6fc9'));
        const other = items.find(i => !i.classList.contains('ls-pin-clone') &&
          i.querySelector('.title-ff6fc9').textContent.trim() === ${JSON.stringify(otherTitle)});
        if (other) other.click();
      })()
    `);
    await sleep(3000);
  }
  const sameNode = JSON.parse(await ev(`JSON.stringify({
    stillSameNode: window.__cloneRef === document.querySelector('.ls-pin-clone'),
    cloneCount: document.querySelectorAll('.ls-pin-clone').length,
    exists: !!document.querySelector('.ls-pin-clone')
  })`));
  check('切换对话后置顶行还是同一个节点（没有删掉重建 = 不会跳）',
    sameNode.stillSameNode === true && sameNode.cloneCount === 1, JSON.stringify(sameNode));

  /* ---------------------------------------------------------------- */
  console.log('\n[6] 关键词搜索对话');

  const search = JSON.parse(await ev(`
    (async function(){
      const F = window.__lsFeatures;
      const byTitle = await F.searchSessions('乙对话');
      const byBody = await F.searchSessions('丙对话 的第 2 个回答');
      const none = await F.searchSessions('绝对不存在的词zzz');
      F.openSearch();
      await new Promise(r => setTimeout(r, 500));
      const panel = document.querySelector('.ls-search-panel');
      const inp = document.querySelector('.ls-search-input');
      const opened = { panel: !!panel, isOpen: panel ? panel.classList.contains('is-open') : null,
        placeholder: inp ? inp.placeholder : null };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '乙对话');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
      const hits = [].slice.call(document.querySelectorAll('.ls-search-hit__title')).map(e => e.textContent);
      const marks = document.querySelectorAll('.ls-mark').length;
      const count = (document.querySelector('.ls-search-count') || {}).textContent;
      return JSON.stringify({ byTitle: byTitle.map(r => r.title), byBody: byBody.map(r => r.title),
        noneLen: none.length, opened: opened, hits: hits, marks: marks, count: count,
        snippetHasKw: byTitle.length ? byTitle[0].snippet.length > 0 : false });
    })()
  `));
  check('按标题能搜到', search.byTitle.join(',') === '乙对话', JSON.stringify(search.byTitle));
  check('按正文能搜到（关键词只在回答里）',
    search.byBody.join(',') === '丙对话', JSON.stringify(search.byBody));
  check('搜不到时返回空', search.noneLen === 0, String(search.noneLen));
  check('搜索面板能打开', search.opened.panel === true && search.opened.isOpen === true,
    JSON.stringify(search.opened));
  check('界面里渲染出结果并显示条数',
    search.hits.length === 1 && /条结果/.test(String(search.count)),
    JSON.stringify({ hits: search.hits, count: search.count }));
  check('关键词被高亮', search.marks >= 1, String(search.marks));

  const jumpSearch = JSON.parse(await ev(`
    (async function(){
      const hit = document.querySelector('.ls-search-hit');
      const before = (document.querySelector('.item-ff6fc9.active-ff6fc9') || {}).textContent || '';
      hit.click();
      await new Promise(r => setTimeout(r, 3000));
      const active = document.querySelector('.item-ff6fc9.active-ff6fc9');
      return JSON.stringify({ before: before.trim(), after: active ? active.querySelector('.title-ff6fc9').textContent.trim() : null,
        panelClosed: !document.querySelector('.ls-search-panel.is-open'),
        bodyHas: /乙对话 的第 1 个回答/.test(document.body.innerText || '') });
    })()
  `));
  check('点搜索结果能跳到对应对话',
    jumpSearch.after === '乙对话' && jumpSearch.bodyHas === true, JSON.stringify(jumpSearch));
  check('跳转后搜索面板自动关闭', jumpSearch.panelClosed === true, JSON.stringify(jumpSearch));

  /* ---------------------------------------------------------------- */
  const errs = await ev(`JSON.stringify(window.__lsProbeErrors || [])`);
  check('过程无未捕获错误', errs === '[]', errs);

} catch (e) {
  fails.push('运行异常');
  console.log('\n运行异常: ' + (e && e.stack || e));
} finally {
  try { if (cdp) cdp.close(); } catch (e) { /* ignore */ }
  try { chrome.kill(); } catch (e) { /* ignore */ }
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\n==============================================');
console.log(`结果: ${pass} 通过, ${fails.length} 失败`);
if (fails.length) {
  console.log('失败项:');
  fails.forEach((f) => console.log('  · ' + f));
}
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
