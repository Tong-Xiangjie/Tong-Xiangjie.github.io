import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── paginator.js：新增 lineOffset（face 内相对行号）；去掉调试 ──────────────
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# 去掉 CLTRACE 调试块
rep("""          if (global.__CLTRACE) {
            (global.__CLTRACE).push({ face: faces.length, choiceLineAt: choiceLine,
              rows: rows, idxEnd: choiceLine + rows - 1,
              endNo: choice.lineRanges[choiceLine + rows - 1]
                     ? choice.lineRanges[choiceLine + rows - 1].to : 'UNDEF',
              cursorAt: cursor, gridRoom: gridRoom, canFit: canFit });
          }
""", "", '删 CLTRACE')

# 记录本面选择题的起始行号，push 时带 lineOffset
rep("""      /* ── 选择题：按行往里塞 ────────────────────────────────────────── */
      if (choice && choiceLine < choice.totalLines) {""",
"""      /* ── 选择题：按行往里塞 ────────────────────────────────────────── */
      /* 本面选择题第一行的**全局**行号。下面 push 时给出 face 内的**相对**
         行偏移（lineOffset），builder 拿它去 slice；两者用途不同，别混。
         ⚠ 踩过的坑：只传 `fromLine: choiceLine`（全局累计）给 builder，
           builder 却按「在本面这一片里从第几行开始」去 slice ——
           300 选择时第 2 面 `fromLine = 8`，而该面切片只有 7 行，
           slice(8, 15) 得到空数组 ⇒ **换页后的选择题区一片空白**
           （用户报的「换页后的选择题答题区不见了，只有一片白」）。 */
      var faceChoiceStart = choiceLine;
      if (choice && choiceLine < choice.totalLines) {""", 'faceChoiceStart')

rep("""            rows: rows,
            fromLine: choiceLine,""",
"""            rows: rows,
            /* 本面这一片里的相对行偏移（builder 的 slice 起点） */
            lineOffset: r3(0) + (choiceLine - faceChoiceStart),
            /* 全局累计行号，仅供调试/探针 */
            fromLine: choiceLine,""", 'lineOffset')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator', n)

# ── app.js：把 lineOffset 传给 builder ─────────────────────────────────────
P2 = 'js/app.js'
s2 = io.open(P2, encoding='utf-8').read()
old = """      startNo: block.startNo,
      endNo: block.endNo,
      rows: block.rows,
      fromLine: block.fromLine,"""
new = """      startNo: block.startNo,
      endNo: block.endNo,
      rows: block.rows,
      /* ⚠ 必须是**本面内相对行号**（分页器给的 lineOffset），
         不能传 block.fromLine —— 那是全局累计行号。传错会让换页后的
         选择题区整片空白（slice 越过切片尾部，得到空数组）。 */
      fromLine: (block.lineOffset === undefined ? block.fromLine : block.lineOffset),"""
assert old in s2
s2 = s2.replace(old, new, 1)
io.open(P2, 'w', encoding='utf-8', newline='').write(s2)
print('  ok: app.js lineOffset')
