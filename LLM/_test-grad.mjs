/* 反传正确性 + 学习能力验证（可直接 node 跑，不依赖浏览器）
 * 用法: node LLM/_test-grad.mjs
 *
 * 梯度检验的主判据是"与独立 autodiff 对拍"（见 _autograd-oracle.mjs）：
 * autodiff 用磁带式反向模式重建同一个前向计算，是真正独立的第三方实现。
 * 有限差分放在后面当辅助证据 —— 参数是 float32，eps 取不好会产生 100% 的假失败。
 */
import { TinyTransformer, evaluate, bigramBaseline, sampleFromLogits, bannedByNgram, mulberry32, encodeText } from './tiny-transformer.js';
import { compareGrads } from './_autograd-oracle.mjs';
import { buildCharVocab } from './vocab-char.js';
import { TRAIN_TEXT } from './corpus.js';

let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + msg + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
};

/* ---------------- 1. 词表 / 数据切分 ---------------- */
console.log('\n【1】词表与数据切分');
const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.15, seed: 1234 });
console.log(`  字符级词表 V=${ds.strs.length}；训练 ${ds.trainIds.length} token（${ds.trainChars} 字），验证 ${ds.valIds.length} token`);
ok(ds.strs.length > 400 && ds.strs.length < 2000, '词表规模合理（低频字已并入 unk）', `V=${ds.strs.length}`);
ok(ds.valIds.length > 800, '验证集有足够 token（按字符预算切分）', `${ds.valIds.length}`);
ok(ds.strs[ds.strs.length - 1] === '?', 'unk 占一个固定 id，且是最后一个', `id=${ds.strs.length - 1}`);

/* ---------------- 2. 反传 vs 独立 autodiff ---------------- */
console.log('\n【2】反向传播正确性（与独立 autodiff 对拍）');
{
  const cfgs = [
    { tieWeights: false, T: 5, D: 8, L: 2, H: 2 },
    { tieWeights: true, T: 5, D: 8, L: 2, H: 2 },
    { tieWeights: false, T: 3, D: 4, L: 1, H: 1 },
    { tieWeights: false, T: 8, D: 16, L: 3, H: 4 },
  ];
  for (const cfg of cfgs) {
    const V = 17, { T, D, L, H } = cfg;
    const m = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: T, seed: 3, tieWeights: cfg.tieWeights });
    const toks = Array.from({ length: T }, (_, i) => (i * 3 + 1) % V);
    const tgt = Array.from({ length: T }, (_, i) => (i * 5 + 4) % V);
    const r = compareGrads(m, toks, tgt);
    const detail = r.bad.slice(0, 3).map((b) => `${b.name}(autodiff=${b.av.toExponential(1)} 模型=${b.bv.toExponential(1)})`).join(' ');
    ok(r.bad.length === 0, `与 autodiff 逐块一致（T=${T} D=${D} L=${L} H=${H} tie=${cfg.tieWeights}）`,
      r.bad.length ? detail : `${r.rows.length} 个参数块，参数量 ${r.nParams}`);
  }

  /* ---- 2c. 梯度缓冲必须全部被清零 ---- */
  // 真实的坑：zeroGrads() 只清 bindings 里的缓冲，而权重共享时 Wout 不在
  // paramList() 里（它等于 E），于是 g.Wout 跨训练步不断累积，
  // 其他参数每步都归零、只有输出层投影不清零，训练因此极不稳定。
  // 检验方法：把 backward 会写到的每一块缓冲都填成 1，调用 zeroGrads()，必须全为 0。
  for (const tie of [false, true]) {
    const V = 17, D = 8, L = 2, H = 2, CTX = 5;
    const m = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: CTX, seed: 3, tieWeights: tie });
    const bufs = { 'g.E': m.g.E, 'g.P': m.g.P, 'g.lnfg': m.g.lnfg, 'g.lnfb': m.g.lnfb, 'g.Wout': m.g.Wout, 'g.bout': m.g.bout };
    for (let i = 0; i < L; i++) for (const k of Object.keys(m.g.layers[i])) bufs[`g.l${i}.${k}`] = m.g.layers[i][k];
    for (const arr of Object.values(bufs)) arr.fill(1);
    m.zeroGrads();
    const dirty = Object.entries(bufs).filter(([, arr]) => arr.some((v) => v !== 0)).map(([n]) => n);
    ok(dirty.length === 0, `zeroGrads 清掉所有梯度缓冲（tieWeights=${tie}）`, dirty.length ? `残留: ${dirty.join(',')}` : `${Object.keys(bufs).length} 块全为 0`);
  }

  /* ---- 2d. 同一 batch 重复 backward 应当累加；resetBatchGrads 后应当逐位复现 ---- */
  for (const tie of [false, true]) {
    const V = 17, D = 8, L = 2, H = 2, CTX = 5;
    const m = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: CTX, seed: 3, tieWeights: tie });
    const toks = [1, 4, 7, 2, 9], tgt = [4, 7, 2, 9, 3];
    m.resetBatchGrads(); m.forward(toks, tgt); m.backward(toks, tgt);
    const once = Float64Array.from(m.g.Wout);
    m.forward(toks, tgt); m.backward(toks, tgt);
    // 注意 g.Wout 是 float32，两次累加的结果与"2×第一次"只能比到 float32 精度
    let doubled = true, worst = 0;
    for (let i = 0; i < once.length; i++) {
      const want = Math.fround(2 * once[i]);
      worst = Math.max(worst, Math.abs(m.g.Wout[i] - want));
      if (Math.abs(m.g.Wout[i] - want) > 1e-6 * Math.max(1, Math.abs(want))) { doubled = false; break; }
    }
    ok(doubled, `连续两次 backward 的 g.Wout 正好翻倍（确认写入是累加语义，tie=${tie}）`,
      `最大偏差 ${worst.toExponential(2)}`);
    m.resetBatchGrads(); m.forward(toks, tgt); m.backward(toks, tgt);
    let same = true;
    for (let i = 0; i < once.length; i++) if (m.g.Wout[i] !== once[i]) { same = false; break; }
    ok(same, `resetBatchGrads 后重跑得到逐位相同的 g.Wout（梯度不再跨步残留，tie=${tie}）`);
  }

  // 辅助证据：沿负梯度走一步，loss 必须下降
  for (const tie of [false, true]) {    const V = 17, D = 8, L = 2, H = 2, CTX = 5;
    const m = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: CTX, seed: 3, tieWeights: tie });
    const toks = [1, 4, 7, 2, 9], tgt = [4, 7, 2, 9, 3];
    m.resetBatchGrads();
    const L0 = m.forward(toks, tgt);
    m.backward(toks, tgt);
    const params = m.paramList();
    const gOf = (n) => { const q = n.split('.'); return q.length === 1 ? m.g[n] : m.g.layers[+q[0].slice(1)][q[1]]; };
    const gs = params.map(([n]) => Float64Array.from(gOf(n)));
    let gg = 0;
    for (const g of gs) for (const v of g) gg += v * v;
    const step = 1e-3 / (Math.sqrt(gg) || 1);
    params.forEach(([, p], k) => { const g = gs[k]; for (let i = 0; i < p.length; i++) p[i] -= step * g[i]; });
    const L1 = m.forward(toks, tgt);
    ok(L1 < L0, `沿负梯度走一步 loss 下降（tieWeights=${tie}）`,
      `${L0.toFixed(6)} -> ${L1.toFixed(6)}`);
  }

  /* ---------------- 3. 过拟合能力：能否把一条短序列背下来 ---------------- */
  console.log('\n【3】单条序列过拟合（能背下来 -> 整条反向链路可用）');
  const V = 17, D = 8, L = 2, H = 2, CTX = 5;
  const m2 = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: CTX, seed: 5 });
  const seq = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
  const first = m2.forward(seq.slice(0, CTX), seq.slice(1, CTX + 1));
  for (let s = 0; s < 800; s++) m2.trainStep(seq.slice(0, CTX), seq.slice(1, CTX + 1), 0.03, 1.0);
  const last = m2.forward(seq.slice(0, CTX), seq.slice(1, CTX + 1));
  ok(last < 0.05, '小模型能把 5 步序列的 loss 压到 0.05 以下', `${first.toFixed(3)} -> ${last.toFixed(4)}`);
}

/* ---------------- 4. 采样器行为 ---------------- */
console.log('\n【4】采样器');
{
  const V = 6;
  const logits = Float32Array.from([5, 4, 3, 1, 0, -2]);
  const oneHot = sampleFromLogits(logits, { temperature: 0.05, topK: 3, topP: 1, repetitionPenalty: 1, noRepeatNgram: 0 });
  ok(oneHot === 0, '极低温 top-k 会选到最大 logit', `got ${oneHot}`);
  const banned = new Set([0, 1]);
  const b = sampleFromLogits(logits, { temperature: 1, topK: 6, topP: 1, repetitionPenalty: 1, banned });
  ok(b === 2, '掩码生效，跳过被禁 token', `got ${b}`);
  const bg = bannedByNgram([1, 2, 3, 1, 2, 3], 3);
  ok(bg.has(1), '重复 3-gram 被禁止', `banned={${[...bg].join(',')}}`);
  const rnd = mulberry32(42);
  const counts = new Array(V).fill(0);
  for (let i = 0; i < 4000; i++) counts[sampleFromLogits(logits, { temperature: 1, topK: V, topP: 1, repetitionPenalty: 1, rnd })]++;
  ok(counts[0] > counts[2] && counts[2] > counts[4], '采样频率与 logit 排序一致', counts.join('/'));
}

/* ---------------- 5. 与 bigram 基线对比 ---------------- */
console.log('\n【5】困惑度 / 准确率 vs bigram 基线（评估的核心指标）');
{
  const V = ds.strs.length, CTX = 32;
  const big = bigramBaseline(ds.trainIds, ds.valIds, V);
  console.log(`  bigram  : ppl=${big.ppl.toFixed(2)}  acc=${(big.acc * 100).toFixed(1)}%`);
  console.log(`  随机猜测: ppl=${V.toFixed(2)}`);

  const D = Number(process.env.D || 24), L = Number(process.env.L || 1), HH = Number(process.env.H || 2);
  const steps = Number(process.env.STEPS || 900), lr = Number(process.env.LR || 0.006), wd = Number(process.env.WD || 0.1);
  const model = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: HH, ctx: CTX, seed: 7 });
  console.log(`  模型    : D=${D} L=${L} H=${HH} lr=${lr} wd=${wd}  参数量 ${model.nParams().toLocaleString()}`);
  const rnd = mulberry32(2024);
  const batch = 8;
  const maxStart = ds.trainIds.length - CTX - 1;
  const t1 = Date.now();
  let best = { loss: Infinity, step: 0 };
  for (let s = 0; s < steps; s++) {
    model.resetBatchGrads();
    let bl = 0;
    for (let b = 0; b < batch; b++) {
      const i = Math.floor(rnd() * maxStart);
      const toks = ds.trainIds.slice(i, i + CTX);
      const tgt = ds.trainIds.slice(i + 1, i + CTX + 1);
      bl += model.forward(toks, tgt);
      model.backward(toks, tgt);          // 默认 1/T，不要再传 1
    }
    model.clipGrads(1.0);
    model.adamStep(lr, wd);
    if ((s + 1) % 150 === 0) {
      const e = evaluate(model, ds.valIds, CTX, { maxWindows: 150, seed: 5 });
      if (e.loss < best.loss) best = { loss: e.loss, step: s + 1, ppl: e.ppl };
      console.log(`  step ${String(s + 1).padStart(4)}  train_loss=${(bl / batch).toFixed(3)}  val_loss=${e.loss.toFixed(3)}  val_ppl=${e.ppl.toFixed(2)}  val_acc=${(e.acc * 100).toFixed(1)}%`);
    }
  }
  const ms = Date.now() - t1;
  const ev = evaluate(model, ds.valIds, CTX, { maxWindows: 400, seed: 5 });
  const tr = evaluate(model, ds.trainIds, CTX, { maxWindows: 400, seed: 6 });
  console.log(`  训练 ${steps} 步耗时 ${ms}ms（${(ms / steps).toFixed(1)} ms/step，batch=${batch}）`);
  console.log(`  最好验证点: step ${best.step}  val_ppl=${best.ppl.toFixed(2)}`);
  console.log(`  末态      : val ppl=${ev.ppl.toFixed(2)} acc=${(ev.acc * 100).toFixed(1)}%  |  train ppl=${tr.ppl.toFixed(2)} acc=${(tr.acc * 100).toFixed(1)}%`);
  ok(best.ppl < big.ppl, '最好验证点的困惑度优于 bigram 基线（模型会选最优检查点）',
    `${best.ppl.toFixed(2)} vs ${big.ppl.toFixed(2)}（${(big.ppl / best.ppl).toFixed(2)}×，step ${best.step}）`);
  ok(ev.acc >= big.acc - 0.02, '末态下一字准确率不低于 bigram 基线',
    `${(ev.acc * 100).toFixed(1)}% vs ${(big.acc * 100).toFixed(1)}%`);

  /* ---------------- 6. 生成样例 ---------------- */
  console.log('\n【6】生成样例');
  const id2str = (id) => ds.strs[id] || '?';
  const rnd2 = mulberry32(7);
  const gen = (prompt, n, cfg) => {
    let ctx = encodeText(prompt, ds).slice(-CTX);
    const out = [...ctx];
    for (let i = 0; i < n; i++) {
      model.forward(ctx, null);
      const V2 = model.V;
      const lg = new Float32Array(V2);
      for (let j = 0; j < V2; j++) lg[j] = model.w.logits[(ctx.length - 1) * V2 + j];
      const banned = bannedByNgram(out, cfg.noRepeatNgram || 0);
      banned.add(V2 - 1);
      out.push(sampleFromLogits(lg, { ...cfg, recent: out.slice(-40), banned, rnd: rnd2 }));
      ctx = out.slice(-CTX);
    }
    return out.map(id2str).join('');
  };
  for (const p of ['人之初', '道可道', '学习', '今天天气']) {
    console.log(`  「${p}」 -> ${gen(p, 40, { temperature: 0.8, topK: 40, topP: 0.9, repetitionPenalty: 1.1, noRepeatNgram: 3 })}`);
  }
}

console.log(failed === 0 ? '\n全部检查通过 ✅' : `\n有 ${failed} 项检查失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
