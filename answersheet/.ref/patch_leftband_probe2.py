import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/leftband.cjs'
s = io.open(p, encoding='utf-8').read()

old = """    const expect = [];
    for (let li = 0; li < nLines; li++) {
      const base = Math.round((gtop + li * lh) * 1000) / 1000;
      if (li > 0) expect.push(Math.round((base + gapOff) * 1000) / 1000);
      offs.forEach(d => expect.push(Math.round((base + d) * 1000) / 1000));
    }"""
new = """    /* 期望值：每行 offs.length 块，**行间不放块**（用户结构图口径） */
    const expect = [];
    for (let li = 0; li < nLines; li++) {
      const base = Math.round((gtop + li * lh) * 1000) / 1000;
      offs.forEach(d => expect.push(Math.round((base + d) * 1000) / 1000));
    }"""
assert old in s
s = s.replace(old, new, 1)

old2 = """    const kinds = [];
    for (let li = 0; li < d.nLines; li++) {
      if (li > 0) kinds.push('行' + (li + 1) + '·空档');
      kinds.push('行' + (li + 1) + '·题号');
      'ABCD'.split('').forEach(c => kinds.push('行' + (li + 1) + '·' + c));
    }"""
new2 = """    const kinds = [];
    for (let li = 0; li < d.nLines; li++) {
      kinds.push('行' + (li + 1) + '·题号');
      'ABCD'.split('').forEach(c => kinds.push('行' + (li + 1) + '·' + c));
    }"""
assert old2 in s
s = s.replace(old2, new2, 1)

old3 = """    const want = d.nLines * d.rowOffsets.length + (d.nLines - 1);
    console.log('▶ 网格定位点数量 = nLines·%d + (nLines−1) = %d，实测 %d   %s',
      d.rowOffsets.length, want, d.marks.length,
      d.marks.length === want ? 'OK' : '** 不符 **');"""
new3 = """    const want = d.nLines * d.rowOffsets.length;
    console.log('▶ 网格定位点数量 = nLines·%d = %d，实测 %d   %s',
      d.rowOffsets.length, want, d.marks.length,
      d.marks.length === want ? 'OK' : '** 不符 **');
    /* 相邻块不得重叠：间距必须 >= 块高 */
    let minSep = Infinity;
    for (let i = 1; i < d.marks.length; i++) {
      minSep = Math.min(minSep, d.marks[i] - d.marks[i - 1]);
    }
    console.log('▶ 相邻块最小间距 %s mm  块高 %s mm  %s',
      Math.round(minSep * 1000) / 1000, d.bubbleH,
      minSep >= d.bubbleH ? '不重叠 OK' : '** 重叠 **');"""
assert old3 in s
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
