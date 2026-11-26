// sheet-view.js —— 评级费清单的**站内小窗预览**（零依赖：不引库、不碰 CDN）
// ============================================================
// 用户要求（原话）："『下载清单』比较麻烦，每次想查看都要下载，
//   你看看能不能自己写一个小窗展示清单，下载接口写在小窗里面。"
//
// ★ 为什么自己写 zip + xlsx 解析，而不是引 SheetJS 之类：
//   站里的 vendor 规矩是"第三方库必须落地到 collection/vendor/ 且页面不许出现 CDN 链接"
//   （见 tools/tests/verify-vendor.mjs）；而这里要的只是"把一张单表读成二维数组"，
//   浏览器的 DecompressionStream('deflate-raw') 已经自带 inflate，剩下就是走一遍
//   zip 中央目录 + 读 sheet XML —— 几十行的事，比拉一个几百 KB 的库划算得多。
//   Node 侧（verify-grading-fee.mjs）早有一份同口径的零依赖解析器，两边对账方便。
//
// ★ 解析不出来也**不装死**：小窗照开，里面写明原因并给出下载链接
//   （file:// 直接打开、或浏览器没有 DecompressionStream 时会走到这条路）。
//
// ★ 客户隐私：台账数据文件里刻意剔掉了清单汇总块里的姓名/电话/微信号
//   （见 notecollection/data/grading_fee.js 顶部说明），预览也必须同口径 ——
//   含手机号、或"客户/微信/订单号"字样的单元格一律不渲染。
//
// ★ 样式自己注入（与 tooltip.js 同一做法）：功能自包含，不动 layout.css。
(function () {
    'use strict';

    var MODAL_ID = 'sheetModal';
    var STYLE_ID = 'dsh-sheet-style';

    // ---------- 样式（跟着站里的主题变量走，暗/亮都正常） ----------
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var css = [
            '.sheet-modal{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;}',
            '.sheet-modal[hidden]{display:none;}',
            // ★ 外观向站里其它小窗看齐（用户 2026-11："ui 最好与大部分小窗保持一致"）：
            //   遮罩用与 .modal-backdrop 同一种黑（同透明度）、面板用同一档圆角/描边/投影、
            //   关闭按钮照 .modal-close 的样子（右上角圆形、半透明黑底、hover 变深）。
            '.sheet-mask{position:absolute;inset:0;background:rgba(0,0,0,.85);}',
            '.sheet-panel{position:relative;z-index:1;width:min(1080px,94vw);max-height:86vh;display:flex;flex-direction:column;',
            // ★★ 不透明化（用户 2026-11："表头上面还是漏字，这部分应该不透明"）：
            //   主题里的 --bg-light / --bg 在"玻璃"风格下是半透明的，sticky 表头下滚过的行会透上来。
            //   做法：先用一个**不透明底色**兜底，再把主题色当叠层铺上去 —— 观感仍是主题色，
            //   但底下不透。面板与表头用同一套叠层，两者颜色才不会出现色带。
            'background-color:#0f0f12;background-image:linear-gradient(var(--bg-light,#1a1a1e),var(--bg-light,#1a1a1e));',
            'color:var(--text,#f4f4f7);border:1px solid var(--border,rgba(255,255,255,.14));',
            'border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.5);overflow:hidden;}',
            '.sheet-head{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.14));flex-wrap:wrap;}',
            '.sheet-titles{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}',
            '.sheet-title{font-size:15px;font-weight:700;letter-spacing:.02em;}',
            '.sheet-sub{font-size:12px;color:var(--text-secondary,#9aa0a6);}',
            // ★「下载清单」不要下划线（用户 2026-11）。
            '.sheet-dl{flex:0 0 auto;font-size:13px;padding:5px 10px;border-radius:6px;text-decoration:none;',
            'border:1px solid var(--border,rgba(255,255,255,.18));color:var(--text,#f4f4f7);background:rgba(255,255,255,.04);}',
            '.sheet-dl:hover{background:rgba(255,255,255,.12);}',
            // ★ 关闭按钮**留在文档流里**（flex 项），不再绝对定位 —— 绝对定位时它会压住右上角的
            //   「下载清单」（用户 2026-11 报的重叠）。外观仍照 .modal-close：右上角圆形、半透明黑底。
            '.sheet-close{flex:0 0 auto;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1;',
            'border:0;background:rgba(0,0,0,.55);color:#fff;}',
            '.sheet-close:hover{background:rgba(0,0,0,.8);}',
            '.sheet-body{flex:1 1 auto;min-height:60px;overflow:auto;padding:10px 14px 8px;}',
            '.sheet-msg{padding:18px 4px;font-size:13px;color:var(--text-secondary,#9aa0a6);line-height:1.7;text-align:center;}',
            // ★ 表头（列名行）：与窗口抬头拉开距离（.sheet-body 的上内边距）、
            //   **上下都有框线**、背景用面板同色（不是更深的 var(--bg)，否则会出现一条色带）。
            //   ★ 另外把 border-collapse 从 collapse 改成 separate：collapse 下 sticky 单元格的边框
            //   会与滚动内容打架，行文字会"漏"到表头上方（用户 2026-11 报的现象）。
            '.sheet-table{border-collapse:separate;border-spacing:0;font-size:12.5px;width:100%;}',
            '.sheet-table th,.sheet-table td{border:1px solid var(--border,rgba(255,255,255,.14));padding:4px 7px;vertical-align:middle;text-align:center;}',
            '.sheet-table thead th{position:sticky;top:0;z-index:2;font-weight:600;text-align:center;',
            // ★ 与面板同一套"不透明底 + 主题色叠层"：这样表头既不透明，颜色又与面板一致（无色带）。
            'background-color:#0f0f12;background-image:linear-gradient(var(--bg-light,#1a1a1e),var(--bg-light,#1a1a1e));',
            'border-top:1px solid var(--border,rgba(255,255,255,.28));border-bottom:1px solid var(--border,rgba(255,255,255,.28));}',
            '.sheet-table tr.sheet-total td{font-weight:700;}',
            // ★ 已售出/退回的行：灰化 + 删除线（不新开"已售出"列）
            '.sheet-table tr.sheet-sold td{color:var(--text-secondary,#9aa0a6);text-decoration:line-through;opacity:.75;}',
            // ★ 汇总说明（合计已在表里，这里只剩不带表格的文字行）
            '.sheet-sum{margin:10px 0 4px;padding-top:8px;border-top:1px dashed var(--border,rgba(255,255,255,.18));}',
            '.sheet-sum-title{text-align:center;font-size:12.5px;color:var(--text-secondary,#9aa0a6);margin:8px 0 2px;}',
            '.sheet-sum-line{text-align:center;font-size:12.5px;margin:2px 0;}',
            '.sheet-foot{padding:9px 14px;border-top:1px solid var(--border,rgba(255,255,255,.14));font-size:12px;color:var(--text-secondary,#9aa0a6);text-align:center;}',
            // ★ 时间轴上那个入口按钮（special.js 里渲染的「查看清单」）。
            //   它占的是原来「下载清单」链接的位置，所以字号/对齐必须跟原来一样是**普通字号 12px**：
            //   <button> 默认会拿到 13.33px 和一套系统外观，不在这里校正就会出现"那几个字偏大"。
            //   放在这里而不是 layout.css，是因为它属于本模块的入口样式（谁开小窗谁负责它的长相）。
            '.timeline-fee-view{font:inherit;font-size:12px;line-height:1.4;padding:0;margin:0;background:none;border:0;',
            'color:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}',
            '.timeline-fee-view:hover{opacity:.85;}',
            '@media (max-width:560px){.sheet-panel{width:96vw;max-height:88vh;}.sheet-title{font-size:14px;}}',
            // ★ 出现 / 消失动画（用户 2026-11 要求）：与站里其它弹窗一个调子 —— 遮罩淡入淡出、
            //   面板轻微上浮缩放。关窗时先加 .sheet-hide 播完再 hidden（见 close()）。
            //   尊重 prefers-reduced-motion：用户在系统里关了动效就一点都不动。
            '@keyframes sheetIn{from{opacity:0}to{opacity:1}}',
            '@keyframes sheetOut{from{opacity:1}to{opacity:0}}',
            '@keyframes sheetPanelIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
            '@keyframes sheetPanelOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px) scale(.99)}}',
            '.sheet-modal{animation:sheetIn .22s var(--ease-out,ease-out);}',
            '.sheet-panel{animation:sheetPanelIn .22s var(--ease-out,ease-out);}',
            '.sheet-modal.sheet-hide{animation:sheetOut .18s var(--ease-in,ease-in) forwards;}',
            '.sheet-modal.sheet-hide .sheet-panel{animation:sheetPanelOut .18s var(--ease-in,ease-in) forwards;}',
            '@media (prefers-reduced-motion: reduce){.sheet-modal,.sheet-modal .sheet-panel{animation:none !important;}}'
        ].join('');
        var s = document.createElement('style');
        s.id = STYLE_ID; s.textContent = css;
        document.head.appendChild(s);
    }

    // ---------- zip：走中央目录，只取我们要的两三个成员 ----------
    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
    function zipTable(buf) {
        var eocd = -1;
        for (var i = buf.length - 22; i >= 0; i--) { if (u32(buf, i) === 0x06054b50) { eocd = i; break; } }
        if (eocd < 0) throw new Error('不是有效的 zip/xlsx（找不到中央目录）');
        var n = u16(buf, eocd + 10), pos = u32(buf, eocd + 16), map = {};
        for (var k = 0; k < n; k++) {
            var method = u16(buf, pos + 10), csize = u32(buf, pos + 20);
            var nameLen = u16(buf, pos + 28), extraLen = u16(buf, pos + 30), cmtLen = u16(buf, pos + 32);
            var local = u32(buf, pos + 42);
            var name = new TextDecoder('utf-8').decode(buf.subarray(pos + 46, pos + 46 + nameLen));
            map[name] = { method: method, csize: csize, local: local };
            pos += 46 + nameLen + extraLen + cmtLen;
        }
        return map;
    }
    async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器不支持 DecompressionStream，无法在站内解压 xlsx');
        var ds = new DecompressionStream('deflate-raw');
        var w = ds.writable.getWriter();
        w.write(bytes); w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    async function member(buf, table, name) {
        var e = table[name];
        if (!e) throw new Error('xlsx 里没有 ' + name);
        var start = e.local + 30 + u16(buf, e.local + 26) + u16(buf, e.local + 28);
        var raw = buf.subarray(start, start + e.csize);
        return e.method === 8 ? inflateRaw(raw) : raw;
    }

    // ---------- xlsx → 二维数组（只支持"一张表 + 共享字符串"这种常规单表清单） ----------
    async function sheetGrid(url) {
        var res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('取清单失败：HTTP ' + res.status);
        var buf = new Uint8Array(await res.arrayBuffer());
        var table = zipTable(buf);
        var dec = new TextDecoder('utf-8');
        var shared = [];
        if (table['xl/sharedStrings.xml']) {
            var ssDoc = new DOMParser().parseFromString(dec.decode(await member(buf, table, 'xl/sharedStrings.xml')), 'application/xml');
            var sis = ssDoc.getElementsByTagNameNS('*', 'si');
            for (var i = 0; i < sis.length; i++) {
                var ts = sis[i].getElementsByTagNameNS('*', 't'), s = '';
                for (var j = 0; j < ts.length; j++) s += ts[j].textContent;
                shared.push(s);
            }
        }
        var sheetName = null;
        for (var k = 1; k <= 8 && !sheetName; k++) if (table['xl/worksheets/sheet' + k + '.xml']) sheetName = 'xl/worksheets/sheet' + k + '.xml';
        if (!sheetName) throw new Error('xlsx 里没有工作表');
        var doc = new DOMParser().parseFromString(dec.decode(await member(buf, table, sheetName)), 'application/xml');
        var colOf = function (ref) { var n = 0, s = String(ref).replace(/[0-9]/g, ''); for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
        var rows = doc.getElementsByTagNameNS('*', 'row'), out = [];
        for (var r = 0; r < rows.length; r++) {
            var row = [], cells = rows[r].getElementsByTagNameNS('*', 'c');
            for (var c = 0; c < cells.length; c++) {
                var cell = cells[c], t = cell.getAttribute('t') || 'n', val = '';
                if (t === 'inlineStr') {
                    var iss = cell.getElementsByTagNameNS('*', 't');
                    for (var m = 0; m < iss.length; m++) val += iss[m].textContent;
                } else {
                    var v = cell.getElementsByTagNameNS('*', 'v')[0];
                    if (v) val = (t === 's') ? (shared[+v.textContent] || '') : v.textContent;
                }
                val = String(val).replace(/\s+$/, '');
                if (val.trim() !== '') row[colOf(cell.getAttribute('r') || 'A1')] = val.trim();
            }
            out.push(row);
        }
        return out;
    }

    // ---------- 小窗 ----------
    function isPrivate(text) {
        // 与台账数据文件同一口径：不显示清单里的客户信息
        return /客户\s*[：:]|微信|订单号|电话|1\d{10}/.test(text || '');
    }
    // 藏品里真实存在的证书号集合（用于把"已售出/退回"的行灰化 + 删除线，判据与台账同源）
    // ★ 用 special.js 的 gradingCopyIndex()（cert → 藏品），而不是自己去翻 collectAllCopies()：
    //   后者返回的副本上没有 copyId 字段，第一版据此判断 ⇒ **15 行全被标成已售出**（实测踩到）。
    // ★ 拿不到索引时**什么都不标**（宁可不灰，也不能把在手的藏品误标成已售出）。
    function liveCertSet() {
        try {
            if (typeof window.gradingCopyIndex !== 'function') return null;
            var idx = window.gradingCopyIndex() || {};
            var set = {};
            for (var k in idx) if (Object.prototype.hasOwnProperty.call(idx, k)) set[String(k)] = 1;
            return set;
        } catch (e) { return null; }
    }

    function render(grid) {
        // ★ 抄录是**逐格照抄**（数据侧保持忠实），显示时再去掉清单顶部那行大标题
        //   （"爱藏评级费用清单" —— 用户 2026-11："这个表头可以不要"）。
        //   判据：首行只有 1 个非空单元格、且下一行明显是列名（非空单元格更多）⇒ 判为标题行。
        var g = grid;
        if (g.length > 1) {
            var c0 = g[0].filter(Boolean).length, c1 = g[1].filter(Boolean).length;
            if (c0 <= 1 && c1 > c0) g = g.slice(1);
        }
        var maxCol = 0, keep = [];
        for (var i = 0; i < g.length; i++) {
            var row = g[i].filter(function (v) { return !isPrivate(v); });
            var has = false;
            for (var j = 0; j < row.length; j++) if (row[j]) has = true;
            if (!has) { keep.push(null); continue; }
            maxCol = Math.max(maxCol, row.length);
            keep.push(row);
        }
        // ★ 合计行**回到明细表最后一行**（用户 2026-11 改回来："这个还是写在上面表格的最下面一行吧"）；
        //   合计**之后**的行（"爱藏评级费用明细 / 评级费原价 / 代理折扣9折 / 实收合计"）仍是不带表格的文字行。
        var sumAt = -1;
        for (var s = 1; s < keep.length; s++) {
            if (keep[s] && String(keep[s][0] || '').trim() === '合计') { sumAt = s; break; }
        }
        var tail = sumAt > 0 ? keep.slice(sumAt + 1) : [];

        // ★ 已售出/退回的行：不新开一列，直接**灰化 + 删除线**（用户 2026-11）。
        //   判据与台账口径同源：这一行的编码（证书号）在藏品里找不到 ⇒ 已售出/退回。
        var live = liveCertSet();

        var html = '<table class="sheet-table"><thead><tr>';
        var head = keep[0] || [];
        for (var c = 0; c < maxCol; c++) html += '<th>' + esc(head[c] || '') + '</th>';
        html += '</tr></thead><tbody>';
        // ★ 表里只画到「合计」那一行为止（含）；合计之后的行走下面的文字块 ——
        //   否则它们会被画两遍（表里一遍、文字里一遍）。
        var rowEnd = sumAt > 0 ? sumAt + 1 : keep.length;
        for (var r = 1; r < rowEnd; r++) {
            var rr = keep[r];
            if (!rr) continue;
            var isTotal = String(rr[0] || '').trim() === '合计';
            var cert = '';
            for (var q = 0; q < rr.length; q++) { if (/^\d{6,}$/.test(String(rr[q] || '').trim())) { cert = String(rr[q]).trim(); break; } }
            var sold = !isTotal && !!cert && !!live && !live[cert];
            html += '<tr' + (isTotal ? ' class="sheet-total"' : (sold ? ' class="sheet-sold" title="已售出 / 退回（不在藏品数据里）"' : '')) + '>';
            for (var c2 = 0; c2 < maxCol; c2++) {
                html += '<td>' + esc(rr[c2] || '') + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        // 汇总说明：合计已在表里，这里只剩不带表格的文字行。
        if (tail.length) {
            html += '<div class="sheet-sum">';
            for (var k = 0; k < tail.length; k++) {
                var cells = (tail[k] || []).filter(Boolean);
                if (!cells.length) continue;
                if (cells.length === 1) html += '<div class="sheet-sum-title">' + esc(cells[0]) + '</div>';
                else html += '<div class="sheet-sum-line">' + cells.map(esc).join('　') + '</div>';
            }
            html += '</div>';
        }
        return { html: html, rowCount: keep.filter(Boolean).length };
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var modal = null, lastFocus = null;
    function ensureModal() {
        if (modal && document.body.contains(modal)) return modal;
        ensureStyle();
        modal = document.createElement('div');
        modal.className = 'sheet-modal';
        modal.id = MODAL_ID;
        modal.hidden = true;
        modal.innerHTML =
            '<div class="sheet-mask"></div>' +
            '<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="评级费清单">' +
            '<div class="sheet-head">' +
            '<div class="sheet-titles"><span class="sheet-title"></span><span class="sheet-sub"></span></div>' +
            '<a class="sheet-dl" href="#" target="_blank" rel="noopener">下载清单</a>' +
            '<button class="sheet-close" type="button" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="sheet-body cscroll-host"><div class="sheet-msg">正在读取清单…</div><div class="sheet-scroll" hidden></div></div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.querySelector('.sheet-mask').addEventListener('click', close);
        modal.querySelector('.sheet-close').addEventListener('click', close);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal && !modal.hidden) close();
        });
        return modal;
    }
    function close() {
        if (!modal || modal.hidden || modal.classList.contains('sheet-hide')) return;
        // ★ 先播消失动画再加 hidden（用户 2026-11 要求出现/消失都有动画）；
        //   只用一次计时器收口，动画时长与 CSS 里 .sheet-hide 的 .18s 对齐。
        modal.classList.add('sheet-hide');
        var done = false;
        var finish = function () {
            if (done) return;
            done = true;
            modal.classList.remove('sheet-hide');
            modal.hidden = true;
            try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) { }
        };
        setTimeout(finish, 200);
    }
    function open(opts) {
        opts = opts || {};
        var m = ensureModal();
        lastFocus = document.activeElement;
        m.querySelector('.sheet-title').textContent = opts.title || '评级费清单';
        m.querySelector('.sheet-sub').textContent = opts.subtitle || '';
        var dl = m.querySelector('.sheet-dl');
        dl.setAttribute('href', opts.url || '#');
        var msg = m.querySelector('.sheet-msg'), scroll = m.querySelector('.sheet-scroll');
        msg.hidden = false;
        msg.textContent = '正在读取清单…';
        scroll.hidden = true;
        scroll.innerHTML = '';
        m.classList.remove('sheet-hide');   // 上一次关闭可能刚播完动画，去掉这个类再打开
        m.hidden = false;
        // ★ 首选路径（用户 2026-11 口径）：内容已经**抄进台账数据**（grading_fee.js 的 sheets），
        //   这里只管画表 —— 不联网、不解压、没有失败面。
        //   下面那条 fetch+解压 只作为兜底：万一将来加了新批次还没抄录，小窗也不至于空着。
        var known = Array.isArray(opts.rows) && opts.rows.length ? opts.rows : null;
        var draw = function (grid) {
            var r = render(grid);
            scroll.innerHTML = r.html;
            scroll.hidden = false;
            msg.hidden = true;
            // ★ 滚动条用站里**自绘**的那套（scrollbar.js）：挂上 cscroll-host 后让它重新扫一遍，
            //   横向溢出也走同一个滑块 —— 原生条又粗又不跟主题（用户 2026-11 要求移植）。
            try { if (typeof window.refreshCustomScrollbars === 'function') window.refreshCustomScrollbars(); } catch (e) { }
        };
        if (known) { draw(known); return; }
        sheetGrid(opts.url).then(draw).catch(function (err) {
            msg.textContent = '这一批还没有抄录清单内容，且这个环境下也无法在站内解压 xlsx（' + (err && err.message ? err.message : err) + '）。请点右上角「下载清单」查看原件。';
        });
    }

    window.dshSheetView = { open: open, close: close };
    // ★ 脚本一加载就把样式注入（不等第一次点开）：时间轴上那个入口按钮的长相靠它，
    //   否则在小窗被打开之前，按钮会短暂地是浏览器默认外观（字号也偏大）。
    ensureStyle();
})();
