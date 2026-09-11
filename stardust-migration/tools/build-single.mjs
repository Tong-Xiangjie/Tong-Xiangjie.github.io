/**
 * 打包脚本：把 js/ 下的模块合并成单文件 HTML，双击即可运行（file:// 也能跑）。
 *
 * 为什么需要它：
 *   浏览器不允许通过 file:// 加载 ES Module（不透明来源被 CORS 拦截），
 *   所以模块版必须用本地 HTTP 服务打开。这个脚本把模块按依赖顺序摊平进
 *   一个 <script type="module"> 里，生成的文件没有任何外部请求，双击即可玩。
 *
 * 用法：
 *   node tools/build-single.mjs
 * 输出：
 *   stardust-migration-single.html
 *
 * 说明：模块版（index.html + js/）仍然是唯一事实来源，本脚本不修改源码，
 *       每次改完源码重新跑一次即可。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '..', 'stardust-migration-single.html');

/**
 * 模块顺序 = 依赖顺序。
 * 因为摊平后所有 const / function 共享一个作用域，顺序必须保证"声明先于执行"。
 * （函数声明会提升，但 const 不会，所以 data.js 必须在 state.js 之前。）
 */
const ORDER = [
  'time.js',
  'rng.js',
  'data.js',
  'utils.js',
  'state.js',
  'events.js',
  'tasks.js',
  'offline.js',
  'save.js',
  'ui.js',
  'main.js',
];

/**
 * 收集顶层声明名（const / let / var / function / class）
 * 摊平后所有模块共享一个作用域，重名会直接抛 SyntaxError，
 * 所以这里提前检查并给出明确报错。
 */
function topLevelDeclarations(code) {
  const names = [];
  for (const m of code.matchAll(
    /^(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.push(m[1]);
  }
  return names;
}

/** 去掉 import / export 语句，保留其余代码原样 */
function flatten(code, file) {
  let out = code;

  // 多行 import：import {\n ... \n} from './x.js';
  out = out.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '');
  // 单行 import：import x from './x.js';  /  import './x.js';
  out = out.replace(/^import\s+.*?from\s*['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^import\s*['"][^'"]+['"];?\s*$/gm, '');

  // export { a, b };  （可能跨行）
  out = out.replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
  // export const / let / function / class / async function
  out = out.replace(/^export\s+(async\s+function|function|class|const|let|var)\b/gm, '$1');

  // 兜底检查：不应再有裸 import/export 语句
  const leftover = out.match(/^\s*(import|export)\s/m);
  if (leftover) {
    throw new Error(`${file} 里仍有未处理的 ${leftover[1]} 语句，请检查打包规则。`);
  }
  return out.trim();
}

const parts = [];
const seen = new Map(); // 声明名 -> 首次出现的文件
const duplicates = [];

for (const name of ORDER) {
  const file = path.join(ROOT, 'js', name);
  const code = fs.readFileSync(file, 'utf8');
  const flat = flatten(code, name);

  for (const decl of topLevelDeclarations(flat)) {
    if (seen.has(decl)) {
      duplicates.push(`${decl}（${seen.get(decl)} 与 ${name}）`);
    } else {
      seen.set(decl, name);
    }
  }

  parts.push(`/* ==================== js/${name} ==================== */\n${flat}`);
}

if (duplicates.length) {
  console.error('打包失败：以下顶层声明在摊平后会重名，请改名或提取到 utils.js：');
  for (const d of duplicates) console.error('  - ' + d);
  process.exit(1);
}

console.log(`顶层声明 ${seen.size} 个，无重名冲突。`);

// 生成的 index.html：去掉外部 css / js 引用，改为内联
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

html = html.replace(
  /\s*<link rel="stylesheet" href="\.\/css\/style\.css" \/>/,
  `\n  <style>\n${css}\n  </style>`,
);
// 单文件版没有 manifest / sw / 外部图标，去掉这些引用（避免 404 与重复控制台警告）
html = html.replace(/\s*<link rel="manifest"[^>]*\/>/, '');
html = html.replace(/\s*<link rel="icon"[^>]*\/>/, '');
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*\/>/, '');

const bundle = parts.join('\n\n');
html = html.replace(
  /\s*<script type="module" src="\.\/js\/main\.js"><\/script>/,
  `\n  <script type="module">\n${bundle}\n  </script>`,
);

// 加一条注释，说明这是生成文件
html = html.replace(
  '<!DOCTYPE html>',
  `<!DOCTYPE html>\n<!--\n  星尘迁徙 · 单文件版（自动生成，请勿直接编辑）\n  源码在 stardust-migration/ 目录，修改后运行： node tools/build-single.mjs\n  这一版不含 PWA（manifest / Service Worker），但双击即可玩。\n-->`,
);

if (html.includes('src="./js/main.js"') || html.includes('href="./css/style.css"')) {
  throw new Error('内联失败：仍存在外部资源引用。');
}

fs.writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`已生成单文件版：${OUT}`);
console.log(`  大小：${kb} KB`);
console.log(`  模块：${ORDER.join(' → ')}`);
