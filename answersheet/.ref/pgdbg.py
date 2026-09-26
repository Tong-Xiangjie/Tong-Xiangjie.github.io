import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
old = "  function paginate(o) {\n    var p = o.preset || C.PRESETS.A4;\n    var off = G.boxOffsets(p);\n"
new = ("  function paginate(o) {\n    var p = o.preset || C.PRESETS.A4;\n    var off = G.boxOffsets(p);\n"
       "    if (global.__PGDBG) { console.log('[PGDBG]', JSON.stringify({\n"
       "      chromeFirst: o.chromeFirst, chromeOther: o.chromeOther,\n"
       "      blockCount: o.blocks.length,\n"
       "      firstBlock: o.blocks[0],\n"
       "      SUBJ_ITEM_PITCH: SUBJ_ITEM_PITCH, SUBJ_BOX_CHROME: SUBJ_BOX_CHROME,\n"
       "      F_TOP: G.frameTopLimit(p), F_BOT: G.frameBottomLimit(p, PAGE_H),\n"
       "      frameH: G.frameHeight(p, PAGE_H), foot: footReserve() })); }\n")
assert old in s
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('dbg added')
