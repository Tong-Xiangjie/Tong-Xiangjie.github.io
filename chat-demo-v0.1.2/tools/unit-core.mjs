#!/usr/bin/env node
/**
 * unit-core.mjs —— 针对纯逻辑函数的单元测试（不需要浏览器）。
 *
 * 被测函数：linearMessages / sessionToMirror / renderMarkdown
 * 这些函数决定「导出到文件夹的内容对不对」，是最容易出错的地方。
 *
 * 做法：在 vm 沙箱里加载 localstore-bridge.js，用最小 DOM shim 让它跑起来，
 * 然后通过它挂到 window.__localstore 上的调试接口拿到函数。
 *
 * 用法：node tools/unit-core.mjs
 */

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail !== undefined ? '  → ' + detail : ''}`);
    failed++;
  }
}
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? undefined : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// 最小 DOM / 浏览器 shim
// ---------------------------------------------------------------------------

function makeShim() {
  const noop = () => {};
  const fakeNode = () => ({
    style: {},
    className: '',
    id: '',
    textContent: '',
    childElementCount: 0,
    children: [],
    appendChild: noop,
    append: noop,
    remove: noop,
    replaceWith: noop,
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    insertBefore: noop,
    firstChild: null
  });

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  const document = {
    readyState: 'complete',
    head: fakeNode(),
    body: fakeNode(),
    documentElement: fakeNode(),
    createElement: fakeNode,
    createTextNode: () => fakeNode(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  };

  const window = {
    localStorage,
    document,
    isSecureContext: true,
    // 关键：故意不提供 showDirectoryPicker，让 supportsFs 为 false，
    // 这样 boot() 不会去碰文件夹，纯逻辑测试不受影响。
    navigator: { language: 'zh-CN' },
    location: {
      reload: noop,
      hash: '',
      pathname: '/',
      search: ''
    },
    history: { replaceState: noop },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: false }),
    addEventListener: noop,
    setTimeout,
    clearTimeout,
    console,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Set,
    Map,
    Promise,
    JSON,
    Date,
    Math,
    String,
    Number,
    Object,
    Array,
    Error,
    TextDecoder,
    Response: globalThis.Response,
    fetch: globalThis.fetch
  };
  window.window = window;

  return { window, document, localStorage };
}

// ---------------------------------------------------------------------------
// 加载 bridge
// ---------------------------------------------------------------------------

const shim = makeShim();
const sandbox = {
  window: shim.window,
  document: shim.document,
  localStorage: shim.localStorage,
  navigator: shim.window.navigator,
  console: { log() {}, warn() {}, error: console.error },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  indexedDB: undefined, // boot() 会跳过 IDB 相关逻辑
  IDBObjectStore: undefined,
  MutationObserver: shim.window.MutationObserver,
  location: shim.window.location,
  history: shim.window.history,
  requestAnimationFrame: shim.window.requestAnimationFrame,
  matchMedia: shim.window.matchMedia,
  File: globalThis.File,
  Blob: globalThis.Blob,
  TextDecoder,
  TextEncoder,
  URL,
  Promise,
  Set,
  Map,
  JSON,
  Date,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  TypeError,
  isNaN,
  parseInt,
  parseFloat
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

const source = readFileSync(join(ROOT, 'localstore-bridge.js'), 'utf8');
vm.createContext(sandbox);

try {
  vm.runInContext(source, sandbox, { filename: 'localstore-bridge.js' });
} catch (e) {
  console.log('bridge 在沙箱中加载失败: ' + e.message);
  process.exit(1);
}

// boot() 是异步的，等一拍让它把 __localstore 挂上
await new Promise((r) => setTimeout(r, 200));

const api = shim.window.__localstore;
if (!api) {
  console.log('未能获取 window.__localstore，shim 不完整');
  process.exit(1);
}

const { linearMessages, sessionToMirror, renderMarkdown } = api;
if (!linearMessages || !sessionToMirror || !renderMarkdown) {
  console.log('缺少被测函数');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 测试数据：带分支的消息树
// ---------------------------------------------------------------------------

const NOW = 1700000000000;

function makeSession() {
  return {
    id: 'sess-1',
    title: '测试对话',
    createdAt: NOW - 10000,
    updatedAt: NOW,
    rootMessageId: 'm1',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '帮我写个正则',
        files: [],
        createdAt: NOW - 10000,
        parentId: null,
        selectedChildId: 'm2'
      },
      {
        id: 'm2',
        role: 'assistant',
        model: 'deepseek-flash',
        serverModel: 'deepseek-v4-pro',
        createdAt: NOW - 5000,
        parentId: 'm1',
        selectedChildId: null,
        blocks: [{ type: 'text', text: '这是被选中的回答' }]
      },
      {
        id: 'm3',
        role: 'assistant',
        model: 'deepseek-flash',
        createdAt: NOW - 8000,
        parentId: 'm1',
        selectedChildId: null,
        blocks: [{ type: 'text', text: '这是未选中的旧版本' }]
      }
    ]
  };
}

console.log('\n=== 纯逻辑单元测试 ===\n');

// --- linearMessages ---
console.log('linearMessages（对话树 → 当前显示路径）');
const s = makeSession();
const linear = linearMessages(s);
eq('沿 selectedChildId 只取出被选中分支（2 条）', linear.map((m) => m.id), ['m1', 'm2']);

const noTree = { id: 'x', messages: [{ id: 'a', role: 'user', content: 'hi' }, { id: 'b', role: 'assistant', content: 'yo' }] };
eq('无树信息时退化为数组顺序', linearMessages(noTree).map((m) => m.id), ['a', 'b']);

// 链式多轮
const chain = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'b', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: 'c', parentId: 'a' },
    { id: 'c', role: 'user', selectedChildId: 'd', parentId: 'b' },
    { id: 'd', role: 'assistant', selectedChildId: null, parentId: 'c' }
  ]
};
eq('多轮链式遍历完整', linearMessages(chain).map((m) => m.id), ['a', 'b', 'c', 'd']);

// 断链兜底：不能丢消息
const broken = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'b', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: null, parentId: 'a' },
    { id: 'orphan', role: 'assistant', selectedChildId: null, parentId: 'ghost' }
  ]
};
const brokenOut = linearMessages(broken);
check('断链时兜底补回孤立消息（不丢内容）', brokenOut.length === 3, `实际 ${brokenOut.length}`);

// 环状防护
const cyclic = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'b', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: 'a', parentId: 'a' }
  ]
};
const cycOut = linearMessages(cyclic);
check('环形引用不会死循环', cycOut.length >= 2 && cycOut.length <= 2, `实际 ${cycOut.length}`);

eq('空会话返回空数组', linearMessages({ messages: [] }), []);
eq('缺 messages 字段不报错', linearMessages({}), []);

// 回归测试：同级未选中分支不得混入可见对话
// （它们只应存在于完整 JSON 树里；官方 module 3494 同样会跳过）
const siblings = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'b', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: null, parentId: 'a' },
    { id: 'c', role: 'assistant', selectedChildId: null, parentId: 'a' }
  ]
};
check(
  '同级未选中分支不混入对话',
  linearMessages(siblings).map((m) => m.id).join(',') === 'a,b',
  linearMessages(siblings).map((m) => m.id).join(',')
);

// 重复 id 也不得导致误补
const dupIds = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'b', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: null, parentId: 'a' },
    { id: 'b', role: 'assistant', selectedChildId: null, parentId: 'a' }
  ]
};
check('重复 id 不会把未选中分支混入对话', linearMessages(dupIds).length === 2);

// 真正走不到的消息（数据损坏）仍要被兜底补回，避免丢内容
const dangling = {
  rootMessageId: 'a',
  messages: [
    { id: 'a', role: 'user', selectedChildId: 'MISSING', parentId: null },
    { id: 'b', role: 'assistant', selectedChildId: null, parentId: 'a' },
    { id: 'orphan', role: 'assistant', selectedChildId: null, parentId: 'ghost' }
  ]
};
const danglingOut = linearMessages(dangling).map((m) => m.id);
check('悬空 selectedChildId 时兜底补回不可达消息', danglingOut.includes('orphan'), danglingOut.join(','));
check('悬空链接也不会死循环/重复', new Set(danglingOut).size === danglingOut.length, danglingOut.join(','));

// --- sessionToMirror ---
console.log('\nsessionToMirror（导出结构）');
const mirror = sessionToMirror(makeSession());
eq('schema 正确', mirror.schema, 'chat-demo-mirror/session@1');
eq('保留全部消息（含未选分支）', mirror.messages.length, 3);
eq('conversation 为选中路径', mirror.conversation.map((m) => m.id), ['m1', 'm2']);
eq('汇总真实模型优先于固定值', mirror.models, ['deepseek-v4-pro']);
eq('messageCount 为全量', mirror.messageCount, 3);

// 模型去重与「可见对话 vs 完整树」的区分
const multi = makeSession();
multi.messages[1].serverModel = 'deepseek-flash'; // 被选中的回答
multi.messages[2].serverModel = 'deepseek-v4-pro'; // 未选中的旧分支
eq('models 只统计当前显示的对话', sessionToMirror(multi).models, ['deepseek-flash']);
eq(
  'modelsInTree 覆盖含未选中分支的全部模型',
  sessionToMirror(multi).modelsInTree,
  ['deepseek-flash', 'deepseek-v4-pro']
);

// 只有固定 model 时也要有值
const noServer = makeSession();
delete noServer.messages[1].serverModel;
delete noServer.messages[2].serverModel;
eq('无 serverModel 时回退到 model 字段', sessionToMirror(noServer).models, ['deepseek-flash']);

// --- renderMarkdown ---
console.log('\nrenderMarkdown（人类可读输出）');
const md = renderMarkdown(makeSession());
check('含一级标题', md.startsWith('---\n') && md.includes('# 测试对话'), md.slice(0, 40));
check('front-matter 含 session_id', md.includes('session_id: sess-1'));
check('用户消息带「我」标注', /## 我/.test(md));
check('助手消息带模型标注', md.includes('`deepseek-v4-pro`'), '未找到模型标注');
check('含助手回答正文', md.includes('这是被选中的回答'));
check('不含未选中的旧版本', !md.includes('这是未选中的旧版本'));
check('助手消息带时间戳', /## DeepSeek\s+·\s+\d{4}-\d{2}-\d{2}/.test(md), '未找到时间戳');
check('文件末尾无多余空行堆积', !/\n{3,}/.test(md));

// 附件渲染
const withFiles = makeSession();
withFiles.messages[0].files = [
  { id: 'f1', name: 'photo.png', size: 2048, isImage: true },
  { id: 'f2', name: 'doc.pdf', size: 4096, isImage: false }
];
const md2 = renderMarkdown(withFiles);
check('附件被渲染为列表项', md2.includes('- [图片] photo.png') && md2.includes('- [文件] doc.pdf'), '附件缺失');
check('附件标注了大小', md2.includes('2048 字节'));

// 深度思考块渲染
const withThinking = makeSession();
withThinking.messages[1].blocks = [
  { type: 'thinking', thinking: '我在思考…' },
  { type: 'text', text: '结论' }
];
const md3 = renderMarkdown(withThinking);
check('thinking 块渲染为折叠区', md3.includes('<details><summary>深度思考</summary>') && md3.includes('我在思考…'));
check('thinking 后仍输出正文', md3.includes('结论'));

// content 为字符串的旧数据
const legacy = makeSession();
legacy.messages[1].blocks = undefined;
legacy.messages[1].content = '字符串形式的旧回答';
check('兼容 content 为字符串的旧数据', renderMarkdown(legacy).includes('字符串形式的旧回答'));

// 空标题
const untitled = makeSession();
untitled.title = null;
check('标题为空时不崩溃', renderMarkdown(untitled).includes('# null') === false);

// ---------------------------------------------------------------------------
// API 根地址归一化
// ---------------------------------------------------------------------------
// 应用自己会拼 /anthropic/v1/... 与 /models，所以存的必须是裸根地址。
// 这里覆盖各种用户实际会粘贴的写法。

const normalizeBase = api.normalizeBase;
if (!normalizeBase) {
  console.log('缺少 normalizeBase');
  process.exit(1);
}

const baseCases = [
  ['https://api.deepseek.com', 'https://api.deepseek.com'],
  ['https://api.deepseek.com/', 'https://api.deepseek.com'],
  ['https://llmapi.paratera.com', 'https://llmapi.paratera.com'],
  ['https://llmapi.paratera.com/', 'https://llmapi.paratera.com'],
  // 中转站文档里最常见的写法：带 /anthropic
  ['https://llmapi.paratera.com/anthropic', 'https://llmapi.paratera.com'],
  ['https://llmapi.paratera.com/anthropic/', 'https://llmapi.paratera.com'],
  ['https://llmapi.paratera.com/anthropic/v1', 'https://llmapi.paratera.com'],
  ['https://llmapi.paratera.com/Anthropic', 'https://llmapi.paratera.com'],
  // 只有结尾的那一段算路径，域名里含 anthropic 不能被误伤
  ['https://anthropic-proxy.example.com', 'https://anthropic-proxy.example.com'],
  ['https://anthropic.example.com/v1', 'https://anthropic.example.com/v1'],
  // 带自定义路径的挂载点要保留
  ['https://host.example.com/api', 'https://host.example.com/api'],
  ['  https://host.example.com/api/  ', 'https://host.example.com/api']
];

baseCases.forEach(([input, want]) => {
  const got = normalizeBase(input);
  check(`归一化 ${JSON.stringify(input)}`, got === want, `期望 ${want}，实际 ${got}`);
});

check('空值与 null 归一化为空串',
  normalizeBase('') === '' && normalizeBase(null) === '' && normalizeBase(undefined) === '');

// 组合验证：归一化后的根地址拼出的上传路径不能出现重复的 /anthropic
const uploadPath = normalizeBase('https://llmapi.paratera.com/anthropic') + '/anthropic/v1/files';
check('归一化后上传路径不重复 /anthropic',
  uploadPath === 'https://llmapi.paratera.com/anthropic/v1/files', uploadPath);
check('归一化后上传路径不含 /anthropic/anthropic',
  uploadPath.indexOf('/anthropic/anthropic') === -1, uploadPath);

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
