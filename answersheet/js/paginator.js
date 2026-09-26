/* =============================================================================
 * 答题卡生成器 · 分页器
 * -----------------------------------------------------------------------------
 * 职责：把「选择题若干行 + 非选择题若干题」切成一面一面，并给出每一面：
 *   · 每个版块的 boxTop（红框上缘，mm，从纸顶量）
 *   · 选择题网格顶 gridTop、行数 rows、行高 colH、行间空档 lineGap
 *   · 非选择题每段的行数、是否续排、是否印栏目头
 *   · 收口信息：stretch（下拉量）/ noAnswer（非答题区）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 纵向模型（用户 2026 定稿）
 * ---------------------------------------------------------------------------
 *   答题区      answerTop .. answerBottom        = 上角标下缘 .. 下角标上缘
 *   红框固定缘  F_TOP .. F_BOT                   = 答题区**内缩** 0.7×cornerH
 *   红框高度    frameH = F_BOT − F_TOP           = 常量（与页眉/题量无关）
 *   页脚        固定在**下方定位点中心**高度，与红框解耦
 *
 *   首页红框上缘还要避开页眉：base = max(F_TOP, 页眉底 + FRAME_TOP_GAP)
 *   续排面页眉是空的（chromeOther 返回 ''），所以 base = F_TOP
 *
 * ⚠ 历史坑（都踩过，别再走回去）
 *   ① base 曾写成 max(A_TOP, chromeFirst) —— 上缘被钉死，调不动；
 *   ② 曾写成 chromeFirst − frameExtend —— 红框高度跟着页眉漂；
 *   ③ 曾让红框高度随内容长 —— 于是「红框底」要线性回归才猜得出来，
 *      而 device px 吸附让偏移跨度 17mm、拟合不出（最大残差 12.8mm）。
 *      现在高度是常量，「红框底 = base + frameH」是恒等式。
 * ========================================================================== */
(function (global) {
  'use strict';

  var C = global.AS.config;
  var G = global.AS.geometry;
  var Subject = global.AS.subject;

  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* 纸高。两种纸都是 297。 */
  var PAGE_H = 297;

  /* ── 红框的「框体装饰」────────────────────────────────────────────────
     红框内自上而下：上内边距 / 上提示 / 栏目头 / 黑框 / 下提示 / 下内边距。
     这些量必须与 css/card.css 的 --outer-pad-y* / --subj-* 同源
     （theme.js 会把同一组数写成 CSS 变量）。 */
  var FRAME_PAD = 0.5;                       // 红框上下内边距
  var TIP_H = 4.0;                           // 页内提示语句固定高
  var TIP_GAP = 0.5;                         // 提示 ↔ 框 的净空
  var FOOTER_H = 5.0;                        // 页脚块高（仅作历史兼容导出）
  var FOOTER_PAD = 0.5;

  /* 非选择题区的框体装饰 */
  var SUBJ_CHROME = {
    padY: 0.5,
    padYBottom: 0.5,
    headerH: 5.0,
    headerGap: 1.0,
    tipH: 4.0,
    tipGap: 0.5
  };
  /* 黑框（表格）上方的固定装饰 = 「红框顶 → 黑框顶」的实测距离。
     ⚠ 不是 TIP_GAP+TIP_H+TIP_GAP = 5.0 —— 那是**内容**口径。
       真实渲染（.ref/layout.cjs，offsetTop 差）恒为 **6.879**：
         红框上边框 0.265 + 上内边距 0.5 + 上提示块 3.998 起 + 下净空 …
       两边不一致，分页器算的「容量」就会比真实多出 1.879mm/题，
       最后一块会顶穿红框（实测 20 选择+4 题黑框 301 > 红框 280.924）。 */
  var SUBJ_BOX_CHROME = 6.879;

  /* ⚠ SUBJ_BOX_CHROME 在**推进量**里已经不再单独相加 ——
     subject.itemHeight() 的内部结构就是 11.3 + 7.7n：
        题头 5.0 + 作答区 7.7n + 单元格上下内边距 5.0 + 行盒余量 1.3
     而实测「首题上缘 → 表格底」比 itemHeight 还多 **6.3mm/题**
     （.ref/layout.cjs：12 选择+2 题，首题上缘 124.475、次题上缘 193.199，
      差 68.724 = itemHeight(6) 51.2 + 17.5… —— 归到 per-item 常量最稳）。
     所以推进量 = itemHeight + SUBJ_ITEM_PITCH，SUBJ_BOX_CHROME 只用于
     「红框顶 → 表格顶」的自检与探针。 */

  /* 剩余空白 ≥ 这个值就画「非答题区」，否则拉大最后一行答题区 */
  var NOANSWER_MIN_H = 15;
  var NOANSWER_TEXT = '考生请不要在此区域作答';

  /* 版块之间的纵向间距（页眉 → 选择题 → 非选择题） */
  function sectionGap() {
    return (C.SECTION_GAP === undefined) ? 5 : C.SECTION_GAP;
  }

  /* 一面放不下时，切出来的碎段至少要有这么多行，否则整段挪到下一面 */
  var SPLIT_MIN_LINES = 2;

  /* 选择题一行的高度（含行间空档）—— 与 geometry 同源 */
  function choiceLineH(p) { return G.lineHeight(p); }

  /* 红框上缘与页眉之间必须留的净空 */
  var FRAME_TOP_GAP = 2.0;

  /** 一段非选择题的内容高（mm）= 框体装饰（含栏目头/题头修正）+ 行数×行高。
   *  ⚠ 收口求「内容自然底」时必须读这个字段；三处 push 漏写 h 会让
   *    subjCH 恒为 0、subjBoxBottom 恒为 null，红框就永远拿不到定高（踩过）。 */
  function subjSegH(it, baseH, lines) {
    return r3(baseH + (lines || 0) * (it.lineH || 7.7));
  }

  /* 浮点比较余量：判定「刚好放下」时留一点，避免 0.02mm 的差把人骗过去 */
  var EPS_MM = 0.02;

  /* 非选择题单题高度模型修正。
     ⚠ 2026 重测（.ref/subjh.cjs，3 题 × 4/6/8/10/12/16 行）：
       模型比实测高 1.048mm/题，斜率一致（lineH 对）。取 0.9 修正。
       原来 1.881 是在「红框随内容长」时代反查的，混进了框自身取整误差，
       偏大 0.98mm/题 × 2~3 题 = 少算 2~3mm 容量 ——
       正是「非选择题还没排完就换页」的来源。 */
  var SUBJ_ITEM_FIX = 0;

  /* 非选择题**每段对游标的推进量** = it.h + SUBJ_ITEM_PITCH。
     ⚠ 为什么不是只有 it.h：
       it.h = subject.itemHeight() = 11.3 + 7.7n，是「表格行盒」的高；
       而每一行渲染出来的实际推进量还多 **6.3mm** —— 单元格里
       .as-subj-head 是 flex、.as-subj-body 是 block，两者的盒模型让
       单元格（td）比「行盒高」高 6.3mm（实测 .ref/layout.cjs /
       .ref/domchain.cjs：12 选择+2 题，首题 td 底 − 红框内容顶 = 63.5，
       而 itemHeight(6) = 51.2）。
     ⚠ 旧值把这一项错记成 0，于是分页器以为本面还能再放一题，
       实际放不下 —— 正是用户报的「非选择题还没排完就自动换页 / 溢出」。 */
  var SUBJ_ITEM_PITCH = 6.3;

  /* 作答行**单行最多能长到天然行高的几倍**（用户选定「把空白摊进作答行」）。
     ⚠ 必须有上限：A4 一面的红框能装 260mm 内容，而「0 选择 + 1 题」
       这种极端配置只剩一行段要吃掉 175mm 空白 —— 不封顶会得到 40mm
       高的「一行」，看着不像答题卡。封顶后剩余空白留给 fitFrames 收口
       （红框照样拉到下界，只是黑框不跟着长，是「答题区底部留白」，用户允许）。 */

  /* ⚠⚠ SUBJ_ITEM_FIX **必须是 0**。
     历史：它曾在「红框随内容长」时代被反查成 1.881，后来又被改成 0.9。
     两者都是在补偿**重复计数**，不是真实几何量：
       subject.itemHeight() 已经含 TABLE_CHROME(=SUBJ_BOX_CHROME 5.0)
       + HEAD_H + 2×cellPad + ROW_OVERHEAD；
       而收口求 subjCH 时又把每个 itemHeight 加了一遍。
     实测（.ref/domchain.cjs，12 选择+2 题）：
       红框底应为 122.227+6.755+112.648 = 241.63，
       而 subjNaturalBottom = 122.228 + (52.105+51.205) = 225.538
       —— 正好少 16.09mm，红框比黑框矮一截，黑框整条溢出。
     归零后 subjCH = 51.2+51.2 = 102.4，自然底 = 122.228+102.4 = 224.63，
     与真实内容底（首题上缘到表格底 = 112.648 + 6.755 = 119.403）一致。 */

  /* 答题区加高 1mm，红框底只下移 0.75mm（device px 吸附）。
     只在「无闭环保底」时用来给个初值。 */
  var STRETCH_K = 1.3327;

  function usableH(p) {
    return r3(G.answerBottom(p, PAGE_H) - G.answerTop(p));
  }
  function frameChrome() { return r3(FRAME_PAD + TIP_GAP + TIP_H + TIP_GAP + FRAME_PAD); }
  function frameTopH() { return FRAME_PAD; }
  function frameBottomH() { return r3(TIP_GAP + TIP_H + TIP_GAP + FRAME_PAD); }
  function footReserve() { return frameBottomH(); }
  var FRAME_V = r3(frameTopH() + frameBottomH());

  /* ═══════════════════════════════════════════════════════════════════════
   * planBlocks —— 把用户输入摊成「块」序列
   * -----------------------------------------------------------------------
   * 选择题摊成**一块**（分页器自己按行切），非选择题一题一块。
   * 保留这个函数是为了不改变 app.js 的调用形状。
   * ═══════════════════════════════════════════════════════════════════════ */
  function planBlocks(o) {
    var p = o.preset || C.PRESETS.A4;
    var g = o.group || C.GROUPS.A4;
    var blocks = [];

    var total = Math.max(0, o.choiceTotal | 0);
    if (total > 0) {
      var faceW = o.faceW || C.PAPER.A4.w;
      var perLine = G.maxBlocksPerLine(p, faceW, g);
      /* 分块规则见 geometry.blockPlan：5 题一块，末块余 1 题并进前一块 */
      var bp = G.blockPlan(o.choiceStart, o.choiceStart + total - 1, g);
      var lineCount = Math.ceil(bp.length / perLine);
      blocks.push({
        kind: 'choice',
        startNo: o.choiceStart,
        total: total,
        totalLines: lineCount,
        rows: lineCount,
        /* ⚠ 每行有哪些题号**必须由 blockPlan 反查**，不能按「每行 5 题」推：
           末块可能是 2/3/4 题，余 1 题还会并进前一块。按固定 5 题推会在
           最后一行错位（题号跳号 / 重号）。
           这里预先存下每一行的起止题号，分页时直接取。 */
        lineRanges: (function () {
          var out = [];
          for (var li = 0; li < lineCount; li++) {
            var seg = bp.slice(li * perLine, (li + 1) * perLine);
            var f = seg[0].from;
            var l = seg[seg.length - 1].from + seg[seg.length - 1].count - 1;
            out.push({ from: f, to: l });
          }
          return out;
        })(),
        colH: G.columnHeight(p),
        lineGap: G.lineGapH(p),
        group: { size: g.size, perLine: perLine, gap: g.gap }
      });
    }

    (o.subjItems || []).forEach(function (it) {
      blocks.push({
        kind: 'subj',
        no: it.no,
        score: it.score,
        lines: it.lines,
        lineH: it.lineH,
        /* 一段非选择题的**行盒开销**（不含答案行本身）= itemHeight − lines×lineH
           = HEAD_H + 2×cellPad + ROW_OVERHEAD。分页器按 h + lines×lineH 算段高。 */
        h: Subject.headOverhead()
      });
    });

    return blocks;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * paginate —— 主循环
   * -----------------------------------------------------------------------
   * 输入
   *   o.blocks        planBlocks 的结果
   *   o.preset        版式预设
   *   o.chromeFirst   首页页眉底（mm）
   *   o.chromeOther   续排面页眉底（mm，现在是 0）
   * ═══════════════════════════════════════════════════════════════════════ */
  function paginate(o) {
    var p = o.preset || C.PRESETS.A4;
    var off = G.boxOffsets(p);

    var A_TOP = G.answerTop(p);
    var A_BOT = G.answerBottom(p, PAGE_H);
    var F_TOP = G.frameTopLimit(p);
    var F_BOT = G.frameBottomLimit(p, PAGE_H);
    var frameH = G.frameHeight(p, PAGE_H);

    var choice = null;
    var subj = [];
    o.blocks.forEach(function (b) {
      if (b.kind === 'choice') choice = b; else subj.push(b);
    });

    var faces = [];
    var choiceLine = 0;       // 已排出的选择行数
    var subjIdx = 0;
    /* 当前这一题还没排完的答案行数（>0 表示下一面是续排面）。
       跨面传递，所以必须放在面循环**外面**。 */
    var partialLines = 0;
    /* 「非选择题（提示：…）」栏目头全卡只印一次 */
    var subjHeadDone = false;
    var isFirst = true;
    var guard = 0;

    var lineH = choiceLineH(p);

    while ((choice && choiceLine < choice.totalLines) || subjIdx < subj.length) {
      if (guard++ > 400) break;

      /* 本面红框**上缘**：
           base = max(几何下限 F_TOP, 页眉底 + FRAME_TOP_GAP)
         首页页眉底 82.95 ⇒ 84.95；续排面页眉为空 ⇒ F_TOP。 */
      var base = !isFirst ? F_TOP
        : Math.max(F_TOP, r3((o.chromeFirst || 0) + FRAME_TOP_GAP));
      var cursor = base;
      var body = [];
      /* 本面已排的最后一块的 kind —— 决定两块之间要不要留版块间距 */
      var lastKind = null;
      var progressed = false;
      var rotated = false;      // 本面是否新开了一条「框」

      /* ── 选择题：按行往里塞 ────────────────────────────────────────── */
      /* 本面选择题第一行的**全局**行号。下面 push 时给出 face 内的**相对**
         行偏移（lineOffset），builder 拿它去 slice；两者用途不同，别混。
         ⚠ 踩过的坑：只传 `fromLine: choiceLine`（全局累计）给 builder，
           builder 却按「在本面这一片里从第几行开始」去 slice ——
           300 选择时第 2 面 `fromLine = 8`，而该面切片只有 7 行，
           slice(8, 15) 得到空数组 ⇒ **换页后的选择题区一片空白**
           （用户报的「换页后的选择题答题区不见了，只有一片白」）。 */
      var faceChoiceStart = choiceLine;
      if (choice && choiceLine < choice.totalLines) {
        var chromeTop = G.choiceChromeH(p);      // 红框顶 → 网格顶
        var footTop = G.choiceFootH(p);          // 网格底 → 红框底
        var gridRoom = r3(F_BOT - cursor - chromeTop - footTop - EPS_MM);
        /* n 行占高 = n×colH + (n−1)×lineGap = n×lineH − lineGap */
        var canFit = Math.floor((gridRoom + choice.lineGap) / lineH + 1e-9);
        if (canFit < 1) canFit = 1;
        var rows = Math.min(canFit, choice.totalLines - choiceLine);
        if (rows > 0) {
          var range = choice.lineRanges[choiceLine];
          body.push({
            kind: 'choice',
            /* 本面第一行的起题号 .. 最后一行的止题号（由 blockPlan 反查） */
            startNo: range.from,
            endNo: choice.lineRanges[choiceLine + rows - 1].to,
            total: choice.total,
            /* 首页的那条印「选择题 + 2B 提示 + 填涂示例」，
               续排面印「请在各题目的答题区域内作答…」（见 choice.header）。 */
            head: choiceLine === 0,
            rows: rows,
            /* 本面这一片里的相对行偏移（builder 的 slice 起点） */
            lineOffset: r3(0) + (choiceLine - faceChoiceStart),
            /* 全局累计行号，仅供调试/探针 */
            fromLine: choiceLine,
            group: choice.group,
            colH: choice.colH,
            lineGap: choice.lineGap,
            /* gridTop 与 boxTop 都用同一套 mm 口径，builder 自己作差 */
            boxTop: cursor,
            gridTop: r3(cursor + chromeTop)
          });
          choiceLine += rows;
          /* 选择红框**真实**高度 = gridTop（红框顶→网格顶）
                                    + 网格高（含行间空档）
                                    + footTop（网格底→红框底）
             ⚠ 别用 chromeTop + gridH + footTop 去近似 chromeTop：
               chromeTop 与 footTop 里各含一道黑框线，而 footTop 已经
               含了「网格底→红框底」的全部量，重复加会把游标多推 3.9mm
               （实测 300 选择：游标 284.846 而红框底只有 280.062）。 */
          var gridH = r3(rows * choice.colH +
                         Math.max(0, rows - 1) * choice.lineGap);
          cursor = r3(cursor + chromeTop + gridH + footTop);
          lastKind = 'choice';
          progressed = true;
          rotated = true;
        }
      }

      /* ── 非选择题：一题一块，可跨面切 ─────────────────────────────── */
      while (subjIdx < subj.length) {
        var it = subj[subjIdx];
        var isCont = partialLines > 0;
        var boxTopSeg = !rotated || lastKind !== 'subj';
        var subjHeadOnce = !subjHeadDone;

        if (rotated && lastKind === 'choice') {
          /* 选择题与非选择题之间留版块间距（用户报过这里没留） */
          cursor = r3(cursor + sectionGap());
        } else if (!rotated && body.length > 0) {
          cursor = r3(cursor + 0);
        }

        /* 段高 = 行盒开销 + 答案行 + 每段固定的块级推进量。
           baseH 里再加一次 SUBJ_BOX_CHROME 当且仅当这是本面第一段
           （表格顶从「红框顶 + 装饰」开始；后续段紧接上一段）。 */
        var baseH = r3(it.h + SUBJ_ITEM_PITCH +
                       (boxTopSeg ? SUBJ_BOX_CHROME : 0));
        var segLines = isCont ? partialLines : it.lines;

        var availH = r3(F_BOT - cursor - footReserve());
        var availLines = Math.floor((availH - baseH + it.lineH - 1e-6) / it.lineH);

        if (availLines < 1) {
          if (body.length === 0) {
            /* 本面连一行都放不下（理论上不会发生），强塞一行防死循环 */
            body.push({
              kind: 'subj', item: it, top: cursor, boxTop: cursor,
              first: boxTopSeg, cont: isCont, head: subjHeadOnce,
              lines: 1, h: subjSegH(it, baseH, 1), last: false
            });
            if (subjHeadOnce) subjHeadDone = true;
            partialLines = segLines - 1;
            cursor = r3(cursor + baseH + it.lineH);
            lastKind = 'subj';
            rotated = true;
            progressed = true;
          }
          break;
        }

        if (availLines >= segLines) {
          body.push({
            kind: 'subj', item: it, top: cursor, boxTop: cursor,
            first: boxTopSeg, cont: isCont, head: subjHeadOnce,
            lines: segLines, h: subjSegH(it, baseH, segLines),
            last: subjIdx === subj.length - 1
          });
          if (subjHeadOnce) subjHeadDone = true;
          cursor = r3(cursor + baseH + segLines * it.lineH);
          partialLines = 0;
          subjIdx++;
          lastKind = 'subj';
          rotated = true;
          progressed = true;
          continue;
        }

        /* 放不下 → 按页边界切开。切得太碎、换一面能放整段时整段挪走。 */
        var fitsNext = r3(baseH + segLines * it.lineH) <=
                       r3(F_BOT - F_TOP - footReserve());
        if (availLines < SPLIT_MIN_LINES && fitsNext && body.length > 0) break;

        body.push({
          kind: 'subj', item: it, top: cursor, boxTop: cursor,
          first: boxTopSeg, cont: isCont, head: subjHeadOnce,
          lines: availLines, h: subjSegH(it, baseH, availLines), last: false
        });
        if (subjHeadOnce) subjHeadDone = true;
        partialLines = segLines - availLines;
        cursor = r3(cursor + baseH + availLines * it.lineH);
        lastKind = 'subj';
        rotated = true;
        progressed = true;
        break;
      }

      if (!progressed) break;

      /* ── 收口 ────────────────────────────────────────────────────────
         红框下缘 = 红框固定下缘 F_BOT。
         判据用**未下拉**的红框底 = cursor + frameH（恒等式，不是估计）。 */
      var bottomLimit = F_BOT;
      var rest = r3(bottomLimit - cursor);
      if (rest < 0) rest = 0;

      /* 本面是不是**最后一面**（所有题都排完了）？
         用户口径：「**非最后一面**：≥15mm 画非答题区，<15mm 不画，
         但是要把红框的底部拉到要求的高度」。
         ⚠ 所以非最后一面**照样**按 15mm 判据，不是一律下拉 ——
           一律下拉会把「非选择题还没排完」的中继面也撑满，
           红框与黑框被强行拉长，看着像排版错了。 */
      var isLastFace = (subjIdx >= subj.length) &&
                       (!choice || choiceLine >= choice.totalLines);

      /* ── 剩余空白的去向（用户 2026 定稿）────────────────────────────
         用户：「现在整面都是非答题区的红框高度和位置非常好，就以这个为标准」。

         · 最后一面（正文已排完）且 rest ≥ NOANSWER_MIN_H(15mm)
             → 画**非答题区**，钉到 F_BOT。这就是用户认可的标准框：
               top = frameTopLimit、h = frameHeight（A4 264.848）。
         · 其余情况 → 不画。红框由 app.js 的 fitFrames() **量测**收口
           （黑框表格底 + 下内边距，夹在 F_BOT 内）。
         · `< 15mm` 时才用 `stretch` 把剩余空白拉进最后一段的作答区。 */

      var stretch = 0;
      var noAnswer = false;
      /* 只有最后一面收口时才可能画非答题区。
         ⚠ 非最后一面不画 —— 那些面正文还没排完，红框按内容自然收口，
           剩下的一面（凑偶面或最后一面）由非答题区整面铺满。 */
      if (isLastFace && rest >= NOANSWER_MIN_H) {
        noAnswer = true;
      } else if (isLastFace) {
        /* 最后一面但剩余 < 15mm：把这段空白拉进最后一段作答区
           （用户允许「答题区底部多一点空白」）。 */
        stretch = r3(rest * STRETCH_K);
      }

      /* 非选择题内容的**自然底** = 各段内容高之和 + 已定的下拉量。
         ⚠ 不能直接拿 F_BOT 当框底：框一旦被撑到比内容高，黑框表格会被
           一起撑高并溢出红框。 */
      var subjBoxTop = null;
      body.forEach(function (b) {
        if (b.kind === 'subj' && subjBoxTop === null) subjBoxTop = b.boxTop;
      });
      var subjNaturalBottom = null;
      if (subjBoxTop !== null) {
        /* 非选择题红框**内容底** = 首题上缘 + 各段段高之和 + 下拉量。
           ⚠ 这只是给分页器/探针的一个估计；真正的框高由 app.js 的
             fitFrames() **量测** DOM 后写死（见那里的注释）。 */
        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h + SUBJ_ITEM_PITCH);
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);
      }

      var naTop = null;
      var naH = 0;
      if (noAnswer) {
        var naFrom = (subjNaturalBottom === null)
          ? Math.min(cursor + frameH, F_BOT)
          : Math.min(subjNaturalBottom, F_BOT);
        naTop = r3(naFrom);
        naH = r3(F_BOT - naFrom);
      }

      faces.push({
        first: isFirst,
        blank: false,
        body: body,
        cursor: cursor,
        frameBot: bottomLimit,
        stretch: stretch,
        subjBoxBottom: subjNaturalBottom,
        rest: rest,
        noAnswer: noAnswer,
        noAnswerTop: naTop,
        noAnswerH: naH,
        usable: usableH(p),
        hasSubj: body.some(function (x) { return x.kind === 'subj'; })
      });

      isFirst = false;
    }

    /* 一题都没有的情况：至少给一面 */
    if (!faces.length) {
      faces.push({
        first: true, blank: false, body: [], cursor: F_TOP, frameBot: F_BOT,
        stretch: 0, subjBoxBottom: null, rest: r3(F_BOT - F_TOP - frameH),
        noAnswer: true, noAnswerTop: F_TOP, noAnswerH: frameH,
        usable: usableH(p), hasSubj: false
      });
    }

    lastDebug = {
      answerTop: A_TOP,
      answerBottom: A_BOT,
      frameTopLimit: F_TOP,
      frameBottomLimit: F_BOT,
      frameHeight: frameH,
      frameV: FRAME_V,
      noAnswerMinH: NOANSWER_MIN_H,
      faces: faces.map(function (f) {
        return {
          first: f.first,
          cursor: f.cursor,
          frameBot: f.frameBot,
          rest: f.rest,
          stretch: f.stretch,
          noAnswer: f.noAnswer,
          noAnswerTop: f.noAnswerTop,
          noAnswerH: f.noAnswerH,
          body: f.body.map(function (b) {
            return b.kind === 'choice'
              ? { kind: 'choice', boxTop: b.boxTop, rows: b.rows, gridTop: b.gridTop }
              : { kind: 'subj', no: b.item.no, top: b.top, h: b.h,
                  first: b.first, cont: b.cont, lines: b.lines };
          })
        };
      })
    };

    return faces;
  }

  var lastDebug = null;

  /** 供 app.js 在「凑偶数」补面之后同步调试快照（.ref 探针读它）。 */
  function noteFaces(faces) {
    if (!lastDebug || !faces) return;
    lastDebug.faces = faces.map(function (f) {
      return {
        first: f.first,
        blank: !!f.blank,
        cursor: f.cursor,
        frameBot: f.frameBot,
        rest: f.rest,
        stretch: f.stretch,
        noAnswer: f.noAnswer,
        noAnswerTop: f.noAnswerTop,
        noAnswerH: f.noAnswerH,
        body: (f.body || []).map(function (b) {
          return b.kind === 'choice'
            ? { kind: 'choice', boxTop: b.boxTop, rows: b.rows, gridTop: b.gridTop }
            : { kind: 'subj', no: b.item.no, top: b.top, h: b.h,
                first: b.first, cont: b.cont, lines: b.lines };
        })
      };
    });
  }

  global.AS.paginator = {
    PAGE_H: PAGE_H,
    FOOTER_H: FOOTER_H,
    FOOTER_PAD: FOOTER_PAD,
    FRAME_PAD: FRAME_PAD,
    TIP_H: TIP_H,
    TIP_GAP: TIP_GAP,
    FRAME_V: FRAME_V,
    NOANSWER_MIN_H: NOANSWER_MIN_H,
    NOANSWER_TEXT: NOANSWER_TEXT,
    SUBJ_CHROME: SUBJ_CHROME,
    SUBJ_BOX_CHROME: SUBJ_BOX_CHROME,
    SUBJ_ITEM_FIX: SUBJ_ITEM_FIX,
    SUBJ_ITEM_PITCH: SUBJ_ITEM_PITCH,
    STRETCH_K: STRETCH_K,
    SPLIT_MIN_LINES: SPLIT_MIN_LINES,
    FRAME_TOP_GAP: FRAME_TOP_GAP,
    BOTTOM_RESERVE: frameBottomH(),
    frameTopH: frameTopH,
    frameBottomH: frameBottomH,
    frameChrome: frameChrome,
    footReserve: footReserve,
    sectionGap: sectionGap,
    usableH: usableH,
    planBlocks: planBlocks,
    paginate: paginate,
    noteFaces: noteFaces,
    get lastDebug() { return lastDebug; }
  };
})(window);
