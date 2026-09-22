// ==================== tab-switcher.js ====================

function enterSettings() {
    // ★ 收口写 URL（onTabClick 已在外层同步，但本函数也会被路由/其它入口直接调用）
    try {
        enterSettingsInner();
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function enterSettingsInner() {
    isSettingsMode = true;
    currentSearchKeyword = '';
    articleSearchKeyword = '';

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.add('settings-mode');

    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');

    switchToCurrentContainer();
    renderSettingsPage();
    triggerViewAnimation();
}

// ==================== tab 分派表 ====================
//
// ★ 存在的理由：原来 onTabClickInner / leaveSettingsToTarget 里各写一遍
//   `if (target === MODE.ARTICLES) … if (target === MODE.NOTES || target === MODE.COINS) …`
//   这种穷举。加一个新 tab 就得回来把两处的 if 链都补一遍，漏一处就出现
//   "从设置页能进去、从 tab 直接点却不行"这类半坏状态。
//   现在"点这个 tab 走哪套流程"由 core.js 注册表的 tabAction 字段说明，
//   这里只按名字取一个处理函数 —— **加板块不用再来改这个文件**。
//
// ★ 各个处理函数写成 function 声明（有提升），所以这个表可以放在文件任意位置。
//   这里用的都是**已有的函数名**（enterSpecialFromTab 还被 router.js 直接调用，
//   所以不改名，避免为了重构而去动路由那条链路）。
const TAB_ACTIONS = {
    collection: function (target) { enterNotesOrCoinsTab(target); },
    articles: function () { enterArticlesTab(); },
    special: function () { enterSpecialFromTab(); }
};

// 从设置页返回时用的分派表。
// ★ 与 TAB_ACTIONS 只差 collection 这一项，但**必须分开**：
//   设置页返回这条路的既有实现是 restoreNotesCoinsFromSettings()，里面除了
//   还原定位/展开态，还额外做了"容器内容失效时重渲染 + 滚动位置复位"。
//   实测：把它换成 enterNotesOrCoinsTab 会让 verify-roundtrip 的
//   「返回后定位保住 / 系列仍展开 / 品种仍展开」三项全灭
//   （hash 从 #notes/rmb/rmb3/s1/v1.0 退化成 #notes/rmb/rmb3）。
//   所以这里按"从哪来"分表，而不是指望一个函数兼顾两种语境。
const TAB_ACTIONS_FROM_SETTINGS = {
    collection: function (target) { restoreNotesCoinsFromSettings(target); },
    articles: function () { enterArticlesTab(); },
    special: function () { enterSpecialFromTab(); }
};

// 按注册表分派；返回 true 表示已处理。
// fromSettings=true 时用"设置页返回"那张表。
function dispatchTabAction(target, fromSettings) {
    const def = (typeof getModeDef === 'function') ? getModeDef(target) : null;
    const action = def && def.tabAction;
    const table = fromSettings ? TAB_ACTIONS_FROM_SETTINGS : TAB_ACTIONS;
    const fn = action && table[action];
    if (typeof fn !== 'function') return false;
    fn(target);
    return true;
}

function onTabClick(target) {
    // ★ try/finally 统一收口写 URL：这个函数有 6 个提前 return 分支，
    //   在每个分支里各插一次 syncRoute 太容易漏（后续新增分支也会忘）。
    try {
        onTabClickInner(target);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function onTabClickInner(target) {
    // ★ 点的是**当前所在的那个 tab**：什么都不做。
    //
    // 放在这里按"tab 身份"统一判断，而不是散在各个 enter* 里：
    //   · onTabClick 只由 tab 的 click 事件触发（见 main.js 的绑定），
    //     路由/深链接走的是 enterSettings() / enterNotesOrCoinsTab() 等函数，
    //     不经过这里 —— 所以在这里提前返回不会影响 URL 恢复。
    //   · 之前只在 enterNotesOrCoinsTab / enterArticlesTab 里加守卫，
    //     而 MODE.SPECIAL 和 MODE.SETTINGS 两个分支在函数中更靠前，
    //     等于从没被覆盖到：点正在看的「专题」「我的」，入场淡入照样重播。
    //
    // MODE.SETTINGS 那一支只能靠 isSettingsMode 判断：currentMode 永远不等于
    // 'settings'（全文件没有这个赋值，进设置页只翻 isSettingsMode、currentMode
    // 保持原样），拿 currentMode 去比会漏判，点「我的」就会重播动画。
    const clickingCurrentTab = (isSettingsMode && target === MODE.SETTINGS)
        || (!isSettingsMode && currentMode === target);
    if (clickingCurrentTab) return;

    saveFullState();

    // ★ 切换版块时关闭特殊字符面板
    if (typeof window.closeSymbolPanel === 'function') {
        window.closeSymbolPanel();
    }

    if (target === MODE.SETTINGS) {
        if (!isSettingsMode) {
            if (currentMode === MODE.SPECIAL && selectedSpecial !== null && selectedSpecial !== undefined) {
                const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
                if (!(cfg && cfg.view === 'map')) {
                    const container = getRenderContainer();
                    if (container) {
                        specialPageCaches[selectedSpecial] = {
                            scrollY: container.scrollTop || 0,
                            currentSubId: currentSubId
                        };
                    }
                }
            }
            settingsReturnState = {
                currentMode, currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                currentSearchType: currentSearchType || SEARCH_TYPE.ALL,
                selectedSpecial
            };
        }
        switchToCurrentContainer();
        enterSettings();
        return;
    }

    if (target === MODE.SPECIAL) {
        enterSpecialFromTab();
        return;
    }

    if (isSettingsMode) {
        leaveSettingsToTarget(target);
        return;
    }

    // ★ 其余交给注册表分派（纸币/硬币 → collection，文章 → articles）。
    //   原来是两条穷举 if：`target === MODE.ARTICLES` 和
    //   `target === MODE.NOTES || target === MODE.COINS`。
    //   新增板块只要在注册表里写对 tabAction，这里不用动。
    dispatchTabAction(target);
}

function enterSpecialFromTab() {
    const isLeavingSettings = isSettingsMode;

    if (isSettingsMode) {
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
    }

    const isRestoringFromSettings = isLeavingSettings && 
                                    settingsReturnState && 
                                    settingsReturnState.currentMode === MODE.SPECIAL;

    if (isRestoringFromSettings) {
        if (selectedSpecial === null || selectedSpecial === undefined) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId || null;
        }
        settingsReturnState = null;
    } else {
        currentSubId = null;
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            currentCategoryId = selectedSpecial;
        }
        if (isLeavingSettings) {
            settingsReturnState = null;
        }
    }

    currentMode = MODE.SPECIAL;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    switchToCurrentContainer();

    if (selectedSpecial === null || selectedSpecial === undefined) {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.style.display = 'none';
        renderSpecialOverview();
        triggerViewAnimation();
        return;
    }

    const specialCfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!specialCfg) {
        renderSpecialOverview();
        triggerViewAnimation();
        return;
    }

    if (specialCfg.view === 'map') {
        renderShanheContent(specialCfg);
    } else {
        renderSpecialContent();
    }
    renderSidebar();
    applySpecialLayout();

    triggerViewAnimation();
}

function leaveSettingsToTarget(target) {
    isSettingsMode = false;
    document.querySelector('.body-row')?.classList.remove('settings-mode');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }

    // ★ 文章与纸币/硬币从设置页返回，就是"正常进入那个板块"，与 tab 直接点完全同一套流程
    //   （enterArticlesTab / restoreNotesCoinsFromSettings 都不依赖设置页状态），
    //   所以走注册表分派，不再在这里穷举板块名。
    //   注意：必须在下面的 special 分支**之后**才轮到它 —— special 那条要额外
    //   还原 settingsReturnState.selectedSpecial，不能由通用分派代劳。
    if (target === MODE.SPECIAL) {
        currentMode = MODE.SPECIAL;
        document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');
        const searchContainer2 = document.querySelector('.top-search-container');
        if (searchContainer2) searchContainer2.classList.add('hidden');

        if (settingsReturnState && settingsReturnState.selectedSpecial !== undefined && settingsReturnState.selectedSpecial !== null) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.selectedSpecial;
            currentSubId = settingsReturnState.currentSubId;
        }

        switchToCurrentContainer();

        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            const specialCfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
            if (!specialCfg) {
                renderSpecialOverview();
                triggerViewAnimation();
                return;
            }

            if (specialCfg.view === 'map') {
                renderShanheContent(specialCfg);
            } else {
                renderSpecialContent();
            }
            renderSidebar();
            applySpecialLayout();
        } else {
            document.querySelector('.body-row')?.classList.add('sidebar-hidden');
            const btn = document.getElementById('sidebarToggle');
            if (btn) btn.style.display = 'none';
            renderSpecialOverview();
        }
        triggerViewAnimation();
        return;
    }

    // ★ 顺序很重要：**先按注册表分派**，下面的 settingsReturnState 只作为兜底。
    //
    //   踩过的坑：一开始我把分派放成 `if (settingsReturnState) {...} else if (分派)`，
    //   结果设置页返回纸币时"定位与展开态全丢"。原因是 settingsReturnState 只要
    //   点过「我的」就一定有值（进设置时必被写入），所以 else 分支**永远不进**；
    //   而紧跟着的兜底分支只还原 currentCategoryId/currentView 这五项定位，
    //   **不碰 focusSeries / focusVariety / expandedSeries / expandedVarieties**，
    //   也不调用 restoreNotesCoinsFromSettings 的容器重渲染 + 滚动复位。
    //   原来这段兜底是"文章/专题之外的其它"专用，纸币/硬币在它**之前**就 return 了。
    //
    //   现在：纸币/硬币 → restoreNotesCoinsFromSettings（既有实现，一字不改），
    //   文章 → enterArticlesTab；两者都 return，不会掉进兜底。
    if (dispatchTabAction(target, true)) {
        return;
    }

    if (settingsReturnState) {
        currentMode = settingsReturnState.currentMode || MODE.NOTES;
        currentCategoryId = settingsReturnState.currentCategoryId;
        currentSubId = settingsReturnState.currentSubId;
        currentView = settingsReturnState.currentView;
        currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
        currentSearchType = settingsReturnState.currentSearchType || SEARCH_TYPE.ALL;
    }
    switchToCurrentContainer();
    updateSearchUIForMode();
    renderSidebar();
    if (currentView === VIEW.OVERVIEW) {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
    triggerViewAnimation();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${currentMode}"]`)?.classList.add('active');
}

function restoreNotesCoinsFromSettings(target) {
    currentMode = target;
    const saved = modeStates[target];
    currentCategoryId = saved.currentCategoryId;
    currentSubId = saved.currentSubId;
    currentView = saved.currentView || VIEW.OVERVIEW;
    currentSearchKeyword = saved.currentSearchKeyword || '';
    currentSearchType = saved.currentSearchType || SEARCH_TYPE.ALL;
    // ★ 恢复"当前位置"（从设置页返回时，地址栏要重新写出 …/s0/v1）
    //   ★ 归一成数组：focusSeries/focusVariety 现在是列表；同时兼容快照里
    //     可能残留的旧标量形式（老会话切板块前存下的），否则 .length 会取到 undefined。
    focusOwner = saved.focusOwner || null;
    focusScope = saved.focusScope || null;
    focusSeries = Array.isArray(saved.focusSeries) ? saved.focusSeries.slice()
        : (Number.isFinite(saved.focusSeries) ? [saved.focusSeries] : []);
    focusVariety = Array.isArray(saved.focusVariety) ? saved.focusVariety.slice()
        : (Number.isFinite(saved.focusVariety) ? [saved.focusVariety] : []);

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = currentSearchKeyword;
        inp.removeEventListener('input', onSearchInput);
        if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
            inp.addEventListener('input', onSearchInput);
        }
    }
    const typeSelect = document.getElementById('searchType');
    if (typeSelect) typeSelect.value = currentSearchType;

    switchToCurrentContainer();
    updateSearchUIForMode();
    restoreSidebarState();
    renderSidebar();

    const container = getRenderContainer();
    const hasContent = container && container.children.length > 0 && container.innerHTML.trim().length > 10;

    if (!hasContent) {
        if (currentView === VIEW.OVERVIEW) {
            renderOverview();
        } else if (currentView === VIEW.CATEGORY) {
            renderCurrentCategory();
        } else if (currentView === VIEW.SEARCH && currentSearchKeyword) {
            performSearchAndRender(currentSearchKeyword, currentSearchType);
        } else {
            currentView = VIEW.OVERVIEW;
            switchToCurrentContainer();
            renderOverview();
        }
        // ★ 重渲染会丢掉手风琴的展开状态（「网格画质」开关作废容器后也走这条路），补回来
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else {
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        // ★ 概览页 / 分类页优先用"滚动记忆"里的位置（core.js）：它由 scroll 事件实时更新，
        //   比 modeStates 里那份（只在切板块时采集）更新，而且容器被清空重渲染后仍然有效。
        //   记忆里没有（返回 0）才回退到老逻辑，避免把已恢复的位置又覆盖掉。
        const memY = (currentView === VIEW.OVERVIEW || currentView === VIEW.CATEGORY)
            ? (typeof restoreCategoryScroll === 'function' ? restoreCategoryScroll() : 0) : 0;
        const scrollPos = memY > 0 ? 0
            : currentView === VIEW.OVERVIEW ? saved.overviewScrollY
            : currentView === VIEW.CATEGORY ? saved.categoryScrollY
            : saved.searchScrollY;
        if (scrollPos > 0) {
            requestAnimationFrame(() => {
                container.scrollTop = scrollPos;
            });
        }
    }

    triggerViewAnimation();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
}

function restoreExpandedStates(states) {
    if (!states) return;
    // ★ 两道保险（审查报告 B7）：
    //   ① 只恢复**当前分类作用域**下的 id —— 存下来的 id 形如 "notes_category_rmb5-s0"，
    //      前缀就是 getCategoryScope()。没有这个判断时，A 分类的展开态会被套用到
    //      B 分类的同序号系列上（两侧 si 都从 0 开始）。
    //   ② 查询走 scopeAccordionLookup()，只认活动容器内的节点 ——
    //      避免命中隐藏容器里残留的历史 DOM。
    const scopePrefix = getCategoryScope() + '-';
    if (states.expandedSeries) {
        for (const id of states.expandedSeries) {
            if (!String(id).startsWith(scopePrefix)) continue;
            const body = scopeAccordionLookup('body-' + id);
            const icon = scopeAccordionLookup('icon-' + id);
            if (body) { body.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
    if (states.expandedVarieties) {
        for (const id of states.expandedVarieties) {
            if (!String(id).startsWith(scopePrefix)) continue;
            const list = scopeAccordionLookup('list-' + id);
            const icon = scopeAccordionLookup('icon-' + id);
            if (list) { list.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
}

function enterArticlesTab() {
    // ★ 这里**故意不放**"点当前 tab 就直接返回"的守卫。
    //   去重统一由上层 onTabClickInner 负责（它知道点击的 tab 身份）；
    //   而本函数还会被"从设置页返回"(leaveSettingsToTarget) 和路由
    //   (applyRoute) 直接调用 —— 那两种情况下 currentMode 早就等于
    //   MODE.ARTICLES 了（进设置页不改 currentMode），任何形如
    //   `currentMode === MODE.ARTICLES` 的早退都会把它们一起吞掉。
    //   实测症状：「文章 → 我的 → 文章」之后停在设置页，activeTab 还写着「我的」。

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');

    currentMode = MODE.ARTICLES;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="articles"]')?.classList.add('active');

    if (collectedArticles.length === 0) collectAllArticles();

    currentArticleView = articleState.currentView || VIEW.LIST;
    currentArticleCategory = articleState.currentCategory || 'all';
    currentArticleIndex = (articleState.currentIndex !== undefined && articleState.currentIndex >= 0)
        ? articleState.currentIndex : -1;
    articleSearchKeyword = articleState.searchKeyword || '';

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = articleSearchKeyword || '';
        inp.removeEventListener('input', onSearchInput);
        inp.addEventListener('input', onSearchInput);
    }

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    switchToCurrentContainer();
    updateSearchUIForMode();
    renderSidebar();

    if (currentArticleIndex >= 0 && currentArticleView === VIEW.READER) {
        openArticleReader(currentArticleIndex, true);
    } else {
        // ★ 进入文章版块时清掉列表 DOM，强制走"全部当作新增"的路径。
        //   为什么需要：reconcileArticleWithFLIP 只给 oldKeyMap 里没有的条目挂
        //   translateX(40px) 的滑入动画（见 article.js 里 el.style.transform 那两处）。
        //   首次进入时列表为空、所有条目都算新增，所以有滑入；第二次进入时节点被
        //   增量复用，滑入就没了 —— 只剩 triggerViewAnimation() 的淡入，观感是
        //   "第一次划入、之后变成淡入"。清空后每次进入都能保持划入。
        //   只清 wrapper，不动滚动位置：下面 renderArticleList() 会按量到的位置
        //   恢复。搜索过滤等其它调用方不受影响（它们照旧走增量复用，
        //   不会每次输入都重播滑入）。
        //   wrapper 由 ensureArticleDynamicWrapper() 创建，用类名定位（它没有 id）；
        //   此时可能还没被创建过，querySelector 取不到就跳过 —— 那种情况列表本来
        //   就是空的，自然会全部滑入。
        //   注意必须在清空前量好滚动位置：清空后容器高度归零、scrollTop 会被
        //   浏览器夹到 0，再读就已经丢了。量到的值显式传给 renderArticleList()
        //   （它内部的 keepScroll/双 rAF 兜底都靠这个值恢复）。
        const listRc = getRenderContainer();
        const listScrollY = listRc ? listRc.scrollTop : 0;
        const listWrapper = listRc ? listRc.querySelector('.article-dynamic-wrapper') : null;
        if (listWrapper) listWrapper.innerHTML = '';
        renderArticleList(false, listScrollY);
    }

    if (articleSearchMode === 'fulltext') {
        setTimeout(() => {
            if (typeof preloadAllArticles === 'function') {
                preloadAllArticles().then(() => {
                    if (currentMode === MODE.ARTICLES && currentArticleView === VIEW.LIST && !articleSearchKeyword) {
                        renderArticleList();
                    }
                }).catch(() => {});
            }
        }, 100);
    }

    triggerViewAnimation();
}

function enterNotesOrCoinsTab(target) {
    // ★ 这里**故意不放**"点当前版块就直接返回"的守卫 —— 与 enterArticlesTab 同理。
    //   去重由上层 onTabClickInner 负责（在 tab 身份这一层判断，最准确）；
    //   而本函数还会被"从设置页返回"(leaveSettingsToTarget) 与路由
    //   (applyRoute) 直接调用，这两种情况下 currentMode **早就等于** target：
    //   · 路由：currentMode 的初值就是 MODE.NOTES（见 core.js），刷新时的
    //     常见深链又正是 #notes/...，守卫会把 applyRoute 的调用整个吞掉，
    //     URL 里的分类/系列永不恢复，随后 syncFocusAndRoute() 再把 hash
    //     规范化成 #notes —— 链接就"自己废了"。
    //   · 从设置页返回：进设置页不改 currentMode，所以回来时 currentMode
    //     已经等于目标版块，守卫同样会吞掉这次恢复。注意 isSettingsMode 在这里
    //     **不是**有效的例外 —— leaveSettingsToTarget() 在调用本函数之前就把它
    //     置成 false 了，挡不住。实测症状：「文章 → 我的 → 文章」停在设置页、
    //     activeTab 还写着「我的」（硬币同理）。

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');

    const newMode = target;
    currentMode = newMode;
    const saved = modeStates[newMode];

    currentCategoryId = saved.currentCategoryId;
    currentSubId = saved.currentSubId;
    currentView = saved.currentView || VIEW.OVERVIEW;
    currentSearchKeyword = saved.currentSearchKeyword || '';
    currentSearchType = saved.currentSearchType || SEARCH_TYPE.ALL;
    // ★ 恢复"展开态"：focusOwner 是随分类一起存的，所以切板块回来时
    //   (owner, 系列列表, 品种列表) 仍然自洽，能被 buildRoute 直接写进地址栏。
    focusOwner = saved.focusOwner || null;
    focusScope = saved.focusScope || null;
    focusSeries = Array.isArray(saved.focusSeries) ? saved.focusSeries.slice()
        : (Number.isFinite(saved.focusSeries) ? [saved.focusSeries] : []);
    focusVariety = Array.isArray(saved.focusVariety) ? saved.focusVariety.slice()
        : (Number.isFinite(saved.focusVariety) ? [saved.focusVariety] : []);

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = currentSearchKeyword;
        inp.removeEventListener('input', onSearchInput);
        if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
            inp.addEventListener('input', onSearchInput);
        }
    }
    const typeSelect = document.getElementById('searchType');
    if (typeSelect) typeSelect.value = currentSearchType;

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    switchToCurrentContainer();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
    updateSearchUIForMode();
    restoreSidebarState();
    renderSidebar();

    const container = getRenderContainer();
    const hasContent = container && container.children.length > 0 && container.innerHTML.trim().length > 10;

    if (!hasContent) {
        if (currentView === VIEW.OVERVIEW) {
            renderOverview();
        } else if (currentView === VIEW.CATEGORY) {
            renderCurrentCategory();
        } else if (currentView === VIEW.SEARCH && currentSearchKeyword) {
            performSearchAndRender(currentSearchKeyword, currentSearchType);
        } else {
            currentView = VIEW.OVERVIEW;
            switchToCurrentContainer();
            renderOverview();
        }
        // ★ 重渲染会丢掉手风琴的展开状态（「网格画质」开关作废容器后也走这条路），补回来
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else {
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        // ★ 概览页 / 分类页优先用"滚动记忆"里的位置（core.js）：它由 scroll 事件实时更新，
        //   比 modeStates 里那份（只在切板块时采集）更新，而且容器被清空重渲染后仍然有效。
        //   记忆里没有（返回 0）才回退到老逻辑，避免把已恢复的位置又覆盖掉。
        const memY = (currentView === VIEW.OVERVIEW || currentView === VIEW.CATEGORY)
            ? (typeof restoreCategoryScroll === 'function' ? restoreCategoryScroll() : 0) : 0;
        const scrollPos = memY > 0 ? 0
            : currentView === VIEW.OVERVIEW ? saved.overviewScrollY
            : currentView === VIEW.CATEGORY ? saved.categoryScrollY
            : saved.searchScrollY;
        if (scrollPos > 0) {
            requestAnimationFrame(() => {
                container.scrollTop = scrollPos;
            });
        }
    }
    triggerViewAnimation();
}