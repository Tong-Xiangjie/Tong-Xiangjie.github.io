// 从 index.html 里抽出内联脚本，在 Node 里用最小 DOM 桩真实训练一段，验证生成物可用
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];

// ---- 最小 DOM 桩 ----
const state = {};
const listeners = {};
const makeEl = (id) => ({
  id, value: '', textContent: '', className: '', disabled: false, width: 1040, height: 200,
  addEventListener(ev, fn) { (listeners[id] = listeners[id] || {})[ev] = fn; },
  getContext() {
    return {
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
      setLineDash() {}, lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
    };
  },
});
const el = (id) => (state[id] = state[id] || makeEl(id));
globalThis.document = { getElementById: el, body: { appendChild() {}, removeChild() {} }, createElement: () => makeEl('tmp') };
const defaults = {
  dModel: '32', nLayers: '2', nHeads: '4', ctx: '32', batch: '8',
  lr: '0.008', wd: '0.1', minFreq: '2', genLen: '80', temp: '0.8',
  topK: '40', topP: '0.9', rpen: '1.1', ngram: '3', prompt: '人之初',
};
for (const [k, v] of Object.entries(defaults)) el(k).value = v;

// ---- localStorage 桩（node 里没有，用内存 Map 顶替） ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let frames = 0, maxFrames = Number(process.env.FRAMES || 40);
globalThis.requestAnimationFrame = (fn) => { if (frames++ < maxFrames) setTimeout(fn, 0); };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// 暴露出被测函数（模板用顶层 const/function 定义）
const runner = code + `
;globalThis.__api = { initModel, tick, generate, trainBatch, evaluateNow, saveCheckpoint, loadCheckpoint,
  checkVocab, vocabFingerprint, encodeCheckpoint, decodeCheckpoint, loadInto,
  get ds(){return ds}, get model(){return model}, get step(){return step}, get curves(){return curves},
  get lastVal(){return lastVal}, get bestVal(){return bestVal} };`;
writeFileSync(new URL('./_built-script.mjs', import.meta.url), runner, 'utf8');

const t0 = Date.now();
await import('./_built-script.mjs');
const api = globalThis.__api;
console.log('初始化完成：V =', api.ds.strs.length, ' 训练 token =', api.ds.trainIds.length,
  ' 验证 token =', api.ds.valIds.length, ' 参数量 =', api.model.nParams());
console.log('bigram 基线 ppl =', api.model.bigram.ppl.toFixed(1), ' acc =', (api.model.bigram.acc * 100).toFixed(1) + '%');

// 手动跑训练（不依赖 rAF）
for (let f = 0; f < maxFrames; f++) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < 260) last = api.trainBatch();
  const e = api.evaluateNow(40);
  api.curves.push({ step: api.step, train: last.trainLoss, val: e.loss });
  if (f % 10 === 0 || f === maxFrames - 1) {
    console.log(`  帧 ${String(f).padStart(2)}  step=${String(api.step).padStart(4)}  train=${last.trainLoss.toFixed(3)}  val=${e.loss.toFixed(3)} ppl=${e.ppl.toFixed(1)} acc=${(e.acc * 100).toFixed(1)}%`);
  }
  if (e.loss !== e.loss) { console.log('  ❌ 出现 NaN'); break; }
}
console.log(`共 ${api.step} 步，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 生成
api.generate();
const out = state['out'].textContent;
console.log('生成样例（prompt=人之初）：', JSON.stringify(out.slice(0, 60)));
console.log(out && out.length > 10 ? '✅ 生成非空' : '❌ 生成为空');

// 存档往返（走真实的 UI 函数）
const stepBefore = api.step;
await api.saveCheckpoint();
console.log('存档：', state['ckptStatus'].textContent);
const injected = api.decodeCheckpoint ? await api.decodeCheckpoint(globalThis.localStorage.getItem('txj-llm-v2-checkpoint')) : null;
console.log('存档校验：步数 =', injected.state.step, ' 参数块 =', injected.state.params.length,
  ' Adam 块 =', injected.state.adam ? injected.state.adam.entries.length : 0);
console.log(stepBefore === injected.state.step ? '✅ 存档记录了正确的步数' : '❌ 步数不符');

// 破坏内存里的权重，再从存档读回来，verify 权重确实被恢复
const probe = api.model.E[3];
api.model.E[3] = 999;
await api.loadCheckpoint();
console.log('读取：', state['ckptStatus'].textContent);
console.log(api.model.E[3] === probe ? '✅ 读档恢复了权重' : `❌ 权重未恢复（${api.model.E[3]} vs ${probe}）`);
console.log('读档后 E === Wout（权重共享仍在）:', api.model.E === api.model.Wout ? '✅' : '❌');
