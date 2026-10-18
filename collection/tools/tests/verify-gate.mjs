// ============================================================================
// verify-gate.mjs —— collection 站「链接令牌门禁」的验收
//
// 覆盖两半：
//   ① 静态：应覆盖入口清单**从目录现算**（不写死文件名/数量）、三样带齐、
//      robots.txt、哈希格式、全仓库不含明文令牌、非 collection 入口**不带**门禁、
//      gate.mjs apply 幂等 + check 缺件必须 exit 非 0；
//   ② 行为（自带无头 Chrome + CDP）：localhost 放行、未授权时内容不可见且只显示
//      「暂无访问权限」、#k= / ?k= 正确令牌放行并清片段、错误令牌拒绝、
//      带令牌 + 深链路由时路由不丢、标记与"当前令牌哈希前 16 位"绑定（换令牌后老设备失效）、
//      关掉 JavaScript 也进不去、crypto.subtle 不可用时不放行。
//
// ★ 行为用例怎么做到"既测真配置、又不依赖本机令牌"：
//   优先用家目录里的真令牌（gate.mjs new 生成的那份）跑；本机没有该文件时
//   （例如 CI 上）临时把一份自测令牌的哈希注入到**测试服务器返回的** gate.js 里，
//   磁盘上的仓库文件一个字节都不改。
//
// ★ 越权访问的边界如实记录：这里只断言"未授权时内容不可见"，
//   **不**断言"无法读出源码"——会用开发者工具的人本来就能读到 HTML/JS。
//
// 端口：DP = 18800，与其它用例的写死端口 / 随机段都不重叠。
// ============================================================================
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = process.cwd();
const COLLECTION = join(ROOT, 'collection');
const GATE_JS = join(COLLECTION, 'gate.js');
const GATE_TOOL = join(ROOT, 'collection', 'tools', 'gate.mjs');
const ROBOTS = join(ROOT, 'robots.txt');
const TOKEN_FILE = join(homedir(), 'gate-token.txt');
const MARK_LEN = 16;
const KEY = 'collection-gate';
const DENIED_TEXT = '暂无访问权限';
const DENIED_TITLE = '无法访问';
const SUBMIT_TEXT = '提交';           // 被拒页上口令框的按钮文字
const WRONG_TEXT = '口令不正确';       // 输错口令时唯一那句中性提示
// 被拒页上正常应该看到的**全部**文字：一句提示 + 一个按钮（输入框是空的，没有文本节点）
const DENIED_VISIBLE = DENIED_TEXT + SUBMIT_TEXT;
const CONSOLE_PREFIX = '[collection-gate]';   // 我们自己的 console 前缀（默认一条都不许有）
const GATE_SRC_TAG = './gate.js';   // 入口里必须用相对路径引用门禁脚本（见 verify-vendor 与 file:// 两条理由）
const GATE_URL_PATH = '/collection/gate.js';   // 浏览器最终请求到的地址（相对路径解析后的结果）

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
    c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
    if (!c && extra) console.log('      ' + extra);
};
const rel = p => relative(ROOT, p).split(sep).join('/');
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

// ── 极简 PNG 解码 + 像素反差测量 ────────────────────────────────────────────
// 「未授权页的图标/文字与背景反差够不够」必须**真的量像素**，不能只看 computed
// filter —— 用户实测的 bug（白底白画）里 filter 字符串看着完全正常，
// 只有把屏幕上的像素读出来才看得见"反差 0"。
// 这里零依赖手写 PNG 解码：IHDR + IDAT(zlib) + 逐行反滤波，够用即可。
function decodePng(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
    let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
    const idat = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
    if (depth !== 8 || interlace !== 0 || !ch) throw new Error(`不支持的 PNG（depth=${depth} colorType=${color} interlace=${interlace}）`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * ch;
    const out = Buffer.alloc(h * stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
        const f = raw[p++];
        const row = raw.subarray(p, p + stride); p += stride;
        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0;
            const b = prev ? prev[i] : 0;
            const c = (prev && i >= ch) ? prev[i - ch] : 0;
            let v = row[i];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            } else if (f !== 0) throw new Error('未知 PNG 滤波 ' + f);
            cur[i] = v & 0xff;
        }
    }
    return { w, h, ch, data: out };
}
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 量"某个矩形里最像笔画的像素"与"紧邻背景"的亮度差。
// 返回 { maxDiff, meanDiff, strokeLum, bgLum, strokeRGB, strokePx, n }
function measureContrast(png, rect, bgPoints) {
    const { w, h, ch, data } = png;
    const at = (x, y) => {
        const xx = Math.min(w - 1, Math.max(0, Math.round(x)));
        const yy = Math.min(h - 1, Math.max(0, Math.round(y)));
        const i = (yy * w + xx) * ch;
        return [data[i], data[i + 1], data[i + 2]];
    };
    const bgs = bgPoints.map(([x, y]) => { const [r, g, b] = at(x, y); return { lum: lumOf(r, g, b), rgb: [r, g, b] }; });
    bgs.sort((a, b) => a.lum - b.lum);
    const bg = bgs[bgs.length >> 1];                        // 取中位数，避免取样点正好压在别的东西上
    let maxDiff = 0, strokeLum = bg.lum, strokeRGB = bg.rgb, strokePx = null;
    let sum = 0, n = 0;
    const x0 = Math.max(0, Math.round(rect.left)), x1 = Math.min(w, Math.round(rect.left + rect.width));
    const y0 = Math.max(0, Math.round(rect.top)), y1 = Math.min(h, Math.round(rect.top + rect.height));
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const [r, g, b] = at(x, y);
            const d = Math.abs(lumOf(r, g, b) - bg.lum);
            if (d > 20) { sum += d; n++; }                   // 只把"像笔画"的像素计入均值，背景像素不算
            if (d > maxDiff) { maxDiff = d; strokeLum = lumOf(r, g, b); strokeRGB = [r, g, b]; strokePx = [x, y]; }
        }
    }
    return {
        maxDiff: Math.round(maxDiff), meanDiff: n ? Math.round(sum / n) : 0,
        bgLum: Math.round(bg.lum), strokeLum: Math.round(strokeLum), strokeRGB,
        strokePx, strokePixels: n, bgRGB: bg.rgb, rect
    };
}

// 未授权页的对比度硬门槛（0 反差 = 用户实测的"白底白画"）
const CONTRAST_MIN = 120;   // 笔画芯 vs 背景的**最大**亮度差
const CONTRAST_MEAN_MIN = 100;   // 图标：笔画像素的**平均**亮度差
// ★ 文案单独用一个更宽的平均阈值：字比图标细得多，笔画像素里抗锯齿边缘占比高，
//   而各平台字体渲染不同（CI 的 ubuntu 实测平均只有 ~80，最大值 149 仍然达标）——
//   所以"没被看见"这个 bug 由**最大值**阈值兜底（白底白画是 0 反差），平均只做粗筛。
const TEXT_MEAN_MIN = 60;

// ── 目录扫描（口径的唯一来源：现算，不写死）────────────────────────────────
function walkHtml(dir, { skipTools }) {
    const out = [];
    (function walk(d) {
        let ents;
        try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = join(d, e.name);
            if (e.isDirectory()) {
                if (e.name === '.git' || e.name === 'node_modules') continue;
                if (skipTools && e.name === 'tools') continue;
                walk(full);
            } else if (e.isFile() && extname(e.name).toLowerCase() === '.html') {
                out.push(full);
            }
        }
    })(dir);
    return out;
}
const coveredEntries = () => walkHtml(COLLECTION, { skipTools: true });
const allHtml = () => walkHtml(ROOT, { skipTools: false });

function allFiles(dir) {
    const out = [];
    (function walk(d) {
        let ents;
        try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            if (e.isDirectory()) {
                if (e.name === '.git' || e.name === 'node_modules') continue;
                walk(join(d, e.name));
            } else if (e.isFile()) out.push(join(d, e.name));
        }
    })(dir);
    return out;
}

// ── gate.js 配置区 ─────────────────────────────────────────────────────────
function readHashes() {
    const src = readFileSync(GATE_JS, 'utf8');
    const m = src.match(/\/\* gate:hashes:begin \*\/([\s\S]*?)\/\* gate:hashes:end \*\//);
    return m ? [...m[1].matchAll(/'([0-9a-fA-F]{64})'/g)].map(x => x[1].toLowerCase()) : [];
}
function readTokenFile() {
    if (!existsSync(TOKEN_FILE)) return null;
    const m = readFileSync(TOKEN_FILE, 'utf8').match(/^token=(\S+)\s*$/m);
    return m ? m[1] : null;
}

console.log('══════ ① 静态：覆盖清单 / 三样 / robots / 哈希 / 明文令牌 ══════\n');

const ENTRIES = coveredEntries();
console.log(`  口径：扫描 collection/**/*.html，排除 collection/tools/**（现算）`);
ok(ENTRIES.length >= 1, `应覆盖入口 ${ENTRIES.length} 个：${ENTRIES.map(rel).join(', ')}`);

// 与 git ls-files 交叉核对（有 git 才做）
{
    const r = spawnSync('git', ['-c', 'core.quotepath=false', 'ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
        const tracked = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
            .filter(p => p.startsWith('collection/'))
            .filter(p => !p.startsWith('collection/tools/'));
        const a = tracked.slice().sort().join('|');
        const b = ENTRIES.map(rel).slice().sort().join('|');
        ok(a === b, `与 git ls-files 的口径一致（git ${tracked.length} 个 vs 扫描 ${ENTRIES.length} 个）`, `git=${a}\n扫描=${b}`);
    } else {
        console.log('  · 没有 git 可用，跳过 git ls-files 交叉核对');
    }
}

const hashes = readHashes();
ok(hashes.length === 1, `gate.js 里恰好 1 个生效哈希（实际 ${hashes.length} 个）`);
ok(hashes.every(h => /^[0-9a-f]{64}$/.test(h)), `哈希格式正确（64 位小写十六进制）：${hashes.map(h => h.slice(0, 16) + '…').join(', ')}`);
const expectMark = hashes.length ? hashes[0].slice(0, MARK_LEN) : null;

// 每一个入口都要带齐三样（并检查它们在 <head> 里）
const missing = [];
for (const f of ENTRIES) {
    const src = readFileSync(f, 'utf8');
    const head = (src.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
    const why = [];
    if (!/<meta[^>]+name=["']robots["'][^>]*content=["']noindex\s*,\s*nofollow["']/i.test(head)) why.push('缺 meta noindex,nofollow');
    if (!/html:not\(\.gate-ok\)\s*\{[^}]*visibility:\s*hidden/i.test(head)) why.push('缺兜底隐藏 CSS');
    const tag = head.match(/<script[^>]+src=["']([^"']*gate\.js)["'][^>]*>/i);
    if (!tag) why.push('缺同步 gate.js');
    else {
        // 引用必须是**相对路径**且真的解析到 collection/gate.js：
        // 根绝对路径 /collection/gate.js 会被 verify-vendor 判成缺件，且在 file:// 下必 404
        const got = resolve(dirname(f), tag[1]);
        if (got !== GATE_JS) why.push(`<script src="${tag[1]}"> 解析到 ${rel(got)}，应为 ${rel(GATE_JS)}`);
        if (/\b(defer|async)\b/i.test(tag[0])) why.push('gate.js 带了 defer/async');
    }
    if (!/<!-- gate:begin/.test(head) || !/<!-- gate:end -->/.test(head)) why.push('缺 gate:begin/end 标记');
    const boot = head.match(/<script id="collection-gate-boot">[\s\S]*?<\/script>/i);
    if (!boot) why.push('缺 head 内联同步引导脚本');
    else if (expectMark && !boot[0].includes(`'${expectMark}'`)) why.push('引导脚本里的标记不是当前哈希前 16 位');
    if (why.length) missing.push(`${rel(f)}：${why.join('；')}`);
}
ok(missing.length === 0,
    `★ 每一个应覆盖入口都带齐三样（meta + 兜底隐藏 CSS + 同步脚本），共 ${ENTRIES.length} 个，缺 ${missing.length} 个`,
    missing.join('\n      '));

// 兜底隐藏必须用 visibility（不能用 display:none —— 那会把提示本身也藏掉）
{
    let bad = [];
    for (const f of ENTRIES) {
        const head = (readFileSync(f, 'utf8').match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
        const rule = head.match(/html:not\(\.gate-ok\)\s*\{([^}]*)\}/i);
        if (rule && /display\s*:\s*none/i.test(rule[1])) bad.push(rel(f));
    }
    ok(bad.length === 0, `兜底隐藏用的是 visibility 而不是 display:none（${bad.join(', ') || '全部正确'}）`);
}

// 非 collection 入口一个都不该挂门禁（范围只限 collection）
{
    const outside = allHtml().filter(f => !rel(f).startsWith('collection/'));
    const leaked = outside.filter(f => {
        const t = readFileSync(f, 'utf8');
        return t.includes(GATE_SRC_TAG) || /html:not\(\.gate-ok\)/.test(t) || /<!-- gate:begin/.test(t);
    });
    ok(leaked.length === 0,
        `★ 非 collection 入口没被挂上门禁（扫了 ${outside.length} 个 HTML，越界 ${leaked.length} 个）`,
        leaked.map(rel).join(', '));
}

// robots.txt：只挡 collection，其余照常收录
{
    const want = 'User-agent: *\nAllow: /\nDisallow: /collection/\n';
    const got = existsSync(ROBOTS) ? readFileSync(ROBOTS, 'utf8').replace(/\r\n/g, '\n') : null;
    ok(got !== null, '仓库根有 robots.txt');
    ok(got !== null && got.trim() === want.trim(), 'robots.txt 内容正确（Allow: / + Disallow: /collection/，不是全站 Disallow）', JSON.stringify(got));
}

// gate.js 的实现要点（恒定时间比较、subtle 分支、replaceState、本地放行）
{
    const src = readFileSync(GATE_JS, 'utf8');
    // 本地放行（localhost / 127.0.0.1 / ::1 / file:）写在 head 的同步引导脚本里
    // （gate.js 里另有一份等价判定做兜底），所以两份合起来看
    const impl = src + '\n' + ENTRIES.map(f => readFileSync(f, 'utf8')).join('\n');
    ok(/function ctEqual/.test(src) && /diff\s*\|=\s*\(a\.charCodeAt\(i\)\s*\|\|\s*0\)\s*\^\s*\(b\.charCodeAt\(i\)\s*\|\|\s*0\)/.test(src)
        && /ctEqual\(hex,\s*GATE_HASHES\[i\]\)/.test(src),
        '★ 哈希比较走恒定时间实现（逐字符异或累积，不提前退出），没有用 ===');
    ok(/crypto\.subtle/.test(src) || /\.subtle/.test(src), '用 crypto.subtle.digest 算 SHA-256');
    ok(/typeof subtle\.digest !== 'function'[\s\S]{0,240}deny\(/.test(src), '★ crypto.subtle 不可用时的分支是"拒绝"而不是"放行"');
    ok(/history\.replaceState/.test(src), '命中令牌后用 history.replaceState 清片段');
    ok(/host === 'localhost' \|\| host === '127\.0\.0\.1' \|\| host === '::1'/.test(impl)
        || /'localhost'[\s\S]{0,160}'127\.0\.0\.1'[\s\S]{0,160}'::1'/.test(impl),
        'localhost / 127.0.0.1 / ::1 直接放行');
    ok(/location\.protocol === 'file:'/.test(impl),
        '★ file: 协议（双击打开本地 HTML）也直接放行 —— 与 localhost 同一处判定');
    ok(/location\.protocol === 'file:'[\s\S]{0,400}?classList\.add\('gate-ok'\)[\s\S]{0,80}?return/.test(impl),
        '★ file: 放行只加 gate-ok 类、立刻返回（不写 localStorage 标记）');
    ok(!/'1'/.test(src.split('STORAGE_KEY')[1] || ''), 'localStorage 里存的不是常量 "1"，而是与哈希绑定的标记');
}

// 未授权页的图标（collection/block.svg）：颜色一律由 filter 强制（不依赖原画颜色），
// 而且**背景与图标必须由同一组选择器决定** —— 现在这件事是**结构上**保证的：
// 五组 --gate-* 变量块里，每一组都同时给出 --gate-bg 与 --gate-icon，组件层只消费变量。
// ★ 这一组断言就是用户实测那个 bug（白底白画）的静态判据。
{
    const head = (readFileSync(ENTRIES[0], 'utf8').match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];

    // 「变量块成对」的通用判据：凡是声明了 --gate-bg 的规则块，必须同时声明 --gate-icon。
    // 这条判据对格式免疫（只管 `{...}` 里有没有那两行），gate.mjs 的多行写法与
    // gate.js 里被拒文档的单行写法都能用。
    const pairCheck = (css, label) => {
        const blocks = css.match(/\{[^{}]*--gate-bg:[^{}]*\}/g) || [];
        const missing = blocks.filter(b => !/--gate-icon\s*:/.test(b));
        const iconOnly = (css.match(/\{[^{}]*--gate-icon:[^{}]*\}/g) || []).filter(b => !/--gate-bg\s*:/.test(b));
        ok(blocks.length >= 5 && missing.length === 0,
            `★ [${label}] 每一处「设背景」（--gate-bg）都成对设了图标（--gate-icon）：${blocks.length} 处，缺 ${missing.length} 处`,
            missing.length ? '← 这正是"白底白画"的成因：只改了背景、没改图标' : '');
        ok(iconOnly.length === 0,
            `★ [${label}] 没有"只设图标不设背景"的孤儿规则块（${iconOnly.length} 处）`);
        return blocks;
    };
    const headBlocks = pairCheck(head, '入口 head 兜底 CSS');

    // 四套主题来源 + 默认兜底，逐个点名，缺一个就红
    const scopes = [
        ['默认兜底 :root', /:root\s*\{[^{}]*--gate-bg:\s*#f6f7f9[^{}]*--gate-icon:\s*brightness\(0\)(?!\s+invert)/, '浅色 → brightness(0)（纯黑）'],
        ['系统浅色 @media (prefers-color-scheme: light)', /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{[^{}]*--gate-bg:\s*#f6f7f9[^{}]*--gate-icon:\s*brightness\(0\)(?!\s+invert)/, '浅色 → brightness(0)（纯黑）'],
        ['系统暗色 @media (prefers-color-scheme: dark)', /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^{}]*--gate-bg:\s*#14171c[^{}]*--gate-icon:\s*brightness\(0\)\s+invert\(1\)/, '暗色 → brightness(0) invert(1)（纯白）'],
        ['站点主题 html[data-color-scheme="dark"]', /html\[data-color-scheme="dark"\]\s*\{[^{}]*--gate-bg:\s*#14171c[^{}]*--gate-icon:\s*brightness\(0\)\s+invert\(1\)/, '暗色 → brightness(0) invert(1)（纯白）'],
        ['站点主题 html[data-color-scheme="light"]', /html\[data-color-scheme="light"\]\s*\{[^{}]*--gate-bg:\s*#f6f7f9[^{}]*--gate-icon:\s*brightness\(0\)(?!\s+invert)/, '浅色 → brightness(0)（纯黑）']
    ];
    for (const [name, re, want] of scopes) {
        const hit = re.test(head);
        ok(hit, `★ 「${name}」同一组选择器里同时给出背景与图标（${want}）`,
            hit ? '' : '← 少写 --gate-icon，就是用户实测的"白底白画"');
    }
    // 组件层**只消费变量**，不许自己写死颜色（否则两套来源又会打架）
    ok(/\.gate-denied-icon\s*\{[^}]*filter:\s*var\(--gate-icon\)/.test(head),
        '★ 图标规则只写 filter: var(--gate-icon)（颜色来源唯一，组件层不写死）');
    ok(/\.gate-denied-box\s*\{[^}]*background:\s*var\(--gate-bg\)/.test(head),
        '★ 提示盒只写 background: var(--gate-bg)（与图标同一个来源）');
    ok(/html:not\(\.gate-ok\):not\(\.gate-denied\)::before\s*\{[\s\S]*?background:\s*var\(--gate-bg\)/.test(head),
        '★ 关 JS 那句 ::before 提示的背景也取自同一组变量');
    // 数量不变量（旧口径保留）：几处 --gate-bg 就该有几处 --gate-icon
    const bgCount = (head.match(/--gate-bg\s*:/g) || []).length;
    const iconCount = (head.match(/--gate-icon\s*:/g) || []).length;
    ok(bgCount === iconCount && bgCount >= 5,
        `★ 主题变量成对的数量不变量：--gate-bg ${bgCount} 处 == --gate-icon ${iconCount} 处（≥5：默认 + 系统浅/暗 + 站点浅/暗）`);
    ok(headBlocks.some(b => /brightness\(0\)/.test(b)) && headBlocks.some(b => /invert\(1\)/.test(b)),
        '★ 两种滤镜都在：brightness(0)（纯黑）与 brightness(0) invert(1)（纯白）');
    ok(/block\.svg/.test(head), '未授权页引用了 collection/block.svg');
    ok(existsSync(join(COLLECTION, 'block.svg')), 'collection/block.svg 文件存在');

    // ★ 被拒文档是 gate.js 现场 document.write 出来的，它自带一份同样的变量块 ——
    //   两份必须同口径，否则"脚本路径"和"关 JS 路径"会长得不一样。
    const implCss = (/var DENIED_CSS = \[([\s\S]*?)\]\.join\(''\);/.exec(readFileSync(GATE_JS, 'utf8')) || [, ''])[1];
    const deniedBlocks = pairCheck(implCss, 'gate.js 被拒文档 CSS');
    ok(deniedBlocks.length >= 5, `★ [gate.js 被拒文档] 同样是五组变量块（实际 ${deniedBlocks.length} 组）`);
    ok(/--gate-icon:brightness\(0\)/.test(implCss) && /--gate-icon:brightness\(0\) invert\(1\)/.test(implCss),
        '★ [gate.js 被拒文档] 同样用 brightness(0) / brightness(0) invert(1) 强制纯黑/纯白');
}

// 明文令牌：整个仓库（不含 .git）都不许出现
const realToken = readTokenFile();
if (realToken) {
    const needle = Buffer.from(realToken, 'utf8');
    const files = allFiles(ROOT);
    const hits = [];
    for (const f of files) {
        let buf; try { buf = readFileSync(f); } catch { continue; }
        if (buf.indexOf(needle) >= 0) hits.push(rel(f));
    }
    ok(hits.length === 0, `★ 全仓库（不含 .git，${files.length} 个文件）不含明文令牌`,
        hits.join(', '));
    const h = sha256(realToken);
    ok(hashes.includes(h), `家目录令牌的 SHA-256 与 gate.js 里的哈希一致（${h.slice(0, 16)}…）`);
    ok(!resolve(TOKEN_FILE).toLowerCase().startsWith(resolve(ROOT).toLowerCase() + sep), '★ 明文令牌文件写在仓库之外（家目录），不在仓库里');
    ok(realToken.length >= 32, `令牌足够长（${realToken.length} 字符，要求 ≥32）`);
} else {
    console.log(`  · 本机没有 ${TOKEN_FILE}，跳过"全仓库不含明文令牌"（CI 上本来就没有这份文件）`);
}

// ── gate.mjs：apply 幂等 / check 缺件必须 exit 非 0 ────────────────────────
console.log('\n══════ ② gate.mjs：apply 幂等 + check 缺件必须报错（都在 %TEMP% 的副本上做）══════\n');

console.log('  ── apply --dry-run（真实仓库）──');
{
    const r = spawnSync(process.execPath, [GATE_TOOL, 'apply', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
    console.log((r.stdout || '').split(/\r?\n/).map(l => '    ' + l).join('\n').trimEnd());
    ok(r.status === 0, 'apply --dry-run 退出码 0');
}

console.log('\n  ── check（真实仓库，CI 里跑的就是这一条）──');
{
    const r = spawnSync(process.execPath, [GATE_TOOL, 'check'], { cwd: ROOT, encoding: 'utf8' });
    console.log((r.stdout || '').split(/\r?\n/).map(l => '    ' + l).join('\n').trimEnd());
    if (r.stderr) console.log('    [stderr] ' + r.stderr.trim());
    ok(r.status === 0, 'gate.mjs check 退出码 0（覆盖完整）');
}

const tmpBase = await mkdtemp(join(tmpdir(), 'gateSelfTest-'));
const readBody = f => readFileSync(f, 'utf8');

// 临时仓库副本：gate.js + robots.txt + 一份**没挂门禁**的 collection/index.html
function makeTempRoot(name, { breakIt } = {}) {
    const dir = join(tmpBase, name);
    mkdirSync(join(dir, 'collection'), { recursive: true });
    cpSync(GATE_JS, join(dir, 'collection', 'gate.js'));
    cpSync(ROBOTS, join(dir, 'robots.txt'));
    let html = readBody(join(COLLECTION, 'index.html')).replace(/^[ \t]*<!-- gate:begin[\s\S]*?<!-- gate:end -->[ \t]*\r?\n/m, '');
    if (breakIt === 'no-script') html = html.replace(/^[ \t]*<script src="\.\/gate\.js"><\/script>[ \t]*\r?\n/m, '');
    if (breakIt === 'no-meta') html = html.replace(/^[ \t]*<meta name="robots"[^>]*>[ \t]*\r?\n/m, '');
    if (breakIt === 'no-css') html = html.replace(/^[ \t]*<style id="collection-gate-guard">[\s\S]*?<\/style>[ \t]*\r?\n/m, '');
    writeFileSync(join(dir, 'collection', 'index.html'), html);
    return dir;
}
const runTool = (args, cwd) => spawnSync(process.execPath, [GATE_TOOL, ...args], { cwd: cwd || ROOT, encoding: 'utf8' });

{
    const dir = makeTempRoot('idem');
    const target = join(dir, 'collection', 'index.html');
    const before = readBody(target);
    ok(!/gate:begin/.test(before), '临时副本一开始是"没挂门禁"的干净文件');

    const r1 = runTool(['apply', '--root=' + dir]);
    const after1 = readBody(target);
    ok(r1.status === 0 && after1 !== before, `apply 把门禁注入进去了（exit ${r1.status}）`);
    const hex1 = sha256(after1);

    const r2 = runTool(['apply', '--root=' + dir]);
    const after2 = readBody(target);
    ok(r2.status === 0 && sha256(after2) === hex1, `★ apply 幂等：连跑两次 sha256 不变（${hex1.slice(0, 16)}…）`);
    ok((after2.match(/<!-- gate:begin/g) || []).length === 1, '★ apply 幂等：没有重复注入（gate:begin 只出现 1 次）');
    ok(runTool(['apply', '--dry-run', '--root=' + dir]).status === 0 && sha256(readBody(target)) === hex1,
        '★ apply --dry-run 一个字节都不写');

    const rc = runTool(['check', '--root=' + dir]);
    ok(rc.status === 0, `apply 之后 check 通过（exit ${rc.status}）`);
    console.log('    注入后的结构（head 里门禁块的首尾）：');
    console.log('      ' + after2.split(/\r?\n/).filter(l => /gate:begin|name="robots"|collection-gate-boot|gate\.js|gate:end/.test(l)).map(l => l.trim()).join('\n      '));
}

for (const kind of ['no-script', 'no-meta', 'no-css']) {
    const dir = makeTempRoot('broken-' + kind, { breakIt: kind });
    const r = runTool(['check', '--root=' + dir]);
    const out = (r.stdout || '') + (r.stderr || '');
    ok(r.status !== 0 && out.includes('collection/index.html'),
        `★ 人为去掉「${kind === 'no-script' ? '<script src=./gate.js>' : kind === 'no-meta' ? 'meta noindex' : '兜底隐藏 CSS'}」后，check 必须 exit 非 0 并点名文件（exit ${r.status}，点名 ${out.includes('collection/index.html') ? '有' : '没有'}）`);
}

// ── 行为 ───────────────────────────────────────────────────────────────────
console.log('\n══════ ③ 行为：无头 Chrome + CDP ══════\n');

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};

// 优先用家目录里的真令牌跑行为用例；没有就临时注入一份自测令牌的哈希
// （只改测试服务器返回的内容，磁盘上的 gate.js 一个字节都不动）
const TEST_TOKEN = realToken || 'verify-gate-selftest-token-000000000000000000';
const SERVE_HASH = sha256(TEST_TOKEN);
const INJECT = !realToken;
const SERVE_MARK = SERVE_HASH.slice(0, MARK_LEN);
console.log(`  行为用例令牌来源：${realToken ? '家目录 %USERPROFILE%\\gate-token.txt 里的真令牌' : '内联自测令牌（本机没有令牌文件）'}`);
console.log(`  期望标记（哈希前 ${MARK_LEN} 位）：${SERVE_MARK}`);

const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const full = join(ROOT, p);
        if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
        if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
        let buf = await readFile(full);
        if (INJECT && p === GATE_URL_PATH) {
            buf = Buffer.from(buf.toString('utf8').replace(
                /(\/\* gate:hashes:begin \*\/)[\s\S]*?(\/\* gate:hashes:end \*\/)/,
                `$1\n        '${SERVE_HASH}',\n        $2`), 'utf8');
        }
        res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
        res.end(buf);
    } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, r));            // 不指定 host：双栈，localhost / ::1 / 127.0.0.x 都能连
const PORT = server.address().port;
const PATHNAME = '/collection/index.html';
const urlOn = (host, suffix) => `http://${host}:${PORT}${PATHNAME}${suffix || ''}`;

const userDir = await mkdtemp(join(tmpdir(), 'cdpGate-'));
const DP = 18800;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
// ── 控制台取证 ──────────────────────────────────────────────────────────────
// 被拒页面必须做到：**未捕获异常 0 条**、**页面自己打的控制台输出 0 条**。
// 浏览器自身产的 Log 条目（比如"preload 了但没用上"的警告、网络错误）单独归一类，
// 只作展示、不作断言 —— 那是浏览器的话，不是我们的话。
let events = [];   // { kind: 'exception' | 'console' | 'browserlog', text }
const eventsSince = i => events.slice(i);
const countKind = (evs, kind) => evs.filter(e => e.kind === kind).length;
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', text: String(m.params?.exceptionDetails?.text || 'exception') + ' :: ' + String(m.params?.exceptionDetails?.exception?.description || '').split('\n')[0] });
    if (m.method === 'Runtime.consoleAPICalled') events.push({ kind: 'console', text: m.params.type + ': ' + (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ') });
    if (m.method === 'Log.entryAdded') events.push({ kind: 'browserlog', text: m.params.entry.source + '.' + m.params.entry.level + ': ' + String(m.params.entry.text).slice(0, 120) });
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
}
async function waitFor(expr, ms = 12000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch { } await sleep(step); }
    return false;
}

// 状态探针：把"看得见什么"算清楚，不只看 DOM 里有没有元素
const PROBE = `(() => {
    const html = document.documentElement;
    const bodyText = document.body ? document.body.textContent.replace(/\\s+/g, ' ').trim() : '';
    const visParts = [];
    (function walk(n) {
        if (n.nodeType === 3) {
            // 文本节点没有自己的 computed style，看它爹：display 不是 none、
            // 且自己的 visibility 是 visible 才算"看得见"（visibility 可继承，
            // 所以被藏在 html 上的内容会算出 hidden，而提示盒子自己写 visible）
            const p = n.parentElement;
            const cs = p ? getComputedStyle(p) : null;
            if (!cs || cs.display === 'none' || cs.visibility !== 'visible') return;
            if (n.nodeValue && n.nodeValue.trim()) visParts.push(n.nodeValue);
            return;
        }
        if (n.nodeType !== 1) return;
        if (getComputedStyle(n).display === 'none') return;   // 只剪 display:none，不剪 visibility
        for (const c of n.childNodes) walk(c);
    })(document.body || html);
    const leaks = [];
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility !== 'visible') continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height <= 4) continue;
        if (el.closest('.gate-denied-box')) continue;
        leaks.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : ''));
    }
    const before = getComputedStyle(html, '::before');
    // 站点标志性全局：只要站点脚本跑过一条，这些里就会冒出东西（被拒时应为空）
    const SITE_GLOBALS = ['toolbox', 'stats', 'special', 'router', 'navigateToCopy', 'setColorSchemeMode', 'openSeries', 'appText'];
    return JSON.stringify({
        gateOk: html.classList.contains('gate-ok'),
        gateDenied: html.classList.contains('gate-denied'),
        htmlVisibility: getComputedStyle(html).visibility,
        title: document.title,
        titles: [...document.querySelectorAll('title')].map(t => t.textContent.trim()),
        bodyText: bodyText,
        visibleText: visParts.join('').replace(/\\s+/g, ' ').trim(),
        bodyKids: document.body ? document.body.children.length : -1,
        bodyTags: document.body ? [...document.body.children].map(c => c.tagName) : [],
        firstKid: document.body && document.body.children[0] ? document.body.children[0].className : '',
        boxChildren: (document.querySelector('.gate-denied-box') || { children: [] }).children.length,
        deniedText: (document.querySelector('.gate-denied-text') || {}).textContent || null,
        leaks: leaks,
        beforeContent: before.content,
        beforeVisibility: before.visibility,
        scriptCount: document.scripts.length,
        linkCount: document.querySelectorAll('link').length,
        docLen: document.documentElement.outerHTML.length,
        siteGlobals: SITE_GLOBALS.filter(k => k in window),
        formHidden: (() => { const f = document.querySelector('.gate-denied-form'); return f ? f.hidden : null; })(),
        errHidden: (() => { const e = document.querySelector('.gate-denied-error'); return e ? e.hidden : null; })(),
        mark: (() => { try { return localStorage.getItem(${JSON.stringify(KEY)}); } catch (e) { return '(throw)'; } })(),
        hash: location.hash,
        search: location.search,
        href: location.href,
        host: location.hostname,
        openSeries: document.querySelectorAll('.series-body.open').length,
        appText: (document.getElementById('app') || {}).textContent ? document.getElementById('app').textContent.length : 0
    });
})()`;

async function probe() { return JSON.parse(await evaluate(PROBE)); }
// ★ 每次导航前先落 about:blank：Chrome 对"只有片段不同"的 Page.navigate 走的是
//   同文档跳转（不重新加载文档），门禁脚本根本不会重跑 —— 那样测出来的全是假绿/假红。
async function goto(url) {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(150);
    await send('Page.navigate', { url });
}
// 在某个 origin 上先把 localStorage 摆成想要的样子，再导航到目标 URL
async function setStorage(host, mark) {
    await goto(urlOn(host, ''));
    await sleep(900);
    await evaluate(mark === null
        ? `(() => { try { localStorage.removeItem(${JSON.stringify(KEY)}); } catch (e) { } return true; })()`
        : `(() => { try { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(mark)}); } catch (e) { } return true; })()`);
}
async function visit(url, waitExpr, settle = 1400) {
    const start = events.length;   // 记下起点：这次访问期间冒出来的异常/控制台都归它
    await goto(url);
    if (waitExpr) { await waitFor(waitExpr); await sleep(settle); }
    else await sleep(4500);
    const p = await probe();
    p.events = eventsSince(start);
    return p;
}

try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    // Log domain：浏览器自己产的条目（preload 警告、网络错误）也收进来，便于报告里如实展示
    await send('Log.enable');

    let debugConsoleCount = 0;   // ?gatedebug=1 那次刻意打开的日志条数（整轮账本里要扣掉）

    const H = { loop: '127.0.0.1', alt: '127.0.0.2', name: 'localhost' };
    console.log(`  测试服务器：http://<host>:${PORT}${PATHNAME}`);
    console.log(`  · 127.0.0.1 与 localhost 是"本地放行"通道；127.0.0.2 走真门禁（不在白名单里）\n`);

    // ── 1. localhost / 127.0.0.1 放行，内容可见 ──
    for (const host of [H.loop, H.name]) {
        const r = await visit(urlOn(host, ''), `document.documentElement.classList.contains('gate-ok')`);
        ok(r.gateOk && !r.gateDenied, `[${host}] 直接放行（html 带 gate-ok）`);
        ok(r.htmlVisibility === 'visible', `[${host}] html 的 visibility 是 visible（内容没被藏）`);
        ok(r.bodyText.length > 40, `[${host}] 原内容都在（body 文本 ${r.bodyText.length} 字）`);
        ok(r.leaks.length > 0, `[${host}] ★ 探针确认大量元素真的可见（${r.leaks.length} 个）`);
        ok(r.title !== DENIED_TITLE && r.title.length > 0, `[${host}] 标题不是"${DENIED_TITLE}"（是"${r.title}"）`);
    }
    // 放行后首页本来就该是完整站点：抽查标志性元素真的可见
    {
        const vis = await evaluate(`(() => {
            const el = document.querySelector('.bottom-tabbar') || document.querySelector('.app-layout');
            if (!el) return 'no-element';
            const cs = getComputedStyle(el), r = el.getBoundingClientRect();
            return cs.visibility + '|' + cs.display + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
        })()`);
        ok(vis !== 'no-element' && vis.startsWith('visible|') && !vis.includes('|none|'), `[${H.loop}] ★ 放行后站点骨架真的可见（.bottom-tabbar/.app-layout = ${vis}）`);
    }

    // ── 1b. file:// 本地打开也要放行（站点主人双击打开本地 HTML 的习惯用法）──
    {
        const fileUrl = pathToFileURL(join(COLLECTION, 'index.html')).href + '#notes';
        await goto(fileUrl);
        await sleep(1200);
        await evaluate(`(() => { try { localStorage.removeItem(${JSON.stringify(KEY)}); } catch (e) { } return true; })()`);
        const f = await visit(fileUrl, `document.documentElement.classList.contains('gate-ok')`);
        ok(f.gateOk && !f.gateDenied, `[file://] ★ 本地文件打开直接放行（html 带 gate-ok）：${fileUrl}`);
        ok(!f.visibleText.includes('暂无访问权限'), `[file://] ★ 不出现「暂无访问权限」（可见文本开头 ${JSON.stringify(f.visibleText.slice(0, 40))}）`);
        ok(f.htmlVisibility === 'visible' && f.leaks.length > 0, `[file://] ★ 内容真的可见（html visibility=${f.htmlVisibility}，越界可见元素 ${f.leaks.length} 个）`);
        ok(!/^[0-9a-f]{16}$/.test(String(f.mark)), `[file://] ★ 本地放行不写 localStorage 标记（ls=${f.mark}）`);
    }

    // ── 2. 无标记无令牌 ⇒ 拒绝，内容不可见 ──
    await setStorage(H.alt, null);
    const deny = await visit(urlOn(H.alt, ''), `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
    ok(!deny.gateOk, '[127.0.0.2] 无令牌 ⇒ 不放行（html 上没有 gate-ok）');
    ok(deny.deniedText === DENIED_TEXT, `[127.0.0.2] ★ 提示文字逐字等于 ${JSON.stringify(DENIED_TEXT)}（实际 ${JSON.stringify(deny.deniedText)}）`);
    ok(deny.visibleText === DENIED_VISIBLE,
        `[127.0.0.2] ★ 可见文本逐字等于 ${JSON.stringify(DENIED_VISIBLE)}（提示 + 提交按钮；实际 ${JSON.stringify(deny.visibleText)}）`);
    ok(deny.title === DENIED_TITLE, `[127.0.0.2] ★ document.title 逐字等于 ${JSON.stringify(DENIED_TITLE)}（实际 ${JSON.stringify(deny.title)}）`);
    ok(deny.titles.length === 1 && deny.titles[0] === DENIED_TITLE,
        `[127.0.0.2] ★ 文档里只有一个 <title> 且逐字是「${DENIED_TITLE}」（实际 ${JSON.stringify(deny.titles)}）`);
    // document.write 出来的是一份**最小文档**：body 只有提示盒 + 它自己的那段脚本
    ok(deny.bodyKids === 2 && deny.bodyTags.join(',') === 'DIV,SCRIPT' && deny.boxChildren === 4,
        `[127.0.0.2] ★ 文档被整个换掉了（body 子元素 ${deny.bodyKids} 个：${deny.bodyTags.join('+')}；提示盒里有 ${deny.boxChildren} 个子元素）`);
    ok(deny.leaks.length === 0, `[127.0.0.2] ★ 除了提示盒子，没有任何元素可见（越界 ${deny.leaks.length} 个）`, JSON.stringify(deny.leaks.slice(0, 20)));
    ok(deny.scriptCount === 3 && deny.linkCount === 0,
        `[127.0.0.2] ★ 站点资源一个都没进来（<script> ${deny.scriptCount} 个=引导+门禁+提示页自己那段，<link> ${deny.linkCount} 个）`);
    ok(deny.docLen < 40000, `[127.0.0.2] ★ 整个文档只剩提示页那点东西（documentElement 长度 ${deny.docLen}，原站首页是 50 万+）`);
    ok(!/暂无访问权限/.test(String(deny.beforeContent)),
        `[127.0.0.2] 关 JS 用的 CSS 兜底提示不再重复显示（::before content=${deny.beforeContent}）`);
    {
        const leftovers = await evaluate(`(() => {
            const bad = [];
            const bodyHtml = document.body ? document.body.innerHTML : '';
            for (const s of ['铜の币纪主站', '详细信息', '概览', 'app-layout', 'bottom-tabbar']) {
                if (bodyHtml.indexOf(s) >= 0) bad.push('body DOM 里有 ' + s);
            }
            const vis = document.body ? (document.body.innerText || '') : '';
            for (const s of ['铜の币纪主站', '详细信息', '概览', '全部纸币', '纪念钞连体钞']) {
                if (vis.indexOf(s) >= 0) bad.push('可见文本里有 ' + s);
            }
            return JSON.stringify(bad);
        })()`);
        ok(leftovers === '[]', `[127.0.0.2] ★ 页面（DOM 与可见文本）里不残留原站标志性文本（残留 ${leftovers}）`);
    }

    // ── 2a. ★ 任务 A：被拒时**干净地同归于尽** —— 控制台里不许有异常、也不许有我们的日志 ──
    // 用户实测的报错就是这一段：
    //     [collection-gate] no-token
    //     Uncaught (in promise) TypeError: Cannot read properties of null (reading 'classList')
    {
        const exc = deny.events.filter(e => e.kind === 'exception');
        const own = deny.events.filter(e => e.kind === 'console' && e.text.includes(CONSOLE_PREFIX));
        const anyConsole = deny.events.filter(e => e.kind === 'console');
        const browserLogs = deny.events.filter(e => e.kind === 'browserlog');
        console.log(`      · 本次被拒页控制台取证：未捕获异常 ${exc.length} 条；页面 console 输出 ${anyConsole.length} 条（其中我们自己的 ${own.length} 条）；浏览器自身 Log 条目 ${browserLogs.length} 条`);
        for (const e of deny.events) console.log(`          [${e.kind}] ${String(e.text).slice(0, 110)}`);
        ok(exc.length === 0,
            `★ [控制台] 无令牌被拒：未捕获异常 **0 条**（实际 ${exc.length} 条）—— document.open/write/close 把解析器停住了，站点脚本一条都没跑`,
            exc.slice(0, 3).map(e => e.text).join(' | '));
        ok(anyConsole.length === 0,
            `★ [控制台] 无令牌被拒：页面 console 输出 0 条（实际 ${anyConsole.length} 条）`,
            anyConsole.slice(0, 3).map(e => e.text).join(' | '));
        ok(own.length === 0,
            `★ [控制台] 无令牌被拒：门禁自己一条日志都没打（${CONSOLE_PREFIX}… 共 ${own.length} 条；只有 gatedebug=1 时才允许打）`);
        ok(deny.siteGlobals.length === 0,
            `★ [站点脚本] 无令牌被拒：站点标志性全局一个都没挂上（${JSON.stringify(deny.siteGlobals)}）—— 后面的站点 <script> 根本没执行`);
        // gatedebug=1 时**才**允许有我们自己的日志：这是"开关真的存在"的自证
        const dbg = await visit(urlOn(H.alt, '?gatedebug=1'),
            `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
        const dbgOwn = dbg.events.filter(e => e.kind === 'console' && e.text.includes(CONSOLE_PREFIX));
        ok(dbgOwn.length > 0,
            `★ [控制台] ?gatedebug=1 时门禁日志**才**出现（${dbgOwn.length} 条：${dbgOwn.slice(0, 2).map(e => e.text).join(' / ')}）—— 开关有效，不是把日志删了了事`);
        ok(dbg.gateOk === false, '[控制台] 带 gatedebug=1 也照样拒绝（开关不改变判定）');
        debugConsoleCount = dbgOwn.length;   // 整轮账本里要扣掉这几次"刻意打开"的日志
    }
    ok(!/暂无访问权限/.test(String(deny.beforeContent)),
        `[127.0.0.2] 脚本接管后 CSS 兜底提示不再重复显示（::before content=${deny.beforeContent}）`);

    // ── 2b. 未授权页的图标：collection/block.svg（站点主人自己画的，必须在、必须真的显示）──
    await waitFor(`(() => { const i = document.querySelector('.gate-denied-box .gate-denied-icon'); return !!i && i.complete && i.naturalWidth > 0; })()`, 6000);
    const icon = JSON.parse(await evaluate(`(() => {
        const i = document.querySelector('.gate-denied-box .gate-denied-icon');
        const t = document.querySelector('.gate-denied-box .gate-denied-text');
        if (!i) return JSON.stringify({ found: false });
        const r = i.getBoundingClientRect(), rt = t ? t.getBoundingClientRect() : null;
        return JSON.stringify({
            found: true, src: i.getAttribute('src'), naturalW: i.naturalWidth, naturalH: i.naturalHeight,
            alt: i.getAttribute('alt'), ariaHidden: i.getAttribute('aria-hidden'),
            filter: getComputedStyle(i).filter,
            box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            above: t ? ((i.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) : null,
            textRight: rt ? Math.round(rt.right) : null,
            innerW: window.innerWidth
        });
    })()`));
    ok(icon.found && icon.src === '/collection/block.svg',
        `[127.0.0.2] ★ 未授权页里有指向 /collection/block.svg 的 <img>（src=${icon.src}）`);
    ok(icon.naturalW > 0, `[127.0.0.2] ★ 图标真的加载成功（naturalWidth=${icon.naturalW} × naturalHeight=${icon.naturalH}，说明路径没写错）`);
    ok(icon.alt === '' && icon.ariaHidden === 'true', `[127.0.0.2] ★ 图标是纯装饰（alt="${icon.alt}"、aria-hidden="${icon.ariaHidden}"）`);
    ok(icon.above === true, '[127.0.0.2] 图标在文案上方');

    // ── 2c. ★ 像素级反差：主题来源有两条（系统偏好 / 站点主题），两两组合都要测到 ──
    // 用户实测的 bug：系统暗色 + 站点主题浅色 ⇒ 背景浅、图标被媒体查询翻成白 ⇒
    // **白底白画**。所以这里不看 filter 字符串，直接截屏读像素，量"笔画 vs 紧邻背景"
    // 的亮度差；任何一个组合反差不够就红。
    {
        await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
        await sleep(300);
        // 输入框默认是空的（没有文字像素可量），先打点东西进去，才能量"输入框文字 vs 输入框底色"
        await evaluate(`(() => { const i = document.querySelector('.gate-denied-input'); if (i) i.value = 'A1b2C3'; return true; })()`);
        const combos = [
            ['light', null], ['light', 'dark'], ['light', 'light'],
            ['dark', null], ['dark', 'dark'], ['dark', 'light']
        ];
        const rows = [];
        for (const [sys, attr] of combos) {
            await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sys }] });
            await evaluate(attr === null
                ? `(() => { document.documentElement.removeAttribute('data-color-scheme'); return true; })()`
                : `(() => { document.documentElement.setAttribute('data-color-scheme', ${JSON.stringify(attr)}); return true; })()`);
            await sleep(400);
            const geo = JSON.parse(await evaluate(`(() => {
                const box = document.querySelector('.gate-denied-box');
                const img = document.querySelector('.gate-denied-icon');
                const txt = document.querySelector('.gate-denied-text');
                const inp = document.querySelector('.gate-denied-input');
                const btn = document.querySelector('.gate-denied-submit');
                if (!box || !img || !txt || !inp || !btn) return JSON.stringify({ missing: true });
                const r = e => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
                return JSON.stringify({
                    box: r(box), img: r(img), txt: r(txt), inp: r(inp), btn: r(btn),
                    bg: getComputedStyle(box).backgroundColor,
                    iconFilter: getComputedStyle(img).filter,
                    inpBg: getComputedStyle(inp).backgroundColor, inpFg: getComputedStyle(inp).color,
                    btnBg: getComputedStyle(btn).backgroundColor, btnFg: getComputedStyle(btn).color,
                    attr: document.documentElement.getAttribute('data-color-scheme'),
                    dpr: window.devicePixelRatio, sx: window.scrollX, sy: window.scrollY,
                    innerW: window.innerWidth, innerH: window.innerHeight
                });
            })()`));
            const shot = await send('Page.captureScreenshot', { format: 'png' });
            const png = decodePng(Buffer.from(shot.data, 'base64'));
            const sh = (r, pad) => ({
                left: r.left - geo.sx - pad, top: r.top - geo.sy - pad,
                width: r.width + pad * 2, height: r.height + pad * 2
            });
            // 背景取样：图标四边外侧 6px（紧邻），再加上盒子左上角
            const bgPts = [
                [geo.img.left + geo.img.width / 2, geo.img.top - 6],
                [geo.img.left - 6, geo.img.top + geo.img.height / 2],
                [geo.img.right + 6, geo.img.top + geo.img.height / 2],
                [geo.img.left + geo.img.width / 2, geo.img.bottom + 6],
                [geo.box.left + 8, geo.box.top + 8]
            ];
            // 输入框/按钮的背景取样点必须落在**它们自己的底色**上（不是盒子的底色）：
            // 取框内上下各 3px 的四处（文字在垂直中间，这四处一定是纯底色）
            const ownBgPts = (r) => [
                [r.left + r.width * 0.3, r.top + 3],
                [r.left + r.width * 0.7, r.top + 3],
                [r.left + r.width * 0.3, r.bottom - 3],
                [r.left + r.width * 0.7, r.bottom - 3]
            ];
            const iconC = measureContrast(png, sh(geo.img, 0), bgPts);
            const textC = measureContrast(png, sh(geo.txt, 0), bgPts);
            const inpC = measureContrast(png, sh(geo.inp, 0), ownBgPts(geo.inp));
            const btnC = measureContrast(png, sh(geo.btn, 0), ownBgPts(geo.btn));
            const label = `系统=${sys} 站点=${attr === null ? '（无属性）' : attr}`;
            rows.push({ sys, attr, label, iconC, textC, inpC, btnC, geo, pngW: png.w, pngH: png.h });
            console.log(`      ${label.padEnd(26)} 背景 ${JSON.stringify(geo.bg).padEnd(20)} 图标 filter=${String(geo.iconFilter).padEnd(24)}`
                + ` 图标 芯${iconC.strokeLum}/底${iconC.bgLum} 反差 最大${iconC.maxDiff} 平均${iconC.meanDiff}（${iconC.strokePixels} 像素）`
                + ` | 文案 芯${textC.strokeLum}/底${textC.bgLum} 反差 最大${textC.maxDiff} 平均${textC.meanDiff}`);
            console.log(`      ${''.padEnd(26)} 输入框底 ${JSON.stringify(geo.inpBg).padEnd(20)} 字 ${JSON.stringify(geo.inpFg).padEnd(20)}`
                + ` 反差 最大${inpC.maxDiff} 平均${inpC.meanDiff}（芯${inpC.strokeLum}/底${inpC.bgLum}）`
                + ` | 按钮底 ${JSON.stringify(geo.btnBg)} 字 ${JSON.stringify(geo.btnFg)} 反差 最大${btnC.maxDiff} 平均${btnC.meanDiff}（芯${btnC.strokeLum}/底${btnC.bgLum}）`);
            ok(png.w === geo.innerW * geo.dpr && png.h === geo.innerH * geo.dpr,
                `[像素] ${label}：截屏尺寸与视口一致（${png.w}×${png.h} vs ${geo.innerW}×${geo.innerH} @${geo.dpr}x）—— 采样坐标可信`);
            ok(iconC.maxDiff >= CONTRAST_MIN && iconC.meanDiff >= CONTRAST_MEAN_MIN,
                `★ [像素] ${label}：图标与背景反差达标（最大 ${iconC.maxDiff} ≥ ${CONTRAST_MIN}、平均 ${iconC.meanDiff} ≥ ${CONTRAST_MEAN_MIN}；笔画 rgb(${iconC.strokeRGB.join(',')}) vs 背景 rgb(${iconC.bgRGB.join(',')})）`,
                iconC.maxDiff < CONTRAST_MIN ? `← 反差 ${iconC.maxDiff}：图标与背景几乎同色（"白底白画"就是这种 0 反差）` : '');
            ok(textC.maxDiff >= CONTRAST_MIN && textC.meanDiff >= TEXT_MEAN_MIN,
                `★ [像素] ${label}：文案「${DENIED_TEXT}」与背景反差达标（最大 ${textC.maxDiff} ≥ ${CONTRAST_MIN}、平均 ${textC.meanDiff} ≥ ${TEXT_MEAN_MIN}；笔画 rgb(${textC.strokeRGB.join(',')}) vs 背景 rgb(${textC.bgRGB.join(',')})）`,
                textC.maxDiff < CONTRAST_MIN ? `← 反差 ${textC.maxDiff}：文案与背景几乎同色` : '');
            ok(inpC.maxDiff >= CONTRAST_MIN && inpC.meanDiff >= TEXT_MEAN_MIN,
                `★ [像素] ${label}：输入框里的字与输入框底色反差达标（最大 ${inpC.maxDiff} ≥ ${CONTRAST_MIN}、平均 ${inpC.meanDiff} ≥ ${TEXT_MEAN_MIN}；字 rgb(${inpC.strokeRGB.join(',')}) vs 底 rgb(${inpC.bgRGB.join(',')})）`,
                inpC.maxDiff < CONTRAST_MIN ? `← 反差 ${inpC.maxDiff}：输入框里的字和它的底色几乎同色` : '');
            ok(btnC.maxDiff >= CONTRAST_MIN && btnC.meanDiff >= TEXT_MEAN_MIN,
                `★ [像素] ${label}：按钮文字与按钮底色反差达标（最大 ${btnC.maxDiff} ≥ ${CONTRAST_MIN}、平均 ${btnC.meanDiff} ≥ ${TEXT_MEAN_MIN}；字 rgb(${btnC.strokeRGB.join(',')}) vs 底 rgb(${btnC.bgRGB.join(',')})）`,
                btnC.maxDiff < CONTRAST_MIN ? `← 反差 ${btnC.maxDiff}：按钮文字和按钮底色几乎同色` : '');
        }
        // 汇总：六个组合里不许有任何一个是"几乎同色"
        const worstIcon = rows.reduce((a, r) => (r.iconC.maxDiff < a.iconC.maxDiff ? r : a), rows[0]);
        const worstText = rows.reduce((a, r) => (r.textC.maxDiff < a.textC.maxDiff ? r : a), rows[0]);
        const worstInp = rows.reduce((a, r) => (r.inpC.maxDiff < a.inpC.maxDiff ? r : a), rows[0]);
        const worstBtn = rows.reduce((a, r) => (r.btnC.maxDiff < a.btnC.maxDiff ? r : a), rows[0]);
        ok(rows.every(r => r.iconC.maxDiff >= CONTRAST_MIN),
            `★ 六种主题组合里**没有任何一个**出现"图标与背景几乎同色"（最差是「${worstIcon.label}」=${worstIcon.iconC.maxDiff}）`);
        ok(rows.every(r => r.textC.maxDiff >= CONTRAST_MIN),
            `★ 六种主题组合里**没有任何一个**出现"文案与背景几乎同色"（最差是「${worstText.label}」=${worstText.textC.maxDiff}）`);
        ok(rows.every(r => r.inpC.maxDiff >= CONTRAST_MIN && r.btnC.maxDiff >= CONTRAST_MIN),
            `★ 六种主题组合里**没有任何一个**出现"输入框/按钮的字与底色几乎同色"（输入框最差「${worstInp.label}」=${worstInp.inpC.maxDiff}，按钮最差「${worstBtn.label}」=${worstBtn.btnC.maxDiff}）`);
        // 输入框/按钮的底色也必须跟着主题翻转（浅色底/深色底），否则会在某一套主题下变成"浅底浅字"
        ok(rows.every(r => r.geo.inpBg !== r.geo.bg || r.geo.inpFg === r.geo.bg),
            `★ 六种组合里输入框/按钮的底色确实随主题变（${rows.map(r => `${r.label.replace('系统=', '').replace(' 站点=', '/')}→底${r.inpC.bgLum}`).join('，')}）`);
        // 图标颜色确实被 filter 强制成纯黑/纯白（与背景明暗相反）
        ok(rows.every(r => (r.iconC.strokeLum < 60) !== (r.iconC.bgLum < 128)),
            `★ 六种组合里图标的实际像素颜色都与背景明暗相反（${
                rows.map(r => `${r.label}:芯${r.iconC.strokeLum}/底${r.iconC.bgLum}`).join('，')}）`);
        await send('Emulation.setEmulatedMedia', { features: [] });
        await evaluate(`(() => { document.documentElement.removeAttribute('data-color-scheme'); const i = document.querySelector('.gate-denied-input'); if (i) i.value = ''; return true; })()`);
        await send('Emulation.clearDeviceMetricsOverride');
        await sleep(300);
    }

    // 未授权时点开也看不到东西：把窗口缩到很小再看一次（防止"藏在视口外"）
    {
        await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
        await sleep(300);
        const small = await probe();
        ok(small.leaks.length === 0 && small.visibleText === DENIED_VISIBLE, `[127.0.0.2] 375×667 手机视口下同样只剩提示（越界 ${small.leaks.length} 个）`);
        const geo = JSON.parse(await evaluate(`(() => {
            const i = document.querySelector('.gate-denied-icon');
            const t = document.querySelector('.gate-denied-text');
            const f = document.querySelector('.gate-denied-form');
            const n = document.querySelector('.gate-denied-input');
            const b = document.querySelector('.gate-denied-submit');
            const r = i ? i.getBoundingClientRect() : null, rt = t ? t.getBoundingClientRect() : null;
            const rf = f ? f.getBoundingClientRect() : null, rn = n ? n.getBoundingClientRect() : null, rb = b ? b.getBoundingClientRect() : null;
            const box = e => e ? [Math.round(e.left), Math.round(e.right), Math.round(e.width)] : null;
            return JSON.stringify({
                innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth,
                img: box(r), text: box(rt), form: box(rf), input: box(rn), btn: box(rb)
            });
        })()`));
        ok(geo.img && geo.img[0] >= 0 && geo.img[1] <= geo.innerW,
            `[127.0.0.2] ★ 375px 窄屏下图标不横向溢出（img=[左${geo.img && geo.img[0]}, 右${geo.img && geo.img[1]}, 宽${geo.img && geo.img[2]}]，innerWidth=${geo.innerW}）`);
        ok(geo.text && geo.text[0] >= 0 && geo.text[1] <= geo.innerW,
            `[127.0.0.2] ★ 375px 窄屏下文案不横向溢出（text=[左${geo.text && geo.text[0]}, 右${geo.text && geo.text[1]}]）`);
        ok(geo.input && geo.btn && geo.input[0] >= 0 && geo.btn[1] <= geo.innerW && geo.input[2] > 40,
            `[127.0.0.2] ★ 375px 窄屏下口令输入框 + 按钮都放得下、输入框也没被挤成 0 宽（输入框=[左${geo.input && geo.input[0]}, 右${geo.input && geo.input[1]}, 宽${geo.input && geo.input[2]}]，按钮=[左${geo.btn && geo.btn[0]}, 右${geo.btn && geo.btn[1]}]）`);
        ok(geo.scrollW <= geo.innerW + 1,
            `[127.0.0.2] ★ 375px 窄屏下整页没有横向滚动（scrollWidth=${geo.scrollW} ≤ innerWidth=${geo.innerW}）`);
        await send('Emulation.clearDeviceMetricsOverride');
        await sleep(300);
    }

    // ── 3. #k=<正确令牌> ⇒ 放行 + 写标记 + 片段被清掉 ──
    await setStorage(H.alt, null);
    const hashOkRun = await visit(urlOn(H.alt, '#k=' + TEST_TOKEN), `document.documentElement.classList.contains('gate-ok')`);
    ok(hashOkRun.gateOk, '[#k=正确令牌] ★ 放行');
    ok(hashOkRun.mark === SERVE_MARK, `[#k=正确令牌] ★ 写入了与哈希绑定的标记（ls=${hashOkRun.mark}）`);
    ok(!/[#&?]k=/.test(hashOkRun.href) && !hashOkRun.href.includes(TEST_TOKEN) && hashOkRun.search === '',
        `[#k=正确令牌] ★ 令牌已从地址栏抹掉（href 里没有 k=<令牌>：${hashOkRun.href}；剩的 hash 是站点路由自己写的 ${JSON.stringify(hashOkRun.hash)}）`);
    ok(hashOkRun.bodyText.length > 40, `[#k=正确令牌] 放行后原内容在（body 文本 ${hashOkRun.bodyText.length} 字）`);

    // ── 4. ?k=<正确令牌> ⇒ 同样放行 ──
    await setStorage(H.alt, null);
    const qOkRun = await visit(urlOn(H.alt, '?k=' + TEST_TOKEN), `document.documentElement.classList.contains('gate-ok')`);
    ok(qOkRun.gateOk, '[?k=正确令牌] ★ 兼容查询串形态，同样放行');
    ok(qOkRun.mark === SERVE_MARK, '[?k=正确令牌] 同样写入标记');
    ok(!/[#&?]k=/.test(qOkRun.href) && !qOkRun.href.includes(TEST_TOKEN), `[?k=正确令牌] ★ 查询串里的 k 也被清掉（${qOkRun.href}）`);

    // ── 5. 错误令牌 ⇒ 拒绝 ──
    await setStorage(H.alt, null);
    const wrong = await visit(urlOn(H.alt, '#k=' + TEST_TOKEN.split('').reverse().join('')), `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
    ok(!wrong.gateOk, '[错误令牌] ★ 被拒绝');
    ok(wrong.visibleText === DENIED_VISIBLE && wrong.leaks.length === 0, `[错误令牌] ★ 内容不可见，只剩 ${JSON.stringify(wrong.visibleText)}`);

    // ── 6. 带令牌 + 深链路由：路由必须还在，而且真的跳过去了 ──
    const ROUTE = 'coins/commemorative_coins/coincomm/s3';
    for (const [label, suffix] of [
        ['#k=…&路由', '#k=' + TEST_TOKEN + '&' + ROUTE],
        ['#路由&k=…', '#' + ROUTE + '&k=' + TEST_TOKEN]
    ]) {
        await setStorage(H.alt, null);
        const r = await visit(urlOn(H.alt, suffix), `document.querySelectorAll('.series-body.open').length >= 1`);
        ok(r.gateOk, `[${label}] 放行`);
        ok(r.hash === '#' + ROUTE, `[${label}] ★ 片段里的 k 被摘掉、路由原样保留（hash=${r.hash}）`);
        ok(r.openSeries >= 1, `[${label}] ★ 路由真的生效（.series-body.open = ${r.openSeries}）`);
        const geo = await evaluate(`(() => { const b = document.querySelector('.series-body.open'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '|' + getComputedStyle(b).visibility; })()`);
        ok(geo !== 'none' && geo.split('|')[1] === 'visible' && !/^0x/.test(geo),
            `[${label}] ★ 打开的系列体可见且有尺寸（${geo}）`);
    }
    // 只清 k、不碰其它 hash 参数之外的 query（站内大量用 ?t= 之类做 cache-buster）
    await setStorage(H.alt, null);
    const keepQuery = await visit(urlOn(H.alt, '?t=12345&k=' + TEST_TOKEN + '&x=1#coins/commemorative_coins/s0'),
        `document.documentElement.classList.contains('gate-ok')`);
    ok(keepQuery.gateOk, '[混合参数] 放行');
    ok(keepQuery.search === '?t=12345&x=1', `[混合参数] ★ 只删了 k，其余 query 原样保留（search=${keepQuery.search}）`);
    ok(keepQuery.hash === '#coins/commemorative_coins/s0', `[混合参数] ★ hash 路由保留（hash=${keepQuery.hash}）`);

    // ── 7. 标记语义：正确标记放行 / 旧令牌的标记拒绝 / 换回新链接重新放行 ──
    await setStorage(H.alt, SERVE_MARK);
    const byMark = await visit(urlOn(H.alt, ''), `document.documentElement.classList.contains('gate-ok')`);
    ok(byMark.gateOk && byMark.bodyText.length > 40, '★ [标记正确] 无令牌也放行（老设备日常无感）');

    const OLD_MARK = sha256('an-old-token-that-was-rotated-away').slice(0, MARK_LEN);
    await setStorage(H.alt, OLD_MARK);
    const stale = await visit(urlOn(H.alt, ''), `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
    ok(!stale.gateOk, `★ [标记=上一个令牌的值] 被拒绝（换令牌后老设备自动失效）`);
    ok(stale.visibleText === DENIED_VISIBLE, `[标记=上一个令牌的值] 内容不可见，只剩 ${JSON.stringify(stale.visibleText)}`);

    const back = await visit(urlOn(H.alt, '#k=' + TEST_TOKEN), `document.documentElement.classList.contains('gate-ok')`);
    ok(back.gateOk && back.mark === SERVE_MARK, '★ [换回当前令牌链接] 重新放行并把标记更新为当前值');
    const again = await visit(urlOn(H.alt, ''), `document.documentElement.classList.contains('gate-ok')`);
    ok(again.gateOk, '[换回后] 再不带令牌进也放行（标记已更新）');

    // ── 8. 关掉 JavaScript 也进不去 ──
    await setStorage(H.alt, null);
    await send('Emulation.setScriptExecutionDisabled', { value: true });
    await goto(urlOn(H.alt, ''));
    await sleep(2500);
    let noJs = null;
    try { noJs = await probe(); } catch (e) { noJs = null; }
    if (noJs) {
        ok(!noJs.gateOk && noJs.htmlVisibility === 'hidden', '★ [关 JS] 没有 gate-ok、html 仍然隐藏在（脚本根本没跑）');
        ok(noJs.leaks.filter(l => !/noscript/i.test(l)).length === 0, `★ [关 JS] 页面内容不可见（越界可见元素 ${noJs.leaks.length} 个）`);
        ok(String(noJs.beforeContent).includes(DENIED_TEXT), `★ [关 JS] 仍然看到提示：::before content=${noJs.beforeContent}`);
    } else {
        // evaluate 被禁掉时退到 CDP DOM 层取证
        const doc = await send('DOM.getDocument', { depth: -1 });
        const htmlNode = doc.root.children ? doc.root.children.find(n => n.nodeName === 'HTML') : null;
        const attrs = htmlNode ? (htmlNode.attributes || []) : [];
        const hasGateOk = attrs.some((v, i) => v === 'class' && /gate-ok/.test(attrs[i + 1] || ''));
        const outer = (await send('DOM.getOuterHTML', { nodeId: doc.root.nodeId })).outerHTML;
        ok(!hasGateOk, '★ [关 JS] html 上没有 gate-ok（脚本没跑）');
        ok(/html:not\(\.gate-ok\)/.test(outer) && /content:\s*"暂无访问权限"/.test(outer),
            '★ [关 JS] 兜底隐藏 CSS 与 ::before 提示都在页面里（不需要脚本）');
    }
    await send('Emulation.setScriptExecutionDisabled', { value: false });

    // ── 9. crypto.subtle 不可用（非安全上下文 / 老浏览器）⇒ 不放行 ──
    await setStorage(H.alt, null);
    const pre = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(function () {
            var kill = { get: function () { return undefined; }, configurable: true };
            try { Object.defineProperty(window.crypto, 'subtle', kill); } catch (e) { }
            try { Object.defineProperty(Crypto.prototype, 'subtle', kill); } catch (e) { }
        })();`
    });
    await goto(urlOn(H.alt, '#k=' + TEST_TOKEN));
    await sleep(2500);
    const noSubtle = await probe();
    const subtleGone = await evaluate(`typeof crypto.subtle`);
    ok(subtleGone === 'undefined', `[crypto.subtle 不可用] 探针生效（typeof crypto.subtle = ${subtleGone}）`);
    ok(!noSubtle.gateOk, '★ [crypto.subtle 不可用] 即使令牌正确也不放行（宁挡勿放）');
    ok(noSubtle.visibleText === DENIED_TEXT, `[crypto.subtle 不可用] 内容不可见，只剩 ${JSON.stringify(noSubtle.visibleText)}`);
    ok(noSubtle.formHidden === true,
        '★ [crypto.subtle 不可用] 输入框被藏起来了（没法校验就不给框，免得误导用户以为能试出口令）');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre.identifier });

    // ── 10. 未授权时"内容不可见"的判定方式自证：探针必须能分辨可见 / 不可见 ──
    console.log('\n  ── 探针灵敏度自证 ──');
    await setStorage(H.alt, SERVE_MARK);
    const allowProbe = await visit(urlOn(H.alt, ''), `document.documentElement.classList.contains('gate-ok')`);
    ok(allowProbe.leaks.length > 0 && allowProbe.visibleText.length > 40 && allowProbe.htmlVisibility === 'visible',
        `★ 放行时同一个探针报"有内容可见"（越界可见元素 ${allowProbe.leaks.length} 个、可见文本 ${allowProbe.visibleText.length} 字）—— 说明它不是在无脑返回空`);
    await setStorage(H.alt, null);
    const denyProbe = await visit(urlOn(H.alt, ''), `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
    ok(denyProbe.leaks.length === 0 && denyProbe.visibleText === DENIED_VISIBLE,
        `★ 拒绝时同一个探针报"只剩提示"（越界 0 个、可见文本 ${JSON.stringify(denyProbe.visibleText)}）`);

    // ── 11. ★ 任务 B：被拒页上的口令输入框（用户主动要求）──────────────────
    // 再次强调：**它不增加任何安全性**，只是省掉"链接里的 #k= 被聊天软件吃掉"的麻烦。
    {
        console.log('\n  ── 被拒页的口令输入框 ──');
        await setStorage(H.alt, null);
        const WRONG_TOKEN = TEST_TOKEN.split('').reverse().join('');
        const f0 = await visit(urlOn(H.alt, '#k=' + WRONG_TOKEN),
            `document.querySelector('.gate-denied-form') && document.querySelector('.gate-denied-input')`);
        const attrs = JSON.parse(await evaluate(`(() => {
            const i = document.querySelector('.gate-denied-input'), b = document.querySelector('.gate-denied-submit');
            return JSON.stringify(i ? {
                type: i.getAttribute('type'), ac: i.getAttribute('autocomplete'), acl: i.getAttribute('autocapitalize'),
                sc: i.getAttribute('spellcheck'), placeholder: i.getAttribute('placeholder'), title: i.getAttribute('title'),
                btn: b ? b.textContent : null, action: document.querySelector('.gate-denied-form').getAttribute('action')
            } : { missing: true });
        })()`));
        ok(attrs.type === 'text' && attrs.ac === 'off' && attrs.acl === 'off' && attrs.sc === 'false',
            `★ 输入框属性齐了（type=${attrs.type}、autocomplete=${attrs.ac}、autocapitalize=${attrs.acl}、spellcheck=${attrs.sc}）`);
        ok(attrs.placeholder === null && attrs.title === null && attrs.action === null,
            `★ 输入框上没有任何"示例/格式/长度"提示（placeholder=${attrs.placeholder}、title=${attrs.title}），表单也没有 action`);
        ok(attrs.btn === SUBMIT_TEXT, `提交按钮文字逐字是「${SUBMIT_TEXT}」（实际 ${JSON.stringify(attrs.btn)}）`);
        ok(f0.gateOk === false && f0.errHidden === true,
            `★ 刚进来时错误提示是藏着的（errHidden=${f0.errHidden}），可见文本 ${JSON.stringify(f0.visibleText)}`);
        ok(f0.events.filter(e => e.kind === 'exception').length === 0,
            `★ 错误令牌被拒时同样 0 条未捕获异常（实际 ${f0.events.filter(e => e.kind === 'exception').length} 条）`);

        // ① 错口令：仍被拒、只给一句中性提示、不写标记、刷新后仍被拒
        const submit = (v) => evaluate(`(() => {
            const i = document.querySelector('.gate-denied-input');
            i.value = ${JSON.stringify(v)};
            document.querySelector('.gate-denied-submit').click();
            return true;
        })()`);
        await submit('definitely-not-the-token');
        await sleep(1500);
        const w = await probe();
        ok(w.gateOk === false && w.mark === null,
            `★ [错口令] 仍然被拒、**没有写标记**（ls=${w.mark}）`);
        ok(w.visibleText === DENIED_VISIBLE + WRONG_TEXT,
            `★ [错口令] 只多了一句中性提示，逐字是 ${JSON.stringify(DENIED_VISIBLE + WRONG_TEXT)}（实际 ${JSON.stringify(w.visibleText)}）`);
        ok(!/\d/.test(w.visibleText.replace(DENIED_TEXT, '')) && !/次|长度|接近|相似/.test(w.visibleText),
            '★ [错口令] 提示里没有剩余次数 / 长度 / "接近"之类的任何暗示');
        const afterReload = await visit(urlOn(H.alt, ''),
            `document.body && document.body.textContent.includes(${JSON.stringify(DENIED_TEXT)})`);
        ok(afterReload.gateOk === false && afterReload.mark === null,
            '★ [错口令] 刷新之后仍然被拒（没有留下任何"过了一半"的状态）');

        // ② 对口径：放行 + 写标记 + k 参数被摘掉 + 内容真的渲染出来
        await setStorage(H.alt, null);
        const f1 = await visit(urlOn(H.alt, '#k=' + WRONG_TOKEN),
            `document.querySelector('.gate-denied-input')`);
        await submit(TEST_TOKEN);
        const released = await waitFor(`document.documentElement.classList.contains('gate-ok')`, 9000);
        ok(released, '★ [对口径] 提交正确口令 ⇒ 自动重新加载后放行（location.replace 掉的还是同一个地址）');
        await sleep(1500);
        const okRun = await probe();
        ok(okRun.gateOk && okRun.mark === SERVE_MARK,
            `★ [对口径] 标记写成了当前哈希前 ${MARK_LEN} 位（ls=${okRun.mark}）`);
        ok(!/[#&?]k=/.test(okRun.href) && !okRun.href.includes(TEST_TOKEN),
            `★ [对口径] 地址栏里没有令牌（${okRun.href}）`);
        ok(okRun.bodyText.length > 40 && okRun.leaks.length > 0,
            `★ [对口径] 放行后站点内容真的渲染出来了（body 文本 ${okRun.bodyText.length} 字、越界可见元素 ${okRun.leaks.length} 个）`);
        ok(f1.events.filter(e => e.kind === 'exception').length === 0, '★ [对口径] 提交过程中也没有未捕获异常');

        // ③ 与链接路径**同一条校验路径**（静态自证：同一个 SHA-256 + 同一个恒定时间比较）
        const impl = readFileSync(GATE_JS, 'utf8');
        const ctCount = (impl.match(/function ctEqual\(/g) || []).length;
        ok(ctCount === 1, `★ 恒定时间比较函数只有一份实现（ctEqual 定义 ${ctCount} 次）—— 链接与输入框共用`);
        ok(/var SUBMIT_JS = '\(function\(\)\{'[\s\S]*?function ct\(a,b\)/.test(impl),
            '★ 输入框那段脚本里也用的是**恒定时间比较**（长度差异折进 diff、逐字符异或、不提前退出）');
        ok(/function verifyToken\(candidate, subtleApi, cb\)/.test(impl) && /verifyToken\(token, subtle, /.test(impl) && /verifyToken\(inp\.value, subtle, /.test(impl),
            '★ 链接路径与输入框路径都调用同一个 verifyToken()');
    }

    // ── 12. 整轮控制台账本：放行路径也不许有未捕获异常 ──
    {
        const excAll = events.filter(e => e.kind === 'exception');
        const ownAll = events.filter(e => e.kind === 'console' && e.text.includes(CONSOLE_PREFIX));
        const consoleAll = events.filter(e => e.kind === 'console');
        const browserLogs = events.filter(e => e.kind === 'browserlog');
        console.log('\n  ── 整轮控制台账本（本次进程内所有导航）──');
        console.log(`     未捕获异常 ${excAll.length} 条；页面 console 输出 ${consoleAll.length} 条（其中 ${CONSOLE_PREFIX} 前缀 ${ownAll.length} 条，其余 ${debugConsoleCount} 条是 ?gatedebug=1 那次刻意打开的）；浏览器自身 Log 条目 ${browserLogs.length} 条`);
        for (const e of excAll.slice(0, 5)) console.log(`       [异常] ${String(e.text).slice(0, 130)}`);
        for (const e of browserLogs.slice(0, 5)) console.log(`       [浏览器] ${String(e.text).slice(0, 130)}`);
        ok(excAll.length === 0, `★ 整轮 0 条未捕获异常（实际 ${excAll.length} 条）`);
        ok(consoleAll.length === ownAll.length && ownAll.length === debugConsoleCount,
            `★ 整轮页面 console 输出只有 ?gatedebug=1 那次刻意打的 ${debugConsoleCount} 条，其余一律为 0（实际共 ${consoleAll.length} 条）`);
    }

    console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
} finally {
    try { ws.close(); } catch { }
    try { child.kill(); } catch { }
    try { server.close(); } catch { }
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch { }
    await sleep(400);
    process.exit(fail ? 1 : 0);
}
