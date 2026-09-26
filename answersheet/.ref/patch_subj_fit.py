import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/subj_fit.mjs'
s = io.open(p, encoding='utf-8').read()

old = """    return { lines: ${lines}, outer: out, hd, bd, tb, tr, td, HEAD_H: hm, cellPad: cp,
             subjChrome: window.AS.paginator.SUBJ_BOX_CHROME,
             modelH: window.AS.subject.itemHeight(${lines}, 7.7) };"""
new = """    const oel = card.querySelector('.as-subject-outer');
    const ocs = getComputedStyle(oel);
    const hel = card.querySelector('.as-subject-header');
    const hcs = getComputedStyle(hel);
    const tbl = card.querySelector('.as-subject-inner-table');
    const tcs = getComputedStyle(tbl);
    const d = card.querySelector('.as-subject-inner-table td');
    const dcs = getComputedStyle(d);
    return { lines: ${lines}, outer: out, hd, bd, tb, tr, td, HEAD_H: hm, cellPad: cp,
             subjChrome: window.AS.paginator.SUBJ_BOX_CHROME,
             css: {
               outerPadTop: ocs.paddingTop, outerPadBottom: ocs.paddingBottom,
               outerBorderTop: ocs.borderTopWidth, outerBorderBottom: ocs.borderBottomWidth,
               hdrH: hcs.height, hdrMb: hcs.marginBottom, hdrPadTop: hcs.paddingTop,
               tblBorderTop: tcs.borderTopWidth, tblBorderBottom: tcs.borderBottomWidth,
               tblBorderSpacing: tcs.borderSpacing, tblCollapse: tcs.borderCollapse,
               tdPadTop: dcs.paddingTop, tdPadBottom: dcs.paddingBottom,
               tdBorderTop: dcs.borderTopWidth, tdBorderBottom: dcs.borderBottomWidth
             },
             modelH: window.AS.subject.itemHeight(${lines}, 7.7) };"""
assert old in s, 'a1'
s = s.replace(old, new, 1)

old2 = """  // 反解：outerH - subjChrome = a + b*lines"""
new2 = """  if (rows[0] && rows[0].css) {
    console.log('\\n--- 第 1 组（%d 行）的 CSS 计算值 ---', rows[0].lines);
    Object.keys(rows[0].css).forEach(k => console.log('  %s = %s', k.padEnd(18), rows[0].css[k]));
    const c = rows[0].css;
    const px2mm = 25.4 / 96;
    const sum = ['outerBorderTop','outerPadTop','hdrH','hdrMb','tblBorderTop','tdBorderTop',
                 'tdPadTop','tdPadBottom','tblBorderBottom','outerPadBottom','outerBorderBottom']
      .reduce((a, k) => a + (parseFloat(c[k]) || 0) * px2mm, 0);
    const outerH = rows[0].outer.b - rows[0].outer.t;
    console.log('  CSS 各段之和（不含作答区）= %s', sum.toFixed(3));
    console.log('  红框高 − 作答区 − 各行高和 = %s', (outerH - (rows[0].bd.b - rows[0].bd.t)).toFixed(3));
  }

  // 反解：outerH - subjChrome = a + b*lines"""
assert old2 in s, 'a2'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
