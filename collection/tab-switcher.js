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

    if (target === MODE.ARTICLES) {
        enterArticlesTab();
        return;
    }

    if (target === MODE.NOTES || target === MODE.COINS) {
        enterNotesOrCoinsTab(target);
        return;
    }
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

    if (target === MODE.ARTICLES) {
        enterArticlesTab();
        return;
    }

    if (target === MODE.NOTES || target === MODE.COINS) {
        restoreNotesCoinsFromSettings(target);
        return;
    }

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
        const scrollPos = currentView === VIEW.OVERVIEW ? saved.overviewScrollY
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
        renderArticleList();
        const container = getRenderContainer();
        if (articleState.listScrollY > 0) {
            requestAnimationFrame(() => { container.scrollTop = articleState.listScrollY; });
        }
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
        const scrollPos = currentView === VIEW.OVERVIEW ? saved.overviewScrollY
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