// 定位静置自激源：逐个关掉候选通路
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
function mk() {
  const world = new CollisionWorld(
    new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 4000, blend: 10 } }),
    new StaticWorld(),
  );
  const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  return { v, world };
}
function run(label, setup) {
  const { v, world } = mk();
  const b = v.body;
  let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
  const seq = [];
  for (let f = 0; f < 60 * 3; f++) {
    for (let s = 0; s < SUB; s++) { setup?.(v); b.clearForces(); v.update(DT, world, {}); b.step(DT, world); }
    if (f % 20 === 0) { let vz = 0; for (let i = 0; i < b.nodeCount; i++) vz += b.mass[i] * b.vz[i]; seq.push((vz / M).toFixed(2)); }
  }
  console.log(`${label.padEnd(26)} ${seq.join(' ')}`);
}
run('A 基线');
run('B 离合强制分离', (v) => { v.drivetrain.clutchEngagement = 0; v.drivetrain.clutchCapacity = 0; });
run('C 无纵向轮胎力', (v) => { for (const w of v.wheels) w.tire.p.muBase = 0.0001; });
run('D 无滚动阻力', (v) => { for (const w of v.wheels) w.tire.p.rollingResistance = 0; });
run('E 无内部阻尼', (v) => { v.body.internalDamping = 0; });
run('F 悬挂阻尼 x3', (v) => { for (const w of v.wheels) { w.susp.bumpDamping *= 3; w.susp.reboundDamping *= 3; } });
run('G 车轮转动惯量 x20', (v) => { for (const w of v.wheels) w.IwEffective = w.Iw * 20; });
