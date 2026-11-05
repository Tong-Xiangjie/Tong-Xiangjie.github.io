// ============================================================================
//  游戏世界：地形 + 静态物体（物理与视觉同一份定义，永远不会对不上）
//  布局思路：
//    · 出生点/试验场：一块大混凝土场坪，四周是撞墙、坡道、护栏、锥桶
//    · 直线加速跑道：1.6 km 沥青直道，测极速用
//    · 环形公路：绕一圈的长弯道，练走线
//    · 越野区：土坡、跳台、集装箱堆
// ============================================================================
import * as THREE from '../../vendor/three.module.js';
import { Terrain, MATERIALS } from '../phys/terrain.js';
import { StaticWorld, StaticBody, SHAPE_BOX } from '../phys/statics.js';
import { CollisionWorld } from '../phys/world.js';
import { TerrainMesh, RoadMesh } from '../render/terrainMesh.js';
import { mulberry32 } from '../core/math.js';

const _m4 = new THREE.Matrix4();

/** 材质 → 视觉外观。 */
const LOOK = {
  concrete: { color: 0xb9b7ae, roughness: 0.9, metalness: 0.0 },
  wall: { color: 0x9a978e, roughness: 0.92, metalness: 0.0 },
  metal: { color: 0x8d9199, roughness: 0.42, metalness: 0.8 },
  red: { color: 0xa8272c, roughness: 0.5, metalness: 0.35 },
  blue: { color: 0x2a5aa8, roughness: 0.5, metalness: 0.35 },
  green: { color: 0x2f6b3c, roughness: 0.5, metalness: 0.35 },
  wood: { color: 0x8a6a44, roughness: 0.95, metalness: 0.0 },
  rubber: { color: 0x191a1c, roughness: 0.95, metalness: 0.0 },
  trunk: { color: 0x5a4632, roughness: 1.0, metalness: 0.0 },
  leaf: { color: 0x2f5a2a, roughness: 1.0, metalness: 0.0 },
  glass: { color: 0x6f8fa8, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55 },
};

export class GameWorld {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.rng = mulberry32(opts.seed ?? 1337);
    this.terrain = new Terrain({
      seed: opts.seed ?? 1337,
      amplitude: opts.amplitude ?? 7.5,
      baseFrequency: 0.0068,
      detail: 0.22,
      mountains: opts.mountains ?? 1,
      mountainStart: 420,
      flat: { cx: 0, cz: 0, radius: 70, blend: 70 },
      roads: this._roadLayout(),
      channels: this._channelLayout(),
      pads: [
        { cx: 0, cz: 0, hx: 38, hz: 38, material: MATERIALS.CONCRETE, falloff: 8 },
        // 断桥引道：把桥轴线整成一条水平的堤，两岸同高，桥面才有地方落。
        // 河道是在场坪之后挖的，所以正中那段还是会被切成河谷。
        // 往西给到 x=68：起跳坡前需要一段又平又直的加速路，太短的话
        // 到坡口只有七八十，缺口根本飞不过去。
        { cx: 168, cz: 184, hx: 100, hz: 11, material: MATERIALS.CONCRETE, falloff: 9, tag: 'bridgepad' },
      ],
    });
    // 把断桥引道的台面高度对齐支路末端。_target 是 height() 里惰性求值的，
    // 构造完再写完全来得及。
    // 不对齐会很难看：支路在自己末端会把地形拉回它的自然高程（比引道低 3 米），
    // 桥台前就是一个 3 米深的坑，车根本上不了桥。
    this.bridgePad = this.terrain.pads.find((p) => p.tag === 'bridgepad') ?? null;
    if (this.bridgePad) {
      const link = this.terrain.roads.find((r) => r.points === this._linkRoad.points);
      const jx = 104, jz = 180;
      // 复刻 height() 里道路那一步的目标值，接缝处就完全连续
      const roadTarget = this.terrain.baseHeight(jx, jz) * 0.35 + this.terrain._roadLevel(link, jx, jz) * 0.65;
      // 就取路面高程本身，不加余量：道路那一步是 lerp(h, target, w*0.9)，
      // 只要堤面等于 target，接缝处算出来就还是 target，一步都不会差。
      this.bridgePad._target = roadTarget;
    }
    this.statics = new StaticWorld(10);
    this.world = new CollisionWorld(this.terrain, this.statics);

    this.group = new THREE.Group();
    scene.add(this.group);
    this.propGroup = new THREE.Group();
    this.group.add(this.propGroup);

    this.materials = new Map();
    this.geometries = [];
    for (const [k, v] of Object.entries(LOOK)) this.materials.set(k, new THREE.MeshStandardMaterial(v));

    this.terrainMesh = new TerrainMesh(this.terrain, { viewDistance: opts.viewDistance ?? 700 });
    this.group.add(this.terrainMesh.group);
    this.roadMesh = new RoadMesh(this.terrain);
    this.group.add(this.roadMesh.group);

    this._props = [];
    this._buildLayout();
    this.markers = [];
  }

  _mat(kind) { return this.materials.get(kind) ?? this.materials.get('concrete'); }

  // --- 道路折线 -----------------------------------------------------------
  _roadLayout() {
    const roads = [];
    // 直线加速跑道（南北向直道，宽 14）
    roads.push({ points: [[0, 120], [0, -1500]], width: 15, material: MATERIALS.ASPHALT, blend: 7 });
    // 环形公路：一个大致闭合的大圈，绕地形起伏
    const loop = [];
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 250 + Math.sin(a * 3) * 55;
      loop.push([Math.cos(a) * r, Math.sin(a) * r + 40]);
    }
    roads.push({ points: loop, width: 11, material: MATERIALS.ASPHALT, blend: 8 });
    // 连接场坪与环路的支路。
    // 起点原来是 (0,90) —— 那正好在跑道中间，支路斜着压在跑道上 30 米，
    // 出生点看到的那段闪烁就是这个共面重叠。改成从跑道东缘起步。
    // 末端停在断桥引道西边，桥面高度就对齐这条路的末端高程。
    this._linkRoad = { points: [[7, 95], [60, 148], [104, 180]], width: 9, material: MATERIALS.ASPHALT, blend: 6 };
    roads.push(this._linkRoad);
    // 越野土路
    roads.push({ points: [[-30, -60], [-140, -150], [-260, -120], [-330, 30]], width: 8, material: MATERIALS.DIRT, blend: 10 });
    return roads;
  }

  /**
   * 河道。放在场坪以东：从北边一路向南偏东，穿过支路（断桥就在那个交叉口）
   * 和环路，形成两处涉水点。沟底比两岸低 3.8 m，车冲进去会被水迅速拖停。
   */
  _channelLayout() {
    return [{
      points: [[138, 330], [166, 190], [186, 40], [198, -130]],
      width: 38, depth: 3.8, bank: 14, material: MATERIALS.WATER,
    }];
  }

  // --- 静态道具 -----------------------------------------------------------
  /**
   * 断桥 + 跳台区（场坪以东，横跨那条河）。
   *
   *   x 轴向东，桥面沿 x 展开，河心在 x≈166：
   *     [126 .. 164] 近岸桥面 → [164 .. 192] 塌掉的缺口（28 m） → [192 .. 232] 远岸桥面
   *   整条轴线站在 bridgepad 这块水平堤上，所以两岸同高、桥面是平的；
   *   起跳坡就架在近岸这头，坡口对着缺口。
   */
  _stuntLayout(H) {
    const z = 184;
    // 引道台面高度（和 bridgepad 的 _target 一致），所有构件都从它推出来
    const padY = this.bridgePad?._target ?? H(184, z);
    const halfZ = 5.6;

    // 桥面顶 = 堤面，也就是和引道、支路齐平（真桥就是这样，桥面不会比路面高一截）
    const deckTop = padY;
    const deck = (cx, hx) => {
      this.addBox(cx, deckTop - 0.45, z, hx, 0.45, halfZ, 'concrete',
        { material: MATERIALS.CONCRETE, tag: 'bridge' });
    };
    deck(139, 25);     // 近岸跨：x 114..164
    // 远岸跨：x 175..231，缺口 11 m。缺口宽度是量出来的：这台车从引道
    // 全油门到坡口只有 89 km/h，实测飞 35 m 落到 179，再宽就过不去了。
    // （换条更长的柏油直线助跑能到 110+，那时余量就很充裕。）
    deck(203, 28);
    // 桥墩：从河床一直顶到桥底。河床离桥底太近的地方不立墩——
    // 否则桥台旁边会冒出一截混凝土桩穿过桥面，车直接撞停在上面。
    const pierTop = deckTop - 0.9;
    for (const px of [146, 156, 192, 202]) {
      const bed = H(px, z);
      const hgt = pierTop - bed;
      if (hgt < 0.5) continue;
      this.addCylinder(px, bed + hgt / 2, z, 1.05, hgt, 'concrete',
        { seg: 12, material: MATERIALS.CONCRETE, tag: 'pier' });
    }
    // 护栏：缺口两侧断掉，一眼看得出桥塌了
    for (const [cx, hx] of [[139, 25], [203, 28]]) {
      for (const s of [-1, 1]) {
        this.addBox(cx, deckTop + 0.42, z + s * (halfZ - 0.25), hx, 0.42, 0.22, 'metal', { tag: 'railing' });
      }
    }
    // 塌下去的那两跨，斜插在河里
    const waterY = H(166, z) + 3.8 * 0.55;
    this.addBox(172, waterY - 0.6, z - 4.6, 12, 0.42, halfZ * 0.9, 'concrete',
      { material: MATERIALS.CONCRETE, roll: -0.5, yaw: 0.14, tag: 'bridgefall' });
    this.addBox(182, waterY - 1.9, z + 4.0, 8, 0.42, halfZ * 0.7, 'concrete',
      { material: MATERIALS.CONCRETE, roll: 0.34, yaw: -0.22, tag: 'bridgefall' });

    // 起跳坡：架在近岸桥面上，坡口比桥面高 3.6 m，正对缺口。
    // 中心高度要让"低端上表面"正好落在桥面上（center.y = deckTop + L·sinθ - T·cosθ），
    // 否则坡脚会翘出一条几十厘米的坎，车顶上去就停住。
    // 试过把坡加到 4.2 m（12°）：仰角是大了，但爬坡吃掉的速度更多，
    // 实测反而少飞 1.8 m。最后还是靠把缺口收到 11 m 解决。
    const rampL = 10, rampT = 0.3, rise = 3.6;
    const roll = Math.atan2(rise, rampL * 2);
    this.addBox(134, deckTop + rampL * Math.sin(roll) - rampT * Math.cos(roll), z,
      rampL, rampT, 5.4, 'metal', { material: MATERIALS.CONCRETE, roll, tag: 'bigramp' });
    // 远岸落地坡（让落点是个斜面，别直接砸在平桥上）
    this.addBox(186, deckTop + 0.5, z, 6, 0.28, 5.4, 'metal',
      { material: MATERIALS.CONCRETE, roll: -Math.atan2(1.4, 12), tag: 'landing' });

    // 场坪旁边的两个练习跳台（一个矮一个高，落点都是平地）
    for (const [cx, cz, len, rs] of [[-34, -18, 9, 1.5], [30, -34, 13, 2.4]]) {
      const y = H(cx, cz);
      const rl = Math.atan2(rs, len * 2);
      this.addBox(cx, y + rs * 0.5 + 0.12, cz, len, 0.28, 4.0, 'metal',
        { material: MATERIALS.CONCRETE, roll: rl, tag: 'jumpramp' });
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const px = cx - len + t * len * 2;
        const hh = 0.28 + rs * 0.5 * t;
        this.addBox(px, y + hh * 0.5, cz, 0.8, hh * 0.5, 3.6, 'concrete', { tag: 'rampfill' });
      }
      for (const s of [-1, 1]) {
        const mx = cx + len * 3.2, mz = cz + s * 3.2;
        this.addCylinder(mx, H(mx, mz) + 0.35, mz, 0.19, 0.7, 'red',
          { seg: 10, material: MATERIALS.CONCRETE, tag: 'cone' });
      }
    }
  }


  /** 加一个盒子（物理 + 视觉）。hx/hy/hz 是半尺寸。roll 用来做斜坡。 */
  addBox(cx, cy, cz, hx, hy, hz, look = 'concrete', opts = {}) {
    const body = StaticBody.box(cx, cy, cz, hx, hy, hz, opts.yaw ?? 0, opts.pitch ?? 0,
      opts.material ?? MATERIALS.CONCRETE,
      { tag: opts.tag ?? look, breakable: !!opts.breakable, mass: opts.mass ?? Infinity, roll: opts.roll ?? 0 });
    this.statics.add(body);
    const geo = this._boxGeo();
    const mesh = new THREE.Mesh(geo, this._mat(look));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this._applyBasis(mesh, body);
    this.propGroup.add(mesh);
    this._props.push({ body, mesh });
    return body;
  }

  addCylinder(cx, cy, cz, radius, height, look = 'metal', opts = {}) {
    const body = StaticBody.cylinder(cx, cy, cz, radius, height,
      opts.material ?? MATERIALS.CONCRETE, { tag: opts.tag ?? look, breakable: !!opts.breakable });
    this.statics.add(body);
    const geo = new THREE.CylinderGeometry(radius, radius, height, opts.seg ?? 14);
    const mesh = new THREE.Mesh(geo, this._mat(look));
    this.geometries.push(geo);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this._applyBasis(mesh, body);
    this.propGroup.add(mesh);
    this._props.push({ body, mesh });
    return body;
  }

  _boxGeo() {
    if (!this._box) {
      this._box = new THREE.BoxGeometry(1, 1, 1);
      this.geometries.push(this._box);
    }
    return this._box;
  }

  /** 把 StaticBody 的朝向/尺寸写进 mesh 矩阵（盒子几何体是单位立方体）。 */
  _applyBasis(mesh, body) {
    const b = body.basis;
    _m4.set(b[0], b[3], b[6], body.center.x,
      b[1], b[4], b[7], body.center.y,
      b[2], b[5], b[8], body.center.z,
      0, 0, 0, 1);
    if (body.shape === SHAPE_BOX) {
      const s = new THREE.Matrix4().makeScale(body.half.x * 2, body.half.y * 2, body.half.z * 2);
      _m4.multiply(s);
    }
    mesh.matrix.copy(_m4);
  }

  _buildLayout() {
    const rnd = this.rng;
    const H = (x, z) => this.terrain.height(x, z);

    // --- 出生场坪周边 ---------------------------------------------------
    // 正面撞墙（长 30m，高 2m）在跑道尽头附近，作为碰撞试验靶
    this.crashWall = this.addBox(0, H(0, -70) + 1.1, -70, 15, 1.1, 0.45, 'wall', { tag: 'crashwall' });
    // 场坪边界护栏
    for (let i = -8; i <= 8; i++) {
      if (Math.abs(i) < 2) continue;
      this.addBox(i * 4.4, H(i * 4.4, 42) + 0.5, 42, 2.1, 0.5, 0.18, 'metal', { yaw: 0 });
    }
    // 锥桶阵（绕桩用）
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = Math.cos(a) * 26, z = Math.sin(a) * 26 + 8;
      this.addCylinder(x, H(x, z) + 0.35, z, 0.19, 0.7, 'red', { seg: 10, material: MATERIALS.CONCRETE, tag: 'cone' });
    }

    // --- 跳台 -----------------------------------------------------------
    for (const [x, z, yaw] of [[-60, -140, 0.18], [70, -190, -0.22]]) {
      const y = H(x, z);
      this.addBox(x, y + 0.6, z, 4.0, 0.6, 9.0, 'concrete', { pitch: -0.22, yaw, tag: 'ramp' });
      this.addBox(x, y + 0.32, z + 8.6 * Math.cos(yaw) * -1, 4.0, 0.32, 2.0, 'metal', { yaw, tag: 'rampbase' });
    }

    this._stuntLayout(H);

    // --- 集装箱堆场（可撞散） -------------------------------------------
    const colors = ['red', 'blue', 'green'];
    for (let i = 0; i < 9; i++) {
      const x = -120 + (i % 3) * 13;
      const z = -230 - Math.floor(i / 3) * 15;
      const y = H(x, z);
      this.addBox(x, y + 1.3, z, 6.1, 1.3, 2.45, colors[i % 3], { yaw: (rnd() - 0.5) * 0.12, tag: 'container' });
    }

    // --- 建筑群 ---------------------------------------------------------
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 110 + rnd() * 210;
      const x = Math.cos(a) * r, z = Math.sin(a) * r + 40;
      const y = H(x, z);
      const w = 6 + rnd() * 12, d = 6 + rnd() * 12, h = 4 + rnd() * 14;
      this.addBox(x, y + h / 2, z, w / 2, h / 2, d / 2, rnd() > 0.5 ? 'concrete' : 'wood', { yaw: rnd() * Math.PI });
      // 屋顶水箱
      this.addCylinder(x + (rnd() - 0.5) * 3, y + h + 0.8, z + (rnd() - 0.5) * 3, 0.9, 1.6, 'metal', { seg: 10 });
    }

    // --- 树 & 电线杆 -----------------------------------------------------
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 8);
    this.geometries.push(trunkGeo);
    // 路面/场坪上不许长树：原来是纯随机撒点，结果树直接站在直线跑道正中
    // （全油门冲过去就是一棵树），既不合理也没法跑。
    const offRoad = (x, z) => {
      const m = this.terrain.materialAt(x, z);
      return m !== MATERIALS.ASPHALT && m !== MATERIALS.CONCRETE;
    };
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 90 + rnd() * 430;
      let x = Math.cos(a) * r, z = Math.sin(a) * r + 40;
      let y = H(x, z);
      for (let k = 0; k < 6 && !offRoad(x, z); k++) {
        const a2 = rnd() * Math.PI * 2, r2 = 90 + rnd() * 430;
        x = Math.cos(a2) * r2; z = Math.sin(a2) * r2 + 40; y = H(x, z);
      }
      if (!offRoad(x, z)) continue;
      const h = 4.5 + rnd() * 6;
      // 物理：一根细圆柱（撞得断）
      const body = StaticBody.cylinder(x, y + h / 2, z, 0.22, h, MATERIALS.DIRT, { tag: 'tree' });
      this.statics.add(body);
      const trunk = new THREE.Mesh(trunkGeo, this._mat('trunk'));
      trunk.scale.set(1, h, 1);
      trunk.position.set(x, y + h / 2, z);
      trunk.castShadow = true;
      this.propGroup.add(trunk);
      const leafGeo = new THREE.ConeGeometry(1.5 + rnd() * 0.9, 2.4 + rnd() * 1.6, 7);
      this.geometries.push(leafGeo);
      const leaf = new THREE.Mesh(leafGeo, this._mat('leaf'));
      leaf.position.set(x, y + h + 0.6, z);
      leaf.castShadow = true;
      this.propGroup.add(leaf);
    }    // 高压线杆：沿"公路"排开。注意相位要错开 30 m —— 原来 i*60 从 -1500
    // 起步时正好有一根落在 x=0，插在直线跑道的行车线上，全油门直接撞杆。
    for (let i = 0; i < 26; i++) {
      const x = -1470 + i * 60;
      const z = 62;
      const y = H(x, z);
      this.addCylinder(x, y + 4.0, z, 0.16, 8.0, 'metal', { seg: 8, tag: 'pole' });
      this.addBox(x + 30, y + 7.4, z, 30, 0.09, 0.09, 'metal', { tag: 'wire' });
    }
  }

  /** 摄像机移动时流式生成地形块。 */
  update(camPos) {
    this.terrainMesh.update(camPos);
  }

  setViewDistance(d) { this.terrainMesh.setViewDistance(d); }

  dispose() {
    this.terrainMesh.dispose();
    this.roadMesh.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.scene.remove(this.group);
  }
}
