// ============================================================
// paginator.js — 智能分页引擎
// 策略：先计算各内容块高度，再用贪心算法分配到页面
// ============================================================

import { CARD, PAGE_EXTRA, CHOICE } from './config.js';
import { buildChoiceGrid, generateLeftMarks, generateRightExample } from './builders/choice.js';
import { parseFillRule, buildFillHtml, buildAnswerQuestion, buildSubjectWrapper } from './builders/subject.js';
import { buildPageShell } from './builders/page.js';

export function paginate(config) {
    const { title, subject, zkLength, choiceTotal, fillRule, ansCount, ansScores } = config;

    const pages = [];
    let remainingQuestions = choiceTotal;
    let nextNo = 1;               // 题号计数器
    let pageIndex = 1;

    // ========== 阶段一：选择题分页 ==========
    if (choiceTotal > 0) {
        let placed = 0;
        while (placed < choiceTotal) {
            const isFirst = pageIndex === 1;
            const availHeight = getAvailableHeight(isFirst);
            const maxRows = calcMaxRows(availHeight);
            const maxPerPage = maxRows * CHOICE.groupsPerRow * CHOICE.groupSize;

            const start = placed + 1;
            const end = Math.min(choiceTotal, start + maxPerPage - 1);
            const grid = buildChoiceGrid(start, end, maxRows);

            const headerHtml = isFirst
                ? `<div class="choice-header">...</div>`        // 简化，实际用模板
                : `<div class="choice-header-no-example">...</div>`;

            const shell = buildPageShell({ isFirstPage: isFirst, title, subject, zkLength });
            const body = `
                <div class="choice-section">
                    ${generateLeftMarks(grid.rows)}
                    <div class="choice-outer">
                        ${headerHtml}
                        <div class="choice-inner">
                            <div class="choice-content-wrap">
                                ${grid.html}
                                ${generateRightExample()}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            pages.push({
                html: shell + body + '</div>',
                remainingHeight: isFirst ? (availHeight - grid.rows * CHOICE.rowHeight - 30) : 0,
                isFirstPage: isFirst,
            });

            placed += grid.totalQuestions;
            pageIndex++;
        }
    } else {
        // 无选择题：生成空白首页壳
        const shell = buildPageShell({ isFirstPage: true, title, subject, zkLength });
        pages.push({
            html: shell,
            remainingHeight: getAvailableHeight(true),
            isFirstPage: true,
        });
    }

    // ========== 阶段二：非选择题 ==========
    // 收集所有主观题内容块（填空题 + 解答题），每个块有 { html, height }
    const fillItems = parseFillRule(fillRule, choiceTotal + 1);
    const answerItems = ansScores.map((score, i) => ({
        no: fillItems.length + choiceTotal + 1 + i,
        score,
    }));

    const blocks = [];

    // 填空题作为一个块
    if (fillItems.length > 0) {
        blocks.push({
            type: 'fill',
            html: buildFillHtml(fillItems),
            height: 12,       // 固定高度
        });
    }

    // 每个解答题作为一个块
    for (const q of answerItems) {
        blocks.push({
            type: 'answer',
            html: buildAnswerQuestion(q),
            height: QUESTION.baseHeight + q.score * QUESTION.perScoreHeight,
        });
    }

    // 贪心分配块到页面
    for (const block of blocks) {
        // 找到能容纳此块的最后一页；如果都不行，新建一页
        let targetPage = pages.findLast(p => p.remainingHeight >= block.height);

        if (!targetPage) {
            // 新建页面
            const shell = buildPageShell({ isFirstPage: false, title, subject, zkLength });
            targetPage = {
                html: shell,
                remainingHeight: getAvailableHeight(false),
                isFirstPage: false,
            };
            pages.push(targetPage);
        }

        // 如果目标页还没有非选择题容器，添加容器开始标签
        if (!targetPage.hasSubjectWrapper) {
            const wrapper = buildSubjectWrapper();
            targetPage.html += wrapper.openTag;
            targetPage.hasSubjectWrapper = true;
        }

        targetPage.html += `<tr><td>${block.html}</td></tr>`;
        targetPage.remainingHeight -= block.height;
    }

    // ========== 阶段三：收尾 ==========
    for (const page of pages) {
        if (page.hasSubjectWrapper) {
            page.html += buildSubjectWrapper().closeTag;
        }
        // 添加页面提示语
        page.html += `
            <div class="subject-page-tip">
                请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效！
            </div>
        `;
        page.html += '</div>'; // 闭合 .answer-card
    }

    return pages;
}

// ========== 高度计算辅助函数 ==========

function getAvailableHeight(isFirstPage) {
    const fixed = CARD.margin.top + CARD.margin.bottom;
    const extra = isFirstPage ? PAGE_EXTRA.first : PAGE_EXTRA.other;
    return CARD.height - fixed - extra;
}

function calcMaxRows(availableHeightMM) {
    const rows = Math.floor((availableHeightMM + 0.5) / CHOICE.rowHeight);
    return Math.max(1, Math.min(rows, 20));
}
