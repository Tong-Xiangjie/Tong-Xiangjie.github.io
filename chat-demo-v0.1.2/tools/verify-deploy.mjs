#!/usr/bin/env node
/**
 * 线上验收：只查本次改动相关的三件事。
 *
 * 为什么单独写一个：verify-live.mjs 覆盖的是侧栏动画等一堆历史不变量，
 * 里面有几条本来就偶发（采样抖动），跑起来噪音大、还容易超时。
 * 这里只回答"这次改动在线上生效了吗"。
 *
 * 只用 Edge（DSH_BROWSER），绝不拉起 Chrome —— 用户明确要求。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const URL_LIVE = 'https://tong-xiangjie.github.io/chat-demo-v0.1.2/';
const CDP_PORT = 9334;

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) {
  console.error('拒绝执行：这会拉起 Chrome。请设置 DSH_BROWSER 指向 Edge。');
  process.exit(1);
}
console.log('浏览器: ' + browserPath);
console.log('目标  : ' + URL_LIVE + '\n');

const profile = mkdtempSync(join(tmpdir(), 'livecheck-'));
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', URL_LIVE
], { stdio: 'ignore' });

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail !== undefined ? '  → ' + detail : '')); failed++; }
};

try {
  const target = await fetchPageTarget(CDP_PORT);
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const ev = async (expr) => {
    try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
  };

  // 等桥接层就绪
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const r = await ev('!!(window.__localstore && window.__localstore.version)');
    if (r === true) { ready = true; break; }
    await new Promise((r2) => setTimeout(r2, 500));
  }
  check('线上页面加载出桥接层', ready === true);
  if (!ready) throw new Error('桥接层没就绪，后面没法测');

  // 1) 版本与"文件夹入口已消失"
  const surface = await ev(`(function(){
    var L = window.__localstore;
    var folderKeys = ['pickFolder','snapshot','restoreFromFolder','reconnect','disconnect','folderWatch'];
    var stillThere = folderKeys.filter(function(k){ return typeof L[k] === 'function' || (L[k] && typeof L[k] === 'object'); });
    return {
      version: L.version,
      stillThere: stillThere,
      hasExport: typeof L.exportBundle === 'function',
      hasExportSession: typeof L.exportSession === 'function',
      hasExportByTitle: typeof L.exportSessionByTitle === 'function',
      hasImport: typeof L.importBundle === 'function',
      supportsFs: !!L.supportsFs
    };
  })()`);
  check('桥接层版本已就绪', !!surface.version, JSON.stringify(surface));
  check('★ 文件夹入口已从线上移除（pickFolder/snapshot/folderWatch 等）',
    Array.isArray(surface.stillThere) && surface.stillThere.length === 0,
    JSON.stringify(surface.stillThere));
  check('★ 导出接口在线上可用', surface.hasExport === true);
  check('★ 导入接口在线上可用', surface.hasImport === true);
  check('★ 单个对话导出在线上可用', surface.hasExportSession === true && surface.hasExportByTitle === true);

  // 2) 设置面板：新文案在、旧文案没了
  const panel = await ev(`
    (function(){
      var dlg = document.createElement('div');
      dlg.className = 'dialog-_85c1b';
      var g = document.createElement('button');
      g.className = 'navItem-_85c1b navItemActive-_85c1b'; g.textContent = '通用设置';
      var d = document.createElement('button');
      d.className = 'navItem-_85c1b'; d.textContent = '数据管理';
      dlg.appendChild(g); dlg.appendChild(d);
      var c = document.createElement('div');
      c.className = 'content-_85c1b';
      var row = document.createElement('div');
      row.className = 'cell-_85c1b row-_85c1b';
      var lb = document.createElement('div');
      lb.className = 'label-_85c1b'; lb.textContent = '语言';
      row.appendChild(lb); c.appendChild(row); dlg.appendChild(c);
      document.body.appendChild(dlg);
      var old = document.getElementById('localstore-section');
      if (old) old.remove();
      window.__localstore.mountSection(c);
      var sec = document.getElementById('localstore-section');
      var t = sec ? sec.textContent : '';
      return {
        mounted: !!sec,
        text: t.slice(0, 400),
        hasBackup: t.indexOf('备份与恢复') >= 0,
        hasFolderStorage: t.indexOf('本地文件夹存储') >= 0,
        hasKeyToFolder: t.indexOf('API Key 保存到文件夹') >= 0,
        hasExportBtn: t.indexOf('导出') >= 0,
        hasImportBtn: t.indexOf('导入') >= 0
      };
    })()
  `);
  check('设置区块能挂载', panel.mounted === true);
  check('★ 显示「备份与恢复」', panel.hasBackup === true, panel.text);
  check('★ 线上已无「本地文件夹存储」', panel.hasFolderStorage === false, panel.text);
  check('★ 线上已无「API Key 保存到文件夹」', panel.hasKeyToFolder === false, panel.text);
  check('线上能看到导出/导入按钮', panel.hasExportBtn === true && panel.hasImportBtn === true);

  // 3) 导出真的能产出内容（拦下下载，不落盘）
  const ex = await ev(`
    (async function(){
      var L = window.__localstore;
      // 造一条对话，保证有东西可导
      var db = await new Promise(function(res, rej){
        var r = indexedDB.open('chat-demo');
        r.onsuccess = function(){ res(r.result); };
        r.onerror = function(){ rej(r.error); };
      });
      await new Promise(function(res, rej){
        var tx = db.transaction(['sessions'],'readwrite');
        tx.objectStore('sessions').put({
          id:'live-check-1', title:'线上验收', createdAt:1, updatedAt:2,
          rootMessageId:'a',
          messages:[
            {id:'a', role:'user', content:'hi', parentId:null, selectedChildId:'b'},
            {id:'b', role:'assistant', content:'hello', parentId:'a', selectedChildId:null}
          ]
        });
        tx.oncomplete=function(){res();}; tx.onerror=function(){rej(tx.error);};
      });
      db.close();

      var realCreate = URL.createObjectURL;
      var realClick = HTMLAnchorElement.prototype.click;
      var blob = null;
      URL.createObjectURL = function(b){ blob = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function(){};
      var ret;
      try { ret = await L.exportBundle(); }
      finally { URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; }
      var text = blob ? await blob.text() : '';
      var parsed = null;
      try { parsed = JSON.parse(text); } catch(e) {}
      return {
        name: ret && ret.name,
        sessions: parsed && parsed.sessionCount,
        schema: parsed && parsed.schema,
        hasConfig: !!(parsed && parsed.config)
      };
    })()
  `);
  check('★ 线上导出能产出可解析的备份', ex.schema === 'chat-demo-export@1', JSON.stringify(ex));
  check('★ 线上导出含对话数据', typeof ex.sessions === 'number' && ex.sessions >= 1, String(ex.sessions));
  check('★ 线上导出含配置（Key 与偏好）', ex.hasConfig === true);
  check('导出文件名是 .json', !!(ex.name && /\.json$/.test(ex.name)), String(ex.name));

  try { cdp.close(); } catch { }
} catch (err) {
  console.log('\n验收异常终止: ' + err.message);
  failed++;
}

try { proc.kill(); } catch { }
await new Promise((r) => setTimeout(r, 700));
// 只回收本次这个临时 profile 起的 Edge（按 user-data-dir 精确匹配，不碰用户自己的 Edge）
try {
  execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
    { stdio: 'ignore' }
  );
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
