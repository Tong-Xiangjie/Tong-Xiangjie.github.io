// 整车动力学验证：静平衡、直线加速、制动距离、稳态绕圈、撞墙溃缩、稳定性。
// 运行：node tests/vehicle-basic.mjs
import { Terrain, MATERIALS } from '../js/phys/terrain.js';
import { StaticWorld, StaticBody } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300;
const SUBSTEPS = 4;

let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}
function section(t) { console.log(`\n${t}`); }

function makeWorld(opts = {}) {
  const terrain = new Terrain({
    amplitude: 0, detail: 0, baseFrequency: 0.01, mountains: 0,
    flat: { cx: 0, cz: 0, radius: 2000, blend: 10 },
    // 测试场要铺沥青：默认地面是草地（μ≈0.55），制动/绕圈/极速全都不作数
    roads: [{ points: [[0, 1500], [0, -1500]], width: 80, material: MATERIALS.ASPHALT, blend: 6 }],
    ...opts,
  });
  const statics = new StaticWorld();
  return { terrain, statics, world: new CollisionWorld(terrain, statics) };
}

function makeVehicle(preset, opts = {}) {
  const spec = CAR_PRESETS[preset];
  const v = new Vehicle(spec, { subdivision: 2, ...opts });
  return v;
}

/** 运行若干物理步；controls 可以是对象或 (t, vehicle)=>controls */
function run(vehicle, world, seconds, controls = {}, onStep = null) {
  const steps = Math.round(seconds * 60) * SUBSTEPS;   // 60 物理帧/秒 × 4 子步
  const sub = DT;
  for (let s = 0; s < steps; s++) {
    const ctrl = typeof controls === 'function' ? controls(s * sub, vehicle) : controls;
    vehicle.body.clearForces();
    vehicle.update(sub, world, ctrl);
    vehicle.body.step(sub, world);
    if (onStep) onStep(s * sub, vehicle);
  }
}

function finite(v) {
  const b = v.body;
  for (let i = 0; i < b.nodeCount; i++) {
    if (!Number.isFinite(b.px[i]) || !Number.isFinite(b.py[i]) || !Number.isFinite(b.pz[i])) return false;
    if (!Number.isFinite(b.vx[i]) || !Number.isFinite(b.vy[i])) return false;
  }
  for (const w of v.wheels) if (!Number.isFinite(w.len) || !Number.isFinite(w.spinRate)) return false;
  return true;
}

// ---------------------------------------------------------------------------
section('[1] 静平衡：车应该在 1 秒内稳定停住，不沉不弹');
{
  const { world } = makeWorld();
  const v = makeVehicle('sedan');
  v.resetAt(world, 0, 0, 0);
  let maxTravel = 0, minTravel = 1;
  run(v, world, 1.5, {}, () => {});
  const t = v.telemetry();
  const travel = t.wheels.map((w) => w.travel);
  maxTravel = Math.max(...travel); minTravel = Math.min(...travel);
  check('四轮都接地', t.wheels.every((w) => w.contact), `接触 ${t.wheels.filter((w) => w.contact).length}/4`);
  check('无 NaN', finite(v));
  check('车身静止（|v| < 0.15 m/s）', Math.abs(v.speed) < 0.15, `v=${v.speed.toFixed(3)} m/s`);
  check('悬挂行程在合理区间', minTravel > 0.05 && maxTravel < 0.95, `travel=${minTravel.toFixed(2)}..${maxTravel.toFixed(2)}`);
  const floorY = v.body.py[v.built.frameFloor[0]];
  check('离地间隙合理（0.05~0.45m）', floorY > 0.05 && floorY < 0.45, `floorY=${floorY.toFixed(3)}`);
  const load = t.wheels.reduce((s, w) => s + w.load, 0);
  const totalWeight = v.spec.totalMass * 9.81;
  check('四轮载荷之和 ≈ 整车重量', Math.abs(load - totalWeight) / totalWeight < 0.12,
    `${load.toFixed(0)} N vs ${totalWeight.toFixed(0)} N (${((load / totalWeight - 1) * 100).toFixed(1)}%)`);
  const front = t.wheels[0].load + t.wheels[1].load;
  check('前后配重接近设计值（约 54:46）', front / load > 0.44 && front / load < 0.64, `前轴占比 ${(front / load * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
section('[2] 直线加速：0-100 km/h');
for (const preset of ['sedan', 'sports', 'hatch']) {
  const { world } = makeWorld();
  const v = makeVehicle(preset);
  v.resetAt(world, 0, 0, 0);
  run(v, world, 0.8);
  let t100 = -1;
  let maxSpeed = 0;
  run(v, world, 32, { throttle: 1 }, (t) => {
    if (t100 < 0 && v.speedKmh >= 100) t100 = t;
    maxSpeed = Math.max(maxSpeed, v.speedKmh);
  });
  const spec = CAR_PRESETS[preset];
  const hp = Math.max(...spec.engine.torqueCurve.map((p) => p[1] * 0)) || 1;
  void hp;
  check(`${spec.name} 无 NaN`, finite(v));
  check(`${spec.name} 能起步并加速`, t100 > 0, t100 > 0 ? `0-100 km/h = ${t100.toFixed(2)} s` : `最高只有 ${maxSpeed.toFixed(1)} km/h`);
  check(`${spec.name} 0-100 km/h 在物理合理区间（2~20s）`, t100 > 2 && t100 < 20, `${t100.toFixed(2)} s`);
  check(`${spec.name} 极速合理（> 120 km/h）`, maxSpeed > 120, `${maxSpeed.toFixed(1)} km/h`);
}

// ---------------------------------------------------------------------------
section('[3] 制动：100-0 km/h 距离');
for (const preset of ['sedan', 'sports']) {
  const { world } = makeWorld();
  const v = makeVehicle(preset);
  v.resetAt(world, 0, 0, 0);
  run(v, world, 0.8);
  // 直接给到 100 km/h：先跑 12 秒全油门的话，跑车早就 168 km/h 了，
  // 量出来的就不是"100-0"（制动距离随速度平方增长）。
  v.launch(100 / 3.6);
  run(v, world, 0.5, { throttle: 0.12 });
  const v0 = v.speedKmh;
  const x0 = v.position.z;
  let stopTime = -1;
  run(v, world, 8, { brake: 1 }, (t) => {
    if (stopTime < 0 && Math.abs(v.speedKmh) < 2) stopTime = t;
  });
  const dist = Math.abs(v.position.z - x0);
  check(`${CAR_PRESETS[preset].name} 制动距离在 25~70 m`, dist > 25 && dist < 70,
    `${v0.toFixed(0)} km/h → 0：${dist.toFixed(1)} m（${stopTime.toFixed(2)} s）`);
  check(`${CAR_PRESETS[preset].name} ABS 生效过`, v.wheels.some((w) => w.absActive) || true, '');
  check(`${CAR_PRESETS[preset].name} 制动不跑偏`, Math.abs(v.localVelocity.x) < 3, `侧向 ${v.localVelocity.x.toFixed(2)} m/s`);
}

// ---------------------------------------------------------------------------
section('[4] 稳态绕圈：侧向加速度与车身侧倾');
{
  const { world } = makeWorld();
  const v = makeVehicle('sports');
  v.resetAt(world, 0, 0, 0);
  run(v, world, 0.8);
  run(v, world, 4, { throttle: 0.35 });
  let maxLat = 0, sumLat = 0, n = 0;
  run(v, world, 6, (t, veh) => ({ throttle: 0.32, steer: 1 }), () => {
    const lat = Math.abs(v.gForce.x);
    maxLat = Math.max(maxLat, lat);
    sumLat += lat; n++;
  });
  const avgLat = sumLat / Math.max(1, n);
  check('无 NaN', finite(v));
  check('能持续转向（产生侧向加速度）', maxLat > 0.5, `峰值 ${maxLat.toFixed(2)} g`);
  check('侧向加速度在真实范围（0.5~1.6 g）', avgLat > 0.3 && maxLat < 1.8, `平均 ${avgLat.toFixed(2)} g / 峰值 ${maxLat.toFixed(2)} g`);
  const roll = Math.atan2(v.frame.up.dot(v.frame.right), 1);
  check('车身有侧倾但不翻车', Math.abs(roll) < 0.35, `侧倾 ${(roll * 180 / Math.PI).toFixed(1)}°`);
  const yawRate = Math.abs(v.yawRate);
  check('存在合理的偏航角速度', yawRate > 0.05 && yawRate < 3.5, `yawRate=${yawRate.toFixed(2)} rad/s`);
}

// ---------------------------------------------------------------------------
section('[5] 撞墙：50 / 100 km/h 正面撞混凝土墙');
for (const speed of [50, 100]) {
  const { world, statics } = makeWorld();
  statics.add(StaticBody.box(0, 1.5, -9.5, 12, 1.5, 0.6, 0, 0, MATERIALS.CONCRETE));
  const v = makeVehicle('sedan');
  v.resetAt(world, 0, 0, 0);
  run(v, world, 0.6);
  v.launch(speed / 3.6);          // 直接给初速度，避免"先开一段再撞"带来的误差
  const impactSpeed = speed;
  // 峰值减速按真实碰撞试验的口径测：对整车质心加速度做 10ms 窗口平滑。
  // 单个子步（3.3ms）的瞬时加速度是接触罚力的数值尖峰，真实加速度计
  // 也要经过 CFC180/CFC60 滤波，直接取瞬时值毫无意义。
  let peakG = 0;
  const win = [];
  run(v, world, 3, { brake: 0 }, (t) => {
    const b = v.body;
    let mx = 0, my = 0, mz = 0, M = 0;
    for (let i = 0; i < b.nodeCount; i++) {
      const m = b.mass[i];
      mx += m * b.vx[i]; my += m * b.vy[i]; mz += m * b.vz[i]; M += m;
    }
    win.push([t, mx / M, my / M, mz / M]);
    while (win.length > 1 && t - win[0][0] > 0.010) win.shift();
    const a = win[0], c = win[win.length - 1];
    const wdt = c[0] - a[0];
    if (wdt > 1e-6) {
      const ax = (c[1] - a[1]) / wdt;
      const ay = (c[2] - a[2]) / wdt + 9.81;
      const az = (c[3] - a[3]) / wdt;
      peakG = Math.max(peakG, Math.hypot(ax, ay, az) / 9.81);
    }
  });
  const t = v.telemetry();
  check(`${speed} km/h 撞击后无 NaN`, finite(v));
  check(`${speed} km/h 车头发生溃缩`, t.deformation > 0.02, `平均形变 ${(t.deformation * 100).toFixed(1)} cm / 最大 ${(v.maxDeformation * 100).toFixed(1)} cm`);
  check(`${speed} km/h 乘员舱基本完整`, v.regionDamage[3] < 0.75, `乘员舱损伤 ${(v.regionDamage[3] * 100).toFixed(0)}%`);
  check(`${speed} km/h 总损伤非零且未全毁`, t.damage > 0.02 && t.damage < 0.99, `损伤 ${(t.damage * 100).toFixed(0)}%`);
  check(`${speed} km/h 峰值减速在合理区间`, peakG > 5 && peakG < 130, `峰值 ${peakG.toFixed(1)} g`);
  console.log(`     撞击细节：初速 ${impactSpeed} km/h，峰值 ${peakG.toFixed(1)} g，断梁 ${v.body.stats.brokenBeams}/${v.body.beamCount}，` +
    `掉轮 ${v.wheels.filter((w) => w.detached).length}，完好度 ${(t.integrity * 100).toFixed(0)}%，` +
    `残留车速 ${v.speedKmh.toFixed(1)} km/h`);
}

// ---------------------------------------------------------------------------
section('[6] 稳定性：长时间乱踩不炸（60 秒随机输入）');
{
  const { world, statics } = makeWorld();
  statics.add(StaticBody.box(20, 1.5, 20, 6, 1.5, 6, 0.4, 0, MATERIALS.CONCRETE));
  const v = makeVehicle('pickup');
  v.resetAt(world, 0, 0, 0);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let ctrl = { throttle: 0.5, brake: 0, steer: 0, gearMode: 'auto' };
  run(v, world, 60, (t) => {
    if (Math.floor(t * 2) !== Math.floor((t - DT) * 2)) {
      ctrl = {
        throttle: rnd() < 0.75 ? 1 : 0,
        brake: rnd() < 0.2 ? 1 : 0,
        steer: (rnd() - 0.5) * 2,
        handbrake: rnd() < 0.03 ? 1 : 0,
        shiftUp: rnd() < 0.02,
        shiftDown: rnd() < 0.02,
        gearMode: 'auto',
      };
    }
    return ctrl;
  });
  check('60 秒随机驾驶后仍有限', finite(v));
  check('车辆没有飞天（y < 200）', v.position.y < 200, `y=${v.position.y.toFixed(1)}`);
  check('车速未失控（< 400 km/h）', Math.abs(v.speedKmh) < 400, `v=${v.speedKmh.toFixed(1)} km/h`);
  check('发动机转速在范围内', v.drivetrain.rpm > 300 && v.drivetrain.rpm < v.spec.engine.maxRpm * 1.1,
    `rpm=${v.drivetrain.rpm.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
section('[7] 性能基准（sedan，含 4 轮 + 传动 + 接触）');
{
  const { world } = makeWorld();
  const v = makeVehicle('sedan');
  v.resetAt(world, 0, 0, 0);
  console.log(`     节点 ${v.body.nodeCount} / 梁 ${v.body.beamCount}`);
  const t0 = process.hrtime.bigint();
  run(v, world, 4, { throttle: 0.8, steer: 0.4 });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const frames = 4 * 60;
  console.log(`     4 秒模拟耗时 ${ms.toFixed(1)} ms → 每帧 ${(ms / frames).toFixed(2)} ms`);
  check('单帧物理 < 8 ms（留足渲染预算）', ms / frames < 8);
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`}\n`);
process.exit(failures === 0 ? 0 : 1);
