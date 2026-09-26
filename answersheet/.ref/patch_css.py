import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')

p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

# ── 1a) 第一条 tip 规则：净空改由 --subj-tip-gap 给 ──────────────────
old_a = """     ⚠ 上下外边距都是 0：语句与黑框之间的净空由**红框的上/下内边距**给，
       与栏目头、黑框的间距口径一致，也不再和容器的 padding 叠加double。
       两种位置（黑框上 / 黑框下）的总占高因此都是 padY + tipH + tipGap。 */
  height: var(--subj-tip-h, 4mm);
  line-height: var(--subj-tip-h, 4mm);
  margin: 0;
  box-sizing: border-box;
}"""
new_a = """     ⚠ 净空**只由下面这一个 margin 给**（theme.js 从 paginator.TIP_GAP
       写 --subj-tip-gap = 0.5mm），不要再和容器的 padding 叠加。 */
  height: var(--subj-tip-h, 4mm);
  line-height: var(--subj-tip-h, 4mm);
  /* 用户要求「这句话贴近黑框和红框的上下界，上下不要留那么多空」。
     参照件实测「提示 → 黑框外缘」= 1.36mm，本站旧值 1.996mm。 */
  margin: var(--subj-tip-gap, 0.5mm) 0;
  box-sizing: border-box;
}"""
assert old_a in s, 'tip rule A not found'
s = s.replace(old_a, new_a, 1)

# ── 1b) 第二条重复的 tip 规则（在页脚之前）：整段删掉 ────────────────
dup = """.as-subject-page-tip {
  text-align: center;
  font-family: var(--font-sun);
  font-size: var(--fs-answerScore);
  color: var(--accent);
  margin: 2mm 0;
}

"""
assert dup in s, 'duplicate tip rule not found'
s = s.replace(dup, """/* ⚠ 这里原本还有一条重复的 .as-subject-page-tip（pageTip 字号 + margin 2mm），
   它把上一条的 margin 覆盖成 2mm，与容器的 padding 叠加成 2.5mm ——
   正是用户说的「留空比较多」。已删除，净空统一由 --subj-tip-gap 给。 */

""", 1)

# ── 2) 追加非答题区 CSS ────────────────────────────────────────────────
na = """

/* ═══════════════════════════════════════════════════════════════════════
 * 非答题区「考生请不要在此区域作答」
 * -----------------------------------------------------------------------
 * 吃掉一面排完正文后剩下的空白，避免出现「没有名目的空档」。
 * 高度由分页器算好、内联写死在元素上（不走 CSS 流 —— 与全卡其它纵向
 * 元素一样，「对齐由构造保证」）。
 * 字号 / 横竖排由 app.js 的 fitNoAnswer() 在 DOM 落地后按框的
 * clientWidth/clientHeight 实测再定（见 builders/noanswer.js）。
 * ═══════════════════════════════════════════════════════════════════════ */
.as-noanswer {
  position: absolute;
  left: var(--outer-left);
  right: var(--outer-left);
  /* 红框皮肤与选择题/非选择题红框一致：同色、同线宽、同圆角 */
  border: var(--na-border, 0.3mm) solid var(--accent);
  border-radius: var(--na-radius, 3mm);
  background: #fff;
  box-sizing: border-box;
  padding: var(--na-pad, 2mm);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  z-index: 1;
}

.as-noanswer-text {
  font-family: var(--font-hei);
  color: var(--accent);
  text-align: center;
  line-height: 1.15;
  word-break: keep-all;
  /* 字号与书写方向由 JS 内联覆盖 */
}
"""
s = s.rstrip() + na
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('card.css ok;  .as-noanswer 出现', s.count('.as-noanswer'))
