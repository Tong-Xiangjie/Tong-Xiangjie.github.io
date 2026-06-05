// ============================================================
// page.js — 答题卡页面壳（外框、标记、标题、信息、注意事项）
// ============================================================

import { CARD, BLOCK } from '../config.js';

/**
 * 生成四角定位块 HTML
 */
function cornerMarks() {
    return `
        <div class="corner-mark tl"></div>
        <div class="corner-mark tr"></div>
        <div class="corner-mark bl"></div>
        <div class="corner-mark br"></div>
    `;
}

/**
 * 生成顶部定位标记
 * @param {number} count - 标记数量（由页面宽度动态计算）
 */
function topMarks(count) {
    const marks = Array(count).fill('<div class="top-mark"></div>').join('');
    return `<div class="top-mark-container">${marks}</div>`;
}

/**
 * 计算顶部定位标记数量
 * (页面宽度 - 左右边距 - 左右定位块宽度) / 块间距
 */
function calcTopMarkCount() {
    const usableWidth = CARD.width - CARD.margin.left - CARD.margin.right - BLOCK.width * 2;
    return Math.floor(usableWidth / BLOCK.step);
}

/**
 * 标题区域
 */
function titleSection(title, subject) {
    return `
        <div class="title-section">
            <div class="main-title">${escapeHtml(title)}</div>
            <div class="sub-title">${escapeHtml(subject)}答题卡</div>
        </div>
    `;
}

/**
 * 考生信息区域（姓名 + 准考证号表格）
 */
function infoSection(zkLength) {
    const cells = Array(zkLength).fill(
        '<td style="width:7mm;height:8mm;border:1px solid var(--red);"></td>'
    ).join('');
    return `
        <div class="info-section">
            <div class="info-line">
                <span class="name-text">姓名：</span>
                <div class="name-line"></div>
                <span class="zk-text">准考证号</span>
                <table class="zk-table" style="border-collapse:collapse;">
                    <tr>${cells}</tr>
                </table>
            </div>
        </div>
    `;
}

/**
 * 注意事项 + 贴条形码区
 */
function noteSection() {
    return `
        <div class="note-section">
            <table class="note-table">
                <tr>
                    <td rowspan="2" class="note-left-cell">注意事项</td>
                    <td class="note-content-cell">
                        1. 答题前，考生先填写好自己的姓名、准考证号...<br>
                        2. 在草稿纸、试题卷上答题无效；<br>
                        3. 答题时，请考生注意各题号后面的答题提示；<br>
                        4. 请勿折叠答题卡，保持字体工整、笔迹清晰、卡面清洁。
                    </td>
                </tr>
                <tr>
                    <td class="note-check-cell">
                        <span class="note-check-box"></span>
                        ← 此方框为缺考考生标记，由监考员用2B铅笔填涂
                    </td>
                </tr>
            </table>
            <div class="barcode-box">
                <div class="barcode-title">贴条形码区</div>
                <div class="barcode-tip">(正面朝上，切勿贴出虚线方框)</div>
            </div>
        </div>
    `;
}

/**
 * 构建完整的页面壳
 * @param {object} opts - { isFirstPage, title, subject, zkLength }
 * @returns {string} 页面壳 HTML（不闭合</div>，后续追加内容）
 */
export function buildPageShell(opts) {
    const { isFirstPage, title, subject, zkLength } = opts;
    const topMarkCount = calcTopMarkCount();

    let html = `<div class="answer-card">`;
    html += cornerMarks();
    html += topMarks(topMarkCount);

    if (isFirstPage) {
        html += titleSection(title, subject);
        html += infoSection(zkLength);
        html += noteSection();
    }

    return html; // 调用方负责追加内容 + `</div>`
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => 
        m === '&' ? '&amp;' : (m === '<' ? '&lt;' : '&gt;'));
}
