import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) subject.js：删掉每题后面的提示句（参照件里只有页脚有一句） ──────────
p = 'js/builders/subject.js'
s = io.open(p, encoding='utf-8').read()
old = """    head += '<span class="as-subj-tip">' + (opts.tip || '请在各题目的答题区域内作答，超出答题区域的答案无效') + '</span>';
    head += '</div>';"""
new = """    /* ⚠ 这里**不**放「请在各题目的答题区域内作答…」。
       参照件（.ref/a4_bbox.xml）里这句话只出现一次，位置在**页脚**
       （y≈274–278mm，整页居中，紧挨页码行），不是每题都印。
       每题的题头只保留「题号 + 分值」。 */
    head += '</div>';"""
if old not in s:
    print('!! subject anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('subject ok')

# ── 2) page.js：页脚措辞与参照件一致 ────────────────────────────────────
p = 'js/builders/page.js'
s = io.open(p, encoding='utf-8').read()
old = """      lines = [
        '请在各题目的答题区域内作答，超出答题区域的答案无效',
        sub
      ];"""
new = """      lines = [
        /* 措辞照参照件（.ref/a4_bbox.xml, y≈274mm）原文 */
        '请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效',
        sub
      ];"""
if old not in s:
    print('!! page anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('page ok')
