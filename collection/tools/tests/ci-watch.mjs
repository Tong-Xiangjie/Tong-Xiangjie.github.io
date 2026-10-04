// 盯住 dd43e250 这次的 CI：跑完就把失败步骤 + 注解打出来，并复查线上文件是否更新。
// 为什么写成脚本：CI 在 GitHub 上、不是本地后台任务，只能用轮询等它；写成后台任务我就不会被"忙等"卡住。
const REPO = 'Tong-Xiangjie/Tong-Xiangjie.github.io';
const SHA = process.argv[2] || '';
const H = { 'User-Agent': 'dsh-check', Accept: 'application/vnd.github+json' };
const api = (p) => fetch(`https://api.github.com/repos/${REPO}${p}`, { headers: H }).then(r => r.json());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const runs = await api(`/actions/runs?per_page=10&branch=main`);
const run = SHA ? runs.workflow_runs.find(r => r.head_sha.startsWith(SHA)) : runs.workflow_runs[0];
if (!run) { console.log('没找到对应的运行'); process.exit(0); }
console.log(`盯住运行 ${run.id}（${run.head_sha.slice(0, 8)}，当前 ${run.status}）`);

for (let i = 0; i < 70; i++) {
    const cur = await api(`/actions/runs/${run.id}`);
    if (cur.status === 'completed') { console.log(`\n运行结束：${cur.conclusion}  用时 ${Math.round((Date.parse(cur.updated_at) - Date.parse(cur.created_at)) / 1000)}s`); break; }
    await sleep(30000);
}

const jobs = await api(`/actions/runs/${run.id}/jobs`);
for (const j of jobs.jobs || []) {
    console.log(`\n作业 ${j.name}：${j.status} / ${j.conclusion}`);
    for (const s of j.steps || []) console.log(`   ${s.conclusion === 'success' ? '✓' : s.conclusion === 'failure' ? '✗' : '·'} ${s.name}`);
}
const cr = await api(`/commits/${run.head_sha}/check-runs`);
for (const c of cr.check_runs || []) {
    const an = await api(`/check-runs/${c.id}/annotations`);
    if (an.length) {
        console.log(`\n注解（${c.name}）：`);
        for (const a of an) console.log(`   [${a.annotation_level}] ${a.title} :: ${a.message}`);
    }
}

console.log('\n=== 线上文件复查（缓存绕过）===');
for (const [label, url, tests] of [
    ['layout.css', `https://tong-xiangjie.github.io/collection/layout.css?cb=${Math.random()}`, [
        ['色块缩放', /tl-heatmap-cell:hover > \.tl-hm-fill\s*\{\s*transform: scale\(1\.04\)/],
        ['年份侧边泡', /translateY\(-50%\) translateX\(-3px\)/],
        ['表头上叠 2px', /top: calc\(100% - 2px\)/]
    ]],
    ['special.js', `https://tong-xiangjie.github.io/collection/special.js?cb=${Math.random()}`, [
        ['连续深浅', /--hm-o/],
        ['按屏幕取左右边界', /getRenderContainer/],
        ['文案格式', /共购入\$\{n\}件，合计/]
    ]]
]) {
    try {
        const txt = await (await fetch(url)).text();
        console.log(`  ${label}：长度 ${txt.length}`);
        for (const [name, re] of tests) console.log(`     ${re.test(txt) ? '✓' : '✗'} ${name}`);
    } catch (e) { console.log(`  ${label}：取不到（${e.message}）`); }
}
