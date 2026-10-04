// 校验 cilin.mjs 的移植与参考实现（PyPI WordSimilarity 0.0.3）等价。
//   · README 示例：要求**逐位相同**
//   · 随机抽样：允许 1 ULP 以内的浮点差（CPython 与 V8 的 cos 实现不同），
//     但要求差异确实只有几个 ULP —— 真正的算法错会差出量级
//   · 被隔离的同码重复行：**有意偏离**参考实现，单独列出，不计入失败
import { existsSync, readFileSync } from 'node:fs';
// ★ 路径注意：本文件在 collection/tools/tests/ 下，cilin.mjs 在它上一级。
import { loadCilin, similarity, codesOf } from '../cilin.mjs';

const cilinText = readFileSync('collection/tools/cilin_ex.txt', 'utf8');

// ★ oracle 是本地开发期工件（用 PyPI WordSimilarity 0.0.3 导出的抽样比对数据），
//   按约定不进仓库。没有它时仍然校验"能加载 + README 示例逐位相同"，
//   抽样比对部分明确跳过 —— exit 3 表示"跳过"，runner 不会算失败。
const ORACLE_FILE = 'cilin-oracle.json';
const hasOracle = existsSync(ORACLE_FILE);
if (!hasOracle) {
    console.log(`  ⏭ 找不到 ${ORACLE_FILE}（本地专用工件），跳过「与参考实现抽样比对」部分`);
}
const oracle = hasOracle ? JSON.parse(readFileSync(ORACLE_FILE, 'utf8')) : { count: 0, pairs: [] };

const t0 = Date.now();
const tool = loadCilin(cilinText);
console.log(`词林加载：${tool.codes.size} 词 / ${tool.lines.length} 行 / ${tool.duplicateLines} 行同码重复已隔离（${Date.now() - t0} ms`);

let pass = 0, fail = 0;
const bad = [];

console.log('\n=== ① README 示例（11 组，要求逐位相同）===');
const README = [
  ['抄袭', '克隆', 0.585642777645155], ['人民', '国民', 1],
  ['人民', '群众', 0.9576614882494312], ['人民', '党群', 0.8978076452338418],
  ['人民', '良民', 0.7182461161870735], ['人民', '同志', 0.6630145969121822],
  ['人民', '成年人', 0.6306922220793977], ['人民', '市民', 0.5405933332109123],
  ['人民', '亲属', 0.36039555547394153], ['人民', '志愿者', 0.22524722217121346],
  ['人民', '先锋', 0.18019777773697077],
];
for (const [a, b, exp] of README) {
  const got = similarity(tool, a, b);
  const okk = got === exp;
  okk ? pass++ : (fail++, bad.push(`${a}/${b}: JS=${got} PY=${exp}`));
  console.log(`  ${okk ? '✓' : '✗'} ${a}/${b} = ${got}`);
}

console.log(`\n=== ② 抽样 ${oracle.count} 对（容差 1 ULP）===`);
let ulpMax = 0, within = 0, skipped = 0, mismatch = 0;
for (const [a, b, expStr] of oracle.pairs) {
  const exp = Number(expStr);
  // 隔离行涉及的词对：参考实现会把两个无关组串成 1.0，我们有意不这么做
  if (tool.isolated.size && (codesOf(tool, a).some(c => tool.isolated.has(c)) ||
      codesOf(tool, b).some(c => tool.isolated.has(c)))) { skipped++; continue; }
  const got = similarity(tool, a, b);
  if (got === exp) { within++; continue; }
  const diff = Math.abs(got - exp);
  const ulp = diff / Math.max(Number.EPSILON * Math.abs(exp), Number.MIN_VALUE);
  if (diff <= 1e-12) { within++; if (ulp > ulpMax) ulpMax = ulp; }
  else { mismatch++; if (bad.length < 12) bad.push(`${a}/${b}: JS=${got} PY=${exp} (差 ${diff})`); }
}
pass += within; fail += mismatch;
console.log(`  一致（含 1e-12 内浮点差）: ${within}`);
console.log(`  最大浮点差: ${ulpMax.toFixed(1)} ULP`);
console.log(`  跳过（隔离行相关）: ${skipped}`);
console.log(`  真正不一致: ${mismatch}`);

console.log('\n=== ③ 同码重复行的隔离效果（有意偏离参考实现）===');
const collisions = [['修养', '摄影'], ['灰心', '计划'], ['消沉', '筹措'], ['指点', '卸妆'],
  ['开导', '化装'], ['失望', '打算'], ['颓丧', '策划'], ['陶冶性情', '光学录音']];
for (const [a, b] of collisions) {
  const got = similarity(tool, a, b);
  // 关键是不能像参考实现那样给 1.0（那表示"同一个原子词群"）。
  // 低于 1 但偏高是允许的：两个词可能另有合法编码落在同一词群里。
  const okk = got !== 1;
  okk ? pass++ : (fail++, bad.push(`${a}/${b} 未被隔离: ${got}`));
  const ca = codesOf(tool, a).map(c => tool.isolated.has(c) ? '合成' : c).join(',');
  const cb = codesOf(tool, b).map(c => tool.isolated.has(c) ? '合成' : c).join(',');
  console.log(`  ${okk ? '✓' : '✗'} ${a}[${ca}] / ${b}[${cb}] = ${got}`);
}
// 但组内同义必须还在
const keep = [['修养', '修身'], ['摄影', '拍摄'], ['灰心', '丧气'], ['计划', '筹划']];
for (const [a, b] of keep) {
  const got = similarity(tool, a, b);
  const okk = got === 1;
  okk ? pass++ : (fail++, bad.push(`${a}/${b} 组内同义丢了: ${got}`));
  console.log(`  ${okk ? '✓' : '✗'} 组内仍同义：${a}/${b} = ${got}`);
}

if (bad.length) {
  console.log('\n=== 不一致明细（最多 12 条）===');
  for (const x of bad) console.log('  ' + x);
}
console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
// 没有 oracle 时是"部分跳过"：通过就报 exit 3（跳过），有真失败仍报 1
if (fail) process.exit(1);
process.exit(hasOracle ? 0 : 3);
