import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')

p = 'js/builders/page.js'
s = io.open(p, encoding='utf-8').read()

start = s.index('  /* 注意事项框（内含缺考框）')
end = s.index('  /** 页眉：后续页 */')
print('replacing bytes', start, '..', end)

new = '''  /* 注意事项框（内含缺考框）
   * 小方框位于框内左下，其左缘与左侧定标带列心对齐（CSS 的 left 偏移实现）。
   * y 由 SPECIAL 的「框顶」给出，与左侧定标块共用同一个行心。 */
  function notesBox() {
    /* 底栏高固定 9mm，缺考框的行心相对**注意事项框自身**定位：
       框高固定 -> 底栏位置确定 -> 框心确定，与左侧定标块同源。 */
    var bottomH = 9;
    var absentTop = r3(SPECIAL.absentBoxTop - SPECIAL.noteTop - (CHROME.rowNote - bottomH));
    return '<div class="as-note">' +
      '<div class="as-note-left">注意事项</div>' +
      '<div class="as-note-main">' +
      '1. 答题前，考生先填写好自己的姓名、准考证号，并认真核对条形码上的姓名、准考证号、考室和座位号；<br>' +
      '2. 选择题请按题号用 2B 铅笔填涂方框，修改时用橡皮擦干净，不留痕迹；<br>' +
      '3. 非选择题部分请按题号用 0.5 毫米黑色墨水签字笔书写，否则作答无效；<br>' +
      '4. 在草稿纸、试题卷上答题无效；<br>' +
      '5. 请勿折叠答题卡，保持字体工整、笔迹清晰、卡面清洁。' +
      '</div>' +
      '<div class="as-note-bottom">' +
      '<span class="as-check-box" style="top:' + absentTop + 'mm"></span>' +
      '<span class="as-note-absent-tip" style="top:' + (absentTop - 0.4) + 'mm">' +
        '此方框为缺考考生标记，由监考员用 2B 铅笔填涂</span>' +
      '</div>' +
      '</div>';
  }

  /** 页眉：首页
   *  三行网格：标题行 / 信息行 / 注意事项+条形码行。
   *  行高固定，所以「信息行」永远紧跟在标题下面 —— 标题一行还是两行都不会重叠。 */
  function chromeFirst(meta, pos) {
    var h = '<div class="as-head">';

    /* 第 1 行：标题 */
    h += '<div class="as-head-title">';
    if (meta.title) {
      h += '<div class="as-title-main">' + esc(meta.title) + '</div>';
    }
    if (meta.subject) {
      h += '<div class="as-title-sub">' + esc(meta.subject) + '答题卡</div>';
    }
    h += '</div>';

    /* 第 2 行：考生信息（姓名 / 班级 / 准考证号） */
    h += '<div class="as-info"><div class="as-info-row">' +
         '<span class="as-info-label">姓名：</span><span class="as-info-fill name"></span>' +
         '<span class="as-info-label">班级：</span><span class="as-info-fill seat"></span>' +
         '<span class="as-info-label">准考证号</span>' +
         zkTable(meta.zkLength) +
         '</div></div>';

    /* 第 3 行：注意事项框 + 条形码区（同一行） */
    h += '<div class="as-note-row">' +
         notesBox(pos) +
         '<div class="as-barcode">' +
         '<div class="as-barcode-title">贴条形码区</div>' +
         '<div class="as-barcode-tip">（正面朝上，切勿贴出虚线方框）</div>' +
         '</div>' +
         '</div>';

    h += '</div>';
    return h;
  }

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
