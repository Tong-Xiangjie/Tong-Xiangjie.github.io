// 验收：文章深链不再因为"增删文章"错位。
//
// 背景（用户报的问题，原话）：
//   「现在文章的深链是序号，假如到时分享了某个链接，但是在分享的文章前增加/删除了
//     文章，就会导致错位，有没有解决方法？」
// 原因：深链里的序号是 collectedArticles 的**全局下标**，而这个数组是按
//   allDataKeys → series[] → varieties[] → readme 的顺序拼出来的 ——
//   任何位置（哪怕别的分类、别的数据文件）增删一篇，后面所有文章的下标全部后移，
//   已经分享出去的 #articles/12 就会打开**别的**文章。
// 修法：URL 里写"稳定键"（a-<slug>，slug 由每篇文章本来就有的 contentPath 派生，
//   见 article.js 顶部 articleSlugOf 的说明），下标只在内存里用。
//
// 判据（确定，能红能绿）：
//   ★ ① 只证明"换成 slug 了"不够 —— 那可能是把序号解析整个删掉换来的。
//     所以还要证：**插一篇之后，同一条链接仍然打开同一篇**（用户诉求本身），
//     而且**同一时刻老写法（序号）确实已经指到别的篇**（证明这个场景真的会错位，
//     不是一条恒真断言）。
//   ★ 手改 URL 写序号的老写法仍要认（第 ③ 条），否则等于把老链接变成废纸。
//   ★ 键查不到（文章被删）必须退回列表，不许停在空阅读器上（第 ④ 条）。
//   ★ 分享范围是 hash 的**前缀**：范围里那个篇段必须与地址栏逐字相同，
//     并且仍然只对"这一篇"放行（第 ⑤ 条，含一条"别的篇不放行"的反向断言）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpArtDeep-'));
const DP = 17370;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await (async function(){ ${e} })()); })()`));

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const skip = m => { skipped++; console.log(`  ○ ${m}`); };

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + 'index.html#articles' });
  await sleep(3200);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };`);

  // ─────────── ⓪ 前提自检（防止下面几条在坏代码上假绿） ───────────
  console.log('\n══════ ⓪ 前提自检 ══════\n');
  const pre = await J(`return {
    slugFn: typeof articleSlugOf === 'function',
    buildFn: typeof buildArticleSlugIndex === 'function',
    segFn: typeof articleRouteSegment === 'function',
    idxFn: typeof articleIndexOfSlug === 'function',
    total: (collectedArticles || []).length,
    slugCount: (typeof articleSlugIndex !== 'undefined' && articleSlugIndex) ? Object.keys(articleSlugIndex).length : -1,
    sample: collectedArticles[3] ? { slug: collectedArticles[3].slug, path: collectedArticles[3].contentPath } : null
  };`);
  ok(pre.slugFn && pre.buildFn && pre.segFn && pre.idxFn,
    `稳定键那套函数都在（slugOf=${pre.slugFn} buildIndex=${pre.buildFn} segment=${pre.segFn} indexOfSlug=${pre.idxFn}）`);
  ok(pre.total > 5 && pre.slugCount > 5,
    `文章已收集、稳定键表也建好了（${pre.total} 篇 / ${pre.slugCount} 个键）—— 少了它下面几条会假绿`);
  if (pre.sample) console.log(`      样例：[3] slug=${pre.sample.slug}  ← ${pre.sample.path}`);
  // ★ 这里**不中断**用例：就算稳定键那套函数全没了，下面每条也各自会红，
  //   而且失败原因看得更清楚（"换成 slug 了没"和"抗不抗增删"是两件事）。
  if (!(pre.total > 5 && pre.slugCount > 5)) {
    console.log('      （前提没满足：后面的断言会各自红，不再逐条提示这一条）');
  }

  // ─────────── ① 正常点开一篇：地址栏里是稳定键 ───────────
  console.log('\n══════ ① 点开一篇，地址栏写的是稳定键 ══════\n');
  const a = await J(`openArticleReader(3); await __sleep(300);
    return { hash: location.hash, idx: currentArticleIndex,
             seg: (typeof articleRouteSegment === 'function') ? articleRouteSegment(currentArticleIndex) : null,
             title: (collectedArticles[currentArticleIndex] || {}).title,
             path: (collectedArticles[currentArticleIndex] || {}).contentPath };`);
  ok(/^#articles\/a-/.test(a.hash),
    `打开第 3 篇后地址栏是 #articles/a-… （实测 ${a.hash}）—— 不再是裸序号`);
  ok(a.hash === '#articles/' + a.seg,
    `地址栏与 articleRouteSegment() 逐字一致（${a.hash} == #articles/${a.seg}）—— 生成端只有一处实现`);
  ok(!!a.path, `拿得到这一篇的稳定身份（《${a.title}》← ${a.path}）`);

  // ─────────── ② 老写法（手改 URL 写序号）仍然认 ───────────
  console.log('\n══════ ② 手写序号的老链接仍然能用 ══════\n');
  const legacy = await J(`await applyRoute('#articles/2').catch(function(){});
    await __sleep(700);
    return { idx: currentArticleIndex, view: currentArticleView, title: (collectedArticles[currentArticleIndex] || {}).title };`);
  ok(legacy.idx === 2 && legacy.view === 'reader',
    `#articles/2 仍然解析成下标 2 并进阅读器（实测 idx=${legacy.idx} view=${legacy.view}《${legacy.title}》）`);

  // ─────────── ③ 用户诉求：在它前面插一篇，同一条链接不许错位 ───────────
  console.log('\n══════ ③ 在共享出去的那篇前面插一篇，链接仍指向同一篇 ══════\n');
  const ins = await J(`
    openArticleReader(3); await __sleep(300);
    var link = location.hash;
    var wantPath = (collectedArticles[currentArticleIndex] || {}).contentPath;
    var wantTitle = (collectedArticles[currentArticleIndex] || {}).title;
    var oldIndex = currentArticleIndex;
    // 模拟"在共享出去的那篇前面新增一篇"：数组整体后移
    collectedArticles.unshift({ title: '（用例插入的新文章）', contentPath: 'file:readmes/zzz_verify_insert.html',
                                dataKey: 'zzz', sourceType: 'notes', category: 'all', parentCategory: null });
    if (typeof buildArticleSlugIndex === 'function') buildArticleSlugIndex();
    // 老写法此刻指的是谁 —— 用来证明"序号确实会错位"，不是一条恒真断言
    var numericNowPath = (collectedArticles[oldIndex] || {}).contentPath;
    await applyRoute(link).catch(function(){});
    await __sleep(800);
    return { link: link, wantPath: wantPath, wantTitle: wantTitle, oldIndex: oldIndex, numericNowPath: numericNowPath,
             gotPath: (collectedArticles[currentArticleIndex] || {}).contentPath,
             gotTitle: (collectedArticles[currentArticleIndex] || {}).title,
             gotIdx: currentArticleIndex };
  `);
  ok(/^#articles\/a-/.test(ins.link), `本次测的链接是稳定键形式（${ins.link}）`);
  ok(ins.gotPath === ins.wantPath,
    `插一篇后，同一条链接还是同一篇（《${ins.gotTitle}》← ${ins.gotPath}）`);
  ok(ins.gotIdx !== ins.oldIndex,
    `它在下标上确实被挤走了（${ins.oldIndex} → ${ins.gotIdx}）—— 所以"还指向同一篇"不是因为它没动`);
  ok(ins.numericNowPath !== ins.wantPath,
    `同一时刻的老写法 #articles/${ins.oldIndex} 已经指到别的篇（${ins.numericNowPath}）—— 这正是用户报的错位`);

  // ─────────── ④ 键查不到 ⇒ 退回列表 ───────────
  console.log('\n══════ ④ 键查不到（文章被删/链接抄错）⇒ 退回列表 ══════\n');
  const dead = await J(`await applyRoute('#articles/a-zzz_verify_meiyou_zhe_pian').catch(function(){});
    await __sleep(800);
    return { view: currentArticleView, idx: currentArticleIndex,
             hasList: !!document.querySelector('[onclick^="openArticleReader("]') };`);
  ok(dead.view === 'list' && dead.idx < 0,
    `查不到的键退回列表（view=${dead.view} idx=${dead.idx}）—— 不停在空阅读器上`);
  ok(dead.hasList, `而且列表确实渲染出来了（页面上有可点的文章项）`);

  // ─────────── ⑤ 分享范围：与地址栏逐字同形，且仍然精确到"这一篇" ───────────
  console.log('\n══════ ⑤ 分享范围与地址栏同形、且只放行这一篇 ══════\n');
  const sc = await J(`
    openArticleReader(5); await __sleep(300);
    var h = location.hash, hs = h.replace(/^#/, '');
    var p = shareScopeOf(parseRoute(h));
    var other = '#articles/' + ((typeof articleRouteSegment === 'function') ? articleRouteSegment(6) : '6');
    return { hash: h, scope: p,
             isPrefix: (hs === p) || (hs.indexOf(p + '/') === 0),
             allowsSelf: shareScopeMatch(p, h, ''),
             otherHash: other,
             allowsOther: shareScopeMatch(p, other, '') };
  `);
  console.log(`      地址栏 ${sc.hash}   范围 ${sc.scope}`);
  ok(sc.isPrefix, `范围就是地址栏的前缀（前缀匹配的前提）`);
  ok(sc.allowsSelf === true, `范围放行它自己（shareScopeMatch 为 ${sc.allowsSelf}）`);
  ok(sc.allowsOther === false,
    `范围**不**放行别的篇（${sc.otherHash} ⇒ ${sc.allowsOther}）—— 没有因为换 slug 而松开成"整块放行"`);
  const legacyScope = await J(`var r = parseRoute('#articles/12');
    return { seg: r.articleSegment, idx: r.articleIndex, scope: shareScopeOf(r) };`);
  ok(legacyScope.idx === 12 && legacyScope.scope === 'articles/12',
    `老序号链接的范围照旧是 articles/12（实测 ${legacyScope.scope}）—— 自己的范围与地址栏也同形`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 文章深链稳定键检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 文章深链稳定键检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
