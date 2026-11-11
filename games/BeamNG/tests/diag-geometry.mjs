// 出厂几何对称性检查
import { buildVehicle } from '../js/vehicle/factory.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';

const b = buildVehicle(CAR_PRESETS.sedan, { subdivision: 2 });
console.log('corner  side  designCenter(x,y,z)          towerNode(x,y,z)           L0      axis(x,y,z)             sag');
for (const c of b.corners) {
  const f = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const t = { x: b.body.px[c.towerIdx], y: b.body.py[c.towerIdx], z: b.body.pz[c.towerIdx] };
  console.log(`${c.name.padEnd(6)} ${String(c.side).padStart(3)}   ${f(c.designCenter).padEnd(26)} ${f(t).padEnd(26)} ${c.designLength.toFixed(4)}  ${f(c.axis).padEnd(22)} ${c.sag.toFixed(4)}`);
}
console.log('\n参考点高度 refCy =', b.refCy.toFixed(4));
console.log('wheelX =', b.wheelX, ' R =', b.R);

// 环状节点左右对称性
let maxAsym = 0, worst = '';
const body = b.body;
for (let si = 0; si < b.stationNodes.length; si++) {
  const ring = b.stationNodes[si];
  for (let k = 0; k < 6; k++) {
    const L = ring[6 - k] ?? null, R = ring[6 + k];
    if (L == null || R == null) continue;
    const dy = Math.abs(body.py[L] - body.py[R]);
    const dx = Math.abs(body.px[L] + body.px[R]);
    if (dy > maxAsym) { maxAsym = dy; worst = `station ${si} k=${k} dy=${dy.toFixed(5)} dx=${dx.toFixed(5)}`; }
  }
}
console.log('环节点最大左右 y 偏差 =', maxAsym.toFixed(5), '|', worst);

// 所有节点左右配对检查
const n = body.nodeCount;
let asym = 0;
for (let i = 0; i < n; i++) {
  let found = -1;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    if (Math.abs(body.px[j] + body.px[i]) < 1e-6 && Math.abs(body.py[j] - body.py[i]) < 1e-6 && Math.abs(body.pz[j] - body.pz[i]) < 1e-6) { found = j; break; }
  }
  if (found < 0) { asym++; if (asym < 6) console.log(`  非对称节点 ${i}: (${body.px[i].toFixed(3)}, ${body.py[i].toFixed(3)}, ${body.pz[i].toFixed(3)}) mass=${body.mass[i].toFixed(2)}`); }
}
console.log(`共 ${asym}/${n} 个节点找不到镜像`);
