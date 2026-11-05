// 推力去哪了：逐轮滑移率 + 车体真实动量变化
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
const b = v.body;
const M = (() => { let m = 0; for (let i = 0; i < b.nodeCount; i++) m += b.mass[i]; return m; })();

function pz() { let p = 0; for (let i = 0; i < b.nodeCount; i++) p += b.mass[i] * b.vz[i]; return p; }

console.log('  t   km/h   真实pz/m  a(m/s²)  Fx总   每轮Fx[FL FR RL RR]      滑移率[FL FR RL RR]        转速[FL FR RL RR]');
let lastP = 0, lastT = 0;
for (let f = 0; f < 60 * 16; f++) {
  for (let s = 0; s < SUB; s++) { b.clearForces(); v.update(DT, world, { throttle: 1 }); b.step(DT, world); }
  if (f % 60 === 0) {
    const t = f / 60;
    const p = pz() / M;
    const a = t > 0 ? (p - lastP) / (t - lastT) : 0;
    lastP = p; lastT = t;
    const fx = v.wheels.map((w) => w.Fx);
    console.log(
      `${t.toFixed(1).padStart(4)} ${v.speedKmh.toFixed(1).padStart(6)} ${(-p).toFixed(2).padStart(9)} ${a.toFixed(2).padStart(7)} ${fx.reduce((s2, x) => s2 + x, 0).toFixed(0).padStart(7)} ` +
      `[${fx.map((x) => x.toFixed(0).padStart(5)).join(' ')}] [${v.wheels.map((w) => w.slipRatio.toFixed(2).padStart(6)).join(' ')}] [${v.wheels.map((w) => (w.spinRate * w.radius).toFixed(1).padStart(5)).join(' ')}]`,
    );
  }
}
