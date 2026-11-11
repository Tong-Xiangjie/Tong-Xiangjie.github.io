#!/usr/bin/env node
/**
 * 扫描 games/ 下的每个游戏目录，生成 games/index.json —— 给 games/index.html
 * 那个跳转页当"保底名单"用。
 *
 * 为什么要有这个文件：
 *   GitHub Pages 是纯静态托管，没有目录列表接口，所以一个静态 index.html 没法
 *   自己"看见"目录里有什么。games/index.html 的第一选择是运行时查 GitHub API
 *   （真正的动态，新加游戏不用管任何事），但 API 有 60 次/小时的匿名限额、也会
 *   断网/被墙。所以再落一份静态名单：页面先读它（瞬间出内容、离线也能用），
 *   再用 API 的结果去补充/纠正。
 *
 * 扫两层：
 *   games/<游戏>/index.html             普通游戏，目录名就是入口名
 *   games/<合集>/<子游戏>/index.html     合集（board_games/ 里那一堆棋就是），
 *                                       合集自己如果没有 index.html，就只当分组
 *                                       标题用；子游戏条目带 group 字段。
 *
 * 用法：
 *   node games/tools/build-index.mjs            # 写入（内容没变就不动文件）
 *   node games/tools/build-index.mjs --check    # 只检查，过期/缺失时 exit 1
 *
 * 这个脚本本身也被 .github/workflows/game-index.yml 调用：往 games/ 里推东西时
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

/** 这些目录名不是游戏，也不往里扫（放脚本/资源用的）。 */
const SKIP = new Set(['tools', 'node_modules', 'assets', 'img', 'images', 'css', 'js', 'lib', 'vendor', 'dist', 'font', 'fonts', 'shared']);
const isGameDir = (n) => !!n && !n.startsWith('.') && !n.startsWith('_') && !SKIP.has(n.toLowerCase());

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

/** 描述：meta description → 带 sub/tagline/desc 之类类名的元素 → 第一个 h1/h2/p（跟标题重名的不要）。 */
function descOf(html, title) {
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
  // 兜底：h1/h2 里第一个像"一句话介绍"的。
  // 刻意不看 h3（弹窗小标题，棋盘游戏里那个"导入对局存档"就是），也不看 p（多半是
  // 操作说明或错误提示）；再跳过跟标题重名的（否则卡片上标题显示两遍）、以及以表情
  // 或符号开头的（"⚙️ 连接配置"那种是界面标签，不是介绍）。宁可没有，也别写错的。
  for (const tag of ['h1', 'h2']) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    let h;
    while ((h = re.exec(body))) {
      const t = strip(h[1]);
      if (t.length >= 4 && t !== title && /^[\p{L}\p{N}]/u.test(t)) return clip(t);
    }
  }
  return '';
}

/** 目录名带「副本」「copy」「backup」的标成副本，页面上给个角标。 */
const isCopy = (dir) => /副本|copy|备份|backup|old|bak\b/i.test(dir);

async function collect() {
  const entries = await readdir(GAME_DIR, { withFileTypes: true });
  const games = [];
  /** 读一个 index.html，产出一条名单记录。rel 是相对 games/ 的路径（用 / 分隔）。 */
  const entryOf = async (rel, name, group) => {
    const index = join(GAME_DIR, ...rel.split('/'), 'index.html');
    if (!existsSync(index)) return null;
    const html = await readFile(index, 'utf8');
    const title = titleOf(html, name);
    return {
      dir: rel,
      group,
      // 入口路径用目录名：GitHub Pages 会按目录名做 302 -> .../ 的重定向，
      // 带中文/罗马数字的目录名也一样能用（页面里再逐段 encodeURIComponent）。
      title,
      desc: descOf(html, title),
      // ★ 字节数必须与平台无关：Windows 检出是 CRLF（多出约 1 字节/行），Linux
      //   runner 是 LF，直接 stat 出来的大小能差好几 KB —— 于是 workflow 每次跑
      //   都会"发现"文件变了，天天提交一次空改动。仓库里存的是 LF，所以按 LF
      //   折算才是 GitHub Pages 真正发出的字节数，也才能跨平台稳定。
      bytes: Buffer.byteLength(html.replace(/\r\n/g, '\n'), 'utf8'),
      copy: isCopy(rel) || undefined,
    };
  };

  for (const e of entries) {
    if (!e.isDirectory() || !isGameDir(e.name)) continue;
    // 第一层：games/<dir>/index.html
    const top = await entryOf(e.name, e.name, undefined);
    if (top) games.push(top);
    // 第二层：games/<dir>/<sub>/index.html —— 合集（比如 board_games/ 里那一堆棋）。
    // 合集自己没有 index.html 也没关系，它只作为分组标题出现。
    for (const s of await readdir(join(GAME_DIR, e.name), { withFileTypes: true })) {
      if (!s.isDirectory() || !isGameDir(s.name)) continue;
      const sub = await entryOf(`${e.name}/${s.name}`, s.name, e.name);
      if (sub) games.push(sub);
    }
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
  for (const g of games) { if (!g.copy) delete g.copy; if (!g.group) delete g.group; }
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
    console.error(`games/index.json 已过期：应有 ${data.count} 个游戏，现有 ${old ? old.count : '（无）'}`);
    process.exit(1);
  }
  console.log(`games/index.json 是最新的（${data.count} 个游戏）`);
  process.exit(0);
}

let old = null;
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次生成 */ }
if (old && JSON.stringify(old.games) === JSON.stringify(data.games) && old.count === data.count) {
  console.log(`games/index.json 无变化（${data.count} 个游戏），不重写`);
  process.exit(0);
}

await writeFile(OUT, json, 'utf8');
console.log(`已写入 games/index.json：${data.count} 个游戏`);
for (const g of data.games) {
  const flags = [g.group ? '合集 ' + g.group : '', g.copy ? '副本' : '', g.dup ? '重复' : ''].filter(Boolean).join('/');
  console.log(`  ${g.dir.padEnd(34)} ${String(Math.round(g.bytes / 1024)).padStart(4)} KB  ${g.title}${flags ? '  [' + flags + ']' : ''}`);
}
