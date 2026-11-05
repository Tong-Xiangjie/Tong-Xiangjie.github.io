// 静置时车体受到的合力
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
let M = 0; for (let i = 0; i < b.nodeCount; i++) M += b.mass[i];
function comV() { let vz = 0; for (let i = 0; i < b.nodeCount; i++) vz += b.mass[i] * b.vz[i]; return vz / M; }
console.log('   t   com.vz    Σfx    Σfy    Σfz(前后)  轮胎Fx[FL FR RL RR]        轮胎Fz[FL FR RL RR]');
for (let f = 0; f < 60 * 2; f++) {
  let sfx = 0, sfy = 0, sfz = 0;
  for (let s = 0; s < SUB; s++) {
    b.clearForces(); v.update(DT, world, { gearMode: 'manual', selectGear: 0 });
    if (s === SUB - 1) { for (let i = 0; i < b.nodeCount; i++) { sfx += b.fx[i]; sfy += b.fy[i]; sfz += b.fz[i]; } }
    b.step(DT, world);
  }
  if (f % 10 === 0) {
    console.log(
      `${(f / 60).toFixed(2).padStart(5)} ${comV().toFixed(3).padStart(7)} ${sfx.toFixed(0).padStart(6)} ${sfy.toFixed(0).padStart(6)} ${sfz.toFixed(0).padStart(7)}  ` +
      `[${v.wheels.map((w) => w.Fx.toFixed(0).padStart(5)).join(' ')}] [${v.wheels.map((w) => w.Fz.toFixed(0).padStart(5)).join(' ')}]`,
    );
  }
}
