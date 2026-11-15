/* ======================= 词表：字符级 + 字频过滤 =======================
 * 与 v2 演示页共用同一份实现（Node 试验脚本也 import 它，避免两边算法走样）。
 * 切分按"字符预算"而不是"段落个数"：段落长短差别很大，
 * 按个数切会让验证集只有几百字，指标噪声大到没法看。
 */
import { cleanText, mulberry32 } from './tiny-transformer.js';

export function buildCharVocab(text, { minFreq = 2, valRatio = 0.15, seed = 1234 } = {}) {
  const records = cleanText(text).split('\n').map((s) => [...s]).filter((r) => r.length > 0);
  const rnd0 = mulberry32(seed);
  const order = records.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd0() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const total = records.reduce((s, r) => s + r.length, 0);
  const budget = total * valRatio;
  const valIdx = new Set();
  let taken = 0;
  for (const i of order) {
    if (taken >= budget) break;
    valIdx.add(i);
    taken += records[i].length;
  }
  const trainText = records.filter((_, i) => !valIdx.has(i)).map((r) => r.join('')).join('\n');
  const valText = records.filter((_, i) => valIdx.has(i)).map((r) => r.join('')).join('\n');
  const freq = new Map();
  for (const c of trainText) if (c !== '\n') freq.set(c, (freq.get(c) || 0) + 1);
  const chars = [...freq.entries()].filter(([, n]) => n >= minFreq).map(([c]) => c).sort();
  const map = new Map(chars.map((c, i) => [c, i]));
  const unk = chars.length;
  const strs = chars.concat('?');
  const enc = (t) => [...t].filter((c) => c !== '\n').map((c) => (map.has(c) ? map.get(c) : unk));
  return {
    strs, trainIds: enc(trainText), valIds: enc(valText), charMap: map, merges: [],
    trainChars: [...trainText].length, valChars: [...valText].length, minFreq,
  };
}

/** 用训练时的字表编码任意文本（生成时把 prompt 变成 token） */
export function encodeWithCharMap(text, vocab) {
  const map = vocab.charMap;
  return [...cleanText(text)].map((c) => (map.has(c) ? map.get(c) : vocab.strs.length - 1));
}
