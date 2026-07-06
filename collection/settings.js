// ==================== settings.js ====================
// 设置页渲染

function renderSettingsPage() {
    const app = document.getElementById('app');
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';
    const customColors = getCustomColors();
    const allStats = computeStats();
    const stats = computeStats(ratingMode);

    let html = `<div class="settings-page">`;
    html += `<h2>我的</h2>`;

    html += `<div class="settings-section">`;
    html += `<h3>藏品数量</h3>`;
    html += `<div class="stats-summary-cards">`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.total}</div><div class="stat-label">藏品总数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.notesCount}</div><div class="stat-label">纸币数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.coinsCount}</div><div class="stat-label">硬币数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.prices.filter(p => !p.noPrice).length}</div><div class="stat-label">已记录价格</div></div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>资金投入</h3>`;
    html += `<div class="stats-money">`;
    html += `<div class="money-row"><span class="money-label">藏品总投入</span><span class="money-value">${allStats.totalPrice.toFixed(0)}元</span></div>`;
    html += `<div class="money-row"><span class="money-label">藏品均价</span><span class="money-value">${allStats.avgPrice}元/件</span></div>`;
    html += `</div>`;

    html += `<div class="price-list-wrapper">`;
    html += `<div class="price-list-header" onclick="togglePriceList()">`;
    html += `<span>价格列表</span>`;
    html += `<div class="price-list-controls">`;
    html += `<select class="price-sort-select" id="priceSortSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="default" selected>默认排序</option>`;
    html += `<option value="desc">从高到低</option>`;
    html += `<option value="asc">从低到高</option>`;
    html += `</select>`;
    html += `<select class="price-filter-select" id="priceFilterSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="all">全部藏品</option>`;
    const filterCategories = buildPriceFilterCategories();
    for (const cat of filterCategories) {
        html += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
    }
    html += `</select>`;
    html += `</div>`;
    html += `<span class="price-list-arrow" id="priceListArrow">▼</span>`;
    html += `</div>`;
    html += `<div class="price-list-summary" id="priceListSummary" style="display:none;"></div>`;
    html += `<div class="price-list-body" id="priceListBody">`;
    html += renderPriceListItems(allStats.prices, 'default', 'all', null);
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<div class="rating-section-header">`;
    html += `<div class="rating-tabs">`;
    html += `<span class="rating-tab ${ratingMode === 'notes' ? 'active' : ''}" data-mode="notes" onclick="switchRatingMode('notes')">纸币</span>`;
    html += `<span class="rating-tab ${ratingMode === 'coins' ? 'active' : ''}" data-mode="coins" onclick="switchRatingMode('coins')">硬币</span>`;
    html += `</div>`;
    html += `<h3>评级得分统计</h3>`;
    html += `</div>`;
    html += `<div id="ratingSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildRatingHTML(stats);
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>藏品年代统计</h3>`;
    html += `<div id="yearSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildYearHTML(stats);
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>主题色</h3>`;
    html += `<div class="theme-colors" id="settingsThemeColors">`;
    const presetColors = ['#1677ff', '#d92121', '#00b42a', '#ff7d00', '#722ed1'];
    for (const color of presetColors) {
        const active = color === currentTheme ? ' active' : '';
        html += `<div class="theme-color${active}" style="background:${color}" data-color="${color}"></div>`;
    }
    html += `</div>`;

    html += `<div class="saved-colors" id="savedColorsContainer">`;
    if (customColors.length === 0) {
        html += `<span class="empty-colors-hint">您还没有设定自定义颜色～</span>`;
    } else {
        for (let i = 0; i < customColors.length; i++) {
            const color = customColors[i];
            const active = color === currentTheme ? ' active' : '';
            html += `<div class="saved-color-item">`;
            html += `<div class="color-block${active}" style="background:${color}" data-color="${color}" onclick="setTheme('${color}'); updateSettingsPageTheme('${color}')"></div>`;
            html += `<button class="remove-color-btn" onclick="removeCustomColor(${i})">x</button>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    html += `<div class="custom-color-row">`;
    html += `<label for="settingsCustomColor">自定义颜色</label>`;
    html += `<input type="color" id="settingsCustomColor" value="${currentTheme}">`;
    html += `<button class="add-color-btn" onclick="addCurrentCustomColor()">添加</button>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>数据导出</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="exportJSON()">数据备份.json</button>`;
    html += `<button class="export-btn" onclick="exportCSV()">详细表格.csv</button>`;
    html += `<button class="export-btn" onclick="exportMarkdown()">概览报告.md</button>`;
    html += `<button class="export-btn" onclick="exportPriceList()">价格清单.txt</button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">点击按钮将会自动下载相应文件</p>`;
    html += `</div>`;

    html += `</div>`;
    app.innerHTML = html;

    document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
        el.addEventListener('click', function() {
            const color = this.dataset.color;
            updateSettingsPageTheme(color);
            if (typeof setTheme === 'function') setTheme(color);
        });
    });
}

function togglePriceList() {
    const body = document.getElementById('priceListBody');
    const arrow = document.getElementById('priceListArrow');
    if (!body || !arrow) return;
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function updateSettingsPageTheme(color) {
    document.querySelectorAll('.theme-color, .color-block').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.color === color) {
            el.classList.add('active');
        }
    });
    const picker = document.getElementById('settingsCustomColor');
    if (picker) picker.value = color;
}

function addCurrentCustomColor() {
    const picker = document.getElementById('settingsCustomColor');
    if (!picker) return;
    const color = picker.value;
    addCustomColor(color);
    renderSettingsPage();
    if (typeof setTheme === 'function') setTheme(color);
}
