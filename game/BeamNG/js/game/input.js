// ============================================================================
//  输入：键盘 + 手柄 → 统一的控制对象
//  · 转向不是"按键即全舵"：有转向速率上限，且最大舵角随车速收窄，
//    这样高速时方向盘不会一抠就甩头（真实车辆就是这样标定的）
//  · 提供 justPressed 集合给"一次性"操作（重置、换视角、换挡）
// ============================================================================

export const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  clutchKey: ['ShiftLeft', 'ShiftRight'],
  cameraKey: ['KeyC'],
  resetKey: ['KeyR'],
  slowKey: ['ControlLeft'],
  hornKey: ['KeyH'],
  respawnKey: ['KeyT'],
};

export const DEFAULT_SETTINGS = {
  steerRate: 3.6,            // rad/s，方向盘打满的速度
  steerReturn: 5.0,          // 松手回正速度
  maxSteerLow: 0.60,         // 低速最大舵角（rad，约 34°）
  maxSteerHigh: 0.13,        // 高速最大舵角（rad，约 7.5°）
  steerSpeedRef: 42,         // m/s，舵角收窄的速度尺度
  keyboardSteerRate: 5.5,    // 键盘等效的打舵速度倍率
  invertY: false,
};

export class Input {
  constructor(settings = DEFAULT_SETTINGS) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.keys = new Set();
    this.pressed = new Set();
    this.steerState = 0;
    this.controls = {
      throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: undefined,
      gearMode: 'auto', selectGear: null,
    };
    this.actions = { reset: false, camera: false, horn: false, respawn: false };
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this.analogSteer = 0;
    this.analogThrottle = 0;
    this.analogBrake = 0;
    this._bind();
  }

  _bind() {
    if (typeof window === 'undefined') return;
    this._onDown = (e) => {
      if (e.repeat) return;
      // 空白键会滚动页面
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
    };
    this._onUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => { this.keys.clear(); };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  any(codes) { for (const c of codes) if (this.keys.has(c)) return true; return false; }
  anyPressed(codes) { for (const c of codes) if (this.pressed.has(c)) return true; return false; }

  /** 手柄：左摇杆转向、扳机油门/刹车，A 手刹，X 重置，Y 视角。 */
  _pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    let pad = null;
    for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    if (!pad) { this.usingGamepad = false; return false; }
    this.gamepadIndex = pad.index;
    const ax = pad.axes[0] ?? 0;
    const rz = pad.axes[2] ?? 0;
    const dead = (v) => (Math.abs(v) < 0.09 ? 0 : v);
    this.analogSteer = dead(ax);
    // 有些手柄用 Z 轴当油门/刹车
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    this.analogThrottle = Math.max(rt, Math.max(0, -rz));
    this.analogBrake = Math.max(lt, Math.max(0, rz > 0 ? 0 : 0));
    const btn = (i) => !!pad.buttons[i]?.pressed;
    const pressed = this.pressed;
    if (btn(0)) pressed.add('PadHandbrake');
    if (btn(2)) pressed.add('PadReset');
    if (btn(3)) pressed.add('PadCamera');
    if (btn(1)) pressed.add('PadHorn');
    this.padThrottle = this.analogThrottle;
    this.padBrake = this.analogBrake;
    const active = Math.abs(this.analogSteer) > 0 || rt > 0.05 || lt > 0.05 || btn(0) || btn(2) || btn(3);
    this.usingGamepad = active || this.usingGamepad;
    return active;
  }

  /**
   * 每帧更新控制对象。
   * @param {number} dt
   * @param {number} speed 车体纵向速度（m/s），决定最大舵角
   */
  update(dt, speed = 0) {
    const s = this.settings;
    const c = this.controls;
    const padActive = this._pollGamepad();

    const kUp = this.any(KEYMAP.forward);
    const kDown = this.any(KEYMAP.back);
    const kLeft = this.any(KEYMAP.left);
    const kRight = this.any(KEYMAP.right);

    if (padActive || (this.usingGamepad && !kUp && !kDown && !kLeft && !kRight)) {
      c.throttle = this.padThrottle ?? 0;
      c.brake = this.padBrake ?? 0;
      c.handbrake = this.any(KEYMAP.handbrake) || this.pressed.has('PadHandbrake') ? 1 : 0;
      this._steerTarget = this.analogSteer;
    } else {
      c.throttle = kUp ? 1 : 0;
      c.brake = kDown ? 1 : 0;
      c.handbrake = this.any(KEYMAP.handbrake) ? 1 : 0;
      this._steerTarget = (kLeft ? -1 : 0) + (kRight ? 1 : 0);
    }

    // 转向：最大舵角随速度收窄，再按速率逼近目标
    const sp = Math.abs(speed);
    const maxSteer = s.maxSteerHigh + (s.maxSteerLow - s.maxSteerHigh) / (1 + (sp / s.steerSpeedRef) ** 2);
    const target = this._steerTarget * maxSteer;
    const rate = (this._steerTarget === 0 ? s.steerReturn : s.steerRate) *
      (this.usingGamepad ? 1.6 : s.keyboardSteerRate);
    if (this.steerState < target) this.steerState = Math.min(target, this.steerState + rate * dt);
    else this.steerState = Math.max(target, this.steerState - rate * dt);
    // 输入 steer: -1 左 / +1 右；物理内部 steerAngle 正 = 左
    c.steer = maxSteer > 1e-5 ? this.steerState / maxSteer : 0;

    c.clutch = this.any(KEYMAP.clutchKey) ? 0 : undefined;
    // 选挡是"一次性"指令：必须每帧清空。留在控制对象里的话，变速箱
    // 每个子步都会收到"挂 1 挡"，于是不停地重新开始换挡——离合器永远
    // 不接合，发动机空转到红线而车只以 10 km/h 爬行。
    c.selectGear = null;

    // 一次性动作
    this.actions.reset = this.anyPressed(KEYMAP.resetKey) || this.pressed.has('PadReset');
    this.actions.camera = this.anyPressed(KEYMAP.cameraKey) || this.pressed.has('PadCamera');
    this.actions.horn = this.any(KEYMAP.hornKey) || this.pressed.has('PadHorn');
    this.actions.respawn = this.anyPressed(KEYMAP.respawnKey);
    this.actions.slow = this.any(KEYMAP.slowKey);
    // 手动换挡（1-6 / 0 空挡 / V 倒挡）
    for (let i = 1; i <= 6; i++) {
      if (this.pressed.has(`Digit${i}`)) { c.gearMode = 'manual'; c.selectGear = i; }
    }
    if (this.pressed.has('Digit0')) { c.gearMode = 'manual'; c.selectGear = 0; }
    if (this.pressed.has('KeyV')) { c.gearMode = 'manual'; c.selectGear = -1; }
    if (this.pressed.has('KeyM')) c.gearMode = c.gearMode === 'auto' ? 'manual' : 'auto';

    this.pressed.clear();
    return c;
  }

  endFrame() { this.pressed.clear(); }

  dispose() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
