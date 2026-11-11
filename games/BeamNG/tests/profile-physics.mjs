// 物理分阶段耗时剖析 + 形变指标自检
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300;
const SUB = 4;

const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 2000, blend: 10 } });
const statics = new StaticWorld();
const world = new CollisionWorld(terrain, statics);
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.reset(0, 1.2, 0, 0);
console.log(`节点 ${v.body.nodeCount} / 梁 ${v.body.beamCount} / 迭代 ${v.body.iterations}`);

// 预热
for (let i = 0; i < 300; i++) { v.body.clearForces(); v.update(DT, world, { throttle: 0.5 }); v.body.step(DT, world); }

const acc = {};
function timeIt(key, fn, iters) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn(i);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  acc[key] = (acc[key] || 0) + ms;
  return ms;
}

const N = 400;   // 100 帧
// 1) 地形查询单独测
timeIt('terrain.height', () => { for (let i = 0; i < v.body.nodeCount; i++) terrain.height(0, i * 0.01); }, N);
timeIt('terrain.normal', () => { for (let i = 0; i < v.body.nodeCount; i++) terrain.normal(0, i * 0.01); }, N);
timeIt('terrain.materialAt', () => { for (let i = 0; i < 20; i++) terrain.materialAt(i * 0.1, i * 0.2); }, N);

// 2) 整车 update（不含 step）
timeIt('vehicle.update', () => { v.body.clearForces(); v.update(DT, world, { throttle: 0.6, steer: 0.3 }); }, N * SUB);
// 3) 软体 step
timeIt('softbody.step', () => { v.body.step(DT, world); }, N * SUB);
// 4) 单独测 solvePositions
timeIt('solvePositions', () => { v.body.solvePositions(v.body.iterations); }, N * SUB);
// 5) 接触收集
timeIt('collectContacts', () => { v.body.collectContacts(world); }, N * SUB);
// 6) 塑性
timeIt('updatePlasticity', () => { v.body.updatePlasticity(); }, N * SUB);
// 7) updateFrame
timeIt('updateFrame', () => { v.updateFrame(); }, N * SUB);

const frames = N;
console.log(`\n每帧（${SUB} 子步）耗时分解：`);
let total = 0;
for (const [k, ms] of Object.entries(acc)) {
  const perFrame = ms / frames;
  total += perFrame;
  console.log(`  ${k.padEnd(18)} ${perFrame.toFixed(3)} ms`);
}
console.log(`  ${'合计'.padEnd(16)} ${total.toFixed(3)} ms`);

// --- 形变指标自检 ---
const v2 = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v2.reset(0, 1.0, 0, 0);
for (let i = 0; i < 30; i++) { v2.body.clearForces(); v2.update(DT, world, {}); v2.body.step(DT, world); }
console.log(`\n静止 0.1s 后 deformation = ${(v2.deformation * 100).toFixed(2)} cm（应接近 0）`);
for (let i = 0; i < 3000; i++) { v2.body.clearForces(); v2.update(DT, world, { throttle: 1 }); v2.body.step(DT, world); }
console.log(`行驶 ${v2.odo.toFixed(1)} m 后 deformation = ${(v2.deformation * 100).toFixed(2)} cm（应仍然很小）`);
console.log(`位置 z = ${v2.position.z.toFixed(1)}`);
