// 静置时前左轮的滑移与力
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
const b = v.body, d = v.drivetrain, w = v.wheels[0];
let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
const fr = () => { let vz = 0; for (let i = 0; i < b.nodeCount; i++) vz += b.mass[i] * b.vz[i]; return vz / M; };
console.log('   t  com.vz  spinRate   vx     slipR   Fx     Fz    len    离合   接合   rpm');
for (let f = 0; f < 60 * 2; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
  if (f % 8 === 0) {
    console.log(
      `${(f / 60).toFixed(2).padStart(5)} ${fr().toFixed(3).padStart(7)} ${w.spinRate.toFixed(3).padStart(9)} ${w.vx.toFixed(3).padStart(7)} ` +
      `${w.slipRatio.toFixed(3).padStart(7)} ${w.Fx.toFixed(0).padStart(6)} ${w.Fz.toFixed(0).padStart(6)} ${w.len.toFixed(4).padStart(7)} ` +
      `${d.clutchTorque.toFixed(1).padStart(7)} ${d.clutchEngagement.toFixed(2).padStart(6)} ${d.rpm.toFixed(0).padStart(5)}`,
    );
  }
}
