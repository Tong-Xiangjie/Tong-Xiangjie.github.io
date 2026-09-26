import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/leftband.cjs'
s = io.open(p, encoding='utf-8').read()

old = """    const marks = Array.from(face.querySelectorAll('.as-mark-left')).map(CY);"""
new = """    /* 左侧定标带第一块是「缺考框」用的，不属于网格，单独校验 */
    const allMarks = Array.from(face.querySelectorAll('.as-mark-left')).map(CY);
    const absentCy = (window.AS.builders && window.AS.builders.page &&
      window.AS.builders.page.SPECIAL) ? null : null;
    const marks = allMarks.filter(m => Math.abs(m - allMarks[0]) > 1e-6);"""
assert old in s
s = s.replace(old, new, 1)

old2 = """             rowOffsets: offs, nLines: nLines, expect: expect, marks: marks,
             bubbles: bubbles, nums: nums, lh2: lh };"""
new2 = """             rowOffsets: offs, nLines: nLines, expect: expect, marks: marks,
             absentCy: allMarks[0], markCount: allMarks.length,
             bubbles: bubbles, nums: nums, lh2: lh };"""
assert old2 in s
s = s.replace(old2, new2, 1)

old3 = """    console.log('选择题行数 nLines = %s   左侧定位点总数 = %d', d.nLines, d.marks.length);
    const want = d.nLines * d.rowOffsets.length + (d.nLines - 1);
    console.log('▶ 数量 = nLines·%d + (nLines−1) = %d   %s',
      d.rowOffsets.length, want, d.marks.length === want ? 'OK' : '** 不符 **');"""
new3 = """    console.log('选择题行数 nLines = %s   左侧定位点总数 = %d（含缺考框 1 个）',
      d.nLines, d.markCount);
    const want = d.nLines * d.rowOffsets.length + (d.nLines - 1);
    console.log('▶ 网格定位点数量 = nLines·%d + (nLines−1) = %d，实测 %d   %s',
      d.rowOffsets.length, want, d.marks.length,
      d.marks.length === want ? 'OK' : '** 不符 **');
    console.log('▶ 缺考框定位点 cy = %s（网格外，不计入）', d.absentCy);"""
assert old3 in s
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
