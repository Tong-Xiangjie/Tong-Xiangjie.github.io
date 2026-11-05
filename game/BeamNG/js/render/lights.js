// ============================================================================
//  灯光：路灯、车灯、飞机灯
//
//  · 路灯：灯杆（同一份定义进物理，撞得断）+ 灯头自发光 + 地面光池。
//    光池和灯杆各合并成一个网格，所以 200 盏灯也只多 3 个 draw call。
//    真实点光只留 3 盏，每 0.3 秒吸附到离摄像机最近的三根灯杆上 ——
//    点光是逐像素算的，几百盏一起开会直接把帧率打死。
//  · 车灯：两盏聚光前照灯 + 车头地面光池 + 灯罩自发光（刹车尾灯变亮）。
//  · 飞机：着陆灯（聚光）+ 航行灯（左红右绿尾白）+ 频闪，全挂在机体上。
//
//  亮度统一由"夜间因子" night（0=白天，1=深夜）驱动，所有灯按它淡入淡出。
// ============================================================================
import * as THREE from '../../vendor/three.module.js';
import { MATERIALS } from '../phys/terrain.js';
import { StaticBody } from '../phys/statics.js';

// ---------------------------------------------------------------- 贴图
/** 径向渐变：路灯洒在地上的那摊光。 */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,232,186,0.95)');
  grd.addColorStop(0.35, 'rgba(255,218,158,0.46)');
  grd.addColorStop(0.7, 'rgba(255,206,140,0.14)');
  grd.addColorStop(1, 'rgba(255,200,130,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 车头那束：纵向拉长的渐变（V 轴 = 车头方向）。 */
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  // 横向按到中线的距离衰减，纵向由近到远衰减
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,244,214,0.55)');
  grd.addColorStop(0.25, 'rgba(255,240,200,0.34)');
  grd.addColorStop(0.7, 'rgba(255,236,190,0.10)');
  grd.addColorStop(1, 'rgba(255,232,180,0)');
  g.fillStyle = grd;
  // 用横向渐变挖出两侧的边
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 小圆点：航行灯 / 频闪。 */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 把一堆几何体烘成一个（不处理索引：先 toNonIndexed 再拼，省得算偏移）。
 * 灯杆几十上百根，一根一个网格的话 draw call 直接爆掉。
 */
function bake(parts) {
  const geos = [];
  let total = 0;
  for (const { geo, matrix } of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    total += g.attributes.position.count;
    geos.push(g);
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ============================================================================
//  路灯
// ============================================================================
const MAX_REAL_LIGHTS = 6;      // 同时存在的真实点光数量
const LAMP_STEP = 30;           // 沿路每隔多少米一根
const LAMP_HEIGHT = 7.6;

export class StreetLights {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../game/world.js').GameWorld} world 用它的道路走向和地形
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.lamps = [];
    this.night = 0;
    this._pick = 0;
    this._t = 0;
    this._layoutRoads();

    const group = new THREE.Group();
    group.renderOrder = 2;
    this.group = group;
    scene.add(group);

    // --- 灯杆 + 灯臂 + 灯头（一个网格）---------------------------------
    const pole = new THREE.CylinderGeometry(0.11, 0.17, LAMP_HEIGHT, 8);
    pole.translate(0, LAMP_HEIGHT / 2, 0);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 1.9);
    const head = new THREE.BoxGeometry(0.62, 0.20, 0.34);
    const parts = [];
    for (const l of this.lamps) {
      const dir = l.side;                          // 灯臂伸向路面（±x 局部）
      _m4.makeTranslation(l.x, l.y, l.z);
      parts.push({ geo: pole, matrix: _m4.clone() });
      // 灯臂：从杆顶伸出 1.9 m
      _m4.compose(
        _v3.set(l.x + dir.x * 0.95, l.y + LAMP_HEIGHT - 0.12, l.z + dir.z * 0.95),
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z)),
        new THREE.Vector3(1, 1, 1),
      );
      parts.push({ geo: arm, matrix: _m4.clone() });
      _m4.makeTranslation(l.x + dir.x * 1.8, l.y + LAMP_HEIGHT - 0.24, l.z + dir.z * 1.8);
      parts.push({ geo: head, matrix: _m4.clone() });
    }
    pole.dispose(); arm.dispose(); head.dispose();
    this.poleGeo = bake(parts);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.62, metalness: 0.55 });
    const poleMesh = new THREE.Mesh(this.poleGeo, this.poleMat);
    poleMesh.castShadow = true;
    poleMesh.receiveShadow = true;
    poleMesh.matrixAutoUpdate = false;
    group.add(poleMesh);

    // --- 灯头自发光（一个网格）------------------------------------------
    const glowParts = [];
    const glowBox = new THREE.BoxGeometry(0.54, 0.06, 0.28);
    for (const l of this.lamps) {
      _m4.makeTranslation(l.x + l.side.x * 1.8, l.y + LAMP_HEIGHT - 0.36, l.z + l.side.z * 1.8);
      glowParts.push({ geo: glowBox, matrix: _m4.clone() });
    }
    glowBox.dispose();
    this.glowGeo = bake(glowParts);
    this.glowMat = new THREE.MeshBasicMaterial({
      // fog:false —— 灯是光源，本来就该透过雾看得见。开着雾的话远处那排灯会
      // 直接糊进夜色里，看起来就成了"走到跟前才亮"。
      color: 0xffe0a8, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    const glowMesh = new THREE.Mesh(this.glowGeo, this.glowMat);
    glowMesh.matrixAutoUpdate = false;
    glowMesh.renderOrder = 3;
    group.add(glowMesh);

    // --- 地面光池（一个网格，加色混合）----------------------------------
    this.poolTex = radialTexture();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);                    // 摊平：局部 +Y 变成 -Z
    const poolParts = [];
    for (const l of this.lamps) {
      const px = l.x + l.side.x * 1.8, pz = l.z + l.side.z * 1.8;
      _m4.compose(
        _v3.set(px, this.world.terrain.height(px, pz) + 0.05, pz),
        _q.identity(),
        new THREE.Vector3(15, 1, 15),
      );
      poolParts.push({ geo: quad, matrix: _m4.clone() });
    }
    quad.dispose();
    this.poolGeo = bake(poolParts);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: this.poolTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    const poolMesh = new THREE.Mesh(this.poolGeo, this.poolMat);
    poolMesh.matrixAutoUpdate = false;
    poolMesh.renderOrder = 4;
    group.add(poolMesh);

    // --- 真实点光（少量，吸附到最近的灯上）------------------------------
    // 注意强度单位：three r155 起灯光是"物理单位"（点光=坎德拉），
    // 几十的强度在 7~8 m 高的路灯上几乎看不见，要上千才够亮。
    this.realLights = [];
    for (let i = 0; i < MAX_REAL_LIGHTS; i++) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 36, 1.3);
      pl.visible = false;
      scene.add(pl);
      this.realLights.push(pl);
    }
  }

  /**
   * 沿柏油路两侧隔一段装一根。跳过水面（环路和引道都跨河）和坡度过大的点，
   * 免得灯杆立在水里或者悬空。
   */
  _layoutRoads() {
    const roads = this.world.terrain.roads;
    const H = (x, z) => this.world.terrain.height(x, z);
    const isWater = (x, z) => this.world.terrain.materialAt(x, z) === MATERIALS.WATER;
    let flip = false;
    for (const road of roads) {
      if (road.material !== MATERIALS.ASPHALT) continue;
      const pts = road.points;
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const ux = dx / len, uz = dz / len;
        const nx = -uz, nz = ux;                    // 左法线
        const off = road.width * 0.5 + 3.4;
        for (let d = carry; d < len; d += LAMP_STEP) {
          carry = 0;
          flip = !flip;
          const s = flip ? 1 : -1;
          const x = x0 + ux * d + nx * off * s;
          const z = z0 + uz * d + nz * off * s;
          if (isWater(x, z)) continue;
          const y = H(x, z);
          // 0.5 m 内的高差认为可以立杆（路面本来就是平的）
          if (Math.abs(H(x + 1.4, z) - y) > 0.5 || Math.abs(H(x, z + 1.4) - y) > 0.5) continue;
          this.lamps.push({ x, y, z, side: { x: -nx * s, z: -nz * s } });
          if (this.lamps.length >= 220) return;
        }
        carry = (carry - len) % LAMP_STEP;
        if (carry < 0) carry += LAMP_STEP;
      }
    }
  }

  /**
   * 灯杆的物理：和视觉同一份坐标，撞上去就是撞杆，撞得断。
   * 视觉那边是合并网格，所以这里只往物理世界里塞，不再生成一份网格。
   */
  addColliders(world) {
    for (const l of this.lamps) {
      world.statics.add(StaticBody.cylinder(l.x, l.y + LAMP_HEIGHT / 2, l.z, 0.16, LAMP_HEIGHT,
        MATERIALS.CONCRETE, { tag: 'lamp', breakable: true }));
    }
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} camPos
   * @param {number} night 0..1
   */
  update(dt, camPos, night) {
    this.night = night;
    const on = night > 0.02;
    this.group.visible = on;
    if (!on) {
      for (const pl of this.realLights) { pl.visible = false; pl.intensity = 0; }
      return;
    }
    this.glowMat.opacity = night;
    this.poolMat.opacity = night * 0.85;
    // 低画质只留"假的"：灯头自发光 + 地面光池。几盏真实点光是逐像素成本，
    // 集显和软件渲染上省下来很可观。
    if (this.realEnabled === false) {
      for (const pl of this.realLights) { pl.visible = false; pl.intensity = 0; }
      return;
    }

    // 每 0.3 秒重新挑一次最近的三根灯杆（每帧挑会在边界上闪）
    this._t += dt;
    if (this._t >= 0.3) {
      this._t = 0;
      const near = [];
      for (const l of this.lamps) {
        const d = (l.x - camPos.x) ** 2 + (l.z - camPos.z) ** 2;
        if (d > 300 * 300) continue;
        near.push({ l, d });
      }
      near.sort((a, b) => a.d - b.d);
      this._pick = near.slice(0, MAX_REAL_LIGHTS).map((e) => e.l);
    }
    for (let i = 0; i < this.realLights.length; i++) {
      const pl = this.realLights[i];
      const l = this._pick[i];
      if (!l) { pl.visible = false; pl.intensity = 0; continue; }
      pl.visible = true;
      pl.position.set(l.x + l.side.x * 1.8, l.y + LAMP_HEIGHT - 0.5, l.z + l.side.z * 1.8);
      pl.intensity = 620 * night;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.poleGeo.dispose(); this.glowGeo.dispose(); this.poolGeo.dispose();
    this.poleMat.dispose(); this.glowMat.dispose(); this.poolMat.dispose();
    this.poolTex.dispose();
    for (const pl of this.realLights) this.scene.remove(pl);
  }
}

// ============================================================================
//  车灯
// ============================================================================
const DETAIL_HEADLIGHT = 5;      // bodyMesh 里的材质槽：前照灯灯罩
const DETAIL_TAILLIGHT = 6;      // 尾灯灯罩

export class CarLights {
  constructor(scene, view3d) {
    this.scene = scene;
    this.view3d = view3d;
    this.night = 0;
    this.braking = 0;

    this.spots = [];
    this.targets = [];
    for (let i = 0; i < 2; i++) {
      // 张角开大一点、靶点压低一点：太窄太远的话车头正前方那几米照不到，
      // 看上去就是"灯亮着但地上没光"。
      const sp = new THREE.SpotLight(0xfff2d6, 0, 80, 0.95, 0.62, 1.2);
      sp.castShadow = false;
      sp.visible = false;
      scene.add(sp);
      const tg = new THREE.Object3D();
      scene.add(tg);
      sp.target = tg;
      this.spots.push(sp);
      this.targets.push(tg);
    }

    // 车头地面光池：一个被拉长的加色四边形，贴着地形
    this.tex = beamTexture();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    this.poolGeo = quad;
    this.poolMat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    this.pool.matrixAutoUpdate = true;
    this.pool.frustumCulled = false;
    this.pool.renderOrder = 4;
    this.pool.visible = false;
    scene.add(this.pool);
  }

  /**
   * @param {number} dt
   * @param {import('../vehicle/vehicle.js').Vehicle} vehicle
   * @param {number} night 0..1
   * @param {boolean} active 车里有人（开飞机时车是停着的，只留尾灯）
   */
  update(dt, vehicle, night, active = true) {
    this.night = night;
    const f = vehicle.frame;
    const p = f.pos, fwd = f.fwd, up = f.up, right = f.right;
    const on = night > 0.05;
    const beams = on && active && this.realEnabled !== false;

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sp = this.spots[i];
      sp.visible = beams;
      if (!beams) { sp.intensity = 0; continue; }
      sp.position.set(
        p.x + fwd.x * 2.1 + up.x * 0.62 + right.x * 0.66 * s,
        p.y + fwd.y * 2.1 + up.y * 0.62 + right.y * 0.66 * s,
        p.z + fwd.z * 2.1 + up.z * 0.62 + right.z * 0.66 * s,
      );
      const tg = this.targets[i];
      tg.position.set(
        p.x + fwd.x * 20 - up.x * 2.4 + right.x * 1.6 * s,
        p.y + fwd.y * 20 - up.y * 2.4 + right.y * 1.6 * s,
        p.z + fwd.z * 20 - up.z * 2.4 + right.z * 1.6 * s,
      );
      sp.intensity = 240 * night;
    }

    // 地面光池：贴着车头前方，跟着地形走
    this.pool.visible = beams;
    if (beams) {
      const cx = p.x + fwd.x * 8, cz = p.z + fwd.z * 8;
      const gy = vehicle.world ? vehicle.world.groundHeight(cx, cz) : p.y;
      this.pool.position.set(cx, gy + 0.06, cz);
      this.pool.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
      this.pool.scale.set(11, 1, 24);
      this.poolMat.opacity = night * 0.46;
    }

    // 灯罩自发光：白天灯罩也有一点反光，夜里点亮
    const mats = this.view3d?.materials;
    if (mats) {
      const head = mats[DETAIL_HEADLIGHT];
      if (head) head.emissiveIntensity = 0.30 + night * 1.7;
      // 刹车：从刹车主缸压力推，倒车灯也一样亮
      const d = vehicle.drivetrain;
      const want = (d.brakeInput > 0.06 || d.handbrake) ? 1 : 0;
      this.braking += (want - this.braking) * Math.min(1, dt * 18);
      const tail = mats[DETAIL_TAILLIGHT];
      if (tail) tail.emissiveIntensity = 0.35 + night * 0.45 + this.braking * 1.9;
    }
  }

  dispose() {
    for (const sp of this.spots) this.scene.remove(sp);
    for (const tg of this.targets) this.scene.remove(tg);
    this.scene.remove(this.pool);
    this.poolGeo.dispose(); this.poolMat.dispose(); this.tex.dispose();
  }
}

// ============================================================================
//  飞机灯
// ============================================================================
/** 机体坐标系：机头 +X、上 +Y、右 +Z（和 plane.js 一致）。 */
export class PlaneLights {
  constructor(plane) {
    this.plane = plane;
    this.night = 0;
    this.t = 0;
    const group = plane.group;

    // 着陆灯：挂在机头下方往前照（强度同样是物理单位，要几千）
    this.spot = new THREE.SpotLight(0xfff6e2, 0, 220, 0.45, 0.5, 1.1);
    this.spot.castShadow = false;
    this.spot.position.set(4.2, -1.5, 0);
    this.spot.visible = false;
    group.add(this.spot);
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(70, -8, 0);
    group.add(this.spotTarget);
    this.spot.target = this.spotTarget;

    // 航行灯 + 频闪（加色小圆片，跟着机体走）
    this.tex = dotTexture();
    this.sprites = [];
    const add = (color, x, y, z, size, kind) => {
      const mat = new THREE.SpriteMaterial({
        map: this.tex, color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, y, z);
      sp.scale.set(size, size, size);
      group.add(sp);
      this.sprites.push({ sp, mat, kind, base: size });
      return sp;
    };
    // 左红右绿（右翼是 +Z）、尾白，翼尖在 z≈±5.2
    add(0xff2a1a, 1.2, 0.1, -5.2, 0.9, 'nav');
    add(0x22ff44, 1.2, 0.1, 5.2, 0.9, 'nav');
    add(0xffffff, -5.4, 0.9, 0, 0.8, 'nav');
    add(0xffffff, 1.2, 0.1, 5.2, 1.6, 'strobe');    // 右翼尖频闪
    add(0xffffff, -5.4, 0.9, 0, 1.4, 'strobe');      // 尾部频闪
  }

  /** @param {number} dt @param {number} night 0..1 */
  update(dt, night) {
    this.night = night;
    this.t += dt;
    const alive = this.plane.alive !== false;
    const lit = alive && night > 0.05;
    // 着陆灯（低画质只留航行灯，聚光灯不要）
    this.spot.visible = lit && this.realEnabled !== false;
    this.spot.intensity = this.spot.visible ? 1700 * night : 0;
    // 航行灯：常亮
    for (const s of this.sprites) {
      if (s.kind === 'nav') {
        s.mat.opacity = lit ? night * 0.95 : 0;
        s.sp.scale.setScalar(s.base);
      } else {
        // 频闪：每次 70 ms，间隔 1.05 s
        const ph = this.t % 1.05;
        const flash = ph < 0.07 || (ph > 0.55 && ph < 0.62);
        s.mat.opacity = lit && flash ? night : 0;
        s.sp.scale.setScalar(s.base * (flash ? 1.35 : 1));
      }
      s.sp.visible = s.mat.opacity > 0.01;
    }
  }

  dispose() {
    this.plane.group.remove(this.spot);
    this.plane.group.remove(this.spotTarget);
    for (const s of this.sprites) {
      this.plane.group.remove(s.sp);
      s.mat.dispose();
    }
    this.tex.dispose();
  }
}
