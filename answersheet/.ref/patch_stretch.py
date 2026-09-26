import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# app.js —— 把 face.stretch 交给本面**最后一个**红框
# ═══════════════════════════════════════════════════════════════════════
p = 'js/app.js'
s = rd(p)

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
    /* 本面最后一个块 —— 收口时「红框往下拉」只拉它。
       ⚠ 用户指定：剩余 < 15mm（不画非答题区）时，把最后一块红框的
         **底部**拉到目标下界，黑框与行距完全不动，多出来的空白留在
         答题区底部。 */
    var lastBlock = face.body.length ? face.body[face.body.length - 1] : null;
    var stretch = face.stretch || 0;
    var tailStyle = function (b) {
      return (b === lastBlock && stretch > 0)
        ? ';padding-bottom:calc(var(--subj-pad-y-bottom) + ' + stretch + 'mm)'
        : '';
    };
    face.body.forEach(function (b) {
      if (b.kind === 'choice') {
        // 红框整体（含栏目头）定位到 boxTop；网格各行由框内 padding 自然推到位，
        // 其 y 与 geometry 算出的行心一致（padding 由 boxOffsets 反推保证）。
        html += '<div class="as-choice-section" style="top:' + b.boxTop + 'mm">' +
                renderChoiceBlock(b, tailStyle(b)) +
                '</div>';
      }
    });"""
assert old in s, 'renderFaceBody head'
s = s.replace(old, new, 1)

# renderChoiceBlock 接受 tailStyle
old_cb = """      colCenters: block.colCenters
    });
    return r.html;
  }"""
new_cb = """      colCenters: block.colCenters,
      /* 收口下拉：追加到红框的下内边距上（黑框/网格不动） */
      tailStyle: tail || ''
    });
    return r.html;
  }"""
assert old_cb in s, 'renderChoiceBlock tail'
s = s.replace(old_cb, new_cb, 1)
s = s.replace("  function renderChoiceBlock(block) {",
              "  function renderChoiceBlock(block, tail) {", 1)

# 非选择题红框同理
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
                tailStyle: tailStyle(subjItems[subjItems.length - 1])
              }) +
              '</div>';"""
assert old_s in s, 'subject tail'
s = s.replace(old_s, new_s, 1)

wr(p, s)
print('app.js ok')

# ═══════════════════════════════════════════════════════════════════════
# subject.js —— 红框尾样式
# ═══════════════════════════════════════════════════════════════════════
p = 'js/builders/subject.js'
s = rd(p)
old = """    return '<div class="as-subject-outer">' +"""
assert old in s, 'subject outer'
s = s.replace(old,
"""    return '<div class="as-subject-outer"' +
             (opts.tailStyle ? ' style="' + opts.tailStyle.replace(/^;/, '') + '"' : '') +
             '>' +""", 1)
wr(p, s)
print('subject.js ok')

# ═══════════════════════════════════════════════════════════════════════
# choice.js —— 红框尾样式
# ═══════════════════════════════════════════════════════════════════════
p = 'js/builders/choice.js'
s = rd(p)
needle = "'<div class=\"as-choice-outer\">'"
if needle in s:
    s = s.replace(needle,
"""'<div class="as-choice-outer"' +
           (o.tailStyle ? ' style="' + String(o.tailStyle).replace(/^;/, '') + '"' : '') +
           '>'""", 1)
    wr(p, s)
    print('choice.js ok')
else:
    # 找实际写法
    import re
    for m in re.finditer(r'.{0,60}as-choice-outer.{0,60}', s):
        print('CHOICE OUTER:', repr(m.group(0)))
    print('!! choice.js: as-choice-outer 未按预期拼接，需手改')
