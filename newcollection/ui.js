document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.querySelector('.sidebar');
    const bottomTab = document.querySelector('.bottom-tabbar');

    const categories = [
        { name: '纪念钞', id: 'commemorative' },
        { name: '连体钞', id: 'uncut' },
        { name: '港币', id: 'hk' },
        { name: '澳门币', id: 'macau' },
        { name: '台币', id: 'taiwan' },
        { name: '票证', id: 'gkq' },
        { name: '邮票', id: 'stamp' },
        { name: '外币', id: 'foreign' }
    ];

    categories.forEach(item => {
        const el = document.createElement('div');
        el.className = 'sidebar-item';
        el.textContent = item.name;
        el.dataset.id = item.id;
        sidebar.appendChild(el);
    });

    // 委托事件：解决函数未加载完成无法调用问题
    sidebar.addEventListener('click', function (e) {
        const item = e.target.closest('.sidebar-item');
        if (!item) return;

        const id = item.dataset.id;
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // 安全调用：确保函数存在再执行
        if (window.selectCategory) {
            window.selectCategory(id);
        } else {
            console.log('功能加载中，请稍候重试');
        }
    });

    // 底部TAB
    const tabItems = document.querySelectorAll('.tab-item');
    tabItems.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;

            if (target === 'coins' || target === 'special') {
                alert('暂未开放');
                return;
            }

            if (target === 'settings') {
                toggleThemeModal();
                return;
            }

            tabItems.forEach(i => i.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    document.querySelector('.tab-item[data-target="notes"]').classList.add('active');
});

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
