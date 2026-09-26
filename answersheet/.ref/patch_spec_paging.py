import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) paginator: colCenters 是死值，且算的是「面左缘 = 0」的坐标系 ─────
p = 'js/paginator.js'
s = io.open(p, encoding='utf-8').read()
old = """        /* 首行各列列心 —— 气泡网格用这一组（含 gridShiftX）。 */
        colCenters: G.columnCenters(p, faceW),"""
new = """        /* ⚠ `colCenters` 是**遗留的死值**，builder 不使用它
           （builders/choice.js 用 G.gridOriginX 自己现算 margin-left）。
           而且这里少传了 faceX，算出来的是「面左缘 = 0」坐标系下的绝对 x，
           多面排版时（A3 第 2/3 面）本身就是错的。
           保留字段只为不改变 planBlocks 的返回形状，**不要**在任何地方读它；
           新增的代码一律用 G.columnCenters(p, faceW, faceX) 现算。 */
        colCenters: null,"""
assert old in s, 'colCenters block not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('paginator ok')

# ── 2) 规格文档：补 6.6.11 选择题跨面分页 ─────────────────────────────
p2 = '答题卡排版规格.md'
d = io.open(p2, encoding='utf-8').read()
anchor = '### 6.6.10'
i = d.index(anchor)
j = d.find('\n### ', i + len(anchor))
if j < 0:
    j = len(d)
new = '''
### 6.6.11 选择题跨面分页（一页放不下时）

**只有「一页放不下」才会显形的两个 bug**，日常 12~40 题的用例永远走不到。
判据：**选择题是否换页**，而不是题数多寡。

#### ① 续页的 `gridTop` 必须等于 `choiceChromeH`，与 `headH` 无关

栏目头在**每一面**都占文档流里的 `headerH + headerGap = 6mm`：

| 面 | 栏目头内容 | 类名 | 占高 |
|---|---|---|---|
| 首页 | 选择题 + 正确填涂示例 | `.as-choice-header` | `--choice-header-h` + `--choice-header-gap` |
| 续页 | 请在各题目的答题区域内作答… | `.as-choice-header-no-example` | 同上 |

所以红框上缘 → 网格上缘的距离**每面都等于 `choiceChromeH`**。

> ⚠️ **踩过的坑**：分页器写成
> `headH = choiceLine === 0 ? choiceChromeH(p) : 0`，再 `contentTop = cursor + headH`。
> 续页 `contentTop` 就等于 `boxTop`，builder 拿到
> `gridTop = contentTop − boxTop = 0`，反推黑框
> `margin-top = 0 − choiceChromeH = −10.583mm`，黑框被顶到**红框上沿之上**。
>
> 实测续页：黑框顶 324.5 < 红框顶 327.8，
> 红框内「黑框外缘下 → 红框内缘」= **−7.585mm**（应为 +1）。

`headH` 只用于容量提示，**位置计算一律用 `choiceChromeH(p)`**。

#### ② `canFit` 必须同时减掉 `choiceChromeH` 与 `choiceFootH`

本面红框总高（红框上缘 → 红框下缘）必须 ≤ `usable − cursor`：

```
红框高 = choiceChromeH + 网格高 + choiceFootH
网格高 = n × colH + (n − 1) × lineGap = n × lineH − lineGap
⇒ n ≤ (usable − cursor − choiceChromeH − choiceFootH + lineGap) / lineH
```

> ⚠️ **踩过的坑**：
> · 漏 `choiceFootH` → 每面红框比可用高度高 **4.22mm**；
> · 把 `headH` 与 `choiceChromeH` 一起减 → 栏目头减两遍（多减 10.6mm）。
>
> 实测 A3 300 题第 2 面：`boxTop=25`、11 行 → 红框底 **287.769**，
> 越过可用高度 273.3 共 **14.469mm**，直接压到页脚上。
> 公式改成含 `choiceFootH` 后 `canFit` 从 11 降到 10，红框底 265.01 ✓。

另需扣一个极小量 `EPS_MM = 0.02`：`colH` 是 `r3` 取整值，
累乘会有取整漂移（A3 11 行：`11×20.359 = 223.949` vs 真实 `223.9545`）。
不扣的话边界上会多放一行，红框刚好压过页脚。

#### ③ `colCenters` 是死值

`planBlocks` 里 `G.columnCenters(p, faceW)` **少传 `faceX`**，
算的是「面左缘 = 0」坐标系下的绝对 x，多面排版时本身就是错的。
builder 不使用该字段（`builders/choice.js` 用 `G.gridOriginX` 现算 margin-left），
所以一直是潜伏的坑。现已置为 `null` 并加注释。

#### 校验探针

| 探针 | 作用 |
|---|---|
| `.ref/choice_multi.cjs <题数> <A4\\|A3>` | 逐面量红框/黑框的相对位置（左隙/右隙/下隙/上内距/下内距）+ 红框底是否越界 |
| `.ref/overflow.cjs <A4\\|A3> <题数>` | 只看红框底是否越过可用高度（`canFit` 是否算漏） |
| `.ref/flowcheck.cjs <题数>` | 逐元素 `offsetTop` / computed margin，定位「黑框跑到红框外」 |
| `.ref/buildargs.cjs <题数>` | 记录每次 `Choice.build` 的完整入参（`gridTop` / `gridH` / `rows`） |

不变量（每面都必须成立）：

```
红框内缘 → 黑框外缘（左/右） = boxGap = 3.0
红框内缘底 → 黑框外缘底      = outerPadYBottom = 1.0
黑框上内缘 → 网格上缘        = innerPadTop = 3.0
黑框下内缘 → 末行选项下缘    = innerPadBottom ≈ 3.0
红框底 ≤ 297 − BOTTOM_RESERVE = 273.3
```

实测结果（修复后）：

```
A4   40 题 → 1 面        异常段数 0
A4  100 题 → 2 面        异常段数 0
A4  300 题 → 3 面        异常段数 0
A4 1000 题 → 6 面        异常段数 0
A4 2000 题 → 11 面       异常段数 0
A3  120 题 → 3 面        异常段数 0
A3  300 题 → 3 面        异常段数 0
A3  600 题 → 6 面        异常段数 0
```

'''
d = d[:j] + new + d[j:]
io.open(p2, 'w', encoding='utf-8', newline='').write(d)
print('spec ok')
