// 一次性脚本：把 three.js 内置到本地 vendor/ 目录，避免依赖 CDN。
// 用法（需要跳过本地 TLS 拦截时）：NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/fetch-three.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.160.0';

const targets = [
  ['build/three.module.min.js', 'vendor/three.module.js'],
  ['LICENSE', 'vendor/three.LICENSE'],
];

mkdirSync(resolve(ROOT, 'vendor'), { recursive: true });

for (const [remote, local] of targets) {
  const url = `https://unpkg.com/three@${VERSION}/${remote}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(ROOT, local), buf);
  console.log(`saved ${local} (${(buf.length / 1024).toFixed(1)} KiB)`);
}
