import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
old = """  var lastDebug = null;

  global.AS.paginator = {"""
new = """  var lastDebug = null;

  /** 供 app.js 在「凑偶数」补面之后同步调试快照（.ref 探针读它）。 */
  function noteFaces(faces) {
    if (!lastDebug || !faces) return;
    lastDebug.faces = faces.map(function (f) {
      return {
        first: f.first,
        blank: !!f.blank,
        cursor: f.cursor,
        frameBot: f.frameBot,
        rest: f.rest,
        stretch: f.stretch,
        noAnswer: f.noAnswer,
        noAnswerTop: f.noAnswerTop,
        noAnswerH: f.noAnswerH,
        body: (f.body || []).map(function (b) {
          return b.kind === 'choice'
            ? { kind: 'choice', boxTop: b.boxTop, rows: b.rows, gridTop: b.gridTop }
            : { kind: 'subj', no: b.item.no, top: b.top, h: b.h,
                first: b.first, cont: b.cont, lines: b.lines };
        })
      };
    });
  }

  global.AS.paginator = {"""
assert old in s
s = s.replace(old, new, 1)
s = s.replace("""    paginate: paginate,""", """    paginate: paginate,
    noteFaces: noteFaces,""", 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('noteFaces added')
