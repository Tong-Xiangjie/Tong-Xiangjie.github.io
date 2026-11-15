// 语料规模与稀疏度统计（诊断用，可删除）
// 用法: node LLM/_corpus-stats.mjs
import { readFileSync } from 'node:fs';
import { TRAIN_TEXT, CLASSIC, PLAIN } from './corpus.js';

function stats(name, text, CTX, BATCH, STEPS) {
  const chars = [...text];
  const uniq = [...new Set(chars)];
  const freq = new Map();
  for (const c of chars) freq.set(c, (freq.get(c) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const V = uniq.length;
  const once = sorted.filter(([, n]) => n === 1).length;
  console.log(`\n===== ${name} =====`);
  console.log('字符数            :', chars.length);
  console.log('词表 V            :', V);
  console.log('训练窗口数        :', chars.length - CTX - 1);
  console.log('最高频 12 字      :', sorted.slice(0, 12).map(([c, n]) => `${c}:${n}`).join(' '));
  console.log('只出现 1 次       :', once, `/ ${V}  (${(once / V * 100).toFixed(1)}%)`);
  console.log('出现 <= 2 次      :', sorted.filter(([, n]) => n <= 2).length, `/ ${V}`);
  console.log('平均每字出现次数  :', (chars.length / V).toFixed(2));
  if (BATCH && STEPS) {
    console.log(`取样 ${BATCH}x${STEPS} 个窗口 = 覆盖 ${((BATCH * STEPS) / (chars.length - CTX - 1)).toFixed(1)} 倍`);
  }
  // 字符级 bigram：只看前 1 个字时的训练集命中率（很弱的下限基线）
  const bi = new Map();
  for (let i = 0; i + 1 < chars.length; i++) {
    const k = chars[i];
    let m = bi.get(k);
    if (!m) { m = new Map(); bi.set(k, m); }
    m.set(chars[i + 1], (m.get(chars[i + 1]) || 0) + 1);
  }
  let hit = 0, tot = 0;
  for (let i = 0; i + 1 < chars.length; i++) {
    const m = bi.get(chars[i]);
    let best = null, bestN = -1;
    for (const [c, n] of m) if (n > bestN) { bestN = n; best = c; }
    tot++; if (best === chars[i + 1]) hit++;
  }
  console.log('bigram 训练集命中率:', (hit / tot * 100).toFixed(1) + '%');
  return { V, N: chars.length };
}

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const old = html.match(/const CORPUS = `([\s\S]*?)`;/)[1];
const a = stats('旧语料（CORPUS + CORPUS，912 字）', old + old, 8, 16, 3000);
console.log('  古典部分/白话部分 : 0 / ' + [...old].length);
const b = stats('新语料（古典 ' + [...CLASSIC].length + ' 字 + 白话 ' + [...PLAIN].length + ' 字）', TRAIN_TEXT, 32, 0, 0);

console.log('\n===== 参数量对比 =====');
const oldP = a.V * 24 + 96 * 8 * 24 + 96 + a.V * 96 + a.V;
const D = 96, H = 4, F = D * 4, L = 3, CTX2 = 32;
const newP = b.V * D + CTX2 * D + L * (4 * D * D + 4 * D + 2 * D * F + 2 * F + 4 * D) + b.V * D + b.V;
console.log('旧 MLP                          :', oldP.toLocaleString());
console.log('新 Transformer(D=96,L=3,ctx=32):', newP.toLocaleString());
console.log('\n平均每字出现次数 提升:', ((b.N / b.V) / (a.N / a.V)).toFixed(2) + 'x');
