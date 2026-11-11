// 结构对称性 + 车体侧向质心漂移
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
const world = new CollisionWorld(
  new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 3000, blend: 10 } }),
  new StaticWorld(),
);
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);
const bd = v.body;

// --- 1. 梁集合是否左右镜像对称 ---
const key = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
const mirrorOf = new Int32Array(bd.nodeCount).fill(-1);
for (let i = 0; i < bd.nodeCount; i++) {
  for (let j = 0; j < bd.nodeCount; j++) {
    if (Math.abs(bd.px[j] + bd.px[i]) < 1e-6 && Math.abs(bd.py[j] - bd.py[i]) < 1e-6 && Math.abs(bd.pz[j] - bd.pz[i]) < 1e-6) { mirrorOf[i] = j; break; }
  }
}
const beamSet = new Set();
for (let k = 0; k < bd.beamCount; k++) beamSet.add(key(bd.ba[k], bd.bb[k]));
let broken = 0; const samples = [];
for (let k = 0; k < bd.beamCount; k++) {
  const ma = mirrorOf[bd.ba[k]], mb = mirrorOf[bd.bb[k]];
  if (ma < 0 || mb < 0) continue;                        // 中线节点，忽略
  if (!beamSet.has(key(ma, mb))) { broken++; if (samples.length < 5) samples.push(`梁 ${k}: ${bd.ba[k]}-${bd.bb[k]} → 镜像 ${ma}-${mb} 不存在`); }
}
console.log(`梁镜像对称性：${bd.beamCount} 根梁中 ${broken} 根缺少镜像`);
for (const s of samples) console.log('   ', s);

// --- 2. 滑行时车体侧向质心漂移 ---
function com() {
  let M = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < bd.nodeCount; i++) { const m = bd.mass[i]; M += m; cx += m * bd.px[i]; cy += m * bd.py[i]; cz += m * bd.pz[i]; }
  return { x: cx / M, y: cy / M, z: cz / M, M };
}
function warp() {
  // 左右镜像节点的 y 差（扭转量度）
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < bd.nodeCount; i++) {
    const j = mirrorOf[i];
    if (j < 0 || j <= i) continue;
    const d = Math.abs(bd.py[i] - bd.py[j]);
    sum += d; n++; if (d > max) max = d;
  }
  return { max, mean: sum / Math.max(1, n) };
}

for (let i = 0; i < 40; i++) { bd.clearForces(); v.update(DT, world, {}); bd.step(DT, world); }
v.launch(25);
console.log('\n   t    roll°   CoM.x     CoM.y    扭曲max   扭曲mean   Fz');
for (let f = 0; f < 60 * 5; f++) {
  for (let s = 0; s < SUB; s++) { bd.clearForces(); v.update(DT, world, {}); bd.step(DT, world); }
  if (f % 30 === 0) {
    const c = com(), w = warp();
    const roll = Math.atan2(v.frame.up.x, v.frame.up.y) * 57.3;
    console.log(`${(f / 60).toFixed(1).padStart(5)} ${roll.toFixed(2).padStart(7)} ${c.x.toFixed(5).padStart(9)} ${c.y.toFixed(4).padStart(9)} ` +
      `${w.max.toFixed(5).padStart(9)} ${w.mean.toFixed(5).padStart(9)}  [${v.wheels.map((x) => x.Fz.toFixed(0)).join(',')}]`);
  }
}
