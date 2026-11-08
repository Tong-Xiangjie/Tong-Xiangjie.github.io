// 文章目录（TOC）验证：collection/tools/tests/verify-article-toc.mjs
// 用户要求（原话）：
//   · "文章板块有一些长文章…能不能做一个目录点击跳转（同时目前滚动到哪里就哪里高亮）"；
//   · "这就需要文章板块的 html 代码里有类似于 <h1><h2><h3><h4> 这样的标签，其他的标签不视为标题"；
//   · "目录按照标题的层级缩进，例如一篇文章同时含有 <h1><h2><h4> 那就是 <h1> 为不缩进，
//      <h2> 缩进一下，<h4> 缩进两下（注意不是四下）"；
//   · "其中文章标题"中国代印之阿尔巴尼亚列克"无条件识别为 <h1> 类型（即便没有用这样的标签）"；
//   · "注意点击跳转的时候不要突变，应该滚动到目标位置"；"标题较长请使用省略号"。
//
// ★ 判据尽量用**行为**（滚动位置逐帧采样、目录条目的实际缩进、计算样式），
//   不写"CSS 里有没有这条规则"——那种断言骗过人（见 verify-map-dark 的教训）。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const skip = m => { skipped++; console.log(`  ○ 跳过 ${m}`); };

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
    const buf = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpToc-'));
const DP = 17520;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1920,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');

await send('Page.navigate', { url: `${BASE}?t=${Date.now()}` });
for (let i = 0; i < 140; i++) {
  const r = await evaluate(`(()=>typeof renderArticleReader==='function' && typeof getRenderContainer==='function' && document.readyState==='complete')()`).catch(() => false);
  if (r) break; await sleep(120);
}
await sleep(800);

// 打开一篇文章：直接用应用自己的渲染入口（列表→阅读器那条路最后也走它），内容从磁盘读真文件
async function openArticle(title, bodyHtml, fileRel) {
  const content = fileRel ? await evaluate(`fetch(${JSON.stringify('/' + fileRel)}).then(r=>r.text())`) : bodyHtml;
  await evaluate(`renderArticleReader(${JSON.stringify({ title, sourceType: 'notes', contentPath: fileRel || 'inline' })}, ${JSON.stringify(content)})`);
  await sleep(500);
  return content;
}

// ─────────── ① 用户点名的试水样本：《中国代印之阿尔巴尼亚列克》 ───────────
console.log('══════ ① 《中国代印之阿尔巴尼亚列克》（用户点名的试水样本）══════\n');
// ★ "文章本体不用移动位置"（用户明确要求）拿什么比：先开一篇**没有原生标题**的文章
//   —— 那时不会挂目录，正文位置就是"改动前的原样" —— 记下它的位置当基线。
await openArticle('无标题基线', '<p>只有正文，没有任何标题标签</p><p>第二段</p>', null);
const baseRect = await J(`var r = document.querySelector('.article-reader').getBoundingClientRect();
  return { l: Math.round(r.left), w: Math.round(r.width) };`);
const FILE = 'notecollection/readmes/albania_zhihu_Haneda_Leonn.html';
const TITLE = '中国代印之阿尔巴尼亚列克';
const raw = await openArticle(TITLE, null, FILE);
const hTagCount = (raw.match(/<h[1-6][\s>]/gi) || []).length;
console.log(`  正文里的原生标题标签：${hTagCount} 个（${(raw.match(/<h[1-6][\s>]/gi) || []).join(' ')}）`);

const toc = await J(`return {
  exists: !!document.querySelector('.article-toc'),
  hidden: (function(){ var n=document.querySelector('.article-toc'); return !n || getComputedStyle(n).display==='none'; })(),
  labels: [].map.call(document.querySelectorAll('.article-toc-item'), b=>b.textContent),
  ranks: [].map.call(document.querySelectorAll('.article-toc-item'), b=>Number(b.getAttribute('data-rank'))),
  indents: [].map.call(document.querySelectorAll('.article-toc-item'), b=>getComputedStyle(b).getPropertyValue('--toc-indent').trim()),
  pads: [].map.call(document.querySelectorAll('.article-toc-item'), b=>getComputedStyle(b).paddingLeft),
  activeCount: document.querySelectorAll('.article-toc-item.active').length,
  activeIdx: [].findIndex.call(document.querySelectorAll('.article-toc-item'), b=>b.classList.contains('active')),
  idsOnHeads: [].map.call(document.querySelectorAll('.article-reader h1,.article-reader h2,.article-reader h3,.article-reader h4,.article-reader h5,.article-reader h6'), h=>h.id),
  layoutDisplay: getComputedStyle(document.querySelector('.article-layout')).display,
  tocRect: (function(){ var n=document.querySelector('.article-toc'); if(!n) return null; var r=n.getBoundingClientRect(); return {l:Math.round(r.left),w:Math.round(r.width),t:Math.round(r.top)}; })(),
  btns: (function(){ var b=document.querySelectorAll('.article-side .back-btn'); if(!b.length) return null;
    var a=b[0].getBoundingClientRect(), z=b[b.length-1].getBoundingClientRect();
    return { left: Math.round(a.left), right: Math.round(z.right), rowW: Math.round(z.right-a.left), bottom: Math.round(z.bottom), n: b.length }; })(),
  readerRect: (function(){ var r=document.querySelector('.article-reader').getBoundingClientRect(); return {l:Math.round(r.left),w:Math.round(r.width)}; })()
};`);
ok(toc.exists, '① 目录出来了（.article-toc 存在）');
ok(!toc.hidden, '① 宽屏(1400px)下目录是显示着的（两侧有空白就该用它）');
// 期望值**从正文里推**（不写死）：出现过的级别排序后的名次 + 文章标题（无条件一级、名次 0）
const lvSeq = (raw.match(/<h([1-6])[\s>]/gi) || []).map(t => Number(t.replace(/[^\d]/g, '')));
const present = [...new Set([0, ...lvSeq.map(n => n - 1)])].sort((a, b) => a - b);
const expRanks = [0, ...lvSeq.map(n => present.indexOf(n - 1))];
ok(toc.labels.length === expRanks.length, `① 条目数 = 文章标题 1 条 + 正文原生标题 ${lvSeq.length} 条 = ${toc.labels.length}`);
ok(toc.labels[0] === TITLE, `① 第一条是文章标题「${TITLE}」——它没有 <h1> 标签，但无条件算一级（用户点名要求）`);
ok(toc.ranks[0] === 0, '① 文章标题不缩进（名次 0）');
// 这篇正文里同时有 <h3> 和 <h4>（用户自己写的标签）⇒ 出现过的级别是 {h1(标题), h3, h4}
//   ⇒ 按"名次"口径 h3→1、h4→2（不是按级别 2/3）
console.log(`  正文级别序列：${JSON.stringify([...new Set(lvSeq)])} ⇒ 名次映射：${JSON.stringify(present.map(l => 'h' + (l + 1) + '→' + present.indexOf(l)))}`);
ok(JSON.stringify(toc.ranks) === JSON.stringify(expRanks),
  `① 每条的名次都和"从正文推出来的"一致（实测 ${JSON.stringify(toc.ranks)}）`);
ok(toc.ranks.every((r, i) => toc.indents[i] === String(r)), `① 缩进变量与名次一一对应（${toc.indents.join(',')}）`);
const byRank = {};
toc.ranks.forEach((r, i) => { if (byRank[r] === undefined) byRank[r] = parseFloat(toc.pads[i]); });
const step = byRank[1] - byRank[0];
ok(step > 0, `① 名次 1 的条目真的往右缩了（名次 0 = ${byRank[0]}px，名次 1 = ${byRank[1]}px）`);
ok(toc.activeCount === 1, `① 恰好一条高亮（滚动到哪里就哪里高亮）`);
ok(toc.idsOnHeads.every(id => !!id), '① 正文里的原生标题都被补上了 id（跳转要用）');
ok(!!toc.tocRect && toc.tocRect.l < toc.readerRect.l, `① 目录确实在正文左侧的空白里（目录 x=${toc.tocRect && toc.tocRect.l} < 正文 x=${toc.readerRect.l}）`);
ok(toc.readerRect.l === baseRect.l && toc.readerRect.w === baseRect.w,
  `① ★ 正文位置一点没动（无标题基线 x=${baseRect.l}/${baseRect.w}px，挂了目录后 x=${toc.readerRect.l}/${toc.readerRect.w}px）`);
// 用户："应该是 ← 返回文章列表 / ⟳ 重新加载 这两个按钮的宽度的 1.5 倍"、"就放在它们下面"
ok(toc.btns && toc.btns.n === 2, `① 返回/重新加载两个按钮和目录在同一列里（${toc.btns && toc.btns.n} 个按钮）`);
ok(!!toc.btns && Math.abs(toc.tocRect.w - Math.round(toc.btns.rowW * 1.5)) <= 2,
  `① 目录栏宽度 = 按钮行宽度的 1.5 倍（目录 ${toc.tocRect.w}px，按钮行 ${toc.btns && toc.btns.rowW}px × 1.5 = ${toc.btns && Math.round(toc.btns.rowW * 1.5)}px）`);
ok(!!toc.btns && Math.abs(toc.tocRect.l - toc.btns.left) <= 1,
  `① 目录左边缘和按钮左边缘对齐（目录 ${toc.tocRect.l}px，按钮 ${toc.btns && toc.btns.left}px）`);
ok(!!toc.btns && toc.tocRect.t >= toc.btns.bottom - 1,
  `① 目录在按钮**下面**（按钮底 ${toc.btns && toc.btns.bottom}px ≤ 目录顶 ${toc.tocRect.t}px）`);
// 用户的两次微调："那个分割的竖线可以去掉"、"现在太靠近那两个按钮了"、"目录两个字可以大一点"
const tweak = await J(`var n=document.querySelector('.article-toc'), t=document.querySelector('.article-toc-title');
  var cs=getComputedStyle(n), ts=getComputedStyle(t);
  return { borderRight: cs.borderRightWidth + ' ' + cs.borderRightStyle, titleSize: parseFloat(ts.fontSize),
    titleSticky: ts.position, gap: Math.round(n.getBoundingClientRect().top
      - document.querySelector('.article-side .back-bar').getBoundingClientRect().bottom) };`);
ok(parseFloat(tweak.borderRight) === 0, `① 目录栏那根分割竖线没了（border-right: ${tweak.borderRight}）`);
ok(tweak.gap >= 10, `① 目录顶边在按钮底边**下面**留出了缝（实测间距 ${tweak.gap}px）`);
ok(tweak.titleSize >= 0.9 * 16, `① "目录"二字比原来大（0.78rem=12.5px → 现在 ${tweak.titleSize}px）`);
ok(tweak.titleSticky === 'sticky', `① "目录"钉在目录栏顶部（position: ${tweak.titleSticky}）——列表在它下面滚，最上面那条始终和它一样高`);

// 窄窗口的护栏：1.5 倍可能超出左侧空白，那时按空白封顶，绝不许压到正文上
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const narrow = await J(`var n=document.querySelector('.article-toc'), rd=document.querySelector('.article-reader');
  var a=n.getBoundingClientRect(), b=rd.getBoundingClientRect();
  return { tocRight: Math.round(a.right), readerLeft: Math.round(b.left), visible: getComputedStyle(n).display!=='none' };`);
ok(!narrow.visible || narrow.tocRight <= narrow.readerLeft + 1,
  `① 窄窗口(1280px)下目录也不压正文（目录右缘 ${narrow.tocRight}px ≤ 正文左缘 ${narrow.readerLeft}px${narrow.visible ? '' : '；此宽度下目录是收起的'}）`);
await send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

// 省略号：造一条超长标题，实测真的被截断（不是只写了 CSS）
console.log('\n  ── 长标题省略号（用户要求"标题较长请使用省略号"）──');
await openArticle(TITLE, `<h2>${'很长的标题'.repeat(20)}</h2><p>正文</p>`, null);
const ell = await J(`var b=document.querySelectorAll('.article-toc-item')[1];
  return { textOverflow: getComputedStyle(b).textOverflow, whiteSpace: getComputedStyle(b).whiteSpace,
    overflow: getComputedStyle(b).overflow, scrollW: b.scrollWidth, clientW: b.clientWidth,
    title: b.getAttribute('title'), label: b.textContent };`);
ok(ell.textOverflow === 'ellipsis' && ell.whiteSpace === 'nowrap', `① 长条目的计算样式是省略号（text-overflow=${ell.textOverflow}, white-space=${ell.whiteSpace}）`);
ok(ell.scrollW > ell.clientW, `① 长标题真的被截断了（内容宽 ${ell.scrollW}px > 可见宽 ${ell.clientW}px）`);
ok(ell.title === ell.label, '① 截断的同时 title 属性留着全文（悬浮能看全）');

// ─────────── ② 用户举的例子：h1/h2/h4 → 0/1/2（不是 0/1/4）───────────
console.log('\n══════ ② 层级名次：h1/h2/h4 → 0/1/2（用户强调"不是四下"）══════\n');
await openArticle('示例文章', '<h1>一级</h1><p>x</p><h2>二级</h2><p>y</p><h4>四级</h4><p>z</p>', null);
const ex = await J(`return { labels:[].map.call(document.querySelectorAll('.article-toc-item'), b=>b.textContent),
  ranks:[].map.call(document.querySelectorAll('.article-toc-item'), b=>Number(b.getAttribute('data-rank'))),
  pads:[].map.call(document.querySelectorAll('.article-toc-item'), b=>parseFloat(getComputedStyle(b).paddingLeft)) };`);
const exByRank = {};
ex.ranks.forEach((r, i) => { if (exByRank[r] === undefined) exByRank[r] = ex.pads[i]; });
const exStep = exByRank[1] - exByRank[0];
console.log(`  条目：${JSON.stringify(ex.labels)} → 名次 ${JSON.stringify(ex.ranks)}（每级 ${exStep}px）`);
// 用户原话："一篇文章同时含有 <h1><h2><h4> 那就是 <h1> 为不缩进，<h2> 缩进一下，<h4> 缩进两下（注意不是四下）"
ok(ex.ranks.join(',') === '0,0,1,2',
  `② 名次 = 标题0 / h1 0（不缩进）/ h2 1（缩进一下）/ h4 2（缩进两下，不是四下）——实测 ${ex.ranks.join(',')}`);
ok(ex.pads.every((p, i) => Math.abs(p - (exByRank[0] + ex.ranks[i] * exStep)) < 0.5),
  `② 每条的实际 padding-left 都等于"名次 × 每级步长"（${JSON.stringify(ex.pads)}）`);

// ─────────── ③ 其他标签不算标题；没有原生标题就不出目录 ───────────
console.log('\n══════ ③ 只有原生 h1~h6 才算标题 ══════\n');
await openArticle('假标题', '<p><b style="font-size:1.6em">这是加粗的假标题</b></p><p><span style="font-size:1.3em">另一个样式假标题</span></p><div class="overview-header">样式上的大标题</div><p>正文</p>', null);
const fake = await J(`return { n: document.querySelectorAll('.article-toc-item').length, exists: !!document.querySelector('.article-toc') };`);
ok(!fake.exists, `③ 只有"加粗/放大字号/样式大标题"这类假标题时，一个条目都不出（用户："其他的标签不视为标题"）`);
await openArticle('真的标题', '<p>引言</p><h2>这是真标题</h2><p>正文</p>', null);
const realOne = await J(`return { n: document.querySelectorAll('.article-toc-item').length, labels: [].map.call(document.querySelectorAll('.article-toc-item'), b=>b.textContent) };`);
ok(realOne.n === 2 && realOne.labels[1] === '这是真标题', `③ 有真 <h2> 时才出条目（${JSON.stringify(realOne.labels)}）`);
await openArticle('完全没有标题', '<p>只有正文，一个标题标签都没有</p><p>第二段</p>', null);
const none = await J(`return { exists: !!document.querySelector('.article-toc') };`);
ok(!none.exists, '③ 一个原生标题都没有时不摆目录（只剩"文章标题"一条没有意义）');

// ─────────── ④ 点击跳转：平滑滚动（不突变）+ 落点准确 ───────────
console.log('\n══════ ④ 点击跳转：不要突变 ══════\n');
await openArticle(TITLE, null, FILE);
const jump = await J(`var sc = getRenderContainer();
  var items = document.querySelectorAll('.article-toc-item');
  var heads = document.querySelectorAll('.article-reader h1,.article-reader h2,.article-reader h3,.article-reader h4,.article-reader h5,.article-reader h6');
  var target = items[items.length-1];                      // 跳最后一条（最远，最能看出是跳还是滚）
  var head = heads[heads.length-1];                        // 目录与标题同序，最后一条对应的就是最后一个标题
  var want = head.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  var samples = []; var last = -1, still = 0; var t0 = performance.now();
  target.click();
  // ★ 平滑滚动是浏览器自己跑的动画，跨度上万像素要好几秒 —— 必须等它**停下来**再断言落点，
  //   否则量到的是"还在路上"的中间位置（第一版用例就是这么误判成差的）。
  await new Promise(function(done){ (function step(){
      samples.push(Math.round(sc.scrollTop));
      if (sc.scrollTop === last) still++; else { still = 0; last = sc.scrollTop; }
      if (still >= 10 || performance.now() - t0 > 8000) done(); else requestAnimationFrame(step);
    })(); });
  return { samples: samples, want: Math.round(want), got: Math.round(sc.scrollTop),
    maxScroll: Math.round(sc.scrollHeight - sc.clientHeight),
    headTop: Math.round(head.getBoundingClientRect().top), headBottom: Math.round(head.getBoundingClientRect().bottom),
    boxTop: Math.round(sc.getBoundingClientRect().top), boxBottom: Math.round(sc.getBoundingClientRect().bottom),
    distinct: [...new Set(samples)].length, frames: samples.length,
    activeIdx: [].findIndex.call(items, b=>b.classList.contains('active')), lastIdx: items.length-1 };`);
const land = Math.min(jump.want, jump.maxScroll);
const headVisible = jump.headTop >= jump.boxTop - 2 && jump.headBottom <= jump.boxBottom + 2;
console.log(`  滚动位置采样 ${jump.frames} 帧 → ${jump.distinct} 种取值；目标 ${jump.want}px、容器最大 ${jump.maxScroll}px，最终 ${jump.got}px`);
ok(jump.distinct >= 3, `④ 点击后是逐帧滚过去的（${jump.distinct} 种位置），不是一帧突变`);
ok(jump.distinct > 10, `④ 跨度上万像素也是真滚动而不是"瞬移+回弹"（${jump.distinct} 帧不同的位置）`);
// ★ 落点 = min(目标, 容器能滚的最大值)：最后一条标题离文末很近，滚到底也贴不到顶 ——
//   那是浏览器的正常行为，不是 bug，所以按 min 断言，不放松精度。
ok(Math.abs(jump.got - land) <= 12, `④ 最终停在目标位置（期望 ${land}px，实测 ${jump.got}px，差 ${Math.abs(jump.got - land)}px）`);
ok(headVisible, `④ 目标标题确实进了视野（标题 y=${jump.headTop}~${jump.headBottom}，容器 y=${jump.boxTop}~${jump.boxBottom}）`);
ok(jump.activeIdx === jump.lastIdx, `④ 跳完高亮跟着走到最后一条（第 ${jump.activeIdx} 条）`);

// 高亮跟滚动走：滚到中间某个标题处，应当亮那一条
const spy = await J(`var sc = getRenderContainer();
  var heads = document.querySelectorAll('.article-reader h4');
  var mid = heads[Math.floor(heads.length/2)];
  var want = mid.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  sc.scrollTop = Math.max(0, want - 90);
  await new Promise(r=>setTimeout(r,300));
  var items = document.querySelectorAll('.article-toc-item');
  var idx = [].findIndex.call(items, b=>b.classList.contains('active'));
  var headIdx = [].indexOf.call([].slice.call(document.querySelectorAll('.article-reader h1,.article-reader h2,.article-reader h3,.article-reader h4,.article-reader h5,.article-reader h6')), mid);
  return { idx: idx, expect: headIdx + 1, activeText: (items[idx]||{}).textContent, headText: mid.textContent };`);
ok(spy.idx === spy.expect, `④ 滚到第 ${spy.expect} 条标题处，高亮的正是它（实测第 ${spy.idx} 条：「${String(spy.activeText).slice(0, 18)}…」）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
