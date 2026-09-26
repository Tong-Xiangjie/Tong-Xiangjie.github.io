import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()

# 常量：把「底部装饰」与「顶部装饰」分清
old = """  /** 红框**上**部装饰 = 上内边距 + 上提示 + 净空 */
  function frameTopH() { return r3(FRAME_PAD + TIP_GAP + TIP_H + TIP_GAP); }
  /** 红框**下**部装饰 = 净空 + 下提示 + 内边距 */
  function frameBottomH() { return r3(TIP_GAP + TIP_H + TIP_GAP + FRAME_PAD); }"""
new = """  /** 红框**上**部装饰 = 上内边距（红框内缘 → 栏头/上提示）。
   *  ⚠ 只算 padY。栏目头 / 上提示本身占的高度由内容高度带出来
   *    （SUBJ_BOX_CHROME 里的 headerH 等），**不要在这里重复加** ——
   *    加了就会把红框算高一整份 headerH（实测多 6mm）。 */
  function frameTopH() { return FRAME_PAD; }
  /** 红框**下**部装饰 = 净空 + 下提示 + 内边距。
   *  这段恒在最后一行之后，与「本面是第几段」无关 —— 
   *  所以容量计算里**每一面都要预留整份**。 */
  function frameBottomH() { return r3(TIP_GAP + TIP_H + TIP_GAP + FRAME_PAD); }"""
assert old in s
s = s.replace(old, new, 1)

# 选择题容量：chromeTop 已含 padY（boxOffsets.outerPadY），底部余同
# —— 现在 frameBottomH 与 choiceFootH 的关系要重新算清楚
old_g = """        /* 本面能给选择网格的高度。
           ⚠ 底部必须预留：本框的 footTop（末行→红框下缘）+ footReserve()
             （红框下部装饰 + 页脚）。漏掉 footReserve 会让红框压到页脚上。 */
        var gridRoom = r3(A_BOT - cursor - chromeTop - footTop - footReserve() - EPS_MM);"""
new_g = """        /* 本面能给选择网格的高度。
           结构（自上而下，全部相对红框上缘 cursor）：
             chromeTop  = 红框内边距 + 栏目头 + 净空 + 黑框线 + 黑框上内距 → 首行题号
                          （= geometry.choiceChromeH，已含红框上内边距）
             gridH      = n 行网格
             footTop    = 黑框下内距 + 黑框线 + 红框下内距（= geometry.choiceFootH）
             红框下缘 → 答题区下界 = 页脚块（FOOTER_H + FOOTER_PAD）
           ⚠ choice 的红框底部**没有**页内提示，所以用 choiceFootH 而不是
             frameBottomH。漏掉页脚块会让红框压到页脚上。 */
        var gridRoom = r3(A_BOT - cursor - chromeTop - footTop -
                          FOOTER_H - FOOTER_PAD - EPS_MM);"""
assert old_g in s
s = s.replace(old_g, new_g, 1)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('ok')
