#!/usr/bin/env node
/**
 * 扫描 game/ 下的每个游戏目录，生成 game/index.json —— 给 game/index.html 那个
 * 跳转页当"保底名单"用。
 *
 * 为什么要有这个文件：
 *   GitHub Pages 是纯静态托管，没有目录列表接口，所以一个静态 index.html 没法
 *   自己"看见"目录里有什么。game/index.html 的第一选择是运行时查 GitHub API
 *   （真正的动态，新加游戏不用管任何事），但 API 有 60 次/小时的匿名限额、也会
 *   断网/被墙。所以再落一份静态名单：页面先读它（瞬间出内容、离线也能用），
 *   再用 API 的结果去补充/纠正。
 *
 * 用法：
 *   node game/tools/build-index.mjs            # 写入（内容没变就不动文件）
 *   node game/tools/build-index.mjs --check    # 只检查，过期/缺失时 exit 1
 *
 * 这个脚本本身也被 .github/workflows/game-index.yml 调用：往 game/ 里推东西时
 * 自动重跑并把 index.json 提交回仓库，所以新增游戏不需要手工维护这份名单。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = resolve(HERE, '..');
const OUT = join(GAME_DIR, 'index.json');
const CHECK = process.argv.includes('--check');

/** 只解最常见的实体，足够处理标题和描述。 */
function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const strip = (s) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function textOf(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

/** <title>；取不到就用目录名。 */
function titleOf(html, dir) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? strip(m[1]) : '';
  return t || dir;
}

/** 描述：meta description → 带 sub/tagline/desc 之类类名的元素 → 第一个 h1/h2/h3/p。 */
function descOf(html) {
  const meta = html.match(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*>/i);
  if (meta) {
    const c = meta[0].match(/content\s*=\s*["']([\s\S]*?)["']/i);
    const t = c ? strip(c[1]) : '';
    if (t) return t.length > 78 ? t.slice(0, 78) + '…' : t;
  }
  const body = textOf(html);
  const clip = (t) => (t.length > 78 ? t.slice(0, 78) + '…' : t);
  // 这类页面的"一句话介绍"通常挂在 boot-sub / subtitle / tagline 这种类名上。
  // 直接一次正则定位到那个元素，不要用"遍历所有元素"的写法：外层 <div> 会把
  // 内层元素一起吃掉，扫描位置跳过它们，内层的 .boot-sub 永远轮不到。
  const kw = /<([a-z][a-z0-9]*)\s+[^>]*class\s*=\s*["'][^"']*(?:sub|subtitle|tagline|slogan|lead|intro|desc|caption|brief)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i;
  const km = body.match(kw);
  if (km) {
    const t = strip(km[2]);
    if (t.length >= 4 && !/^[\s\d.·—_-]*$/.test(t)) return clip(t);
  }
  for (const tag of ['h1', 'h2', 'h3', 'p']) {
    const h = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!h) continue;
    const t = strip(h[1]);
    if (t.length >= 4) return clip(t);
  }
  return '';
}

/** 目录名带「副本」「copy」「backup」的标成副本，页面上给个角标。 */
const isCopy = (dir) => /副本|copy|备份|backup|old|bak\b/i.test(dir);

async function collect() {
  const entries = await readdir(GAME_DIR, { withFileTypes: true });
  const games = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || e.name === 'tools' || e.name === 'node_modules') continue;
    const index = join(GAME_DIR, e.name, 'index.html');
    if (!existsSync(index)) continue;
    const html = await readFile(index, 'utf8');
    games.push({
      dir: e.name,
      // 优先用目录名做入口路径：GitHub Pages 会按目录名做 302 -> .../ 的重定向，
      // 带中文/罗马数字的目录名也一样能用（页面里再做一次 encodeURI）。
      title: titleOf(html, e.name),
      desc: descOf(html),
      // ★ 字节数必须与平台无关：Windows 检出是 CRLF（多出约 1 字节/行），Linux
      //   runner 是 LF，直接 stat 出来的大小能差好几 KB —— 于是 workflow 每次跑
      //   都会"发现"文件变了，天天提交一次空改动。仓库里存的是 LF，所以按 LF
      //   折算才是 GitHub Pages 真正发出的字节数，也才能跨平台稳定。
      bytes: Buffer.byteLength(html.replace(/\r\n/g, '\n'), 'utf8'),
      copy: isCopy(e.name) || undefined,
    });
  }
  // 排序也用逐码位比较，不用 localeCompare('zh')：后者依赖 ICU 版本和语言数据，
  // runner 上的 Node 与本地不同就可能排出不同顺序，同样会造成无意义的重排提交。
  games.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  // 同名的（比如「已读」和「已读 - 副本」）在后一个上打重复标
  const seen = new Map();
  for (const g of games) {
    const k = g.title + '\u0000' + g.desc;
    if (seen.has(k)) g.dup = true;
    else seen.set(k, g.dir);
  }
  for (const g of games) if (!g.copy) delete g.copy;
  return { version: 1, count: games.length, games };
}

const data = await collect();
const json = JSON.stringify(data, null, 2) + '\n';

if (CHECK) {
  let old = null;
  try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 缺失或坏掉 */ }
  const same = old && old.count === data.count &&
    JSON.stringify(old.games) === JSON.stringify(data.games);
  if (!same) {
    console.error(`game/index.json 已过期：应有 ${data.count} 个游戏，现有 ${old ? old.count : '（无）'}`);
    process.exit(1);
  }
  console.log(`game/index.json 是最新的（${data.count} 个游戏）`);
  process.exit(0);
}

let old = null;
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次生成 */ }
if (old && JSON.stringify(old.games) === JSON.stringify(data.games) && old.count === data.count) {
  console.log(`game/index.json 无变化（${data.count} 个游戏），不重写`);
  process.exit(0);
}

await writeFile(OUT, json, 'utf8');
console.log(`已写入 game/index.json：${data.count} 个游戏`);
for (const g of data.games) {
  const flags = [g.copy ? '副本' : '', g.dup ? '重复' : ''].filter(Boolean).join('/');
  console.log(`  ${g.dir.padEnd(20)} ${String(Math.round(g.bytes / 1024)).padStart(4)} KB  ${g.title}${flags ? '  [' + flags + ']' : ''}`);
}
