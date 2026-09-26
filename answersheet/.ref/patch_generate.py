import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

start = s.index('  function generate() {')
end = s.index('  function applyThemeToStage() {')

new = '''  /* 首页页眉里「标题行」的实测高度（mm）。
     标题一行时是 19；换行后会变高。null 表示还没测过。 */
  var measuredTitleH = null;

  /** 把当前的选项 + 页眉高度跑一遍分页与渲染，返回 HTML 与面列表 */
  function renderAll(opt) {
    var preset = C.PRESETS[opt.format];

    var blocks = Pager.planBlocks({
      preset: preset,
      group: C.GROUPS[opt.format],
      faceW: C.PAPER[opt.format].w,
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

    /* 几何：顶部定标带行心 y —— 取自角标上边距 + 角标半高 */
    var topBandY = G.r3(preset.cornerH / 2 + 13.55);
    if (opt.format === 'A3') topBandY = G.r3(preset.cornerH / 2 + 8.3);

    var perSheet = opt.format === 'A3' ? C.A3_COLUMNS : 1;
    var sheetCount = Math.ceil(faces.length / perSheet) || 1;
    var paper = C.PAPER[opt.format];

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

        var extraRows = (face && face.first) ? Page.specialRows() : [];
        extraRows.forEach(function (r) { specialPos[r.kind + 'Cy'] = r.cy; });

        var page = G.layoutPage({
          format: opt.format,
          preset: preset,
          padX: preset.padX,
          cornerInsetX: preset.cornerInsetX,
          topBandY: topBandY,
          gridTop: gridTop,
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
      violations: violations, paper: paper, preset: preset
    };
  }

  /** 量出首页「标题行」的真实高度（mm）。没有标题行时返回 null。 */
  function measureTitleH() {
    var card = $('stage').querySelector('.as-page');
    if (!card) return null;
    var t = card.querySelector('.as-head-title');
    if (!t) return null;
    var st = card.closest('.preview-stage');
    var m = st ? getComputedStyle(st).transform : 'none';
    var k = (!m || m === 'none') ? 1 : parseFloat((m.match(/matrix\\(([^,]+)/) || [0, 1])[1]);
    /* getBoundingClientRect 会被预览缩放影响，除回去才是真实 mm */
    return Math.round((t.getBoundingClientRect().height * 25.4 / 96 / k) * 1000) / 1000;
  }

  function generate() {
    var opt = readOptions();
    var stage = $('stage');

    /* 第一遍：用上次测到的标题行高（或默认值）排一遍。
       标题换行会让首页页眉变高，正文起点必须跟着下移，否则正文会被页眉压住。
       标题高度依赖字体度量，JS 算不准 —— 所以先渲染、量出来、再排第二遍。 */
    if (measuredTitleH !== null) Page.setTitleHeight(measuredTitleH);
    var r1 = renderAll(opt);
    stage.innerHTML = r1.html;
    applyThemeToStage();

    /* 量标题行高；与当前用的值不同就重排一次（正常只有一行标题，不会重排） */
    var th = measureTitleH();
    var r = r1;
    if (th !== null && Math.abs(th - Page.CHROME.rowTitle) > 0.05) {
      measuredTitleH = th;
      Page.setTitleHeight(th);
      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
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
      ' · ' + (opt.theme === 'color' ? '双色' : '黑白');
  }

'''
s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
