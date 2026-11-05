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
      panelCar: $('panel-car'),
      panelFlight: $('panel-flight'),
      flState: $('fl-state'),
      flIas: $('fl-ias'),
      flAlt: $('fl-alt'),
      flVs: $('fl-vs'),
      flHdg: $('fl-hdg'),
      flThr: $('fl-thr'),
      flG: $('fl-g'),
      flThrBar: $('fl-thr-bar'),
      flWarn: $('fl-warn'),
    };
    this._cache = {};
    this._toastTimer = 0;
    this.root = document.getElementById('hud');   // 倒车时给整个 HUD 挂个状态类
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
    const flying = !!ctx.plane;
    // 开飞机的时候把车速表/车损面板换成飞行仪表 —— 飞机没有挡位、油量和车损，
    // 继续显示车的数据会全是 0，看着像坏了。
    if (this.el.panelCar) this.el.panelCar.classList.toggle('hidden', flying);
    if (this.el.panelFlight) this.el.panelFlight.classList.toggle('hidden', !flying);
    // 车辆仪表照常更新（面板藏起来了看不见，开销可以忽略），公共字段由它写；
    // 开飞机时再用飞行仪表覆盖掉"车型/模式"两行。
    this._updateCar(dt, ctx);
    if (flying) {
      this._updateFlight(ctx.plane);
      this._text('car', '飞机');
      this._text('mode', '飞行');
    }
  }

  /** 飞行仪表：空速 / 高度 / 升降率 / 航向 / 油门 / 过载 / 失速告警。 */
  _updateFlight(plane) {
    this._text('flIas', (plane.ias * 3.6).toFixed(0));
    // 高度显示离地高度（AGL）：跑道上读 0，落地前一眼能看出还剩多少
    const agl = Math.max(0, plane.pos.y - plane.world.groundHeight(plane.pos.x, plane.pos.z));
    this._text('flAlt', agl.toFixed(0));
    const vs = plane.vel.y;
    this._text('flVs', (vs >= 0 ? '+' : '') + vs.toFixed(1));
    // 航向按罗盘惯例：0 = 北（-Z），顺时针增加
    const hdg = (Math.atan2(plane.frame.fwd.x, -plane.frame.fwd.z) * 180 / Math.PI + 360) % 360;
    this._text('flHdg', hdg.toFixed(0).padStart(3, '0'));
    this._text('flThr', (plane.throttle * 100).toFixed(0));
    this._width('flThrBar', this.el.flThrBar, plane.throttle * 100);
    this._text('flG', plane.gLoad.toFixed(1));
    const crashed = plane.state === 3;
    this._text('flState', crashed ? '坠毁 · 按 T 回跑道头'
      : plane.mode === 'parked' ? '停车' : plane.stalled ? '失速' : '飞行');
    if (this.el.flWarn) {
      const warn = plane.stalled || plane.assist;
      if (this._cache.flWarn !== warn) {
        this._cache.flWarn = warn;
        this.el.flWarn.classList.toggle('hidden', !warn);
      }
      if (warn) this.el.flWarn.textContent = plane.stalled ? '失速！' : '低空保护';
    }
  }

  /** 车辆仪表。 */
  _updateCar(dt, ctx) {
    const { vehicle, game } = ctx;
    // 速度带符号：倒车直接显示负数（vehicle.speedKmh 本来就是沿车头方向的投影）
    const kmh = vehicle.speedKmh;
    const reversing = kmh < -0.5;
    this._text('speed', kmh.toFixed(0));
    if (this.root) this.root.classList.toggle('reversing', reversing);
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
    // 开飞机时小地图跟着飞机走，不然地图中心还停在那台停在原地的车上
    const fx = ctx?.plane ? ctx.plane.position.x : vehicle.position.x;
    const fz = ctx?.plane ? ctx.plane.position.z : vehicle.position.z;
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
          const x = cx + (road.points[i][0] - fx) * s * 8;
          const y = cy + (road.points[i][1] - fz) * s * 8;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    // 自机标记（开车是车，开飞机是飞机）
    const self = ctx?.plane ?? vehicle;
    const heading = Math.atan2(self.frame.fwd.x, -self.frame.fwd.z);
    c.translate(cx, cy);
    c.rotate(heading);
    c.fillStyle = ctx?.plane ? '#5ad1ff' : '#ff5a4d';
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
