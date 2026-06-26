// ========== 文章状态 ==========
let currentArticleView = 'list';
let currentArticleCategory = 'all';
let currentArticleIndex = -1;
let collectedArticles = [];
let articleContentCache = {};
let articlePlainTextCache = {};
let articleSearchKeyword = '';
let articleSearchMode = 'title';
let isArticlePreloading = false;

let articleCategoryTree = [];

// ========== 文章收集 ==========
function collectAllArticles() {
    collectedArticles = [];
    
    for (const dataKey of allDataKeys) {
        const data = window.DATA_MAP && window.DATA_MAP[dataKey];
        if (!data || !data.series) continue;
        collectFromSource(data, dataKey, 'notes');
    }
    
    for (const dataKey of coinAllDataKeys) {
        const data = window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey];
        if (!data || !data.series) continue;
        collectFromSource(data, dataKey, 'coins');
    }

    buildArticleCategoryTree();
}

function collectFromSource(data, dataKey, sourceType) {
    const catInfo = findArticleCategoryInfo(dataKey);

    for (let si = 0; si < data.series.length; si++) {
        const series = data.series[si];

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
                seriesIndex: si,
                varietyIndex: -1,
                seriesName: series.seriesName
            });
        }

        if (series.varieties && series.varieties.length > 0) {
            for (let vi = 0; vi < series.varieties.length; vi++) {
                const variety = series.varieties[vi];
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
                        seriesIndex: si,
                        varietyIndex: vi,
                        seriesName: series.seriesName
                    });
                }
            }
        }
    }
}

function buildFullPath(sourceType, catInfo, seriesName, varietyName) {
    const top = sourceType === 'coins' ? '硬币' : '纸币';
    const parts = [top];
    
    if (catInfo.parentCategory && catInfo.parentCategory !== top && catInfo.parentCategory !== catInfo.category) {
        parts.push(catInfo.parentCategory);
    }
    parts.push(catInfo.category);
    if (seriesName) parts.push(seriesName);
    if (varietyName) parts.push(varietyName);
    
    return parts;
}

function findArticleCategoryInfo(dataKey) {
    for (const cat of categoryTree) {
        if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: '纸币' };
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
            }
        }
    }
    for (const cat of coinCategoryTree) {
        if (cat.dataKey === dataKey) return { category: cat.name, parentCategory: '硬币' };
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) return { category: sub.name, parentCategory: cat.name };
            }
        }
    }
    return { category: dataKey, parentCategory: '其他' };
}

// ========== 动态构建文章分类树 ==========
function buildArticleCategoryTree() {
    articleCategoryTree = [{ id: 'all', name: '全部文章', children: null }];

    const notesArticles = collectedArticles.filter(a => a.sourceType === 'notes');
    const coinsArticles = collectedArticles.filter(a => a.sourceType === 'coins');
    
    const notesCount = {};
    for (const a of notesArticles) {
        if (!notesCount[a.dataKey]) notesCount[a.dataKey] = 0;
        notesCount[a.dataKey]++;
    }
    
    const coinsCount = {};
    for (const a of coinsArticles) {
        if (!coinsCount[a.dataKey]) coinsCount[a.dataKey] = 0;
        coinsCount[a.dataKey]++;
    }

    // 纸币分类
    for (const cat of categoryTree) {
        if (cat.children) {
            const children = [];
            let parentTotal = 0;
            for (const sub of cat.children) {
                const count = notesCount[sub.dataKey] || 0;
                parentTotal += count;
                if (count > 0) {
                    children.push({ id: sub.id, name: sub.name + '（' + count + '篇）', dataKey: sub.dataKey });
                }
            }
            if (children.length > 0) {
                articleCategoryTree.push({
                    id: cat.id,
                    name: cat.name + '（' + parentTotal + '篇）',
                    children: children
                });
            }
        } else {
            const count = notesCount[cat.dataKey] || 0;
            if (count > 0) {
                articleCategoryTree.push({
                    id: cat.id,
                    name: cat.name + '（' + count + '篇）',
                    dataKey: cat.dataKey,
                    children: null
                });
            }
        }
    }

    // 硬币分类
    for (const cat of coinCategoryTree) {
        const count = coinsCount[cat.dataKey] || 0;
        if (count > 0) {
            articleCategoryTree.push({
                id: cat.id,
                name: cat.name + '（' + count + '篇）',
                dataKey: cat.dataKey,
                children: null
            });
        }
    }
}

// ========== 预加载全部文章 ==========
async function preloadAllArticles() {
    if (isArticlePreloading) return;
    isArticlePreloading = true;

    const tip = document.getElementById('searchTip');
    if (tip) tip.textContent = '正在加载全文索引...';

    const promises = collectedArticles.map(article => preloadArticle(article));
    await Promise.allSettled(promises);

    isArticlePreloading = false;
    if (tip) tip.textContent = '全文索引已就绪，可搜索正文内容';
}

async function preloadArticle(article) {
    if (articleContentCache[article.contentPath]) return;

    let filePath = article.contentPath;
    if (filePath.startsWith('file:')) filePath = filePath.substring(5);

    try {
        const response = await fetch('../notecollection/' + filePath);
        if (!response.ok) throw new Error('加载失败');
        const html = await response.text();
        articleContentCache[article.contentPath] = html;
        articlePlainTextCache[article.contentPath] = stripHtml(html);
    } catch (e) {
        // 加载失败忽略
    }
}

function stripHtml(html) {
    if (!html) return '';
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

// ========== 切换搜索模式 ==========
function toggleArticleSearchMode() {
    if (articleSearchMode === 'title') {
        articleSearchMode = 'fulltext';
        const input = document.getElementById('searchInput');
        if (input) {
            input.removeEventListener('input', doSearch);
            input.addEventListener('input', doSearch);
        }
        preloadAllArticles().then(() => {
            if (articleSearchKeyword) renderArticleList();
        });
    } else {
        articleSearchMode = 'title';
        if (articleSearchKeyword) renderArticleList();
    }
    updateSearchUIForMode();
}

// ========== 侧边栏渲染 ==========
function renderArticleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    let html = '';
    for (const cat of articleCategoryTree) {
        const hasChildren = cat.children && cat.children.length > 0;
        const isActive = cat.id === currentArticleCategory || 
            (hasChildren && cat.children.some(sub => sub.id === currentArticleCategory));
        const isExpanded = (isActive && hasChildren) || 
            (hasChildren && cat.children.some(sub => sub.id === currentArticleCategory));
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onArticleSidebarClick('${cat.id}')">`;
        html += `<span>${cat.name}</span>`;
        if (hasChildren) {
            html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▸</span>`;
        }
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
}

function onArticleSidebarClick(categoryId) {
    if (currentArticleCategory === categoryId) {
        currentArticleCategory = 'all';
    } else {
        currentArticleCategory = categoryId;
    }
    currentArticleView = 'list';
    renderArticleList();
    renderArticleSidebar();
}

// ========== 文章列表 ==========
function renderArticleList() {
    const app = document.getElementById('app');
    currentArticleView = 'list';

    let articles = [];
    if (currentArticleCategory === 'all') {
        articles = [...collectedArticles];
    } else {
        const isParent = articleCategoryTree.some(cat => cat.id === currentArticleCategory && cat.children && cat.children.length > 0);

        if (isParent) {
            const parentCat = articleCategoryTree.find(c => c.id === currentArticleCategory);
            if (parentCat && parentCat.children) {
                const subKeys = parentCat.children.map(s => s.dataKey || s.id);
                articles = collectedArticles.filter(a => subKeys.includes(a.dataKey));
            } else {
                articles = [];
            }
        } else {
            let targetDataKey = null;
            for (const cat of articleCategoryTree) {
                if (cat.id === currentArticleCategory) {
                    targetDataKey = cat.dataKey || null;
                    break;
                }
                if (cat.children) {
                    for (const sub of cat.children) {
                        if (sub.id === currentArticleCategory) {
                            targetDataKey = sub.dataKey;
                            break;
                        }
                    }
                    if (targetDataKey) break;
                }
            }

            if (targetDataKey) {
                let targetSource = null;
                for (const cat of categoryTree) {
                    if (cat.id === currentArticleCategory) {
                        targetSource = 'notes';
                        break;
                    }
                    if (cat.children) {
                        for (const sub of cat.children) {
                            if (sub.id === currentArticleCategory) {
                                targetSource = 'notes';
                                break;
                            }
                        }
                        if (targetSource) break;
                    }
                }
                if (!targetSource) {
                    for (const cat of coinCategoryTree) {
                        if (cat.id === currentArticleCategory) {
                            targetSource = 'coins';
                            break;
                        }
                    }
                }
                
                if (targetSource) {
                    articles = collectedArticles.filter(a => a.dataKey === targetDataKey && a.sourceType === targetSource);
                } else {
                    articles = collectedArticles.filter(a => a.dataKey === targetDataKey);
                }
            } else {
                articles = collectedArticles.filter(a =>
                    a.category === currentArticleCategory || a.parentCategory === currentArticleCategory
                );
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

    let html = `<div class="overview-header"><h2>文章</h2><p>共 ${articles.length} 篇</p></div>`;
    if (articles.length === 0) {
        html += '<div class="empty-state">暂无文章</div>';
        app.innerHTML = html;
        return;
    }

    const grouped = {};
    for (const article of articles) {
        const pathStr = article.fullPath ? article.fullPath.join(' - ') : (article.parentCategory + ' - ' + article.category);
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
            // 只保留带 > 的完整分类路径，删掉单独的 seriesName 行
            if (article.fullPath && article.fullPath.length > 0) {
                html += `<div class="article-category" style="font-size:0.75rem;color:var(--text-secondary);margin:2px 0;">${escapeHtml(article.fullPath.join(' > '))}</div>`;
            }
            if (articleSearchKeyword && articleSearchMode === 'fulltext' && articlePlainTextCache[article.contentPath]) {
                const snippet = getContextSnippet(articlePlainTextCache[article.contentPath], articleSearchKeyword);
                if (snippet) {
                    html += `<div class="article-snippet">${highlightText(escapeHtml(snippet), articleSearchKeyword)}</div>`;
                }
            }
            html += `</div>`;
            html += `<div class="index-num"></div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    requestAnimationFrame(() => {
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
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

// ========== 文章阅读器 ==========
function openArticleReader(index) {
    currentArticleIndex = index;
    currentArticleView = 'reader';
    const article = collectedArticles[index];
    if (!article) return;

    const app = document.getElementById('app');

    let html = `<div class="back-bar"><button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button></div>`;

    if (articleContentCache[article.contentPath]) {
        renderArticleReader(article, articleContentCache[article.contentPath]);
        return;
    }

    html += `<div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div><div class="empty-state">加载中...</div>`;
    app.innerHTML = html;

    let filePath = article.contentPath;
    if (filePath.startsWith('file:')) filePath = filePath.substring(5);

    fetch('../notecollection/' + filePath)
        .then(response => {
            if (!response.ok) throw new Error('加载失败');
            return response.text();
        })
        .then(content => {
            articleContentCache[article.contentPath] = content;
            articlePlainTextCache[article.contentPath] = stripHtml(content);
            renderArticleReader(article, content);
        })
        .catch(() => {
            app.innerHTML = `<div class="back-bar"><button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button></div><div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div><div class="empty-state">文章不见了哦~</div>`;
        });
}

function renderArticleReader(article, content) {
    const app = document.getElementById('app');
    let htmlContent = content;
    htmlContent = htmlContent.replace(/src="readmes\/image\//g, 'src="../notecollection/readmes/image/');
    htmlContent = htmlContent.replace(/src='readmes\/image\//g, "src='../notecollection/readmes/image/");

    let html = `<div class="back-bar"><button class="back-btn" onclick="closeArticleReader()">← 返回文章列表</button></div>`;
    html += `<div class="article-reader">`;
    html += htmlContent;
    html += `</div>`;

    app.innerHTML = html;
    requestAnimationFrame(() => {
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
}

function closeArticleReader() {
    currentArticleView = 'list';
    renderArticleList();
}
