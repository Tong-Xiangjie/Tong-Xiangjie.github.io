// 侧倾/跑偏溯源：直线加速时左右对称性是怎么被打破的
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300, SUB = 4;
const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 3000, blend: 10 } });
const world = new CollisionWorld(terrain, new StaticWorld());

const spec = CAR_PRESETS.sedan;
console.log('传动布局:', JSON.stringify(spec.drivetrain ?? spec.drive ?? '（见 spec）'));
console.log('diff:', JSON.stringify(spec.differential ?? spec.diff ?? '（见 spec）'));

function run(label, controls, seconds, launchAt = 0) {
  const v = new Vehicle(spec, { subdivision: 2 });
  v.resetAt(world, 0, 0, 0);
  if (launchAt > 0) { for (let i = 0; i < 40; i++) { v.body.clearForces(); v.update(DT, world, {}); v.body.step(DT, world); } v.launch(launchAt); }
  let t = 0;
  console.log(`\n=== ${label} ===`);
  console.log('  t    速度   侧倾°   偏航率   vy      Fz[FL FR RL RR]              Fx[FL FR RL RR]');
  for (let f = 0; f < 60 * seconds; f++) {
    for (let s = 0; s < SUB; s++) { v.body.clearForces(); v.update(DT, world, typeof controls === 'function' ? controls(t, v) : controls); v.body.step(DT, world); t += DT; }
    if (f % 60 === 0) {
      const roll = Math.atan2(v.frame.up.x, v.frame.up.y) * 57.3;
      const yaw = v.frame.angVel.y;
      console.log(
        `${t.toFixed(1).padStart(5)} ${v.speedKmh.toFixed(1).padStart(6)} ${roll.toFixed(2).padStart(7)} ${yaw.toFixed(3).padStart(8)} ` +
        `${v.localVelocity.x.toFixed(2).padStart(6)}  ` +
        `[${v.wheels.map((w) => w.Fz.toFixed(0).padStart(6)).join(' ')}]  ` +
        `[${v.wheels.map((w) => w.Fx.toFixed(0).padStart(5)).join(' ')}]`,
      );
    }
  }
  return v;
}

run('A 全油门直线 6 秒', { throttle: 1 }, 6);
run('B 滑行（无驱动，25 m/s 初速）', {}, 6, 25);
run('E 空挡滑行（发动机不拖）', (t, v) => { v.drivetrain.gear = 0; return {}; }, 6, 25);
run('F 空挡滑行 + 车轮无驱动无制动', (t, v) => { v.drivetrain.gear = 0; for (const w of v.wheels) { w.driveTorque = 0; w.brakeTorque = 0; } return {}; }, 6, 25);
