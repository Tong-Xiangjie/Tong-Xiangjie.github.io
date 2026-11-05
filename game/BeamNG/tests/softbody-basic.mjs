// 软体求解器基础验证：自由落体、静态平衡、塑性变形、断裂、能量不发散。
// 运行：node tests/softbody-basic.mjs
import { SoftBody, BEAM_RIGID } from '../js/phys/softbody.js';
import { Terrain, MATERIALS } from '../js/phys/terrain.js';
import { StaticWorld, StaticBody } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';

let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}
const finite = (b) => {
  for (let i = 0; i < b.nodeCount; i++) {
    if (!Number.isFinite(b.px[i]) || !Number.isFinite(b.py[i]) || !Number.isFinite(b.pz[i])) return false;
    if (!Number.isFinite(b.vx[i]) || !Number.isFinite(b.vy[i])) return false;
  }
  return true;
};

function makeBoxLattice(size = 1.6, divisions = 2, nodeMass = 60) {
  const body = new SoftBody(512, 4096);
  const h = size / 2;
  const step = size / divisions;
  const id = (ix, iy, iz) => ix + (divisions + 1) * (iy + (divisions + 1) * iz);
  for (let iz = 0; iz <= divisions; iz++) {
    for (let iy = 0; iy <= divisions; iy++) {
      for (let ix = 0; ix <= divisions; ix++) {
        const onShell = ix === 0 || ix === divisions || iy === 0 || iy === divisions || iz === 0 || iz === divisions;
        body.addNode(
          -h + ix * step, -h + iy * step + 3, -h + iz * step,
          { mass: onShell ? nodeMass : nodeMass * 0.4, radius: 0.18, friction: 0.7 },
        );
      }
    }
  }
  // 全连接：立方体对角线也连上，保证形状刚性
  const N = divisions + 1;
  const idx = [];
  for (let iz = 0; iz < N; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) idx.push(id(ix, iy, iz));
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const ia = idx[a], ib = idx[b];
      const dx = body.px[ia] - body.px[ib], dy = body.py[ia] - body.py[ib], dz = body.pz[ia] - body.pz[ib];
      const d = Math.hypot(dx, dy, dz);
      if (d > size * 1.75) continue;
      const structural = Math.abs(dx * dy * dz) < 1e-6;   // 只沿一个轴 → 主要结构梁
      body.addBeam(ia, ib, {
        type: BEAM_RIGID,
        yieldStrain: structural ? 0.02 : 0.008,
        breakStrain: structural ? 0.30 : 0.12,
        plasticity: 0.4,
      });
    }
  }
  body.captureInitialState();
  body.iterations = 10;
  return body;
}

function makeWorld(terrainOpts = {}) {
  const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 500, blend: 10 }, ...terrainOpts });
  const statics = new StaticWorld();
  const world = new CollisionWorld(terrain, statics);
  return { terrain, statics, world };
}

function simulate(body, world, seconds, dt = 1 / 300, onStep = null) {
  const steps = Math.round(seconds / dt);
  for (let s = 0; s < steps; s++) {
    body.clearForces();
    body.step(dt, world);
    if (onStep) onStep(s, body);
    if (!finite(body)) return s;
  }
  return steps;
}

console.log('\n[1] 自由落体 + 落地静止');
{
  const { world, terrain } = makeWorld();
  const body = makeBoxLattice();
  simulate(body, world, 0.1);
  check('自由落体阶段保持有限值', finite(body));
  simulate(body, world, 3.0);
  check('落地后无 NaN', finite(body), `node0 y=${body.py[0].toFixed(3)}`);
  let lowest = Infinity;
  for (let i = 0; i < body.nodeCount; i++) lowest = Math.min(lowest, body.py[i] - terrain.height(body.px[i], body.pz[i]));
  check('停在略高于地面的位置', lowest > 0.05 && lowest < 0.6, `最低节点离地 ${lowest.toFixed(3)} m`);
  const ke = body.kineticEnergy();
  check('静止后动能趋零', ke < 60, `KE=${ke.toFixed(2)} J`);
  const speed = Math.hypot(body.vx[0], body.vy[0], body.vz[0]);
  check('静止后速度趋零', speed < 0.6, `|v|=${speed.toFixed(3)} m/s`);
}

console.log('\n[2] 结构刚度：立方体不该被自重压扁');
{
  const { world } = makeWorld();
  const body = makeBoxLattice();
  simulate(body, world, 3.0);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < body.nodeCount; i++) { minY = Math.min(minY, body.py[i]); maxY = Math.max(maxY, body.py[i]); }
  check('高度大致保持（不塌陷）', maxY - minY > 1.0, `height=${(maxY - minY).toFixed(3)}`);
  check('梁几乎没有塑性变形', body.stats.maxStrain < 0.05, `maxStrain=${(body.stats.maxStrain * 100).toFixed(2)}%`);
}

console.log('\n[3] 高速撞击产生永久塑性变形与断裂');
{
  const { world, statics } = makeWorld();
  statics.add(StaticBody.box(0, 2, 3.0, 4, 2, 0.5, 0, 0, MATERIALS.CONCRETE));
  const body = makeBoxLattice();
  // 给一个 30 m/s 的水平初速度
  for (let i = 0; i < body.nodeCount; i++) { body.vx[i] = 30; body.py[i] = 1.0; }
  const before = body.rest.map((v, k) => k < body.beamCount ? v : 0);
  simulate(body, world, 2.5);
  check('撞击后无 NaN', finite(body));
  let deformed = 0;
  for (let k = 0; k < body.beamCount; k++) {
    if (Math.abs(body.rest[k] - body.rest0[k]) / body.rest0[k] > 0.01) deformed++;
  }
  check('产生了永久塑性变形', deformed > 0, `${deformed}/${body.beamCount} 根梁被永久改写`);
  check('发生结构断裂', body.stats.brokenBeams > 0, `断裂 ${body.stats.brokenBeams} 根`);
  check('完整度下降', body.integrity() < 0.99, `integrity=${(body.integrity() * 100).toFixed(1)}%`);
}

console.log('\n[4] 能量守恒（无接触时）');
{
  const { world } = makeWorld();
  const body = makeBoxLattice();
  body.resetTransform(0, 40, 0);   // 整体抬高，而不是把节点压到同一个平面上
  body.linearDamping = 0;
  body.iterations = 12;
  const allNodes = [...Array(body.nodeCount).keys()];
  const props0 = body.massProperties(allNodes);
  const e0 = body.kineticEnergy() + props0.mass * 9.81 * props0.center.y;
  simulate(body, world, 1.0);
  const props1 = body.massProperties(allNodes);
  const e1 = body.kineticEnergy() + props1.mass * 9.81 * props1.center.y;
  const drift = Math.abs(e1 - e0) / e0;
  check('1 秒内能量漂移 < 8%', drift < 0.08, `drift=${(drift * 100).toFixed(2)}%`);
}

console.log('\n[5] 阻尼拉满后必然收敛（数值稳定性）');
{
  const { world } = makeWorld();
  const body = makeBoxLattice();
  for (let i = 0; i < body.nodeCount; i++) {
    body.vx[i] = (Math.random() - 0.5) * 40;
    body.vy[i] = (Math.random() - 0.5) * 40;
    body.vz[i] = (Math.random() - 0.5) * 40;
    body.py[i] = 8 + Math.random();
  }
  simulate(body, world, 6.0);
  check('随机初速后仍有限', finite(body));
  const ke = body.kineticEnergy();
  check('6 秒后基本停止', ke < 400, `KE=${ke.toFixed(1)} J`);
}

console.log('\n[6] 高性能基准');
{
  const { world } = makeWorld();
  const body = makeBoxLattice(1.6, 3, 30);
  console.log(`     节点 ${body.nodeCount} / 梁 ${body.beamCount}`);
  const t0 = process.hrtime.bigint();
  simulate(body, world, 2.0, 1 / 300);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  const substeps = 600;
  console.log(`     2.0 秒物理（${substeps} 子步）耗时 ${ms.toFixed(1)} ms → 每 60fps 帧约 ${(ms / (substeps / 4)).toFixed(2)} ms（4 子步/帧）`);
  check('单帧物理开销在预算内（<6ms）', ms / (substeps / 4) < 6);
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`}\n`);
process.exit(failures === 0 ? 0 : 1);
