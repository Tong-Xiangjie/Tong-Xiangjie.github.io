/* =============================================================================
 * 答题卡生成器 · 定位块
 * -----------------------------------------------------------------------------
 * 顶部定标带 / 左侧定标带 / 四角角标 —— 全部直接消费 geometry 算出的坐标，
 * 位置与尺寸一律用**绝对定位**落到纸上，不参与文档流。
 *
 * 这样做的原因：定位块必须与填涂框严格对齐。如果把它放进 flex 文档流，
 * 它的位置就会受行高/间隙影响，从而再次失配（旧版的病根）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var G = global.AS.geometry;
  var C = global.AS.config;

  /**
   * 生成一个定位块。
   *
   * 位置、尺寸、**颜色**全部内联写死，不依赖 CSS 类与自定义属性：
   * html2canvas（导出 PDF 的库）在克隆文档里对「靠 var(--mark) 上色的绝对定位小方块」
   * 会整批漏渲染 —— 实测顶部定标块能画出来、左侧定标块一块都画不出来，
   * 而把同一元素克隆一份、只改内联背景色，就立刻能画出来。
   * 所以这里直接把主题色内联进去，彻底绕开该缺陷。
   *
   * @param {string} cls  类名（仍保留，供 CSS 兜底与调试选择器使用）
   * @param {object} o    { x, y, w, h, color }
   */
  function box(cls, o) {
    var color = o.color || (C.THEMES[global.AS.theme.current()] || C.THEMES.color).mark;
    return '<div class="' + cls + '" style="left:' + o.x + 'mm;top:' + o.y + 'mm;' +
           'width:' + o.w + 'mm;height:' + o.h + 'mm;background:' + color + '"></div>';
  }

  /** 由「中心 + 尺寸」转成「左上角 + 尺寸」 */
  function fromCenter(m) {
    return {
      x: G.r3(m.cx - m.w / 2),
      y: G.r3(m.cy - m.h / 2),
      w: m.w,
      h: m.h
    };
  }

  /** 四角角标（每个面一组）。pageBottom = 下角标上缘 y */
  function corners(L, pageBottom) {
    var c = L.corner;
    var x0 = c.x;
    var x1 = G.r3(L.faceX + L.faceW - c.x - c.w);
    var y0 = c.y;
    var out = box('as-corner', { x: x0, y: y0, w: c.w, h: c.h }) +
              box('as-corner', { x: x1, y: y0, w: c.w, h: c.h });
    if (pageBottom !== undefined && pageBottom !== null) {
      out += box('as-corner', { x: x0, y: pageBottom, w: c.w, h: c.h }) +
             box('as-corner', { x: x1, y: pageBottom, w: c.w, h: c.h });
    }
    return out;
  }

  /** 顶部定标带：块心 x 严格等于列心 x */
  function topBand(L) {
    return L.topMarks.map(function (m) {
      return box('as-mark as-mark-top', fromCenter(m));
    }).join('');
  }

  /** 左侧定标带：块心 y 严格等于行心 y */
  function leftBand(L) {
    return L.leftMarks.map(function (m) {
      return box('as-mark as-mark-left', fromCenter(m));
    }).join('');
  }

  /** 一个面里所有定位块 */
  function all(L, pageBottom) {
    return corners(L, pageBottom) + topBand(L) + leftBand(L);
  }

  global.AS.marks = {
    corners: corners,
    topBand: topBand,
    leftBand: leftBand,
    all: all,
    fromCenter: fromCenter
  };
})(window);
