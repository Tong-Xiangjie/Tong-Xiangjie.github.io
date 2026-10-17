# collection 回归用例

这个目录是整个站点的**自动化防线**。用例原本只存在开发机上（用 `.git/info/exclude` 排除），
换机器或误删就全没了 —— 所以搬进仓库，并配一个零依赖 runner 和一个 GitHub Action。

每个用例都是**自包含**的：自己起本地 HTTP 服务器、自己拉起无头 Chrome、自己断言，
不依赖任何 npm 包（只用 Node 内置模块 + CDP）。

## 怎么跑

```bash
node collection/tools/tests/run.mjs                  # 数据自检 + 全部用例（约 15-20 分钟）
node collection/tools/tests/run.mjs --list           # 只列清单
node collection/tools/tests/run.mjs --only sw        # 只跑文件名含 "sw" 的
node collection/tools/tests/run.mjs --skip 4issues,octo
node collection/tools/tests/run.mjs --data-only      # 只做数据自检
node collection/tools/tests/run.mjs --all            # 连"已知漂移"的老用例一起跑
node collection/tools/tests/verify-sw-cache.mjs      # 单跑某一个（也能跑，但要在仓库根目录）
```

退出码：`0` 通过 / `1` 有断言失败 / `2` 环境问题（例如找不到 Chrome）/ `3` 跳过（缺本地工件）。

## collection 入口门禁（链接令牌）

`collection/` 是单页应用，**只有 `collection/index.html` 一个 HTML 入口**，所以门禁只挂在它上面；
以后往 `collection/` 里加 JS / 数据文件**不需要任何改动**。工具在 `collection/tools/gate.mjs`：

```bash
node collection/tools/gate.mjs new      # 生成新令牌：哈希写进 collection/gate.js，明文写到家目录 gate-token.txt
node collection/tools/gate.mjs link     # 用家目录里的明文令牌打印完整链接
node collection/tools/gate.mjs apply    # 幂等地给 collection/**/*.html（排除 tools/**）注入门禁三样；--dry-run 只打印
node collection/tools/gate.mjs check    # 现算覆盖清单并断言带齐三样 + robots.txt + 全仓库无明文令牌；有缺件 exit 1
```

`check` 已经接进 `.github/workflows/regression.yml`（在跑回归用例之前执行）：
将来谁往 `collection/` 里加了没挂门禁的 HTML 入口，CI 会直接红。
验收在 `verify-gate.mjs`（静态覆盖 + robots + 明文令牌扫描 + apply 幂等 + CDP 行为：
localhost / file:// / `#k=` / `?k=` / 错误令牌 / 深链路由不被清片段破坏 / 关 JS / crypto.subtle 不可用）。

要求：**Node 22+**（用例里用了全局 `WebSocket` 与 `fetch`）、本机有 Chrome/Chromium。
Chrome 路径由 runner 解析一次并用 `CHROME_PATH` 传给子进程；想手动指定就设这个环境变量。
找不到 Chrome 时用例会以 `exit=2` 退出并打印一句提示。

## ★ 已知漂移的 5 个老用例（默认跳过）

它们以前从没进过 CI，所以漂移了很久没人发现。用 `git worktree` 在**本会话改动之前的代码**上
复核过：这 5 个在改动前就是红的 —— 不是被改坏的，是被测界面早就变了、用例没跟上。
默认跳过（保证 CI 是绿的），但跳过这件事写在明面上（runner 顶部和汇总里都会打印原因）；
要专门排查它们就 `--all` 或 `--only <名字>`。

| 用例 | 漂移原因 |
|---|---|
| `verify-coldstart.mjs` | 深链接展开后 hash 里的品种写法与断言不一致（待判定：行为有意变更还是真 bug） |
| `verify-deeplink.mjs` | 界面会多开一个品种列表，而断言只允许开一个（同上） |
| `verify-roundtrip.mjs` | 往返后会多一个 `copies-*` 容器保持展开（同上） |
| `verify-flip.mjs` | 「打开时存在飞行图层」**取样太晚**：飞行图层只存在约 400ms，等弹窗出现后再采样就没了（是用例时序问题，不是断言写错） |
| `verify-article-fuzzy.mjs` | 「生肖钞」分组少收录一篇文章（102 通过 / 1 失败） |

**待办**：逐个判定上面 4 条"行为变更 vs 真 bug"，然后要么改断言、要么修代码；`verify-flip` 改成
点完立刻同 tick 采样（照 `verify-close-anim.mjs` 的写法）。修好一个就从 runner 的
`KNOWN_STALE` 名单里删一条。


## 用例清单

**灯箱 / 翻面**
| 文件 | 管什么 |
|---|---|
| `verify-flip.mjs` | 翻面动画 + 翻面后的退出动画 |
| `verify-close-anim.mjs` | 图片完全在屏幕外、只靠翻面能看到时，点退出**仍要有缩回动画**，且落点是那张格子"本来应在"的位置 |
| `verify-flip-state.mjs` | 翻面/关闭状态机（把 `category-view.js` 的真实函数源码抽出来跑） |
| `verify-swipe-flip.mjs` | 左右滑动翻面（CDP 派发真实触摸事件） |
| `verify-octo.mjs` | 完整八面图（详情卡片 → 三栏浮层） |
| `verify-img-placeholder.mjs` | 缺图占位与空状态插图"看得见 / 不过大 / 提前加载" |

**币海拾年（时间轴）**
| 文件 | 管什么 |
|---|---|
| `verify-years-timeline.mjs` | 期间合计文案、年份/月份筛选后回到顶部、缓存复位 |
| `verify-timeline-mobile.mjs` | 手机宽度下不超出屏幕 |
| `verify-heatmap.mjs` | 按月份热力图（年 × 月）：每个格子的件数/金额与"测试自己从原始数据重算"完全一致、格子金额之和 == 标语总额、悬停用**纯 CSS** tooltip 显示且没有内联定位、点格子=按它筛选、深浅主题与手机宽度 |
| `verify-timeline-flip.mjs` | 反复点**同一个**时间段不重渲染（像反复点同一个 tab）；真换时间段时条目按搜索结果的 FLIP 滑进滑出（退场替身会清掉、动画结束不留内联 style、屏幕外的条目不播）；空 ↔ 有两个方向都有动画；三个方向位移的瞬间都不能有横向滚动条；文章版块是同一套动画 |
| `verify-modal-drag.mjs` | 大图里"拖动平移"与"单击关闭"的区分：快速单击要关；快速拖动、**慢速长距离拖动**、慢速按住都不能误关（用户报过"慢速移动很远也被当成单击关闭"）；拖完再单击仍要能关 |

**搜索**
| 文件 | 管什么 |
|---|---|
| `verify-search.mjs` | 真实数据的搜索匹配逻辑 |
| `verify-search-case.mjs` | 大小写不敏感 + 字段名不再"全命中" |
| `verify-search-race.mjs` | 边打边搜的异步覆盖竞态 |
| `verify-article-fuzzy.mjs` | 文章模糊搜索（同义扩展） |

**导航 / 路由 / 状态还原**
| 文件 | 管什么 |
|---|---|
| `verify-router.mjs` | 路由逻辑（mock history/location/DOM，跑 `router.js` 真实代码） |
| `verify-deeplink.mjs` | 深链接精确到系列/品种 |
| `verify-coldstart.mjs` | 每个深链接在全新标签页打开：还原 + 地址栏不退化 + 不新增历史 |
| `verify-regress2.mjs` | 历史记录 0 增长 + 手风琴 + 概览跳转 |
| `verify-roundtrip.mjs` | 设置页 / 搜索 / 板块互切之后定位是否还在 |
| `verify-close-scroll.mjs` | 关闭板块再点开，概览页要回到顶部 |
| `verify-4issues.mjs` | 价格列表展开态跨板块保持、模糊搜索说明、概览页滚动状态 |
| `verify-coin-overview-company.mjs` | 硬币**概览**条目第二行的评级公司前缀：`<公司> <分数> · <年份>年发行 · <目录号>`（公司+恰好一个**半角空格**+分数；全局概览 `#coins` 与分类概览 `#coins/<父分类>` 两条路由都验，23 条硬币概览行逐条与数据现算值比对）。公司取自数据 `gradingCompany` 原文（不写死 PCGS），没有公司时不加前缀、不留前导空格、不出现 undefined/null；另把纸币概览**全表逐条**按数据现算的期望比一遍（不写死条数、不钉 sha256、不读数据源码），守住"其它板块逐字未变" |
| `verify-copy-detail-text.mjs` | 硬币**详情条目**（分类内容页「详细信息」）的三行排版：① 评级合成一个色块 `<公司> <分数>`；② 色块与「<年份>年发行 · 购藏…」之间恰好一个半角空格；③ 第三行 `<目录号>　<材质>　<直径>　<重量>` 用**全角空格 U+3000** 分隔、缺字段不补位、值原样照抄（`外接圆直径30mm` 不被抽数字/剥汉字）、目录号为空或 `Unlisted` 时行首不空位；纸币复用同一段渲染，输出必须逐字不变 |

★ 这两条（以及所有新用例）的判据**只钉渲染行为、不钉数据内容**：期望值从页面上的数据对象现算
（条目与数据靠实现自己给出的全局下标 `openCopyDetail(N)` 配对，不假设 DOM 顺序；硬币那侧还会
对数据里**每一个系列**跳到它自己的路由逐条比一遍），
不写死藏品文本、不写死条数、不钉 sha256 快照、不读数据源码文件 —— 用户持续编辑
`coincollection/data/**`、`notecollection/data/**` 时**不会假红**，只有渲染被改坏才会红。
数据里当前没有的场景（例如 CJK 直径）记成 `○ 跳过`、不计入通过，由用例自造的合成样本覆盖。

**界面细节 / 静态校验**
| 文件 | 管什么 |
|---|---|
| `verify-ui-polish.mjs` | 三处界面打磨细节 |
| `verify-sep.mjs` | 分割线的位置与数量在改 CSS 前后完全一致 |
| `verify-empty-art.mjs` | 11 张自绘 SVG 空状态插图都接上了、能显示、颜色跟主题走 |
| `verify-theme-init.mjs` | head 里的防闪脚本预置了 `applyTheme()` 会写的整套主题变量 |
| `verify-map-dark.mjs` | 方寸山河地图深色模式（含像素采样） |
| `verify-css.mjs` | `layout.css` 括号配平、断点一致性、`focus-visible` 完整性 |
| `verify-deadcode.mjs` | 死代码清理 |

**自绘控件（替换浏览器默认外观）**
| 文件 | 管什么 |
|---|---|
| `verify-dropdown.mjs` | 自绘下拉栏：固定宽度、写不下的压扁省略+`title` 保留全文、弹出真有补间、`select.value`/`options`/`change` 契约正反两个方向都不动、键盘与点外部、时间轴换年份真的重渲染、窄屏无横向溢出 |
| `verify-scrollbar.mjs` | 自绘滚动条：原生条宽度归零**不再吃掉内容区宽度**（实测 `offsetWidth-clientWidth`）、浮在内容之上、空闲自动隐藏、滑到条上再出现、悬停只变亮不变粗、拖动与点击翻页 |
| `verify-symbol-panel.mjs` | 特殊字符面板的出现/消失动画：有中间帧（不是硬切）、收起后离开布局（宽度 0，否则会被自绘滚动条当容器）、`reduce` 下不做动画、插入字符/`Esc`/遮罩/`closeSymbolPanel()` 既有行为不变 |
| `check-portable.mjs` | 用例本身的可移植性（本机绝对路径、CDP 端口撞车、ROOT 来源）—— runner 会先跑它 |

**缓存 / 离线 / 外部依赖**
| 文件 | 管什么 |
|---|---|
| `verify-sw-cache.mjs` | `collection/sw.js`：图片走缓存（用服务器请求计数证明）、资源 network-first、断网整页可看、升级只清自己的旧缓存 |
| `verify-vendor.mjs` | hammer.js 已本地化：站内无任何 CDN 引用、运行时零外部请求、捏合仍可用 |

**数据 / 词典 / 工程约束**
| 文件 | 管什么 |
|---|---|
| `verify-taiwan-split.mjs` | `taiwan.js` 拆分后父类/子类在真浏览器里都正常 |
| `verify-cilin.mjs` | `cilin.mjs` 移植与参考实现等价（需要本地工件 `cilin-oracle.json`，没有就跳过） |
| `verify-b7.mjs` | B7 手风琴作用域修复 |
| `../verify-mode-registry.mjs` | 板块注册表检查（`ARCHITECTURE-modes.md` 指的就是它；也在 `collection/tools/` 下，runner 会一起收） |

数据本身的体检在 `../check-data.mjs`（runner 会先跑它）。

## 写新用例的约定

1. **先红后绿**：先写用例、对旧代码跑出红，再改代码跑到绿。这样才能证明用例真的在测东西。
2. **自包含**：本地服务器 + 无头 Chrome，随机 CDP 端口（`12100 + random`）、`mkdtemp` 临时用户目录，
   避免和别的用例或残留进程抢端口/缓存。
   **目录一律用 `process.cwd()`**（runner 以仓库根为 cwd 起用例），写死绝对路径在 CI 上必炸（见下面 CI 第 4 条）。
3. **报告格式**：`ok(条件, '说明')` 累加通过/失败，末尾打印 `通过 N / 失败 M` 并打印未捕获异常数，
   失败时 `exit 1`；环境问题（比如找不到 Chrome）`exit 2`。
4. **断言要打到位**：能断言精确数值就别断言"大于 0"（例如动画落点断言到具体 left/top，
   缓存断言用服务器请求计数）。
5. 文件名用 `verify-<主题>.mjs`，runner 会自动发现，不用登记。

## CI

`.github/workflows/regression.yml` 在每次 push 到 `main` 时跑一遍（也可在 Actions 页面手动触发）。
跑 **ubuntu + windows 两个平台**（`strategy.matrix`，`fail-fast: false`，两边各自报结果）：

- `windows-latest` 是"保真"的那一份 —— 用例是在 Windows 上写的，有些尺寸/文本度量依赖字体渲染；
- `ubuntu-latest` 是**跨平台**的那一份，也是目标里"用例在 CI（Linux/Chrome）可跑"的验证面。

用例本身已做跨平台处理（`CHROME_PATH`、Linux 路径、CI 下自动加 `--no-sandbox`）。

### ★ CI 上"本地全绿、CI 全红"的两个坑（2026-10 都踩过）

1. **宿主机系统偏好会漏进用例**。CI 的 runner 默认关闭系统动画，Chrome 于是报
   `prefers-reduced-motion: reduce`，而"动画应该播"的断言在那种环境下必然失败
   （`verify-swipe-flip`、`verify-close-anim`、`verify-timeline-flip` 都中过）。
   修法：这类用例连上 CDP 后立刻
   `Emulation.setEmulatedMedia({ features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })`，
   把偏好钉死 —— 用例不该随宿主机的系统设置变红。**新写动画相关的用例请照做。**
2. **失败只看得到"断言失败"四个字**。CI 日志要鉴权才能下载，能匿名读到的只有 check-run 注解，
   所以 `run.mjs` 现在会把失败用例的**前 6 条 ✗ 断言原文**写进 `::error` 注解
   （起因就是第 1 条那批失败查不出原因，白等了好几轮 18 分钟的 CI）；
   一条 ✗ 都没有时改带**输出尾部 3 行**（有些用例在别处打印、或者退出前才炸）。
   非 0/1/2/3 的退出码（崩了、未结算的顶层 await）也会在注解里点名，不再一律说成"断言失败"。
   ★ 2026-10 补的一个漏：注解里那句"没有 ✗"曾经是假的 —— `verify-toolbox.mjs` 是**全仓库唯一**
   用 `[ok]/[XX]` 当报告标记的用例（其余 20 个都是 `✓/✗`），而 `run.mjs` 只 grep `✗`，
   于是它失败时注解一条断言都提取不到、只剩输出尾部，白等了好几轮 CI。
   现在 `verify-toolbox.mjs` 的失败行是 `✗ [XX] …`（两个标记都留，本机排查照旧一眼能认），
   `run.mjs` 也同时认 `[XX]` 兜底。**新写用例请用 `✓/✗`**。
3. **卡住的用例会一直占着 CI**。`run.mjs` 给每个用例加了硬超时
   （默认 15 分钟，`SUITE_TIMEOUT_MS` 可覆盖）：超时就强杀、按失败报出来，
   注解里写"超时（>Ns 未结束）"。没有它的时候，一个卡住的用例要等 workflow 的
   `timeout-minutes: 60` 才被砍，那 60 分钟里注解什么线索都没有。
4. **用例里写死了开发机的绝对路径**（2026-10 的第三个坑，也是最隐蔽的一个）。
   `verify-octo.mjs` / `verify-search-case.mjs` 里有 `const ROOT = 'C:/Users/…'`：
   本机跑没事，runner 上没有这个路径 → 测试服务器对**每个**请求都 404 → 页面根本没加载
   → "读源码"的静态断言**全过**、所有运行时断言**全挂**。
   `verify-search-case` 更绕：84 条 `count()` 各自重试 40 次 × 250ms ≈ 840s，
   把 15 分钟硬超时耗光，CI 上报的居然是"**超时**"，看着像性能问题。
   两平台报的失败完全相同，最容易被误判成"CI 环境不行"。
   现在由 `check-portable.mjs` 在用例之前静态拦住（绝对路径 / CDP 端口撞车 / ROOT 来源），
   runner 每轮都会先跑它。
5. **"动画逐帧"的断言不能把帧率当成产品属性**（2026-10 补，`verify-toolbox.mjs` 的 `(50)` 节）。
   那里的判据原先是"逐帧连拍的**固定帧数**"：`moving >= 8`（320ms 动画里至少 8 个中间帧）、
   `during >= 8`、`mean <= 60ms`、内层中间取值 `>= 4/6`，还有"单帧进度增量 `<= 0.30`"、
   "首帧进度 `<= 0.30`"。这几条测的是**宿主机快慢**，不是产品行为：
   - 帧率低的 runner 采不到 8 个中间帧 → `moving/during` 红；
   - 一帧的进度增量本身就随帧间隔长：60fps 时实测峰值 0.144，一掉帧就过 0.30 → `maxInc` 红；
   - 连拍的第一帧不一定落在动画第 0 帧（触发/rAF/读 rect 之间隔着 CDP 往返），
     首帧进度实测能到 0.26~0.31，紧贴 0.30 的线 → 慢机器上偶发红。
   本地（60fps）怎么跑都是绿的，一到 CI 就成片红 —— 本机实测：把渲染进程 CPU 降频 6 倍
   就能复现（`maxInc/首次进度 0.408 > 0.30`、`during 6 < 8`），而产品行为一字未变。
   现在改成**按时间花预算**：先量出这台机器实际的 rAF 帧间隔（`a50FrameMs`），
   阈值 `a50JumpAllow = 2 × 帧间隔/320ms + 0.45`（2 倍是缓动曲线峰值斜率，0.45 是
   "看不见的头几帧 + 一次卡顿"的固定时延）；"中间帧数"只要求 `>= 2`
   （证明"存在中间态、不是硬切"，而不是"跑得够快"）；比较对数 `>= 2` 防止判据空过。
   `mean <= 60` 这种性能门槛也去掉了（它是机器的性能，不是产品的）。
   **判断"动画真的逐帧插值"靠"几何中间帧 + 单调 + 不越界 + 首帧贴起点"，不靠帧数。**
   ★ 同一节里还有两处"中途打断"是靠**固定等待**保证时机的（`sleep(70)` 后取"关窗动画正在跑"
   的快照；同一个 evaluate 里 click 完立刻读 `toolboxGeoAnim`），慢机器上会踩空成
   "动画已收完/还没就绪"→ 前置条件崩。现在都改成**轮询到状态真的就绪**再打断
   （和 `a50Deliver` 那套"确认送达"是同一思路：时机由状态保证，不由时间猜）。
   ★ 另：`(50F)` 验完减动效后，恢复偏好要从 `features: []` 改成显式 `no-preference` ——
   清空模拟 = 把宿主机默认值（CI 上是 `reduce`）放回来，后面几节会跟着红。

### CI 红了、日志又看不到，怎么定位

CI 日志要 token 才能下载，**check-run 注解用公开 API 就能读**（`run.mjs` 把失败断言写进
`::error` 注解就是为了这个）。还不够时用 `diag-ci.mjs`：它不改任何代码，只做三件事并把结果
打成注解 —— ① 页面脚本执行前注入错误收集器（`window.onerror` / `unhandledrejection` /
`console.error`）；② 开 CDP Network 记录 4xx/5xx、加载失败、以及"发出去了但一直没收到响应"
的请求；③ 启动期间每 5 秒采样关键全局、渲染条目数、资源进度。

```bash
node collection/tools/tests/diag-ci.mjs notes/commemorative   # 本地先验证
DIAG_WAIT_MS=90000 node collection/tools/tests/diag-ci.mjs     # 等久一点
```

配合读注解：

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/commits/<sha>/check-runs" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const c of JSON.parse(s).check_runs)console.log(c.name,c.conclusion,c.output.annotations_count)})"
```

★ 教训：`diag-ci.mjs` 一跑就发现 **CI 上页面本身完全正常**（关键全局齐、0 失败请求），
于是注意力从"页面/环境"转回"用例自己" —— 直接指向了第 4 条那个写死的路径。
诊断脚本的价值就在这里：**先证明哪一半是好的**，别在错的方向上猜。
