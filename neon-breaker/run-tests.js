// 一键运行全部验证：抽取 neon-breaker.html 里的游戏脚本，在进程内跑两级测试
// 注意：沙箱禁止子进程管道 stdio（spawn EPERM），所以这里用 require 而非 child_process
// 用法: node run-tests.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'neon-breaker.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未能在 HTML 里找到 <script> 块'); process.exit(1); }
const gameSrc = m[1];

const suites = [
  ['关卡布局自检', './check-levels.js'],
  ['深度系统测试', './deep-test.js'],
];

let failed = 0;
for (const [label, file] of suites){
  console.log('\n' + '='.repeat(62));
  console.log('运行: ' + label + '  (' + file + ')');
  console.log('='.repeat(62));
  try {
    const suite = require(path.join(dir, file));
    const ok = suite.run(gameSrc);
    if (!ok) failed++;
  } catch (e){
    console.error('测试崩溃: ' + e.stack);
    failed++;
  }
}

console.log('\n' + '='.repeat(62));
console.log(failed === 0 ? '两套验证全部通过' : `${failed} 套验证失败`);
process.exit(failed === 0 ? 0 : 1);
