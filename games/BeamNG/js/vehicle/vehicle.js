// ============================================================================
//  整车：把车身软体、四个车轮、传动系统组合成一个可驾驶的对象
//
//  车体姿态不是"追踪"出来的，而是从变形后的车架反推的：
//    fwd = 车头参考点群质心 - 车尾参考点群质心
//    up  = 车顶参考点群质心 - 车底参考点群质心
//  这样即使车被撞成 V 字，车头朝向也会跟着折过去 —— 非常 BeamNG。
// ============================================================================
import { Vec3, Quat, clamp, lerp, wrapAngle, RAD, DEG, GRAVITY } from '../core/math.js';
import { buildVehicle } from './factory.js';
import { Wheel } from './wheel.js';
import { Drivetrain } from './drivetrain.js';
import { ForceGroup } from '../phys/softbody.js';

const MAX_STEER = 38 * DEG;
const STEER_RATE = 4.2;          // rad/s（方向盘到前轮的最大角速度）

export class Vehicle {
  constructor(spec, opts = {}) {
    this.spec = spec;
    const built = buildVehicle(spec, opts);
    this.body = built.body;
    this.geometry = built.geometry;
    this.built = built;

    this.frame = {
      pos: new Vec3(),
      fwd: new Vec3(0, 0, -1),
      right: new Vec3(1, 0, 0),
      up: new Vec3(0, 1, 0),
      angVel: new Vec3(),
      velocity: new Vec3(),
    };

    this.wheels = built.corners.map((c) => new Wheel(this, c));
    this.drivetrain = new Drivetrain(spec, this.wheels);
    this.drivetrain.tcEnabled = opts.tractionControl ?? true;

    // 整车惯量组（用于发动机反扭矩、气动力矩）
    const allNodes = new Int32Array(this.body.nodeCount);
    for (let i = 0; i < this.body.nodeCount; i++) allNodes[i] = i;
    this.allNodes = allNodes;
    this.bodyGroup = new ForceGroup(this.body, allNodes);

    this.controls = {
      throttle: 0, brake: 0, handbrake: 0, steer: 0, steerRaw: 0,
      shiftUp: false, shiftDown: false, gearMode: 'auto', clutch: undefined,
    };
    this.steerAngle = 0;
    this.steerRate = 0;
    this.absActive = false;
    this.tcActive = false;

    // 损毁
    this.regionDamage = built.regions.map(() => 0);
    this.damage = 0;
    this.integrity = 1;
    this.deformation = 0;
    this.maxDeformation = 0;
    this.elasticFlex = 0;
    this.crushDeadband = 0.018;    // 弹性形变死区（米）
    this.everPlastic = false;
    this.maxImpactG = 0;
    this.impactEnergy = 0;
    this.lastImpactTime = -99;
    this.aeroForce = new Vec3();

    // 掉落的零件
    this.debris = [];

    // 遥测
    this.speed = 0;
    this.speedKmh = 0;
    this.localVelocity = new Vec3();
    this.gForce = new Vec3();
    this.gForceRaw = new Vec3();
    this.prevVelocity = new Vec3();
    this.slipAngleBody = 0;
    this.yawRate = 0;
    this.airborne = false;
    this.wheelContacts = 0;
    this.odo = 0;

    this.time = 0;
    this._cA = new Vec3(); this._cB = new Vec3(); this._cC = new Vec3();
    this._q = new Quat();
    this.refFront = new Vec3(); this.refRear = new Vec3();
    this.refRoof = new Vec3(); this.refFloor = new Vec3();
    this.initialFrame = null;

    // 视角锚点（车身局部坐标，相对于整车质心）——用出厂姿态算好，
    // 渲染时再按当前车体姿态变换，所以撞歪了车里视角也会跟着歪。
    const c0 = this.body.centroid(allNodes);
    const roofC = this.body.centroid(built.frameRoof);
    const deckTop = [];
    for (let i = 0; i < this.body.nodeCount; i++) {
      if (this.body.pz[i] < -0.5 && this.body.py[i] > 0.6) deckTop.push(i);
    }
    const hoodC = deckTop.length ? this.body.centroid(deckTop) : roofC;
    this.cockpitPoint = new Vec3(roofC.x - c0.x - 0.34, roofC.y - c0.y - 0.52, roofC.z - c0.z + 0.34);
    this.hoodPoint = new Vec3(hoodC.x - c0.x, hoodC.y - c0.y + 0.20, hoodC.z - c0.z - 0.35);
    this.localCentroid0 = c0;

    // --- 形变参考组 ------------------------------------------------------
    // 量"撞坏了多少"必须用一个撞击时最后才变形的部位来锚定。用整车重心/
    // 前悬硬点当基准的话，车头一压溃它们就跟着跑，会把整台车都算成形变
    // （100 km/h 撞墙能读出 1 米的"压溃"）。这里全部用车尾那一段：
    //   dfRear  : 车尾 25% 的节点（锚点）
    //   dfMid   : 45%~62% 处的一圈（和车尾一起定"前方向"）
    //   dfRoofR / dfFloorR : 后半部的顶/底（定"上方向"）
    {
      let zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < this.body.nodeCount; i++) {
        if (this.body.pz[i] < zMin) zMin = this.body.pz[i];
        if (this.body.pz[i] > zMax) zMax = this.body.pz[i];
        if (this.body.py[i] < yMin) yMin = this.body.py[i];
        if (this.body.py[i] > yMax) yMax = this.body.py[i];
      }
      const zs = Math.max(1e-3, zMax - zMin);
      const ys = Math.max(1e-3, yMax - yMin);
      const rear = [], mid = [], roofR = [], floorR = [];
      for (let i = 0; i < this.body.nodeCount; i++) {
        const tz = (this.body.pz[i] - zMin) / zs;   // 1 = 最靠后
        const ty = (this.body.py[i] - yMin) / ys;
        if (tz > 0.75) rear.push(i);
        if (tz > 0.45 && tz < 0.62) mid.push(i);
        if (tz > 0.5 && ty > 0.66) roofR.push(i);
        if (tz > 0.5 && ty < 0.34) floorR.push(i);
      }
      this.dfRear = rear.length >= 4 ? rear : allNodes;
      this.dfMid = mid.length >= 4 ? mid : this.dfRear;
      this.dfRoofR = roofR.length >= 4 ? roofR : this.dfRear;
      this.dfFloorR = floorR.length >= 4 ? floorR : this.dfRear;
    }
    this._dfA = new Vec3(); this._dfB = new Vec3();
    this._dfC = new Vec3(); this._dfD = new Vec3(); this._dfUp0 = new Vec3();
    this._dfFwd = new Vec3(); this._dfUp = new Vec3(); this._dfRight = new Vec3();
    this.crushedArea = 0;
    this._initDeformReference(allNodes);
  }

  /** 用车尾锚定的方式，从给定坐标算一组基（right/up/fwd）。 */
  _basisFromPositions(px, py, pz, right, up, fwd) {
    const cen = (list, out) => {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < list.length; k++) { const i = list[k]; x += px[i]; y += py[i]; z += pz[i]; }
      const inv = 1 / Math.max(1, list.length);
      out.set(x * inv, y * inv, z * inv);
      return out;
    };
    const A = cen(this.dfRear, this._dfA);
    const B = cen(this.dfMid, this._dfB);
    const C = cen(this.dfRoofR, this._dfC);
    const D = cen(this.dfFloorR, this._dfD);
    fwd.subVectors(B, A);
    if (fwd.lengthSq() < 1e-10) fwd.set(0, 0, -1);
    fwd.normalize();
    const u0 = this._dfUp0.subVectors(C, D);
    right.crossVectors(fwd, u0);
    if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, fwd).normalize();
    fwd.crossVectors(up, right).normalize();
    return right;
  }

  /**
   * 建立"出厂参考形状"，坐标表达在车尾锚定的基准里。
   * 之后所有形变量都在这个基准下比较，因此：
   *  · 整车刚性运动 → 读数 0
   *  · 车头压溃而车尾没动 → 车尾读数仍然是 0
   */
  _initDeformReference(allNodes) {
    const b = this.body, n = b.nodeCount;
    const c0 = b.centroid(allNodes);
    const r = new Vec3(), u = new Vec3(), f = new Vec3();
    this._basisFromPositions(b.px, b.py, b.pz, r, u, f);
    const ref = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dx = b.px[i] - c0.x, dy = b.py[i] - c0.y, dz = b.pz[i] - c0.z;
      ref[i * 3] = dx * r.x + dy * r.y + dz * r.z;
      ref[i * 3 + 1] = dx * u.x + dy * u.y + dz * u.z;
      ref[i * 3 + 2] = dx * f.x + dy * f.y + dz * f.z;
    }
    this.refLocal = ref;
    this.settledLocal = ref.slice();
    // 锚点 = 车尾组在参考形状里的重心
    const a = new Vec3();
    for (let k = 0; k < this.dfRear.length; k++) {
      const i = this.dfRear[k];
      a.x += ref[i * 3]; a.y += ref[i * 3 + 1]; a.z += ref[i * 3 + 2];
    }
    const inv = 1 / Math.max(1, this.dfRear.length);
    a.scale(inv);
    this.refAnchor = a;
  }

  /** 整车没受损且基本静止时，让"已沉降参考形状"慢慢跟踪当前形状。 */
  relaxSettledReference(alpha) {
    const b = this.body;
    const n = b.nodeCount;
    const r = this._dfRight, u = this._dfUp, f = this._dfFwd;
    this._basisFromPositions(b.px, b.py, b.pz, r, u, f);
    const anchor = b.centroid(this.dfRear, this._dfA);
    const ra = this.refAnchor;
    const s = this.settledLocal;
    for (let i = 0; i < n; i++) {
      const dx = b.px[i] - anchor.x, dy = b.py[i] - anchor.y, dz = b.pz[i] - anchor.z;
      const lx = dx * r.x + dy * r.y + dz * r.z + ra.x;
      const ly = dx * u.x + dy * u.y + dz * u.z + ra.y;
      const lz = dx * f.x + dy * f.y + dz * f.z + ra.z;
      s[i * 3] += (lx - s[i * 3]) * alpha;
      s[i * 3 + 1] += (ly - s[i * 3 + 1]) * alpha;
      s[i * 3 + 2] += (lz - s[i * 3 + 2]) * alpha;
    }
  }

  /**
   * 量出每个节点偏离参考形状的距离（车尾锚定）。
   * @param {boolean} settled true = 用已沉降参考（推荐）
   */
  deformStats(settled = true) {
    const b = this.body, n = b.nodeCount;
    const ref = (settled ? this.settledLocal : this.refLocal);
    if (!ref || !this.refAnchor) return { mean: 0, max: 0, p98: 0, area: 0, maxNode: -1 };
    const r = this._dfRight, u = this._dfUp, f = this._dfFwd;
    this._basisFromPositions(b.px, b.py, b.pz, r, u, f);
    const anchor = b.centroid(this.dfRear, this._dfA);
    const ra = this.refAnchor;
    const DEAD = this.crushDeadband;
    const HB = 50, hist = this._crushHist ?? (this._crushHist = new Int32Array(HB + 1));
    hist.fill(0);
    let sum = 0, max = 0, maxNode = -1, crushed = 0;
    for (let i = 0; i < n; i++) {
      const ox = ref[i * 3] - ra.x, oy = ref[i * 3 + 1] - ra.y, oz = ref[i * 3 + 2] - ra.z;
      const ex = anchor.x + r.x * ox + u.x * oy + f.x * oz;
      const ey = anchor.y + r.y * ox + u.y * oy + f.y * oz;
      const ez = anchor.z + r.z * ox + u.z * oy + f.z * oz;
      const dx = b.px[i] - ex, dy = b.py[i] - ey, dz = b.pz[i] - ez;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > max) { max = d; maxNode = i; }
      if (d > DEAD) {
        const c = d - DEAD;
        sum += c; crushed++;
        hist[Math.min(HB, (c * (HB / 2.0)) | 0)]++;
      }
    }
    let p98 = 0;
    if (crushed) {
      const want = Math.ceil(crushed * 0.98);
      let acc = 0;
      for (let k = 0; k <= HB; k++) {
        acc += hist[k];
        if (acc >= want) { p98 = (k + 0.5) * (2.0 / HB); break; }
      }
    }
    return { mean: crushed ? sum / crushed : 0, max, p98, area: crushed / n, maxNode };
  }

  /** 把车放到世界里的指定位置（yaw 为绕 Y 轴角度）。 */
  reset(x, y, z, yaw = 0) {
    const b = this.body;
    b.hardReset();
    // 以车体参考点为原点做刚体变换
    const c = b.centroid(this.built.frameFront.concat(this.built.frameRear));
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (let i = 0; i < b.nodeCount; i++) {
      const dx = b.px[i] - c.x, dy = b.py[i] - c.y, dz = b.pz[i] - c.z;
      const rx = dx * cos + dz * sin;
      const rz = -dx * sin + dz * cos;
      b.px[i] = x + rx; b.py[i] = y + dy; b.pz[i] = z + rz;
      b.p0x[i] = b.px[i]; b.p0y[i] = b.py[i]; b.p0z[i] = b.pz[i];
      b.vx[i] = b.vy[i] = b.vz[i] = 0;
    }
    b.captureInitialState();
    for (const w of this.wheels) { w.reset(); w.spawned = false; }
    this.drivetrain.reset();
    this.debris.length = 0;
    this.damage = 0; this.integrity = 1; this.deformation = 0;
    this.maxImpactG = 0; this.impactEnergy = 0;
    this.regionDamage = this.built.regions.map(() => 0);
    this.everPlastic = false;
    this.time = 0;
    this.odo = 0;
    this.updateFrame();
    // 形变必须相对"车体自身"来量，否则车一开出去就被算成撞烂了
    b.captureInitialState(this.frame);
  }

  /** 直接给车一个初速度（碰撞测试用，省得先开一段路）。 */
  launch(speed, forward = true) {
    const f = this.frame;
    // 水平方向：不能把车体姿态里的俯仰分量算进去
    const dir = this._cA.set(f.fwd.x, 0, f.fwd.z);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
    dir.normalize();
    const s = forward ? speed : -speed;
    for (let i = 0; i < this.body.nodeCount; i++) {
      this.body.vx[i] = dir.x * s;
      this.body.vy[i] = 0;
      this.body.vz[i] = dir.z * s;
    }
    for (const w of this.wheels) {
      w.spinRate = speed / Math.max(0.05, w.radius);
      w.lenVel = 0;
      w.penInit = false;
    }
    this.prevVelocity.copy(f.velocity);
    f.velocity.set(dir.x * s, 0, dir.z * s);
    this.speed = forward ? speed : -speed;
  }

  /**
   * 让车"落地即稳定"：直接解出每个角的静平衡悬挂长度，避免开局下坠/回弹。
   * 前后轴需要的轮胎静变形不同，所以必须逐角求解。
   */
  settle() {
    const refDefl = this.built.refTireDefl;
    for (const w of this.wheels) {
      const c = w.corner;
      const tiltY = Math.max(0.3, Math.abs(c.axis.y));
      const want = c.staticTireDeflection ?? refDefl;
      w.len = c.designLength + (want - refDefl) / tiltY;
      w.lenVel = 0;
      w.lastPen = want;
      w.penInit = true;
    }
    this.body.clearForces();
    for (let i = 0; i < this.body.nodeCount; i++) this.body.vy[i] = 0;
  }

  /**
   * 按设计姿态把车放到地面上（自动求地形高度，四轮刚好接地）。
   * @param {object} world
   * @param {number} extraDrop 额外抬高量（米），用来做落地测试
   */
  resetAt(world, x, z, yaw = 0, extraDrop = 0) {
    const g = world.groundSample(x, z);
    this.reset(x, g.height + this.built.refCy - this.built.refTireDefl + extraDrop, z, yaw);
    this.settle();
    // 沉降过程本身会有一点点塑性流动（落地那一下），那不是"撞坏"：
    // 以沉降后的形状重新建立出厂参考，车损归零。
    this._initDeformReference(this.allNodes);
    this.everPlastic = false;
    this.damage = 0; this.deformation = 0; this.maxDeformation = 0;
    this.crushedArea = 0; this.integrity = 1;
    for (let i = 0; i < this.regionDamage.length; i++) this.regionDamage[i] = 0;
  }

  get position() { return this.frame.pos; }

  updateFrame() {
    const b = this.body, f = this.frame;
    b.centroid(this.built.frameFront, this.refFront);
    b.centroid(this.built.frameRear, this.refRear);
    b.centroid(this.built.frameRoof, this.refRoof);
    b.centroid(this.built.frameFloor, this.refFloor);

    f.fwd.subVectors(this.refFront, this.refRear);
    if (f.fwd.lengthSq() < 1e-8) f.fwd.set(0, 0, -1);
    f.fwd.normalize();

    const up0 = this._cA.subVectors(this.refRoof, this.refFloor);
    f.right.crossVectors(f.fwd, up0);
    if (f.right.lengthSq() < 1e-8) f.right.set(1, 0, 0);
    f.right.normalize();
    f.up.crossVectors(f.right, f.fwd).normalize();
    // 正交化前向
    f.fwd.crossVectors(f.up, f.right).normalize();

    b.centroid(this.allNodes, f.pos);
    b.centroidVelocity(this.allNodes, f.velocity);

    // 角速度（最小二乘估计）
    this.bodyGroup.refresh();
    this.bodyGroup.estimateAngularVelocity(f.angVel);
  }

  /**
   * 物理子步：在 body.clearForces() 之后、body.step() 之前调用。
   */
  update(dt, world, controls) {
    this.world = world;          // 渲染层（地面钳制、材质查询）也要用
    this.time += dt;
    this.updateFrame();
    const f = this.frame;
    const c = this.controls;

    // --- 控制输入 --------------------------------------------------------
    c.throttle = clamp(controls.throttle ?? 0, 0, 1);
    c.brake = clamp(controls.brake ?? 0, 0, 1);
    c.handbrake = clamp(controls.handbrake ?? 0, 0, 1);
    c.steerRaw = clamp(controls.steer ?? 0, -1, 1);
    c.gearMode = controls.gearMode ?? c.gearMode;
    c.shiftUp = !!controls.shiftUp;
    c.shiftDown = !!controls.shiftDown;
    c.selectGear = controls.selectGear ?? null;
    c.clutch = controls.clutch;

    // --- 方向盘：限速 + 随速收窄 ----------------------------------------
    const speedAbs = Math.abs(this.speed);
    const speedFactor = clamp(1 - speedAbs / 62, 0.34, 1);
    const target = c.steerRaw * MAX_STEER * speedFactor;
    const maxDelta = STEER_RATE * dt;
    const before = this.steerAngle;
    this.steerAngle = clamp(target, this.steerAngle - maxDelta, this.steerAngle + maxDelta);
    this.steerRate = (this.steerAngle - before) / dt;

    // Ackermann 转向几何
    this.applySteering(this.steerAngle);

    // --- 传动系统 --------------------------------------------------------
    this.drivetrain.update(dt, c, this.speed);
    this.absActive = this.drivetrain.absActive;
    this.tcActive = this.drivetrain.tcActive;

    // --- 车轮 ------------------------------------------------------------
    let contacts = 0;
    for (const w of this.wheels) {
      w.group.refresh();
      w.step(dt, world, f);
      if (w.contact) contacts++;
      if (w.detached && !w.spawned) {
        w.spawned = true;
        this.spawnDebris(w);
      }
    }
    this.wheelContacts = contacts;
    this.airborne = contacts === 0;

    // 驱动/制动反扭矩（发动机扭矩反作用 → 车身侧倾）
    let react = 0;
    for (const w of this.wheels) react += w.reactionTorque;
    if (Math.abs(react) > 0.01) {
      const axis = this.wheels[0].spinAxis;
      this.bodyGroup.applyCouple(-axis.x * react, -axis.y * react, -axis.z * react);
    }

    // --- 空气动力学 ------------------------------------------------------
    this.applyAero(dt);

    // --- 统计 ------------------------------------------------------------
    this.updateTelemetry(dt);
    this.updateDamage(dt);
    this.stepDebris(dt, world);
  }

  applySteering(angle) {
    const { wheelbase, track } = this.spec;
    let left = angle, right = angle;
    if (Math.abs(angle) > 1e-4) {
      const R = wheelbase / Math.max(0.05, Math.abs(Math.tan(angle)));
      const inner = Math.atan(wheelbase / Math.max(0.6, R - track * 0.5));
      const outer = Math.atan(wheelbase / Math.max(0.6, R + track * 0.5));
      if (angle > 0) { left = inner; right = outer; }   // 左转：左轮是内轮
      else { left = -inner; right = -outer; }
    }
    for (const w of this.wheels) {
      if (!w.steerable) {
        // 后轮随动转向：极小幅度的被动随动，提升高速稳定性
        w.steerAngle = -angle * 0.02;
        continue;
      }
      w.steerAngle = w.side < 0 ? left : right;
    }
  }

  /** 空气阻力 + 升力（负升力 = 下压力），施加在两个气动中心上。 */
  applyAero(dt) {
    const aero = this.spec.aero;
    const f = this.frame;
    const v = f.velocity;
    const speedSq = v.lengthSq();
    if (speedSq < 1) { this.aeroForce.zero(); return; }
    // 空气密度 1.225，Cd*A
    const q = 0.5 * 1.225 * speedSq;
    const drag = q * aero.cd * aero.frontalArea;
    const dir = this._cA.copy(v).normalize();
    this.aeroForce.copy(dir).scale(-drag);

    // 施加在气动中心（高度 copHeight），自动产生抬头/低头力矩
    const cop = this._cB.copy(f.pos);
    cop.y += aero.copHeight;
    this.bodyGroup.applyForceAt(this.aeroForce.x, this.aeroForce.y, this.aeroForce.z, cop.x, cop.y, cop.z);

    // 下压力：前后分别施加在各自轴上方
    const dfl = -q * aero.clFront * aero.frontalArea;
    const dfr = -q * aero.clRear * aero.frontalArea;
    const frontPos = this._cB.copy(f.pos).addScaled(f.fwd, -this.spec.wheelbase * 0.5);
    frontPos.y += 0.1;
    const rearPos = this._cC.copy(f.pos).addScaled(f.fwd, this.spec.wheelbase * 0.5);
    rearPos.y += 0.15;
    this.bodyGroup.applyForceAt(0, -dfl, 0, frontPos.x, frontPos.y, frontPos.z);
    this.bodyGroup.applyForceAt(0, -dfr, 0, rearPos.x, rearPos.y, rearPos.z);
    void dt;
  }

  updateTelemetry(dt) {
    const f = this.frame;
    const v = f.velocity;
    this.speed = v.dot(f.fwd);
    this.speedKmh = this.speed * 3.6;
    this.localVelocity.set(v.dot(f.right), v.dot(f.up), v.dot(f.fwd));
    this.yawRate = f.angVel.y;
    this.slipAngleBody = Math.atan2(this.localVelocity.x, Math.max(1e-3, Math.abs(this.localVelocity.z)));

    if (dt > 0) {
      const dvx = (v.x - this.prevVelocity.x) / dt;
      const dvy = (v.y - this.prevVelocity.y) / dt;
      const dvz = (v.z - this.prevVelocity.z) / dt;
      // 车体坐标系下的加速度
      const ax = (dvx * f.right.x + dvy * f.right.y + dvz * f.right.z) / GRAVITY;
      const ay = (dvx * f.up.x + dvy * f.up.y + dvz * f.up.z) / GRAVITY;
      const az = (dvx * f.fwd.x + dvy * f.fwd.y + dvz * f.fwd.z) / GRAVITY;
      // 20 ms 一阶低通：接触用的是罚函数力，瞬时加速度里混着几个子步的
      // 数值尖峰（不打滤波的话 50 km/h 和 100 km/h 撞墙都读成"40 g"）。
      // 真实碰撞试验也是先做 CFC60/CFC180 滤波再取峰值。
      const k = Math.min(1, dt / 0.02);
      this.gForce.x += (ax - this.gForce.x) * k;
      this.gForce.y += (ay - this.gForce.y) * k;
      this.gForce.z += (az - this.gForce.z) * k;
      this.gForceRaw.set(ax, ay, az);
      this.prevVelocity.copy(v);
      const gMag = this.gForce.length();
      if (gMag > this.maxImpactG && gMag < 400) this.maxImpactG = gMag;
    }
    this.odo += Math.abs(this.speed) * dt;
  }

  updateDamage(dt) {
    const b = this.body, built = this.built;
    // 分区损伤
    for (let r = 0; r < built.regions.length; r++) {
      const region = built.regions[r];
      let sum = 0;
      for (const i of region.nodes) sum += b.nodeDamage[i];
      const avg = sum / region.nodes.length;
      const prev = this.regionDamage[r];
      this.regionDamage[r] = prev + (avg - prev) * Math.min(1, dt * 3);
    }

    // 永久压溃量：和"已沉降参考形状"比较，再扣掉一个死区。
    // 每帧比较原厂形状会把自重压出来的几十毫米弹性柔度当成车损
    // （崭新的车停在原地也显示 40% 损伤）；只用塑性长度变化又会严重
    // 低估可见压溃（一串梁各自缩短 10 cm，车头实际后退了 50 cm）。
    // 所以：整车完好且静止时让参考形状慢慢跟踪当前形状（吸收弹性下沉），
    // 一旦发生过塑性变形就冻结参考，此后量到的就是真压溃。
    // 塑性流动 latch：只有真的"撞出坑"（某根梁被压短 2 cm 以上）才算车损。
    // 车停着不动、过个坎，也会有毫米级的塑性流动，那不该让参考形状冻住，
    // 否则崭新的车停在原地就显示几个百分点的损伤。
    const crush = b.crushStats();
    // 断梁同样说明"撞出坑了"：车头被彻底撕开的时候，那些本该"被压短"的梁
    // 已经断掉不再计入 crushStats，如果只看 crush.max，越严重的碰撞反而越像
    // 没受损（140 km/h 只报 17%，100 km/h 却报 67%）。所以断梁也 latch。
    if (crush.max > 0.02 || b.stats.brokenBeams > 0) this.everPlastic = true;
    const calm = !this.airborne && this.wheelContacts > 0 && Math.abs(this.speed) < 8;
    if (calm && !this.everPlastic) {
      const sp = Math.abs(this.speed);
      this.relaxSettledReference(Math.min(1, dt * (sp < 1 ? 3.0 : 1.2)));
    }
    const defo = this.deformStats(true);
    this.deformation = defo.mean;          // 受损区域的平均压溃深度
    this.maxDeformation = defo.p98;        // 稳健的"最深压溃"（98 分位）
    this.crushedArea = defo.area;          // 受损节点占比
    this.worstNode = defo.maxNode;
    this.elasticFlex = b.deformationStats(this.frame).mean;
    this.integrity = b.integrity();
    // 综合损伤：结构完整度 + 永久压溃 + 断梁，各自带一个小死区，
    // 保证"没撞过就是 0%，彻底撞烂才是 100%"。
    const brokenRatio = b.stats.brokenBeams / Math.max(1, b.beamCount);
    const structLoss = clamp((1 - this.integrity - 0.02) / 0.40, 0, 1) * 0.15;
    const deformLoss = clamp((this.deformation - 0.03) / 0.35, 0, 1) * 0.45;
    const deepLoss = clamp((this.maxDeformation - 0.08) / 0.90, 0, 1) * 0.20;
    const brokenLoss = clamp(brokenRatio / 0.08, 0, 1) * 0.20;
    this.damage = clamp(structLoss + deformLoss + deepLoss + brokenLoss, 0, 1);
    // 车轮丢失也计入
    const lost = this.wheels.filter((w) => w.detached).length;
    if (lost > 0) this.damage = clamp(this.damage + lost * 0.08, 0, 1);
  }

  /** 记录一次撞击（用于得分/镜头）。 */
  registerImpact(energy) {
    if (energy > this.impactEnergy * 0.5) this.impactEnergy = energy;
    this.lastImpactTime = this.time;
  }

  /** 掉轮 → 生成一个简单刚体碎片。 */
  spawnDebris(wheel) {
    const center = wheel.worldCenter(this.frame, new Vec3());
    const d = {
      wheel,
      pos: center,
      vel: this._cA.copy(this.frame.velocity).clone(),
      spin: wheel.spinAngle,
      spinRate: wheel.spinRate,
      radius: wheel.radius,
      quat: new Quat(),
      mass: wheel.wheelSpec.unsprungMass,
      side: wheel.side,
      axis: this._cB.copy(wheel.spinAxis).clone(),
      life: 0,
    };
    // 初速度带上一点车体角速度贡献
    this.debris.push(d);
  }

  stepDebris(dt, world) {
    const f = this.frame;
    for (const d of this.debris) {
      d.life += dt;
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaled(d.vel, dt);
      // 与地面碰撞
      const g = world.groundSample(d.pos.x, d.pos.z);
      const floor = g.height + d.radius;
      if (d.pos.y < floor) {
        d.pos.y = floor;
        const n = this._cA.set(g.nx, g.ny, g.nz);
        const vn = d.vel.dot(n);
        if (vn < 0) {
          d.vel.addScaled(n, -vn * 1.25);
          // 切向摩擦
          const vt = this._cB.copy(d.vel).addScaled(n, -d.vel.dot(n));
          d.vel.addScaled(vt, -0.35);
          d.vel.scale(0.985);
        }
        // 滚动
        d.spinRate = lerp(d.spinRate, d.vel.dot(f.fwd) / d.radius, 0.1);
      }
      // 静态体
      const cell = world.statics.cellAt(d.pos.x, d.pos.z);
      for (const b of cell) {
        const pen = b.sphereContact(d.pos.x, d.pos.y, d.pos.z, d.radius, this._cB);
        if (pen > 0) {
          d.pos.addScaled(this._cB, pen);
          const vn = d.vel.dot(this._cB);
          if (vn < 0) d.vel.addScaled(this._cB, -vn * 1.3);
        }
      }
      d.spin += d.spinRate * dt;
      // 静止的碎片不再更新（省性能）
      if (d.life > 2 && d.vel.lengthSq() < 0.05) d.sleeping = true;
      if (d.sleeping) { d.vel.zero(); d.spinRate = 0; }
    }
    // 只保留最近的若干块
    if (this.debris.length > 12) this.debris.splice(0, this.debris.length - 12);
  }

  /** 用于 HUD 的遥测快照。 */
  telemetry() {
    const dt = this.drivetrain;
    return {
      speedKmh: this.speedKmh,
      speed: this.speed,
      rpm: dt.rpmSmoothed,
      rpmRaw: dt.rpm,
      redline: this.spec.engine.redline,
      gear: dt.gearLabel,
      gearIndex: dt.gear,
      gearMode: this.controls.gearMode,
      throttle: this.controls.throttle,
      brake: this.controls.brake,
      handbrake: this.controls.handbrake,
      steer: this.controls.steerRaw,
      damage: this.damage,
      integrity: this.integrity,
      deformation: this.deformation,
      maxImpactG: this.maxImpactG,
      gForce: this.gForce,
      airborne: this.airborne,
      abs: this.absActive,
      tc: this.tcActive,
      fuelCut: dt.fuelCut,
      boost: dt.boost,
      brakeTemp: this.wheels[0].brakeTemp,
      surface: this.wheels.find((w) => w.contact)?.surfaceMaterial?.name ?? '—',
      wheels: this.wheels.map((w) => ({
        name: w.name, contact: w.contact, load: w.Fz, slip: w.slipRatio,
        slipAngle: w.slipAngle, travel: w.travel01(), detached: w.detached,
        saturation: w.gripSaturation, puncture: w.puncture, temp: w.brakeTemp,
      })),
      regions: this.built.regions.map((r, i) => ({ name: r.name, damage: this.regionDamage[i] })),
      odo: this.odo,
    };
  }
}
