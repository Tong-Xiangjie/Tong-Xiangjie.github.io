// 多车型极速/加速对比
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
function makeWorld() {
  return new CollisionWorld(
    new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 8000, blend: 10 } }),
    new StaticWorld(),
  );
}
for (const name of Object.keys(CAR_PRESETS)) {
  const spec = CAR_PRESETS[name];
  const world = makeWorld();
  const v = new Vehicle(spec, { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  const d = v.drivetrain;
  let t100 = -1, t = 0, top = 0;
  for (let f = 0; f < 60 * 60; f++) {
    for (let s = 0; s < SUB; s++) { v.body.clearForces(); v.update(DT, world, { throttle: 1 }); v.body.step(DT, world); t += DT; }
    if (t100 < 0 && v.speedKmh >= 100) t100 = t;
    if (f > 60 * 40) top = Math.max(top, v.speedKmh);
  }
  const gb = spec.gearbox;
  const topRatio = gb.ratios[gb.ratios.length - 1] * gb.finalDrive;
  const rpmAt120 = 120 / 3.6 / spec.wheel.radius * topRatio * 60 / (2 * Math.PI);
  console.log(
    `${spec.name.padEnd(10)} 0-100=${t100.toFixed(1).padStart(5)}s  极速=${top.toFixed(0).padStart(4)} km/h  ` +
    `6挡总传动比=${topRatio.toFixed(2)} 120km/h时转速=${rpmAt120.toFixed(0)}  红线=${spec.engine.redline} 挡=${d.gear} 末转速=${d.rpm.toFixed(0)}`,
  );
}
