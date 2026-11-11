// 静置振荡源：离合扭矩 / 车轮转速
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
const b = v.body, d = v.drivetrain;
let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
function comV() { let vz = 0; for (let i = 0; i < b.nodeCount; i++) vz += b.mass[i] * b.vz[i]; return vz / M; }
console.log('   t   com.vz   gear  rpm   clutchNm  capNm  前轮spinRate  前轮Fx    前轮Fz');
for (let f = 0; f < 60 * 2; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
  if (f % 10 === 0) {
    console.log(
      `${(f / 60).toFixed(2).padStart(5)} ${comV().toFixed(3).padStart(7)} ${String(d.gear).padStart(5)} ${d.rpm.toFixed(0).padStart(5)} ` +
      `${d.clutchTorque.toFixed(1).padStart(9)} ${d.clutchCapacity.toFixed(1).padStart(7)} ${v.wheels[0].spinRate.toFixed(2).padStart(12)} ` +
      `${v.wheels[0].Fx.toFixed(0).padStart(8)} ${v.wheels[0].Fz.toFixed(0).padStart(8)}`,
    );
  }
}
