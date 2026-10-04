// 盯 CI：等 GitHub Actions 跑完，把失败步骤与注解打出来，再复查线上文件有没有更新。
// 用法：node collection/tools/tests/ci-watch.mjs [commit-sha]   不给 SHA 就盯 main 上最新一次运行。
//
// 为什么写成脚本：CI 在 GitHub 上、不是本地后台任务，只能轮询等它；写成后台任务我才不会被"忙等"卡住。
//
// ★ 配额教训：匿名调用 GitHub API 上限 60 次/小时。最初这版每 30 秒查一次、最多 70 次，
//   一次就把配额打光，之后所有查询都 403（连"运行列表"都拿不到，脚本直接报
//   Cannot read properties of undefined）。现在改成：开跑前先看 /rate_limit
//   （这个接口本身不计数），配额不够就等到重置；轮询间隔 60 秒、最多 30 次；
//   剩余配额低于 3 时提前收手，把已经拿到的信息打出来。
const REPO = 'Tong-Xiangjie/Tong-Xiangjie.github.io';
const SHA = process.argv[2] || '';
const H = { 'User-Agent': 'dsh-ci-watch', Accept: 'application/vnd.github+json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;

async function api(p, { optional = false } = {}) {
    const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, { headers: H });
    calls++;
    if (!r.ok) {
        const remain = r.headers.get('x-ratelimit-remaining');
        const reset = Number(r.headers.get('x-ratelimit-reset'));
        const eta = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString().slice(11, 19) : '?';
        const msg = `GitHub API ${r.status}（本次共调用 ${calls} 次，剩余配额 ${remain ?? '?'}，重置于 ${eta}Z）：${(await r.text()).slice(0, 160)}`;
        if (optional) { console.log('  ' + msg); return null; }
        throw new Error(msg);
    }
    return r.json();
}

async function ensureQuota() {
    const q = await fetch('https://api.github.com/rate_limit', { headers: H }).then(r => r.json()).catch(() => null);
    const core = q && q.resources && q.resources.core;
    if (!core || core.remaining >= 5) return true;
    const waitMs = Math.max(0, core.reset * 1000 - Date.now()) + 5000;
    if (waitMs > 65 * 60 * 1000) { console.log(`  配额还要等约 ${Math.round(waitMs / 60000)} 分钟才重置，太久，先退出`); return false; }
    console.log(`  匿名 API 配额只剩 ${core.remaining} 次，等重置（约 ${Math.round(waitMs / 60000)} 分钟）再查…`);
    await sleep(waitMs);
    return true;
}

if (!(await ensureQuota())) process.exit(0);

const runs = await api('/actions/runs?per_page=10&branch=main');
if (!runs || !Array.isArray(runs.workflow_runs)) { console.log('  拿不到运行列表，先退出（配额或网络问题）'); process.exit(0); }
const run = SHA ? runs.workflow_runs.find(r => String(r.head_sha).startsWith(SHA)) : runs.workflow_runs[0];
if (!run) { console.log(`  最近 10 次运行里没有 ${SHA || '（最新）'}；可能还没排上队`); process.exit(0); }
console.log(`盯住运行 ${run.id}（${run.head_sha.slice(0, 8)}，当前 ${run.status}）`);

let last = null;
for (let i = 0; i < 30; i++) {
    const cur = await api(`/actions/runs/${run.id}`, { optional: true });
    if (!cur) { console.log('  查询失败，停止轮询'); break; }
    last = cur;
    if (cur.status === 'completed') {
        console.log(`\n运行结束：${cur.conclusion}  用时 ${Math.round((Date.parse(cur.updated_at) - Date.parse(cur.created_at)) / 1000)}s`);
        break;
    }
    const remain = Number(cur.rate && cur.rate.remaining);
    if (Number.isFinite(remain) && remain < 3) { console.log(`\n  剩余配额 ${remain} 次，不再轮询（当前状态 ${cur.status}）`); break; }
    await sleep(60000);
}
if (last && last.status !== 'completed') console.log(`\n（轮询结束，运行仍在 ${last.status}，用时已 ${Math.round((Date.now() - Date.parse(last.created_at)) / 1000)}s）`);

const jobs = await api(`/actions/runs/${run.id}/jobs`, { optional: true });
for (const j of (jobs && jobs.jobs) || []) {
    console.log(`\n作业 ${j.name}：${j.status} / ${j.conclusion}`);
    for (const s of j.steps || []) console.log(`   ${s.conclusion === 'success' ? '✓' : s.conclusion === 'failure' ? '✗' : '·'} ${s.name}`);
}
const cr = await api(`/commits/${run.head_sha}/check-runs`, { optional: true });
for (const c of (cr && cr.check_runs) || []) {
    const an = await api(`/check-runs/${c.id}/annotations`, { optional: true });
    if (an && an.length) {
        console.log(`\n注解（${c.name}）：`);
        for (const a of an) console.log(`   [${a.annotation_level}] ${a.title} :: ${a.message}`);
    }
}

console.log('\n=== 线上文件复查（带缓存绕过）===');
const LIVE = [
    ['collection/layout.css', [['色块缩放', /tl-heatmap-cell:hover > \.tl-hm-fill\s*\{\s*transform: scale\(1\.04\)/], ['年份侧边泡', /translateY\(-50%\) translateX\(-3px\)/], ['表头上叠 2px', /top: calc\(100% - 2px\)/]]],
    ['collection/special.js', [['连续深浅', /--hm-o/], ['按屏幕取左右边界', /getRenderContainer/], ['文案格式', /共购入\$\{n\}件，合计/]]],
    ['collection/vendor/hammer.min.js', [['本地 hammer 在线', /Hammer/]]],
    ['answersheet/vendor/html2pdf.bundle.min.js', [['本地 html2pdf 在线', /html2pdf/]]],
    ['answersheet/vendor/jspdf.umd.min.js', [['本地 jsPDF 在线', /jsPDF/]]]
];
for (const [f, tests] of LIVE) {
    try {
        const r = await fetch(`https://tong-xiangjie.github.io/${f}?cb=${Math.random()}`, { cache: 'no-store' });
        const txt = await r.text();
        console.log(`  ${f}：HTTP ${r.status}，长度 ${txt.length}`);
        for (const [name, re] of tests) console.log(`     ${re.test(txt) ? '✓' : '✗'} ${name}`);
    } catch (e) { console.log(`  ${f}：取不到（${e.message}）`); }
}
// 整站还有没有 cdnjs 之类的外链（就是这次 A3 收尾要保证的事）
const PAGES = ['collection/index.html', 'notecollection/index.html', 'coincollection/index.html', 'newcollection/index.html', 'funcollection/years/index.html', 'answersheet/index.html'];
const CDN = /https?:\/\/(cdnjs|cdn\.jsdelivr|unpkg)/;
let cdnLeft = 0;
console.log('\n=== 线上各页面是否还有 CDN 外链 ===');
for (const p of PAGES) {
    try {
        const txt = await (await fetch(`https://tong-xiangjie.github.io/${p}?cb=${Math.random()}`, { cache: 'no-store' })).text();
        const hit = CDN.test(txt);
        if (hit) cdnLeft++;
        console.log(`  ${hit ? '✗' : '✓'} ${p}`);
    } catch (e) { console.log(`  ? ${p}（${e.message}）`); }
}
console.log(cdnLeft === 0 ? '\n  ✓ 线上没有任何 CDN 外链' : `\n  ✗ 还有 ${cdnLeft} 个页面挂着 CDN`);
