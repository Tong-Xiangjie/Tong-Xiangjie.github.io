# -*- coding: utf-8 -*-
"""产出 jsPDF 要用的 SimHei / SimSun 子集 TTF。
把卡片上会出现的字符全收进子集，产成 .js（base64）供静态站点直接 <script> 引。

⚠ SimHei 的 unitsPerEm 只有 256 —— 中文字形坐标是整数，低 upm 会让曲线
   出现可见的「折角」。所以这里把 upm **放大到 2048** 再子集化，
   保持视觉完全一致但精度足够。
"""
import io, os, re, sys, json, base64
sys.stdout.reconfigure(encoding='utf-8')

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 1. 收集字符集 ────────────────────────────────────────────────────
chars = set()
for rel in ['js/builders/page.js', 'js/builders/choice.js',
            'js/builders/subject.js', 'js/builders/noanswer.js',
            'js/config.js', 'js/geometry.js', 'js/app.js', 'js/paginator.js']:
    p = os.path.join(ROOT, rel)
    if os.path.exists(p):
        chars.update(re.findall(r'[\u4e00-\u9fff]',
                               io.open(p, encoding='utf-8').read()))
chars.update('0123456789')
chars.update('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
chars.update('，。、；：？！（）《》【】“”‘’—…·．')
chars.update('.,;:?!()[]{}<>/\\|-_+=*&%$#@~`\'" ')
chars.update('\u3000\u00b7\u2192\u2190\u2191\u2193')      # 全角空格、间隔号、箭头
# 高频汉字兜底（用户会输入考试名称 / 科目 / 姓名）
chars.update('一二三四五六七八九十百千万零〇两'
             '语文数学英语物理化学政治历史地理生物科学信息技术'
             '期末期中考试模拟联考统一学业水平质量检测第次届高三高二高一'
             '年级省市县区学校中学附属实验外国语'
             '姓名准考证号座位考室条形码缺考标记监考员填涂正确错误示例'
             '选择题非答题区注意事项目要求作答铅笔签字笔毫米黑色墨水'
             '请勿折叠保持字体工整笔迹清晰卡面清洁超出矩形边框限定区域'
             '草稿纸试题卷无效修改橡皮擦干净不留痕迹答案')
chars.discard('\n'); chars.discard('\r'); chars.discard('\t')
chars = {c for c in chars if c.strip() or c == ' ' or c == '\u3000'}
print('字符集大小 =', len(chars))
io.open(os.path.join(ROOT, '.ref', 'charset.txt'), 'w', encoding='utf-8').write(
    ''.join(sorted(chars)))

OUT = os.path.join(ROOT, '.ref', 'fonts')
os.makedirs(OUT, exist_ok=True)

SOURCES = [
    # 名称      来源                            ttc 序号
    ('SimHei', 'C:/Windows/Fonts/simhei.ttf', 0),
    ('SimSun', 'C:/Windows/Fonts/simsun.ttc', 0),
]

report = {}
for name, path, num in SOURCES:
    if not os.path.exists(path):
        print('MISSING', path); continue
    font = TTFont(path, fontNumber=num)
    old_upm = font['head'].unitsPerEm
    if old_upm < 1024:
        print('  %s: upm %d → 2048（提升字形精度）' % (name, old_upm))
        scale_upem(font, 2048)
    opts = subset.Options()
    opts.flavor = None
    opts.drop_tables += ['DSIG']
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.name_IDs = ['*']
    opts.name_legacy = True
    opts.name_languages = ['*']
    sub = subset.Subsetter(options=opts)
    sub.populate(text=''.join(sorted(chars)))
    sub.subset(font)
    ttf = os.path.join(OUT, name + '.subset.ttf')
    font.save(ttf)
    report[name] = os.path.getsize(ttf)
    print('  %-8s %8d B   upm=%d  glyphs=%d'
          % (name, report[name], font['head'].unitsPerEm, len(font.getGlyphOrder())))
    font.close()

# ── 2. 放到站点根 fonts/ 供**导出时按需 fetch** ──────────────────────
#    不做成内联 <script>：两个字体的 base64 合计 687KB，
#    挂进 index.html 会让每次打开页面都白下 687KB 只为偶尔导出一次。
#    导出时才 fetch，浏览器缓存住，第二次导出不再下载。
SITE_FONTS = os.path.join(ROOT, 'fonts')
os.makedirs(SITE_FONTS, exist_ok=True)
for name, _p, _n in SOURCES:
    src = os.path.join(OUT, name + '.subset.ttf')
    if not os.path.exists(src):
        continue
    dst = os.path.join(SITE_FONTS, name + '.subset.ttf')
    io.open(dst, 'wb').write(io.open(src, 'rb').read())
    print('  →', os.path.relpath(dst, ROOT), os.path.getsize(dst), 'B')
json.dump(report, io.open(os.path.join(OUT, 'subset_report.json'), 'w',
                          encoding='utf-8'), indent=1)
