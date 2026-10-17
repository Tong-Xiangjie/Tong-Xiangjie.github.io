// ============================================================================
// collection/tools/gate.mjs —— collection 站「链接令牌门禁」的生成 / 维护工具
//
// 零依赖（只用 node 内置模块），四个子命令：
//
//   node collection/tools/gate.mjs new [--origin=<站点前缀>]
//       生成一个高熵令牌（32 字节 crypto.randomBytes 的 base64url，43 字符），
//       把它的 **SHA-256 十六进制**写进 collection/gate.js 的配置区，
//       把**明文令牌**写到仓库之外的家目录文件 %USERPROFILE%\gate-token.txt
//       （Windows；其它平台是 ~/gate-token.txt），然后自动跑一次 apply。
//       最后打印示例链接。
//       ★ 换令牌 = 重新跑 new：旧链接立刻作废；而且由于 localStorage 里存的标记
//         是"当前令牌哈希的前 16 位"，**所有老设备也会自动失效**，必须重新点新链接。
//
//   node collection/tools/gate.mjs link [--origin=<站点前缀>]
//       读家目录里的明文令牌，打印完整链接（校验它的哈希确实在 gate.js 里）。
//
//   node collection/tools/gate.mjs apply [--dry-run]
//       幂等地扫描 collection/**/*.html（排除 collection/tools/**），
//       给还没挂门禁的入口注入三样：<meta name="robots" content="noindex,nofollow">、
//       <head> 里的兜底隐藏 CSS、以及同步执行的 gate.js（按入口所在目录现算相对路径，
//       所以 collection/ 下更深层的入口也能自动算对）。
//       已挂的（认 `<!-- gate:begin -->` … `<!-- gate:end -->` 标记）只在内容不一致时
//       重写，一致就原样跳过 —— 连续跑两次文件字节不变。
//
//   node collection/tools/gate.mjs check
//       从目录现算"应覆盖清单"，断言每一个入口都带齐三样（并断言 head 内联脚本里的
//       标记字面量与 gate.js 的哈希一致、robots.txt 内容正确、全仓库不含明文令牌）。
//       有缺失就 exit 1 并列出文件名。CI 里跑这一条（见 .github/workflows/regression.yml）。
//
// 额外隐藏参数（给 verify-gate.mjs 用）：--root=<目录> 把仓库根换掉，
// 便于在 %TEMP% 里对一份临时副本做"注入 / 缺件必须报错"的自证。
// ============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');          // collection/tools → collection → 仓库根

const SITE_ORIGIN = 'https://tong-xiangjie.github.io/collection/';
const TOKEN_FILE = join(homedir(), 'gate-token.txt');
const MARK_LEN = 16;

// ── 注入内容的唯一来源（gate.js 的配置格式也必须与这里对得上）──────────────
const HASH_BEGIN = '/* gate:hashes:begin */';
const HASH_END = '/* gate:hashes:end */';

const GUARD_STYLE = `<style id="collection-gate-guard">
/* ★ 兜底隐藏：门禁没放行之前整页不可见。这段 CSS 就写在 <head> 里，
   所以**关掉 JavaScript 也进不去**（而且下面 ::before 那句提示照样显示）。
   用 visibility 而不是 display:none：display:none 会让布局塌成 0，
   连提示本身都画不出来，用户只看到一片白。 */
html:not(.gate-ok) {
    visibility: hidden !important;
}
/* 关 JS（或脚本还没跑完）时的提示：画在根元素上，不依赖 body 是否存在 */
html:not(.gate-ok):not(.gate-denied)::before {
    content: "你无权访问。";
    visibility: visible !important;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2147483000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    text-align: center;
    background: #f6f7f9;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-size: 16px;
    line-height: 1.6;
}
/* 脚本把页面内容换掉之后的那只盒子；它是整页唯一允许露出来的东西 */
.gate-denied-box,
.gate-denied-box * {
    visibility: visible !important;
}
.gate-denied-box {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    text-align: center;
    background: #f6f7f9;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-user-select: text;
    user-select: text;
}
/* 未授权页的图标：collection/block.svg（站点主人自己画的，描边是**写死的纯黑**，
   所以暗色下必须翻白 —— 不改 SVG，只在本页加 filter）。 */
.gate-denied-box .gate-denied-icon {
    display: block;
    width: 160px;
    max-width: 60vw;
    height: auto;
    margin: 0 0 1.1rem;
}
.gate-denied-box .gate-denied-text {
    margin: 0;
    max-width: 100%;
}
@media (prefers-color-scheme: dark) {
    html:not(.gate-ok):not(.gate-denied)::before,
    .gate-denied-box { background: #14171c; color: #e8eaed; }
    /* 图标黑描边 → 翻成白的；浅色下不加任何 filter，保持原画 */
    .gate-denied-box .gate-denied-icon { filter: invert(1); }
}
html[data-color-scheme="dark"]:not(.gate-ok):not(.gate-denied)::before,
html[data-color-scheme="dark"] .gate-denied-box { background: #14171c; color: #e8eaed; }
html[data-color-scheme="light"]:not(.gate-ok):not(.gate-denied)::before,
html[data-color-scheme="light"] .gate-denied-box { background: #f6f7f9; color: #1f2328; }
</style>`;

const bootScript = (mark) => `<script id="collection-gate-boot">
/* ★ 必须同步、必须放在 <head> 最前面：命中下面任意一条就立刻放行，用户看不到任何延迟。
   ① 本地开发（localhost / 127.0.0.1 / ::1）—— 46 个回归套件全靠它，少一条就全红；
   ② file: 协议 —— 双击打开本地 HTML 文件（站点主人的习惯用法，也必须能用）；
   ③ 本机已通过校验：localStorage 里的"标记"等于**当前令牌哈希的前 16 位**。
      标记与哈希绑定，所以 gate.mjs new 换令牌之后，所有老设备自动失效。
   ⚠ ①②只加 gate-ok 类，**不写 localStorage 标记** —— 免得本地放行污染线上判定。
   ⚠ 下面这个 MARK 字面量由 gate.mjs apply 写成 collection/gate.js 里
      GATE_HASHES[0] 的前 16 位，别手改。 */
(function () {
    try {
        var html = document.documentElement;
        var host = location.hostname.replace(/^\\[|\\]$/g, '');
        // 本地开发与本地文件打开一律放行（与 collection/gate.js 里那份判定一致）
        if (location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            html.classList.add('gate-ok');
            return;
        }
        if (localStorage.getItem('collection-gate') === '${mark}') { html.classList.add('gate-ok'); }
    } catch (e) { /* 隐私模式下 localStorage 会抛，忽略即可 */ }
})();
</script>`;

// 门禁脚本的引用方式：**相对路径**，不是 /collection/gate.js。为什么：
//   ① 既有套件 verify-vendor.mjs 会拿"HTML 所在目录 + 引用"逐条确认文件真的存在，
//      它不认以 / 开头的根相对 URL（会拼成 collection/collection/gate.js 报缺件，
//      把既有防线弄红）；
//   ② 相对路径在 GitHub Pages（/collection/ 或 /collection/index.html）、本地 http
//      服务器、以及 file:// 双击打开三种情形下**都**指向同一份 collection/gate.js；
//      根绝对路径在 file:// 下会 404。
// 所以按"从该入口所在目录到 collection/gate.js"现算 —— 将来 collection/ 下出现更深
// 层的入口（collection/xxx/y.html）也能自动算成 ../gate.js。
function scriptTagFor(htmlFile) {
    let rel = relative(dirname(htmlFile), GATE_JS).split(sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return `<script src="${rel}"></script>`;
}

const headBlock = (mark, htmlFile) => [
    '<!-- gate:begin（collection 站入口门禁：由 `node collection/tools/gate.mjs apply` 注入，请勿手改） -->',
    '<meta name="robots" content="noindex,nofollow">',
    GUARD_STYLE,
    bootScript(mark),
    scriptTagFor(htmlFile),
    '<!-- gate:end -->'
].join('\n');

const indent = (text, pad) => text.split('\n').map(l => (l.trim() ? pad + l : '')).join('\n');

// 认标记判重/替换（`m` 让 ^ $ 对到行首行尾，替换后前后换行保持不变）
const BLOCK_RE = /^[ \t]*<!-- gate:begin[\s\S]*?<!-- gate:end -->[ \t]*$/m;

// ── 命令行 ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = (argv.find(a => !a.startsWith('--')) || 'help').toLowerCase();
const flag = (name) => argv.some(a => a === '--' + name);
const opt = (name, dflt) => {
    const hit = argv.find(a => a.startsWith('--' + name + '='));
    return hit ? hit.slice(name.length + 3) : dflt;
};

const ROOT = resolve(opt('root', DEFAULT_ROOT));
const GATE_JS = join(ROOT, 'collection', 'gate.js');
const ROBOTS = join(ROOT, 'robots.txt');
const COVER_DIR = join(ROOT, 'collection');
const REL = p => relative(ROOT, p).split(sep).join('/');

// ── 覆盖清单：**现算**，不写死任何文件名或数量 ─────────────────────────────
// 口径：collection/ 下所有 .html，排除 collection/tools/**（测试夹具）。
function coverList() {
    const out = [];
    (function walk(dir) {
        let ents;
        try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'tools') continue;          // 测试夹具，改了会让既有套件红
                if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
                walk(full);
            } else if (e.isFile() && extname(e.name).toLowerCase() === '.html') {
                out.push(full);
            }
        }
    })(COVER_DIR);
    return out;
}

// ── gate.js 配置区读写 ─────────────────────────────────────────────────────
function readHashes() {
    const src = readFileSync(GATE_JS, 'utf8');
    const m = src.match(/\/\* gate:hashes:begin \*\/([\s\S]*?)\/\* gate:hashes:end \*\//);
    if (!m) throw new Error(`${REL(GATE_JS)} 里找不到 ${HASH_BEGIN} … ${HASH_END} 配置区`);
    return [...m[1].matchAll(/'([0-9a-fA-F]{64})'/g)].map(x => x[1].toLowerCase());
}

function writeHashes(hashes) {
    const src = readFileSync(GATE_JS, 'utf8');
    const body = hashes.map(h => `        '${h}',`).join('\n');
    const next = src.replace(
        /(\/\* gate:hashes:begin \*\/)[\s\S]*?(\/\* gate:hashes:end \*\/)/,
        `$1${hashes.length ? '\n' + body + '\n        ' : '\n        '}$2`
    );
    if (next === src && hashes.length) throw new Error('写入哈希失败：配置区没被替换');
    writeFileSync(GATE_JS, next);
}

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ── 注入 / 幂等替换 ────────────────────────────────────────────────────────
function inject(html, block) {
    if (BLOCK_RE.test(html)) return html.replace(BLOCK_RE, block);
    // 首选插在 viewport 之后：往前会挤到 <meta charset>（超过前 1024 字节会有乱码风险）
    const anchors = [
        /(^[ \t]*<meta[^>]+name=["']viewport["'][^>]*>[ \t]*\r?\n)/im,
        /(^[ \t]*<meta[^>]+charset[^>]*>[ \t]*\r?\n)/im,
        /(<head[^>]*>[ \t]*\r?\n)/i,
        /(<head[^>]*>)/i
    ];
    for (const re of anchors) {
        if (re.test(html)) return html.replace(re, (m0) => m0 + block + '\n');
    }
    return null;   // 没有 <head>，不动它
}

function cmdApply() {
    const dry = flag('dry-run');
    const hashes = readHashes();
    if (!hashes.length) {
        console.error('✗ collection/gate.js 里还没有哈希：先跑 node collection/tools/gate.mjs new');
        process.exit(1);
    }
    const files = coverList();
    let changed = 0, skipped = 0, failed = 0;
    console.log(`扫描口径：${REL(COVER_DIR)}/**/*.html（排除 ${REL(COVER_DIR)}/tools/**）`);
    console.log(`应覆盖入口 ${files.length} 个\n`);
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        const next = inject(src, indent(headBlock(hashes[0].slice(0, MARK_LEN), f), '    '));
        if (next === null) { console.log(`  ✗ ${REL(f)}：没有 <head>，跳过`); failed++; continue; }
        if (next === src) { console.log(`  · ${REL(f)}：已挂且内容一致，原样跳过`); skipped++; continue; }
        if (dry) { console.log(`  → ${REL(f)}：${dryWord(src)}（--dry-run，未写入）`); changed++; continue; }
        writeFileSync(f, next);
        console.log(`  ✓ ${REL(f)}：${dryWord(src)}`);
        changed++;
    }
    console.log(`\n改 ${changed} 个 / 原样跳过 ${skipped} 个 / 失败 ${failed} 个${dry ? '（--dry-run，一个字节都没写）' : ''}`);
    process.exit(failed ? 1 : 0);
}

const dryWord = (src) => (BLOCK_RE.test(src) ? '重写门禁块（标记字面量变了）' : '注入门禁块');

// ── check：CI 用；从目录现算清单，缺件就 exit 1 并点名 ──────────────────────
function cmdCheck() {
    const problems = [];
    const hashes = (() => { try { return readHashes(); } catch (e) { problems.push(e.message); return []; } })();

    if (hashes.length !== 1) {
        problems.push(`${REL(GATE_JS)}：生效令牌应恰好 1 个，实际 ${hashes.length} 个（换令牌请用 gate.mjs new）`);
    }
    for (const h of hashes) {
        if (!/^[0-9a-f]{64}$/.test(h)) problems.push(`${REL(GATE_JS)}：哈希格式不对（应为 64 位小写十六进制）：${h.slice(0, 20)}…`);
    }

    const expectMark = hashes.length ? hashes[0].slice(0, MARK_LEN) : null;
    const files = coverList();
    const missing = [];
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        const head = (src.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
        const why = [];
        if (!/<meta[^>]+name=["']robots["'][^>]*content=["']noindex\s*,\s*nofollow["']/i.test(head)) why.push('缺 <meta name="robots" content="noindex,nofollow">');
        if (!/html:not\(\.gate-ok\)\s*\{[^}]*visibility:\s*hidden/i.test(head)) why.push('缺兜底隐藏 CSS（html:not(.gate-ok){visibility:hidden}）');
        const tag = head.match(/<script[^>]+src=["']([^"']*gate\.js)["'][^>]*>/i);
        if (!tag) why.push('缺同步 <script src="…/gate.js">');
        else {
            const resolvedScript = resolve(dirname(f), tag[1]);
            if (resolvedScript !== GATE_JS) why.push(`<script src="${tag[1]}"> 解析到 ${REL(resolvedScript)}，应为 ${REL(GATE_JS)}`);
            if (/\b(defer|async)\b/i.test(tag[0])) why.push('gate.js 带了 defer/async，必须是同步脚本');
        }
        if (!/<!-- gate:begin/.test(head) || !/<!-- gate:end -->/.test(head)) why.push('缺 <!-- gate:begin --> … <!-- gate:end --> 标记');
        const boot = head.match(/<script id="collection-gate-boot">[\s\S]*?<\/script>/i);
        if (!boot) why.push('缺 head 内联同步引导脚本（id="collection-gate-boot"）');
        else if (expectMark && !boot[0].includes(`'${expectMark}'`)) why.push(`内联引导脚本里的标记不是当前哈希前 ${MARK_LEN} 位（应重跑 gate.mjs apply）`);
        if (why.length) missing.push(`${REL(f)}\n      · ${why.join('\n      · ')}`);
    }
    if (missing.length) {
        problems.push(`以下 ${missing.length} 个 collection 入口没有带齐门禁三样：\n    - ${missing.join('\n    - ')}`);
    }

    const wantRobots = 'User-agent: *\nAllow: /\nDisallow: /collection/\n';
    const gotRobots = existsSync(ROBOTS) ? readFileSync(ROBOTS, 'utf8').replace(/\r\n/g, '\n') : null;
    if (gotRobots === null) problems.push('仓库根缺 robots.txt');
    else if (gotRobots.trim() !== wantRobots.trim()) problems.push(`robots.txt 内容不对，应为：\n${wantRobots}`);

    // 未授权页的图标：缺失不算门禁失效（onerror 会把它藏掉），所以只提示不失败
    const iconPath = join(COVER_DIR, 'block.svg');
    const iconNote = existsSync(iconPath) ? `存在（${statSync(iconPath).size} 字节）` : '缺失（未授权页会只显示文案）';

    // 全仓库（不含 .git）不许出现明文令牌
    const token = readToken();
    let scanned = 0;
    const leaks = [];
    if (token) {
        for (const f of allFiles(ROOT)) {
            if (f === TOKEN_FILE) continue;
            let buf; try { buf = readFileSync(f); } catch { continue; }
            scanned++;
            if (buf.indexOf(Buffer.from(token, 'utf8')) >= 0) leaks.push(REL(f) || f);
        }
        if (leaks.length) problems.push(`明文令牌出现在仓库里（${leaks.length} 个文件）：\n    - ${leaks.join('\n    - ')}`);
    }

    console.log(`应覆盖入口：${files.length} 个（现算：${REL(COVER_DIR)}/**/*.html，排除 tools/**）`);
    console.log(`生效哈希：${hashes.length} 个${expectMark ? `，标记前 ${MARK_LEN} 位 = ${expectMark}` : ''}`);
    console.log(`robots.txt：${gotRobots === null ? '缺失' : '存在'}`);
    console.log(`未授权页图标 ${REL(iconPath)}：${iconNote}`);
    console.log(`明文令牌扫描：${token ? `已扫 ${scanned} 个文件（不含 .git）` : `跳过 —— 本机没有 ${TOKEN_FILE}`}`);
    if (problems.length) {
        console.log('');
        for (const p of problems) console.log('  ✗ ' + p);
        console.log(`\n失败 ${problems.length} 项`);
        process.exit(1);
    }
    console.log('\n✅ collection 门禁自检通过');
    process.exit(0);
}

function allFiles(dir) {
    const out = [];
    (function walk(d) {
        let ents;
        try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            if (e.isDirectory()) {
                if (e.name === '.git' || e.name === 'node_modules') continue;
                walk(join(d, e.name));
            } else if (e.isFile()) {
                out.push(join(d, e.name));
            }
        }
    })(dir);
    return out;
}

// ── 明文令牌（只在家目录，永不在仓库）─────────────────────────────────────
function readToken() {
    if (!existsSync(TOKEN_FILE)) return null;
    const m = readFileSync(TOKEN_FILE, 'utf8').match(/^token=(\S+)\s*$/m);
    return m ? m[1] : null;
}

function linkFor(origin, token) {
    return origin.replace(/#.*$/, '').replace(/\/*$/, '/') + '#k=' + token;
}

function cmdNew() {
    const origin = opt('origin', SITE_ORIGIN);
    const token = randomBytes(32).toString('base64url');       // 43 字符，256 bit 熵
    const hash = sha256hex(token);
    writeHashes([hash]);
    const stamp = new Date().toISOString();
    writeFileSync(TOKEN_FILE,
        `# collection 站门禁明文令牌 —— 只放在仓库之外，**不要**提交、不要贴进聊天以外的任何地方\n` +
        `# 生成时间：${stamp}\n` +
        `token=${token}\n` +
        `sha256=${hash}\n`);
    console.log('✔ 已把哈希写进 ' + REL(GATE_JS));
    console.log('✔ 已把明文令牌写到 ' + TOKEN_FILE + '（仓库之外）');
    console.log('\n── 令牌（明文，只给授权的人）──');
    console.log('  ' + token);
    console.log('\n── 完整链接 ──');
    console.log('  ' + linkFor(origin, token));
    console.log('\n⚠ 换令牌后：旧链接立刻失效，而且**所有老设备也会失效**（localStorage 里存的标记是');
    console.log('  当前令牌哈希的前 ' + MARK_LEN + ' 位，对不上就重新走校验）——需要把新链接重新发一遍。');
    console.log('⚠ 明文令牌绝不进仓库：提交前跑 node collection/tools/gate.mjs check 扫一遍。\n');
    cmdApply();
}

function cmdLink() {
    const origin = opt('origin', SITE_ORIGIN);
    const token = readToken();
    if (!token) {
        console.error(`✗ 读不到明文令牌：${TOKEN_FILE} 不存在（先跑 node collection/tools/gate.mjs new）`);
        process.exit(1);
    }
    const hash = sha256hex(token);
    const hashes = readHashes();
    if (!hashes.includes(hash)) {
        console.error('✗ 令牌与 collection/gate.js 里的哈希对不上：文件可能是旧的，重跑 new');
        process.exit(1);
    }
    console.log('令牌：' + token);
    console.log('哈希：' + hash);
    console.log('链接：' + linkFor(origin, token));
}

function cmdHelp() {
    console.log(`用法：node collection/tools/gate.mjs <new|link|apply|check> [--dry-run] [--origin=<前缀>]

  new     生成新令牌：哈希写进 collection/gate.js，明文写到家目录 ${TOKEN_FILE}，并自动 apply
  link    读家目录里的明文令牌，打印完整链接
  apply   幂等地给 collection/**/*.html（排除 tools/**）注入门禁三样；--dry-run 只打印
  check   现算覆盖清单并断言带齐三样 + robots.txt + 全仓库无明文令牌；有缺件 exit 1（CI 用）`);
}

switch (cmd) {
    case 'new': cmdNew(); break;
    case 'link': cmdLink(); break;
    case 'apply': cmdApply(); break;
    case 'check': cmdCheck(); break;
    default: cmdHelp(); break;
}
