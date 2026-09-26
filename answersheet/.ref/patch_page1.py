import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# 1) page.js —— 去掉「班级」
# ═══════════════════════════════════════════════════════════════════════
p = 'js/builders/page.js'
s = rd(p)
old = """    /* 第 2 行：考生信息（姓名 / 班级 / 准考证号） */
    h += '<div class="as-info"><div class="as-info-row">' +
         '<span class="as-info-label">姓名：</span><span class="as-info-fill name"></span>' +
         '<span class="as-info-label">班级：</span><span class="as-info-fill seat"></span>' +
         '<span class="as-info-label">准考证号</span>' +"""
new = """    /* 第 2 行：考生信息（姓名 / 准考证号）
       ⚠ 用户 2026 澄清：**不要「班级」**。参照件
         .ref/数学答题卡A4（6）.pdf 第 1 面也只有「姓名：」+「准考证号」。 */
    h += '<div class="as-info"><div class="as-info-row">' +
         '<span class="as-info-label">姓名：</span><span class="as-info-fill name"></span>' +
         '<span class="as-info-label">准考证号</span>' +"""
assert old in s, 'info row not found'
s = s.replace(old, new, 1)

# 页脚 bottom：由「答题区下界 − 页脚净空 − 页脚高」反推（页脚进红框内底）
old_fb = """  function footerBottom(paperH, preset) {
    var p = preset || C.PRESETS.A4;
    var TOP_BAND_CY = 11;                 // 与 app.js 的 TOP_BAND_CY 同源
    return r3(TOP_BAND_CY - p.cornerH / 2);
  }"""
new_fb = """  function footerBottom(paperH, preset) {
    var p = preset || C.PRESETS.A4;
    var G = global.AS.geometry;
    var Pg = global.AS.paginator;
    var H = paperH || C.PAPER.A4.h;
    /* 页脚**底缘**距纸顶 = 答题区下界 − 页脚净空。
       用户选 (a)：页脚进红框，站在红框内底端。 */
    var bottomEdge = r3(G.answerBottom(p, H) -
                        (Pg ? Pg.FOOTER_PAD : 0.5));
    /* CSS 的 bottom 是「距包含块底边」，包含块 = .as-face（高 = 纸高） */
    return r3(H - bottomEdge);
  }"""
assert old_fb in s, 'footerBottom not found'
s = s.replace(old_fb, new_fb, 1)
wr(p, s)
print('page.js ok')

# ═══════════════════════════════════════════════════════════════════════
# 2) theme.js —— 写非答题区 / 页脚位置的新变量
# ═══════════════════════════════════════════════════════════════════════
p = 'js/theme.js'
s = rd(p)
anchor = """    el.style.setProperty('--choice-header-h', off.headerH + 'mm');
    el.style.setProperty('--choice-header-gap', off.headerGap + 'mm');"""
assert anchor in s, 'theme anchor not found'
add = anchor + """
    /* 非答题区（「考生请不要在此区域作答」）：
       红色圆角空心框，高度由分页器给出（内联写死），字号由 app 渲染后
       按框的宽高比自适应（横排 / 竖排）。这里只给"皮肤"。 */
    el.style.setProperty('--na-border', off.border + 'mm');
    el.style.setProperty('--na-radius', '3mm');
    el.style.setProperty('--na-pad', '2mm');
    /* 答题区纵向基准 —— 供 CSS 定位页脚 / 非答题区 */
    el.style.setProperty('--answer-top', G.answerTop(p) + 'mm');
    el.style.setProperty('--answer-bottom', G.answerBottom(p, paper.h) + 'mm');"""
s = s.replace(anchor, add, 1)
wr(p, s)
print('theme.js ok')
