// ============================================================================
//  地形：解析式高度场
//  物理只需要 O(1) 的 height(x,z) 查询，渲染层再用同一个函数去铺网格 ——
//  两者永远不会对不上。所有噪声都是种子化的，因此世界完全可复现。
// ============================================================================
import { Noise2D, lerp, clamp, smoothstep, smoothBand, Vec3 } from '../core/math.js';

/** 地面材质：抓地力系数直接决定轮胎能传多大力。 */
export const MATERIALS = {
  ASPHALT: { id: 0, name: '沥青', mu: 1.00, rolling: 0.012, dust: 0.05, color: 0x2b2b2f, drag: 0.0 },
  CONCRETE: { id: 1, name: '混凝土', mu: 0.92, rolling: 0.015, dust: 0.10, color: 0x8a8a86, drag: 0.0 },
  DIRT: { id: 2, name: '泥土', mu: 0.62, rolling: 0.045, dust: 0.75, color: 0x6b543a, drag: 0.004 },
  GRASS: { id: 3, name: '草地', mu: 0.55, rolling: 0.055, dust: 0.35, color: 0x4a6b34, drag: 0.006 },
  SAND: { id: 4, name: '沙地', mu: 0.45, rolling: 0.090, dust: 1.00, color: 0xc2a878, drag: 0.010 },
  GRAVEL: { id: 5, name: '碎石', mu: 0.70, rolling: 0.035, dust: 0.55, color: 0x77726a, drag: 0.003 },
  MUD: { id: 6, name: '泥浆', mu: 0.34, rolling: 0.120, dust: 0.40, color: 0x3d2f22, drag: 0.014 },
};
export const MATERIAL_LIST = Object.values(MATERIALS);

/** 路面"带"：一条折线 + 宽度，用来在地形上刻出道路。 */
class RoadStrip {
  constructor(points, width, material, blend = 4) {
    this.points = points;
    this.width = width;
    this.half = width * 0.5;
    this.material = material;
    this.blend = blend;
    // 包围盒（外扩"半宽 + 过渡带"）：物理每帧要问几万次地面高度，
    // 先做一次 4 次比较的 AABB 剔除，比逐段投影便宜得多。
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    const pad = this.half + blend + 0.5;
    this.minX = minX - pad; this.maxX = maxX + pad;
    this.minZ = minZ - pad; this.maxZ = maxZ + pad;
  }

  inRange(x, z) {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }

  /** 返回 (覆盖强度, 到中线距离)。强度 1 = 完全在路面内。 */
  influence(x, z) {
    const pts = this.points;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const bx = pts[i + 1][0], bz = pts[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t, cz = az + dz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < best) best = d;
    }
    return { d: best, w: 1 - smoothstep((best - this.half) / Math.max(1e-3, this.blend)) };
  }
}

/** 矩形场坪：混凝土台、停车场之类。 */
class PadRect {
  constructor(cx, cz, halfX, halfZ, angle, material, falloff = 3) {
    this.cx = cx; this.cz = cz;
    this.hx = halfX; this.hz = halfZ;
    this.cos = Math.cos(-angle); this.sin = Math.sin(-angle);
    this.material = material;
    this.falloff = falloff;
    // 旋转后的 AABB 半径，用来做 O(1) 剔除
    const c = Math.abs(this.cos), s = Math.abs(this.sin);
    this.radX = halfX * c + halfZ * s + falloff + 0.5;
    this.radZ = halfX * s + halfZ * c + falloff + 0.5;
  }

  inRange(x, z) {
    const dx = x - this.cx, dz = z - this.cz;
    return dx >= -this.radX && dx <= this.radX && dz >= -this.radZ && dz <= this.radZ;
  }

  influence(x, z) {
    const dx = x - this.cx, dz = z - this.cz;
    const lx = Math.abs(dx * this.cos - dz * this.sin);
    const lz = Math.abs(dx * this.sin + dz * this.cos);
    const d = Math.max(lx - this.hx, lz - this.hz);
    return 1 - smoothstep(d / Math.max(1e-3, this.falloff));
  }
}

export class Terrain {
  /**
   * @param {object} opts
   *   seed          随机种子
   *   amplitude     起伏幅度（米）
   *   baseFrequency 基础频率（1/米）
   *   flat          平坦区：{ cx, cz, radius, blend } —— 出生点周围保证平整
   *   roads         道路折线
   *   pads          场坪矩形
   *   mountains     远处山体强度
   */
  constructor(opts = {}) {
    this.seed = opts.seed ?? 20261105;
    this.amplitude = opts.amplitude ?? 6.0;
    this.baseFrequency = opts.baseFrequency ?? 0.0075;
    this.noise = new Noise2D(this.seed);
    this.detail = new Noise2D(this.seed ^ 0x9e3779b9);
    this.flat = opts.flat ?? { cx: 0, cz: 0, radius: 60, blend: 40 };
    this.roads = (opts.roads ?? []).map((r) => new RoadStrip(r.points, r.width, r.material ?? MATERIALS.ASPHALT, r.blend ?? 5));
    this.pads = (opts.pads ?? []).map((p) => new PadRect(p.cx, p.cz, p.hx, p.hz, p.angle ?? 0, p.material ?? MATERIALS.CONCRETE, p.falloff ?? 3));
    this.mountains = opts.mountains ?? 1;
    this.mountainStart = opts.mountainStart ?? 260;
    this.detailAmount = opts.detail ?? 0.25;
    this._n = new Vec3();
    this.buildCache(opts.cacheBits ?? 17, opts.cacheCell ?? 0.5);
  }

  /** 平坦区掩码：0 = 完全平坦，1 = 完全地形。 */
  flatMask(x, z) {
    const f = this.flat;
    const d = Math.hypot(x - f.cx, z - f.cz);
    return smoothstep((d - f.radius) / Math.max(1e-3, f.blend));
  }

  /** 基础地形高度（不考虑道路/场坪的整平）。 */
  baseHeight(x, z) {
    const n = this.noise;
    const f = this.baseFrequency;
    let h = 0;
    h += n.fbm(x * f, z * f, 5, 2.03, 0.5) * this.amplitude;
    // 一层更粗的大尺度起伏，制造缓坡长波
    h += n.fbm(x * f * 0.22 + 31.7, z * f * 0.22 - 11.3, 3, 2.11, 0.55) * this.amplitude * 2.4;
    // 细节层：让轮胎有"路面质感"，但在出生区/场坪必须归零，否则停车都在抖
    const dm = this.flatMask(x, z);
    if (dm > 0.001) h += this.detail.fbm(x * f * 6.0, z * f * 6.0, 2, 2.0, 0.5) * this.detailAmount * dm;
    // 远山：径向抬升，把地图边缘围起来
    const d = Math.hypot(x, z);
    if (d > this.mountainStart) {
      const t = (d - this.mountainStart) / 180;
      const ridge = this.noise.fbm(x * 0.0035 + 7.1, z * 0.0035 - 3.3, 4, 2.07, 0.52);
      h += smoothstep(t) * this.mountains * (34 + ridge * 46) * Math.min(3, t);
    }
    return h;
  }

  /**
   * 最终高度：道路/场坪整平 → 最后再套"出生区绝对平坦"。
   * 顺序很关键：平坦区必须最后生效。否则横穿场坪的跑道路面会把出生点
   * 挖出一条沟，车一出生就悬空或者陷进地里。
   */
  height(x, z) {
    let h = this.baseHeight(x, z);
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      if (!pad.inRange(x, z)) continue;
      const w = pad.influence(x, z);
      if (w > 0.001) {
        // 场坪找一个代表高度并整平（代表高度只和场坪有关，缓存起来）
        if (pad._target === undefined) pad._target = this.baseHeight(pad.cx, pad.cz);
        h = lerp(h, pad._target, w * 0.985);
      }
    }
    for (let i = 0; i < this.roads.length; i++) {
      const road = this.roads[i];
      if (!road.inRange(x, z)) continue;
      const { w } = road.influence(x, z);
      if (w > 0.001) {
        // 道路沿行进方向取两侧高程的平均，做出"削平山坡"的效果
        const target = this.baseHeight(x, z) * 0.35 + this._roadLevel(road, x, z) * 0.65;
        h = lerp(h, target, w * 0.9);
      }
    }
    const m = this.flatMask(x, z);
    if (m < 1) {
      if (this.flatHeight === undefined) this.flatHeight = this.baseHeight(this.flat.cx, this.flat.cz);
      h = lerp(this.flatHeight, h, m);
    }
    return h;
  }

  _roadLevel(road, x, z) {
    // 投影到折线的每一段上取最近点的高度。只取顶点的话，一条长直路的
    // 端点若落在山坡上，整条路会被抬到那个高度（出生点直接悬空 6 米）。
    const pts = road.points;
    let best = Infinity, bh = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const bx = pts[i + 1][0], bz = pts[i + 1][1];
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez;
      let t = len2 > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + ex * t, cz = az + ez * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < best) { best = d; bh = this.baseHeight(cx, cz); }
    }
    if (pts.length === 1) bh = this.baseHeight(pts[0][0], pts[0][1]);
    return bh;
  }

  /** 法线：中心差分，返回归一化向量。 */
  normal(x, z, out = this._n) {
    const e = 0.35;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU);
    return out.normalize();
  }

  // --- 物理热路径用的快速采样 ------------------------------------------
  // 物理每帧要问几万次地面高度（304 个节点 × 4 个子步），解析求值一次
  // 要 2 µs 上下，占掉了整个物理帧一半的预算。这里按 0.5 m 网格缓存解析
  // 高度再做双线性插值：单次只要几十纳秒，而且结果只取决于 (x, z)，
  // 与查询顺序无关，不会破坏确定性。与解析值之差在毫米级（噪声波长
  // 20 m 以上，曲率极小），渲染网格本身还是 4 m 一格，肉眼无差别。

  /** 网格缓存高度（双线性插值）。 */
  heightFast(x, z) {
    const c = this._cache;
    const gx = x * c.inv, gz = z * c.inv;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this._cell(ix, iz), h10 = this._cell(ix + 1, iz);
    const h01 = this._cell(ix, iz + 1), h11 = this._cell(ix + 1, iz + 1);
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fz;
  }

  /** 取网格点高度，未命中则解析求值并写入（直接映射缓存，冲突就覆盖）。 */
  _cell(ix, iz) {
    const c = this._cache;
    if (!c) return this.height(ix * 0.5, iz * 0.5);
    const slot = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) & c.mask;
    const tag = ((ix & 0xfff) << 12) | (iz & 0xfff);
    if (c.tag[slot] === tag) return c.val[slot];
    const v = this.height(ix * c.cell, iz * c.cell);
    c.tag[slot] = tag;
    c.val[slot] = v;
    return v;
  }

  /** 用缓存采样的法线（物理接触用）。 */
  normalFast(x, z, out = this._n) {
    const e = 0.35;
    const hL = this.heightFast(x - e, z), hR = this.heightFast(x + e, z);
    const hD = this.heightFast(x, z - e), hU = this.heightFast(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU);
    return out.normalize();
  }

  /** 建立缓存（默认 2^17 格，直接映射）。 */
  buildCache(bits = 17, cell = 0.5) {
    const n = 1 << bits;
    this._cache = {
      mask: n - 1, cell, inv: 1 / cell,
      tag: new Int32Array(n).fill(0x7fffffff),
      val: new Float64Array(n),
    };
    return this._cache;
  }

  /**
   * 地表材质（含噪声斑块，让泥土/草地交错）。
   * @param {number} [slope] 已知的坡度（1 - n.y），传入可省掉 4 次高度采样
   */
  materialAt(x, z, slope = null) {
    // 道路与场坪优先
    let bestW = 0, mat = null;
    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      if (!pad.inRange(x, z)) continue;
      const w = pad.influence(x, z);
      if (w > bestW) { bestW = w; mat = pad.material; }
    }
    for (let i = 0; i < this.roads.length; i++) {
      const road = this.roads[i];
      if (!road.inRange(x, z)) continue;
      const { w } = road.influence(x, z);
      if (w > bestW) { bestW = w; mat = road.material; }
    }
    if (mat && bestW > 0.5) return mat;
    // 坡度 + 噪声决定自然地表
    const sl = slope !== null ? slope : 1 - this.normal(x, z).y;
    const patch = this.detail.fbm(x * 0.02, z * 0.02, 3, 2.0, 0.5);
    if (bestW <= 0.5 && mat) return mat;
    if (sl > 0.34) return MATERIALS.GRAVEL;
    if (patch > 0.42) return MATERIALS.SAND;
    if (patch < -0.46) return MATERIALS.DIRT;
    const wet = this.noise.fbm(x * 0.012 + 90, z * 0.012 - 40, 2, 2.0, 0.5);
    if (wet > 0.55 && sl < 0.08) return MATERIALS.MUD;
    return MATERIALS.GRASS;
  }

  /** 给渲染层用的近似坡度（0=平，1=陡）。 */
  slopeAt(x, z) {
    const n = this.normal(x, z, this._n);
    return 1 - n.y;
  }
}
