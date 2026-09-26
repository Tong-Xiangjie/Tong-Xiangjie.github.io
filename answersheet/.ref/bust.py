import io, re, sys

# 用法：python .ref/bust.py [版本号]
# 把 index.html 里 css/js 资源的 ?v=N 全部改写成指定版本，
# 否则浏览器会拿缓存的旧 js/css，改了代码却像没生效。
p = 'index.html'
s = io.open(p, encoding='utf-8').read()
orig = s
V = 'v=' + (sys.argv[1] if len(sys.argv) > 1 else '3')
s = re.sub(r'(href="css/[^"?]+?)(\?v=\d+)?(")', lambda m: m.group(1) + '?' + V + m.group(3), s)
s = re.sub(r'(src="js/[^"?]+?)(\?v=\d+)?(")', lambda m: m.group(1) + '?' + V + m.group(3), s)
if s != orig:
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('patched')
else:
    print('unchanged')
for line in s.split('\n'):
    if 'css/' in line or 'js/' in line:
        print(line.strip())
