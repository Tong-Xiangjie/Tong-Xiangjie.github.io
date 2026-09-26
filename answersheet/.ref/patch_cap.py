import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① SUBJ_BOX_CHROME 改成真实「红框顶 → 黑框顶」的实测值
rep("""  /* 黑框（表格）上方的固定装饰 = 上提示 + 净空（栏目头另算） */
  var SUBJ_BOX_CHROME = r3(TIP_GAP + TIP_H + TIP_GAP);""",
"""  /* 黑框（表格）上方的固定装饰 = 「红框顶 → 黑框顶」的实测距离。
     ⚠ 不是 TIP_GAP+TIP_H+TIP_GAP = 5.0 —— 那是**内容**口径。
       真实渲染（.ref/layout.cjs，offsetTop 差）恒为 **6.879**：
         红框上边框 0.265 + 上内边距 0.5 + 上提示块 3.998 起 + 下净空 …
       两边不一致，分页器算的「容量」就会比真实多出 1.879mm/题，
       最后一块会顶穿红框（实测 20 选择+4 题黑框 301 > 红框 280.924）。 */
  var SUBJ_BOX_CHROME = 6.879;""", 'SUBJ_BOX_CHROME = 6.879')

# ② SUBJ_ITEM_FIX 归零（itemHeight 已经含全部框体，不能再补）
rep("""  var SUBJ_ITEM_FIX = 0;""", """  var SUBJ_ITEM_FIX = 0;""", 'SUBJ_ITEM_FIX 已为 0')

# ③ subjSegH 不再叠加 SUBJ_BOX_CHROME —— itemHeight 已经是整段高
rep("""        var baseH = r3(SUBJ_BOX_CHROME + (boxTopSeg ? SUBJ_ITEM_FIX : 0));""",
"""        /* 本段占高：itemHeight 已经是「题头 + 作答区 + 上下内边距 + 表格余量」
           的**整段**高（含表格自己的边框），所以这里就是它本身，不再加
           SUBJ_BOX_CHROME（那会重复计数 6.879mm/段）。 */
        var baseH = r3(it.h);""", 'baseH = it.h')

# ④ 收口求自然底：subjCH 只累加各项 itemHeight，红框底由 fitFrames 量测
rep("""      var subjNaturalBottom = null;
      if (subjBoxTop !== null) {
        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h);
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);
      }""",
"""      var subjNaturalBottom = null;
      if (subjBoxTop !== null) {
        /* 非选择题红框**内容底** = 首题上缘 + 各段段高之和 + 下拉量。
           ⚠ 这只是给分页器/探针的一个估计；真正的框高由 app.js 的
             fitFrames() **量测** DOM 后写死（见那里的注释）。 */
        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h);
        });
        subjNaturalBottom = r3(subjBoxTop + SUBJ_BOX_CHROME + subjCH + stretch);
      }""", '自然底含 SUBJ_BOX_CHROME')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
