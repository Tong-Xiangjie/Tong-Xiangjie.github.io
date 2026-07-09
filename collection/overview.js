function navigateFromOverview(dataKey, si, vi, ci, hasVarieties) {
    const tree = getCategoryTree();

    // 先在纸币/硬币树中找到匹配的分类
    let foundCat = null;
    let foundSub = null;

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    foundCat = cat;
                    foundSub = sub;
                    break;
                }
            }
            if (foundCat) break;
        } else if (cat.dataKey === dataKey) {
            foundCat = cat;
            foundSub = null;
            break;
        }
    }

    if (!foundCat) return;

    // ★ 保存概览页滚动位置
    const overviewKey = getContainerKey();
    const overviewContainer = getRenderContainer();
    if (overviewContainer) {
        scrollMemory[currentMode + '-' + overviewKey] = overviewContainer.scrollTop;
    }

    // 设置新状态
    currentCategoryId = foundCat.id;
    currentSubId = foundSub ? foundSub.id : null;
    currentView = VIEW.CATEGORY;

    // ★ 切换容器前：先强制隐藏所有滚动容器和 #app
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'none';

    // ★ 再切换到目标容器并渲染
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();

    // 展开并滚动到目标条目
    setTimeout(() => {
        const seriesId = `series-${si}`;
        toggleSeries(seriesId);

        if (hasVarieties && vi !== null && vi !== undefined && vi !== 'null') {
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
}
