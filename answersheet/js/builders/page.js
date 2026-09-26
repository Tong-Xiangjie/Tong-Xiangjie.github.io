/* =============================================================================
 * 答题卡生成器 · 页面与页眉
 * -----------------------------------------------------------------------------
 * 负责：纸张外壳、面容器、页眉（标题/信息/注意事项/条形码）、页脚。
 * 内容区（选择题/非选择题）由 app 按绝对 mm 坐标放入，避免文档流影响对齐。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;
  var M = global.AS.marks;
  var G = global.AS.geometry;

  /* 页眉各段的纵向占位（mm）——与 css/card.css 的 .as-head 网格一致。
   *
   * ⚠ 页眉用**网格**（标题 / 信息 / 注意事项+条形码），标题行是 auto：
   *   标题可能一行也可能换行，信息行必须跟着标题走。
   *   标题行高依赖字体度量，JS 算不准 —— 由 app 渲染后实测，再喂回
   *   setTitleHeight()，正文起点因此永远紧贴页眉底，不会被压住。
   *
   * 各值的来历（参照初版 .ref/index.original.backup.html）：
   *   titlePadTop 14   标题文字的上留白。顶部定标带（含角标）占 9.78–12.22mm，
   *                    文字从 14mm 起排，与定标带留 1.78mm 净空，不会压住第一行。
   *   rowTitle    19   标题行最小高 = titlePadTop + 主/副标题各一行
   *   rowInfo     8.267 初版 .zk-table td 高 8mm + 边框
   *   rowNote     33   注意事项框（初版 140mm 宽、约 30mm 高）+ 缺考框底栏 9mm
   *   rowGap      5    页眉三行（标题/信息/注意事项）之间的净间距。
   *                    取 0 会让三行严丝合缝贴在一起，看着很挤。
   *                    用 CSS grid 的 row-gap 实现，所以行高本身不用改，
   *                    但 firstBottom 必须把两道 gap 加进去（见 recomputeSpecial）。
   *   otherTop    14   后续页「xx答题卡」提示行的顶位（绝对定位，见 css .as-title） */
  var CHROME = {
    rowTitle: 19,
    rowInfo: 8.267,
    rowNote: 33,
    rowGap: 5,
    titlePadTop: 14,
    barcodeW: 63,
    otherTop: 14,
    otherBottom: 20
  };
  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* 标题行的**实际**高度。默认 rowTitle（一行标题的高度）；
     标题换行时由 setTitleHeight 写入实测值，整条页眉跟着变高。
     页眉变高会让注意事项框下移，所以 SPECIAL（缺考框行心）必须同步重算 ——
     否则缺考框会脱开左侧定标块。 */
  var titleH = CHROME.rowTitle;
  var SPECIAL = null;

  function recomputeSpecial() {
    var bh = 4.06 * 3 / 5;               // 方框高 = blockW × 3/5
    /* 三行网格：标题 / 信息 / 注意事项，行间各留 rowGap */
    var noteTop = r3(titleH + CHROME.rowGap + CHROME.rowInfo + CHROME.rowGap);
    var absentCy = r3(noteTop + CHROME.rowNote - 2.5);
    CHROME.noteTop = noteTop;
    CHROME.firstBottom = r3(titleH + CHROME.rowGap + CHROME.rowInfo +
                            CHROME.rowGap + CHROME.rowNote);
    SPECIAL = {
      noteTop: noteTop,
      absentCy: absentCy,
      absentBoxTop: r3(absentCy - bh / 2)
    };
  }
  recomputeSpecial();

  /** 由 app 在「测出真实标题行高」后调用。mm 就是标题行的**总高**。 */
  function setTitleHeight(mm) {
    if (!(mm > 0)) return CHROME.firstBottom;
    titleH = r3(mm);
    recomputeSpecial();
    return CHROME.firstBottom;
  }

  /**
   * 下角标大方块**底缘距纸顶**的 y（mm）。
   * 角标上缘 y = 定标带行心 y − cornerH/2（见 app.js 的 TOP_BAND_CY = 11），
   * 所以底缘 y = 11 + cornerH/2。
   *
   * ⚠ 这个值是「距纸**顶**」，不是「距纸底」。页脚的 CSS 是 `bottom:`，
   *   必须换算：bottom = paperH − cornerBottomY。直接把 283.885 当 bottom 用，
   *   会因为「top + height + bottom > 包含块高」被浏览器当成过约束、
   *   把 bottom 丢掉改成 top:0 —— 页脚就跑到纸顶去了（用户报的
   *   「对齐上面的大方块」就是这个 bug）。
   */
  function cornerBottomY(preset) {
    var p = preset || C.PRESETS.A4;
    var TOP_BAND_CY = 11;                 // 与 app.js 的 TOP_BAND_CY 同源
    return r3(TOP_BAND_CY + p.cornerH / 2);
  }

  /* 当前渲染的纸高 / 版式，供 headVars 使用 */
  var curPaperH = C.PAPER.A4.h;
  var curPreset = C.PRESETS.A4;

  /* 缺考框对齐顶部定标带的**第几个**小方块（1 起数）。用户指定第 3 个。 */
  var TOP_BAND_ABSENT_INDEX = 3;

  /** 缺考框左缘相对 `.as-note` 内边距盒左缘的偏移（mm）。
   *
   *  用户指定：缺考框**横向**对齐顶部定标带的第 3 个小方块。
   *  第 k 块块心 = topBandGeom.first + (k−1)·step（面内坐标，第一面 faceX = 0）。
   *  内边距盒左缘（相对页面）= padX + 1px（Chrome 把 0.3mm 吸附成 1px）。
   */
  function absentBoxLeft() {
    var p = curPreset;
    var G = (global.AS && global.AS.geometry) || null;
    var faceW = C.PAPER.A4.w;
    var band = G ? G.topBandGeom(p, faceW, 0) : null;
    var markCx = band
      ? r3(band.first + (TOP_BAND_ABSENT_INDEX - 1) * band.step)
      : 0;
    var padBoxLeft = r3((p.padX || 12.7) + 0.2646);
    return r3(markCx - p.blockW / 2 - padBoxLeft);
  }

  /** 页眉网格的 CSS 变量（唯一真源，内联写到 .as-page 上） */  function headVars() {
    return '--head-title-h:' + titleH + 'mm;' +
           '--head-info-h:' + CHROME.rowInfo + 'mm;' +
           '--head-note-h:' + CHROME.rowNote + 'mm;' +
           '--head-row-gap:' + CHROME.rowGap + 'mm;' +
           '--head-title-pad-top:' + CHROME.titlePadTop + 'mm;' +
           '--head-other-title-top:' + CHROME.otherTop + 'mm;' +
           '--barcode-w:' + CHROME.barcodeW + 'mm';
  }

  /**
   * 页脚底边距纸底的距离（mm）—— 让页脚底边与**下方**两个角标大方块的
   * 底边齐平（用户指定「页脚高度对齐下面的大方块」）。
   *
   * 角标底缘距纸顶 = cornerH/2 + 11（见 app.js 的 TOP_BAND_CY），
   * 换算成距纸底就是 **11 − cornerH/2**：A4 = 11 − 2.115 = 8.885mm，
   * 于是页脚底 = 297 − 8.885 = 288.115mm，正好压在下角标底缘上。
   *
   * ⚠ 直接把「底缘距纸顶」(283.885) 当 bottom 用是错的 —— 那会让
   *   top + height + bottom 超过包含块高，浏览器把 bottom 丢掉、页脚跑到纸顶。
   */
  function footerBottom(paperH, preset) {
    var p = preset || C.PRESETS.A4;
    var G = global.AS.geometry;
    var H = paperH || C.PAPER.A4.h;
    /* 用户 2026 指定：页脚**固定在下方定位点中心的高度**，不再与红框锚定。
       下方定位点整条的行心 = H − TOP_BAND_CY（与顶部定标带同一条构造，
       TOP_BAND_CY = 11 → 下角标行心 = 286）。页脚块高取实测值 4.92mm
       （--fs-footer 若干行 line-height:1.55 的自然高），把它的**中线**
       对到这个行心：
           页脚底缘 = 行心 + 块高/2 = 286 + 2.46 = 288.46
       ⇒ bottom = H − 288.46 = 8.54mm（A4/A3 同值，因为 H − 行心 = 11）。
       ⚠ CSS 的 bottom 是「距包含块底边」，包含块 = .as-face（高 = 纸高）。
       ⚠ 不要再从这里反推红框下界 —— 两者已经解耦。红框下界的下限定在
         geometry.frameBottomLimit(p, H) = answerBottom + 0.7×cornerH。 */
    var TOP_BAND_CY = 11;                 // 与 app.js 的 TOP_BAND_CY 同源
    /* 下定位点行心（与顶部定标带同一条构造）：TOP_BAND_CY = 11 ⇒ 286mm */
    return r3(H - TOP_BAND_CY);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  /** 准考证号书写栏：一行空方框，考生手写，不填涂 */
  function zkTable(len) {
    var cells = '';
    for (var i = 0; i < len; i++) {
      cells += '<td></td>';
    }
    return '<table class="as-zk"><tr>' + cells + '</tr></table>';
  }

  /* 注意事项框（内含缺考框）
   * 缺考框的**纵向**行心由 SPECIAL 给出（与左侧定标块共用同一个行心）。
   *
   * **横向**用户指定：与顶部定标带的**第 3 个小方块**对齐
   * （「现在的高度是对的，我说的是横向对齐最上面一排的第三个小方块」）。
   * 所以 left 不再是写死的 1.0404mm，而是由 `topBandGeom` 的第 3 块块心反推：
   *
   *   left = marks[2].cx − blockW/2 − 内边距盒左缘(相对页面)
   *   内边距盒左缘 = padX + 1px = 12.7 + 0.2646 = 12.9646mm
   *
   * ⚠ 这条依赖 topBandGeom：改 blockW / cornerInsetX / cornerW / topBandCount
   *   或缺考框索引用 TOP_BAND_ABSENT_INDEX 时，这里会自动跟着走，
   *   但 CSS 里那行写死的 `left` 会失效 —— 所以改完必须看本函数的注释。
   *
   * ⚠ 坐标系：.as-check-box 挂在 .as-note 的直接子层（position:absolute），
   *   包含块是 .as-note 的**内边距盒**（= 红框内缘，去掉 0.3mm 线宽）。
   *   纵向 top 由 builder 按同一套行心算出，与左侧定标块共线。
   *   把框留在 .as-note-bottom 里会让水平基准变成底栏（多偏 8mm 且越出红框）。 */
  function notesBox() {
    var bottomH = 9;                                   // 底栏高，与 CSS .as-note-bottom 一致
    /* 底栏内的提示文字：基准是底栏顶 */
    var absentTop = r3(SPECIAL.absentBoxTop - SPECIAL.noteTop - (CHROME.rowNote - bottomH));
    /* 缺考框：基准是 .as-note 的**内边距盒顶**（红框内缘）。
       SPECIAL.noteTop 是注意事项框边框盒顶（相对页面），要再减去红框线宽
       （浏览器把 0.3mm 吸附成 1px = 0.2646mm）才是内边距盒顶。 */
    var notePadTop = r3(SPECIAL.noteTop + 0.2646);
    var boxTop = r3(SPECIAL.absentBoxTop - notePadTop);
    return '<div class="as-note">' +
      '<div class="as-note-left">注意事项</div>' +
      '<div class="as-note-main">' +
      '1.答题前，考生先填写好自己的姓名、准考证号，并认真核对条形码上的姓名、准考证号、考室和座位号；<br>' +
      '2.选择题请按题号用2B铅笔填涂方框，修改时用橡皮擦干净，不留痕迹；<br>' +
      '3.非选择题部分请按题号用0.5毫米黑色墨水签字笔书写，否则作答无效；<br>' +
      '4.在草稿纸、试题卷上答题无效；<br>' +
      '5.请勿折叠答题卡，保持字体工整、笔迹清晰、卡面清洁。' +
      '</div>' +
      '<div class="as-note-bottom">' +
      '<span class="as-note-absent-tip" style="top:' + r3(absentTop - 3.0) + 'mm">' +
        '此处为缺考考生标记，由监考员用2B铅笔填涂 →</span>' +
      '</div>' +
      '<span class="as-check-box" style="top:' + boxTop + 'mm;left:' +
        r3(absentBoxLeft()) + 'mm"></span>' +
      '</div>';
  }

  /** 页眉：首页
   *  三行网格：标题行 / 信息行 / 注意事项+条形码行。
   *  行高固定，所以「信息行」永远紧跟在标题下面 —— 标题一行还是两行都不会重叠。 */
  function chromeFirst(meta, pos) {
    var h = '<div class="as-head">';

    /* 第 1 行：标题 */
    h += '<div class="as-head-title">';
    if (meta.title) {
      h += '<div class="as-title-main">' + esc(meta.title) + '</div>';
    }
    if (meta.subject) {
      h += '<div class="as-title-sub">' + esc(meta.subject) + '答题卡</div>';
    }
    h += '</div>';

    /* 第 2 行：考生信息（姓名 / 准考证号）
       ⚠ 用户 2026 澄清：**不要「班级」**。参照件
         .ref/数学答题卡A4（6）.pdf 第 1 面也只有「姓名：」+「准考证号」。 */
    h += '<div class="as-info"><div class="as-info-row">' +
         '<span class="as-info-label">姓名：</span><span class="as-info-fill name"></span>' +
         '<span class="as-info-label">准考证号</span>' +
         zkTable(meta.zkLength) +
         '</div></div>';

    /* 第 3 行：注意事项框 + 条形码区（同一行） */
    h += '<div class="as-note-row">' +
         notesBox(pos) +
         '<div class="as-barcode">' +
         '<div class="as-barcode-title">贴条形码区</div>' +
         '<div class="as-barcode-tip">（正面朝上，切勿贴出虚线方框）</div>' +
         '</div>' +
         '</div>';

    h += '</div>';
    return h;
  }

  /** 页眉：后续页
   *  @param {object} meta
   *  @param {boolean} blank 凑偶数的**空白面** —— 用户指定「页眉只留第 N 面」，
   *         不印「xx答题卡」那行标题（整面就是一个非答题区）。
   */
  function chromeOther(meta, blank) {
    /* 续排面（第 2 面起）的页眉 —— **什么都不印**。
     *
     * ⚠ 2026 修正：原来这里会印一行「xx　yy答题卡」，占掉 14+6 = 20mm
     *   （CHROME.otherTop / otherBottom）。而红框上缘现在可以上拉到
     *   frameTopLimit（A4 = 10.154），红框就直接盖住了那行字 ——
     *   实测面 2/3 的标题在 27.997..32.470，红框从 10.154 起，整行被吞。
     *
     *   用户在「凑偶数页 → 整面一个非答题区」时已经定了口径：
     *   空白面「页眉只留「第 N 面」」，而「第 N 面」就在**页脚**里
     *   （见 footer()：`科目　第 N 面（共 M 面）`）。
     *   ⇒ 续排面和空白面的页眉都应该是空的，所以这里统一返回 ''。
     *   整行标题只在**第 1 面**的 chromeFirst() 里印一次。 */
    return '';
  }

  /** 选择题栏目头（栏目名 + 正确填涂示例） */
  function choiceHeader() {
    return '<div class="as-choice-header">' +
           '<span class="as-section-title">选择题</span>' +
           '<span class="as-section-tip">请用 2B 铅笔填涂，修改时用橡皮擦干净</span>' +
           '<span class="as-example-group">' +
           '<span class="as-section-tip">正确填涂</span>' +
           '<span class="as-example-item correct"></span>' +
           '<span class="as-section-tip">错误填涂</span>' +
           '<span class="as-example-item half"></span>' +
           '<span class="as-example-item wrong"></span>' +
           '</span></div>';
  }

  /** 页脚：只印「科目　第 N 面（共 M 面）」。
   *
   *  ⚠ 「请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效」
   *    **不在这里**。页脚是每个面都渲染一次的，放这里会全卡重复印；
   *    这句话的位置是**非选择题红框与黑框之间**的空档，
   *    由 builders/subject.js 的 .as-subject-page-tip 负责（每面非选择题各一次），
   *    唯一例外是印「非选择题（提示：…）」栏目头的那一面 —— 那里不重复印。 */
  function footer(meta, pageNo, totalPages) {
    var custom = (meta.footer || '').trim();
    var lines;
    if (custom) {
      lines = custom.split('\n').map(function (l) { return l.replace(/\{page\}/g, pageNo).replace(/\{total\}/g, totalPages); });
    } else {
      var sub = [meta.subject, '第 ' + pageNo + ' 面（共 ' + totalPages + ' 面）']
        .filter(Boolean).join('　');
      lines = [sub];
    }
    /* 页脚**中线**钉在下定位点行心上 —— 用 top + translateY(-50%)，
       不用 bottom：bottom 要先知道块高，而块高由字体度量决定（实测 5.027mm，
       CSS 里写不出来的量）。translateY(-50%) 让「块心对齐行心」由构造保证，
       换字体/换行数都不会偏。 */
    return '<div class="as-footer" style="top:' +
           footerBottom(curPaperH, curPreset) +
           'mm;transform:translateY(-50%)">' + lines.map(function (l) {
      return '<div>' + l + '</div>';
    }).join('') + '</div>';
  }

  /**
   * 渲染一张纸（可能含多个面）。
   * @param {object} o
   *   o.format    'A4' | 'A3'
   *   o.paperH    纸高（mm）
   *   o.faces     [{ L, html, first }] 每个面自己的几何与内容
   *   o.meta      试卷元信息
   *   o.pageNo    本张纸的页码
   *   o.total     总张数
   */
  function render(o) {
    curPaperH = o.paperH || C.PAPER.A4.h;
    curPreset = o.preset || C.PRESETS[o.format] || C.PRESETS.A4;
    /* 标题行高内联写死在这一张纸上：它是实测值（标题可能换行），
       不能只靠 CSS 兜底 —— 导出时会把 HTML 克隆到别处，那时变量不一定在。 */
    var html = '<div class="as-page" data-format="' + o.format + '"' +
               ' style="' + headVars() + '">';

    o.faces.forEach(function (f, fi) {
      var L = f.L;
      var bottom = o.paperH - L.corner.y - L.corner.h;
      html += '<div class="as-face" style="left:' + L.faceX + 'mm;width:' + L.faceW + 'mm">';
      if (fi > 0) html += '<div class="as-face-guide" style="left:0"></div>';
      html += M.all(L, bottom);
      html += f.first ? chromeFirst(o.meta, o.specialPos)
                      : chromeOther(o.meta, f.blank);
      html += '<div class="as-face-body">' + (f.html || '') + '</div>';
      html += footer(o.meta, o.pageNo, o.total);
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  /** 一面的页眉高度（mm）。首页同时给出缺考框/示例框的行心，供左侧定标带使用。 */
  function chromeHeight(isFirst) {
    return isFirst ? CHROME.firstBottom : CHROME.otherBottom;
  }

  /** 本面页眉（.as-head / .as-title）的底边（mm，从纸顶量）。
   *  首页 = 标题 + 信息 + 注意事项三行网格的底（CHROME.firstBottom 实测 82.95）；
   *  续排面 = 0 —— 现在 chromeOther() 返回空串，页眉什么都没有。
   *  app.js 用它把红框**上缘**写死在「页眉底 + 2mm 净空」，
   *  这样红框既不会压住页眉，高度也不会跟着页眉漂。 */
  function headBottom(isFirst) {
    return isFirst ? CHROME.firstBottom : 0;
  }

  /** 首页附加定位行（缺考框）—— 由分页器传给几何模块 */
  function specialRows() {
    return [
      { kind: 'absent', cy: SPECIAL.absentCy }
    ];
  }

  global.AS.page = {
    CHROME: CHROME,
    setTitleHeight: setTitleHeight,
    headVars: headVars,
    get SPECIAL() { return SPECIAL; },
    specialRows: specialRows,
    choiceHeader: choiceHeader,
    chromeHeight: chromeHeight,
    headBottom: headBottom,
    render: render,
    esc: esc,
    zkTable: zkTable
  };
})(window);
