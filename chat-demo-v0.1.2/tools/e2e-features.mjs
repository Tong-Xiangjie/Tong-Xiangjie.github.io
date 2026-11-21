/**
 * 针对 localstore-bridge 新增能力的端到端自检（在真实浏览器里跑）。
 *
 * 说明：这里测的是【桥接层】的能力，不需要应用进入「已配置 API Key」状态。
 * 之所以不测「点发送按钮 → 真的发出请求」，是因为官方应用在未配置 Key 时
 * 会停在引导界面且不武装输入区（见 SETUP.md 的测试说明），
 * 那属于应用自身的状态门槛，与本补丁无关。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8895;
const CDP_PORT = 9381;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const modelRequests = [];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/models')) {
    modelRequests.push({ path: p, auth: req.headers['x-api-key'] || req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [
      { id: 'deepseek-flash', object: 'model', owned_by: 'deepseek' },
      { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
      { id: 'relay-sonnet', object: 'model', owned_by: 'relay' }
    ] }));
    return;
  }
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'cdp-feat-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(2800);
const ev = (e) => cdp.evaluate(e);
const BASE = `http://127.0.0.1:${PORT}`;

// 捕获页面里的报错，避免桥接层启动失败时只看到一堆莫名其妙的断言失败
const pageErrors = [];
cdp.on('event', (m) => {
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
});

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

console.log('\n=== 桥接层功能自检 ===\n');

// 先把启动期的错误打出来，否则后面的失败会看不出真正原因
if (pageErrors.length) {
  console.log('!! 页面启动期错误：');
  pageErrors.slice(0, 10).forEach((e) => console.log('   ' + e));
  console.log('');
}

const bootState = JSON.parse(await ev(`
  JSON.stringify(
  (() => ({
    hasLocalstore: !!window.__localstore,
    version: window.__localstore ? window.__localstore.version : null,
    keys: window.__localstore ? Object.keys(window.__localstore).length : 0
  }))()
  )
`));
check('桥接层启动成功', bootState.hasLocalstore === true, JSON.stringify(bootState));

const exposed = JSON.parse(await ev(`JSON.stringify(Object.keys(window.__localstore).sort())`));
console.log('   暴露的接口: ' + exposed.join(', ') + '\n');

// ---- 1. 设置项清单 ----
console.log('[1] 设置项存文件夹');
const allow = await ev(`JSON.stringify(window.__localstore.SETTINGS_ALLOW)`);
const allowList = JSON.parse(allow);
check('暴露了设置白名单', Array.isArray(allowList) && allowList.length > 0, allow);
check('白名单包含语言', allowList.includes('chat-demo:locale'));
check('白名单包含提供方列表', allowList.includes('chat-demo:providers'));
check('白名单不含密钥', !allowList.some((k) => /api-key/.test(k)), allow);
check('白名单不含文件夹句柄', !allowList.includes('chat-demo:local-folder'));

// 写入几条设置，验证能收集到
await ev(`
  (() => {
    localStorage.setItem('chat-demo:locale', 'en-US');
    localStorage.setItem('chat-demo:theme-preference', 'dark');
    return true;
  })()
`);
const collected = JSON.parse(await ev(`JSON.stringify(window.__localstore.collectSettings())`));
check('能收集到界面偏好', collected['chat-demo:locale'] === 'en-US' && collected['chat-demo:theme-preference'] === 'dark', JSON.stringify(collected));
check('收集结果里没有密钥', !Object.keys(collected).some((k) => /api-key/.test(k)));

// 注意：cdp.evaluate 会把结果 JSON 化，所以这里用 JSON.stringify 包一层，
// 否则 typeof <"function"> 恒为 "string"（早先就是这么误报的）。
check('暴露了保存设置的接口', (await ev(`JSON.stringify(typeof window.__localstore.writeSettingsToFolder)`)) === '"function"');
check('暴露了恢复设置的接口', (await ev(`JSON.stringify(typeof window.__localstore.restoreSettingsFromFolder)`)) === '"function"');

// ---- 2. 提供方与模型 ----
console.log('\n[2] 提供方与模型多选');
const seeded = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;
    localStorage.setItem(L.LS_PROVIDERS, JSON.stringify({
      schema: 'chat-demo-providers@1',
      activeId: 'deepseek-official',
      list: [
        { id: 'deepseek-official', name: 'DeepSeek 官方', baseURL: '${BASE}',
          apiKey: 'sk-official', models: ['deepseek-flash'], defaultModel: 'deepseek-flash', builtin: true },
        { id: 'relay-1', name: '中转站', baseURL: '${BASE}',
          apiKey: 'sk-relay', models: [], defaultModel: '', builtin: false }
      ]
    }));
    L.RESET_PROVIDERS_FOR_TEST();
    const st = L.getProviders();
    return { count: st.list.length, activeId: st.activeId, active: L.getActiveProvider().name };
  })()
  )
`));
check('读取到两个提供方', seeded.count === 2, JSON.stringify(seeded));
check('默认提供方正确', seeded.activeId === 'deepseek-official');

const fetchedRaw = await ev(`
  (async () => {
    try {
      const r = await window.__localstore.fetchModelsFor('deepseek-official');
      return 'OK ' + JSON.stringify(r);
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    获取模型原始返回: ' + String(fetchedRaw).slice(0, 400));
const fetched = { ok: String(fetchedRaw).startsWith('OK'), raw: fetchedRaw };
console.log('    服务端收到的 /models 请求: ' + JSON.stringify(modelRequests));
check('「获取模型」成功', fetched.ok === true, String(fetchedRaw).slice(0, 300));
check('拉取到 3 个模型', fetched.ok && fetchedRaw.includes('relay-sonnet'), String(fetchedRaw).slice(0, 300));

// availableModels 字段由「获取模型」按钮写入，因此这里直接按界面行为写一遍再读回，
// 验证 bridge 确实保留这个字段（而不是读取时丢弃）。
const avail = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const st = JSON.parse(localStorage.getItem(L.LS_PROVIDERS));
    const p = st.list.find((x) => x.id === 'deepseek-official');
    p.availableModels = ['deepseek-flash', 'deepseek-v4-pro', 'relay-sonnet'];
    localStorage.setItem(L.LS_PROVIDERS, JSON.stringify(st));
    L.RESET_PROVIDERS_FOR_TEST();
    const after = L.getProviders().list.find((x) => x.id === 'deepseek-official');
    return { availableModels: after.availableModels };
  })())
`));
check(
  '提供方保留 availableModels（未勾选的候选不丢）',
  JSON.stringify(avail.availableModels) === JSON.stringify(['deepseek-flash', 'deepseek-v4-pro', 'relay-sonnet']),
  JSON.stringify(avail)
);

// 多选：只保留 2 个
const multi = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;
    const st = JSON.parse(localStorage.getItem(L.LS_PROVIDERS));
    const p = st.list.find((x) => x.id === 'deepseek-official');
    p.availableModels = ['deepseek-flash', 'deepseek-v4-pro', 'relay-sonnet'];
    p.models = ['deepseek-flash', 'deepseek-v4-pro'];   // 勾选两个，relay-sonnet 不勾
    p.defaultModel = 'deepseek-v4-pro';
    localStorage.setItem(L.LS_PROVIDERS, JSON.stringify(st));
    L.RESET_PROVIDERS_FOR_TEST();
    const after = L.getProviders().list.find((x) => x.id === 'deepseek-official');
    return { models: after.models, availableModels: after.availableModels, defaultModel: after.defaultModel };
  })()
  )
`));
check('可只保留勾选的模型（多选）', JSON.stringify(multi.models) === JSON.stringify(['deepseek-flash', 'deepseek-v4-pro']), JSON.stringify(multi.models));
check('未勾选的模型仍留在候选列表里', multi.availableModels.includes('relay-sonnet'), JSON.stringify(multi.availableModels));
check('默认模型独立于勾选', multi.defaultModel === 'deepseek-v4-pro');

// ---- 3. 镜像到官方槽位 ----
console.log('\n[3] 提供方镜像到官方读取的槽位');
const mirror = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;
    L.setActiveProvider('deepseek-official');
    return {
      base: localStorage.getItem('chat-demo:api-base'),
      key: localStorage.getItem('chat-demo:api-key'),
      model: localStorage.getItem(L.LS_MODEL),
      effBase: L.effectiveApiBase(),
      effModel: L.effectiveModel()
    };
  })()
  )
`));
check('地址镜像正确', mirror.base === BASE, JSON.stringify(mirror));
check('密钥镜像正确', mirror.key === 'sk-official', JSON.stringify(mirror));
check('模型镜像正确', mirror.model === 'deepseek-v4-pro', JSON.stringify(mirror));
check('生效地址计算正确', mirror.effBase === BASE, mirror.effBase);
check('生效模型计算正确', mirror.effModel === 'deepseek-v4-pro', mirror.effModel);

// ---- 4. 模型切换器（输入框旁）----
console.log('\n[4] 输入框旁的模型切换器');
const composer = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    L.mountComposer();
    const el = document.getElementById('ls-composer-model');
    return el ? { mounted: true, label: L.getComposerLabel(), text: el.textContent } : { mounted: false };
  })())
`));
check('切换器已挂载到输入区', composer.mounted === true, JSON.stringify(composer));

const menu = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    L.openComposerMenu(true);
    const m = document.getElementById('ls-composer-menu');
    if (!m) return { open: false, allMenus: document.querySelectorAll('.ls-composer-menu').length };
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    return {
      open: true,
      items: Array.from(m.querySelectorAll('.ls-menu-item')).map((x) => x.textContent),
      providers: Array.from(m.querySelectorAll('.ls-menu-provider')).map((x) => x.textContent),
      position: cs.position,
      parentIsBody: m.parentElement === document.body,
      // 关键：菜单不能超出视口（之前的 bug 是被输入框裁掉）
      fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
    };
  })())
`));
check('菜单能打开', menu.open === true, JSON.stringify(menu));
check('菜单挂在 body 上（脱离输入框 overflow 裁剪）', menu.parentIsBody === true, JSON.stringify(menu));
check('菜单用 fixed 定位', menu.position === 'fixed', menu.position);
check('菜单完整落在视口内（不再被截断）', menu.fullyVisible === true, JSON.stringify(menu.rect));
check('菜单列出了当前提供方的模型', JSON.stringify(menu.items) === JSON.stringify(['deepseek-flash', 'deepseek-v4-pro']), JSON.stringify(menu.items));
check('菜单列出了两个提供方', (menu.providers || []).length === 2, JSON.stringify(menu.providers));

// 滚动后菜单应跟随而不是消失
const scrolled = JSON.parse(await ev(`
  JSON.stringify((() => {
    const before = document.getElementById('ls-composer-menu');
    if (!before) return { open: false };
    window.dispatchEvent(new Event('scroll'));
    const after = document.getElementById('ls-composer-menu');
    return { stillOpen: !!after, sameNode: before === after };
  })())
`));
check('页面滚动后菜单不会消失', scrolled.stillOpen === true, JSON.stringify(scrolled));

// 菜单内部滚动不应把自己顶回顶部
const inner = JSON.parse(await ev(`
  JSON.stringify((() => {
    const m = document.getElementById('ls-composer-menu');
    if (!m) return { ok: false, why: 'no menu' };
    m.scrollTop = 50;
    const t1 = m.scrollTop;
    m.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { ok: true, before: t1, after: m.scrollTop };
  })())
`));
check('菜单内部滚动位置保持（不被顶回顶部）', inner.ok && inner.after === inner.before, JSON.stringify(inner));

// ---- 5. 自动同步触发（不发消息也能落盘）----
console.log('\n[5] 自动同步');
const auto = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;
    return {
      hasSchedule: typeof L.__scheduleAutoSync === 'function',
      autosyncFlag: localStorage.getItem('chat-demo:local-autosync')
    };
  })()
  )
`));
check('自动同步默认开启（未显式关闭）', auto.autosyncFlag !== 'false', String(auto.autosyncFlag));

// ---- 6. API Key 不会被打架式的空值覆盖（「Key 无效」的根因）----
//
// 场景：用户在应用自带界面里填了 Key（只写进 localStorage），桥接层并不知情。
// 如果提供方里的 Key 为空，旧实现会在保存设置时用空串覆盖掉可用的 Key，
// 之后每次启动都被判定「API Key 无效」。这里锁死该回归。
console.log('\n[6] API Key 不会被空值覆盖');
const keyFlow = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;

    // 1) 模拟「应用里已有可用 Key，但提供方没有 Key」
    localStorage.setItem('chat-demo:api-key', 'sk-real-working');
    const st = JSON.parse(localStorage.getItem(L.LS_PROVIDERS));
    const off = st.list.find((x) => x.id === 'deepseek-official');
    off.apiKey = '';                     // 提供方为空
    localStorage.setItem(L.LS_PROVIDERS, JSON.stringify(st));
    L.RESET_PROVIDERS_FOR_TEST();
    L.setActiveProvider('deepseek-official');

    // 2) 触发一次镜像（等于每次启动都会做的事）
    L.effectiveModel();
    const afterApply = localStorage.getItem('chat-demo:api-key');

    return { afterApply: afterApply };
  })()
  )
`));
check(
  '镜像提供方时不会清空应用里已有的 Key',
  keyFlow.afterApply === 'sk-real-working',
  JSON.stringify(keyFlow)
);

// 保存设置时，空 Key 不应覆盖已有 Key
const saveGuard = JSON.parse(await ev(`
  JSON.stringify(
  (() => {
    const L = window.__localstore;
    const st = JSON.parse(localStorage.getItem(L.LS_PROVIDERS));
    const off = st.list.find((x) => x.id === 'deepseek-official');
    off.apiKey = '';
    off.defaultModel = 'deepseek-v4-pro';
    localStorage.setItem(L.LS_PROVIDERS, JSON.stringify(st));
    L.RESET_PROVIDERS_FOR_TEST();
    L.applyActiveProvider ? L.applyActiveProvider(false) : null;
    return {
      storedKey: localStorage.getItem('chat-demo:api-key'),
      providerKey: L.getProviders().list.find((x) => x.id === 'deepseek-official').apiKey
    };
  })()
  )
`));
check(
  '提供方为空 Key 时不影响实际使用的 Key',
  saveGuard.storedKey === 'sk-real-working',
  JSON.stringify(saveGuard)
);

// ---- 7. 设置区块只出现在「通用设置」，不与「数据管理」串台 ----
//
// 官方两个标签页共用同一个内容容器 `.content-_85c1b`（靠切换子节点换页），
// 而弹窗默认可能停在「数据管理」。早期实现直接 append，导致区块挂到了
// 数据管理下、切页时又跟着显示，看起来两块内容混在一起。
console.log('\n[7] 设置区块不跨标签页串台');

const clickTab = async (kw) => ev(`
  (() => {
    const dlg = document.querySelector('.dialog-_85c1b');
    if (!dlg) return 'no-dialog';
    const el = Array.from(dlg.querySelectorAll('[class*=navItem]'))
      .find((x) => new RegExp(${JSON.stringify(kw)}).test(x.textContent || ''));
    if (!el) return 'no-tab';
    el.click();
    return 'clicked';
  })()
`);

const openForTabTest = await ev(`
  (() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => ['设置', 'Settings'].includes((x.getAttribute('aria-label') || '').trim()));
    if (b) { b.click(); return 'clicked'; }
    return 'notfound';
  })()
`);
await sleep(1500);

await clickTab('数据管理|Data');
await sleep(1200);
const onData = JSON.parse(await ev(`
  JSON.stringify((() => {
    const sec = document.getElementById('localstore-section');
    const dlg = document.querySelector('.dialog-_85c1b');
    return {
      sectionPresent: !!sec,
      sectionParent: sec && sec.parentElement ? sec.parentElement.className : null,
      hasExportRow: dlg ? Array.from(dlg.querySelectorAll('[class*=row-]')).some((x) => /导出所有历史对话|Export/.test(x.textContent || '')) : null
    };
  })())
`));
check('切到「数据管理」时区块被摘掉', onData.sectionPresent === false, JSON.stringify(onData));

await clickTab('通用设置|General');
await sleep(1500);
const onGeneral = JSON.parse(await ev(`
  JSON.stringify((() => {
    const sec = document.getElementById('localstore-section');
    const dlg = document.querySelector('.dialog-_85c1b');
    return {
      sectionPresent: !!sec,
      hasLocale: dlg ? !!dlg.querySelector('[aria-label="语言"], [aria-label="Language"]') : null,
      parentClass: sec && sec.parentElement ? sec.parentElement.className : null
    };
  })())
`));
check('切回「通用设置」时区块出现', onGeneral.sectionPresent === true, JSON.stringify(onGeneral));
check('区块挂在通用设置的内容容器里', onGeneral.parentClass === 'content-_85c1b', JSON.stringify(onGeneral));
check('区块单独存在（只有一份）', (await ev(`document.querySelectorAll('#localstore-section').length`)) === 1);

// ---- 7b. 提供方区块只列自定义提供方 ----
//
// 设计：官方那一路不再作为可编辑卡片列出。官方自带一个统一的 API Key
// 输入框（在「数据管理」里），再列一张官方卡片就会出现「同一个 Key 两处可改」
// 的困惑。所以本区块只列用户自己加的自定义提供方。
console.log('\n[7b] 提供方区块只列自定义提供方');
const cardDesign = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const sec = document.getElementById('localstore-section');
    const text = sec ? sec.textContent : '';
    return {
      sectionPresent: !!sec,
      // 官方提供方仍在数据层（内部逻辑要用），但不应有可编辑卡片
      officialInData: L.getProviders().list.some((p) => p.id === 'deepseek-official'),
      cardCount: sec ? sec.querySelectorAll('.ls-prov').length : -1,
      mentionsOfficial: text.indexOf('DeepSeek 官方') !== -1,
      // 该测试跑在英文界面下，所以中英两种文案都认
      hasOfficialHint: /统一配置|unified config/i.test(text)
    };
  })())
`));
console.log('    区块状态: ' + JSON.stringify(cardDesign));
check('区块已挂载（前置条件）', cardDesign.sectionPresent === true, JSON.stringify(cardDesign));
check('官方提供方仍在数据层（内部逻辑需要）', cardDesign.officialInData === true, JSON.stringify(cardDesign));
check('官方提供方没有可编辑卡片', cardDesign.cardCount === 1, JSON.stringify(cardDesign));
check('区块标注了当前用的是官方统一配置', cardDesign.hasOfficialHint === true, JSON.stringify(cardDesign));

// ---- 8. 官方「数据管理」里的 Key 编辑框与提供方对账 ----
//
// 官方在数据管理标签页自带一个 API Key 编辑框，提交后直接写
// `chat-demo:api-key`，桥接层收不到通知；而桥接层在通用设置里又给每个提供方
// 各存了一份 Key。两处编辑同一槽位，不同步就会互相覆盖（表现为「Key 无效」）。
console.log('\n[8] 官方面板改 Key 后与提供方对账');

const keyPanelSync = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    // 模拟用户在官方「数据管理」面板里提交了一个新 Key
    localStorage.setItem('chat-demo:api-key', 'sk-changed-in-official-panel');
    L.reconcileKey();   // 正常由轮询触发
    const p = L.getProviders().list.find((x) => x.id === 'deepseek-official');
    return { providerKey: p.apiKey };
  })())
`));
check(
  '官方面板改的 Key 会被采纳进提供方',
  keyPanelSync.providerKey === 'sk-changed-in-official-panel',
  JSON.stringify(keyPanelSync)
);

// 槽位被清空时不应反过来覆盖提供方（避免把用户刚清空的动作又填回）
const cleared = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    localStorage.setItem('chat-demo:api-key', '');
    L.reconcileKey();
    const p = L.getProviders().list.find((x) => x.id === 'deepseek-official');
    return { providerKey: p.apiKey };
  })())
`));
check(
  '清空槽位不会把 Key 又填回去',
  cleared.providerKey === 'sk-changed-in-official-panel',
  JSON.stringify(cleared)
);

// ---------------------------------------------------------------------------
// 品牌外观层：侧栏 logo、鲸鱼图标、开屏标语随机化、提供方名称
//
// 这一层的做法容易踩两个坑，都在这里锁住：
//   1. 伪元素不显式写 display，计算值会落到 none，图标完全不出现；
//   2. 开屏标语不能直接改官方那个文本节点 —— React 下一次渲染会写回原文，
//      必须另插一个自己的节点承载文案，并把官方文字用 font-size:0 收起。
// ---------------------------------------------------------------------------
const brand = JSON.parse(await ev(`
  JSON.stringify((() => {
    const out = {};
    out.htmlClass = document.documentElement.className;
    out.cssLoaded = !!document.getElementById('localstore-brand-css');

    // 侧栏标题：文字被收起（font-size:0），背景换成 logo.svg
    const name = document.querySelector('.appName-ac14ac');
    if (name) {
      const c = getComputedStyle(name);
      out.logo = { fontSize: c.fontSize,
        bg: c.backgroundImage.split('/').pop().replace(/["')]+$/, ''),
        w: Math.round(name.getBoundingClientRect().width),
        h: Math.round(name.getBoundingClientRect().height) };
    }

    // 欢迎语前的小鲸鱼
    const g = document.querySelector('[class*="greeting-"]');
    if (g) {
      const b = getComputedStyle(g, '::before');
      out.greetWhale = { display: b.display, w: b.width, h: b.height,
        mask: (b.webkitMaskImage || b.maskImage || '').split('/').pop().replace(/["')]+$/, '') };
      out.greeting = { ownFontSize: getComputedStyle(g).fontSize,
        hasClass: g.classList.contains('ls-greeting-random') };
      const span = g.querySelector('[data-ls-greeting]');
      out.greeting.spanText = span ? span.textContent : null;
      out.greeting.spanFontSize = span ? getComputedStyle(span).fontSize : null;
      // 官方文字节点必须不占宽度，否则会和新文案叠字
      out.greeting.officialWidth = (function () {
        if (!g.firstChild || g.firstChild.nodeType !== 3) return null;
        const rng = document.createRange(); rng.selectNodeContents(g.firstChild);
        return Math.round(rng.getBoundingClientRect().width);
      })();
    }

    // 收起按钮旁的小鲸鱼
    const cb = document.querySelector('.top-ac14ac button[aria-label]');
    if (cb) {
      const b = getComputedStyle(cb, '::before');
      out.btnWhale = { display: b.display, w: b.width, h: b.height, left: b.left,
        mask: (b.webkitMaskImage || b.maskImage || '').split('/').pop().replace(/["')]+$/, '') };
    }

    // 提供方名称
    out.officialName = window.__localstore.getProviders().list
      .find((p) => p.id === 'deepseek-official').name;
    out.hasOldLabel = document.body.textContent.indexOf('官方（统一配置）') >= 0;
    return out;
  })())
`));
check('品牌样式层已加载并挂上 .ls-brand', brand.cssLoaded && /(^|\s)ls-brand(\s|$)/.test(brand.htmlClass),
  JSON.stringify({ css: brand.cssLoaded, cls: brand.htmlClass }));
// 只断言「确实换成了 logo、文字确实收起、盒子有实际尺寸」，
// **不要写死具体宽高** —— logo 是用户会自己替换的素材，尺寸随时会调。
check('侧栏标题被换成 logo.svg（文字收起 + 背景图）',
  brand.logo && brand.logo.fontSize === '0px' && brand.logo.bg === 'logo.svg' &&
  brand.logo.h >= 20 && brand.logo.w >= 60,
  JSON.stringify(brand.logo));
check('欢迎语左边有鲸鱼图标（且确实会渲染：display 不是 none）',
  brand.greetWhale && brand.greetWhale.display !== 'none' &&
  parseFloat(brand.greetWhale.w) > 0 && brand.greetWhale.mask === 'whale.svg',
  JSON.stringify(brand.greetWhale));
check('收起按钮左边有鲸鱼图标（且确实会渲染）',
  brand.btnWhale && brand.btnWhale.display !== 'none' &&
  parseFloat(brand.btnWhale.w) > 0 && brand.btnWhale.mask === 'whale.svg',
  JSON.stringify(brand.btnWhale));
// 折叠态那两个按钮（打开边栏 / 开启新对话）各有一个鲸鱼，
// 且都不能伸到屏外（left 为负说明被裁掉了）。实测踩过：-36px 会跑到 x=-17。
// 先收起侧栏才能看到那组按钮。
await ev(`(function(){ var b=document.querySelector('.top-ac14ac button[aria-label]'); if(b) b.click(); })()`);
await sleep(1400);
const colWhales2 = JSON.parse(await ev(`
  JSON.stringify((function(){
    const out = [];
    document.querySelectorAll('.collapsed-ac14ac button[aria-label]').forEach(function(b){
      const cs = getComputedStyle(b, '::before');
      const r = b.getBoundingClientRect();
      const left = r.left + parseFloat(cs.left || 0);
      out.push({ aria: b.getAttribute('aria-label'), display: cs.display,
        w: parseFloat(cs.width), h: parseFloat(cs.height),
        screenLeft: Math.round(left), screenRight: Math.round(left + (parseFloat(cs.width) || 0)),
        mask: (cs.webkitMaskImage || cs.maskImage || '').split('/').pop().replace(/["')]+$/, '') });
    });
    return out;
  })())
`));
check('折叠态两个按钮各有鲸鱼，且都完整在屏内（不被裁）',
  colWhales2.length === 2 &&
  colWhales2.every((w) => w.display !== 'none' && w.w > 0 && w.mask === 'whale.svg' &&
    w.screenLeft >= 0 && w.screenRight <= 261),
  JSON.stringify(colWhales2));
// 回归：直接改官方文本节点会被 React 写回（实测 7 秒内一次都没留住），
// 所以必须是自己插入的节点承载文案 + 官方文字 font-size:0 收起。
check('开屏标语用自定义节点承载，官方文字被收起',
  brand.greeting && brand.greeting.hasClass && brand.greeting.ownFontSize === '0px' &&
  !!brand.greeting.spanText && brand.greeting.spanFontSize === '24px' &&
  brand.greeting.officialWidth === 0,
  JSON.stringify(brand.greeting));
// 标语必须来自用户给定的候选（不是官方原文）：固定池 8 条 +
// 时段问候 4 条（前缀按当前时段替换）。
const GREETING_POOL = [
  '你好，有什么我能帮你的吗？',
  '你好，我能帮什么忙吗？',
  '你好，让我们开始聊天吧',
  '欢迎回来，想从哪里开始？',
  '欢迎回来，随时开始吧',
  '嗨！今天想聊些什么？',
  '随时开始吧',
  '今天有什么可以帮到你？'
];
/** 时段问候里逗号后面的那一半 */
const GREETING_TAILS = [
  '今天有什么计划？',
  '开始聊天吧',
  '今天想聊些什么？',
  '今天想做点什么？'
];
const isPooledGreeting = (s) => {
  if (!s) return false;
  if (GREETING_POOL.indexOf(s) !== -1) return true;
  // 时段问候：前缀 ∈ {凌晨好,早上好,中午好,下午好,晚上好} + 全角逗号 + 尾巴之一
  const m = /^(凌晨好|早上好|中午好|下午好|晚上好)，(.+)$/.exec(s);
  return !!m && GREETING_TAILS.indexOf(m[2]) !== -1;
};
check('开屏标语来自用户给定的候选（不是官方原文）',
  isPooledGreeting(brand.greeting && brand.greeting.spanText),
  JSON.stringify(brand.greeting && brand.greeting.spanText));
check('官方提供方名称已改为 DeepSeek',
  brand.officialName === 'DeepSeek' && !brand.hasOldLabel,
  JSON.stringify({ name: brand.officialName, hasOldLabel: brand.hasOldLabel }));

// 标语确实会变：连开几次，至少出现两种不同文案
const seen = new Set();
for (let i = 0; i < 6; i++) {
  await cdp.send('Page.reload');
  await sleep(2600);
  for (let k = 0; k < 30; k++) {
    if (await ev(`!!document.querySelector('[data-ls-greeting]')`)) break;
    await sleep(250);
  }
  const txt = await ev(`(function(){var s=document.querySelector('[data-ls-greeting]');return s?s.textContent:'';})()`);
  if (txt) seen.add(txt);
}
check('多次打开会出现不同的开屏标语（确实是随机）',
  seen.size >= 2, '出现过 ' + seen.size + ' 种: ' + [...seen].join(' / '));
check('随机出现的标语都在候选池里',
  [...seen].every(isPooledGreeting), JSON.stringify([...seen]));

cdp.close(); chrome.kill(); server.close();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
