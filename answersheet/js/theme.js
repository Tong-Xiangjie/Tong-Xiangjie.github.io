/* =============================================================================
 * 答题卡生成器 · 主题
 * -----------------------------------------------------------------------------
 * 双色 / 黑白 两套主题。
 * 黑白模式 = 把双色里的彩色「一律换成黑色，并保留原本的深浅层次」，
 * 因此两套主题拥有**完全相同的 token 名**，只是取值不同。
 * 所有样式一律引用 token，禁止在 CSS 里硬编码颜色。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;
  var G = global.AS.geometry;

  /* 当前主题名。定位块渲染时需要把颜色内联进 style（见 marks.js 的说明），
     所以这里记一份，避免把主题名一路透传到每个 builder。 */
  var currentName = 'color';

  /**
   * 把主题 token 写成 CSS 自定义属性。
   * @param {HTMLElement} el  作用域根元素（通常是预览容器）
   * @param {string} name     'color' | 'mono'
   */
  function apply(el, name) {
    var t = C.THEMES[name] || C.THEMES.color;
    currentName = C.THEMES[name] ? name : 'color';
    el.setAttribute('data-theme', currentName);
    el.style.setProperty('--accent', t.accent);
    el.style.setProperty('--accent-soft', t.accentSoft);
    el.style.setProperty('--accent-faint', t.accentFaint);
    el.style.setProperty('--ink', t.ink);
    el.style.setProperty('--mark', t.mark);
    el.style.setProperty('--paper', t.paper);
    el.style.setProperty('--rule', t.rule);
    return t;
  }

  /** 把几何参数写成 CSS 自定义属性（与 JS 计算共用同一真源）
   *  @param {Element} el
   *  @param {object}  preset
   *  @param {string}  format  'A4' | 'A3' */
  function applyPreset(el, preset, format) {
    var p = preset;
    var off = G.boxOffsets(p);
    /* ⚠ 这里要的是**一个面**的宽度，不是整张纸宽。
       A3 是「一页三面」，每面 = 纸宽 / A3_COLUMNS；拿整张 420mm 去算，
       顶部定标带会被摊到 420mm 上，节距算成 15.97mm（实测气泡列距
       13.3mm 就是这么来的），气泡直接跑到面外。
       A4 只有一面，两者相等，所以这个 bug 只在 A3 显形。 */
    var paper = C.PAPER[format] || C.PAPER.A4;
    var faceW = G.r3(paper.w / (format === 'A3' ? C.A3_COLUMNS : 1));
    el.style.setProperty('--block-w', p.blockW + 'mm');
    /* 填涂框高恒为 宽 × 3/5，与 geometry.bubbleH 同源 */
    el.style.setProperty('--block-h', G.bubbleH(p) + 'mm');
    /* ⚠ 节距不直接读 preset.step —— 它可能是 null，表示「由顶部定标带
       反推」。geometry.choiceStep() 是唯一口径：顶部方块与气泡列共用它，
       两者节距必然相等。
       ⚠ 也**不要**把算出来的值写回 p.step：preset 是全局单例，
         写回后切版式（A4→A3）会残留上一个版式的节距。
         需要节距的地方一律现算 G.choiceStep(p, faceW)。 */
    var stepMM = G.choiceStep(p, faceW);
    el.style.setProperty('--step', stepMM + 'mm');
    el.style.setProperty('--col-gap', p.colGap + 'mm');
    /* 行内「题」间隙 = 节距 − 气泡宽，保证节距恒为 --step */
    el.style.setProperty('--q-gap', G.r3(stepMM - p.blockW) + 'mm');
    el.style.setProperty('--corner-w', p.cornerW + 'mm');
    el.style.setProperty('--corner-h', p.cornerH + 'mm');
    el.style.setProperty('--pad-x', p.padX + 'mm');
    /* ⚠ --grid-shift 已废除：网格水平位置不再靠「居中位移」，
       而是由 builders/choice.js 用 geometry 的列心直接算 margin-left。
       红框内容区由 geometry.contentBox 给出（左缘 = 左侧定位点右边缘）。 */
    el.style.setProperty('--answer-line-h', '7.7mm');
    /* 选择题红/黑框：偏移由 geometry.boxOffsets 反推 */
    el.style.setProperty('--box-border', off.border + 'mm');
    el.style.setProperty('--outer-left', off.outerLeft + 'mm');
    /* 红框左右内边距恒为 0：黑框水平位置改由自身 margin-left 给出（见 choice.js） */
    el.style.setProperty('--outer-pad-x', off.outerPadX + 'mm');
    el.style.setProperty('--outer-pad-y', off.outerPadY + 'mm');
    el.style.setProperty('--outer-pad-y-bottom', off.outerPadYBottom + 'mm');
    /* ⚠ 黑框已**没有横向内边距**（红黑框间距改由 boxGap 控制，见 boxOffsets）。
       --inner-pad-x 现在只服务**非选择题表格的单元格**上下留白，
       值必须与 subject.cellPad() 完全一致 —— 分页器按它算单题高，
       两边不一致会让分页游标比真实红框矮，最后一块压到页脚上。 */
    var sp = global.AS.subject;
    var cellPad = sp && sp.cellPad ? sp.cellPad() : G.r3(p.blockW / 2);
    el.style.setProperty('--inner-pad-x', cellPad + 'mm');
    el.style.setProperty('--inner-pad-y', cellPad + 'mm');
    /* 题头行高与它的下外边距：与 subject.HEAD_H 同源 */
    var headH = sp && sp.HEAD_H !== undefined ? sp.HEAD_H : 5;
    el.style.setProperty('--subj-head-h', headH + 'mm');
    el.style.setProperty('--subj-head-mb', '0mm');
    /* 非选择题栏目头 + 红框上下内边距：与 paginator.SUBJ_CHROME 同源。
       ⚠ 这三项决定「非选择题红框比内容高多少」，分页器就是按它们算游标的。
       ⚠ 必须用**独立的** --subj-pad-y，不能借用 --outer-pad-y ——
         那是选择题红框的内边距（1mm），两者量级不同，共用会让选择题红框变高。 */
    var sc = global.AS.paginator && global.AS.paginator.SUBJ_CHROME;
    if (sc) {
      el.style.setProperty('--subj-header-h', sc.headerH + 'mm');
      el.style.setProperty('--subj-header-mb', sc.headerGap + 'mm');
      el.style.setProperty('--subj-pad-y', sc.padY + 'mm');
      el.style.setProperty('--subj-pad-y-bottom',
        (sc.padYBottom === undefined ? sc.padY : sc.padYBottom) + 'mm');
      /* 页内提示语句的行高与间距：与分页器的 SUBJ_CHROME 同源，
         否则分页器算出的红框高和真实渲染的会差开。 */
      el.style.setProperty('--subj-tip-h', sc.tipH + 'mm');
      el.style.setProperty('--subj-tip-gap', sc.tipGap + 'mm');
    }
    /* 非选择题黑框的左右内缩量：与选择题的 boxGap **分开**两个参数。
       选择题要 3mm，非选择题只要 1mm，共用会让其中一个不合要求。 */
    var sg = (p.subjBoxGap === undefined) ? 1 : p.subjBoxGap;
    el.style.setProperty('--subj-box-gap', sg + 'mm');
    el.style.setProperty('--choice-header-h', off.headerH + 'mm');
    el.style.setProperty('--choice-header-gap', off.headerGap + 'mm');
    /* 非答题区（「考生请不要在此区域作答」）：
       红色圆角空心框，高度由分页器给出（内联写死），字号由 app 渲染后
       按框的宽高比自适应（横排 / 竖排）。这里只给"皮肤"。 */
    el.style.setProperty('--na-border', off.border + 'mm');
    el.style.setProperty('--na-radius', '3mm');
    el.style.setProperty('--na-pad', '2mm');
    /* 答题区纵向基准 —— 供 CSS 定位页脚 / 非答题区 */
    el.style.setProperty('--answer-top', G.answerTop(p) + 'mm');
    el.style.setProperty('--answer-bottom', G.answerBottom(p, paper.h) + 'mm');
    /* ⚠ 页眉网格变量（--head-title-h / --head-info-h / --head-note-h /
       --head-title-pad-top / --barcode-w）**不在这里设置**。
       原因：applyPreset 会在渲染之后再次执行，把 app 实测出来的标题行高
       覆盖回默认值，页眉的 JS 几何（缺考框行心等）就与 DOM 差开 1.9mm。
       这些变量统一由 Page.render 内联写在 .as-page 上，只有一个真源。 */
  }

  /**
   * 把字体搭配写成 CSS 自定义属性。
   * 字号用 pt（与初版一致），颜色用 token 名以便跟随主题。
   */
  function applyFonts(el) {
    var F = C.FONTS, T = C.TYPE;
    el.style.setProperty('--font-hei', F.hei);
    el.style.setProperty('--font-sun', F.sun);
    Object.keys(T).forEach(function (k) {
      var t = T[k];
      var v = (t.family === 'hei') ? 'var(--font-hei)' : 'var(--font-sun)';
      el.style.setProperty('--f-' + k, v + ' ' + t.size + '/' + (t.lh || 1.25));
      el.style.setProperty('--fw-' + k, t.weight);
      el.style.setProperty('--fs-' + k, t.size);
      el.style.setProperty('--ls-' + k, t.ls);
      el.style.setProperty('--fc-' + k, t.color === 'accent' ? 'var(--accent)' : 'var(--ink)');
    });
  }

  global.AS.theme = {
    apply: apply,
    applyPreset: applyPreset,
    applyFonts: applyFonts,
    /** 当前主题名（'color' | 'mono'）。marks.js 用它把颜色内联到定位块上。 */
    current: function () { return currentName; },
    list: function () {
      return Object.keys(C.THEMES).map(function (k) {
        return { id: k, name: C.THEMES[k].name };
      });
    }
  };
})(window);
