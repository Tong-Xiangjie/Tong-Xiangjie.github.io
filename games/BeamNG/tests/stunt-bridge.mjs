// 断桥/河流/跳台的回归测试。
// 运行：node tests/stunt-bridge.mjs
//
// 这块内容的尺寸全是"量出来"的（见 world.js 里的注释）：桥面必须和引道齐平、
// 水位必须夹在河岸和河床之间、缺口宽度必须刚好能全油门飞过去。改地形参数、
// 改车、改河道，任意一项动了都会在这里报警。
import { GameWorld } from '../js/game/world.js';
import { Vehicle } from '../js/vehicle/vehicle.js';
import { CAR_PRESETS } from '../js/vehicle/spec.js';
import { CollisionWorld } from '../js/phys/world.js';

const DT = 1 / 300;
let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}
function section(t) { console.log(`\n${t}`); }

const w = new GameWorld({ add() {}, remove() {} }, {});
const T = w.terrain;
const H = (x, z) => T.height(x, z);
const Z = 184;                                  // 桥轴线

section('[1] 河流：挖出了河谷，水位被两岸夹住');
const ch = T.channels[0];
check('场景里有一条河道', T.channels.length === 1);
const groundPre = (x, z) => H(x, z) + ch.cut(x, z);   // 未开挖的地面
const bed = H(166, Z);
const bankW = groundPre(166 - (ch.half + ch.bank * 0.85), Z);
const bankE = groundPre(166 + (ch.half + ch.bank * 0.85), Z);
const water = Math.min(groundPre(166, Z) - 0.45, Math.min(bankW, bankE) - 0.2);
check('河床明显低于两岸', bed < Math.min(bankW, bankE) - 1.5,
  `河床 ${bed.toFixed(2)} / 岸 ${Math.min(bankW, bankE).toFixed(2)}`);
check('水位低于两岸（不会淹到岸上）', water < Math.min(bankW, bankE), `水位 ${water.toFixed(2)}`);
check('水位高于河床（河里确实有水）', water > bed, `水位 ${water.toFixed(2)} > 河床 ${bed.toFixed(2)}`);
check('河心材质是水', T.materialAt(166, Z).name === '河水', T.materialAt(166, Z).name);
check('岸上是正常地面而不是水', T.materialAt(166 - 60, Z).name !== '河水', T.materialAt(166 - 60, Z).name);

section('[2] 断桥：引道齐平、缺口存在、桥墩不穿桥面');
const padY = w.bridgePad._target;
check('桥面与支路末端齐平（台阶 < 15cm）', Math.abs(padY - H(104, 180)) < 0.15,
  `高差 ${(padY - H(104, 180)).toFixed(3)} m`);
const decks = w._props.filter((p) => p.body.tag === 'bridge').map((p) => p.body);
const near = decks.find((b) => b.center.x < 184);
const far = decks.find((b) => b.center.x > 184);
const gap = (far.center.x - far.half.x) - (near.center.x + near.half.x);
check('两跨桥面之间的缺口在 8~18 m', gap >= 8 && gap <= 18, `缺口 ${gap.toFixed(1)} m`);
check('缺口正好在河道上方', near.center.x + near.half.x > 150 && far.center.x - far.half.x < 186,
  `缺口 ${(near.center.x + near.half.x).toFixed(0)}..${(far.center.x - far.half.x).toFixed(0)}，水面 150..182`);
const pierTop = padY - 0.9;
const pierBad = w._props.filter((p) => p.body.tag === 'pier')
  .filter((p) => p.body.center.y + p.body.height / 2 > pierTop + 0.02);
check('没有桥墩穿过桥面', pierBad.length === 0, `穿出的桥墩 ${pierBad.length} 根`);

section('[3] 跳台：坡脚与桥面齐平');
const ramp = w._props.find((p) => p.body.tag === 'bigramp').body;
// 低端上表面 = center.y - L·sinθ + T·cosθ，应当落在桥面上
const footTop = ramp.center.y - ramp.half.x * Math.sin(ramp.roll) + ramp.half.y * Math.cos(ramp.roll);
check('坡脚上表面与桥面齐平（< 8cm）', Math.abs(footTop - padY) < 0.08,
  `坡脚 ${footTop.toFixed(3)} / 桥面 ${padY.toFixed(3)}`);
check('坡口高于桥面 2.5~5 m', ramp.center.y + ramp.half.x * Math.sin(ramp.roll) + ramp.half.y * Math.cos(ramp.roll) - padY > 2.5,
  `坡口高 ${(ramp.center.y + ramp.half.x * Math.sin(ramp.roll) - padY).toFixed(2)} m`);

section('[4] 实车：全油门冲过缺口');
function drive(targetKmh) {
  const world = new CollisionWorld(T, w.statics);
  const v = new Vehicle(CAR_PRESETS.sedan, { subdivision: 2 });
  v.resetAt(world, -30, 180, -Math.PI / 2);
  const b = v.body, n = b.nodeCount >> 1;
  let vAtRamp = 0, cleared = false, inWater = false;
  for (let s = 0; s < 300 * 22; s++) {
    // 简易车道保持，不然会蹭到桥栏上停住（不是关卡的问题，是测试不会打方向）
    const dz = b.pz[n] - Z, f = v.frame.fwd;
    const dl = Math.hypot(1, -dz * 0.04);
    const cross = f.x * ((-dz * 0.04) / dl) - f.z * (1 / dl);
    const want = targetKmh / 3.6;
    const c = {
      throttle: v.speed < want ? 1 : 0, brake: 0,
      steer: Math.max(-1, Math.min(1, cross * 3.5)), handbrake: 0,
    };
    b.clearForces(); v.update(DT, world, c); b.step(DT, world);
    const cx = b.px[n], cy = b.py[n], cz = b.pz[n];
    if (cx > 120 && cx < 142) vAtRamp = Math.max(vAtRamp, v.speedKmh);
    if (cx > far.center.x - far.half.x + 1 && cy > padY - 0.4) cleared = true;
    if (T.materialAt(cx, cz) === ch.material) inWater = true;
  }
  return { vAtRamp, cleared, inWater };
}
const full = drive(165);
check('全油门到坡口有速度', full.vAtRamp > 70, `${full.vAtRamp.toFixed(0)} km/h`);
check('全油门能飞过缺口（落到远岸桥面）', full.cleared,
  full.cleared ? `坡口 ${full.vAtRamp.toFixed(0)} km/h` : `只到 ${full.vAtRamp.toFixed(0)} km/h，掉河里了`);
const slow = drive(60);
check('慢速飞不过去（掉进河里）', !slow.cleared, `坡口 ${slow.vAtRamp.toFixed(0)} km/h`);

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
