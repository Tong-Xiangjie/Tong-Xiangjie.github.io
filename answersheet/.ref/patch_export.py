import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()

start = s.index('    var worker = html2pdf().set({')
end = s.index('  if (document.readyState === \'loading\') {')

new = '''    /* ── 导出流程 ────────────────────────────────────────────────────────
     * 分两步，两步都实测过：
     *   ① 逐张纸 toCanvas() —— 单张纸截出来是对的（1588×2246 @scale2）。
     *   ② 把这些画布纵向拼成一张大画布，塞回 worker 的 prop.canvas，
     *      再走它自己的 toPdf() 分页。
     *
     * 为什么不把「整叠纸」直接交给 html2canvas：它只截出一张纸的高度。
     *   原因：.as-page 在 .page-wrap 里，克隆到 html2pdf 的容器后
     *   每张纸都从容器顶部开始，互相重叠，容器高度只等于一张纸。
     *   （实测 2 张纸 → canvas 1588×2246，第 3 页全白。）
     *
     * 拼成一张的好处：大画布高 = 张数 × 单张高，正好被 pageSize 整除，
     * toPdf() 分页得到的页数不多不少，每页内容完整。
     * ------------------------------------------------------------------ */
    var pages = Array.prototype.slice.call(wrap.querySelectorAll('.as-page'));
    var opts = function () {
      return {
        margin: 0,
        filename: name + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: [paper.w, paper.h], orientation: paper.orientation }
      };
    };

    var chain = Promise.resolve([]);
    pages.forEach(function (pageEl) {
      chain = chain.then(function (acc) {
        var w = html2pdf().set(opts()).from(pageEl);
        /* ⚠ 读 w.prop.canvas，不要用 .get('canvas')：
           get() 返回的是 worker 的当前任务结果（一个 Worker 对象），不是画布。 */
        return w.toCanvas().then(function () {
          var cv = w.prop.canvas;
          if (!cv || !cv.width || !cv.height) {
            throw new Error('第 ' + (acc.length + 1) + ' 张渲染为空');
          }
          acc.push(cv);
          return acc;
        });
      });
    });

    chain.then(function (canvases) {
      /* 纵向拼接 */
      var single = canvases[0];
      var combined = document.createElement('canvas');
      combined.width = single.width;
      combined.height = single.height * canvases.length;
      var cx = combined.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, combined.width, combined.height);
      canvases.forEach(function (cv, i) {
        cx.drawImage(cv, 0, i * single.height);
      });

      /* 用一个 worker 跑 toPdf()：把拼好的画布写进 prop.canvas，
         它就会按 pageSize 自动分页并生成 PDF。 */
      var w0 = html2pdf().set(opts()).from(wrap);
      return w0.toContainer().then(function () {
        w0.prop.canvas = combined;
        w0.prop.pdf = null;
        return w0.toPdf().outputPdf('datauristring');
      });
    }).then(function (dataUri) {
      var a = document.createElement('a');
      a.href = dataUri;
      a.download = name + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }).then(function () {
      cleanup();
    }).catch(function (err) {
      cleanup();
      alert('导出失败：' + (err && err.message ? err.message : err));
      if (global.console) console.error('[答题卡] 导出失败', err);
    });
  }

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
