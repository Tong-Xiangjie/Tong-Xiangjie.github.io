"""Recover drawn-rule geometry of a rendered PDF page from pixels.

Glyphs are short; a long run of one colour is a drawn rule or filled bar.
Adjacent rows/columns are merged with a tolerance so 1px antialiased box
outlines are recovered as single rules.
"""
import zlib, struct, sys, collections

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    idat = b''
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bitdepth, colortype, comp, filt, interlace = struct.unpack('>IIBBBBB', chunk)
            assert bitdepth == 8 and interlace == 0
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    stride = w * channels
    out = bytearray(w * h * channels)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, channels, colortype, bytes(out)

def classify(r, g, b):
    if r > 200 and g > 200 and b > 200:
        return None
    if r > 140 and r - g > 50 and r - b > 50:
        return 'RED'
    # dark navy accent used by the A4 card, e.g. (23,44,81)
    if b > r + 20 and b > 40 and r < 120 and b < 160:
        return 'NAVY'
    if abs(r - g) < 40 and abs(g - b) < 40 and r < 110:
        return 'BLACK'
    return 'OTHER'

def merge_runs(runs, tol=3, minthick=1):
    """runs: list of (pos, start, end). Merge runs adjacent in `pos` with similar extent."""
    runs.sort()
    groups = []
    cur = None
    for pos, s, e in runs:
        if cur and pos - cur[1] <= 2 and abs(s - cur[2]) <= tol and abs(e - cur[3]) <= tol:
            cur[1] = pos
            cur[2] = min(cur[2], s)
            cur[3] = max(cur[3], e)
        else:
            if cur:
                groups.append(cur)
            cur = [pos, pos, s, e]
    if cur:
        groups.append(cur)
    return [g for g in groups if g[1] - g[0] + 1 >= minthick]

def analyze(path, dpi, minrun=25):
    w, h, ch, ct, px = read_png(path)
    mmx = 25.4 / dpi
    out = []
    def emit(s=''):
        out.append(s)
    emit(f'{path}: {w}x{h} px @ {dpi}dpi  -> {w*mmx:.2f} x {h*mmx:.2f} mm')
    lab = [[classify(px[(y * w + x) * ch], px[(y * w + x) * ch + 1], px[(y * w + x) * ch + 2])
            for x in range(w)] for y in range(h)]
    emit(f'colours: {collections.Counter(v for r in lab for v in r).most_common()}')

    for color in ('RED', 'NAVY', 'BLACK'):
        hr = []
        for y in range(h):
            row = lab[y]; x = 0
            while x < w:
                if row[x] == color:
                    s = x
                    while x < w and row[x] == color:
                        x += 1
                    if x - s >= minrun:
                        hr.append((y, s, x - 1))
                else:
                    x += 1
        vr = []
        for x in range(w):
            y = 0
            while y < h:
                if lab[y][x] == color:
                    s = y
                    while y < h and lab[y][x] == color:
                        y += 1
                    if y - s >= minrun:
                        vr.append((x, s, y - 1))
                else:
                    y += 1

        emit(f'\n########## {color} ##########')
        emit(f'-- horizontal rules/bars (len>={minrun*mmx:.1f}mm) --')
        for p0, p1, s, e in sorted(merge_runs(hr), key=lambda g: (g[2], g[0])):
            emit(f'  y {p0*mmx:7.2f} .. {(p1+1)*mmx:7.2f}  (t={(p1-p0+1)*mmx:5.2f}mm)   x {s*mmx:7.2f} .. {(e+1)*mmx:7.2f}  len={(e+1-s)*mmx:7.2f}mm')
        emit(f'-- vertical rules/bars (len>={minrun*mmx:.1f}mm) --')
        for p0, p1, s, e in sorted(merge_runs(vr), key=lambda g: (g[2], g[0])):
            emit(f'  x {p0*mmx:7.2f} .. {(p1+1)*mmx:7.2f}  (t={(p1-p0+1)*mmx:5.2f}mm)   y {s*mmx:7.2f} .. {(e+1)*mmx:7.2f}  len={(e+1-s)*mmx:7.2f}mm')
    return '\n'.join(out)

if __name__ == '__main__':
    res = analyze(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 150,
                  int(sys.argv[4]) if len(sys.argv) > 4 else 25)
    if len(sys.argv) > 3:
        open(sys.argv[3], 'w', encoding='utf-8').write(res)
    else:
        print(res)
