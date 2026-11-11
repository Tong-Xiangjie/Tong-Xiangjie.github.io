// ============================================================================
//  特效：轮胎烟/尘土、碰撞火花与碎屑、刹车拖痕
//  · 粒子用单个 THREE.Points + 自定义着色器（逐粒子大小/透明度/颜色），
//    固定容量的环形缓冲，运行期零分配
//  · 拖痕是一块预分配的三角带缓冲，按圈写入，写满就覆盖最旧的
// ============================================================================
import * as THREE from '../../vendor/three.module.js';

const MAX_PARTICLES = 900;
const MAX_SKID_QUADS = 2600;

const PARTICLE_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = smoothstep(1.0, 0.25, r);
  gl_FragColor = vec4(vColor, vAlpha * soft);
}`;

export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.enabled = opts.enabled !== false;
    this.budget = opts.budget ?? 1;                 // 画质档位：0.4 / 1 / 1.6
    this.parts = {
      pos: new Float32Array(MAX_PARTICLES * 3),
      vel: new Float32Array(MAX_PARTICLES * 3),
      life: new Float32Array(MAX_PARTICLES),
      maxLife: new Float32Array(MAX_PARTICLES),
      size: new Float32Array(MAX_PARTICLES),
      grow: new Float32Array(MAX_PARTICLES),
      alpha: new Float32Array(MAX_PARTICLES),
      color: new Float32Array(MAX_PARTICLES * 3),
      drag: new Float32Array(MAX_PARTICLES),
      buoy: new Float32Array(MAX_PARTICLES),
      kind: new Uint8Array(MAX_PARTICLES),
      head: 0,
      live: 0,
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.parts.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.parts.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.parts.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.parts.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.pointsGeo = g;
    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // --- 拖痕 ------------------------------------------------------------
    this.skid = {
      pos: new Float32Array(MAX_SKID_QUADS * 6 * 3),
      alpha: new Float32Array(MAX_SKID_QUADS * 6),
      count: 0,
      head: 0,
      last: new Map(),        // wheel -> {x,y,z,active}
    };
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.skid.pos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aAlpha', new THREE.BufferAttribute(this.skid.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setDrawRange(0, 0);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.skidGeo = sg;
    this.skidMat = new THREE.ShaderMaterial({
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; uniform vec3 uColor;
        void main(){ gl_FragColor = vec4(uColor, vA); }`,
      uniforms: { uColor: { value: new THREE.Color(0x0d0d10) } },
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
    });
    this.skidMesh = new THREE.Mesh(sg, this.skidMat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 2;
    scene.add(this.skidMesh);
    this._v = new THREE.Vector3();
  }

  get particleCount() { return this.parts.live; }

  /** 生成一个粒子。 */
  spawn(x, y, z, vx, vy, vz, opts) {
    if (!this.enabled) return;
    const P = this.parts;
    const i = P.head;
    P.head = (P.head + 1) % MAX_PARTICLES;
    if (P.live < MAX_PARTICLES) P.live++;
    const o = i * 3;
    P.pos[o] = x; P.pos[o + 1] = y; P.pos[o + 2] = z;
    P.vel[o] = vx; P.vel[o + 1] = vy; P.vel[o + 2] = vz;
    P.life[i] = 0;
    P.maxLife[i] = opts.life ?? 1.2;
    P.size[i] = opts.size ?? 1.2;
    P.grow[i] = opts.grow ?? 1.5;
    P.alpha[i] = opts.alpha ?? 0.5;
    P.drag[i] = opts.drag ?? 1.6;
    P.buoy[i] = opts.buoy ?? 0.4;
    P.kind[i] = opts.kind ?? 0;
    const c = opts.color ?? 0xbdb3a3;
    P.color[o] = ((c >> 16) & 255) / 255;
    P.color[o + 1] = ((c >> 8) & 255) / 255;
    P.color[o + 2] = (c & 255) / 255;
  }

  /** 碰撞：火花 + 碎屑。 */
  impact(x, y, z, strength, normal) {
    if (!this.enabled || strength < 0.12) return;
    const n = Math.round(Math.min(38, strength * 34) * this.budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * 1.1 - 0.2;
      const sp = 2 + Math.random() * 9 * strength;
      const dx = Math.cos(a) * Math.cos(b), dy = Math.sin(b) + 0.4, dz = Math.sin(a) * Math.cos(b);
      const nx = normal ? normal.x : 0, ny = normal ? normal.y : 1, nz = normal ? normal.z : 0;
      const spark = Math.random() < 0.45;
      this.spawn(x, y, z,
        (dx * 0.5 + nx * 0.9) * sp, (dy * 0.5 + ny * 0.9) * sp + 1.5, (dz * 0.5 + nz * 0.9) * sp,
        {
          life: spark ? 0.18 + Math.random() * 0.35 : 0.5 + Math.random() * 0.7,
          size: spark ? 0.10 + Math.random() * 0.12 : 0.09 + Math.random() * 0.14,
          grow: spark ? 0.4 : 0.7,
          alpha: spark ? 0.95 : 0.8,
          drag: spark ? 3.2 : 1.1,
          buoy: spark ? -2.5 : -6.5,
          color: spark ? 0xffcc66 : 0x5a5248,
        });
    }
  }

  /** 每帧更新。 */
  update(dt, vehicle, world) {
    if (!this.enabled) return;
    this._updateParticles(dt);
    if (vehicle) this._wheelEffects(dt, vehicle, world);
  }

  _updateParticles(dt) {
    const P = this.parts;
    let maxUsed = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (P.life[i] >= P.maxLife[i] && P.alpha[i] <= 0) continue;
      P.life[i] += dt;
      const t = P.life[i] / P.maxLife[i];
      const o = i * 3;
      if (t >= 1) { P.alpha[i] = 0; P.size[i] = 0; continue; }
      const d = Math.max(0, 1 - P.drag[i] * dt);
      P.vel[o] *= d; P.vel[o + 2] *= d;
      P.vel[o + 1] = P.vel[o + 1] * d + P.buoy[i] * dt;
      P.pos[o] += P.vel[o] * dt;
      P.pos[o + 1] += P.vel[o + 1] * dt;
      P.pos[o + 2] += P.vel[o + 2] * dt;
      P.size[i] += P.grow[i] * dt;
      // 前 15% 淡入，之后线性淡出
      const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      P.alpha[i] = Math.max(0, a) * 0.85;
      maxUsed = i + 1;
    }
    this.pointsGeo.setDrawRange(0, MAX_PARTICLES);
    this.pointsGeo.attributes.position.needsUpdate = true;
    this.pointsGeo.attributes.aSize.needsUpdate = true;
    this.pointsGeo.attributes.aAlpha.needsUpdate = true;
    this.pointsGeo.attributes.aColor.needsUpdate = true;
    void maxUsed;
  }

  _wheelEffects(dt, vehicle, world) {
    const surf = world?.terrain;
    for (const w of vehicle.wheels) {
      if (w.detached) continue;
      const slip = Math.abs(w.slipRatio);
      const lat = Math.abs(Math.tan(w.slipAngle));
      const spin = Math.abs(w.spinRate);
      const speed = Math.abs(vehicle.speed);
      const burnout = Math.max(0, slip - 0.18) + Math.max(0, lat - 0.16) * 1.2;
      const stress = Math.min(1, burnout * 2.2) * Math.min(1, speed / 4 + Math.abs(spin) / 40);
      const mat = w.surfaceMaterial ?? null;
      const dustAmount = mat ? mat.dust : 0.1;
      const baseColor = mat ? mat.color : 0xb0a89a;

      // --- 烟 / 尘 -----------------------------------------------------
      if (w.contact && stress > 0.06) {
        const n = Math.round(Math.min(3, stress * 3 * this.budget));
        for (let i = 0; i < n; i++) {
          const j = 0.34;
          const px = w.contactPoint.x + (Math.random() - 0.5) * j;
          const pz = w.contactPoint.z + (Math.random() - 0.5) * j;
          const py = w.contactPoint.y + 0.05 + Math.random() * 0.1;
          const up = 0.7 + Math.random() * 1.4 * stress;
          this.spawn(px, py, pz,
            (Math.random() - 0.5) * 1.6 + w.contactNormal.x * 0.4,
            up,
            (Math.random() - 0.5) * 1.6 + w.contactNormal.z * 0.4,
            {
              life: 0.7 + Math.random() * 1.3,
              size: 0.55 + Math.random() * 0.7,
              grow: 1.5 + dustAmount * 1.6,
              alpha: 0.20 + stress * 0.34 * (0.4 + dustAmount),
              drag: 1.0 + dustAmount * 0.8,
              buoy: 0.35 + dustAmount * 0.5,
              color: dustAmount > 0.4 ? baseColor : 0x9a9a9a,
            });
        }
      }

      // --- 拖痕 ---------------------------------------------------------
      const marking = w.contact && stress > 0.22 && speed > 1.2 && dustAmount < 0.5;
      if (marking) this._addSkid(w, stress);
      else this.skid.last.delete(w);
    }
  }

  /** 在接地点铺一段拖痕四边形。 */
  _addSkid(w, stress) {
    const key = w;
    const prev = this.skid.last.get(key);
    const p = w.contactPoint;
    const f = w.wheelFwd;
    const n = w.contactNormal;
    const half = (w.spec.width ?? 0.22) * 0.5;
    // 横向方向 = 法向 × 前进
    const tx = n.y * f.z - n.z * f.y;
    const ty = n.z * f.x - n.x * f.z;
    const tz = n.x * f.y - n.y * f.x;
    const cur = {
      x: p.x, y: p.y + 0.012, z: p.z,
      lx: p.x + tx * half, ly: p.y + 0.012, lz: p.z + tz * half,
      rx: p.x - tx * half, ry: p.y + 0.012, rz: p.z - tz * half,
      stress,
    };
    this.skid.last.set(key, cur);
    if (!prev) return;
    const dx = cur.x - prev.x, dz = cur.z - prev.z;
    if (dx * dx + dz * dz < 0.02) return;
    const S = this.skid;
    const i = S.head;
    S.head = (S.head + 1) % MAX_SKID_QUADS;
    if (S.count < MAX_SKID_QUADS) S.count++;
    const o = i * 18;
    const a = i * 6;
    const alpha = Math.min(0.62, 0.16 + stress * 0.5);
    // 两个三角形：prev.l prev.r cur.r / prev.l cur.r cur.l
    S.pos[o] = prev.lx; S.pos[o + 1] = prev.ly; S.pos[o + 2] = prev.lz;
    S.pos[o + 3] = prev.rx; S.pos[o + 4] = prev.ry; S.pos[o + 5] = prev.rz;
    S.pos[o + 6] = cur.rx; S.pos[o + 7] = cur.ry; S.pos[o + 8] = cur.rz;
    S.pos[o + 9] = prev.lx; S.pos[o + 10] = prev.ly; S.pos[o + 11] = prev.lz;
    S.pos[o + 12] = cur.rx; S.pos[o + 13] = cur.ry; S.pos[o + 14] = cur.rz;
    S.pos[o + 15] = cur.lx; S.pos[o + 16] = cur.ly; S.pos[o + 17] = cur.lz;
    for (let k = 0; k < 6; k++) S.alpha[a + k] = alpha;
    this.skidGeo.setDrawRange(0, S.count * 6);
    this.skidGeo.attributes.position.needsUpdate = true;
    this.skidGeo.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    const P = this.parts;
    for (let i = 0; i < MAX_PARTICLES; i++) { P.life[i] = 1; P.maxLife[i] = 1; P.alpha[i] = 0; P.size[i] = 0; }
    this.skid.count = 0;
    this.skid.head = 0;
    this.skid.last.clear();
    this.skidGeo.setDrawRange(0, 0);
  }

  setBudget(b) { this.budget = b; }

  dispose() {
    this.scene.remove(this.points);
    this.scene.remove(this.skidMesh);
    this.pointsGeo.dispose();
    this.pointsMat.dispose();
    this.skidGeo.dispose();
    this.skidMat.dispose();
  }
}
