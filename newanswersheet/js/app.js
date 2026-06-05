// ============================================================
// app.js — 程序入口，负责：
//   1. 渲染控制面板
//   2. 绑定事件
//   3. 编排生成流程
// ============================================================

import { DEFAULTS } from './config.js';
import { readFormValues } from './utils/dom.js';
import { validate, showErrors, ValidationError } from './utils/validators.js';
import { paginate } from './paginator.js';
import { renderCards } from './utils/dom.js';
import { exportPDF } from './utils/pdf.js';

// ---------- 生成控制面板 HTML ----------
function renderPanel() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="input-panel">
            <h2 class="text-xl font-bold mb-4 text-center">答题卡生成器</h2>
            <div class="input-item">
                <label for="cardTitle">试卷标题</label>
                <input type="text" id="cardTitle" value="${DEFAULTS.title}">
            </div>
            <div class="input-item">
                <label for="cardSubject">考试学科</label>
                <input type="text" id="cardSubject" value="${DEFAULTS.subject}">
            </div>
            <div class="input-item">
                <label for="zkLength">准考证号位数</label>
                <input type="number" id="zkLength" value="${DEFAULTS.zkLength}" 
                       min="${CONSTRAINTS.zkLength.min}" max="${CONSTRAINTS.zkLength.max}">
            </div>
            <div class="input-item">
                <label for="choiceTotal">选择题数量</label>
                <input type="number" id="choiceTotal" value="${DEFAULTS.choiceTotal}" min="0">
            </div>
            <div class="input-item">
                <label for="fillRule">填空题 <span class="text-gray-400 text-xs">(格式: 题号-空格数, 如 1-2,2-2)</span></label>
                <input type="text" id="fillRule" value="${DEFAULTS.fillRule}">
            </div>
            <div class="input-item">
                <label for="ansCount">解答题数量</label>
                <input type="number" id="ansCount" value="${DEFAULTS.ansCount}" min="0">
            </div>
            <div class="input-item">
                <label for="ansScores">解答题分值 <span class="text-gray-400 text-xs">(空格分隔)</span></label>
                <input type="text" id="ansScores" value="${DEFAULTS.ansScores}">
            </div>
            <button class="btn-generate" id="genBtn">生成答题卡</button>
            <button class="btn-pdf" id="pdfBtn" style="display:none;">导出 PDF</button>
        </div>
        <div id="cardContainer"></div>
    `;
}

// ---------- 生成流程 ----------
function handleGenerate() {
    // 1. 清除旧错误
    document.querySelectorAll('.input-error').forEach(el => el.remove());

    // 2. 读取表单
    const values = readFormValues();

    // 3. 校验
    const errors = validate(values);
    if (errors.length > 0) {
        showErrors(errors);
        return;
    }

    // 4. 解析分值
    const scores = values.ansScores
        ? values.ansScores.split(/\s+/).map(Number).filter(x => !isNaN(x))
        : [];

    // 5. 分页引擎
    const pages = paginate({
        title: values.title,
        subject: values.subject,
        zkLength: values.zkLength,
        choiceTotal: values.choiceTotal,
        fillRule: values.fillRule,
        ansCount: values.ansCount,
        ansScores: scores,
    });

    // 6. 渲染
    const allHtml = pages.map(p => p.html).join('');
    renderCards(allHtml);
}

// ---------- 初始化 ----------
renderPanel();

document.getElementById('genBtn').addEventListener('click', handleGenerate);
document.getElementById('pdfBtn').addEventListener('click', () => {
    const title = document.getElementById('cardTitle').value;
    const subject = document.getElementById('cardSubject').value;
    exportPDF(title, subject);
});

// 页面加载后自动生成
handleGenerate();
