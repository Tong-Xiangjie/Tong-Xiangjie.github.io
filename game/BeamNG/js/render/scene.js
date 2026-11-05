// ============================================================================
//  场景与渲染器封装
//  · 天空：一个反面渲染的大球 + 自定义着色器（渐变 + 太阳光晕 + 地平线雾）
//  · 光照：一盏平行光当太阳（带阴影）+ 半球光当环境，分数随一天中的时间变化
//  · 阴影相机始终跟随车辆，保证近处阴影分辨率够用
//  所有 three.js 相关的东西都收在这里，物理层完全不依赖它。
// ============================================================================
import * as THREE from '../../vendor/three.module.js';

/** 画质档位：像素比上限 / 阴影贴图尺寸 / 视距 / 各向异性。 */
export const QUALITY_PRESETS = {
  low: { pixelRatio: 1.0, shadows: false, shadowMap: 1024, viewDistance: 400, anisotropy: 1, sky: false, iterations: 8 },
  medium: { pixelRatio: 1.25, shadows: true, shadowMap: 1536, viewDistance: 700, anisotropy: 2, sky: true, iterations: 10 },
  high: { pixelRatio: 1.6, shadows: true, shadowMap: 2048, viewDistance: 1100, anisotropy: 4, sky: true, iterations: 13 },
  ultra: { pixelRatio: 2.0, shadows: true, shadowMap: 4096, viewDistance: 1600, anisotropy: 8, sky: true, iterations: 16 },
};

const SKY_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uHaze;
void main() {
  vec3 d = normalize(vWorld);
  float h = clamp(d.y, -1.0, 1.0);
  // 天顶 → 地平线的渐变，地平线附近额外加一层"霞光"
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(uGround, col, smoothstep(-0.09, 0.06, h));
  float sun = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sun, 900.0) * 14.0;              // 太阳本体
  col += uSunColor * pow(sun, 8.0) * uHaze * 0.35;        // 太阳附近的散射
  col += uSunColor * pow(sun, 2.0) * uHaze * 0.06;        // 逆光时的整体提亮
  gl_FragColor = vec4(col, 1.0);
}`;

export class SceneView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = 'high';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias !== false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x8fb6d8, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.28, 6000);
    this.camera.position.set(0, 3, 8);

    // --- 太阳 / 环境光 ---------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xfff2df, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    const sc = this.sun.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42;
    sc.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbdd7f2, 0x4a4235, 1.0);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    // --- 天空球 ----------------------------------------------------------
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6).normalize() },
      uZenith: { value: new THREE.Color(0x2f6fbf) },
      uHorizon: { value: new THREE.Color(0xc9d9e8) },
      uGround: { value: new THREE.Color(0x555049) },
      uSunColor: { value: new THREE.Color(0xfff0d0) },
      uHaze: { value: 0.6 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.scene.fog = new THREE.FogExp2(0xb9cbdd, 0.0016);
    this._fogDensity = 0.0016;

    // 一天中的时间（0..1，0.25 = 正午）
    this.timeOfDay = 0.27;
    this.setTimeOfDay(this.timeOfDay);
    this.setQuality(opts.quality ?? 'high');
  }

  /** 设置一天中的时间：0/1 = 午夜，0.25 = 日出，0.5 = 正午，0.75 = 日落。 */
  setTimeOfDay(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    const ang = (this.timeOfDay - 0.25) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.35, Math.sin(ang), Math.cos(ang) * 0.72).normalize();
    const elev = dir.y;
    this.skyUniforms.uSunDir.value.copy(dir);

    // 太阳高度决定色温与强度：越接近地平线越红、越暗
    const day = Math.max(0, Math.min(1, (elev + 0.12) / 0.5));
    const dusk = Math.max(0, 1 - Math.abs(elev) * 4.2);
    const sunCol = new THREE.Color().setHSL(
      THREE.MathUtils.lerp(0.09, 0.13, day),
      THREE.MathUtils.lerp(0.85, 0.32, day),
      THREE.MathUtils.lerp(0.52, 0.72, day),
    );
    const zenith = new THREE.Color().setHSL(0.60, 0.62, THREE.MathUtils.lerp(0.06, 0.42, day));
    const horizon = new THREE.Color().setHSL(
      THREE.MathUtils.lerp(0.08, 0.58, day), THREE.MathUtils.lerp(0.45, 0.28, day),
      THREE.MathUtils.lerp(0.16, 0.82, day),
    );
    horizon.lerp(new THREE.Color(0xff9c52), dusk * 0.55);

    this.skyUniforms.uZenith.value.copy(zenith);
    this.skyUniforms.uHorizon.value.copy(horizon);
    this.skyUniforms.uSunColor.value.copy(sunCol);
    this.skyUniforms.uHaze.value = 0.25 + dusk * 1.1;

    const sunI = Math.max(0.02, day) * (2.9 - dusk * 0.7);
    this.sun.intensity = sunI;
    this.sun.color.copy(sunCol);
    this.hemi.intensity = 0.28 + day * 0.85;
    this.hemi.color.copy(horizon).lerp(new THREE.Color(0xffffff), 0.45);
    this.ambient.intensity = 0.06 + day * 0.16;
    this.renderer.toneMappingExposure = 1.15 - dusk * 0.18;

    const fogCol = horizon.clone().lerp(zenith, 0.25);
    this.scene.fog.color.copy(fogCol);
    this.renderer.setClearColor(fogCol, 1);
    if (this.sunDir) this.sunDir.copy(dir); else this.sunDir = dir.clone();
  }

  setQuality(name) {
    const q = QUALITY_PRESETS[name] ?? QUALITY_PRESETS.high;
    this.quality = name in QUALITY_PRESETS ? name : 'high';
    this.q = q;
    this.renderer.setPixelRatio(Math.min(q.pixelRatio, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.sky.visible = q.sky;
    this.scene.fog.density = this._fogDensity * (name === 'low' ? 1.5 : 1);
  }

  resize(w, h) {
    this.camera.aspect = Math.max(0.2, w / Math.max(1, h));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** 每帧调用：把太阳和天空球绑到摄像机附近，避免阴影相机跟着世界跑偏。 */
  follow(target) {
    const t = this.sunTarget.position;
    t.set(Math.round(target.x), 0, Math.round(target.z));
    this.sun.position.set(t.x + this.sunDir.x * 90, this.sunDir.y * 90 + 12, t.z + this.sunDir.z * 90);
    this.sky.position.set(target.x, 0, target.z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}

/** 包围球式的阴影相机自适应：让远处的大车也能完整投影。 */
export function fitShadowCamera(light, radius) {
  const c = light.shadow.camera;
  c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
  c.updateProjectionMatrix();
}
