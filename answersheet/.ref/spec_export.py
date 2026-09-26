import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = '答题卡排版规格.md'
s = io.open(P, encoding='utf-8').read()

old = """### 7.11 收口分流（`noAnswer` 二选一）

`paginator` 在收口处只做**一次**判定，`app.js` 的 `fitFrames()` 按同一个
标志分流，**不允许两处叠加**：

```
rest = F_BOT − cursor − frameHeight        // frameHeight 是常量（A4 264.848）
if (rest >= NOANSWER_MIN_H 15) { 画非答题区；该面 stretch = 0 }
else                           { 不画；stretch = rest × STRETCH_K }
```

`fitFrames()`：
- 本面有 `.as-noanswer` → 把它钉到 `frameBottomLimit`；
- 本面没有 → 量出真实 `contentBottom = max(黑框表格底, 下提示底)`，
  红框高 = `contentBottom + 下内边距 + 下边框`，再夹到 `frameBottomLimit`。

> ⚠️ **踩过的三个坑**：
> ① 在 `rest` 里又加了一份已决定的 `stretch` —— 结果红框底被估得过高、
>    `rest` 偏小，12 选择 + 1 题（真实剩余 86mm）被误判成「不够 15mm」，
>    本该画非答题区却去拉大答题区。`rest` 的判据必须是**未下拉**的量。
> ② `fitFrames()` 早期版本对「有非答题区的面」也去拉最后一行答题区，
>    导致非答题区顶低于红框底，重叠 4.6mm。
> ③ 曾把 `rest` 判据写成「一律下拉」（不看 15mm）—— 中继面被强行撑满，
>    红框/黑框被拉长，看着像排版错了。用户口径是
>    「**非最后一面**：≥15mm 画非答题区，<15mm 不画」。"""

new = """### 7.11 收口分流（`noAnswer` 二选一）

`paginator` 在收口处只做**一次**判定，`app.js` 的 `fitFrames()` 按同一个
标志分流，**不允许两处叠加**：

```
rest = F_BOT − cursor                      // ⚠️ 不减 frameHeight
isLastFace = 正文已排完
if (isLastFace && rest >= NOANSWER_MIN_H 15) { 画非答题区；该面 stretch = 0 }
else if (isLastFace)                         { 不画；stretch = rest × STRETCH_K }
else                                         { 不画；红框按内容自然收口 }
```

`fitFrames()`：
- 本面有 `.as-noanswer` → 把它钉到 `frameBottomLimit`；
- 本面没有 → 量出真实 `contentBottom = max(黑框表格底, 下提示底)`，
  红框高 = `contentBottom + 下内边距 + 下边框`，再夹到 `frameBottomLimit`。

> ⚠️ **踩过的四个坑**：
> ① `rest = F_BOT − cursor − frameHeight` 是**错的**。一面同时有选择框和
>    非选择框时（12 选择 + 2 题），`cursor + frameHeight` 远超 `F_BOT`，
>    `rest` 恒被夹成 0 ⇒ 非答题区**永远不画**、`stretch` 也永远算不出来。
>    `frameHeight` 是「整段红框的高度常量」，不是「本面已占高」。
> ② 在 `rest` 里又加了一份已决定的 `stretch` —— 结果红框底被估得过高、
>    `rest` 偏小，12 选择 + 1 题（真实剩余 86mm）被误判成「不够 15mm」，
>    本该画非答题区却去拉大答题区。`rest` 的判据必须是**未下拉**的量。
> ③ `fitFrames()` 早期版本对「有非答题区的面」也去拉最后一行答题区，
>    导致非答题区顶低于红框底，重叠 4.6mm。
> ④ 曾把 `rest` 判据写成「一律下拉」（不看 15mm）—— 中继面被强行撑满，
>    红框/黑框被拉长，看着像排版错了。用户口径是
>    「**非最后一面**：≥15mm 画非答题区，<15mm 不画」。

> ⚠️ 曾经实现过一版「把剩余空白按行摊进所有非选择题作答行」
> （`fill.pitch` / `fill.segs` / `subject.fillExtra`），用户在看过预览后
> 改口：**「现在整面都是非答题区的红框高度和位置非常好，就以这个为标准」**
> ⇒ 空白**归非答题区**，不再摊进行高。那套代码已删除，不要再改回来。"""

assert old in s, 'MISS 7.11'
s = s.replace(old, new, 1)

sec8 = """## 8. 本轮改动清单（文件 → 改了什么）"""
export = """## 7.15 PDF 导出（`js/app.js` 的 `exportPdf()`）

导出链路：逐张纸 `.toCanvas()` → **纵向拼成一张大画布** → 塞回 worker 的
`prop.canvas` → 走它自己的 `.toPdf()` 分页 → `outputPdf('datauristring')`。

### 7.15.1 必须 `position: static`、不能离屏、不能隐藏

| 包装方式 | html2canvas 结果 |
|---|---|
| `static`（正常文档流） | canvas 794×3368 ✅ |
| `absolute` / `fixed` | canvas 794×**0** ❌（导出的是一张白纸） |
| `visibility:hidden` / `opacity:0` | 整张画布渲染成纯白（nonWhite = 0）❌ |
| `left:-10000px` 离屏 | 高度 0 ❌ |

所以 `wrap` 放在正常文档流里、保持完全可见，另用 `.as-export-cover`
盖住整屏（遮罩在 `wrap` **外面**，不会进 PDF）。

### 7.15.2 拼接高度必须对齐 `o`，否则末尾多一张 sliver

html2pdf 的 `toPdf()` 切页逻辑（读源码 + 实测确认）：

```js
o = Math.floor(canvas.width * pageSize.inner.ratio)   // 每页像素高
s = Math.ceil(totalH / o)                             // 页数
// 最后一张：totalH % o !== 0 时
a.height = totalH % o;                                // ← 只有几像素
i = a.height * inner.width / canvas.width;            // ← 又按比例放大
```

> ⚠️ **最后一张不是被丢掉，而是被拉伸成一整页。** 只要 `totalH` 不是 `o`
> 的整数倍，PDF 末尾就会多出一张「把 1~2 像素拉满整页」的浅色纸。
> 实测：2 张纸 → **3 页**，第 3 页是一张 1588×2 的白纸。

关键是 `o` 比「整页像素」少 1：`inner.ratio = inner.height / inner.width`
是个浮点商，`floor(1588 × 1.4142857142857144) = 2245`，而单张纸是 **2246**。

```
canvas 1588×2246 → inner [210,297] ratio 1.4142857142857144 → o = 2245
H = 2246:  ceil(2246/2245) = 2 页，末页 slicePx = 1  ❌
H = 4490:  ceil(4490/2245) = 2 页，末页 slicePx = 2245 ✅
```

现在拼合画布取 `H = 张数 × o`，且每张纸 `drawImage` 进**恰好 `o` 像素**的槽位
（单张比 `o` 多 1 像素会被压掉，肉眼不可见，换来「页数不多不少」）。

> ⚠️ **不要用 `html2pdf().set(...).setPageSize()` 去探 pageSize。**
> `setPageSize()` 内部先取 `jsPDF.getPageSize(this.opt.jsPDF)`，
> 而 `opt.jsPDF` 在 `.toPdf()` 之前一直是**配置对象**、还没实例化，
> 于是 `prop.pageSize` 恒为 null，`probe0.prop.pageSize.px.height` 抛
> `TypeError: Cannot read properties of null (reading 'px')`。
> 表现是「`toCanvas` 全部成功，然后在拼接那一步炸掉」——**导出整个失败**。

### 7.15.3 图像类型：PNG + Flate（实测数据）

把同一张纸的 canvas 编码再解码回来，逐像素比对：

| 编码 | 像素变化 | 纯白被染灰 | 单页 PDF |
|---|---|---|---|
| `png` | **0**（无损） | 0 | 0.23 MB（开 compress） |
| `jpeg` 0.98 | 198 581 | 0 | 0.47 MB |
| `jpeg` 0.92 | 217 827 | **4 294** | — |

JPEG 的 8×8 DCT 会把 0.7mm 定位块的边缘糊出灰晕 —— 而 OMR 读的就是这些块。
所以用 **PNG**。

更重要的是 **jsPDF 必须开 `compress`**：

| 设置 | 单页 PDF |
|---|---|
| `png`，compress 关（jsPDF 默认） | **14.3 MB** ❌ |
| `png`，`compress:true, compression:'FAST'` | **0.23 MB** ✅ |

不开 compress 时 PNG 是**原样嵌入**，zlib 根本没跑。
「PNG 太大」这个印象是默认关闭造成的，不是 PNG 本身的问题。
现在两边都要：**无损 + 小**。

实测成品：

| 配置 | 页数 | 纸张 | 文件 |
|---|---|---|---|
| A4 双色 12 选择 + 2 题 | 2 | 210×297 | 336 KB |
| A4 黑白 0 选择 + 3 题 | 2 | 210×297 | 269 KB |
| A3 双色 40 选择 + 4 题 | 1 | 420×297 | 392 KB |
| A4 双色 300 选择 + 4 题 | 4 | 210×297 | 867 KB |

### 7.15.4 预览提示不能进导出件

`.as-face-guide`（面分隔虚线）和 **`.page-tag`**（「第 N 张 · A4 单面 ·
210×297mm」）都是预览提示，导出前必须 `display:none`。
`.page-tag` 原来漏掉了 —— 它挂在 `.page-wrap` 上、`top:-19px`，
虽然多数情况下在纸面之外被裁掉，但属于「碰巧没事」，必须显式隐藏。

### 7.15.5 导出件几何 = 预览几何（实测）

同一张 A4 双色 12+2 的导出 canvas 逐行扫出来的线与预览量测值：

| 要素 | 导出图像素扫描 | 预览量测 |
|---|---|---|
| 选择题红框 上/下 | 84.97 / 119.22 | 84.949 / 119.486 |
| 非选择题红框 上/下 | 124.31 / 249.67 | 124.274 / 249.957 |
| 非答题区 上/下 | 271.29 / 280.55 | 271.36 / 280.92 |
| 页脚底缘 | 287.89 | 288.115（下角标下缘） |

差 ≤ 0.4mm，量级是 **1 像素 = 0.132mm** 的量化误差，
说明导出**没有**重排、没有缩放漂移。

## 8. 本轮改动清单（文件 → 改了什么）"""

assert sec8 in s, 'MISS sec8'
s = s.replace(sec8, export, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('§7.11 修正 + §7.15 导出章节已写入')
