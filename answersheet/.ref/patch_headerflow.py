import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/builders/choice.js'
s = io.open(p, encoding='utf-8').read()

old = """    /* 纵向：黑框是 gridTop 所在的那一层盒模型。
         gridTop  = 红框顶 → **网格（题号行）上缘**
         黑框边框盒上缘 = 红框线 + 红框上内边距 + 栏目头 + 栏目头下间距
         网格上缘 = 黑框边框盒上缘 + 黑框线 + 黑框上内边距 + margin-top
       ⇒ margin-top = gridTop
                      − (红框线 + outerPadY + headerH + headerGap)
                      − 黑框线 − innerPadTop
       ⚠ 黑框上内边距（innerPadTop，用户指定 3mm）必须减掉，否则网格会
         再被 padding 往下推 3mm，黑框内的上边距就变成 6mm。
       ⚠ 别用 choiceChromeH 来算：它到网格上缘，而这里要的是 margin，
         两者相差的正是 (黑框线 + innerPadTop) —— 用错会少减这两项。 */
    var innerMarginTop = G.snapMM(G.r3(gridTop - off.border - off.outerPadY -
                                       off.headerH - off.headerGap -
                                       off.border - off.innerPadTop));"""
new = """    /* 纵向：黑框是 gridTop 所在的那一层盒模型。
         gridTop  = 红框顶 → **网格（题号行）上缘**
         黑框边框盒上缘 = 红框线 + 红框上内边距 + 栏目头 + 栏目头下间距
         网格上缘 = 黑框边框盒上缘 + 黑框线 + 黑框上内边距 + margin-top
       ⇒ margin-top = gridTop
                      − (红框线 + outerPadY + headerH + headerGap)
                      − 黑框线 − innerPadTop
       ⚠ 黑框上内边距（innerPadTop，用户指定 3mm）必须减掉，否则网格会
         再被 padding 往下推 3mm，黑框内的上边距就变成 6mm。
       ⚠ 别用 choiceChromeH 来算：它到网格上缘，而这里要的是 margin，
         两者相差的正是 (黑框线 + innerPadTop) —— 用错会少减这两项。

       ⚠⚠ **栏目头的高度与间距必须无条件减掉，与 `o.first` 无关。**
         `header()` 在**每一面**都会吐出一个 `.as-choice-header`
         （首页带「正确填涂示例」，续页只有一行提示，类名多一个
         `-no-example`），两者都是 `height: --choice-header-h` +
         `margin-bottom: --choice-header-gap`，**始终占据文档流**。
         黑框是它后面的普通流内元素，margin-top 是**从栏目头下沿**起算的，
         所以减不减 headerH/headerGap 与「是不是首页」毫无关系。
         早期写成「减 headerH/headerGap」的推导本身没错，错在实现里
         一度按 `first` 分支，续页少减了 6mm —— 那 6mm 会让黑框整体上移，
         反过来压过红框上沿：实测续页黑框顶 324.5 < 红框顶 327.8，
         红框内「黑框外缘下 → 红框内缘」变成 −7.585mm（应为 +1）。
         这是 **选择题换页（300+ 题）才显形**的 bug：一页放得下时
         所有面都是 `first`，永远走不到错误分支。 */
    var innerMarginTop = G.snapMM(G.r3(gridTop - off.border - off.outerPadY -
                                       off.headerH - off.headerGap -
                                       off.border - off.innerPadTop));
    /* 断言式自检：黑框顶必须落在红框内容顶之下，否则就是上面的项减错了。
       红框内容顶（相对红框边框盒顶）= 红框线 + outerPadY；
       黑框边框盒顶（相对红框边框盒顶）= 上者 + headerH + headerGap + margin-top。 */
    var boxOffsetTop = G.r3(off.border + off.outerPadY + off.headerH +
                            off.headerGap + innerMarginTop);
    if (boxOffsetTop < off.border + off.outerPadY - 1e-6) {
      /* 不抛异常（生成不该因为自检失败而中断），只是把量写进返回值供探针读取 */
      headerFlowBroken = true;
    }
    headerBoxOffsetTop = boxOffsetTop;"""
assert old in s, 'margin block not found'
s = s.replace(old, new, 1)

# 在 build 顶部声明两个诊断变量并导出
old2 = """  function build(o) {
    var g = o.group || C.GROUPS.A4;"""
new2 = """  /* 诊断：黑框边框盒顶相对红框边框盒顶的偏移（应 = 红框线 + outerPadY 的下一层）。
     只在 build 里写，供 .ref/boxmodel.cjs 之类的探针读取。 */
  var headerFlowBroken = false;
  var headerBoxOffsetTop = null;
  function boxOffsetTopOf(o) {
    var p = o.preset || C.PRESETS.A4;
    var off = G.boxOffsets(p);
    var gridTop = (o.gridTop !== undefined && o.gridTop !== null)
      ? o.gridTop : G.choiceChromeH(p);
    var m = G.snapMM(G.r3(gridTop - off.border - off.outerPadY -
                          off.headerH - off.headerGap - off.border - off.innerPadTop));
    return G.r3(off.border + off.outerPadY + off.headerH + off.headerGap + m);
  }

  function build(o) {
    var g = o.group || C.GROUPS.A4;"""
assert old2 in s
s = s.replace(old2, new2, 1)

# 导出诊断
old3 = """  global.AS.choice = {
    OPTIONS: OPTIONS,
    header: header,
    build: build,
    heightForRows: heightForRows
  };"""
new3 = """  global.AS.choice = {
    OPTIONS: OPTIONS,
    header: header,
    build: build,
    heightForRows: heightForRows,
    boxOffsetTopOf: boxOffsetTopOf,
    get headerFlowBroken() { return headerFlowBroken; },
    get headerBoxOffsetTop() { return headerBoxOffsetTop; }
  };"""
assert old3 in s
s = s.replace(old3, new3, 1)

# 重置诊断（每次 build 开头）
s = s.replace("""  function build(o) {
    var g = o.group || C.GROUPS.A4;
    var p = o.preset || C.PRESETS.A4;""",
"""  function build(o) {
    headerFlowBroken = false;
    var g = o.group || C.GROUPS.A4;
    var p = o.preset || C.PRESETS.A4;""", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
