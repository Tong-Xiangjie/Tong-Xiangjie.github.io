// 文章模糊搜索（同义扩展）验收：真实浏览器 + 真实语料
// 覆盖：标题口径 / 全文口径 / 模糊关 / 表加载失败静默降级 / 硬币板块不受影响
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpFuzzy-'));
const DP = 10811;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
let msgId = 0; const pending = new Map(); const methodOf = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const consoleMsgs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) {
    consoleMsgs.push(m.params.type + ': ' + (m.params.args || []).map(a => a.value || a.description || '').join(' '));
  }
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error((methodOf.get(m.id) || '?') + ' 失败: ' + JSON.stringify(m.error))) : resolve(m.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; methodOf.set(id, method); pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// 在文章板块里搜一个词，返回按 DOM 顺序解析出的分组与条目
const SEARCH_JS = (q) => `(async()=>{
  const input=document.getElementById('searchInput');
  input.value=${JSON.stringify(q)};
  input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,700));
  const wrapper=document.querySelector('.article-dynamic-wrapper');
  const out=[];
  for(const el of wrapper.children){
    const key=el.dataset.key;
    // ★ 没有 data-key 的节点要跳过：0 结果时列表里会放一个 .empty-state
    //   （"还没有文章哦"），把它当成条目会误判成"命中 1 条"。
    if(!key) continue;
    if(key.startsWith('group|')){
      const h=el.querySelector('.search-group-header span');
      out.push({type:'group',label:h?h.textContent:'',isPartition:key.includes('__partition__')});
    } else {
      const n=el.querySelector('.name');
      const idx=parseInt(key.replace('article|',''),10);
      const a=(typeof collectedArticles!=='undefined'&&collectedArticles[idx])?collectedArticles[idx]:null;
      out.push({type:'item',idx,title:n?n.textContent:'',path:a?a.contentPath:''});
    }
  }
  const empty=!!wrapper.querySelector('.empty-state');
  return {out, empty, meta:(document.getElementById('articleResultMeta')||{}).textContent||''};
})()`;

// 把 DOM 结果整理成：目标文章在哪个分区、第几位
function analyze(res, targets) {
  let partition = '（未分组）', posInPart = 0, global = 0;
  const found = {};
  for (const row of res.out) {
    if (row.type === 'group') {
      if (row.isPartition) { partition = row.label; posInPart = 0; }
      continue;
    }
    global++; posInPart++;
    for (const t of targets) {
      if (!found[t] && row.path.includes(t)) found[t] = { partition, posInPart, global, title: row.title };
    }
  }
  return found;
}

async function enterArticles() {
  await evaluate(`(()=>{ if(typeof onTabClick==='function') onTabClick('articles'); return true; })()`);
  for (let i = 0; i < 60; i++) { const okk = await evaluate(`(()=>typeof collectedArticles!=='undefined'&&collectedArticles.length>0)()`).catch(() => false); if (okk) break; await sleep(300); }
  await sleep(600);
  // 等同义词表加载完
  for (let i = 0; i < 40; i++) { const done = await evaluate(`(()=>typeof articleSynonymPromise!=='undefined'&&articleSynonymPromise!==null)()`).catch(() => false); if (done) break; await sleep(200); }
  await sleep(400);
}

async function setScope(scope) {
  const cur = await evaluate(`articleSearchMode`);
  if (cur !== scope) { await evaluate(`(()=>{ toggleArticleSearchMode(); return true; })()`); }
  if (scope === 'fulltext') {
    // 等正文索引建好
    for (let i = 0; i < 90; i++) {
      const n = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`).catch(() => 0);
      if (n >= (await evaluate(`collectedArticles.length`))) break;
      await sleep(400);
    }
    await sleep(400);
  }
}

const CASES = [
  { q: '奥运', targets: ['macau_aoyun2008', 'macau_dongao'], note: '奥林匹克' },
  { q: '号码', targets: ['gkq_1'], note: '冠号' },
  { q: '生肖钞', targets: ['amsx_2018', 'dragon_release', 'snake_release'], note: '贺岁/生肖' },
  { q: '央行', targets: ['20260718_yanghangdalou'], note: '中国人民银行' },
  { q: '荷花钞', targets: ['macau_boc100years'], note: '莲花/中国银行成立一百周年' },
];

await send('Page.navigate', { url: BASE + '#articles' });
await sleep(3000);
await enterArticles();

console.log('\n══════ ⓪ 搜索栏恢复原样；开关搬进「我的」且默认关、能持久化 ══════');
{
  // 搜索栏里不该再有模糊按钮，提示文字也不该再提模糊
  ok(await evaluate(`(()=>!document.getElementById('fuzzyToggle'))()`), '搜索栏里已无模糊按钮（UI 已还原）');
  const tip0 = await evaluate(`(()=>{const e=document.getElementById('searchTip');return e?e.textContent:''})()`);
  console.log(`  搜索栏提示：${tip0}`);
  ok(!tip0.includes('模糊'), '搜索栏提示文字不再含模糊字样（已还原）');
  ok(await evaluate(`articleFuzzyOn()`) === false, '模糊默认 = 关');

  // 开关应在「我的 → 文章搜索」里，且默认是关
  await evaluate(`(()=>{ if(typeof onTabClick==='function') onTabClick('settings'); return true; })()`);
  await sleep(1500);
  const sw = await evaluate(`(()=>{const e=document.getElementById('articleFuzzySwitch');
    return e?{on:e.classList.contains('on'),aria:e.getAttribute('aria-checked')}:null})()`);
  console.log(`  「我的」里的模糊开关: ${JSON.stringify(sw)}`);
  ok(sw !== null, '「我的」页面里有模糊开关（id=articleFuzzySwitch）');
  ok(sw && sw.on === false && sw.aria === 'false', '「我的」里的模糊开关默认是关的');

  // ★ 「我的」界面的开关一律居右（用户要求）。这是几何要求就用几何验证：
  //   开关到卡片右边缘的距离必须明显小于到左边缘的距离，且标签在开关左边。
  const geoms = JSON.parse(await evaluate(`(()=>{
    const out=[];
    for (const card of document.querySelectorAll('.settings-page .toggle-card')) {
      const s = card.querySelector('.switch'); if (!s) continue;
      const c = card.getBoundingClientRect(), r = s.getBoundingClientRect();
      const lab = card.querySelector('.toggle-label');
      out.push({ label: lab ? lab.textContent.trim() : '',
        gapRight: Math.round(c.right - r.right), gapLeft: Math.round(r.left - c.left),
        labelLeftOfSwitch: lab ? (lab.getBoundingClientRect().left < r.left) : true });
    }
    return JSON.stringify(out);
  })()`));
  console.log(`  各开关位置: ${geoms.map(g => `${g.label}(右${g.gapRight}/左${g.gapLeft})`).join('  ')}`);
  ok(geoms.length >= 3, `「我的」页面里有多个开关（${geoms.length} 个），全部納入检查`);
  ok(geoms.every(g => g.gapRight < g.gapLeft), '所有开关都靠右（到右边缘的距离 < 到左边缘的距离）');
  ok(geoms.every(g => g.labelLeftOfSwitch), '每个开关的标签都在开关左侧');

  // 就当用户在「我的」里点了一下
  await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);
  await sleep(500);
  ok(await evaluate(`articleFuzzyOn()`) === true, '点一下后模糊＝开');
  ok(await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`), '开关外观同步为开');

  // 持久化：整页重载后仍是开
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url: BASE + '#articles' });
  await sleep(3000);
  await enterArticles();
  ok(await evaluate(`articleFuzzyOn()`) === true, '刷新后模糊设置仍保留（已存 localStorage）');
}

console.log('\n══════ ① 标题口径（标题 + 模糊开）══════');
ok(await evaluate(`articleSearchMode`) === 'title', '默认范围 = 标题');
const R = {};
for (const c of CASES) {
  const res = await evaluate(SEARCH_JS(c.q));
  R[c.q] = { title: analyze(res, c.targets), titleMeta: res.meta, titleEmpty: res.empty };
  const f = R[c.q].title;
  console.log(`  「${c.q}」 ${res.meta}  ${c.targets.map(t => f[t] ? `${t}→${f[t].partition}#${f[t].posInPart}` : `${t}→✗`).join('  ')}`);
}

console.log('\n══════ ② 全文口径（全文 + 模糊开）══════');
await setScope('fulltext');
ok(await evaluate(`articleSearchMode`) === 'fulltext', '范围已切到全文');
for (const c of CASES) {
  const res = await evaluate(SEARCH_JS(c.q));
  R[c.q].full = analyze(res, c.targets);
  R[c.q].fullMeta = res.meta;
  const f = R[c.q].full;
  console.log(`  「${c.q}」 ${res.meta}  ${c.targets.map(t => f[t] ? `${t}→${f[t].partition}#${f[t].posInPart}` : `${t}→✗`).join('  ')}`);
}

console.log('\n══════ ②b 五用例判定（目标进 top10）══════');
// ★ 判定口径：目标要在**至少一个口径**的 top10 内。
//   为什么不是"每个口径都要"：「号码」的目标 gkq_1 标题里既无"号码"也无"冠号"，
//   只有正文有 ——标题口径搜不到它是天生的（这正是"全文"这个开关存在的意义），
//   而它在全文口径下是「同义扩展命中」组第 1 名。硬要求标题口径也命中，
//   等于要求标题搜索去读正文，那会把两个开关的语义搞混。
for (const c of CASES) {
  const t = R[c.q].title, f = R[c.q].full;
  const inTitle = c.targets.some(x => t[x] && t[x].posInPart <= 10);
  const inFull = c.targets.some(x => f[x] && f[x].posInPart <= 10);
  const where = [inTitle ? '标题' : null, inFull ? '全文' : null].filter(Boolean).join('+') || '都不在';
  ok(inTitle || inFull, `「${c.q}」目标进 top10（命中口径：${where}）`);
}

console.log('\n══════ ②c 模糊开：单一列表、纯相关性排序（不再分区、不再按分类分组）══════');
// 用户要求：「模糊搜索下，请仅按照相关性排序……也不要求按照默认顺序，只按照相关性。」
// 所以这里核对四件事：
//   ① 列表里**没有任何分组标题** —— 既没有「精确匹配/同义扩展命中」分区，
//      也没有分类标题（分类标题会把相关性顺序打断）；
//   ② DOM 里的条目顺序与 getFilteredArticles() 按 score 排出来的顺序**逐位相同**；
//   ③ 每条都带数值 score，且分数单调不升（真的按相关性）；
//   ④ 模糊关时仍按分类分组（旧行为没被改坏，见下面的单元检查）。
const RANK_CHECK = `(()=>{
  const wrapper=document.querySelector('.article-dynamic-wrapper');
  const dom=[]; const groups=[];
  for(const el of wrapper.children){
    const key=el.dataset.key; if(!key) continue;
    if(key.startsWith('group|')){ groups.push(key); continue; }
    dom.push(parseInt(key.replace('article|',''),10));
  }
  const filtered=getFilteredArticles();
  const want=filtered.map(e=>collectedArticles.indexOf(e.article));
  const scores=filtered.map(e=>e.score);
  let desc=true;
  for(let i=1;i<scores.length;i++) if(scores[i]>scores[i-1]) desc=false;
  return {groups, dom, want, desc, n:scores.length,
    allNumeric: scores.length>0 && scores.every(s=>typeof s==='number'),
    sample: filtered.slice(0,5).map(e=>({t:(e.article.title||'').slice(0,16), s:Math.round(e.score*10)/10}))};
})()`;
for (const q of ['央行', '荷花钞', '生肖钞', '奥运']) {
  await evaluate(`(()=>{const i=document.getElementById('searchInput');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(800);
  const g = await evaluate(RANK_CHECK);
  console.log(`  「${q}」 ${g.n} 条 / 分组 ${g.groups.length} 个 / 降序 ${g.desc}   前 5: ${g.sample.map(x => x.t + '(' + x.s + ')').join('  ')}`);
  ok(g.groups.length === 0, `「${q}」模糊开时是单一列表（无分区、无分类标题）`);
  ok(g.allNumeric, `「${q}」每条都带相关性分数`);
  ok(g.desc, `「${q}」分数单调不升（纯相关性排序）`);
  ok(g.dom.length === g.want.length && g.dom.every((v, i) => v === g.want[i]),
    `「${q}」DOM 顺序与按相关性排序的结果逐位一致`);
}
// 单元：两种模式必须泾渭分明 ——
//   带 score（模糊开）→ 单一列表，一条 group 都不产生；
//   不带 score（模糊关）→ 仍按分类分组。
{
  const r = await evaluate(`(()=>{
    const a=collectedArticles[0], b=collectedArticles[1], c=collectedArticles[2];
    const ranked=buildArticleFlatList([
      {article:a,matchType:'literal',matchedTerms:[],matchedField:'title',score:5},
      {article:b,matchType:'expanded',matchedTerms:['y'],matchedField:'title',score:9},
      {article:c,matchType:'literal',matchedTerms:[],matchedField:'title',score:1}
    ],'x');
    const plain=buildArticleFlatList([
      {article:a,matchType:'literal',matchedTerms:[],matchedField:'title'},
      {article:b,matchType:'literal',matchedTerms:[],matchedField:'title'}
    ],'x');
    return {
      rankedTypes:ranked.map(i=>i.type),
      rankedKeysOk:ranked.every(i=>/^article\\|\\d+$/.test(i.key)),
      plainHasGroup:plain.some(i=>i.type==='group')
    };
  })()`);
  console.log(`  单元：带 score → [${r.rankedTypes.join(',')}]；不带 score → 有分类标题 ${r.plainHasGroup}`);
  ok(r.rankedTypes.length === 3 && r.rankedTypes.every(t => t === 'item'), '带分数的条目产出单一列表（一条 group 都没有）');
  ok(r.rankedKeysOk, '相关性模式下条目的 key 仍是 article|<序号>（FLIP 复用不受影响）');
  ok(r.plainHasGroup, '不带分数的条目仍按分类分组（模糊关的旧行为没被改坏）');
}

console.log('\n══════ ③ 模糊关：应退回纯词法、不出现扩展分组 ══════');
await setScope('title');
await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);
ok(await evaluate(`articleFuzzyOn()`) === false, '模糊已关');
// 搜索栏里已经没有这个按钮了，用户唯一能看到状态的入口就是「我的」——
// 去那儿确认它真的显示为关（而不是只在内存里变了、界面没跟上）。
await evaluate(`(()=>{ if(typeof onTabClick==='function') onTabClick('settings'); return true; })()`);
await sleep(1500);
ok(await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`) === false, '「我的」里开关显示为关');
await evaluate(`(()=>{ if(typeof onTabClick==='function') onTabClick('articles'); return true; })()`);
await sleep(1500);
{
  const res = await evaluate(SEARCH_JS('奥运'));
  const hasPart = res.out.some(r => r.type === 'group' && r.isPartition);
  const groups = res.out.filter(r => r.type === 'group').map(r => r.label);
  const items = res.out.filter(r => r.type === 'item').length;
  console.log(`  「奥运」模糊关 → 命中条目 ${items} 个, 分组: ${groups.join(' / ') || '（无）'}, 空状态: ${res.empty}`);
  ok(!hasPart, '不出现「精确匹配/同义扩展命中」分区标题');
  ok(items === 0, '模糊关下「奥运」按标题字面确实无结果（语料标题里没有"奥运"）');
  ok(res.empty === true, '0 结果时正常显示空状态占位');
}
{
  const res = await evaluate(SEARCH_JS('中国人民银行'));
  const n = res.out.filter(r => r.type === 'item').length;
  const groups = res.out.filter(r => r.type === 'group');
  console.log(`  「中国人民银行」模糊关 → 字面命中 ${n} 个, 分类标题 ${groups.length} 个`);
  ok(n > 0, '纯词法搜索照常工作');
  // ★ 模糊关必须**保留原来的分类分组**。这同时是"旧行为没被改坏"的证据：
  //   模糊开的纯相关性列表是没有分类标题的，两者泾渭分明。
  ok(groups.length > 0, '模糊关时仍按分类分组（默认顺序没被改坏）');
}
await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);
await sleep(300);
ok(await evaluate(`articleFuzzyOn()`) === true, '模糊已恢复为开');

console.log('\n══════ ④ 模糊状态不再进 URL；老 fz- 段被安全忽略 ══════');
{
  await evaluate(`(()=>{const i=document.getElementById('searchInput');i.value='央行';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(700);
  const hash = await evaluate(`location.hash`);
  console.log(`  搜「央行」后的 hash: ${decodeURIComponent(hash)}`);
  ok(hash.includes('q-'), 'hash 仍含关键词段（搜索状态照常进 URL）');
  ok(!hash.includes('fz-'), 'hash 里不再有 fz- 段（偏好不进 URL）');

  // 老链接（带 fz-off）必须能正常打开：不能被当成文章序号、也不能丢掉搜索范围
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Page.navigate', { url: BASE + '#articles/q-%E5%8D%81%E5%85%83/sm-fulltext/fz-off' });
  await sleep(3000);
  const st = await evaluate(`JSON.stringify({mode:articleSearchMode,
    kw:(typeof articleSearchKeyword!=='undefined'?articleSearchKeyword:''),
    idx:(typeof articleState!=='undefined'&&articleState?articleState.currentIndex:-999)})`);
  const o = JSON.parse(st);
  console.log(`  老链接解析结果: ${JSON.stringify(o)}`);
  ok(o.mode === 'fulltext', '老链接的搜索范围仍能正确还原');
  ok(o.kw === '十元', '老链接的关键词仍能正确还原');
  ok(o.idx < 0, '老链接里的 fz-off 没被误当成文章序号');
  ok(await evaluate(`articleFuzzyOn()`) === true, '老链接里的 fz-off 不再改动模糊设置（它已改为「我的」里的偏好）');
}

console.log('\n══════ ⑤ 表加载失败 → 静默降级，搜索必须仍可用 ══════');
await send('Network.setBlockedURLs', { urls: ['*synonyms.json*'] });
consoleMsgs.length = 0;
await evaluate(`(()=>{
  // 强制重新加载：清掉记忆化，模拟"表没拿到"
  articleSynonymPromise=null; articleSynonymTable=null;
  return true; })()`);
await evaluate(`(()=>{ const i=document.getElementById('searchInput'); i.value='中国人民银行'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await sleep(1500);
{
  const n = await evaluate(`(()=>document.querySelectorAll('.article-dynamic-wrapper .search-result-item').length)()`);
  const badge = await evaluate(`(()=>document.querySelectorAll('.article-synonym-hit').length)()`);
  const groups = await evaluate(`(()=>[...document.querySelectorAll('.article-dynamic-wrapper .search-group-header span:first-child')].map(s=>s.textContent))()`);
  console.log(`  表被阻断后：「中国人民银行」命中 ${n} 条, 同义徽标 ${badge} 个, 分组 ${JSON.stringify(groups)}`);
  ok(n > 0, '表加载失败时搜索仍返回结果（未崩、未空）');
  ok(badge === 0, '没有同义扩展命中（已退化为纯词法）');
  console.log(`  控制台告警: ${consoleMsgs.filter(m => m.includes('同义词表')).length} 条（预期 1 条，不重复刷屏）`);
  ok(consoleMsgs.filter(m => m.includes('同义词表')).length <= 2, '只 warn 一次，不刷屏');
}
await send('Network.setBlockedURLs', { urls: [] });

console.log('\n══════ ⑥ 纸币/硬币板块完全不受影响 ══════');
await evaluate(`(()=>{ if(typeof onTabClick==='function') onTabClick('notes'); return true; })()`);
await sleep(1200);
{
  const noFuzzyBtn = await evaluate(`(()=>!document.getElementById('fuzzyToggle'))()`);
  ok(noFuzzyBtn === true, '纸币/硬币板块搜索栏里也没有模糊按钮');
  const tip = await evaluate(`(()=>{const e=document.getElementById('searchTip');return e?e.textContent:''})()`);
  ok(!tip.includes('模糊'), '纸币/硬币提示文字不含模糊字样');
  const found = await evaluate(`(()=>{
    const i=document.getElementById('searchInput');
    i.value='水印'; i.dispatchEvent(new Event('input',{bubbles:true}));
    return true; })()`);
  await sleep(1000);
  const cnt = await evaluate(`(()=>document.querySelectorAll('.search-result-item').length)()`);
  console.log(`  硬币板块搜「水印」→ ${cnt} 个结果节点`);
  ok(cnt > 0, '硬币搜索照常工作');
}

console.log('\n══════ ⑦ 深链接直进全文搜索：正文索引必须建起来、列表与 meta 必须一致 ══════');
// ★ 这一节防的是一类**静默**失败，所以必须拥有独立的一次冷启动导航。
//   背景（实测踩过的 bug）：collectAllArticles() 只在 enterArticlesTab() 里被调用，
//   而 router.applyRoute() 的顺序是「先 await preloadAllArticles()，再 enterArticlesTab()」。
//   于是深链接直进全文搜索时，预热跑在文章列表被收集**之前**，collectedArticles 是空数组，
//   map 出来是空的：这个 promise 会"成功"完成并被永久记忆化，正文索引再也建不起来。
//   表现极具迷惑性 —— 搜索框有词、meta 显示「共 N 篇」、但列表是空的（或只剩标题命中）。
{
  // ★ 必须是**真正的冷启动**。只改 hash 的 Page.navigate 属于同文档导航、不会重新加载，
  //   那样拿到的还是上一节留下的运行时状态（第 ⑤ 节把 articleSynonymPromise 置空后
  //   加载失败的那个"已完成的失败 promise"会被一直记忆化，表永远是 null），
  //   于是这一节会测出一个假的失败。先跳到 about:blank 强制丢弃文档。
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  consoleMsgs.length = 0;
  await send('Page.navigate', { url: BASE + '#articles/q-%E5%8D%81%E5%85%83/sm-fulltext' });
  let idx = 0, total = 0;
  for (let i = 0; i < 70; i++) {
    await sleep(500);
    const s = await evaluate(`JSON.stringify({idx:Object.keys(articlePlainTextCache).length,
      total:(typeof collectedArticles!=='undefined'?collectedArticles.length:0)})`);
    const o = JSON.parse(s);
    idx = o.idx; total = o.total;
    if (total > 0 && idx >= total - 5) break;
  }
  console.log(`  冷启动深链接后：正文索引 ${idx}/${total}`);
  ok(idx > 0, '深链接直进全文搜索时正文索引建起来了（不是 0）');

  // 同义词表也是异步加载的：不等它，这里量到的只是"纯字面命中"，
  // 会把这一节变成"看起来通过、其实没覆盖模糊扩展"的假绿。
  for (let i = 0; i < 40; i++) {
    const t = await evaluate(`(()=>typeof articleSynonymTable!=='undefined'&&articleSynonymTable?Object.keys(articleSynonymTable.terms).length:0)()`);
    if (t > 0) break;
    await sleep(300);
  }
  await sleep(600);
  const tbl = await evaluate(`(()=>typeof articleSynonymTable!=='undefined'&&articleSynonymTable?Object.keys(articleSynonymTable.terms).length:0)()`);
  console.log(`  同义词表：${tbl} 条`);
  if (tbl === 0) console.log('  诊断：控制台消息 =', JSON.stringify(consoleMsgs.slice(-3)));
  ok(tbl > 0, '深链接路径下同义词表也正常加载');

  const r = await evaluate(`(()=>{
    const w=document.querySelector('.article-dynamic-wrapper');
    let n=0, parts=[]; for(const el of w.children){const k=el.dataset.key;
      if(!k) continue;
      if(k.startsWith('group|')){ if(k.includes('__partition__')) parts.push((el.querySelector('.search-group-header span')||{}).textContent); continue; }
      n++;}
    return JSON.stringify({dom:n, filtered:getFilteredArticles().length, parts,
      meta:(document.getElementById('articleResultMeta')||{}).textContent||'',
      empty:!!w.querySelector('.empty-state')});
  })()`);
  const o = JSON.parse(r);
  console.log(`  DOM ${o.dom} 条 / getFilteredArticles ${o.filtered} 条 / meta「${o.meta}」 / 空状态 ${o.empty} / 分区 ${JSON.stringify(o.parts)}`);
  ok(o.filtered > 0, '「十元」在全文口径下能搜到结果（正文索引已生效）');
  // 核心断言：三者必须一致。之前正是 dom=0 而 meta=「共1篇」。
  ok(o.dom === o.filtered, `列表条数与实际结果数一致（DOM ${o.dom} vs filtered ${o.filtered}）`);
  ok(!o.empty, '列表没有错误地显示空状态');
  const num = (o.meta.match(/共\s*(\d+)\s*篇/) || [])[1];
  ok(String(num) === String(o.filtered), `meta 里的数字与实际结果数一致（meta「${o.meta}」 vs ${o.filtered}）`);
  // ★ 下面不再写死"「十元」必须有扩展命中 / 命中数 >= 20"。
  //   那两条是**旧同义表（构建期 LLM 现编）的固有属性**，不是这张表的属性：
  //   同义表的数据源已经换成《同义词词林》（离线查表），「十元」在词林里没有
  //   对应词条，命中数本来就该只有字面那几条。写死常量只会让换数据源时假红。
  //   这一节真正要防的是"冷启动把正文索引建漏了"这类静默失败，所以改成：
  //     ① 冷启动后同义扩展机制确实在工作（从当前表里现挑一个真有扩展的键来验）；
  //     ② 深链接冷启动的结果与"同一条查询走常规路径"的结果**逐项相同**。
  const exp = await evaluate(`(()=>{
    const t=articleSynonymTable&&articleSynonymTable.terms; if(!t) return 'null';
    for(const k of Object.keys(t)){ const e=getArticleExpansions(k);
      if(e.length) return JSON.stringify({k,n:e.length,sample:e.slice(0,3)}); }
    return 'none';
  })()`);
  if (exp === 'null' || exp === 'none') {
    ok(false, '冷启动后同义扩展机制可用（没找到任何能扩展的键）');
  } else {
    const e = JSON.parse(exp);
    console.log(`  冷启动后扩展机制：键「${e.k}」→ ${e.n} 条（${e.sample.join(' / ')}）`);
    ok(true, '冷启动后同义扩展机制可用');
  }

  await evaluate(`(()=>{const i=document.getElementById('searchInput');
    i.value='十元'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await sleep(900);
  const o2 = JSON.parse(await evaluate(`(()=>{
    const w=document.querySelector('.article-dynamic-wrapper');
    let n=0; for(const el of w.children){const k=el.dataset.key; if(k&&!k.startsWith('group|')) n++;}
    return JSON.stringify({dom:n, filtered:getFilteredArticles().length,
      meta:(document.getElementById('articleResultMeta')||{}).textContent||''});
  })()`));
  console.log(`  常规路径重搜「十元」：DOM ${o2.dom} 条 / filtered ${o2.filtered} 条 / meta「${o2.meta}」`);
  ok(o2.filtered === o.filtered, `深链接冷启动与常规路径结果一致（${o.filtered} vs ${o2.filtered}）`);
  ok(o2.dom === o2.filtered, `常规路径下列表条数也一致（DOM ${o2.dom} vs filtered ${o2.filtered}）`);
}

console.log('\n══════ ⑧ 高亮分两色；且不再有任何"同义命中"文案 ══════');
// 用户要求：① 非精准（同义）命中的高亮要用**另一种颜色**，但"不要太大的视觉差异"；
//          ② 不要告诉用户实际按什么搜的，所以那行「同义命中：xxx」小字必须消失。
// ★ 测试词选「荷花」：它自己字面就能命中几篇（精准），而它的同义词「莲花」能命中一批
//   （同义），所以同一次搜索里两类高亮都会出现 —— 随便挑个词很可能只出现一种。
{
  if (typeof setScope === 'function') await setScope('fulltext');
  await evaluate(`(()=>{const i=document.getElementById('searchInput');
    i.value='荷花'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await sleep(1200);
  const r = JSON.parse(await evaluate(`(()=>{
    const vis = el => el.offsetParent !== null || el.getClientRects().length > 0;
    const exact = [...document.querySelectorAll('mark.article-hl-exact')].filter(vis);
    const syn = [...document.querySelectorAll('mark.article-hl-synonym')].filter(vis);
    const badge = [...document.querySelectorAll('.article-synonym-hit')].filter(vis);
    const st = el => (el.getAttribute('style') || '').replace(/\\s+/g, '');
    return JSON.stringify({
      exact: exact.length, syn: syn.length, badge: badge.length,
      exactText: exact.slice(0,3).map(e=>e.textContent),
      synText: syn.slice(0,3).map(e=>e.textContent),
      exactStyle: exact[0] ? st(exact[0]) : '',
      synStyle: syn[0] ? st(syn[0]) : '',
      bodyHasBadgeText: document.body.innerText.includes('同义命中'),
      n: getFilteredArticles().length
    });
  })()`));
  console.log(`  「荷花」共 ${r.n} 条；精准高亮 ${r.exact} 处 ${JSON.stringify(r.exactText)}；同义高亮 ${r.syn} 处 ${JSON.stringify(r.synText)}`);
  console.log(`    精准样式 ${r.exactStyle}`);
  console.log(`    同义样式 ${r.synStyle}`);
  ok(r.exact > 0, `精准命中有金色高亮（${r.exact} 处）`);
  ok(r.syn > 0, `同义命中有另一种颜色的高亮（${r.syn} 处）`);
  ok(r.exactStyle !== r.synStyle && r.exactStyle && r.synStyle, '两种高亮的样式确实不同');
  // "不要太大的视觉差异"：形状/内边距/字色必须一致，只有背景色不同
  const shape = (s) => s.replace(/background:[^;]*;?/, '');
  ok(shape(r.exactStyle) === shape(r.synStyle), '除背景色外，两种高亮的形状与字色完全一致（差异被刻意做小）');
  ok(/background:#ffd700/.test(r.exactStyle), '精准命中仍是原来的金色');
  ok(r.badge === 0, '不再渲染 .article-synonym-hit 徽标');
  ok(!r.bodyHasBadgeText, '页面上再也搜不到「同义命中」这四个字');
}

console.log('\n══════ ⑨ 多关键词：无空格分词 + 兜底阶梯 ══════');
// 用户要求：① 「尽量不要空格就能搜，例如输入澳门荷花也可以搜出来」
//          ② 「输入澳门荷花666 也要能搜出来，666 是无关的，只根据前面的澳门荷花匹配就可以」
// 设计要点：兜底阶梯**只在整串搜索 0 条时才介入**，所以现在能用的搜索一律不受影响。
{
  await setScope('fulltext');
  await evaluate(`(()=>{ setArticleFuzzy(true); return true; })()`);
  await sleep(300);

  // 搜一次，返回：条数 / 每篇路径 / 是否每篇都字面含指定词 / 高亮的词
  async function searchStats(q, terms) {
    await evaluate(`(()=>{const i=document.getElementById('searchInput');
      i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
    await sleep(1100);
    return JSON.parse(await evaluate(`(()=>{
      const items = getFilteredArticles();
      const vis = el => el.offsetParent !== null || el.getClientRects().length > 0;
      const TERMS = ${JSON.stringify(terms)};
      const hayOf = e => (((e.article.title||'') + '\\n' + (articlePlainTextCache[e.article.contentPath]||'')).toLowerCase());
      // 诊断：可见的 .search-result-item 到底分布在哪些容器里
      const byParent = {};
      const strays = [];
      for (const el of document.querySelectorAll('.search-result-item')) {
        if (!vis(el)) continue;
        const w = el.parentElement;
        const k = w ? (w.className || w.id || w.tagName) : 'none';
        byParent[k] = (byParent[k] || 0) + 1;
        if (!w || !w.classList || !w.classList.contains('article-dynamic-wrapper')) {
          strays.push({ key: el.dataset.key || '', parentCls: w ? w.className : '', html: el.outerHTML.slice(0, 200) });
        }
      }
      const wrap = document.querySelector('.article-dynamic-wrapper');
      return JSON.stringify({
        n: items.length,
        paths: items.map(e => e.article.contentPath).sort(),
        allHaveTerms: items.every(e => { const h = hayOf(e); return TERMS.every(t => h.includes(t)); }),
        // 每条结果各自的高亮词表（t:E = 精准色，t:S = 同义色）
        allHlTerms: items.map(e => (e.highlightTerms || []).map(x => x.t + (x.exact ? ':E' : ':S')).sort().join(',')),
        hlExact: [...new Set([...document.querySelectorAll('mark.article-hl-exact')].filter(vis).map(e=>e.textContent))].sort(),
        hlSyn: [...new Set([...document.querySelectorAll('mark.article-hl-synonym')].filter(vis).map(e=>e.textContent))].sort(),
        dom: [...document.querySelectorAll('.search-result-item')].filter(vis).length,
        domInWrapper: wrap ? [...wrap.children].filter(el => el.classList.contains('search-result-item')).length : -1,
        domByParent: byParent,
        strays
      });
    })()`));
  }

  // ---- ① 无空格：澳门荷花 ----
  // ★ 先把模糊关掉再验"AND 语义"：模糊开时「荷花」会扩展成「莲花」，
  //   结果里出现的字是「莲花」而不是「荷花」，按字面断言会误判。
  //   所以字面 AND 用模糊关来验，模糊开的召回另有一条。
  await evaluate(`(()=>{ setArticleFuzzy(false); return true; })()`);
  await sleep(400);

  const a = await searchStats('澳门荷花', ['澳门', '荷花']);
  console.log(`  「澳门荷花」（模糊关）→ ${a.n} 条；每篇都同时含「澳门」和「荷花」= ${a.allHaveTerms}`);
  console.log(`    DOM 诊断：可见条目 ${a.dom}（wrapper 内 ${a.domInWrapper}）分布 ${JSON.stringify(a.domByParent)}`);
  if (a.strays.length) console.log(`    ⚠ 游离条目 ${a.strays.length} 个: ${JSON.stringify(a.strays)}`);
  ok(a.n > 0, `无空格也能搜出来（「澳门荷花」命中 ${a.n} 条）`);
  ok(a.allHaveTerms, '「澳门荷花」的每条结果都同时含「澳门」和「荷花」（AND 语义，不是 OR）');
  ok(a.domInWrapper === a.n, `列表条数与结果条数一致（wrapper 内 ${a.domInWrapper} vs ${a.n}）`);
  // ★ 注意：这里**故意不断言**"没有嵌套的第二层"。
  //   现状是每条结果在 DOM 里嵌套两层（reconcileArticleWithFLIP 建的
  //   div.search-result-item 里又塞了模板返回的 div.search-result-item，
  //   分类标题 .search-result-group 同理）。这是**改动之前就存在**的既有问题，
  //   与本次多关键词无关，所以只记录、不当失败。
  //   有意义的计数是"wrapper 的直接子元素数"（上面那条），它是对的。
  if (a.strays.length) {
    console.log(`    ⓘ 既有问题（非本次引入）：每条结果在 DOM 里嵌套两层，可见 .search-result-item 计数翻倍`
      + `（wrapper 内 ${a.domInWrapper} 个，全文档可见 ${a.dom} 个）`);
  }

  // ---- ② 无关尾巴：澳门荷花666 / 澳门荷花abc ----
  const b = await searchStats('澳门荷花666', ['澳门', '荷花']);
  console.log(`  「澳门荷花666」→ ${b.n} 条（对照「澳门荷花」${a.n} 条）`);
  ok(b.n > 0, `「澳门荷花666」能搜出来（${b.n} 条）`);
  ok(JSON.stringify(b.paths) === JSON.stringify(a.paths),
    `666 被当成无关尾巴丢掉，结果与「澳门荷花」完全一致（${b.n} vs ${a.n}）`);

  const c = await searchStats('澳门荷花abc', ['澳门', '荷花']);
  console.log(`  「澳门荷花abc」→ ${c.n} 条`);
  ok(c.n > 0 && JSON.stringify(c.paths) === JSON.stringify(a.paths),
    `字母尾巴同样被丢掉，结果与「澳门荷花」一致（${c.n} 条）`);

  // ---- ③ 高亮：按实际命中的词上色 ----
  console.log(`  「澳门荷花666」高亮数据：${JSON.stringify(b.allHlTerms)}`);
  console.log(`    DOM 上可见的高亮：精准 ${JSON.stringify(b.hlExact)}；同义 ${JSON.stringify(b.hlSyn)}`);
  ok(b.allHlTerms.every(s => s.includes('澳门:E') && s.includes('荷花:E')),
    '每条结果都把「澳门」「荷花」标成**精准色**（用户打的整串匹配不上，高亮的是实际命中的词）');
  // DOM 上能看到多少取决于词落在标题还是正文，所以只要求"至少有一个精准高亮出现"
  ok(b.hlExact.includes('澳门'), 'DOM 上确实渲染出了精准色高亮（「澳门」在标题里）');

  // ---- ③b 模糊开：每个词各自做同义扩展，召回不少于模糊关 ----
  await evaluate(`(()=>{ setArticleFuzzy(true); return true; })()`);
  await sleep(400);
  const aFuzzy = await searchStats('澳门荷花', ['澳门', '荷花']);
  console.log(`  「澳门荷花」（模糊开）→ ${aFuzzy.n} 条（模糊关 ${a.n} 条）`);
  ok(aFuzzy.n >= a.n, `模糊开时每个词各自扩展，召回不少于模糊关（${aFuzzy.n} >= ${a.n}）`);
  await evaluate(`(()=>{ setArticleFuzzy(false); return true; })()`);
  await sleep(400);

  // ---- ④ 数字不被乱切：2002澳门 ----
  const d = await searchStats('2002澳门', ['2002', '澳门']);
  console.log(`  「2002澳门」→ ${d.n} 条；每篇都同时含「2002」和「澳门」= ${d.allHaveTerms}`);
  ok(d.n > 0, `「2002澳门」命中 ${d.n} 条`);
  ok(d.allHaveTerms, '「2002」整段算一个词（没有被切成 20+02），结果是 AND 语义');

  // ---- ⑤ 汉字尾巴：生肖钞999 ----
  const e2 = await searchStats('生肖钞999', ['生肖']);
  console.log(`  「生肖钞999」→ ${e2.n} 条`);
  ok(e2.n > 0, `「生肖钞999」能搜出来（丢掉 999 后按「生肖」命中 ${e2.n} 条）`);

  // ---- ⑥ 安全阀：整串能命中的查询，绝不被兜底放宽 ----
  const f = await searchStats('中国人民银行', ['中国人民银行']);
  console.log(`  「中国人民银行」→ ${f.n} 条；每篇都字面含整串 = ${f.allHaveTerms}`);
  ok(f.n > 0, `整串本身能命中（${f.n} 条）`);
  ok(f.allHaveTerms, '★ 安全阀：整串能命中时兜底阶梯完全不介入，结果没有被放宽');

  // ---- ⑦ 两个主题词都搜不到交集时，仍要给结果 ----
  await evaluate(`(()=>{ setArticleFuzzy(true); return true; })()`);
  await sleep(400);
  const g = await searchStats('荷花生肖', ['荷花', '生肖']);
  console.log(`  「荷花生肖」→ ${g.n} 条`);
  ok(g.n > 0, `两个词没有交集时兜底仍然给结果（${g.n} 条）`);
}

console.log('\n══════ ⑩ 全文提示词：重建搜索栏后不能退回「还要加载」 ══════');
// 用户报的 bug：全文索引早就建好了，但**只要切去「我的」页再回来**
// （搜索栏会被重建），提示词就变回「全文还在加载中」，而且再也不会变 ——
// 因为 preloadAllArticles 已经跑完，不会再写第二次文案。
// 根因：core.js 重建搜索栏时调的是 articleSearchTip()（不传状态），
//       而旧实现把"不传状态"一律当成加载中。
{
  await setScope('fulltext');
  await sleep(600);
  const tipOf = () => evaluate(`(()=>{const e=document.getElementById('searchTip');return e?e.textContent:''})()`);

  const t0 = await tipOf();
  console.log(`  刚进全文：${t0}`);
  ok(t0.includes('准备好啦'), '全文索引就绪后提示词说的是"准备好啦"');

  // ① 切去「我的」再回来（这一步会重建搜索栏）
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`);
  await sleep(1600);
  await evaluate(`(()=>{ onTabClick('articles'); return true; })()`);
  await sleep(1600);
  const t1 = await tipOf();
  console.log(`  切「我的」再回来后：${t1}`);
  ok(t1.includes('准备好啦'), '★ 切去「我的」再回来，提示词仍然是"准备好啦"（没有退回"还要加载"）');
  ok(!t1.includes('还在加载'), '★ 提示词里没有"还在加载"');

  // ② 在「我的」里开关一次模糊搜索，再回来
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`);
  await sleep(1600);
  await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);
  await sleep(600);
  await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);   // 还原
  await sleep(600);
  await evaluate(`(()=>{ onTabClick('articles'); return true; })()`);
  await sleep(1600);
  const t2 = await tipOf();
  console.log(`  开关过模糊搜索再回来后：${t2}`);
  ok(t2.includes('准备好啦'), '★ 开关过模糊搜索再回来，提示词仍然是"准备好啦"');

  // ③ 切到标题模式应当是标题那句；切回全文应当又变回"准备好啦"
  await evaluate(`(()=>{ toggleArticleSearchMode(); return true; })()`);
  await sleep(900);
  const t3 = await tipOf();
  console.log(`  切到标题模式：${t3}`);
  ok(t3.includes('按标题找') && !t3.includes('加载'), '切到标题模式时提示词是"按标题找"那句');

  await evaluate(`(()=>{ toggleArticleSearchMode(); return true; })()`);
  await sleep(1500);
  const t4 = await tipOf();
  console.log(`  再切回全文：${t4}`);
  ok(t4.includes('准备好啦'), '★ 切回全文后提示词是"准备好啦"（不是"还在加载"）');

  // ④ 反向验证：把**旧实现**换回去，确认这个探针真的能测出这个 bug。
  //    旧实现就是"不传状态一律当成加载中"。
  await evaluate(`(()=>{
    window.__origTip = articleSearchTip;
    window.articleSearchTip = function (fulltextState) {
      if (articleSearchMode === 'title') return '现在是按标题找（边打边搜），点“标”字能切到全文索引';
      if (fulltextState === 'ready') return '现在是全文索引（边打边搜），点“全”字能切回按标题找 | 全文索引准备好啦，标题和正文都能搜';
      return '现在是全文索引（边打边搜），点“全”字能切回按标题找 | 全文还在加载中，稍等一下下～';
    };
    return true;
  })()`);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`);
  await sleep(1600);
  await evaluate(`(()=>{ onTabClick('articles'); return true; })()`);
  await sleep(1600);
  const tOld = await tipOf();
  await evaluate(`(()=>{ articleSearchTip = window.__origTip; delete window.__origTip; return true; })()`);
  console.log(`  换回旧实现后重建搜索栏：${tOld}`);
  ok(tOld.includes('还在加载'), '★ 反向验证：换回旧实现后确实退回"还在加载"—— 探针是灵敏的');
  // 收尾：恢复成正确实现并重建一次，别把状态留给后面的用例
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`);
  await sleep(1200);
  await evaluate(`(()=>{ onTabClick('articles'); return true; })()`);
  await sleep(1200);
  const tBack = await tipOf();
  ok(tBack.includes('准备好啦'), '恢复正确实现后提示词又变回"准备好啦"');

  // ⑤ ★ 用户报的第二个问题：「清空文章缓存」之后不能再说"加载完成"。
  //    之前的实现把"索引已就绪"记成一个标志位，置成 ready 之后再也不会变，
  //    于是清空缓存后提示词仍然说"准备好啦"——即"成功过一次就无条件说加载好了"。
  //    另外清空后必须**能真的重建**，否则提示词会永远停在"加载中"、
  //    全文搜索还会静默退化成只搜标题（preloadAllArticles 会拿到旧 Promise 直接返回）。
  const beforeClear = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  console.log(`\n  清空前正文缓存 ${beforeClear} 篇`);
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);   // 第一次点：进入确认态
  await sleep(400);
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);   // 第二次点：真清
  await sleep(400);
  const afterClear = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  console.log(`  清空后正文缓存 ${afterClear} 篇`);
  ok(beforeClear > 0 && afterClear === 0, `「清空文章缓存」确实把正文缓存清空了（${beforeClear} → ${afterClear}）`);

  const tipAfterClear = await evaluate(`articleSearchTip()`);
  console.log(`  清空后直接问 articleSearchTip()：${tipAfterClear}`);
  ok(!tipAfterClear.includes('准备好啦'), '★ 清空缓存后提示词**不再**说"准备好啦"（不再是"成功过一次就无条件说加载好了"）');
  ok(tipAfterClear.includes('还在加载'), '★ 清空缓存后提示词退回"还在加载中"');

  // 必须能真的重建 —— 这一条在改 settings.js 之前会失败：
  // 那时 articlePreloadPromise 还钉在旧 Promise 上，缓存会一直是 0 篇。
  await evaluate(`preloadAllArticles()`);
  await sleep(1200);
  const afterRebuild = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  const tipAfterRebuild = await evaluate(`articleSearchTip()`);
  console.log(`  重建后正文缓存 ${afterRebuild} 篇；提示词：${tipAfterRebuild}`);
  ok(afterRebuild > 0, `★ 清空后能真的重建索引（缓存重新填到 ${afterRebuild} 篇）`);
  ok(tipAfterRebuild.includes('准备好啦'), '重建完成后提示词又变回"准备好啦"');

  // 走一遍真实路径：清空 → 切「我的」再回文章板块 → 应自动重建并把提示词修好
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);
  await sleep(400);
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);
  await sleep(400);
  const cleared2 = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`);
  await sleep(1500);
  await evaluate(`(()=>{ onTabClick('articles'); return true; })()`);
  await sleep(4000);
  const tipReal = await tipOf();
  const rebuilt = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  console.log(`  真实路径：清空后缓存 ${cleared2} 篇 → 切「我的」再回文章板块 → 缓存 ${rebuilt} 篇；提示词：${tipReal}`);
  ok(rebuilt > 0 && tipReal.includes('准备好啦'),
    '★ 真实路径：清空后切一次页面就自动重建，提示词恢复"准备好啦"');

  // 反向验证：模拟**旧实现** —— 标志位是粘的（清空缓存不会重置它），
  // 而且"就绪"只看标志位、不查缓存。确认这个探针真的能测出
  // "成功过一次就无条件说加载好了"。
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);
  await sleep(300);
  await evaluate(`(()=>{ clearArticleCache(); return true; })()`);
  await sleep(300);
  const cacheNow = await evaluate(`(()=>Object.keys(articlePlainTextCache).length)()`);
  await evaluate(`(()=>{
    window.__origReady = articleFulltextReady;
    window.__origState = articleFulltextState;
    window.articleFulltextReady = function () { return articleFulltextState === 'ready'; };
    articleFulltextState = 'ready';   // 旧行为：清空缓存不会把标志位重置掉
    return true;
  })()`);
  const tipOldImpl = await evaluate(`articleSearchTip()`);
  await evaluate(`(()=>{
    articleFulltextReady = window.__origReady;
    articleFulltextState = window.__origState;
    delete window.__origReady; delete window.__origState;
    return true;
  })()`);
  console.log(`  反向验证（缓存 ${cacheNow} 篇 + 粘住的标志位）：${tipOldImpl}`);
  ok(cacheNow === 0 && tipOldImpl.includes('准备好啦'),
    '★ 反向验证：缓存已空但标志位粘住时，旧实现确实无条件说"准备好啦"—— 探针是灵敏的');
}

console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
ws.close(); child.kill(); server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => { });
process.exit(fail ? 1 : 0);
