import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

# ── 1) 删除 NUM_BIAS 声明 + 它的注释块 ───────────────────────────────
out = []
i = 0
while i < len(lines):
    if lines[i].strip() == 'var NUM_BIAS = r3((numRowH(C.PRESETS.A4) - r3(C.PRESETS.A4.blockW * 3 / 5)) / 2);':
        # 向上吃掉注释块
        j = len(out) - 1
        while j >= 0 and not out[j].strip().startswith('/**'):
            j -= 1
        assert j >= 0, 'comment start not found'
        out = out[:j]
        i += 1
        # 跳过后续空行
        while i < len(lines) and lines[i].strip() == '':
            i += 1
        continue
    out.append(lines[i])
    i += 1
lines = out
s = '\n'.join(lines)
assert 'NUM_BIAS' not in s, 'NUM_BIAS 残留: ' + str([l for l in lines if 'NUM_BIAS' in l])

# ── 2) lineGapMarkOffset 整块替换为「不使用」说明 ────────────────────
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('\n  }', a) + len('\n  }')
new = '''  /**
   * 行间**不**放定位块 —— layoutFace 只按 rowOffsets 每行出 5 块。
   *
   * 用户画的结构图（这是最终口径）：
   *     【】1 2 3 ……        ← 题号行
   *     【】A A A ……        ← A 选项行
   *     【】B B B ……
   *     【】C C C ……
   *     【】D D D ……
   *     【】21 22 23 ……     ← 下一行紧接，中间**没有额外的方块**
   *     【】A A A ……
   * 行与行之间看到的那个"间隙"是 lineGapH 把两行拉开的结果，
   * 不是多画了一块。
   *
   * ⚠ **踩坑记录**：先后五次尝试在行间塞一块，全部失败 ——
   *   块高 2.436，而行间可用的净空最多只有 2.4 左右，无论怎么摆都会
   *   与相邻块重叠或挤成一团：
   *     ① 延续上一行节距                    → 距下一行题号块 1.04  **叠**
   *     ② 「末气泡下缘 / 题号盒上缘」取中点   → 距上一行末尾 1.66  **挤**
   *     ③ 用几何口径的题号块心取中点         → 距题号块 0.09  **叠**
   *     ④ ⑤ 换 NUM_BIAS 的各种符号          → 距题号块 0.97/1.05 **叠**
   *   用户的原话：「你怎么方块融合在一起了？有这么难理解吗？？？」
   *   结论：**行间不放块**。
   *
   * 本函数保留但返回 null，只为把上面这段结论留在代码里。
   */
  function lineGapMarkOffset(p) {
    return null;
  }'''
s = s[:a] + new + s[b:]

# ── 3) layoutFace：每行只出 rowOffsets 那 5 块 ───────────────────────
old = """    /* ⚠ 选择题**每一行**（换行后）都要有自己的一列左侧定位点。
       一行 = 题号行 + 各选项行，共 rowOffsets().length 个块；
       行与行之间按 lineHeight() 递推。
       **并且行间空档里还要多一个定位点**（用户指定：
       「上一行最后一个选项和下一行题号之间留出一个定位点的宽度，
         左侧相应也要定位点」）—— 它落在空档正中间。
       只按第一行画，换行后的第二行左边就空着 —— 用户报的
       「换行后左边定位点数量没有增加」就是这个。 */
    var nLines = (o.choiceLines === undefined || o.choiceLines === null)
      ? (hasGrid ? 1 : 0) : o.choiceLines;
    /* 左侧定标带**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量：
         每行 = offs.length 个（题号行 + A/B/C/D）
         行间 = 每两个相邻行之间 1 个（用户要求「左侧相应也要定位点」）
         ⇒ 合计 nLines·offs.length + (nLines − 1)
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错，整列就全乱（上一轮的教训）。 */
    var rows = [];
    if (hasGrid) {
      var gapOff = lineGapMarkOffset(p);
      for (var li = 0; li < nLines; li++) {
        /* ⚠ gapOff 是**相对本行（下一行）行顶**的负偏移，
           所以它必须加在本行 base 上、并排在行首 —— 加在上一行 base 上
           会把空档点压到上一行末气泡那一格里去。 */
        if (li > 0) rows.push(r3(r3(o.gridTop + li * lineHeight(p)) + gapOff));
        var base = r3(o.gridTop + li * lineHeight(p));
        /* 左侧块心一律用 rowOffsets（题号块 = rowOffsets[0]，气泡块 = 后四项）。
           实测题号块心与题号渲染行心仅差 0.085mm（见 .ref/markrows.cjs），
           属盒模型取整残差，不要去「修」—— 用 NUM_BIAS 去改会让题号块
           下移 2mm，与下一行的题号块叠在一起（已实测翻车）。 */
        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }"""
new2 = """    /* 左侧定标带：**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量 = nLines · offs.length
             每行 5 块：题号行 + A/B/C/D，**行间不放块**（见 lineGapMarkOffset）。
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错整列就全乱（上一轮的教训）。
       只按第一行画，换行后的第二行左边就空着 —— 用户报的
       「换行后左边定位点数量没有增加」就是这个。 */
    var nLines = (o.choiceLines === undefined || o.choiceLines === null)
      ? (hasGrid ? 1 : 0) : o.choiceLines;
    var rows = [];
    if (hasGrid) {
      for (var li = 0; li < nLines; li++) {
        var base = r3(o.gridTop + li * lineHeight(p));
        /* 块心一律用 rowOffsets（题号块 = rowOffsets[0]，气泡块 = 后四项）。
           实测题号块心与题号渲染行心仅差 0.085mm（见 .ref/markrows.cjs），
           属盒模型取整残差，不要去「修」。 */
        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }"""
assert old in s, 'layoutFace rows block not found'
s = s.replace(old, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
