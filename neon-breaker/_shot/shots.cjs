/*
 * 用 headless Chrome 打开"真实游戏页面"，把游戏驱动到指定状态后截图。
 * 不重写任何绘制代码：注入的脚本只是设置状态 + 调用游戏自己的 render()。
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');            // neon-breaker/
const OUT  = path.join(ROOT, 'screenshots');
const TMP  = path.join(__dirname, 'html');
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const CHROME = process.env.CHROME ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 1280, H = 800;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sTag = html.indexOf('<script>');
const sEnd = html.indexOf('</script>');
if (sTag < 0 || sEnd < 0) throw new Error('找不到内联 script');
const shellHead = html.slice(0, sTag);
const gameSrc   = html.slice(sTag + '<script>'.length, sEnd);
const shellTail = html.slice(sEnd + '</script>'.length);

// 在游戏脚本之前：只做"确定性随机"。
// 注意**不能**把 requestAnimationFrame 变成空队列：Chrome 截图时会改变视口尺寸，
// 触发游戏的 resize() -> cv.width = ... -> 整块位图被清空。如果主循环停了，
// 就没人重画，截出来是一张空画布（8 张图字节完全相同的坑）。
// 正确做法是让主循环照常跑，改把 update() 冻住，这样每帧 render() 都会重画我们的场景。
const PRE = `<script>
(function (){ var s = 0x9E3779B9; Math.random = function (){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // 给场景一个复位钩子：A/B 两组每次都从同一个随机流起点开始 = 配对比较，
  // 否则"这组刚好抽到更顺的随机数"会冒充成机制的效果。
  window.__seedReset = function (s0){ s = (s0 === undefined ? 0x9E3779B9 : s0) >>> 0; }; })();
</script>`;

// 在游戏脚本之后：通用工具（复用游戏自己的 buildFromGrid / drawBricks / drawDrops）
const HELPERS = `
var S = { TITLE:0, READY:1, PLAY:2, PAUSE:3, LEVEL:4, DEAD:5, OVER:6, WIN:7, SELECT:8 };
var FONT = '"Microsoft YaHei","Segoe UI","Noto Sans SC",sans-serif';

/* 用真实的 buildFromGrid 造一块砖，再搬到任意位置 —— 保证 hp / 各 flag 是真的 */
function mkBrick(v){
  var kb = bricks, ka = portalA, kp = portalB;
  var row = [0,0,0,0,0,0,0,0,0,0]; row[4] = v;
  buildFromGrid([row]);
  var b = bricks[0];
  bricks = kb; portalA = ka; portalB = kp;
  return b;
}

/* 清空所有“场上对象”，方便做纯图鉴 */
function clearField(){
  bricks = []; drops = []; balls = []; particles = []; floats = [];
  shockwaves = []; explodingDepth = 0;
  portalA = null; portalB = null;
}

/* 把一组砖排成网格，返回 [{b, it}] */
function legendAdd(items, opt){
  var res = [];
  items.forEach(function (it, i){
    var r = Math.floor(i / opt.cols), c = i % opt.cols;
    var b = mkBrick(it.v);
    b.x = opt.x0 + c * opt.cellW + (opt.cellW - b.w) / 2;
    b.y = opt.y0 + r * opt.rowH;
    res.push({ b: b, it: it });
  });
  bricks = bricks.concat(res.map(function (o){ return o.b; }));
  portalA = bricks.filter(function (b){ return b.portalId === 1; })[0] || null;
  portalB = bricks.filter(function (b){ return b.portalId === 2; })[0] || null;
  return res;
}

/* 图鉴用的标注：深色圆角标签 */
function tag(text, cx, y, color, size){
  ctx.save(); setFrameTransform();
  ctx.font = 'bold ' + (size || 13) + 'px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(6,10,26,.92)';
  roundRect(cx - w/2 - 9, y - 12, w + 18, 24, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,200,255,.30)'; ctx.lineWidth = 1;
  roundRect(cx - w/2 - 9, y - 12, w + 18, 24, 7); ctx.stroke();
  ctx.fillStyle = color || '#dff6ff';
  ctx.fillText(text, cx, y + 1);
  ctx.restore();
}

function heading(text, y, color, size){
  ctx.save(); setFrameTransform();
  ctx.font = 'bold ' + (size || 23) + 'px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color || '#31f2ff'; ctx.shadowBlur = 20;
  ctx.fillStyle = color || '#dff6ff';
  ctx.fillText(text, 480, y);
  ctx.restore();
}

function note(text, y, color, size){
  ctx.save(); setFrameTransform();
  ctx.font = (size || 14) + 'px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color || 'rgba(198,224,255,.78)';
  ctx.fillText(text, 480, y);
  ctx.restore();
}

/* 清场 + 铺底色（等价于 render() 的前半段），供纯图鉴场景使用 */
function clearFrame(){
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  setFrameTransform();
}

/* 让挡板跟着球跑，跑 N 帧真实物理 —— 截图里的球路是真打出来的 */
function sim(n){
  for (var i = 0; i < n; i++){
    if (balls[0]) pointerTarget = balls[0].x;
    update(1/60);
  }
}

/* 直接推进物理但不做补偿（用于摆一个特定瞬间） */
function simRaw(n){
  for (var i = 0; i < n; i++) update(1/60);
}
`;

// ---------------------------------------------------------------- 各场景
const SCENES = {};

// 1. 标题
SCENES['01-title'] = `
G.state = S.TITLE; G.best = 48250; G.time = 1.2;
render();
`;

// 2. 对局中
SCENES['02-gameplay'] = `
newGame(); loadLevel(1);
G.best = 48250;
launch();
sim(430);                       // 真打 7 秒：砖被打掉一批、球在中场飞（拖尾是引擎自己记的）
G.score = 6420; G.combo = 5; G.comboTimer = 1.6; G.lives = 3;
// 补两个正在下落的道具，展示胶囊外观
drops.push({ x: 250, y: 300, v: 150, p: POWERS[0], t: 0.35 });
drops.push({ x: 700, y: 250, v: 150, p: POWERS[4], t: 1.1 });
render();
`;

// 3. 砖块图鉴
SCENES['03-bricks'] = `
newGame(); G.level = 0; G.time = 0.6;
clearField();
legendAdd([
  { v:1 }, { v:2 }, { v:3 }, { v:4 }, { v:5 }
], { cols:5, cellW:176, x0:40, y0:96, rowH:0 });
legendAdd([
  { v:-1 }, { v:9 }, { v:6 }, { v:15 }, { v:16 }, { v:14 }
], { cols:6, cellW:146, x0:42, y0:232, rowH:0 });
legendAdd([
  { v:10 }, { v:11 }, { v:12 }, { v:13 }, { v:20 }, { v:21 }
], { cols:6, cellW:146, x0:42, y0:368, rowH:0 });

var A = bricks.slice(0,5), B = bricks.slice(5,11), C = bricks.slice(11,17);
var LA = ['1 血','2 血','3 血','4 血','5 血（最硬）'];
var LB = ['实心砖 · 打不破','金砖 · 高分 120','裂纹砖 · 5 血不加分','炸药砖 · 一击即爆','磁铁砖 · 球得 10 秒磁力','棕色软砖 · 炸开的墙'];
var LC = ['转弯砖 ▲ 向上','转弯砖 ▶ 向右','转弯砖 ▼ 向下','转弯砖 ◀ 向左','传送门 · 剩余次数','传送门 · 同一对数'];

/* 覆写 render：每帧都重画这张图鉴（视口被改也不会变空） */
render = function (){
  clearFrame();
  drawBackground();
  drawBricks();
  heading('砖 块 图 鉴', 34, '#dff6ff', 23);
  A.forEach(function (b, i){ tag(LA[i], b.x + b.w/2, b.y + b.h + 26, '#9fe8ff', 13.5); });
  B.forEach(function (b, i){ tag(LB[i], b.x + b.w/2, b.y + b.h + 26, '#ffd166', 13.5); });
  C.forEach(function (b, i){ tag(LC[i], b.x + b.w/2, b.y + b.h + 26, '#c8b6ff', 13.5); });
  note('普通砖血量 1~5：击破得分随血量上升；实心砖打不破 —— 只有炸药砖的爆炸能把它炸成棕色软砖，之后才拆得动', 486, 'rgba(198,224,255,.82)', 14);
  note('棕色软砖只由爆炸产生（随机关卡里不会直接生成），2 血、可击破，是“墙被炸开”的视觉证据', 518, 'rgba(198,224,255,.72)', 13.5);
  note('传送门成对出现（全场只支持一对）：球进哪扇就从另一扇出来，同一个球 0.25 秒内不会被反复传送 · 转弯砖强制折向箭头方向', 550, 'rgba(198,224,255,.72)', 13.5);
  note('门上写的数字 = 这对门**还能用几次**（一对共享 10 次，两端显示同一个数），用完两扇一起消失', 576, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 4. 道具图鉴
SCENES['04-powers'] = `
newGame(); G.level = 0; G.time = 0.6;
clearField();
var good = POWERS.filter(function (p){ return p.good; });
var bad  = POWERS.filter(function (p){ return !p.good; });
var subG = ['挡板变宽，接球更稳','一次发三颗球','全场减速，给你反应时间','多一条命','立刻放一圈冲击波，清掉邻近的砖'];
var subB = ['挡板变窄，接球变难','球速暴涨，更难接'];
good.forEach(function (p, i){ drops.push({ x: 128 + i*176, y: 176, v: 150, p: p, t: 0.35 + i*0.27 }); });
bad.forEach(function (p, i){ drops.push({ x: 380 + i*200, y: 356, v: 150, p: p, t: 0.6 + i*0.31 }); });

render = function (){
  clearFrame();
  drawBackground();
  drawDrops();
  heading('道 具 图 鉴 · 7 种', 34, '#dff6ff', 23);
  note('击破砖块有 30% 概率掉落道具 · 益害比约 72 : 28', 70, 'rgba(198,224,255,.8)', 14);
  tag('益 道 具 · 5 种', 480, 122, '#7dffbe', 14);
  good.forEach(function (p, i){
    var x = 128 + i*176;
    tag(p.ch + '  ' + p.name, x, 216, p.c, 15);
    note(subG[i], x, 242, 'rgba(198,224,255,.78)', 12.5);
  });
  tag('害 道 具 · 2 种', 480, 302, '#ff8f8f', 14);
  bad.forEach(function (p, i){
    var x = 380 + i*200;
    tag(p.ch + '  ' + p.name, x, 396, p.c, 15);
    note(subB[i], x, 422, 'rgba(198,224,255,.78)', 12.5);
  });
  note('冲击波是唯一的“瞬发”道具：没有持续时间、没有玩家状态，所以连吃 3 个 = 3 次独立爆发，不需要叠加逻辑', 486, '#38bdf8', 14);
  note('场上已经没有可打碎的砖时，不会再掉无意义的“加宽 / 变窄”', 516, 'rgba(198,224,255,.72)', 13.5);
  note('“三球齐发”掉命后所有球一起贴板，再按空格会全部发射', 546, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 5. 爆炸 / 冲击波 / 连击
SCENES['05-effects'] = `
newGame(); loadLevel(2);
G.best = 48250; G.lives = 3;
launch();
sim(330);                       // 让挡板跟着球打一会儿，制造“战场”感（砖被打掉一批）
G.state = S.PLAY;
// 在砖区引爆，然后**真的推进 0.2 秒物理**：冲击波自然扩到半径 ~120px、
// 闪光按游戏自己的速率（1.6/秒）衰减掉，砖也是被这圈波真炸掉的。
// 手动摆一个 G.flash 大值再冻住 update 是不行的 —— 那样整幅画面会被白蒙住。
explode(480, 168, { forceSolids:false, rmax:180, speed:560 });
simRaw(12);
G.combo = 7; G.comboTimer = 2.0; G.score = 24680;
floats.push({ x: 590, y: 250, text: '+1,240  连击 x2.5', color: '#ffd166', life: 0.9, vy: -30 });
addParticles(480, 168, '#ffd166', 24, 1.4);
render();
`;

// 6. 磁铁砖 -> 磁力 buff（替换掉原来的引力井）
SCENES['06-magnet'] = `
newGame(); G.level = 0; G.time = 1.0;
clearField();
// 场地：右侧留一大片空区，砖区在左半边（这种"空一半"的场地随机关卡里很常见）。
// 磁铁砖留在砖区里 —— 它是磁力的来源，要能看见。
var grid = [
  [1,1,1,1,0,0,0,0,0,0],
  [1,0,16,1,0,0,0,0,0,0],
  [1,1,1,1,0,0,0,0,0,0],
  [2,2,2,2,0,0,0,0,0,0]
];
loadLevel(0, grid);
G.state = S.PLAY;
G.score = 12400; G.best = 48250; G.lives = 3;
// 球在右侧空区、朝**右上**飞（航向 -30°），而最近的活砖在**左上**方（约 -146°）。
// 初始航向误差约 116°，磁力每帧掰 10°，所以整条 14 点拖尾都落在"正在转弯"的阶段。
// （规则 3 把磁力从 2.2°/帧 提到 10°/帧 之后，误差小的话 5 帧就对准了、拖尾会变成直线，
//   所以这个演示场景特意用一个**大**初始误差，让弧线仍然看得见。）
balls = [ makeBall(820, 520, 230, -398) ];
balls[0].magnet = 7.4;
simRaw(16);
pointerTarget = balls[0] ? balls[0].x : 480;
// 覆写 render：游戏自己画完整一帧，再叠标注。必须覆写 —— 驱动在场景跑完后
// 会再调一次 render() 把画面重画一遍，不覆写的话标注会被这一帧抹掉
// （旧的 06-well 就是这么丢掉全部标注的）。
var __R = render;
render = function (){
  __R();
  tag('磁铁砖被击破 → 击破它的那颗球获得 10 秒磁力', 480, 448, '#a3e635', 15);
  note('磁力期间球整体变成黄绿色。它只在上行时朝最近的活砖转，每帧 10°（600°/秒）—— 一趟必失的球能被掰成必中', 486, 'rgba(198,224,255,.85)', 13.5);
  note('只转方向、不改速率（在速度矢量上做纯旋转，实测 |Δ速度| = 0）· 球往下掉时完全不介入，否则球永远回不到挡板', 516, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 6b. 防卡死引导：只在残局介入，且真的在掰弯轨迹时会改变球的外观
SCENES['09-assist'] = `
newGame(); G.level = 0; G.time = 1.0;
clearField();
// 残局：只剩 2 块可破坏砖（阈值是 ≤3）。左侧全部打空，砖都在右上角。
var grid = [
  [0,0,0,0,0,0,0,1,1,0],
  [0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0]
];
loadLevel(0, grid);
G.state = S.PLAY;
G.score = 31840; G.best = 48250; G.lives = 1;
G.stuckTimer = 0;
// 引导现在是**事件**：只在墙/砖反射的那一帧拨一次。
// 所以场景必须让它真的撞一次墙 —— 球以几乎水平的角度（离水平只有 2.9°）
// 冲向右侧墙，反弹的那一瞬间角度"不对"，拨正就发生在那里，
// 然后 assistFx 亮 0.2 秒（12 帧），正好被这 24 帧里的末尾抓到。
balls = [ makeBall(800, 300, 400, -20) ];
simRaw(20);                        // 第 ~19 帧撞右墙并拨正，末尾离峰值只差 1 帧
                                   // （assistFx 会在这 0.2 秒里线性淡出，抓晚了标记会太淡）
pointerTarget = balls[0] ? balls[0].x : 200;
var __R = render;
render = function (){
  __R();
  tag('贴水平撞墙的那一瞬 → 一次拨正', 480, 424, '#ffd93d', 15);
  note('引导只在"反弹的瞬间"判断一次：出射角贴水平（离水平 <30°）就拨一下，拨完就撒手', 486, 'rgba(198,224,255,.85)', 13.5);
  note('两帧之间它一帧都不介入 —— 球在砖与砖之间走的是纯净的反射（审计里那个 0 就是这件事）', 516, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 9b. 传送门次数：一对共享 10 次，用满后两扇一起消失
SCENES['10-portal'] = `newGame(); G.level = 6; G.time = 1.0;
clearField();
loadLevel(0, [
  [20, 0, 0, 0, 0, 0, 0, 0, 0, 21],
  [ 3, 3, 3, 0, 0, 0, 0, 0, 3,  3],
  [ 5, 5, 0, 0, 0, 0, 0, 0, 0,  5]
]);
G.state = S.PLAY;
G.score = 26400; G.best = 48250; G.lives = 2;
// 场景体就在游戏自己的作用域里，可以直接摆计数（loadLevel 之后才有效 —— 它会重置成 0）
portalUses = 9;                    // 只剩 1 次 -> 数字和剩余弧都转成琥珀色
// 球正从左边朝 A 门飞过去，好看清"进门前"的那一帧
balls = [ makeBall(300, 103, 420, 0) ];
simRaw(6);
var __R = render;
render = function (){
  __R();
  tag('门上写的是"还能用几次"', 480, 196, '#c4b5fd', 15);
  note('一对传送门共享 10 次（不分 A/B）—— 所以两端显示的是同一个数字；用到 ≤3 次时转成琥珀色', 486, 'rgba(198,224,255,.85)', 13.5);
  note('用满第 10 次时**两扇门一起消失**（只剩一扇既进不去也出不来，没有意义）', 516, 'rgba(198,224,255,.72)', 13.5);
  note('如果消失时还有砖被封在实心砖口袋里，会就地补开一道门 —— 不然那一关会变成永远打不通的死局', 546, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 10b. 贴水平下行的"角度突变 + 辅助线"
SCENES['11-flat'] = `
window.__out = [];
newGame(); G.level = 0; G.time = 1.0;
clearField();
// 空盘面 + 顶部三行砖：只是为了有背景，重点看球和辅助线
loadLevel(0, [
  [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0,  0],
  [5, 5, 5, 0, 0, 0, 0, 5, 5,  5]
]);
G.state = S.PLAY;
G.score = 18800; G.best = 48250; G.lives = 2;
// 贴水平**下行**的球，正朝左墙飞（离水平 3.7°）—— 改动前这一帧会被 vy>0 整个放过
balls = [ makeBall(42, 300, -420, 27) ];
var __b0 = balls[0];
var __before = Math.abs(Math.atan2(Math.abs(__b0.vy), Math.abs(__b0.vx))) * 180 / Math.PI;
var __beforeV = [+__b0.vx.toFixed(0), +__b0.vy.toFixed(0)];
simRaw(2);                       // 撞左墙 -> reflectNudge
var __b = balls[0];
var __after = Math.abs(Math.atan2(Math.abs(__b.vy), Math.abs(__b.vx))) * 180 / Math.PI;
var __afterV = [+__b.vx.toFixed(0), +__b.vy.toFixed(0)];
window.__out.push('撞墙前 速度=(' + __beforeV + ')  离水平 ' + __before.toFixed(1) + '°');
window.__out.push('撞墙后 速度=(' + __afterV + ')  离水平 ' + __after.toFixed(1) + '°');
window.__out.push('上行/下行：' + (__b.vy > 0 ? '下行（没有把球抢上去）' : '上行'));
window.__out.push('速率：' + Math.hypot(__beforeV[0], __beforeV[1]).toFixed(1) + ' -> ' +
                  Math.hypot(__afterV[0], __afterV[1]).toFixed(1));
window.__out.push('辅助线目标：' + JSON.stringify(__b.aimTarget) + '（y=554 = 挡板高度）');
window.__out.push('assistFx=' + __b.assistFx.toFixed(3) + '（>0 才会画琥珀环和辅助线）');
var __R = render;
render = function (){
  __R();
  tag('撞墙那一瞬间：贴水平（' + __before.toFixed(1) + '°）', 480, 196, '#ffd93d', 15);
  note('一次掰到 ' + __after.toFixed(1) + '° —— 角度突变，不再一路滑到墙上再滑回来', 486, 'rgba(198,224,255,.9)', 13.5);
  note('但没有把球抢上去：仍然向下飞（方向不变，只是不让它贴着水平滑）', 516, 'rgba(198,224,255,.72)', 13.5);
  note('琥珀虚线 = 辅助线提示：指向"按新航向落到挡板高度"的那一点', 546, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 12. 死砖口袋：引导改瞄"门口"（两跳绕路）
SCENES['12-nest'] = `
window.__out = [];
newGame(); G.level = 0; G.time = 1.0;
clearField();
// 三面死砖 + 右边留一格开口，可破坏砖躺在里面（生成期不认为它被封死）
loadLevel(0, [
  [0, 0, 0,  0,  0,  0, 0, 0, 0, 0],
  [0, 0, 0, -1, -1, -1, 0, 0, 0, 0],
  [0, 0, 0, -1,  1,  0, 0, 0, 0, 0],
  [0, 0, 0, -1, -1, -1, 0, 0, 0, 0],
  [0, 0, 0,  0,  0,  0, 0, 0, 0, 0]
]);
// 收尾 2（生成期把过窄的缝放宽）也会动这张夹具盘面：把卡住缝的 (1,5) 变成普通砖。
// 这张图要画的是"两跳绕路"本身，所以先把那一格堵回去（否则画的是另一张盘面）。
// G.lastBricks 也要一起同步：主循环靠它判断"有没有进展"。
var __w15 = bricks.find(function(x){ return x.row === 1 && x.col === 5; });
if (__w15 && !__w15.solid){ __w15.solid = true; __w15.type = -1; __w15.hp = __w15.max = 1; __w15.golden = false; }
G.lastBricks = breakableLeft();
G.state = S.PLAY;
G.score = 12400; G.best = 48250; G.lives = 2;
G.stuckTimer = 20;                     // 残局停滞：护送已经在工作
balls = [ makeBall(700, 430, -60, -400) ];
var __b = balls[0];
var __pocket = bricks.find(function(x){ return x.row === 2 && x.col === 4; });
var __cx = __pocket.x + __pocket.w / 2, __cy = __pocket.y + __pocket.h / 2;
var __directBlocked = lineBlockedBySolid(__b.x, __b.y, __cx, __cy);
simRaw(1);                             // 跑一帧，让护送把目标定下来
__b = balls[0];
var __spot = escortSpot(__b);
window.__out.push('可破坏砖=' + breakableLeft() + '  门控=' + assistGate());
window.__out.push('球 -> 砖心 的直线被死砖挡着：' + __directBlocked + '（"瞄死砖"就是这么来的）');
window.__out.push('护送这一帧瞄的其实是：' + (__spot ? '(' + __spot.x.toFixed(0) + ', ' + __spot.y.toFixed(0) + ')' : 'null') +
                  '   砖心=(' + __cx.toFixed(0) + ', ' + __cy.toFixed(0) + ')');
window.__out.push('aimTarget=' + JSON.stringify(__b.aimTarget && { x: +__b.aimTarget.x.toFixed(0), y: +__b.aimTarget.y.toFixed(0) }));
window.__out.push('绕路的两跳都通：球->门口 ' + !lineBlockedBySolid(__b.x, __b.y, __spot.x, __spot.y) +
                  '   门口->砖 ' + !lineBlockedBySolid(__spot.x, __spot.y, __cx, __cy));
var __R = render;
render = function (){
  __R();
  tag('死砖口袋：砖在前面，可直线永远穿死砖', 480, 196, '#ffd93d', 15);
  note('旧版：引导死盯着最近的活砖 -> 一次次撞在死砖上弹回来（实测 300 秒一次都没过关）', 486, 'rgba(198,224,255,.9)', 13.5);
  note('现在：先瞄"门口"那一格空位（琥珀虚线指过去），进了门再瞄砖 —— 这就是"转个圈再瞄准"', 516, 'rgba(198,224,255,.72)', 13.5);
  note('连续砸墙 10 次还进不去，就大幅转向换一条轨道，并且先静默 1 秒别把球掰回来', 546, 'rgba(198,224,255,.72)', 13.5);
  // 把"门口"画个圈，和砖心区分开（门口是空格，和砖心差着大半格）
  if (__spot){
    ctx.save(); setFrameTransform();
    ctx.strokeStyle = '#ffd93d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(__spot.x, __spot.y, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,217,61,.45)';
    ctx.beginPath();
    ctx.moveTo(__b.x, __b.y); ctx.lineTo(__spot.x, __spot.y);
    ctx.stroke();
    ctx.restore();
  }
};
`;

// 13/14. 玩家第 78 关的存档：收尾 2（生成期放宽过窄的缝）的"改前 / 改后"对图
// 这两张图上的数字不是写死的：场景用游戏自己的 mouthBand() 算出来，再塞进 __probe，
// 由 probe-px.mjs 断言（26px / 59px）。图上标的和代码算的必须是同一个数。
SCENES['13-lv78'] = `
newGame(); G.level = 78; G.time = 1.0;
loadLevel(78, [
  [ 0,-1, 0, 0,-1, 0, 0, 0, 0, 0],
  [ 0, 0, 0,-1, 0, 0, 0, 0,-1, 0],
  [-1,-1, 0, 0, 0, 0,-1, 0, 6,-1],
  [-1,-1, 0,-1, 0, 0, 0,-1, 6, 0],
  [ 0, 0, 0, 0,-1, 0, 0, 0,-1,-1]
]);
// 收尾 2 会把这关那条 26px 的缝放宽；这张图要画玩家发来的**原盘面**，先堵回去。
// 两处都要改回来：bricks 是画面，levelGrid 是生成器留下的格子快照（收尾 2 写的是它），
// 只改一处就会出现"画面是原盘面、判据算出来却是放宽后"的错位。
// （G.lastBricks 也要同步：主循环靠它判断"有没有进展"。）
(function(){
  var w = null, i;
  for (i = 0; i < bricks.length; i++) if (bricks[i].row === 2 && bricks[i].col === 9) w = bricks[i];
  if (w && !w.solid){ w.solid = true; w.type = -1; w.hp = w.max = 1; w.golden = false; }
  levelGrid[2][9] = T.SOLID;
  G.lastBricks = breakableLeft();
})();
// 护送先关掉（stuckTimer=0）：这两张图讲的是"缝有多宽"的几何，
// 不想让琥珀引导线抢戏（引导本身的图在 12-nest / 09-assist / 11-flat）。
G.state = S.PLAY; G.stuckTimer = 0; G.score = 91230; G.best = 604046; G.lives = 9;
balls = [ makeBall(912, 340, -60, -300) ];
simRaw(3);
window.__probe = [ ['band26', mouthBand(levelGrid, 3, 9, 0, -1, 7)] ];

function bx(x, y, w, h, col, dash){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  if (dash) ctx.setLineDash([6, 5]);
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.restore();
}
// 竖直双箭头 + 数字（画在竖井里，数字带深色底板，压到砖上也看得清）
function vBar(x, y1, y2, col, txt){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x - 5, y1 + 9); ctx.lineTo(x + 5, y1 + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x - 5, y2 - 9); ctx.lineTo(x + 5, y2 - 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  tag(txt, x, (y1 + y2) / 2, col, 14);
}
var __R = render;
render = function(){
  __R();
  heading('玩家第 78 关的存档（原盘面）', 42, '#ffd93d', 22);
  // 通关就看这两块裂纹砖（4 血）
  bx(732, 156, 78, 26, '#a9744a'); bx(732, 189, 78, 26, '#a9744a');
  bx(816, 189, 78, 26, '#ffd93d', true);
  vBar(915, 189, 215, '#ffd93d', '26px');
  tag('两块裂纹砖：通关就看它俩', 500, 170, '#e8b88a', 13.5);
  tag('唯一的入口 (3,9)', 520, 240, '#ffd93d', 13.5);
  note('17 块砖 = 15 块实心 + 2 块裂纹；(3,8) 唯一能打到的面在右边那格 (3,9)', 400, 'rgba(198,224,255,.92)', 14);
  note('(2,9)/(4,9) 都是实心砖 —— 球心从竖井横穿进去只有 26px 的余量（球直径 14px）', 430, 'rgba(198,224,255,.92)', 14);
  note('砖缝只有 6~7px，球钻不过砖缝，只能走整格：所以"洞口开在哪儿"就是一切', 460, 'rgba(198,224,255,.72)', 13.5);
};
`;

SCENES['14-widened'] = `
newGame(); G.level = 78; G.time = 1.0;
loadLevel(78, [
  [ 0,-1, 0, 0,-1, 0, 0, 0, 0, 0],
  [ 0, 0, 0,-1, 0, 0, 0, 0,-1, 0],
  [-1,-1, 0, 0, 0, 0,-1, 0, 6,-1],
  [-1,-1, 0,-1, 0, 0, 0,-1, 6, 0],
  [ 0, 0, 0, 0,-1, 0, 0, 0,-1,-1]
]);
// 这一张**不堵回去**：loadLevel 跑的是真实代码，收尾 2 已经把 (2,9) 放宽了
// （护送同样先关掉，见 13-lv78 的注释）
G.state = S.PLAY; G.stuckTimer = 0; G.score = 91230; G.best = 604046; G.lives = 9;
balls = [ makeBall(912, 340, -60, -300) ];
simRaw(3);
var __w29 = bricks.filter(function(b){ return b.row === 2 && b.col === 9; })[0];
window.__probe = [ ['band59', mouthBand(levelGrid, 3, 9, 0, -1, 7)],
                   ['cell29', __w29 ? (__w29.solid ? 'solid' : ('hp' + __w29.hp)) : 'missing'] ];

function bx(x, y, w, h, col, dash){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  if (dash) ctx.setLineDash([6, 5]);
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.restore();
}
function vBar(x, y1, y2, col, txt){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x - 5, y1 + 9); ctx.lineTo(x + 5, y1 + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x - 5, y2 - 9); ctx.lineTo(x + 5, y2 - 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  tag(txt, x, (y1 + y2) / 2, col, 14);
}
var __R = render;
render = function(){
  __R();
  heading('收尾 2：生成期把过窄的缝放宽之后', 42, '#4dff9e', 22);
  bx(732, 156, 78, 26, '#a9744a'); bx(732, 189, 78, 26, '#a9744a');
  bx(816, 156, 78, 26, '#4dff9e');
  vBar(915, 156, 215, '#4dff9e', '59px');
  ctx.save(); setFrameTransform();
  // 从被放宽的那一格指向它的"来历"：实心砖 -> 1 血普通砖
  ctx.strokeStyle = '#4dff9e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(816, 169); ctx.lineTo(716, 169); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(716, 169); ctx.lineTo(726, 164); ctx.lineTo(726, 174); ctx.closePath();
  ctx.fillStyle = '#4dff9e'; ctx.fill();
  ctx.restore();
  tag('这块实心砖 -> 1 血普通砖', 600, 140, '#4dff9e', 13.5);
  note('判据把"可破坏砖"当成打得掉、不挡路 —— 所以改完这一格，缝立刻算 59px（一格变两格）', 400, 'rgba(198,224,255,.92)', 14);
  note('真把它打掉之后，球心能走的竖直范围就是这 59px：推进去的那条缝从 26px 变成 59px', 430, 'rgba(198,224,255,.92)', 14);
  note('只开一格就收敛（不砸成空格：密度门限 ≥42/每行 ≥6 与存档下标映射都不能坏）', 460, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 15. 判据的几何：一格高的横缝 26px、两格高 59px、一格宽的竖缝 76px
SCENES['15-mouth'] = `
newGame(); G.level = 5; G.time = 1.0;
clearField();                                // 必须**在 newGame() 之后**清场：
                                             // 反过来的话 newGame 会把第 1 关的砖重新铺上，
                                             // 我的图鉴砖就叠在一堆无关的砖上面了
window.__out = [];
function put(v, r, c, dx, dy){
  var b = mkBrick(v);
  b.row = r; b.col = c;
  b.x = 60 + 84 * c + dx; b.y = 90 + 33 * r + dy;
  bricks.push(b);
  return b;
}
// A：一格高的横缝（上下各一排实心砖）  B：两格高  C：一格宽的竖缝（左右各一列实心砖）
var A = [[-1,-1,-1],[0,0,0],[-1,-1,-1]];
var B = [[-1,-1,-1],[0,0,0],[0,0,0],[-1,-1,-1]];
var C = [[-1,0,-1],[-1,0,-1],[-1,0,-1]];
[0, 2].forEach(function(r){ for (var c = 0; c < 3; c++) put(-1, r, c, -40, 60); });
[0, 3].forEach(function(r){ for (var c = 0; c < 3; c++) put(-1, r, c, 280, 40); });
[0, 1, 2].forEach(function(r){ put(-1, r, 0, 560, 60); put(-1, r, 2, 560, 60); });
function hBar(y, x1, x2, col, txt){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 + 9, y - 5); ctx.lineTo(x1 + 9, y + 5); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2 - 9, y - 5); ctx.lineTo(x2 - 9, y + 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  tag(txt, (x1 + x2) / 2, y - 20, col, 14);
}
function vBar(x, y1, y2, col, txt){
  ctx.save(); setFrameTransform();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x - 5, y1 + 9); ctx.lineTo(x + 5, y1 + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x - 5, y2 - 9); ctx.lineTo(x + 5, y2 - 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  tag(txt, x, (y1 + y2) / 2, col, 14);
}
window.__probe = [ ['bands', mouthBand(A, 1, 1, 0, -1, 7), mouthBand(B, 1, 1, 0, -1, 7), mouthBand(C, 2, 1, -1, 0, 7)] ];
var __R = render;
render = function(){
  __R();
  heading('判据：球心穿过一条缝时能用的净空', 38, '#31f2ff', 21);
  tag('一格高的横缝', 158, 118, '#ff6b6b', 13.5);
  tag('两格高的横缝', 470, 98, '#4dff9e', 13.5);
  tag('一格宽的竖缝', 760, 118, '#4dff9e', 13.5);
  vBar(292, 183, 209, '#ff6b6b', '26px');
  vBar(604, 163, 222, '#4dff9e', '59px');
  hBar(268, 705, 781, '#4dff9e', '76px');
  note('同一个判据（mouthBand）：只把实心砖当障碍 —— 可破坏砖"打得掉、不挡路"。', 380, 'rgba(198,224,255,.92)', 14);
  note('砖 78 < 格距 84、砖高 26 < 格距 33，所以横缝天然更窄：一格高只有 26px，一格宽的竖缝有 76px。', 410, 'rgba(198,224,255,.92)', 14);
  note('门限 NARROW_BAND = 45px 就卡在"一格高"和"两格高"之间：小于它就叫过窄，生成期把卡住它的实心砖改成普通砖。', 440, 'rgba(198,224,255,.72)', 13.5);
};
`;

// 7. 选关
SCENES['07-select'] = `G.state = S.SELECT; G.selectIdx = 1; G.best = 48250; G.time = 1.0;
render();
`;

// 8. 通关
SCENES['08-clear'] = `
newGame(); loadLevel(4);
G.state = S.LEVEL; G.score = 21680; G.best = 48250; G.lives = 3; G.combo = 9;
render();
`;

// 11. 审计：把每一帧的"方向改变"归因到具体来源
SCENES['98-flat'] = `
/* 玩家反馈："接近水平的轨迹还是没有防卡处理！应该角度突变+辅助线提示"
   先把"为什么没处理"量出来，再动代码。对每一个"贴水平帧"问四个问题：
     · 这一帧恰好发生反射了吗？（反射是拨正的唯一时机）
     · 球是在上行还是下行？（vy > 0 的下行球被有意放过了）
     · 反射的那一刻，reflectNudge 是被哪个条件挡下来的？
   —— 这四个数一对，就知道该改哪里了。 */
window.__out = [];
var L = window.__out;
// 场景自带百分比助手：driver 里的 pct() 定义在 90-line 场景体内，这里拿不到
function pct(x, n){ return n ? (x / n * 100).toFixed(1) + '%' : '0%'; }

function run(level, frames, seed, mode){
  if (window.__seedReset) window.__seedReset(seed);
  newGame(); G.level = level; loadLevel(level); launch();
  var s = { frames:0, flat:0, flatAsc:0, flatDesc:0, runs:0, longest:0, cur:0,
            flatWithRefl:0, calls:0, fired:0,
            dLock:0, dVy:0, dSp:0, dTgt:0, dOther:0,
            ascRefl:0, descRefl:0,
            // 残留的贴水平到底是"没人管"还是"转弯砖说它就该这样"
            flatLocked:0, flatSlow:0, loneRefl:0, loneReflLocked:0,
            over1s:0, over3s:0 };
  var __f = flatAngle, __r = reflectNudge;
  // mode 'old' = 复现改动前的那条判据（if (b.vy > 0) return false;），
  // 其余一律走现在的实现 —— 这样 A/B 的差别**只有这一条**，测的是同一个函数。
  reflectNudge = function(b, ex){
    s.calls++;
    var wasFlat = __f(b.vx, b.vy);
    if (mode === 'old' && b.vy > 0){ if (wasFlat) s.dVy++; return false; }
    var r = __r(b, ex);
    if (r) s.fired++;
    else if (wasFlat){
      // 复述内部判据（只为归因，不改行为）
      if (b.turnLock > 0) s.dLock++;
      else if (b.vy > 0) s.dVy++;
      else if (Math.hypot(b.vx, b.vy) <= 1) s.dSp++;
      else if (!nearestAimBrick(b.x, b.y, true, ex)) s.dTgt++;
      else s.dOther++;
    }
    return r;
  };
  var prevVx = 0, prevVy = 0;
  var trace = [];          // 当前贴水平段的逐帧轨迹
  var bestTrace = null, bestLen = 0;
  for (var i = 0; i < frames; i++){
    if (G.state === S.LEVEL){ loadLevel(level); launch(); continue; }
    if (G.state === S.READY) launch();
    var b = balls[0];
    if (b) pointerTarget = b.x;
    var ivx = b ? b.vx : 0, ivy = b ? b.vy : 0;
    update(1/60);
    var a = balls[0];
    if (!a) continue;
    s.frames++;
    var fh = Math.abs(Math.atan2(Math.abs(a.vy), Math.abs(a.vx))) * 180 / Math.PI;
    if (fh < 30){
      s.flat++;
      if (a.vy > 0) s.flatDesc++; else s.flatAsc++;
      if (a.turnLock > 0) s.flatLocked++;     // 转弯砖刚改过向，规则让路（设计如此）
      // 独立判"这一帧发生过反射"：速度分量变号（墙或砖都会让它变号）
      if (ivx * a.vx < 0 || ivy * a.vy < 0){
        s.flatWithRefl++;
        if (a.vy > 0) s.descRefl++; else s.ascRefl++;
        // 这一段贴水平里"唯一"的反射机会是不是又被让路窗口吃掉了？
        if (s.cur === 0){ s.loneRefl++; if (a.turnLock > 0) s.loneReflLocked++; }
      }
      s.cur++;
      trace.push([+a.x.toFixed(0), +a.y.toFixed(0), +a.vx.toFixed(0), +a.vy.toFixed(0),
                  +a.turnLock.toFixed(2), a.stuck ? 1 : 0]);
      if (s.cur > s.longest) { s.longest = s.cur; bestTrace = trace.slice(); bestLen = s.cur; }
    } else if (s.cur){
      // 一段贴水平结束：结算这一段的长度
      s.runs++;
      if (s.cur > 60) s.over1s++;          // > 1 秒
      if (s.cur > 180) s.over3s++;         // > 3 秒
      s.cur = 0; trace = [];
    }
    prevVx = a.vx; prevVy = a.vy;
  }
  if (s.cur){
    s.runs++;
    if (s.cur > 60) s.over1s++;
    if (s.cur > 180) s.over3s++;
  }
  s.trace = bestTrace || [];
  reflectNudge = __r;
  return s;
}

var FC = { frames:0, flat:0, flatAsc:0, flatDesc:0, runs:0, longest:0, cur:0,
           flatWithRefl:0, calls:0, fired:0, dLock:0, dVy:0, dSp:0, dTgt:0, dOther:0,
           ascRefl:0, descRefl:0, over1s:0, over3s:0 };
[[0, '第 1 关'], [4, '第 5 关'], [19, '第 20 关']].forEach(function(pair){
  var s = run(pair[0], 18000, 0x2545F491, 'new');
  for (var k in FC) if (typeof FC[k] === 'number') FC[k] += s[k];
  L.push('── ' + pair[1] + ' · 300 秒 ──');
  L.push('   贴水平帧 ' + s.flat + ' (' + pct(s.flat, s.frames) + ')   其中上行 ' + s.flatAsc +
         ' / 下行 ' + s.flatDesc);
  L.push('   贴水平"连续段" ' + s.runs + ' 段，最长 ' + s.longest + ' 帧 (' +
         (s.longest/60).toFixed(1) + ' 秒)   >1 秒的 ' + s.over1s + ' 段，>3 秒的 ' + s.over3s + ' 段');
  L.push('   ★ 贴水平帧里**恰好发生反射**的 ' + s.flatWithRefl + ' 帧' +
         '（上行 ' + s.ascRefl + ' / 下行 ' + s.descRefl + '）—— 只有这些帧才有机会被拨');
  L.push('   reflectNudge 被调用 ' + s.calls + ' 次，拨了 ' + s.fired + ' 次');
  L.push('     被挡下来的原因：turnLock ' + s.dLock + '   vy>0(下行) ' + s.dVy +
         '   速度≈0 ' + s.dSp + '   没有目标砖 ' + s.dTgt + '   其它 ' + s.dOther);
  L.push('   残留的贴水平里，处在转弯砖"让路窗口"内的 ' + s.flatLocked + ' 帧 (' +
         pct(s.flatLocked, s.flat) + ')  <- 这部分是设计：箭头说了算');
  L.push('   只遇到过一次反射机会的贴水平段 ' + s.loneRefl + ' 段，其中被让路窗口吃掉的 ' +
         s.loneReflLocked + ' 段');
  if (s.trace && s.trace.length > 6){
    L.push('   ~ 最长那一段的逐帧轨迹（x, y, vx, vy, turnLock, stuck）—— 前 4 帧 / 后 3 帧：');
    var tt = s.trace;
    var show = tt.slice(0, 4).concat([['…','…','…','…','…','…']], tt.slice(-3));
    show.forEach(function(r){ L.push('       ' + r.join('  ')); });
    var xs = tt.map(function(r){ return r[0]; }), ys = tt.map(function(r){ return r[1]; });
    L.push('       x 范围 ' + Math.min.apply(null, xs) + ' ~ ' + Math.max.apply(null, xs) +
           '   y 范围 ' + Math.min.apply(null, ys) + ' ~ ' + Math.max.apply(null, ys));
  }
});
L.push('');
L.push('=== 三关合计 ===');
L.push('   贴水平帧 ' + FC.flat + '（上行 ' + FC.flatAsc + ' / 下行 ' + FC.flatDesc + '）' +
       '   发生反射的贴水平帧 ' + FC.flatWithRefl + '（上行 ' + FC.ascRefl + ' / 下行 ' + FC.descRefl + '）');
L.push('   拨正 ' + FC.fired + ' 次；被 vy>0 挡下 ' + FC.dVy + '，被 turnLock 挡下 ' + FC.dLock +
       '，没有目标砖 ' + FC.dTgt);
L.push('   贴水平段 >1 秒 ' + FC.over1s + ' 段，>3 秒 ' + FC.over3s + ' 段');

L.push('');
L.push('=== 改动的效果：30 个关卡 × 60 秒，同种子配对，A/B 只差"下行贴水平管不管" ===');
L.push('    关卡            旧（vy>0 放过）            新（掰陡下滑角）');
L.push('                  贴水平帧%   最长段(s)       贴水平帧%   最长段(s)   段数');
var A = { frames:0, flat:0, longest:0, over1s:0, over3s:0, runs:0 };
var B = { frames:0, flat:0, longest:0, over1s:0, over3s:0, runs:0 };
var A2 = { frames:0, flat:0, longest:0, over1s:0, over3s:0, runs:0 };
var B2 = { frames:0, flat:0, longest:0, over1s:0, over3s:0, runs:0 };
var worst = [];
for (var lv = 0; lv < 30; lv++){
  var seed = 0x2545F491 + lv * 7919;
  var sOld = run(lv, 3600, seed, 'old');
  var sNew = run(lv, 3600, seed, 'new');
  var acc = function(T, s){ T.frames += s.frames; T.flat += s.flat; T.runs += s.runs;
                            T.over1s += s.over1s; T.over3s += s.over3s;
                            if (s.longest > T.longest) T.longest = s.longest; };
  // 第 1 个种子固定那一批和后面随机那批分开累计（避免同一关被算两次）
  if (lv === 0){ A2 = sOld; B2 = sNew; }
  acc(A, sOld); acc(B, sNew);
  if (sOld.longest > 600 || sNew.longest > 600)
    worst.push('      第 ' + (lv+1) + ' 关: 旧最长 ' + (sOld.longest/60).toFixed(1) +
               's -> 新最长 ' + (sNew.longest/60).toFixed(1) + 's');
  L.push('    第 ' + String(lv+1).padStart(2) + ' 关        ' +
         pct(sOld.flat, sOld.frames).padStart(7) + '   ' +
         (sOld.longest/60).toFixed(1).padStart(8) + '        ' +
         pct(sNew.flat, sNew.frames).padStart(7) + '   ' +
         (sNew.longest/60).toFixed(1).padStart(8) + '   ' +
         String(sNew.runs).padStart(4));
}
L.push('');
L.push('   ── 30 关汇总（每关 60 秒 × 2 组）──');
L.push('   旧：贴水平帧 ' + A.flat + ' / ' + A.frames + ' = ' + pct(A.flat, A.frames) +
       '   最长一段 ' + (A.longest/60).toFixed(1) + ' 秒   >1 秒的段 ' + A.over1s +
       '（>3 秒 ' + A.over3s + '）');
L.push('   新：贴水平帧 ' + B.flat + ' / ' + B.frames + ' = ' + pct(B.flat, B.frames) +
       '   最长一段 ' + (B.longest/60).toFixed(1) + ' 秒   >1 秒的段 ' + B.over1s +
       '（>3 秒 ' + B.over3s + '）');
L.push('   => 贴水平帧 ' + pct(A.flat, A.frames) + ' -> ' + pct(B.flat, B.frames) +
       '，最长一段 ' + (A.longest/60).toFixed(1) + 's -> ' + (B.longest/60).toFixed(1) + 's');
if (worst.length){
  L.push('   改动前后都超过 10 秒的关卡（残留）：');
  worst.forEach(function(w){ L.push(w); });
}
if (window.__shotOnly !== true){}
`;

SCENES['99-cycle'] = `
/* 玩家反馈："有一关的死砖虽然没有全包围，但是接近 3/4 包围，导致一直在撞死砖
   循环了好几个 40 秒。能不能连续砸墙 10 次就转个圈再瞄准。"
   先把那个循环复现出来：
     · 死砖围三面、留一格开口，可破坏砖在里面（生成期不视为"封死"，不会补开门）
     · 残局（≤3 块）-> 护送每帧都在瞄它 -> 瞄的直线被死砖挡着 -> 撞回来 -> 再瞄
   计量全部**独立于游戏内部**：砖血总和掉了 = 打到了可破坏砖；否则速度分量变号 = 死反弹。 */
window.__out = [];
window.__NB_DEBUG = {};
function pct(x, n){ return n ? (x / n * 100).toFixed(1) + '%' : '0%'; }
function hpLeft(){ var n = 0; for (var i=0;i<bricks.length;i++){ var b=bricks[i]; if (!b.dead && !isFurniture(b)) n += Math.max(0,b.hp); } return n; }
function aliveLeft(){ var n = 0; for (var i=0;i<bricks.length;i++){ var b=bricks[i]; if (!b.dead && !isFurniture(b)) n++; } return n; }

/* "死反弹"的定义（全部独立于游戏内部）：
     砖血总和掉了 = 打到了可破坏砖；否则速度分量变号 = 撞墙或撞死砖 = 一次死反弹。
   问题在于：**普通来回打（rally）也会连续死反弹**（球在清空的下半场弹来弹去），
   所以"连续 10 次"这个触发条件必须再区分"真的在绕圈"和"玩家还在打"。
   这里同时量三个候选判据，用数据决定：
     (A) 连续死反弹 >= 10
     (B) 其中这段时间里球的出射角**重复出现**（同一个角度出现 >= 3 次）—— 绕圈的签名
     (C) 其中**一次都没碰到挡板** —— 碰到挡板说明角度本来就会被换掉 */
function mkCounter(){
  return { run:0, runs10:0, runs20:0, maxRun:0, noHit:0, maxNoHit:0, lastHp:0,
           // (B) 角度重复
           ring:[], repeatBounce:0, allBounce:0, repeat10:0,
           // (C) 挡板
           paddleInRun:0, runWithPaddle:0, run10Clean:0, run10Paddle:0,
           // 长度直方图
           b10:0, b20:0, b40:0, b80:0 };
}
function bounce(c, ang){
  c.ring.push(ang);
  if (c.ring.length > 12) c.ring.shift();
  var near = 0;
  for (var k = 0; k < c.ring.length; k++){
    var d = Math.abs(c.ring[k] - ang);
    if (d < 10 * Math.PI / 180) near++;
  }
  c.allBounce++;
  if (near >= 3) c.repeatBounce++;       // 这个角度在最近 12 次里出现过 >=3 次
  return near >= 3;
}
function closeRun(c){
  if (c.run >= 10){
    c.runs10++;
    if (c.repeatInRun >= 3) c.repeat10++;
    if (c.paddleInRun === 0) c.run10Clean++; else c.run10Paddle++;
  }
  if (c.run >= 20) c.runs20++;
  // 长度直方图：决定阈值该取多少才有分辨力
  if (c.run >= 10) c.b10++;
  if (c.run >= 20) c.b20++;
  if (c.run >= 40) c.b40++;
  if (c.run >= 80) c.b80++;
  if (c.run > c.maxRun) c.maxRun = c.run;
  c.run = 0; c.repeatInRun = 0; c.paddleInRun = 0;
}

// 死砖围三面、右边留一格开口。可破坏砖 (2,4) 的直线无论从哪儿来都被挡着，
// 但"走进那格开口"是能打到的 —— 生成期因此不认为它被封死。
var NEST = [
  [0,0,0, 0, 0, 0,0,0,0,0],
  [0,0,0,-1,-1,-1,0,0,0,0],
  [0,0,0,-1, 5, 0,0,0,0,0],
  [0,0,0,-1,-1,-1,0,0,0,0],
  [0,0,0, 0, 0, 0,0,0,0,0]
];
var SEALED = [
  [0,0,0, 0, 0, 0,0,0,0,0],
  [0,0,0,-1,-1,-1,0,0,0,0],
  [0,0,0,-1, 5,-1,0,0,0,0],
  [0,0,0,-1,-1,-1,0,0,0,0],
  [0,0,0, 0, 0, 0,0,0,0,0]
];

function play(grid, label, frames, mode){
  // A/B：mode='old' 就是修复前的护送（死盯着最近的活砖，哪怕直线穿死砖），
  //      mode='route' 只开两跳绕路，mode='full' 再加上保险 4 的"转个圈"。
  // 判据必须和被测函数分开：这里量的是"砖血总和有没有掉"和"速度分量有没有变号"。
  var __spot = escortSpot, __cycle = cycleBreak;
  if (mode === 'old'){
    escortSpot = function(bb){
      var t = nearestAimBrick(bb.x, bb.y, true);
      return t ? { x: t.x + t.w/2, y: t.y + t.h/2, brick: t } : null;
    };
    cycleBreak = function(){ return false; };
  } else if (mode === 'route'){
    cycleBreak = function(){ return false; };
  }
  window.__seedReset(0x2545F491);
  newGame(); G.level = 0;
  // 收尾 2（生成期把"一格宽的缝"放宽）会动 NEST 这条缝：把卡住缝的 (1,5) 变成普通砖。
  // 这一节量的就是**这个病态形状**（三面被死砖围住、只留一格开口），
  // 所以量之前先把它堵回去，否则量的是"已经被生成期修好的盘面"。
  // 还得把 G.lastBricks 一起改回去：主循环靠"上次剩几块"判断有没有进展，
  // 改完砖不改它就会白白清空一次停滞计时器。
  function loadBoard(){
    loadLevel(0, grid);
    if (grid === NEST){
      for (var i2 = 0; i2 < bricks.length; i2++){
        var w2 = bricks[i2];
        if (w2.row === 1 && w2.col === 5 && !w2.dead && !w2.solid){
          w2.solid = true; w2.type = -1; w2.hp = w2.max = 1; w2.golden = false;
        }
      }
      var n2 = 0;
      for (var j2 = 0; j2 < bricks.length; j2++){ var b3 = bricks[j2]; if (!b3.dead && !isFurniture(b3)) n2++; }
      G.lastBricks = n2;
    }
    launch();
  }
  loadBoard();
  var s = mkCounter();
  s.frames = 0; s.clears = 0; s.deaths = 0; s.aimFrames = 0; s.blockedAim = 0;
  s.lastHp = hpLeft(); s.repeatInRun = 0;
  var paddles = 0;
  var cb0 = window.__NB_DEBUG.cycleBreaks || 0;
  var _p = Sound.paddle;
  Sound.paddle = function(){ paddles++; return _p.apply(Sound, arguments); };
  for (var i = 0; i < frames; i++){
    if (G.state === S.LEVEL){
      // 过关重铺 -> 计数必须重置，否则上一关的读数会漏到下一关（第一次量就踩了这个坑）
      closeRun(s); s.clears++; s.noHit = 0;
      loadBoard(); s.lastHp = hpLeft(); continue;
    }
    if (G.state === S.READY) launch();
    var b = balls[0];
    if (b) pointerTarget = b.x;
    var ivx = b ? b.vx : 0, ivy = b ? b.vy : 0;
    var p0 = paddles;
    update(1/60);
    var a = balls[0];
    if (!a){ s.deaths++; continue; }
    s.frames++;
    if (paddles > p0) s.paddleInRun += (paddles - p0);
    var hp = hpLeft();
    var refl = (ivx * a.vx < 0 || ivy * a.vy < 0);
    if (hp < s.lastHp){
      closeRun(s);
      s.noHit = 0; s.lastHp = hp;
    } else if (refl){
      s.run++;
      s.noHit++;
      if (s.noHit > s.maxNoHit) s.maxNoHit = s.noHit;
      if (bounce(s, Math.atan2(a.vy, a.vx))) s.repeatInRun++;
    } else {
      s.noHit++;
      if (s.noHit > s.maxNoHit) s.maxNoHit = s.noHit;
    }
    if (a.aimTarget){
      s.aimFrames++;
      if (lineBlockedBySolid(a.x, a.y, a.aimTarget.x, a.aimTarget.y)) s.blockedAim++;
    }
  }
  closeRun(s);
  Sound.paddle = _p;
  escortSpot = __spot; cycleBreak = __cycle;
  window.__out.push('── ' + label + ' · ' + (frames/60) + ' 秒 ──');
  window.__out.push('   过关 ' + s.clears + ' 次   掉命 ' + s.deaths + ' 次   挡板反弹 ' + paddles + ' 次');
  window.__out.push('   ★ 最长"没碰到任何可破坏砖" ' + (s.maxNoHit/60).toFixed(1) + ' 秒');
  window.__out.push('   ★ 最长连续死反弹 ' + s.maxRun + ' 次');
  window.__out.push('   (A) 连续死反弹 >=10 的回数 ' + s.runs10 + '   >=20 的 ' + s.runs20);
  window.__out.push('   (B) 其中这段里角度重复 >=3 次的 ' + s.repeat10 + ' 回   （所有死反弹里角度重复的占 ' +
                    pct(s.repeatBounce, s.allBounce) + '）');
  window.__out.push('   (C) 其中一次都没碰挡板的 ' + s.run10Clean + ' 回；碰过挡板的 ' + s.run10Paddle + ' 回');
  window.__out.push('   护送的瞄准线被死砖挡着的占 ' + pct(s.blockedAim, s.aimFrames) +
                    '（' + s.blockedAim + '/' + s.aimFrames + '）  <- "瞄死砖"');
  window.__out.push('   保险 4「转个圈」触发 ' + ((window.__NB_DEBUG.cycleBreaks || 0) - cb0) + ' 次');
  return s;
}

play(NEST,   '① 旧版：护送死盯着最近的活砖（砖在口袋里 -> 直线穿死砖）', 18000, 'old');
play(NEST,   '② 只加两跳绕路（先奔"门口"再瞄砖）', 18000, 'route');
play(NEST,   '③ 绕路 + 保险 4「转个圈」（本次修复的完整形态）', 18000, 'full');
play(SEALED, '④ 对照组·四面全封死（生成期会补开一道门）+ 完整修复', 18000, 'full');
window.__out.push('');
window.__out.push('=== 真实随机关卡：连续死反弹有多长、其中多少是"真绕圈"（30 关 × 120 秒）===');
var tot = { frames:0, runs10:0, runs20:0, maxRun:0, maxNoHit:0, repeat10:0,
            run10Clean:0, run10Paddle:0, allBounce:0, repeatBounce:0, worst:[],
            b10:0, b20:0, b40:0, b80:0, blockedAim:0, aimFrames:0, cycleBreaks:0 };
var cbTot0 = window.__NB_DEBUG.cycleBreaks || 0;
var cbWorst = [];
for (var lv = 0; lv < 30; lv++){
  window.__seedReset(0x2545F491 + lv * 7919);
  newGame(); G.level = lv; loadLevel(lv); launch();
  var st = mkCounter();
  st.lastHp = hpLeft(); st.repeatInRun = 0;
  var paddles2 = 0, maxNoHit = 0;
  var cbLv0 = window.__NB_DEBUG.cycleBreaks || 0;
  var _p2 = Sound.paddle;
  Sound.paddle = function(){ paddles2++; return _p2.apply(Sound, arguments); };
  for (var i = 0; i < 7200; i++){
    if (G.state === S.LEVEL){ closeRun(st); st.noHit = 0; loadLevel(lv); launch(); st.lastHp = hpLeft(); continue; }
    if (G.state === S.READY) launch();
    var b2 = balls[0];
    if (b2) pointerTarget = b2.x;
    var jvx = b2 ? b2.vx : 0, jvy = b2 ? b2.vy : 0;
    var q0 = paddles2;
    update(1/60);
    var a2 = balls[0];
    if (!a2) continue;
    tot.frames++;
    if (paddles2 > q0) st.paddleInRun += (paddles2 - q0);
    var hp2 = hpLeft();
    var refl2 = (jvx * a2.vx < 0 || jvy * a2.vy < 0);
    if (hp2 < st.lastHp){ closeRun(st); st.noHit = 0; st.lastHp = hp2; }
    else {
      st.noHit++;
      if (st.noHit > maxNoHit) maxNoHit = st.noHit;
      if (refl2){
        st.run++;
        if (bounce(st, Math.atan2(a2.vy, a2.vx))) st.repeatInRun++;
      }
    }
  }
  closeRun(st);
  Sound.paddle = _p2;
  if (st.maxRun > tot.maxRun) tot.maxRun = st.maxRun;
  if (maxNoHit > tot.maxNoHit) tot.maxNoHit = maxNoHit;
  tot.runs10 += st.runs10; tot.runs20 += st.runs20; tot.repeat10 += st.repeat10;
  tot.run10Clean += st.run10Clean; tot.run10Paddle += st.run10Paddle;
  tot.b10 += st.b10; tot.b20 += st.b20; tot.b40 += st.b40; tot.b80 += st.b80;
  tot.blockedAim += st.blockedAim; tot.aimFrames += st.aimFrames;
  tot.allBounce += st.allBounce; tot.repeatBounce += st.repeatBounce;
  if (st.runs10 >= 8) tot.worst.push('      第 ' + (lv+1) + ' 关: >=10 的 ' + st.runs10 +
      ' 回（其中角度重复 ' + st.repeat10 + ' / 没碰挡板 ' + st.run10Clean + '）  最长连续 ' +
      st.maxRun + ' 次  最长无进展 ' + (maxNoHit/60).toFixed(1) + ' 秒');
  var cbLv = (window.__NB_DEBUG.cycleBreaks || 0) - cbLv0;   // 本关增量，不是累计
  if (cbLv > 0) cbWorst.push('      第 ' + (lv+1) + ' 关: 触发 ' + cbLv + ' 次');
}
tot.cycleBreaks = (window.__NB_DEBUG.cycleBreaks || 0) - cbTot0;
window.__out.push('   保险 4「转个圈」在 30 关 × 120 秒里一共触发 ' + tot.cycleBreaks + ' 次' +
                  (cbWorst.length ? '（' + cbWorst.join('；') + '）' : '（一次都没触发）'));
window.__out.push('   最长连续死反弹 ' + tot.maxRun + ' 次');
window.__out.push('   (A) >=10 的回数 ' + tot.runs10 + '   >=20 的 ' + tot.runs20);
window.__out.push('   长度直方图：>=10 ' + tot.b10 + '   >=20 ' + tot.b20 + '   >=40 ' + tot.b40 + '   >=80 ' + tot.b80);
window.__out.push('   护送瞄准线被死砖挡着的比例：' + pct(tot.blockedAim, tot.aimFrames) + '（' + tot.blockedAim + '/' + tot.aimFrames + ' 帧）');
window.__out.push('   (B) 其中角度重复 >=3 次的 ' + tot.repeat10 + ' 回   所有死反弹里角度重复的占 ' +
                  pct(tot.repeatBounce, tot.allBounce));
window.__out.push('   (C) 其中一次没碰挡板的 ' + tot.run10Clean + ' 回；碰过挡板的 ' + tot.run10Paddle + ' 回');
window.__out.push('   最长"没碰到任何可破坏砖" ' + (tot.maxNoHit/60).toFixed(1) + ' 秒');
if (tot.worst.length) tot.worst.forEach(function(w){ window.__out.push(w); });
if (window.__shotOnly !== true){}
`;

SCENES['99-lv78'] = `
/* 玩家发了存档码（第 78 关）说"还是非常卡"。解出来是：
     · 非空格子 17 = 15 块实心砖 + **2 块可破坏砖**（都是裂纹砖、各 4 血）
     · 两块砖在 (2,8) 和 (3,8) —— 上下叠着，唯一的入口是右边那格 (3,9)
   画出来（██ 实心、6 可破坏、· 空）：
        ·██ · ·██ · · · · ·
        · · ·██ · · · ·██ ·
       ████ · · · ·██ · 6██
       ████ ·██ · · ·██ 6 ·
        · · · ·██ · · ·████
   也就是"最后两块砖在一个只有一格宽的洞里"。这一节先把这个洞量出来。 */
window.__out = [];
window.__NB_DEBUG = {};
function pc(x, n){ return n ? (x / n * 100).toFixed(1) + '%' : '0%'; }
function hpLeft(){ var n = 0; for (var i=0;i<bricks.length;i++){ var b=bricks[i]; if (!b.dead && !isFurniture(b)) n += Math.max(0,b.hp); } return n; }

var LV78 = [
  [0, -1, 0, 0, -1, 0, 0, 0, 0, 0],
  [0, 0, 0, -1, 0, 0, 0, 0, -1, 0],
  [-1, -1, 0, 0, 0, 0, -1, 0, 6, -1],
  [-1, -1, 0, -1, 0, 0, 0, -1, 6, 0],
  [0, 0, 0, 0, -1, 0, 0, 0, -1, -1]
];

function run78(label, frames, mode, raw){
  var __spot = escortSpot, __cycle = cycleBreak;
  if (mode === 'old'){                      // 修复前：只瞄"最近的活砖"
    escortSpot = function(bb){
      var t = nearestAimBrick(bb.x, bb.y, true);
      return t ? { x: t.x + t.w/2, y: t.y + t.h/2, brick: t } : null;
    };
    cycleBreak = function(){ return false; };
  } else if (mode === 'route'){             // 只保留两跳绕路
    cycleBreak = function(){ return false; };
  }
  // 收尾 2（生成期把"一格宽的缝"放宽）会把 (2,9) 那块实心砖变成普通砖。
  // 要量"玩家发来那张原盘面"就得把它堵回去 —— 否则量的是放宽之后的盘面。
  function unWiden(){
    for (var i = 0; i < bricks.length; i++){
      var w = bricks[i];
      if (w.row === 2 && w.col === 9 && !w.dead && !w.solid){
        w.solid = true; w.type = -1; w.hp = w.max = 1; w.golden = false;
      }
    }
    // 改完砖还要把"上次剩几块"改回去，否则主循环会白白清空一次停滞计时器
    var n = 0;
    for (var j = 0; j < bricks.length; j++){ var b2 = bricks[j]; if (!b2.dead && !isFurniture(b2)) n++; }
    G.lastBricks = n;
  }
  function load78(){
    loadLevel(78, LV78);
    if (raw) unWiden();
    launch();
  }
  window.__seedReset(0x2545F491);
  newGame(); G.level = 78;
  load78();
  var s = { frames:0, clears:0, deaths:0, inTunnel:0, atDoor:0, inShaft:0,
            blocked:0, aimFrames:0, first38:-1, first28:-1, hp38:4, hp28:4,
            spotBrick:0, spotDoor:0, spotBank:0, spotGate:0, spotNull:0, spotSamples:0, minHp:99,
            bankAt:[], bankDump:[] };
  var b38 = bricks.filter(function(b){ return b.row === 3 && b.col === 8; })[0];
  var b28 = bricks.filter(function(b){ return b.row === 2 && b.col === 8; })[0];
  for (var i = 0; i < frames; i++){
    if (G.state === S.LEVEL){ s.clears++; load78();
      b38 = bricks.filter(function(b){ return b.row === 3 && b.col === 8; })[0];
      b28 = bricks.filter(function(b){ return b.row === 2 && b.col === 8; })[0]; continue; }
    if (G.state === S.READY) launch();
    var b = balls[0];
    if (b) pointerTarget = b.x;
    update(1/60);
    var a = balls[0];
    if (!a){ s.deaths++; continue; }
    s.frames++;
    // "在门口"：球心落在右竖井里、且纵向正好在行 3 那条带上（进入隧道的唯一窗口）
    if (a.x >= 895 && a.x <= 935){
      s.inShaft++;
      if (a.y >= 183 && a.y <= 221) s.atDoor++;
    }
    // "进了隧道"：球心进了隧道那两格的横向范围，且纵向在行 3 带里
    if (a.x >= 734 && a.x <= 892 && a.y >= 183 && a.y <= 221) s.inTunnel++;
    if (a.aimTarget){
      s.aimFrames++;
      if (lineBlockedBySolid(a.x, a.y, a.aimTarget.x, a.aimTarget.y)) s.blocked++;
    }
    if (s.frames % 30 === 0){
      var sp = escortSpot(a);
      s.spotSamples++;
      if (!sp) s.spotNull++;
      else if (sp.bank){ s.spotBank++;
        // 借墙成立时球在哪儿（看瓶颈是不是"球根本不在能借墙的位置"）
        s.bankAt.push([Math.round(a.x / 120), Math.round(a.y / 120)]);
        if (s.bankDump.length < 8) s.bankDump.push('球(' + a.x.toFixed(0) + ',' + a.y.toFixed(0) +
          ')->墙(' + sp.x.toFixed(0) + ',' + sp.y.toFixed(0) + ') 瞄砖行' + sp.brick.row + '列' + sp.brick.col); }
      else if (sp.gate) s.spotGate++;
      else if (sp.brick && Math.abs(sp.x - (sp.brick.x + sp.brick.w/2)) < 1e-6 &&
               Math.abs(sp.y - (sp.brick.y + sp.brick.h/2)) < 1e-6) s.spotBrick++;
      else s.spotDoor++;
    }
    if (b38 && !b38.dead && s.first38 < 0) s.first38 = i;
    if (b28 && !b28.dead && s.first28 < 0) s.first28 = i;
    if (b38 && !b38.dead && b38.hp < s.hp38) s.hp38 = b38.hp;
    if (b28 && !b28.dead && b28.hp < s.hp28) s.hp28 = b28.hp;
  }
  escortSpot = __spot; cycleBreak = __cycle;
  if (mode === 'full' && typeof LV78 !== 'undefined'){
    // 自检前先把盘面重新摆回玩家存档那一张（否则量的是上一关残留的盘面）
    // 并且**把收尾 2 开的那一格堵回去**：这几行报的是"原盘面"上的洞口/借墙读数。
    loadLevel(78, LV78);
    unWiden();
    window.__out.push('   自检 洞口候选点数 ' + pocketGates().length + '；' +
      pocketGates().slice(0, 6).map(function(g){
        return '(瞄行' + g.brick.row + '列' + g.brick.col + ' 的门口 ' + g.x.toFixed(0) + ',' + g.y.toFixed(0) + ')';
      }).join(' '));
    [[915, 400], [855, 300], [915, 150], [480, 500], [915, 480]].forEach(function(p){
      var q = bankAim({ x: p[0], y: p[1], r: 7, vx: 0, vy: -400 });
      var sp = escortSpot({ x: p[0], y: p[1], r: 7, vx: 0, vy: -400 });
      window.__out.push('   自检 球(' + p[0] + ',' + p[1] + ') 借墙-> ' +
        (q ? '墙点(' + q.x.toFixed(0) + ',' + q.y.toFixed(0) + ') 瞄行' + q.brick.row + '列' + q.brick.col
           : '没有') +
        '   escortSpot-> ' + (sp ? (sp.gate ? '门口' : (sp.bank ? '借墙' : '砖心')) +
          '(' + sp.x.toFixed(0) + ',' + sp.y.toFixed(0) + ') 瞄行' + sp.brick.row + '列' + sp.brick.col : '没有'));
    });
  }
  window.__out.push('── ' + label + ' · ' + (frames/60) + ' 秒 ──');
  window.__out.push('   过关 ' + s.clears + ' 次   掉命 ' + s.deaths + ' 次');
  window.__out.push('   ★ 行3列8 那块砖：' + (s.first38 < 0 ? '**从头到尾没掉过血**' :
                    '第一次掉血在第 ' + s.first38 + ' 帧 (' + (s.first38/60).toFixed(1) + ' 秒)，最低血量 ' + s.hp38));
  window.__out.push('   ★ 行2列8 那块砖：' + (s.first28 < 0 ? '**从头到尾没掉过血**' :
                    '第一次掉血在第 ' + s.first28 + ' 帧 (' + (s.first28/60).toFixed(1) + ' 秒)，最低血量 ' + s.hp28));
  window.__out.push('   球在右竖井里的帧 ' + pc(s.inShaft, s.frames) +
                    '   其中纵向正好在"行3那条带"里（进洞的唯一窗口）' + pc(s.atDoor, s.frames) +
                    '（' + s.atDoor + ' 帧）');
  window.__out.push('   球真的进了隧道那两格的帧 ' + pc(s.inTunnel, s.frames) + '（' + s.inTunnel + ' 帧）');
  window.__out.push('   护送的瞄准线被死砖挡着 ' + pc(s.blocked, s.aimFrames) + '（' + s.blocked + '/' + s.aimFrames + '）');
  window.__out.push('   护送这一帧瞄的是：砖心 ' + pc(s.spotBrick, s.spotSamples) +
                    '   洞口那一面 ' + pc(s.spotGate, s.spotSamples) +
                    '   借一次墙 ' + pc(s.spotBank, s.spotSamples) +
                    '   门口格中心 ' + pc(s.spotDoor, s.spotSamples) +
                    '   什么都不瞄 ' + pc(s.spotNull, s.spotSamples));
  if (s.bankDump.length){
    s.bankDump.forEach(function(x){ window.__out.push('     · 借墙样本 ' + x); });
  }
  if (s.bankAt.length){
    var g = {};
    s.bankAt.forEach(function(p){ var k = p[0] + ',' + p[1]; g[k] = (g[k] || 0) + 1; });
    var top = Object.keys(g).sort(function(x, y){ return g[y] - g[x]; }).slice(0, 5);
    window.__out.push('   借墙时球在哪个 120px 网格里（次数最多的 5 个）：' +
      top.map(function(k){ return '(' + (k.split(',')[0]*120) + ',' + (k.split(',')[1]*120) + ')x' + g[k]; }).join('  '));
  }
  window.__out.push('   保险 4「转个圈」触发 ' + (window.__NB_DEBUG.cycleBreaks || 0) + ' 次');
  return s;
}

run78('① 旧版：只瞄"最近的活砖"（玩家发来的原盘面）', 36000, 'old', true);
window.__NB_DEBUG.cycleBreaks = 0;
run78('② 现在的护送（两跳绕路 + 转个圈），还是玩家发来的原盘面', 36000, 'full', true);
window.__NB_DEBUG.cycleBreaks = 0;
run78('③ 生成期收尾 2 把那条缝放宽之后（同一张盘面）', 36000, 'full', false);
if (window.__shotOnly !== true){}
`;

SCENES['97-audit'] = `
window.__out = [];
window.__NB_DEBUG = {};

function deg(x){ return x * 180 / Math.PI; }
function nrm(a){ while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; }
function hpSum(){ var n=0; for (var i=0;i<bricks.length;i++) if (!isFurniture(bricks[i])) n += Math.max(0, bricks[i].hp); return n; }

// 撞实心砖**不会**扣血（damage 对 furniture 直接 return），所以它骗过了 brickHit 判定，
// 被算成"干净帧"，于是那一下反射（可能 90°+）被误记成"引导掰的"。
// 这里显式排除：本帧开始时球是否贴着某块实心砖（传的是帧初快照的 x/y，球半径固定 7）。
function nearSolid(snap){
  if (!snap) return false;
  var r = 7 + Math.hypot(snap.vx, snap.vy) / 60 + 2;   // 半径 + 一帧位移 + 余量
  for (var i = 0; i < bricks.length; i++){
    var br = bricks[i];
    if (!br.solid || br.dead) continue;
    if (snap.x + r > br.x && snap.x - r < br.x + br.w &&
        snap.y + r > br.y && snap.y - r < br.y + br.h) return true;
  }
  return false;
}

function audit(label, level, frames, noAssist, fixedGrid){
  // 固定种子：不然同一块盘面两次跑出来的百分比不一样，"改前/改后"就没法比
  if (window.__seedReset) window.__seedReset(0x2545F491 + level * 104729 + (noAssist ? 7 : 0));
  newGame(); G.level = level; loadLevel(level, fixedGrid); launch();
  // 直接用游戏自己的音效调用当"碰撞事件计数器"，比靠位置猜可靠得多
  var W_=0, P_=0;
  var _wall = Sound.wall, _paddle = Sound.paddle;
  Sound.wall = function(){ W_++; return _wall.apply(Sound, arguments); };
  Sound.paddle = function(){ P_++; return _paddle.apply(Sound, arguments); };
  var s = { frames:0, stuck5:0, stuck8:0, steerF:0, steerDeg:0, steerMax:0,
            bounces:0, bounceAssist:0, devSum:0, devMax:0, dev15:0,
            devAssistSum:0, devAssistN:0, devCleanSum:0, devCleanN:0, devCleanMax:0,
            specSum:0, magFrames:0, magTurns:0, gateFrames:0, endFrames:0,
            nudges:0, reloads:0, clears:0, brickHitF:0, totalDeg:0, sumStuck:0, maxStuck:0, deaths:0, portals:0,
            // 规则 1 的角度代价测量（0°=贴水平，90°=贴竖直）
            hist:[0,0,0,0,0,0], danger:0, dangerGate:0, dangerEnd:0, dangerTraversals:0, trav:0, wasDanger:false,
            overCap:0,
            // 新版（反弹瞬间的一次性拨正）的测量
            freeTurns:0, freeDeg:0, vNudges:0, nudgeN:0, nudgeDeg:0, nudgeMax:0,
            nudgeFlat:0, nudgeUpright:0, nudgeEnd:0, nudgeEndDeg:0, nudgeSpeedBad:0,
            escortTurns:0, markerFrames:0, markerEscort:0, markerNudge:0, markerCycle:0, markerOther:0 };
  // 包住被测函数：像 Sound.wall 一样，用"游戏自己的记账"数事件，
  // 再用独立算出来的"这一帧有没有碰撞 / 是不是自由飞行"去校验它的行为。
  var log = [];
  var __realNudge = reflectNudge;
  reflectNudge = function(b, ex){
    var a0 = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
    var fh = (b.vx || b.vy) ? Math.abs(Math.atan2(Math.abs(b.vy), Math.abs(b.vx))) * 180 / Math.PI : -1;
    var gate = assistGate(), stuck = G.stuckTimer;
    var r = __realNudge(b, ex);
    if (r) log.push({ fh: fh, sp: sp, spAfter: Math.hypot(b.vx, b.vy), gate: gate, stuck: stuck,
                      turn: Math.abs(deg(nrm(Math.atan2(b.vy, b.vx) - a0))) });
    return r;
  };
  var vFired = false, eFired = false;
  var __realVNudge = verticalNudge;
  verticalNudge = function(b, dt){
    var r = __realVNudge(b, dt);
    if (r){ s.vNudges++; vFired = true; }
    return r;
  };
  // 残局护送也是**每帧**的（这是刻意的：见 index.html 里 escortToBricks 的注释）。
  // 它必须在"自由飞行帧"的判据里被排除，否则 freeTurns 会把它误算成违规。
  var escortF = 0;
  var __realEscort = escortToBricks;
  escortToBricks = function(b){
    var r = __realEscort(b);
    if (r){ eFired = true; escortF++; s.escortTurns++; fEscort = 0; }
    return r;
  };
  // 琥珀标记到底是被谁点亮的？残局护送是**每帧**过程，会把它一直续上；
  // 角度拨正只占一帧。这两个来源必须分开数，否则"标记可见 1.6%"会被
  // 误读成"角度规则又常亮了"。
  var fEscort = 999, fNudge = 999, fCycle = 999;
  var __realNudge2 = reflectNudge;
  reflectNudge = function(b, ex){
    var r = __realNudge2(b, ex);
    if (r) fNudge = 0;
    return r;
  };
  // 第三个琥珀来源：保险 4 的"转个圈"（一次事件，但比拨正亮）
  var __realCycle = cycleBreak;
  cycleBreak = function(b){
    var r = __realCycle(b);
    if (r) fCycle = 0;
    return r;
  };
  var prevHp = hpSum(), prevW = 0, prevP = 0;
  for (var i = 0; i < frames; i++){
    // 关卡打完/掉命后自动继续，保证 300 秒都是真在打
    if (G.state === S.LEVEL){ s.clears++; loadLevel(level, fixedGrid); launch(); prevHp = hpSum(); continue; }
    if (G.state === S.READY){ launch(); }
    var b = balls[0];
    if (b) pointerTarget = b.x;
    if (noAssist) G.stuckTimer = 0;                 // A/B：把停滞计时按住，assist 永不触发
    vFired = false; eFired = false;
    var before = b ? { x:b.x, y:b.y, ang: Math.atan2(b.vy, b.vx), vx:b.vx, vy:b.vy } : null;
    var stuck = G.stuckTimer;
    var gate = assistGate();                        // 引导是否被允许（残局门控）
    // 规则 1 要在"离水平/竖直不到 30°"时介入 —— 先量一量这个区间到底占多少帧
    var danger = false, fh = 0;
    if (before && (before.vx || before.vy)){
      fh = Math.abs(Math.atan2(Math.abs(before.vy), Math.abs(before.vx))) * 180 / Math.PI;
      danger = fh < 30;                              // 收窄后：只有贴水平才算"角度不对"
      s.hist[Math.min(5, Math.floor(fh / 15))]++;
      if (danger) s.danger++;
      if (danger && gate) s.dangerGate++;
      if (danger && breakableLeft() <= ASSIST_MAX_BRICKS) s.dangerEnd++;
      // "危险角度的连续段"算一次，而不是每帧算一次（球一趟飞行角度是稳定的）
      if (danger && !s.wasDanger) s.dangerTraversals++;
      if (danger !== s.wasDanger) s.trav++;
      s.wasDanger = danger;
    }
    update(1/60);
    var after = balls[0];
    s.frames++;
    s.sumStuck += stuck;
    if (stuck > s.maxStuck) s.maxStuck = stuck;
    if (stuck > 5) s.stuck5++;
    if (stuck > 8) s.stuck8++;
    if (gate) s.gateFrames++;
    if (breakableLeft() <= ASSIST_MAX_BRICKS) s.endFrames++;
    var hpNow = hpSum(), brickHit = hpNow < prevHp; prevHp = hpNow;
    var wallHit = W_ > prevW, bnc = P_ > prevP; prevW = W_; prevP = P_;
    if (!before || !after || after !== b){ if (!after) s.deaths++; continue; }
    if (brickHit) s.brickHitF++;
    if (after.magnet > 0) s.magFrames++;
    // 传送门：一帧最多走 speed*dt ≈ 17px，超过 40px 只可能是被挪走的
    var jumped = Math.hypot(after.x - before.x, after.y - before.y) > 40;
    if (jumped) s.portals++;
    var d = Math.abs(deg(nrm(Math.atan2(after.vy, after.vx) - before.ang)));
    s.totalDeg += d;
    if (bnc){
      s.bounces++;
      var assistOn = gate && stuck > 8;
      if (assistOn) s.bounceAssist++;
      // 游戏自己的确定性规则：rel 决定出射角（不含 assist / english）
      var rel = Math.max(-1, Math.min(1, (after.x - (paddle.x + paddle.w/2)) / (paddle.w/2)));
      var MINA = 0.2095;
      var ideal = rel * (Math.PI/3);
      if (Math.abs(ideal) < MINA) ideal = (rel < 0 ? -MINA : MINA);
      var idealOut = Math.atan2(-Math.cos(ideal), Math.sin(ideal));
      var actualOut = Math.atan2(after.vy, after.vx);
      var dev = Math.abs(deg(nrm(actualOut - idealOut)));
      s.devSum += dev; if (dev > s.devMax) s.devMax = dev; if (dev > 15) s.dev15++;
      if (assistOn){ s.devAssistSum += dev; s.devAssistN++; }
      else { s.devCleanSum += dev; s.devCleanN++; if (dev > s.devCleanMax) s.devCleanMax = dev; }
      // 纯镜面反射（水平面）应有的出射角，用来看"物理反射定律"被违反了多少
      s.specSum += Math.abs(deg(nrm(actualOut - Math.atan2(-before.vy, before.vx))));
    }
    var clean = !brickHit && !bnc && !wallHit && !jumped && !nearSolid(before);
    var magSteer = after.magnet > 0 && after.vy < 0;
    // ★ 新版最核心的断言：**两帧之间绝不介入**（残局的"停滞护送"例外，它是刻意每帧的）。
    //   自由飞行（没碰撞、没磁力、没竖直强纠偏、没在残局护送中）的帧里，
    //   方向必须一点都没变。旧版每帧都朝目标转，这里会是一大片非零。
    if (clean && !magSteer && !vFired && !eFired && d > 0.02){ s.freeTurns++; s.freeDeg += d; }

    // 琥珀标记的"归因"：0.2 秒残留 = 12 帧，所以看最近 12 帧里谁点过火
    // （护送是每帧过程，会一直把标记续上；角度拨正只占一帧）
    fEscort++; fNudge++; fCycle++;
    var mb = balls[0];
    if (mb && mb.assistFx > 0){
      s.markerFrames++;
      if (fEscort < 12) s.markerEscort++;
      else if (fCycle < 12) s.markerCycle++;
      else if (fNudge < 12) s.markerNudge++;
      else s.markerOther++;
    }    if (magSteer && d > 0.02) s.magTurns++;
  }
  // 拨正事件的统计（出射角分布、速率是否守恒、残局占比）
  for (var q = 0; q < log.length; q++){
    var e = log[q];
    s.nudgeN++;
    if (e.fh >= 0 && e.fh < 30) s.nudgeFlat++;
    if (e.fh > 60) s.nudgeUpright++;
    if (e.gate){ s.nudgeEnd++; s.nudgeEndDeg += e.turn; }
    s.nudgeDeg += e.turn;
    if (e.turn > s.nudgeMax) s.nudgeMax = e.turn;
    if (Math.abs(e.sp - e.spAfter) > 1e-6) s.nudgeSpeedBad++;
  }
  s.nudges = window.__NB_DEBUG.nudges || 0;
  s.reloads = window.__NB_DEBUG.reloads || 0;
  var secs = s.frames/60, pc = function(x){ return (x*100).toFixed(1)+'%'; }, av = function(a,n){ return (a/Math.max(1,n)).toFixed(1); };
  var L = window.__out;
  L.push('=== ' + label + (noAssist ? '  [assist 已禁用]' : '') + '  (' + secs.toFixed(0) + ' 秒) ===');
  L.push('  关卡打穿 ' + s.clears + ' 次  掉命 ' + s.deaths + ' 次  stuckTimer 均值 ' + (s.sumStuck/s.frames).toFixed(1) + 's 峰值 ' + s.maxStuck.toFixed(1) + 's');
  L.push('  停滞 >5s 的帧 ' + pc(s.stuck5/s.frames) + '   >8s 的帧 ' + pc(s.stuck8/s.frames) + '   —— 但这是"计时器读数"，不等于引导真的介入');
  L.push('  ★ 引导真正被允许（残局 ≤' + ASSIST_MAX_BRICKS + ' 砖）的帧: ' + pc(s.gateFrames/s.frames) + '   （场上确实处于残局的帧 ' + pc(s.endFrames/s.frames) + '）');
  L.push('  ★ 自由飞行（无碰撞/无磁力/无竖直强纠偏/**无残局护送**）却被改动方向的帧: ' + s.freeTurns +
         ' (' + pc(s.freeTurns/s.frames) + ')' + (s.freeTurns ? '  累计 ' + s.freeDeg.toFixed(0) + '°' : '') +
         '   <- 新版要求**必须是 0**："拨正了就不要一直管"');
  L.push('     对照：残局护送（刻意每帧）另计 ' + s.escortTurns + ' 帧 (' + pc(s.escortTurns/s.frames) + ')');
  if (s.markerFrames){
    L.push('     ★ 琥珀标记归因：残局护送 ' + pc(s.markerEscort/s.markerFrames) +
           '   角度拨正 ' + pc(s.markerNudge/s.markerFrames) +
           '   转个圈 ' + pc(s.markerCycle/s.markerFrames) +
           '   其余 ' + pc(s.markerOther/s.markerFrames) +
           '   （共可见 ' + s.markerFrames + ' 帧）');
    L.push('       -> "拨正了就不要一直管"管得住的是角度规则；残局护送是**有意**持续的');
  }
  L.push('  ★ 反弹瞬间的拨正: ' + s.nudgeN + ' 次  平均 ' + av(s.nudgeDeg, s.nudgeN) + '°  单次最大 ' + s.nudgeMax.toFixed(1) + '°' +
         '   （速率守恒: ' + (s.nudgeSpeedBad ? '✗ ' + s.nudgeSpeedBad + ' 次不守恒' : '✓ 全部守恒') + '）');
  L.push('     拨之前"贴水平(<30°)"的占 ' + pc(s.nudgeFlat/Math.max(1,s.nudgeN)) +
         '   拨之前"贴竖直(>60°)"的 ' + s.nudgeUpright + ' 次（只该来自残局计时器兜底）');
  L.push('     其中残局（门控开）' + s.nudgeEnd + ' 次  平均 ' + av(s.nudgeEndDeg, s.nudgeEnd) + '°（规则 2 的加强）');
  L.push('  挡板反弹 ' + s.bounces + ' 次，其中引导介入的 ' + s.bounceAssist + ' 次 (' + (s.bounces?pc(s.bounceAssist/s.bounces):'-') + ')');
  L.push('  出射角偏离"游戏自己的 rel 规则": 平均 ' + av(s.devSum,s.bounces) + '°  最大 ' + s.devMax.toFixed(1) + '°  超过15°的 ' + s.dev15 + ' 次 (' + (s.bounces?pc(s.dev15/s.bounces):'-') + ')');
  L.push('      assist 关闭的反弹: 平均 ' + av(s.devCleanSum,s.devCleanN) + '° 最大 ' + s.devCleanMax.toFixed(1) + '° (n=' + s.devCleanN + ')  <- english + 夹角夹取');
  L.push('      assist 开启的反弹: 平均 ' + av(s.devAssistSum,s.devAssistN) + '° (n=' + s.devAssistN + ')');
  L.push('  偏离"镜面反射定律": 平均 ' + av(s.specSum,s.bounces) + '°  <- rel 模型本身就不遵守，属设计');
  L.push('  磁力: 球带磁力的帧 ' + pc(s.magFrames/s.frames) + '  上行修正帧 ' + s.magTurns + '  （第 17 关起场上有磁铁砖，打掉就自然获得磁力）');
  L.push('  竖直强纠偏 ' + s.vNudges + ' 次（保险 3，不是规则 1：不看目标、也不管贴不贴水平）');
  // 规则 1 的代价：球的角度分布（0°=贴水平，90°=贴竖直）
  var hb = ['0-15° 贴水平','15-30°','30-45°','45-60°','60-75°','75-90° 贴竖直'];
  L.push('  ── 球的角度分布（离水平多少度）──');
  for (var k = 0; k < 6; k++)
    L.push('     ' + hb[k].padEnd(12) + ' ' + pc(s.hist[k]/s.frames));
  L.push('  ★ 规则1 会介入的角度（收窄后只有 <30° 贴水平）: ' + pc(s.danger/s.frames) + ' 的帧   ' +
         s.dangerTraversals + ' 个连续段（共 ' + s.trav + ' 段飞行）');
  L.push('     （旧版还含 >60° 贴竖直 —— 收窄前后的差别就是这里）');
  L.push('     其中残局（引导真被允许）的帧: ' + pc(s.dangerEnd/s.frames));
}

// 第 20 关是**随机**关卡，每次 loadLevel 都是新盘面 —— 跨运行比它毫无意义。
// 所以 A/B 必须钉死在**同一张盘面**上：这里手工做一张 20 关风格的固定网格
// （带实心砖墙、转弯砖、裂纹砖、传送门、炸药砖、磁铁砖），两组跑同一张。
var FIXED20 = (function(){
  var P = [], W = -1;
  var C = 10, R = 7;
  for (var r = 0; r < R; r++){
    var line = [];
    for (var c = 0; c < C; c++){
      // 固定伪随机：只依赖 (r,c)，不依赖 Math.random，所以两组看到的是同一张
      var h = (r * 31 + c * 17) % 100;
      if (h < 18) line.push(W);
      else if (h < 26) line.push(9);
      else if (h < 34) line.push(6);                       // 裂纹
      else if (h < 42) line.push(10 + (r + c) % 4);        // 转弯
      else line.push(1 + ((r * 7 + c * 5) % 5));           // 1~5 血
    }
    P.push(line);
  }
  P[0][0] = 0; P[0][9] = 0;
  P[R-1][3] = 15; P[R-1][6] = 16;                          // 炸药砖 / 磁铁砖
  P[1][2] = 20; P[3][7] = 21;                              // 传送门成对
  return P;
})();

audit('第 1 关 菱形（设计关卡，确定性）', 1, 18000, false);
audit('固定盘面（20 关风格）· 引导开', 20, 18000, false, FIXED20);
audit('固定盘面（20 关风格）· 引导关', 20, 18000, true, FIXED20);
`;

// 11e3. 为什么屏幕上"一直有引导线"？量一下标记的可见占空比。
SCENES['90-line'] = `
window.__out = [];
var L = window.__out;
var __realFlat = flatAngle;              // 只抓一次，避免二次覆写把自己抓进去

// assistFx 每次拨正被设成 0.2s（= 12 帧），然后每帧减 dt。
var MARK_FRAMES = 12;

function run(level, frames, seed, mode){
  if (window.__seedReset) window.__seedReset(seed);
  // mode: 'off' = 关掉贴水平触发（只留残局计时器兜底） / 'on' = 现在的反弹瞬间拨正
  flatAngle = (mode === 'off') ? function(){ return false; } : __realFlat;
  newGame(); G.level = level; loadLevel(level); launch();
  var s = { frames:0, amber:0, green:0, magFrames:0, clears:0, deaths:0, flat:0,
            flatAimed:0, flatIdle:0,
            events:0, segs:0, longest:0, cur:0, gaps:[], turns:[], freeTurns:0,
            afterFlat:0, afterMin:999,
            markerFrames:0, markerEscort:0, markerNudge:0, markerCycle:0, markerOther:0, escortTurns:0 };
  var wasOn = false, lastEv = -1;
  // 琥珀标记到底是谁点亮的？残局护送是**每帧**过程，会把 0.2 秒的残留一直续上；
  // 角度拨正只占一帧。两者必须分开归因，否则"标记可见 1.6%"会被误读成
  // "角度规则又常亮了"。0.2s = 12 帧，所以看最近 12 帧里谁点过火。
  var fEscort = 999, fNudge = 999, fCycle = 999;
  var __esc = escortToBricks;
  escortToBricks = function(b){
    var r = __esc(b);
    if (r){ s.escortTurns++; fEscort = 0; }
    return r;
  };
  // 第三个琥珀来源：保险 4 的"转个圈"
  var __c = cycleBreak;
  cycleBreak = function(b){
    var r = __c(b);
    if (r) fCycle = 0;
    return r;
  };
  // 包住被测函数，数"拨正事件"。事件是新的计量单位（旧版数的是"被掰的帧"）。
  var __n = reflectNudge;
  reflectNudge = function(b, ex){
    var a0 = Math.atan2(b.vy, b.vx);
    var r = __n(b, ex);
    if (r){
      fNudge = 0;
      s.events++;
      s.turns.push(Math.abs(Math.atan2(b.vy, b.vx) - a0) * 180 / Math.PI);
      // ★ 自检：拨完之后落到的角度是多少？如果拨完又落回"贴水平"，
      //   那这条规则就是自相矛盾的（下一帧/下一次反射还得再拨一次）。
      var fh2 = Math.abs(Math.atan2(Math.abs(b.vy), Math.abs(b.vx))) * 180 / Math.PI;
      s.afterFlat += (fh2 < 30) ? 1 : 0;
      s.afterMin = Math.min(s.afterMin, fh2);
      if (lastEv >= 0) s.gaps.push(i - lastEv);
      lastEv = i;
    }
    return r;
  };

  // 独立算"球还差多少才对准最近的活砖"（不调游戏内部逻辑）
  function aimErr(b){
    var best = null, bd = Infinity;
    for (var k = 0; k < bricks.length; k++){
      var br = bricks[k];
      if (br.dead || br.solid || br.portal) continue;
      var dx = br.x + br.w/2 - b.x, dy = br.y + br.h/2 - b.y;
      var d = dx*dx + dy*dy;
      if (d < bd){ bd = d; best = [dx, dy]; }
    }
    if (!best) return null;
    var want = Math.atan2(best[1], best[0]), cur = Math.atan2(b.vy, b.vx);
    var e = want - cur;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    return Math.abs(e) * 180 / Math.PI;
  }
  // 独立判据（收窄后只管贴水平；A 组会把 flatAngle 覆写成常数）
  function isFlat(vx, vy){
    if (!vx && !vy) return false;
    return Math.abs(Math.atan2(Math.abs(vy), Math.abs(vx))) < Math.PI/6;
  }
  // 贴水平有两种，必须分开：
  //   · 病态的"空转"：沿这条航向往前走，谁都撞不到（在两墙之间横着弹）——
  //     这正是规则 1 要消灭的；
  //   · 健康的"瞄着砖飞"：射线前面就有一块可破坏砖 —— 拨正后落到这种贴水平
  //     不算失败，它下一步就会打中。
  // 判据独立实现：沿速度方向步进，看有没有撞上活砖。
  function flatRayHitsBrick(b){
    var sp = Math.hypot(b.vx, b.vy); if (sp < 1) return false;
    var ux = b.vx / sp, uy = b.vy / sp;
    for (var t = 4; t < 2000; t += 4){
      var px = b.x + ux * t, py = b.y + uy * t;
      if (px < 24 || px > W - 24 || py < 24 || py > H) return false;
      for (var k = 0; k < bricks.length; k++){
        var br = bricks[k];
        if (br.dead || isFurniture(br)) continue;
        if (px > br.x && px < br.x + br.w && py > br.y && py < br.y + br.h) return true;
      }
    }
    return false;
  }

  for (var i = 0; i < frames; i++){
    if (G.state === S.LEVEL){ s.clears++; loadLevel(level); launch(); continue; }
    if (G.state === S.READY) launch();
    var b = balls[0];
    if (b) pointerTarget = b.x;
    var a0 = b ? Math.atan2(b.vy, b.vx) : 0;
    var e0 = b ? aimErr(b) : null;
    var d0 = b ? isFlat(b.vx, b.vy) : false;
    var d0hit = d0 ? flatRayHitsBrick(b) : false;
    update(1/60);
    var a = balls[0];
    if (a !== b){ if (!a) s.deaths++; continue; }
    s.frames++;
    if (d0){
      s.flat++;
      if (d0hit) s.flatAimed++; else s.flatIdle++;
    }
    // "两帧之间绝不介入"：自由飞行帧里方向不该变（拨正事件已经由 wrapper 数掉了）
    var steered = Math.abs(Math.atan2(a.vy, a.vx) - a0) > 1e-9;
    if (steered) s.freeTurns++;          // 含碰撞帧，仅作对照
    var on = a.assistFx > 0;
    if (on){
      s.amber++;
      s.markerFrames++;
      if (fEscort < MARK_FRAMES) s.markerEscort++;
      else if (fCycle < MARK_FRAMES) s.markerCycle++;
      else if (fNudge < MARK_FRAMES) s.markerNudge++;
      else s.markerOther++;
      if (!wasOn){ s.segs++; s.cur = 0; }
      s.cur++; if (s.cur > s.longest) s.longest = s.cur;
    }
    wasOn = on;
    fEscort++; fNudge++; fCycle++;
    if (a.magnet > 0){ s.magFrames++; if (a.vy < 0 && a.magTarget) s.green++; }
  }
  reflectNudge = __n;
  escortToBricks = __esc;
  cycleBreak = __c;
  return s;
}

function pct(x, n){ return (x / n * 100).toFixed(1) + '%'; }
function med(arr){
  if (!arr.length) return 0;
  var a = arr.slice().sort(function(p,q){ return p-q; });
  return a[Math.floor(a.length/2)];
}

function report(label, s){
  var gaps = s.gaps;
  var shortGaps = gaps.filter(function(g){ return g < MARK_FRAMES; }).length;
  var avgTurn = s.turns.length
    ? s.turns.reduce(function(p,q){ return p+q; }, 0) / s.turns.length : 0;
  L.push('  ' + label);
  L.push('     过关 ' + s.clears + ' 次   掉命 ' + s.deaths + ' 次');
  L.push('     拨正事件 ' + s.events + ' 次   平均一次拨 ' + avgTurn.toFixed(1) + '°   ' +
         '贴水平帧 ' + pct(s.flat, s.frames));
  L.push('       其中"射线前面现在就有一块活砖"的 ' + pct(s.flatAimed, Math.max(1, s.flat)) +
         '   前面没有砖的 ' + pct(s.flatIdle, Math.max(1, s.flat)));
  L.push('       （后者包含"刚把目标砖打掉、正沿着同一航向惯性飞"的情况，');
  L.push('         所以它**不是**纯粹的"空转指标"，别只看这一个数）');
  L.push('     琥珀标记可见 ' + s.amber + ' 帧 (' + pct(s.amber, s.frames) + ')   ' +
         '可见段 ' + s.segs + ' 段   最长 ' + s.longest + ' 帧 (' +
         (s.longest/60).toFixed(1) + ' 秒)');
  L.push('       ★ 标记归因：残局护送点亮 ' + pct(s.markerEscort, Math.max(1, s.markerFrames)) +
         '   角度拨正点亮 ' + pct(s.markerNudge, Math.max(1, s.markerFrames)) +
         '   转个圈点亮 ' + pct(s.markerCycle, Math.max(1, s.markerFrames)) +
         '   其余 ' + pct(s.markerOther, Math.max(1, s.markerFrames)));
  L.push('         （护送是**每帧**的过程，会一直把标记续上；角度拨正只占一帧。');
  L.push('           护送介入 ' + s.escortTurns + ' 帧 = 标记的常亮来源）');
  L.push('     相邻拨正的间隔：中位 ' + med(gaps) + ' 帧   <' + MARK_FRAMES + ' 帧的占 ' +
         pct(shortGaps, gaps.length));
  L.push('     拨完落到的角度：最陡 ' + (s.afterMin < 999 ? s.afterMin.toFixed(1) + '°' : '-') +
         '   又落回贴水平(<30°) 的 ' + s.afterFlat + ' / ' + s.events + ' 次');
  L.push('       （贴水平触发有"拨完至少离水平 35°"的兜底；落回贴水平的只可能来自');
  L.push('         残局计时器触发 —— 那时故意瞄同一行的砖才是对的）');
}

L.push('=== 引导线为什么"一直在"？第 1 关 300 秒（同种子配对）===');
L.push('（单次拨正把 assistFx 设成 0.2s = 12 帧，之后每帧减 dt 淡出）');
L.push('');
report('A：关掉贴水平触发（只留残局计时器兜底）', run(1, 18000, 0x2545F491, 'off'));
L.push('');
report('B：现在的做法 = 反弹瞬间的一次性拨正（只管贴水平）', run(1, 18000, 0x2545F491, 'on'));
L.push('');
L.push('── 上一版（每帧朝目标转一点点）的同种子读数，留作对照 ──');
L.push('     拨正/介入 1915 帧 (10.6%)   琥珀标记可见 5515 帧 (30.6%)   最长 4.7 秒');
L.push('     相邻介入间隔中位 1 帧   <12 帧的占 75.8%');
L.push('');
L.push('── 为什么现在不会常亮了 ──');
L.push('  旧版是**过程**：只要航向落在触发区间里就每帧都转，0.2 秒的残留被不停续上。');
L.push('  新版是**事件**：只在墙/砖反射的那一帧判断一次，不对才拨、拨完就撒手 ——');
L.push('  两帧之间球走的是纯净的反射，所以标记亮一下就必须灭，不可能被续上。');
L.push('  触发区间也收窄成"只管贴水平"（玩家："竖直的没问题"），事件数进一步下降。');
L.push('');
L.push('=== 绿色磁力引导线：buff 期间的常驻指示（另一条"一直在"的线）===');
(function(){
  if (window.__seedReset) window.__seedReset(0x2545F491);
  newGame(); G.level = 0; loadLevel(0); launch();
  G.state = S.PLAY;
  balls[0].magnet = MAGNET_LIFE;
  var fr = 0, green = 0, segs = 0, longest = 0, cur = 0, was = false;
  for (var i = 0; i < 1500; i++){
    var bb = balls[0]; if (!bb) break;
    pointerTarget = bb.x;
    update(1/60);
    var a = balls[0]; if (!a) break;
    fr++;
    var on = a.magnet > 0 && a.vy < 0 && a.magTarget;
    if (on){ green++; if (!was){ segs++; cur = 0; } cur++; if (cur > longest) longest = cur; }
    was = on;
    if (a.magnet <= 0) break;
  }
  L.push('  10 秒磁力内：总帧 ' + fr + '，绿线可见 ' + green + ' 帧 (' + pct(green, fr) + ')');
  L.push('  可见段 ' + segs + ' 段，最长 ' + longest + ' 帧 (' + (longest/60).toFixed(1) + ' 秒连续)');
  L.push('  => 绿线是"buff 生效 + 正在上行 + 有目标"就画，本来就设计成 buff 期间常挂。');
})();
flatAngle = __realFlat;
`;

// 11e2. A/B：把"贴水平拨正"改成一件事，到底值不值？同一关卡各跑 5 次取分布。
//       因为残局挡板引导带 Math.random()、转弯/裂纹砖也带，跑一次说明不了问题。
SCENES['91-ab'] = `
window.__out = [];
var L = window.__out;
var __realFlat = flatAngle;
function deg(x){ return x * 180 / Math.PI; }
function hpSum(){ var n=0; for (var i=0;i<bricks.length;i++) if (!isFurniture(bricks[i])) n += Math.max(0, bricks[i].hp); return n; }

// 贴水平的判据**在这里独立实现**，不调 flatAngle ——
// A 组会把 flatAngle 覆写成常数 false，如果测量也走它，
// "贴水平帧占比"会永远读成 0.0%，那是实验把自己的尺子改坏了。
function isFlat(vx, vy){
  if (!vx && !vy) return false;
  return Math.abs(Math.atan2(Math.abs(vy), Math.abs(vx))) < Math.PI/6;
}

var nudgeN = 0;
var __rawNudge = reflectNudge;
reflectNudge = function(b, ex){
  var r = __rawNudge(b, ex);
  if (r) nudgeN++;
  return r;
};

function run(level, frames, seed){
  if (window.__seedReset) window.__seedReset(seed);   // 每个回合用指定种子（两组配对同种子）
  newGame(); G.level = level; loadLevel(level); launch();
  var s = { clears:0, deaths:0, maxStuck:0, nudges:0, flat:0, frames:0 };
  nudgeN = 0;
  for (var i = 0; i < frames; i++){
    if (G.state === S.LEVEL){ s.clears++; loadLevel(level); launch(); continue; }
    if (G.state === S.READY) launch();
    var b = balls[0];
    if (b) pointerTarget = b.x;
    var wasFlat = b ? isFlat(b.vx, b.vy) : false;
    update(1/60);
    var a = balls[0];
    if (a !== b){ if (!a) s.deaths++; continue; }
    s.frames++;
    if (wasFlat) s.flat++;
    if (G.stuckTimer > s.maxStuck) s.maxStuck = G.stuckTimer;
  }
  s.nudges = nudgeN;
  return s;
}

function summarize(name, reps, level){
  var clears = [], deaths = [], stuck = [], nudgeRate = [], flat = [];
  for (var k = 0; k < reps; k++){
    // 第 k 个回合在两档里用**同一个种子** -> 配对比较；
    // 不同 k 用不同种子 -> 回合之间仍然是独立样本。
    var r = run(level, 18000, (0x2545F491 + k * 7919) >>> 0);
    clears.push(r.clears); deaths.push(r.deaths);
    stuck.push(r.maxStuck);
    nudgeRate.push(r.nudges / r.frames * 1000);        // 每千帧的拨正次数
    flat.push(r.flat / r.frames * 100);
  }
  var mean = function(a){ return a.reduce(function(x,y){return x+y;},0) / a.length; };
  L.push('  ' + name);
  L.push('     过关次数  ' + clears.join(' / ') + '      平均 ' + mean(clears).toFixed(1));
  L.push('     掉命次数  ' + deaths.join(' / '));
  L.push('     stuckTimer 峰值  ' + stuck.map(function(x){return x.toFixed(1);}).join(' / ') +
         '      最高 ' + Math.max.apply(null, stuck).toFixed(1) + 's');
  L.push('     拨正事件密度（次/千帧）  ' + nudgeRate.map(function(x){return x.toFixed(1);}).join(' / '));
  L.push('     处于贴水平角度的帧  ' + flat.map(function(x){return x.toFixed(1)+'%';}).join(' / '));
  return { clears: mean(clears), deaths: mean(deaths), stuck: Math.max.apply(null, stuck),
           nudge: mean(nudgeRate), flat: mean(flat) };
}

L.push('=== 第 1 关（设计关卡，确定性布局）· 每档 5 个种子 × 300 秒，两组同种子配对 ===');
L.push('');
flatAngle = function(){ return false; };
L.push('── A：只保留"停滞计时器"触发（关掉贴水平拨正）──');
var A = summarize('贴水平触发 = 关闭', 5, 1);
L.push('');
flatAngle = __realFlat;
L.push('── B：贴水平拨正（现在的做法：反弹瞬间一次性拨正）──');
var B = summarize('贴水平触发 = 反弹瞬间', 5, 1);
L.push('');
L.push('── 对比 ──');
L.push('  平均过关      ' + A.clears.toFixed(1) + '  ->  ' + B.clears.toFixed(1));
L.push('  平均掉命      ' + A.deaths.toFixed(1) + '  ->  ' + B.deaths.toFixed(1));
L.push('  stuck 峰值    ' + A.stuck.toFixed(1) + 's ->  ' + B.stuck.toFixed(1) + 's');
L.push('  拨正事件密度  ' + A.nudge.toFixed(1) + ' ->  ' + B.nudge.toFixed(1) + ' 次/千帧');
L.push('  贴水平帧占比  ' + A.flat.toFixed(1) + '% ->  ' + B.flat.toFixed(1) + '%');
L.push('');
L.push('  注：上一版（每帧朝目标转）在同关卡读到的是**介入 6.4%/10.6% 的帧**；');
L.push('      新版一次拨正只占**一帧**，所以事件密度才是可直接比较的量。');
`;

// 11f. 诊断：玩家反馈的三件事 —— 磁力瞄死砖 / 缺绿色引导线 / 小角度没被掰。
SCENES['92-diag'] = `
window.__out = [];
var L = window.__out;
function deg(x){ return x * 180 / Math.PI; }

// 从球心到目标砖中心这条线段，有没有被死砖挡住？（诊断用，独立实现，不调游戏内部）
function losBlocked(sx, sy, tgt){
  if (!tgt) return null;
  var tx = tgt.x + tgt.w/2, ty = tgt.y + tgt.h/2;
  var n = Math.max(2, Math.ceil(Math.hypot(tx-sx, ty-sy) / 4));
  for (var i = 1; i < n; i++){
    var px = sx + (tx-sx)*i/n, py = sy + (ty-sy)*i/n;
    for (var k = 0; k < bricks.length; k++){
      var br = bricks[k];
      if (!br.solid || br.dead) continue;
      if (px > br.x && px < br.x+br.w && py > br.y && py < br.y+br.h) return true;
    }
  }
  return false;
}

L.push('=== 诊断 1：磁力瞄的目标有没有隔着死砖 ===');
L.push('  盘面：球正上方是死砖，死砖**后面**（更上面）放一块可破坏砖，');
L.push('        左边另放一块真正够得到的可破坏砖。最近的可破坏砖是"隔着死砖"那块。');
//        列0      列4
var G1 = [
  [0,0,0,0, 1,0,0,0,0,0],   // 行0：可破坏，但在死砖后面
  [0,0,0,0,-1,0,0,0,0,0],   // 行1：死砖
  [1,0,0,0, 0,0,0,0,0,0]    // 行2：左边一块，直线够得到
];
newGame(); G.level = 0; loadLevel(0, G1); G.state = S.PLAY;
var bt = makeBall(435, 520, 0, -400); balls = [bt]; bt.magnet = 10;
var near = nearestBrick(bt.x, bt.y);
var aim  = nearestAimBrick(bt.x, bt.y, false);
L.push('  nearestBrick      -> 中心(' + (near.x+near.w/2) + ',' + (near.y+near.h/2) + ')  被死砖挡住=' + losBlocked(bt.x, bt.y, near));
L.push('  nearestAimBrick   -> ' + (aim ? '中心(' + (aim.x+aim.w/2) + ',' + (aim.y+aim.h/2) + ')  被死砖挡住=' + losBlocked(bt.x, bt.y, aim) : 'null（找不到直线够得到的活砖）'));
L.push('  => 旧代码瞄的是' + (losBlocked(bt.x, bt.y, near) ? '**隔着死砖**那块' : '清楚那块') + '；新代码' + (aim ? '改瞄直线打得着的那块' : '选择不掰（宁可不动也不往死砖上送）'));

// 真正跑起来：数一数球撞死砖多少次、有没有打到可破坏砖。
// 挡板跟着球走（否则球会掉下去，测量就断了），并且每帧重新取 balls[0]。
function runMagnet(x0, vx, vy, frames){
  newGame(); G.level = 0; loadLevel(0, G1); G.state = S.PLAY;
  var b0 = makeBall(x0, 520, vx, vy); balls = [b0]; b0.magnet = 10;
  var hp0 = 0;
  for (var i = 0; i < bricks.length; i++) if (!isFurniture(bricks[i])) hp0 += Math.max(0, bricks[i].hp);
  var hard = 0;
  var _h = Sound.hard;
  Sound.hard = function(){ hard++; return _h.apply(Sound, arguments); };
  var steered = 0, blockedFrames = 0, losses = 0, prev = null;
  for (var i = 0; i < frames; i++){
    if (G.state === S.READY) launch();
    var cur = balls[0];
    if (!cur){ prev = null; continue; }
    if (prev && cur !== prev) losses++;
    prev = cur;
    pointerTarget = cur.x;
    var a0 = Math.atan2(cur.vy, cur.vx);
    update(1/60);
    var after = balls[0];
    if (after !== cur) continue;                       // 这一帧球被换掉了，不计入
    if (Math.abs(Math.atan2(after.vy, after.vx) - a0) > 1e-9) steered++;
    var tg = nearestBrick(after.x, after.y);
    if (tg && losBlocked(after.x, after.y, tg)) blockedFrames++;
  }
  Sound.hard = _h;
  var hp1 = 0;
  for (var i = 0; i < bricks.length; i++) if (!isFurniture(bricks[i])) hp1 += Math.max(0, bricks[i].hp);
  return { hard: hard, dmg: hp0 - hp1, blocked: blockedFrames, steered: steered, losses: losses };
}

// 真正的 A/B：把 nearestAimBrick 临时换回旧行为（= 直接用 nearestBrick，不看视线），
// 两组跑同一张盘面。函数声明在脚本作用域里，驱动可以直接改写。
var __realAim = nearestAimBrick;
var __oldAim  = function(x, y, fb){ return nearestBrick(x, y); };

nearestAimBrick = __oldAim;
var oldF = runMagnet(435, 0, -400, 1800);
var oldS = runMagnet(600, -160, -370, 1800);
nearestAimBrick = __realAim;
var newF = runMagnet(435, 0, -400, 1800);
var newS = runMagnet(600, -160, -370, 1800);

function row(label, r){
  return '  ' + label + '  撞死砖 ' + String(r.hard).padStart(3) + ' 次   打掉可破坏砖血量 ' +
         String(r.dmg).padStart(2) + '   磁力引导帧 ' + String(r.steered).padStart(3) +
         '   掉命 ' + r.losses;
}
L.push('  每格 1800 帧（30 秒），同一张盘面、只换瞄准函数：');
L.push('  ── 旧：nearestBrick（只看距离，会瞄到死砖后面那块） ──');
L.push(row('正面（球在死砖正下方）', oldF));
L.push(row('斜向（球在右下方）    ', oldS));
L.push('  ── 新：nearestAimBrick（跳过被死砖挡住的目标） ──');
L.push(row('正面（球在死砖正下方）', newF));
L.push(row('斜向（球在右下方）    ', newS));
L.push('  => 旧代码把球一次次送到死砖上（撞死砖次数高、可破坏砖几乎没掉血）；');
L.push('     新代码改瞄直线打得着的那块，或者干脆不掰 —— 不再往死砖上撞。');
L.push('');

L.push('=== 诊断 2：反弹那一帧到底有没有被拨（直接调 reflectNudge）===');
function bend(label, cells, x0, vx, vy){
  newGame(); G.level = 0; loadLevel(0, cells); G.state = S.PLAY;
  var b = makeBall(x0, 400, vx, vy); balls = [b]; G.stuckTimer = 0; b.turnLock = 0;
  var a0 = Math.atan2(b.vy, b.vx);
  // 直接调 reflectNudge = 等价于"这一帧刚好发生了反射"。
  // （"自由飞行的帧里一帧都不动"那一条在 90-line 和审计里量。）
  var fired = reflectNudge(b, null);
  var a1 = Math.atan2(b.vy, b.vx);
  var fromH = deg(Math.abs(Math.atan2(Math.abs(vy), Math.abs(vx))));
  L.push('  ' + label + '  离水平 ' + fromH.toFixed(0) + '°  贴水平=' + flatAngle(vx, vy) +
         '  可破坏砖=' + breakableLeft() + '  门控=' + assistGate() +
         (fired ? '  ★拨了 ' : '  · 没拨 ') + deg(Math.abs(a1-a0)).toFixed(2) + '°');
}
// 一块砖在左上，球在中右 -> 目标方向与航向差别很大，"该掰"
var ONE = [[1,0,0,0,0,0,0,0,0,0]];
var MANY = [[1,1,1,1,1,0,0,0,0,0],[1,1,1,1,1,0,0,0,0,0]];
bend('残局 · 贴竖直(80°)', ONE, 700, 60, -395);
bend('残局 · 贴水平(9°)  ', ONE, 700, 395, -60);
bend('中局 · 贴竖直(80°)', MANY, 700, 60, -395);
bend('中局 · 贴水平(9°)  ', MANY, 700, 395, -60);
bend('中局 · 安全角度45° ', MANY, 700, 283, -283);
L.push('  对照：旧代码是**每帧**朝目标转一点点（中局 2°/帧），5 帧就能转 10°；');
L.push('        新代码是**反弹瞬间的一次性事件** —— 自由飞行里一帧都不动，');
L.push('        只在反射那一帧判断，不对就一次拨够（这里直接调 reflectNudge）。');
L.push('        中局贴水平照样拨（角度这条不受残局门控约束）；');
L.push('        贴竖直和 45° 一律不拨（玩家收窄："竖直的没问题"）。');
`;

// 11d. 复现用户报的"卡关"盘面：中心一块 5 血砖被四块实心砖正交包围。
//      修好之后这里应该：门被打开 -> 中心砖真的能打到 -> 关卡能过。
SCENES['93-stuck'] = `
window.__out = [];
window.__NB_DEBUG = {};
// 用户原图：
//   空   死砖   空
//   死砖  5    死砖
//   空   死砖   空
var CROSS = [
  [0,0,0,0,-1,0,0,0,0,0],
  [0,0,0,-1, 5,-1,0,0,0,0],
  [0,0,0,0,-1,0,0,0,0,0]
];
window.__out.push('盘面（球区宽 10 列）：');
for (var r = 0; r < CROSS.length; r++){
  window.__out.push('   ' + CROSS[r].map(function(v){ return v === -1 ? '墙' : (v === 0 ? '·' : v); }).join(' '));
}
window.__out.push('');
window.__out.push('修复前：中心砖四正交邻居全是实心砖 -> 被封死，这关永远通不了。');
window.__out.push('');

newGame(); G.level = 0; loadLevel(0, CROSS); G.state = S.PLAY; launch();
window.__out.push('loadLevel 之后的实际盘面（修复后）：');
var rows = {};
for (var i = 0; i < bricks.length; i++){
  var bb = bricks[i];
  (rows[bb.row] = rows[bb.row] || {})[bb.col] = bb.solid ? '墙' : (bb.type === 5 ? '5' : bb.type);
}
for (var r = 0; r < 3; r++){
  var line = [];
  for (var c = 0; c < 10; c++) line.push((rows[r] && rows[r][c] !== undefined) ? rows[r][c] : '·');
  window.__out.push('   ' + line.join(' '));
}
window.__out.push('');
window.__out.push('球直径 = ' + (balls[0].r * 2) + 'px   相邻两列砖的水平缝 = 6px   相邻两行砖的垂直缝 = 7px');
window.__out.push('=> 球钻不过砖缝，只能从"空着的整格"进出');

// 找出中心砖现在长什么样
var center = null;
for (var i = 0; i < bricks.length; i++) if (bricks[i].row === 1 && bricks[i].col === 4) center = bricks[i];
window.__out.push('中心格 (行1,列4) 现在是：' + (center ? ('type=' + center.type + ' hp=' + center.hp + (center.solid ? ' 实心不可破' : ' 可破坏')) : '空的'));

// 5 分钟自动驾驶：每次过关就重进同一张盘面
var minHp = 99, clears = 0, deaths = 0, maxStuck = 0, everHit = false;
var d0 = JSON.parse(JSON.stringify(window.__NB_DEBUG || {}));
for (var i = 0; i < 18000; i++){
  if (G.state === S.LEVEL){ clears++; loadLevel(0, CROSS); launch(); }
  if (G.state === S.READY) launch();
  var b = balls[0];
  if (b) pointerTarget = b.x; else deaths++;
  update(1/60);
  // 每帧重新找中心砖（过关重载后 bricks 会被重建，不能缓存引用）
  var cur = null;
  for (var j = 0; j < bricks.length; j++) if (bricks[j].row === 1 && bricks[j].col === 4) cur = bricks[j];
  if (cur && !cur.solid){
    if (cur.hp < minHp){ minHp = cur.hp; everHit = true; }
    if (cur.dead) everHit = true;
  }
  if (G.stuckTimer > maxStuck) maxStuck = G.stuckTimer;
}
var d1 = window.__NB_DEBUG || {};
window.__out.push('');
window.__out.push('=== 跑满 300 秒（18000 帧，全自动，鼠标追球）===');
window.__out.push('  中心砖被击中过：' + (everHit ? '是' : '否'));
window.__out.push('  中心砖最低血量：' + (minHp === 99 ? '不可破坏（已变墙）' : minHp));
window.__out.push('  过关次数：' + clears + ' 次');
window.__out.push('  stuckTimer 峰值 ' + maxStuck.toFixed(1) + 's   掉命 ' + deaths + ' 次');
window.__out.push('');
window.__out.push(clears > 0
  ? '结论：修复后这关**可以打通**了（300 秒内过了 ' + clears + ' 次）。'
  : '结论：**还是打不通** —— 修复没生效。');

// 这个坑到底多常见？采样一批随机关卡，数一数有多少关需要开门。
window.__out.push('');
window.__out.push('=== 这个坑有多常见（采样随机关卡）===');
var RATES = [6, 12, 20, 30];
for (var ri = 0; ri < RATES.length; ri++){
  var lv = RATES[ri], SAMP = 800, need = 0, doors = 0;
  for (var s = 0; s < SAMP; s++){
    var before = trappedFixCount;
    pattern(lv);
    var d = trappedFixCount - before;
    if (d > 0){ need++; doors += d; }
  }
  window.__out.push('  第 ' + (lv + 1) + ' 关: ' + SAMP + ' 次生成里有 ' + need +
    ' 关需要开门 (' + (need / SAMP * 100).toFixed(1) + '%)，共 ' + doors + ' 道门');
}
window.__out.push('  => 不修的话，每 100 关里就有若干关是**永远打不通**的。');
`;

// 11e. 三条防卡规则的直接量化（规则 1 主动性 / 规则 2 残局加强 / 规则 3 磁力倍数）
SCENES['94-rules'] = `
window.__out = [];
var L = window.__out;
function deg(x){ return x * 180 / Math.PI; }

// 规则 1（收窄后）：只有"贴水平"算角度不对；竖直侧不再触发。
// 现在的介入单位是**事件**（反弹那一帧拨一次），所以这里直接调 reflectNudge。
function probe(vx, vy){
  newGame(); G.level = 0; loadLevel(0, [[1,0,0,0,0,0,0,0,0,0]]);
  G.state = S.PLAY;
  var b = makeBall(480, 400, vx, vy); balls = [b];
  G.stuckTimer = 0; b.turnLock = 0;
  var a0 = Math.atan2(b.vy, b.vx);
  var fired = reflectNudge(b, null);
  return { flat: flatAngle(vx, vy), fired: fired,
           turn: deg(Math.abs(Math.atan2(b.vy, b.vx) - a0)) };
}
function row(lb, vx, vy){
  var r = probe(vx, vy);
  L.push('  ' + lb + '   贴水平=' + (r.flat ? 'Y' : 'n') +
         (r.fired ? '   ★拨了 ' : '   · 不拨 ') + r.turn.toFixed(1) + '°');
}
L.push('=== 规则 1：只有"贴水平角度过小"才引导（玩家收窄："竖直的没问题"）===');
row('纯水平   (400, 0)     ', 400, 0);
row('离水平29° (350,-194)   ', 349.8, -193.9);
row('离水平31° (343,-206)   ', 342.9, -206.0);
row('45°      (283,-283)   ', 283, -283);
row('离竖直29° (350,-194)   ', 193.9, -349.8);   // 就是上面 61°，换个说法看边界
row('纯竖直   (0, -400)    ', 0, -400);
L.push('  收窄前这里还会含"离竖直 30° 以内"（实测占第 1 关 91% 的帧）——');
L.push('  那正是"引导线一直在"的来源，也是玩家后来点名要砍掉的一半。');
L.push('');

L.push('=== 规则 2：最后几块砖，引导加强 ===');
function nudgeAt(nBricks){
  newGame(); G.level = 0; loadLevel(0, [Array(10).fill(0).map(function(_, i){ return i < nBricks ? 1 : 0; })]);
  G.state = S.PLAY;
  var b = makeBall(480, 400, 400, 0); balls = [b]; G.stuckTimer = 0; b.turnLock = 0;
  var a0 = Math.atan2(b.vy, b.vx);
  var t = nearestAimBrick(480, 400, true, null);      // 先拿目标，再拨
  var want = Math.atan2(t.y + t.h/2 - 400, t.x + t.w/2 - 480);
  var full = deg(Math.abs(Math.atan2(Math.sin(want - a0), Math.cos(want - a0))));
  reflectNudge(b, null);
  return { left: breakableLeft(), boost: assistBoost(), full: full,
           turn: deg(Math.abs(Math.atan2(b.vy, b.vx) - a0)) };
}
var r3 = nudgeAt(3), r2 = nudgeAt(2), r1 = nudgeAt(1);
L.push('  剩 ' + r3.left + ' 块: boost x' + r3.boost.toFixed(2) + ' -> 一次拨 ' + r3.turn.toFixed(1) + '°（一次到位要 ' + r3.full.toFixed(1) + '°）');
L.push('  剩 ' + r2.left + ' 块: boost x' + r2.boost.toFixed(2) + ' -> 一次拨 ' + r2.turn.toFixed(1) + '°（一次到位要 ' + r2.full.toFixed(1) + '°）');
L.push('  剩 ' + r1.left + ' 块: boost x' + r1.boost.toFixed(2) + ' -> 一次拨 ' + r1.turn.toFixed(1) + '°（一次到位要 ' + r1.full.toFixed(1) + '°）');
L.push('  （残局外是半强度；残局里乘 boost，只剩 1 块时正好一次到位）');
L.push('  （旧版这张表是"每帧 4°/6.5°/9°"—— 新版一次事件就拨完，单位不再是 °/帧）');
L.push('');

L.push('=== 规则 3：磁力球用引导的 2~3 倍加强版 ===');
L.push('  引导基准   ' + deg(ASSIST_TURN_BASE).toFixed(1) + '°/帧 (' + deg(ASSIST_TURN_BASE)*60 + '°/s)  <- 现在只作为倍数的锚点');
L.push('  磁力球     ' + deg(MAGNET_TURN).toFixed(1) + '°/帧 (' + deg(MAGNET_TURN)*60 + '°/s)   倍数 = ' + (MAGNET_TURN/ASSIST_TURN_BASE).toFixed(1) + 'x');
L.push('  （10°/帧 -> 转过 90° 只要 9 帧 = 0.15 秒；磁力不受残局门控约束，是打掉磁铁砖的奖励）');
L.push('  （磁力仍然是**每帧**过程 —— 它是 buff 期间的显式行为，不是"拨正一下就撒手"）');
L.push('');
L.push('=== 转弯砖的"让路窗口" ===');
newGame(); G.level = 0; loadLevel(0, [[0, 12, 0, 0, 0, 0, 0, 0, 0, 0]]);   // 12 = 朝下
G.state = S.PLAY;
var tb = bricks[0];
var bb = makeBall(tb.x + tb.w/2, tb.y + tb.h + 9, 0, -300); balls = [bb];
for (var i = 0; i < 4; i++) update(1/60);
var ang = Math.atan2(bb.vy, bb.vx);
L.push('  残局里撞转弯砖(朝下)后 4 帧：实际 ' + deg(ang).toFixed(0) + '°  期望 90°  turnLock=' + (bb.turnLock||0).toFixed(2) + 's');
L.push('  => 箭头方向仍然说了算，没被角度触发当场掰回去');
`;

// 11c. 磁力到底能不能"感受到"？受控实验：中间留空档，直着往上必然打不到，
//      看磁力能不能把球掰过去 —— 以及掰过去花了多久、横移了多远。
SCENES['95-magnet'] = `
window.__out = [];
// 场地：中间 8 列全空，只有最左和最右各两块砖（共 4 块）。
// 球从 y=520 竖直向上飞 -> 不做任何修正就必然从空档穿过去。
var GAPGRID = [[1,1,0,0,0,0,0,0,1,1]];
var Y0 = 520, SPEED = 460;

// ── 隔离防卡死引导：这个实验只测磁力 ──
// 光把 stuckTimer 按住已经**不够**了：规则 1 的角度触发现在是**全程有效**的，
// 而球竖直上飞正好落在"危险角度"里 —— 不按住它，防卡死引导会替磁力把球掰过去，
// 对照组（无磁力）也会"打到"，整个实验就失去判别力。
// ── 隔离防卡死引导：这个实验只测磁力 ──
// 光把 stuckTimer 按住已经**不够**了：贴水平触发虽然收窄了，但残局计时器兜底
// 仍然会在反射那一帧拨正，而球竖直上飞会撞到砖 -> 反射 -> 可能被拨。
// 所以把 flatAngle 短路成 false 并且把 reflectNudge 也按住
// （函数声明可写；场景页各自独立，不会串味）。
var __realFlat = flatAngle;
var __realNudge = reflectNudge;
flatAngle = function(){ return false; };
reflectNudge = function(){ return false; };

function alive(){ var n=0; for (var i=0;i<bricks.length;i++) if (!bricks[i].dead && !isFurniture(bricks[i])) n++; return n; }

function trial(off, useMag, speed){
  speed = speed || SPEED;
  loadLevel(0, GAPGRID);
  G.state = S.PLAY;
  var x0 = 480 + off;
  balls = [ makeBall(x0, Y0, 0, -speed) ];
  balls[0].magnet = useMag ? MAGNET_LIFE : 0;
  var n = 0, hit = false, lateral = 0, turnDeg = 0, spErr = 0;
  var ang0 = Math.atan2(balls[0].vy, balls[0].vx);
  var lastAng = ang0, prevAng = ang0, prevHp = alive();
  while (n < 600){
    G.stuckTimer = 0;                     // 隔离防卡死引导：这里只测磁力
    var sp0 = Math.hypot(balls[0].vx, balls[0].vy);
    update(1/60); n++;
    var b = balls[0];
    if (!b) break;
    // 先判命中、再累计转角：撞砖那一帧方向会被反射规则翻转（实测 98.7°），
    // 那不是磁力的功劳，计进去会把"磁力把球转了多少度"整个污染掉。
    if (alive() < prevHp){ hit = true; lateral = b.x - x0; break; }
    var ang = Math.atan2(b.vy, b.vx);
    var d = ang - prevAng;
    while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI;
    turnDeg += Math.abs(d) * 180 / Math.PI;      // 累计转角一律换算成**度**
    prevAng = ang; lastAng = ang;
    var sp = Math.hypot(b.vx, b.vy);
    if (useMag && b.magnet > 0) spErr = Math.max(spErr, Math.abs(sp - sp0));
    if (b.y > 545 && n > 20) break;        // 掉回挡板 = 这一趟结束
  }
  return { n:n, hit:hit, lateral:lateral, turnDeg:turnDeg, spErr:spErr, frames:n,
           ang0: ang0 * 180 / Math.PI, lastAng: lastAng * 180 / Math.PI };
}

// ---------- 1. 对照：没有磁力，球从空档穿过去 ----------
window.__out.push('=== 1. 对照：不打磁铁砖就没有磁力 ===');
window.__out.push('场地只有最左和最右各 2 块砖（共 4 块），中间 8 列全空。球从 y=520 竖直上飞。');
window.__out.push('');
window.__out.push('  离轴     无磁力    有磁力    达成用时   横移量    撞击前航向   磁力累计转角  速率变化');
[0, 80, 160, 240].forEach(function(off){
  var a = trial(off, false), b = trial(off, true);
  window.__out.push('  ' + (off+'px').padEnd(8)
    + (a.hit ? '打到' : '打不到').padEnd(10)
    + (b.hit ? '打到' : '打不到').padEnd(10)
    + ((b.hit ? b.frames/60 : 0).toFixed(2) + 's').padEnd(11)
    + (b.lateral.toFixed(0) + 'px').padEnd(10)
    + ((b.hit ? b.lastAng.toFixed(1) : '-') + '°').padEnd(14)
    + (b.turnDeg.toFixed(1) + '°').padEnd(14)
    + b.spErr.toFixed(6) + 'px/s');
});
window.__out.push('  （初始航向一律是 -90.0° = 竖直向上。"磁力累计转角"只统计磁力造成的方向变化，');
window.__out.push('    不含撞砖那一帧的反射翻转。4 个离轴位置全部"无磁力打不到、有磁力打到"。）');

// ---------- 2. 磁力给球多大的转向权限？ ----------
window.__out.push('');
window.__out.push('=== 2. 转向权限：单帧 ' + (MAGNET_TURN*180/Math.PI).toFixed(1) + '° = ' + (MAGNET_TURN*180/Math.PI*60).toFixed(0) + '°/秒 ===');
var dist = Y0 - (92 + 26);          // 从起点飞到砖行下沿的距离
[300, 460, 700, 1000].forEach(function(sp){
  var t = dist / sp;
  window.__out.push('  球速 ' + String(sp).padEnd(5) + 'px/s -> 飞到砖行要 ' + t.toFixed(2) + 's = '
    + (t*60).toFixed(0) + ' 帧 -> 期间最多可转 ' + (t*60*MAGNET_TURN*180/Math.PI).toFixed(0) + '°');
});
window.__out.push('  （对比：旧的引力井让 460px/s 的球从 60px 外掠过只偏转 6.2°，横移约 110px，');
window.__out.push('    而且实测球落在井半径内的时间只占 0.2%~0.6% 的帧 —— 所以"感受不到"。）');

// ---------- 3. 只转方向、不改速率；且只在上行时生效 ----------
window.__out.push('');
window.__out.push('=== 3. 两条硬约束 ===');
var mx = 0;
[0, 80, 160, 240].forEach(function(off){ mx = Math.max(mx, trial(off, true).spErr); });
window.__out.push('  速率守恒：磁力全程 |Δ速度| 最大 ' + mx.toFixed(6) + 'px/s（纯旋转，理论值 0）');
// 球向下飞时磁力必须完全不介入
loadLevel(0, GAPGRID);
G.state = S.PLAY;
balls = [ makeBall(480, 200, 0, 300) ];
balls[0].magnet = MAGNET_LIFE;
var downTurn = 0, prevA = Math.atan2(balls[0].vy, balls[0].vx), magLeft0 = balls[0].magnet;
for (var i = 0; i < 20; i++){
  update(1/60);
  var b2 = balls[0];
  var a2 = Math.atan2(b2.vy, b2.vx);
  var dd = a2 - prevA;
  while (dd > Math.PI) dd -= 2*Math.PI; while (dd < -Math.PI) dd += 2*Math.PI;
  downTurn += Math.abs(dd); prevA = a2;
}
window.__out.push('  只在上行生效：球向下飞 20 帧，累计转角 ' + downTurn.toFixed(6) + '°（应为 0）');
window.__out.push('    同期磁力计时 ' + magLeft0.toFixed(2) + 's -> ' + balls[0].magnet.toFixed(2) + 's（照常流逝，所以 buff 一定会到期）');
window.__out.push('');
window.__out.push('磁力时长 MAGNET_LIFE = ' + MAGNET_LIFE + 's；单帧上限 MAGNET_TURN = ' + MAGNET_TURN.toFixed(5) + ' 弧度');
window.__out.push('（本实验全程把 flatAngle 与 reflectNudge 都按住，并把 stuckTimer 按住 —— 只留磁力一个变量）');
flatAngle = __realFlat;
reflectNudge = __realNudge;
`;

// 11b. 看球到底在干什么（每 5 秒采一次样）
SCENES['96-what'] = `
window.__out = [];
newGame(); G.level = 1; loadLevel(1); launch();
function hpSum(){ var n=0; for (var i=0;i<bricks.length;i++) if (!isFurniture(bricks[i])) n += Math.max(0, bricks[i].hp); return n; }
function alive(){ var n=0; for (var i=0;i<bricks.length;i++) if (!bricks[i].dead && !isFurniture(bricks[i])) n++; return n; }
var hiY = 0, loY = 999, bounceN = 0, nearN = 0, prevVy = 0, prevY = 0;
for (var i = 0; i < 18000; i++){
  var b = balls[0];
  if (b) pointerTarget = b.x;
  var by0 = b ? b.y : -1, vy0 = b ? b.vy : 0;
  update(1/60);
  var a = balls[0];
  if (a && b && a === b){
    if (by0 + 7 >= paddle.y - 2 && vy0 > 0 && a.vy < 0) bounceN++;
    if (by0 + 7 >= paddle.y - 2) nearN++;
    if (a.y > hiY) hiY = a.y;
    if (a.y < loY) loY = a.y;
  }
  if (i % 300 === 0){
    window.__out.push('t=' + (i/60).toFixed(0) + 's state=' + G.state + ' 存活砖=' + alive() +
      ' 球y=' + (a ? a.y.toFixed(0) : 'GONE') + ' vy=' + (a ? a.vy.toFixed(0) : '-') +
      ' stuck=' + G.stuckTimer.toFixed(1) + ' paddle.y=' + paddle.y.toFixed(0) + ' paddle.x=' + paddle.x.toFixed(0));
  }
}
window.__out.push('球 y 范围 ' + loY.toFixed(0) + ' ~ ' + hiY.toFixed(0) + '   挡板附近帧数=' + nearN + '  反弹=' + bounceN);
window.__out.push('最终 state=' + G.state + '  存活砖=' + alive() + '  maxStuck 已重置');
`;

// 每个场景跑完都做一次自检：把 canvas 回读一遍，把结果写进 document.title，
// 这样 --dump-dom 就能拿到诊断（看不到图片时的排查手段）
const DIAG = `
/* 中文字形自检：如果字体缺失，Chrome 会把不同汉字都画成同一个“豆腐块”，
   两张位图就会几乎一样。差异够大才说明真的渲染出了汉字。 */
function __cjk(){
  try{
    var c = document.createElement('canvas'); c.width = 72; c.height = 44;
    var g = c.getContext('2d');
    function bmp(ch){
      g.clearRect(0,0,72,44);
      g.font = '32px "Microsoft YaHei", sans-serif';
      g.textBaseline = 'top'; g.fillStyle = '#fff';
      g.fillText(ch, 3, 3);
      var d = g.getImageData(0,0,72,44).data, s = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 128) s++;
      var a = [];
      for (var j = 3; j < d.length; j += 4) a.push(d[j] > 128 ? 1 : 0);
      return { ink: s, bits: a };
    }
    var A = bmp('砖'), B = bmp('块');
    var diff = 0;
    for (var k = 0; k < A.bits.length; k++) if (A.bits[k] !== B.bits[k]) diff++;
    return 'cjk(ink=' + A.ink + ',diff=' + diff + ',yahei=' + document.fonts.check('32px "Microsoft YaHei"') + ')';
  }catch(e){ return 'cjk-ERR ' + e.message; }
}

/* 把场景的精确坐标也吐出来，验证脚本就能按"真实位置"采样，
   而不是靠人手抄一份可能过期的常量 */
function __marks(){
  try{
    return JSON.stringify({
      ball: balls[0] ? [+balls[0].x.toFixed(1), +balls[0].y.toFixed(1)] : null,
      vel: balls[0] ? [+balls[0].vx.toFixed(1), +balls[0].vy.toFixed(1)] : null,
      trail: balls[0] ? balls[0].trail.map(function(p){ return [+p.x.toFixed(1), +p.y.toFixed(1)]; }) : [],
      // 磁力 buff 状态：验证脚本靠它确认"球真的被磁化了"，以及外观该是什么颜色
      magnet: balls[0] ? +balls[0].magnet.toFixed(2) : 0,
      assistFx: balls[0] ? +balls[0].assistFx.toFixed(3) : 0,
      style: balls[0] ? ballStyle(balls[0]) : null,
      breakable: breakableLeft(),
      assistOn: assistGate(),
      // 当前的单帧转角额度（度）：验证脚本用它算"拖尾矢高的理论上限"，
      // 不再把旧值 2.2°/帧 写死在注释里
      magTurnDeg: MAGNET_TURN * 180 / Math.PI,
      assistTurnDeg: ASSIST_TURN_BASE * 180 / Math.PI,   // 只作为"磁力倍数的锚点"保留
      // 场上第一块磁铁砖的中心（验证脚本用它采样，避免手抄网格坐标抄错）
      magnetBrick: (function(){
        for (var i = 0; i < bricks.length; i++){
          if (bricks[i].magnet && !bricks[i].dead)
            return [+(bricks[i].x + bricks[i].w/2).toFixed(1), +(bricks[i].y + bricks[i].h/2).toFixed(1)];
        }
        return null;
      })(),
      stuck: +G.stuckTimer.toFixed(2),
      // 传送门：场上还活着的门的中心 + 这对门还剩几次（验证脚本据此采样数字）
      portalLeft: PORTAL_MAX_USES - portalUses,
      portalDots: (function(){
        var out = [];
        for (var i = 0; i < bricks.length; i++){
          var q = bricks[i];
          if (q.portal && !q.dead) out.push([+(q.x + q.w/2).toFixed(1), +(q.y + q.h/2).toFixed(1)]);
        }
        return out;
      })(),
      // 磁力/引导这一帧真正在瞄的那块砖（画引导线用的就是它）
      magLine: (balls[0] && balls[0].magTarget) ? [+balls[0].magTarget.x.toFixed(1), +balls[0].magTarget.y.toFixed(1)] : null,
      aimLine: (balls[0] && balls[0].aimTarget) ? [+balls[0].aimTarget.x.toFixed(1), +balls[0].aimTarget.y.toFixed(1)] : null,
      ascending: balls[0] ? balls[0].vy < 0 : false,
      magnetTarget: (function(){
        var b = balls[0]; if (!b) return null;
        var t = nearestBrick(b.x, b.y);
        return t ? [+(t.x + t.w/2).toFixed(1), +(t.y + t.h/2).toFixed(1)] : null;
      })(),
      shock: shockwaves.map(function(w){ return [+w.x.toFixed(1), +w.y.toFixed(1), +w.r.toFixed(1)]; }),
      alive: bricks.filter(function(b){ return !b.dead; }).length,
      dead: bricks.filter(function(b){ return b.dead; }).length,
      probe: window.__probe || []
    });
  }catch(e){ return '{}'; }
}

function __diag(tag0){
  try{
    var r = cv.getBoundingClientRect();
    var im = ctx.getImageData(0,0,cv.width,cv.height).data;
    var nonDark = 0, tot = 0;
    for (var i = 0; i < im.length; i += 4*37){
      tot++;
      if (Math.max(im[i],im[i+1],im[i+2]) > 46) nonDark++;
    }
    return tag0 + ' rect=' + Math.round(r.width) + 'x' + Math.round(r.height) +
      ' cv=' + cv.width + 'x' + cv.height +
      ' view=' + view.w + 'x' + view.h + ' scale=' + view.scale.toFixed(3) +
      ' dpr=' + view.dpr +
      ' 非暗=' + (nonDark/tot*100).toFixed(2) + '%' +
      ' state=' + G.state + ' bricks=' + bricks.length + '/' + bricks.filter(function(b){return b.dead;}).length + 'dead' +
      ' drops=' + drops.length +
      ' 磁力=' + (balls[0] ? balls[0].magnet.toFixed(1) : '-') + 's balls=' + balls.length + ' ' + __cjk();
  }catch(e){ return tag0 + ' DIAG-ERR ' + e.message; }
}
`;

function buildPage(body){
  // 整个驱动包在 IIFE 里：游戏脚本在全局词法作用域里已经有 `const S`、`const POWERS` 等，
  // 驱动里若再出现同名 var/function 会在**解析期**就抛
  // "Identifier 'S' has already been declared"，整段 script 被丢弃（连报错都看不到）。
  const driver = `<script>\n(function(){\n${HELPERS}\n${DIAG}\n` +
    `try{\n${body}\n}catch(e){ window.__err = e; }\n` +
    // 场景摆好后冻住物理：主循环还在跑，每帧只会重画同一个静止画面。
    // 这样即使 Chrome 截图前改了视口、把画布清掉，下一帧也会立刻重画回来。
    `update = function(){};\n` +
    `render();\n` +
    // 审计类场景可以往 window.__out 里塞任意多行文本，走 DOM 输出（不受 title 长度限制）
    `try{ if (window.__out && window.__out.length){\n` +
    `  var pre = document.createElement('pre'); pre.id = '__out';\n` +
    `  pre.textContent = window.__out.join('\\n'); document.body.appendChild(pre);\n` +
    `} }catch(e){}\n` +
    `window.__diagText = (window.__err ? 'ERR: ' + window.__err.message + ' @' + ((window.__err.stack||'').split('\\n')[1]||'') : 'OK') + ' || ' + __diag('shot');\n` +
    `try{ document.title = window.__diagText + ' ||MARKS|| ' + __marks(); }catch(e){}\n` +
    `})();\n</script>`;
  return shellHead + PRE + '<script>' + gameSrc + '</script>' + driver + shellTail;
}

const only = process.argv[2];
const probe = process.argv.includes('--probe');
const MARKS = {};
let n = 0;
for (const name of Object.keys(SCENES)){
  if (only && only.indexOf('--') !== 0 && name.indexOf(only) < 0) continue;
  // 98/99 是诊断场景：只在显式点名时跑，不进正式出图流程
  if (!only && /^9/.test(name)) continue;
  const file = path.join(TMP, name + '.html');
  fs.writeFileSync(file, buildPage(SCENES[name]), 'utf8');
  const url = BASE + '/neon-breaker/_shot/html/' + name + '.html';
  if (probe){
    let out = '';
    try {
      out = execFileSync(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--no-first-run',
        '--user-data-dir=' + path.join(TMP, 'profile'), '--virtual-time-budget=3000',
        '--dump-dom', url], { stdio: 'pipe', timeout: 60000 }).toString();
    } catch (e){ out = (e.stdout || '').toString() + ' :: ' + (e.stderr || '').toString().slice(0, 400); }
    const m = out.match(/<title>([\s\S]*?)<\/title>/);
    console.log(name.padEnd(14) + ' ' + (m ? m[1] : '(无 title) ' + out.slice(0, 300)));
    const om = out.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    if (om) {
      const txt = om[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      console.log(txt);
    }
    continue;
  }
  const png = path.join(OUT, name + '.png');
  let dom = '';
  try {
    // --dump-dom 和 --screenshot 可以同时用：一次运行既拿到图，也拿到页面里的精确坐标
    dom = execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--mute-audio',
      '--force-device-scale-factor=1',
      '--window-size=' + W + ',' + H,
      '--user-data-dir=' + path.join(TMP, 'profile'),
      '--virtual-time-budget=4000',
      '--screenshot=' + png,
      '--dump-dom',
      url
    ], { stdio: 'pipe', timeout: 90000 }).toString();
  } catch (e){
    dom = (e.stdout || '').toString();
    console.log('  !! ' + name + ' chrome 退出码 ' + (e.status || '?') +
                (e.stderr ? ' :: ' + e.stderr.toString().slice(0, 300) : ''));
  }
  const tm = dom.match(/<title>([\s\S]*?)<\/title>/);
  const title = tm ? tm[1] : '';
  const parts = title.split('||MARKS||');
  const diagText = (parts[0] || '').trim();
  try { MARKS[name] = JSON.parse(parts[1] || '{}'); } catch (e) { MARKS[name] = {}; }
  if (/^ERR/.test(diagText)) console.log('  ** ' + name + ' 场景报错: ' + diagText.slice(0, 200));
  const ok = fs.existsSync(png);
  console.log((ok ? '  ok  ' : '  --  ') + name + '.png' +
              (ok ? '  ' + Math.round(fs.statSync(png).size / 1024) + ' KB' : '') +
              '   alive=' + (MARKS[name].alive !== undefined ? MARKS[name].alive : '?') +
              ' dead=' + (MARKS[name].dead !== undefined ? MARKS[name].dead : '?'));
  if (ok) n++;
}
if (!probe) {
  // 只跑单个场景时不要把其它场景的坐标冲掉：先读旧的再合并
  const marksFile = path.join(__dirname, 'marks.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(marksFile, 'utf8')); } catch (e) {}
  fs.writeFileSync(marksFile, JSON.stringify(Object.assign(prev, MARKS), null, 1), 'utf8');
  console.log('生成 ' + n + ' 张 -> ' + OUT);
}
