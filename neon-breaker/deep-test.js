// neon-breaker 深度测试：逐系统单测 + 长时间自动对局 + 渲染路径校验
// 可独立运行: node deep-test.js <game.js>   或由 run-tests.js 以 run(gameSrc) 调用
const fs = require('fs');

function run(src){
  /* ---------------- 假 DOM ---------------- */
  const MODULES = ['document','window','localStorage','devicePixelRatio','addEventListener',
                   'requestAnimationFrame','performance','AudioContext','webkitAudioContext','$GAME','__NB_DEBUG','VP'];
  const saved = {};
  for (const k of MODULES) saved[k] = global[k];

  function fakeCtx(){
    return {
      canvas: null, setTransform(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){},
      beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, arc(){}, arcTo(){},
      fill(){}, stroke(){}, clearRect(){}, fillRect(){}, strokeRect(){},
      fillText(){}, strokeText(){}, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop(){} }),
      createRadialGradient: () => ({ addColorStop(){} }),
      setLineDash(){},
    };
  }
  // 挂在 global 上：harness 与垫片（位于 eval 出来的全局作用域）共享同一个可变视口
  const VP = global.VP = { w: 1600, h: 1000 };
  const canvas = {
    width: 0, height: 0, tabIndex: 0, style: {}, textContent: '',
    getContext(){ if(!this._c){ this._c = fakeCtx(); this._c.canvas = this; } return this._c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: VP.w, height: VP.h }),
    addEventListener(){}, focus(){}, appendChild(){},
  };
  const fsBtnEl = { textContent: '', addEventListener(){}, style:{} };
  const store = {};
  global.document = {
    getElementById: id => id === 'cv' ? canvas : id === 'fsBtn' ? fsBtnEl : null,
    createElement: () => canvas,
    body: { appendChild(){} },
    addEventListener(){},
    fullscreenElement: null,
    documentElement: { requestFullscreen(){ global.__fsReq = (global.__fsReq||0)+1; global.document.fullscreenElement = {}; return { catch(){} }; } },
    exitFullscreen(){ global.__fsExit = (global.__fsExit||0)+1; global.document.fullscreenElement = null; return { catch(){} }; },
  };
  global.window = global;
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  global.devicePixelRatio = 2;
  const keydownHandlers = [];
  const pasteHandlers = [];
  global.addEventListener = (type, fn) => {
    if (type === 'keydown') keydownHandlers.push(fn);
    if (type === 'paste') pasteHandlers.push(fn);
  };
  const pressKey = (key) => {
    const ev = { key, preventDefault(){}, stopPropagation(){} };
    for (const fn of keydownHandlers) fn(ev);
  };
  const pasteText = (text) => {
    const ev = {
      clipboardData: { getData: (t) => (t === 'text' || !t ? text : '') },
      preventDefault(){},
    };
    for (const fn of pasteHandlers) fn(ev);
  };
  global.pressKey = pressKey;      // 垫片在 eval 出的全局作用域执行，需要从 global 取
  global.__paste = pasteText;
  let pending = [];
  global.requestAnimationFrame = cb => { pending.push(cb); return pending.length; };
  global.performance = { now: () => 0 };
  delete global.AudioContext; delete global.webkitAudioContext;

  let pass = 0, fail = 0;
  const failures = [];
  const log = [];
  const say = s => { console.log(s); log.push(s); };
  function check(name, cond, detail){
    if (cond){ pass++; say('  ok   ' + name); }
    else { fail++; failures.push(name + (detail ? '  -> ' + detail : '')); say('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
  }
  const section = s => say('\n--- ' + s + ' ---');
  const S_READY=1, S_PLAY=2, S_LEVEL=4, S_OVER=6;

  try {
    /* ---------------- 载入游戏 ---------------- */
    (0, eval)(src + `

/* --- harness shim --- */
globalThis.$GAME = {
  snap: () => ({ G, balls, paddle, bricks, drops, particles, floats, mouse }),
  setPointer: v => { pointerTarget = v; },
  setMouse: (x, y, on) => { mouse.x = x; mouse.y = y; mouse.hasPointer = on; },
  newGame, launch, loadLevel, applyPower, POWERS, pattern, spawnDrops, makeBall, damage,
  startSelect, startLevel, selectKey, selectHitTest, selectItems, saveBest,
  setInfinite: v => { G.infinite = v; },
  view, toWorld, toggleFullscreen, isFullscreen, pointerMove,
  pointerTarget: () => pointerTarget,
  drawHUD, requestNewGame, cancelConfirm, pressKey: globalThis.pressKey,
  encodeShareCode, decodeShareCode, openShare, closeShare, openImport, closeImport,
  tryImport, shareUI, importUI,
  saveProgress, loadProgress, hasSave, clearSave, saveInfo, serializeSave,
  saveSettings, loadSettings, SAVE_KEY, SET_KEY,
  rawSave: () => Store.get(SAVE_KEY), rawSet: () => Store.get(SET_KEY),
  storeAvailable: () => Store.available,
  setViewport: (w, h) => { globalThis.VP.w = w; globalThis.VP.h = h; resize(); },
};
`);
    const $ = global.$GAME;
    if (!$) throw new Error('shim 未生效');

    /* ---------------- 驱动 ---------------- */
    const DT = 1000/60;
    let t = 0;
    function frames(n, opts = {}){
      for (let i = 0; i < n; i++){
        const cbs = pending; pending = [];
        t += DT;
        for (const cb of cbs) cb(t);
        if (opts.steer){
          const { balls } = $.snap();
          if (balls.length){
            // 追逐最低的球（"预测落点"策略会让挡板震荡，反而更易漏球）
            let low = balls[0];
            for (const b of balls) if (b.y > low.y) low = b;
            $.setPointer(low.x + (opts.aim || 0));
          }
        }
        if (opts.autoLaunch){
          const { G, balls } = $.snap();
          if ((G.state === 1 || G.state === 4) && balls.length >= 0){
            if (G.state === 1) $.launch();
            else $.loadLevel(++G.level);
          }
        }
        if (opts.keepAlive){
          const { G } = $.snap();
          G.lives = Math.max(G.lives, 5);
        }
      }
    }

    // 只推进帧、不干预局面（用于绘制探针，避免 steer/autoLaunch 改动被测状态）
    function hFrames(n){ frames(n, {}); }

    /* ================ 1. 关卡定义合法性 ================ */
    section('关卡定义 (pattern)');
    for (let n = 0; n <= 20; n++){
      const grid = $.pattern(n).grid;
      const bad = [];
      grid.forEach((row, r) => {
        if (row.length !== 10) bad.push(`第${r}行长度=${row.length}`);
        row.forEach((v, c) => {
          if (![-1,0,1,2,3,4,5,9].includes(v) || Number.isNaN(v)) bad.push(`非法砖值 ${v} @${r},${c}`);
        });
      });
      const breakable = grid.some(row => row.some(v => v > 0));
      check(`第 ${n+1} 关结构合法且可通关`, bad.length === 0 && breakable, bad.slice(0,3).join('; ') || '没有可破坏砖');
    }

    /* ================ 2. 初始状态 & 发射 ================ */
    section('开局与发射');
    $.newGame();
    check('新游戏进入 READY 态', $.snap().G.state === S_READY);
    check('生命=3', $.snap().G.lives === 3);
    check('分数清零', $.snap().G.score === 0);
    check('球贴住挡板', $.snap().balls[0].stuck === true);
    frames(5, {});
    const stuckBall = $.snap().balls[0];
    check('未发射时球跟随挡板', Math.abs(stuckBall.y - ($.snap().paddle.y - stuckBall.r - 1)) < 0.001);
    $.launch();
    const lb = $.snap().balls[0];
    check('发射后进入 PLAY', $.snap().G.state === S_PLAY);
    check('发射后球有向上速度', lb.vy < 0, 'vy=' + lb.vy.toFixed(1));
    check('发射速度合理', Math.hypot(lb.vx, lb.vy) > 300 && Math.hypot(lb.vx, lb.vy) < 700);

    /* ================ 3. 道具逐个生效 ================ */
    section('道具效果 (applyPower)');
    const P = k => $.POWERS.find(p => p.k === k);

    $.newGame(); $.launch(); frames(3, {});
    let before = $.snap().paddle.w;
    $.applyPower(P('wide'));
    check('wide: 挡板变宽', $.snap().paddle.w > before, `${before} -> ${$.snap().paddle.w}`);

    // 贴墙吃"加宽"道具时，挡板不得插进侧墙
    $.newGame(); $.launch(); frames(3, {});
    $.snap().paddle.x = 900;
    $.applyPower(P('wide'));
    {
      const pd = $.snap().paddle;
      check('贴右墙加宽后挡板不越界', pd.x + pd.w <= 936.001, `x=${pd.x.toFixed(1)} w=${pd.w} 右缘=${(pd.x+pd.w).toFixed(1)}`);
    }
    $.newGame(); $.launch(); frames(3, {});
    $.snap().paddle.x = 25;
    $.applyPower(P('wide'));
    check('贴左墙加宽后挡板不越界', $.snap().paddle.x >= 23.999, 'x=' + $.snap().paddle.x.toFixed(1));

    $.newGame(); $.launch(); frames(3, {});
    before = $.snap().paddle.w;
    $.applyPower(P('narrow'));
    check('narrow: 挡板变窄', $.snap().paddle.w < before, `${before} -> ${$.snap().paddle.w}`);

    $.newGame(); $.launch(); frames(3, {});
    for (let i = 0; i < 12; i++) $.applyPower(P('narrow'));
    check('narrow: 有下限不会归零', $.snap().paddle.w >= 60, 'w=' + $.snap().paddle.w);
    for (let i = 0; i < 20; i++) $.applyPower(P('wide'));
    check('wide: 有上限不会溢出屏幕', $.snap().paddle.w <= 260, 'w=' + $.snap().paddle.w);

    $.newGame(); $.launch(); frames(3, {});
    before = $.snap().balls.length;
    $.applyPower(P('multi'));
    check('multi: 球数 +2', $.snap().balls.length === before + 2, `${before} -> ${$.snap().balls.length}`);

    $.newGame(); $.launch(); frames(3, {});
    before = Math.hypot($.snap().balls[0].vx, $.snap().balls[0].vy);
    $.applyPower(P('slow'));
    check('slow: 球变慢', Math.hypot($.snap().balls[0].vx, $.snap().balls[0].vy) < before);
    check('slow: 慢动作计时启动', $.snap().G.slowFx > 0);

    $.newGame(); $.launch(); frames(3, {});
    before = Math.hypot($.snap().balls[0].vx, $.snap().balls[0].vy);
    $.applyPower(P('fast'));
    check('fast: 球变快', Math.hypot($.snap().balls[0].vx, $.snap().balls[0].vy) > before);

    // fast 不能突破速度上限（曾经 vx *= 1.32 会把已达上限的球顶到 1300+）
    $.newGame(); $.launch(); frames(3, {});
    {
      const b = $.snap().balls[0];
      const sp0 = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= 1000 / sp0; b.vy *= 1000 / sp0;      // 先推到上限
      for (let i = 0; i < 5; i++) $.applyPower(P('fast'));
      const spNow = Math.hypot(b.vx, b.vy);
      check('fast: 不会突破 1000 速度上限', spNow <= 1000.5, 'sp=' + spNow.toFixed(1));
    }

    $.newGame(); $.launch(); frames(3, {});
    before = $.snap().G.lives;
    $.applyPower(P('life'));
    check('life: 生命 +1', $.snap().G.lives === before + 1);

    /* ================ 4. 砖块系统 ================ */
    section('不可破坏砖 / 金砖 / 砖块生成');
    $.newGame(); $.loadLevel(3);                      // 第 4 关（index 3）= 要塞
    {
      const { bricks } = $.snap();
      const solid = bricks.filter(b => b.solid);
      check('第 4 关生成了不可破坏砖', solid.length > 0, 'solid=' + solid.length);
      check('不可破坏砖 hp=1 且 type=-1', solid.length > 0 && solid.every(b => b.hp === 1 && b.type === -1));
      if (solid.length){
        const s = solid[0];
        for (let i = 0; i < 50; i++) $.damage(s, s.x + 3, s.y + 3);
        check('不可破坏砖扛 50 次打击仍完好', s.dead === false);
      }
    }
    $.newGame();
    {
      check('第 1 关存在金砖', $.snap().bricks.filter(b => b.golden).length > 0);
      let dropSeen = 0;
      for (let trial = 0; trial < 40; trial++){
        $.newGame();
        const g = $.snap().bricks.find(b => b.golden);
        const n0 = $.snap().drops.length;
        $.damage(g, g.x + 3, g.y + 3);
        if ($.snap().drops.length > n0) dropSeen++;
      }
      check('金砖击破后掉落道具（40 次内出现过）', dropSeen > 0, '命中 ' + dropSeen + '/40');
    }
    {
      let nanTotal = 0;
      for (let n = 0; n <= 30; n++){
        $.newGame(); $.loadLevel(n);
        nanTotal += $.snap().bricks.filter(b => !isFinite(b.hp) || !isFinite(b.x) || !isFinite(b.y)).length;
      }
      check('31 个关卡均无 NaN/非法砖块', nanTotal === 0, 'nan=' + nanTotal);
    }
    $.newGame(); frames(2, {});
    {
      $.snap().bricks.forEach(b => { if (!b.solid) b.dead = true; });
      $.snap().G.state = S_PLAY;
      frames(2, {});
      check('清空可破坏砖后进入 LEVEL 态', $.snap().G.state === S_LEVEL, 'state=' + $.snap().G.state);
    }
    $.newGame(); $.loadLevel(3);
    {
      $.snap().bricks.forEach(b => { if (!b.solid) b.dead = true; });
      check('要塞关清空后仍有实心砖残留', $.snap().bricks.some(b => !b.dead && b.solid));
      $.snap().G.state = S_PLAY;
      frames(2, {});
      check('只剩实心砖也能通关（不卡死）', $.snap().G.state === S_LEVEL, 'state=' + $.snap().G.state);
    }

    /* ================ 5. 掉命与游戏结束 ================ */
    section('掉命 / GAME OVER');
    $.newGame(); $.launch(); frames(3, {});
    $.snap().G.lives = 1;
    $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
    frames(2, {});
    check('最后一条命掉球后进入 OVER', $.snap().G.state === S_OVER, 'state=' + $.snap().G.state);
    check('GAME OVER 后生命<=0', $.snap().G.lives <= 0);

    $.newGame(); $.launch(); frames(3, {});
    $.snap().G.lives = 3;
    $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
    frames(2, {});
    check('还有命时回到 READY 而不是 OVER', $.snap().G.state === S_READY, 'state=' + $.snap().G.state);
    check('掉命后生命 3->2', $.snap().G.lives === 2);
    check('掉命后重发球且贴板', $.snap().balls.length === 1 && $.snap().balls[0].stuck === true);

    // 掉命不应收走已吃到的道具：加宽/变窄都要保留
    // （否则玩家会觉得"刚吃的 W 白吃了"，而且三球/减速在掉命后本来也不重置）
    check('掉命后挡板宽度保持默认（未吃道具时）', $.snap().paddle.w === 130, 'w=' + $.snap().paddle.w);
    {
      $.newGame(); $.launch(); frames(3, {});
      $.applyPower(P('wide'));
      const widened = $.snap().paddle.w;
      check('吃 W 后挡板确实变宽', widened > 130, 'w=' + widened);
      $.snap().G.lives = 3;
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('掉命后加宽的挡板宽度被保留', $.snap().paddle.w === widened,
            `${$.snap().paddle.w} vs ${widened}`);
      check('保留宽度后没有越界', (() => {
        const pd = $.snap().paddle;
        return pd.x >= 23.999 && pd.x + pd.w <= 936.001;
      })(), 'x=' + $.snap().paddle.x.toFixed(1) + ' w=' + $.snap().paddle.w);
      // 连掉多条命也一直保留
      for (let i = 0; i < 2; i++){
        $.snap().G.lives = 3;
        $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
        frames(2, {});
      }
      check('连续掉命后宽度依旧保留', $.snap().paddle.w === widened, 'w=' + $.snap().paddle.w);
    }
    {
      // 变窄是负面效果，同样不应被"重置"悄悄洗掉（保持规则一致）
      $.newGame(); $.launch(); frames(3, {});
      $.applyPower(P('narrow'));
      const narrowed = $.snap().paddle.w;
      check('吃 N 后挡板变窄', narrowed < 130, 'w=' + narrowed);
      $.snap().G.lives = 3;
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('掉命后变窄的挡板同样保持（规则一致）', $.snap().paddle.w === narrowed,
            `${$.snap().paddle.w} vs ${narrowed}`);
    }
    {
      // 练习模式重发球也走同一条规则
      $.startSelect();
      if (!$.snap().G.infinite) $.selectKey('i');
      $.selectKey('1');
      $.launch(); frames(3, {});
      $.applyPower(P('wide'));
      const w0 = $.snap().paddle.w;
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('练习模式重发球也保留宽度', $.snap().paddle.w === w0, `${$.snap().paddle.w} vs ${w0}`);
      $.setInfinite(false); $.newGame();
    }

    /* ================ 6. 长时间完整对局（压力测试） ================ */
    section('长时间自动对局 (7200 帧 / 120 秒，含防卡死机制收敛)');
    const D = global.__NB_DEBUG = { nudges: 0, reloads: 0 };
    $.newGame();
    let err = 0, viol = 0, maxCombo = 0, maxBalls = 1, minSpeed = 1e9, maxSpeed = 0;
    let levelUps = 0, maxStir = 0, assistSamples = 0;
    let prevLvl = $.snap().G.level;
    const errList = [];
    for (let i = 0; i < 7200; i++){
      try { frames(1, { steer:true, autoLaunch:true, keepAlive:true }); }
      catch(e){ err++; if (errList.length < 5) errList.push(e.message); }
      const { G, balls, paddle } = $.snap();
      maxStir = Math.max(maxStir, G.stuckTimer);
      if (G.stuckTimer > 8) assistSamples++;
      if (G.level !== prevLvl){ levelUps++; prevLvl = G.level; }
      maxCombo = Math.max(maxCombo, G.combo);
      maxBalls = Math.max(maxBalls, balls.length);
      if (paddle.x < 23.5 || paddle.x + paddle.w > 936.5){ viol++; if (errList.length < 8) errList.push('挡板越界 ' + paddle.x.toFixed(1) + '/' + paddle.w); }
      for (const b of balls){
        if (!isFinite(b.x) || !isFinite(b.y)){ viol++; errList.push('NaN'); }
        if (b.x - b.r < 22.5 || b.x + b.r > 937.5 || b.y - b.r < 22.5){ viol++; errList.push(`穿墙 x=${b.x.toFixed(1)} y=${b.y.toFixed(1)}`); }
        if (b.stuck) continue;                    // 贴板待发射的球速度 0 属正常
        const sp = Math.hypot(b.vx, b.vy);
        minSpeed = Math.min(minSpeed, sp); maxSpeed = Math.max(maxSpeed, sp);
      }
    }
    {
      const { G, balls, bricks, particles } = $.snap();
      say('  状态: level=' + (G.level+1) + ' score=' + G.score + ' combo峰值=' + maxCombo +
          ' 球数峰值=' + maxBalls + ' 剩余砖=' + bricks.filter(b=>!b.dead).length +
          ' 粒子=' + particles.length + ' 飞行球速=' + Math.round(minSpeed) + '~' + Math.round(maxSpeed) +
          ' 过关次数=' + levelUps + ' 竖直纠偏=' + D.nudges + ' 重新发球=' + D.reloads +
          ' 最长停滞=' + maxStir.toFixed(1) + 's 引导生效帧=' + assistSamples);
      check('7200 帧无异常抛出', err === 0, errList.slice(0,3).join(' | '));
      check('7200 帧无物理越界', viol === 0, errList.slice(0,3).join(' | '));
      // slow 是可叠加的（×0.68 连乘），所以下界不能按"单次 slow"来卡；
      // 这里只验证安全性：速度不会趋近 0（不会卡死），也不会突破 1000 上限
      check('飞行球速安全区间 (40~1000)', minSpeed > 40 && maxSpeed <= 1000.5, `${Math.round(minSpeed)}~${Math.round(maxSpeed)}`);
      check('120 秒内至少过关一次（防卡死生效）', levelUps >= 1, '过关次数=' + levelUps + ' level=' + (G.level+1));
      check('产生了得分', G.score > 0);
      check('触发了连击', maxCombo >= 2, 'combo=' + maxCombo);
      check('最高分已写入 localStorage', +store['neon-breaker-best'] > 0, store['neon-breaker-best']);
      check('球长期未丢失（挡板有效接球）', balls.length >= 1);
      check('滞留被硬性限制在 40s 以内', maxStir <= 40.5, 'maxStir=' + maxStir.toFixed(1) + ' 重新发球=' + D.reloads);
      check('竖直死循环纠偏未被频繁触发', D.nudges <= 3, 'nudges=' + D.nudges);
    }

    /* ================ 7. 极端场景 ================ */
    section('极端场景');
    $.newGame(); $.launch(); frames(2, {});
    for (let i = 0; i < 8; i++) $.applyPower(P('multi'));
    check('反复三球齐发不崩', $.snap().balls.length >= 10, 'balls=' + $.snap().balls.length);
    frames(120, { steer:true });
    check('多球状态稳定推进', $.snap().balls.length >= 1 && $.snap().G.state !== S_OVER);

    $.newGame();
    for (let i = 0; i < 60; i++) $.spawnDrops(200 + i*8, 200);
    frames(200, { steer:true, keepAlive:true });
    check('大量道具同时下落不崩', true);

    $.newGame();
    for (let n = 6; n <= 40; n++) $.loadLevel(n);
    frames(60, { steer:true });
    check('连续生成 35 个随机关卡不崩', true);

    /* ================ 8. 绘制路径（严格 ctx，捕获任何 API 拼写错误） ================ */
    section('渲染路径 / Canvas API 正确性');
    {
      const calls = Object.create(null);
      const METHODS = ['setTransform','save','restore','translate','rotate','scale','beginPath','closePath',
        'moveTo','lineTo','arc','arcTo','quadraticCurveTo','bezierCurveTo','rect','fill','stroke','clip',
        'clearRect','fillRect','strokeRect','fillText','strokeText','setLineDash','drawImage','ellipse'];
      const PROPS = ['fillStyle','strokeStyle','lineWidth','globalAlpha','font','textAlign','textBaseline',
        'shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY','globalCompositeOperation','lineCap','lineJoin',
        'imageSmoothingEnabled','miterLimit','filter','direction','canvas'];
      // 游戏在加载时已把 ctx 缓存进闭包，只能换原型；假 ctx 的方法都是自有属性，需先摘掉
      const realCtx = canvas.getContext('2d');
      const realProto = Object.getPrototypeOf(realCtx);
      const recorder = Object.create(realProto);
      for (const m of METHODS) recorder[m] = () => { calls[m] = (calls[m]||0)+1; };
      recorder.measureText = () => ({ width: 10 });
      recorder.createLinearGradient = () => { calls.createLinearGradient=(calls.createLinearGradient||0)+1; return { addColorStop(){ calls.addColorStop=(calls.addColorStop||0)+1; } }; };
      recorder.createRadialGradient = () => { calls.createRadialGradient=(calls.createRadialGradient||0)+1; return { addColorStop(){ calls.addColorStop=(calls.addColorStop||0)+1; } }; };
      const strictProxy = new Proxy(recorder, {
        get(t, k){
          if (k in t) return t[k];
          throw new Error(`ctx.${String(k)} 不是 CanvasRenderingContext2D 的成员（拼写错误？）`);
        },
        set(t, k, v){
          if (!PROPS.includes(k)) throw new Error(`ctx.${String(k)} 不是合法属性`);
          t[k] = v; return true;
        },
      });
      Object.setPrototypeOf(realCtx, strictProxy);
      const savedMethods = {};
      for (const m of METHODS.concat(['measureText','createLinearGradient','createRadialGradient','setLineDash']))
        if (Object.prototype.hasOwnProperty.call(realCtx, m)){ savedMethods[m] = realCtx[m]; delete realCtx[m]; }

      let drawErr = null;
      try {
        $.setMouse(480, 300, true);                  // 让自绘准星也进入绘制路径
        $.newGame();
        frames(40, { steer:true });                  // TITLE / READY 覆盖层
        $.launch();
        frames(300, { steer:true, keepAlive:true });  // PLAY：砖块/球/拖尾/粒子
        $.applyPower(P('wide')); $.applyPower(P('multi'));
        frames(150, { steer:true, keepAlive:true });
        $.spawnDrops($.snap().paddle.x + 40, 200);
        frames(150, { steer:true, keepAlive:true });  // 道具盒绘制
        const G = $.snap().G;
        G.state = S_LEVEL; frames(10, {});            // 过关覆盖层
        G.state = 3;       frames(10, {});            // 暂停覆盖层
        G.state = S_OVER;  frames(10, {});            // 结束覆盖层
      } catch(e){ drawErr = e.message; }
      Object.setPrototypeOf(realCtx, realProto);
      Object.assign(realCtx, savedMethods);

      const total = Object.values(calls).reduce((a,b)=>a+b, 0);
      say('  绘制调用统计: ' + Object.entries(calls).map(([k,v])=>k+'='+v).join(' '));
      check('所有绘制路径无 API 错误', drawErr === null, drawErr || '');
      check('确实执行了大量绘制调用', total > 5000, 'total=' + total);
      check('覆盖了文字绘制 (HUD/覆盖层)', (calls.fillText || 0) > 0);
      check('覆盖了渐变绘制 (砖块/挡板)', (calls.createLinearGradient || 0) > 0 && (calls.createRadialGradient || 0) > 0);
      check('覆盖了圆弧绘制 (球/粒子/生命)', (calls.arc || 0) > 0);
    }

    /* ================ 9. 自绘准星（鼠标可见性） ================ */
    section('鼠标准星（cursor:none 下的可见性）');
    {
      // 造一个"空场"帧，让准星成为唯一会画 arc 的东西，便于精确计数。
      // 注意：假 ctx 的方法都是自有属性，必须打在实例上（打原型拦不住）
      const c2 = canvas.getContext('2d');
      const realArc = c2.arc;
      const arcCalls = () => {
        let n = 0;
        c2.arc = () => { n++; };
        try { $.newGame(); frames(1, { steer:false }); } finally { c2.arc = realArc; }
        return n;
      };
      $.setMouse(480, 300, false);
      const off = arcCalls();
      $.setMouse(480, 300, true);
      const on = arcCalls();
      check('准星只在指针位于游戏区内时绘制', on > off, `off=${off} on=${on}`);
      check('准星确实画了中心点+外圈弧线', on - off >= 5, `增加 ${on - off} 次 arc`);
      check('指针离开后准星消失', (() => { $.setMouse(480, 300, false); return arcCalls(); })() === off);
    }

    /* ================ 10. 练习 / 选关模式 ================ */
    section('练习 / 选关模式');
    const S_SELECT = 8;
    {
      // 进入选关界面
      $.newGame();
      $.startSelect();
      check('C 可进入选关界面', $.snap().G.state === S_SELECT, 'state=' + $.snap().G.state);
      check('选关列表 = 5 个设计关卡 + 2 个随机入口', $.selectItems.length === 7, 'n=' + $.selectItems.length);
      check('设计关卡条目都指向 0~4', $.selectItems.slice(0,5).every((it,i) => it.kind === 'designed' && it.level === i));
      check('随机入口指向 >=5 的关卡', $.selectItems.slice(5).every(it => it.kind === 'random' && it.level >= 5));

      // 光标上下移动（含环绕）
      $.snap().G.selectIdx = 0;
      $.selectKey('ArrowUp');
      check('↑ 从第一项环绕到最后一项', $.snap().G.selectIdx === 6, 'idx=' + $.snap().G.selectIdx);
      $.selectKey('ArrowDown');
      check('↓ 从最后一项环绕回第一项', $.snap().G.selectIdx === 0, 'idx=' + $.snap().G.selectIdx);
      for (let i = 0; i < 3; i++) $.selectKey('ArrowDown');
      check('↓ 逐项下移', $.snap().G.selectIdx === 3, 'idx=' + $.snap().G.selectIdx);

      // 数字键直选：每个设计关卡都要能直接进
      let jumpedOk = true, levelOk = true, bricksOk = true;
      for (let i = 0; i < 5; i++){
        $.startSelect();
        $.selectKey(String(i + 1));
        const { G, bricks } = $.snap();
        if (G.state !== S_READY) jumpedOk = false;
        if (G.level !== i) levelOk = false;
        if (bricks.length === 0) bricksOk = false;
      }
      check('数字键 1~5 直接进入对应关卡', jumpedOk && levelOk && bricksOk,
            `jumped=${jumpedOk} level=${levelOk} bricks=${bricksOk}`);

      // Enter 进入当前选中项
      $.startSelect();
      $.snap().G.selectIdx = 3;
      $.selectKey('Enter');
      check('Enter 进入选中的第 4 关', $.snap().G.level === 3 && $.snap().G.state === S_READY,
            'level=' + $.snap().G.level);

      // 鼠标点击卡片
      $.startSelect();
      const hit = $.selectHitTest(400, 150 + 61 * 2 + 10);      // 第 3 张卡片
      check('点击卡片命中第 3 项并进入', hit && $.snap().G.level === 2, 'level=' + $.snap().G.level);
      $.startSelect();
      check('点击卡片以外的位置不误触发', $.selectHitTest(500, 20) === false && $.snap().G.state === S_SELECT);

      // Esc / C 返回标题
      $.startSelect();
      $.selectKey('Escape');
      check('Esc 返回标题', $.snap().G.state === 0, 'state=' + $.snap().G.state);
      $.startSelect();
      $.selectKey('c');
      check('再按 C 返回标题', $.snap().G.state === 0, 'state=' + $.snap().G.state);

      // I 开关无限生命
      $.startSelect();
      const inf0 = $.snap().G.infinite;
      $.selectKey('i');
      check('I 切换无限生命', $.snap().G.infinite !== inf0, 'inf=' + $.snap().G.infinite);

      // 无限生命：按真实操作顺序 —— 先进选关界面，再按 I 开启
      $.startSelect();
      if (!$.snap().G.infinite) $.selectKey('i');
      check('进选关界面后可按 I 开启无限生命', $.snap().G.infinite === true);
      $.selectKey('1');
      check('练习模式开局生命充足', $.snap().G.lives >= 99, 'lives=' + $.snap().G.lives);
      check('练习模式被标记为 practice', $.snap().G.practice === true);
      $.launch();
      const lives0 = $.snap().G.lives;
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('无限生命：掉球不扣命', $.snap().G.lives === lives0, `${lives0} -> ${$.snap().G.lives}`);
      check('无限生命：掉球后回 READY 而非 GAME OVER', $.snap().G.state === S_READY, 'state=' + $.snap().G.state);
      check('无限生命：掉球后自动补球', $.snap().balls.length === 1 && $.snap().balls[0].stuck === true);
      // 反复掉 20 次仍然活着
      for (let i = 0; i < 20; i++){
        $.launch();
        $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
        frames(2, {});
      }
      check('连续掉球 20 次仍不结束', $.snap().G.state === S_READY && $.snap().G.lives >= 99,
            `state=${$.snap().G.state} lives=${$.snap().G.lives}`);

      // 练习分数不得污染最高分
      const bestBefore = $.snap().G.best;
      store['neon-breaker-best'] = String(bestBefore);
      $.snap().G.score = bestBefore + 99999;
      $.saveBest();
      check('练习分数不写入最高分', $.snap().G.best === bestBefore && store['neon-breaker-best'] === String(bestBefore),
            `best=${$.snap().G.best} stored=${store['neon-breaker-best']} practice=${$.snap().G.practice}`);

      // 普通模式仍然照常累计最高分与扣命
      $.setInfinite(false);
      $.newGame();
      check('普通模式 practice=false 且生命=3', $.snap().G.practice === false && $.snap().G.lives === 3);
      const b2 = $.snap().G.best;
      $.snap().G.score = b2 + 5000;
      $.saveBest();
      check('普通模式分数照常写入最高分', $.snap().G.best === b2 + 5000, 'best=' + $.snap().G.best);
      $.launch();
      const lv0 = $.snap().G.lives;
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('普通模式掉球照常扣命', $.snap().G.lives === lv0 - 1, `${lv0} -> ${$.snap().G.lives}`);

      // 练习模式也能正常过关推进
      $.startSelect();
      if (!$.snap().G.infinite) $.selectKey('i');
      $.selectKey('1');
      $.launch();
      frames(30, { steer:true, keepAlive:true });
      $.snap().bricks.forEach(b => { if (!b.solid) b.dead = true; });
      frames(2, {});
      check('练习模式清关后照常进入过关态', $.snap().G.state === S_LEVEL, 'state=' + $.snap().G.state);
      $.loadLevel(++$.snap().G.level);
      check('练习模式可继续下一关', $.snap().G.state === S_READY && $.snap().bricks.length > 0);

      // 收尾：回到普通模式开局
      $.setInfinite(false);
      $.newGame();
    }
    /* ================ 11. 视口铺满 / 全屏 ================ */
    section('视口铺满与全屏');
    {
      // 16:10 视口：正好铺满，无留边
      $.setViewport(1600, 1000);
      let v = $.view;
      check('16:10 视口铺满且无留边', Math.abs(v.ox) < .01 && Math.abs(v.oy) < .01 && Math.abs(v.scale - 1600/960) < 1e-6,
            `scale=${v.scale.toFixed(4)} ox=${v.ox.toFixed(1)} oy=${v.oy.toFixed(1)}`);

      // 逻辑四角必须映射到画布四角
      const tl = $.toWorld(0, 0), br = $.toWorld(1600, 1000);
      check('左上空点映射到逻辑 (0,0)', Math.abs(tl.x) < 1e-6 && Math.abs(tl.y) < 1e-6, `(${tl.x},${tl.y})`);
      check('右下空点映射到逻辑 (960,600)', Math.abs(br.x - 960) < 1e-6 && Math.abs(br.y - 600) < 1e-6, `(${br.x},${br.y})`);
      check('画布范围内的点都判为场内', tl.inside && br.inside);
      check('画布内任意点都要求指针留在游戏区内', (() => {
        for (const [x, y] of [[0,0],[800,500],[1599,999],[1600,1000]]){
          if (!$.toWorld(x, y).inside) return false;
        }
        return true;
      })());

      // 更宽的视口（21:9）：左右留边，指针落在边上应判为场外
      $.setViewport(2100, 1000);
      v = $.view;
      check('超宽视口产生左右留边', v.ox > 1 && Math.abs(v.oy) < .01, `ox=${v.ox.toFixed(1)} oy=${v.oy.toFixed(1)}`);
      check('等比缩放，画面完整可见（不裁切）', Math.abs(v.scale * 960 - 1600) < 1e-6 && v.scale * 600 <= 1000 + 1e-6,
            `画面=${(v.scale*960).toFixed(0)}x${(v.scale*600).toFixed(0)}`);
      const pad = $.toWorld(10, 500);                   // 左侧留边里
      check('留边里的点判为场外', pad.inside === false, `x=${pad.x.toFixed(1)} inside=${pad.inside}`);
      const mid = $.toWorld(2100/2, 500);
      check('画面中心的点判为场内', mid.inside === true, `x=${mid.x.toFixed(1)}`);

      // 指针事件走 toWorld，水平位置要正确对应
      $.setViewport(1600, 1000);
      $.newGame();
      const pm = $.pointerMove, tgt = () => $.pointerTarget();
      pm(1200, 500);                                     // 1200/1600 = 0.75 -> 逻辑 x=720
      check('指针位置正确映射到挡板目标', Math.abs(tgt() - 720) < 1e-6, 'target=' + tgt());
      check('指针在画面内时 onField=true', $.snap().mouse.onField === true);

      // 指针移到留边：挡板目标被夹在边界内，且准星标记为场外
      $.setViewport(2100, 1000);
      pm(5, 500);
      check('指针进左留边时目标夹到左边界', tgt() === 0, 'target=' + tgt());
      check('指针进留边时 onField=false（准星变暗）', $.snap().mouse.onField === false);
      pm(2095, 500);
      check('指针进右留边时目标夹到右边界', tgt() === 960, 'target=' + tgt());

      // 全屏切换
      global.__fsReq = 0; global.__fsExit = 0;
      check('初始不在全屏', $.isFullscreen() === false);
      $.toggleFullscreen();
      check('请求进入全屏', global.__fsReq === 1 && $.isFullscreen() === true, `req=${global.__fsReq}`);
      $.toggleFullscreen();
      check('再次调用退出全屏', global.__fsExit === 1 && $.isFullscreen() === false, `exit=${global.__fsExit}`);

      // 恢复默认视口，避免影响后续用例
      $.setViewport(1600, 1000);
      $.newGame();
    }
    /* ================ 12. 存档 ================ */
    section('存档 / 读档 / 设置持久化');
    {
      for (const k of Object.keys(store)) delete store[k];

      // 空档
      check('无存档时 hasSave=false', $.hasSave() === false);
      check('无存档时 loadProgress 返回 false', $.loadProgress() === false);
      check('无存档时 saveInfo 返回 null', $.saveInfo() === null);

      // 开新局会自动存档
      $.newGame();
      check('开新局后自动产生存档', $.hasSave() === true && !!store[$.SAVE_KEY]);

      // 打一会儿，制造"非初始"状态
      $.launch();
      frames(240, { steer:true, keepAlive:true });
      const before = $.snap();
      const snapState = {
        level: before.G.level,
        score: before.G.score,
        lives: before.G.lives,
        paddleW: before.paddle.w,
        practice: before.G.practice,
        brickCount: before.bricks.length,
        broken: before.bricks.filter(b => b.dead).length,
        hpSum: before.bricks.reduce((n, b) => n + b.hp, 0),
        balls: before.balls.length,
      };
      check('存档前确实有砖被打掉', snapState.broken > 0, 'broken=' + snapState.broken);
      check('存档前分数 > 0', snapState.score > 0, 'score=' + snapState.score);

      // 手动存档 -> 序列化内容可读且正确
      store[$.SAVE_KEY] && delete store[$.SAVE_KEY];
      // 用当前这片场地直接存档，并把"存档内容"和"当前场地"对照，排除中间是否有帧推进
      const liveNow = before.bricks.length;
      const brokenNow = before.bricks.filter(b => b.dead).length;
      const aliveNow = liveNow - brokenNow;
      const hpSumNow = before.bricks.reduce((n, b) => n + (b.dead ? 0 : b.hp), 0);   // 存活砖的总血量
      $.saveProgress(false);
      const d = $.saveInfo();
      const savedRaw = store[$.SAVE_KEY];      // 留一份：后面打乱局面时会被自动存档覆盖
      const savedEntries = d.bricks.split(',').filter(Boolean).length;
      check('存档可被解析且版本匹配', !!d && d.v === 1, JSON.stringify(d && { v: d.v, level: d.level }));
      check('存档记录了关卡/分数/生命', d.level === snapState.level && d.score === snapState.score && d.lives === snapState.lives,
            `level=${d.level} score=${d.score} lives=${d.lives}`);
      check('存档记录了挡板宽度', d.paddleW === snapState.paddleW, `w=${d.paddleW}`);
      check('存档记录了所有存活砖块（漏记会被读档当成已击破）',
            savedEntries === aliveNow,
            `记录 ${savedEntries} / 存活 ${aliveNow}（场地共 ${liveNow}，已破 ${brokenNow}）`);
      check('存档体积很小', JSON.stringify(d).length < 1500, 'bytes=' + JSON.stringify(d).length);
      snapState.aliveBricks = aliveNow;         // 读档后应当还原出这么多块砖
      snapState.aliveHp = hpSumNow;             // 以及这么多总血量
      snapState.brickCount = liveNow;
      snapState.broken = brokenNow;

      // 打乱局面（新局 + 随机关卡），再把好档注回去读档还原。
      // 注意：后面的 newGame() 会触发自动存档，所以打乱完要把待测存档写回。
      $.newGame();
      for (let i = 0; i < 5; i++) $.loadLevel(7);
      frames(30, { steer:true });
      check('已把局面改乱（读档前状态不同）',
            $.snap().G.score !== snapState.score || $.snap().G.level !== snapState.level ||
            $.snap().bricks.length !== snapState.brickCount);
      store[$.SAVE_KEY] = savedRaw;

      const ok = $.loadProgress();
      const after = $.snap();
      check('读档成功', ok === true);
      check('读档还原关卡', after.G.level === snapState.level, `${after.G.level} vs ${snapState.level}`);
      check('读档还原分数', after.G.score === snapState.score, `${after.G.score} vs ${snapState.score}`);
      check('读档还原生命', after.G.lives === snapState.lives, `${after.G.lives} vs ${snapState.lives}`);
      check('读档还原挡板宽度', after.paddle.w === snapState.paddleW, `w=${after.paddle.w}`);
      check('读档还原剩余砖块数量（等于存档里的存活砖数）',
            after.bricks.length === snapState.aliveBricks,
            `${after.bricks.length} vs 存活 ${snapState.aliveBricks}`);
      check('读档还原存活砖的总血量',
            after.bricks.reduce((n, b) => n + b.hp, 0) === snapState.aliveHp,
            `${after.bricks.reduce((n,b)=>n+b.hp,0)} vs ${snapState.aliveHp}`);
      check('读档后没有已击破的砖残留', after.bricks.every(b => !b.dead));
      check('读档还原球数', after.balls.length === snapState.balls, `${after.balls.length} vs ${snapState.balls}`);
      check('读档后球在场内', after.balls.every(b => b.x > 0 && b.x < 960 && b.y > 0 && b.y < 600));
      check('读档后可以继续玩', after.G.state === 2 || after.G.state === 1, 'state=' + after.G.state);

      // 读档后继续推进不崩
      let err2 = 0;
      try { frames(300, { steer:true, autoLaunch:true, keepAlive:true }); } catch(e){ err2++; }
      check('读档后继续游玩 300 帧无异常', err2 === 0);

      // 关卡中途（击破多于一半）也能正确存档
      {
        const B = $.snap().bricks.filter(b => !b.solid);
        B.forEach((b, i) => { if (i % 2 === 0) b.dead = true; });
        $.snap().G.state = 2;
        $.saveProgress(false);
        const d2 = $.saveInfo();
        const partialRaw = store[$.SAVE_KEY];
        const aliveNow = $.snap().bricks.filter(b => !b.solid && !b.dead).length;
        $.newGame();
        store[$.SAVE_KEY] = partialRaw;         // 同上：避免被新局的自动存档顶掉
        $.loadProgress();
        check('部分击破的局面能精确还原',
              $.snap().bricks.filter(b => !b.solid && !b.dead).length === aliveNow,
              `${$.snap().bricks.filter(b=>!b.solid&&!b.dead).length} vs ${aliveNow}`);
        check('还原后存档条目数等于存活砖数',
              d2.bricks.split(',').filter(Boolean).length === aliveNow,
              `${d2.bricks.split(',').filter(Boolean).length} vs ${aliveNow}`);
      }

      // 练习模式标记随存档保留
      $.startSelect();
      if (!$.snap().G.infinite) $.selectKey('i');
      $.selectKey('1');
      $.saveProgress(false);
      const practiceRaw = store[$.SAVE_KEY];
      $.newGame();
      store[$.SAVE_KEY] = practiceRaw;
      $.loadProgress();
      check('练习模式标记随存档一起还原', $.snap().G.practice === true && $.snap().G.infinite === true);
      check('练习模式读档后生命仍充足', $.snap().G.lives >= 99, 'lives=' + $.snap().G.lives);

      // 最高分不因读档而倒退
      $.snap().G.best = 50000;
      $.snap().G.score = 10;
      $.saveProgress(false);
      $.loadProgress();
      check('读档不会让最高分倒退', $.snap().G.best >= 50000, 'best=' + $.snap().G.best);

      // 清除存档
      $.clearSave(false);
      check('清除后 hasSave=false', $.hasSave() === false && store[$.SAVE_KEY] === undefined);
      check('清除后读档失败且不影响当前局面',
            $.loadProgress() === false && $.snap().bricks.length > 0);

      // 坏数据必须被安全拒绝，不能污染游戏状态
      $.newGame();
      const goodLevel = $.snap().G.level;
      for (const bad of ['', 'not json', '{}', '{"v":99,"level":3}', 'null', '[1,2,3]',
                         '{"v":1,"level":"x","lives":3}', '{"v":1,"level":2,"lives":3,"bricks":"999:z"}']){
        store[$.SAVE_KEY] = bad;
        let threw = false, res = null;
        try { res = $.loadProgress(); } catch(e){ threw = true; }
        if (threw || res === true) check('坏存档被拒绝: ' + JSON.stringify(bad).slice(0, 28), false, 'threw=' + threw + ' res=' + res);
      }
      check('连续喂 8 条坏存档都未抛异常', true);
      // 坏档之后游戏仍可正常开局
      $.newGame();
      $.launch();
      frames(120, { steer:true, keepAlive:true });
      check('坏档之后游戏仍可正常游玩', $.snap().G.state === 2 || $.snap().G.state === 1);

      // 设置持久化
      for (const k of Object.keys(store)) delete store[k];
      $.saveSettings();
      check('设置已写入', !!store[$.SET_KEY]);
      const st = JSON.parse(store[$.SET_KEY]);
      check('设置含静音与练习开关', typeof st.muted === 'boolean' && typeof st.infinite === 'boolean');

      // 退出前兜底存储：命耗尽时应清档（避免读档回到必死局面）
      $.newGame();
      $.snap().G.lives = 1;
      $.launch();
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      frames(2, {});
      check('命耗尽进入 GAME OVER', $.snap().G.state === S_OVER);
      check('GAME OVER 后存档被清掉（不会读回必死局面）', $.hasSave() === false);

      // 收尾
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
    }

    /* ================ 13. 各种关卡的存读档（含金砖/实心砖） ================ */
    section('全关卡存读档（金砖、实心砖、随机关卡）');
    {
      // 第 4 关（要塞）同时含金砖与不可破坏砖，下标上界最容易算错
      for (const lv of [0, 1, 2, 3, 4, 5, 8, 20]){
        for (const k of Object.keys(store)) delete store[k];
        $.newGame();
        $.loadLevel(lv);
        $.snap().G.level = lv;
        // 打掉两块、打伤一块，制造非初始状态
        const B = $.snap().bricks.filter(b => !b.solid);
        if (B[0]) B[0].dead = true;
        if (B[3]) B[3].dead = true;
        if (B[1] && B[1].max > 1) B[1].hp = 1;
        $.snap().G.score = 1000 + lv;
        $.snap().G.lives = 4;
        $.snap().G.state = 2;
        $.saveProgress(false);
        const raw = store[$.SAVE_KEY];
        const entries = $.saveInfo().bricks.split(',').filter(Boolean).length;
        const aliveBefore = $.snap().bricks.filter(b => !b.dead).length;

        // 打乱后注入同一份存档
        $.loadLevel(6);
        store[$.SAVE_KEY] = raw;
        const ok = $.loadProgress();
        const after = $.snap();
        const name = lv < 5 ? `第 ${lv+1} 关` : `第 ${lv+1} 关(随机)`;
        check(`${name}: 存读档成功`, ok === true, 'ok=' + ok);
        check(`${name}: 存活砖数还原 (${aliveBefore})`, after.bricks.length === aliveBefore,
              `${after.bricks.length} vs ${aliveBefore}`);
        check(`${name}: 分数与关卡还原`, after.G.score === 1000 + lv && after.G.level === lv,
              `score=${after.G.score} level=${after.G.level}`);
        check(`${name}: 存档条目数 = 存活砖数`, entries === aliveBefore, `${entries} vs ${aliveBefore}`);
      }
    }

    /* ================ 14. 多球发射（贴板球必须全部被发射） ================ */
    section('多球发射：所有贴板球都必须被发射');
    {
      const stuckBalls = () => $.snap().balls.filter(b => b.stuck).length;
      const flyingBalls = () => $.snap().balls.filter(b => !b.stuck).length;
      $.newGame();

      // ---- 真实复现路径：球还没发射（贴板）时吃掉"3"，于是多球一起贴板 ----
      check('新开局球是贴板状态', stuckBalls() === 1, 'stuck=' + stuckBalls());
      $.applyPower(P('multi'));
      check('贴板时吃"3"会产生多个贴板球（Bug 复现前提）',
            stuckBalls() >= 3, 'stuck=' + stuckBalls() + ' balls=' + $.snap().balls.length);

      const nStuck = stuckBalls();
      $.launch();
      hFrames(1);
      check('发射后所有球都离板（Bug 修复点）', stuckBalls() === 0,
            `发射前贴板 ${nStuck} 个，发射后仍贴板 ${stuckBalls()} 个`);
      check('发射后每个球都有向上速度且离板',
            $.snap().balls.every(b => !b.stuck && b.vy < 0 && Math.hypot(b.vx, b.vy) > 100),
            $.snap().balls.map(b => (b.stuck ? 'STUCK' : Math.round(b.vy))).join(','));
      check('发射后所有 offset 已清零', $.snap().balls.every(b => b.offset === 0));

      // ---- 掉命后同样要能把所有贴板球发出去 ----
      $.newGame();
      $.launch(); hFrames(3, {});
      $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
      hFrames(2, {});
      check('掉命后回到 READY 且只有 1 个贴板球',
            $.snap().G.state === 1 && stuckBalls() === 1 && $.snap().balls.length === 1,
            `state=${$.snap().G.state} stuck=${stuckBalls()} balls=${$.snap().balls.length}`);
      $.applyPower(P('multi'));            // 在贴板状态下三球齐发
      $.launch(); hFrames(1, {});
      check('掉命后三球齐发也能全部发射', stuckBalls() === 0 && $.snap().G.state === 2,
            `stuck=${stuckBalls()} state=${$.snap().G.state}`);

      // ---- 直接构造极端情况：5 个贴板球一次全部发射 ----
      $.newGame();
      {
        const S = $.snap();
        for (let i = 0; i < 4; i++){                 // 原本就有 1 个，补 4 个 = 5 个
          const nb = $.makeBall(S.paddle.x + S.paddle.w/2, S.paddle.y - 10, 0, 0);
          nb.stuck = true; nb.offset = i * 4;
          S.balls.push(nb);
        }
        check('构造出 5 个贴板球', stuckBalls() === 5, 'stuck=' + stuckBalls());
        $.launch(); hFrames(1, {});
        check('5 个贴板球一次全部发射', stuckBalls() === 0, 'stuck=' + stuckBalls());
        check('5 个球都获得了向上速度',
              $.snap().balls.length === 5 && $.snap().balls.every(b => b.vy < 0 && Math.hypot(b.vx, b.vy) > 100),
              $.snap().balls.map(b => Math.round(b.vy)).join(','));
        check('发射后 offset 已清零', $.snap().balls.every(b => b.offset === 0));

        // 已全部在飞时再按发射应是安全空操作
        const n0 = $.snap().balls.length;
        const v0 = $.snap().balls.map(b => Math.round(b.vx) + ',' + Math.round(b.vy)).join('|');
        $.launch();
        const v1 = $.snap().balls.map(b => Math.round(b.vx) + ',' + Math.round(b.vy)).join('|');
        check('无贴板球时按发射是安全的空操作', $.snap().balls.length === n0 && v0 === v1);
      }

      // ---- 发射后打球推进若干帧，确认没有球滞留在板附近 ----
      let errM = 0;
      try { hFrames(240, { steer:true, autoLaunch:true, keepAlive:true }); } catch(e){ errM++; }
      check('多球发射后推进 240 帧无异常', errM === 0);
      // 长跑后不可能要求"没有贴板球"——期间会有球掉落并进入重发球状态，
      // 此时贴板是正常的。真正要保证的是：READY 态按下发射后立刻没有残留贴板球。
      $.launch();
      hFrames(1, {});
      check('长跑中任意一次发射都不会残留贴板球', stuckBalls() === 0,
            `state=${$.snap().G.state} stuck=${stuckBalls()}`);
    }

    /* ================ 15. 生命显示上限 ================ */
    section('生命显示（>8 命不能被静默截断）');
    {
      // 直接在绘制调用层面统计：只数"生命点"的弧线
      const c2 = canvas.getContext('2d');
      const METHODS = ['setTransform','save','restore','translate','rotate','scale','beginPath','closePath',
        'moveTo','lineTo','arc','arcTo','quadraticCurveTo','bezierCurveTo','rect','fill','stroke','clip',
        'clearRect','fillRect','strokeRect','strokeText','setLineDash','drawImage','ellipse'];
      const savedM = {};
      let arcs = 0; const texts = [];
      for (const m of METHODS) if (Object.prototype.hasOwnProperty.call(c2, m)){ savedM[m] = c2[m]; c2[m] = () => {}; }
      const savedFillText = c2.fillText;
      c2.arc = () => { arcs++; };
      c2.fillText = (t) => { texts.push(String(t)); };
      c2.measureText = () => ({ width: 10 });
      c2.createLinearGradient = () => ({ addColorStop(){} });
      c2.createRadialGradient = () => ({ addColorStop(){} });

      // 直接调用 drawHUD 统计——整帧渲染里球和粒子的弧线数每帧都在变，无法做差分
      const probe = (lives) => {
        const S = $.snap();
        S.G.lives = lives; S.G.infinite = false; S.G.practice = false; S.G.state = 2;
        arcs = 0; texts.length = 0;
        $.drawHUD();
        return { arcs, texts: texts.slice() };
      };
      $.newGame();
      $.launch(); hFrames(2, {});        // 让场上有球，确认 HUD 不受场面影响

      const r0  = probe(0);
      const r3  = probe(3);
      const r7  = probe(7);
      const r8  = probe(8);
      const r12 = probe(12);
      const r99 = probe(99);

      check('0 命不画生命点', r0.arcs === 0, 'arcs=' + r0.arcs);
      check('3 命画 3 个点', r3.arcs === 3, 'arcs=' + r3.arcs);
      check('7 命画 7 个点', r7.arcs === 7, 'arcs=' + r7.arcs);
      check('8 命画 7 个点并显示 +1', r8.arcs === 7 && r8.texts.includes('+1'),
            `arcs=${r8.arcs} texts=${r8.texts.join('|')}`);
      check('12 命画 7 个点并显示 +5', r12.arcs === 7 && r12.texts.includes('+5'),
            `arcs=${r12.arcs} texts=${r12.texts.join('|')}`);
      check('99 命显示 +92', r99.arcs === 7 && r99.texts.includes('+92'),
            `arcs=${r99.arcs} texts=${r99.texts.join('|')}`);
      check('3 命时不显示 +N', !r3.texts.some(t => /^\+\d+$/.test(t)), r3.texts.join('|'));

      // 无限生命走 ∞ 分支，不画生命点
      {
        const S = $.snap();
        S.G.infinite = true; S.G.practice = true; S.G.state = 2;
        arcs = 0; texts.length = 0;
        $.drawHUD();
        check('无限生命显示 ∞ 而不画生命点', arcs === 0 && texts.includes('∞'),
              `arcs=${arcs} texts=${texts.join('|')}`);
        S.G.infinite = false; S.G.practice = false;
      }

      // 复原 ctx
      for (const m of METHODS) if (savedM[m]) c2[m] = savedM[m];
      c2.fillText = savedFillText;
      $.newGame();
    }
    /* ================ 16. 开新局二次确认（防误触） ================ */
    section('开新局二次确认（空格不会误删存档）');
    {
      for (const k of Object.keys(store)) delete store[k];

      // ---- 有存档时的确认流程 ----
      $.newGame();
      $.launch();
      frames(120, { steer:true, keepAlive:true });
      const saveScore = $.snap().G.score;
      const saveLevel = $.snap().G.level;
      const savedRaw = store[$.SAVE_KEY];
      check('已有存档（前置条件）', $.hasSave() === true && saveScore > 0, 'score=' + saveScore);

      // 回到标题页
      $.snap().G.state = 0;

      // 第一次请求：只进入确认态，绝不动存档
      $.requestNewGame();
      check('第一次按空格只进入确认态', $.snap().G.confirmNew === true);
      check('确认态下存档原封不动', store[$.SAVE_KEY] === savedRaw,
            '存档被改动了');
      check('确认态下没有开新局（分数/关卡未变）',
            $.snap().G.score === saveScore && $.snap().G.level === saveLevel,
            `score=${$.snap().G.score} level=${$.snap().G.level}`);
      check('确认态下 state 仍是标题页', $.snap().G.state === 0, 'state=' + $.snap().G.state);

      // 可以取消
      $.cancelConfirm();
      check('取消后退出确认态且存档完好', $.snap().G.confirmNew === false && store[$.SAVE_KEY] === savedRaw);

      // 再请求一次，然后确认
      $.requestNewGame();
      check('可再次进入确认态', $.snap().G.confirmNew === true);
      $.requestNewGame();
      check('第二次确认后才真的开新局', $.snap().G.confirmNew === false && $.snap().G.state === 1,
            `confirm=${$.snap().G.confirmNew} state=${$.snap().G.state}`);
      check('新局分数归零、生命重置', $.snap().G.score === 0 && $.snap().G.lives === 3,
            `score=${$.snap().G.score} lives=${$.snap().G.lives}`);
      check('存档已换成新局的', store[$.SAVE_KEY] !== savedRaw && $.saveInfo().score === 0);

      // ---- 无存档时不应有确认步骤（第一次就开局） ----
      for (const k of Object.keys(store)) delete store[k];
      $.snap().G.state = 0;
      check('无存档时 hasSave=false', $.hasSave() === false);
      $.requestNewGame();
      check('无存档时一次按键直接开局', $.snap().G.confirmNew === false && $.snap().G.state === 1,
            `confirm=${$.snap().G.confirmNew} state=${$.snap().G.state}`);

      // ---- 过关态/结束态也不能绕过确认 ----
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
      $.launch();
      frames(60, { steer:true, keepAlive:true });
      const raw2 = store[$.SAVE_KEY];
      $.snap().G.state = S_OVER;
      $.requestNewGame();
      check('GAME OVER 界面按空格同样先确认', $.snap().G.confirmNew === true && store[$.SAVE_KEY] === raw2,
            'confirm=' + $.snap().G.confirmNew);
      $.requestNewGame();
      check('确认后从 GAME OVER 开新局', $.snap().G.state === 1 && $.snap().G.confirmNew === false);

      // ---- 读到存档后确认态必须清掉，避免误开局 ----
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
      $.launch();
      frames(60, { steer:true, keepAlive:true });
      const raw3 = store[$.SAVE_KEY];
      $.snap().G.state = 0;
      $.requestNewGame();
      check('进入确认态', $.snap().G.confirmNew === true);
      store[$.SAVE_KEY] = raw3;
      $.loadProgress();
      check('读档后确认态被清除', $.snap().G.confirmNew === false);
      check('读档后 state 不是标题页（不会被误当成开局）', $.snap().G.state !== 0, 'state=' + $.snap().G.state);

      // ---- 选关界面会清掉确认态 ----
      $.newGame();
      $.snap().G.state = 0;
      $.requestNewGame();
      $.startSelect();
      check('进入选关界面后确认态被清除', $.snap().G.confirmNew === false);

      // ---- 通过真实 keydown 事件走一遍分发逻辑（内部函数单测覆盖不到这里） ----
      {
        for (const k of Object.keys(store)) delete store[k];
        $.newGame();
        $.launch();
        frames(90, { steer:true, keepAlive:true });
        const rawK = store[$.SAVE_KEY];
        $.snap().G.state = 0;                      // 标题页
        const titleState = () => $.snap().G.state;

        // 空格的分布：第一次请求确认、第二次真开局
        $.pressKey(' ');
        check('[键盘] 第一次空格进入确认态且未开局',
              $.snap().G.confirmNew === true && titleState() === 0 && store[$.SAVE_KEY] === rawK,
              `confirm=${$.snap().G.confirmNew} state=${titleState()}`);
        $.pressKey('Escape');
        check('[键盘] Esc 取消确认，且没有把标题页切走',
              $.snap().G.confirmNew === false && titleState() === 0,
              `confirm=${$.snap().G.confirmNew} state=${titleState()}`);

        $.pressKey(' ');
        check('[键盘] 再次空格重新进入确认态', $.snap().G.confirmNew === true);
        $.pressKey('r');
        check('[键盘] R 取消确认并读档（不会误开局）',
              $.snap().G.confirmNew === false && titleState() !== 0,
              `confirm=${$.snap().G.confirmNew} state=${titleState()}`);

        // 回到标题页，用空格确认开局；第二次空格前先验证存档未被改
        for (const k of Object.keys(store)) delete store[k];
        $.newGame();
        $.launch();
        frames(90, { steer:true, keepAlive:true });
        const rawK2 = store[$.SAVE_KEY];
        $.snap().G.state = 0;
        $.pressKey(' ');
        check('[键盘] 确认态下存档未被提前覆盖', store[$.SAVE_KEY] === rawK2);
        $.pressKey(' ');
        check('[键盘] 第二次空格真正开新局',
              $.snap().G.confirmNew === false && titleState() === 1 && $.snap().G.score === 0,
              `confirm=${$.snap().G.confirmNew} state=${titleState()} score=${$.snap().G.score}`);

        // 其他按键应当取消确认（避免带着确认状态跳走）
        for (const k of Object.keys(store)) delete store[k];
        $.newGame();
        $.launch(); frames(60, { steer:true, keepAlive:true });
        $.snap().G.state = 0;
        $.pressKey(' ');
        $.pressKey('c');                           // C 会进选关，同时应清掉确认
        check('[键盘] 按 C 进选关时确认态被清掉',
              $.snap().G.confirmNew === false && $.snap().G.state === 8,
              `confirm=${$.snap().G.confirmNew} state=${$.snap().G.state}`);
        $.snap().G.state = 0;

        // Enter 与空格同源，也必须确认
        for (const k of Object.keys(store)) delete store[k];
        $.newGame();
        $.launch(); frames(60, { steer:true, keepAlive:true });
        $.snap().G.state = 0;
        $.pressKey('Enter');
        check('[键盘] Enter 同样先确认不直接开局',
              $.snap().G.confirmNew === true && titleState() === 0, 'state=' + titleState());
        $.pressKey('Enter');
        check('[键盘] Enter 二次确认后开局', titleState() === 1 && $.snap().G.score === 0);
      }

      // 收尾
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
    }
    /* ================ 17. 存档码（跨设备） ================ */
    section('存档码：导出 / 导入 / 抗损坏');
    {
      for (const k of Object.keys(store)) delete store[k];

      // ---- 造一局有特征的局面 ----
      $.newGame();
      $.launch();
      frames(200, { steer:true, keepAlive:true });
      $.snap().G.level = 3; $.loadLevel(3); $.snap().G.level = 3;
      $.snap().G.score = 7777; $.snap().G.lives = 4;
      const B = $.snap().bricks.filter(b => !b.solid);
      B[0].dead = true; B[2].dead = true;
      if (B[1] && B[1].max > 1) B[1].hp = 2;
      frames(2, { steer:true });

      // ---- 导出（expect 必须紧贴导出时刻取值，中间不能再推进帧） ----
      const src = $.snap();
      const brokenNow = src.bricks.filter(b => b.dead).length;
      const expect = {
        level: src.G.level, score: src.G.score, lives: src.G.lives,
        broken: brokenNow,
        // 被击破的砖不会进存档，读档后只还原存活砖
        bricks: src.bricks.length - brokenNow,
        hp: src.bricks.reduce((n,b)=> n + (b.dead ? 0 : b.hp), 0),
        paddleW: src.paddle.w,
      };
      check('导出前确实有砖被击破（否则覆盖不到这个分支）', brokenNow > 0, 'broken=' + brokenNow);
      const code = $.encodeShareCode();
      check('能导出行存档码', typeof code === 'string' && code.length > 20, 'len=' + (code || '').length);
      check('存档码带版本前缀与校验段', /^NB1-[0-9a-z]{4}-[A-Za-z0-9+/=]+$/.test(code), code ? code.slice(0, 24) + '…' : 'null');
      check('存档码只含可安全传输的字符', /^[A-Za-z0-9+/=_-]+$/.test(code), '含异常字符');
      check('存档码长度适中（便于聊天工具传输）', code.length < 8000, 'len=' + code.length);

      // 导出不应改动当前局面
      {
        const now = $.snap();
        check('导出是只读操作，不改变局面',
              now.G.score === expect.score &&
              now.bricks.length - now.bricks.filter(b => b.dead).length === expect.bricks,
              `score=${now.G.score} 存活=${now.bricks.length - now.bricks.filter(b=>b.dead).length}`);
      }

      // ---- 模拟"另一台设备"：清空本机存档，再导入 ----
      for (const k of Object.keys(store)) delete store[k];
      check('清空后本机没有存档', $.hasSave() === false);

      const res = $.decodeShareCode(code);
      check('导入成功', res.ok === true, JSON.stringify(res));
      check('导入后本机有了存档', $.hasSave() === true);

      const ok2 = $.loadProgress();
      const got = $.snap();
      check('导入的存档可以正常读档', ok2 === true);
      check('跨设备后关卡一致', got.G.level === expect.level, `${got.G.level} vs ${expect.level}`);
      check('跨设备后分数一致', got.G.score === expect.score, `${got.G.score} vs ${expect.score}`);
      check('跨设备后生命一致', got.G.lives === expect.lives, `${got.G.lives} vs ${expect.lives}`);
      check('跨设备后挡板宽度一致', got.paddle.w === expect.paddleW, `${got.paddle.w} vs ${expect.paddleW}`);
      check('跨设备后剩余砖块数一致', got.bricks.length === expect.bricks, `${got.bricks.length} vs ${expect.bricks}`);
      check('跨设备后受损砖血量一致', got.bricks.reduce((n,b)=>n+b.hp,0) === expect.hp,
            `${got.bricks.reduce((n,b)=>n+b.hp,0)} vs ${expect.hp}`);

      // ---- 真实粘贴流程：走 keydown 与 paste 事件 ----
      {
        const code2 = $.encodeShareCode();
        for (const k of Object.keys(store)) delete store[k];
        $.pressKey('i');
        check('[键盘] I 打开导入界面', $.importUI.active === true);
        check('导入界面初始为空', $.importUI.text === '');
        // 模拟粘贴
        global.__paste(code2);
        check('粘贴后内容进入输入框', $.importUI.text === code2, 'len=' + $.importUI.text.length);
        $.pressKey('Enter');
        check('回车完成导入', $.hasSave() === true);
        $.loadProgress();
        check('粘贴导入后局面正确', $.snap().G.score === expect.score && $.snap().G.level === expect.level,
              `score=${$.snap().G.score} level=${$.snap().G.level}`);
      }

      // ---- 手动逐字符输入 ----
      {
        const code3 = $.encodeShareCode();
        for (const k of Object.keys(store)) delete store[k];
        $.openImport();
        for (const ch of code3) $.pressKey(ch);
        check('逐字符手输能凑齐存档码', $.importUI.text === code3, `len=${$.importUI.text.length} vs ${code3.length}`);
        $.pressKey('Backspace');
        check('退格能删除一个字符', $.importUI.text.length === code3.length - 1);
        for (const ch of code3.slice(-1)) $.pressKey(ch);
        $.pressKey('Enter');
        check('手输导入成功', $.hasSave() === true);
        $.loadProgress();
        check('手输导入后局面正确', $.snap().G.score === expect.score);
      }

      // ---- E 打开导出界面 ----
      {
        $.newGame();
        check('有存档时 E 能打开导出界面（返回非空代码）', (() => {
          const c = $.encodeShareCode();
          $.openShare();
          const opened = $.shareUI.active && $.shareUI.code.length > 0;
          $.closeShare();
          return opened && c.length > 0;
        })());
        check('导出界面关闭后状态复位', $.shareUI.active === false && $.shareUI.code === '');
      }

      // ---- 抗损坏：各种坏存档码都必须被拒绝，且不破坏本机存档 ----
      $.newGame();
      const goodRaw = store[$.SAVE_KEY];
      const c0 = $.encodeShareCode();
      const badCodes = [
        ['空字符串', ''],
        ['纯空白', '   \n  '],
        ['随机文字', 'hello world'],
        ['前缀不对', 'NB2-abcd-' + c0.split('-').slice(2).join('-')],
        ['缺校验段', 'NB1-' + c0.split('-').slice(2).join('-')],
        ['校验错', 'NB1-zzzz-' + c0.split('-').slice(2).join('-')],
        ['body 被截断', c0.slice(0, Math.floor(c0.length * 0.7))],
        ['body 被改字符', c0.slice(0, c0.length - 6) + 'AAAAAA'],
        ['校验段乱改', 'NB1-' + (c0.split('-')[1] === 'aaaa' ? 'bbbb' : 'aaaa') + '-' + c0.split('-').slice(2).join('-')],
      ];
      let rejected = 0;
      for (const [name, bad] of badCodes){
        let r, threw = false;
        try { r = $.decodeShareCode(bad); } catch(e){ threw = true; }
        const good = !threw && r && r.ok !== true && typeof r.error === 'string';
        if (good) rejected++;
        else check(`坏存档码应被拒绝: ${name}`, false, `threw=${threw} res=${JSON.stringify(r)}`);
      }
      check(`9 种坏存档码全部被安全拒绝`, rejected === badCodes.length, `rejected=${rejected}/${badCodes.length}`);
      check('喂坏存档码后本机存档未被破坏', store[$.SAVE_KEY] === goodRaw);

      // 导入失败后仍可正常游玩
      $.launch();
      frames(60, { steer:true, keepAlive:true });
      check('坏存档码之后游戏仍可正常游玩', $.snap().G.state === 2 || $.snap().G.state === 1);

      // ---- 存档码必须包含校验，单字符改动就能发现 ----
      {
        const c = $.encodeShareCode();
        let caught = 0;
        for (let i = 0; i < 12; i++){
          const pos = Math.floor(c.length * (0.15 + 0.7 * i / 12));
          const ch = c[pos];
          const alt = ch === 'A' ? 'B' : 'A';
          const mutated = c.slice(0, pos) + alt + c.slice(pos + 1);
          const r = $.decodeShareCode(mutated);
          if (!r.ok) caught++;
        }
        check('12 处随机单字符损坏全部被检出', caught === 12, `检出 ${caught}/12`);
      }

      // 收尾
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
    }
    /* ================ 18. 关卡提示文案 ================ */
    section('关卡提示：显示第几关必须正确');
    {
      // 用户报的问题：第 4 关开局显示"第 3 关"（用了 0 基关卡号 n）
      for (let i = 0; i < $.selectItems.length; i++){
        $.startSelect();
        $.selectKey(String(i + 1));                 // 数字键直选第 i+1 项
        const S = $.snap();
        const want = S.G.level + 1;                 // 1 基关卡号
        // 第 1 关有意显示上手说明（新人更需要它），其余关卡显示关卡号
        const okText = S.G.msg.includes('第 ' + want + ' 关') || (want === 1 && S.G.msg.includes('SPACE'));
        check(`选第 ${i + 1} 项后关卡提示正确（第 ${want} 关）`, okText, `msg="${S.G.msg}" level=${S.G.level}`);
        check(`选第 ${i + 1} 项后不出现错误的第 ${want - 1} 关`,
              want === 1 || !S.G.msg.includes('第 ' + (want - 1) + ' 关'), `msg="${S.G.msg}"`);
      }
      // 数字与提示必须一一对应（第 4 项 -> 第 4 关）
      $.startSelect();
      $.selectKey('4');
      check('数字键 4 进入的是第 4 关且提示为第 4 关',
            $.snap().G.level === 3 && $.snap().G.msg.includes('第 4 关'),
            `level=${$.snap().G.level} msg="${$.snap().G.msg}"`);

      // 过关推进后提示也要对
      $.startSelect(); $.selectKey('1');
      $.launch(); frames(2, {});
      $.snap().bricks.forEach(b => { if (!b.solid) b.dead = true; });
      frames(2, {});
      check('清关后进入 LEVEL 态', $.snap().G.state === 4);
      $.loadLevel(++$.snap().G.level);              // = nextLevel() 的行为
      check('进入第 2 关时提示为第 2 关',
            $.snap().G.level === 1 && $.snap().G.msg.includes('第 2 关'),
            `level=${$.snap().G.level} msg="${$.snap().G.msg}"`);

      // 第 1 关保留上手说明，但不得出现"第 0 关"
      $.newGame();
      check('第 1 关显示上手说明且不出现"第 0 关"',
            $.snap().G.msg.length > 0 && !/第 0 关/.test($.snap().G.msg), `msg="${$.snap().G.msg}"`);

      // 读档后提示的关卡号也要对（loadProgress 会再调一次 loadLevel）
      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
      $.loadLevel(3); $.snap().G.level = 3;
      $.snap().G.state = 2;
      $.saveProgress(false);
      const raw = store[$.SAVE_KEY];
      $.loadLevel(6);
      store[$.SAVE_KEY] = raw;
      $.loadProgress();
      check('读档后提示的关卡号正确',
            $.snap().G.level === 3 && $.snap().G.msg.includes('第 4 关'),
            `level=${$.snap().G.level} msg="${$.snap().G.msg}"`);
      // "已还原"是有用的：读档回来时说明击破的砖是从存档恢复的，而不是这关重开了
      check('读档提示标注状态（已读档/已还原）',
            /已读档|已还原/.test($.snap().G.msg), `msg="${$.snap().G.msg}"`);
    }

    /* ================ 19. 提示语纯净度 ================ */
    section('提示语保持简短（不解释机制）');
    {
      const dropBall = () => {
        $.snap().balls.forEach(b => { b.stuck = false; b.y = 700; b.vy = 500; });
        frames(2, {});
      };
      for (const k of Object.keys(store)) delete store[k];
      $.newGame(); $.launch(); frames(3, {});
      $.snap().G.lives = 3;
      dropBall();
      check('掉命提示只有"剩余 N 条命"', $.snap().G.msg === '剩余 2 条命', `msg="${$.snap().G.msg}"`);
      check('掉命提示不含"挡板加宽保留"等说明', !$.snap().G.msg.includes('保留'), `msg="${$.snap().G.msg}"`);

      $.newGame(); $.launch(); frames(3, {});
      $.applyPower(P('wide'));
      $.snap().G.lives = 3;
      dropBall();
      check('加宽后掉命，提示仍然简短（宽度照旧保留）',
            $.snap().G.msg === '剩余 2 条命' && $.snap().paddle.w > 130,
            `msg="${$.snap().G.msg}" w=${$.snap().paddle.w}`);

      // 练习模式重发球提示
      $.startSelect();
      if (!$.snap().G.infinite) $.selectKey('i');
      $.selectKey('1');
      $.launch(); frames(3, {});
      dropBall();
      check('练习模式重发球提示简短', $.snap().G.msg === '重新发球', `msg="${$.snap().G.msg}"`);
      check('练习模式重发球提示不含"无限生命"',
            !$.snap().G.msg.includes('无限生命'), `msg="${$.snap().G.msg}"`);
      $.setInfinite(false);

      // 选关进入某关时，提示里不该再堆"随机生成/关卡名/无限生命"这些后缀
      $.startSelect(); $.selectKey('6');
      check('随机关提示不含"随机生成"后缀', !$.snap().G.msg.includes('随机生成'), `msg="${$.snap().G.msg}"`);
      $.startSelect(); $.selectKey('4');
      check('设计关卡提示不含关卡名后缀', !$.snap().G.msg.includes('要塞'), `msg="${$.snap().G.msg}"`);

      // 吃道具时不该在顶部再弹一条：挡板上方已经有道具名的浮动字了
      $.newGame(); $.launch(); frames(3, {});
      {
        $.snap().G.msg = '';                       // 清掉开局提示干扰
        const nFloat = $.snap().floats.length;
        $.applyPower(P('wide'));
        check('吃道具只出浮动字，不再重复弹顶部提示',
              $.snap().G.msg === '' && $.snap().floats.length > nFloat,
              `msg="${$.snap().G.msg}" floats=${$.snap().floats.length}`);
      }

      for (const k of Object.keys(store)) delete store[k];
      $.newGame();
    }
  } catch (e){
    fail++;
    failures.push('测试执行异常: ' + e.message);
    say('  测试执行异常: ' + e.stack);
  } finally {
    for (const k of MODULES){
      if (saved[k] === undefined) delete global[k];
      else global[k] = saved[k];
    }
  }

  /* ---------------- 汇总 ---------------- */
  say('\n================ 汇总 ================');
  say(`通过 ${pass} 项，失败 ${fail} 项`);
  if (failures.length) say('失败项:\n  - ' + failures.join('\n  - '));
  say('\n结论: ' + (fail === 0 ? '全部 PASS' : 'FAIL'));
  return fail === 0;
}

module.exports = { run };

if (require.main === module){
  const src = fs.readFileSync(process.argv[2], 'utf8');
  process.exit(run(src) ? 0 : 1);
}
