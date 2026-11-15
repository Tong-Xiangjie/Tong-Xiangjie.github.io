// 单次试验（参数化，便于并行跑）：node _trial.mjs <D> <L> <H> <lr> <wd> <steps> <minFreq> <valRatio>
import { TinyTransformer, evaluate, bigramBaseline, mulberry32 } from './tiny-transformer.js';
import { buildCharVocab } from './vocab-char.js';
import { TRAIN_TEXT } from './corpus.js';

const [D, L, H, lr, wd, steps, minFreq, valRatio] = process.argv.slice(2).map(Number);
const STEP = steps || 900, MF = minFreq ?? 2, VR = valRatio ?? 0.15;
const CTX = 32, BATCH = 8;

const ds = buildCharVocab(TRAIN_TEXT, { minFreq: MF, valRatio: VR });
const V = ds.strs.length;
const big = bigramBaseline(ds.trainIds, ds.valIds, V);
const model = new TinyTransformer({ vocab: V, dModel: D, nLayers: L, nHeads: H, ctx: CTX, seed: 7 });
const rnd = mulberry32(2024);
const maxStart = ds.trainIds.length - CTX - 1;
let best = { loss: Infinity, step: 0, ppl: Infinity };
let lastTr = 0;
const t0 = Date.now();
for (let s = 0; s < STEP; s++) {
  model.resetBatchGrads();
  let bl = 0;
  for (let b = 0; b < BATCH; b++) {
    const i = Math.floor(rnd() * maxStart);
    const toks = ds.trainIds.slice(i, i + CTX), tgt = ds.trainIds.slice(i + 1, i + CTX + 1);
    bl += model.forward(toks, tgt);
    model.backward(toks, tgt);
  }
  model.clipGrads(1.0);
  model.adamStep(lr, wd);
  lastTr = bl / BATCH;
  if ((s + 1) % 100 === 0) {
    const e = evaluate(model, ds.valIds, CTX, { maxWindows: 150, seed: 5 });
    if (e.loss < best.loss) best = { loss: e.loss, step: s + 1, ppl: e.ppl };
  }
}
const e = evaluate(model, ds.valIds, CTX, { maxWindows: 300, seed: 5 });
const tr = evaluate(model, ds.trainIds, CTX, { maxWindows: 300, seed: 6 });
console.log(JSON.stringify({
  label: `D=${D} L=${L} H=${H} lr=${lr} wd=${wd} mf=${MF} VR=${VR} steps=${STEP}`,
  V, trainTok: ds.trainIds.length, valTok: ds.valIds.length, params: model.nParams(),
  lastTrain: +lastTr.toFixed(3), valLoss: +e.loss.toFixed(3), valPpl: +e.ppl.toFixed(1),
  valAcc: +(e.acc * 100).toFixed(1), trainPpl: +tr.ppl.toFixed(1),
  bestLoss: +best.loss.toFixed(3), bestPpl: +best.ppl.toFixed(1), bestStep: best.step,
  bigramPpl: +big.ppl.toFixed(1), bigramAcc: +(big.acc * 100).toFixed(1),
  ratio: +(big.ppl / best.ppl).toFixed(2), sec: +((Date.now() - t0) / 1000).toFixed(0),
}));
