// ============================================================================
//  车辆可视化：把软体物理的节点直接当成网格顶点
//  · 车身 = 环之间的四边形（按 quadKind 分成 车身/玻璃/车顶/门槛/底盘 五个材质组）
//  · 网格顶点就是物理节点 —— 碰撞凹陷、褶皱、断裂会自动出现在画面上，
//    不需要任何额外的"形变贴图"或骨骼动画
//  · 顶点色随 nodeDamage 变暗变脏，撞过的地方一眼就能看出来
//  · 车轮是独立的刚体网格，位置/朝向每个渲染帧从 Wheel 的物理状态同步
// ============================================================================
import * as THREE from '../../vendor/three.module.js';
import { quadKind } from '../vehicle/spec.js';

const KIND_INDEX = { body: 0, glass: 1, roof: 2, sill: 3, underbody: 4 };
const MATERIAL_ORDER = ['body', 'glass', 'roof', 'sill', 'underbody'];
// 细节件（大灯/尾灯/格栅/裙边）另开材质槽，追加在五个车身槽后面
const DETAIL_INDEX = { headlight: 5, taillight: 6, trim: 7, grille: 8 };
const DETAIL_COUNT = 4;

/** 车身默认材质组：烤漆 / 玻璃 / 车顶 / 门槛裙边 / 底盘。 */
function buildMaterials(paint, opts = {}) {
  const clearcoat = opts.metallic !== false;
  return [
    new THREE.MeshStandardMaterial({
      color: paint, roughness: clearcoat ? 0.34 : 0.5, metalness: clearcoat ? 0.32 : 0.05,
      vertexColors: true, flatShading: false,
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0x9fc4d8, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.34,
      transmission: 0.0, side: THREE.DoubleSide, depthWrite: false, vertexColors: true,
    }),
    new THREE.MeshStandardMaterial({ color: paint, roughness: 0.3, metalness: 0.3, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.82, metalness: 0.1, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.95, metalness: 0.0, vertexColors: true }),
    // 大灯：暖白自发光，夜里/阴影里也认得出是辆车
    new THREE.MeshStandardMaterial({
      color: 0xf2f0e4, emissive: 0xfff0c8, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    }),
    // 尾灯
    new THREE.MeshStandardMaterial({
      color: 0x8e1414, emissive: 0xff2a12, emissiveIntensity: 0.7, roughness: 0.24, metalness: 0.3,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    }),
    // 裙边/包围：哑光黑塑料，把圆筒一样的车身切出层次
    new THREE.MeshStandardMaterial({
      color: 0x1a1c20, roughness: 0.86, metalness: 0.12,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }),
    // 格栅
    new THREE.MeshStandardMaterial({
      color: 0x101216, roughness: 0.5, metalness: 0.7,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    }),
  ];
}

export class VehicleView {
  /**
   * @param {import('../vehicle/vehicle.js').Vehicle} vehicle
   */
  constructor(vehicle, opts = {}) {
    this.vehicle = vehicle;
    this.opts = opts;
    const built = vehicle.built;
    this.geometry = built.geometry;
    this.body = built.body;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;

    this.paint = new THREE.Color(opts.paint ?? 0xb4232b);
    this.materials = buildMaterials(this.paint, opts);
    this._buildBodyMesh();
    this._buildWheels(opts);
    this.group.add(this.mesh);
    if (opts.shadows !== false) {
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
    }
    this._scratch = new THREE.Vector3();
    this.update();
  }

  // -------------------------------------------------------------------------
  _buildBodyMesh() {
    const body = this.body;
    const geometry = this.geometry;
    const n = body.nodeCount;
    const stations = geometry.stations;
    const ringSize = geometry.ringSize;

    // 顶点：物理节点一一对应（+ 前后两个封口中心点 + 细节件顶点）
    const capFront = n, capRear = n + 1;
    this._details = [];
    const detailQuad = this._planDetails(geometry, n);
    const dOff = n + 2;
    // 注意：_details.length 才是顶点数（每个四边形 4 个），不是四边形个数。
    // 按四边形个数开缓冲区的话索引会越界，而且 computeVertexNormals 读到
    // 数组外面会得到 undefined，法线直接变 NaN。
    const vcount = n + 2 + this._details.length;
    void detailQuad.length;
    const pos = new Float32Array(vcount * 3);
    const baseCol = new Float32Array(vcount * 3);
    // 出厂位置做基础顶点色（车顶稍亮、底盘暗）
    for (let i = 0; i < n; i++) {
      const y = body.py[i];
      const up = Math.max(0, Math.min(1, (y - 0.25) / 1.1));
      const shade = 0.82 + up * 0.26;
      baseCol[i * 3] = shade; baseCol[i * 3 + 1] = shade; baseCol[i * 3 + 2] = shade;
    }
    baseCol[capFront * 3] = baseCol[capFront * 3 + 1] = baseCol[capFront * 3 + 2] = 0.9;
    baseCol[capRear * 3] = baseCol[capRear * 3 + 1] = baseCol[capRear * 3 + 2] = 0.9;

    const buckets = [[], [], [], [], [], [], [], [], []];
    for (let si = 0; si < stations.length - 1; si++) {
      const a = stations[si].ring;
      const b = stations[si + 1].ring;
      for (let k = 0; k < ringSize; k++) {
        const k2 = (k + 1) % ringSize;
        const kind = quadKind(si, k, geometry);
        const bucket = buckets[KIND_INDEX[kind] ?? 0];
        // 环形是逆时针（从 +Z 看），a[k]→a[k2]→b[k2] 得到向外的法线
        bucket.push(a[k], b[k2], a[k2]);
        bucket.push(a[k], b[k], b[k2]);
      }
    }
    // 前后封口（风扇三角）
    for (let k = 0; k < ringSize; k++) {
      const k2 = (k + 1) % ringSize;
      buckets[0].push(stations[0].ring[k2], stations[0].ring[k], capFront);
      const last = stations[stations.length - 1].ring;
      buckets[0].push(last[k], last[k2], capRear);
    }
    // 细节件：每个四边形推两个三角，顶点是细节顶点里的下标
    for (const d of detailQuad) {
      const b = buckets[d.slot];
      b.push(dOff + d.i0, dOff + d.i2, dOff + d.i1);
      b.push(dOff + d.i0, dOff + d.i3, dOff + d.i2);
    }
    void DETAIL_COUNT;

    const total = buckets.reduce((s, b) => s + b.length, 0);
    const index = new Uint32Array(total);
    let off = 0;
    const groups = [];
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length === 0) { groups.push(null); continue; }
      index.set(b, off);
      groups.push({ start: off, count: b.length, materialIndex: i });
      off += b.length;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(baseCol, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    for (const grp of groups) if (grp) g.addGroup(grp.start, grp.count, grp.materialIndex);
    g.setDrawRange(0, total);
    this.meshGeometry = g;
    this.baseColor = baseCol;
    this.mesh = new THREE.Mesh(g, this.materials);
    this.mesh.frustumCulled = false;
    void MATERIAL_ORDER;
  }

  // -------------------------------------------------------------------------
  /**
   * 规划细节件（大灯/尾灯/格栅/裙边）。
   *
   * 关键点：细节顶点不是独立的固定几何，而是"车身某个四边形上的一个双线性
   * 采样点"，记下 4 个物理节点下标和 4 个权重。这样撞凹、撕裂、断裂的时候
   * 大灯会跟着那块钣金一起走，不会飘在半空。
   * 又因为采样点就落在车身表面上，材质用 polygonOffset 压住 z-fighting
   * 就够了，不需要往外顶出厚度。
   *
   * 环的编号：0 底中 1 底右 2 门槛右 3 肩右 4 玻璃右 5 顶右 6 顶中
   *           7 顶左 8 玻璃左 9 肩左 10 门槛左 11 底左
   * 站点 0 是车头，最后一个是车尾。
   */
  _planDetails(geometry, n) {
    const stations = geometry.stations;
    const ringSize = geometry.ringSize;
    const lastSi = stations.length - 1;
    const out = [];
    this._details = [];

    /** 在 si→si+1 站的第 k 个四边形上，按 (u,v) 取一个点。 */
    const push = (slot, si, k, uvs) => {
      const q = [
        stations[si].ring[k], stations[si].ring[(k + 1) % ringSize],
        stations[si + 1].ring[(k + 1) % ringSize], stations[si + 1].ring[k],
      ];
      const base = this._details.length;
      for (const [u, v] of uvs) {
        // 双线性：p = (1-u)(1-v)q0 + u(1-v)q1 + u·v·q2 + (1-u)v·q3
        this._details.push({
          q,
          w: [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v],
        });
      }
      out.push({ slot, i0: base, i1: base + 1, i2: base + 2, i3: base + 3 });
    };

    // 大灯：车头第一节，肩部那块板（右侧 k=3，左侧 k=8 镜像）
    push(DETAIL_INDEX.headlight, 0, 3, [[0.06, 0.30], [0.72, 0.30], [0.72, 0.68], [0.06, 0.68]]);
    push(DETAIL_INDEX.headlight, 0, 8, [[0.06, 0.32], [0.72, 0.32], [0.72, 0.70], [0.06, 0.70]]);
    // 尾灯：车尾最后一节，同样的位置
    push(DETAIL_INDEX.taillight, lastSi - 1, 3, [[0.10, 0.26], [0.80, 0.26], [0.80, 0.62], [0.10, 0.62]]);
    push(DETAIL_INDEX.taillight, lastSi - 1, 8, [[0.10, 0.28], [0.80, 0.28], [0.80, 0.64], [0.10, 0.64]]);
    // 格栅：车头第一节的底面往上一点，横跨中间两块
    push(DETAIL_INDEX.grille, 0, 0, [[0.30, 0.34], [0.78, 0.34], [0.78, 0.80], [0.30, 0.80]]);
    // 侧裙：底下两块（右下 k=1 / 左下 k=10），从车头一路拉到车尾会用掉太多顶点，
    // 这里只铺前四节，视觉上已经足够把"圆筒"切出腰线
    for (let si = 0; si < Math.min(4, lastSi); si++) {
      push(DETAIL_INDEX.trim, si, 1, [[0, 0.22], [1, 0.22], [1, 0.74], [0, 0.74]]);
      push(DETAIL_INDEX.trim, si, 10, [[0, 0.22], [1, 0.22], [1, 0.74], [0, 0.74]]);
    }
    void n;
    return out;
  }

  // -------------------------------------------------------------------------
  _buildWheels(opts) {
    this.wheels = [];
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.92, metalness: 0.0 });
    const rimMat = new THREE.MeshStandardMaterial({
      color: opts.rimColor ?? 0xb9bec6, roughness: 0.30, metalness: 0.85,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.4 });
    this.wheelMaterials = [tireMat, rimMat, capMat];

    for (const w of this.vehicle.wheels) {
      const R = w.radius;
      const W = w.spec.width;
      const grp = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 26, 1, false), tireMat);
      tire.rotation.x = Math.PI / 2;                 // 圆柱默认沿 Y，转到沿 Z（自转轴）
      const rimR = w.spec.rimRadius ?? R * 0.66;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W * 0.86, 22, 1, false), rimMat);
      rim.rotation.x = Math.PI / 2;
      // 轮辐
      const spokes = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(rimR * 0.16, rimR * 1.62, W * 0.5), rimMat);
        s.rotation.z = (i / 5) * Math.PI * 2;
        spokes.add(s);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.24, rimR * 0.24, W * 1.02, 12), capMat);
      hub.rotation.x = Math.PI / 2;
      grp.add(tire, rim, spokes, hub);
      // 外侧刹车盘（转向时能看见）
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.026, 20),
        new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.45, metalness: 0.9 }));
      disc.rotation.x = Math.PI / 2;
      grp.add(disc);
      if (opts.shadows !== false) grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(grp);
      this.wheels.push({
        wheel: w, group: grp, spokes,
        radius: R,
      });
    }
  }

  // -------------------------------------------------------------------------
  /** 每渲染帧同步一次几何。 */
  update() {
    const body = this.body;
    const n = body.nodeCount;
    const posAttr = this.meshGeometry.getAttribute('position');
    const colAttr = this.meshGeometry.getAttribute('color');
    const pos = posAttr.array;
    const col = colAttr.array;
    const base = this.baseColor;
    const dmg = body.nodeDamage;
    let cx = 0, cy = 0, cz = 0, cmass = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      pos[o] = body.px[i]; pos[o + 1] = body.py[i]; pos[o + 2] = body.pz[i];
      const m = body.mass[i];
      cx += body.px[i] * m; cy += body.py[i] * m; cz += body.pz[i] * m; cmass += m;
      // 损伤：变暗 + 略偏铁锈色
      const d = dmg[i];
      if (d > 0.002) {
        const f = Math.max(0.28, 1 - d * 0.95);
        col[o] = base[o] * f;
        col[o + 1] = base[o + 1] * f * 0.94;
        col[o + 2] = base[o + 2] * f * 0.88;
      } else if (col[o] !== base[o]) {
        col[o] = base[o]; col[o + 1] = base[o + 1]; col[o + 2] = base[o + 2];
      }
    }
    if (cmass > 0) { cx /= cmass; cy /= cmass; cz /= cmass; }
    const front = this.geometry.stations[0].ring;
    const rear = this.geometry.stations[this.geometry.stations.length - 1].ring;
    let fx = 0, fy = 0, fz = 0, rx = 0, ry = 0, rz = 0;
    for (const i of front) { fx += body.px[i]; fy += body.py[i]; fz += body.pz[i]; }
    for (const i of rear) { rx += body.px[i]; ry += body.py[i]; rz += body.pz[i]; }
    const kf = 1 / front.length, kr = 1 / rear.length;
    const capF = n * 3, capR = (n + 1) * 3;
    pos[capF] = fx * kf; pos[capF + 1] = fy * kf; pos[capF + 2] = fz * kf;
    pos[capR] = rx * kr; pos[capR + 1] = ry * kr; pos[capR + 2] = rz * kr;
    // 细节件：按权重把对应车身节点混合出来，跟着钣金一起变形
    const det = this._details;
    if (det) {
      let o = (n + 2) * 3;
      for (let d = 0; d < det.length; d++) {
        const q = det[d].q, w = det[d].w;
        pos[o] = w[0] * body.px[q[0]] + w[1] * body.px[q[1]] + w[2] * body.px[q[2]] + w[3] * body.px[q[3]];
        pos[o + 1] = w[0] * body.py[q[0]] + w[1] * body.py[q[1]] + w[2] * body.py[q[2]] + w[3] * body.py[q[3]];
        pos[o + 2] = w[0] * body.pz[q[0]] + w[1] * body.pz[q[1]] + w[2] * body.pz[q[2]] + w[3] * body.pz[q[3]];
        o += 3;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.meshGeometry.computeVertexNormals();
    this.meshGeometry.computeBoundingSphere();

    // 车轮
    for (const vw of this.wheels) {
      const w = vw.wheel;
      const g = vw.group;
      if (w.detached) {
        if (!vw.detachedShown) { vw.detachedShown = true; g.visible = false; }
        continue;
      }
      g.visible = true;
      this._setWheelBasis(g, w);
      // 自转：视觉旋转方向与 spinAngle 相反
      vw.spokes.rotation.z = -w.spinAngle;
    }
  }

  _setWheelBasis(g, w) {
    const ax = w.spinAxis, up = w.wheelUp, fw = w.wheelFwd;
    const e = g.matrix.elements;
    // 圆柱几何体 rotation.x = π/2 之后轴向是局部 +Z，所以自转轴放第三列。
    // 三列取 (车轮前进, 车轮上方向, 自转轴) —— 三者右手正交，fwd × up = 自转轴。
    e[0] = fw.x; e[1] = fw.y; e[2] = fw.z; e[3] = 0;
    e[4] = up.x; e[5] = up.y; e[6] = up.z; e[7] = 0;
    e[8] = ax.x; e[9] = ax.y; e[10] = ax.z; e[11] = 0;
    e[12] = w.C.x; e[13] = w.C.y; e[14] = w.C.z; e[15] = 1;
    g.matrixAutoUpdate = false;
    g.matrixWorldNeedsUpdate = true;
  }

  setPaint(hex) {
    this.paint.setHex(hex);
    this.materials[0].color.copy(this.paint);
    this.materials[2].color.copy(this.paint).multiplyScalar(0.75);
  }

  setVisible(v) { this.group.visible = v; }

  dispose() {
    this.meshGeometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.wheelMaterials) m.dispose();
    for (const vw of this.wheels) {
      vw.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
}
