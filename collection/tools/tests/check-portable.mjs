// 可移植性自检：用例能不能在别的机器 / CI 上跑。
//
// 为什么要有这个：verify-octo.mjs 与 verify-search-case.mjs 曾在 CI 上整片红，而本地全绿。
// 根因是它们把开发机的绝对路径写死了：
//     const ROOT = 'C:/Users/57891/tong-xiangjie.github.io';
// runner 上没有这个路径 → 测试服务器对每个请求都 404 → 页面没加载 →
// "读源码"的静态断言全过、运行时断言全挂。verify-search-case 更绕：84 条 count()
// 各自重试 40 次 × 250ms ≈ 840s，把 15 分钟硬超时耗光，CI 上报的居然是"超时"。
// 这类问题在本地永远复现不了，只能靠静态约束拦住 —— 所以有了这个文件。
//
// 检查三件事：
//   ① 用例里不许出现本机绝对路径（C:/… 、C:\… 、/Users/… 、/home/… ）；
//   ② 用例之间不许共用同一个写死的 CDP 调试端口（撞车会连到别人家的浏览器上，
//      表现同样诡异：连上了、能发命令，但页面是空的）；
//   ③ 用例的 ROOT 必须来自 cwd 或 import.meta.url，不许是字面量。
//
// exit 0 = 全部通过；exit 1 = 有不可移植的地方。
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');        // tests → tools → collection → 仓库根
const TOOLS = join(ROOT, 'collection', 'tools');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ★ 收两处，跟 run.mjs 的用例清单保持一致：
//   ① 本目录的全部 .mjs（用例 + run.mjs/check-portable.mjs/diag-ci.mjs/ci-watch.mjs 自己）；
//   ② collection/tools/ 下的 verify-*.mjs —— 那是 run.mjs 清单的**第二处 readdirSync**
//      （见 run.mjs 的 "两个位置都要收"），它同样在 CI 上跑。
//   以前这里只扫本目录，所以 verify-mode-registry.mjs 虽然每轮 CI 都跑，
//   却从来没被这套"绝对路径 / 端口撞车 / ROOT 来源"的静态约束把关过 —— 那正是
//   2026-10「本地全绿、CI 全红」的成因类别，必须一起扫。
//   （tests/lib/ 下只有被 import 的库文件，不是用例，不扫。）
const files = [
    ...readdirSync(HERE).filter(f => f.endsWith('.mjs')).map(f => join(HERE, f)),
    ...readdirSync(TOOLS).filter(f => /^verify-.*\.mjs$/.test(f)).map(f => join(TOOLS, f))
].sort();
const label = p => p.startsWith(HERE) ? p.slice(HERE.length + 1) : p.slice(ROOT.length + 1).replace(/\\/g, '/');
const src = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
const lines = f => src.get(f).split(/\r?\n/);

// ── ① 绝对路径 ────────────────────────────────────────────────
// 注释里可以提（比如解释这个坑本身），代码里不行 —— 所以只看非注释行。
const ABS = [/\b[A-Za-z]:[\\/](?:Users|Documents|Desktop|projects?)\b/i, /["'`]\/Users\//, /["'`]\/home\//];
const badPath = [];
for (const f of files) {
  lines(f).forEach((l, i) => {
    const t = l.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (ABS.some(re => re.test(l))) badPath.push(`${label(f)}:${i + 1}  ${t.slice(0, 110)}`);
  });
}
ok(badPath.length === 0, `① 用例里没有本机绝对路径（${badPath.length} 处）`);
badPath.slice(0, 8).forEach(b => console.log('      ' + b));

// ── ② CDP 端口 ────────────────────────────────────────────────
const ports = new Map();          // 端口号 -> [文件]
for (const f of files) {
  const m = src.get(f).match(/const DP\s*=\s*(\d+)\s*;/);
  if (!m) continue;
  const p = Number(m[1]);
  if (!ports.has(p)) ports.set(p, []);
  ports.get(p).push(label(f));
}
const clash = [...ports.entries()].filter(([, fs]) => fs.length > 1);
ok(clash.length === 0, `② 没有两个用例共用写死的 CDP 端口（写死 ${ports.size} 个，冲突 ${clash.length} 处）`);
clash.forEach(([p, fs]) => console.log(`      ✗ 端口 ${p}：${fs.join(', ')}`));

// 写死的端口还要避开随机段，否则随机的那个撞上写死的照样连错
const randRanges = [];
for (const f of files) {
  const m = src.get(f).match(/const DP\s*=\s*(\d+)\s*\+\s*Math\.floor\(Math\.random\(\)\s*\*\s*(\d+)\)/);
  if (m) randRanges.push([Number(m[1]), Number(m[1]) + Number(m[2]) - 1, label(f)]);
}
const overlap = [];
for (const [p, fs] of ports) for (const [lo, hi, f] of randRanges) if (p >= lo && p <= hi) overlap.push(`写死 ${p}（${fs[0]}）落在 ${f} 的随机段 ${lo}-${hi} 里`);
ok(overlap.length === 0, `② 写死的端口没有落在别的用例的随机段里（${overlap.length} 处）`);
overlap.slice(0, 6).forEach(o => console.log('      ✗ ' + o));

// ── ③ ROOT 来源 ───────────────────────────────────────────────
const literalRoot = [];
for (const f of files) {
  lines(f).forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//')) return;
    if (/const\s+ROOT\s*=\s*['"`]/.test(l)) literalRoot.push(`${label(f)}:${i + 1}  ${t.slice(0, 110)}`);
  });
}
ok(literalRoot.length === 0, `③ 用例的 ROOT 不是字面量（应该是 process.cwd() 或 import.meta.url）`);
literalRoot.slice(0, 8).forEach(r => console.log('      ✗ ' + r));

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
process.exit(fail === 0 ? 0 : 1);
