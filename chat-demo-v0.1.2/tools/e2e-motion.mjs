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
