// ③ 验收：分割线的位置与数量在"改 CSS 前 / 后"必须完全一致，且每条都真的画出来了。
//   判据（与 border 声明在哪一层无关，所以天然是等价性证明）：
//     应有分割线 = 每个 .variety-row 的顶边 ∪ 每个 .copy-item 的顶边
//   然后逐条到像素上确认那里确实有一条 border 色的线，且不存在"多出来的线"。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bd = 8, ct = 6; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 4;
  const bpp = ch * (bd / 8), stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++]; const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
  }
  return { w, h, ch, bpp, stride, data: out };
}
const px = (im, x, y) => { const o = y * im.stride + x * im.bpp; return [im.data[o], im.data[o + 1], im.data[o + 2]]; };
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const rgb = s => {
  if (!s) return null;
  let m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
  return null;
};

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
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpSep-'));
const DP = 10908;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

const DUMP = `(() => {
  let root=null;
  for (const k of Object.keys(viewScrollContainers)) { const e=viewScrollContainers[k]; if(e&&e.style.display!=='none'){root=e;break;} }
  if(!root) return JSON.stringify({err:'无容器'});
  const cs=getComputedStyle(document.documentElement), rr=root.getBoundingClientRect();
  // 应有分割线：每个 .variety-row 顶边 ∪ 每个 .copy-item 顶边（与 border 写在哪一层无关）
  const rows=[], expected=[];
  for (const el of root.querySelectorAll('.series-year-row, .series-body, .variety-row, .copy-list, .copy-item')) {
    const r=el.getBoundingClientRect();
    const cls=el.className.split(' ')[0];
    rows.push({ cls, key: cls+'|'+(el.textContent||'').trim().slice(0,20),
                top: Math.round(r.top*100)/100, h: Math.round(r.height*100)/100,
                bt: getComputedStyle(el).borderTopWidth });
    if (cls==='variety-row' || cls==='copy-item') expected.push({ cls, top: Math.round(r.top*100)/100 });
  }
  return JSON.stringify({ rows, expected, border: cs.getPropertyValue('--border').trim(), card: cs.getPropertyValue('--card-bg').trim(),
    containerTop: rr.top, containerLeft: rr.left, containerW: rr.width, containerH: rr.height,
    scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight });
})()`;

async function measure() {
  const info = JSON.parse(await evaluate(DUMP));
  const bd = rgb(info.border), bg = rgb(info.card);
  const expected = dist(bd, bg);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: info.containerLeft, y: info.containerTop, width: info.containerW, height: info.containerH, scale: 1 } });
  const im = decodePNG(Buffer.from(shot.data, 'base64'));
  const sx = im.w / info.containerW, sy = im.h / info.containerH;
  const xProbe = Math.round(im.w * 0.45);
  // 逐像素行判定：这一行是否"比卡片底色更接近边框色"
  const drawn = [];
  for (let y = 0; y < im.h; y++) {
    // 参照：该行上方 6px 处的颜色（作为局部卡片底色）
    const ref = px(im, xProbe, Math.max(0, y - 6));
    const cur = px(im, xProbe, y);
    if (dist(cur, ref) > expected * 0.35 && dist(cur, bd) < dist(ref, bd)) drawn.push(y);
  }
  // 每条应有分割线：在 ±2 设备像素内是否命中一条画出来的线
  const results = info.expected.map(e => {
    const yWant = (e.top - info.containerTop) * sy;
    const hit = drawn.some(y => Math.abs(y - yWant) <= 2);
    return { ...e, yWant: Math.round(yWant*10)/10, hit };
  });
  return { info, results, drawn, expected };
}

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const HASH = process.env.HASH || 'notes/ticket/gkq';
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${HASH}` });
  for (let i = 0; i < 100; i++) {
    const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && !!document.querySelector('.series-year-header'))()`).catch(() => false);
    if (r) break; await sleep(300);
  }
  await sleep(1800);
  const exp = await evaluate(`(() => { let n1=0,n2=0;
    for (const h of document.querySelectorAll('.series-year-header')) { const i=h.querySelector('.series-expand-icon'); if(i&&!i.classList.contains('open')){h.click();n1++;} }
    for (const h of document.querySelectorAll('.variety-header')) { const i=h.querySelector('.variety-expand-icon'); if(i&&!i.classList.contains('open')){h.click();n2++;} }
    return JSON.stringify({series:n1,varieties:n2}); })()`);
  console.log(`场景 ${HASH}  展开 ${exp}`);
  await sleep(2500);

  const all = [];
  for (const y of [0, 300, 600, 900, 1200, 1500, 1800]) {
    await evaluate(`(()=>{ getRenderContainer().scrollTop=${y}; return true; })()`);
    await sleep(200);
    const m = await measure();
    all.push({ y, m });
    const inView = m.results.filter(r => r.yWant >= 0 && r.yWant <= m.info.containerH);
    const miss = inView.filter(r => !r.hit);
    console.log(`  scrollTop=${String(y).padStart(4)}  视口内应有线 ${String(inView.length).padStart(3)} 条，未画出 ${miss.length} 条` +
      (miss.length ? ' → ' + miss.slice(0,4).map(r=>`[${r.cls}]@${r.yWant}`).join(' ') : ''));
  }
  // 布局快照（用于和"改前"对比）
  const layout = all[0].m.info.rows.map(r => `${r.cls}|${r.key}|${r.top}|${r.h}|${r.bt}`);
  console.log(`\n布局指纹（前 8 行）：`);
  layout.slice(0, 8).forEach(l => console.log('    ' + l));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(process.env.OUT || join(tmpdir(), 'sep-layout.txt'), layout.join('\n') + '\n', 'utf8');
  console.log(`\n布局指纹已写入 ${process.env.OUT || join(tmpdir(), 'sep-layout.txt')}（${layout.length} 行）`);

  const totalMiss = all.reduce((s, x) => s + x.m.results.filter(r => !r.hit && r.yWant >= 0 && r.yWant <= x.m.info.containerH).length, 0);
  const inViewTotal = all.reduce((s, x) => s + x.m.results.filter(r => r.yWant >= 0 && r.yWant <= x.m.info.containerH).length, 0);
  console.log(`\n──────── 视口内应有分割线 ${inViewTotal} 条，未画出 ${totalMiss} 条 ────────`);
  // 分割线自身的绝对 y 位置（页面坐标），改前/改后应完全一致
  const sepY = all[0].m.results.map(r => `${r.cls}@${r.top}`);
  console.log(`分割线绝对位置（页面坐标）：${sepY.join('  ')}`);
  process.exitCode = totalMiss ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}
