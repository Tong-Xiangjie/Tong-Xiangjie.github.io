// 传动链溯源：为什么极速上不去
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
const d = v.drivetrain;

console.log('  t    km/h  gear  rpm   inputRpm  clutchNm  capNm  轴扭矩  推力N  阻力N');
for (let f = 0; f < 60 * 30; f++) {
  for (let s = 0; s < SUB; s++) { v.body.clearForces(); v.update(DT, world, { throttle: 1 }); v.body.step(DT, world); }
  if (f % 90 === 0) {
    const front = (d.frontWheels[0].spinRate + d.frontWheels[1].spinRate) * 0.5;
    const inputRpm = front * d.gearRatio * d.gearbox.finalDrive * 60 / (2 * Math.PI);
    const thrust = d.frontWheels[0].Fx + d.frontWheels[1].Fx + d.rearWheels[0].Fx + d.rearWheels[1].Fx;
    const drag = 0.5 * 1.225 * v.speed ** 2 * 0.3 * 2.2 + 0.013 * 1420 * 9.81;
    console.log(
      `${(f / 60).toFixed(1).padStart(5)} ${v.speedKmh.toFixed(1).padStart(6)} ${String(d.gear).padStart(4)} ${d.rpm.toFixed(0).padStart(6)} ` +
      `${inputRpm.toFixed(0).padStart(9)} ${d.clutchTorque.toFixed(0).padStart(9)} ${d.clutchCapacity.toFixed(0).padStart(7)} ` +
      `${d.driveshaftTorque.toFixed(0).padStart(7)} ${thrust.toFixed(0).padStart(7)} ${drag.toFixed(0).padStart(7)}`,
    );
  }
}
