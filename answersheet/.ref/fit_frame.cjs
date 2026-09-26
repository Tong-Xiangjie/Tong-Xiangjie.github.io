/* 用两组实测数据解「游标 → 红框底」的线性式：
     红框底 = cursor + A + R × rows      （R = 本面非选择题行数）
   数据来自 .ref/calib_cursor.cjs（S=0，即未下拉的稳定态）。 */
const data = [
  // [rows, cursor, frameBot]
  [1, 169.481, 167.583],
  [2, 241.967, 237.406],
  [3, 277.994, 270.760],
  [2, 269.290, 278.938],   // 12 选择 + 2 题
  [1, 194.759, 204.861],   // 12 选择 + 1 题
  [2, 276.828, 284.258],   // 40 选择 + 2 题
];

const n = data.length;
const sx = data.reduce((a, d) => a + d[0], 0);
const sy = data.reduce((a, d) => a + (d[2] - d[1]), 0);
const sxx = data.reduce((a, d) => a + d[0] * d[0], 0);
const sxy = data.reduce((a, d) => a + d[0] * (d[2] - d[1]), 0);
const R = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const A = (sy - R * sx) / n;
console.log('红框底 − cursor = A + R × rows');
console.log('  A =', A.toFixed(4), '  R =', R.toFixed(4));
console.log('\n残差：');
data.forEach(([rows, c, f]) => {
  const pred = c + A + R * rows;
  console.log('  rows=' + rows + '  cursor=' + c + '  实测 ' + f +
    '  预测 ' + pred.toFixed(3) + '  差 ' + (f - pred).toFixed(3));
});
console.log('\n目标下界 283.885');
const need = (rows, c) => 283.885 - (c + A + R * rows);
console.log('各配置需要的红框底位移 Δy：');
data.forEach(([rows, c]) => {
  console.log('  rows=' + rows + ' cursor=' + c + ' → Δy = ' + need(rows, c).toFixed(3) +
    ' → stretch = ' + (need(rows, c) / 0.75).toFixed(3));
});
