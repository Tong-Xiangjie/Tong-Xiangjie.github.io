/**
 * 跑完所有 e2e / 单元测试，汇总每个套件的通过数与退出码。
 * 单独一个脚本是为了能一次后台跑完，不用一条条等。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const dir = 'tools';
const suites = readdirSync(dir)
  .filter((f) => (f.startsWith('e2e-') || f.startsWith('unit-') || f === 'verify-patch.mjs') && f.endsWith('.mjs'))
  .sort();

const results = [];
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [dir + '/' + s], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/结果[:：]\s*(\d+)\s*通过[,，]\s*(\d+)\s*失败/);
  const last = out.trim().split('\n').filter(Boolean).slice(-6).join(' / ');
  results.push({
    套件: s,
    退出码: r.status,
    通过: m ? Number(m[1]) : null,
    失败: m ? Number(m[2]) : null,
    秒: Math.round((Date.now() - t0) / 1000),
    结尾: m ? '' : last.slice(0, 220)
  });
  console.log(s + ' → 退出码=' + r.status + (m ? ' 通过=' + m[1] + ' 失败=' + m[2] : ' (无汇总行)'));
}

console.log('\n================ 汇总 ================');
let totalPass = 0, totalFail = 0, badSuites = 0;
for (const r of results) {
  if (r.通过 !== null) { totalPass += r.通过; totalFail += r.失败; }
  if (r.退出码 !== 0) badSuites++;
  console.log(
    (r.退出码 === 0 ? '✓' : '✗') + ' ' + r.套件.padEnd(26) +
    (r.通过 !== null ? r.通过 + ' 通过 / ' + r.失败 + ' 失败' : '无汇总') +
    '  (' + r.秒 + 's)' + (r.结尾 ? '  ' + r.结尾 : '')
  );
}
console.log('\n合计: ' + totalPass + ' 通过, ' + totalFail + ' 失败, 失败套件 ' + badSuites + '/' + results.length);
process.exit(totalFail || badSuites ? 1 : 0);
