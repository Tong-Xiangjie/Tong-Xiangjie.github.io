
function mulberry32(seed) {
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
function cleanText(raw) {
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

function sampleFromLogits(logits, cfg) {
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
function bannedByNgram(seq, n) {
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


const ADAM_BETA1 = 0.9, ADAM_BETA2 = 0.999, ADAM_EPS = 1e-8;

class TinyTransformer {
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


function evaluate(model, ids, ctx, opts = {}) {
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
function bigramBaseline(trainIds, testIds, vocab) {
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


/* ============================ 词表 ============================ */
/* ======================= 词表：字符级 + 字频过滤 =======================
 * 与 v2 演示页共用同一份实现（Node 试验脚本也 import 它，避免两边算法走样）。
 * 切分按"字符预算"而不是"段落个数"：段落长短差别很大，
 * 按个数切会让验证集只有几百字，指标噪声大到没法看。
 */

function buildCharVocab(text, { minFreq = 2, valRatio = 0.15, seed = 1234 } = {}) {
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
function encodeWithCharMap(text, vocab) {
  const map = vocab.charMap;
  return [...cleanText(text)].map((c) => (map.has(c) ? map.get(c) : vocab.strs.length - 1));
}


/* ============================ 存档 ============================ */
/* 模型存档：把 TinyTransformer 的权重 + Adam 状态打包成一个自包含的字符串。
 *
 * 设计要点：
 *  - 只存"数字"，不存代码。存档里带上 shape 和词表，读档时先校验形状再灌权重，
 *    形状不符直接报错——安静地读进一个尺寸不对的模型，比报错危险得多。
 *  - 权重先量化成 float32 字节，再 gzip 压缩，最后 base64。
 *    实测 D=32/L=2/H=4/ctx=32/V=1233 的模型约 67k 参数：
 *    纯 JSON 约 1.4MB，字节+gzip+base64 约 200KB，能塞进 localStorage。
 *  - gzip 用平台自带实现：浏览器 DecompressionStream / Node zlib，
 *    都不需要第三方库，file:// 下也能用。
 */

const MAGIC = 'TXJLLM2';
const VERSION = 1;
const STORE_KEY = 'txj-llm-v2-checkpoint';

/* ---------------- base64 ---------------- */

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64LOOKUP = (() => { const t = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) t[B64CHARS.charCodeAt(i)] = i; return t; })();

function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + B64CHARS[(n >> 6) & 63] + B64CHARS[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + B64CHARS[(n >> 6) & 63] + '=';
  }
  return out;
}

function base64ToBytes(str) {
  const clean = String(str).replace(/[\s=]/g, '');
  const n = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(n);
  let p = 0, acc = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64LOOKUP[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[p++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, p);
}

/* ---------------- gzip：浏览器与 Node 各走一条路 ---------------- */

const hasWebStreams = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function gzip(bytes) {
  if (hasWebStreams) {
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(await promisify(zlib.gzip)(Buffer.from(bytes)));
}

async function gunzip(bytes) {
  if (hasWebStreams) {
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(await promisify(zlib.gunzip)(Buffer.from(bytes)));
}

/* ---------------- 权重 <-> 字节 ---------------- */

/** 把 saveState() 的结果编码成紧凑字节流：头部 JSON + 各块的 float32 原始字节 */
function packState(state) {
  const enc = new TextEncoder();
  const chunks = [];
  const blocks = [];
  const add = (prefix, name, data) => {
    blocks.push([prefix + name, data.length]);
    chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  };
  for (const { name, data } of state.params) add('p:', name, data);
  if (state.adam && state.adam.entries) for (const [name, data] of state.adam.entries) add('a:', name, data);
  const meta = JSON.stringify({
    v: VERSION, shape: state.shape, step: state.step,
    adamStep: state.adam ? state.adam.step : 0,
    blocks,
  });
  const metaBytes = enc.encode(meta);
  const metaLen = new Uint8Array(4);
  new DataView(metaLen.buffer).setUint32(0, metaBytes.length, true);
  const total = 4 + metaBytes.length + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  out.set(metaLen, off); off += 4;
  out.set(metaBytes, off); off += metaBytes.length;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function unpackState(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen)));
  if (meta.v !== VERSION) throw new Error(`存档版本 ${meta.v} 与当前代码 ${VERSION} 不符`);
  let off = 4 + metaLen;
  const params = [], adamEntries = [];
  for (const [name, len] of meta.blocks) {
    // 逐元素读，不依赖内存对齐：gzip 解出来的 buffer 起点不保证 4 字节对齐
    const copy = new Float32Array(len);
    for (let i = 0; i < len; i++) copy[i] = dv.getFloat32(off + i * 4, true);
    off += len * 4;
    if (name.startsWith('p:')) params.push({ name: name.slice(2), data: copy });
    else adamEntries.push([name.slice(2), copy]);
  }
  return {
    shape: meta.shape, step: meta.step,
    params,
    adam: meta.adamStep ? { step: meta.adamStep, entries: adamEntries } : null,
  };
}

/* ---------------- 对外接口 ---------------- */

/** 词表指纹：不存整份词表，只存一个哈希，够用来判断"是不是同一份语料" */
function vocabFingerprint(strs) {
  let h = 0x811c9dc5;
  const s = strs.join('\u0001');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return { n: strs.length, x: (h >>> 0).toString(16), sample: strs.slice(0, 8).join('') };
}

/**
 * 把模型打包成字符串。
 * @param {object} model TinyTransformer 实例
 * @param {object} meta 额外元数据（语料指纹、训练步数、时间等），读档时会校验
 */
async function encodeCheckpoint(model, meta = {}) {
  const packed = packState(model.saveState());
  const gz = await gzip(packed);
  const header = JSON.stringify({ m: MAGIC, v: VERSION, meta, raw: packed.length, gz: gz.length });
  const headerB64 = bytesToBase64(new TextEncoder().encode(header));
  return `${MAGIC}.${headerB64}.${bytesToBase64(gz)}`;
}

/** 解析字符串，返回 { state, meta, bytes } */
async function decodeCheckpoint(str) {
  const s = String(str).trim();
  const first = s.indexOf('.');
  const second = s.indexOf('.', first + 1);
  if (first < 0 || second < 0 || s.slice(0, first) !== MAGIC) throw new Error('不是本页导出的存档');
  const header = JSON.parse(new TextDecoder().decode(base64ToBytes(s.slice(first + 1, second))));
  const gz = base64ToBytes(s.slice(second + 1));
  const packed = await gunzip(gz);
  return { state: unpackState(packed), meta: header.meta || {}, bytes: packed.length };
}

/** 读档到已有模型（形状与词表必须一致），返回元数据 */
async function loadInto(model, str) {
  const { state, meta } = await decodeCheckpoint(str);
  checkVocab(meta);
  model.loadState(state);
  return meta;
}

/** 按存档形状新建模型并读档 */
async function modelFromCheckpoint(str) {
  const { state, meta } = await decodeCheckpoint(str);
  checkVocab(meta);
  const m = new TinyTransformer({ ...state.shape, seed: 1 });
  m.loadState(state);
  return { model: m, meta };
}

/**
 * 词表校验：id 只在同一份词表下才有意义。
 * 语料变了导致词表错位却照样把权重读进去，模型会输出完全无意义的字，
 * 而且不报任何错 —— 所以这里必须硬性拦住。
 */
function checkVocab(meta, expected) {
  if (!meta || !meta.vocabHead) return;
  if (expected && expected.x !== undefined && meta.vocabHead.x !== expected.x) {
    throw new Error(`存档的词表与当前语料不一致（存档 ${meta.vocabHead.n} 字 / 当前 ${expected.x} 字符，指纹 ${meta.vocabHead.x} vs ${expected.x}）。请用同一份语料。`);
  }
}

/* ---------------- 浏览器 localStorage ---------------- */

function hasStorage() {
  try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
}

function saveToStorage(str, key = STORE_KEY) {
  if (!hasStorage()) throw new Error('当前环境不支持 localStorage（file:// 下某些浏览器会禁用）');
  try {
    localStorage.setItem(key, str);
  } catch (e) {
    throw new Error(`浏览器存储写入失败（可能超出配额，存档约 ${(str.length / 1024).toFixed(0)}KB）：${e.message}`);
  }
  return str.length;
}

function loadFromStorage(key = STORE_KEY) {
  if (!hasStorage()) return null;
  return localStorage.getItem(key);
}

function clearStorage(key = STORE_KEY) {
  if (hasStorage()) localStorage.removeItem(key);
}

function storageInfo(key = STORE_KEY) {
  const s = loadFromStorage(key);
  return s ? { bytes: s.length, meta: null } : null;
}

/** 浏览器里触发下载 */
function downloadCheckpoint(str, filename) {
  const blob = new Blob([str], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || `txj-llm-${Date.now()}.ckpt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 浏览器里弹出文件选择，返回文件内容 */
function pickCheckpointFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.ckpt,.txt,text/plain';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { resolve(null); return; }
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsText(f);
    };
    inp.click();
  });
}


/* ============================ 语料 ============================ */
const CORPUS = `人之初性本善性相近习相远苟不教性乃迁教之道贵以专昔孟母择邻处子不学断机杼窦燕山有义方教五子名俱扬养不教父之过教不严师之惰子不学非所宜幼不学老何为玉不琢不成器人不学不知义为人子方少时亲师友习礼仪香九龄能温席孝于亲所当执融四岁能让梨弟于长宜先知首孝弟次见闻知某数识某文一而十十而百百而千千而万三才者天地人三光者日月星三纲者君臣义父子亲夫妇顺曰春夏曰秋冬此四时运不穷曰南北曰西东此四方应乎中曰水火木金土此五行本乎数曰仁义礼智信此五常不容紊稻粱菽麦黍稷此六谷人所食马牛羊鸡犬豕此六畜人所饲曰喜怒曰哀惧爱恶欲七情具匏土革木石金丝与竹乃八音高曾祖父而身身而子子而孙自子孙至玄曾乃九族人之伦父子恩夫妇从兄则友弟则恭长幼序友与朋君则敬臣则忠此十义人所同凡训蒙须讲究详训诂明句读为学者必有初小学终至四书论语者二十篇群弟子记善言孟子者七篇止讲道德说仁义作中庸子思笔中不偏庸不易作大学乃曾子自修齐至平治孝经通四书熟如六经始可读诗书易礼春秋号六经当讲求有连山有归藏有周易三易详有典谟有训诰有誓命书之奥我周公作周礼著六官存治体大小戴注礼记述圣言礼乐备曰国风曰雅颂号四诗当讽咏诗既亡春秋作寓褒贬别善恶三传者有公羊有左氏有谷梁经既明方读子撮其要记其事五子者有荀扬文中子及老庄经子通读诸史考世系知终始自羲农至黄帝号三皇居上世唐有虞号二帝相揖逊称盛世夏有禹商有汤周文武称三王夏传子家天下四百载迁夏社汤伐夏国号商六百载至纣亡周武王始诛纣八百载最长久周辙东王纲坠逞干戈尚游说始春秋终战国五霸强七雄出嬴秦氏始兼并传二世楚汉争高祖兴汉业建至孝平王莽篡光武兴为东汉四百年终于献魏蜀吴争汉鼎号三国迄两晋宋齐继梁陈承为南朝都金陵北元魏分东西宇文周与高齐迨至隋一土宇不再传失统绪唐高祖起义师除隋乱创国基二十传三百载梁灭之国乃改梁唐晋及汉周称五代皆有由炎宋兴受周禅十八传南北混辽与金帝号纷迨灭辽宋犹存至元兴金绪歇有宋世一同灭并中国兼戎狄明太祖久亲师传建文方四祀迁北京永乐嗣迨崇祯煤山逝清太祖膺景命靖四方克大定由康雍历乾嘉民安富治绩夸道咸间变乱起始英法扰都鄙同光后宣统弱传九帝满清殁革命兴废帝制立宪法建民国古今史全在兹载治乱知兴衰史虽繁读有次史记一汉书二后汉三国志四兼证经参通鉴读史者考实录通古今若亲目口而诵心而惟朝于斯夕于斯昔仲尼师项橐古圣贤尚勤学赵中令读鲁论彼既仕学且勤披蒲编削竹简彼无书且知勉头悬梁锥刺股彼不教自勤苦如囊萤如映雪家虽贫学不辍如负薪如挂角身虽劳犹苦卓苏老泉二十七始发愤读书籍彼既老犹悔迟尔小生宜早思若梁灏八十二对大廷魁多士彼既成众称异尔小生宜立志莹八岁能咏诗泌七岁能赋棋彼颖悟人称奇尔幼学当效之蔡文姬能辨琴谢道韫能咏吟彼女子且聪敏尔男子当自警唐刘晏方七岁举神童作正字彼虽幼身已仕尔幼学勉而致有为者亦若是犬守夜鸡司晨苟不学曷为人蚕吐丝蜂酿蜜人不学不如物幼而学壮而行上致君下泽民扬名声显父母光于前裕于后

天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩一体率宾归王鸣凤在竹白驹食场化被草木赖及万方盖此身发四大五常恭惟鞠养岂敢毁伤女慕贞洁男效才良知过必改得能莫忘罔谈彼短靡恃己长信使可覆器欲难量墨悲丝染诗赞羔羊景行维贤克念作圣德建名立形端表正空谷传声虚堂习听祸因恶积福缘善庆尺璧非宝寸阴是竞资父事君曰严与敬孝当竭力忠则尽命临深履薄夙兴温凊似兰斯馨如松之盛川流不息渊澄取映容止若思言辞安定笃初诚美慎终宜令荣业所基籍甚无竟学优登仕摄职从政存以甘棠去而益咏乐殊贵贱礼别尊卑上和下睦夫唱妇随外受傅训入奉母仪诸姑伯叔犹子比儿孔怀兄弟同气连枝交友投分切磨箴规仁慈隐恻造次弗离节义廉退颠沛匪亏性静情逸心动神疲守真志满逐物意移坚持雅操好爵自縻

松下问童子言师采药去只在此山中云深不知处
白日依山尽黄河入海流欲穷千里目更上一层楼
春眠不觉晓处处闻啼鸟夜来风雨声花落知多少
锄禾日当午汗滴禾下土谁知盘中餐粒粒皆辛苦
墙角数枝梅凌寒独自开遥知不是雪为有暗香来这是一份用来训练语言模型的普通中文语料。好的语料应该包含重复出现的常用词，也应该包含各种各样的句式。语言模型做的事情其实很简单：给定前面的文字，预测下一个字最可能是什么。为了把这个任务做好，模型必须学会字与字之间的搭配规律，例如某个字后面常常跟着哪些字，某个词通常出现在什么样的句子里。训练的过程就是不断调整参数的过程。一开始模型什么都不会，它输出的概率几乎是平均的；随着训练步数增加，它逐渐发现文字里的规律，于是预测得越来越准。判断模型有没有变聪明，不能只看它能不能背诵训练过的句子，还要看它在没有见过的句子上预测得准不准。因此我们通常把数据分成训练集和验证集：训练集用来更新参数，验证集只用来衡量效果。直觉告诉我们，一个只会记住训练句子的模型并不聪明，它只是记性好。真正有用的模型应该学会可以推广的规律，这样遇到新的开头时才能写出通顺的后续。采样方法也很关键。如果我们每次都选概率最大的那个字，生成的文字会很快陷入循环，读起来非常死板。如果我们按概率随机抽取，文字会变得更活泼，但是温度太高就会出现乱码。常见的折中办法是先按温度缩放概率，再只保留概率最高的若干个候选，然后按它们的相对概率抽取。另一个实用技巧是重复惩罚：当某个字刚刚出现过，就适当降低它再次出现的概率，这样可以避免模型一直重复同一句话。

今天是个好天气，阳光很暖和，风也不大。早上我起得比平时早一点，先去楼下的小店吃了一碗热汤面，然后沿着河边慢慢走了一圈。河边的柳树已经长出新叶子，几位老人在树下聊天，还有人在空地上打太极。我想起小的时候，外婆也常常带我来这里散步，她会指着水面告诉我哪一只鸭子游得最快。那时候我觉得时间过得很慢，一个下午可以很长很长，长到足够把整条河都走完。现在每天都很忙，能这样安静地走一走，已经是一件难得的事情。

学习和工作其实很像走路。走得快不一定走得远，走得慢也不一定走不到。重要的是方向不要错，并且每天都往前走一点。有时候我们会遇到很难的问题，想了很久也想不出来，心里就会着急，甚至想干脆放弃。可是等过了一两天，换一个角度再看，问题往往没有那么可怕。所以遇到困难的时候，不妨先放一放，去散散步，去睡一觉，或者找朋友聊一聊。很多时候，答案不是被硬想出来的，而是在放松的时候自己冒出来的。

我喜欢在晚上读书。房间里只开一盏小灯，桌上放一杯温水，窗外偶尔有车经过的声音。书里的世界和外面的世界不太一样，它安静，缓慢，却很有力量。读到好的句子，我会用铅笔画一条线，等到很久以后再翻回来，看见那条线，就会想起当时的心情。有人问我读书有什么用，我想了很久，觉得最简单的回答是：它让我知道，原来别人也有过和我一样的困惑。知道自己不是孤单的，这本身就是一件好事。

春天的时候，田里的油菜花开了，一大片一大片的黄色，远远看过去像是铺了一层毯子。夏天很热，中午的太阳晒得地面发烫，知了在树上叫个不停，孩子们却还是喜欢跑到外面去玩水。秋天最舒服，天很高，云很淡，风里带着一点点凉意，路边的柿子红得像小灯笼。冬天到来的时候，早上出门会看见草叶上结了一层白霜，呼吸的时候能看见白气，大家穿得圆圆的，走起路来慢吞吞的。一年又一年，四季就这样转过来，转过去，从不着急。

做菜是一件很有意思的事情。同样的材料，火候不同，味道就完全不同。火太大了容易糊，火太小了又煮不烂。放盐也是一样，早放和晚放，尝起来并不一样。我刚开始学做饭的时候，总是很着急，恨不得所有东西一次就做好，结果不是忘了放盐，就是把菜炒得太老。后来慢慢明白，做饭需要耐心，也需要专心，手上在做的时候，心里就只想这一件事。等一桌菜端上来，看见家人吃得开心，那种满足感比什么都实在。

朋友之间最好的相处方式，是不必刻意讨好，也不用时时联系。很久不见，坐下来还能接着上次的话往下说，这就够了。真正的朋友会在你得意的时候提醒你，也会在你难过的时候陪着你。他们不一定说很多好听的话，但你知道，只要开口，他们一定在。人这一生认识的人很多，能成为朋友的却很少，所以遇到了就要好好珍惜。

我常常在想，语言模型到底是什么。它没有感觉，也没有经历，它只是在大量的文字里统计规律，然后根据前面的内容猜下一个字。可是当它猜得足够准的时候，写出来的句子竟然很像人写的。这让人有点惊讶，也让人有点不安。也许智能并不像我们想象的那样神秘，它只是把无数简单的规律叠加起来，最后变成了一种看起来复杂的能力。当然，这只是我的猜测，真正的问题，还要留给以后的人去回答。

写代码的时候，最重要的不是写得快，而是写得清楚。一段清楚的代码，别人看得懂，过半年自己也看得懂。如果只为了省几个字，把变量名起得又短又乱，当时也许很痛快，以后改起来就会很痛苦。同样重要的是测试：写完一段逻辑，要找几个例子跑一跑，看看结果对不对，边界情况会不会出错。慢一点没有关系，错了再改也没有关系，最怕的是自己以为对了，其实一直错着。

小镇的早晨来得早。五点多钟，卖豆浆的摊子就支起来了，白色的热气从锅里升上来，混着油条的香味。骑自行车的人从石板路上经过，车铃响得清脆。卖菜的老太太把青菜摆得整整齐齐，叶子上还带着露水。等到太阳升高，街上的声音就多起来，说话声，笑声，还有小孩子追跑打闹的声音。这样的日子看起来平淡，却让人觉得踏实。人在这样的地方住久了，会慢慢变得不急不躁，愿意把一件事认真做好。

关于未来，我并没有特别具体的计划。我希望自己能一直保持学习的状态，对新的东西保持好奇，遇到不懂的事情愿意去问、去查、去试一试。我也希望自己能照顾好身体，早睡早起，少吃一点油腻的东西，多走一点路。我还希望能和喜欢的人在一起，做喜欢的事情，哪怕这件事很小，很普通，只要是自己真心想做的，就值得。至于更远的事情，想不清就不要硬想了，一步一步走过去，总会看到路的。道可道非常道名可名非常名无名天地之始有名万物之母故常无欲以观其妙常有欲以观其徼此两者同出而异名同谓之玄玄之又玄众妙之门
天下皆知美之为美斯恶已皆知善之为善斯不善已故有无相生难易相成长短相较高下相倾音声相和前后相随
上善若水水善利万物而不争处众人之所恶故几于道居善地心善渊与善仁言善信政善治事善能动善时夫唯不争故无尤
持而盈之不如其已揣而锐之不可长保金玉满堂莫之能守富贵而骄自遗其咎功遂身退天之道也
曲则全枉则直洼则盈敝则新少则得多则惑是以圣人抱一为天下式
知人者智自知者明胜人者有力自胜者强知足者富强行者有志不失其所者久死而不亡者寿
合抱之木生于毫末九层之台起于累土千里之行始于足下
学而时习之不亦说乎有朋自远方来不亦乐乎人不知而不愠不亦君子乎
吾日三省吾身为谋而不忠乎与朋友交而不信乎传不习乎
温故而知新可以为师矣学而不思则罔思而不学则殆知之为知之不知为不知是知也
三人行必有我师焉择其善者而从之其不善者而改之
岁寒然后知松柏之后凋也己所不欲勿施于人德不孤必有邻
天时不如地利地利不如人和得道者多助失道者寡助
生于忧患死于安乐富贵不能淫贫贱不能移威武不能屈此之谓大丈夫
锲而舍之朽木不折锲而不舍金石可镂不积跬步无以至千里不积小流无以成江海
北国风光千里冰封万里雪飘望长城内外惟余莽莽大河上下顿失滔滔山舞银蛇原驰蜡象欲与天公试比高须晴日看红装素裹分外妖娆
君不见黄河之水天上来奔流到海不复回君不见高堂明镜悲白发朝如青丝暮成雪人生得意须尽欢莫使金樽空对月天生我材必有用千金散尽还复来
床前明月光疑是地上霜举头望明月低头思故乡
国破山河在城春草木深感时花溅泪恨别鸟惊心烽火连三月家书抵万金白头搔更短浑欲不胜簪
月落乌啼霜满天江枫渔火对愁眠姑苏城外寒山寺夜半钟声到客船
好雨知时节当春乃发生随风潜入夜润物细无声野径云俱黑江船火独明晓看红湿处花重锦官城
空山不见人但闻人语响返景入深林复照青苔上
两个黄鹂鸣翠柳一行白鹭上青天窗含西岭千秋雪门泊东吴万里船
去年今日此门中人面桃花相映红人面不知何处去桃花依旧笑春风
千山鸟飞绝万径人踪灭孤舟蓑笠翁独钓寒江雪
明月几时有把酒问青天不知天上宫阙今夕是何年人有悲欢离合月有阴晴圆缺此事古难全但愿人长久千里共婵娟
大江东去浪淘尽千古风流人物故垒西边人道是三国周郎赤壁乱石穿空惊涛拍岸卷起千堆雪江山如画一时多少豪杰
醉里挑灯看剑梦回吹角连营八百里分麾下炙五十弦翻塞外声沙场秋点兵
先天下之忧而忧后天下之乐而乐不以物喜不以己悲居庙堂之高则忧其民处江湖之远则忧其君
山不在高有仙则名水不在深有龙则灵斯是陋室惟吾德馨苔痕上阶绿草色入帘青谈笑有鸿儒往来无白丁
予独爱莲之出淤泥而不染濯清涟而不妖中通外直不蔓不枝香远益清亭亭净植可远观而不可亵玩焉
庭院深深深几许云窗雾阁春迟为谁憔悴损芳姿夜来清梦好应是发南枝
大漠孤烟直长河落日圆萧关逢候骑都护在燕然写程序这件事，入门容易，写好很难。入门的时候，我们学的是语法：变量怎么定义，循环怎么写，函数怎么调用。等这些都会了，会发现自己写出来的代码虽然能跑，却很难改。原因通常不在语法，而在结构。结构好的代码，每一部分只做一件事，名字起得清楚，输入输出都很明确。这样的代码半年以后再看，还能很快读懂；结构差的代码，当时省了几分钟，以后要多花几个小时。所以写代码的时候，宁可想清楚再动手，也不要一边写一边改主意。

调试是另一种能力。程序出错的时候，人的第一反应往往是猜：是不是这里？是不是那里？猜对了当然好，猜错了就白花时间。更可靠的做法是先想办法看到事实。把关键的值打印出来，把中间结果记下来，把问题缩小到一个最小的例子，再一行一行地看。很多看起来莫名其妙的错误，真正的原因只有一两处，只是被别的东西遮住了。找到它，剩下的问题就自然解决了。这也是为什么测试那么重要：测试不是为了证明代码对，而是为了在出错的时候，能快速知道错在哪里。

关于学习方法，我有一点体会。看别人写好的代码当然有用，但是只看不动手，很容易产生已经学会了的错觉。真正让人进步的，是自己动手写一遍，然后在出错、查找、修改的过程中，把那些含糊的地方彻底弄清楚。遇到不理解的地方，不要急着跳过，多问一句为什么，往往能省下后面几个小时的时间。还有一点同样重要：把学到的东西讲给别人听，或者写成文字。讲不清楚的地方，通常就是自己还没有真正弄明白的地方。

天气和季节的变化，也可以当成一种提醒。早晨的雾会在太阳升起来以后散掉，傍晚的云会被风吹成一条一条的形状。下雨之前，空气里有一种特别的味道，蜻蜓会飞得很低。老人常说，燕子低飞要下雨，蚂蚁搬家要下雨，这些经验未必完全准确，却是一代一代观察积累下来的。我们现在有了天气预报，可以看卫星云图，可以算数值模式，但抬头看看天，感受一下风的方向，仍然是一件有趣的事情。

城市的生活节奏很快。地铁里的人都低着头看手机，红绿灯一变，人群就一起往前走。写字楼的灯常常亮到很晚，外卖箱在后座上晃来晃去。有人说这样的生活太累，也有人说这样的生活才有意思。其实每个人都在找自己的平衡点：既想做出一点成绩，又想留一点时间给自己。有人选择早起，把最清醒的两个小时留给自己喜欢的事情；有人选择晚睡，在夜里安静地读几页书。方式不同，重要的是别把自己弄丢了。

旅行的意义大概不在于走了多远，而在于看见了不一样的生活。在江南的小镇上，你会看到有人清早在河边洗菜；在西北的戈壁上，你会看到风把沙吹成一道道波纹；在海边的小城，你会看到渔船在傍晚一起回港，船上的灯一盏一盏亮起来。这些场景没有什么特别，却会让人忽然意识到，世界很大，自己的烦恼很小。回来以后，日子照旧，但心里好像宽了一点。

读书的时候，我习惯在旁边放一支笔。遇到想不通的段落，就画一个问号；遇到喜欢的句子，就画一条线。过一段时间再翻回来看，那些问号有些已经不成问题了，因为中间又读了别的书，把缺口补上了。这个过程让我明白，理解不是一次完成的，它需要时间去发酵。所以遇到暂时看不懂的东西，不必太着急，先把它放在心里，过些日子再回来，往往会有新的收获。

人与人之间的沟通，最怕的不是意见不同，而是各说各话。有效的沟通需要先把对方的话听完整，确认自己理解的和对方想说的是同一件事，然后再表达自己的看法。表达的时候，具体比笼统好，讲事实比下判断好。比如说，与其说这个方案不行，不如说这个方案在成本上超出了预算，在时间上也来不及，我们可以考虑换一种做法。这样的说法不容易引起对立，也更容易找到解决的办法。

做饭是一件很有意思的事情。同样的材料，火候不同，味道就完全不同。火太大了容易糊，火太小了又煮不烂。放盐也是这样，早放和晚放，尝起来并不一样。我刚开始学做饭的时候，总是很着急，恨不得所有东西一次就做好，结果不是忘了放盐，就是把菜炒得太老。后来慢慢明白，做饭需要耐心，也需要专心，手上在做的时候，心里就只想这一件事。等一桌菜端上来，看见家人吃得开心，那种满足感比什么都实在。

朋友之间最好的相处方式，是不必刻意讨好，也不用时时联系。很久不见，坐下来还能接着上次的话往下说，这就够了。真正的朋友会在你得意的时候提醒你，也会在你难过的时候陪着你。他们不一定说很多好听的话，但你知道，只要开口，他们一定在。人这一生认识的人很多，能成为朋友的却很少，所以遇到了就要好好珍惜。

小时候我住在一条很老的巷子里。巷子不宽，两边是灰瓦的房子，墙根长着青苔。中午的时候，阳光从屋檐之间斜斜地照下来，把地面切成一条亮一条暗。放学的路上，我常常一边走一边数地上的砖，数着数着就到家了。巷口有一个修鞋的老师傅，他手里总是拿着一根锥子和一团线，低着头做活，很少说话。有一次我的鞋带断了，他帮我缝好，还教我打了一个更结实的结。很多年以后我路过那条巷子，房子已经拆了，巷子也没有了，但那个结我还记得。

关于未来，我并没有特别具体的计划。我希望自己能一直保持学习的状态，对新的东西保持好奇，遇到不懂的事情愿意去问、去查、去试一试。我也希望自己能照顾好身体，早睡早起，少吃一点油腻的东西，多走一点路。我还希望能和喜欢的人在一起，做喜欢的事情，哪怕这件事很小，很普通，只要是自己真心想做的，就值得。至于更远的事情，想不清就不要硬想了，一步一步走过去，总会看到路的。

写到这里，我想起一个很简单的道理：任何复杂的东西，拆开来看都不复杂。一句话可以拆成词，一个词可以拆成字，一个字可以拆成笔画。一个程序可以拆成函数，一个函数可以拆成语句，一个语句可以拆成表达式。一段音乐可以拆成小节，一个小节可以拆成音符。我们觉得难，往往是因为一次想抓住太多东西。把问题拆小，一件一件地解决，再大的事情也会变得可以下手。做菜是这样，写代码是这样，读书也是这样。语言模型的训练过程可以分成几个步骤。第一步是把文字转换成数字。计算机不认识汉字，只认识数字，所以我们先要建立一张对照表，把每一个字或者每一个常见的字组映射成一个编号。第二步是把长文本切成一段一段的窗口，每个窗口包含固定数量的字，模型看到前面的一部分，就要预测紧接着的下一部分。第三步是计算损失。损失衡量的是模型给出的概率和真实答案之间的差距，差距越小说明预测越准。第四步是反向传播，也就是把损失一点点地传回每一个参数，告诉它们应该往哪个方向调整。第五步是更新参数，常用的方法是梯度下降，改进版本叫自适应矩估计。这五步反复进行几万次，模型的预测能力就会慢慢提高。

需要注意的是，训练集上的表现变好，并不等于模型真的变聪明了。如果模型参数很多而数据很少，它完全可以靠死记硬背把训练集上的损失压得很低，但是一遇到没见过的句子就原形毕露。这种现象叫作过拟合。判断有没有过拟合，最简单的办法就是把数据分成两份：一份用来训练，一份只用来检查。如果训练损失一直下降而验证损失开始上升，那就说明过拟合已经发生了。这时候可以考虑减小模型、增加数据、或者加上一些约束，比如权重衰减和随机失活。

中文和英文有一个明显的区别。英文的单词之间用空格分开，所以一个词天然就是一个单位。中文的句子是连续的，没有空格，因此中文模型通常以字为单位，或者先用一套合并规则把常见的字组变成一个更大的单位。这套合并规则来自一个简单的想法：先统计相邻两个字一起出现的次数，把出现最多的一对合并成一个新的单位，然后重复这个过程。这样做的好处是常见的词会很快变成单个单位，句子需要的步数就减少了，模型也更容易学到长距离的关系。

注意力机制是近年来最重要的想法之一。它的核心问题是：当模型要预测下一个字的时候，它应该重点参考前面的哪些字。做法是给每个位置算出一个查询向量，再给前面每个位置算出一个键向量，把两者做点积，得到的分数越高说明关系越紧密。把这些分数归一化成权重，然后用它们把前面各个位置的值向量加权求和，就得到了这一位置需要的信息。因为每个位置都要看前面所有位置，所以这种机制很善于捕捉远距离的联系。为了防止模型看到未来的内容，计算时要把当前位置之后的分数设成很小的数，这样它们的权重就接近于零。

为什么要把很多层叠起来？因为一层能做的事情有限。底层可能只学会了相邻字的搭配，中间层开始学会词和短语，越往上越能把握整句甚至整段的意思。每一层都包含两个主要部分：一个是注意力，负责在位置之间传递信息；另一个是前馈网络，负责对每个位置单独做一次变换。两个部分外面都套上残差连接和层归一化，前者让梯度更容易传下去，后者让数值保持稳定。没有这两样东西，深层网络会很难训练。

采样的时候温度是一个很重要的参数。温度越低，概率分布越尖锐，模型越倾向于选择最可能的那个字，生成的结果稳定但容易重复。温度越高，分布越平缓，冷门字也有机会被选中，结果更多样但容易跑偏。除了温度，还有两个常用的办法。一个是只保留概率最高的前若干个候选，叫作截断采样；另一个是只保留累计概率达到某个阈值之前的候选，叫作核采样。把这两种办法和温度结合起来，通常能取得比较自然的效果。此外还可以加一点重复惩罚，降低刚刚出现过的字的概率，避免生成的内容原地打转。

评价一个语言模型，通常用困惑度这个指标。困惑度的定义是交叉熵的指数。直观地理解，困惑度可以看作模型在每一步平均要在多少个候选之间犹豫。如果困惑度等于词表大小，说明模型的预测和瞎猜没有区别。如果困惑度降到了词表大小的十分之一，说明模型已经学到了不少规律。除了困惑度，还可以看下一个字的预测准确率，也就是模型给出的最高概率候选正好等于正确答案的比例。为了让数字有意义，这些指标必须在验证集上计算，而且要和一个简单的基线比较。最简单的基线是二元模型：它只统计前一个字后面跟哪个字最多，其他什么都不看。如果精心设计的模型连这个基线都赢不了，那就说明设计或者训练出了问题。

写程序的时候，调试是最花时间的部分。有一种特别难查的错误叫缓冲区混用：两个中间结果不小心用了同一块内存，于是后写入的覆盖了先写入的，计算结果看起来完全正常，梯度却是错的。还有一种错误来自共享状态：一个临时变量被多处复用，最后一次写入决定了它的值，但每一处使用的人都以为它是自己那次的。这类错误不会报错，只会让训练效果莫名其妙地变差。可靠的排查办法是有限差分检验：把某个参数稍微加一点，算一次损失；再稍微减一点，也算一次损失；两者的差除以两倍的增量，就是数值梯度。把数值梯度和反向传播算出来的梯度逐一比较，如果对不上，就说明反向传播有错。这个方法简单但非常有效，几乎所有深度学习框架都会自带这套检验。

关于学习方法，我有一点体会。看别人写好的代码当然有用，但是只看不动手，很容易产生已经学会了的错觉。真正让人进步的，是自己动手写一遍，然后在出错、查找、修改的过程中，把那些含糊的地方彻底弄清楚。遇到不理解的地方，不要急着跳过，多问一句为什么，往往能省下后面几个小时的时间。还有一点同样重要：把学到的东西讲给别人听，或者写成文字。讲不清楚的地方，通常就是自己还没有真正弄明白的地方。

天气和季节的变化，也可以当成一种提醒。早晨的雾会在太阳升起来以后散掉，傍晚的云会被风吹成一条一条的形状。下雨之前，空气里有一种特别的味道，蜻蜓会飞得很低。老人常说，燕子低飞要下雨，蚂蚁搬家要下雨，这些经验未必完全准确，却是一代一代观察积累下来的。我们现在有了天气预报，可以看卫星云图，可以算数值模式，但抬头看看天，感受一下风的方向，仍然是一件有趣的事情。

城市的生活节奏很快。地铁里的人都低着头看手机，红绿灯一变，人群就一起往前走。写字楼的灯常常亮到很晚，外卖箱在后座上晃来晃去。有人说这样的生活太累，也有人说这样的生活才有意思。其实每个人都在找自己的平衡点：既想做出一点成绩，又想留一点时间给自己。有人选择早起，把最清醒的两个小时留给自己喜欢的事情；有人选择晚睡，在夜里安静地读几页书。方式不同，重要的是别把自己弄丢了。

旅行的意义大概不在于走了多远，而在于看见了不一样的生活。在江南的小镇上，你会看到有人清早在河边洗菜；在西北的戈壁上，你会看到风把沙吹成一道道波纹；在海边的小城，你会看到渔船在傍晚一起回港，船上的灯一盏一盏亮起来。这些场景没有什么特别，却会让人忽然意识到，世界很大，自己的烦恼很小。回来以后，日子照旧，但心里好像宽了一点。

读书的时候，我习惯在旁边放一支笔。遇到想不通的段落，就画一个问号；遇到喜欢的句子，就画一条线。过一段时间再翻回来看，那些问号有些已经不成问题了，因为中间又读了别的书，把缺口补上了。这个过程让我明白，理解不是一次完成的，它需要时间去发酵。所以遇到暂时看不懂的东西，不必太着急，先把它放在心里，过些日子再回来，往往会有新的收获。

人与人之间的沟通，最怕的不是意见不同，而是各说各话。有效的沟通需要先把对方的话听完整，确认自己理解的和对方想说的是同一件事，然后再表达自己的看法。表达的时候，具体比笼统好，讲事实比下判断好。比如说，与其说这个方案不行，不如说这个方案在成本上超出了预算，在时间上也来不及，我们可以考虑换一种做法。这样的说法不容易引起对立，也更容易找到解决的办法。阿啊哀挨矮爱碍安岸按案暗昂凹熬袄傲奥八巴扒吧疤拔把坝罢白百柏摆败拜班般斑搬板版办半伴扮拌瓣帮绑榜膀棒傍包胞薄饱宝抱报抱暴爆杯悲碑北贝备背倍被奔本笨崩逼鼻比彼笔币必毕闭庇毙弊碧避壁臂边编扁变便遍辨辩辫标表别宾冰兵丙柄饼并病拨波玻剥播伯驳泊勃博薄补捕不布步部擦猜才材财裁采彩踩菜参餐残蚕惭惨灿仓苍舱藏操槽草册侧测层插查茶察差拆柴产铲颤昌长肠尝偿厂场畅唱抄超朝潮吵炒车扯彻撤尘臣沉陈衬称趁撑成呈承诚城乘惩程橙吃池迟持匙尺齿耻斥赤翅充冲虫崇抽仇绸愁丑臭初出除厨础储处触川穿传船喘串创窗床闯吹垂春纯唇词瓷慈辞此刺次聪从匆葱凑粗促醋窜催脆村存寸措错搭达答打大呆代带待袋贷丹单担耽胆淡蛋当挡党荡刀叨导岛倒到盗道稻得德灯的等低堤滴敌底抵地弟递第颠典点电店垫殿雕吊钓调掉爹跌叠碟丁盯钉顶订定丢东冬懂动冻洞都斗豆逗督毒独读堵赌杜肚度渡端短段断锻堆队对吨蹲顿多夺朵躲俄鹅额恶饿恩儿而耳二发罚阀法帆番翻凡烦繁反返犯饭泛方坊芳防房仿访纺放飞非肥匪肺废沸费分纷坟粉份奋愤丰风封疯峰锋蜂逢讽凤奉佛否夫肤伏扶服浮符幅福抚府俯辅腐父付妇负附复赴副富覆该改概干甘杆赶敢感刚钢岗港高搞稿告哥歌割搁格阁隔个各给根跟更耕工弓公功攻供宫恭巩共贡勾沟钩狗构购够估姑孤古谷股骨鼓固故顾瓜刮挂怪关观官冠馆惯灌贯光广归龟规轨鬼贵桂滚锅国果裹过哈孩海害含寒喊汉汗旱行航毫好号喝合何和河荷核盒贺黑恨恒横衡红宏洪喉猴吼厚后呼忽狐胡湖糊虎互户护花华划画化怀坏欢环还缓换荒慌黄皇灰挥恢辉回悔汇会绘昏婚浑魂混活火伙或货获祸击机肌鸡积基激及吉级极即急疾集几己挤计记纪技际剂季济继寄加夹佳家嘉甲价驾架尖坚间肩艰检简见件建剑健渐键江姜将讲奖降交郊骄胶角脚搅叫轿较教接街节结解姐介戒届界借巾今斤金津仅紧谨进近劲禁京经茎惊晶睛井景警净径竞竟敬静境究九久酒旧救就居局菊举巨拒具俱剧据距聚卷决绝军均君俊卡开凯刊堪看康抗炕考靠科棵颗壳咳可克刻客课肯坑空孔恐控口扣哭苦库裤夸块快宽款狂况亏昆困扩括阔拉啦来兰拦栏蓝览懒烂郎狼廊朗浪劳牢老乐雷累泪类冷厘离梨黎礼李里理力历厉立丽利例栗粒连帘怜莲联脸练炼恋良凉粮两亮谅辆量疗聊料列劣烈裂林临淋灵铃零领令另溜刘流留六龙笼楼漏露炉鲁陆录鹿路乱论罗萝逻落妈麻马码骂埋买麦卖满慢忙猫毛矛貌么没眉梅媒每美妹门闷们蒙梦迷米密蜜眠免勉面苗描秒妙庙灭民敏名明鸣命摸模摩磨末陌莫墨默谋某母亩木目牧墓幕慕拿哪内那纳乃奶耐男南难恼脑闹呢嫩能尼泥你念娘鸟尿您宁凝牛扭农浓弄努怒女暖虐挪欧偶爬怕拍排牌派攀盘判盼旁胖抛跑泡陪培赔佩配喷盆朋棚蓬碰批披皮疲匹屁偏篇骗漂票拼贫品聘平评凭瓶坡泼颇婆迫破剖扑铺朴普谱七妻期欺齐其奇歧骑棋旗乞岂企启起气弃汽契器恰千迁牵铅谦签前钱浅遣欠枪腔强抢悄敲桥巧切茄且窃亲侵勤青轻倾清情晴请庆穷丘秋求球区曲驱屈取娶去全权泉拳劝缺却确群然燃染嚷让饶扰绕惹热人仁认任扔仍日荣容绒如乳入软锐润若弱撒洒塞赛三伞散桑嗓丧扫嫂色森杀沙纱傻晒山删闪扇善伤商赏上尚捎稍烧勺少绍舌蛇舍设社射涉摄申伸身深神审婶甚肾慎升生声牲胜绳省圣盛剩尸失师诗施湿十什石时识实拾蚀食史使始驶士氏示世市式事侍势试视饰室是适逝释收手守首受兽授售瘦书叔殊疏输蔬熟暑属鼠数术束述树竖数刷耍衰摔甩帅双霜爽谁水税睡顺说丝司私思斯撕死四寺似松宋送诵搜艘苏俗诉肃素速宿塑酸算虽随岁碎孙损缩所索锁他她它塌踏台抬太态谈坦叹汤唐堂躺掏逃桃讨套特疼提题体替天田甜填挑条跳贴铁帖厅听庭停挺通同铜童统痛偷头投透突图徒途涂土吐兔团推腿退吞托拖脱驼妥拓挖娃瓦歪外弯完玩顽晚碗万亡王网往忘旺望危威微围唯维伟委卫未位味畏胃喂谓温文闻纹稳问翁窝我握屋无吴五午武舞勿务物误雾西吸希析息牺悉惜稀溪熄膝习席袭洗喜系细戏瞎虾下吓夏仙先纤鲜闲弦显险现限线宪陷献县羡乡相香箱详想响向项象像消销小晓孝效校笑些歇协邪斜鞋写泄谢辛欣新薪信兴星刑形醒幸性姓兄凶胸雄休修羞朽秀袖需虚许序叙畜绪续宣悬选旋削靴学雪血寻巡询循讯迅压呀押鸦牙芽崖哑雅亚烟淹严言岩沿炎研盐颜眼演厌宴验雁燕央扬羊阳洋仰养样邀腰摇遥咬药要耀爷也冶野业叶页夜液一衣医依仪移遗疑已乙以椅义艺忆议亦异役译易疫益意溢毅因阴音银引饮隐印应英迎盈营蝇赢影映硬拥永泳勇涌用优忧尤由邮犹油游友有又右幼诱于余鱼娱渔愉愚与宇羽雨语玉育狱浴预域欲遇御愈誉元员园原圆援源远院愿约月阅越云匀允运晕孕杂灾栽载再在咱暂赞脏遭糟早枣澡灶造噪责则择泽贼怎增憎赠扎杂宅窄债沾粘展占战站张章涨掌丈帐账障招昭找召照遮折哲者这贞针侦珍真诊枕阵振震镇争征挣睁蒸整正证郑政之支只汁芝枝知肢织直值职植殖止旨址纸指至志制治质致秩智置中忠终钟肿种众重舟周州洲粥宙昼皱朱珠株诸猪竹逐主煮嘱住助注驻祝著筑抓专砖转庄装壮状追准捉桌资姿滋子字自宗综总纵走奏租足族祖阻组钻嘴最罪尊遵昨左作坐座做

天天地人日月星辰山川河海风云雷电雨雪霜露春夏秋冬东南西北上下左右前后内外中间大小多少高低长短远近深浅轻重厚薄开关出入来回升降起落增减有无是非对错真假美丑善恶好坏新旧明暗冷暖干湿软硬胖瘦快慢忙闲安危强弱贫富贵贱成败得失利弊取舍进退攻守问答听说读写看走跑跳坐立卧飞游爬滚推拉提放拿给送收接打拍摸揉敲砸捏捧搂抱握抓挠踩踢咬嚼吞咽呼吸笑哭喊叫骂夸赞嫌恨怕爱喜怒哀乐愁思念忘记想猜疑信疑懂知会能可以应该必须可能也许大概一定当然其实本来究竟到底终于已经曾经从来总是偶尔常常往往忽然突然渐渐慢慢快快轻轻重重悄悄默默静静悄悄

学习读书写字听课讲说问答思考汉字词语句子文章段落篇章朗读背诵抄写默写翻译解释分析总结概括归纳演绎推理判断比较分类排序举例证明反驳支持反对同意赞成建议批评表扬鼓励安慰劝告商量讨论争论辩论谈判说服服从拒绝答应允许禁止要求请求命令指示告诉通知报告宣布公布说明介绍描述刻画描写叙述抒情议论说明抒情记叙议论说明描写抒情记叙议论抒情说明描写叙述议论

我们你们他们她们它们咱们大家自己别人人家谁什么哪里怎么样为什么怎么多少几个哪些这些那些这个那个这里那里这时那时因为所以但是可是不过然而因此于是然后接着后来最后首先其次再次另外此外总之例如比如也就是说换句话说也就是说换句话说总的来说简单来说严格来说一般来说事实上实际上基本上总体上具体来说客观地说主观地说
爸爸妈妈哥哥姐姐弟弟妹妹爷爷奶奶外公外婆叔叔阿姨舅舅姑姑表哥表姐堂弟堂妹儿子女儿孙子孙女老师学生同学朋友同事邻居医生护士司机警察工人农民商人士兵学生教师律师工程师程序员工人服务员售货员运动员演员歌手画家作家记者编辑导演摄影师设计师会计经理老板助手同事朋友伙伴队员队员

城市乡村街道马路胡同巷子楼房屋顶阳台窗户门口台阶电梯楼梯厨房客厅卧室卫生间书房阳台花园院子草地树林公园广场超市商店市场医院学校图书馆博物馆电影院体育馆车站机场码头港口桥梁隧道高速公路天桥地道
早上中午下午傍晚晚上深夜凌晨白天黑夜晴天阴天雨天雪天刮风打雷闪电下雾结冰化冻春天夏天秋天冬天季节气候温度湿度气压风向风速降雨降雪

米饭面条馒头包子饺子馄饨粥汤菜肉鱼虾鸡蛋豆腐青菜萝卜土豆白菜黄瓜西红柿茄子辣椒葱姜蒜醋酱油盐糖油花椒胡椒味精料酒淀粉面粉大米小米玉米高粱红薯山药莲藕竹笋蘑菇木耳海带紫菜
炒煮蒸炖煎炸烤焖烧拌腌泡卤熏烘烙摊卷包捏擀切剁切片切丝切块切段去皮去核去籽洗净沥干热锅凉油大火爆炒中火慢炖小火收汁加盐调味出锅装盘摆盘上桌

老师说读书要用功学生在教室里写作业同学之间要互相帮助朋友遇到困难要一起想办法爸爸妈妈上班很辛苦我们应该体谅他们医生救死扶伤护士细心照顾病人警察维护秩序司机开车要小心农民种地很不容易工人制造产品服务社会商人做生意要讲信用
春天来了花儿开了小草绿了柳树发芽燕子飞回来了夏天到了天气很热知了叫个不停孩子们在水里玩耍秋天到了树叶黄了果子熟了农民忙着收庄稼冬天来了下雪了河面结冰大家穿上了厚衣服一年四季就这样循环往复永不停歇`;

const TRAIN_TEXT = CORPUS;

/* ============================ 准备数据 ============================ */

let ds = null, model = null, cfg = null;
let step = 0, curves = [], lastVal = null, bestVal = null;
let rnd = null, running = false;

const $ = (id) => document.getElementById(id);

function readCfg() {
  const dModel = Math.max(8, Math.min(128, +$('dModel').value || 32));
  let nHeads = Math.max(1, Math.min(8, +$('nHeads').value || 4));
  while (dModel % nHeads !== 0 && nHeads > 1) nHeads--;
  return {
    dModel, nHeads,
    nLayers: Math.max(1, Math.min(4, +$('nLayers').value || 2)),
    ctx: Math.max(8, Math.min(64, +$('ctx').value || 32)),
    batch: Math.max(1, Math.min(32, +$('batch').value || 8)),
    lr: Math.max(0.0005, +$('lr').value || 0.008),
    wd: Math.max(0, +$('wd').value || 0),
    minFreq: Math.max(1, Math.min(5, +$('minFreq').value || 2)),
  };
}

function initModel() {
  cfg = readCfg();
  ds = buildCharVocab(TRAIN_TEXT, { minFreq: cfg.minFreq, valRatio: 0.12, seed: 1234 });
  model = new TinyTransformer({
    vocab: ds.strs.length, dModel: cfg.dModel, nLayers: cfg.nLayers,
    nHeads: cfg.nHeads, ctx: cfg.ctx, seed: 7,
  });
  rnd = mulberry32(2024);
  step = 0; curves = []; lastVal = null; bestVal = null;
  const big = bigramBaseline(ds.trainIds, ds.valIds, ds.strs.length);
  model.bigram = big;
  $('sBigPpl').textContent = big.ppl.toFixed(1);
  $('sBigPpl').className = '';
  $('sParams').textContent = model.nParams().toLocaleString();
  $('sVocab').textContent = ds.strs.length;
  $('sStep').textContent = '0';
  $('sTrainLoss').textContent = '–';
  $('sValLoss').textContent = '–';
  $('sValPpl').textContent = '–';
  $('sValAcc').textContent = '–';
  $('sGnorm').textContent = '–';
  $('lnV').textContent = Math.log(ds.strs.length).toFixed(3);
  $('btnGen').disabled = !model;
  drawChart();
  $('status').textContent = `已初始化：训练 ${ds.trainIds.length} token / 验证 ${ds.valIds.length} token`;
}

/* ============================ 训练循环 ============================ */
function trainBatch() {
  const B = cfg.batch, CTX = cfg.ctx;
  const maxStart = ds.trainIds.length - CTX - 1;
  model.resetBatchGrads();
  let bl = 0;
  for (let b = 0; b < B; b++) {
    const i = Math.floor(rnd() * maxStart);
    const toks = ds.trainIds.slice(i, i + CTX);
    const tgt = ds.trainIds.slice(i + 1, i + CTX + 1);
    bl += model.forward(toks, tgt);
    model.backward(toks, tgt);
  }
  const gnorm = model.clipGrads(1.0);
  model.adamStep(cfg.lr, cfg.wd);
  step++;
  return { trainLoss: bl / B, gnorm };
}

function evaluateNow(maxWindows) {
  return evaluate(model, ds.valIds, cfg.ctx, { maxWindows: maxWindows || 40, seed: 5 + step });
}

function tick() {
  if (!running) return;
  const t0 = performance.now();
  let last = null;
  while (performance.now() - t0 < 260) last = trainBatch();
  const e = evaluateNow(40);
  curves.push({ step, train: last.trainLoss, val: e.loss });
  lastVal = e;
  if (!bestVal || e.ppl < bestVal.ppl) bestVal = { ppl: e.ppl, step };
  updateStats(last, e);
  drawChart();
  requestAnimationFrame(tick);
}

function updateStats(last, e) {
  $('sStep').textContent = step.toLocaleString();
  $('sTrainLoss').textContent = last.trainLoss.toFixed(3);
  $('sValLoss').textContent = e.loss.toFixed(3);
  $('sValPpl').textContent = e.ppl.toFixed(1);
  $('sValAcc').textContent = (e.acc * 100).toFixed(1) + '%';
  $('sGnorm').textContent = last.gnorm.toFixed(2);
  const big = model.bigram;
  $('sValPpl').className = e.ppl < big.ppl ? 'ok' : '';
  $('sValAcc').className = e.acc > big.acc ? 'ok' : '';
  $('status').textContent = `训练中 · 已 ${step.toLocaleString()} 步` +
    (bestVal ? ` · 最好验证困惑度 ${bestVal.ppl.toFixed(1)} @ ${bestVal.step} 步` : '');
}

/* ============================ 画图 ============================ */
function drawChart() {
  const c = $('chart'), ctx2 = c.getContext('2d');
  const W = c.width, H = c.height, pad = 34;
  ctx2.clearRect(0, 0, W, H);
  if (!curves.length) return;
  const lnV = Math.log(ds.strs.length);
  let lo = Infinity, hi = 0;
  for (const p of curves) { lo = Math.min(lo, p.train, p.val); hi = Math.max(hi, p.train, p.val); }
  lo = Math.min(lo, lnV * 0.75); hi = Math.max(hi, lnV);
  const X = (i) => pad + (W - pad * 2) * (curves.length < 2 ? 0.5 : i / (curves.length - 1));
  const Y = (v) => H - pad - (H - pad * 2) * ((v - lo) / Math.max(1e-6, hi - lo));
  ctx2.strokeStyle = '#2b3644'; ctx2.lineWidth = 1;
  ctx2.beginPath(); ctx2.moveTo(pad, pad); ctx2.lineTo(pad, H - pad); ctx2.lineTo(W - pad, H - pad); ctx2.stroke();
  ctx2.setLineDash([4, 4]); ctx2.strokeStyle = '#d29922';
  ctx2.beginPath(); ctx2.moveTo(pad, Y(lnV)); ctx2.lineTo(W - pad, Y(lnV)); ctx2.stroke();
  ctx2.setLineDash([]);
  ctx2.fillStyle = '#9aa7b4'; ctx2.font = '12px monospace';
  ctx2.fillText('ln(V)=' + lnV.toFixed(2), pad + 4, Y(lnV) - 4);
  const line = (key, color) => {
    ctx2.strokeStyle = color; ctx2.lineWidth = 2; ctx2.beginPath();
    curves.forEach((p, i) => { const x = X(i), y = Y(p[key]); i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y); });
    ctx2.stroke();
  };
  line('train', '#58a6ff');
  line('val', '#3fb950');
}

/* ============================ 存档 ============================ */
function ckptMeta() {
  return { step, valPpl: lastVal ? lastVal.ppl : null, at: new Date().toISOString(), vocabHead: vocabFingerprint(ds.strs) };
}

async function saveCheckpoint() {
  try {
    $('ckptStatus').textContent = '正在打包…';
    const str = await encodeCheckpoint(model, ckptMeta());
    saveToStorage(str);
    $('ckptStatus').textContent = `已存入浏览器：${step} 步，${(str.length / 1024).toFixed(0)} KB`;
  } catch (e) {
    $('ckptStatus').textContent = '存档失败：' + e.message;
  }
}

async function loadCheckpoint() {
  const str = loadFromStorage();
  if (!str) { $('ckptStatus').textContent = '浏览器里没有存档'; return; }
  try {
    const meta = await loadInto(model, str);
    restoreAfterLoad(meta);
    $('ckptStatus').textContent = `已读取：${step} 步的权重与优化器状态，可以接着训`;
  } catch (e) {
    $('ckptStatus').textContent = '读取失败：' + e.message;
  }
}

function restoreAfterLoad(meta) {
  step = meta.step || 0;
  curves = [];
  running = false;
  $('btnTrain').disabled = false;
  $('btnStop').disabled = true;
  const e = evaluateNow(60);
  lastVal = e;
  bestVal = { ppl: e.ppl, step };
  updateStats({ trainLoss: NaN, gnorm: 0 }, e);
  $('sTrainLoss').textContent = '–';
  drawChart();
  $('btnGen').disabled = false;
}

async function exportCheckpoint() {
  try {
    $('ckptStatus').textContent = '正在打包…';
    const str = await encodeCheckpoint(model, ckptMeta());
    downloadCheckpoint(str, `txj-llm-step${step}.ckpt`);
    $('ckptStatus').textContent = `已导出 ${(str.length / 1024).toFixed(0)} KB`;
  } catch (e) {
    $('ckptStatus').textContent = '导出失败：' + e.message;
  }
}

async function importCheckpoint() {
  try {
    const str = await pickCheckpointFile();
    if (!str) return;
    const meta = await loadInto(model, str);
    restoreAfterLoad(meta);
    $('ckptStatus').textContent = `已导入：${step} 步（${(str.length / 1024).toFixed(0)} KB）`;
  } catch (e) {
    $('ckptStatus').textContent = '导入失败：' + e.message;
  }
}

function clearCheckpoint() {
  clearStorage();
  $('ckptStatus').textContent = '存档已删除';
}

/* ============================ 生成 ============================ */
function generate() {
  const prompt = $('prompt').value;
  const n = Math.max(1, Math.min(400, +$('genLen').value || 80));
  const unk = ds.strs.length - 1;
  const ids = [];
  for (const ch of prompt) {
    const i = ds.charMap.get(ch);
    ids.push(i === undefined ? unk : i);
  }
  if (!ids.length) {
    const start = Math.floor(rnd() * (ds.trainIds.length - cfg.ctx - 1));
    for (let i = 0; i < Math.min(8, cfg.ctx); i++) ids.push(ds.trainIds[start + i]);
  }
  let ctxIds = ids.slice(-cfg.ctx);
  const outIds = ids.slice();
  const rng = mulberry32(20240101 + step);
  const ng = +$('ngram').value;
  for (let k = 0; k < n; k++) {
    model.forward(ctxIds, null);
    // w.logits 是 [T, V]，只取最后一个位置的 V 个分数
    const last = model.w.logits.slice((ctxIds.length - 1) * model.V, ctxIds.length * model.V);
    const next = sampleFromLogits(last, {
      temperature: +$('temp').value,
      topK: +$('topK').value,
      topP: +$('topP').value,
      repetitionPenalty: +$('rpen').value,
      repetitionWindow: 12,
      recent: ctxIds.slice(-64),
      banned: (() => {
        const b = bannedByNgram(ctxIds, ng);
        b.add(unk);   // unk 不能出现在生成结果里
        return b;
      })(),
      rnd: rng,
    });
    outIds.push(next);
    ctxIds = ctxIds.concat([next]).slice(-cfg.ctx);
  }
  $('out').textContent = outIds.map((i) => ds.strs[i]).join('');
}

/* ============================ 绑定 ============================ */
function bindRange(id, out) {
  const el = $(id), o = $(out);
  el.addEventListener('input', () => { o.textContent = el.value; });
}

$('btnTrain').addEventListener('click', () => {
  running = true;
  $('btnTrain').disabled = true;
  $('btnStop').disabled = false;
  $('btnGen').disabled = false;
  requestAnimationFrame(tick);
});
$('btnStop').addEventListener('click', () => {
  running = false;
  $('btnTrain').disabled = false;
  $('btnStop').disabled = true;
  $('status').textContent = `已暂停 · ${step.toLocaleString()} 步`;
});
$('btnReset').addEventListener('click', () => {
  running = false;
  $('btnTrain').disabled = false;
  $('btnStop').disabled = true;
  initModel();
});
$('btnGen').addEventListener('click', generate);
$('btnSave').addEventListener('click', saveCheckpoint);
$('btnLoad').addEventListener('click', loadCheckpoint);
$('btnExport').addEventListener('click', exportCheckpoint);
$('btnImport').addEventListener('click', importCheckpoint);
$('btnClearCkpt').addEventListener('click', clearCheckpoint);
for (const [id, out] of [['temp', 'tempV'], ['topK', 'topKV'], ['topP', 'topPV'], ['rpen', 'rpenV'], ['ngram', 'ngramV']]) bindRange(id, out);

initModel();
/* 如果浏览器里留着上次的存档，自动恢复，省得每次重训 */
(async () => {
  const str = loadFromStorage();
  if (!str) return;
  try {
    const meta = await loadInto(model, str);
    restoreAfterLoad(meta);
    $('ckptStatus').textContent = `已自动恢复上次存档：${step} 步，可以接着训`;
  } catch (e) {
    $('ckptStatus').textContent = '上次的存档无法恢复：' + e.message;
  }
})();

;globalThis.__api = { initModel, tick, generate, trainBatch, evaluateNow, saveCheckpoint, loadCheckpoint,
  checkVocab, vocabFingerprint, encodeCheckpoint, decodeCheckpoint, loadInto,
  get ds(){return ds}, get model(){return model}, get step(){return step}, get curves(){return curves},
  get lastVal(){return lastVal}, get bestVal(){return bestVal} };