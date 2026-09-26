/* =============================================================================
 * 答题卡生成器 · 非选择题区
 * -----------------------------------------------------------------------------
 * 每题一个带边框的作答区，内部按行数铺作答横线。
 * 排版以「题」为最小单位，由分页器决定每题落在哪一页；
 * 单题过高时允许整题独占一页。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;

  /** 解析分值串："10,12,12" 或 "10-12"
   *
   * ⚠ 返回的对象必须**形状一致**，永远带 kind 判别字段。
   *   旧版「单个分值返回裸数字、区间返回 {from,to}」，渲染端却用
   *   `typeof score === 'object'` 判断区间 —— 数字被判成非对象而走错分支，
   *   于是输出「（undefined–undefined分）」。改成统一的
   *   {kind:'single'|'range', ...} 后，判断依据不再依赖 typeof。 */
  function parseScores(str) {
    if (!str) return [];
    return str.split(/[,，\s]+/).map(function (s) {
      var m = String(s).match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
      if (!m) return null;
      return m[2]
        ? { kind: 'range', from: +m[1], to: +m[2] }
        : { kind: 'single', score: +m[1] };
    }).filter(Boolean);
  }

  /** 分值对象的显示文本（不含括号）；解析不出来就返回空串，不印空括号 */
  function scoreText(score) {
    if (score === null || score === undefined) return '';
    if (typeof score === 'number') return String(score);        // 容错：裸数字
    if (score.kind === 'range') {
      if (score.from === undefined || score.to === undefined) return '';
      return score.from + '–' + score.to;
    }
    if (score.score === undefined || score.score === null) return '';
    return String(score.score);
  }

  /** 题头行高度（mm）：题号+分值那一行。
   *  ⚠ CSS 里 .as-subj-head 用 height: var(--subj-head-h)（固定高，不是 auto），
   *  所以这里可以直接写死数值，不会因为字体度量不同而和 DOM 打架。
   *  CSS 的 --subj-head-h 由 theme.js 写同一个常量。 */
  var HEAD_H = 5.0;

  /** 单元格上下内边距（mm）。CSS 的 td padding 用 --inner-pad-x，
   *  theme.js 写的也是这一个值。 */
  function cellPad() {
    return 2.5;
  }

  /* 行盒余量（mm/题）：表格行里「块级子元素」的行盒开销。
     ⚠ 与 cellPad/HEAD_H 一起决定 itemHeight：
       itemHeight(n) = HEAD_H 5.0 + 7.7n + 2×cellPad 5.0 + ROW_OVERHEAD 1.3
                     = 11.3 + 7.7n
     这是**在真实卡片里用 offsetHeight 逐档标定**的（.ref/cal.cjs、
     .ref/cal2.cjs，1/2/3/4/5/6/8/10/12/16 行十档，残差 ≤ 0.02mm）。
     ⚠ 历史：这个值先后是 1.039 / 1.881 / 0.9 / 2.7 / -5.0 / 1.3。
       前几个都是在**脱离文档流的隐藏容器**里量的 —— 那个容器没有舞台
       缩放，量出来的表格高比真实卡片矮 6.04mm，于是 itemHeight 每题
       错 6mm，分页器据此定框高就让黑框整条溢出红框。
       现在固定用 offsetHeight/offsetTop 量（不受 transform 影响）。 */
  var ROW_OVERHEAD = 1.3;

  /** 单题高度（mm）：题头 + 作答区 + 单元格上下内边距 + 表格排版余量。
   *  ⚠ 必须与 DOM 实际渲染高度**逐项一致**，否则分页器算出的游标
   *  会比真实红框矮，最后一块就压到页脚上。用 .ref/subj_fit.mjs 校验。
   *
   *  ⚠ **不含栏目头**。栏目头是「框体装饰」，由分页器的 `SUBJ_BOX_CHROME`
   *   统一承担（只加在第一段非选择题前面）。两处都摊就会多算一份
   *   headerH + headerGap = 6mm，红框比真实渲染高 6mm。
   */
  function itemHeight(lines, lineH) {
    return round(HEAD_H + lines * (lineH || 7.7) + 2 * cellPad() + ROW_OVERHEAD);
  }

  /** 一段非选择题的**行盒开销**（不含答案行）= 题头 + 上下单元格内边距 + 行盒余量。
   *  ⚠ 分页器按 `headOverhead() + 行数 × lineH` 算段高；它与 itemHeight 必须
   *    同源，否则容量会漂。 */
  function headOverhead() {
    return round(HEAD_H + 2 * cellPad() + ROW_OVERHEAD);
  }

  /** 「非选择题（提示：…）」栏目头占高（mm）= 自身高 + 下间距 */
  function headerH() {
    var P = global.AS.paginator;
    var sc = P && P.SUBJ_CHROME;
    return (sc ? sc.headerH + sc.headerGap : 6.0);
  }

  /** 页内提示语句占高（mm）+ 与黑框之间的净空。
   *  语句「请在各题目的答题区域内作答…」印在红框与黑框之间的
   *  **上、下两处**空档里，每面非选择题各一份。 */
  function pageTipBlockH() {
    var P = global.AS.paginator;
    var sc = P && P.SUBJ_CHROME;
    if (!sc) return 5.0;
    return round((sc.tipH || 4.0) + (sc.tipGap || 1.0));
  }

  /** 渲染单题的表格行（内层黑框表格的一行）。
   *  @param cont true 表示这是被页边界切开后落在**下一面**的续排段，
   *         题头改成红色的「续xx.」。 */
  function renderRow(no, score, lines, opts) {
    opts = opts || {};
    var numCls = opts.cont ? 'as-subj-no as-subj-cont' : 'as-subj-no';
    var head = '<div class="as-subj-head"><span class="' + numCls + '">' +
               (opts.cont ? '续' : '') + no + '.</span>';
    var txt = opts.scoreShow === false ? '' : scoreText(score);
    if (txt) {
      head += '<span class="as-subj-score">（' + txt + '分）</span>';
    }
    /* ⚠ 这里**不**放「请在各题目的答题区域内作答…」。
       那句话印在红框与黑框之间的上下两处空档（见 render 的 pageTip）。 */
    head += '</div>';

    /* extraBottom：收口下拉量（mm）。只加在**本面最后一行**的答题区上 ——
       用户指定「黑框跟着动」：黑框底边随答题区变高而下移，红框底边贴着它。 */
    var bodyH = lines * (opts.lineH || 7.7) + (opts.extraBottom || 0);
    return '<tr><td>' + head +
           '<div class="as-subj-body' + (opts.plain ? ' plain' : '') +
           '" style="height:' + round(bodyH) + 'mm"></div></td></tr>';
  }

  function round(v) { return Math.round(v * 100) / 100; }

  /**
   * 渲染非选择题区（红框 + 栏目头 + 黑框表格 + 页内提示语句）。
   *
   * @param {Array}  items  [{no, score, lines, cont, scoreShow}]
   *   cont      true = 该段是被页边界切开后落在本面的**续排段**，
   *             题头打红色的「续xx.」
   *   scoreShow false = 续排段不再重复印分值（分值只在第一段印一次）
   * @param {object} opts
   *   lineH       作答行距（mm）
   *   showHeader  是否印「非选择题（提示：…）」栏目头。
   *               **全卡只允许 true 一次** —— 由调用方保证（见 app.js）。
   *   pageTip     是否在本面印「请在各题目的答题区域内作答…」。
   *               语句印在红框与黑框之间的**上下两处**空档
   *               （用户指定：全部的非选择题红黑边框之间都要填上这句话），
   *               每面非选择题各一份。两处各占红框上下内边距里对应的一段。
   */
  function render(items, opts) {
    opts = opts || {};
    var showHeader = opts.showHeader !== false;
    var header = showHeader
      ? '<div class="as-subject-header">' +
          '<span class="as-subject-title">非选择题</span>' +
          '<span class="as-subject-tip">(提示：请用0.5毫米黑色签字笔作答，答案不能超出黑色边框限定区域，否则答案无效。)</span>' +
        '</div>'
      : '';
    var tipHtml = '<div class="as-subject-page-tip">' +
                    '请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效' +
                  '</div>';
    /* 上半段空档：有栏目头的面栏目头就占在这里，不再重复印语句；
       续排面这里空着，语句填进来。 */
    var topTip = (opts.pageTip && !showHeader) ? tipHtml : '';
    var bottomTip = opts.pageTip ? tipHtml : '';
    var lastIdx = items.length - 1;
    var table = '<table class="as-subject-inner-table">' +
                  items.map(function (it, i) {
                    return renderRow(it.no, it.score, it.lines, {
                      lineH: opts.lineH,
                      cont: it.cont,
                      plain: it.plain,
                      scoreShow: it.scoreShow,
                      /* 下拉量只给最后一行 */
                      extraBottom: (i === lastIdx) ? (opts.tailExtra || 0) : 0
                    });
                  }).join('') +
                '</table>';
    /* 结构：上语句 → 栏目头 → 黑框表格 → 下语句。
       ⚠ frameH > 0 时把**框体高度写死**（见 app.js 的 subjFrameH）。
       定高的理由：黑框表格每多一行，浏览器按 device px（0.2646mm）吸附盒高，
       累计误差让红框底短 0.5~1.4mm。定高后框底由构造保证，
       多出来的空白落在黑框内部底部 —— 用户明确允许「答题区可以留白」。 */
    var frameStyle = (opts.frameH > 0)
      ? ' style="height:' + (Math.round(opts.frameH * 1000) / 1000) + 'mm"'
      : '';
    return '<div class="as-subject-outer"' + frameStyle + '>' +
             topTip + header + table + bottomTip +
           '</div>';
  }

  global.AS.subject = {
    parseScores: parseScores,
    scoreText: scoreText,
    HEAD_H: HEAD_H,
    cellPad: cellPad,
    itemHeight: itemHeight,
    headOverhead: headOverhead,
    headerH: headerH,
    pageTipBlockH: pageTipBlockH,
    renderRow: renderRow,
    renderItem: renderRow,
    render: render
  };
})(window);
