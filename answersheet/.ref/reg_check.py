# -*- coding: utf-8 -*-
"""回归：检查 .ref/out/reg/*.pdf 是否都是合规的**矢量** PDF。

判据：
  · /Subtype /Image 必须为 0        —— 有图就不是矢量
  · FontFile2 ≥ 1 且 Type0 ≥ 1      —— 中文字体确实内嵌
  · MediaBox 与配置的纸张一致
  · 每页都有内容（文字 + 矩形）
  · 文字能通过 ToUnicode 还原成中文（可选中/可搜索）
"""
import io, os, re, sys, json, zlib, glob
sys.stdout.reconfigure(encoding='utf-8')

MM = 72.0 / 25.4
PAPER = {'A4': (210.0, 297.0), 'A3': (420.0, 297.0)}


def parse(path):
    b = io.open(path, 'rb').read()
    mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
    media = [float(x) for x in mb.group(1).split()] if mb else None

    # 逐页内容流
    streams = []
    for m in re.finditer(rb'stream\r?\n', b):
        s, e = m.end(), b.find(b'endstream', m.end())
        raw = b[s:e].rstrip(b'\r\n')
        try:
            t = zlib.decompress(raw).decode('latin-1')
        except Exception:
            t = raw.decode('latin-1')
        if ' re' in t or ' Td' in t:
            streams.append(t)
    nrect = sum(len(re.findall(r'-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+re\b', s))
                for s in streams)
    ntext = sum(len(re.findall(r'Td\b', s)) for s in streams)

    # ToUnicode 还原出的字符
    chars = set()
    for m in re.finditer(rb'/ToUnicode\s+(\d+)\s+(\d+)\s+R', b):
        om = re.search(rb'\n' + m.group(1) + rb'\s+0\s+obj(.*?)endobj', b, re.S)
        if not om:
            continue
        sm = re.search(rb'stream\r?\n(.*?)\r?\nendstream', om.group(1), re.S)
        if not sm:
            continue
        try:
            cm = zlib.decompress(sm.group(1)).decode('latin-1')
        except Exception:
            cm = sm.group(1).decode('latin-1')
        for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
            for _s, d in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                chars.add(''.join(chr(int(d[i:i+4], 16)) for i in range(0, len(d), 4)))
        for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
            for lo, hi, d0 in re.findall(
                    r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                for k in range(int(lo, 16), int(hi, 16) + 1):
                    chars.add(chr(int(d0, 16) + k - int(lo, 16)))

    return {
        'bytes': len(b),
        'media_mm': [media[2] / MM, media[3] / MM] if media else None,
        'images': len(re.findall(rb'/Subtype\s*/Image', b)),
        'fontfile2': len(re.findall(rb'/FontFile2', b)),
        'type0': len(re.findall(rb'/Type0', b)),
        'tounicode': len(re.findall(rb'/ToUnicode', b)),
        'streams': len(streams),
        'rects': nrect,
        'texts': ntext,
        'unicode_chars': len(chars),
        'has_chinese': any('\u4e00' <= c <= '\u9fff' for c in chars),
        'sample': ''.join(sorted(c for c in chars if '\u4e00' <= c <= '\u9fff'))[:24]
    }


files = sorted(glob.glob('.ref/out/reg/*.pdf'))
if not files:
    print('没有找到 .ref/out/reg/*.pdf')
    sys.exit(1)

ok = True
for p in files:
    name = os.path.basename(p)
    r = parse(p)
    tag = name.split('-')[0]
    want = PAPER.get(tag)
    checks = []
    checks.append(('矢量（无位图）', r['images'] == 0))
    checks.append(('内嵌中文字体', r['fontfile2'] >= 1 and r['type0'] >= 1))
    checks.append(('纸张尺寸', want is None or
                   (r['media_mm'] and abs(r['media_mm'][0] - want[0]) < 0.2
                    and abs(r['media_mm'][1] - want[1]) < 0.2)))
    checks.append(('每页都有内容', r['rects'] > 20 and r['texts'] > 10))
    checks.append(('文字可还原中文', r['has_chinese']))
    bad = [n for n, v in checks if not v]
    if bad:
        ok = False
    print('%-20s %6d B  %d 流  %4d 矩形  %3d 文字段  %3d 汉字  %s'
          % (name, r['bytes'], r['streams'], r['rects'], r['texts'],
             r['unicode_chars'], '✅' if not bad else '❌ ' + '、'.join(bad)))
    if bad:
        print('    %s' % json.dumps(r, ensure_ascii=False))

print('\n%s' % ('✅ 全部通过' if ok else '❌ 有失败项'))
sys.exit(0 if ok else 1)
