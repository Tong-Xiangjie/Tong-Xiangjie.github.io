// ==================== article.js ====================
// 完整重构版：增量渲染 + FLIP 动画，保留高亮
// 修改：子分类压缩、父分类点击行为、列表重建保留滚动

// ==================== 模糊搜索（同义扩展）====================
// 让「央行」「荷花钞」「生肖钞」这类俗称/缩写也能搜到正式名称的文章。
//
// ★ 为什么同义词表是仓库里的静态 json，而不是在浏览器里跑语义模型：
//   实测过 bge-small-zh-v1.5 与 bge-large-zh-v1.5。小模型不具备
//   「央行 = 中国人民银行」这类世界知识 —— cos(央行,中国银行)=0.740 反而
//   高于 cos(央行,中国人民银行)=0.691，排序是**错的**，所以拿它挖出来的
//   扩张词里全是「银行」这种泛词，检索被淹没。
//   大模型知道（0.858 > 0.794），但运行期要下载 312 MB；而且语料同质化严重
//   （435 对随机文章平均相似度 0.648），文档级向量检索排不出正确结果。
//   结论：把同义关系在**构建期**用 LLM 离线算好，写成一张小表；运行期只做
//   「纯词法匹配 + 查表扩展」。零下载、零外部请求、命中原因可解释。
//
// ★ 这一整套状态只作用于文章板块，纸币/硬币的搜索逻辑一个字都没动。

let articleSynonymTable = null;      // { generatedAt, source, terms: { 词: [扩张词…] } }
let articleSynonymPromise = null;    // 加载 Promise（重复调用拿到同一个，避免重复请求）

// ★ 模糊搜索（同义扩展）开关。默认**关**（用户要求：默认为关闭）。
//   它现在是「我的 → 文章搜索」里的一个设置项，与「网格直接用原图」「自动预缓存」
//   同类，所以两条约定都向那两项看齐：
//     ① 不进 URL —— URL 只描述"在看什么"（板块/分类/关键词/标全），不描述偏好；
//        明暗、网格画质、预缓存这些设置项同样不在 URL 里。
//     ② 存 localStorage —— 开了之后刷新、重开都还记得。
//   状态只有 localStorage 这一个来源，不再另设全局变量，避免两处打架。
const ARTICLE_FUZZY_KEY = 'collection-article-fuzzy';

function articleFuzzyOn() {
  try { return localStorage.getItem(ARTICLE_FUZZY_KEY) === '1'; } catch (e) { return false; }
}

function setArticleFuzzy(on) {
  try { localStorage.setItem(ARTICLE_FUZZY_KEY, on ? '1' : '0'); } catch (e) {}
}

// 同义扩展最多取多少个：扩张词越多召回越广，但打分噪声也越大。
// 表本身已经由构建期筛过（禁泛词），这里再兜一道，防止极端表把结果冲烂。
const ARTICLE_MAX_EXPANSIONS = 12;

// 同义词表的候选 URL 列表，按优先级排列。
// 带 ?v=<generatedAt> 是为了让构建期重新生成的表立刻生效，不被 CDN/浏览器缓存住。
// 版本号由 workflow 生成的 data/synonyms-version.js 提供；那个文件不存在时
// 自动退化成不带版本号（不影响功能）。
//
// ★ 为什么 file:// 下要多一个绝对线上地址作后备：
//   文章正文走的是 getArticleBasePath() → SITE_BASE + 'notecollection/'，
//   也就是**无论用什么协议打开，正文都从线上取**，file:// 下这恰好让它能正常工作。
//   而同义词表若只有相对路径 'data/synonyms.json'，在 file:// 页面里会被解析成
//   file:///.../data/synonyms.json，浏览器以「origin 为 null」的 CORS 策略拦掉
//   （控制台报 "Access to fetch at 'file:///…' from origin 'null' has been blocked"），
//   于是表加载失败、静默降级成纯词法 —— 表现就是"本地打开时模糊搜索没作用"。
//   所以 file:// 下追加一个 SITE_BASE 的绝对地址作后备，和正文用同一套基址。
//   顺序仍是"相对优先"：若浏览器允许本地文件访问（--allow-file-access-from-files），
//   用的就是**本仓库里最新的表**，而不是线上那份可能还没部署的。
function articleSynonymUrls() {
  const v = (typeof window !== 'undefined' && window.__SYNONYMS_VERSION) ? window.__SYNONYMS_VERSION : '';
  const qs = v ? '?v=' + encodeURIComponent(v) : '';
  const rel = 'data/synonyms.json' + qs;
  const urls = [rel];
  try {
    if (typeof location !== 'undefined' && location.protocol === 'file:' && typeof SITE_BASE === 'string') {
      urls.push(SITE_BASE + 'collection/' + rel);
    }
  } catch (e) { /* SITE_BASE 还没求值就只用相对路径 */ }
  return urls;
}

// 加载同义词表。
// ★ 任何失败都**静默降级**：只留一条 console.warn，绝不抛错、绝不弹窗、
//   绝不让搜索不可用 —— 表没加载出来时下面 getArticleExpansions() 返回空数组，
//   getFilteredArticles() 就退化成纯词法匹配，也就是现在线上的行为。
function loadArticleSynonyms() {
  if (articleSynonymPromise) return articleSynonymPromise;
  articleSynonymPromise = (async () => {
    try {
      // 按 articleSynonymUrls() 的顺序逐个试，第一个成功的就用它。
      const urls = articleSynonymUrls();
      let json = null, lastErr = null;
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          json = await res.json();
          break;
        } catch (e) { lastErr = e; }
      }
      if (!json) throw (lastErr || new Error('无法获取同义词表'));
      const terms = (json && json.terms && typeof json.terms === 'object') ? json.terms : null;
      if (!terms) throw new Error('表结构不对（缺少 terms）');
      // ★ 预建索引：完整表有 6000+ 个键，若每次击键都对全部键做 toLowerCase()
      //   会白白产生几千次字符串分配。这里在加载时算一次。
      const entries = Object.keys(terms).map(k => ({ k, kl: k.toLowerCase(), v: terms[k] }));
      const byKey = new Map(entries.map(e => [e.kl, e.v]));
      articleSynonymTable = {
        generatedAt: json.generatedAt || '',
        source: json.source || '',
        terms,
        entries,
        byKey
      };
      articleExpansionsCache.clear();   // 表换了，记忆化结果作废
    } catch (e) {
      console.warn('[article] 同义词表加载失败，模糊搜索退化为纯词法匹配：', e && e.message);
      articleSynonymTable = null;
      articleExpansionsCache.clear();
    }
    return articleSynonymTable;
  })();
  return articleSynonymPromise;
}

// 查表拿扩张词。返回 [] 表示「没有可用扩展」，三种正常情况：
//   ① 模糊开关关着  ② 表没加载成功  ③ 这个查询词不在表里（表只覆盖语料术语）
//
// ★ 查表顺序：**精确命中优先**。
//   完整表有 6000+ 个键，如果按插入顺序边扫边收，搜「中国人民银行」时短的
//   包含键（「人民」「银行」之类）可能先命中、把 12 个额度占满，真正的精确键
//   反而挤不进去。所以先取精确键的扩展，再用包含键补齐。
//
// 包含匹配的两种方向（都要求键 >= 3 字，避免「银行」这种两字常用词一匹配一大片）：
//   · 查询词包含表键：搜「荷花钞价格」也能用上「荷花钞」的扩展
//   · 表键包含查询词：搜「人民银行」也能用上「中国人民银行」的扩展
// 字形重叠是允许的 ——「编号/号码」「储备/中央储备银行」本来就共用汉字，
// 早先加的「排除字形重叠」过滤器是矫枉过正，已废弃。
// ★ 记忆化。下面 ② 那段"包含命中补齐"要遍历整张表（一万多条键），
//   而多关键词分词会对**每个候选子串**各问一次（一次搜索几十次），
//   不缓存的话边打边搜会明显卡顿。表在加载完成/失败时清一次缓存（见 loadArticleSynonyms）。
//   ⚠ 返回的是**共享数组**，调用方只读、不要原地修改（现有调用方都先 filter/map，安全）。
let articleExpansionsCache = new Map();

function getArticleExpansions(keyword) {
  if (!articleFuzzyOn()) return [];
  if (!articleSynonymTable || !articleSynonymTable.terms) return [];
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return [];
  const cached = articleExpansionsCache.get(kw);
  if (cached) return cached;

  const out = [];
  const seen = new Set([kw]);
  const pushList = (list) => {
    if (!Array.isArray(list)) return;
    for (const t of list) {
      if (typeof t !== 'string' || !t) continue;
      const tl = t.toLowerCase();
      if (seen.has(tl)) continue;
      seen.add(tl);
      out.push(t);
      if (out.length >= ARTICLE_MAX_EXPANSIONS) return;
    }
  };

  // ① 精确命中（O(1)：加载时已建好小写键 → 扩展 的 Map）
  if (articleSynonymTable.byKey) {
    pushList(articleSynonymTable.byKey.get(kw));
  }

  // ② 包含命中补齐
  //    · 键 >= 3 字：双向包含都认 —— 查询词里含键，或**键里含查询词**。
  //      后者管的是「奥运」借键「奥运会」的扩展拿到「奥林匹克」这类情形。
  //    · 键 == 2 字：只认"是查询词的前缀、且占查询词一半以上"。
  //      2 字键若放任双向包含，「中国人民银行」会被「中国/人民/银行」这类泛词冲垮；
  //      可「生肖钞 → 生肖 → 十二生肖」「荷花钞 → 荷花 → 莲花」这种复合词
  //      又恰恰只有 2 字键才连得上，所以按"前缀 + 占一半以上"放行。
  if (out.length < ARTICLE_MAX_EXPANSIONS) {
    const entries = articleSynonymTable.entries || [];
    for (const e of entries) {
      if (out.length >= ARTICLE_MAX_EXPANSIONS) break;
      if (e.kl === kw) continue;
      if (e.kl.length >= 3) {
        if (kw.includes(e.kl) || e.kl.includes(kw)) pushList(e.v);
      } else if (e.kl.length === 2 && e.kl.length * 2 >= kw.length && kw.startsWith(e.kl)) {
        pushList(e.v);
      }
    }
  }
  articleExpansionsCache.set(kw, out);
  return out;
}

// ★ 由「我的 → 文章搜索」里的那个开关调用（settings.js 的 toggle-card）。
//   不再写 URL：这是偏好而非"在看什么"，切换后同步开关外观并重算当前列表即可。
function toggleArticleFuzzy() {
  const next = !articleFuzzyOn();
  setArticleFuzzy(next);
  if (typeof setSwitchState === 'function') setSwitchState('articleFuzzySwitch', next);
  // 开关在「我的」页面上，点它的时候通常不在文章列表里；万一在，立刻重算一次。
  if (typeof currentMode !== 'undefined' && currentMode === MODE.ARTICLES && articleSearchKeyword) {
    renderArticleList(true);
  }
}

// 文章板块搜索提示文字的**唯一来源**（core.js 的 searchUi 与 preloadAllArticles 都走它）。
// fulltextState: undefined | 'loading' | 'ready'
// ★ 文案与重构前逐字一致（含"未传状态时也给加载中那句"这个旧行为）——
//   这是搜索栏 UI 的一部分，模糊开关移走后不该顺手改文案。
function articleSearchTip(fulltextState) {
  if (articleSearchMode === 'title') {
    return '现在是按标题找（边打边搜），点“标”字能切到全文索引';
  }
  if (fulltextState === 'ready') {
    return '现在是全文索引（边打边搜），点“全”字能切回按标题找 | 全文索引准备好啦，标题和正文都能搜';
  }
  return '现在是全文索引（边打边搜），点“全”字能切回按标题找 | 全文还在加载中，稍等一下下～';
}

// ---------- 收集文章 ----------
function collectAllArticles() {
  collectedArticles = [];

  for (const dataKey of allDataKeys) {
    const data = window.DATA_MAP && window.DATA_MAP[dataKey];
    if (!data || !data.series) continue;
    collectFromSource(data, dataKey, MODE.NOTES);
  }

  for (const dataKey of coinAllDataKeys) {
    const data = window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey];
    if (!data || !data.series) continue;
    collectFromSource(data, dataKey, MODE.COINS);
  }

  buildArticleCategoryTree();
}

function collectFromSource(data, dataKey, sourceType) {
  const catInfo = findArticleCategoryInfo(dataKey, sourceType);
  const groupPath = buildGroupPath(sourceType, catInfo);

  if (data.readme && data.readme.title && data.readme.content) {
    const fullPath = buildFullPath(sourceType, catInfo, null, null);
    collectedArticles.push({
      title: data.readme.title,
      contentPath: data.readme.content,
      category: catInfo.category,
      parentCategory: catInfo.parentCategory,
      dataKey,
      sourceType,
      fullPath,
      groupPath,
      seriesIndex: -1,
      varietyIndex: -1,
      seriesName: data.name || ''
    });
  }

  if (data.readmes && Array.isArray(data.readmes)) {
    for (const rm of data.readmes) {
      if (rm.title && rm.content) {
        const fullPath = buildFullPath(sourceType, catInfo, null, null);
        collectedArticles.push({
          title: rm.title,
          contentPath: rm.content,
          category: catInfo.category,
          parentCategory: catInfo.parentCategory,
          dataKey,
          sourceType,
          fullPath,
          groupPath,
          seriesIndex: -1,
          varietyIndex: -1,
          seriesName: data.name || ''
        });
      }
    }
  }

  for (let si = 0; si < data.series.length; si++) {
    const series = data.series[si];

    if (series.readme && series.readme.title && series.readme.content) {
      const fullPath = buildFullPath(sourceType, catInfo, series.seriesName, null);
      collectedArticles.push({
        title: series.readme.title,
        contentPath: series.readme.content,
        category: catInfo.category,
        parentCategory: catInfo.parentCategory,
        dataKey,
        sourceType,
        fullPath,
        groupPath,
        seriesIndex: si,
        varietyIndex: -1,
        seriesName: series.seriesName
      });
    }

    if (series.readmes && Array.isArray(series.readmes)) {
      for (const rm of series.readmes) {
        if (rm.title && rm.content) {
          const fullPath = buildFullPath(sourceType, catInfo, series.seriesName, null);
          collectedArticles.push({
            title: rm.title,
            contentPath: rm.content,
            category: catInfo.category,
            parentCategory: catInfo.parentCategory,
            dataKey,
            sourceType,
            fullPath,
            groupPath,
            seriesIndex: si,
            varietyIndex: -1,
            seriesName: series.seriesName
          });
        }
      }
    }

    if (series.varieties && series.varieties.length > 0) {
      for (let vi = 0; vi < series.varieties.length; vi++) {
        const variety = series.varieties[vi];

        if (variety.readme && variety.readme.title && variety.readme.content) {
          const fullPath = buildFullPath(sourceType, catInfo, series.seriesName, variety.varietyName);
          collectedArticles.push({
            title: variety.readme.title,
            contentPath: variety.readme.content,
            category: catInfo.category,
            parentCategory: catInfo.parentCategory,
            dataKey,
            sourceType,
            fullPath,
            groupPath,
            seriesIndex: si,
            varietyIndex: vi,
            seriesName: series.seriesName
          });
        }

        if (variety.readmes && Array.isArray(variety.readmes)) {
          for (const rm of variety.readmes) {
            if (rm.title && rm.content) {
              const fullPath = buildFullPath(sourceType, catInfo, series.seriesName, variety.varietyName);
              collectedArticles.push({
                title: rm.title,
                contentPath: rm.content,
                category: catInfo.category,
                parentCategory: catInfo.parentCategory,
                dataKey,
                sourceType,
                fullPath,
                groupPath,
                seriesIndex: si,
                varietyIndex: vi,
                seriesName: series.seriesName
              });
            }
          }
        }
      }
    }
  }
}

function buildFullPath(sourceType, catInfo, seriesName, varietyName) {
  const top = sourceModeName(sourceType);
  const parts = [top];
  if (catInfo.parentCategory && catInfo.parentCategory !== top && catInfo.parentCategory !== catInfo.category) {
    parts.push(catInfo.parentCategory);
  }
  parts.push(catInfo.category);
  if (seriesName) parts.push(seriesName);
  if (varietyName) parts.push(varietyName);
  return parts;
}

function buildGroupPath(sourceType, catInfo) {
  const top = sourceModeName(sourceType);
  const parts = [top];
  if (catInfo.parentCategory && catInfo.parentCategory !== top && catInfo.parentCategory !== catInfo.category) {
    parts.push(catInfo.parentCategory);
  }
  parts.push(catInfo.category);
  return parts;
}

// ★ 板块中文名与分类树统一从注册表取，不再写 `=== MODE.COINS ? '硬币' : '纸币'`。
//   那种二元写法在出现第三个数据板块时会静默显示错名字。
//   注意：局部变量不叫 modeLabel，避免遮蔽 core.js 里的同名注册表取值函数。
function sourceModeName(sourceType) {
  return (typeof modeLabel === 'function') ? modeLabel(sourceType) : (sourceType || '');
}
function sourceTreeOf(sourceType) {
  const def = (typeof getModeDef === 'function') ? getModeDef(sourceType) : null;
  return (def && typeof def.tree === 'function') ? (def.tree() || null) : null;
}

// 在某一棵树里按 dataKey 找分类信息；找不到返回 null。
// 顶层命中时 parentCategory 用分类自己的名字（保持原行为：顶层分类自成一级）。
function findInTree(tree, dataKey) {
  if (!tree) return null;
  for (const cat of tree) {
    if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: cat.name };
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
      }
    }
  }
  return null;
}

function findArticleCategoryInfo(dataKey, sourceType) {
  // 先在来源板块自己的树里找；找不到再退到"另一个数据板块"的树
  // （历史行为：文章里的藏品可能标着纸币的 dataKey 却挂在硬币来源下，反之亦然）。
  const primary = findInTree(sourceTreeOf(sourceType), dataKey);
  if (primary) return primary;

  const otherType = (sourceType === MODE.COINS) ? MODE.NOTES : MODE.COINS;
  const secondary = findInTree(sourceTreeOf(otherType), dataKey);
  if (secondary) return secondary;

  return { category: dataKey, parentCategory: '其他' };
}

function buildArticleCategoryTree() {
  articleCategoryTree = [];
  const notesArticles = collectedArticles.filter(a => a.sourceType === MODE.NOTES);
  const coinsArticles = collectedArticles.filter(a => a.sourceType === MODE.COINS);
  const notesCount = {};
  for (const a of notesArticles) { if (!notesCount[a.dataKey]) notesCount[a.dataKey] = 0; notesCount[a.dataKey]++; }
  const coinsCount = {};
  for (const a of coinsArticles) { if (!coinsCount[a.dataKey]) coinsCount[a.dataKey] = 0; coinsCount[a.dataKey]++; }

  for (const cat of categoryTree) {
    if (cat.children) {
      const children = [];
      let parentTotal = 0;
      for (const sub of cat.children) {
        const count = notesCount[sub.dataKey] || 0;
        parentTotal += count;
        if (count > 0) children.push({ id: sub.id, name: sub.name + '（' + count + '篇）', dataKey: sub.dataKey });
      }
      if (children.length > 0) articleCategoryTree.push({ id: cat.id, name: cat.name + '（' + parentTotal + '篇）', children });
    } else {
      const count = notesCount[cat.dataKey] || 0;
      if (count > 0) articleCategoryTree.push({ id: cat.id, name: cat.name + '（' + count + '篇）', dataKey: cat.dataKey, children: null });
    }
  }

  for (const cat of coinCategoryTree) {
    const count = coinsCount[cat.dataKey] || 0;
    if (count > 0) articleCategoryTree.push({ id: cat.id, name: cat.name + '（' + count + '篇）', dataKey: cat.dataKey, children: null });
  }
}

function getArticleBasePath(sourceType) {
  if (sourceType === MODE.COINS) {
    return SITE_BASE + 'coincollection/';
  }
  return SITE_BASE + 'notecollection/';
}

// ★ 正在进行的预加载（Promise）。存在的理由：
//   原来是 `if (isArticlePreloading) return;` —— 第二次调用**立刻 resolve**，
//   于是 `await preloadAllArticles()` 会在索引其实还没建好时就继续往下走。
//   深链接还原全文搜索时正好踩这个：applyRoute 先启动预热，enterArticlesTab
//   里再 await 一次，拿到的却是"已经在加载中"的立即返回 → 过滤出空列表，
//   用户看到"链接打开了但没有结果"。
//   现在重复调用会拿到**同一个 Promise**，await 它一定等到真正建好。
let articlePreloadPromise = null;

// 等文章列表就绪。
//
// ★ 为什么必须等：collectedArticles 是由数据文件（<script> 加载）汇总出来的，
//   在页面很早期还是空数组。此时直接 map，promises 是**空数组**，这个 IIFE 会
//   "成功"完成并把 isArticlePreloading 置 false；于是下面 finally 里那句
//   "失败也要放掉"的兜底**不会触发**，articlePreloadPromise 就被永久钉死成
//   "索引已建好"，而 articlePlainTextCache 其实是空的 —— 正文索引再也建不起来。
//   实测踩到的路径：① 深链接直接进全文搜索；② 切到全文模式后刷新页面（模式会被
//   记住，恢复时立刻触发预热）。表现是全文搜索只剩标题命中，正文里的词搜不到。
function waitForArticleList(timeoutMs) {
  const ready = () => (typeof collectedArticles !== 'undefined' && collectedArticles.length > 0);
  if (ready()) return Promise.resolve(true);
  return new Promise(resolve => {
    const t0 = Date.now();
    (function tick() {
      if (ready()) return resolve(true);
      if (Date.now() - t0 >= timeoutMs) return resolve(false);   // 站点真的没有文章时不至于卡死
      setTimeout(tick, 50);
    })();
  });
}

async function preloadAllArticles() {
  if (articlePreloadPromise) return articlePreloadPromise;
  articlePreloadPromise = (async () => {
    const tip = document.getElementById('searchTip');
    if (tip) tip.textContent = articleSearchTip('loading');
    // ★ 文章列表还没收集过就先收集。
    //   为什么会出现"还没收集"：collectAllArticles() 全仓库只有一个调用点，在
    //   tab-switcher.js 的 enterArticlesTab() 里；而 router.applyRoute() 的顺序是
    //   「先 await preloadAllArticles()，再 await enterArticlesTab()」——
    //   预热跑在收集**之前**，collectedArticles 还是空数组，map 出来是空的。
    //   深链接直进全文搜索、以及切到全文后刷新页面（模式被记住）都会踩到，
    //   表现是正文索引永远建不起来、全文搜索只剩标题命中。
    if (typeof collectedArticles !== 'undefined' && collectedArticles.length === 0
        && typeof collectAllArticles === 'function') {
      collectAllArticles();
    }
    // 兜底：万一数据还没到（理论上 applyInitialRoute 在 loadAllData 之后，
    // 不该发生），短暂等一下，不要用空数组去建索引。
    await waitForArticleList(3000);
    const promises = collectedArticles.map(article => preloadArticle(article));
    await Promise.allSettled(promises);
    if (tip) tip.textContent = articleSearchTip('ready');
    isArticlePreloading = false;
    // ★ 索引建好后必须重渲染一次。首次渲染可能发生在索引就绪之前（那时只有标题
    //   命中），不补这一次，深链接进来的用户会一直停在"空列表 / 结果不全"的界面上，
    //   而 articleResultMeta 却已经是新数字。renderArticleList 不会反过来调用
    //   preloadAllArticles，所以这里不会形成循环。
    if (typeof renderArticleList === 'function' && articleSearchKeyword
        && articleSearchMode === 'fulltext'
        && typeof currentArticleView !== 'undefined' && currentArticleView === VIEW.LIST) {
      renderArticleList(true);
    }
  })();
  isArticlePreloading = true;
  try {
    return await articlePreloadPromise;
  } finally {
    // 失败也要放掉，否则一次网络抖动会让全文搜索永久失效
    if (isArticlePreloading) { isArticlePreloading = false; articlePreloadPromise = null; }
    // ★ 再兜一道：一篇正文都没索引到，说明这次是在数据就绪前跑的（或者整批网络失败）。
    //   上一条 `if (isArticlePreloading)` 在这种情况下判断为 false（IIFE 成功完成时
    //   已经把标志置 false），所以单靠它拦不住"空索引被记成已建好"。
    if (articlePreloadPromise && Object.keys(articlePlainTextCache).length === 0) {
      articlePreloadPromise = null;
    }
  }
}

async function preloadArticle(article) {
  if (articleContentCache[article.contentPath]) return;
  let filePath = article.contentPath;
  if (filePath.startsWith('file:')) filePath = filePath.substring(5);
  try {
    const basePath = getArticleBasePath(article.sourceType);
    const response = await fetch(basePath + filePath);
    if (!response.ok) throw new Error('加载失败');
    const html = await response.text();
    articleContentCache[article.contentPath] = html;
    articlePlainTextCache[article.contentPath] = stripHtml(html);
  } catch (e) {}
}

function stripHtml(html) {
  if (!html) return '';
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// ★ 收口写 URL：搜索模式是深链接的一部分（sm-title / sm-fulltext），
//   切模式后地址栏必须跟着变 —— 否则分享出去的链接还带着旧的模式，
//   而"标/全"下同一个词的结果集完全不同。
function toggleArticleSearchMode() {
  try {
    toggleArticleSearchModeInner();
  } finally {
    if (typeof syncRoute === 'function') syncRoute();
  }
}

function toggleArticleSearchModeInner() {
  if (articleSearchMode === 'title') {
    articleSearchMode = 'fulltext';
    const input = document.getElementById('searchInput');
    if (input) { input.removeEventListener('input', onSearchInput); input.addEventListener('input', onSearchInput); }
    preloadAllArticles().then(() => { if (articleSearchKeyword) renderArticleList(true); });
  } else {
    articleSearchMode = 'title';
    if (articleSearchKeyword) renderArticleList(true);
  }
  updateSearchUIForMode();
}

// ========== 文章侧边栏 ==========
function renderArticleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  let html = '';
  for (const cat of articleCategoryTree) {
    const hasChildren = cat.children && cat.children.length > 0;
    const isActive = cat.id === currentArticleCategory || (hasChildren && cat.children.some(sub => sub.id === currentArticleCategory));
    const isExpanded = (isActive && hasChildren) || (hasChildren && cat.children.some(sub => sub.id === currentArticleCategory));
    html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onArticleSidebarClick('${cat.id}')">`;
    html += `<span>${cat.name}</span>`;
    if (hasChildren) html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▸</span>`;
    html += `</div>`;
    if (hasChildren) {
      html += `<div class="sidebar-children ${isExpanded ? 'open' : ''}">`;
      for (const sub of cat.children) {
        const subActive = currentArticleCategory === sub.id;
        // ★ 关键修改：用 .child-text 包裹子项文字，支持压缩
        html += `<div class="sidebar-child ${subActive ? 'active' : ''}" onclick="onArticleSidebarClick('${sub.id}'); event.stopPropagation();"><span class="child-text">${sub.name}</span></div>`;
      }
      html += `</div>`;
    }
  }
  sidebar.innerHTML = '<div class="sidebar-inner">' + html + '</div>';
  // ★ 入场动画：与纸币/硬币/专题共用同一套（见 sidebar.js 的 replaySidebarEnter）。
  //   容器每次都是新建的，动画自动从头播。
  if (typeof replaySidebarEnter === 'function') {
    replaySidebarEnter(sidebar);
  }
  // ★ 展开/收起要带动画：和纸币/硬币/专题走同一套差分逻辑
  //   （见 sidebar.js 的 syncSidebarAccordion）。不调用的话，文章侧边栏因为
  //   每次整体重建 innerHTML、新面板一出现就带着 .open，切换分类是硬切没有过渡。
  //   这里的面板没有 id 也没关系 —— 那边按 .sidebar-item 的相邻兄弟推导。
  if (typeof syncSidebarAccordion === 'function') {
    syncSidebarAccordion();
  }
  if (typeof fitSidebarLabels === 'function') {
    fitSidebarLabels();
  }
}

// ★ 修正：父分类点击行为同纸币/硬币
// ★ try/finally 统一收口写 URL（本函数有 6 个提前 return 分支）。
//   之前这里**没有** syncRoute()，所以点文章侧边栏的分类/子分类完全不改地址栏，
//   深链接"不灵敏"的观感就来自这里（加上 openArticleReader 也漏了）。
function onArticleSidebarClick(categoryId) {
  try {
    onArticleSidebarClickInner(categoryId);
  } finally {
    if (typeof syncRoute === 'function') syncRoute();
  }
}

function onArticleSidebarClickInner(categoryId) {
  // 判断点击的是父分类还是子分类
  let isParent = false;
  let parentId = null;
  let targetCat = null;

  for (const cat of articleCategoryTree) {
    if (cat.id === categoryId) {
      isParent = true;
      targetCat = cat;
      break;
    }
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.id === categoryId) {
          isParent = false;
          parentId = cat.id;
          targetCat = sub;
          break;
        }
      }
      if (targetCat) break;
    }
  }

  if (!targetCat) return;

  // 点击的是子分类
  if (!isParent) {
    if (currentArticleCategory === categoryId) {
      // 已选中子分类 → 取消选中，回到父分类
      currentArticleCategory = parentId;
      renderArticleList(true);
      renderArticleSidebar();
      return;
    }
    // 未选中 → 选中该子分类
    currentArticleCategory = categoryId;
    renderArticleList(true);
    renderArticleSidebar();
    return;
  }

  // 点击的是父分类
  const parentCat = targetCat;

  // 如果当前选中了这个父分类下的某个子分类 → 关闭父分类，显示全部文章
  if (parentCat.children && parentCat.children.some(sub => sub.id === currentArticleCategory)) {
    currentArticleCategory = 'all';
    renderArticleList(true);
    renderArticleSidebar();
    return;
  }

  // 如果当前选中的就是这个父分类 → 切换到全部文章
  if (currentArticleCategory === parentCat.id) {
    currentArticleCategory = 'all';
    renderArticleList(true);
    renderArticleSidebar();
    return;
  }

  // 否则进入该父分类
  currentArticleCategory = parentCat.id;
  renderArticleList(true);
  renderArticleSidebar();
}

// ========== 增量渲染辅助函数 ==========

function ensureArticleStaticHeader(container) {
  let header = container.querySelector('.article-static-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'article-static-header';
    header.style.cssText = `
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg);
      padding: 2px 0 4px 0;
      margin: 0 0 10px 0;
      border-bottom: 1px solid var(--border);
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    `;
    header.innerHTML = `
      <div class="overview-header" style="margin:0; padding:0;">
        <h2 style="margin:0; font-size:1.1rem;">文章</h2>
        <p id="articleResultMeta" style="margin:2px 0 0 0; font-size:0.8rem;">共0篇</p>
      </div>
    `;
    container.prepend(header);
  }
  return header;
}

function updateArticleMeta(count) {
  const meta = document.getElementById('articleResultMeta');
  if (meta) {
    meta.textContent = `共${count}篇`;
  }
}

function ensureArticleDynamicWrapper(container) {
  let wrapper = container.querySelector('.article-dynamic-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'article-dynamic-wrapper';
    wrapper.style.cssText = 'position: relative; width: 100%; height: auto; max-height: none; overflow: visible;';
    container.appendChild(wrapper);
  }
  return wrapper;
}

// ========== 相关性打分（只在模糊开启时使用） ==========
// ★ 用户要求：「模糊搜索下，请仅按照相关性排序……也不要求按照默认顺序，只按照相关性。」
//   所以模糊开时列表是**单一列表、纯相关性顺序** —— 不分「精确匹配 / 同义扩展命中」，
//   也不按分类分组（分类分组会把相关性顺序打断）。
//   打分**只决定顺序**，不决定"是否命中"：命中与否仍由词表扩展决定，
//   不在这里引入新的召回（宁可召回宽一点，让排序把不相关的压下去）。
//   权重取法：
//     · 查询词本身命中 ≫ 同义扩展命中（10 : 1）
//     · 标题命中 > 正文命中（×3）—— 标题里的词才是这篇的主题
//     · 词越长越特异（× 词长）—— 「中国银行成立一百周年」比「钞」有信息量得多
//     · 出现次数越多越相关（1 + log2(1+tf)）—— 用 log 压一下，避免长文靠堆词刷分
const ARTICLE_QUERY_WEIGHT = 10;

function countOccurrences(hay, needle) {
  if (!hay || !needle) return 0;
  let n = 0, i = 0;
  for (;;) {
    const p = hay.indexOf(needle, i);
    if (p < 0) return n;
    n++;
    i = p + needle.length;
  }
}

function articleRelevanceScore(title, body, kw, expansions) {
  const tfWeight = (n) => 1 + Math.log2(1 + n);
  let score = 0;

  const titleTf = countOccurrences(title, kw);
  const bodyTf = countOccurrences(body, kw);
  if (titleTf) score += ARTICLE_QUERY_WEIGHT * 3 * kw.length * tfWeight(titleTf);
  else if (bodyTf) score += ARTICLE_QUERY_WEIGHT * kw.length * tfWeight(bodyTf);

  const hits = [];
  let hitInTitle = false;
  for (const t of expansions) {
    const tl = t.toLowerCase();
    const a = countOccurrences(title, tl);
    const b = countOccurrences(body, tl);
    if (!a && !b) continue;
    hits.push(t);
    if (a) hitInTitle = true;
    score += (a ? 3 : 1) * tl.length * tfWeight(a + b);
  }
  return { score, hits, hitInTitle };
}

// ========== 多关键词：无空格分词 + 兜底阶梯 ==========
// ★ 用户要求：「尽量不要空格就能搜，例如输入澳门荷花也可以搜出来」，
//   并且「输入澳门荷花666 也要能搜出来，因为 666 是无关的」。
//
// 核心设计（**零新增数据文件**，词表就是语料本身）：
//   一个候选词能不能成立，就看它在当前范围（标题/全文）里命中几篇 —— df。
//   候选词只有两类：
//     · 汉字子串，2..8 字
//     · **完整的非汉字连续段**（"2002" 整段算一个候选，不允许切成 "20"+"02"）
//       这一条是修掉"数字被乱切"的关键。
//   然后用 DP 在查询串上选一条"最像人话"的切分：长度权重压倒性优先
//   （偏好少而长的词），df 做微调，切不动的字符直接忽略。
//
// ★★ 最重要的性质：整条逻辑**只在整串搜索 0 条时才介入**（见 getFilteredArticles）。
//    所以现在能用的搜索一次都不会被碰到 —— 功能只可能"多搜出来"，不可能变差。
const ARTICLE_SEG_MAX_HAN = 8;      // 候选汉字词最长字数
const ARTICLE_SEG_SKIP = 0.6;       // 忽略一个字符的代价
const ARTICLE_SEG_LEN_W = 10;       // 长度权重（压倒性优先：偏好"少而长"的词）
const ARTICLE_SEG_DF_W = 0.5;       // 语料支撑权重（微调）
const ARTICLE_SEG_MIN_NONHAN = 2;   // 非汉字连续段至少这么长才算候选

function articleIsHanChar(c) {
  return /[\u4e00-\u9fa5]/.test(c);
}

// 这个词在语料里"算不算命中" —— 与搜索口径一致：字面命中，或（模糊开时）同义扩展命中。
// hay 是预先把 title/body 转小写的数组（避免每个候选词都对整篇正文重复 toLowerCase）。
function articleTermHitsHay(h, kwLower, expsLower) {
  if (h.title.includes(kwLower) || h.body.includes(kwLower)) return true;
  for (const e of expsLower) {
    if (h.title.includes(e) || h.body.includes(e)) return true;
  }
  return false;
}

// 把查询串切成"能在语料里命中的词"。返回 [{ t, w, han }]。
function articleSegmentQuery(q, hay) {
  const n = q.length;
  if (!n) return [];

  const dfCache = new Map();
  const dfOf = (t) => {
    const k = t.toLowerCase();
    if (dfCache.has(k)) return dfCache.get(k);
    const exps = getArticleExpansions(t).map(e => e.toLowerCase()).filter(e => e !== k);
    let count = 0;
    for (const h of hay) if (articleTermHitsHay(h, k, exps)) count++;
    dfCache.set(k, count);
    return count;
  };
  const weightOf = (t, df) => ARTICLE_SEG_LEN_W * (t.length - 1) + ARTICLE_SEG_DF_W * Math.log2(1 + df);

  // 位置 i 能取到的候选词
  const candidatesAt = (i) => {
    const out = [];
    if (articleIsHanChar(q[i])) {
      for (let len = 2; len <= ARTICLE_SEG_MAX_HAN && i + len <= n; len++) {
        const t = q.slice(i, i + len);
        if (![...t].every(articleIsHanChar)) break;   // 汉字词不跨到非汉字
        const df = dfOf(t);
        if (df > 0) out.push({ t, df, han: true });
      }
    } else {
      // ★ 非汉字：只允许在**一段连续非汉字的开头**取候选，而且整段算一个词。
      //   两条都是必须的：
      //     · 整段算一个词 → "2002" 不会被切成 "20"+"02"
      //     · 只从段首起头 → "澳门荷花666" 不会在中间起出 "66" 这种半截词
      //       （否则 "66" 会混进词表，万一某篇正好同时含澳门/荷花/66，
      //         第 ① 步就会只返回那一篇，反而把结果收窄了）
      if (i > 0 && !articleIsHanChar(q[i - 1])) return out;
      let len = 0;
      while (i + len < n && !articleIsHanChar(q[i + len])) len++;
      if (len >= ARTICLE_SEG_MIN_NONHAN) {
        const t = q.slice(i, i + len);
        const df = dfOf(t);
        if (df > 0) out.push({ t, df, han: false });
      }
    }
    return out;
  };

  const best = new Array(n + 1).fill(null);
  best[0] = { score: 0, terms: [] };
  for (let i = 0; i < n; i++) {
    const cur = best[i];
    if (!cur) continue;
    // ① 忽略一个字符（匹配不到的部分，比如 666 这种尾巴）
    const skip = { score: cur.score - ARTICLE_SEG_SKIP, terms: cur.terms };
    if (!best[i + 1] || skip.score > best[i + 1].score) best[i + 1] = skip;
    // ② 取一个候选词
    for (const c of candidatesAt(i)) {
      const w = weightOf(c.t, c.df);
      const cand = { score: cur.score + w, terms: cur.terms.concat([{ t: c.t, w, han: c.han }]) };
      const at = i + c.t.length;
      if (!best[at] || cand.score > best[at].score) best[at] = cand;
    }
  }
  const r = best[n];
  if (!r) return [];
  // 同一个词被切出两次时只留一个
  const seen = new Set(), out = [];
  for (const x of r.terms) {
    const k = x.t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// 用一组词去搜。requireAll=true 是 AND（每个词都要命中），false 是 OR。
// ★ terms 长度为 1 时，行为与改动前的整串搜索**逐字节一致**：
//   matchType / matchedTerms / matchedField / score 的取法全部照旧，
//   排序里多出来的 covered 在单词时恒为 1，不影响顺序。
function articleSearchWithTerms(articles, terms, useBody, ranked, requireAll) {
  const prepared = terms.map(t => {
    const kw = t.toLowerCase();
    return { kw, exps: getArticleExpansions(t).filter(e => e.toLowerCase() !== kw) };
  });

  const out = [];
  for (const a of articles) {
    const title = (a.title || '').toLowerCase();
    const body = useBody ? (articlePlainTextCache[a.contentPath] || '').toLowerCase() : '';

    let score = 0, covered = 0, hitInTitle = false, literalAny = false, literalInTitle = false;
    const hits = [];
    // ★ 高亮用：每个真正命中的词，连同"是精准命中还是同义命中"一起记下来，
    //   这样"澳门荷花666"这种查询也能把「澳门」「荷花」按精准色高亮出来。
    const hl = [];

    for (const p of prepared) {
      const litT = title.includes(p.kw);
      const litB = useBody && body.includes(p.kw);
      const r = articleRelevanceScore(title, body, p.kw, p.exps);
      if (!litT && !litB && !r.hits.length) continue;

      covered++;
      score += r.score;
      if (litT || litB) {
        literalAny = true;
        if (litT) literalInTitle = true;
        hl.push({ t: p.kw, exact: true });
      } else {
        for (const h of r.hits) hl.push({ t: h, exact: false });
      }
      if (litT || r.hitInTitle) hitInTitle = true;
      for (const h of r.hits) hits.push(h);
    }

    if (!covered) continue;
    if (requireAll && covered < prepared.length) continue;

    const isLiteral = literalAny;
    out.push({
      article: a,
      matchType: isLiteral ? 'literal' : 'expanded',
      matchedTerms: isLiteral ? [] : [...new Set(hits)],
      matchedField: isLiteral ? (literalInTitle ? 'title' : 'body') : (hitInTitle ? 'title' : 'body'),
      score: ranked ? score : undefined,
      covered,
      highlightTerms: hl
    });
  }

  // 模糊开：**只按相关性**排。多词时先按"命中了几个词"（覆盖率），再按相关性；
  // 分数并列时用命中词数、再退到默认顺序 —— 只是为了结果稳定可复现。
  if (ranked) {
    out.sort((x, y) => (y.covered - x.covered)
      || (y.score - x.score)
      || (y.matchedTerms.length - x.matchedTerms.length)
      || (collectedArticles.indexOf(x.article) - collectedArticles.indexOf(y.article)));
  }

  return out;
}

// ★ 兜底阶梯。**只在整串搜索 0 条时**才走这里。
//   每一步都先试更精确的，所以结果只可能变好：
//     ① 全部词 AND                → 最精确（"澳门荷花" → 澳门 AND 荷花）
//     ② 丢掉全部非汉字词再 AND     → ★ "澳门荷花666" / "生肖钞999" 的尾巴在这里被丢掉
//     ③ 按权重从低到高逐个丢汉字词再 AND
//     ④ 都不行 → OR 全部词（覆盖率 + 相关性排序）
function articleSegmentedSearch(articles, useBody, ranked) {
  const q = (articleSearchKeyword || '').trim();
  if (!q) return null;

  // 预算一次小写正文，供 df 计算复用（否则每个候选词都要对整篇正文 toLowerCase）
  const hay = articles.map(a => ({
    title: (a.title || '').toLowerCase(),
    body: useBody ? (articlePlainTextCache[a.contentPath] || '').toLowerCase() : ''
  }));

  const seg = articleSegmentQuery(q, hay);
  if (!seg.length) return null;

  const and = (list) => articleSearchWithTerms(articles, list.map(x => x.t), useBody, ranked, true);

  // ① 全部词 AND
  let r = and(seg);
  if (r.length) return r;

  const han = seg.filter(x => x.han);
  const nonHan = seg.filter(x => !x.han);

  // ② 丢掉全部非汉字词再 AND
  if (nonHan.length && han.length) {
    r = and(han);
    if (r.length) return r;
  }

  // ③ 按权重从低到高逐个丢词再 AND（丢到只剩一个为止）
  const cur = (han.length ? han : seg).slice();
  while (cur.length > 1) {
    let low = 0;
    for (let i = 1; i < cur.length; i++) if (cur[i].w < cur[low].w) low = i;
    cur.splice(low, 1);
    r = and(cur);
    if (r.length) return r;
  }

  // ④ 兜底：OR 全部词
  return articleSearchWithTerms(articles, seg.map(x => x.t), useBody, ranked, false);
}

// entries: getFilteredArticles() 返回的条目数组。
// ★ 模糊开（条目带 score）→ **单一列表，只按相关性排序**，不分组。
// ★ 模糊关（条目不谈 score）→ 与改动前**完全一样**：按分类分组、保持默认顺序，
//   所以关掉模糊时观感与原来逐像素一致。
function buildArticleFlatList(entries, keyword) {
  const flatList = [];

  if (entries.length && entries.every(e => typeof e.score === 'number')) {
    for (const e of entries) {
      flatList.push({
        // ★ 键仍是 article|<序号>，与改动前一致 —— FLIP 的复用/位移动画不受影响。
        key: `article|${collectedArticles.indexOf(e.article)}`,
        type: 'item',
        data: {
          article: e.article,
          keyword,
          matchType: e.matchType,
          matchedTerms: e.matchedTerms,
          matchedField: e.matchedField,
          // ★ 每个真正命中的词 + "精准还是同义"，供标题/摘要高亮按词上色。
          //   多关键词（分词兜底）时它和 keyword 不是一个东西，所以必须单独传。
          highlightTerms: e.highlightTerms
        }
      });
    }
    return flatList;
  }

  const groupMap = new Map();
  for (const e of entries) {
    const key = e.article.groupPath ? e.article.groupPath.join(' - ') : '未分类';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(e);
  }
  for (const groupName of groupMap.keys()) {
    const items = groupMap.get(groupName);
    flatList.push({
      key: `group|${groupName}`,
      type: 'group',
      data: { label: groupName, count: items.length }
    });
    for (const e of items) {
      flatList.push({
        key: `article|${collectedArticles.indexOf(e.article)}`,
        type: 'item',
        data: {
          article: e.article,
          keyword,
          matchType: e.matchType,
          matchedTerms: e.matchedTerms,
          matchedField: e.matchedField,
          // ★ 每个真正命中的词 + "精准还是同义"，供标题/摘要高亮按词上色。
          //   多关键词（分词兜底）时它和 keyword 不是一个东西，所以必须单独传。
          highlightTerms: e.highlightTerms
        }
      });
    }
  }
  return flatList;
}

function renderArticleGroupElement(data) {
  const countHtml = `<span class="count" style="font-weight:normal; color:var(--text-secondary); margin-left:auto; font-size:0.7rem;">${data.count}篇</span>`;

  // 分类标题。模糊开启时列表是纯相关性顺序、不会有分类标题；
  // 只有模糊关闭时才走到这里（与改动前完全一致）。
  return `<div class="search-result-group" data-key="group|${escapeHtml(data.label)}" style="margin: 0 !important; padding: 0 !important; width: 100%;">
    <div class="search-group-header" style="display:flex; align-items:center; gap:4px; padding: 1px 6px !important; background:var(--sidebar-bg); border-radius:4px; font-size:0.8rem; font-weight:bold; margin: 0 !important; width:100%; box-sizing:border-box; line-height:1.4;">
      <span>${escapeHtml(data.label)}</span>
      ${countHtml}
    </div>
  </div>`;
}

function renderArticleItemElement(data) {
  const article = data.article;
  const keyword = data.keyword || '';
  const isExpanded = data.matchType === 'expanded';
  const terms = Array.isArray(data.matchedTerms) ? data.matchedTerms : [];
  // ★ 高亮用的词表：[{ t, exact }]。由 getFilteredArticles 给出 ——
  //   单关键词时它就等价于原来的"精准用 keyword、同义用 matchedTerms"，
  //   多关键词（分词兜底）时 keyword 是"澳门荷花666"这种整串、根本匹配不上，
  //   所以必须按**实际命中的那几个词**来高亮，且各自带自己的颜色。
  const hlTerms = Array.isArray(data.highlightTerms) && data.highlightTerms.length ? data.highlightTerms : null;

  // 标题高亮：精准命中金色；同义命中同色系浅一档（见 HL_SYNONYM_STYLE），
  // 这样用户一眼能看出"为什么这条会出现"（标题里并没有他打的字）。
  const titleHtml = hlTerms
    ? highlightAny(escapeHtml(article.title), hlTerms, keyword)
    : highlightText(escapeHtml(article.title), keyword);

  const pathHtml = article.fullPath ? escapeHtml(article.fullPath.join(' > ')) : '';

  let snippetHtml = '';
  // ★ 正文摘要**只在全文模式下**出现（用户报的问题）。
  //   原来的条件是 `keyword && articlePlainTextCache[...]` —— 没看搜索模式，
  //   于是标题搜索里，只要后台 preloadAllArticles() 恰好把这篇的正文缓存好了，
  //   就会冒出一行"内容匹配"摘要（那是全文搜索的样式），
  //   而且这一行还会随预加载进度忽隐忽现。
  //   现在口径与 getFilteredArticles() 的过滤口径一致：标题模式只认标题，
  //   摘要这一行只在 fulltext 下出现。
  //   （同义/多词命中沿用同一口径：探针换成"在正文里命中的那个词"。）
  if (keyword && articleSearchMode === 'fulltext' && articlePlainTextCache[article.contentPath]) {
    const plain = articlePlainTextCache[article.contentPath];
    const probes = hlTerms ? hlTerms.map(x => x.t) : terms;
    const probe = isExpanded
      ? (probes.find(t => t && plain.toLowerCase().includes(t.toLowerCase())) || '')
      : keyword;
    if (probe) {
      const snippet = getContextSnippet(plain, probe);
      if (snippet) {
        const body = hlTerms ? highlightAny(escapeHtml(snippet), hlTerms, keyword) : highlightText(escapeHtml(snippet), keyword);
        snippetHtml = `<div class="article-snippet" style="font-size:0.7rem; color:var(--text-secondary); margin-top:2px; padding:2px 6px; background:var(--bg-light); border-radius:3px; border-left:2px solid var(--theme-light); line-height:1.3;">${body}</div>`;
      }
    }
  }

  // ★ 这里原本有一行小字，把命中的同义词列出来解释"这条为什么会出现"。
  //   已按用户要求删掉：**不要把实际按什么搜的告诉用户**。
  //   同理，多关键词/分词/放宽这类机制以后也不要加任何说明性文案 ——
  //   列表就只呈现结果本身。

  const idx = collectedArticles.indexOf(article);

  return `<div class="search-result-item" data-key="article|${idx}"
            onclick="openArticleReader(${idx})"
            style="display: flex; align-items: center; gap: 4px !important; width: 100% !important; box-sizing: border-box; cursor: pointer; padding: 2px 6px !important; margin: 0 !important; background: transparent; border-radius: 3px; transition: background 0.15s; border: none; outline: none; flex-wrap: wrap;">
    <div class="info" style="flex: 1 1 0; min-width: 0; overflow: hidden; line-height:1.3;">
      <div class="name" style="font-weight: bold; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin:0;">${titleHtml}</div>
      <div class="article-category" style="font-size:0.7rem; color:var(--text-secondary); margin:0;">${pathHtml}</div>
      ${snippetHtml}
    </div>
    <div class="index-num" style="flex-shrink: 0; margin-left: auto; padding-left: 6px; font-size: 0.65rem; color: var(--text-secondary); text-align: right; line-height:1;">#${idx + 1}</div>
  </div>`;
}

// ★ 渲染世代号：每重建一次列表就自增，供异步回调判断自己是否已过期。
//   与 search.js 里 `searchRenderGeneration` 是同一类问题的同一套收口方式：
//   空状态的 400ms 定时器 + FLIP 的 requestAnimationFrame 都可能被更新的渲染抢先，
//   旧回调一旦落地就会覆盖新结果、或按旧位置表去改新 DOM。
//   （复现路径：搜「2222」无结果 → 快速连删两个 2 回到「222」有 10 条 →
//     旧的"还没有文章哦"定时器醒来把 10 条抹掉。）
let articleRenderGeneration = 0;

function reconcileArticleWithFLIP(wrapper, oldKeyMap, newFlatList, container, savedScrollTop) {
  const generation = ++articleRenderGeneration;

  // 清理残留的删除节点
  const absNodes = document.querySelectorAll('.article-delete-anim');
  for (const node of absNodes) node.remove();

  // ★ 不再把滚动强制归零 —— 那是配合旧做法（整表清空、全部当作新增）的。
  //   现在做真正的增量 FLIP：保留项位移、删除项飞出、新增项滑入，滚动位置必须全程保持，
  //   否则前后两次测量的基准不一致，用户正在阅读的位置也会丢。
  //   重建 DOM 会让浏览器重置/锚定滚动，统一在这里拉回。
  const keepScroll = function () {
    if (container.scrollTop !== savedScrollTop) container.scrollTop = savedScrollTop;
  };
  keepScroll();
  void container.offsetHeight;
  const containerRect = container.getBoundingClientRect();

  const oldRects = new Map();
  for (const child of wrapper.children) {
    const key = child.dataset.key;
    if (key) {
      const rect = child.getBoundingClientRect();
      oldRects.set(key, {
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height
      });
    }
  }

  const newKeySet = new Set(newFlatList.map(item => item.key));
  const oldKeys = Array.from(oldKeyMap.keys());
  const deleteKeys = oldKeys.filter(k => !newKeySet.has(k));
  const retainKeys = oldKeys.filter(k => newKeySet.has(k));

  const deleteElements = [];

  for (const key of deleteKeys) {
    const el = oldKeyMap.get(key);
    if (!el) continue;
    const oldRect = oldRects.get(key);
    if (!oldRect) continue;

    const left = containerRect.left + oldRect.left;
    const top = containerRect.top + oldRect.top;

    el.remove();
    el.classList.add('article-delete-anim');
    el.style.position = 'fixed';
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = oldRect.width + 'px';
    el.style.margin = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '100';
    el.style.transition = 'none';
    el.style.transform = 'translate(0,0)';
    el.style.opacity = '1';
    document.body.appendChild(el);

    void el.offsetHeight;
    el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    el.style.transform = 'translateX(40px)';
    el.style.opacity = '0';

    const onFinish = () => {
      el.removeEventListener('transitionend', onFinish);
      if (el.parentNode) el.remove();
    };
    el.addEventListener('transitionend', onFinish);
    deleteElements.push(el);
  }

  if (newFlatList.length === 0) {
    wrapper.innerHTML = '';
    setTimeout(() => {
      // ★ 过期就直接放弃（详见上面 articleRenderGeneration 的说明）
      if (generation !== articleRenderGeneration) return;
      wrapper.innerHTML = `<div class="empty-state">还没有文章哦，赶快连夜肝一篇出来╮(╯▽╰)╭</div>`;
      for (const el of deleteElements) {
        if (el.parentNode) el.remove();
      }
    }, 400);
    return;
  }

  const finalNodes = [];
  for (const item of newFlatList) {
    let el;
    if (oldKeyMap.has(item.key)) {
      el = oldKeyMap.get(item.key);
      el.innerHTML = item.type === 'group' ? renderArticleGroupElement(item.data) : renderArticleItemElement(item.data);
      // 增量更新会重建节点；缓存命中的图立即标为已加载，避免每次输入都重新淡入
      if (typeof sweepLoadedImages === 'function') sweepLoadedImages(el);
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.margin = '';
      el.style.pointerEvents = '';
      el.style.zIndex = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.transition = '';
      el.classList.remove('article-delete-anim');
    } else {
      el = document.createElement('div');
      el.dataset.key = item.key;
      if (item.type === 'group') {
        el.className = 'search-result-group';
        el.innerHTML = renderArticleGroupElement(item.data);
        el.style.opacity = '1';
        el.style.transform = '';
      } else {
        el.className = 'search-result-item';
        el.innerHTML = renderArticleItemElement(item.data);
        el.style.transition = 'none';
        el.style.transform = 'translateX(40px)';
        el.style.opacity = '0';
      }
    }
    finalNodes.push(el);
  }

  wrapper.innerHTML = '';
  for (const el of finalNodes) {
    wrapper.appendChild(el);
  }

  keepScroll();
  void container.offsetHeight;

  requestAnimationFrame(() => {
    // ★ 同一类竞态：这一帧之前若又重建过，下面的 oldRects/oldKeyMap 描述的是
    //   **上一版** DOM 的位置，照着它给现在的节点加位移会让条目乱飞。交给最新那一代。
    if (generation !== articleRenderGeneration) return;
    keepScroll();
    void container.offsetHeight;
    const containerRect2 = container.getBoundingClientRect();

    const newRects = new Map();
    for (const key of retainKeys) {
      const el = oldKeyMap.get(key);
      if (el && el.parentNode) {
        const rect = el.getBoundingClientRect();
        newRects.set(key, {
          top: rect.top - containerRect2.top,
          left: rect.left - containerRect2.left
        });
      }
    }

    const clientH = container.clientHeight || container.offsetHeight;
    const fadeDelay = '0.22s';

    for (const key of retainKeys) {
      const el = oldKeyMap.get(key);
      if (!el || !el.parentNode) continue;
      const oldRect = oldRects.get(key);
      const newRect = newRects.get(key);
      if (!oldRect || !newRect) continue;

      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      const wasVisible = oldRect.top < clientH;

      if (dx === 0 && dy === 0) continue;

      if (!wasVisible) {
        el.style.transition = 'none';
        el.style.transform = '';
        el.style.opacity = '0';
        void el.offsetHeight;
        el.style.transition = 'opacity 0.2s ease';
        el.style.transitionDelay = fadeDelay;
        el.style.opacity = '1';
        const clearDelay = () => {
          el.removeEventListener('transitionend', clearDelay);
          el.style.transition = '';
          el.style.transitionDelay = '';
        };
        el.addEventListener('transitionend', clearDelay);
        continue;
      }

      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.opacity = '1';
      void el.offsetHeight;
      el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      el.style.transform = '';
      el.style.opacity = '1';
    }

    for (const item of newFlatList) {
      if (!oldKeyMap.has(item.key) && item.type === 'item') {
        const el = wrapper.querySelector(`[data-key="${item.key}"]`);
        if (el) {
          void el.offsetHeight;
          el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
          el.style.transform = '';
          el.style.opacity = '1';
        }
      }
    }
  });

  setTimeout(() => {
    for (const el of deleteElements) {
      if (el.parentNode) el.remove();
    }
  }, 400);
}

function getFilteredArticles() {
  let articles = [];
  if (currentArticleCategory === 'all') {
    articles = [...collectedArticles];
  } else {
    const isParent = articleCategoryTree.some(cat => cat.id === currentArticleCategory && cat.children && cat.children.length > 0);
    if (isParent) {
      const parentCat = articleCategoryTree.find(c => c.id === currentArticleCategory);
      const subKeys = parentCat && parentCat.children ? parentCat.children.map(s => s.dataKey || s.id) : [];
      articles = collectedArticles.filter(a => subKeys.includes(a.dataKey));
    } else {
      let targetDataKey = null;
      for (const cat of articleCategoryTree) {
        if (cat.id === currentArticleCategory) { targetDataKey = cat.dataKey || null; break; }
        if (cat.children) {
          for (const sub of cat.children) {
            if (sub.id === currentArticleCategory) { targetDataKey = sub.dataKey; break; }
          }
          if (targetDataKey) break;
        }
      }
      if (targetDataKey) {
        let targetSource = null;
        for (const cat of categoryTree) {
          if (cat.id === currentArticleCategory) { targetSource = MODE.NOTES; break; }
          if (cat.children) {
            for (const sub of cat.children) {
              if (sub.id === currentArticleCategory) { targetSource = MODE.NOTES; break; }
            }
            if (targetSource) break;
          }
        }
        if (!targetSource) {
          for (const cat of coinCategoryTree) {
            if (cat.id === currentArticleCategory) { targetSource = MODE.COINS; break; }
          }
        }
        if (targetSource) {
          articles = collectedArticles.filter(a => a.dataKey === targetDataKey && a.sourceType === targetSource);
        } else {
          articles = collectedArticles.filter(a => a.dataKey === targetDataKey);
        }
      } else {
        articles = collectedArticles.filter(a => a.category === currentArticleCategory || a.parentCategory === currentArticleCategory);
      }
    }
  }

  // ★ 返回值是「条目数组」：每条带 matchType / matchedTerms / matchedField。
  //   模糊开启时额外带 score，列表据此**只按相关性排序**（见 buildArticleFlatList）；
  //   模糊关闭 / 没关键词时不带 score，顺序就是默认顺序（与改动前一致）。
  if (!articleSearchKeyword) {
    return articles.map(a => ({ article: a, matchType: 'literal', matchedTerms: [], matchedField: 'title' }));
  }

  const useBody = (articleSearchMode === 'fulltext');
  const ranked = articleFuzzyOn();

  // 整串搜索 —— 与改动前**逐字节一致**的那条路径（单词、AND 退化为单条件）。
  let out = articleSearchWithTerms(articles, [articleSearchKeyword], useBody, ranked, true);

  // ★ 兜底阶梯：**只在整串搜索 0 条时**才介入。
  //   这条判断是整个改动的安全阀：现在能用的搜索一次都不会被碰到，
  //   功能只可能"多搜出来"，不可能变差。
  //   用户的两个例子：
  //     「澳门荷花」    → 切成 澳门 + 荷花，AND → 命中
  //     「澳门荷花666」 → 666 匹配不到，被当成尾巴丢掉 → 澳门 AND 荷花 → 命中
  if (!out.length) {
    const fb = articleSegmentedSearch(articles, useBody, ranked);
    if (fb && fb.length) out = fb;
  }

  return out;
}

// ========== 主渲染函数（支持滚动保留） ==========
function renderArticleList(resetScroll = false, keepScroll = null) {
  currentArticleView = VIEW.LIST;
  switchToCurrentContainer();

  // ★ 同义词表在进文章板块时就后台拉一次（文件很小，失败静默降级）。
  //   拉到之后如果用户已经在搜了，补一次渲染，让扩展词立刻参与召回与排序 ——
  //   否则第一次搜索会因为没有表而退化成纯词法，用户以为功能没生效。
  //   articleSynonymPromise 是记忆化的，所以失败后不会反复重试、也不会递归。
  if (!articleSynonymPromise) {
    loadArticleSynonyms().then(() => { if (articleSearchKeyword && currentArticleView === VIEW.LIST) renderArticleList(); });
  }

  const container = getRenderContainer();
  container.style.position = 'relative';
  container.style.overflowX = 'hidden';
  container.style.overflowY = 'auto';
  container.style.boxSizing = 'border-box';
  container.style.width = '100%';

  // ★ 保存当前滚动位置，若重置则置为0。
  //   keepScroll 用于"列表 DOM 已被调用方清空/重建"的情况（见 enterArticlesTab）：
  //   那时 container.scrollTop 已经被清空成 0，直接读会把要恢复的位置丢掉，
  //   所以由调用方把清空**之前**量到的位置传进来。
  const savedScrollTop = resetScroll ? 0 : (keepScroll !== null ? keepScroll : container.scrollTop);

  ensureArticleStaticHeader(container);

  const articles = getFilteredArticles();
  updateArticleMeta(articles.length);

  const wrapper = ensureArticleDynamicWrapper(container);
  wrapper.style.overflowX = 'hidden';
  wrapper.style.overflowY = 'hidden';

  // ★ 增量 FLIP：按 data-key 复用已有节点，让保留项位移、删除项飞出、新增项滑入
  //   —— 与搜索列表同一套做法（原来这里整表清空，导致每次渲染全列表重播滑入动画）。
  const oldKeyMap = new Map();
  for (const child of wrapper.children) {
    const key = child.dataset.key;
    if (key) oldKeyMap.set(key, child);
  }

  const newFlatList = buildArticleFlatList(articles, articleSearchKeyword);

  reconcileArticleWithFLIP(wrapper, oldKeyMap, newFlatList, container, savedScrollTop);

  // ★ 兜底恢复滚动位置（reconcile 内部已全程保持，这里再确认一次）
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (container.scrollTop !== savedScrollTop) container.scrollTop = savedScrollTop;
    });
  });
}

// ========== 其他原有函数 ==========

function getContextSnippet(plainText, keyword) {
  if (!plainText || !keyword) return '';
  const lower = plainText.toLowerCase();
  const kwLower = keyword.toLowerCase();
  const idx = lower.indexOf(kwLower);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 20);
  const end = Math.min(plainText.length, idx + keyword.length + 20);
  let snippet = plainText.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < plainText.length) snippet = snippet + '...';
  return snippet;
}

// ★ 高亮的两种颜色。
//   用户要求：非精准（同义）命中的高亮要能区分出来，但"不要太大的视觉差异"。
//   所以只用**同一色系里更浅的一档**，形状、内边距、字色完全一致 ——
//   远看是一类东西，近看能分辨。
//   精准命中 = 金色（原样未动）；同义命中 = 同色系浅一档。
//   另挂 class 作为钩子，方便验收脚本分别数出两类高亮各有几个。
const HL_EXACT_STYLE = 'background:#ffd700;padding:0 2px;border-radius:2px;color:#000;';
const HL_SYNONYM_STYLE = 'background:#ffe9a0;padding:0 2px;border-radius:2px;color:#000;';

function highlightText(text, keyword) {
  if (!keyword) return text;
  const escapedKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(' + escapedKw + ')', 'gi');
  // 用函数式替换而不是 '$1'：替换串里的 $ 不会被二次解释，更安全
  return text.replace(regex, (m) => `<mark class="article-hl-exact" style="${HL_EXACT_STYLE}">${m}</mark>`);
}

// 一次高亮多个词（同义 / 多关键词命中时用：标题里出现的不是用户打的整串）。
// 长的排前面，避免「中国人民银行」被「银行」先切碎。
//
// terms 支持两种元素：
//   · 字符串        —— 是否用精准色由"它是否等于 keyword"自动判定（原来的用法）
//   · { t, exact }  —— 显式指定颜色。多关键词时用户打的是「澳门荷花666」这种整串，
//                      实际命中的是「澳门」「荷花」两个词，靠字符串比较判不出精准，
//                      必须由 getFilteredArticles 逐个标好。
function highlightAny(text, terms, keyword) {
  if (!text || !terms || !terms.length) return text;
  const kwLower = (keyword || '').toLowerCase();
  const colorOf = new Map();     // 小写词 → 是否精准色
  for (const x of terms) {
    const t = (typeof x === 'string') ? x : (x && x.t);
    if (typeof t !== 'string' || !t) continue;
    const k = t.toLowerCase();
    if (colorOf.has(k)) continue;
    colorOf.set(k, (typeof x === 'string') ? !!(kwLower && k === kwLower) : !!x.exact);
  }
  const keys = [...colorOf.keys()].sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const regex = new RegExp('(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.replace(regex, (m) => {
    const isExact = colorOf.get(m.toLowerCase());
    return isExact
      ? `<mark class="article-hl-exact" style="${HL_EXACT_STYLE}">${m}</mark>`
      : `<mark class="article-hl-synonym" style="${HL_SYNONYM_STYLE}">${m}</mark>`;
  });
}

function openArticleReader(index, restoreScroll) {
  const listContainer = viewScrollContainers['articles_list'];
  if (listContainer) {
    articleState.listScrollY = listContainer.scrollTop;
  }

  currentArticleIndex = index;
  currentArticleView = VIEW.READER;
  const article = collectedArticles[index];
  if (!article) return;

  // ★ 写 URL（深链接）：打开文章是这个板块最主要的导航动作，之前**漏了**这一步，
  //   所以点进文章地址栏仍停在 #articles（"深链接不灵敏"的直接原因）。
  //   放在越界检查之后：index 非法时上面已经 return，不会写出一个指向不存在文章的链接。
  syncRoute();

  switchToCurrentContainer();
  const app = getRenderContainer();

  if (articleContentCache[article.contentPath]) {
    renderArticleReader(article, articleContentCache[article.contentPath]);
    app.scrollTop = restoreScroll ? (articleState.readerScrollY || 0) : 0;
    return;
  }

  let html = `<div class="back-bar"><button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button></div>`;
  html += `<div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div><div class="empty-state">全力加载中……</div>`;
  app.innerHTML = html;

  let filePath = article.contentPath;
  if (filePath.startsWith('file:')) filePath = filePath.substring(5);
  const basePath = getArticleBasePath(article.sourceType);

  fetch(basePath + filePath, { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('加载失败'); return response.text(); })
    .then(content => {
      articleContentCache[article.contentPath] = content;
      articlePlainTextCache[article.contentPath] = stripHtml(content);
      if (currentArticleView === VIEW.READER && currentArticleIndex === index) {
        renderArticleReader(article, content);
        app.scrollTop = restoreScroll ? (articleState.readerScrollY || 0) : 0;
      }
    })
    .catch(() => {
      if (currentArticleView === VIEW.READER && currentArticleIndex === index) {
        app.innerHTML =
          `<div class="back-bar">` +
          `<button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button>` +
          `<button class="back-btn" onclick="reloadArticle()" style="margin-left:8px;">⟳ 重新加载</button>` +
          `</div>` +
          `<div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div>` +
          `<div class="empty-state">文章不见了哦~</div>`;
      }
    });
}

function renderArticleReader(article, content) {
  const app = getRenderContainer();
  let htmlContent = content;
  const imageBase = getArticleBasePath(article.sourceType) + 'readmes/image/';
  htmlContent = htmlContent.replace(/(src\s*=\s*["']?)\s*readmes\/image\//gi, '$1' + imageBase);

  let html = `<div class="back-bar">`;
  html += `<button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button>`;
  html += `<button class="back-btn" onclick="reloadArticle()" style="margin-left:8px;">⟳ 重新加载</button>`;
  html += `</div>`;
  html += `<div class="article-reader">${htmlContent}</div>`;
  app.innerHTML = html;
  requestAnimationFrame(() => { app.classList.remove('content-enter'); void app.offsetWidth; app.classList.add('content-enter'); });
}

function closeArticleReader() {
  // ★ 收口写 URL（返回列表 → 地址栏回到 #articles）
  try {
    closeArticleReaderInner();
  } finally {
    if (typeof syncRoute === 'function') syncRoute();
  }
}

function closeArticleReaderInner() {
  currentArticleView = VIEW.LIST;
  // 切换到列表时不重置滚动（保留原有位置）
  switchToCurrentContainer();
  renderArticleList(false); // 不重置滚动
  const listContainer = getRenderContainer();
  if (articleState.listScrollY > 0) {
    requestAnimationFrame(() => {
      listContainer.scrollTop = articleState.listScrollY;
    });
  }
}

function reloadArticle() {
  const article = collectedArticles[currentArticleIndex];
  if (!article) return;
  delete articleContentCache[article.contentPath];
  delete articlePlainTextCache[article.contentPath];
  openArticleReader(currentArticleIndex);
}