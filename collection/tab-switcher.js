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
    saveFullState();

    if (target === MODE.SETTINGS) {
        if (!isSettingsMode) {
            // ★ 保存专题页面的完整状态（包括 innerHTML）
            if (currentMode === MODE.SPECIAL && selectedSpecial !== null && selectedSpecial !== undefined) {
                const appEl = document.getElementById('app');
                specialPageCaches[selectedSpecial] = {
                    innerHTML: appEl ? appEl.innerHTML : '',
                    scrollY: appEl ? appEl.scrollTop : 0,
                    currentSubId
                };
            }
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
    if (isSettingsMode) {
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
    }

    // ★ 从 settingsReturnState 恢复 selectedSpecial 和缓存
    if (settingsReturnState && settingsReturnState.currentMode === MODE.SPECIAL) {
        if (selectedSpecial === null || selectedSpecial === undefined) {
            selectedSpecial = settingsReturnState.selectedSpecial;
        }
        if (currentCategoryId === null) {
            currentCategoryId = settingsReturnState.currentCategoryId;
        }
    }

    currentMode = MODE.SPECIAL;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    if (selectedSpecial === null || selectedSpecial === undefined) {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.style.display = 'none';
        switchToCurrentContainer();
        renderSpecialOverview();
        triggerViewAnimation();
        return;
    }

    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    switchToCurrentContainer();

    if (specialPageCaches[selectedSpecial]) {
        const cache = specialPageCaches[selectedSpecial];
        currentSubId = cache.currentSubId || null;
        currentCategoryId = selectedSpecial;
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
        // ★ 从 settingsReturnState 恢复 selectedSpecial
        if (settingsReturnState && settingsReturnState.selectedSpecial !== undefined && settingsReturnState.selectedSpecial !== null) {
            selectedSpecial = settingsReturnState.selectedSpecial;
        }
        currentMode = MODE.SPECIAL;
        document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');
        const searchContainer2 = document.querySelector('.top-search-container');
        if (searchContainer2) searchContainer2.classList.add('hidden');
        switchToCurrentContainer();

        if (settingsReturnState && settingsReturnState.selectedSpecial) {
            selectedSpecial = settingsReturnState.selectedSpecial;
            currentCategoryId = settingsReturnState.selectedSpecial;
            currentSubId = settingsReturnState.currentSubId;
            document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
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

// ... 其余函数保持不变 ...
