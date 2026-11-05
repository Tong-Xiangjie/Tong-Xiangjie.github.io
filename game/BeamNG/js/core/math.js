// ============================================================================
//  基础数学库
//  物理层刻意不依赖 three.js —— 这样同一份代码可以在 Node 里无头跑测试。
//  热路径（求解器）用 SoA 标量运算；这里只提供边界处使用的向量/四元数工具。
// ============================================================================

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const GRAVITY = 9.81;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const sign = Math.sign;
export const sqr = (x) => x * x;
export const hypot2 = (x, y) => Math.sqrt(x * x + y * y);

/** 以固定速率把 current 推向 target，不会过冲（指数趋近的稳定版本）。 */
export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 帧率无关的指数平滑：lambda 越大越"硬"。 */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** 把角度差归一化到 (-PI, PI]，用于转向/偏航插值。 */
export function wrapAngle(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

// ---------------------------------------------------------------------------
//  Vec3 —— 可变对象，原地运算，避免在每帧循环里制造垃圾。
// ---------------------------------------------------------------------------
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  zero() { this.x = this.y = this.z = 0; return this; }

  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  addXYZ(x, y, z) { this.x += x; this.y += y; this.z += z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  cross(v) { return this.crossVectors(this, v); }

  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  distanceTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  distanceToSq(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }

  normalize() {
    const l = this.length();
    if (l > 1e-12) { const s = 1 / l; this.x *= s; this.y *= s; this.z *= s; }
    return this;
  }
  setLength(l) { return this.normalize().scale(l); }
  limit(max) { const l = this.lengthSq(); if (l > max * max) this.scale(max / Math.sqrt(l)); return this; }

  lerpVectors(a, b, t) {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }

  /** 相对 v 做四元数旋转。 */
  applyQuat(q) {
    const { x, y, z } = this;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + (qy * tz - qz * ty);
    this.y = y + qw * ty + (qz * tx - qx * tz);
    this.z = z + qw * tz + (qx * ty - qy * tx);
    return this;
  }

  /** 用矩阵的基向量旋转（a=右, b=上, c=前）。 */
  applyBasis(right, up, fwd) {
    const { x, y, z } = this;
    this.x = right.x * x + up.x * y + fwd.x * z;
    this.y = right.y * x + up.y * y + fwd.y * z;
    this.z = right.z * x + up.z * y + fwd.z * z;
    return this;
  }

  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }

  /** 从物理层的 SoA 缓冲里读一个节点位置。 */
  fromBuffer(buf, i, offset = 0) {
    this.x = buf[offset + i * 3];
    this.y = buf[offset + i * 3 + 1];
    this.z = buf[offset + i * 3 + 2];
    return this;
  }
}

export const vec3 = (x, y, z) => new Vec3(x, y, z);

/** 复用的临时向量池 —— 只用于不会重入的短片段。 */
export const tmp = {
  a: new Vec3(), b: new Vec3(), c: new Vec3(), d: new Vec3(),
  e: new Vec3(), f: new Vec3(), g: new Vec3(), h: new Vec3(),
};

// ---------------------------------------------------------------------------
//  Quat —— 只实现我们真正需要的：轴角、绕轴增量旋转、与向量的合成。
// ---------------------------------------------------------------------------
export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }

  setFromAxisAngle(axis, angle) {
    const h = angle * 0.5, s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }

  /** this = q * this（把 q 应用到本地坐标系上）。 */
  premultiply(q) {
    const { x, y, z, w } = this;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    this.x = qx * w + qw * x + qy * z - qz * y;
    this.y = qy * w + qw * y + qz * x - qx * z;
    this.z = qz * w + qw * z + qx * y - qy * x;
    this.w = qw * w - qx * x - qy * y - qz * z;
    return this;
  }

  /** this = this * q。 */
  multiply(q) {
    const { x, y, z, w } = this;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    this.x = x * qw + w * qx + y * qz - z * qy;
    this.y = y * qw + w * qy + z * qx - x * qz;
    this.z = z * qw + w * qz + x * qy - y * qx;
    this.w = w * qw - x * qx - y * qy - z * qz;
    return this;
  }

  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w);
    if (l > 1e-12) { const s = 1 / l; this.x *= s; this.y *= s; this.z *= s; this.w *= s; }
    return this;
  }

  /** 从正交基构造：right=+X，up=+Y，fwd=+Z。 */
  setFromBasis(right, up, fwd) {
    const m00 = right.x, m01 = up.x, m02 = fwd.x;
    const m10 = right.y, m11 = up.y, m12 = fwd.y;
    const m20 = right.z, m21 = up.z, m22 = fwd.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      this.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      this.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      this.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      this.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
    }
    return this.normalize();
  }

  /** 有符号角度差：把 q 视为绕 axis 的旋转，返回它相对参考的转角。 */
  angleAround(axis) {
    const s = this.x * axis.x + this.y * axis.y + this.z * axis.z;
    const ang = 2 * Math.atan2(s, this.w);
    return wrapAngle(ang);
  }
}

// ---------------------------------------------------------------------------
//  确定性随机数与噪声
//  地形与世界生成必须可复现 —— 回放/测试都依赖这一点。
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1337) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D 值噪声 + fBm，用于地形起伏与地面材质分布。 */
export class Noise2D {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.perm = new Uint8Array(512);
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 单层值噪声，输出 [-1, 1]。 */
  value(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const p = this.perm;
    const h = (a, b) => {
      const n = p[(p[a & 255] + (b & 255)) & 511];
      return n / 127.5 - 1;
    };
    const n00 = h(xi, yi), n10 = h(xi + 1, yi), n01 = h(xi, yi + 1), n11 = h(xi + 1, yi + 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }

  /** 分形叠加。 */
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** 平滑的"台地"函数：在 [edge0, edge1] 之间从 0 过渡到 1。 */
export const smoothBand = (x, edge0, edge1) => smoothstep((x - edge0) / (edge1 - edge0));
