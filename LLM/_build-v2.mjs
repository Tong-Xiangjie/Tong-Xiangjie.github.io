// 组装单文件 index.html：模型代码从 tiny-transformer.js 抽取，避免两份实现走样
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { TRAIN_TEXT } from './corpus.js';

/* ---------- 0. 把老的单隐层版本降级存档（只做一次，并且要认得出它） ---------- */
// 只有当 index.html 确实是"老版本"时才备份：老版本里没有 TinyTransformer，
// 没有这段判断的话，构建失败后再跑一次就会把生成物当成"老版本"备份下来。
const idxPath = new URL('./index.html', import.meta.url);
const legacyPath = new URL('./v1-legacy.html', import.meta.url);
if (existsSync(idxPath) && !existsSync(legacyPath)) {
  const old = readFileSync(idxPath, 'utf8');
  if (!old.includes('TinyTransformer')) {
    copyFileSync(idxPath, legacyPath);
    console.log('已把旧的单隐层版本备份为 v1-legacy.html');
  } else {
    console.log('index.html 已经是生成物，跳过备份（v1-legacy.html 保持不存在）');
  }
}

/* ---------- 1. 语料：必须是干净的纯文本（能塞进模板字符串） ---------- */
// 直接复用 corpus.js 的 TRAIN_TEXT，保证 demo 与 Node 侧训练用的是同一份语料
const text = TRAIN_TEXT;
for (const bad of ['`', '${', '\\']) {
  if (text.includes(bad)) throw new Error(`语料含有不能放进模板字符串的字符: ${JSON.stringify(bad)}`);
}

/* ---------- 2. 从 tiny-transformer.js 里按行区间抽取要内联的代码 ---------- */
const src = readFileSync(new URL('./tiny-transformer.js', import.meta.url), 'utf8').split(/\r?\n/);
const find = (pattern, from = 0) => {
  const i = src.findIndex((l, k) => k >= from && l.includes(pattern));
  if (i < 0) throw new Error('找不到锚点: ' + pattern);
  return i;
};
// 用"锚点行"切区间，避免行号漂移；抽取结果由本文件末尾的 new Function 校验语法
const iClean = find('export function mulberry32');
const iBPE = find('export function trainBPE');
const iSample = find('export function sampleFromLogits');
const iAdam = find('const ADAM_BETA1');
const iEval = find('export function evaluate');
const pieces = [
  src.slice(iClean, iBPE).join('\n'),      // mulberry32 + CJK/PUNCT + cleanText
  src.slice(iSample, iAdam - 2).join('\n'), // 采样工具 + encodeText
  src.slice(iAdam, iEval).join('\n'),      // ADAM 常量 + TinyTransformer 类
  src.slice(iEval).join('\n'),             // evaluate + bigramBaseline
].join('\n\n');
// 去掉 export 关键字，改成浏览器普通脚本
const modelCode = pieces.replace(/^export /gm, '');

/* ---------- 2b. checkpoint.js / vocab-char.js 是独立模块，去掉 import/export 后整段内联 ---------- */
const stripModule = (file, mustContain) => {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => !/^import\s/.test(l) && !/^\s*const\s*\{[^}]*\}\s*=\s*await import\(/.test(l))
    .join('\n')
    .replace(/^export async function /gm, 'async function ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'const ');
  if (!code.includes(mustContain)) throw new Error(`${file} 抽取失败`);
  return code;
};
const ckCode = stripModule('./checkpoint.js', 'async function encodeCheckpoint');
const vocabCode = stripModule('./vocab-char.js', 'function buildCharVocab');

/* ---------- 3. 拼装 ---------- */
const tpl = readFileSync(new URL('./_demo-template.html', import.meta.url), 'utf8');
const out = tpl
  .replace('/*__CORPUS__*/', '`' + text + '`')
  .replace('/*__MODEL__*/',
    modelCode +
    '\n\n/* ============================ 词表 ============================ */\n' + vocabCode +
    '\n\n/* ============================ 存档 ============================ */\n' + ckCode);

/* ---------- 4. 语法校验（在 Node 里编译一次，防止生成坏文件） ---------- */
try {
  new Function(out.split('<script>')[1].split('</script>')[0]);
} catch (e) {
  throw new Error('生成的内联脚本语法有误: ' + e.message);
}

writeFileSync(new URL('./index.html', import.meta.url), out, 'utf8');
console.log('index.html 已生成：', out.length, 'bytes（含语料', text.length, '字）');
