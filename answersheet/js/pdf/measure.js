/* ============================================================================
 * 测量层 —— 把渲染后的答题卡 DOM「读」成一份与设备无关的绘制清单
 *
 * 设计原则
 * ---------------------------------------------------------------------------
 * ① **预览是唯一真源。** 这里不重新计算任何几何 —— 红框位置、定位点、气泡、
 *    文字位置全部从已经排版好的 DOM 上量出来。这样导出件与预览天然一致，
 *    不会因为「几何算两遍」而漂移。
 *
 * ② **量矩形一律用 getBoundingClientRect()，但必须先把 transform 关掉。**
 *    `.preview-stage` 上有 `transform: scale(...)`，它会让
 *    getBoundingClientRect() 返回缩放后的值（实测 3.3095px/mm 而不是
 *    3.7795px/mm）。所以测量前先 `transform:none`，量完再恢复。
 *    ⚠ 不要用 offsetTop/offsetWidth 代替 —— 那个在 A3 三面布局、
 *      绝对定位子元素上会把「相对 offsetParent」和「相对面」搞混。
 *
 * ③ **文字用 Range 量，不用元素量。** 一个 <div> 里可能有多段文字、
 *    多个行盒；元素盒会把内边距/行高一起算进来，落笔位置就不准了。
 *    Range 给出的是**文字墨迹/行盒的范围**，配合基线偏移才是真位置。
 *
 * ④ **基线位置靠浏览器自己算。** 见 lineBoxBaselineOffsets()：
 *    插一个零宽 inline 探针，它的 `top + 探针高` 就是行盒基线。
 *    这比用 font-metrics 近似准得多，而且对 flex 居中、line-height、
 *    vertical-align 全部自动成立。
 * ==========================================================================*/
(function (g) {
  'use strict';

  var AS = g.AS = g.AS || {};

  var PX_PER_MM = 96 / 25.4;          // 3.7795275591
  var MM_PER_PX = 25.4 / 96;
  function mm(px) { return px * MM_PER_PX; }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* ── 颜色 ─────────────────────────────────────────────────────────────
     把 CSS 的 rgb()/rgba() 转成 [r,g,b] 与 alpha。
     ⚠ 不用 canvas 取色：那要建 DOM，且对 currentColor 无效。 */
  function parseColor(s) {
    if (!s) return null;
    s = String(s).trim();
    if (s === 'transparent' || s === 'none') return null;
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(s);
    if (!m) return null;
    var a = (m[4] === undefined) ? 1 : parseFloat(m[4]);
    if (a <= 0) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  function isVisible(el) {
    var cs = g.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  /* ── 逐文字节点求「该行行盒顶 → 基线」的像素距离 ─────────────────────
     为什么不能只在 host 上插一次探针：
       一个元素里可以有**多个文字节点、每个占一行**（「注意事项」5 条就是
       5 个独立节点挤在同一个 .as-note-main 里）。探针插在 host 最前面时，
       底边只落在 **host 首行**基线上 —— 后面 4 个节点会被算成同一高度，
       结果 5 条批注全叠在一起。

     做法：把该文字节点临时裹进一个 `display:inline` 的 span，
       在 span 最前面插基线探针，量完立刻原样还原。
       内联包裹沿用的是**同一个行盒**，不改变换行结果，所以 DOM 几何不变，
       而探针这时就落在**这一行**的基线上。

     为什么不用 canvas 量字形墨迹：Canvas2D 与 DOM 的行盒度量规则不同
       （实测同一个字在 canvas 上比 DOM 低 1~2px），据此算基线会整体偏移。
     为什么不用 font-metrics 推算：要硬编码 SimHei/SimSun 的
       hhea/OS-2 比例，字体一换就错；而 `line-height:normal` 时
       Chrome 用哪一组 metric 并无公开保证。实测法没有这些假设。 */
  function lineBoxBaselineOffsets(doc, nodes) {
    var res = new Array(nodes.length);
    var wrap = doc.createElement('span');
    wrap.setAttribute('data-as-baseline-wrap', '1');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'display:inline;margin:0;padding:0;border:0;' +
      'font:inherit;letter-spacing:inherit;vertical-align:baseline;';
    var probe = doc.createElement('span');
    probe.setAttribute('data-as-baseline-probe', '1');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'display:inline-block;width:0;height:0;' +
      'vertical-align:baseline;overflow:hidden;margin:0;padding:0;border:0;';

    for (var i = 0; i < nodes.length; i++) {
      var tn = nodes[i];
      var host = tn.parentNode;
      res[i] = null;
      if (!host || host.nodeType !== 1 || !tn.nodeValue || !tn.nodeValue.trim()) continue;
      try {
        host.insertBefore(wrap, tn);
        wrap.appendChild(tn);
        wrap.insertBefore(probe, wrap.firstChild);
        var pr = probe.getBoundingClientRect();
        var wr = wrap.getBoundingClientRect();
        /* 单行节点：wrap 的顶就是该行行盒顶。多行节点：wrap 会跨多行，
           这时 pr 落在**首行**基线上，下面 splitIntoLines 会按各行 top 重算。 */
        res[i] = { off: pr.bottom - wr.top, top: wr.top };
      } catch (e) {
        res[i] = null;
      } finally {
        /* 还原：把文字节点放回 wrap 原来的位置，再删掉 wrap（探针随之消失） */
        if (wrap.parentNode) {
          if (tn.parentNode === wrap) wrap.parentNode.insertBefore(tn, wrap);
          wrap.parentNode.removeChild(wrap);
        }
      }
    }
    return res;
  }

  /* ── 把一段文字切成「行」 ─────────────────────────────────────────────
     ⚠ 不能用 Range.getClientRects()：它对**竖排/多盒**文字会把整段合并成
       一个矩形返回（`.as-note-left` 是 display:flex、每字一个 flex item，
       实测 getClientRects() 只给 1 个高 24.9mm 的大矩形，按它取字只能取到
       1 个字）。所以改成**逐字符量**，再自己分行。

     分行判据（两条都满足才算同一行）：
       · 行盒顶相同（容差 0.8px，抗亚像素抖动）
       · 没有被 host 换下来（left 明显回退说明换行了，处理对齐文本时用）

     ⚠ 这个 O(n) 的逐字符 Range 在几百字的卡片上要建上万个 Range，
       但只有导出时会跑，实测一次 ~50ms，可接受。 */
  function splitIntoLines(doc, tn, pageRect) {
    var s = tn.nodeValue;
    var r = doc.createRange();
    var chars = [];
    var lastTop = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\n' || ch === '\r') { chars.push({ br: true }); continue; }
      r.setStart(tn, i); r.setEnd(tn, i + 1);
      var rs = r.getClientRects();
      if (!rs.length) { chars.push({ ch: ch, top: lastTop }); continue; }
      /* 单字符可能被拆成多个 rect（连字/代理对），取覆盖最广的那个 */
      var best = rs[0];
      for (var q = 1; q < rs.length; q++) {
        if (rs[q].width * rs[q].height > best.width * best.height) best = rs[q];
      }
      chars.push({ ch: ch, top: best.top, left: best.left, right: best.right,
                   bottom: best.bottom });
      lastTop = best.top;
    }

    /* ── 竖排（writing-mode: vertical-rl）────────────────────────────
       ⚠ 竖排的「一行」是**一列**：同一列里每个字的 x 相同、top **各不相同**。
         用下面的横排分组规则（按 top 归并）会把整段拆成一字一组，
         再按 top 排序后拼起来 —— 实测「考生请勿在此区域作答」被拼成
         「考真请书试在此区域作答」。所以竖排必须按 x 收列，列内按 top 排序。 */
    var vertical = false;
    try {
      vertical = /vertical/.test(
        doc.defaultView.getComputedStyle(tn.parentNode).writingMode || '');
    } catch (e) { vertical = false; }
    if (vertical) return splitVertical(chars);

    /* 分组：top 相同（±0.8px）归为一行 */
    var lines = [], cur = null;
    chars.forEach(function (c) {
      if (c.br) { cur = null; return; }
      if (c.top === null || c.top === undefined) { if (cur) cur.push(c); return; }
      if (!cur || Math.abs(c.top - cur[0].top) > 0.8) {
        cur = [c];
        lines.push(cur);
      } else {
        cur.push(c);
      }
    });

    return lines.map(function (line) {
      var left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      var text = '';
      line.forEach(function (c) {
        text += c.ch;
        if (c.left < left) left = c.left;
        if (c.right > right) right = c.right;
        if (c.top < top) top = c.top;
        if (c.bottom > bottom) bottom = c.bottom;
      });
      return {
        text: text,
        x: r3(mm(left - pageRect.left)),
        w: r3(mm(right - left)),
        topPx: top,
        h: r3(mm(bottom - top))
      };
    }).filter(function (L) { return L.text.trim().length > 0; });
  }

  /* ── 竖排：按 x 收列 ────────────────────────────────────────────────
     列内按 top 升序（自上而下），列间按 x 降序（vertical-rl 从右往左）。

     每个字回一条 run，而不是整列一条：竖排的字号可能大到一列只放得下
     几个字、字距又不等于字号，硬凑成一条串会让后面的字整体跑偏。
     逐字定位的误差只来自字形本身的基线偏移。

     y 用「字框中心」而不是行盒基线 —— 竖排的行盒基线是**竖着**的，
     拿它当 y 没有意义。CJK 在 `text-orientation: upright` 下字面居中，
     所以框心加 (desc − 0.5em) 就是竖排的基线高度。 */
  function splitVertical(chars) {
    var cols = [], cur = null;
    chars.forEach(function (c) {
      if (c.br || c.left === undefined) { cur = null; return; }
      if (!cur || Math.abs(c.left - cur[0].left) > 0.8) { cur = [c]; cols.push(cur); }
      else cur.push(c);
    });
    cols.sort(function (a, b) { return b[0].left - a[0].left; });
    return cols.map(function (col) {
      col.sort(function (a, b) { return a.top - b.top; });
      var text = '';
      col.forEach(function (c) { text += c.ch; });
      var left = Math.min.apply(null, col.map(function (c) { return c.left; }));
      var right = Math.max.apply(null, col.map(function (c) { return c.right; }));
      var top = col[0].top;
      var bottom = col[col.length - 1].bottom;
      return {
        text: text,
        x: r3(mm(left)),
        w: r3(mm(right - left)),
        topPx: top,
        h: r3(mm(bottom - top)),
        vertical: true,
        chars: col.map(function (c) {
          return { ch: c.ch, left: c.left, right: c.right,
                   cx: (c.left + c.right) / 2, top: c.top, bottom: c.bottom };
        })
      };
    }).filter(function (L) { return L.text.trim().length > 0; });
  }

  /* ── 谱系文本：先分「行」，再把同一行上不同文字的 run 合并成一条 ────
     合并的目的是让 PDF 里的文字串可读、可搜索（而不是一个字一条 Tj）。
     合并条件：同一父元素、行盒顶相同、水平上首尾相接（缝隙 < 0.35mm）。 */
  function mergeRuns(runs) {
    var out = [];
    runs.sort(function (a, b) {
      if (Math.abs(a.top - b.top) > 0.8) return a.top - b.top;
      return a.x - b.x;
    });
    runs.forEach(function (r) {
      var prev = out[out.length - 1];
      /* 竖排逐字定位的 run 不参与合并：它们的 x 不同、共用同一个 top 区间，
         按水平相邻的规则合并会把不同列的字串到一起。 */
      if (prev && !prev.vertical && !r.vertical &&
          prev.font === r.font &&
          Math.abs(prev.size - r.size) < 0.01 &&
          Math.abs(prev.top - r.top) <= 0.8 &&
          Math.abs((prev.x + prev.w) - r.x) < 0.35 &&
          prev.align === r.align && Math.abs(prev.ls - r.ls) < 0.01) {
        prev.text += r.text;
        prev.w = r3(r.x + r.w - prev.x);
        prev.topOfRun = Math.min(prev.topOfRun, r.top);
        return;
      }
      out.push(r);
    });
    return out;
  }

  /* ── 主入口：量一张纸 ────────────────────────────────────────────────
     返回 {
       w, h,                      // 纸张 mm
       fills:  [{x,y,w,h,color}],  // 实心矩形（定位点 / 角标 / 缺考框…）
       strokes:[{x,y,w,h,color,lw}],// 描边矩形（红框 / 黑框 / 条形码虚线框…）
       texts:  [{x,yBaseline,text,font,size,color,align,ls}],
       stats:  {...}               // 便于自检
     } */
  function measurePage(pageEl, paper) {
    var doc = pageEl.ownerDocument;
    /* ⚠ 关掉祖先链上的 transform，否则 getBoundingClientRect 是缩放后的值 */
    var stage = pageEl.closest('.preview-stage');
    var savedT = null, savedW = null;
    if (stage) {
      savedT = stage.style.transform; savedW = stage.style.width;
      stage.style.transform = 'none';
    }
    /* 强制同步布局，保证读到的是未缩放的结果 */
    void pageEl.offsetHeight;

    var pageRect = pageEl.getBoundingClientRect();
    var S = pageRect.width / paper.w;            // px per mm（关掉 transform 后应 ≈3.7795）

    var out = {
      w: paper.w, h: paper.h, scale: S,
      fills: [], strokes: [], texts: [], debug: [],
      stats: { nodes: 0, texts: 0 }
    };

    function boxOf(r) {
      return {
        x: r3(mm(r.left - pageRect.left)),
        y: r3(mm(r.top - pageRect.top)),
        w: r3(mm(r.width)),
        h: r3(mm(r.height))
      };
    }

    /* ── 1. 矩形：实心 / 描边 ─────────────────────────────────────────
       只收「有背景色」或「有边框」的元素，且必须够大或明显是图形
       （气泡 2.4mm 也算）。文字容器即使有 1px border 也照收，
       因为红框/黑框就是这样实现的。 */
    var all = pageEl.querySelectorAll('*');
    Array.prototype.forEach.call(all, function (el) {
      if (el.getAttribute('data-as-baseline-probe')) return;
      /* 预览专用装饰不进导出件 */
      if (el.classList.contains('as-face-guide')) return;
      if (el.closest('.as-face-guide')) return;
      if (!isVisible(el)) return;
      var cs = g.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 0.4 || r.height < 0.4) return;

      var bg = parseColor(cs.backgroundColor);
      var bt = parseFloat(cs.borderTopWidth) || 0;
      var bl = parseFloat(cs.borderLeftWidth) || 0;
      var brw = parseFloat(cs.borderRightWidth) || 0;
      var bb = parseFloat(cs.borderBottomWidth) || 0;
      var hasBorder = (bt + bl + brw + bb) > 0;

      if (bg) {
        var b = boxOf(r);
        out.fills.push({ x: b.x, y: b.y, w: b.w, h: b.h, color: bg,
                         cls: String(el.className).slice(0, 48) });
      }
      if (hasBorder) {
        var bc = parseColor(cs.borderTopColor) || parseColor(cs.borderLeftColor);
        if (bc) {
          var bb2 = boxOf(r);
          /* border-box 的描边要画在盒**外缘内**，jsPDF 的 rect 以线宽为中心，
             所以先取外缘再往里收半个线宽。CSS 的 border 是画在盒内的。 */
          out.strokes.push({
            x: bb2.x, y: bb2.y, w: bb2.w, h: bb2.h,
            lw: r3(mm(bt)),
            color: bc,
            dashed: cs.borderTopStyle === 'dashed' || cs.borderTopStyle === 'dotted',
            cls: String(el.className).slice(0, 48)
          });
        }
      }
    });

    /* ── 2. 文字 ──────────────────────────────────────────────────────
       分三趟，顺序很重要：
         ① 收集所有文字节点
         ② **逐节点**插探针量基线（会短暂改动 DOM，量完全撤）
         ③ 再读各行文字与样式 —— 此时 DOM 已复原，几何可靠
       把 ② 放在 ③ 之前，是为了避免「边插探针边量正文」时行数被探针带偏。 */
    var walker = doc.createTreeWalker(pageEl, g.NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return g.NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p || p.nodeType !== 1) return g.NodeFilter.FILTER_REJECT;
        if (!isVisible(p)) return g.NodeFilter.FILTER_REJECT;
        if (p.closest('.as-face-guide')) return g.NodeFilter.FILTER_REJECT;
        /* 非答题区里的字也是真文字，要收 */
        return g.NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var tn;
    while ((tn = walker.nextNode())) nodes.push(tn);
    /* ② 逐节点测「行盒顶 → 基线」，会短暂改动 DOM，量完全部还原 */
    var baseInfo = lineBoxBaselineOffsets(doc, nodes);

    var runs = [];
    nodes.forEach(function (tn, ni) {
      var host = tn.parentNode;
      var hcs = g.getComputedStyle(host);

      var fam = hcs.fontFamily || '';
      var fontKey = /SimHei|黑体|Hei/i.test(fam) ? 'hei' : 'sun';
      var sizePt = parseFloat(hcs.fontSize) * 72 / 96;   // px → pt
      var color = parseColor(hcs.color);
      if (!color) return;
      var ls = hcs.letterSpacing === 'normal' ? 0 : parseFloat(hcs.letterSpacing) * MM_PER_PX;
      var align = ({ center: 'center', right: 'right', end: 'right' })[hcs.textAlign] || 'left';
      var weight = parseInt(hcs.fontWeight, 10) || 400;

      var lines = splitIntoLines(doc, tn, pageRect);
      if (!lines.length) return;
      out.stats.nodes++;

      /* ③ 行盒顶 → 基线：探针量出的就是「行盒顶 → 基线」的常量偏移。
         同一元素内各行行高一致，所以这个偏移对每行都成立；
         splitIntoLines 已经给出了每行真实的 topPx，直接相加即可。 */
      var bi = baseInfo[ni];
      var baseOffPx = (bi && isFinite(bi.off)) ? bi.off : (parseFloat(hcs.fontSize) || 16) * 0.88;

      out.debug.push({
        cls: String(host.className).slice(0, 40),
        text: tn.nodeValue.slice(0, 16), lines: lines.length,
        top0: r3(mm(lines[0].topPx - pageRect.top)),
        baseOffMM: r3(mm(baseOffPx)),
        y0: r3(mm(lines[0].topPx + baseOffPx - pageRect.top)),
        lh: hcs.lineHeight, fs: hcs.fontSize
      });

      lines.forEach(function (L) {
        /* ── 竖排：**逐字一条 run，各带自己的坐标** ────────────────────
           试过「一列一条 run」让它可整串搜索，结论是**不能这么做**：
           PDF 的文本对象是水平推进的（Tj 沿基线走，字距由字体推进宽度定）。
           一列 11 个字 @45pt = 495pt = 174.6mm，从 x=97.2mm 起画，
           末尾 3 个字直接跑出纸外 —— 实测 `pdftotext` 只能抽出
           「考生请不要在此区」（少「域作答」）。jsPDF 3.0.4 不提供文本
           渲染模式（`Tr`）也没有垂直书写模式，而用变换矩阵旋转 90° 会把
           CJK 字面转倒（`text-orientation` 的效果要的是每个字都正立）。
           所以竖排只能逐字落笔：位置精确、不出纸。

           ⚠ 代价：这样 PDF 里是一字一个文本对象，`pdftotext` 抽出来是
             一字一行，**搜「注意事项」这种整词搜不到**（横排文字不受影响）。
             这是 upright CJK 竖排在 PDF 文本模型里的固有限制，不是坐标错误。

           y 的算法：竖排的行盒基线是**竖着**的，不能拿行盒顶加偏移当 y。
           CJK 在 `text-orientation: upright` 下字面在 em 框里居中，
           所以基线 = 字框中心 + (asc − 0.5em)，
           asc 取 0.859375（SimHei/SimSun 的 hhea ascent）。
           ⚠ 不用 (desc − 0.5em)：那会让整列比预览下移约 0.5×行高 ——
             实测「注意事项」四字 y 差 0.0000mm（对齐预览）。
           x 取字框左缘：CJK upright 下字框宽 = em，左缘落笔即可，
           不需要算串宽（`getTextWidth` 对子集字形会返回 NaN）。 */
        if (L.vertical) {
          var em = parseFloat(hcs.fontSize) || 16;
          L.chars.forEach(function (c) {
            runs.push({
              x: r3(mm(c.left - pageRect.left)),
              w: r3(mm(c.right - c.left)),
              y: r3(mm((c.top + c.bottom) / 2 + (0.859375 - 0.5) * em
                       - pageRect.top)),
              top: c.top,
              text: c.ch, font: fontKey, size: sizePt, color: color,
              align: 'left', ls: 0, weight: weight,
              h: r3(mm(c.bottom - c.top)),
              vertical: true,
              cls: String(host.className).slice(0, 48)
            });
          });
          return;
        }
        /* splitIntoLines 已经给出每行真实的 topPx，加上恒定偏移即为基线 */
        var baselinePx = L.topPx + baseOffPx;
        runs.push({
          x: L.x, w: L.w,
          y: r3(mm(baselinePx - pageRect.top)),
          top: L.topPx,                      // px，仅用于合并判定
          text: L.text, font: fontKey, size: sizePt, color: color,
          align: align, ls: r3(ls), weight: weight, h: L.h,
          cls: String(host.className).slice(0, 48)
        });
      });
    });

    /* 合并相邻 run，让 PDF 里的文字可读可搜 */
    var merged = mergeRuns(runs);
    merged.forEach(function (r) {
      delete r.top; delete r.topOfRun;
      out.texts.push(r);
      out.stats.texts++;
    });

    /* 恢复 transform */
    if (stage) { stage.style.transform = savedT; stage.style.width = savedW; }
    return out;
  }

  AS.pdfMeasure = {
    mm: mm, r3: r3, parseColor: parseColor,
    measurePage: measurePage,
    PX_PER_MM: PX_PER_MM
  };
})(window);
