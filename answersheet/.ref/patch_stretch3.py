import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ── subject.js：renderRow 支持 extraBottom，render 把它加在最后一行 ─────
p = 'js/builders/subject.js'
s = rd(p)

old = """    var bodyH = lines * (opts.lineH || 7.7);
    return '<tr><td>' + head +
           '<div class="as-subj-body' + (opts.plain ? ' plain' : '') +
           '" style="height:' + round(bodyH) + 'mm"></div></td></tr>';
  }"""
new = """    /* extraBottom：收口下拉量（mm）。只加在**本面最后一行**的答题区上 ——
       用户指定「黑框跟着动」：黑框底边随答题区变高而下移，红框底边贴着它。 */
    var bodyH = lines * (opts.lineH || 7.7) + (opts.extraBottom || 0);
    return '<tr><td>' + head +
           '<div class="as-subj-body' + (opts.plain ? ' plain' : '') +
           '" style="height:' + round(bodyH) + 'mm"></div></td></tr>';
  }"""
assert old in s, 'renderRow body'
s = s.replace(old, new, 1)

old_m = """    var table = '<table class="as-subject-inner-table">' +
                  items.map(function (it) {
                    return renderRow(it.no, it.score, it.lines, {
                      lineH: opts.lineH,
                      cont: it.cont,
                      plain: it.plain,
                      scoreShow: it.scoreShow
                    });
                  }).join('') +
                '</table>';"""
new_m = """    var lastIdx = items.length - 1;
    var table = '<table class="as-subject-inner-table">' +
                  items.map(function (it, i) {
                    return renderRow(it.no, it.score, it.lines, {
                      lineH: opts.lineH,
                      cont: it.cont,
                      plain: it.plain,
                      scoreShow: it.scoreShow,
                      /* 下拉量只给最后一行 */
                      extraBottom: (i === lastIdx) ? (opts.tailExtra || 0) : 0
                    });
                  }).join('') +
                '</table>';"""
assert old_m in s, 'items.map'
s = s.replace(old_m, new_m, 1)
wr(p, s)
print('subject.js ok')

# ── choice.js：确认没有残留的 tailStyle 改动 ───────────────────────────
p = 'js/builders/choice.js'
s = rd(p)
if 'tailStyle' in s:
    print('!! choice.js 里还有 tailStyle，需要清掉')
    for m in __import__('re').finditer(r'.{0,80}tailStyle.{0,80}', s):
        print(repr(m.group(0)))
else:
    print('choice.js 干净')
