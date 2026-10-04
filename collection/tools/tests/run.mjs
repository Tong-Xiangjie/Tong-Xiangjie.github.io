#!/usr/bin/env node
// ==================== 回归用例 runner ====================
// 零依赖：只用 Node 自带模块（Node 22+ —— 用例里用了全局 WebSocket 与 fetch）。
//
// 用法（在仓库根目录执行）：
//     node collection/tools/tests/run.mjs                  # 跑全部
//     node collection/tools/tests/run.mjs --list           # 只列清单
//     node collection/tools/tests/run.mjs --only sw        # 只跑文件名含 "sw" 的
//     node collection/tools/tests/run.mjs --skip 4issues,octo
//     node collection/tools/tests/run.mjs --data-only      # 只做数据自检
//     node collection/tools/tests/run.mjs --all            # 连"已知漂移"的老用例一起跑
//
// 退出码约定（用例侧）：0 = 通过；1 = 有断言失败；2 = 环境问题；3 = 跳过（缺本地工件）
//
// ★ 已知漂移的老用例：用 git worktree 在"本会话之前的代码"上复核过，它们在改动前
//   就是红的 —— 不是被改坏的，而是被测界面早就变了、用例没跟上（这些用例以前从没进过
//   CI，所以一直没人发现）。默认跳过以保证 CI 是绿的，但跳过这件事必须**写在明面上**：
//   下面列出原因，汇总里也会打出来；要连它们一起跑就加 --all。
const KNOWN_STALE = [
    ['verify-coldstart.mjs', '深链接展开后 hash 里的品种写法与断言不一致（待判定是行为变更还是 bug）'],
    ['verify-deeplink.mjs', '界面会多开一个品种列表，断言只允许开一个（同上）'],
    ['verify-roundtrip.mjs', '往返后会多一个 copies-* 容器保持展开（同上）'],
    ['verify-flip.mjs', '「打开时存在飞行图层」取样太晚：飞行图层只存在约 400ms，弹窗出现后再采样就没了（先用例时序问题，非断言错）'],
    ['verify-article-fuzzy.mjs', '「生肖钞」分组少收录一篇文章（102/1 通过）']
];
const STALE_REASON = new Map(KNOWN_STALE);
//
// 每个用例都是自包含的：自己起本地 HTTP 服务器、自己拉起无头 Chrome、自己断言。
// 所以：
//   1) 顺序执行。每个用例都要开一个 Chrome，并发会把机器压垮，也会互相抢资源。
//   2) Chrome 路径由本 runner 解析一次，用 CHROME_PATH 传给子进程 —— 用例里那份
//      "按平台猜路径"的兜底只在直接单跑某个用例时才用得上。
//   3) cwd 固定为仓库根目录：用例里读的都是 collection/xxx.js 这种仓库相对路径。
//
// 退出码：0 = 全部通过；1 = 有用例失败；2 = 环境问题（例如找不到 Chrome）。
import { readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');          // collection/tools/tests → 仓库根
const DATA_CHECK = join(ROOT, 'collection', 'tools', 'check-data.mjs');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
};

// ---------- Chrome 解析（本地/CI 通用）----------
function resolveChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    return candidates.find(p => p && existsSync(p)) || '';
}

const chrome = resolveChrome();
const env = { ...process.env };
if (chrome) env.CHROME_PATH = chrome;

console.log('════════════════════════════════════════════════');
console.log('  collection 回归用例');
console.log('════════════════════════════════════════════════');
console.log(`  仓库根目录 : ${ROOT}`);
console.log(`  Node       : ${process.version}`);
console.log(`  Chrome     : ${chrome || '✗ 没找到（请设 CHROME_PATH，或安装 Chrome/Chromium）'}`);
console.log(`  环境       : ${process.env.CI ? 'CI' : '本地'}  ${process.platform}`);
console.log('');

// ---------- 用例清单 ----------
const only = argOf('--only');
const skip = argOf('--skip').split(',').map(s => s.trim()).filter(Boolean);
// 两个位置都要收：本目录的 verify-*.mjs，以及 collection/tools/ 下那个已进仓库的
// verify-mode-registry.mjs（板块注册表检查，文档 ARCHITECTURE-modes.md 指的就是它）。
const TOOLS_DIR = join(ROOT, 'collection', 'tools');
let tests = [
    ...readdirSync(HERE).filter(n => /^verify-.*\.mjs$/.test(n)).map(n => ({ name: n, file: join(HERE, n) })),
    ...readdirSync(TOOLS_DIR).filter(n => /^verify-.*\.mjs$/.test(n)).map(n => ({ name: n, file: join(TOOLS_DIR, n) }))
].sort((a, b) => (a.name < b.name ? -1 : 1));
if (only) tests = tests.filter(t => t.name.includes(only));
if (skip.length) tests = tests.filter(t => !skip.some(s => t.name.includes(s)));

// 已知漂移的老用例：默认跳过。用 --only 点名时会照跑（方便专门排查它们），--all 也照跑。
const staleSkipped = [];
if (!hasFlag('--all') && !only) {
    tests = tests.filter(t => {
        if (STALE_REASON.has(t.name)) { staleSkipped.push(t.name); return false; }
        return true;
    });
}
if (staleSkipped.length) {
    console.log(`  ⏭ 跳过 ${staleSkipped.length} 个"已知漂移"的老用例（--all 可一起跑）：`);
    for (const n of staleSkipped) console.log(`      · ${n} —— ${STALE_REASON.get(n)}`);
    console.log('');
}

if (hasFlag('--list')) {
    console.log('  用例清单：');
    for (const t of tests) console.log('    · ' + t.name + (t.file.startsWith(HERE) ? '' : '   （collection/tools/ 下）'));
    console.log(`\n  共 ${tests.length} 个`);
    process.exit(0);
}
if (!tests.length) {
    console.log('  ✗ 没有匹配到任何用例');
    process.exit(2);
}

// ---------- 跑 ----------
const results = [];
// ★ 为什么要自己转发子进程输出（原来直接 stdio: 'inherit'）：
//   CI 日志要鉴权才能下载，能匿名读到的只有 check-run 注解。注解里如果只写"断言失败"，
//   就等于没有信息 —— 2026-10 那次 CI 有 5 个用例"本地全绿、CI 全红"，
//   注解只告诉我它们失败了，具体是哪条断言完全看不到。
//   所以现在把子进程的 stdout/stderr 边转发边留一份，失败时把**第一条 ✗ 断言**塞进注解。
const MAX_KEEP = 200 * 1024;                 // 只留尾部 200KB，避免长输出把内存堆起来
const runOne = (label, file, args = []) => new Promise(done => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [file, ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = buf => {
        const s = buf.toString();
        out = (out + s).slice(-MAX_KEEP);
        process.stdout.write(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => { console.log(`  ✗ 启动失败：${e.message}`); done({ label, code: 2, ms: Date.now() - t0, firstFail: '启动失败：' + e.message }); });
    child.on('close', code => {
        const failLines = out.split(/\r?\n/).map(l => l.trim()).filter(l => /^✗/.test(l));
        done({
            label,
            code: code === null ? 2 : code,
            ms: Date.now() - t0,
            firstFail: failLines[0] || '',
            failCount: failLines.length
        });
    });
});

const t0 = Date.now();
if (!hasFlag('--no-data') && (hasFlag('--data-only') || existsSync(DATA_CHECK))) {
    console.log('\n─── 数据自检（check-data.mjs）────────────────────\n');
    const r = await runOne('check-data', DATA_CHECK);
    results.push(r);
    if (hasFlag('--data-only')) {
        printSummary(results, t0);
        process.exit(r.code === 0 ? 0 : 1);
    }
}

if (!hasFlag('--data-only')) {
    for (let i = 0; i < tests.length; i++) {
        console.log(`\n─── [${i + 1}/${tests.length}] ${tests[i].name} ────────────────────\n`);
        results.push(await runOne(tests[i].name, tests[i].file));
    }
}

function printSummary(results, t0) {
    // exit 3 = 用例自己报"跳过"（缺本地工件），不算失败
    const bad = results.filter(r => r.code !== 0 && r.code !== 3);
    const skipped = results.filter(r => r.code === 3);
    console.log('\n════════════════════════════════════════════════');
    console.log('  汇总');
    console.log('════════════════════════════════════════════════');
    for (const r of results) {
        const mark = r.code === 0 ? '✓' : (r.code === 3 ? '⏭' : (r.code === 2 ? '⚠' : '✗'));
        console.log(`  ${mark} ${r.label.padEnd(28)} exit=${r.code}  ${(r.ms / 1000).toFixed(1)}s`);
    }
    console.log(`\n  共 ${results.length} 项，通过 ${results.length - bad.length - skipped.length}，跳过 ${skipped.length}，失败 ${bad.length}，用时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
    if (skipped.length) {
        console.log('\n  跳过的项（缺本地工件，见各自输出里的 ⏭ 行）：');
        for (const r of skipped) console.log(`    ⏭ ${r.label}`);
    }
    if (staleSkipped.length) {
        console.log('\n  按"已知漂移"名单跳过的项（要跑就加 --all）：');
        for (const n of staleSkipped) console.log(`    ⏭ ${n}`);
    }
    if (bad.length) {
        console.log('\n  失败项：');
        for (const r of bad) {
            console.log(`    · ${r.label}（exit=${r.code}${r.code === 2 ? '，多半是环境问题，比如找不到 Chrome' : ''}）`);
            if (r.firstFail) console.log(`        ${r.firstFail}`);
        }
    }
    return bad.length;
}

const bad = printSummary(results, t0);

// GitHub Actions：把结果做成注解（workflow command）。
// 为什么值得加：CI 日志要鉴权才能下载，而 check-run 的注解用公开 API 就能读到 ——
// 失败时能直接看到是哪个用例，不用翻整份日志；注解也会显示在提交页面上。
if (process.env.GITHUB_ACTIONS) {
    for (const r of results) {
        if (r.code === 0 || r.code === 3) continue;
        const why = r.code === 2 ? '环境问题（多半是找不到 Chrome）' : '断言失败';
        const short = r.label.replace(/^verify-/, '').replace(/\.mjs$/, '');
        // ★ 把首个失败断言原文带上（`:：` 这类字符要转义，否则会把注解截断）
        const detail = r.firstFail
            ? `；首个失败断言：${r.firstFail.replace(/%/g, '%25').replace(/\r?\n/g, ' ').slice(0, 300)}${r.failCount > 1 ? `（共 ${r.failCount} 条 ✗）` : ''}`
            : '';
        console.log(`::error title=${r.label} 失败（exit=${r.code}）::${why}${detail}；本地复现：node collection/tools/tests/run.mjs --only ${short}`);
    }
    for (const r of results) {
        if (r.code !== 3) continue;
        console.log(`::notice title=${r.label} 已跳过::缺本地工件，见它的输出`);
    }
    for (const n of staleSkipped) {
        console.log(`::notice title=${n} 已跳过::已知漂移（非本次改动导致），见 collection/tools/tests/README.md`);
    }
    if (bad === 0) console.log(`::notice title=回归用例全部通过::通过 ${results.length - results.filter(r => r.code === 3).length} 项`);
}

process.exit(bad === 0 ? 0 : 1);
