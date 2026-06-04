// ========== 文章状态 ==========
let currentArticleView = 'list';
let currentArticleCategory = 'all';
let currentArticleIndex = -1;
let collectedArticles = [];
let articleContentCache = {};
let articleSearchKeyword = '';

let articleCategoryTree = [];

// ========== 文章收集 ==========
function collectAllArticles() {
    collectedArticles = [];
    const allPossibleKeys = [...allDataKeys, ...coinAllDataKeys];
    const processedKeys = new Set();

    for (const dataKey of allPossibleKeys) {
        if (processedKeys.has(dataKey)) continue;
        processedKeys.add(dataKey);

        let data = null;
        if (window.DATA_MAP && window.DATA_MAP[dataKey]) data = window.DATA_MAP[dataKey];
        if (!data && window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey]) data = window.COIN_DATA_MAP[dataKey];
        if (!data || !data.series) continue;

        const catInfo = findArticleCategoryInfo(dataKey);

        for (let si = 0; si < data.series.length; si++) {
            const series = data.series[si];
            if (series.readme && series.readme.title && series.readme.content) {
                collectedArticles.push({
                    title: series.readme.title,
                    contentPath: series.readme.content,
                    category: catInfo.category,
                    parentCategory: catInfo.parentCategory,
                    dataKey,
                    seriesIndex: si,
                    seriesName: series.seriesName
                });
            }
        }
    }

    buildArticleCategoryTree();
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

function buildArticleCategoryTree() {
    const parentCats = {};
    for (const article of collectedArticles) {
        const pc = article.parentCategory;
        if (!parentCats[pc]) parentCats[pc] = {};
        if (!parentCats[pc][article.category]) parentCats[pc][article.category] = 0;
        parentCats[pc][article.category]++;
    }

    articleCategoryTree = [{ id: 'all', name: '全部文章', children: null }];
    for (const [parentName, subCats] of Object.entries(parentCats)) {
        const children = [];
        for (const [subName, count] of Object.entries(subCats)) {
            children.push({ id: subName, name: subName + '（' + count + '篇）', dataKey: subName });
        }
        articleCategoryTree.push({
            id: parentName,
            name: parentName,
            children: children
        });
    }
}

// ========== 侧边栏渲染（文章模式） ==========
function renderArticleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    let html = '';
    for (const cat of articleCategoryTree) {
        const hasChildren = cat.children && cat.children.length > 0;
        const isActive = currentArticleCategory === cat.id;
        const isExpanded = isActive && hasChildren;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onArticleSidebarClick('${cat.id}')">`;
        html += `<span>${cat.name}</span>`;
        if (hasChildren) {
            html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>`;
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
        articles = collectedArticles.filter(a =>
            a.category === currentArticleCategory || a.parentCategory === currentArticleCategory
        );
    }

    if (articleSearchKeyword) {
        const kw = articleSearchKeyword.toLowerCase();
        articles = articles.filter(a => {
            if (a.title.toLowerCase().includes(kw)) return true;
            const content = articleContentCache[a.contentPath] || '';
            return content.toLowerCase().includes(kw);
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
        const key = article.parentCategory + ' - ' + article.category;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(article);
    }

    for (const [label, group] of Object.entries(grouped)) {
        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${group.length}篇</span></div>`;
        for (let i = 0; i < group.length; i++) {
            const article = group[i];
            const idx = collectedArticles.indexOf(article);
            html += `<div class="search-result-item" onclick="openArticleReader(${idx})">`;
            html += `<div class="info">`;
            html += `<div class="name">${highlightText(escapeHtml(article.title), articleSearchKeyword)}</div>`;
            html += `<div class="detail">${escapeHtml(article.seriesName)}</div>`;
            if (articleSearchKeyword && articleContentCache[article.contentPath]) {
                const snippet = getContextSnippet(articleContentCache[article.contentPath], articleSearchKeyword);
                if (snippet) {
                    html += `<div class="article-snippet">${highlightText(escapeHtml(snippet), articleSearchKeyword)}</div>`;
                }
            }
            html += `</div>`;
            html += `<div class="index-num">📄</div>`;
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

function getContextSnippet(content, keyword) {
    if (!content || !keyword) return '';
    const lower = content.toLowerCase();
    const kwLower = keyword.toLowerCase();
    const idx = lower.indexOf(kwLower);
    if (idx === -1) return '';
    const start = Math.max(0, idx - 20);
    const end = Math.min(content.length, idx + keyword.length + 20);
    let snippet = content.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
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

    if (articleContentCache[article.contentPath]) {
        renderArticleReader(article, articleContentCache[article.contentPath]);
        return;
    }

    app.innerHTML = `<div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div><div class="empty-state">加载中...</div>`;

    let filePath = article.contentPath;
    if (filePath.startsWith('file:')) filePath = filePath.substring(5);

    fetch('../notecollection/' + filePath)
        .then(response => {
            if (!response.ok) throw new Error('加载失败');
            return response.text();
        })
        .then(content => {
            articleContentCache[article.contentPath] = content;
            renderArticleReader(article, content);
        })
        .catch(() => {
            app.innerHTML = `<div class="overview-header"><h2>${escapeHtml(article.title)}</h2></div><div class="empty-state">文章加载失败</div>`;
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
