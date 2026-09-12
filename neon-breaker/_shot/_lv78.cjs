// 把玩家给的存档码翻成游戏内部的 tile 编码，方便搭成可复现的盘面
const b64 = 'eyJ2IjoxLCJ0cyI6MTc4OTIxNTIzOTQ5NCwibGV2ZWwiOjc4LCJzY29yZSI6NjA0MDQ2LCJiZXN0Ijo2MDQwNDYsImxpdmVzIjo5NywiaW5maW5pdGUiOmZhbHNlLCJwcmFjdGljZSI6ZmFsc2UsInBhZGRsZVciOjI2MCwicGxheVRpbWUiOjEzMDc1LCJzdGF0ZSI6MSwiYnJpY2tzIjoiMDoxLDE6MSwyOjEsMzoxLDQ6MSw1OjEsNjoxLDc6NCw4OjEsOToxLDEwOjEsMTE6MSwxMjoxLDEzOjQsMTQ6MSwxNToxLDE2OjEiLCJncmlkIjpbIjAtMDAtMDAwMDAiLCIwMDAtMDAwMC0wIiwiLS0wMDAwLTA2LSIsIi0tMC0wMDAtNjAiLCIwMDAwLTAwMC0tIl0sImJhbGxzIjpbXX0=';
const d = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
console.log('level=' + d.level, 'lives=' + d.lives, 'playTime=' + d.playTime + 's',
            'score=' + d.score, 'paddleW=' + d.paddleW, 'state=' + d.state, 'balls=' + JSON.stringify(d.balls));
const rows = d.grid.map(s => [...s].map(ch => ch === '-' ? -1 : parseInt(ch, 36)));
console.log('内部编码（可直接喂给 loadLevel）:');
rows.forEach(r => console.log('  [' + r.join(', ') + ']'));

const cells = [];
rows.forEach((r, ri) => r.forEach((v, ci) => { if (v !== 0) cells.push([ri, ci, v]); }));
const solids = cells.filter(c => c[2] === -1);
const alive = cells.filter(c => c[2] !== -1);
console.log('非空格子 ' + cells.length + '（实心 ' + solids.length + ' / 可破坏 ' + alive.length + '）');

const hp = {};
d.bricks.split(',').forEach(kv => { const [i, h] = kv.split(':'); hp[+i] = parseInt(h, 36); });
alive.forEach(c => {
  const i = cells.findIndex(x => x[0] === c[0] && x[1] === c[1]);
  console.log('  可破坏砖 行' + c[0] + '列' + c[1] + ' 类型' + c[2] + ' 血量' + hp[i]);
});

// 画出来
const pic = rows.map((r, ri) => '  行' + ri + '  ' + r.map(v => v === -1 ? '██' : v === 0 ? ' ·' : ' ' + v).join(''));
console.log('\n盘面：');
pic.forEach(p => console.log(p));
console.log('       ' + [...'0123456789'].map(c => ' ' + c).join(''));
