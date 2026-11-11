// 沥青高附着下到底哪一步炸了（逐子步）
import { Terrain, MATERIALS } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300;
function build(withRoad) {
  const terrain = new Terrain({
    amplitude: 0, detail: 0, baseFrequency: 0.01,
    flat: { cx: 0, cz: 0, radius: 2000, blend: 10 },
    ...(withRoad ? { roads: [{ points: [[0, 400], [0, -400]], width: 80, material: MATERIALS.ASPHALT, blend: 6 }] } : {}),
  });
  return new CollisionWorld(terrain, new StaticWorld());
}
for (const withRoad of [false, true]) {
  const world = build(withRoad);
  const v = new Vehicle(CAR_PRESETS.hatch, { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  const b = v.body;
  console.log(`\n=== road=${withRoad}  μ=${world.terrain.materialAt(0, 0).mu}  h(0,0)=${world.groundHeight(0, 0).toFixed(4)} 车高=${v.position.y.toFixed(4)}`);
  console.log(' 子步  最大|v|   最大Fz   悬挂长[FL..]        接地点pen');
  for (let s = 0; s < 12; s++) {
    b.clearForces();
    v.update(DT, world, { throttle: 0 });
    b.step(DT, world);
    let mv = 0;
    for (let i = 0; i < b.nodeCount; i++) { const sp = Math.hypot(b.vx[i], b.vy[i], b.vz[i]); if (sp > mv) mv = sp; }
    console.log(
      `${String(s).padStart(4)} ${mv.toFixed(2).padStart(9)} ${Math.max(...v.wheels.map((w) => w.Fz)).toFixed(0).padStart(8)} ` +
      `[${v.wheels.map((w) => w.len.toFixed(3)).join(' ')}] ${v.wheels.map((w) => (w.pen ?? 0).toFixed(3)).join(' ')}`,
    );
  }
}
