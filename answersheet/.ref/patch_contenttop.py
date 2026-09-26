import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/paginator.js'
s = io.open(p, encoding='utf-8').read()

old = """        var headH = (choiceLine === 0) ? choiceChromeH(p) : 0;
        if (body.length === 0) cursor = r3(cursor + sectionGap());
        var room = usable - cursor - headH;
        /* n 行占高 = n×列高 + (n−1)×行间空档 = n×lineH − lineGap
           → 能放下的行数 = floor((room + lineGap) / lineH) */
        var canFit = Math.floor((room + choice.lineGap) / choice.lineH);
        if (canFit >= 1) {
          var take = Math.min(canFit, choice.totalLines - choiceLine);
          // boxTop = 红框上缘；contentTop = 第一行内容（题号行）上缘
          var boxTop = cursor;
          var contentTop = r3(cursor + headH);"""
new = """        /* ⚠ `headH` 只用来算「还能放几行」，**不能**用来算 contentTop。
           栏目头在**每一面**都占文档流里的 6mm（headerH + headerGap）：
           首页是「选择题 + 正确填涂示例」，续页是「请在各题目的答题区域内
           作答…」，两者高度完全一样（see builders/choice.js header() 与
           css .as-choice-header / .as-choice-header-no-example）。
           红框外的框体装饰 `choiceChromeH` 因此**每面都是全额**，
           与 headH 是不是 0 无关。

           ⚠⚠ 曾经的 bug（**只有选择题换页才显形**）：
             写成 `headH = choiceLine === 0 ? choiceChromeH(p) : 0`
             再 `contentTop = cursor + headH`，续页 contentTop 就等于
             boxTop。builder 拿到 `gridTop = contentTop − boxTop = 0`，
             于是反推黑框 margin-top = 0 − choiceChromeH = −10.583mm，
             黑框被顶到红框**上沿之上** —— 实测续页黑框顶 324.5 < 红框顶
             327.8，红框内「黑框外缘下 → 红框内缘」变成 −7.585mm（应为 +1）。
             一页放得下时所有面都是 choiceLine === 0，永远走不到错误分支。 */
        var headH = (choiceLine === 0) ? choiceChromeH(p) : 0;
        if (body.length === 0) cursor = r3(cursor + sectionGap());
        /* 本面红框上方**不需要**再为栏目头留额外空间：headH 只在首页非零，
           正是因为续页的栏目头是「框体装饰的一部分」，它撑起的是整个红框，
           而红框高度由 boxTop..cursor 的差值自然决定（见下面的 gridH/游标）。
           容量计算用 headH，位置计算一律用 choiceChromeH(p)。 */
        var room = usable - cursor - headH;
        /* n 行占高 = n×列高 + (n−1)×行间空档 = n×lineH − lineGap
           → 能放下的行数 = floor((room + lineGap) / lineH) */
        var canFit = Math.floor((room + choice.lineGap) / choice.lineH);
        if (canFit >= 1) {
          var take = Math.min(canFit, choice.totalLines - choiceLine);
          /* boxTop = 红框上缘；contentTop = 本面网格（第一行题号）上缘。
             contentTop 恒为 boxTop + choiceChromeH(p) —— 栏目头每面都在，
             与 headH 无关（见上面的 ⚠⚠）。 */
          var boxTop = cursor;
          var contentTop = r3(cursor + choiceChromeH(p));"""
assert old in s, 'contentTop block not found'
s = s.replace(old, new, 1)

# 同样修掉那个「后续页强制放一行」的分支
old2 = """          // 后续页仍放不下一行：说明行高超过整面，强制放一行防死循环
          var ct = r3(cursor + headH);"""
new2 = """          // 后续页仍放不下一行：说明行高超过整面，强制放一行防死循环
          // ⚠ 同上面的 ⚠⚠：位置一律用 choiceChromeH(p)，不要用 headH
          var ct = r3(cursor + choiceChromeH(p));"""
assert old2 in s, 'forced-row block not found'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
