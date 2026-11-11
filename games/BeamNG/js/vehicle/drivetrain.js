// ============================================================================
//  传动系统：发动机 · 离合器 · 变速箱 · 差速器 · ABS / 牵引力控制
//
//  发动机用扭矩曲线 + 摩擦扭矩（松油门就是发动机制动），涡轮有迟滞。
//  离合器是一个"有限容量的粘性耦合"：转速差越大传递扭矩越大，到容量上限就打滑，
//  扭矩容量用峰值扭矩的倍数表示 —— 这就是弹射起步时轮胎打滑的物理来源。
// ============================================================================
import { clamp, lerp, RAD } from '../core/math.js';

const RPM_TO_RAD = Math.PI / 30;
const RAD_TO_RPM = 30 / Math.PI;

export class Drivetrain {
  constructor(spec, wheels) {
    this.spec = spec;
    this.wheels = wheels;
    this.engineSpec = spec.engine;
    this.gearbox = spec.gearbox;
    this.brake = spec.brake;
    this.layout = spec.driveLayout;

    // 差速器参数
    this.lsd = spec.diff ?? { type: 'open', preload: 0, ramp: 0, centerBias: 0.5, centerLock: 0.6 };

    this.frontWheels = wheels.filter((w) => w.axle === 'front');
    this.rearWheels = wheels.filter((w) => w.axle === 'rear');

    const peak = Math.max(...this.engineSpec.torqueCurve.map((p) => p[1]));
    this.peakTorque = peak;
    this.clutchCapacity = peak * 1.75;
    this.clutchStiffness = 900;      // 半隐式积分下可以取很大 → 近似锁止
    // 摩擦片扭转减振器：不加阻尼的话发动机惯量和整车惯量之间会形成
    // 一个 ~3 Hz 无阻尼扭振，表现为传动轴扭矩在 ±容量 之间来回甩。
    this.clutchDamping = 2 * 0.8 * Math.sqrt(this.clutchStiffness * (this.engineSpec?.inertia ?? 0.22));
    this.lockFactor = 1;

    this.reset();
  }

  reset() {
    this.rpm = this.engineSpec.idleRpm;
    this.rpmSmoothed = this.rpm;
    this.gear = 1;
    this.shiftTimer = 0;
    this.clutchEngagement = 1;
    this.boost = 0;
    this.throttle = 0;
    this.brakeInput = 0;
    this.handbrake = 0;
    this.starterTimer = 0;
    this.limiterActive = false;
    this.revMatch = 0;
    this.autoShiftCooldown = 0;
    this.shiftCount = 0;
    this.absActive = false;
    this.tcActive = false;
    this.clutchSlip = 0;
    this.driveshaftTorque = 0;
    this.fuelCut = false;
  }

  get gearRatio() {
    if (this.gear === 0) return 0;
    if (this.gear === -1) return -this.gearbox.reverse;
    return this.gearbox.ratios[this.gear - 1] ?? 0;
  }

  get gearLabel() {
    if (this.gear === -1) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  get maxGear() { return this.gearbox.ratios.length; }

  /** 曲轴输出扭矩（不含离合器）。 */
  engineTorque(rpm, throttle) {
    const e = this.engineSpec;
    const curve = e.torqueCurve;
    let base = curve[curve.length - 1][1];
    if (rpm <= curve[0][0]) base = curve[0][1];
    else {
      for (let i = 0; i < curve.length - 1; i++) {
        const [r0, t0] = curve[i], [r1, t1] = curve[i + 1];
        if (rpm >= r0 && rpm <= r1) { base = lerp(t0, t1, (rpm - r0) / (r1 - r0)); break; }
      }
    }
    // 涡轮：torqueCurve 本身就是"满增压"曲线（厂商数据就是这么给的），
    // 增压只负责"迟滞"——没起压时掉到七成扭矩，别把整条曲线翻倍。
    let boostMul = 1;
    if (e.turbo) boostMul = 1 - 0.30 * (1 - clamp(this.boost, 0, 1));
    const indicated = base * throttle * boostMul;
    const friction = e.frictionTorque * (0.35 + 0.65 * clamp(rpm / e.redline, 0, 1.4));
    return indicated - friction;
  }

  /** 原地怠速/起步时的怠速调节扭矩。 */
  idleTorque(rpm) {
    const target = this.engineSpec.idleRpm;
    if (rpm >= target) return 0;
    // 怠速马达只能补一点点扭矩（够克服自身摩擦）。如果不封顶，
    // 1 挡 13:1 的传动比会把"怠速"变成十几公里的蠕行推力甚至自激振荡。
    return Math.min(this.engineSpec.frictionTorque * 1.6, (target - rpm) * 0.75);
  }

  /** 自动变速箱换挡逻辑。 */
  updateAutoShift(dt, throttle, vehicleSpeed) {
    if (this.shiftTimer > 0) return;
    if (this.autoShiftCooldown > 0) return;
    const gb = this.gearbox;
    const upRpm = gb.autoUpRpm * this.engineSpec.redline;
    const downRpm = gb.autoDownRpm * this.engineSpec.redline;
    // 离合器还在打滑时不能升挡：否则发动机会在"空转高转速"下把挡位推满，
    // 结果低速就挂上 6 挡、扭矩全烧在离合器上（极速和加速都会废掉）。
    const locked = Math.abs(this.clutchSlip) < 30;
    // 降挡后不能超转：用输入轴转速换算目标挡的发动机会到多少
    const inputRpm = this.inputSpeed * RAD_TO_RPM;
    const nextRpm = inputRpm * (gb.ratios[this.gear] ?? 0) / Math.max(0.01, gb.ratios[this.gear - 1] ?? 1);
    if (this.gear > 0 && this.rpm > upRpm && locked && throttle > 0.05 && this.gear < this.maxGear) {
      this.shiftUp();
    } else if (this.gear > 1 && this.rpm < downRpm && nextRpm < this.engineSpec.redline * 0.95) {
      this.shiftDown();
    }
    void vehicleSpeed;
  }

  shiftUp() {
    if (this.gear >= this.maxGear) return false;
    if (this.gear === -1) return false;
    this.gear = Math.max(1, this.gear) + 1;
    this.beginShift();
    return true;
  }

  shiftDown() {
    if (this.gear <= 1) {
      if (this.gear === 1) return false;
      return false;
    }
    this.gear -= 1;
    this.beginShift();
    return true;
  }

  beginShift() {
    this.shiftTimer = this.gearbox.shiftTime;
    this.shiftCount++;
    this.autoShiftCooldown = 0.35;
  }

  /**
   * 子步更新：决定发动机转速、挡位、各轮扭矩。
   * @param {number} dt
   * @param {object} ctrl { throttle, brake, handbrake, shiftUp, shiftDown, gearMode, clutch }
   * @param {number} vehicleSpeed 纵向速度（m/s，前进为正）
   */
  update(dt, ctrl, vehicleSpeed) {
    const e = this.engineSpec;
    this.throttle = clamp(ctrl.throttle ?? 0, 0, 1);
    this.brakeInput = clamp(ctrl.brake ?? 0, 0, 1);
    this.handbrake = clamp(ctrl.handbrake ?? 0, 0, 1);

    if (this.autoShiftCooldown > 0) this.autoShiftCooldown -= dt;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    // --- 挡位选择 -------------------------------------------------------
    if (ctrl.shiftUp) this.shiftUp();
    if (ctrl.shiftDown) this.shiftDown();
    if (ctrl.gearMode === 'auto') this.updateAutoShift(dt, this.throttle, vehicleSpeed);
    if (ctrl.selectGear !== undefined && ctrl.selectGear !== null && this.shiftTimer <= 0) {
      // 直接选挡（挡位按钮/按键）
      const g = ctrl.selectGear;
      if (g === -1 && Math.abs(vehicleSpeed) < 1.2 && this.gear !== -1) { this.gear = -1; this.beginShift(); }
      else if (g === 0 && this.gear !== 0) { this.gear = 0; this.beginShift(); }
      else if (g >= 1 && g <= this.maxGear && g !== this.gear) {
        if (Math.sign(vehicleSpeed) !== -1) { this.gear = g; this.beginShift(); }
      }
    }

    // --- 离合器接合 -----------------------------------------------------
    const shifting = this.shiftTimer > 0;
    let wantEngage = shifting ? 0 : (this.gear === 0 ? 0 : 1);
    // 静止且没踩油门 → 离合分离（自动挡相当于 N 挡，手动挡相当于踩住离合）。
    // 不这么做的话，怠速扭矩经 1 挡 13:1 的传动比会把车推着走，还会在静止
    // 附近激发"发动机转速 ↔ 车轮转速"的自激振荡（车自己前后窜个不停）。
    const parked = Math.abs(vehicleSpeed) < 1.2 && this.throttle < 0.06 && this.brakeInput < 0.02;
    if (parked && !shifting) wantEngage = 0;
    const rate = wantEngage > this.clutchEngagement ? 1 / 0.09 : 1 / 0.06;
    // 注意别写成 `+= (want>cur?1:-1)*rate*dt`：当 cur 已经等于 want=1 时
    // 判断为假，会反过来每步往下掉，围绕 1.0 形成一个 ±0.06 的极限环。
    if (this.clutchEngagement < wantEngage) {
      this.clutchEngagement = Math.min(wantEngage, this.clutchEngagement + rate * dt);
    } else if (this.clutchEngagement > wantEngage) {
      this.clutchEngagement = Math.max(wantEngage, this.clutchEngagement - rate * dt);
    }
    if (ctrl.clutch !== undefined) this.clutchEngagement = clamp(ctrl.clutch, 0, 1);
    // 起步时半联动
    if (!shifting && this.gear !== 0 && Math.abs(vehicleSpeed) < 1.2 && this.rpm < e.idleRpm * 1.35) {
      this.clutchEngagement = Math.min(this.clutchEngagement, 0.55);
    }

    // --- 输入轴转速 -----------------------------------------------------
    const ratio = this.gearRatio;
    let inputSpeed = 0;
    if (ratio !== 0) {
      const frontSpeed = (this.frontWheels[0].spinRate + this.frontWheels[1].spinRate) * 0.5;
      const rearSpeed = (this.rearWheels[0].spinRate + this.rearWheels[1].spinRate) * 0.5;
      const axleSpeed = this.layout === 'FWD' ? frontSpeed : this.layout === 'RWD' ? rearSpeed : (frontSpeed + rearSpeed) * 0.5;
      inputSpeed = axleSpeed * ratio * this.gearbox.finalDrive;
    }

    // --- 涡轮迟滞 -------------------------------------------------------
    if (e.turbo) {
      const spool = clamp((this.rpm - e.turbo.spoolRpm) / 2200, 0, 1);
      const target = spool * this.throttle;
      const lag = Math.max(0.05, e.turbo.lag);
      this.boost += (target - this.boost) * clamp(dt / lag, 0, 1);
    } else {
      this.boost = 0;
    }

    // --- 断油保护 -------------------------------------------------------
    this.fuelCut = this.rpm > e.redline * 1.015;
    let throttle = this.throttle;
    if (this.fuelCut) throttle = 0;

    // --- 发动机侧扭矩 ---------------------------------------------------
    let Te = this.engineTorque(this.rpm, throttle);
    Te += this.idleTorque(this.rpm) * (1 - this.throttle * 0.5);

    // --- 离合器 ---------------------------------------------------------
    // 用半隐式积分：先按"完全锁止"解出新的发动机转速，若所需扭矩超过容量
    // 才退回打滑。这样刚度可以取得很大（≈锁止），数值上依然无条件稳定。
    const omegaE = this.rpm * RPM_TO_RAD;
    const Ie = e.inertia;
    const k = this.clutchStiffness;
    let capacity = this.clutchCapacity * this.clutchEngagement;
    // 防熄火：转速压太低时自动收离合（相当于驾驶员的左脚）
    const stallRpm = Math.max(e.idleRpm * 1.45, 1050);
    if (this.rpm < stallRpm && throttle > 0.02) {
      capacity *= clamp((this.rpm - 420) / (stallRpm - 420), 0.05, 1);
    }
    // 低速小油门时只能"半联动"：不踩油门时离合最多传怠速能力那一档扭矩。
    // 注意不能用"车速越高容量越大"的写法——那会形成正反馈，车会自己窜出去。
    const absSpeed = Math.abs(vehicleSpeed);
    const throttleRef = clamp((throttle - 0.05) / 0.25, 0, 1);
    const lowSpeed = clamp(1 - absSpeed / 4, 0, 1);
    if (throttleRef < 1) {
      const idleCap = this.clutchCapacity * (0.06 + 0.94 * throttleRef);
      capacity = capacity * (1 - lowSpeed) + Math.min(capacity, idleCap) * lowSpeed;
    }

    this.clutchSlip = omegaE - inputSpeed;
    this.inputSpeed = inputSpeed;
    let clutchTorque = 0;
    let omegaNew;
    let lockFactor = 0;
    if (this.gear !== 0 && this.clutchEngagement > 0.001 && k > 0) {
      // 离合器不只是弹簧，摩擦片本身有扭转减振器 → 加一个阻尼项。
      // 后向欧拉里阻尼等效于把刚度提升 c/dt，于是还是同一个公式。
      const keff = k + this.clutchDamping / Math.max(dt, 1e-5);
      const implicit = (omegaE + (dt / Ie) * (Te + keff * inputSpeed)) / (1 + (dt * keff) / Ie);
      const tImplicit = keff * (implicit - inputSpeed);
      if (Math.abs(tImplicit) <= capacity) {
        clutchTorque = tImplicit;
        omegaNew = implicit;
        lockFactor = 1;
      } else {
        clutchTorque = Math.sign(tImplicit) * capacity;
        omegaNew = omegaE + ((Te - clutchTorque) * dt) / Ie;
        // 扭矩需求超过容量 → 离合器在打滑，只把一部分惯量反射到车轮上
        lockFactor = clamp(capacity / Math.max(1e-3, Math.abs(tImplicit)), 0, 1);
      }
    } else {
      omegaNew = omegaE + (Te * dt) / Ie;
    }
    // 发动机不能被反拖到反转
    const floor = e.idleRpm * RPM_TO_RAD * 0.45;
    if (omegaNew < floor) omegaNew = floor;
    this.rpm = clamp(omegaNew * RAD_TO_RPM, 350, e.maxRpm);
    if (this.fuelCut) this.rpm = Math.min(this.rpm, e.redline * 1.05);

    // --- 扭矩分配 -------------------------------------------------------
    this.clutchTorque = clutchTorque;
    const eff = this.gearbox.efficiency;
    const axleTorque = clutchTorque * ratio * this.gearbox.finalDrive * eff;
    this.driveshaftTorque = axleTorque;
    this.lockFactor = lockFactor;
    this.applyAxleTorque(axleTorque, dt, lockFactor);

    // --- 制动 -----------------------------------------------------------
    this.applyBrakes(dt, vehicleSpeed);

    // --- ABS / TC 状态显示 ----------------------------------------------
    this.absActive = this.wheels.some((w) => w.absActive);
    this.tcActive = this.wheels.some((w) => w.tcActive);
    this.rpmSmoothed += (this.rpm - this.rpmSmoothed) * Math.min(1, dt * 14);
  }

  /**
   * 把轴扭矩按布局/差速器分到各轮。
   * @param {number} axleTorque 变速箱输出轴扭矩
   * @param {number} dt
   * @param {number} lockFactor 离合器锁止程度 0..1（用来算反射惯量）
   */
  applyAxleTorque(axleTorque, dt, lockFactor = 1) {
    const d = this.lsd;
    // 每个子步都要清零！下面全是 += （差速器附加扭矩要叠加），
    // 忘了清零的话驱动扭矩会逐子步累加、永不衰减：松油门、踩下离合之后
    // 轮子上还挂着几十倍的历史扭矩，车会自己窜。
    for (const w of this.wheels) w.driveTorque = 0;

    // 传动系反射惯量：离合锁止时发动机通过传动比和车轮刚性相连，
    // 车轮"看到"的转动惯量是 Ie·i²（i≈13 时是车轮自身惯量的几十倍）。
    // 不把这一项交给 wheel.js，轮胎纵向力一抖车轮转速就跟着抖。
    const ratio = this.gearRatio;
    const i = ratio * this.gearbox.finalDrive;
    const reflected = this.engineSpec.inertia * i * i * (this.gearbox.efficiency) *
      clamp(this.clutchEngagement, 0, 1) * clamp(lockFactor, 0, 1);
    for (const w of this.wheels) w.reflectedInertia = 0;

    const deliver = (axleWheels, torque) => {
      if (axleWheels.length === 0) return;
      if (d.type === 'locked') {
        // 锁死：两轮同速，扭矩按抓地分配 → 用平均转速做参考
        const avg = (axleWheels[0].spinRate + axleWheels[1].spinRate) * 0.5;
        axleWheels.forEach((w) => { w.driveTorque += torque * 0.5; });
        // 附加锁止扭矩，把快的一侧拉回平均
        const lock = Math.abs(torque) * 2.2 + this.peakTorque * 0.6;
        axleWheels.forEach((w) => {
          const err = w.spinRate - avg;
          w.driveTorque += clamp(-err * 90, -lock, lock) * 0.5;
        });
      } else if (d.type === 'lsd') {
        const avg = (axleWheels[0].spinRate + axleWheels[1].spinRate) * 0.5;
        const preload = this.peakTorque * d.preload;
        const ramp = Math.abs(torque) * d.ramp + preload;
        axleWheels.forEach((w) => {
          w.driveTorque += torque * 0.5;
          const err = w.spinRate - avg;
          w.driveTorque += clamp(-err * 55, -ramp, ramp) * 0.5;
        });
      } else {
        axleWheels.forEach((w) => { w.driveTorque += torque * 0.5; });
      }
      for (const w of axleWheels) w.reflectedInertia = reflected;
    };

    if (this.layout === 'FWD') {
      deliver(this.frontWheels, axleTorque);
    } else if (this.layout === 'RWD') {
      deliver(this.rearWheels, axleTorque);
    } else {
      // 四驱：中央差速（默认按偏向后驱分配 + 中央耦合）
      const bias = d.centerBias ?? 0.5;
      const frontTorque = axleTorque * bias;
      const rearTorque = axleTorque * (1 - bias);
      deliver(this.frontWheels, frontTorque);
      deliver(this.rearWheels, rearTorque);
      // 中央限滑：前后转速差产生额外耦合
      const frontSpeed = (this.frontWheels[0].spinRate + this.frontWheels[1].spinRate) * 0.5;
      const rearSpeed = (this.rearWheels[0].spinRate + this.rearWheels[1].spinRate) * 0.5;
      const coupling = clamp((frontSpeed - rearSpeed) * 70, -this.peakTorque, this.peakTorque) * (d.centerLock ?? 0.5);
      this.frontWheels.forEach((w) => { w.driveTorque -= coupling * 0.5; });
      this.rearWheels.forEach((w) => { w.driveTorque += coupling * 0.5; });
    }
    void dt;
  }

  /** 制动 + ABS + 手刹。 */
  applyBrakes(dt, vehicleSpeed) {
    const b = this.brake;
    const frontBias = b.bias;
    const pedal = this.brakeInput;
    const speed = Math.abs(vehicleSpeed);

    for (const w of this.wheels) {
      const share = w.axle === 'front' ? frontBias : 1 - frontBias;
      let torque = pedal * b.maxTorque * share * 2;
      // 刹车热衰减
      const fade = clamp(1 - Math.max(0, w.brakeTemp - 500) / 700, 0.45, 1);
      torque *= fade;

      // ABS：以"峰值滑移率"为目标做比例调节。利用率低于峰值就是浪费
      // 附着，所以卸压要温和（真实 ABS 是每秒十几次的脉冲式卸压-保压）。
      w.absActive = false;
      if (b.abs && pedal > 0.15 && speed > 2.0 && w.contact) {
        const lockAmount = -w.slipRatio;      // 制动时滑移率为负
        const target = (w.tire?.p?.peakSlipRatio ?? 0.12) * 1.25;
        if (lockAmount > target) {
          const reduce = clamp(1 - (lockAmount - target) * 1.6, 0.35, 1);
          torque *= reduce;
          w.absActive = true;
        }
      }
      w.brakeTorque = torque;
    }

    // 手刹：只作用在后轮（还能用来甩尾）
    if (this.handbrake > 0.01) {
      for (const w of this.wheels) {
        if (w.axle === 'rear') w.brakeTorque += this.handbrake * b.handbrakeTorque;
      }
    }

    // 牵引力控制：驱动轮打滑就收油
    this.tcActive = false;
    if (this.tcEnabled) {
      for (const w of this.wheels) {
        if (w.driveTorque > 20 && w.contact) {
          const excess = w.slipRatio - 0.22;
          if (excess > 0) {
            const cut = clamp(1 - excess * 3.0, 0.15, 1);
            w.driveTorque *= cut;
            w.tcActive = true;
            this.tcActive = true;
          }
        }
      }
    }
  }
}

export { RPM_TO_RAD, RAD_TO_RPM };
