// 零依赖 PNG 解码 + CDP 截图取像素（给 verify-heatmap 用）
// ★ 为什么要这个：`getComputedStyle().backgroundImage` 只说明"CSS 里写了渐变"，
//   不能证明"屏幕上真的是渐变"。这个模块把图例条**截成位图**再逐像素读，
//   才能抓住"整条纯色 / 变化挤在前 25%" 这类只有肉眼能看出来的问题。
import { inflateSync } from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 解 PNG（8bit，颜色类型 2=RGB / 6=RGBA，无隔行），支持全部 5 种行滤波。 */
export function decodePng(buf) {
    if (buf.length < 8 || SIG.some((b, i) => buf[i] !== b)) throw new Error('不是 PNG');
    let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0); h = data.readUInt32BE(4);
            bitDepth = data[8]; colorType = data[9]; interlace = data[12];
        } else if (type === 'IDAT') idat.push(Buffer.from(data));
        else if (type === 'IEND') break;
        off += 12 + len;                                   // len + type(4) + data + crc(4)
    }
    if (bitDepth !== 8) throw new Error('只支持 8bit PNG，实际 ' + bitDepth);
    if (interlace !== 0) throw new Error('不支持隔行 PNG');
    const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
    if (!ch) throw new Error('只支持 RGB/RGBA PNG，实际 colorType ' + colorType);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * ch;
    const out = Buffer.alloc(stride * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
        const ft = raw[p++];
        const line = raw.subarray(p, p + stride); p += stride;
        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? cur[x - ch] : 0;
            const b = prev ? prev[x] : 0;
            const c = (prev && x >= ch) ? prev[x - ch] : 0;
            let v = line[x];
            if (ft === 1) v += a;
            else if (ft === 2) v += b;
            else if (ft === 3) v += (a + b) >> 1;
            else if (ft === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[x] = v & 0xff;
        }
    }
    return { width: w, height: h, channels: ch, data: out };
}

/** 取像素：px(x,y) → [r,g,b,a]（RGB PNG 的 a 补 255）。坐标基于 PNG 自身。 */
export function pixelAt(img, x, y) {
    const cx = Math.max(0, Math.min(img.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
    const i = (cy * img.width + cx) * img.channels;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.channels === 4 ? img.data[i + 3] : 255];
}

/**
 * CDP 截一张**整页视口**截图并解码成像素图；返回 { img, px }，
 *   px(cssX, cssY) 用 CSS 视口坐标取像素（内部自动乘 devicePixelRatio）。
 * ★ 为什么不用 `clip` 参数：headless 下带 `clip.scale`（dpr≠1）时实测截出来的
 *   并不是请求的那块区域（尺寸对、内容错位），解析出的"像素"全是别处的颜色 ——
 *   这种错最阴：断言还在跑，数字却是假的。整页截图 + 自己按 dpr 定位没有这个问题。
 * ★ `background: 'white'`：`captureScreenshot` 会把透明像素**合成到底色**上
 *   （截图里 alpha 恒为 255），不定死底色就会出现"换台机器断言颜色不同"的假失败。
 *   也因此**不要**指望从截图里读 alpha，要按"合成后的颜色"判深浅。
 */
export async function shotViewport(send, dpr = 1, bg = 'white') {
    const res = await send('Page.captureScreenshot', { format: 'png', ...(bg ? { background: bg } : {}) });
    const img = decodePng(Buffer.from(res.data, 'base64'));
    return {
        img,
        dpr,
        px: (cssX, cssY) => pixelAt(img, cssX * dpr, cssY * dpr)
    };
}

/** 两个 RGB(A) 的通道最大差（用于"互不相同""与背景接近"这类判据）。 */
export const maxChanDiff = (a, b) => Math.max(...[0, 1, 2].map(i => Math.abs(a[i] - b[i])));
/** WCAG 相对亮度（只看 R,G,B）。 */
export function relLum(px) {
    const f = (v) => { const t = v / 255; return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(px[0]) + 0.7152 * f(px[1]) + 0.0722 * f(px[2]);
}
/** 两个像素的亮度比（用于"对比度逐档增大"）。 */
export function contrast(a, b) {
    const la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** 合成：把半透明像素叠到不透明底色上，得到"看上去的颜色"。 */
export function over(fg, bg) {
    const a = fg[3] / 255;
    return [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a)).valueOf()).concat(255);
}
