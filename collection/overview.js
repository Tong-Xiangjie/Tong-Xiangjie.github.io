// ==================== overview.js ====================

function renderOverview() {
    const app = getRenderContainer();
    currentView = VIEW.OVERVIEW;

    let allItems = [];
    let globalIndex = 1;
    const tree = getCategoryTree();

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                const data = getData(sub.dataKey);
                if (!data || !data.series) continue;
                const catLabel = cat.name + ' - ' + sub.name;
                for (let si = 0; si < data.series.length; si++) {
                    const series = data.series[si];
                    if (series.varieties) {
                        for (let vi = 0; vi < series.varieties.length; vi++) {
                            const variety = series.varieties[vi];
                            if (!variety.copies) continue;
                            for (let ci = 0; ci < variety.copies.length; ci++) {
                                allItems.push({
                                    catLabel, catId: cat.id, subId: sub.id,
                                    dataKey: sub.dataKey, si, vi, ci,
                                    series, variety, copy: variety.copies[ci],
                                    hasVarieties: true, globalIndex: globalIndex++
                                });
                            }
                        }
                    } else if (series.copies) {
                        for (let ci = 0; ci < series.copies.length; ci++) {
                            allItems.push({
                                catLabel, catId: cat.id, subId: sub.id,
                                dataKey: sub.dataKey, si, vi: null, ci,
                                series, variety: null, copy: series.copies[ci],
                                hasVarieties: false, globalIndex: globalIndex++
                            });
                        }
                    }
                }
            }
        } else if (cat.dataKey) {
            const data = getData(cat.dataKey);
            if (!data || !data.series) continue;
            const catLabel = cat.name;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allItems.push({
                                catLabel, catId: cat.id, subId: null,
                                dataKey: cat.dataKey, si, vi, ci,
                                series, variety, copy: variety.copies[ci],
                                hasVarieties: true, globalIndex: globalIndex++
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allItems.push({
                            catLabel, catId: cat.id, subId: null,
                            dataKey: cat.dataKey, si, vi: null, ci,
                            series, variety: null, copy: series.copies[ci],
                            hasVarieties: false, globalIndex: globalIndex++
                        });
                    }
                }
            }
        }
    }

    // ★ 分享模式：概览页只显示**分享范围内**的藏品。
    //   用户要求：「还是应该要可以看概览页，不过只显示出来部分数据」。
    //   为什么必须在这里拦：点侧边栏里当前那个分类，core.js 会**页内换视图**回到概览，
    //   URL 一字不变 ⇒ 门禁（只看地址栏）察觉不到，收件人就能在概览里看到全部 380 件。
    //   判定用 share-core.js 的 shareRouteAllowed（与门禁同一谓词，非分享模式一律放行），
    //   所以 board/category/selection 三档、以及 a=s1,6 这种只放行几个系列的情况都自动管住。
    if (typeof shareRouteAllowed === 'function') {
        const modeSeg = String(location.hash || '').replace(/^#/, '').split('/')[0] || 'notes';
        allItems = allItems.filter(function (it) {
            // ★ 子分类的真路由是**三段**：notes/<父id>/<子id>。
            //   实测：#notes/rmb/rmb3 才进第三套人民币的分类页；
            //   #notes/rmb3 被应用当成无效路由、**回退到概览**。
            //   所以父 id（it.catId）不能丢 —— 丢了就会把范围内的子分类整页裁空。
            let h = modeSeg + '/' + it.catId + (it.subId ? '/' + it.subId : '') + '/s' + it.si;
            if (it.hasVarieties && it.vi !== null && it.vi !== undefined) h += '/v' + it.vi;
            return shareRouteAllowed(h);
        });
    }

    // ★ 板块中文名从注册表取（原来是 `=== MODE.NOTES ? '纸币' : '硬币'` ——
    //   一旦有第三个板块，硬币分支就会被错误地复用给新板块）。
    //   局部变量故意不叫 modeLabel，避免遮蔽 core.js 里的同名函数。
    const modeName = modeLabel();
    let html = `<div class="overview-header"><h2>全部${modeName}</h2><p>共${allItems.length}件藏品</p></div>`;
    if (allItems.length === 0) {
        html += '<div class="empty-state">' + emptyArt('collection') + '啥都木有</div>';
        app.innerHTML = html;
        return;
    }

    const grouped = {};
    for (const item of allItems) {
        if (!grouped[item.catLabel]) grouped[item.catLabel] = [];
        grouped[item.catLabel].push(item);
    }

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                const label = cat.name + ' - ' + sub.name;
                if (!grouped[label]) continue;
                html += renderOverviewGroup(label, grouped[label]);
            }
        } else if (cat.name) {
            if (!grouped[cat.name]) continue;
            html += renderOverviewGroup(cat.name, grouped[cat.name]);
        }
    }

    app.innerHTML = html;

    // ★ 全局概览的滚动位置：一直保留 —— 不受切 tab（纸币/硬币）影响，也不受进出分类影响。
    //   重渲染会把 scrollTop 钳到 0，所以必须在渲染后放回去（见 core.js 的滚动记忆）。
    if (typeof restoreCategoryScroll === 'function') restoreCategoryScroll();

    // ★ 概览页图片是懒加载的，渲染完成后在后台补齐，保证「没滚到的图」也能离线看
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function renderOverviewGroup(label, items) {
    let html = `<div class="search-result-group">`;
    html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${items.length}件</span></div>`;
    for (const item of items) {
        const c = item.copy;
        const img1 = getImageUrl(c.img1);
        const img2 = getImageUrl(c.img2);
        const g1 = gridImg(c.img1);
        const g2 = gridImg(c.img2);
        const displayName = item.hasVarieties && item.variety
            ? `${item.series.seriesName} - ${item.variety.varietyName}`
            : item.series.seriesName;

        const catalogNum = c.catalogNumber || c.krause || '';
        const catalogDisplay = formatCatalogNumber(catalogNum);

        html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
        html += `<div class="dual-thumb">`;
        if (img1) html += `<img class="mini-thumb" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
        if (img2) html += `<img class="mini-thumb" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
        if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">图片它不见力(╯︵╰,)</div>`;
        html += `</div>`;
        html += `<div class="info">`;
        html += `<div class="name">${escapeHtml(displayName)}</div>`;
        html += `<div class="detail">`;
        if (c.version) html += `${escapeHtml(c.version)} · `;
        // ★ 评级公司放在分数**前面**，中间恰好一个半角空格：`PCGS MS67`（用户要求：
        //   「PCGS MS67 之间是普通空格不是点」）。原来只渲染分数（`MS67 · 1984年发行…`）。
        //   · 公司键名与详情页（category-view.js 的 renderCopiesList）同源：硬币是
        //     `gradingCompany`（分数是 `grade`；纸币那边没有这个字段，公司名本来就写在
        //     `condition` 里，如 "ACG 66E"），所以这里对纸币是**恒等变换**。
        //   · 仍然按板块分流（判据与详情页的 isCoinBoardLayout() 同源：currentMode），
        //     纸币/其它板块的条目文本一个字符都不变 —— 由 verify-coin-overview-company.mjs
        //     的基线守卫逐条比对（379 条纸币概览文本 + 全表 sha256）。
        //   · 数据里没有公司时不加任何前缀：不留前导空格、不出现 undefined/null
        //     （除了挡掉 null/undefined 本身，还挡掉字符串 "undefined"/"null" 那种
        //       CSV 导入常见的坏值 —— 它们不是评级公司，不能当公司名印在概览上）。
        const rawCompany = (typeof c.gradingCompany === 'string' && isCoinBoardLayout()) ? c.gradingCompany.trim() : '';
        const companyText = (rawCompany && rawCompany !== 'undefined' && rawCompany !== 'null') ? rawCompany : '';
        if (companyText) html += `${escapeHtml(companyText)} `;
        if (c.condition || c.grade) html += `${escapeHtml(c.condition || c.grade)} · `;
        if (c.year) html += `${c.year}年发行`;
        if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
        html += `</div></div>`;
        html += `<div class="index-num">#${item.globalIndex}</div>`;
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

function navigateFromOverview(dataKey, si, vi, ci, hasVarieties) {
    const tree = getCategoryTree();

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

    // 设置新状态
    currentCategoryId = foundCat.id;
    currentSubId = foundSub ? foundSub.id : null;
    currentView = VIEW.CATEGORY;

    // 彻底清理：移除所有现有滚动容器的 display:block 并清空内容
    const allKeys = Object.keys(viewScrollContainers);
    for (const k of allKeys) {
        const container = viewScrollContainers[k];
        container.style.display = 'none';
        container.innerHTML = '';
    }
    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.style.display = 'none';
        appEl.innerHTML = '';
    }

    // ★ hasVarieties 是唯一权威：概览条目的 vi 对"无品种系列"也填了值（数据里一律是 0），
    //   那是 series 内部的条目序号，不是品种序号。若不加这个门控就会写出
    //   …/s0/v0 这种指向不存在品种的链接（实测），别人点开只会看到一个空展开。
    const wantVariety = !!(hasVarieties && vi !== null && vi !== undefined && vi !== 'null');

    // ★ 登记"待展开条目"：必须在 renderCurrentCategory() **之前**，
    //   renderSeriesList() 会消费它并直接生成已展开的标记。
    //   原来只靠下面的 setTimeout 去补开，一条异步链上任何一环落空就静默失败
    //   （用户报的"概览跳转点不开"）。
    pendingReveal = {
        catId: String(currentSubId || currentCategoryId || ''),
        sIdx: si,
        vIdx: wantVariety ? vi : null,
        cIdx: (ci === null || ci === undefined) ? null : ci
    };

    // ★ 同一份信息也登记进"持续状态"，否则渲染完 pendingReveal 就被置 null，
    //   之后 buildRoute() 不知道"定位到了哪"，会把刚写好的展开段抹掉。
    //   focusOwner 由 renderSeriesList() 在渲染该分类时确定（这里还取不到正确 scope）。
    //   ★ 这两个是**列表**（可能同时展开多个系列）：概览跳转一次只定位一条，
    //     所以这里是单元素列表；写成标量会让 buildRoute 的 .length 判断失效。
    focusSeries = [si];
    focusVariety = wantVariety ? [si + '.' + vi] : [];
    focusOwner = null;
    focusScope = null;

    // 切换到目标容器并渲染
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();

    // ★ 渲染完立刻播一次"钻进详情"的过渡（见 core.js 的 triggerNavTransition）。
    //   放在这里而不是放进 renderCurrentCategory()：那个函数是**所有**进分类的路径
    //   的公共出口，包括深链接冷启动（main.js 的 applyInitialRoute）与品牌页
    //   首帧 —— 那些路径要的是"第一帧就是终态"（仓库刚修好的首帧零位移）。
    //   只有"用户在概览页点了一条"这一条路需要过渡，所以只在这里加。
    //   ★ 位置必须在 renderCurrentCategory() **之后**：动画是给刚写进去的内容播的；
    //     放在 render 之前会先播给空容器，等于没播。
    //   ★ 也不与下面 revealCopyInCategory() 的滚动打架：那条链是 setTimeout(50) 起、
    //     内部还各自 tick(80/120)，落在 0.2s 动画的中后段；而且展开/滚动只改
    //     容器的 scrollTop 与手风琴高度，动画只动 opacity/transform，互不覆盖。
    if (typeof triggerNavTransition === 'function') triggerNavTransition();

    // ★ 把"当前所在位置"同步进地址栏。
    //   navigateToCopy()（搜索结果跳转）一直有这一步，概览跳转却漏了，
    //   于是从概览点进分类后地址栏还停留在旧位置，深链接不可分享。
    //   syncRoute 内部只做 replaceState，不会新增历史记录。
    if (typeof syncRoute === 'function') syncRoute();

    // 展开并滚动到目标条目。
    // ★ 改为复用 router.js 的 revealCopyInCategory()，不再自己拼 DOM id：
    //   原实现用 `series-${si}` / `v-${si}-${vi}`（无分类作用域）配合
    //   document.getElementById，会命中隐藏容器里其它分类的同序号节点（审查报告 B7）。
    //   顺带把"只展开不折叠其它"改成"先折叠其它再展开目标"，避免深链接打开时
    //   一堆系列同时播放展开动画。
    setTimeout(() => {
        closeAllAccordions();
        revealCopyInCategory({
            sIdx: si,
            vIdx: (hasVarieties && vi !== null && vi !== undefined && vi !== 'null') ? vi : null,
            cIdx: null
        });
    }, 50);
}
