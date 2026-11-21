/*!
 * localstore-bridge.js —— DeepSeek chat-demo 本地文件夹持久化旁路层
 * ============================================================================
 * 目的：让对话记录自动写入用户指定的本地文件夹（如 E:\chat），
 *       从而不受浏览器清理数据影响，并可在不同浏览器之间通用。
 *
 * 设计原则：不改动官方 bundle 的任何业务逻辑。
 *   1. 通过 hook 原生 IDBObjectStore.prototype.put / delete 感知写入；
 *   2. 通过 File System Access API 写真实文件；
 *   3. 通过 MutationObserver 把设置面板里的「本地文件夹」区块挂进官方设置弹窗。
 *
 * 兼容性：需要 Chromium 系（Chrome / Edge）。Firefox、Safari 无
 *         File System Access API，此时降级为「提示 + 引导使用官方导出」。
 *
 * 本文件为普通脚本（非 module），会先于 main bundle 执行。
 * ============================================================================
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 常量
  // -------------------------------------------------------------------------

  var LS_FOLDER = 'chat-demo:local-folder';
  var LS_API_BASE = 'chat-demo:api-base';
  var LS_AUTOSYNC = 'chat-demo:local-autosync';
  var LS_SHOW_MODEL = 'chat-demo:show-model';
  /** 界面动效开关（'false' 关闭）。默认开启 */
  var LS_MOTION = 'chat-demo:motion';
  var LS_APP_API_KEY = 'chat-demo:api-key';
  /** 记录本浏览器最后一次从文件夹恢复对话的时间（用于判断是否「全新浏览器」） */
  var LS_HISTORY_SYNCED_AT = 'chat-demo:history-synced-at';
  /** 反向同步（盯着文件夹收外部改动）的开关，'false' 关闭。默认开启 */
  var LS_WATCH = 'chat-demo:local-watch';
  var DEFAULT_API_BASE = 'https://api.deepseek.com';

  /** 文件夹内的密钥文件名 */
  var KEY_FILE = 'apikey.json';

  /** 官方应用使用的业务库；只镜像它的 sessions 与 files 两个 store */
  var APP_DB = 'chat-demo';
  var OWN_DB = 'chat-demo-localstore';
  var OWN_STORE = 'handles';

  var DIR_SUFFIX = '-本地存档';
  var AUTO_SYNC_DEBOUNCE = 700;

  var BRIDGE_VERSION = '1.2.0';

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[localstore]');
    console.log.apply(console, args);
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[localstore]');
    console.warn.apply(console, args);
  }

  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式下可能抛错，忽略 */
    }
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /** 20260214-143022 */
  function stamp(d) {
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1, 2) +
      pad(d.getDate(), 2) +
      '-' +
      pad(d.getHours(), 2) +
      pad(d.getMinutes(), 2) +
      pad(d.getSeconds(), 2)
    );
  }

  /** 把任意标题净化成安全的文件名片段 */
  function safeSegment(text, fallback, maxLen) {
    var s = String(text == null ? '' : text)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '');
    if (!s) s = fallback;
    maxLen = maxLen || 40;
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  /** 数组分块，避免一次并发过多文件操作 */
  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // -------------------------------------------------------------------------
  // 自有 IndexedDB —— 用来记住文件夹句柄（句柄是可结构化克隆的）
  // -------------------------------------------------------------------------

  var ownDbPromise = null;

  function openOwnDb() {
    if (ownDbPromise) return ownDbPromise;
    ownDbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(OWN_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(OWN_STORE)) {
          db.createObjectStore(OWN_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        ownDbPromise = null;
        reject(req.error);
      };
    });
    return ownDbPromise;
  }

  function ownGet(key) {
    return openOwnDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(OWN_STORE, 'readonly');
        var req = tx.objectStore(OWN_STORE).get(key);
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }

  function ownPut(key, value) {
    return openOwnDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(OWN_STORE, 'readwrite');
        tx.objectStore(OWN_STORE).put(value, key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function ownDelete(key) {
    return openOwnDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(OWN_STORE, 'readwrite');
        tx.objectStore(OWN_STORE).delete(key);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  // -------------------------------------------------------------------------
  // 官方业务库读写（只读为主；导入时才写）
  // -------------------------------------------------------------------------

  function openAppDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(APP_DB);
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
      // 库尚未创建时（用户还没发过消息）不主动建库，避免干扰官方 upgrade
      req.onblocked = function () {
        reject(new Error('app db blocked'));
      };
    });
  }

  /** 读取全部会话记录 */
  function readAllSessions() {
    return openAppDb().then(function (db) {
      if (!db.objectStoreNames.contains('sessions')) return [];
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('sessions', 'readonly');
        var req = tx.objectStore('sessions').getAll();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }

  /** 读取全部附件记录（含 blob） */
  function readAllFiles() {
    return openAppDb().then(function (db) {
      if (!db.objectStoreNames.contains('files')) return [];
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', 'readonly');
        var req = tx.objectStore('files').getAll();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }

  /**
   * 把会话与附件写回官方库。程序化写入不会经过被 hook 的原生方法
   * （我们 hook 的是 IDBObjectStore.prototype，而 idb 库调用的是它，
   *  所以这里需要临时挂起自动同步，否则会自我触发）。
   */
  function writeBack(sessions, files, onProgress) {
    return openAppDb().then(function (db) {
      var stores = ['sessions', 'sessionSummaries', 'files'].filter(function (s) {
        return db.objectStoreNames.contains(s);
      });
      if (!stores.length) throw new Error('目标数据库缺少 sessions store');

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(stores, 'readwrite');
        var done = 0;
        var total = sessions.length + files.length;

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = function () {
          reject(tx.error || new Error('事务被中止'));
        };

        function tick() {
          done++;
          if (onProgress) onProgress(done, total);
        }

        sessions.forEach(function (s) {
          tx.objectStore('sessions').put(s);
          if (db.objectStoreNames.contains('sessionSummaries')) {
            tx.objectStore('sessionSummaries').put({
              id: s.id,
              title: s.title,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              fileIds: (s.messages || []).reduce(function (acc, m) {
                if (m && m.role === 'user' && Array.isArray(m.files)) {
                  m.files.forEach(function (f) {
                    if (f && f.id && acc.indexOf(f.id) < 0) acc.push(f.id);
                  });
                }
                return acc;
              }, [])
            });
          }
          tick();
        });

        if (db.objectStoreNames.contains('files')) {
          files.forEach(function (f) {
            tx.objectStore('files').put(f);
            tick();
          });
        } else {
          done += files.length;
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 对话树 → 线性消息（用于生成可读的 Markdown）
  // -------------------------------------------------------------------------

  /**
   * 会话记录内的消息构成一棵树（靠 parentId / selectedChildId 串联），
   * 因为支持「编辑消息后重新生成」形成多版本分支。
   * 这里沿 rootMessageId 走 selectedChildId 链，还原「当前显示的那条路径」。
   */
  function linearMessages(session) {
    var messages = Array.isArray(session.messages) ? session.messages : [];
    if (!messages.length) return [];

    var byId = new Map();
    messages.forEach(function (m) {
      if (m && m.id != null) byId.set(m.id, m);
    });

    var rootId =
      session.rootMessageId != null ? session.rootMessageId : null;
    if (rootId == null || !byId.has(rootId)) {
      // 没有树信息（旧数据或未初始化），退化为数组顺序
      var hasLinks = messages.some(function (m) {
        return m && (m.parentId != null || m.selectedChildId != null);
      });
      if (!hasLinks) return messages;
      // 有链接但找不到根：取没有 parentId 的第一条
      var found = messages.find(function (m) {
        return m && m.parentId == null;
      });
      if (!found) return messages;
      rootId = found.id;
    }

    var out = [];
    var seen = new Set();
    var cursor = rootId;
    while (cursor != null && byId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      var node = byId.get(cursor);
      out.push(node);
      cursor = node.selectedChildId != null ? node.selectedChildId : null;
    }

    // 判断哪些消息「虽然没被走到，但仍然是树上的合法节点」。
    // 这些是用户没有选中的分支版本（同级兄弟），只应存在于完整 JSON 树里，
    // 绝不能出现在当前显示的对话中——官方实现（module 3494）同样会跳过它们。
    var onTree = new Set(seen);
    for (var pass = 0; pass < 64; pass++) {
      var grew = false;
      messages.forEach(function (m) {
        if (!m || m.id == null || onTree.has(m.id)) return;
        if (m.parentId != null && onTree.has(m.parentId)) {
          onTree.add(m.id);
          grew = true;
        }
      });
      if (!grew) break;
    }

    // 兜底：只补「从根节点确实走不到」的消息（数据损坏或导入异常），
    // 保证内容不丢；同级的未选中分支不会被卷进来。
    if (onTree.size < byId.size) {
      messages.forEach(function (m) {
        if (m && m.id != null && !onTree.has(m.id) && !seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Markdown 渲染
  // -------------------------------------------------------------------------

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1, 2) +
      '-' +
      pad(d.getDate(), 2) +
      ' ' +
      pad(d.getHours(), 2) +
      ':' +
      pad(d.getMinutes(), 2) +
      ':' +
      pad(d.getSeconds(), 2)
    );
  }

  function roleLabel(role) {
    if (role === 'user') return '我';
    if (role === 'assistant') return 'DeepSeek';
    return String(role || '未知');
  }

  function renderMarkdown(session) {
    var lines = [];
    var title = session.title || '未命名对话';

    lines.push('---');
    lines.push('title: ' + JSON.stringify(title));
    lines.push('session_id: ' + session.id);
    lines.push('created_at: ' + fmtTime(session.createdAt));
    lines.push('updated_at: ' + fmtTime(session.updatedAt));
    lines.push('---');
    lines.push('');
    lines.push('# ' + title);
    lines.push('');

    var msgs = linearMessages(session);
    msgs.forEach(function (m) {
      if (!m) return;
      var header = roleLabel(m.role);
      if (m.createdAt) header += '  ·  ' + fmtTime(m.createdAt);
      // 真实模型名（由 fetch 嗅探写入）；回退到应用自带的 model 字段
      var modelName = m.serverModel || m.model;
      if (m.role === 'assistant' && modelName) header += '  ·  `' + modelName + '`';
      lines.push('## ' + header);
      lines.push('');

      // 附件
      if (Array.isArray(m.files) && m.files.length) {
        m.files.forEach(function (f) {
          if (!f) return;
          var badge = f.isImage ? '图片' : '文件';
          lines.push('- [' + badge + '] ' + (f.name || f.id) + '  (' + (f.size || 0) + ' 字节)');
        });
        lines.push('');
      }

      // 消息正文的存放位置随角色/版本不同：
      //   · 用户消息  → content 为字符串
      //   · 助手消息  → blocks 数组，元素形如 {type:'text', text, citations}
      //                 {type:'thinking', thinking, signature}
      //                 {type:'server_tool_use'|'web_search_tool_result'|...}
      //   · 兼容旧数据 → content 也可能是 block 数组
      var blocks = Array.isArray(m.blocks)
        ? m.blocks
        : Array.isArray(m.content)
          ? m.content
          : null;

      if (blocks) {
        blocks.forEach(function (block) {
          if (!block || typeof block !== 'object') return;
          if (block.type === 'text' && typeof block.text === 'string') {
            lines.push(block.text);
            lines.push('');
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            lines.push('<details><summary>深度思考</summary>');
            lines.push('');
            lines.push(block.thinking);
            lines.push('');
            lines.push('</details>');
            lines.push('');
          } else if (block.type === 'image') {
            lines.push('（图片）');
            lines.push('');
          }
        });
      } else if (typeof m.content === 'string') {
        if (m.content.trim()) {
          lines.push(m.content);
          lines.push('');
        }
      }
    });

    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // -------------------------------------------------------------------------
  // 快照构建
  // -------------------------------------------------------------------------

  /** 会话 → 写入文件夹的 JSON 结构（去掉 blob 等不可序列化内容） */
  function sessionToMirror(session) {
    var linear = linearMessages(session);
    var all = Array.isArray(session.messages) ? session.messages : [];

    /** 从一组消息里汇总模型名（去重、保序） */
    function collectModels(list) {
      var models = [];
      list.forEach(function (m) {
        if (!m || m.role !== 'assistant') return;
        var name = m.serverModel || m.model;
        if (name && models.indexOf(name) < 0) models.push(name);
      });
      return models;
    }

    return {
      schema: 'chat-demo-mirror/session@1',
      id: session.id,
      title: session.title == null ? null : session.title,
      createdAt: session.createdAt == null ? null : session.createdAt,
      updatedAt: session.updatedAt == null ? null : session.updatedAt,
      rootMessageId: session.rootMessageId == null ? null : session.rootMessageId,
      messageCount: all.length,
      /** 当前显示的这段对话实际用过的模型 */
      models: collectModels(linear),
      /** 完整消息树里出现过的全部模型（含未选中分支） */
      modelsInTree: collectModels(all),
      /** 当前显示的线性消息（已按分支选择展开） */
      conversation: linear,
      /** 完整消息树，含所有分支版本，供无损还原 */
      messages: all
    };
  }

  /**
   * 推断附件落盘时的扩展名。
   *
   * 优先用文件名本身的扩展名；没有（或不像扩展名）时再从 MIME 猜，
   * 这样 `<id>.png` / `<id>.pdf` 这类名字既能被系统正确打开，
   * 也方便用户在文件夹里一眼看懂是什么文件。
   */
  var MIME_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'application/pdf': '.pdf',
    'application/json': '.json',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
    'text/html': '.html'
  };

  function attachmentExt(f) {
    var m = /\.([A-Za-z0-9]{1,10})$/.exec(f.name || '');
    if (m) return '.' + m[1].toLowerCase();
    var mime = String(f.mimeType || '').toLowerCase().split(';')[0].trim();
    if (MIME_EXT[mime]) return MIME_EXT[mime];
    // text/* 与 +xml / +json 这类派生类型
    if (mime.indexOf('text/') === 0) return '.' + mime.slice(5).replace(/[^a-z0-9]/g, '');
    if (mime.indexOf('image/') === 0) return '.' + mime.slice(6).replace(/[^a-z0-9]/g, '');
    return '';
  }

  function fileToMirror(file) {
    return {
      id: file.id,
      name: file.name == null ? null : file.name,
      size: file.size == null ? null : file.size,
      mimeType: file.mimeType == null ? null : file.mimeType,
      isImage: !!file.isImage,
      serverId: file.serverId == null ? null : file.serverId
    };
  }

  /** 生成稳定的文件名：`日期-时间_标题`，同名靠 id 去重 */
  function fileBaseName(session) {
    var when = new Date(session.updatedAt || session.createdAt || Date.now());
    var title = safeSegment(session.title, '未命名对话', 40);
    return stamp(when) + '_' + title;
  }

  // -------------------------------------------------------------------------
  // 文件夹访问抽象
  // -------------------------------------------------------------------------

  var supportsFs = (function () {
    try {
      return (
        typeof window.showDirectoryPicker === 'function' &&
        window.isSecureContext !== false
      );
    } catch (e) {
      return false;
    }
  })();

  /** 确保目录句柄可写；需要用户手势时返回 'prompt' */
  async function ensurePermission(handle, request) {
    if (!handle) return 'denied';
    var opts = { mode: 'readwrite' };
    try {
      var state = await handle.queryPermission(opts);
      if (state === 'granted') return 'granted';
      if (!request) return state;
      state = await handle.requestPermission(opts);
      return state;
    } catch (e) {
      return 'denied';
    }
  }

  var dirCache = null;

  async function getRootHandle() {
    if (dirCache) return dirCache;
    try {
      var h = await ownGet('root');
      if (h && typeof h.queryPermission === 'function') {
        dirCache = h;
        return h;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /** 取（并按需创建）子目录 */
  async function subdir(root, name, create) {
    return root.getDirectoryHandle(name, { create: !!create });
  }

  async function writeText(dir, name, text) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    try {
      await w.write(text);
    } finally {
      await w.close();
    }
  }

  async function writeBlob(dir, name, blob) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    try {
      await w.write(blob);
    } finally {
      await w.close();
    }
  }

  async function readTextFile(dir, name) {
    var fh = await dir.getFileHandle(name);
    var file = await fh.getFile();
    return await file.text();
  }

  async function readBinaryFile(dir, name) {
    var fh = await dir.getFileHandle(name);
    return await fh.getFile();
  }

  /** 列举目录下所有文件名 */
  async function listNames(dir) {
    var names = [];
    for await (var entry of dir.values()) {
      names.push(entry.name + (entry.kind === 'directory' ? '/' : ''));
    }
    return names;
  }

  async function removeEntry(dir, name) {
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch (e) {
      /* 不存在则忽略 */
    }
  }

  /** 遍历出镜像文件夹里所有 `*.json` 会话文件名 */
  async function listSessionJson(convDir) {
    var out = [];
    for await (var entry of convDir.values()) {
      if (entry.kind === 'file' && /\.json$/i.test(entry.name)) out.push(entry.name);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 核心：写快照
  // -------------------------------------------------------------------------

  var syncState = {
    running: false,
    queued: false,
    lastSync: null,
    lastError: null,
    lastStats: null
  };

  var syncListeners = new Set();

  function emitSync() {
    syncListeners.forEach(function (fn) {
      try {
        fn(syncState);
      } catch (e) {
        /* ignore */
      }
    });
  }

  function onSync(fn) {
    syncListeners.add(fn);
    return function () {
      syncListeners.delete(fn);
    };
  }

  async function doSnapshot(root, opts) {
    opts = opts || {};
    var sessions = await readAllSessions();
    var files = await readAllFiles();

    var convDir = await subdir(root, '对话', true);
    var dataDir = await subdir(root, '数据', true);
    var attachDir = await subdir(root, '附件', true);

    // --- 会话文件 ---
    var usedNames = new Map(); // 处理同名冲突
    var written = [];
    var index = [];

    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s || !s.id) continue;

      var base = fileBaseName(s);
      if (usedNames.has(base)) {
        base = base + '_' + String(s.id).slice(0, 6);
      }
      usedNames.set(base, true);

      await writeText(convDir, base + '.json', JSON.stringify(sessionToMirror(s), null, 2));
      await writeText(convDir, base + '.md', renderMarkdown(s));

      written.push(base + '.json', base + '.md');
      index.push({
        id: s.id,
        title: s.title == null ? null : s.title,
        createdAt: s.createdAt == null ? null : s.createdAt,
        updatedAt: s.updatedAt == null ? null : s.updatedAt,
        files: [base + '.json', base + '.md']
      });
    }

    // 附件：所有类型都把原件写进 附件/（图片、PDF、Word、代码…都一样）
    var fileIndex = [];
    var blobCount = 0;
    var blobMissed = [];
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      if (!f || !f.id) continue;
      var meta = fileToMirror(f);
      // 优先用数据库里的 blob；有些老记录可能只存了 serverId
      var blob = f.blob || null;
      if (!blob && typeof File !== 'undefined' && f.name) {
        blob = null; // 没有原件就老实记为「未存原件」，不要伪造
      }
      if (blob) {
        var ext = attachmentExt(f);
        var fname = f.id + ext;
        try {
          await writeBlob(attachDir, fname, blob);
          meta.storedAs = '附件/' + fname;
          meta.bytesStored = blob.size == null ? null : blob.size;
          blobCount++;
        } catch (e) {
          warn('附件写入失败', f.id, e);
          meta.storedAs = null;
          blobMissed.push(f.id);
        }
      } else {
        meta.storedAs = null;
        blobMissed.push(f.id);
      }
      fileIndex.push(meta);
    }

    // --- 清理：删掉这次没写到的旧会话文件（对应“删除对话”） ---
    //
    // ⚠️ 安全闸门 1：如果本地库是空的、而文件夹里却有存档，绝不能清理。
    // 那种状态说明这是「全新浏览器 / 刚清空过数据」，此时全量快照 + 清理
    // 会把用户存在文件夹里的历史对话成批删掉 —— 这与「防丢失」的目的完全相反。
    // 只有确认过本地与文件夹已经对过账（有历史同步标记）才允许清理。
    //
    // ⚠️ 安全闸门 2（实测踩过的数据丢失）：**反向同步对齐之前不许清理。**
    // 用户的实际场景是「在网页版新建了几条对话」→ 文件夹里有了这些文件，
    // 但本机 IndexedDB 里还没有。这时如果先跑了一次快照，`current` 里不含
    // 那些会话，清理逻辑就会把文件夹里那几条**直接删掉** ——
    // 用户的对话就这么没了，而且看起来像"同步功能坏了"。
    //
    // ⚠️ 安全闸门 3（真正致命的那一条）：**只清理我们上次自己写过的文件。**
    // 光靠闸门 2 不够：轮询是异步的，在「对齐完成」到「轮询读到新文件」之间
    // 有一个窗口，此时闸门 2 已经放行，而 sessions 列表还是导入前的旧列表，
    // 照样会把外部刚写进来的文件删掉（实测复现：文件在 3 秒内被删，
    // 表现成「改了文件夹里的对话，应用没反应」）。
    // 判据用「上一次快照写在 数据/manifest.json 里的会话文件清单」：
    // 只有上次确实由我们写出来的文件，才有资格被这次清理删掉；
    // 认不出来的一律留着，宁可多留一份也不删用户的对话。
    var pruneSkipped = false;
    var pruneSkipReason = '';
    var current = new Set(written);
    var existing = await listSessionJson(convDir).then(function (a) {
      return a.concat(
        a.map(function (n) {
          return n.replace(/\.json$/i, '.md');
        })
      );
    });

    // 上次清单里出现过的文件名 = 我们写过的。
    //
    // ⚠ 会话清单在 `数据/sessions.json` 的 `sessions` 数组里，
    // 不在 `数据/manifest.json` —— manifest.json 只有统计信息（会话数、同步时间等）。
    // 读错文件的结果是 mine 永远是空集，清理逻辑从此一个文件都不删，
    // 表现成「改名之后文件夹里新旧两份都在」（实测踩过）。
    var mine = new Set();
    try {
      var prevIdx = await readSessionIndex();
      var prevSessions = (prevIdx && prevIdx.sessions) || [];
      for (var pi = 0; pi < prevSessions.length; pi++) {
        var fl = prevSessions[pi] && prevSessions[pi].files;
        if (!Array.isArray(fl)) continue;
        for (var fj = 0; fj < fl.length; fj++) mine.add(fl[fj]);
      }
    } catch (e) { /* 读不到就当没有，宁可不清理 */ }

    if (!watchState.reconciled && existing.length) {
      pruneSkipped = true;
      pruneSkipReason = '还没跟文件夹对过账';
    } else if (!sessions.length && existing.length && !lsGet(LS_HISTORY_SYNCED_AT)) {
      pruneSkipped = true;
      pruneSkipReason = '浏览器里没有对话而文件夹里有存档';
      warn(
        '已跳过旧文件清理：浏览器里没有对话，但文件夹里有 ' +
          existing.length +
          ' 个文件。请先在设置里点「从文件夹恢复」。'
      );
    }

    var removed = 0;
    var keptForeign = [];
    if (!pruneSkipped) {
      for (var k = 0; k < existing.length; k++) {
        var name = existing[k];
        if (current.has(name)) continue;
        // 不认识的文件不删 —— 可能是外部（网页版 / 另一台机器）刚放进来的
        if (!mine.has(name)) {
          keptForeign.push(name);
          continue;
        }
        await removeEntry(convDir, name);
        removed++;
      }
    }
    if (keptForeign.length) {
      log('保留了 ' + keptForeign.length + ' 个不是本机写出的文件（避免删掉外部新增的对话）：' +
        keptForeign.slice(0, 5).join('、') + (keptForeign.length > 5 ? ' …' : ''));
    }
    watchState.lastPrune = { removed: removed, keptForeign: keptForeign.length,
      skipped: pruneSkipped, reason: pruneSkipReason };

    // --- 数据索引 ---
    var manifest = {
      schema: 'chat-demo-mirror/manifest@1',
      bridgeVersion: BRIDGE_VERSION,
      appVersion: '0.1.2',
      folderName: root.name || null,
      lastSyncAt: Date.now(),
      lastSyncAtText: fmtTime(Date.now()),
      sessionCount: index.length,
      attachmentCount: fileIndex.length,
      // 原件真正落盘的附件数（图片与非图片都算）
      blobCount: blobCount,
      blobMissed: blobMissed.length,
      imageCount: blobCount,
      apiBase: lsGet(LS_API_BASE) || DEFAULT_API_BASE,
      pruneSkipped: pruneSkipped,
      note:
        '本文件夹由 chat-demo 的本地存档功能自动维护，可安全备份。请勿手工改动 数据/ 下的文件结构。' +
        (pruneSkipped
          ? '（本次未清理旧文件：浏览器里是空的而文件夹里有存档，已在设置里点过「从文件夹恢复」后才会清理。）'
          : '')
    };

    await writeText(dataDir, 'sessions.json', JSON.stringify({ manifest: manifest, sessions: index }, null, 2));
    await writeText(dataDir, 'files.json', JSON.stringify(fileIndex, null, 2));
    await writeText(dataDir, 'manifest.json', JSON.stringify(manifest, null, 2));

    // --- 设置项（不含密钥）---
    // 每次快照顺带刷新，用户改完语言/主题等偏好后即使没有触发对话，
    // 下一次同步也会把新设置带上。
    //
    // 注意：写完必须把「已同步」标记对齐到本次写入的时间。
    // 否则下次启动会看到「文件夹比本地标记新」而误判成有新设置，
    // 进而要求刷新页面 —— 那正是页面不停闪动的根因。
    try {
      var settingsSavedAt = Date.now();
      var settingsPayload = {
        schema: 'chat-demo-mirror/settings@1',
        note: '本文件不含密钥，可安全阅读。密钥见同目录的 apikey.json。',
        savedAt: settingsSavedAt,
        savedAtText: fmtTime(settingsSavedAt),
        settings: collectSettings()
      };
      await writeText(dataDir, SETTINGS_FILE, JSON.stringify(settingsPayload, null, 2));
      lsSet(LS_SETTINGS_SYNCED_AT, String(settingsSavedAt));
    } catch (e) {
      warn('写入设置失败：' + ((e && e.message) || e));
    }

    // --- 密钥（含各提供方的 Key）---
    // 仅当用户启用了「Key 存到文件夹」开关时同步；否则不落盘明文。
    // settings.json 是纯偏好、不含密钥，所以提供方的 Key 必须走这里，
    // 不然换浏览器后自定义提供方的 Key 全是空的。
    try {
      if (lsGet('chat-demo:local-key') === '1') {
        var officialKey = lsGet(LS_APP_API_KEY) || '';
        var providerKeys = collectProviderKeys();
        if (officialKey || Object.keys(providerKeys).length) {
          var keySavedAt = Date.now();
          await writeText(
            dataDir,
            KEY_FILE,
            JSON.stringify(
              {
                schema: 'chat-demo-mirror/apikey@2',
                warning:
                  '本文件包含明文 API Key。请勿上传网盘、提交到 Git 或分享给他人。',
                savedAt: keySavedAt,
                savedAtText: fmtTime(keySavedAt),
                apiBase: lsGet(LS_API_BASE) || DEFAULT_API_BASE,
                apiKey: officialKey,
                providerKeys: providerKeys
              },
              null,
              2
            )
          );
        }
      }
    } catch (e) {
      warn('写入密钥失败：' + ((e && e.message) || e));
    }

    // --- 顶层 README，方便日后自己看懂 ---
    await writeText(
      root,
      'README.md',
      [
        '# 本文件夹由 chat-demo 自动维护',
        '',
        '这是「' + (root.name || '本地存档') + '」文件夹，由 DeepSeek chat-demo 的本地存档功能自动写入。',
        '',
        '## 目录说明',
        '',
        '| 路径 | 内容 |',
        '| --- | --- |',
        '| `对话/*.md` | **人类可读**的对话全文，可直接阅读、搜索、归档 |',
        '| `对话/*.json` | 结构化原始数据，**含所有分支版本**，用于无损还原 |',
        '| `附件/` | 上传附件的**原件**（图片、PDF、Word、代码等都会存） |',
        '| `数据/sessions.json` | 全部对话的索引 |',
        '| `数据/manifest.json` | 存档元信息与上次同步时间 |',
        '| `数据/settings.json` | 界面偏好（语言、主题等），**不含密钥** |',
        '| `数据/apikey.json` | API Key（**明文**，仅在启用该功能时存在） |',
        '',
        '## 注意',
        '',
        '- 文件名形如 `20260214-143022_对话标题`，按最后更新时间命名。',
        '- `附件/` 里的文件名是 `<附件id><扩展名>`；对应关系记在 `数据/files.json` 的 `storedAs` 字段。',
        '- 在网页里**删除**对话，这里对应的文件也会被同步删除。',
        '- 想从本文件夹恢复数据：打开网页 → 设置 → 本地文件夹 → 从文件夹恢复。',
        '- 可以直接复制整个文件夹做备份。',
        '',
        '最后同步：' + fmtTime(Date.now()),
        ''
      ].join('\n')
    );

    return {
      sessionCount: index.length,
      fileCount: fileIndex.length,
      imageCount: blobCount,
      blobCount: blobCount,
      blobMissed: blobMissed.length,
      removed: removed,
      at: Date.now()
    };
  }

  /** 带串行化与状态上报的快照入口 */
  async function snapshot(reason) {
    if (!supportsFs) throw new Error('当前浏览器不支持文件夹写入');
    var root = await getRootHandle();
    if (!root) throw new Error('尚未选择本地文件夹');

    if (syncState.running) {
      syncState.queued = true;
      return null;
    }

    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') {
      syncState.lastError = '需要重新授权文件夹访问权限';
      emitSync();
      throw new Error('需要重新授权文件夹访问权限，请在设置中点击「重新连接」');
    }

    syncState.running = true;
    syncState.lastError = null;
    emitSync();

    var result = null;
    try {
      result = await doSnapshot(root, { reason: reason });
      syncState.lastSync = result.at;
      syncState.lastStats = result;
      lsSet(LS_FOLDER, root.name || '1');
      log('已同步到文件夹', root.name, result);
    } catch (e) {
      syncState.lastError = (e && e.message) || String(e);
      warn('同步失败', e);
      throw e;
    } finally {
      syncState.running = false;
      emitSync();
      if (syncState.queued) {
        syncState.queued = false;
        setTimeout(function () {
          snapshot('queued').catch(function () {});
        }, 50);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 自动同步：hook 原生 IDBObjectStore 写操作
  // -------------------------------------------------------------------------

  var autoSyncSuspended = 0;
  var debounceTimer = null;

  /**
   * 安排一次自动落盘。
   *
   * 触发来源有两路：
   *   1. 官方写 IndexedDB（installIdbHook）—— 覆盖新建/改名/删除会话；
   *   2. 界面出现新的消息节点（watchMessages）—— 覆盖流式回复过程中
   *      「内容还在追加、但还没最终写库」的窗口。
   * 两路都走同一个防抖计时器，因此不会重复写。
   */
  function scheduleAutoSync(reason) {
    // 无论同步是否开着，都要通知外面「存档变了」。
    //
    // 为什么放在这里而不是只放在真正写盘的分支里：功能扩展层需要知道
    // 什么时候该丢掉自己的缓存（例如「置顶」小节要按最后一条消息的时间重排，
    // 而那个时间来自 IndexedDB）。如果只在开自动同步时才通知，用户一关同步
    // 置顶排序就再也不更新了。
    try {
      document.dispatchEvent(new CustomEvent('localstore-changed', { detail: { reason: reason || '' } }));
    } catch (e) { /* 老浏览器没有 CustomEvent 构造器就算了，不影响主链路 */ }

    if (autoSyncSuspended > 0) return;
    if (lsGet(LS_AUTOSYNC) === 'false') return;
    if (!supportsFs) return;
    if (!dirCache && !lsGet(LS_FOLDER)) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      snapshot('auto' + (reason ? ':' + reason : ''))
        .then(function (r) {
          if (r) {
            log('自动保存完成：' + r.sessionCount + ' 个对话');
          }
        })
        .catch(function (e) {
          warn('自动保存失败：' + ((e && e.message) || e));
        });
    }, AUTO_SYNC_DEBOUNCE);
  }

  function installIdbHook() {
    if (typeof IDBObjectStore === 'undefined') return;
    var proto = IDBObjectStore.prototype;
    var INTERESTING = { sessions: 1, files: 1, sessionSummaries: 1 };

    ['put', 'add', 'delete', 'clear'].forEach(function (method) {
      var original = proto[method];
      if (typeof original !== 'function' || original.__localstorePatched) return;

      var wrapped = function () {
        var storeName = null;
        try {
          storeName = this && this.name;
        } catch (e) {
          /* ignore */
        }

        // 写入 sessions 前，把嗅探到的真实模型补进助手消息
        var args = arguments;
        if (storeName === 'sessions' && args.length >= 1 && pendingModel) {
          var value = args[0];
          if (value && typeof value === 'object' && Array.isArray(value.messages)) {
            try {
              attachModelToSession(value);
            } catch (e) {
              /* ignore */
            }
          }
        }

        var result = original.apply(this, args);
        if (storeName && INTERESTING[storeName]) {
          // 等事务真正提交再触发，避免写到一半就读
          try {
            var tx = this.transaction;
            if (tx) {
              tx.addEventListener('complete', function () {
                scheduleAutoSync();
              });
            } else {
              scheduleAutoSync();
            }
          } catch (e) {
            scheduleAutoSync();
          }
        }
        return result;
      };

      wrapped.__localstorePatched = true;
      wrapped.__original = original;
      try {
        proto[method] = wrapped;
      } catch (e) {
        warn('无法 hook IDBObjectStore.' + method, e);
      }
    });

    log('已挂载 IndexedDB 自动同步钩子');
  }

  // -------------------------------------------------------------------------
  // 连接 / 断开 / 恢复
  // -------------------------------------------------------------------------

  async function pickFolder() {
    if (!supportsFs) {
      throw new Error('当前浏览器不支持文件夹写入，请使用 Chrome 或 Edge');
    }
    var handle = await window.showDirectoryPicker({
      id: 'chat-demo-localstore',
      mode: 'readwrite',
      startIn: 'documents'
    });

    var perm = await ensurePermission(handle, true);
    if (perm !== 'granted') {
      throw new Error('未获得文件夹读写权限');
    }

    await ownPut('root', handle);
    dirCache = handle;
    lsSet(LS_FOLDER, handle.name || '1');
    emitSync();
    log('已连接文件夹', handle.name);

    // 刚连上文件夹：把监看装上（它会自己完成一次启动对齐）
    startFolderWatcher().catch(function (e) {
      warn('装上文件夹监看失败：' + ((e && e.message) || e));
    });

    // 换浏览器 / 清空数据后第一次连接：这也是「自动把对话读回来」的最佳时机。
    // 不放在 background 里做是因为它会写库，需要让 UI 拿到进度。
    return handle;
  }

  /**
   * 文件夹连接就绪后，尝试把对话自动读回来（仅在全新浏览器里生效）。
   * 返回是否真的恢复了内容。
   */
  async function autoRestoreAfterConnect(onProgress) {
    var res = await maybeAutoRestoreHistory(onProgress);
    if (res && res.restored) {
      emitSync();
      return true;
    }
    return false;
  }

  async function disconnect() {
    dirCache = null;
    stopFolderWatcher();
    try {
      await ownDelete('root');
    } catch (e) {
      /* ignore */
    }
    lsSet(LS_FOLDER, null);
    emitSync();
  }

  // -------------------------------------------------------------------------
  // 反向同步：盯着文件夹，外面的改动自动收进来
  // -------------------------------------------------------------------------
  //
  // 为什么需要它：原来的恢复只在「本浏览器从没同步过、且本地库是空的」时跑
  // （maybeAutoRestoreHistory）。一旦本机已经有对话，标记位就一直是有的，
  // 于是**在另一台机器 / 另一个浏览器上新增的对话永远不会被收进来**，
  // 除非用户自己去点「从文件夹恢复」。实测用户就是这么被卡住的：
  // 在 GitHub 网页版新建了好几条，本地死活看不到。
  //
  // 做法：定时扫「对话」目录，只认「上一次扫描之后被改过的文件」。
  //   · 基线（baselineAt）取启动时所有文件的最大 lastModified ——
  //     比基线旧的（包括我们自己刚写下去的）一律不动，避免「自己写 →
  //     自己读回来 → 页面刷新」的自激循环；
  //   · 之后任何 lastModified 变新、或新出现的文件，都读进来合并；
  //   · 合并是按 id 覆盖（writeBack 用 put），所以不会清掉本地独有的对话。
  //
  // 合并完必须刷新页面：官方应用只在启动时读一次 IndexedDB，
  // 没有监听数据库变化的机制（它自己的「导入」也是整页重载）。
  var WATCH_INTERVAL = 3000;       // 用户在操作时的扫描间隔（接近实时）
  var WATCH_IDLE_INTERVAL = 20000; // 闲置时的间隔，避免在大存档上空转
  var watchTimer = null;
  var watchState = { baselineAt: 0, imported: 0, lastScan: 0, lastError: null, enabled: false,
    lastImported: [], hashes: null, reconciled: false, booted: false, listenersBound: false,
    fileCount: 0 };

  /** 测试开关：置为 'false' 时收完不刷新页面（无头测试里页面一刷新，
   *  注入的模拟文件夹就没了，没法接着断言）。默认是刷新的。 */
  function watchReloadEnabled() {
    return lsGet('chat-demo:ls-watch-noreload') !== 'true';
  }

  function stopFolderWatcher() {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = null;
    watchState.enabled = false;
    watchState.booted = false;
  }

  /** 扫描一次「对话」目录，返回 [{name, lastModified, size}]。
   *
   * ⚠ 这里**不能**用 `continue` 静默吞掉 `getFile()` 的失败。
   * 踩过的坑：假文件系统（以及某些实现）在 `values()` 里给的是
   * 「带 name 的裸对象」而不是 FileSystemFileHandle，`entry.getFile` 根本不存在，
   * 被 catch 吞掉之后表现成「文件夹里明明有文件，就是永远收不进来」，
   * 而且一句日志都没有。现在改成记进 lastError，至少有迹可循。
   */
  async function scanSessionFiles() {
    var root = await getRootHandle();
    if (!root) {
      watchState.lastError = 'no-root';
      return null;
    }
    var perm;
    try {
      perm = await ensurePermission(root, false);
    } catch (e) {
      watchState.lastError = 'perm-error:' + ((e && e.message) || e);
      return null;
    }
    if (perm !== 'granted') {
      watchState.lastError = 'perm-' + perm;
      return null;
    }
    var convDir;
    try {
      convDir = await subdir(root, '对话', false);
    } catch (e) {
      watchState.lastError = 'no-conv-dir:' + ((e && e.name) || e);
      return null; // 还没建目录，正常
    }

    var out = [];
    var failed = null;
    try {
      for await (var entry of convDir.values()) {
        if (entry.kind !== 'file') continue;
        if (!/\.json$/i.test(entry.name)) continue;
        var f = null;
        try {
          // entry 正常是 FileSystemFileHandle；万一只是个 {name} 的对象，
          // 退一步用目录句柄自己取一次。
          if (typeof entry.getFile === 'function') {
            f = await entry.getFile();
          } else if (typeof convDir.getFileHandle === 'function') {
            var fh = await convDir.getFileHandle(entry.name, { create: false });
            f = await fh.getFile();
          } else {
            throw new Error('values() 给出的项既不是句柄也不能按名字取回');
          }
        } catch (e) {
          // 只记第一条，避免刷屏
          if (!failed) failed = entry.name + ' → ' + ((e && e.message) || e);
          continue;
        }
        // lastModified 正常一定有；取不到就退化成 1（比任何基线都小，
        // 于是不会因为读不到时间就误导入）。
        var lm = Number(f && f.lastModified);
        out.push({
          name: entry.name,
          lastModified: isFinite(lm) && lm > 0 ? lm : 1,
          size: (f && typeof f.size === 'number') ? f.size : -1
        });
      }
    } catch (e) {
      watchState.lastError = 'iterate-error:' + ((e && e.message) || e);
      return null;
    }
    watchState.fileCount = out.length;
    watchState.lastError = failed ? 'getFile-failed:' + failed : null;
    return out;
  }

  /** 建立基线：记住启动那一刻所有文件的时间戳，之后只认比它新的 */
  async function primeFolderWatcher() {
    try {
      var list = await scanSessionFiles();
      if (!list) return false;
      var max = 0;
      for (var i = 0; i < list.length; i++) max = Math.max(max, list[i].lastModified);
      watchState.baselineAt = max;
      watchState.lastError = null;
      return true;
    } catch (e) {
      watchState.lastError = (e && e.message) || String(e);
      return false;
    }
  }

  /**
   * 定时扫描：发现外部新增/修改的会话就合并进来并刷新。
   *
   * ⚠ 这里以前有**两份** pollFolderForChanges（函数声明提升，后面那份
   *   静默覆盖前面那份），前一份是只按 lastModified 基线判新的老实现。
   *   重叠的声明很危险：改一份以为生效了、实际跑的是另一份。
   *   已删掉旧的那份，只留下面按内容哈希判新的这份。
   */

  /**
   * 启动时的一次性对齐：把文件夹里**比本地新**的对话收进来。
   *
   * 为什么不能只靠 lastModified 基线：基线的语义是「启动那一刻就存在的文件
   * 都当已知」，可用户真正踩的坑恰恰是「这些文件启动时就在，但本地没有」——
   * 在网页版新建的对话被同步进文件夹之后，本机这边文件早就存在了，
   * 只看时间戳会全部漏掉。
   *
   * 所以这里改成比内容：每个文件算一次哈希，只对那些
   * 「本地没有」或「文件里的 updatedAt 比本地新」的会话动手。
   * 哈希存下来给后面的轮询用，避免每次都重读全部文件。
   */
  async function reconcileFolderOnBoot() {
    var list = await scanSessionFiles();
    // 读不到（还没连文件夹 / 没权限）时不能算「对过账」，否则清理闸门会变成盲删。
    // 但"目录还不存在"是另一回事：那说明这个文件夹还没写过存档，
    // 等价于「已经对过账了，结论是一个对话都没有」，必须放行，
    // 否则首次落盘之后清理逻辑永远不会生效。
    if (!list) {
      if (watchState.lastError && /^no-conv-dir/.test(watchState.lastError)) {
        watchState.reconciled = true;
        return 0;
      }
      return 0;
    }
    watchState.reconciled = true;
    if (!list.length) return 0;
    var local = await readAllSessions();
    var localById = {};
    for (var i = 0; i < local.length; i++) localById[local[i].id] = local[i];

    var convDir = await subdir(await getRootHandle(), '对话', false);
    var toWrite = [];
    var hashes = {};
    for (var k = 0; k < list.length; k++) {
      var raw;
      try {
        raw = await readTextFile(convDir, list[k].name);
      } catch (e) {
        continue;
      }
      var h = strHash(raw);
      hashes[list[k].name] = { h: h, meta: list[k].name + '|' + list[k].size + '|' + list[k].lastModified };
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        continue; // 写了一半的文件，下一轮再处理
      }
      if (!parsed || !parsed.id) continue;
      var l = localById[parsed.id];
      if (l && (parsed.updatedAt || 0) <= (l.updatedAt || 0)) continue;
      toWrite.push(normalizeSession(parsed));
    }

    watchState.hashes = hashes;
    watchState.baselineAt = Date.now();
    watchState.reconciled = true;
    if (!toWrite.length) return 0;

    log('启动对齐：文件夹里有 ' + toWrite.length + ' 个更新的对话');
    autoSyncSuspended++;
    try {
      await writeBack(toWrite, [], null);
    } finally {
      autoSyncSuspended--;
    }
    watchState.imported += toWrite.length;
    watchState.lastImported = toWrite.map(function (s) { return s.title; });
    lsSet(LS_HISTORY_SYNCED_AT, String(Date.now()));
    emitSync();
    // 收进来的新对话要再写回文件夹一次：文件名用的是应用自己的命名规则
    // （`<时间>_<标题>.json`），外部那份可能叫别的名字。不补这一刀的话，
    // 下次快照会因为"本地有、文件夹叫别的名"而多出一份重复文件。
    //
    // 这里必须**同步写完**（而不是丢给 autoSync 的 700ms 防抖）：
    // 否则在对齐完成到快照执行之间有一个窗口，此时 reconciled 已经为 true，
    // 清理闸门放开了，而当前快照的 sessions 列表还是导入前的旧列表 ——
    // 正好会把刚收进来的那几个文件删掉。实测就是这么丢的。
    try {
      autoSyncSuspended++;
      await snapshot('reverse-import');
    } catch (e) {
      warn('收进来之后写回文件夹失败：' + ((e && e.message) || e));
    } finally {
      autoSyncSuspended--;
    }
    return toWrite.length;
  }

  /** 把文件夹里读到的原始 JSON 归一化成应用认识的会话结构 */
  function normalizeSession(parsed) {
    return {
      id: parsed.id,
      title: parsed.title == null ? null : parsed.title,
      createdAt: parsed.createdAt == null ? null : parsed.createdAt,
      updatedAt: parsed.updatedAt == null ? null : parsed.updatedAt,
      rootMessageId: parsed.rootMessageId == null ? null : parsed.rootMessageId,
      messages: Array.isArray(parsed.messages) ? parsed.messages : []
    };
  }

  /** 32 位字符串哈希（FNV-1a）。只用来判断「文件内容变没变」，不做安全用途。 */
  function strHash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  /**
   * 定时扫描：发现外部新增/修改的会话就合并进来并刷新。
   *
   * 判新规则（比单纯看时间戳可靠，也不会被"整目录重写"误触发）：
   *   1. 先用 name|size|lastModified 做粗筛，没变过的文件连读都不用读；
   *   2. 粗筛变了的，读内容算哈希，和上次记下的哈希比对 ——
   *      内容没变就只是被别人重写了一遍，跳过；
   *   3. 内容真变了，再比 updatedAt：只有文件比本地新才收，
   *      避免把这边刚编辑还没落盘的内容用旧文件盖回去。
   */
  async function pollFolderForChanges() {
    if (syncState.running) return;                 // 自己正在写盘，先别读
    if (document.visibilityState === 'hidden') return; // 后台标签页不用管
    var list;
    try {
      list = await scanSessionFiles();
    } catch (e) {
      watchState.lastError = (e && e.message) || String(e);
      return;
    }
    if (!list) return;
    watchState.lastScan = Date.now();
    if (!watchState.hashes) watchState.hashes = {};

    // 粗筛
    var candidates = [];
    for (var c = 0; c < list.length; c++) {
      var meta = list[c].name + '|' + list[c].size + '|' + list[c].lastModified;
      var known = watchState.hashes[list[c].name];
      if (known && known.meta === meta) continue;
      candidates.push(list[c]);
    }
    if (!candidates.length) return;

    var convDir = await subdir(await getRootHandle(), '对话', false);
    var reads = [];
    for (var i = 0; i < candidates.length; i++) {
      var raw;
      try {
        raw = await readTextFile(convDir, candidates[i].name);
      } catch (e) {
        continue;
      }
      var h = strHash(raw);
      var prev = watchState.hashes[candidates[i].name];
      watchState.hashes[candidates[i].name] = {
        h: h,
        meta: candidates[i].name + '|' + candidates[i].size + '|' + candidates[i].lastModified
      };
      if (prev && prev.h === h) continue;   // 内容没变，只是被重写了
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        continue; // 写了一半的文件，下一轮再读
      }
      if (!parsed || !parsed.id) continue;
      reads.push(normalizeSession(parsed));
    }
    if (!reads.length) return;

    // 只收「本地没有的」和「本地更旧的」
    var local = await readAllSessions();
    var localById = {};
    for (var k = 0; k < local.length; k++) localById[local[k].id] = local[k];
    var toWrite = reads.filter(function (s) {
      var l = localById[s.id];
      if (!l) return true;
      return (s.updatedAt || 0) > (l.updatedAt || 0);
    });
    if (!toWrite.length) return;

    log('文件夹里有 ' + toWrite.length + ' 个更新过的对话，正在收进来');
    autoSyncSuspended++;
    try {
      await writeBack(toWrite, [], null);
    } finally {
      autoSyncSuspended--;
    }
    watchState.imported += toWrite.length;
    watchState.lastImported = toWrite.map(function (s) { return s.title; });
    lsSet(LS_HISTORY_SYNCED_AT, String(Date.now()));
    emitSync();

    // 页面重载才能让应用看见新数据（应用只在启动时读一次库）
    if (watchReloadEnabled()) {
      try {
        location.reload();
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * 装上文件夹监看（进页面时和连上文件夹后都调一次）。
   *
   * 扫描节奏是自适应的：用户在操作（最近 30 秒内有鼠标/键盘/滚动）时用快节奏，
   * 让它接近「实时」；闲置时降到慢节奏，省得在大存档上每 3 秒空读几百个文件。
   * 标签页重新可见时立刻补一次，保证「切回来就已经是最新的」。
   */
  var lastActivityAt = 0;
  function markActivity() {
    lastActivityAt = Date.now();
  }
  /** 挂起 / 就绪信号。
   *  测试需要知道「启动对齐跑完了」才好断言，否则会跟它对撞。 */
  var watchReadyResolve = null;
  var watchReadyPromise = null;
  function watchReady() {
    if (!watchReadyPromise) {
      watchReadyPromise = new Promise(function (res) {
        watchReadyResolve = res;
        // 已经开始轮询说明对齐早做完了（重复调用的情况）
        if (watchTimer) res();
      });
    }
    return watchReadyPromise;
  }
  function markWatchReady() {
    if (watchReadyResolve) {
      try { watchReadyResolve(); } catch (e) { /* ignore */ }
    }
  }
  function currentWatchInterval() {
    // 测试可以用 localStorage 覆盖，免得等太久
    var forced = Number(lsGet('chat-demo:ls-watch-ms'));
    if (isFinite(forced) && forced > 0) return forced;
    return (Date.now() - lastActivityAt) < 30000 ? WATCH_INTERVAL : WATCH_IDLE_INTERVAL;
  }

  async function startFolderWatcher() {
    if (!supportsFs) return;
    if (lsGet(LS_WATCH) === 'false') return;

    // 活动监听只在第一次装上（重复注册会累积）
    if (!watchState.listenersBound) {
      watchState.listenersBound = true;
      ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'focus'].forEach(function (evt) {
        try {
          window.addEventListener(evt, markActivity, { passive: true });
        } catch (e) { /* ignore */ }
      });
      try {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible') return;
          markActivity();
          // 切回来立刻补一次（并重新排程），保证「切回来就已经是最新的」
          startFolderWatcher().catch(function () {});
        });
      } catch (e) { /* ignore */ }
    }
    watchState.enabled = true;

    // ⚠ 没有 root 时**不能**直接开跑。
    // 进页面时 boot() 就调了这里，而文件夹句柄要到后面才从 IndexedDB 里取出来；
    // 早跑的结果是扫到 no-root 之后又排了定时器，之后即使句柄到位也不会再对齐
    // —— 表现成「在网页版新建的对话怎么都收不进来」。
    // 正确做法是：先把监听装上（等用户/后面的代码把 root 拿来），
    // 一旦发现有 root 就补做一次启动对齐。
    var root;
    try {
      root = await getRootHandle();
    } catch (e) {
      root = null;
    }
    if (!root) {
      // 先空转着，等下一次调度或者 pickFolder / reconnect 再补
      watchState.booted = false;
      markWatchReady();
      scheduleNextWatch();
      return;
    }
    if (watchState.booted) {
      markWatchReady();
      scheduleNextWatch();
      return;
    }
    watchState.booted = true;

    // 有 root 了：先对齐一次（把文件夹里比本地新的收进来），再开始轮询。
    // 顺序反了会把启动瞬间的老文件重复导入。
    primeFolderWatcher()
      .then(function () {
        return reconcileFolderOnBoot();
      })
      .then(function (n) {
        if (n && watchReloadEnabled()) {
          try { location.reload(); } catch (e) { /* ignore */ }
          return;
        }
        scheduleNextWatch();
        markWatchReady();
      })
      .catch(function (e) {
        watchState.lastError = (e && e.message) || String(e);
        scheduleNextWatch();
        markWatchReady();
      });
  }

  /** 用 setTimeout 自排下一轮，这样节奏可以随活动状态变 */
  function scheduleNextWatch() {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(function () {
      pollFolderForChanges()
        .catch(function (e) { watchState.lastError = (e && e.message) || String(e); })
        .then(function () { scheduleNextWatch(); });
    }, currentWatchInterval());
  }

  async function reconnect() {
    var root = await getRootHandle();
    if (!root) throw new Error('没有已保存的文件夹');
    var perm = await ensurePermission(root, true);
    if (perm !== 'granted') throw new Error('授权被拒绝');
    dirCache = root;
    emitSync();
    return root;
  }

  /**
   * 从镜像文件夹读取全部会话与附件元信息。
   * 会话内容以 `对话/*.json` 为准（含完整分支树）。
   */
  async function loadFromFolder(onProgress) {
    var root = await getRootHandle();
    if (!root) throw new Error('尚未选择本地文件夹');
    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') throw new Error('需要重新授权文件夹访问权限');

    var convDir;
    try {
      convDir = await subdir(root, '对话', false);
    } catch (e) {
      throw new Error('该文件夹不是有效的 chat-demo 存档（缺少「对话」子目录）');
    }

    var names = await listSessionJson(convDir);
    var sessions = [];
    var fileIdSet = new Map();

    for (var i = 0; i < names.length; i++) {
      var raw;
      try {
        raw = await readTextFile(convDir, names[i]);
      } catch (e) {
        warn('无法读取', names[i], e);
        continue;
      }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        warn('跳过无法解析的文件', names[i]);
        continue;
      }
      if (!parsed || !parsed.id) continue;

      sessions.push({
        id: parsed.id,
        title: parsed.title == null ? null : parsed.title,
        createdAt: parsed.createdAt == null ? null : parsed.createdAt,
        updatedAt: parsed.updatedAt == null ? null : parsed.updatedAt,
        rootMessageId:
          parsed.rootMessageId == null ? null : parsed.rootMessageId,
        messages: Array.isArray(parsed.messages) ? parsed.messages : []
      });

      (parsed.messages || []).forEach(function (m) {
        if (m && m.role === 'user' && Array.isArray(m.files)) {
          m.files.forEach(function (f) {
            if (f && f.id && !fileIdSet.has(f.id)) fileIdSet.set(f.id, f);
          });
        }
      });

      if (onProgress) onProgress(i + 1, names.length);
    }

    // 附件：能读到原件的就读回来，否则仅保留元信息
    var files = [];
    var attachDir = null;
    try {
      attachDir = await subdir(root, '附件', false);
    } catch (e) {
      /* 无附件目录，正常 */
    }

    // 先把附件目录里的文件名索引成 id → handle，避免每个附件都重扫目录
    var attachIndex = new Map();
    if (attachDir) {
      for await (var entry of attachDir.values()) {
        if (entry.kind !== 'file') continue;
        // 文件名形如 `<fileId>.<ext>`，fileId 本身可能含点，所以用前缀匹配择优
        attachIndex.set(entry.name, entry);
      }
    }

    function findAttachment(fileId) {
      var best = null;
      attachIndex.forEach(function (handle, name) {
        if (name !== fileId && name.indexOf(fileId + '.') !== 0) return;
        // 取最短匹配，避免 `abc` 误配到 `abcd.png`
        if (!best || name.length < best.name.length) best = { name: name, handle: handle };
      });
      return best ? best.handle : null;
    }

    for (var meta of fileIdSet.values()) {
      var record = {
        id: meta.id,
        name: meta.name == null ? null : meta.name,
        size: meta.size == null ? null : meta.size,
        mimeType: meta.mimeType == null ? null : meta.mimeType,
        isImage: !!meta.isImage,
        serverId: meta.serverId == null ? null : meta.serverId
      };
      // 所有类型的附件都尝试把原件读回来（不只是图片）
      try {
        var handle = findAttachment(meta.id);
        if (handle) {
          var got = await handle.getFile();
          // 数据库里 expects 的是 File（应用上传时会带 name/type），
          // 从文件夹读回来的是 File，但 type 可能是空的，尽量补上
          record.blob = got;
          if (!record.size && got.size) record.size = got.size;
        }
      } catch (e) {
        /* 附件恢复失败不影响主流程 */
      }
      files.push(record);
    }

    return { sessions: sessions, files: files, names: names };
  }

  /** 从文件夹恢复进浏览器数据库（覆盖式，与官方导入语义一致） */
  async function restoreFromFolder(onProgress) {
    var loaded = await loadFromFolder(onProgress);
    if (!loaded.sessions.length) throw new Error('文件夹里没有可恢复的对话');

    autoSyncSuspended++;
    try {
      await writeBack(loaded.sessions, loaded.files, function (d, t) {
        if (onProgress) onProgress(d, t);
      });
    } finally {
      autoSyncSuspended--;
    }
    lsSet(LS_HISTORY_SYNCED_AT, String(Date.now()));
    return { sessions: loaded.sessions.length, files: loaded.files.length };
  }

  /**
   * 全新浏览器（或清空数据后）自动把对话读回来。
   *
   * 判断「全新」的依据：
   *   · 没有历史同步标记 —— 本浏览器从没跟这个文件夹打过交道；
   *   · 且本地库是空的 —— 避免把已有数据覆盖掉。
   * 两个条件都成立才动手，因此对老用户完全无感。
   */
  async function maybeAutoRestoreHistory() {
    if (lsGet(LS_HISTORY_SYNCED_AT)) return { skipped: 'already-synced' };

    var count = await countLocalSessions();
    if (count > 0) return { skipped: 'local-not-empty', count: count };

    try {
      var r = await restoreFromFolder();
      if (r && r.sessions) {
        log('首次连接：已自动从文件夹恢复 ' + r.sessions + ' 个对话');
        return { restored: r.sessions };
      }
    } catch (e) {
      // 文件夹里没有对话属正常情况，不打扰用户
      return { skipped: 'empty-or-error', message: (e && e.message) || String(e) };
    }
    return { skipped: 'nothing' };
  }

  /** 数一数本地库里有几个对话 */
  async function countLocalSessions() {
    try {
      var db = await openOwnDb();
      var n = await new Promise(function (resolve) {
        var tx = db.transaction('sessions', 'readonly');
        var rq = tx.objectStore('sessions').count();
        rq.onsuccess = function () {
          resolve(rq.result);
        };
        rq.onerror = function () {
          resolve(-1);
        };
      });
      db.close();
      return n;
    } catch (e) {
      return -1; // 数不出来时按「不安全」处理：不自动恢复
    }
  }

  // -------------------------------------------------------------------------
  // 首次连接后的对账
  // -------------------------------------------------------------------------

  /** 读取镜像文件夹里的 manifest（若存在） */
  /**
   * 读上一次快照写下的会话索引（`数据/sessions.json`）。
   *
   * 结构是 `{ manifest: {...}, sessions: [{ id, title, files: [...] }] }`。
   * 清理逻辑靠它判断「哪些文件是本机自己写的」——这是防止把外部
   * （网页版 / 另一台机器）新增的对话误删的关键依据。
   */
  async function readSessionIndex() {
    var root = await getRootHandle();
    if (!root) return null;
    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') return null;
    try {
      var dataDir = await subdir(root, '数据', false);
      var text = await readTextFile(dataDir, 'sessions.json');
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  async function readManifest() {
    var root = await getRootHandle();
    if (!root) return null;
    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') return null;
    try {
      var dataDir = await subdir(root, '数据', false);
      var text = await readTextFile(dataDir, 'manifest.json');
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // API Key 存到文件夹
  // -------------------------------------------------------------------------

  /**
   * 说明：官方应用把 API Key 存在 localStorage['chat-demo:api-key']。
   * 这里做的是「镜像 + 回填」——不改变官方读取位置，只是在文件夹里留一份副本，
   * 并支持从副本回填到浏览器。好处是清空浏览器数据后密钥不会丢。
   *
   * 安全提示：明文保存。该文件夹不应上传网盘或提交到 Git。
   */

  /**
   * 收集所有提供方的 Key，用于一并存进文件夹。
   *
   * 为什么需要：官方只有一个 Key 槽位（chat-demo:api-key），而自定义提供方
   * 各自有自己的 Key，存在 chat-demo:providers 里。settings.json 明确不含
   * 密钥，所以这些 Key 必须由 apikey.json 一起带走 —— 否则换浏览器后
   * 自定义提供方的 Key 全是空的，还得一个个重填。
   */
  function collectProviderKeys() {
    var out = {};
    try {
      var st = getProviders();
      st.list.forEach(function (p) {
        if (p && p.id && typeof p.apiKey === 'string' && p.apiKey.trim()) {
          out[p.id] = p.apiKey.trim();
        }
      });
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  /** 把文件夹里的提供方 Key 填回本地（只在本地为空时填，不覆盖用户已填的） */
  function applyProviderKeys(map) {
    if (!map || typeof map !== 'object') return 0;
    var st = getProviders();
    var n = 0;
    st.list.forEach(function (p) {
      if (!p || !p.id) return;
      var v = map[p.id];
      if (typeof v !== 'string' || !v.trim()) return;
      if (p.apiKey && p.apiKey.trim()) return; // 本地已有，不动
      p.apiKey = v.trim();
      n++;
    });
    if (n) {
      saveProviders();
      log('已从文件夹恢复 ' + n + ' 个提供方的 API Key');
    }
    return n;
  }

  async function writeKeyToFolder() {
    var key = lsGet(LS_APP_API_KEY) || '';
    var providerKeys = collectProviderKeys();
    // 官方那一个 Key 可能还没填（用户在别的地方填），只要还有提供方的 Key
    // 就值得写这个文件，否则自定义提供方的 Key 永远同步不过去。
    if (!key && !Object.keys(providerKeys).length) throw new Error(t('keyNone'));
    var root = await getRootHandle();
    if (!root) throw new Error('尚未选择本地文件夹');
    var perm = await ensurePermission(root, true);
    if (perm !== 'granted') throw new Error('未获得文件夹读写权限');

    var dataDir = await subdir(root, '数据', true);
    var payload = {
      schema: 'chat-demo-mirror/apikey@2',
      warning:
        '本文件包含明文 API Key。请勿上传网盘、提交到 Git 或分享给他人。',
      savedAt: Date.now(),
      savedAtText: fmtTime(Date.now()),
      apiBase: lsGet(LS_API_BASE) || DEFAULT_API_BASE,
      apiKey: key,
      // 每个提供方各自的 Key（官方那一路就是上面的 apiKey）
      providerKeys: providerKeys
    };
    await writeText(dataDir, KEY_FILE, JSON.stringify(payload, null, 2));

    // 让 数据/README 之类的提示信息也标记一下
    lsSet('chat-demo:local-key', '1');
    // 同时收进提供方，让设置面板与实际上使用的 Key 保持一致
    if (key) adoptKeyIntoActiveProvider(key);
    return payload;
  }

  async function readKeyFromFolder() {
    var root = await getRootHandle();
    if (!root) return null;
    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') return null;
    try {
      var dataDir = await subdir(root, '数据', false);
      var text = await readTextFile(dataDir, KEY_FILE);
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') return null;
      var hasOfficial = typeof parsed.apiKey === 'string' && parsed.apiKey.trim();
      var hasProvider =
        parsed.providerKeys && Object.keys(parsed.providerKeys).length > 0;
      // 只要有任意一种 Key 就认这个文件（老版本文件只有 apiKey）
      if (hasOfficial || hasProvider) return parsed;
    } catch (e) {
      /* 文件不存在或损坏 */
    }
    return null;
  }

  async function removeKeyFromFolder() {
    var root = await getRootHandle();
    if (!root) throw new Error('尚未选择本地文件夹');
    var perm = await ensurePermission(root, true);
    if (perm !== 'granted') throw new Error('未获得文件夹读写权限');
    try {
      var dataDir = await subdir(root, '数据', false);
      await removeEntry(dataDir, KEY_FILE);
    } catch (e) {
      /* ignore */
    }
    lsSet('chat-demo:local-key', null);
  }

  /**
   * 启动时：如果浏览器里没有 Key，而文件夹里有，就回填并刷新。
   * 只回填、不反向覆盖，避免误删用户刚输入的 Key。
   */
  async function hydrateKeyFromFolder() {
    // 提供方各自的 Key 先填（它不依赖官方的开关，因为 settings.json 不含密钥，
    // 换浏览器后这些 Key 只能从这里来）。
    var payload = await readKeyFromFolder();
    var filled = 0;
    if (payload) filled = applyProviderKeys(payload.providerKeys);

    if (lsGet('chat-demo:local-key') !== '1') {
      // 官方那个 Key 的回填受开关控制
      return filled > 0;
    }
    if (!payload) return false;
    if (!payload.apiKey || !payload.apiKey.trim()) return filled > 0;
    if (lsGet(LS_APP_API_KEY)) return filled > 0; // 浏览器里已有，不动

    lsSet(LS_APP_API_KEY, payload.apiKey);
    // 顺带把 base URL 也恢复（如果文件夹里记着且浏览器里没设）
    if (payload.apiBase && !lsGet(LS_API_BASE)) {
      lsSet(LS_API_BASE, payload.apiBase);
    }
    log('已从文件夹恢复 API Key');
    return true;
  }

  // -------------------------------------------------------------------------
  // 设置项存到文件夹
  // -------------------------------------------------------------------------
  //
  // 「设置」在这里指官方应用写在 localStorage 里的一堆偏好：语言、主题、
  // 思考模式、联网搜索、语音音色、侧边栏折叠状态等。它们同样是「清了浏览器
  // 数据就没了」的东西，所以一并镜像到文件夹，换浏览器也能带走。
  //
  // 存哪些由 SETTINGS_ALLOW 白名单决定，而不是「把所有 chat-demo:* 都存」：
  //   · chat-demo:local-folder 是文件夹句柄的名字，换机器后指向的目录可能
  //     根本不存在，恢复它只会造成误导；
  //   · chat-demo:api-key 由 apikey.json 单独管，避免两处重复且不一致；
  //   · chat-demo:local-key / local-autosync 属于本工具的开关，各机器独立更合理。
  //
  // 注意 settings.json 里【不含】任何密钥，是纯偏好文件，可以安全阅读。

  var SETTINGS_FILE = 'settings.json';
  var SETTINGS_ALLOW = [
    'chat-demo:locale',
    'chat-demo:location',
    'chat-demo:theme-preference',
    'chat-demo:tts-voice',
    'chat-demo:thinking',
    'chat-demo:search',
    'chat-demo:sider-collapsed',
    'chat-demo:providers',
    'chat-demo:active-provider',
    'chat-demo:model'
  ];

  // 记录「本浏览器最后一次与文件夹同步设置的时间」。
  // 用它代替「本地设置是否为空」来判断要不要回填 —— 后者是错的：
  // 桥接层自己在启动时就会写入 chat-demo:active-provider 与 chat-demo:model，
  // 所以白名单永远不为空，自动恢复永远不会触发（这就是跨浏览器设置不同步的原因）。
  var LS_SETTINGS_SYNCED_AT = 'chat-demo:settings-synced-at';

  /** 本地是否已经完成过一次设置同步（有标记即视为已完成） */
  function hasLocalSettingsSync() {
    return !!lsGet(LS_SETTINGS_SYNCED_AT);
  }

  /** 收集当前浏览器里的设置快照 */
  function collectSettings() {
    var out = {};
    SETTINGS_ALLOW.forEach(function (k) {
      var v = lsGet(k);
      if (v !== null && v !== undefined) out[k] = v;
    });
    return out;
  }

  async function writeSettingsToFolder() {
    var root = await getRootHandle();
    if (!root) throw new Error(t('needFolder'));
    var perm = await ensurePermission(root, true);
    if (perm !== 'granted') throw new Error(t('noPermission'));

    var dataDir = await subdir(root, '数据', true);
    var settings = collectSettings();
    var payload = {
      schema: 'chat-demo-mirror/settings@1',
      note: '本文件不含密钥，可安全阅读。密钥见同目录的 apikey.json。',
      savedAt: Date.now(),
      savedAtText: fmtTime(Date.now()),
      settings: settings
    };
    await writeText(dataDir, SETTINGS_FILE, JSON.stringify(payload, null, 2));
    lsSet(LS_SETTINGS_SYNCED_AT, String(payload.savedAt));
    return { count: Object.keys(settings).length, payload: payload };
  }

  async function readSettingsFromFolder() {
    var root = await getRootHandle();
    if (!root) return null;
    var perm = await ensurePermission(root, false);
    if (perm !== 'granted') return null;
    try {
      var dataDir = await subdir(root, '数据', false);
      var text = await readTextFile(dataDir, SETTINGS_FILE);
      var parsed = JSON.parse(text);
      if (parsed && parsed.settings && typeof parsed.settings === 'object') return parsed;
    } catch (e) {
      /* 文件不存在或损坏 */
    }
    return null;
  }

  /**
   * 把文件夹里的设置写回浏览器。
   *
   * 只覆盖白名单内的键，且「文件夹里有的才写」——这样即便某台机器上
   * 多了新键，也不会被旧文件抹掉。返回写入了几个键。
   */
  async function restoreSettingsFromFolder() {
    var payload = await readSettingsFromFolder();
    if (!payload) throw new Error(t('settingsNone'));

    var n = applySettings(payload.settings);
    lsSet(LS_SETTINGS_SYNCED_AT, String(payload.savedAt || Date.now()));
    return n;
  }

  /** 把文件夹里的一份设置应用进浏览器，返回**真正被改动**的键数 */
  function applySettings(settings, force) {
    var n = 0;
    Object.keys(settings).forEach(function (k) {
      if (SETTINGS_ALLOW.indexOf(k) === -1) return; // 白名单外的一律不认
      var v = settings[k];
      if (typeof v !== 'string') return;
      // 值没变就不要写，也不要算作「改动」。
      // 这一点很关键：快照每次都会把当前设置镜像进 settings.json，
      // 如果这里把「写入相同值」也算成改动，启动时就会误判成「文件夹有新设置」
      // 而反复要求刷新页面（表现为不停闪动）。
      if (!force && lsGet(k) === v) return;
      lsSet(k, v);
      n++;
    });
    if (!n) return 0;
    providersState = null;
    getProviders();
    applyActiveProvider(false);
    return n;
  }

  /**
   * 启动时自动回填设置。
   *
   * 核心判据是「文件夹里的值是否真的和本地不同」，而不是时间戳。
   *
   * 为什么不能只看时间戳：快照每次同步都会把当前设置**原样**写回
   * `settings.json`（它本来就是本地设置的镜像），于是文件夹里的 savedAt
   * 永远比本地的同步标记新一点。若据此判断「文件夹更新了」，
   * 每次刷新页面都会再要求刷新一次 —— 死循环，表现为页面不停闪动。
   *
   * 所以流程是：
   *   1. 先看有没有「真正不一样」的键；没有就直接结束（这是绝大多数情况）；
   *   2. 有差异才轮到时间戳说话：本机从没同步过 → 采纳；已同步过 →
   *      仅当文件夹比本地记录更新时才采纳，避免覆盖本机的改动。
   *
   * （更早的实现在这里判断「白名单是否为空」，但桥接层自己启动就会写
   *  `chat-demo:active-provider` 与 `chat-demo:model`，导致条件永远不成立，
   *  自动恢复形同虚设 —— 那是跨浏览器设置不同步的原因。）
   */
  async function hydrateSettingsFromFolder() {
    var payload = await readSettingsFromFolder();
    if (!payload || !payload.settings) return false;

    var localAt = Number(lsGet(LS_SETTINGS_SYNCED_AT) || 0);
    var folderAt = Number(payload.savedAt || 0);

    // 1) 内容是否真有差异？（不写入，只比价）
    var genuinelyNewer = false;
    Object.keys(payload.settings).forEach(function (k) {
      if (SETTINGS_ALLOW.indexOf(k) === -1) return;
      var v = payload.settings[k];
      if (typeof v !== 'string') return;
      if (lsGet(k) !== v) genuinelyNewer = true;
    });
    if (!genuinelyNewer) {
      // 完全一致：把标记对齐到文件夹时间即可，不要动任何东西
      if (folderAt && folderAt !== localAt) lsSet(LS_SETTINGS_SYNCED_AT, String(folderAt));
      return false;
    }

    // 2) 有差异，再看该不该采纳
    if (localAt && folderAt && folderAt <= localAt) return false;

    var n = applySettings(payload.settings);
    lsSet(LS_SETTINGS_SYNCED_AT, String(folderAt || Date.now()));
    if (!n) return false;
    log('已从文件夹恢复 ' + n + ' 项设置');
    return true;
  }

  // -------------------------------------------------------------------------
  // 多提供方（Provider）
  // -------------------------------------------------------------------------
  //
  // 背景：官方应用只认一个写死的 API 地址和一个 API Key，无法同时保留
  // 「DeepSeek 官方」「中转站 A」「自建服务」等多套配置。
  //
  // 设计：
  //   · 提供方列表整体存在 localStorage['chat-demo:providers']；
  //   · 每个提供方各自拥有 baseURL / apiKey / models / defaultModel；
  //   · 但官方 bundle 只读两个「单值槽位」——
  //       chat-demo:api-base（补丁 1）与 chat-demo:api-key（官方自身）。
  //     所以「设为默认提供方」= 把该提供方的 baseURL 与 apiKey 镜像进这两个槽位。
  //
  // 这样 bundle 端无需感知「多提供方」这一概念，改动面最小；
  // 代价是「当前生效」只能有一个，切换提供方需要重新加载页面让官方读取新 Key。
  //
  // 注意：整个应用只讲 Anthropic 协议（POST /anthropic/v1/messages），
  // 因此这里的「多个提供方」指多个 Anthropic 兼容端点。
  // 纯 OpenAI 协议的服务（/v1/chat/completions）无法直接使用。

  var LS_PROVIDERS = 'chat-demo:providers';
  var LS_ACTIVE_PROVIDER = 'chat-demo:active-provider';
  var LS_MODEL = 'chat-demo:model';
  var PROVIDERS_SCHEMA = 'chat-demo-providers@1';

  /** 官方内置提供方（不可删除） */
  var OFFICIAL_PROVIDER = {
    id: 'deepseek-official',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-flash',
    builtin: true
  };

  function uid(prefix) {
    return (
      (prefix || 'p') +
      '-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function cloneProvider(p) {
    return {
      id: p.id,
      name: p.name || '',
      baseURL: p.baseURL || '',
      apiKey: p.apiKey || '',
      models: Array.isArray(p.models) ? p.models.slice() : [],
      // 接口返回过的完整列表（含未勾选的），用于下次进设置页仍能显示全部候选
      availableModels: Array.isArray(p.availableModels) ? p.availableModels.slice() : [],
      defaultModel: p.defaultModel || '',
      builtin: !!p.builtin
    };
  }

  /**
   * 内置（官方）提供方的名称统一。
   *
   * 用户要求把界面上那个「DeepSeek 官方（统一配置）」改成「DeepSeek」。
   * 光改 OFFICIAL_PROVIDER.name 不够：老浏览器里 LS_PROVIDERS 已经把旧名字
   * 持久化下来了，读回来还是旧的。所以读的时候顺手归一化一次
   * （只认旧默认名，用户自己改过的名字不会被覆盖）。
   */
  var BUILTIN_NAME_ALIASES = ['DeepSeek 官方', 'DeepSeek 官方（统一配置）', 'DeepSeek official (unified config)'];

  function normalizeBuiltinName(p) {
    if (p && (p.builtin || p.id === OFFICIAL_PROVIDER.id)) {
      if (!p.name || BUILTIN_NAME_ALIASES.indexOf(p.name) !== -1) p.name = OFFICIAL_PROVIDER.name;
    }
    return p;
  }

  /**
   * 读取提供方列表。首次调用或数据损坏时，用旧版的单值配置做迁移，
   * 保证老用户升级后原来的地址不会被丢掉。
   */
  function loadProviders() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(LS_PROVIDERS) || 'null');
    } catch (e) {
      raw = null;
    }

    if (raw && Array.isArray(raw.list) && raw.list.length) {
      var list = raw.list
        .filter(function (p) {
          return p && p.id;
        })
        .map(cloneProvider)
        .map(normalizeBuiltinName);
      if (list.length) return { list: list, activeId: raw.activeId || list[0].id };
    }

    // 迁移：把旧的单值地址当成一个自定义提供方保留下来
    var oldBase = normalizeBase(lsGet(LS_API_BASE) || '');
    var oldKey = lsGet(LS_APP_API_KEY) || '';
    var official = cloneProvider(OFFICIAL_PROVIDER);
    var list = [official];
    var activeId = official.id;

    if (oldBase && oldBase !== OFFICIAL_PROVIDER.baseURL) {
      var custom = {
        id: uid('custom'),
        name: '自定义服务',
        baseURL: oldBase,
        apiKey: oldKey,
        models: [],
        defaultModel: '',
        builtin: false
      };
      list.push(custom);
      activeId = custom.id;
    } else if (oldKey) {
      official.apiKey = oldKey;
    }

    return { list: list, activeId: activeId };
  }

  var providersState = null;

  function getProviders() {
    if (!providersState) providersState = loadProviders();
    return providersState;
  }

  /** 深拷贝一份提供方状态，避免调用方拿到内部引用后误改 */
  function snapshotProviders(st) {
    return {
      list: (st.list || []).map(cloneProvider),
      activeId: st.activeId || ''
    };
  }

  /** 用一份状态**整体替换**当前提供方状态（内部引用与缓存一起换掉） */
  function commitProviders(next) {
    providersState = {
      list: (next.list || []).map(cloneProvider),
      activeId: next.activeId || ''
    };
    return providersState;
  }

  function saveProviders(next) {
    // 关键：先把该改的都改在「同一份内部状态」上，再从这份状态序列化。
    //
    // 之前这里是 `var st = getProviders(); st.list = st.list.map(cloneProvider);`
    // —— 如果此时外部刚通过 getProviders() 拿到内部对象并直接 push/改字段
    // （设置面板、测试脚本都会这样），那一步会把外部刚做的改动**整体丢弃**，
    // 表现就是「界面里改了提供方，一刷新就没了、activeId 还指向不存在的条目」。
    // 现在改为：接受外部传进来的状态并与内部缓存合并，然后整体提交。
    var st = getProviders();

    if (next && Array.isArray(next.list)) {
      st = { list: next.list, activeId: next.activeId || st.activeId };
    }

    // 合并：以内部缓存为准，但把「外部已经改过的那一份」认下来。
    // 外部若直接改了缓存里的对象，改动本来就在；这里只处理外部换了数组的情况。
    var committed = commitProviders(st);
    try {
      localStorage.setItem(
        LS_PROVIDERS,
        JSON.stringify({
          schema: PROVIDERS_SCHEMA,
          list: committed.list,
          activeId: committed.activeId
        })
      );
    } catch (e) {
      warn('保存提供方失败', e);
    }
  }

  function findProvider(id) {
    var st = getProviders();
    for (var i = 0; i < st.list.length; i++) {
      if (st.list[i].id === id) return st.list[i];
    }
    return null;
  }

  function getActiveProvider() {
    var st = getProviders();
    return findProvider(st.activeId) || st.list[0] || null;
  }

  /**
   * 把一个提供方设为默认：把它的 baseURL / apiKey 镜像进官方读取的两个槽位。
   * 返回 true 表示需要重新加载页面（Key 只在启动时读一次）。
   */
  /**
   * 规范化提供方的根地址。
   *
   * 应用会自己拼 `/anthropic/v1/messages`、`/anthropic/v1/files` 与 `/models`，
   * 所以这里存的必须是**裸根地址**。用户常常直接粘贴
   * `https://llmapi.paratera.com/anthropic`（中转站文档里就是这么写的），
   * 若原样存下去就会拼成 `/anthropic/anthropic/v1/files` —— 上传必失败。
   */
  function normalizeBase(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    s = s.replace(/\/+$/, '');
    // 已经是完整的 /anthropic/v1 也接受：把版本段和后缀一起去掉
    s = s.replace(/\/anthropic\/v\d+$/i, '');
    s = s.replace(/\/anthropic$/i, '');
    return s.replace(/\/+$/, '');
  }

  function applyActiveProvider(reloadIfChanged) {
    var st = getProviders();
    var p = getActiveProvider();
    if (!p) return false;

    var base = normalizeBase(p.baseURL || OFFICIAL_PROVIDER.baseURL);
    var key = p.apiKey || '';

    var prevBase = lsGet(LS_API_BASE) || '';
    var prevKey = lsGet(LS_APP_API_KEY) || '';

    lsSet(LS_API_BASE, base === OFFICIAL_PROVIDER.baseURL ? null : base);
    window.__CHAT_API_BASE__ = base;
    lsSet(LS_API_BASE + ':active', base); // 仅用于界面展示「当前生效」
    lsSet(LS_ACTIVE_PROVIDER, st.activeId);

    if (key) lsSet(LS_APP_API_KEY, key);

    if (p.defaultModel) lsSet(LS_MODEL, p.defaultModel);

    var changed = prevBase !== (lsGet(LS_API_BASE) || '') || prevKey !== key;
    return changed && !!reloadIfChanged;
  }

  /**
   * 反向同步：把「应用里已有的 Key」收进当前提供方。
   *
   * 为什么需要这一步：应用本身的界面（设置弹窗里的「输入 API Key」）会直接把
   * Key 写进 localStorage，桥接层看不到这个过程。如果不回收，就会出现：
   *   · 设置面板里显示「尚未填写 API Key」，但应用其实已经能用；
   *   · 用户在设置面板里点一次「保存」，就用空 Key 覆盖掉原本可用的 Key，
   *     之后每次启动都被判定为「API Key 无效」。
   * 这正是之前一直提示 Key 无效的根因。
   *
   * 优先级：文件夹里的 Key > 应用槽位里的 Key。
   * 注意 Key 只在「提供方自己为空」时被回收，避免覆盖用户手填的值。
   */
  function adoptKeyIntoActiveProvider(folderKey) {
    var st = getProviders();
    var p = getActiveProvider();
    if (!p) return false;

    var isOfficial = !!p.builtin || p.id === OFFICIAL_PROVIDER.id;
    var folderVal = folderKey && folderKey.trim();

    // 应用槽位里的 Key 只属于「官方统一配置」那一路。
    // 当前若是自定义提供方，就只有文件夹里明确给它的那份才认，
    // 否则会把用户给该提供方单独配的 Key 覆盖成官方那一个。
    if (!isOfficial && !folderVal) return false;

    var appKey = lsGet(LS_APP_API_KEY) || '';
    var next = folderVal || appKey.trim();
    if (!next) return false;
    if (p.apiKey && !folderVal) return false; // 已有值且没有新证据

    if (p.apiKey === next) return false;
    p.apiKey = next;
    saveProviders();
    log('已把 API Key 收进提供方「' + (p.name || p.id) + '」');
    return true;
  }

  /** 把文件夹里的 Key 收进当前提供方（不覆盖用户已填的值） */
  async function syncKeyFromFolderToProvider() {
    var payload = await readKeyFromFolder();
    if (!payload || !payload.apiKey) return false;
    return adoptKeyIntoActiveProvider(payload.apiKey);
  }

  /**
   * 让「应用槽位」与「当前提供方」的 Key 保持一致。
   *
   * 为什么必须做：官方在「数据管理」标签页里自带一个 API Key 编辑框
   * （apiKeyStart / apiKeyEdit / apiKeyPlaceholder），它在提交后直接把
   * Key 写进 `chat-demo:api-key`，桥接层收不到任何通知。
   * 而桥接层又在「通用设置」里给每个提供方各提供了一份 Key。
   * 两处编辑同一个槽位，不同步就会出现：
   *   · 官方面板里换了 Key，设置里显示的还是旧的；
   *   · 设置里保存了旧 Key，把刚换上的新 Key 又覆盖回去（表现为「Key 无效」）。
   *
   * 策略：
   *   · 用户【在官方面板里】改动（槽位有值且与提供方不同）→ 采纳进提供方；
   *   · 用户【在提供方卡片里】改动 → 由卡片自己的保存逻辑写进槽位；
   *   · 槽位为空时不动，避免把用户刚清空的动作又填回去。
   */
  var keySyncTimer = null;
  var lastSeenAppKey = null;

  function reconcileKey() {
    var st = getProviders();
    var p = getActiveProvider();
    if (!p) return;

    // 只有「官方统一配置」在生效时才做对账。
    // 官方那个输入框永远指代官方那一路，若当前用的是自定义提供方，
    // 把它写进来就会把用户为该提供方单独配的 Key 覆盖掉。
    if (!p.builtin && p.id !== OFFICIAL_PROVIDER.id) {
      lastSeenAppKey = lsGet(LS_APP_API_KEY) || '';
      return;
    }

    var appKey = lsGet(LS_APP_API_KEY) || '';
    if (appKey === lastSeenAppKey) return; // 没有变化
    lastSeenAppKey = appKey;
    if (!appKey) return; // 槽位被清空，交给用户后续操作

    if (p.apiKey !== appKey) {
      p.apiKey = appKey;
      saveProviders();
      log('已同步 API Key 到提供方「' + (p.name || p.id) + '」');
      refreshSettingsSection();
    }
  }

  function startKeySync() {
    lastSeenAppKey = lsGet(LS_APP_API_KEY) || '';
    if (keySyncTimer) clearInterval(keySyncTimer);
    // localStorage 在同一文档内的写入不会派发 storage 事件，所以用轻量轮询；
    // 只是读一个字符串做比较，开销可以忽略。
    keySyncTimer = setInterval(reconcileKey, 1000);
    window.addEventListener('storage', function (e) {
      if (e && e.key === LS_APP_API_KEY) reconcileKey();
    });
  }

  /** 设置区块若已挂载，重建它让界面显示最新值 */
  function refreshSettingsSection() {
    if (!document.getElementById(UI_ID)) return;
    var container = findMountContainer();
    if (!container) return;
    var old = document.getElementById(UI_ID);
    if (old) old.remove();
    container.appendChild(renderSection());
  }

  /**
   * 当前生效的 API 地址：优先用显式记录的值，其次回退旧键。
   * 之所以单独记一个 ':active' 键：当生效地址恰好等于官方地址时，
   * chat-demo:api-base 会被清空（保持「未设置」的语义），
   * 界面就无从得知「当前生效」到底是哪个，故另存一份供展示。
   */
  function effectiveApiBase() {
    var explicit = lsGet(LS_API_BASE + ':active');
    if (explicit && explicit.trim()) return explicit.trim();
    var legacy = lsGet(LS_API_BASE);
    if (legacy && legacy.trim()) return legacy.trim();
    var p = getActiveProvider();
    if (p && p.baseURL) return p.baseURL;
    return DEFAULT_API_BASE;
  }

  /**
   * 当前生效的模型：官方补丁从这个键取值，所以这里必须与它一致。
   * 未选择时回退到默认提供方的默认模型，再回退官方默认。
   */
  function effectiveModel() {
    var chosen = lsGet(LS_MODEL);
    if (chosen && chosen.trim()) return chosen.trim();
    var p = getActiveProvider();
    if (p && p.defaultModel) return p.defaultModel;
    return 'deepseek-flash';
  }

  /**
   * 拉取某个提供方的模型列表。
   *
   * 官方 /models 返回 OpenAI 风格的 { data:[{ id, name, ... }] }；
   * 为兼容不同中转站，这里同时容忍 Anthropic 风格与裸数组，
   * 并且把解析失败的原因如实抛出去，而不是静默返回空列表。
   */
  async function fetchModelsFor(providerId) {
    var p = findProvider(providerId);
    if (!p) throw new Error(t('provErrNoProvider'));

    var base = normalizeBase(p.baseURL || OFFICIAL_PROVIDER.baseURL);
    var key = p.apiKey || '';

    // 依次尝试三种常见挂载路径：官方既支持 /models 也支持 /anthropic/v1/models，
    // 各家中转站（one-api / LiteLLM / new-api 等）习惯不同，全部试一遍。
    var attempts = [
      { url: base + '/anthropic/v1/models', auth: 'x-api-key' },
      { url: base + '/models', auth: 'bearer' },
      { url: base + '/v1/models', auth: 'bearer' }
    ];

    var errors = [];
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      var headers = {};
      if (key) {
        if (a.auth === 'x-api-key') headers['x-api-key'] = key;
        else headers['Authorization'] = 'Bearer ' + key;
      }
      try {
        var res = await window.fetch(a.url, { method: 'GET', headers: headers });
        if (!res.ok) {
          errors.push(a.url + ' → HTTP ' + res.status);
          continue;
        }
        var text = await res.text();
        var ids = parseModelList(text);
        if (ids.length) return { models: ids, url: a.url };
        errors.push(a.url + ' → ' + t('provErrEmpty'));
      } catch (e) {
        errors.push(a.url + ' → ' + ((e && e.message) || e));
      }
    }

    throw new Error(
      t('provErrFetch') + '\n' + errors.map(function (x) { return '  · ' + x; }).join('\n')
    );
  }

  /** 从各种可能的返回结构里提取模型 id 列表 */
  function parseModelList(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return [];
    }
    var arr = null;
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.data)) arr = data.data; // OpenAI / Anthropic
    else if (data && Array.isArray(data.models)) arr = data.models;
    if (!arr) return [];

    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var id =
        typeof item === 'string'
          ? item
          : (item && (item.id || item.name || item.model)) || '';
      id = String(id).trim();
      if (!id || seen[id]) continue;
      seen[id] = 1;
      out.push(id);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 真实模型名：拦截 fetch 读取 SSE 的 message_start
  // -------------------------------------------------------------------------

  /**
   * 官方 bundle 在解析 message_start 时会丢掉 message.model 字段，
   * 且助手消息的 model 恒为写死的 "deepseek-flash"。
   * 这里通过包裹 window.fetch，从响应流里读出服务端真实模型名，
   * 再在 IndexedDB 写入时补进消息对象，从而：
   *   1. 每条回答都能显示真实模型；
   *   2. 导出的 Markdown / JSON 里也带上模型信息。
   */
  var pendingModel = null;
  var modelListeners = new Set();

  function looksLikeSse(res) {
    try {
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('text/event-stream') !== -1) return true;
      // 有些代理不返回正确的 content-type，用 URL 兜底
      return false;
    } catch (e) {
      return false;
    }
  }

  function urlLooksLikeMessages(url) {
    try {
      var s = typeof url === 'string' ? url : (url && url.url) || '';
      return /\/messages(\?|$)/.test(s);
    } catch (e) {
      return false;
    }
  }

  /* ==================================================================== *
   * 单次请求的 token 上限（超了就本地截断，别让服务端打回来）
   *
   * 背景：服务端硬上限是 32768 tokens，超了直接回
   *   `user input too long, 34112 tokens exceeds max 32768 tokens`
   * 整个请求失败、这条消息白打。应用本身**没有任何本地上限检查**
   * （bundle 里搜不到 32768 / exceeds max / too long），所以只能在发出前拦。
   *
   * 做法：请求体里算一遍估算 token 数，超了就把**最长的那些文本块**截短，
   * 保证请求一定能过。宁可内容少一点，也不要整条失败。
   * ==================================================================== */

  /** 服务端硬上限 */
  var REQ_TOKEN_MAX = 32768;
  /** 留出余量给服务端可能追加的东西（系统提示、工具定义等） */
  var REQ_TOKEN_BUDGET = 30000;
  /** 上限可以被设置覆盖（见 localstore 设置里的 tokenLimit） */
  var reqTokenLimit = null;

  function effectiveTokenBudget() {
    if (reqTokenLimit && reqTokenLimit > 0) {
      // 用户设的上限就是"我要的上限"，再留 8% 余量
      return Math.floor(reqTokenLimit * 0.92);
    }
    // 服务端报过精确值时，用它的真实上限来定预算（最准）
    if (serverTokenFact.max > 0) return Math.floor(serverTokenFact.max * 0.92);
    return REQ_TOKEN_BUDGET;
  }

  /**
   * 粗略估 token 数。
   *
   * 不去引 tokenizer（体积/依赖都不合适）。按"字符类别"分开估，
   * 这是业界常用的近似：
   *   · CJK（中日韩）大约 1 字 ≈ 1 token，甚至更多
   *   · 拉丁字母/数字大约 4 字符 ≈ 1 token
   *   · 其它（标点、符号、emoji）按 2 字符 ≈ 1 token
   * 偏保守（宁可高估），这样不会因为低估而被服务端打回。
   */
  function estimateTokens(text) {
    if (!text) return 0;
    var s = String(text);
    var cjk = 0, ascii = 0, other = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x2e80 && c <= 0x9fff) cjk++;          // CJK 统一表意 + 部首
      else if (c >= 0xac00 && c <= 0xd7af) cjk++;     // 韩文
      else if (c >= 0x3040 && c <= 0x30ff) cjk++;     // 日文假名
      else if (c >= 0xf900 && c <= 0xfaff) cjk++;     // CJK 兼容
      else if (c >= 0xff00 && c <= 0xffef) cjk++;     // 全角
      else if (c < 128) ascii++;
      else other++;
    }
    return Math.ceil(cjk + ascii / 4 + other / 2);
  }

  /**
   * 估算一段 content 的 token。
   *
   * ⚠ 必须同时支持两种形态，应用的正文用的就是 block 数组：
   *   · 纯字符串        content: "……"
   *   · block 数组      content: [{type:'text', text:'……'}, …]
   * 之前只处理字符串，数组会被估成 0 —— 于是超限请求全都漏过去了。
   */
  function estimateContentTokens(c) {
    if (!c) return 0;
    if (typeof c === 'string') return estimateTokens(c);
    if (Array.isArray(c)) {
      var total = 0;
      for (var i = 0; i < c.length; i++) {
        var b = c[i];
        if (!b) continue;
        if (typeof b === 'string') { total += estimateTokens(b); continue; }
        if (typeof b.text === 'string') total += estimateTokens(b.text);
        // 工具调用/结果这些也占 token，用 JSON 长度粗估
        if (b.input) total += estimateTokens(JSON.stringify(b.input)) / 2;
        if (b.content && b.content !== b.text) total += estimateContentTokens(b.content);
      }
      return total;
    }
    return estimateTokens(String(c));
  }

  /** 估算整个请求体的 token（只看真正占 token 的字段） */
  function estimateRequestTokens(body) {
    if (!body || typeof body !== 'object') return 0;
    var total = estimateContentTokens(body.system) + estimateContentTokens(body.systemPrompt);
    var msgs = body.messages;
    if (Array.isArray(msgs)) {
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m) continue;
        total += estimateContentTokens(m.content);
        if (m.system) total += estimateContentTokens(m.system);
      }
    }
    if (Array.isArray(body.tools)) total += estimateTokens(JSON.stringify(body.tools)) / 2;
    return Math.ceil(total) + 8;   // 每条消息的结构开销
  }

  /**
   * 收集请求体里所有可截断的文本片段（带"怎么写回去"的回调）。
   * 支持 Anthropic 的两种 content 形态：纯字符串、以及 block 数组。
   */
  function collectTextParts(body) {
    var parts = [];
    function walkContent(container, key) {
      var c = container && container[key];
      if (typeof c === 'string') {
        if (c) parts.push({
          len: c.length,
          get: function () { return container[key]; },
          set: function (v) { container[key] = v; }
        });
        return;
      }
      if (Array.isArray(c)) {
        for (var i = 0; i < c.length; i++) {
          var b = c[i];
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'text' && typeof b.text === 'string' && b.text) {
            (function (blk) {
              parts.push({
                len: blk.text.length,
                get: function () { return blk.text; },
                set: function (v) { blk.text = v; }
              });
            })(b);
          }
        }
      }
    }
    if (Array.isArray(body.messages)) {
      for (var i = 0; i < body.messages.length; i++) walkContent(body.messages[i], 'content');
    }
    walkContent(body, 'system');
    walkContent(body, 'systemPrompt');
    return parts;
  }

  /**
   * 把请求体压到预算内。
   *
   * 返回 {body, trimmed, removed, strategy}。
   *
   * ★ 分两层，尽量少破坏用户的东西 ★
   *
   *   1) **先删最老的对话历史**：历史被裁掉只是"AI 少记得早先的事"，
   *      远比裁掉用户当次的问题轻。最后一条（本次输入）在这一层绝不动。
   *   2) 历史删完还超，才动用户这次的内容。这时**掐中间、留头尾**：
   *      开头通常是背景和问题，结尾通常是要求与约束，中间往往最可丢。
   *      比"只留前半段、把结尾的要求整段丢掉"安全得多。
   */
  function fitRequestToBudget(body) {
    var budget = effectiveTokenBudget();
    var total = estimateRequestTokens(body);
    if (total <= budget) return { body: body, trimmed: false, removed: 0, strategy: 'none' };

    var strategy = 'none';
    var removedChars = 0;

    /* --- 第 1 层：裁最老的对话历史 --- */
    var msgs = Array.isArray(body.messages) ? body.messages : [];
    var lastIdx = msgs.length - 1;      // 本次输入，这层不许动
    for (var i = 0; i < lastIdx && total > budget; i++) {
      var m = msgs[i];
      if (!m) continue;
      var mt = estimateContentTokens(m.content);
      if (!mt) continue;
      removedChars += String(m.content || '').length;
      m.content = '';
      total -= mt;
      strategy = 'history';
    }
    if (strategy === 'history') {
      body.messages = msgs.filter(function (mm, idx) {
        return idx === lastIdx || estimateContentTokens(mm.content) > 0;
      });
      total = estimateRequestTokens(body);
    }
    if (total <= budget) {
      return { body: body, trimmed: removedChars > 0, removed: removedChars, strategy: strategy };
    }

    /* --- 第 2 层：掐本次内容的中间，留头尾 --- */
    var parts = collectTextParts(body);
    if (!parts.length) {
      return { body: body, trimmed: removedChars > 0, removed: removedChars, strategy: strategy };
    }
    parts.sort(function (a, b) { return b.len - a.len; });

    for (var round = 0; round < 40 && total > budget; round++) {
      var worst = parts[0];
      if (!worst) break;
      var cur = worst.get();
      if (!cur || cur.length < 2) { parts.shift(); continue; }
      var curTokens = estimateTokens(cur);
      var over = total - budget;
      if (curTokens <= over) {
        // 这一整段都不够赔，整段清掉，继续看下一段
        worst.set('');
        removedChars += cur.length;
        total -= curTokens;
        parts.shift();
        strategy = 'content';
        continue;
      }
      // 这一段够赔：按比例留，头 60% / 尾 40%
      var keepRatio = Math.max(0.02, (curTokens - over) / curTokens) * 0.95;
      var keep = Math.max(2, Math.floor(cur.length * keepRatio));
      var headLen = Math.floor(keep * 0.6);
      var tailLen = keep - headLen;
      var headPart = cur.slice(0, headLen);
      var tailPart = tailLen > 0 ? cur.slice(cur.length - tailLen) : '';
      var dropped = cur.length - keep;
      worst.set(headPart +
        '\n\n…（中间 ' + dropped + ' 字符超出单次请求上限，已省略；' +
        '完整原文可在提示里点「导出原文」取回）…\n\n' + tailPart);
      removedChars += dropped;
      total = estimateRequestTokens(body);
      strategy = 'content';
      if (dropped <= 0) parts.shift();
    }
    return { body: body, trimmed: removedChars > 0, removed: removedChars, strategy: strategy };
  }

  /**
   * 把用户这次的完整原文备份下来，别让它真的消失。
   *
   * 备份存 localStorage（原始文本，未截断），并挂到提示条上让用户一键导出。
   * 用 localStorage 而不是直接写文件夹：fetch 里是同步路径，
   * 不能等异步 IO；而且文件夹可能没连上。
   */
  var LS_LAST_TRIMMED = 'chat-demo:ls-last-trimmed';

  function stashOriginal(texts) {
    try {
      var joined = texts.filter(Boolean).join('\n\n===== 分段 =====\n\n');
      if (!joined) return '';
      lsSet(LS_LAST_TRIMMED, joined);
      return joined;
    } catch (e) { return ''; }
  }

  function exportStashed() {
    var text = '';
    try { text = lsGet(LS_LAST_TRIMMED) || ''; } catch (e) { /* ignore */ }
    if (!text) return false;
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '被截断的原文-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1000);
      return true;
    } catch (e) { return false; }
  }

  /** 压完给用户一个提示：说清发生了什么 + 一键取回原文 */
  function noticeTrimmed(removed, tokens, strategy) {
    try {
      var id = 'ls-token-notice';
      var old = document.getElementById(id);
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var el = document.createElement('div');
      el.id = id;
      var why = strategy === 'history'
        ? '较早的对话历史已从本次请求中省略（' + removed + ' 字符）'
        : '内容超限，已省略中间约 ' + removed + ' 个字符（开头结尾都保留）';
      el.style.cssText = [
        'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:28px',
        'z-index:2147483000', 'max-width:min(620px,92vw)',
        'padding:10px 14px', 'border-radius:10px',
        'background:rgba(28,28,32,.97)', 'color:#fff',
        'font-size:13px', 'line-height:1.6', 'box-shadow:0 6px 24px rgba(0,0,0,.34)',
        'display:flex', 'gap:12px', 'align-items:center'
      ].join(';');

      var span = document.createElement('span');
      span.textContent = why + '。本次请求约 ' + tokens + ' tokens，上限 ' +
        (reqTokenLimit || REQ_TOKEN_MAX) + '。原文已备份：';
      el.appendChild(span);

      var btn = document.createElement('button');
      btn.textContent = '导出原文';
      btn.style.cssText = [
        'flex:0 0 auto', 'padding:5px 12px', 'border-radius:7px',
        'border:1px solid rgba(255,255,255,.32)', 'background:transparent',
        'color:#fff', 'font-size:13px', 'cursor:pointer'
      ].join(';');
      btn.onclick = function () { exportStashed(); };
      el.appendChild(btn);

      var close = document.createElement('button');
      close.textContent = '×';
      close.style.cssText = [
        'flex:0 0 auto', 'padding:2px 8px', 'border-radius:7px', 'border:0',
        'background:transparent', 'color:rgba(255,255,255,.7)',
        'font-size:16px', 'cursor:pointer', 'line-height:1'
      ].join(';');
      close.onclick = function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
      el.appendChild(close);

      document.body.appendChild(el);
      // 不给自动消失：用户可能要慢慢导出，留到他手动关
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 60000);
    } catch (e) { /* ignore */ }
  }

  /**
   * 服务端在拒绝时会给出**精确**的 token 数，形如：
   *   user input too long, 34112 tokens exceeds max 32768 tokens
   * 把它记下来，直接当作"真实 token 数"用 —— 比我们的估算准得多，
   * 下次按它算出来的截断比例就一步到位，不用估、不用试。
   */
  var serverTokenFact = { actual: 0, max: 0, ratio: 0, at: 0 };

  async function learnFromTooLong(res) {
    try {
      if (!res || res.status < 400) return;
      var text = await res.clone().text();
      var m = /(\d+)\s*tokens?\s*exceeds\s*max\s*(\d+)\s*tokens?/i.exec(text);
      if (!m) return;
      var actual = Number(m[1]);
      var max = Number(m[2]);
      if (!(actual > 0) || !(max > 0)) return;
      serverTokenFact = {
        actual: actual,
        max: max,
        ratio: actual / max,       // 我们高估/低估了多少倍
        at: Date.now()
      };
      log('服务端回报精确 token：实际 ' + actual + '，上限 ' + max +
        '（估算倍率 ' + (serverTokenFact.ratio).toFixed(3) + '）');
    } catch (e) { /* ignore */ }
  }


  /**
   * 在 fetch 之前拦一道：把超限的请求体压进预算，并把完整原文备份下来。
   *
   * 返回 true 表示改过请求体。应用发消息时 body 是字符串
   * （见 installFetchHook 里对 init.body 的用法），所以能直接解析改写。
   */
  function clampRequestBody(input, init) {
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'POST') return false;
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    if (!urlLooksLikeMessages(rawUrl)) return false;

    var bodyText = init && init.body;
    if (typeof bodyText !== 'string') return false;

    var parsed;
    try { parsed = JSON.parse(bodyText); } catch (e) { return false; }
    if (!parsed || typeof parsed !== 'object') return false;

    var before = estimateRequestTokens(parsed);
    // 先备份完整原文（在改写之前，拿到的就是真原文）
    var originals = collectTextParts(parsed).map(function (p) { return p.get(); });

    var fit;
    try { fit = fitRequestToBudget(parsed); } catch (e) { return false; }
    if (!fit || !fit.trimmed) return false;

    // 备份整段原文（在改写之前拿到的是真原文），供提示里的「导出原文」取回
    stashOriginal(originals);

    init.body = JSON.stringify(fit.body);
    log('请求超限：约 ' + before + ' tokens > 预算 ' + effectiveTokenBudget() +
      '，策略=' + fit.strategy + '，省略 ' + fit.removed + ' 字符');
    noticeTrimmed(fit.removed, before, fit.strategy);
    return true;
  }

  /** 供设置界面读写 */
  function setRequestTokenLimit(n) {
    var v = Number(n);
    reqTokenLimit = (v > 0 && v <= 2000000) ? Math.floor(v) : null;
    try {
      if (reqTokenLimit) lsSet('chat-demo:token-limit', String(reqTokenLimit));
      else lsSet('chat-demo:token-limit', '');
    } catch (e) { /* ignore */ }
    return reqTokenLimit;
  }

  function loadRequestTokenLimit() {
    try {
      var v = Number(lsGet('chat-demo:token-limit'));
      if (v > 0 && v <= 2000000) reqTokenLimit = Math.floor(v);
    } catch (e) { /* ignore */ }
    return reqTokenLimit;
  }

  /** 上传附件的端点：`.../files` */
  function urlLooksLikeFiles(url) {
    try {
      var s = typeof url === 'string' ? url : (url && url.url) || '';
      return /\/files(\?|$)/.test(s);
    } catch (e) {
      return false;
    }
  }

  /**
   * 上传失败时的重试。
   *
   * 观察到过 `net::ERR_HTTP2_PROTOCOL_ERROR`：地址与请求体都没问题
   * （同一个请求用 curl 打过去能正常返回 401，说明端点存在且参数合法），
   * 而是浏览器与服务端之间的 HTTP/2 连接被中途掐断了。这类故障是**瞬时**的，
   * 重试一两次基本就好了 —— 但用户看到的是「上传失败」，于是以为功能坏了。
   *
   * 两类瞬时故障都重试：
   *  · 网络层错误（fetch 统一抛 TypeError）；
   *  · 服务端临时故障（429 / 5xx）—— 网关抖动、后端过载都属于这一类，
   *    和网络被掐断在「重试就好」这一点上没有区别。
   * 明确拒绝（其余 4xx，如 401/400）不重试：那是参数或鉴权问题，
   * 重试没有意义，直接放行让应用显示真实原因。
   */
  var UPLOAD_ATTEMPTS = 3;

  /** 上传尝试记录：出问题时能一眼看出「试了几次、每次什么错」 */
  var uploadLog = [];

  /** 5xx / 429 视为瞬时故障，可以重试 */
  function isTransientStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
  }

  function recordUpload(entry) {
    try {
      uploadLog.push(entry);
      if (uploadLog.length > 30) uploadLog.shift();
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * 上传前先确认「当前生效的提供方」确实有 Key。
   * 没 Key 的话请求必然 401，而应用只会笼统显示「上传失败」。
   */
  function uploadPreflight() {
    var st = getProviders();
    var p = getActiveProvider();
    var key = p ? String(p.apiKey || '').trim() : '';
    var slot = String(lsGet(LS_APP_API_KEY) || '').trim();
    return {
      providerId: p ? p.id : null,
      providerName: p ? p.name : null,
      base: p ? normalizeBase(p.baseURL || '') : null,
      hasProviderKey: !!key,
      hasSlotKey: !!slot,
      keyHint: (key || slot).slice(0, 7) + '…' + String((key || slot).slice(-4)),
      uploadUrl: (p ? normalizeBase(p.baseURL || '') : '') + '/anthropic/v1/files'
    };
  }

  function retryUpload(makeRequest) {
    var attempt = 0;
    var info = uploadPreflight();
    function run() {
      attempt++;
      var startedAt = Date.now();
      return makeRequest().then(
        function (res) {
          if (res && isTransientStatus(res.status)) {
            // 服务端临时故障：当作一次失败继续重试，并把真实状态记下来
            recordUpload({
              at: startedAt,
              attempt: attempt,
              status: 'error',
              http: res.status,
              error: 'HTTP ' + res.status,
              url: info.uploadUrl
            });
            if (attempt >= UPLOAD_ATTEMPTS) return res;
            warn('附件上传失败（第 ' + attempt + ' 次，HTTP ' + res.status + '），正在重试…');
            return new Promise(function (resolve) {
              setTimeout(resolve, 400 * attempt);
            }).then(run).then(function (finalRes) {
              // 重试用尽仍拿到 5xx 时，把最后一次的结果交还给应用
              return finalRes;
            });
          }
          recordUpload({
            at: startedAt,
            attempt: attempt,
            status: 'ok',
            http: res && res.status,
            url: info.uploadUrl
          });
          return res;
        },
        function (err) {
          recordUpload({
            at: startedAt,
            attempt: attempt,
            status: 'error',
            error: String((err && err.message) || err),
            name: err && err.name,
            url: info.uploadUrl
          });
          var transient =
            err &&
            (err.name === 'TypeError' || // fetch 网络层失败统一是 TypeError
              /ERR_HTTP2|ERR_CONNECTION|ERR_NETWORK|Failed to fetch|network/i.test(
                String(err.message || err)
              ));
          if (!transient || attempt >= UPLOAD_ATTEMPTS) throw err;
          warn(
            '附件上传失败（第 ' + attempt + ' 次，' + (err.message || err) + '），正在重试…'
          );
          return new Promise(function (resolve) {
            setTimeout(resolve, 400 * attempt);
          }).then(run);
        }
      );
    }
    recordUpload({ at: Date.now(), attempt: 0, status: 'start', url: info.uploadUrl, preflight: info });
    return run();
  }

  function installFetchHook() {
    if (typeof window.fetch !== 'function' || window.fetch.__localstorePatched) return;
    var original = window.fetch.bind(window);

    var wrapped = function (input, init) {
      var method = String(
        (init && init.method) || (input && input.method) || 'GET'
      ).toUpperCase();
      var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';

      // 附件上传：加一层瞬时故障重试
      if (method === 'POST' && urlLooksLikeFiles(rawUrl)) {
        return retryUpload(function () {
          return original(input, init);
        });
      }

      // 单次请求 token 上限：超了就在本机截断，别让服务端整条打回
      // （服务端错误形如 `user input too long, 34112 tokens exceeds max 32768 tokens`）
      try {
        clampRequestBody(input, init);
      } catch (e) {
        sniffState.errors.push('clamp: ' + ((e && e.message) || e));
      }

      var result = original(input, init);
      try {
        var url = rawUrl;
        if (!urlLooksLikeMessages(url)) return result;

        return result.then(function (res) {
          sniffState.calls++;
          // 服务端若回了 "… tokens exceeds max …"，把精确数字学下来，
          // 下次估算/预算就按真实值走（比我们的估算准）
          learnFromTooLong(res);
          if (!res || !res.body || !looksLikeSse(res)) {
            sniffState.skipped++;
            return res;
          }
          // 克隆流自己解析，绝不干扰应用
          try {
            var clone = res.clone();
            watchStreamForModel(clone);
          } catch (e) {
            sniffState.errors.push('clone: ' + ((e && e.message) || e));
          }
          return res;
        });
      } catch (e) {
        return result;
      }
    };
    wrapped.__localstorePatched = true;
    wrapped.__original = original;
    window.fetch = wrapped;
    log('已挂载 fetch 模型嗅探');
  }

  /** 读取克隆流，抓 message_start 里的真实模型名 */
  function watchStreamForModel(res) {
    (async function () {
      try {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var captured = null;
        var sawData = 0;

        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });

          // 只看前若干 KB 就够了，message_start 一定在最前面
          if (buffer.length > 65536) {
            try {
              reader.cancel();
            } catch (e) {
              /* ignore */
            }
            break;
          }

          var lines = buffer.split(/\r\n|\r|\n/);
          buffer = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('data:') !== 0) continue;
            sawData++;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              var evt = JSON.parse(payload);
              var m = evt && evt.message && evt.message.model;
              if (typeof m === 'string' && m) {
                captured = m;
                break;
              }
            } catch (e) {
              /* 半截 JSON，正常 */
            }
          }
          if (captured) break;
        }

        sniffState.dataLines = sawData;
        sniffState.captured = captured;

        if (captured) {
          pendingModel = captured;
          modelCache.latest = captured;
          log('捕获到服务端模型：' + captured);
          modelListeners.forEach(function (fn) {
            try {
              fn(captured);
            } catch (e) {
              /* ignore */
            }
          });
          try {
            reader.cancel();
          } catch (e) {
            /* ignore */
          }
        } else {
          sniffState.misses++;
        }
      } catch (e) {
        sniffState.errors.push((e && e.message) || String(e));
      }
    })();
  }

  /** 嗅探诊断状态，仅用于排查问题 */
  var sniffState = { calls: 0, skipped: 0, dataLines: 0, captured: null, misses: 0, errors: [] };

  /**
   * 在官方写入 sessions 前，把捕获到的真实模型补进助手消息。
   * 只补「最近一条 assistant 且尚无真实模型」的消息，且用完即清，
   * 避免把模型错安到别的消息上。
   */
  function attachModelToSession(session) {
    if (!pendingModel || !session || !Array.isArray(session.messages)) return session;
    var changed = false;
    for (var i = session.messages.length - 1; i >= 0; i--) {
      var m = session.messages[i];
      if (!m || m.role !== 'assistant') continue;
      if (m.serverModel) break;
      m.serverModel = pendingModel;
      changed = true;
      break;
    }
    if (changed) {
      pendingModel = null;
    }
    return session;
  }

  function currentModel() {
    return pendingModel || modelCache.latest || null;
  }

  var modelCache = { latest: null };

  function onModel(fn) {
    modelListeners.add(fn);
    return function () {
      modelListeners.delete(fn);
    };
  }

  // -------------------------------------------------------------------------
  // 每条回答下方显示真实模型
  // -------------------------------------------------------------------------

  /**
   * 官方渲染的消息容器是 `.message-e1faee`，操作条是 `.actions-e1faee`。
   * 我们按「渲染顺序」把 DOM 节点与库里线性展开的消息一一对应，
   * 找出 assistant 消息所在的容器，在操作条里插入模型徽标。
   *
   * 之所以不用文本匹配：消息内容可能被 Markdown 重排，不可靠；
   * 顺序对齐则是稳定的（列表就是按 linearMessages 顺序渲染的）。
   */
  var MSG_SELECTOR = '.message-e1faee';
  var ACTIONS_SELECTOR = '.actions-e1faee';

  async function injectModelBadges() {
    if (lsGet(LS_SHOW_MODEL) === 'false') return;

    // 取当前会话的线性消息
    var sessions;
    try {
      sessions = await readAllSessions();
    } catch (e) {
      return;
    }
    if (!sessions || !sessions.length) return;

    // 当前会话：优先取 activeId —— 库里没有直接标记，
    // 退化为「最后更新的那个会话」，与界面当前显示一致。
    var active = null;
    try {
      active = JSON.parse(sessionStorage.getItem('chat-demo:active') || 'null');
    } catch (e) {
      /* ignore */
    }
    var session = null;
    if (active) {
      session = sessions.find(function (s) {
        return s && s.id === active;
      });
    }
    if (!session) {
      session = sessions.slice().sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })[0];
    }
    if (!session) return;

    var linear = linearMessages(session);
    var nodes = document.querySelectorAll(MSG_SELECTOR);
    if (!nodes.length) return;

    // 消息数量应与 DOM 节点数量一致（列表按顺序渲染）
    if (nodes.length !== linear.length) return;

    for (var i = 0; i < nodes.length; i++) {
      var msg = linear[i];
      if (!msg || msg.role !== 'assistant') continue;
      var modelName = msg.serverModel || msg.model;
      if (!modelName) continue;

      var node = nodes[i];
      if (node.getAttribute('data-ls-model') === modelName) continue;

      var actions = node.querySelector(ACTIONS_SELECTOR);
      if (!actions) continue;

      var old = actions.querySelector('.ls-model-badge');
      if (old) old.remove();

      var badge = el('span', {
        class: 'ls-model-badge',
        title: '本条回答由 ' + modelName + ' 生成',
        text: modelName
      });
      actions.insertBefore(badge, actions.firstChild);
      node.setAttribute('data-ls-model', modelName);
    }
  }

  var badgeTimer = null;
  function scheduleBadge() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(function () {
      injectModelBadges();
    }, 400);
  }

  /**
   * 收起时的宽度收拢动画。
   *
   * 为什么不直接用「浮层滑出」：侧栏和聊天区是 flex 兄弟，主内容区的宽度
   * 由 flex 算出来，`width` 属性对它**无效** —— 实测给它设内联
   * `width:900px` 都纹丝不动（它带 `flex:1 1 0%`，尺寸由布局决定，
   * 所以 `transition: width` 也就永远不触发）。结果是真侧栏被 React
   * 移除的瞬间主区就弹满全宽（逐帧实测约 7ms），而侧栏还在慢慢滑 ——
   * 这个错配正是用户说的「回弹一下」。
   *
   * 做法：真侧栏藏起来后，在**同一个 flex 位置**放一个同宽的替身，
   * 然后把替身的宽度收到 0。主内容区的宽度由 flex 跟着替身逐帧重算，
   * 于是两边天然同步；替身自身不需要 transition —— 它的宽度是被 rAF
   * 逐帧写的，而「布局因宽度变化而重排」本身是即时的。
   *
   * 用 width 而不是 transform：这里必须真的占位，transform 不改变布局，
   * 起不到给主区让位的作用。
   */
  var SIDER_ANIM_ATTR = 'data-ls-sider-anim';
  /** 与 localstore-motion.css 里 --ls-motion-sider 一致（0.26s）。
   *
   *  这里只用于**兜底清理**：首选路径是 ghost 的 transitionend。
   *  但减弱动效（prefers-reduced-motion）时不会有 transitionend，
   *  只能靠这个定时器，所以它必须 ≥ CSS 的真实时长 ——
   *  取小了会在动画播到一半时把替身删掉，看得见地「啪」一下。
   *
   *  ⚠ 改 CSS 时长时这里要跟着改。收起与展开共用同一个值，
   *  这正是「收起 = 展开倒放」的前提。 */
  var SIDER_COLLAPSE_MS = 260;
  var GHOST_CLASS = 'ls-sider-ghost';
  var GHOST_CLONE_CLASS = 'ls-sider-clone';
  /** 收起时记下的侧栏宽度；展开时侧栏还没挂载，量不到，用它来定过渡终点 */
  var lastSiderWidth = 0;

  /** 真正的侧栏节点；替身克隆体里的同名节点不算 */
  function siderEl() {
    var s = document.querySelector('.sider-ac14ac');
    if (s && s.closest && s.closest('.' + GHOST_CLASS)) return null;
    return s;
  }

  function setSiderAnim(mode) {
    try {
      var root = document.documentElement;
      if (mode) root.setAttribute(SIDER_ANIM_ATTR, mode);
      else root.removeAttribute(SIDER_ANIM_ATTR);
    } catch (e) {
      /* ignore */
    }
  }

  function watchSider() {
    var s0 = siderEl();
    if (s0) {
      var w0 = s0.getBoundingClientRect().width;
      if (w0 > 0) document.documentElement.style.setProperty('--ls-sider-w', Math.round(w0) + 'px');
    }

    var busy = false;

    document.addEventListener(
      'click',
      function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        // ① 收起：换成会收拢的替身
        var collapseBtn = t.closest('.top-ac14ac button[aria-label]');
        if (collapseBtn) {
          var label = collapseBtn.getAttribute('aria-label') || '';
          if (/收起|collapse|hide/i.test(label)) collapseSider(siderEl());
          return;
        }

        // ② 展开：折叠态那组里的「打开边栏」
        var openBtn = t.closest('.collapsed-ac14ac button');
        if (openBtn && !busy) {
          var olabel = openBtn.getAttribute('aria-label') || '';
          if (!/打开|expand|show|open/i.test(olabel)) return;
          busy = true;
          expandSider(function () {
            busy = false;
          });
        }
      },
      true
    );
  }

  /**
   * 展开：让主内容区跟着一起让位，而不是「啪」地缩回去。
   *
   * 收起时是主区变大、展开时是主区变小，两者都要**逐帧**变化才顺。
   * 展开侧原来的问题是：应用重新挂载 sider 是瞬时的，主内容区会在同一帧
   * 从 1378 跳到 1117，而侧栏只是 translate 滑入（宽度恒为 261）——
   * 实测逐帧：e0 时 main 已经是 1117，之后 16 帧不再变化。
   * 这就是用户说的「展开时中间那个东西是突变的」。
   *
   * 做法与收起对称：**让 sider 自己从 0 宽过渡到 261**，主内容区自然逐帧让位。
   * 为什么不像收起那样另插一个替身：替身撑开与真实 sider 挂载是两个独立时序，
   * 中间会空出一段「占位已满、侧栏还没露面」的空白（实测 520ms 内左边全是
   * 纯背景色）。直接过渡 sider 自身的宽度，两边天然同步，也没有空窗。
   *
   * sider 内部的内容按 261 宽排版，收窄时只是被 overflow:hidden 裁掉，
   * 所以过程中不会看到内容被压扁。
   */
  function expandSider(done) {
    var frame = document.querySelector('.frame-_9fdf5');
    if (!frame) {
      done();
      return;
    }
    var w = lastSiderWidth || 261;

    var finished = false;
    var cleanup = function () {
      if (finished) return;
      finished = true;
      var s = siderEl();
      if (s) {
        s.style.removeProperty('width');
        s.style.removeProperty('min-width');
        s.style.removeProperty('transition');
      }
      setSiderAnim(null);
      done();
    };

    // 等应用把 sider 挂回来（异步的），再接管它的宽度
    var started = false;
    var start = function (s) {
      if (started || !s) return;
      started = true;
      s.style.transition = 'none';
      s.style.width = '0px';
      s.style.minWidth = '0px';
      // 读一次强制结算，确保 0 宽已经生效，否则下面的过渡会被跳过
      void s.offsetWidth;
      s.style.removeProperty('transition');
      s.style.width = w + 'px';
      s.style.minWidth = w + 'px';

      var onEnd = function (ev) {
        if (ev.target !== s || ev.propertyName !== 'width') return;
        s.removeEventListener('transitionend', onEnd);
        // ★ 一定要在这里也摘掉入场动画属性：否则它会一直留在 <html> 上，
        //   下次收起时新节点又被套上滑入动画（表现为「收起时文字从左边滑过来」）。
        setSiderAnim(null);
        cleanup();
      };
      s.addEventListener('transitionend', onEnd);
      // 兜底：减弱动效 / 过渡被跳过时不会触发 transitionend
      setTimeout(cleanup, SIDER_COLLAPSE_MS + 260);
    };

    var existing = siderEl();
    if (existing) {
      start(existing);
      return;
    }
    var obs = new MutationObserver(function () {
      var s = siderEl();
      if (!s) return;
      obs.disconnect();
      setSiderAnim('enter');
      start(s);
    });
    obs.observe(frame, { childList: true, subtree: true });
    // 兜底：结构若变了，别把 busy 卡死
    setTimeout(function () {
      obs.disconnect();
      if (!started) cleanup();
    }, 1200);
  }

  /**
   * 把真侧栏换成「会收拢的替身」，让主内容区跟着一起平滑铺开。
   *
   * 时序很关键：必须在点击的**捕获阶段**（早于 React 处理）完成换人，
   * 否则 React 会先把真侧栏删掉，布局先弹一次，再补动画就晚了。
   *
   * 为什么必须由「宽度」驱动（而不是让侧栏浮起来滑走）：
   *   .sider 是 `flex: 0 0 auto`，宽度就是它的布局尺寸，改宽度 = 真的让位；
   *   而 .main 是 `flex: 1 1 0%`，宽度由 flex 算出来，连内联 width 都改不动它，
   *   所以给 main 加 `transition: width` 永远不会触发。
   *   结论：让**侧栏**这一侧做宽度过渡，main 会自动跟着逐帧重排。
   *   （这一点参考了 collection/layout.css 里 `.sidebar.collapsed` 的做法。）
   *
   * 动画交给 CSS 过渡（见 localstore-motion.css 的 .ls-sider-ghost）：宽度变化
   * 引起的重排本身是即时的，逐帧插值由浏览器完成，比手写 rAF 更顺、也不掉帧。
   *
   * 细节：
   *  · 克隆体自带 visibility:hidden（我们刚加到真身上），要显式恢复，
   *    否则替身整个是隐形的；
   *  · 内层锁定原宽 + overflow:hidden，收拢时内容被裁掉而不是被压扁；
   *  · 替身 pointer-events:none，点不到也不影响任何交互；
   *  · 用 transitionend 清理，并留一个 setTimeout 兜底（减弱动效时不会触发
   *    transitionend，只靠事件会留下一个永久占位的节点）。
   */
  function collapseSider(sider) {
    if (!sider) return;

    /**
     * ★ 先掐掉「入场动画」的开关，再做交接。
     *
     * 两个理由：
     *  1. `html[data-ls-sider-anim='enter'] .sider-ac14ac { animation: ls-sider-in … }`
     *     是给**展开**用的滑入动画。这个属性只在 expandSider 的 cleanup 里被摘掉，
     *     而 expandSider 在「sider 已挂载」时是 `start(existing); return;`，
     *     **走不到 cleanup**。连点几下之后它会一直留在 <html> 上，
     *     收起时新节点又被套上滑入动画 —— 用户看到「收起时文字从左边滑过来」。
     *  2. 下面要克隆真身。若真身此刻还在播入场动画（带 transform），
     *     克隆出来的是「动画中间态」，跟稳定态对不上，交接就会闪。
     *     先掐掉动画，真身立刻回到**自然几何**，克隆体也就与之一致。
     */
    setSiderAnim(null);

    var frame = sider.parentElement;
    if (!frame) return;
    var r = sider.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;

    // 先藏真身：避免它和替身同时可见（重叠会闪）
    sider.style.visibility = 'hidden';

    var w = Math.round(r.width);
    lastSiderWidth = w;

    /**
     * 替身 = 真侧栏的克隆 + 一层 wrapper，照搬 collection/layout.css 的折叠做法。
     *
     * 收起必须是**展开的逆过程**：展开时真侧栏从左侧滑入
     * （`ls-sider-in`，`translate3d(-100%,0,0)` → 0），所以收起时内容要
     * 跟着一起退场。若只收一块纯色底色、内容瞬间消失，就是「啪一下没了」。
     *
     * ★ 交接必须**像素级无缝**，否则就是一闪。做法是让克隆体对齐真身的
     *   **自然几何**（动画已在上面的 setSiderAnim(null) 里掐掉）：
     *   宽度用内联钉死在 w 上（克隆体就不参与收窄、内容不重排），
     *   内边距照抄真身，margin-left 归零 —— 于是克隆体的 rect 与真身
     *   逐像素重合（实测面板/标题的 left/width/opacity 差值全为 0.0）。
     *
     *   ⚠ 不要在真身还带着 transform 时克隆：那克隆到的是「动画中间态」，
     *     与稳定态对不上，交接就会闪。也不要给 `.ls-sider-ghost *` 加
     *     `animation: none !important`：那会把侧栏内部真正的渐入动画一起打掉。
     */
    var cs = getComputedStyle(sider);
    var padL = cs.paddingLeft;
    var padR = cs.paddingRight;

    var ghost = document.createElement('div');
    ghost.className = GHOST_CLASS;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.boxSizing = 'border-box';
    // 替身自己**不带内边距**：内边距留在克隆体上（克隆体原样保留真侧栏的
    // padding，所以内容位置与真身逐像素一致）。
    // 若把 padding 写在替身上，它一收窄，内容盒就同时被自己的 padding
    // 往里挤 —— 逐帧实测 padding 12 → 9.2 → 2.7 → 0，可见文字量比面板
    // 收得更快，观感就是「内容在往右滑」。collection 的 `.sidebar.collapsed`
    // 之所以要 `padding:0`，正是同一个道理；这里干脆放到克隆体上，
    // 让它根本不影响宽度。
    ghost.style.padding = '0px';
    ghost.style.width = w + 'px';
    ghost.style.minWidth = w + 'px';
    ghost.style.height = Math.round(r.height) + 'px';
    ghost.style.backgroundColor = cs.backgroundColor;
    ghost.style.borderRight =
      cs.borderRightWidth + ' ' + cs.borderRightStyle + ' ' + cs.borderRightColor;
    ghost.innerHTML = sider.outerHTML;

    // 克隆体：宽度用**内联**钉在 w 上（不参与收窄，内容就不会重排），
    // 内边距照抄真身，margin-left 归零 —— 与真身的自然几何逐像素重合。
    var clone = ghost.firstElementChild;
    if (clone) {
      clone.classList.add(GHOST_CLONE_CLASS);
      clone.style.visibility = '';
      clone.style.boxSizing = 'border-box';
      clone.style.width = w + 'px';
      clone.style.minWidth = w + 'px';
      clone.style.height = Math.round(r.height) + 'px';
      clone.style.paddingLeft = padL;
      clone.style.paddingRight = padR;
      clone.style.marginLeft = '0px';
    }
    frame.insertBefore(ghost, sider);

    var removed = false;
    var remove = function () {
      if (removed) return;
      removed = true;
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    };
    ghost.addEventListener('transitionend', function (ev) {
      if (ev.target === ghost && ev.propertyName === 'width') remove();
    });

    // 下一帧再改目标值：同一帧里「插入 + 改样式」会被合并成一次样式计算，
    // 过渡的起始值从未被渲染，动画会被跳过（表现是瞬间收没）。
    //
    // 这里只收 wrapper 的**布局宽度**（让主内容区跟着逐帧变大）。
    // 内容怎么退场由 CSS 负责：克隆体上播 `ls-sider-out`，
    // 也就是入场动画 `ls-sider-in` 完全反着放一遍（左移 + 淡出）。
    requestAnimationFrame(function () {
      ghost.style.width = '0px';
      ghost.style.minWidth = '0px';
      ghost.style.borderRightColor = 'transparent';
      ghost.style.borderRightWidth = '0px';
    });
    // 兜底：减弱动效时不会有 transitionend
    setTimeout(remove, SIDER_COLLAPSE_MS + 260);
  }

  function watchMessages() {
    if (!document.body) return;
    var observer = new MutationObserver(function (records) {
      scheduleBadge();
      scheduleComposer();
      // React 会把 i18n 原文写回侧栏标题，跟着这个观察器一起纠回来
      scheduleAppName();
      // 界面里真的多出/少了消息时，立刻落盘，不必等官方写 IndexedDB
      if (recordsLookLikeChat(records)) scheduleAutoSync('messages');
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleComposer();
    scheduleAppName();
  }

  /**
   * 判断这批 DOM 变动是否代表「聊天内容变了」。
   *
   * 要点：必须排除我们自己插入的节点（模型徽标、模型切换器、设置区块），
   * 否则徽标注入会触发自动同步，自动同步又触发注入，形成死循环。
   */
  function recordsLookLikeChat(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.target && r.target.closest && r.target.closest('.ls-section,.ls-composer,#' + MENU_ID)) {
        continue;
      }
      var nodes = [].concat(
        Array.prototype.slice.call(r.addedNodes || []),
        Array.prototype.slice.call(r.removedNodes || [])
      );
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (n.nodeType !== 1) continue;
        if (n.classList && (n.classList.contains('ls-model-badge') || n.classList.contains('ls-composer') || n.classList.contains('ls-composer-menu') || n.classList.contains('ls-section'))) {
          continue;
        }
        if (n.matches && (n.matches(MSG_SELECTOR) || n.querySelector(MSG_SELECTOR))) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // 输入框旁的模型切换器
  // -------------------------------------------------------------------------

  /**
   * 输入区结构（已实测）：
   *   .functionRow-ed6f47
   *     .toggles-ed6f47         ← 深度思考 / 智能搜索
   *     ...                     ← 语音、上传、发送
   *
   * 模型选择器和它们同属「发送前的一次性设置」，所以放在 functionRow 里，
   * 紧贴 toggles 之后。这里不硬编码到某个绝对位置，而是插在 toggles 后面，
   * 找不到 toggles 再退回 appendChild，避免官方小改布局就整个失效。
   */
  var FUNCTION_ROW_SELECTOR = '.functionRow-ed6f47';
  var TOGGLES_SELECTOR = '.toggles-ed6f47';
  /** 功能行里右侧那一组按钮（语音/上传/发送），用来限制模型选择栏不要越界 */
  var RIGHT_GROUP_SELECTOR = '.right-ed6f47';
  var COMPOSER_ID = 'ls-composer-model';
  var MENU_ID = 'ls-composer-menu';

  var composerState = { open: false, loading: false, models: null, error: null, raf: 0, hiddenRetry: 0 };
  var composerTimer = null;

  function scheduleComposer() {
    clearTimeout(composerTimer);
    composerTimer = setTimeout(function () {
      mountComposer();
    }, 300);
  }

  function mountComposer() {
    var rows = document.querySelectorAll(FUNCTION_ROW_SELECTOR);
    if (!rows.length) return;
    // 只在主输入框那一行挂载（页面上可能同时存在多个）
    var row = rows[0];

    var existing = document.getElementById(COMPOSER_ID);
    var active = getActiveProvider();
    var providerName = active ? active.name : '';
    var model = effectiveModel();
    var label = model + (providerName ? ' · ' + providerName : '');

    if (existing) {
      // 文案没变就**绝不**重建。
      //
      // 这里曾经写成 `label 没变 && !composerState.open` 才跳过 —— 意思是
      // 「菜单开着时也重建」，本意是刷新菜单内容。但那个条件配合应用每 ~250ms
      // 一次的 DOM 变动，就成了死循环：每次 scheduleComposer 都重建按钮与菜单，
      // 表现是模型上拉栏**一直闪**（实测 2.5 秒内重建 8 次）。
      //
      // 现在按钮和菜单都挂在 body 上（见下方说明），重建对它们没有任何好处；
      // 菜单内容由 renderComposerMenu 自己负责刷新，与挂载解耦。
      if (existing.getAttribute('data-ls-label') === label) return;
      existing.remove();
      var staleMenu = document.getElementById(MENU_ID);
      if (staleMenu) staleMenu.remove();
    }

    var wrap = el('div', { class: 'ls-composer', id: COMPOSER_ID });
    wrap.setAttribute('data-ls-label', label);

    var btn = el(
      'button',
      {
        type: 'button',
        class: 'ls-composer-btn',
        title: t('composerHint'),
        onclick: function (e) {
          e.stopPropagation();
          if (composerState.open) {
            // 关闭也走统一入口，保证退场动画一定会播
            closeComposerMenu();
          } else {
            composerState.open = true;
            renderComposerMenu();
          }
        }
      },
      [
        el('span', { class: 'ls-composer-model', text: model }),
        providerName ? el('span', { class: 'ls-composer-provider', text: providerName }) : null,
        el('span', { class: 'ls-composer-caret', text: '▾' })
      ]
    );
    wrap.appendChild(btn);

    // ⚠️ 关键：**不能**插进 functionRow 里。
    //
    // 实测过：插进去之后，React 每次重新渲染 functionRow 都会把这个
    // 「不认识」的节点当作多余子节点删掉，而桥接层的 MutationObserver 又把它
    // 加回来 —— 一删一加就是每 250ms 一轮循环，表现就是模型选择栏
    // **一直闪**（实测 3 秒内被重建 10 次）。
    //
    // 所以这里和菜单一样挂到 body 上、用 position:fixed 定位，
    // 只借用 functionRow 的坐标来摆放，不进入它的子树。
    document.body.appendChild(wrap);
    if (!composerState.raf) startComposerLoop();

    // 菜单挂在 body 上（见 renderComposerMenu 的说明），这里只需保证开关状态正确
    if (composerState.open) renderComposerMenu();
  }

  /**
   * 定位模型选择栏。
   *
   * 落点：紧贴开关组右侧，但不越过功能行里右侧那一组（语音/上传/发送）。
   * 早先只按 `.toggles` 的右边缘算，忽略了 `.right-ed6f47` 也会占位，
   * 结果按钮被推到行的外面（实测超出右边界约 94px）。
   * 所以这里同时取「右侧组的左边缘」作为上限。
   */
  function placeComposer() {
    var wrap = document.getElementById(COMPOSER_ID);
    if (!wrap) return;
    var row = document.querySelector(FUNCTION_ROW_SELECTOR);
    if (!row) {
      wrap.style.display = 'none';
      return;
    }

    var rr = row.getBoundingClientRect();
    var toggles = row.querySelector(TOGGLES_SELECTOR);
    var right = row.querySelector(RIGHT_GROUP_SELECTOR);
    var tr = toggles ? toggles.getBoundingClientRect() : null;
    var rgr = right ? right.getBoundingClientRect() : null;

    var w = wrap.offsetWidth;
    var h = wrap.offsetHeight;
    if (!w) {
      // 还没量到尺寸（首次布局未完成），下一帧再说
      return;
    }

    var left = (tr && tr.width ? tr.right : rr.left + rr.width / 2) + 10;
    // 不许压到右侧按钮组上
    var limit = rgr && rgr.width ? rgr.left - 8 : rr.right - 8;
    if (left + w > limit) left = limit - w;
    // 实在放不下就藏起来，而不是硬挤成一团。
    //
    // ⚠ 但必须配一个「过一会儿再试一次」。原因：切换对话、换模型、附件展开时，
    // 输入行会经历几帧中间态（宽度为 0、右侧组还没排好、整行被 React 换掉重挂），
    // 恰好落在中间态就会算出「放不下」→ display:none。之后几何虽然恢复了，
    // 但 rAF 循环每次都在这一分支提前 return，按钮就一直不显示 ——
    // 用户看到的就是「切换对话后模型选择框没有了」。
    // 加短延时重试：状态稳定后自然摆回去。
    if (left < rr.left) {
      wrap.style.display = 'none';
      if (!composerState.hiddenRetry) {
        composerState.hiddenRetry = setTimeout(function () {
          composerState.hiddenRetry = 0;
          if (document.getElementById(COMPOSER_ID)) placeComposer();
        }, 120);
      }
      return;
    }
    if (composerState.hiddenRetry) {
      clearTimeout(composerState.hiddenRetry);
      composerState.hiddenRetry = 0;
    }

    var top = rr.top + (rr.height - h) / 2;
    wrap.style.left = Math.round(left) + 'px';
    wrap.style.top = Math.round(top) + 'px';
    // 整行滚出视口就藏起来，避免浮在别的内容上
    wrap.style.display = rr.bottom < 0 || rr.top > window.innerHeight ? 'none' : '';
  }

  /**
   * 跟随定位循环。
   *
   * 为什么用 rAF 轮询而不是监听 scroll/resize：输入区会因为「思考/搜索」开关、
   * 附件列表、流式输出等不断改变高度，这些都不会触发 scroll 事件；
   * 而位置算错的表现是按钮浮在错误的地方，比多跑一点 rAF 更糟。
   * 每帧只做 getBoundingClientRect + 两次 style 赋值，开销可以忽略。
   *
   * ⚠ 除了「跟随」，这里还兼任「看门狗」。
   * placeComposer 在几何中间态下会把按钮 display:none，而中间态一旦被
   * 卡住（切换对话、换模型、React 重挂 functionRow 都可能），
   * 按钮就永久消失 —— 用户看到的是「模型选择框不见了」。
   * 所以：如果按钮明明在 DOM 里、输入行也在，但显示是 none，
   * 就强行摘掉这个 none 并重排一次。这条兜底比任何精确的时序假设都可靠。
   */
  function startComposerLoop() {
    if (composerState.raf) return;
    var hiddenFrames = 0;
    var tick = function () {
      composerState.raf = requestAnimationFrame(tick);
      var wrap = document.getElementById(COMPOSER_ID);
      if (!wrap) {
        // 已卸载，停掉循环
        cancelAnimationFrame(composerState.raf);
        composerState.raf = 0;
        return;
      }
      placeComposer();
      repositionComposerMenu();

      // 看门狗：连续几帧都是 none 就自救
      if (wrap.style.display === 'none') {
        hiddenFrames++;
        if (hiddenFrames > 3) {
          hiddenFrames = 0;
          wrap.style.display = '';
          placeComposer();
        }
      } else {
        hiddenFrames = 0;
      }
    };
    composerState.raf = requestAnimationFrame(tick);
  }

  /**
   * 打开菜单。
   *
   * 入场动画用类（.ls-menu-open）而不是写在基础样式里，是为了能**重播**：
   * 菜单每次打开都是新建的节点，加上类时若与插入同帧，浏览器可能合并成
   * 一次样式计算而跳过动画，所以用「先插入、隔两帧再加类」。
   *
   * 方向由 positionComposerMenu 写入属性后决定：
   * 菜单默认向上展开（按钮在底部输入区），只有按钮贴近屏幕顶部、
   * 菜单改成向下弹时才换个方向，保证永远「从按钮那一侧长出来」。
   */
  var MENU_OPEN_CLASS = 'ls-menu-open';
  var MENU_CLOSING_CLASS = 'ls-menu-closing';
  var MENU_BELOW_CLASS = 'ls-menu-below';
  var MENU_CLOSE_MS = 140;

  function renderComposerMenu() {
    var wrap = document.getElementById(COMPOSER_ID);
    if (!wrap) return;

    // 菜单挂在 body 上、用 position:fixed 定位。
    // 原因：输入区外层容器有 overflow:hidden，若把菜单放在输入区内，
    // 向上弹出的面板会被输入框裁掉（实测就是这个现象）。
    // 只有挂到 body 并脱离祖先的裁剪上下文才能完整显示。
    var old = document.getElementById(MENU_ID);
    if (old) old.remove();

    if (!composerState.open) return;

    var menu = el('div', { class: 'ls-composer-menu', id: MENU_ID });
    var st = getProviders();

    st.list.forEach(function (p) {
      var isActive = p.id === st.activeId;
      var head = el('div', { class: 'ls-menu-head' }, [
        el('span', {
          class: 'ls-menu-provider',
          text: p.builtin || p.id === OFFICIAL_PROVIDER.id ? t('provOfficialName') : p.name || p.id
        }),
        isActive ? el('span', { class: 'ls-menu-tag', text: t('provActive') }) : null
      ]);
      if (!isActive) {
        head.style.cursor = 'pointer';
        head.title = t('provSwitchHint');
        head.addEventListener('click', function (e) {
          e.stopPropagation();
          switchProvider(p.id);
        });
      }

      var group = el('div', { class: 'ls-menu-group' }, [head]);

      var models = p.models && p.models.length ? p.models.slice() : [];
      if (!models.length && p.defaultModel) models = [p.defaultModel];

      if (!models.length) {
        group.appendChild(
          el('div', {
            class: 'ls-menu-empty',
            text: p.id === st.activeId ? t('provNoModelsHint') : t('provNoModels')
          })
        );
      } else {
        models.forEach(function (m) {
          var selected = isActive && m === effectiveModel();
          var item = el('button', {
            type: 'button',
            class: 'ls-menu-item' + (selected ? ' ls-menu-item-on' : ''),
            text: m,
            onclick: function (e) {
              e.stopPropagation();
              chooseModel(p.id, m);
            }
          });
          group.appendChild(item);
        });
      }

      menu.appendChild(group);
    });

    var foot = el('div', { class: 'ls-menu-foot' }, [
      el('span', {
        class: 'ls-menu-link',
        text: t('composerManage'),
        onclick: function (e) {
          e.stopPropagation();
          closeComposerMenu();
          openSettingsPanel();
        }
      })
    ]);
    menu.appendChild(foot);

    document.body.appendChild(menu);
    positionComposerMenu();
    playMenuOpen(menu);
  }

  /**
   * 收起菜单，并播放与展开相反的退场动画。
   *
   * 所有「关闭菜单」的入口都应该走这里，否则退场动画会时有时无。
   * 做法：先把状态置为关闭，再给现有节点挂上 ls-menu-closing 让它往下收，
   * 动画跑完（或兜底超时）才真正移除节点。
   */
  var menuCloseTimer = null;

  function closeComposerMenu() {
    composerState.open = false;
    var menu = document.getElementById(MENU_ID);
    if (!menu) return;

    // 关掉正在跑的定位循环对该节点的后续操作
    clearTimeout(menuCloseTimer);
    menu.classList.remove(MENU_OPEN_CLASS);
    menu.classList.add(MENU_CLOSING_CLASS);

    var remove = function () {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    };
    menu.addEventListener('animationend', function handler(ev) {
      if (ev.target !== menu) return;
      menu.removeEventListener('animationend', handler);
      remove();
    });
    // 兜底：如果动效被系统「减弱动态效果」关掉，animationend 不会触发，
    // 只靠事件会留下一个永远挂在页面上的菜单。
    menuCloseTimer = setTimeout(remove, MENU_CLOSE_MS + 120);
  }

  /**
   * 重新定位菜单，并在按钮滚出视口时自动关闭。
   *
   * 早先的写法是一滚动就关掉菜单，体感很差（手一滑菜单就没了）。
   * 现在改为跟随按钮移动；只有当按钮本身已经看不见时才关闭。
   */
  var menuRaf = 0;
  function repositionComposerMenu() {
    if (!composerState.open) return;
    if (menuRaf) return;
    menuRaf = requestAnimationFrame(function () {
      menuRaf = 0;
      var wrap = document.getElementById(COMPOSER_ID);
      var menu = document.getElementById(MENU_ID);
      if (!wrap || !menu) return;

      var btn = wrap.querySelector('.ls-composer-btn') || wrap;
      var r = btn.getBoundingClientRect();
      // 按钮滚出视口（或已被卸载）就没必要继续显示
      if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) {
        closeComposerMenu();
        return;
      }
      placeComposerMenu(r, menu);
    });
  }

  /** 把菜单摆在按钮上方，越界时自动改为向下或贴边 */
  function placeComposerMenu(r, menu) {
    var mw = menu.offsetWidth || 280;
    var mh = menu.offsetHeight || 240;

    var left = r.left;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;

    var top = r.top - mh - 8; // 优先向上弹（输入框通常在底部）
    var below = false;
    if (top < 8) {
      var belowTop = r.bottom + 8;
      if (belowTop + mh <= window.innerHeight - 8) {
        top = belowTop;
        below = true;
      } else {
        top = Math.max(8, window.innerHeight - mh - 8);
      }
    }

    menu.style.position = 'fixed';
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.bottom = 'auto';
    // 记下弹出方向，样式表据此选「向上长出来」还是「向下长出来」的动画。
    // 类在 openComposerMenu / 这里首次定位后才会加上，所以此时改类名
    // 不会打断已经开始的入场动画（方向类与入场类是分开的两个类）。
    if (below) menu.classList.add(MENU_BELOW_CLASS);
    else menu.classList.remove(MENU_BELOW_CLASS);
  }

  /**
   * 播放入场动画：插入后隔两帧再加类。
   *
   * 为什么不能插入时直接带上类：同一帧里「创建节点 + 加类 + 插入」会被
   * 浏览器合并成一次样式计算，动画的 from 状态从未被渲染过，于是被跳过
   * （表现是菜单「啪」地直接出现，没有过渡）。
   */
  function playMenuOpen(menu) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (menu && menu.parentNode && menu.id === MENU_ID) {
          menu.classList.add(MENU_OPEN_CLASS);
        }
      });
    });
  }

  function positionComposerMenu() {
    var wrap = document.getElementById(COMPOSER_ID);
    var menu = document.getElementById(MENU_ID);
    if (!wrap || !menu) return;
    var btn = wrap.querySelector('.ls-composer-btn') || wrap;
    placeComposerMenu(btn.getBoundingClientRect(), menu);
  }

  /** 切换默认提供方（会重载页面以换 Key） */
  function switchProvider(providerId) {
    withBusy(async function () {
      var st = getProviders();
      if (st.activeId === providerId) return;
      st.activeId = providerId;
      saveProviders();
      applyActiveProvider(false);
      closeComposerMenu();
      mountComposer();
      var p = findProvider(providerId);
      setMessage(t('provSwitched', { name: (p && p.name) || providerId }), false);
      // 无需刷新页面：bundle 补丁让 API Key 与模型都是「每次请求时现读」
      // （见 tools/apply-patch.mjs 里的 k0 / ec0），所以切换提供方即时生效。
      // 早先这里必须 location.reload()，代价是丢掉当前对话并闪一下。
      refreshSettingsSection();
    });
  }

  function chooseModel(providerId, model) {
    withBusy(async function () {
      var st = getProviders();
      var p = findProvider(providerId);
      if (!p) return;

      st.activeId = providerId;
      p.defaultModel = model;
      saveProviders();

      lsSet(LS_MODEL, model);
      applyActiveProvider(false);

      closeComposerMenu();
      mountComposer();
      setMessage(t('modelSwitched', { model: model }), false);
      // 同上：换模型、换提供方都不再刷新页面。
    });
  }

  /** 打开设置弹窗（用于「管理模型」入口） */
  /**
   * 打开设置弹窗，并确保停在「通用设置」标签页。
   *
   * 官方弹窗的默认标签页并不固定（首次启动、未填 Key 时会停在「数据管理」），
   * 而本地存储相关区块挂在「通用设置」下，所以打开后要主动切一下标签页，
   * 否则用户点了「管理提供方」会看不到任何东西。
   */
  function openSettingsPanel() {
    var candidates = Array.from(document.querySelectorAll('button')).filter(function (b) {
      var l = (b.getAttribute('aria-label') || b.textContent || '').trim();
      return l === '设置' || l === 'Settings' || l === '通用设置';
    });
    if (!candidates.length) return false;
    candidates[0].click();

    // 等弹窗渲染出来再切标签页
    var tries = 0;
    var ensureGeneral = function () {
      tries++;
      var dlg = document.querySelector('.dialog-_85c1b');
      if (!dlg) {
        if (tries < 20) setTimeout(ensureGeneral, 60);
        return;
      }
      if (detectActiveTab() === TAB_GENERAL) {
        mountSection();
        scrollSectionIntoView();
        return;
      }
      var items = dlg.querySelectorAll('.navItem-_85c1b');
      for (var i = 0; i < items.length; i++) {
        if (/通用|General/i.test((items[i].textContent || '').trim())) {
          items[i].click();
          setTimeout(function () {
            mountSection();
            scrollSectionIntoView();
          }, 120);
          return;
        }
      }
    };
    setTimeout(ensureGeneral, 60);
    return true;
  }

  /** 把本地存储区块滚进视野，避免用户以为没打开 */
  function scrollSectionIntoView() {
    var sec = document.getElementById(UI_ID);
    if (!sec || !sec.scrollIntoView) return;
    try {
      sec.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      /* 老浏览器忽略 */
    }
  }

  /**
   * 菜单挂在 body 上、按视口定位，所以监听滚动/缩放时重算位置，
   * 而不是简单关闭（早先一滚动就关掉，体感很差）。
   *
   * 两种情况要区分：
   *   · 滚动发生在菜单【内部】—— 那是用户在翻模型列表，
   *     此时不能重定位（会把内部滚动位置顶回顶部），直接忽略；
   *   · 滚动发生在页面/聊天区 —— 菜单要跟着按钮走。
   * 滚动事件必须用捕获阶段监听：真正滚动的是内层容器，不会冒泡到 window。
   */
  function onAnyScroll(e) {
    if (!composerState.open) return;
    var menu = document.getElementById(MENU_ID);
    // 菜单自身滚动：放行，别去动它
    if (menu && e && e.target && (e.target === menu || menu.contains(e.target))) return;
    repositionComposerMenu();
  }

  function installComposerOutsideClick() {
    document.addEventListener(
      'click',
      function (e) {
        if (!composerState.open) return;
        var menu = document.getElementById(MENU_ID);
        var wrap = document.getElementById(COMPOSER_ID);
        var inMenu = menu && menu.contains(e.target);
        var inWrap = wrap && wrap.contains(e.target);
        if (!inMenu && !inWrap) {
          closeComposerMenu();
        }
      },
      true
    );

    window.addEventListener('scroll', onAnyScroll, true);
    window.addEventListener('resize', repositionComposerMenu);
  }

  // -------------------------------------------------------------------------
  // 设置面板 UI
  // -------------------------------------------------------------------------

  function renderProviderCard(p, isActive) {
    var card = el('div', { class: 'ls-prov' + (isActive ? ' ls-prov-active' : '') });

    // 标题行：名称 + 默认标记
    var head = el('div', { class: 'ls-prov-head' }, [
      el('span', { class: 'ls-prov-name', text: p.name || p.id }),
      isActive ? el('span', { class: 'ls-prov-badge', text: t('provActive') }) : null
    ]);
    card.appendChild(head);

    // 名称
    var nameInput = el('input', {
      type: 'text',
      class: 'ls-input',
      placeholder: t('provName'),
      value: p.name || '',
      spellcheck: 'false'
    });
    card.appendChild(el('div', { class: 'ls-field' }, [
      el('label', { class: 'ls-label', text: t('provName') }),
      nameInput
    ]));

    // API 地址
    var baseInput = el('input', {
      type: 'text',
      class: 'ls-input',
      placeholder: 'https://api.deepseek.com',
      value: p.baseURL || '',
      spellcheck: 'false'
    });
    card.appendChild(el('div', { class: 'ls-field' }, [
      el('label', { class: 'ls-label', text: t('provBase') }),
      baseInput
    ]));

    // API Key
    var keyInput = el('input', {
      type: 'password',
      class: 'ls-input',
      placeholder: t('provKeyPlaceholder'),
      value: p.apiKey || '',
      spellcheck: 'false'
    });
    card.appendChild(el('div', { class: 'ls-field' }, [
      el('label', { class: 'ls-label', text: t('provKey') }),
      keyInput
    ]));
    card.appendChild(
      el('div', {
        class: 'ls-meta',
        text: p.apiKey ? t('provKeySaved') : t('provKeyNone')
      })
    );

    // 模型列表：多选（勾选要保留的模型）
    card.appendChild(el('div', { class: 'ls-label', text: t('provModels') }));

    // 已勾选的模型集合（由复选框驱动）
    var checked = {};
    (p.models || []).forEach(function (m) {
      checked[m] = true;
    });

    var modelBox = el('div', { class: 'ls-models' });
    var allModels = (p.availableModels && p.availableModels.length
      ? p.availableModels.slice()
      : (p.models || []).slice()
    ).filter(function (m, i, a) {
      return a.indexOf(m) === i;
    });

    if (!allModels.length) {
      modelBox.appendChild(el('div', { class: 'ls-meta', text: t('provNoModels') }));
    } else {
      allModels.forEach(function (m) {
        var cb = el('input', { type: 'checkbox', class: 'ls-check' });
        cb.checked = !!checked[m];
        cb.addEventListener('change', function () {
          checked[m] = cb.checked;
          syncDefaultOptions();
        });

        var label = el('label', { class: 'ls-check-item' }, [cb, el('span', { text: m })]);
        modelBox.appendChild(label);
      });

      // 全选 / 全不选，方便一次性保留几十个模型
      var bulk = el('div', { class: 'ls-models-bulk' }, [
        el('span', {
          class: 'ls-menu-link',
          text: t('provSelectAll'),
          onclick: function () {
            modelBox.querySelectorAll('input[type=checkbox]').forEach(function (x) {
              x.checked = true;
            });
            allModels.forEach(function (m) {
              checked[m] = true;
            });
            syncDefaultOptions();
          }
        }),
        el('span', {
          class: 'ls-menu-link',
          text: t('provSelectNone'),
          onclick: function () {
            modelBox.querySelectorAll('input[type=checkbox]').forEach(function (x) {
              x.checked = false;
            });
            allModels.forEach(function (m) {
              checked[m] = false;
            });
            syncDefaultOptions();
          }
        })
      ]);
      card.appendChild(modelBox);
      card.appendChild(bulk);
    }
    if (!allModels.length) card.appendChild(modelBox);

    /**
     * 默认模型下拉框：选项只来自「已勾选」的模型。
     * 勾选变化时同步刷新，避免出现「默认模型没被勾选」的矛盾状态。
     */
    var defaultSelect = el('select', { class: 'ls-input ls-select' });
    defaultSelect.id = 'ls-default-model-' + p.id;

    function syncDefaultOptions() {
      var picked = allModels.filter(function (m) {
        return checked[m];
      });
      var want = p.defaultModel || '';
      defaultSelect.innerHTML = '';
      if (!picked.length) {
        defaultSelect.appendChild(el('option', { value: '', text: t('provPickDefault') }));
        defaultSelect.value = '';
        return;
      }
      picked.forEach(function (m) {
        defaultSelect.appendChild(el('option', { value: m, text: m }));
      });
      defaultSelect.value = picked.indexOf(want) !== -1 ? want : picked[0];
    }
    syncDefaultOptions();

    card.appendChild(
      el('div', { class: 'ls-field' }, [
        el('label', { class: 'ls-label', text: t('provDefaultModel') }),
        defaultSelect
      ])
    );

    // 手动加模型（不在接口返回列表里的，直接手填）
    var manualInput = el('input', {
      type: 'text',
      class: 'ls-input',
      placeholder: t('provManualHint'),
      value: '',
      spellcheck: 'false'
    });
    card.appendChild(el('div', { class: 'ls-field' }, [manualInput]));

    // 消息行
    var msg = el('span', { class: 'ls-inline-msg' });
    var fetching = composerState.fetchingId === p.id;

    /** 把当前输入框里的值收集起来写回该提供方 */
    function collect() {
      var name = (nameInput.value || '').trim();
      var base = normalizeBase(baseInput.value);
      if (!name) return { err: t('provErrName') };
      if (base && !/^https?:\/\/[^\s]+$/i.test(base)) return { err: t('provErrBase') };
      return { name: name, base: base, key: (keyInput.value || '').trim() };
    }

    var btns = [];

    /**
     * 收集当前卡片上的编辑结果。
     * 模型 = 勾选的模型 ∪ 手填的模型；默认模型取自下拉框。
     */
    function gather() {
      var r = collect();
      if (r.err) return r;

      var picked = allModels.filter(function (m) {
        return checked[m];
      });
      (manualInput.value || '')
        .split('\n')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean)
        .forEach(function (m) {
          if (picked.indexOf(m) === -1) picked.push(m);
        });

      var def = defaultSelect.value || '';
      if (def && picked.indexOf(def) === -1) picked.push(def);
      if (!def && picked.length) def = picked[0];

      r.models = picked;
      r.defaultModel = def;
      // 接口返回过的完整列表也留着，下次进设置页仍能显示未勾选项
      r.availableModels = allModels
        .concat(picked)
        .filter(function (m, i, a) {
          return a.indexOf(m) === i;
        });
      return r;
    }

    btns.push(
      button(
        t('provSave'),
        function () {
          withBusy(async function () {
            var r = gather();
            if (r.err) {
              setMessage(r.err, true);
              return;
            }
            var target = findProvider(p.id);
            if (!target) return;
            target.name = r.name;
            target.baseURL = r.base;

            // 关键保护：卡片上没填 Key 时，不要用空值覆盖已有的 Key。
            // 用户很可能是在应用自带的界面里填的 Key，桥接层并不知道，
            // 一旦这里写成空串，下次启动就会被判定为「API Key 无效」。
            if (r.key) {
              target.apiKey = r.key;
            } else if (!target.apiKey) {
              target.apiKey = lsGet(LS_APP_API_KEY) || '';
            }

            target.models = r.models;
            target.defaultModel = r.defaultModel;
            target.availableModels = r.availableModels;

            saveProviders();
            if (isActive) {
              applyActiveProvider(false);
              if (r.defaultModel) lsSet(LS_MODEL, r.defaultModel);
            }
            setMessage(
              t('provSaved') + '（' + r.models.length + ' ' + t('provModels') + '）',
              false
            );
            rerender();
            mountComposer();
          });
        },
        { primary: true, disabled: uiState.busy }
      )
    );

    btns.push(
      button(
        fetching ? t('provFetching') : t('provFetch'),
        function () {
          withBusy(async function () {
            var r = collect();
            if (r.err) {
              setMessage(r.err, true);
              return;
            }
            var target = findProvider(p.id);
            if (!target) return;
            // 先把当前输入落盘，拉取时才能用上最新的地址与 Key
            target.name = r.name;
            target.baseURL = r.base;
            target.apiKey = r.key;
            saveProviders();

            composerState.fetchingId = p.id;
            rerender();
            try {
              var got = await fetchModelsFor(p.id);
              var fresh = findProvider(p.id);

              // 合并到「可选模型」：新拉到的默认勾选，已有的保持原勾选状态
              var avail = (fresh.availableModels || []).slice();
              var prev = (fresh.models || []).slice();
              got.models.forEach(function (m) {
                if (avail.indexOf(m) === -1) avail.push(m);
                if (prev.indexOf(m) === -1) prev.push(m);
              });
              fresh.availableModels = avail;
              fresh.models = prev;
              if (!fresh.defaultModel && fresh.models.length) {
                fresh.defaultModel = fresh.models[0];
              }
              saveProviders();
              composerState.fetchingId = null;
              setMessage(
                t('provFetched', { n: got.models.length }) + ' · ' + t('provPickHint'),
                false
              );
            } catch (e) {
              composerState.fetchingId = null;
              setMessage(((e && e.message) || String(e)), true);
            }
            rerender();
            mountComposer();
          });
        },
        { disabled: uiState.busy || fetching }
      )
    );

    if (!isActive) {
      btns.push(
        button(
          t('provSetActive'),
          function () {
            withBusy(async function () {
              var st = getProviders();
              st.activeId = p.id;
              saveProviders();
              applyActiveProvider(false);
              closeComposerMenu();
              setMessage(t('provSwitched', { name: p.name }), false);
              mountComposer();
              rerender();
            });
          },
          { disabled: uiState.busy }
        )
      );
    }

    if (!p.builtin) {
      btns.push(
        button(
          t('provDelete'),
          function () {
            if (!window.confirm(t('provDeleteConfirm', { name: p.name }))) return;
            withBusy(async function () {
              var st = getProviders();
              st.list = st.list.filter(function (x) {
                return x.id !== p.id;
              });
              if (st.activeId === p.id && st.list.length) st.activeId = st.list[0].id;
              saveProviders();
              applyActiveProvider(false);
              rerender();
              mountComposer();
            });
          },
          { disabled: uiState.busy }
        )
      );
    } else {
      card.setAttribute('data-builtin', '1');
    }

    card.appendChild(el('div', { class: 'ls-btns' }, btns));
    card.appendChild(msg);
    return card;
  }

  var UI_ID = 'localstore-section';

  var STRINGS = {
    'zh-CN': {
      title: '本地文件夹存储',
      desc:
        '把对话自动保存到你电脑上的真实文件夹，不受清理浏览器数据影响，换浏览器也能读回。',
      unsupported:
        '当前浏览器不支持文件夹写入。请使用 Chrome 或 Edge 打开本页；你也可以使用上方的「导出所有历史对话」手动备份。',
      noFolder: '尚未选择文件夹',
      connected: '已连接',
      reconnecting: '等待授权',
      pick: '选择文件夹…',
      change: '更换文件夹',
      syncNow: '立即同步',
      syncing: '同步中…',
      lastSync: '上次同步',
      never: '尚未同步',
      autosync: '自动同步',
      motion: '界面动效',
      motionHint: '界面切换时的淡入与滑动效果。关掉后立即生效，无需刷新',
      on: '已开启',
      off: '已关闭',
      restore: '从文件夹恢复',
      restoreHint: '把文件夹里的对话读回浏览器（会覆盖当前浏览器内的对话）',
      disconnect: '断开',
      status: '状态',
      stats: '{sessions} 个对话 · {images} 张图片',
      apiBaseTitle: 'API 地址',
      apiBaseDesc:
        '留空使用 DeepSeek 官方地址。可填入兼容 Anthropic 协议的中转地址或自建服务，例如 https://my-proxy.example.com',
      apiBasePlaceholder: 'https://api.deepseek.com',
      apiBaseSave: '保存',
      apiBaseSaved: '已保存，正在重新加载…',
      apiBaseReset: '恢复官方',
      apiBaseInvalid: '地址格式无效，需以 http:// 或 https:// 开头',
      apiBaseActive: '当前生效',
      keyTitle: 'API Key 保存到文件夹',
      keyDesc:
        '把 API Key 一并存进该文件夹，换浏览器或清空浏览器数据后自动恢复，不必重新输入。',
      keyWarn:
        '⚠️ 密钥将以明文保存在文件夹内的 数据/apikey.json，任何能访问该文件夹的人或程序都能看到。请勿把含密钥的文件夹上传到网盘、Git 仓库或分享给他人。',
      keyOn: '已保存到文件夹',
      keyOff: '仅存在浏览器里',
      keySave: '保存到文件夹',
      keyRemove: '删除文件夹中的密钥',
      keySaved: '已保存到文件夹',
      keyRemoved: '已从文件夹移除',
      keyNone: '浏览器里还没有 API Key，请先在主页输入后再来保存。',
      keyRestored: '已从文件夹恢复 API Key，正在重新加载…',
      keyLoadFailed: '读取文件夹中的密钥失败：',
      modelTitle: '模型显示',
      modelDesc:
        '在每条回答下方显示实际使用的模型（读取接口返回的真实模型名，而非界面上的固定值）。',
      modelOn: '已开启',
      modelOff: '已关闭',

      // ---- 多提供方 ----
      provTitle: '模型提供方',
      provNowUsing: '当前生效',
      provOfficialName: 'DeepSeek',
      provOfficialHint:
        '当前用的是官方统一配置：接口地址取「自定义 API 地址」，API Key 请在「数据管理」标签页里填写。下面只列你自己添加的提供方。',
      provNoCustom: '还没有自定义提供方。点下面的按钮可以添加中转站等 Anthropic 兼容服务。',
      provUseOfficial: '切回官方统一配置',
      provDesc:
        '官方那一路使用应用自带的统一配置（API 地址 + 「数据管理」里的 API Key），这里只管理你自己添加的 Anthropic 兼容接口（中转站、自建服务等），每个提供方各自保存 API Key 与模型列表。',
      provNote:
        '本应用只使用 Anthropic 协议（POST /anthropic/v1/messages）。纯 OpenAI 协议（/v1/chat/completions）的服务无法直接使用，需要服务端提供 Anthropic 兼容端点。',
      provActive: '默认',
      provSetActive: '设为默认',
      provActiveNow: '当前默认提供方',
      provSwitchHint: '设为默认提供方（会重新加载页面以切换 API Key）',
      provSwitched: '已切换默认提供方：{name}',
      provName: '名称',
      provBase: 'API 地址',
      provBaseHint: '只填根地址即可，例如 https://llmapi.paratera.com（结尾的 /anthropic 会自动去掉）',
      provKey: 'API Key',
      provKeyPlaceholder: 'sk-…（留空则用主页里填的那个）',
      provModels: '模型列表',
      provDefaultModel: '默认模型',
      provFetch: '获取模型',
      provFetching: '获取中…',
      provAdd: '添加提供方',
      provDelete: '删除',
      provDeleteConfirm: '确定删除提供方「{name}」吗？',
      provBuiltinNoDelete: '官方提供方不可删除',
      provSave: '保存',
      provSaved: '已保存',
      provErrName: '请填写名称',
      provErrBase: 'API 地址无效，需以 http:// 或 https:// 开头',
      provErrNoProvider: '找不到该提供方',
      provErrFetch: '获取模型失败，已尝试的地址：',
      provErrEmpty: '返回内容里没有模型',
      provFetched: '获取到 {n} 个模型',
      provNoModels: '尚未获取模型',
      provNoModelsHint: '点「获取模型」拉取列表',
      provPickDefault: '（未选择）',
      provPickHint: '请勾选要保留的模型',
      provSelectAll: '全选',
      provSelectNone: '取消全选',
      provManualHint: '手动添加模型（每行一个）',
      provManualLabel: '手动添加模型（每行一个）',
      provKeySaved: '密钥已保存（明文存放在文件夹的数据/apikey.json）',
      provKeyNone: '尚未填写 API Key',
      provEffBase: '当前生效地址',
      provEffModel: '当前生效模型',

      // ---- 输入框旁的模型切换器 ----
      composerHint: '切换模型 / 提供方',
      composerManage: '管理提供方与模型…',
      modelSwitched: '已切换到 {model}，正在重新加载…',

      errPick: '选择文件夹失败：',
      settingsTitle: '设置项也存到文件夹',
      settingsDesc:
        '把界面偏好（语言、主题、思考模式、联网搜索、语音音色、侧边栏状态，以及提供方与模型选择）一并存进文件夹，换浏览器或清空数据后可恢复。',
      settingsSave: '保存设置到文件夹',
      settingsRestore: '从文件夹恢复设置',
      settingsNone: '文件夹里还没有设置文件，请先保存一次',
      settingsSaved: '已保存 {n} 项设置到文件夹',
      settingsRestored: '已恢复 {n} 项设置，正在重新加载…',
      settingsScope: '不包含密钥，可安全阅读',
      settingsNeedFolder: '请先连接文件夹',
      settingsWillReload: '恢复设置后需要重新加载页面',
      needFolder: '尚未选择本地文件夹',
      noPermission: '未获得文件夹读写权限',
      errSync: '同步失败：',
      errRestore: '恢复失败：',
      doneSync: '同步完成：{sessions} 个对话',
      doneRestore: '已恢复 {sessions} 个对话，正在重新加载…',
      busy: '处理中…',
      needReconnect: '浏览器已收回文件夹权限，点击「重新连接」恢复自动保存',
      reconnect: '重新连接'
    },
    'en-US': {
      title: 'Local folder storage',
      desc:
        'Automatically save chats to a real folder on your computer. Survives clearing browser data, and works across browsers.',
      unsupported:
        'This browser cannot write to folders. Use Chrome or Edge; you can also use "Export all chats" above to back up manually.',
      noFolder: 'No folder selected',
      connected: 'Connected',
      reconnecting: 'Awaiting permission',
      pick: 'Choose folder…',
      change: 'Change folder',
      syncNow: 'Sync now',
      syncing: 'Syncing…',
      lastSync: 'Last sync',
      never: 'Never',
      autosync: 'Auto-sync',
      motion: 'Interface motion',
      motionHint: 'Fade and slide effects when views change. Takes effect immediately',
      on: 'On',
      off: 'Off',
      restore: 'Restore from folder',
      restoreHint:
        'Read chats from the folder back into this browser (overwrites chats in this browser)',
      disconnect: 'Disconnect',
      status: 'Status',
      stats: '{sessions} chats · {images} images',
      apiBaseTitle: 'API base URL',
      apiBaseDesc:
        'Leave empty for the official DeepSeek endpoint. Set an Anthropic-compatible proxy, e.g. https://my-proxy.example.com',
      apiBasePlaceholder: 'https://api.deepseek.com',
      apiBaseSave: 'Save',
      apiBaseSaved: 'Saved, reloading…',
      apiBaseReset: 'Use official',
      apiBaseInvalid: 'Invalid URL — must start with http:// or https://',
      apiBaseActive: 'Active',
      keyTitle: 'Save API Key to folder',
      keyDesc:
        'Store the API Key in the folder too, so it is restored automatically in another browser or after browser data is cleared.',
      keyWarn:
        '⚠️ The key is stored in PLAINTEXT at 数据/apikey.json. Anyone or any program that can read this folder can read the key. Never upload or share a folder containing it.',
      keyOn: 'Saved to folder',
      keyOff: 'Browser only',
      keySave: 'Save to folder',
      keyRemove: 'Remove key from folder',
      keySaved: 'Saved to folder',
      keyRemoved: 'Removed from folder',
      keyNone: 'No API Key in this browser yet. Enter one on the main page first.',
      keyRestored: 'Restored API Key from folder, reloading…',
      keyLoadFailed: 'Failed to read key from folder: ',
      modelTitle: 'Model badge',
      modelDesc:
        'Show the actual model used under each reply (read from the API response, not the fixed UI label).',
      modelOn: 'On',
      modelOff: 'Off',

      // ---- Providers ----
      provTitle: 'Model providers',
      provNowUsing: 'Currently active',
      provOfficialName: 'DeepSeek',
      provOfficialHint:
        'You are on the official unified config: the endpoint comes from "Custom API base", and the API key is entered on the "Data" tab. Only providers you added yourself are listed below.',
      provNoCustom: 'No custom providers yet. Use the button below to add a relay or other Anthropic-compatible service.',
      provUseOfficial: 'Switch back to official unified config',
      provDesc:
        'The official route uses the app\'s built-in unified config (API base + the API key on the "Data" tab). Here you only manage Anthropic-compatible endpoints you add yourself (proxies, self-hosted). Each keeps its own API key and model list.',
      provNote:
        'This app speaks the Anthropic protocol only (POST /anthropic/v1/messages). OpenAI-only services (/v1/chat/completions) will not work unless the server exposes an Anthropic-compatible endpoint.',
      provActive: 'Default',
      provSetActive: 'Set as default',
      provActiveNow: 'Default provider',
      provSwitchHint: 'Set as the default provider (reloads the page to switch API key)',
      provSwitched: 'Default provider switched to {name}',
      provName: 'Name',
      provBase: 'API base URL',
      provBaseHint: 'Root URL only, e.g. https://llmapi.paratera.com (a trailing /anthropic is stripped automatically)',
      provKey: 'API Key',
      provKeyPlaceholder: 'sk-… (leave empty to use the one entered on the main page)',
      provModels: 'Models',
      provDefaultModel: 'Default model',
      provFetch: 'Fetch models',
      provFetching: 'Fetching…',
      provAdd: 'Add provider',
      provDelete: 'Delete',
      provDeleteConfirm: 'Delete provider "{name}"?',
      provBuiltinNoDelete: 'The official provider cannot be deleted',
      provSave: 'Save',
      provSaved: 'Saved',
      provErrName: 'Please enter a name',
      provErrBase: 'Invalid URL — must start with http:// or https://',
      provErrNoProvider: 'Provider not found',
      provErrFetch: 'Failed to fetch models. Tried:',
      provErrEmpty: 'no models in response',
      provFetched: 'Fetched {n} models',
      provNoModels: 'No models fetched yet',
      provNoModelsHint: 'Click "Fetch models"',
      provPickDefault: '(none selected)',
      provPickHint: 'tick the models you want to keep',
      provSelectAll: 'Select all',
      provSelectNone: 'Select none',
      provManualHint: 'Add models manually (one per line)',
      provManualLabel: 'Add models manually (one per line)',
      provKeySaved: 'Key saved (plaintext at 数据/apikey.json)',
      provKeyNone: 'No API key yet',
      provEffBase: 'Active base URL',
      provEffModel: 'Active model',

      // ---- Composer model switcher ----
      composerHint: 'Switch model / provider',
      composerManage: 'Manage providers & models…',
      modelSwitched: 'Switched to {model}, reloading…',

      errPick: 'Failed to choose folder: ',
      settingsTitle: 'Save settings to folder',
      settingsDesc:
        'Mirror UI preferences (language, theme, thinking, search, voice, sidebar) plus provider and model choices into the folder, so they survive clearing browser data or switching browsers.',
      settingsSave: 'Save settings to folder',
      settingsRestore: 'Restore settings from folder',
      settingsNone: 'No settings file in the folder yet — save once first',
      settingsSaved: 'Saved {n} settings to folder',
      settingsRestored: 'Restored {n} settings, reloading…',
      settingsScope: 'Contains no secrets; safe to read',
      settingsNeedFolder: 'Connect a folder first',
      settingsWillReload: 'Restoring settings reloads the page',
      needFolder: 'No local folder selected',
      noPermission: 'No read/write permission for the folder',
      errSync: 'Sync failed: ',
      errRestore: 'Restore failed: ',
      doneSync: 'Synced: {sessions} chats',
      doneRestore: 'Restored {sessions} chats, reloading…',
      busy: 'Working…',
      needReconnect:
        'The browser revoked folder access. Click "Reconnect" to resume auto-save.',
      reconnect: 'Reconnect'
    }
  };

  function detectLocale() {
    var stored = lsGet('chat-demo:locale');
    if (stored === 'zh-CN' || stored === 'en-US') return stored;
    var nav = (navigator.language || 'zh').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh-CN' : 'en-US';
  }

  function t(key, params) {
    var table = STRINGS[detectLocale()] || STRINGS['zh-CN'];
    var s = table[key] != null ? table[key] : key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return params[name] != null ? String(params[name]) : m;
      });
    }
    return s;
  }

  var uiState = {
    busy: false,
    message: null,
    messageError: false,
    permission: null
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'style') node.setAttribute('style', attrs[k]);
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function button(label, onClick, opts) {
    opts = opts || {};
    return el(
      'button',
      {
        type: 'button',
        class: 'ls-btn' + (opts.primary ? ' ls-btn-primary' : ''),
        disabled: opts.disabled ? '' : null,
        title: opts.title || null,
        onclick: onClick
      },
      [label]
    );
  }

  function renderSection() {
    var folderName = lsGet(LS_FOLDER);
    var connected = !!dirCache && !!folderName;
    var lines = [];

    lines.push(el('div', { class: 'ls-head', text: t('title') }));
    lines.push(el('div', { class: 'ls-desc', text: t('desc') }));

    // 界面动效开关：与文件夹功能无关，任何浏览器都该能开关
    lines.push(
      el('div', { class: 'ls-row' }, [
        el('div', { class: 'ls-row-label' }, [
          el('div', { class: 'ls-row-title', text: t('motion') }),
          el('div', { class: 'ls-desc', text: t('motionHint') })
        ]),
        button(motionEnabled() ? t('on') : t('off'), function () {
          setMotion(!motionEnabled());
          rerender();
        })
      ])
    );

    if (!supportsFs) {
      lines.push(el('div', { class: 'ls-warn', text: t('unsupported') }));
    } else {
      // 状态行
      var statusText;
      if (uiState.busy) statusText = t('busy');
      else if (connected) statusText = t('connected');
      else if (syncState.lastError) statusText = syncState.lastError;
      else statusText = t('noFolder');

      var statusChildren = [
        el('span', {
          class:
            'ls-dot ' +
            (connected ? 'ls-dot-ok' : syncState.lastError ? 'ls-dot-err' : 'ls-dot-off')
        }),
        el('span', {
          class: 'ls-status-text',
          text: (folderName ? folderName + ' · ' : '') + statusText
        })
      ];
      lines.push(el('div', { class: 'ls-status' }, statusChildren));

      // 上次同步
      if (syncState.lastSync) {
        lines.push(
          el('div', {
            class: 'ls-meta',
            text: t('lastSync') + '：' + fmtTime(syncState.lastSync)
          })
        );
      }

      // 按钮组
      var btns = [];
      if (!connected) {
        btns.push(
          button(folderName ? t('reconnect') : t('pick'), onPick, {
            primary: true,
            disabled: uiState.busy
          })
        );
      } else {
        btns.push(
          button(uiState.busy ? t('syncing') : t('syncNow'), onSyncNow, {
            primary: true,
            disabled: uiState.busy
          })
        );
        btns.push(button(t('restore'), onRestore, { disabled: uiState.busy, title: t('restoreHint') }));
        btns.push(button(t('change'), onPick, { disabled: uiState.busy }));
        btns.push(button(t('disconnect'), onDisconnect, { disabled: uiState.busy }));
      }
      lines.push(el('div', { class: 'ls-btns' }, btns));

      // 自动同步状态（仅展示，默认恒开，通过 localStorage 可关）
      lines.push(
        el('div', {
          class: 'ls-meta',
          text:
            t('autosync') +
            '：' +
            (lsGet(LS_AUTOSYNC) === 'false' ? t('off') : t('on'))
        })
      );

      // 界面动效开关已在函数开头加入，这里不再重复。
    }

    // 提示 / 错误
    if (uiState.message) {
      lines.push(
        el('div', {
          class: uiState.messageError ? 'ls-msg ls-msg-err' : 'ls-msg',
          text: uiState.message
        })
      );
    }

    // ---- 模型提供方 ----
    //
    // 设计（按用户要求）：官方那一路**不再作为卡片列出**。
    // 「DeepSeek 官方 / 你现在正在用的那个统一配置」由官方自带的
    // 「数据管理 → API Key」那一行 + 官方接口地址负责，本区块只管**自定义**提供方。
    // 这样就不会出现「同一个 Key 有两处可改」的困惑。
    lines.push(el('div', { class: 'ls-sep' }));
    lines.push(el('div', { class: 'ls-head', text: t('provTitle') }));
    lines.push(el('div', { class: 'ls-desc', text: t('provDesc') }));
    lines.push(el('div', { class: 'ls-warn', text: t('provNote') }));

    var pst = getProviders();

    // 当前生效一览
    var activeP = getActiveProvider();
    var activeIsOfficial = !activeP || activeP.builtin || activeP.id === OFFICIAL_PROVIDER.id;
    lines.push(
      el('div', {
        class: 'ls-meta',
        text:
          t('provNowUsing') +
          '：' +
          (activeIsOfficial ? t('provOfficialName') : (activeP.name || activeP.id))
      })
    );
    lines.push(
      el('div', { class: 'ls-meta', text: t('provEffBase') + '：' + effectiveApiBase() })
    );
    lines.push(
      el('div', { class: 'ls-meta', text: t('provEffModel') + '：' + effectiveModel() })
    );

    if (activeIsOfficial) {
      lines.push(el('div', { class: 'ls-desc', text: t('provOfficialHint') }));
    }

    // 只列自定义提供方；官方的是隐式的
    var customList = pst.list.filter(function (p) {
      return !p.builtin && p.id !== OFFICIAL_PROVIDER.id;
    });

    if (!customList.length) {
      lines.push(el('div', { class: 'ls-meta', text: t('provNoCustom') }));
    }

    customList.forEach(function (p) {
      lines.push(renderProviderCard(p, p.id === pst.activeId));
    });

    // 已经切到某个自定义提供方时，给一个「切回统一配置」的出口
    if (!activeIsOfficial) {
      lines.push(
        el('div', { class: 'ls-btns' }, [
          button(
            t('provUseOfficial'),
            function () {
              withBusy(async function () {
                var st = getProviders();
                st.activeId = OFFICIAL_PROVIDER.id;
                saveProviders();
                applyActiveProvider(false);
                setMessage(t('provSwitched', { name: t('provOfficialName') }), false);
                mountComposer();
                rerender();
              });
            },
            { disabled: uiState.busy }
          )
        ])
      );
    }

    lines.push(
      el('div', { class: 'ls-btns' }, [
        button(
          t('provAdd'),
          function () {
            withBusy(async function () {
              var st = getProviders();
              var np = {
                id: uid('custom'),
                name: t('provAdd') + ' ' + (st.list.length),
                baseURL: '',
                apiKey: '',
                models: [],
                defaultModel: '',
                availableModels: [],
                builtin: false
              };
              st.list.push(np);
              saveProviders();
              rerender();
            });
          },
          { disabled: uiState.busy }
        )
      ])
    );

    // ---- API Key 存到文件夹 ----
    lines.push(el('div', { class: 'ls-sep' }));
    lines.push(el('div', { class: 'ls-head', text: t('keyTitle') }));
    lines.push(el('div', { class: 'ls-desc', text: t('keyDesc') }));
    lines.push(el('div', { class: 'ls-warn', text: t('keyWarn') }));

    var keyInFolder = lsGet('chat-demo:local-key') === '1';
    var keyInBrowser = !!lsGet(LS_APP_API_KEY);
    lines.push(
      el('div', {
        class: 'ls-meta',
        text: t('status') + '：' + (keyInFolder ? t('keyOn') : t('keyOff'))
      })
    );

    var keyMsg = el('span', { class: 'ls-inline-msg' });
    var keyBtns = [
      button(
        t('keySave'),
        function () {
          withBusy(async function () {
            try {
              await writeKeyToFolder();
              keyMsg.textContent = '';
              setMessage(t('keySaved'), false);
            } catch (e) {
              setMessage(t('keyLoadFailed') + ((e && e.message) || e), true);
            }
          });
        },
        { primary: true, disabled: uiState.busy || !keyInBrowser || !connected }
      )
    ];
    if (keyInFolder) {
      keyBtns.push(
        button(
          t('keyRemove'),
          function () {
            withBusy(async function () {
              try {
                await removeKeyFromFolder();
                setMessage(t('keyRemoved'), false);
              } catch (e) {
                setMessage(((e && e.message) || e), true);
              }
            });
          },
          { disabled: uiState.busy }
        )
      );
    }
    lines.push(el('div', { class: 'ls-btns' }, keyBtns));
    lines.push(keyMsg);
    if (!keyInBrowser) {
      lines.push(el('div', { class: 'ls-meta', text: t('keyNone') }));
    }

    // ---- 模型显示开关 ----
    lines.push(el('div', { class: 'ls-sep' }));
    lines.push(el('div', { class: 'ls-head', text: t('modelTitle') }));
    lines.push(el('div', { class: 'ls-desc', text: t('modelDesc') }));
    var showModel = lsGet(LS_SHOW_MODEL) !== 'false';
    lines.push(
      el('div', { class: 'ls-btns' }, [
        button(
          showModel ? t('modelOn') : t('modelOff'),
          function () {
            lsSet(LS_SHOW_MODEL, showModel ? 'false' : 'true');
            if (!showModel) {
              // 重新显示：清掉「已处理」标记，让观察器重新注入
              document
                .querySelectorAll('[data-ls-model]')
                .forEach(function (n) {
                  n.removeAttribute('data-ls-model');
                });
            } else {
              document.querySelectorAll('.ls-model-badge').forEach(function (n) {
                n.remove();
              });
            }
            rerender();
          },
          { disabled: uiState.busy }
        ),
        el('span', {
          class: 'ls-inline-msg',
          text: showModel ? t('modelOn') : t('modelOff')
        })
      ])
    );

    // ---- 设置项存到文件夹 ----
    lines.push(el('div', { class: 'ls-sep' }));
    lines.push(el('div', { class: 'ls-head', text: t('settingsTitle') }));
    lines.push(el('div', { class: 'ls-desc', text: t('settingsDesc') }));

    var settingsCount = Object.keys(collectSettings()).length;
    lines.push(
      el('div', {
        class: 'ls-meta',
        text: t('status') + '：' + settingsCount + ' · ' + t('settingsScope')
      })
    );

    var settingsMsg = el('span', { class: 'ls-inline-msg' });
    var settingsBtns = [
      button(
        t('settingsSave'),
        function () {
          withBusy(async function () {
            try {
              var r = await writeSettingsToFolder();
              setMessage(t('settingsSaved', { n: r.count }), false);
            } catch (e) {
              setMessage(((e && e.message) || String(e)), true);
            }
          });
        },
        { primary: true, disabled: uiState.busy || !connected }
      ),
      button(
        t('settingsRestore'),
        function () {
          withBusy(async function () {
            try {
              var n = await restoreSettingsFromFolder();
              setMessage(t('settingsRestored', { n: n }), false);
              setTimeout(function () {
                requestReload('用户手动恢复了设置');
              }, 800);
            } catch (e) {
              setMessage(((e && e.message) || String(e)), true);
            }
          });
        },
        { disabled: uiState.busy || !connected, title: t('settingsWillReload') }
      )
    ];
    lines.push(el('div', { class: 'ls-btns' }, settingsBtns));
    lines.push(settingsMsg);

    var section = el('div', { class: 'ls-section', id: UI_ID }, lines);
    return section;
  }

  function rerender() {
    var existing = document.getElementById(UI_ID);
    if (!existing) return;
    var fresh = renderSection();
    existing.replaceWith(fresh);
    refreshPermissionState();
  }

  function setMessage(text, isError) {
    uiState.message = text;
    uiState.messageError = !!isError;
    rerender();
  }

  async function withBusy(fn) {
    uiState.busy = true;
    rerender();
    try {
      await fn();
    } finally {
      uiState.busy = false;
      rerender();
    }
  }

  // --- 事件处理 ---

  function onPick() {
    withBusy(async function () {
      try {
        var handle = await pickFolder();
        uiState.permission = 'granted';
        // 连接后立即做一次对账，让用户马上看到文件夹里有东西
        var existing = await readAllSessions();
        if (existing.length) {
          var r = await snapshot('first-connect');
          setMessage(
            t('doneSync', { sessions: r ? r.sessionCount : existing.length }),
            false
          );
        } else {
          setMessage(t('connected') + '：' + (handle.name || ''), false);
        }
      } catch (e) {
        setMessage(t('errPick') + ((e && e.message) || e), true);
      }
    });
  }

  function onSyncNow() {
    withBusy(async function () {
      try {
        var r = await snapshot('manual');
        setMessage(t('doneSync', { sessions: r ? r.sessionCount : 0 }), false);
      } catch (e) {
        setMessage(t('errSync') + ((e && e.message) || e), true);
      }
    });
  }

  function onRestore() {
    withBusy(async function () {
      try {
        var manifest = await readManifest();
        var hint = manifest
          ? '（存档最后同步于 ' + (manifest.lastSyncAtText || '未知') + '）'
          : '';
        var ok = window.confirm(
          t('restore') + hint + '\n\n' + t('restoreHint')
        );
        if (!ok) return;
        var r = await restoreFromFolder();
        setMessage(t('doneRestore', { sessions: r.sessions }), false);
        setTimeout(function () {
          requestReload('用户手动从文件夹恢复了对话');
        }, 1200);
      } catch (e) {
        setMessage(t('errRestore') + ((e && e.message) || e), true);
      }
    });
  }

  function onDisconnect() {
    withBusy(async function () {
      await disconnect();
      uiState.message = null;
      rerender();
    });
  }

  async function refreshPermissionState() {
    if (!supportsFs) return;
    var root = await getRootHandle();
    if (!root) {
      uiState.permission = null;
      return;
    }
    var state = await ensurePermission(root, false);
    var changed = uiState.permission !== state;
    uiState.permission = state;
    if (changed && state !== 'granted') {
      // 权限被收回，提示用户重新连接
      var node = document.querySelector('#' + UI_ID + ' .ls-inline-msg');
      if (node && !node.textContent) node.textContent = t('needReconnect');
    }
  }

  // -------------------------------------------------------------------------
  // 把区块挂进官方设置弹窗
  // -------------------------------------------------------------------------

  /**
   * 官方设置面板里有一行「导出所有历史对话」。
   * 我们定位官方设置面板的「内容容器」（class 前缀 settings- 的 content-_85c1b），
   * 把本地文件夹区块追加到它末尾。
   *
   * 之所以不靠「从文字往上爬 N 层」：官方设置行在不同版本里层级会变，
   * 而且那个文字有可能出现在别处（例如首页的引导页），爬层会挂错位置。
   */
  var SETTINGS_CONTENT_CLASS = 'content-_85c1b';

  function findSettingsAnchor(scope) {
    var root = scope || document;
    var candidates = root.querySelectorAll('div,span,p');
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (node.childElementCount !== 0) continue;
      var text = (node.textContent || '').trim();
      if (text === '导出所有历史对话' || text === 'Export all chats') {
        return node;
      }
    }
    return null;
  }

  /** 找到应该挂载区块的容器 */
  function findMountContainer(scope) {
    var root = scope || document;

    // 首个可能：传进来的 scope 本身就是官方内容容器
    if (root !== document && root.nodeType === 1 && root.classList &&
        root.classList.contains(SETTINGS_CONTENT_CLASS)) {
      return root;
    }

    // 首选：官方设置面板的内容容器
    var content = root.querySelector('.' + SETTINGS_CONTENT_CLASS);
    if (content) return content;

    // 退化：以「导出所有历史对话」那一行往上找设置面板
    var anchor = findSettingsAnchor(scope);
    if (!anchor) return null;
    var cell = anchor.closest
      ? anchor.closest('.row-_85c1b')
      : anchor.parentElement && anchor.parentElement.parentElement;
    if (cell && cell.parentElement) return cell.parentElement;
    return null;
  }

  // ---------------------------------------------------------------------------
  // 挂载点：只能挂在「通用设置」标签页下
  // ---------------------------------------------------------------------------
  //
  // 官方设置弹窗的两个标签页（通用设置 / 数据管理）共用**同一个**内容容器
  // `.content-_85c1b`，靠切换子节点来换页：
  //
  //   <div class="content-_85c1b">
  //     "general" === tab ? [主题, 语言, 朗读音色, 位置信息]
  //                      : [导入, 导出, 删除]
  //   </div>
  //
  // 所以「往容器里 append 一个区块」是会串台的：弹窗默认停在「数据管理」
  // （尤其首次启动、还没填 API Key 时），区块就被挂到了数据管理下，
  // 切到通用设置又跟着显示，看起来就是两块内容混在一起。
  //
  // 正确做法：先判断当前激活的标签页，只有「通用设置」才挂；
  // 切到别的标签页就把自己的区块摘掉（React 重渲染会清掉官方节点，
  // 我们只需保证不留下自己的残留）。

  var TAB_GENERAL = 'general';
  var TAB_DATA = 'data';
  var TAB_UNKNOWN = 'unknown';

  /** 判断当前激活的是哪个标签页（优先看导航高亮，其次看内容特征） */
  function detectActiveTab(scope) {
    // scope 存在时，优先从 scope 自己或其祖先找弹窗：
    // 这样「传入某个内容容器」时不会被页面上另一个真实的设置弹窗干扰。
    var dlg = null;
    if (scope && scope.nodeType === 1) {
      dlg = scope.closest ? scope.closest('.dialog-_85c1b') : null;
    }
    if (!dlg) dlg = document.querySelector('.dialog-_85c1b');
    if (!dlg) return TAB_UNKNOWN;

    // 1) 导航项高亮最可靠
    var items = dlg.querySelectorAll('.navItem-_85c1b');
    for (var i = 0; i < items.length; i++) {
      if (/navItemActive/.test(items[i].className || '')) {
        var txt = (items[i].textContent || '').trim();
        if (/通用|General/i.test(txt)) return TAB_GENERAL;
        if (/数据|Data/i.test(txt)) return TAB_DATA;
      }
    }

    // 2) 退而求其次：看内容里有没有「语言」选择框（通用设置独有）
    if (dlg.querySelector('[aria-label="语言"], [aria-label="Language"]')) return TAB_GENERAL;

    // 3) 或者有没有导入/导出那一组（数据管理独有）
    var rows = dlg.querySelectorAll('.row-_85c1b');
    for (var j = 0; j < rows.length; j++) {
      if (/导出所有历史对话|导入历史对话|Export|Import/i.test(rows[j].textContent || '')) {
        return TAB_DATA;
      }
    }
    return TAB_UNKNOWN;
  }

  function mountSection(scope) {
    var container = findMountContainer(scope);

    // 只在「通用设置」下显示；其他标签页（或面板已关闭）一律不挂
    if (!container || detectActiveTab(scope) !== TAB_GENERAL) {
      var stale = document.getElementById(UI_ID);
      if (stale) stale.remove();
      return false;
    }

    var existing = document.getElementById(UI_ID);
    if (existing) {
      // 容器已换（例如 React 重建了内容节点），把区块挪到新容器末尾
      if (existing.parentElement !== container) {
        existing.remove();
      } else {
        return false;
      }
    }

    container.appendChild(renderSection());
    log('已挂载设置区块 → .' + (container.className || container.tagName) + '（通用设置）');
    refreshPermissionState();
    return true;
  }

  function watchForSettings() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', watchForSettings, { once: true });
      return;
    }
    // 记录上一次处理过的标签页，仅在「标签页真的变了」时才动 DOM，
    // 否则我们自己的插入/移除会反过来触发观察器，形成无谓的抖动。
    var lastTab = null;

    var sync = function () {
      var tab = detectActiveTab();
      if (tab === lastTab) return;
      lastTab = tab;
      if (tab === TAB_GENERAL) mountSection();
      else {
        var stale = document.getElementById(UI_ID);
        if (stale) stale.remove();
      }
    };

    var observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    // 面板可能已经存在（脚本晚于首屏渲染）
    sync();
    log('已开始监听设置弹窗');
  }

  // -------------------------------------------------------------------------
  // 样式
  // -------------------------------------------------------------------------

  function installStyles() {
    if (document.getElementById('localstore-styles')) return;
    var css = [
      '.ls-section{margin-top:20px;padding-top:18px;border-top:1px solid var(--ls-line,#e5e5e5);font-size:14px;line-height:1.6}',
      '.ls-section *{box-sizing:border-box}',
      '.ls-head{font-weight:600;font-size:14px;margin-bottom:4px;color:var(--ls-fg,#1a1a1a)}',
      '.ls-desc{color:var(--ls-dim,#8a8a8a);font-size:12.5px;margin-bottom:10px}',
      '.ls-status{display:flex;align-items:center;gap:7px;margin-bottom:6px;font-size:13px}',
      '.ls-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}',
      '.ls-dot-ok{background:#22c55e}',
      '.ls-dot-err{background:#ef4444}',
      '.ls-dot-off{background:#c0c0c0}',
      '.ls-status-text{color:var(--ls-fg,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ls-meta{color:var(--ls-dim,#8a8a8a);font-size:12px;margin:4px 0}',
      // 带开关的一行：左边标题+说明，右边按钮
      '.ls-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0}',
      '.ls-row-label{min-width:0;flex:1 1 auto}',
      '.ls-row-title{font-size:13px;color:var(--ls-fg,#333);margin-bottom:2px}',
      '.ls-row .ls-desc{margin-bottom:0}',
      '.ls-btns{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}',
      '.ls-btn{font:inherit;font-size:13px;padding:5px 12px;border-radius:999px;border:1px solid var(--ls-line,#dcdcdc);background:transparent;color:var(--ls-fg,#333);cursor:pointer;transition:background .15s,border-color .15s}',
      '.ls-btn:hover:not([disabled]){background:var(--ls-hover,rgba(0,0,0,.05))}',
      '.ls-btn[disabled]{opacity:.5;cursor:default}',
      '.ls-btn-primary{background:#4d6bfe;border-color:#4d6bfe;color:#fff}',
      '.ls-btn-primary:hover:not([disabled]){background:#3f5ae0}',
      '.ls-warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);color:#92600a;padding:9px 11px;border-radius:8px;font-size:12.5px}',
      '.ls-msg{font-size:12.5px;margin-top:6px;color:var(--ls-dim,#666)}',
      '.ls-msg-err{color:#d33}',
      '.ls-sep{height:1px;background:var(--ls-line,#e5e5e5);margin:18px 0;opacity:.7}',
      '.ls-api{margin:8px 0}',
      '.ls-input{width:100%;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--ls-line,#dcdcdc);background:var(--ls-input-bg,transparent);color:var(--ls-fg,#333)}',
      '.ls-input:focus{outline:none;border-color:#4d6bfe}',
      '.ls-inline-msg{font-size:12px;color:var(--ls-dim,#8a8a8a)}',
      '.ls-model-badge{display:inline-flex;align-items:center;font-size:11px;line-height:1.5;padding:1px 7px;margin-right:6px;border-radius:999px;border:1px solid var(--ls-line,#dcdcdc);color:var(--ls-dim,#8a8a8a);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;user-select:none}',

      // ---- 提供方卡片 ----
      '.ls-prov{border:1px solid var(--ls-line,#e0e0e0);border-radius:10px;padding:12px;margin:10px 0;background:var(--ls-card,rgba(0,0,0,.015))}',
      '.ls-prov-active{border-color:#4d6bfe;box-shadow:0 0 0 1px rgba(77,107,254,.25)}',
      '.ls-prov-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
      '.ls-prov-name{font-weight:600;font-size:13.5px;color:var(--ls-fg,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ls-prov-badge{font-size:11px;padding:1px 8px;border-radius:999px;background:#4d6bfe;color:#fff;white-space:nowrap}',
      '.ls-field{margin:8px 0}',
      '.ls-label{display:block;font-size:12px;color:var(--ls-dim,#8a8a8a);margin-bottom:4px}',
      '.ls-models{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 6px;max-height:190px;overflow:auto}',
      '.ls-check-item{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer;color:var(--ls-fg,#333);white-space:nowrap}',
      '.ls-check{margin:0;cursor:pointer;flex:0 0 auto}',
      '.ls-models-bulk{display:flex;gap:12px;margin-bottom:8px}',
      '.ls-select{width:100%;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--ls-line,#dcdcdc);background:var(--ls-input-bg,transparent);color:var(--ls-fg,#333)}',
      '.ls-chip{font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--ls-line,#dcdcdc);background:transparent;color:var(--ls-fg,#333);cursor:pointer;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.ls-chip:hover{background:var(--ls-hover,rgba(0,0,0,.05))}',
      '.ls-chip-on{background:#4d6bfe;border-color:#4d6bfe;color:#fff}',

      // ---- 输入框旁的模型切换器 ----
      // 注意：这个节点挂在官方输入区里，不吃 .ls-section 的 CSS 变量作用域，
      // 所以颜色全部显式给出，并单独适配暗色。
      '.ls-composer{display:inline-flex;align-items:center;position:fixed;z-index:900;pointer-events:auto;max-width:200px;min-width:0}',
      '.ls-composer-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;line-height:1.4;padding:4px 10px;border-radius:999px;border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit;cursor:pointer;max-width:200px;min-width:0}',
      '.ls-composer-btn:hover{background:rgba(0,0,0,.05)}',
      // 模型名可压缩并省略；提供方名与箭头不压缩。
      // 长模型名 + 提供方名很容易顶到右侧按钮组，这里必须允许收缩，否则
      // 按钮会被挤出功能行（实测超出约 94px）。
      '.ls-composer-model{flex:0 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ls-composer-provider{flex:0 0 auto;opacity:.55;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px}',
      '.ls-composer-caret{flex:0 0 auto;opacity:.6;font-size:10px}',
      // 菜单直接挂在 body 上并用 fixed 定位：输入区外层有 overflow:hidden，
      // 若留在输入区内，向上弹出的面板会被裁断。位置由 JS 计算。
      '.ls-composer-menu{position:fixed;z-index:2147483000;min-width:260px;max-width:340px;max-height:340px;overflow:auto;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.12);background:#fff;color:#1a1a1a;box-shadow:0 8px 28px rgba(0,0,0,.16)}',
      // 启动遮罩：带 #c= 刷新时，应用**总是**先把空对话渲染出来,
      // 于是看到「今天有什么可以帮到你？」闪一下才跳到目标对话。
      // 这块遮罩盖住那一瞬间，恢复完成后淡出。
      '.ls-boot-cover{position:fixed;inset:0;z-index:2147483001;pointer-events:none;opacity:1;transition:opacity .18s ease-out}',
      '.ls-boot-cover-gone{opacity:0}',
      '.ls-menu-group{margin-bottom:6px}',
      '.ls-menu-head{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:11.5px;color:#8a8a8a}',
      '.ls-menu-provider{font-weight:600;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ls-menu-tag{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid #4d6bfe;color:#4d6bfe}',
      '.ls-menu-item{display:block;width:100%;text-align:left;font:inherit;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:6px 9px;border:0;border-radius:8px;background:transparent;color:#1a1a1a;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ls-menu-item:hover{background:rgba(0,0,0,.06)}',
      '.ls-menu-item-on{color:#4d6bfe;font-weight:600}',
      '.ls-menu-item-on::before{content:"✓ "}',
      '.ls-menu-empty{padding:5px 9px 8px;font-size:11.5px;color:#8a8a8a}',
      '.ls-menu-foot{border-top:1px solid rgba(0,0,0,.08);margin-top:4px;padding-top:6px}',
      '.ls-menu-link{display:block;padding:5px 9px;font-size:12px;color:#4d6bfe;cursor:pointer;border-radius:8px}',
      '.ls-menu-link:hover{background:rgba(77,107,254,.08)}',

      // 暗色主题
      'html[data-theme="dark"] .ls-section,body[data-theme="dark"] .ls-section{--ls-fg:#e8e8e8;--ls-dim:#9aa0a6;--ls-line:#3a3a3a;--ls-hover:rgba(255,255,255,.08);--ls-input-bg:rgba(255,255,255,.04);--ls-card:rgba(255,255,255,.03)}',
      '@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .ls-section{--ls-fg:#e8e8e8;--ls-dim:#9aa0a6;--ls-line:#3a3a3a;--ls-hover:rgba(255,255,255,.08);--ls-input-bg:rgba(255,255,255,.04);--ls-card:rgba(255,255,255,.03)}}',
      // 模型切换器在官方输入区内，单独适配暗色
      'html[data-theme="dark"] .ls-composer-menu,body[data-theme="dark"] .ls-composer-menu{background:#2b2b2b;color:#e8e8e8;border-color:rgba(255,255,255,.14)}',
      'html[data-theme="dark"] .ls-composer-menu .ls-menu-provider,body[data-theme="dark"] .ls-composer-menu .ls-menu-provider{color:#e8e8e8}',
      'html[data-theme="dark"] .ls-composer-menu .ls-menu-item,body[data-theme="dark"] .ls-composer-menu .ls-menu-item{color:#e8e8e8}',
      'html[data-theme="dark"] .ls-composer-menu .ls-menu-item:hover,body[data-theme="dark"] .ls-composer-menu .ls-menu-item:hover{background:rgba(255,255,255,.09)}',
      'html[data-theme="dark"] .ls-composer-btn,body[data-theme="dark"] .ls-composer-btn{border-color:rgba(255,255,255,.18)}',
      'html[data-theme="dark"] .ls-composer-btn:hover,body[data-theme="dark"] .ls-composer-btn:hover{background:rgba(255,255,255,.09)}',
      '@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .ls-composer-menu{background:#2b2b2b;color:#e8e8e8;border-color:rgba(255,255,255,.14)}html:not([data-theme="light"]) .ls-composer-menu .ls-menu-provider,html:not([data-theme="light"]) .ls-composer-menu .ls-menu-item{color:#e8e8e8}html:not([data-theme="light"]) .ls-composer-btn{border-color:rgba(255,255,255,.18)}}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'localstore-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // -------------------------------------------------------------------------
  // API 地址：让补丁后的 bundle 即使在脚本注入顺序异常时也能读到值
  // -------------------------------------------------------------------------

  function seedApiBase() {
    // 让提供方配置成为唯一事实来源：把默认提供方的地址/Key 镜像进
    // 官方读取的槽位，随后补丁后的 bundle 与官方自身都会跟着生效。
    try {
      getProviders();
      applyActiveProvider(false);
    } catch (e) {
      warn('初始化提供方失败', e);
    }

    var stored = lsGet(LS_API_BASE);
    if (stored && stored.trim()) {
      // 必须归一化：应用会自己在根地址后面拼 /anthropic/v1/... 与 /models
      window.__CHAT_API_BASE__ = normalizeBase(stored);
    }
  }

  // -------------------------------------------------------------------------
  // 深链接：让每个对话有自己的 URL（#c=<token>）
  // -------------------------------------------------------------------------
  //
  // 背景：官方应用**不保存「当前打开的是哪个对话」**（虽然它会把位置信息写进
  // chat-demo:location，但那是天气用的省市，跟对话无关）。所以一刷新就回到
  // 「开启新对话」，也没法把某个对话分享/收藏成链接。
  //
  // 做法：
  //   · 侧边栏每个对话项都有一个标题节点 `.title-ff6fc9`，目前打开的那个
  //     最外层带 `active-ff6fc9` —— 这就是「当前对话」的可靠信号；
  //   · 给标题分配一个**稳定**的 token：按标题缓存，一旦分配就不再变；
  //   · 把 token 写进地址栏的 hash（用 replaceState，不产生历史记录、不触发
  //     hashchange）；刷新时 hash 还在，于是能回到原来的对话。
  //
  // 用标题而不是会话 id：应用把「当前对话」留在内存里，没有对外暴露接口，
  // 我们只能从界面反推；而侧边栏项上唯一可用的标识就是标题。
  // 标题重名时靠「按创建时间排序的位置」消歧。

  var SIDE_ITEM_CLASS = 'item-ff6fc9';
  var SIDE_TITLE_CLASS = 'title-ff6fc9';
  var SIDE_ACTIVE_CLASS = 'active-ff6fc9';
  var HASH_PREFIX = '#c=';
  var LS_TOKEN_MAP = 'chat-demo:deeplink-tokens';

  var deepLinkTimer = null;

  /** 简单的稳定哈希，用来生成短的 token */
  function hash32(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  function readTokenMap() {
    try {
      var raw = lsGet(LS_TOKEN_MAP);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeTokenMap(map) {
    try {
      lsSet(LS_TOKEN_MAP, JSON.stringify(map));
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * 给一个会话标识分配 token。同标识永远拿到同一个 token（这是「一旦赋值便不变」）。
   * 先按标题查缓存；没有再用「标题 + 创建时间」算一个短哈希并记进缓存。
   */
  function getOrCreateToken(key, fallbackSeed) {
    var map = readTokenMap();
    if (map[key]) return map[key];
    var token = hash32(fallbackSeed || key);
    map[key] = token;
    writeTokenMap(map);
    return token;
  }

  /**
   * 读侧边栏，返回 [{key, token, title, active}]，顺序与界面一致。
   *
   * key 用标题（重名时加序号后缀），这样「按创建时间排序的位置」变化
   * 也不会让已分配的 token 漂移。
   */
  function readSidebarSessions() {
    // 用 siderEl() 而不是直接 querySelector：侧栏做收起动画时，
    // 页面上会短暂存在一个「替身浮层」，它内部也有 .sider-ac14ac，
    // 直接查会读到替身里的旧内容。
    var sider = siderEl();
    if (!sider) return [];

    var items = Array.prototype.slice.call(sider.querySelectorAll('.' + SIDE_ITEM_CLASS));
    var seen = {};
    var out = [];

    for (var i = 0; i < items.length; i++) {
      var titleEl = items[i].querySelector('.' + SIDE_TITLE_CLASS);
      var title = titleEl ? (titleEl.textContent || '').trim() : '';
      if (!title) continue;

      // 重名消歧：第二个同名标题用 "标题#2"
      var key = title;
      if (seen[title] === undefined) {
        seen[title] = 1;
      } else {
        seen[title] += 1;
        key = title + '#' + seen[title];
      }

      out.push({
        key: key,
        token: getOrCreateToken(key, key),
        title: title,
        active: items[i].className.indexOf(SIDE_ACTIVE_CLASS) !== -1,
        el: items[i]
      });
    }
    return out;
  }

  /** 当前打开的是哪个对话（没有则 null，代表「新对话」） */
  function activeSession() {
    var list = readSidebarSessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].active) return list[i];
    }
    return null;
  }

  function currentHashToken() {
    var h = location.hash || '';
    if (h.indexOf(HASH_PREFIX) !== 0) return null;
    return decodeURIComponent(h.slice(HASH_PREFIX.length)) || null;
  }

  function setHashToken(token) {
    var next = token ? HASH_PREFIX + encodeURIComponent(token) : '';
    var cur = location.hash || '';
    if (cur === next) return;
    try {
      // replaceState：不留历史记录，也不会触发 hashchange
      history.replaceState(null, '', location.pathname + location.search + next);
    } catch (e) {
      /* 某些环境不允许改地址，忽略 */
    }
  }

  /** 把地址栏同步成「当前打开的对话」 */
  function syncUrlToActiveSession() {
    var act = activeSession();
    setHashToken(act ? act.token : null);
  }

  /** 按 hash 里的 token 回到对应对话（找不到就什么都不做） */
  /**
   * 本次启动想恢复的 token。
   *
   * 必须单独记一份：应用在挂载时会把 `location.hash` 抹掉（437ms 左右），
   * 如果每次都从地址栏现读，就会在「还没恢复完」的时候把目标弄丢，
   * 表现为先闪一下空对话、再跳到目标对话。
   */
  var bootToken = null;

  /**
   * 界面动效层。
   *
   * 应用是压缩产物、没有源码，直接改它的 CSS 会在下次升级时全部作废，
   * 所以动效放在独立的 localstore-motion.css 里运行时加载。这里只负责：
   *   1. 插入 <link>（带 ?v=桥接版本，避免缓存住旧样式）；
   *   2. 在 <html> 上加 .ls-motion 开关类 —— 所有动效规则都挂在这个类下面，
   *      这样一旦需要关闭（设置里的开关，或浏览器不支持），能一键全灭，
   *      不会留下一堆半生效的规则。
   *
   * 注意：样式文件是**可选**的。加载失败只意味着没有动效，绝不能影响
   * 存档、上传这些主功能，所以整个过程包在 try/catch 里，失败只记日志。
   */
  var MOTION_CSS_ID = 'localstore-motion-css';
  var MOTION_CLASS = 'ls-motion';

  function motionEnabled() {
    return lsGet(LS_MOTION) !== 'false';
  }

  function applyMotionClass() {
    try {
      var root = document.documentElement;
      if (!root) return;
      if (motionEnabled()) root.classList.add(MOTION_CLASS);
      else root.classList.remove(MOTION_CLASS);
    } catch (e) {
      /* ignore */
    }
  }

  function installMotion() {
    try {
      applyMotionClass();
      if (document.getElementById(MOTION_CSS_ID)) return;
      var link = document.createElement('link');
      link.id = MOTION_CSS_ID;
      link.rel = 'stylesheet';
      link.href = 'localstore-motion.css?v=' + BRIDGE_VERSION;
      // 样式加载完再挂开关类，避免「规则已生效但类还没加」的空窗
      link.onload = applyMotionClass;
      link.onerror = function () {
        warn('界面动效样式加载失败（不影响其它功能）');
      };
      (document.head || document.documentElement).appendChild(link);
      log('已加载界面动效层');
    } catch (e) {
      warn('安装界面动效失败：' + ((e && e.message) || e));
    }
  }

  /** 供设置面板的开关调用 */
  function setMotion(on) {
    lsSet(LS_MOTION, on ? 'true' : 'false');
    applyMotionClass();
  }

  /* ------------------------------------------------------------------------
   * 品牌外观层（localstore-brand.css）+ 开屏标语随机化
   *
   * 与动效层分开：动效可以被设置里的开关关掉，但「侧栏换成 logo」「鲸鱼图标」
   * 是外观本身，不该跟着动效开关一起消失，所以这一层**没有开关**。
   * ---------------------------------------------------------------------- */

  var BRAND_CSS_ID = 'localstore-brand-css';
  var BRAND_CLASS = 'ls-brand';

  function installBrand() {
    try {
      document.documentElement.classList.add(BRAND_CLASS);
      if (document.getElementById(BRAND_CSS_ID)) return;
      var link = document.createElement('link');
      link.id = BRAND_CSS_ID;
      link.rel = 'stylesheet';
      link.href = 'localstore-brand.css?v=' + BRIDGE_VERSION;
      link.onerror = function () {
        warn('品牌外观样式加载失败（不影响其它功能）');
      };
      (document.head || document.documentElement).appendChild(link);
      log('已加载品牌外观层');
    } catch (e) {
      warn('安装品牌外观失败：' + ((e && e.message) || e));
    }
  }

  /**
   * 开屏标语随机化。
   *
   * 官方的标语是 i18n 里的一条固定文案（zh: 今天有什么能帮到你？），由 React
   * 渲染成 `greeting-` 里的一个文本节点。
   *
   * ★ 不能只改那个文本节点的 nodeValue。
   *   实测：改完之后 React 的下一次渲染会把它**写回官方文案**（轮询了 7 秒，
   *   文本始终是原文，一次都没留住）。
   *   所以这里改成「**盖一层**」：给 greeting 加一个自己的类，用 CSS 把官方
   *   文字藏起来，再插入一个带 `data-ls-greeting` 的 span 承载随机文案。
   *   React 重渲染只会动它自己认识的那个文本节点，碰不到我们这个外来节点 ——
   *   只要它还在，就不再重复插入（用 MutationObserver 持续确认）。
   *
   * 时机：欢迎页只在「当前没有消息」时挂载，开新对话会重新走一遍。
   */
  var GREETING_SEL = '[class*="greeting-"]';
  /** 我们的文案节点标记 */
  var GREETING_ATTR = 'data-ls-greeting';
  /** 承载随机文案的类：CSS 里用它隐藏官方文本 */
  var GREETING_CLASS = 'ls-greeting-random';

  /* ------------------------------------------------------------------------
   * 侧栏左上角的「API 使用 demo」：从 DOM 与无障碍树里抹掉
   *
   * appName-ac14ac 是应用 i18n 里的 `appName`（zh: "API 使用 demo"、
   * en: "API usage demo"）。brand.css 用 font-size:0 + mask 把它换成 logo.svg，
   * **视觉上是干净的**，但文字节点还在：
   *   · document.body.innerText 里能读到；
   *   · 无障碍树里是一个可读名字（实测命中 2 个节点）；
   *   · 浏览器「页内查找」能搜到；
   *   · 图片没加载出来时会短暂露出原文。
   * 用户的原话是「初始化的时候似乎还有『API使用demo』这句话，你是不是没删干净」——
   * 所以这里把文本真正换掉，而不是只靠 CSS 藏。
   *
   * 为什么用 MutationObserver 反复写、而不是改一次：React 重渲染会把它写回原文
   * （和开屏标语是同一个坑，见上面的注释）。
   * logo 是纯 CSS 画的（mask + background-color），文案是什么都不影响外观，
   * 所以换成品牌名是安全的。
   * ---------------------------------------------------------------------- */
  var APP_NAME_SEL = '.appName-ac14ac';
  var APP_NAME_TARGET = 'DeepSeek';
  var appNameBusy = false;

  function applyAppName() {
    var el = document.querySelector(APP_NAME_SEL);
    if (!el) return false;
    var txt = (el.textContent || '').trim();
    // 已经是我们的文案就什么都不做；否则（官方原文 / React 又写回来了）重写。
    // 用「是不是目标文案」判断而不是「是不是旧文案」，这样多语言、
    // 官方以后改文案、React hydration 覆盖等情况下都能自愈。
    if (txt === APP_NAME_TARGET) return true;
    el.setAttribute('data-ls-appname', '1');
    el.textContent = APP_NAME_TARGET;
    return true;
  }

  /**
   * 节流调用：复用 watchMessages 那个已经在跑的全库 MutationObserver，
   * 不再单独挂一个 —— 每个 MutationObserver 都会在每次 DOM 变动时被唤醒，
   * 而聊天流式输出时变动是每帧都有的，多挂一个就是白白多一遍全树 querySelector。
   * 用 requestAnimationFrame 合并同一帧内的多次触发。
   */
  function scheduleAppName() {
    if (appNameBusy) return;
    appNameBusy = true;
    var run = function () {
      appNameBusy = false;
      try { applyAppName(); } catch (e) { /* ignore */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  /**
   * 随机池：**照抄用户逐字给出的候选**，不再拼接。
   *
   * 其中三条是「早上/下午/晚上好，…」的时段问候，前缀按时段替换
   * （凌晨/早上/中午/下午/晚上），保证不会出现「晚上好，今天有什么计划？」
   * 里那种实际时刻与问候不搭的别扭说法。
   */
  var GREETING_POOL = [
    '你好，有什么我能帮你的吗？',
    '你好，我能帮什么忙吗？',
    '你好，让我们开始聊天吧',
    '欢迎回来，想从哪里开始？',
    '欢迎回来，随时开始吧',
    '嗨！今天想聊些什么？',
    '随时开始吧',
    '今天有什么可以帮到你？'
  ];

  /** 带时段前缀的三条（前缀运行时替换） */
  var GREETING_TIMED = [
    '早上好，今天有什么计划？',
    '早上好，开始聊天吧',
    '早上好，今天想聊些什么？',
    '早上好，今天想做点什么？'
  ];

  /** 当前时段该用的问候前缀 */
  function timeOfDayGreeting() {
    var h = new Date().getHours();
    return h < 5 ? '凌晨好' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  }

  function pickGreeting() {
    try {
      // 一半概率用时段问候，一半用固定池 —— 开屏更有变化
      if (Math.random() < 0.5) {
        var timed = GREETING_TIMED[Math.floor(Math.random() * GREETING_TIMED.length)];
        // 把模板里的「早上好」换成当前时段
        return timeOfDayGreeting() + timed.slice(3);
      }
      return GREETING_POOL[Math.floor(Math.random() * GREETING_POOL.length)];
    } catch (e) {
      return GREETING_POOL[0];
    }
  }

  function applyGreeting() {
    var el = document.querySelector(GREETING_SEL);
    // 欢迎页可能还没挂载 / 已经进入对话
    if (!el) return false;
    el.classList.add(GREETING_CLASS);
    // 已经盖好就不再动（React 重渲染也不会碰这个外来节点）
    if (el.querySelector('[' + GREETING_ATTR + ']')) return true;
    var span = document.createElement('span');
    span.setAttribute(GREETING_ATTR, '1');
    span.textContent = pickGreeting();
    el.appendChild(span);
    log('开屏标语已随机化');
    return true;
  }

  function watchGreeting() {
    try {
      applyGreeting();
    } catch (e) {
      /* ignore */
    }
    // 持续确认：欢迎页每次重新挂载都补一次
    var obs = new MutationObserver(function () {
      try {
        applyGreeting();
      } catch (e) {
        /* ignore */
      }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  /**
   * 启动遮罩。
   *
   * 为什么需要：带 `#c=` 刷新时，应用在挂载阶段**一定**会先渲染一次空对话
   * （「今天有什么可以帮到你？」），我们只能在其后按 token 点回去。
   * 这段时间虽短（实测约 200~400ms），但足以让用户看到一次闪动。
   *
   * 遮罩用与应用一致的背景色铺满全屏，等恢复完成（或超时）后淡出，
   * 用户看到的就是「一直停在原来的对话上」。
   * 颜色跟随主题偏好，避免深色模式下反而闪白。
   */
  var BOOT_COVER_ID = 'localstore-boot-cover';

  function coverColor() {
    var pref = lsGet('chat-demo:theme-preference') || '';
    var prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = pref === 'dark' || (pref !== 'light' && prefersDark);
    return dark ? '#151517' : '#ffffff';
  }

  function showBootCover() {
    try {
      if (document.getElementById(BOOT_COVER_ID)) return;
      if (!document.body) return;
      var el = document.createElement('div');
      el.id = BOOT_COVER_ID;
      el.className = 'ls-boot-cover';
      el.style.background = coverColor();
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    } catch (e) {
      /* ignore */
    }
  }

  function hideBootCover() {
    try {
      var el = document.getElementById(BOOT_COVER_ID);
      if (!el) return;
      el.className = 'ls-boot-cover ls-boot-cover-gone';
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    } catch (e) {
      /* ignore */
    }
  }

  /** 最近一次按链接恢复的尝试，供诊断使用 */
  var lastRestoreAttempt = null;

  function restoreFromHash() {
    // 地址栏优先；地址栏被应用清掉后回退到启动时记下的那个
    var want = currentHashToken() || bootToken;
    if (!want) return false;

    var list = readSidebarSessions();
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].token === want) {
        target = list[i];
        break;
      }
    }
    if (!target) return false;
    if (target.active) {
      bootToken = null;
      return true; // 已经在看它了
    }

    // React 的事件处理是挂在节点上的（onClick 存在 __reactProps$ 里）。
    // 侧边栏的节点往往**先出现、后挂上处理函数**；这期间 click() 是空转，
    // 界面会先渲染成空对话，等到处理函数就绪才跳过去 —— 那就是用户看到的闪动。
    // 所以这里必须等到处理函数就绪再点，否则不如不点。
    var propsKey = null;
    var keys = Object.keys(target.el);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].indexOf('__reactProps$') === 0) {
        propsKey = keys[k];
        break;
      }
    }
    if (propsKey) {
      var props = target.el[propsKey];
      if (!props || typeof props.onClick !== 'function') return false;
    } else {
      return false; // 还没有任何 React 属性，说明确实太早了
    }

    log('按链接回到对话「' + target.title + '」');
    lastRestoreAttempt = { title: target.title, at: Date.now(), token: want };
    target.el.click();
    return true;
  }

  /**
   * 监视侧边栏：当前对话一变就更新地址栏。
   * 用轮询而不是 MutationObserver —— 侧边栏在流式回复时会频繁变动，
   * 观察者会被高频触发；而这里只需半秒级的跟随，轮询更稳也更省。
   */
  function watchDeepLink() {
    if (deepLinkTimer) clearInterval(deepLinkTimer);
    var lastToken = undefined;
    var restoring = false;
    var obs = null;
    var boot = null;

    /** 停止首次恢复的探测（观察器 + 兜底轮询） */
    function stopRestoreWatch() {
      if (boot) {
        clearInterval(boot);
        boot = null;
      }
      if (obs) {
        try {
          obs.disconnect();
        } catch (e) {
          /* ignore */
        }
        obs = null;
      }
    }

    function beginRestore(token) {
      bootToken = token;
      restoring = true;
      stopRestoreWatch();
      // 盖住「应用先渲染空对话」那一瞬间
      showBootCover();
      var coverDeadline = setTimeout(hideBootCover, 3000);

      function attempt() {
        var ok = false;
        try {
          ok = restoreFromHash();
        } catch (e) {
          /* ignore */
        }
        if (!ok) return false;
        stopRestoreWatch();
        bootToken = null;
        restoring = false;
        lastToken = undefined; // 让地址栏跟随重新对齐
        try {
          syncUrlToActiveSession();
        } catch (e) {
          /* ignore */
        }
        // 等一帧，让应用把目标对话画出来，再揭开遮罩
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            clearTimeout(coverDeadline);
            hideBootCover();
          });
        });
        return true;
      }

      // 侧边栏一渲染出来就立刻恢复，别等固定间隔。
      // 应用在约 230ms 渲染列表、约 430ms 才切到空对话，
      // 只有卡在两者之间动手才看不到闪动，所以用 MutationObserver 抢先一步。
      if (typeof MutationObserver === 'function') {
        obs = new MutationObserver(function () {
          attempt();
        });
        try {
          obs.observe(document.body, { childList: true, subtree: true });
        } catch (e) {
          obs = null;
        }
      }

      // 兜底轮询：列表早已渲染完（观察器错过时机）时也能收敛
      var tries = 0;
      boot = setInterval(function () {
        tries++;
        if (attempt()) return;
        if (tries >= 60) {
          // 恢复失败（对话可能已被删掉）：放开地址栏跟随并清掉失效的 hash
          stopRestoreWatch();
          bootToken = null;
          restoring = false;
          try {
            syncUrlToActiveSession();
          } catch (e) {
            /* ignore */
          }
          clearTimeout(coverDeadline);
          hideBootCover();
        }
      }, 100);
    }

    // 当前对话一变就更新地址栏
    deepLinkTimer = setInterval(function () {
      try {
        if (restoring) return; // 恢复期间不要覆盖带过来的 #c=
        var act = activeSession();
        var token = act ? act.token : null;
        if (token !== lastToken) {
          lastToken = token;
          setHashToken(token);
        }
      } catch (e) {
        /* ignore */
      }
    }, 500);

    // 用户手动改地址（粘贴一个链接）时，跟着跳过去
    window.addEventListener('hashchange', function () {
      try {
        var t = currentHashToken();
        if (!t) return;
        beginRestore(t);
      } catch (e) {
        /* ignore */
      }
    });

    // 首次进入：地址栏里带着 #c= 就先恢复
    var initial = currentHashToken();
    if (initial) beginRestore(initial);
  }

  // -------------------------------------------------------------------------
  // 启动
  // -------------------------------------------------------------------------

  /**
   * 自动刷新熔断器。
   *
   * boot 阶段有几处需要刷新页面才能让官方应用生效（回填设置 / 回填 Key /
   * 自动恢复对话）。这些刷新本应各只发生一次，但一旦某个判断写错就会变成
   * 死循环 —— 用户看到的就是「页面不停闪动，而且回到新对话」。
   *
   * 所以这里加一道闸门：短时间内只允许一次自动刷新。
   * 两次以上直接放弃刷新，改为记录日志，页面停在当前状态（总比闪个不停好）。
   */
  var RELOAD_GUARD_KEY = 'chat-demo:auto-reload-at';
  var RELOAD_GUARD_MS = 8000;

  function canAutoReload() {
    try {
      var last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
      if (last && Date.now() - last < RELOAD_GUARD_MS) return false;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      return true;
    } catch (e) {
      return true; // 拿不到 sessionStorage 就不拦
    }
  }

  /** 需要刷新页面才能让改动生效时的统一出口 */
  function requestReload(reason) {
    // 留一条带调用栈的痕迹，方便日后定位「是什么在刷新页面」
    try {
      if (window.__lsReloadLog) {
        window.__lsReloadLog.push({
          reason: reason,
          at: Date.now(),
          stack: String(new Error().stack || '').split('\n').slice(1, 5).join(' | ')
        });
      }
    } catch (e) {
      /* ignore */
    }
    if (!canAutoReload()) {
      warn('已阻止重复自动刷新（' + reason + '）：短时间内刷新过，为避免页面闪动而放弃');
      return false;
    }
    log('即将刷新页面：' + reason);
    location.reload();
    return true;
  }

  /* ------------------------------------------------------------------------
   * 功能扩展层（localstore-features.js / .css）
   *
   * 5 个附加功能（消息索引轨道、置顶对话、长消息折叠、粘贴转 .txt、搜索对话）
   * 全部放在独立文件里，由这里加载。为什么不在桥接层里直接写：
   *   1. 桥接层已经 5800 行了，再加功能会难以维护；
   *   2. 这些功能大量依赖应用的 hash 类名，属于「最容易随升级失效」的部分，
   *      单独成文件后，升级时只需检查这一个文件里的常量区；
   *   3. 它们和存档/上传主链路无关，独立加载失败也不能影响主功能 ——
   *      所以这里全部包在 try/catch 里，失败只记日志。
   *
   * 用 <script> 动态插入而不是 import：这一层要保持 ES5、无构建步骤，
   * 与其它 localstore-*.js 的形态一致（直接双击 index.html 也能跑）。
   * ---------------------------------------------------------------------- */

  var FEATURES_JS_ID = 'localstore-features-js';
  var FEATURES_CSS_ID = 'localstore-features-css';

  function installFeatures() {
    try {
      if (!document.getElementById(FEATURES_CSS_ID)) {
        var css = document.createElement('link');
        css.id = FEATURES_CSS_ID;
        css.rel = 'stylesheet';
        css.href = 'localstore-features.css?v=' + BRIDGE_VERSION;
        css.onerror = function () {
          warn('功能扩展样式加载失败（功能仍可用，只是没有样式）');
        };
        (document.head || document.documentElement).appendChild(css);
      }
      if (document.getElementById(FEATURES_JS_ID) || window.__lsFeatures) return;
      var js = document.createElement('script');
      js.id = FEATURES_JS_ID;
      js.src = 'localstore-features.js?v=' + BRIDGE_VERSION;
      js.async = false; // 保持执行顺序，别插到应用 bundle 后面去
      js.onerror = function () {
        warn('功能扩展脚本加载失败（5 个附加功能不可用，主功能不受影响）');
      };
      (document.head || document.documentElement).appendChild(js);
      log('已加载功能扩展层');
    } catch (e) {
      warn('安装功能扩展失败：' + ((e && e.message) || e));
    }
  }

  async function boot() {
    seedApiBase();
    installStyles();
    installMotion();
    installBrand();
    installFeatures();
    installIdbHook();
    installFetchHook();
    watchForSettings();
    watchMessages();
    watchSider();
    watchGreeting();
    installComposerOutsideClick();
    watchDeepLink();
    startFolderWatcher();
    // 单次请求 token 上限（用户可在设置里调低；默认按服务端硬上限 32768）
    loadRequestTokenLimit();
    // 反向同步：盯着文件夹，外部新增/修改的对话自动收进来。
    // 它自己会先取句柄再对齐，这里不 await，免得拖慢首屏。

    // 从文件夹恢复设置与 API Key（仅当浏览器里没有时才回填）
    try {
      var settingsRestored = await hydrateSettingsFromFolder();
      if (settingsRestored) {
        if (requestReload('从文件夹恢复了设置')) return;
      }
    } catch (e) {
      warn('恢复设置失败', e);
    }

    try {
      var restored = await hydrateKeyFromFolder();
      if (restored) {
        // 官方应用在启动时读取一次 apiKey，这里刷新让它生效
        if (requestReload('从文件夹恢复了 API Key')) return;
      }
    } catch (e) {
      warn('恢复 API Key 失败', e);
    }

    // 把文件夹里 / 应用里已有的 Key 收进提供方，避免设置面板显示为空、
    // 以及后续保存时用空 Key 覆盖掉可用的 Key（「Key 无效」的根因）。
    try {
      await syncKeyFromFolderToProvider();
      adoptKeyIntoActiveProvider();
    } catch (e) {
      warn('同步 API Key 到提供方失败', e);
    }

    // 之后持续对账：官方「数据管理」里的 Key 编辑框会直接写槽位，
    // 桥接层收不到通知，只能靠轮询把它采纳进当前提供方。
    startKeySync();

    if (supportsFs) {
      try {
        var root = await getRootHandle();
        if (root) {
          dirCache = root;
          var state = await ensurePermission(root, false);
          uiState.permission = state;
          log('已恢复文件夹句柄：' + (root.name || '') + '（权限：' + state + '）');
          if (state === 'granted') {
            // 全新浏览器（清空数据后重连）先把对话读回来，再对账，
            // 否则对账会把空库当成事实、把文件夹里的存档删掉。
            try {
              var restored = await autoRestoreAfterConnect();
              if (restored) {
                if (requestReload('自动恢复了对话')) return;
              }
            } catch (e) {
              warn('自动恢复对话失败：' + ((e && e.message) || e));
            }

            // 静默做一次对账，让文件夹与浏览器保持一致
            snapshot('boot')
              .then(function (r) {
                if (r) log('启动对账完成', r);
              })
              .catch(function (e) {
                warn('启动对账失败：' + ((e && e.message) || e));
              });
          }
        }
      } catch (e) {
        warn('恢复文件夹句柄失败', e);
      }
    }

    // 暴露一个调试/自动化接口，也方便日后写测试
    window.__localstore = {
      version: BRIDGE_VERSION,
      supportsFs: supportsFs,
      state: syncState,
      onSync: onSync,
      pickFolder: pickFolder,
      disconnect: disconnect,
      reconnect: reconnect,
      snapshot: snapshot,
      restoreFromFolder: restoreFromFolder,
      /** 首次连接后自动读回对话（仅全新浏览器会真正执行） */
      autoRestoreAfterConnect: autoRestoreAfterConnect,
      maybeAutoRestoreHistory: maybeAutoRestoreHistory,
      /** 反向同步（盯着文件夹收外部改动）—— 只读诊断 + 手动触发 */
      folderWatch: {
        state: watchState,
        prime: primeFolderWatcher,
        reconcile: reconcileFolderOnBoot,
        poll: pollFolderForChanges,
        start: startFolderWatcher,
        stop: stopFolderWatcher,
        /** 等「启动对齐 + 首轮排程」完成 */
        ready: watchReady
      },
      countLocalSessions: countLocalSessions,
      LS_HISTORY_SYNCED_AT: LS_HISTORY_SYNCED_AT,
      loadFromFolder: loadFromFolder,
      readManifest: readManifest,
      readAllSessions: readAllSessions,
      readAllFiles: readAllFiles,
      renderMarkdown: renderMarkdown,
      linearMessages: linearMessages,
      sessionToMirror: sessionToMirror,
      /** 同步刷新 React 更新（置顶行转发菜单时要用，见 findFlushSync 注释） */
      syncFlush: syncFlush,
    // 单次请求 token 上限：默认 32768（服务端硬上限），可在设置里调低
    tokenLimit: {
      get: function () { return reqTokenLimit || REQ_TOKEN_MAX; },
      set: setRequestTokenLimit,
      budget: effectiveTokenBudget,
      /** 服务端最近一次回报的精确 token 与上限 */
      serverFact: function () { return serverTokenFact; }
    },
    /** 取回最近一次被省略的完整原文 */
    exportTrimmedOriginal: exportStashed,
    lastTrimmedOriginal: function () {
      try { return lsGet(LS_LAST_TRIMMED) || ''; } catch (e) { return ''; }
    },
      /** 模型相关 */
      currentModel: currentModel,
      onModel: onModel,
      sniffState: sniffState,
      injectModelBadges: injectModelBadges,
      /** 设置区块挂载（scope 供测试注入隔离容器） */
      mountSection: mountSection,
      findMountContainer: findMountContainer,
      /** 提供方与模型 */
      getProviders: function () {
        var st = getProviders();
        return { list: st.list.map(cloneProvider), activeId: st.activeId };
      },
      getActiveProvider: function () {
        var p = getActiveProvider();
        return p ? cloneProvider(p) : null;
      },
      setActiveProvider: function (id) {
        var st = getProviders();
        st.activeId = id;
        saveProviders();
        applyActiveProvider(false);
        mountComposer();
      },
      /** 新增一个提供方（给 id 就沿用，否则自动生成） */
      addProvider: function (spec) {
        var st = getProviders();
        var p = cloneProvider(
          spec && typeof spec === 'object'
            ? spec
            : { id: '', name: '', baseURL: '', apiKey: '' }
        );
        if (!p.id) p.id = uid('custom');
        if (!p.name) p.name = p.id;
        p.baseURL = normalizeBase(p.baseURL);
        if (st.list.some(function (x) {
          return x.id === p.id;
        })) {
          return false; // 已存在就不重复加
        }
        st.list.push(p);
        saveProviders();
        return p.id;
      },
      updateProvider: function (id, patch) {
        var p = findProvider(id);
        if (!p) return false;
        if (patch && typeof patch === 'object') {
          Object.keys(patch).forEach(function (k) {
            if (k === 'models' && Array.isArray(patch.models)) p.models = patch.models.slice();
            else if (k === 'baseURL') p.baseURL = normalizeBase(patch[k]);
            else if (k in p) p[k] = patch[k];
          });
        }
        else return false;
        // 归一化后如果是空的，退回官方地址，避免存下一个不可用配置
        if (!p.baseURL) p.baseURL = p.builtin ? OFFICIAL_PROVIDER.baseURL : '';
        saveProviders();
        if (getProviders().activeId === id) applyActiveProvider(false);
        return true;
      },
      fetchModelsFor: fetchModelsFor,
      parseModelList: parseModelList,
      effectiveApiBase: effectiveApiBase,
      effectiveModel: effectiveModel,
      selectModel: function (providerId, model) {
        var st = getProviders();
        var p = findProvider(providerId);
        if (!p) return false;
        st.activeId = providerId;
        p.defaultModel = model;
        saveProviders();
        lsSet(LS_MODEL, model);
        applyActiveProvider(false);
        mountComposer();
        return true;
      },
      mountComposer: mountComposer,
      getComposerLabel: function () {
        var n = document.getElementById(COMPOSER_ID);
        return n ? n.getAttribute('data-ls-label') : null;
      },
      openComposerMenu: function (open) {
        composerState.open = !!open;
        renderComposerMenu();
      },
      RESET_PROVIDERS_FOR_TEST: function () {
        providersState = null;
      },
      /** API Key 对账（供测试直接驱动，正常由轮询触发） */
      reconcileKey: reconcileKey,
      startKeySync: startKeySync,
      refreshSettingsSection: refreshSettingsSection,
      OFFICIAL_PROVIDER: cloneProvider(OFFICIAL_PROVIDER),
      LS_MODEL: LS_MODEL,
      LS_PROVIDERS: LS_PROVIDERS,
      /** API Key 相关 */
      writeKeyToFolder: writeKeyToFolder,
      readKeyFromFolder: readKeyFromFolder,
      collectProviderKeys: collectProviderKeys,
      applyProviderKeys: applyProviderKeys,
      removeKeyFromFolder: removeKeyFromFolder,
      hydrateKeyFromFolder: hydrateKeyFromFolder,
      /** 设置项存文件夹 */
      writeSettingsToFolder: writeSettingsToFolder,
      readSettingsFromFolder: readSettingsFromFolder,
      restoreSettingsFromFolder: restoreSettingsFromFolder,
      hydrateSettingsFromFolder: hydrateSettingsFromFolder,
      collectSettings: collectSettings,
      SETTINGS_ALLOW: SETTINGS_ALLOW,
      /** 深链接：读侧边栏 / 按 hash 恢复 / 同步地址栏 */
      readSidebarSessions: readSidebarSessions,
      /**
       * 主动探测上传链路的哪一环断了。
       *
       * 排查「上传失败」时最麻烦的是：浏览器只给一个 `net::ERR_HTTP2_PROTOCOL_ERROR`，
       * 分不清是**预检**（OPTIONS）就断了，还是真正 POST 时断的，也分不清是否与
       * 文件大小/编码有关。这里按几条最小请求逐级试，把每一步的成败记下来。
       *
       * 全部用 1 字节的假文件，不会在你账号里留下任何东西。
       * 返回结果可直接复制。
       */
      probeUploads: function () {
        var p = getActiveProvider();
        var base = normalizeBase((p && p.baseURL) || '');
        var key = (p && String(p.apiKey || '').trim()) || String(lsGet(LS_APP_API_KEY) || '').trim();
        var steps = [];
        var blob = new Blob([new Uint8Array([120])], { type: 'text/plain' });

        function step(name, make) {
          var t0 = Date.now();
          return make().then(
            function (res) {
              steps.push({
                step: name, ok: true, http: res.status, ms: Date.now() - t0,
                note: res.status === 401 ? '到达服务器（Key 无效也算通）' : ''
              });
            },
            function (err) {
              steps.push({
                step: name, ok: false, ms: Date.now() - t0,
                error: String((err && err.message) || err)
              });
            }
          );
        }

        function form(bytes) {
          var fd = new FormData();
          fd.append('purpose', 'assistant');
          fd.append('file', new Blob([new Uint8Array(bytes)], { type: 'text/plain' }), 'probe.txt');
          return fd;
        }

        var url = base + '/anthropic/v1/files';

        return step('GET /models（无预检，作为基准）', function () {
          return fetch(base + '/models', { method: 'GET', headers: { Authorization: 'Bearer ' + key } });
        })
          .then(function () {
            return step('POST /files 1 字节 multipart（真实路径）', function () {
              return fetch(url, {
                method: 'POST',
                headers: { 'x-api-key': key, 'anthropic-beta': 'files-api-2025-04-14' },
                body: form([120])
              });
            });
          })
          .then(function () {
            return step('POST /files 64KB multipart（测大小）', function () {
              return fetch(url, {
                method: 'POST',
                headers: { 'x-api-key': key, 'anthropic-beta': 'files-api-2025-04-14' },
                body: form(new Array(65536).fill(65))
              });
            });
          })
          .then(function () {
            return step('POST /files 裸二进制（非 multipart，测编码）', function () {
              return fetch(url, {
                method: 'POST',
                headers: {
                  'x-api-key': key,
                  'anthropic-beta': 'files-api-2025-04-14',
                  'content-type': 'text/plain'
                },
                body: blob
              });
            });
          })
          .then(function () {
            var pass = steps.filter(function (s) {
              return s.ok;
            }).length;
            return {
              bridgeVersion: BRIDGE_VERSION,
              origin: location.origin,
              uploadUrl: url,
              keyHint: key ? key.slice(0, 7) + '…' + key.slice(-4) : '（无 Key）',
              steps: steps,
              report:
                'bridge v' + BRIDGE_VERSION +
                ' | 页面来源=' + location.origin +
                ' | ' + pass + '/' + steps.length + ' 步成功 | ' +
                steps.map(function (s) {
                  return s.step.split('（')[0] + ':' + (s.ok ? 'HTTP' + s.http : '✗' + (s.error || '').slice(0, 40));
                }).join(' | ')
            };
          });
      },
      /** 把用户填的地址归一化成裸根地址（去掉结尾的 /anthropic 与斜杠） */
      normalizeBase: normalizeBase,
      /** 界面动效开关（设置面板与测试都用它） */
      setMotion: setMotion,
      motionEnabled: motionEnabled,
      /** 上传诊断：返回版本、当前提供方与逐次尝试记录 */
      uploadLog: function () {
        var pf = uploadPreflight();
        var tries = uploadLog.filter(function (x) {
          return x.status === 'ok' || x.status === 'error';
        });
        return {
          bridgeVersion: BRIDGE_VERSION,
          preflight: pf,
          entries: uploadLog.slice(),
          /** 一句话结论，方便直接复制给他人 */
          report:
            'bridge v' +
            BRIDGE_VERSION +
            ' | 提供方=' +
            (pf.providerName || '无') +
            ' | 上传地址=' +
            pf.uploadUrl +
            ' | Key=' +
            (pf.hasProviderKey || pf.hasSlotKey ? pf.keyHint : '（无）') +
            ' | 尝试=' +
            tries.length +
            ' | 结果=' +
            (tries.length ? tries[tries.length - 1].error || ('HTTP ' + tries[tries.length - 1].http) : '从未上传过')
        };
      },
      lastRestoreAttempt: function () {
        return lastRestoreAttempt;
      },
      activeSession: activeSession,
      restoreFromHash: restoreFromHash,
      syncUrlToActiveSession: syncUrlToActiveSession,
      currentHashToken: currentHashToken,
      getOrCreateToken: getOrCreateToken,
      HASH_PREFIX: HASH_PREFIX,
      /** 仅供测试：注入一个模拟目录句柄 */
      __setRootHandleForTest: async function (handle) {
        // 真实的 FileSystemDirectoryHandle 可结构化克隆；测试用的模拟对象不行，
        // 所以这里容错：克隆失败也照样放进内存缓存，功能不受影响。
        try {
          await ownPut('root', handle);
        } catch (e) {
          warn('句柄无法持久化（测试替身属正常现象）：' + ((e && e.message) || e));
        }
        dirCache = handle;
        lsSet(LS_FOLDER, handle.name || 'test');
        emitSync();
        // 测试替身注入后也要把监看装上并**等它就绪**，
        // 否则测试会跟启动对齐对撞（断言跑在导入之前，看起来像功能没生效）
        startFolderWatcher();
        await watchReady();
      }
    };

    log('v' + BRIDGE_VERSION + ' 已加载（文件夹写入' + (supportsFs ? '可用' : '不可用') + '）');
  }

  /* ------------------------------------------------------------------------
   * 从 React 内部拿到 flushSync
   *
   * 为什么需要它：置顶小节里的行是**克隆**（没有 React fiber），所以它上面的
   * 「...」按钮点了没反应；我们只能把点击转发给真身那个按钮。
   * 但真身被 display:none 藏着，它量出来的矩形是 0×0，应用的浮层会把菜单
   * 摆到屏幕左上角（用户原话：「不是点不开，是位置不对」）。
   *
   * 办法是在点击前后**临时**把真身的 getBoundingClientRect 换成克隆按钮的矩形。
   * 难点在于 React 18 会把事件里的更新批处理，等事件处理结束才提交 ——
   * 那时我们已经把矩形还原了，应用量到的还是 0×0。
   *
   * 所以要用 flushSync 让这次点击的更新**同步**提交完。
   *
   * ReactDOM 没有暴露在 window 上（是 webpack 模块内部的），但每个 React
   * 根容器上都挂着 __reactContainer$xxx，顺着 fiber 能走到 root，
   * 从 root.stateNode 里可以取到 ReactDOM 的导出对象，里面有 flushSync。
   * 这条路要走通需要 DevTools 钩子或 production 下的真实 fiber ——
   * 拿不到就返回 null，功能层会退化成"菜单可能落在左上角"，不会崩。
   *
   * ⚠ 这是依赖 React 内部结构的做法。React 大版本升级可能失效，
   *   所以：整段包在 try/catch 里、拿不到就返回 null、
   *   调用方必须有退路。绝不能因为这条路断了就让"取消置顶"不可用。
   * ---------------------------------------------------------------------- */
  function findFlushSync() {
    try {
      if (typeof window.flushSync === 'function') return window.flushSync;
      // 找一个挂了 React 根容器的元素
      var nodes = document.querySelectorAll('body *');
      var rootKey = null;
      for (var i = 0; i < nodes.length && !rootKey; i++) {
        var ks = Object.keys(nodes[i]);
        for (var j = 0; j < ks.length; j++) {
          if (ks[j].indexOf('__reactContainer$') === 0) { rootKey = ks[j]; break; }
        }
      }
      if (!rootKey) return null;
      // 从任意一个 fiber 往上走到 root
      var fiberKey = null;
      var all = document.querySelectorAll('#root, #app, body > div, body > div *');
      for (var a = 0; a < all.length && !fiberKey; a++) {
        var ak = Object.keys(all[a]);
        for (var b = 0; b < ak.length; b++) {
          if (ak[b].indexOf('__reactFiber$') === 0) { fiberKey = ak[b]; break; }
        }
      }
      if (!fiberKey) return null;
      var fiberEl = null;
      for (var c = 0; c < all.length; c++) { if (all[c][fiberKey]) { fiberEl = all[c]; break; } }
      if (!fiberEl) return null;
      var f = fiberEl[fiberKey];
      var guard = 0;
      while (f && f.return && guard < 500) { f = f.return; guard += 1; }
      if (!f || !f.stateNode) return null;
      var exportsObj = f.stateNode.current || f.stateNode;
      if (typeof exportsObj.flushSync === 'function') return exportsObj.flushSync;
      return null;
    } catch (e) {
      return null;
    }
  }

  var flushSyncFn = null;
  /** 功能层用的同步刷新；拿不到返回 false，调用方自己兜底 */
  function syncFlush(fn) {
    if (!flushSyncFn) flushSyncFn = findFlushSync();
    if (!flushSyncFn) return false;
    try {
      flushSyncFn(fn);
      return true;
    } catch (e) {
      // flushSync 在某些时机（比如已经在渲染中）会抛错：退化成普通调用
      warn('flushSync 调用失败，改为普通调用', e);
      try { fn(); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot();
    });
  } else {
    boot();
  }
})();
