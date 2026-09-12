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
    'window.__special = JSON.stringify((window.SPECIAL_CONFIGS||[]).filter(c=>c.dataFile&&c.dataKey).map(c=>({key:c.dataKey,file:c.dataFile,var:c.dataVar||c.dataKey})));'].join('\n;\n'), ctx0, { filename: 'cfg.js' });

const sources = [
    ...JSON.parse(ctx0.__note).map(s => ({ ...s, kind: 'notes' })),
    ...JSON.parse(ctx0.__coin).map(s => ({ ...s, kind: 'coins' })),
    ...JSON.parse(ctx0.__special).map(s => ({ ...s, kind: 'fun' }))
];

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
    const walkImg = (o, where) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { for (const x of o) walkImg(x, where); return; }
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (IMG_KEYS.indexOf(k) >= 0 && typeof v === 'string' && v) {
                refs.push({ url: v, where: where + '.' + k });
            } else if (v && typeof v === 'object') {
                walkImg(v, where + '.' + k);
            }
        }
    };
    for (const kind of ['notes', 'coins', 'fun']) {
        for (const key of Object.keys(maps[kind])) walkImg(maps[kind][key], key);
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
const ignoreKeys = new Set(['img1', 'img2', 'img', 'yearImg', 'readme', 'readmes', 'copies', 'varieties', 'seriesName', 'varietyName', 'name', 'title', 'remark']);
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
const jsFiles = fs.readdirSync(COL).filter(f => f.endsWith('.js')).sort();
const decls = new Map();
for (const f of jsFiles) {
    const lines = read(path.join(COL, f)).split('\n');
    let inBlock = false;
    lines.forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
        if (t.startsWith('//') || /^[ \t]/.test(line)) return;
        const m = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/) || line.match(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=/);
        if (m) {
            if (!decls.has(m[1])) decls.set(m[1], []);
            decls.get(m[1]).push(f + ':' + (i + 1));
        }
    });
}
let dupIssues = 0;
for (const [name, list] of decls) {
    if (list.length > 1) { dupIssues++; warn('顶层重名（后者会静默覆盖前者）: ' + name + ' @ ' + list.join(' , ')); }
}
if (!dupIssues) console.log('  没有重名');

// ---------------- 汇总 ----------------
console.log('\n' + '='.repeat(56));
console.log('扫描文件: collection/*.js ' + jsFiles.length + ' 个 / 数据文件 ' + dataFiles.length + ' 个');
const byKind = { notes: 0, coins: 0, fun: 0 };
for (const r of reports) byKind[r.kind] = (byKind[r.kind] || 0) + r.copies;
console.log('藏品: ' + reports.reduce((s, r) => s + r.copies, 0) + ' 件' +
    '（纸币 ' + byKind.notes + ' / 硬币 ' + byKind.coins + ' / 专题 ' + byKind.fun + '）');
console.log('ERROR ' + errors.length + ' 条, WARN ' + warns.length + ' 条');
if (errors.length) { console.log('\nERROR:'); errors.forEach(e => console.log('  ✗ ' + e)); }
if (warns.length) { console.log('\nWARN:'); warns.forEach(w => console.log('  ! ' + w)); }
console.log('='.repeat(56));
process.exit(errors.length ? 1 : 0);
