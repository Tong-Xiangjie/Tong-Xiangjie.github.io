/* 独立判据：用磁带式自动微分（reverse-mode autodiff）重建与模型完全相同的前向计算，
 * 再和 tiny-transformer.js 手写的 backward 对拍。
 *
 * 为什么要这个：手写链式法则很容易出现"看起来对、其实漏了一项"的错误，
 * 而有限差分又受 float32 参数精度限制（eps 会被量化，假失败率很高）。
 * autodiff 是真正独立的第三方实现，能精确定位到具体参数块。
 *
 * 用法：node LLM/_autograd-oracle.mjs
 */
import { TinyTransformer } from './tiny-transformer.js';

/* ---------------- 极简 autodiff ---------------- */
class N {
  constructor(v, parents = [], grads = []) { this.v = v; this.parents = parents; this.grads = grads; this.g = 0; }
}
let TAPE = [];
const node = (v, parents, grads) => { const n = new N(v, parents, grads); TAPE.push(n); return n; };
const cst = (v) => node(v, [], []);
const add = (a, b) => node(a.v + b.v, [a, b], [1, 1]);
const sub = (a, b) => node(a.v - b.v, [a, b], [1, -1]);
const mul = (a, b) => node(a.v * b.v, [a, b], [b.v, a.v]);
const div = (a, b) => node(a.v / b.v, [a, b], [1 / b.v, -a.v / (b.v * b.v)]);
const exp = (a) => { const e = Math.exp(a.v); return node(e, [a], [e]); };
const log = (a) => node(Math.log(a.v), [a], [1 / a.v]);
const sqrt = (a) => { const s = Math.sqrt(a.v); return node(s, [a], [0.5 / s]); };
const relu = (a) => node(a.v > 0 ? a.v : 0, [a], [a.v > 0 ? 1 : 0]);
function backward(root) {
  const topo = [], seen = new Set();
  (function dfs(n) { if (seen.has(n)) return; seen.add(n); for (const p of n.parents) dfs(p); topo.push(n); })(root);
  root.g = 1;
  for (let i = topo.length - 1; i >= 0; i--) {
    const n = topo[i];
    for (let k = 0; k < n.parents.length; k++) n.parents[k].g += n.g * n.grads[k];
  }
}

/**
 * 在给定模型与 batch 上跑一遍 autodiff，返回每个参数块的梯度。
 * @returns {{loss:number, grads:Map<Float32Array, Float64Array>}}
 */
export function autodiffGrads(m, toks, tgt) {
  TAPE = [];
  const { D, L, H, DH, V } = m;
  const T = toks.length, F = 4 * D, EP = 1e-5;
  const leafCache = new Map();
  const leaf = (arr, i) => {
    let lm = leafCache.get(arr);
    if (!lm) { lm = new Array(arr.length); leafCache.set(arr, lm); }
    if (!lm[i]) lm[i] = cst(arr[i]);
    return lm[i];
  };
  const ln = (x, g, b) => {
    const out = [];
    let mu = cst(0);
    for (let d = 0; d < D; d++) mu = add(mu, x[d]);
    mu = div(mu, cst(D));
    let va = cst(0);
    for (let d = 0; d < D; d++) { const c = sub(x[d], mu); va = add(va, mul(c, c)); }
    va = div(va, cst(D));
    const r = div(cst(1), sqrt(add(va, cst(EP))));
    for (let d = 0; d < D; d++) out.push(add(mul(mul(sub(x[d], mu), r), leaf(g, d)), leaf(b, d)));
    return out;
  };
  let cur = [];
  for (let t = 0; t < T; t++) {
    const row = [];
    for (let d = 0; d < D; d++) row.push(add(leaf(m.E, toks[t] * D + d), leaf(m.P, t * D + d)));
    cur.push(row);
  }
  for (let li = 0; li < L; li++) {
    const l = m.layers[li];
    const z = cur.map((row) => ln(row, l.ln1g, l.ln1b));
    const q = [], k = [], v = [];
    for (let t = 0; t < T; t++) {
      const qr = [], kr = [], vr = [];
      for (let j = 0; j < D; j++) {
        let a = leaf(l.bq, j), b = leaf(l.bk, j), c = leaf(l.bv, j);
        for (let i = 0; i < D; i++) {
          a = add(a, mul(leaf(l.Wq, j * D + i), z[t][i]));
          b = add(b, mul(leaf(l.Wk, j * D + i), z[t][i]));
          c = add(c, mul(leaf(l.Wv, j * D + i), z[t][i]));
        }
        qr.push(a); kr.push(b); vr.push(c);
      }
      q.push(qr); k.push(kr); v.push(vr);
    }
    const at = [], ao = [];
    for (let t = 0; t < T; t++) { at.push(new Array(T).fill(null)); ao.push(new Array(D).fill(null).map(() => cst(0))); }
    const sc = 1 / Math.sqrt(DH);
    for (let h = 0; h < H; h++) for (let t = 0; t < T; t++) {
      const scores = [];
      for (let s = 0; s <= t; s++) {
        let dot = cst(0);
        for (let d = 0; d < DH; d++) dot = add(dot, mul(q[t][h * DH + d], k[s][h * DH + d]));
        scores.push(mul(dot, cst(sc)));
      }
      let sum = cst(0);
      for (const s2 of scores) sum = add(sum, exp(s2));
      for (let s = 0; s <= t; s++) at[t][s] = div(exp(scores[s]), sum);
      for (let s = 0; s <= t; s++) for (let d = 0; d < DH; d++) ao[t][h * DH + d] = add(ao[t][h * DH + d], mul(at[t][s], v[s][h * DH + d]));
    }
    const h2 = [];
    for (let t = 0; t < T; t++) {
      const row = [];
      for (let j = 0; j < D; j++) {
        let s = leaf(l.bo, j);
        for (let i = 0; i < D; i++) s = add(s, mul(leaf(l.Wo, j * D + i), ao[t][i]));
        row.push(add(s, cur[t][j]));
      }
      h2.push(row);
    }
    const h3 = h2.map((row) => ln(row, l.ln2g, l.ln2b));
    const f2 = [];
    for (let t = 0; t < T; t++) {
      const row = [];
      for (let j = 0; j < F; j++) {
        let s = leaf(l.b1, j);
        for (let i = 0; i < D; i++) s = add(s, mul(leaf(l.W1, j * D + i), h3[t][i]));
        row.push(relu(s));
      }
      f2.push(row);
    }
    const h4 = [];
    for (let t = 0; t < T; t++) {
      const row = [];
      for (let j = 0; j < D; j++) {
        let s = leaf(l.b2, j);
        for (let i = 0; i < F; i++) s = add(s, mul(leaf(l.W2, j * F + i), f2[t][i]));
        row.push(add(s, h2[t][j]));
      }
      h4.push(row);
    }
    cur = h4;
  }
  const h5 = cur.map((row) => ln(row, m.lnfg, m.lnfb));
  let loss = cst(0);
  for (let t = 0; t < T; t++) {
    const scores = [];
    for (let j = 0; j < V; j++) {
      let s = leaf(m.bout, j);
      for (let i = 0; i < D; i++) s = add(s, mul(leaf(m.Wout, j * D + i), h5[t][i]));
      scores.push(s);
    }
    let mval = -Infinity;
    for (const s of scores) mval = Math.max(mval, s.v);
    let sum = cst(0);
    for (const s of scores) sum = add(sum, exp(sub(s, cst(mval))));
    loss = add(loss, add(sub(cst(mval), scores[tgt[t]]), log(sum)));
  }
  loss = div(loss, cst(T));
  backward(loss);

  const grads = new Map();
  for (const [arr, lm] of leafCache) {
    const g = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) if (lm[i]) g[i] = lm[i].g;
    grads.set(arr, g);
  }
  return { loss: loss.v, grads };
}

/** 对拍：返回每个参数块的相对误差。 */
export function compareGrads(m, toks, tgt) {
  const V = m.V;
  m.zeroGrads();
  const lossModel = m.forward(toks, tgt);
  m.backward(toks, tgt);
  const { loss, grads } = autodiffGrads(m, toks, tgt);

  const modelGrad = (name) => {
    const parts = name.split('.');
    return parts.length === 1 ? m.g[name] : m.g.layers[+parts[0].slice(1)][parts[1]];
  };
  const rows = [];
  for (const [name, arr] of m.paramList()) {
    const a = grads.get(arr);
    if (!a) continue;
    const b = modelGrad(name);
    let magA = 0, magB = 0, maxAbsDiff = 0, wi = -1, av = 0, bv = 0;
    for (let i = 0; i < a.length; i++) { magA = Math.max(magA, Math.abs(a[i])); magB = Math.max(magB, Math.abs(b[i])); }
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > maxAbsDiff) { maxAbsDiff = d; wi = i; av = a[i]; bv = b[i]; }
    }
    // 混合判据：绝对差要小到相对于该参数块的最大梯度可以忽略。
    // 纯相对判据会把"解析值本来就是 0"的元素（例如 T 小的时候 bk）判成错，
    // 那是 float32 舍入噪声，不是 bug。所以 scale 退化到 0 时改用绝对判据。
    const scale = Math.max(magA, magB);
    const rel = scale > 1e-6 ? maxAbsDiff / scale : maxAbsDiff;
    rows.push({ name, worst: rel, maxAbsDiff, scale, wi, av, bv });
  }
  return { lossModel, lossOracle: loss, rows, bad: rows.filter((r) => r.worst > 1e-4), nParams: m.nParams() };
}

if (process.argv[1] && process.argv[1].endsWith('_autograd-oracle.mjs')) {
  let failed = 0;
  const cfgs = [
    { tieWeights: false },
    { tieWeights: true },
    { tieWeights: false, T: 3, D: 4, H: 1, L: 1 },
    { tieWeights: false, T: 8, D: 16, H: 4, L: 3 },
    { tieWeights: false, T: 6, D: 12, H: 3, L: 2 },
  ];
  for (const cfg of cfgs) {
    const V = 17, T = cfg.T || 5, D = cfg.D || 8, L = cfg.L || 2, H = cfg.H || 2;
    const m = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: T, seed: 3, tieWeights: cfg.tieWeights });
    const toks = Array.from({ length: T }, (_, i) => (i * 3 + 1) % V);
    const tgt = Array.from({ length: T }, (_, i) => (i * 5 + 4) % V);
    const r = compareGrads(m, toks, tgt);
    const tag = `T=${T} D=${D} L=${L} H=${H} tie=${cfg.tieWeights}`;
    const detail = r.bad.slice(0, 4).map((b) => `${b.name}(autodiff=${b.av.toExponential(1)} 模型=${b.bv.toExponential(1)})`).join(' ');
    console.log(`${tag.padEnd(30)} 参数量=${String(r.nParams).padStart(6)} loss=${r.lossModel.toFixed(6)}/${r.lossOracle.toFixed(6)} 不合格块=${r.bad.length}/${r.rows.length} ${r.bad.length === 0 ? '✅' : '❌ ' + detail}`);
    if (r.bad.length) failed++;
  }
  console.log(failed === 0 ? '\n全部配置与 autodiff 一致 ✅' : `\n${failed} 个配置不一致 ❌`);
  process.exit(failed ? 1 : 0);
}
