import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

old = """.as-info-row {
  display: flex;
  align-items: center;
  gap: -3mm; /*为什么这几个间距要设计为统一的……*/
  font-family: var(--font-sun);
  font-size: var(--fs-info);
  color: var(--fc-info);
}
.as-info-label { font-weight: 500; white-space: nowrap; }
.as-info-fill {
  flex: 0 0 auto;
  border-bottom: 0.3mm solid var(--accent);
  height: 0;
  margin-bottom: -5mm;
}
.as-info-fill.name { width: 30mm; }
.as-info-fill.seat { width: 30mm; }

/* 准考证号书写栏：一行空方框（考生手写，不填涂），尺寸照初版 7mm × 8mm */
.as-zk {
  border-collapse: collapse;
  margin-left: 2mm;
}"""

new = """.as-info-row {
  display: flex;
  align-items: center;
  /* ⚠ 这里以前写的是 `gap: -3mm`。flex 的 gap 不接受负值，浏览器把整条
     声明判为无效（computed value = normal），于是元素之间**一点空隙都没有**
     —— 用户看到的就是「姓名横线和班级贴在一起」。负间距其实一直是由
     .as-info-fill 的 `margin-bottom:-5mm` 在「假装」承担，而那只是把下划线
     往下拽，并没有制造水平空隙。
     现在用正的 gap = 5mm：用户要求「姓名的横线和班级之间要留一定空隙，
     班级的横线与准考证号同理」。 */
  gap: 5mm;
  font-family: var(--font-sun);
  font-size: var(--fs-info);
  color: var(--fc-info);
}
.as-info-label { font-weight: 500; white-space: nowrap; }
.as-info-fill {
  position: relative;
  flex: 0 0 auto;
  height: 0;
  /* 下划线改用绝对定位（::after）画在文字基线稍下方。
     ⚠ 不能再用 `margin-bottom:-5mm` 把下划线往下拽：负外边距会把这一项的
       外边距盒撑大，整行在 .as-info 里垂直居中后文字就整体偏上，而且偏移量
       会随字号漂移。绝对定位的下划线不参与布局，行高恒等于文字行高。 */
}
.as-info-fill::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 4.2mm;              /* 距行心 4.2mm ≈ 文字基线下方，与初版一致 */
  border-bottom: 0.3mm solid var(--accent);
}
.as-info-fill.name { width: 30mm; }
.as-info-fill.seat { width: 30mm; }

/* 准考证号书写栏：一行空方框（考生手写，不填涂），尺寸照初版 7mm × 8mm */
.as-zk {
  border-collapse: collapse;
  /* 不写 margin-left：水平空隙统一由 .as-info-row 的 gap 给，
     否则会变成「gap + margin」两段不等宽的间距。 */
}"""

assert old in s, 'info row CSS not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
