# 铜の币纪主站
纸币与硬币收藏品管理系统。
## 目录结构
```text
├── index.html # 入口页面
├── layout.css # 样式
├── README.md # 本文件
│
├── config.js # 纸币分类树定义
├── coin-config.js # 硬币分类树定义
│
├── data-bridge.js # 纸币数据桥接（旧站 → window.DATA_MAP）
├── coin-data-bridge.js # 硬币数据桥接（旧站 → window.COIN_DATA_MAP）
├── fun-data-bridge.js # 趣味收藏数据桥接（旧站 → window.FUN_DATA_MAP）
├── special-bridge.js # 专题配置收集
│
├── theme.js # 主题色管理
├── core.js # 核心常量、状态、工具函数、滚动容器
├── ui.js # UI工具函数
│
├── sidebar.js # 侧边栏渲染
├── category-view.js # 分类内容渲染 + 图片弹窗
├── overview.js # 概览页渲染
├── search.js # 搜索逻辑
├── tab-switcher.js # Tab切换
├── special.js # 专题功能
├── stats.js # 统计 + 数据导出
├── settings.js # 设置页渲染
├── article.js # 文章阅读器
│
├── main.js # 入口：初始化和事件绑定
│
├── ../notecollection/data/ # 纸币数据文件（旧站）
├── ../coincollection/data/ # 硬币数据文件（旧站）
└── ../funcollection/years/ # 趣味收藏数据文件（旧站）
```
## 加载顺序
数据文件 → 桥接 → 配置 → 核心 → 功能模块（按依赖顺序） → main.js
## 核心常量
代码中定义了以下关键常量（`core.js`）：
| 常量 | 说明 |
|---|---|
| `MODE` | 模式：`NOTES` / `COINS` / `SPECIAL` / `ARTICLES` / `SETTINGS` |
| `VIEW` | 视图：`OVERVIEW` / `CATEGORY` / `SEARCH` / `LIST` / `READER` |
| `SEARCH_TYPE` | 搜索类型：`ALL` / `NAME` / `VERSION` / `YEAR` / `AGENCY` / `KRAUSE` |
| `SEARCH_MODE` | 搜索模式：`CLICK` / `REALTIME` |
| `KRAUSE_PREFIX` | 目录编号前缀：`Pick# ` |
## 修复说明
### 1. 拆分 main.js
原 2343 行的 `main.js` 按职责拆分为 9 个独立文件：
- `core.js` — 状态定义 + 工具函数
- `sidebar.js` — 侧边栏
- `category-view.js` — 分类/系列/品种渲染
- `overview.js` — 概览页
- `search.js` — 搜索
- `tab-switcher.js` — Tab切换
- `special.js` — 专题
- `stats.js` — 统计 + 导出
- `settings.js` — 设置页
### 2. 修复 search.js 与 main.js 的冲突
- `search.js` 不再用 `let` 重复声明 `currentSearchKeyword` 和 `currentSearchType`
- 变量统一在 `core.js` 中声明
- 搜索逻辑只保留一套实现（在 `search.js` 中） 
### 3. 修复文章阅读器硬币路径
- 新增 `getArticleBasePath(sourceType)` 根据文章来源返回不同路径
- 预加载和阅读器中都使用该函数
- 图片路径替换使用通用正则，同时覆盖双引号、单引号、无引号等情况
### 4. 减少魔法字符串
- 模式名改为常量引用（`MODE.NOTES` 而非 `'notes'`）
- 视图名改为常量引用（`VIEW.OVERVIEW` 而非 `'overview'`）
- 搜索类型改为常量引用（`SEARCH_TYPE.ALL` 而非 `'all'`）
## 添加新专题
在 `special-bridge.js` 中添加：
```javascript
if (typeof yourNewMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(yourNewMeta);
}
专题数据需提供 id、name、categories（数组，可选）、imageBase，数据挂到 window.FUN_DATA_MAP[yourId]。

添加新分类
修改 config.js（纸币）或 coin-config.js（硬币）的分类树，添加对应的 dataKey 映射即可。
