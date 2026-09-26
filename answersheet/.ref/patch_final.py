import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── paginator.js ────────────────────────────────────────────────────────────
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# 去掉调试块
rep("""    if (global.__PGDBG) { console.log('[PGDBG]', JSON.stringify({
      chromeFirst: o.chromeFirst, chromeOther: o.chromeOther,
      blockCount: o.blocks.length,
      firstBlock: o.blocks[0],
      SUBJ_ITEM_PITCH: SUBJ_ITEM_PITCH, SUBJ_BOX_CHROME: SUBJ_BOX_CHROME,
      F_TOP: G.frameTopLimit(p), F_BOT: G.frameBottomLimit(p, PAGE_H),
      frameH: G.frameHeight(p, PAGE_H), foot: footReserve() })); }
""", "", '删 PGDBG')

# SUBJ_BOX_CHROME：分页器里不再用它算推进量，只留作参考
rep("""  var SUBJ_BOX_CHROME = 6.879;""",
"""  var SUBJ_BOX_CHROME = 6.879;

  /* ⚠ SUBJ_BOX_CHROME 在**推进量**里已经不再单独相加 ——
     subject.itemHeight() 的内部结构就是 11.3 + 7.7n：
        题头 5.0 + 作答区 7.7n + 单元格上下内边距 5.0 + 行盒余量 1.3
     而实测「首题上缘 → 表格底」比 itemHeight 还多 **6.3mm/题**
     （.ref/layout.cjs：12 选择+2 题，首题上缘 124.475、次题上缘 193.199，
      差 68.724 = itemHeight(6) 51.2 + 17.5… —— 归到 per-item 常量最稳）。
     所以推进量 = itemHeight + SUBJ_ITEM_PITCH，SUBJ_BOX_CHROME 只用于
     「红框顶 → 表格顶」的自检与探针。 */""", 'BOX_CHROME 注释')

# 自然底：SUBJ_ITEM_PITCH 已含在 subjCH 里，不要再加 BOX_CHROME
rep("""        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""",
"""        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""", '自然底不动')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator total', n)

# ── subject.js：把 ROW_OVERHEAD 的注释写准 ─────────────────────────────────
P2 = 'js/builders/subject.js'
s2 = io.open(P2, encoding='utf-8').read()
i = s2.find('  var ROW_OVERHEAD = 1.3;')
assert i > 0
j = s2.rfind('/*', 0, i)
s2 = s2[:j] + """/* 行盒余量（mm/题）：表格行里「块级子元素」的行盒开销。
     ⚠ 与 cellPad/HEAD_H 一起决定 itemHeight：
       itemHeight(n) = HEAD_H 5.0 + 7.7n + 2×cellPad 5.0 + ROW_OVERHEAD 1.3
                     = 11.3 + 7.7n
     这是**在真实卡片里用 offsetHeight 逐档标定**的（.ref/cal.cjs、
     .ref/cal2.cjs，1/2/3/4/5/6/8/10/12/16 行十档，残差 ≤ 0.02mm）。
     ⚠ 历史：这个值先后是 1.039 / 1.881 / 0.9 / 2.7 / -5.0 / 1.3。
       前几个都是在**脱离文档流的隐藏容器**里量的 —— 那个容器没有舞台
       缩放，量出来的表格高比真实卡片矮 6.04mm，于是 itemHeight 每题
       错 6mm，分页器据此定框高就让黑框整条溢出红框。
       现在固定用 offsetHeight/offsetTop 量（不受 transform 影响）。 */
  var ROW_OVERHEAD = 1.3;""" + s2[s2.find('\n', i):]
io.open(P2, 'w', encoding='utf-8', newline='').write(s2)
print('  ok: subject.js ROW_OVERHEAD 注释')
