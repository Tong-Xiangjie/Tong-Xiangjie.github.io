// ============================================================================
//  地形网格
//  · 分块流式生成：只有摄像机周围 viewDistance 内的块存在，进出自动回收
//  · 高度/法线/材质全部来自 Terrain 的解析函数 —— 和物理用的是同一份数据，
//    所以车轮永远不会"悬空"或"陷进"地面
//  · 道路与场坪单独做成薄片贴在面上：地形网格分辨率做不到清晰的柏油边线
// ============================================================================
import * as THREE from '../../vendor/three.module.js';
import { MATERIALS } from '../phys/terrain.js';

const _c = new THREE.Color();
const _rockColor = new THREE.Color(0x6a6152);

/** 顶点颜色：材质基色 + 一点确定性噪声，避免大片纯色。 */
function tint(base, x, z, out) {
  out.setHex(base);
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  const f = (n - Math.floor(n)) * 0.16 + 0.92;
  out.multiplyScalar(f);
  return out;
}

export class TerrainMesh {
  /**
   * @param {import('../phys/terrain.js').Terrain} terrain
   */
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    this.chunkSize = opts.chunkSize ?? 96;        // 块越大，同样视距下块数越少
    this.res = opts.res ?? 24;                    // 每块 res×res 个四边形
    this.viewDistance = opts.viewDistance ?? 700;
    this.buildPerFrame = opts.buildPerFrame ?? 2;
    this.group = new THREE.Group();
    this.chunks = new Map();
    this._queue = [];
    this.enabled = true;

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, metalness: 0.0, dithering: true,
    });
    this.disposeList = [this.material];
  }

  _key(cx, cz) { return cx * 100003 + cz; }

  _buildChunk(cx, cz) {
    const t = this.terrain;
    const size = this.chunkSize;
    const n = this.res;
    const step = size / n;
    const ox = cx * size - size / 2;
    const oz = cz * size - size / 2;
    const vcount = (n + 1) * (n + 1);
    const pos = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    // 先把 (n+3)² 的高度算出来，法线用中心差分求 —— 直接调 terrain.normal
    // 会让每个顶点多做 4 次噪声求值，分块生成速度差 4 倍。
    const E = n + 3;
    const hg = this._hgrid ?? (this._hgrid = new Float64Array((this.res + 4) * (this.res + 4)));
    for (let j = -1; j <= n + 1; j++) {
      const z = oz + j * step;
      for (let i = -1; i <= n + 1; i++) {
        hg[(j + 1) * E + (i + 1)] = t.height(ox + i * step, z);
      }
    }
    let p = 0;
    for (let j = 0; j <= n; j++) {
      const z = oz + j * step;
      for (let i = 0; i <= n; i++) {
        const x = ox + i * step;
        const gi = (j + 1) * E + (i + 1);
        const y = hg[gi];
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
        const dx = hg[gi + 1] - hg[gi - 1];
        const dz = hg[gi + E] - hg[gi - E];
        // 法线 = normalize(-dh/dx, 2·step, -dh/dz) 的等比形式
        let nx = -dx, ny = 2 * step, nz = -dz;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv; nz *= inv;
        nor[p] = nx; nor[p + 1] = ny; nor[p + 2] = nz;
        const mat = t.materialAt(x, y, z);
        tint(mat.color, x, z, _c);
        const slope = 1 - Math.min(1, ny);
        if (slope > 0.22) _c.lerp(_rockColor, Math.min(1, (slope - 0.22) * 3.4));
        col[p] = _c.r; col[p + 1] = _c.g; col[p + 2] = _c.b;
        p += 3;
      }
    }
    const idx = new Uint32Array(n * n * 6);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return { mesh, dist2: 0 };
  }

  /** 每帧调用：按摄像机位置补齐/回收分块，每次最多新建 buildPerFrame 块。 */
  update(camPos) {
    if (!this.enabled) return;
    const size = this.chunkSize;
    const ccx = Math.floor(camPos.x / size);
    const ccz = Math.floor(camPos.z / size);
    const radius = Math.ceil(this.viewDistance / size);
    // 需要哪些块
    const want = new Set();
    const list = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const ddx = (cx * size + size / 2) - camPos.x;
        const ddz = (cz * size + size / 2) - camPos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > this.viewDistance * this.viewDistance) continue;
        const key = this._key(cx, cz);
        want.add(key);
        if (!this.chunks.has(key)) list.push([cx, cz, d2]);
      }
    }
    // 近处优先
    list.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < list.length && i < this.buildPerFrame; i++) {
      const [cx, cz, d2] = list[i];
      const key = this._key(cx, cz);
      const chunk = this._buildChunk(cx, cz);
      chunk.dist2 = d2;
      this.chunks.set(key, chunk);
      this.group.add(chunk.mesh);
    }
    // 回收
    for (const [key, chunk] of this.chunks) {
      if (!want.has(key)) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  setViewDistance(d) {
    this.viewDistance = d;
    // 强制下一帧重算
    for (const [, chunk] of this.chunks) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
  }

  get ready() { return this._queue.length === 0; }

  dispose() {
    for (const [, chunk] of this.chunks) chunk.mesh.geometry.dispose();
    this.chunks.clear();
    for (const d of this.disposeList) d.dispose();
  }
}

/**
 * 道路薄片：沿折线加密采样，生成一条贴着地面的带子。
 * 物理上的 μ 也来自同一条 roads 定义，所以视觉与手感一致。
 */
export class RoadMesh {
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.materials = new Map();
    this.disposeList = [];
    this.lift = opts.lift ?? 0.035;
    this.seg = opts.seg ?? 2.0;
    // 每铺一层路面/场坪就往后排一个深度偏置。
    // 原因：这些面都是"贴在解析地形之上"的共面薄片，跑道、环路、混凝土场坪
    // 在出生点附近大面积重叠。以前 _matFor 按材质缓存，所有沥青路共用同一个
    //材质、同一个 lift 和同一个 polygonOffset —— 重叠处深度完全相等，
    // GPU 每帧随便挑一个赢，于是那段路一直在闪。
    // polygonOffsetUnits 的单位就是深度缓冲能分辨的最小差值，所以给每层
    // 递增的单位偏置可以得到一个与距离无关、稳定的胜负关系。
    this._layer = 0;
    for (const road of terrain.roads) this._buildRoad(road, this._layer++);
    for (const pad of terrain.pads) this._buildPad(pad, this._layer++);
    // 水面单独一组：半透明、不写深度，要最后画
    this.waterGroup = new THREE.Group();
    this.group.add(this.waterGroup);
    for (const ch of terrain.channels) this._buildWater(ch);
  }

  /**
   * 水面。水位取"挖之前的地面 - 0.45"，而不是"挖完的河床 + 多少"。
   * 差別很关键：河床是挖出来的，用河床推水位的话，只要河道所在的地形本身
   * 比较平（这里两岸只比河床高一点点），水面就会高过河岸淹掉大片地面。
   * 挖之前的地面 = height() + cut()，因为 cut 就是从地形上纯减掉的量。
   * 再夹一次上游/下游河岸高度，防止起伏地形上水从低的一侧漫出去。
   */
  _buildWater(ch) {
    const t = this.terrain;
    const pts = ch.points;
    if (pts.length < 2) return;
    const levelAt = (x, z, nx, nz) => {
      const ground = t.height(x, z) + ch.cut(x, z);   // 未开挖的地面
      let wl = ground - 0.45;
      // 两侧河岸（用未开挖高度）兜底
      const d = ch.half + ch.bank * 0.85;
      const b1 = t.height(x + nx * d, z + nz * d) + ch.cut(x + nx * d, z + nz * d);
      const b2 = t.height(x - nx * d, z - nz * d) + ch.cut(x - nx * d, z - nz * d);
      const bank = Math.min(b1, b2);
      if (wl > bank - 0.2) wl = bank - 0.2;
      return wl;
    };
    // 先把折线细分，并算出每个采样点的水位
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const bx = pts[i + 1][0], bz = pts[i + 1][1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(2, Math.ceil(len / 8));
      const nx = -(bz - az) / Math.max(1e-6, len), nz = (bx - ax) / Math.max(1e-6, len);
      for (let s = 0; s < steps; s++) {
        const u = s / steps;
        const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        samples.push({ x, z, y: levelAt(x, z, nx, nz) });
      }
    }
    const last = pts[pts.length - 1];
    samples.push({ x: last[0], z: last[1], y: levelAt(last[0], last[1], 0, 0) });
    // 滑动平均（窗口 5）
    const smooth = samples.map((p, i) => {
      let sum = 0, n = 0;
      for (let k = -2; k <= 2; k++) {
        const q = samples[i + k];
        if (q) { sum += q.y; n++; }
      }
      return { x: p.x, z: p.z, y: sum / n };
    });
    const positions = [];
    const wide = ch.half * 0.97;
    for (let i = 0; i < smooth.length - 1; i++) {
      const a = smooth[i], b = smooth[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.max(1e-6, Math.hypot(dx, dz));
      const nx = -dz / len, nz = dx / len;          // 横向法向
      const alx = a.x + nx * wide, alz = a.z + nz * wide;
      const arx = a.x - nx * wide, arz = a.z - nz * wide;
      const blx = b.x + nx * wide, blz = b.z + nz * wide;
      const brx = b.x - nx * wide, brz = b.z - nz * wide;
      positions.push(alx, a.y, alz, brx, b.y, brz, arx, a.y, arz);
      positions.push(alx, a.y, alz, blx, b.y, blz, brx, b.y, brz);
    }
    if (!positions.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    if (!this._waterMat) {
      this._waterMat = new THREE.MeshStandardMaterial({
        color: 0x2a6f86, roughness: 0.12, metalness: 0.25,
        transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -24,
      });
      this.disposeList.push(this._waterMat);
    }
    const mesh = new THREE.Mesh(g, this._waterMat);
    mesh.renderOrder = 2;
    this.waterGroup.add(mesh);
  }

  _matFor(material, layer = 0, emissive) {
    const key = `${material.id}#${layer}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: material.color, roughness: 0.86, metalness: 0.02,
      emissive: emissive ?? 0x000000, polygonOffset: true,
      polygonOffsetFactor: -1.5 - layer * 0.4,
      polygonOffsetUnits: -2 - layer * 3,
    });
    this.materials.set(key, m);
    this.disposeList.push(m);
    return m;
  }

  /** 这一层的几何抬升量：与深度偏置一起保证重叠面不会打架。 */
  _liftFor(layer) { return this.lift + layer * 0.004; }

  _buildRoad(road, layer = 0) {
    const t = this.terrain;
    const pts = road.points;
    if (pts.length < 2) return;
    const positions = [];
    const colors = [];
    const half = road.half;
    const lift = this._liftFor(layer);
    const col = new THREE.Color(road.material.color);
    const lineCol = new THREE.Color(0xe8e2c8);
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const bx = pts[i + 1][0], bz = pts[i + 1][1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / this.seg));
      // 法向
      const nx = -(bz - az) / Math.max(1e-6, len);
      const nz = (bx - ax) / Math.max(1e-6, len);
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const p0 = this._edge(t, ax + (bx - ax) * t0, az + (bz - az) * t0, nx, nz, half, lift);
        const p1 = this._edge(t, ax + (bx - ax) * t1, az + (bz - az) * t1, nx, nz, half, lift);
        // 两个三角形：p0.l, p0.r, p1.r / p0.l, p1.r, p1.l
        positions.push(...p0.l, ...p1.r, ...p0.r);
        positions.push(...p0.l, ...p1.l, ...p1.r);
        for (let v = 0; v < 6; v++) colors.push(col.r, col.g, col.b);
      }
      // 中线（虚线感：用短的一小条）
      const cw = 0.14;
      void lineCol; void cw;
    }
    if (positions.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this._matFor(road.material, layer));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _edge(t, x, z, nx, nz, half, lift = this.lift) {
    const lx = x + nx * half, lz = z + nz * half;
    const rx = x - nx * half, rz = z - nz * half;
    return {
      l: [lx, t.height(lx, lz) + lift, lz],
      r: [rx, t.height(rx, rz) + lift, rz],
    };
  }

  _buildPad(pad, layer = 0) {
    const t = this.terrain;
    const lift = this._liftFor(layer);
    // PadRect 存的是 cos(-angle)/sin(-angle)，这里做逆旋转把局部角点变回世界坐标
    const c = pad.cos ?? 1, s = pad.sin ?? 0;
    const corners = [[-pad.hx, -pad.hz], [pad.hx, -pad.hz], [pad.hx, pad.hz], [-pad.hx, pad.hz]];
    const pos = [];
    const world = corners.map(([lx, lz]) => {
      const wx = pad.cx + lx * c + lz * s;
      const wz = pad.cz - lx * s + lz * c;
      return [wx, t.height(wx, wz) + lift, wz];
    });
    pos.push(...world[0], ...world[2], ...world[1]);
    pos.push(...world[0], ...world[3], ...world[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this._matFor(pad.material ?? MATERIALS.CONCRETE, layer));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.disposeList) m.dispose();
  }
}
