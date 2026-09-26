import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

# 每张纸 toCanvas 前后打点
old = """    var chain = Promise.resolve([]);
    pages.forEach(function (pageEl) {
      chain = chain.then(function (acc) {
        var w = html2pdf().set(opts()).from(pageEl);"""
new = """    /* 进度打点：导出链路较长（逐纸 toCanvas → 拼接 → toPdf → dataURI），
       出问题时要能一眼看出卡在哪一步。只在 console 输出，界面上不显示。 */
    var t0 = (global.performance || Date).now();
    function step(msg) {
      if (!global.console) return;
      console.log('[答题卡] ' + msg + '  +' +
        Math.round(((global.performance || Date).now() - t0)) + 'ms');
    }
    step('导出开始，共 ' + pages.length + ' 张纸');

    var chain = Promise.resolve([]);
    pages.forEach(function (pageEl, pi) {
      chain = chain.then(function (acc) {
        step('第 ' + (pi + 1) + ' 张 toCanvas 开始');
        var w = html2pdf().set(opts()).from(pageEl);"""
if old not in s:
    print('!! anchor 1 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """          acc.push(cv);
          return acc;
        });"""
new = """          acc.push(cv);
          step('第 ' + (pi + 1) + ' 张 toCanvas 完成 ' + cv.width + 'x' + cv.height);
          return acc;
        });"""
if old not in s:
    print('!! anchor 2 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """      canvases.forEach(function (cv, i) {
        cx.drawImage(cv, 0, i * single.height);
      });"""
new = """      canvases.forEach(function (cv, i) {
        cx.drawImage(cv, 0, i * single.height);
      });
      step('拼接完成 ' + combined.width + 'x' + combined.height +
           '（单张高 ' + single.height + '，页高 ' + pxH + '）');"""
if old not in s:
    print('!! anchor 3 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """      return w0.toContainer().then(function () {
        w0.prop.canvas = combined;
        w0.prop.pdf = null;
        return w0.toPdf().outputPdf('datauristring');
      });"""
new = """      return w0.toContainer().then(function () {
        step('toContainer 完成，开始 toPdf');
        w0.prop.canvas = combined;
        w0.prop.pdf = null;
        return w0.toPdf().outputPdf('datauristring');
      });"""
if old not in s:
    print('!! anchor 4 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    }).then(function (dataUri) {
      var a = document.createElement('a');"""
new = """    }).then(function (dataUri) {
      step('dataURI 生成完成，长度 ' + (dataUri ? dataUri.length : 0));
      var a = document.createElement('a');"""
if old not in s:
    print('!! anchor 5 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    }).catch(function (err) {
      cleanup();"""
new = """    }).catch(function (err) {
      step('失败：' + (err && err.message ? err.message : err));
      cleanup();"""
if old not in s:
    print('!! anchor 6 missing'); sys.exit(1)
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
