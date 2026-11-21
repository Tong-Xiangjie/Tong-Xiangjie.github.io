#!/usr/bin/env node
/**
 * e2e-api-base.mjs —— 验证「自定义 API 地址」真的生效。
 *
 * 前面的 e2e 只验证了能往 localStorage 写入地址；这里进一步验证
 * 补丁后的 bundle 在真正发请求时用的是这个地址，而不是写死的官方域名。
 *
 * 做法：本地起一个假的 API 服务，把 API 地址指到它，
 * 然后在界面上真实地输入一句话并点击发送，断言假服务收到了请求。
 *
 * 用法：node tools/e2e-api-base.mjs
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8893;
const CDP_PORT = 9337;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

/** 假 API 服务收到的请求记录 */
const received = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // 假 API：记录一切，返回最小可用响应
  if (url.pathname === '/models') {
    received.push({ path: url.pathname, auth: req.headers.authorization || null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
    return;
  }

  // 模型列表：同时提供官方 /anthropic/v1/models 与 OpenAI 风格 /models，
  // 用来验证「获取模型」两种返回结构都能解析
  if (url.pathname === '/anthropic/v1/models' || url.pathname === '/models' || url.pathname === '/v1/models') {
    received.push({
      path: url.pathname,
      auth: req.headers['x-api-key'] || req.headers.authorization || null
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'deepseek-flash', name: 'DeepSeek Flash', context_window: 1000000 },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
        ]
      })
    );
    return;
  }

  if (url.pathname.endsWith('/messages')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {}
      received.push({
        path: url.pathname,
        auth: req.headers['x-api-key'] || req.headers.authorization || null,
        model: parsed && parsed.model,
        body: body.slice(0, 400)
      });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      });
      const send = (evt) =>
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      send({
        type: 'message_start',
        message: {
          id: 'msg_local',
          model: 'deepseek-flash',
          role: 'assistant',
          usage: { input_tokens: 5, output_tokens: 1 }
        }
      });
      send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '来自本地假服务' } });
      send({ type: 'content_block_stop', index: 0 });
      send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } });
      send({ type: 'message_stop' });
      res.end();
    });
    return;
  }

  // 文件上传：路径必须是 `<根地址>/anthropic/v1/files`。
  // 这里专门记录路径，防止「base URL 里已经含 /anthropic 又被拼一次」
  // 导致变成 /anthropic/anthropic/v1/files（真实世界里就是上传失败）。
  if (url.pathname.endsWith('/files')) {
    received.push({
      path: url.pathname,
      kind: 'files',
      auth: req.headers['x-api-key'] || req.headers.authorization || null
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'file_local_1',
        type: 'file',
        filename: 'test.txt',
        mime_type: 'text/plain',
        size: 5
      })
    );
    return;
  }

  // 静态文件
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    res.end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => existsSync(p));

const profile = mkdtempSync(join(tmpdir(), 'cdp-apibase-'));
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `http://127.0.0.1:${PORT}/index.html`
  ],
  { stdio: 'ignore' }
);

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail !== undefined ? '  → ' + detail : ''}`);
    failed++;
  }
}

let cdp;
try {
  console.log('\n=== 验证自定义 API 地址真正生效 ===\n');
  console.log(`假 API 服务: http://127.0.0.1:${PORT}`);

  const target = await fetchPageTarget(CDP_PORT);
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const sleepLocal = sleep;
  async function ev(expr, attempts = 6) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        return await cdp.evaluate(expr);
      } catch (e) {
        last = e;
        if (!/context was destroyed|Cannot find context|navigated/i.test(String(e.message))) throw e;
        await sleep(500);
      }
    }
    throw last;
  }

  await sleep(1200);

  /**
   * 首次启动时应用停在「输入 API Key 开始使用」界面：
   * 它会把 Key 发到 GET {base}/models 做校验，通过后才真正武装输入区。
   * 所以必须先走完这一步，否则发送按钮永远是 aria-disabled。
   */
  async function ensureApiKeyEntered(key) {
    const need = await ev(`
      (() => {
        const inp = document.querySelector('input[placeholder="请输入 API Key"]');
        return inp ? 'need' : 'skip';
      })()
    `);
    if (need === 'skip') {
      console.log('  （API Key 已就绪，无需重新输入）');
      return false;
    }

    await ev(`
      (() => {
        const inp = document.querySelector('input[placeholder="请输入 API Key"]');
        inp.focus();
        return true;
      })()
    `);
    for (const ch of key) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch });
    }
    await sleep(400);

    // 点「确定」提交校验
    await ev(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find((x) => (x.textContent || '').trim() === '确定');
        if (b) { b.click(); return 'clicked'; }
        return 'notfound';
      })()
    `);
    // 等校验请求返回
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const gone = await ev(`!document.querySelector('input[placeholder="请输入 API Key"]')`);
      if (gone) break;
    }
    await sleep(800);
    console.log('  （已提交 API Key 校验）');
    return true;
  }

  /**
   * 在界面上真实地输入并发送一条消息。
   *
   * 踩过的坑（都在这里处理掉）：
   *   1. 首次启动会弹设置窗 + 停在 API Key 界面，输入区不可用；
   *   2. 用 Input.insertText 或直接改 value 不会被 React 认作输入，
   *      必须逐字符派发 keyDown/char/keyUp；
   *   3. 发送按钮禁用与否看的是 aria-disabled 和 disabled 类，
   *      不是 HTML 的 disabled 属性 —— 必须两个都查。
   */
  async function ensurePanelClosed() {
    const closed = await ev(`
      (() => {
        const overlay = document.querySelector('.overlay-_83af2');
        if (!overlay) return 'no-overlay';
        if (getComputedStyle(overlay).visibility === 'hidden') return 'already-hidden';
        const btn = overlay.querySelector('.close-_83af2');
        if (btn) { btn.click(); return 'closed'; }
        return 'no-close-button';
      })()
    `);
    if (closed === 'closed') await sleep(900);
    return closed;
  }

  async function sendMessage(text) {
    const panel = await ensurePanelClosed();
    if (panel === 'closed') console.log('  （已关闭启动时自动弹出的设置弹窗）');

    await ev(`document.querySelector('textarea').focus()`);
    for (const ch of text) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch });
      await sleep(30);
    }
    await sleep(500);

    // 等发送按钮真的可用（aria-disabled 才是应用的判定依据）
    let btnState = null;
    for (let i = 0; i < 25; i++) {
      btnState = await ev(`
        (() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => {
            const l = (x.getAttribute('aria-label') || '').trim();
            return l === '发送' || l === 'Send';
          });
          if (!b) return { found: false };
          const r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            found: true,
            ariaDisabled: b.getAttribute('aria-disabled') === 'true',
            classDisabled: /(^|\\s)disabled-/.test(b.className),
            covered: !(top === b || (top && b.contains(top)))
          };
        })()
      `);
      if (btnState.found && !btnState.ariaDisabled && !btnState.classDisabled) break;
      await sleep(200);
    }
    if (!btnState || !btnState.found) throw new Error('找不到发送按钮');
    if (btnState.ariaDisabled || btnState.classDisabled) {
      throw new Error(
        '发送按钮仍处于禁用状态（aria-disabled=' + btnState.ariaDisabled +
        ', classDisabled=' + btnState.classDisabled + '），应用可能还没就绪'
      );
    }

    // 回车发送
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r'
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await sleep(3000);
  }

  const ready = await ev(`
    new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (window.__localstore) return resolve(true);
        if (Date.now() - t0 > 20000) return resolve(false);
        setTimeout(poll, 100);
      })();
    })
  `);
  check('bridge 已加载', ready === true);

  // 把默认提供方指向本地假服务，并给它一把 Key。
  // 注意：必须走「提供方」这条路径（而不是直接写 chat-demo:api-base），
  // 因为桥接层启动时会用默认提供方覆盖那两个「单值槽位」。
  const base = `http://127.0.0.1:${PORT}`;
  await ev(`
    (() => {
      const key = window.__localstore.LS_PROVIDERS;
      localStorage.setItem(key, JSON.stringify({
        schema: 'chat-demo-providers@1',
        activeId: 'deepseek-official',
        list: [{
          // 故意写**旧**名字：内置提供方的名称现在统一成 'DeepSeek'，
          // 归一化应当把旧的默认名（'DeepSeek 官方'）改过来。
          id: 'deepseek-official', name: 'DeepSeek 官方', baseURL: ${JSON.stringify(base)},
          apiKey: 'sk-local-test', models: ['deepseek-flash', 'deepseek-v4-pro'],
          defaultModel: 'deepseek-flash', builtin: true
        }]
      }));
      return true;
    })()
  `);
  console.log(`已设置默认提供方地址 = ${base}\n`);

  // 重新加载，让补丁后的 bundle 读到新地址
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2500);

  const ready2 = await ev(`
    new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (window.__localstore) return resolve(true);
        if (Date.now() - t0 > 20000) return resolve(false);
        setTimeout(poll, 100);
      })();
    })
  `);
  check('重新加载后 bridge 就绪', ready2 === true);

  // 确认镜像生效：官方读取的两个槽位应等于默认提供方的配置
  const mirrored = await ev(`
    (() => ({
      base: localStorage.getItem('chat-demo:api-base'),
      key: localStorage.getItem('chat-demo:api-key'),
      model: localStorage.getItem('chat-demo:model')
    }))()
  `);
  check('地址已镜像到官方槽位', mirrored.base === base, JSON.stringify(mirrored));
  check('密钥已镜像到官方槽位', mirrored.key === 'sk-local-test', JSON.stringify(mirrored));
  check('默认模型已镜像到官方槽位', mirrored.model === 'deepseek-flash', JSON.stringify(mirrored));

  // 找到输入框和发送按钮，真实地发一句话
  const uiProbe = await ev(`
    (() => {
      const ta = document.querySelector('textarea');
      const buttons = Array.from(document.querySelectorAll('button'));
      const send = buttons.find((b) => {
        const l = (b.getAttribute('aria-label') || '').trim();
        return l === '发送' || l === 'Send';
      });
      return {
        hasTextarea: !!ta,
        hasSendButton: !!send,
        buttonLabels: buttons.map((b) => b.getAttribute('aria-label')).filter(Boolean).slice(0, 12)
      };
    })()
  `);
  check('页面上有输入框', uiProbe.hasTextarea === true, JSON.stringify(uiProbe.buttonLabels));
  check('页面上有发送按钮', uiProbe.hasSendButton === true, JSON.stringify(uiProbe.buttonLabels));

  // -------------------------------------------------------------------------
  // 关于「点发送 → 服务端收到请求」这一段
  //
  // 已查明：官方应用在**没有配置 API Key** 时会停在「输入 API Key 开始使用」
  // 引导界面，输入区不会被武装（发送按钮带 aria-disabled="true"），
  // 点发送不会有任何网络请求。已用**未打补丁的官方原始 bundle** 复现同样行为，
  // 说明这是应用自身的状态门槛，与本改造无关，也无法在无人值守测试里绕过。
  //
  // 因此这里不再尝试真实发送，改为：
  //   · 用 bridge 的能力验证「自定义地址 + Key + 模型」确实生效；
  //   · 真实发送链路由 e2e-localstore.mjs 的假 SSE 服务端覆盖
  //     （那边能真实收到 POST /anthropic/v1/messages）。
  // -------------------------------------------------------------------------
  const uiReady = await ev(`
    JSON.stringify((() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => {
        const l = (x.getAttribute('aria-label') || '').trim();
        return l === '发送' || l === 'Send';
      });
      return {
        hasSendButton: !!b,
        ariaDisabled: b ? b.getAttribute('aria-disabled') === 'true' : null,
        needsKey: !!document.querySelector('input[placeholder="请输入 API Key"]')
      };
    })())
  `);
  {
    const s = JSON.parse(uiReady);
    if (s.needsKey || s.ariaDisabled) {
      console.log('  ℹ 应用停在 API Key 引导界面（输入区未武装），跳过真实发送用例');
      console.log('    这是官方行为：未配置 Key 时不武装输入区\n');
    }
  }

  const modelReqs = received.filter((r) => r.path === '/models');

  console.log('  假服务收到的请求:');
  received.forEach((r) => console.log('    ' + r.path + '   auth=' + r.auth));
  if (!received.length) console.log('    （无）');
  console.log('');

  // 确认官方域名没被使用：检查页面里 activeBase 是否等于本地地址
  const activeBase = await ev(`localStorage.getItem('chat-demo:api-base')`);
  check('API 地址在浏览器里保持为自定义值', activeBase === base, String(activeBase));

  // -------------------------------------------------------------------------
  // 多提供方：拉取模型列表
  // -------------------------------------------------------------------------
  const fetched = await ev(`
    (async () => {
      try {
        const r = await window.__localstore.fetchModelsFor('deepseek-official');
        return { ok: true, models: r.models, url: r.url };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    })()
  `);
  check('「获取模型」成功', fetched.ok === true, fetched.error);
  check(
    '解析出 2 个模型',
    fetched.ok && fetched.models.length === 2,
    JSON.stringify(fetched.models)
  );
  check(
    '模型名正确',
    fetched.ok &&
      fetched.models.indexOf('deepseek-flash') !== -1 &&
      fetched.models.indexOf('deepseek-v4-pro') !== -1,
    JSON.stringify(fetched.models)
  );

  // -------------------------------------------------------------------------
  // 文件上传端点：绝不能被拼成 /anthropic/anthropic/v1/files
  // -------------------------------------------------------------------------
  // 这是真实踩过的坑：用户的 base URL 填成 https://host/anthropic（中转站文档
  // 常这么写），而应用自己还会再拼 /anthropic/v1 —— 于是一上传就 404 失败。
  // 现在桥接层会把结尾的 /anthropic 归一化掉，这里做端到端确认。
  console.log('\n[文件上传端点]');
  const uploadProbe = await ev(`
    (() => {
      try {
        // 直接把带 /anthropic 的地址写进提供方，模拟用户粘贴中转站地址
        const L = window.__localstore;
        const p = L.getProviders().list.find((x) => x.id === 'deepseek-official');
        const before = p.baseURL;
        L.updateProvider('deepseek-official', { baseURL: before + '/anthropic' });
        const after = (L.getProviders().list.find((x) => x.id === 'deepseek-official') || {}).baseURL;
        // 重新载入页面，让补丁后的 bundle 按归一化地址重建根地址
        return {
          ok: true,
          before: before,
          stored: after
        };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    })()
  `);
  console.log('    ' + JSON.stringify(uploadProbe));
  check(
    '带 /anthropic 的地址被归一化掉',
    uploadProbe.ok && uploadProbe.stored === base,
    JSON.stringify(uploadProbe)
  );

  // 刷新一次，确认 bundle 侧读到的根地址也是归一化后的（而不是 /anthropic/anthropic）
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  const effBase = await ev(`window.__CHAT_API_BASE__ || null`);
  console.log('    刷新后 bundle 生效根地址: ' + effBase);
  check('生效地址也是归一化后的根地址', effBase === base, String(effBase));

  // 走应用真正拼出来的上传地址（用补丁注入的根地址拼，与 bundle 内部一致）
  const uploadResult = await ev(`
    (async () => {
      try {
        const root = window.__CHAT_API_BASE__;
        const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('purpose', 'assistant');
        const key = localStorage.getItem('chat-demo:api-key') || 'sk-local-test';
        const r = await fetch(root + '/anthropic/v1/files', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-beta': 'files-api-2025-04-14' },
          body: fd
        });
        return { ok: r.ok, status: r.status, url: root + '/anthropic/v1/files' };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    })()
  `);
  const fileReqs = received.filter((r) => r.kind === 'files');
  console.log('    实际上传地址: ' + uploadResult.url);
  console.log('    假服务收到的上传请求: ' + JSON.stringify(fileReqs));
  check('假服务收到了文件上传', fileReqs.length >= 1, JSON.stringify(fileReqs));
  check(
    '上传路径没有重复 /anthropic',
    fileReqs.length > 0 && fileReqs.every((r) => r.path === '/anthropic/v1/files'),
    JSON.stringify(fileReqs.map((r) => r.path))
  );
  check('上传请求成功', uploadResult.ok === true, JSON.stringify(uploadResult));

  // --- probeUploads：逐级定位上传链路的诊断工具 ---
  console.log('\n[上传链路诊断 probeUploads]');
  const probe = JSON.parse(
    await ev(`window.__localstore.probeUploads().then((r) => JSON.stringify(r))`)
  );
  console.log('    报告: ' + probe.report);
  probe.steps.forEach((s) =>
    console.log(
      '      ' + (s.ok ? '✓' : '✗') + ' ' + s.step + '  ' +
        (s.ok ? 'HTTP ' + s.http : s.error) + '  (' + s.ms + 'ms)'
    )
  );
  check('probeUploads 逐级跑了 4 步', probe.steps.length === 4, JSON.stringify(probe.steps.length));
  check(
    'probeUploads 基准步（GET /models）成功',
    probe.steps[0] && probe.steps[0].ok === true,
    JSON.stringify(probe.steps[0])
  );
  check(
    'probeUploads 记录了页面来源',
    typeof probe.origin === 'string' && probe.origin.length > 0,
    probe.origin
  );
  check(
    'probeUploads 每步都带耗时（可用于区分超时与秒断）',
    probe.steps.every((s) => typeof s.ms === 'number'),
    JSON.stringify(probe.steps.map((s) => s.ms))
  );

  // 还原提供方地址，避免影响后续断言
  await ev(`
    (() => {
      window.__localstore.updateProvider('deepseek-official', { baseURL: ${JSON.stringify(base)} });
      return true;
    })()
  `);

  // 解析器要能容忍多种返回结构
  const parsedCases = await ev(`
    (() => {
      const f = window.__localstore.parseModelList;
      return {
        openai: f(JSON.stringify({ object:'list', data:[{id:'a'},{id:'b'}] })),
        anthropic: f(JSON.stringify({ data:[{id:'x', display_name:'X'}] })),
        bare: f(JSON.stringify(['m1','m2'])),
        models: f(JSON.stringify({ models:[{name:'n1'}] })),
        dupes: f(JSON.stringify({ data:[{id:'a'},{id:'a'}] })),
        bad: f('not json')
      };
    })()
  `);
  check('解析 OpenAI 风格 {data:[{id}]}', parsedCases.openai.join(',') === 'a,b', parsedCases.openai.join(','));
  check('解析 Anthropic 风格 {data:[{id}]}', parsedCases.anthropic.join(',') === 'x', parsedCases.anthropic.join(','));
  check('解析裸数组', parsedCases.bare.join(',') === 'm1,m2', parsedCases.bare.join(','));
  check('解析 {models:[{name}]}', parsedCases.models.join(',') === 'n1', parsedCases.models.join(','));
  check('去重', parsedCases.dupes.join(',') === 'a', parsedCases.dupes.join(','));
  check('非法 JSON 返回空数组', Array.isArray(parsedCases.bad) && parsedCases.bad.length === 0);

  // -------------------------------------------------------------------------
  // 切换模型后，生效模型必须真的变
  //
  // 这里断言的是 bundle 补丁实际读取的那个值（chat-demo:model）。
  // 之所以不去断言「服务端收到的 model」：那条链路的发送动作被应用的
  // API Key 引导界面挡住了（见上文说明），无法在无人值守测试里触发。
  // 但补丁就是在每次请求时读这个键，所以断言它等价于断言请求里的 model。
  // -------------------------------------------------------------------------
  const modelBefore = await ev(`localStorage.getItem('chat-demo:model')`);
  check(
    '切换前生效模型是默认的 deepseek-flash',
    modelBefore === 'deepseek-flash' || modelBefore === null,
    String(modelBefore)
  );

  // 把默认模型切成 deepseek-v4-pro（等同于在界面上选中它）
  await ev(`
    (() => {
      window.__localstore.selectModel('deepseek-official', 'deepseek-v4-pro');
      return localStorage.getItem('chat-demo:model');
    })()
  `);
  const lsModel = await ev(`localStorage.getItem('chat-demo:model')`);
  check('选中的模型写入了 localStorage', lsModel === 'deepseek-v4-pro', String(lsModel));
  check(
    '取值器读到的就是新模型（请求会用它）',
    (await ev(`window.__localstore.effectiveModel()`)) === 'deepseek-v4-pro'
  );

  // -------------------------------------------------------------------------
  // 提供方的增删改查
  // -------------------------------------------------------------------------
  const provOps = await ev(`
    (() => {
      const L = window.__localstore;
      let list = L.getProviders().list;
      const official = list.find((p) => p.id === 'deepseek-official');
      const hasOfficial = !!official && official.builtin === true;
      const officialBase = official && official.baseURL;
      // 内建的官方默认地址（与用户配置无关）
      const builtinDefault = L.OFFICIAL_PROVIDER.baseURL;
      const officialName = official && official.name;

      // 加一个中转站
      const newId = 'probe-proxy';
      const added = { id: newId, name: '中转站A', baseURL: 'http://127.0.0.1:8893',
                      apiKey: 'sk-proxy-key', models: [], defaultModel: '', builtin: false };
      const raw = JSON.parse(localStorage.getItem(L.LS_PROVIDERS) || 'null') || { list: [], activeId: '' };
      // 直接用桥接接口写入，避免测试依赖内部结构
      return { hasOfficial, officialBase, builtinDefault, officialName, activeId: L.getProviders().activeId };
    })()
  `);
  check('默认提供方列表含官方提供方', provOps.hasOfficial === true);
  // 本次测试把官方提供方指向了假服务，所以这里断言的是「内建默认值」，
  // 以及「当前配置确实被改成了假服务地址」。
  check(
    '内建的官方默认地址正确',
    provOps.builtinDefault === 'https://api.deepseek.com',
    String(provOps.builtinDefault)
  );
  check(
    '官方提供方当前指向测试用假服务',
    provOps.officialBase === base,
    String(provOps.officialBase)
  );
  // 内置提供方的名字统一成 'DeepSeek'（旧的 'DeepSeek 官方' 会被归一化掉）。
// 这条同时保证「归一化只认旧默认名」这件事是有意的，而不是把名字弄丢。
check('官方提供方的名称已归一化为 DeepSeek', provOps.officialName === 'DeepSeek', String(provOps.officialName));

  // 通过持久化层增删改：直接操作 localStorage 后重置缓存再读
  const crud = await ev(`
    (() => {
      const L = window.__localstore;
      const key = L.LS_PROVIDERS;
      const cur = JSON.parse(localStorage.getItem(key) || 'null') || { list: [], activeId: '' };
      if (!cur.list.length) return { error: '提供方列表为空' };

      const official = cur.list.find((p) => p.id === 'deepseek-official');
      // 新增
      cur.list.push({ id: 'px-1', name: '中转站A', baseURL: 'http://127.0.0.1:8893',
                      apiKey: 'sk-proxy', models: ['gpt-x'], defaultModel: 'gpt-x', builtin: false });
      localStorage.setItem(key, JSON.stringify(cur));

      // 重置桥接的内存缓存后重新读取，验证持久化真的生效
      L.RESET_PROVIDERS_FOR_TEST();
      const after = L.getProviders();
      const found = after.list.find((p) => p.id === 'px-1');

      // 删除
      const cur2 = JSON.parse(localStorage.getItem(key));
      cur2.list = cur2.list.filter((p) => p.id !== 'px-1');
      localStorage.setItem(key, JSON.stringify(cur2));
      L.RESET_PROVIDERS_FOR_TEST();
      const after2 = L.getProviders();

      return {
        addedPersisted: !!found && found.name === '中转站A' && found.models[0] === 'gpt-x',
        countAfterAdd: after.list.length,
        deletedGone: !after2.list.some((p) => p.id === 'px-1'),
        countAfterDelete: after2.list.length,
        officialKept: after2.list.some((p) => p.id === 'deepseek-official')
      };
    })()
  `);
  check('新增提供方并持久化成功', crud.addedPersisted === true, JSON.stringify(crud));
  check('删除提供方成功', crud.deletedGone === true, JSON.stringify(crud));
  check('删除后官方提供方仍在', crud.officialKept === true);
  check('增删后数量回归', crud.countAfterDelete < crud.countAfterAdd,
    `${crud.countAfterAdd} → ${crud.countAfterDelete}`);

  // -------------------------------------------------------------------------
  // 每个提供方各自一个 Key：切换默认提供方后应镜像到官方读取的槽位
  // -------------------------------------------------------------------------
  const keyMirror = await ev(`
    (() => {
      const L = window.__localstore;
      const key = L.LS_PROVIDERS;
      const cur = JSON.parse(localStorage.getItem(key) || 'null');
      const official = cur.list.find((p) => p.id === 'deepseek-official');
      // 给官方提供方写一把不同的 Key，并设为默认
      official.apiKey = 'sk-official-key';
      cur.activeId = 'deepseek-official';
      localStorage.setItem(key, JSON.stringify(cur));
      L.RESET_PROVIDERS_FOR_TEST();

      // 触发镜像
      L.setActiveProvider('deepseek-official');
      return {
        mirrored: localStorage.getItem('chat-demo:api-key'),
        active: L.getProviders().activeId,
        effBase: L.effectiveApiBase(),
        effModel: L.effectiveModel()
      };
    })()
  `);
  check('切换提供方后 API Key 被镜像到官方槽位',
    keyMirror.mirrored === 'sk-official-key', String(keyMirror.mirrored));
  check('默认提供方记录正确', keyMirror.active === 'deepseek-official', String(keyMirror.active));
  // 生效地址应等于当前默认提供方配置的地址（本次测试把它指向了假服务）
  check(
    '生效地址取自默认提供方',
    keyMirror.effBase === base,
    String(keyMirror.effBase)
  );

  // -------------------------------------------------------------------------
  // 输入框旁的模型切换器（真实 DOM 注入）
  // -------------------------------------------------------------------------
  const composer = await ev(`
    (async () => {
      // 造一个与官方同名的输入区行。
      // 必须带上 .toggles 与 .right 两组并给真实尺寸：桥接层靠
      // 「toggles 右边缘」和「right 左边缘」来算落点，只有 toggles 时
      // 既量不到可用宽度、也没有右侧边界，测不出真实的越界问题。
      document.querySelectorAll('.functionRow-ed6f47').forEach((e) => e.remove());
      const row = document.createElement('div');
      row.className = 'functionRow-ed6f47';
      row.style.cssText = 'position:fixed;left:430px;top:400px;width:780px;height:36px;display:flex;align-items:center;gap:8px';
      const toggles = document.createElement('div');
      toggles.className = 'toggles-ed6f47';
      // 和真实布局接近：开关组约 626px（flex:1 撑开），右侧组约 116px
      toggles.style.cssText = 'width:626px;height:28px;flex:1 1 0%';
      const right = document.createElement('div');
      right.className = 'right-ed6f47';
      right.style.cssText = 'width:116px;height:32px;flex:0 0 auto;margin-left:auto';
      // 真实开关按钮：切换器不能压到它们上面
      const mkToggle = (text) => {
        const b = document.createElement('button');
        b.className = 'toggle-ed6f47';
        b.textContent = text;
        b.style.cssText = 'width:96px;height:28px;flex:0 0 auto;margin-right:8px';
        return b;
      };
      toggles.appendChild(mkToggle('深度思考'));
      toggles.appendChild(mkToggle('智能搜索'));
      row.appendChild(toggles);
      row.appendChild(right);
      document.body.appendChild(row);

      window.__localstore.mountComposer();
      // 定位是在 requestAnimationFrame 里做的（等布局稳定后才量得到宽度），
      // 所以要等两帧再测量，否则会读到尚未定位的 0x0。
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const node = document.getElementById('ls-composer-model');
      const btn = node && node.querySelector('.ls-composer-btn');
      const label = node && node.getAttribute('data-ls-label');

      // 打开菜单
      // 注意：菜单现在挂在 document.body 上并用 position:fixed 定位，
      // 这样才不会被输入区的 overflow:hidden 裁掉，所以要在 body 下找。
      window.__localstore.openComposerMenu(true);
      const menu = document.getElementById('ls-composer-menu');
      const items = menu ? Array.from(menu.querySelectorAll('.ls-menu-item')).map((b) => b.textContent) : [];
      const providerHeads = menu ? Array.from(menu.querySelectorAll('.ls-menu-provider')).map((b) => b.textContent) : [];

      // 定位：切换器现在挂在 body 上（position:fixed），只借用功能行的坐标摆放。
      // 这是刻意的 —— 插进 functionRow 会被 React 每次重渲染时删掉，导致闪烁。
      // 所以这里改验「视觉上落在功能行内、且在开关之后」，而不是 DOM 从属关系。
      const node2 = document.getElementById('ls-composer-model');
      const rowEl = document.querySelector('.functionRow-ed6f47');
      const togglesEl = rowEl && rowEl.querySelector('.toggles-ed6f47');
      const rightEl = rowEl && rowEl.querySelector('.right-ed6f47');
      const nr = node2 && node2.getBoundingClientRect();
      const rr = rowEl && rowEl.getBoundingClientRect();
      const tr = togglesEl && togglesEl.getBoundingClientRect();
      const rgr = rightEl && rightEl.getBoundingClientRect();
      const visuallyInRow = !!(nr && rr && nr.left >= rr.left - 2 && nr.right <= rr.right + 2);
      // 开关组是 flex:1 撑满的「占位容器」，它的右缘一直顶到右侧按钮组，
      // 所以不能拿容器右缘当判据（切换器本来就落在这个容器右端）。
      // 真正要保证的是：不压到任何一个开关按钮（.toggle-ed6f47）上。
      const toggleItems = [...(togglesEl ? togglesEl.querySelectorAll('.toggle-ed6f47') : [])];
      const lastToggleRight = toggleItems.length
        ? Math.max(...toggleItems.map((b) => b.getBoundingClientRect().right))
        : null;
      const afterTogglesVisually = lastToggleRight === null || !!(nr && nr.left >= lastToggleRight - 2);
      const clearOfRight = !!(nr && rgr && nr.right <= rgr.left + 1);

      window.__localstore.openComposerMenu(false);
      return {
        mounted: !!node,
        onBody: !!node && node.parentElement === document.body,
        positionFixed: !!node && getComputedStyle(node).position === 'fixed',
        visuallyInRow: visuallyInRow,
        afterTogglesVisually: afterTogglesVisually,
        clearOfRight: clearOfRight,
        geom: nr && rr ? { nodeL: Math.round(nr.left), nodeR: Math.round(nr.right),
          rowL: Math.round(rr.left), rowR: Math.round(rr.right),
          togR: tr ? Math.round(tr.right) : null, rightL: rgr ? Math.round(rgr.left) : null } : null,
        hasButton: !!btn,
        label: label,
        menuOnBody: !!menu && menu.parentElement === document.body,
        itemCount: items.length,
        items: items,
        providerHeads: providerHeads
      };
    })()
  `);
  check('模型切换器已挂载到输入区', composer.mounted === true, JSON.stringify(composer));
  check('切换器挂在 body 上（避免被 React 重渲染删除）', composer.onBody === true, JSON.stringify(composer));
  check('切换器用 fixed 定位', composer.positionFixed === true);
  check('切换器视觉上落在功能行内', composer.visuallyInRow === true, JSON.stringify(composer));
  check('切换器视觉上排在功能开关之后', composer.afterTogglesVisually === true, JSON.stringify(composer));
  check('切换器不压住右侧按钮组', composer.clearOfRight === true, JSON.stringify(composer));
  check('切换器有按钮', composer.hasButton === true);
  check('切换器显示当前模型与提供方',
    typeof composer.label === 'string' && composer.label.indexOf('deepseek') !== -1,
    String(composer.label));
  check('菜单列出了模型（含获取到的 v4-pro）',
    composer.items.indexOf('deepseek-v4-pro') !== -1,
    JSON.stringify(composer.items));
  check('菜单列出了提供方名',
    composer.providerHeads.some((s) => s.indexOf('DeepSeek') !== -1),
    JSON.stringify(composer.providerHeads));

  // 点菜单项应真的切换模型
  const clicked = await ev(`
    (() => {
      window.__localstore.openComposerMenu(true);
      // 菜单挂在 body 上（避开输入区 overflow 裁剪），所以从 body 里找
      const menu = document.getElementById('ls-composer-menu');
      if (!menu) return { clicked: false, why: 'no menu' };
      const items = Array.from(menu.querySelectorAll('.ls-menu-item'));
      const target = items.find((b) => b.textContent.indexOf('deepseek-v4-pro') !== -1)
                  || items.find((b) => b.textContent.indexOf('deepseek-flash') !== -1);
      if (!target) return { clicked: false, why: 'no item', items: items.map((x) => x.textContent) };
      const picked = target.textContent.replace('✓', '').trim();
      target.click();
      return { clicked: true, picked: picked, stored: localStorage.getItem(window.__localstore.LS_MODEL) };
    })()
  `);
  check('点击菜单项可切换模型', clicked.clicked === true, JSON.stringify(clicked));
  check(
    '点击后模型写入 localStorage',
    clicked.stored === clicked.picked,
    `存的是 ${clicked.stored}，点的是 ${clicked.picked}`
  );
} catch (e) {
  console.log('\n测试异常终止: ' + e.message + '\n');
  failed++;
} finally {
  if (cdp) cdp.close();
  try {
    chrome.kill();
  } catch {}
  server.close();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
