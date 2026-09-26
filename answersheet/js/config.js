/* =============================================================================
 * 答题卡生成器 · 几何参数（单一真源）
 * -----------------------------------------------------------------------------
 * 所有尺寸单位一律 mm。CSS 变量与 JS 计算都必须从这里取值，
 * 禁止在别处硬编码毫米数 —— 这是「定位块与填涂框严格对齐」的前提。
 *
 * 对齐规则（用户确认）：
 *   ① 顶部定标带：节距 = 气泡列距，块心对齐列心；铺不满则整体居中
 *   ② 左侧定标带：题号行 + A/B/C/D，块心对齐行心
 *   ③ 角标中心   = ( 左侧定标带列心 x , 顶部定标带行心 y )
 *   ④ 定位块尺寸 = 填涂框尺寸
 *   ⑤ 网格严格等距，空行/空列用同尺寸占位
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 纸张（mm） */
  var PAPER = {
    A4: { w: 210, h: 297, orientation: 'portrait' },
    A3: { w: 420, h: 297, orientation: 'landscape' }
  };

  /* A3 横向 = 三栏并排，每栏是一「面」 */
  var A3_COLUMNS = 3;

  /* ---------------------------------------------------------------------
   * 版式预设
   *   blockW        : 填涂框（气泡）宽度 —— 定位块与之严格相等
   *   step          : 气泡列距（= 顶部定标带节距）
   *   colGap        : 列内相邻行（题号/A/B/C/D）之间的间隙。
   *                   ⚠ 必须是「整设备像素」的毫米值（96dpi 下 7px = 1.852mm）：
   *                   浏览器会把 flex gap 吸附到整数像素，非整像素值会让
   *                   CSS 实际间隙与行心计算差 0.007mm/行，五行累积后
   *                   最上面一行与定标块错开约 0.5mm。用 pxMM(7) 生成。
   *   optRows       : 选项个数
   *   cornerW/H     : 四角大方块尺寸
   *   cornerInsetX  : 角标中心 x 到「面」左边缘的距离（= 左侧定位点列心）
   *   padX          : **页眉/页脚**的左右留白（红框不受它影响）
   *   markGap       : 左侧定位点右边缘 → 红框**外**缘的水平距离
   *   boxGap        : 红框内缘 → 黑框外缘的水平距离
   *
   * 横向是一条单向链，四个量互不干扰，可以随便调：
   *   定位点右缘 ──markGap──> 红框外缘 ──线宽──> 红框内缘 ──boxGap──> 黑框外缘
   *   ──线宽──> 网格左缘 ──(列心 = 网格左缘 + blockW/2 + i×step)
   *
   * 填涂框高度不在此处写死：恒为 blockW × 3/5（见 geometry.bubbleH），
   * 与 CSS 的 calc(var(--block-w) * 3 / 5) 同源，避免两套数打架。
   *
   * 实测校准（参考件像素反解 + PDF 文字层，150dpi）：
   *   气泡列距 5.6mm、选项行距 3.5mm —— A3/A4 三份参考件一致
   *   题号中心与气泡列心共线（A4 实测题号 x 中心 19.13/25.06/31.24…，节距 5.93）
   *   角标 6.77×4.23（三份参考件一致）
   *   定位点右缘 → 红框外缘：参考件实测 3.22mm（A4 9.31 → 12.53）
   * ------------------------------------------------------------------- */
  var PRESETS = {
    /* A4 纵向 */
    A4: {
      blockW: 4.06,
      colGap: 1.852,        // = 7px @96dpi，整像素，避免 flex gap 被吸附后失配
      optRows: 4,
      cornerW: 6.77,
      cornerH: 4.23,
      cornerInsetX: 8.975,
      padX: 12.7,
      markGap: 3.0,         // 定位点右缘 → 红框外缘（参考件 3.22）
      boxGap: 3.0,          // 红框内缘 → 黑框外缘（固定 3mm）
      subjBoxGap: 1.0,      // 非选择题黑框：红框内缘 → 黑框外缘（固定 1mm）
      /* ── 顶部定标带 / 气泡列的节距（用户指定）────────────────────────
         带子既要「29 个方块」、又要「第一个和最后一个小方块与顶角大方块
         留出和小方块之间一样的空隙」，而红框宽度不够同时满足更大的间距，
         所以**间距由这两个约束反推出来**（≈6.09mm），方块宽仍 = 气泡宽。

         step          必须为 null：气泡列距 = 顶部方块距（用户要求两者
                       节距相等），由 geometry.choiceStep() 反推。
         gridShiftX    必须为 null：网格右移量 = 一个方块距，这样第一列
                       正好压在**第二个**小方块上。
         markShiftX    已不再参与定位（带子完全由气泡列推出），保留仅作调试。
         topBandCount  顶部方块数，标准 A4 答题卡是 29。 */
      step: null,
      gridShiftX: null,
      markShiftX: null,
      topBandCount: 29,
      /* 黑框内的上下空档（CSS padding）。用户要求视觉上都固定 3mm。
         ⚠ 标称 3 会分别实测成 2.997 / 0.893 —— 原因是网格与气泡都带
           半行/半格的居中偏移（行心 = 块心 + 0.83mm 之类），
           padding 要减掉这些固有偏移才能得到**视觉** 3mm。
           这两个数是实测校准值，改 CSS 结构后必须重量（.ref/pad_probe.mjs）。 */
      innerPadTop: 3.0,
      innerPadBottom: 2.62,
    },

    /* A3 横向：5 个一块，放满换行 */
    A3: {
      blockW: 4.0,
      colGap: 1.852,        // = 7px @96dpi，整像素
      optRows: 4,
      cornerW: 6.77,
      cornerH: 4.23,
      cornerInsetX: 8.975,
      padX: 12.7,
      markGap: 3.0,
      boxGap: 3.0,          // 与 A4 同值：红框内缘 → 黑框外缘
      subjBoxGap: 1.0,      // 与 A4 同值
      step: null,           // = 顶部方块距，见 A4 注释
      gridShiftX: null,     // = 一个方块距
      markShiftX: null,
      topBandCount: 29,
      innerPadTop: 3.0,     // 实测校准，见 A4 注释
      innerPadBottom: 2.62
    }
  };

  /* 选择题换行时，上一行最后一个选项与下一行题号之间要空出的高度（mm）。
     = 一个定位点（气泡）的高度，即 blockW × 3/5。取 0 会让两行贴在一起。 */
  var LINE_GAP_BUBBLES = 1;

  /* 正文各大块之间的纵向间距（页眉 / 选择题 / 非选择题）。
     0 会让三个版块严丝合缝地贴在一起，看着很挤。 */
  var SECTION_GAP = 5;

  /* 选择题分组
   *   size : 每块题数上限 —— 5 题一块
   *   gap  : 块与块之间的空列宽度（以「列」为单位，1 = 空出一列的宽度）
   *
   * 分块规则（用户指定，两种纸一致）：
   *   先按 5 题切块，再看最后余数：
   *     余 0 → 不处理（末块正好 5 题）
   *     余 1 → 把这一题并进**前一块**（末块变成 6 题）
   *     余 2、3、4 → 单独成块
   *   实测对照：5→5、6→6、7→5+2、8→5+3、9→5+4、10→5+5、
   *            11→5+6、12→5+7、13→5+5+3、14→5+5+4、15→5+5+5
   *   （注意 11→5+6 而不是 8+3：6 是「5 题块 + 余 1 题」并进去的结果，
   *     8 题整体并不会被拆成 5+3 再合并。）
   *
   * 换行：一行放满 perLine 块就换新行，行与行之间同样空出一行的高度。
   */
  var GROUPS = {
    A4: { size: 5, perLine: 4, gap: 1 },
    A3: { size: 5, perLine: 4, gap: 1 }
  };

  /* 选择题区的附加定位行（缺考框 / 正确填涂示例框）
   * dy = 相对「网格列顶」的偏移；由分页器换算成绝对 y 后传给几何模块，
   * 使它们各自拥有一块对齐的左侧定标块。
   * 两个框落在注意事项框底部那一行，因此 dy 为负、且绝对值大于页眉高度差。 */
  var SPECIAL_ROWS = [
    { kind: 'sample', dy: -14 },   // 正确填涂示例框
    { kind: 'absent', dy: -7 }     // 缺考标记框
  ];

  /* 页面纵向留白 */
  var VERTICAL = {
    pageTop: 13,
    pageBottom: 13,
    /* 首页被标题/信息/注意事项占掉的高度 */
    firstPageChrome: 160,
    /* 后续页仅页眉提示 */
    otherPageChrome: 8
  };

  /* 非选择题：按分值估算所需高度 */
  var SUBJECTIVE = {
    baseH: 12,
    perScoreH: 1.8,
    minH: 12
  };

  /* 主题色（双色 / 黑白）—— 黑白 = 彩色一律转黑，保留深浅层次 */
  var THEMES = {
    color: {
      name: '双色',
      accent: '#d93025',
      accentSoft: '#e8675e',
      accentFaint: '#f6c9c6',
      ink: '#000000',
      mark: '#000000',
      paper: '#ffffff',
      rule: '#000000'
    },
    mono: {
      name: '黑白',
      accent: '#000000',
      accentSoft: '#4d4d4d',
      accentFaint: '#b3b3b3',
      ink: '#000000',
      mark: '#000000',
      paper: '#ffffff',
      rule: '#000000'
    }
  };

  /* ---------------------------------------------------------------------
   * 字体：沿用初版确立的搭配（这是排版质感的关键，不要随意改动）
   *   标题 / 栏目名 / 题号 / 表头 → SimHei 黑体
   *   说明文字 / 填空 / 作答区   → SimSun 宋体
   * 字号一律用 pt（与初版一致），避免 mm 换算带来的观感偏差。
   * ------------------------------------------------------------------- */
  var FONTS = {
    hei: '"SimHei", "黑体", "Microsoft YaHei", sans-serif',
    sun: '"SimSun", "宋体", "Songti SC", serif'
  };

  var TYPE = {
    mainTitle:   { family: 'hei', size: '18pt',   color: 'accent', weight: 'normal',  ls: '0' },
    subTitle:    { family: 'hei', size: '18pt',   color: 'ink',    weight: 'normal',  ls: '0' },
    info:        { family: 'sun', size: '12pt',   color: 'ink',    weight: '500',     ls: '0' },
    noteLabel:   { family: 'hei', size: '12pt',   color: 'accent', weight: 'normal',  ls: '2mm' },
    noteBody:    { family: 'sun', size: '8pt',    color: 'accent', weight: 'normal',  ls: '0' },
    barcodeTitle:{ family: 'sun', size: '14pt',   color: 'accent', weight: 'bold',    ls: '1mm' },
    barcodeTip:  { family: 'sun', size: '8pt',    color: 'accent', weight: 'normal',  ls: '0' },
    sectionTitle:{ family: 'hei', size: '11pt',   color: 'accent', weight: 'normal',  ls: '0' },
    /* 栏目头提示「(提示：请用…作答…)」—— 原稿 .choice-tip / .subject-tip 是 9pt */
    sectionTip:  { family: 'sun', size: '9pt',    color: 'accent', weight: 'normal',  ls: '0' },
    /* 页内提示「请在各题目的答题区域内作答…」—— 原稿 .subject-page-tip
       是 10pt、宋体、红色、居中，印在非选择题红框与黑框之间。 */
    pageTip:     { family: 'sun', size: '10pt',   color: 'accent', weight: 'normal',  ls: '0' },
    num:         { family: 'hei', size: '9.5pt',  color: 'ink',    weight: '500',     ls: '0' },
    opt:         { family: 'hei', size: '7.5pt',  color: 'accent', weight: 'normal',  ls: '0' },
    answerNo:    { family: 'sun', size: '12.5pt', color: 'ink',    weight: 'normal',  ls: '0' },
    /* 续排段题头「续14.」—— 红色（accent），比正题号稍小 */
    answerCont:  { family: 'sun', size: '11pt',   color: 'accent', weight: 'normal',  ls: '0' },
    answerScore: { family: 'sun', size: '10pt',   color: 'accent', weight: 'normal',  ls: '0' },
    fillLabel:   { family: 'sun', size: '11pt',   color: 'ink',    weight: 'normal',  ls: '0' },
    footer:      { family: 'sun', size: '9pt',    color: 'accent', weight: 'normal',  ls: '0' },
  };

  global.AS = global.AS || {};
  global.AS.config = {
    PAPER: PAPER,
    A3_COLUMNS: A3_COLUMNS,
    PRESETS: PRESETS,
    GROUPS: GROUPS,
    SECTION_GAP: SECTION_GAP,
    LINE_GAP_BUBBLES: LINE_GAP_BUBBLES,
    SPECIAL_ROWS: SPECIAL_ROWS,
    VERTICAL: VERTICAL,
    SUBJECTIVE: SUBJECTIVE,
    THEMES: THEMES,
    FONTS: FONTS,
    TYPE: TYPE
  };
})(window);
