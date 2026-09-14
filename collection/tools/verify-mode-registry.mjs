// ============================================================
// 板块注册表护栏
//
// 目的：让"新增一个板块/tab"这件事**永远**只是往 core.js 的 MODE_REGISTRY
// 加一条，而不是散到七八个文件里。这个脚本会在三种情况下失败：
//   ① 注册表条目缺字段 / 值不合法 / 两个板块抢同一个地址栏段名
//   ② 代码里又出现了"穷举板块名"的写法（MODE.NOTES || MODE.COINS 这种）
//   ③ 未注册的板块被静默当成某个已注册板块（旧代码的坑：会退化成硬币）
//
// 用法：node collection/tools/verify-mode-registry.mjs
//       退出码 0 = 通过
//
// 为什么值得存在：这套判断以前只在我脑子里。加板块时漏一处，症状是
// "能进去但搜索没反应 / 标签写错板块名 / 地址栏还原不了"这类半坏状态，
// 而且不会报错 —— 有本脚本就能在提交前拦住。
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let problems = 0;
let checks = 0;
function ok(msg) { checks++; console.log('  ✓ ' + msg); }
function bad(msg) { problems++; console.log('  ✗ ' + msg); }
function chk(cond, msg) { cond ? ok(msg) : bad(msg); }

const DIR = 'collection';
const core = readFileSync(path.join(DIR, 'core.js'), 'utf8');

// ---------- 从源码里抽出注册表相关实现 ----------
// 与 verify-b7.mjs 同一套抽取思路：抽真实源码，不写副本。
function extractBlockAt(src, start) {
    const open = src.indexOf('{', start);
    if (open < 0) throw new Error('未找到起始花括号');
    let depth = 0, i = open;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}
function extractFunction(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`未找到函数 ${name}`);
    return extractBlockAt(src, start);
}
function extractObjectConst(src, name) {
    const start = src.indexOf(`const ${name} = {`);
    if (start < 0) throw new Error(`未找到常量对象 ${name}`);
    return extractBlockAt(src, start) + ';';
}

console.log('=== 1. 注册表条目完整性 ===');

const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all' };
const SEARCH_MODE = { CLICK: 'click', REALTIME: 'realtime' };

// 依赖的最小状态（注册表的 containerKey 会读它们）
const sandbox = {
    MODE, VIEW, SEARCH_TYPE, SEARCH_MODE,
    console,
    window: {},
    currentMode: MODE.NOTES,
    currentView: VIEW.OVERVIEW,
    currentCategoryId: null, currentSubId: null,
    currentArticleView: VIEW.LIST, currentArticleIndex: -1,
    isSettingsMode: false,
    specialCategoryTree: null,
    categoryTree: [{ id: 'a', name: 'A', dataKey: 'aData' }],
    coinCategoryTree: [{ id: 'b', name: 'B', dataKey: 'bData' }],
    allDataKeys: ['aData'],
    coinAllDataKeys: ['bData'],
    articleSearchMode: 'title',
    getSpecialConfigs: () => [{ id: 'sp', name: 'SP', dataKey: 'spData' }]
};
vm.createContext(sandbox);
// ★ 用 IIFE 显式赋值回 sandbox：`const` 在 vm 里是**词法**绑定，不会挂到
//   context 对象上，直接 vm.runInContext 之后 sandbox.MODE_REGISTRY 是 undefined。
vm.runInContext(`(function(){
${[
    extractObjectConst(core, 'MODE_REGISTRY'),
    extractObjectConst(core, 'MODE_URL_SEGMENTS'),
    extractFunction(core, 'getModeDef'),
    extractFunction(core, 'modeLabel'),
    extractFunction(core, 'isCollectionMode'),
    extractFunction(core, 'modeFromUrlSegment')
].join('\n\n')}
this.MODE_REGISTRY = MODE_REGISTRY;
this.MODE_URL_SEGMENTS = MODE_URL_SEGMENTS;
this.getModeDef = getModeDef;
this.modeLabel = modeLabel;
this.isCollectionMode = isCollectionMode;
this.modeFromUrlSegment = modeFromUrlSegment;
}).call(this);`, sandbox, { filename: 'registry-extracted.js' });

const allModes = Object.values(MODE);
const registry = sandbox.MODE_REGISTRY;
chk(!!registry && typeof registry === 'object', '成功从 core.js 抽出 MODE_REGISTRY');
if (!registry) { console.log('\n🔴 抽不出注册表，后续检查无法进行'); process.exit(1); }

// ① 每个 MODE 常量都必须有注册表条目 —— 漏了就是"加了一半"的板块
for (const m of allModes) {
    chk(!!registry[m], `MODE.${m.toUpperCase()} 在注册表里有条目`);
}

// ② 字段合法性与必填项
for (const m of allModes) {
    const def = registry[m];
    if (!def) continue;
    const where = `[${m}]`;
    chk(typeof def.kind === 'string' && def.kind.length > 0, `${where} 有 kind`);
    chk(typeof def.label === 'string' && def.label.length > 0, `${where} 有中文名 label（界面文案都从这儿出）`);
    chk(typeof def.containerKey === 'function', `${where} 有 containerKey 函数（决定渲染进哪个滚动容器）`);
    chk(typeof def.urlSegment === 'string' && def.urlSegment.length > 0, `${where} 有 urlSegment（地址栏段名）`);
    chk(['full', 'own', 'none'].includes(def.search), `${where} search 取值合法（full/own/none）`);
    if (def.search === 'full') {
        chk(typeof def.allDataKeys === 'function', `${where} 是 full 搜索，必须能列出 allDataKeys`);
    }
    if (def.kind === 'collection') {
        chk(typeof def.tree === 'function', `${where} 是 collection 板块，必须有 tree`);
        chk(typeof def.map === 'string' && def.map.length > 0, `${where} 是 collection 板块，必须有数据表名 map`);
        chk(!!def.tabAction, `${where} 是 collection 板块，必须有 tabAction（tab 分派用）`);
    }
}

// ③ 段名不能撞车：两个板块共用一个段名 → 深链接必然解析错
const segSeen = {};
for (const m of allModes) {
    const def = registry[m];
    if (!def || !def.urlSegment) continue;
    if (segSeen[def.urlSegment]) {
        bad(`地址栏段名冲突："${def.urlSegment}" 同时属于 ${segSeen[def.urlSegment]} 和 ${m}`);
    } else {
        segSeen[def.urlSegment] = m;
    }
}
chk(Object.keys(segSeen).length === allModes.filter(m => registry[m]).length,
    `每个板块的 urlSegment 都唯一（共 ${Object.keys(segSeen).length} 个）`);

// ④ urlSegment 与 MODE_URL_SEGMENTS 必须一致（两处写重复了就会漂）
for (const m of allModes) {
    const def = registry[m];
    if (!def || !def.urlSegment) continue;
    chk(sandbox.modeFromUrlSegment(def.urlSegment) === m,
        `段名 "${def.urlSegment}" 能反向解析回 ${m}`);
}

console.log('\n=== 2. 未注册板块必须"安全退化"，不能变成别的板块 ===');

// 旧代码 `currentMode === MODE.NOTES ? a : b` 的坑：任何没被显式提到的板块
// 都会掉进 b 分支（硬币）。这条断言把那个行为永久钉死。
sandbox.currentMode = 'stamps_future';
chk(sandbox.getModeDef() === null, '未注册板块：getModeDef() 返回 null（不是悄悄返回别的板块）');
chk(sandbox.modeLabel() === 'stamps_future', '未注册板块：modeLabel() 回退成 mode 字符串本身，而不是显示成「硬币」');
chk(sandbox.isCollectionMode() === false, '未注册板块：不被当成 collection 板块');
chk(sandbox.modeFromUrlSegment('stamps_future') === null, '未注册段名：modeFromUrlSegment() 返回 null');

// 拿真实函数验证取树/取数也安全退化
vm.runInContext(`(function(){
${[
    extractFunction(core, 'getCategoryTree'),
    extractFunction(core, 'getAllDataKeys'),
    extractFunction(core, 'getData')
].join('\n\n')}
this.getCategoryTree = getCategoryTree;
this.getAllDataKeys = getAllDataKeys;
this.getData = getData;
}).call(this);`, sandbox, { filename: 'lookup-extracted.js' });

sandbox.window.DATA_MAP = { aData: [1] };
sandbox.window.COIN_DATA_MAP = { bData: [2] };
chk(sandbox.getCategoryTree() === null, '未注册板块：getCategoryTree() 返回 null（旧代码会返回硬币分类树）');
chk(Array.isArray(sandbox.getAllDataKeys()) && sandbox.getAllDataKeys().length === 0,
    '未注册板块：getAllDataKeys() 返回空数组（旧代码会返回硬币的全部 dataKey）');
chk(sandbox.getData('bData') === null, '未注册板块：getData() 取不到任何数据（旧代码会读到硬币数据）');

console.log('\n=== 3. "加一条注册表条目就够用"必须成立 ===');

// 模拟：往注册表里加一个全新板块，看各查询函数是否自动认它
sandbox.MODE_REGISTRY['stamps'] = {
    kind: 'collection',
    label: '邮票',
    tree: () => [{ id: 'cn', name: '中国邮票', dataKey: 'cnStampData' }],
    allDataKeys: () => ['cnStampData'],
    map: 'STAMP_DATA_MAP',
    urlSegment: 'stamps',
    containerKey: () => 'stamps_category_' + String(sandbox.currentSubId || sandbox.currentCategoryId || 'overview'),
    search: 'full',
    searcher: 'collection',
    tabAction: 'collection'
};
sandbox.MODE_URL_SEGMENTS['stamps'] = 'stamps';
sandbox.currentMode = 'stamps';
sandbox.currentView = VIEW.CATEGORY;
sandbox.currentCategoryId = 'cn';
sandbox.window.STAMP_DATA_MAP = { cnStampData: [{ name: '猴票' }] };

chk(sandbox.getModeDef() !== null, '新板块：getModeDef() 认得它');
chk(sandbox.modeLabel() === '邮票', '新板块：modeLabel() 直接给出「邮票」，无需任何额外改动');
chk(sandbox.isCollectionMode() === true, '新板块：自动被认成 collection 板块（存档/侧边栏流程自动生效）');
chk(sandbox.getCategoryTree() !== null && sandbox.getCategoryTree()[0].name === '中国邮票',
    '新板块：getCategoryTree() 自动返回它的分类树');
chk(sandbox.getAllDataKeys().length === 1, '新板块：getAllDataKeys() 自动返回它的 dataKey');
chk(sandbox.getData('cnStampData') !== null && sandbox.getData('cnStampData')[0].name === '猴票',
    '新板块：getData() 自动从它的数据表取数（map 字段说了算）');
chk(sandbox.getData('aData') === null, '新板块：**不会**串到纸币的数据');
chk(sandbox.getData('bData') === null, '新板块：**不会**串到硬币的数据');
chk(sandbox.modeFromUrlSegment('stamps') === 'stamps', '新板块：地址栏段名自动可解析');
chk(sandbox.MODE_REGISTRY['stamps'].containerKey() === 'stamps_category_cn',
    '新板块：containerKey() 决定自己的渲染容器');

console.log('\n=== 4. 代码里不得再出现"穷举板块名"的写法 ===');

// 只揪真正的穷举，不揪单个板块的特有逻辑（那些是领域判断，不是穷举）。
// 这类形状：`MODE.X || MODE.Y`、`MODE.X ? ... : ...`（二元假设）
const files = readdirSync(DIR).filter(f => f.endsWith('.js'));
const EXHAUSTIVE = [
    { re: /MODE\.(NOTES|COINS)\s*\|\|\s*currentMode\s*===\s*MODE\.(COINS|NOTES)/, what: 'NOTES||COINS 穷举' },
    { re: /currentMode\s*===\s*MODE\.(COINS|NOTES)\s*\|\|\s*currentMode\s*===\s*MODE\./, what: 'currentMode 穷举多个板块' },
    { re: /currentMode\s*===\s*MODE\.NOTES\s*\?\s*'/, what: "二元假设 '纸币' : '硬币'" },
    { re: /target\s*===\s*MODE\.(NOTES|COINS)\s*\|\|/, what: 'tab 分派穷举板块名' }
];
// 允许清单：这些位置是**领域逻辑**（某个板块特有的行为），不是"通用分叉"。
// 每一条都要写明理由，避免允许清单变成垃圾桶。
const ALLOW = [
    { file: 'core.js', why: '函数注释里引用旧写法作为反例，不是可执行代码' }
];
let offenders = [];
for (const f of files) {
    const src = readFileSync(path.join(DIR, f), 'utf8');
    const lines = src.split('\n');
    // 剥掉注释再判：既要处理 `// …` 行尾注释，也要处理块注释的续行（以 * 开头）。
    // 否则注释里引用旧写法当反例会被误报成违规代码。
    let inBlock = false;
    lines.forEach((line, i) => {
        let code = line;
        if (inBlock) {
            const end = code.indexOf('*/');
            if (end < 0) return;
            code = code.slice(end + 2);
            inBlock = false;
        }
        const bStart = code.indexOf('/*');
        if (bStart >= 0) {
            const bEnd = code.indexOf('*/', bStart + 2);
            if (bEnd < 0) { code = code.slice(0, bStart); inBlock = true; }
            else code = code.slice(0, bStart) + code.slice(bEnd + 2);
        }
        code = code.replace(/\/\/.*$/, '');
        // 注释里常常"引用"旧写法当反例（`//   \`target === MODE.NOTES || …\``），
        // 那种行首是 `//   \``，上面的规则已经剥掉了；这里再兜一层反引号引用，
        // 避免把文档当违规代码。
        code = code.replace(/`[^`]*`/g, '');
        if (!code.trim()) return;
        for (const { re, what } of EXHAUSTIVE) {
            if (re.test(code)) {
                if (ALLOW.some(a => a.file === f)) return;
                offenders.push(`${f}:${i + 1}  ${what}  →  ${line.trim().slice(0, 80)}`);
            }
        }
    });
}
if (offenders.length === 0) {
    ok('没有发现"穷举板块名"的可执行代码');
} else {
    bad('发现 ' + offenders.length + ' 处穷举板块名的写法（应改成查注册表 / 用 isCollectionMode()）：');
    offenders.forEach(o => console.log('      ' + o));
}

console.log('\n=== 5. 操作手册必须还在 ===');

// 加板块的步骤写在 ARCHITECTURE-modes.md 里。它一旦被删/被改名，
// 后来的人就只能靠读源码猜 —— 那正是这套重构要消灭的东西。
try {
    const doc = readFileSync(path.join(DIR, 'ARCHITECTURE-modes.md'), 'utf8');
    chk(doc.includes('MODE_REGISTRY'), 'ARCHITECTURE-modes.md 存在且讲了注册表');
    chk(/## 3\. 加一个顶栏 tab/.test(doc), 'ARCHITECTURE-modes.md 含「加一个顶栏 tab」章节');
    chk(doc.includes('verify-mode-registry.mjs'), 'ARCHITECTURE-modes.md 指到了本脚本');
    chk(/## 5\. 加图片动画/.test(doc), 'ARCHITECTURE-modes.md 含「加图片动画」章节');
} catch (e) {
    bad('读不到 collection/ARCHITECTURE-modes.md（加板块的操作手册）: ' + e.message);
}

console.log('\n=== 6. 硬编码分支数量（信息性，不进判定） ===');
let total = 0;
const perFile = {};
for (const f of files) {
    const src = readFileSync(path.join(DIR, f), 'utf8')
        .split('\n')
        .filter(l => !/^\s*\/\//.test(l))
        .join('\n');
    const n = (src.match(/(currentMode|target|sourceType)\s*===\s*MODE\./g) || []).length;
    if (n) perFile[f] = n;
    total += n;
}
Object.entries(perFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`    ${String(n).padStart(3)} 处  ${f}`));
console.log(`    合计 ${total} 处（改造前是 53 处；剩下的多为单板块领域判断，不是通用分叉）`);

console.log('\n================ 汇总 ================');
if (problems === 0) {
    console.log(`🟢 板块注册表检查全部通过（${checks} 项断言）`);
    process.exit(0);
} else {
    console.log(`🔴 ${problems} 项失败（共 ${checks} 项断言）`);
    process.exit(1);
}
