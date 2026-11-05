// 静置后车体的左右不对称到底出现在哪里
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
const world = new CollisionWorld(
  new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 4000, blend: 10 } }),
  new StaticWorld(),
);
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);
const b = v.body;
// 出厂（复位瞬间）位置，用来找镜像节点
const ix = Float64Array.from(b.px.subarray(0, b.nodeCount));
const iy = Float64Array.from(b.py.subarray(0, b.nodeCount));
const iz = Float64Array.from(b.pz.subarray(0, b.nodeCount));
const mirror = new Int32Array(b.nodeCount).fill(-1);
for (let i = 0; i < b.nodeCount; i++) {
  for (let j = 0; j < b.nodeCount; j++) {
    if (Math.abs(ix[j] + ix[i]) < 1e-6 && Math.abs(iy[j] - iy[i]) < 1e-6 && Math.abs(iz[j] - iz[i]) < 1e-6) { mirror[i] = j; break; }
  }
}
function report(tag) {
  const rows = [];
  for (let i = 0; i < b.nodeCount; i++) {
    const j = mirror[i];
    if (j < 0 || j <= i) continue;
    const dy = b.py[i] - b.py[j];
    rows.push({ i, j, dy, x: ix[i] - v.refFront.x * 0, y: iy[i], z: iz[i] });
  }
  rows.sort((a, c) => Math.abs(c.dy) - Math.abs(a.dy));
  console.log(`\n${tag} 最大左右高度差 top8：`);
  for (const r of rows.slice(0, 8)) {
    console.log(`   节点 ${r.i}/${r.j}  dy=${(r.dy * 1000).toFixed(1)}mm  出厂位置(${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)})`);
  }
}
report('刚落地 t=0');
for (let f = 0; f < 60 * 6; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
}
report('静置 6 秒后');
console.log('\n车身姿态 roll =', (Math.atan2(v.frame.up.x, v.frame.up.y) * 57.3).toFixed(2), '°');
