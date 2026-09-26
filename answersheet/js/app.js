/* =============================================================================
 * 答题卡生成器 · 应用编排
 * -----------------------------------------------------------------------------
 * 读取面板参数 → 调 geometry/paginator → 组装 HTML → 挂到预览区。
 * 几何自检结果会显示在侧栏状态条里（对齐出问题会立刻可见）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var AS = global.AS;
  var C = AS.config;
  var G = AS.geometry;
  var Theme = AS.theme;
  var Choice = AS.choice;
  var Subject = AS.subject;
  var Page = AS.page;
  var Pager = AS.paginator;
  var NoAnswer = AS.noAnswer;

  var $ = function (id) { return document.getElementById(id); };

  /* ── 参数持久化 ──────────────────────────────────────────────────────
   * 把面板里填过的东西记在 localStorage，刷新后原样恢复，省得每次重填。
   *
   * 设计取舍：
   *   · 只存**用户真正改过**的东西（输入框 + 纸张 + 主题）。
   *     考试名称等默认留空的项，空着就存空字符串 —— 恢复出来仍是空。
   *   · 存储键带版本号（as.form.v1）。以后参数结构变了，把版本号 +1
   *     即可让旧数据自然作废，不用写迁移代码。
   *   · 隐私模式 / 禁用存储时 localStorage 会抛异常，全部读写包 try/catch，
   *     失败就静默降级成「不记忆」，不影响生成。
   *   · 任何一步出错都只是少了个便利功能，绝不能连累答题卡本身，
   *     所以 restoreSaved() 整个包在 try 里，出错就退回默认状态。
   * ------------------------------------------------------------------- */
  var STORE_KEY = 'as.form.v1';

  /* 带 ?fresh=1 打开 = 不读也不写存档。
     .ref/ 下的校验脚本共用同一个 Chrome profile，上一步留下的存档会污染
     下一步的起始状态；它们统一加这个参数，就能拿到干净的出厂状态。
     用 URLSearchParams 而不是手写正则：参数顺序、重复、转义都不用操心。 */
  var FRESH_RUN = (function () {
    try {
      return new global.URLSearchParams(global.location.search).get('fresh') === '1';
    } catch (e) {
      return false;
    }
  })();

  /* 文本/数字输入框：id 直接就是存储字段名 */
  var FIELD_IDS = [
    'cardTitle', 'cardSubject', 'zkLength', 'cardFooter',
    'choiceTotal', 'choiceStart', 'subjStart', 'subjCount', 'subjScore', 'subjLines'
  ];

  function loadSaved() {
    if (FRESH_RUN) return null;
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return (d && typeof d === 'object') ? d : null;
    } catch (e) {
      return null;
    }
  }

  function saveForm() {
    if (FRESH_RUN) return;
    try {
      var d = { format: state.format, theme: state.theme };
      FIELD_IDS.forEach(function (id) {
        var el = $(id);
        if (el) d[id] = el.value;
      });
      global.localStorage.setItem(STORE_KEY, JSON.stringify(d));
    } catch (e) { /* 隐私模式 / 配额满：静默降级 */ }
  }

  function clearSaved() {
    if (FRESH_RUN) return;
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
  }

  /** 把存下来的参数写回面板；返回是否真的恢复了东西 */
  function restoreSaved() {
    var d = loadSaved();
    if (!d) return false;
    try {
      FIELD_IDS.forEach(function (id) {
        var el = $(id);
        if (el && typeof d[id] === 'string') el.value = d[id];
      });
      if (d.format === 'A4' || d.format === 'A3') {
        state.format = d.format;
        setSeg('segFormat', d.format);
        updateFormatHint(d.format);
      }
      if (d.theme === 'color' || d.theme === 'mono') {
        state.theme = d.theme;
        var pick = $('themePick');
        if (pick) {
          pick.querySelectorAll('.theme-card').forEach(function (c) {
            c.classList.toggle('on', c.dataset.theme === d.theme);
          });
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 复位成出厂状态：面板全空、A4、双色，并删掉存档 */
  function resetForm() {
    FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.value = el.dataset.default || '';
    });
    state.format = 'A4';
    state.theme = 'color';
    setSeg('segFormat', 'A4');
    updateFormatHint('A4');
    var pick = $('themePick');
    if (pick) {
      pick.querySelectorAll('.theme-card').forEach(function (c) {
        c.classList.toggle('on', c.dataset.theme === 'color');
      });
    }
    clearSaved();
    generate();
  }

  var state = {
    format: 'A4',
    theme: 'color',
    zoom: 1,
    faces: []
  };

  /* ── 读取面板 ──────────────────────────────────────────────────────── */
  function readMeta() {
    return {
      /* 面板默认留空：名称/科目空着就空着，不塞占位文字进答题卡。
         页眉只显示用户真正填了的东西。 */
      title: $('cardTitle').value.trim(),
      subject: $('cardSubject').value.trim(),
      zkLength: Math.max(1, Math.min(20, parseInt($('zkLength').value, 10) || 9)),
      footer: $('cardFooter').value
    };
  }

  /**
   * 读非选择题题号/分值/行数。
   *
   * ⚠ 「起始题号」留空时，默认 = **选择题最后一题 + 1**
   *   （用户指定）。所以要先用选择题的起始题号和总题数算出末题号：
   *   末题 = choiceStart + choiceTotal − 1，默认起始 = 末题 + 1
   *        = choiceStart + choiceTotal。
   *   选择题一题都不出（choiceTotal = 0）时退回 1。
   */
  function readSubjItems(choiceStart, choiceTotal) {
    var cs = Math.max(1, parseInt(choiceStart, 10) || 1);
    var ct = Math.max(0, parseInt(choiceTotal, 10) || 0);
    var defStart = ct > 0 ? (cs + ct) : 1;
    var raw = ($('subjStart').value || '').trim();
    var parsed = parseInt(raw, 10);
    var start = (raw === '' || isNaN(parsed)) ? defStart : Math.max(1, parsed);
    var count = Math.max(0, parseInt($('subjCount').value, 10) || 0);
    var scores = Subject.parseScores($('subjScore').value);
    var lines = Math.max(2, parseInt($('subjLines').value, 10) || 8);
    var items = [];
    for (var i = 0; i < count; i++) {
      items.push({
        no: start + i,
        score: scores[i] !== undefined ? scores[i] : null,
        lines: lines,
        /* 每行答题区的行高。
           ⚠ 7.7008 不是 7.7 —— 这是 .ref/calib_subj.cjs 在 1/2/4/6/8/10/12/16
             行上回归出的**真实渲染值**（CSS 写 7.7，Chrome 按 sub-pixel 算
             出来每行多 0.0008mm）。用 7.7 会让 8 行少算 0.006mm，
             单题看不出，跨十几题就会让红框压到页脚上。 */
        lineH: 7.7008
      });
    }
    return items;
  }

  function readOptions() {
    /* 选择题的两个数先读出来：非选择题起始题号的默认值要用它们 */
    var choiceTotal = Math.max(0, parseInt($('choiceTotal').value, 10) || 0);
    var choiceStart = Math.max(1, parseInt($('choiceStart').value, 10) || 1);
    return {
      format: state.format,
      theme: state.theme,
      meta: readMeta(),
      /* 总题数留空 = 不出选择题（0），不默认填 12 题 */
      choiceTotal: choiceTotal,
      choiceStart: choiceStart,
      subjItems: readSubjItems(choiceStart, choiceTotal)
    };
  }

  /* ── 组装 ──────────────────────────────────────────────────────────── */
  function renderChoiceBlock(block) {
    var preset = C.PRESETS[state.format];
    var paper = C.PAPER[state.format];
    var perSheet = state.format === 'A3' ? C.A3_COLUMNS : 1;
    var r = Choice.build({
      /* ⚠ 题号范围由分页器按 geometry.blockPlan 反查给出（startNo..endNo），
         不能再写 `startNo + total − 1`：那样每面都会从第 1 题画到最后，
         而且末块（2/3/4 题、或余 1 题并进前一块）会错位。
         fromLine 仍要传 —— builder 用它决定切出哪几行。 */
      startNo: block.startNo,
      endNo: block.endNo,
      rows: block.rows,
      /* ⚠ 必须是**本面内相对行号**（分页器给的 lineOffset），
         不能传 block.fromLine —— 那是全局累计行号。传错会让换页后的
         选择题区整片空白（slice 越过切片尾部，得到空数组）。 */
      fromLine: (block.lineOffset === undefined ? block.fromLine : block.lineOffset),
      group: block.group,
      preset: preset,
      /* 面宽：A3 一页三面，每面宽 = 纸宽 / 3。列数、红框宽度都按面宽算。 */
      faceW: G.r3(paper.w / perSheet),
      first: block.head,
      /* 网格顶（相对红框顶）/ 网格高 / 首列列心都取自分页器算好的精确值，
         与定标带同源。builder 由 gridTop 反推黑框的上内边距。
         ⚠ 网格高必须含行间空档（换行处一个定位点的高度），
           直接写 colH×rows 会少算 (rows−1)×lineGap。 */
      gridTop: G.r3(block.gridTop - block.boxTop),
      gridH: G.r3(block.colH * block.rows +
                  Math.max(0, block.rows - 1) * (block.lineGap || 0)),
      colCenters: block.colCenters
    });
    return r.html;
  }

  function renderFaceBody(face, preset) {
    var html = '';
    var subjItems = face.body.filter(function (b) { return b.kind === 'subj'; });
    /* 收口下拉（用户指定）：
       剩余空白 < NOANSWER_MIN_H(15mm) 时，把**最后一道非选择题的答题区**
       （黑框内那一段）加高 face.stretch 毫米 —— 黑框底边因此下移，
       红框底边跟着下移，两框保持贴合。空白落在最后一道题的作答区底部，
       这是用户明确允许的「答题区底部多一点空白」。
       ⚠ 不要用「红框加下内边距」的做法 —— 那会让黑框与红框脱开。 */
    var stretch = face.stretch || 0;
    face.body.forEach(function (b, bi) {
      if (b.kind === 'choice') {
        // 红框整体（含栏目头）定位到 boxTop；网格各行由框内 padding 自然推到位，
        // 其 y 与 geometry 算出的行心一致（padding 由 boxOffsets 反推保证）。
        html += '<div class="as-choice-section" style="top:' + b.boxTop + 'mm">' +
                renderChoiceBlock(b) +
                '</div>';
      }
    });
    /* ── 框体高度写死 ────────────────────────────────────────────────
       用户 2026：「你不如把这个高度写死了」。
       分页器给出的 subjBoxBottom 是本面非选择题红框的**目标框底**，
       这里把它换算成框体高度写死在 .as-subject-outer 上。

       为什么必须写死：黑框表格每多一行，浏览器按 device px（0.2646mm）
       吸附盒高，累计误差让红框底短 0.5~1.4mm（实测 12 选择+2 题短 0.854、
       0 选择+2 题短 1.337）。定高之后框底由构造保证，空白落在黑框内部底部
       —— 用户明确允许「答题区可以留白」。 */
    var subjFrameH = 0;
    if (subjItems.length) {
      /* ── 红框高度：**量**出来的，不是算出来的 ────────────────────────
         用户 2026：「你不如把这个高度写死了」。
         但「写死」的必须是**渲染后的真实框高**：黑框表格每多一行，Chrome
         按整设备像素吸附行盒，模型（itemHeight）与 DOM 会漂开；用模型定高
         会让黑框整条溢出红框（实测溢出 10.8mm，且「非选择题没排完就换页」）。

         所以流程是：
           ① 先不给 .as-subject-outer 写高（frameH=0），让它按内容自然撑开；
           ② 渲染完由 fitFrames() 量出真实「红框顶 → 表格底 + 下提示」，
              写成 inline height，并夹在红框固定下限 F_BOT 内。
         这就是「对齐由构造保证」：框高来自真实盒，不来自估算。 */
      var paperH0 = (preset === C.PRESETS.A3) ? C.PAPER.A3.h : C.PAPER.A4.h;
      face.__frameBottomLimit = G.frameBottomLimit(preset, paperH0);
    }
    if (subjItems.length) {
      /* 非选择题区：整块（红框 + 可选栏目头 + 黑框表格 + 上下两处页内提示）
         定位到首题上缘。
         · 栏目头「非选择题（提示：…）」**全卡只出现一次** —— 用分页器给出的
           `head` 标记（跨面不复位），**不要**用 `first`：
           `first` 只是「本面第一段」，每一面的红框第一段都会是 true，
           拿它当条件就会每面都印一次栏目头（用户报的「出现这么多次」就是这个）；
         · 「请在各题目的答题区域内作答…」印在红框与黑框之间的**上下两处**，
           每面非选择题各一份；有栏目头的面，上半段被栏目头占着，就只印下面那处；
         · 一题被页边界切开时，落在下一面的续排段题头打红色的「续xx.」，
           且不再重复印分值（分值只在第一段印一次）。 */
      var showHeader = subjItems.some(function (b) { return !!b.head; });
      var firstSubjNo = null;
      subjItems.forEach(function (b) {
        if (firstSubjNo === null) firstSubjNo = b.item.no;
      });
      html += '<div class="as-subjective" style="top:' + subjItems[0].boxTop + 'mm">' +
              Subject.render(subjItems.map(function (b) {
                /* 续排段：题号沿用原题号，题头打「续」；分值不重复印 */
                var isCont = !!b.cont;
                return {
                  no: b.item.no,
                  score: b.item.score,
                  lines: (b.lines === undefined || b.lines === null)
                    ? b.item.lines : b.lines,
                  cont: isCont,
                  scoreShow: !isCont
                };
              }), {
                lineH: subjItems[0].item.lineH,
                showHeader: showHeader,
                pageTip: true,
                /* 收口下拉量：最后一面剩余 < 15mm 时，把这点空白拉进
                   最后一段的作答区（黑框内变高，红框跟着走）。
                   ≥ 15mm 时改由非答题区吃掉。 */
                tailExtra: stretch,
                /* 框体定高（mm）。0 表示不写死，交给内容撑。 */
                frameH: subjFrameH
              }) +
              '</div>';
    }
    /* 非答题区「考生请不要在此区域作答」：
       高度由分页器给定（吃掉本面剩余空白），**高度内联写死**；
       字号在 DOM 落地后由 fitNoAnswer() 按框的宽高比实测再定。 */
    if (face.noAnswer && face.noAnswerH > 0) {
      html += NoAnswer.render({
        top: face.noAnswerTop,
        height: face.noAnswerH
      });
    }
    return html;
  }

  /* ── 收口：把每面最后一块红框的下缘**闭环**拉到目标下界 ──────────────
     ⚠ 为什么必须闭环、不能靠公式预测：
       分页器的游标是纯 JS 算的，而红框底由 DOM 渲染决定。浏览器按
       device px（= 1/3.7795 mm = 0.2646mm）吸附每一行的盒高，量化误差随
       「本面题数/行数」变化。.ref/fit2.cjs 在 36 组配置上实测：
       「红框底 − 游标」在 −7.2 ~ +10.1mm 之间跳，取决于本面排了几行 ——
       任何线性式都拟合不出来（最大残差 12.8mm）。
       所以这里改成：先按分页器给的下拉量渲染一次，再**量**真实红框底，
       把差值补到最后一行答题区的高度上。实测「答题区加高 1mm → 红框底
       下移 0.75mm」（.ref/calib_stretch.cjs），所以补量要除以 0.75。

     目标下界 = 答题区下界 − 页脚块（页脚站在红框内底端）。
     只在「没有非答题区」的面做（有非答题区的面由它自己铺满）。 */
  var STRETCH_EFF = 0.75;      // 答题区加高 → 红框底下移 的实际比例

  /* @param facesArr renderAll() 刚返回的 faces（**必须显式传入**）
     ⚠ 不能读 state.faces —— 它在 generate() 里是渲染**之后**才赋值的，
       首次生成时它还是上一轮的值（或 undefined），闭环就成了空转，
       框体的定高也永远抹不平。 */
  function fitFrames(facesArr) {
    var stage = $('stage');
    if (!stage) return;
    var opt = readOptions();
    var paper = C.PAPER[opt.format] || C.PAPER.A4;
    var preset = C.PRESETS[opt.format] || C.PRESETS.A4;
    /* 红框下缘的目标位置 —— 用户 2026 最终口径：
       红框相对答题区**内缩** 0.7 个定位点高，
         frameBottomLimit = answerBottom − 0.7×cornerH = 280.924（A4）。
       历史口径：answerBottom − 5.0 − 0.5 = 278.385（扣页脚），
                 之后一度改成 answerBottom + 0.7×cornerH = 286.846（外扩）。 */
    var bottomLimit = G.frameBottomLimit(preset, paper.h);
    var faces = stage.querySelectorAll('.as-page .as-face');
    var first = faces.length ? faces[0].getBoundingClientRect() : null;
    if (!first) return;
    var S = first.width / paper.w;                     // px per mm
    var mm = function (v) { return v / S; };

    /* ⚠ 现在红框是**定高**的（分页器把「框底」算进了面记录），
       所以这里只做一次极小的闭环校正，把浏览器 device px 吸附造成的
       残差（实测 ≤ 1.1mm）抹掉。

       为什么不能像原来那样「加高最后一行答题区、迭代 4 轮」：
       那是红框高度**随内容变**时代的做法；现在框定高、内容不许撑它，
       再往答题区上加高只会让黑框溢出红框（实测 40 选择+2 题黑框
       282.555 > 红框 280.926）。改成**直接改框高**，黑框不受影响。

       目标框底：
         · 本面要画非答题区 → 非答题区钉到 bottomLimit（它是最下面那条框）
         · 否则 → 非选择题红框钉到分页器给的 subjBoxBottom（内容自然底）
       ⚠ 不要用「outer 当前底边」当 target —— 那恒等于 cur，delta 恒为 0，
         整个闭环变成空转。 */
    facesArr = facesArr || [];
    for (var pass = 0; pass < 3; pass++) {
      var moved = false;
      Array.prototype.forEach.call(faces, function (faceEl, fi) {
        var fb = faceEl.getBoundingClientRect();
        var na = faceEl.querySelector('.as-noanswer');
        if (na) {
          /* 非答题区：直接钉到红框下限 */
          var naCur = mm(na.getBoundingClientRect().bottom - fb.top);
          var naDelta = bottomLimit - naCur;
          if (Math.abs(naDelta) > 0.08) {
            var nh = parseFloat(na.style.height);
            if (nh > 0) { na.style.height = G.r3(nh + naDelta) + 'mm'; moved = true; }
          }
          return;
        }
        var outer = faceEl.querySelector('.as-subject-outer');
        if (!outer) return;
        /* 真实内容底 = 表格底 / 下提示底（谁更靠下取谁） */
        var table = faceEl.querySelector('.as-subject-inner-table');
        var tip = faceEl.querySelector('.as-subject-page-tip');
        var contentBottom = null;
        [table, tip].forEach(function (e) {
          if (!e) return;
          var b = mm(e.getBoundingClientRect().bottom - fb.top);
          if (contentBottom === null || b > contentBottom) contentBottom = b;
        });
        if (contentBottom === null) return;
        /* 框底 = 内容底 + 下内边距 + 下边框 */
        var cs = getComputedStyle(outer);
        var padBot = (parseFloat(cs.paddingBottom) || 0) +
                     (parseFloat(cs.borderBottomWidth) || 0);
        var target = contentBottom + mm(padBot);
        if (target > bottomLimit) target = bottomLimit;
        var cur = mm(outer.getBoundingClientRect().bottom - fb.top);
        var delta = target - cur;
        var h = parseFloat(outer.style.height);
        var hadH = h > 0;
        if (!hadH) h = mm(outer.getBoundingClientRect().height);
        if (hadH && Math.abs(delta) <= 0.08) return;
        outer.style.height = G.r3(h + delta) + 'mm';
        moved = true;
      });
      if (!moved) break;
    }
  }

  /* ── 非答题区字号自适应 ───────────────────────────────────────────────
     高度是 JS 先算的，字号要等布局稳定后才量得准（原设计也是
     setTimeout 后再量）。这里在 innerHTML 落地后同步量一次即可 ——
     非答题区是绝对定位、尺寸已定，不依赖其它元素。
     ⚠ 必须量**内容盒**（clientWidth/clientHeight），不是 borderBox ——
       边框与内边距已经占掉一部分，用 borderBox 会让字溢出。 */
  function fitNoAnswer() {
    var areas = document.querySelectorAll('.as-noanswer');
    Array.prototype.forEach.call(areas, function (area) {
      var t = area.querySelector('.as-noanswer-text');
      if (!t) return;
      var w = area.clientWidth;
      var h = area.clientHeight;
      if (!(w > 0 && h > 0)) return;
      var st = NoAnswer.fitStyle(w, h);
      t.style.fontSize = st.fontSize + 'px';
      t.style.writingMode = st.vertical ? 'vertical-rl' : 'horizontal-tb';
      t.style.whiteSpace = st.vertical ? 'normal' : 'nowrap';
      if (st.vertical) t.style.textOrientation = 'mixed';
    });
  }

  /* 首页页眉里「标题行」的实测高度（mm）。
     标题一行时是 19；换行后会变高。null 表示还没测过。 */
  var measuredTitleH = null;

  /** 把当前的选项 + 页眉高度跑一遍分页与渲染，返回 HTML 与面列表 */
  function renderAll(opt) {
    var preset = C.PRESETS[opt.format];

    var blocks = Pager.planBlocks({
      preset: preset,
      group: C.GROUPS[opt.format],
      /* ⚠ 面宽 = 纸宽 / 面数。A3 一页三面，每面 140mm；传整张 420mm
         会让列数算成 58 列、气泡排到面外（实测 A3 列距 13.3mm）。 */
      faceW: G.r3(C.PAPER[opt.format].w / (opt.format === 'A3' ? C.A3_COLUMNS : 1)),
      choiceTotal: opt.choiceTotal,
      choiceStart: opt.choiceStart,
      subjItems: opt.subjItems
    });

    var faces = Pager.paginate({
      blocks: blocks,
      preset: preset,
      chromeFirst: Page.chromeHeight(true),
      chromeOther: Page.chromeHeight(false)
    });

    /* ── 凑齐偶数页 ──────────────────────────────────────────────────────
       用户指定：「一般要凑齐偶数页，所以不应该出现奇数页，空白的地方
       全部用非答题区」，且多出来的那一面**整面就是一个非答题区**
       （含页脚、四角定位点，页眉只留「第 N 面」）。

       ⚠ 判据是**总面数**：A4 单面/张，面数=张数；A3 三面/张。
         这里按面数补齐（A4 即页数），A3 保持 3 的倍数关系不变。 */
    var blankFaces = 0;
    if (faces.length % 2 === 1) {
      var p0 = C.PRESETS[opt.format];
      var H0 = C.PAPER[opt.format].h;
      /* ⚠ 用**红框的固定上下缘**，不是答题区上下界 —— 红框相对答题区
         内缩 0.7 个定位点高（frameTopLimit / frameBottomLimit），
         非答题区就是一块红框，所以它也用这个范围。 */
      var F_TOP0 = G.frameTopLimit(p0);
      var F_BOT0 = G.frameBottomLimit(p0, H0);
      var contentH0 = G.r3(F_BOT0 - F_TOP0);
      faces.push({
        first: false,
        blank: true,
        body: [],
        cursor: F_TOP0,
        frameBot: F_BOT0,
        stretch: 0,
        /* 整面一个非答题区：从红框上限一直铺到红框下限 */
        noAnswer: true,
        noAnswerTop: F_TOP0,
        noAnswerH: contentH0,
        usable: Pager.usableH(p0),
        hasSubj: false
      });
      blankFaces = 1;
    }
    /* 让 Pager.lastDebug 与**补齐后**的 faces 同步 —— 否则 .ref 探针读到的
       面数比预览里少一面（凑偶数的那面是这里补的，已经走完 paginate 了）。 */
    Pager.noteFaces(faces);

    /* ⚠ sheetCount 必须在 faces **补齐之后**再算 —— 原来在 paginate 之后
       立刻算，凑出来的那面就落不进 for 循环里，预览里看不到。
       ⚠ 而且 perSheet / paper 必须**先**声明：原来它们写在这行下面，
         `var` 提升后这里读到的是 undefined，`faces.length / undefined` = NaN，
         `NaN || 1` = 1 —— 于是 4 面只渲染出 1 面（实测就是这个问题）。 */
    var perSheet = opt.format === 'A3' ? C.A3_COLUMNS : 1;
    var paper = C.PAPER[opt.format];
    var sheetCount = Math.ceil(faces.length / perSheet) || 1;

    /* 几何：顶部定标带行心 y（角标与它同心，规则③）。
       定标带整条高 = 填涂框高（A4 2.435 / A3 2.398），行心 11mm 时
       占 9.78–12.22mm；标题文字从 14mm 起排，两者留 1.78mm 净空。
       原来放在 15.66mm，正好压住标题第一行。 */
    var TOP_BAND_CY = 11;
    var topBandY = TOP_BAND_CY;

    var violations = [];
    var out = '';
    var specialPos = {};

    for (var s = 0; s < sheetCount; s++) {
      var faceViews = [];
      for (var fi = 0; fi < perSheet; fi++) {
        var idx = s * perSheet + fi;
        var face = faces[idx];
        /* 这一面有没有选择题网格？没有就传 null，
           让 layoutFace 不画「题号行/选项行」那列左侧定标块（否则会悬空错位）。 */
        var choiceBlock = (face && face.body.length && face.body[0].kind === 'choice')
          ? face.body[0] : null;
        var gridTop = choiceBlock ? choiceBlock.gridTop : null;
        /* 本面选择题排了几行 —— 每一行都要一列左侧定位点（见 layoutFace）。 */
        var choiceLines = choiceBlock ? choiceBlock.rows : 0;

        var extraRows = (face && face.first) ? Page.specialRows() : [];
        extraRows.forEach(function (r) { specialPos[r.kind + 'Cy'] = r.cy; });

        var page = G.layoutPage({
          format: opt.format,
          preset: preset,
          cornerInsetX: preset.cornerInsetX,
          topBandY: topBandY,
          gridTop: gridTop,
          choiceLines: choiceLines,
          extraRows: extraRows
        });
        var L = page.faces[fi];

        if (face) {
          violations = violations.concat(
            G.selfTest({ format: opt.format, paper: paper, faces: [L] }));
        }

        faceViews.push({
          L: L,
          html: face ? renderFaceBody(face, preset) : '',
          first: face ? face.first : false
        });

        /* 几何结果留一份引用，供 .ref/ 下的校验脚本（dom_verify.mjs 等）
           读取「JS 算出的坐标」并与浏览器实际排版结果对照。 */
        AS.__faces = AS.__faces || [];
        AS.__faces[idx] = L;
      }

      out += '<div class="page-wrap" data-sheet="' + (s + 1) + '">' +
             '<div class="page-tag">第 ' + (s + 1) + ' 张 · ' +
             (opt.format === 'A3' ? 'A3 三面' : 'A4 单面') + ' · ' +
             paper.w + '×' + paper.h + 'mm</div>' +
             Page.render({
               format: opt.format,
               paperH: paper.h,
               faces: faceViews,
               meta: opt.meta,
               pageNo: s + 1,
               total: sheetCount,
               specialPos: specialPos
             }) +
             '</div>';
    }

    return {
      html: out, faces: faces, sheetCount: sheetCount,
      blankFaces: blankFaces,
      violations: violations, paper: paper, preset: preset
    };
  }

  /** 量出首页「标题行」**需要**的高度（mm）。没有标题行时返回 null。
   *
   * ⚠ 量的是标题内容本身，不是 .as-head-title 的行高。
   *   行高带 min-height: var(--head-title-h)，把它量回来当输入会形成正反馈：
   *   28.24 → 28.63 → … 每渲染一次长高一点，页眉越来越厚。
   *   所以这里只量主/副标题的盒高与副标题的上下外边距，再自己加上内上留白。 */
  function measureTitleH() {
    var card = $('stage').querySelector('.as-page');
    if (!card) return null;
    var row = card.querySelector('.as-head-title');
    if (!row) return null;

    var st = card.closest('.preview-stage');
    var m = st ? getComputedStyle(st).transform : 'none';
    var k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\(([^,]+)/) || [0, 1])[1]);
    /* getBoundingClientRect 会被预览缩放影响，除回去才是真实 mm */
    var toMM = function (v) { return Math.round((v * 25.4 / 96 / k) * 1000) / 1000; };

    var padTop = toMM(parseFloat(getComputedStyle(row).paddingTop) || 0);
    var content = 0;
    ['.as-title-main', '.as-title-sub'].forEach(function (sel) {
      var e = row.querySelector(sel);
      if (!e) return;
      var cs = getComputedStyle(e);
      content += toMM(e.getBoundingClientRect().height) +
                 toMM(parseFloat(cs.marginTop) || 0) +
                 toMM(parseFloat(cs.marginBottom) || 0);
    });
    if (content <= 0) return null;
    return Math.round(Math.max(Page.CHROME.rowTitle, padTop + content) * 1000) / 1000;
  }

  function generate() {
    var opt = readOptions();
    var stage = $('stage');

    /* 第一遍：用上次测到的标题行高（或默认值）排一遍。
       标题换行会让首页页眉变高，正文起点必须跟着下移，否则正文会被页眉压住。
       标题高度依赖字体度量，JS 算不准 —— 所以先渲染、量出来、再排第二遍。 */
    Page.setTitleHeight(measuredTitleH === null ? Page.CHROME.rowTitle : measuredTitleH);
    var r1 = renderAll(opt);
    stage.innerHTML = r1.html;
    applyThemeToStage();
    fitFrames(r1.faces);
    fitNoAnswer();

    /* 量标题行需要的高度；与当前用的值不同就重排一次 */
    var th = measureTitleH();
    var r = r1;
    if (th !== null && Math.abs(th - Page.CHROME.rowTitle) > 0.05) {
      measuredTitleH = th;
      Page.setTitleHeight(th);
      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
      fitFrames(r.faces);
      fitNoAnswer();
    }

    applyZoom();

    state.faces = r.faces;
    /* 最近一次生成用的选项，供 .ref/ 校验脚本复算分页结果 */
    AS.__lastOptions = opt;
    updateStats(opt, r.faces.length, r.sheetCount);
    showStatus(r.violations, opt, r.faces.length);
    $('btnPdf').disabled = false;
    $('previewInfo').textContent =
      '共 ' + r.sheetCount + ' 张 / ' + r.faces.length + ' 面 · ' + opt.format +
      ' · ' + (opt.theme === 'color' ? '双色' : '黑白') +
      (r.blankFaces ? ' · 含 1 面非答题区（凑偶数）' : '');
  }

  function applyThemeToStage() {
    var stage = $('stage');
    var preset = C.PRESETS[state.format];
    Theme.apply(stage, state.theme);
    Theme.applyPreset(stage, preset, state.format);
    Theme.applyFonts(stage);
    stage.querySelectorAll('.as-page').forEach(function (el) {
      Theme.apply(el, state.theme);
      Theme.applyPreset(el, preset, state.format);
      Theme.applyFonts(el);
    });
  }

  /* ── 状态 ──────────────────────────────────────────────────────────── */
  /* 几何自检是内部保障，正常时**不打扰用户**（只写控制台）；
     只有真的出现不对齐时才提示。 */
  function showStatus(violations, opt, faceCount) {
    var el = $('status');
    if (violations && violations.length) {
      el.className = 'status err show';
      el.innerHTML = '<span class="status-icon">!</span><div class="status-body">' +
        '<b>排版自检发现 ' + violations.length + ' 处不对齐</b><ul>' +
        violations.slice(0, 8).map(function (v) { return '<li>' + v + '</li>'; }).join('') +
        '</ul></div>';
      console.warn('[答题卡] 几何自检未通过：', violations);
    } else {
      el.className = 'status';
      el.innerHTML = '';
      console.debug('[答题卡] 几何自检通过：定位块与填涂框严格对齐（' + faceCount + ' 面）');
    }
  }

  function updateStats(opt, faceCount, sheetCount) {
    $('statFormat').textContent = opt.format;
    $('statFaces').textContent = faceCount;
    $('statChoice').textContent = opt.choiceTotal;
    $('statSubj').textContent = opt.subjItems.length;
  }

  /* ── 缩放 ──────────────────────────────────────────────────────────── */
  function applyZoom() {
    var stage = $('stage');
    stage.style.transform = 'scale(' + state.zoom + ')';
    stage.style.width = (100 / state.zoom) + '%';
    $('zoomVal').textContent = Math.round(state.zoom * 100) + '%';
  }

  function fitZoom() {
    var avail = $('preview').clientWidth - 48;
    var paperW = C.PAPER[state.format].w;
    var pxPerMm = 96 / 25.4;
    var need = paperW * pxPerMm;
    state.zoom = Math.max(0.2, Math.min(1, avail / need));
    applyZoom();
  }

  /* ── 事件 ──────────────────────────────────────────────────────────── */
  /** 把分段控件的高亮切到某个值（不触发重排，供恢复存档/复位用） */
  function setSeg(id, val) {
    var el = $(id);
    if (!el) return;
    el.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.val === val);
    });
  }

  function updateFormatHint(v) {
    var h = $('formatHint');
    if (!h) return;
    h.textContent = v === 'A4'
      ? 'A4 每张 1 面，一行铺满；气泡竖长便于填涂。'
      : 'A3 每张 3 面并排，5 题一块、每行 4 块；适合正式考试。';
  }

  function bindSeg(id, key, after) {
    var el = $(id);
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-val]');
      if (!btn) return;
      el.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      state[key] = btn.dataset.val;
      if (after) after(btn.dataset.val);
      saveForm();
      generate();
    });
  }

  function init() {
    bindSeg('segFormat', 'format', updateFormatHint);

    $('themePick').addEventListener('click', function (e) {
      var card = e.target.closest('.theme-card');
      if (!card) return;
      $('themePick').querySelectorAll('.theme-card').forEach(function (c) { c.classList.remove('on'); });
      card.classList.add('on');
      state.theme = card.dataset.theme;
      saveForm();
      applyThemeToStage();
    });

    $('btnGenerate').addEventListener('click', generate);
    $('btnClear').addEventListener('click', resetForm);
    $('zoomIn').addEventListener('click', function () {
      state.zoom = Math.min(2, state.zoom + 0.1); applyZoom();
    });
    $('zoomOut').addEventListener('click', function () {
      state.zoom = Math.max(0.2, state.zoom - 0.1); applyZoom();
    });
    $('zoomFit').addEventListener('click', fitZoom);

    // 参数变化即时重排（防抖），同时记进 localStorage
    var t = null;
    FIELD_IDS.forEach(function (id) {
      $(id).addEventListener('input', function () {
        saveForm();
        clearTimeout(t);
        t = setTimeout(generate, 260);
      });
    });

    $('btnPdf').addEventListener('click', exportPdf);

    /* 恢复上次填的参数，再生成。
       顺序很重要：必须在 bindSeg 之后、generate 之前 ——
       恢复要直接改 state 并切高亮，不能走 click 事件（否则会重复渲染）。 */
    restoreSaved();

    generate();
    setTimeout(fitZoom, 60);
  }

  /* ── 导出 PDF（矢量） ─────────────────────────────────────────────────
   * 文字可选中、可搜索；框线/定位点/气泡是矢量，任意缩放都锐利。
   *
   * 实现分三层（都在 js/pdf/ 下，与 app.js 解耦）：
   *   measure.js  把渲染好的 DOM「读」成绘制清单（坐标一律 mm）
   *   draw.js     把清单画到 jsPDF（字体按需 fetch + 内嵌子集）
   *   vector.js   串起来，逐张纸出一页
   *
   * 为什么坐标要从 DOM 量、而不是重新算：
   *   几何算两遍必然漂移。量的是**已经排版好的那一份**，
   *   所以导出件与预览天然一致 —— 实测 PDF 字节里的
   *   162 个矩形与 89 条文字基线，与绘制清单的偏差分别是
   *   0.0005mm 和 0.0000mm。
   *
   * 字体：
   *   内嵌 SimHei / SimSun 的**子集**（各 ~230KB / ~290KB，
   *   fsType=0x0008 允许嵌入）。导出时才 fetch，不进 index.html 首屏。
   *   子集是按答题卡用到的字符生成的，用户填了字库里没有的字会缺字形 ——
   *   checkCoverage() 会查出来并告知，不会静默出豆腐块。
   * ------------------------------------------------------------------- */
  function exportPdf() {
    if (!AS.pdfVector) { exportPdfRaster(); return; }
    var stage = $('stage');
    if (!stage.querySelector('.as-page')) { alert('请先生成答题卡。'); return; }

    var btn = $('btnPdf');
    var oldLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在导出…';

    var cover = document.createElement('div');
    cover.className = 'as-export-cover';
    cover.innerHTML = '<div class="as-export-cover-box">正在导出 PDF…</div>';
    document.body.appendChild(cover);

    var paper = C.PAPER[state.format];
    var meta = readMeta();
    var name = (meta.title + '_' + meta.subject + '答题卡').replace(/[\\/:*?"<>|]/g, '');

    function cleanup() {
      if (cover.parentNode) document.body.removeChild(cover);
      btn.disabled = false;
      btn.textContent = oldLabel;
    }

    function setCover(txt) {
      var box = cover.querySelector('.as-export-cover-box');
      if (box) box.textContent = txt;
    }

    var t0 = (global.performance || Date).now();
    function step(msg) {
      if (global.console) {
        console.log('[答题卡] ' + msg + '  +' +
          Math.round((global.performance || Date).now() - t0) + 'ms');
      }
    }
    step('矢量导出开始');

    setCover('正在加载中文字体…');
    AS.pdfVector.render({
      stage: stage,
      format: state.format,
      theme: state.theme,
      onProgress: function (i, n) { setCover('正在排版第 ' + i + ' / ' + n + ' 页…'); }
    }).then(function (r) {
      step('排版完成：' + JSON.stringify(r.stats));
      /* 缺字形不是致命错误，但必须让用户知道 —— 否则打印出来是一排豆腐块 */
      if (r.missing && r.missing.length) {
        var miss = r.missing.slice(0, 12).join('');
        alert('导出完成，但有 ' + r.missing.length + ' 个字不在内置字体里，' +
              '可能在 PDF 中显示为空白：\n\n' + miss +
              (r.missing.length > 12 ? ' …' : '') +
              '\n\n（内置字体只覆盖答题卡常用字；如需要请告知，我把字库扩上。）');
      }
      var uri = r.pdf.output('datauristring');
      step('dataURI 生成完成，长度 ' + (uri ? uri.length : 0));
      var a = document.createElement('a');
      a.href = uri;
      a.download = name + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      cleanup();
    }).catch(function (err) {
      step('失败：' + (err && err.message ? err.message : err));
      if (global.console) console.error('[答题卡] 矢量导出失败', err);
      cleanup();
      /* 矢量链路挂了就退回位图链路 —— 宁可比预览糊一点，也不能导不出来。
         ⚠ 但要让用户知道退回去了，不要静默降级。 */
      if (global.console) console.warn('[答题卡] 退回位图导出');
      exportPdfRaster();
    });
  }

  /* ── 导出 PDF（位图，兜底） ───────────────────────────────────────────
   * 把纸面截成 300DPI PNG 塞进 PDF。保真度最高（就是预览本身），
   * 但文字不可选、放大会糊、文件大（~330KB/页）。
   *
   * ⚠ 踩过的坑，改动前务必先读：
   *
   * 1. 导出用的包装**必须是 position:static（正常文档流）**。
   *    实测把整叠纸（多张 .as-page）交给 html2canvas：
   *      static          → canvas 794×3368  ✅
   *      absolute/fixed  → canvas 794×0     ❌（宽度对、高度 0）
   *    高度 0 的画布交给 jsPDF，导出的就是一张白纸。
   *    （html2pdf 内部会建一个 .html2pdf__container 包住克隆节点，
   *      包装一旦脱离文档流，容器的盒子高度就量成 0。）
   *
   * 2. 包装**不能放到 left:-10000px 离屏**，同样是高度 0。
   *    也不能用 visibility:hidden / opacity:0 —— html2canvas 会渲染成纯白。
   *    这里用 static + 遮罩挡住。
   *
   * 3. 图像类型用 png 不用 jpeg：0.3mm 的红框线和黑色定位块在 JPEG 下
   *    会被压缩糊掉，导出的卡会缺定位块。
   * ------------------------------------------------------------------- */
  /* ── 导出 PDF（位图，兜底） ───────────────────────────────────────────
   * 把纸面截成 300DPI PNG 塞进 PDF。保真度最高（就是预览本身），
   * 但文字不可选、放大会糊、文件大（~330KB/页）。
   *
   * ⚠ 踩过的坑，改动前务必先读：
   *
   * 1. 导出用的包装**必须是 position:static（正常文档流）**。
   *    实测把整叠纸（多张 .as-page）交给 html2canvas：
   *      static          → canvas 794×3368  ✅
   *      absolute/fixed  → canvas 794×0     ❌（宽度对、高度 0）
   *    高度 0 的画布交给 jsPDF，导出的就是一张白纸。
   *    （html2pdf 内部会建一个 .html2pdf__container 包住克隆节点，
   *      包装一旦脱离文档流，容器的盒子高度就量成 0。）
   *
   * 2. 包装**不能放到 left:-10000px 离屏**，同样是高度 0。
   *    也不能用 visibility:hidden / opacity:0 —— html2canvas 会渲染成纯白。
   *    这里用 static + 遮罩挡住。
   *
   * 3. 图像类型用 png 不用 jpeg：0.3mm 的红框线和黑色定位块在 JPEG 下
   *    会被压缩糊掉，导出的卡会缺定位块。
   * ------------------------------------------------------------------- */
  /* ── 导出 PDF（位图，兜底） ───────────────────────────────────────────
   * 把纸面截成 300DPI PNG 塞进 PDF。保真度最高（就是预览本身），
   * 但文字不可选、放大会糊、文件大（~330KB/页）。
   *
   * ⚠ 踩过的坑，改动前务必先读：
   *
   * 1. 导出用的包装**必须是 position:static（正常文档流）**。
   *    实测把整叠纸（多张 .as-page）交给 html2canvas：
   *      static          → canvas 794×3368  ✅
   *      absolute/fixed  → canvas 794×0     ❌（宽度对、高度 0）
   *    高度 0 的画布交给 jsPDF，导出的就是一张白纸。
   *    （html2pdf 内部会建一个 .html2pdf__container 包住克隆节点，
   *      包装一旦脱离文档流，容器的盒子高度就量成 0。）
   *
   * 2. 包装**不能放到 left:-10000px 离屏**，同样是高度 0。
   *    也不能用 visibility:hidden / opacity:0 —— html2canvas 会渲染成纯白。
   *    这里用 static + 遮罩挡住。
   *
   * 3. 图像类型用 png 不用 jpeg：0.3mm 的红框线和黑色定位块在 JPEG 下
   *    会被压缩糊掉，导出的卡会缺定位块。
   * ------------------------------------------------------------------- */
  function exportPdfRaster() {
    if (typeof html2pdf === 'undefined') {
      alert('PDF 库加载完成前无法导出，请稍后重试。');
      return;
    }
    var stage = $('stage');
    if (!stage.querySelector('.as-page')) { alert('请先生成答题卡。'); return; }

    var btn = $('btnPdf');
    var oldLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在导出…';
    var scrollY = global.scrollY || 0;

    /* 盖住整屏，让用户在导出期间看不到被撑高的文档。
       ⚠ 这个遮罩必须放在 wrap **外面** —— html2canvas 只渲染 wrap 子树，
         放在外面就不会被截进去。 */
    var cover = document.createElement('div');
    cover.className = 'as-export-cover';
    cover.innerHTML = '<div class="as-export-cover-box">正在导出 PDF…</div>';
    document.body.appendChild(cover);

    /* 包装必须是 position:static（正常文档流）：
       实测把整叠纸交给 html2canvas 时，static → canvas 794×3368；
       absolute/fixed → canvas 794×0（宽度对、高度 0），导出的 PDF 全白。
       ⚠ 也不能用 visibility:hidden 或 opacity:0 隐藏包装 ——
         html2canvas 会把整张画布渲染成纯白（实测 nonWhite = 0）。
         所以靠上面的遮罩来挡，包装本身保持完全可见。 */
    var wrap = document.createElement('div');
    wrap.className = 'as-export-wrap';
    wrap.style.background = '#fff';
    wrap.innerHTML = stage.innerHTML;
    document.body.appendChild(wrap);
    global.scrollTo(0, 0);

    Theme.apply(wrap, state.theme);
    Theme.applyPreset(wrap, C.PRESETS[state.format], state.format);
    Theme.applyFonts(wrap);
    wrap.querySelectorAll('.as-page').forEach(function (el) {
      Theme.apply(el, state.theme);
      Theme.applyPreset(el, C.PRESETS[state.format], state.format);
      Theme.applyFonts(el);
    });
    // 面分隔虚线只是预览提示，不进导出件
    wrap.querySelectorAll('.as-face-guide').forEach(function (el) { el.style.display = 'none'; });
    /* ⚠ 「第 N 张 · A4 单面 · 210×297mm」那行也是**预览提示**（.page-tag），
       它挂在 .page-wrap 上、在纸面之外，不隐藏就会被 html2canvas 一起截进
       PDF（每张纸顶部多出一行字）。原来只隐藏了 .as-face-guide，漏了它。 */
    wrap.querySelectorAll('.page-tag').forEach(function (el) { el.style.display = 'none'; });
    // 还原缩放：导出必须 1:1
    wrap.querySelectorAll('.preview-stage').forEach(function (el) {
      el.style.transform = 'none';
      el.style.width = 'auto';
    });

    var fmt = state.format;
    var paper = C.PAPER[fmt];
    var meta = readMeta();
    var name = (meta.title + '_' + meta.subject + '答题卡').replace(/[\\/:*?"<>|]/g, '');

    function cleanup() {
      if (wrap.parentNode) document.body.removeChild(wrap);
      if (cover.parentNode) document.body.removeChild(cover);
      btn.disabled = false;
      btn.textContent = oldLabel;
      global.scrollTo(0, scrollY);
    }

    /* ── 导出流程 ────────────────────────────────────────────────────────
     * 分两步，两步都实测过：
     *   ① 逐张纸 toCanvas() —— 单张纸截出来是对的（1588×2246 @scale2）。
     *   ② 把这些画布纵向拼成一张大画布，塞回 worker 的 prop.canvas，
     *      再走它自己的 toPdf() 分页。
     *
     * 为什么不把「整叠纸」直接交给 html2canvas：它只截出一张纸的高度。
     *   原因：.as-page 在 .page-wrap 里，克隆到 html2pdf 的容器后
     *   每张纸都从容器顶部开始，互相重叠，容器高度只等于一张纸。
     *   （实测 2 张纸 → canvas 1588×2246，第 3 页全白。）
     *
     * 拼成一张的好处：大画布高 = 张数 × 单张高，正好被 pageSize 整除，
     * toPdf() 分页得到的页数不多不少，每页内容完整。
     * ------------------------------------------------------------------ */
    var pages = Array.prototype.slice.call(wrap.querySelectorAll('.as-page'));
    var opts = function () {
      return {
        margin: 0,
        filename: name + '.pdf',
        /* ⚠ 必须是 png，不能是 jpeg（实测）。
           答题卡命脉是 0.3mm 红框线、0.7mm 黑色定位块、气泡细描边。
           把同一张纸的 canvas 编码再解码回来逐像素比对：
             png        → 0 个像素变化（无损）
             jpeg 0.98  → 198581 个像素被改，最大通道差 168
             jpeg 0.92  → 217827 个像素被改，**4294 个纯白像素被染成灰**
           JPEG 的 8×8 DCT 会把定位块边缘糊出灰晕，OMR 读的就是这些块。

        ⚠ jsPDF 必须开 compress —— 不开的话 PNG 是**原样嵌入**：
             不开：单页 PDF 14.3 MB（zlib 没跑）
             开：  单页 PDF 0.23 MB（Flate 压掉 60 倍，仍然无损）
           所以「PNG 太大」这个印象是 compress 默认关闭造成的，
           不是 PNG 本身的问题。这里是两边都要：无损 + 小。 */
        image: { type: 'png' },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: [paper.w, paper.h], orientation: paper.orientation,
                 compress: true, compression: 'FAST' }
      };
    };

    /* 进度打点：导出链路较长（逐纸 toCanvas → 拼接 → toPdf → dataURI），
       出问题时要能一眼看出卡在哪一步。只在 console 输出，界面上不显示。 */
    var t0 = (global.performance || Date).now();
    function step(msg) {
      if (!global.console) return;
      console.log('[答题卡] ' + msg + '  +' +
        Math.round(((global.performance || Date).now() - t0)) + 'ms');
    }
    step('导出开始，共 ' + pages.length + ' 张纸');

    var chain = Promise.resolve([]);
    pages.forEach(function (pageEl, pi) {
      chain = chain.then(function (acc) {
        step('第 ' + (pi + 1) + ' 张 toCanvas 开始');
        var w = html2pdf().set(opts()).from(pageEl);
        /* ⚠ 读 w.prop.canvas，不要用 .get('canvas')：
           get() 返回的是 worker 的当前任务结果（一个 Worker 对象），不是画布。 */
        return w.toCanvas().then(function () {
          var cv = w.prop.canvas;
          if (!cv || !cv.width || !cv.height) {
            throw new Error('第 ' + (acc.length + 1) + ' 张渲染为空');
          }
          acc.push(cv);
          step('第 ' + (pi + 1) + ' 张 toCanvas 完成 ' + cv.width + 'x' + cv.height);
          return acc;
        });
      });
    });

    chain.then(function (canvases) {
      /* ── 纵向拼接 ────────────────────────────────────────────────────
         html2pdf 的 toPdf() 是这样切页的（已读源码确认）：

             o = Math.floor(canvas.width * pageSize.inner.ratio)   // 每页 n 像素
             s = Math.ceil(totalH / o)                            // 页数
             最后一张若 totalH % o !== 0：
                 a.height = totalH % o                            // ← 只有几像素
                 i = a.height * inner.width / canvas.width        // ← 又按比例放大

         ⚠ **最后一张不是被丢掉，而是被拉伸成整页。** 所以只要 totalH 不是
           o 的整数倍，PDF 末尾就会多出一张「把 2 像素拉满整页」的浅色纸
           （实测：2 张纸 → 3 页，第 3 页是 2px）。

         ⚠ 页高不能拿 `toPx`（mm×k/72×96）当准 —— `inner.ratio` 是
           `inner.height / inner.width` 的浮点商，带精度误差，
           `floor(1588 × 1.4142857142857144) = 2245`，
           而 `toPx(297) × 2 = 2246`。差这 1 像素就是那张 sliver 的成因。

         ⚠ 也不能用 `html2pdf().set(...).setPageSize()` 去探 pageSize。
           踩过的坑（导出整个卡死在这一步）：`setPageSize()` 内部先取
             `jsPDF.getPageSize(this.opt.jsPDF)`
           而 `opt.jsPDF` 在 `.toPdf()` 之前一直是**配置对象**、还没实例化，
           于是 `prop.pageSize` 恒为 null，
           `probe0.prop.pageSize.px.height` 抛
             TypeError: Cannot read properties of null (reading 'px')
           —— 表现为「toCanvas 全部成功，然后在拼接那一步炸掉」。

         正确做法：自己解。设拼合画布高 H，则
             o(H) = floor(canvasW * innerHeight / innerWidth)
         要求 H = n × o(H)。由 H / (H − n) 夹出 innerHeight 的候选值，
         `1/mm2px` 就是「每 mm 多少像素」的整数倍（mm 是 jsPDF 单位），
         零件性由构造保证。下面用整数算术逼近，不需要任何浮点系数。 */
      var single = canvases[0];
      var n = canvases.length;
      var cw = single.width;
      /* 每页的 canvas 像素高 o。实测 + 推演：
           o = 纸张高(px) × scale − 1
         来源是 html2pdf 的 `inner.ratio = inner.height / inner.width`，
         这个浮点商比真值略小，`floor(canvasW × ratio)` 就比整页像素少 1。
         A4 实测：canvasW=1588 → o=2245，而单张纸是 2246。
         这 1 像素就是「末尾多一张 2px 白纸」的成因。 */
      var ph = Math.round(paper.h / 25.4 * 96);        // 纸张高，CSS 像素
      var o = ph * 2 - 1;                              // scale 固定 2
      if (o > single.height) o = single.height;
      if (o < 1) o = single.height;
      /* 总高 = 页数 × 页高 ⇒ toPdf 的 totalH % o === 0，最后一张不再被
         拉成 sliver（否则它会把 1~2 像素放大成整页浅色纸）。 */
      var H = n * o;

      var combined = document.createElement('canvas');
      combined.width = cw;
      combined.height = H;
      var cx = combined.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, combined.width, combined.height);
      canvases.forEach(function (cv, i) {
        /* 每张纸画进**恰好 o 像素**高的槽位。
           单张可能比 o 多 1 像素，直接 drawImage 会把它压掉 ——
           这点差别肉眼不可见，但换来的是「页数不多不少」。 */
        cx.drawImage(cv, 0, 0, cv.width, cv.height, 0, i * o, cw, o);
      });
      step('拼接完成 ' + combined.width + 'x' + combined.height +
           '（单张高 ' + single.height + '，页高 ' + o + '，' + n + ' 张）');

      /* 用一个 worker 跑 toPdf()：把拼好的画布写进 prop.canvas，
         它就会按 pageSize 自动分页并生成 PDF。 */
      var w0 = html2pdf().set(opts()).from(wrap);
      return w0.toContainer().then(function () {
        step('toContainer 完成，开始 toPdf');
        w0.prop.canvas = combined;
        w0.prop.pdf = null;
        return w0.toPdf().outputPdf('datauristring');
      });
    }).then(function (dataUri) {
      step('dataURI 生成完成，长度 ' + (dataUri ? dataUri.length : 0));
      var a = document.createElement('a');
      a.href = dataUri;
      a.download = name + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }).then(function () {
      cleanup();
    }).catch(function (err) {
      step('失败：' + (err && err.message ? err.message : err));
      cleanup();
      alert('导出失败：' + (err && err.message ? err.message : err));
      if (global.console) console.error('[答题卡] 导出失败', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 暴露给调试/自检用（不影响页面行为） */
  AS.app = {
    state: state,
    generate: generate,
    exportPdf: exportPdf,
    readOptions: readOptions,
    readMeta: readMeta,
    readSubjItems: readSubjItems,
    renderFaceBody: renderFaceBody
  };
})(window);
