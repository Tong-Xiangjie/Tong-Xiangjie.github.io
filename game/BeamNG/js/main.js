// ============================================================================
//  入口：装配游戏、菜单、设置持久化
// ============================================================================
import { Game, GAME_MODES } from './game/game.js';
import { CAR_PRESETS } from './vehicle/spec.js';
import { CAMERA_LABELS } from './game/camera.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'bea-like-settings-v1';

const DEFAULT = {
  preset: 'sedan',
  mode: 'free',
  quality: 'high',
  time: 0.34,
  paint: '#b4232b',
  volume: 0.7,
  plane: 'on',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 隐私模式忽略 */ }
}

const settings = loadSettings();
let game = null;
let started = false;

// ---------------------------------------------------------------- 菜单装配
function buildCarCards() {
  const host = $('car-list');
  host.innerHTML = '';
  for (const [id, spec] of Object.entries(CAR_PRESETS)) {
    const el = document.createElement('div');
    el.className = `car-card${id === settings.preset ? ' active' : ''}`;
    el.dataset.id = id;
    const kw = Math.round((spec.engine.peakTorque ?? 0));
    el.innerHTML = `<b>${spec.name}</b><i>${spec.desc}</i>
      <i style="opacity:.7;display:block;margin-top:6px">${spec.driveLayout} · ${kw} N·m · ${spec.totalMass} kg</i>`;
    el.addEventListener('click', () => {
      settings.preset = id;
      saveSettings(settings);
      host.querySelectorAll('.car-card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
      if (game) game.setVehicle(id, parseInt(settings.paint.slice(1), 16));
    });
    host.appendChild(el);
  }
}

function buildModeChips() {
  const host = $('mode-list');
  host.innerHTML = '';
  for (const m of GAME_MODES) {
    const el = document.createElement('div');
    el.className = `chip${m.id === settings.mode ? ' active' : ''}`;
    el.dataset.id = m.id;
    el.textContent = m.name;
    el.title = m.desc;
    el.addEventListener('click', () => {
      settings.mode = m.id;
      saveSettings(settings);
      host.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.id === m.id));
      if (game) game.setMode(m.id);
    });
    host.appendChild(el);
  }
}

// ------------------------------------------------------------------ 启动
function createGame() {
  const canvas = $('scene');
  game = new Game(canvas, {
    preset: settings.preset,
    quality: settings.quality,
    paint: parseInt(settings.paint.slice(1), 16),
    seed: 20261105,
  });
  game.setQuality(settings.quality);
  game.setTimeOfDay(settings.time);
  game.setMode(settings.mode);
  game.audio.setVolume(settings.volume);
  window.__game = game;      // 方便在控制台里调参
  return game;
}

async function startGame() {
  // 已经开过局了：这个按钮就是"继续"。原来这里直接 return，
  // 于是按 Esc 弹出的菜单里点"开始驾驶"什么都不会发生，游戏一直卡在暂停。
  if (started) { closeMenu(); return; }
  started = true;
  if (!game) createGame();
  game.setPlaneEnabled(settings.plane === 'on');
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('btn-menu').classList.remove('hidden');
  $('btn-camera').classList.remove('hidden');
  // 注意：绝不能 await audio.resume() —— 无声卡的 headless 环境里这个
  // Promise 可能永远不落地，整个游戏循环就再也起不来了。
  game.audio.resume();
  game.start();
  window.addEventListener('resize', onResize);
  onResize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { game.audio.suspend(); game.paused = true; }
    else { game.audio.resume(); game.paused = false; game._last = performance.now(); }
  });
}

function onResize() {
  if (!game) return;
  const w = window.innerWidth, h = window.innerHeight;
  game.view.resize(w, h);
}

function openMenu() {
  $('help').classList.add('hidden');   // 说明页开着的时候按菜单，别两层叠一起
  // 开局之后这个菜单就是暂停菜单，按钮语义改成"继续"
  if (started) {
    $('menu').querySelector('h1').innerHTML = '已暂停<span>软体车辆物理沙盒</span>';
    $('btn-start').textContent = '继续驾驶';
    if (game) game.input?.clear?.();
  }
  $('menu').classList.remove('hidden');
  if (game) game.paused = true;
  refreshPlaneStatus();
}

/** 菜单里那行飞机状态。菜单开着的时候每 0.4 秒刷一次。 */
let _planeStatusTimer = null;
function refreshPlaneStatus() {
  const el = $('plane-state');
  if (!el) return;
  const tick = () => {
    if ($('menu').classList.contains('hidden')) {
      clearInterval(_planeStatusTimer);
      _planeStatusTimer = null;
      return;
    }
    el.textContent = game ? game.planeStatusText() : '巡航中';
  };
  tick();
  if (!_planeStatusTimer) _planeStatusTimer = setInterval(tick, 400);
}
function closeMenu() {
  $('menu').classList.add('hidden');
  if (game) game.paused = false;
  if (game) game._last = performance.now();
  if (game) game.input?.clear?.();      // 菜单里按过的键不要带进游戏
}

// ------------------------------------------------------------------ 绑定
$('btn-start').addEventListener('click', startGame);
$('btn-help').addEventListener('click', () => $('help').classList.remove('hidden'));
$('help-close').addEventListener('click', () => $('help').classList.add('hidden'));
// 点说明页的空白处也能关掉（按钮在小窗口下容易被挤到折线以下）
$('help').addEventListener('click', (e) => {
  if (e.target === $('help')) $('help').classList.add('hidden');
});
$('btn-menu').addEventListener('click', openMenu);
$('btn-camera').addEventListener('click', () => {
  if (!game) return;
  const m = game.camera3p.nextMode();
  game.hud.toast(`视角：${CAMERA_LABELS[m]}`);
});
$('result-close').addEventListener('click', () => {
  game?.hud.hideResult();
  if (game) game.paused = false;
});

$('set-quality').value = settings.quality;
$('set-quality').addEventListener('change', (e) => {
  settings.quality = e.target.value; saveSettings(settings);
  game?.setQuality(settings.quality);
});
$('set-time').value = String(settings.time);
$('set-time').addEventListener('input', (e) => {
  settings.time = parseFloat(e.target.value); saveSettings(settings);
  game?.setTimeOfDay(settings.time);
});
$('set-paint').value = settings.paint;
$('set-paint').addEventListener('input', (e) => {
  settings.paint = e.target.value; saveSettings(settings);
  game?.view3d.setPaint(parseInt(settings.paint.slice(1), 16));
});
// 飞机：开关 + 手动让它掉下来
$('set-plane').value = settings.plane;
$('set-plane').addEventListener('change', (e) => {
  settings.plane = e.target.value; saveSettings(settings);
  game?.setPlaneEnabled(settings.plane === 'on');
});
$('btn-plane-crash').addEventListener('click', () => {
  if (!game) return;
  if (settings.plane !== 'on') { settings.plane = 'on'; saveSettings(settings); $('set-plane').value = 'on'; game.setPlaneEnabled(true); }
  closeMenu();                       // 关掉菜单才看得到它往下掉
  game.plane.forceCrash();
});
$('set-volume').value = String(settings.volume);
$('set-volume').addEventListener('input', (e) => {
  settings.volume = parseFloat(e.target.value); saveSettings(settings);
  game?.audio.setVolume(settings.volume);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    const helpOpen = !$('help').classList.contains('hidden');
    const menuOpen = !$('menu').classList.contains('hidden');
    if (helpOpen) $('help').classList.add('hidden');      // 先关说明页
    else if (menuOpen) { if (started) closeMenu(); }      // 再按一次才收菜单（没开局就留在菜单）
    else openMenu();
  }
  if (e.code === 'KeyP' && game && started) game.playReplay();
});

// 首次交互解锁音频
const unlock = () => { game?.audio.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

buildCarCards();
buildModeChips();
createGame();
onResize();

// 支持 ?preset=sports&mode=crash&quality=low 直接进游戏（截图/分享用）
const qs = new URLSearchParams(location.search);
if (qs.has('preset')) settings.preset = qs.get('preset');
if (qs.has('mode')) settings.mode = qs.get('mode');
if (qs.has('quality')) settings.quality = qs.get('quality');
if (qs.has('autostart')) startGame();
