#!/usr/bin/env node
// 把整个游戏打包成一个自包含的 HTML 文件（单文件版）。
//
// 做法不是把模块拼接成一个巨型脚本（那样顶层 const/class 会互相撞名），
// 而是给每个模块分配一个 bare specifier（mod/0、mod/1 …），用 import map
// 把它们映射成 data: URL 形式的模块源码。模块内部的相对导入会被改写成
// 对应的 mod/N，所以浏览器解析起来和原来的多文件结构完全等价，
// 而且整份文件可以离线双击打开。
//
// 用法：
//   node tools/build-single.mjs                       → dist/BeamNG-single.html
//   node tools/build-single.mjs out/car.html          → 指定输出路径
//   node tools/build-single.mjs --no-three            → 不内联 three.js（体积小但依赖 vendor/）

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith('--'));
const OUT = resolve(ROOT, outArg ?? 'dist/BeamNG-single.html');

/** 从源码里找出所有 import/export ... from '…' 的说明符。 */
function specifiersOf(code) {
  const out = [];
  const pats = [
    /^[ \t]*import\s+[^;'"]*?\sfrom\s*['"]([^'"]+)['"]/gm,   // import x / { x } from '…'
    /^[ \t]*import\s*['"]([^'"]+)['"]/gm,                    // import '…'
    /^[ \t]*export\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm, // export … from '…'
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(code))) out.push(m[1]);
  }
  return out;
}

/** 相对说明符 → 绝对文件路径；裸说明符（three）原样返回。 */
function resolveSpec(spec, fromFile) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  return resolve(dirname(fromFile), spec);
}

const entry = resolve(ROOT, 'js/main.js');
const modules = new Map();   // absPath → { id, code, deps: Map<spec, id> }
const queue = [entry];

// --- 1. 广度优先收集模块依赖图 ---
while (queue.length) {
  const file = queue.shift();
  if (modules.has(file)) continue;
  const code = await readFile(file, 'utf8');
  const mod = { id: 'mod/' + modules.size, path: file, code, deps: new Map(), bare: new Set() };
  modules.set(file, mod);
  for (const spec of specifiersOf(code)) {
    const abs = resolveSpec(spec, file);
    if (!abs) { mod.bare.add(spec); continue; }
    mod.deps.set(spec, abs);
    if (!modules.has(abs)) queue.push(abs);
  }
}

// --- 2. 改写说明符 + 生成 data: URL ---
const importMap = {};
let totalRaw = 0, totalB64 = 0;
for (const mod of modules.values()) {
  let code = mod.code;
  for (const [spec, abs] of mod.deps) {
    const target = modules.get(abs);
    if (!target) throw new Error(`未收集到模块：${abs}`);
    // 只替换字符串字面量本体，保留引号形式
    code = code.split(`'${spec}'`).join(`'${target.id}'`);
    code = code.split(`"${spec}"`).join(`"${target.id}"`);
  }
  for (const spec of mod.bare) {
    if (spec === 'three' || spec.startsWith('three/')) importMap[spec] = spec;
  }
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  totalRaw += code.length;
  totalB64 += b64.length;
  importMap[mod.id] = `data:text/javascript;base64,${b64}`;
}

// --- 3. 内联 index.html 与 CSS ---
let html = await readFile(resolve(ROOT, 'index.html'), 'utf8');
const css = await readFile(resolve(ROOT, 'css/style.css'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, `<style>\n${css}\n</style>`);
// index.html 末尾是一段引导脚本：file:// 下跳单文件版，http(s) 下注入 js/main.js。
// 单文件版里两个分支都不需要了，整段换成 import map + 直接 import 入口。
const bootRe = /<!--\s*入口。[\s\S]*?<\/script>\s*(?=<\/body>)/;
if (!bootRe.test(html)) throw new Error('没找到 index.html 末尾的引导脚本');
html = html.replace(
  bootRe,
  `<script type="importmap">\n${JSON.stringify({ imports: importMap }, null, 2)}\n</script>\n` +
  `<script type="module">import '${modules.get(entry).id}';</script>\n`,
);

const banner = `<!--
  撞不坏 · 软体车辆物理沙盒 —— 单文件构建
  由 tools/build-single.mjs 自动生成，请勿手工编辑。
  模块数 ${modules.size}，源码 ${(totalRaw / 1024).toFixed(0)} KB，内联后 ${(totalB64 / 1024).toFixed(0)} KB。
  单独使用 three.js 时请保留 vendor/three.module.js 并去掉 --no-three。
-->
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, banner + html, 'utf8');

const stat = (await import('node:fs')).statSync(OUT);
console.log(`单文件构建完成：${relative(ROOT, OUT)}`);
console.log(`  模块 ${modules.size} 个 | 源码 ${(totalRaw / 1024).toFixed(1)} KB | 输出 ${(stat.size / 1024).toFixed(0)} KB`);
