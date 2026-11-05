// ============================================================================
//  摄像机：跟车 / 车头视角 / 引擎盖 / 自由环绕 / 电影运镜
//  · 跟车用"弹簧阻尼"而不是硬跟随，并带一点速度前瞻，高速时视野更宽
//  · 碰撞会让摄像机抖一下（真实车载摄像头也会被撞得晃）
// ============================================================================
import * as THREE from '../../vendor/three.module.js';

export const CAMERA_MODES = ['chase', 'cockpit', 'hood', 'orbit', 'cinematic', 'crash'];
export const CAMERA_LABELS = {
  chase: '跟车', cockpit: '车内', hood: '引擎盖', orbit: '自由', cinematic: '电影', crash: '撞车',
};

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class ChaseCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 4, 10);
    this.look = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.shake = 0;
    this.orbitYaw = 0.5;
    this.orbitPitch = 0.32;
    this.orbitDist = 9;
    this.cinematicT = 0;
    this.fovBase = 62;
    this._bindMouse();
  }

  _bindMouse() {
    if (typeof this.dom === 'undefined' || !this.dom) return;
    let dragging = false;
    let lx = 0, ly = 0;
    this._onDown = (e) => {
      if (this.mode !== 'orbit') return;
      dragging = true; lx = e.clientX; ly = e.clientY;
      this.dom.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!dragging) return;
      this.orbitYaw -= (e.clientX - lx) * 0.008;
      this.orbitPitch = Math.max(-0.4, Math.min(1.35, this.orbitPitch + (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
    };
    this._onUp = () => { dragging = false; };
    this._onWheel = (e) => {
      if (this.mode !== 'orbit') return;
      e.preventDefault();
      this.orbitDist = Math.max(2.5, Math.min(60, this.orbitDist * (1 + Math.sign(e.deltaY) * 0.12)));
    };
    this.dom.addEventListener('pointerdown', this._onDown);
    this.dom.addEventListener('pointermove', this._onMove);
    this.dom.addEventListener('pointerup', this._onUp);
    this.dom.addEventListener('pointercancel', this._onUp);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'cinematic') this.cinematicT = 0;
  }

  nextMode() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  /** 撞击时调用：strength 0..1。 */
  addShake(strength) {
    this.shake = Math.min(1.4, this.shake + strength);
  }

  /** 立即贴到目标位置（重置/传送时用，避免镜头飞过去）。 */
  snap(vehicle, terrain) {
    const f = vehicle.frame;
    this.pos.copy(f.pos).addScaledVector(f.fwd, -7.5).addScaledVector(f.up, 3.0);
    this.look.copy(f.pos);
    void terrain;
  }

  /**
   * @param {number} dt
   * @param {object} vehicle
   * @param {object} opts { speedKmh, airborne }
   */
  update(dt, vehicle, opts = {}) {
    const cam = this.camera;
    const f = vehicle.frame;
    const pos = f.pos;
    const speed = Math.abs(vehicle.speed ?? 0);
    this.shake = Math.max(0, this.shake - dt * 2.4);

    // 速度越快视野越广（用平滑避免抖）
    const fovTarget = this.fovBase + Math.min(24, speed * 0.42);
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 2.2);
    cam.updateProjectionMatrix();

    if (this.mode === 'cockpit' || this.mode === 'hood') {
      // 刚性跟随车体（车体变形时视角会跟着晃，这正是想要的效果）
      const seat = this.mode === 'cockpit' ? vehicle.cockpitPoint : vehicle.hoodPoint;
      _p.set(seat.x, seat.y, seat.z);
      const right = f.right, up = f.up, fwd = f.fwd;
      const wx = pos.x + right.x * _p.x + up.x * _p.y + fwd.x * _p.z;
      const wy = pos.y + right.y * _p.x + up.y * _p.y + fwd.y * _p.z;
      const wz = pos.z + right.z * _p.x + up.z * _p.y + fwd.z * _p.z;
      this.pos.lerp(_p.set(wx, wy, wz), Math.min(1, dt * 26));
      cam.position.copy(this.pos);
      // 看向车头前方一点
      void _q; void _m;
      const ahead = new THREE.Vector3(
        pos.x + fwd.x * 22 + right.x * this.steerBias(vehicle),
        pos.y + fwd.y * 22 + up.y * 0.6,
        pos.z + fwd.z * 22 + right.z * this.steerBias(vehicle),
      );
      this.look.lerp(ahead, Math.min(1, dt * 9));
      cam.up.copy(up);
      cam.lookAt(this.look);
      this._applyShake(dt);
      return;
    }

    if (this.mode === 'orbit') {
      const d = this.orbitDist;
      const cp = Math.cos(this.orbitPitch), sp = Math.sin(this.orbitPitch);
      _p.set(pos.x + Math.sin(this.orbitYaw) * cp * d, pos.y + sp * d + 1.0, pos.z + Math.cos(this.orbitYaw) * cp * d);
      this.pos.lerp(_p, Math.min(1, dt * 8));
      cam.position.copy(this.pos);
      this.look.lerp(pos, Math.min(1, dt * 8));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      return;
    }

    if (this.mode === 'cinematic') {
      this.cinematicT += dt * 0.22;
      const r = 9 + Math.sin(this.cinematicT * 0.7) * 3.5;
      const h = 2.2 + Math.sin(this.cinematicT * 0.43) * 1.6;
      _p.set(pos.x + Math.cos(this.cinematicT) * r, pos.y + h, pos.z + Math.sin(this.cinematicT) * r);
      this.pos.lerp(_p, Math.min(1, dt * 2.6));
      cam.position.copy(this.pos);
      this.look.lerp(pos, Math.min(1, dt * 3.2));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      return;
    }

    // --- chase / crash：弹簧跟随 ----------------------------------------
    const dist = 6.6 + Math.min(3.4, speed * 0.09);
    const height = 2.55 + Math.min(1.1, speed * 0.02);
    const back = -dist - (opts.airborne ? 1.5 : 0);
    _p.set(pos.x + f.fwd.x * back, pos.y + height, pos.z + f.fwd.z * back);
    // 临界阻尼弹簧
    const k = this.mode === 'crash' ? 48 : 74;
    const damp = 2 * Math.sqrt(k) * 0.92;
    const ax = (_p.x - this.pos.x) * k - this.vel.x * damp;
    const ay = (_p.y - this.pos.y) * k - this.vel.y * damp;
    const az = (_p.z - this.pos.z) * k - this.vel.z * damp;
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
    // 别钻到地下
    cam.position.copy(this.pos);
    this._clampAboveGround(vehicle);
    const lead = 5.5;
    _p.set(pos.x + f.fwd.x * lead, pos.y + 0.85, pos.z + f.fwd.z * lead);
    this.look.lerp(_p, Math.min(1, dt * (this.mode === 'crash' ? 3 : 11)));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (this.mode === 'crash') cam.up.copy(f.up);
    this._applyShake(dt);
  }

  _clampAboveGround(vehicle) {
    const w = vehicle.world;
    if (!w || !w.terrain) return;
    const h = w.terrain.height(this.pos.x, this.pos.z) + 1.15;
    if (this.pos.y < h) { this.pos.y = h; this.vel.y = Math.max(0, this.vel.y); }
  }

  steerBias(vehicle) {
    return (vehicle.steerAngle ?? 0) * 12;
  }

  _applyShake(dt) {
    if (this.shake <= 0.001) return;
    const a = this.shake * this.shake * 0.42;
    const t = performance.now() * 0.001;
    this.camera.position.x += Math.sin(t * 61.3) * a;
    this.camera.position.y += Math.sin(t * 47.7) * a * 0.8;
    this.camera.position.z += Math.sin(t * 53.1) * a;
    void dt;
  }

  dispose() {
    if (!this.dom) return;
    this.dom.removeEventListener('pointerdown', this._onDown);
    this.dom.removeEventListener('pointermove', this._onMove);
    this.dom.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('pointercancel', this._onUp);
    this.dom.removeEventListener('wheel', this._onWheel);
  }
}
