// 死代码清理验证（修正版）
// 修正点：
//  1) 残留引用只检查 collection/ 自身（旧站 notecollection/coincollection/newcollection
//     是四份独立拷贝，各有自己的实现，不算残留）
//  2) 顶层重名必须按"花括号深度为 0"判定，否则会把函数内局部变量全算进来
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = p => readFileSync(p, 'utf8');
const COLLECTION = 'collection';

// ---------- 1. 已删符号在 collection/ 内的残留 ----------
const removed = ['saveScroll', 'restoreScroll', 'scrollToTop', 'isFullPageMode',
  'getImageBase', 'getSubCategoryMap', 'isImageModalOpen', 'currentTab',
  'buildCategoryOrder', 'changePriceSort', 'subCategoryMap',
  'getDataBySource', 'scrollMemory', 'matchCopy', 'matchCopyFlat', 'KRAUSE_PREFIX',
  'searchKey', 'overviewKey'];

console.log('=== 1. 已删符号在 collection/ 内的残留引用 ===');
let problems = 0;
const coll = readdirSync(COLLECTION).filter(f => /\.(js|html)$/i.test(f)).map(f => join(COLLECTION, f));
// 再加根 index.html（可能内联调用 collection 的函数）与 manifest
const extra = ['index.html', 'manifest.json'].filter(f => { try { readFileSync(f); return true; } catch { return false; } });
const scan = [...coll, ...extra];

for (const sym of removed) {
  const re = new RegExp(`\\b${sym}\\b`);
  const hits = [];
  for (const f of scan) {
    read(f).split(/\r?\n/).forEach((l, i) => {
      if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 110)}`);
    });
  }
  // article.js 的 restoreScroll 是同名**函数参数**，属正常
  const real = hits.filter(h => !/已删|已废弃|不再依赖|零调用|已删除|全站零/.test(h))
    // restoreScroll 在 article.js 是函数参数、在 search.js 是 reconcileWithFLIP 内的局部
    // 函数（与已删的全局同名但互不相干）
    .filter(h => !(sym === 'restoreScroll' && /article\.js|search\.js/.test(h)));
  const flag = real.length === 0 ? '✓' : '⚠';
  if (real.length) problems++;
  console.log(`  ${flag} ${sym.padEnd(22)} 残留 ${real.length} 处`);
  for (const h of real) console.log(`      ${h}`);
}

// ---------- 2. collection/ 全部脚本拼接后解析 ----------
console.log('\n=== 2. collection/ 全部脚本拼接解析 ===');
const order = ['config.js', 'coin-config.js', 'special-bridge.js', 'data-loader.js', 'theme.js',
  'core.js', 'sidebar.js', 'category-view.js', 'overview.js', 'search.js', 'tab-switcher.js',
  'special.js', 'stats.js', 'settings.js', 'article.js', 'precache.js', 'symbol-picker.js',
  'router.js', 'main.js'];
let bundle = '';
for (const f of order) { try { bundle += `\n//# sourceURL=${f}\n` + read(`${COLLECTION}/${f}`); } catch { } }
try { new Function(bundle); console.log('  ✓ 无语法错误'); }
catch (e) { console.log(`  ✗ ${e.message}`); problems++; }

// ---------- 3. 真正的顶层声明重名（按花括号深度 0）----------
console.log('\n=== 3. collection/ 顶层重名（花括号深度 = 0）===');
function topLevelDecls(file) {
  const out = [];
  let depth = 0, inBlockComment = false;
  const lines = read(`${COLLECTION}/${file}`).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    let l = raw;
    if (inBlockComment) { const e = l.indexOf('*/'); if (e < 0) return; l = l.slice(e + 2); inBlockComment = false; }
    const bc = l.indexOf('/*');
    if (bc >= 0 && l.indexOf('*/', bc) < 0) { inBlockComment = true; l = l.slice(0, bc); }
    const stripped = l.replace(/\/\/.*$/, '');
    if (depth === 0) {
      const m = stripped.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
      if (m) out.push({ name: m[1] || m[2], line: idx + 1 });
    }
    for (const ch of stripped) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth < 0) depth = 0;
  });
  return out;
}
const seen = new Map();
let dup = 0;
for (const f of order) {
  for (const { name, line } of topLevelDecls(f)) {
    const loc = `${f}:${line}`;
    if (seen.has(name)) { console.log(`  ⚠ ${name}  ${seen.get(name)} 与 ${loc}`); dup++; }
    else seen.set(name, loc);
  }
}
console.log(`  顶层声明 ${seen.size} 个，重名 ${dup} 处`);
if (dup) problems++;

console.log(problems === 0 ? '\n✅ 死代码清理验证通过' : `\n⚠ ${problems} 类问题需确认`);
// ★ 失败必须反映到退出码上（原来恒为 0，外部按退出码判定会把失败当通过）。
process.exit(problems === 0 ? 0 : 1);
