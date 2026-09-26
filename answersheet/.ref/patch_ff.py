import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/app.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① fitFrames 改为接收 faces 参数（不再读 state.faces）
rep("""  function fitFrames() {
    var stage = $('stage');
    if (!stage) return;""",
"""  /* @param facesArr renderAll() 刚返回的 faces（**必须显式传入**）
     ⚠ 不能读 state.faces —— 它在 generate() 里是渲染**之后**才赋值的，
       首次生成时它还是上一轮的值（或 undefined），闭环就成了空转，
       框体的定高也永远抹不平。 */
  function fitFrames(facesArr) {
    var stage = $('stage');
    if (!stage) return;""", 'fitFrames 签名')

rep("""    var facesArr = state.faces || [];
    for (var pass = 0; pass < 3; pass++) {""",
"""    facesArr = facesArr || [];
    for (var pass = 0; pass < 3; pass++) {""", '去掉 state.faces')

# ② 两处调用点传入对应的 faces
rep("""    var r1 = renderAll(opt);
    stage.innerHTML = r1.html;
    applyThemeToStage();
    fitFrames();
    fitNoAnswer();""",
"""    var r1 = renderAll(opt);
    stage.innerHTML = r1.html;
    applyThemeToStage();
    fitFrames(r1.faces);
    fitNoAnswer();""", '调用点 1')

rep("""      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
      fitFrames();
      fitNoAnswer();""",
"""      r = renderAll(opt);
      stage.innerHTML = r.html;
      applyThemeToStage();
      fitFrames(r.faces);
      fitNoAnswer();""", '调用点 2')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
