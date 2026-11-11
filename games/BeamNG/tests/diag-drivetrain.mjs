// 传动链逐步诊断：为什么极速上不去
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 3000, blend: 10 } });
const world = new CollisionWorld(terrain, new StaticWorld());
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);

let simT = 0;
console.log('  t    速度   转速   挡  油门  离合   离合力矩  轴扭矩   驱动轮Fx  滑移率  阻力      Fz前');
for (let frame = 0; frame < 60 * 20; frame++) {
  for (let s = 0; s < SUB; s++) {
    v.body.clearForces();
    v.update(DT, world, { throttle: 1 });
    v.body.step(DT, world);
    simT += DT;
  }
  if (frame % 60 === 0) {
    const dt = v.drivetrain;
    const parts = v.wheels.map((w) =>
      `${w.name}:Fz=${w.Fz.toFixed(0).padStart(5)} Fx=${w.Fx.toFixed(0).padStart(5)} sa=${(w.slipAngle * 57.3).toFixed(1).padStart(5)} len=${w.len.toFixed(3)} tr=${w.travel01().toFixed(2)}${w.detached ? ' X' : ''}`);
    const pitch = Math.asin(v.frame.fwd.y) * 57.3;
    console.log(`\n t=${simT.toFixed(1)}s  ${v.speedKmh.toFixed(1)} km/h  ${dt.gearLabel}  rpm=${dt.rpm.toFixed(0)}  ` +
      `pitch=${pitch.toFixed(1)}°  CoMy=${v.position.y.toFixed(3)}  a=${v.gForce.z.toFixed(2)}g`);
    for (const p of parts) console.log('    ' + p);
  }
  if (frame % 30 === 0 && frame % 60 !== 0) {
    const dt = v.drivetrain;
    console.log(` t=${simT.toFixed(1)} v=${v.speedKmh.toFixed(0)}km/h ${dt.gearLabel} rpm=${dt.rpm.toFixed(0)} ` +
      `Fz=[${v.wheels.map((w) => w.Fz.toFixed(0)).join(',')}]`);
  }
}
console.log(`\n最终：${v.speedKmh.toFixed(1)} km/h，挡位 ${v.drivetrain.gearLabel}，转速 ${v.drivetrain.rpm.toFixed(0)}`);
