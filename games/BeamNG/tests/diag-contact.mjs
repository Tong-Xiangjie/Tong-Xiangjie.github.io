// 直接手算四个轮子的接触采样几何，和 Wheel 内部状态对比
import { Terrain } from '../js/phys/terrain.js';
import { StaticWorld } from '../js/phys/statics.js';
import { CollisionWorld } from '../js/phys/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const DT = 1 / 300;
const terrain = new Terrain({ amplitude: 0, detail: 0, baseFrequency: 0.01, flat: { cx: 0, cz: 0, radius: 3000, blend: 10 } });
const world = new CollisionWorld(terrain, new StaticWorld());
const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
v.resetAt(world, 0, 0, 0);

console.log('地形在若干点的: height / normal');
for (const [x, z] of [[-0.78, -1.35], [0.78, -1.35], [0, 0], [-0.9, -1.35]]) {
  const n = terrain.normal(x, z);
  console.log(`  (${x}, ${z}) h=${terrain.height(x, z).toFixed(5)} n=(${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)})`);
}

const frame = v.frame;
console.log(`\nrefFront=(${v.refFront.x.toFixed(4)},${v.refFront.y.toFixed(4)},${v.refFront.z.toFixed(4)})`);
console.log(`refRear =(${v.refRear.x.toFixed(4)},${v.refRear.y.toFixed(4)},${v.refRear.z.toFixed(4)})`);
console.log(`refRoof =(${v.refRoof.x.toFixed(4)},${v.refRoof.y.toFixed(4)},${v.refRoof.z.toFixed(4)})`);
console.log(`refFloor=(${v.refFloor.x.toFixed(4)},${v.refFloor.y.toFixed(4)},${v.refFloor.z.toFixed(4)})`);
// 手工重算：只用车顶与车底节点
function centroid(idxs) { let x = 0, y = 0, z = 0; for (const i of idxs) { x += v.body.px[i]; y += v.body.py[i]; z += v.body.pz[i]; } const n = idxs.length; return { x: x / n, y: y / n, z: z / n }; }
console.log(`手算 roof =`, JSON.stringify(centroid(v.built.frameRoof)));
console.log(`手算 floor=`, JSON.stringify(centroid(v.built.frameFloor)));
console.log(`frameRoof 节点数=${v.built.frameRoof.length} frameFloor 节点数=${v.built.frameFloor.length}`);
// 检查每个站位的环几何
for (const si of [0, 6, 12]) {
  const ring = v.built.stationNodes[si];
  const xs = ring.map((i) => v.body.px[i].toFixed(3));
  const ys = ring.map((i) => v.body.py[i].toFixed(3));
  console.log(`站位 ${si}: x=[${xs.join(',')}]`);
  console.log(`         y=[${ys.join(',')}]`);
}
console.log(`\nframe: pos=(${frame.pos.x.toFixed(3)},${frame.pos.y.toFixed(3)},${frame.pos.z.toFixed(3)}) ` +
  `right=(${frame.right.x.toFixed(3)},${frame.right.y.toFixed(3)},${frame.right.z.toFixed(3)}) ` +
  `up=(${frame.up.x.toFixed(3)},${frame.up.y.toFixed(3)},${frame.up.z.toFixed(3)}) ` +
  `fwd=(${frame.fwd.x.toFixed(3)},${frame.fwd.y.toFixed(3)},${frame.fwd.z.toFixed(3)})`);

const scratch = new Float64Array(20);
const TREAD = [-24, -12, 0, 12, 24];
const R2 = Math.PI / 180;
for (const w of v.wheels) {
  const c = w.corner;
  const P = { x: v.body.px[c.towerIdx], y: v.body.py[c.towerIdx], z: v.body.pz[c.towerIdx] };
  const A = { x: c.axis.x, y: c.axis.y, z: -c.axis.z };
  const len = c.designLength;
  const C = { x: P.x + A.x * len, y: P.y + A.y * len, z: P.z + A.z * len };
  const up0 = { x: -A.x, y: -A.y, z: -A.z };
  const fwd = { x: frame.fwd.x, y: frame.fwd.y, z: frame.fwd.z };
  const d0 = fwd.x * up0.x + fwd.y * up0.y + fwd.z * up0.z;
  fwd.x -= up0.x * d0; fwd.y -= up0.y * d0; fwd.z -= up0.z * d0;
  const fl = Math.hypot(fwd.x, fwd.y, fwd.z); fwd.x /= fl; fwd.y /= fl; fwd.z /= fl;
  const pens = [];
  for (const th0 of TREAD) {
    const th = th0 * R2, ct = Math.cos(th), st = Math.sin(th);
    const dx = -up0.x * ct + fwd.x * st, dy = -up0.y * ct + fwd.y * st, dz = -up0.z * ct + fwd.z * st;
    const sx = C.x + dx * c.designLength * 0 + dx * 0, sy = 0, sz = 0;
    void sx; void sy; void sz;
    const px = C.x + dx * w.radius, py = C.y + dy * w.radius, pz = C.z + dz * w.radius;
    const n = world.collectContacts(px, py, pz, 0.045, scratch, 4);
    const pen = n > 0 ? scratch[3] : 0;
    pens.push(pen.toFixed(4));
  }
  console.log(`\n${w.name}: P=(${P.x.toFixed(3)},${P.y.toFixed(3)},${P.z.toFixed(3)}) A=(${A.x.toFixed(3)},${A.y.toFixed(3)},${A.z.toFixed(3)})`);
  console.log(`     C=(${C.x.toFixed(3)},${C.y.toFixed(3)},${C.z.toFixed(3)})  radius=${w.radius}`);
  console.log(`     up0=(${up0.x.toFixed(3)},${up0.y.toFixed(3)},${up0.z.toFixed(3)})  pens=[${pens.join(', ')}]`);
}
