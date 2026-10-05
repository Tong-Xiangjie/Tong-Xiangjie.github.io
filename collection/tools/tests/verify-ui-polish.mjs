// 三处界面细节的验证（已进仓库：collection/tools/tests）：
//   ①「详细信息」鼠标悬停不要下划线
//   ② 山河地图白天模式下，悬停省份的省名要有黑色描边
//   ③ 文章正文的表头在黑夜模式下要看得清（表头不能是白底/浅底）
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('══════ ① 静态：三处样式都在 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8');
const hoverRule = css.match(/\.copy-detail-link:hover[^{]*\{[^}]*\}/);
ok(!hoverRule, '① .copy-detail-link:hover 那条下划线规则已删除');
ok(/@media[^{]*\{[^@]*copy-detail-link:hover/.test(css) === false, '① 也没有藏在 media query 里的同类规则');
ok(/\.copy-detail-link\s*\{[^}]*cursor:\s*pointer/.test(css), '① 链接本身仍是 cursor: pointer（可点性没丢）');
const activeRule = css.match(/\.shanhe-map-wrap \.shanhe-label\.active \{[^}]*\}/);
ok(!!activeRule && /stroke:\s*#000/.test(activeRule[0]), '② 白天模式的 .active 标签描边是 #000');
ok(/\.shanhe-map-wrap \.shanhe-label\.active \.shanhe-label-count \{[^}]*stroke:\s*#000/.test(css), '② 省名后面的计数数字也跟着用黑描边');
ok(/html\[data-color-scheme="dark"\] \.shanhe-map-wrap \.shanhe-label\.active \{[^}]*stroke:\s*var\(--bg\)/.test(css), '② 深色模式维持原来的 --bg 描边（没被改坏）');
ok(/\.article-reader table th \{[^}]*background-color:\s*var\(--bg-light\)/.test(css), '③ 文章表头底色改走 --bg-light');
ok(/\.article-reader table\[border\] th/.test(css), '③ 只给带 border 属性的表格换框线（不凭空加线）');
ok(/html\[data-color-scheme="dark"\] \.article-reader table td\[style\*="background-color"\]/.test(css), '③ 只有 <td> 写死底色的少数情况用深色专用兜底');

// ─────────── 起服务 + 无头浏览器 ───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpUP-'));
const DP = 11800 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const moveMouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', buttons: 0, clickCount: 0 });
await send('Runtime.enable');
await send('Page.enable');
async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(700);
}
async function setScheme(mode) {
  await evaluate(`(()=>{ if (typeof setColorSchemeMode === 'function') setColorSchemeMode(${JSON.stringify(mode)}); else document.documentElement.setAttribute('data-color-scheme', ${JSON.stringify(mode)}); return 1; })()`);
  await sleep(400);
  return evaluate(`document.documentElement.getAttribute('data-color-scheme')`);
}

// ─────────── ① 真实悬停：详细信息不要下划线 ───────────
console.log('\n══════ ① 「详细信息」悬停 ══════\n');
await boot('notes/rmb/rmb3');
const cssom = JSON.parse(await evaluate(`(()=>{
  const hits = [];
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (const r of rules) {
      if (r.selectorText && /copy-detail-link/.test(r.selectorText) && /:hover|:focus|:active/.test(r.selectorText)) {
        hits.push(r.selectorText + ' { ' + r.style.cssText + ' }');
      }
    }
  }
  return JSON.stringify(hits);
})()`));
ok(cssom.filter(h => /text-decoration/.test(h)).length === 0,
   `① 运行时样式表里没有任何带 text-decoration 的悬停规则（${cssom.length} 条悬停规则，内容：${cssom.join(' ; ') || '无'}）`);
const linkInfo = JSON.parse(await evaluate(`(()=>{
  const el = document.querySelector('.copy-detail-link');
  if (!el) return JSON.stringify({ none: true });
  const row = el.closest('tr, .copy-row, .copy-item, .copy-info, .copy-card') || el.parentElement;
  const r = el.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  return JSON.stringify({ text: el.textContent.trim(), box: { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height },
    rowBox: { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2, w: rr.width, h: rr.height } });
})()`));
ok(!linkInfo.none, `① 页面上找到了「${linkInfo.text || '详细信息'}」这个可点文字`);
if (!linkInfo.none) {
  // 有的行要先把鼠标放到行上才显示这个链接，所以先移到行，再移到链接本身
  if (linkInfo.box.w < 4 || linkInfo.box.h < 4) { await moveMouse(linkInfo.rowBox.x, linkInfo.rowBox.y); await sleep(350); }
  const fresh = JSON.parse(await evaluate(`(()=>{ const el = document.querySelector('.copy-detail-link'); const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); })()`));
  ok(fresh.w >= 4 && fresh.h >= 4, `① 链接在悬停后是可见的（${Math.round(fresh.w)}×${Math.round(fresh.h)}）`);
  await moveMouse(fresh.x, fresh.y);
  await sleep(450);
  let hov = JSON.parse(await evaluate(`(()=>{ const el = document.querySelector('.copy-detail-link'); const cs = getComputedStyle(el);
    return JSON.stringify({ hovered: el.matches(':hover'), deco: cs.textDecorationLine, cursor: cs.cursor, color: cs.color }); })()`));
  if (!hov.hovered) {
    // headless 里真鼠标常常落不上（悬停后行内布局会变），改用 CDP 强制 :hover
    await send('DOM.enable');
    await send('CSS.enable');
    const doc = await send('DOM.getDocument', { depth: 1 });
    const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.copy-detail-link' });
    if (q && q.nodeId) {
      await send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: ['hover'] });
      await sleep(300);
      hov = JSON.parse(await evaluate(`(()=>{ const el = document.querySelector('.copy-detail-link'); const cs = getComputedStyle(el);
        return JSON.stringify({ hovered: el.matches(':hover'), deco: cs.textDecorationLine, cursor: cs.cursor, color: cs.color, forced: true }); })()`));
      console.log('      （真鼠标没落上，改用 CDP 强制 :hover —— headless 下更可靠）');
    }
  }
  ok(hov.hovered === true || hov.forced === true, `① 悬停状态确实生效（${hov.forced ? 'CDP 强制' : '真实鼠标'} :hover）`);
  ok(hov.deco === 'none', `★ 悬停时没有下划线（text-decoration-line = ${hov.deco}）`);
  ok(hov.cursor === 'pointer', `① 仍是手型光标（${hov.cursor}），可点性没丢`);
}

// ─────────── ② 山河地图：悬停省份的省名描边 ───────────
console.log('\n══════ ② 山河地图：悬停省份 ══════\n');
await boot('notes');
const sid = await evaluate(`(()=>{
  const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
  const hit = t.find(c => /山河/.test(c.name || '')) || t[0];
  if (!hit) return '';
  if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
  return hit.id;
})()`);
ok(!!sid, `进入山河专题（${sid || '没找到'}）`);
let mapOk = false;
for (let i = 0; i < 40; i++) {
  mapOk = await evaluate(`document.querySelectorAll('.shanhe-map-wrap .state[data-count]').length > 0 && document.querySelectorAll('.shanhe-map-wrap .shanhe-label').length > 0`).catch(() => false);
  if (mapOk) break;
  await sleep(300);
}
ok(mapOk, '山河地图与省名标签都渲染出来了');
if (mapOk) {
  // 找一个"能点到的"省：在它的 bbox 里扫一个点，确保 elementFromPoint 命中它
  const probe = JSON.parse(await evaluate(`(()=>{
    const svg = document.querySelector('.shanhe-map-wrap svg') || document.querySelector('svg');
    const states = [...document.querySelectorAll('.shanhe-map-wrap .state[data-count]')];
    for (const el of states) {
      let b; try { b = el.getBBox(); } catch (e) { continue; }
      if (!b || b.width < 8 || b.height < 8) continue;
      const pt = svg.createSVGPoint();
      for (let ix = 1; ix <= 5; ix++) for (let iy = 1; iy <= 5; iy++) {
        const sx = b.x + b.width * ix / 6, sy = b.y + b.height * iy / 6;
        pt.x = sx; pt.y = sy;
        const sp = pt.matrixTransform(el.getScreenCTM());
        if (sp.x < 4 || sp.y < 4 || sp.x > innerWidth - 4 || sp.y > innerHeight - 4) continue;
        const hit = document.elementFromPoint(sp.x, sp.y);
        if (hit === el || (hit && hit.closest && hit.closest('.state') === el)) {
          return JSON.stringify({ pid: el.getAttribute('data-pid'), name: (el.getAttribute('class')||''), x: sp.x, y: sp.y });
        }
      }
    }
    return JSON.stringify(null);
  })()`));
  if (!probe) { ok(false, '没找到可悬停的省份取样点'); }
  else {
    await setScheme('light');
    await moveMouse(probe.x, probe.y);
    await sleep(400);
    const light = JSON.parse(await evaluate(`(()=>{
      const t = document.querySelector('.shanhe-map-wrap .shanhe-label.active');
      if (!t) return JSON.stringify({ none: true });
      const cs = getComputedStyle(t);
      return JSON.stringify({ text: t.textContent.trim(), stroke: cs.stroke, fill: cs.fill, sw: cs.strokeWidth, po: cs.paintOrder,
        bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() });
    })()`));
    ok(!light.none, `白天模式悬停省「${probe.pid}」后标签进入 .active（${light.text || ''}）`);
    if (!light.none) {
      ok(light.stroke === 'rgb(0, 0, 0)', `★ 省名描边是黑色（stroke = ${light.stroke}，修复前是白天的 --bg 浅色 ${light.bg}）`);
      ok(light.fill === 'rgb(255, 255, 255)', `字本身仍是白色（fill = ${light.fill}）`);
      ok(/^stroke/.test(light.po), `描边画在文字下面（paint-order = ${light.po}），不会糊住笔画`);
    }
    // 深色模式不能受影响：描边回到 --bg
    await setScheme('dark');
    await moveMouse(0, 0);
    await sleep(200);
    await moveMouse(probe.x, probe.y);
    await sleep(400);
    const dark = JSON.parse(await evaluate(`(()=>{
      const t = document.querySelector('.shanhe-map-wrap .shanhe-label.active');
      if (!t) return JSON.stringify({ none: true });
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const probeEl = document.createElement('div');
      probeEl.style.color = bg; document.body.appendChild(probeEl);
      const rgb = getComputedStyle(probeEl).color; probeEl.remove();
      return JSON.stringify({ stroke: getComputedStyle(t).stroke, bgVar: bg, bgRgb: rgb });
    })()`));
    ok(!dark.none && dark.stroke !== 'rgb(0, 0, 0)', `深色模式下描边不是黑色（${dark.stroke}），维持原样`);
    ok(!dark.none && dark.stroke === dark.bgRgb, `深色描边等于 --bg（${dark.bgVar} → ${dark.bgRgb}）`);
    await setScheme('light');
  }
}

// ─────────── ③ 文章表头在黑夜模式下看得清 ───────────
console.log('\n══════ ③ 文章表头（黑夜模式）══════\n');
const txt = await readFile('notecollection/readmes/amsx_2020.html', 'utf8').catch(() => '');
ok(/<table[^>]*border="1"/.test(txt) && /<th>/.test(txt), '① 找到「鼠年生肖贺岁钞」那张表的原始 HTML');
await boot('notes');
await setScheme('dark');
const art = JSON.parse(await evaluate(`(async () => {
  // 用页面里真实的 .article-reader 容器 + 文章真实内容（所测 CSS 与线上完全同一套）
  const html = ${JSON.stringify(txt)};
  let host = document.querySelector('.article-reader');
  if (!host) { host = document.createElement('div'); host.className = 'article-reader'; document.body.appendChild(host); }
  host.innerHTML = html;
  await new Promise(r => setTimeout(r, 250));
  const tbl = host.querySelector('table');
  if (!tbl) return JSON.stringify({ none: true });
  const th = tbl.querySelector('th');
  const tr = tbl.querySelector('thead tr') || tbl.querySelector('tr');
  const td = tbl.querySelector('tbody td') || tbl.querySelector('td');
  const lum = (c) => { const m = c.match(/\\d+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(m[0]) + 0.7152*f(m[1]) + 0.0722*f(m[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2); return (hi + 0.05) / (lo + 0.05); };
  const csTh = getComputedStyle(th), csTd = getComputedStyle(td);
  const inlineRowBg = tr.getAttribute('style') || '';
  const raw = inlineRowBg.match(/background-color:\\s*([^;]+)/);
  const rawBg = raw ? raw[1].trim() : '';
  const resolve = (v) => { const p = document.createElement('div'); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const root = getComputedStyle(document.documentElement);
  const rawRgb = resolve(rawBg || '#f5f7fa');
  const varBgLight = resolve(root.getPropertyValue('--bg-light').trim() || '#1a1e25');
  const varBorder = resolve(root.getPropertyValue('--border').trim() || '#2c313a');
  return JSON.stringify({
    thBg: csTh.backgroundColor, thColor: csTh.color, thBorder: csTh.borderTopColor,
    tdBg: csTd.backgroundColor, tdColor: csTd.color,
    rowInlineBg: rawBg, rowInlineRgb: rawRgb, varBgLight: varBgLight, varBorder: varBorder,
    ratioBefore: ratio(csTh.color, rawRgb), ratioAfter: ratio(csTh.color, csTh.backgroundColor),
    rows: tbl.querySelectorAll('tbody tr').length, ths: tbl.querySelectorAll('th').length
  });
})()`));
if (art.none) { ok(false, '页面上没找到 table'); }
else {
  ok(art.ths === 2 && art.rows >= 3, `表格结构正常（${art.ths} 个表头、${art.rows} 行数据）`);
  ok(art.rowInlineBg !== '', `内容里的表头底色确实是写死的（<tr style="background-color: ${art.rowInlineBg}">）`);
  ok(art.thBg === art.varBgLight, `★ 黑夜模式下表头底色 = 主题 --bg-light（${art.thBg}），不再是那个近白的 ${art.rowInlineRgb}`);
  ok(art.thBg !== art.rowInlineRgb, '★ 表头 cell 的底色盖住了 tr 上写死的那一条（所以不用 !important）');
  ok(art.ratioBefore < 1.5, `修复前白字压近白底：对比度只有 ${art.ratioBefore.toFixed(2)}:1（＝看不清）`);
  ok(art.ratioAfter >= 4.5, `★ 修复后对比度 ${art.ratioAfter.toFixed(2)}:1（正文标准 4.5:1）`);
  ok(art.tdColor === 'rgb(232, 234, 237)' && art.thColor === 'rgb(232, 234, 237)', `表头和数据文字都是主题字色（${art.thColor}）`);
  ok(art.thBorder === art.varBorder, `框线走 --border（${art.thBorder}），不是白色`);
  ok(art.ratioAfter >= 4.5 && art.tdBg === 'rgba(0, 0, 0, 0)', `数据行底色仍是透明（跟着正文底走，${art.tdBg}）`);
}
await setScheme('light');

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
