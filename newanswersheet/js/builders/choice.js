// ============================================================
// choice.js — 选择题网格构建器（纯函数，无副作用）
// ============================================================

import { CHOICE, BLOCK } from '../config.js';

/**
 * 生成一列（一道题 + 4个选项）
 */
function questionColumn(q, options) {
    const optRows = options.map(opt => 
        `<div class="opt-row"><div class="opt-box">${opt}</div></div>`
    ).join('');
    return `
        <div class="choice-col" style="width: ${BLOCK.step}mm;">
            <div class="num-row"><div class="num-item">${q}</div></div>
            ${optRows}
        </div>
    `;
}

/**
 * 生成不可见占位列（用于组间分隔）
 */
function invisibleColumn(options) {
    const optRows = options.map(() => 
        `<div class="opt-row"><div class="opt-box-invisible"></div></div>`
    ).join('');
    return `
        <div class="choice-col" style="width: ${BLOCK.step}mm;">
            <div class="num-row"><div class="num-item invisible-num-cell"></div></div>
            ${optRows}
        </div>
    `;
}

/**
 * 将题号列表按组分段
 */
function groupQuestions(start, end) {
    const groups = [];
    for (let s = start; s <= end; s += CHOICE.groupSize) {
        const e = Math.min(s + CHOICE.groupSize - 1, end);
        const questions = [];
        for (let q = s; q <= e; q++) questions.push(q);
        groups.push(questions);
    }
    return groups;
}

/**
 * 将组列表按行分段
 */
function arrangeIntoLines(groups) {
    const lines = [];
    let current = [];
    for (const g of groups) {
        if (current.length >= CHOICE.groupsPerRow) {
            lines.push(current);
            current = [g];
        } else {
            current.push(g);
        }
    }
    if (current.length) lines.push(current);
    return lines;
}

/**
 * 构建选择题网格
 * @param {number} start   - 起始题号
 * @param {number} end     - 结束题号
 * @param {number} maxRows - 最大行数限制
 * @param {string[]} options - 选项标签数组，默认 ['A','B','C','D']
 * @returns {{ html: string, rows: number, totalQuestions: number }}
 */
export function buildChoiceGrid(start, end, maxRows, options = CHOICE.options) {
    const groups = groupQuestions(start, end);
    const lines = arrangeIntoLines(groups);
    const limited = lines.slice(0, maxRows);

    let html = '';
    let totalQuestions = 0;

    for (let i = 0; i < limited.length; i++) {
        const line = limited[i];
        let rowHtml = '';

        for (let j = 0; j < line.length; j++) {
            const questions = line[j];
            for (const q of questions) {
                rowHtml += questionColumn(q, options);
                totalQuestions++;
            }
            // 组间插入占位列
            if (j < line.length - 1) {
                rowHtml += invisibleColumn(options);
            }
        }

        const marginBottom = i === limited.length - 1 ? '0' : `${CHOICE.lineGap}mm`;
        rowHtml = `<div style="display: flex; gap: 0; margin-bottom: ${marginBottom};">${rowHtml}</div>`;
        html += rowHtml;

        if (i < limited.length - 1) {
            html += `<div class="choice-group-spacer"></div>`;
        }
    }

    return { html, rows: limited.length, totalQuestions };
}

/**
 * 生成左侧定位标记
 * @param {number} rows - 网格行数
 * @returns {string}
 */
export function generateLeftMarks(rows) {
    const totalMarks = rows * 5 + (rows - 1);
    const marks = Array(Math.max(0, totalMarks))
        .fill('<div class="left-mark"></div>').join('');
    return `<div class="left-marks-container">${marks}</div>`;
}

/**
 * 生成右侧填涂示例
 */
export function generateRightExample() {
    return `
        <div class="right-example-group">
            <div class="example-item ex-correct"></div>
            <div class="example-item ex-empty"></div>
            <div class="example-item ex-half"></div>
            <div class="example-item ex-wrong"></div>
        </div>
    `;
}
