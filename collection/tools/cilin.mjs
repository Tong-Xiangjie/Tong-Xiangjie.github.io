// ==================== 哈工大同义词词林扩展版 ====================
//
// 用途：构建期生成文章搜索的「同义扩展」表（collection/data/synonyms.json）。
//
// 为什么用词林而不是 LLM 现编：
//   原来的方案是构建期调 DeepSeek 让它现编同义词，产出量很大（12,317 条）但质量不可控 ——
//   里面混着「息图」（从"全息图案"里切出来的残片）这种根本不是词的垃圾。
//   词林是人工编纂、带编码层级的权威词表，天然不会产生这种碎片。
//
// 数据来源：《哈工大信息检索研究室同义词词林扩展版》，77,455 词 / 17,817 个原子词群。
// 算法：田久乐, 赵蔚. 基于同义词词林的词语相似度计算方法.
//       吉林大学学报（信息科学版）, 2010.
//
// ★ 本文件是 PyPI 包 WordSimilarity 0.0.3（word_similarity/__init__.py）的**逐行移植**，
//   并用它 README 里给的示例数值校验过（人民/群众=0.9576614882494312 等 8 组，逐位相同）。
//   为什么移植而不直接调 Python：
//     ① 那个包用 open(file,'r') 读词典却没指定编码 —— Windows（locale=GBK）上必崩
//        UnicodeDecodeError，Linux runner 上只是恰好不暴露；
//     ② 整站构建链是纯 Node，为它引 Python 要多一个 setup-python 和一层语言边界。

const A = 0.65, B = 0.8, C = 0.9, D = 0.96, E = 0.5, F = 0.1, DEGREE = 180;

// 编码按层拆开：Aa01A01= → ['A','a','01','A','01','=']
// 第 1、2、4 层是字母，第 3、5 层是两位数字，最后一个字符区分同组内的同义/同类/独立
function parseCode(c) {
  return [c[0], c[1], c.slice(2, 4), c[4], c.slice(5, 7), c[7]];
}

// 解析 cilin_ex.txt。
// 每行：8 位编码 + 空格 + 该原子词群的全部词，例如
//   Aa01A01= 人 士 人物 人士 人氏 人选
//
// 返回
//   codes  : Map<词, 编码[]>   —— 只含"首行"的编码（见下方 ★）
//   lines  : [{ code, words }] —— 每一行都是一个独立的同义组
//   tree   : 层级树，叶子存该组词数（getN 要用同级子节点数）
//   dropped: Set<词>           —— 因数据错误被隔离、不参与跨组相似度的词
//
// ★ cilin_ex.txt 里有 8 个编码**重复出现两次，且两次的词毫无关系**，例如
//     Hg03A01= 修养 修身 养气 修身养性
//     Hg03A01= 摄影 留影 拍摄 拍照 照相 …
//   这是词典分发文件自身的数据错误（两个不同的原子词群共用了同一个编码）。
//   参考实现（PyPI WordSimilarity 0.0.3）把它们当成同一组，于是
//   similarity('修养','摄影') = 1.0 —— 造出一对彻底错误的"同义词"，
//   恰恰就是我们要避免的那种垃圾。
//   这里按**行**处理：给后续同码的行分配一个**合成的孤立编码**（见 makeIsolatedCode），
//   于是组内仍然是 1.0（摄影/拍摄 确实是同义词，不能丢），而跨组会走到
//   "公共层数 = 0" 的分支拿到底线值 0.1，不会再串成 1.0。
export function loadCilin(text) {
  const codes = new Map();
  const groups = new Map();   // 最终编码 → 该组全部词（重复行用的是合成编码）
  const lines = [];
  const tree = {};
  const isolated = new Set();
  const seenCode = new Set();
  let syntheticSeq = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(' ');
    const code = parts[0];
    if (code.length !== 8) continue;
    const words = parts.slice(1).filter(Boolean);
    if (!words.length) continue;
    lines.push({ code, words });

    if (seenCode.has(code)) {
      // 同码重复行：换一个合成编码，与所有真实编码在第 1 层就分叉
      const syn = makeIsolatedCode(syntheticSeq++);
      isolated.add(syn);
      groups.set(syn, words);
      for (const w of words) {
        const cur = codes.get(w);
        if (cur) cur.push(syn);
        else codes.set(w, [syn]);
      }
      continue;
    }
    seenCode.add(code);
    groups.set(code, words);

    const layers = parseCode(code);
    let node = tree;
    for (let i = 0; i < layers.length; i++) {
      const name = layers[i];
      if (!(name in node)) node[name] = (i === layers.length - 1) ? words.length : {};
      node = node[name];
    }

    for (const w of words) {
      const cur = codes.get(w);
      if (cur) cur.push(code);
      else codes.set(w, [code]);
    }
  }
  return { codes, groups, lines, tree, isolated, duplicateLines: lines.length - seenCode.size };
}

// 合成一个"不可能与真实编码相同"的编码：只改第 1 层用私用区字符。
// 为什么这样安全：两张编码第 1 层不同 ⇒ getCommonLayer 长度为 0 ⇒
// simByCode 在调用 getK/getN **之前**就返回底线值，因此
//   ① 不会和任何真实词产生相似度；② 也不会影响层级树里任何 n 的取值。
function makeIsolatedCode(i) {
  return String.fromCharCode(0xE000 + i) + '00000=';
}

function commonLayer(ca, cb) {
  const out = [];
  for (let i = 0; i < ca.length && i < cb.length; i++) {
    if (ca[i] === cb[i]) out.push(ca[i]);
    else break;
  }
  return out;
}

// 两层编码在分叉处相隔多少个兄弟结点（相邻记 1）
function getK(c1, c2) {
  if (c1[0] !== c2[0]) return Math.abs(c1[0].charCodeAt(0) - c2[0].charCodeAt(0));
  if (c1[1] !== c2[1]) return Math.abs(c1[1].charCodeAt(0) - c2[1].charCodeAt(0));
  if (c1[2] !== c2[2]) return Math.abs(parseInt(c1[2], 10) - parseInt(c2[2], 10));
  if (c1[3] !== c2[3]) return Math.abs(c1[3].charCodeAt(0) - c2[3].charCodeAt(0));
  return Math.abs(parseInt(c1[4], 10) - parseInt(c2[4], 10));
}

// 公共结点下有多少个同级子结点
function getN(tree, commonLayers) {
  let node = tree;
  for (const name of commonLayers) {
    if (!node || typeof node !== 'object') return 0;
    node = node[name];
  }
  if (typeof node !== 'object' || node === null) return node;   // 叶子：存的是词数
  return Object.keys(node).length;
}

function simFormula(coeff, n, k) {
  return coeff * Math.cos(n * Math.PI / DEGREE) * ((n - k + 1) / n);
}

export function simByCode(c1, c2, tree) {
  const la = parseCode(c1), lb = parseCode(c2);
  const common = commonLayer(la, lb);
  const len = common.length;

  // 任一方以 '@' 结尾表示该组自我封闭（组内只有一个词），直接给最低值
  if (c1.endsWith('@') || c2.endsWith('@') || len === 0) return F;

  if (len >= 6) {
    // 前 7 位相同 ⇒ 末位也相同：同为 '=' ⇒ 同义（1），同为 '#' ⇒ 同类（0.5）
    if (c1.endsWith('=') && c2.endsWith('=')) return 1;
    if (c1.endsWith('#') && c2.endsWith('#')) return E;
    return 0;   // ★ 原实现如此：同组内一个是 '=' 一个是 '#' 时返回 0（见下方注释）
  }
  const k = getK(la, lb);
  const n = getN(tree, common);
  if (len === 1) return simFormula(A, n, k);
  if (len === 2) return simFormula(B, n, k);
  if (len === 3) return simFormula(C, n, k);
  if (len === 4) return simFormula(D, n, k);
  return 0;     // len === 5：同原子词群但符号不同 —— 原实现也返回 0
}

// 两个词的相似度：所有编码组合里取最大值；任一词不在词林则为 0
export function similarity(tool, w1, w2) {
  const c1 = tool.codes.get(w1), c2 = tool.codes.get(w2);
  if (!c1 || !c2) return 0;
  let max = 0;
  for (const a of c1) for (const b of c2) {
    const s = simByCode(a, b, tool.tree);
    if (s > max) max = s;
  }
  return max;
}

// 取某个词的全部编码（不在词林 → [])
export function codesOf(tool, w) {
  return tool.codes.get(w) || [];
}
