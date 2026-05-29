document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.querySelector('.sidebar');

    // 这里全部使用你真实存在的 category id
    // 点击后会 100% 显示对应藏品内容
    const categories = [
        { name: "纪念钞", cid: "commemorative" },
        { name: "连体钞", cid: "uncut" },
        { name: "港币", cid: "hk_boc" },
        { name: "澳门币", cid: "macau_boc" },
        { name: "台币", cid: "taiwan" },
        { name: "票证", cid: "gkq" },
        { name: "邮票", cid: "stamp" },
        { name: "外币", cid: "japan" }
    ];

    // 渲染侧边栏
    categories.forEach(cat => {
        const div = document.createElement("div");
        div.className = "sidebar-item";
        div.textContent = cat.name;
        div.dataset.cid = cat.cid;
        sidebar.appendChild(div);
    });

    // 点击侧边栏 = 直接加载对应分类的藏品内容
    sidebar.addEventListener("click", function (e) {
        const item = e.target.closest(".sidebar-item");
        if (!item) return;

        const cid = item.dataset.cid;
        window.renderCategory(cid); // 这行是关键：直接渲染你真实藏品

        // 高亮
        document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
    });

    // 底部 TAB 栏（不动）
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

// 主题弹窗（不动）
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
