import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/export_pdf_check.mjs'
s = io.open(p, encoding='utf-8').read()

start = s.index('    /* 顺带量一下导出包装里那张大画布')
end = s.index('    /* 等导出链跑完')

new = '''    /* 导出期间量一下包装的几何（包装在导出结束后会被移除，所以要提前量） */
    out.wrapGeom = 'not yet';
    out.wrapGeom2 = 'not yet';

'''

s = s[:start] + new + s[end:]

# 在等待循环里加一次采样
old_wait = '''    for (let i = 0; i < 160 && !capturedBlob && !capturedUri; i++) {
      await new Promise(r => setTimeout(r, 500));
    }'''
new_wait = '''    const measureWrap = (tag) => {
      const w2 = document.querySelector('.as-export-wrap');
      if (!w2) { out[tag] = 'wrap gone'; return; }
      const r2 = w2.getBoundingClientRect();
      out[tag] = {
        w: Math.round(r2.width), h: Math.round(r2.height),
        kids: Array.from(w2.children).map(function (k) {
          const r = k.getBoundingClientRect();
          const pg = k.querySelector ? k.querySelector('.as-page') : null;
          const pr = pg ? pg.getBoundingClientRect() : null;
          return {
            cls: String(k.className), h: Math.round(r.height),
            pageH: pr ? Math.round(pr.height) : null,
            pagePos: pg ? getComputedStyle(pg).position : null,
            pageTop: pr ? Math.round(pr.top) : null,
            pageDisp: pg ? getComputedStyle(pg).display : null
          };
        })
      };
    };

    for (let i = 0; i < 400 && !capturedBlob && !capturedUri; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (i === 1) measureWrap('wrapGeom');
      if (i === 15) measureWrap('wrapGeom2');
    }'''
if old_wait not in s:
    print('!! wait loop not found')
    sys.exit(1)
s = s.replace(old_wait, new_wait)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
