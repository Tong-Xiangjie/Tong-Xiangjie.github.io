// ============================================================================
//  车辆声音模块：GameAudio —— 零依赖，只用 Web Audio API
//
//  设计意图
//  --------
//  1. 模块顶层绝对不触碰 window / AudioContext，所有浏览器 API 只在方法内部访问，
//     因此本文件可以被 Node 直接 import 做静态检查；在无浏览器环境（或用户还没
//     点击页面导致 AudioContext 不可用）时，所有方法退化成空操作，绝不抛异常。
//  2. 常驻节点在 _ensure() 里一次性建好（延迟到第一次 resume()），之后每帧 update()
//     只做参数设定，不创建/销毁任何节点；只有碰撞 impact() 与换挡泄气声例外，
//     它们用完立刻 disconnect() + stop()，避免节点泄漏。
//  3. 发动机不是"一个振荡器"，而是分层合成：
//       基础频率 f0 = rpm/60 * (气缸数/2)   ← 点火（气缸爆发）频率
//       活塞脉冲层：sawtooth(f0) + square(0.5*f0) + sawtooth(2*f0) 叠加出粗糙的机械感
//       低频 sub 层：sine(f0*0.25)（即 rpm/60*0.5）给"轰"的胸腔共振
//       排气失真层：WaveShaperNode 非线性削波，制造排气爆音
//       共鸣层：lowpass，中心频率随 rpm 上升
//       进气/涡轮层：带通白噪声，rpm 与负荷高时出现
//       回火/泄压层：松油门瞬间的噪声爆发
//  4. 所有增益变化一律走 setTargetAtTime / linearRampToValueAtTime，杜绝直接赋值
//     造成的爆音；所有频率与增益都 clamp 到合法区间，避免 NaN 传进 Web Audio
//     导致整个节点图静音。
// ============================================================================

// ---------------------------------------------------------------------------
//  小工具（纯函数，无副作用，不依赖任何浏览器 API）
// ---------------------------------------------------------------------------

// 把任意输入夹到 [min, max]，NaN / Infinity 一律返回 fallback
function clamp(v, min, max, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 线性插值
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 稳定的 0..1 映射，等价于 clamp((v-a)/(b-a), 0, 1)，b === a 时返回 0
function ramp01(v, a, b) {
  if (b === a) return 0;
  return clamp((v - a) / (b - a), 0, 1, 0);
}

// 简化版 smoothstep，让某个量在区间两端过渡更自然
function smoothstep01(v, a, b) {
  const t = ramp01(v, a, b);
  return t * t * (3 - 2 * t);
}

// 布尔值转 0/1
function bit(v) {
  return v ? 1 : 0;
}

// 音频世界里的合法频率范围（union：Nyquist 上限以下都很安全）
const FREQ_MIN = 20;
const FREQ_MAX = 18000;

// 频率 clamp，fallback 缺省给 1000Hz
function clampFreq(f, fallback) {
  return clamp(f, FREQ_MIN, FREQ_MAX, fallback === undefined ? 1000 : fallback);
}

// 增益 clamp，永远落在 0..1，NaN 归 0（静音但绝不报错）
function clampGain(g) {
  return clamp(g, 0, 1, 0);
}

// 随机 0..1
function rand01() {
  return Math.random();
}

// ---------------------------------------------------------------------------
//  路面音色表：gain = 滚动噪声强度，freq = 带通中心频率（碎石/泥土明显更吵）
// ---------------------------------------------------------------------------
const SURFACE_PROFILE = {
  asphalt: { gain: 0.30, freq: 620, q: 0.80 },
  concrete: { gain: 0.38, freq: 900, q: 0.90 },
  gravel: { gain: 0.95, freq: 2400, q: 0.75 },
  dirt: { gain: 0.75, freq: 1500, q: 0.70 },
  grass: { gain: 0.48, freq: 1050, q: 0.60 },
  sand: { gain: 0.55, freq: 720, q: 0.55 },
  mud: { gain: 0.70, freq: 480, q: 0.65 },
};

const SURFACE_DEFAULT = SURFACE_PROFILE.asphalt;

// ---------------------------------------------------------------------------
//  碰撞音色表：kind 决定频段、时长倍率与谐波衰减速度
//    noiseFreq 噪声爆发中心频率 / toneBase 金属共振基频起点
//    spread 共振频率随机范围 / q 共振尖锐度 / decay 衰减快慢
// ---------------------------------------------------------------------------
const IMPACT_PROFILE = {
  metal: { noiseFreq: 2100, toneBase: 480, spread: 2600, q: 9.0, decay: 1.00, bright: 0.55 },
  plastic: { noiseFreq: 1200, toneBase: 300, spread: 900, q: 5.0, decay: 1.35, bright: 0.25 },
  glass: { noiseFreq: 5200, toneBase: 1500, spread: 1500, q: 14.0, decay: 0.85, bright: 0.90 },
  tyre: { noiseFreq: 380, toneBase: 190, spread: 260, q: 3.0, decay: 1.55, bright: 0.08 },
};

// 发动机声音层的调参集中在这里，方便整体"调音"
const ENGINE = {
  // 基础频率映射：f0 = rpm/60 * (气缸数/2)，用 sqrt 曲线压缩，低转听得清、
  // 高转不至于薄得刺耳（内置一个"感知上合理"的点火频率）
  cylinders: 4,
  perceivedCylinders: 6.0,
  subMul: 0.25,       // sub 频率 = f0 * 0.25
  lpfMul: 5.0,        // 共鸣低通截止 = f0 * 5
  lpfBase: 1600,
  lpfIdleMul: 1.5,    // 怠速时的低通倍数（影响"闷"的程度）
  gain: 0.55,         // 发动机总增益上限
  loadGainMin: 0.35,  // 收油时的增益下探值（发动机制动的低吟）
  subGain: 0.85,
  turboBase: 600,     // 进气噪声基频
  turboSpan: 3000,
  turboQ: 1.1,
  noiseIdle: 0.05,    // 机械噪声底噪
  noiseLoad: 0.40,
  idleSmooth: 0.35,   // 低转时的高频平滑
};

export class GameAudio {
  constructor() {
    // ---- 生命周期状态 ----
    this.ctx = null;
    this._disposed = false;
    this._failCount = 0;        // AudioContext 创建失败的次数，超过阈值就不再重试
    this._resumeCount = 0;      // 诊断用：resume() 成功建立上下文几次

    // ---- 用户设置 ----
    this.enabled = true;
    this.volume = 0.8;
    this._userVolume = 0.8;

    // ---- 节点仓库（全部在 _ensure() 里创建）----
    this.nodes = null;
    this.noiseBuf = null;

    // ---- 运行期平滑值（避免状态跳变带来爆音）----
    this.rpm = 0;
    this.rpmPrev = 0;
    this.load = 0;
    this.throttle = 0;
    this.throttlePrev = 0;
    this.speed = 0;
    this.damage = 0;
    this.shiftDip = 0;
    this.silentFrames = 0;

    // ---- 事件节流 / 回火逻辑 ----
    this._lastImpact = 0;
    this._lastOverrun = 0;
    this._popFuel = 0;
    this._shiftPrev = false;
    this._updateCount = 0;
  }

  // 是否已经拿到了可用的 AudioContext（游戏主循环可以据此显示"声音不可用"）
  get ready() {
    return !!this.ctx;
  }

  // 挂起时 AudioContext 依然存在，但没声音，提供一个小判断
  get running() {
    return !!(this.ctx && this.ctx.state === 'running');
  }

  // -------------------------------------------------------------------------
  //  节点图：只在 _ensure() 内被调用一次
  //  信号链：src → 各层 bus → master（增益 + 压缩）→ destination
  // -------------------------------------------------------------------------
  _ensure() {
    if (this._disposed || this._failCount >= 3) return false;
    if (this.ctx) return true;
    // 模块可能被 Node import；这里必须用 typeof 判断而不是直接读 window
    if (typeof window === 'undefined') return false;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (typeof Ctor !== 'function') {
      this._failCount = 3;
      return false;
    }

    let ctx;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (err) {
      // 浏览器有并发 AudioContext 数量限制，或者用户策略禁止，安静失败
      this._failCount += 1;
      return false;
    }
    if (!ctx) {
      this._failCount += 1;
      return false;
    }
    this.ctx = ctx;

    // ---- 共享白噪声缓冲：轮胎 / 风 / 排气 / 碰撞全部复用这一个 buffer ----
    const sampleRate = clamp(ctx.sampleRate, 8000, 96000, 48000);
    this.noiseBuf = ctx.createBuffer(1, Math.floor(sampleRate * 1.5), sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    // ---- 总线 ----
    const master = ctx.createGain();
    master.gain.value = this._masterLevel();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;   // 总线上轻压缩，防止叠加时削顶
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.20;

    // 极低频隔离，去掉 WaveShaper 产生的直流偏移
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 28;
    dcBlock.Q.value = 0.707;

    master.connect(dcBlock);
    dcBlock.connect(comp);
    comp.connect(ctx.destination);

    // 环境层总线：发动机 + 轮胎 + 风 + 路面，统一走 compressor 前的增益
    const ambient = ctx.createGain();
    ambient.gain.value = 1;
    ambient.connect(master);

    // ---- 发动机 ----
    const engine = this._buildEngine(ctx, ambient);
    // ---- 轮胎 / 风 / 路面 ----
    const noise = this._buildNoise(ctx, ambient);

    this.nodes = {
      master,
      comp,
      dcBlock,
      ambient,
      engine,
      noise,
      lastSurfaceKey: '',
    };
    return true;
  }

  // 母带电平：总音量 * 开关
  _masterLevel() {
    return this.enabled ? clampGain(this.volume) : 0;
  }

  // -------------------------------------------------------------------------
  //  发动机节点图
  //    oscHarm2 ─┐
  //    oscMain  ─┼→ pulseGain → lpfPulse → shaper → distAmp → lpfTone → engineGain
  //    oscHarm1 ─┘
  //    oscSub   ──→ subGain ───────────────────↗
  //    noise ──→ turboBP → turboGain ──────────↗
  // -------------------------------------------------------------------------
  _buildEngine(ctx, ambient) {
    // 基础频率倍增：f0 = rpm/60 * cylinders/2 里的 cylinders/2
    const base = ENGINE.cylinders / 2;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    const lpfTone = ctx.createBiquadFilter();
    lpfTone.type = 'lowpass';
    lpfTone.frequency.value = clampFreq(2200);
    lpfTone.Q.value = 0.9;

    const distAmp = ctx.createGain();
    distAmp.gain.value = 0.5;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this._makeDistortionCurve(42);
    shaper.oversample = '2x';

    const lpfPulse = ctx.createBiquadFilter();
    lpfPulse.type = 'lowpass';
    lpfPulse.frequency.value = clampFreq(4000);
    lpfPulse.Q.value = 0.7;

    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.8;

    // 三个活塞脉冲振荡器
    const oscMain = ctx.createOscillator();
    oscMain.type = 'sawtooth';
    oscMain.frequency.value = clampFreq(120);

    const oscHarm1 = ctx.createOscillator();
    oscHarm1.type = 'square';
    oscHarm1.frequency.value = clampFreq(60);

    const oscHarm2 = ctx.createOscillator();
    oscHarm2.type = 'sawtooth';
    oscHarm2.frequency.value = clampFreq(240);

    const gMain = ctx.createGain();
    gMain.gain.value = 0.70;
    const gHarm1 = ctx.createGain();
    gHarm1.gain.value = 0.42;
    const gHarm2 = ctx.createGain();
    gHarm2.gain.value = 0.30;

    oscMain.connect(gMain);
    oscHarm1.connect(gHarm1);
    oscHarm2.connect(gHarm2);
    gMain.connect(pulseGain);
    gHarm1.connect(pulseGain);
    gHarm2.connect(pulseGain);

    // 低音 sub：f = rpm/60 * 0.5 = f0 * 0.25
    const oscSub = ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = clampFreq(30);
    const subGain = ctx.createGain();
    subGain.gain.value = 0;
    const subSat = ctx.createWaveShaper();
    subSat.curve = this._makeDistortionCurve(6);
    oscSub.connect(subGain);
    subGain.connect(subSat);

    // 进气 / 涡轮白噪声
    const turboSrc = ctx.createBufferSource();
    turboSrc.buffer = this.noiseBuf;
    turboSrc.loop = true;
    const turboBP = ctx.createBiquadFilter();
    turboBP.type = 'bandpass';
    turboBP.frequency.value = clampFreq(900);
    turboBP.Q.value = ENGINE.turboQ;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboSrc.connect(turboBP);
    turboBP.connect(turboGain);

    // 汇合
    pulseGain.connect(lpfPulse);
    lpfPulse.connect(shaper);
    shaper.connect(distAmp);
    distAmp.connect(lpfTone);
    lpfTone.connect(engineGain);
    subSat.connect(engineGain);
    turboGain.connect(engineGain);
    engineGain.connect(ambient);

    // 启动常驻源（此时 ctx 通常还是 suspended，不会有声音）
    oscMain.start();
    oscHarm1.start();
    oscHarm2.start();
    oscSub.start();
    turboSrc.start();

    return {
      engineGain,
      lpfTone,
      lpfPulse,
      distAmp,
      pulseGain,
      oscMain,
      oscHarm1,
      oscHarm2,
      gMain,
      gHarm1,
      gHarm2,
      oscSub,
      subGain,
      turboBP,
      turboGain,
      sources: [oscMain, oscHarm1, oscHarm2, oscSub, turboSrc],
      base,
      f0: clampFreq(40),
    };
  }

  // -------------------------------------------------------------------------
  //  轮胎 / 风 / 路面 / 换挡泄气 节点图
  //    三个常驻噪声源分别进各自的带通，再汇入噪声总线
  // -------------------------------------------------------------------------
  _buildNoise(ctx, ambient) {
    const bus = ctx.createGain();
    bus.gain.value = 0.95;
    bus.connect(ambient);

    const makeLoop = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.start();
      return src;
    };

    // 轮胎纵向打滑（相对低沉、有颗粒感）
    const tyreSrc = makeLoop();
    const tyreBP = ctx.createBiquadFilter();
    tyreBP.type = 'bandpass';
    tyreBP.frequency.value = clampFreq(900);
    tyreBP.Q.value = 0.95;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    const tyreHP = ctx.createBiquadFilter();
    tyreHP.type = 'highpass';
    tyreHP.frequency.value = 240;
    tyreHP.Q.value = 0.7;
    tyreSrc.connect(tyreBP);
    tyreBP.connect(tyreHP);
    tyreHP.connect(tyreGain);
    tyreGain.connect(bus);

    // 轮胎侧滑（更尖锐的"吱——"）
    const skidSrc = makeLoop();
    const skidBP = ctx.createBiquadFilter();
    skidBP.type = 'bandpass';
    skidBP.frequency.value = clampFreq(2400);
    skidBP.Q.value = 5.0;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    skidSrc.connect(skidBP);
    skidBP.connect(skidGain);
    skidGain.connect(bus);

    // 风噪：低通，音量随 speed² 上升
    const windSrc = makeLoop();
    const windLP = ctx.createBiquadFilter();
    windLP.type = 'lowpass';
    windLP.frequency.value = clampFreq(900);
    windLP.Q.value = 0.6;
    const windHP = ctx.createBiquadFilter();
    windHP.type = 'highpass';
    windHP.frequency.value = 120;
    windHP.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windLP);
    windLP.connect(windHP);
    windHP.connect(windGain);
    windGain.connect(bus);

    // 路面滚动噪声：音色随 surface 变化
    const roadSrc = makeLoop();
    const roadBP = ctx.createBiquadFilter();
    roadBP.type = 'bandpass';
    roadBP.frequency.value = clampFreq(700);
    roadBP.Q.value = 0.8;
    const roadLP = ctx.createBiquadFilter();
    roadLP.type = 'lowpass';
    roadLP.frequency.value = clampFreq(6000);
    roadLP.Q.value = 0.7;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    roadSrc.connect(roadBP);
    roadBP.connect(roadLP);
    roadLP.connect(roadGain);
    roadGain.connect(bus);

    // 换挡泄气/顿挫：常驻但增益为 0，shifting 上升沿时用 ramp 打一个短包络，
    // 这样既不用每帧建节点，也不会在参数上出现跳变爆音
    const shiftSrc = makeLoop();
    const shiftHP = ctx.createBiquadFilter();
    shiftHP.type = 'highpass';
    shiftHP.frequency.value = clampFreq(1800);
    shiftHP.Q.value = 1.2;
    const shiftGain = ctx.createGain();
    shiftGain.gain.value = 0;
    shiftSrc.connect(shiftHP);
    shiftHP.connect(shiftGain);
    shiftGain.connect(bus);

    // 车损杂音：悬挂/轴承不顺的轻微摩擦嘶声，常驻但增益为 0，
    // 独立于换挡包络，避免两者共用增益互相打断
    const dmgSrc = makeLoop();
    const dmgBP = ctx.createBiquadFilter();
    dmgBP.type = 'bandpass';
    dmgBP.frequency.value = clampFreq(1500);
    dmgBP.Q.value = 1.4;
    const dmgGain = ctx.createGain();
    dmgGain.gain.value = 0;
    dmgSrc.connect(dmgBP);
    dmgBP.connect(dmgGain);
    dmgGain.connect(bus);

    return {
      bus,
      tyreBP,
      tyreGain,
      skidBP,
      skidGain,
      windLP,
      windGain,
      roadBP,
      roadLP,
      roadGain,
      shiftHP,
      shiftGain,
      dmgBP,
      dmgGain,
      sources: [tyreSrc, skidSrc, windSrc, roadSrc, shiftSrc, dmgSrc],
    };
  }

  // 软削波失真曲线：输入 -1..1，输出同样归一化，制造排气爆音的奇次谐波
  _makeDistortionCurve(amount) {
    const k = clamp(amount, 0, 400, 40);
    const n = 1024;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // -------------------------------------------------------------------------
  //  公开接口
  // -------------------------------------------------------------------------

  /**
   * 用户第一次交互后调用。幂等：重复调用安全；失败静默。
   * 在 Node / 无 AudioContext 环境下直接返回 false，不抛异常。
   */
  async resume() {
    if (this._disposed) return false;
    try {
      if (!this.ctx && !this._ensure()) return false;
      this._resumeCount += 1;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch (err) {
      return false;
    }
  }

  /** 切到后台时调用：挂起上下文省电，失败静默 */
  suspend() {
    if (this._disposed || !this.ctx) return;
    try {
      if (this.ctx.state === 'running') {
        const p = this.ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (err) {
      // 忽略：某些浏览器在状态切换竞态时会抛 InvalidStateError
    }
  }

  /** 静音开关 */
  setEnabled(on) {
    this.enabled = !!on;
    this._applyVolume();
  }

  /** 总音量 0..1 */
  setVolume(v) {
    this._userVolume = clamp(v, 0, 1, this._userVolume);
    this.volume = this._userVolume;
    this._applyVolume();
  }

  /** 内部：把母带增益平滑推向目标值（永不直接赋值） */
  _applyVolume() {
    if (!this.ctx || !this.nodes) return;
    const target = clampGain(this._masterLevel());
    try {
      const g = this.nodes.master.gain;
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(target, now, 0.05);
    } catch (err) {
      // 忽略
    }
  }

  /** 便捷开关：读取内部设置 */
  get settings() {
    return { enabled: this.enabled, volume: this.volume };
  }

  /**
   * 每帧调用一次。
   * @param {number} dt 帧间隔（秒）
   * @param {object} state 车辆状态（所有字段都可能缺失）
   */
  update(dt, state) {
    if (this._disposed) return;
    if (!this.ctx || !this.nodes) return;

    const c = clamp(dt, 0, 0.1, 1 / 60);
    this._updateCount += 1;
    const s = state || {};

    // ---- 读取状态（全部带默认值与 clamp）----
    const rpm = clamp(s.rpm, 0, 9000, 0);
    const redline = clamp(s.redline, 1000, 9000, 6500);
    const idleRpm = clamp(s.idleRpm, 300, 3000, 760);
    const throttle = clamp(s.throttle, 0, 1, 0);
    const loadRaw = s.load === undefined ? throttle : clamp(s.load, 0, 1, throttle);
    const speed = Math.abs(clamp(s.speed, -300, 300, 0));
    const gear = clamp(s.gear, -1, 12, 0);
    const shifting = !!s.shifting;
    const wheelSlip = clamp(s.wheelSlip, 0, 1, 0);
    const lateralSlip = clamp(s.lateralSlip, 0, 1, 0);
    const damaged = clamp(s.damaged, 0, 1, 0);
    const handbrake = clamp(s.handbrake, 0, 1, 0);
    const brake = clamp(s.brake, 0, 1, 0);
    const airborne = !!s.airborne;
    const surface = typeof s.surface === 'string' ? s.surface : 'asphalt';

    // 空挡 / 倒挡时的发动机负载补偿：离合脱开时转速更"自由"
    let load = loadRaw;
    if (gear === 0) load = Math.max(load, 0.05);
    if (gear === -1) load = Math.max(load, 0.10);

    // 平滑（音频参数按秒平滑，与帧率无关）
    this.rpm = lerp(this.rpm, rpm, 1 - Math.exp(-c / 0.045));
    this.load = lerp(this.load, load, 1 - Math.exp(-c / 0.06));
    this.speed = lerp(this.speed, speed, 1 - Math.exp(-c / 0.12));
    this.damage = lerp(this.damage, damaged, 1 - Math.exp(-c / 0.30));

    const rpmRatio = ramp01(this.rpm, idleRpm, Math.max(idleRpm + 400, redline));
    const loadS = this.load;
    const damage = this.damage;

    // ---- 换挡：先算"掉转速"的下潜量（先算是为了让本帧所有层都能听到换挡顿挫）----
    if (shifting) {
      this.shiftDip = Math.min(1, this.shiftDip + c / 0.05);
    } else {
      this.shiftDip = Math.max(0, this.shiftDip - c / 0.14);
    }
    const dip = this.shiftDip;

    // ---- 回火/泄压计时 ----
    if (this._popFuel > 0) this._popFuel = Math.max(0, this._popFuel - c);

    try {
      this._updateEngine(c, { rpmRatio, redline, idleRpm, dip, rpm, throttle, load: loadS, airborne });
      this._updateNoise(c, {
        surface,
        speed,
        wheelSlip,
        lateralSlip,
        handbrake,
        brake,
        airborne,
        damage,
      });
      this._updateEvents(c, {
        throttle,
        rpmRatio,
        gear,
        shifting,
        damaged,
        speed,
      });
    } catch (err) {
      // 任何 Web Audio 参数异常都不应该打断渲染循环
    }

    this.rpmPrev = this.rpm;
    this.throttlePrev = throttle;
    this._shiftPrev = shifting;
  }

  // -------------------------------------------------------------------------
  //  发动机层每帧更新
  // -------------------------------------------------------------------------
  _updateEngine(c, ctxState) {
    const n = this.nodes.engine;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const rpmRatio = ctxState.rpmRatio;
    const redline = ctxState.redline;
    const throttleTarget = clamp(ctxState.throttle, 0, 1, 0);

    // --- 点火频率：f0 = rpm/60 * (气缸数/2)，低频段保留真实脉冲感，
    //     55Hz 以上按 0.45 的斜率压缩，避免高转变成刺耳的蜂鸣 ---
    const realF = (this.rpm / 60) * n.base;
    const rawF = (this.rpm / 60) * ENGINE.perceivedCylinders;
    const shaped = Math.min(realF, 55) + Math.max(0, rawF - 55) * 0.45;
    const f0 = clampFreq(shaped, 20);

    // 换挡瞬间转速下潜 → 音高下滑（顿挫感的主要来源）
    const dipMul = 1 - dip * 0.12;
    const f = clampFreq(f0 * dipMul, 20);

    setParam(n.oscMain.frequency, f, now, 0.030);
    setParam(n.oscHarm1.frequency, clampFreq(f * 0.5, 20), now, 0.030);
    setParam(n.oscHarm2.frequency, clampFreq(f * 2, 20), now, 0.030);
    setParam(n.oscSub.frequency, clampFreq(f * ENGINE.subMul, 20), now, 0.040);

    // --- 谐波配比：转速越高，低次谐波让位给高次谐波（声音变"亮"）---
    const mainG = lerp(0.78, 0.52, rpmRatio);
    const harm1G = lerp(0.58, 0.22, rpmRatio);
    const harm2G = lerp(0.14, 0.40, smoothstep01(ramp01(this.rpm, 500, redline * 0.9), 0, 1));
    setParam(n.gMain.gain, clampGain(mainG), now, 0.05);
    setParam(n.gHarm1.gain, clampGain(harm1G), now, 0.05);
    setParam(n.gHarm2.gain, clampGain(harm2G), now, 0.05);

    // --- 共鸣低通：中心频率随 rpm 上升 ---
    const lpfTarget = clampFreq(
      lerp(ENGINE.lpfBase * 0.55, Math.max(f0 * ENGINE.lpfMul, ENGINE.lpfBase), rpmRatio) *
        (1 - dip * 0.25),
      400
    );
    setParam(n.lpfTone.frequency, lpfTarget, now, 0.05);
    setParam(n.lpfPulse.frequency, clampFreq(lpfTarget * 1.6, 500), now, 0.05);

    // --- 失真量：负荷越高越脏，车损再叠一点 ---
    const loadNow = clamp(ctxState.load, 0, 1, 0);
    setParam(n.distAmp.gain, clampGain(lerp(0.30, 0.92, loadNow) + this.damage * 0.10), now, 0.08);

    // --- 发动机总增益：油门/负荷 + 换挡下潜 + 进气噪声 ---
    const noiseFloor = ENGINE.noiseIdle * (1 - rpmRatio * 0.5);
    let engineGain = (ENGINE.loadGainMin + (1 - ENGINE.loadGainMin) * loadNow) *
      (1 - dip * 0.35) * (1 - 0.18 * bit(ctxState.airborne));
    engineGain = clampGain(engineGain * (1 + noiseFloor) * (1 - this.damage * 0.10));
    // 转速太低（熄火/起步）时整体淡出
    engineGain *= smoothstep01(this.rpm, 40, 320);
    setParam(n.engineGain.gain, clampGain(engineGain * ENGINE.gain), now, 0.05);

    // --- sub 低频：怠速与高负荷时更明显 ---
    const subAmt = clampGain((0.16 + 0.44 * loadNow) * (1 - rpmRatio * 0.30) * (1 - dip * 0.4));
    setParam(n.subGain.gain, subAmt, now, 0.06);

    // --- 进气 / 涡轮层：转速与负荷越高越明显 ---
    const turboAmt = clampGain(
      smoothstep01(this.rpm, ENGINE.turboBase, ENGINE.turboBase + ENGINE.turboSpan) *
        (0.10 + 0.32 * throttleTarget) *
        (1 - dip * 0.5)
    );
    setParam(n.turboGain.gain, turboAmt, now, 0.08);
    setParam(n.turboBP.frequency, clampFreq(f * 4 + 420, 200), now, 0.10);
  }

  // -------------------------------------------------------------------------
  //  轮胎 / 风 / 路面 / 换挡层每帧更新
  // -------------------------------------------------------------------------
  _updateNoise(c, st) {
    const n = this.nodes.noise;
    const now = this.ctx.currentTime;

    // --- 打滑：声音随 wheelSlip 上升 ---
    const slipL = smoothstep01(st.wheelSlip, 0.05, 0.85);
    const slipT = smoothstep01(st.lateralSlip, 0.03, 0.75);
    const moving = smoothstep01(st.speed, 0.6, 5.0);

    // 轮胎纵向：音量和频率都随打滑上升（0 也安全，不会出现 0 值异常）
    const tyreAmt = clampGain(slipL * (0.20 + 0.50 * moving) * 1.15);
    setParam(n.tyreGain.gain, tyreAmt, now, 0.04);
    setParam(n.tyreBP.frequency, clampFreq(760 + 900 * slipL + 60 * Math.min(st.speed, 60), 760), now, 0.05);

    // 侧滑：中心频率显著更高、Q 更大，听起来更"尖"
    const skidAmt = clampGain(slipT * (0.25 + 0.55 * moving) * 1.05);
    setParam(n.skidGain.gain, skidAmt, now, 0.04);
    setParam(n.skidBP.frequency, clampFreq(2450 + 2100 * slipT, 2400), now, 0.05);

    // 手刹低速拖胎：给一点额外的低频摩擦感
    const hbDrag = clampGain(st.handbrake * moving * 0.30);
    setParam(n.roadGain.gain, clampGain(this._roadAmount(st) + hbDrag), now, 0.06);

    // --- 风噪：音量随 speed² 上升，低通截止也随之打开 ---
    const s2 = (st.speed / 62) * (st.speed / 62);   // 62 m/s ≈ 223 km/h
    const windAmt = clampGain(Math.min(1, s2) * 0.55);
    setParam(n.windGain.gain, windAmt, now, 0.10);
    setParam(n.windLP.frequency, clampFreq(600 + 4200 * Math.min(1, s2), 900), now, 0.12);

    // --- 路面音色：surface 变化时平滑过渡，避免突变爆音 ---
    const key = st.surface;
    if (key !== this.nodes.lastSurfaceKey) {
      const p = SURFACE_PROFILE[key] || SURFACE_DEFAULT;
      setParam(n.roadBP.frequency, clampFreq(p.freq, 700), now, 0.15);
      setParam(n.roadBP.Q, clamp(p.q, 0.1, 20, 0.8), now, 0.15);
      setParam(n.roadLP.frequency, clampFreq(p.freq * 6 + 2000, 4000), now, 0.15);
      this.nodes.lastSurfaceKey = key;
    }

    // --- 车损：让滚动噪声略微增加，暗示悬挂/轴承不顺 ---
    const dmgNoise = clampGain(st.damage * moving * 0.16);
    setParam(n.dmgGain.gain, dmgNoise, now, 0.20);
  }

  // 路面滚动噪声强度（离地时几乎消失）
  _roadAmount(st) {
    const p = SURFACE_PROFILE[st.surface] || SURFACE_DEFAULT;
    const roll = smoothstep01(st.speed, 0.4, 4.0);
    const air = st.airborne ? 0 : 1;
    return clampGain(roll * air * p.gain * 0.55);
  }

  // -------------------------------------------------------------------------
  //  事件层：回火 / 换挡泄气 / 车损敲击
  // -------------------------------------------------------------------------
  _updateEvents(c, ev) {
    // --- 回火 / 泄压：油门从大变小（overrun），或换挡瞬间 ---
    const drop = clamp(ev.throttle - this.throttlePrev, -1, 1);
    if (drop < -0.35 && this.rpmPrev > 2600) {
      this._popFuel = 0.35;
    }
    if (ev.shifting && !this._shiftPrev) {
      this._popFuel = Math.max(this._popFuel, 0.30);
    }
    if (this._popFuel > 0.12 && this.rpm > 1800) {
      const chance = 0.035 + 0.16 * smoothstep01(this.rpm, 3000, 7000) + ev.damaged * 0.12;
      if (rand01() < chance) {
        const strength = clampGain(0.25 + 0.55 * smoothstep01(this.rpm, 2000, 7500) + ev.damaged * 0.2);
        this._playPop(strength, ev.damaged);
      }
    }

    // --- 换挡：shifting 上升沿触发一次短促的泄气"呲"声 ---
    // 用常驻噪声源 + 增益包络实现（避免换挡瞬间创建节点），频率从高扫回常态
    if (ev.shifting && !this._shiftPrev) {
      const now = this.ctx.currentTime;
      try {
        const g = this.nodes.noise.shiftGain.gain;
        g.cancelScheduledValues(now);
        // 从"当前值"起跳，避免从 0 硬切造成爆音
        const cur = Number.isFinite(g.value) ? Math.max(0, g.value) : 0;
        g.setValueAtTime(clampGain(cur), now);
        g.linearRampToValueAtTime(0.34, now + 0.015);
        g.linearRampToValueAtTime(0.0001, now + 0.20);

        // 高通频率快速抬到高处再回落：就是泄气阀"呲——"的滑动感
        const hp = this.nodes.noise.shiftHP.frequency;
        hp.cancelScheduledValues(now);
        hp.setValueAtTime(clampFreq(2400, 2400), now);
        hp.linearRampToValueAtTime(clampFreq(6200, 6200), now + 0.05);
        hp.setTargetAtTime(clampFreq(1800, 1800), now + 0.06, 0.05);
      } catch (err) {
        // 忽略
      }
    }
  }

  // 松油门回火/排气爆音：一次性噪声爆发 + 一点低频"闷响"
  _playPop(strength, damaged) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime;
    const dur = clamp(0.05 + strength * 0.09, 0.05, 0.20);

    try {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = clamp(1.6 + rand01() * 0.8, 0.5, 4);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = clampFreq(600 + rand01() * 2400, 800);
      bp.Q.value = clamp(1.0 + rand01() * 1.6, 0.1, 20, 1.2);

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = clampFreq(220, 120);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(clampGain(strength * 0.5), now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0008, now + dur);

      src.connect(bp);
      bp.connect(hp);
      hp.connect(g);
      g.connect(this.nodes.master);

      src.start(now);
      src.stop(now + dur + 0.02);

      // 车损高时加一声低频闷响（尾鼓回压声）
      let boom = null;
      if (damaged > 0.35 && rand01() < 0.5) {
        boom = ctx.createOscillator();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(clampFreq(120 + rand01() * 70, 80), now);
        boom.frequency.exponentialRampToValueAtTime(clampFreq(48, 40), now + dur);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0, now);
        bg.gain.linearRampToValueAtTime(clampGain(strength * 0.22), now + 0.006);
        bg.gain.exponentialRampToValueAtTime(0.0008, now + dur * 1.4);
        boom.connect(bg);
        bg.connect(this.nodes.master);
        boom.start(now);
        boom.stop(now + dur * 1.4 + 0.02);
        this._scheduleCleanup([src, boom], [bp, hp, g, bg], dur * 1.4 + 0.08);
        return;
      }
      this._scheduleCleanup([src], [bp, hp, g], dur + 0.08);
    } catch (err) {
      // 忽略：一次性音效失败不影响主循环
    }
  }

  // -------------------------------------------------------------------------
  //  碰撞音效：噪声爆发 + 若干随机频率的金属共振（用完即 disconnect）
  // -------------------------------------------------------------------------

  /**
   * @param {number} strength 0..1 撞击强度
   * @param {string} kind 'metal' | 'plastic' | 'glass' | 'tyre'
   */
  impact(strength, kind) {
    if (this._disposed || !this.ctx || !this.nodes || !this.noiseBuf) return;
    const s = clamp(strength, 0, 1, 0);
    if (s <= 0.001) return;
    // 同一帧里连续调用（多轮同时撞墙）时限制一下密度，避免削顶
    const now = this.ctx.currentTime;
    if (now - this._lastImpact < 0.035) return;
    this._lastImpact = now;

    const profile = IMPACT_PROFILE[kind] || IMPACT_PROFILE.metal;
    // 强度决定时长 0.15..0.9 秒
    const dur = clamp(0.15 + s * 0.75 * profile.decay, 0.15, 0.9);
    // 强度决定音量
    const peak = clampGain(0.25 + s * 0.70);

    try {
      // --- 1) 噪声爆发：撞击的"啪/哐" ---
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = clamp(0.8 + rand01() * 0.6, 0.5, 4);

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(clampFreq(profile.noiseFreq, 1200), now);
      bp.frequency.exponentialRampToValueAtTime(
        clampFreq(profile.noiseFreq * 0.30, 150),
        now + dur
      );
      bp.Q.value = clamp(0.7 + s * 1.6, 0.1, 20, 1.0);

      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = clampFreq(120, 60);

      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0, now);
      ng.gain.linearRampToValueAtTime(clampGain(peak * 0.85), now + 0.006);
      ng.gain.exponentialRampToValueAtTime(0.0008, now + dur * 0.55);

      src.connect(bp);
      bp.connect(hp);
      hp.connect(ng);
      ng.connect(this.nodes.master);
      src.start(now);
      src.stop(now + dur + 0.02);

      const nodesToKill = [bp, hp, ng];
      const srcsToKill = [src];

      // --- 2) 金属共振：200~3000Hz 的随机衰减正弦（玻璃/金属更多更高的分音）---
      const toneCount = kind === 'tyre' ? 1 : (kind === 'glass' ? 4 : 3);
      for (let i = 0; i < toneCount; i += 1) {
        const osc = this.ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        // 基频 + 逐步升高且带随机抖动的分音，落在 200..3000Hz
        const fTone = clamp(
          profile.toneBase * (1 + i * (0.6 + rand01() * 0.35)) + rand01() * profile.spread * 0.35,
          200,
          3000,
          800
        );
        osc.frequency.setValueAtTime(fTone, now);
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(60, fTone * 0.72),
          now + dur
        );

        const og = this.ctx.createGain();
        const tonePeak = clampGain(peak * lerp(profile.bright, 0.30, ramp01(i, 0, toneCount)) * (1 - i * 0.18));
        og.gain.setValueAtTime(0, now);
        og.gain.linearRampToValueAtTime(tonePeak, now + 0.004 + i * 0.002);
        og.gain.exponentialRampToValueAtTime(0.0006, now + dur * lerp(1, 0.55, ramp01(i, 0, toneCount)));

        // 让共振更有"金属味"：加一个窄带通
        const oq = this.ctx.createBiquadFilter();
        oq.type = 'bandpass';
        oq.frequency.value = fTone;
        oq.Q.value = clamp(profile.q + i * 1.5, 0.1, 30, 8);

        osc.connect(oq);
        oq.connect(og);
        og.connect(this.nodes.master);
        osc.start(now);
        osc.stop(now + dur + 0.02);

        srcsToKill.push(osc);
        nodesToKill.push(oq, og);
      }

      this._scheduleCleanup(srcsToKill, nodesToKill, dur + 0.10);
    } catch (err) {
      // 忽略：音效失败绝不能影响物理与渲染
    }
  }

  // 用定时器回收一次性节点（浏览器里有 setTimeout；Node 里也有，但这条路不会走到）
  _scheduleCleanup(sources, nodes, seconds) {
    const cleanup = () => {
      for (let i = 0; i < sources.length; i += 1) {
        try {
          sources[i].onended = null;
        } catch (err) { /* 忽略 */ }
      }
      for (let i = 0; i < nodes.length; i += 1) {
        try {
          nodes[i].disconnect();
        } catch (err) { /* 忽略 */ }
      }
      for (let i = 0; i < sources.length; i += 1) {
        try {
          sources[i].disconnect();
        } catch (err) { /* 忽略 */ }
      }
      for (let i = 0; i < sources.length; i += 1) {
        try {
          sources[i].stop();
        } catch (err) { /* 已经停了，忽略 */ }
      }
    };
    try {
      setTimeout(cleanup, Math.max(30, Math.round(seconds * 1000)));
    } catch (err) {
      // 没有 setTimeout 的环境（理论上不存在）就交给 GC
    }
  }

  /** 释放全部资源：停掉常驻源、断开节点、关闭上下文 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this.ctx && this.nodes) {
      const stopGroup = (sources) => {
        for (let i = 0; i < sources.length; i += 1) {
          try {
            sources[i].stop();
          } catch (err) { /* 忽略 */ }
        }
      };
      try {
        stopGroup(this.nodes.engine.sources);
        stopGroup(this.nodes.noise.sources);
      } catch (err) { /* 忽略 */ }
      try {
        this.nodes.master.disconnect();
      } catch (err) { /* 忽略 */ }
    }

    this.nodes = null;
    this.noiseBuf = null;

    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (err) { /* 忽略 */ }
    }
  }
}

// 内部：把 AudioParam 平滑推向目标值，绝不直接赋值（防爆音）
function setParam(param, value, now, timeConstant) {
  if (!param) return;
  const v = Number.isFinite(value) ? value : 0;
  try {
    param.setTargetAtTime(v, now, Math.max(0.001, timeConstant));
  } catch (err) {
    // 忽略
  }
}
