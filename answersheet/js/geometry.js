/* =============================================================================
 * 答题卡生成器 · 网格几何
 * -----------------------------------------------------------------------------
 * 本模块是「定位块与填涂框严格对齐」的唯一保障：
 * 气泡、题号、顶部定标带、左侧定标带、四角角标 —— 全部由同一份坐标计算产出。
 * 任何地方都不允许再单独算一套定位块位置。
 *
 * 坐标一律 mm，原点在页面左上角，y 向下。
 *
 * ── 「面」抽象 ──────────────────────────────────────────────────────────
 *   A4 纵向 : 1 面 / 页
 *   A3 横向 : 3 面并排 / 页（面之间留装订间隔）
 * 面内布局完全一致，只是整体平移 —— A3/A4 共用同一套排版逻辑。
 *
 * ── 对齐规则（用户确认） ────────────────────────────────────────────────
 *   ① 顶部定标带：节距 = 气泡列距，块心 x 对齐列心 x；整条居中
 *   ② 左侧定标带：题号行 + A/B/C/D，块心 y 对齐行心 y
 *   ③ 角标中心 x = 左侧定标带列心 x
 *      角标中心 y = 顶部定标带行心 y
 *   ④ 定位块尺寸 = 填涂框尺寸
 *   ⑤ 网格严格等距，空行/空列用同尺寸占位
 *
 * 顶部定标带是**独立的页面定标条**（位于页面顶部），
 * 其行心 y 与角标中心 y 一致，但不要求等于选择题第一行的行心 y。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;

  function r3(v) { return Math.round(v * 1000) / 1000; }

  /**
   * 填涂框（气泡）高度 = 宽 × 3/5 —— 与 css/card.css 的 calc(var(--block-w) * 3 / 5) 同源。
   * 定位块必须用同一个值，否则「定位块尺寸 = 填涂框尺寸」会被破坏。
   */
  function bubbleH(p) { return r3(p.blockW * 3 / 5); }

  /** 从 CSS 长度串（如 "9.5pt"）取出数值 */
  function ptOf(v, fallback) {
    var m = String(v === undefined || v === null ? '' : v).match(/(-?[\d.]+)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  /** 题号行高度：字号 × 行高倍数（css 里 .as-choice-num 是 line-height:1） */
  var NUM_LINE_HEIGHT = 1;
  function numRowH(p) {
    var fs = ptOf(C.TYPE && C.TYPE.num && C.TYPE.num.size, 9.5);
    return r3(fs * 25.4 / 72 * NUM_LINE_HEIGHT);
  }

  /** 一列内部的行中心偏移（相对列顶）：题号行 / A / B / C / D
   *  实际盒模型：题号行 → gap → 气泡行 → gap → …（gap 与 CSS 的 --col-gap 同源）
   *
   *  ⚠ colGap 必须是「整设备像素」的毫米值（96dpi 下 1px = 0.264583mm）。
   *  浏览器会把 flex gap 吸附到整数像素，若 preset 里给的是非整像素值
   *  （例如 1.845mm），CSS 实际用 7px=1.852mm，而行心却按 1.845mm 算，
   *  每行累积约 0.007mm、五行约 0.03mm，最上面那行就会与定标块错开半毫米。
   *  见 pxMM() —— 用「像素 → 毫米」生成 colGap，两边口径就一致了。 */
  function pxMM(px) { return r3(px * 25.4 / 96); }

  /** 把毫米值吸附到整设备像素（96dpi）。浏览器对 padding/border/gap 就是这么做的，
   *  两边用同一个吸附函数，才能保证「算出来的行心」= 「排出来的行心」。 */
  function snapMM(mm) { return pxMM(Math.round(mm * 96 / 25.4)); }

  /**
   * 红框顶 → 网格层「绝对定位包含块」上缘 的偏移。
   *
   * 定位祖先选 **.as-choice-section**（它已经是 absolute 定位，且
   * padding/border 全为 0）——于是它的内边距盒上缘 == 它自己的上缘，
   * 也就是分页器给出的 boxTop。绝对定位子元素 top:0 恰好落在 boxTop，
   * 不掺任何浏览器对 padding 的二次取整，两边口径完全一致。
   *
   * 所以这里恒为 0，保留函数只为把「为什么是 0」写清楚、并留一处改动点。
   */
  function gridCbOffset(preset) {
    return 0;
  }

  /**
   * 红框顶 → **黑框（.as-choice-inner）边框盒上缘** 的偏移。
   * = 红框线 + 红框上内边距 + 栏目头 + 栏目头下间距
   *
   * ⚠ 不含黑框的上内边距 —— 那是黑框**内**的空档（innerPadTop，3mm），
   *   由 choiceChromeH 计入网格位置。这里只到黑框边框盒上缘。
   */
  function choiceHeadH(preset) {
    var off = boxOffsets(preset);
    return r3(off.border + off.outerPadY + off.headerH + off.headerGap);
  }

  /**
   * 红框顶 → **网格内容顶** 的偏移（分页器与 builder 共用）。
   *
   * 结构（自上而下）：
   *   红框顶
   *   + 红框线 border
   *   + 红框上内边距 outerPadY
   *   + 栏目头 headerH
   *   + 栏目头下间距 headerGap
   *   + 黑框线 border
   *   = 网格（题号行）上缘
   *
   * ⚠ 本函数与 choiceChromeH 现在只差**一道黑框线**：
   *   本函数到「黑框边框盒上缘」，choiceChromeH 到「网格上缘」。
   *   黑框已无纵向内边距（见 boxOffsets），所以两者相差恒为 off.border。
   *   分页器用 choiceChromeH 排网格，builder 由 gridTop 反推黑框 margin-top。
   */
  function choiceChromeH(preset) {
    var off = boxOffsets(preset);
    return r3(off.border + off.outerPadY + off.headerH + off.headerGap +
              off.border + off.innerPadTop);
  }

  /**
   * **网格底缘 → 红框外缘底** 的高度。
   *
   * ⚠ 分页器必须用它把游标推到红框底，否则「非选择题」会压在红框下沿上。
   *   实测漏掉它时：红框 60.26→98.44，非选择题却从 93.90 开始，
   *   重叠 896mm²（红框的下边框和圆角被非选择题的标题压住）。
   *
   * 结构（自上而下）：黑框下内边距 + 黑框线 + 红框下内边距 + 红框线。
   *
   * ⚠ 黑框**下内边距**（innerPadBottom）用户指定为 3mm —— 即「选项最后
   *   一行到黑框底边的距离固定 3mm」。这是**黑框内**的空档，
   *   所以黑框必须比网格高 3mm，不能靠调红框下内边距来做
   *   （调红框只会让黑框和红框一起挪，黑框内的空档不变）。
   */
  function choiceFootH(preset) {
    var off = boxOffsets(preset);
    return r3(off.innerPadBottom + off.border + off.outerPadYBottom + off.border);
  }
  /* ═══════════════════════════════════════════════════════════════════════
   * 答题区（answerArea）—— 全卡纵向的**唯一基准**
   * -----------------------------------------------------------------------
   * 用户指定：
   *   「外围的红框应该上抵角落黑色定位点的下边缘，
   *     下达顶点黑色定位点的上边缘。」
   * 参照件 .ref/参照件实测骨架.md 实测（A4，mm）：
   *   上界 = 17.57（上角标下边缘）
   *   下界 = 279.77（下角标上边缘）
   *
   * ⚠ 这两个值**必须由角标反推**，不能写死 17.57 / 279.77 ——
   *   他们由 TOP_BAND_CY（定标带行心）与 cornerH 决定，
   *   改一个数就要跟着走，否则红框与角标又脱开。
   * ═══════════════════════════════════════════════════════════════════════ */

  /** 顶部定标带（含四角角标）的**行心** y（mm，面顶算）。
   *  角标与它同心 —— 见 `答题卡排版规格.md` §4 规则 1。 */
  var TOP_BAND_CY = 11;

  /** 答题区上界 = 上角标下边缘 */
  function answerTop(preset) {
    var p = preset;
    return r3(TOP_BAND_CY + p.cornerH / 2);
  }

  /** 答题区下界 = 下角标上边缘 */
  function answerBottom(preset, paperH) {
    var p = preset;
    var H = paperH || C.PAPER.A4.h;
    return r3(H - TOP_BAND_CY - p.cornerH / 2);
  }

  /** 答题区高度（mm） */
  function answerHeight(preset, paperH) {
    return r3(answerBottom(preset, paperH) - answerTop(preset));
  }

  /* 内容黑框的**外**净空（mm）—— 用户要求「小一点」的那两处。
     参照件实测：答题区提示 → 黑框外缘 = 1.36；红框外缘 → 黑框外缘 = 2.79。
     旧值 1.996（提示→黑框）用户明确要压到 0.5 左右。 */
  var TIP_GAP = 0.5;         // 答题区提示行 ↔ 黑框外缘
  var TIP_H = 4.0;           // 提示行自身高（参照件实测 3.98）
  /** 红框外缘 → 黑框外缘 = 红框线 + 红框内边距 + 黑框线。
   *  取 TIP_GAP 同级，让「提示同时贴近红框和黑框」（用户指定）。 */
  /* 红框允许超出答题区上下界的量 —— 用户 2026 指定：
     「红色边框上缘可以往上拉 0.7 个黑色定位点高度，下缘可以往下拉 0.7 个」。
     A4: cornerH = 4.23 → 0.7 × 4.23 = 2.961mm。

     ⇒ 红框可覆盖的纵向范围（不是答题区，答题区仍是 answerTop..answerBottom）：
          红框上缘上限 = answerTop  − frameExtend(p)
          红框下缘下限 = answerBottom + frameExtend(p)
     这两条是**硬边界**：分页器不得把红框推出去，否则会压到角落定位点。 */
  /* 红框相对答题区的内缩量 —— 用户 2026 最终口径：
     「上面往下 0.7（个定位点高度），下面往上 0.7」。
     方向是**内缩**（历史上一度写成外扩，方向反了）。
     A4: cornerH = 4.23 → 0.7 × 4.23 = 2.961mm。

     ⚠ 高度必须**写死**（见 frameHeight），不要用
       「页眉底 − frameExtend」之类的相对式 —— 那样红框高度会跟着页眉
       （标题换行、科目字数）漂移，用户要的是固定高度。 */
  var FRAME_INSET_K = 0.7;
  function frameExtend(preset) {
    var p = preset || PRESETS.A4;
    return r3(FRAME_INSET_K * p.cornerH);
  }
  /** 红框上缘（= 答题区上界 + 内缩） */
  function frameTopLimit(preset) {
    return r3(answerTop(preset) + frameExtend(preset));
  }
  /** 红框下缘（= 答题区下界 − 内缩） */
  function frameBottomLimit(preset, paperH) {
    return r3(answerBottom(preset, paperH) - frameExtend(preset));
  }
  /** 红框高度 —— **常量**，与页眉、题量都无关。
      用户 2026：「你不如把这个高度写死了」。
      A4 = (283.885 − 13.115) − 2 × 2.961 = 270.77 − 5.922 = 264.848 */
  function frameHeight(preset, paperH) {
    return r3(answerBottom(preset, paperH) - answerTop(preset) -
              2 * frameExtend(preset));
  }

  function frameGap(preset) {
    return TIP_GAP;
  }

  /** 内容黑框**外**的上下净空合计（含上下两句提示）
   *  = tipGap + tipH + tipGap  （上）+ (tipH + tipGap)（下）
   *  ⚠ 红框本体在下面的 pageFrameChrome 里算，这里只管黑框内的可用高度。 */
  function contentChrome(preset) {
    return r3(4 * TIP_GAP + 2 * TIP_H);
  }

  /** 气泡行之间的**行节距**（行心到行心，mm）= colGap + bubbleH。
   *  「行间空档」定位点必须按**同一个节距**接在上一行末气泡之后 ——
   *  用户指出「空出来的高度对应的那一行与上下定位点高度不均匀，
   *  比正常的高度要低」，就是因为原先把它放在两行正中间，
   *  与上下各差了约 0.55mm。 */
  function rowPitch(p) {
    return r3(p.colGap + bubbleH(p));
  }

  function rowOffsets(p) {
    var bh = bubbleH(p);
    var gap = p.colGap;
    var offs = [numRowH(p) / 2];
    var y = numRowH(p) + gap;
    for (var i = 0; i < p.optRows; i++) {
      offs.push(y + bh / 2);
      y += bh + gap;
    }
    return offs;
  }

  /** 一列总高（列顶 → 最后一个气泡底缘） */
  function columnHeight(p) {
    var offs = rowOffsets(p);
    return r3(offs[offs.length - 1] + bubbleH(p) / 2);
  }

  /**
   * 选择题外框/内框的几何偏移。
   *
   * 结构： .as-choice-outer(红框) > .as-choice-inner(黑框) > .as-choice-grid
   *
   * 水平方向是一条**单向链**，四个量各自独立、都可在 config 里调：
   *
   *   左侧定位点右边缘 (leftBandX + blockW/2)
   *     │  ← markGap  定位点到红框的距离
   *   红框外缘左 outerLeft
   *     │  ← border
   *   红框内容盒左
   *     │  ← boxGap   红框内缘到黑框外缘的距离（用户要压窄的就是它）
   *   黑框边框盒左 innerBorderLeft
   *     │  ← border
   *   网格左边框盒左  == gridLeft() 的返回值
   *
   * ⚠ 黑框**没有横向内边距**：黑框边框盒宽恒等于「网格宽 + 2×线」，
   *   所以网格紧贴黑框内缘、左右间隙都是 0。之前黑框比网格宽 2×innerPadX，
   *   居中之后左右各多出 2×innerPadX，实测左右各空 3.79mm —— 就是这个 bug。
   *
   * ⚠ 横向定位一律不用 padding：padding 会被浏览器吸附到整设备像素
   *   （3.725mm = 14.0787px → 14px），两层叠起来能把网格推偏 0.08~0.22mm，
   *   而顶部定标块是绝对定位的精确 mm，两者就错开了。margin 按小数生效。
   *   纵向仍可用 padding：纵向位置由分页器按精确 mm 算好，没有这一层的对齐要求。
   */
  function boxOffsets(preset) {
    var p = preset;
    var BORDER = 0.3;                                    // 红/黑框线宽（与 CSS 一致）
    /* 浏览器把 1.134px 的边框吸附成 1px = 0.2646mm。凡是用「边框盒宽」
       反推「内容盒宽」的地方都必须用这个**实际**值；用 0.3 会差 0.07mm，
       那 0.07mm 会全部堆到右边，表现为红框内缘→黑框外缘 左 3.0 / 右 2.8。 */
    var BORDER_PX = 0.2646;
    var cornerCx = p.cornerInsetX;                       // 定标带列心 = 角标中心 x
    var markGap = p.markGap === undefined ? 3.0 : p.markGap;   // 定位点右缘 → 红框外缘
    var boxGap = p.boxGap === undefined ? 0.8 : p.boxGap;      // 红框内缘 → 黑框外缘

    var bandRightEdge = r3(cornerCx + p.blockW / 2);     // 左侧定位点右边缘
    var outerLeft = r3(bandRightEdge + markGap);         // 红框外缘左
    var innerBorderLeft = r3(outerLeft + BORDER + boxGap); // 黑框边框盒左

    return {
      border: BORDER,
      /* 红框左右内边距恒为 0 —— 黑框水平位置由 margin-left 给出 */
      outerPadX: 0,
      /* 黑框 margin-left：把黑框从「红框内容盒左」推到「红框内缘 + boxGap」 */
      innerMarginLeft: boxGap,
      /* 红框内缘 → 黑框外缘的间隙（供自检/调参读取） */
      boxGap: boxGap,
      markGap: markGap,
      /* 各层左缘（相对面左缘），自检与 builder 共用 */
      bandRightEdge: bandRightEdge,
      outerLeft: outerLeft,
      innerBorderLeft: innerBorderLeft,
      /* 网格左边框盒左缘 = 黑框内容盒左缘 = 黑框边框盒左缘 + 黑框线 */
      gridLeft: r3(innerBorderLeft + BORDER),
      /* 红框**外**内边距（mm）—— 红框内缘 → 黑框外缘 或 页内提示。
         用户要求「提示同时贴近红框和黑框」（旧值 1 + 1 = 2.0 太宽）。
         这里取 TIP_GAP 同级；theme.js 把同一个值写成
         CSS 的 --outer-pad-y / --outer-pad-y-bottom。 */
      outerPadY: TIP_GAP,
      outerPadYBottom: TIP_GAP,
      /* 黑框**内**的上下内边距，用户指定都固定 3mm：
           上 = 第一行题号 → 黑框顶边
           下 = 选项最后一行 → 黑框底边
         它们都是**黑框内部**的空档，所以直接做成黑框的 padding。
         ⚠ 不能靠调红框的内边距来做 —— 调红框只会让黑框和红框一起挪，
           黑框内的空档一点不变。 */
      innerPadTop: (p.innerPadTop === undefined ? 3.0 : p.innerPadTop),
      innerPadBottom: (p.innerPadBottom === undefined ? 3.0 : p.innerPadBottom),
      headerGap: 1,
      headerH: 5,
      leftBandX: r3(cornerCx)
    };
  }

  /**
   * 红框**外**边缘的左右边界 —— 面内坐标。
   *
   *   红框外缘左 = 左侧定位点右边缘 + markGap
   *   红框外缘右 = faceW − 同一个量            ← 与左边对称
   *
   * ⚠ 注意这与「页面左右留白 padX」不是同一个量：padX 只用于页眉/页脚，
   *   红框及其内部的网格、气泡、定标带全部以 contentBox 为准。
   */
  function contentBox(preset, faceW, faceX) {
    var p = preset;
    var off = boxOffsets(p);
    var fx = faceX || 0;
    var w = faceW || C.PAPER.A4.w;
    var left = off.outerLeft;
    return {
      left: r3(fx + left),
      right: r3(fx + w - left),
      width: r3(w - 2 * left)
    };
  }

  /**
   * 网格左边缘的 x（相对面左缘）—— 气泡列心的唯一基准。
   * 等价于 gridOriginX，留这个别名是因为 builder / 探针都按这个名字取。
   */
  function gridLeft(preset, faceW, faceX) {
    return gridOriginX(preset, faceW, faceX);
  }

  /**
   * 网格整体右移量（mm）= 第一个气泡列心 − 网格原点（红框内缘内一格线宽的
   * 位置）− blockW/2。
   *
   * ⚠ 这里**不是**自由参数，是从带子反推的：用户要求「选择题第一列对齐
   *   第二个小方块」，而第二个小方块心 = marks[1]，所以
   *
   *     gridShiftX = marks[1] − gridOriginBase − blockW/2
   *
   * 之前反过来做（带子由列推），带子一伸长就把列数挤掉一个，
   * 而「列数」和「带子位置」本来是两个独立的东西。
   * preset.gridShiftX 只在想手动指定时用（null = 自动）。
   */
  function gridOriginBase(preset, faceW, faceX) {
    var off = boxOffsets(preset);
    var fx = faceX || 0;
    return r3(fx + off.outerLeft + off.border + off.boxGap + off.border);
  }

  function gridShiftX(preset, faceW) {
    var v = preset && preset.gridShiftX;
    if (typeof v === 'number' && isFinite(v)) return v;
    var w = (faceW === undefined || faceW === null) ? C.PAPER.A4.w : faceW;
    var marks = markColumnCenters(preset, w, 0);
    /* 带子块数不足 2 时没有「第二个方块」，退回 0 位移 */
    if (marks.length < 2) return 0;
    return r3(marks[1] - gridOriginBase(preset, w, 0) - preset.blockW / 2);
  }

  /** 顶部定标带整体右移量（mm）。当前带子完全由几何推出，不再用它。 */
  function markShiftX(preset) {
    var v = preset && preset.markShiftX;
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  /** 顶部定标带**左右各多一个**定位点（用户指定）。带子总数 = columnsPerLine + 2。 */
  var TOP_BAND_EXTRA = 1;

  /**
   * 顶部定标带的块数（标准 A4 答题卡是 29 个，用户指定）。
   */
  function topBandCount(preset) {
    var n = preset && preset.topBandCount;
    return (typeof n === 'number' && n >= 3) ? n : 29;
  }

  /**
   * 顶部定标带的**块距**（mm），给定块数 n。
   *
   * 用户指定：**第一个小方块左缘与顶角大方块右缘的间距 = 小方块之间的空隙**，
   * 末块同理（右角标左缘）。也就是带子**架在左右两个顶角大方块之间**，
   * 从「左角标右缘」一直排到「右角标左缘」，两端空隙与块间空隙相等。
   *
   * 于是（b = 块宽，W = 两角标内侧之间的净宽）：
   *
   *     step = b + g，  g = (W − n·b) / (n + 1)
   *     marks[0].left = 左角标右缘 + g
   *
   * ⚠ 空隙总数是 (n+1)：两端各一个 g，中间 (n−1) 个。
   * ⚠ 这条约束把间距**定死**了 —— 29 个方块 + 张满两角标之间，
   *   间距就只能是 (W−29b)/30 + b。A4 算出来 g≈5.73mm、step≈9.79mm，
   *   比原来（g=1.69、step=5.75）宽得多。想再调间距只能改方块数。
   */
  /** 带子可用的净宽 W（左角标右缘 → 右角标左缘）。**唯一口径**，别处不要另算。 */
  function topBandWidth(preset, faceW) {
    var p = preset;
    var cornerRight = r3(p.cornerInsetX + p.cornerW / 2);
    var cornerLeft = r3(faceW - p.cornerInsetX - p.cornerW / 2);
    return r3(cornerLeft - cornerRight);
  }

  function topBandStepFor(preset, faceW, n) {
    var p = preset;
    var W = topBandWidth(p, faceW);
    return r3((W - n * p.blockW) / (n + 1) + p.blockW);
  }

  /**
   * 顶部定标带的**实际块数**：优先 29（标准 A4 答题卡），
   * 但面太窄时（A3 每面只有 140mm）29 个满宽方块会算出**负空隙**
   * —— 方块互相压住。这时从想要的块数往下试，取第一个能让
   * 「空隙 ≥ TOP_BAND_MIN_GAP」的块数。
   *
   * ⚠ 块距 step 必须跟着**实际块数**重算：用 29 个算出来的 step 去排
   *   17 个方块，末块会停在半路（实测右端空隙 40mm）。
   */
  var TOP_BAND_MIN_GAP = 0.6;

  /**
   * 带子的完整几何：{ count, step, gap, first, last, left, right }。
   * 块数与块距互相依赖，所以在这里一次性解出，别处只读结果。
   */
  function topBandGeom(preset, faceW, faceX) {
    var p = preset;
    var fx = faceX || 0;
    /* 带子架在两个顶角大方块**之间**：
       左界 = 左角标右缘，右界 = 右角标左缘。 */
    var W = topBandWidth(p, faceW);
    var cornerRight = r3(p.cornerInsetX + p.cornerW / 2);
    var want = topBandCount(p);
    var count = want, step = 0, gap = 0;
    for (var n = want; n >= 3; n--) {
      step = topBandStepFor(p, faceW, n);
      gap = r3(step - p.blockW);
      if (gap >= TOP_BAND_MIN_GAP) { count = n; break; }
      if (n === 3) { count = 3; }
    }
    /* 端空隙 = g，所以首块**左缘** = 左角标右缘 + g */
    var first = r3(fx + cornerRight + gap + p.blockW / 2);
    return {
      count: count, step: step, gap: gap,
      width: W, leftInner: r3(fx + cornerRight),
      first: first,
      last: r3(first + (count - 1) * step),
      left: r3(first - p.blockW / 2),
      right: r3(first + (count - 1) * step + p.blockW / 2)
    };
  }

  function topBandStep(preset, faceW) {
    return topBandGeom(preset, faceW, 0).step;
  }

  function topBandCountFor(preset, faceW) {
    return topBandGeom(preset, faceW, 0).count;
  }

  /**
   * 「定位点列心」—— 顶部定标带的 x 基准（带子的**唯一真源**）。
   *
   * 用户要求三条：最左最右各多一个方块、**第一列对齐第二个小方块**、
   * 首末方块与顶角大方块留出与块间相同的空隙。于是：
   *
   *   marks[0] = 左角标内缘 + g/2 + b/2     （左端空隙 = g）
   *   marks[i] = marks[0] + i·step
   *   marks[1] = 第一个气泡列心             ← 由构造保证，不是调参调出来的
   *
   * 气泡列**由带子反推**（见 columnCenters / gridShiftX），所以带子不再
   * 依赖列数，也不再有「带子一伸长列数就掉」的循环依赖。
   */
  function markColumnCenters(preset, faceW, faceX) {
    var p = preset;
    var fx = faceX || 0;
    var band = topBandGeom(p, faceW, fx);
    var out = [];
    for (var i = 0; i < band.count; i++) {
      out.push(r3(band.first + i * band.step));
    }
    return out;
  }

  /**
   * 气泡**列距**（mm）。用户指定：选择题的列距跟着顶部方块一起放宽，
   * 两者**节距相等** —— 列心与方块心逐个共线，第一列压在第二个方块上。
   * 所以这里不独立取值，直接等于 topBandStep()：
   *   preset.step 只在「想手动指定节距」时用（留了后门方便对照调试）。
   */
  function choiceStep(preset, faceW) {
    var v = preset && preset.step;
    if (typeof v === 'number' && isFinite(v) && v > 0) return v;
    return topBandStep(preset, faceW);
  }

  /**
   * 选择题一「行」的总高（mm）= 一列内容高 + 行间空档。
   * 行间空档 = LINE_GAP_BUBBLES × 气泡高（用户指定：上一行最后一个选项
   * 与下一行题号之间空出一个定位点的高度）。
   */
  function lineHeight(p) {
    return r3(columnHeight(p) + lineGapH(p));
  }

  /** 行间空档（mm）—— 上下两行**块顶到块顶**之间、扣掉列高之后的那部分。
   *
   * 用户要求：「上一行最后一个选项和下一行题号之间留出一个定位点的宽度」
   * —— 说的是**净空**：上行末气泡**底缘** → 下行题号**上缘** = bubbleH。
   *
   * ⚠ **实测标定**（`.ref/cal_gap.cjs`）：把网格 `row-gap` 强制成
   *   4mm / 8mm 各量一次，「上行末气泡底缘 → 下行题号上缘」的净空正好
   *   等于该 row-gap（斜率 1、截距 **0**）。也就是说这段净空就**等于**
   *   `lineGapH`，不需要任何补偿项：`columnHeight` 恰好停在末气泡底缘，
   *   而题号上缘恰好落在下一行块顶。
   *
   * 所以取 `lineGapH = n·bubbleH` 就满足要求。
   *
   * ⚠ 不要再往这里塞 `rowOffsets[0]`、`bubbleH/2` 之类的「修正」：
   *   上一轮就是把 `.as-choice-nums` 的**外层盒**（transform 之前的位置）
   *   误当成题号上缘，量出 3.69mm 的假净空，于是加了 −2·rowOffsets[0]，
   *   把行距压到 −0.915mm、两行叠在一起、左侧定位点全乱。
   *   要量就量 `.as-choice-num`（span）自己的 rect。
   */
  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p));
  }

  /**
   * 行间**不**放定位块 —— layoutFace 每行只按 rowOffsets 出 5 块。
   *
   * 用户画的结构图（最终口径）：
   *     【】1 2 3 ……        ← 题号行
   *     【】A A A ……        ← A 选项行
   *     【】B B B ……
   *     【】C C C ……
   *     【】D D D ……
   *     【】21 22 23 ……     ← 下一行紧接，中间**没有额外的方块**
   *     【】A A A ……
   * 行与行之间看到的那个"间隙"是 lineGapH 把两行拉开的结果，不是多画了一块。
   *
   * ⚠ **踩坑记录**：先后五次尝试在行间塞一块，全部失败 —— 块高 2.436，
   *   而行间可用净空最多只有 2.4 左右，无论怎么摆都会与相邻块重叠或挤成一团：
   *     ① 延续上一行节距                  → 距下一行题号块 1.04  **叠**
   *     ② 「末气泡下缘 / 题号盒上缘」取中点 → 距上一行末尾 1.66  **挤**
   *     ③ 用几何口径的题号块心取中点       → 距题号块 0.09  **叠**
   *     ④ ⑤ 换各种偏差符号                → 距题号块 0.97/1.05 **叠**
   *   用户原话：「你怎么方块融合在一起了？有这么难理解吗？？？」
   *   结论：**行间不放块**。
   *
   * 本函数保留但返回 null，只为把上面这段结论留在代码里。
   */
  function lineGapMarkOffset(p) {
    return null;
  }

  /**
   * 气泡网格可用的净宽（mm）= 黑框内容盒宽 − gridShiftX。
   *
   * 末列右缘 = shift + n·step ≤ innerContentW ⇒ n ≤ (innerContentW − shift)/step。
   * 黑框没有横向内边距，所以到此为止。
   */
  function gridAvailW(preset, faceW) {
    var p = preset;
    var off = boxOffsets(p);
    /* 黑框内容盒宽（已经扣掉两侧 boxGap 与两道线） */
    var innerContentW = r3(innerBoxW(p, faceW) - 2 * off.border);
    return r3(innerContentW - gridShiftX(p, faceW));
  }

  /**
   * 一行最多放几个**块**（块 = 若干题，块内列距 = step，块间空 gap 列）。
   *
   * b 块需要的宽度 = b·size·step + (b−1)·gap·step ≤ gridAvailW
   *   ⇒ b ≤ (gridAvailW/step + gap) / (size + gap)
   *
   * ⚠ 这是**必须**的约束，不能只按列数算：列数够，不代表块数够 ——
   *   块间的空列也要占宽。实测 A3 每面只有 105.45mm 可用，4 块 5 题
   *   （含 3 个空列）要 109.73mm，会直接压出黑框右缘。
   */
  function maxBlocksPerLine(preset, faceW, group) {
    var g = group || C.GROUPS.A4;
    var step = choiceStep(preset, faceW);
    var avail = gridAvailW(preset, faceW);
    var b = Math.floor((avail / step + g.gap) / (g.size + g.gap));
    return b < 1 ? 1 : b;
  }

  /**
   * 一行能排下多少「题」（= 多少个气泡列 / 多少个定标块）。
   *
   * 由 `maxBlocksPerLine` 反推，保证「一行里的块 + 空列」整体不越出黑框：
   *   b 块 = b·size 列，块间 (b−1)·gap 列，末块后留一个 gap 列作收尾余量
   *   n = b·size + (b−1)·gap + gap = b·(size+gap)
   *
   * ⚠ **不要**把 markShiftX 也算进来。顶部定标带由气泡列推出来
   *   （见 markColumnCenters），它比网格多伸出左右各一个块，
   *   但那是**带子**的宽度，不占网格的可用宽度。旧版取
   *   max(gridShiftX, markShiftX) 会让带子一伸长列数就掉。
   *
   * ⚠ 这里**不能**再减 2×border：gridW 是黑框**内容盒**里的量，
   *   线宽只影响黑框自己的边框盒，不影响内容能放多宽。
   */
  function columnsPerLine(preset, faceW, group) {
    var g = group || C.GROUPS.A4;
    var b = maxBlocksPerLine(preset, faceW, g);
    var n = b * (g.size + g.gap);
    /* 兜底：真的连一块都排不下时，至少给 size 列，别退化成 0 */
    return n < g.size ? g.size : n;
  }

  /**
   * 红框**边框盒**宽。红框在 CSS 里是 `box-sizing:border-box`，
   * 若直接把 contentBox.width 当边框盒宽，它的**内容盒**就只剩
   * (contentBox.width − 2×红框线)，黑框再往里塞就会溢出到右边。
   * 所以边框盒宽要补上两道线，内容盒才正好等于 contentBox.width。
   *
   * ⚠ `- BOX_ROUND_FIX`：Chrome 对边框盒宽度做设备像素吸附后，实际内容盒
   *   会比算出来的宽约 0.07mm，这 0.07mm 全堆到右边，实测「红框内缘 →
   *   黑框外缘」左 2.997 / 右 2.808。减掉它右边就回到 ~2.9，两边对称。
   *   这是**取整补偿**，不是设计尺寸；改红框线宽后必须重量。
   */
  var BOX_ROUND_FIX = 0.07;

  function outerBoxW(preset, faceW) {
    return r3(contentBox(preset, faceW).width + 2 * boxOffsets(preset).border -
              BOX_ROUND_FIX);
  }

  /**
   * 黑框**边框盒**宽 = 红框内容宽 − 2×boxGap。
   *
   * 红框内容盒 = contentBox.width（由 outerBoxW 保证），黑框边框盒
   * 加上两侧 boxGap 正好填满，于是「红框内缘 → 黑框外缘」左右都 = boxGap。
   *
   * ⚠ 不能取「网格宽 + 2×线宽」：那样黑框正好裹住网格，网格再右移就
   *   无处可去，结果黑框左 3mm、右 9.6mm（实测过）。
   */
  function innerBoxW(preset, faceW) {
    var off = boxOffsets(preset);
    return r3(contentBox(preset, faceW).width - 2 * off.boxGap);
  }

  /**
   * 网格左边缘（相对面左缘）
   *   = 红框外缘 + 红框线 + boxGap + 黑框线 + gridShiftX
   * 这是**气泡网格**的横向基准；与 markColumnCenters 相差
   * (markShiftX − gridShiftX)，两者取同值时就完全一致。
   */
  function gridOriginX(preset, faceW, faceX) {
    return r3(gridOriginBase(preset, faceW, faceX) + gridShiftX(preset, faceW));
  }

  /**
   * 把 [startNo, endNo] 切成块，块与块之间空 `gap` 列。
   *
   * 规则（用户指定）：先按 size 题切块，再看末块余数 ——
   *   余 1 题 → 并进前一块；余 2/3/4 题 → 单独成块。
   * 例：5→[5]、6→[6]、7→[5,2]、8→[5,3]、9→[5,4]、10→[5,5]、
   *     11→[5,6]、12→[5,7]、13→[5,5,3]、15→[5,5,5]
   *
   * 返回 [{ from, count, col }]，col 是块内首题所占的**列序号**
   * （列序号 = 该题在「整行等距列」里的下标，空列也占一个序号）。
   * 列心由 columnCenters 统一给出，所以块内气泡列心与顶部定标块必然共线。
   */
  function blockPlan(startNo, endNo, group) {
    var size = (group && group.size) || 5;
    var gap = (group && group.gap !== undefined) ? group.gap : 1;
    var total = endNo - startNo + 1;
    if (total <= 0) return [];

    var counts = [];
    var full = Math.floor(total / size);
    var rest = total % size;
    for (var i = 0; i < full; i++) counts.push(size);
    if (rest > 0) {
      if (rest === 1 && counts.length) counts[counts.length - 1] += 1;  // 余 1 题并进前一块
      else counts.push(rest);                                          // 余 2/3/4 题另起一块
    }

    var out = [];
    var col = 0;
    var no = startNo;
    counts.forEach(function (c) {
      out.push({ from: no, count: c, col: col });
      no += c;
      col += c + gap;      // 块后空 gap 列
    });
    return out;
  }

  /**
   * 一行的各列列心 x（面内坐标，faceX 为面左缘在纸上的 x）。
   * 这是全局唯一的列心来源：顶部定标块、左侧题号列、网格左缘全部用它，
   * 所以「顶部定标块 ↔ 气泡列 ↔ 题号列」三者共线是构造出来的，不靠调参。
   */
  function columnCenters(preset, faceW, faceX) {
    var fx = faceX || 0;
    var n = columnsPerLine(preset, faceW);
    var left = gridLeft(preset, faceW, fx);
    var step = choiceStep(preset, faceW);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(r3(left + preset.blockW / 2 + i * step));
    }
    return out;
  }

  /**
   * 计算单个「面」的布局。
   * @param {object} o
   *   o.preset   版式预设
   *   o.faceX    该面左边缘（页面坐标）
   *   o.faceW    该面宽度
   *   o.topBandY 顶部定标带行心 y（页面坐标）
   *   o.cornerX  角标中心 x（页面坐标）
   *   o.gridTop  选择题网格内容顶 y（页面坐标）
   */
  function layoutFace(o) {
    var p = o.preset;
    var off = boxOffsets(p);
    var offs = rowOffsets(p);
    var colH = columnHeight(p);

    /* gridTop === null 表示这一面没有选择题网格（例如 A3 的第 2/3 面、
       或选择题已排完的后续面）。此时不能画「题号行 + 选项行」那一列左侧
       定标块 —— 没有气泡与它们对齐，画出来就是悬空的错位块。
       缺考框/示例框的定标块不受影响，它们有自己的行心。 */
    var hasGrid = (o.gridTop !== null && o.gridTop !== undefined);

    /* 左侧定标带：**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量 = nLines · offs.length
             每行 5 块：题号行 + A/B/C/D，**行间不放块**（见 lineGapMarkOffset）。
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错整列就全乱（上一轮的教训）。
       只按第一行画、换行后的第二行左边就空着 —— 用户报的
       「换行后左边定位点数量没有增加」就是这个。 */
    var nLines = (o.choiceLines === undefined || o.choiceLines === null)
      ? (hasGrid ? 1 : 0) : o.choiceLines;
    var rows = [];
    if (hasGrid) {
      for (var li = 0; li < nLines; li++) {
        var base = r3(o.gridTop + li * lineHeight(p));
        /* 块心一律用 rowOffsets（题号块 = rowOffsets[0]，气泡块 = 后四项）。
           实测题号块心与题号渲染行心仅差 0.085mm（见 .ref/markrows.cjs），
           属盒模型取整残差，不要去「修」。 */
        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }

    /* ── 角标：中心 x = cornerX，中心 y = 顶部定标带行心 y ── */
    var cornerCx = o.cornerX;
    var cornerCy = o.topBandY;
    var corner = {
      w: p.cornerW, h: p.cornerH,
      cx: r3(cornerCx), cy: r3(cornerCy),
      x: r3(cornerCx - p.cornerW / 2),
      y: r3(cornerCy - p.cornerH / 2)
    };

    /* ── 左侧定标带：列心 x = 黑框外缘左侧（红黑框之间） ── */
    var leftBandX = r3(o.faceX + off.leftBandX);

    /* ── 版心（红框内容区） ──
     * 由 contentBox 统一给出：左缘 = 左侧定位点右边缘，右缘与左边对称。
     * 红框、网格、气泡、定标带全部以它为准。 */
    var cb = contentBox(p, o.faceW, o.faceX);
    var contentL = cb.left;
    var contentR = cb.right;

    /* ── 列：严格等距 ──
     * 两套列心，**刻意分开**：
     *   colCenters      = 气泡网格的列心（含 gridShiftX）
     *   markColCenters  = 定位点的列心（不含 gridShiftX）
     * 用户指定「只有气泡列整体右移一个定位点宽，定位点不动」，
     * 所以两者相差 preset.gridShiftX。 */
    var colCenters = columnCenters(p, o.faceW, o.faceX);
    var markColCenters = markColumnCenters(p, o.faceW, o.faceX);
    var firstColCx = colCenters[0];

    /* ── 顶部定标带：块心 x = **定位点**列心 x（不含网格位移） ──
     * ⚠ 用户指定：**只在这一面有选择题时才出现**。续排的非选择题面
     *   （A3 的第 2/3 面、选择题已排完的后续面）不再画顶部定标带 ——
     *   那些面上没有气泡列要跟它对位，画出来就是一排悬空的方块。
     *   注意 markColCenters 仍然照算：它是「带子本来该在哪」的几何量，
     *   供自检与探针使用，只是不渲染。 */
    var topMarks = hasGrid ? markColCenters.map(function (cx) {
      return { cx: cx, cy: corner.cy, w: p.blockW, h: bubbleH(p) };
    }) : [];
    var bandLeft = r3(markColCenters[0] - p.blockW / 2);
    var bandRight = r3(markColCenters[markColCenters.length - 1] + p.blockW / 2);

    /* ── 左侧定标带：题号行 + 各选项行，各一块 ── */
    var leftMarks = rows.map(function (cy, i) {
      return { cx: leftBandX, cy: cy, w: p.blockW, h: bubbleH(p), kind: i === 0 ? 'num' : 'opt' };
    });

    /* ── 附加定标块：缺考框 / 选考框 / 正确填涂示例 ──
     * 它们各自需要一块与自身行心对齐的左侧定标块。 */
    (o.extraRows || []).forEach(function (er) {
      leftMarks.push({
        cx: leftBandX, cy: r3(er.cy), w: p.blockW, h: bubbleH(p), kind: er.kind
      });
    });
    leftMarks.sort(function (a, b) { return a.cy - b.cy; });

    return {
      faceX: r3(o.faceX), faceW: r3(o.faceW),
      contentL: contentL, contentR: contentR, contentW: cb.width,
      preset: p,
      rowCenters: rows,
      colCenters: colCenters,
      gridTop: hasGrid ? r3(o.gridTop) : null,
      gridBottom: hasGrid ? r3(o.gridTop + colH) : null,
      columnHeight: r3(colH),
      corner: corner,
      topBandY: r3(o.topBandY),
      topMarks: topMarks,
      topBand: { left: bandLeft, right: bandRight, span: r3(bandRight - bandLeft) },
      leftBandX: leftBandX,
      leftMarks: leftMarks
    };
  }

  /** 一次性算出整页所有面的布局 */
  function layoutPage(o) {
    var paper = C.PAPER[o.format];
    var n = (o.format === 'A3') ? C.A3_COLUMNS : 1;
    var faceW = r3(paper.w / n);
    var faces = [];
    for (var i = 0; i < n; i++) {
      faces.push(layoutFace({
        preset: o.preset,
        faceX: r3(i * faceW),
        faceW: faceW,
        padX: o.padX,
        topBandY: o.topBandY,
        cornerX: r3(i * faceW + o.cornerInsetX),
        gridTop: o.gridTop,
        choiceLines: o.choiceLines,
        extraRows: o.extraRows
      }));
    }
    return {
      format: o.format, paper: paper,
      faceCount: n, faceW: faceW,
      faces: faces
    };
  }

  /** 自检：验证所有对齐规则，返回违规描述数组（空 = 全部通过） */
  function selfTest(page) {
    var bad = [];
    var tol = 0.02;

    page.faces.forEach(function (L, fi) {
      var tag = 'face' + fi + ' ';
      var p = L.preset;

      // ① 顶部定标带块心 x 必须逐个落在**定位点列心**上
      // ⚠ 必须比 markColCenters，不能比 colCenters。
      //   两者**刻意不同**（见 columnCenters / markColumnCenters 的注释）：
      //   气泡网格整体右移了一个 gridShiftX，定位点不动。
      //   而且 markColCenters 有 topBandCount(=29) 个，气泡列只有 24 个，
      //   首尾的方块本来就落在气泡列之外 —— 比 colCenters 会误报 5 处。
      if (L.topMarks.length) {
        var mk = markColumnCenters(p, L.faceW, L.faceX);
        if (L.topMarks.length !== mk.length) {
          bad.push(tag + '顶部定标带块数 ' + L.topMarks.length +
                   ' != 定位点列数 ' + mk.length);
        } else {
          L.topMarks.forEach(function (m, i) {
            if (Math.abs(mk[i] - m.cx) > tol) {
              bad.push(tag + 'topMark#' + i + ' cx=' + m.cx +
                       ' != 定位点列心 ' + mk[i]);
            }
          });
        }
        // 也要和气泡列**逐个共线**：用户指定「第一列压在第二个方块上」，
        // 即 colCenters[i] 应当等于 markColCenters[i+1]。
        var off0 = mk[1] === undefined ? null
          : r3(L.colCenters[0] - mk[1]);
        if (off0 !== null && Math.abs(off0) > tol) {
          bad.push(tag + '气泡首列 ' + L.colCenters[0] +
                   ' != 第二个定位点 ' + mk[1]);
        }
      }

      // ② 顶部定标带块心 y = 角标中心 y
      L.topMarks.forEach(function (m, i) {
        if (Math.abs(m.cy - L.corner.cy) > tol) {
          bad.push(tag + 'topMark#' + i + ' cy=' + m.cy + ' != 角标中心y ' + L.corner.cy);
        }
      });

      // ③ 左侧定标带中「网格行」的块心 y 必须等于行心 y
      L.rowCenters.forEach(function (cy, i) {
        var hit = L.leftMarks.some(function (m) {
          return m.kind === (i === 0 ? 'num' : 'opt') && Math.abs(m.cy - cy) < tol;
        });
        if (!hit) bad.push(tag + '缺少与行心 ' + cy + ' 对齐的左侧定标块');
      });

      // ④ 左侧定标带列心 x = 角标中心 x
      L.leftMarks.forEach(function (m, i) {
        if (Math.abs(m.cx - L.corner.cx) > tol) {
          bad.push(tag + 'leftMark#' + i + ' cx=' + m.cx + ' != 角标中心x ' + L.corner.cx);
        }
      });

      // ⑤ 定位块尺寸 = 填涂框尺寸
      L.topMarks.concat(L.leftMarks).forEach(function (m, i) {
        if (Math.abs(m.w - p.blockW) > tol || Math.abs(m.h - bubbleH(p)) > tol) {
          bad.push(tag + 'mark#' + i + ' 尺寸 ' + m.w + 'x' + m.h +
                   ' != 填涂框 ' + p.blockW + 'x' + bubbleH(p));
        }
      });

      // ⑥ 左侧定标带不得压到第一列气泡
      var firstColLeft = r3(L.colCenters[0] - p.blockW / 2);
      var leftBandRight = r3(L.leftBandX + p.blockW / 2);
      if (leftBandRight > firstColLeft + tol) {
        bad.push(tag + '左侧定标带右缘 ' + leftBandRight + ' 压到第一列气泡左缘 ' + firstColLeft);
      }

      // ⑦ 顶部定标带首块不得压到角标（x 方向）
      //    ⚠ topMarks 在「本面没有选择题」时是空数组（用户指定：定标带只在
      //      有选择题的面出现），所以这里必须先判空，否则读 .cx 会抛。
      if (L.topMarks.length) {
        var cornerRight = r3(L.corner.x + L.corner.w);
        var firstTopLeft = r3(L.topMarks[0].cx - p.blockW / 2);
        if (firstTopLeft < cornerRight - tol) {
          bad.push(tag + '顶部定标带首块左缘 ' + firstTopLeft + ' 压到角标右缘 ' + cornerRight);
        }
      }

      // ⑧ 网格必须在版心内
      var gridL = r3(L.colCenters[0] - p.blockW / 2);
      var gridR = r3(L.colCenters[L.colCenters.length - 1] + p.blockW / 2);
      if (gridR > L.contentR + tol) bad.push(tag + '网格右缘 ' + gridR + ' 越出版心 ' + L.contentR);
      if (gridL < L.contentL - tol) bad.push(tag + '网格左缘 ' + gridL + ' 越出版心 ' + L.contentL);

      // ⑨ 顶部定标带两端留白必须均等（居中）
      var wsL = r3(bandLeftGap(L));
      var wsR = r3(bandRightGap(L));
      if (Math.abs(wsL - wsR) > 0.05) {
        bad.push(tag + '顶部定标带未居中：左留白 ' + wsL + ' 右留白 ' + wsR);
      }

      // ⑩ 红框左缘 = 左侧定位点右边缘 + markGap
      // ⚠ 原来是「红框左缘 == 定位点右边缘」，那是个**错的断言**：
      //   boxOffsets 里 outerLeft = bandRightEdge + markGap，
      //   markGap 默认 3.0，两者本来就应当差 3.0mm（用户要求的
      //   「定位点右缘 → 红框外缘」间距）。写死等号会每次都误报。
      var bandRightEdge = r3(L.leftBandX + p.blockW / 2);
      var wantGap = p.markGap === undefined ? 3.0 : p.markGap;
      var gotGap = r3(L.contentL - bandRightEdge);
      if (Math.abs(gotGap - wantGap) > tol) {
        bad.push(tag + '红框左缘→定位点右缘 ' + gotGap +
                 ' != markGap ' + wantGap);
      }

      // ⑪ 红框左右对称
      var mLeft = r3(L.contentL);
      var mRight = r3(L.faceW - L.contentR);
      if (Math.abs(mLeft - mRight) > tol) {
        bad.push(tag + '红框左右不对称：左边距 ' + mLeft + ' 右边距 ' + mRight);
      }
    });

    return bad;
  }

  function bandLeftGap(L) { return L.topBand.left - L.contentL; }
  function bandRightGap(L) { return L.contentR - L.topBand.right; }

  global.AS.geometry = {
    bubbleH: bubbleH,
    numRowH: numRowH,
    TOP_BAND_CY: TOP_BAND_CY,
    TIP_GAP: TIP_GAP,
    TIP_H: TIP_H,
    answerTop: answerTop,
    answerBottom: answerBottom,
    answerHeight: answerHeight,
    frameGap: frameGap,
    frameExtend: frameExtend,
    frameTopLimit: frameTopLimit,
    frameBottomLimit: frameBottomLimit,
    frameHeight: frameHeight,
    FRAME_INSET_K: FRAME_INSET_K,
    contentChrome: contentChrome,
    pxMM: pxMM,
    snapMM: snapMM,
    gridCbOffset: gridCbOffset,
    choiceHeadH: choiceHeadH,
    choiceChromeH: choiceChromeH,
    choiceFootH: choiceFootH,
    rowOffsets: rowOffsets,
    columnHeight: columnHeight,
    boxOffsets: boxOffsets,
    contentBox: contentBox,
    gridLeft: gridLeft,
    gridOriginX: gridOriginX,
    gridOriginBase: gridOriginBase,
    innerBoxW: innerBoxW,
    outerBoxW: outerBoxW,
    gridShiftX: gridShiftX,
    markShiftX: markShiftX,
    topBandCount: topBandCount,
    topBandCountFor: topBandCountFor,
    topBandStep: topBandStep,
    topBandStepFor: topBandStepFor,
    topBandWidth: topBandWidth,
    topBandGeom: topBandGeom,
    choiceStep: choiceStep,
    lineHeight: lineHeight,
    lineGapH: lineGapH,
    lineGapMarkOffset: lineGapMarkOffset,
    rowPitch: rowPitch,
    blockPlan: blockPlan,
    columnsPerLine: columnsPerLine,
    maxBlocksPerLine: maxBlocksPerLine,
    gridAvailW: gridAvailW,
    columnCenters: columnCenters,
    markColumnCenters: markColumnCenters,
    layoutFace: layoutFace,
    layoutPage: layoutPage,
    selfTest: selfTest,
    r3: r3
  };
})(window);
