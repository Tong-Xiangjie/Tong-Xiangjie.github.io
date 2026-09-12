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
  const g1 = gridImg(copy.img1);
  const g2 = gridImg(copy.img2);
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
  if (img1) thumbHtml += `<img class="mini-thumb" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
  if (img2) thumbHtml += `<img class="mini-thumb" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
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
// keptScroll：本次重建前用户的滚动位置。传进来就全程保持不变
//   （FLIP 的位移量是"同一滚动状态下 旧位置 - 新位置"，与绝对 scrollTop 无关，
//    所以保持不动反而更简单、也不会闪）。
function reconcileWithFLIP(wrapper, oldKeyMap, newFlatList, container, keptScroll) {
  // 清理残留的删除节点
  const absNodes = document.querySelectorAll('.search-delete-anim');
  for (const node of absNodes) node.remove();

  // ★ 保留用户滚动位置（审查报告 A5 / 你的第 4 点）
  //   以前这里强制 scrollTop = 0，导致"边打边搜"时每敲一个字符列表就跳回顶部，
  //   翻到第 3 屏想再细化关键词基本没法用（配合 search.js 里另外三处归零一起放大）。
  //   现在改为：重建前后都停在原位置。
  // 临时关掉浏览器滚动锚定：重建会大改 DOM 高度，锚定会自行"纠正"滚动位置，干扰保留
  const prevAnchor = container.style.overflowAnchor;
  container.style.overflowAnchor = 'none';
  const restoreScroll = () => {
    container.style.overflowAnchor = prevAnchor;
    if (typeof keptScroll === 'number' && container.scrollTop !== keptScroll) {
      container.scrollTop = keptScroll;
    }
  };

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

  // ★ 重建 DOM 后不再强制滚动归零：保持在 keptScroll，下面 RAF 里量到的
  //   新位置与上面的旧位置处于同一滚动状态，FLIP 位移量因此依然正确。
  void container.offsetHeight;

  // 在 RAF 内部记录新位置（此时布局已稳定）
  requestAnimationFrame(() => {
    restoreScroll();
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

  // ★ 保留滚动位置（你的第 4 点 / 审查报告 A5）
  //   这里原来会强制 container.scrollTop = 0。配合 reconcileWithFLIP 里另外三处归零，
  //   结果是"边打边搜"每敲一个字符、以及点"搜索"时，列表都跳回顶部：
  //   翻到第 3 屏想再细化关键词就没法用了。
  //   keptScroll === null 表示这是该视图第一次渲染 → 首次搜索仍从顶部开始（符合预期）。
  const keptScroll = container.dataset.searchRendered === '1' ? container.scrollTop : null;

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
  reconcileWithFLIP(wrapper, oldKeyMap, newFlatList, container, keptScroll);
  container.dataset.searchRendered = '1';
}

// ---------- performSearchAndRender ----------
function performSearchAndRender(rawKeyword, type) {
  const keyword = getActualKeyword(rawKeyword, type);
  const isEmptySearch = !keyword || keyword === '';
  // ★ 关键词的归一化形态只算一次，由所有副本共用（原来每条副本各自构造匹配串）
  const plan = makeSearchPlan(keyword, type);
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
            if (matchEntry(copy, series, variety, plan, type, isEmptySearch)) {
              results.push({ dataKey, catName, parentName, sIdx: si, vIdx: vi, cIdx: ci,
                series, variety, copy, hasVarieties: true });
            }
          }
        }
      } else if (series.copies) {
        for (let ci = 0; ci < series.copies.length; ci++) {
          const copy = series.copies[ci];
          if (matchEntry(copy, series, null, plan, type, isEmptySearch)) {
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
      input.placeholder = '只在当前板块里翻哦';
    } else if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
      input.placeholder = '全站范围都能搜哦';
    } else {
      input.placeholder = '这页没搜索功能啦';
    }
  }

  if (!select || !toggle || !tip) return;

  if (currentMode === MODE.ARTICLES) {
    select.classList.add('hidden');
    toggle.classList.remove('hidden');
    toggle.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '标' : '全';
    toggle.title = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '现在是按标题找，点“标”字能切到全文索引' : '现在是全文索引，点“全”字能切回按标题找';
    tip.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '现在是按标题找（边打边搜），点“标”字能切到全文索引' : '现在是全文索引（边打边搜），点“全”字能切回按标题找 | 全文还在加载中，稍等一下下～';
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
    // ★ 两种模式的提示严格对齐：模式名(4) + 括号说明(4) + 切换字符(1) + 目标模式(4)，
    //   两边总字数完全一致，切换时文字不会跳动。（对标文章板块的做法）
    tip.textContent = `现在是「${modeSearch === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}」（${modeSearch === SEARCH_MODE.CLICK ? '打完回车' : '边打边搜'}），点“${modeSearch === SEARCH_MODE.CLICK ? '□' : '■'}”能换成「${modeSearch === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}」`;
  }
}

function doSearch(opts) {
  // ★ try/finally 收口写 URL。
  //   历史记录策略很关键：边打边搜的 input 事件每敲一个字符都会走这里，
  //   若一律 pushState，后退键就要按几十次才能离开搜索页（实测这是最恼人的体验问题）。
  //   所以：input 事件 → replaceState（只更新当前这条）；
  //         点"搜索"按钮 / 回车 / 点击模式 → pushState（真的新增一步，可后退回上一组结果）。
  const replace = !!(opts && opts.replace);
  try {
    doSearchInner();
  } finally {
    if (typeof syncRoute === 'function') syncRoute(replace);
  }
}

function doSearchInner() {
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

// 边打边搜的 input 事件处理器。
// ★ 必须是具名函数而不是内联箭头：各板块切换时要用 removeEventListener 把它摘掉，
//   匿名函数摘不掉（原代码传的就是 doSearch 本身，这里保持同样的可摘除性）。
function onSearchInput() {
  doSearch({ replace: true });
}

function resetSearch() {
  // ★ try/finally 收口写 URL
  try {
    resetSearchInner();
  } finally {
    if (typeof syncRoute === 'function') syncRoute(true);
  }
}

function resetSearchInner() {
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
  // 与 updateSearchUIForMode 保持同一套对齐结构
  if (tip) tip.textContent = `现在是「${newMode === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}」（${newMode === SEARCH_MODE.CLICK ? '打完回车' : '边打边搜'}），点“${newMode === SEARCH_MODE.CLICK ? '□' : '■'}”能换成「${newMode === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}」`;

  const input = document.getElementById('searchInput');
  if (input) {
    input.removeEventListener('input', onSearchInput);
    if (newMode === SEARCH_MODE.REALTIME) {
      input.addEventListener('input', onSearchInput);
    }
  }
}

// ★ key → 中文 label 的反向表，直接从各数据文件的 detailFields 收集。
//   ★ 必须**惰性构建**：脚本加载时数据还没 fetch 完，那时建表会得到空 Map。
//   缓存随 invalidateRenderedViews() 失效（数据/设置变化时重建）。
let detailFieldLabels = null;

function ensureDetailFieldLabels() {
  if (detailFieldLabels) return detailFieldLabels;
  const map = new Map();
  const saved = currentMode;
  try {
    for (const mode of [MODE.NOTES, MODE.COINS]) {
      currentMode = mode;
      for (const dataKey of getAllDataKeys()) {
        const data = getData(dataKey);
        if (!data || !Array.isArray(data.detailFields)) continue;
        for (const f of data.detailFields) {
          if (f && f.key && f.label && !map.has(f.key)) map.set(f.key, f.label);
        }
      }
    }
  } catch (e) {
    console.warn('[搜索] 构建字段标签表失败（不影响搜索）:', e);
  } finally {
    currentMode = saved;
  }
  detailFieldLabels = map;
  return map;
}

// ★「全字段搜索」= 数据文件在 detailFields 里声明的**全部字段**，
//   而不是只搜固定的那 7 个。各板块字段差异很大（纸币有 issueDate / withdrawnDate /
//   wmk / print / signature1 / signature2 / depositOnlyDate，硬币有 country / mint /
//   material / diameter / weight / edge / design / gradingCompany / grade / mintage），
//   原来写死 7 个字段让"全字段"名不副实（审查报告 B4）。
// ★ 图片字段不参与"全字段搜索"：img1/img2 的值是完整图片 URL，
//   并入后搜 "jpg" / "tong-xiangjie" 会把几乎全部条目命中，纯属噪声（实测 347 条）。
//   判定用 /^img/i 而不是写死 img1/img2，这样 yearImg / 未来新增的 imgN 也一起排除。
//   注意：remark 里偶尔含真实链接（如知乎考证链接），那是**正文内容**，保留可搜是正确的。
const SEARCH_IMAGE_KEY_RE = /^img/i;

function isSearchableField(key) {
  if (SEARCH_IMAGE_KEY_RE.test(key)) return false;
  if (key === 'readme' || key === 'detailFields' || key === 'author') return false;
  return true;
}

function collectSearchFields(copy, series, variety) {
  const parts = [series.seriesName];
  if (variety) parts.push(variety.varietyName);
  for (const [k, v] of Object.entries(copy)) {
    if (!isSearchableField(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    const t = typeof v;
    // 只取标量；数组/对象（author、detailFields 等）跳过
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    parts.push(String(v));
  }
  return parts;
}

// 一次搜索只算一次的关键词形态（避免逐条副本重复归一化）
function makeSearchPlan(keyword, type) {
  const plan = {
    keyword: keyword,
    norm: normalizeForSearch(stripCatalogPrefix(keyword))
  };
  if (type === SEARCH_TYPE.AGENCY) {
    // 允许按中文字段名搜（如输入"评级公司"）
    const labels = ensureDetailFieldLabels();
    plan.agencyLabels = ['condition', 'grade', 'gradingCompany']
      .map(k => labels.get(k) || '')
      .filter(Boolean)
      .join(' ');
  }
  return plan;
}

function matchEntry(copy, series, variety, plan, type, isEmpty) {
  if (isEmpty) return true;
  const keyword = plan.keyword;

  switch (type) {
    case SEARCH_TYPE.ALL: {
      const joined = collectSearchFields(copy, series, variety).join(' ');
      const lower = joined.toLowerCase();
      if (lower.includes(keyword)) return true;
      // 支持目录编号的前缀/空格差异，以及全角输入
      if (plan.norm) {
        if (lower.includes(plan.norm)) return true;
        if (normalizeForSearch(joined).includes(plan.norm)) return true;
      }
      // ★ 刻意不把 detailFields 的中文 label 并入全字段匹配：
      //   label 是**字段名**不是字段值，并入后输入"评级分数"会把所有条目都命中，
      //   反而把"全字段"变成"全部命中"。按字段名搜由上方的下拉选项负责。
      return false;
    }

    case SEARCH_TYPE.NAME:
      return series.seriesName.toLowerCase().includes(keyword) ||
             (variety ? variety.varietyName.toLowerCase().includes(keyword) : false);

    case SEARCH_TYPE.VERSION:
      return String(copy.version || '').toLowerCase().includes(keyword);

    case SEARCH_TYPE.YEAR:
      return String(copy.year || '').toLowerCase().includes(keyword);

    case SEARCH_TYPE.AGENCY: {
      // "评级机构"既可能是公司名（硬币 gradingCompany），也可能是分数（纸币 condition）
      const text = [copy.condition, copy.grade, copy.gradingCompany]
        .map(v => (v === null || v === undefined ? '' : String(v))).join(' ');
      if (text.toLowerCase().includes(keyword)) return true;
      return !!(plan.agencyLabels && plan.agencyLabels.includes(keyword));
    }

    case SEARCH_TYPE.KRAUSE: {
      const raw = String(copy.catalogNumber || copy.krause || '');
      const formatted = formatCatalogNumber(raw);
      // ① 原样包含（与旧行为一致，保证不回归）
      if (raw.toLowerCase().includes(keyword) || formatted.toLowerCase().includes(keyword)) return true;
      // ② 前缀/空白/全角无关：'KM#130'、'km# 130'、'ＫＭ＃130' 互相都能命中
      //    （此前只认 'Pick# ' 这一种写法，KM#/SUN# 一律搜不到 —— 审查报告 B3）
      if (!plan.norm) return false;
      const normRaw = normalizeForSearch(raw);
      const normFmt = normalizeForSearch(formatted);
      if (normRaw.includes(plan.norm) || normFmt.includes(plan.norm)) return true;
      // ③ 关键词自带前缀时（如输入 "KM#130"），用原始关键词再试一次：
      //    plan.norm 已被 stripCatalogPrefix 剥过，单独比较原始形态能覆盖更多写法
      const normKw = normalizeForSearch(keyword);
      return !!normKw && (normRaw.includes(normKw) || normFmt.includes(normKw));
    }

    case SEARCH_TYPE.COPYID: {
      // ★ 评级证书编号（copyId，detailFields 里的 label 正是"评级证书编号"）
      const id = String(copy.copyId || '');
      if (!id) return false;
      if (id.toLowerCase().includes(keyword)) return true;
      return !!plan.norm && normalizeForSearch(id).includes(plan.norm);
    }
  }
  return false;
}

function getActualKeyword(inputValue, searchType) {
  // ★ 前缀剥除统一交给 stripCatalogPrefix()：它同时处理 Pick# / KM# / SUN# / Krause
  //   以及全角与空格（原来只认硬编码的 'Pick# ' 一种写法）。
  if (searchType === SEARCH_TYPE.KRAUSE) {
    return stripCatalogPrefix(inputValue).trim();
  }
  return inputValue.trim();
}

function navigateToCopy(dataKey, si, vi, ci, hasVarieties) {
  // ★ try/finally 收口写 URL：这是"跳转"语义，pushState 新增一条历史记录
  try {
    navigateToCopyInner(dataKey, si, vi, ci, hasVarieties);
  } finally {
    if (typeof syncRoute === 'function') syncRoute(false);
  }
}

function navigateToCopyInner(dataKey, si, vi, ci, hasVarieties) {
  const tree = getCategoryTree();

  // 找到这个 dataKey 属于哪个分类（带子分类的优先匹配子项）
  let targetCat = null, targetSub = null;
  for (const cat of tree) {
    if (cat.children) {
      const sub = cat.children.find(s => s.dataKey === dataKey);
      if (sub) { targetCat = cat; targetSub = sub; break; }
    } else if (cat.dataKey === dataKey) {
      targetCat = cat; targetSub = null; break;
    }
  }
  if (!targetCat) return;

  currentCategoryId = targetCat.id;
  currentSubId = targetSub ? targetSub.id : null;
  currentView = VIEW.CATEGORY;
  switchToCurrentContainer();
  renderSidebar();
  renderCurrentCategory();

  // 展开并滚动到目标条目。
  // ★ 这段逻辑原本在这里重复写了两份（一个 dataKey 在子分类下 / 在顶层分类下各一份），
  //   现在统一复用 router.js 的 revealCopyInCategory()：深链接与"从搜索结果跳过来"
  //   共用同一套 DOM 约定（body-series-<si> / list-v-<si>-<vi> / copies-series-<si>），
  //   以后改 id 规则只需要改一处。
  if (typeof revealCopyInCategory === 'function') {
    revealCopyInCategory({
      sIdx: si,
      vIdx: (hasVarieties && vi !== null && vi !== undefined) ? vi : undefined,
      cIdx: (ci === null || ci === undefined) ? undefined : ci
    }).catch(function () { /* 展开失败不影响已完成的跳转 */ });
  }
}

function backFromSearch() {
  // ★ 收口写 URL（离开搜索视图 → 回到概览或分类）
  try {
    backFromSearchInner();
  } finally {
    if (typeof syncRoute === 'function') syncRoute();
  }
}

function backFromSearchInner() {
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