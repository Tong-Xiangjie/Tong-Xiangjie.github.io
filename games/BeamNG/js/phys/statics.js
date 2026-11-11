// ============================================================================
//  静态碰撞体（跳台、护栏、集装箱、水泥墙……）
//  统一用"带朝向的包围盒 / 有限圆柱"表示，配一个均匀网格做粗筛。
// ============================================================================
import { Vec3, clamp } from '../core/math.js';
import { MATERIALS } from './terrain.js';

export const SHAPE_BOX = 0;
export const SHAPE_CYLINDER = 1;

let _nextId = 1;

export class StaticBody {
  constructor() { this.id = _nextId++; }

  /**
   * 有朝向的盒子。
   * @param {number} cx,cy,cz 中心
   * @param {number} hx,hy,hz 半尺寸
   * @param {number} yaw      绕 Y 轴旋转
   * @param {number} pitch    绕 X 轴旋转（做斜坡）
   */
  static box(cx, cy, cz, hx, hy, hz, yaw = 0, pitch = 0, material = MATERIALS.CONCRETE, opts = {}) {
    const b = new StaticBody();
    b.shape = SHAPE_BOX;
    b.center = new Vec3(cx, cy, cz);
    b.half = new Vec3(hx, hy, hz);
    b.material = material;
    b.tag = opts.tag ?? 'box';
    b.mass = opts.mass ?? Infinity;       // 可被摧毁的道具给有限质量
    b.breakable = !!opts.breakable;
    b.health = opts.health ?? 1;
    b.mesh = opts.mesh ?? null;
    b.setOrientation(yaw, pitch, opts.roll ?? 0);
    b.computeAabb();
    return b;
  }

  static cylinder(cx, cy, cz, radius, height, material = MATERIALS.CONCRETE, opts = {}) {
    const b = new StaticBody();
    b.shape = SHAPE_CYLINDER;
    b.center = new Vec3(cx, cy, cz);
    b.radius = radius;
    b.height = height;
    b.material = material;
    b.tag = opts.tag ?? 'cylinder';
    b.mass = opts.mass ?? Infinity;
    b.breakable = !!opts.breakable;
    b.health = opts.health ?? 1;
    b.setOrientation(opts.yaw ?? 0, opts.pitch ?? 0, opts.roll ?? 0);
    b.computeAabb();
    return b;
  }

  /** 旋转矩阵（列 = 局部轴在世界中的方向）。yaw→pitch→roll。 */
  setOrientation(yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry(yaw) * Rx(pitch) * Rz(roll)
    const m00 = cy * cr + sy * sp * sr, m01 = -cy * sr + sy * sp * cr, m02 = sy * cp;
    const m10 = cp * sr, m11 = cp * cr, m12 = -sp;
    const m20 = -sy * cr + cy * sp * sr, m21 = sy * sr + cy * sp * cr, m22 = cy * cp;
    this.basis = new Float64Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]);
    this.yaw = yaw; this.pitch = pitch; this.roll = roll;
  }

  computeAabb() {
    const c = this.center;
    if (this.shape === SHAPE_BOX) {
      const b = this.basis, h = this.half;
      const ex = Math.abs(b[0]) * h.x + Math.abs(b[3]) * h.y + Math.abs(b[6]) * h.z;
      const ey = Math.abs(b[1]) * h.x + Math.abs(b[4]) * h.y + Math.abs(b[7]) * h.z;
      const ez = Math.abs(b[2]) * h.x + Math.abs(b[5]) * h.y + Math.abs(b[8]) * h.z;
      this.aabb = { minX: c.x - ex, maxX: c.x + ex, minY: c.y - ey, maxY: c.y + ey, minZ: c.z - ez, maxZ: c.z + ez };
    } else {
      const b = this.basis;
      const hy = this.height * 0.5;
      const ex = Math.abs(b[0]) * this.radius + Math.abs(b[3]) * hy + Math.abs(b[6]) * this.radius;
      const ey = Math.abs(b[1]) * this.radius + Math.abs(b[4]) * hy + Math.abs(b[7]) * this.radius;
      const ez = Math.abs(b[2]) * this.radius + Math.abs(b[5]) * hy + Math.abs(b[8]) * this.radius;
      this.aabb = { minX: c.x - ex, maxX: c.x + ex, minY: c.y - ey, maxY: c.y + ey, minZ: c.z - ez, maxZ: c.z + ez };
    }
  }

  /** 世界坐标 → 局部坐标。 */
  toLocal(x, y, z, out) {
    const b = this.basis, c = this.center;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    out[0] = b[0] * dx + b[1] * dy + b[2] * dz;
    out[1] = b[3] * dx + b[4] * dy + b[5] * dz;
    out[2] = b[6] * dx + b[7] * dy + b[8] * dz;
    return out;
  }

  /** 局部坐标 → 世界坐标（增量）。 */
  toWorldDir(lx, ly, lz, out) {
    const b = this.basis;
    out.set(
      b[0] * lx + b[3] * ly + b[6] * lz,
      b[1] * lx + b[4] * ly + b[7] * lz,
      b[2] * lx + b[5] * ly + b[8] * lz,
    );
    return out;
  }

  /**
   * 球体与本体求交。
   * @returns {number} 穿透深度（<=0 表示不相交）；法线写入 outNormal（世界坐标，指向球心外侧）
   */
  sphereContact(x, y, z, r, outNormal) {
    const local = _localScratch;
    this.toLocal(x, y, z, local);
    if (this.shape === SHAPE_BOX) {
      const h = this.half;
      const qx = clamp(local[0], -h.x, h.x);
      const qy = clamp(local[1], -h.y, h.y);
      const qz = clamp(local[2], -h.z, h.z);
      let dx = local[0] - qx, dy = local[1] - qy, dz = local[2] - qz;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) return -1;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const inv = 1 / d;
        this.toWorldDir(dx * inv, dy * inv, dz * inv, outNormal);
        return r - d;
      }
      // 球心在盒内：沿穿透最浅的轴弹出
      const px = h.x - Math.abs(local[0]);
      const py = h.y - Math.abs(local[1]);
      const pz = h.z - Math.abs(local[2]);
      if (px <= py && px <= pz) {
        this.toWorldDir(Math.sign(local[0]) || 1, 0, 0, outNormal);
        return r + px;
      } else if (py <= pz) {
        this.toWorldDir(0, Math.sign(local[1]) || 1, 0, outNormal);
        return r + py;
      }
      this.toWorldDir(0, 0, Math.sign(local[2]) || 1, outNormal);
      return r + pz;
    }
    // 圆柱：局部 Y 为轴。实心圆柱上最近点 = 径向按 R 截断 + 轴向按 ±hy 截断。
    const hy = this.height * 0.5;
    const R = this.radius;
    const rr = Math.hypot(local[0], local[2]);
    let sx = local[0], sz = local[2];
    if (rr > R && rr > 1e-12) { const k = R / rr; sx *= k; sz *= k; }
    const sy = clamp(local[1], -hy, hy);
    const dx = local[0] - sx, dy = local[1] - sy, dz = local[2] - sz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return -1;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      this.toWorldDir(dx / d, dy / d, dz / d, outNormal);
      return r - d;
    }
    // 球心在圆柱内：沿最浅的轴弹出
    const radialPen = R - rr;
    const axialPen = hy - Math.abs(local[1]);
    if (radialPen <= axialPen && rr > 1e-9) {
      this.toWorldDir(local[0] / rr, 0, local[2] / rr, outNormal);
      return r + radialPen;
    }
    this.toWorldDir(0, Math.sign(local[1]) || 1, 0, outNormal);
    return r + axialPen;
  }

  containsPoint(x, y, z) {
    const local = _localScratch2;
    this.toLocal(x, y, z, local);
    if (this.shape === SHAPE_BOX) {
      return Math.abs(local[0]) <= this.half.x && Math.abs(local[1]) <= this.half.y && Math.abs(local[2]) <= this.half.z;
    }
    const hy = this.height * 0.5;
    return Math.abs(local[1]) <= hy && local[0] * local[0] + local[2] * local[2] <= this.radius * this.radius;
  }

  /** 射线求交（世界坐标，dir 已归一化）。返回 t 或 -1。 */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const b = this.basis, c = this.center;
    // 把射线变换到局部空间
    const rx = ox - c.x, ry = oy - c.y, rz = oz - c.z;
    const lox = b[0] * rx + b[1] * ry + b[2] * rz;
    const loy = b[3] * rx + b[4] * ry + b[5] * rz;
    const loz = b[6] * rx + b[7] * ry + b[8] * rz;
    const ldx = b[0] * dx + b[1] * dy + b[2] * dz;
    const ldy = b[3] * dx + b[4] * dy + b[5] * dz;
    const ldz = b[6] * dx + b[7] * dy + b[8] * dz;

    if (this.shape === SHAPE_BOX) {
      const h = this.half;
      let tmin = 0, tmax = maxT;
      const slab = (o, d, ext) => {
        if (Math.abs(d) < 1e-9) return o >= -ext && o <= ext;
        let t1 = (-ext - o) / d, t2 = (ext - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        return tmin <= tmax;
      };
      if (!slab(lox, ldx, h.x)) return -1;
      if (!slab(loy, ldy, h.y)) return -1;
      if (!slab(loz, ldz, h.z)) return -1;
      return tmin >= 0 ? tmin : -1;
    }
    // 圆柱（无限圆柱求交 + 端盖裁剪）
    const a = ldx * ldx + ldz * ldz;
    const hy = this.height * 0.5;
    let tBest = -1;
    if (a > 1e-12) {
      const bq = 2 * (lox * ldx + loz * ldz);
      const cq = lox * lox + loz * loz - this.radius * this.radius;
      const disc = bq * bq - 4 * a * cq;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-bq - sq) / (2 * a), (-bq + sq) / (2 * a)]) {
          if (t >= 0 && t <= maxT) {
            const yy = loy + ldy * t;
            if (Math.abs(yy) <= hy) { tBest = t; break; }
          }
        }
      }
    }
    if (Math.abs(ldy) > 1e-9) {
      for (const yy of [hy, -hy]) {
        const t = (yy - loy) / ldy;
        if (t >= 0 && t <= maxT && (tBest < 0 || t < tBest)) {
          const xx = lox + ldx * t, zz = loz + ldz * t;
          if (xx * xx + zz * zz <= this.radius * this.radius) tBest = t;
        }
      }
    }
    return tBest;
  }
}

const _localScratch = new Float64Array(3);
const _localScratch2 = new Float64Array(3);

// ---------------------------------------------------------------------------
//  均匀网格粗筛：静态体数量上百时，逐节点暴力测试会明显拖慢物理。
// ---------------------------------------------------------------------------
export class StaticWorld {
  constructor(cellSize = 8) {
    this.bodies = [];
    this.cellSize = cellSize;
    this.grid = new Map();
    this.dynamic = [];   // 可被撞飞的物件（轮胎、油桶），每帧重建
  }

  add(body) {
    this.bodies.push(body);
    body.computeAabb();
    const cs = this.cellSize;
    const a = body.aabb;
    const ix0 = Math.floor(a.minX / cs), ix1 = Math.floor(a.maxX / cs);
    const iz0 = Math.floor(a.minZ / cs), iz1 = Math.floor(a.maxZ / cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = ix * 1000003 + iz;
        let cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(body);
      }
    }
    return body;
  }

  clear() { this.bodies.length = 0; this.grid.clear(); }

  /** 返回 (x,z) 所在网格单元的候选体列表；没有则返回空数组。 */
  cellAt(x, z) {
    const cs = this.cellSize;
    return this.grid.get(Math.floor(x / cs) * 1000003 + Math.floor(z / cs)) || EMPTY;
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    const cs = this.cellSize;
    const a = body.aabb;
    for (let ix = Math.floor(a.minX / cs); ix <= Math.floor(a.maxX / cs); ix++) {
      for (let iz = Math.floor(a.minZ / cs); iz <= Math.floor(a.maxZ / cs); iz++) {
        const cell = this.grid.get(ix * 1000003 + iz);
        if (!cell) continue;
        const j = cell.indexOf(body);
        if (j >= 0) cell.splice(j, 1);
      }
    }
  }
}

const EMPTY = [];
