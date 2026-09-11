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
    const glyph = v => v === -1 ? 'x' : v === 9 ? '*' : v === 0 ? '.' : String(v);

    console.log('关卡图案校验（x=不可破坏  *=金砖  .=空位  数字=血量）');
    for (let n = 0; n <= 30; n++){
      const g = $.pattern(n).grid;
      const w = new Set(g.map(r => r.length));
      const flat = g.flat();
      const illegal = flat.filter(v => ![-1,0,1,2,3,4,5,9].includes(v) || Number.isNaN(v));
      const breakable = flat.filter(v => v > 0).length;
      const solid = flat.filter(v => v === -1).length;
      const gold = flat.filter(v => v === 9).length;
      const ok = w.size === 1 && w.has(10) && illegal.length === 0 && breakable > 0;
      if (!ok) bad++;
      console.log(`  关卡${String(n+1).padStart(2)}: ${String(g.length).padStart(2)}行 宽${[...w].join('/')} 可破坏${String(breakable).padStart(3)} 实心${String(solid).padStart(2)} 金砖${String(gold).padStart(2)} 非法${illegal.length} ${ok ? 'ok' : 'FAIL'}`);
      if (n < 5) g.forEach(r => console.log('          ' + r.map(glyph).join(' ')));
    }

    console.log('\nloadLevel 落地校验（图案格数 vs 实际砖块数，实心砖必须保留）:');
    for (let n = 0; n < 5; n++){
      $.newGame(); $.loadLevel(n);
      const { bricks } = $.snap();
      const nan = bricks.filter(b => !Number.isFinite(b.hp) || !Number.isFinite(b.x) || !Number.isFinite(b.y)).length;
      const gridBreakable = $.pattern(n).grid.flat().filter(v => v > 0).length;
      const gridSolid = $.pattern(n).grid.flat().filter(v => v === -1).length;
      const realSolid = bricks.filter(b => b.solid).length;
      const ok = nan === 0 && bricks.length === gridBreakable + gridSolid && realSolid === gridSolid;
      if (!ok) bad++;
      console.log(`  关卡${n+1}: 期望${gridBreakable + gridSolid}块(实心${gridSolid}) 实际${bricks.length}块(实心${realSolid}) NaN=${nan} ${ok ? 'ok' : 'FAIL'}`);
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
