import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/paginator.js'
s = io.open(p, encoding='utf-8').read()

# 在选择题分支里插入一行调试记录
old = """          var boxTop = cursor;
          var contentTop = r3(cursor + choiceChromeH(p));"""
new = """          var boxTop = cursor;
          var contentTop = r3(cursor + choiceChromeH(p));
          /* 调试：本面容量推导 */
          (function () {
            if (!global.__PAGER_TRACE) global.__PAGER_TRACE = [];
            global.__PAGER_TRACE.push({
              faceIdx: faces.length, choiceLine: choiceLine, boxTop: boxTop,
              usable: usable, headH: headH, room: room,
              lineH: choice.lineH, lineGap: choice.lineGap,
              canFit: canFit, take: take, totalLines: choice.totalLines
            });
          })();"""
assert old in s, 'insert point not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
