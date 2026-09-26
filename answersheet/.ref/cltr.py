import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
old = """          choiceLine += rows;"""
new = """          if (global.__CLTRACE) {
            (global.__CLTRACE).push({ face: faces.length, choiceLineAt: choiceLine,
              rows: rows, idxEnd: choiceLine + rows - 1,
              endNo: choice.lineRanges[choiceLine + rows - 1]
                     ? choice.lineRanges[choiceLine + rows - 1].to : 'UNDEF',
              cursorAt: cursor, gridRoom: gridRoom, canFit: canFit });
          }
          choiceLine += rows;"""
assert old in s
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('CLTRACE added')
