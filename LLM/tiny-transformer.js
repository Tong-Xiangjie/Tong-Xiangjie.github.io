/* ============================================================================
 * tiny-transformer.js —— 纯 JS 手写前向/反向传播的字符级因果 Transformer
 *
 * 设计目标：
 *   1. 无框架、无依赖，浏览器与 Node 共用同一份代码（可被自动化测试校验）。
 *   2. 反向传播与 PyTorch autograd 做数值梯度对照（见 _test-grad.mjs）。
 *   3. 参数量/序列长度/层数可调，能在浏览器里几十秒内训完一个小语料。
 *
 * 与 v1（单隐层 MLP）的关键差别：
 *   - v1: x = concat(E[c0..c7]) -> Linear -> ReLU -> Linear
 *     上下文只是被"打平拼接"，模型只需要对 8 个位置求和就能算出同一结果，
 *     也就是说它对词序几乎是不敏感的（一个丢掉了顺序的词袋）。
 *   - v2: 每个位置有独立的位置编码，并且用因果自注意力让每个位置
 *     显式地"看"它左边的具体位置，因此能表达"if 位置 t-1 是 X then ..."。
 * ==========================================================================*/

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------- 语料 / 词表 / 数据集 --------------------------- */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const PUNCT = '，。！？、；：“”‘’（）《》〈〉—…·';

/**
 * 清洗语料：只保留汉字、常用标点和 ASCII 字母数字。
 * 把连续空白压成换行，避免古典文本里的换行符把 BPE 合并切碎。
 */
export function cleanText(raw) {
  let s = raw.replace(/\r\n?/g, '\n');
  const out = [];
  for (const ch of s) {
    if (CJK.test(ch) || PUNCT.includes(ch)) out.push(ch);
    else if (ch === '\n') out.push('\n');
    else if (/[A-Za-z0-9]/.test(ch)) out.push(ch);
    else if (/\s/.test(ch)) continue;
    else out.push(ch);
  }
  return out.join('').replace(/\n{2,}/g, '\n');
}

/**
 * 无监督 BPE：把出现频率最高的相邻 token 对不断合并，直到词表达到 vocabSize。
 * 这是让"小语料 + 小模型"能训出像样结果的关键一步：
 * 常用字串（比如"我们""可以""人工智能"）会合并成一个 token，
 * 于是平均每个 token 的出现次数大幅上升，序列也变短了。
 */
export function trainBPE(text, vocabSize) {
  // 基础符号用"稠密 id"0..k-1，合并出的 token 从 k 开始编号，
  // 这样 vocab.size 就是真实词表大小（早期版本直接拿码点当 id，
  // 会让词表大小虚报成上百万，后续所有按 V 分配的内存都会被撑爆）。
  const chars = [...new Set([...text])];
  const base = new Map();                       // 字符 -> 稠密 id
  chars.forEach((c, i) => base.set(c, i));
  let seq = [...text].map((c) => base.get(c));
  const vocab = new Map();                      // id -> 字符串
  chars.forEach((c, i) => vocab.set(i, c));

  const pairCache = new Map();
  const countPairs = (arr) => {
    pairCache.clear();
    for (let i = 0; i + 1 < arr.length; i++) {
      const a = arr[i], b = arr[i + 1];
      const key = a * 2097152 + b;
      const e = pairCache.get(key);
      if (e) e.n++;
      else pairCache.set(key, { a, b, n: 1 });
    }
    return pairCache;
  };

  const merges = [];
  let nextId = chars.length;
  // 预留一个 unk 槽位（id = chars.length + merges.length），保证编码任何文本都不会越界
  const mergeCap = Math.max(0, vocabSize - 2) - chars.length;
  let guard = 0;
  // 每次合并让 token 总数至少减少 1，所以循环次数天然以 seq.length 为上限；
  // guard 只是额外保险，防止死循环（不能按 vocabSize - vocab.size 算，
  // 因为初始词表可能已经比目标词表还大）。
  const maxMerges = Math.min(seq.length + 8, mergeCap);
  while (vocab.size < vocabSize && seq.length > 1 && guard < maxMerges) {
    guard++;
    const pairs = countPairs(seq);
    if (pairs.size === 0) break;
    let best = null, bestN = 1;
    for (const e of pairs.values()) {
      if (!best || e.n > bestN || (e.n === bestN && (e.a < best.a || (e.a === best.a && e.b < best.b)))) {
        best = e; bestN = e.n;
      }
    }
    if (!best || bestN < 2) break;

    const replaced = [];
    let i = 0;
    while (i < seq.length) {
      if (i + 1 < seq.length && seq[i] === best.a && seq[i + 1] === best.b) {
        replaced.push(nextId);
        i += 2;
      } else {
        replaced.push(seq[i]);
        i += 1;
      }
    }
    if (replaced.length === seq.length) break;
    seq = replaced;
    vocab.set(nextId, vocab.get(best.a) + vocab.get(best.b));
    merges.push([best.a, best.b, nextId]);
    nextId += 1;
  }
  // 字符 -> id 的映射随 merges 一起返回，编码其它文本时必须复用，
  // 否则不同文本会算出不同的稠密 id（除非它恰好含有完全相同的字符集）。
  return { ids: seq, vocab, merges, charMap: base };
}

export function encodeWithBPE(text, merges, charMap) {
  const cm = charMap || (() => {
    const m = new Map();
    [...new Set([...text])].forEach((c, i) => m.set(c, i));
    return m;
  })();
  const unk = cm.size + merges.length;          // 预留的 unk 槽位
  let seq = [...text].map((c) => (cm.has(c) ? cm.get(c) : unk));
  for (const [a, b, id] of merges) {
    if (seq.length < 2) break;
    const out = [];
    let i = 0;
    while (i < seq.length) {
      if (i + 1 < seq.length && seq[i] === a && seq[i + 1] === b) { out.push(id); i += 2; }
      else { out.push(seq[i]); i += 1; }
    }
    seq = out;
  }
  return seq;
}

/**
 * 构建词表与训练/验证切分。
 * 注意：切分按"段落"做（record-level），而不是按 token 位置切。
 * v1 直接把 CORPUS 复制两份，又按位置随机取样，等于让模型从后半段抄前半段。
 */
export function buildVocab(text, opts = {}) {
  const { vocabSize = 900, valRatio = 0.08, seed = 1234, useBPE = true } = opts;
  const records = cleanText(text).split('\n').map((s) => [...s]).filter((r) => r.length > 0);
  const rnd = mulberry32(seed);
  const order = records.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nVal = Math.max(1, Math.round(records.length * valRatio));
  const valIdx = new Set(order.slice(0, nVal));
  const trainText = records.filter((_, i) => !valIdx.has(i)).map((r) => r.join('')).join('\n');
  const valText = records.filter((_, i) => valIdx.has(i)).map((r) => r.join('')).join('\n');

  let strs, trainIds, valIds, merges = [], charMap = null;
  if (useBPE) {
    const bpe = trainBPE(trainText, vocabSize);
    strs = [];
    for (const [id, s] of bpe.vocab) strs[id] = s;
    strs[bpe.charMap.size + bpe.merges.length] = '?';   // 预留的 unk 槽位
    for (let i = 0; i < strs.length; i++) if (strs[i] === undefined) strs[i] = '?';
    trainIds = bpe.ids;
    valIds = encodeWithBPE(valText, bpe.merges, bpe.charMap);
    merges = bpe.merges;
    charMap = bpe.charMap;
  } else {
    const chars = [...new Set([...trainText].filter((c) => c !== '\n'))].sort();
    strs = chars;
    charMap = new Map(chars.map((c, i) => [c, i]));
    const unk = chars.length;
    strs.push('?');
    trainIds = [...trainText].map((c) => (charMap.has(c) ? charMap.get(c) : unk));
    valIds = [...valText].map((c) => (charMap.has(c) ? charMap.get(c) : unk));
  }
  return {
    strs, trainIds, valIds, merges, charMap,
    trainChars: [...trainText].length, valChars: [...valText].length, nRecords: records.length,
  };
}

/** 用同一套词表编码任意文本（生成时用来把 prompt 变成 token） */
export function encodeText(text, vocab) {
  const clean = cleanText(text);
  if (vocab.merges && vocab.merges.length) return encodeWithBPE(clean, vocab.merges, vocab.charMap);
  const unk = vocab.charMap.size;
  return [...clean].map((c) => (vocab.charMap.has(c) ? vocab.charMap.get(c) : unk));
}

/* ------------------------------- 采样工具 ------------------------------- */

/**
 * 从 logits 采样下一个 token。
 * 顺序很关键：原始概率 -> 重复惩罚 -> 温度 -> top-k/top-p -> 无重复 n-gram 屏蔽 -> 归一化抽取。
 * 温度必须放在重复惩罚之后、软化的那一步，否则低温下惩罚几乎没有效果。
 */
export function sampleFromLogits(logits, cfg) {
  const {
    temperature = 0.8, topK = 40, topP = 0.95,
    repetitionPenalty = 1.15, repetitionWindow = 64,
    noRepeatNgram = 4, recent = [], banned = null, rnd = Math.random,
  } = cfg || {};
  const V = logits.length;

  let mx = -Infinity;
  for (let i = 0; i < V; i++) if (logits[i] > mx) mx = logits[i];
  const p = new Float64Array(V);
  let sum = 0;
  for (let i = 0; i < V; i++) { p[i] = Math.exp(logits[i] - mx); sum += p[i]; }
  for (let i = 0; i < V; i++) p[i] /= sum;

  // 只对最近窗口里出现过的 token 施加惩罚（按出现次数计入，出现越多压得越狠）
  if (repetitionPenalty > 1) {
    const start = Math.max(0, recent.length - repetitionWindow);
    const seen = new Map();
    for (let i = start; i < recent.length; i++) seen.set(recent[i], (seen.get(recent[i]) || 0) + 1);
    for (const [t, n] of seen) p[t] /= Math.pow(repetitionPenalty, Math.min(n, 4));
  }

  const t = Math.max(1e-3, temperature);
  let z = 0;
  for (let i = 0; i < V; i++) { p[i] = Math.pow(p[i], 1 / t); z += p[i]; }
  for (let i = 0; i < V; i++) p[i] /= z;

  if (banned && banned.size) for (const b of banned) p[b] = 0;

  // top-k / top-p
  const idx = new Array(V);
  for (let i = 0; i < V; i++) idx[i] = i;
  idx.sort((a, b) => p[b] - p[a]);
  const keep = [];
  let acc = 0;
  for (let i = 0; i < V; i++) {
    const id = idx[i];
    if (p[id] <= 0) continue;
    if (i >= topK) break;
    if (acc > 0 && acc + p[id] > topP) break;
    keep.push(id); acc += p[id];
  }
  if (keep.length === 0) keep.push(idx[0]);

  let r = rnd() * acc;
  for (const id of keep) { r -= p[id]; if (r <= 0) return id; }
  return keep[keep.length - 1];
}

/** 无重复 n-gram：如果接上 t 会让末尾 (n-1) 元组重复出现，就禁止 t */
export function bannedByNgram(seq, n) {
  const banned = new Set();
  if (!n || n < 2 || seq.length < n - 1) return banned;
  const target = seq.slice(seq.length - (n - 1));
  for (let i = 0; i + n <= seq.length; i++) {
    let ok = true;
    for (let k = 0; k < n - 1; k++) if (seq[i + k] !== target[k]) { ok = false; break; }
    if (ok) banned.add(seq[i + n - 1]);
  }
  return banned;
}

/* --------------------------------- 模型 --------------------------------- */

const ADAM_BETA1 = 0.9, ADAM_BETA2 = 0.999, ADAM_EPS = 1e-8;

export class TinyTransformer {
  constructor({ vocab, dModel = 96, nLayers = 3, nHeads = 4, ctx = 32, seed = 7, dropout = 0.0, tieWeights = true } = {}) {
    if (dModel % nHeads !== 0) throw new Error('dModel 必须能被 nHeads 整除');
    this.V = vocab; this.D = dModel; this.L = nLayers; this.H = nHeads;
    this.DH = dModel / nHeads; this.CTX = ctx; this.dropout = dropout;
    this.tieWeights = tieWeights;
    this.attScale = 1 / Math.sqrt(this.DH);
    const rnd = mulberry32(seed);
    this.initParams(rnd);
    this.allocWorkspace();
    this.allocGrads();
    this.adam = null;
    this.rndPhase = 0;
    this.step = 0;
  }

  initParams(rnd) {
    const { V, D, L, CTX } = this;
    const g = (n, scale) => {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // Box-Muller，正态初始化
        const u1 = Math.max(1e-9, rnd()), u2 = rnd();
        a[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
      }
      return a;
    };
    this.E = g(V * D, 0.02);          // 输入词嵌入
    this.P = g(CTX * D, 0.01);        // 位置嵌入（每个位置一个学习出来的向量）
    this.layers = [];
    for (let i = 0; i < L; i++) {
      this.layers.push({
        ln1g: new Float32Array(D).fill(1), ln1b: new Float32Array(D),
        Wq: g(D * D, 1 / Math.sqrt(D)), bq: new Float32Array(D),
        Wk: g(D * D, 1 / Math.sqrt(D)), bk: new Float32Array(D),
        Wv: g(D * D, 1 / Math.sqrt(D)), bv: new Float32Array(D),
        Wo: g(D * D, 1 / Math.sqrt(D)), bo: new Float32Array(D),
        ln2g: new Float32Array(D).fill(1), ln2b: new Float32Array(D),
        W1: g(4 * D * D, 1 / Math.sqrt(D)), b1: new Float32Array(4 * D),
        W2: g(D * 4 * D, 1 / Math.sqrt(4 * D)), b2: new Float32Array(D),
      });
    }
    this.lnfg = new Float32Array(D).fill(1);
    this.lnfb = new Float32Array(D);
    // 输出层权重。tieWeights=true 时直接复用输入词嵌入 E（GPT-2 的 weight tying）：
    // 小语料上这能省掉 V×D 个参数，而且每个字只有一个向量要学，收敛明显更好。
    this.Wout = this.tieWeights ? this.E : g(V * D, 1 / Math.sqrt(D));
    this.bout = new Float32Array(V);
  }

  paramList() {
    const list = [['E', this.E], ['P', this.P]];
    this.layers.forEach((l, i) => { for (const k of Object.keys(l)) list.push([`l${i}.${k}`, l[k]]); });
    list.push(['lnfg', this.lnfg], ['lnfb', this.lnfb]);
    // 权重共享时 Wout 就是 E，不能再当成独立参数（否则会被更新两次）
    if (!this.tieWeights) list.push(['Wout', this.Wout]);
    list.push(['bout', this.bout]);
    return list;
  }

  nParams() {
    let n = 0;
    for (const [, p] of this.paramList()) n += p.length;
    return n;
  }

  allocWorkspace() {
    const { D, L, CTX, H } = this;
    const F = 4 * D;
    const zeros = (n) => new Float32Array(n);
    // 逐层的激活缓存：**每层各存一份**。
    // 早期版本只有一套 h1/h2/h3/f1/f2/q/k/v/at/ao，每层前向都会覆盖；
    // 反传到第 0 层时读到的其实是最后一层的激活，于是第 0 层（以及更早的
    // 所有参数和词嵌入）的梯度全错。最外层参数看起来是对的，所以很容易漏掉。
    // 实测：autodiff 与数值梯度都给出 l0.Wq[0]=4.0956e-1，而旧实现给 -3.32e-2。
    this.w = {
      h0: zeros(CTX * D), h5: zeros(CTX * D),
      logits: zeros(CTX * this.V),
      mean: zeros(CTX), rstd: zeros(CTX),
      acts: Array.from({ length: L }, () => ({
        h1: zeros(CTX * D), h2: zeros(CTX * D), h3: zeros(CTX * D),
        f1: zeros(CTX * F), f2: zeros(CTX * F), h4: zeros(CTX * D),
        q: zeros(CTX * D), k: zeros(CTX * D), v: zeros(CTX * D),
        at: zeros(CTX * CTX * H), ao: zeros(CTX * D),
      })),
    };
  }

  allocGrads() {
    const { V, D, L, CTX, H } = this;
    const mk = (n) => new Float32Array(n);
    this.g = { E: mk(V * D), P: mk(CTX * D), lnfg: mk(D), lnfb: mk(D), Wout: mk(V * D), bout: mk(V), layers: [] };
    for (let i = 0; i < L; i++) {
      this.g.layers.push({
        ln1g: mk(D), ln1b: mk(D), Wq: mk(D * D), bq: mk(D), Wk: mk(D * D), bk: mk(D),
        Wv: mk(D * D), bv: mk(D), Wo: mk(D * D), bo: mk(D),
        ln2g: mk(D), ln2b: mk(D), W1: mk(4 * D * D), b1: mk(4 * D), W2: mk(D * 4 * D), b2: mk(D),
      });
    }
    this.dw = {
      dx: mk(CTX * D), dh5: mk(CTX * D),
      dh4: mk(CTX * D), df2: mk(CTX * D), df1: mk(CTX * 4 * D), dh3: mk(CTX * D), dh2: mk(CTX * D),
      dao: mk(CTX * D), dat: mk(CTX * CTX * H),
      dq: mk(CTX * D), dk: mk(CTX * D), dv: mk(CTX * D),
      dh1: mk(CTX * D), dh0: mk(CTX * D),
      dlogits: mk(CTX * V),
    };
    // 一次性建立 参数 -> 梯度 / Adam 状态 的绑定，避免每步都去查表
    this.bindings = this.paramList().map(([name, p]) => {
      const parts = name.split('.');
      return { name, p, g: parts.length === 1 ? this.g[name] : this.g.layers[+parts[0].slice(1)][parts[1]] };
    });
  }

  zeroGrads() {
    for (const b of this.bindings) b.g.fill(0);
    // 权重共享时 Wout 不在 paramList() 里，也就不会出现在 bindings 中，
    // 但 backward 仍然往 g.Wout 里累加。漏掉这一行，输出层投影的梯度就会
    // **跨训练步一直累积**（其他所有参数每步都规规矩矩清零），
    // 表现为训练极不稳定、loss 卡住不动。诊断这类问题的办法是：
    // 让 backward 写入的每一块缓冲都在这里被显式清零。
    this.g.Wout.fill(0);
  }

  resetBatchGrads() { this.zeroGrads(); }

  /** 层归一化：写入 out[y*D+d]，缓存 mean[y] 与 rstd[y] */
  layernorm(x, g, b, out, mean, rstd, T) {
    const { D } = this;
    for (let t = 0; t < T; t++) {
      let m = 0;
      for (let d = 0; d < D; d++) m += x[t * D + d];
      m /= D;
      let vv = 0;
      for (let d = 0; d < D; d++) { const q = x[t * D + d] - m; vv += q * q; }
      vv /= D;
      const r = 1 / Math.sqrt(vv + 1e-5);
      mean[t] = m; rstd[t] = r;
      for (let d = 0; d < D; d++) out[t * D + d] = (x[t * D + d] - m) * r * g[d] + b[d];
    }
  }

  /**
   * 前向传播。
   * 每个中间量都算进局部变量，最后再写回 this.w 上对应的缓冲；
   * backward 依赖 w.h1/h2/h3/f1/f2/h4/h5 这些名字，所以缓冲名保持不变。
   * @returns {number} 平均交叉熵（targets 为 null 时返回 0）
   */
  forward(tokens, targets) {
    const { D, L, H, DH, CTX, V } = this;
    const w = this.w, T = tokens.length;
    if (T > CTX) throw new Error(`序列长度 ${T} 超过 ctx=${CTX}`);
    const TD = T * D, F = 4 * D, TF = T * F;

    const ln = (x, g, b) => {
      const out = new Float32Array(TD);
      const mean = new Float32Array(T), rstd = new Float32Array(T);
      for (let t = 0; t < T; t++) {
        let mu = 0;
        for (let d = 0; d < D; d++) mu += x[t * D + d];
        mu /= D;
        let va = 0;
        for (let d = 0; d < D; d++) { const q = x[t * D + d] - mu; va += q * q; }
        va /= D;
        // 数值保护：方差为 0（整行常量）时 rstd 取 0，避免 0 * Infinity = NaN
        const r = va > 1e-12 ? 1 / Math.sqrt(va + 1e-5) : 0;
        mean[t] = mu; rstd[t] = r;
        for (let d = 0; d < D; d++) out[t * D + d] = (x[t * D + d] - mu) * r * g[d] + b[d];
      }
      // 注意：每层/每处的 mean、rstd 必须各自缓存，backward 要用它们。
      // 早期版本共用 this.w.mean / this.w.rstd，最后一次写入会覆盖前面所有层，
      // 导致反传用的是错的统计量（梯度全错，但 loss 看起来正常）。
      stats.push({ mean, rstd });
      if (T <= w.mean.length) { w.mean.set(mean); w.rstd.set(rstd); }
      return out;
    };
    const stats = [];   // 顺序: [每层 ln1, ln2] ... , 最后 lnf

    let cur = new Float32Array(TD);
    for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) cur[t * D + d] = this.E[tokens[t] * D + d] + this.P[t * D + d];
    w.h0.set(cur);

    let lastAttnIn = null;   // 最后一层 ln1 的输入（backward 需要）
    const attnIns = [];      // 每层 ln1 的输入，backward 逐层要用
    for (let li = 0; li < L; li++) {
      const l = this.layers[li];
      const attnIn = cur;
      attnIns.push(attnIn);
      const z = ln(cur, l.ln1g, l.ln1b);

      // q/k/v 投影
      const q = new Float32Array(TD), k = new Float32Array(TD), v = new Float32Array(TD);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        let a = l.bq[j], b = l.bk[j], c = l.bv[j];
        for (let i = 0; i < D; i++) {
          const xv = z[t * D + i];
          a += xv * l.Wq[j * D + i];
          b += xv * l.Wk[j * D + i];
          c += xv * l.Wv[j * D + i];
        }
        q[t * D + j] = a; k[t * D + j] = b; v[t * D + j] = c;
      }

      // 因果自注意力：at 布局 [t][h][s]
      const at = new Float32Array(T * H * T);
      const ao = new Float32Array(TD);
      for (let h = 0; h < H; h++) for (let t = 0; t < T; t++) {
        const base = (t * H + h) * T;
        let mx = -Infinity;
        for (let s = 0; s <= t; s++) {
          let dot = 0;
          for (let d = 0; d < DH; d++) dot += q[t * D + h * DH + d] * k[s * D + h * DH + d];
          dot *= this.attScale;
          at[base + s] = dot;
          if (dot > mx) mx = dot;
        }
        let sum = 0;
        for (let s = 0; s <= t; s++) { const e = Math.exp(at[base + s] - mx); at[base + s] = e; sum += e; }
        const inv = sum > 0 ? 1 / sum : 0;
        for (let s = 0; s <= t; s++) at[base + s] *= inv;
        for (let s = 0; s <= t; s++) {
          const a = at[base + s];
          if (a === 0) continue;
          for (let d = 0; d < DH; d++) ao[t * D + h * DH + d] += a * v[s * D + h * DH + d];
        }
      }

      // 注意力输出投影 + 残差
      const h2 = new Float32Array(TD);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        let s = l.bo[j];
        for (let i = 0; i < D; i++) s += l.Wo[j * D + i] * ao[t * D + i];
        h2[t * D + j] = s + attnIn[t * D + j];
      }

      // 前馈 + 残差
      const z2 = ln(h2, l.ln2g, l.ln2b);
      const f1 = new Float32Array(TF), f2 = new Float32Array(TF);
      for (let t = 0; t < T; t++) for (let j = 0; j < F; j++) {
        let s = l.b1[j];
        for (let i = 0; i < D; i++) s += l.W1[j * D + i] * z2[t * D + i];
        f1[t * F + j] = s;
        f2[t * F + j] = s > 0 ? s : 0;
      }
      const h4 = new Float32Array(TD);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        let s = l.b2[j];
        for (let i = 0; i < F; i++) s += l.W2[j * F + i] * f2[t * F + i];
        h4[t * D + j] = s + h2[t * D + j];
      }

      // 写回本层自己的缓冲（backward 逐层读，互不覆盖）
      const A = w.acts[li];
      A.h1.set(z); A.q.set(q); A.k.set(k); A.v.set(v);
      A.at.fill(0); A.at.set(at); A.ao.set(ao);
      A.h2.set(h2); A.h3.set(z2); A.f1.set(f1); A.f2.set(f2); A.h4.set(h4);
      lastAttnIn = attnIn;
      cur = h4;
    }
    this.__attnIns = attnIns;

    // 输出层
    // logits 的步长是 V（= 词表大小），不是 CTX。早期版本把它写进按 CTX 长度
    // 分配的 w.logits 里，只有 T === CTX 时下标才对得上；一旦序列比 CTX 短，
    // backward 就会读到错的 logits —— 表现为 softmax 概率全为 0、dlogits 退化成
    // -onehot，注意力那一路的梯度直接变成 0（dq=dk=dv=0），而 loss 曲线照常下降。
    const h5 = ln(cur, this.lnfg, this.lnfb);
    w.h5.set(h5);
    this.__stats = stats;   // backward 用：每层 [ln1, ln2] + 输出层 lnf
    const logits = new Float32Array(T * V);
    for (let t = 0; t < T; t++) for (let j = 0; j < V; j++) {
      let s = this.bout[j];
      for (let i = 0; i < D; i++) s += this.Wout[j * D + i] * h5[t * D + i];
      logits[t * V + j] = s;
    }
    w.logits = logits;
    this.__lastAttnIn = lastAttnIn;

    if (targets === null || targets === undefined) return 0;
    let loss = 0;
    for (let t = 0; t < T; t++) {
      const base = t * V;
      let mx = -Infinity;
      for (let j = 0; j < V; j++) if (logits[base + j] > mx) mx = logits[base + j];
      let sum = 0;
      for (let j = 0; j < V; j++) sum += Math.exp(logits[base + j] - mx);
      loss += -(logits[base + targets[t]] - mx - Math.log(sum));
    }
    return loss / Math.max(1, T);
  }

  /**
   * 反向传播：在已有梯度缓冲上累加。
   * 约定：forward 返回的是 **平均** 交叉熵（除以 T），
   * 因此这里对每个位置乘 1/T，保证梯度是 d(平均loss)/dθ。
   * 写法与 forward 一一对应，中间梯度用局部 Float64Array。
   */
  backward(tokens, targets, scale = 0) {
    const { D, L, H, DH, V } = this;
    const w = this.w, g = this.g, T = tokens.length;
    const TD = T * D, F = 4 * D, TF = T * F;
    const stats = this.__stats;
    // scale 默认 0 表示"自动"：与 forward 的平均损失保持一致
    const s = scale > 0 ? scale : 1 / Math.max(1, T);

    /* ---- 输出层：softmax + 交叉熵 ---- */
    // 先算"求和损失"的梯度（最自然的形式：softmax - onehot），
    // 然后**一次性**把 1/T 乘进去。之后 dlogits 以及由它派生的
    // dh5/dh4/dh2/dh3/dh1、dq/dk/dv、所有 dW* 就都是 d(平均loss)/dθ。
    // 教训：早期版本的 1/T 只乘在 dlogits 和 lnBackward 两处，
    // 中间那些从 dh2 拷出来的局部队列漏了，导致 E/P 的梯度整整大了 T 倍，
    // 而 loss 曲线看起来完全正常。
    const dlogits = new Float64Array(T * V);
    for (let t = 0; t < T; t++) {
      const base = t * V;
      let mx = -Infinity;
      for (let j = 0; j < V; j++) if (w.logits[base + j] > mx) mx = w.logits[base + j];
      let sum = 0;
      for (let j = 0; j < V; j++) sum += Math.exp(w.logits[base + j] - mx);
      for (let j = 0; j < V; j++) {
        dlogits[base + j] = (Math.exp(w.logits[base + j] - mx) / sum - (j === targets[t] ? 1 : 0)) * s;
      }
    }
    const dh5 = new Float64Array(TD);
    for (let t = 0; t < T; t++) for (let j = 0; j < V; j++) {
      const dl = dlogits[t * V + j];
      if (dl === 0) continue;
      g.bout[j] += dl;
      const row = j * D;
      for (let i = 0; i < D; i++) { g.Wout[row + i] += dl * w.h5[t * D + i]; dh5[t * D + i] += dl * this.Wout[row + i]; }
    }
    // 权重共享时把输出层的梯度并回词嵌入（E 与 Wout 是同一块内存）
    if (this.tieWeights) for (let i = 0; i < V * D; i++) g.E[i] += g.Wout[i];

    /* ---- 逐层反向 ---- */
    // 输出层 LayerNorm：x = 最后一层的 h4
    const Aout = w.acts[L - 1];
    let dcur = this.lnBackward(Aout.h4, this.lnfg, stats[stats.length - 1], dh5, g.lnfg, g.lnfb);
    let dEmb = dcur;   // 第 0 层输入梯度（循环里会被覆盖，最后单独保存）

    for (let li = L - 1; li >= 0; li--) {
      const l = this.layers[li];
      const gg = g.layers[li];
      const A = w.acts[li];   // 本层自己的激活缓存（必须逐层取，不能读全局唯一的缓冲）
      const st1 = stats[li * 2], st2 = stats[li * 2 + 1];

      // 残差 h4 = f3 + h2
      const dh2 = Float64Array.from(dcur);
      let df2 = Float64Array.from(dcur);

      const dW2 = new Float64Array(D * F), db2 = new Float64Array(D);
      let df1 = new Float64Array(TF);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        const d = df2[t * D + j];
        if (d === 0) continue;
        db2[j] += d;
        const row = j * F;
        for (let i = 0; i < F; i++) { dW2[row + i] += d * A.f2[t * F + i]; df1[t * F + i] += d * l.W2[row + i]; }
      }
      for (let i = 0; i < TF; i++) if (A.f1[i] <= 0) df1[i] = 0;

      const dW1 = new Float64Array(F * D), db1 = new Float64Array(F), dh3 = new Float64Array(TD);
      for (let t = 0; t < T; t++) for (let j = 0; j < F; j++) {
        const d = df1[t * F + j];
        if (d === 0) continue;
        db1[j] += d;
        const row = j * D;
        for (let i = 0; i < D; i++) { dW1[row + i] += d * A.h3[t * D + i]; dh3[t * D + i] += d * l.W1[row + i]; }
      }

      // 第二个 LayerNorm：x = h2，dx 需要累加到残差支路上
      const dln2 = this.lnBackward(A.h2, l.ln2g, st2, dh3, gg.ln2g, gg.ln2b);
      for (let i = 0; i < TD; i++) dh2[i] += dln2[i];

      // 残差 h2 = Wo·ao + attnIn
      const dhin = Float64Array.from(dh2);
      const dao = new Float64Array(TD), dWo = new Float64Array(D * D), dbo = new Float64Array(D);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        const d = dh2[t * D + j];
        if (d === 0) continue;
        dbo[j] += d;
        const row = j * D;
        for (let i = 0; i < D; i++) { dWo[row + i] += d * A.ao[t * D + i]; dao[t * D + i] += d * l.Wo[row + i]; }
      }

      // 注意力：ao = Σ_h at_h · v_h
      // dat 必须**每个 (h, t) 各自一份**（长度 T）。早期版本在层循环外只分配了一份
      // 长度为 T*H*T 的 dat，10 个 (h,t) 组合全往同一块内存里累加，
      // 于是 softmax 反传的 dot 项被别的头/别的位置污染，dq/dk 直接算错
      // （实测 dq 整块变成 0），而 l1.Wo 之类的参数梯度看起来还是对的。
      const dq = new Float64Array(TD), dk = new Float64Array(TD), dv = new Float64Array(TD);
      for (let h = 0; h < H; h++) for (let t = 0; t < T; t++) {
        const base = (t * H + h) * T;
        const dat = new Float64Array(T);
        for (let s = 0; s <= t; s++) {
          let acc = 0;
          // 只能用本头的 DH 维切片！前向是 ao[t][h*DH+d] += at*v[s][h*DH+d]，
          // 每个头只影响自己那 DH 维。早期版本这里写成 for (d < D)，
          // 于是每个头都把**所有头**的 dao 都算进来，dq/dv 被重复累加 H 倍，
          // 而 dWo（唯一不用这个循环的参数）却是对的，很难发现。
          for (let d = 0; d < DH; d++) {
            const da = dao[t * D + h * DH + d];
            acc += da * A.v[s * D + h * DH + d];
            dv[s * D + h * DH + d] += da * A.at[base + s];
          }
          dat[s] += acc;
        }
        // softmax 反向
        let dot = 0;
        for (let s = 0; s <= t; s++) dot += dat[s] * A.at[base + s];
        for (let s = 0; s <= t; s++) dat[s] = A.at[base + s] * (dat[s] - dot);
        for (let s = 0; s <= t; s++) {
          const ds = dat[s] * this.attScale;
          if (ds === 0) continue;
          for (let d = 0; d < DH; d++) {
            dq[t * D + h * DH + d] += ds * A.k[s * D + h * DH + d];
            dk[s * D + h * DH + d] += ds * A.q[t * D + h * DH + d];
          }
        }
      }

      // q/k/v 投影：三者共用同一份输入 h1
      const dWs = [new Float64Array(D * D), new Float64Array(D * D), new Float64Array(D * D)];
      const dbs = [new Float64Array(D), new Float64Array(D), new Float64Array(D)];
      const dGrads = [dq, dk, dv];
      const Ws = [l.Wq, l.Wk, l.Wv];
      const dh1 = new Float64Array(TD);
      for (let t = 0; t < T; t++) for (let j = 0; j < D; j++) {
        for (let k = 0; k < 3; k++) {
          const dqk = dGrads[k][t * D + j];
          if (dqk === 0) continue;
          dbs[k][j] += dqk;
          const row = j * D;
          for (let i = 0; i < D; i++) { dWs[k][row + i] += dqk * A.h1[t * D + i]; dh1[t * D + i] += dqk * Ws[k][row + i]; }
        }
      }

      // 第一个 LayerNorm：x 是本层输入（h0 或上一层的 h4）
      const attnIn = this.__attnIns[li];
      const dIn = this.lnBackward(attnIn, l.ln1g, st1, dh1, gg.ln1g, gg.ln1b);
      // 残差支路：h2 = Wo·ao + attnIn，所以本层输入还要额外收到一份 dh2。
      // 早期版本漏了这一行 —— 注意力输出权重 Wo 学得越小，梯度越少；
      // 极端情况 Wo=0 时 dIn 会整块变成 0，而 loss 曲线一切正常。
      // 尺度上不用再乘 s：dhin 来自 dh2 ← dcur ← dh5，源头已经乘过 1/T；
      // dIn 也来自 lnBackward(dh1) ← dh2，同样已经是平均损失尺度。
      for (let i = 0; i < TD; i++) dIn[i] += dhin[i];

      // 累积参数梯度
      for (let i = 0; i < D * F; i++) gg.W2[i] += dW2[i];
      for (let i = 0; i < D; i++) gg.b2[i] += db2[i];
      for (let i = 0; i < F * D; i++) gg.W1[i] += dW1[i];
      for (let i = 0; i < F; i++) gg.b1[i] += db1[i];
      for (let i = 0; i < D * D; i++) gg.Wo[i] += dWo[i];
      for (let i = 0; i < D; i++) gg.bo[i] += dbo[i];
      for (let k = 0; k < 3; k++) {
        const Wg = [gg.Wq, gg.Wk, gg.Wv][k], bg = [gg.bq, gg.bk, gg.bv][k];
        for (let i = 0; i < D * D; i++) Wg[i] += dWs[k][i];
        for (let i = 0; i < D; i++) bg[i] += dbs[k][i];
      }

      dcur = dIn;
      dEmb = dIn;   // 记录第 0 层的输入梯度，循环结束后它就是 dE/dP
    }

    /* ---- 词嵌入 + 位置嵌入 ---- */
    // 注意用 dEmb（第 0 层的输入梯度），不能用 dcur：
    // 循环里每次都会覆盖 dcur，最后留下的是最后一层的梯度。
    for (let t = 0; t < T; t++) {
      const row = tokens[t] * D;
      for (let d = 0; d < D; d++) {
        g.E[row + d] += dEmb[t * D + d];
        g.P[t * D + d] += dEmb[t * D + d];
      }
    }
  }

  /**
   * LayerNorm 反向。
   * @returns {Float64Array} 对输入的梯度（新建数组，便于直接累加）
   */
  lnBackward(x, g, st, dy, dg, db) {
    const { D } = this;
    const T = dy.length / D;
    const inv = 1 / D;
    const dx = new Float64Array(T * D);
    for (let t = 0; t < T; t++) {
      const r = st.rstd[t], m = st.mean[t];
      let s1 = 0, s2 = 0;
      for (let d = 0; d < D; d++) {
        const dd = dy[t * D + d] * g[d];
        s1 += dd;
        s2 += dd * (x[t * D + d] - m);
      }
      for (let d = 0; d < D; d++) {
        const dd = dy[t * D + d] * g[d];
        dx[t * D + d] = r * (dd - s1 * inv - (x[t * D + d] - m) * r * r * s2 * inv);
        dg[d] += dy[t * D + d] * (x[t * D + d] - m) * r;
        db[d] += dy[t * D + d];
      }
    }
    return dx;
  }

  /** 数值梯度用：只跑前向算 loss */
  lossOf(tokens, targets) { return this.forward(tokens, targets); }

  clipGrads(maxNorm) {
    let sq = 0;
    for (const b of this.bindings) { const g = b.g; for (let i = 0; i < g.length; i++) sq += g[i] * g[i]; }
    const norm = Math.sqrt(sq);
    if (norm > maxNorm) {
      const s = maxNorm / (norm + 1e-6);
      for (const b of this.bindings) { const g = b.g; for (let i = 0; i < g.length; i++) g[i] *= s; }
    }
    return norm;
  }

  /**
   * AdamW（解耦权重衰减）。
   * 小语料上必须靠 weight decay + 早停来压制过拟合：
   * 不用衰减时训练损失会一路降到 3 附近，验证损失同时涨到 8 以上。
   * @param lr 学习率
   * @param wd 权重衰减系数（0 表示纯 Adam）
   */
  adamStep(lr, wd = 0) {
    const { V, D, L, CTX } = this;
    if (!this.adam) {
      const mk = (n) => ({ m: new Float32Array(n), v: new Float32Array(n) });
      this.adam = { E: mk(V * D), P: mk(CTX * D), lnfg: mk(D), lnfb: mk(D), Wout: mk(V * D), bout: mk(V), layers: [] };
      for (let i = 0; i < L; i++) this.adam.layers.push({
        ln1g: mk(D), ln1b: mk(D), Wq: mk(D * D), bq: mk(D), Wk: mk(D * D), bk: mk(D),
        Wv: mk(D * D), bv: mk(D), Wo: mk(D * D), bo: mk(D),
        ln2g: mk(D), ln2b: mk(D), W1: mk(4 * D * D), b1: mk(4 * D), W2: mk(D * 4 * D), b2: mk(D),
      });
    }
    this.step++;
    const c1 = 1 - Math.pow(ADAM_BETA1, this.step);
    const c2 = 1 - Math.pow(ADAM_BETA2, this.step);
    const adam = this.adam;
    for (const b of this.bindings) {
      const parts = b.name.split('.');
      const st = parts.length === 1 ? adam[b.name] : adam.layers[+parts[0].slice(1)][parts[1]];
      const p = b.p, gr = b.g;
      // 1 维参数是偏置/缩放，不做衰减
      const decay = wd > 0 && p.length > 1 ? wd : 0;
      for (let i = 0; i < p.length; i++) {
        st.m[i] = ADAM_BETA1 * st.m[i] + (1 - ADAM_BETA1) * gr[i];
        st.v[i] = ADAM_BETA2 * st.v[i] + (1 - ADAM_BETA2) * gr[i] * gr[i];
        p[i] -= lr * ((st.m[i] / c1) / (Math.sqrt(st.v[i] / c2) + ADAM_EPS) + decay * p[i]);
      }
    }
  }

  /** 单个窗口的前向+反向+更新，tokens/targets 长度必须 <= CTX */
  trainStep(tokens, targets, lr, clip = 1.0, wd = 0) {
    this.resetBatchGrads();
    this.forward(tokens, targets);
    this.backward(tokens, targets);
    const norm = this.clipGrads(clip);
    this.adamStep(lr, wd);
    return norm;
  }

  /* ---------------------- 存档 / 读档 ---------------------- */

  /** 描述模型形状，读档时用来判断能不能直接灌进去 */
  shape() {
    return { vocab: this.V, dModel: this.D, nLayers: this.L, nHeads: this.H, ctx: this.CTX, tieWeights: this.tieWeights };
  }

  /** 列出所有要被存档的参数（含 Adam 的一阶/二阶矩）。Wout 共享时只存一份。 */
  stateArrays() {
    const out = [];
    const seen = new Set();
    for (const [name, p] of this.paramList()) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push([name, p]);
    }
    if (this.adam) {
      const adam = this.adam;
      for (const [name] of this.paramList()) {
        const parts = name.split('.');
        const st = parts.length === 1 ? adam[name] : (adam.layers[+parts[0].slice(1)] || {})[parts[1]];
        if (!st || seen.has(st.m)) continue;
        seen.add(st.m);
        out.push([name + ':adamM', st.m]);
        out.push([name + ':adamV', st.v]);
      }
    }
    return out;
  }

  /** 导出为纯数据对象（不含 Adam 状态），交给 checkpoint.js 打包 */
  saveState() {
    return {
      shape: this.shape(),
      step: this.step,
      params: this.paramList().map(([name, p]) => ({ name, data: p })),
      adam: this.adam ? { step: this.step, entries: this.stateArrays().filter(([n]) => n.includes(':adam')) } : null,
    };
  }

  /**
   * 灌入存档。形状不匹配直接抛错——安静地"读进去但尺寸不对"比报错危险得多。
   * @param state saveState() 的返回值
   */
  loadState(state) {
    const want = this.shape(), got = state.shape;
    for (const k of ['vocab', 'dModel', 'nLayers', 'nHeads', 'ctx']) {
      if (want[k] !== got[k]) {
        throw new Error(`存档与当前模型形状不符：${k} 存档=${got[k]} 当前=${want[k]}。请按存档里的超参重新初始化。`);
      }
    }
    if (want.tieWeights !== got.tieWeights) {
      throw new Error(`权重共享设置不符：存档 tieWeights=${got.tieWeights} 当前=${want.tieWeights}`);
    }
    const map = new Map(this.paramList());
    for (const { name, data } of state.params) {
      // 权重共享时 Wout 就是 E 本身，绝不能再往 Wout 里灌一份数据 ——
      // 那会把 this.Wout 从共享的 E 上摘下来，变成两块独立的参数，
      // 权重共享就此静默失效（训练看起来一切正常，只是少了共享带来的收益）。
      if (this.tieWeights && name === 'Wout') continue;
      const p = map.get(name);
      if (!p) continue;
      if (p.length !== data.length) throw new Error(`参数 ${name} 长度不符：${data.length} vs ${p.length}`);
      p.set(data);
    }
    if (this.tieWeights) this.Wout = this.E;   // 双保险：读档后共享关系必须还在
    if (state.adam && state.adam.entries) {
      if (!this.adam) { this.step = 0; this.adamStep(0, 0); }   // 先按 0 学习率建出 Adam 缓冲
      const amap = new Map(this.stateArrays());
      for (const [name, data] of state.adam.entries) {
        const buf = amap.get(name);
        if (buf && buf.length === data.length) buf.set(data);
      }
      this.step = state.adam.step || 0;   // 再恢复真正的步数，保证偏差修正 c1/c2 正确
    }
    return this;
  }

  /** 把当前模型存成 JSON 字符串（可直接写文件或放进 localStorage） */
  toJSONString() { return JSON.stringify(this.saveState()); }

  /** 从 JSON 字符串恢复。会先按存档形状新建一个模型，再把权重灌进去。 */
  static fromJSONString(str) {
    const state = JSON.parse(str);
    const m = new TinyTransformer({ ...state.shape, seed: 1 });
    m.loadState(state);
    return m;
  }
}

/* --------------------------------- 评估 --------------------------------- */

export function evaluate(model, ids, ctx, opts = {}) {
  const { batch = 8, maxWindows = 600, seed = 99 } = opts;
  const rnd = mulberry32(seed);
  let loss = 0, correct = 0, total = 0;
  const maxStart = ids.length - ctx - 1;
  if (maxStart <= 0) return { loss: NaN, ppl: NaN, acc: NaN, windows: 0 };
  const nWin = Math.min(maxWindows, maxStart);
  for (let b = 0; b < nWin; b += batch) {
    const n = Math.min(batch, nWin - b);
    let bl = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.floor(rnd() * maxStart);
      const toks = ids.slice(s, s + ctx);
      const tgt = ids.slice(s + 1, s + ctx + 1);
      bl += model.forward(toks, tgt);
      const V = model.V;
      for (let t = 0; t < ctx; t++) {
        let best = 0, bv = -Infinity;
        for (let j = 0; j < V; j++) { const v = model.w.logits[t * V + j]; if (v > bv) { bv = v; best = j; } }
        if (best === tgt[t]) correct++;
        total++;
      }
    }
    loss += bl / n;
  }
  const L = loss / Math.ceil(nWin / batch);
  return { loss: L, ppl: Math.exp(L), acc: correct / total, windows: nWin };
}

/** 字符级 bigram 基线：给出"只看前一个字"的困惑度与准确率，用来判断模型是否真的学到了东西 */
export function bigramBaseline(trainIds, testIds, vocab) {
  const V = vocab;
  const counts = new Float64Array(V * V);
  for (let i = 0; i + 1 < trainIds.length; i++) counts[trainIds[i] * V + trainIds[i + 1]] += 1;
  const rowSum = new Float64Array(V);
  for (let a = 0; a < V; a++) { let s = 0; for (let b = 0; b < V; b++) s += counts[a * V + b]; rowSum[a] = s; }
  let loss = 0, correct = 0, total = 0;
  for (let i = 0; i + 1 < testIds.length; i++) {
    const a = testIds[i], b = testIds[i + 1];
    const denom = rowSum[a] + V * 0.1;             // +0.1 拉普拉斯平滑
    const p = (counts[a * V + b] + 0.1) / denom;
    loss += -Math.log(p);
    let best = 0, bestP = -1;
    for (let c = 0; c < V; c++) { const pc = (counts[a * V + c] + 0.1) / denom; if (pc > bestP) { bestP = pc; best = c; } }
    if (best === b) correct++;
    total++;
  }
  const L = loss / total;
  return { loss: L, ppl: Math.exp(L), acc: correct / total };
}
