// ==================== article.js ====================
// 完整重构版：增量渲染 + FLIP 动画，保留高亮

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
  const top = sourceType === MODE.COINS ? '硬币' : '纸币';
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
  const top = sourceType === MODE.COINS ? '硬币' : '纸币';
  const parts = [top];
  if (catInfo.parentCategory && catInfo.parentCategory !== top && catInfo.parentCategory !== catInfo.category) {
    parts.push(catInfo.parentCategory);
  }
  parts.push(catInfo.category);
  return parts;
}

function findArticleCategoryInfo(dataKey, sourceType) {
  if (sourceType === MODE.COINS) {
    for (const cat of coinCategoryTree) {
      if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: '硬币' };
      if (cat.children) {
        for (const sub of cat.children) {
          if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
        }
      }
    }
  }
  for (const cat of categoryTree) {
    if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: '纸币' };
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
      }
    }
  }
  if (sourceType !== MODE.COINS) {
    for (const cat of coinCategoryTree) {
      if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: '硬币' };
      if (cat.children) {
        for (const sub of cat.children) {
          if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
        }
      }
    }
  }
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
    return 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/coincollection/';
  }
  return 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/';
}

async function preloadAllArticles() {
  if (isArticlePreloading) return;
  isArticlePreloading = true;
  const tip = document.getElementById('searchTip');
  if (tip) tip.textContent = '当前模式为全字段索引（实时搜索），点击“全”字可以切换为按标题索引 | 请先等待全文搜索准备就绪，我们正在全力加载……';
  const promises = collectedArticles.map(article => preloadArticle(article));
  await Promise.allSettled(promises);
  isArticlePreloading = false;
  if (tip) tip.textContent = '当前模式为全字段索引（实时搜索），点击“全”字可以切换为按标题索引 | 全文索引已就绪，可根据标题和正文内容进行检索';
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

function toggleArticleSearchMode() {
  if (articleSearchMode === 'title') {
    articleSearchMode = 'fulltext';
    const input = document.getElementById('searchInput');
    if (input) { input.removeEventListener('input', doSearch); input.addEventListener('input', doSearch); }
    preloadAllArticles().then(() => { if (articleSearchKeyword) renderArticleList(); });
  } else {
    articleSearchMode = 'title';
    if (articleSearchKeyword) renderArticleList();
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
        // ★ 关键修改：用 .child-text 包裹子项文字
        html += `<div class="sidebar-child ${subActive ? 'active' : ''}" onclick="onArticleSidebarClick('${sub.id}'); event.stopPropagation();"><span class="child-text">${sub.name}</span></div>`;
      }
      html += `</div>`;
    }
  }
  sidebar.innerHTML = html;
  if (typeof fitSidebarLabels === 'function') {
    fitSidebarLabels();
  }
}

function onArticleSidebarClick(categoryId) {
    // 1. 判断点击的是父分类还是子分类
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

    // 2. 点击的是子分类
    if (!isParent) {
        if (currentArticleCategory === categoryId) {
            // 已选中子分类 → 取消选中，回到父分类（显示该父分类下所有文章）
            currentArticleCategory = parentId;
            renderArticleList();
            renderArticleSidebar();
            return;
        }
        // 未选中 → 选中该子分类
        currentArticleCategory = categoryId;
        renderArticleList();
        renderArticleSidebar();
        return;
    }

    // 3. 点击的是父分类
    const parentCat = targetCat;

    // ★ 如果当前选中了这个父分类下的某个子分类 → 关闭父分类，显示全部文章
    if (parentCat.children && parentCat.children.some(sub => sub.id === currentArticleCategory)) {
        currentArticleCategory = 'all';
        renderArticleList();
        renderArticleSidebar();
        return;
    }

    // 如果当前选中的就是这个父分类 → 切换到全部文章
    if (currentArticleCategory === parentCat.id) {
        currentArticleCategory = 'all';
        renderArticleList();
        renderArticleSidebar();
        return;
    }

    // 否则进入该父分类
    currentArticleCategory = parentCat.id;
    renderArticleList();
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

// ★★★★★ 关键修改：移除 .sort()，分组按首次出现顺序（config/收集顺序）排列 ★★★★★
function buildArticleFlatList(articles, keyword) {
  const groupMap = new Map();
  for (const article of articles) {
    const key = article.groupPath ? article.groupPath.join(' - ') : '未分类';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(article);
  }

  const flatList = [];
  // ★ 不要按字符串排序：分组按首次出现顺序展示（纸币→硬币，与 config / 收集顺序一致）
  const sortedGroups = Array.from(groupMap.keys());  // 移除 .sort()
  for (const groupName of sortedGroups) {
    const items = groupMap.get(groupName);
    flatList.push({
      key: `group|${groupName}`,
      type: 'group',
      data: { label: groupName, count: items.length }
    });
    for (const article of items) {
      flatList.push({
        key: `article|${collectedArticles.indexOf(article)}`,
        type: 'item',
        data: { article, keyword }
      });
    }
  }
  return flatList;
}

function renderArticleGroupElement(data) {
  return `<div class="search-result-group" data-key="group|${data.label}" style="margin: 0 !important; padding: 0 !important; width: 100%;">
    <div class="search-group-header" style="display:flex; align-items:center; gap:4px; padding: 1px 6px !important; background:var(--sidebar-bg); border-radius:4px; font-size:0.8rem; font-weight:bold; margin: 0 !important; width:100%; box-sizing:border-box; line-height:1.4;">
      <span>${escapeHtml(data.label)}</span>
      <span class="count" style="font-weight:normal; color:var(--text-secondary); margin-left:auto; font-size:0.7rem;">${data.count}篇</span>
    </div>
  </div>`;
}

function renderArticleItemElement(data) {
  const article = data.article;
  const keyword = data.keyword || '';
  const titleHtml = highlightText(escapeHtml(article.title), keyword);

  const pathHtml = article.fullPath ? escapeHtml(article.fullPath.join(' > ')) : '';

  let snippetHtml = '';
  if (keyword && articlePlainTextCache[article.contentPath]) {
    const snippet = getContextSnippet(articlePlainTextCache[article.contentPath], keyword);
    if (snippet) {
      snippetHtml = `<div class="article-snippet" style="font-size:0.7rem; color:var(--text-secondary); margin-top:2px; padding:2px 6px; background:var(--bg-light); border-radius:3px; border-left:2px solid var(--theme-light); line-height:1.3;">${highlightText(escapeHtml(snippet), keyword)}</div>`;
    }
  }

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

// ★ 使用 getBoundingClientRect + 仅可视区条目做 FLIP
function reconcileArticleWithFLIP(wrapper, oldKeyMap, newFlatList, container) {
  // 清理残留的删除节点
  const absNodes = document.querySelectorAll('.article-delete-anim');
  for (const node of absNodes) node.remove();

  // ★ 强制重置滚动：记录旧位置前
  container.scrollTop = 0;
  void container.offsetHeight;
  const containerRect = container.getBoundingClientRect();

  // 记录旧位置
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

  // 处理删除节点
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

  // ★ 第二次强制重置：重建后，RAF 之前
  container.scrollTop = 0;
  void container.offsetHeight;

  // ★ 第三次：RAF 内部再次强制重置
  requestAnimationFrame(() => {
    container.scrollTop = 0;
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

    // ★ 关键修改：只对删除前在可视区内的条目做 FLIP 位移
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
        // ★ 旧位置在首屏以下：不播超长位移，落到新位置后延迟淡入
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

      // 旧位置可见：正常 FLIP
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

  if (articleSearchKeyword) {
    const kw = articleSearchKeyword.toLowerCase();
    articles = articles.filter(a => {
      if (a.title.toLowerCase().includes(kw)) return true;
      if (articleSearchMode === 'fulltext') {
        const plainText = articlePlainTextCache[a.contentPath] || '';
        if (plainText.toLowerCase().includes(kw)) return true;
      }
      return false;
    });
  }
  return articles;
}

// ========== 主渲染函数 ==========
function renderArticleList() {
  currentArticleView = VIEW.LIST;
  switchToCurrentContainer();

  const container = getRenderContainer();
  container.style.position = 'relative';
  container.style.overflowX = 'hidden';
  container.style.overflowY = 'auto';
  container.style.boxSizing = 'border-box';
  container.style.width = '100%';

  container.scrollTop = 0;
  void container.offsetHeight;

  ensureArticleStaticHeader(container);

  const articles = getFilteredArticles();
  updateArticleMeta(articles.length);

  const wrapper = ensureArticleDynamicWrapper(container);
  wrapper.style.overflowX = 'hidden';
  wrapper.style.overflowY = 'hidden';

  // ★★★ 关键修复：强制清空容器，使所有条目被视为“新增” ★★★
  // 这样每次切换回文章列表，所有条目都会从右侧滑入
  wrapper.innerHTML = '';
  const oldKeyMap = new Map(); // 空 Map，无旧节点

  const newFlatList = buildArticleFlatList(articles, articleSearchKeyword);

  reconcileArticleWithFLIP(wrapper, oldKeyMap, newFlatList, container);
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

function highlightText(text, keyword) {
  if (!keyword) return text;
  const escapedKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(' + escapedKw + ')', 'gi');
  return text.replace(regex, '<mark style="background:#ffd700;padding:0 2px;border-radius:2px;color:#000;">$1</mark>');
}

function openArticleReader(index, restoreScroll) {
  const listContainer = viewScrollContainers['articles_list'];
  if (listContainer) {
    articleState.listScrollY = listContainer.scrollTop;
    scrollMemory['articles-articles_list'] = listContainer.scrollTop;
  }

  currentArticleIndex = index;
  currentArticleView = VIEW.READER;
  const article = collectedArticles[index];
  if (!article) return;

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
  currentArticleView = VIEW.LIST;
  switchToCurrentContainer();
  renderArticleList();
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