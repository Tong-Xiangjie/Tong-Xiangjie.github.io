// 逐子步追踪左右前轮：找出侧倾发散的源头
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300;
const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 3000, blend: 10 } });
const world = new CollisionWorld(terrain, new StaticWorld());
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);

console.log('子步  轮   len     lenVel   pen      Fz      Fs     接触点y   组速度y   塔顶y    塔顶vy');
for (let s = 0; s < 10; s++) {
  v.body.clearForces();
  v.update(DT, world, {});
  v.body.step(DT, world);
  for (const w of [v.wheels[0], v.wheels[1]]) {
    const t = w.corner.towerIdx;
    console.log(
      `${String(s).padStart(3)}  ${w.name}  ${w.len.toFixed(4)} ${w.lenVel.toFixed(4).padStart(8)} ` +
      `${w.lastPen.toFixed(5).padStart(7)} ${w.Fz.toFixed(0).padStart(7)} ${w.springForce.toFixed(0).padStart(7)} ` +
      `${w.contactPoint.y.toFixed(4).padStart(7)} ${w.group.velocity.y.toFixed(4).padStart(8)} ` +
      `${v.body.py[t].toFixed(4).padStart(7)} ${v.body.vy[t].toFixed(4).padStart(8)}`);
  }
}
console.log('\n车轮顺序:', v.wheels.map((w) => w.name).join(', '));
