// ============================================================================
//  车辆数据：车身几何表 + 车型预设
//
//  车身用"横截面环"来描述：沿车长方向排布若干站位，每个站位是一个 12 点的
//  闭合截面（车底中心 → 右侧 → 车顶 → 左侧 → 回到车底）。这样得到的是
//  真正的管状空间桁架 —— 正面撞击时力会沿着环形截面逐级传递，和真车一样
//  呈现"前脸压溃、乘员舱保持完整"的分区行为。
//
//  坐标系：+X 右，+Y 上，-Z 车头（与 three.js 的相机朝向一致）
// ============================================================================

/** 归一化截面表：车头(-1) → 车尾(+1)，共 12 个站位。 */
export const PROFILE_STATIONS = [
  //         车头压溃区        发动机舱              前风挡      乘员舱              后风挡     行李箱      车尾压溃
  { t: -1.00, w: 0.60, floor: 0.44, sill: 0.50, shoulder: 0.66, glass: 0.68, roof: 0.70, zone: 'crush' },
  { t: -0.87, w: 0.79, floor: 0.38, sill: 0.46, shoulder: 0.75, glass: 0.77, roof: 0.79, zone: 'crush' },
  { t: -0.70, w: 0.91, floor: 0.34, sill: 0.45, shoulder: 0.83, glass: 0.85, roof: 0.87, zone: 'crush' },
  { t: -0.51, w: 0.96, floor: 0.33, sill: 0.45, shoulder: 0.89, glass: 0.91, roof: 0.94, zone: 'engine' },
  { t: -0.33, w: 0.99, floor: 0.32, sill: 0.45, shoulder: 0.93, glass: 0.95, roof: 0.99, zone: 'engine' },
  { t: -0.16, w: 1.00, floor: 0.32, sill: 0.46, shoulder: 0.97, glass: 1.03, roof: 1.36, zone: 'cabin' },
  { t: 0.02, w: 1.00, floor: 0.32, sill: 0.47, shoulder: 1.00, glass: 1.09, roof: 1.52, zone: 'cabin' },
  { t: 0.24, w: 0.99, floor: 0.33, sill: 0.48, shoulder: 1.01, glass: 1.10, roof: 1.53, zone: 'cabin' },
  { t: 0.47, w: 0.96, floor: 0.34, sill: 0.48, shoulder: 0.99, glass: 1.07, roof: 1.48, zone: 'cabin' },
  { t: 0.64, w: 0.92, floor: 0.35, sill: 0.47, shoulder: 0.95, glass: 1.00, roof: 1.12, zone: 'deck' },
  { t: 0.82, w: 0.86, floor: 0.37, sill: 0.46, shoulder: 0.88, glass: 0.90, roof: 0.94, zone: 'deck' },
  { t: 1.00, w: 0.72, floor: 0.44, sill: 0.48, shoulder: 0.76, glass: 0.78, roof: 0.80, zone: 'crush' },
];

/** 每个环上的点定义（右侧半圈，对称生成左侧）。 */
export const RING_POINT_DEFS = [
  { key: 'floorC', x: 0.00, y: 'floor' },
  { key: 'floor', x: 0.52, y: 'floor' },
  { key: 'sill', x: 1.00, y: 'sill' },
  { key: 'shoulder', x: 1.00, y: 'shoulder' },
  { key: 'glass', x: 0.87, y: 'glass' },
  { key: 'roof', x: 0.44, y: 'roof' },
  { key: 'roofC', x: 0.00, y: 'roof' },
];

/** 分区强度：屈服应变 / 断裂应变 / 单位质量系数。 */
// 断裂应变必须落在"日常驾驶永远够不到、撞车够得到"的区间里。
// 实测（sedan，刚体梁的历史峰值应变）：
//   日常驾驶（急加速/绕桩/急刹/过坎）ring 0.065、long 0.064、diag 0.037
//   50 km/h 撞墙   ring 0.288、long 0.343、diag 0.292
//   100 km/h 撞墙  ring 0.501、long 0.305、diag 0.299
// 所以阈值取 0.14~0.28 这一带：日常驾驶有 2~4 倍余量，撞车必然撕开。
// （之前压溃区写的是 0.55，而塑性流动会把应变一直压在 2% 上下，
//   结果是"永远不会断梁、永远不会掉轮"。）
export const ZONE_STRENGTH = {
  crush: { yieldStrain: 0.010, breakStrain: 0.20, massScale: 0.62, label: '压溃区' },
  engine: { yieldStrain: 0.014, breakStrain: 0.28, massScale: 0.85, label: '发动机舱' },
  cabin: { yieldStrain: 0.030, breakStrain: 0.75, massScale: 1.30, label: '乘员舱' },
  deck: { yieldStrain: 0.012, breakStrain: 0.24, massScale: 0.80, label: '行李舱' },
};

/**
 * 生成车身几何。
 * stations[i].ring 里存的是 nodes 数组的下标；工厂按同样顺序创建 SoftBody 节点，
 * 因此几何下标 == 物理节点下标。
 * @param {object} spec
 * @param {Array} stationDefs 站位表（可已被细分）
 */
export function generateBodyGeometry(spec, stationDefs = PROFILE_STATIONS) {
  const dims = {
    length: spec.length,
    width: spec.width,
    height: spec.height,
    wheelbase: spec.wheelbase,
    track: spec.track ?? spec.width * 0.86,
    rideHeight: spec.rideHeight ?? 0.16,
  };
  const halfW = dims.width / 2;
  const heightRef = 1.52;                 // 归一化表中车顶最高值
  const hScale = dims.height / heightRef;
  const lenHalf = dims.length / 2;

  const nodes = [];
  const stations = [];

  for (let si = 0; si < stationDefs.length; si++) {
    const st = stationDefs[si];
    const z = st.t * lenHalf;
    const coords = [];
    for (const def of RING_POINT_DEFS) {
      coords.push({ x: def.x * halfW * st.w, y: st[def.y] * hScale, part: def.key });
    }
    // 左侧镜像（跳过位于中线的 floorC 与 roofC）
    for (let i = RING_POINT_DEFS.length - 2; i >= 1; i--) {
      const def = RING_POINT_DEFS[i];
      coords.push({ x: -def.x * halfW * st.w, y: st[def.y] * hScale, part: def.key });
    }
    const ring = [];
    for (const c of coords) {
      ring.push(nodes.length);
      nodes.push({ x: c.x, y: c.y, z, zone: st.zone, part: c.part, station: si });
    }
    stations.push({ z, t: st.t, zone: st.zone, ring, def: st });
  }

  return { nodes, stations, ringSize: RING_POINT_DEFS.length * 2 - 2, dims, hScale };
}

/** 判断某个表面四边形属于什么材质区域（供渲染层选材质）。 */
export function quadKind(stationIndex, ringIndex, geometry) {
  const ringSize = geometry.ringSize;
  const zone = geometry.stations[stationIndex].zone;
  const zoneB = geometry.stations[Math.min(stationIndex + 1, geometry.stations.length - 1)].zone;
  // 环索引：0 车底中心,1 车底,2 门槛,3 肩线,4 玻璃下沿,5 车顶边,6 车顶中心,
  //         7 车顶边(左),8 玻璃下沿(左),9 肩线(左),10 门槛(左),11 车底(左)
  const isBottom = ringIndex === 0 || ringIndex === 1 || ringIndex === 10 || ringIndex === 11;
  if (isBottom) return 'underbody';
  const isGlassBand = ringIndex === 3 || ringIndex === 7;   // 肩线→玻璃下沿 = 侧窗
  const isUpperBand = ringIndex === 4 || ringIndex === 5 || ringIndex === 6; // 玻璃下沿→车顶 = 前/后风挡区域
  const inCabin = zone === 'cabin' || zoneB === 'cabin';
  if (isGlassBand && inCabin) return 'glass';
  if ((ringIndex === 5 || ringIndex === 6) && (zone === 'cabin') && (zoneB === 'cabin')) return 'roof';
  if (isUpperBand && inCabin && (zone === 'engine' || zoneB === 'engine' || zone === 'deck' || zoneB === 'deck')) return 'glass';
  if (ringIndex === 2 || ringIndex === 9) return 'sill';
  return 'body';
}

// ---------------------------------------------------------------------------
//  车型预设
// ---------------------------------------------------------------------------
export const CAR_PRESETS = {
  sedan: {
    id: 'sedan',
    name: '家用轿车',
    desc: '前驱 · 1.4L 涡轮 · 均衡好开，适合熟悉手感',
    length: 4.58, width: 1.82, height: 1.47, wheelbase: 2.70, track: 1.56, rideHeight: 0.155,
    totalMass: 1420,
    driveLayout: 'FWD',
    wheel: { radius: 0.325, width: 0.225, rimRadius: 0.215, unsprungMass: 38, inertia: 1.40, verticalStiffness: 250000, verticalDamping: 1500 },
    suspension: { bumpTravel: 0.165, droopTravel: 0.145, springRate: 28000, bumpDamping: 2600, reboundDamping: 3600, arb: 9000, camber: -0.6, toe: 0.08, travelCamberGain: 0.10 },
    tire: { muBase: 1.02, loadSensitivity: 0.22, peakSlipRatio: 0.11, peakSlipAngle: 8.0, corneringStiffness: 11.5, longitudinalStiffness: 13.0, falloff: 0.90, relaxLength: 0.55, rollingResistance: 0.013, pressureGrip: 1.0 },
    engine: {
      idleRpm: 760, redline: 6600, maxRpm: 7000, inertia: 0.22, displacement: 1.4,
      torqueCurve: [[800, 120], [1500, 200], [2000, 250], [3000, 250], [4000, 240], [5000, 225], [6000, 200], [6800, 165]],
      engineBraking: 0.055, frictionTorque: 22, turbo: { boost: 0.9, spoolRpm: 1800, lag: 0.35 },
    },
    gearbox: { ratios: [3.55, 2.05, 1.35, 0.98, 0.78, 0.64], finalDrive: 3.65, reverse: 3.20, efficiency: 0.92, shiftTime: 0.28, autoUpRpm: 0.72, autoDownRpm: 0.34 },
    brake: { maxTorque: 4600, bias: 0.63, handbrakeTorque: 1900, abs: true },
    aero: { cd: 0.30, frontalArea: 2.20, clFront: -0.12, clRear: -0.18, copHeight: 0.55 },
    color: 0xb8262b,
    rimColor: 0xc8ccd2,
  },
  sports: {
    id: 'sports',
    name: '后驱跑车',
    desc: '后驱 · 4.0L 自吸 · 大马力，油门要给得克制',
    length: 4.42, width: 1.92, height: 1.24, wheelbase: 2.62, track: 1.62, rideHeight: 0.115,
    totalMass: 1380,
    driveLayout: 'RWD',
    wheel: { radius: 0.335, width: 0.295, rimRadius: 0.229, unsprungMass: 34, inertia: 1.70, verticalStiffness: 310000, verticalDamping: 1800 },
    suspension: { bumpTravel: 0.115, droopTravel: 0.100, springRate: 48000, bumpDamping: 4200, reboundDamping: 5600, arb: 16000, camber: -1.6, toe: 0.05, travelCamberGain: 0.16 },
    tire: { muBase: 1.18, loadSensitivity: 0.26, peakSlipRatio: 0.10, peakSlipAngle: 7.2, corneringStiffness: 13.5, longitudinalStiffness: 15.0, falloff: 0.88, relaxLength: 0.42, rollingResistance: 0.014, pressureGrip: 1.0 },
    engine: {
      idleRpm: 900, redline: 8200, maxRpm: 8600, inertia: 0.30, displacement: 4.0,
      torqueCurve: [[1000, 300], [2000, 380], [3000, 420], [4000, 440], [5000, 450], [6000, 445], [7000, 420], [8000, 370]],
      engineBraking: 0.05, frictionTorque: 34, turbo: null,
    },
    gearbox: { ratios: [3.13, 2.10, 1.56, 1.24, 1.03, 0.84], finalDrive: 3.55, reverse: 2.90, efficiency: 0.93, shiftTime: 0.20, autoUpRpm: 0.80, autoDownRpm: 0.40 },
    brake: { maxTorque: 5200, bias: 0.62, handbrakeTorque: 2400, abs: true },
    aero: { cd: 0.33, frontalArea: 2.00, clFront: -0.35, clRear: -0.55, copHeight: 0.42 },
    color: 0xe0a411,
    rimColor: 0x2a2d33,
  },
  pickup: {
    id: 'pickup',
    name: '越野皮卡',
    desc: '四驱 · 3.5T 柴油 · 又重又高，撞东西最有分量',
    length: 5.42, width: 2.06, height: 1.90, wheelbase: 3.20, track: 1.72, rideHeight: 0.30,
    totalMass: 2380,
    driveLayout: 'AWD',
    wheel: { radius: 0.415, width: 0.275, rimRadius: 0.285, unsprungMass: 52, inertia: 3.00, verticalStiffness: 340000, verticalDamping: 2100 },
    suspension: { bumpTravel: 0.205, droopTravel: 0.185, springRate: 42000, bumpDamping: 3600, reboundDamping: 4800, arb: 7000, camber: -0.2, toe: 0.12, travelCamberGain: 0.06 },
    tire: { muBase: 0.94, loadSensitivity: 0.18, peakSlipRatio: 0.13, peakSlipAngle: 9.0, corneringStiffness: 9.5, longitudinalStiffness: 11.0, falloff: 0.92, relaxLength: 0.70, rollingResistance: 0.020, pressureGrip: 1.0 },
    engine: {
      idleRpm: 650, redline: 4200, maxRpm: 4600, inertia: 0.55, displacement: 3.5,
      torqueCurve: [[700, 420], [1200, 560], [1600, 620], [2000, 630], [2600, 600], [3200, 540], [3800, 470], [4300, 400]],
      engineBraking: 0.09, frictionTorque: 55, turbo: { boost: 0.6, spoolRpm: 1300, lag: 0.5 },
    },
    gearbox: { ratios: [3.90, 2.30, 1.55, 1.15, 0.86, 0.70], finalDrive: 3.90, reverse: 3.40, efficiency: 0.90, shiftTime: 0.42, autoUpRpm: 0.68, autoDownRpm: 0.32 },
    brake: { maxTorque: 6200, bias: 0.65, handbrakeTorque: 2600, abs: true },
    aero: { cd: 0.42, frontalArea: 3.10, clFront: -0.05, clRear: -0.05, copHeight: 0.85 },
    color: 0x2f6b4f,
    rimColor: 0x9aa0a6,
  },
  hatch: {
    id: 'hatch',
    name: '小型掀背',
    desc: '前驱 · 1.6L 自吸 · 轻巧灵活，适合特技场',
    length: 3.94, width: 1.72, height: 1.45, wheelbase: 2.48, track: 1.48, rideHeight: 0.15,
    totalMass: 1080,
    driveLayout: 'FWD',
    wheel: { radius: 0.295, width: 0.195, rimRadius: 0.195, unsprungMass: 30, inertia: 0.95, verticalStiffness: 220000, verticalDamping: 1300 },
    suspension: { bumpTravel: 0.150, droopTravel: 0.130, springRate: 24000, bumpDamping: 2200, reboundDamping: 3000, arb: 7000, camber: -0.4, toe: 0.10, travelCamberGain: 0.09 },
    tire: { muBase: 0.98, loadSensitivity: 0.20, peakSlipRatio: 0.12, peakSlipAngle: 8.5, corneringStiffness: 10.5, longitudinalStiffness: 12.0, falloff: 0.90, relaxLength: 0.60, rollingResistance: 0.014, pressureGrip: 1.0 },
    engine: {
      idleRpm: 800, redline: 6200, maxRpm: 6600, inertia: 0.16, displacement: 1.6,
      torqueCurve: [[800, 95], [1500, 140], [2500, 160], [3500, 158], [4500, 148], [5500, 132], [6300, 110]],
      engineBraking: 0.06, frictionTorque: 18, turbo: null,
    },
    gearbox: { ratios: [3.45, 1.95, 1.32, 1.00, 0.78, 0.62], finalDrive: 4.10, reverse: 3.15, efficiency: 0.91, shiftTime: 0.30, autoUpRpm: 0.74, autoDownRpm: 0.36 },
    brake: { maxTorque: 3200, bias: 0.64, handbrakeTorque: 1400, abs: true },
    aero: { cd: 0.32, frontalArea: 2.05, clFront: -0.10, clRear: -0.14, copHeight: 0.58 },
    color: 0x2f6fd0,
    rimColor: 0xb8bec6,
  },
};

export const CAR_LIST = Object.values(CAR_PRESETS);
