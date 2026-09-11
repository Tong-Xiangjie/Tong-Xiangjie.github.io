// ==================== search.js ====================
// 最终版：增量渲染 + FLIP 动画 + 极致紧凑 + 图片恢复正常

// ---------- 全局状态 ----------
let prevSearchResults = null;
let prevSearchKeyword = '';
let isFirstSearch = true;

// ---------- 静态头部 ----------
function ensureSearchStaticHeader(container) {
  let header = container.querySelector('.search-static-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'search-static-header';
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
      <div class="back-bar" style="margin:0; padding:2px 0;">
        <button class="back-btn" onclick="backFromSearch()" style="padding:2px 10px; font-size:0.8rem;">← 返回</button>
      </div>
      <div class="panel-header" style="margin:0; padding:0 0 2px 0;">
        <h2 id="searchModeLabel" style="margin:0; font-size:1.1rem;">${currentMode === MODE.NOTES ? '纸币' : '硬币'}板块搜索结果</h2>
        <p id="resultMeta" style="margin:2px 0 0 0; font-size:0.8rem;">共找到0件符合要求的藏品</p>
      </div>
    `;
    container.prepend(header);
  }
  return header;
}

function updateSearchMeta(count, keyword) {
  const meta = document.getElementById('resultMeta');
  if (meta) {
    let text = `共找到${count}件符合要求的藏品`;
    if (keyword) text += ` · 搜索关键词：${escapeHtml(keyword)}`;
    meta.textContent = text;
  }
}

// ---------- 动态包装器 ----------
function ensureDynamicWrapper(container) {
  let wrapper = container.querySelector('.search-dynamic-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'search-dynamic-wrapper';
    wrapper.style.cssText = 'position: relative; width: 100%; height: auto; max-height: none; overflow: visible;';
    container.appendChild(wrapper);
  }
  return wrapper;
}

// ---------- 构建扁平列表 ----------
function buildNewFlatList(results, keyword) {
  const groupMap = new Map();
  for (const item of results) {
    if (!groupMap.has(item.dataKey)) groupMap.set(item.dataKey, []);
    groupMap.get(item.dataKey).push(item);
  }

  const flatList = [];
  const allKeys = getAllDataKeys();
  for (const dataKey of allKeys) {
    const items = groupMap.get(dataKey);
    if (!items || items.length === 0) continue;

    const first = items[0];
    const label = first.parentName ? `${first.parentName} - ${first.catName}` : first.catName;
    flatList.push({
      key: `group|${dataKey}`,
      type: 'group',
      data: { label, count: items.length, dataKey }
    });

    for (const item of items) {
      flatList.push({
        key: getItemKey(item),
        type: 'item',
        data: { item, index: results.indexOf(item) + 1, keyword }
      });
    }
  }
  return flatList;
}

function getItemKey(item) {
  if (item.hasVarieties) {
    return `${item.dataKey}|s${item.sIdx}|v${item.vIdx}|c${item.cIdx}`;
  } else {
    return `${item.dataKey}|s${item.sIdx}|c${item.cIdx}`;
  }
}

// ---------- 渲染元素 ----------
function renderGroupElement(data) {
  return `<div class="search-result-group" data-key="group|${data.dataKey}" style="margin: 0 !important; padding: 0 !important; width: 100%;">
    <div class="search-group-header" style="display:flex; align-items:center; gap:4px; padding: 1px 6px !important; background:var(--sidebar-bg); border-radius:4px; font-size:0.8rem; font-weight:bold; margin: 0 !important; width:100%; box-sizing:border-box; line-height:1.4;">
      <span>${escapeHtml(data.label)}</span>
      <span class="count" style="font-weight:normal; color:var(--text-secondary); margin-left:auto; font-size:0.7rem;">${data.count}件</span>
    </div>
  </div>`;
}

function renderItemElement(data) {
  const item = data.item;
  const copy = item.copy;
  const img1 = getImageUrl(copy.img1);
  const img2 = getImageUrl(copy.img2);
  const thumb1 = getThumbUrl(copy.img1);
  const thumb2 = getThumbUrl(copy.img2);
  const displayName = item.hasVarieties
    ? `${item.series.seriesName} - ${item.variety.varietyName}`
    : item.series.seriesName;
  const catalogNum = copy.catalogNumber || copy.krause || '';
  const catalogDisplay = formatCatalogNumber(catalogNum);

  let detailParts = [];
  if (copy.version) detailParts.push(escapeHtml(copy.version));
  if (copy.condition || copy.grade) detailParts.push(escapeHtml(copy.condition || copy.grade));
  if (copy.year) detailParts.push(copy.year + '年发行');
  if (catalogDisplay) detailParts.push(escapeHtml(catalogDisplay));
  const detailHtml = detailParts.join(' · ');

  let thumbHtml = '';
  if (img1) thumbHtml += `<img class="mini-thumb" src="${thumb1}"${thumbFallbackAttr(img1)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
  if (img2) thumbHtml += `<img class="mini-thumb" src="${thumb2}"${thumbFallbackAttr(img2)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
  if (!img1 && !img2) thumbHtml += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">O_O</div>`;

  const dataKey = item.dataKey;
  const si = item.sIdx;
  const vi = item.hasVarieties ? item.vIdx : 'null';
  const ci = item.cIdx;
  const hasVarieties = item.hasVarieties;

  return `<div class="search-result-item" data-key="${getItemKey(item)}"
            onclick="navigateToCopy('${dataKey}', ${si}, ${vi}, ${ci}, ${hasVarieties})"
            style="display: flex; align-items: center; gap: 4px !important; width: 100% !important; box-sizing: border-box; cursor: pointer; padding: 2px 6px !important; margin: 0 !important; background: transparent; border-radius: 3px; transition: background 0.15s; border: none; outline: none;">
    <div class="dual-thumb" style="flex-shrink: 0; display:flex; gap:2px;">${thumbHtml}</div>
    <div class="info" style="flex: 1 1 0; min-width: 0; overflow: hidden; line-height:1.3;">
      <div class="name" style="font-weight: bold; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin:0;">${escapeHtml(displayName)}</div>
      <div class="detail" style="font-size: 0.7rem; color: var(--text-secondary); line-height:1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin:0;">${detailHtml}</div>
    </div>
    <div class="index-num" style="flex-shrink: 0; margin-left: auto; padding-left: 6px; font-size: 0.65rem; color: var(--text-secondary); text-align: right; line-height:1;">#${data.index}</div>
  </div>`;
}

// ---------- ★ FLIP 协调（仅可视区条目做位移） ----------
function reconcileWithFLIP(wrapper, oldKeyMap, newFlatList, container) {
  // 清理残留的删除节点
  const absNodes = document.querySelectorAll('.search-delete-anim');
  for (const node of absNodes) node.remove();

  // ★ 强制重置滚动：记录旧位置前，确保 scrollTop = 0
  container.scrollTop = 0;
  void container.offsetHeight;
  const containerRect = container.getBoundingClientRect();

  // 记录旧位置（相对于容器视口）
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

  // 处理删除节点：移到 body，固定定位
  for (const key of deleteKeys) {
    const el = oldKeyMap.get(key);
    if (!el) continue;
    const oldRect = oldRects.get(key);
    if (!oldRect) continue;

    const left = containerRect.left + oldRect.left;
    const top = containerRect.top + oldRect.top;

    el.remove();
    el.classList.add('search-delete-anim');
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

  // 如果新列表为空
  if (newFlatList.length === 0) {
    wrapper.innerHTML = '';
    setTimeout(() => {
      wrapper.innerHTML = `<div class="empty-state">啊呜，这里空空如也υ´• ﻌ •\`υ</div>`;
      for (const el of deleteElements) {
        if (el.parentNode) el.remove();
      }
    }, 400);
    return;
  }

  // 构建新节点
  const finalNodes = [];
  for (const item of newFlatList) {
    let el;
    if (oldKeyMap.has(item.key)) {
      el = oldKeyMap.get(item.key);
      el.innerHTML = item.type === 'group' ? renderGroupElement(item.data) : renderItemElement(item.data);
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
      el.classList.remove('search-delete-anim');
    } else {
      el = document.createElement('div');
      el.dataset.key = item.key;
      if (item.type === 'group') {
        el.className = 'search-result-group';
        el.innerHTML = renderGroupElement(item.data);
        el.style.opacity = '1';
        el.style.transform = '';
      } else {
        el.className = 'search-result-item';
        el.innerHTML = renderItemElement(item.data);
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

  // ★ 第二次强制重置：重建 DOM 后，在 RAF 之前确保滚动归零
  container.scrollTop = 0;
  void container.offsetHeight;

  // ★ 第三次：在 RAF 内部再次强制重置，然后记录新位置
  requestAnimationFrame(() => {
    container.scrollTop = 0;
    void container.offsetHeight;
    const containerRect2 = container.getBoundingClientRect();

    // 记录新位置
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
      const wasVisible = oldRect.top < clientH; // 删除前条目顶部在可视区内

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

      // 旧位置可见：正常 FLIP（从原地出发，滑到新位置）
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.opacity = '1';
      void el.offsetHeight;
      el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      el.style.transform = '';
      el.style.opacity = '1';
    }

    // 新增条目从右侧滑入（无论是否可见，新增条目本来就不在旧列表中）
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

  // 清理删除节点
  setTimeout(() => {
    for (const el of deleteElements) {
      if (el.parentNode) el.remove();
    }
  }, 400);
}

// ---------- 应用搜索结果 ----------
function applySearchResultsDiff(newResults, keyword) {
  const container = getRenderContainer();
  if (!container) return;

  // 重置滚动位置
  container.scrollTop = 0;
  void container.offsetHeight;

  container.style.position = 'relative';
  container.style.overflowX = 'hidden';
  container.style.overflowY = 'auto';
  container.style.boxSizing = 'border-box';
  container.style.width = '100%';

  ensureSearchStaticHeader(container);
  updateSearchMeta(newResults.length, keyword);

  const wrapper = ensureDynamicWrapper(container);
  wrapper.style.overflowX = 'hidden';
  wrapper.style.overflowY = 'hidden';

  const oldKeyMap = new Map();
  for (const child of wrapper.children) {
    const key = child.dataset.key;
    if (key) oldKeyMap.set(key, child);
  }

  const newFlatList = buildNewFlatList(newResults, keyword);
  reconcileWithFLIP(wrapper, oldKeyMap, newFlatList, container);
}

// ---------- performSearchAndRender ----------
function performSearchAndRender(rawKeyword, type) {
  const keyword = getActualKeyword(rawKeyword, type);
  const isEmptySearch = !keyword || keyword === '';
  const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
  let results = [];
  const keys = getAllDataKeys();

  for (const dataKey of keys) {
    const data = getData(dataKey);
    if (!data || !data.series) continue;

    let catName = dataKey, parentName = '';
    const tree = getCategoryTree();
    for (const cat of tree) {
      if (cat.dataKey === dataKey) { catName = cat.name; break; }
      if (cat.children) {
        for (const sub of cat.children) {
          if (sub.dataKey === dataKey) { catName = sub.name; parentName = cat.name; break; }
        }
      }
    }

    for (let si = 0; si < data.series.length; si++) {
      const series = data.series[si];
      if (series.varieties) {
        for (let vi = 0; vi < series.varieties.length; vi++) {
          const variety = series.varieties[vi];
          if (!variety.copies) continue;
          for (let ci = 0; ci < variety.copies.length; ci++) {
            const copy = variety.copies[ci];
            if (matchCopy(copy, series, variety, lowerKeyword, type, isEmptySearch)) {
              results.push({ dataKey, catName, parentName, sIdx: si, vIdx: vi, cIdx: ci,
                series, variety, copy, hasVarieties: true });
            }
          }
        }
      } else if (series.copies) {
        for (let ci = 0; ci < series.copies.length; ci++) {
          const copy = series.copies[ci];
          if (matchCopyFlat(copy, series, lowerKeyword, type, isEmptySearch)) {
            results.push({ dataKey, catName, parentName, sIdx: si, cIdx: ci,
              series, copy, hasVarieties: false });
          }
        }
      }
    }
  }

  applySearchResultsDiff(results, keyword);
  prevSearchResults = results;
  prevSearchKeyword = keyword;
  isFirstSearch = false;
}

// ============================================================
// 以下为原有函数（保持不变）
// ============================================================

function updateSearchUIForMode() {
  const input = document.getElementById('searchInput');
  const select = document.getElementById('searchType');
  const toggle = document.getElementById('modeToggle');
  const tip = document.getElementById('searchTip');

  // ★ 根据当前板块动态修改搜索框占位文字
  if (input) {
    if (currentMode === MODE.ARTICLES) {
      input.placeholder = '您正在选定的板块内搜索';
    } else if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
      input.placeholder = '您正在全局范围内搜索';
    } else {
      input.placeholder = '搜索功能已禁用';
    }
  }

  if (!select || !toggle || !tip) return;

  if (currentMode === MODE.ARTICLES) {
    select.classList.add('hidden');
    toggle.classList.remove('hidden');
    toggle.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '标' : '全';
    toggle.title = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '当前为按标题索引，点击“标”字可以切换为全字段索引' : '当前为全字段索引，点击“全”字可以切换为按标题索引';
    tip.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '当前模式为按标题索引（实时搜索），点击“标”字可以切换为全字段索引' : '当前模式为全字段索引（实时搜索），点击“全”字可以切换为按标题索引 | 请先等待全文搜索准备就绪，我们正在全力加载……';
  } else if (currentMode === MODE.SPECIAL || currentMode === MODE.SETTINGS) {
    select.classList.add('hidden');
    toggle.classList.add('hidden');
    tip.textContent = '';
  } else {
    select.classList.remove('hidden');
    toggle.classList.remove('hidden');
    const modeSearch = getEffectiveSearchMode();
    toggle.textContent = modeSearch === SEARCH_MODE.CLICK ? '□' : '■';
    toggle.title = '切换搜索模式';
    tip.textContent = `当前搜索模式为“${modeSearch === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}”，点击“${modeSearch === SEARCH_MODE.CLICK ? '□' : '■'}”可切换至${modeSearch === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}模式`;
  }
}

function doSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  const rawKeyword = input.value.trim();

  if (currentMode === MODE.ARTICLES) {
    articleSearchKeyword = rawKeyword;
    renderArticleList();
    return;
  }

  saveFullState();

  const typeSelect = document.getElementById('searchType');
  const type = typeSelect ? typeSelect.value : SEARCH_TYPE.ALL;
  currentSearchKeyword = rawKeyword;
  currentSearchType = type;
  currentView = VIEW.SEARCH;
  switchToCurrentContainer();
  performSearchAndRender(rawKeyword, type);
}

function resetSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  input.value = '';
  input.focus();

  if (currentMode === MODE.ARTICLES) {
    articleSearchKeyword = '';
    renderArticleList();
    return;
  }

  if (currentView === VIEW.SEARCH) {
    backFromSearch();
    return;
  }

  currentSearchKeyword = '';
  updateSearchUIForMode();
}

function toggleSearchMode() {
  if (currentMode === MODE.ARTICLES) {
    if (typeof toggleArticleSearchMode === 'function') {
      toggleArticleSearchMode();
    }
    return;
  }
  if (currentMode !== MODE.NOTES && currentMode !== MODE.COINS) return;

  const current = modeStates[currentMode].searchMode;
  const newMode = current === SEARCH_MODE.CLICK ? SEARCH_MODE.REALTIME : SEARCH_MODE.CLICK;
  modeStates[currentMode].searchMode = newMode;

  const toggle = document.getElementById('modeToggle');
  const tip = document.getElementById('searchTip');
  const toggleChar = newMode === SEARCH_MODE.CLICK ? '□' : '■';
  if (toggle) toggle.textContent = toggleChar;
  if (tip) tip.textContent = `当前搜索模式为“${newMode === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}”，点击“${newMode === SEARCH_MODE.CLICK ? '□' : '■'}”可切换至${newMode === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}模式`;

  const input = document.getElementById('searchInput');
  if (input) {
    input.removeEventListener('input', doSearch);
    if (newMode === SEARCH_MODE.REALTIME) {
      input.addEventListener('input', doSearch);
    }
  }
}

function matchCopy(copy, series, variety, keyword, type, isEmpty) {
  if (isEmpty) return true;
  switch(type) {
    case SEARCH_TYPE.ALL:
      const text = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
      return text.includes(keyword);
    case SEARCH_TYPE.NAME:
      return series.seriesName.toLowerCase().includes(keyword) || variety.varietyName.toLowerCase().includes(keyword);
    case SEARCH_TYPE.VERSION:
      return (copy.version || '').toLowerCase().includes(keyword);
    case SEARCH_TYPE.YEAR:
      return String(copy.year).toLowerCase().includes(keyword);
    case SEARCH_TYPE.AGENCY:
      return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
    case SEARCH_TYPE.KRAUSE:
      const raw = (copy.catalogNumber || copy.krause || '');
      const formatted = formatCatalogNumber(raw);
      return raw.toLowerCase().includes(keyword) || formatted.toLowerCase().includes(keyword);
  }
  return false;
}

function matchCopyFlat(copy, series, keyword, type, isEmpty) {
  if (isEmpty) return true;
  switch(type) {
    case SEARCH_TYPE.ALL:
      const text = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
      return text.includes(keyword);
    case SEARCH_TYPE.NAME:
      return series.seriesName.toLowerCase().includes(keyword);
    case SEARCH_TYPE.VERSION:
      return (copy.version || '').toLowerCase().includes(keyword);
    case SEARCH_TYPE.YEAR:
      return String(copy.year).toLowerCase().includes(keyword);
    case SEARCH_TYPE.AGENCY:
      return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
    case SEARCH_TYPE.KRAUSE:
      const raw = (copy.catalogNumber || copy.krause || '');
      const formatted = formatCatalogNumber(raw);
      return raw.toLowerCase().includes(keyword) || formatted.toLowerCase().includes(keyword);
  }
  return false;
}

function getActualKeyword(inputValue, searchType) {
  if (searchType === SEARCH_TYPE.KRAUSE) {
    if (inputValue.startsWith(KRAUSE_PREFIX)) {
      return inputValue.substring(KRAUSE_PREFIX.length).trim();
    }
    return inputValue.trim();
  }
  return inputValue.trim();
}

function navigateToCopy(dataKey, si, vi, ci, hasVarieties) {
  const tree = getCategoryTree();
  for (const cat of tree) {
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.dataKey === dataKey) {
          const searchKey = getContainerKey();
          const container = getRenderContainer();
          if (container) scrollMemory[currentMode + '-' + searchKey] = container.scrollTop;

          currentCategoryId = cat.id;
          currentSubId = sub.id;
          currentView = VIEW.CATEGORY;
          switchToCurrentContainer();
          renderSidebar();
          renderCurrentCategory();
          setTimeout(() => {
            const seriesId = `series-${si}`;
            toggleSeries(seriesId);
            if (hasVarieties && vi !== null) {
              setTimeout(() => {
                toggleVariety(`v-${si}-${vi}`);
                setTimeout(() => {
                  const el = document.getElementById('list-v-' + si + '-' + vi);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
              }, 50);
            } else {
              setTimeout(() => {
                const el = document.getElementById('copies-' + seriesId);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }
          }, 50);
          return;
        }
      }
    } else if (cat.dataKey === dataKey) {
      const searchKey = getContainerKey();
      const container = getRenderContainer();
      if (container) scrollMemory[currentMode + '-' + searchKey] = container.scrollTop;

      currentCategoryId = cat.id;
      currentSubId = null;
      currentView = VIEW.CATEGORY;
      switchToCurrentContainer();
      renderSidebar();
      renderCurrentCategory();
      setTimeout(() => {
        const seriesId = `series-${si}`;
        toggleSeries(seriesId);
        if (hasVarieties && vi !== null) {
          setTimeout(() => {
            toggleVariety(`v-${si}-${vi}`);
            setTimeout(() => {
              const el = document.getElementById('list-v-' + si + '-' + vi);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          }, 50);
        } else {
          setTimeout(() => {
            const el = document.getElementById('copies-' + seriesId);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }, 50);
      return;
    }
  }
}

function backFromSearch() {
  saveFullState();
  prevSearchResults = null;
  prevSearchKeyword = '';
  isFirstSearch = true;

  const prevCategoryId = currentCategoryId;
  currentView = prevCategoryId ? VIEW.CATEGORY : VIEW.OVERVIEW;
  switchToCurrentContainer();
  currentSearchKeyword = '';
  const input = document.getElementById('searchInput');
  if (input) input.value = '';

  if (currentView === VIEW.OVERVIEW) {
    renderOverview();
  } else {
    renderCurrentCategory();
    const saved = modeStates[currentMode];
    if (saved && (saved.expandedSeries?.length > 0 || saved.expandedVarieties?.length > 0)) {
      setTimeout(() => {
        restoreExpandedStates({
          expandedSeries: saved.expandedSeries || [],
          expandedVarieties: saved.expandedVarieties || []
        });
      }, 100);
    }
  }
  updateSearchUIForMode();
}