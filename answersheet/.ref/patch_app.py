import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

p = 'js/app.js'
s = rd(p)

# ── 1) renderFaceBody 末尾加非答题区 ─────────────────────────────────
anchor = """              }) +
              '</div>';
    }
    return html;
  }"""
assert anchor in s, 'renderFaceBody end not found'
new = """              }) +
              '</div>';
    }
    /* 非答题区「考生请不要在此区域作答」：
       高度由分页器给定（吃掉本面剩余空白），**高度内联写死**；
       字号在 DOM 落地后由 fitNoAnswer() 按框的宽高比实测再定。 */
    if (face.noAnswer && face.noAnswerH > 0) {
      html += NoAnswer.render({
        top: face.noAnswerTop,
        height: face.noAnswerH
      });
    }
    return html;
  }

  /* ── 非答题区字号自适应 ───────────────────────────────────────────────
     高度是 JS 先算的，字号要等布局稳定后才量得准（原设计也是
     setTimeout 后再量）。这里在 innerHTML 落地后同步量一次即可 ——
     非答题区是绝对定位、尺寸已定，不依赖其它元素。
     ⚠ 必须量**内容盒**（clientWidth/clientHeight），不是 borderBox ——
       边框与内边距已经占掉一部分，用 borderBox 会让字溢出。 */
  function fitNoAnswer() {
    var areas = document.querySelectorAll('.as-noanswer');
    Array.prototype.forEach.call(areas, function (area) {
      var t = area.querySelector('.as-noanswer-text');
      if (!t) return;
      var w = area.clientWidth;
      var h = area.clientHeight;
      if (!(w > 0 && h > 0)) return;
      var st = NoAnswer.fitStyle(w, h);
      t.style.fontSize = st.fontSize + 'px';
      t.style.writingMode = st.vertical ? 'vertical-rl' : 'horizontal-tb';
      t.style.whiteSpace = st.vertical ? 'normal' : 'nowrap';
      if (st.vertical) t.style.textOrientation = 'mixed';
    });
  }"""
s = s.replace(anchor, new, 1)

# ── 2) generate() 两处 innerHTML 之后调 fitNoAnswer ─────────────────
a1 = """    var r1 = renderAll(opt);
    stage.innerHTML = r1.html;
    applyThemeToStage();"""
assert a1 in s, 'r1 block not found'
s = s.replace(a1, a1 + "\n    fitNoAnswer();", 1)

a2 = """      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
    }"""
assert a2 in s, 'r2 block not found'
s = s.replace(a2, """      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
      fitNoAnswer();
    }""", 1)

wr(p, s)
print('app.js ok.  fitNoAnswer def:', 'function fitNoAnswer' in s,
      ' calls:', s.count('fitNoAnswer()'))
