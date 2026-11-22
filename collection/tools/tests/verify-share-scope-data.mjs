// 分享链接的数据范围裁剪不能"裁掉该有的数据"：collection/tools/tests/verify-share-scope-data.mjs
// 用户报告（原话）："分享的链接，有时会触发显示『啥都木有』？例如
//   …?share=eyJwIjoibm90ZXMvcmVwdWJsaWMi…  #notes/republic；但是同样是分享一个板块的
//   …?share=eyJwIjoibm90ZXMvcm1iIi…        #notes/rmb 就没有问题。"
//   并补了决定性的一条："二者加载的 data 数量不一样，前者是 5 个，后者是全部的 75。"
//
// 于是问题被钉在 data-loader.js 的分享裁剪上（shareScopeKeepSet）：范围落到具体分类时只下
// 配置树里"那个分类 + 后代"的 dataFile。而 walk() 的实现只把**命中节点自己**的 dataFile 收进白名单
// （子节点递归进来时 hit 按"id 是否等于目标"重算 ⇒ false），后代文件全被裁掉 ⇒ 该分类的数据没到
// ⇒ 页面停在「啥都木有」。rmb 之所以看起来正常，是因为裁剪那次没生效（配置树还没就绪就退化成
// "不裁"），于是 75 个全下 —— 这正好解释了用户说的"有时会触发"（时序不同，行为不同）。
//
// 本用例的预言机是**站点自己的配置树**（categoryTree / coinCategoryTree）：范围节点 + 全部后代
// 声明的 dataFile / dataKey，一个都不许缺、且对应的数据全局必须真的存在。
// ★ 服务器绑 127.0.0.2：gate.js 对 127.0.0.1/localhost 内置放行，测不到分享门禁；
//   根目录必须是仓库根（config.js 里是 '../notecollection/...' 这种跨目录路径）。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = join(ROOT, p);
  if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
  const b = readFileSync(full);
  res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
});
await new Promise(r => server.listen(0, '127.0.0.2', r));
const BASE = `http://127.0.0.2:${server.address().port}/collection/index.html`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpShareScope-'));
const DP = 17600;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pend = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('no cdp'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const J = async e => JSON.parse(await ev(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');

const LINKS = [
  { label: 'republic', token: 'eyJwIjoibm90ZXMvcmVwdWJsaWMiLCJlIjoxNzk1NDMxOTM4OTYyLCJzIjoxNzk1MzQ1NTM4OTYyLCJpIjoiZTVlOWU5MTQifQ', hash: '#notes/republic' },
  { label: 'rmb', token: 'eyJwIjoibm90ZXMvcm1iIiwiZSI6MTc5NTQzMjE2MjY2NiwicyI6MTc5NTM0NTc2MjY2NiwiaSI6ImQxZWJjMTA2In0', hash: '#notes/rmb' },
];

// 预言机：在页面里按配置树算出"这个分类自己 + 全部后代"该有的 dataFile / dataKey
const ORACLE = `
window.__expect = function (catId) {
  var trees = [];
  try { if (typeof categoryTree !== 'undefined' && categoryTree) trees.push(categoryTree); } catch (e) { }
  try { if (typeof coinCategoryTree !== 'undefined' && coinCategoryTree) trees.push(coinCategoryTree); } catch (e) { }
  var out = [];
  var walk = function (node, inScope) {
    if (!node) return false;
    var hit = inScope || String(node.id || '').toLowerCase() === catId;
    if (hit) out.push({ file: String(node.dataFile || '').split('/').pop().toLowerCase(), key: node.dataKey || null });
    if (node.children) { for (var i = 0; i < node.children.length; i++) { if (walk(node.children[i], hit)) hit = true; } }
    return hit;
  };
  for (var t = 0; t < trees.length; t++) for (var n = 0; n < trees[t].length; n++) walk(trees[t][n], false);
  return out.filter(function (x) { return x.file; });
};
window.__loaded = function () {
  return performance.getEntriesByType('resource').map(function (e) { return e.name; })
    .filter(function (u) { return u.indexOf('/data/') >= 0 && /\\.js(\\?|$)/.test(u); })
    .map(function (u) { return u.split('/').pop().split('?')[0].toLowerCase(); });
};
window.__has = function (keys) {
  var miss = [];
  for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (!k) continue; try { if (typeof window[k] === 'undefined') miss.push(k); } catch (e) { miss.push(k); } }
  return miss;
};
`;

for (const L of LINKS) {
  console.log(`\n══════ 分享 ${L.label}：${L.hash} ══════\n`);
  await send('Page.navigate', { url: `${BASE}?share=${L.token}${L.hash}` });
  for (let i = 0; i < 140; i++) { if (await ev(`document.readyState==='complete' && typeof shareDataKeep==='function'`).catch(() => false)) break; await sleep(120); }
  await sleep(9000);
  await ev(ORACLE);
  const catId = L.hash.split('/')[1];
  const r = await J(`
    var exp = window.__expect('${catId}');
    var loaded = window.__loaded();
    var files = exp.map(function (x) { return x.file; });
    var keys = exp.map(function (x) { return x.key; }).filter(Boolean);
    var missingFiles = files.filter(function (f) { return loaded.indexOf(f) < 0; });
    var missingKeys = window.__has(keys);
    return { expectCount: files.length, loadedCount: loaded.length,
      missingFiles: missingFiles, missingKeys: missingKeys,
      emptyText: (document.querySelector('.empty-state') || {}).textContent || null,
      seriesBody: document.querySelectorAll('.series-body').length,
      kept: (typeof shareScopeKeepSet === 'function' && shareScopeKeepSet()) ? shareScopeKeepSet().size : null };`);
  console.log(`  · 配置树要求 ${r.expectCount} 个数据文件；实际加载 ${r.loadedCount} 个 /data/*.js` +
    `；裁剪白名单 ${r.kept === null ? '未生效（不裁）' : r.kept + ' 个'}`);
  console.log(`  · 缺文件：${r.missingFiles.length ? r.missingFiles.join(',') : '无'}`);
  console.log(`  · 缺数据全局：${r.missingKeys.length ? r.missingKeys.join(',') : '无'}`);
  ok(r.expectCount >= 2, `${L.label} 前提：配置树里这个分类 + 后代共声明 ${r.expectCount} 个数据文件`);
  ok(r.missingFiles.length === 0,
    `${L.label} 该有的数据文件一个都不许缺（缺 ${r.missingFiles.length} 个${r.missingFiles.length ? '：' + r.missingFiles.slice(0, 6).join(',') : ''}）`);
  // ★ 不拿配置树的 dataKey 去 window 上找数据：那个映射对子类并不成立（rmb1..rmb5 全下了，
  //   但 window.rmb1Data 本来就不是它们的暴露方式）—— 第一版这么断言是错的预言机，会永远判红。
  //   收件人是否"看到了数据"改用页面事实判定：不许出现空态「啥都木有」。
  ok(!/啥都木有/.test(r.emptyText || ''),
    `${L.label} 收件人不应看到空态「啥都木有」（实得 ${JSON.stringify(r.emptyText)}，.series-body ${r.seriesBody} 个）`);
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
