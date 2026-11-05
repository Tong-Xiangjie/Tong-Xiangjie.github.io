// 起步时前左轮到底发生了什么
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
console.log('   t  km/h  gear  油门  driveTq  spin    vx   slipR    Fx    Fz   tcActive 离合  接合');
for (let f = 0; f < 60 * 6; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, { throttle: 1 }); b.step(DT, world); }
  if (f % 15 === 0) {
    console.log(
      `${(f / 60).toFixed(2).padStart(5)} ${v.speedKmh.toFixed(1).padStart(5)} ${String(d.gear).padStart(5)} ${d.throttle.toFixed(2).padStart(6)} ` +
      `${w.driveTorque.toFixed(0).padStart(8)} ${w.spinRate.toFixed(2).padStart(6)} ${w.vx.toFixed(2).padStart(6)} ${w.slipRatio.toFixed(3).padStart(7)} ` +
      `${w.Fx.toFixed(0).padStart(6)} ${w.Fz.toFixed(0).padStart(6)} ${String(w.tcActive).padStart(9)} ${d.clutchTorque.toFixed(0).padStart(7)} ${d.clutchEngagement.toFixed(2).padStart(6)}`,
    );
  }
}
