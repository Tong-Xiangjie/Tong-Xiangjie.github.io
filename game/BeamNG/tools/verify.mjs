// ============================================================================
//  用 Chrome DevTools Protocol 做真实浏览器验证
//   · 收集 console 错误 / 未捕获异常 / 资源加载失败
//   · 在页面里跑一段断言脚本，把结果取回来
//   · 截图并做像素统计（判断画面不是纯色 / 有没有天空与地面）
//  用法：node tools/verify.mjs [url] [--shot out.png] [--wait 6000]
// ============================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:8811/index.html';
const waitMs = Number(readFlag('--wait') ?? 7000);
const shotPath = readFlag('--shot');
const extraEval = readFlag('--eval');
const scenario = readFlag('--scenario');
const glShot = readFlag('--glshot');
const port = 9333 + Math.floor(Math.random() * 400);

function readFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

// ============================================================================
//  端到端场景：在页面里合成键盘事件，真的把车开出去，再读回遥测
//  每个场景返回 { ok, notes, ... }；ok=false 会让脚本以非零码退出。
// ============================================================================
const SCENARIOS = {
  // 全油门直线加速。注意用"仿真时间"而不是墙上时间：headless 里渲染只有
  // 8 fps，物理帧又被 MAX_CATCHUP 限流，墙上 8 秒可能只推进了 2.5 秒物理。
  drive: () => (async () => {
    const g = window.__game, v = g.vehicle;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const simWait = async (secs, cap = 120000) => {
      const t0 = v.time, w0 = performance.now();
      while (v.time - t0 < secs && performance.now() - w0 < cap) await sleep(40);
      return v.time - t0;
    };
    g.setMode('free');
    g.placeVehicle(0, 120, 0);      // 直线跑道起点，8 秒刚好跑到 z≈0
    await sleep(600);
    const samples = [];
    key('keydown', 'KeyW');
    for (let i = 0; i < 8; i++) {
      await simWait(1);
      samples.push({
        t: i + 1, kmh: Math.round(v.speedKmh), rpm: Math.round(v.drivetrain.rpm), gear: v.drivetrain.gear,
        x: Math.round(v.position.x * 100) / 100, z: Math.round(v.position.z * 100) / 100,
      });
    }
    key('keyup', 'KeyW');
    const lat = Math.max(...samples.map((s) => Math.abs(s.x)));
    const top = Math.max(...samples.map((s) => s.kmh));
    const notes = [];
    if (top < 60) notes.push('加速太慢: ' + top + ' km/h');
    if (lat > 6) notes.push('跑偏: 横向 ' + lat + ' m');
    return {
      ok: notes.length === 0, notes, topKmh: top, lateralDrift: lat, samples,
      damagePct: Math.round(v.telemetry().damage * 1000) / 10, brokenBeams: v.body.stats.brokenBeams,
      physicsMs: Math.round(g.physicsMs * 100) / 100,
    };
  })(),

  // 100→0 制动距离（跑在仿真时间里）
  brake: () => (async () => {
    const g = window.__game, v = g.vehicle;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const simWait = async (secs, cap = 120000) => {
      const t0 = v.time, w0 = performance.now();
      while (v.time - t0 < secs && performance.now() - w0 < cap) await sleep(40);
    };
    g.setMode('free');
    // 必须在沥青跑道上量（草地上 μ 只有 0.6），而且要躲开 z=-70 那堵撞墙
    g.placeVehicle(0, -150, 0);
    await simWait(1);
    v.launch(100 / 3.6);
    await simWait(0.4);
    const z0 = v.position.z, t0 = v.time;
    key('keydown', 'KeyS');
    const w0 = performance.now();
    while (Math.abs(v.speedKmh) > 1.5 && performance.now() - w0 < 60000) await sleep(40);
    key('keyup', 'KeyS');
    const dist = Math.abs(v.position.z - z0);
    const notes = [];
    if (dist < 18 || dist > 115) notes.push('制动距离异常: ' + dist.toFixed(1) + ' m');
    return {
      ok: notes.length === 0, notes, startKmh: 100,
      stopDistanceM: Math.round(dist * 10) / 10, simSeconds: Math.round((v.time - t0) * 100) / 100,
    };
  })(),

  // 全油门撞混凝土墙：溃缩量、峰值 g、断梁
  crash: () => (async () => {
    const g = window.__game, v = g.vehicle;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.setMode('crash');
    await sleep(900);
    key('keydown', 'KeyW');
    const w0 = performance.now();
    let peak = 0;
    while (performance.now() - w0 < 90000) {
      await sleep(60);
      if (v.maxImpactG > peak) peak = v.maxImpactG;
      if (v.time > 4 && Math.abs(v.speedKmh) < 3 && v.maxImpactG > 1) break;
    }
    key('keyup', 'KeyW');
    await sleep(900);
    const tele = v.telemetry();
    const notes = [];
    if (peak < 8) notes.push('没测到明显撞击: ' + peak.toFixed(1) + ' g');
    if (tele.deformation < 0.05) notes.push('几乎没形变: ' + tele.deformation.toFixed(3) + ' m');
    return {
      ok: notes.length === 0, notes,
      peakG: Math.round(peak * 10) / 10,
      avgCrushCm: Math.round(tele.deformation * 1000) / 10,
      maxCrushCm: Math.round(v.maxDeformation * 1000) / 10,
      crushedAreaPct: Math.round(tele.crushedArea * 100),
      brokenBeams: v.body.stats.brokenBeams, totalBeams: v.body.beamCount,
      wheelsDetached: v.wheels.filter((w) => w.detached).length,
      integrityPct: Math.round(tele.integrity * 100), restKmh: Math.round(Math.abs(v.speedKmh)),
      bodyDamagePct: Math.round(tele.damage * 1000) / 10,
    };
  })(),

  // 绕桩：连续打方向，检查不散架、节点不 NaN
  slalom: () => (async () => {
    const g = window.__game, v = g.vehicle;
    const key = (t2, code) => window.dispatchEvent(new KeyboardEvent(t2, { code, bubbles: true }));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.setMode('free');
    g.placeVehicle(0, 150, 0);
    await sleep(600);
    key('keydown', 'KeyW');
    await sleep(4000);                       // 先加速一段（时间是仿真时间的 3 倍左右）
    const marks = [];
    for (let i = 0; i < 10; i++) {
      key(i % 2 ? 'keydown' : 'keyup', 'KeyA');
      key(i % 2 ? 'keyup' : 'keydown', 'KeyD');
      await sleep(900);
      marks.push({ kmh: Math.round(v.speedKmh), y: Math.round(v.position.y * 100) / 100, g: Math.round(v.gForce.length() * 100) / 100 });
    }
    key('keyup', 'KeyW'); key('keyup', 'KeyA'); key('keyup', 'KeyD');
    let nan = 0;
    const b = v.body;
    for (let i = 0; i < b.nodeCount; i++) if (!Number.isFinite(b.px[i] + b.py[i] + b.pz[i])) nan++;
    const notes = [];
    if (nan) notes.push('NaN 节点 ' + nan);
    if (Math.max(...marks.map((m) => m.kmh)) < 20) notes.push('绕桩时速度上不去: ' + Math.max(...marks.map((m) => m.kmh)));
    return { ok: notes.length === 0, notes, nanNodes: nan, maxY: Math.max(...marks.map((m) => m.y)), minY: Math.min(...marks.map((m) => m.y)), marks };
  })(),

  // 物理 CPU 耗时（引擎自己测的，不受渲染帧率影响）
  perf: () => (async () => {
    const g = window.__game, v = g.vehicle;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.setMode('free');
    g.placeVehicle(0, 150, 0);
    await sleep(2500);
    const render = [];
    for (let i = 0; i < 4; i++) { render.push(Math.round(g.fps * 10) / 10); await sleep(700); }
    return {
      ok: true,
      physicsMsPerFrame: Math.round(g.physicsMs * 100) / 100,
      iterations: v.body.iterations, substeps: 4, beams: v.body.beamCount, nodes: v.body.nodeCount,
      renderSamples: render,
      drawCalls: g.view.renderer.info.render.calls,
      triangles: g.view.renderer.info.render.triangles,
      chunks: g.world.terrainMesh.chunks.size,
      quality: g.view.quality,
    };
  })(),
};

const userDir = path.join(os.tmpdir(), `dsh-verify-${port}`);
// --size 1280x620 可以模拟笔记本那种"矮"视口，用来验证弹窗不会被裁掉
const sizeOpt = readFlag('--size') ?? '1600x900';
const windowSize = /^\d+x\d+$/.test(sizeOpt) ? sizeOpt.replace('x', ',') : '1600,900';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
  `--window-size=${windowSize}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

const errors = [];
const warnings = [];
const logs = [];
let cdp = null;
let exitCode = 0;

try {
  // 等 Chrome 起来
  let version = null;
  for (let i = 0; i < 80; i++) {
    try { version = await getJson('/json/version'); break; } catch { await sleep(150); }
  }
  if (!version) throw new Error('Chrome 调试端口没起来:\n' + chromeErr.slice(0, 800));
  console.log(`Chrome: ${version['Browser']}`);

  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  cdp = new Cdp(ws);

  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (p.type === 'error') errors.push('[console.error] ' + text);
    else if (p.type === 'warning') warnings.push('[console.warn] ' + text);
    else logs.push(`[${p.type}] ${text}`);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    const msg = d.exception?.description ?? d.text;
    errors.push('[exception] ' + String(msg).split('\n').slice(0, 4).join(' | '));
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry;
    if (e.level === 'error') errors.push(`[${e.source}] ${e.text} ${e.url ?? ''}`);
    else if (e.level === 'warning') warnings.push(`[${e.source}] ${e.text}`);
  });
  cdp.on('Page.loadEventFired', () => logs.push('[page] load'));

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);

  // --- 页面内自检 -------------------------------------------------------
  const probe = await cdp.send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(() => {
      const g = window.__game;
      const out = { ok: true, notes: [] };
      if (!g) { out.ok = false; out.notes.push('window.__game 不存在'); return out; }
      out.hasGame = true;
      const c = document.getElementById('scene');
      out.canvas = c ? [c.width, c.height] : null;
      const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
      out.hasWebgl = !!gl;
      const info = g.view.renderer.info;
      out.drawCalls = info.render.calls;
      out.triangles = info.render.triangles;
      out.programs = info.programs ? info.programs.length : -1;
      out.chunks = g.world.terrainMesh.chunks.size;
      out.props = g.world._props.length;
      out.statics = g.world.statics.bodies ? g.world.statics.bodies.length : (g.world.statics.all ? g.world.statics.all.length : -1);
      out.frames = g.frameCount;
      out.fps = Math.round(g.fps * 10) / 10;
      out.paused = g.paused;
      out.hudHidden = document.getElementById('hud').classList.contains('hidden');
      out.menuHidden = document.getElementById('menu').classList.contains('hidden');
      out.car = g.vehicle.spec.name;
      out.gear = g.vehicle.drivetrain.gear;
      out.rpm = Math.round(g.vehicle.drivetrain.rpm);
      out.speedKmh = Math.round(g.vehicle.speedKmh * 10) / 10;
      out.pos = [g.vehicle.position.x, g.vehicle.position.y, g.vehicle.position.z].map(v => Math.round(v * 100) / 100);
      out.nodes = g.vehicle.body.nodeCount;
      out.beams = g.vehicle.body.beamCount;
      out.wheels = g.vehicle.wheels.map(w => ({ det: w.detached, contact: w.contact, len: Math.round(w.len*1000)/1000, fz: Math.round(w.Fz) }));
      out.bodyMeshTris = g.view3d.meshGeometry.index.count / 3;
      out.audioReady = g.audio.ready;
      out.camera = g.camera3p.mode;
      const bad = [];
      for (let i = 0; i < g.vehicle.body.nodeCount; i++) {
        const b = g.vehicle.body;
        if (!Number.isFinite(b.px[i]) || !Number.isFinite(b.py[i]) || !Number.isFinite(b.pz[i])) bad.push(i);
      }
      if (bad.length) { out.ok = false; out.notes.push('NaN 节点: ' + bad.slice(0,5)); }
      if (out.frames < 20) { out.ok = false; out.notes.push('物理帧太少: ' + out.frames); }
      if (!out.drawCalls) { out.ok = false; out.notes.push('没有发出 draw call'); }
      return out;
    })()`,
  });
  const probeVal = probe.result?.value;
  console.log('\n=== 页面自检 ===');
  console.log(JSON.stringify(probeVal, null, 2));
  if (!probeVal?.ok) exitCode = 1;

  if (extraEval) {
    const r = await cdp.send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true, expression: extraEval,
    });
    console.log('\n=== 附加探测 ===');
    if (r.exceptionDetails) {
      console.log('异常: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      exitCode = 1;
    } else {
      console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
    }
  }

  // --- 端到端驾驶场景：真的按键、真的跑 -------------------------------
  if (scenario) {
    const src = SCENARIOS[scenario];
    if (!src) { console.log('未知场景: ' + scenario + '（可用: ' + Object.keys(SCENARIOS).join(', ') + '）'); exitCode = 2; }
    else {
      const r = await cdp.send('Runtime.evaluate', {
        awaitPromise: true, returnByValue: true, expression: `(${src})()`,
      });
      console.log(`\n=== 场景 ${scenario} ===`);
      if (r.exceptionDetails) {
        console.log('异常: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
        exitCode = 1;
      } else {
        console.log(JSON.stringify(r.result?.value, null, 2));
        if (r.result?.value?.ok === false) exitCode = 1;
      }
    }
  }

  // --- 直接读 GL 帧缓冲拿真实画面（headless 合成器抓不到 WebGL 画布） ---
  if (glShot) {
    const r = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => { const g = window.__game; g.view.render(); return g.view.renderer.domElement.toDataURL('image/png'); })()`,
    });
    const dataUrl = r.result?.value ?? '';
    const b64 = dataUrl.split(',')[1] ?? '';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 1000) {
      console.log('\n!! GL 截图失败: ' + dataUrl.slice(0, 120));
      exitCode = 1;
    } else {
      fs.mkdirSync(path.dirname(glShot), { recursive: true });
      fs.writeFileSync(glShot, buf);
      console.log(`\n=== GL 截图 ${glShot} (${buf.length} 字节) ===`);
      console.log(JSON.stringify(pngStats(buf), null, 2));
    }
  }

  // --- 截图 + 像素统计 ---------------------------------------------------
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  if (shotPath) {
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, buf);
  }
  const stats = pngStats(buf);
  console.log('\n=== 截图统计 ===');
  console.log(JSON.stringify(stats, null, 2));
  if (stats.uniqueColors < 200) { console.log('!! 画面颜色过于单一，可能没渲染出来'); exitCode = 1; }

  console.log('\n=== 控制台 ===');
  console.log(`错误 ${errors.length} 条，警告 ${warnings.length} 条`);
  for (const e of errors.slice(0, 25)) console.log('  ' + e);
  for (const w of warnings.slice(0, 8)) console.log('  ' + w);
  if (errors.length) exitCode = 1;
} catch (e) {
  console.error('验证脚本失败:', e.message);
  exitCode = 2;
} finally {
  try { await cdp?.send('Browser.close'); } catch { /* ignore */ }
  await sleep(300);
  chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

process.exit(exitCode);

/** 极简 PNG 解析：只统计颜色分布，不依赖任何库。 */
function pngStats(buf) {
  // 解析 IHDR
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) return { error: `unsupported bitDepth ${bitDepth}`, width, height };
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) return { error: `unsupported colorType ${colorType}`, width, height };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const hist = new Set();
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  let sky = 0, ground = 0, dark = 0;
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x += 4) {
      const o = x * channels;
      const r = cur[o], g2 = cur[o + 1], b2 = cur[o + 2];
      sumR += r; sumG += g2; sumB += b2; n++;
      hist.add(((r >> 3) << 10) | ((g2 >> 3) << 5) | (b2 >> 3));
      if (b2 > r + 12 && b2 > 90) sky++;
      else if (g2 > b2 + 8) ground++;
      else if (r + g2 + b2 < 110) dark++;
    }
    prev.set(cur);
  }
  return {
    width, height, channels,
    uniqueColors: hist.size,
    meanColor: [Math.round(sumR / n), Math.round(sumG / n), Math.round(sumB / n)],
    percentSky: Math.round((sky / n) * 1000) / 10,
    percentGreenish: Math.round((ground / n) * 1000) / 10,
    percentDark: Math.round((dark / n) * 1000) / 10,
  };
}
