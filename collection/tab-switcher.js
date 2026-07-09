// ==================== tab-switcher.js ====================

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
        switchViewContainer('settings');
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
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
    }

    currentMode = MODE.SPECIAL;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    switchToCurrentContainer();

    if (selectedSpecial !== null && selectedSpecial !== undefined && specialPageCaches[selectedSpecial]) {
        const cache = specialPageCaches[selectedSpecial];
        currentSubId = cache.currentSubId || null;
        currentCategoryId = selectedSpecial;
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const toggleBtn2 = document.getElementById('sidebarToggle');
        if (toggleBtn2) toggleBtn2.style.display = '';
        document.getElementById('app').innerHTML = cache.innerHTML;
        renderSidebar();
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.toggle('collapsed', isSidebarCollapsed);
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
    isSettingsMode = false;
    document.querySelector('.body-row')?.classList.remove('settings-mode');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn && toggleBtn.style.display === 'none') {
        toggleBtn.style.display = '';
    }

    // ★ 从设置切到文章：始终显示列表视图
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
        switchToCurrentContainer();

        if (settingsReturnState && settingsReturnState.selectedSpecial) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.selectedSpecial;
            currentSubId = settingsReturnState.currentSubId;
            renderSidebar();
            renderSpecialContent();
            const sb = document.getElementById('sidebar');
            if (sb) sb.classList.toggle('collapsed', isSidebarCollapsed);
            const cache = specialPageCaches[selectedSpecial];
            if (cache) {
                requestAnimationFrame(() => {
                    const appEl = document.getElementById('app');
                    if (appEl) appEl.scrollTop = cache.scrollY || 0;
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

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = currentSearchKeyword;
        inp.removeEventListener('input', doSearch);
        if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
            inp.addEventListener('input', doSearch);
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
    } else {
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        const key = getContainerKey();
        const sk = target + '-' + key;
        if (scrollMemory[sk] !== undefined) {
            requestAnimationFrame(() => {
                container.scrollTop = scrollMemory[sk];
            });
        }
    }

    triggerViewAnimation();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
}

function restoreExpandedStates(states) {
    if (!states) return;
    if (states.expandedSeries) {
        for (const id of states.expandedSeries) {
            const body = document.getElementById('body-' + id);
            const icon = document.getElementById('icon-' + id);
            if (body) { body.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
    if (states.expandedVarieties) {
        for (const id of states.expandedVarieties) {
            const list = document.getElementById('list-' + id);
            const icon = document.getElementById('icon-' + id);
            if (list) { list.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
}

// ★ 进入文章板块：始终显示列表视图，保留滚动位置
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

    // ★ 从其他板块切到文章时，始终显示列表视图
    currentArticleView = VIEW.LIST;
    currentArticleCategory = articleState.currentCategory || 'all';
    currentArticleIndex = -1;
    articleSearchKeyword = articleState.searchKeyword || '';

    const inp = document.getElementById('searchInput');
    if (inp) {
        inp.value = articleSearchKeyword || '';
        inp.removeEventListener('input', doSearch);
        inp.addEventListener('input', doSearch);
    }

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.remove('hidden');

    switchToCurrentContainer();
    updateSearchUIForMode();
    renderSidebar();

    // ★ 总是重新渲染列表（保证最新内容），然后恢复滚动
    renderArticleList();
    const container = getRenderContainer();
    if (articleState.listScrollY > 0) {
        requestAnimationFrame(() => {
            container.scrollTop = articleState.listScrollY;
        });
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

    currentCategoryId = saved.currentCategoryId;
    currentSubId = saved.currentSubId;
    currentView = saved.currentView || VIEW.OVERVIEW;
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
    } else {
        restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        const key = getContainerKey();
        const sk = newMode + '-' + key;
        if (scrollMemory[sk] !== undefined) {
            requestAnimationFrame(() => {
                container.scrollTop = scrollMemory[sk];
            });
        }
    }
    triggerViewAnimation();
}
