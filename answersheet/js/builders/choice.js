/* =============================================================================
 * 答题卡生成器 · 选择题区
 * -----------------------------------------------------------------------------
 * 结构严格照初版：
 *   .as-choice-outer   （红色圆角外框）
 *     .as-choice-header  （栏目名 + 提示 + 正确填涂示例块）
 *     .as-choice-inner   （黑色内框）
 *       .as-choice-line × N
 *         .as-choice-col   （块：块内若干题，每题一列）
 *           .as-choice-nums   （题号行）
 *           .as-choice-optrow × 4（A/B/C/D 气泡行）
 *
 * 排版规则：5 题一块，一行放满 MAX_GROUP_PER_LINE 块就换新行（两种纸一致）。
 * 块内每题独占一列，因此题号与气泡的列心严格共线，节距恒为 --step。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;
  var G = global.AS.geometry;

  var OPTIONS = ['A', 'B', 'C', 'D'];

  /**
   * 一列 = 一块，块内每题是一个**绝对定位的 .as-choice-item**：
   *   left = 题在「整行等距列」里的列序号 × step
   *   题号行  top = rowOffsets[0]
   *   选项行  top = rowOffsets[i+1]
   * 行列都取 geometry 的精确毫米值，列内不含任何 flow / 字体度量误差，
   * 因此左侧定标块（同样用 rowOffsets）与气泡、题号必然逐行共线。
   *
   * 列序号由 G.blockPlan 给出：块与块之间空 `gap` 列，
   * 所以块内气泡列心与顶部定标块（按同一套列心摆放）严格共线。
   */
  function renderBlock(plan, step, offs, bubbleH, p_blockW) {
    var w = G.r3(plan.count * step);
    var h = G.r3(offs[offs.length - 1] + bubbleH / 2);
    /* 题号行高写死为 2×offs[0]（= geometry.numRowH），不留给字体度量。
       否则浏览器按 sub-pixel 算出的盒高会比 geometry 差 ~0.006mm，
       translateY(-50%) 之后行心就偏出容差。 */
    var numH = G.r3(offs[0] * 2);
    var bw = p_blockW;
    /* 尺寸一律写成内联 mm：html2canvas 在克隆文档里不保证解析 CSS 自定义属性，
       靠 var(--block-w) 取宽高会让气泡在导出图里变成 0 宽而整片消失。 */
    var html = '<div class="as-choice-col" style="width:' + w + 'mm;height:' + h + 'mm">';

    for (var i = 0; i < plan.count; i++) {
      var q = plan.from + i;
      html += '<div class="as-choice-item" style="left:' + G.r3(i * step) + 'mm;width:' + bw + 'mm">' +
                '<div class="as-choice-nums" style="top:' + offs[0] +
                  'mm;height:' + numH + 'mm;line-height:' + numH + 'mm;width:' + bw + 'mm">' +
                  '<span class="as-choice-num" style="width:' + bw + 'mm;height:' + numH + 'mm">' +
                    q + '</span>' +
                '</div>';
      OPTIONS.forEach(function (opt, r) {
        html += '<div class="as-choice-optrow" style="top:' + offs[r + 1] +
                  'mm;width:' + bw + 'mm;height:' + bubbleH + 'mm">' +
                  '<span class="as-bubble" style="width:' + bw + 'mm;height:' + bubbleH +
                  'mm">' + opt + '</span>' +
                '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * 一行：块之间空 `gap` 列。
   *
   * ⚠ 空列必须用**独立的 spacer 元素**表示，不能用块的 margin-left。
   *   .as-choice-line 是 flex 容器，flex 项上的 margin 是**叠加**在前一项之后的
   *   （实测：margin-left 33.6mm 让块跑到前一块右缘再 +33.6mm，而不是落在
   *   容器的 33.6mm 处），块间距会越往后越大。
   *   spacer 的宽度 = gap × step，正好空出「一道选择题的宽度」。
   */
  function renderLine(plans, step, offs, bubbleH, blockW, gap) {
    var parts = [];
    plans.forEach(function (pl, i) {
      if (i > 0) {
        parts.push('<div class="as-choice-spacer" style="width:' +
                   G.r3(gap * step) + 'mm"></div>');
      }
      parts.push(renderBlock(pl, step, offs, bubbleH, blockW));
    });
    return '<div class="as-choice-line">' + parts.join('') + '</div>';
  }

  /** 栏目头：首页带正确填涂示例，后续页只给提示 */
  function header(isFirst) {
    if (isFirst) {
      return '<div class="as-choice-header">' +
        '<span class="as-section-title">选择题</span>' +
        '<span class="as-section-tip">(提示：请用2B铅笔在正确答案上填涂，修改时只能用橡皮擦干净，不留痕迹。正确填涂示例：' +
        '<span class="as-example-block"></span>)</span>' +
        '</div>';
    }
    return '<div class="as-choice-header as-choice-header-no-example">' +
      '<span class="as-section-tip">请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效！</span>' +
      '</div>';
  }

  /**
   * 生成选择题区。
   * @param {object} o
   *   o.startNo / o.endNo  题号范围
   *   o.rows               本页排几行
   *   o.fromLine           从第几行开始（跨页续排）
   *   o.group              { size, perLine, gap }
   *   o.first              是否首页（决定栏目头形态）
   *   o.gridTop            网格顶相对**红框顶**的偏移（mm）
   *   o.gridH              网格内容总高（mm）—— 内框高度，使黑框包住网格
   */
  function build(o) {
    var g = o.group || C.GROUPS.A4;
    var p = o.preset || C.PRESETS.A4;
    /* 本面的宽度（A3 一页三面，每面 140mm），由 app.js 传入 */
    var faceW0 = o.faceW || C.PAPER.A4.w;
    var step = G.choiceStep(p, faceW0);
    var off = G.boxOffsets(p);

    /* 整段题目先按规则分块（块与块之间空 g.gap 列），再按每行能放几块换行。
       分块规则见 geometry.blockPlan：5 题一块，末块余 1 题并进前一块。

    /* ⚠ 每行块数**由几何容量算出**，不用 group.perLine —— perLine 是写死的
         数，节距一变就会要么溢出黑框、要么留一大截空白。
         geometry.maxBlocksPerLine 已经把「块间的空列也占宽」算进去了
         （A3 每面只有 105mm，4 块 5 题要 110mm，会压出黑框）。 */
    var perLine = G.maxBlocksPerLine(p, faceW0, g);
    var allBlocks = G.blockPlan(o.startNo, o.endNo, g);
    var lines = [];
    for (var i = 0; i < allBlocks.length; i += perLine) {
      lines.push(allBlocks.slice(i, i + perLine));
    }

    var totalRows = lines.length;
    var from = Math.max(0, o.fromLine || 0);
    var to = (o.rows === undefined) ? totalRows : Math.min(totalRows, from + o.rows);
    var pageLines = lines.slice(from, to);
    /* 网格顶相对**红框顶**的偏移（= 分页器给出的 gridTop − boxTop）。
       builder 只认这一个量：黑框上内边距、内框高度都由它推出。 */
    var gridTop = (o.gridTop !== undefined && o.gridTop !== null)
      ? o.gridTop
      : G.choiceChromeH(p);

    /* 内框高度 = 黑框顶 → 网格底 + 黑框线。
       网格底 = 网格顶 + gridH（gridH 已含行间空档，见分页器）。 */
    var gridH = (o.gridH !== undefined && o.gridH !== null)
      ? o.gridH
      : G.r3(pageLines.length * G.columnHeight(p) +
             Math.max(0, pageLines.length - 1) * G.lineGapH(p));

    /* 纵向：黑框是 gridTop 所在的那一层盒模型。
         gridTop  = 红框顶 → **网格（题号行）上缘**
         黑框边框盒上缘 = 红框线 + 红框上内边距 + 栏目头 + 栏目头下间距
         网格上缘 = 黑框边框盒上缘 + 黑框线 + 黑框上内边距 + margin-top
       ⇒ margin-top = gridTop
                      − (红框线 + outerPadY + headerH + headerGap)
                      − 黑框线 − innerPadTop
       ⚠ 黑框上内边距（innerPadTop，用户指定 3mm）必须减掉，否则网格会
         再被 padding 往下推 3mm，黑框内的上边距就变成 6mm。
       ⚠ 别用 choiceChromeH 来算：它到网格上缘，而这里要的是 margin，
         两者相差的正是 (黑框线 + innerPadTop) —— 用错会少减这两项。 */
    var innerMarginTop = G.snapMM(G.r3(gridTop - off.border - off.outerPadY -
                                       off.headerH - off.headerGap -
                                       off.border - off.innerPadTop));

    /* 横向：
         黑框**边框盒**宽 = 红框内容宽 − 2×boxGap（撑满，见 innerBoxW 的注释）
         网格左缘 = 黑框内容盒左缘 + gridShiftX（gridOriginX）
       两者同源，所以「红框内缘 → 黑框外缘」左右必然都 = boxGap。 */
    var faceW = o.faceW || C.PAPER.A4.w;
    var cols = G.columnsPerLine(p, faceW, g);
    /* ⚠ 用局部 step（= G.choiceStep 现算），不要读 p.step 缓存 */
    var gridW = G.r3(cols * step);
    var innerW = G.innerBoxW(p, faceW);
    /* 网格相对黑框**内容盒**的左偏移 = gridOriginX − 黑框内容盒左缘
       = 红框线 + boxGap + 黑框线 + gridShiftX − (红框线 + boxGap + 黑框线)
       = gridShiftX。写成相减是为了永远跟 gridOriginX 同源。 */
    var gridPadL = G.r3(G.gridOriginX(p, faceW) -
                        (off.outerLeft + off.border + off.boxGap + off.border));

    /* 黑框高度 = 黑框顶 → 网格底 + 黑框**下内边距** + 黑框线。
       下内边距 = innerPadBottom（用户指定 3mm）——
       「选项最后一行到黑框底边的距离固定 3mm」就是它。 */
    var innerH = G.r3(gridTop - off.outerPadY - off.headerH - off.headerGap +
                      gridH + off.innerPadBottom + off.border);

    var innerStyle = ' style="height:' + innerH + 'mm;width:' + innerW +
                     'mm;padding:' + off.innerPadTop + 'mm 0 ' +
                     off.innerPadBottom + 'mm 0;margin:' + innerMarginTop +
                     'mm 0 0 ' + off.innerMarginLeft + 'mm"';

    /* 网格相对黑框内容盒的左偏移（= gridShiftX），由 gridOriginX 与
       boxOffsets 相减得出，不另写一套口径。 */
    var gridStyle = ' style="margin:0 0 0 ' + gridPadL +
                    'mm;width:' + gridW + 'mm;row-gap:' + G.lineGapH(p) + 'mm"';
    /* 红框外缘宽：用 outerBoxW（= contentBox.width + 2×红框线）。
       红框是 border-box，用 contentBox.width 会让它的**内容盒**少掉两道线，
       黑框再按 contentBox.width − 2×boxGap 撑满就会往右溢出 0.6mm ——
       表现为「红框内缘 → 黑框外缘」左 3mm、右 2.2mm。 */
    var cbW = G.outerBoxW(p, faceW);
    var outerStyle = ' style="width:' + cbW + 'mm"';

    return {
      html: '<div class="as-choice-outer"' + outerStyle + '>' +
              header(o.first) +
              /* 黑框在前、网格在里：黑框水平位置由 margin-left 给出，
                 网格位置由自身 margin 给出（都取自 geometry）。 */
              '<div class="as-choice-inner"' + innerStyle + '>' +
                '<div class="as-choice-grid"' + gridStyle + '>' +
                  pageLines.map(function (ln) {
                    return renderLine(ln, step, G.rowOffsets(p), G.bubbleH(p), p.blockW,
                                      g.gap === undefined ? 1 : g.gap);
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>',
      totalRows: totalRows,
      usedRows: pageLines.length,
      nextRow: to,
      done: to >= totalRows
    };
  }

  /** 本页选择题区总高（mm）：红框内边距 + 栏目头 + 间距 + 黑框 + 网格各行
   *  与 geometry.choiceChromeH / choiceFootH 同源，别各写一套。
   *  ⚠ choiceChromeH 已含黑框上内边距、choiceFootH 已含黑框下内边距，
   *    所以这里不要再加 innerPadTop/Bottom。 */
  function heightForRows(rows, preset, group) {
    if (rows <= 0) return 0;
    var p = preset || C.PRESETS.A4;
    var gridH = G.r3(rows * G.columnHeight(p) + Math.max(0, rows - 1) * G.lineGapH(p));
    return G.r3(G.choiceChromeH(p) + gridH + G.choiceFootH(p));
  }

  global.AS.choice = {
    OPTIONS: OPTIONS,
    header: header,
    build: build,
    heightForRows: heightForRows
  };
})(window);
