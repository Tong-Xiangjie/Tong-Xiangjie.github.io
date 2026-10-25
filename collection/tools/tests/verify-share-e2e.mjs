#!/usr/bin/env node
// ============================================================================
// verify-share-e2e.mjs —— 分享链接的端到端回归（真跑无头 Chrome + CDP，全离线）
//
// 单独跑：
//     $env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
//     node collection/tools/tests/verify-share-e2e.mjs
// 或走 runner：node collection/tools/tests/run.mjs --only share
//
// 为什么必须有它：分享那一套守卫（范围判定、灰化锁定、快捷键拦截、被挡页面、
// 退出分享模式）光靠"读源码断言"测不出来 —— 这一轮的 bug 全是运行时才暴露的：
//   · 守卫写在 run() 走不到的位置 ⇒ 代码在、行为没变；
//   · window 上的 hashchange 不区分捕获/冒泡 ⇒ 被 router.js 抢先归一化；
//   · 改 fragment 时 popstate 先于 hashchange ⇒ 只挂 hashchange 漏掉 #settings；
//   · 退出分享模式只 reload ⇒ 令牌分支原样再放行一次，退不出去。
//
// ★ 服务器必须以**仓库根**为根：config.js / coin-config.js 里的数据路径是
//   '../notecollection/data/xxx.js'、'../coincollection/...' 这种跨目录写法，
//   只服务 collection/ 的话它们全部 403，而脚本加载失败**不报错**，页面就停在
//   「啥都木有」（本地跑这个用例时"分类内容不渲染"的真正原因）。
//   故意绑 127.0.0.2 而不是 127.0.0.1/localhost：gate.js 对后者内置放行，测不到门禁。
//
// 顺带量收件人的实际下载量（收尾那行 [weight]）：现在分享页固定加载 100 个脚本、
// 约 2.0MB JS、3.5MB 总量，其中 data 目录约 595KB —— 而收件人只需要分享范围那部分。
//
// 退出码：0 = 全部通过；1 = 有断言失败；2 = 环境问题。
// ============================================================================
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const COLLECTION = join(ROOT, 'collection');
const HOST = '127.0.0.2';
const PAGE = '/collection/index.html';

let pass = 0, fail = 0;
const check = (label, ok, extra) => {
    if (ok) { pass++; console.log('  PASS ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra ? '   [' + extra + ']' : '')); }
};

function resolveChrome() {
    const cands = [
        process.env.CHROME_PATH,
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    return cands.find(p => p && existsSync(p)) || '';
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

function startServer() {
    const server = createServer((req, res) => {
        let p = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
        if (p === '/' || p === '') p = PAGE;
        const file = normalize(join(ROOT, p));
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        try {
            const body = readFileSync(file);
            res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
            res.end(body);
        } catch (e) {
            console.log('  [server 404] ' + p);
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
        }
    });
    return new Promise(ok => server.listen(0, HOST, () => ok({ server, port: server.address().port })));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// L2 令牌 = base64url(payload)，纯静态、无需签名（见 share-core.js 的说明）。
function mint(scope, allowSel, ms) {
    const payload = { p: scope, e: Date.now() + ms, s: Date.now(), i: 'e2e' };
    if (allowSel) payload.a = allowSel;
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

async function main() {
    const chromePath = resolveChrome();
    if (!chromePath) { console.log('no Chrome (set CHROME_PATH)'); process.exit(2); }
    if (typeof WebSocket !== 'function') { console.log('need Node 22+ (global WebSocket)'); process.exit(2); }

    const gateSrc = readFileSync(join(COLLECTION, 'gate.js'), 'utf8');
    const adminMark = (/GATE_HASHES = \[[\s\S]*?'([0-9a-f]{16})/.exec(gateSrc) || [])[1];
    if (!adminMark) { console.log('cannot read admin mark from GATE_HASHES[0]'); process.exit(2); }

    const { server, port } = await startServer();
    const profile = mkdtempSync(join(tmpdir(), 'share-e2e-'));
    const dbgPort = 9500 + Math.floor(Math.random() * 400);
    const chrome = spawn(chromePath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: 'ignore' });

    const cleanup = () => { try { chrome.kill(); } catch (e) { } try { server.close(); } catch (e) { } try { rmSync(profile, { recursive: true, force: true }); } catch (e) { } };
    process.on('exit', cleanup);

    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
        try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { }
        if (!target) await sleep(400);
    }
    if (!target) { console.log('cannot reach headless Chrome devtools port'); process.exit(2); }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let msgId = 0; const pending = new Map();
    const send = (method, params) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    await new Promise(r => ws.addEventListener('open', r));
    await send('Page.enable');
    await send('Runtime.enable');

    const evalJs = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) return null;
        return r.result && r.result.result ? r.result.result.value : null;
    };
    const TOK = mint('notes/commemorative', 's1,6', 3600 * 1000);
    const url = (n, hash) => `http://${HOST}:${port}${PAGE}?share=${TOK}&_=${n}${hash === '' ? '' : '#' + hash}`;

    const settle = async (ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            const v = await evalJs("document.documentElement.classList.contains('gate-ok') ? 'ok' : (String(document.title)==='分享链接失效' ? 'deny' : 'wait')");
            if (v === 'ok' || v === 'deny') {
                if (v === 'ok') await sleep(1500);   // 放行后还要等灰化安装 + 应用渲染
                return v;
            }
            await sleep(150);
        }
        return 'timeout';
    };
    const waitFor = async (expr, ms = 8000) => {
        const t0 = Date.now(); let v = null;
        while (Date.now() - t0 < ms) { v = await evalJs(expr); if (v) return v; await sleep(200); }
        return v;
    };
    const verdict = () => evalJs("document.documentElement.classList.contains('gate-ok') ? 'allow' : (String(document.title)==='分享链接失效' ? 'deny' : '??')");
    const load = async (n, hash) => { await send('Page.navigate', { url: url(n, hash) }); await settle(); return verdict(); };
    const inPage = async (n, hash) => {
        await send('Page.navigate', { url: url(n, 'notes/commemorative') });
        if (await settle() !== 'ok') return 'bad-start';
        await evalJs(`location.hash = '#${hash}'`);
        await sleep(1200); await settle(6000);
        return verdict();
    };
    const hotkey = async (mods = 10) => {                 // 10 = Ctrl+Shift，9 = Alt+Shift
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: mods, windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, code: 'KeyS', key: 'S' });
        await sleep(120);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mods, windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, code: 'KeyS', key: 'S' });
        await sleep(900);
    };
    const closeShareDialog = () => evalJs("(()=>{const b=document.querySelector('#shareClose'); if(b) b.click(); return true;})()");
    const mark = () => evalJs(`localStorage.setItem('collection-gate', '${adminMark}')`);
    const unmark = () => evalJs("localStorage.removeItem('collection-gate'); sessionStorage.clear()");

    let n = 1;
    console.log('=== 1. load path ===');
    for (const [hash, want] of [
        ['notes/commemorative', 'allow'], ['notes/commemorative/s1', 'allow'], ['notes/commemorative/s1,6', 'allow'],
        ['', 'allow'], ['wechat_redirect', 'allow'],
        ['notes/commemorative/s3', 'deny'], ['notes/commemorative/s0', 'deny'], ['settings', 'deny'],
        ['settings/anything', 'deny'], ['coins', 'deny'], ['notes/rmb3', 'deny'], ['nonsense', 'deny']
    ]) check(`load #${hash || '(empty)'} => ${want}`, (await load(n++, hash)) === want);

    console.log('=== 2. in-page hash edit (fresh SPA each time) ===');
    for (const [hash, want] of [
        ['notes/commemorative/s1', 'allow'], ['notes/commemorative/s1,6', 'allow'], ['notes/commemorative', 'allow'],
        ['', 'allow'], ['wechat_redirect', 'allow'],
        ['notes/commemorative/s3', 'deny'], ['settings', 'deny'], ['settings/anything', 'deny'],
        ['coins', 'deny'], ['notes/rmb3', 'deny'], ['nonsense', 'deny']
    ]) check(`in-page #${hash || '(empty)'} => ${want}`, (await inPage(n++, hash)) === want);

    console.log('=== 3. greying / not-clickable (real hit test) ===');
    await load(n++, 'notes/commemorative');
    check('category view rendered (sidebar + series headers)',
        (await waitFor("document.querySelectorAll('.sidebar').length>0 && document.querySelectorAll('.series-year-header').length>0", 12000)) === true,
        'series=' + await evalJs("document.querySelectorAll('.series-year-header').length"));
    await waitFor("document.querySelectorAll('.gate-share-locked').length>100", 12000);
    const locked = await evalJs("document.querySelectorAll('.gate-share-locked').length");
    check('out-of-scope entries locked (>100)', locked > 100, 'locked=' + locked);
    const series = await evalJs("[document.querySelectorAll('.series-year-header.gate-share-locked').length, document.querySelectorAll('.series-year-header[onclick]:not(.gate-share-locked)').length].join('/')");
    check('series headers 21 grey / 2 open', series === '21/2', series);
    const openKeys = await evalJs("[...document.querySelectorAll('.series-year-header[onclick]:not(.gate-share-locked)')].map(h=>(h.getAttribute('onclick').match(/-(?:s|v)(\\d+)/)||[])[1]).sort().join(',')");
    check('the 2 open ones are exactly s1,s6', openKeys === '1,6', openKeys);
    check('locked series header is not hit-testable', (await evalJs("(()=>{const h=document.querySelector('.series-year-header.gate-share-locked');h.scrollIntoView({block:'center'});const r=h.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)!==h;})()")) === true);
    check('locked entry is visually greyed (opacity + grayscale + pointer-events)',
        (await evalJs("(()=>{const h=document.querySelector('.series-year-header.gate-share-locked');const s=getComputedStyle(h);return s.pointerEvents==='none' && Number(s.opacity)<0.5 && /grayscale/.test(s.filter);})()")) === true);
    check('copy detail rows sit inside a locked container',
        (await evalJs("(()=>{const l=document.querySelector('.copy-detail-link');return !!l && l.closest('.gate-share-locked')!==null;})()")) === true);
    check('locked sidebar item is not hit-testable',
        (await evalJs("(()=>{const s=document.querySelector('.sidebar-item.gate-share-locked');if(!s)return 'none';s.scrollIntoView({block:'center'});const r=s.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)!==s;})()")) === true);
    check('share page title is fixed', (await evalJs('document.title')) === '铜の币纪主站 | 来自分享');
    // 体积：收件人其实只需要分享范围那部分数据，这里把"现在到底加载了多少"量出来。
    const weight = await evalJs(`(() => {
        const rs = performance.getEntriesByType('resource');
        let scripts = 0, scriptBytes = 0, allBytes = 0, js = 0;
        for (const r of rs) {
            const b = r.decodedBodySize || 0;
            allBytes += b;
            if (/\\.js(\\?|$)/.test(r.name)) { scripts++; scriptBytes += b; }
            if (r.name.indexOf('/notecollection/data/') >= 0 || r.name.indexOf('/coincollection/data/') >= 0) js += b;
        }
        return [scripts, Math.round(scriptBytes/1024), Math.round(allBytes/1024), Math.round(js/1024)].join('/');
    })()`);
    console.log('  [weight] scripts/JS-KB/all-KB/data-KB = ' + weight);

    // 分享模式"只加载该范围的数据"：数据脚本是 data-loader.js 动态注入的，
    // 它在分享模式下直接不下范围外的文件。这里按**语义**断言（而不是比数字）：
    // 页面里所有 /data/ 脚本都必须命中本范围的分类名/板块名。
    const fullDataCount = ['config.js', 'coin-config.js', 'special-bridge.js']
        .reduce((acc, f) => acc + ((readFileSync(join(COLLECTION, f), 'utf8').match(/dataFile\s*:/g) || []).length), 0);
    await load(n++, 'notes/commemorative');
    await waitFor("document.querySelectorAll('.gate-share-locked').length>100", 12000);
    const dataSrcs = await evalJs("[...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')||'').filter(u=>u.indexOf('/data/')>=0)");
    const outside = (dataSrcs || []).filter(u => !/commemorative|notes/.test(u.toLowerCase()));
    check('分享页里有数据文件（裁剪没裁过头）', (dataSrcs || []).length > 0, 'data=' + (dataSrcs || []).length + ' full=' + fullDataCount);
    check('分享模式没有下载范围外的数据文件', outside.length === 0, JSON.stringify(outside.slice(0, 3)));
    check('数据文件数量确实少于全量', (dataSrcs || []).length < fullDataCount, 'now=' + (dataSrcs || []).length + ' full=' + fullDataCount);
    check('裁剪之后页面仍然正常渲染（21 灰 / 2 亮）',
        (await evalJs("[document.querySelectorAll('.series-year-header.gate-share-locked').length, document.querySelectorAll('.series-year-header[onclick]:not(.gate-share-locked)').length].join('/')")) === '21/2');

    console.log('=== 4. admin vs share isolation ===');
    await mark();
    check('admin on share link is still scoped', (await load(n++, 'notes/commemorative')) === 'allow' && (await evalJs("document.querySelectorAll('.gate-share-locked').length")) > 100);
    check('admin sees the persistent exit button', (await waitFor("!!document.getElementById('gate-share-exit')", 4000)) === true);
    check('admin cannot escape either (in-page #settings)', (await inPage(n++, 'settings')) === 'deny');
    await load(n++, 'notes/commemorative');
    await hotkey();
    check('hotkey does NOT open share dialog while in share mode', (await evalJs("!!document.querySelector('.share-mask')")) === false);
    await evalJs("document.getElementById('gate-share-exit').click()");
    await sleep(1500); await settle();
    check('after exit URL has no share=', (await evalJs("location.search.indexOf('share=')>=0")) === false, String(await evalJs('location.href')));
    check('after exit session cleared and nothing locked', (await evalJs("sessionStorage.getItem('collection-share')")) === null && (await evalJs("document.querySelectorAll('.gate-share-locked').length")) === 0);

    console.log('=== 5. denied page and admin exit ===');
    check('admin gets denied page', (await load(n++, 'settings')) === 'deny');
    check('admin sees 以管理员身份进入', (await evalJs("document.body.innerText.includes('以管理员身份进入')")) === true);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}` });
    await settle();
    await hotkey();
    check('hotkey opens share dialog on owner page (default tier selected)',
        (await evalJs("!!document.querySelector('.share-mask')")) === true && (await evalJs("!!document.querySelector('.share-tier.on')")) === true);
    await unmark();
    await load(n++, 'settings');
    check('recipient denied page has no admin entry', (await evalJs("!document.body.innerText.includes('以管理员身份进入')")) === true);
    await load(n++, 'notes/commemorative');
    check('recipient sees no exit button', (await evalJs("!!document.getElementById('gate-share-exit')")) === false);
    check('recipient page is still scoped', (await evalJs("document.querySelectorAll('.gate-share-locked').length")) > 100);

    console.log('=== 6. 快捷键：Ctrl/Cmd+Shift+S 与 Alt+Shift+S ===');
    // Edge 的 Ctrl+Shift+S 是浏览器自带的「网页捕获」、Firefox 是「截图」，网页挡不住，
    // 所以备用组合键 Alt+Shift+S 必须同样可用；两套在分享模式下都必须被吃掉。
    await mark();
    // ★ 必须把上一步的分享会话清掉：sessionStorage 跨同标签页导航存活，
    //   留着它 gate.js 会当成"还在分享模式"把快捷键吃掉（这本身也是个真实缺陷：
    //   管理员从分享链接直接回自己站点时会有僵尸会话，见下面的"回自己站点"用例）。
    await unmark();
    await mark();
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}` });
    await settle();
    console.log('  [dbg] url=' + await evalJs('location.href')
        + '  gateOk=' + await evalJs("document.documentElement.classList.contains('gate-ok')")
        + '  mark=' + await evalJs("localStorage.getItem('collection-gate')")
        + '  title=' + await evalJs('document.title')
        + '  shareOpenDialog=' + await evalJs("typeof shareOpenDialog")
        + '  mask=' + await evalJs("!!document.querySelector('.share-mask')"));
    await hotkey(10);
    check('完整站点：Ctrl+Shift+S 打开分享窗', (await evalJs("!!document.querySelector('.share-mask')")) === true);
    await closeShareDialog(); await sleep(400);
    await hotkey(9);
    check('完整站点：Alt+Shift+S 打开分享窗（Edge/Firefox 用这个）', (await evalJs("!!document.querySelector('.share-mask')")) === true);
    await closeShareDialog(); await sleep(400);
    await load(n++, 'notes/commemorative');
    await waitFor("document.querySelectorAll('.gate-share-locked').length>100", 12000);
    await hotkey(10);
    check('分享模式：Ctrl+Shift+S 被吃掉（不能再分享）', (await evalJs("!!document.querySelector('.share-mask')")) === false);
    await hotkey(9);
    check('分享模式：Alt+Shift+S 也被吃掉', (await evalJs("!!document.querySelector('.share-mask')")) === false);
    await unmark();

    console.log('=== 7. UI：一排档位 / 复制成功淡入淡出 / 进出动画 / 自绘时间 / 永久 ===');
    await unmark(); await mark();
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}` });
    await settle();
    await hotkey(10);
    check('弹窗出现且带 on 类（淡入动画的终点类）', (await evalJs("!!document.querySelector('.share-mask.on')")) === true);
    const rows = await evalJs("[...document.querySelectorAll('.share-tier')].map(b=>Math.round(b.getBoundingClientRect().top)).join(',')");
    const tops = String(rows).split(',').map(Number);
    check('六个档位排成一排（top 完全相同）', tops.length === 6 && new Set(tops).size === 1, 'tops=' + rows);
    check('档位文案：1 小时/1 天/7 天/30 天/自定义/永久',
        (await evalJs("[...document.querySelectorAll('.share-tier')].map(b=>b.textContent.trim()).join('/')")) === '1 小时/1 天/7 天/30 天/自定义/永久');
    const payloadOf = "(()=>{const v=document.querySelector('#shareLink').value;const s=v.split('share=')[1];const t=s.split('#')[0];const b=t.replace(/-/g,'+').replace(/_/g,'/');try{return JSON.parse(atob(b+'==='.slice((b.length+3)%4)));}catch(e){return {err:String(e)};}})()";
    await evalJs("document.querySelector('#shareCopy').click()");
    await sleep(700);
    check('点复制后「复制成功」淡入（.on + 有文案）',
        (await evalJs("(()=>{const m=document.querySelector('#shareMsg');return !!m && m.className.indexOf('on')>=0 && m.textContent.length>0;})()")) === true,
        String(await evalJs("document.querySelector('#shareMsg').textContent")));
    await sleep(3400);
    check('3 秒后自动淡出（不再是 .on）',
        (await evalJs("document.querySelector('#shareMsg').className.indexOf('on')<0")) === true,
        String(await evalJs("document.querySelector('#shareMsg').className")));
    await evalJs("[...document.querySelectorAll('.share-tier')].find(b=>b.textContent.trim()==='自定义').click()");
    await sleep(350);
    check('选「自定义」后出现自绘月历（>=28 个日期格）', (await evalJs("document.querySelectorAll('.share-cal-d').length")) >= 28);
    const hourBefore = await evalJs("document.querySelector('#shareHour').textContent");
    await evalJs("document.querySelector('.share-step[data-unit=hour] button[data-step=\"1\"]').click()");
    await sleep(250);
    const hourAfter = await evalJs("document.querySelector('#shareHour').textContent");
    check('自绘时分步进可用（小时 +1）', hourBefore !== hourAfter, hourBefore + ' → ' + hourAfter);
    check('自定义档的链接带 e', (await evalJs(payloadOf)).e !== undefined, JSON.stringify(await evalJs(payloadOf)).slice(0, 60));
    await evalJs("[...document.querySelectorAll('.share-tier')].find(b=>b.textContent.trim()==='永久').click()");
    await sleep(350);
    check('选「永久」后链接不带 e（机制没变，仍是靠轮换令牌撤销）', (await evalJs(payloadOf)).e === undefined);
    // ── 外观的"数字验收"（我这个模型看不了截图，就用可测量的量兜住）──────────
    check('档位文字没被截断（一排真的塞得下）',
        (await evalJs("[...document.querySelectorAll('.share-tier')].every(b=>b.scrollWidth<=b.clientWidth+1)")) === true,
        await evalJs("[...document.querySelectorAll('.share-tier')].map(b=>b.scrollWidth+'/'+b.clientWidth).join(' ')"));
    check('弹窗没有横向溢出',
        (await evalJs("(()=>{const b=document.querySelector('.share-box');return b.scrollWidth<=b.clientWidth+1;})()")) === true,
        String(await evalJs("(()=>{const b=document.querySelector('.share-box');return b.scrollWidth+'/'+b.clientWidth;})()")));
    check('淡入动画结束时面板不透明度=1',
        Number(await evalJs("getComputedStyle(document.querySelector('.share-box')).opacity")) > 0.99,
        String(await evalJs("getComputedStyle(document.querySelector('.share-box')).opacity")));
    await evalJs("document.documentElement.setAttribute('data-color-scheme','dark')");
    await sleep(250);
    const darkBg = String(await evalJs("getComputedStyle(document.querySelector('.share-box')).backgroundColor"));
    const darkAvg = (darkBg.match(/\d+/g) || []).slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
    check('深色模式下弹窗底色真的变深（不是白底）', /rgb/.test(darkBg) && darkAvg < 128, darkBg);
    await evalJs("document.documentElement.setAttribute('data-color-scheme','light')");
    await sleep(200);
    await evalJs("[...document.querySelectorAll('.share-tier')].find(b=>b.textContent.trim()==='自定义').click()");
    await sleep(300);
    // 首行可能因"当月 1 号是星期几"而短（前面补空格子），所以不能要求每行都 7 个日期格：
    // 正确判据是**正好 7 列**（列 x 坐标去重）+ 每行不超过 7 个。
    const colLefts = await evalJs("(()=>{const s=new Set();document.querySelectorAll('.share-cal-d').forEach(d=>s.add(Math.round(d.getBoundingClientRect().left)));return s.size;})()");
    check('自绘月历正好 7 列', colLefts === 7, 'cols=' + colLefts);
    const perRow = await evalJs("(()=>{const t={};document.querySelectorAll('.share-cal-d').forEach(d=>{const k=Math.round(d.getBoundingClientRect().top);t[k]=(t[k]||0)+1});return Math.max.apply(null,Object.values(t));})()");
    check('月历每行不超过 7 个日期格', Number(perRow) <= 7, 'max=' + perRow);
    check('月历日期格点得到（没有被遮挡）',
        (await evalJs("(()=>{const d=document.querySelector('.share-cal-d:not(:disabled)');if(!d)return false;const r=d.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===d;})()")) === true);

    await evalJs("document.querySelector('#shareClose').click()");
    const goneNow = await evalJs("!!document.querySelector('.share-mask')");
    await sleep(450);
    const goneLater = await evalJs("!!document.querySelector('.share-mask')");
    check('关闭走退出动画（点击后仍在 → 450ms 后消失）', goneNow === true && goneLater === false, 'now=' + goneNow + ' later=' + goneLater);
    await unmark();

    console.log('──────── 通过 ' + pass + ' / 失败 ' + fail + ' ────────');
    cleanup();
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.log('suite crashed: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
