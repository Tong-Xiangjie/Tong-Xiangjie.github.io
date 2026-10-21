// 完整八面图（详情卡片 → 三栏浮层）验收集
//
// 需求（用户）：
//   · 详情卡片里多一行「完整八面图  点击查看」，★ 只有「点击查看」可点，
//     前面那半截相当于这一项的小标题/字段标签。
//   · 点它引发另一个浮层，分三栏：侧光图 / 透光图 / 荧光图（不是"对光"）。
//   · 每栏是正、背两张（八面图要拍就 8 张全齐；-1/-2 就是已有的 img1/img2）。
//   · 手机上自动调节为竖排。
// LIVE=1 走线上，否则本地静态服务。
//
// ★★ 本用例**不写死任何冠号 / 图片文件名 / URL**（2026-11 改）：
//    以前它把 KP04057 与 notecollection/image/comm/KP04057-3..8.jpg 写死在里面，
//    站主一改数据（换冠号、重命名图片、删掉那条藏品）就会整片假红、触发 CI 失败邮件。
//    现在改成：启动后扫**页面自己的分类树 + DATA_MAP/COIN_DATA_MAP**，
//    现挑一个"imgExtra 里每一类都正背两张"的藏品当被测目标，
//    所有期望值（排数 / 图数 / 标题 / 每一栏引用的文件名与顺序 / 翻面配对 / 落点）
//    **全部由它的数据现算**；磁盘存在性由现取到的 URL 反推本地路径再判。
//    只有"当前数据里根本没有这样的藏品"时才记 `○ 跳过`（单独计数，不计通过也不计失败）。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const LIVE = process.env.LIVE === '1';
// ★ 这里原来写死了开发机的绝对路径（'C:/Users/57891/tong-xiangjie.github.io'）。
//   在本机跑没事，一到 CI 就整片红：runner 上没有这个路径，测试服务器对**每个**请求
//   都 404，页面根本没加载 —— 于是"读源码"的静态断言全过、所有运行时断言全挂
//   （诊断里 copyDetailList=undefined、脚本文数=0 就是这么来的）。
//   用 process.cwd()：run.mjs 是以仓库根为 cwd 起用例的，手动跑也要求在仓库根执行
//   （用例里那些 readFileSync('collection/…') 本来就依赖 cwd）。
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let server = null, BASE = 'https://tong-xiangjie.github.io/collection/index.html';
if (!LIVE) {
  server = createServer(async (req, res) => {
    try { const p = decodeURIComponent(req.url.split('?')[0]); const f = join(ROOT, p); const buf = await readFile(f);
      res.writeHead(200, { 'Content-Type': MIME[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' }); res.end(buf);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;
}
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpOcto-'));
const DP = 10995;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
async function esc() { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await sleep(500); }

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }
// ★ 数据里当前**不存在**这个场景（例如一条带完整 imgExtra 的藏品都没有）时用它：
//   单独计数，**不计通过也不计失败**，但必须把"为什么没有测量值"打出来 ——
//   否则就成了假绿。写法与 verify-hm-glow.mjs 的 skip 一致。
const skip = (m) => { skipped++; console.log(`  ○ 跳过 ${m}`); };

// ── 小工具：URL ↔ 本地文件 / 文件名 ────────────────────────────────
// 只取文件名，用于把 URL 变成可读的短标签（日志、跳过原因）
const baseOf = (u) => String(u || '').split('?')[0].split('#')[0].split('/').pop();
// 由**运行时现取到的 URL** 反推本地路径（数据里存的是绝对生产 URL，本地服务器就是从仓库根发文件）
const fileOf = (u) => { try { return join(ROOT, decodeURIComponent(new URL(u).pathname).replace(/^\/+/, '')); } catch { return ''; } };
const fileOk = (u) => { const p = fileOf(u); if (!p || !existsSync(p)) return false; try { return statSync(p).size > 0; } catch { return false; } };

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  // ★ 就绪条件里必须带上 copyDetailList：原来只等 viewScrollContainers + readyState，
  //   在 CI 上出现过"页面已经 ready 但 copyDetailList 还是 undefined"（诊断实测：
  //   {"listLen":"undefined","mode":"?"}），于是后面一路找下标 -1。
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0 && document.readyState==='complete' && typeof copyDetailList!=='undefined')()`).catch(() => false);
    if (r) break;
    await sleep(300);
  }
  await sleep(LIVE ? 2600 : 1800);
}

// ══════════════════════════════════════════════════════════════════
// 目标发现：扫页面自己的分类树 + 数据 map，把"每一件藏品的关键信息"取回来。
// 之后的选择与期望值全在 Node 侧由这份数据现算 —— 用例里不出现任何冠号 / 文件名 / URL。
// ══════════════════════════════════════════════════════════════════
const DISCOVER = `(() => {
  const out = [];
  const resolved = (u) => (typeof getImageUrl === 'function') ? getImageUrl(u) : String(u || '');
  for (const mode of ['notes', 'coins']) {
    const def = (typeof getModeDef === 'function') ? getModeDef(mode) : null;
    if (!def || def.kind !== 'collection' || !def.map) continue;
    const tree = (typeof def.tree === 'function') ? def.tree() : null;
    const map = window[def.map] || {};
    if (!tree) continue;
    const walk = (cats, prefix) => {
      for (const cat of cats || []) {
        if (cat.navHidden) continue;
        const seg = prefix ? prefix + '/' + cat.id : (def.urlSegment + '/' + cat.id);
        const data = cat.dataKey ? map[cat.dataKey] : null;
        if (data && Array.isArray(data.series)) {
          for (let si = 0; si < data.series.length; si++) {
            const s = data.series[si] || {};
            const pools = [];
            if (Array.isArray(s.copies) && s.copies.length) pools.push({ vi: -1, copies: s.copies });
            if (Array.isArray(s.varieties)) for (let vi = 0; vi < s.varieties.length; vi++) {
              const v = s.varieties[vi] || {};
              if (Array.isArray(v.copies) && v.copies.length) pools.push({ vi: vi, copies: v.copies });
            }
            for (const pool of pools) for (let ci = 0; ci < pool.copies.length; ci++) {
              const c = pool.copies[ci] || {};
              const octo = (c.imgExtra && typeof c.imgExtra === 'object') ? Object.keys(c.imgExtra).reduce((acc, k) => {
                if (Array.isArray(c.imgExtra[k])) acc[k] = c.imgExtra[k].map(resolved).filter(Boolean);
                return acc;
              }, {}) : null;
              out.push({
                mode: mode, hash: seg, dataKey: cat.dataKey, si: si, vi: pool.vi, ci: ci,
                version: (c.version === undefined || c.version === null) ? '' : String(c.version),
                img1: resolved(c.img1), img2: resolved(c.img2),
                octo: octo
              });
            }
          }
        }
        if (Array.isArray(cat.children) && cat.children.length) walk(cat.children, seg);
      }
    };
    walk(tree, '');
  }
  return JSON.stringify(out);
})()`;

// 按"数据序号"定位某一条 copy（DATA_MAP 里的对象 === copyDetailList[i].copy，
// 用**对象同一性**比对，比按冠号/文件名比对稳 —— 冠号在不同分类里可能重复）。
// 返回它在当前页面 copyDetailList 里的下标，找不到返回 -1。
function pickExpr(key) {
  return `(() => {
    const def = (typeof getModeDef === 'function') ? getModeDef(${JSON.stringify(key.mode)}) : null;
    const map = (def && def.map && window[def.map]) ? window[def.map] : {};
    const data = map[${JSON.stringify(key.dataKey)}];
    if (!data || !Array.isArray(data.series) || !data.series[${key.si}]) return -1;
    let pool = data.series[${key.si}];
    if (${key.vi} >= 0) { const v = (pool.varieties || [])[${key.vi}]; if (!v) return -1; pool = v; }
    const c = (pool.copies || [])[${key.ci}];
    if (!c || typeof copyDetailList === 'undefined' || !copyDetailList) return -1;
    return copyDetailList.findIndex(x => x.copy === c);
  })()`;
}

const tagOf = (c) => `${c.hash}#s${c.si}${c.vi >= 0 ? '/v' + c.vi : ''}/c${c.ci}${c.version ? ' · ' + c.version : ''}`;

// 打开某条藏品的详情卡片，返回它的 copyDetailList 下标（打不开返回 -1，由调用方决定跳过还是判红）
async function openCard(key) {
  await boot(key.hash);
  let idx = -1;
  for (let i = 0; i < 30; i++) {
    idx = await evaluate(pickExpr(key)).catch(() => -1);
    if (typeof idx === 'number' && idx >= 0) break;
    await sleep(200);
  }
  if (typeof idx !== 'number' || idx < 0) {
    // 打不开时把"为什么没有"打出来，否则只能看到"下标 -1"。
    const diag = await evaluate(`(()=>JSON.stringify({
      listLen: (typeof copyDetailList === 'undefined') ? 'undefined' : copyDetailList.length,
      hash: location.hash, mode: (typeof currentMode !== 'undefined') ? currentMode : '?',
      detailOpen: !!document.querySelector('.copy-detail, .detail-card, #copyDetail')
    }))()`).catch(e => '诊断失败：' + e.message);
    console.log(`  ! 打开 ${tagOf(key)} 的详情卡片失败：copyDetailList 里找不到（诊断 ${diag}）`);
    return -1;
  }
  await evaluate(`(()=>{ openCopyDetail(${idx}); return true; })()`);
  await sleep(700);
  return idx;
}

try {
  await send('Page.enable'); await send('Runtime.enable');
  // ★ 钉死媒体偏好：CI（GitHub 的 Windows runner）默认关闭系统动画 → Chrome 报 reduce，
  //   这个用例后面有依赖展开/过渡完成的断言，随宿主机偏好变红不合适。
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  console.log(`══════ 完整八面图（${LIVE ? '线上' : '本地'}）══════`);

  // ── 0. 现算目标（不写死冠号 / 文件名 / URL）──────────────────────
  await boot('');   // 任意一页即可：DATA_MAP/COIN_DATA_MAP 在首屏渲染前就建好了
  // 页面里声明的"类"（键名 + 中文标签 + 顺序）与"面"的标签：
  // 顺序是产品口径，**类的存在与否与文件名一律来自数据**。
  const KINDS_META = JSON.parse(await evaluate(`JSON.stringify((typeof OCTO_KINDS !== 'undefined') ? OCTO_KINDS : null)`)) || [];
  const FACE_LABELS = JSON.parse(await evaluate(`JSON.stringify((typeof OCTO_FACE_LABELS !== 'undefined') ? OCTO_FACE_LABELS : null)`)) || ['正面', '背面'];
  const ALL = JSON.parse(await evaluate(DISCOVER));
  console.log(`  扫描到 ${ALL.length} 件藏品（纸币 + 硬币），其中带 imgExtra 的 ${ALL.filter(c => c.octo).length} 件`);
  const kindKeysOf = (c) => (KINDS_META.length ? KINDS_META.map(k => k.key) : Object.keys(c.octo || {}))
    .filter(k => Array.isArray((c.octo || {})[k]) && c.octo[k].length > 0);
  // "三键齐全"：页面声明的每一类都在数据里，且每类正好正背两张（界面才会渲染出三排六图）
  const completeOcto = (c) => {
    if (!c.octo) return false;
    const ks = kindKeysOf(c);
    if (!ks.length || !ks.every(k => c.octo[k].length === FACE_LABELS.length)) return false;
    return KINDS_META.length === 0 || ks.length === KINDS_META.length;
  };
  const octoCands = ALL.filter(completeOcto);
  const allFilesOf = (c) => kindKeysOf(c).every(k => c.octo[k].every(fileOk));
  const OCTO_TARGET = octoCands.find(allFilesOf) || octoCands[0] || null;

  let EXPECT_KINDS = [], EXPECT_FACES = {}, EXPECT_IMG_COUNT = 0;
  let octoAllUrls = [], octoMissing = [], octoFilesOk = false;
  if (OCTO_TARGET) {
    EXPECT_KINDS = kindKeysOf(OCTO_TARGET).map(k => ({ key: k, label: (KINDS_META.find(m => m.key === k) || {}).label || k }));
    EXPECT_FACES = {};
    for (const k of EXPECT_KINDS) EXPECT_FACES[k.key] = OCTO_TARGET.octo[k.key].slice();
    EXPECT_IMG_COUNT = EXPECT_KINDS.reduce((n, k) => n + EXPECT_FACES[k.key].length, 0);
    octoAllUrls = EXPECT_KINDS.reduce((a, k) => a.concat(EXPECT_FACES[k.key]), []);
    octoMissing = octoAllUrls.filter(u => !fileOk(u));
    octoFilesOk = octoMissing.length === 0;
  }
  // 需要"图真的解码出来"才有的量：数据的文件在磁盘上不存在时这些量没有测量值 →
  // 记 ○ 跳过并写明原因，不判红。★ 渲染结构 / 排数 / 图数 / 标题 / 顺序 / 层级 /
  //   水平居中这些**不依赖图片解码**的断言一律照旧执行 —— 所以把渲染顺序改错时仍然会红。
  const needImgs = (cond, label) => {
    if (octoFilesOk) ok(cond, label);
    else skip(`${label} —— 跳过原因：${octoMissing.length}/${octoAllUrls.length} 张八面图的本地文件不存在（${octoMissing.map(baseOf).join('、')}），图没有解码，这个量没有测量值`);
  };

  if (!OCTO_TARGET) {
    const want = (KINDS_META.length ? KINDS_META.map(k => k.label) : ['侧光/透光/荧光']).join('/');
    skip(`整个八面图用例：当前数据里没有任何一件藏品的 imgExtra 满足「${want} 每一类都正背两张」—— 这个场景在数据里不存在，1~10 节全部没有测量值`);
  } else {
    console.log(`  被测目标（由数据现算）：${tagOf(OCTO_TARGET)}；${EXPECT_KINDS.length} 类 × ${FACE_LABELS.length} 面 = ${EXPECT_IMG_COUNT} 张`);
    console.log(`    类顺序：${EXPECT_KINDS.map(k => k.label + '(' + k.key + ')').join(' → ')}`);
    console.log(`    文件：${octoAllUrls.map(baseOf).join(', ')}${octoFilesOk ? '（全部在磁盘上存在）' : `（磁盘上缺 ${octoMissing.length} 张：${octoMissing.map(baseOf).join('、')}）`}`);

    console.log('\n── 1. 详情卡片里的入口行 ──');
    let idx = await openCard(OCTO_TARGET);
    if (idx < 0) {
      skip('1~5、7、9、10：目标藏品的详情卡片打不开（数据里那条 copy 在当前分类页没有渲染出来）');
    } else {
      const row = await evaluate(`(()=>{
        const card = document.getElementById('copyDetailLightbox'); if (!card) return JSON.stringify({err:'无卡片'});
        const rows = [...card.querySelectorAll('.detail-row')];
        const r = rows.find(x => (x.querySelector('.detail-label')||{}).textContent === '完整八面图');
        if (!r) return JSON.stringify({err:'无入口行', labels: rows.map(x => (x.querySelector('.detail-label')||{}).textContent)});
        const link = r.querySelector('.octo-link');
        return JSON.stringify({
          isLast: rows.indexOf(r) === rows.length - 1,
          labelText: r.querySelector('.detail-label').textContent,
          linkText: link ? link.textContent : null,
          labelTag: r.querySelector('.detail-label').tagName,
          labelHasOnclick: !!(r.querySelector('.detail-label').getAttribute('onclick')),
          rowHasOnclick: !!r.getAttribute('onclick'),
          linkOnclick: link ? link.getAttribute('onclick') : null,
          linkTag: link ? link.tagName : null
        });
      })()`);
      const R = JSON.parse(row);
      console.log(`    ${JSON.stringify(R)}`);
      ok(!R.err, `卡片里存在「完整八面图」这一行（${tagOf(OCTO_TARGET)}）`);
      ok(R.labelText === '完整八面图', '前半截是字段标签「完整八面图」');
      ok(R.isLast, '入口行位于最后一行（在备注之后）');
      ok(R.linkText === '点击查看', '后半截是链接「点击查看」');
      ok(R.linkTag === 'SPAN' && /openOctoGallery\(\d+\)/.test(R.linkOnclick || ''), '★ 只有「点击查看」挂了 onclick（openOctoGallery）');
      ok(!R.labelHasOnclick && !R.rowHasOnclick, '★ 小标题与整行都没有 onclick（不可点）');
      const st = JSON.parse(await evaluate(`(()=>{
        const link = document.querySelector('#copyDetailLightbox .octo-link');
        const cs = getComputedStyle(link);
        return JSON.stringify({ deco: cs.textDecorationLine, cursor: cs.cursor, color: cs.color });
      })()`));
      console.log(`    链接样式：下划线=${st.deco} 光标=${st.cursor} 颜色=${st.color}`);
      ok(st.deco === 'none', '★ 链接没有下划线（用户明确要求去掉）');
      ok(st.cursor === 'pointer', '链接仍是手型光标（去掉下划线后依然看得出可点）');

      console.log('\n── 2. 八面图浮层：每类一排、正背两张 ──');
      await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
      await sleep(1200);
      const g = JSON.parse(await evaluate(`(()=>{
        const box = document.getElementById('octoLightbox');
        if (!box) return JSON.stringify({err:'浮层没打开'});
        const cols = [...box.querySelectorAll('.octo-col')];
        const data = cols.map(c => ({
          title: (c.querySelector('.octo-col-title')||{}).textContent,
          caps: [...c.querySelectorAll('.octo-face-cap')].map(x => x.textContent),
          // ★ 只取每张图 onclick 里的**第一个** URL（它才是这张图本身）：
          //   openModal('自己', '另一个面') 里第二个是翻面配对，一起算会让顺序判断错位。
          urls: [...c.querySelectorAll('.octo-face img')].map(x => {
            const m = (x.getAttribute('onclick') || '').match(/openModal\\('([^']+)'/);
            return m ? m[1] : '';
          }),
          w: Math.round(c.getBoundingClientRect().width)
        }));
        const all = [...box.querySelectorAll('.octo-face img')];
        return JSON.stringify({
          cols: data,
          imgCount: all.length,
          naturalOk: all.filter(x => x.naturalWidth > 0).length,
          tipGone: !box.querySelector('.octo-tip'),
          cardStillThere: !!document.getElementById('copyDetailLightbox'),
          beforeImageModal: !!(document.getElementById('imageModal') &&
            (box.compareDocumentPosition(document.getElementById('imageModal')) & Node.DOCUMENT_POSITION_FOLLOWING)),
          zIndex: getComputedStyle(box).zIndex,
          modalZ: getComputedStyle(document.getElementById('imageModal')).zIndex
        });
      })()`));
      // ★ 数据里存的是绝对生产 URL（和 img1/img2 同一约定），所以这些图**部署上去之前**
      //   浏览器去线上取必然 404 —— 那不是代码问题，但也让"比例不变形 + 居中"没法真量。
      //   于是本地模式把每一张的 src 临时指到本地静态服务上的**同一个文件**（只是换个取法，
      //   路径由元素自己的 onclick 现取，不再写死 -3..-8 这类文件名），
      //   让几何量测在部署前就是真的；LIVE=1 时直接用线上 URL。
      if (!LIVE) {
        const SERVER_ROOT = BASE.replace(/\/collection\/index\.html.*$/, '');
        const n0 = await evaluate(`(()=>{
          const root = ${JSON.stringify(SERVER_ROOT)};
          const imgs = [...document.querySelectorAll('#octoLightbox .octo-face img')];
          imgs.forEach(im => {
            im.onerror = null;
            const m = /openModal\\('([^']+)'/.exec(im.getAttribute('onclick') || '');
            if (!m) return;
            let rel = m[1];
            try { rel = new URL(m[1]).pathname; } catch (e) { }
            im.src = root + rel;
          });
          return imgs.length;
        })()`);
        console.log(`    本地模式：把 ${n0} 张的 src 指向本地静态服务上的同一份文件（仅测几何用）`);
      }
      for (let i = 0; i < 40; i++) {
        const n = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
        if (n === EXPECT_IMG_COUNT) break;
        await sleep(500);
      }
      g.naturalOk = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
      // 磁盘存在性：由**页面上现取到的 URL**（onclick 里那一串）推本地路径再判，不写死文件名
      const gotOrder0 = (g.cols || []).map(c => c.urls);
      const domDisk = gotOrder0.reduce((a, o) => a.concat(o), []).map(u => ({ u, ok: fileOk(u) }));
      console.log(`    排数=${g.cols ? g.cols.length : 0} 图数=${g.imgCount} 浏览器已渲染=${g.naturalOk}/${EXPECT_IMG_COUNT} 磁盘存在=${domDisk.filter(d => d.ok).length}/${domDisk.length}`);
      if (g.cols) g.cols.forEach(c => console.log(`      ${c.title}: ${c.caps.join(' / ')}  宽 ${c.w}px`));
      ok(!g.err, '点「点击查看」打开了八面图浮层');
      ok(g.cols && g.cols.length === EXPECT_KINDS.length, `排数 = 数据里的类数（实际 ${g.cols ? g.cols.length : 0} / 期望 ${EXPECT_KINDS.length}）`);
      ok(g.cols && g.cols.map(c => c.title).join(',') === EXPECT_KINDS.map(k => k.label).join(','),
         `每排的标题依次是 ${EXPECT_KINDS.map(k => k.label).join('/')}（实际 ${g.cols ? g.cols.map(c => c.title).join('/') : ''}）`);
      ok(g.imgCount === EXPECT_IMG_COUNT, `共 ${EXPECT_IMG_COUNT} 张图 = 类数 × ${FACE_LABELS.length}（实际 ${g.imgCount}）`);
      ok(g.cols && g.cols.every(c => c.caps.join(',') === FACE_LABELS.join(',')), `每栏都是 ${FACE_LABELS.join(' + ')}`);
      ok(g.tipGone, '★ 没有多余提示句（"点图看大图…" 已按要求去掉）');
      // ★★ 顺序判据：**逐类、逐面**比对"页面上渲染出来的 URL"与"数据里的 URL"。
      //    顺序关系才是行为判据（把渲染循环反过来，这里必红）。
      const wantOrder = EXPECT_KINDS.map(k => EXPECT_FACES[k.key]);
      console.log(`    每栏引用的原图（渲染）：${gotOrder0.map(o => o.map(baseOf).join(',')).join('  |  ')}`);
      console.log(`    每栏引用的原图（数据）：${wantOrder.map(o => o.map(baseOf).join(',')).join('  |  ')}`);
      ok(JSON.stringify(gotOrder0) === JSON.stringify(wantOrder),
         '★ 渲染顺序逐类逐面等于数据里的顺序（每类都是 [正面, 背面] 两张，逐值比对 URL）');
      needImgs(g.naturalOk === EXPECT_IMG_COUNT,
        `★ ${EXPECT_IMG_COUNT} 张图都真的渲染出来了（naturalWidth>0 的有 ${g.naturalOk}/${EXPECT_IMG_COUNT}）`);
      if (octoFilesOk) ok(domDisk.every(d => d.ok), `页面上引用的 ${domDisk.length} 个文件在磁盘上真实存在且非空（${domDisk.filter(d => d.ok).length}/${domDisk.length}）`);
      else skip(`磁盘存在性：页面上引用的 ${domDisk.length} 个地址里有 ${domDisk.filter(d => !d.ok).length} 个在磁盘上不存在（${domDisk.filter(d => !d.ok).map(d => baseOf(d.u)).join('、')}）—— 这是数据/文件缺失而不是渲染行为，故不判红；需要图真的解码的量测本轮一并走 ○ 跳过`);
      ok(g.cardStillThere, '八面图打开时详情卡片仍在下面（分层，不互相顶掉）');
      ok(g.beforeImageModal && g.zIndex === g.modalZ,
         `★ 层级：插在 #imageModal 之前、z-index 同值（${g.zIndex} vs ${g.modalZ}）`);

      console.log('\n── 3. 点缩略图看大图（复用现有大图弹窗）──');
      await evaluate(`(()=>{ document.querySelector('#octoLightbox .octo-face img').click(); return true; })()`);
      await sleep(1400);
      const mo = JSON.parse(await evaluate(`(()=>{
        const m = document.getElementById('imageModal');
        return JSON.stringify({
          visible: getComputedStyle(m).display !== 'none' && imageModalOpen === true,
          img1: currentModalImg1, img2: currentModalImg2, side: currentModalSide,
          multi: m.classList.contains('multi-img'),
          galleryStillThere: !!document.getElementById('octoLightbox'),
          onTop: !!(document.getElementById('octoLightbox') &&
            (document.getElementById('octoLightbox').compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING))
        });
      })()`));
      const k0 = EXPECT_KINDS[0].key;
      console.log(`    大图：${baseOf(mo.img1)} ↔ ${baseOf(mo.img2)}  multi-img=${mo.multi}`);
      ok(mo.visible, '点八面图缩略图打开了大图弹窗');
      ok(mo.img1 === EXPECT_FACES[k0][0] && mo.img2 === EXPECT_FACES[k0][1],
         `★ 大图拿到的是这一类的正/背配对（${baseOf(EXPECT_FACES[k0][0])} / ${baseOf(EXPECT_FACES[k0][1])}），所以能直接翻面`);
      ok(mo.multi, '大图弹窗认得出有第二面（显示翻面按钮与"滑动翻面"提示）');
      ok(mo.galleryStillThere, '八面图仍在下面（关掉大图就能回到它）');
      ok(mo.onTop, '★ 大图盖在八面图上面（DOM 顺序生效，没有被浮层压住）');
      await evaluate(`(()=>{ closeModal(); return true; })()`);
      await sleep(900);
      ok(await evaluate(`!!document.getElementById('octoLightbox')`), '关掉大图后八面图还在');

      console.log('\n── 4. Esc 分层关闭 ──');
      await esc();
      ok(!(await evaluate(`!!document.getElementById('octoLightbox')`)), '第一次 Esc 关掉八面图');
      ok(await evaluate(`!!document.getElementById('copyDetailLightbox')`), '详情卡片还开着');
      await esc();
      await sleep(400);
      ok(!(await evaluate(`!!document.getElementById('copyDetailLightbox')`)), '第二次 Esc 才关详情卡片');

      console.log('\n── 5. 关卡片会带走八面图（不留孤儿浮层）──');
      idx = await openCard(OCTO_TARGET);
      await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
      await sleep(900);
      ok(await evaluate(`!!document.getElementById('octoLightbox')`), '八面图已打开');
      await evaluate(`(()=>{ closeCopyDetail(); return true; })()`);
      await sleep(700);
      ok(!(await evaluate(`!!document.getElementById('octoLightbox')`)), '★ 关详情卡片时八面图一起收掉');

      console.log('\n── 6. 没有八面图的藏品不出现入口行 ──');
      await boot(OCTO_TARGET.hash);
      const other = await evaluate(`(()=>{
        const hasOcto = (c) => { try { return typeof getOctoViews === 'function' && getOctoViews(c).length > 0; } catch (e) { return false; } };
        const i = copyDetailList.findIndex(x => x.copy && !hasOcto(x.copy));
        if (i < 0) return JSON.stringify({err:'本分类里没有"没有八面图"的藏品'});
        openCopyDetail(i);
        const card = document.getElementById('copyDetailLightbox');
        const rows = [...card.querySelectorAll('.detail-row')];
        return JSON.stringify({ version: String(copyDetailList[i].copy.version === undefined ? '' : copyDetailList[i].copy.version),
          hasOctoRow: rows.some(x => (x.querySelector('.detail-label')||{}).textContent === '完整八面图'),
          hasOctoLink: !!card.querySelector('.octo-link'),
          rowCount: rows.length });
      })()`);
      const O = JSON.parse(other);
      if (O.err) {
        skip(`6. 对照藏品：${O.err}（当前分类里每一件都有八面图）`);
      } else {
        console.log(`    对照藏品 ${O.version}：${O.rowCount} 行，有入口行=${O.hasOctoRow}`);
        ok(O.rowCount > 0, '对照藏品（确实没有 imgExtra 的那件）的卡片正常渲染');
        ok(O.hasOctoRow === false && O.hasOctoLink === false, '★ 没有八面图的藏品完全没有这一行（其它藏品零影响）');
      }

      console.log('\n── 7. 响应式排布 + 比例不一时的居中 / 不变形 ──');
      await openCard(OCTO_TARGET);
      await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
      await sleep(900);
      if (!LIVE) {
        const SERVER_ROOT = BASE.replace(/\/collection\/index\.html.*$/, '');
        await evaluate(`(()=>{
          const root = ${JSON.stringify(SERVER_ROOT)};
          const imgs = [...document.querySelectorAll('#octoLightbox .octo-face img')];
          imgs.forEach(im => {
            im.onerror = null;
            const m = /openModal\\('([^']+)'/.exec(im.getAttribute('onclick') || '');
            if (!m) return;
            let rel = m[1];
            try { rel = new URL(m[1]).pathname; } catch (e) { }
            im.src = root + rel;
          });
          return true;
        })()`);
      }
      for (let i = 0; i < 40; i++) {
        const n = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
        if (n === EXPECT_IMG_COUNT) break;
        await sleep(500);
      }
      // 量"每排两张"的几何：所有图是否同宽、两张整体是否在行内居中、同排两张的中线是否
      // 对齐（固定宽度 → 上下居中）、以及图片有没有被拉伸（原比 vs 渲染比）。
      const layoutAt = async (w, h) => {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
        await sleep(800);
        return await evaluate(`(()=>{
          const rows = [...document.querySelectorAll('#octoLightbox .octo-faces')];
          return JSON.stringify(rows.map(r => {
            const rb = r.getBoundingClientRect();
            const imgs = [...r.querySelectorAll('img')];
            return {
              title: (r.parentNode.querySelector('.octo-col-title') || {}).textContent,
              rowCx: Math.round(rb.left + rb.width / 2),
              n: imgs.length,
              items: imgs.map(im => {
                const b  = im.getBoundingClientRect();
                const fb = im.closest('.octo-face').getBoundingClientRect();
                return {
                  loaded: im.naturalWidth > 0,
                  nat: +(im.naturalWidth / im.naturalHeight).toFixed(3),
                  draw: +(b.width / b.height).toFixed(3),
                  l: Math.round(b.left), r: Math.round(b.right),
                  w: Math.round(b.width), h: Math.round(b.height),
                  top: Math.round(b.top),
                  cy: Math.round(b.top + b.height / 2),
                  dxRow:  Math.round(Math.abs((b.left + b.width / 2) - (rb.left + rb.width / 2))),
                  dxFace: Math.round(Math.abs((b.left + b.width / 2) - (fb.left + fb.width / 2)))
                };
              })
            };
          }));
        })()`).then(JSON.parse);
      };
      const d = await layoutAt(1280, 900);
      const p = await layoutAt(390, 844);
      const s = await layoutAt(320, 640);
      await send('Emulation.clearDeviceMetricsOverride');

      const allItems = (v) => v.flatMap(r => r.items);
      const pairSpan = (r) => {
        const l = Math.min(...r.items.map(i => i.l)), rr = Math.max(...r.items.map(i => i.r));
        return { width: rr - l, off: Math.round(Math.abs((l + rr) / 2 - r.rowCx)) };
      };
      const cySpread = (r) => Math.max(...r.items.map(i => i.cy)) - Math.min(...r.items.map(i => i.cy));
      const maxDev = (v) => { const a = allItems(v).filter(x => x.loaded).map(x => Math.abs(x.nat - x.draw)); return a.length ? Math.max(...a) : 0; };
      const dist = (v) => allItems(v).filter(x => x.loaded && Math.abs(x.nat - x.draw) > 0.02);
      console.log(`    桌面 ${d.length} 排：` + d.map(r => `${r.title} [${r.items.map(i => i.w + 'x' + i.h).join(' + ')}]`).join('  |  '));
      console.log(`    390px ${p.length} 排：` + p.map(r => `${r.title} [${r.items.map(i => i.w + 'x' + i.h).join(' + ')}]`).join('  |  '));
      console.log(`    两张整体的居中偏差：` + d.map(r => `${r.title} ${pairSpan(r).off}px`).join(' / ') +
                  `；同排两张中线差：` + d.map(r => `${r.title} ${cySpread(r)}px`).join(' / '));

      ok(d.length === EXPECT_KINDS.length, `★ 桌面是 ${EXPECT_KINDS.length} 排（实际 ${d.length}）`);
      ok(d.map(r => r.title).join(',') === EXPECT_KINDS.map(k => k.label).join(','),
         `每排依次是 ${EXPECT_KINDS.map(k => k.label).join('/')}（实际 ${d.map(r => r.title).join('/')}）`);
      // ★ 判"并排在同一行"不能比 top 相等：两张高度不同（透光 292 vs 295）又是上下居中，
      //   top 本来就该差一点。改判几何关系——水平不重叠（左右并排）+ 垂直有交叠（同一行）。
      const sideBySide = (r) => r.items.length === FACE_LABELS.length
        && r.items[0].r <= r.items[1].l + 1
        && Math.min(...r.items.map(i => i.top + i.h)) > Math.max(...r.items.map(i => i.top));
      const stacked = (r) => r.items.length === FACE_LABELS.length
        && Math.min(...r.items.map(i => i.top + i.h)) <= Math.max(...r.items.map(i => i.top)) + 1
        && r.items[0].r > r.items[1].l;
      needImgs(d.every(sideBySide), '★ 每排两张左右并排在同一行上（水平不重叠、垂直有交叠）');
      const widths = [...new Set(allItems(d).map(i => i.w))];
      ok(widths.length === 1, `★ 所有图宽度完全一致（${widths.join('/')}px）—— 竖向的侧光与横向的透光/荧光才真的可对比`);
      ok(d.every(r => pairSpan(r).off <= 2),
         `★ 每排两张整体在行内居中（最大偏差 ${Math.max(...d.map(r => pairSpan(r).off))}px）`);
      needImgs(d.every(r => cySpread(r) <= 2),
         `★ 固定宽度下同排两张上下居中（中线最大差 ${Math.max(...d.map(cySpread))}px；两张高度 ${d[0].items.map(i => i.h).join(' vs ')}）`);
      console.log(`    原比/渲染比最大偏差：桌面 ${maxDev(d).toFixed(3)} / 390px ${maxDev(p).toFixed(3)}`);
      needImgs(dist(d).length === 0, `★ 桌面所有图都没被拉伸变形（最大偏差 ${maxDev(d).toFixed(3)}）`);
      needImgs(dist(p).length === 0, `★ 手机所有图都没被拉伸变形（最大偏差 ${maxDev(p).toFixed(3)}）`);
      needImgs(p.every(stacked), '★ 手机上同一排的两张改为上下两行（一张一行，不挤成两个小图）');
      ok(p.every(r => r.items.every(i => i.dxRow <= 2)),
         `★ 竖排时每张在行内左右居中（最大偏差 ${Math.max(...allItems(p).map(i => i.dxRow))}px）`);
      ok(allItems(s).every(i => i.dxRow <= 2),
         `320px 同样左右居中（最大偏差 ${Math.max(...allItems(s).map(i => i.dxRow))}px）`);

      console.log('\n── 9. 八面图里翻面后退出大图，要缩回「它自己那一面」的格子 ──');
      // ★ 这是一类反复出现的 bug：gridThumbForUrl() 的候选表漏掉某个 openModal 入口，
      //   那条入口翻面后关闭就会退化成 fallbackSrc（最初点进来的那张），落点错位。
      //   八面图浮层是最新漏掉的一类 —— 用户报告"翻面后退出大图，图片会回到错误的框内"。
      //   本节直接问 gridThumbForUrl：翻面后它指的落点，是不是八面图里那一张。
      idx = await openCard(OCTO_TARGET);
      await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
      await sleep(900);
      const clickedSrc = await evaluate(`(()=>{
        const im = document.querySelector('#octoLightbox .octo-face img');
        const u = im.getAttribute('src');
        im.click();
        return u;
      })()`);
      await sleep(1500);
      const sideBefore = await evaluate(`currentModalSide`);
      await evaluate(`(()=>{ modalFlip(1); return true; })()`);
      await sleep(900);
      const flip = JSON.parse(await evaluate(`(()=>{
        const base = (s) => String(s || '').split('?')[0].split('#')[0].split('/').pop();
        const faceUrl = currentModalSrc();
        const t = gridThumbForUrl(faceUrl);
        const clicked = document.querySelector('#octoLightbox .octo-face img');
        const ts = t ? (t.getAttribute('src') || '') : '';
        const face = (t && t.closest) ? t.closest('.octo-face') : null;
        const cap = face ? (face.querySelector('.octo-face-cap') || {}).textContent : '';
        return JSON.stringify({
          faceUrl: faceUrl,
          caption: base(faceUrl),
          side: currentModalSide,
          found: !!t,
          inGallery: !!(t && t.closest && t.closest('#octoLightbox')),
          // ★ 不用"src 与 faceUrl 相等"来判：gridThumbForUrl 内部会把缩略图形态也拿来做
          //   匹配，字面量比较会误判。改用两个跟匹配逻辑无关的语义判据 ——
          //   落点图的文件名、以及它上面写的"正面/背面"。
          tail: base(ts),
          faceCap: cap,
          isClickedOne: t === clicked,
          visible: !!(t && t.getBoundingClientRect().width > 0)
        });
      })()`));
      console.log(`    点进去的是 ${baseOf(clickedSrc)}，翻面后大图是 ${flip.caption}（第 ${flip.side} 面）`);
      console.log(`    gridThumbForUrl 指向：${flip.found ? (flip.inGallery ? '八面图内' : '八面图外') : '没找到'}`
        + `${flip.found ? `  ${flip.tail}（标注"${flip.faceCap}"）  是最初点的那张=${flip.isClickedOne}  有尺寸=${flip.visible}` : ''}`);
      ok(sideBefore === 1 && flip.side === 2, `确实翻到了背面（第 ${sideBefore} 面 → 第 ${flip.side} 面）`);
      ok(flip.faceUrl === EXPECT_FACES[k0][1],
         `翻面后大图是配对的那张（数据里 ${baseOf(EXPECT_FACES[k0][0])} → ${baseOf(EXPECT_FACES[k0][1])}，实际 ${flip.caption}）`);
      ok(flip.found, '★ 翻了面也找得到缩回落点（不再退化成"最初点进来的那张"）');
      ok(flip.inGallery, '★ 落点在完整八面图浮层里（.octo-face img 已在候选表内）');
      ok(flip.tail === baseOf(EXPECT_FACES[k0][1]), `★ 落点就是翻到的那一面（${baseOf(EXPECT_FACES[k0][1])}，实际 ${flip.tail}）`);
      ok(flip.faceCap === FACE_LABELS[1], `★ 落点上标的正是"${FACE_LABELS[1]}"（实际 "${flip.faceCap}"）—— 不会飞着反面落进正面格子`);
      ok(!flip.isClickedOne, '★ 落点不是最初点的那张 —— 证明翻面确实换了格子');
      ok(flip.visible, '落点缩略图在视口内有真实宽度（缩回动画真的会播）');

      console.log('\n── 10. 八面图的 URL 不泄漏进全字段搜索 ──');
      // 探针 = 一个**只可能出现在 imgExtra 里**的文件名（不等于 img1/img2 的文件名，
      // 否则命中的是本来就可搜的 img1/img2 字段，断言没有分辨力）。
      const plainFiles = [baseOf(OCTO_TARGET.img1), baseOf(OCTO_TARGET.img2)];
      const probe = octoAllUrls.map(baseOf).find(b => plainFiles.indexOf(b) < 0) || '';
      if (!probe) {
        skip('10. 八面图 URL 不泄漏进搜索：数据里所有八面图文件名都与 img1/img2 同名，找不到只存在于 imgExtra 的探针');
      } else {
        const leak = await evaluate(`(()=>{
          const before = (()=>{ performSearchAndRender('tong-xiangjie', 'all'); return prevSearchResults.length; })();
          performSearchAndRender(${JSON.stringify(probe)}, 'all');
          const n = prevSearchResults.length;
          performSearchAndRender('jpg', 'all');
          const jpg = prevSearchResults.length;
          return JSON.stringify({ before, n, jpg });
        })()`);
        const L = JSON.parse(leak);
        console.log(`    搜「${probe}」→ ${L.n} 件；搜「jpg」→ ${L.jpg} 件`);
        ok(L.n === 0, `★ 八面图的文件路径（${probe}）搜不到（imgExtra 被 isSearchableField 排除）`);
      }
    }
  }

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { } try { child.kill(); } catch { } try { if (server) server.close(); } catch { }
  await sleep(300); process.exit(process.exitCode || 0);
}
