// 完整八面图（详情卡片 → 三栏浮层）验收集
//
// 需求（用户）：
//   · 详情卡片里多一行「完整八面图  点击查看」，★ 只有「点击查看」可点，
//     前面那半截相当于这一项的小标题/字段标签。
//   · 点它引发另一个浮层，分三栏：侧光图 / 透光图 / 荧光图（不是"对光"）。
//   · 每栏是正、背两张（八面图要拍就 8 张全齐；-1/-2 就是已有的 img1/img2）。
//   · 手机上自动调节为竖排。
// LIVE=1 走线上，否则本地静态服务。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const LIVE = process.env.LIVE === '1';
const ROOT = 'C:/Users/57891/tong-xiangjie.github.io';
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

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) { const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0 && document.readyState==='complete')()`).catch(() => false); if (r) break; await sleep(300); }
  await sleep(LIVE ? 2600 : 1800);
}
// 打开 KP04057 的详情卡片，返回它的 copyDetailList 下标
async function openCard(version) {
  await boot('notes/commemorative');
  // ★ 等 copyDetailList 备好再找：CI 上 boot 之后列表还没填完就查会拿到下标 -1 而假红
  //   （2026-10 的 CI 就是这样挂的）。最多等 6 秒；真没有仍然返回 -1，断言照旧会红。
  let idx = -1;
  for (let i = 0; i < 30; i++) {
    idx = await evaluate(`(()=>{ if (typeof copyDetailList === 'undefined') return -1;
      return copyDetailList.findIndex(x => x.copy && String(x.copy.version) === ${JSON.stringify(version)}); })()`);
    if (idx >= 0) break;
    await sleep(200);
  }
  if (idx < 0) return -1;
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

  console.log('\n── 1. 详情卡片里的入口行 ──');
  let idx = await openCard('KP04057');
  ok(idx >= 0, `在纪念钞板块的 copyDetailList 里找到 KP04057（下标 ${idx}）`);
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
  ok(!R.err, '卡片里存在「完整八面图」这一行');
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

  console.log('\n── 2. 八面图浮层：三栏、六图、正背 ──');
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
  // ★ 数据里存的是绝对生产 URL（和 img1/img2 同一约定），所以这六张**部署上去之前**
  //   浏览器去线上取必然 404 —— 那不是代码问题，但也让"比例不变形 + 居中"没法真量。
  //   于是本地模式把六张的 src 临时指到本地静态服务上的同一份文件（同一张图，
  //   只是换了个取法），让几何量测在部署前就是真的；LIVE=1 时直接用线上 URL。
  if (!LIVE) {
    const SERVER_ROOT = BASE.replace(/\/collection\/index\.html.*$/, '');
    const n0 = await evaluate(`(()=>{
      const nums = [3,4,5,6,7,8];
      const imgs = [...document.querySelectorAll('#octoLightbox .octo-face img')];
      imgs.forEach((im, i) => { im.onerror = null; if (nums[i]) im.src = ${JSON.stringify(SERVER_ROOT)} + '/notecollection/image/comm/KP04057-' + nums[i] + '.jpg'; });
      return imgs.length;
    })()`);
    console.log(`    本地模式：把 ${n0} 张的 src 指向本地静态服务上的同一份文件（仅测几何用）`);
  }
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
    if (n === 6) break;
    await sleep(500);
  }
  g.naturalOk = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
  const disk = [];
  for (let n = 3; n <= 8; n++) {
    const f = `${ROOT}/notecollection/image/comm/KP04057-${n}.jpg`;
    disk.push({ n, ok: existsSync(f) && (await stat(f)).size > 0 });
  }
  const diskOk = disk.filter(d => d.ok).length;
  console.log(`    栏数=${g.cols ? g.cols.length : 0} 图数=${g.imgCount} 浏览器已渲染=${g.naturalOk}/6 磁盘存在=${diskOk}/6`);
  if (g.cols) g.cols.forEach(c => console.log(`      ${c.title}: ${c.caps.join(' / ')}  宽 ${c.w}px`));
  ok(!g.err, '点「点击查看」打开了八面图浮层');
  ok(g.cols && g.cols.length === 3, `正好三排（实际 ${g.cols ? g.cols.length : 0}）`);
  ok(g.cols && g.cols.map(c => c.title).join(',') === '侧光图,透光图,荧光图',
     `三排的标题依次是 侧光图/透光图/荧光图（实际 ${g.cols ? g.cols.map(c => c.title).join('/') : ''}）`);
  ok(g.imgCount === 6, `共六张图（实际 ${g.imgCount}）`);
  ok(g.cols && g.cols.every(c => c.caps.join(',') === '正面,背面'), '每栏都是 正面 + 背面');
  ok(g.tipGone, '★ 没有多余提示句（"点图看大图…" 已按要求去掉）');
  const tail = (u) => (String(u).match(/KP04057-\d+\.jpg/) || [''])[0];
  const orders = (g.cols || []).map(c => c.urls.map(tail));
  console.log(`    每栏引用的原图：${orders.map(o => o.join(',')).join('  |  ')}`);
  ok(orders.length === 3 && orders[0].join() === 'KP04057-3.jpg,KP04057-4.jpg'
     && orders[1].join() === 'KP04057-5.jpg,KP04057-6.jpg'
     && orders[2].join() === 'KP04057-7.jpg,KP04057-8.jpg',
     '★ 顺序正确：侧光 -3/-4、透光 -5/-6、荧光 -7/-8');
  ok(g.naturalOk === 6, `★ 六张图都真的渲染出来了（naturalWidth>0 的有 ${g.naturalOk}/6）`);
  ok(diskOk === 6, `六个文件在磁盘上真实存在且非空（${diskOk}/6）`);
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
  console.log(`    大图：${mo.img1} ↔ ${mo.img2}  multi-img=${mo.multi}`);
  ok(mo.visible, '点八面图缩略图打开了大图弹窗');
  ok(/KP04057-3\.jpg/.test(mo.img1 || '') && /KP04057-4\.jpg/.test(mo.img2 || ''),
     '★ 大图拿到的是这一类的正/背配对（-3 / -4），所以能直接翻面');
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
  idx = await openCard('KP04057');
  await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
  await sleep(900);
  ok(await evaluate(`!!document.getElementById('octoLightbox')`), '八面图已打开');
  await evaluate(`(()=>{ closeCopyDetail(); return true; })()`);
  await sleep(700);
  ok(!(await evaluate(`!!document.getElementById('octoLightbox')`)), '★ 关详情卡片时八面图一起收掉');

  console.log('\n── 6. 没有八面图的藏品不出现入口行 ──');
  await boot('notes/commemorative');
  const other = await evaluate(`(()=>{
    const i = copyDetailList.findIndex(x => x.copy && String(x.copy.version) !== 'KP04057');
    if (i < 0) return JSON.stringify({err:'没有其它藏品'});
    openCopyDetail(i);
    const card = document.getElementById('copyDetailLightbox');
    const rows = [...card.querySelectorAll('.detail-row')];
    return JSON.stringify({ version: String(copyDetailList[i].copy.version),
      hasOctoRow: rows.some(x => (x.querySelector('.detail-label')||{}).textContent === '完整八面图'),
      hasOctoLink: !!card.querySelector('.octo-link'),
      rowCount: rows.length });
  })()`);
  const O = JSON.parse(other);
  console.log(`    对照藏品 ${O.version}：${O.rowCount} 行，有入口行=${O.hasOctoRow}`);
  ok(!O.err && O.rowCount > 0, '对照藏品的卡片正常渲染');
  ok(O.hasOctoRow === false && O.hasOctoLink === false, '★ 没有八面图的藏品完全没有这一行（其它 300 多张零影响）');

  console.log('\n── 7. 响应式排布 + 比例不一时的居中 / 不变形 ──');
  await openCard('KP04057');
  await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
  await sleep(900);
  if (!LIVE) {
    const SERVER_ROOT = BASE.replace(/\/collection\/index\.html.*$/, '');
    await evaluate(`(()=>{
      const nums = [3,4,5,6,7,8];
      const imgs = [...document.querySelectorAll('#octoLightbox .octo-face img')];
      imgs.forEach((im, i) => { im.onerror = null; if (nums[i]) im.src = ${JSON.stringify(SERVER_ROOT)} + '/notecollection/image/comm/KP04057-' + nums[i] + '.jpg'; });
      return true;
    })()`);
  }
  for (let i = 0; i < 40; i++) {
    const n = await evaluate(`[...document.querySelectorAll('#octoLightbox .octo-face img')].filter(x => x.naturalWidth > 0).length`);
    if (n === 6) break;
    await sleep(500);
  }
  // 量"每排两张"的几何：六张是否同宽、两张整体是否在行内居中、同排两张的中线是否
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

  ok(d.length === 3, `★ 桌面是 3 排（实际 ${d.length}）`);
  ok(d.map(r => r.title).join(',') === '侧光图,透光图,荧光图',
     `三排依次是 侧光图/透光图/荧光图（实际 ${d.map(r => r.title).join('/')}）`);
  // ★ 判"并排在同一行"不能比 top 相等：两张高度不同（透光 292 vs 295）又是上下居中，
  //   top 本来就该差一点。改判几何关系——水平不重叠（左右并排）+ 垂直有交叠（同一行）。
  const sideBySide = (r) => r.items.length === 2
    && r.items[0].r <= r.items[1].l + 1
    && Math.min(...r.items.map(i => i.top + i.h)) > Math.max(...r.items.map(i => i.top));
  const stacked = (r) => r.items.length === 2
    && Math.min(...r.items.map(i => i.top + i.h)) <= Math.max(...r.items.map(i => i.top)) + 1
    && r.items[0].r > r.items[1].l;
  ok(d.every(sideBySide), '★ 每排两张左右并排在同一行上（水平不重叠、垂直有交叠）');
  const widths = [...new Set(allItems(d).map(i => i.w))];
  ok(widths.length === 1, `★ 六张图宽度完全一致（${widths.join('/')}px）—— 竖向的侧光与横向的透光/荧光才真的可对比`);
  ok(d.every(r => pairSpan(r).off <= 2),
     `★ 每排两张整体在行内居中（最大偏差 ${Math.max(...d.map(r => pairSpan(r).off))}px）`);
  ok(d.every(r => cySpread(r) <= 2),
     `★ 固定宽度下同排两张上下居中（中线最大差 ${Math.max(...d.map(cySpread))}px；两张高度 ${d[0].items.map(i => i.h).join(' vs ')}）`);
  console.log(`    原比/渲染比最大偏差：桌面 ${maxDev(d).toFixed(3)} / 390px ${maxDev(p).toFixed(3)}`);
  ok(dist(d).length === 0, `★ 桌面六张图都没被拉伸变形（最大偏差 ${maxDev(d).toFixed(3)}）`);
  ok(dist(p).length === 0, `★ 手机六张图都没被拉伸变形（最大偏差 ${maxDev(p).toFixed(3)}）`);
  ok(p.every(stacked),
     '★ 手机上同一排的两张改为上下两行（一张一行，不挤成两个小图）');
  ok(p.every(r => r.items.every(i => i.dxRow <= 2)),
     `★ 竖排时每张在行内左右居中（最大偏差 ${Math.max(...allItems(p).map(i => i.dxRow))}px）`);
  ok(allItems(s).every(i => i.dxRow <= 2),
     `320px 同样左右居中（最大偏差 ${Math.max(...allItems(s).map(i => i.dxRow))}px）`);

  console.log('\n── 9. 八面图里翻面后退出大图，要缩回「它自己那一面」的格子 ──');
  // ★ 这是一类反复出现的 bug：gridThumbForUrl() 的候选表漏掉某个 openModal 入口，
  //   那条入口翻面后关闭就会退化成 fallbackSrc（最初点进来的那张），落点错位。
  //   八面图浮层是最新漏掉的一类 —— 用户报告"翻面后退出大图，图片会回到错误的框内"。
  //   本节直接问 gridThumbForUrl：翻面后它指的落点，是不是八面图里那一张。
  await boot('notes/commemorative');
  idx = await openCard('KP04057');
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
    const faceUrl = currentModalSrc();
    const t = gridThumbForUrl(faceUrl);
    const clicked = document.querySelector('#octoLightbox .octo-face img');
    const ts = t ? (t.getAttribute('src') || '') : '';
    const face = (t && t.closest) ? t.closest('.octo-face') : null;
    const cap = face ? (face.querySelector('.octo-face-cap') || {}).textContent : '';
    return JSON.stringify({
      faceUrl: faceUrl,
      caption: Array.from(faceUrl.match(/KP04057-\\d+\\.jpg/) || [''])[0],
      side: currentModalSide,
      found: !!t,
      inGallery: !!(t && t.closest && t.closest('#octoLightbox')),
      // ★ 不用"src 与 faceUrl 相等"来判：gridThumbForUrl 内部会把缩略图形态也拿来做
      //   匹配，字面量比较会误判。改用两个跟匹配逻辑无关的语义判据 ——
      //   落点图的文件名尾号、以及它上面写的"正面/背面"。
      tail: (ts.match(/KP04057-\\d+\\.jpg/) || [''])[0],
      faceCap: cap,
      isClickedOne: t === clicked,
      visible: !!(t && t.getBoundingClientRect().width > 0)
    });
  })()`));
  console.log(`    点进去的是 ${(clickedSrc.match(/KP04057-\d+\.jpg/) || [''])[0]}，翻面后大图是 ${flip.caption}（第 ${flip.side} 面）`);
  console.log(`    gridThumbForUrl 指向：${flip.found ? (flip.inGallery ? '八面图内' : '八面图外') : '没找到'}`
    + `${flip.found ? `  ${flip.tail}（标注"${flip.faceCap}"）  是最初点的那张=${flip.isClickedOne}  有尺寸=${flip.visible}` : ''}`);
  ok(sideBefore === 1 && flip.side === 2, `确实翻到了背面（第 ${sideBefore} 面 → 第 ${flip.side} 面）`);
  ok(/KP04057-4\.jpg/.test(flip.faceUrl || ''), `翻面后大图是配对的那张（-3 → -4，实际 ${flip.caption}）`);
  ok(flip.found, '★ 翻了面也找得到缩回落点（不再退化成"最初点进来的那张"）');
  ok(flip.inGallery, '★ 落点在完整八面图浮层里（.octo-face img 已在候选表内）');
  ok(flip.tail === 'KP04057-4.jpg', `★ 落点就是翻到的那一面（-4，实际 ${flip.tail}）`);
  ok(flip.faceCap === '背面', `★ 落点上标的正是"背面"（实际 "${flip.faceCap}"）—— 不会飞着反面落进正面格子`);
  ok(!flip.isClickedOne, '★ 落点不是最初点的那张 —— 证明翻面确实换了格子');
  ok(flip.visible, '落点缩略图在视口内有真实尺寸（缩回动画真的会播）');

  console.log('\n── 10. 八面图的 URL 不泄漏进全字段搜索 ──');
  const leak = await evaluate(`(()=>{
    const before = (()=>{ performSearchAndRender('tong-xiangjie', 'all'); return prevSearchResults.length; })();
    performSearchAndRender('KP04057-3', 'all');
    const n = prevSearchResults.length;
    performSearchAndRender('jpg', 'all');
    const jpg = prevSearchResults.length;
    return JSON.stringify({ before, n, jpg });
  })()`);
  const L = JSON.parse(leak);
  console.log(`    搜「KP04057-3」→ ${L.n} 件；搜「jpg」→ ${L.jpg} 件`);
  ok(L.n === 0, '★ 八面图的文件路径搜不到（imgExtra 被 isSearchableField 排除）');

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { } try { child.kill(); } catch { } try { if (server) server.close(); } catch { }
  await sleep(300); process.exit(process.exitCode || 0);
}
