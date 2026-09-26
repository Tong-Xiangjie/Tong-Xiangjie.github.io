import io, sys
sys.stdout.reconfigure(encoding='utf-8')

P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()

start = s.index('  /**\n   * 分页主循环。')
end = s.index('  /* 诊断：把最后一次分页的中间量留一份')

new = r'''  /**
   * 分页主循环 —— 「优先填满每一面」。
   *
   * ═══════════════════════════════════════════════════════════════════════
   * 纵向模型（全部由「答题区」反推，见 geometry.answerTop/answerBottom）
   * -----------------------------------------------------------------------
   *   答题区上界 = 上角标下边缘
   *   答题区下界 = 下角标上边缘
   *
   *   红框（选择题一个、非选择题一个）撑在答题区里；
   *   红框内自上而下：上提示 / 黑框(内容) / 下提示；
   *   页脚在**最后一块红框的内部底端**（用户选 (a)）。
   *
   * 取整口径统一为「红框外缘」：
   *   frameTop = cursor − frameTopH()      （红框上缘）
   *   frameBot = cursor + 内容高 + frameBottomH()
   *   body 的 top 一律 = cursor（黑框内容上缘）
   * 这样最后一块的 frameBot 直接与 answerBottom 比较即可。
   *
   * 「优先填满再换页」：
   *   ① 先按剩余高度贪心排满（选择行 / 非选择题行）；
   *   ② 排完后若还剩 ≥ NOANSWER_MIN_H，用**非答题区**吃掉；
   *   ③ 剩 < NOANSWER_MIN_H，交给最后一块红框往下拉（答题区留白），
   *      由 finally 统一把 frameBot 推到 answerBottom（或页脚上沿）。
   * ═══════════════════════════════════════════════════════════════════════
   */
  function paginate(o) {
    var p = o.preset;
    var A_TOP = G.answerTop(p);
    var A_BOT = G.answerBottom(p, PAGE_H);
    var choice = null, subj = [];
    o.blocks.forEach(function (b) {
      if (b.kind === 'choice') choice = b; else subj.push(b);
    });

    var faces = [];
    var choiceLine = 0;      // 已排出的选择行数
    var subjIdx = 0;
    /* 当前这一题还没排完的答案行数（>0 表示下一面是「续排面」）。
       跨面传递，所以必须放在面循环**外面**。 */
    var partialLines = 0;
    /* 「非选择题（提示：…）」栏目头是否已经印过。跨面**不复位** ——
       全卡只允许印一次（用户指定），所以它不能跟着 chromeOnFace 一起每面重置。 */
    var subjHeadDone = false;
    var isFirst = true;
    var guard = 0;

    while ((choice && choiceLine < choice.totalLines) || subjIdx < subj.length) {
      if (guard++ > 400) break;

      /* 本面红框起点的候选：
         · 首页 = 页眉底（chromeFirst），红框紧接页眉，不再加版块间距；
         · 续排面 = 答题区上界。
         取两者较大者 —— A3 各面 / 标题换行时都能自适应。 */
      var base = isFirst ? Math.max(A_TOP, o.chromeFirst || A_TOP)
                         : Math.max(A_TOP, o.chromeOther || A_TOP);
      var cursor = base;
      var body = [];
      /* 本面最后一个红框的「框体底部装饰」——finally 用它收口 */
      var lastFrameBottomH = null;
      /* 本面第一个块的框体**顶部**装饰（红框内边距 + 上提示）。
         首页选择题有栏目头，占高更大（见 builders/choice.js header）。 */
      var progressed = false;

      /* ① 选择题 -------------------------------------------------------- */
      if (choice && choiceLine < choice.totalLines) {
        /* 红框上缘 = cursor；内容（黑框里第一行题号）上缘 = cursor + chrome。
           ⚠ chrome 必须**每面全额**，与「本面是不是第一个选择行」无关：
             首页栏目头是「选择题 + 正确填涂示例」，续页是
             「请在各题目的答题区域内作答…」，两者占高相同
             （见 css .as-choice-header / .as-choice-header-no-example）。
             历史 bug：写成 `headH = choiceLine === 0 ? chrome : 0` 再拿它算
             contentTop，续页 contentTop 就等于 boxTop，黑框 margin-top 变成
             −10.583mm，黑框被顶到红框上沿之外。 */
        var chromeTop = choiceChromeH(p);            // 红框上缘 → 首行题号
        var footTop = G.choiceFootH(p);              // 末行底 → 红框下缘
        var EPS_MM = 0.02;                           // 吸收 colH 的 r3 取整漂移
        /* 本面能给选择网格的高度 */
        var gridRoom = r3(A_BOT - cursor - chromeTop - footTop - EPS_MM);
        /* n 行占高 = n×colH + (n−1)×lineGap = n×lineH − lineGap */
        var canFit = Math.floor((gridRoom + choice.lineGap) / choice.lineH);
        if (canFit >= 1) {
          var take = Math.min(canFit, choice.totalLines - choiceLine);
          var gridH = r3(take * choice.colH + (take - 1) * choice.lineGap);
          body.push({
            kind: 'choice',
            boxTop: cursor,
            contentTop: r3(cursor + chromeTop),
            gridTop: r3(cursor + chromeTop),
            head: choiceLine === 0,
            fromLine: choiceLine,
            rows: take,
            startNo: choice.startNo,
            total: choice.total,
            lineH: choice.lineH,
            lineGap: choice.lineGap,
            gridH: gridH,
            colH: choice.colH,
            group: choice.group
          });
          choiceLine += take;
          cursor = r3(cursor + chromeTop + gridH + footTop);
          lastFrameBottomH = frameBottomH();
          progressed = true;
        } else if (body.length === 0) {
          /* 一行都放不下（纸太矮 / 行太高）：硬放一行，防死循环 */
          var ct = r3(cursor + chromeTop);
          body.push({
            kind: 'choice', boxTop: cursor, contentTop: ct, gridTop: ct,
            head: choiceLine === 0, fromLine: choiceLine, rows: 1,
            startNo: choice.startNo, total: choice.total,
            lineH: choice.lineH, lineGap: choice.lineGap,
            gridH: choice.colH, colH: choice.colH, group: choice.group
          });
          choiceLine += 1;
          cursor = r3(ct + choice.colH + footTop);
          lastFrameBottomH = frameBottomH();
          progressed = true;
        }
      }

      /* ② 非选择题 ------------------------------------------------------ */
      if (!choice || choiceLine >= choice.totalLines) {
        while (subjIdx < subj.length) {
          var it = subj[subjIdx];
          var isCont = (partialLines > 0);
          var segLines = isCont ? partialLines : it.lines;
          var fixedH = r3(it.h - it.lines * it.lineH);
          /* 本面非选择题红框的框体装饰只加一次（第一段之前） */
          var boxTopSeg = (lastFrameBottomH === null);
          var subjHeadOnce = !subjHeadDone;
          var baseH = r3(fixedH + (boxTopSeg ? SUBJ_BOX_CHROME : 0));
          var fullH = r3(baseH + segLines * it.lineH);
          var availH = r3(A_BOT - cursor);
          var availLines = Math.floor((availH - baseH + it.lineH - 1e-6) / it.lineH);
          if (availLines < 1) {
            if (body.length === 0) {
              body.push({ kind: 'subj', item: it, top: cursor, boxTop: cursor,
                          first: boxTopSeg, cont: isCont, head: subjHeadOnce,
                          lines: 1, last: false });
              if (subjHeadOnce) subjHeadDone = true;
              partialLines = segLines - 1;
              cursor = r3(cursor + baseH + it.lineH);
              lastFrameBottomH = frameBottomH();
              progressed = true;
            }
            break;
          }
          if (availLines >= segLines) {
            body.push({ kind: 'subj', item: it, top: cursor, boxTop: cursor,
                        first: boxTopSeg, cont: isCont, head: subjHeadOnce,
                        lines: segLines, last: subjIdx === subj.length - 1 });
            if (subjHeadOnce) subjHeadDone = true;
            cursor = r3(cursor + fullH);
            lastFrameBottomH = frameBottomH();
            partialLines = 0;
            subjIdx++;
            progressed = true;
            continue;
          }
          /* 放不下 → 按页边界切开。切得太碎、换一面能放整段时整段挪走。 */
          var restLines = segLines - availLines;
          var fitsNext = r3(baseH + segLines * it.lineH) <= r3(A_BOT - A_TOP);
          if (availLines < SPLIT_MIN_LINES && fitsNext && body.length > 0) break;
          body.push({ kind: 'subj', item: it, top: cursor, boxTop: cursor,
                      first: boxTopSeg, cont: isCont, head: subjHeadOnce,
                      lines: availLines, last: false });
          if (subjHeadOnce) subjHeadDone = true;
          cursor = r3(cursor + baseH + availLines * it.lineH);
          lastFrameBottomH = frameBottomH();
          partialLines = restLines;
          progressed = true;
          break;
        }
      }

      if (!progressed) break;   // 保险：本面没有任何进展

      /* ③ 收口：剩余空白 ---------------------------------------------------
         目标下沿 = 答题区下界 − 页脚块（页脚在红框内底端）。
         · ≥ NOANSWER_MIN_H 且本面有内容 → 加「非答题区」，由它吃掉空白；
         · 否则把最后一块红框往下拉（答题区留白）。 */
      var bottomLimit = r3(A_BOT - FOOTER_H - FOOTER_PAD);
      var rest = r3(bottomLimit - cursor - lastFrameBottomH);
      var noAnswer = false;
      if (rest >= NOANSWER_MIN_H) {
        noAnswer = true;
      }
      var frameBot = noAnswer
        ? r3(cursor + rest + lastFrameBottomH)   // 非答题区撑到页脚上沿
        : r3(cursor + Math.max(0, rest) + lastFrameBottomH);

      faces.push({
        first: isFirst,
        body: body,
        cursor: cursor,
        frameBot: frameBot,
        noAnswer: noAnswer,
        noAnswerTop: noAnswer ? cursor : null,
        noAnswerH: noAnswer ? r3(frameBot - lastFrameBottomH - cursor) : 0,
        usable: usableH(p),
        hasSubj: body.some(function (x) { return x.kind === 'subj'; })
      });
      isFirst = false;
    }

    lastDebug = {
      answerTop: A_TOP,
      answerBottom: A_BOT,
      frameV: FRAME_V,
      noAnswerMinH: NOANSWER_MIN_H,
      items: subj.map(function (b) { return { no: b.no, h: b.h }; }),
      faces: faces.map(function (f) {
        return {
          first: f.first, cursor: f.cursor, frameBot: f.frameBot,
          noAnswer: f.noAnswer, noAnswerH: f.noAnswerH,
          body: f.body.map(function (x) {
            return x.kind === 'subj'
              ? { kind: 'subj', no: x.item.no, top: x.top, h: x.item.h,
                  first: x.first, cont: x.cont, lines: x.lines }
              : { kind: 'choice', boxTop: x.boxTop, rows: x.rows };
          })
        };
      })
    };
    return faces;
  }

'''

s = s[:start] + new + s[end:]

# 导出表更新
s = s.replace("""  global.AS.paginator = {
    PAGE_H: PAGE_H,
    BOTTOM_RESERVE: BOTTOM_RESERVE,
    SUBJ_CHROME: SUBJ_CHROME,
    SUBJ_BOX_CHROME: SUBJ_BOX_CHROME,
    SPLIT_MIN_LINES: SPLIT_MIN_LINES,""",
"""  global.AS.paginator = {
    PAGE_H: PAGE_H,
    FOOTER_H: FOOTER_H,
    FOOTER_PAD: FOOTER_PAD,
    FRAME_PAD: FRAME_PAD,
    TIP_H: TIP_H,
    TIP_GAP: TIP_GAP,
    FRAME_V: FRAME_V,
    NOANSWER_MIN_H: NOANSWER_MIN_H,
    NOANSWER_TEXT: NOANSWER_TEXT,
    frameTopH: frameTopH,
    frameBottomH: frameBottomH,
    frameChrome: frameChrome,
    usableH: usableH,
    SUBJ_CHROME: SUBJ_CHROME,
    SUBJ_BOX_CHROME: SUBJ_BOX_CHROME,
    SPLIT_MIN_LINES: SPLIT_MIN_LINES,""")

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginate replaced; file lines =', s.count('\n') + 1)
