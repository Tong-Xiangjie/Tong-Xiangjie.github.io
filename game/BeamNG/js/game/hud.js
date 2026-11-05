// ============================================================================
//  HUD：仪表 + 小地图 + 提示条
//  直接操作 DOM，不引入任何框架。每帧只写变化过的文本，避免无谓的重排。
// ============================================================================
const $ = (id) => (typeof document === 'undefined' ? null : document.getElementById(id));

const SURFACE_NAMES = {
  asphalt: '沥青', concrete: '混凝土', dirt: '泥土', grass: '草地',
  sand: '沙地', gravel: '碎石', mud: '泥浆',
};

export class Hud {
  constructor() {
    this.el = {
      speed: $('hud-speed'),
      rpmBar: $('hud-rpm-bar'),
      rpm: $('hud-rpm'),
      gear: $('hud-gear'),
      damageBar: $('hud-damage-bar'),
      damage: $('hud-damage'),
      gforce: $('hud-gforce'),
      gdot: $('hud-gdot'),
      car: $('hud-car'),
      surface: $('hud-surface'),
      camera: $('hud-camera'),
      fps: $('hud-fps'),
      mode: $('hud-mode'),
      timer: $('hud-timer'),
      best: $('hud-best'),
      toast: $('toast'),
      map: $('minimap'),
      regions: $('hud-regions'),
      absLight: $('lamp-abs'),
      tcLight: $('lamp-tc'),
      shiftLight: $('lamp-shift'),
      fuel: $('hud-fuel'),
    };
    this._cache = {};
    this._toastTimer = 0;
    this.mapCtx = this.el.map?.getContext('2d') ?? null;
    this.mapScale = 0.22;
    this._mapTick = 0;
    this.regionBars = [];
    this._buildRegions();
  }

  _buildRegions() {
    const host = this.el.regions;
    if (!host) return;
    const names = ['左前', '右前', '左侧', '右侧', '左后', '右后', '乘员舱'];
    host.innerHTML = '';
    for (const n of names) {
      const row = document.createElement('div');
      row.className = 'region';
      row.innerHTML = `<span>${n}</span><i><b></b></i>`;
      host.appendChild(row);
      this.regionBars.push(row.querySelector('b'));
    }
  }

  _text(key, value) {
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    const node = this.el[key];
    if (node) node.textContent = value;
  }

  _width(key, node, pct) {
    if (!node) return;
    const v = `${pct.toFixed(1)}%`;
    if (this._cache[key] === v) return;
    this._cache[key] = v;
    node.style.width = v;
  }

  /** 提示条。 */
  toast(msg, seconds = 2.6) {
    const t = this.el.toast;
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    this._toastTimer = seconds;
  }

  update(dt, ctx) {
    const { vehicle, game, camera } = ctx;
    const kmh = Math.abs(vehicle.speedKmh);
    this._text('speed', kmh.toFixed(0));
    const rpm = vehicle.drivetrain.rpm;
    const redline = vehicle.spec.engine.redline ?? 6800;
    this._text('rpm', rpm.toFixed(0));
    this._width('rpmBar', this.el.rpmBar, Math.min(100, (rpm / redline) * 100));
    const gear = vehicle.drivetrain.gear;
    this._text('gear', gear === 0 ? 'N' : gear === -1 ? 'R' : String(gear));
    if (this.el.gear) {
      const hot = rpm > redline * 0.94;
      if (this._cache.gearHot !== hot) {
        this._cache.gearHot = hot;
        this.el.gear.classList.toggle('hot', hot);
      }
    }
    const dmg = vehicle.telemetry().damage;
    this._width('damageBar', this.el.damageBar, dmg * 100);
    this._text('damage', `${(dmg * 100).toFixed(0)}%`);
    const g = vehicle.gForce;
    const gt = Math.hypot(g.x, g.z) / 9.81;
    this._text('gforce', gt.toFixed(2));
    if (this.el.gdot) {
      const x = 50 + (g.x / 9.81) * 22;
      const y = 50 - (g.z / 9.81) * 22;
      this.el.gdot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    const mat = vehicle.wheels.find((w) => w.surfaceMaterial)?.surfaceMaterial;
    this._text('surface', mat ? (SURFACE_NAMES[mat.name] ?? mat.name ?? '—') : '腾空');
    this._text('camera', ctx.cameraLabel ?? '—');
    this._text('car', vehicle.spec.name);
    this._text('mode', game.modeLabel ?? '');
    const fpsTxt = ctx.fps ? `${ctx.fps.toFixed(0)} · 物理 ${(game.physicsMs ?? 0).toFixed(1)}ms` : '—';
    this._text('fps', fpsTxt);
    if (this.el.fuel) {
      const f = vehicle.fuel01 ?? 1;
      this._width('fuel', this.el.fuel, Math.max(0, f) * 100);
    }
    const lamp = (node, on) => { if (node && this._cache[node.id] !== on) { this._cache[node.id] = on; node.classList.toggle('on', !!on); } };
    lamp(this.el.absLight, vehicle.absActive);
    lamp(this.el.tcLight, vehicle.tcActive);
    lamp(this.el.shiftLight, vehicle.drivetrain.shiftTimer > 0);

    // 分区损伤
    const rd = vehicle.regionDamage;
    if (rd && this.regionBars.length) {
      for (let i = 0; i < this.regionBars.length && i < rd.length; i++) {
        const v = Math.max(0, Math.min(1, rd[i] ?? 0));
        const b = this.regionBars[i];
        const pct = `${(v * 100).toFixed(0)}%`;
        if (b.dataset.v !== pct) {
          b.dataset.v = pct;
          b.style.width = pct;
          b.style.background = v > 0.66 ? '#e0463c' : v > 0.33 ? '#e6a63c' : '#4fbf74';
        }
      }
    }

    // 计时
    if (game.timer !== undefined) {
      this._text('timer', formatTime(game.timer));
      this._text('best', game.best != null ? formatTime(game.best) : '--:--.--');
    }

    // 提示条倒计时
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0 && this.el.toast) this.el.toast.classList.remove('show');
    }

    // 小地图（限频，不用每帧画）
    this._mapTick += dt;
    if (this.mapCtx && this._mapTick > 0.08) {
      this._mapTick = 0;
      this._drawMap(vehicle, game, ctx);
    }
  }

  _drawMap(vehicle, game, ctx) {
    const c = this.mapCtx;
    const W = this.el.map.width, H = this.el.map.height;
    const s = game.mapScale ?? 0.055;
    const cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.arc(cx, cy, Math.min(cx, cy) - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(18,26,22,0.72)';
    c.fillRect(0, 0, W, H);
    // 道路
    const world = game.world;
    if (world) {
      c.strokeStyle = 'rgba(190,190,196,0.55)';
      for (const road of world.terrain.roads) {
        c.lineWidth = Math.max(1.5, road.width * s * 0.8);
        c.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const x = cx + (road.points[i][0] - vehicle.position.x) * s * 8;
          const y = cy + (road.points[i][1] - vehicle.position.z) * s * 8;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    // 车
    const heading = Math.atan2(vehicle.frame.fwd.x, -vehicle.frame.fwd.z);
    c.translate(cx, cy);
    c.rotate(heading);
    c.fillStyle = '#ff5a4d';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(0, 3); c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.restore();
    void ctx;
  }

  /** 结算面板（竞速/撞车模式用）。 */
  showResult(title, rows) {
    const el = $('result');
    if (!el) return;
    el.querySelector('.result-title').textContent = title;
    const body = el.querySelector('.result-rows');
    body.innerHTML = '';
    for (const [k, v] of rows) {
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML = `<span>${k}</span><b>${v}</b>`;
      body.appendChild(d);
    }
    el.classList.add('show');
  }

  hideResult() { $('result')?.classList.remove('show'); }
}

export function formatTime(t) {
  if (t == null || !Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
