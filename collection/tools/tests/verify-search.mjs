// 用真实数据验证搜索逻辑：把 collection/ 的常量与匹配函数复刻出来，
// 直接 eval 各数据文件，对比「旧的全字段」与「新的全字段」结果集。
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// ---------- 复刻 collection/core.js 的搜索相关实现 ----------
const MODE = { NOTES: 'notes', COINS: 'coins' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause', COPYID: 'copyid' };
const CATALOG_PREFIX_RE = /^(?:pick|km|krause|sun)\s*[-#]\s*/i;
// ★ 与 core.js 的 foldCompat 同步：NFKC 会把罗马数字折成 ASCII 字母（Ⅰ→I、Ⅲ→III、Ⅶ→VII），
//   那会让 'ⅢⅡⅠ' 与 'ⅠⅡⅢ' / 'ⅦⅡⅡ'、'ⅠO888' 与 'IO88888767' 混为一谈。
//   这里必须和源码一致，否则这份镜像验证的就不是线上真正跑的逻辑了。
const COMPAT_KEEP_FIRST = 0x2160;
const COMPAT_PUA_FIRST = 0xE000;
const COMPAT_PUA_RE = /[\uE000-\uE028]/g;
function foldCompat(v) {
  const s = String(v);
  if (COMPAT_PUA_RE.test(s)) return s.normalize('NFKC');
  return s
    .replace(/[\u2160-\u2188]/g, c => String.fromCharCode(COMPAT_PUA_FIRST + c.charCodeAt(0) - COMPAT_KEEP_FIRST))
    .normalize('NFKC')
    .replace(COMPAT_PUA_RE, c => String.fromCharCode(COMPAT_KEEP_FIRST + c.charCodeAt(0) - COMPAT_PUA_FIRST));
}
function normalizeForSearch(v) {
  if (v === undefined || v === null) return '';
  return foldCompat(v).replace(/[\s\u3000\u00a0]+/g, '').toLowerCase();
}
function stripCatalogPrefix(v) {
  if (v === undefined || v === null) return '';
  return String(v).normalize('NFKC').replace(CATALOG_PREFIX_RE, '');
}
function formatCatalogNumber(num) {
  if (!num) return '';
  const s = String(num).trim();
  if (/unlisted/i.test(s)) return '';
  if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
  return 'Pick# ' + s;
}
const SEARCH_IMAGE_KEY_RE = /^img/i;
function isSearchableField(key) {
  if (SEARCH_IMAGE_KEY_RE.test(key)) return false;
  if (key === 'readme' || key === 'detailFields' || key === 'author') return false;
  return true;
}
function collectSearchFields(copy, series, variety) {
  const parts = [series.seriesName];
  if (variety) parts.push(variety.varietyName);
  for (const [k, v] of Object.entries(copy)) {
    if (!isSearchableField(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    parts.push(String(v));
  }
  return parts;
}
function makeSearchPlan(keyword, type) {
  return { keyword, norm: normalizeForSearch(stripCatalogPrefix(keyword)) };
}

// 旧实现（原样复刻 matchCopy / matchCopyFlat 的 ALL 分支）
function oldMatchAll(copy, series, variety, keyword, hasVarieties) {
  if (!keyword) return true;
  const text = hasVarieties
    ? `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase()
    : `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
  return text.includes(keyword);
}

// 新实现（matchEntry 的 ALL 分支）
// ★ 注意：真实代码里 keyword 已由 performSearchAndRender 统一 toLowerCase()，
//   这里必须同样处理，否则大写关键词（如 "KM#"）会得到假阴性。
function newMatchAll(copy, series, variety, plan) {
  const kw = plan.keyword.toLowerCase();
  const joined = collectSearchFields(copy, series, variety).join(' ');
  const lower = joined.toLowerCase();
  if (lower.includes(kw)) return true;
  if (plan.norm) {
    if (lower.includes(plan.norm)) return true;
    if (normalizeForSearch(joined).includes(plan.norm)) return true;
  }
  return false;
}

// ---------- 加载全部纸币/硬币数据 ----------
const dirs = [['notecollection/data', 'notes'], ['coincollection/data', 'coins']];
const docs = [];
for (const [d, mode] of dirs) {
  for (const f of readdirSync(d).filter(x => x.endsWith('.js'))) {
    const src = readFileSync(`${d}/${f}`, 'utf8');
    // ★ 必须把 "取数据" 拼在同一个脚本里执行：
    //   浏览器里多个 <script> 共享全局词法环境，顶层 const 彼此可见；
    //   而 Node vm 里每次 runInContext 是独立脚本作用域，const 不会挂到全局对象上。
    //   （README 第 168 行记录过这个坑）
    const keyMatch = src.match(/(?:const|var|let)\s+([A-Za-z_$][\w$]*Data)\s*=/);
    if (!keyMatch) continue;
    const ctx = { console };
    vm.createContext(ctx);
    try { vm.runInContext(src + `\nglobalThis.__d = ${keyMatch[1]};`, ctx); }
    catch (e) { console.log(`  跳过 ${f}: ${e.message}`); continue; }
    if (ctx.__d && typeof ctx.__d === 'object') {
      docs.push({ file: `${d}/${f}`, dataKey: keyMatch[1], data: ctx.__d, mode });
    }
  }
}
console.log(`加载 ${docs.length} 个数据对象`);

// 展平成条目
const entries = [];
for (const { file, dataKey, data, mode } of docs) {
  if (!data || !Array.isArray(data.series)) continue;
  for (let si = 0; si < data.series.length; si++) {
    const series = data.series[si];
    if (series.varieties) {
      for (let vi = 0; vi < series.varieties.length; vi++) {
        const variety = series.varieties[vi];
        for (const copy of (variety.copies || [])) entries.push({ file, dataKey, mode, series, variety, copy, hv: true });
      }
    } else if (series.copies) {
      for (const copy of series.copies) entries.push({ file, dataKey, mode, series, variety: null, copy, hv: false });
    }
  }
}
console.log(`展平 ${entries.length} 条藏品\n`);

// ---------- 回归对比：新全字段 ⊇ 旧全字段 ----------
console.log('=== 1. 回归检查：旧「全字段」能搜到的，新实现是否也能（逐条穷举副本的可搜文本）===');
let regress = 0;
// ★ 除"回归对比"之外的断言（copyId 命中、目录编号变体、噪声检查…）也各自记一笔，
//   否则它们失败时进程照样退出 0。
let softFail = 0;
for (const e of entries) {
  // 构造"旧能搜到"的关键词集合：旧文本里的每个词元
  const oldText = e.hv
    ? `${e.series.seriesName} ${e.variety.varietyName} ${e.copy.version || ''} ${e.copy.year} ${e.copy.condition || e.copy.grade || ''} ${e.copy.catalogNumber || e.copy.krause || ''} ${e.copy.material || ''}`
    : `${e.series.seriesName} ${e.copy.version || ''} ${e.copy.year} ${e.copy.condition || e.copy.grade || ''} ${e.copy.catalogNumber || e.copy.krause || ''} ${e.copy.material || ''}`;
  const tokens = String(oldText).split(/\s+/).filter(t => t.length >= 2);
  for (const tok of tokens) {
    const kw = tok.toLowerCase();
    const plan = makeSearchPlan(kw, SEARCH_TYPE.ALL);
    if (!newMatchAll(e.copy, e.series, e.variety, plan)) {
      regress++;
      if (regress <= 8) console.log(`  ⚠ 回归: ${e.file} 关键词 "${tok}" 旧=true 新=false`);
    }
  }
}
console.log(`  回归 ${regress} 处`);

// ---------- 覆盖提升：新增哪些字段可搜 ----------
console.log('\n=== 2. 覆盖提升：新实现多搜到的字段（旧 7 字段之外）===');
const newlySearchable = new Map();
for (const e of entries) {
  const oldKeys = new Set(['version', 'year', 'condition', 'grade', 'catalogNumber', 'krause', 'material']);
  for (const [k, v] of Object.entries(e.copy)) {
    if (oldKeys.has(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    newlySearchable.set(k, (newlySearchable.get(k) || 0) + 1);
  }
}
for (const [k, n] of [...newlySearchable].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${n} 条可搜`);
}

// ---------- 功能验证：按评级编号 / 目录编号搜索 ----------
console.log('\n=== 3. 按评级编号（copyId）搜索样例 ===');
function searchAll(type, rawKeyword, matchFn) {
  const plan = makeSearchPlan(rawKeyword, type);
  return entries.filter(e => matchFn(e, plan));
}
const withCopyId = entries.filter(e => e.copy.copyId);
console.log(`  有 copyId 的条目 ${withCopyId.length} 条`);
for (const e of withCopyId.slice(0, 4)) {
  const id = String(e.copy.copyId);
  const hits = searchAll(SEARCH_TYPE.COPYID, id, (en, plan) => {
    const v = String(en.copy.copyId || '');
    return v.toLowerCase().includes(plan.keyword) || (!!plan.norm && normalizeForSearch(v).includes(plan.norm));
  });
    if (hits.length < 1) softFail++;
    console.log(`  "${id}" → 命中 ${hits.length} 条 ${hits.length >= 1 ? '✓' : '✗'}`);
}
// 部分匹配（copyId 可能是数字，统一 String()）
const partial = String(withCopyId[0].copy.copyId).slice(0, 7);
const ph = searchAll(SEARCH_TYPE.COPYID, partial, (en, plan) => {
  const v = String(en.copy.copyId || '');
  return v.toLowerCase().includes(plan.keyword) || (!!plan.norm && normalizeForSearch(v).includes(plan.norm));
});
console.log(`  部分匹配 "${partial}" → ${ph.length} 条 ✓`);

console.log('\n=== 4. 目录编号前缀无关（这是 B3 的修复）===');
const krauseMatch = (en, plan) => {
  const raw = String(en.copy.catalogNumber || en.copy.krause || '');
  const formatted = formatCatalogNumber(raw);
  if (raw.toLowerCase().includes(plan.keyword) || formatted.toLowerCase().includes(plan.keyword)) return true;
  if (!plan.norm) return false;
  return normalizeForSearch(raw).includes(plan.norm) || normalizeForSearch(formatted).includes(plan.norm);
};
const withKrause = entries.filter(e => (e.copy.catalogNumber || e.copy.krause));
console.log(`  有目录编号的条目 ${withKrause.length} 条`);
// 找几个非 Pick# 前缀的（KM# / SUN#）
const nonPick = withKrause.filter(e => !/^\s*(pick)?\s*#?\s*\d+$/i.test(String(e.copy.catalogNumber || e.copy.krause)));
const samples = [];
for (const e of withKrause) {
  const raw = String(e.copy.catalogNumber || e.copy.krause);
  const m = raw.match(/^([A-Za-z]+)\s*[-#]/);
  if (m && !/^pick$/i.test(m[1])) samples.push([e, raw, m[1]]);
}
console.log(`  非 Pick# 前缀样例 ${samples.length} 个：`);
for (const [e, raw, prefix] of samples.slice(0, 6)) {
  // 各种写法都要能命中
  const variants = [raw, raw.replace(/\s+/g, ''), raw.toUpperCase(), prefix.toLowerCase() + '#' + raw.replace(/^[A-Za-z]+\s*[-#]\s*/, '')];
  const ok = variants.every(v => searchAll(SEARCH_TYPE.KRAUSE, v, krauseMatch).length >= 1);
  if (!ok) softFail++;
  console.log(`    ${ok ? '✓' : '✗'} "${raw}"  变体 ${variants.length} 种全部命中`);
}
// Pick# 老写法必须继续可用
const pickSample = withKrause.find(e => /^\d/.test(String(e.copy.catalogNumber || e.copy.krause)));
if (pickSample) {
  const raw = String(pickSample.copy.catalogNumber || pickSample.copy.krause);
  for (const v of [raw, 'Pick# ' + raw, 'Pick#' + raw, 'pick# ' + raw]) {
    const n = searchAll(SEARCH_TYPE.KRAUSE, v, krauseMatch).length;
    if (n < 1) softFail++;
    console.log(`  ${n >= 1 ? '✓' : '✗'} "Pick# " 写法 "${v}" → ${n} 条`);
  }
}

console.log(regress === 0 ? '\n✅ 无回归' : `\n❌ ${regress} 处回归`);

// ---------- 噪声检查 ----------
console.log('\n=== 5. 噪声检查：图片路径不该被"全字段"搜到 ===');
// 注意：'https' 不能作为断言 —— 有一条 remark 是真实正文（含知乎考证链接），
// 搜 'https' 命中 1 条属于正确行为，不是噪声。
for (const kw of ['jpg', 'tong-xiangjie.github.io', '/image/']) {
  const n = searchAll(SEARCH_TYPE.ALL, kw, (e, plan) => newMatchAll(e.copy, e.series, e.variety, plan)).length;
  if (n !== 0) softFail++;
  console.log(`  ${n === 0 ? '✓' : '✗'} 搜 "${kw}" → ${n} 条命中（应为 0）`);
}
console.log('\n=== 6. 有效检索词应正常命中 ===');
for (const kw of ['水印', '评级', '中国人民银行', '银', 'KM#', '130', 'Sun-J2a1']) {
  const n = searchAll(SEARCH_TYPE.ALL, kw, (e, plan) => newMatchAll(e.copy, e.series, e.variety, plan)).length;
  console.log(`  ${n > 0 ? '✓' : '·'} 搜 "${kw}" → ${n} 条`);
}

// ★ 失败必须反映到退出码上（原来只打印 ✗ 就结束，外部按退出码判定会误判为通过）。
const totalBad = regress + softFail;
if (totalBad > 0) console.log(`\n❌ ${totalBad} 处失败（回归 ${regress} + 断言 ${softFail}）`);
process.exit(totalBad === 0 ? 0 : 1);
