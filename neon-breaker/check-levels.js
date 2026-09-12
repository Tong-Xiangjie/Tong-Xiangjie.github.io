// 关卡布局自检：调用游戏里真正的 pattern()，逐格校验并打印 ASCII 预览
// 可独立运行: node check-levels.js <game.js>   或由 run-tests.js 以 run(gameSrc) 调用
const fs = require('fs');

function run(gameSrc){
  const MODULES = ['document','window','localStorage','devicePixelRatio','addEventListener',
                   'requestAnimationFrame','performance','AudioContext','webkitAudioContext','$GAME'];
  const saved = {};
  for (const k of MODULES) saved[k] = global[k];

  function fakeCtx(){
    return new Proxy({}, { get: (t,k) => String(k) === 'measureText' ? (() => ({ width: 10 }))
                                  : String(k).startsWith('create') ? (() => ({ addColorStop(){} }))
                                  : (() => {}) });
  }
  const canvas = { width:0, height:0, style:{}, getContext(){ return fakeCtx(); },
    getBoundingClientRect: () => ({ left:0, top:0, width:960, height:600 }), addEventListener(){}, focus(){} };
  const store = {};
  global.document = {
    getElementById: id => id === 'cv' ? canvas : (id === 'fsBtn' ? { textContent:'', addEventListener(){}, style:{} } : null),
    createElement: () => canvas,
    body: { appendChild(){} },
    addEventListener(){},
    fullscreenElement: null,
    documentElement: { requestFullscreen(){ return { catch(){} }; } },
    exitFullscreen(){ return { catch(){} }; },
  };
  global.window = global;
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k,v) => { store[k] = v; } };
  global.devicePixelRatio = 1;
  global.addEventListener = () => {};
  global.requestAnimationFrame = () => 0;
  global.performance = { now: () => 0 };
  delete global.AudioContext; delete global.webkitAudioContext;

  let bad = 0;
  try {
    (0, eval)(gameSrc + '\nglobalThis.$GAME = { pattern, loadLevel, newGame, snap: () => ({ bricks, G }) };');
    const $ = global.$GAME;

    /* 砖块类型：0 空 · 1..5 普通 · -1 实心 · 6 裂纹 · 10~13 转弯 · 20/21 传送门 · 9 金砖 */
    const LEGAL = [-1, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 20, 21];
    const isBreak  = v => (v >= 1 && v <= 5) || v === 6 || (v >= 10 && v <= 13);
    const isCrack  = v => v === 6;
    const isTurn   = v => v >= 10 && v <= 13;
    const isPortal = v => v === 20 || v === 21;
    const GLYPH = { '-1':'x', '0':'·', '6':'c', '9':'★', '10':'▲', '11':'▶', '12':'▼', '13':'◀', '20':'P', '21':'Q' };
    const glyph = v => GLYPH[String(v)] !== undefined ? GLYPH[String(v)] : String(v);

    console.log('关卡图案校验（1-5 血量 · x 实心 · ★ 金砖 · c 裂纹 · ▲▶▼◀ 转弯 · P/Q 传送门 · · 空位）');
    for (let n = 0; n <= 30; n++){
      const g = $.pattern(n).grid;
      const w = new Set(g.map(r => r.length));
      const flat = g.flat();
      const illegal = flat.filter(v => !LEGAL.includes(v) || Number.isNaN(v));
      const cnt = {
        breakable: flat.filter(isBreak).length,
        solid: flat.filter(v => v === -1).length,
        gold: flat.filter(v => v === 9).length,
        crack: flat.filter(isCrack).length,
        turn: flat.filter(isTurn).length,
        portal: flat.filter(isPortal).length,
      };
      // 传送门必须成对出现，落单的门是死的
      const portalOk = cnt.portal === 0 || cnt.portal === 2;
      const ok = w.size === 1 && w.has(10) && illegal.length === 0 && cnt.breakable > 0 && portalOk;
      if (!ok) bad++;
      const extra = [cnt.crack && `裂纹${cnt.crack}`, cnt.turn && `转弯${cnt.turn}`, cnt.portal && `门${cnt.portal}`]
                      .filter(Boolean).join(' ');
      console.log(`  关卡${String(n+1).padStart(2)}: ${String(g.length).padStart(2)}行 宽${[...w].join('/')} ` +
                  `可破坏${String(cnt.breakable).padStart(3)} 实心${String(cnt.solid).padStart(2)} 金砖${String(cnt.gold).padStart(2)}` +
                  `${extra ? '  ' + extra : ''} 非法${illegal.length} ${ok ? 'ok' : 'FAIL'}` +
                  `${portalOk ? '' : ' (传送门不成对)'}`);
      if (n < 5) g.forEach(r => console.log('          ' + r.map(glyph).join(' ')));
    }

    console.log('\nloadLevel 落地校验（设计关卡逐格比对；随机关卡每次生成不同，只查自洽性）:');
    for (let n = 0; n < 12; n++){
      $.newGame(); $.loadLevel(n);
      const { bricks } = $.snap();
      const designed = n < 5;                       // 0..4 是设计关卡，其余为随机生成
      const nan = bricks.filter(b => !Number.isFinite(b.hp) || !Number.isFinite(b.x) || !Number.isFinite(b.y)).length;
      const realSolid  = bricks.filter(b => b.solid).length;
      const realPortal = bricks.filter(b => b.portal).length;
      const realTurn   = bricks.filter(b => b.turn).length;
      const realCrack  = bricks.filter(b => b.crack).length;
      // 传送门必须成对，落单的门是死的
      const portalPairOk = realPortal === 0 || realPortal === 2;
      // 转弯砖必须有合法方向向量；裂纹砖必须有合理阈值
      const badTurn  = bricks.filter(b => b.turn && !(Array.isArray(b.dir) && b.dir.length === 2)).length;
      const badCrack = bricks.filter(b => b.crack && !(b.crackAt >= 1 && b.hp >= b.crackAt)).length;

      let gridInfo = '', gridOk = true;
      if (designed){
        const grid = $.pattern(n).grid;
        const cells = grid.flat().filter(v => v !== 0).length;
        const gridSolid  = grid.flat().filter(v => v === -1).length;
        const gridPortal = grid.flat().filter(isPortal).length;
        gridOk = bricks.length === cells && realSolid === gridSolid && realPortal === gridPortal;
        gridInfo = `期望${String(cells).padStart(3)}块 实心${realSolid}/${gridSolid} 门${realPortal}/${gridPortal}`;
      } else {
        gridInfo = `实际${String(bricks.length).padStart(3)}块 实心${String(realSolid).padStart(2)} 门${realPortal} 转弯${realTurn} 裂纹${realCrack}`;
      }
      const ok = nan === 0 && bricks.length > 0 && portalPairOk && badTurn === 0 && badCrack === 0 && gridOk;
      if (!ok) bad++;
      console.log(`  关卡${String(n+1).padStart(2)}: ${gridInfo} 坏转弯${badTurn} 坏裂纹${badCrack} NaN=${nan}` +
                  `${portalPairOk ? '' : ' 传送门不成对'} ${ok ? 'ok' : 'FAIL'}`);
    }
  } finally {
    for (const k of MODULES){
      if (saved[k] === undefined) delete global[k];
      else global[k] = saved[k];
    }
  }

  console.log('\n结论:', bad === 0 ? '全部 PASS' : bad + ' 项 FAIL');
  return bad === 0;
}

module.exports = { run };

if (require.main === module){
  const src = fs.readFileSync(process.argv[2], 'utf8');
  process.exit(run(src) ? 0 : 1);
}
