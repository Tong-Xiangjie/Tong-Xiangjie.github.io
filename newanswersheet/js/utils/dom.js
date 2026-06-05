// ============================================================
// dom.js — DOM 操作层，隔离所有 document.getElementById
// ============================================================

import { DEFAULTS } from '../config.js';

// ---------- 表单控件引用 ----------
export function getFormElements() {
    return {
        title: document.getElementById('cardTitle'),
        subject: document.getElementById('cardSubject'),
        zkLength: document.getElementById('zkLength'),
        choiceTotal: document.getElementById('choiceTotal'),
        fillRule: document.getElementById('fillRule'),
        ansCount: document.getElementById('ansCount'),
        ansScores: document.getElementById('ansScores'),
    };
}

// ---------- 读取表单值（返回纯净对象）----------
export function readFormValues() {
    const el = getFormElements();
    return {
        title: el.title.value.trim() || DEFAULTS.title,
        subject: el.subject.value.trim() || DEFAULTS.subject,
        zkLength: parseInt(el.zkLength.value, 10) || DEFAULTS.zkLength,
        choiceTotal: parseInt(el.choiceTotal.value, 10) || 0,
        fillRule: el.fillRule.value.trim(),
        ansCount: parseInt(el.ansCount.value, 10) || 0,
        ansScores: el.ansScores.value.trim(),
    };
}

// ---------- 渲染 HTML 到容器 ----------
let cardContainer = null;

export function getCardContainer() {
    if (!cardContainer) {
        cardContainer = document.getElementById('cardContainer');
    }
    return cardContainer;
}

export function renderCards(html) {
    const container = getCardContainer();
    container.innerHTML = html;
    document.getElementById('pdfBtn').style.display = 'block';
}
