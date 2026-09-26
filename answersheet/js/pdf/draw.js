/* ============================================================================
 * 绘制层 —— 把 measure.js 量出来的绘制清单落到 jsPDF 上
 *
 * 坐标与单位
 * ---------------------------------------------------------------------------
 *   · 一律 mm。jsPDF 建实例时 unit:'mm'，所以 rect/text 的坐标直接用 mm。
 *   · 字号用 pt。CSS 的 pt 与 PDF 的 pt 是同一个单位，所以
 *     `fontSize(px × 72/96)` 得到的字号与预览完全一致 —— **不要**把字号折成 mm。
 *   · jsPDF 的 `text(s, x, y)` 的 y 是**基线**，正是 measure.js 给的 y。
 *
 * 线宽与描边的坑
 * ---------------------------------------------------------------------------
 *   CSS 的 border 画在盒子**内侧**（border-box 内），而 PDF 的 stroke 以
 *   路径为中心、向两侧各扩 lw/2。若直接把盒子的外缘当路径，描边会向外多出
 *   lw/2。所以矩形描边要**向内收 lw/2**。
 *
 *   ⚠ 但 jsPDF 的 `rect(x, y, w, h, 'S')` 就是标准 PDF 矩形，没有内缩，
 *     所以要自己收：rect(x + lw/2, y + lw/2, w − lw, h − lw, 'S')。
 * ==========================================================================*/
(function (g) {
  'use strict';

  var AS = g.AS = g.AS || {};

  function r3(v) { return Math.round(v * 1000) / 1000; }
  function hex2(c) {
    function h(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  /* ── 字体注册 ─────────────────────────────────────────────────────────
     字体是**运行时按需 fetch** 的（两个字体的 base64 合计 687KB，
     挂进 index.html 会让每次打开页面都白下，只为偶尔导出一次）。
     结果缓存住，第二次导出不再下载。

     缓存里同时保留原始字节：vector.js 要读 cmap 来核对
     「卡片上的字是否都在子集里」（缺字会渲染成豆腐块）。 */
  var _fonts = null;
  var FONT_URLS = {
    hei: 'fonts/SimHei.subset.ttf',
    sun: 'fonts/SimSun.subset.ttf'
  };
  var PDF_NAMES = { hei: 'SimHei', sun: 'SimSun' };

  function toBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return g.btoa(bin);
  }

  /** 解析 TTF 的 cmap，返回它支持的字符集（字符串）。
   *  ⚠ 不要拿「生成子集时的字符清单」当准 —— 字体文件才是真源。 */
  function cmapCharsOfTTF(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var numTables = dv.getUint16(4);
    var cmapOff = 0;
    for (var i = 0; i < numTables; i++) {
      var off = 12 + i * 16;
      var tag = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
      if (tag === 'cmap') { cmapOff = dv.getUint32(off + 8); break; }
    }
    if (!cmapOff) return '';
    var n = dv.getUint16(cmapOff + 2);
    var pick = null, bestScore = -1;
    for (var j = 0; j < n; j++) {
      var rec = cmapOff + 4 + j * 8;
      var pid = dv.getUint16(rec), eid = dv.getUint16(rec + 2);
      var sub = cmapOff + dv.getUint32(rec + 4);
      var fmt = dv.getUint16(sub);
      if (fmt !== 4 && fmt !== 12) continue;
      var score = 0;
      if (pid === 3 && eid === 10) score = 40;
      else if (pid === 3 && eid === 1) score = 30;
      else if (pid === 0) score = 20;
      else if (pid === 3 && eid === 0) score = 5;      // 符号，不用于文字
      else continue;
      score += (fmt === 12 ? 2 : 1);
      if (score > bestScore) { bestScore = score; pick = { sub: sub, fmt: fmt }; }
    }
    if (!pick) return '';
    var out = [];
    if (pick.fmt === 4) {
      var segX2 = dv.getUint16(pick.sub + 6);
      var seg = segX2 / 2;
      var ends = pick.sub + 14;
      /* ⚠ 布局是 endCode[] + **2 字节保留字段** + startCode[] + idDelta[] + idRangeOffset[]
         —— 那个 2 字节 padding 最容易漏，漏了整张表都会错位。 */
      var starts = ends + seg * 2 + 2;
      var deltas = starts + seg * 2;
      var ranges = deltas + seg * 2;
      for (var s = 0; s < seg; s++) {
        var e = dv.getUint16(ends + s * 2), st = dv.getUint16(starts + s * 2);
        if (st === 0xFFFF) continue;
        var ro = dv.getUint16(ranges + s * 2);
        var dl = dv.getInt16(deltas + s * 2);
        for (var c = st; c <= e && c !== 0xFFFF; c++) {
          var gi;
          if (ro === 0) {
            /* 常见情形：直接 (code + idDelta) */
            gi = (c + dl) & 0xFFFF;
          } else {
            /* ⚠ 两跳：先在 glyphIdArray 里取一个 glyph index，
               再把它和 idDelta 相加。少加这一步就会得到一堆 0。 */
            var idx = ranges + s * 2 + ro + (c - st) * 2;
            gi = (idx + 1 < bytes.length) ? dv.getUint16(idx) : 0;
            if (gi !== 0) gi = (gi + dl) & 0xFFFF;
          }
          if (gi !== 0) out.push(c);
        }
      }
    } else {
      var nGroups = dv.getUint32(pick.sub + 12);
      for (var kg = 0; kg < nGroups; kg++) {
        var b = pick.sub + 16 + kg * 12;
        var sc = dv.getUint32(b), ec = dv.getUint32(b + 4);
        for (var cc = sc; cc <= ec && cc <= 0x10FFFF; cc++) out.push(cc);
      }
    }
    var s2 = '';
    for (var q = 0; q < out.length; q++) s2 += String.fromCodePoint(out[q]);
    return s2;
  }

  function loadFonts() {
    if (_fonts) return _fonts;
    var keys = Object.keys(FONT_URLS);
    var jobs = keys.map(function (k) {
      return g.fetch(FONT_URLS[k]).then(function (r) {
        if (!r.ok) throw new Error('字体加载失败 ' + FONT_URLS[k] + ' HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        var bytes = new Uint8Array(ab);
        /* TTF 魔数校验：0x00010000 / 'true' / 'OTTO'。
           少了这一步，404 的 HTML 会一路走到 jsPDF 里报一个看不懂的错。 */
        var ok = bytes.length > 12 && (
          (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) ||
          (bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65) ||
          (bytes[0] === 0x4F && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4F));
        if (!ok) throw new Error('字体文件不是 TTF（可能 404 页面）: ' + FONT_URLS[k]);
        return { b64: toBase64(bytes), bytes: bytes, charset: cmapCharsOfTTF(bytes) };
      });
    });
    _fonts = g.Promise.all(jobs).then(function (arr) {
      var o = {};
      keys.forEach(function (k, i) { o[k] = arr[i]; });
      AS.pdfDraw.fonts = o;          // 供探针 / 自检读取原始字节
      return o;
    });
    return _fonts;
  }

  /* 把字体挂到 jsPDF 实例上。必须在任何 setFont 之前调用。 */
  function attachFonts(pdf, fonts) {
    Object.keys(PDF_NAMES).forEach(function (k) {
      var name = PDF_NAMES[k] + '.subset.ttf';
      pdf.addFileToVFS(name, fonts[k].b64);
      pdf.addFont(name, PDF_NAMES[k], 'normal');
    });
  }

  /* ── 绘制原语 ─────────────────────────────────────────────────────── */

  function fillRect(pdf, o) {
    var c = o.color;
    if (c.a < 1) {
      /* 半透明：PDF 支持 alpha（ExtGState），jsPDF 的 setGState 需要额外对象。
         答题卡上实际没有半透明块，遇到了就退化成不透明，避免静默出错。 */
      if (g.console) console.warn('[答题卡] 导出：忽略半透明填充', o.cls, c);
    }
    pdf.setFillColor(c.r, c.g, c.b);
    pdf.rect(r3(o.x), r3(o.y), r3(o.w), r3(o.h), 'F');
  }

  function strokeRect(pdf, o) {
    var lw = o.lw > 0 ? o.lw : 0.3;
    pdf.setDrawColor(o.color.r, o.color.g, o.color.b);
    pdf.setLineWidth(lw);
    if (o.dashed) {
      /* jsPDF 的虚线单位是「用户单位」(此处 mm)，与 CSS 的 px 虚线段不同；
         条形码虚线框用固定 1mm/0.7mm，观感一致即可。 */
      pdf.setLineDashPattern([1, 0.7], 0);
    } else {
      pdf.setLineDashPattern([], 0);
    }
    /* 向内收半个线宽：CSS 的边框在内侧，PDF 的描边以路径为中心 */
    pdf.rect(r3(o.x + lw / 2), r3(o.y + lw / 2),
             r3(Math.max(0.05, o.w - lw)), r3(Math.max(0.05, o.h - lw)), 'S');
  }

  function drawText(pdf, o) {
    pdf.setFont(PDF_NAMES[o.font] || PDF_NAMES.sun);
    pdf.setFontSize(o.size);
    pdf.setTextColor(o.color.r, o.color.g, o.color.b);
    var opts = {};
    if (o.ls) opts.charSpace = o.ls;              // mm
    var tx = r3(o.x), ty = r3(o.y);
    if (o.align && o.align !== 'left') {
      /* ⚠ **不要**把 x 交给 jsPDF 的 `align` 选项。
         它的 align 是拿「给定 x」当**锚点**做居中/右对齐，而我这里的 x 是
         Range 的左缘（垂直文字则是字框心），语义完全不同 ——
         实测「考生请不要在此区域作答」整列左偏 7.937mm，
         页脚那行居中句左偏 1.366mm。
         自己换算成**左缘**再按 align:'left' 画：
             左缘 = o.x                              （左对齐）
             左缘 = o.x + o.w/2 − 实测串宽/2          （居中）
             左缘 = o.x + o.w   − 实测串宽            （右对齐）
         ⚠ 串宽必须用 `getTextWidth` 量，不能用 o.w（Range 宽）：
           Range 宽含字符左右边距与字距，与 jsPDF 的推进宽度不是同一个量。 */
      var tw = pdf.getTextWidth(o.text);
      /* charSpace 不在 getTextWidth 里，得自己补 */
      if (o.ls) tw += o.ls * Math.max(0, o.text.length - 1);
      var left = o.x;
      if (o.align === 'center') left = o.x + o.w / 2 - tw / 2;
      else if (o.align === 'right') left = o.x + o.w - tw;
      tx = r3(left);
    }
    /* jsPDF 对参数类型很挑：x/y 必须是有限数字，否则直接抛
       「Invalid arguments passed to jsPDF.text」，而且不告诉你是哪一个参数。
       这里守住，出问题时把这一条的来龙去脉打出来。 */
    if (!isFinite(tx) || !isFinite(ty)) {
      if (g.console) {
        g.console.error('[答题卡] 文字坐标非法，已跳过', {
          text: o.text, x: o.x, y: o.y, w: o.w, align: o.align, cls: o.cls
        });
      }
      return;
    }
    pdf.text(String(o.text), tx, ty, opts);
  }

  AS.pdfDraw = {
    loadFonts: loadFonts,
    attachFonts: attachFonts,
    cmapCharsOfTTF: cmapCharsOfTTF,
    fillRect: fillRect,
    strokeRect: strokeRect,
    drawText: drawText,
    hex2: hex2,
    PDF_NAMES: PDF_NAMES
  };
})(window);
