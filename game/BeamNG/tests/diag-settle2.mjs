// 静置时车体速度到底是多少
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
let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
function com() {
  let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
  for (let i = 0; i < b.nodeCount; i++) {
    cx += b.mass[i] * b.px[i]; cy += b.mass[i] * b.py[i]; cz += b.mass[i] * b.pz[i];
    vx += b.mass[i] * b.vx[i]; vy += b.mass[i] * b.vy[i]; vz += b.mass[i] * b.vz[i];
  }
  return { x: cx / M, y: cy / M, z: cz / M, vx: vx / M, vy: vy / M, vz: vz / M };
}
console.log('   t    速度v.speed  com.vx   com.vy   com.vz   frame.vx frame.vy frame.vz  com.x    com.y');
for (let f = 0; f < 60 * 3; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
  if (f % 15 === 0) {
    const c = com(), fv = v.frame.velocity;
    console.log(
      `${(f / 60).toFixed(2).padStart(5)} ${v.speed.toFixed(3).padStart(10)} ${c.vx.toFixed(4).padStart(8)} ${c.vy.toFixed(4).padStart(8)} ${c.vz.toFixed(4).padStart(8)} ` +
      `${fv.x.toFixed(4).padStart(8)} ${fv.y.toFixed(4).padStart(8)} ${fv.z.toFixed(4).padStart(8)} ${c.x.toFixed(5).padStart(8)} ${c.y.toFixed(4).padStart(8)}`,
    );
  }
}
