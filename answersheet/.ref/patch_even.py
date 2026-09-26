import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# page.js —— 凑偶数的空白面：页眉只留「第 N 面」
# ═══════════════════════════════════════════════════════════════════════
p = 'js/builders/page.js'
s = rd(p)

old = """  /** 页眉：后续页 */
  function chromeOther(meta) {
    var line = [meta.title, meta.subject ? meta.subject + '答题卡' : '']
      .filter(Boolean).join('　');
    if (!line) return '';
    return '<div class="as-title" style="margin-top:' + CHROME.otherTop + 'mm">' +
           '<div class="as-title-sub" style="font-size:3.4mm">' +
           esc(line) + '</div>' +
           '</div>';
  }"""
new = """  /** 页眉：后续页
   *  @param {object} meta
   *  @param {boolean} blank 凑偶数的**空白面** —— 用户指定「页眉只留第 N 面」，
   *         不印「xx答题卡」那行标题（整面就是一个非答题区）。
   */
  function chromeOther(meta, blank) {
    if (blank) return '';
    var line = [meta.title, meta.subject ? meta.subject + '答题卡' : '']
      .filter(Boolean).join('　');
    if (!line) return '';
    return '<div class="as-title" style="margin-top:' + CHROME.otherTop + 'mm">' +
           '<div class="as-title-sub" style="font-size:3.4mm">' +
           esc(line) + '</div>' +
           '</div>';
  }"""
assert old in s, 'chromeOther'
s = s.replace(old, new, 1)

old_r = """      html += f.first ? chromeFirst(o.meta, o.specialPos) : chromeOther(o.meta);"""
new_r = """      html += f.first ? chromeFirst(o.meta, o.specialPos)
                      : chromeOther(o.meta, f.blank);"""
assert old_r in s, 'render chrome call'
s = s.replace(old_r, new_r, 1)

# 导出 blank 标记的说明（chromeHeight 对空白面仍用 otherBottom，保持不变）
wr(p, s)
print('page.js ok')

# ═══════════════════════════════════════════════════════════════════════
# app.js —— 凑偶数面 + 空白面
# ═══════════════════════════════════════════════════════════════════════
p = 'js/app.js'
s = rd(p)

old = """      chromeOther: Page.chromeHeight(false)
    });
"""
new = """      chromeOther: Page.chromeHeight(false)
    });

    /* ── 凑齐偶数页 ──────────────────────────────────────────────────────
       用户指定：「一般要凑齐偶数页，所以不应该出现奇数页，空白的地方
       全部用非答题区」，且多出来的那一面**整面就是一个非答题区**
       （含页脚、四角定位点，页眉只留「第 N 面」）。

       ⚠ 判据是**总面数**：A4 单面/张，面数=张数；A3 三面/张。
         这里按面数补齐（A4 即页数），A3 保持 3 的倍数关系不变。 */
    var blankFaces = 0;
    if (faces.length % 2 === 1) {
      var p0 = C.PRESETS[opt.format];
      var A_TOP0 = G.answerTop(p0);
      var A_BOT0 = G.answerBottom(p0, C.PAPER[opt.format].h);
      var contentH0 = G.r3(A_BOT0 - A_TOP0);
      faces.push({
        first: false,
        blank: true,
        body: [],
        cursor: A_TOP0,
        frameBot: A_BOT0,
        stretch: 0,
        /* 整面一个非答题区：从答题区上界一直铺到答题区下界 */
        noAnswer: true,
        noAnswerTop: A_TOP0,
        noAnswerH: contentH0,
        usable: Pager.usableH(p0),
        hasSubj: false
      });
      blankFaces = 1;
    }
"""
assert old in s, 'paginate call'
s = s.replace(old, new, 1)

# 空白面：不要给「本面有没有选择题」传值 → choiceBlock 天然为 null ✓
# 但 specialRows 只看 face.first，空白面 first=false ✓

# 统计里说明凑了几面
s = s.replace("""    $('previewInfo').textContent =
      '共 ' + r.sheetCount + ' 张 / ' + r.faces.length + ' 面 · ' + opt.format +
      ' · ' + (opt.theme === 'color' ? '双色' : '黑白');""",
"""    $('previewInfo').textContent =
      '共 ' + r.sheetCount + ' 张 / ' + r.faces.length + ' 面 · ' + opt.format +
      ' · ' + (opt.theme === 'color' ? '双色' : '黑白') +
      (r.blankFaces ? ' · 含 1 面非答题区（凑偶数）' : '');""", 1)

s = s.replace("""    return {
      html: out, faces: faces, sheetCount: sheetCount,
      violations: violations, paper: paper, preset: preset
    };""",
"""    return {
      html: out, faces: faces, sheetCount: sheetCount,
      blankFaces: blankFaces,
      violations: violations, paper: paper, preset: preset
    };""", 1)

# 空白面必须重算 sheetCount —— 它在 faces 补齐之前就算好了
wr(p, s)
print('app.js part1 ok')
