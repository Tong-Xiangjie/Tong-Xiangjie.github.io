// 物理耗时分解
import { Terrain, MATERIALS } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
const terrain = new Terrain({
  amplitude: 0, detail: 0, baseFrequency: 0.01, mountains: 0,
  flat: { cx: 0, cz: 0, radius: 2000, blend: 10 },
  roads: [{ points: [[0, 1500], [0, -1500]], width: 80, material: MATERIALS.ASPHALT, blend: 6 }],
});
const world = new CollisionWorld(terrain, new StaticWorld());
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);
const b = v.body;
const N = 60 * 4 * SUB;
const t0 = process.hrtime.bigint();
for (let s = 0; s < N; s++) { b.clearForces(); v.update(DT, world, { throttle: 0.4 }); }
const t1 = process.hrtime.bigint();
for (let s = 0; s < N; s++) { b.step(DT, world); }
const t2 = process.hrtime.bigint();
const ms = (x) => Number(x) / 1e6;
console.log(`vehicle.update 合计 ${ms(t1 - t0).toFixed(0)} ms → 每帧 ${(ms(t1 - t0) / (N / SUB)).toFixed(2)} ms`);
console.log(`body.step      合计 ${ms(t2 - t1).toFixed(0)} ms → 每帧 ${(ms(t2 - t1) / (N / SUB)).toFixed(2)} ms`);
console.log(`每子步 body.step = ${(ms(t2 - t1) / N * 1000).toFixed(0)} µs   (节点 ${b.nodeCount} 梁 ${b.beamCount} 迭代 ${b.iterations})`);
// 迭代次数敏感性
for (const it of [4, 6, 8, 10, 12]) {
  b.iterations = it;
  const a = process.hrtime.bigint();
  for (let s = 0; s < N; s++) b.step(DT, world);
  const c = process.hrtime.bigint();
  console.log(`  迭代 ${String(it).padStart(2)} → 每帧 ${(ms(c - a) / (N / SUB)).toFixed(2)} ms`);
}
