// ============================================================
// validators.js — 所有输入校验集中于此
// ============================================================

import { CONSTRAINTS } from '../config.js';

export class ValidationError extends Error {
    constructor(field, message) {
        super(message);
        this.field = field;
    }
}

export function validate(values) {
    const errors = [];

    // 准考证号位数
    if (values.zkLength < CONSTRAINTS.zkLength.min || 
        values.zkLength > CONSTRAINTS.zkLength.max) {
        errors.push(new ValidationError('zkLength', 
            `准考证号位数需在 ${CONSTRAINTS.zkLength.min}-${CONSTRAINTS.zkLength.max} 之间`));
    }

    // 选择题数量
    if (values.choiceTotal < CONSTRAINTS.choiceTotal.min || 
        values.choiceTotal > CONSTRAINTS.choiceTotal.max) {
        errors.push(new ValidationError('choiceTotal',
            `选择题数量应在 ${CONSTRAINTS.choiceTotal.min}-${CONSTRAINTS.choiceTotal.max} 之间`));
    }

    // 填空题规则格式校验
    if (values.fillRule) {
        const items = values.fillRule.split(',').filter(x => x.trim());
        for (const item of items) {
            if (!/^\d+-\d+$/.test(item.trim())) {
                errors.push(new ValidationError('fillRule',
                    `填空题规则 "${item}" 格式错误，正确示例: "1-2,2-1"`));
            }
        }
    }

    // 解答题分值校验
    if (values.ansCount > 0 && values.ansScores) {
        const scores = values.ansScores.split(/\s+/).map(Number);
        if (scores.some(isNaN) || scores.length !== values.ansCount) {
            errors.push(new ValidationError('ansScores',
                `解答题分值的数量 (${scores.filter(s => !isNaN(s)).length}) 与题目数量 (${values.ansCount}) 不匹配`));
        }
        if (scores.some(s => s <= 0)) {
            errors.push(new ValidationError('ansScores', '分值必须为正数'));
        }
    }

    return errors;
}

export function showErrors(errors) {
    // 清除旧错误
    document.querySelectorAll('.input-error').forEach(el => el.remove());
    
    if (errors.length === 0) return;

    // 在每个错误字段下方显示红色提示
    for (const err of errors) {
        const el = document.getElementById(err.field);
        if (el) {
            const msg = document.createElement('p');
            msg.className = 'input-error text-red-600 text-xs mt-1';
            msg.textContent = err.message;
            el.parentNode.appendChild(msg);
            el.classList.add('border-red-500');
        }
    }
    throw new ValidationError('VALIDATION_FAILED', '输入校验未通过');
}
