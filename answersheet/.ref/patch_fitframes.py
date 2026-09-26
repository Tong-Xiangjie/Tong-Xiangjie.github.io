import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# app.js —— 加 fitFrames()：渲染后闭环把最后一块红框底拉到目标下界
# ═══════════════════════════════════════════════════════════════════════
p = 'js/app.js'
s = rd(p)

old = """  /* ── 非答题区字号自适应 ───────────────────────────────────────────────"""
anchor = """  function fitNoAnswer() {"""
assert anchor in s, 'fitNoAnswer'

# 在 fitNoAnswer 之前插入 fitFrames
new_fns = """  /* ── 收口：把每面最后一块红框的下缘**闭环**拉到目标下界 ──────────────
     ⚠ 为什么必须闭环、不能靠公式预测：
       分页器的游标是纯 JS 算的，而红框底由 DOM 渲染决定。浏览器按
       device px（= 1/3.7795 mm = 0.2646mm）吸附每一行的盒高，量化误差随
       「本面题数/行数」变化。.ref/fit2.cjs 在 36 组配置上实测：
       「红框底 − 游标」在 −7.2 ~ +10.1mm 之间跳，取决于本面排了几行 ——
       任何线性式都拟合不出来（最大残差 12.8mm）。
       所以这里改成：先按分页器给的下拉量渲染一次，再**量**真实红框底，
       把差值补到最后一行答题区的高度上。实测「答题区加高 1mm → 红框底
       下移 0.75mm」（.ref/calib_stretch.cjs），所以补量要除以 0.75。

     目标下界 = 答题区下界 − 页脚块（页脚站在红框内底端）。
     只在「没有非答题区」的面做（有非答题区的面由它自己铺满）。 */
  var STRETCH_EFF = 0.75;      // 答题区加高 → 红框底下移 的实际比例

  function fitFrames() {
    var stage = $('stage');
    if (!stage) return;
    var paper = C.PAPER[readOptions().format] || C.PAPER.A4;
    var preset = C.PRESETS[readOptions().format] || C.PRESETS.A4;
    var bottomLimit = G.r3(G.answerBottom(preset, paper.h) - 5.0 - 0.5);
    var faces = stage.querySelectorAll('.as-page .as-face');
    var S = null;
    Array.prototype.forEach.call(faces, function (faceEl) {
      /* 本面已经画了非答题区 → 不用管 */
      if (faceEl.querySelector('.as-noanswer')) return;
      var outer = faceEl.querySelector('.as-subject-outer');
      if (!outer) return;
      var fb = faceEl.getBoundingClientRect();
      if (!S) S = fb.width / paper.w;              // px per mm
      var mm = function (v) { return v / S; };
      var cur = mm(outer.getBoundingClientRect().bottom - fb.top);
      var delta = bottomLimit - cur;
      if (Math.abs(delta) < 0.05) return;
      /* 找最后一行答题区，按补量加高 */
      var bodies = faceEl.querySelectorAll('.as-subj-body');
      if (!bodies.length) return;
      var last = bodies[bodies.length - 1];
      var add = delta / STRETCH_EFF;               // mm
      var curH = parseFloat(last.style.height) || mm(last.getBoundingClientRect().height);
      last.style.height = G.r3(curH + add) + 'mm';
    });
  }

  /* ── 非答题区字号自适应 ───────────────────────────────────────────────"""
s = s.replace("""  /* ── 非答题区字号自适应 ───────────────────────────────────────────────""",
              new_fns, 1)

# generate() 里在 fitNoAnswer 之后调 fitFrames（两遍都调，第二遍是最终态）
s = s.replace("""    applyThemeToStage();
    fitNoAnswer();""",
"""    applyThemeToStage();
    fitFrames();
    fitNoAnswer();""", 1)
s = s.replace("""      applyThemeToStage();
      fitNoAnswer();
    }""",
"""      applyThemeToStage();
      fitFrames();
      fitNoAnswer();
    }""", 1)

wr(p, s)
print('app.js fitFrames ok')
