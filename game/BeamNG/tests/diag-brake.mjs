// 紧急制动：每轮纵向力到底发挥了多少
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
for (const preset of ['sedan', 'sports']) {
  const world = new CollisionWorld(
    new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 9000, blend: 10 } }),
    new StaticWorld(),
  );
  const v = new Vehicle(CAR_PRESETS[preset], { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  const b = v.body;
  for (let f = 0; f < 60; f++) for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
  v.launch(100 / 3.6);
  let dist = 0, x0 = v.position.z;
  console.log(`\n=== ${CAR_PRESETS[preset].name} 100-0 ===`);
  console.log('   t  km/h   米   FL[slip  Fx   Fz ]  FR[slip  Fx   Fz ]  RL[slip  Fx   Fz ]  ABS   μ    κ滤  grip');
  for (let f = 0; f < 60 * 7; f++) {
    for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, { brake: 1 }); b.step(DT, world); }
    if (f % 30 === 0 && v.speedKmh > 1) {
      const w = v.wheels, q = w[0];
      console.log(
        `${(f / 60).toFixed(2).padStart(5)} ${v.speedKmh.toFixed(0).padStart(5)} ${(v.position.z - x0).toFixed(1).padStart(6)} ` +
        w.map((z) => `[${z.slipRatio.toFixed(2).padStart(5)} ${z.Fx.toFixed(0).padStart(5)} ${z.Fz.toFixed(0).padStart(5)}]`).join(' ') +
        `  ${w.map((z) => (z.absActive ? 'A' : '.')).join('')} ${q.tire.lastMu.toFixed(2)} ${q.tire.slipRatioFiltered.toFixed(2).padStart(5)} ${(q.gripScale ?? 1).toFixed(2)}`,
      );
    }
    if (v.speedKmh <= 1 && dist === 0) dist = Math.abs(v.position.z - x0);
  }
  console.log(`   → 制动距离 ${dist.toFixed(1)} m`);
}
