import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/paginator.js'
s = io.open(p, encoding='utf-8').read()

# ── 1) 移除临时调试插桩 ──────────────────────────────────────────────
dbg = """          /* 调试：本面容量推导 */
          (function () {
            if (!global.__PAGER_TRACE) global.__PAGER_TRACE = [];
            global.__PAGER_TRACE.push({
              faceIdx: faces.length, choiceLine: choiceLine, boxTop: boxTop,
              usable: usable, headH: headH, room: room,
              lineH: choice.lineH, lineGap: choice.lineGap,
              canFit: canFit, take: take, totalLines: choice.totalLines
            });
          })();
"""
assert dbg in s, 'debug block not found'
s = s.replace(dbg, '', 1)

# ── 2) 重写容量推导 ──────────────────────────────────────────────────
old = """        var room = usable - cursor - headH;
        /* n 行占高 = n×列高 + (n−1)×行间空档 = n×lineH − lineGap
           → 能放下的行数 = floor((room + lineGap) / lineH) */
        var canFit = Math.floor((room + choice.lineGap) / choice.lineH);"""
new = """        /* ── 本面能放几行 ─────────────────────────────────────────────
           本面红框的**总高**（红框上缘 → 红框下缘）必须 ≤ usable − cursor：
             红框高 = choiceChromeH + 网格高 + choiceFootH
             网格高 = n × colH + (n − 1) × lineGap
                    = n × lineH − lineGap
           ⇒ n ≤ (usable − cursor − choiceChromeH − choiceFootH + lineGap) / lineH

           ⚠⚠ 两个必须减掉的项，历史上都漏过：
             ① **choiceFootH**：红框下沿的框体装饰（黑框下内边距 + 两道线 +
                红框下内边距 = 4.22）。只减 choiceChromeH 会让每面红框比
                可用高度**高出 4.22mm**，非选择题被顶到页脚上。
             ② **cursor 之外的 boxTop 就是 cursor**，不要再减一次 headH ——
                headH 只是「本面要不要在框内留栏目头」的容量提示，
                而 choiceChromeH **已经包含** headerH + headerGap，
                两者一起减等于把栏目头减了两遍（多减 10.6）。

           ⚠ 还要减一个极小量 ε：colH 是 r3 取整后的值，累乘 n 行会有
             零点几毫米的取整漂移（A3 11 行：11×20.359 = 223.949，
             真实 11×20.3595 = 223.9545）。不扣掉这个漂移，
             边界上会多放一行，红框刚好压过页脚。

           lineH 已含 lineGap（n×lineH − lineGap = 网格高），
           所以「可用净高 + lineGap」再除以 lineH 即行数。 */
        var EPS_MM = 0.02;
        var usableForRows = r3(usable - cursor - choiceChromeH(p) -
                               G.choiceFootH(p) - EPS_MM);
        /* n 行占高 = n×列高 + (n−1)×行间空档 = n×lineH − lineGap
           → 能放下的行数 = floor((可用净高 + lineGap) / lineH) */
        var canFit = Math.floor((usableForRows + choice.lineGap) / choice.lineH);"""
assert old in s, 'canFit block not found'
s = s.replace(old, new, 1)

# headH 仍然用于「本面是否已有栏目头」之外的地方？检查并保留定义但改注释
old2 = """        var headH = (choiceLine === 0) ? choiceChromeH(p) : 0;
        if (body.length === 0) cursor = r3(cursor + sectionGap());"""
new2 = """        /* headH 仅用于历史语义（本面第一个选择行是否带栏目头），
           容量计算已改用 choiceChromeH(p)（见下面 usableForRows 的说明），
           这里保留变量以便与 lastDebug / 断言对照。 */
        var headH = (choiceLine === 0) ? choiceChromeH(p) : 0;
        void headH;
        if (body.length === 0) cursor = r3(cursor + sectionGap());"""
assert old2 in s, 'headH block not found'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
