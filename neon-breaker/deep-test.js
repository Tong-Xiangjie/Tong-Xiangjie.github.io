// neon-breaker 深度测试：逐系统单测 + 长时间自动对局 + 渲染路径校验
// 可独立运行: node deep-test.js <game.js>   或由 run-tests.js 以 run(gameSrc) 调用
const fs = require('fs');

function run(src){
  /* ---------------- 假 DOM ---------------- */
  const MODULES = ['document','window','localStorage','devicePixelRatio','addEventListener',
                   'requestAnimationFrame','performance','AudioContext','webkitAudioContext','$GAME','__NB_DEBUG'];
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
  const canvas = {
    width: 0, height: 0, tabIndex: 0, style: {},
    getContext(){ if(!this._c){ this._c = fakeCtx(); this._c.canvas = this; } return this._c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
    addEventListener(){}, focus(){}, appendChild(){},
  };
  const store = {};
  global.document = { getElementById: id => (id === 'cv' ? canvas : null), createElement: () => canvas, body:{appendChild(){}} };
  global.window = global;
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k,v) => { store[k] = String(v); } };
  global.devicePixelRatio = 2;
  global.addEventListener = () => {};
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
    check('掉命后挡板宽度重置', $.snap().paddle.w === 130);

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
      check('飞行球速不超过设计上限 1000', minSpeed > 250 && maxSpeed <= 1000.5, `${Math.round(minSpeed)}~${Math.round(maxSpeed)}`);
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
