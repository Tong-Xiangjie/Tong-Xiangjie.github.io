// 按"逻辑坐标"精确采样：验证图鉴里每个格子真的画出了对应颜色的砖 / 道具，
// 并检查每个砖下面的标注文字是否真的渲染出来了。
import { decodePNG } from '../../png-stats.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'screenshots');
// 由 shots.cjs 在截图那一趟里顺手带出来的"场景精确坐标"
const MARKS = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'marks.json'), 'utf8'));
const SCALE = 1280 / 960;           // view.scale，视口 1280x800 正好 16:10

const BRICK_W = 78, BRICK_H = 26;   // buildFromGrid: w = (960-120)/10 - 6, h = 26

function load(f) {
  const img = decodePNG(path.join(dir, f));
  const { w, h, channels, data } = img;
  return {
    w, h, channels, data,
    // 取一块区域的均值 + 最大值
    patch(lx, ly, lw, lh) {
      let r = 0, g = 0, b = 0, n = 0, mx = 0;
      const x0 = Math.round(lx * SCALE), x1 = Math.round((lx + lw) * SCALE);
      const y0 = Math.round(ly * SCALE), y1 = Math.round((ly + lh) * SCALE);
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
          const i = (y * w + x) * channels;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          mx = Math.max(mx, data[i], data[i + 1], data[i + 2]);
        }
      }
      return { r: r / n, g: g / n, b: b / n, n, max: mx };
    }
  };
}

function hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 1e-6) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  const l = (mx + mn) / 2;
  const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: hh, s, l };
}

function hueDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// ---- 布局（必须与 shots.cjs 里的参数一致）----
function rowCells(n, cellW, x0, y0) {
  const out = [];
  for (let c = 0; c < n; c++) out.push({ x: x0 + c * cellW + (cellW - BRICK_W) / 2, y: y0 });
  return out;
}
const ROW_A = rowCells(5, 176, 40, 96);
const ROW_B = rowCells(6, 146, 42, 232);
const ROW_C = rowCells(6, 146, 42, 368);

const EXPECT_A = ['#31f2ff hp1', '#4dff9e hp2', '#ffd93d hp3', '#ff9f1c hp4', '#ff3ea5 hp5'];
const EXPECT_B = ['#6b7fa8 实心', '#fff0b8 金砖', '#a9744a 裂纹', '#ff6b35 炸药', '#a3e635 磁铁', '#8b4a2b 软砖'];
const EXPECT_C = ['#e2e8f0 转上', '#e2e8f0 转右', '#e2e8f0 转下', '#e2e8f0 转左', '#8b5cf6 门A', '#8b5cf6 门B'];

const NOMINAL = {
  '#31f2ff': 185, '#4dff9e': 150, '#ffd93d': 49, '#ff9f1c': 33, '#ff3ea5': 325,
  '#6b7fa8': 222, '#fff0b8': 48, '#a9744a': 27, '#ff6b35': 17, '#a3e635': 76,
  '#8b4a2b': 21, '#e2e8f0': 210, '#8b5cf6': 258,
};

console.log('\n########## 03-bricks.png ##########');
{
  const img = load('03-bricks.png');
  const all = [];
  const check = (cells, expects, tagName) => {
    cells.forEach((c, i) => {
      // 砖顶往下 7px 起取 4px 高的一条：避开 y+3 的白色高光条
      const body = img.patch(c.x + 5, c.y + 7, BRICK_W - 10, 4);
      const { h: hue, s, l } = hsl(body);
      const hex = expects[i].split(' ')[0];
      const want = NOMINAL[hex];
      const ok = hex === '#e2e8f0' ? (l > 0.25 && s < 0.35)
                                   : (hueDiff(hue, want) < 22 && s > 0.15);
      // 标注文字：砖下方 26px 处的带子里应该有亮像素
      const cap = img.patch(c.x - 20, c.y + BRICK_H + 18, BRICK_W + 40, 18);
      const hasText = cap.max > 140;
      all.push({ hex, hue, s, l, body });
      console.log(
        `${tagName} ${expects[i].padEnd(12)} 期望hue=${String(want).padStart(3)} ` +
        `实测hue=${hue.toFixed(0).padStart(3)} sat=${s.toFixed(2)} lum=${l.toFixed(2)} ` +
        `rgb=(${body.r.toFixed(0)},${body.g.toFixed(0)},${body.b.toFixed(0)}) ` +
        `${ok ? '色OK' : '色!!'} ${hasText ? '标注OK' : '标注!!'}`
      );
    });
  };
  check(ROW_A, EXPECT_A, 'A');
  check(ROW_B, EXPECT_B, 'B');
  check(ROW_C, EXPECT_C, 'C');

  // 两两可区分性：**不同**期望色的格子不能撞车。
  // （同色格子是有意为之：4 块转弯砖都是 #e2e8f0，靠箭头字形区分，不是靠颜色，
  //   所以必须排除"期望色相同"的组合，否则这里永远是一个假警报。）
  const ALL = EXPECT_A.concat(EXPECT_B, EXPECT_C);
  let worst = 1e9, wpair = '';
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (ALL[i].split(' ')[0] === ALL[j].split(' ')[0]) continue;
    const a = all[i], b = all[j];
    const d = Math.hypot(a.body.r - b.body.r, a.body.g - b.body.g, a.body.b - b.body.b);
    if (d < worst) { worst = d; wpair = `${ALL[i]} vs ${ALL[j]}`; }
  }
  console.log(`\n最接近的一对不同色格子: ${wpair}  距离=${worst.toFixed(1)}  ${worst > 18 ? '(可区分 OK)' : '(太像 !!)'}`);
}

// 在一小块区域里找"最接近目标色"的像素 —— 胶囊是深色底 + 彩色描边，
// 取均值会被深色底冲淡，所以要看有没有出现这个颜色本身。
function nearestIn(img, lx, ly, lw, lh, target) {
  const [tr, tg, tb] = target;
  let best = 1e9, bestPx = null;
  const x0 = Math.round(lx * SCALE), x1 = Math.round((lx + lw) * SCALE);
  const y0 = Math.round(ly * SCALE), y1 = Math.round((ly + lh) * SCALE);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.channels;
      const d = Math.hypot(img.data[i] - tr, img.data[i + 1] - tg, img.data[i + 2] - tb);
      if (d < best) { best = d; bestPx = [img.data[i], img.data[i + 1], img.data[i + 2]]; }
    }
  }
  return { best, bestPx };
}

const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

console.log('\n########## 04-powers.png ##########');
{
  const img = load('04-powers.png');
  const GOOD = [['W 加宽挡板', '#5eead4'], ['3 三球齐发', '#c084fc'], ['S 时间变慢', '#93c5fd'],
                ['+ 额外生命', '#ff8fab'], ['◎ 冲击波', '#38bdf8']];
  const BAD = [['N 挡板变窄', '#ff4d4d'], ['F 球速暴涨', '#fb923c']];
  let bad = 0;
  GOOD.forEach(([name, hex], i) => {
    const cx = 128 + i * 176, cy = 176;
    const { best, bestPx } = nearestIn(img, cx - 18, cy - 14, 36, 28, hex2rgb(hex));
    const cap = img.patch(cx - 60, cy + 28, 120, 20);
    const ok = best < 70, textOK = cap.max > 140;
    if (!ok || !textOK) bad++;
    console.log(`益 ${name.padEnd(12)} 目标${hex} 最近像素(${bestPx}) 距离=${best.toFixed(1)} ${ok ? '胶囊OK' : '胶囊!!'} ${textOK ? '标签OK' : '标签!!'}`);
  });
  BAD.forEach(([name, hex], i) => {
    const cx = 380 + i * 200, cy = 356;
    const { best, bestPx } = nearestIn(img, cx - 18, cy - 14, 36, 28, hex2rgb(hex));
    const cap = img.patch(cx - 60, cy + 28, 120, 20);
    const ok = best < 70, textOK = cap.max > 140;
    if (!ok || !textOK) bad++;
    console.log(`害 ${name.padEnd(12)} 目标${hex} 最近像素(${bestPx}) 距离=${best.toFixed(1)} ${ok ? '胶囊OK' : '胶囊!!'} ${textOK ? '标签OK' : '标签!!'}`);
  });
  console.log(bad === 0 ? '\n7 个道具胶囊 + 14 行标签 全部就位  OK' : `\n有 ${bad} 项异常  !!`);
}

console.log('\n########## 06-magnet.png ##########');
{
  const img = load('06-magnet.png');
  const m = MARKS['06-magnet'] || {};
  console.log(`场景报告：磁力=${m.magnet}s 球风格=${JSON.stringify(m.style)} 可破坏砖=${m.breakable} 引导=${m.assistOn}`);
  // 1. 球真的被磁化了（逻辑层）
  console.log(`磁力剩余 ${m.magnet}s ${m.magnet > 0 ? '球处于磁化状态 OK' : '球没被磁化 !!'}`);
  // 2. 球真的变绿了（像素层）：全部落在球心附近取最接近 #a3e635 的像素
  const [bx, by] = m.ball || [NaN, NaN];
  const green = nearestIn(img, bx - 9, by - 9, 18, 18, hex2rgb('#a3e635'));
  const cream = nearestIn(img, bx - 6, by - 6, 12, 12, hex2rgb('#f2ffd6'));
  console.log(`球心 (${bx},${by}) 最近 #a3e635 = (${green.bestPx}) 距离=${green.best.toFixed(0)} ${green.best < 60 ? '球变绿 OK' : '球没变绿 !!'}`);
  console.log(`球心高光 最近 #f2ffd6 = (${cream.bestPx}) 距离=${cream.best.toFixed(0)} ${cream.best < 60 ? '高光变奶白 OK' : '高光不对 !!'}`);
  // 3. 青色不能出现在球的位置（否则就是"没变色"）
  const cyan = nearestIn(img, bx - 9, by - 9, 18, 18, hex2rgb('#31f2ff'));
  console.log(`球心附近最近 #31f2ff 距离=${cyan.best.toFixed(0)} ${cyan.best > 60 ? '已不是青色 OK' : '还是青色 !!'}`);
  // 4. 磁铁砖仍在场地里（磁力的来源要看得见）—— 用场景报出来的位置，不手抄网格坐标
  const mb = m.magnetBrick;
  if (mb) {
    const mag = img.patch(mb[0] - 33, mb[1] - 6, 66, 4);
    const magHsl = hsl(mag);
    console.log(`磁铁砖 (${mb[0]},${mb[1]}) hue=${magHsl.h.toFixed(0)} sat=${magHsl.s.toFixed(2)} ${hueDiff(magHsl.h, 80) < 25 ? '磁铁砖在场地里 OK' : '磁铁砖!!'}`);
  } else {
    console.log('场景没报出磁铁砖位置 !!');
  }
  // 5. 标注文字真的渲染出来了 —— 这正是旧 06-well 栽的地方（场景调了 tag/note 但没覆写 render，
  //    驱动最后一帧 render() 把标注全抹掉了，图里其实一行字都没有）
  const caps = [[448, '磁铁砖被击破 -> 获得磁力'], [486, '磁力期间球变黄绿'], [516, '只转方向不改速率']];
  let capBad = 0;
  for (const [ly, label] of caps) {
    const p = img.patch(120, ly - 12, 720, 24);
    const ok = p.max > 140;
    if (!ok) capBad++;
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${ok ? '文字OK' : '文字!!'}  ${label}`);
  }
  // 6. 磁力的**绿色引导线**：和琥珀色的防卡死引导同构，必须真的画出来，
  //    而且必须指向"磁力这一帧真正瞄的那块砖"（marks 里的 magLine）。
  const ML = m.magLine;
  if (ML && m.ascending) {
    const mx = (bx + ML[0]) / 2, my = (by + ML[1]) / 2;
    // 绿色 #a3e635：(163,230,53) —— 判据是 G 明显大于 R、R 明显大于 B
    const scoreAt = (cx, cy, rad) => {
      let best = -1e9, bestPx = null;
      const x0 = Math.round((cx - rad) * SCALE), x1 = Math.round((cx + rad) * SCALE);
      const y0 = Math.round((cy - rad) * SCALE), y1 = Math.round((cy + rad) * SCALE);
      for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
          const i = (y * img.w + x) * img.channels;
          const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
          if (g > r && r > b) { const v = g - b; if (v > best) { best = v; bestPx = [r, g, b]; } }
        }
      }
      return { best, bestPx };
    };
    const onLine  = scoreAt(mx, my, 26);
    // 控制点：沿**连线的垂线**偏移，取"往上"的那一侧 ——
    // 往下会撞到 y>=448 那三行绿色标注文字，把判据污染掉（第一版就是这么误报的）。
    const offX = mx - (my - by) * 0.5, offY = my + (mx - bx) * 0.5;
    const offLine = scoreAt(offX, offY, 26);
    const ok = onLine.best > 55 && onLine.best > offLine.best + 25;
    console.log(`磁力引导线：连线中点(${mx.toFixed(0)},${my.toFixed(0)}) 最绿像素=(${onLine.bestPx}) G-B=${onLine.best.toFixed(0)}` +
                ` · 垂线控制点(${offX.toFixed(0)},${offY.toFixed(0)}) G-B=${offLine.best.toFixed(0)} ${ok ? '绿色引导线 OK' : '绿色引导线 !!'}`);
    // 线必须指向 magLine（磁力真正瞄的那块砖），而不是别的地方
    const magTgt = m.magnetTarget;
    const tgtOk = magTgt && Math.abs(magTgt[0] - ML[0]) < 1.5 && Math.abs(magTgt[1] - ML[1]) < 1.5;
    console.log(`引导线目标与"最近活砖"一致：magLine=(${ML}) nearestBrick=(${magTgt}) ${tgtOk ? '一致 OK' : '（本场景下不一致）'}`);
  } else {
    console.log(`磁力引导线：场景未处于可引导状态（magLine=${JSON.stringify(ML)} ascending=${m.ascending}）`);
  }
  // 7. 拖尾真的被掰弯了（球在转弯阶段）
  const tr = m.trail || [];
  if (tr.length >= 6) {
    const [x0, y0] = tr[0], [x1, y1] = tr[tr.length - 1];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    let maxDev = 0;
    for (const [px, py] of tr) {
      const dev = Math.abs((x1 - x0) * (y0 - py) - (x0 - px) * (y1 - y0)) / L;
      maxDev = Math.max(maxDev, dev);
    }
    // 14 个点的拖尾只覆盖 0.23 秒，磁力每帧最多转 magTurnDeg 度，
    // 所以矢高的理论上限是 L·Δθ/8（Δθ 取"拖尾时间内磁力能转的总角"和
    // "初始航向误差"里小的那个 —— 对准之后就不再弯了）。
    const magTurn = m.magTurnDeg || 6;
    const dThetaCap = Math.min(14 * magTurn, 180) * Math.PI / 180;
    const capPx = L * dThetaCap / 8;
    console.log(`拖尾 ${tr.length} 点 跨度${L.toFixed(0)}px 矢高=${maxDev.toFixed(1)}px ${maxDev > 2 ? '确实被掰弯 OK' : '拖尾是直的 !!'}（磁力 ${magTurn.toFixed(1)}°/帧，上限约 ${capPx.toFixed(0)}px = L·Δθ/8）`);
  }
  console.log(capBad === 0 ? '\n06-magnet: 磁化 + 变色 + 标注 全部就位  OK' : `\n06-magnet: 有 ${capBad} 行标注没渲染 !!`);
}

console.log('\n########## 09-assist.png ##########');
{
  const img = load('09-assist.png');
  const m = MARKS['09-assist'] || {};
  console.log(`场景报告：可破坏砖=${m.breakable} 引导允许=${m.assistOn} 停滞=${m.stuck}s assistFx=${m.assistFx} 目标砖=${JSON.stringify(m.magnetTarget)}`);
  // 1. 确实处于残局（这是引导被允许的前提）
  console.log(`可破坏砖 ${m.breakable} ≤ 3 ${m.breakable <= 3 ? '是残局 OK' : '不是残局 !!'}   引导门控=${m.assistOn ? '已打开 OK' : '没打开 !!'}`);
  // 2. 球确实正在被引导（assistFx > 0 才会画标记）
  console.log(`assistFx=${m.assistFx} ${m.assistFx > 0 ? '引导正在掰弯轨迹 OK' : '引导没生效 !!'}`);
  // 3. 琥珀色虚线环真的画出来了
  const [bx, by] = m.ball || [NaN, NaN];
  const amber = nearestIn(img, bx - 12, by - 12, 24, 24, hex2rgb('#ffd93d'));
  console.log(`球心 (${bx},${by}) 最近 #ffd93d 距离=${amber.best.toFixed(0)} ${amber.best < 60 ? '琥珀虚线环 OK' : '虚线环 !!'}`);
  // 4. 指向目标砖的虚线：沿球->目标连线中段取样。
  //    这条线是 globalAlpha≈0.52 画的，#ffd93d 会和深色底混成 ~(133,113,32)，
  //    所以不能直接比纯色 —— 改成比"琥珀方向"：R-B 明显为正、且 R>G>B。
  const tg = m.magnetTarget;
  if (tg) {
    const mx = (bx + tg[0]) / 2, my = (by + tg[1]) / 2;
    let bestAmber = -1e9, bestPx = null;
    const x0 = Math.round((mx - 30) * SCALE), x1 = Math.round((mx + 30) * SCALE);
    const y0 = Math.round((my - 30) * SCALE), y1 = Math.round((my + 30) * SCALE);
    for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
        const i = (y * img.w + x) * img.channels;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (r > g && g > b) { const v = r - b; if (v > bestAmber) { bestAmber = v; bestPx = [r, g, b]; } }
      }
    }
    const ok = bestAmber > 60;
    console.log(`连线中点 (${mx.toFixed(0)},${my.toFixed(0)}) 最琥珀像素=(${bestPx}) R-B=${bestAmber.toFixed(0)} ${ok ? '目标虚线 OK' : '目标虚线 !!'}`);
  }
  // 5. 球本身**没有**被磁化（两套视觉不能混）
  const green = nearestIn(img, bx - 9, by - 9, 18, 18, hex2rgb('#a3e635'));
  console.log(`球心最近 #a3e635 距离=${green.best.toFixed(0)} ${green.best > 60 ? '球没被误画成磁化色 OK' : '串色 !!'}`);
  // 6. 标注（含底部那行 tag —— 之前放在 y=620，超出 600 高的画布，等于没画）
  const cap = img.patch(120, 412, 720, 26);
  console.log(`y=424 标注最亮=${cap.max.toFixed(0)} ${cap.max > 140 ? '标注OK' : '标注!!'}`);
  for (const ly of [486, 516]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

console.log('\n########## 11-flat.png ##########');
{
  const img = load('11-flat.png');
  const m = MARKS['11-flat'] || {};
  const [bx, by] = m.ball || [NaN, NaN];
  // 1. 球确实被"掰"过：速度离水平 45°、且仍然下行
  const ang = Math.abs(Math.atan2(Math.abs(m.vel[1]), Math.abs(m.vel[0])) * 180 / Math.PI);
  console.log(`球速=(${m.vel}) 离水平 ${ang.toFixed(1)}° ${Math.abs(ang - 45) < 0.5 ? '角度突变到 45° OK' : '角度 !!'}`);
  console.log(`仍然下行=${!m.ascending} ${!m.ascending ? '没有把球抢上去 OK' : '被抢上去了 !!'}`);
  // 2. 辅助线确实画出来了（琥珀环 + 指向 aimLine 的虚线）
  const amber = nearestIn(img, bx - 12, by - 12, 24, 24, hex2rgb('#ffd93d'));
  console.log(`球心 (${bx},${by}) 最近 #ffd93d 距离=${amber.best.toFixed(0)} ${amber.best < 60 ? '琥珀虚线环 OK' : '虚线环 !!'}`);
  const tg = m.aimLine;
  if (tg) {
    const mx = (bx + tg[0]) / 2, my = (by + tg[1]) / 2;
    let bestAmber = -1e9, bestPx = null;
    const x0 = Math.round((mx - 40) * SCALE), x1 = Math.round((mx + 40) * SCALE);
    const y0 = Math.round((my - 40) * SCALE), y1 = Math.round((my + 40) * SCALE);
    for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
        const i = (y * img.w + x) * img.channels;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (r > g && g > b) { const v = r - b; if (v > bestAmber) { bestAmber = v; bestPx = [r, g, b]; } }
      }
    }
    console.log(`辅助线中点 (${mx.toFixed(0)},${my.toFixed(0)}) 最琥珀像素=(${bestPx}) R-B=${bestAmber.toFixed(0)} ${bestAmber > 60 ? '辅助线 OK' : '辅助线 !!'}`);
    // 3. 线的终点确实落在挡板高度上（y=554），而不是别的地方
    console.log(`辅助线终点 y=${tg[1]} ${Math.abs(tg[1] - 554) < 0.01 ? '指向挡板高度 OK' : '终点不对 !!'}`);
  }
  for (const ly of [196, 486, 516, 546]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

console.log('\n########## 12-nest.png ##########');
{
  const img = load('12-nest.png');
  const m = MARKS['12-nest'] || {};
  const [bx, by] = m.ball || [NaN, NaN];
  const tg = m.aimLine;                       // 护送这一帧瞄的点（应该是"门口"，不是砖心）
  const brick = m.magnetTarget;               // 场景把砖心顺手上报在这里
  console.log(`球心 (${bx},${by}) 辅助线指向 ${JSON.stringify(tg)}  砖心 ${JSON.stringify(brick)}`);
  if (tg && brick) {
    const d = Math.hypot(tg[0] - brick[0], tg[1] - brick[1]);
    console.log(`辅助线指的和砖心差 ${d.toFixed(0)}px ${d > 40 ? '瞄的是"门口" OK（不是砖心）' : '还在瞄砖心 !!'}`);
  } else {
    console.log('辅助线 !!（没画出来）');
  }
  // 辅助线的终点（门口那一格）应该有琥珀圈
  if (tg) {
    const amber = nearestIn(img, tg[0] - 22, tg[1] - 22, 44, 44, hex2rgb('#ffd93d'));
    console.log(`门口 (${tg[0]},${tg[1]}) 最近 #ffd93d 距离=${amber.best.toFixed(0)} ${amber.best < 30 ? '门口画了琥珀圈 OK' : '门口没圈 !!'}`);
  }
  // 球身上也该有琥珀环（assistFx > 0）
  const am = nearestIn(img, bx - 14, by - 14, 28, 28, hex2rgb('#ffd93d'));
  console.log(`球心最近 #ffd93d 距离=${am.best.toFixed(0)} ${am.best < 60 ? '球上有琥珀环 OK' : '球上没有环 !!'}`);
  for (const ly of [196, 486, 516, 546]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

console.log('\n########## 10-portal.png ##########');
{
  const img = load('10-portal.png');
  const m = MARKS['10-portal'] || {};
  const dots = m.portalDots || [];
  console.log(`场景报告：还剩 ${m.portalLeft} 次  场上活着的门 ${dots.length} 扇  ${JSON.stringify(dots)}`);
  console.log(`两扇门都在 ${dots.length === 2 ? 'OK' : '!!'}`);
  // 门上写的是剩余次数：剩 1 次时数字和剩余弧都转成琥珀色（#ffd93d），
  // 所以直接在两扇门的中心附近找琥珀色像素即可 —— 找到了就说明字/弧画上去了。
  let dotBad = 0;
  for (const [px, py] of dots) {
    const amber = nearestIn(img, px - 10, py - 10, 20, 20, hex2rgb('#ffd93d'));
    const ok = amber.best < 70;
    if (!ok) dotBad++;
    console.log(`门心 (${px},${py}) 最近 #ffd93d 距离=${amber.best.toFixed(0)} ${ok ? '剩余次数已标出 OK' : '门上没画数字 !!'}`);
  }
  // 两扇门上的数字必须一样（次数一对共享，不分 A/B）——
  // 用"两侧琥珀像素数"近似：同一关卡同一帧，两边的绘制应该基本对称。
  if (dots.length === 2) {
    const cnt = ([px, py]) => {
      let n = 0;
      const x0 = Math.round((px - 12) * SCALE), x1 = Math.round((px + 12) * SCALE);
      const y0 = Math.round((py - 12) * SCALE), y1 = Math.round((py + 12) * SCALE);
      for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
          const i = (y * img.w + x) * img.channels;
          if (img.data[i] > 150 && img.data[i] - img.data[i + 2] > 60) n++;
        }
      }
      return n;
    };
    const n1 = cnt(dots[0]), n2 = cnt(dots[1]);
    const same = Math.abs(n1 - n2) <= Math.max(3, n1 * 0.35);
    console.log(`两端琥珀像素 ${n1} vs ${n2} ${same ? '两端标的是同一个数（次数一对共享）OK' : '两端不一致 !!'}`);
  }
  // 球没有被误画成磁化色
  const [bx, by] = m.ball || [NaN, NaN];
  const green = nearestIn(img, bx - 9, by - 9, 18, 18, hex2rgb('#a3e635'));
  console.log(`球心最近 #a3e635 距离=${green.best.toFixed(0)} ${green.best > 60 ? '球没被误画成磁化色 OK' : '串色 !!'}`);
  for (const ly of [196, 486, 516, 546]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

console.log('\n########## 05-effects.png ##########');
{
  const img = load('05-effects.png');
  const m = MARKS['05-effects'] || {};
  const sh = (m.shock && m.shock[0]) ? m.shock[0] : [480, 168, NaN];
  const [cx, cy, r] = sh;
  console.log(`场景报告：冲击波 @(${cx},${cy}) r=${r}  存活砖=${m.alive} 已炸=${m.dead}`);
  // 沿半径扫描"橙色程度" R-B，波前应该是一个明显的峰（环已经淡了，
  // 用绝对色距去卡是卡不住的，看相对峰值才靠谱）
  let peak = -1, peakR = 0;
  const prof = [];
  for (let rr = 20; rr < 260; rr += 4) {
    let s = 0, cnt = 0;
    for (let a = 0; a < 360; a += 5) {
      const lx = cx + Math.cos(a * Math.PI / 180) * rr;
      const ly = cy + Math.sin(a * Math.PI / 180) * rr;
      if (lx < 62 || lx > 898 || ly < 62 || ly > 430) continue;
      const p = img.patch(lx, ly, 1, 1);
      s += (p.r - p.b); cnt++;
    }
    if (!cnt) continue;
    const v = s / cnt;
    prof.push([rr, v]);
    if (v > peak) { peak = v; peakR = rr; }
  }
  const at = rr => (prof.find(p => p[0] === rr) || [0, 0])[1];
  console.log(`橙色峰值出现在 r=${peakR}（场景报告 r=${r}）  峰值=${peak.toFixed(1)}  r=${Math.round(r)}处=${at(Math.round(r / 4) * 4).toFixed(1)}`);
  const ok = Math.abs(peakR - r) <= 20;
  console.log(ok ? '冲击波波前位置与场景一致 OK' : '冲击波波前对不上 !!');
  const near = nearestIn(img, cx - 60, cy - 60, 120, 120, hex2rgb('#ff6b35'));
  console.log(`波心橙色粒子 最近像素=(${near.bestPx}) 距 #ff6b35=${near.best.toFixed(0)} ${near.best < 90 ? '粒子OK' : '粒子!!'}`);
  console.log(`爆炸真的炸掉了砖：dead=${m.dead} ${m.dead > 0 ? 'OK' : '!!'}`);
}

// ---- 13/14：玩家第 78 关存档的"改前 / 改后"对图 ----------------------------
// 这两张图的价值全在"同一个洞口，一个 26px 一个 59px"，所以要同时验三件事：
// ① 图上标的数字来自游戏自己的 mouthBand()（场景塞进 __probe 的那个数）；
// ② 那个洞口的缝是真的（改前 (2,9) 是实心砖色，改后是 1 血砖色）；
// ③ 标注文字真的画上去了。
const brickHue = (img, x, y) => {
  const body = img.patch(x + 5, y + 7, BRICK_W - 10, 4);
  const { h, s } = hsl(body);
  return { hue: h, s, body };
};
const cell29 = { x: 60 + 84 * 9, y: 90 + 33 * 2 };     // (行2,列9)：被收尾 2 动过的那一格

console.log('\n########## 13-lv78.png ##########');
{
  const img = load('13-lv78.png');
  const m = MARKS['13-lv78'] || {};
  const band = (m.probe && m.probe[0]) ? m.probe[0][1] : NaN;
  console.log(`场景用 mouthBand() 算出洞口净空 = ${band}px ${band === 26 ? '"一格高" OK' : '判据对不上 !!'}`);
  const s29 = brickHue(img, cell29.x, cell29.y);
  const okSolid = hueDiff(s29.hue, NOMINAL['#6b7fa8']) < 22 && s29.s < 0.45;
  console.log(`(2,9) 实测 hue=${s29.hue.toFixed(0)} sat=${s29.s.toFixed(2)} ${okSolid ? '是实心砖（原盘面）OK' : '不是实心砖色 !!'}`);
  const s28 = brickHue(img, 60 + 84 * 8, 90 + 33 * 2);
  console.log(`(2,8) 实测 hue=${s28.hue.toFixed(0)} ${hueDiff(s28.hue, NOMINAL['#a9744a']) < 25 ? '是裂纹砖 OK' : '裂纹砖色 !!'}`);
  const amber = nearestIn(img, 900, 189, 36, 30, hex2rgb('#ffd93d'));
  console.log(`洞口那一格 (3,9) 附近最近 #ffd93d 距离=${amber.best.toFixed(0)} ${amber.best < 40 ? '标了 26px 的框和箭头 OK' : '没标出来 !!'}`);
  for (const ly of [400, 430, 460]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

console.log('\n########## 14-widened.png ##########');
{
  const img = load('14-widened.png');
  const m = MARKS['14-widened'] || {};
  const band = (m.probe && m.probe[0]) ? m.probe[0][1] : NaN;
  const cell = (m.probe && m.probe[1]) ? m.probe[1][1] : '?';
  console.log(`场景用 mouthBand() 算出洞口净空 = ${band}px ${band === 59 ? '"两格高" OK（一格变两格）' : '判据对不上 !!'}`);
  console.log(`被放宽的那一格 = ${cell} ${cell === 'hp1' ? '实心砖 -> 1 血普通砖 OK' : '改法不对 !!'}`);
  const s29 = brickHue(img, cell29.x, cell29.y);
  const okCyan = hueDiff(s29.hue, NOMINAL['#31f2ff']) < 22 && s29.s > 0.15;
  console.log(`(2,9) 实测 hue=${s29.hue.toFixed(0)} sat=${s29.s.toFixed(2)} ${okCyan ? '画成了 1 血普通砖（青色）OK' : '还是实心砖色 !!'}`);
  const green = nearestIn(img, cell29.x, cell29.y, BRICK_W, BRICK_H + 20, hex2rgb('#4dff9e'));
  console.log(`(2,9) 那一格附近最近 #4dff9e 距离=${green.best.toFixed(0)} ${green.best < 40 ? '标了"这块被放宽"的框和箭头 OK' : '没标出来 !!'}`);
  for (const ly of [400, 430, 460]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}

// ---- 15：判据本身的几何（26 / 59 / 76） ------------------------------------
console.log('\n########## 15-mouth.png ##########');
{
  const img = load('15-mouth.png');
  const m = MARKS['15-mouth'] || {};
  const bands = (m.probe && m.probe[0]) ? m.probe[0].slice(1) : [];
  const want = [26, 59, 76];
  const okBands = bands.length === 3 && bands.every((v, i) => v === want[i]);
  console.log(`三种缝的净空 = ${JSON.stringify(bands)} 期望 ${JSON.stringify(want)} ${okBands ? 'OK' : '判据对不上 !!'}`);
  // 三个布局里的实心砖真的画出来了（A/B 各一排，C 两列）
  const A = [[20, 150], [104, 150], [188, 216]];
  const B = [[340, 130], [424, 130], [508, 229]];
  const C = [[620, 150], [620, 183], [788, 216]];
  let bad = 0;
  for (const [x, y] of A.concat(B, C)) {
    const s = brickHue(img, x, y);
    if (!(hueDiff(s.hue, NOMINAL['#6b7fa8']) < 22 && s.s < 0.45)) {
      bad++;
      console.log(`  !! (${x},${y}) 实测 hue=${s.hue.toFixed(0)} sat=${s.s.toFixed(2)} 应该是一块实心砖`);
    }
  }
  console.log(`三个布局的实心砖（9 块抽样）色相不对的 ${bad} 块 ${bad === 0 ? 'OK' : '!!'}`);
  // 缝里必须是**空的**（这正是"净空"的物理含义）
  const empty = [[104, 183], [424, 163], [508, 196], [704, 183]];
  let solidIn = 0;
  for (const [x, y] of empty) {
    const p = img.patch(x, y, 20, 20);
    if (p.max > 120) {
      solidIn++;
      console.log(`  !! (${x},${y}) 最亮=${p.max.toFixed(0)} —— 缝里不该有东西`);
    }
  }
  console.log(`缝里被画上东西的格 ${solidIn}/4 ${solidIn === 0 ? '缝是空的 OK' : '缝里不该有砖 !!'}`);
  const a1 = nearestIn(img, 292, 196, 30, 40, hex2rgb('#ff6b6b'));
  const a2 = nearestIn(img, 604, 192, 30, 70, hex2rgb('#4dff9e'));
  const a3 = nearestIn(img, 743, 268, 90, 30, hex2rgb('#4dff9e'));
  console.log(`三处箭头/数字：26px 距 #ff6b6b=${a1.best.toFixed(0)}  59px 距 #4dff9e=${a2.best.toFixed(0)}  76px 距 #4dff9e=${a3.best.toFixed(0)} ` +
    `${a1.best < 40 && a2.best < 40 && a3.best < 40 ? 'OK' : '!!'}`);
  for (const ly of [380, 410, 440]) {
    const p = img.patch(120, ly - 12, 720, 24);
    console.log(`标注 y=${ly} 最亮=${p.max.toFixed(0)} ${p.max > 140 ? '文字OK' : '文字!!'}`);
  }
}
