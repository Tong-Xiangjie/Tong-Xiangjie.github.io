import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── page.js：页脚改成「用 top 把块心钉在下定位点行心」+ translateY(-50%) ──
P = 'js/builders/page.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

rep("""    var TOP_BAND_CY = 11;
    /* 页脚块的**渲染**高。CSS 是 font-size:var(--fs-footer) + line-height:1.55，
       单行时浏览器按字体度量算出 5.027mm（--fs-footer 9.5pt → 17px 行盒）。
       ⚠ 用 4.92 会让页脚中线比下定位点行心低 0.132mm（实测，.ref/footanchor.cjs）。 */
    var FOOTER_BLOCK_H = 5.027;
    /* 下定位点行心（与顶部定标带同一条构造）：TOP_BAND_CY = 11 ⇒ 286mm */
    var markCy = r3(H - TOP_BAND_CY);
    /* 页脚块**中线**对到这个行心 */
    var bottomEdge = r3(markCy + FOOTER_BLOCK_H / 2);
    return r3(H - bottomEdge);""",
"""    var TOP_BAND_CY = 11;                 // 与 app.js 的 TOP_BAND_CY 同源
    /* 下定位点行心（与顶部定标带同一条构造）：TOP_BAND_CY = 11 ⇒ 286mm */
    return r3(H - TOP_BAND_CY);""", 'footerBottom -> 行心')

rep("""    return '<div class="as-footer" style="bottom:' +
           footerBottom(curPaperH, curPreset) + 'mm">' + lines.map(function (l) {""",
"""    /* 页脚**中线**钉在下定位点行心上 —— 用 top + translateY(-50%)，
       不用 bottom：bottom 要先知道块高，而块高由字体度量决定（实测 5.027mm，
       CSS 里写不出来的量）。translateY(-50%) 让「块心对齐行心」由构造保证，
       换字体/换行数都不会偏。 */
    return '<div class="as-footer" style="top:' +
           footerBottom(curPaperH, curPreset) +
           'mm;transform:translateY(-50%)">' + lines.map(function (l) {""",
    '页脚用 top + translateY')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('page.js', n)

# ── card.css：兜底也改成 top ──
P2 = 'css/card.css'
c = io.open(P2, encoding='utf-8').read()
old = """  /* 底边与**下方**两个角标大方块的底边齐平（用户指定「页脚高度对齐下面的大方块」）。
     ⚠ 具体数值由 builders/page.js 的 footerBottom() 内联写在每个页脚上；
       这里只留一个 A4 兜底值。不要在 CSS 里用 calc(var − var) —— 实测
       这条声明会被 Chrome 整条丢弃，页脚退回静态位置跑到纸顶去。 */
  bottom: 8.885mm;"""
new = """  /* 用户 2026 指定：页脚**固定在下方定位点中心的高度**（不再与红框锚定）。
     实现：top 写到「下定位点行心」的 y（286mm），再用 translateY(-50%)
     把块的**中线**压到那条线上 —— 块心对齐由构造保证，不依赖块高。
     ⚠ 具体数值由 builders/page.js 的 footerBottom() 内联写在每个页脚上；
       这里只留一个 A4 兜底值。不要在 CSS 里用 calc(var − var) —— 实测
       这条声明会被 Chrome 整条丢弃，页脚退回静态位置跑到纸顶去。 */
  top: 286mm;
  transform: translateY(-50%);"""
assert old in c, 'MISS css footer'
c = c.replace(old, new, 1)
io.open(P2, 'w', encoding='utf-8', newline='').write(c)
print('  ok: card.css 兜底改 top')
