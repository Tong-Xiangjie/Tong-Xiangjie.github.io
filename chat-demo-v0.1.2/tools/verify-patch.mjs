#!/usr/bin/env node
/**
 * verify-patch.mjs —— 校验补丁是否正确应用。
 * 在 apply-patch.mjs 之后运行；任何一项不通过即以非零码退出。
 *
 * 用法：node tools/verify-patch.mjs
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAIN_JS = join(ROOT, 'static', 'js', 'main.6fd9c886.js');
const INDEX_HTML = join(ROOT, 'index.html');
const BRIDGE = join(ROOT, 'localstore-bridge.js');
const MOTION_CSS = join(ROOT, 'localstore-motion.css');

// 桥接标签带内容哈希做缓存击穿，所以这里用「前缀出现次数」判定
const BRIDGE_TAG = '<script src="localstore-bridge.js';
const API_MARKER = '__CHAT_API_BASE__';
const MODEL_MARKER = 'chat-demo:model';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? '  → ' + detail : ''}`);
    failed++;
  }
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

console.log('\n=== 补丁校验 ===\n');

// --- index.html ---
const html = readFileSync(INDEX_HTML, 'utf8');
const htmlSize = statSync(INDEX_HTML).size;

check('index.html 存在且非空', htmlSize > 0);
check('bridge 标签恰好注入 1 次', countOccurrences(html, BRIDGE_TAG) === 1,
  `实际 ${countOccurrences(html, BRIDGE_TAG)} 次`);
check('bridge 标签位于 main bundle 之前',
  html.indexOf(BRIDGE_TAG) < html.indexOf('static/js/main.6fd9c886.js'));
check('UTF-8 无替换字符（无乱码）', !html.includes('\uFFFD'));
check('站点标题已改为目标标题',
  /<title>DeepSeek - 探索未至之境<\/title>/.test(html));
check('main bundle 引用恰好 1 次',
  countOccurrences(html, 'static/js/main.6fd9c886.js') === 1);

// --- main bundle ---
const bundle = readFileSync(MAIN_JS, 'utf8');
check('bundle 含 API 地址读取逻辑', bundle.includes('chat-demo:api-base'));
check('bundle 中 API 覆盖标记恰好 1 处',
  countOccurrences(bundle, API_MARKER) === 1,
  `实际 ${countOccurrences(bundle, API_MARKER)} 次`);
check('官方地址仍作为回退保留',
  bundle.includes('return window.__CHAT_API_BASE__||"https://api.deepseek.com"'));
// 关键回归：g 必须仍然是 `${m}/anthropic/v1`，而 m 不能自带 /anthropic。
// 否则文件上传会变成 /anthropic/anthropic/v1/files（真实踩过的坑）。
check('g 仍按原始形式拼接（不重复 /anthropic）',
  bundle.includes(',g=`${m}/anthropic/v1`;'));
check('m 会剥掉结尾的 /anthropic',
  bundle.includes('.replace(/\\/anthropic$/i,"")'));
check('不再存在写死的单一常量赋值',
  !bundle.includes('let m="https://api.deepseek.com",g='));

// --- 默认模型补丁 ---
// 取值器 ec0() 读 localStorage；三处调用点显式调用它：
//   model:ec0() / model:t.model??ec0() / model:a.model??ec0()
check('bundle 含模型选择读取逻辑', bundle.includes('chat-demo:model'));
check('模型取值器 ec0 已定义', bundle.includes(',ec0=function(){'));
check('取值器仍以官方模型回退', bundle.includes('return ec},ed={level:"high"}'));
check('官方常量 ec 仍保留', bundle.includes('let ec="deepseek-flash"'));
check('三处调用点都改为调用取值器',
  countOccurrences(bundle, 'ec0()') === 3,
  `实际 ${countOccurrences(bundle, 'ec0()')} 次`);
check('新建助手消息处使用取值器',
  bundle.includes('model:ec0(),thinking:e,search:t,prefix:!0'));
check('发请求处使用取值器', bundle.includes('model:t.model??ec0()'));
check('重新生成处使用取值器', bundle.includes('model:a.model??ec0()'));
// 关键回归：全库里 "ec" 还有 3 处无关出现（React 命名空间函数、Prism 语言数据），
// 若哪天改成全局正则替换，这里会立刻发现。
check('未误伤 React/Prism 里同名的 ec',
  countOccurrences(bundle, 'function ec(e){switch(e){case"svg"') === 1);
// 不得出现被重复打补丁产生的 `ec0()0()`
check('没有被重复打补丁（无 ec0()0()）', !bundle.includes('ec0()0()'));

// --- API Key 现读补丁 ---
// 官方把 API Key 在启动时读进 store，之后所有请求都用那份快照，
// 导致「换提供方必须刷新页面」。补丁加一个 k0() 每次现读 localStorage。
check('API Key 取值器 k0 已定义', bundle.includes('k0=function(){'));
check('k0 定义恰好 1 处',
  countOccurrences(bundle, 'k0=function(){') === 1,
  `实际 ${countOccurrences(bundle, 'k0=function(){')} 次`);
check('k0 优先读 localStorage 里的 Key',
  bundle.includes('localStorage.getItem("chat-demo:api-key")'));
check('k0 仍以 store 里的旧值为回退',
  bundle.includes('if(ls&&ls.apiKey)return ls.apiKey'));
check('5 处 Key 读取点都改为调用 k0()',
  countOccurrences(bundle, 'k0()') === 5,
  `实际 ${countOccurrences(bundle, 'k0()')} 次`);
check('发消息处改为现读 Key',
  bundle.includes('u.t0&&k0()||""'));
check('没有被重复打补丁（无 k0()k0()）', !bundle.includes('k0()k0()'));
// k0 若把自己的函数体写成含读取点模式，重复打补丁会破坏它
check('k0 函数体未混入被替换的模式',
  !bundle.includes('try{return u.t0&&k0()'));

// --- 输入框占位文案 ---
check('中文占位文案已替换',
  bundle.includes('chatInputPlaceholderChat:"给 DeepSeek 发送消息"'));
check('英文占位文案已替换',
  bundle.includes('chatInputPlaceholderChat:"Message DeepSeek"'));
check('旧的中文占位文案已不存在', !bundle.includes('"请输入消息"'));
check('旧的英文占位文案已不存在', !bundle.includes('"Enter a message"'));

// --- 桥接脚本 ---
check('localstore-bridge.js 存在', existsSync(BRIDGE));
check('localstore-motion.css 存在', existsSync(MOTION_CSS));
if (existsSync(MOTION_CSS)) {
  const motion = readFileSync(MOTION_CSS, 'utf8');
  check('动效样式含减弱动效分支', motion.includes('prefers-reduced-motion'));
  check('动效样式只挂 .ls-motion 下（可一键关闭）',
    (motion.match(/^\s*\.ls-motion\s/gm) || []).length +
      (motion.match(/\.ls-motion\s/g) || []).length > 30);
  // 只动 opacity/transform，不动 width/height（否则触发布局重排、掉帧）
  const animDecls = [...motion.matchAll(/animation:\s*([^;]+)/g)].map((m) => m[1]);
  check('动画不使用 width/height',
    !animDecls.some((d) => /width|height/.test(d)),
    animDecls.filter((d) => /width|height/.test(d)).join(' | '));
}
let bridgeSource = '';
if (existsSync(BRIDGE)) {
  const bridge = readFileSync(BRIDGE, 'utf8');
  bridgeSource = bridge;
  check('桥接脚本导出了调试接口', bridge.includes('window.__localstore'));
  check('桥接脚本 hook 了 IndexedDB', bridge.includes('IDBObjectStore.prototype'));
  check('桥接脚本使用 File System Access API',
    bridge.includes('showDirectoryPicker'));
  check('桥接脚本含上传诊断接口', bridge.includes('uploadLog: function'));
  check('桥接脚本含上传重试', bridge.includes('UPLOAD_ATTEMPTS'));
}

// --- index.html 里的桥接标签 ---
{
  const html = readFileSync(INDEX_HTML, 'utf8');
  const tags = html.match(/<script src="localstore-bridge\.js[^"]*"[^>]*><\/script>/g) || [];
  check('桥接标签恰好注入 1 次', tags.length === 1, `实际 ${tags.length} 次`);
  check('桥接标签带内容哈希（缓存击穿）',
    tags.length === 1 && /\?v=[0-9a-f]{8}"/.test(tags[0]),
    tags[0] || '(无)');
  // 哈希必须与当前桥接脚本内容一致，否则改完桥接层浏览器还在用旧的
  const hashMatch = tags.length === 1 && tags[0].match(/\?v=([0-9a-f]{8})"/);
  if (hashMatch && bridgeSource) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bridgeSource.length; i++) {
      h ^= bridgeSource.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    const want = h.toString(16).padStart(8, '0');
    check('桥接标签哈希与脚本内容一致', hashMatch[1] === want,
      `标签 ${hashMatch[1]}，实际内容 ${want}（请重跑 apply-patch.mjs）`);
  }
  check('不再有无哈希的旧标签', !html.includes('<script src="localstore-bridge.js"></script>'));
}

// --- 备份 ---
check('保留了 index.html.orig 备份', existsSync(INDEX_HTML + '.orig'));
check('保留了 bundle .orig 备份', existsSync(MAIN_JS + '.orig'));

console.log('');
if (failed) {
  console.log(`校验失败：${failed} 项未通过\n`);
  process.exit(1);
}
console.log('全部通过\n');
