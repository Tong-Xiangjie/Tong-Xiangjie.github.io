// ============================================================================
//  车辆装配：把车型预设变成一套可计算的软体结构
//    · 车身管状桁架（环向 + 纵向 + 斜撑 + 横向拉杆）
//    · 四个悬挂硬点（塔顶 + 上下摆臂内点），会随车体变形一起移动
//    · 发动机/油箱总成（有自己的质量，撞车时会被撕下来）
// ============================================================================
import { SoftBody, BEAM_RIGID } from '../phys/softbody.js';
import { Vec3, lerp, clamp } from '../core/math.js';
import { generateBodyGeometry, PROFILE_STATIONS, ZONE_STRENGTH, quadKind } from './spec.js';

const PI = Math.PI;

/** 把 12 个站位按 factor 细分，并对强度做线性插值（避免强度突变）。 */
function resampleStations(factor = 2) {
  const src = PROFILE_STATIONS.map((s) => ({ ...s, ...ZONE_STRENGTH[s.zone] }));
  if (factor <= 1) return src;
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i], b = src[i + 1];
    for (let k = 0; k < factor; k++) {
      const t = k / factor;
      const zone = t < 0.5 ? a.zone : b.zone;
      out.push({
        t: lerp(a.t, b.t, t),
        w: lerp(a.w, b.w, t),
        floor: lerp(a.floor, b.floor, t),
        sill: lerp(a.sill, b.sill, t),
        shoulder: lerp(a.shoulder, b.shoulder, t),
        glass: lerp(a.glass, b.glass, t),
        roof: lerp(a.roof, b.roof, t),
        zone,
        yieldStrain: lerp(a.yieldStrain, b.yieldStrain, t),
        breakStrain: lerp(a.breakStrain, b.breakStrain, t),
        massScale: lerp(a.massScale, b.massScale, t),
      });
    }
  }
  const last = src[src.length - 1];
  out.push({ ...last, t: last.t });
  return out;
}

/** 在给定 z 处插值站位的某个字段（用于悬挂硬点定位）。 */
function sampleStationField(stations, z, field) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    const za = a.t, zb = b.t;   // t 与 z 线性对应
    if (z >= za && z <= zb) {
      const s = (z - za) / Math.max(1e-6, zb - za);
      return lerp(a[field], b[field], s);
    }
  }
  return z < stations[0].t ? stations[0][field] : stations[stations.length - 1][field];
}

/**
 * 构建整车。
 * @param {object} spec  CAR_PRESETS 里的一项
 * @param {object} opts  { subdivision }
 */
export function buildVehicle(spec, opts = {}) {
  const subdiv = opts.subdivision ?? 2;
  const stationDefs = resampleStations(subdiv);
  const geometry = generateBodyGeometry(spec, stationDefs);
  const ringSize = geometry.ringSize;

  const body = new SoftBody(768, 6144);
  body.iterations = opts.iterations ?? 10;
  body.internalDamping = opts.internalDamping ?? 0.045;   // 车架内部阻尼
  // 速度阻尼会直接吃掉推力（0.05/s 在 20 m/s 时等于 1400 N 的隐形风阻），
  // 车辆有真正的空气阻力模型，这里只留一点点数值阻尼。
  body.linearDamping = opts.linearDamping ?? 0.0015;

  const wheelSpec = spec.wheel;
  const R = wheelSpec.radius;
  const halfW = spec.width / 2;
  const halfL = spec.length / 2;
  const axleFrontZ = -spec.wheelbase / 2;
  const axleRearZ = spec.wheelbase / 2;
  const wheelX = spec.track / 2;
  const sprungMass = spec.totalMass - 4 * wheelSpec.unsprungMass;

  // --- 质量分配 ---------------------------------------------------------
  const engineMass = sprungMass * 0.115;   // 发动机总重（按节点数均分）
  // 结构节点权重合计 1.8（塔顶 4×0.16 + 摆臂 8×0.10 + 油箱 4×0.09），这里归一化，
  // 否则整车实际质量会比 totalMass 多出 6%。
  const structMass = (sprungMass * 0.075) / 1.8;
  const ringMassTotal = sprungMass - engineMass - structMass;
  let massUnits = 0;
  for (const st of stationDefs) massUnits += st.massScale * ringSize;
  const massPerUnit = ringMassTotal / Math.max(1e-6, massUnits);

  // --- 1. 车身环节点（几何下标 == 物理下标） ----------------------------
  const stationNodes = [];
  for (let si = 0; si < stationDefs.length; si++) {
    const st = stationDefs[si];
    const ring = geometry.stations[si].ring;
    stationNodes.push(ring);
    for (const ni of ring) {
      const n = geometry.nodes[ni];
      const created = body.addNode(n.x, n.y, n.z, {
        mass: massPerUnit * st.massScale,
        radius: 0.155,
        friction: 0.55,
        restitution: 0.06,
        group: 0,
        tag: `body:${n.part}`,
      });
      if (created !== ni) throw new Error(`节点下标错位: ${created} != ${ni}`);
    }
  }

  // --- 2. 结构节点：悬挂塔顶 / 摆臂内点 / 发动机 / 油箱 -------------------
  const towerY = R + 0.60 * (spec.height / 1.47);
  const towerX = halfW * 0.62;
  const armInsetX = halfW * 0.34;
  const floorYatAxle = (z) => sampleStationField(stationDefs, z / halfL, 'floor') * (spec.height / 1.52);

  const corners = [];
  for (const axle of ['front', 'rear']) {
    const az = axle === 'front' ? axleFrontZ : axleRearZ;
    for (const side of [-1, 1]) {
      const name = `${axle === 'front' ? 'F' : 'R'}${side < 0 ? 'L' : 'R'}`;
      const towerIdx = body.addNode(side * towerX, towerY, az, {
        mass: structMass * 0.16, radius: 0.11, friction: 0.6, group: 2, tag: `${name}_tower`,
      });
      const armF = body.addNode(side * armInsetX, floorYatAxle(az - 0.32) + 0.02, az - 0.32, {
        mass: structMass * 0.10, radius: 0.10, friction: 0.6, group: 2, tag: `${name}_armInF`,
      });
      const armR = body.addNode(side * armInsetX, floorYatAxle(az + 0.32) + 0.02, az + 0.32, {
        mass: structMass * 0.10, radius: 0.10, friction: 0.6, group: 2, tag: `${name}_armInR`,
      });
      // 找最近的环节点做力分配
      const near = nearestRingNodes(geometry, az, side, 2);
      corners.push({
        name, axle, side, axleZ: az,
        towerIdx, armF, armR, near,
        designCenter: new Vec3(side * wheelX, R, az),
        restLength: 0, minLength: 0, maxLength: 0,   // 稍后填充
      });
    }
  }

  // --- 3. 发动机 + 油箱 --------------------------------------------------
  const engineNodes = [];
  const engZ = -halfL * 0.66;
  const engY = R + 0.34 * (spec.height / 1.47);
  const engineNodeMass = engineMass / 12;          // 2(x) × 2(y) × 3(z)
  for (let ix = -1; ix <= 1; ix += 2) {
    for (let iy = 0; iy <= 1; iy++) {
      for (let iz = -1; iz <= 1; iz++) {
        const i = body.addNode(
          ix * spec.width * 0.19,
          engY + iy * 0.34,
          engZ + iz * 0.30,
          { mass: engineNodeMass, radius: 0.16, friction: 0.5, group: 1, tag: 'engine' },
        );
        engineNodes.push(i);
      }
    }
  }
  const tankNodes = [];
  const tankZ = halfL * 0.72;
  for (const ix of [-0.5, 0.5]) {
    for (const iz of [-0.25, 0.25]) {
      const i = body.addNode(ix * spec.width * 0.5, R + 0.14, tankZ + iz, {
        mass: structMass * 0.09, radius: 0.14, friction: 0.5, group: 2, tag: 'fuel_tank',
      });
      tankNodes.push(i);
    }
  }

  // --- 4. 梁 ------------------------------------------------------------
  const beamOpts = (st, kind) => {
    const yieldBase = st.yieldStrain, breakBase = st.breakStrain;
    if (kind === 'ring') return { type: BEAM_RIGID, yieldStrain: yieldBase * 1.15, breakStrain: breakBase * 1.15, plasticity: 0.35, group: 0 };
    if (kind === 'long') return { type: BEAM_RIGID, yieldStrain: yieldBase, breakStrain: breakBase, plasticity: 0.30, group: 1 };
    if (kind === 'diag') return { type: BEAM_RIGID, yieldStrain: yieldBase * 1.5, breakStrain: breakBase * 0.70, plasticity: 0.55, group: 2 };
    if (kind === 'cross') return { type: BEAM_RIGID, yieldStrain: yieldBase * 1.3, breakStrain: breakBase * 0.95, plasticity: 0.40, group: 3 };
    return { type: BEAM_RIGID, yieldStrain: yieldBase, breakStrain: breakBase, plasticity: 0.3, group: 4 };
  };

  // A. 环向
  for (let si = 0; si < stationDefs.length; si++) {
    const ring = stationNodes[si], st = stationDefs[si];
    for (let k = 0; k < ringSize; k++) {
      body.addBeam(ring[k], ring[(k + 1) % ringSize], beamOpts(st, 'ring'));
    }
  }
  // B. 纵向
  for (let si = 0; si < stationDefs.length - 1; si++) {
    const a = stationNodes[si], b = stationNodes[si + 1];
    const mid = { ...stationDefs[si] };
    for (const f of ['yieldStrain', 'breakStrain']) mid[f] = (stationDefs[si][f] + stationDefs[si + 1][f]) * 0.5;
    for (let k = 0; k < ringSize; k++) body.addBeam(a[k], b[k], beamOpts(mid, 'long'));
  }
  // C. 斜撑（每个四边形一条对角线，方向交替形成 X 形）
  for (let si = 0; si < stationDefs.length - 1; si++) {
    const a = stationNodes[si], b = stationNodes[si + 1], st = stationDefs[si];
    for (let k = 0; k < ringSize; k++) {
      const k2 = (k + 1) % ringSize;
      if ((si + k) % 2 === 0) body.addBeam(a[k], b[k2], beamOpts(st, 'diag'));
      else body.addBeam(a[k2], b[k], beamOpts(st, 'diag'));
    }
  }
  // D. 横向拉杆（门槛、肩线、车顶）
  const crossPairs = [[1, 11], [2, 10], [3, 9], [5, 7]];
  for (let si = 0; si < stationDefs.length; si++) {
    const ring = stationNodes[si], st = stationDefs[si];
    for (const [i, j] of crossPairs) body.addBeam(ring[i], ring[j], beamOpts(st, 'cross'));
  }

  // E. 悬挂硬点与车身的连接
  const axleZper = { front: axleFrontZ, rear: axleRearZ };
  for (const c of corners) {
    const st = stationDefs[0];
    // 悬挂塔/摆臂：结实但不是无敌。阈值 0.11 取自实测——日常驾驶这里
    // 的峰值应变只有 0.010，50 km/h 撞墙 0.056，100 km/h 0.109，140 km/h 0.127。
    // 于是"轮子飞出去"只会在真正的重撞里发生。
    const stiff = { yieldStrain: 0.035, breakStrain: 0.11, plasticity: 0.2, group: 5 };
    // 塔顶那几根"焊点"刻意做成薄弱环节：实测日常驾驶这里峰值应变只有 0.009，
    // 50 km/h 撞墙 0.053，100 km/h 0.099，140 km/h 0.122。阈值 0.032 让它在
    // 重撞里成组断开——断掉一半，轮子就真的飞出去了。
    const weld = { yieldStrain: 0.015, breakStrain: 0.032, plasticity: 0.45, group: 5 };
    // 真正把车轮吊在车身上的那一小组梁（塔顶 → 车身 / 摆臂）。
    // 掉轮只看这几根：原来 wheel.js 把所有碰到塔顶节点的梁都算进去
    // （前轮 25 根），要求"存活 < 3"等于要求断 23 根，永远不可能发生。
    c.mountBeams = [];
    for (const ni of c.near) {
      c.mountBeams.push(body.addBeam(c.towerIdx, ni, { ...weld, type: BEAM_RIGID }));
    }
    c.mountBeams.push(body.addBeam(c.towerIdx, c.armF, { ...weld, type: BEAM_RIGID }));
    c.mountBeams.push(body.addBeam(c.towerIdx, c.armR, { ...weld, type: BEAM_RIGID }));
    body.addBeam(c.armF, c.armR, { ...stiff, type: BEAM_RIGID });
    // 摆臂内点连到底盘纵梁
    for (const ni of c.near) {
      body.addBeam(c.armF, ni, { ...stiff, type: BEAM_RIGID });
      body.addBeam(c.armR, ni, { ...stiff, type: BEAM_RIGID });
    }
    // 左右塔顶之间加一根横梁（顶吧），提升扭转刚度
    const other = corners.find((o) => o.axle === c.axle && o !== c);
    if (other && c.side < 0) body.addBeam(c.towerIdx, other.towerIdx, { ...stiff, type: BEAM_RIGID });
  }

  // F. 发动机与油箱的固定（撞车时会断）
  const engMount = { yieldStrain: 0.02, breakStrain: 0.06, plasticity: 0.6, group: 6 };
  for (const axle of ['front']) {
    const cs = corners.filter((c) => c.axle === axle);
    for (const e of engineNodes) {
      for (const c of cs) {
        body.addBeam(e, c.armF, { ...engMount, type: BEAM_RIGID });
      }
    }
    // 发动机与前端环节点的连接（必须左右对称：1/3/5 ↔ 11/9/7）
    const frontStations = stationNodes.slice(0, Math.max(2, Math.round(stationDefs.length * 0.18)));
    for (const e of engineNodes) {
      for (const ring of frontStations) {
        for (const k of [0, 1, 3, 5, 7, 9, 11]) body.addBeam(e, ring[k], { ...engMount, type: BEAM_RIGID });
      }
    }
  }
  const tankMount = { yieldStrain: 0.03, breakStrain: 0.10, plasticity: 0.4, group: 6 };
  for (const t of tankNodes) {
    for (const ni of nearestRingNodes(geometry, tankZ, 1, 2)) body.addBeam(t, ni, { ...tankMount, type: BEAM_RIGID });
    for (const ni of nearestRingNodes(geometry, tankZ, -1, 2)) body.addBeam(t, ni, { ...tankMount, type: BEAM_RIGID });
  }

  // --- 5. 悬挂几何 ------------------------------------------------------
  const springRate = spec.suspension.springRate;
  const tireK = spec.wheel.verticalStiffness ?? 250000;
  // 由实际节点质量反推前后配重：改了质量分布就不该再想当然用 54:46
  let mTot = 0, mz = 0;
  for (let i = 0; i < body.nodeCount; i++) { mTot += body.mass[i]; mz += body.mass[i] * body.pz[i]; }
  const comZ = mz / Math.max(1e-6, mTot);
  const frontShare = clamp((axleRearZ - comZ) / (axleRearZ - axleFrontZ), 0.25, 0.75);
  let refTireDefl = 0;
  for (const c of corners) {
    const tower = new Vec3(body.px[c.towerIdx], body.py[c.towerIdx], body.pz[c.towerIdx]);
    const L0 = tower.distanceTo(c.designCenter);
    c.axis = new Vec3().subVectors(c.designCenter, tower).normalize();
    // 主销是倾斜的，弹簧只需要平衡轮胎垂向力沿轴线的分量
    const tiltY = Math.max(0.3, Math.abs(c.axis.y));
    const loadShare = c.axle === 'front' ? frontShare : 1 - frontShare;
    const springLoad = (mTot * loadShare / 2) * 9.81;               // 该角簧上重量
    // 静力平衡（主销倾斜时不能简单地把重量除以 tiltY）：
    //   车身竖直：tiltY·Fs + (1-tiltY²)·Fz = W_s
    //   车轮竖直：Fz = W_s + W_u          （地面必须托住整个角）
    //   ⇒ Fz = W_s + W_u ,  Fs = (W_s - (1-tiltY²)·Fz) / tiltY
    const W_u = spec.wheel.unsprungMass * 9.81;
    const Fz = springLoad + W_u;
    const Fs = Math.max(200, (springLoad - (1 - tiltY * tiltY) * Fz) / tiltY);
    const sag = clamp(Fs / springRate, 0.01, spec.suspension.bumpTravel * 0.85);
    c.designLength = L0;
    c.springRest = L0 + sag;                                // 空载自由长度
    c.sag = sag;                                            // 静态压缩量（渐进段起点）
    c.minLength = L0 - spec.suspension.bumpTravel;
    c.maxLength = L0 + spec.suspension.droopTravel;
    c.staticLoad = Fz;
    c.loadShare = loadShare;
    c.staticTireDeflection = Fz / tireK;
    refTireDefl += c.staticTireDeflection;
  }
  refTireDefl /= Math.max(1, corners.length);

  // --- 6. 参考坐标系（用于从变形后的车体反推姿态） ----------------------
  //  forward 用四个塔顶/摆臂节点定义：它们出厂时等高，所以前向轴不会被
  //  "车头比车尾矮"这种外形差异带出虚假俯角（否则一给初速度车就往下扎）。
  //  up 用车顶/车底，两组节点必须左右严格对称，否则整车会自己侧倾。
  //  环索引：0=floorC 1=floorR 2=sillR 3=shoulderR 4=glassR 5=roofR
  //          6=roofC  7=roofL 8=glassL 9=shoulderL 10=sillL 11=floorL
  const frameFront = [], frameRear = [], frameRoof = [], frameFloor = [];
  for (const c of corners) {
    if (c.axle === 'front') { frameFront.push(c.towerIdx, c.armF, c.armR); }
    else { frameRear.push(c.towerIdx, c.armF, c.armR); }
  }
  for (let si = 0; si < stationDefs.length; si++) {
    const t = stationDefs[si].t, ring = stationNodes[si];
    if (t > -0.2 && t < 0.6) for (const k of [5, 6, 7]) frameRoof.push(ring[k]);
    if (t > -0.6 && t < 0.6) for (const k of [0, 1, 2, 10, 11]) frameFloor.push(ring[k]);
  }
  // 参考质心的 y（出厂姿态）—— 用于把车精确放到地面上
  let refCy = 0, refN = 0;
  for (const i of frameFront) { refCy += body.py[i]; refN++; }
  for (const i of frameRear) { refCy += body.py[i]; refN++; }
  refCy /= Math.max(1, refN);

  // --- 7. 损伤分区（HUD 用） -------------------------------------------
  const regions = buildDamageRegions(stationDefs, stationNodes, spec, corners, engineNodes);

  body.captureInitialState();

  return {
    spec, geometry, stationDefs, stationNodes, body,
    corners, engineNodes, tankNodes,
    frameFront, frameRear, frameRoof, frameFloor,
    regions, sprungMass, wheelX, R, refCy, refTireDefl,
    halfW, halfL, axleFrontZ, axleRearZ,
  };
}

/** 找离指定 (z, side) 最近的若干环节点。 */
function nearestRingNodes(geometry, z, side, count) {
  const stations = geometry.stations;
  let bestSi = 0, bestD = Infinity;
  for (let i = 0; i < stations.length; i++) {
    const d = Math.abs(stations[i].z - z);
    if (d < bestD) { bestD = d; bestSi = i; }
  }
  const ring = stations[bestSi].ring;
  // 环索引 1..5 是右侧，7..11 是左侧
  const order = side < 0 ? [11, 10, 9, 8, 7] : [1, 2, 3, 4, 5];
  const picked = [];
  for (let k = 0; k < count && k < order.length; k++) picked.push(ring[order[k]]);
  // 相邻站位的同侧节点也算进来，让力分配更均匀
  if (bestSi + 1 < stations.length && picked.length < count + 2) picked.push(stations[bestSi + 1].ring[order[0]]);
  return picked;
}

function buildDamageRegions(stationDefs, stationNodes, spec, corners, engineNodes) {
  const regions = [];
  const push = (name, nodes) => { if (nodes.length) regions.push({ name, nodes }); };
  const byZone = (pred) => {
    const out = [];
    for (let si = 0; si < stationDefs.length; si++) {
      if (pred(stationDefs[si], si)) out.push(...stationNodes[si]);
    }
    return out;
  };
  push('前保险杠', byZone((s) => s.zone === 'crush' && s.t < 0));
  push('发动机舱', byZone((s) => s.zone === 'engine'));
  push('前风挡/A柱', byZone((s, si) => s.zone === 'cabin' && s.t < 0.25));
  push('乘员舱/车门', byZone((s) => s.zone === 'cabin' && s.t >= 0.25));
  push('行李舱', byZone((s) => s.zone === 'deck'));
  push('后保险杠', byZone((s) => s.zone === 'crush' && s.t > 0));
  push('发动机总成', engineNodes);
  push('悬挂塔顶', corners.map((c) => c.towerIdx));
  return regions;
}
