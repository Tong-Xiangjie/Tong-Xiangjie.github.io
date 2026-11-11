// 施加到车体的合力 vs 实际动量变化
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

function pz() { let p = 0; for (let i = 0; i < b.nodeCount; i++) p += b.mass[i] * b.vz[i]; return p; }
function sumF() { let f = 0; for (let i = 0; i < b.nodeCount; i++) f += b.fz[i]; return f; }
function sumT() { // 绕纵轴(y)的力矩
  let mx = 0, my = 0, mz = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < b.nodeCount; i++) { cx += b.px[i]; cy += b.py[i]; cz += b.pz[i]; }
  cx /= b.nodeCount; cy /= b.nodeCount; cz /= b.nodeCount;
  for (let i = 0; i < b.nodeCount; i++) {
    const rx = b.px[i] - cx, ry = b.py[i] - cy, rz = b.pz[i] - cz;
    mx += ry * b.fz[i] - rz * b.fy[i]; my += rz * b.fx[i] - rx * b.fz[i]; mz += rx * b.fy[i] - ry * b.fx[i];
  }
  return { mx, my, mz };
}

console.log('  t  km/h   ΣFz(车体)  ΣFz+重力  推力Fz(轮胎合)  绕横轴力矩Mx  a实测  a=F/M');
let lastP = 0, lastT = 0;
for (let f = 0; f < 60 * 12; f++) {
  let appliedFz = 0, appliedMx = 0;
  for (let s = 0; s < SUB; s++) {
    b.clearForces();
    v.update(DT, world, { throttle: 1 });
    if (s === SUB - 1) { appliedFz = sumF(); appliedMx = sumT().mx; }
    b.step(DT, world);
  }
  if (f % 60 === 0) {
    const t = f / 60, p = pz() / M;
    const a = t > 0 ? (p - lastP) / (t - lastT) : 0;
    lastP = p; lastT = t;
    const tireF = v.wheels.reduce((s2, w) => s2 + w.Fx, 0);
    console.log(
      `${t.toFixed(1).padStart(4)} ${v.speedKmh.toFixed(1).padStart(5)} ${appliedFz.toFixed(0).padStart(10)} ${(appliedFz - M * 9.81).toFixed(0).padStart(10)} ` +
      `${tireF.toFixed(0).padStart(13)} ${appliedMx.toFixed(0).padStart(12)} ${(-a).toFixed(2).padStart(7)} ${(appliedFz / M).toFixed(2).padStart(7)}`,
    );
  }
}
