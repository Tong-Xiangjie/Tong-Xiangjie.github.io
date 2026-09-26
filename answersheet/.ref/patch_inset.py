import io, sys
sys.stdout.reconfigure(encoding='utf-8')
n = 0
def rep(path, old, new, tag):
    global n
    s = io.open(path, encoding='utf-8').read()
    assert old in s, tag + ' :: ' + path
    io.open(path, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
    n += 1
    print('  ok:', tag)

# ═══ geometry.js：外扩 → 内缩，并加 frameHeight 常量 ═══════════════════
rep('js/geometry.js',
"""  var FRAME_EXTEND_K = 0.7;
  function frameExtend(preset) {
    var p = preset || PRESETS.A4;
    return r3(FRAME_EXTEND_K * p.cornerH);
  }
  /** 红框上缘能达到的最高位置 */
  function frameTopLimit(preset) {
    return r3(answerTop(preset) - frameExtend(preset));
  }
  /** 红框下缘能达到的最低位置 */
  function frameBottomLimit(preset, paperH) {
    return r3(answerBottom(preset, paperH) + frameExtend(preset));
  }""",
"""  /* 红框相对答题区的内缩量 —— 用户 2026 最终口径：
     「上面往下 0.7（个定位点高度），下面往上 0.7」。
     方向是**内缩**（历史上一度写成外扩，方向反了）。
     A4: cornerH = 4.23 → 0.7 × 4.23 = 2.961mm。

     ⚠ 高度必须**写死**（见 frameHeight），不要用
       「页眉底 − frameExtend」之类的相对式 —— 那样红框高度会跟着页眉
       （标题换行、科目字数）漂移，用户要的是固定高度。 */
  var FRAME_INSET_K = 0.7;
  function frameExtend(preset) {
    var p = preset || PRESETS.A4;
    return r3(FRAME_INSET_K * p.cornerH);
  }
  /** 红框上缘（= 答题区上界 + 内缩） */
  function frameTopLimit(preset) {
    return r3(answerTop(preset) + frameExtend(preset));
  }
  /** 红框下缘（= 答题区下界 − 内缩） */
  function frameBottomLimit(preset, paperH) {
    return r3(answerBottom(preset, paperH) - frameExtend(preset));
  }
  /** 红框高度 —— **常量**，与页眉、题量都无关。
      用户 2026：「你不如把这个高度写死了」。
      A4 = (283.885 − 13.115) − 2 × 2.961 = 270.77 − 5.922 = 264.848 */
  function frameHeight(preset, paperH) {
    return r3(answerBottom(preset, paperH) - answerTop(preset) -
              2 * frameExtend(preset));
  }""", 'geometry 内缩')

rep('js/geometry.js',
"""    frameExtend: frameExtend,
    frameTopLimit: frameTopLimit,
    frameBottomLimit: frameBottomLimit,""",
"""    frameExtend: frameExtend,
    frameTopLimit: frameTopLimit,
    frameBottomLimit: frameBottomLimit,
    frameHeight: frameHeight,
    FRAME_INSET_K: FRAME_INSET_K,""", 'geometry 导出')

# ═══ paginator.js：首页红框起点 = frameTopLimit（写死，不看页眉） ═════
rep('js/paginator.js',
"""      /* 本面红框起点的候选。
         ⚠ 用户 2026 明确：红框**上缘要能往上拉** 0.7 个定位点高
           （= frameTopLimit，A4 = 10.154），下缘往下拉 0.7 个
           （= frameBottomLimit，A4 = 286.846）。

         ⚠ 历史 bug（用户报「红框整体又往下偏了，你是不是固定了红框上方
           距离纸张的高度」）：这里原来写的是
               isFirst ? Math.max(A_TOP, o.chromeFirst || A_TOP) : …
           那个 `Math.max(A_TOP, …)` 把首页红框上缘**钉死在答题区上界**
           （A4 = 13.115），于是「往上拉」这一半根本没生效 ——
           上缘一动不动，只有下缘被拉下去，整个框看着就是整体下移。

         正确起点：
           · 首页：页眉（标题/信息/注意事项）底 = chromeFirst，再上提
             frameExtend（0.7 个定位点高）
           · 续排面：没有整块页眉，直接从红框上限 F_TOP 起
         外层 max(F_TOP, …) 保证不会越过红框上限、压到角落定位点。 */
      var lift = G.frameExtend(p);
      var base = isFirst
        ? Math.max(F_TOP, r3((o.chromeFirst || A_TOP) - lift))
        : F_TOP;""",
"""      /* 本面红框起点 = **常量** F_TOP（= 答题区上界 + 0.7 个定位点高）。
         ⚠ 用户 2026 最终口径：「上面往下 0.7，下面往上 0.7」，
           而且「你不如把这个高度写死了」。
           所以起点**只看几何常量**，不看页眉底、不看题量 ——
           红框高度恒为 G.frameHeight(p, PAGE_H) = 264.848mm。

         ⚠ 两段历史 bug：
           ① 最初写 `Math.max(A_TOP, o.chromeFirst || A_TOP)`，
              上缘钉死在 A_TOP（13.115），"往下/往上调"整段失效；
           ② 后来改成 `chromeFirst − frameExtend`（从页眉往下量），
              于是红框高度跟着页眉漂 —— 标题换行就变高。
           两版都错在「红框位置由页眉决定」。现在由常量决定。 */
      var base = F_TOP;""", 'paginator 起点写死')

io.open('js/geometry.js', 'a', encoding='utf-8')  # no-op keep handle
print('total', n)
