import * as THREE from '../../vendor/three.module.js';

/**
 * 可以自己开的飞机。
 *
 * 三种状态：
 *   parked  —— 停在跑道上等你上机（菜单默认）
 *   ai      —— 电脑驾驶：天上巡航、隔一阵俯冲扑向你的车（原来看的那架）
 *   player  —— 你在开
 *
 * 飞行模型是真的气动力模型，不是"按方向键平移"：机身有速度和角速度，
 * 升力来自攻角（CL = CL0 + CLα·α，超过失速攻角就掉升力），阻力含诱导阻力
 * （CD = CD0 + k·CL²），俯仰/滚转/偏航各有操纵力矩和气动阻尼，还有静稳定性
 * （攻角大自动产生低头力矩、侧滑自动产生风标回正力矩）。所以：
 *   · 速度不够会失速掉下来
 *   · 压坡度会自己转弯（升力的水平分量）
 *   · 拉杆拉太狠会失速，俯冲太久会超速
 * 上手难度控制在"能飞"，但不至于像真机那样必须配平。
 */

const STATE = { PARKED: 0, CRUISE: 1, ATTACK: 2, CRASHED: 3 };
const G = 9.81;
// --- 气动常数（按一架 1.2 t 级的双发螺旋桨飞机取）---
const RHO = 1.225;          // 空气密度
const WING_AREA = 16.2;     // 机翼面积 m²
const MASS = 1250;          // 质量 kg
// CL0 取 0.40（有弯度的机翼零攻角也有升力）：配平速度 ≈200 km/h，失速速度
// ≈103 km/h，之间这段就是正常飞行区间。CL0 取太小（0.22）的话松杆配平速度会
// 高到 270 km/h，刚起飞一松杆就慢慢沉下去撞地。
const CL0 = 0.40;
const CL_ALPHA = 4.6;       // 升力线斜率 /rad
const ALPHA_STALL = 0.29;   // 失速攻角 ≈ 16.6°
const CD0 = 0.032;
const K_INDUCED = 0.052;
// 推重比取 0.57：满油门能把 20° 爬升维持住。之前 5200 N（0.42）爬 34° 会一直
// 掉速直到失速，键盘玩家会习惯性一直按着 ↑，那样体验太差。
const THRUST_MAX = 7000;    // N（双发）
const I_ROLL = 1600, I_PITCH = 3200, I_YAW = 2600;
const MAX_PITCH_CMD = 0.62;  // 玩家能指令的最大俯仰角 ≈35°
const MAX_BANK_CMD = 1.22;   // 最大坡度 ≈70°
// 操纵力矩用的动压下限。真实动压决定舵效，低速时舵效本来就小，但键盘玩家会觉得
// "按键没反应"。给操纵力矩单独设一个动压地板（气动力仍用真实动压），低速也跟手。
const CTRL_QS_MIN = 30000;

export const PLANE_MODE_LABEL = { parked: '停机', ai: '电脑驾驶', player: '你驾驶' };

export class Plane {
  constructor(world, opts = {}) {
    this.world = world;                       // CollisionWorld
    this.group = new THREE.Group();
    this.parts = {};
    this.mode = opts.mode ?? 'parked';
    this.cruiseAlt = opts.cruiseAlt ?? 150;
    this.orbitR = opts.orbitR ?? 420;
    this.crashChance = opts.crashChance ?? 0.35;
    this.maxSpeed = opts.maxSpeed ?? 78;
    this.minSpeed = opts.minSpeed ?? 34;
    this.enabled = true;
    this._rng = opts.rng ?? (() => Math.random());
    this._t = 0;
    this._cool = 14;
    this._burn = 0;
    this._smoke = 0;
    this._impact = null;
    this._light = null;
    this._justCrashed = false;

    // --- 刚体状态 ---
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();           // 世界速度矢量（不只是前进速度）
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();         // 机体轴角速度 (滚转, 俯仰, 偏航)
    this.throttle = 0;
    this.brake = 0;
    this.stalled = false;
    this.onGround = true;
    this.ias = 0;                             // 指示空速 m/s（沿机头的分量）
    this.alpha = 0;
    this.gLoad = 1;

    // 供 CameraRig / HUD 复用的接口
    this.frame = { pos: this.pos, fwd: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0) };
    this.cockpitPoint = new THREE.Vector3();
    this.hoodPoint = new THREE.Vector3();

    // 局部临时量，避免每帧 new。
    // 注意每个必须独立：_vhat 是单位速度方向、_force 是合力，混用会让阻力变 0。
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._vhat = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._wu = new THREE.Vector3();
    this._bu = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qw = new THREE.Quaternion();
    this._qd = new THREE.Quaternion();

    this._buildMesh();
    this._setMode(this.mode, true);
  }

  // --- 对外状态 -----------------------------------------------------------
  get alive() { return this.state !== STATE.CRASHED; }
  get burning() { return this._burn > 0; }
  get crashing() { return this.state === STATE.CRASHED; }
  /** 座舱/引擎盖视角的位置由 camera.js 直接读 vehicle.cockpitPoint。 */
  get position() { return this.pos; }
  get speed() { return this.vel.length(); }
  get speedKmh() { return this.ias * 3.6; }
  get airborne() { return !this.onGround && this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z) > 2; }
  get steerAngle() { return 0; }

  _setMode(mode, initial = false) {
    this.mode = mode;
    if (mode === 'parked') {
      this._park();
    } else if (mode === 'ai') {
      if (initial || this.state === STATE.CRASHED) this._respawnAir();
    } else {
      // 上机：如果飞机还停着就先松开刹车；坠毁了就重新给一架
      if (this.state === STATE.CRASHED) this._park();
      this._syncFromQuat();
    }
  }

  /** 停回跑道头，熄火。跑道就是出生点向南（-Z）那条直线。 */
  _park() {
    const x = 0, z = -78;
    // 起落架在机体系里是 y=-2.0，所以机身中心停在地面上方 2.05 m 轮子才刚好着地
    this.pos.set(x, this.world.groundHeight(x, z) + 2.05, z);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this._headingToQuat(-Math.PI / 2, 0, 0);   // 机头朝 -Z，正对跑道
    this.state = STATE.PARKED;
    this.throttle = 0;
    this.brake = 1;
    this._t = 0;
    this._forceDive = false;
    this._willCrash = false;
    this._aiTarget = null;
    this.onGround = true;
    this.ias = 0;
    this.alpha = 0;
    this._restoreMesh();
    this._syncFromQuat();
    this._syncMesh();
  }

  /** 空中巡航起始状态。 */
  _respawnAir() {
    this.pos.set(260, this.cruiseAlt, 300);
    const heading = Math.atan2(60 - this.pos.z, 0 - this.pos.x);
    this._headingToQuat(heading, 0, 0);
    this.vel.set(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(this.maxSpeed * 0.8);
    this.omega.set(0, 0, 0);
    this.state = STATE.CRUISE;
    this.throttle = 0.72;
    this.brake = 0;
    this.onGround = false;
    this._t = 0;
    this._cool = 12;
    this._forceDive = false;
    this._willCrash = false;
    this._aiTarget = null;
    this._restoreMesh();
    this._syncMesh();
  }

  /** 展开机翼、灭火（reset 和重新起飞时用）。 */
  _restoreMesh() {
    this.group.rotation.set(0, 0, 0);
    if (this.parts.wingL) this.parts.wingL.rotation.z = 0;
    if (this.parts.wingR) this.parts.wingR.rotation.z = 0;
    if (this._light) this._light.intensity = 0;
    this._burn = 0;
    this._smoke = 0;
  }

  // --- 外观 ---------------------------------------------------------------
  _buildMesh() {
    const g = this.group;
    const body = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.42, metalness: 0.55 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x9c2b2b, roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9fc4d8, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false,
    });
    this.materials = [body, accent, dark, glass];

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      g.add(m);
      return m;
    };

    // 机身：机头沿 +X（_syncMesh 里把 +X 旋到航向上）
    const fuse = new THREE.CylinderGeometry(1.05, 0.55, 12.5, 16, 1, false);
    fuse.rotateZ(-Math.PI / 2);
    add(fuse, body, 0, 0, 0);
    const nose = new THREE.ConeGeometry(1.05, 2.2, 16);
    nose.rotateZ(-Math.PI / 2);
    add(nose, accent, 7.3, 0, 0);
    const cab = new THREE.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    add(cab, glass, 3.4, 0.62, 0);

    // 主翼（带上反角）
    const wingGeo = new THREE.BoxGeometry(3.4, 0.26, 15.5);
    const wl = add(wingGeo, body, 0.4, -0.1, -7.6);
    const wr = add(wingGeo, body, 0.4, -0.1, 7.6);
    wl.rotation.x = 0.09; wr.rotation.x = -0.09;
    this.parts.wingL = wl; this.parts.wingR = wr;
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.5, 1.15, 0.2), accent, 0.1, 0.55, s * 15.2);
    }
    // 发动机短舱 + 螺旋桨
    this.props = [];
    for (const s of [-1, 1]) {
      const nac = new THREE.CylinderGeometry(0.72, 0.62, 2.6, 12);
      nac.rotateZ(-Math.PI / 2);
      add(nac, dark, 2.0, -0.5, s * 4.4);
      const hub = add(new THREE.ConeGeometry(0.3, 0.9, 10), dark, 3.5, -0.5, s * 4.4);
      hub.rotation.z = -Math.PI / 2;
      const prop = new THREE.Group();
      prop.position.set(3.85, -0.5, s * 4.4);
      const blade = new THREE.BoxGeometry(0.1, 3.0, 0.24);
      for (let i = 0; i < 2; i++) {
        const b = new THREE.Mesh(blade, dark);
        b.rotation.x = i * Math.PI * 0.5;
        prop.add(b);
      }
      g.add(prop);
      this.props.push(prop);
    }

    // 尾翼
    add(new THREE.BoxGeometry(2.0, 0.2, 6.2), body, -6.2, 0.15, 0);
    const fin = add(new THREE.BoxGeometry(2.4, 2.9, 0.2), accent, -6.3, 1.5, 0);
    fin.rotation.z = -0.16;
    this.parts.fin = fin;

    // 起落架：前三点式，位置要和物理里的接地点对上
    this.gear = [
      new THREE.Vector3(4.6, -2.0, 0),        // 前轮（机体系）
      new THREE.Vector3(-1.6, -1.9, -2.6),    // 左主轮
      new THREE.Vector3(-1.6, -1.9, 2.6),     // 右主轮
    ];
    add(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), dark, 4.6, -1.4, 0);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), dark, 4.6, -2.0, 0, Math.PI / 2);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 8), dark, -1.6, -1.35, s * 2.6);
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 10), dark, -1.6, -1.9, s * 2.6, Math.PI / 2);
    }

    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  }

  _spinProps(dt) {
    const rpm = 8 + this.throttle * 55;
    for (const p of this.props) p.rotation.x += rpm * dt;
  }

  // --- 上机 / 下机 --------------------------------------------------------
  /** 玩家坐进来。 */
  board() {
    if (this.state === STATE.CRASHED) this._park();
    this.mode = 'player';
    this.brake = 1;                          // 先刹住，等玩家给油门
    return true;
  }

  /** 玩家下机。空中不让下（没有下车走路的角色）。 */
  unboard() {
    if (this.airborne) return false;
    this.mode = 'ai';
    this.throttle = 0;
    this.brake = 1;
    // 下机后交给电脑：直接在天上重新开始巡航，免得停在跑道上挡路
    this._respawnAir();
    return true;
  }

  /** 调试/演示：立刻掉下来（菜单按钮）。 */
  forceCrash() {
    if (this.state === STATE.CRASHED) return;
    this.mode = 'ai';
    this.state = STATE.ATTACK;
    this._forceDive = true;
    this._cool = 0;
    this._burn = 0;
  }

  /**
   * 就地拉平（飞行中按 R）。只改姿态和角速度，不动位置和速度 ——
   * 翻过来或者失速下坠的时候用来救命，不至于只能摔。
   */
  recover() {
    if (this.state === STATE.CRASHED || this.mode === 'parked') return;
    const heading = this.headingXZ();
    this._headingToQuat(heading, 0, 0);
    this.omega.set(0, 0, 0);
    // 保证还有前进速度，不然拉平了也是往下掉
    if (this.ias < 45) this.vel.set(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(45);
    this.stalled = false;
  }

  // --- 每帧 ---------------------------------------------------------------
  /**
   * @param {number} dt 渲染帧的真实间隔（可能到 0.25 s）
   * @param {object} [vehicle] 玩家的车（电脑驾驶时当俯冲目标）
   * @param {object} [effects]
   * @param {object} [controls] {throttle, pitch, roll, yaw, brake} —— 有就是玩家在开
   */
  update(dt, vehicle, effects, controls) {
    if (!this.enabled) return;
    this._effects = effects;
    if (this.state === STATE.CRASHED) {
      this._updateWreck(dt, effects);
      return;
    }
    this._t += dt;

    // 固定步长积分。气动力和起落架弹簧都比较硬，直接用渲染帧的 dt 会有两个坑：
    // 一是 dt 到 0.25 s 时起落架一个步长里被压得很深、弹力巨大，飞机被弹上天，
    // 落地时再被判定成坠毁；二是帧率一变手感就变。所以内部固定 1/120 推进。
    this._acc = Math.min((this._acc ?? 0) + dt, 0.25);
    const h = 1 / 120;
    let steps = 0;
    while (this._acc >= h && steps < 32) {
      this._step(h, vehicle, effects, controls);
      this._acc -= h;
      steps++;
    }
    if (steps === 32) this._acc = 0;
    if (steps === 0) return;                  // 这一步还不够一个子步，等下一帧
    this._spinProps(dt);
    this._syncMesh();
    this._checkImpact(dt, effects);
  }

  /** 一个固定子步。 */
  _step(h, vehicle, effects, controls) {
    if (controls) {
      this.mode = 'player';
      this._playerStep(h, controls);
    } else if (this.mode === 'ai') {
      this._aiStep(h, vehicle, effects);
    } else {
      // 停机：熄火、刹车，什么都不做
      this.throttle = 0;
      this.brake = 1;
      this._integrate(h);
    }
  }

  /** 玩家操纵：读入操纵量，交给气动模型。 */
  _playerStep(dt, c) {
    this.throttle += (c.throttle - this.throttle) * Math.min(1, dt * 2.6);
    this.brake = c.brake ? 1 : 0;
    this._flightStep(dt, {
      pitch: c.pitch ?? 0,                  // 升降舵
      roll: c.roll ?? 0,                    // 副翼
      yaw: (c.yaw ?? 0) * 0.8,              // 方向舵（留点余量给风标稳定性）
    });
  }

  /** 电脑驾驶：沿用原来的"航迹自动驾驶"，但输出的操纵量走同一套气动模型。 */
  _aiStep(dt, vehicle, effects) {
    if (this.state === STATE.CRUISE) {
      this._cool -= dt;
      const a = Math.atan2(this.pos.z - 60, this.pos.x - 0) + 0.010;
      this._steerTo(Math.cos(a) * this.orbitR, 60 + Math.sin(a) * this.orbitR, this.cruiseAlt, dt);
      this.throttle = 0.72;
      if (this._cool <= 0 && vehicle) {
        this.state = STATE.ATTACK;
        this._willCrash = this._rng() < this.crashChance;
        this._cool = 20 + this._rng() * 22;
      }
      void effects;
    } else {
      if (this._forceDive) {
        this._aiTarget = { pitch: -2, roll: 0, yaw: 0 };   // 越界值 = 大角度扎下去
        this.throttle = 1;
      } else {
        const t = vehicle ? vehicle.position : { x: 0, y: 0, z: 0 };
        this._steerTo(t.x, t.z, t.y + 6, dt, true);
        this.throttle = 1;
        const agl = this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z);
        if (agl < 42) {
          if (this._willCrash) this._aiTarget = { pitch: -2, roll: 0, yaw: 0 };
          else { this.state = STATE.CRUISE; this._cool = 16 + this._rng() * 20; }
        }
      }
      if (this._t > 26) { this.state = STATE.CRUISE; this._cool = 12; }
      void effects;
    }
    this._flightStep(dt, this._aiTarget ?? { pitch: 0, roll: 0, yaw: 0 });
  }

  /**
   * 电脑驾驶的外环：把"要去哪个点"翻译成副翼/升降舵指令。
   * 横向是"航向保持"自动驾驶：航向误差 -> 目标坡度 -> 副翼，同时用滚转
   * 角速度做阻尼，不然会左右摆。纵向直接用高度误差 -> 升降舵。
   */
  _steerTo(tx, tz, alt, dt, attack = false) {
    const want = Math.atan2(tz - this.pos.z, tx - this.pos.x);
    let err = want - this.headingXZ();
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const bank = this._bankAngle();
    // 目标坡度（弧度，最多 57°），再换算成"占最大坡度的比例"当副翼指令。
    // 内环已经是姿态指令了，这里不能再叠一层自己算的角速度阻尼，不然两个环打架。
    const wantBank = Math.max(-1.0, Math.min(1.0, err * (attack ? 1.9 : 1.5)));
    const roll = Math.max(-1, Math.min(1, (wantBank - bank) / MAX_BANK_CMD));
    // 爬升/俯冲：正 = 抬头
    const dy = alt - this.pos.y;
    let pitch;
    if (attack && dy < -12) pitch = -1.6;                      // 扑下去（越界值）
    else pitch = Math.max(-0.5, Math.min(0.5, dy * 0.014));
    this._aiTarget = { pitch, roll, yaw: 0 };
    void dt;
  }

  /**
   * 气动模型。dt 内算力与力矩，积分线速度、角速度和姿态。
   * 这是整个飞机的核心：升力/阻力/推力/重力 + 三轴操纵力矩与气动阻尼。
   */
  _flightStep(dt, cmd) {
    const q = this.quat;
    this._fwd.set(1, 0, 0).applyQuaternion(q);
    this._up.set(0, 1, 0).applyQuaternion(q);
    this._right.set(0, 0, 1).applyQuaternion(q);

    const v = this.vel;
    const speed = v.length();
    const vhat = this._vhat.copy(v);
    if (speed > 1e-4) vhat.multiplyScalar(1 / speed); else vhat.set(0, 0, 0);

    // 气流角：沿机头分量 u、向上分量 w、侧向分量 s
    const u = v.dot(this._fwd);
    const w = v.dot(this._up);
    const s = v.dot(this._right);
    const ias = Math.max(0, u);
    const alpha = Math.atan2(-w, Math.max(2, Math.abs(u)));
    const beta = speed > 3 ? Math.asin(Math.max(-1, Math.min(1, s / speed))) : 0;
    this.ias = ias;
    this.alpha = alpha;

    // 动压
    const qd = 0.5 * RHO * speed * speed;
    // 升力系数：线性段 + 失速后衰减（失速就是升力塌掉、阻力暴涨）
    let CL = CL0 + CL_ALPHA * alpha;
    const over = Math.abs(alpha) - ALPHA_STALL;
    if (over > 0) {
      const f = Math.max(0.25, 1 - over * 3.4);
      CL *= f;
      this.stalled = true;
    } else {
      this.stalled = false;
    }
    const CD = CD0 + K_INDUCED * CL * CL + (this.brake > 0.5 ? 0.06 : 0);
    const CY = -1.35 * beta;

    const lift = qd * WING_AREA * CL;
    const drag = qd * WING_AREA * CD;
    const side = qd * WING_AREA * CY;
    const thrust = THRUST_MAX * this.throttle;

    // 升力方向：垂直于气流、躺在机体对称面里。小攻角下与机体上方向差别就是 α，
    // 这里直接取机体上方向，够用而且省一次叉乘。
    const F = this._force.set(0, 0, 0);
    F.addScaledVector(this._fwd, thrust);
    if (speed > 1e-4) F.addScaledVector(vhat, -drag);
    F.addScaledVector(this._up, lift);
    F.addScaledVector(this._right, side);
    F.y -= MASS * G;

    // --- 力矩（机体轴：x=滚转, y=偏航, z=俯仰；机头 +X、上 +Y、右 +Z）---
    // 俯仰和滚转做成**姿态指令**而不是角速度指令：按住 D 滚到 60° 坡度就停住并
    // 保持，松手自动回正；按住 ↑ 抬头到 34° 就保持。真机是角速度指令（一直按
    // 就一直翻），但键盘上那样子根本飞不稳 —— 目标是"像开车一样"能上手。
    // 偏航保持角速度指令，方向舵本来就是拿来修侧滑和地面滑行转向的。
    const qs = qd * WING_AREA;
    const qsC = Math.max(qs, CTRL_QS_MIN);          // 操纵力矩用（带地板）
    const bank = this._bankAngle();
    const wantBank = cmd.roll * MAX_BANK_CMD;
    const rollM = qsC * ((wantBank - bank) * 0.70 - this.omega.x * 0.32);
    const wantPitch = cmd.pitch * MAX_PITCH_CMD;    // AI 俯冲会给 -2 这种越界值
    const pitchM = qsC * ((wantPitch - this.pitchAngle) * 0.80 - this.omega.z * 0.34)
      - alpha * qs * 0.03;
    // 偏航：绕机体 +Y 的正角速度把机头往左带（右手系），所以操纵项取负。
    // 后一项是风标稳定性：侧滑自动回正。
    const yawM = qsC * (-cmd.yaw * 0.085 - this.omega.y * 0.10) - beta * qs * 0.15;
    this._lastYaw = cmd.yaw ?? 0;

    const ax = F.x / MASS, ay = F.y / MASS, az = F.z / MASS;
    this.gLoad = Math.hypot(ax, ay + G, az) / G;
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;

    this.omega.x += (rollM / I_ROLL) * dt;
    this.omega.y += (yawM / I_YAW) * dt;
    this.omega.z += (pitchM / I_PITCH) * dt;
    // 限幅：数值上别让角速度爆掉（真机也有极限角速度）
    const om = this.omega.length();
    if (om > 4.5) this.omega.multiplyScalar(4.5 / om);

    // 姿态积分 q̇ = 0.5·q⊗ω。ω 是机体轴角速度，必须**右乘**（左乘等于把 ω 当
    // 世界轴用，滚转/俯仰的轴向会整个错掉）。
    const wq = this._qw.set(this.omega.x, this.omega.y, this.omega.z, 0);
    const qdot = this._qd.copy(this.quat).multiply(wq);
    const qq = this.quat;
    qq.set(qq.x + qdot.x * 0.5 * dt, qq.y + qdot.y * 0.5 * dt,
      qq.z + qdot.z * 0.5 * dt, qq.w + qdot.w * 0.5 * dt).normalize();

    // 积分：先推位置，再解地面接触（顺序反了会用旧位置判接地）
    this.pos.addScaledVector(v, dt);
    this._groundStep(dt);
    this._syncFromQuat();
  }
  /**
   * 起落架接地的处理：支撑、滚动摩擦、地面转向、以及"拍在地上就炸"。
   *
   * 三个轮子的支撑力**先求和再一次性施加**。逐个施加的话同一帧里三个轮子各推
   * 一次，等效刚度直接 ×3，压缩稍深就会把飞机弹到天上去，然后落下来被判成坠毁。
   */
  _groundStep(dt) {
    const w = this.world;
    this.onGround = false;
    let dropRate = 0;
    let support = 0;
    let contacts = 0;
    const vy0 = this.vel.y;
    for (const gp of this.gear) {
      const p = this._v.copy(gp).applyQuaternion(this.quat).add(this.pos);
      const pen = w.groundHeight(p.x, p.z) - p.y;
      if (pen <= 0) continue;
      contacts++;
      this.onGround = true;
      dropRate = Math.min(dropRate, vy0);
      // 单轮支撑力：弹 + 阻尼。整机等效刚度因此就是 k（不是 3k）。
      support += Math.max(0, 42000 * pen - 5200 * Math.min(0, vy0));
    }
    if (contacts === 0) return;

    // 限一下总支撑力，避免深穿透时一帧给出天文数字的冲量
    support = Math.min(support, MASS * G * 6);
    this.vel.y += (support / MASS) * dt;
    // 吸收下沉速度，免得陷进地里
    if (this.vel.y < 0) this.vel.y *= 0.2;

    // 滚动摩擦（沿地面方向）+ 刹车
    const fr = this.brake > 0.5 ? 1.6 : 0.05;
    const hv = this._fwd.set(this.vel.x, 0, this.vel.z);
    const hs = hv.length();
    if (hs > 0.01) {
      const dec = Math.min(hs, fr * 9.81 * dt * 1.1);
      this.vel.x -= (hv.x / hs) * dec;
      this.vel.z -= (hv.z / hs) * dec;
    }
    // 前轮转向（地面滑行靠方向舵）
    if (this._lastYaw) {
      this.vel.applyAxisAngle(_UP_AXIS, this._lastYaw * 0.6 * dt);
    }
    // 拍得太狠就坠毁
    if (dropRate < -8.5 || (this.vel.length() > 60 && dropRate < -4)) this._crash();
    // 地面上把姿态扶正（机翼别插在地里）
    this.omega.multiplyScalar(Math.max(0, 1 - dt * 3));
  }

  /** 从四元数里取出航向/坡度/俯仰，供相机和 AI 使用。 */
  _syncFromQuat() {
    const f = this._fwd.set(1, 0, 0).applyQuaternion(this.quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(this.quat);
    const right = this._right.set(0, 0, 1).applyQuaternion(this.quat);
    this.frame.fwd.copy(f);
    this.frame.up.copy(up);
    this.frame.right.copy(right);
    this.frame.pos.copy(this.pos);
    this.cockpitPoint.copy(this.pos).addScaledVector(f, 3.2).addScaledVector(up, 1.15);
    this.hoodPoint.copy(this.pos).addScaledVector(f, 6.2).addScaledVector(up, 0.55);
    this.pitchAngle = Math.asin(Math.max(-1, Math.min(1, f.y)));
    this._pitchAngleCache = this.pitchAngle;
  }

  headingXZ() { return Math.atan2(this.frame.fwd.z, this.frame.fwd.x); }

  /**
   * 坡度角：机体上方向绕机头相对世界上方向转了多少（右滚为正）。
   * 做法是把两个上方向都投影到垂直于机头的平面里再量夹角 —— 直接看 up.y
   * 只能得到 cos(bank)，分不出左右。
   */
  _bankAngle() {
    const f = this.frame.fwd;
    const wu = this._wu.set(0, 1, 0).addScaledVector(f, -f.y);
    const up = this.frame.up;
    const bu = this._bu.copy(up).addScaledVector(f, -up.dot(f));
    if (wu.lengthSq() < 1e-8 || bu.lengthSq() < 1e-8) return 0;
    wu.normalize(); bu.normalize();
    const s = this._v.copy(wu).cross(bu).dot(f);
    return Math.atan2(s, wu.dot(bu));
  }

  _headingToQuat(heading, pitch, bank) {
    // 机头 +X：先偏航到 heading，再抬头（绕 Z），再压坡度（绕 X）
    const e = new THREE.Euler(0, -heading, 0, 'YXZ');
    this.quat.setFromEuler(e);
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bank);
    this.quat.multiply(qz).multiply(qx);
    this._syncFromQuat();
    void pitch; void bank;
  }

  /** 停机时的简化推进：只受重力，接地就走地面解算。 */
  _integrate(dt) {
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this._groundStep(dt);
    this._syncFromQuat();
  }

  /**
   * 撞地 / 撞建筑。
   *
   * 判断"撞建筑"时必须把地形从接触列表里剔掉：起落架撑起来之后机身中心本来
   * 就在地面上方 1.9 m，拿"离地高度 > 1.5 m 就算在空中"去判，停机坪上滑跑
   * 都会被判成撞墙。world.collectContacts 保证地形排在第 0 个（如果它在半径
   * 内），所以地面接触在就跳过第 0 个。
   */
  _checkImpact(dt, effects) {
    const groundY = this.world.groundHeight(this.pos.x, this.pos.z);
    const speed = this.vel.length();
    // 机体（不是起落架）拍在地上。要求同时有下降率，这样贴着地面平飞
    // （低空通场）不会莫名其妙算坠毁，一头扎下去才算。
    if (this.pos.y - groundY < 0.9 && this.vel.y < -1.5 && speed > 30) { this._crash(); return; }
    const r = 3.0;
    const out = Plane._contactBuf;
    const n = this.world.collectContacts(this.pos.x, this.pos.y, this.pos.z, r, out, 4);
    const terrainInList = this.pos.y - r < groundY + 0.6;
    for (let i = terrainInList ? 1 : 0; i < n; i++) {
      const o = i * 5;
      const nx = out[o], ny = out[o + 1], nz = out[o + 2];
      // 撞建筑：只有真快才算坠毁（滑行蹭到锥桶应该只是减速）
      if (speed > 32) { this._crash(); return; }
      // 慢速撞上去：把撞向表面的那部分速度吃掉
      const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn; this.vel.y -= ny * vn; this.vel.z -= nz * vn;
      }
    }
    void dt; void effects;
  }

  /** 爆炸 + 起火。 */
  _crash() {
    if (this.state === STATE.CRASHED) return;
    const hard = Math.min(1, this.vel.length() / 70);
    this.state = STATE.CRASHED;
    this._justCrashed = true;
    this._burn = 46;
    this._smoke = 0;
    this.vel.multiplyScalar(0.12);            // 撞完就基本停住
    this.omega.set(0, 0, 0);
    // 机头杵进地里 + 随机侧倾
    const f = this.frame.fwd;
    const yaw = Math.atan2(f.z, f.x);
    this._headingToQuat(yaw, -0.45 * hard, (this._rng() - 0.5) * 1.1 * hard);
    // 机翼掰掉一只
    const wing = this._rng() < 0.5 ? this.parts.wingL : this.parts.wingR;
    if (wing) wing.rotation.z = (wing === this.parts.wingL ? 1 : -1) * 1.15;
    this._impact = { x: this.pos.x, y: this.pos.y, z: this.pos.z, power: hard };
    if (this._effects && this._effects.enabled) this._explode(this._effects, hard);
    if (!this._light) {
      const l = new THREE.PointLight(0xff7a22, 0, 60, 2);
      this.group.add(l);
      this._light = l;
    }
    this._light.intensity = 22 * (0.5 + 0.5 * hard);
    this._syncMesh();
  }

  /** 一次性爆炸：火球 + 黑烟 + 火星。 */
  _explode(fx, hard = 1) {
    const { x, y, z } = this.pos;
    const n = Math.round((70 + 130 * hard) * fx.budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI * 0.5;
      const sp = (5 + Math.random() * 26) * (0.5 + hard);
      const fire = Math.random() < 0.55;
      fx.spawn(x, y + 1, z,
        Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 6 + Math.random() * 9, Math.sin(a) * Math.cos(b) * sp,
        {
          life: fire ? 0.5 + Math.random() * 0.9 : 1.6 + Math.random() * 2.4,
          size: fire ? 1.6 + Math.random() * 2.6 : 2.6 + Math.random() * 3.4,
          grow: fire ? 3.4 : 3.0,
          alpha: fire ? 0.95 : 0.66,
          drag: fire ? 1.5 : 0.7,
          buoy: fire ? 3.2 : 2.0,
          color: fire ? (Math.random() < 0.5 ? 0xffd257 : 0xff7a1e) : 0x2b2622,
        });
    }
    for (let i = 0; i < Math.round(40 * fx.budget); i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 0.5;
      const sp = 14 + Math.random() * 34;
      fx.spawn(x, y + 0.6, z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp + 8, Math.sin(a) * Math.cos(b) * sp,
        { life: 0.9 + Math.random() * 1.3, size: 0.13, grow: 0.3, alpha: 1, drag: 0.5, buoy: -7, color: 0xffcf6a });
    }
  }

  /** 残骸：持续冒火冒烟，火势随时间衰减。 */
  _updateWreck(dt, fx) {
    this._t += dt;
    // 残骸缓慢下沉贴地
    const gh = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y > gh + 0.9) { this.vel.y -= G * dt; this.pos.addScaledVector(this.vel, dt); }
    else if (this.vel.lengthSq() > 0.01) this.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
    this._syncMesh();

    if (this._burn > 0) {
      this._burn -= dt;
      const f = Math.min(1, this._burn / 30);
      if (this._light) this._light.intensity = f * (16 + Math.sin(this._t * 21) * 3 + Math.random() * 3);
      if (fx && fx.enabled) {
        this._smoke -= dt;
        if (this._smoke <= 0) {
          this._smoke = 0.02 + 0.05 * f;
          const hot = Math.random() < 0.55 * f + 0.15;
          const a = Math.random() * Math.PI * 2, r = Math.random() * 2.6;
          fx.spawn(this.pos.x + Math.cos(a) * r, this.pos.y + 0.7 + Math.random() * 1.0, this.pos.z + Math.sin(a) * r,
            (Math.random() - 0.5) * 1.6, 2.4 + Math.random() * 2.6, (Math.random() - 0.5) * 1.6,
            hot
              ? { life: 0.6 + Math.random() * 0.7, size: 1.4 + f * 1.6, grow: 2.6, alpha: 0.85, drag: 1.1, buoy: 3.4,
                color: Math.random() < 0.5 ? 0xffb43a : 0xff6a12 }
              : { life: 2.4 + Math.random() * 2.6, size: 2.4 + Math.random() * 2.6, grow: 3.4, alpha: 0.5 + 0.2 * f,
                drag: 0.6, buoy: 2.2, color: 0x25211e });
        }
      }
    } else if (this._light && this._light.intensity > 0) {
      this._light.intensity *= Math.max(0, 1 - dt * 0.6);
    }
  }

  /** 残骸的冲击波：把附近的车掀一下。 */
  blast(vehicle, radius = 26) {
    if (!this._impact || !vehicle?.body) return 0;
    const b = vehicle.body;
    const R = radius * radius;
    let n = 0;
    for (let i = 0; i < b.nodeCount; i++) {
      const dx = b.px[i] - this._impact.x;
      const dy = b.py[i] - this._impact.y;
      const dz = b.pz[i] - this._impact.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R) continue;
      const d = Math.max(1.2, Math.sqrt(d2));
      const k = (1 - d / radius) * this._impact.power * 9 / d;
      b.vx[i] += dx * k; b.vy[i] += Math.abs(dy) * k * 0.5 + k * 2.2; b.vz[i] += dz * k;
      n++;
    }
    return n;
  }

  /** 把四元数写进渲染变换（模型机头是 +X，不需要额外偏移）。 */
  _syncMesh() {
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
  }

  setEnabled(v) { this.enabled = v; this.group.visible = v; }

  /** 相机/菜单用的一行状态。 */
  statusText() {
    if (this.state === STATE.CRASHED) return this.burning ? '已坠毁 · 燃烧中' : '已坠毁';
    if (this.mode === 'parked') return '停在跑道上';
    if (this.stalled) return '失速！';
    return `${(this.ias * 3.6).toFixed(0)} km/h · ${this.pos.y.toFixed(0)} m`;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials ?? []) m.dispose();
  }
}

Plane._contactBuf = new Float64Array(5 * 8);
const _UP_AXIS = new THREE.Vector3(0, 1, 0);
