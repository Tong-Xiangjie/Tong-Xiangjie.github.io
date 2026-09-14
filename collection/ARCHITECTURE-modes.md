# 怎么给这个站点加东西（收藏/collection 部分）

这份文档只回答一件事：**新增内容时该改哪里、验证什么。**
目标是不看源码也能加对，并且不会漏掉某一处接线。

所有路径相对仓库根目录。

---

## 0. 先记住一张表

「板块」的差异集中定义在 `collection/core.js` 的 `MODE_REGISTRY` 里。
一条记录长这样（以纸币为例）：

```js
[MODE.NOTES]: {
    kind: 'collection',          // 'collection' | 'special' | 'articles' | 'settings'
    label: '纸币',                // 界面文案都从这儿出，别再写 '纸币' : '硬币' 这种二元三元式
    tree: () => categoryTree,     // 分类树（函数形式，避开加载顺序）
    allDataKeys: () => allDataKeys,
    map: 'DATA_MAP',              // 全局数据表名
    urlSegment: 'notes',          // 地址栏段名（#notes/rmb/rmb3 里的 notes）
    containerKey: () => '...',    // 渲染进哪个滚动容器
    search: 'full',               // 'full' | 'own' | 'none'
    searcher: 'collection',
    tabAction: 'collection'       // tab 分派用：'collection' | 'articles' | 'special'
}
```

**判断某个改动属于哪一类，就看这张表里有没有对应字段。**

---

## 1. 加一个分类 / 子分类（最常见，零代码）

例：在「民国纸币」下加一个「台湾银行」。

1. 新建数据文件，例如 `notecollection/data/republic_twb.js`，里面定义一个全局变量
   （变量名要和下面 `dataVar` 一致；不写 `dataVar` 就默认等于 `dataKey`）：
   ```js
   const republic_twbData = [ /* … 藏品数组 … */ ];
   ```
2. 在 `collection/config.js` 的 `categoryTree` 里，找到 `republic` 那一项，
   往 `children` 数组加一条：
   ```js
   { id: 'republic_twb', name: '台湾银行', dataKey: 'republic_twbData',
     dataFile: '../notecollection/data/republic_twb.js' },
   ```

**就这两步。** 不用改任何 `.js` 逻辑代码：
- `data-loader.js` 会自动发现并加载它（`walkTree` 递归扫 `categoryTree`）
- 侧边栏、概览、分类视图、搜索、导出、缩略图、大图动画全部读同一棵树

硬币同理，改 `collection/coin-config.js` 的 `coinCategoryTree`。

> 图片放 `notecollection/image/…`，缩略图按约定放 `notecollection/image/thumb/同名.jpg`。
> 没有缩略图也能跑（会自动回退到原图）。校验数据完整性：
> `node collection/tools/check-data.mjs`

---

## 2. 加一个专题（零代码）

例：加一个「币海拾年」那样的专题。

在 `collection/special-bridge.js` 的 `window.SPECIAL_CONFIGS` 数组里加一条：

```js
{
    id: 'stamp',                         // 唯一 id，会写进地址栏 #special/stamp
    name: '邮票',
    slogan: '方寸之间，邮海无涯',
    dataKey: 'stampData',
    dataFile: '../funcollection/stamp/data.js',
    dataVar: 'stampItems',               // 数据文件里定义的变量名
    groupBy: 'year'                      // 不写 view 时：按这个字段分组展示
}
```

**就这一条。** 概览卡片、侧边栏、路由、数据加载、缓存全部自动生效
（已实测：注入一条配置后，配置读取 / 数据桥接 / 概览卡片 / 点进去渲染 全部通过）。

专题的四种呈现方式，由 `view` 字段选：

| `view` 取值 | 呈现 | 额外要写的字段 |
|---|---|---|
| 不写 | 按 `groupBy` 分组的列表（最常用） | `groupBy` |
| `'timeline'` | 时间轴（币海拾年那种） | 见 `special.js` 的 `renderTimelineContent` |
| `'map'` | 中国地图（方寸山河那种） | `mapFile: 'china_map.svg'` |
| 想要全新样式 | 自己写一个渲染函数 | 见下面第 4 节 |

---

## 3. 加一个顶栏 tab（改 2 个文件）

例：让「邮票」成为第 6 个 tab（和纸币/硬币并列，而不是专题里的一个专题）。

### 3.1 `collection/index.html`
在 `.bottom-tabbar` 里加一个（图标可用 emoji 或 svg）：
```html
<div class="tab-item" data-target="stamps"><span class="tab-icon">📮</span>邮票</div>
```

### 3.2 `collection/core.js`
1. `MODE` 常量加一项：`STAMPS: 'stamps'`
2. `MODE_REGISTRY` 加一条：
   ```js
   [MODE.STAMPS]: {
       kind: 'collection',
       label: '邮票',
       tree: () => stampCategoryTree,
       allDataKeys: () => stampAllDataKeys,
       map: 'STAMP_DATA_MAP',
       urlSegment: 'stamps',
       containerKey: () => { /* 见下面说明 */ },
       search: 'full',
       searcher: 'collection',
       tabAction: 'collection'
   }
   ```
3. `MODE_URL_SEGMENTS` 加一行：`'stamps': MODE.STAMPS`

### 3.3 （可选）`collection/data-loader.js`
如果你的数据不在 `categoryTree` / `coinCategoryTree` / `SPECIAL_CONFIGS` 里，
需要在 `loadAllData()` 里加一段收集 + 桥接到 `window.STAMP_DATA_MAP`。
若你新建了 `stamp-config.js`，记得在 `index.html` 的脚本区加 `<script src="stamp-config.js">`。

**不用改的**：`tab-switcher.js`（按 `tabAction` 自动分派）、
`router.js`（按 `urlSegment` 自动解析）、`search.js` / `overview.js`
（按 `label` 自动出文案）、`sidebar.js` / `category-view.js`（按 `tree` 自动渲染）、
`main.js`（tab 点击是 `querySelectorAll('.tab-item')` 遍历绑定）。

### `containerKey` 怎么写
它决定"这个板块的内容渲染进哪个滚动容器"。关键是**让搜索页和分类页各自独立**，
否则从搜索返回时会丢滚动位置。照抄纸币的写法，把前缀换掉即可：

```js
containerKey: () => {
    if (currentView === VIEW.SEARCH) return 'stamps_search';
    if (currentView === VIEW.CATEGORY) {
        return 'stamps_category_' + String(currentSubId || currentCategoryId || 'overview')
            .replace(/[^a-zA-Z0-9_\-]/g, '_');
    }
    return 'stamps_overview';
}
```

### 顶栏放不下怎么办
移动端 5 个 tab 已经比较满。第 6 个建议先确认 `.bottom-tabbar` 的排版
（`collection/layout.css`）。另外注意 `--tabbar-h` 是 **JS 实测写入**的
（`core.js` 的 `measureTabbarHeight`），tab 栏变高会自动同步，不用手改常量。

---

## 4. 加一种全新的专题呈现方式

`special.js` 的 `renderSpecialContent()` 目前这样分派：

```
config.view === 'timeline'  → renderTimelineContent(config)
config.view === 'map'       → renderShanheContent(config)
其它                        → 按 groupBy 的通用分组列表
```

要加一种新样式（例如"按国家/地区的矩阵"）：

1. 写一个渲染函数，约定签名 `renderXxxContent(config)`，内部用
   `getRenderContainer()` 拿容器、`getData(config.dataKey)` 拿数据。
2. 在 `renderSpecialContent()` 里加**一条**提前返回分支：
   ```js
   if (config.view === 'matrix') { renderMatrixContent(config); return; }
   ```
3. 配置里写 `view: 'matrix'`。

这是唯一一处"必须改逻辑代码"的场景，而且只加一行分派。
渲染器本身是自包含的（约 100~200 行），不会影响已有专题。

> 注意：`special.js` 里另有几处 `config.view === 'map'` 的判断（山河视图的
> 列表/地图切换、来源标签等），那些是**山河专题特有的**领域逻辑，
> 新渲染器不需要动它们，也不该去改。

---

## 5. 加图片动画（大图放大/缩回）

**基本不用做任何事。** 大图系统是通用的：

- 入场：`core.js` 里一个文档级捕获监听，只要点的是 `<img>` 就记下来源元素 ——
  与类名、容器、在哪个 tab 都无关。新相册的图自动有"从缩略图生长出来"的动画。
- 退出：`closeModal()` 优先用 `gridThumbForUrl()` 按选择器表反查落点，
  查不到就回退到"被点的那个元素"，所以新容器也有正确的缩回动画。

**只有一种情况需要动一下**：同一个 URL 在页面上出现**多份**，而你想让
"翻面之后退出"落在正确的那一份上。这时把新元素的类名加进
`collection/category-view.js` 的 `gridThumbForUrl()` 里的
`URL_CANDIDATE_SELECTORS`（列表顺序 = 优先级，越"用户当前在看"的越靠前）。
不加也只是退化成"回到最初点的那张"，不会坏。

两个约束：
- 图片要用 `<img>`，不要用 `background-image`（捕获监听只认 `<img>`）。
- 文章正文里的配图走的是另一条委托（`.article-reader img`），已支持。

---

## 6. 改完必须跑的验证

```bash
# 静态：语法 + 括号配平 + 死代码 + 板块注册表护栏
node collection/tools/verify-mode-registry.mjs     # ← 加板块/tab 后必跑
node collection/tools/check-data.mjs               # ← 加分类/数据后必跑

# 如果你本地有这些脚本（它们在 .git/info/exclude 里，未提交）
node verify-router.mjs
node verify-deeplink.mjs
node verify-coldstart.mjs
node verify-roundtrip.mjs
```

`verify-mode-registry.mjs` 会在以下情况直接失败，等于替你做完了检查：

- 注册表条目缺字段 / 字段值非法
- 两个板块抢同一个 `urlSegment`
- 代码里又出现"穷举板块名"的可写写法
  （`MODE.NOTES || MODE.COINS`、`currentMode === MODE.NOTES ? '纸币' : '硬币'` 等）
- 未注册的板块被静默当成已注册板块（旧代码会退化成硬币）
- "加一条注册表条目就够用"不成立 —— 它会真的注入一个全新板块，
  验证 `label` / 分类树 / 取数 / 地址栏段名 / 容器 key 全部自动生效且不串数据

---

## 7. 三个最容易踩的坑

1. **别写二元假设。** `currentMode === MODE.NOTES ? '纸币' : '硬币'` 一旦有第三个
   板块就会显示错名字，而且不报错。统一用 `modeLabel()`。

2. **别在函数里直接引用后加载文件的变量。** `core.js` 在 `coin-config.js`
   **之前**加载，所以注册表里的 `tree` / `allDataKeys` 都写成函数（惰性求值）。
   直接写 `coinCategoryTree` 会在加载期抛 `ReferenceError`。

3. **容器 key 要按"视图"细分。** 搜索页和分类页必须是不同容器
   （`xxx_search` / `xxx_category_…` / `xxx_overview`），
   否则"搜索→返回"会丢滚动位置（历史 bug）。
