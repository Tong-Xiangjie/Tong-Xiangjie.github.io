import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()

# ═══ 修复 1：版块间距 ═══════════════════════════════════════════════════
old = """      var cursor = base;
      var body = [];"""
new = """      var cursor = base;
      var body = [];
      /* 本面已排的最后一块的 kind —— 决定两块之间要不要留版块间距。
         ⚠ 用户报「注意事项和选择题和非选择题之间的间隙不见了」。
         ⚠ 用户澄清：**信息区 ↔ 注意事项** 那条间隙本来就还在，不要动它
           （那条由 .as-head 的行网格给出，是页眉内部的事）。
           这里只管「页眉/注意事项 → 选择题」与「选择题 → 非选择题」两处。 */
      var lastKind = null;"""
assert old in s, 'cursor/body anchor'
s = s.replace(old, new, 1)

old_c = """      /* ① 选择题 -------------------------------------------------------- */
      if (choice && choiceLine < choice.totalLines) {"""
new_c = """      /* ① 选择题 -------------------------------------------------------- */
      if (choice && choiceLine < choice.totalLines) {
        /* 版块间距：本面已排过别的块时才留（第一块紧接页眉/答题区上界） */
        if (body.length > 0) cursor = r3(cursor + sectionGap());"""
assert old_c in s, 'choice anchor'
s = s.replace(old_c, new_c, 1)

old_s = """      /* ② 非选择题 ------------------------------------------------------ */
      if (!choice || choiceLine >= choice.totalLines) {
        while (subjIdx < subj.length) {"""
new_s = """      /* ② 非选择题 ------------------------------------------------------ */
      if (!choice || choiceLine >= choice.totalLines) {
        /* 版块间距：上一块是选择题（同面）时留。
           ⚠ 用户报「选择题和非选择题之间的间隙不见了」—— 之前这里漏了。 */
        if (lastKind === 'choice') cursor = r3(cursor + sectionGap());
        while (subjIdx < subj.length) {"""
assert old_s in s, 'subj anchor'
s = s.replace(old_s, new_s, 1)

# 记录 lastKind
s = s.replace("""            body.push({
              kind: 'choice',
              boxTop: cursor,""",
"""            lastKind = 'choice';
            body.push({
              kind: 'choice',
              boxTop: cursor,""", 1)

# ═══ 修复 2/3：收口 —— 钉死下界 + 红框下拉（不动黑框）══════════════════
old_z_start = "      /* 目标：最后一块红框的下缘 → 答题区下界（留出页脚）。"
i = s.find(old_z_start)
assert i > 0, 'closing block start'
j = s.find("        hasSubj: body.some(function (x) { return x.kind === 'subj'; })\n      });", i)
assert j > 0, 'closing block end'
end = j + len("        hasSubj: body.some(function (x) { return x.kind === 'subj'; })\n      });")
new_z = """      /* ── 收口：把最后一块红框的下缘**钉死**在目标下界 ──────────────
         目标下界 = 答题区下界 − 页脚块（页脚站在红框内底端）。

         规则（用户 2026 明确定稿）：
           · 剩余 ≥ NOANSWER_MIN_H(15mm) → **画「非答题区」**吃掉这块空白；
           · 剩余 <  15mm               → **不画非答题区**，但要把最后一块
             红框的底部下拉到目标下界（黑框相应保持原位、整体上移视觉不变），
             红框底与末行之间的那点空白留在**答题区底部**（用户明确允许）。
             ⚠ 之前理解错成「拉大答题行的行距」，那会改变每题的作答空间，
               不是用户要的。现在用 `stretch` 加到红框的**下内边距**上，
               黑框与行距完全不动。

         另：总面数要凑偶数，多出来的那一面整面就是非答题区 —— 由 app.js
         在拿到 faces 之后追加（见 app.js 的 padToEvenFaces）。 */
      var bottomLimit = r3(A_BOT - FOOTER_H - FOOTER_PAD);
      var rest = r3(bottomLimit - cursor - lastFrameBottomH);
      if (rest < 0) rest = 0;
      var noAnswer = rest >= NOANSWER_MIN_H;

      faces.push({
        first: isFirst,
        body: body,
        cursor: cursor,
        frameBot: bottomLimit,
        /* < 15mm 时把红框下缘往下拉这么多；≥15mm 时非答题区接手，不拉 */
        stretch: noAnswer ? 0 : rest,
        noAnswer: noAnswer,
        noAnswerTop: noAnswer ? r3(cursor + lastFrameBottomH) : null,
        noAnswerH: noAnswer ? rest : 0,
        usable: usableH(p),
        hasSubj: body.some(function (x) { return x.kind === 'subj'; })
      });"""
s = s[:i] + new_z + s[end:]

# lastDebug 字段
s = s.replace("""          noAnswer: f.noAnswer, noAnswerH: f.noAnswerH,""",
"""          noAnswer: f.noAnswer, noAnswerH: f.noAnswerH, stretch: f.stretch,""", 1)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator patched')
