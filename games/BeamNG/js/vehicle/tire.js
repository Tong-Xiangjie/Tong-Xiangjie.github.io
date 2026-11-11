// ============================================================================
//  轮胎模型
//
//  用 Pacejka 魔术公式的形式，但参数按"物理量"给（峰值附着系数、侧偏刚度、
//  峰值滑移角），而不是拟合系数 —— 这样不同车型/路面可以直接改物理量。
//
//  关键的真实感要素：
//    · 载荷敏感性：垂直载荷越大，单位载荷能产生的附着力越低（轮胎过载会滑）
//    · 松弛长度：轮胎需要滚动一段距离才能建立侧向力（不是瞬间响应）
//    · 摩擦椭圆：纵向力和侧向力共享附着圆，同时用就都不够用
//    · 峰值后的衰减：超过峰值滑移后力下降 → 推头/甩尾与可控的滑移区间
// ============================================================================

const RAD = 180 / Math.PI;

/** 魔术公式：slip → 力（D 为峰值）。 */
function magic(slip, B, C, D, E) {
  const bs = B * slip;
  return D * Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs))));
}

/**
 * 由"峰值滑移"反推 B 系数。
 * 令 x = B·slip，魔术公式的峰值出现在 C·atan(g(x)) = π/2，
 * 即 g(x) = tan(π/(2C))，其中 g(x) = x(1-E) + E·atan(x)（单调增，二分求解）。
 */
function shapeB(peakSlip, C, E) {
  const target = Math.tan(Math.PI / (2 * C));
  const g = (x) => x * (1 - E) + E * Math.atan(x);
  let lo = 0, hi = Math.max(1, target * 4);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (g(mid) < target) lo = mid; else hi = mid;
  }
  const xStar = (lo + hi) * 0.5;
  return xStar / Math.max(1e-4, peakSlip);
}

export class TireModel {
  constructor(params, staticLoad) {
    this.p = params;
    this.staticLoad = staticLoad || 3500;
    // 纵向
    this.Cx = 1.62;
    // E 太接近 1 会让"峰值滑移率"很小时 B 变得极大（滑移刚度 ≈ B·C·D 会到
    // 45 倍垂直载荷），起步时车轮转速会剧烈振荡。0.55 对应真实轮胎的
    // 20 倍量级滑移刚度。
    this.Ex = 0.55;
    this.Bx = shapeB(params.peakSlipRatio, this.Cx, this.Ex);
    // 侧向
    this.Cy = 1.30;
    this.Ey = -0.35;
    this.By = shapeB(params.peakSlipAngle / RAD, this.Cy, this.Ey);
    this.reset();
  }

  reset() {
    this.fx = 0; this.fy = 0;
    this.slipRatioFiltered = 0;
    this.slipAngleFiltered = 0;
    this.saturation = 0;
    this.lastMu = 0;
    this.relaxFactor = 1;
  }

  /** 当前有效附着系数（含载荷敏感性与路面）。 */
  effectiveMu(Fz, surfaceMu, gripScale) {
    const p = this.p;
    const loadRatio = Fz / this.staticLoad;
    // 载荷敏感性：过载时附着下降
    const sens = 1 - p.loadSensitivity * Math.max(-0.5, Math.min(2.0, loadRatio - 1));
    const mu = p.muBase * surfaceMu * gripScale * Math.max(0.25, sens);
    return mu;
  }

  /**
   * 计算轮胎力。
   * @param {number} slipRatio  纵向滑移率（正 = 驱动打滑）
   * @param {number} slipAngle  侧偏角（rad，正 = 车头指向内侧）
   * @param {number} Fz         垂直载荷（N，>=0）
   * @param {number} surfaceMu  路面摩擦系数
   * @param {number} vx         纵向速度（决定松弛速率）
   * @param {number} dt
   * @param {number} gripScale  轮胎状态倍率（爆胎/磨损）
   * @returns {{fx:number, fy:number, mu:number, saturation:number}}
   */
  update(slipRatio, slipAngle, Fz, surfaceMu, vx, dt, gripScale = 1) {
    const p = this.p;
    if (Fz <= 1) {
      this.fx = 0; this.fy = 0; this.saturation = 0;
      return this;
    }
    // --- 松弛长度：轮胎不是瞬间建立力的 -------------------------------
    const speed = Math.max(Math.abs(vx), 1.0);
    const relax = 1 - Math.exp(-(speed / Math.max(0.05, p.relaxLength)) * dt);
    this.relaxFactor = relax;
    this.slipRatioFiltered += (slipRatio - this.slipRatioFiltered) * relax;
    this.slipAngleFiltered += (slipAngle - this.slipAngleFiltered) * relax;
    const kappa = this.slipRatioFiltered;
    const alpha = this.slipAngleFiltered;

    const mu = this.effectiveMu(Fz, surfaceMu, gripScale);
    const D = mu * Fz;

    // --- 纯纵滑 / 纯侧偏 ----------------------------------------------
    const Fx0 = magic(kappa, this.Bx, this.Cx, D, this.Ex);
    const Fy0 = magic(alpha, this.By, this.Cy, D, this.Ey);

    // --- 摩擦椭圆：两者共享附着圆 --------------------------------------
    const mag = Math.hypot(Fx0, Fy0);
    const limit = D * 1.0;
    let scale = 1;
    if (mag > limit) { scale = limit / mag; }
    this.saturation = Math.min(1, mag / Math.max(1e-6, limit));

    this.fx = Fx0 * scale;
    this.fy = Fy0 * scale;
    this.lastMu = mu;
    return this;
  }

  /**
   * 零滑移处的纵向刚度 dFx/dκ（N / 单位滑移率）= Bx·Cx·D。
   * 车轮自转要隐式积分，需要这个值来做线性化。
   */
  slipStiffness(Fz, surfaceMu, gripScale) {
    return this.Bx * this.Cx * this.effectiveMu(Fz, surfaceMu, gripScale) * Fz;
  }

  /** 滚动阻力（N，方向与运动相反）。 */
  rollingResistance(Fz, surfaceRolling) {
    return this.p.rollingResistance * surfaceRolling * Fz;
  }
}
