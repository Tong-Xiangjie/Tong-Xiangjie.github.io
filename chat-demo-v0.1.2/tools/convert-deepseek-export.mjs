#!/usr/bin/env node
/**
 * 把 DeepSeek 官方的对话导出（deepseek_data-*）转成我们页面的「导入」格式。
 *
 * 为什么要做成离线脚本，而不是改页面代码：
 *   官方导出是 2763 个会话 / 170MB 对话 + 1000 个附件 / 346MB，一次性塞进
 *   浏览器必然卡死。跑在 Node 里可以分批、可以流式处理，而且**页面代码
 *   一行都不用动** —— 现有的导入逻辑（按 id + updatedAt 合并、从不删除）
 *   直接复用。
 *
 * 格式差异（这是核心工作）：
 *
 *   官方                                     我们
 *   ──────────────────────────────────────   ─────────────────────────────
 *   目录：manifest.json + index + sessions/   单个 .json 文件
 *   messages[] 扁平 + parent_id 往回指        messages[] 扁平 + selectedChildId 往前指
 *   current_message_id 指向分支**末端**        从 rootMessageId 顺 selectedChildId 往下
 *   fragments[] 按类型拆块                     content 字符串 / blocks 块数组
 *   role: USER / ASSISTANT                    role: user / assistant
 *   inserted_at: ISO 字符串                    createdAt / updatedAt: 毫秒数
 *   附件在 export_path 指向的外部文件            files[] 里 base64 内嵌
 *
 * 用法：
 *   node tools/convert-deepseek-export.mjs <官方导出目录> <输出文件> [选项]
 *
 * 选项：
 *   --limit=N          只转 N 个会话（跑通验证用）
 *   --no-attachments   不内嵌附件，只导对话
 *   --index=N          从索引的第 N 条开始（配合 --limit 分批）
 *   --max-mb=N         单个输出文件的目标上限（默认 120 MB），到了就自动切下一批
 *   --max-sessions=N   每包最多几个会话（0 = 不限），到了就切下一批
 *
 * 两个上限同时生效，谁先到就切。**会话数是更重要的那个**：实测同样的数据里
 * 1618 个会话 / 42 MB 会让页面渲染空白，而 135 个会话 / 70 MB 正常 ——
 * 说明压住渲染的是会话条数，不是体积。所以小批量导时用 --max-sessions 控制。
 *
 * 为什么要按体积切、而不是按会话个数：
 *   附件分布极不均匀 —— 中位数会话只有 18 KB，最大 1.9 MB，但附件全挤在
 *   少数会话里。实测「前 20 个会话」就出了 165 MB。按个数切会做出一个
 *   几百 MB 的包，而页面导入是 JSON.parse 整个文件，峰值内存约 2~3 倍，
 *   500 MB 的包就要 1.25 GB 内存，浏览器会卡死。
 *   所以这里按**累计字节**切，保证每个包都在安全范围内。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = args.filter((a) => a.startsWith('--'));

const srcDir = positional[0];
const outFile = positional[1];
if (!srcDir || !outFile) {
  console.error('用法: node tools/convert-deepseek-export.mjs <官方导出目录> <输出文件> [--limit=N] [--no-attachments] [--index=N]');
  process.exit(1);
}
const optLimit = (() => {
  const f = flags.find((x) => x.startsWith('--limit='));
  return f ? parseInt(f.split('=')[1], 10) : 0;
})();
const optIndex = (() => {
  const f = flags.find((x) => x.startsWith('--index='));
  return f ? parseInt(f.split('=')[1], 10) : 0;
})();
const optMaxMb = (() => {
  const f = flags.find((x) => x.startsWith('--max-mb='));
  return f ? parseFloat(f.split('=')[1]) : 120;
})();
const withAttachments = !flags.includes('--no-attachments');
const MAX_BYTES = Math.max(1, optMaxMb) * 1024 * 1024;
/**
 * 每个包最多几个会话（0 = 不限制）。
 *
 * 为什么要加这个：实测在无头浏览器里，**会话数**比文件大小更能预测"页面渲染空白"。
 * 1618 个会话 / 42 MB 会空白，而 135 个会话 / 70 MB 正常。
 * 所以为了安全，这里按会话数切小包（默认配合 --max-mb 一起当上限，谁先到就切）。
 */
const optMaxSessions = (() => {
  const f = flags.find((x) => x.startsWith('--max-sessions='));
  return f ? parseInt(f.split('=')[1], 10) : 0;
})();

// ---------------------------------------------------------------------------
// 官方导出里，哪些片段类型算"正文"
//
// 依据：扫过 400 个会话的片段分布
//   RESPONSE 1907  REQUEST 1887  THINK 1710    ← 正文，必须保留
//   TOOL_OPEN 1318  TOOL_SEARCH 372  TOOL_FIND 3  TOOL_IMAGE_SEARCH 1
//   CONTENT_RISK 413  FILE 224  TEMPLATE_RESPONSE 14  READ_LINK 1
//
// TOOL_* 是联网搜索/工具的中间过程，不是用户看到的正文，丢掉；
// CONTENT_RISK 是内容风控标记，没有正文内容，丢掉；
// TEMPLATE_RESPONSE 是模板回复（如"正在搜索"），丢掉。
// ---------------------------------------------------------------------------
const TEXT_FRAGMENTS = new Set(['REQUEST', 'RESPONSE']);

/**
 * 官方导出不存 mimeType，只能按文件名后缀推。
 * 必须在 attachFor() 被调用之前初始化（否则命中 TDZ）。
 */
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};

function guessMime(name) {
  const e = extname(name || '').toLowerCase();
  return MIME_BY_EXT[e] || 'application/octet-stream';
}

function toMillis(iso) {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** 官方把消息 id 存成数字，我们统一用字符串 */
function mid(n) {
  return n == null ? null : String(n);
}

/**
 * 把一条官方消息的 fragments 转成我们的 content。
 *
 * 目标形状必须跟应用自己的一致（这是从桥接层 renderMarkdown 与 bundle 里
 * 反查出来的）：
 *   · 用户消息：content 为**字符串**
 *   · 助手消息：blocks 数组，元素 {type:'text', text, citations}
 *                                    {type:'thinking', thinking, signature}
 * 思维链保留成 thinking 块，应用会把它渲染成「深度思考」折叠块。
 */
function fragmentsToContent(frags, role) {
  const texts = [];
  const thinks = [];
  const queries = [];
  const sources = [];
  const refs = [];          // 附件引用（只可能出现在用户消息上）
  const seenUrl = new Set();
  let kind = null;          // 'search' 或 'image_search'
  let hasSearch = false;

  for (const f of frags || []) {
    if (!f || typeof f.type !== 'string') continue;
    switch (f.type) {
      case 'THINK':
        if (typeof f.content === 'string' && f.content.trim()) thinks.push(f.content);
        break;
      case 'REQUEST':
      case 'RESPONSE':
      case 'CONTENT_RISK':
      case 'TEMPLATE_RESPONSE':
        if (typeof f.content === 'string' && f.content.trim()) texts.push(f.content);
        break;
      case 'FILE':
        for (const af of (Array.isArray(f.files) ? f.files : [])) {
          if (af && af.id) refs.push(af);
        }
        break;

      /**
       * 联网搜索：按应用**原生**的步骤结构生成，不自己造类型。
       *
       * 结构是从 bundle 里反查出来的（步骤聚合 + lk 渲染器 + lf 来源索引）：
       *   步骤  { type:'search', key, kind, queries:[], results:[], status }
       *   来源  { url, title, siteName, publishedAt, snippet, siteIcon, index }
       * kind：'search' | 'image_search'（'deep_search'/'deep_image_search' 走深搜 UI）
       * status：'done' | 'wip' | 'failed'
       *
       * 这样做的价值：直接复用应用原生的"已搜索 N 个结果"那一行 UI 与来源列表，
       * 观感跟官网一致，不需要任何页面改动。
       *
       * 诚实说明：官方导出里 TOOL_SEARCH.results 恒为空，搜索结果本身没被导出；
       * 能拿到的只有查询词（queries）和打开过的网页（TOOL_OPEN 的 url/title/摘要）。
       * 所以"结果数"就是"打开过的网页数"，不是当时真实的搜索结果总数。
       */
      case 'TOOL_SEARCH': {
        hasSearch = true;
        if (!kind) kind = 'search';
        const q = String(f.queries || '').trim();
        if (q) queries.push(q);
        break;
      }
      case 'TOOL_IMAGE_SEARCH':
        hasSearch = true;
        kind = 'image_search';
        break;
      case 'TOOL_OPEN': {
        hasSearch = true;
        if (!kind) kind = 'search';
        const url = String(f.url || '').trim();
        if (!url || seenUrl.has(url)) break;
        seenUrl.add(url);
        sources.push({
          url: url,
          title: f.title || url,
          siteName: String(f.site_name || '').trim() || hostOf(url),
          publishedAt: f.published_at || null,
          snippet: f.snippet == null ? null : String(f.snippet).trim(),
          siteIcon: f.site_icon || null,
          index: sources.length + 1
        });
        break;
      }
      case 'TOOL_FIND':
      case 'READ_LINK':
        // 应用没有对应的渲染分支（步骤聚合只认 search / open / find / read_link
        // 里的 server_tool_use 形状），这里不造假类型，直接跳过。
        break;
      default:
        // 未知类型不猜
        break;
    }
  }

  // 用户消息的 content 只能是字符串（多个片段按空行拼）
  if (role === 'user') {
    return { content: texts.join('\n\n'), refs: refs };
  }

  /**
   * 助手消息：**字段名是 blocks，不是 content**。
   *
   * ★ 这个坑我踩了很久，记在这里 ★
   *
   * 我一开始按"块数组放 content"写，验证时库里数得出来、但页面上一个字都没有。
   * 当时以为是块类型不对，试了自定义 ls_tool、又试了 {type:'search'}，
   * 全都"存进去看不见"。真正的根因是字段名：
   *
   *   用户消息   → { content: "字符串" }
   *   助手消息   → { blocks: [ {type:'text',…}, {type:'thinking',…} ] }
   *
   * 证据来自用户真实导出的会话记录（chat-demo-导出-*.json）：
   *   4 条 user  : content|createdAt|files|id|parentId|role|selectedChildId
   *  14 条 assistant: blocks|createdAt|error|id|latestReminder|model|parentId|
   *                   prefix|role|search|status|thinking
   *
   * 助手消息还必须带 model / prefix / status / thinking / search，
   * 否则应用侧边栏与消息头渲染不出模型名等。
   *
   * ★ 块类型必须是应用**认识**的 ★
   *
   * 没有"自定义类型"这回事，渲染器对未知类型是 `default: return null`。
   * 搜索过程要发**成对的原生块**（照官方导入器 F() 的写法）：
   *
   *   server_tool_use:
   *     id, name ∈ deepseek_web_search | deepseek_read_url
   *     kind ∈ search | deep_search | read_link | image_search | deep_image_search
   *     input.action='search' 且 input.queries 是非空字符串数组
   *
   *   web_search_tool_result:
   *     tool_use_id = 上面那个 id（聚合时靠它配对）
   *     kind 同上，content: [ {type:'web_search_result', url, title, snippet,
   *                           site_icon, site_name, page_age, encrypted_content} ]
   *
   * 官方导出里 TOOL_SEARCH.results 恒为空，所以"结果数"就是"打开过的网页数"，
   * 不是当时真实的搜索结果总数 —— 这点如实保留，不编造。
   */
  const blocks = [];
  for (const t of thinks) blocks.push({ type: 'thinking', thinking: t, signature: null });

  /**
   * ★ kind 必须是 deep_search，不能自作聪明写 search ★
   *
   * 应用自己的导入器（F 函数）是这么决定的：
   *   let s = fragments.some(f => f.type==='TOOL_OPEN' || f.type==='TOOL_FIND')
   *           ? 'deep_search' : 'search';
   * 只要对话里"打开过网页"，整条搜索步骤的 kind 就是 deep_search。
   *
   * 而渲染器 lu(e) = ('deep_search'===e || 'deep_image_search'===e)，
   * deep_search 走的是「已阅读 N 个网页」文案，search 走「搜索到 N 个网页」。
   *
   * 我一开始写死 'search'，结果页面上显示成「已阅读 2 个网页」——
   * 不是没渲染，而是文案跟我预期的不一样。用 deep_search 才和应用原生
   * 导入同一份官方数据时的显示**完全一致**。
   */
  const effectiveKind = sources.length ? 'deep_search' : (kind || 'search');

  const toolUseId = 'toolu_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
  if (hasSearch && queries.length && sources.length) {
    blocks.push({
      type: 'server_tool_use',
      id: toolUseId,
      name: 'deepseek_web_search',
      kind: effectiveKind,
      caller: { type: 'direct' },
      input: { action: 'search', query: queries[0], queries: queries }
    });
    blocks.push({
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      kind: effectiveKind,
      content: sources.map((s) => ({
        type: 'web_search_result',
        url: s.url,
        title: s.title,
        snippet: s.snippet,
        site_icon: s.siteIcon,
        site_name: s.siteName,
        page_age: s.publishedAt || null,
        encrypted_content: ''
      }))
    });
  }

  for (const t of texts) blocks.push({ type: 'text', text: t, citations: [] });
  return { blocks: blocks, refs: refs };
}

/** 从 url 取主机名（应用自己也是这么做的：去掉开头的 www.） */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/**
 * 从官方会话还原**当前选中的那条分支**。
 *
 * 官方存的是 current_message_id（末端），每条消息有 parent_id。
 * 我们存的是 rootMessageId + 每条消息的 selectedChildId（往后指）。
 * 所以：从末端顺 parent_id 往回走到根，得到路径，再反向串成 selectedChildId。
 */
function pickActivePath(msgs, currentMessageId) {
  const byId = new Map();
  for (const m of msgs) byId.set(mid(m.id), m);

  let cursor = mid(currentMessageId);
  // current_message_id 可能指向不存在的消息（导出损坏），退回"编号最大的那条"
  if (!byId.has(cursor)) {
    let best = null;
    for (const m of msgs) {
      const id = mid(m.id);
      if (typeof m.id === 'number' && (best === null || m.id > best)) best = m.id;
    }
    cursor = best === null ? null : mid(best);
  }

  const path = [];
  const guard = new Set();
  while (cursor != null && byId.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor);
    const m = byId.get(cursor);
    path.push(m);
    cursor = mid(m.parent_id);
  }
  path.reverse();   // 现在是从根到末端
  return path;
}

/**
 * 把整棵消息树转成我们的结构（含所有旧分支，不只当前这条）。
 *
 * 为什么不一并丢掉非选中分支：官方导出是**无损**的，重新生成/编辑过的
 * 旧版本都在里面。用户明确要求保留，所以整棵树搬过去。
 *
 * 关键：selectedChildId 决定应用"看到"哪条线。
 *   · 父节点在**选中路径**上的那个子节点 → 写成 selectedChildId，会被渲染
 *   · 其它子节点 → 不写（null），数据在库里但不出现在对话里，随时可切回
 * 这样既保住"当前显示与网页一致"，又保住旧版本可追溯。
 *
 * 对不在选中路径上的节点，selectedChildId 取它的第一个子节点 —— 让它们
 * 自己也是一条可读的链，而不是断头路。
 */
function buildTree(msgs, currentMessageId) {
  const byId = new Map();
  for (const m of msgs) byId.set(mid(m.id), m);

  const active = pickActivePath(msgs, currentMessageId);
  // 选中路径上，每个父 → 它选中的那个子
  const chosenChild = new Map();
  for (let i = 0; i + 1 < active.length; i++) {
    chosenChild.set(mid(active[i].id), mid(active[i + 1].id));
  }

  // 每个父的第一个子（给非选中节点兜底，避免断头）
  const firstChild = new Map();
  for (const m of msgs) {
    const p = mid(m.parent_id);
    if (p == null) continue;
    if (!firstChild.has(p)) firstChild.set(p, mid(m.id));
  }

  const all = [];
  const allRefs = [];
  for (const m of msgs) {
    const id = mid(m.id);
    const role = String(m.role || '').toUpperCase() === 'USER' ? 'user' : 'assistant';
    const conv = fragmentsToContent(m.fragments, role);

    const msg = {
      id: id,
      role: role,
      parentId: m.parent_id == null ? null : mid(m.parent_id),
      selectedChildId: chosenChild.has(id) ? chosenChild.get(id) : (firstChild.get(id) || null)
    };

    // ★ 字段名按角色区分：用户 message 用 content（字符串），助手用 blocks（数组）
    if (role === 'user') {
      msg.content = conv.content;
    } else {
      msg.blocks = conv.blocks;
    }

    const ts = toMillis(m.inserted_at);
    if (ts != null) msg.createdAt = ts;

    // 助手消息必带的字段（缺了应用的消息头/模型名渲染不出来）
    if (role === 'assistant') {
      msg.model = null;                                  // 官方导出不记录模型名
      msg.thinking = m.thinking_enabled === true;
      msg.search = m.search_enabled === true;
      msg.prefix = false;
      msg.status = 'done';
      /**
       * latestReminder：官方导出里 62/62 条助手消息**全都有**这个字段，
       * 形如 "2026-11-20,星期五,北京市,Web,中文"（日期,星期,城市,平台,语言，城市可空）。
       * 官方导出不记录城市，这里留空；日期/星期取自消息时间。
       */
      msg.latestReminder = buildReminder(ts);
    }

    // 官方另外两个标记字段，保留下来（应用认这两个名字）
    if (m.thinking_enabled === true) msg.thinkingEnabled = true;
    if (m.search_enabled === true) msg.searchEnabled = true;
    if (typeof m.accumulated_token_usage === 'number') msg.tokens = m.accumulated_token_usage;

    /**
     * ★ 用户消息的 files 字段**必须永远存在**（没有附件就是空数组）★
     *
     * 这个 bug 导致「随便点一个对话就黑屏」，教训记在这里。
     *
     * 我原来只在有附件时才写 files：
     *     if (role === 'user' && conv.refs.length) msg.files = [...]
     * 没有附件的用户消息就没有 files 字段。而应用的输入框/消息渲染里有：
     *
     *     n.files.length > 0
     *     k = !u && (v.trim() !== '' || n.files.length > 0)
     *
     * 直接读 n.files.length —— undefined 时抛
     * `TypeError: Cannot read properties of undefined (reading 'length')`。
     * 页面没有错误边界，这个异常会把**整棵 React 树卸载**，于是 body 里只剩
     * 空 div#root + 一个浮层，也就是用户看到的"黑屏"，而且侧栏也一起没了。
     *
     * 证据：
     *   1. 官方导出里的 39 条 user 消息，**全部**有 files 字段（其中 33 条是空数组）
     *      —— 应用依赖的正是这个不变量
     *   2. 崩溃栈精确落在 main.6fd9c886.js:2:120632 的 `n.files.length` 上
     *   3. 手写一个带 files:[] 的最小会话就能正常渲染
     */
    if (role === 'user') {
      msg.files = conv.refs.map((af) => ({
        id: af.id,
        serverId: null,
        name: af.file_name == null ? null : af.file_name,
        size: af.file_size == null ? 0 : af.file_size,
        isImage: !!af.is_image,
        mimeType: guessMime(af.file_name || '')       // 官方不存 mimeType，按后缀推
      }));
      for (const af of conv.refs) allRefs.push(af);
    }

    all.push(msg);
  }

  // 根：选中路径的第一条。它不一定 parent_id 为空（可能有更早的孤儿分支），
  // 但应用从这里开始往下走，所以必须指向真正在选中路径上的那条。
  const rootId = active.length ? mid(active[0].id) : (all.length ? all[0].id : null);
  return { all, rootId, activeCount: active.length, refs: allRefs };
}

/**
 * 生成 latestReminder 字符串。
 *
 * 官方导出里助手消息 62/62 条都带这个字段，形如：
 *     "2026-11-20,星期五,,Web,中文"
 *     "2026-11-21,星期六,北京市,Web,中文"
 * 即 "日期,星期,城市,平台,语言"。城市官方不导出，留空。
 */
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
function buildReminder(millis) {
  const d = millis == null ? new Date() : new Date(millis);
  if (!Number.isFinite(d.getTime())) return '';
  const p2 = (x) => String(x).padStart(2, '0');
  const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return `${date},${WEEKDAYS[d.getDay()]},,Web,中文`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const indexPath = join(srcDir, 'chat_session_index.json');
const sessDir = join(srcDir, 'chat_sessions');
if (!existsSync(indexPath)) {
  console.error(`找不到 ${indexPath} —— 这看起来不是 DeepSeek 官方导出的目录。`);
  process.exit(1);
}
if (!existsSync(sessDir)) {
  console.error(`找不到 ${sessDir} —— 导出目录里缺少 chat_sessions/。`);
  process.exit(1);
}

const manifestPath = join(srcDir, 'manifest.json');
if (existsSync(manifestPath)) {
  try {
    const mf = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`官方导出格式版本: export_format_version=${mf.export_format_version}`);
  } catch (e) { /* 不致命 */ }
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
if (!Array.isArray(index)) {
  console.error('chat_session_index.json 不是数组，格式变了，请先检查。');
  process.exit(1);
}
console.log(`索引里有 ${index.length} 个对话`);

const slice = optLimit ? index.slice(optIndex, optIndex + optLimit) : index.slice(optIndex);
console.log(`本次处理 ${slice.length} 个${optIndex ? `（从第 ${optIndex} 条起）` : ''}`);

const fileSeen = new Set();
let stat = { noJson: 0, emptyPath: 0, attachMissing: 0, attachOk: 0, attachBytes: 0, msgTotal: 0, msgActive: 0, msgTree: 0 };

/**
 * 读一个附件并内嵌成 base64。
 *
 * 官方 export_path 是相对导出根目录的路径（形如
 * chat_sessions/<sid>_files/<file_id>_<原名>），实测指向真实文件。
 * 注意有些附件**官方压根没导出原件**（export_path 是空字符串）——
 * 那些只是把元信息留在消息的 files 里，这里如实计入 attachMissing。
 */
function readAttachment(af) {
  if (!withAttachments) return null;
  const rel = af.export_path;
  if (!rel) { stat.attachMissing++; return null; }
  const abs = join(srcDir, rel.split('/').join('\\'));
  if (!existsSync(abs)) { stat.attachMissing++; return null; }
  let buf;
  try { buf = readFileSync(abs); } catch (e) { stat.attachMissing++; return null; }
  const name = af.file_name || basename(abs);
  stat.attachOk++;
  stat.attachBytes += buf.length;
  return {
    id: af.id,
    name: name,
    mimeType: guessMime(name),
    isImage: !!af.is_image,
    serverId: null,
    blobB64: buf.toString('base64'),
    __rawBytes: buf.length
  };
}

// 当前批次
let curSessions = [];
let curFiles = [];
let curBytes = 0;          // 估算的输出字节（base64 按 1.34 倍计）
const batches = [];

function currentEstimate() {
  // base64 膨胀约 1.34；JSON 结构本身再加一点
  return curBytes * 1.34;
}

function flushBatch() {
  if (!curSessions.length) return;
  batches.push({ sessions: curSessions, files: curFiles });
  curSessions = [];
  curFiles = [];
  curBytes = 0;
}

let n = 0;
for (const meta of slice) {
  n++;
  const jf = join(sessDir, `${meta.id}.json`);
  if (!existsSync(jf)) { stat.noJson++; continue; }

  let sess;
  try {
    sess = JSON.parse(readFileSync(jf, 'utf8'));
  } catch (e) {
    console.log(`  ! 跳过无法解析的 ${meta.id}`);
    continue;
  }

  const msgs = Array.isArray(sess.messages) ? sess.messages : [];
  const tree = buildTree(msgs, sess.current_message_id);
  if (!tree.all.length) { stat.emptyPath++; continue; }
  stat.msgActive += tree.activeCount;
  stat.msgTree += tree.all.length;

  // 这个会话要带的附件（整棵树去重后读原件）
  const sessFiles = [];
  for (const af of tree.refs) {
    if (fileSeen.has(af.id)) continue;
    fileSeen.add(af.id);
    const row = readAttachment(af);
    if (row) sessFiles.push(row);
  }

  const sessRow = {
    id: sess.id,
    title: sess.title == null ? null : sess.title,
    createdAt: toMillis(sess.inserted_at),
    updatedAt: toMillis(sess.updated_at),
    rootMessageId: tree.rootId,
    messages: tree.all
  };
  curSessions.push(sessRow);
  curBytes += JSON.stringify(tree.all).length;
  for (const f of sessFiles) {
    const raw = f.__rawBytes;
    delete f.__rawBytes;
    curFiles.push(f);
    curBytes += raw;
  }
  stat.msgTotal += tree.all.length;

  if (n % 100 === 0 || n === slice.length) {
    process.stdout.write(`\r  已转换 ${n}/${slice.length} 个对话，附件 ${stat.attachOk} 个，已分 ${batches.length + 1} 批…`);
  }

  // 批次满了就切。判断放在会话**之后**，保证一个会话绝不跨批，
  // 否则它的附件引用会指向另一个文件里的附件。
  // 两个上限谁先到就切：字节数（防内存）或会话数（防渲染空白）。
  if (currentEstimate() >= MAX_BYTES) flushBatch();
  else if (optMaxSessions > 0 && curSessions.length >= optMaxSessions) flushBatch();
}
flushBatch();
process.stdout.write('\n');

// ---------------------------------------------------------------------------
// 写出（单批就直接用给定文件名；多批则加 -01 / -02 后缀）
// ---------------------------------------------------------------------------
const multi = batches.length > 1;
const results = [];
for (let bi = 0; bi < batches.length; bi++) {
  const b = batches[bi];
  const bundle = {
    schema: 'chat-demo-export@1',
    note: `由 DeepSeek 官方导出（export_format_version 3）转换而来，第 ${bi + 1}/${batches.length} 批。`,
    warning: '⚠ 本文件含私人对话与附件，请勿上传网盘、提交到 Git 或分享给他人。',
    exportedAt: Date.now(),
    exportedAtText: new Date().toISOString(),
    appVersion: '0.1.2',
    bridgeVersion: 'converted-from-official-export',
    origin: 'https://chat.deepseek.com',
    batchIndex: bi + 1,
    batchTotal: batches.length,
    sessionCount: b.sessions.length,
    attachmentCount: b.files.length,
    config: null,
    sessions: b.sessions,
    files: b.files
  };
  let out = outFile;
  if (multi) {
    const m = outFile.match(/^(.*?)(\.json)?$/);
    out = `${m[1]}-${String(bi + 1).padStart(2, '0')}.json`;
  }
  const json = JSON.stringify(bundle);
  writeFileSync(out, json, 'utf8');
  results.push({ path: out, size: statSync(out).size, sessions: b.sessions.length, files: b.files.length });
}

console.log('');
console.log('================ 转换结果 ================');
console.log(`  对话        : ${results.reduce((a, r) => a + r.sessions, 0)} 个（消息 ${stat.msgTotal} 条）`);
console.log(`  其中当前分支: ${stat.msgActive} 条，旧分支多出 ${stat.msgTotal - stat.msgActive} 条（保留但默认不显示）`);
console.log(`  附件        : ${results.reduce((a, r) => a + r.files, 0)} 个（${(stat.attachBytes / 1024 / 1024).toFixed(1)} MB 原始）`);
if (stat.attachMissing) console.log(`  附件无原件  : ${stat.attachMissing} 个（官方导出里 export_path 为空，只有元信息）`);
if (stat.noJson) console.log(`  缺 JSON     : ${stat.noJson} 个`);
if (stat.emptyPath) console.log(`  空路径跳过  : ${stat.emptyPath} 个`);
console.log(`  输出        : ${results.length} 个文件`);
for (const r of results) {
  console.log(`    ${basename(r.path)}  ${(r.size / 1024 / 1024).toFixed(2)} MB  (${r.sessions} 对话 / ${r.files} 附件)`);
}
console.log('');
console.log('下一步：在页面里点「导入」，逐个选这些文件。');
console.log('导入是幂等的（按 id + updatedAt 合并），重复导入同一个文件不会产生重复。');
