// ==================== article.js ====================

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

    // 数据顶层的 readme（对象）
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

    // 数据顶层的 readmes（数组）
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

        // 系列的 readme（对象）
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

        // ★ 系列的 readmes（数组）
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

                // 品种的 readme（对象）
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

                // ★ 品种的 readmes（数组）
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
    // ★ 去掉「全部文章」节点，与纸币/硬币侧边栏行为一致
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
    // 纸币（MODE.NOTES）和其他情况
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
                html += `<div class="sidebar-child ${subActive ? 'active' : ''}" onclick="onArticleSidebarClick('${sub.id}'); event.stopPropagation();">${sub.name}</div>`;
            }
            html += `</div>`;
        }
    }
    sidebar.innerHTML = html;

    // ★ 比例压缩（全局函数，定义在 sidebar.js）
    if (typeof fitSidebarLabels === 'function') {
        fitSidebarLabels();
    }
}

function onArticleSidebarClick(categoryId) {
    if (currentArticleCategory === categoryId) { currentArticleCategory = 'all'; }
    else { currentArticleCategory = categoryId; }
    currentArticleView = VIEW.LIST;
    renderArticleList();
    renderArticleSidebar();
}

function renderArticleList() {
    currentArticleView = VIEW.LIST;
    switchToCurrentContainer();
    const app = getRenderContainer();

    let articles = [];
    if (currentArticleCategory === 'all') { articles = [...collectedArticles]; }
    else {
        const isParent = articleCategoryTree.some(cat => cat.id === currentArticleCategory && cat.children && cat.children.length > 0);
        if (isParent) {
            const parentCat = articleCategoryTree.find(c => c.id === currentArticleCategory);
            const subKeys = parentCat && parentCat.children ? parentCat.children.map(s => s.dataKey || s.id) : [];
            articles = collectedArticles.filter(a => subKeys.includes(a.dataKey));
        } else {
            let targetDataKey = null;
            for (const cat of articleCategoryTree) {
                if (cat.id === currentArticleCategory) { targetDataKey = cat.dataKey || null; break; }
                if (cat.children) { for (const sub of cat.children) { if (sub.id === currentArticleCategory) { targetDataKey = sub.dataKey; break; } } if (targetDataKey) break; }
            }
            if (targetDataKey) {
                let targetSource = null;
                for (const cat of categoryTree) {
                    if (cat.id === currentArticleCategory) { targetSource = MODE.NOTES; break; }
                    if (cat.children) { for (const sub of cat.children) { if (sub.id === currentArticleCategory) { targetSource = MODE.NOTES; break; } } if (targetSource) break; }
                }
                if (!targetSource) { for (const cat of coinCategoryTree) { if (cat.id === currentArticleCategory) { targetSource = MODE.COINS; break; } } }
                if (targetSource) { articles = collectedArticles.filter(a => a.dataKey === targetDataKey && a.sourceType === targetSource); }
                else { articles = collectedArticles.filter(a => a.dataKey === targetDataKey); }
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

    let html = `<div class="overview-header"><h2>文章</h2><p>共${articles.length}篇</p></div>`;
    if (articles.length === 0) { html += '<div class="empty-state">还没有文章哦，赶快连夜肝一篇出来╮(╯▽╰)╭</div>'; app.innerHTML = html; return; }

    const grouped = {};
    for (const article of articles) {
        const pathStr = article.groupPath ? article.groupPath.join(' - ') : (article.parentCategory + ' - ' + article.category);
        if (!grouped[pathStr]) grouped[pathStr] = [];
        grouped[pathStr].push(article);
    }

    for (const [pathLabel, group] of Object.entries(grouped)) {
        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(pathLabel)} <span class="count">${group.length}篇</span></div>`;
        for (let i = 0; i < group.length; i++) {
            const article = group[i];
            const idx = collectedArticles.indexOf(article);
            html += `<div class="search-result-item" onclick="openArticleReader(${idx})">`;
            html += `<div class="info">`;
            html += `<div class="name">${highlightText(escapeHtml(article.title), articleSearchKeyword)}</div>`;
            if (article.fullPath && article.fullPath.length > 0) {
                html += `<div class="article-category" style="font-size:0.75rem;color:var(--text-secondary);margin:2px 0;">${escapeHtml(article.fullPath.join(' > '))}</div>`;
            }
            if (articleSearchKeyword && articleSearchMode === 'fulltext' && articlePlainTextCache[article.contentPath]) {
                const snippet = getContextSnippet(articlePlainTextCache[article.contentPath], articleSearchKeyword);
                if (snippet) html += `<div class="article-snippet">${highlightText(escapeHtml(snippet), articleSearchKeyword)}</div>`;
            }
            html += `</div>`;
            html += `<div class="index-num"></div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    requestAnimationFrame(() => { app.classList.remove('content-enter'); void app.offsetWidth; app.classList.add('content-enter'); });
}

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

// ★ 增加 restoreScroll 参数，支持恢复阅读位置
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

    // ★ 添加 cache: 'no-store' 绕过浏览器 HTTP 缓存
    fetch(basePath + filePath, { cache: 'no-store' })
        .then(response => { if (!response.ok) throw new Error('加载失败'); return response.text(); })
        .then(content => {
            articleContentCache[article.contentPath] = content;
            articlePlainTextCache[article.contentPath] = stripHtml(content);
            // ★ 若用户已返回列表（或切到别的文章）：只在后台缓存，不再抢回阅读器
            if (currentArticleView === VIEW.READER && currentArticleIndex === index) {
                renderArticleReader(article, content);
                app.scrollTop = restoreScroll ? (articleState.readerScrollY || 0) : 0;
            }
        })
        .catch(() => {
            if (currentArticleView === VIEW.READER && currentArticleIndex === index) {
                // ★ 报错页也加「⟳ 重新加载」按钮
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
    // 与 getArticleBasePath 保持一致，按币种区分图片目录
    const imageBase = getArticleBasePath(article.sourceType) + 'readmes/image/';
    htmlContent = htmlContent.replace(/(src\s*=\s*["']?)\s*readmes\/image\//gi, '$1' + imageBase);

    // ★ back-bar 增加「⟳ 重新加载」按钮
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

// ★ 重新加载当前文章：清内存缓存后重新拉取（配合 fetch no-store 绕过浏览器缓存）
function reloadArticle() {
    const article = collectedArticles[currentArticleIndex];
    if (!article) return;
    delete articleContentCache[article.contentPath];
    delete articlePlainTextCache[article.contentPath];
    openArticleReader(currentArticleIndex);   // 不带 restoreScroll，从顶部开始
}
