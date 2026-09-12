#!/usr/bin/env python
# ==================== tools/subset-font.py ====================
# 把思源黑体裁成"只含本站真正用到的字"的 woff2，用于手机端。
#
# 为什么需要：手机端（@media max-width:768px）会用 SourceHanSansSC 显示正文。
# 完整字重一个 15.76 MB，两个字重就是 31.9 MB —— 比整站缩略图还大一倍。
# 而全站文本去重后只有两千多个字，裁完约 0.6 MB/字重，小 25 倍。
#
# 用法：
#   python collection/tools/subset-font.py            # 生成（会覆盖已有 woff2）
#   python collection/tools/subset-font.py --dry-run  # 只看体积，不写文件
#
# 依赖：pip install fonttools brotli
#
# ★ 字符集是"全站文本的并集"：前端代码、页面、数据文件、文章正文。
#   新增了藏品或文章之后请重新跑一次，否则新出现的字会走字体栈后面的
#   系统字体（Noto Sans CJK SC / PingFang SC），不会变豆腐块，但字形会不一致。
#   也可以用 --extra-chars 补几个字。
#
# ★ 如果原始 OTF 不在仓库里了（为省体积已删），可以从 git 历史里取回来：
#   git checkout <某个旧提交> -- font/SourceHanSansSC
#   或用 --src-dir 指向别处的思源黑体（OFL 授权，Adobe/Google 都能下）。

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COL = os.path.dirname(HERE)          # collection/
REPO = os.path.dirname(COL)          # 仓库根

# 参与收集字符的文本来源（相对仓库根）
TEXT_GLOBS = [
    ('collection', ('.js', '.html', '.css')),
    ('notecollection/data', ('.js',)),
    ('coincollection/data', ('.js',)),
    ('funcollection', ('.js',)),
    ('notecollection/readmes', ('.txt', '.html', '.md')),
    ('coincollection/readmes', ('.txt', '.html', '.md')),
]

# 需要生成的字重（只做手机端真正声明的那两个）
WEIGHTS = ['Regular', 'Bold']


def collect_files():
    files = []
    for rel, exts in TEXT_GLOBS:
        base = os.path.join(REPO, rel)
        if not os.path.isdir(base):
            continue
        for root, _dirs, names in os.walk(base):
            for n in names:
                if n.lower().endswith(exts):
                    files.append(os.path.join(root, n))
    return files


def collect_charset(extra=''):
    chars = set()
    files = collect_files()
    for p in files:
        try:
            with open(p, 'r', encoding='utf-8', errors='ignore') as f:
                chars.update(f.read())
        except OSError:
            pass
    chars.update(extra)
    # 去掉控制字符（换行/制表等）—— 它们不是字形，留着只会让子集命令变复杂
    chars = {c for c in chars if c.isprintable() or c == ' '}
    return chars, len(files)


def human(n):
    return ('%.1f MB' % (n / 1024 / 1024)) if n >= 1024 * 1024 else ('%d KB' % round(n / 1024))


def main():
    # Windows 控制台默认 GBK，打不出西里尔字母之类会直接抛 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

    ap = argparse.ArgumentParser(description='生成思源黑体子集（woff2）')
    ap.add_argument('--dry-run', action='store_true', help='只统计体积，不写文件')
    ap.add_argument('--src-dir', default=os.path.join(REPO, 'font', 'SourceHanSansSC'),
                    help='原始 OTF 所在目录')
    ap.add_argument('--out-dir', default=os.path.join(REPO, 'font', 'SourceHanSansSC'),
                    help='woff2 输出目录')
    ap.add_argument('--extra-chars', default='', help='额外强制纳入的字符')
    ap.add_argument('--keep-original', action='store_true', help='保留原始 OTF（不提示删除）')
    args = ap.parse_args()

    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print('缺少依赖，请先运行：pip install fonttools brotli')
        return 2

    chars, nfiles = collect_charset(args.extra_chars)
    text = ''.join(sorted(chars))
    print('字符集：%d 个（来自 %d 个文件）' % (len(chars), nfiles))

    total_before = total_after = 0
    subset_gap = []      # 源字体有、子集却没有 —— 这才是真错误
    source_gap = set()   # 源字体本身就没有 —— 正常，会走系统字体

    for weight in WEIGHTS:
        src = os.path.join(args.src_dir, 'SourceHanSansSC-%s.otf' % weight)
        if not os.path.isfile(src):
            print('  !! 找不到原始字体：%s' % src)
            print('     （原始 OTF 可能已从仓库移除；见本文件顶部说明）')
            return 1
        dst = os.path.join(args.out_dir, 'SourceHanSansSC-%s.subset.woff2' % weight)
        before = os.path.getsize(src)
        total_before += before

        if args.dry_run:
            print('  %-8s %s → 预计约 %s（未写入）' % (weight, human(before), '0.6 MB'))
            continue

        # 先看源字体自己有哪些字 —— 思源黑体 SC 不含西里尔/希腊字母，
        # 而这些字符确实出现在币名里（如乌克兰格里夫纳 ₴、Є），它们注定进不了子集。
        src_font = TTFont(src, lazy=True)
        src_cmap = set()
        for table in src_font['cmap'].tables:
            src_cmap.update(table.cmap.keys())
        src_font.close()

        options = subset.Options()
        options.flavor = 'woff2'
        options.layout_features = ['*']     # 保留 GSUB/GPOS，字形组合才正常
        options.desubroutinize = True       # CFF 子程序展开后 woff2 压得更小
        options.drop_tables += ['DSIG']     # 子集后签名必然失效，留着是噪音
        options.notdef_outline = True       # 保留 .notdef，缺字时有可见的替代字形

        font = subset.load_font(src, options)
        sub = subset.Subsetter(options=options)
        sub.populate(text=text)
        sub.subset(font)
        subset.save_font(font, dst, options)
        font.close()

        after = os.path.getsize(dst)
        total_after += after
        print('  %-8s %s → %s  (%.1f 倍)' % (weight, human(before), human(after), before / after))

        # ---- 校验 ----
        check = TTFont(dst)
        cmap = set()
        for table in check['cmap'].tables:
            cmap.update(table.cmap.keys())
        check.close()
        for c in chars:
            if ord(c) not in cmap:
                if ord(c) in src_cmap:
                    subset_gap.append((weight, c))
                else:
                    source_gap.add(c)

    if args.dry_run:
        print('原始字体合计 %s' % human(total_before))
        return 0

    print('子集合计 %s（原 %s，省 %s）' % (human(total_after), human(total_before), human(total_before - total_after)))
    if source_gap:
        sample = ''.join(sorted(source_gap)[:30])
        print('源字体本身不含的字 %d 个（正常，会走字体栈后面的系统字体）：%s'
              % (len(source_gap), sample))
    if subset_gap:
        for weight, c in subset_gap[:30]:
            print('  !! %s 子集漏字：%s (U+%04X)' % (weight, c, ord(c)))
        print('子集漏字 %d 个 —— 这是异常，请检查 pyftsubset 参数' % len(subset_gap))
        return 1
    print('校验通过：源字体有的字，子集里都有')

    if not args.keep_original:
        leftovers = [w for w in WEIGHTS
                     if os.path.isfile(os.path.join(args.src_dir, 'SourceHanSansSC-%s.otf' % w))]
        if leftovers:
            print('\n提示：现在可以删掉原始 OTF 了（一个 15 MB 上下，仓库里还有 5 个没用的字重）：')
            for w in leftovers:
                print('   font/SourceHanSansSC/SourceHanSansSC-%s.otf' % w)
            print('  删之前确认没有别的页面引用它们（目前只有 collection/layout.css 的手机端 @font-face）。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
