#!/usr/bin/env node
/**
 * serve.mjs —— 本目录的静态服务器。
 *
 * 为什么必须用它、不能直接双击 index.html：
 *   1. 文件夹读写（File System Access API）只在「安全上下文」可用，
 *      http://127.0.0.1 与 https:// 算，file:// 不算；
 *   2. 页面按 ES module 加载，file:// 下会被同源策略拦截。
 *
 * 用法：
 *   node tools/serve.mjs              # 默认 http://127.0.0.1:8080
 *   node tools/serve.mjs 9000         # 指定端口
 */

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    res.writeHead(400);
    res.end('400 Bad Request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  // 防目录穿越
  const rel = normalize(pathname).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + pathname);
    return;
  }

  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // 本地开发不缓存，避免改了文件看不到效果
    'Cache-Control': 'no-store'
  });
  res.end(readFileSync(file));
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  chat-demo 已启动');
  console.log('');
  console.log(`  打开：  http://${HOST}:${PORT}`);
  console.log('');
  console.log('  提示：必须用这个地址访问，直接双击 index.html 无法使用');
  console.log('        文件夹读写功能（浏览器安全策略限制）。');
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
