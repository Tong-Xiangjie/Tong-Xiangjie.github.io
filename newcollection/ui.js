document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.querySelector('.sidebar');
    const tabItems = document.querySelectorAll('.tab-item');
    const contentApp = document.getElementById('app');

    // 侧边栏菜单（真实数据）
    const menu = [
        { name: "纪念钞", data: window.commemorativeData },
        { name: "连体钞", data: window.uncutData },
        { name: "港币", data: window.hk_bocData },
        { name: "澳门币", data: window.macau_bocData },
        { name: "台币", data: window.taiwanData },
        { name: "票证", data: window.gkqData },
        { name: "邮票", data: null },
        { name: "外币", data: window.japanData }
    ];

    // 渲染侧边栏
    menu.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'sidebar-item';
        div.textContent = item.name;
        sidebar.appendChild(div);

        // ========== 点击直接展示数据 ==========
        div.onclick = () => {
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            div.classList.add('active');

            if (!item.data) {
                contentApp.innerHTML = '<div style="padding:20px">暂无数据</div>';
                return;
            }

            // 直接渲染内容（不依赖任何外部函数）
            renderContent(item.data);
        };
    });

    // 底部TAB
    tabItems.forEach(tab => {
        tab.onclick = () => {
            const t = tab.dataset.target;
            if (t === 'coins' || t === 'special') {
                alert('暂未开放');
            }
            if (t === 'settings') {
                toggleThemeModal();
            }
        };
    });
    document.querySelector('.tab-item[data-target="notes"]').classList.add('active');
});

// ========== 内置渲染内容（独立可用） ==========
function renderContent(data) {
    const app = document.getElementById('app');
    if (!data || !data.series) {
        app.innerHTML = '<div style="padding:20px">暂无数据</div>';
        return;
    }

    let html = `<div style="padding:10px">`;
    html += `<h2>${data.name}</h2>`;

    data.series.forEach(s => {
        html += `<div style="margin:10px 0; padding:10px; border:1px solid #ddd;">`;
        html += `<h3>${s.seriesName}</h3>`;

        if (s.copies && s.copies.length > 0) {
            s.copies.forEach(c => {
                html += `<div style="margin-top:8px;">`;
                if (c.img1) html += `<img src="${c.img1}" style="width:100px; margin-right:10px;">`;
                html += `${c.version} | ${c.condition}`;
                html += `</div>`;
            });
        } else if (s.varieties) {
            s.varieties.forEach(v => {
                html += `<div><strong>${v.varietyName}</strong></div>`;
                v.copies.forEach(c => {
                    if (c.img1) html += `<img src="${c.img1}" style="width:80px;">`;
                });
            });
        }

        html += `</div>`;
    });

    html += `</div>`;
    app.innerHTML = html;
}

// ========== 主题功能 ==========
let themeModal = null;
function toggleThemeModal() {
    if (!themeModal) {
        themeModal = document.createElement('div');
        themeModal.className = 'theme-modal';
        themeModal.innerHTML = `
            <div style="margin-bottom:8px">选择主题色</div>
            <div class="theme-colors">
                <div class="theme-color" style="background:#1677ff"></div>
                <div class="theme-color" style="background:#d92121"></div>
                <div class="theme-color" style="background:#00b42a"></div>
                <div class="theme-color" style="background:#ff7d00"></div>
                <div class="theme-color" style="background:#722ed1"></div>
            </div>
            <input type="color" id="custom-theme" style="width:100%;margin-top:10px">
        `;
        document.body.appendChild(themeModal);

        themeModal.querySelectorAll('.theme-color').forEach(el => {
            el.addEventListener('click', () => {
                setTheme(el.style.backgroundColor);
            });
        });

        document.getElementById('custom-theme').addEventListener('input', e => {
            setTheme(e.target.value);
        });
    }
    themeModal.classList.toggle('show');
}
