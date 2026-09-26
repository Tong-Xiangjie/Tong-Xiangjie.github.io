# -*- coding: utf-8 -*-
"""矢量 PDF 导出回归 —— 一条命令跑完全部校验。

    python .ref/verify_pdf.py              # 跑全部
    python .ref/verify_pdf.py geom         # 只跑几何（PDF vs 绘制清单）
    python .ref/verify_pdf.py vector       # 只跑矢量性 / 纸张 / 字体
    python .ref/verify_pdf.py text         # 只跑文字可还原
    python .ref/verify_pdf.py render       # 只跑 300dpi 渲染比对

为什么要合起来：以前这些检查散在 pdfrects / pdfops / pdftext3 / pngcmp / bbox
五个脚本里，各跑各的，还出现过「PDF 是新导出的、清单是上一次的」这种
**对不上版本的假失败**（气泡整体差 2.047mm，查了很久）。现在统一入口、
统一切时间戳，先确认「两个输入是同一批产物」再比。

⚠ 关键教训记录在案：
  · 内容流单位是 **pt** 不是 mm（jsPDF 用 unit:'mm' 建实例，但吐出来的流
    以 `0.75 0 0 -0.75 … cm` 开头，按 pt 走）。除以 72/25.4 才是 mm。
  · 矩形 h 是**负数**，且要按 `x y w h re` 的顺序取（不是 x y w h 在栈上的
    直觉顺序）。clip 矩形 w、h 都为负。
  · ToUnicode 是**按字体**的表，不能合并。SimHei 与 SimSun 码位重叠，
    合并后「第」会解成「线」、「生」会解成「真」。
  · 用 `[A-Za-z]+` 猜操作符会漏掉 `re`，残留操作数会让坐标错几百 mm。
    必须显式列操作符。
"""
import io, os, re, sys, json, zlib, glob, subprocess
sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

MM = 72.0 / 25.4
PH_DEFAULT = 841.8898
PAPER = {'A4': (210.0, 297.0), 'A3': (420.0, 297.0)}
PASS, FAIL = '✅', '❌'
results = []


def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    print('  %s %-46s %s' % (PASS if ok else FAIL, name, detail))


# ─────────────────────────────────────────────────────────────────────────
# 解析器
# ─────────────────────────────────────────────────────────────────────────
def read_pdf(path):
    b = io.open(path, 'rb').read()
    mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
    media = [float(x) for x in mb.group(1).split()] if mb else [0, 0, 595.28, 841.89]
    streams = []
    for m in re.finditer(rb'stream\r?\n', b):
        s, e = m.end(), b.find(b'endstream', m.end())
        raw = b[s:e].rstrip(b'\r\n')
        try:
            t = zlib.decompress(raw).decode('latin-1')
        except Exception:
            t = raw.decode('latin-1')
        streams.append(t)
    return b, media, streams


RE_RE = re.compile(r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b')


def rects_of(stream, media):
    PH = media[3]
    out = []
    for m in RE_RE.finditer(stream):
        x, y, w, h = (float(g) for g in m.groups())
        out.append({'x': x / MM, 'top': (PH - y) / MM, 'w': abs(w) / MM, 'h': abs(h) / MM,
                    'rawW': w, 'rawH': h})
    return out


def cmaps_by_font(b):
    """返回 {F15: {码位: 字符}}，按字体分开 —— 合并会串字（「第」→「线」）。"""
    out = {}
    by_name = {}
    for nm, num in re.findall(rb'/(F\d+)\s+(\d+)\s+0\s+R', b):
        by_name[nm.decode('latin-1')] = int(num)
    for nm, num in by_name.items():
        om = re.search(rb'(?<![\d])' + str(num).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
        mp = {}
        if om:
            tm = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', om.group(1))
            if tm:
                cm = re.search(rb'(?<![\d])' + tm.group(1) + rb'\s+0\s+obj(.*?)endobj',
                               b, re.S)
                if cm:
                    sm = re.search(rb'stream\r?\n(.*?)\r?\nendstream', cm.group(1), re.S)
                    if sm:
                        raw = sm.group(1)
                        try:
                            t = zlib.decompress(raw).decode('latin-1')
                        except Exception:
                            t = raw.decode('latin-1')
                        for blk in re.findall(r'beginbfchar(.*?)endbfchar', t, re.S):
                            for src, dst in re.findall(
                                    r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                                mp[int(src, 16)] = ''.join(
                                    chr(int(dst[i:i + 4], 16))
                                    for i in range(0, len(dst), 4))
                        for blk in re.findall(r'beginbfrange(.*?)endbfrange', t, re.S):
                            for lo, hi, d0 in re.findall(
                                    r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>',
                                    blk):
                                a, z, dd = int(lo, 16), int(hi, 16), int(d0, 16)
                                for k in range(a, z + 1):
                                    mp[k] = chr(dd + (k - a))
        out[nm] = mp
    return out


TOK = re.compile(r'/(F\d+)\s+([\d.]+)\s+Tf|<([0-9A-Fa-f]+)>\s*Tj')
def texts_of(stream, fonts):
    cur = None
    out = []
    for m in TOK.finditer(stream):
        if m.group(1):
            cur = fonts.get(m.group(1), {})
        elif m.group(3):
            hx = m.group(3)
            if len(hx) % 4:
                hx += '0' * (4 - len(hx) % 4)
            s = ''.join((cur or {}).get(int(hx[i:i + 4], 16), '\ufffd')
                        for i in range(0, len(hx), 4))
            if s.strip():
                out.append(s)
    return out


# ─────────────────────────────────────────────────────────────────────────
# 各项检查
# ─────────────────────────────────────────────────────────────────────────
def load_draw_list(pdf_path):
    mj = pdf_path.replace('.pdf', '.measure.json')
    if not os.path.exists(mj):
        return None, None
    # 版本一致性：清单与 PDF 必须是同一时刻产出的
    dt_pdf = os.path.getmtime(pdf_path)
    dt_js = os.path.getmtime(mj)
    if abs(dt_pdf - dt_js) > 120:
        return None, ('清单与 PDF 相差 %.0f 秒 —— 不是同一批产物，先重跑 .ref/vecprobe.cjs'
                      % abs(dt_pdf - dt_js))
    return json.load(io.open(mj, encoding='utf-8')), None


def want_rects_of(page):
    """把绘制清单折成「PDF 里应该出现的矩形」：描边要向内收 lw/2。"""
    out = [(o['x'], o['y'], o['w'], o['h']) for o in page['fills']]
    for o in page['strokes']:
        lw = o['lw'] or 0.3
        out.append((o['x'] + lw / 2, o['y'] + lw / 2,
                    max(0.0, o['w'] - lw), max(0.0, o['h'] - lw)))
    return out


def check_geom(pdf_path):
    b, media, streams = read_pdf(pdf_path)
    draw, err = load_draw_list(pdf_path)
    if err:
        rec('几何：清单可用', False, err)
        return
    if draw is None:
        rec('几何：有绘制清单', False, '缺少 %s' % os.path.basename(
            pdf_path.replace('.pdf', '.measure.json')))
        return
    ok_all, tot = True, 0
    for pi, page in enumerate(draw['pages']):
        want = want_rects_of(page)
        # 按「条数相等」把页绑到流上（不假设页序 = 流序）
        cand = [i for i, s in enumerate(streams)
                if len(rects_of(s, media)) == len(want)]
        if not cand:
            rec('几何：第 %d 面能配对' % (pi + 1), False,
                '清单 %d 条，流里的矩形数 %s' %
                (len(want), [len(rects_of(s, media)) for s in streams]))
            ok_all = False
            continue
        got = rects_of(streams[cand[0]], media)
        used = [False] * len(got)
        dmax, bad = 0.0, 0
        for u in want:
            bi, bd = -1, None
            for j, g in enumerate(got):
                if used[j]:
                    continue
                d = max(abs(u[0] - g['x']), abs(u[1] - g['top']),
                        abs(u[2] - g['w']), abs(u[3] - g['h']))
                if bd is None or d < bd:
                    bi, bd = j, d
                    if d == 0.0:
                        break
            if bi < 0 or bd > 0.02:
                bad += 1
                continue
            used[bi] = True
            dmax = max(dmax, bd)
        tot += len(want)
        ok_all = ok_all and bad == 0
        rec('几何：第 %d 面 %d 个矩形' % (pi + 1, len(want)), bad == 0,
            '最大偏差 %.4f mm%s' % (dmax, '' if not bad else '，%d 条超差' % bad))
    if ok_all:
        rec('几何：全部 %d 个矩形 ≤0.02mm' % tot, True)

    # 文字基线
    # ⚠ 比的是**基线 y**（这才是「基线」的意思）；x 只在左对齐时可比 ——
    #   居中/右对齐的文字，draw.js 会按实测串宽反推左缘再落笔，
    #   Td 的 x 是落笔点（左缘），不等于清单里的 o.x。
    # ⚠ 竖排的文字同理：x 是字框心、y 是「框心 + (desc−0.5em)」，
    #   两者都不是行盒基线，单独放开，只做「没跑飞」的兜底。
    ok_t, tot_t, dmax_t, dmax_v = True, 0, 0.0, 0.0
    for pi, page in enumerate(draw['pages']):
        cand = [i for i, s in enumerate(streams)
                if len(re.findall(r'Td\b', s)) == len(page['texts'])]
        if not cand:
            continue
        stream = streams[cand[0]]
        got = [{'x': float(a) / MM, 'y': (media[3] - float(c)) / MM}
               for a, c in re.findall(r'(-?[\d.]+)\s+(-?[\d.]+)\s+Td', stream)]
        if len(got) != len(page['texts']):
            ok_t = False
            continue
        for t, g in zip(page['texts'], got):
            dmax_t = max(dmax_t, abs(t['y'] - g['y']))
            if t.get('vertical'):
                # 竖排一列一条 run：x 是第一个字的字框左缘（左缘落笔，直接可比）
                dmax_v = max(dmax_v, abs(t['x'] - g['x']))
            elif (t.get('align') or 'left') == 'left':
                dmax_t = max(dmax_t, abs(t['x'] - g['x']))
        tot_t += len(page['texts'])
    rec('几何：文字基线（y）%d 条' % tot_t, ok_t and dmax_t <= 0.02,
        '最大偏差 %.4f mm' % dmax_t)
    if dmax_v:
        rec('几何：竖排列 x 落点', dmax_v <= 0.02, '最大偏差 %.4f mm' % dmax_v)

    # ── 竖排必须是「逐字一条 run」 ────────────────────────────────────
    # 试过合并成一列一条 run（为了整串可搜），但 PDF 的文本对象是水平推进的：
    # 11 字 @45pt = 174.6mm，从 x=97.2mm 起画会跑出纸外，pdftotext 少两个半字。
    # 所以这里反过来钉住「必须逐字」—— 防止以后又有人为了可搜性合并回去。
    verts = [t for pg in draw['pages'] for t in pg['texts'] if t.get('vertical')]
    if verts:
        bad = [t for t in verts if len(t.get('text', '')) != 1]
        rec('竖排：逐字一条 run（不可合并成整列）', not bad,
            '%d 个字，%s' % (len(verts),
                            '全部单字' if not bad else '%d 条多字' % len(bad)))

    # ── 文字必须落在纸内 ──────────────────────────────────────────────
    # 这条针对竖排那次事故：把一列 11 个字并成一条 run，PDF 按「每字 1em
    # 水平推进」画，总宽 174.6mm 从 x=97.2mm 起画，直接跑出纸外
    # （pdftotext 少抽到「域作答」）。
    #
    # ⚠ 判据只用 DOM 量出的量（x + 墨迹宽），**不估算** PDF 的推进宽度：
    #   按「1em × 字数」估会把「2026」这种数字串算成 4 个全角（实测估
    #   88.90mm vs 真值 76.20mm），19 条误报。而 PDF 与绘制清单的一致性
    #   已由上面的「几何」项单独钉住（0.0005mm）—— 这里只回答
    #   「会不会跑出纸」，其余交给那一项。
    # ⚠ 只对 **align:'left'** 的 run 算右缘。中心/右对齐时 `x` 是锚点，
    #   而中心锚点未必在整张纸的中心（「请在各题目的答题区域内作答…」是
    #   在**非选择题框内部**居中，墨迹左缘 6.7mm）。拿锚点减半个量出的宽
    #   会算出 -1.63mm 的假越界。
    #   中心/右对齐 run 的落笔点由 draw.js 用 getTextWidth 自己算，
    #   `x` 是锚点、量不出右缘 —— 但「整页墨迹都在纸内」由下面的
    #   check_render（pdftoppm 渲染后的墨迹包围盒）真实兜住，不会漏。
    over, n_left = [], 0
    for pi, pg in enumerate(draw['pages']):
        W = 420.0 if (pg.get('w') or 0) > 400 else 210.0
        for t in pg['texts']:
            if (t.get('align') or 'left') != 'left' or t.get('x') is None:
                continue
            n_left += 1
            x0, x1 = t['x'], t['x'] + (t.get('w') or 0)
            if x0 < -0.5 or x1 > W + 0.5:
                over.append((pi + 1, (t.get('text') or '')[:20],
                             round(x0, 2), round(x1, 2), W))
    rec('文字：左对齐 run 全部落在纸内', not over,
        '%d 条左对齐文字未越界%s' % (n_left,
                                '' if not over else '；%d 条越界' % len(over)))
    for o in over[:6]:
        print('      第%d面 「%s」 x=%.2f→%.2f（纸宽 %.0f）' % o)


def check_vector(pdf_path, tag):
    b, media, streams = read_pdf(pdf_path)
    images = len(re.findall(rb'/Subtype\s*/Image', b))
    ff2 = len(re.findall(rb'/FontFile2', b))
    t0 = len(re.findall(rb'/Type0', b))
    rec('矢量：无位图', images == 0, 'Image 对象 %d' % images)
    rec('字体：内嵌中文', ff2 >= 1 and t0 >= 1, 'FontFile2=%d Type0=%d' % (ff2, t0))
    w, h = media[2] / MM, media[3] / MM
    exp = PAPER.get(tag)
    ok = exp is None or (abs(w - exp[0]) < 0.2 and abs(h - exp[1]) < 0.2)
    rec('纸张', ok, '%.3f × %.3f mm' % (w, h))
    # 每页都得有内容
    per = [len(rects_of(s, media)) for s in streams
           if len(rects_of(s, media)) > 0 or 'Td' in s]
    rec('每页有内容', len(per) >= 1 and all(v > 0 for v in per) if per else False,
        '各流矩形数 %s' % per)


def check_text(pdf_path):
    b, media, streams = read_pdf(pdf_path)
    fonts = cmaps_by_font(b)
    all_text = []
    for s in streams:
        all_text += texts_of(s, fonts)
    joined = ''.join(all_text)
    han = sorted(set(c for c in joined if '\u4e00' <= c <= '\u9fff'))
    rec('文字：可还原', len(joined) > 50, '共 %d 条 / %d 个不同汉字'
        % (len(all_text), len(han)))
    # 关键短语必须原样出现（这些是答题卡的固定文案）。
    # ⚠ 「注意事项」是**竖排**的：一个字一个文本节点，逐字提取出来是
    #   「注」「意」「事」「项」四条独立文字，连不成整词。所以竖排词条
    #   改成查「每个字都在」，并且额外验一次非答题区的竖排顺序。
    for phrase in ['答题卡', '准考证号', '非选择题', '缺考考生标记',
                   '贴条形码区', '第 1 面']:
        hit = phrase.replace(' ', '') in joined.replace(' ', '')
        rec('文字：含「%s」' % phrase, hit)
    rec('文字：注意事项四字齐备', all(c in joined for c in '注意事项'))
    # 竖排的「考生请不要在此区域作答」—— 顺序必须正确
    if '在此区域作答' in joined:
        rec('文字：非答题区竖排顺序', '考生请不要在此区域作答' in joined,
            '（曾因按 top 分组而拼成「考真请书试在此区域作答」）')


def check_render(pdf_path):
    """300dpi 渲染件与预览截图的墨迹包围盒比对（两个独立渲染器）。"""
    outdir = '.ref/out/png'
    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, 'v_' + os.path.basename(pdf_path).replace('.pdf', ''))
    for f in glob.glob(base + '*.png'):
        os.remove(f)
    r = subprocess.run(['pdftoppm', '-r', '300', '-png', '-f', '1', '-l', '1',
                        pdf_path, base], capture_output=True)
    if r.returncode != 0:
        rec('渲染：pdftoppm', False, r.stderr.decode('utf-8', 'replace')[:120])
        return
    pngs = glob.glob(base + '*.png')
    if not pngs:
        rec('渲染：pdftoppm 产出', False, '没有 PNG')
        return
    try:
        from PIL import Image
    except ImportError:
        rec('渲染：Pillow', False, '未安装，跳过')
        return

    def bbox(path, th=200):
        im = Image.open(path).convert('L')
        W, H = im.size
        px = im.load()
        x0, y0, x1, y1 = W, H, -1, -1
        for y in range(H):
            for x in range(W):
                if px[x, y] < th:
                    x0 = min(x0, x); x1 = max(x1, x)
                    y0 = min(y0, y); y1 = max(y1, y)
        return W, H, x0, y0, x1, y1

    W, H, x0, y0, x1, y1 = bbox(pngs[0])
    PPM = W / (PAPER['A4'][0])       # 用纸张宽反推 px/mm，不假定 dpi
    # ⚠ bbox() 返回 (W, H, x0, y0, x1, y1)，别把 W/H 当成 x0/y0 —— 之前就是这么
    #   写错的，打印出来「左 5.59 右 8.89」其实是 x0 和 y0。
    left, top, right, bottom = x0 / PPM, y0 / PPM, x1 / PPM, y1 / PPM
    rec('渲染：墨迹包围盒', True,
        '左 %.2f 右 %.2f 上 %.2f 下 %.2f mm' % (left, right, top, bottom))
    inside = (0 <= left <= 40 and 160 <= right <= 210 and
              0 <= top <= 40 and 260 <= bottom <= 297)
    rec('渲染：内容在纸内', inside)
    rec('渲染：不是空页', (right - left) > 150 and (bottom - top) > 200,
        '内容 %.1f × %.1f mm' % (right - left, bottom - top))


def check_dom(pdf_path):
    """DOM 真值 ↔ PDF 的直接比对。

    为什么还要这一项：`check_geom` 比的是「measure.js 的绘制清单 ↔ PDF」，
    两边都经过我的测量层（清单本身要是量错了，那项检查是发现不了的）。
    这里换成**直接从 DOM 量的元素盒**当作独立真值 ——
    量的是 `getBoundingClientRect()`（transform 已关），
    与 PDF 字节解析出的矩形配对。

    判据用目标里写的 **≤0.1mm**。
    """
    dj = pdf_path.replace('.pdf', '.dom.json')
    if not os.path.exists(dj):
        rec('DOM 真值：有快照', False, '缺少 %s（重跑 vecprobe.cjs）' % os.path.basename(dj))
        return
    dom = json.load(io.open(dj, encoding='utf-8'))
    b, media, streams = read_pdf(pdf_path)
    all_rects = []
    for s in streams:
        all_rects += rects_of(s, media)

    for pi, page in enumerate(dom['pages']):
        # DOM 真值里既有填充盒也有带边框的盒；两者在 PDF 里都是矩形。
        # ⚠ 带边框的盒必须**向内收 lw/2** 再比：
        #   CSS 的 border 画在盒子**里面**（border-box 外缘 = 7×8mm），
        #   而 PDF 的描边是以路径为中心骑在线上（re 给的是路径）。
        #   draw.js 的 strokeRect 已经这么收了，所以比对侧也要收，
        #   否则 0.265mm 的线宽会全部报成「超差」。
        #   （实测：15 个缺考框/示例框，DOM 7×8 → PDF 6.734×7.735，差 0.265 = lw。）
        want = []
        for bx in page['boxes']:
            # ⚠ 探针原样存的是 computed style 的字符串（'0.3mm'/'1px'），
            #   不是数字 —— 得先抠出数值再换算。
            bw = str(bx.get('border') or '')
            mt = re.match(r'\s*(-?[\d.]+)\s*([a-z%]*)', bw)
            lw_mm = 0.0
            if mt and bx.get('border'):
                v, unit = float(mt.group(1)), mt.group(2)
                lw_mm = v * 25.4 / 96.0 if unit == 'px' else v   # mm 原样
            if lw_mm > 0:
                want.append(('border', bx['x'] + lw_mm / 2, bx['y'] + lw_mm / 2,
                             max(0.0, bx['w'] - lw_mm), max(0.0, bx['h'] - lw_mm)))
            else:
                want.append(('fill', bx['x'], bx['y'], bx['w'], bx['h']))
        got = [r for r in all_rects]
        # 逐条最近邻（DOM 盒数量比 PDF 矩形少：气泡的描边/填充在 DOM 里
        # 是一个盒子，在 PDF 里可能是两条；所以只要求每条 DOM 盒都能找到对应）
        misses, dmax = [], 0.0
        pool = list(got)
        taken = [False] * len(pool)
        for kind, u in [(w[0], w[1:]) for w in want]:
            bi, bd = -1, None
            for j, g in enumerate(pool):
                if taken[j]:
                    continue
                d = max(abs(u[0] - g['x']), abs(u[1] - g['top']),
                        abs(u[2] - g['w']), abs(u[3] - g['h']))
                if bd is None or d < bd:
                    bi, bd = j, d
                    if d == 0.0:
                        break
            if bi < 0 or bd > 0.1:
                misses.append((kind, u, None if bi < 0 else
                               (pool[bi]['x'], pool[bi]['top'], pool[bi]['w'], pool[bi]['h']),
                               None if bd is None else round(bd, 4)))
                continue
            taken[bi] = True
            dmax = max(dmax, bd)
        ok = not misses
        rec('DOM 真值：第 %d 面 %d 个盒 → PDF' % (pi + 1, len(want)), ok,
            '最大偏差 %.4f mm%s' % (dmax, '' if ok else '，%d 个超 0.1mm' % len(misses)))
        for m in misses[:6]:
            print('      [%s] DOM=%s → PDF=%s  d=%s' % m)


def check_text_independent(pdf_path):
    """用 poppler 的 pdftotext / pdffonts / pdfimages 复核（第三方工具）。

    为什么不用自己的解析器收尾：自证不算证。这三项覆盖了目标里的
    「文字可选中可搜索」「字体内嵌」「全矢量」。"""
    exe_dir = r'E:\texlive\2025\bin\windows'
    pt = os.path.join(exe_dir, 'pdftotext.exe')
    pf = os.path.join(exe_dir, 'pdffonts.exe')
    pim = os.path.join(exe_dir, 'pdfimages.exe')
    if not os.path.exists(pt):
        rec('第三方工具：pdftotext 可用', False, '未找到 %s' % pt)
        return
    r = subprocess.run([pt, '-f', '1', '-l', '1', '-layout', pdf_path, '-'],
                       capture_output=True)
    txt = r.stdout.decode('utf-8', 'replace')
    rec('第三方 pdftotext 能抽出文字', len(txt) > 200, '%d 字' % len(txt))
    for ph in ['答题卡', '准考证号', '非选择题', '缺考考生标记']:
        rec('第三方：含「%s」' % ph, ph in txt)
    # 竖排（「注意事项」在侧栏，.as-note-left 是 writing-mode:vertical-rl）
    # 一字一个文本对象，所以只能查到单字；整词查询受 PDF 文本模型限制。
    for ph in ['注', '意', '事', '项']:
        rec('第三方：竖排单字「%s」可查' % ph, ph in txt)
    # 第 2 面非答题区竖排：逐字抽出来后**拼接顺序**必须正确
    r2 = subprocess.run([pt, '-f', '2', '-l', '2', pdf_path, '-'], capture_output=True)
    t2 = r2.stdout.decode('utf-8', 'replace')
    flat = ''.join(t2.split())
    want2 = '考生请不要在此区域作答'
    rec('第三方：非答题区竖排逐字顺序', want2 in flat,
        '拼出「%s」' % (flat[:24] if want2 not in flat else want2))

    if os.path.exists(pf):
        r2 = subprocess.run([pf, pdf_path], capture_output=True)
        ft = r2.stdout.decode('utf-8', 'replace')
        lines = [l for l in ft.splitlines() if l.strip()]
        emb = [l for l in lines if 'CID TrueType' in l and ' yes ' in l]
        names = [l.split()[0] for l in emb]
        rec('第三方 pdffonts：中文 CID TrueType 已内嵌',
            'SimHei' in names and 'SimSun' in names, '、'.join(names))
    if os.path.exists(pim):
        r3 = subprocess.run([pim, '-list', pdf_path], capture_output=True)
        it = r3.stdout.decode('utf-8', 'replace')
        rows = [l for l in it.splitlines()[2:] if l.strip()]
        rec('第三方 pdfimages：0 张位图', len(rows) == 0, '%d 行' % len(rows))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    files = sorted(glob.glob('.ref/out/reg/*.pdf'))
    single = '.ref/out/vector.pdf'
    print('=== 单个产物：%s ===' % single)
    if os.path.exists(single):
        if mode in ('all', 'geom'):
            check_geom(single)
        if mode in ('all', 'dom'):
            check_dom(single)
        if mode in ('all', 'vector'):
            check_vector(single, 'A4')
        if mode in ('all', 'text'):
            check_text(single)
        if mode in ('all', 'third'):
            check_text_independent(single)
        if mode in ('all', 'render'):
            check_render(single)
    else:
        print('  （没有 %s，先跑 .ref/vecprobe.cjs）' % single)

    if files and mode in ('all', 'vector', 'text'):
        print('\n=== 七个配置的产物 ===')
        for p in files:
            tag = os.path.basename(p).split('-')[0]
            b, media, streams = read_pdf(p)
            images = len(re.findall(rb'/Subtype\s*/Image', b))
            ff2 = len(re.findall(rb'/FontFile2', b))
            exp = PAPER.get(tag)
            w, h = media[2] / MM, media[3] / MM
            okp = exp is None or (abs(w - exp[0]) < 0.2 and abs(h - exp[1]) < 0.2)
            fonts = cmaps_by_font(b)
            ntext = sum(len(texts_of(s, fonts)) for s in streams)
            nrect = sum(len(rects_of(s, media)) for s in streams)
            ok = images == 0 and ff2 >= 1 and okp and ntext > 5 and nrect > 5
            rec(os.path.basename(p), ok,
                '%d 矩形 %d 文字段 %.2f×%.2fmm' % (nrect, ntext, w, h))

    print('\n' + '=' * 62)
    bad = [r for r in results if not r[1]]
    print('%s 通过 %d / %d' % (PASS if not bad else FAIL,
                              len(results) - len(bad), len(results)))
    if bad:
        for n, _, d in bad:
            print('  %s %s  %s' % (FAIL, n, d))
    sys.exit(0 if not bad else 1)


main()
