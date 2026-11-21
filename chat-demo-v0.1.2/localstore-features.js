/*!
 * localstore-features.js —— 在 DeepSeek chat-demo 构建产物之上叠加的 7 个功能。
 * 与 localstore-bridge.js 一样，是**独立于应用 bundle** 的旁路脚本：
 * 应用升级后只需要重新确认几个 hash 类名（见下面的常量区），功能不会全废。
 *
 * 七个功能：
 *   1. 消息索引轨道 —— 最右侧一列横线，一条线 = 一条用户提问，点击快速定位
 *   2. 置顶对话 —— 会话项「...」菜单里新增「置顶」，置顶项排到列表最前
 *   3. 长消息折叠 —— 发送的消息超过 8 行就折叠，展开/收起带动画
 *   4. 粘贴转 .txt —— 粘贴文本过大时自动收成 .txt 附件，可「粘贴原文至输入框」
 *   5. 关键词搜索对话 —— 侧栏搜索入口，搜标题与正文
 *   6. 对话内换模型 —— 每个对话各自记住自己用过的模型，切换回来自动恢复
 *   7. 版本角标 —— 被「修改过」的消息显示 <xx/xx>
 *
 * 设计约束（都是从老坑里总结出来的）：
 *   · 伪元素要显式写 display，否则计算值可能是 none（见 brand.css 的注释）。
 *   · 应用是 React 受控组件，直接改 DOM 会被下一次渲染冲掉 ——
 *     所以每个功能都做成「幂等 apply() + MutationObserver 重放」，
 *     不依赖一次性注入。
 *   · 自己造的元素全部带 `ls-` 前缀的 class，绝不与应用类名冲突。
 *   · 只用 opacity/transform 做动画，并尊重 prefers-reduced-motion。
 *   · localStorage 里只存「标题顺序」（LS_PIN），不存会话 id ——
 *     因为官方库里的会话 id 是每次新建才生成的 UUID，而侧栏的稳定标识是标题。
 *   · **applyAll 里每一步必须独立 try/catch**（见 step()），一个功能抛错
 *     不能连累后面的功能。
 *   · **每轮 apply 只做真正的改动**：无条件 appendChild 会造成
 *     「摘下来再插回去」的 DOM 变动，把桥接层 300ms 的防抖挂载饿死，
 *     后果是模型选择框整个消失（详见 applyAll / reorderIn 的注释）。
 */
(function () {
  'use strict';

  var VERSION = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (!s) {
        var all = document.querySelectorAll('script[src*="localstore-features.js"]');
        s = all.length ? all[all.length - 1].src : '';
      }
      var m = /[?&]v=([^&]+)/.exec(s || '');
      return m ? decodeURIComponent(m[1]) : 'dev';
    } catch (e) {
      return 'dev';
    }
  })();

  var LOG_PREFIX = '[lsfeat]';

  function log() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.log.apply(console, a);
    } catch (e) {
      /* ignore */
    }
  }

  function warn() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.warn.apply(console, a);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ *
   * 0. 应用侧选择器（全部来自对构建产物的实测）
   * ------------------------------------------------------------------ */

  var SEL = {
    sider: '.sider-ac14ac',
    siderListWrap: '.listWrap-ac14ac',
    newChatBtn: '.newChat-ac14ac',
    item: '.item-ff6fc9',
    itemTitle: '.title-ff6fc9',
    itemActive: '.active-ff6fc9',
    itemAction: '.action-ff6fc9',
    moreBtn: 'button[aria-label="更多"], button[aria-label="More"]',
    menu: '.menu-_5f384',
    menuOption: '.option-_5f384',
    menuDanger: '.danger-_5f384',
    // 消息区
    main: '.main-_9fdf5',
    scroller: '.container-_7ccaf',
    column: '.column-_7ccaf',
    userMsgBox: '.container-_4cfe7',
    userBubble: '.bubble-_4cfe7',
    asstMsg: '.message-e1faee',
    // 输入区
    composer: '[class*="functionRow-"]',
    toggles: '[class*="toggles-"]',
    composerRight: '[class*="right-"]',
    textarea: 'textarea.textarea-ed6f47, textarea[class*="textarea-"]',
    welcome: '.container-_1f155'
  };

  /** 按前缀找元素（应用类名带内容哈希，用前缀匹配更抗升级） */
  function byPrefix(root, prefix) {
    if (!root) return null;
    var all = root.querySelectorAll('[class*="' + prefix + '"]');
    return all.length ? all[0] : null;
  }

  /** 当前真实的侧栏（排除收起动画期间的替身） */
  function sider() {
    var s = typeof window.__localstore !== 'undefined' && window.__localstore.siderEl
      ? window.__localstore.siderEl()
      : document.querySelector(SEL.sider);
    return s || null;
  }

  /** 消息滚动容器 */
  function scroller() {
    var m = document.querySelector(SEL.main);
    if (!m) return null;
    var c = m.querySelector(SEL.scroller);
    if (c) return c;
    // 退路：main 里第一个 overflow 可滚动且高度够大的元素
    var all = m.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var cs = getComputedStyle(all[i]);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && all[i].clientHeight > 120) {
        return all[i];
      }
    }
    return null;
  }

  /** 消息列（所有消息的父节点，顺序 = 显示顺序） */
  function messageColumn() {
    var s = scroller();
    if (!s) return null;
    var c = s.querySelector(SEL.column);
    return c || null;
  }

  /** 收集当前显示的消息：{ el, role, index } 数组，顺序与界面一致
   *
   * `index` 是该消息在**全部消息**里的序号（从 1 开始），
   * 因为轨道可能只显示用户提问，但编号仍要对应用户看到的第几条。
   */
  function collectMessages() {
    var col = messageColumn();
    if (!col) return [];
    var out = [];
    var kids = col.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (!el.getBoundingClientRect) continue;
      var cls = String(el.className || '');
      var role = '';
      if (/message-/.test(cls)) role = 'assistant';
      else if (/container-/.test(cls) && el.querySelector(SEL.userBubble)) role = 'user';
      if (!role) continue;
      out.push({ el: el, role: role, index: out.length + 1 });
    }
    return out;
  }

  /* --------- 消息版本号（用户「修改过」的消息用 <xx/xx> 标出） ---------
   *
   * 应用的会话是一棵树：每条消息有 parentId，父节点用 selectedChildId 指向
   * 当前选中的那个孩子。同一父节点下的多个同角色孩子 = 同一条消息的多个版本
   * （用户点了「重新生成」或编辑后重发）。
   *
   * 版本号的语义（与网页端一致）：
   *   · 计算节点是「第几个孩子」时要按**该父节点下同角色的孩子**排序，
   *     因为一次编辑会同时产生新的 user 与 assistant 两个分支；
   *   · 只有在总数 > 1 时才显示，否则每条消息都挂个 <1/1> 太吵。
   */
  var versionState = { map: null, sessionKey: '', pending: '', currentChain: [] };

  function buildVersionMap(session) {
    var map = {};
    if (!session || !Array.isArray(session.messages)) return map;
    var msgs = session.messages;
    var byParent = {};
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m || m.id == null) continue;
      var p = m.parentId == null ? '__root__' : String(m.parentId);
      if (!byParent[p]) byParent[p] = [];
      byParent[p].push(m);
    }
    Object.keys(byParent).forEach(function (p) {
      var kids = byParent[p];
      // 同角色分组，组内按 createdAt 稳定排序（同一批次的顺序才可复现）
      var groups = {};
      kids.forEach(function (k) {
        var r = k.role || 'unknown';
        if (!groups[r]) groups[r] = [];
        groups[r].push(k);
      });
      Object.keys(groups).forEach(function (r) {
        var arr = groups[r].slice().sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        if (arr.length < 2) return; // 没得选，不显示
        arr.forEach(function (k, idx) {
          map[String(k.id)] = { pos: idx + 1, total: arr.length };
        });
      });
    });
    return map;
  }

  /** 取当前打开会话的版本表（同步，只用已缓存的那份） */
  function versionMap() {
    return versionState.map || {};
  }

  /**
   * 异步重算版本表。
   *
   * 数据来源全部走桥接层已经暴露的接口，不自己猜：
   *   · __localstore.activeSession()   → 当前打开的会话（含标题）
   *   · __localstore.readAllSessions() → 完整会话（含**全部**分支版本）
   *   · __localstore.linearMessages()  → 沿 selectedChildId 走出来的那条链
   *
   * DOM 里没有消息 id，所以「第几个 DOM 节点」= 「chain 的哪一项」这个
   * 位置对应关系就是唯一的抓手。链条顺序与界面渲染顺序一致（都是
   * linearMessages 的结果），所以按下标对齐是可靠的。
   */
  function refreshVersionMap() {
    var L = window.__localstore;
    if (!L || !L.readAllSessions || !L.activeSession || !L.linearMessages) return;
    var act = L.activeSession();
    if (!act || !act.title) return;

    var key = act.title;
    if (versionState.sessionKey === key && versionState.map) return;
    if (versionState.pending === key) return; // 同一会话不重复发请求

    versionState.pending = key;
    L.readAllSessions().then(function (sessions) {
      versionState.pending = '';
      var list = sessions || [];
      var found = null;
      for (var i = 0; i < list.length; i++) {
        if ((list[i].title || '') === act.title) { found = list[i]; break; }
      }
      if (!found) return;
      versionState.map = buildVersionMap(found);
      versionState.sessionKey = key;
      versionState.currentChain = L.linearMessages(found) || [];
      applyVersionBadges();
    }).catch(function () {
      versionState.pending = '';
    });
  }

  /**
   * 给消息打版本角标 `<xx/xx>`（幂等）。
   *
   * 用户用「修改过」指代这个：一条消息存在多个版本时，界面上会显示
   * `<1/3>` 这样的角标。只有一个版本时**不显示**，否则每条都挂个
   * `<1/1>` 太吵。
   *
   * 角标挂在消息节点末尾，用 .ls-ver 类；配合 CSS 的 ::before 画一条
   * 细分隔线，视觉上贴近网页端那种「版本切换器」的样子。
   */
  function applyVersionBadges() {
    var msgs = collectMessages();
    var map = versionState.map || {};
    var chain = versionState.currentChain || [];

    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var el0 = m.el;
      var node = chain[i];
      var info = node ? map[String(node.id)] : null;

      var olds = el0.querySelectorAll('.ls-ver');
      if (!info) {
        for (var k = 0; k < olds.length; k++) olds[k].remove();
        el0.classList.remove('ls-has-ver');
        continue;
      }

      var text = '<' + info.pos + '/' + info.total + '>';
      if (olds.length === 1 && olds[0].textContent === text) continue;
      for (var k2 = 0; k2 < olds.length; k2++) olds[k2].remove();

      var b = el('span', 'ls-ver', text);
      b.setAttribute('title', '第 ' + info.pos + ' 版，共 ' + info.total + ' 版');
      b.setAttribute('aria-label', '第 ' + info.pos + ' 版，共 ' + info.total + ' 版');
      el0.appendChild(b);
      el0.classList.add('ls-has-ver');
    }
  }

  /* ------------------------------------------------------------------ *
   * 1. 存储：置顶顺序
   * ------------------------------------------------------------------ */

  var LS_PIN = 'chat-demo:ls-pinned';
  var LS_PASTE = 'chat-demo:ls-pasted-texts';
  var LS_FEAT = 'chat-demo:ls-features';
  var LS_MODEL_MAP = 'chat-demo:ls-conv-models';
  /**
   * 首次安装时的默认模型快照。
   *
   * 为什么不直接用提供方的 defaultModel 当基准：桥接层的 selectModel 里有
   * `p.defaultModel = model`，用户每换一次模型就会把这个「默认值」改掉，
   * 基准值会跟着漂，于是新对话会继承上一个对话的模型（模型串味）。
   * 存一份快照就不会被后续换模型影响。
   */
  var LS_DEFAULT_MODEL = 'chat-demo:ls-default-model';

  function readJson(key, dflt) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return dflt;
      var v = JSON.parse(raw);
      return v == null ? dflt : v;
    } catch (e) {
      return dflt;
    }
  }

  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      warn('写入 localStorage 失败', key, e);
    }
  }

  /** 置顶的标题顺序数组（越靠前越置顶） */
  function readPins() {
    var v = readJson(LS_PIN, []);
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
  }

  function isPinned(title) {
    return readPins().indexOf(title) !== -1;
  }

  function togglePin(title) {
    var pins = readPins();
    var i = pins.indexOf(title);
    if (i === -1) pins.unshift(title);
    else pins.splice(i, 1);
    writeJson(LS_PIN, pins);
    return i === -1;
  }

  /** 功能开关（默认全开） */
  function featureOn(name) {
    var v = readJson(LS_FEAT, {});
    return v[name] === undefined ? true : !!v[name];
  }

  function setFeature(name, on) {
    var v = readJson(LS_FEAT, {});
    v[name] = !!on;
    writeJson(LS_FEAT, v);
  }

  /* ================================================================== *
   * 功能 6：对话内换模型（每个对话各自记住自己的模型）
   *
   * ⚠ 这里踩过一个很隐蔽的坑，记下来免得改回去：
   *
   * 最初是「监听模型变化 → 把当前对话的模型记下来」+「切换对话 → 恢复」。
   * 结果**两边互相打架**：切换对话时 applyConvModel 会 selectModel，
   * 这个动作本身又被当成「用户换了模型」记到**新对话**头上，
   * 于是切一次就把新对话的记忆写坏一次，来回切几次模型就彻底乱了
   * （实测：甲选 flash、乙选 reasoner，来回切一圈后乙变成了 flash）。
   *
   * 现在的做法把「谁触发的」这件事说清楚：
   *   · 用户点菜单里的模型 → 走 selectModel 包装（userPick=true）→ 才记录；
   *   · 我们自己恢复 → 走 restoreModel（userPick=false）→ 绝不记录。
   * 另外切换对话是一次性的：只在新对话「第一次出现」时恢复一次，
   * 而不是每次 Mutation 都比对。
   * ================================================================== */

  var convModel = {
    recorderBound: false,
    switchBound: false,
    origSelect: null,
    restoring: false,
    switching: false,
    pendingPick: null,
    activeTitle: null,
    switchTimer: null
  };
  /** 还没生成标题的新对话，用一个不会与标题冲突的键占位 */
  var NEW_CONV_KEY = '__新对话__';
  /** 刚被点的那个侧栏项标题（切换期间用它当 activeTitle，别等 DOM 跟上来） */
  var pendingSwitchTitle = null;

  function readConvModels() {
    var v = readJson(LS_MODEL_MAP, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function writeConvModel(title, model) {
    if (!title || !model) return;
    var m = readConvModels();
    if (m[title] === model) return;
    m[title] = model;
    writeJson(LS_MODEL_MAP, m);
  }

  /** 当前打开的对话标题；没有打开（新对话）时返回 null */
  function activeConversationTitle() {
    var L = window.__localstore;
    if (!L || !L.activeSession) return null;
    var act = L.activeSession();
    return act && act.title ? act.title : null;
  }

  /** 当前模型（以应用真正会用的那个为准） */
  function currentModel() {
    try {
      var v = localStorage.getItem('chat-demo:model');
      if (v && v.trim()) return v.trim();
    } catch (e) { /* ignore */ }
    var L = window.__localstore;
    return L && L.effectiveModel ? L.effectiveModel() : '';
  }

  /**
   * 接管 selectModel：包一层，区分「用户点的」和「我们恢复的」。
   * 应用侧（打包代码）发请求前会重读 chat-demo:model，而 selectModel
   * 会写这个键，所以只要写对就能真正换模型，不需要刷新页面。
   */
  function installModelRecorder() {
    if (convModel.recorderBound) return;
    var L = window.__localstore;
    if (!L || !L.selectModel) return;
    convModel.recorderBound = true;
    convModel.origSelect = L.selectModel;

    L.selectModel = function (providerId, model) {
      var out = convModel.origSelect.apply(L, arguments);
      try {
        // 我们主动恢复、或正在切换对话的过程中，一律不记录。
        //
        // ⚠ 这里就是之前那个 bug 的根因：点侧栏切换对话时，
        // 侧栏的 active 高亮**先**变、对话内容**后**加载，中间有一段
        // 「标题已经变了但消息还是旧的」的窗口。若在窗口里记录，
        // 就会把旧对话的模型写到新对话头上（实测切一圈后乙对话被写成 flash）。
        // 所以切换期间直接关掉记录，只认用户手动点菜单那一次。
        if (!convModel.restoring && !convModel.switching) {
          var title = convModel.pendingPick || activeConversationTitle() || NEW_CONV_KEY;
          writeConvModel(title, model);
        }
      } catch (e) { /* ignore */ }
      return out;
    };

    // 用户点菜单项换模型 → 记下「这一项属于哪个对话」，供上面记录时使用。
    // 用捕获阶段，抢在桥接层 chooseModel 的 stopPropagation 之前。
    document.addEventListener(
      'click',
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var item = t.closest('.ls-menu-item');
        if (!item) return;
        var model = (item.textContent || '').trim();
        if (!model) return;
        var conv = item.dataset.lsConv || activeConversationTitle() || NEW_CONV_KEY;
        // chooseModel 在同一个 tick 的后面才跑，所以记录动作要放到微任务之后
        setTimeout(function () {
          convModel.pendingPick = conv;
          try {
            var use = currentModel() || model;
            writeConvModel(conv, use);
          } finally {
            convModel.pendingPick = null;
          }
        }, 0);
      },
      true
    );
  }

  /**
   * 标记「正在切换对话」。
   *
   * 置位后 600ms 放开，窗口期内不记录任何模型变化 ——
   * 因为这段时间里侧栏的 active 高亮**先**变、对话内容**后**加载，
   * 中途的记录会把模型写到错误的对话上。
   *
   * ⚠ 这里**不要**改 convModel.activeTitle。
   * 踩过这个坑：若在这里就把 activeTitle 设成目标对话，applyConvModel
   * 稍后会发现「标题没变」而直接 return，模型永远不会恢复。
   * activeTitle 只在「已经按它做过处理」之后才更新。
   */
  function markSwitching() {
    convModel.switching = true;
    if (convModel.switchTimer) clearTimeout(convModel.switchTimer);
    convModel.switchTimer = setTimeout(function () {
      convModel.switching = false;
      // 尘埃落定：以 DOM 的最终状态为准再对一次账
      var title = activeConversationTitle() || NEW_CONV_KEY;
      if (title !== convModel.activeTitle) {
        convModel.activeTitle = title;
        applyModelForTitle(title);
      }
    }, 600);
  }

  /**
   * 「这个对话还没有记录时，该用哪个模型」的基准值。
   *
   * ⚠ 这是踩坑之后才加的。之前直接取 currentModel()，结果出现「模型串味」：
   * 在甲对话选了 v4-pro，切到从没打开过的乙对话时，乙就被登记成 v4-pro
   * —— 用户会以为「换了一次模型，所有对话都跟着变了」。
   *
   * 换成提供方的 defaultModel 也不行：桥接层的 selectModel 里有
   * `p.defaultModel = model`，所以每次换模型都会把这个「默认值」改掉，
   * 基准值跟着一起漂（调试时能看到基准值从 flash 变成 v4-pro）。
   *
   * 所以基准值必须是一个**不会被换模型影响的常量**：
   * 首次安装时把当时的默认模型记下来，之后一直用它。
   * 放在 localStorage 而不是常量里，是因为它依赖用户装的提供方配置。
   */
  function baselineModel() {
    var saved = '';
    try { saved = localStorage.getItem(LS_DEFAULT_MODEL) || ''; } catch (e) { saved = ''; }
    if (saved) return saved;

    var L = window.__localstore;
    var val = '';
    try {
      var st = L && L.getProviders ? L.getProviders() : null;
      if (st && st.list) {
        for (var i = 0; i < st.list.length; i++) {
          var p = st.list[i];
          if (p && (p.id === st.activeId || (p.builtin && !st.activeId)) && p.defaultModel) {
            val = p.defaultModel;
            break;
          }
        }
      }
    } catch (e2) { /* ignore */ }
    if (!val) val = currentModel();
    try { if (val) localStorage.setItem(LS_DEFAULT_MODEL, val); } catch (e3) { /* ignore */ }
    return val;
  }

  /**
   * 针对指定对话应用它的模型（有记录就恢复，没有就按基准值登记）。
   *
   * 「按标题做一次处理」这个动作是幂等的前提：调用方负责更新
   * convModel.activeTitle，避免同一对话被反复处理。
   */
  function applyModelForTitle(title) {
    if (!featureOn('modelMem') || !title) return;
    var m = readConvModels();
    if (m[title]) { restoreModel(m[title]); return; }
    // 新对话（还没标题）用当前模型，这样「先选模型再开始聊」是直觉的；
    // 已有标题但第一次打开的对话用稳定基准，避免串味。
    writeConvModel(title, title === NEW_CONV_KEY ? currentModel() : baselineModel());
  }

  /** 侧栏项被点 → 记下目标标题并标记切换中 */
  function installSwitchWatcher() {
    if (convModel.switchBound) return;
    convModel.switchBound = true;
    document.addEventListener(
      'click',
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var item = t.closest(SEL.item);
        if (!item) return;
        // 「...」按钮不切换对话，不算
        if (t.closest(SEL.itemAction)) return;
        pendingSwitchTitle = itemTitle(item) || null;
        // 立刻按「用户点的那个对话」切模型，不等 DOM 慢慢跟上。
        // 侧栏项标题就在手上，比之后再问 activeSession() 可靠得多。
        if (pendingSwitchTitle) applyModelForTitle(pendingSwitchTitle);
        markSwitching();
      },
      true
    );

    // 模型菜单项打上「属于哪个对话」的标记。
    //
    // 为什么需要：菜单内容是异步渲染也可能延迟一帧才出现，用「点的时候
    // 问一次 activeSession()」有竞态风险。菜单项是每次打开时新建的，
    // 建的时候把当时的对话标题刻上去，之后用户点它，归属就是确定的。
    document.addEventListener(
      'mouseover',
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var item = t.closest('.ls-menu-item');
        if (!item) return;
        if (!item.dataset.lsConv) {
          item.dataset.lsConv = activeConversationTitle() || NEW_CONV_KEY;
        }
      },
      true
    );
    // 菜单刚打开、鼠标还没移上去时也要有归属，所以点之前补一次
    document.addEventListener(
      'pointerdown',
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var item = t.closest('.ls-menu-item');
        if (item && !item.dataset.lsConv) {
          item.dataset.lsConv = activeConversationTitle() || NEW_CONV_KEY;
        }
      },
      true
    );
  }

  /**
   * 恢复某个对话的模型（不会触发记录）。
   *
   * ⚠ 顺序很关键，这里踩过一个坑：
   * 桥接层的 selectModel → applyActiveProvider 最后会执行
   *     if (p.defaultModel) lsSet(LS_MODEL, p.defaultModel)
   * 也就是说它会用**提供方自己的 defaultModel** 覆盖刚写进去的模型。
   * 而 selectModel(providerId, model) 里正好有一句 p.defaultModel = model，
   * 所以只要走 selectModel 就是安全的；但如果我们图省事只写
   * localStorage['chat-demo:model']，会被 applyActiveProvider 立刻冲掉 ——
   * 表现就是「切换对话后模型没恢复」。
   * 所以恢复必须走 selectModel，并且传对 providerId。
   */
  function restoreModel(model) {
    var L = window.__localstore;
    if (!L || !convModel.origSelect || !model) return false;
    if (currentModel() === model) return false;
    var st = L.getProviders ? L.getProviders() : null;
    var pid = (st && st.activeId) || (L.OFFICIAL_PROVIDER && L.OFFICIAL_PROVIDER.id) || 'builtin';
    convModel.restoring = true;
    try {
      convModel.origSelect.call(L, pid, model);
      return true;
    } catch (e) {
      warn('恢复对话模型失败', e);
      return false;
    } finally {
      // 恢复动作本身是同步写 localStorage 的，置位在下一轮事件循环再放开，
      // 这样任何由此引发的回调都不会被误记为用户选择。
      setTimeout(function () { convModel.restoring = false; }, 200);
    }
  }

  /**
   * 定期对账（由 applyAll 在每轮 Mutation 之后调用）。
   *
   * 正常路径是「点侧栏 → applyModelForTitle」，这里只兜住没被点到的情形：
   * 首屏直接落在某个对话上、深链接恢复、或者点的是「新对话」按钮。
   */
  function applyConvModel() {
    if (!featureOn('modelMem')) return;
    var title = activeConversationTitle() || NEW_CONV_KEY;

    if (convModel.activeTitle === null) {
      // 首次进入：登记现状，并恢复这个对话自己的模型
      convModel.activeTitle = title;
      applyModelForTitle(title);
      return;
    }

    // 正在切换对话时不抢跑，交给 markSwitching 的定时器/settle 后处理
    if (convModel.switching) return;
    if (title === convModel.activeTitle) return;
    convModel.activeTitle = title;
    applyModelForTitle(title);
  }

  /* ------------------------------------------------------------------ *
   * 2. DOM 工具
   * ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** 只创建一次：存在就返回旧的 */
  function ensure(parent, cls, tag) {
    if (!parent) return null;
    var found = parent.querySelector(':scope > .' + cls);
    if (found) return found;
    var e = el(tag || 'div', cls);
    parent.appendChild(e);
    return e;
  }

  function raf(fn) {
    return (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn);
  }

  /** 节流：同一帧内只跑一次 */
  function throttled(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      raf(function () {
        queued = false;
        try { fn(); } catch (e) { warn('任务出错', e); }
      });
    };
  }

  function svgIcon(pathD, size) {
    var s = size || 14;
    var wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrap.setAttribute('width', s);
    wrap.setAttribute('height', s);
    wrap.setAttribute('viewBox', '0 0 16 16');
    wrap.setAttribute('fill', 'none');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathD);
    p.setAttribute('fill', 'currentColor');
    wrap.appendChild(p);
    return wrap;
  }

  var ICON = {
    // 置顶（图钉）
    pin: 'M9.5 1.2a.8.8 0 0 1 1.13 0l4.17 4.17a.8.8 0 0 1-.57 1.37h-2.3l-2.6 2.6.4 2.03a.8.8 0 0 1-1.35.72L5.6 9.3l-3.1 3.1a.8.8 0 0 1-1.13-1.13l3.1-3.1L1.7 5.4a.8.8 0 0 1 .72-1.35l2.03.4 2.6-2.6V.97a.8.8 0 0 1 .23-.57z',
    unpin: 'M9.5 1.2a.8.8 0 0 1 1.13 0l4.17 4.17a.8.8 0 0 1-.57 1.37h-2.3l-2.6 2.6.4 2.03a.8.8 0 0 1-1.35.72L5.6 9.3l-3.1 3.1a.8.8 0 0 1-1.13-1.13l3.1-3.1L1.7 5.4a.8.8 0 0 1 .72-1.35l2.03.4 2.6-2.6V.97a.8.8 0 0 1 .23-.57zM2 14h12v1.2H2z',
    search: 'M6.8 1.6a5.2 5.2 0 0 1 4.11 8.39l3.55 3.55a.8.8 0 0 1-1.13 1.13l-3.55-3.55A5.2 5.2 0 1 1 6.8 1.6zm0 1.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z',
    left: 'M10.5 2.3a.8.8 0 0 1 0 1.13L5.93 8l4.57 4.57a.8.8 0 1 1-1.13 1.13L4.23 8.57a.8.8 0 0 1 0-1.13l5.14-5.14a.8.8 0 0 1 1.13 0z',
    chevron: 'M3.4 5.7a.8.8 0 0 1 1.13 0L8 9.17l3.47-3.47a.8.8 0 1 1 1.13 1.13L8.57 10.9a.8.8 0 0 1-1.13 0L3.4 6.83a.8.8 0 0 1 0-1.13z',
    close: 'M3.3 3.3a.8.8 0 0 1 1.13 0L8 6.87l3.57-3.57a.8.8 0 1 1 1.13 1.13L9.13 8l3.57 3.57a.8.8 0 1 1-1.13 1.13L8 9.13l-3.57 3.57a.8.8 0 0 1-1.13-1.13L6.87 8 3.3 4.43a.8.8 0 0 1 0-1.13z'
  };

  /* ================================================================== *
   * 功能 1：消息索引轨道（最右侧，点击定位）
   * ================================================================== */

  var RAIL_CLASS = 'ls-msg-rail';
  var railState = { msgCount: 0, entryKey: '', lastActive: -1, tipBound: false, entries: [] };

  function removeRail() {
    hideRailTip();
    var old = document.querySelectorAll('.' + RAIL_CLASS);
    for (var i = 0; i < old.length; i++) old[i].remove();
    railState.entries = [];
    railState.lastActive = -1;
  }

  /**
   * 建轨道。
   *
   * 用户要求：
   *   · 一条横线 = 一条**用户提问**（助手回答不进轨道）；
   *   · 不要框框；
   *   · 悬浮在这条线上时显示该条提问内容。
   *
   * entries 记录「第 n 条线 → 它在全部消息里的下标」，因为轨道过滤掉了
   * 助手消息，线序和消息序不再一一对应，点击定位必须用真实下标。
   */
  function buildRail(host, entries) {
    var rail = ensure(host, RAIL_CLASS);
    if (!rail) return null;
    rail.setAttribute('role', 'navigation');
    rail.setAttribute('aria-label', '提问索引');
    // 每次重建整条轨道（条目变化时最省心）
    rail.textContent = '';
    for (var i = 0; i < entries.length; i++) {
      (function (entry, order) {
        var b = el('button', 'ls-msg-rail__line');
        b.type = 'button';
        b.dataset.lsIndex = String(entry.index);
        b.dataset.lsOrder = String(order + 1);
        var label = (entry.ver ? entry.ver + ' ' : '') + previewOf(entry.el);
        b.setAttribute('aria-label', label);
        b.dataset.lsTip = label;
        b.dataset.lsTipPlace = 'right';
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          scrollToMessage(entry.index - 1);
        });
        rail.appendChild(b);
      })(entries[i], i);
    }
    return rail;
  }

  /* 轨道的悬浮提示统一走上面的通用 tooltip（showTip/hideTip/bindTips），
     不再单独维护一套 —— 之前那套 .ls-msg-tip 和搜索按钮的需求是重复的。 */
  function hideRailTip() { hideTip('rail'); }

  /** 取消息开头一段文字做提示 */
  function previewOf(node) {
    var t = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return '(空)';
    return t.length > 28 ? t.slice(0, 28) + '…' : t;
  }

  function scrollToMessage(idx) {
    var msgs = collectMessages();
    var target = msgs[idx];
    var sc = scroller();
    if (!target || !sc) return;
    // 用「消息相对滚动容器顶部的距离」算目标滚动量。
    // 实测这个算法与 offsetTop 完全一致（msg3: 212 == offsetTop 212），
    // 但它不依赖 offsetParent 是哪一层，更抗改版；而且不需要 scrollTop 归零，
    // 从任意位置点都能算对。
    //
    // 减去的 24 是「让目标再往上多留一点」。不能只减 12：
    // syncRailActive 判定「视口顶部那条」的阈值是 scrollTop + 8，
    // 如果目标只比视口顶低 12px，滚完之后的零头会把它推到阈值之外，
    // 高亮就落到上面一条线上了（实测点第 7 条、亮第 5 条）。
    // 留 24 之后目标比阈值低 16px，滚动误差吃不掉这个余量。
    var top = sc.scrollTop + (target.el.getBoundingClientRect().top - sc.getBoundingClientRect().top) - 24;
    smoothScrollTo(sc, top);
    highlight(target.el);
    // ⚠ 滚完必须再同步一次轨道高亮，而「滚完」不能用固定延时赌。
    //
    // 踩过的坑：原来写的是 setTimeout(syncRailActive, 900)。但应用用的是
    // 平滑滚动，实测无头 Chrome 下 3 秒都还没停；900ms 时滚动只走了一半，
    // syncRailActive 算出来的「视口顶部那条」还是**上面**的消息，于是
    // 点到第 7 条，高亮的却是第 5 条 —— 而且是最后一个 setTimeout 定死的，
    // 之后不再纠正。用户看到的就是「点了轨道但高亮位置不对」。
    railState.pendingTarget = idx + 1;
    railState.pinnedIndex = idx + 1;
    railState.settledAt = -1;   // 落点还没出来，先别做「用户滚走了」的判断
    scheduleRailSettle(sc);
  }

  /**
   * 先按「消息相对容器顶」的几何位置同步一次，再处理「点击定位」的收尾。
   *
   * 用户点击轨道后，目标消息会被滚到离容器顶约 24px 的位置 —— 而
   * syncRailActive 判定「顶部那条」的阈值是 scrollTop + 8。24 和 8 之间
   * 差的那 16px 是平滑滚动的取整误差吃不掉的，于是滚动一停、临时意图一清，
   * 高亮就掉回**上面一条**（实测点第 7 条、停在第 5 条）。
   *
   * 所以点击定位的结果要「钉住」：只要目标消息还在视口顶部附近，
   * 就一直高亮它对应的那条线；用户自己滚动超过一段距离后解除。
   */
  function syncRailActiveWithPin() {
    syncRailActive();
    var pin = railState.pinnedIndex;
    if (!pin) return;
    var sc = scroller();
    if (!sc) { railState.pinnedIndex = 0; return; }

    // ⚠ 不能用「目标消息离容器顶多远」判断是否解除。
    // 踩过的坑：目标在视口下方时 rel 是很负的数（实测 -938），
    // 从点击那一刻起就被判成「用户滚走了」，pin 立刻被清掉，
    // 等滚到位时已经没有 pin 可用了 —— 高亮又掉回上面那条。
    // 正确的判断是「用户自己滚了没有」：拿当前 scrollTop 和
    // 程序滚动落点比，差得远才是用户滚的。
    var anchor = railState.settledAt;
    if (anchor >= 0 && Math.abs(sc.scrollTop - anchor) > 120) {
      railState.pinnedIndex = 0;
      return;
    }

    var lines = document.querySelectorAll('.' + RAIL_CLASS + ' .ls-msg-rail__line');
    for (var j = 0; j < railState.entries.length; j++) {
      if (railState.entries[j].index === pin) {
        railState.lastActive = j;
        for (var k = 0; k < lines.length; k++) {
          lines[k].classList.toggle('is-active', k === j);
          lines[k].setAttribute('aria-current', k === j ? 'true' : 'false');
        }
        return;
      }
    }
  }

  /**
   * 等平滑滚动停下来，然后收尾（清掉 pendingTarget 并按实际位置同步）。
   *
   * 用「连续 6 帧没有 scroll 事件」判定停止，比 scrollend 兼容性好
   * （scrollend 是新事件，老 Chrome 没有），也比定时器可靠。
   */
  function scheduleRailSettle(sc) {
    if (railState.settleSeq === undefined) railState.settleSeq = 0;
    railState.settleSeq++;
    var mySeq = railState.settleSeq;
    var lastScrollTop = sc.scrollTop;
    var still = 0;
    var elapsed = 0;
    var STEP = 100;
    var MAX_MS = 4000;   // 兜底：再慢也不会超过这个时间

    var tick = function () {
      if (mySeq !== railState.settleSeq) return;   // 又点了一次，旧的作废
      if (railState.settledAt < 0) syncRailActiveWithPin();
      elapsed += STEP;
      var cur = sc.scrollTop;
      if (Math.abs(cur - lastScrollTop) < 1) still++;
      else still = 0;
      lastScrollTop = cur;
      syncRailActiveWithPin();
      if (still >= 6 || elapsed >= MAX_MS) {
        // 收尾：位置稳了，记下落点，清掉「目标是某条」的临时意图
        railState.pendingTarget = 0;
        railState.settledAt = sc.scrollTop;
        syncRailActiveWithPin();
        return;
      }
      setTimeout(tick, STEP);
    };
    setTimeout(tick, STEP);
  }

  /** 平滑滚动（尊重 reduced-motion） */
  function smoothScrollTo(sc, top) {
    var reduce = false;
    try {
      reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { /* ignore */ }
    try {
      sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    } catch (e) {
      sc.scrollTop = Math.max(0, top);
    }
  }

  function highlight(node) {
    try {
      node.classList.remove('ls-msg-flash');
      // 强制重排以便重复触发同一条
      void node.offsetWidth;
      node.classList.add('ls-msg-flash');
      // 1600ms：要长于「平滑滚动 + 用户看清」的时间，否则滚到位时高亮已经没了
      setTimeout(function () { node.classList.remove('ls-msg-flash'); }, 1600);
    } catch (e) { /* ignore */ }
  }

  /** 找出当前视口内最靠上的「用户提问」，高亮对应那条横线
   *
   *  ⚠ 这里必须用 offsetTop，不能用 getBoundingClientRect。
   *  折叠态消息被 max-height 裁掉了一大截，但**布局高度并没有变小**
   *  （内容仍然占据原来的空间，只是被 overflow 裁掉了），
   *  于是折叠后所有 rect 都上移，而 offsetTop 是稳定的。
   *  用 rect 算会出现「明明在最后一条，却高亮第 6 号」这种错位。
   *
   *  轨道只显示用户提问，所以要先把「当前最靠上的消息序号」算出来，
   *  再退到**不超过它的最后一条提问**。
   */
  function syncRailActive() {
    var msgs = collectMessages();
    var sc = scroller();
    var lines = document.querySelectorAll('.' + RAIL_CLASS + ' .ls-msg-rail__line');
    if (!sc || !msgs.length || !lines.length) return;

    var pos = sc.scrollTop + 8;
    var topMsg = -1;
    // 注意这里**不能 break**：下方还没被应用渲染出来的消息 offsetTop 可能是 0，
    // 一 break 就会把序号停在很靠前的位置，高亮跟着错。
    // 全部扫一遍，取「offsetTop <= pos 的最大序号」。
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].el.offsetTop <= pos && i + 1 > topMsg) topMsg = i + 1;
    }

    // 正在滚向某条消息时，按那条算：平滑滚动途中视口顶部还在上面，
    // 不这样会在动画过程中闪到别的线上。
    if (railState.pendingTarget) topMsg = railState.pendingTarget;

    // 找出「消息序号 <= topMsg」的最后一条提问在轨道里的位置
    var best = 0;
    for (var j = 0; j < railState.entries.length; j++) {
      if (railState.entries[j].index <= topMsg) best = j;
      else break;
    }

    if (best === railState.lastActive) return;
    railState.lastActive = best;
    for (var k = 0; k < lines.length; k++) {
      lines[k].classList.toggle('is-active', k === best);
      lines[k].setAttribute('aria-current', k === best ? 'true' : 'false');
    }
  }

  /**
   * 轨道条目 = 用户提问（助手回答不进轨道，这是用户明确要求的）。
   * 每条带：真实消息下标 index、DOM 节点 el、可选版本角标 ver。
   */
  function railEntries(msgs) {
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== 'user') continue;
      out.push({
        index: msgs[i].index,
        el: msgs[i].el,
        // 用户在界面上把「重新生成／编辑重发」叫做**修改过**，
        // 这类消息在轨道上把版本号一起带出来，方便直接跳到某一版
        ver: versionTextOf(msgs[i].el)
      });
    }
    return out;
  }

  /** 读某条消息上的版本角标文案（没有则空串） */
  function versionTextOf(el0) {
    var v = el0.querySelector('.ls-ver');
    return v ? (v.textContent || '').trim() : '';
  }

  function applyMessageRail() {
    if (!featureOn('rail')) { removeRail(); return; }
    var msgs = collectMessages();
    var host = document.querySelector(SEL.main);
    if (!host) { removeRail(); return; }
    var entries = railEntries(msgs);
    if (!entries.length) { removeRail(); return; }
    // 条目没变就不重建（避免每次 Mutation 都重排一遍）
    var key = entries.map(function (e) { return e.index + (e.ver || ''); }).join(',');
    var rail = host.querySelector('.' + RAIL_CLASS);
    if (rail && railState.entryKey === key &&
        rail.querySelectorAll('.ls-msg-rail__line').length === entries.length) {
      syncRailActiveWithPin();
      return;
    }
    // 挂载点：main 是 position:relative，可以承载绝对定位的轨道
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    rail = buildRail(host, entries);
    railState.entries = entries;
    railState.entryKey = key;
    railState.msgCount = msgs.length;
    railState.lastActive = -1;
    if (rail) {
      // 悬浮提示：走通用 tooltip（带 data-ls-tip 的元素自动生效）
      rail.setAttribute('data-ls-tip-owner', 'rail');
      bindTips(rail, 'lsTipBound');
      // 入场动画
      rail.classList.add('ls-msg-rail--in');
      requestAnimationFrame(function () { rail.classList.add('ls-msg-rail--shown'); });
    }
    syncRailActiveWithPin();
  }

  /* ================================================================== *
   * 功能 2：置顶对话
   * ================================================================== */

  var PIN_CLASS = 'ls-pin-option';
  var PINNED_CLASS = 'ls-pinned';
  var PIN_BADGE = 'ls-pin-badge';

  /** 会话项标题（trim 过的） */
  function itemTitle(it) {
    var t = it.querySelector(SEL.itemTitle);
    return t ? (t.textContent || '').trim() : '';
  }

  /** 往弹出菜单里补一条「置顶 / 取消置顶」 */
  function decorateMenu(menu) {
    if (!menu || menu.querySelector('.' + PIN_CLASS)) return;
    var first = menu.querySelector(SEL.menuOption);
    if (!first) return;
    var title = menuTitleOf(menu);
    var pinned = title ? isPinned(title) : false;

    var opt = el('div', 'option-_5f384 ' + PIN_CLASS);
    opt.setAttribute('role', 'menuitem');
    opt.tabIndex = 0;
    var ic = el('span', 'icon-_5f384');
    ic.appendChild(svgIcon(pinned ? ICON.unpin : ICON.pin, 16));
    opt.appendChild(ic);
    opt.appendChild(document.createTextNode(pinned ? '取消置顶' : '置顶'));
    opt.dataset.lsPinFor = title || '';

    var activate = function (ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      var t = opt.dataset.lsPinFor;
      if (!t) return;
      var nowPinned = togglePin(t);
      log((nowPinned ? '已置顶' : '已取消置顶') + '：' + t);
      closeMenu();
      refreshPinOrder();
    };
    opt.addEventListener('click', activate);
    opt.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
    });

    // 插到最前面（重命名/删除之前）
    menu.insertBefore(opt, first);
  }

  /** 菜单弹出时，它属于哪个会话？
   *  菜单是挂在 body 下的浮层，靠位置与「当前 hover / 激活的会话项」对应。
   *  实测：菜单 left/top 是相对触发按钮的，所以用「点开时记住的项」最可靠。 */
  var lastMenuOwner = null;

  function menuTitleOf() {
    if (lastMenuOwner && document.contains(lastMenuOwner)) {
      var t = itemTitle(lastMenuOwner);
      if (t) return t;
    }
    // 退路：当前 hover 的会话项，或激活项
    var hov = document.querySelector(SEL.item + ':hover');
    if (hov) return itemTitle(hov);
    var act = document.querySelector(SEL.item + '.' + SEL.itemActive.split('.').pop());
    return act ? itemTitle(act) : '';
  }

  function closeMenu() {
    // 点空白关掉官方菜单（它自己监听 document，这里只补一次 Esc）
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) { /* ignore */ }
    lastMenuOwner = null;
  }

  /**
   * 置顶分节：置顶的对话集中到列表最上面的「置顶」小节里，
   * 表现上和「今天 / 昨天 / 30 天内」这些小标题完全一样，
   * 置顶项之间按**最后一条消息的时间**倒序（最新的在最上面）。
   *
   * 为什么不在原分节里把置顶项提到最前（旧做法）：
   * 用户要的是「相当于一个新的日期分组」，所以必须是一个独立小节。
   *
   * 为什么用克隆而不是搬运真身：
   * 侧栏是 React 渲染的，把 React 自己的节点搬进我们造的容器里，
   * 下一次渲染 React 会按它自己的顺序 `insertBefore` 回来 —— 搬过去又被搬回来，
   * 每帧一次 DOM 变动，会把桥接层 300ms 的防抖挂载饿死
   * （这个死循环踩过一次，后果是模型选择框整个消失）。
   * 所以真身留在原处、我们把它 `display:none` 藏起来占位，
   * 置顶小节里放**不带 React 属性的克隆**（可用 cloneNode(false)+自建节点，
   * 或直接 cloneNode(true) 后清掉 _reactFiber），点它们由我们自己接管跳转。
   */
  var PIN_SECTION = 'ls-pin-section';
  var PIN_HIDDEN = 'ls-pin-hidden';
  var PIN_CLONE = 'ls-pin-clone';
  /** 分节标题文案（i18n：应用是 zh-CN / en-US 两套） */
  var PIN_LABEL = (function () {
    try {
      var loc = localStorage.getItem('chat-demo:locale') || '';
      if (/^en/i.test(loc)) return 'Pinned';
    } catch (e) { /* ignore */ }
    return '置顶';
  })();
  /** 收起后的文案：{n} 会被替换成置顶对话的条数 */
  var PIN_LABEL_COUNT = (function () {
    try {
      var loc = localStorage.getItem('chat-demo:locale') || '';
      if (/^en/i.test(loc)) return ' {n} conversations';
    } catch (e) { /* ignore */ }
    return '{n} 个对话';
  })();
  var pinnedState = { times: null, lastKey: '', pinnedCount: -1, handlerBound: false, storeBound: false, animating: false };

  /* --------- 「置顶」小节的展开 / 收起 ---------
   *
   * 用户要求：整行标题都能点，旁边有个类似 ^ 的符号，
   * 收起后标题显示「置顶 N 个对话」，展开/收起要有动画。
   *
   * 动画为什么用 Web Animations API 而不是 CSS transition：
   *   · 内容高度是变的（置顶项数量、标题换行都会变），CSS transition 需要
   *     一个写死的 max-height；写大了动画会"卡一下再动"，写小了内容被裁。
   *   · 收起时需要从「当前实际高度」动画到 0，CSS 做不到（auto 不能过渡）。
   *   · WAAPI 的 animate() 播完自动回到样式表状态（不加 fill:'forwards'），
   *     所以不会留下任何内联样式污染后续测量 —— 这点很重要，
   *     因为 renderPinnedSection 每轮 Mutation 都会跑。
   */
  var PIN_HEAD = 'ls-pin-head';
  var PIN_BODY = 'ls-pin-body';
  var PIN_TEXT = 'ls-pin-text';
  var PIN_COUNT = 'ls-pin-count';
  var PIN_CHEV = 'ls-pin-chev';
  var PIN_COLLAPSED = 'is-collapsed';
  var PIN_ANIM_CLASS = 'ls-pin-anim';
  var LS_PIN_OPEN = 'chat-demo:ls-pin-open';

  function pinnedExpanded() {
    // 默认展开（用户第一次用置顶时应该是看得到内容的）
    return readJson(LS_PIN_OPEN, true) !== false;
  }

  function setPinnedExpanded(open) {
    writeJson(LS_PIN_OPEN, !!open);
  }

  /** 「^」符号：用一条折线自绘，颜色跟随文字，靠 transform 翻转 */
  function buildPinChevron() {
    var wrap = el('span', PIN_CHEV);
    wrap.setAttribute('aria-hidden', 'true');
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    var path = document.createElementNS(NS, 'path');
    // 一个朝上的「^」；收起时整体旋转 180° 变成朝下
    path.setAttribute('d', 'M3.6 9.8 8 5.4l4.4 4.4');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
  }

  /** 收起 / 展开置顶小节的正文（带高度动画）
   *
   * 动画做在 .ls-pin-body 这个包裹层上，而不是整个 section：
   * 收起态是 display:none，指望"临时放开再量"既容易量错（父级被裁剪时
   * 高度会算成 0）又会闪一下。有了包裹层就可以很干净地：
   *   1. 量 A = body 当前高度（展开态）
   *   2. 量 B = 收起后再展开的高度（把 display:none 摘掉测一次，再戴回去）
   * 然后用 WAAPI 从 A 动到 B（或反过来）。
   */
  function animatePinSection(section, open) {
    var body = section.querySelector(':scope > .' + PIN_BODY);
    if (!body) return;
    if (!section.animate || !body.getBoundingClientRect) {
      section.classList.toggle(PIN_COLLAPSED, !open);
      return;
    }

    var origOpenH = 0;
    var collapsedH = 0;
    var curH = Math.round(body.getBoundingClientRect().height);

    // 目标高度：先把「收起」的类摘掉量一次完整高度
    var wasCollapsed = section.classList.contains(PIN_COLLAPSED);
    section.classList.remove(PIN_COLLAPSED);
    origOpenH = Math.round(body.getBoundingClientRect().height);
    if (wasCollapsed) section.classList.add(PIN_COLLAPSED);

    var from = open ? curH : origOpenH;
    var to = open ? origOpenH : 0;
    if (from === to) return;

    var reduce = false;
    try {
      reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { /* ignore */ }

    // 先切到目标态，动画负责补上中间的位移
    section.classList.toggle(PIN_COLLAPSED, !open);
    section.classList.add(PIN_ANIM_CLASS);
    body.style.overflow = 'hidden';

    var done = function () {
      section.classList.remove(PIN_ANIM_CLASS);
      body.style.height = '';
      body.style.overflow = '';
      body.style.opacity = '';
      pinnedState.animating = false;
    };

    if (reduce) { done(); return; }

    pinnedState.animating = true;
    var anim = body.animate(
      [
        { height: from + 'px', opacity: open ? 0 : 1 },
        { height: to + 'px', opacity: open ? 1 : 0 }
      ],
      {
        duration: 260,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        // 显式声明不加 fill：播完自动回到样式表状态，
        // 不留内联样式 —— 这点很重要，renderPinnedSection 每轮 Mutation 都会跑
        fill: 'none'
      }
    );
    try {
      anim.addEventListener('finish', done);
      anim.addEventListener('cancel', done);
    } catch (e) {
      setTimeout(done, 300);
    }
  }


  /**
   * 清掉克隆节点上的 React 内部属性。
   *
   * cloneNode(true) 会**浅拷贝** React 挂在 DOM 上的那些 `__reactFiber$xxx` /
   * `__reactProps$xxx` 键（它们是元素的自有属性，会被复制）。
   * 带着这些属性的克隆一旦被 React 的事件系统扫到，React 会拿它去对应
   * fiber 上找 props，结果是「点克隆触发了别人的 onClick」或者直接报错。
   * 所以克隆之后必须把这些键删干净，让它变成一个普通的 DOM 节点，
   * 交互全部由我们自己接管。
   */
  function notReactOwned(node) {
    try {
      var walk = [node];
      while (walk.length) {
        var cur = walk.pop();
        if (!cur || cur.nodeType !== 1) continue;
        var keys = Object.keys(cur);
        for (var i = 0; i < keys.length; i++) {
          if (/^__react/.test(keys[i])) {
            try { delete cur[keys[i]]; } catch (e) { /* ignore */ }
          }
        }
        var kids = cur.children;
        for (var k = 0; k < kids.length; k++) walk.push(kids[k]);
      }
    } catch (e) { /* ignore */ }
  }

  /** 会话的最后活动时间（用于置顶排序）。
   *
   * 取 sessionSummaries.updatedAt：它就是应用自己用来排「今天/昨天」的时间，
   * 发送或收到消息后都会更新，语义上等于「最后一条消息的时间」。
   * 结果缓存在 pinnedState.times 里，避免每轮 Mutation 都读一次库；
   * 桥接层每次写完存档会调 invalidatePinTimes() 让它失效。
   */
  function readSessionTimes() {
    if (pinnedState.times) return pinnedState.times;
    var L = window.__localstore;
    var out = [];
    try {
      if (L && L.readAllSessions) {
        L.readAllSessions().then(function (sessions) {
          var list = [];
          for (var i = 0; i < (sessions || []).length; i++) {
            var s = sessions[i];
            if (!s || !s.title) continue;
            var last = 0;
            if (Array.isArray(s.messages) && s.messages.length) {
              for (var k = 0; k < s.messages.length; k++) {
                var t = s.messages[k] && s.messages[k].createdAt;
                if (typeof t === 'number' && t > last) last = t;
              }
            }
            if (!last) last = s.updatedAt || s.createdAt || 0;
            list.push({ title: s.title, last: last });
          }
          pinnedState.times = list;
          // 时间到了 → 重新排一次（下一轮 apply 会用到）
          scheduleApply();
        })['catch'](function () {});
      }
    } catch (e) { /* ignore */ }
    return pinnedState.times || out;
  }

  /** 存档变了 → 时间缓存作废 */
  function invalidatePinTimes() {
    pinnedState.times = null;
  }

  /**
   * 监听桥接层广播的「存档变了」。
   *
   * 置顶小节的顺序依赖「最后一条消息的时间」（来自 IndexedDB），
   * 发消息 / 收到回复 / 删除对话之后都要重排，否则排序会停在旧状态。
   * 桥接层在 IndexedDB 事务提交后派发 localstore-changed。
   */
  function installStoreWatcher() {
    if (pinnedState.storeBound) return;
    pinnedState.storeBound = true;
    document.addEventListener('localstore-changed', function () {
      invalidatePinTimes();
    });
  }

  function pinnedSortValue(title) {
    var list = readSessionTimes();
    for (var i = 0; i < list.length; i++) {
      if (list[i].title === title) return list[i].last;
    }
    // 拿不到时间就沉到最下面（但仍排在未置顶项之前）
    return 0;
  }

  /** 建/更新「置顶」小节 */
  function renderPinnedSection(s, pins) {
    var listEl = s.querySelector(SEL.siderListWrap + ' [class*="list-"]') ||
                 s.querySelector(SEL.siderListWrap);
    if (!listEl) return;
    var byTitle = {};
    var all = s.querySelectorAll(SEL.item);
    for (var i = 0; i < all.length; i++) byTitle[itemTitle(all[i])] = all[i];

    // 只保留「还有对应会话项」的置顶标题，并按最后消息时间倒序
    var have = [];
    for (var p = 0; p < pins.length; p++) {
      if (byTitle[pins[p]]) have.push(pins[p]);
    }
    have.sort(function (a, b) {
      var ta = pinnedSortValue(a);
      var tb = pinnedSortValue(b);
      if (tb !== ta) return tb - ta;          // 新的在前
      return pins.indexOf(a) - pins.indexOf(b); // 时间相同就保持用户置顶的先后
    });

    var section = listEl.querySelector(':scope > .' + PIN_SECTION);
    var key = have.join('\u0001');

    if (!have.length) {
      // 没有置顶项：把小节和隐藏标记都撤掉
      if (section) section.remove();
      var hid = listEl.querySelectorAll('.' + PIN_HIDDEN);
      for (var h = 0; h < hid.length; h++) hid[h].classList.remove(PIN_HIDDEN);
      pinnedState.lastKey = '';
      return;
    }

    if (!section) {
      section = el('div', 'section-ac14ac ' + PIN_SECTION);
      // 标题节点照抄真实分节的 class，保证观感一致
      var refHeader = listEl.querySelector('[class*="sectionHeader-"]');
      var head = el('div', refHeader ? refHeader.className : 'sectionHeader-ac14ac');
      head.classList.add(PIN_HEAD);
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.appendChild(el('span', PIN_TEXT, PIN_LABEL));
      head.appendChild(el('span', PIN_COUNT));
      head.appendChild(buildPinChevron());
      section.appendChild(head);
      listEl.insertBefore(section, listEl.firstChild);
    }

    // 标题文案：展开时「置顶」，收起时「置顶 N 个对话」——用户明确要求
    var isOpen = pinnedExpanded();
    section.classList.toggle(PIN_COLLAPSED, !isOpen);
    var headEl = section.querySelector('.' + PIN_HEAD);
    if (headEl) {
      headEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      headEl.setAttribute('aria-label', isOpen ? '收起置顶对话' : '展开置顶对话');
      var txt = headEl.querySelector('.' + PIN_TEXT);
      var cnt = headEl.querySelector('.' + PIN_COUNT);
      if (txt) txt.textContent = PIN_LABEL;
      if (cnt) cnt.textContent = isOpen ? '' : ' ' + PIN_LABEL_COUNT.replace('{n}', have.length);
    }

    // 顺序没变也要继续往下走：隐藏状态和克隆内容每轮都要保证正确
    pinnedState.lastKey = key;

    // 需要隐藏哪些：所有置顶项的真身
    var want = {};
    for (var w = 0; w < have.length; w++) want[have[w]] = true;
    for (var t in byTitle) {
      if (!Object.prototype.hasOwnProperty.call(byTitle, t)) continue;
      byTitle[t].classList.toggle(PIN_HIDDEN, !!want[t]);
      byTitle[t].classList.remove(PINNED_CLASS);
    }

    // 用克隆填满置顶小节的正文层（React 不认识这些克隆，不会碰它们）
    var body = section.querySelector(':scope > .' + PIN_BODY);
    if (!body) {
      body = el('div', PIN_BODY);
      section.appendChild(body);
    }
    var existing = body.querySelectorAll(':scope > ' + SEL.item);
    for (var e2 = 0; e2 < existing.length; e2++) existing[e2].remove();
    for (var c = 0; c < have.length; c++) {
      var real = byTitle[have[c]];
      var clone = real.cloneNode(true);
      notReactOwned(clone);
      // 真身被我们藏起来了，克隆自己不能带这两个类
      clone.classList.remove(PIN_HIDDEN, PINNED_CLASS);
      clone.classList.add(PINNED_CLASS, PIN_CLONE);
      clone.dataset.lsPinTitle = have[c];
      body.appendChild(clone);
    }
  }

  function scheduleApply() {
    if (typeof applyAll === 'function') applyAll();
  }

  /**
   * 「置顶」小节里的克隆项：交互由我们自己接管。
   *
   * 克隆清掉了 React 属性，所以点击不会自动打开对话，必须显式处理：
   *   · 点标题 / 空白 → 打开对应对话（走 openSessionByTitle）
   *   · 「...」按钮 → 打开应用自己的菜单（它由应用挂在 body 上）
   * 用一次文档级委托就够了，不用给每个克隆单独绑。
   */
  function installPinCloneHandler() {
    if (pinnedState.handlerBound) return;
    pinnedState.handlerBound = true;

    // 「置顶」标题整行可点：切换展开/收起
    var toggle = function (ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      var head = ev && ev.target && ev.target.closest ? ev.target.closest('.' + PIN_HEAD) : null;
      var section = head ? head.parentNode : document.querySelector('.' + PIN_SECTION);
      if (!section || pinnedState.animating) return;
      var open = section.classList.contains(PIN_COLLAPSED);   // 现在是收起 → 要展开
      setPinnedExpanded(open);
      animatePinSection(section, open);
      // 标题文案要立刻换（动画是正文的事，标题不该等）
      var headEl = section.querySelector('.' + PIN_HEAD);
      if (headEl) {
        headEl.setAttribute('aria-expanded', open ? 'true' : 'false');
        var txt = headEl.querySelector('.' + PIN_TEXT);
        var cnt = headEl.querySelector('.' + PIN_COUNT);
        var n = section.querySelectorAll('.' + PIN_BODY + ' > ' + SEL.item).length;
        if (txt) txt.textContent = PIN_LABEL;
        if (cnt) cnt.textContent = open ? '' : ' ' + PIN_LABEL_COUNT.replace('{n}', n);
      }
    };

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      // 1) 置顶小节的标题行
      if (t.closest('.' + PIN_HEAD)) { toggle(ev); return; }

      // 2) 置顶小节里的克隆项
      var clone = t.closest('.' + PIN_CLONE);
      if (!clone) return;
      var title = clone.dataset.lsPinTitle;
      if (!title) return;

      // 点是「...」按钮：转发到真身上的那个按钮（克隆没有 React 事件）
      if (t.closest(SEL.itemAction)) {
        ev.preventDefault();
        ev.stopPropagation();
        var real = findRealItem(title);
        var realBtn = real && real.querySelector(SEL.itemAction + ' button');
        if (realBtn) {
          lastMenuOwner = title;
          realBtn.click();
        }
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();
      openSessionByTitle(title);
    }, true);

    // 键盘可达：标题行支持 Enter / 空格
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var t = ev.target;
      if (!t || !t.closest || !t.closest('.' + PIN_HEAD)) return;
      toggle(ev);
    }, true);
  }

  /** 按标题找侧栏里的真身项（克隆不算） */
  function findRealItem(title) {
    var s = sider();
    if (!s) return null;
    var items = s.querySelectorAll(SEL.item);
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains(PIN_CLONE)) continue;
      if (itemTitle(items[i]) === title) return items[i];
    }
    return null;
  }

  /** 置顶排序：所有置顶项集中到最上面的「置顶」小节 */
  function refreshPinOrder() {
    var s = sider();
    if (!s) return;
    var pins = readPins();

    if (!featureOn('pin')) {
      // 关掉功能时把插入的痕迹清掉
      cleanupPinArtifacts(s);
      return;
    }

    // 先把旧做法留下的痕迹（跨节搬运、徽标位置）恢复干净
    var wraps = s.querySelectorAll(SEL.siderListWrap + ' [class*="section-"]');
    for (var i = 0; i < wraps.length; i++) {
      if (wraps[i].classList.contains(PIN_SECTION)) continue;
      reorderIn(wraps[i], []);
    }

    renderPinnedSection(s, pins);
  }

  /** 清掉所有置顶相关的 DOM 痕迹（关功能/回滚时用） */
  function cleanupPinArtifacts(s) {
    var sec = s.querySelector('.' + PIN_SECTION);
    if (sec) sec.remove();
    var items = s.querySelectorAll(SEL.item);
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove(PINNED_CLASS, PIN_HIDDEN);
      var badge = items[i].querySelector('.' + PIN_BADGE);
      if (badge) badge.remove();
    }
    pinnedState.lastKey = '';
  }

  /** 在一个容器内把项按 pins 顺序排好（现在只用于「恢复原状」） */
  function reorderIn(container, pins) {
    if (!container) return;
    var items = Array.prototype.slice.call(container.querySelectorAll(SEL.item));
    if (!items.length) return;
    // 只处理「直接子项」层级：先找它们的共同父节点
    var parent = items[0].parentNode;
    var same = items.filter(function (x) { return x.parentNode === parent; });
    if (same.length !== items.length) {
      // 层级不一致（理论上不会），保守起见不排序
      return;
    }

    // ⚠ 关键：只有顺序真的不对时才动 DOM。
    //
    // 这里曾经无条件地把每一项 appendChild 回父节点 —— append 一个已经在
    // 该父节点里的节点，浏览器会当成「先移除再插入」，于是**每次调用都产生
    // 一批 childList 变更**。而这段代码被 MutationObserver 触发，
    // 结果就是「观察者 → 排序 → 变更 → 观察者」每帧一次的死循环：
    // 实测 18 秒内 applyAll 跑了 1077 次。
    //
    // 更隐蔽的是：移动节点时 MutationObserver 把它记在 **removedNodes** 里，
    // 而带 ls-* 类的节点会被自检规则跳过，于是自检也拦不住这个循环。
    // 最后的受害者是应用本身 —— DSH 桥接层有 composerTimer 的 300ms 防抖，
    // 每帧都被重新触发，导致模型选择器**永远不挂载**，看起来像「功能全坏了」。
    var desired = same.slice().sort(function (a, b) {
      var ra = pins.indexOf(itemTitle(a));
      var rb = pins.indexOf(itemTitle(b));
      if (ra === -1) ra = 1e9;
      if (rb === -1) rb = 1e9;
      if (ra !== rb) return ra - rb;
      return same.indexOf(a) - same.indexOf(b); // 稳定
    });

    var changed = false;
    for (var c = 0; c < desired.length; c++) {
      if (same[c] !== desired[c]) { changed = true; break; }
    }
    if (changed) {
      for (var k2 = 0; k2 < desired.length; k2++) parent.appendChild(desired[k2]);
    }

    // 标记：置顶项加图钉徽标（这部分本身就是幂等的）
    for (var j = 0; j < desired.length; j++) {
      var t = itemTitle(desired[j]);
      var pinned = pins.indexOf(t) !== -1;
      desired[j].classList.toggle(PINNED_CLASS, pinned);
      var titleEl = desired[j].querySelector(SEL.itemTitle);
      if (!titleEl) continue;
      var badge = titleEl.querySelector('.' + PIN_BADGE);
      if (pinned && !badge) {
        var b = el('span', PIN_BADGE);
        b.setAttribute('aria-hidden', 'true');
        b.appendChild(svgIcon(ICON.pin, 11));
        titleEl.insertBefore(b, titleEl.firstChild);
      } else if (!pinned && badge) {
        badge.remove();
      }
    }
  }

  /* ================================================================== *
   * 功能 3：长消息折叠（超过 8 行）
   * ================================================================== */

  var COLLAPSE_LINES = 8;
  var CLAMP_CLASS = 'ls-clamp';
  var CLAMP_BODY = 'ls-clamp__body';
  var CLAMP_BTN = 'ls-clamp__toggle';
  var CLAMP_DONE = 'ls-clamp--done';

  /**
   * 折叠一条用户消息。
   *
   * 实现要点：给 .container-_4cfe7 里的 .bubble 外面套一层 .ls-clamp__body，
   * 用 max-height 过渡做展开/收起 —— 不用 height:auto 是因为它没法过渡。
   * 折叠高度取「8 行」的实测值（lineHeight * 8 + padding），而不是写死像素，
   * 这样换字号/换语言都不会算错。
   */
  function applyCollapse() {
    if (!featureOn('collapse')) return;
    var msgs = collectMessages();
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.role !== 'user') continue;
      if (m.el.classList.contains(CLAMP_DONE)) continue;
      try { collapseOne(m.el); } catch (e) { warn('折叠失败', e); }
    }
  }

  function collapseOne(box) {
    var bubble = box.querySelector(SEL.userBubble);
    if (!bubble) return;
    var cs = getComputedStyle(bubble);
    var lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) {
      // line-height:normal 时拿不到数值，用字号估算
      lh = (parseFloat(cs.fontSize) || 16) * 1.6;
    }
    var full = bubble.getBoundingClientRect().height;
    var limit = lh * COLLAPSE_LINES;
    // 不算长就不动它（留 1px 容差）
    if (full <= limit + 1) {
      box.classList.add(CLAMP_DONE);
      return;
    }

    // 包一层 body（只包一次）
    var body = box.querySelector(':scope > .' + CLAMP_BODY);
    if (!body) {
      body = el('div', CLAMP_BODY);
      bubble.parentNode.insertBefore(body, bubble);
      body.appendChild(bubble);
    }
    var padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // 折叠态高度 = 8 行 + 上下内边距；留一点余量避免第 9 行露头
    var collapsedH = Math.round(limit + padV);
    var fullH = Math.round(body.scrollHeight || full);

    body.style.setProperty('--ls-clamp-h', collapsedH + 'px');
    body.style.setProperty('--ls-clamp-full', fullH + 'px');

    var btn = el('button', CLAMP_BTN);
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    var label = el('span', 'ls-clamp__label', '展开全文');
    var chev = el('span', 'ls-clamp__chev');
    chev.appendChild(svgIcon(ICON.chevron, 12));
    btn.appendChild(label);
    btn.appendChild(chev);
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var open = body.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      label.textContent = open ? '收起' : '展开全文';
      // 展开后重新量一次（图片/markdown 可能改变高度）
      if (open) {
        body.style.setProperty('--ls-clamp-full', Math.round(body.scrollHeight) + 'px');
      }
    });

    var tools = el('div', 'ls-clamp__tools');
    tools.appendChild(btn);
    // 重渲染后可能残留上一次的按钮容器（React 换了外层节点），清掉再来
    var oldTools = box.querySelectorAll(':scope > .ls-clamp__tools');
    for (var k = 0; k < oldTools.length; k++) oldTools[k].remove();
    box.appendChild(tools);
    box.classList.add(CLAMP_DONE, CLAMP_CLASS);
  }

  /* ================================================================== *
   * 功能 4：粘贴文本过大 → 转 .txt，可「粘贴原文至输入框」
   * ================================================================== */

  var PASTE_MIN_CHARS = 1200;   // 超过这么多字符就转
  var PASTE_MIN_LINES = 16;     // 或者超过这么多行
  var PASTE_TRAY = 'ls-paste-tray';
  var pasteStore = readJson(LS_PASTE, []);
  var pasteSeq = 0;

  function totalPasteChars() {
    var n = 0;
    for (var i = 0; i < pasteStore.length; i++) n += pasteStore[i].text.length;
    return n;
  }

  function looksBig(text) {
    if (!text) return false;
    if (text.length >= PASTE_MIN_CHARS) return true;
    var lines = text.split('\n').length;
    return lines >= PASTE_MIN_LINES;
  }

  function humanSize(n) {
    if (n < 1000) return n + ' 字';
    return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k 字';
  }

  function addPastedText(text) {
    pasteSeq += 1;
    var name = '粘贴文本-' + pasteSeq + '.txt';
    while (pasteStore.some(function (x) { return x.name === name; })) {
      pasteSeq += 1;
      name = '粘贴文本-' + pasteSeq + '.txt';
    }
    var rec = { id: 'p' + Date.now().toString(36) + '-' + pasteSeq, name: name, text: text };
    pasteStore.push(rec);
    writeJson(LS_PASTE, pasteStore);
    return rec;
  }

  function removePastedText(id) {
    pasteStore = pasteStore.filter(function (x) { return x.id !== id; });
    writeJson(LS_PASTE, pasteStore);
  }

  /** 反馈条：告诉用户发生了什么，并给「粘贴原文至输入框」 */
  function renderPasteTray() {
    var host = document.querySelector(SEL.main);
    if (!host) return;
    var tray = document.querySelector('.' + PASTE_TRAY);
    if (!pasteStore.length) {
      if (tray) tray.remove();
      return;
    }
    if (!tray) {
      tray = el('div', PASTE_TRAY);
      tray.setAttribute('role', 'status');
      host.appendChild(tray);
    }
    tray.textContent = '';
    // 顶栏：说明「为什么输入框是空的」，否则用户会以为粘贴失败
    var head = el('div', 'ls-paste-head');
    head.appendChild(el('span', 'ls-paste-head__text',
      pasteStore.length > 1 ? ('已把 ' + pasteStore.length + ' 段过大的粘贴内容转成 .txt 附件')
        : '已把过大的粘贴内容转成 .txt 附件'));
    tray.appendChild(head);
    for (var i = 0; i < pasteStore.length; i++) {
      (function (rec) {
        var row = el('div', 'ls-paste-row');
        var icon = el('span', 'ls-paste-row__icon');
        icon.appendChild(svgIcon('M4 1.5h5.4L13 5.1v9.4a.9.9 0 0 1-.9.9H4a.9.9 0 0 1-.9-.9V2.4a.9.9 0 0 1 .9-.9zm5 1.6v2.4h2.4L9 3.1z', 14));
        var meta = el('span', 'ls-paste-row__meta');
        meta.appendChild(el('b', 'ls-paste-row__name', rec.name));
        meta.appendChild(el('span', 'ls-paste-row__size', humanSize(rec.text.length) + ' · 已转成附件'));
        var back = el('button', 'ls-paste-row__btn', '粘贴原文至输入框');
        back.type = 'button';
        back.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          pasteIntoComposer(rec.text);
          removePastedText(rec.id);
          renderPasteTray();
        });
        var drop = el('button', 'ls-paste-row__x');
        drop.type = 'button';
        drop.setAttribute('aria-label', '删除这段粘贴文本');
        drop.appendChild(svgIcon(ICON.close, 12));
        drop.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          removePastedText(rec.id);
          renderPasteTray();
        });
        row.appendChild(icon);
        row.appendChild(meta);
        row.appendChild(back);
        row.appendChild(drop);
        tray.appendChild(row);
      })(pasteStore[i]);
    }
  }

  /** 把文本写进 textarea，并用 React 认的方式触发 input */
  function pasteIntoComposer(text) {
    var ta = document.querySelector(SEL.textarea);
    if (!ta) return false;
    try {
      var proto = window.HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      return true;
    } catch (e) {
      warn('写回输入框失败', e);
      return false;
    }
  }

  function installPasteGuard() {
    if (!featureOn('paste')) return;
    // 只挂一次
    if (window.__lsPasteGuard) return;
    window.__lsPasteGuard = true;

    document.addEventListener('paste', function (ev) {
      try {
        var ta = ev.target;
        if (!ta || !ta.matches || !ta.matches(SEL.textarea)) return;
        var dt = ev.clipboardData;
        if (!dt) return;
        var text = dt.getData('text/plain') || '';
        if (!looksBig(text)) return;
        // 阻止默认粘贴，改成收进 tray
        ev.preventDefault();
        ev.stopPropagation();
        addPastedText(text);
        renderPasteTray();
        log('粘贴文本过大（' + text.length + ' 字 / ' + text.split('\n').length + ' 行），已转为 .txt');
      } catch (e) {
        warn('粘贴处理失败', e);
      }
    }, true);

    // 点「粘贴原文至输入框」后若文本又变得很大，同样收起来（防止绕过）
    document.addEventListener('input', throttled(function () {
      // 这里只做 tray 的刷新，不强行改用户输入
      renderPasteTray();
    }), true);
  }

  /* ================================================================== *
   * 功能 5：关键词搜索对话
   * ================================================================== */

  var SEARCH_BTN = 'ls-search-btn';
  var SEARCH_PANEL = 'ls-search-panel';
  var searchInput = null;

  /** 读官方库里的全部会话（标题 + 正文），用于搜索 */
  function readSessionsFromDb() {
    return new Promise(function (resolve) {
      var req;
      try {
        req = indexedDB.open('chat-demo');
      } catch (e) {
        return resolve([]);
      }
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains('sessions')) { db.close(); return resolve([]); }
          var tx = db.transaction('sessions', 'readonly');
          var all = tx.objectStore('sessions').getAll();
          all.onsuccess = function () {
            var rows = all.result || [];
            db.close();
            resolve(rows.map(function (s) {
              var parts = [];
              (s.messages || []).forEach(function (m) {
                if (typeof m.content === 'string' && m.content) parts.push(m.content);
                (m.blocks || []).forEach(function (b) {
                  if (b && typeof b.text === 'string' && b.text) parts.push(b.text);
                });
              });
              return { id: s.id, title: s.title || '', body: parts.join('\n'),
                updatedAt: s.updatedAt || s.createdAt || 0 };
            }));
          };
          all.onerror = function () { db.close(); resolve([]); };
        } catch (e) {
          try { db.close(); } catch (e2) { /* ignore */ }
          resolve([]);
        }
      };
      req.onerror = function () { resolve([]); };
    });
  }

  /** 侧栏里当前显示的标题（顺序），用来把搜索结果对应回可点的会话项 */
  function sidebarTitles() {
    var s = sider();
    if (!s) return [];
    var out = [];
    var items = s.querySelectorAll(SEL.item);
    for (var i = 0; i < items.length; i++) {
      var t = itemTitle(items[i]);
      if (t) out.push(t);
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 关键词高亮（先转义再插 mark，避免 XSS） */
  function highlightText(text, kw) {
    var safe = escapeHtml(text);
    if (!kw) return safe;
    var re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark class="ls-mark">$1</mark>');
  }

  function searchSessions(kw) {
    var q = (kw || '').trim().toLowerCase();
    if (!q) return Promise.resolve([]);
    return readSessionsFromDb().then(function (rows) {
      var out = [];
      rows.forEach(function (r) {
        var titleHit = r.title.toLowerCase().indexOf(q) !== -1;
        var body = r.body || '';
        var pos = body.toLowerCase().indexOf(q);
        var score = 0;
        if (titleHit) score += 100;
        var hits = 0;
        var from = 0;
        while (hits < 50) {
          var p = body.toLowerCase().indexOf(q, from);
          if (p === -1) break;
          hits += 1;
          from = p + q.length;
        }
        score += Math.min(hits, 20);
        if (!titleHit && pos === -1) return;
        var snippet = '';
        if (pos !== -1) {
          var start = Math.max(0, pos - 26);
          snippet = (start > 0 ? '…' : '') + body.slice(start, pos + q.length + 42).replace(/\s+/g, ' ') +
            (pos + q.length + 42 < body.length ? '…' : '');
        } else {
          snippet = body.slice(0, 60).replace(/\s+/g, ' ');
        }
        out.push({ title: r.title, snippet: snippet, score: score, hits: hits,
          updatedAt: r.updatedAt, kw: kw.trim() });
      });
      out.sort(function (a, b) { return b.score - a.score || b.updatedAt - a.updatedAt; });
      return out.slice(0, 50);
    });
  }

  /** 打开某个标题对应的会话（走官方深链接那一套：token + restoreFromHash）
   *
   * ⚠ 一定要跳过置顶小节里的**克隆**项。
   * 克隆是把 React 属性清掉之后复制出来的，点它不会有任何反应 ——
   * 踩过：openSessionByTitle 顺序找到的第一个匹配项正好是克隆
   * （置顶小节在列表最前面），于是 `clickable.click()` 静默无效，
   * 表现成「点置顶里的对话打不开」。
   */
  function openSessionByTitle(title) {
    var L = window.__localstore;
    var real = findRealItem(title);
    if (real) {
      try {
        real.click();
        return true;
      } catch (e) { /* ignore */ }
    }
    // 退路：用 token 走 hash 恢复
    if (L && L.getOrCreateToken && L.restoreFromHash) {
      var tok = L.getOrCreateToken(title, title);
      if (tok) {
        location.hash = '#c=' + tok;
        return true;
      }
    }
    return false;
  }

  function renderSearchResults(rows, kw) {
    var panel = document.querySelector('.' + SEARCH_PANEL);
    if (!panel) return;
    var listEl = panel.querySelector('.ls-search-results');
    if (!listEl) return;
    listEl.textContent = '';
    if (!kw.trim()) {
      listEl.appendChild(el('div', 'ls-search-empty', '输入关键词开始搜索'));
      return;
    }
    if (!rows.length) {
      listEl.appendChild(el('div', 'ls-search-empty', '没有匹配的对话'));
      return;
    }
    var head = el('div', 'ls-search-count', rows.length + ' 条结果');
    listEl.appendChild(head);
    rows.forEach(function (r) {
      var row = el('button', 'ls-search-hit');
      row.type = 'button';
      var t = el('div', 'ls-search-hit__title');
      t.innerHTML = highlightText(r.title || '(无标题)', kw.trim());
      var sn = el('div', 'ls-search-hit__snip');
      sn.innerHTML = highlightText(r.snippet, kw.trim());
      row.appendChild(t);
      row.appendChild(sn);
      row.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (openSessionByTitle(r.title)) {
          closeSearch();
        }
      });
      listEl.appendChild(row);
    });
  }

  function openSearch() {
    var panel = document.querySelector('.' + SEARCH_PANEL);
    if (!panel) {
      var host = sider() || document.body;
      panel = el('div', SEARCH_PANEL);
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '搜索对话');
      var head = el('div', 'ls-search-head');
      var back = el('button', 'ls-search-back');
      back.type = 'button';
      back.setAttribute('aria-label', '返回');
      back.appendChild(svgIcon(ICON.left, 14));
      back.addEventListener('click', function (ev) { ev.preventDefault(); closeSearch(); });
      searchInput = el('input', 'ls-search-input');
      searchInput.type = 'search';
      searchInput.placeholder = '搜索对话';
      searchInput.setAttribute('aria-label', '搜索对话');
      var results = el('div', 'ls-search-results');
      results.appendChild(el('div', 'ls-search-empty', '输入关键词开始搜索'));
      head.appendChild(back);
      head.appendChild(searchInput);
      panel.appendChild(head);
      panel.appendChild(results);
      host.appendChild(panel);
      searchInput.addEventListener('input', throttled(function () {
        var kw = searchInput.value;
        searchSessions(kw).then(function (rows) { renderSearchResults(rows, kw); });
      }));
      searchInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); closeSearch(); }
        if (ev.key === 'Enter') {
          var first = panel.querySelector('.ls-search-hit');
          if (first) first.click();
        }
      });
    }
    var s = sider();
    if (s) s.classList.add('ls-searching');
    requestAnimationFrame(function () { panel.classList.add('is-open'); });
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    renderSearchResults([], '');
  }

  function closeSearch() {
    var panel = document.querySelector('.' + SEARCH_PANEL);
    if (panel) {
      panel.classList.remove('is-open');
      setTimeout(function () {
        if (!panel.classList.contains('is-open')) panel.remove();
      }, 260);
    }
    var s = sider();
    if (s) s.classList.remove('ls-searching');
  }

  /** 在「收起边栏」按钮**左边**插一个纯图标搜索按钮
   *
   *  用户指定的位置：「侧边栏的收起侧边栏按钮左边」，并且不要解释文字。
   *
   *  挂到 .top-ac14ac 里（而不是按钮内部）：
   *  .top-ac14ac 是 flex + space-between，实测 logo 右边缘 176、
   *  收起按钮左边缘 214，中间正好有 ~38px 空隙，放一个 28px 的图标按钮刚好。
   *  插成 logo 的兄弟节点，space-between 的三栏关系（logo | 搜索 | 收起）
   *  由 flex 自己排，不需要写死位置。
   */
  function installSearchEntry() {
    var s = sider();
    if (!s) return;
    if (s.querySelector('.' + SEARCH_BTN)) return;
    var top = s.querySelector('.top-ac14ac');
    if (!top) return;

    // ⚠ 外观要和旁边那个按钮**完全一致**，所以直接复用应用自己的类名，
    // 不要另起一套样式（用户明确要求「和旁边那个是一样的 ui，不要重新设计」）。
    // 实测收起按钮是：button._7c3cd.m-_7c3cd.tertiary-_7c3cd，34×34、圆角 8px。
    // 这三个类名一旦随应用升级变化，下面的 byPrefix 会兜底。
    var collapseBtn = top.querySelector('button[aria-label]');
    var cls = collapseBtn ? String(collapseBtn.className) : '';
    if (!cls || cls.indexOf('button-') === -1) {
      // 退路：按前缀拼出与旁边按钮同源的类名
      cls = ['button', 'm', 'tertiary'].map(function (p) {
        var probe = top.querySelector('[class*="' + p + '-"]');
        var m = probe && String(probe.className).match(new RegExp(p + '-[a-z0-9]+'));
        return m ? m[0] : '';
      }).filter(Boolean).join(' ');
    }
    if (!cls) cls = 'ls-search-btn__fallback';

    var btn = el('button', cls + ' ' + SEARCH_BTN);
    btn.type = 'button';
    btn.setAttribute('aria-label', '搜索对话');
    btn.title = '搜索对话';
    // 提示文案走我们自己的 tooltip（见 .ls-tip）。
    //
    // ⚠ 不能只靠 aria-label/title：应用的按钮外面包着它自己的 Tooltip
    // 组件（tI / .tooltip-_94788），悬浮在**同一区域**时会冒出「收起边栏」。
    // 实测就是这么个现象 —— hover 搜索按钮，弹的却是旁边按钮的提示。
    // 所以这里自绘一个，视觉与应用的 .tooltip-_94788 对齐
    // （见 CSS 里 .ls-tip 的注释，尺寸/配色都是照它量的）。
    btn.dataset.lsTip = '搜索对话';
    btn.dataset.lsTipPlace = 'bottom';
    btn.appendChild(svgIcon(ICON.search, 16));
    // 悬浮时压掉应用那个「收起边栏」提示。
    //
    // 应用的提示触发区是一个覆盖两个按钮的矩形，所以不压掉的话，
    // 悬浮搜索按钮会同时看到两个提示叠在一起（文案还互相矛盾）。
    // 用 mouseenter/mouseleave 直接开关 <html> 上的标记，最直接可靠。
    var setHoverFlag = function (on) {
      try {
        if (on) document.documentElement.setAttribute('data-ls-search-hover', '1');
        else document.documentElement.removeAttribute('data-ls-search-hover');
      } catch (e) { /* ignore */ }
    };
    btn.addEventListener('mouseenter', function () { setHoverFlag(true); });
    btn.addEventListener('mouseleave', function () { setHoverFlag(false); });
    // 兜底：万一 mouseleave 没派发（比如按钮被重挂），
    // 轮询鼠标是否还在按钮上，避免标记永久留着把提示一直藏掉。
    btn.addEventListener('mouseover', function () { setHoverFlag(true); });
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setHoverFlag(false);
      openSearch();
    });
    // 收缩按钮外面包着 <span class="trigger-_94788">，它**不是** top 的直接子节点。
    // 直接 top.insertBefore(btn, collapseBtn) 会抛
    // 「The node before which the new node is to be inserted is not a child of this node」，
    // 而且这个异常在 applyAll 的 throttle 里会被吞掉，表现成「按钮就是不出现」。
    // 所以必须插在收起按钮的**父节点**上、紧挨着它。
    var anchor = collapseBtn || top.lastElementChild;
    if (!anchor) { top.appendChild(btn); return; }
    anchor.parentNode.insertBefore(btn, anchor);
    // 给这两个按钮接上自绘提示（收起按钮由应用自己负责，这里只管我们的）
    top.setAttribute('data-ls-tip-owner', 'topbar');
    bindTips(top, 'lsTipBound');
  }

  /* --------- 通用 tooltip ---------
   *
   * 应用自己的提示是 <div class="tooltip-_94788">（实测：64×26、
   * background rgb(67,69,74)、color rgb(249,250,251)、radius 10px、
   * font 12px/18px、padding 4px 8px、fixed、z-index 2000）。
   * 我们自绘一个同款（CSS 里 .ls-tip），因为注入的按钮拿不到它的
   * React Tooltip 包装，而只写 aria-label 又会被旁边按钮的提示串味。
   *
   * 支持两个方向：bottom（侧栏顶部按钮）与 right（消息轨道）。
   *
   * 全站只有一个提示节点，所以额外记一个 owner（谁在用）。
   * 详见 hideTip 的注释：没有归属判断时，轨道重建会把别人的提示顺手收掉。
   */
  var tipState = { owner: '' };

  function ensureTip() {
    var tip = document.querySelector('.ls-tip');
    if (tip) return tip;
    tip = el('div', 'ls-tip');
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    // 滚动/改窗口时收起，免得浮条留在原地
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
    return tip;
  }

  function showTip(target, text, place, owner) {
    try {
      var tip = ensureTip();
      tipState.owner = owner || '';
      tip.textContent = text;
      var r = target.getBoundingClientRect();
      tip.classList.toggle('ls-tip--right', place === 'right');
      tip.classList.add('is-on');
      // 先显示再量尺寸，否则拿到的是 0
      var tr = tip.getBoundingClientRect();
      var left, top;
      if (place === 'right') {
        left = r.left - tr.width - 8;
        top = r.top + r.height / 2 - tr.height / 2;
      } else {
        left = r.left + r.width / 2 - tr.width / 2;
        top = r.bottom + 6;
      }
      // 不许出视口
      left = Math.max(4, Math.min(left, window.innerWidth - tr.width - 4));
      top = Math.max(4, Math.min(top, window.innerHeight - tr.height - 4));
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top) + 'px';
    } catch (e) { /* ignore */ }
  }

  /**
   * 收起提示。
   *
   * 带 owner 时会先核对「当前显示的是不是这个 owner 的提示」，不是就不动。
   *
   * ⚠ 这个判断是必须的，踩过一次很难查的坑：
   * 全站只有一个 .ls-tip 节点，轨道重建（removeRail）时也会调 hideTip，
   * 而重建可能发生在任何一次 DOM 变动时。结果就是悬浮搜索按钮刚弹出的
   * 「搜索对话」被轨道重建顺手收掉，表现成「搜索按钮没有提示」。
   * 加上归属判断后，各功能只会收自己的提示。
   */
  function hideTip(owner) {
    if (owner && tipState.owner && tipState.owner !== owner) return;
    tipState.owner = '';
    var tip = document.querySelector('.ls-tip');
    if (tip) tip.classList.remove('is-on');
  }

  /** 给一个容器里带 data-ls-tip 的元素接上自绘 tooltip（事件委托）
   *
   * ⚠ 收起判断不能简单地用 mouseout 就收：我们的提示条浮在鼠标旁边，
   * 应用的提示条（.tooltip-_94788，同一个位置、同样是 fixed）会盖上来，
   * 指针一进入它，鼠标就被判定「离开了按钮」，提示条立刻自己消失。
   * 实测就是这样：显示不到 120ms 就没了。
   * 所以这里改成「等一小会儿再看指针还在不在原来的元素上」。
   */
  function bindTips(container, flagKey) {
    if (!container || container.dataset[flagKey] === '1') return;
    container.dataset[flagKey] = '1';
    var current = null;   // 当前正在提示的那个元素
    var hideTimer = null;

    var cancelHide = function () {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    };

    container.addEventListener('mouseover', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var hit = t.closest('[data-ls-tip]');
      if (!hit || !container.contains(hit)) return;
      cancelHide();
      if (hit === current) return;
      current = hit;
      // owner 用容器上打的标记，这样轨道重建时的 hideTip('rail')
      // 不会把搜索按钮的提示一起收掉
      showTip(hit, hit.getAttribute('data-ls-tip') || '', hit.getAttribute('data-ls-tip-place') || 'bottom',
        container.getAttribute('data-ls-tip-owner') || '');
    });

    container.addEventListener('mouseout', function (ev) {
      cancelHide();
      hideTimer = setTimeout(function () {
        hideTimer = null;
        if (!current) return;
        var hovered = null;
        try { hovered = current.matches(':hover') ? current : null; } catch (e) { hovered = null; }
        if (hovered) return;  // 指针还在这个按钮上（只是被提示条盖住了）
        var owner = container.getAttribute('data-ls-tip-owner') || '';
        current = null;
        hideTip(owner);
      }, 220);
    });

    container.addEventListener('mouseleave', function () {
      cancelHide();
      current = null;
      hideTip(container.getAttribute('data-ls-tip-owner') || '');
    });
  }

  /* ================================================================== *
   * 调度：幂等 apply + MutationObserver 重放
   * ================================================================== */

  /**
   * 每个功能独立执行、独立捕获异常。
   *
   * ⚠ 这里**不能**用「一个 try 包住全部」的写法。
   * throttled() 会把整个函数体包在一个 try/catch 里，所以任何一步抛错
   * 都会让**后面所有步骤**静默跳过 —— 表现出「某个按钮就是不出现」，
   * 而且控制台只在 warn 里留一行，极难定位。
   */
  function step(name, fn) {
    try {
      fn();
    } catch (e) {
      warn(name + ' 失败：' + ((e && e.message) || e));
    }
  }

  /* 重入保护参见下面 applyAll 的注释 */

  var applying = false;
  var applyAgain = false;

  var applyAll = throttled(function () {
    if (applying) { applyAgain = true; return; }
    applying = true;
    try {
      step('搜索入口', installSearchEntry);
      step('置顶分节', function () { installStoreWatcher(); installPinCloneHandler(); refreshPinOrder(); });
      step('版本角标', function () { refreshVersionMap(); applyVersionBadges(); });
      step('对话模型记忆', function () { installModelRecorder(); installSwitchWatcher(); applyConvModel(); });
      step('消息轨道', applyMessageRail);
      step('长消息折叠', applyCollapse);
      step('粘贴反馈条', renderPasteTray);
      step('菜单增强', function () {
        var menus = document.querySelectorAll(SEL.menu);
        for (var i = 0; i < menus.length; i++) decorateMenu(menus[i]);
      });
    } finally {
      applying = false;
    }
    if (applyAgain) {
      applyAgain = false;
      applyAll();
    }
  });

  function startObserver() {
    if (window.__lsFeatObserver) return;
    var obs = new MutationObserver(function (muts) {
      // ⚠ 整个回调必须包在 try/catch 里。
      // MutationObserver 的回调抛异常不会中断页面，但会**静默丢掉这一批变更**，
      // 于是「某个功能偶尔不生效」，而且控制台只有一条不易察觉的报错。
      // 功能层绝不能因为自己的 bug 影响应用本身（更不能让用户以为记录丢了）。
      try {
        // 只对「结构性变化」反应，避免自己的样式改动触发死循环
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type !== 'childList') continue;
          if (!m.addedNodes.length && !m.removedNodes.length) continue;
          var self = false;
          var nodes = [].concat(Array.prototype.slice.call(m.addedNodes),
            Array.prototype.slice.call(m.removedNodes));
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType === 1 && /(^|\s)ls-/.test(String(n.className || ''))) { self = true; break; }
            // 已知的 ls-* 直接忽略：不要因为自己的插入反复触发
            if (n.nodeType === 1 && n.querySelector &&
                n.querySelector('[class*="ls-"]')) { self = true; break; }
          }
          if (self) continue;
          applyAll();
          return;
        }
      } catch (e) {
        warn('DOM 变更回调失败（已忽略，不影响应用）', e);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__lsFeatObserver = obs;
  }

  /** 记住「...」按钮属于哪个会话项（菜单是浮层，得靠这个对应） */
  function startMenuWatcher() {
    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var it = t.closest(SEL.item);
      if (it) lastMenuOwner = it;
    }, true);
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var it = t.closest(SEL.item);
      if (it) lastMenuOwner = it;
      // 菜单出现后立刻补条目（官方菜单是同步插进 body 的）
      setTimeout(function () {
        var menus = document.querySelectorAll(SEL.menu);
        for (var i = 0; i < menus.length; i++) decorateMenu(menus[i]);
      }, 0);
    }, true);
  }

  function startScrollWatcher() {
    document.addEventListener('scroll', throttled(syncRailActiveWithPin), true);
    window.addEventListener('resize', throttled(syncRailActive));
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function boot() {
    try {
      // 应用是 defer 加载的 React，DOM 里先没有侧栏，所以等它出现
      var tries = 0;
      (function wait() {
        tries += 1;
        var ok = document.querySelector(SEL.sider) || document.querySelector(SEL.main);
        if (ok || tries > 200) {
          applyAll();
          installPasteGuard();
          startObserver();
          startMenuWatcher();
          startScrollWatcher();
          log('v' + VERSION + ' 已加载（5 个功能就位）');
          return;
        }
        setTimeout(wait, 60);
      })();
    } catch (e) {
      warn('启动失败', e);
    }
  }

  // 暴露给测试与调试
  window.__lsFeatures = {
    version: VERSION,
    apply: function () { applyAll(); },
    // 功能 1
    collectMessages: collectMessages,
    scrollToMessage: scrollToMessage,
    railCount: function () { return document.querySelectorAll('.' + RAIL_CLASS + ' .ls-msg-rail__line').length; },
    // 功能 2
    readPins: readPins,
    isPinned: isPinned,
    togglePin: togglePin,
    setPinned: function (titles) { writeJson(LS_PIN, titles || []); applyAll(); },
    refreshPinOrder: refreshPinOrder,
    // 功能 3
    COLLAPSE_LINES: COLLAPSE_LINES,
    // 功能 4
    readPastes: function () { return pasteStore.slice(); },
    addPastedText: function (t) { var r = addPastedText(t); renderPasteTray(); return r; },
    removePastedText: removePastedText,
    pasteIntoComposer: pasteIntoComposer,
    looksBig: looksBig,
    PASTE_MIN_CHARS: PASTE_MIN_CHARS,
    PASTE_MIN_LINES: PASTE_MIN_LINES,
    // 功能 5
    searchSessions: searchSessions,
    openSessionByTitle: openSessionByTitle,
    openSearch: openSearch,
    closeSearch: closeSearch,
    // 功能 6：对话内换模型（每个对话各记各的）
    readConvModels: readConvModels,
    setConvModel: function (title, model) { writeConvModel(title, model); applyAll(); },
    activeConversationTitle: activeConversationTitle,
    applyConvModel: function () { convModel.applying = false; applyConvModel(); },
    NEW_CONV_KEY: NEW_CONV_KEY,
    // 下面是「只读诊断」用的，业务代码不依赖它们。
    // 留着的理由：这两个功能都涉及异步时序（平滑滚动落点、对话切换窗口），
    // 出问题时用 tools/e2e-features5.mjs 里的探针能直接看到内部状态，
    // 比重新插桩快得多（这一轮排查就是靠它们定位的）。
    railState: railState,
    /** 诊断用：模型记忆的内部状态 */
    modelDebug: function () {
      return {
        activeTitle: convModel.activeTitle,
        pendingSwitchTitle: pendingSwitchTitle,
        restoring: convModel.restoring,
        switching: convModel.switching,
        recorderBound: convModel.recorderBound,
        switchBound: convModel.switchBound,
        hasOrigSelect: !!convModel.origSelect,
        currentTitle: activeConversationTitle(),
        currentModel: currentModel(),
        baseline: baselineModel(),
        records: readConvModels()
      };
    },
    // 开关
    featureOn: featureOn,
    setFeature: setFeature,
    // 常量，测试要用
    SEL: SEL
  };

  ready(boot);
})();
