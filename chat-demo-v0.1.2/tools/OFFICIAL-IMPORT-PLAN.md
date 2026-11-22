# 导入 DeepSeek 官方导出：结论与方案

日期：2026-11-22

---

## ★ 黑屏事故与修复（后来补记，优先级最高）

**症状**：导入分批包之后，随便点开任何一个对话都黑屏 ——
`div#root` 被清空（`rootChildren: 0`），侧栏也一起消失。

**根因**：第一版转换器只在**有附件**时才给用户消息写 `files` 字段。
而应用的渲染里直接读 `n.files.length`：

```js
n.files.length > 0
k = !u && (v.trim() !== '' || n.files.length > 0)
```

`undefined.length` →
`TypeError: Cannot read properties of undefined (reading 'length')`
（`main.6fd9c886.js:2:120632`，正好是 `n.files` 里那个 `e`）。
应用**没有错误边界**（`componentDidCatch` / `getDerivedStateFromError` 全库 0 命中），
异常直接把整棵 React 树卸载。

**官方数据的不变量**（逐字段核对过 `chat-demo-导出-2026-11-22105216.json`）：

| 角色 | 字段 | 覆盖率 |
|---|---|---|
| user | `files` | **39/39**（其中 33 条是空数组）|
| assistant | `blocks, createdAt, id, latestReminder, model, parentId, prefix, role, search, status, thinking` | **62/62** |

所以正确做法是**无条件**写这两个字段（没附件就是 `files: []`）。

**修复分三处**：

1. `convert-deepseek-export.mjs` —— user 消息**总是**写 `files`；
   assistant 消息写 `latestReminder`（`WEEKDAYS` + `buildReminder()`，
   格式 `YYYY-MM-DD,星期X,,Web,中文`，与官方一致，城市留空）
2. `patch-batches.mjs` —— 就地修补**已生成**的批包（本次补了
   user `files` 15475 处、assistant `latestReminder` 17500 处，源里找不到的 0 条）
3. 桥接层 `repairLocalSessions()` + 「修复数据」按钮 —— 修**已经导进库**的坏数据

**为什么必须单独做修复函数，不能"重新导入补好的包"**：
`planImportMerge` 的规则是 `文件.updatedAt > 本地.updatedAt` 才覆盖，
而包里是**官方时间戳**，与库里的完全相等 → 判为"不更新"而跳过，坏数据永远修不好。
改包里的 `updatedAt` 又会打乱侧栏按时间排序。
所以 `repairLocalSessions()` **就地补字段、时间戳一律不动**，且幂等。

**验证**（`tools/verify-repair.mjs`，故意造坏数据走真实 UI）：

| 阶段 | root 子节点 | 助手气泡 | 用户气泡 |
|---|---|---|---|
| 修复前 | **0**（黑屏复现）| 0 | 0 |
| 修复后 | 1 | 1 | 1 |

**附带发现**：修复用的 `writeBack()` 只 `put`、**从不删除**；
它还会按 `m.files` 重算 `sessionSummaries.fileIds`，
顺带把附件归属也修正了。

### 批量导入（同样后来补记）

桥接层原来的「导入」input 没有 `multiple`，且只用 `files[0]`；
官方自带的「导入历史对话」input 也一样（`accept: ".zip,…"`、无 `multiple`、取 `files[0]`）。
所以**原生一次只能选一个文件**，批量只能做在桥接层。

新增「批量导入」按钮：多选 → 顺序导入 → **只在最后刷新一次**
（原来每导一个包就刷一次，98 个包要刷 98 次）。
进度回调**限流 400ms** —— `importBundleFromText` 的 onProgress 是每写一条记录
回调一次，而 `setMessage + rerender` 会整块重建面板 DOM，不限流会把界面拖死。

**验证**（`tools/verify-batch-import.mjs`）：一次选中 3 个包（共 6 个对话），
侧栏立刻变成 6 项，只刷新一次。

---

## ★★ 最终结论：合并进官方 ZIP 做不到 ★★

**应用的导入器要求 ZIP 与官方导出器产出的字节结构完全一致 —— 任何改动，哪怕
只在末尾多 1 个字节，都会被拒绝。**

先前的结论"把现有对话并进官方 ZIP 再走原生导入"是**错的**，已作废。

### 决定性证据

全部在无头 Edge 里走应用**真实的**导入 UI（设置 → 数据管理 → 导入历史对话）：

| 待测文件 | 说明 | 结果 |
|---|---|---|
| **官方原包** | 一个字节没动 | ✅ **已导入 2763 个对话** |
| 官方原包 **+1 字节** | 末尾加 1 个 `0x00`，**不改任何字段** | ❌ 失败（`parses=0`，重跑两次都失败） |
| 官方原包 + 21 字节 EOCD 注释 | ZIP 规范允许 | ❌ 失败（`parses=0`） |
| 官方数据 0 改动、只重新打包一遍 | 内容一比一 | ❌ 失败 |
| 官方原包删到 3 个会话（只删不加） | 重新打包 | ❌ 失败 |
| 官方原包 + 1 个本地会话 | 常规重打包 | ❌ 失败 |
| 二进制级追加（官方字节全部原样保留） | `append-into-official-zip.mjs` | ❌ 失败 |
| 索引条目**原样复用官方字节** + 只多一条记录 | 最保守的改动 | ❌ 失败 |
| 手写 ZIP，6 种 flags/method/描述符组合 | 逐个试（`try-zip-variants.mjs`） | ❌ 全部失败 |

`官方原包 +1 字节` 这一条最关键：内容与校验字段**完全没变**，只是文件长了 1 字节，
应用就拒绝。所以这不是"我哪里写错了"，而是导入器的硬性要求。

### 根因（反编译核对）

应用自己的 ZIP 解析器要求「中央目录结束位置 == EOCD 位置」严格相等
（`925.548cc1b9.js` 里是 `l + n === a` 这种严格判等）。文件长度一变这个等式就不成立。

### 已排除的干扰项（都查过，都不是原因）

- 条目顺序（`manifest.json` 是否排第一）
- 空的 `fragments` 数组（已补占位文本）
- 压缩方法 / 通用标志位 / 数据描述符 / extra 字段 / UTF-8 位
  （官方 3766 条全部 `flags=0x8` 数据描述符，extra 全部为 0）
- CRC 与解压正确性（`zip-verify-crc.mjs` 逐条解压比对：3766 条全部一致）
- 条目名反斜杠（全部正斜杠）
- 索引与会话 id 数量对不上

### 因此现在的选择

- **方案 A**：原生导入 `官方原包\deepseek_data-2026-11-22.zip` —— 保真最高，
  但应用导入前会**清空现有对话**，所以现有的 10 个对话要先导出保存。
- **方案 B**：用 `分批包\*.json` 走桥接「合并导入」—— **绝不删除**，现有对话安全，
  代价是丢 `TIP`/`PARTIAL_FILE_READ`，且会话量大时渲染可能空白。

### 新增的排查工具

| 工具 | 用途 |
|---|---|
| `probe-native-import.mjs` | 起本地服务 + 无头 Edge，注入 ZIP 走应用真实导入 UI，报告结果与解析计数 |
| `zip-validate-app-rules.mjs` | 按应用**自己的**规则逐条校验 ZIP（标志位/method/偏移/重名/路径） |
| `zip-verify-crc.mjs` | 逐条解压并校验 CRC 与长度 |
| `append-into-official-zip.mjs` | 二进制级追加合并（结论：应用仍拒绝，留作证据） |
| `zip-writer.mjs` | 手写 ZIP 写入器，可逐条控制 flags/method/数据描述符 |

---

## 下面是先前的过程记录（部分结论已被上面取代）

## ★ 最重要的根因：助手消息的字段名是 blocks，不是 content ★

这个 bug 让我绕了很久，记在最前面。

```js
用户消息 → { content: "字符串", createdAt, files, id, parentId, role, selectedChildId }
助手消息 → { blocks: [ {type:'text',…}, {type:'thinking',…} ],
            createdAt, id, latestReminder, model, parentId, prefix,
            role, search, serverModel, status, stopReason, thinking, usage }
```

我一开始按"块数组放 content"写，结果库里数得出来、页面上一个字都没有。
连续误判成：
1. 以为自定义类型 `ls_tool` 不被支持 → 换成 `{type:'search'}` 块
2. 以为 `{type:'search'}` 也不被支持 → 换成原生成对块
3. 甚至怀疑无头浏览器不渲染对话

**全都是假象。** 真相是字段名错了，"无头不渲染"那个结论也是错的
（同一个验证脚本，改完字段名后 `mainEls: 1`、`thinkEls: 1`、`innerTextLen: 1698`，
页面正常渲染，并且成功匹配到「搜索到 2 个网页」）。

证据来源：用户真实导出 `chat-demo-导出-2026-11-22084937.json` 的字段统计，
以及一次 `TypeError: Cannot read properties of undefined` —— `m.content` 是 undefined。

教训：**验证脚本崩在 undefined 上时，先怀疑自己读错了数据结构，再看别的。**

## 一句话结论

**官方导出不需要转换。** 应用内置的「导入历史对话」就是解析
`export_format_version: 3` 的，保真度比我们自己的转换器更高。

## 证据（读打包代码得到，不是推测）

`static/js/async/925.548cc1b9.js` 里的 `checkArchiveFormat` / `importArchive`：

```js
// 版本校验：只拒绝**更高**版本
let t = l(e).export_format_version;
if (typeof t === "number" && t > 3) → "backupNewerVersion"   // 文件版本过新
if (t !== 3)                          → "backupInvalidVersion" // 文件版本无效
```

用户的导出：`manifest.json` = `{"export_format_version":3}` → **通过校验**。

## 存放位置

已按用户要求整理到 **D 盘**：

```
D:\ChatBackup\
├─ 说明.md                                   ← 目录说明与操作步骤
├─ 官方原包\deepseek_data-2026-11-22.zip      399.1 MB（官方原始 ZIP，保底）
├─ 已合并\deepseek-merged-含现有3个对话.zip    382.0 MB（★ 原生导入用）
├─ 分批包\deepseek-official-0N.json ×7        590.7 MB（合并导入用）
└─ 工具\                                     三个脚本 + minimal-cdp.mjs
```

## 两条路

> ⚠ 下表"路 A"用 `已合并\...zip` 的说法**已作废**（见本文开头的最终结论：
> 重打包的 ZIP 一律被拒）。现在路 A 只能用**官方原包**，且会清空现有对话。

| | 路 A 原生导入 | 路 B 合并导入 |
|---|---|---|
| 用哪个文件 | `官方原包\deepseek_data-2026-11-22.zip` | `分批包\*.json` ×7 |
| 保真度 | 最高（应用自己的解析器） | 丢了 TIP / PARTIAL_FILE_READ 等 |
| 对已有对话 | **覆盖**（所以要先导出保存现有对话） | 按 id+updatedAt 合并，绝不删 |
| 索引数量 | 2763 条 | 2763 + 现有 |

## 大规模时页面渲染会空白（实测规律，未定论）

无头 Edge 里测下来的规律 —— **导入永远成功，渲染跟数据量有关**：

| 包 | 会话数 | 附件数 | 大小 | 页面渲染 |
|---|---|---|---|---|
| 小测试包 | 30 | 32 | 8.8 MB | ✅ `搜索到 2 个网页` |
| 中等包 | 135 | 152 | 70 MB | ✅ `搜索到 4 个网页` |
| 重附件包 | 6 | 181 | 115 MB | ❌ 空白 |
| 大对话包 | 1618 | 0 | 42 MB | ❌ 空白 |

失败时侧栏条目数正确（1618 项），主区空白（`mainEls: 0`、`bodyLen: 23`）。
两个失败包的**库内校验全部通过**：附件字节 181/181 精确、分支链 6 好 0 坏、
`linearMessages` 全通、页面异常 0。

所以是"应用渲染被数据量压住"，**不是数据坏了**。可能原因：无头浏览器内存受限。
**不能排除真机也慢** —— 这一点没有定论，如实记录。

实践建议：分批导入（每批几百会话）、导入后刷新、等侧栏条目出现再点开。

### ★ 补充发现：压住渲染的是**会话条数**，不是体积

同一批数据里对比：

| 包 | 会话数 | 附件数 | 大小 | 页面渲染 |
|---|---|---|---|---|
| 中等包 | 135 | 152 | 70 MB | ✅ 正常 |
| 大对话包 | **1618** | 0 | 42 MB | ❌ 空白 |

42 MB / 1618 个会话会空白，而 70 MB / 135 个会话正常 —— 说明**会话条数**
才是关键（每个会话可能都要建 DOM）。所以切包时按**会话数**切更可靠。

另外附件分布极不均匀：实测头 30 个会话就带 290 个附件、177 MB。
所以 `convert-deepseek-export.mjs` 现在同时支持两个上限
（`--max-sessions=N` 与 `--max-mb=N`），谁先到就切，用哪个都行。

## 打包 ZIP 的坑：条目名必须用正斜杠

Windows 上两个"方便"的命令都会写成反斜杠，而 ZIP 规范要求正斜杠：

```
Compress-Archive                → [chat_sessions\xxx.json]   ← 错
ZipFile::CreateFromDirectory    → [chat_sessions\xxx.json]   ← 同样错
官方原包                          → [chat_sessions/xxx.json]   ← 对
```

后果隐蔽：**不报错**，导入显示成功，但一个会话都找不到。
`merge-into-official-zip.mjs` 已改成手工逐条 `CreateEntry` 并强制换成 `/`。
验证方法：读 ZIP 的 `Entries[i].FullName`，确认没有反斜杠。

## 另一处自己制造的假象：检查脚本错了两次

排查"并进去的会话对不对"时，我两次得到错误结论：

1. 用 `Where-Object { $_.FullName -eq "chat_sessions/$id.json" }` 查 ZIP 条目，
   结果是"缺失 2766 个" —— 当时 ZIP 真的用了反斜杠，但也**没先确认分隔符**就下了结论
2. 改用 Select-Object -Last 4 看"新增的 3 条"，**抓到了官方包里的那条**
   （`51e2d928`「用户为AI助手起名」），一度以为并错了、消息 id 偏移了

真相：那条本来就是官方原包里的，它的消息 id 从 1 开始是官方数据自身如此。
教训：**查"我加的东西对不对"时，先确定查询条件真的只命中我加的东西。**

## 导入后必须刷新页面

实测：导入直接写 IndexedDB，应用**启动时**才读进内存。
不刷新 → 侧栏 `itemEls: 0`；刷新后 → `30`。两条路都成立。

## 官方导出的数据缺口（不是转换器的问题）

- 1000 个附件原件都是图（png/webp/jpg/svg）。
- 另有 **2380 个附件引用** `export_path` 是空字符串 —— 官方没导出内容，只有元信息。
- 官方导出不记录模型名。

## 合并工具的行为（`tools/merge-into-official-zip.mjs`）

把现有对话转成官方格式追加进 ZIP，严格照 `925.548cc1b9.js` 的校验写：

- 版本正好 3；`id` 不含 `/` `\`、不是 `.` / `..`（域名用 `history-` 前缀天然合法）
- `inserted_at`/`updated_at` 必须匹配 `YYYY-MM-DDTHH:MM:SS[.mmm]Z`
- `current_message_id` 是 safe integer，指向当前分支末端；`parent_id` 数字，根为 `null`
- **只带当前分支** —— 官方导入器分支校验严（同 parent 下同 role 双胞胎直接
  `backupInvalidBranches` 整个导入失败），不冒险
- 附件：**只有 `is_image=true` 才设 `export_path`**（应用只校验图片），
  路径 `chat_sessions/<sid>_files/<fileId>_<name>`（NFC），非图片不带以免 `backupInvalidFiles`
- 索引条目数必须与 JSON 数一致，否则 `backupIncomplete`

跑过的实例：官方 2763 + 现有 3 = 索引 2766，输出 382.0 MB。

## 转换器现状（路 B 用）

`tools/convert-deepseek-export.mjs`：
- 输出 `chat-demo-export@1`，按 `--max-mb` 分批（默认 120，实测用 80）
- 全量 2763 会话、34981 条消息（含 927 条旧分支保留但不显示）、1000 个附件
- 已验证：库内结构、附件字节数、幂等（二次导入 `imported:0 skipped:30`）、
  **页面真实渲染出「搜索到 2 个网页」**、思维链渲染出来、搜索块用原生成对块
- 搜索步骤的 `kind` 必须是 `deep_search`（不是 `search`）：应用自己的导入器在
  有 `TOOL_OPEN`/`TOOL_FIND` 时就是这么选的，而这决定文案是
  「已阅读 N 个网页」还是「搜索到 N 个网页」
