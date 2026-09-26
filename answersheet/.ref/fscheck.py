# -*- coding: utf-8 -*-
"""读字体的 fsType（嵌入权限位）与基本度量。
fsType 位含义：
  0x0002  Restricted License embedding（禁止嵌入）
  0x0004  Preview & Print embedding（只许预览/打印，不许编辑）
  0x0008  Editable embedding（可嵌入）
  0x0100  No subsetting（不许子集化）
  0x0200  Bitmap embedding only
"""
import os, sys
sys.stdout.reconfigure(encoding='utf-8')
from fontTools.ttLib import TTFont

FLAG = {0x0002: 'RESTRICTED(禁止嵌入)', 0x0004: 'PREVIEW&PRINT(仅预览打印)',
        0x0008: 'EDITABLE(可嵌入)', 0x0100: 'NO-SUBSET(不许子集)',
        0x0200: 'BITMAP-ONLY(仅位图)', 0x0000: '(无限制)'}

FILES = [
    ('SimHei 黑体', 'C:/Windows/Fonts/simhei.ttf', 0),
    ('SimSun 宋体', 'C:/Windows/Fonts/simsun.ttc', 0),
    ('Microsoft YaHei 微软雅黑', 'C:/Windows/Fonts/msyh.ttc', 0),
    ('NotoSansSC 思源黑(开源)', 'C:/Windows/Fonts/NotoSansSC-VF.ttf', 0),
    ('NotoSerifSC 思源宋(开源)', 'C:/Windows/Fonts/NotoSerifSC-VF.ttf', 0),
]
for label, path, num in FILES:
    if not os.path.exists(path):
        print('%-28s MISSING' % label); continue
    try:
        f = TTFont(path, fontNumber=num, lazy=True)
    except Exception as e:
        print('%-28s ERR %s' % (label, e)); continue
    fs = f['OS/2'].fsType if 'OS/2' in f else None
    upm = f['head'].unitsPerEm
    asc = f['hhea'].ascent
    desc = f['hhea'].descent
    linegap = f['hhea'].lineGap
    typo_asc = f['OS/2'].sTypoAscender if 'OS/2' in f else None
    typo_desc = f['OS/2'].sTypoDescender if 'OS/2' in f else None
    win_asc = f['OS/2'].usWinAscent if 'OS/2' in f else None
    win_desc = f['OS/2'].usWinDescent if 'OS/2' in f else None
    numg = len(f.getGlyphOrder())
    flags = []
    if fs is not None:
        for bit, name in sorted(FLAG.items()):
            if bit and (fs & bit):
                flags.append(name)
        if fs == 0:
            flags.append('(无限制)')
    print('%-28s fsType=0x%04X  %s' % (label, fs if fs is not None else -1, ' / '.join(flags)))
    print('    upm=%d hhea asc/desc/gap = %d/%d/%d   typo %s/%s  win %s/%s  glyphs=%d'
          % (upm, asc, desc, linegap, typo_asc, typo_desc, win_asc, win_desc, numg))
    cf = f['name'].getDebugName(1)
    print('    name1 =', cf)
    f.close()
