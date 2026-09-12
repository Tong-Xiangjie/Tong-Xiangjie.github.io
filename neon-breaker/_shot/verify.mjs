// 把截图转成 ASCII 亮度图 + 颜色命中表，用来在没有图像查看能力时验证画面
import { decodePNG } from '../../png-stats.mjs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'screenshots');
const files = process.argv[2]
  ? [process.argv[2]]
  : readdirSync(dir).filter(f => f.endsWith('.png')).sort();

const RAMP = ' .:-=+*#%@';

// 游戏里的关键颜色（砖块 / 道具 / 背景）
const PALETTE = [
  ['背景深蓝', [5, 6, 15]], ['场地绿', [77, 255, 158]], ['霓虹青', [49, 242, 255]],
  ['洋红', [255, 62, 165]], ['黄绿(磁铁)', [163, 230, 53]], ['橙红(炸药)', [255, 107, 53]],
  ['棕(软砖)', [139, 74, 43]], ['金(金砖)', [255, 209, 102]], ['银白(转弯)', [226, 232, 240]],
  ['紫(3球)', [192, 132, 252]], ['蓝(S/冲击)', [56, 189, 248]], ['粉(+命)', [255, 143, 171]],
  ['红(N窄)', [255, 77, 77]], ['橙(F快)', [251, 146, 60]], ['青绿(W宽)', [94, 234, 212]],
];

function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 46) return -1;                        // 暗背景
  if (mx - mn < 24 && mx > 190) return -2;       // 近白
  let best = -1, bd = 1e9;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i][1];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return bd < 14000 ? best : -3;                 // 太远算"其他"
}

for (const f of files) {
  const file = path.isAbsolute(f) ? f : path.join(dir, f);
  let img;
  try { img = decodePNG(file); } catch (e) { console.log(`${f}: 解码失败 ${e.message}`); continue; }
  const { w, h, channels, data } = img;
  const px = (x, y) => { const i = (y * w + x) * channels; return [data[i], data[i + 1], data[i + 2]]; };

  // 亮度图 96x30
  const CW = 96, CH = 30, cw = w / CW, chh = h / CH;
  let ascii = '', catMap = '';
  const hits = new Map(), others = [];
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      let s = 0, n = 0, bestCat = -1, bestSat = 0, cellBd = 1e9;
      for (let y = Math.floor(cy * chh); y < Math.floor((cy + 1) * chh); y += 2) {
        for (let x = Math.floor(cx * cw); x < Math.floor((cx + 1) * cw); x += 2) {
          const [r, g, b] = px(x, y);
          const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          s += L; n++;
          const c = classify(r, g, b);
          const sat = Math.max(r, g, b) - Math.min(r, g, b);
          if (c >= 0) { hits.set(c, (hits.get(c) || 0) + 1); if (sat > bestSat) { bestSat = sat; bestCat = c; } }
          else if (c === -3 && others.length < 6) others.push([r, g, b]);
          if (c >= 0) { const [pr,pg,pb] = PALETTE[c][1]; const d=(r-pr)**2+(g-pg)**2+(b-pb)**2; if (d<cellBd){cellBd=d;} }
        }
      }
      const L = s / n;
      ascii += RAMP[Math.min(RAMP.length - 1, Math.round(L * (RAMP.length - 1) * 2.6))];
      catMap += bestCat >= 0 ? PALETTE[bestCat][0][0] : (L > 0.5 ? 'W' : (L > 0.09 ? '+' : '.'));
    }
    ascii += '\n'; catMap += '\n';
  }

  // 画布是否铺满：四角与边缘中点应是深色背景（而不是白/黑屏）
  const edge = [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3), px(w >> 1, 2), px(w >> 1, h - 3)];
  const edgeDark = edge.every(([r, g, b]) => Math.max(r, g, b) < 90);
  let nonDark = 0;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const [r, g, b] = px(x, y); if (Math.max(r, g, b) > 46) nonDark++; }
  const total = Math.ceil(h / 4) * Math.ceil(w / 4);

  console.log('\n' + '='.repeat(100));
  console.log(`${f}   ${w}x${h}  ${(statSync(file).size / 1024).toFixed(1)} KB`);
  console.log(`非暗像素占比 ${(nonDark / total * 100).toFixed(1)}%   边缘均暗=${edgeDark}`);
  const hitList = [...hits.entries()].sort((a, b) => b[1] - a[1])
    .map(([i, c]) => `${PALETTE[i][0]}:${c}`).join('  ');
  console.log('颜色命中: ' + (hitList || '(无)'));
  if (others.length) console.log('未归类样本: ' + others.map(o => o.join(',')).join(' | '));
  console.log('-'.repeat(100));
  console.log(ascii);
  console.log('-'.repeat(100));
  console.log(catMap);
}
