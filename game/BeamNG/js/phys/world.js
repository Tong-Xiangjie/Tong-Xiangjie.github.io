// ============================================================================
//  碰撞世界：把"解析地形"和"静态刚体"统一成两种查询
//    · collectContacts  球体 vs 世界 → 切线平面（供软体求解器用）
//    · raycast          射线 vs 世界 → 供轮胎接地点/悬挂探测用
// ============================================================================
import { Vec3, clamp } from '../core/math.js';
import { MATERIALS } from './terrain.js';

const MAX_OUT = 4;
const _n = new Vec3();
const _hitN = new Vec3();

export class CollisionWorld {
  constructor(terrain, statics) {
    this.terrain = terrain;
    this.statics = statics;
    this.rayHit = {
      t: 0, x: 0, y: 0, z: 0,
      nx: 0, ny: 1, nz: 0,
      material: MATERIALS.ASPHALT,
      body: null,
      hits: 0,
    };
  }

  /**
   * 球体附近的所有接触切线平面。
   * @param {Float64Array} out 步长 5：[nx, ny, nz, depth, materialId]
   * @returns {number} 写入的平面数量
   */
  collectContacts(x, y, z, r, out, maxOut = MAX_OUT) {
    let count = 0;
    const terrain = this.terrain;
    // --- 地形（用网格缓存采样：解析求值太贵，见 terrain.heightFast） ---
    const h = terrain.heightFast(x, z);
    if (y - r < h + 0.6) {
      terrain.normalFast(x, z, _n);
      // 平面：n·X = d，其中 d 取接触点所在平面
      const d = _n.x * x + _n.y * h + _n.z * z;
      const depth = r - (_n.x * x + _n.y * y + _n.z * z - d);
      if (depth > -0.02) {
        out[0] = _n.x; out[1] = _n.y; out[2] = _n.z; out[3] = depth;
        out[4] = terrain.materialAt(x, z, 1 - _n.y).id;
        count = 1;
      }
    }
    // --- 静态体 ---
    const cell = this.statics.cellAt(x, z);
    for (let i = 0; i < cell.length && count < maxOut; i++) {
      const body = cell[i];
      const a = body.aabb;
      if (x + r < a.minX || x - r > a.maxX || z + r < a.minZ || z - r > a.maxZ || y + r < a.minY || y - r > a.maxY) continue;
      const depth = body.sphereContact(x, y, z, r, _n);
      if (depth > -0.02) {
        const o = count * 5;
        out[o] = _n.x; out[o + 1] = _n.y; out[o + 2] = _n.z; out[o + 3] = depth;
        out[o + 4] = body.material.id;
        count++;
      }
    }
    return count;
  }

  /** 只查询地形（节点材质判断等轻量用途）。 */
  groundHeight(x, z) { return this.terrain.height(x, z); }

  /** 某点的地表材质：静态体优先，其次地形。 */
  materialAt(x, y, z) {
    const cell = this.statics.cellAt(x, z);
    for (let i = 0; i < cell.length; i++) {
      if (cell[i].containsPoint(x, y + 0.03, z)) return cell[i].material;
    }
    return this.terrain.materialAt(x, z);
  }

  /**
   * 射线投射。dir 不必归一化，但 maxT 与 dir 长度同一量纲。
   * 命中返回 this.rayHit（t 为沿 dir 的参数），否则返回 null。
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let bestT = maxT;
    let hitBody = null;
    const hit = this.rayHit;
    hit.hits = 0;

    // --- 地形 ---
    const tGround = this.terrainRay(ox, oy, oz, dx, dy, dz, maxT);
    if (tGround >= 0 && tGround <= bestT) {
      bestT = tGround;
      hitBody = null;
    }

    // --- 静态体：沿射线采样网格单元 ---
    const statics = this.statics;
    if (statics.bodies.length) {
      const cs = statics.cellSize;
      const step = cs * 0.5;
      const steps = Math.min(48, Math.ceil(maxT / Math.max(step, 1e-3)) + 1);
      let lastKey = 0;
      for (let s = 0; s < steps; s++) {
        const t = Math.min(maxT, s * step);
        const cx = ox + dx * t, cz = oz + dz * t;
        const key = Math.floor(cx / cs) * 1000003 + Math.floor(cz / cs);
        if (s > 0 && key === lastKey) continue;
        lastKey = key;
        const cell = statics.grid.get(key);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const body = cell[i];
          const a = body.aabb;
          if (Math.min(ox, ox + dx * maxT) > a.maxX || Math.max(ox, ox + dx * maxT) < a.minX) continue;
          if (Math.min(oy, oy + dy * maxT) > a.maxY || Math.max(oy, oy + dy * maxT) < a.minY) continue;
          if (Math.min(oz, oz + dz * maxT) > a.maxZ || Math.max(oz, oz + dz * maxT) < a.minZ) continue;
          const tt = body.raycast(ox, oy, oz, dx, dy, dz, bestT);
          if (tt >= 0 && tt < bestT - 1e-6) { bestT = tt; hitBody = body; }
        }
      }
    }

    if (bestT >= maxT && !hitBody && tGround < 0) return null;
    if (bestT > maxT) return null;
    if (hitBody === null && tGround < 0) return null;

    hit.t = bestT;
    hit.x = ox + dx * bestT;
    hit.y = oy + dy * bestT;
    hit.z = oz + dz * bestT;
    hit.body = hitBody;
    if (hitBody) {
      // 法线 = 局部最近轴
      hitBody.sphereContact(hit.x, hit.y, hit.z, 1e-4, _hitN);
      hit.nx = _hitN.x; hit.ny = _hitN.y; hit.nz = _hitN.z;
      hit.material = hitBody.material;
    } else {
      this.terrain.normal(hit.x, hit.z, _hitN);
      hit.nx = _hitN.x; hit.ny = _hitN.y; hit.nz = _hitN.z;
      hit.material = this.terrain.materialAt(hit.x, hit.z);
    }
    hit.hits = 1;
    return hit;
  }

  /**
   * 射线 vs 高度场：不动点迭代求解 o.y + t·d.y = height(o.x + t·d.x, o.z + t·d.z)
   * @returns {number} 参数 t（<0 表示未命中）
   */
  terrainRay(ox, oy, oz, dx, dy, dz, maxT) {
    const terrain = this.terrain;
    const h0 = terrain.height(ox, oz);
    if (oy <= h0) return 0;                 // 起点已在地面下
    if (dy >= -1e-7) return -1;             // 不朝下
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const px = ox + dx * t, pz = oz + dz * t;
      const h = terrain.height(px, pz);
      const nt = (oy + dy * t - h) / -dy;
      const tn = clamp(nt + t, 0, maxT);
      if (Math.abs(tn - t) < 1e-4) { t = tn; break; }
      t = tn;
    }
    if (t < 0 || t > maxT) return -1;
    return t;
  }

  /** 在 (x,z) 竖直向下找地表高度与法线（轮胎/放置物体用）。 */
  groundSample(x, z, out = { height: 0, nx: 0, ny: 1, nz: 0, material: MATERIALS.ASPHALT }) {
    out.height = this.terrain.heightFast(x, z);
    const n = this.terrain.normalFast(x, z, _n);
    out.nx = n.x; out.ny = n.y; out.nz = n.z;
    out.material = this.terrain.materialAt(x, z, 1 - n.y);
    // 静态体顶面可能更高
    const cell = this.statics.cellAt(x, z);
    for (let i = 0; i < cell.length; i++) {
      const b = cell[i];
      const a = b.aabb;
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      const t = b.raycast(x, 1000, z, 0, -1, 0, 1000);
      if (t >= 0) {
        const y = 1000 - t;
        if (y > out.height) {
          b.sphereContact(x, y + 1e-4, z, 1e-4, _n);
          out.height = y; out.nx = _n.x; out.ny = _n.y; out.nz = _n.z;
          out.material = b.material;
        }
      }
    }
    return out;
  }
}
