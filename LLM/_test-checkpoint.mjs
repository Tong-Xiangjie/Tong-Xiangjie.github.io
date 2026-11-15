/* 存档/读档的往返测试：权重必须逐位相同，Adam 状态必须能续训，
 * 而且"存到一半再接着训"要和"一口气训完"一样。
 * 用法: node LLM/_test-checkpoint.mjs
 */
import { TinyTransformer, evaluate } from './tiny-transformer.js';
import {
  encodeCheckpoint, decodeCheckpoint, loadInto, modelFromCheckpoint,
  vocabFingerprint, checkVocab, bytesToBase64, base64ToBytes,
} from './checkpoint.js';
import { buildCharVocab } from './vocab-char.js';
import { TRAIN_TEXT } from './corpus.js';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`); c ? pass++ : fail++; };

/* ---------------- 0. base64 往返 ---------------- */
console.log('\n【0】base64 编解码');
{
  for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
    const src = new Uint8Array(n);
    for (let i = 0; i < n; i++) src[i] = (i * 37 + 11) & 0xff;
    const back = base64ToBytes(bytesToBase64(src));
    ok(back.length === n && back.every((v, i) => v === src[i]), `长度 ${n} 的字节往返一致`);
  }
}

/* ---------------- 1. 权重往返 ---------------- */
console.log('\n【1】权重往返（逐位相同）');
{
  const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.12, seed: 1234 });
  for (const tie of [true, false]) {
    const m = new TinyTransformer({ vocab: ds.strs.length, dModel: 16, nLayers: 2, nHeads: 2, ctx: 16, seed: 7, tieWeights: tie });
    // 先训一点，让参数不是初始值（初始值对称，测不出错位）
    for (let s = 0; s < 30; s++) {
      const i = (s * 13) % (ds.trainIds.length - 17);
      m.trainStep(ds.trainIds.slice(i, i + 16), ds.trainIds.slice(i + 1, i + 17), 0.01, 1.0, 0.1);
    }
    const before = m.paramList().map(([n, p]) => [n, Float32Array.from(p)]);
    const str = await encodeCheckpoint(m, { step: m.step, vocab: m.V });
    const m2 = new TinyTransformer({ ...m.shape(), seed: 999 });   // 故意用不同 seed，确保是读档而不是巧合
    await loadInto(m2, str);
    let worst = 0;
    for (const [n, p] of before) {
      const q = m2.paramList().find(([x]) => x === n)[1];
      for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
    }
    ok(worst === 0, `tieWeights=${tie} 权重逐位一致`, `最大差 ${worst}`);

    // 只比"数值相等"是不够的：曾经的一个 bug 就是读档后 Wout 不再是 E 的别名，
    // 两块参数数值相同但各自独立更新，权重共享静默失效。必须查对象同一性。
    if (tie) {
      ok(m2.E === m2.Wout, '权重共享在读档后仍然成立（E 与 Wout 是同一个对象）',
        m2.E === m2.Wout ? '同一对象' : '❌ 已被拆成两块独立参数');
      // 用"改一个看另一个"再确认一次（注意 E 是 float32：写入后要按 float32 读回，
      // 否则 v+1 会被量化，比较时看似"没同步"）
      const v = m2.E[7];
      m2.Wout[7] = v + 1;
      const target = Math.fround(v + 1);
      const viaWout = m2.Wout[7];
      const viaE = m2.E[7];
      m2.Wout[7] = v;
      ok(viaWout === target && viaE === target, '改 Wout 会同步改到 E（共享仍生效）',
        `Wout[7]=${viaWout} E[7]=${viaE} 期望=${target}（float32）`);
      ok(m2.E[7] === v, '恢复原值成功（后续测试不受污染）');
    } else {
      ok(m2.E !== m2.Wout, 'tieWeights=false 时 E 与 Wout 是独立参数');
    }

    // 前向输出也必须完全一致
    const toks = ds.trainIds.slice(0, 16), tgt = ds.trainIds.slice(1, 17);
    const l1 = m.forward(toks, tgt), l2 = m2.forward(toks, tgt);
    ok(l1 === l2, `tieWeights=${tie} 同输入下 loss 完全相同`, `${l1} vs ${l2}`);
  }
}

/* ---------------- 2. 存档能续训（Adam 状态也要存） ---------------- */
console.log('\n【2】续训等价性（存 -> 读 -> 接着训 vs 一口气训完）');
{
  const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.12, seed: 1234 });
  const mk = () => new TinyTransformer({ vocab: ds.strs.length, dModel: 16, nLayers: 2, nHeads: 2, ctx: 16, seed: 11 });
  const batches = [];
  for (let s = 0; s < 60; s++) {
    const i = (s * 29) % (ds.trainIds.length - 17);
    batches.push([ds.trainIds.slice(i, i + 16), ds.trainIds.slice(i + 1, i + 17)]);
  }
  const run = (m, from, to) => { for (let s = from; s < to; s++) m.trainStep(batches[s][0], batches[s][1], 0.02, 1.0, 0.1); };

  const a = mk(); run(a, 0, 60);                              // 一口气
  const b = mk(); run(b, 0, 30);                              // 训一半
  const str = await encodeCheckpoint(b, { step: b.step });
  const c = mk(); await loadInto(c, str); run(c, 30, 60);      // 读档再训另一半

  let worst = 0;
  for (const [n, p] of a.paramList()) {
    const q = c.paramList().find(([x]) => x === n)[1];
    for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
  }
  const scale = Math.max(...a.paramList().map(([, p]) => Math.max(...Array.from(p).map(Math.abs))));
  ok(worst < scale * 1e-5, '续训后的权重与一口气训完一致（Adam 动量/步数都恢复了）',
    `最大差 ${worst.toExponential(2)}，参数量级 ${scale.toExponential(2)}`);

  // 如果没存 Adam，续训会明显不同 —— 用这个反证"确实存了"
  const d = mk(); run(d, 0, 30);
  const noAdam = JSON.parse(JSON.stringify({}));   // 占位，下面用另一种方式构造
  void noAdam;
  const raw = await decodeCheckpoint(str);
  raw.state.adam = null;
  const e = mk(); e.loadState(raw.state); run(e, 30, 60);
  let diff = 0;
  for (const [n, p] of a.paramList()) {
    const q = e.paramList().find(([x]) => x === n)[1];
    for (let i = 0; i < p.length; i++) diff = Math.max(diff, Math.abs(p[i] - q[i]));
  }
  ok(diff > worst * 10, '丢掉 Adam 状态后结果明显不同（证明存档里确实带了优化器状态）',
    `带 Adam ${worst.toExponential(2)} vs 不带 ${diff.toExponential(2)}`);
}

/* ---------------- 3. 粒子度：困惑度也要一致 ---------------- */
console.log('\n【3】读档后困惑度一致');
{
  const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.12, seed: 1234 });
  const m = new TinyTransformer({ vocab: ds.strs.length, dModel: 24, nLayers: 2, nHeads: 4, ctx: 24, seed: 3 });
  for (let s = 0; s < 200; s++) {
    const i = (s * 41) % (ds.trainIds.length - 25);
    m.trainStep(ds.trainIds.slice(i, i + 24), ds.trainIds.slice(i + 1, i + 25), 0.01, 1.0, 0.1);
  }
  const e1 = evaluate(m, ds.valIds, 24, { maxWindows: 60, seed: 5 });
  const str = await encodeCheckpoint(m, { step: m.step });
  const m2 = new TinyTransformer({ ...m.shape(), seed: 123 });
  await loadInto(m2, str);
  const e2 = evaluate(m2, ds.valIds, 24, { maxWindows: 60, seed: 5 });
  ok(Math.abs(e1.ppl - e2.ppl) < 1e-9, '读档后验证困惑度完全一致',
    `${e1.ppl.toFixed(6)} vs ${e2.ppl.toFixed(6)}`);
  console.log(`     实测：${m.step} 步后 val ppl = ${e1.ppl.toFixed(2)}, acc = ${(e1.acc * 100).toFixed(1)}%`);
}

/* ---------------- 4. 形状校验与词表校验（必须拦住） ---------------- */
console.log('\n【4】不匹配时必须报错，不能静默读进去');
{
  const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.12, seed: 1234 });
  const m = new TinyTransformer({ vocab: ds.strs.length, dModel: 16, nLayers: 2, nHeads: 2, ctx: 16, seed: 7 });
  const str = await encodeCheckpoint(m, { vocabHead: vocabFingerprint(ds.strs) });

  const wrongCtx = new TinyTransformer({ vocab: ds.strs.length, dModel: 16, nLayers: 2, nHeads: 2, ctx: 32, seed: 7 });
  let caught = '';
  try { await loadInto(wrongCtx, str); } catch (err) { caught = err.message; }
  ok(/形状不符/.test(caught), 'ctx 不符时抛错', caught.slice(0, 60));

  const wrongD = new TinyTransformer({ vocab: ds.strs.length, dModel: 32, nLayers: 2, nHeads: 2, ctx: 16, seed: 7 });
  caught = '';
  try { await loadInto(wrongD, str); } catch (err) { caught = err.message; }
  ok(/形状不符/.test(caught), 'dModel 不符时抛错', caught.slice(0, 60));

  const otherVocab = vocabFingerprint(ds.strs.slice(0, ds.strs.length - 1));
  caught = '';
  try { checkVocab({ vocabHead: otherVocab }, vocabFingerprint(ds.strs)); } catch (err) { caught = err.message; }
  ok(/词表/.test(caught), '词表指纹不符时抛错', caught.slice(0, 60));

  caught = '';
  try { await decodeCheckpoint('随便一段文本'); } catch (err) { caught = err.message; }
  ok(/不是本页导出/.test(caught), '非存档内容抛错', caught);

  caught = '';
  try { await decodeCheckpoint(str.slice(0, str.length - 20) + 'AAAAAAAA'); } catch (err) { caught = err.message || String(err); }
  ok(caught.length > 0, '存档被截断/损坏时抛错而不是返回垃圾', caught.slice(0, 50));
}

/* ---------------- 5. 体积 ---------------- */
console.log('\n【5】存档体积（实际 demo 配置）');
{
  const ds = buildCharVocab(TRAIN_TEXT, { minFreq: 2, valRatio: 0.12, seed: 1234 });
  const m = new TinyTransformer({ vocab: ds.strs.length, dModel: 32, nLayers: 2, nHeads: 4, ctx: 32, seed: 7 });
  for (let s = 0; s < 20; s++) {
    const i = (s * 17) % (ds.trainIds.length - 33);
    m.trainStep(ds.trainIds.slice(i, i + 32), ds.trainIds.slice(i + 1, i + 33), 0.01, 1.0, 0.1);
  }
  const str = await encodeCheckpoint(m, { step: m.step });
  const { state } = await decodeCheckpoint(str);
  const rawJSON = JSON.stringify(state).length;
  console.log(`     V=${ds.strs.length} 参数量=${m.nParams().toLocaleString()} blocks=${state.params.length + (state.adam ? state.adam.entries.length : 0)}`);
  console.log(`     纯 JSON  ${(rawJSON / 1024).toFixed(0)} KB`);
  console.log(`     本存档   ${(str.length / 1024).toFixed(0)} KB（含 Adam 状态，base64 后）`);
  const noAdam = await encodeCheckpoint(new TinyTransformer({ ...m.shape(), seed: 7 }), {});
  console.log(`     仅权重   ${(noAdam.length / 1024).toFixed(0)} KB`);
  ok(str.length < 5 * 1024 * 1024, '存档能塞进 localStorage（< 5MB）', `${(str.length / 1024).toFixed(0)} KB`);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
