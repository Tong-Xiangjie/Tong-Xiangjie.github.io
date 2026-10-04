// 校验 layout.css 的括号配平、断点一致性、focus-visible 规则完整性
import { readFileSync } from 'node:fs';

const css = readFileSync('collection/layout.css', 'utf8');
const js = readFileSync('collection/special.js', 'utf8');
let problems = 0;

// 1. 花括号配平（忽略注释与字符串里的括号，这里用简化状态机）
console.log('=== 1. 花括号配平 ===');
let depth = 0, inComment = false, inStr = null, line = 1, firstNeg = null;
for (let i = 0; i < css.length; i++) {
  const c = css[i], n = css[i + 1];
  if (c === '\n') { line++; continue; }
  if (inComment) { if (c === '*' && n === '/') { inComment = false; i++; } continue; }
  if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
  if (c === '/' && n === '*') { inComment = true; i++; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth < 0 && firstNeg === null) firstNeg = line; }
}
console.log(`  最终深度 ${depth}${depth === 0 ? ' ✓' : ' ✗'}`);
if (depth !== 0) problems++;
if (firstNeg !== null) { console.log(`  ⚠ 第 ${firstNeg} 行出现多余的 }`); problems++; }

// 2. 断点清单
console.log('\n=== 2. 断点清单 ===');
const bps = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
const counts = new Map();
for (const b of bps) counts.set(b, (counts.get(b) || 0) + 1);
for (const [b, n] of [...counts].sort((a, b) => b[0] - a[0])) console.log(`  ${b}px  ×${n}`);
if (counts.has(760)) { console.log('  ✗ 仍存在 760px（应与 768px 统一）'); problems++; }
else console.log('  ✓ 无 760px 遗留');

// 3. JS 与 CSS 断点一致
console.log('\n=== 3. JS matchMedia 断点与 CSS 一致 ===');
const jsBps = [...js.matchAll(/matchMedia\(\s*['"]\(max-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
for (const b of jsBps) {
  const ok = counts.has(b);
  console.log(`  ${ok ? '✓' : '✗'} special.js 用 ${b}px，CSS 中${ok ? '有' : '没有'}对应断点`);
  if (!ok) problems++;
}

// 4. focus-visible 规则
console.log('\n=== 4. focus-visible 规则 ===');
const checks = [
  [/:focus-visible\s*\{/, '基础 :focus-visible 规则'],
  [/html\[data-color-scheme="dark"\]\s*:focus-visible/, '暗色主题焦点环'],
  [/:focus:not\(:focus-visible\)/, '旧浏览器兜底'],
  [/input:focus-visible/, '输入控件焦点环'],
];
for (const [re, label] of checks) {
  const ok = re.test(css);
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) problems++;
}
// outline:none 的数量（用于人工确认每一处都有替代）
const outlineNone = [...css.matchAll(/outline:\s*none/g)].length;
console.log(`  · 全站仍有 ${outlineNone} 处 outline: none（已由上面的 :focus-visible 统一补上焦点环）`);

// 5. 安全区 token
console.log('\n=== 5. 安全区域 token ===');
for (const [re, label] of [
  [/--sat:\s*env\(safe-area-inset-top/, '--sat'],
  [/--sab:\s*env\(safe-area-inset-bottom/, '--sab'],
  [/--sal:\s*env\(safe-area-inset-left/, '--sal'],
  [/--sar:\s*env\(safe-area-inset-right/, '--sar'],
]) {
  const ok = re.test(css);
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) problems++;
}
const uses = [...css.matchAll(/var\(--sa[tblr]\)/g)].length;
console.log(`  · var(--sa*) 被使用 ${uses} 次`);

// 6. dvh
console.log('\n=== 6. 动态视口单位 ===');
const dvhCount = [...css.matchAll(/100dvh/g)].length;
const vhCount = [...css.matchAll(/(?<!d)100vh/g)].length;
console.log(`  · 100dvh ${dvhCount} 处，100vh ${vhCount} 处（100vh 作为兜底保留）`);
if (dvhCount < 3) { console.log('  ✗ 100dvh 少于预期（app-layout / modal-content / modal-img 共 3 处）'); problems++; }

console.log(problems === 0 ? '\n✅ CSS 校验全部通过' : `\n⚠ ${problems} 处需确认`);
// ★ 失败必须反映到退出码上（原来恒为 0，外部按退出码判定会把失败当通过）。
process.exit(problems === 0 ? 0 : 1);
