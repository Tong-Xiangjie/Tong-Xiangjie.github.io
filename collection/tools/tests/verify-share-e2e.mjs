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
    // ★ 用户要求：日历时间选择做成**第二个弹窗**；时/分改成**下拉栏**（不要 +/- 步进）
    check('自定义时间选择器是独立的第二个弹窗（显示中，且叠在主窗之上）',
        (await evalJs("(()=>{const p=document.querySelector('#sharePickMask');if(!p)return false;const st=getComputedStyle(p);const mz=Number(getComputedStyle(document.querySelector('.share-mask')).zIndex);return st.display!=='none'&&Number(st.zIndex)>mz;})()")) === true,
        'z=' + await evalJs("(()=>{const p=document.querySelector('#sharePickMask');return p?getComputedStyle(p).zIndex+'（主窗 '+getComputedStyle(document.querySelector('.share-mask')).zIndex+'）':'-';})()"));
    check('小时/分钟是下拉栏（24 / 60 项），已经没有 +/- 步进按钮',
        (await evalJs("(()=>{const h=document.querySelector('#shareHour'),m=document.querySelector('#shareMin');return !!h&&!!m&&h.tagName==='SELECT'&&m.tagName==='SELECT'&&h.options.length===24&&m.options.length===60&&document.querySelectorAll('.share-step button').length===0;})()")) === true,
        await evalJs("(()=>{const h=document.querySelector('#shareHour'),m=document.querySelector('#shareMin');return (h?h.tagName+'/'+h.options.length:'-')+' · '+(m?m.tagName+'/'+m.options.length:'-')+' · 步进按钮='+document.querySelectorAll('.share-step button').length;})()"));
    const valBefore = await evalJs("document.querySelector('#shareExp').textContent");
    await evalJs("(()=>{const h=document.querySelector('#shareHour');h.value=String((Number(h.value)+3)%24);h.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()");
    await sleep(300);
    const valAfter = await evalJs("document.querySelector('#shareExp').textContent");
    check('改「小时」下拉后主窗的失效时间跟着变', valBefore !== valAfter, valBefore + ' → ' + valAfter);
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
    // ★ 用户要求：日期格**永远 5 行**，4 行/5 行/6 行的月份上下高度必须完全一样
    check('年份/月份各有一个下拉栏（可选到 2027 / 2026）',
        (await evalJs("(()=>{const y=document.querySelector('#shareCalYear'),m=document.querySelector('#shareCalMonth');return !!y&&!!m&&y.tagName==='SELECT'&&m.tagName==='SELECT'&&y.options.length>=12&&m.options.length===12&&[...y.options].some(o=>o.value==='2027')&&[...y.options].some(o=>o.value==='2026');})()")) === true,
        await evalJs("(()=>{const y=document.querySelector('#shareCalYear'),m=document.querySelector('#shareCalMonth');return (y?y.options.length:'-')+' 个年份 / '+(m?m.options.length:'-')+' 个月份';})()"));
    const ymSet = async (y, m) => {
        await evalJs("(()=>{const y1=document.querySelector('#shareCalYear'),m1=document.querySelector('#shareCalMonth');y1.value='" + y + "';m1.value='" + m + "';y1.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()");
        await sleep(320);
    };
    const gridShape = "(()=>{const g=document.querySelector('#shareCalGrid');return {h:Math.round(g.getBoundingClientRect().height),n:g.children.length,d:document.querySelectorAll('.share-cal-d').length,hdr:document.querySelectorAll('.share-cal-w').length};})()";
    await ymSet(2027, 1);       // 6 行的月份（2027-01-01 是周五，31 天 ⇒ 36 格）
    const g6 = await evalJs(gridShape);
    await ymSet(2026, 2);       // 4 行的月份（2026-02-01 是周日，28 天 ⇒ 28 格）
    const g4 = await evalJs(gridShape);
    await ymSet(2026, 3);       // 5 行的月份（参照）
    const g5 = await evalJs(gridShape);
    check('6 行的月份：多出来的格子平移到第一行，总格子仍固定 5 行（7 表头 + 35）',
        g6.n === 42 && g6.d === 31 && g6.hdr === 7, JSON.stringify(g6));
    check('4 行的月份：末尾补一行空，总格子也是 7 + 35',
        g4.n === 42 && g4.d === 28 && g4.hdr === 7, JSON.stringify(g4));
    check('4 行 / 5 行 / 6 行三种月份的日历高度完全一致（上下高度固定）',
        g4.h === g5.h && g5.h === g6.h, '4行=' + g4.h + '  5行=' + g5.h + '  6行=' + g6.h);
    check('链接展示栏不可拉伸（resize:none）',
        (await evalJs("getComputedStyle(document.querySelector('#shareLink')).resize")) === 'none',
        String(await evalJs("getComputedStyle(document.querySelector('#shareLink')).resize")));
    // 位置级验证（不只是数量）：2027-01 的第 31 天必须在**第一行**，且落在「日」那一列
    await ymSet(2027, 1);
    const wrap = await evalJs("(()=>{const g=document.querySelector('#shareCalGrid');const sun=g.querySelector('.share-cal-w').getBoundingClientRect().left;const b=[...g.querySelectorAll('.share-cal-d')].find(x=>x.getAttribute('data-day')==='31');if(!b)return null;const r=b.getBoundingClientRect();const rows=[...new Set([...g.querySelectorAll('.share-cal-d')].map(x=>Math.round(x.getBoundingClientRect().top)))].sort(function(a,b){return a-b;});return {col:Math.round(r.left)===Math.round(sun),row:Math.round(r.top)===rows[0],dayRows:rows.length};})()");
    check('6 行月：第 31 天平移到第一行，且列仍是「日」列（星期语义没乱）',
        !!wrap && wrap.col === true && wrap.row === true && wrap.dayRows === 5, JSON.stringify(wrap));
    await ymSet(2026, 2);
    const shape4 = await evalJs("(()=>{const g=document.querySelector('#shareCalGrid');const d=new Set([...g.querySelectorAll('.share-cal-d')].map(x=>Math.round(x.getBoundingClientRect().top)));const all=new Set([...g.children].map(x=>Math.round(x.getBoundingClientRect().top)));return {dayRows:d.size,gridRows:all.size};})()");
    check('4 行月：日期只占 4 行，最后一行整行留空（格子区仍 5 行 + 表头 1 行）',
        Number(shape4.dayRows) === 4 && Number(shape4.gridRows) === 6, JSON.stringify(shape4));
    // 「取消」要回滚到打开弹窗那一刻的值（第二个弹窗该有的语义）
    await evalJs("document.querySelector('#sharePickOk').click()");
    await sleep(350);
    await evalJs("document.querySelector('#sharePickOpen').click()");
    await sleep(350);
    const beforeCancel = await evalJs("document.querySelector('#shareExp').textContent");
    await ymSet(2027, 8);
    const midCancel = await evalJs("document.querySelector('#shareExp').textContent");
    await evalJs("document.querySelector('#sharePickCancel').click()");
    await sleep(400);
    const afterCancel = await evalJs("document.querySelector('#shareExp').textContent");
    // ⚠ 这句文案里带着**实时系统时间**（每秒刷新，分钟一翻就变一次）⇒ 直接比对原文会
    //   偶发假红（实测 20:11 → 20:12）。比之前先把 HH:MM 归一化，只比真正该回滚的部分。
    const normExp = (s) => String(s).replace(/\d{1,2}:\d{2}(:\d{2})?/g, 'HH:MM').replace(/\s+/g, ' ').trim();
    check('第二个弹窗点「取消」回滚到打开前的值',
        normExp(beforeCancel) !== normExp(midCancel) && normExp(afterCancel) === normExp(beforeCancel),
        beforeCancel + ' → ' + midCancel + ' → 取消后 ' + afterCancel);
    check('取消后弹窗收起（display:none）',
        (await evalJs("getComputedStyle(document.querySelector('#sharePickMask')).display")) === 'none',
        String(await evalJs("getComputedStyle(document.querySelector('#sharePickMask')).display")));
    // ★ 用户第三轮反馈：时分那行去掉「时间」二字、两个下拉收窄且整行不换行；两排按钮居右；
    //   「选择时间…」的省略号去掉。
    await evalJs("document.querySelector('#sharePickOpen').click()");
    await sleep(350);
    const timeRow = await evalJs("(()=>{const r=document.querySelector('.share-sub-box .share-time');const h=document.querySelector('#shareHour'),m=document.querySelector('#shareMin'),k=r.querySelector('.share-hint');return {labels:[...r.querySelectorAll('.share-time-k')].map(x=>x.textContent.trim()),sameRow:Math.round(h.getBoundingClientRect().top)===Math.round(m.getBoundingClientRect().top),overflow:r.scrollWidth-r.clientWidth,wrap:getComputedStyle(r).flexWrap,selW:Math.round(h.getBoundingClientRect().width),hintBottom:Math.round(k.getBoundingClientRect().bottom),rowBottom:Math.round(r.getBoundingClientRect().bottom)};})()");
    check('时分那行已经去掉「时间」二字',
        timeRow.labels.indexOf('时间') < 0, '该行剩下的 .share-time-k = ' + JSON.stringify(timeRow.labels));
    // 判据说明：不能用"子元素 top 去重 == 1"——align-items:center 下，高度不同的子元素
    // （下拉 vs 提示文字）top 本来就不一样，那不是换行。正确判据是：两个下拉在同一行
    // （top 相同）且整行不横向溢出。第一版判据写错，害我以为还在换行。
    check('两个下拉与提示同处一行、整行不溢出',
        timeRow.sameRow === true && Number(timeRow.overflow) <= 1 && timeRow.wrap === 'nowrap',
        '同一行=' + timeRow.sameRow + ' 溢出=' + timeRow.overflow + ' flexWrap=' + timeRow.wrap + ' 下拉宽=' + timeRow.selW + 'px');
    // ★ 用户反馈："自定义那里出现了两列一样的东西（其中一个是原生下拉）" —— 站点 dropdown.js
    //   把我们运行时插入的 <select> 也接管成自己的 .dd 壳，于是两个都露出来了。
    //   现在这四个 id 的 .dd 壳会被摘掉 ⇒ 每个字段只应剩一个控件（我们自己的原生下拉）。
    //   现在改成纯 CSS 藏它的壳（JS 删不掉：它的 MutationObserver 会重建），
    //   所以判据是"可见的控件只有一套"：站点壳必须不可见 + 我们的原生下拉可见且够宽。
    // ★★ 用户裁定：**保留站点自绘的下拉**（不要原生那套）。站点 dropdown.js 会在原生
    //   select 前面插一个 .dd 盒子（按钮 + .dd-popup），原生由站点 CSS 藏起来。
    //   所以判据是：四个 .dd 盒子存在且可见 + 四个原生 select 都被藏起来（不是并排两套）。
    check('四个下拉用的是站点自绘那套（.dd 盒子存在且可见）',
        (await evalJs("['shareCalYear','shareCalMonth','shareHour','shareMin'].every(function(id){var b=document.querySelector('.dd[data-dd-for=\"'+id+'\"]');return !!b && getComputedStyle(b).display!=='none' && b.getBoundingClientRect().width>10;})")) === true,
        await evalJs("['shareCalYear','shareCalMonth','shareHour','shareMin'].map(function(id){var b=document.querySelector('.dd[data-dd-for=\"'+id+'\"]');return id+'='+(b?Math.round(b.getBoundingClientRect().width)+'px/'+getComputedStyle(b).display:'无壳');}).join(' ')"));
    check('原生 select 没有跟着露出来（桌面上应被站点 CSS 藏住）',
        (await evalJs("['shareCalYear','shareCalMonth','shareHour','shareMin'].every(function(id){var e=document.getElementById(id);return !e || getComputedStyle(e).display==='none';})")) === true,
        await evalJs("['shareCalYear','shareCalMonth','shareHour','shareMin'].map(function(id){var e=document.getElementById(id);return id+'='+(e?getComputedStyle(e).display:'无');}).join(' ')"));
    // ★ 用户要求：年 / 月两个下拉各占可用宽度的一半（原来被压得太扁）
    const ymW = await evalJs("(()=>{const h=document.querySelector('.share-sub-box .share-cal-head');if(!h)return null;const y=document.querySelector('.dd[data-dd-for=\"shareCalYear\"]'),m=document.querySelector('.dd[data-dd-for=\"shareCalMonth\"]');if(!y||!m)return null;return {head:Math.round(h.getBoundingClientRect().width),y:Math.round(y.getBoundingClientRect().width),m:Math.round(m.getBoundingClientRect().width)};})()");
    check('年/月两个下拉各占可用宽度的一半左右（横向不再压扁）',
        !!ymW && ymW.y >= ymW.head * 0.3 && ymW.m >= ymW.head * 0.3 && Math.abs(ymW.y - ymW.m) <= 4,
        '行宽=' + (ymW && ymW.head) + ' 年=' + (ymW && ymW.y) + 'px 月=' + (ymW && ymW.m) + 'px');
    // 自绘下拉要真的能用：点开小时 → 点一个选项 ⇒ 原生 select 的值与失效时间文案都要跟着变
    const ddPick = await evalJs("(()=>{const box=document.querySelector('.dd[data-dd-for=\"shareHour\"]');if(!box)return {err:'no-box'};box.querySelector('.dd-trigger').click();const opts=[...box.querySelectorAll('.dd-popup .dd-opt')];if(!opts.length)return {err:'no-opt'};const t=opts[7]||opts[opts.length-1];const want=t.getAttribute('data-value');t.click();return {want:want,got:(document.getElementById('shareHour')||{}).value,exp:(document.querySelector('#shareExp')||{}).textContent||''};})()");
    //   （只验"原生 select 的值被自绘下拉同步了"；文案是否更新由上面"小时变化会更新
    //    失效时间那句"那条单独负责 —— 此处文案可能正处于上一条用例留下的报错句状态。）
    check('用自绘下拉选小时 ⇒ 原生 select 的值跟着变（站点那套同步链路通）',
        ddPick && !ddPick.err && String(ddPick.got) === String(ddPick.want),
        JSON.stringify(ddPick).slice(0, 180));
    check('时分那一行只有 4 个**可见**子元素（两个自绘盒子 + 冒号 + 提示）',
        (await evalJs("(()=>{const r=document.querySelector('.share-sub-box .share-time');return [...r.children].filter(e=>getComputedStyle(e).display!=='none').length;})()")) === 4,
        '可见子元素数=' + await evalJs("(()=>{const r=document.querySelector('.share-sub-box .share-time');return [...r.children].filter(e=>getComputedStyle(e).display!=='none').length;})()"));
    const actEdge = await evalJs("(()=>{const edge=(box,sel)=>{const b=document.querySelector(box);const bs=[...document.querySelectorAll(sel)];if(!b||!bs.length)return null;const pad=parseFloat(getComputedStyle(b).paddingRight)||0;const last=bs[bs.length-1].getBoundingClientRect();return Math.round((b.getBoundingClientRect().right-pad)-last.right);};return {main:edge('.share-box','.share-box .share-acts .share-btn'),pick:edge('.share-sub-box','.share-sub-box .share-acts .share-btn')};})()");
    check('两排按钮都居右（最右按钮的边缘与容器内容区对齐，误差 ≤2px）',
        Math.abs(Number(actEdge.main)) <= 2 && Math.abs(Number(actEdge.pick)) <= 2,
        JSON.stringify(actEdge) + ' acts.justifyContent=' + await evalJs("getComputedStyle(document.querySelector('.share-box .share-acts')).justifyContent")
        + ' 主窗 height/marginRight=' + await evalJs("getComputedStyle(document.querySelector('#shareMsg')).marginRight"));
    check('「选择时间」按钮文案没有省略号',
        (await evalJs("document.querySelector('#sharePickOpen').textContent.trim()")) === '选择时间',
        JSON.stringify(await evalJs("document.querySelector('#sharePickOpen').textContent")));
    await evalJs("document.querySelector('#sharePickOk').click()");
    await sleep(300);
    // ★ 用户反馈：「选『自定义』会让整个分享框变高」⇒ 现在按钮并进失效时间那一行，
    //   高度必须与别的档位一模一样（实测差值 ≤2px）。
    const boxH = async () => Number(await evalJs("Math.round(document.querySelector('.share-box').getBoundingClientRect().height)"));
    await evalJs("[...document.querySelectorAll('.share-tier')].find(b=>b.textContent.trim()==='1 天').click()");
    await sleep(350);
    const hDay = await boxH();
    await evalJs("[...document.querySelectorAll('.share-tier')].find(b=>b.textContent.trim()==='自定义').click()");
    await sleep(450);
    const hCustom = await boxH();
    check('选「自定义」不再让分享框变高（高度差 ≤2px）',
        Math.abs(hDay - hCustom) <= 2,
        '1 天=' + hDay + 'px · 自定义=' + hCustom + 'px · 差=' + Math.abs(hDay - hCustom) + 'px');
    // ★ 用户要求：句子里那个"现在是 YYYY-MM-DD HH:MM"要**实时刷新**，不能停在打开那一刻。
    //   验证办法：把自定义时间设成过去（走"系统时间"那句话），再把页面里的 Date.now
    //   人为拨快 61 秒，等定时器跑一拍 —— 文字必须跟着变。
    await evalJs("(()=>{shareCustomMs = Date.now()-61000; shareRefresh(); return 1;})()");
    await sleep(250);
    const clock1 = await evalJs("document.querySelector('#shareExp').textContent");
    await evalJs("(()=>{window.__realNow=Date.now;Date.now=function(){return window.__realNow.call(Date)+61000;};return 1;})()");
    await sleep(1500);
    const clock2 = await evalJs("document.querySelector('#shareExp').textContent");
    await evalJs("(()=>{if(window.__realNow)Date.now=window.__realNow;return 1;})()");
    check('那句"当前系统时间"每秒自己走（不是停在打开那一刻）',
        /系统时间/.test(String(clock1)) && clock1 !== clock2, clock1 + '  →  ' + clock2);
    // ★ 必须把自定义时间恢复成**未来**的值：上面为了看"现在几点"把它设成了过去，
    //   如果不还原，后面"点取消回滚"那条比较的文案里含**当前分钟** ⇒ 跨分钟就判不等
    //   （实测 2026-10-25 18:47 → 18:48 被当成"回滚失败"，是假红）。
    await evalJs("(()=>{shareCustomMs = Date.now() + 3*3600e3; shareRefresh(); return 1;})()");
    await sleep(200);

    await evalJs("document.querySelector('#shareClose').click()");
    const goneNow = await evalJs("!!document.querySelector('.share-mask')");
    await sleep(450);
    const goneLater = await evalJs("!!document.querySelector('.share-mask')");
    check('关闭走退出动画（点击后仍在 → 450ms 后消失）', goneNow === true && goneLater === false, 'now=' + goneNow + ' later=' + goneLater);
    // ★ 用户要求：快捷键打开时**什么都不选中**（原来焦点会落在「复制链接」上）
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 10, key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 10, key: 'S', code: 'KeyS', windowsVirtualKeyCode: 83 });
    await sleep(600);
    check('快捷键打开时没有任何东西被选中（焦点不在按钮上、没有文字选区）',
        (await evalJs("(()=>{const a=document.activeElement;const s=window.getSelection();const ok=(!a)||a===document.body||a===document.documentElement;return ok && String(s||'')==='';})()")) === true,
        'activeElement=' + await evalJs("document.activeElement?(document.activeElement.tagName+(document.activeElement.id?'#'+document.activeElement.id:'')):'null'")
        + ' 选区=' + JSON.stringify(await evalJs("String(window.getSelection())"))
        + ' 弹窗在=' + await evalJs("!!document.querySelector('.share-mask')"));
    await evalJs("document.querySelector('#shareClose') && document.querySelector('#shareClose').click()");
    await sleep(400);
    await unmark();

    console.log('=== 8. 分享模式下的概览页与搜索：只显示范围内数据 ===');
    // 用户要求：「还是应该要可以看概览页，不过只显示出来部分数据」。
    // 为什么必须测：点侧边栏里当前那个分类会**页内换视图**回到概览，URL 一字不变，
    // 门禁（只看地址栏）察觉不到 ⇒ 收件人能在概览里看到全部 380 件。
    const searchFor = async kw => {
        await evalJs(`(()=>{const el=document.querySelector('#searchInput');el.focus();el.value=${JSON.stringify(kw)};el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
        await sleep(1900);
        return evalJs("document.querySelectorAll('.name').length");
    };
    // ★ 判据用**应用自己的结果数组**（prevSearchResults）而不是某个 DOM 类名：
    //   搜索结果在分享页里不一定渲染出 .name（那是概览的标记），但过滤器作用的对象
    //   正是这个数组，所以它才是"搜索有没有被范围裁掉"的直接证据。
    const searchCount = async kw => {
        await evalJs("(()=>{prevSearchResults=null;return 1;})()");
        await evalJs(`(()=>{const el=document.querySelector('#searchInput');el.focus();el.value=${JSON.stringify(kw)};el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
        await sleep(1900);
        return evalJs("(prevSearchResults||[]).length");
    };
    await unmark(); await mark();
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}` });
    await settle();
    const ownerHits = await searchCount('银行');
    const ownerHits2 = await searchCount('澳门');
    check('完整站点：搜「银行」有结果（对照组）', ownerHits > 0, 'owner=' + ownerHits);
    check('完整站点：搜「澳门」有结果（范围内容关键词的对照）', ownerHits2 > 16, 'owner=' + ownerHits2);

    await unmark(); await mark();          // unmark 会把上一步的分享会话清掉
    // ★ 这一节要用**只有范围、没有选择白名单**的令牌：带 a=s1,6 时概览/搜索本来就
    //   只该给 s1、s6 里那几件，拿"整个纪念钞 61 件"当预期会误判（踩过一次）。
    const TOK_CAT = mint('notes/commemorative', '', 3600 * 1000);
    const scopedLoad = async () => {
        await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK_CAT}&_=${n++}#notes/commemorative` });
        await settle();
        await waitFor("document.querySelectorAll('.gate-share-locked').length>0", 8000);
    };
    const overviewCount = async () => {
        await evalJs("(()=>{ if (typeof renderOverview === 'function') renderOverview(); return 1; })()");
        await sleep(1300);
        return evalJs("document.querySelectorAll('.name').length");
    };
    await scopedLoad();
    const ovCat = await overviewCount();
    check('分享模式：概览页可看，但只显示范围内的藏品',
        ovCat > 0 && ovCat < 380, '概览=' + ovCat + '（范围=纪念钞全部 47 件；全站概览 380）');
    await scopedLoad();
    const shareHits = await searchCount('银行');
    check('分享模式：搜「银行」拿不到范围外的藏品', shareHits < ownerHits, 'share=' + shareHits + ' owner=' + ownerHits);
    await scopedLoad();
    const inScopeHits = await searchCount('澳门');
    check('分享模式：范围内的关键词仍然搜得到（没把搜索弄坏）',
        inScopeHits > 0 && inScopeHits < ownerHits2, 'share=' + inScopeHits + ' owner=' + ownerHits2);
    // 选择级（a=s1,6）：概览只该给 s1、s6 里那几件
    await load(n++, 'notes/commemorative');
    const ovSel = await overviewCount();
    check('选择级分享：概览只剩白名单里的系列（比整类少得多）', ovSel > 0 && ovSel < ovCat,
        '选择级=' + ovSel + ' 整类=' + ovCat);
    await unmark();

    console.log('=== 9. 子分类分享：真路由是三段 notes/rmb/rmb3 ===');
    // 实测结论（用户报"第三套人民币啥都点不了"）：子分类的真路由是 notes/<父id>/<子id>。
    // #notes/rmb3 是**无效**路由 ⇒ 应用回退到概览 ⇒ 概览条目路由与范围对不上 ⇒ 全灰。
    // 另外 shareRouteOf 以前只取 onSidebarChildClick('rmb','rmb3') 的**第一个** id，
    // 拼出 notes/rmb ⇒ 连范围内的子分类自己都被锁死。
    await unmark(); await mark();
    const TOK_SUB = mint('notes/rmb/rmb3', '', 3600 * 1000);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK_SUB}&_=${n++}#notes/rmb/rmb3` });
    await settle();
    await waitFor("document.querySelectorAll('.gate-share-locked').length>0", 8000);
    check('子分类分享：落在分类页而不是概览（三段路由才认）',
        (await evalJs("typeof currentView!=='undefined' && currentView==='category'")) === true,
        'currentView=' + await evalJs("typeof currentView!=='undefined'?currentView:'?"));
    check('子分类分享：分类页内容渲染完整（系列头 + 复制链接都在）',
        (await evalJs("document.querySelectorAll('.series-year-header').length")) >= 8
        && (await evalJs("document.querySelectorAll('.copy-detail-link').length")) >= 20,
        '系列=' + await evalJs("document.querySelectorAll('.series-year-header').length")
        + ' 复制=' + await evalJs("document.querySelectorAll('.copy-detail-link').length"));
    check('子分类分享：侧边栏里**范围内**的第三套人民币可点（不再被锁）',
        (await evalJs('(()=>{const e=document.querySelector(".sidebar-child[onclick*=rmb3]");return e? !e.classList.contains("gate-share-locked") : "not-found";})()')) === true);
    check('子分类分享：祖先分组（人民币）可点 —— 回概览要走这条路',
        (await evalJs('(()=>{const e=[...document.querySelectorAll(".sidebar-item")].find(x=>/onSidebarItemClick\\(.rmb.\\)/.test(x.getAttribute("onclick")||""));return e? !e.classList.contains("gate-share-locked") : "not-found";})()')) === true);
    check('子分类分享：兄弟分类（纪念钞）仍被锁',
        (await evalJs('(()=>{const e=[...document.querySelectorAll(".sidebar-item")].find(x=>/commemorative/.test(x.getAttribute("onclick")||""));return e? e.classList.contains("gate-share-locked") : "not-found";})()')) === true);
    const ovSub = await overviewCount();
    check('子分类分享：概览页只给这个子分类的藏品', ovSub > 0 && ovSub < 380, '概览=' + ovSub + '（全站 380）');
    await unmark();

    console.log('=== 10. 概览可看但内容被裁 + 搜索锁住 + 点当前分类能回概览 ===');
    // 用户要求：「可以看概览页，但只显示部分数据」；「概览不展示 = 直接不显示，不是变灰」。
    // 关键：概览路由是范围的**祖先**（notes / notes/rmb），以前被判越界 ⇒ 一点就被弹回／重刷。
    await unmark(); await mark();
    const TOK10 = mint('notes/rmb/rmb3', '', 3600 * 1000);
    const go = async (hash) => {
        await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK10}&_=${n++}#${hash}` });
        await settle();
    };
    await go('notes/rmb');
    check('祖先概览（分类概览 #notes/rmb）可以进，不再被弹回',
        (await evalJs("document.documentElement.classList.contains('gate-ok')")) === true,
        'title=' + await evalJs('String(document.title)'));
    const ovRmb = await evalJs("document.querySelectorAll('.name').length");
    check('分类概览只渲染范围内的藏品（范围外的直接不显示，不是变灰）',
        ovRmb > 0 && ovRmb < 82, '渲染件数=' + ovRmb + '（rmb 全组是 82）');
    check('概览里保留的都是**没被锁**的（可点）',
        (await evalJs("document.querySelectorAll('.search-result-group .gate-share-locked').length")) === 0,
        '被锁的概览条目=' + await evalJs("document.querySelectorAll('.search-result-group .gate-share-locked').length"));
    await go('notes/rmb/rmb3');
    await evalJs('(()=>{prevSearchResults=null;return 1;})()');
    check('分享模式下搜索框可用，只是文案提示范围（placeholder=仅在可见范围内搜索）',
        (await evalJs("(()=>{const i=document.getElementById('searchInput');return !!i && !i.disabled && i.getAttribute('placeholder')==='仅在可见范围内搜索';})()")) === true,
        'placeholder=' + await evalJs("(()=>{const i=document.getElementById('searchInput');return i?i.getAttribute('placeholder'):'无输入框';})()"));
    await evalJs("(()=>{const el=document.getElementById('searchInput');if(!el)return 1;el.value='银行';el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
    await sleep(1200);
    // 真实用户点不进被禁用的输入框（上面已断言 disabled），所以正常路径不会触发搜索；
    // 这里故意用合成事件绕过去，确认**万一跑了也只可能出范围内的数据**（rmb3Data）。
    check('万一搜索被触发，结果也只可能来自范围内（rmb3Data）',
        (await evalJs("(prevSearchResults||[]).every(r=>r.dataKey==='rmb3Data')")) === true,
        '结果数=' + await evalJs('(prevSearchResults||[]).length')
        + ' 来源=' + await evalJs("JSON.stringify([...new Set((prevSearchResults||[]).map(r=>r.dataKey))])"));
    // 点侧边栏里"当前这个分类" ⇒ core.js 的既有行为是回到概览，不该被门禁弹回
    const hashBefore = await evalJs('location.hash');
    await evalJs('(()=>{const e=document.querySelector(".sidebar-child[onclick*=rmb3]");if(e)e.click();return 1;})()');
    await sleep(2200);
    check('点侧边栏"当前分类"能回到概览且不被弹回',
        (await evalJs("document.documentElement.classList.contains('gate-ok')")) === true
        && (await evalJs("document.querySelectorAll('.name').length")) > 0
        && (await evalJs("document.querySelectorAll('.name').length")) < 82,
        'hash ' + hashBefore + ' → ' + await evalJs('location.hash')
        + '  渲染件数=' + await evalJs("document.querySelectorAll('.name').length"));
    await unmark();

    console.log('=== 11. 搜索整条锁死 / 概览条目能点进去 / 侧边栏不再闪白 ===');
    await unmark(); await mark();
    const TOK11 = mint('notes/rmb/rmb3', '', 3600 * 1000);
    const go11 = async (hash) => {
        await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK11}&_=${n++}#${hash}` });
        await settle();
    };
    await go11('notes/rmb/rmb3');
    check('搜索框 placeholder 是「仅在可见范围内搜索」',
        (await evalJs("(()=>{const i=document.getElementById('searchInput');return i?i.getAttribute('placeholder'):'';})()")) === '仅在可见范围内搜索',
        String(await evalJs("(()=>{const i=document.getElementById('searchInput');return i?i.getAttribute('placeholder'):'(无输入框)';})()")));
    check('搜索框**可用**（分享模式下打开搜索，只是范围受限）',
        (await evalJs("(()=>{const i=document.getElementById('searchInput');return !!i && !i.disabled && getComputedStyle(i).pointerEvents!=='none';})()")) === true,
        'disabled=' + await evalJs("(()=>{const i=document.getElementById('searchInput');return i?i.disabled:'-';})()"));
    check('整条搜索栏没有被锁（Ω / 搜索 / 分类下拉 / 重置 都能点）',
        (await evalJs("document.querySelectorAll('.search-bar .gate-share-locked').length")) === 0,
        '被锁控件=' + await evalJs("document.querySelectorAll('.search-bar .gate-share-locked').length"));
    // 真搜一次：视图要切到 search、结果要出来、而且**只可能来自范围内**
    await evalJs("(()=>{const el=document.getElementById('searchInput');el.focus();el.value='人民币';el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
    await sleep(2200);
    const sView = await evalJs("typeof currentView!=='undefined'?currentView:'?'");
    const sKeys = await evalJs("JSON.stringify([...new Set((prevSearchResults||[]).map(r=>r.dataKey))])");
    const sItems = await evalJs("document.querySelectorAll('.search-result-item').length");
    check('分享页里搜索能正常渲染（视图切到 search、条目出得来）',
        sView === 'search' && sItems > 0, '视图=' + sView + ' 条目=' + sItems + ' 结果数=' + await evalJs('(prevSearchResults||[]).length'));
    check('搜索只在范围内出结果（只可能来自 rmb3Data）',
        (await evalJs("(prevSearchResults||[]).length")) > 0
        && (await evalJs("(prevSearchResults||[]).every(r=>r.dataKey==='rmb3Data')")) === true,
        '来源=' + sKeys);
    await go11('notes/rmb/rmb3');
    await evalJs("(()=>{const el=document.getElementById('searchInput');el.focus();el.value='纪念';el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
    await sleep(2200);
    check('只命中范围外的关键词 ⇒ 一条都不给（搜「纪念」= 纪念钞，范围外）',
        (await evalJs('(prevSearchResults||[]).length')) === 0,
        '结果数=' + await evalJs('(prevSearchResults||[]).length'));
    // 概览条目要能点进去（用户实测「概览页正常显示，但是无法从概览页点进去」）
    await go11('notes/rmb');
    const itemRect = await evalJs("(()=>{const e=document.querySelector('.search-result-item');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left+Math.min(40,r.width/2)),y:Math.round(r.top+r.height/2)};})()");
    check('祖先概览里有可点的条目', !!itemRect, JSON.stringify(itemRect));
    if (itemRect) {
        const viewBefore = await evalJs("typeof currentView!=='undefined'?currentView:'?'");
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: itemRect.x, y: itemRect.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: itemRect.x, y: itemRect.y, button: 'left', clickCount: 1 });
        await sleep(1600);
        const viewAfter = await evalJs("typeof currentView!=='undefined'?currentView:'?'");
        check('从概览点条目真的进得去（不再被点击守卫拦掉）',
            viewAfter !== viewBefore || (await evalJs('location.hash')) !== ('#notes/rmb'),
            '视图 ' + viewBefore + ' → ' + viewAfter + '  hash=' + await evalJs('location.hash'));
    }
    // 侧边栏不再闪白：点完侧边栏后**逐帧**采样锁定数，最小值必须 > 0
    await go11('notes/rmb/rmb3');
    await evalJs("(()=>{window.__min=9999;let i=0;const tick=()=>{const c=document.querySelectorAll('.sidebar-item.gate-share-locked,.sidebar-child.gate-share-locked').length;if(c<window.__min)window.__min=c;if(++i<12)requestAnimationFrame(tick);};requestAnimationFrame(tick);return 1;})()");
    await evalJs("(()=>{const e=document.querySelector('.sidebar-child[onclick*=rmb3]');if(e)e.click();return 1;})()");
    await sleep(1400);
    const minLocked = await evalJs('window.__min');
    check('重渲染后侧边栏逐帧采样都不出现"未锁"窗口（不再闪白）',
        Number(minLocked) > 0, '逐帧最小锁定数=' + minLocked);
    await unmark();

    console.log('=== 12. 文章分享精确到篇 / 小板块 ===');
    await unmark(); await mark();
    const TOK12 = mint('articles/0', '', 3600 * 1000);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK12}&_=${n++}#articles/0` });
    await settle();
    check('精确到"某一篇"的分享链接能正常打开（gate-ok、停在那一篇、没被弹回）',
        (await evalJs("document.documentElement.classList.contains('gate-ok')")) === true
        && (await evalJs('location.hash')) === '#articles/0',
        'hash=' + await evalJs('location.hash') + '  title=' + await evalJs('String(document.title)'));
    check('文章页里范围外的入口确实被锁（不是全开）',
        (await evalJs("document.querySelectorAll('.gate-share-locked').length")) > 0,
        '被锁元素=' + await evalJs("document.querySelectorAll('.gate-share-locked').length")
        + '  其中文章项=' + await evalJs("document.querySelectorAll('.gate-share-locked[onclick^=\"openArticleReader(\"]').length"));
    // ★ 用户要求：精确到某一篇 ⇒ **整个搜索栏**锁住（含下拉/切换/重置），placeholder 换成
    //   「搜索功能暂不可用」。锁而不弹提示条（.gate-share-locked 是 pointer-events:none，
    //   根本点不动 —— 提示条是下策）。
    const sbar = await evalJs("({locked:!!document.querySelector('.search-bar.gate-share-locked'),ph:String((document.getElementById('searchInput')||{}).placeholder||''),dis:!!(document.getElementById('searchInput')||{}).disabled})");
    check('精确到某一篇：搜索栏整体锁住 + placeholder「搜索功能暂不可用」+ 输入框禁用',
        sbar.locked === true && sbar.ph === '搜索功能暂不可用' && sbar.dis === true,
        JSON.stringify(sbar));
    // ★ 用户追加要求：「点"标"字能切到全文索引」这句提示（#searchTip）也要一起灰掉锁住。
    const tipLock = await evalJs("(()=>{const t=document.getElementById('searchTip');if(!t)return 'absent';return {tip:t.classList.contains('gate-share-locked'),box:!!(t.parentElement&&t.parentElement.classList.contains('gate-share-locked'))};})()");
    check('精确到某一篇：「标/全」那句提示也灰掉锁住',
        tipLock === 'absent' || (tipLock && tipLock.tip === true),
        JSON.stringify(tipLock));
    // 页内手改到"别的篇号"必须被拦住（这条正是靠 shareRouteOf 认 openArticleReader 才成立）
    await evalJs("(()=>{location.hash='articles/1';return 1;})()");
    await sleep(1600);
    const artTitle = await evalJs('String(document.title)');
    check('页内改成范围外的另一篇 ⇒ 被拦（拒绝页 / 仍在原篇），不会静默放过去',
        (await evalJs('location.hash')) !== '#articles/1' || /失效|无法访问/.test(String(artTitle)),
        'hash=' + await evalJs('location.hash') + '  title=' + artTitle);
    // ★ 用户要求：精确到某一篇的分享里，「← 返回文章列表」要锁住（它落到范围外）。
    //   注意：本地数据里 articles/0 这一篇不一定存在（阅读页可能压根没渲染）⇒ 按钮取不到时
    //   本条只做记录、不判红；逻辑本身由 verify-share.mjs 里那条 match() 断言把关。
    const backBtn = await evalJs("(()=>{const b=document.querySelector('.back-btn, [onclick*=closeArticleReader]');return b? (b.classList.contains('gate-share-locked')?'locked':'unlocked') : 'absent';})()");
    check('单篇分享里「返回文章列表」按钮被锁住（该篇没渲染出按钮时只记录）',
        backBtn === 'locked' || backBtn === 'absent', '返回按钮锁状态=' + backBtn);
    await unmark();

    // ★ 小板块范围（真实分类 id 取自 config.js：macau_boc）：数据**必须还在**。
    //   之前 shareDataKeep 拿 'c-macau_boc' 去比文件名（数据文件按分类 id 命名）
    //   ⇒ 文章数据被整段丢掉，页面显示"共 0 篇 / 还没有文章哦"（线上实测）。
    const TOK12b = mint('articles/c-macau_boc', '', 3600 * 1000);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK12b}&_=${n++}#articles/c-macau_boc` });
    await settle();
    const catData = await evalJs("({arts:(typeof collectedArticles!=='undefined'?collectedArticles.length:-1),tree:(typeof articleCategoryTree!=='undefined'?articleCategoryTree.length:-1),items:document.querySelectorAll('[onclick^=\"openArticleReader(\"]').length,locked:document.querySelectorAll('.gate-share-locked').length,hash:location.hash,ok:document.documentElement.classList.contains('gate-ok')})");
    check('小板块范围（articles/c-macau_boc）能打开且停在那个小板块',
        catData.ok === true && catData.hash === '#articles/c-macau_boc', 'hash=' + catData.hash + ' gate-ok=' + catData.ok);
    check('小板块范围下文章数据没被裁剪掉（篇数/分类树都不是 0）',
        Number(catData.arts) > 0 && Number(catData.tree) > 0, '文章数=' + catData.arts + ' 分类树=' + catData.tree);
    check('小板块范围下文章列表真的渲染出来了（可见文章项 > 0）',
        Number(catData.items) > 0, '可见文章项=' + catData.items + ' 被锁=' + catData.locked);
    // ★★ 用户实测的 bug：小板块分享里"文章全灰，一篇都看不到"。上一轮我只验了"列表渲染
    //    出来了"，没验"它们可不可点" —— 真正的毛病是 items 的路由带序号
    //    （articles/12/c-macau_boc），而范围 articles/c-macau_boc 没有序号 ⇒ 纯前缀判定
    //    把每一项都判成越界。现在按段判定 ⇒ 这个范围里的文章项**一个都不该被锁**。
    const catLock = await evalJs("({items:document.querySelectorAll('[onclick^=\"openArticleReader(\"]').length,locked:document.querySelectorAll('[onclick^=\"openArticleReader(\"].gate-share-locked').length})");
    check('小板块范围里文章项没有被锁（点得进去，不是全灰）',
        Number(catLock.items) > 0 && Number(catLock.locked) === 0,
        '文章项=' + catLock.items + ' 其中被锁=' + catLock.locked);
    // ★ 用户要求：精确范围（篇/小板块）下侧边栏要**全部**锁定，不能靠它换分类。
    //   （侧边栏在有些视口/视图里不渲染 ⇒ 取不到时只记录，不判红。）
    const sbLock = await evalJs("(()=>{const a=[...document.querySelectorAll('[onclick*=onArticleSidebarClick]')];return {n:a.length,locked:a.filter(x=>x.classList.contains('gate-share-locked')).length};})()");
    // ★ 用户最终口径：子类范围里，**该分类自己与它的父类**可点（像分享「第三套人民币」
    //   那样能从父类概览进去），同级与别的分支锁住。取不到侧边栏时只记录。
    check('子类范围：侧边栏里"该分类/其父类"可点、其余锁住（取不到侧边栏时只记录）',
        Number(sbLock.n) === 0 || (Number(sbLock.locked) < Number(sbLock.n) && Number(sbLock.locked) >= 1),
        '侧边栏项=' + sbLock.n + ' 其中被锁=' + sbLock.locked);
    // ★ 与纸币/硬币完全同一口径（用户："主要是和纸币硬币要一样的逻辑"）：
    //   子类范围里，**父类那一项必须可点**（祖先 = 回概览，概览只显示范围内文章）。
    const treeInfo = await evalJs("(()=>{try{const t=articleCategoryTree||[];const q=id=>{const el=document.querySelector('[onclick*=onArticleSidebarClick][onclick*=\"'+id+'\"]');return el?(el.classList.contains('gate-share-locked')?'locked':'open'):'absent';};for(const c of t){if(c&&c.children&&c.children.some(s=>s&&s.id==='macau_boc')){return {parent:c.id,parentState:q(c.id),subs:c.children.map(s=>s.id),subStates:c.children.map(s=>q(s.id))};}}return {parent:'',parentState:'absent',subs:[],subStates:[]};}catch(e){return {err:String(e)};}})()");
    check('子类范围：父类侧边栏项可点（与纸币/硬币一致：能回概览）',
        treeInfo.parentState === 'absent' || treeInfo.parentState === 'open',
        JSON.stringify(treeInfo));
    // ★ 用户口径：父类范围 ⇒ 概览只显示范围内（可展示）的文章，且该父类侧边栏项可点。
    //   ⚠ 父类 id 不能写死：本地数据里未必有那个分类的文章（写 prcAidPrinted 会得到 0 条，
    //   那是"过滤正确"而不是 bug）。这里从 articleCategoryTree 现查出 macau_boc 的父类，
    //   保证这个父类在本地确实挂着文章（它的子树就是那 11 篇）。
    const parentId = await evalJs("(()=>{try{const t=articleCategoryTree||[];for(const c of t){if(c&&c.children&&c.children.some(s=>s&&s.id==='macau_boc'))return c.id;}return '';}catch(e){return '';}})()");
    await unmark(); await mark();
    const TOK12p = mint('articles/c-' + parentId, '', 3600 * 1000);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK12p}&_=${n++}#articles` });
    await settle(); await sleep(1500);
    const pInfo = await evalJs("({total:(typeof collectedArticles!=='undefined'?collectedArticles.length:-1),items:document.querySelectorAll('[onclick^=\"openArticleReader(\"]').length,sb:[...document.querySelectorAll('[onclick*=onArticleSidebarClick]')].length,clickable:[...document.querySelectorAll('[onclick*=onArticleSidebarClick]')].filter(x=>!x.classList.contains('gate-share-locked')).length})");
    check('父类范围：概览只显示范围内的文章（有内容、且不超过全量）',
        Number(pInfo.items) > 0 && Number(pInfo.items) <= Number(pInfo.total),
        '父类=' + (parentId || '没查到') + ' 概览=' + pInfo.items + ' 全量=' + pInfo.total);
    check('父类范围：该父类侧边栏项可点（取不到侧边栏时只记录）',
        Number(pInfo.sb) === 0 || Number(pInfo.clickable) >= 1,
        '侧边栏项=' + pInfo.sb + ' 其中可点=' + pInfo.clickable);
    // ★ 与纸币/硬币一致：父类范围里**全部子类**侧边栏项都可点（子树 = inPrefix）。
    const pKids = await evalJs("(()=>{const pid=" + JSON.stringify(parentId) + ";try{const t=articleCategoryTree||[];const p=t.find(c=>c&&c.id===pid);if(!p||!p.children)return {n:0,open:0,absent:0};const q=id=>{const el=document.querySelector('[onclick*=onArticleSidebarClick][onclick*=\"'+id+'\"]');if(!el)return 'absent';return el.classList.contains('gate-share-locked')?'locked':'open';};const st=p.children.map(s=>q(s.id));return {n:p.children.length,open:st.filter(x=>x==='open').length,absent:st.filter(x=>x==='absent').length,locked:st.filter(x=>x==='locked').length};}catch(e){return {err:String(e)};}})()");
    check('父类范围：全部子类侧边栏项都可点（与纸币/硬币一致）',
        Number(pKids.n) === 0 || Number(pKids.locked) === 0,
        JSON.stringify(pKids));
    // ★ 用户口径：子类范围 ⇒ 概览只显示这个子类的文章 ⇒ 严格少于全量
    await unmark(); await mark();
    const TOK12s = mint('articles/c-macau_boc', '', 3600 * 1000);
    await send('Page.navigate', { url: `http://${HOST}:${port}${PAGE}?share=${TOK12s}&_=${n++}#articles` });
    await settle(); await sleep(1500);
    const sInfo = await evalJs("({total:(typeof collectedArticles!=='undefined'?collectedArticles.length:-1),items:document.querySelectorAll('[onclick^=\"openArticleReader(\"]').length})");
    check('子类范围：概览只显示这个子类的文章（严格少于全量）',
        Number(sInfo.items) > 0 && Number(sInfo.items) < Number(sInfo.total),
        '概览=' + sInfo.items + ' 全量=' + sInfo.total);
    await unmark();
    await unmark();

    console.log('──────── 通过 ' + pass + ' / 失败 ' + fail + ' ────────');
    cleanup();
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.log('suite crashed: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
