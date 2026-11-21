/*!
 * localstore-features.js —— 在 DeepSeek chat-demo 构建产物之上叠加的 7 个功能。
 * 与 localstore-bridge.js 一样，是**独立于应用 bundle** 的旁路脚本：
 * 应用升级后只需要重新确认几个 hash 类名（见下面的常量区），功能不会全废。
 *
 * 七个功能：
 *   1. 消息索引轨道 —— 最右侧一列横线，一条线 = 一条用户提问，点击快速定位
 *   2. 置顶对话 —— 会话项「...」菜单里新增「置顶」，置顶项排到列表最前
 *   3. 长消息折叠 —— 发送的消息超过 8 行就折叠，展开/收起带动画
 *   4. 过大粘贴转附件 —— 粘贴文本过大时直接当成一个本地 .txt 附件交给应用，
 *      完全走官方链路（不自建 UI、不加提示语，等同「拖了个 txt 进来」）
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
  var LS_PIN_OPEN = 'chat-demo:ls-pin-open';
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
      // 置顶分节里的克隆项：标题可能和当前真身不一致（用户改过名、
      // 或文件夹同步把标题换了），直接用它自己记的那个标题最准。
      if (lastMenuOwner.dataset && lastMenuOwner.dataset.lsPinTitle) {
        return lastMenuOwner.dataset.lsPinTitle;
      }
      var t = itemTitle(lastMenuOwner);
      if (t) return t;
    }
    // 退路：当前 hover 的会话项，或激活项
    var hov = document.querySelector(SEL.item + ':hover');
    if (hov) {
      if (hov.dataset && hov.dataset.lsPinTitle) return hov.dataset.lsPinTitle;
      return itemTitle(hov);
    }
    var act = document.querySelector(SEL.item + '.' + SEL.itemActive.split('.').pop());
    if (act && act.dataset && act.dataset.lsPinTitle) return act.dataset.lsPinTitle;
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
  /** 指针在克隆行里时由 JS 自己加上（不依赖浏览器的 :hover，实测 :hover 不可靠） */
  var CLONE_HOVER = 'ls-pin-hover';
  /** 打开菜单期间强制把「...」显示出来（要量它的矩形，0×0 会算错位置） */
  var CLONE_FORCE = 'ls-pin-force-action';
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
  var pinnedState = {
    times: null, lastKey: '', pinnedCount: -1, handlerBound: false, storeBound: false, animating: false,
    /** 存了置顶但侧栏里还认不出来的那些标题（非空表示"在等侧栏渲染"） */
    pendingPins: null,
    /** 重试计时器与次数（见 schedulePinRetry） */
    retryTimer: null, retryCount: 0, retryBound: false
  };

  /**
   * 侧栏还没渲染出来时，安排一次重试。
   *
   * 为什么需要它：置顶的标题要对上侧栏里的项才能显示。启动那几秒侧栏是
   * 空骨架，这时如果直接把置顶判定成"已取消"就永久丢了（见
   * renderPinnedSection 里那段注释）。MutationObserver 也救不了 ——
   * 侧栏填数据只改文字不改结构，观察器看不到。
   *
   * 所以自己轮询：300ms 一次，最多 RETRY_MAX 次（约 15 秒），
   * 足够覆盖"读 IndexedDB + 反向同步"这段。真的没有就放弃，
   * 不会一直空转。
   */
  var PIN_RETRY_MS = 300;
  var PIN_RETRY_MAX = 50;
  function schedulePinRetry() {
    if (pinnedState.retryTimer || pinnedState.retryBound) return;
    if (pinnedState.retryCount >= PIN_RETRY_MAX) {
      warn('置顶无法显示：等了 ' + Math.round(PIN_RETRY_MS * PIN_RETRY_MAX / 1000) +
        ' 秒，侧栏里始终找不到这些对话：' + (pinnedState.pendingPins || []).join(' / '));
      pinnedState.retryBound = true;
      return;
    }
    pinnedState.retryCount += 1;
    pinnedState.retryTimer = setTimeout(function () {
      pinnedState.retryTimer = null;
      try {
        var s = sider();
        if (s) renderPinnedSection(s, readPins());
      } catch (e) {
        warn('置顶重试失败', e);
      }
    }, PIN_RETRY_MS);
  }

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
  // LS_PIN_OPEN 在文件顶部的常量区声明（这里不再重复声明）

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

    if (!have.length && pins.length) {
      // ★ 「置顶看不到」的元凶就在这里，别改回去。
      //
      // 存着 N 个置顶，但当前侧栏里一个都认不出来 —— 这**不代表**用户
      // 取消了置顶，最可能只是**侧栏还没渲染出来**：
      //   · 应用启动时先渲染侧栏骨架，会话列表是读完 IndexedDB 才填进去的；
      //   · 从文件夹反向同步回来的会话也是一样，列表先空后满。
      //
      // 旧写法在这种情况下会把整个「置顶」小节 remove() 掉，而之后侧栏
      // 填数据只是**改已有节点的文字**、不改分节结构，MutationObserver
      // 看到的结构没变就不再重放 apply —— 于是置顶永久消失，
      // 刷新也救不回来（每次都是同一个时序）。
      //
      // 正确做法：**什么都不删**，留着小节，并安排重试；
      // 等侧栏真出来了自然会认到。
      pinnedState.pendingPins = pins.slice();
      // 但克隆行要清掉：真身这会儿不在，留着就是点不动的幽灵行
      var staleBody = section && section.querySelector(':scope > .' + PIN_BODY);
      if (staleBody) staleBody.textContent = '';
      schedulePinRetry();
      return;
    }
    pinnedState.pendingPins = null;
    // 认出来了：把重试状态清干净，下次再遇到「侧栏还是空的」可以从头等
    pinnedState.retryCount = 0;
    pinnedState.retryBound = false;

    if (!have.length) {
      // 没有置顶项（用户真的没置顶）：把小节和隐藏标记都撤掉
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
    syncPinClones(body, have, byTitle);
    syncPinActive(body, byTitle);
  }

  /**
   * 把「当前选中的是哪个对话」同步到克隆行上。
   *
   * 克隆是快照，应用的 active 类不会自己跟过来；但**也不能因为 active 变了
   * 就重建克隆**（那正是"点别的对话，置顶那个也在跳"）。所以这里只做
   * 类名的增删，节点本身一动不动。
   *
   * 判据：真身行上有 SEL.itemActive 的类，那个类名里的 hash 段
   * （例如 active-ff6fc9）跟着官方走，所以从真身上现取，不硬编码。
   */
  function syncPinActive(body, byTitle) {
    // 真身的 active 类名（形如 active-ff6fc9）
    var activeCls = SEL.itemActive.split('.').pop();
    var clones = body.querySelectorAll(':scope > ' + SEL.item);
    for (var i = 0; i < clones.length; i++) {
      var title = clones[i].dataset ? clones[i].dataset.lsPinTitle : '';
      var real = title ? byTitle[title] : null;
      var on = !!(real && real.classList.contains(activeCls));
      clones[i].classList.toggle(activeCls, on);
    }
  }

  /**
   * 把置顶小节的克隆行同步成 have 的样子 —— **能复用就复用**。
   *
   * ★ 为什么不能每次删掉重建（用户报的两个 bug 都出在这）★
   *
   * 旧实现每轮都 `existing.remove()` 再 `appendChild(clone)`。于是：
   *   · 点别的对话 → 应用重渲染 → 触发功能层重放 → 克隆被删又建，
   *     用户看到的就是「点别的对话，置顶那个也在跳」；
   *   · 鼠标停在克隆的「...」上时，行的位置/身份在变，
   *     菜单和悬浮提示跟着重算，就是「那个框还是跳」。
   * 删掉重建还会连带丢掉焦点、hover 状态、以及转发点击时用的引用。
   *
   * 现在的策略（按代价从低到高）：
   *   1. 标题集合完全相同 → **一个节点都不动**，只同步 active 类。
   *      这是绝大多数情况（点对话、收消息都只是 active 变了）。
   *   2. 顺序变了 → 用 insertBefore 把已有节点挪到正确位置（不重建）。
   *   3. 新增/减少了置顶 → 只处理差集：多的删、少的建，
   *      其余原地不动。
   */
  function syncPinClones(body, have, byTitle) {
    // 现有克隆按标题建索引
    var existing = {};
    var nodes = body.querySelectorAll(':scope > ' + SEL.item);
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].dataset ? nodes[i].dataset.lsPinTitle : '';
      if (t && !existing[t]) existing[t] = nodes[i];
      else nodes[i].remove();               // 重复/无标记的脏节点清掉
    }

    // 删掉不再置顶的
    for (var k in existing) {
      if (!Object.prototype.hasOwnProperty.call(existing, k)) continue;
      if (have.indexOf(k) === -1) { existing[k].remove(); delete existing[k]; }
    }

    // 按 have 的顺序补齐 + 排队（insertBefore 对已在正确位置的节点是空操作）
    for (var c = 0; c < have.length; c++) {
      var title = have[c];
      var node = existing[title];
      if (!node) {
        var real = byTitle[title];
        if (!real) continue;
        node = real.cloneNode(true);
        notReactOwned(node);
        // 真身被我们藏起来了，克隆自己不能带这两个类
        node.classList.remove(PIN_HIDDEN, PINNED_CLASS);
        node.classList.add(PINNED_CLASS, PIN_CLONE);
        node.dataset.lsPinTitle = title;
        fixCloneAction(node);
        markOwn(node);
        existing[title] = node;
      }
      // 槽位对齐：把 node 放到 body 的第 c 个孩子
      var at = body.children[c];
      if (at !== node) body.insertBefore(node, at || null);
    }
  }

  /**
   * 把克隆项上的「...」按钮修好，让它在置顶分节里能正常用。
   *
   * 用户明确要求：「置顶的也要有...，不然无法取消置顶」。
   * 之前这里是直接把按钮摘掉（为了绕开「悬浮框乱跳」），那是错的 ——
   * 置顶行必须能取消置顶，否则用户被卡住。
   *
   * 那个「乱跳」的真正原因**不是**这个按钮，是功能层的自触发死循环：
   * 克隆项的 class 是 `item-ff6fc9 ...`（应用自己的类名打头），
   * 被 startObserver 误判成"外部变动"，于是每 17ms 删掉重建一次，
   * 鼠标一碰按钮，行在动、悬浮框跟着量到新位置。循环已经在
   * startObserver/applyAll 里修掉了，这里恢复按钮就有意义了。
   *
   * 需要做两件事：
   *   1. 给克隆里的按钮去掉 React 的 aria-label 冲突风险不是问题，
   *      但**必须保证点击能被应用自己的菜单逻辑收到** ——
   *      克隆是 cloneNode 出来的，应用用的是根节点事件委托，
   *      所以按钮的 onClick 照样会冒泡到 React 根并弹出菜单。
   *   2. 给按钮补一个我们自己认的标记，方便出问题时定位。
   */
  function fixCloneAction(clone) {
    try {
      var act = clone.querySelector(SEL.itemAction);
      if (!act) return;
      // 行有点击处理（打开对话），按钮区域必须自己吞掉冒泡，
      // 否则点「...」会顺带把对话点开。应用原本就是这么做的
      // （action 那个 div 上有 onClick stopPropagation），克隆把这个 div
      // 一起复制过来了，所以不用我们再加 —— 这里只做存在性兜底。
      act.setAttribute('data-ls-clone-action', '1');
    } catch (e) { /* ignore */ }
  }

  /** 转发菜单时正在生效的"矩形顶替"现场（同一时刻只可能有一次） */
  var pendingRestore = null;
  /** 正在被顶替的真实行；原型包装靠它判断「这次量取要不要骗」 */
  var fakedNode = null;
  /** 顶替用的矩形 */
  var fakedBox = null;
  /** 原型包装是否已挂（只挂一次，常驻但平时 fakedNode 为 null 不生效） */
  var protoPatched = false;

  /**
   * 盯着「菜单被挂进 DOM」这件事。
   *
   * 应用的浮层定位（tF 这个 hook）是在 useLayoutEffect 里量锚点矩形、
   * 算出坐标存进 state 的。React 18 把这个更新批处理到事件结束才提交 ——
   * 所以「量矩形」发生在 click 返回之后。
   *
   * 而我们顶替的矩形必须在它量完之后才能还原，早一步就会量到隐藏真身的
   * 0×0（菜单跑到屏幕左上角）。又不能无限期顶着不放（真身以后还要用）。
   *
   * 观察器正好给出那个准确时刻：菜单节点被加进 body 时，回调以微任务形式
   * 执行 —— 此时 React 已同步跑完 commit 阶段的 layout effect（量取已完成），
   * 但浏览器还没绘制。在这里还原，既不影响本次量取，也不会留下副作用。
   */
  function watchMenuMount(onMounted) {
    var stopped = false;
    var obs = null;
    var finish = function () {
      if (stopped) return;
      stopped = true;
      try { if (obs) obs.disconnect(); } catch (e) { /* ignore */ }
      try { onMounted(); } catch (e) { /* ignore */ }
    };
    try {
      obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if ((n.classList && n.classList.contains(SEL.menu.slice(1))) ||
                (n.querySelector && n.querySelector(SEL.menu))) {
              finish();
              return;
            }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
    // 兜底：菜单迟迟不来也要把矩形还回去
    setTimeout(finish, 300);
    return finish;
  }

  /**
   * 让应用把「隐藏的真身」当成「看得见的克隆」来量位置。
   *
   * 应用的浮层定位会量**真身那一行里面的 .anchor-_5f384**（包着「...」
   * 按钮的 span）来算菜单坐标。真身整行是 display:none，量出来是 0×0
   * （在屏幕左上角），于是菜单跑到左上角 —— 用户报的「位置不对」。
   *
   * 做法不是去猜它量哪个节点，而是把**真身整行**的 getBoundingClientRect
   * 换成返回克隆按钮的矩形；行内所有后代（anchor、button）本身没有自己的
   * getBoundingClientRect，自然会走到原型方法 —— 在原型上按「最近祖先是否
   * 被顶替」判断即可，这样不管应用量的是哪一层都能骗过去。
   *
   * 覆盖必须持续到应用真正量完为止（React 18 的更新是批处理的），
   * 收尾交给 watchMenuMount。
   */
  function fakeAnchorRect(real, cloneEl) {
    var undo = [];
    try {
      if (!real || !cloneEl || !cloneEl.getBoundingClientRect) return undo;
      var r0 = real.getBoundingClientRect();
      var r = cloneEl.getBoundingClientRect();
      var box = {
        x: r.x, y: r.y, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        width: r.width, height: r.height, toJSON: function () { return r; }
      };
      fakedNode = real;
      fakedBox = box;

      // 1) 真身自己（如果它恰好有自己的 getBoundingClientRect 就直接换掉）
      var own = Object.prototype.hasOwnProperty.call(real, 'getBoundingClientRect');
      var prev = real.getBoundingClientRect;
      if (typeof prev === 'function') {
        try {
          real.getBoundingClientRect = function () { return box; };
          undo.push({ node: real, prev: prev, own: own });
        } catch (e) { /* ignore */ }
      }

      // 1b) ★ 实测（探针 v138）应用量的是**真身行里那个 .anchor-_5f384**，
      //     不是行本身、也不是按钮。所以必须把这个 anchor 自己换掉。
      //     只靠下面的原型包装不够 —— 那要看住的最近祖先是真身
      //     （`fakedNode.contains(this)`），而实测它量到的那个 anchor
      //     走的是 `this` 自己的方法，绕过了原型链上的判断。
      //     这里直接把真身行内的 anchor 全部换成同一个 box。
      //     ⚠ 必须在 click **之前**换好：应用的定位在 useLayoutEffect 里，
      //       是 commit 阶段同步跑的，比 MutationObserver 的回调（微任务）
      //       更早。放在回调里换就已经晚了 —— 那正是"跳一下"的来源。
      var anchors = real.querySelectorAll('[class*="anchor-"]');
      for (var ai = 0; ai < anchors.length; ai++) {
        (function (node) {
          var aOwn = Object.prototype.hasOwnProperty.call(node, 'getBoundingClientRect');
          var aPrev = node.getBoundingClientRect;
          if (typeof aPrev !== 'function') return;
          try {
            node.getBoundingClientRect = function () { return box; };
            undo.push({ node: node, prev: aPrev, own: aOwn });
          } catch (e) { /* ignore */ }
        })(anchors[ai]);
      }

      // 2) 挂一个原型级别的包装：后代节点（anchor span、button）量取时
      //    如果自己是真身的后代，就报同一个矩形。
      //    只挂一次；活跃期间所有量取都按「最近的顶替祖先」判断。
      if (!protoPatched) {
        protoPatched = true;
        try {
          var proto = window.Element && window.Element.prototype;
          var origRect = proto.getBoundingClientRect;
          proto.getBoundingClientRect = function () {
            try {
              if (fakedNode && fakedBox && this !== fakedNode &&
                  this.nodeType === 1 && fakedNode.contains(this)) {
                return fakedBox;
              }
            } catch (e) { /* ignore */ }
            return origRect.call(this);
          };
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    return undo;
  }

  function restoreAnchorRect(real, undo) {
    var list = undo || pendingRestore || [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      try {
        if (u.own) u.node.getBoundingClientRect = u.prev;
        else delete u.node.getBoundingClientRect;
      } catch (e) { /* ignore */ }
    }
    // 原型包装不用拆（只读判断，平时不生效），把标记清掉即可
    fakedNode = null;
    fakedBox = null;
    if (!undo) pendingRestore = null;
  }

  /* 菜单定位修正的定时器（同一时刻只会有一个菜单） */
  var menuPlaceTimer = null;

  /**
   * 把菜单钉在置顶行的「...」按钮旁边。
   *
   * 为什么不靠"骗"应用去量克隆的矩形：试过覆盖真身（以及它后代）的
   * getBoundingClientRect，实测应用仍然把菜单放在 (8,4)，说明它量到的
   * 不是我们顶替的那些节点。与其继续猜它量哪一层，不如**在它定位完成
   * 之后直接改坐标** —— 菜单是 position:fixed（实测 CSS：
   * `.menu-_5f384{position:fixed}`），它的 left/top 就是视口坐标，
   * 和 getBoundingClientRect 同一套坐标系，所以：
   *   dx = 当前 rect.left - 当前 style.left
   *   left = 目标 rect.left + dx
   * 这样即使以后应用换成 transform 定位，也能跟着走。
   *
   * 位置对齐规则照抄应用自己的观感（tF 这个 hook）：
   *   · 水平：贴在按钮左边（align:start），并夹在视口内（左右各留 8px）
   *   · 垂直：空间够就放按钮下面（offset 4px），不够就翻到上面
   *
   * **★★ 时机是这里最关键的一点（用户报的"还在跳"就出在这）★★**
   *
   * 实测真指针点击后的菜单位置序列（探针 v138，线上页面逐帧）：
   *     94ms   (209,198)   ← 应用首次渲染（style 是它自己算的初始值）
   *     112ms  (8,4)       ← 应用的 g() 重新测量，量到隐藏真身的 0×0 → 左上角
   *     127ms  (214,198)   ← 我们的修正生效
   * 也就是用户**看得见** (209,198) → (8,4) → (214,198) 这三步闪跳，
   * 鼠标正下方的目标位置在 30ms 内变了两次 —— 当然点不中。
   *
   * 根因：应用的定位在 `useLayoutEffect` 里（React 提交阶段、**绘制之前**），
   * 我们原来放在 rAF 里（**绘制之后**），晚了整整一帧，所以中间那帧被画了出来。
   *
   * 所以修正必须和应用的重新测量落在**同一个绘制帧**里：
   * 用 MutationObserver 盯菜单挂载 —— 它的回调是微任务，紧跟在 React commit
   * 之后、浏览器绘制之前。在回调里就地改坐标，应用量完到我们改完之间没有绘制，
   * 用户只会看到最终位置。之后再补几帧粘住（我们插入的「取消置顶」会让高度
   * 晚一帧定下来、应用会再量一次），同样只在 rAF 里改，不产生可见跳变。
   */
  function menuEl() {
    var m = document.querySelectorAll(SEL.menu);
    return m.length ? m[m.length - 1] : null;
  }

  /**
   * 把「隐藏的真身行」临时搬到克隆按钮的正下方（纯 CSS 绝对定位，不动 DOM 结构）。
   *
   * ★ 这是"菜单跳动"的**治本**做法 ★
   *
   * 之前的路子是"让应用先算错、我们再改坐标"，结果必然是两帧：
   * 应用算的位置画一帧、我们改完再画一帧。实测（探针 v138）：
   *   94ms (209,198) → 112ms (8,4) → 127ms (214,198)
   * 鼠标正下方的目标 30ms 内挪两次，当然点不中「置顶」「重命名」。
   *
   * 根因是**隐藏的真身量出来是 0×0**。那就别让它量到 0×0：
   * 临时用绝对定位把它摆到克隆按钮的位置上（尺寸不变、暗到看不见、
   * pointer-events 关掉），应用量出来的矩形本身就是对的 ——
   * 它算出来的位置一次就对，**没有任何需要事后修正的帧**。
   *
   * 用 class 而不是内联样式，是因为置顶列表有 overflow 裁剪，
   * 需要一个 `overflow: visible` 的伴生规则（见 CSS 里 .ls-pin-anchor-done）。
   * 结束用 clearRealRowPlacement() 收干净，不留痕迹。
   */
  function placeRealRowAt(real, cloneBtn) {
    if (!real || !cloneBtn || !real.classList) return;
    try {
      var box = cloneBtn.getBoundingClientRect();
      var row = real.getBoundingClientRect();
      // 行内偏移：克隆按钮相对自己那一行的位置（真身行的结构和克隆完全一样）
      var offX = cloneBtn.offsetLeft || 0;
      var offY = cloneBtn.offsetTop || 0;
      // 真身行的左上角应该落在哪（视口坐标 + 滚动量 = 绝对定位坐标）
      var left = box.left + (window.scrollX || 0) - offX;
      var top = box.top + (window.scrollY || 0) - offY;
      real.style.setProperty('--ls-anchor-left', Math.round(left) + 'px');
      real.style.setProperty('--ls-anchor-top', Math.round(top) + 'px');
      real.classList.add('ls-pin-anchor');
      // 诊断用：万一还跳，能一眼看出这次摆到了哪
      real.dataset.lsAnchorBox = Math.round(box.left) + ',' + Math.round(box.top) +
        ' off=' + Math.round(offX) + ',' + Math.round(offY) + ' row=' +
        Math.round(row.width) + 'x' + Math.round(row.height);
    } catch (e) { /* ignore */ }
  }

  function clearRealRowPlacement(real) {
    if (!real || !real.classList) return;
    try {
      real.classList.remove('ls-pin-anchor');
      real.style.removeProperty('--ls-anchor-left');
      real.style.removeProperty('--ls-anchor-top');
      delete real.dataset.lsAnchorBox;
    } catch (e) { /* ignore */ }
  }

  /**
   * 把菜单钉到按钮旁边。
   *
   * @param {Element} menu    应用的菜单节点（body 下的 portal）
   * @param {Element} anchorEl 要贴着的按钮（置顶行的克隆按钮）
   * @param {boolean} now     true = **同步**改一次坐标（不排到下一帧）
   *
   * `now` 是从 MutationObserver 回调里调时用的：那时应用刚量完矩形、
   * 浏览器还没绘制，同步改完用户就看不到中间位置（见上面 v138 的实测序列）。
   * 后续几帧再用 rAF 粘住，兜住「我们插入的「取消置顶」让高度晚一帧定下来」
   * 引起的应用二次测量。
   */
  function placeMenuAt(menu, anchorEl, now) {
    if (!menu || !anchorEl || !anchorEl.getBoundingClientRect) return;
    if (menuPlaceTimer) { try { cancelAnimationFrame(menuPlaceTimer); } catch (e) { /* ignore */ } menuPlaceTimer = null; }
    var frames = 0;
    var step = function () {
      frames += 1;
      try {
        if (!menu.isConnected) { menuPlaceTimer = null; return; }
        var mr = menu.getBoundingClientRect();
        var ar = anchorEl.getBoundingClientRect();
        var cs = getComputedStyle(menu);
        // 视口坐标 vs 文档坐标：fixed 时 style.left 就是视口坐标；
        // absolute 时要扣掉滚动量（应用哪天换定位方式也照样对）
        var scrollX = cs.position === 'fixed' ? 0 : (window.scrollX || 0);
        var scrollY = cs.position === 'fixed' ? 0 : (window.scrollY || 0);
        var curL = parseFloat(menu.style.left);
        var curT = parseFloat(menu.style.top);
        if (isNaN(curL)) curL = mr.left + scrollX;
        if (isNaN(curT)) curT = mr.top + scrollY;
        var dx = (mr.left + scrollX) - curL;   // 应用定位方式带来的常量偏移
        var dy = (mr.top + scrollY) - curT;

        // 水平：贴按钮左边，夹在视口内
        var want = Math.max(8, Math.min(ar.left, window.innerWidth - mr.width - 8));
        // 垂直：默认按钮下方 4px；下面放不下就翻到上方
        var below = ar.bottom + 4;
        var top = (below + mr.height > window.innerHeight - 8 && ar.top - 4 - mr.height >= 8)
          ? ar.top - 4 - mr.height
          : below;

        var nextL = Math.round(want + dx);
        var nextT = Math.round(top + dy);
        if (menu.style.left !== nextL + 'px') menu.style.left = nextL + 'px';
        if (menu.style.top !== nextT + 'px') menu.style.top = nextT + 'px';
      } catch (e) { /* ignore */ }
      if (frames < 4 && typeof requestAnimationFrame === 'function') {
        menuPlaceTimer = requestAnimationFrame(step);
      } else {
        menuPlaceTimer = null;
      }
    };
    if (now) {
      // 同步跑第一次（关键：不留出"应用已定位、我们还没改"的绘制帧），
      // 然后再排后续几帧
      step();
    } else {
      step();
    }
  }

  function scheduleApply() {
    if (typeof applyAll === 'function') applyAll();
  }

  /**
   * 「置顶」小节里的克隆项：交互由我们自己接管。
   *
   * 克隆清掉了 React 属性，所以点击不会自动打开对话，必须显式处理。
   * 置顶行里**只有**「打开对应对话」这一件事 —— 它的「...」按钮
   * 在渲染时就被 stripCloneAction 摘掉了（原因见那里）。
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

      // 2a) 点「...」：转发给**真身上的按钮**。
      //
      //     为什么必须转发（实测结论，别再删掉）：
      //     克隆节点的子树在 **pointerdown 和 click 之间会被重建**
      //     （我们的 observer/应用的重渲染都会触发 applyAll），
      //     于是 click 的 target 落在了 .container-_1f155 上，
      //     而不是那个按钮 —— 菜单根本不会弹。
      //     转发到真身按钮就没这个问题：真身是 React 自己管的节点，
      //     永远在那儿、永远有效。
      //
      //     而"菜单跑到左上角"是**位置**问题，已经在 pointerdown 阶段
      //     用 fakeAnchorRect() 解决（那时应用还没量 anchor）。
      //     两件事分开治：位置在 pointerdown 修，打开在 click 里转发。
      if (t.closest(SEL.itemAction)) {
        ev.preventDefault();
        ev.stopPropagation();
        var real = findRealItem(title);
        var realBtn = real && real.querySelector(SEL.itemAction + ' button');
        if (!realBtn) { warn('置顶行打不开菜单：找不到真身按钮 ' + title); return; }
        lastMenuOwner = real;
        var cloneBtn = t.closest('button') || t;
        // 保险：万一 pointerdown 那次没赶上（键盘触发、程序化 click 等），
        // 这里再补一次。补的时候要保证克隆的「...」是量得到的 ——
        // 它有可能是 display:none（0×0），量出来又会回到左上角。
        // CLONE_FORCE 那条 CSS 强制把它显出来。
        if (!pointerPatch || pointerPatch.real !== real) {
          // 换了一行：先把上一个的修正撤干净（这份还是我们自己在管的，
          // 直接硬撤，不必等菜单关）
          if (pointerPatch) undoPatchNow();
          var cloneRow = t.closest('.' + PIN_CLONE);
          if (cloneRow) cloneRow.classList.add(CLONE_FORCE);
          placeRealRowAt(real, cloneBtn);
          pointerPatch = {
            real: real,
            clone: cloneRow,
            undo: fakeAnchorRect(real, cloneBtn),
            timer: null
          };
        }
        // 菜单关掉之后再撤（见 watchMenuClose 的注释：
        // 中途撤会让锚点缩回 0×0，应用立刻把菜单重算到左上角）
        if (pointerPatch && pointerPatch.clone) watchMenuClose(pointerPatch.clone);
        try {
          realBtn.click();
        } catch (e2) {
          warn('转发菜单点击失败', e2);
        }
        // 补一次装饰（「取消置顶」那一条让它高一点，位置已经由应用算对）
        var menus = document.querySelectorAll(SEL.menu);
        for (var mi = 0; mi < menus.length; mi++) decorateMenu(menus[mi]);
        return;
      }

      // 2b) 点克隆行的其他地方 → 打开那条对话
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

    installPinPointerPatch();
  }

  /**
   * 在 pointerdown 阶段就把「真身 anchor 的矩形」顶替掉。
   *
   * ★ 为什么必须是 pointerdown，而不是 click 里 ★
   *
   * 应用的定位在 `useLayoutEffect` 里 —— React 的 commit 阶段、**同步**执行，
   * 就在 click 处理函数返回之前。也就是说在 click 里再改任何东西都已经晚了：
   * 它已经量完 0×0、已经 setState 到 (8,4)、那一帧也已经被画出来了。
   * 实测（探针 v138，逐帧）：
   *     86ms  应用量真身 anchor → [0,0,0,0]
   *     86ms  菜单挂载到 [8,4]      ← 错的位置，用户看得见
   *     95ms  应用又量一次 → [0,0,0,0]
   * 而我们放在 click 里的顶替代码，直到这些之后才生效（__pinTrace 为空可证）。
   *
   * pointerdown 比 click 早一个事件阶段，在它里面把矩形换掉，
   * 等应用在 click 里量的时候就已经是对的 —— 首帧就是最终位置。
   * 顶替在下一次 pointerdown 或 600ms 后自动收掉，不留痕迹。
   */
  var pointerPatch = null;

  /**
   * 当前菜单还开着吗？
   * 菜单是 portal 到 body 的，靠这个判断"修正还要不要继续按住"。
   */
  function anyMenuOpen() {
    try { return !!document.querySelector(SEL.menu); } catch (e) { return false; }
  }

  /**
   * ★ 把还没开的定时器排掉，但**不动**任何页面上生效的修正 ★
   *
   * 这是「按下菜单项的一刻菜单跳到左上角」的修复关键。
   * 详见 installPinPointerPatch 里的注释。
   */
  function stopPatchTimer() {
    if (!pointerPatch) return;
    if (pointerPatch.timer) {
      try { clearTimeout(pointerPatch.timer); } catch (e) { /* ignore */ }
      pointerPatch.timer = null;
    }
  }

  /** 真正把修正撤掉：摆位、矩形顶替、按钮强制显示 */
  function undoPatchNow() {
    var p = pointerPatch;
    if (!p) return;
    pointerPatch = null;
    if (p.timer) { try { clearTimeout(p.timer); } catch (e) { /* ignore */ } }
    try { clearRealRowPlacement(p.real); } catch (e) { /* ignore */ }
    try { restoreAnchorRect(p.real, p.undo); } catch (e) { /* ignore */ }
    if (p.clone && p.clone.classList) {
      try { p.clone.classList.remove(CLONE_FORCE); } catch (e) { /* ignore */ }
    }
  }

  /**
   * 菜单关掉之后再撤修正。
   *
   * 为什么要等：应用在 `ResizeObserver` 里盯着锚点，锚点尺寸一变就重算菜单位置。
   * 如果我们在菜单还开着的时候就把「摆位 / 矩形顶替 / FORCE」撤掉，
   * 锚点会瞬间缩回 0×0 → 应用把菜单重算到 (8,4) = 左上角。
   * 所以撤的时机必须是"菜单已经不在 DOM 里了"。
   *
   * 也不用 rAF 轮询：菜单的增删会冒到 body，MutationObserver 足够，
   * 再加一个 5 秒兜底防止 observer 漏掉（比如整棵子树被替换）。
   */
  function watchMenuClose(patchedClone) {
    if (!patchedClone || !patchedClone.classList) return;
    var done = false;
    var seenOpen = false;
    var obs = null;

    var finish = function () {
      if (done) return;
      seenOpen = true;
      // 菜单真的没了才撤
      if (anyMenuOpen()) return;
      done = true;
      if (obs) { try { obs.disconnect(); } catch (e) { /* ignore */ } obs = null; }
      // 等两帧：应用可能刚重排完，确保它量到的是正确坐标
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (pointerPatch && pointerPatch.clone === patchedClone) undoPatchNow();
        });
      });
    };

    var tick = function () {
      if (done) return;
      if (anyMenuOpen()) { seenOpen = true; return; }
      // 还没见过菜单打开 → 可能只是 React 还没 commit，别急着撤
      if (!seenOpen) return;
      finish();
    };

    try {
      obs = new MutationObserver(tick);
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }

    var n = 0;
    var poll = function () {
      if (done) return;
      n += 1;
      if (anyMenuOpen()) seenOpen = true;
      if (seenOpen && !anyMenuOpen()) { finish(); return; }
      // 5 秒兜底：菜单一直不出现（点击被吞了）也得把修正撤掉，
      // 否则那份"矩形顶替"会污染之后打开的所有菜单位置
      if (!seenOpen && n > 100) { done = true;
        if (obs) { try { obs.disconnect(); } catch (e) { /* ignore */ } obs = null; }
        if (pointerPatch && pointerPatch.clone === patchedClone) undoPatchNow();
        return;
      }
      if (n < 100) setTimeout(poll, 50);
    };
    setTimeout(poll, 50);
  }

  /**
   * 换成"软收"：只清掉记账与定时器，**保留页面上的修正**。
   *
   * 注意不要在这里 restoreAnchorRect / clearRealRowPlacement ——
   * 一撤就会让锚点缩回 0×0，菜单立刻跳走（这就是那个 bug）。
   * 真正的撤销交给 watchMenuClose（菜单消失后）或 undoPatchNow。
   */
  function releasePointerPatch() {
    if (!pointerPatch) return;
    stopPatchTimer();
    pointerPatch = null;
  }

  function installPinPointerPatch() {
    if (pinnedState.pointerPatchBound) return;
    pinnedState.pointerPatchBound = true;
    document.addEventListener('pointerdown', function (ev) {
      /**
       * ★ 「菜单闪到左上角」的根因就在这一行 ★
       *
       * 用户的动作：点「...」打开菜单 → 鼠标移向菜单项 → **在菜单项上按下**。
       * 这个 pointerdown 命中的是**菜单**，不是置顶行。原来这里无条件调用
       * releasePointerPatch()，于是"按下菜单项"的一瞬间把三样修正全撤了：
       *   · clearRealRowPlacement  → 真身回到 display:none
       *   · restoreAnchorRect      → 锚点不再是按钮的矩形
       *   · 摘掉 CLONE_FORCE       → 克隆的「...」缩回 0×0
       * 应用在 ResizeObserver 里盯着锚点，尺寸一变就把菜单重算到 (8,4)
       * —— 用户看到的就是"正要按下去，面板跳到左上角"。
       *
       * 实测（探针逐帧）：
       *   t=2070 pointermove menu=[209,198] btnW=28 class=FORCE display=flex
       *   t=2380 pointerdown menu=[209,198] btnW= 0 class=-     display=none  ← 收紧
       *
       * 所以：**菜单还开着就不许撤**。指针从置顶行移开时（自然 hover 丢失）
       * 也同理 —— 那时菜单也开着，按钮必须继续按住。
       */
      if (anyMenuOpen()) {
        // 菜单开着：修正继续按住，什么都不撤
        return;
      }

      // 到这里说明没有菜单开着 —— 上一次的修正已经完成使命，硬撤干净。
      // （不要用 releasePointerPatch：它是"软收"，只清记账不撤页面，
      //   在这里用会把摆位和 FORCE 留在页面上，越攒越多。）
      undoPatchNow();
      var t = ev.target;
      if (!t || !t.closest) return;
      var clone = t.closest('.' + PIN_CLONE);
      if (!clone || !t.closest(SEL.itemAction)) return;
      var title = clone.dataset.lsPinTitle;
      if (!title) return;
      var real = findRealItem(title);
      var cloneBtn = t.closest('button') || t;
      if (!real || !cloneBtn) return;
      // 两条保险一起上：既把真身"摆"到克隆按钮处（万一应用直接量行），
      // 也把 anchor 的矩形顶替掉（实测应用量的是 anchor）。
      //
      // ⚠ 先把克隆的「...」强制显示出来：它默认可能是 display:none，
      //   量出来是 0×0，顶替过去的也还是错的（这个坑踩过：菜单停在左上角）。
      clone.classList.add(CLONE_FORCE);
      placeRealRowAt(real, cloneBtn);
      pointerPatch = {
        real: real,
        clone: clone,
        undo: fakeAnchorRect(real, cloneBtn),
        timer: null
      };
      // ★ 菜单关掉之后才撤修正 ★
      // 中途撤（比如"在菜单项上按下"时）会让锚点缩回 0×0，
      // 应用立刻把菜单重算到左上角 —— 用户看到的就是"闪"。
      watchMenuClose(clone);
    }, true);

    installCloneHover();
  }

  /**
   * 把「...」按住显示，直到菜单从 DOM 里消失。
   *
   * ★ 用户报的「点开菜单后，手一动去点面板上的按键就闪」的根因 ★
   *
   * 应用算菜单位置的办法是量**锚点**（也就是那一行的「...」按钮）的矩形，
   * 而且它在 `ResizeObserver` 里盯着这个锚点 —— 锚点尺寸一变就重算位置。
   *
   * 而我们的「...」平时是藏着的（`display:none`），靠鼠标在行里才显形
   * （见 installCloneHover）。于是：
   *     鼠标从「...」移向菜单 → 离开了那一行 → ls-pin-hover 被撤掉
   *     → 按钮回到 display:none → 矩形变 0×0
   *     → ResizeObserver 触发 → 应用把菜单重算到左上角 (8,4)
   * 用户看到的就是"正准备点，面板跳走了"。
   *
   * 所以：**菜单开着的时候，按钮必须一直保持可见**。
   * 这里用 MutationObserver 盯菜单的消失，菜单一走才收掉。
   * （之前用 900ms 定时器收，太早了 —— 用户还在点。）
   */
  /**
   * 把「...」按住显示，直到菜单从 DOM 里消失。
   *
   * ★ 用户报的「点开菜单后，手一动去点面板上的按键就闪」的根因 ★
   *
   * 应用算菜单位置的办法是量**锚点**（也就是那一行的「...」按钮）的矩形，
   * 而且它在 `ResizeObserver` 里盯着这个锚点 —— 锚点尺寸一变就重算位置。
   *
   * 而我们的「...」平时是藏着的（`display:none`），靠鼠标在行里才显形
   * （见 installCloneHover）。于是：
   *     鼠标从「...」移向菜单 → 离开了那一行 → ls-pin-hover 被撤掉
   *     → 按钮回到 display:none → 矩形变 0×0
   *     → ResizeObserver 触发 → 应用把菜单重算到左上角 (8,4)
   * 用户看到的就是"正准备点，面板跳走了"。
   *
   * 所以：**菜单开着的时候，按钮必须一直保持可见**。
   * 现在统一由 watchMenuClose() 负责（菜单消失后才撤），
   * 这里保留一个薄封装，供"菜单已经打开、但没走过 pointerdown"的路径调用。
   */
  function holdActionUntilMenuCloses(clone) {
    if (!clone || !clone.classList) return function () {};
    clone.classList.add(CLONE_FORCE);
    watchMenuClose(clone);
    return function () { /* 撤销由 watchMenuClose / undoPatchNow 统一负责 */ };
  }

  /**
   * 让置顶行的「...」确实显示出来。
   *
   * ★ 这是「置顶的...点不开」的真正原因 ★
   *
   * 原来只写了一条 CSS `.ls-pin-clone:hover .action-ff6fc9{display:flex}`，
   * 靠浏览器的 :hover。实测（探针 v138）**不可靠**：
   *     鼠标事件确实落在克隆行里（pointerover/mouseover 都命中了），
   *     但同一时刻 `clone.matches(':hover')` === false，
   *     于是 .action 的计算值一直是 display:none。
   * 结果是「...」是 0×0、`elementFromPoint(按钮中心)` 返回的是标题 div，
   * 点击永远打在标题上 —— 菜单当然打不开，也就无从谈起"位置对不对"。
   *
   * 所以不再依赖 :hover：用 pointermove 自己判断"指针在不在克隆行里"，
   * 在就加 `.ls-pin-hover`（CSS 里同样让它 display:flex）。
   * 显式、可控、和浏览器 :hover 无关。
   */
  function installCloneHover() {
    if (pinnedState.cloneHoverBound) return;
    pinnedState.cloneHoverBound = true;

    var sync = function (ev) {
      if (!ev || !ev.target) return;
      var clones = document.querySelectorAll('.' + PIN_CLONE);
      if (!clones.length) return;
      // 用坐标判定，不用 ev.target.closest：指针可能在按钮的 svg 里，
      // 也可能因为 tooltip 之类的浮层换了个 target，按坐标最稳。
      var x = ev.clientX;
      var y = ev.clientY;
      for (var i = 0; i < clones.length; i++) {
        var r = clones[i].getBoundingClientRect();
        var inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        if (inside) clones[i].classList.add(CLONE_HOVER);
        else clones[i].classList.remove(CLONE_HOVER);
      }
    };
    var clear = function () {
      var clones = document.querySelectorAll('.' + PIN_CLONE + '.' + CLONE_HOVER);
      for (var i = 0; i < clones.length; i++) clones[i].classList.remove(CLONE_HOVER);
    };

    document.addEventListener('pointermove', sync, true);
    document.addEventListener('mousemove', sync, true);
    document.addEventListener('pointerdown', sync, true);
    document.addEventListener('mouseleave', clear, true);
    window.addEventListener('blur', clear);
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
   * 功能 4：粘贴文本过大 → 直接当成本地 .txt 附件交给应用
   *
   * 用户要求（原话）：
   *   「你不用自己写 ui，也不用加提示语，你就直接用原生的东西，
   *     相当于拖了一个 txt 文本文档进来一样的」
   *
   * 所以这里**不建任何自己的 DOM**：造一个 File，塞进应用那个 hidden 的
   * `<input type="file" multiple>`，派发 change —— 之后完全走官方链路
   * （附件卡片、上传、落盘、正文里的附件引用都是应用自己的样子）。
   *
   * 为什么这样能成（实测确认）：
   *   · 应用的 input 在 functionRow-ed6f47 里，`onChange` 是
   *     `e => { _(Array.from(e.target.files ?? [])); e.target.value = '' }`；
   *     而 `setFiles(Array.from(e.target.files))` 只认 FileList 本身，
   *     所以必须用 DataTransfer 把 File 变成 FileList，**不能直接调**。
   *   · `.txt` 本来就在 accept 白名单里（accept 长得吓人，但含 `.txt`），
   *     所以连校验都不会被拦。
   *   · 实测结果：粘贴后 1.5 秒内页面出现官方附件卡片
   *     「粘贴的文本（1）.txt / 上传失败」（上传失败是因为探针用的是假 Key，
   *     说明它连"上传"这一步都真的走了）。
   *
   * ⚠ 之前那版是自建一个 `ls-paste-tray` 反馈条 + 「粘贴原文至输入框」按钮，
   * 文本只存在 localStorage 里、不进应用。用户明确否掉了这个做法：
   * 既要自己写 UI，又和真实的附件体系是两套东西（不能上传、不能进正文、
   * 换浏览器就丢）。现在整块删掉。
   * ================================================================== */

  var PASTE_MIN_CHARS = 1200;   // 超过这么多字符就转
  var PASTE_MIN_LINES = 16;     // 或者超过这么多行

  function looksBig(text) {
    if (!text) return false;
    if (text.length >= PASTE_MIN_CHARS) return true;
    var lines = text.split('\n').length;
    return lines >= PASTE_MIN_LINES;
  }

  /**
   * 找到应用那个「上传附件」用的 file input。
   *
   * 不能用 `.functionRow` 之类的布局类去定位 —— 它们是 hash 名，
   * 官方升级就会变。改成按**能力**找：
   *   · 是 input[type=file]
   *   · 带 multiple（上传附件那个是 multiple，导入 ZIP 那个不是）
   *   · 不限定 accept（导入 ZIP 的 accept 是 ".zip,..."）
   * 这样官方改布局也还能找到。
   */
  function findUploadInput() {
    var ins = document.querySelectorAll('input[type="file"]');
    var fallback = null;
    for (var i = 0; i < ins.length; i++) {
      var accept = ins[i].getAttribute('accept') || '';
      if (/\.zip/i.test(accept)) continue;      // 这是「导入历史对话」
      if (ins[i].multiple) return ins[i];
      if (!fallback) fallback = ins[i];
    }
    return fallback;
  }

  /**
   * 把一段文本当成本地 .txt 附件交给应用。
   *
   * 命名规则（用户指定）：
   *   · 默认标题就是「粘贴的文本」；
   *   · 多段依次加序号：「粘贴的文本（1）」「粘贴的文本（2）」…
   *
   * ⚠ 序号必须持久化（`chat-demo:ls-paste-seq`），内存里那个计数器刷新就归零 ——
   * 归零的后果是刷新后再粘一段又叫「粘贴的文本（1）」，和已有附件重名，
   * 用户分不清哪个是哪个。
   *
   * ⚠ 用全角括号「（）」而不是半角：和官方上传的 `report (1).pdf` 那种
   * 半角风格区分开，中文场景下更自然，Windows/macOS 也都合法。
   */
  var LS_PASTE_SEQ = 'chat-demo:ls-paste-seq';
  var PASTE_BASE_NAME = '粘贴的文本';

  /** 标题最多取这么多字符（中文按字符算，够长又能一眼认出来） */
  var PASTE_TITLE_MAX = 24;

  /**
   * 从粘贴内容里取「首句」当文件名 —— 和官方一样。
   *
   * 规则（按优先级）：
   *   1. 取第一段非空文字
   *   2. 在第一个句末标点处断开（。！？；.!?; 以及换行）
   *   3. 去掉 markdown 标记、列表符号、多余空白
   *   4. 超过 PASTE_TITLE_MAX 个字符就截断加省略号
   *
   * 之所以不用「粘贴的文本（1）（2）」那套序号命名：用户明确说了
   * 「选取粘贴文本首句/前面几个字作为标题吧，官方就这么做的」。
   * 序号那套是电脑文件重名时的兜底规则，不是标题该长成的样子。
   *
   * ⚠ 文件名里不能出现的字符（Windows 的 \ / : * ? " < > |）要换掉，
   *   否则 File 的名字在保存/展示时会出问题。
   */
  function titleFromText(text) {
    var s = String(text == null ? '' : text);
    // 1) 取第一段非空文字
    var lines = s.split(/\r?\n/);
    var first = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i].trim()) { first = lines[i].trim(); break; }
    }
    if (!first) first = s.trim();
    if (!first) return PASTE_BASE_NAME;

    // 2) 去掉常见 markdown / 列表前缀
    first = first
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.、)]\s+|>\s*)+/, '')
      .replace(/^\s*[`*_~]+/, '')
      .replace(/[`*_~]+\s*$/, '')
      .trim();
    if (!first) first = PASTE_BASE_NAME;

    // 3) 在第一个句末标点处断开（包含标点本身，读起来自然）
    var m = first.match(/^[^。！？；!?;]{1,200}[。！？；!?;]?/);
    if (m && m[0]) first = m[0];

    // 4) 截断
    if (first.length > PASTE_TITLE_MAX) {
      first = first.slice(0, PASTE_TITLE_MAX) + '…';
    }

    // 5) 文件名非法字符换成下划线；结尾的**点/空格**去掉
    //    （Windows 不允许文件名以点或空格结尾；但「。」「？」这类
    //     句末标点在文件名里合法、也很常见，留着才像原句）。
    //     顺带把全角的「．」也当成点处理，避免 `内容．.txt` 这种双标点。
    first = first
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[.．\s]+$/, '')
      .trim();
    return first || PASTE_BASE_NAME;
  }

  function nextPasteSeq() {
    var n = Number(readJson(LS_PASTE_SEQ, 0)) || 0;
    n += 1;
    writeJson(LS_PASTE_SEQ, n);
    return n;
  }

  /**
   * 打印「同名第几次」。
   *
   * 同电脑的文件命名规则：第一份就是本名（不标号），第二份才带（2）。
   * 所以这里按「基础名」计数，第一次返回 1、第二次返回 2。
   * 记在 localStorage 里，刷新后接着数，不会又从头开始。
   */
  var LS_PASTE_NAMES = 'chat-demo:ls-paste-names';

  function claimPasteName(base) {
    var map = readJson(LS_PASTE_NAMES, null);
    if (!map || typeof map !== 'object') map = {};
    var n = (Number(map[base]) || 0) + 1;
    map[base] = n;
    // 只留最近的 200 个键，别让这个表无限长大
    var keys = Object.keys(map);
    if (keys.length > 200) {
      for (var i = 0; i < keys.length - 200; i++) delete map[keys[i]];
    }
    writeJson(LS_PASTE_NAMES, map);
    return n;
  }

  /**
   * 文件名 = 首句 + .txt。
   *
   * 重名兜底按电脑的规则：第一份不加序号，第二份才加（2）。
   */
  function pasteFileName(text) {
    var base = titleFromText(text);
    var n = claimPasteName(base);
    if (n <= 1) return base + '.txt';
    return base + '（' + n + '）.txt';
  }

  function attachTextAsFile(text) {
    var input = findUploadInput();
    if (!input) return false;
    if (typeof DataTransfer !== 'function' || typeof File !== 'function') return false;

    nextPasteSeq();                        // 保留序号计数（兼容旧数据/诊断）
    var name = pasteFileName(text);

    var dt;
    try {
      dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: 'text/plain' }));
    } catch (e) {
      warn('构造 .txt 附件失败', e);
      return false;
    }

    try {
      // ⚠ 必须是 `input.files = dt.files`，不能 `dt.files` 直接传别处。
      // 这一步在 Chrome 里是允许的（其它浏览器可能抛错，所以包了 try）。
      input.files = dt.files;
    } catch (e) {
      warn('把 .txt 交给上传输入框失败', e);
      return false;
    }
    if (!input.files || !input.files.length) return false;

    // 应用监听的是 change；用真实 Event 走 React 的合成事件系统
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log('粘贴内容过大（' + text.length + ' 字 / ' + text.split('\n').length + ' 行），已转成 .txt 附件：' + name);
    return true;
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

        // 先试着转成 .txt 附件；只有成功了才拦掉默认粘贴。
        // 顺序很重要：万一 DataTransfer / file input 不可用，
        // 就让粘贴照常发生 —— 宁可把长文本塞进输入框，也不能让用户的东西消失。
        if (!attachTextAsFile(text)) {
          warn('转 .txt 附件失败，这次粘贴按原样写进输入框');
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
      } catch (e) {
        warn('粘贴处理失败', e);
      }
    }, true);
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

  /**
   * 「我们自己正在动 DOM」的标志。观察器看到它就直接返回。
   *
   * 为什么不能只靠 class 名判断：我们插入的置顶克隆项，class 是
   * `item-ff6fc9 ls-pinned ls-pin-clone` —— **应用自己的类名打头**，
   * 于是被判成"外部变动"，applyAll 又跑一遍，又删又建，死循环
   * （实测 17ms 一轮）。有了这个标记 + data-ls-own 属性，就彻底断掉。
   */
  var selfMutating = false;
  /** 给"我们插入的节点"打的标记，观察器靠它识别自己人 */
  var OWN_ATTR = 'data-ls-own';

  /** 标记一个节点（及其子树）是我们自己的 */
  function markOwn(node) {
    try {
      if (!node || node.nodeType !== 1) return node;
      node.setAttribute(OWN_ATTR, '1');
    } catch (e) { /* ignore */ }
    return node;
  }

  var applyAll = throttled(function () {
    if (applying) { applyAgain = true; return; }
    applying = true;
    selfMutating = true;
    try {
      step('搜索入口', installSearchEntry);
      step('置顶分节', function () { installStoreWatcher(); installPinCloneHandler(); refreshPinOrder(); });
      step('版本角标', function () { refreshVersionMap(); applyVersionBadges(); });
      step('对话模型记忆', function () { installModelRecorder(); installSwitchWatcher(); applyConvModel(); });
      step('消息轨道', applyMessageRail);
      step('长消息折叠', applyCollapse);
      step('菜单增强', function () {
        var menus = document.querySelectorAll(SEL.menu);
        for (var i = 0; i < menus.length; i++) decorateMenu(menus[i]);
      });
    } finally {
      applying = false;
      // MutationObserver 的回调是**微任务**：同步改完 DOM 后，
      // 回调会在当前任务结束、下一次渲染前被调用。所以不能在这里就
      // 把闸门放下 —— 得再撑过一帧，把那批回调挡掉。
      // 一帧（约 16ms）足够覆盖，且不会挡住用户真正的后续操作。
      var release = function () { selfMutating = false; };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
      else setTimeout(release, 16);
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
        // ★★ 自触发保护 —— 这里修的是一个会让置顶「看不见」的死循环 ★★
        //
        // 背景：下面这段判断想靠 class 名区分「这次变动是我们自己造成的」。
        // 它对 `ls-xxx` 开头的节点有效，但**漏掉了置顶克隆项**：
        // 克隆的 class 是 `item-ff6fc9 ls-pinned ls-pin-clone`，
        // 是应用自己的类名打头，于是被判成「外部变动」→ 又跑一遍 applyAll
        // → 又删掉重建一次克隆 → 又触发观察器……实测每 17ms 一个来回。
        //
        // 后果正是用户看到的现象：
        //   · 置顶的那一行每 17ms 被删掉重建，看上去就是「置顶对话看不到」；
        //   · 鼠标一碰「...」，行在动、悬浮框跟着量到新位置，就是「乱跳」。
        //
        // 两道闸：
        //   1) 标记闸：我们自己插的节点都带 data-ls-own（见 markOwn），
        //      只要这批变动里有它，就完全忽略；
        //   2) 时间闸：applyAll 正在跑、或刚跑完的这一帧内的变动，
        //      全部算我们自己的。这两道闸互补 —— 标记闸管得住我们
        //      显式标记的节点，时间闸兜住那些不好标记的（文本改写、
        //      classList 增删等）。
        if (selfMutating) return;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type !== 'childList') continue;
          if (!m.addedNodes.length && !m.removedNodes.length) continue;
          var self = false;
          var nodes = [].concat(Array.prototype.slice.call(m.addedNodes),
            Array.prototype.slice.call(m.removedNodes));
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            // 闸 1：我们自己标记过的节点
            if (n.hasAttribute && n.hasAttribute(OWN_ATTR)) { self = true; break; }
            if (n.querySelector && n.querySelector('[' + OWN_ATTR + ']')) { self = true; break; }
            if (/(^|\s)ls-/.test(String(n.className || ''))) { self = true; break; }
            // 已知的 ls-* 直接忽略：不要因为自己的插入反复触发
            if (n.querySelector && n.querySelector('[class*="ls-"]')) { self = true; break; }
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
    /** 只读：存了置顶但侧栏里暂时还认不出来的标题（测试用） */
    get pendingPins() { return pinnedState.pendingPins; },
    // 功能 3
    COLLAPSE_LINES: COLLAPSE_LINES,
    // 功能 4：过大的粘贴内容直接当成本地 .txt 附件交给应用（不自建 UI）
    looksBig: looksBig,
    attachTextAsFile: attachTextAsFile,
    findUploadInput: findUploadInput,
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
