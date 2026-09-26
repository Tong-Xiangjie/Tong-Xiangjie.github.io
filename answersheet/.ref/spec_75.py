import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = '答题卡排版规格.md'
s = io.open(P, encoding='utf-8').read()

old = """### 7.5 收口：红框底钉死在目标下界

用户口径（**逐字**）：

> 「非最后一面：≥15mm 画非答题区，<15mm 不画，但是要把红框的底部拉到
>  要求的高度，黑框相应移动，答题区底部多一点空白（这是允许的）」

一面排完正文后：

| 剩余空白 `rest` | 处理 |
|---|---|
| ≥ `NOANSWER_MIN_H`（15mm） | 画**非答题区**（独立红框）吃掉它；`stretch = 0` |
| < 15mm | 不画非答题区；`stretch = rest × STRETCH_K` 加高**最后一段的答题区**，黑框底边随之变高、红框底边跟着下移，空白留在答题区底部（用户明确允许） |

> ⚠️ 判据 `rest = F_BOT − cursor − frameHeight`（`frameHeight` 是常量，
> 所以这是恒等式，不是估计）。**不是**一律下拉 —— 一律下拉会把中继面
> 也强行撑满，红框/黑框被拉长，看着像排版错了。"""

new = """### 7.5 收口：红框底与剩余空白

用户 2026 定稿（**逐字**）：

> 「现在整面都是非答题区的红框高度和位置非常好，就以这个为标准」
> 「非最后一面：≥15mm 画非答题区，<15mm 不画，但是要把红框的底部拉到
>  要求的高度，黑框相应移动，答题区底部多一点空白（这是允许的）」

**标准框（用户认可）**：整面非答题区 = `top: frameTopLimit`、
`height: frameHeight`。A4 实测 `16.140 .. 280.924`，高 **264.848**。

```js
rest = F_BOT − cursor            // ⚠️ 不减 frameHeight
if (isLastFace && rest >= NOANSWER_MIN_H) {
  noAnswer = true;               // 画非答题区，钉到 F_BOT
} else if (isLastFace) {
  stretch = rest × STRETCH_K;    // <15mm：拉进最后一段的作答区
}
// 非最后一面：不画非答题区，红框由 fitFrames() 量测自然收口
```

| 面的角色 | 处理 |
|---|---|
| 最后一面（或凑偶的空白面），`rest ≥ 15mm` | 画**非答题区**，钉到 `F_BOT` |
| 最后一面，`rest < 15mm` | 不画；`stretch = rest × STRETCH_K` 加高**最后一段的作答区**，黑框底边随之变高、红框底边跟着下移（用户明确允许） |
| 非最后一面（正文还没排完） | 不画；红框按内容自然收口，空白留给后面的面 |

> ⚠️ **判据必须是 `rest = F_BOT − cursor`，不能减 `frameHeight`。**
> 踩过的坑：写成 `F_BOT − cursor − frameHeight` 时，一面**同时**有选择框和
> 非选择框（12 选择 + 2 题）会让 `cursor + frameHeight` 远超 `F_BOT`，
> `rest` 恒被夹成 0 ⇒ 非答题区**永远不画**、`stretch` 也永远算不出来。
> `frameHeight` 是「整段红框的高度常量」，不是「本面已占高」。
>
> ⚠️ 不能拿「红框当前底边」当 `rest` 的基准 —— 那要等 DOM 渲染完才知道，
> 而分页必须在这之前决定。`cursor` 是纯 JS 游标，分页阶段就有。

> ⚠️ 用户原话：「低于 15mm 请你将这块区域用答题区填充，即你可以直接将
> 红黑框往下拉，答题区可以留白。」以及「黑框跟着动」——
> 所以**不是**给红框加下内边距（那会让黑框与红框脱开），
> 而是加高**黑框内**最后一行 `.as-subj-body`。"""

assert old in s, 'MISS 7.5'
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('§7.5 已按定稿改写')
