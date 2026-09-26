/* ============================================================================
 * 矢量导出 —— 全矢量 PDF（文字可选中、可搜索；框线任意缩放都锐利）
 *
 * 与位图导出的关系
 * ---------------------------------------------------------------------------
 *   位图导出（html2pdf 链路）把整张纸截成 300DPI PNG 塞进 PDF：
 *   保真度最高（就是预览本身），但文字不可选、放大会糊、文件 ~330KB/页。
 *
 *   本模块走 jsPDF 矢量：measure.js 量 DOM → draw.js 画到 jsPDF。
 *   文件更小（~50KB/页）、文字可选中、任意缩放锐利。
 *   代价是几何是**重画**的，与预览会有 1 像素（0.13mm）级出入。
 *
 * 坐标
 * ---------------------------------------------------------------------------
 *   每张纸一个 jsPDF 页，页内坐标一律 mm、原点在纸左上。
 *   A3 是横向一张纸三面 —— 不用特殊处理：measure 量出来的本来就是
 *   纸内绝对坐标，面的偏移天然带上。
 * ==========================================================================*/
(function (g) {
  'use strict';

  var AS = g.AS = g.AS || {};

  /* 子集里有没有这些字？缺字会渲染成豆腐块 —— 必须查出来并告知用户。 */
  function checkCoverage(texts, charset) {
    var missing = {};
    texts.forEach(function (t) {
      var s = String(t.text || '');
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\u3000') continue;
        if (charset.indexOf(ch) < 0) missing[ch] = (missing[ch] || 0) + 1;
      }
    });
    return Object.keys(missing);
  }

  /* ── 主导出 ─────────────────────────────────────────────────────────
     opts: { stage, format, theme, onProgress }
     返回 Promise<{ pdf, stats, missing, charsetSize }> */
  function render(opts) {
    var C = AS.config;
    var pdfCtor = (g.jspdf && g.jspdf.jsPDF) ? g.jspdf.jsPDF : null;
    if (!pdfCtor) return g.Promise.reject(new Error('jsPDF 未加载（jspdf.umd.min.js）'));

    var stage = opts.stage;
    if (!stage) return g.Promise.reject(new Error('缺少 stage'));
    var format = opts.format || 'A4';
    var paper = C.PAPER[format];
    var pages = Array.prototype.slice.call(stage.querySelectorAll('.as-page'));
    if (!pages.length) return g.Promise.reject(new Error('请先生成答题卡。'));

    return AS.pdfDraw.loadFonts().then(function (fonts) {
      /* 两个字体的子集是同一份字符清单生成的，取黑体的 cmap 当准即可。 */
      var charset = fonts.hei.charset || '';
      var pdf = new pdfCtor({ unit: 'mm', format: [paper.w, paper.h],
                              orientation: paper.orientation, compress: true });
      AS.pdfDraw.attachFonts(pdf, fonts);

      var stats = { pages: 0, fills: 0, strokes: 0, texts: 0, chars: 0 };
      var allText = [];

      /* 逐张纸顺序处理，中间让出主线程，好让进度提示能刷新 */
      var chain = g.Promise.resolve();
      pages.forEach(function (pageEl, pi) {
        chain = chain.then(function () {
          if (opts.onProgress) opts.onProgress(pi + 1, pages.length);
          return new g.Promise(function (res) { g.setTimeout(res, 0); });
        }).then(function () {
          if (pi > 0) pdf.addPage([paper.w, paper.h], paper.orientation);
          var m = AS.pdfMeasure.measurePage(pageEl, paper);
          /* 画序：填充（底）→ 描边（框线）→ 文字（顶）。
             ⚠ 不能按 DOM 顺序画 —— 黑框描边可能排在定位点填充之前，
               会被盖住；文字必须最后画，否则被框线压掉。 */
          m.fills.forEach(function (o) { AS.pdfDraw.fillRect(pdf, o); });
          m.strokes.forEach(function (o) { AS.pdfDraw.strokeRect(pdf, o); });
          m.texts.forEach(function (o) { AS.pdfDraw.drawText(pdf, o); });
          stats.pages++;
          stats.fills += m.fills.length;
          stats.strokes += m.strokes.length;
          stats.texts += m.texts.length;
          allText = allText.concat(m.texts);
        });
      });

      return chain.then(function () {
        stats.chars = charset.length;
        return {
          pdf: pdf, stats: stats, charsetSize: charset.length,
          missing: checkCoverage(allText, charset)
        };
      });
    });
  }

  AS.pdfVector = {
    render: render,
    checkCoverage: checkCoverage,
    /** 只测量、不落 PDF —— 供 .ref 探针核对几何 */
    measureOnly: function (stage, format) {
      var C = AS.config;
      var paper = C.PAPER[format || 'A4'];
      return Array.prototype.slice.call(stage.querySelectorAll('.as-page'))
        .map(function (el) { return AS.pdfMeasure.measurePage(el, paper); });
    }
  };
})(window);
