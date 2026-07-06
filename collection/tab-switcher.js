// ==================== tab-switcher.js ====================
// Tab切换逻辑

function enterSettings() {
    isSettingsMode = true;
    currentSearchKeyword = '';
    articleSearchKeyword = '';

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.add('settings-mode');

    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');

    renderSettingsPage();
    restoreExpandedStates({ scrollY: settingsPageCache?.scrollY || 0 });

    const appEl = document.getElementById('app');
    if (appEl) {
        settingsPageCache = { innerHTML: appEl.innerHTML, scrollY: appEl.scrollTop || 0 };
    }
    triggerViewAnimation();
}

function onTabClick(target) {
    // 切出前统一保存状态
    saveFullState();

    // ===== 设置 =====
    if (target === MODE.SETTINGS) {
        if (!isSettingsMode) {
            settingsReturnState = {
                currentMode, currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                currentSearchType: currentSearchType || SEARCH_TYPE.ALL,
                selectedSpecial
            };
        }
        switchViewContainer(MODE.SETTINGS);
        enterSettings();
        return;
    }

    // ===== 专题 =====
    if (target === MODE.SPECIAL) {
        enterSpecialFromTab();
        return;
    }

    // ===== 退出设置模式 =====
    if (isSettingsMode) {
        leaveSettingsToTarget(target);
        return;
    }

    // ===== 文章 =====
    if (target === MODE.ARTICLES) {
        enterArticlesTab();
        return;
    }

    // ===== 纸币/硬币 =====
    if (target === MODE.NOTES || target === MODE.COINS) {
        enterNotesOrCoinsTab(target);
        return;
    }
}

function enterSpecialFromTab() {
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    if (isSettingsMode) {
        const appEl = document.getElementById('app');
        const contentEl = document.querySelector('.content');
        if (appEl) {
            settingsPageCache = { innerHTML: appEl.innerHTML, scrollY: contentEl ? contentEl.scrollTop : 0 };
        }
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
    }

    currentMode = MODE.SPECIAL;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    switchViewContainer(MODE.SPECIAL);

    if (selectedSpecial !== null && selectedSpecial !== undefined && specialPageCaches[selectedSpecial]) {
        const cache = specialPageCaches[selectedSpecial];
        currentSubId = cache.currentSubId || null;
        currentCategoryId = selectedSpecial;
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const toggleBtn2 = document.getElementById('sidebarToggle');
        if (toggleBtn2) toggleBtn2.style.display = '';
        document.getElementById('app').innerHTML = cache.innerHTML;
        renderSidebar();
        const savedN = modeStates.notes ? modeStates.notes.isSidebarCollapsed : false;
        const savedC = modeStates.coins ? modeStates.coins.isSidebarCollapsed : false;
        const collapse = savedN || savedC;
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.toggle('collapsed', collapse);
        isSidebarCollapsed = collapse;
        requestAnimationFrame(() => {
            const appEl = document.getElementById('app');
            if (appEl) appEl.scrollTop = cache.scrollY || 0;
        });
    } else {
        renderSpecialOverview();
    }
    triggerViewAnimation();
}

function leaveSettingsToTarget(target) {
    const appEl = document.getElementById('app');
    const contentEl = document.querySelector('.content');
    if (appEl) {
        settingsPageCache = { innerHTML: appEl.innerHTML, scrollY: contentEl ? contentEl.scrollTop : 0 };
    }
    isSettingsMode = false;

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    document.querySelector('.body-row')?.classList.remove('settings-mode');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }

    if (target === MODE.ARTICLES) {
        currentMode = MODE.ARTICLES;
        currentArticleView = articleState.currentView;
        currentArticleCategory = articleState.currentCategory;
        currentArticleIndex = articleState.currentIndex;
        articleSearchKeyword = articleState.searchKeyword;
        if (collectedArticles.length === 0) collectAllArticles();
        const inp = document.getElementById('searchInput');
        if (inp) {
            inp.value = articleSearchKeyword || '';
            inp.removeEventListener('input', doSearch);
            inp.addEventListener('input', doSearch);
        }
        switchViewContainer(MODE.ARTICLES);
        updateSearchUIForMode();
        renderSidebar();
        if (currentArticleView === VIEW.LIST) {
            renderArticleList();
        } else {
            openArticleReader(currentArticleIndex);
        }
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${MODE.ARTICLES}"]`)?.classList.add('active');
        triggerViewAnimation();
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
        switchViewContainer(MODE.SPECIAL);

        if (settingsReturnState && settingsReturnState.selectedSpecial) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.selectedSpecial;
            currentSubId = settingsReturnState.currentSubId;
            renderSidebar();
            renderSpecialContent();
            const savedN = modeStates.notes ? modeStates.notes.isSidebarCollapsed : false;
            const savedC = modeStates.coins ? modeStates.coins.isSidebarCollapsed : false;
            const collapse = savedN || savedC;
            const sb = document.getElementById('sidebar');
            if (sb) sb.classList.toggle('collapsed', collapse);
            isSidebarCollapsed = collapse;
            const cache = specialPageCaches[selectedSpecial];
            if (cache) {
                requestAnimationFrame(() => {
                    const appEl2 = document.getElementById('app');
                    if (appEl2) appEl2.scrollTop = cache.scrollY || 0;
                });
            }
        } else {
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
    switchViewContainer(currentMode + '_' + currentView);
    updateSearchUIForMode();
    renderSidebar();
    if (currentView === VIEW.OVERVIEW) {
        renderOverview();
        restoreExpandedStates({ scrollY: 0 });
    } else {
        renderCurrentCategory();
        restoreExpandedStates({ scrollY: 0 });
    }
    triggerViewAnimation();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${currentMode}"]`)?.classList.add('active');
}

function restoreNotesCoinsFromSettings(target) {
    currentMode = target;
    const saved = modeStates[target];
    if (saved.currentSearchKeyword && saved.currentSearchKeyword.trim() !== '') {
        currentView = saved.currentView;
    } else {
        currentView = VIEW.OVERVIEW;
        modeStates[target].currentView = VIEW.OVERVIEW;
    }
    currentCategoryId = saved.currentCategoryId;
    currentSubId = saved.currentSubId;
    currentSearchKeyword = saved.currentSearchKeyword || '';
    currentSearchType = saved.currentSearchType || SEARCH_TYPE.ALL;

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = currentSearchKeyword;
        inp.removeEventListener('input', doSearch);
        if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
            inp.addEventListener('input', doSearch);
        }
    }
    const typeSelect = document.getElementById('searchType');
    if (typeSelect) { typeSelect.value = currentSearchType; }

    const containerKey = currentMode + '_' + currentView;
    switchViewContainer(containerKey);

    updateSearchUIForMode();
    restoreSidebarState();
    renderSidebar();
    applySidebarState();

    if (currentView === VIEW.OVERVIEW) {
        renderOverview();
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else if (currentView === VIEW.CATEGORY) {
        renderCurrentCategory();
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else if (currentView === VIEW.SEARCH) {
        if (currentSearchKeyword) {
            performSearchAndRender(currentSearchKeyword, currentSearchType);
        } else {
            currentView = VIEW.OVERVIEW;
            switchViewContainer(currentMode + '_' + VIEW.OVERVIEW);
            renderOverview();
        }
    }
    triggerViewAnimation();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
}

function enterArticlesTab() {
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    currentMode = MODE.ARTICLES;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="articles"]')?.classList.add('active');

    if (collectedArticles.length === 0) collectAllArticles();

    currentArticleView = articleState.currentView;
    currentArticleCategory = articleState.currentCategory;
    currentArticleIndex = articleState.currentIndex;
    articleSearchKeyword = articleState.searchKeyword;

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = articleSearchKeyword || '';
        inp.removeEventListener('input', doSearch);
        inp.addEventListener('input', doSearch);
    }

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    switchViewContainer(MODE.ARTICLES);
    updateSearchUIForMode();
    renderSidebar();
    if (currentArticleView === VIEW.LIST) {
        renderArticleList();
    } else {
        openArticleReader(currentArticleIndex);
    }
    triggerViewAnimation();
}

function enterNotesOrCoinsTab(target) {
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    const newMode = target;
    currentMode = newMode;
    const saved = modeStates[newMode];

    if (saved.currentSearchKeyword && saved.currentSearchKeyword.trim() !== '') {
        currentView = saved.currentView;
    } else {
        currentView = VIEW.OVERVIEW;
        saved.currentView = VIEW.OVERVIEW;
    }

    currentCategoryId = saved.currentCategoryId;
    currentSubId = saved.currentSubId;
    currentSearchKeyword = saved.currentSearchKeyword || '';
    currentSearchType = saved.currentSearchType || SEARCH_TYPE.ALL;

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = currentSearchKeyword;
        inp.removeEventListener('input', doSearch);
        if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
            inp.addEventListener('input', doSearch);
        }
    }
    const typeSelect = document.getElementById('searchType');
    if (typeSelect) { typeSelect.value = currentSearchType; }

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    const containerKey = newMode + '_' + currentView;
    switchViewContainer(containerKey);

    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

    updateSearchUIForMode();
    restoreSidebarState();
    renderSidebar();
    applySidebarState();

    if (currentView === VIEW.OVERVIEW) {
        renderOverview();
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else if (currentView === VIEW.CATEGORY) {
        renderCurrentCategory();
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
    } else if (currentView === VIEW.SEARCH) {
        if (currentSearchKeyword) {
            performSearchAndRender(currentSearchKeyword, currentSearchType);
        } else {
            currentView = VIEW.OVERVIEW;
            switchViewContainer(newMode + '_' + VIEW.OVERVIEW);
            renderOverview();
        }
    }
    triggerViewAnimation();
}
