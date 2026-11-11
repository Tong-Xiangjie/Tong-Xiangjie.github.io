// 落地静置：车应该迅速安静下来
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
for (const name of ['sedan', 'sports']) {
  const v = new Vehicle(CAR_PRESETS[name], { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  const b = v.body;
  let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
  console.log(`\n=== ${CAR_PRESETS[name].name} ===`);
  console.log('   t    |v|m/s   vy车体   Cy      len[FL FR RL RR]              Fz[FL FR RL RR]');
  for (let f = 0; f < 60 * 12; f++) {
    for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
    if (f % 60 === 0) {
      let vy = 0; for (let i = 0; i < b.nodeCount; i++) vy += b.mass[i] * b.vy[i];
      vy /= M;
      const roll = Math.atan2(v.frame.up.x, v.frame.up.y) * 57.3;
      console.log(
        `${(f / 60).toFixed(2).padStart(5)} ${v.speed.toFixed(3).padStart(7)} ${vy.toFixed(3).padStart(8)} ${v.frame.pos.y.toFixed(3).padStart(7)} ` +
        `${roll.toFixed(2).padStart(6)} [${v.wheels.map((w) => w.len.toFixed(3)).join(' ')}] [${v.wheels.map((w) => w.Fz.toFixed(0).padStart(5)).join(' ')}]`,
      );
    }
  }
}
