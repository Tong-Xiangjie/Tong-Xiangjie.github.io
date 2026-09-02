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

    switchToCurrentContainer();
    renderSettingsPage();
    triggerViewAnimation();
}

function onTabClick(target) {
    saveFullState();

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
    // ★ 关键：记录进入函数时是否正处于“设置页”模式
    const isLeavingSettings = isSettingsMode;

    if (isSettingsMode) {
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
    }

    // ★ 只有“刚从设置页返回”且“进入设置前就在专题里”时，才去恢复专题的内部筛选状态
    const isRestoringFromSettings = isLeavingSettings && 
                                    settingsReturnState && 
                                    settingsReturnState.currentMode === MODE.SPECIAL;

    if (isRestoringFromSettings) {
        // 从设置页返回，且之前在专题里：恢复专题本身的选中状态，并保留专题内部的筛选（如“2020s”）
        if (selectedSpecial === null || selectedSpecial === undefined) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId || null;
        }
        // ★ 关键：状态用完后立即清空，防止下次切换标签时误用
        settingsReturnState = null;
    } else {
        // ★ 其他所有情况（从纸币/硬币/文章切过来，或从设置返回但之前不在专题里）：
        // 强制清空任何可能残留的、来自其他板块的子分类 ID
        currentSubId = null;
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            currentCategoryId = selectedSpecial;
        }
        // 如果是从设置页返回但之前不在专题里，也把状态清掉
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

            // ★ 不要手动清空容器
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
        inp.removeEventListener('input', doSearch);
        inp.addEventListener('input', doSearch);
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

    // ★★★ 修复：首次进入文章 Tab 且为全字段索引模式时，主动触发预加载 ★★★
    if (articleSearchMode === 'fulltext') {
        // 延迟一点启动，不阻塞首次渲染
        setTimeout(() => {
            // 如果 preloadAllArticles 尚未执行（或正在执行），调用它
            if (typeof preloadAllArticles === 'function') {
                preloadAllArticles().then(() => {
                    // 如果当前仍在文章列表且没有搜索词，刷新列表以更新提示状态（加载完成提示）
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