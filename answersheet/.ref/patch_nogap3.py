import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

# ── 1) 删除 NUM_BIAS 声明行 + 它的整个注释块 ─────────────────────────
decl = None
for i, ln in enumerate(lines):
    if ln.strip().startswith('var NUM_BIAS ='):
        decl = i
        break
assert decl is not None, 'NUM_BIAS 声明行没找到'
j = decl - 1
while j >= 0 and '/**' not in lines[j]:
    j -= 1
assert j >= 0, '注释块起始没找到'
del lines[j:decl + 1]
# 删掉紧随其后的空行（最多一行）
while j < len(lines) and lines[j].strip() == '':
    del lines[j]
s = '\n'.join(lines)

# ── 2) lineGapMarkOffset 整块替换 ────────────────────────────────────
a = s.index('  function lineGapMarkOffset(p) {')
# 连同它上面的 /** ... */ 注释一起替换
doc = s.rindex('  /**', 0, a)
b = s.index('\n  }', a) + len('\n  }')
new = '''  /**
   * 行间**不**放定位块 —— layoutFace 每行只按 rowOffsets 出 5 块。
   *
   * 用户画的结构图（最终口径）：
   *     【】1 2 3 ……        ← 题号行
   *     【】A A A ……        ← A 选项行
   *     【】B B B ……
   *     【】C C C ……
   *     【】D D D ……
   *     【】21 22 23 ……     ← 下一行紧接，中间**没有额外的方块**
   *     【】A A A ……
   * 行与行之间看到的那个"间隙"是 lineGapH 把两行拉开的结果，不是多画了一块。
   *
   * ⚠ **踩坑记录**：先后五次尝试在行间塞一块，全部失败 —— 块高 2.436，
   *   而行间可用净空最多只有 2.4 左右，无论怎么摆都会与相邻块重叠或挤成一团：
   *     ① 延续上一行节距                  → 距下一行题号块 1.04  **叠**
   *     ② 「末气泡下缘 / 题号盒上缘」取中点 → 距上一行末尾 1.66  **挤**
   *     ③ 用几何口径的题号块心取中点       → 距题号块 0.09  **叠**
   *     ④ ⑤ 换各种偏差符号                → 距题号块 0.97/1.05 **叠**
   *   用户原话：「你怎么方块融合在一起了？有这么难理解吗？？？」
   *   结论：**行间不放块**。
   *
   * 本函数保留但返回 null，只为把上面这段结论留在代码里。
   */
  function lineGapMarkOffset(p) {
    return null;
  }'''
s = s[:doc] + new + s[b:]

# ── 3) layoutFace：每行只出 rowOffsets 那 5 块 ───────────────────────
a2 = s.index('    /* ⚠ 选择题**每一行**（换行后）都要有自己的一列左侧定位点。')
b2 = s.index('    }\n\n    /* ── 角标', a2)
new2 = '''    /* 左侧定标带：**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量 = nLines · offs.length
             每行 5 块：题号行 + A/B/C/D，**行间不放块**（见 lineGapMarkOffset）。
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错整列就全乱（上一轮的教训）。
       只按第一行画、换行后的第二行左边就空着 —— 用户报的
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
    }
'''
s = s[:a2] + new2 + s[b2:]

# ── 4) 导出里去掉 NUM_BIAS ───────────────────────────────────────────
s = s.replace('    NUM_BIAS: NUM_BIAS,\n', '', 1)

assert 'NUM_BIAS' not in s, 'NUM_BIAS 残留: ' + str(
    [l.strip()[:70] for l in s.split('\n') if 'NUM_BIAS' in l])

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
