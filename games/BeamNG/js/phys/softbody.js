// ============================================================================
//  软体求解器 —— 整个游戏的物理核心
//
//  模型与 BeamNG / Rigs of Rods 同源：
//    · 车身 = 一堆有质量的节点 + 连接它们的"梁"
//    · 刚性梁用 PBD 位置约束求解（Gauss-Seidel 迭代）
//    · 梁有屈服应变：超过阈值就发生"塑性流动"，静止长度被永久改写 → 车体凹陷
//    · 梁有断裂应变：超过就断开 → 结构解体、零件飞散
//    · 接触用切线平面约束求解，速度层再做恢复系数与库仑摩擦
//
//  所有数组都是 SoA + 定长 TypedArray：没有每帧 GC，才能在 60fps 下跑
//  200+ 节点 / 1000+ 梁 / 4 次子步 / 10 次迭代。
// ============================================================================
import { GRAVITY, Vec3 } from '../core/math.js';

export const BEAM_RIGID = 0;    // 结构梁：位置约束
export const BEAM_SPRING = 1;   // 弹簧/减震：力驱动（悬挂）
export const BEAM_BROKEN = 2;   // 已断

export const NODE_FIXED = 1;
export const NODE_NOCOLLIDE = 2;

const MAX_CONTACT_PLANES = 4;

/**
 * 接触罚函数刚度/阻尼，按地面材质索引。
 * 刚度直接决定撞墙时的减速脉冲：太硬会出现几百 g 的假尖峰，太软会陷进墙里。
 * 软地面（沙/泥）刚度低 → 车会真的陷下去并损失速度，这是真实感的一部分。
 */
const CONTACT_K = [1.35e6, 1.30e6, 4.2e5, 5.2e5, 2.4e5, 7.5e5, 1.6e5];
const CONTACT_C = [3400, 3300, 1900, 2100, 1450, 2500, 1200];

let _unitCounter = 1;

export class SoftBody {
  constructor(maxNodes = 512, maxBeams = 2048) {
    this.unitId = _unitCounter++;
    this.maxNodes = maxNodes;
    this.maxBeams = maxBeams;
    this.nodeCount = 0;
    this.beamCount = 0;
    this.time = 0;

    const N = maxNodes, B = maxBeams;
    // 节点
    this.px = new Float64Array(N); this.py = new Float64Array(N); this.pz = new Float64Array(N);
    this.p0x = new Float64Array(N); this.p0y = new Float64Array(N); this.p0z = new Float64Array(N);
    this.vx = new Float64Array(N); this.vy = new Float64Array(N); this.vz = new Float64Array(N);
    this.fx = new Float64Array(N); this.fy = new Float64Array(N); this.fz = new Float64Array(N);
    this.im = new Float64Array(N); this.mass = new Float64Array(N);
    this.radius = new Float64Array(N);
    this.friction = new Float64Array(N);
    this.restitution = new Float64Array(N);
    this.flags = new Uint8Array(N);
    this.nodeDamage = new Float64Array(N);      // 0..1 视觉凹痕强度
    this.nodeGroup = new Uint16Array(N);        // 用于渲染分组/材质
    this.nodeTag = new Array(N).fill(null);
    // 接触缓存
    this.cPlanes = new Float64Array(N * MAX_CONTACT_PLANES * 4);
    this.cCount = new Uint8Array(N);
    this.cMat = new Uint8Array(N * MAX_CONTACT_PLANES);
    this.cVnIn = new Float64Array(N);
    this.cNormalForce = new Float64Array(N);
    this.contactList = new Int32Array(N);
    this.contactCount = 0;

    // 梁
    this.ba = new Int32Array(B); this.bb = new Int32Array(B);
    this.rest0 = new Float64Array(B);   // 原始静止长度
    this.rest = new Float64Array(B);    // 当前静止长度（塑性变形会改写）
    this.stiff = new Float64Array(B);
    this.yieldStrain = new Float64Array(B);
    this.plasticity = new Float64Array(B);
    this.breakStrain = new Float64Array(B);
    this.springK = new Float64Array(B);
    this.springC = new Float64Array(B);
    this.damp = new Float64Array(B);
    this.strain = new Float64Array(B);
    this.maxStrain = new Float64Array(B);
    this.beamDamage = new Float64Array(B);
    this.btype = new Uint8Array(B);
    this.active = new Uint8Array(B);
    this.bgroup = new Uint16Array(B);

    this.linearDamping = 0.01;      // 轻微数值阻尼，抑制高频抖动
    this.internalDamping = 0;       // 内部（扭转/弯曲）阻尼，车辆设 0.03~0.06
    this._dampI = new Float64Array(9);
    this.gravity = GRAVITY;
    this.iterations = 10;
    this.plasticEnabled = true;
    this.breakEnabled = true;

    // 统计
    this.stats = { brokenBeams: 0, maxStrain: 0, kinetic: 0, mass: 0, plasticEvents: 0 };
    this._worldScratch = new Float64Array(MAX_CONTACT_PLANES * 5);
  }

  // -------------------------------------------------------------------------
  //  构建
  // -------------------------------------------------------------------------
  addNode(x, y, z, opts = {}) {
    const i = this.nodeCount++;
    if (i >= this.maxNodes) throw new Error('SoftBody: 节点容量不足');
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.p0x[i] = x; this.p0y[i] = y; this.p0z[i] = z;
    const m = opts.mass ?? 1;
    this.mass[i] = m;
    this.im[i] = (opts.fixed || m <= 0) ? 0 : 1 / m;
    this.radius[i] = opts.radius ?? 0.16;
    this.friction[i] = opts.friction ?? 0.55;
    this.restitution[i] = opts.restitution ?? 0.08;
    this.flags[i] = (opts.fixed ? NODE_FIXED : 0) | (opts.noCollide ? NODE_NOCOLLIDE : 0);
    this.nodeGroup[i] = opts.group ?? 0;
    this.nodeTag[i] = opts.tag ?? null;
    return i;
  }

  /**
   * 加一根梁。
   * @param {object} opts
   *   type        BEAM_RIGID / BEAM_SPRING
   *   stiffness   位置约束强度 0..1（1 = 刚体级）
   *   yieldStrain 塑性屈服应变（例如 0.004 = 0.4%）
   *   plasticity  塑性流动速率（每次超限把 rest 拉过去多少比例）
   *   breakStrain 断裂应变
   *   springK/springC  弹簧梁的刚度(N/m)与阻尼(N·s/m)
   *   restScale   初始静止长度系数（预紧）
   */
  addBeam(a, b, opts = {}) {
    const k = this.beamCount++;
    if (k >= this.maxBeams) throw new Error('SoftBody: 梁容量不足');
    this.ba[k] = a; this.bb[k] = b;
    const dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], dz = this.pz[b] - this.pz[a];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rest = opts.rest ?? L * (opts.restScale ?? 1);
    this.rest0[k] = L;
    this.rest[k] = rest;
    this.btype[k] = opts.type ?? BEAM_RIGID;
    this.stiff[k] = opts.stiffness ?? 1;
    this.yieldStrain[k] = opts.yieldStrain ?? 0.004;
    this.plasticity[k] = opts.plasticity ?? 0.5;
    this.breakStrain[k] = opts.breakStrain ?? 0.12;
    this.springK[k] = opts.springK ?? 0;
    this.springC[k] = opts.springC ?? 0;
    this.damp[k] = opts.damp ?? 0;
    this.active[k] = 1;
    this.bgroup[k] = opts.group ?? 0;
    return k;
  }

  /** 断开一根梁（爆炸/损伤时手动调用）。 */
  breakBeam(k) {
    if (!this.active[k]) return;
    this.active[k] = 0;
    this.btype[k] = BEAM_BROKEN;
    this.stats.brokenBeams++;
  }

  // -------------------------------------------------------------------------
  //  力
  // -------------------------------------------------------------------------
  clearForces() {
    this.fx.fill(0, 0, this.nodeCount);
    this.fy.fill(0, 0, this.nodeCount);
    this.fz.fill(0, 0, this.nodeCount);
  }

  addForce(i, fx, fy, fz) {
    this.fx[i] += fx; this.fy[i] += fy; this.fz[i] += fz;
  }

  addForceAll(fx, fy, fz) {
    for (let i = 0; i < this.nodeCount; i++) {
      this.fx[i] += fx; this.fy[i] += fy; this.fz[i] += fz;
    }
  }

  /** 按质量在若干节点上分摊一个合力（等价于在加权质心施加）。 */
  addDistributedForce(indices, weights, fx, fy, fz) {
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n], w = weights[n];
      this.fx[i] += fx * w; this.fy[i] += fy * w; this.fz[i] += fz * w;
    }
  }

  // -------------------------------------------------------------------------
  //  查询
  // -------------------------------------------------------------------------
  nodePosition(i, out) { return out.set(this.px[i], this.py[i], this.pz[i]); }

  nodeVelocity(i, out) { return out.set(this.vx[i], this.vy[i], this.vz[i]); }

  centroid(indices, out = new Vec3()) {
    out.zero();
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      out.x += this.px[i]; out.y += this.py[i]; out.z += this.pz[i];
    }
    if (indices.length) out.scale(1 / indices.length);
    return out;
  }

  centroidVelocity(indices, out = new Vec3()) {
    out.zero();
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      out.x += this.vx[i]; out.y += this.vy[i]; out.z += this.vz[i];
    }
    if (indices.length) out.scale(1 / indices.length);
    return out;
  }

  massProperties(indices) {
    let m = 0;
    const c = new Vec3();
    for (const i of indices) { m += this.mass[i]; c.x += this.px[i] * this.mass[i]; c.y += this.py[i] * this.mass[i]; c.z += this.pz[i] * this.mass[i]; }
    if (m > 0) c.scale(1 / m);
    const I = new Float64Array(9);
    for (const i of indices) {
      const dx = this.px[i] - c.x, dy = this.py[i] - c.y, dz = this.pz[i] - c.z;
      const mi = this.mass[i];
      I[0] += mi * (dy * dy + dz * dz);
      I[4] += mi * (dx * dx + dz * dz);
      I[8] += mi * (dx * dx + dy * dy);
      I[1] -= mi * dx * dy; I[3] -= mi * dx * dy;
      I[2] -= mi * dx * dz; I[6] -= mi * dx * dz;
      I[5] -= mi * dy * dz; I[7] -= mi * dy * dz;
    }
    return { mass: m, center: c, inertia: I };
  }

  kineticEnergy() {
    let e = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      e += 0.5 * this.mass[i] * (this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i]);
    }
    return e;
  }

  // -------------------------------------------------------------------------
  //  主循环
  // -------------------------------------------------------------------------
  step(dt, world) {
    this.time += dt;
    const n = this.nodeCount;
    // --- 1. 接触平面缓存（用当前位置） ----------------------------------
    if (world) this.collectContacts(world);

    // --- 2. 力阶段：接触罚函数 + 弹簧梁 ---------------------------------
    // 接触用力而不是位置投影 —— 这样撞击是"有过程的"，撞墙才会出现
    // 真实的几十 g 减速脉冲，而不是硬约束带来的几百 g 尖峰。
    if (world) this.applyContactForces(dt);
    this.applySpringForces(dt);

    // --- 3. 重力 + 积分 -------------------------------------------------
    const ld = Math.max(0, 1 - this.linearDamping * dt);
    for (let i = 0; i < n; i++) {
      if (this.flags[i] & NODE_FIXED) { this.p0x[i] = this.px[i]; this.p0y[i] = this.py[i]; this.p0z[i] = this.pz[i]; continue; }
      const inv = this.im[i];
      let vx = this.vx[i] + this.fx[i] * inv * dt;
      let vy = this.vy[i] + (this.fy[i] * inv - this.gravity) * dt;
      let vz = this.vz[i] + this.fz[i] * inv * dt;
      vx *= ld; vy *= ld; vz *= ld;
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      this.p0x[i] = this.px[i]; this.p0y[i] = this.py[i]; this.p0z[i] = this.pz[i];
      this.px[i] += vx * dt; this.py[i] += vy * dt; this.pz[i] += vz * dt;
    }

    // --- 4. 位置约束迭代（结构梁） --------------------------------------
    this.solvePositions(this.iterations);

    // --- 5. 安全投影（防止高速穿透） ------------------------------------
    if (world) this.safetyProjection();

    // --- 6. 由位置变化回推速度 ------------------------------------------
    const invDt = 1 / dt;
    for (let i = 0; i < n; i++) {
      if (this.flags[i] & NODE_FIXED) { this.vx[i] = this.vy[i] = this.vz[i] = 0; continue; }
      this.vx[i] = (this.px[i] - this.p0x[i]) * invDt;
      this.vy[i] = (this.py[i] - this.p0y[i]) * invDt;
      this.vz[i] = (this.pz[i] - this.p0z[i]) * invDt;
    }

    // --- 6.5 内部阻尼（扭转/弯曲模态） -----------------------------------
    if (this.internalDamping > 0) this.dampInternalMotion(this.internalDamping);

    // --- 7. 接触速度响应（库仑摩擦） ------------------------------------
    if (world) this.resolveContactVelocities(dt);

    // --- 8. 塑性变形与断裂 ----------------------------------------------
    if (this.plasticEnabled) this.updatePlasticity();

    // --- 9. 统计 --------------------------------------------------------
    this.stats.kinetic = this.kineticEnergy();
  }

  /** 弹簧梁：沿轴向的弹簧-阻尼力，直接作用在两个节点上。 */
  applySpringForces(dt) {
    const { ba, bb, rest, springK, springC, active, btype, px, py, pz, vx, vy, vz, fx, fy, fz } = this;
    for (let k = 0, kn = this.beamCount; k < kn; k++) {
      if (!active[k] || btype[k] !== BEAM_SPRING) continue;
      const a = ba[k], b = bb[k];
      let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      const inv = 1 / L;
      dx *= inv; dy *= inv; dz *= inv;
      const relV = (vx[b] - vx[a]) * dx + (vy[b] - vy[a]) * dy + (vz[b] - vz[a]) * dz;
      const F = springK[k] * (rest[k] - L) - springC[k] * relV;
      const fxB = dx * F, fyB = dy * F, fzB = dz * F;
      fx[b] += fxB; fy[b] += fyB; fz[b] += fzB;
      fx[a] -= fxB; fy[a] -= fyB; fz[a] -= fzB;
    }
  }

  /** 收集每个节点附近的接触切线平面（地形 + 静态体）。 */
  collectContacts(world) {
    const n = this.nodeCount;
    const scratch = this._worldScratch;
    this.contactCount = 0;
    const { cPlanes, cCount, cMat, cVnIn, contactList, px, py, pz, vx, vy, vz, radius, flags } = this;
    for (let i = 0; i < n; i++) {
      if (flags[i] & NODE_NOCOLLIDE) { cCount[i] = 0; continue; }
      const r = radius[i];
      const count = world.collectContacts(px[i], py[i], pz[i], r, scratch, MAX_CONTACT_PLANES);
      cCount[i] = count;
      if (count === 0) continue;
      contactList[this.contactCount++] = i;
      let vnMin = 0;
      for (let j = 0; j < count; j++) {
        const so = j * 5, o = (i * MAX_CONTACT_PLANES + j) * 4;
        const nx = scratch[so], ny = scratch[so + 1], nz = scratch[so + 2];
        cPlanes[o] = nx; cPlanes[o + 1] = ny; cPlanes[o + 2] = nz;
        cPlanes[o + 3] = nx * px[i] + ny * py[i] + nz * pz[i] - (r - scratch[so + 3]);
        cMat[i * MAX_CONTACT_PLANES + j] = scratch[so + 4];
        const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
        if (vn < vnMin) vnMin = vn;
      }
      cVnIn[i] = vnMin;
    }
  }

  solvePositions(iters) {
    const {
      px, py, pz, im, ba, bb, rest, stiff, active, btype,
      cPlanes, cCount, contactList, contactCount, radius,
    } = this;

    for (let it = 0; it < iters; it++) {
      // 结构梁
      for (let k = 0, kn = this.beamCount; k < kn; k++) {
        if (!active[k]) continue;
        const t = btype[k];
        if (t !== BEAM_RIGID) continue;
        const a = ba[k], b = bb[k];
        const ia = im[a], ib = im[b];
        const wsum = ia + ib;
        if (wsum <= 0) continue;
        const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
        const L2 = dx * dx + dy * dy + dz * dz;
        if (L2 < 1e-12) continue;
        const L = Math.sqrt(L2);
        const s = stiff[k];
        const f = ((L - rest[k]) / L) * s;
        const wa = (ia / wsum) * f, wb = (ib / wsum) * f;
        px[a] += dx * wa; py[a] += dy * wa; pz[a] += dz * wa;
        px[b] -= dx * wb; py[b] -= dy * wb; pz[b] -= dz * wb;
      }
      // 接触（位置层）已经改为力阶段处理，这里只解结构梁
    }
  }

  /**
   * 接触罚函数：法向力 = k·穿透 - c·法向速度。
   * 不同材质刚度不同 —— 沙地/泥地会明显"陷进去"，混凝土几乎踩不动。
   */
  applyContactForces(dt) {
    const {
      contactList, contactCount, cPlanes, cCount, cMat, cNormalForce,
      px, py, pz, vx, vy, vz, radius,
    } = this;
    for (let c = 0; c < contactCount; c++) {
      const i = contactList[c];
      const cc = cCount[i];
      const r = radius[i];
      let totalN = 0;
      for (let j = 0; j < cc; j++) {
        const o = (i * MAX_CONTACT_PLANES + j) * 4;
        const nx = cPlanes[o], ny = cPlanes[o + 1], nz = cPlanes[o + 2];
        const pen = r - (nx * px[i] + ny * py[i] + nz * pz[i] - cPlanes[o + 3]);
        if (pen <= 0) continue;
        const matId = cMat[i * MAX_CONTACT_PLANES + j];
        const k = CONTACT_K[matId] ?? 1.2e6;
        const damp = CONTACT_C[matId] ?? 3000;
        const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
        let F = k * pen - damp * vn;
        if (F < 0) F = 0;
        this.fx[i] += nx * F; this.fy[i] += ny * F; this.fz[i] += nz * F;
        totalN += F;
      }
      cNormalForce[i] = totalN;
    }
    void dt;
  }

  /**
   * 内部阻尼：把每个节点的速度朝"最贴合的刚体运动"拉 alpha 的比例。
   *   v_target_i = v_com + ω × r_i
   * 平动与转动分量完全不受影响（车不会被莫名拖慢），但车架的扭转/弯曲
   * 模态会迅速衰减 —— 没有它，四个轮子的载荷会在对角之间一直振荡。
   */
  dampInternalMotion(alpha) {
    const n = this.nodeCount;
    const mass = this.mass, px = this.px, py = this.py, pz = this.pz;
    let m = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) {
      const mi = mass[i];
      m += mi;
      cx += px[i] * mi; cy += py[i] * mi; cz += pz[i] * mi;
      vx += this.vx[i] * mi; vy += this.vy[i] * mi; vz += this.vz[i] * mi;
    }
    if (m <= 1e-9) return;
    const invM = 1 / m;
    cx *= invM; cy *= invM; cz *= invM;
    vx *= invM; vy *= invM; vz *= invM;

    const I = this._dampI;
    I.fill(0);
    let tx = 0, ty = 0, tz = 0;
    for (let i = 0; i < n; i++) {
      const mi = mass[i];
      const rx = px[i] - cx, ry = py[i] - cy, rz = pz[i] - cz;
      const dvx = this.vx[i] - vx, dvy = this.vy[i] - vy, dvz = this.vz[i] - vz;
      tx += mi * (ry * dvz - rz * dvy);
      ty += mi * (rz * dvx - rx * dvz);
      tz += mi * (rx * dvy - ry * dvx);
      const d = rx * rx + ry * ry + rz * rz;
      I[0] += mi * (d - rx * rx); I[4] += mi * (d - ry * ry); I[8] += mi * (d - rz * rz);
      I[1] -= mi * rx * ry; I[3] -= mi * rx * ry;
      I[2] -= mi * rx * rz; I[6] -= mi * rx * rz;
      I[5] -= mi * ry * rz; I[7] -= mi * ry * rz;
    }
    const reg = Math.max(1e-6, m * 0.01);
    I[0] += reg; I[4] += reg; I[8] += reg;
    if (!invert3(I, I)) return;
    const wx = I[0] * tx + I[1] * ty + I[2] * tz;
    const wy = I[3] * tx + I[4] * ty + I[5] * tz;
    const wz = I[6] * tx + I[7] * ty + I[8] * tz;

    for (let i = 0; i < n; i++) {
      if (this.flags[i] & NODE_FIXED) continue;
      const rx = px[i] - cx, ry = py[i] - cy, rz = pz[i] - cz;
      const tX = vx + wy * rz - wz * ry;
      const tY = vy + wz * rx - wx * rz;
      const tZ = vz + wx * ry - wy * rx;
      this.vx[i] += (tX - this.vx[i]) * alpha;
      this.vy[i] += (tY - this.vy[i]) * alpha;
      this.vz[i] += (tZ - this.vz[i]) * alpha;
    }
  }

  /** 深穿透兜底：直接推回表面并吃掉法向速度，避免高速穿墙。 */  safetyProjection() {
    const { contactList, contactCount, cPlanes, cCount, px, py, pz, vx, vy, vz, radius } = this;
    for (let c = 0; c < contactCount; c++) {
      const i = contactList[c];
      const cc = cCount[i];
      const r = radius[i];
      for (let j = 0; j < cc; j++) {
        const o = (i * MAX_CONTACT_PLANES + j) * 4;
        const nx = cPlanes[o], ny = cPlanes[o + 1], nz = cPlanes[o + 2];
        const pen = r - (nx * px[i] + ny * py[i] + nz * pz[i] - cPlanes[o + 3]);
        if (pen > 0.22) {
          const push = pen - 0.22;
          px[i] += nx * push; py[i] += ny * push; pz[i] += nz * push;
          const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
          if (vn < 0) { vx[i] -= nx * vn; vy[i] -= ny * vn; vz[i] -= nz * vn; }
        }
      }
    }
  }

  /** 库仑摩擦：用真实法向力的大小决定摩擦力上限。 */
  resolveContactVelocities(dt) {
    const { contactList, contactCount, cPlanes, cCount, cNormalForce, vx, vy, vz, friction, restitution, px, py, pz, radius } = this;
    const g = this.gravity;
    for (let c = 0; c < contactCount; c++) {
      const i = contactList[c];
      const cc = cCount[i];
      // 主法线取穿透最深的那个
      let bestPen = -Infinity, bo = -1;
      for (let j = 0; j < cc; j++) {
        const o = (i * MAX_CONTACT_PLANES + j) * 4;
        const dist = cPlanes[o] * px[i] + cPlanes[o + 1] * py[i] + cPlanes[o + 2] * pz[i] - cPlanes[o + 3];
        const pen = radius[i] - dist;
        if (pen > bestPen) { bestPen = pen; bo = o; }
      }
      if (bo < 0) continue;
      const nx = cPlanes[bo], ny = cPlanes[bo + 1], nz = cPlanes[bo + 2];
      let vX = vx[i], vY = vy[i], vZ = vz[i];
      const vn = vX * nx + vY * ny + vZ * nz;
      // 轻微的恢复系数（车身刮擦基本不弹）
      if (vn < 0 && restitution[i] > 0) {
        const target = -restitution[i] * vn;
        if (vn < target) { const d = target - vn; vX += nx * d; vY += ny * d; vZ += nz * d; }
      } else if (vn < 0) {
        vX -= nx * vn; vY -= ny * vn; vZ -= nz * vn;
      }
      // 摩擦力上限 ≈ μ · (法向冲量/m) = μ · (F_n/m + g)·dt
      const nv = vX * nx + vY * ny + vZ * nz;
      let tx = vX - nx * nv, ty = vY - ny * nv, tz = vZ - nz * nv;
      const tMag = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tMag > 1e-6) {
        const invM = this.im[i];
        const maxDv = friction[i] * (cNormalForce[i] * invM + g) * dt;
        let scale;
        if (tMag <= maxDv) scale = 0;
        else scale = (tMag - maxDv) / tMag;
        tx *= scale; ty *= scale; tz *= scale;
        vx[i] = tx + nx * nv; vy[i] = ty + ny * nv; vz[i] = tz + nz * nv;
      } else {
        vx[i] = nx * nv; vy[i] = ny * nv; vz[i] = nz * nv;
      }
    }
  }

  /**
   * 塑性变形与断裂。
   * 位置迭代结束后跑一次：此时梁的伸长量就是真实的弹性应变。
   */
  updatePlasticity() {
    const {
      ba, bb, rest, rest0, yieldStrain, plasticity, breakStrain, active, btype,
      strain, maxStrain, beamDamage, px, py, pz,
    } = this;
    let maxS = 0, plasticEvents = 0;
    for (let k = 0, kn = this.beamCount; k < kn; k++) {
      if (!active[k]) continue;
      const a = ba[k], b = bb[k];
      const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      const s = (L - rest[k]) / rest[k];
      strain[k] = s;
      const as = Math.abs(s);
      if (as > maxS) maxS = as;
      if (as > maxStrain[k]) maxStrain[k] = as;

      if (btype[k] === BEAM_RIGID) {
        // 塑性流动：把静止长度朝当前长度推
        if (as > yieldStrain[k]) {
          const flow = Math.min(0.5, (as - yieldStrain[k]) * plasticity[k]);
          const target = L;
          const moved = (target - rest[k]) * flow;
          rest[k] += moved;
          beamDamage[k] += flow;
          plasticEvents++;
        }
        // 断裂
        if (this.breakEnabled && as > breakStrain[k]) {
          this.breakBeam(k);
        }
      }
    }
    this.stats.maxStrain = maxS;
    this.stats.plasticEvents = plasticEvents;
    // 节点损伤 = 相邻梁损伤的聚合，用于渲染凹痕
    if (plasticEvents > 0 || this.stats.brokenBeams > 0) this.accumulateNodeDamage();
  }

  accumulateNodeDamage() {
    const { ba, bb, active, beamDamage, nodeDamage, nodeCount } = this;
    for (let i = 0; i < nodeCount; i++) nodeDamage[i] *= 0.98;
    for (let k = 0, kn = this.beamCount; k < kn; k++) {
      if (!active[k] && beamDamage[k] <= 0) continue;
      const d = Math.min(1, beamDamage[k]);
      if (d <= 0) continue;
      nodeDamage[ba[k]] = Math.min(1, nodeDamage[ba[k]] + d * 0.06);
      nodeDamage[bb[k]] = Math.min(1, nodeDamage[bb[k]] + d * 0.06);
    }
  }

  /** 结构完整度 0..1：断梁与高应变的加权平均。 */
  integrity() {
    const { active, maxStrain, breakStrain, beamCount } = this;
    if (!beamCount) return 1;
    let sum = 0;
    for (let k = 0; k < beamCount; k++) {
      if (!active[k]) continue;
      const ratio = Math.min(1, maxStrain[k] / Math.max(1e-6, breakStrain[k]));
      sum += 1 - ratio * 0.85;
    }
    return Math.max(0, Math.min(1, sum / beamCount));
  }

  /** 把整个软体平移到指定位置并重置速度（复位用）。 */
  resetTransform(dx = 0, dy = 0, dz = 0) {
    for (let i = 0; i < this.nodeCount; i++) {
      this.px[i] += dx; this.py[i] += dy; this.pz[i] += dz;
      this.p0x[i] = this.px[i]; this.p0y[i] = this.py[i]; this.p0z[i] = this.pz[i];
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    this.clearForces();
  }

  /** 恢复所有梁到初始状态（损伤清零，但位置保留）。 */
  repairAll() {
    for (let k = 0; k < this.beamCount; k++) {
      this.rest[k] = this.rest0[k];
      this.beamDamage[k] = 0;
      this.maxStrain[k] = 0;
      this.strain[k] = 0;
      this.active[k] = 1;
      this.btype[k] = this.btype0 ? this.btype0[k] : this.btype[k];
    }
    this.nodeDamage.fill(0, 0, this.nodeCount);
    this.stats.brokenBeams = 0;
  }

  /** 记录初始类型，便于 repairAll 还原被断开的梁。 */
  snapshotBeamTypes() {
    this.btype0 = this.btype.slice(0, this.beamCount);
  }

  /** 完全复位：位置/速度/损伤回到出厂状态。 */
  hardReset() {
    for (let i = 0; i < this.nodeCount; i++) {
      this.px[i] = this.initialX[i]; this.py[i] = this.initialY[i]; this.pz[i] = this.initialZ[i];
      this.p0x[i] = this.px[i]; this.p0y[i] = this.py[i]; this.p0z[i] = this.pz[i];
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    this.repairAll();
    this.clearForces();
  }

  /**
   * 在第一次 step 之前调用，保存出厂姿态。
   * @param {object} [basis] 当前车体姿态 { right, up, fwd }
   *   有了它才能算出"相对车体"的形变 —— 否则车一开出去就被当成撞烂了。
   */
  captureInitialState(basis = null) {
    this.initialX = this.px.slice(0, this.nodeCount);
    this.initialY = this.py.slice(0, this.nodeCount);
    this.initialZ = this.pz.slice(0, this.nodeCount);
    this.snapshotBeamTypes();

    const n = this.nodeCount;
    if (!this.restOffset) this.restOffset = new Float64Array(this.maxNodes * 3);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += this.px[i]; cy += this.py[i]; cz += this.pz[i]; }
    cx /= n; cy /= n; cz /= n;
    const r = basis?.right ?? { x: 1, y: 0, z: 0 };
    const u = basis?.up ?? { x: 0, y: 1, z: 0 };
    const f = basis?.fwd ?? { x: 0, y: 0, z: -1 };
    for (let i = 0; i < n; i++) {
      const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz;
      this.restOffset[i * 3] = dx * r.x + dy * r.y + dz * r.z;
      this.restOffset[i * 3 + 1] = dx * u.x + dy * u.y + dz * u.z;
      this.restOffset[i * 3 + 2] = dx * f.x + dy * f.y + dz * f.z;
    }
    // 注：真正的"永久压溃量"在 Vehicle.deformStats 里算——它需要用尾段
    // 节点锚定参考坐标系，这里只保留出厂形状（restOffset）作为弹性柔度基准。
  }

  /**
   * 永久压溃量（米）—— 只看塑性流动改写过的静止长度。
   * 这是"撞坏了多少"的正确度量：静止时软体被自重压出的那几厘米弹性下沉
   * 完全不计入，所以一辆崭新的车停在平地上读数就是 0。
   * @returns {{mean:number, max:number, maxNode:number}}
   */
  crushStats() {
    const n = this.nodeCount;
    if (!this._crushAcc) { this._crushAcc = new Float64Array(n); this._crushCnt = new Float64Array(n); }
    const acc = this._crushAcc, cnt = this._crushCnt;
    acc.fill(0); cnt.fill(0);
    const B = this.beamCount;
    for (let k = 0; k < B; k++) {
      const d = this.rest0[k] - this.rest[k];
      if (d <= 0) continue;
      const a = this.ba[k], b = this.bb[k];
      acc[a] += d; cnt[a]++;
      acc[b] += d; cnt[b]++;
    }
    let sum = 0, max = 0, maxNode = -1;
    for (let i = 0; i < n; i++) {
      const d = cnt[i] ? acc[i] / cnt[i] : 0;
      sum += d;
      if (d > max) { max = d; maxNode = i; }
    }
    return { mean: sum / n, max, maxNode };
  }

  /**
   * 相对"出厂形状"的形变量。用当前车体姿态把出厂局部坐标重新投回世界，
   * 再和当前节点比较。注意：包含弹性下沉，只能当"结构柔度"指标看，
   * 不要直接当车损（车损见 Vehicle.deformStats）。
   * @returns {{mean:number, max:number, p98:number, area:number, maxNode:number}}
   */
  deformationStats(frame) {
    const n = this.nodeCount;
    const off = this.restOffset;
    if (!off) return { mean: 0, max: 0, p98: 0, area: 0, maxNode: -1 };
    const p = frame.pos, r = frame.right, u = frame.up, f = frame.fwd;
    let sum = 0, max = 0, maxNode = -1, crushed = 0;
    const DEAD = this.crushDeadband ?? 0.018;
    // 压溃深度直方图（0..1 m，2 cm 一格）→ 用来取稳健的 98 分位，
    // 免得单个飞出去的节点把"最大压溃"顶到 1 米以上。
    const HB = 50, hist = this._crushHist ?? (this._crushHist = new Int32Array(HB + 1));
    hist.fill(0);
    for (let i = 0; i < n; i++) {
      const ox = off[i * 3], oy = off[i * 3 + 1], oz = off[i * 3 + 2];
      const ex = p.x + r.x * ox + u.x * oy + f.x * oz;
      const ey = p.y + r.y * ox + u.y * oy + f.y * oz;
      const ez = p.z + r.z * ox + u.z * oy + f.z * oz;
      const dx = this.px[i] - ex, dy = this.py[i] - ey, dz = this.pz[i] - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > max) { max = d; maxNode = i; }
      if (d > DEAD) {
        const c = d - DEAD;
        sum += c;
        crushed++;
        const b = Math.min(HB, (c * (HB / 1.0)) | 0);
        hist[b]++;
      }
    }
    let p98 = 0;
    if (crushed) {
      const want = Math.ceil(crushed * 0.98);
      let acc = 0;
      for (let b = 0; b <= HB; b++) {
        acc += hist[b];
        if (acc >= want) { p98 = (b + 0.5) * (1.0 / HB); break; }
      }
    }
    return { mean: crushed ? sum / crushed : 0, max, p98, area: crushed / n, maxNode };
  }

  /** 导出适合回放/存档的紧凑状态。 */
  writeState(out) {
    const n = this.nodeCount;
    if (!out || out.length < n * 3) out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = this.px[i]; out[i * 3 + 1] = this.py[i]; out[i * 3 + 2] = this.pz[i];
    }
    return out;
  }

  readState(state) {
    const n = this.nodeCount;
    for (let i = 0; i < n; i++) {
      this.px[i] = state[i * 3]; this.py[i] = state[i * 3 + 1]; this.pz[i] = state[i * 3 + 2];
    }
  }
}

// ---------------------------------------------------------------------------
//  ForceGroup —— 把整车级别的力精确地施加到一小撮节点上
//
//  只按权重分摊，等价于"在加权质心施加该力"。当作用点偏离质心时（例如轮胎
//  接地点在悬挂硬点下方 0.35m），必须再补一个纯力偶，否则刹车时的点头和
//  过弯时的侧倾都会明显偏小 —— 这正是"手感像不像真车"的关键之一。
//  纯力偶用 f_i = ω × r_i 施加，其中 ω = I⁻¹ τ，I 是节点组的转动惯量张量。
// ---------------------------------------------------------------------------
export class ForceGroup {
  constructor(body, indices, weights = null) {
    this.body = body;
    this.indices = Int32Array.from(indices);
    const n = this.indices.length;
    this.weights = weights ? Float64Array.from(weights) : new Float64Array(n).fill(1 / n);
    this.centroid = new Vec3();
    this.velocity = new Vec3();
    this.inertiaInv = new Float64Array(9);
    this._r = new Float64Array(n * 3);
    this._w = new Vec3();
    this._tau = new Vec3();
    this.refresh();
  }

  /** 每子步刷新一次即可（节点移动量很小）。 */
  refresh() {
    const b = this.body, idx = this.indices, n = idx.length;
    this.centroid.zero(); this.velocity.zero();
    for (let k = 0; k < n; k++) {
      const i = idx[k], w = this.weights[k];
      this.centroid.x += b.px[i] * w; this.centroid.y += b.py[i] * w; this.centroid.z += b.pz[i] * w;
      this.velocity.x += b.vx[i] * w; this.velocity.y += b.vy[i] * w; this.velocity.z += b.vz[i] * w;
    }
    // 无权重质心，用于力偶（保证 Σf = 0）
    let mx = 0, my = 0, mz = 0;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      mx += b.px[i]; my += b.py[i]; mz += b.pz[i];
    }
    mx /= n; my /= n; mz /= n;
    const r = this._r;
    const I = this.inertiaInv;
    I.fill(0);
    let tr = 0;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const x = b.px[i] - mx, y = b.py[i] - my, z = b.pz[i] - mz;
      r[k * 3] = x; r[k * 3 + 1] = y; r[k * 3 + 2] = z;
      const d = x * x + y * y + z * z;
      I[0] += d - x * x; I[4] += d - y * y; I[8] += d - z * z;
      I[1] -= x * y; I[3] -= x * y;
      I[2] -= x * z; I[6] -= x * z;
      I[5] -= y * z; I[7] -= y * z;
      tr += d;
    }
    // 加一点各向同性正则项，避免共面节点导致矩阵奇异
    const reg = Math.max(1e-6, tr / n * 0.02 + 1e-4);
    I[0] += reg; I[4] += reg; I[8] += reg;
    if (!invert3(I, this.inertiaInv)) this.inertiaInv.fill(0);
  }

  /** 在加权质心施加合力。 */
  applyForce(fx, fy, fz) {
    const b = this.body, idx = this.indices, w = this.weights;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], s = w[k];
      b.fx[i] += fx * s; b.fy[i] += fy * s; b.fz[i] += fz * s;
    }
  }

  /** 在世界坐标点 p 施加合力（自动补齐相对质心的力偶）。 */
  applyForceAt(fx, fy, fz, px, py, pz) {
    this.applyForce(fx, fy, fz);
    const rx = px - this.centroid.x, ry = py - this.centroid.y, rz = pz - this.centroid.z;
    this.applyCouple(ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx);
  }

  /** 施加纯力偶（合力为零）。 */
  applyCouple(tx, ty, tz) {
    const I = this.inertiaInv;
    const wx = I[0] * tx + I[1] * ty + I[2] * tz;
    const wy = I[3] * tx + I[4] * ty + I[5] * tz;
    const wz = I[6] * tx + I[7] * ty + I[8] * tz;
    const b = this.body, r = this._r, idx = this.indices;
    for (let k = 0; k < idx.length; k++) {
      const x = r[k * 3], y = r[k * 3 + 1], z = r[k * 3 + 2];
      const i = idx[k];
      b.fx[i] += wy * z - wz * y;
      b.fy[i] += wz * x - wx * z;
      b.fz[i] += wx * y - wy * x;
    }
  }

  /** 组内节点相对质心的平均角速度（用速度场最小二乘估计，供轮胎滑移使用）。 */
  estimateAngularVelocity(out = new Vec3()) {
    const b = this.body, idx = this.indices, r = this._r;
    const I = this.inertiaInv;
    // τ_eff = Σ r_i × v_i  （v_i 为相对质心的速度）
    let tx = 0, ty = 0, tz = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const x = r[k * 3], y = r[k * 3 + 1], z = r[k * 3 + 2];
      const vx = b.vx[i] - this.velocity.x, vy = b.vy[i] - this.velocity.y, vz = b.vz[i] - this.velocity.z;
      tx += y * vz - z * vy;
      ty += z * vx - x * vz;
      tz += x * vy - y * vx;
    }
    out.set(
      I[0] * tx + I[1] * ty + I[2] * tz,
      I[3] * tx + I[4] * ty + I[5] * tz,
      I[6] * tx + I[7] * ty + I[8] * tz,
    );
    return out;
  }
}

/** 3x3 矩阵求逆（行主序）。返回 false 表示奇异。 */
export function invert3(m, out) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  out[0] = A * inv;
  out[1] = -(b * i - c * h) * inv;
  out[2] = (b * f - c * e) * inv;
  out[3] = B * inv;
  out[4] = (a * i - c * g) * inv;
  out[5] = -(a * f - c * d) * inv;
  out[6] = C * inv;
  out[7] = -(a * h - b * g) * inv;
  out[8] = (a * e - b * d) * inv;
  return true;
}
