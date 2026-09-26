/* =============================================================================
 * 答题卡生成器 · 非答题区
 * -----------------------------------------------------------------------------
 * 「考生请不要在此区域作答」——红色圆角空心框，**吃掉一面排完内容后
 * 剩下的空白**，避免出现「没有名目的空档」。
 *
 * 规则（用户 2026 指定）：
 *   · 一面排完正文后，剩余空白 ≥ paginator.NOANSWER_MIN_H(15mm) → 画这个框；
 *   · 剩余 < 15mm → 不画，交给最后一个红/黑框往下拉（答题区留白）。
 *
 * ⚠ 它不是「最后一页专属」—— 任何一面剩得多就画（原设计只判 isLastPage，
 *   那是错的：选择题多的时候第一面就会有空白）。
 *
 * 高度：由分页器算好（noAnswerH）后**内联写死**，不走 CSS 流 ——
 *   与全卡其它纵向元素一样，「对齐由构造保证」。
 * 字号：框的宽高比决定横排还是竖排，字号按「11 个字铺满长边」反推，
 *   渲染后由 app.js 实测 clientWidth/clientHeight 再定（见 fitAll()）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;

  var TEXT = '考生请不要在此区域作答';
  var TEXT_LEN = TEXT.length;          // 11
  var MIN_FONT = 12;                   // px
  var MAX_FONT = 60;                   // px
  var COEF = 0.85;                     // 长边利用率（留边距）

  /** 非答题区占位高度（mm）。分页器只在 ≥ NOANSWER_MIN_H 时才给值。 */
  function heightOf(h) {
    return Math.round((h || 0) * 1000) / 1000;
  }

  /**
   * 按框的实际像素宽高算字号与书写方向。
   * @param {number} w 框内容盒宽（px）
   * @param {number} h 框内容盒高（px）
   * @returns {{fontSize:number, vertical:boolean}}
   */
  function fitStyle(w, h) {
    var horizontal = w >= h;
    var size;
    if (horizontal) {
      /* 横排：11 个字一行，字号受宽度限制；同时不超过高的 0.7 倍 */
      size = (w / TEXT_LEN) * COEF;
      size = Math.min(size, h * 0.7);
    } else {
      /* 竖排：一字一行，字号受高度限制；同时不超过宽的 0.7 倍 */
      size = (h / TEXT_LEN) * COEF;
      size = Math.min(size, w * 0.7);
    }
    size = Math.max(MIN_FONT, Math.min(MAX_FONT, size));
    return { fontSize: size, vertical: !horizontal };
  }

  /**
   * 渲染非答题区。
   * @param {object} o
   *   o.height mm，必填（由分页器给）
   *   o.top    mm（红框内缘顶，即上一块的下沿），可省略
   *   o.left   mm（相对面左缘，省略则用 --outer-left）
   *   o.width  mm（省略则用红框宽）
   */
  function render(o) {
    o = o || {};
    var h = heightOf(o.height);
    if (!(h > 0)) return '';
    var style = 'height:' + h + 'mm;';
    if (o.top !== undefined && o.top !== null) {
      style += 'top:' + (Math.round(o.top * 1000) / 1000) + 'mm;';
    }
    if (o.left !== undefined && o.left !== null) {
      style += 'left:' + (Math.round(o.left * 1000) / 1000) + 'mm;';
    }
    if (o.width !== undefined && o.width !== null) {
      style += 'width:' + (Math.round(o.width * 1000) / 1000) + 'mm;';
    }
    return '<div class="as-noanswer" style="' + style + '">' +
             '<div class="as-noanswer-text">' + TEXT + '</div>' +
           '</div>';
  }

  global.AS.noAnswer = {
    TEXT: TEXT,
    TEXT_LEN: TEXT_LEN,
    MIN_FONT: MIN_FONT,
    MAX_FONT: MAX_FONT,
    fitStyle: fitStyle,
    render: render
  };
})(window);
