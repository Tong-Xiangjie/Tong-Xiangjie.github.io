import * as THREE from '../../vendor/three.module.js';

/**
 * 天上飞的飞机。坠毁后会爆炸、起火，留下着火的残骸。
 *
 * 飞行模型是"航迹自动驾驶"而不是完整六自由度：飞机只维护速度、航迹角
 * （pitch）和坡度（bank），坡度按协调转弯给出转弯角速度 ω = g·tan(bank)/v。
 * 这样飞起来稳定、可预测，也不会像真实六自由度那样调不好就自旋。
 *
 * 行为循环：
 *   cruise —— 绕着地图巡航，保持巡航高度
 *   attack —— 俯冲扑向玩家（或玩家最后的位置），到拉起高度再拉起来
 *   每次俯冲有 chance 的概率"拉不起来"，那就一头扎进地里 —— 爆炸起火
 *   crashed —— 残骸留在撞击点燃烧，火势随时间衰减
 */

const STATE = { CRUISE: 0, ATTACK: 1, CRASHED: 2 };
const G = 9.81;

export const PLANE_STATE_LABEL = { 0: '巡航', 1: '俯冲', 2: '坠毁' };

export class Plane {
  constructor(world, opts = {}) {
    this.world = world;                       // CollisionWorld
    this.group = new THREE.Group();
    this.parts = {};                          // 可拆的部件（用来掰掉机翼）
    this.state = STATE.CRUISE;
    this.cruiseAlt = opts.cruiseAlt ?? 150;
    this.orbitR = opts.orbitR ?? 420;
    this.crashChance = opts.crashChance ?? 0.35;
    this.maxSpeed = opts.maxSpeed ?? 78;
    this.minSpeed = opts.minSpeed ?? 34;
    this.enabled = true;
    this._t = 0;                              // 本状态已持续时间
    this._cool = 14;                          // 距下次俯冲
    this._burn = 0;                           // 剩余燃烧时间
    this._smoke = 0;
    this._impact = null;
    this._light = null;
    this._rng = opts.rng ?? (() => Math.random());

    this._buildMesh();
    this.reset();
  }

  /** 回到"刚起飞"的状态：天上巡航、机翼装好、火灭掉。 */
  reset() {
    // 初始状态：在场坪东北边的高空，机头朝着地图中心飞进来
    this.pos = { x: 260, y: this.cruiseAlt, z: 300 };
    this.heading = Math.atan2(60 - this.pos.z, 0 - this.pos.x);
    this.pitch = 0;
    this.bank = 0;
    this.speed = this.maxSpeed * 0.8;
    this.state = STATE.CRUISE;
    this._t = 0;
    this._cool = 12;
    this._burn = 0;
    this._smoke = 0;
    this._impact = null;
    this._willCrash = false;
    this._forceDive = false;
    this._justCrashed = false;
    this.group.rotation.set(0, 0, 0);
    if (this.parts.wingL) this.parts.wingL.rotation.z = 0;
    if (this.parts.wingR) this.parts.wingR.rotation.z = 0;
    if (this._light) this._light.intensity = 0;
    this._syncMesh();
  }

  // --- 外观 ---------------------------------------------------------------
  /** 机身用几个基本体拼：机身、机翼、平尾、垂尾、发动机、座舱、螺旋桨。 */
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

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 机身：沿 +X 为机头
    const fuse = new THREE.CylinderGeometry(1.05, 0.55, 12.5, 16, 1, false);
    fuse.rotateZ(-Math.PI / 2);
    add(fuse, body, 0, 0, 0);
    // 机头锥
    const nose = new THREE.ConeGeometry(1.05, 2.2, 16);
    nose.rotateZ(-Math.PI / 2);
    add(nose, accent, 7.3, 0, 0);
    // 座舱
    const cab = new THREE.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    add(cab, glass, 3.4, 0.62, 0);

    // 主翼（带一点上反角）
    const wingGeo = new THREE.BoxGeometry(3.4, 0.26, 15.5);
    const wl = add(wingGeo, body, 0.4, -0.1, -7.6);
    const wr = add(wingGeo, body, 0.4, -0.1, 7.6);
    wl.rotation.x = 0.09; wr.rotation.x = -0.09;
    this.parts.wingL = wl; this.parts.wingR = wr;
    // 翼尖小翼
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(1.5, 1.15, 0.2), accent, 0.1, 0.55, s * 15.2);
    }
    // 发动机短舱 + 螺旋桨（每侧一个）
    this.props = [];
    for (const s of [-1, 1]) {
      const nac = new THREE.CylinderGeometry(0.72, 0.62, 2.6, 12);
      nac.rotateZ(-Math.PI / 2);
      add(nac, dark, 2.0, -0.5, s * 4.4);
      const hub = add(new THREE.ConeGeometry(0.3, 0.9, 10), dark, 3.5, -0.5, s * 4.4);
      hub.rotation.z = -Math.PI / 2;
      // 桨叶做成一个薄片组，靠转动它做出旋转感
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

    // 起落架（就一根，聊胜于无）
    add(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), dark, 2.2, -1.3, 0);
    add(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 10), dark, 2.2, -1.9, 0, Math.PI / 2);

    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  }

  // --- 状态切换 -----------------------------------------------------------
  _setState(s) { this.state = s; this._t = 0; }

  /** 让它马上掉下来（菜单按钮/调试用）。 */
  forceCrash() {
    if (this.state === STATE.CRASHED) return;
    this._setState(STATE.ATTACK);
    this._forceDive = true;                   // 不留俯冲表演，直接低头扎下去
    this._cool = 0;
  }

  get alive() { return this.state !== STATE.CRASHED; }
  get burning() { return this._burn > 0; }

  // --- 每帧 ---------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {{position:{x:number,y:number,z:number}}} [vehicle] 玩家车（俯冲目标）
   * @param {import('../render/effects.js').Effects} [effects]
   */
  update(dt, vehicle, effects) {
    if (!this.enabled) return;
    this._effects = effects;
    if (this.state === STATE.CRASHED) {
      this._updateWreck(dt, effects);
      return;
    }
    this._t += dt;
    if (this.state === STATE.CRUISE) this._cruise(dt, vehicle);
    else this._attack(dt, vehicle, effects);
    this._integrate(dt);
    this._spinProps(dt);
    this._syncMesh();
    this._checkImpact(dt, effects);
  }

  /** 巡航：绕圈，过一会儿就找个机会俯冲一次。 */
  _cruise(dt, vehicle) {
    this._cool -= dt;
    const cx = 0, cz = 60;
    // 目标点沿半径 orbitR 的圆走，飞机追这个点 —— 自然就绕圈了
    const a = Math.atan2(this.pos.z - cz, this.pos.x - cx) + 0.010;
    const tx = cx + Math.cos(a) * this.orbitR;
    const tz = cz + Math.sin(a) * this.orbitR;
    this._steerTo(tx, tz, this.cruiseAlt, dt);
    this.speed += (this.maxSpeed * 0.82 - this.speed) * Math.min(1, dt * 0.6);
    if (this._cool <= 0 && vehicle) {
      this._setState(STATE.ATTACK);
      // 每次俯冲有一定概率拉不起来 —— 那就是"坠毁"这件事本身
      this._willCrash = this._rng() < this.crashChance;
      this._cool = 20 + this._rng() * 22;
    }
  }

  /** 俯冲：扑向玩家的位置，到拉起高度再抬头。 */
  _attack(dt, vehicle, effects) {
    // 手动"让它掉下来"：不再绕目标，直接大角度扎进地里
    if (this._forceDive) {
      this.pitch += (-0.72 - this.pitch) * Math.min(1, dt * 2.4);
      this.bank *= Math.max(0, 1 - dt * 2);
      this.speed += (this.maxSpeed * 1.15 - this.speed) * Math.min(1, dt * 0.9);
      return;
    }
    const t = vehicle ? vehicle.position : { x: 0, y: 0, z: 0 };
    // 目标定在车前方一点，等于"从头顶掠过"
    const ahead = 26;
    const tx = t.x, tz = t.z;
    this._steerTo(tx, tz, t.y + 4, dt, 1.7);
    // 机头往目标压下去
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const wantPitch = Math.max(-0.62, Math.min(0.32, Math.atan2(t.y + 8 - this.pos.y, Math.max(6, dist))));
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 1.1);
    this.speed += (this.maxSpeed - this.speed) * Math.min(1, dt * 0.9);

    const groundY = this.world.groundHeight(this.pos.x, this.pos.z);
    const agl = this.pos.y - groundY;
    // 快到地面了：该拉起来了
    if (agl < 34 && this.pitch < -0.05) {
      if (this._willCrash) {
        // "拉不起来"：继续保持俯角，下一帧就撞上
        this.pitch = Math.min(this.pitch, -0.30);
      } else {
        this.pitch += dt * 1.5;                 // 拉起
        if (agl > 26) this._setState(STATE.CRUISE), this._cool = 16 + this._rng() * 20;
      }
    }
    if (this._t > 26) { this._setState(STATE.CRUISE); this._cool = 12; }  // 保险：别一直扑
    void ahead; void effects;
  }

  /** 朝 (tx,tz,alt) 飞：横侧用坡度转弯，纵向用航迹角。 */
  _steerTo(tx, tz, alt, dt, gain = 1) {
    let want = Math.atan2(tz - this.pos.z, tx - this.pos.x);
    let err = want - this.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    // 协调转弯：坡度角给转弯角速度
    const wantBank = Math.max(-0.95, Math.min(0.95, err * 1.8 * gain));
    this.bank += (wantBank - this.bank) * Math.min(1, dt * 1.6);
    const w = (G * Math.tan(this.bank)) / Math.max(8, this.speed);
    this.heading += w * dt;
    // 高度：用航迹角收敛到目标高度
    const dy = alt - this.pos.y;
    const wantPitch = Math.max(-0.35, Math.min(0.35, dy * 0.012 * gain));
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 1.2);
  }

  /** 推进速度与位置。 */
  _integrate(dt) {
    // 推力 - 阻力 - 爬升代价
    const drag = this.speed * this.speed * 0.0016;
    const acc = 9.5 - drag - G * Math.sin(this.pitch);
    this.speed = Math.max(this.minSpeed, Math.min(this.maxSpeed * 1.25, this.speed + acc * dt));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.pos.x += Math.cos(this.heading) * cp * this.speed * dt;
    this.pos.y += sp * this.speed * dt;
    this.pos.z += Math.sin(this.heading) * cp * this.speed * dt;
  }

  _spinProps(dt) {
    const rpm = 26 + this.speed * 0.5;
    for (const p of this.props) p.rotation.x += rpm * dt;
  }

  /** 撞地/撞建筑。 */
  _checkImpact(dt, effects) {
    const groundY = this.world.groundHeight(this.pos.x, this.pos.z);
    let hit = this.pos.y - groundY < 1.4;
    let ny = 1;
    if (!hit) {
      // 撞到静态体（楼、集装箱、桥墩……）。collectContacts 每个接触占 5 个
      // 浮点数：[nx, ny, nz, depth, materialId]
      const out = Plane._contactBuf;
      const n = this.world.collectContacts(this.pos.x, this.pos.y, this.pos.z, 3.2, out, 4);
      if (n > 0) { hit = true; ny = out[1] ?? 1; }
    }
    if (hit) this._crash(ny, effects);
  }

  /** 爆炸 + 起火。 */
  _crash(ny, effects) {
    const sp = this.speed;
    this._setState(STATE.CRASHED);
    this._justCrashed = true;
    this._burn = 46;
    this._smoke = 0;
    // 机头杵进地里：按撞击速度给一个姿态
    const hard = Math.min(1, sp / this.maxSpeed);
    this.group.rotation.x = -0.5 * hard;
    this.group.rotation.z = (this._rng() - 0.5) * 1.2 * hard;
    this.pitch = 0; this.bank = 0;
    // 机翼掰掉一只
    const wing = this._rng() < 0.5 ? this.parts.wingL : this.parts.wingR;
    if (wing) wing.rotation.z = (wing === this.parts.wingL ? 1 : -1) * 1.15;
    this._impact = { x: this.pos.x, y: this.pos.y, z: this.pos.z, power: hard };
    void ny;
    if (effects && effects.enabled) this._explode(effects, hard);
    // 火光：一盏会闪的橙色点光，让燃烧在阴影里也看得见。
    // 撞击这一帧就点亮，不然爆炸的瞬间是黑的。
    if (!this._light) {
      const l = new THREE.PointLight(0xff7a22, 0, 60, 2);
      this.group.add(l);
      this._light = l;
    }
    this._light.intensity = 22 * (0.5 + 0.5 * hard);
  }

  /** 一次性的爆炸：火球 + 黑烟 + 火星 + 碎片。 */
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
    // 火星
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
    if (this._burn > 0) {
      this._burn -= dt;
      const f = Math.min(1, this._burn / 30);        // 火势
      if (this._light) this._light.intensity = f * (16 + Math.sin(this._t * 21) * 3 + Math.random() * 3);
      if (fx && fx.enabled) {
        this._smoke -= dt;
        const rate = 0.02 + 0.05 * f;
        if (this._smoke <= 0) {
          this._smoke = rate;
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

  /** 残骸把车身震一下（离得近才有效）。 */
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

  /** 把 pos/heading/pitch/bank 写进渲染变换。机头沿 +X。 */
  _syncMesh() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.set(0, 0, 0);
    // rotateY(θ) 把 +X 映到 (cosθ, 0, -sinθ)，所以要朝 (cos h, 0, sin h) 得用 -h。
    // 顺序按航空惯例：先偏航，再绕新的机体轴滚转，最后抬头。
    this.group.rotateY(-this.heading);
    this.group.rotateX(this.bank);
    this.group.rotateZ(this.pitch);
  }

  setEnabled(v) { this.enabled = v; this.group.visible = v; }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of this.materials ?? []) m.dispose();
  }
}

Plane._contactBuf = new Float64Array(5 * 8);
