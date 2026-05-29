document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.querySelector('.sidebar');
    const tabItems = document.querySelectorAll('.tab-item');
    const contentApp = document.getElementById('app');

    // 真实数据 ID，和你 index.html 里引入的文件名完全对应
    const menu = [
        { name: "纪念钞", key: "commemorativeData" },
        { name: "连体钞", key: "uncutData" },
        { name: "港币", key: "hk_bocData" },
        { name: "澳门币", key: "macau_bocData" },
        { name: "台币", key: "taiwanData" },
        { name: "票证", key: "gkqData" },
        { name: "邮票", key: null },
        { name: "外币", key: "japanData" }
    ];

    // 渲染侧边栏
    menu.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'sidebar-item';
        div.textContent = item.name;
        sidebar.appendChild(div);

        div.onclick = () => {
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            div.classList.add('active');

            // 关键修复：从全局对象读取数据
            const data = window[item.key];
            if (!data || !data.series) {
                contentApp.innerHTML = '<div style="padding:20px">暂无数据</div>';
                return;
            }

            renderContent(data);
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

// 渲染函数
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

        // 处理普通版本
        if (s.copies && s.copies.length > 0) {
            s.copies.forEach(c => {
                html += `<div style="margin-top:8px; display:flex; align-items:center;">`;
                if (c.img1) html += `<img src="${c.img1}" style="width:100px; margin-right:10px; object-fit:contain;">`;
                html += `<div>${c.version || '无冠号'} | ${c.condition || '无评级'} | ${c.year || '无年份'}</div>`;
                html += `</div>`;
            });
        }
        // 处理带 varieties 的版本
        else if (s.varieties) {
            s.varieties.forEach(v => {
                html += `<div style="margin-top:8px;"><strong>${v.varietyName}</strong></div>`;
                v.copies.forEach(c => {
                    html += `<div style="display:flex; align-items:center; margin:4px 0;">`;
                    if (c.img1) html += `<img src="${c.img1}" style="width:80px; margin-right:8px; object-fit:contain;">`;
                    html += `<div>${c.version || '无冠号'} | ${c.condition || '无评级'}</div>`;
                    html += `</div>`;
                });
            });
        } else {
            html += `<div style="color:#888;">暂无藏品</div>`;
        }

        html += `</div>`;
    });

    html += `</div>`;
    app.innerHTML = html;
}

// 主题功能
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
