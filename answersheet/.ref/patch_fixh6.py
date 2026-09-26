import io, sys
sys.stdout.reconfigure(encoding='utf-8')
n = 0

# ① SUBJ_ITEM_FIX 修正（实测每行底比模型矮 0.9mm，不是 1.881）
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
def rep(path, old, new, tag):
    global n
    t = io.open(path, encoding='utf-8').read()
    assert old in t, tag
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(old, new, 1))
    n += 1
    print('  ok:', tag)

rep(P, "  var SUBJ_ITEM_FIX = 1.881;",
"""  var SUBJ_ITEM_FIX = 0.9;
  /* ⚠ 2026 重测修正：1.881 是在「红框随内容长」时代反查出来的，
     里面混进了框自身的取整误差。红框改成定高后重测
     （.ref/subjh.cjs，3 题 × 4/6/8/10/12/16 行）：

       n    模型预测一题   实测第一题
       4       41.840        40.792
       6       57.240        56.192
       8       72.650        71.600
      10       88.050        87.000
      12      103.450       102.404
      16      134.250       133.203

     斜率一致（每行 7.7，说明 lineH 对），**常数项**实测比模型矮 1.048，
     减去 ROW_OVERHEAD 1.039 里已经对的部分，取 0.9。
     原来偏大 0.98mm/题 × 2~3 题 = 少算 2~3mm 容量，正是「非选择题还没排完
     就换页」和「红框底短一截」的共同来源。 */""", 'SUBJ_ITEM_FIX')

io.open(P, 'w', encoding='utf-8', newline='').write(
    io.open(P, encoding='utf-8').read())

# ② fitFrames：不要对「有非答题区」的面再动框高（否则与第③条互撞）
rep('js/app.js',
"""        var boxes = faceEl.querySelectorAll('.as-subject-outer, .as-noanswer');
        if (!boxes.length) return;
        /* 只校最后一条框（本面最下面那条）—— 它才是决定本面红框底的那个。
           选择题框在上面，它的底由下面那条框的顶决定，不要单独动。 */
        var el = boxes[boxes.length - 1];
        var cur = mm(el.getBoundingClientRect().bottom - fb.top);
        var delta = bottomLimit - cur;
        if (Math.abs(delta) <= 0.08) return;
        var h = parseFloat(el.style.height);
        if (!(h > 0)) return;              // 没有定高就不碰（交给内容撑）
        el.style.height = G.r3(h + delta) + 'mm';
        moved = true;""",
"""        /* 非选择题红框：它必须钉在「内容自然底」上 —— 分页器已经把这个
           高度算给了 .as-subject-outer，这里只把 device px 取整的残差抹掉。
           ⚠ 不能把它拉到 bottomLimit：那会把它下面本该给非答题区的空间吞掉
             （用户要求剩余 ≥15mm 时必须画非答题区）。 */
        var outer = faceEl.querySelector('.as-subject-outer');
        var na = faceEl.querySelector('.as-noanswer');
        var el = na || outer;
        if (!el) return;
        var target = na ? bottomLimit
                        : mm(outer.getBoundingClientRect().bottom - fb.top);
        var cur = mm(el.getBoundingClientRect().bottom - fb.top);
        var delta = target - cur;
        if (Math.abs(delta) <= 0.08) return;
        var h = parseFloat(el.style.height);
        if (!(h > 0)) return;              // 没有定高就不碰（交给内容撑）
        el.style.height = G.r3(h + delta) + 'mm';
        moved = true;""", 'fitFrames 分流')

print('total', n)
