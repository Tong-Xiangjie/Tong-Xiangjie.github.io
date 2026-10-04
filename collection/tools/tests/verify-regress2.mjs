// 回归：历史记录 0 增长 + 手风琴 + 概览跳转，合并一次跑
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end(); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpX-'));
const DP = 9416;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const warns = [];
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(m.params.type)) warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0,110)); });

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/collection/` });
for (let i = 0; i < 220; i++) { await new Promise(r => setTimeout(r, 320)); try { if (await evaluate(`document.querySelectorAll('.search-result-item').length > 0 && typeof switchToCurrentContainer === 'function'`)) break; } catch (e) {} }

const r = await evaluate(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const startLen = history.length;
  const hashSteps = [];
  const rec = () => hashSteps.push(location.hash);

  // ---- A. 侧边栏逐行开关手风琴（每条都点开、再收起）----
  let rowsTested = 0; const rowBad = [];
  const entries = [...document.querySelectorAll('.sidebar [onclick]')].filter(e => /onSidebarItemClick|onSidebarChildClick/.test(e.getAttribute('onclick')||''));
  for (const el of entries) {
    const label = (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,14);
    el.click(); await sleep(330);
    const c = getRenderContainer();
    for (const h of [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'))) {
      const body = h.parentNode.querySelector('.series-body');
      if (!body) continue;
      if (body.classList.contains('open')) { h.click(); await sleep(25); }
      const before = Math.round(body.getBoundingClientRect().height);
      h.click(); await sleep(300);
      const after = Math.round(body.getBoundingClientRect().height);
      rowsTested++;
      if (after <= before) rowBad.push({ label, before, after });
      // 顺便验证"展开时地址栏带 s、收起后去掉"
      const openNow = body.classList.contains('open');
      if (openNow && !/\\/s\\d+/.test(location.hash)) rowBad.push({ label, why: '展开但 hash 无 s', hash: location.hash });
      h.click(); await sleep(260);      // 收起，保持干净状态进入下一行
      if (/\\/s\\d+/.test(location.hash)) rowBad.push({ label, why: '收起后 hash 仍有 s', hash: location.hash });
    }
    rec();
  }

  // ---- B. 概览跳转全部数据源 ----
  let ovTested = 0; const ovBad = [];
  for (const mode of ['notes','coins']) {
    const map = mode==='notes' ? window.DATA_MAP : window.COIN_DATA_MAP;
    for (const dataKey of Object.keys(map)) {
      if (!map[dataKey] || !map[dataKey].series) continue;
      currentMode=mode; isSettingsMode=false; currentView='overview'; currentCategoryId=null; currentSubId=null;
      switchToCurrentContainer(); renderOverview(); await sleep(150);
      const t=[...document.querySelectorAll('.search-result-item')].find(el=>(el.getAttribute('onclick')||'').includes("'"+dataKey+"', 0,"));
      if(!t) continue;
      t.click(); await sleep(620);
      const c=getRenderContainer(); const b=c.querySelector('.series-body');
      if(!b){ovBad.push({dataKey,why:'无body'});continue;}
      ovTested++;
      if(b.getBoundingClientRect().height<=0||b.scrollHeight<=0) ovBad.push({mode,dataKey,h:Math.round(b.getBoundingClientRect().height),sh:b.scrollHeight});
      rec();
    }
  }

  // ---- C. 搜索连续输入 ----
  const sInput = document.getElementById('searchInput');
  for (const kw of ['人民','人民币','人民币五']) { sInput.value=kw; doSearch({replace:true}); await sleep(600); rec(); }

  // ---- D. 切板块 ----
  onTabClick('coins'); await sleep(500); rec();
  onTabClick('notes'); await sleep(700); rec();
  onTabClick('special'); await sleep(600); rec();
  onTabClick('notes'); await sleep(700); rec();

  return { startLen, endLen: history.length, hashSteps, rowsTested, rowBad,
           ovTested, ovBad, finalHash: location.hash };
})()`);

let fail = 0;
console.log(`A. 侧边栏逐行开关：${r.rowsTested} 行，问题 ${r.rowBad.length}`);
for (const b of r.rowBad.slice(0,8)) { console.log('   ✗ ' + JSON.stringify(b)); fail++; }
console.log(`B. 概览跳转：${r.ovTested} 个数据源，失败 ${r.ovBad.length}`);
for (const b of r.ovBad.slice(0,6)) { console.log('   ✗ ' + JSON.stringify(b)); fail++; }
console.log(`C. 历史记录：起始 ${r.startLen} → 结束 ${r.endLen}（增长 ${r.endLen - r.startLen}，应为 0）`);
if (r.endLen !== r.startLen) fail++;
console.log(`D. 地址栏共更新 ${new Set(r.hashSteps).size} 种不同 hash（说明确实在跟随）`);
console.log('');
console.log(fail === 0 ? '🟢 全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0,6).join(' | ') : '（无）'));
ws.close(); child.kill(); server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
