/* 检验假设：红框底 − 游标 的偏差由**游标的小数部分**（设备像素相位）决定。
   device px = 1/3.7795 mm = 0.2646mm。看 off 与 frac(cursor) 的关系。 */
const rows = [
  [0,1,6,154.071,152.171],[0,1,8,167.436,165.541],[0,1,10,182.836,180.941],
  [0,2,16,241.967,237.406],[0,3,19,277.994,270.760],
  [12,1,6,179.349,189.449],[12,1,8,194.759,204.861],[12,1,10,210.159,220.261],
  [12,2,16,269.290,278.392],
  [40,1,6,202.288,212.390],[40,1,8,217.698,227.802],[40,1,10,233.098,243.202],
  [40,2,14,276.828,284.254],
];
const PX = 1 / 3.7795275591;   // mm per device px
console.log('mm/devicePx =', PX.toFixed(6));
console.log('\n选择|行数| 游标 | cursor/PX | frac | 红框底 | off | off+2.5 | off/PX');
rows.forEach(([nc, nrows, lines, c, f]) => {
  const q = c / PX;
  const frac = q - Math.floor(q);
  const off = f - c;
  console.log(String(nc).padStart(4) + '|' + String(lines).padStart(4) + '|' +
    String(c).padStart(8) + '|' + q.toFixed(3).padStart(10) + '|' +
    frac.toFixed(3).padStart(6) + '|' + String(f).padStart(7) + '|' +
    off.toFixed(3).padStart(7) + '|' + (off + 2.5).toFixed(3).padStart(7) + '|' +
    (off / PX).toFixed(3).padStart(8));
});
