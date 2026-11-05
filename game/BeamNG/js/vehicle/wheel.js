// ============================================================================
//  车轮 + 悬挂
//
//  每个角 = 1 个悬挂自由度（沿减振器轴线的行程）+ 1 个车轮自转自由度。
//  悬挂硬点取自车身上的真实节点，所以车体一旦被撞变形，悬挂几何（倾角、前束、
//  主销内倾）会跟着一起变 —— 这也是 BeamNG 手感的来源之一。
//
//  力的处理严格按牛顿第三定律：
//    作用在车身上的力 = -（弹簧/减振器对车轮的力）+（轮胎力中垂直于轴线的那部分）
//  前者施加在硬点上，后者施加在接地点上，因此点头/侧倾/油门抬头的力矩都是
//  自然产生的，而不是"额外加的动画"。
// ============================================================================
import { Vec3, Quat, clamp, TAU, GRAVITY } from '../core/math.js';
import { TireModel } from './tire.js';
import { ForceGroup } from '../phys/softbody.js';

const MAX_WORLD_CONTACTS = 4;
const RAD = Math.PI / 180;

/** 接地点采样角（相对轮胎正下方，度）。多点采样让路沿/边缘接触更真实。 */
const TREAD_ANGLES = [-24, -12, 0, 12, 24];
const TREAD_PROBE = 0.045;

export class Wheel {
  constructor(vehicle, corner) {
    this.vehicle = vehicle;
    this.body = vehicle.body;
    this.corner = corner;
    this.spec = vehicle.spec;
    this.wheelSpec = vehicle.spec.wheel;
    this.susp = vehicle.spec.suspension;

    this.name = corner.name;
    this.axle = corner.axle;
    this.side = corner.side;
    this.steerable = corner.axle === 'front';

    // 悬挂轴在车体局部坐标下的表达（车体局部：+X 右，+Y 上，-Z 前）
    this.axisLocal = new Vec3(corner.axis.x, corner.axis.y, -corner.axis.z);

    // 力分配组（权重和为 1）
    const near = corner.near;
    this.group = new ForceGroup(
      this.body,
      [corner.towerIdx, corner.armF, corner.armR, near[0], near[1]],
      [0.34, 0.18, 0.18, 0.15, 0.15],
    );

    this.tire = new TireModel(this.spec.tire, corner.staticLoad);

    // 把车轮吊在车身上的那一小组梁（构建时由 factory 记录）
    this.mountBeams = corner.mountBeams ?? [];
    // 兜底：老路径（没传 mountBeams）时退回"所有碰到塔顶/摆臂的梁"
    this.towerBeams = [];
    if (!this.mountBeams.length) {
      for (let k = 0; k < this.body.beamCount; k++) {
        const a = this.body.ba[k], b = this.body.bb[k];
        if (a === corner.towerIdx || b === corner.towerIdx || a === corner.armF || b === corner.armF
          || a === corner.armR || b === corner.armR) this.towerBeams.push(k);
      }
    }

    // 状态
    this.len = corner.designLength;
    this.lenVel = 0;
    this.spinAngle = 0;
    this.spinRate = 0;
    this.steerAngle = 0;
    this.camber = this.susp.camber * RAD;
    this.contact = false;
    this.Fz = 0; this.Fx = 0; this.Fy = 0;
    this.springForce = 0;
    this.slipRatio = 0; this.slipAngle = 0;
    this.vx = 0;
    this.surfaceMaterial = null;
    this.gripScale = 1;
    this.gripSaturation = 0;
    this.detached = false;
    this.puncture = false;
    this.wear = 0;
    this.brakeTemp = 20;
    this.absActive = false;
    this.tcActive = false;
    this.spinLoss = 0;
    this.driveTorque = 0;
    this.brakeTorque = 0;
    this.reactionTorque = 0;
    this.reflectedInertia = 0;   // 传动系反射惯量（drivetrain 每步写入）

    this.scratch = new Float64Array(MAX_WORLD_CONTACTS * 5);

    // 复用的向量
    this.P = new Vec3(); this.A = new Vec3(); this.C = new Vec3();
    this.wheelUp = new Vec3(); this.wheelFwd = new Vec3(); this.spinAxis = new Vec3();
    this.contactPoint = new Vec3(); this.contactNormal = new Vec3(0, 1, 0);
    this.tireForce = new Vec3(); this.suspForce = new Vec3();
    this.fwdG = new Vec3(0, 0, -1); this.rightG = new Vec3(1, 0, 0);
    this.prevAttachVel = new Vec3();
    this.vContact = new Vec3();
    this.tmpA = new Vec3(); this.tmpB = new Vec3();
    this._q = new Quat();
    this.lastPen = 0;
    this.penVel = 0;
    this.penInit = false;
    this.tireLoadSmoothed = corner.staticLoad;
    this.angularVel = new Vec3();
  }

  reset() {
    this.len = this.corner.designLength;
    this.lenVel = 0;
    this.spinAngle = 0;
    this.spinRate = 0;
    this.steerAngle = 0;
    this.contact = false;
    this.Fz = this.Fx = this.Fy = 0;
    this.tire.reset();
    this.detached = false;
    this.puncture = false;
    this.wear = 0;
    this.brakeTemp = 20;
    this.lastPen = 0;
    this.penVel = 0;
    this.penInit = false;
    this.driveTorque = 0;
    this.brakeTorque = 0;
    this.reactionTorque = 0;
    this.reflectedInertia = 0;   // 传动系反射惯量（drivetrain 每步写入）
  }

  /** 轮胎当前有效半径（爆胎/磨损会变小）。 */
  get radius() {
    return this.wheelSpec.radius * (this.puncture ? 0.84 : 1) * (1 - this.wear * 0.015);
  }

  get staticLoad() { return this.corner.staticLoad; }

  /** 悬挂行程压缩量（米，正 = 压缩）。 */
  travelCompression() { return this.corner.designLength - this.len; }

  /** 行程归一化：0 = 全伸展，1 = 全压缩。 */
  travel01() {
    const c = this.corner;
    return clamp((c.maxLength - this.len) / Math.max(1e-4, c.maxLength - c.minLength), 0, 1);
  }

  /**
   * 单个物理子步。
   * @param {number} dt
   * @param {object} world  碰撞世界
   * @param {object} frame  车体姿态 { fwd, right, up, pos, angVel }
   */
  step(dt, world, frame) {
    if (this.detached) return;
    const body = this.body;
    const c = this.corner;

    // --- 1. 硬点与悬挂轴线（随车体变形） --------------------------------
    const P = this.P.set(body.px[c.towerIdx], body.py[c.towerIdx], body.pz[c.towerIdx]);
    const A = this.A.copy(this.axisLocal).applyBasis(frame.right, frame.up, frame.fwd).normalize();
    const C = this.C.copy(P).addScaled(A, this.len);

    // --- 2. 车轮朝向：转向（绕主销）+ 外倾 -------------------------------
    //  车轮的"上方向"必须取车体竖直，不能取悬挂轴线：主销内倾有 20°，
    //  拿它当竖直会让接地点跑到轮心外侧 11cm，垂向力全跑偏。
    const up0 = this.wheelUp;
    const fwd = this.wheelFwd.copy(frame.fwd);
    if (this.steerAngle !== 0) {
      this._q.setFromAxisAngle(A, this.steerAngle);       // 绕主销轴转向
      fwd.applyQuat(this._q);
    }
    fwd.addScaled(A, -fwd.dot(A));                        // 去掉沿主销的分量
    if (fwd.lengthSq() < 1e-8) fwd.copy(frame.fwd);
    fwd.normalize();

    // 自转轴：水平且垂直于车轮平面
    const spinAxis = this.spinAxis.crossVectors(fwd, frame.up);
    if (spinAxis.lengthSq() < 1e-8) spinAxis.set(1, 0, 0);
    spinAxis.normalize();

    // 外倾：负 camber = 上缘内倾；压缩行程会带来额外负倾角
    const camberDeg = this.susp.camber - this.susp.travelCamberGain * this.travelCompression() * 10;
    const camberAngle = camberDeg * RAD * this.side;
    this.camber = camberAngle;
    if (Math.abs(camberAngle) > 1e-6) {
      this._q.setFromAxisAngle(fwd, camberAngle);
      spinAxis.applyQuat(this._q);
    }
    up0.crossVectors(spinAxis, fwd).normalize();          // 车轮上方向

    // --- 3. 接地点采样（多点，兼顾路沿与边缘） --------------------------
    const R = this.radius;
    let penMax = 0, wsum = 0, nw = 0;
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    const scratch = this.scratch;

    for (let s = 0; s < TREAD_ANGLES.length; s++) {
      const th = TREAD_ANGLES[s] * RAD;
      const ct = Math.cos(th), st = Math.sin(th);
      const dx = -up0.x * ct + fwd.x * st;
      const dy = -up0.y * ct + fwd.y * st;
      const dz = -up0.z * ct + fwd.z * st;
      const sx = C.x + dx * R, sy = C.y + dy * R, sz = C.z + dz * R;
      const n = world.collectContacts(sx, sy, sz, TREAD_PROBE, scratch, MAX_WORLD_CONTACTS);
      if (!n) continue;
      for (let j = 0; j < n; j++) {
        const o = j * 5;
        const pen = scratch[o + 3];
        if (pen <= 0) continue;
        // 接地点 = 探针球心沿法线退回到地表
        const px = sx - scratch[o] * TREAD_PROBE;
        const py = sy - scratch[o + 1] * TREAD_PROBE;
        const pz = sz - scratch[o + 2] * TREAD_PROBE;
        cx += px * pen; cy += py * pen; cz += pz * pen;
        nx += scratch[o] * pen; ny += scratch[o + 1] * pen; nz += scratch[o + 2] * pen;
        wsum += pen; nw += pen;
        if (pen > penMax) penMax = pen;
      }
    }

    // 探针球心落在胎面上、半径 TREAD_PROBE —— 真正的轮胎压缩量要减掉它，
    // 否则车一落地就凭空多出 k·0.045 ≈ 11 kN 的下压力。
    const penPhys = penMax - TREAD_PROBE;
    this.contact = penPhys > 0 && wsum > 0;
    let material = null;
    if (this.contact) {
      this.contactPoint.set(cx / wsum, cy / wsum, cz / wsum);
      this.contactNormal.set(nx / nw, ny / nw, nz / nw).normalize();
      material = world.materialAt(this.contactPoint.x, this.contactPoint.y, this.contactPoint.z);
    } else {
      material = null;
    }
    this.surfaceMaterial = material;

    // 穿透速度（轮胎垂向阻尼用）。第一步要初始化，否则会凭空产生几 kN 的阻尼力。
    if (!this.penInit) { this.lastPen = penPhys; this.penInit = true; }
    this.penVel = (penPhys - this.lastPen) / Math.max(dt, 1e-5);
    this.lastPen = penPhys;

    // --- 4. 垂直力 ------------------------------------------------------
    const tireK = this.wheelSpec.verticalStiffness ?? 250000;
    const tireC = this.wheelSpec.verticalDamping ?? 1400;
    let Fz = 0;
    if (this.contact) {
      // 阻尼项符号：penVel>0 表示正在往地里压 → 力要更大
      Fz = tireK * penPhys + tireC * clamp(this.penVel, -3, 3);
      if (Fz < 0) Fz = 0;
      // 轮胎不可能瞬间产生天量法向力，给个上限（防止数值尖峰传到车体）
      const cap = this.corner.staticLoad * 22;
      if (Fz > cap) Fz = cap;
    }

    // --- 5. 车轮自转动力学（驱动 / 制动） -------------------------------
    // 转动惯量必须算上"通过接合的离合器反射过来的发动机惯量"：
    // 挂上挡、离合锁止时，车轮和发动机是同一根轴，发动机的 Ie 经传动比
    // 平方放大（Ie·i²，i≈13 时是车轮自身惯量的 40 倍）。少算这一项，
    // 轮胎纵向力一变化车轮转速就瞬间跟着变，会激起 ±0.3 的滑移率极限环
    // （起步时看到转速表上下乱跳、加速肉）。打滑时按锁止程度折减。
    const Iw = this.wheelSpec.inertia + this.reflectedInertia;
    const driveTorque = this.driveTorque;
    const brakeTorque = this.brakeTorque;
    let spinAccel = driveTorque / Iw;
    if (brakeTorque > 0) {
      const brakeDecel = brakeTorque / Iw;
      if (this.spinRate > 1e-3) spinAccel += (Math.max(0, this.spinRate - brakeDecel * dt) - this.spinRate) / dt;
      else if (this.spinRate < -1e-3) spinAccel += (Math.min(0, this.spinRate + brakeDecel * dt) - this.spinRate) / dt;
      else spinAccel = 0;
    }
    this.spinRate += spinAccel * dt;

    // --- 6. 轮胎模型 ----------------------------------------------------
    let Fx = 0, Fy = 0;
    if (this.contact && Fz > 1) {
      const n = this.contactNormal;
      const wf = this.wheelFwd;
      const fwdG = this.fwdG.copy(wf).addScaled(n, -wf.dot(n));
      if (fwdG.lengthSq() < 1e-8) fwdG.set(0, 0, -1);
      fwdG.normalize();
      const rightG = this.rightG.crossVectors(fwdG, n).normalize();

      // 接地点速度 = 硬点速度 + 行程速度 + 车体角速度 × 力臂
      const lever = this.tmpB.subVectors(this.contactPoint, this.group.centroid);
      const vC = this.vContact.copy(this.group.velocity).addScaled(A, this.lenVel);
      vC.x += frame.angVel.y * lever.z - frame.angVel.z * lever.y;
      vC.y += frame.angVel.z * lever.x - frame.angVel.x * lever.z;
      vC.z += frame.angVel.x * lever.y - frame.angVel.y * lever.x;

      const vx = vC.dot(fwdG);
      const vy = vC.dot(rightG);
      const denom = Math.max(Math.abs(vx), 2.0);
      this.slipRatio = (this.spinRate * R - vx) / denom;
      this.slipAngle = -Math.atan2(vy, denom);

      const grip = this.gripScale * (1 - this.wear * 0.25) * (this.puncture ? 0.6 : 1);
      this.tire.update(this.slipRatio, this.slipAngle, Fz, material.mu, vx, dt, grip);
      Fx = this.tire.fx;
      Fy = this.tire.fy;

      // 滚动阻力
      const rr = this.tire.rollingResistance(Fz, material.rolling);
      const dir = vx > 0.05 ? 1 : vx < -0.05 ? -1 : 0;
      Fx -= rr * dir;

      // 地面反作用力矩 → 车轮自转。
      // 显式积分在"轮胎滑移刚度 / 车轮转动惯量"这个刚硬模态下会发散
      // （低速时尤甚：分母被 clamp 到 2 m/s），所以对滑移率做隐式线性化。
      //   ω ← ω + (−Fx·R)·dt / (Iw + R·(dFx/dω)·dt)
      // 必须乘上松弛系数：每个子步真正有效的刚度只有 Kx·relax。
      const Kx = this.tire.slipStiffness(Fz, material.mu, grip) * this.tire.relaxFactor;
      const dFxdOmega = (Kx * R) / denom;
      this.spinRate += ((-Fx * R) * dt) / (Iw + R * dFxdOmega * dt);

      // 制动器温度
      const brakePower = brakeTorque * Math.abs(this.spinRate);
      this.brakeTemp += (brakePower * 0.00035 - (this.brakeTemp - 25) * 0.018) * dt;
      this.brakeTemp = clamp(this.brakeTemp, 20, 900);
      this.vx = vx;
    } else {
      this.tire.update(0, 0, 0, 1, 0, dt, 1);
      this.slipRatio = 0;
      this.slipAngle = 0;
      this.vx = this.group.velocity.dot(frame.fwd);
    }

    this.Fz = Fz; this.Fx = Fx; this.Fy = Fy;
    this.tireLoadSmoothed += (Fz - this.tireLoadSmoothed) * Math.min(1, dt * 12);

    // --- 7. 轮胎合力 ----------------------------------------------------
    const F = this.tireForce;
    F.set(0, 0, 0);
    if (this.contact) {
      F.addScaled(this.contactNormal, Fz);
      F.addScaled(this.fwdG, Fx);
      F.addScaled(this.rightG, Fy);
    }

    // --- 8. 悬挂弹簧 / 减振器 -------------------------------------------
    // 渐进段从"静态压缩量"之后才开始，这样设计姿态就是精确的静平衡点。
    const susp = this.susp;
    const compression = c.springRest - this.len;
    let Fs = susp.springRate * compression;
    const extra = compression - c.sag;
    if (extra > 0) Fs += susp.springRate * 1.15 * extra * extra / Math.max(0.02, c.sag);
    Fs -= (this.lenVel < 0 ? susp.bumpDamping : susp.reboundDamping) * this.lenVel;
    const stopK = susp.springRate * 9;
    if (this.len < c.minLength) Fs += stopK * (c.minLength - this.len);
    else if (this.len > c.maxLength) Fs -= stopK * (this.len - c.maxLength);
    Fs = clamp(Fs, -susp.springRate * 3, susp.springRate * 12);
    this.springForce = Fs;
    const S = this.suspForce.copy(A).scale(Fs);

    // --- 9. 行程自由度积分 ----------------------------------------------
    const m_u = this.wheelSpec.unsprungMass;
    const gA = -GRAVITY * A.y;
    const alongF = (S.x + F.x) * A.x + (S.y + F.y) * A.y + (S.z + F.z) * A.z;
    const aP = (this.group.velocity.dot(A) - this.prevAttachVel.dot(A)) / Math.max(dt, 1e-5);
    this.prevAttachVel.copy(this.group.velocity);
    this.lenVel += (alongF / m_u + gA - aP) * dt;
    this.len += this.lenVel * dt;
    if (this.len < c.minLength - 0.02) { this.len = c.minLength - 0.02; if (this.lenVel < 0) this.lenVel *= -0.2; }
    if (this.len > c.maxLength + 0.03) { this.len = c.maxLength + 0.03; if (this.lenVel > 0) this.lenVel *= -0.2; }

    // --- 10. 反作用力施加到车身 -----------------------------------------
    //  力作用在硬点附近的分配组上；但"绕质心的力矩"必须用【整车】惯量张量
    //  分摊到整车节点上。若用小分配组（只有 5 个节点）的惯量去分摊，会得到
    //  几百 rad/s² 的局部角加速度，车架会被震出虚假的扭转/侧倾。
    this.group.applyForce(-S.x, -S.y, -S.z);
    const axial = F.dot(A);
    const px = F.x - A.x * axial, py = F.y - A.y * axial, pz = F.z - A.z * axial;
    if (this.contact) {
      this.group.applyForce(px, py, pz);
      const gp = this.group.centroid;
      const rx = this.contactPoint.x - gp.x, ry = this.contactPoint.y - gp.y, rz = this.contactPoint.z - gp.z;
      this.vehicle.bodyGroup.applyCouple(ry * pz - rz * py, rz * px - rx * pz, rx * py - ry * px);
    } else {
      this.group.applyForce(px, py, pz);
    }
    // 驱动/制动力矩反作用（扭矩转向、扭矩侧倾）—— 交给整车惯量去承担
    this.reactionTorque = driveTorque - brakeTorque * Math.sign(this.spinRate || 1);

    // --- 11. 统计 --------------------------------------------------------
    this.spinAngle = (this.spinAngle + this.spinRate * dt) % TAU;
    this.gripSaturation = this.tire.saturation;
    this.spinLoss = clamp(Math.abs(this.slipRatio) - this.spec.tire.peakSlipRatio, 0, 3);

    // --- 12. 掉轮判定 ----------------------------------------------------
    this.checkDetachment();
  }

  /**
   * 掉轮判定：吊住车轮的梁断掉一半以上就掉。
   * 原来用的是"所有碰到塔顶节点的梁存活 < 3"，前轮那种一共 25 根，
   * 等于要求断 23 根——实测 180 km/h 撞墙也做不到，轮子永远不会飞。
   */
  checkDetachment() {
    if (this.detached) return;
    const body = this.body;
    const set = this.mountBeams.length ? this.mountBeams : this.towerBeams;
    if (!set.length) return;
    let alive = 0;
    for (let n = 0; n < set.length; n++) if (body.active[set[n]]) alive++;
    if (alive * 2 <= set.length) {
      this.detached = true;
      this.detachImpact = alive;      // 供 HUD / 报告展示
    }
  }

  /** 世界坐标轮心（与物理一致，供渲染使用）。 */
  worldCenter(frame, out = new Vec3()) {
    const c = this.corner, body = this.body;
    out.set(body.px[c.towerIdx], body.py[c.towerIdx], body.pz[c.towerIdx]);
    this.tmpA.copy(this.axisLocal).applyBasis(frame.right, frame.up, frame.fwd).normalize();
    out.addScaled(this.tmpA, this.len);
    return out;
  }
}
