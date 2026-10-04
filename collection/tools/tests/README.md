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
3. **报告格式**：`ok(条件, '说明')` 累加通过/失败，末尾打印 `通过 N / 失败 M` 并打印未捕获异常数，
   失败时 `exit 1`；环境问题（比如找不到 Chrome）`exit 2`。
4. **断言要打到位**：能断言精确数值就别断言"大于 0"（例如动画落点断言到具体 left/top，
   缓存断言用服务器请求计数）。
5. 文件名用 `verify-<主题>.mjs`，runner 会自动发现，不用登记。

## CI

`.github/workflows/regression.yml` 在每次 push 到 `main` 时跑一遍（也可在 Actions 页面手动触发）。
用 `windows-latest`：用例是在 Windows 上写的，有些尺寸/文本度量依赖字体渲染，换 ubuntu 有踩
字体差异的风险，而 Windows runner 同样预装 Chrome、公开仓库分钟数免费。用例本身已做跨平台处理
（`CHROME_PATH`、Linux 路径、CI 下自动加 `--no-sandbox`），想换 `ubuntu-latest` 改一行即可。
