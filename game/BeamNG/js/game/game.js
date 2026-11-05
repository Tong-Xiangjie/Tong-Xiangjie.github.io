// ============================================================================
//  游戏主控：固定步长物理 + 变步长渲染、游戏模式、重放、设置
//  · 物理固定 1/300 s × 4 子步 = 60 Hz 物理帧；渲染帧率再高也不会改变手感，
//    掉帧时最多补 3 帧，避免"死亡螺旋"
//  · 记录每个物理帧的节点位置就是完整重放（软体是纯确定性状态机）
// ============================================================================
import * as THREE from '../../vendor/three.module.js';
import { SceneView } from '../render/scene.js';
import { VehicleView } from '../render/bodyMesh.js';
import { Effects } from '../render/effects.js';
import { StreetLights, CarLights, PlaneLights } from '../render/lights.js';
import { Plane } from './plane.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CAR_PRESETS } from '../vehicle/spec.js';
import { GameWorld } from './world.js';
import { ChaseCamera, CAMERA_LABELS } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameAudio } from '../audio/audio.js';

export const PHYS_DT = 1 / 300;
export const SUBSTEPS = 4;
export const MAX_CATCHUP = 3;
export const REPLAY_SECONDS = 12;
const REPLAY_STRIDE = 3;                       // 每 3 个物理帧记一帧（20 Hz）

export const GAME_MODES = [
  { id: 'free', name: '自由驾驶', desc: '没有目标，随便开、随便撞' },
  { id: 'crash', name: '碰撞试验', desc: '加速撞向混凝土墙，看溃缩与 g 值' },
  { id: 'drag', name: '直线加速', desc: '0-100 km/h 计时赛' },
  { id: 'track', name: '环形赛道', desc: '跑完一圈，记录最快圈速' },
];

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.view = new SceneView(canvas, { quality: opts.quality ?? 'high' });
    this.scene = this.view.scene;
    this.camera = this.view.camera;

    this.world = new GameWorld(this.scene, { seed: opts.seed ?? 20261105 });
    this.input = new Input();
    this.camera3p = new ChaseCamera(this.camera, canvas);
    this.effects = new Effects(this.scene, { budget: 1 });
    this.hud = new Hud();
    this.audio = new GameAudio();

    this.preset = opts.preset ?? 'sedan';
    this.vehicle = this._makeVehicle(this.preset);
    this.view3d = new VehicleView(this.vehicle, { paint: opts.paint ?? 0xb4232b });
    this.scene.add(this.view3d.group);
    if (this.view?.q?.iterations) this.vehicle.body.iterations = this.view.q.iterations;

    // 天上那架飞机：默认停在跑道上等玩家上机，也可以交给电脑开
    this.plane = new Plane(this.world.world, { rng: opts.rng });
    this.scene.add(this.plane.group);
    this.planeMode = 'drive';
    this.flying = false;
    this.vehicleMode = 'car';
    this._pctrl = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brake: false };

    // --- 灯光：路灯 + 车灯 + 飞机灯 ---------------------------------------
    // night 由太阳高度算（SceneView.nightFactor），'auto' 时夜里自动开。
    this.lightsMode = 'auto';          // 'auto' | 'on' | 'off'
    this.night = 0;
    this.streetLights = new StreetLights(this.scene, this.world);
    this.streetLights.addColliders(this.world);
    this.carLights = new CarLights(this.scene, this.view3d);
    this.planeLights = new PlaneLights(this.plane);

    this.mode = 'free';
    this.modeLabel = '自由驾驶';
    this.timer = 0;
    this.best = null;
    this.running = true;
    this.paused = false;
    this.frameCount = 0;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsN = 0;
    this._acc = 0;
    this.physicsMs = 0;
    this._last = 0;
    this.impactCooldown = 0;
    this.prevNodeVel = new Float64Array(this.vehicle.body.nodeCount);
    this.replay = { frames: [], max: Math.round(REPLAY_SECONDS * 60 / REPLAY_STRIDE), head: 0, count: 0, playing: false };
    this.stats = { topSpeed: 0, distance: 0, maxG: 0, crashes: 0, airTime: 0 };
    this._started = false;
    this.camera3p.snap(this.vehicle, this.world.terrain);
    this.view.follow(this.vehicle.position);
  }

  /**
   * 电脑飞机：'ai'（天上巡航，会俯冲扑你）| 'parked'（停在跑道上当景物）| 'off'。
   * 'drive' 是旧设置里的值，等价于 parked。
   */
  setPlaneMode(mode) {
    if (mode === 'drive') mode = 'parked';
    this.planeMode = mode;
    if (!this.plane) return;
    if (mode === 'off') { this.plane.setEnabled(false); return; }
    this.plane.setEnabled(true);
    if (this.vehicleMode === 'plane') return;    // 玩家正在开，别去动它
    this.plane._setMode(mode === 'ai' ? 'ai' : 'parked');
  }

  /**
   * 载具模式：'car' | 'plane'。两者是**并列**的，同一时间只玩一个 ——
   * 开飞机的时候汽车的油门/转向被屏蔽（只剩手刹，停在一边），
   * 开车的时候飞机是景物或者由电脑驾驶，不能再"下车走过去上机"。
   */
  setVehicleMode(mode) {
    const plane = this.plane;
    if (!plane) return;
    this.vehicleMode = mode;
    if (mode === 'plane') {
      plane.setEnabled(true);
      plane._setMode('player');      // 坠毁了会重新给一架，停回跑道头
      this.flying = true;
      this.camera3p.setMode('chase');
      this.camera3p.snap(plane);
      this.view.follow(plane.position);
      // 汽车挪到场坪边上停着，别挡在跑道上
      this.vehicle.resetAt(this.world.world, 26, -26, 0.6);
      this.hud.toast('飞机模式 · W 加油门滑跑起飞 · ↑↓ 俯仰 · A/D 滚转 · ←→ 方向舵 · R 拉平', 6);
    } else {
      this.flying = false;
      plane._setMode(this.planeMode === 'ai' ? 'ai' : 'parked');
      this.camera3p.setMode('chase');
      this.camera3p.snap(this.vehicle, this.world.terrain);
      this.hud.toast('汽车模式 · 菜单里可以切回飞机', 2.5);
    }
    this.effects.clear();
    this.input?.clear?.();
  }

  /** 灯光：'auto'（夜里自动开）| 'on' | 'off'。 */
  setLightsMode(mode) {
    this.lightsMode = mode;
    const label = mode === 'on' ? '车灯常开' : mode === 'off' ? '车灯关闭' : '车灯自动（夜间亮）';
    this.hud.toast(label, 2);
  }

  nextLightsMode() {
    this.setLightsMode(this.lightsMode === 'auto' ? 'on' : this.lightsMode === 'on' ? 'off' : 'auto');
  }

  /** 载具状态文字，给菜单里那行"状态"用。 */
  planeStatusText() {
    if (!this.plane || !this.planeOn) return '已关闭';
    if (this.flying) return `你驾驶 · ${this.plane.statusText()}`;
    const p = this.plane.pos;
    const v = this.vehicle.position;
    const d = Math.hypot(p.x - v.x, p.z - v.z);
    if (!this.plane.alive) return this.plane.burning ? '已坠毁 · 燃烧中' : '已坠毁';
    if (this.plane.mode === 'parked') return `停在跑道上 · 距你 ${d.toFixed(0)} m`;
    const phase = this.plane.state === 2 ? '俯冲中' : '电脑巡航';
    return `${phase} · ${p.y.toFixed(0)} m · 距你 ${d.toFixed(0)} m`;
  }

  get planeOn() { return this.plane ? this.plane.enabled : false; }

  _makeVehicle(preset) {
    const spec = CAR_PRESETS[preset] ?? CAR_PRESETS.sedan;
    const v = new Vehicle(spec, { subdivision: 2 });
    v.resetAt(this.world.world, 0, 4, 0);
    v.fuel01 = 1;
    return v;
  }

  // -------------------------------------------------------------------------
  async start() {
    this._started = true;
    this._last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this._tick(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.hud.toast('按 W 前进 · C 切换视角 · R 重置车辆', 5);
  }

  // -------------------------------------------------------------------------
  _tick(now) {
    const dtReal = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    this._fpsAcc += dtReal; this._fpsN++;
    if (this._fpsAcc > 0.4) {
      this.fps = this._fpsN / this._fpsAcc;
      this._fpsAcc = 0; this._fpsN = 0;
    }

    // 输入（用物理帧的 dt 推进方向盘，保证手感与帧率无关）
    const ctrl = this.input.update(dtReal, this.vehicle.speed);
    if (this.input.actions.camera) {
      const m = this.camera3p.nextMode();
      this.hud.toast(`视角：${CAMERA_LABELS[m]}`);
    }
    if (this.input.actions.lights) this.nextLightsMode();
    if (this.input.actions.reset) {
      if (this.flying) {
        // 飞机上按 R 就地拉平：翻过来/失速掉高度时救命用
        this.plane.recover();
        this.hud.toast('姿态已拉平', 2);
      } else this.resetVehicle();
    }
    if (this.input.actions.respawn) this.respawn();
    // 开飞机的时候汽车不许被开走：油门/转向/挡位全部摁住，只留手刹。
    // （两者是并列的载具，不能同时能玩。）
    if (this.vehicleMode === 'plane') {
      ctrl.throttle = 0; ctrl.brake = 1; ctrl.steer = 0;
      ctrl.handbrake = 1; ctrl.clutch = undefined; ctrl.selectGear = null;
      ctrl.gearMode = 'auto';
    }

    if (!this.paused) {
      this._acc += dtReal;
      let steps = 0;
      const maxSteps = MAX_CATCHUP;
      const t0 = performance.now();
      while (this._acc >= PHYS_DT * SUBSTEPS && steps < maxSteps) {
        this._physicsFrame(ctrl);
        this._acc -= PHYS_DT * SUBSTEPS;
        steps++;
      }
      if (steps === maxSteps) this._acc = 0;
      // 真实 CPU 耗时（每个物理帧），HUD/画质档位都靠它做依据
      if (steps > 0) {
        const ms = (performance.now() - t0) / steps;
        this.physicsMs += (ms - this.physicsMs) * 0.08;
      }
    }

    // 渲染同步
    this.view3d.update();
    const flyTarget = this.flying ? this.plane : this.vehicle;
    this.camera3p.update(dtReal, flyTarget, { airborne: flyTarget.airborne });
    this.view.follow(flyTarget.position);
    this.world.update(this.camera.position);
    if (this.plane) {
      const pctrl = (!this.paused && this.flying) ? this.input.planeControls(this._pctrl) : null;
      this.plane.update(this.paused ? 0 : dtReal, this.vehicle, this.effects, pctrl);
      if (this.plane._justCrashed) {
        this.plane._justCrashed = false;
        // 炸在车旁边就把车掀一下，顺便提示一句
        const hit = this.plane.blast(this.vehicle);
        if (this.flying) this.hud.toast('坠毁！', 4);
        else this.hud.toast(hit > 0 ? '飞机坠毁 —— 冲击波把你掀了' : '飞机坠毁起火', 4);
      }
    }
    this.effects.update(dtReal, this.vehicle, this.world.world);

    // --- 灯光 -------------------------------------------------------------
    // night 来自太阳高度；'on' 强制全亮（白天也能看灯），'off' 全关。
    const nf = this.view.nightFactor ?? 0;
    this.night = this.lightsMode === 'on' ? 1 : this.lightsMode === 'off' ? 0 : nf;
    this.streetLights.update(dtReal, this.camera.position, this.night);
    this.carLights.update(dtReal, this.vehicle, this.night, this.vehicleMode === 'car');
    this.planeLights.update(dtReal, this.plane.enabled ? this.night : 0);

    this.audio.update(dtReal, this._audioState());
    this.hud.update(dtReal, {
      vehicle: this.vehicle, game: this, camera: this.camera3p,
      cameraLabel: CAMERA_LABELS[this.camera3p.mode], fps: this.fps,
      plane: this.flying ? this.plane : null,
    });
    this.view.render();
  }

  /** 一个物理帧 = SUBSTEPS 个子步。 */
  _physicsFrame(ctrl) {
    const v = this.vehicle;
    const b = v.body;
    const w = this.world.world;
    for (let s = 0; s < SUBSTEPS; s++) {
      b.clearForces();
      v.update(PHYS_DT, w, ctrl);
      b.step(PHYS_DT, w);
    }
    this.frameCount++;
    this._tickMode(PHYS_DT * SUBSTEPS);
    this._detectImpacts();
    if (!this.paused) this._recordReplay();
  }

  // --- 碰撞 → 特效 + 声音 + 震动 ------------------------------------------
  _detectImpacts() {
    const v = this.vehicle, b = v.body;
    const prev = this.prevNodeVel;
    let peak = 0, px = 0, py = 0, pz = 0;
    const n = b.nodeCount;
    for (let i = 0; i < n; i++) {
      const vx = b.vx[i], vy = b.vy[i], vz = b.vz[i];
      const dv = Math.hypot(vx - prev[i * 3], vy - prev[i * 3 + 1], vz - prev[i * 3 + 2]);
      prev[i * 3] = vx; prev[i * 3 + 1] = vy; prev[i * 3 + 2] = vz;
      if (dv > peak) { peak = dv; px = b.px[i]; py = b.py[i]; pz = b.pz[i]; }
    }
    this.impactCooldown -= PHYS_DT * SUBSTEPS;
    // 40 m/s 的速度突变 ≈ 完全撞毁
    const strength = Math.min(1, peak / 26);
    if (strength > 0.06 && this.impactCooldown <= 0) {
      this.impactCooldown = 0.10;
      this.effects.impact(px, py, pz, strength, null);
      this.audio.impact(strength, strength > 0.5 ? 'metal' : 'plastic');
      this.camera3p.addShake(strength * 0.8);
      if (strength > 0.35) {
        this.stats.crashes++;
        this.hud.toast(`碰撞！峰值 ${(v.maxImpactG * 1).toFixed(0)} g`, 1.6);
      } else if (strength > 0.12) {
        this.camera3p.addShake(strength * 0.5);
      }
    }
    this.stats.maxG = Math.max(this.stats.maxG, v.gForce.length() / 9.81);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, v.speedKmh);
    this.stats.distance += Math.abs(v.speed) * PHYS_DT * SUBSTEPS;
    if (v.airborne) this.stats.airTime += PHYS_DT * SUBSTEPS;
  }

  // --- 游戏模式 -----------------------------------------------------------
  _tickMode(dt) {
    const v = this.vehicle;
    switch (this.mode) {
      case 'crash': {
        // 自由推进，撞到墙后统计
        const dz = v.position.z - this.world.crashWall.center.z;
        if (dz < 4 && this.timer === 0 && Math.abs(v.speed) < 2 && v.time > 3) {
          this._finishCrash();
        }
        this.timer += dt;
        if (this.timer > 20) this._finishCrash();
        break;
      }
      case 'drag': {
        if (v.speedKmh > 0.5 && this.dragStart == null) this.dragStart = v.time;
        this.timer = this.dragStart != null ? v.time - this.dragStart : 0;
        if (v.speedKmh >= 100 && this.drag100 == null) {
          this.drag100 = this.timer;
          this.best = this.best == null ? this.drag100 : Math.min(this.best, this.drag100);
          this.hud.showResult('0-100 km/h', [
            ['本次用时', `${this.drag100.toFixed(2)} s`],
            ['历史最好', `${this.best.toFixed(2)} s`],
            ['最高车速', `${this.stats.topSpeed.toFixed(0)} km/h`],
          ]);
          this.hud.toast(`0-100 km/h：${this.drag100.toFixed(2)} 秒`, 4);
        }
        break;
      }
      case 'track': {
        this.timer += dt;
        break;
      }
      default: break;
    }
  }

  _finishCrash() {
    const v = this.vehicle;
    const t = v.telemetry();
    this.hud.showResult('碰撞试验结果', [
      ['峰值减速', `${this.stats.maxG.toFixed(1)} g`],
      ['车头平均形变', `${(t.deformation * 100).toFixed(1)} cm`],
      ['最大形变', `${(v.maxDeformation * 100).toFixed(1)} cm`],
      ['断梁', `${v.body.stats.brokenBeams} / ${v.body.beamCount}`],
      ['掉轮', String(v.wheels.filter((w) => w.detached).length)],
      ['整车完好度', `${(t.integrity * 100).toFixed(0)}%`],
    ]);
    this.timer = 0;
    this.mode = 'free';
    this.modeLabel = '自由驾驶';
  }

  // --- 重放 ---------------------------------------------------------------
  _recordReplay() {
    const r = this.replay;
    if (r.playing) return;
    if (this.frameCount % REPLAY_STRIDE !== 0) return;
    const b = this.vehicle.body;
    const n = b.nodeCount;
    if (!r.buffer) {
      r.buffer = new Float32Array(r.max * n * 3);
      r.meta = new Float32Array(r.max * 4);
    }
    const slot = r.head;
    const off = slot * n * 3;
    const buf = r.buffer;
    for (let i = 0; i < n; i++) {
      buf[off + i * 3] = b.px[i];
      buf[off + i * 3 + 1] = b.py[i];
      buf[off + i * 3 + 2] = b.pz[i];
    }
    r.meta[slot * 4] = this.vehicle.position.x;
    r.meta[slot * 4 + 1] = this.vehicle.position.y;
    r.meta[slot * 4 + 2] = this.vehicle.position.z;
    r.meta[slot * 4 + 3] = this.vehicle.speedKmh;
    r.head = (r.head + 1) % r.max;
    if (r.count < r.max) r.count++;
  }

  /** 回放最近若干秒（暂停物理，只播几何）。 */
  playReplay() {
    const r = this.replay;
    if (!r.buffer || r.count < 4) { this.hud.toast('还没有足够的数据可以回放'); return; }
    this.paused = true;
    this.hud.toast('回放中… 再按一次 P 返回', 3);
    const n = this.vehicle.body.nodeCount;
    const total = r.count;
    let i = 0;
    const stepMs = 1000 / 20;
    const t0 = performance.now();
    const timer = setInterval(() => {
      if (!this.paused || !this.running) { clearInterval(timer); this.paused = false; return; }
      const elapsed = performance.now() - t0;
      i = Math.min(total - 1, Math.floor(elapsed / stepMs));
      const slot = (r.head - total + i + r.max * 2) % r.max;
      const off = slot * n * 3;
      const b = this.vehicle.body;
      for (let k = 0; k < n; k++) {
        b.px[k] = r.buffer[off + k * 3];
        b.py[k] = r.buffer[off + k * 3 + 1];
        b.pz[k] = r.buffer[off + k * 3 + 2];
      }
      b.centroid(this.vehicle.allNodes, this.vehicle.frame.pos);
      this.view3d.update();
      this.camera3p.update(0.05, this.vehicle, {});
      this.view.render();
      if (i >= total - 1) setTimeout(() => { clearInterval(timer); this.paused = false; }, 500);
    }, stepMs);
  }

  // --- 操作 ---------------------------------------------------------------
  resetVehicle() {
    // frame 里没有 yaw，从车头方向反算（yaw=0 时车头朝 -Z）
    const f = this.vehicle.frame.fwd;
    const yaw = Math.atan2(-f.x, -f.z);
    const p = this.vehicle.position;
    this.vehicle.resetAt(this.world.world, p.x, p.z, yaw, 0.25);
    this.camera3p.snap(this.vehicle, this.world.terrain);
    this.effects.clear();
    this.prevNodeVel.fill(0);
    this.audio.impact(0.2, 'plastic');
    this.hud.toast('车辆已重置');
  }

  respawn() {
    if (this.vehicleMode === 'plane') {
      // 飞机模式：回到跑道头重新起飞
      this.plane._park();
      this.plane.mode = 'player';
      this.camera3p.snap(this.plane, this.world.terrain);
      this.effects.clear();
      this.hud.toast('飞机已回到跑道头');
      return;
    }
    this.vehicle.resetAt(this.world.world, 0, 4, 0);
    this.camera3p.snap(this.vehicle, this.world.terrain);
    this.effects.clear();
    this.hud.hideResult();
    this.stats.maxG = 0;
    this.hud.toast('回到出生点');
  }

  setMode(id) {
    this.mode = id;
    const m = GAME_MODES.find((x) => x.id === id);
    this.modeLabel = m ? m.name : id;
    this.timer = 0;
    this.hud.hideResult();
    this.stats.maxG = 0;
    this.dragStart = null; this.drag100 = null;
    const w = this.world;
    if (id === 'crash') {
      this.placeVehicle(0, 90, 0);
      this.hud.toast('全油门冲向混凝土墙（约 200 m 助跑）', 3.4);
    } else if (id === 'drag') {
      this.placeVehicle(0, 130, 0);
      this.hud.toast('0-100 km/h 计时：地板油起步', 3.4);
    } else if (id === 'track') {
      this.placeVehicle(0, 200, Math.PI);
      this.hud.toast('环形赛道：绕一圈回到起点', 3.4);
    } else {
      this.placeVehicle(0, 4, 0);
      this.hud.toast('自由驾驶：随便开', 2.4);
    }
    void w;
  }

  placeVehicle(x, z, yaw) {
    this.vehicle.resetAt(this.world.world, x, z, yaw, 0.2);
    this.camera3p.snap(this.vehicle, this.world.terrain);
    this.effects.clear();
  }

  setVehicle(preset, paint) {
    this.scene.remove(this.view3d.group);
    this.view3d.dispose();
    this.preset = preset;
    this.vehicle = this._makeVehicle(preset);
    if (this.view?.q?.iterations) this.vehicle.body.iterations = this.view.q.iterations;
    this.view3d = new VehicleView(this.vehicle, { paint: paint ?? this.paint });
    this.scene.add(this.view3d.group);
    this.prevNodeVel = new Float64Array(this.vehicle.body.nodeCount);
    this.setMode(this.mode);
  }

  setQuality(name) {
    this.view.setQuality(name);
    this.world.setViewDistance(this.view.q.viewDistance);
    this.effects.setBudget(name === 'low' ? 0.35 : name === 'ultra' ? 1.8 : 1);
    // 低画质把"真实灯光"（点光/聚光）关掉，只留自发光和地面光池
    const real = name !== 'low';
    if (this.streetLights) this.streetLights.realEnabled = real;
    if (this.carLights) this.carLights.realEnabled = real;
    if (this.planeLights) this.planeLights.realEnabled = real;
    // 物理质量也跟着档位走：梁的迭代次数直接决定车体刚度的手感与耗时
    const it = this.view.q.iterations ?? 10;
    if (this.vehicle?.body) this.vehicle.body.iterations = it;
    this.physicsIterations = it;
  }

  setTimeOfDay(t) { this.view.setTimeOfDay(t); }

  _audioState() {
    const v = this.vehicle;
    const d = v.drivetrain;
    let slip = 0, lat = 0;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      slip = Math.max(slip, Math.min(1, Math.abs(w.slipRatio)));
      lat = Math.max(lat, Math.min(1, Math.abs(Math.tan(w.slipAngle))));
    }
    const mat = v.wheels.find((w) => w.surfaceMaterial)?.surfaceMaterial;
    return {
      rpm: d.rpm, redline: v.spec.engine.redline ?? 6800, idleRpm: v.spec.engine.idleRpm ?? 760,
      throttle: d.throttle, load: d.throttle, speed: Math.abs(v.speed), gear: d.gear,
      shifting: d.shiftTimer > 0, wheelSlip: slip, lateralSlip: lat,
      surface: mat ? mat.name : 'asphalt', airborne: v.airborne,
      damaged: v.telemetry().damage, handbrake: d.handbrake, brake: d.brakeInput,
    };
  }

  dispose() {
    this.running = false;
    this.input.dispose();
    this.camera3p.dispose();
    this.view3d.dispose();
    this.effects.dispose();
    this.streetLights?.dispose();
    this.carLights?.dispose();
    this.planeLights?.dispose();
    this.plane?.dispose();
    this.world.dispose();
    this.view.dispose();
    this.audio.dispose();
  }
}

void THREE;
