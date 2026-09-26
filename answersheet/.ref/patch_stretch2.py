import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# app.js —— face.stretch 交给本面**最后一行非选择题的答题区**
# ═══════════════════════════════════════════════════════════════════════
p = 'js/app.js'
s = rd(p)

# 1) renderFaceBody：算出 stretch / 最后一块，不用 padding 方案
old = """  function renderFaceBody(face, preset) {
    var html = '';
    var subjItems = face.body.filter(function (b) { return b.kind === 'subj'; });
    face.body.forEach(function (b) {
      if (b.kind === 'choice') {
        // 红框整体（含栏目头）定位到 boxTop；网格各行由框内 padding 自然推到位，
        // 其 y 与 geometry 算出的行心一致（padding 由 boxOffsets 反推保证）。
        html += '<div class="as-choice-section" style="top:' + b.boxTop + 'mm">' +
                renderChoiceBlock(b) +
                '</div>';
      }
    });"""
new = """  function renderFaceBody(face, preset) {
    var html = '';
    var subjItems = face.body.filter(function (b) { return b.kind === 'subj'; });
    /* 收口下拉（用户指定）：
       剩余空白 < NOANSWER_MIN_H(15mm) 时，把**最后一道非选择题的答题区**
       （黑框内那一段）加高 face.stretch 毫米 —— 黑框底边因此下移，
       红框底边跟着下移，两框保持贴合。空白落在最后一道题的作答区底部，
       这是用户明确允许的「答题区底部多一点空白」。
       ⚠ 不要用「红框加下内边距」的做法 —— 那会让黑框与红框脱开。 */
    var stretch = face.stretch || 0;
    face.body.forEach(function (b) {
      if (b.kind === 'choice') {
        // 红框整体（含栏目头）定位到 boxTop；网格各行由框内 padding 自然推到位，
        // 其 y 与 geometry 算出的行心一致（padding 由 boxOffsets 反推保证）。
        html += '<div class="as-choice-section" style="top:' + b.boxTop + 'mm">' +
                renderChoiceBlock(b) +
                '</div>';
      }
    });"""
assert old in s, 'renderFaceBody head'
s = s.replace(old, new, 1)

# 2) 非选择题：把 stretch 传给 builder
old_s = """              }), {
                lineH: subjItems[0].item.lineH,
                showHeader: showHeader,
                pageTip: true
              }) +
              '</div>';"""
new_s = """              }), {
                lineH: subjItems[0].item.lineH,
                showHeader: showHeader,
                pageTip: true,
                /* 下拉量加在最后一行的答题区上（黑框内变高） */
                tailExtra: stretch
              }) +
              '</div>';"""
assert old_s in s, 'subject tail'
s = s.replace(old_s, new_s, 1)
wr(p, s)
print('app.js ok')

# ═══════════════════════════════════════════════════════════════════════
# subject.js —— tailExtra 加到最后一行的 .as-subj-body 高度上
# ═══════════════════════════════════════════════════════════════════════
p = 'js/builders/subject.js'
s = rd(p)

# renderRow 增加 extra 参数
i = s.find('function renderRow(')
assert i > 0, 'renderRow'
j = s.find('\n  }', i)
print('--- renderRow 原文 ---')
print(s[i:j + 4])

# 找 render 里 items.map 的调用处
k = s.find('items.map(function (it) {')
assert k > 0, 'items.map'
print('\n--- render items.map ---')
print(s[k - 200:k + 500])
