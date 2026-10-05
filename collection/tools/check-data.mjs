// ==================== tools/check-data.mjs ====================
// 藏品数据体检。不需要任何 npm 依赖：node collection/tools/check-data.mjs
//
// 做这些检查（都是这个项目实际踩过的坑）：
//   1. 图片引用是否存在，以及"路径本身就是坏的"（如 目录/-1.jpg，文件名是空的）
//   2. detailFields 声明与数据是否对得上（声明了但所有条目都没这个字段 / 有字段但没声明，界面就看不到）
//   3. 同一个 key 在不同数据文件里用了不同的 label（如 bank 有"发行方/发行银行/发行部门/发行单位"四种）
//   4. 同一个 label 对应了不同的 key（语义重复，如 wmk 与 watermark 都叫"水印"）
//   5. dataKey 与分类树是否对得上（配置里指了文件，文件里的全局变量却不存在）
//   6. 前端脚本的顶层重名声明 —— 所有 js 共享全局作用域，重名会静默覆盖
//
// 退出码：0 = 没有致命问题；1 = 有 ERROR

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COL = path.resolve(HERE, '..');            // collection/
const ROOT = path.resolve(COL, '..');            // 仓库根

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// ---------------- 1. 收集数据源（走和页面一样的分类树） ----------------
function makeCtx() {
    const ctx = {
        console, JSON, Object, Array, String, Number, RegExp, Math, Boolean, Set, Map, Date, Error,
        document: { createElement: () => ({}), head: { appendChild() {} } },
        localStorage: { getItem: () => null, setItem() {} }
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.window.SPECIAL_CONFIGS = ctx.SPECIAL_CONFIGS = [];
    return ctx;
}

const ctx0 = makeCtx();
vm.createContext(ctx0);
vm.runInContext([
    read(path.join(COL, 'config.js')),
    read(path.join(COL, 'coin-config.js')),
    read(path.join(COL, 'special-bridge.js')),
    read(path.join(COL, 'data-loader.js')),
    'window.__note = JSON.stringify(walkTree(categoryTree, []));',
    'window.__coin = JSON.stringify(walkTree(coinCategoryTree, []));',
    'window.__agg = JSON.stringify({ notes: allDataKeys, coins: coinAllDataKeys });',
    'window.__special = JSON.stringify((window.SPECIAL_CONFIGS||[]).filter(c=>c.dataFile&&c.dataKey).map(c=>({key:c.dataKey,file:c.dataFile,var:c.dataVar||c.dataKey})));'].join('\n;\n'), ctx0, { filename: 'cfg.js' });

// ---------------- 1b. 分类树 ↔ 聚合 dataKey 列表 必须双向一致 ----------------
// ★ 2026-10 的真实事故：硬币 tree 从 circulatingData 改成了 circulating_5/4/3/2Data
//   （coin-config.js 里改的），但同一文件下方的 coinAllDataKeys 是**手写**的旧列表
//   ['commemorativeData','circulatingData','gold_silverData']。
//   后果：流通硬币整类没接上 —— 硬币板块少了这些分类、价格列表筛选里看不到、
//   computeStats() 的硬币数也少算（"我的"页面上凭空少一块）。
//   纸币那边的 allDataKeys 是从 categoryTree 推导的，所以只有硬币会这样失联。
//   这里双向查：树里有、列表里没有的（漏接），以及列表里有、树里没有的（过期残留）。
{
    const agg = JSON.parse(ctx0.__agg);
    const pairs = [
        { tree: JSON.parse(ctx0.__note).map(s => s.key), list: agg.notes || [], name: 'allDataKeys', side: '纸币' },
        { tree: JSON.parse(ctx0.__coin).map(s => s.key), list: agg.coins || [], name: 'coinAllDataKeys', side: '硬币' }
    ];
    for (const p of pairs) {
        for (const k of p.tree) {
            if (!p.list.includes(k)) err(`${p.name} 少了${p.side}分类树里的 dataKey「${k}」——这一类在页面上会整块消失（分类、筛选、统计都少它）`);
        }
        for (const k of p.list) {
            if (!p.tree.includes(k)) warn(`${p.name} 里的「${k}」已不在${p.side}分类树里（多半是改了 tree 之后忘了同步这张列表）`);
        }
    }
}

const sources = [
    ...JSON.parse(ctx0.__note).map(s => ({ ...s, kind: 'notes' })),
    ...JSON.parse(ctx0.__coin).map(s => ({ ...s, kind: 'coins' })),
    ...JSON.parse(ctx0.__special).map(s => ({ ...s, kind: 'fun' }))
];

// ---------------- 1c. dataKey 不得跨板块撞名 ----------------
// ★ 纸币的纪念钞与硬币的纪念币原本都叫 'commemorativeData'：两个 key 分别落在
//   DATA_MAP 与 COIN_DATA_MAP 里，所以"能用"，但任何只拿到 dataKey 而没拿到 source
//   的代码都会指错板块（stats.js 里那段注释就是为它写的告警），价格列表按分类筛选
//   也得靠 (dataKey, source) 两个字段一起比才不会串。
//   现在要求 dataKey 全局唯一 —— 撞名一律 ERROR，逼着新分类起个不撞的名字。
{
    const byKey = new Map();
    for (const s of sources) {
        if (!s.key) continue;
        if (!byKey.has(s.key)) byKey.set(s.key, []);
        byKey.get(s.key).push(s.kind);
    }
    const KIND_CN = { notes: '纸币', coins: '硬币', fun: '趣味' };
    for (const [k, kinds] of byKey) {
        const uniq = [...new Set(kinds)];
        if (uniq.length > 1) {
            err(`dataKey「${k}」被多个板块共用（${uniq.map(x => KIND_CN[x] || x).join(' / ')}）——` +
                `只拿到 dataKey、没拿到 source 的代码会指错板块；请给其中一个换一个唯一的名字`);
        }
    }
}

// ---------------- 2. 真正把数据跑起来 ----------------
const dataFiles = [];
const seen = new Set();
for (const s of sources) {
    const p = s.file ? path.resolve(COL, s.file) : null;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (!exists(p)) { err('数据文件不存在: ' + s.file + '  (来自 dataKey ' + s.key + ')'); continue; }
    dataFiles.push(read(p));
}

const ctx = makeCtx();
vm.createContext(ctx);
vm.runInContext([
    read(path.join(COL, 'config.js')),
    read(path.join(COL, 'coin-config.js')),
    read(path.join(COL, 'special-bridge.js')),
    read(path.join(COL, 'data-loader.js')),
    ...dataFiles,
    'window.__srcs = ' + JSON.stringify(sources.map(s => ({ key: s.key, file: s.file, v: s.var || s.key, kind: s.kind }))) + ';',
    `window.__out = (() => {
    const maps = { notes: {}, coins: {}, fun: {} };
    const missingVar = [];
    for (const s of __srcs) {
        let v = null;
        try { v = (0, eval)(s.v); } catch (e) { v = null; }
        if (v === null) { missingVar.push(s.key + ' -> var ' + s.v); continue; }
        maps[s.kind][s.key] = v;
    }
    // 收集每份数据的 detailFields 与所有 copies 的字段并集
    const reports = [];
    const collect = (key, d, kind, where) => {
        const fieldKeys = new Set();
        const decl = (d.detailFields || []).map(f => ({ key: f.key, label: f.label }));
        const scanCopy = (c) => { for (const k of Object.keys(c)) fieldKeys.add(k); };
        let copies = 0;
        for (const s of (d.series || [])) {
            if (s.varieties) for (const v of s.varieties) for (const c of (v.copies || [])) { scanCopy(c); copies++; }
            else for (const c of (s.copies || [])) { scanCopy(c); copies++; }
        }
        reports.push({ key, file: where, kind, decl, fieldKeys: [...fieldKeys], copies, hasDetailFields: Array.isArray(d.detailFields) });
    };
    const fileOf = {};
    for (const s of __srcs) fileOf[s.key] = s.file || '';
    for (const kind of ['notes', 'coins', 'fun']) {
        for (const key of Object.keys(maps[kind])) collect(key, maps[kind][key], kind, fileOf[key] || '');
    }
    // 图片引用：全量深走，不看数据结构长什么样。
    // ★ 必须在"同一个 script"里做：顶层 const 声明的数据文件在另一次 runInContext 里
    //   用间接 eval 是取不到的（只有 var 会挂到全局对象上），换脚本收集就会整片漏掉。
    const refs = [];
    const IMG_KEYS = ['img1', 'img2', 'img', 'yearImg'];
    // ★ insideImg：落在 img1/img2/imgExtra 这类"图片容器"里的字符串都算图片引用。
    //   imgExtra（完整八面图）是 { sideLight: [url, url], transmit: [...], uv: [...] }
    //   这种嵌套结构，键名 sideLight/transmit/uv 本身不带 img 前缀，只靠键名判断会整片漏掉
    //   —— 于是那 6 张图是否存在就永远检不出来。
    const walkImg = (o, where, insideImg) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { for (const x of o) walkImg(x, where, insideImg); return; }
        for (const k of Object.keys(o)) {
            const v = o[k];
            const imgish = !!insideImg || IMG_KEYS.indexOf(k) >= 0 || /^img/i.test(k);
            if (imgish && typeof v === 'string' && v) {
                refs.push({ url: v, where: where + '.' + k });
            } else if (v && typeof v === 'object') {
                walkImg(v, where + '.' + k, imgish);
            }
        }
    };
    for (const kind of ['notes', 'coins', 'fun']) {
        for (const key of Object.keys(maps[kind])) walkImg(maps[kind][key], key, false);
    }

    return JSON.stringify({ reports, missingVar, refs });
})();`
].join('\n;\n'), ctx, { filename: 'data.js' });

const { reports, missingVar, refs } = JSON.parse(ctx.__out);

console.log('数据源 ' + sources.length + ' 个，数据文件 ' + dataFiles.length + ' 个\n');
for (const m of missingVar) err('数据文件里的全局变量不存在: ' + m);

// ---------------- 3. 图片引用 ----------------
// refs 已在上面的同一段脚本里收集好（见 walkImg 处的说明）
let imgRefs = 0;
const malformed = [];
const localPath = (u) => {
    const m = String(u).match(/^(?:https?:\/\/tong-xiangjie\.github\.io)?\/(.+)$/i);
    return m ? path.join(ROOT, decodeURIComponent(m[1])) : null;
};
const missingImgs = [];
for (const r of refs) {
    const p = localPath(r.url);
    if (!p) continue;
    imgRefs++;
    const base = path.basename(p);
    if (/^-\d+\.\w+$/.test(base)) { malformed.push(r); continue; }   // 文件名是空的：目录/-1.jpg
    if (!exists(p)) missingImgs.push(r);
}
console.log('==== 图片引用 ====');
console.log('  共 ' + imgRefs + ' 处');
console.log('  文件名是空的（形如 目录/-1.jpg）: ' + malformed.length);
console.log('  引用了但文件不存在（非空文件名）: ' + missingImgs.length);
if (malformed.length) {
    const by = {};
    for (const m of malformed) { const p = localPath(m.url); const rel = path.relative(ROOT, p).split(path.sep).slice(0, 3).join('/'); by[rel] = (by[rel] || 0) + 1; }
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) warn('文件名是空的: ' + v + ' 处 @ ' + k);
}
if (missingImgs.length) {
    const by = {};
    for (const m of missingImgs) { const p = localPath(m.url); const rel = path.relative(ROOT, p).split(path.sep).slice(0, 3).join('/'); by[rel] = (by[rel] || 0) + 1; }
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) warn('图片不存在: ' + v + ' 处 @ ' + k);
}

// ---------------- 4. detailFields 与数据是否对得上 ----------------
console.log('\n==== detailFields 声明 vs 数据 ====');
const ignoreKeys = new Set(['img1', 'img2', 'img', 'yearImg', 'imgExtra', 'readme', 'readmes', 'copies', 'varieties', 'seriesName', 'varietyName', 'name', 'title', 'remark']);
// 说明：remark 由 category-view.js 的 openCopyDetail 单独兜底渲染（当 detailFields 里没有它时自动补一行"备注"），
// 所以"有 remark 但没声明"不算问题。
let gapCount = 0, extraCount = 0;
for (const r of reports) {
    if (r.copies === 0 || !r.hasDetailFields) continue;
    const declared = new Set(r.decl.map(d => d.key));
    const actual = new Set(r.fieldKeys);
    const undeclared = [...actual].filter(k => !declared.has(k) && !ignoreKeys.has(k));
    const unused = [...declared].filter(k => !actual.has(k));
    if (undeclared.length) { gapCount++; warn('有数据但没声明（界面看不到）: ' + r.file + ' -> ' + undeclared.join(', ')); }
    if (unused.length) { extraCount++; warn('声明了但所有条目都没这个字段: ' + r.file + ' -> ' + unused.join(', ')); }
}
if (!gapCount && !extraCount) console.log('  全部一致');

// ---------------- 5. label 一致性 ----------------
console.log('\n==== 标签一致性 ====');
const byKey = {};
const byLabel = {};
for (const r of reports) {
    for (const d of r.decl) {
        (byKey[d.key] = byKey[d.key] || new Set()).add(d.label);
        (byLabel[d.label] = byLabel[d.label] || new Set()).add(d.key);
    }
}
let labelIssues = 0;
for (const [k, s] of Object.entries(byKey)) {
    if (s.size > 1) { labelIssues++; warn('同一个 key "' + k + '" 有 ' + s.size + ' 种标签: ' + [...s].join(' / ')); }
}
for (const [l, s] of Object.entries(byLabel)) {
    if (s.size > 1) { labelIssues++; warn('同一个标签 "' + l + '" 对应 ' + s.size + ' 个 key: ' + [...s].join(' / ')); }
}
if (!labelIssues) console.log('  全部一致');

// ---------------- 6. 前端脚本顶层重名 ----------------
console.log('\n==== 前端顶层声明重名 ====');
// ★ 必须**按页面分组**比较：collection/ 与 newcollection/ 是两个独立页面，
//   各自加载自己那一套脚本，永远不会同时出现在同一个全局作用域里 ——
//   把两者放进同一张表比较会得到几十条误报（第一版就这么错过，已改）。
//   组内才是真的冲突。newcollection/search.js 里重复声明 currentSearchKeyword
//   就是这么漏掉的：它是 let，重复声明不是"静默覆盖"而是直接
//     SyntaxError: Identifier '...' has already been declared
//   整份 search.js 都不执行（页面上的搜索静默失灵）。所以分两档：
//     · let / const 重复 —— 致命，ERROR（整份脚本作废）
//     · var / function 重复 —— 后声明覆盖前声明，WARN（老注释说的那种）
const JS_GROUPS = [
    { name: 'collection', dir: COL },
    { name: 'newcollection', dir: path.join(ROOT, 'newcollection') }
];
let dupIssues = 0;
const groupJsCount = new Map();
for (const g of JS_GROUPS) {
    if (!exists(g.dir)) continue;
    const decls = new Map();
    const files = fs.readdirSync(g.dir).filter(f => f.endsWith('.js')).sort();
    groupJsCount.set(g.name, files.length);
    for (const f of files) {
        const lines = read(path.join(g.dir, f)).split('\n');
        let inBlock = false;
        lines.forEach((line, i) => {
            const t = line.trim();
            if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
            if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
            if (t.startsWith('//') || /^[ \t]/.test(line)) return;
            const m = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/) || line.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=/);
            if (m) {
                const name = m[2] || m[1];
                const kind = m[2] ? m[1] : 'function';
                if (!decls.has(name)) decls.set(name, []);
                decls.get(name).push({ where: g.name + '/' + f + ':' + (i + 1), kind });
            }
        });
    }
    for (const [name, list] of decls) {
        if (list.length < 2) continue;
        dupIssues++;
        const where = list.map(d => d.where + '(' + d.kind + ')').join(' , ');
        if (list.some(d => d.kind === 'let' || d.kind === 'const')) {
            err(`[${g.name}] 顶层重名且是 let/const，整份脚本会因 SyntaxError 作废: ${name} @ ${where}`);
        } else {
            warn(`[${g.name}] 顶层重名（后者会静默覆盖前者）: ` + name + ' @ ' + where);
        }
    }
    console.log(`  ${g.name}: 扫了 ${files.length} 个 js`);
}
if (!dupIssues) console.log('  没有重名');

// ---------------- 7. 数据文件不许写死在页面的 <script> 里 ----------------
// ★ 规则（用户定的）：藏品数据一律动态加载，文件名只写在分类树的 dataFile 里，
//   由 collection/data-loader.js 注入。理由是这次的真事故：硬币拆成
//   circulating_2/3/4/5 之后，coincollection / newcollection 两个页面还列着旧的
//   circulating.js —— 一个直接 ReferenceError 白屏，一个静默少一整类。
//   唯一允许保留的是"提供分类树本身的 meta 文件"（加载器得先知道有哪些专题数据），
//   它们不含藏品，列在下面的白名单里。
console.log('\n==== 数据文件是否写死在页面里 ====');
const META_WHITELIST = [
    'funcollection/years/data.js',      // 定义 specialYearsMeta，SPECIAL_CONFIGS 的来源
    'data/synonyms-version.js'          // 同义词表的版本号，不是藏品数据
];
const PAGE_DIRS = ['collection', 'notecollection', 'coincollection', 'newcollection', 'funcollection/years', 'answersheet'];
let hardCoded = 0;
for (const dir of PAGE_DIRS) {
    const page = path.join(ROOT, dir, 'index.html');
    if (!exists(page)) continue;
    const src = read(page);
    for (const m of src.matchAll(/<script src="([^"]+\.js)"><\/script>/g)) {
        const ref = m[1];
        const looksLikeData = /(^|\/)data\/[^/]+\.js$/.test(ref) || /\.\.\/[a-z]+\/data\/[^/]+\.js$/.test(ref);
        if (!looksLikeData) continue;
        const normalized = ref.replace(/^\.\.\//, '');
        if (META_WHITELIST.some(w => normalized.endsWith(w))) continue;
        hardCoded++;
        err(`${dir}/index.html 里写死了数据文件「${ref}」——数据必须动态加载：` +
            `把文件名写进分类树的 dataFile（见 collection/data-loader.js 的 loadDataFromTrees），` +
            `否则改了数据结构这里就会静默失联（硬币 circulating_* 就是这么挂的）`);
    }
    console.log(`  ${dir}/index.html: 检查过`);
}
if (!hardCoded) console.log('  没有写死的数据文件');

// ---------------- 汇总 ----------------
console.log('\n' + '='.repeat(56));
console.log('扫描文件: collection/*.js ' + (groupJsCount.get('collection') || 0) + ' 个 / newcollection/*.js ' + (groupJsCount.get('newcollection') || 0) + ' 个 / 数据文件 ' + dataFiles.length + ' 个');
const byKind = { notes: 0, coins: 0, fun: 0 };
for (const r of reports) byKind[r.kind] = (byKind[r.kind] || 0) + r.copies;
console.log('藏品: ' + reports.reduce((s, r) => s + r.copies, 0) + ' 件' +
    '（纸币 ' + byKind.notes + ' / 硬币 ' + byKind.coins + ' / 专题 ' + byKind.fun + '）');
console.log('ERROR ' + errors.length + ' 条, WARN ' + warns.length + ' 条');
if (errors.length) { console.log('\nERROR:'); errors.forEach(e => console.log('  ✗ ' + e)); }
if (warns.length) { console.log('\nWARN:'); warns.forEach(w => console.log('  ! ' + w)); }
console.log('='.repeat(56));
process.exit(errors.length ? 1 : 0);
