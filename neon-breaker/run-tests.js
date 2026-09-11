// 一键运行全部验证：抽取游戏 HTML 里的脚本，在进程内跑两级测试
// 用法: node run-tests.js   （在 DSH 工作区找 neon-breaker.html，在发布仓库里找 index.html）
// 注意：沙箱禁止子进程管道 stdio（spawn EPERM），所以这里用 require 而非 child_process
const fs = require('fs');
const path = require('path');

const dir = __dirname;
// 工作区里叫 neon-breaker.html；发布到 GitHub Pages 后重命名为 index.html
const candidates = ['index.html', 'neon-breaker.html'];
const found = candidates.find(f => fs.existsSync(path.join(dir, f)));
if (!found){
  console.error('没找到游戏文件（找过: ' + candidates.join(', ') + '）');
  process.exit(1);
}
console.log('游戏文件: ' + found);

const html = fs.readFileSync(path.join(dir, found), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未能在 ' + found + ' 里找到 <script> 块'); process.exit(1); }
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
