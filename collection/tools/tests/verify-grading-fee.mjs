// ==================== verify-grading-fee.mjs ====================
// 评级费台账（notecollection/data/grading_fee.js）的验证。分两段：
//
// 【静态段】数据本身 + 口径 + 加载/导航边界。快、不受时序影响，而且把页面里**真正在跑**
//   的那几个函数（special.js 里解析台账并转成时间轴条目）直接拿来跑一遍 —— 不是抄一份
//   期望值硬编码。用户裁定过的口径逐条钉住：
//     ① **匹配不到 copyId 的行 = 已售出 ⇒ 不计入支出、不进时间轴**（本文件最重要的一条）；
//     ② 支出取**折后价**（实际费用 = 原价 × 0.9），不是原价；
//     ③ 按【付款日期】计入，不是送评日期（日期只断言格式与"每批唯一/付款日 ≠ 送评日"）；
//     ④ 批次 4（PJ20260615262532）留档 1615.5 元（汇总块字面"1,615元"是显示舍入；
//        由"清单原价合计 × 0.9 = 清单实收"这条恒等式机制性地钉住）；
//     ⑤ 重复编码（现算挑出）只算第一次，后面的行计 0/0；
//     ⑥ 换壳行（现算挑出 reholder: true 的那行）**照录入计**（它匹配得上 copyId，未售出）；
//     ⑦ 每批同时有"表格实收（留档）"与"未售出部分（支出）"两套合计，两者都断言；
//     ⑧ 台账只精简存 cert + 两个金额，展示文字**从藏品记录按 copyId 取**；
//     ⑨ 评级费不是藏品：藏品总数仍 396 件，均价/评级/年代统计/价格清单都不受影响；
//     ⑩ 台账分类**不进导航**，但数据照常加载、统计照常可用。
//
// ★★ 本用例**不手抄任何期望值**（2026-11 收口）：EXPECT / SOLD_CERTS / SHEET_EXPECT / XLSX_SHA /
//   WANT_AMTS / WANT_DATES 这类"把数据抄成常量"的写法全部删除，改成**从数据现算 + 恒等式**：
//     · 口径关系：paidFee = Σ非换壳行、sheetPaidFee = Σitems + 已售出行、留档 − 支出 = 已售出 + 换壳、
//       折后 = 原价 × 0.9（逐行 + 逐批留档两侧都验）；
//     · 已售出行 = **清单里有、台账 items 里没有**的行（多重集做差现算），再断言它们在真实藏品里
//       一个 copyId 都匹配不上 —— 判据不变，只是不再写死那 4 个认证码；
//     · xlsx 不再钉 sha256（用户明确点名那是错误做法），改成"存在 + 解析成功 + 与台账逐批对账"；
//     · 指名批次/认证码（批次 4、换壳 FJ772552、重复编码 26626187）改成**按性质现找**；
//     · "数据里当前没有这个场景"的检查用 `skip()`（`○ 跳过`，单独计数、既不计通过也不计失败，
//       并打印原因），结尾汇总里打出跳过数。
//
// 【浏览器段】把"评级费出现在币海拾年时间轴里、与同期藏品按日期混排"这件事在真实页面上验一遍
//   （静态段只能证明数据与函数对，证明不了它们真的被渲染出来）。
//
// 退出码：0 = 通过；1 = 有断言失败；2 = 找不到 Chrome（环境问题）。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label); }
}
// ★ 只有"数据里当前没有这个场景"（判据本身不可能有断言值）时才用 skip：
//   **保留**这条检查、不计通过也不计失败，但必须把原因写清楚（否则就成了假绿）。
const skip = (m) => { skipped++; console.log(`  ○ 跳过 ${m}`); };
function section(t) { console.log('\n══════ ' + t + ' ══════'); }

const NUM = (s) => parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, ''));
const R1 = (n) => Math.round(n * 10) / 10;
const cnDate = (iso) => { const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : iso; };

// ══════════════════════════════════════════════════════════════
section('① 数据文件本身：精简后的形状与逐字口径');
// ══════════════════════════════════════════════════════════════
const dataSrc = readFileSync('notecollection/data/grading_fee.js', 'utf8');
const sctx = { console, window: null, JSON, Object, Array, String, Number, RegExp, Math, Boolean, Set, Map, Date, Error, isFinite, parseFloat, parseInt, isNaN };
sctx.window = sctx;
vm.createContext(sctx);
vm.runInContext(dataSrc + '\n;window.__g = JSON.stringify(gradingFeeData);', sctx, { filename: 'grading_fee.js' });
const G = JSON.parse(sctx.__g);

// ══════════════════════════════════════════════════════════════
// 【本用例的所有"期望值"一律**从数据现算**，不再手抄常量】
//   三个互相独立的数据源，交叉对账（谁都不是"第二份手抄期望值"）：
//     ① notecollection/data/grading_fee.js        —— 台账（人手维护）；
//     ② notecollection/readmes/image/grading_fee/PJ*.xlsx —— 5 份原始清单；
//     ③ collection/data/**（由 data-loader 的 walkTree 走一遍）—— 真实藏品的 copyId。
//   判据（用户裁定）：
//     · items[] 里留下的行 = 清单里**匹配得上藏品 copyId**的行（未售出）；
//     · 清单里有、items[] 里没有的行 = **匹配不到 copyId ⇒ 已售出**，不计入支出；
//     · 支出 paidFee = Σ(未售出 **且非换壳**)行的 paidFee；
//       留档 sheetPaidFee = 清单上的"实际费用"合计（含已售出行、含换壳行）。
//   ★ 刻意**不**给整张 xlsx 钉 sha256（用户明确点名：那是把"文件字节"当期望值，改一格就整片假红）。
//     改成三条能说明问题的东西：文件存在 + parseFeeSheet() 解析成功 + 解析结果与台账逐批对账。
// ══════════════════════════════════════════════════════════════
const DISCOUNT = 0.9;               // 台账里写明的"代理折扣9折"

// ── xlsx 只读解析（零依赖：手写 zip 目录 + zlib inflate）──
function xlsxEntries(buf) {
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('no EOCD');
    const count = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    const out = new Map();
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(pos + 10);
        const csize = buf.readUInt32LE(pos + 20);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const cmtLen = buf.readUInt16LE(pos + 32);
        const localOff = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
        const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
        const raw = buf.subarray(start, start + csize);
        out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
        pos += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
}
const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
// 返回：明细行数 / **逐行明细（cert + 原价 + 实收）** / 合计行两侧金额 / 逐行求和。
//   ★ 逐行明细是"现算已售出行"的依据：清单里有、台账 items 里没有的行 = 已售出。
function parseFeeSheet(disk) {
    const zip = xlsxEntries(readFileSync(disk));
    const ss = zip.get('xl/sharedStrings.xml').toString('utf8');
    const shared = [...ss.matchAll(/<si>[\s\S]*?<\/si>/g)].map(m =>
        [...m[0].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => xmlUnesc(x[1])).join(''));
    const sheet = zip.get('xl/worksheets/sheet1.xml').toString('utf8');
    const rows = [];
    for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ref = (cm[1].match(/\br="([A-Z]+)\d+"/) || [])[1] || '';
            const idx = ref ? ref.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : cells.length;
            const vmm = (cm[2] || '').match(/<v>([\s\S]*?)<\/v>/);
            const v = vmm ? xmlUnesc(vmm[1]) : '';
            cells[idx] = /\bt="s"/.test(cm[1]) ? (shared[+v] ?? '') : v;
        }
        rows.push(cells);
    }
    const h = rows.findIndex(c => c.some(x => x === '评级费原价'));
    if (h < 0) throw new Error('找不到表头行');
    const cList = rows[h].indexOf('评级费原价'), cPaid = rows[h].indexOf('实际费用');
    const details = [];
    let total = null;
    for (let i = h + 1; i < rows.length; i++) {
        if (rows[i].some(x => x === '合计')) { total = rows[i]; break; }
        if (/^\d+$/.test(String(rows[i][0] ?? '').trim()) && String(rows[i][1] ?? '').trim() !== '') details.push(rows[i]);
    }
    if (!total) throw new Error('找不到合计行');
    const num = (v) => Number(String(v ?? '').replace(/[,\s]/g, '')) || 0;
    return {
        detailRows: details.length,
        feeTotal: num(total[cPaid]),
        listTotal: num(total[cList]),
        listPerRow: R1(details.reduce((s, c) => s + num(c[cList]), 0)),
        paidPerRow: R1(details.reduce((s, c) => s + num(c[cPaid]), 0)),
        rows: details.map(c => ({ cert: String(c[1] ?? '').trim(), listFee: num(c[cList]), paidFee: num(c[cPaid]) }))
    };
}

// ── 每批的清单文件（相对仓库根的磁盘路径）+ 解析结果 ──
const LIST_FILES = G.batches.map(b => ({
    pj: b.pj,
    url: b.listUrl,
    // 页面在 collection/ 下，href="../notecollection/..." 解析后落在仓库根
    disk: b.listUrl ? b.listUrl.replace(/^\.\.\//, '') : null
}));
const EMPTY_SHEET = { detailRows: NaN, feeTotal: NaN, listTotal: NaN, paidPerRow: NaN, listPerRow: NaN, rows: [] };
const SHEETS = new Map();
for (const f of LIST_FILES) {
    if (!f.disk || !existsSync(f.disk)) { SHEETS.set(f.pj, null); continue; }
    try { SHEETS.set(f.pj, parseFeeSheet(f.disk)); } catch { SHEETS.set(f.pj, null); }
}
const sheetOf = (pj) => SHEETS.get(pj) || EMPTY_SHEET;

// ── 现算：逐批 / 全局的口径事实 ──
const ITEMS_OF = (b) => b.items || [];
const sumPaid = (rows) => R1(rows.reduce((s, i) => s + NUM(i.paidFee), 0));
const sumList = (rows) => R1(rows.reduce((s, i) => s + NUM(i.listFee), 0));
const sumSheetPaid = (rows) => R1(rows.reduce((s, r) => s + r.paidFee, 0));
const sumSheetList = (rows) => R1(rows.reduce((s, r) => s + r.listFee, 0));

const KEPT_ITEMS = G.batches.flatMap(ITEMS_OF);
const NON_RH_ITEMS = KEPT_ITEMS.filter(i => !i.reholder);         // 支出侧明细行
const RH_ITEMS = KEPT_ITEMS.filter(i => i.reholder);              // 换壳行

const KEPT_ROWS = NON_RH_ITEMS.length;                            // 支出侧行数
const KEPT_PAID = sumPaid(NON_RH_ITEMS);                          // 支出合计
const RH_ROWS = RH_ITEMS.length;
const RH_PAID = sumPaid(RH_ITEMS);
const ITEMS_PAID = sumPaid(KEPT_ITEMS);                           // items 全行之和（含换壳，不含已售出）
const SHEET_ROWS = G.batches.reduce((s, b) => s + (b.sheetItemCount || 0), 0);
const SHEET_PAID = R1(G.batches.reduce((s, b) => s + NUM(b.sheetPaidFee), 0));

// ★ 已售出行 = **清单里有、台账 items 里没有**的行（= 匹配不到藏品 copyId 的那些行）。
//   按多重集做差（同一编码可能重复出现，所以不能只比 Set）。
const SOLD_DETAIL = [];
const SOLD_BY_PJ = new Map();
for (const b of G.batches) {
    const stock = new Map();
    for (const i of ITEMS_OF(b)) stock.set(i.cert, (stock.get(i.cert) || 0) + 1);
    const mine = [];
    for (const r of sheetOf(b.pj).rows) {
        const n = stock.get(r.cert) || 0;
        if (n > 0) { stock.set(r.cert, n - 1); continue; }        // 匹配得上 ⇒ 未售出
        const row = { pj: b.pj, cert: r.cert, listFee: r.listFee, paidFee: r.paidFee };
        mine.push(row); SOLD_DETAIL.push(row);
    }
    SOLD_BY_PJ.set(b.pj, mine);
}
const soldOf = (b) => SOLD_BY_PJ.get(b.pj) || [];
const SOLD_ROWS = SOLD_DETAIL.length;
const SOLD_PAID = sumSheetPaid(SOLD_DETAIL);
const SOLD_CERTS = [...new Set(SOLD_DETAIL.map(r => r.cert))];

// 时间轴顺序 = 按【付款日期】升序
const ORDERED_BATCHES = G.batches.slice().sort((a, b) => String(a.paidDate).localeCompare(String(b.paidDate)));
const WANT_DATES = ORDERED_BATCHES.map(b => b.paidDate);
const WANT_AMTS = ORDERED_BATCHES.map(b => NUM(b.paidFee));

ok(G.batches.length > 0, `台账里有 ${G.batches.length} 个批次`);
ok(KEPT_ITEMS.length === KEPT_ROWS + RH_ROWS,
    `items 里共 ${KEPT_ITEMS.length} 行明细 = ${KEPT_ROWS} 非换壳 + ${RH_ROWS} 换壳（已剔除现算出的 ${SOLD_ROWS} 行已售出）`);
ok(NON_RH_ITEMS.length === KEPT_ROWS, `剔掉换壳后 ${KEPT_ROWS} 行参与支出（实际 ${NON_RH_ITEMS.length}）`);

// ★★ 逐批恒等式（本用例的核心）：**左式 = 台账自己声明的合计，右式 = 从明细/清单现算**。
//    一条都不写死数字，于是"改了数据忘了改合计""明细与清单对不上"会立刻照出来。
//    「留档 − 支出 = 已售出 + 换壳」与「折后 = 原价 × 0.9」是其中最有价值的两条口径关系。
const IDENT = [];
for (const b of G.batches) {
    const items = ITEMS_OF(b);
    const nonRh = items.filter(i => !i.reholder);
    const rh = items.filter(i => i.reholder);
    const sold = soldOf(b);
    const s = sheetOf(b.pj);
    const pairs = [
        ['itemCount = 非换壳行数', b.itemCount, nonRh.length],
        ['paidFee = Σ非换壳行 paidFee', NUM(b.paidFee), sumPaid(nonRh)],
        // ★ 注意 listFee 的口径与 paidFee 不同：它是 items **全部行**（含换壳）的折前原价之和
        //   （数据里就是这么记的：批次 4 = 1795 含换壳那 15 元，而支出 1602 不含它的 13.5 元）。
        ['listFee = Σitems listFee（含换壳）', NUM(b.listFee), sumList(items)],
        ['reholderCount = 换壳行数', b.reholderCount || 0, rh.length],
        ['reholderPaidFee = Σ换壳行 paidFee', NUM(b.reholderPaidFee || '0元'), sumPaid(rh)],
        ['soldCount = sheetItemCount − items 行数', b.soldCount, b.sheetItemCount - items.length],
        ['soldPaidFee = sheetPaidFee − Σitems paidFee', NUM(b.soldPaidFee), R1(NUM(b.sheetPaidFee) - sumPaid(items))],
        ['sheetPaidFee = Σitems paidFee + 已售出行之和', NUM(b.sheetPaidFee), R1(sumPaid(items) + sumSheetPaid(sold))],
        ['sheetListFee = Σitems listFee + 已售出行原价之和', NUM(b.sheetListFee), R1(sumList(items) + sumSheetList(sold))],
        ['sheetItemCount = 清单明细行数', b.sheetItemCount, s.detailRows],
        ['sheetPaidFee = 清单「实际费用」合计', NUM(b.sheetPaidFee), s.feeTotal],
        ['sheetListFee = 清单「评级费原价」合计', NUM(b.sheetListFee), s.listTotal],
        ['soldCount = 现算已售出行数', b.soldCount, sold.length],
        ['soldPaidFee = 现算已售出行之和', NUM(b.soldPaidFee), sumSheetPaid(sold)],
        ['留档 − 支出 = 已售出 + 换壳', R1(NUM(b.sheetPaidFee) - NUM(b.paidFee)), R1(NUM(b.soldPaidFee) + NUM(b.reholderPaidFee || '0元'))]
    ];
    for (const [name, got, want] of pairs) {
        if (!(Math.abs(got - want) < 1e-9)) IDENT.push(`${b.pj}: ${name}（实际 ${got} vs 现算 ${want}）`);
    }
}
ok(IDENT.length === 0,
    `逐批 ${G.batches.length}×15 条口径恒等式全部成立（异常：${IDENT.join(' | ') || '无'}）`);

// ★ 全局：totals 里的每一个数都必须等于**现算**的结果
ok(G.totals.itemCount === KEPT_ROWS, `totals.itemCount = ${KEPT_ROWS}（= Σ非换壳行；实际 ${G.totals.itemCount}）`);
ok(NUM(G.totals.paidFee) === KEPT_PAID, `totals.paidFee = "${G.totals.paidFee}"（= Σ非换壳行 paidFee = ${KEPT_PAID}）`);
ok(NUM(G.totals.sheetPaidFee) === SHEET_PAID, `totals.sheetPaidFee = "${G.totals.sheetPaidFee}"（= Σ逐批留档实收 = ${SHEET_PAID}）`);
ok(G.totals.sheetItemCount === SHEET_ROWS, `totals.sheetItemCount = ${SHEET_ROWS}（= Σ逐批留档行数，实际 ${G.totals.sheetItemCount}）`);
ok(G.totals.soldCount === SOLD_ROWS, `totals.soldCount = ${SOLD_ROWS}（= 现算"清单里有、items 里没有"的行数，实际 ${G.totals.soldCount}）`);
ok(NUM(G.totals.soldPaidFee) === SOLD_PAID, `totals.soldPaidFee = "${G.totals.soldPaidFee}"（= 现算已售出行之和 ${SOLD_PAID}）`);
ok(G.totals.reholderCount === RH_ROWS, `totals.reholderCount = ${RH_ROWS}（= 带 reholder 标记的行数，实际 ${G.totals.reholderCount}）`);
ok(NUM(G.totals.reholderPaidFee) === RH_PAID, `totals.reholderPaidFee = "${G.totals.reholderPaidFee}"（= Σ换壳行 paidFee = ${RH_PAID}）`);

// ★★ 两条全局恒等式（口径关系的收口）
ok(R1(NUM(G.totals.paidFee) + NUM(G.totals.soldPaidFee) + NUM(G.totals.reholderPaidFee)) === NUM(G.totals.sheetPaidFee),
    `支出 ${G.totals.paidFee} + 已售出 ${G.totals.soldPaidFee} + 换壳 ${G.totals.reholderPaidFee} = 留档实收 ${G.totals.sheetPaidFee}`);
ok(R1(ITEMS_PAID + SOLD_PAID) === SHEET_PAID,
    `留档实收 ${SHEET_PAID} = Σitems 全部行 ${ITEMS_PAID} + Σ已售出行 ${SOLD_PAID}`);
ok(SHEET_ROWS === KEPT_ITEMS.length + SOLD_ROWS,
    `留档行数 ${SHEET_ROWS} = Σ items.length（${KEPT_ITEMS.length}）+ 已售出行数（${SOLD_ROWS}）`);
ok(KEPT_PAID !== SHEET_PAID, `支出合计 ${KEPT_PAID}元 与留档实收 ${SHEET_PAID}元 **不是**同一个数（差额 ${R1(SHEET_PAID - KEPT_PAID)}元）`);

// ★ 精简后的字段清单：明细**只**留 cert + listFee + paidFee（+ 换壳行才有的 reholder），
//   名称/冠号/分数/EPQ/版别/尺寸/数量一律不存 —— 展示时按 cert 去藏品记录取。
//   ★ 判据写成"**子集**关系"：cert/listFee/paidFee 每行都有、reholder 可以有可以没有。
//     原来写成"并集恰好 4 个"，数据里一旦没有换壳行就会假红（删掉换壳批次时实测踩到）。
const ALLOWED_FIELDS = ['cert', 'listFee', 'paidFee', 'reholder'];
const itemFields = [...new Set(KEPT_ITEMS.concat(RH_ITEMS).flatMap(i => Object.keys(i)))].sort();
const extraFields = itemFields.filter(f => !ALLOWED_FIELDS.includes(f));
const missingFields = KEPT_ITEMS.filter(i => !('cert' in i) || !('listFee' in i) || !('paidFee' in i));
ok(extraFields.length === 0 && missingFields.length === 0,
    `明细字段只允许 ${ALLOWED_FIELDS.join(' / ')}（多余：${extraFields.join(', ') || '无'}；`
    + `缺 cert/listFee/paidFee 的行：${missingFields.length}；实际出现过的字段：${itemFields.join(', ')}）`);
for (const gone of ['name', 'version', 'condition', 'epq', 'variety', 'qty', 'seq', 'size', 'dimension', 'krause', 'batch']) {
    ok(!KEPT_ITEMS.some(i => gone in i), `明细里没有冗余字段 ${gone}（不再抄表格的全字段）`);
}
ok(KEPT_ITEMS.every(i => typeof i.cert === 'string' && /^\d+$/.test(i.cert)), '每行的 cert 都是纯数字字符串（= 藏品 copyId）');
ok(KEPT_ITEMS.every(i => typeof i.listFee === 'string' && /元$/.test(i.listFee) && typeof i.paidFee === 'string' && /元$/.test(i.paidFee)),
    'listFee / paidFee 都是带"元"的人类可读字符串（与藏品 price: "18元" 风格一致）');

// ★ 判据保留：清单里的每一行**要么**匹配得上 items（未售出），**要么**被现算成已售出行 ——
//   不许有"两边都没有"的行（那意味着清单与台账悄悄错位）。
ok(G.batches.every(b => ITEMS_OF(b).length + soldOf(b).length === sheetOf(b.pj).detailRows),
    `每批：items 行数 + 现算已售出行数 = 清单明细行数（${G.batches.map(b => ITEMS_OF(b).length + soldOf(b).length + '/' + sheetOf(b.pj).detailRows).join(' ')}）`);
// ★ 已售出的编码（现算）不得再出现在 items 里
ok(!SOLD_CERTS.some(c => KEPT_ITEMS.some(i => i.cert === c)),
    `现算出的 ${SOLD_ROWS} 个已售出编码都不在任何批次的 items 里（${SOLD_CERTS.join(', ')}）`);
// ★ "已售出编码要在数据文件注释里留档"属于**文档习惯**、不是渲染行为，按用户要求（§⑩）
//   **降级成日志**：判据本身已经由上面那条"清单每行都有归属"钉住，而"给某批补一行已售出的明细"
//   这种正常的数据编辑不该因为忘了同步注释就变红（那正是本用例要消灭的假红）。
{
    const undocumented = SOLD_CERTS.filter(c => !dataSrc.includes(c));
    console.log(`      （日志）现算出的 ${SOLD_CERTS.length} 个已售出编码：${SOLD_CERTS.join(', ')}`
        + `；其中未写进数据文件注释的：${undocumented.join(', ') || '无'}`);
}
ok(/已售出/.test(dataSrc) && /匹配不到|找不到匹配/.test(dataSrc), '文件注释写明了"匹配不到 copyId = 已售出"这条判据');
ok(/付款日期/.test(dataSrc), '文件注释写明了按付款日期计入支出');
ok(/复用藏品数据|去藏品记录取/.test(dataSrc), '文件注释写明了展示文字复用藏品数据（不抄第二份）');

// ══════════════════════════════════════════════════════════════
section('② 支出取折后价，且折后 = 原价 × 0.9');
// ══════════════════════════════════════════════════════════════
const badDisc = [];
for (const b of G.batches) for (const i of ITEMS_OF(b)) {
    if (Math.abs(NUM(i.paidFee) - R1(NUM(i.listFee) * DISCOUNT)) > 1e-9) badDisc.push(`${b.pj}/${i.cert} ${i.listFee}→${i.paidFee}`);
}
ok(badDisc.length === 0, `items 全部 ${KEPT_ITEMS.length} 行逐行满足 paidFee = listFee × ${DISCOUNT}（异常：${badDisc.join(', ') || '无'}）`);
// ★ 现算出的已售出行（清单里有、items 里没有）也必须落在同一条折扣关系里
const badSoldDisc = SOLD_DETAIL.filter(r => Math.abs(r.paidFee - R1(r.listFee * DISCOUNT)) > 1e-9);
ok(badSoldDisc.length === 0,
    `现算出的 ${SOLD_ROWS} 行已售出也满足 paidFee = listFee × ${DISCOUNT}（异常：${badSoldDisc.map(r => r.pj + '/' + r.cert).join(', ') || '无'}）`);

ok(R1(G.batches.reduce((s, b) => s + NUM(b.paidFee), 0)) === KEPT_PAID, `逐批支出之和 = ${KEPT_PAID}（= Σ非换壳行现算值）`);
ok(R1(G.batches.reduce((s, b) => s + NUM(b.sheetPaidFee), 0)) === SHEET_PAID, `逐批留档实收之和 = ${SHEET_PAID}（= 5 份清单的实收，未受影响）`);
// ★★ 留档侧的折扣关系：清单「评级费原价」合计 × 0.9 = 清单「实际费用」合计。
//   这条顺带把"批次 4 汇总块字面写 1,615、实际 1795×0.9 = 1615.5"这件事机制性地钉住。
const badSheetDisc = G.batches.filter(b => Math.abs(R1(NUM(b.sheetListFee) * DISCOUNT) - NUM(b.sheetPaidFee)) > 1e-9);
ok(badSheetDisc.length === 0,
    `每批留档：清单原价合计 × ${DISCOUNT} = 清单实收（异常：${badSheetDisc.map(b => b.pj).join(', ') || '无'}）`);
// ★★ 新口径：差额 = 已售出 + 换壳（换壳不再算进支出）
ok(G.batches.every(b => R1(NUM(b.sheetPaidFee) - NUM(b.paidFee)) === R1(NUM(b.soldPaidFee) + NUM(b.reholderPaidFee || 0))),
    '每批：留档实收 - 支出 = 该批已售出 + 该批换壳（两个合计自洽）');
ok(R1(SHEET_PAID - KEPT_PAID) === R1(SOLD_PAID + RH_PAID),
    `留档实收 − 支出 = 已售出 ${SOLD_PAID} + 换壳 ${RH_PAID} = ${R1(SOLD_PAID + RH_PAID)}（实际 ${R1(SHEET_PAID - KEPT_PAID)}）`);

// ══════════════════════════════════════════════════════════════
section('③ 按【付款日期】计入，不是送评日期');
// ══════════════════════════════════════════════════════════════
// ★ 不再逐批抄一行期望值：日期只断言**格式**与**每批唯一 / 付款日 ≠ 送评日**，
//   金额/行数一律与现算的明细之和对照（见 §① 的恒等式表）。
for (const b of G.batches) {
    const nonRh = ITEMS_OF(b).filter(i => !i.reholder);
    ok(!!b.sentDate && !!b.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(b.sentDate) && /^\d{4}-\d{2}-\d{2}$/.test(b.paidDate),
        `批次 ${b.pj}：送评日期 ${b.sentDate} / 付款日期 ${b.paidDate} 都是 ISO 写法`);
    ok(b.paidDate && b.paidDate !== b.sentDate,
        `批次 ${b.pj}：付款日期（${b.paidDate}）≠ 送评日期（${b.sentDate}）—— 支出口径按付款日期落位`);
    ok(NUM(b.paidFee) === sumPaid(nonRh) && b.itemCount === nonRh.length,
        `批次 ${b.pj}：支出 ${b.paidFee} / ${b.itemCount} 件 = 现算 Σ非换壳行 ${sumPaid(nonRh)} / ${nonRh.length}（留档 ${b.sheetPaidFee}，已售出 ${b.soldCount} 行 ${b.soldPaidFee}，换壳 ${b.reholderCount || 0} 行 ${b.reholderPaidFee || '0元'}）`);
}
ok(new Set(G.batches.map(b => b.paidDate)).size === G.batches.length,
    `${G.batches.length} 个付款日期互不相同（按付款日期计入时不会被合并）`);
ok(G.batches.every((b, i) => i === 0 || String(G.batches[i - 1].paidDate) <= String(b.paidDate)),
    'G.batches 本身已按付款日期升序（时间轴顺序 = 数据顺序）');
ok(WANT_DATES.length === G.batches.length && new Set(WANT_DATES).size === WANT_DATES.length
    && WANT_DATES.every((d, i) => i === 0 || WANT_DATES[i - 1] <= d),
    `现算出的 ${WANT_DATES.length} 个付款日期互不相同且升序 = ${WANT_DATES.join(' → ')}`);

// ══════════════════════════════════════════════════════════════
section('④ 换壳批次：留档 ≠ 支出，差额正好是换壳行（按性质现找，不指名 PJ）');
// ══════════════════════════════════════════════════════════════
const rhBatch = G.batches.find(b => (b.reholderCount || 0) > 0);
if (!rhBatch) {
    skip('台账里没有任何换壳行 ⇒ "换壳批次 留档−支出=换壳" 在本数据集中无断言值');
} else {
    const rhItems = ITEMS_OF(rhBatch).filter(i => i.reholder);
    const rhBatchNonRh = ITEMS_OF(rhBatch).filter(i => !i.reholder);
    ok(rhItems.length === (rhBatch.reholderCount || 0) && NUM(rhBatch.reholderPaidFee) === sumPaid(rhItems),
        `换壳批次 ${rhBatch.pj}：${rhItems.length} 行换壳 / ${rhBatch.reholderPaidFee}（现算 Σ = ${sumPaid(rhItems)}）—— 不计入支出`);
    ok(NUM(rhBatch.paidFee) === sumPaid(rhBatchNonRh) && rhBatch.itemCount === rhBatchNonRh.length,
        `换壳批次：支出 ${rhBatch.paidFee} / ${rhBatch.itemCount} 件 = Σ非换壳行（换壳那 ${rhItems.length} 行被剔除）`);
    ok(NUM(rhBatch.paidFee) < NUM(rhBatch.sheetPaidFee),
        `换壳批次：支出 ${rhBatch.paidFee} **小于**留档实收 ${rhBatch.sheetPaidFee}（差额 = 换壳 + 已售出）`);
    ok(R1(NUM(rhBatch.sheetPaidFee) - NUM(rhBatch.paidFee)) === R1(NUM(rhBatch.reholderPaidFee || '0元') + NUM(rhBatch.soldPaidFee)),
        `换壳批次：留档 ${rhBatch.sheetPaidFee} − 支出 ${rhBatch.paidFee} = 换壳 ${rhBatch.reholderPaidFee} + 已售出 ${rhBatch.soldPaidFee}`);
    ok(R1(sumList(ITEMS_OF(rhBatch)) * DISCOUNT) === sumPaid(ITEMS_OF(rhBatch)),
        `换壳批次：items 全行原价 ${sumList(ITEMS_OF(rhBatch))} × ${DISCOUNT} = ${sumPaid(ITEMS_OF(rhBatch))}（= Σitems paidFee，换壳行照录入参与这一条）`);
}

// ══════════════════════════════════════════════════════════════
section('⑤ 同一编码跨批次重复时"只算第一次"（现算挑出重复编码，不指名）');
// ══════════════════════════════════════════════════════════════
const rowsByCert = new Map();
for (const b of G.batches) for (const i of ITEMS_OF(b)) {
    if (!rowsByCert.has(i.cert)) rowsByCert.set(i.cert, []);
    rowsByCert.get(i.cert).push({ pj: b.pj, item: i });
}
const dupCerts = [...rowsByCert.entries()].filter(([, rows]) => rows.length > 1);
if (dupCerts.length === 0) {
    skip('台账里没有跨批次重复的编码 ⇒ "只算第一次"的断言在本数据集中无断言值');
} else {
    const badDup = [];
    for (const [cert, rows] of dupCerts) {
        // 该编码在总支出里的贡献必须**只等于第一次**那一行（后面的行计 0/0）
        const total = sumPaid(rows.map(r => r.item));
        const totalList = sumList(rows.map(r => r.item));
        if (Math.abs(total - NUM(rows[0].item.paidFee)) > 1e-9 || Math.abs(totalList - NUM(rows[0].item.listFee)) > 1e-9) {
            badDup.push(`${cert} 合计 ${totalList}/${total} ≠ 第一次 ${rows[0].item.listFee}/${rows[0].item.paidFee}`);
        }
        for (const r of rows.slice(1)) {
            if (NUM(r.item.paidFee) !== 0 || NUM(r.item.listFee) !== 0) badDup.push(`${cert}@${r.pj} 不是 0/0（${r.item.listFee}/${r.item.paidFee}）`);
        }
    }
    ok(badDup.length === 0,
        `现算出的 ${dupCerts.length} 个重复编码（${dupCerts.map(([c, r]) => c + '×' + r.length).join(', ')}）都只算第一次：后面的行全是 0/0（异常：${badDup.join(' | ') || '无'}）`);
}

// ══════════════════════════════════════════════════════════════
section('⑥ 换壳行**不计入评级费**（现算挑出换壳行，不指名认证码）');
// ══════════════════════════════════════════════════════════════
// ★★ 用户裁定（推翻早先"换壳也算评级费"）：换壳当作**原始价格**处理 ——
//   不减费、也不计入评级费。所以这一行仍然留在 items 里（留档可追溯、且它匹配得上
//   copyId），但**不参与 paidFee 汇总**、也不参与藏品那侧的"裸币价"折算。
const shell = RH_ITEMS[0] || null;          // ★ 现算：挑第一条带 reholder 标记的行
const shellCert = shell ? shell.cert : null;
if (!shell) {
    skip('台账里没有任何换壳行 ⇒ "换壳行不计入评级费"在本数据集中无断言值');
} else {
    ok(shell.reholder === true, `换壳行（cert=${shellCert}）带 reholder: true 标记，且仍在 items 里留档（可追溯）`);
    ok(NUM(shell.paidFee) === R1(NUM(shell.listFee) * DISCOUNT),
        `换壳行也走同一条折扣：${shell.listFee} × ${DISCOUNT} = ${shell.paidFee}（照录入计，不特殊处理金额）`);
    ok(!NON_RH_ITEMS.includes(shell), '换壳行**不在**支出侧明细里（不计入评级费）');
    ok(!SOLD_CERTS.includes(shellCert), '换壳行不在现算的已售出名单里（判据是"匹配不到 copyId"，它匹配得上）');
    ok(R1(NON_RH_ITEMS.reduce((s, i) => s + NUM(i.paidFee), 0)) === KEPT_PAID,
        `剔掉换壳后的明细之和 = ${KEPT_PAID}（换壳的 ${shell.paidFee} 不在里面）`);
    ok(R1(RH_ITEMS.reduce((s, i) => s + NUM(i.paidFee), 0)) === RH_PAID && RH_ITEMS.length === RH_ROWS,
        `换壳行合计 = ${RH_PAID} / ${RH_ROWS} 行（= 现算的 reholder 行之和）`);
    ok(R1(ITEMS_PAID - KEPT_PAID) === RH_PAID,
        `全部明细（含换壳）${ITEMS_PAID} − 支出 ${KEPT_PAID} = ${RH_PAID}，正好是换壳行之和 —— 剔除生效`);
    const rhBatch2 = G.batches.find(b => ITEMS_OF(b).includes(shell));
    ok(!!rhBatch2
        && R1(sumPaid(ITEMS_OF(rhBatch2)) + sumSheetPaid(soldOf(rhBatch2))) === NUM(rhBatch2.sheetPaidFee)
        && R1(sumPaid(ITEMS_OF(rhBatch2))) - RH_PAID === NUM(rhBatch2.paidFee),
        `换壳行 ${shell.paidFee} 仍含在批次 ${rhBatch2 && rhBatch2.pj} 的**留档** ${rhBatch2 && rhBatch2.sheetPaidFee} 里（留档不受影响）`);
}

// ══════════════════════════════════════════════════════════════
section('⑦ 与真实藏品 copyId 对账（"已售出"判据的机制性证明）');
// ══════════════════════════════════════════════════════════════
// ★ 把真实的 72 份藏品数据装进一个 vm，建立 copyId → 藏品 的索引。
//   这既是"留下的行都匹配得上"的证明，也是 §⑧ 里"展示文字从藏品记录取"的依据。
const COL = 'collection';
const loaderCtx = { console, window: null, JSON, Object, Array, String, Number, RegExp, Math, Boolean, Set, Map, Date, Error, isFinite, parseFloat, parseInt, isNaN };
loaderCtx.window = loaderCtx;
loaderCtx.document = { addEventListener() { }, readyState: 'complete', querySelector: () => null, querySelectorAll: () => [] };
loaderCtx.SPECIAL_CONFIGS = [];
vm.createContext(loaderCtx);
vm.runInContext([
    readFileSync(join(COL, 'config.js'), 'utf8'),
    readFileSync(join(COL, 'coin-config.js'), 'utf8'),
    readFileSync(join(COL, 'data-loader.js'), 'utf8'),
    'window.__walk = JSON.stringify(walkTree(categoryTree, []).concat(walkTree(coinCategoryTree, [])));'
].join('\n;\n'), loaderCtx, { filename: 'loader.js' });
const walkList = JSON.parse(loaderCtx.__walk);
let colLoaded = 0;
for (const s of walkList) {
    const f = join(COL, s.file);
    if (!existsSync(f)) continue;
    try { vm.runInContext(readFileSync(f, 'utf8'), loaderCtx, { filename: s.file }); colLoaded++; } catch { }
}
// 手动画出 data-loader.js 里那段桥接（DATA_MAP[dataKey] = 该文件里的全局变量），
// 并同时产出 copyId 索引 —— 只序列化索引，不序列化整份数据（对象图很大）。
vm.runInContext(`window.__probe = (function(){
    const maps = { DATA_MAP: {}, COIN_DATA_MAP: {}, FUN_DATA_MAP: {} };
    for (const k of allDataKeys) {
        let v = null; try { v = (0, eval)(k); } catch (e) { }
        maps.DATA_MAP[k] = v;
    }
    const idx = {};
    for (const k of Object.keys(maps.DATA_MAP)) {
        const d = maps.DATA_MAP[k];
        if (!d || !d.series) continue;
        for (const s of d.series) {
            const list = [];
            if (s.varieties) { for (const v of s.varieties) for (const c of (v.copies || [])) list.push([c, s.seriesName + ' - ' + v.varietyName]); }
            else if (s.copies) { for (const c of s.copies) list.push([c, s.seriesName]); }
            for (const pair of list) {
                const c = pair[0];
                if (c && c.copyId && !idx[c.copyId]) idx[c.copyId] = { name: pair[1], version: c.version || '', condition: c.condition || c.grade || '', price: c.price || '' };
            }
        }
    }
    return JSON.stringify({ idx: idx, keys: Object.keys(maps.DATA_MAP) });
})();`, loaderCtx, { filename: 'probe.js' });
const probe = JSON.parse(loaderCtx.__probe);
const colIdx = probe.idx;
const colCopyIds = Object.keys(colIdx);

ok(colLoaded > 50 && colCopyIds.length > 300,
    `真实藏品数据已装入（${colLoaded} 份文件 / ${colCopyIds.length} 个 copyId）——下面的对账才有意义`);

// ⑦-1 留下的每一行都必须匹配得上 copyId（否则就是"已售出"没剔干净）
const unmatched = KEPT_ITEMS.filter(i => !colIdx[i.cert]);
ok(unmatched.length === 0,
    `items 里留下的 ${KEPT_ROWS} 行**全部**匹配得上真实藏品的 copyId（不匹配的：${unmatched.map(i => i.cert).join(', ') || '无'}）`);
// ⑦-2 ★★ 判据的机制性证明：现算出的"已售出行"（清单里有、items 里没有）在真实藏品里
//   **确实都找不到** copyId —— 所以"匹配不到 copyId = 已售出"这条判据站得住（不是拍脑袋）。
if (SOLD_ROWS === 0) {
    skip('台账里没有已售出行 ⇒ "已售出编码匹配不到 copyId" 在本数据集中无断言值');
} else {
    const reallySold = SOLD_CERTS.filter(c => !colIdx[c]);
    ok(reallySold.length === SOLD_CERTS.length,
        `现算出的 ${SOLD_CERTS.length} 个已售出编码在真实藏品里**一个都找不到**（${SOLD_CERTS.join(', ')}）——判据站得住`);
    ok(colCopyIds.filter(c => SOLD_CERTS.includes(c)).length === 0,
        `已售出名单里的编码一个都不在藏品的 ${colCopyIds.length} 个 copyId 里（判据不会乱杀）`);
    // ★ 反面：items 里留下的行则**必须**都能在藏品里找到（两个方向都钉住）
    ok(KEPT_ITEMS.length > 0 && unmatched.length === 0,
        `反向：items 里留下的 ${KEPT_ITEMS.length} 行全部匹配得上藏品的 copyId`);
}
if (shellCert) ok(!!colIdx[shellCert], `换壳行 ${shellCert} 在藏品里存在（所以未售出、计入）—— 与"已售出"正好相反`);
else skip('台账里没有换壳行 ⇒ "换壳行匹配得上 copyId" 在本数据集中无断言值');
ok(KEPT_ITEMS.every(i => !('name' in i)), '台账明细没有自带名称（展示名只能来自藏品记录）');

// ══════════════════════════════════════════════════════════════
section('⑧ 页面里那份台账解析（跑 special.js 的真实代码）');
// ══════════════════════════════════════════════════════════════
// ★ 直接从 special.js 抽函数来跑 —— 那是页面上真正把台账变成时间轴条目的那份实现，
//   不是抄一份期望值。抽函数而不是 eval 整个文件，是因为 special.js 顶层依赖 DOM。
const specialSrc = readFileSync(join(COL, 'special.js'), 'utf8');
const extractFn = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('找不到函数 ' + name);
    let d = 0, started = false;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') { d++; started = true; }
        else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
    }
    throw new Error('函数 ' + name + ' 括号不配平');
};
const parseChineseDateStub = `function parseChineseDate(s) {
    const m = String(s||'').trim().match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3]);
    const m2 = String(s||'').trim().match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日?/);
    return m2 ? new Date(+m2[1], +m2[2]-1, +m2[3]) : null;
}`;
// ★ timelinePriceOf 现在会调 nakedFeeOf（裸币价口径）→ nakedFeeOf 又要 gradingFeeIndex，
//   所以这两个也必须在沙箱里，否则 vm 里跑 timelinePriceOf 会 ReferenceError。
const FEE_FNS = ['timelinePriceOf', 'nakedFeeOf', 'gradingFeeIndex', 'feeAmountOf', 'formatTimelineDate', 'gradingCopyIndex', 'gradingFeeEntries', 'gradingFeeTotal', 'nakedPriceOf', 'formatYuan'];
function makeFeeCtx(extra = []) {
    const c = { console, window: null, JSON, Object, Array, String, Number, RegExp, Math, Boolean, Set, Map, Date, Error, isFinite, parseFloat, parseInt, isNaN };
    c.window = c;
    vm.createContext(c);
    vm.runInContext([parseChineseDateStub, ...FEE_FNS.map(f => extractFn(specialSrc, f)), ...extra].join('\n;\n'), c, { filename: 'specials-fee.js' });
    return c;
}

// ⑧-1 真实台账 + **真实藏品**（展示文字从藏品记录取）
const ledgerJson = JSON.stringify(G);
// ★ 把"真实 copyId → 真实名称"按 data-loader 产出的形状（series → varieties → copies）
//   包一份交进 vm —— 这样验的就是"展示文字确实来自藏品记录"这条路，而不是台账自带的字段。
const realSeries = [{
    seriesName: '（真实藏品）',
    varieties: [{ varietyName: '（真实）', copies: KEPT_ITEMS.map(i => ({ copyId: i.cert, version: (colIdx[i.cert] || {}).version || '', price: '1元' })) }]
}];
const fctx = makeFeeCtx([
    'window.COIN_DATA_MAP = {}; window.FUN_DATA_MAP = {};',
    'window.DATA_MAP = { gradingFeeData: ' + ledgerJson + ', realCollection: ' + JSON.stringify({ name: 'real', series: realSeries }) + ' };',
    'window.getCategoryPath = function(){ return ""; };',
    'window.__entries = JSON.stringify(gradingFeeEntries()); window.__total = gradingFeeTotal();'
]);

const entries = JSON.parse(fctx.__entries);
ok(Math.abs(fctx.__total - KEPT_PAID) < 1e-9, `gradingFeeTotal() = ${KEPT_PAID}（支出，不是 ${SHEET_PAID}；实际 ${fctx.__total}）`);
// ★ 现算"应该出几条"：有非换壳明细（支出 > 0）的批次才会进时间轴
const ENTRY_BATCHES = ORDERED_BATCHES.filter(b => sumPaid(ITEMS_OF(b).filter(i => !i.reholder)) > 0);
const ENTRY_AMTS = ENTRY_BATCHES.map(b => sumPaid(ITEMS_OF(b).filter(i => !i.reholder)));
const ENTRY_DATES = ENTRY_BATCHES.map(b => b.paidDate);
ok(entries.length === ENTRY_BATCHES.length,
    `gradingFeeEntries() 产出 ${ENTRY_BATCHES.length} 条时间轴条目（= 支出>0 的批次数；实际 ${entries.length}）`);

const entryByPj = new Map(entries.map(e => [e.copy.condition, e]));
for (const b of ENTRY_BATCHES) {
    const en = entryByPj.get(b.pj);
    if (!en) { ok(false, `时间轴条目里有批次 ${b.pj}`); continue; }
    const wantPaid = sumPaid(ITEMS_OF(b).filter(i => !i.reholder));
    ok(en.dateStr === cnDate(b.paidDate) && en.itemCount === b.itemCount && NUM(en.copy.price) === wantPaid && en.copy.version === b.pj,
        `条目 ${b.pj}：落位 ${en.dateStr}（付款日 ${b.paidDate}，送评是 ${b.sentDate}）· ${b.itemCount} 件 · ${en.copy.price}（现算支出 ${wantPaid}，不是留档 ${b.sheetPaidFee}）`);
}
ok(entries.every(e => e.type === 'fee'), `${entries.length} 条都打了 type="fee" 标记（渲染时走台账分支，不会被当成藏品）`);
ok(R1(entries.reduce((s, e) => s + NUM(e.copy.price), 0)) === KEPT_PAID,
    `${entries.length} 条金额之和 = ${KEPT_PAID}（${entries.map(e => NUM(e.copy.price)).join(' + ')}）`);
ok(entries.every(e => cnDate(e.copy.purchaseDate) === e.dateStr),
    '条目自带的 purchaseDate（ISO，来自台账）与分组日期（中文写法）指同一天（混排/分组都靠它）');
ok(entries.every(e => !e.copy.img1 && !e.copy.img2), '台账条目没有图片字段（渲染时根本不生成图片位）');
ok(entries.map(e => e.dateStr).join(',') === WANT_DATES.map(cnDate).join(','), `条目按付款日期升序：${entries.map(e => e.dateStr).join(' → ')}`);

// ⑧-1b ★ 公司名 / 清单地址都只是**数据字段的搬运工**（条目上能直接读到，渲染端不另起名字）
ok(entries.every((e, i) => e.grader === ENTRY_BATCHES[i].grader),
    `条目上的 grader 就是数据里的 grader（${entries.map(e => e.grader).join(' / ')}）`);
ok(entries.every((e, i) => e.listUrl === ENTRY_BATCHES[i].listUrl),
    '条目上的 listUrl 就是数据里的 listUrl（渲染端不拼也不猜）');
{
    // ★ 把数据里的公司名换成 PMG、并且**去掉** listUrl ⇒ 条目必须跟着变（没有写死、也没默认成别家）
    //   注意：一定还要给一份**真实的 copyId 索引**，否则按"匹配不到=已售出"的口径一个条目都不会出。
    const swapped = JSON.parse(JSON.stringify(G));
    const lastPj = ORDERED_BATCHES[ORDERED_BATCHES.length - 1].pj;
    swapped.batches = [swapped.batches.find(b => b.pj === lastPj)];
    swapped.batches[0].grader = 'PMG';
    delete swapped.batches[0].listUrl;
    const f = makeFeeCtx([
        'window.COIN_DATA_MAP = {}; window.FUN_DATA_MAP = {};',
        'window.DATA_MAP = { gradingFeeData: ' + JSON.stringify(swapped) + ', realCollection: ' + JSON.stringify({ name: 'real', series: realSeries }) + ' };',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries());'
    ]);
    const es = JSON.parse(f.__e);
    const e0 = es[0];
    ok(es.length === 1, `换公司名后仍有 1 条条目（实际 ${es.length} 条）`);
    ok(!!e0 && e0.grader === 'PMG',
        `数据改成 PMG 后，条目上的公司名就是 PMG（实际 ${e0 && e0.grader}）—— 公司名没有写死`);
    ok(!!e0 && e0.listUrl === '',
        `数据里删掉 listUrl 后，条目上没有清单地址（实际 ${JSON.stringify(e0 && e0.listUrl)}）—— 缺字段不会瞎猜`);
    ok(!!e0 && NUM(e0.copy.price) === sumPaid(ITEMS_OF(swapped.batches[0]).filter(i => !i.reholder)),
        `改公司名/删链接都不影响金额口径（实际 ${e0 && e0.copy.price}，现算 ${sumPaid(ITEMS_OF(swapped.batches[0]).filter(i => !i.reholder))}）`);
}
{
    // grader 缺失 ⇒ 空串（渲染端据此回退成中性的「评级费」，不会变成某家公司）
    const noGrader = JSON.parse(JSON.stringify(G));
    noGrader.batches = [noGrader.batches.find(b => b.pj === ORDERED_BATCHES[0].pj)];
    delete noGrader.batches[0].grader;
    const f = makeFeeCtx([
        'window.COIN_DATA_MAP = {}; window.FUN_DATA_MAP = {};',
        'window.DATA_MAP = { gradingFeeData: ' + JSON.stringify(noGrader) + ', realCollection: ' + JSON.stringify({ name: 'real', series: realSeries }) + ' };',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries());'
    ]);
    const es = JSON.parse(f.__e);
    const e0 = es[0];
    ok(es.length === 1, `grader 缺失时仍有 1 条条目（实际 ${es.length} 条）`);
    ok(!!e0 && e0.grader === '', `grader 缺失时条目上是空串（实际 ${JSON.stringify(e0 && e0.grader)}）—— 不默认成任何公司`);
    ok(!!e0 && NUM(e0.copy.price) === sumPaid(ITEMS_OF(noGrader.batches[0]).filter(i => !i.reholder)),
        `grader 缺失也不影响金额（实际 ${e0 && e0.copy.price}，现算 ${sumPaid(ITEMS_OF(noGrader.batches[0]).filter(i => !i.reholder))}）`);
}

// ⑧-2 「复用藏品数据」这条路：台账里**没存任何名称**，展示所需的一切都按 cert 去藏品记录取
{
    // ★ fixture 用的批次与那一行**现算**（挑一行非换壳、费用 > 0 的）—— 不再写死 G.batches[0]
    const fixBatch = ORDERED_BATCHES[0];
    const fixRow = ITEMS_OF(fixBatch).find(i => !i.reholder && NUM(i.paidFee) > 0);
    const fakeSeries = [{ seriesName: 'S1', varieties: [{ varietyName: 'V1', copies: [
        { copyId: fixRow.cert, version: 'AAAA', price: '7元' }
    ] }] }];
    const one = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({ gradingFeeData: { ...G, batches: [fixBatch] }, fake: { series: fakeSeries } }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__idx = JSON.stringify(gradingCopyIndex());',
        'window.__e = JSON.stringify(gradingFeeEntries());'
    ]);
    const idx = JSON.parse(one.__idx);
    const rec = idx[fixRow.cert];
    ok(!!rec && rec.seriesName.indexOf('S1') >= 0 && rec.seriesName.indexOf('V1') >= 0,
        `gradingCopyIndex() 按 cert 解析出了藏品记录（seriesName="${rec && rec.seriesName}"）—— 台账里并没有这个名字`);
    ok(!!rec && rec.copy.version === 'AAAA', '解析出来的那份记录还能取到藏品的冠字号码（AAAA）—— 复用藏品数据这条路是通的');
    ok(!!rec && rec.copy.price === '7元', '价格也来自藏品侧（7元），台账只贡献 listFee/paidFee 两个费用字段');
    const e1 = JSON.parse(one.__e)[0];
    // ★ 这份 fixture 只喂了 1 个藏品（那一行的 cert），所以"未售出部分"就只有那一行。
    //   期望值 = 那一行自己的 paidFee（**现算**），这恰好是"支出按留下的行重算"的又一次旁证。
    ok(!!e1 && e1.type === 'fee' && e1.itemCount === 1 && NUM(e1.copy.price) === NUM(fixRow.paidFee),
        `条目按"未售出部分"口径（这份 fixture 只有 1 行匹配上 ⇒ 1 行 / ${NUM(fixRow.paidFee)}元；实际 ${e1 && e1.itemCount} 行 / ${e1 && e1.copy.price}）`);
    ok(!!e1 && e1.sentDate === fixBatch.sentDate && e1.paidDate === fixBatch.paidDate && e1.dateStr === cnDate(fixBatch.paidDate),
        `条目同时带着送评日期（${e1 && e1.sentDate}）与付款日期（${e1 && e1.paidDate} → ${e1 && e1.dateStr}），两者不同天`);
}
// ⑧-2b 台账明细里没有名称/冠号/分数可供渲染 —— 必须靠藏品记录
ok(KEPT_ITEMS.every(i => !('name' in i) && !('version' in i) && !('condition' in i)),
    '台账明细里没有 name/version/condition（渲染所需信息全部按 cert 去藏品记录取）');

// ⑧-3 ★ 注入式 fixture：验证"匹配不到 copyId 的行不计入支出 / 不进时间轴"这条**逻辑**。
//   数据里那些行已经被剔除了，所以只能靠注入一份"只匹配得上一部分"的台账来验逻辑。
//   fixture ①：某批里只有 1 行（**非换壳**那行）的 cert 能在藏品里找到 ⇒ 该批支出塌成那一行的金额，条目仍在；
//   fixture ②：某批一个都匹配不上 ⇒ 该批支出为 0，**整批不出现在时间轴上**。
//   ★ 这里特意**不用换壳行**（shellCert）：换壳行现在不计入评级费，
//     拿它当"唯一匹配上的那行"会得到 0 元、整批消失，验不出"塌成一行"这件事。
//   ★ fixture 用的批次**按性质现找**（优先带换壳行的那批），不再指名 G.batches[3]/[4]。
{
    const fixtureBatch = rhBatch || G.batches.find(b => ITEMS_OF(b).filter(i => !i.reholder && NUM(i.paidFee) > 0).length > 1) || G.batches[0];
    // ★ 挑一行**非换壳、且费用 > 0**的（重复编码那一行可能是 0/0 元，
    //   拿它验"塌成一行"会得到 0 元、整批消失，验不出东西）
    const oneRow = ITEMS_OF(fixtureBatch).find(i => !i.reholder && NUM(i.paidFee) > 0);
    const oneCert = oneRow.cert;
    const oneFee = NUM(oneRow.paidFee);
    const onlyShell = { ...G, batches: [fixtureBatch], totals: G.totals };
    const f1 = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({
            gradingFeeData: onlyShell,
            fake: { series: [{ seriesName: 'S', varieties: [{ varietyName: 'V', copies: [{ copyId: oneCert, version: 'V1' }] }] }] }
        }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries()); window.__t = gradingFeeTotal();'
    ]);
    const e1 = JSON.parse(f1.__e);
    ok(e1.length === 1 && NUM(e1[0].copy.price) === oneFee,
        `fixture①（批次 ${fixtureBatch.pj}）：只匹配得上 1 行时，该批条目金额塌成 ${oneFee}（只算匹配上的那行；实际 ${e1[0] && e1[0].copy.price}）`);
    ok(Math.abs(f1.__t - oneFee) < 1e-9, `fixture①：gradingFeeTotal() = ${oneFee}（实际 ${f1.__t}）`);
    ok(e1[0].itemCount === 1, `fixture①：件数也跟着变成 1（实际 ${e1[0].itemCount}）`);
}
//   fixture ③：带换壳行的那批里**只匹配得上换壳那一行** ⇒ 支出为 0、整批消失（换壳不计入评级费）
if (!shellCert) {
    skip('台账里没有换壳行 ⇒ fixture③（只匹配上换壳行 ⇒ 支出 0）在本数据集中无断言值');
} else {
    const onlyRh = { ...G, batches: [rhBatch], totals: G.totals };
    const f3 = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({
            gradingFeeData: onlyRh,
            fake: { series: [{ seriesName: 'S', varieties: [{ varietyName: 'V', copies: [{ copyId: shellCert, version: 'V1' }] }] }] }
        }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries()); window.__t = gradingFeeTotal();'
    ]);
    ok(JSON.parse(f3.__e).length === 0 && f3.__t === 0,
        `fixture③（批次 ${rhBatch.pj}）：只匹配得上换壳那一行 ⇒ 支出 0 / 不进时间轴（实际条目 ${JSON.parse(f3.__e).length} 条、合计 ${f3.__t}）`);
}
{
    // fixture②：整批都匹配不上 copyId（喂一个空的藏品集合）⇒ 该批支出 0、不进时间轴
    const zeroBatch = G.batches.find(b => sumPaid(ITEMS_OF(b).filter(i => !i.reholder)) > 0) || G.batches[0];
    const onlyB = { ...G, batches: [zeroBatch], totals: G.totals };
    const f2 = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({ gradingFeeData: onlyB }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries()); window.__t = gradingFeeTotal();'
    ]);
    ok(JSON.parse(f2.__e).length === 0 && f2.__t === 0,
        `fixture②（批次 ${zeroBatch.pj}）：整批都匹配不上 copyId（支出 0）⇒ 该批**不出现在时间轴上**，gradingFeeTotal() = 0`);
}
// ⑧-4 现算出的已售出编码永远不该出现在时间轴条目里
if (SOLD_CERTS.length === 0) skip('台账里没有已售出编码 ⇒ "已售出编码不进时间轴" 在本数据集中无断言值');
else ok(!SOLD_CERTS.some(c => JSON.stringify(entries).includes(c)),
    `现算出的 ${SOLD_CERTS.length} 个已售出编码没有出现在任何时间轴条目里（${SOLD_CERTS.join(', ')}）`);
// ⑧-5 数据未加载时安全退化
{
    const nctx = { console, window: null, JSON, Object, Array, String, Number, RegExp, Math, Boolean, Set, Map, Date, Error, isFinite, parseFloat, parseInt, isNaN };
    nctx.window = nctx; nctx.DATA_MAP = null;
    vm.createContext(nctx);
    vm.runInContext([parseChineseDateStub, ...FEE_FNS.map(f => extractFn(specialSrc, f)),
        'window.__e0 = JSON.stringify(gradingFeeEntries()); window.__t0 = gradingFeeTotal();'].join('\n;\n'), nctx, { filename: 'nodata-fee.js' });
    ok(JSON.parse(nctx.__e0).length === 0 && nctx.__t0 === 0,
        '台账未加载时 gradingFeeEntries() 返回空、gradingFeeTotal() 返回 0（时间轴静默跳过，不抛异常）');
}

// ══════════════════════════════════════════════════════════════
section('⑨ 评级费不是藏品：不许污染藏品口径');
// ══════════════════════════════════════════════════════════════
// ★ series 显式声明为**空数组**（不是缺失）：结构一致，同时保证没有藏品被算进去。
ok(Array.isArray(G.series) && G.series.length === 0,
    `series 是空数组（实际 ${Array.isArray(G.series) ? 'length=' + G.series.length : typeof G.series}）`);
ok(!/copies\s*:/.test(dataSrc), '数据文件里没有 copies（评级费不会被算成藏品件数）');
// ★ 直接按 collectAllCopies() 的遍历方式数一遍：评级费台账必须产出 0 件藏品。
const flattened = (() => {
    let n = 0;
    for (const s of (G.series || [])) {
        if (s.varieties) for (const v of s.varieties) n += (v.copies || []).length;
        else n += (s.copies || []).length;
    }
    return n;
})();
ok(flattened === 0, `按 collectAllCopies() 的方式展平得到 0 件藏品（实际 ${flattened} 件）`);
ok(!/detailFields\s*:/.test(dataSrc), '数据文件里没有 detailFields（没有藏品可点开，声明了反而给 check-data 添标签噪声）');
ok(/台账|费用/.test(dataSrc), '数据文件里写明了它是费用台账');
// 个人信息绝不能入库（两个层次都查：数据对象里、以及整份源码里）
const PJ_KEYS = ['铜香结', '18174433891', '微信号', '订单号', '客户名'];
for (const key of PJ_KEYS) {
    ok(!JSON.stringify(G).includes(key), `数据对象里没有个人信息「${key}」`);
}
ok(!PJ_KEYS.some(k => dataSrc.includes(k)), '整份源码里也没有个人信息（汇总块的客户信息没被抄进来）');
ok(G.series.length === 0 && Object.keys(G).indexOf('totals') >= 0, '台账结构完整（series 空 + totals 有）');

// ⑨-2 ★ 评级公司只从数据来（渲染端不写死）
//   ★ 这里**刻意只打日志、不当断言**（要求 ⑩）："每批都带 grader/graderShort""5 批是同一家公司"
//     属于**数据侧的一致性**，不是渲染行为 —— 以后真送 PMG/PCGS、或某一批缺短名，都不该让本用例变红。
//     渲染是否真的"数据驱动"由下面两条源码断言 + 本文件里那两组"注入式 fixture"证明。
const GRADERS = G.batches.map(b => b.grader);
const GRADERS_SHORT = G.batches.map(b => b.graderShort);
const GRADERS_SHORT_OF = (pj) => {
    const b = G.batches.find(x => x.pj === pj);
    return (b && b.graderShort) || '';
};
console.log(`      数据里的评级公司：${JSON.stringify(GRADERS)}（${new Set(GRADERS).size} 种）`);
console.log(`      数据里的短名：${JSON.stringify(GRADERS_SHORT)}（${new Set(GRADERS_SHORT).size} 种）`);
ok(!/ACG/.test(readFileSync(join(COL, 'special.js'), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    '★ 渲染文件（special.js）里**没有**「ACG」三字（注释除外）—— 短名完全由数据驱动，没有写死');
ok(!/ACG/.test(readFileSync(join(COL, 'layout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')),
    '★ 样式文件（layout.css）里也没有「ACG」（注释除外；标签文字不来自 CSS content）');
// ★ 注释里会举"评级公司：爱藏评级"当示例（讲版式），所以比对前先把注释剥掉。
const specialSrcNoComment = readFileSync(join(COL, 'special.js'), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/爱藏/.test(specialSrcNoComment),
    '★ 渲染文件（special.js）里**没有**「爱藏」二字（注释除外）—— 公司名完全由数据驱动，没有写死');

// ⑨-3 ★ listUrl 指向的清单文件确实存在（相对路径从 collection/ 页面出发 ⇒ 相对仓库根就是去掉开头的 ../）
//   LIST_FILES / SHEETS / parseFeeSheet 都已在文件顶部定义（现算期望值的地方），这里只断言形状。
ok(LIST_FILES.every(f => typeof f.url === 'string' && f.url.trim() !== ''),
    `每个批次都带 listUrl（实际 ${LIST_FILES.map(f => f.url).join(' | ')}）`);
ok(LIST_FILES.every(f => f.url.startsWith('../notecollection/readmes/image/grading_fee/')),
    'listUrl 是从 collection/ 出发的相对路径（../notecollection/readmes/image/grading_fee/…）');
ok(LIST_FILES.every(f => f.url.endsWith(f.pj + '.xlsx')),
    'listUrl 的文件名就是该批次的 PJ 编号 .xlsx');
ok(LIST_FILES.every(f => f.disk && existsSync(f.disk)),
    `全部 ${LIST_FILES.length} 个清单文件在磁盘上都存在（${LIST_FILES.filter(f => !f.disk || !existsSync(f.disk)).map(f => f.disk).join(', ') || '缺失 0 个'}）`);

// ★★ 那 5 个 xlsx 是用户自己处理好的最终版本，本用例**只读**它们。
//   ★ 这里**刻意不再钉整张 xlsx 的 sha256**（用户明确点名：把文件字节当期望值是错误做法 ——
//     改一格数据就整片假红）。改成三条能说明问题的东西：
//       ① 文件存在（上一条）；② parseFeeSheet() 解析成功；③ 解析结果与台账逐批对账。
//   ★ "解析成功"用解析结果本身证明：合计行必须等于逐行求和（读错列/读空会立刻不等）。
for (const f of LIST_FILES) {
    const b = G.batches.find(x => x.pj === f.pj);
    const s = SHEETS.get(f.pj);
    if (!s) {
        skip(`${f.pj} 的清单文件缺失或解析失败 ⇒ 与台账的对账在本数据集中无断言值`);
        continue;
    }
    ok(Number.isFinite(s.detailRows) && s.detailRows > 0 && Number.isFinite(s.feeTotal),
        `${f.pj}.xlsx 解析成功（明细 ${s.detailRows} 行 / 实收合计 ${s.feeTotal} / 原价合计 ${s.listTotal}）`);
    // 合计行不是手改的数，是明细加出来的 ⇒ 解析口径自洽（读错列就会红）
    ok(s.paidPerRow === s.feeTotal && s.listPerRow === s.listTotal,
        `${f.pj} 逐行求和 = 合计行（实收 ${s.paidPerRow} = ${s.feeTotal}；原价 ${s.listPerRow} = ${s.listTotal}）`);
    // 逐批与台账对账（这三条就是替代 sha256 的东西）
    ok(s.detailRows === b.sheetItemCount,
        `${f.pj} 清单明细 ${s.detailRows} 行 = 台账 sheetItemCount ${b.sheetItemCount}`);
    ok(s.feeTotal === NUM(b.sheetPaidFee),
        `${f.pj} 清单「实际费用」合计 ${s.feeTotal} = 台账 sheetPaidFee ${b.sheetPaidFee}`);
    ok(s.listTotal === NUM(b.sheetListFee),
        `${f.pj} 清单「评级费原价」合计 ${s.listTotal} = 台账 sheetListFee ${b.sheetListFee}`);
    // ★ 已售出行（现算）也必须能在清单里逐行对上（cert + 金额）
    const sold = soldOf(b);
    const soldInSheet = sold.every(r => s.rows.some(x => x.cert === r.cert && x.paidFee === r.paidFee && x.listFee === r.listFee));
    ok(soldInSheet,
        `${f.pj} 现算出的 ${sold.length} 行已售出行都能在清单里逐行对上（cert + 原价 + 实收）`);
    // 原价合计 - 折扣 = 实收（数据文件里记的"代理折扣9折"）
    ok(R1(s.listTotal * DISCOUNT) === R1(s.feeTotal),
        `${f.pj} 原价合计 ${s.listTotal} × ${DISCOUNT} = ${R1(s.listTotal * DISCOUNT)} = 实收 ${s.feeTotal}`);
}
// 全局：5 份清单现算出来的合计 == 台账留档总合计（原先靠抄 SHEET_EXPECT 才成立的等式）
{
    const parsed = LIST_FILES.map(f => SHEETS.get(f.pj)).filter(Boolean);
    ok(parsed.length === LIST_FILES.length,
        `全部 ${LIST_FILES.length} 份清单都解析成功（实际 ${parsed.length} 份）`);
    ok(R1(parsed.reduce((s, v) => s + v.feeTotal, 0)) === SHEET_PAID,
        `现算的 ${parsed.length} 份清单实收合计 ${R1(parsed.reduce((s, v) => s + v.feeTotal, 0))} = 台账留档总合计 ${SHEET_PAID}`);
    ok(parsed.reduce((s, v) => s + v.detailRows, 0) === SHEET_ROWS,
        `现算的清单明细行数合计 ${parsed.reduce((s, v) => s + v.detailRows, 0)} 行 = 台账留档总行数 ${SHEET_ROWS}`);
}

// ══════════════════════════════════════════════════════════════
section('⑩ 导航里藏起来，但数据照常加载（分类列表不出现它）');
// ══════════════════════════════════════════════════════════════
const cfgSrc = readFileSync(join(COL, 'config.js'), 'utf8');
const coreSrc = readFileSync(join(COL, 'core.js'), 'utf8');
// ⑩-1 节点声明在 config.js，dataKey 与文件名都对
//   ★ 注意两套字段名：config.js 的节点用 { dataKey, dataFile }，
//     而 walkTree() 产出的是 { key, file, var }（data-loader 就是靠这个去加载文件的）。
const gfNode = JSON.parse(vm.runInContext(`window.__gf = JSON.stringify((function(){
    let hit = null;
    (function walk(n){ for (const c of (n||[])) { if (c && c.id === 'grading_fee') hit = { id: c.id, name: c.name, dataKey: c.dataKey, dataFile: c.dataFile, navHidden: c.navHidden }; if (c && c.children) walk(c.children); } })(categoryTree);
    return hit;
})());`, loaderCtx, { filename: 'gfnode.js' }));
ok(!!gfNode && gfNode.dataKey === 'gradingFeeData' && gfNode.dataFile === '../notecollection/data/grading_fee.js',
    `config.js 里声明了 grading_fee 节点（dataKey=${gfNode && gfNode.dataKey}，dataFile=${gfNode && gfNode.dataFile}）`);
ok(!!gfNode && gfNode.navHidden === true, '该节点带 navHidden: true（只用来让 walkTree / check-data 看得见这个 dataKey）');
// ⑩-2 navHidden 的过滤只发生在 getCategoryTree()（唯一的显示漏斗）
ok(/function visibleCategoryTree/.test(coreSrc), 'core.js 里有 visibleCategoryTree()（navHidden 过滤的唯一入口）');
ok(/return tree \? visibleCategoryTree\(tree\) : null;/.test(coreSrc), 'getCategoryTree() 走的就是 visibleCategoryTree()（唯一显示漏斗）');
ok(/function getCategoryTree/.test(coreSrc) && (coreSrc.match(/visibleCategoryTree\(/g) || []).length === 2,
    'visibleCategoryTree 只在定义处与 getCategoryTree 里被引用（没有别处偷偷过滤）');
// ⑩-3 数据侧仍然收得到它：walkTree（data-loader 决定加载哪些文件）与 allDataKeys（check-data 用）
const nav = JSON.parse(vm.runInContext(`window.__nav = JSON.stringify((function(){
    const walk = walkTree(categoryTree, []).map(c => c.key);
    return { walk: walk, all: (typeof allDataKeys !== 'undefined' ? allDataKeys.slice() : []) };
})());`, loaderCtx, { filename: 'nav.js' }));
ok(nav.walk.includes('gradingFeeData'), 'walkTree(categoryTree)（data-loader 用它决定加载哪些文件）**仍然**收得到 gradingFeeData —— 数据照常加载');
ok(nav.all.includes('gradingFeeData'), 'allDataKeys（check-data 与前端共用）**仍然**含 gradingFeeData');
// ★ "它仍是最后一个 dataKey"属于**数据文件的顺序**，不是渲染行为 —— 按用户要求降级成日志
//   （往前插一个 dataKey 不该让本用例变红；真正要钉的是"声明与加载没有错位"，见下一条）。
console.log(`      （日志）allDataKeys 里 gradingFeeData 的位置：${nav.all.indexOf('gradingFeeData')} / ${nav.all.length}`);
ok(nav.walk.length === nav.all.length, `walkTree 与 allDataKeys 的长度一致（${nav.walk.length} 个）—— 声明与加载没有错位`);

// ══════════════════════════════════════════════════════════════
section('⑪ 「我的」页必须保持原样（资金统计与导出逐字回退到 HEAD）');
// ══════════════════════════════════════════════════════════════
const settingsSrc = readFileSync(join(COL, 'settings.js'), 'utf8');
const statsSrc2 = readFileSync(join(COL, 'stats.js'), 'utf8');
const layoutSrc = readFileSync(join(COL, 'layout.css'), 'utf8');
ok(!/collectGradingFees|buildMoneyBreakdownHtml|gradingFeeData|grading_fee/.test(settingsSrc),
    'settings.js 里没有任何评级费痕迹（资金投入区已回退成改动前的样子）');
ok(!/collectGradingFees|buildMoneyBreakdownHtml|gradingFeeData|formatMoneyAmount|parseMoneyAmount/.test(statsSrc2),
    'stats.js 里没有 collectGradingFees / 金额三段式那套（Markdown 与价格清单导出都回退了）');
ok(!/money-sub/.test(layoutSrc), 'layout.css 里没有只为「我的」服务的 .money-sub 样式（已删）');
ok(/藏品总投入/.test(settingsSrc) && /藏品均价/.test(settingsSrc), '「我的」的资金投入仍是「藏品总投入 / 藏品均价」两行');

// ══════════════════════════════════════════════════════════════
section('⑫ 真实页面：时间轴里有 5 条评级费、与藏品按日期混排');
// ══════════════════════════════════════════════════════════════
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};
const ROOT = process.cwd();
const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const full = join(ROOT, p);
        if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
        // ★ 用 statSync（同步版）：这里的形参叫 res，但早先写成 stat(full) 时撞上了
        //   `import { stat }` 被形参遮蔽 —— 页面直接 500 成一行 "stat is not defined"，
        //   所有页面断言会一起红。改名/改同步版都能躲开，这里用同步版最省事。
        if (statSync(full).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
        const buf = await readFile(full);
        res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
        res.end(buf);
    } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]).find(p => p && existsSync(p));

if (!chromePath) {
    console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium');
    console.log('\n──────── 通过 ' + pass + ' / 失败 ' + fail + ' / 跳过 ' + skipped + '（浏览器段未跑） ────────');
    server.close();
    process.exit(2);
}

const userDir = await mkdtemp(join(tmpdir(), 'cdpGF-'));
const DP = 13700 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); const pageErrors = [];
const wsUrl = await (async () => {
    for (let i = 0; i < 80; i++) {
        try {
            const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json();
            const p = l.find(t => t.type === 'page');
            if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
        } catch { }
        await sleep(250);
    }
    throw new Error('CDP 未就绪');
})();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.text || '');
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
}

// ★ WANT_AMTS / WANT_DATES 都已在文件顶部**从数据现算**（按付款日期升序），这里不再重定义。

try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
    // ★ 等到**这个台账真的加载完**再断言 —— 只等"函数存在"会早于数据注入，
    //   那几条会全红（数据是异步注入的）。
    let dataReady = false;
    for (let i = 0; i < 200; i++) {
        dataReady = await evaluate(`typeof DATA_MAP!=='undefined' && !!DATA_MAP['gradingFeeData']`).catch(() => false);
        if (dataReady) break;
        await sleep(150);
    }
    for (let i = 0; i < 140; i++) {
        const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
        if (r) break;
        await sleep(120);
    }
    await sleep(900);
    ok(dataReady, '页面就绪：评级费台账已随其他数据一起注入（异步加载完成）');

    // ⑫-1 导航隐藏 / 数据仍加载（真实页面，不只是静态推断）
    ok(await evaluate(`!(document.querySelector('.sidebar')||{innerText:''}).innerText.includes('评级费')`),
        '真实页面：侧边栏里搜不到「评级费」（分类确实藏起来了）');
    ok(await evaluate(`typeof DATA_MAP!=='undefined' && !!DATA_MAP['gradingFeeData'] && DATA_MAP['gradingFeeData'].batches.length===${G.batches.length}`),
        `真实页面：window.DATA_MAP["gradingFeeData"] 仍然加载成功（${G.batches.length} 个批次，与数据文件一致）`);
    const pageTotal = await evaluate(`typeof gradingFeeTotal==='function' ? gradingFeeTotal() : -1`);
    ok(Math.abs(pageTotal - KEPT_PAID) < 1e-9, `真实页面：gradingFeeTotal() = ${KEPT_PAID}（支出；实际 ${pageTotal}）`);
    ok(await evaluate(`typeof getCategoryTree==='function' && !getCategoryTree().some(c=>c.id==='grading_fee')`),
        '真实页面：getCategoryTree() 里没有 grading_fee');

    // ⑫-2 藏品口径没被污染
    const copyCount = await evaluate(`typeof collectAllCopies==='function' ? collectAllCopies().length : -1`);
    // ★ 基线数字会随用户往数据里加藏品而变（用户在 republic_cbc.js 里加了 3 枚 ⇒ 396→399）。
    //   这条断言的本意是"台账没有被算进藏品总数"，所以改成**与页面自己的口径对照**：
    //   藏品的 series/copies 里根本没有 grading_fee，台账 series 为空。
    ok(copyCount > 0 && await evaluate(`DATA_MAP['gradingFeeData'].series.length === 0`),
        `藏品总数 ${copyCount} 件；台账 series 为空（评级费没被算进藏品总数）`);
    ok(await evaluate(`collectAllCopies().every(c => !c.__fromFeeLedger)`),
        'collectAllCopies() 里没有任何来自台账的条目');

    // ⑫-3 进入「币海拾年」
    const sid = await evaluate(`(()=>{
        const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
        const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'years');
        if (!hit) return '';
        if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
        return hit.id;
    })()`);
    for (let i = 0; i < 40; i++) {
        const ready = await evaluate(`!!document.querySelector('.timeline-header') && !!document.getElementById('timelineYearFilter')`).catch(() => false);
        if (ready) break;
        await sleep(300);
    }
    await sleep(600);
    ok(!!sid, `进入「币海拾年」（专题 id = ${sid || '没找到'}）`);

    // 切到全部时间 + 最早优先，保证 5 条都在视野里
    await evaluate(`(()=>{ const ys=document.getElementById('timelineYearFilter'), ms=document.getElementById('timelineMonthFilter');
        ys.value='全部'; ms.value='全部'; if(typeof setTimelineOrder==='function') setTimelineOrder('asc'); return true; })()`);
    await sleep(900);

    // ⑫-4 时间轴里的 5 条评级费（★ 用 data-type / 专属 class 定位，不再靠"文案里有没有评级费"）
    const feeRows = await evaluate(`(()=>{
        const out = [];
        for (const it of document.querySelectorAll('.timeline-item')) {
            if (it.dataset.type !== 'fee') continue;
            const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
            let d = ''; let p = it.previousElementSibling;
            while (p && !p.classList.contains('timeline-date-header')) p = p.previousElementSibling;
            if (p) d = (p.querySelector('.timeline-date-label')||{}).textContent || '';
            const a = card.querySelector('a.timeline-fee-link');
            // ★ 第二行用**字段**量：各字段是独立 <span class="fee-f">，分隔符由 CSS ::before 画，
            //   所以这里显式按字段取，不依赖分隔符是否进了 innerText。
            //   ★ 口径（用户裁定）：第二行是 3 个 .fee-f（送评日期 / 单号 / 评级收费）
            //     + 1 个 <a class="timeline-fee-link">（下载清单）。链接**故意**不是 .fee-f，
            //     否则 .fee-f + .fee-f::before 会在「评级收费」和链接之间多画一个 ·。
            const fields = [...card.querySelectorAll('.timeline-fee-sub .fee-f')].map(e => e.textContent.trim());
            out.push({
                pj: (fields[1] || '').replace('单号：', ''),
                date: d.replace(/\\u00A0/g,' ').trim(),
                tag: ((card.querySelector('.timeline-fee-tag')||{}).textContent||'').trim(),
                hasTag: !!card.querySelector('.timeline-fee-tag'),
                title: ((card.querySelector('.timeline-fee-title')||{}).textContent||'').trim(),
                fields,
                sub: fields.join(' \\u00B7 '),
                text: card.textContent.replace(/\\u00A0/g,' ').replace(/\\s+/g,' ').trim(),
                html: card.outerHTML,
                feeFieldCount: card.querySelectorAll('.timeline-fee-sub .fee-f').length,
                noImgTxt: /暂无图片/.test(card.textContent),
                imgs: card.querySelectorAll('img').length,
                imagesBox: card.querySelectorAll('.timeline-images').length,
                noImgBox: card.querySelectorAll('.timeline-no-img').length,
                cardClass: card.className,
                itemClass: it.className,
                linkHref: a ? a.getAttribute('href') : null,
                linkTarget: a ? a.getAttribute('target') : null,
                linkRel: a ? a.getAttribute('rel') : null,
                linkAbs: a ? a.href : null,
                linkText: a ? a.textContent.trim() : null,
                linkDeco: a ? getComputedStyle(a).textDecorationLine : null,
                linkColor: a ? getComputedStyle(a).color : null,
                linkCursor: a ? getComputedStyle(a).cursor : null
            });
        }
        return out;
    })()`);
    ok(Array.isArray(feeRows) && feeRows.length === ENTRY_BATCHES.length,
        `时间轴里正好 ${ENTRY_BATCHES.length} 条评级费条目（实际 ${Array.isArray(feeRows) ? feeRows.length : feeRows}）`);

    const feeDates = (feeRows || []).map(r => r.date);
    const wantDateLabels = ENTRY_BATCHES.map(b => cnDate(b.paidDate));
    ok(JSON.stringify(feeDates) === JSON.stringify(wantDateLabels),
        `${wantDateLabels.length} 条的日期就是那 ${wantDateLabels.length} 个**付款日期**、且顺序一致：${feeDates.join(' / ')}`);

    // ⑫-4a ★ 第一行 = 「评级费」【大标题】 + 主题色圆角标签（文字 = 「评级公司：」+ 数据里的短名）
    ok((feeRows || []).every(r => r.title === '评级费'),
        `★ 第一行开头是「评级费」大标题（实际 ${JSON.stringify((feeRows || []).map(r => r.title))}）`);
    ok((feeRows || []).every(r => r.hasTag && r.tag === '评级公司：' + GRADERS_SHORT_OF(r.pj)),
        `★ 圆角标签文本 = 「评级公司：」+ 数据里的 graderShort（实际 ${JSON.stringify((feeRows || []).map(r => r.tag))}）`);
    // ★ 下面这条是**数据侧**的一致性（"这几批恰好是同一家公司"），按用户要求**降级成日志**：
    //   渲染正确与否已经由上面那条"逐条 = 数据里的 graderShort"钉住，公司名本身不该被写死。
    console.log(`      （日志）页面上出现的标签：${JSON.stringify([...new Set((feeRows || []).map(r => r.tag))])}`);
    // ★ 第一行 DOM 顺序：评级费 → 标签（评级公司：ACG）→ 下载清单
    ok((feeRows || []).every(r => /评级费[\s\S]*timeline-fee-tag[^>]*>评级公司：[\s\S]*?<\/span>[\s\S]*?下载清单/.test(r.html)),
        '★ 第一行 DOM 顺序 = 评级费 → 圆角标签（评级公司：ACG）→ 下载清单');
    ok((feeRows || []).every(r => !/timeline-fee-grader/.test(r.html)),
        '不再有独立的「评级公司：」文字节点（前缀已经进标签里了）');
    ok((feeRows || []).every(r => r.itemClass.includes('timeline-item--fee') || r.cardClass.includes('timeline-card--fee')),
        '费用条目带专属 class（timeline-item--fee / timeline-card--fee），与藏品条目可区分');

    // ⑫-4b ★ 完全不占图片位：没有「暂无图片」、没有任何 <img>、没有图片容器/占位节点
    ok((feeRows || []).every(r => r.noImgTxt === false), '费用条目里**没有**「暂无图片」字样');
    ok((feeRows || []).every(r => r.imgs === 0), `费用条目里**一个 <img> 都没有**（实际 ${JSON.stringify((feeRows || []).map(r => r.imgs))}）`);
    ok((feeRows || []).every(r => r.imagesBox === 0), '费用条目里没有 .timeline-images 图片容器（整行根本不生成图片列）');
    ok((feeRows || []).every(r => r.noImgBox === 0), '费用条目里没有 .timeline-no-img 占位节点');
    ok((feeRows || []).every(r => !/<img|timeline-no-img|timeline-images/.test(r.html)),
        '整段 HTML 里不含 <img>／.timeline-no-img／.timeline-images');

    // ⑫-4c ★ 第二行：字段与顺序 = 送评日期 / 单号 / 评级收费 / 下载清单
    ok((feeRows || []).every(r => r.feeFieldCount === 3),
        `第二行正好 3 个 .fee-f 字段 + 1 个链接（实际 .fee-f ${JSON.stringify((feeRows || []).map(r => r.feeFieldCount))}）`);
    ok((feeRows || []).every((r, i) => !!ENTRY_BATCHES[i] && r.fields[0] === '送评日期：' + cnDate(ENTRY_BATCHES[i].sentDate)),
        `第 1 个字段 = 「送评日期：…」（是送评日期，不是付款日期；实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[0])}）`);
    ok((feeRows || []).every(r => !WANT_DATES.some(d => r.fields[0].includes(cnDate(d)))),
        '第 1 个字段里**没有**付款日期（付款日期只出现在日期分组头）');
    ok((feeRows || []).every((r, i) => !!ENTRY_BATCHES[i] && r.fields[1] === '单号：' + ENTRY_BATCHES[i].pj),
        `第 2 个字段 = 「单号：PJ…」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[1])}）`);
    ok((feeRows || []).every(r => /^评级收费：[\d.]+元$/.test(r.fields[2])),
        `第 3 个字段 = 「评级收费：xx元」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[2])}）`);
    ok((feeRows || []).every(r => r.linkText === '下载清单'),
        `第 4 项（链接）= 「下载清单」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].linkText)}）`);
    ok((feeRows || []).every(r => /送评日期[\s\S]*单号[\s\S]*评级收费/.test(r.html)),
        '第二行 HTML 里的先后顺序是 送评日期 → 单号 → 评级收费');
    // ★ 第一行顺序：评级费 → 标签(评级公司：ACG) → 下载清单（链接**已经在第一行**）
    ok((feeRows || []).every(r => {
        const main = (r.html.match(/<div class="timeline-fee-main">([\s\S]*?)<\/div>/) || [])[1] || '';
        return /评级费/.test(main) && /timeline-fee-tag/.test(main) && /下载清单/.test(main)
            && main.indexOf('评级费') < main.indexOf('timeline-fee-tag')
            && main.indexOf('timeline-fee-tag') < main.indexOf('下载清单');
    }), '★ 第一行里 评级费 → 标签 → 下载清单 的先后顺序正确（链接在第一行）');
    ok((feeRows || []).every(r => !/timeline-fee-sub[\s\S]*?下载清单/.test(r.html)),
        '★ 第二行（.timeline-fee-sub）里**没有**「下载清单」（已经移到第一行）');
    // ★ 链接刻意不在 .fee-f 族里（否则 ::before 会在「评级收费」后面多画一个 ·）
    ok((feeRows || []).every(r => !/class="fee-f[^"]*"[^>]*>[^<]*下载清单/.test(r.html)),
        '链接**不是** .fee-f（不会与「评级收费」之间多一个 · 分隔符）');
    // ★ 第 3 个字段的金额必须是**支出口径**（有换壳行/已售出行的批次 ≠ 留档实收）
    ok((feeRows || []).every((r, i) => NUM(r.fields[2]) === ENTRY_AMTS[i]),
        `★ 每条金额 = 该批**支出口径**（${(feeRows || []).map(r => NUM(r.fields[2])).join(' / ')} vs 现算 ${ENTRY_AMTS.join(' / ')}）`);
    ok((feeRows || []).every(r => !/购入价格/.test(r.text)), '不出现「购入价格」字样（那是藏品的说法，费用条目不沿用）');
    ok((feeRows || []).every(r => !/批次[\s\S]*PJ/.test(r.text) && !/（\d+ 项）/.test(r.text)),
        '不出现「批次 …（N 项）」这种标题');
    ok((feeRows || []).every(r => !/\d+\s*件/.test(r.text)), '第二行里不再列件数（用户给的版式里没有件数）');
    // ★ 短名标签必须来自数据（写死 ACG 就会红）：逐条与数据里的 graderShort 比
    ok((feeRows || []).every(r => r.tag === '评级公司：' + GRADERS_SHORT_OF(r.pj)),
        `页面上的标签就是「评级公司：」+ 数据里的 graderShort（实际 ${JSON.stringify((feeRows || []).map(r => r.tag))}）`);
    ok((feeRows || []).every((r, i) => !!ENTRY_BATCHES[i] && (r.text.match(new RegExp(ENTRY_BATCHES[i].pj, 'g')) || []).length === 1),
        `每条里 PJ 编号只出现**一次**（实际 ${JSON.stringify((feeRows || []).map((r, i) => (r.text.match(new RegExp(ENTRY_BATCHES[i].pj, 'g')) || []).length))}）`);
    ok((feeRows || []).every(r => r.date && r.date.length > 0), '每条都落在某个日期分组头下（分组没坏）');
    if (SOLD_CERTS.length === 0) skip('台账里没有已售出编码 ⇒ "已售出编码不出现在卡片里" 在本数据集中无断言值');
    else ok((feeRows || []).every(r => !SOLD_CERTS.some(c => r.text.includes(c))),
        `现算出的 ${SOLD_CERTS.length} 个已售出编码没有出现在卡片里（${SOLD_CERTS.join(', ')}）`);

    // ⑫-4d 金额：第二行里的「评级收费」= 该批支出（不是留档那侧）
    const feeAmts = (feeRows || []).map(r => NUM(r.fields[2]));
    ok(JSON.stringify(feeAmts) === JSON.stringify(ENTRY_AMTS),
        `「评级收费」= ${ENTRY_AMTS.join(' / ')}（支出口径；实际 ${feeAmts.join(' / ')}）`);
    ok(R1(feeAmts.reduce((s, v) => s + v, 0)) === KEPT_PAID,
        `${feeAmts.length} 笔金额之和 = ${KEPT_PAID}（实际 ${R1(feeAmts.reduce((s, v) => s + v, 0))}）`);
    ok((feeRows || []).every((r, i) => r.fields[2] === '评级收费：' + ENTRY_AMTS[i] + '元'),
        `金额逐条逐字正确（${ENTRY_AMTS.map(v => v + '元').join(' / ')}）`);
    // ★ 有"已售出/换壳"被剔除的批次，其时间轴金额必须 ≠ 该批留档实收（否则说明页面上还在显示留档值）
    {
        const withExcluded = ENTRY_BATCHES.filter(b => NUM(b.paidFee) !== NUM(b.sheetPaidFee));
        ok(withExcluded.length > 0 && withExcluded.every(b => feeAmts[ENTRY_BATCHES.indexOf(b)] !== NUM(b.sheetPaidFee)),
            `支出被剔除过的 ${withExcluded.length} 个批次：页面上显示的是支出，**不是**留档实收（${withExcluded.map(b => b.pj + ' ' + b.paidFee + '≠' + b.sheetPaidFee).join(' / ')}）`);
    }
    ok((feeRows || []).every(r => !/timeline-fee-amount/.test(r.html)),
        '不再有独立的右侧金额节点（金额改成第二行里的「评级收费」，按用户给的版式走）');

    // ⑫-4e ★「下载清单」链接：数据给了 listUrl，就必须是能打开的真链接
    //   （文案从「查看清单」改成「下载清单」—— 点开确实是下载，用户要求改）
    ok((feeRows || []).every(r => r.linkText === '下载清单'), '每条都渲染出了「下载清单」链接');
    ok((feeRows || []).every(r => r.linkHref === '../notecollection/readmes/image/grading_fee/' + r.fields[1].replace('单号：', '') + '.xlsx'),
        `href = 相对路径 ../notecollection/readmes/image/grading_fee/<PJ>.xlsx（实际 ${(feeRows || [])[0] && (feeRows || [])[0].linkHref}）`);
    ok((feeRows || []).every(r => r.linkTarget === '_blank'), 'target="_blank"（新窗口打开，与正文里的外链一致）');
    ok((feeRows || []).every(r => r.linkRel === 'noopener'), 'rel="noopener"（新窗口打开的既有约定）');
    ok((feeRows || []).every(r => r.linkDeco === 'underline'),
        `链接带下划线（与正文 <a> 一致；实际 ${(feeRows || [])[0] && (feeRows || [])[0].linkDeco}）`);
    // ★ 与正文链接同色：正文里没有任何 a 的着色规则，靠浏览器对 color-scheme 的默认映射；
    //   所以比对"页面内正文示例 <a>"的实测色，而不是写死一个色值。
    const artLinkColor = await evaluate(`(()=>{
        const h = document.createElement('div');
        h.className = 'article-reader'; h.style.cssText = 'position:absolute;left:-9999px;top:0';
        h.innerHTML = '<p>一篇拙劣的<a href="https://example.com/">论文</a></p>';
        document.body.appendChild(h);
        const c = getComputedStyle(h.querySelector('a')).color;
        h.remove();
        return c;
    })()`);
    ok(!!artLinkColor && (feeRows || []).every(r => r.linkColor === artLinkColor),
        `★「下载清单」与正文行内链接同色（都是 ${artLinkColor}）`);
    const linkStatus = JSON.parse(await evaluate(`(async()=>{
        const out = [];
        for (const a of document.querySelectorAll('.timeline-item[data-type="fee"] .timeline-fee-link')) {
            const r = await fetch(a.href, { method: 'HEAD' });
            out.push([a.getAttribute('href'), r.status]);
        }
        return JSON.stringify(out);
    })()`));
    ok(linkStatus.length === ENTRY_BATCHES.length, `页面上有 ${ENTRY_BATCHES.length} 个清单链接（实际 ${linkStatus.length}）`);
    ok(linkStatus.every(([, s]) => s === 200), `${linkStatus.length} 个链接 HEAD 全部 200、不是 404（实际 ${linkStatus.map(([, s]) => s).join(' / ')}）`);
    ok(linkStatus.every(([h]) => h.includes('grading_fee/') && h.endsWith('.xlsx')), '打开的确实是 grading_fee 目录下的 .xlsx');

    // ⑫-4f ★ listUrl 缺失时**不渲染链接**（不留空占位、不出死链）
    //   渲染分支已经由 ⑧-1b 用"删掉 listUrl 的数据"验过了（条目上 listUrl 为空串）；
    //   这里在真实 DOM 上按同一条判据（有 listUrl 才有 <a>）复核一遍页面形状。
    const linkShape = JSON.parse(await evaluate(`(()=>{
        const cards = [...document.querySelectorAll('.timeline-card--fee')].filter(c => c.getBoundingClientRect().width > 1);
        const withLink = cards.filter(c => c.querySelector('.timeline-fee-link')).length;
        const cardsNoLink = cards.filter(c => c.querySelector('.timeline-fee-sub .fee-f:last-child') &&
                                             /下载清单/.test(c.querySelector('.timeline-fee-sub .fee-f:last-child').textContent) &&
                                             !c.querySelector('.timeline-fee-link')).length;
        // ★ 底下这些查询也必须限定在**可见卡**（cards）里：页面上还有隐藏容器里的同构副本，
        //   不限定就会取到隐藏副本、拿到空串（这条曾经真的红过）。
        const emptyAnchors = cards.flatMap(c => [...c.querySelectorAll('a')]).filter(a => !a.getAttribute('href') || !a.textContent.trim()).length;
        return JSON.stringify({ cards: cards.length, withLink, cardsNoLink, emptyAnchors,
                                lastFieldTexts: cards.map(c => (c.querySelector('.timeline-fee-sub .fee-f:last-child')||{}).textContent || ''),
                                firstLine: cards.map(c => ((c.querySelector('.timeline-fee-main')||{}).textContent || '').replace(/\\s+/g,' ').trim()),
                                firstLineKids: cards.map(c => [...(c.querySelector('.timeline-fee-main')||{children:[]}).children].map(k => k.className + ':' + k.textContent.replace(/\\s+/g,' ').trim())) });
    })()`));
    ok(linkShape.cards === ENTRY_BATCHES.length && linkShape.withLink === ENTRY_BATCHES.length,
        `${ENTRY_BATCHES.length} 张卡都有 listUrl ⇒ ${ENTRY_BATCHES.length} 个链接（实际 ${linkShape.withLink}/${linkShape.cards}）`);
    ok(linkShape.cardsNoLink === 0, '没有"写着下载清单却没有链接"的卡片（不留空占位）');
    ok(linkShape.emptyAnchors === 0, '没有 href 为空或文字为空的 <a>（不出死链）');
    ok(linkShape.lastFieldTexts.every(t => /^评级收费：/.test(t)),
        `第二行最后一项是「评级收费」（链接已经移到第一行；实际 ${JSON.stringify(linkShape.lastFieldTexts)}）`);
    {
        // ★ 期望值逐卡现算：卡片顺序 = feeRows 顺序 = ENTRY_BATCHES 顺序
        const wantFirst = (feeRows || []).map(r => {
            const sh = GRADERS_SHORT_OF(r.pj);
            return '评级费' + (sh ? '评级公司：' + sh : '') + '下载清单';
        });
        ok(wantFirst.length === linkShape.firstLine.length
            && JSON.stringify(linkShape.firstLine) === JSON.stringify(wantFirst),
            `★ 第一行整体文字 = 「评级费」+（有短名就带「评级公司：X」）+「下载清单」（实际 ${JSON.stringify(linkShape.firstLine)}）`);
    }

    // ⑫-4f-2 ★「下载清单」必须用**普通字号**（用户反馈"几个字太大"）：
    //   它原来跟在大标题后面继承了 0.9rem。现在要求 = 第二行字段字号，且**小于**大标题。
    //   ★ 用计算样式断言（不看 CSS 字面量），这样任何继承/层叠的意外都能抓到。
    const fontSizeProbe = JSON.parse(await evaluate(`(()=>{
        const card = [...document.querySelectorAll('.timeline-card--fee')].find(c => c.offsetParent && c.getBoundingClientRect().width > 1);
        if (!card) return JSON.stringify({});
        const fs = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
        const link = card.querySelector('.timeline-fee-link');
        const title = card.querySelector('.timeline-fee-title');
        const tag = card.querySelector('.timeline-fee-tag');
        const sub = card.querySelector('.timeline-fee-sub');
        const f0 = card.querySelector('.timeline-fee-sub .fee-f');
        const main = card.querySelector('.timeline-fee-main');
        const baseline = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.bottom * 10) / 10; };
        return JSON.stringify({
            link: fs(link), title: fs(title), tag: fs(tag), sub: fs(sub), fee: fs(f0),
            mainAlign: main ? getComputedStyle(main).alignItems : null,
            // "基线对齐"的粗判：链接与标签的文字行底不应差太多（两者字号差一档）
            linkBottom: link ? baseline(link) : null,
            tagBottom: tag ? baseline(tag) : null
        });
    })()`));
    ok(fontSizeProbe.link === fontSizeProbe.fee,
        `★「下载清单」字号 = 第二行字段字号（链接 ${fontSizeProbe.link}px vs 字段 ${fontSizeProbe.fee}px）`);
    ok(fontSizeProbe.link < fontSizeProbe.title,
        `★「下载清单」字号**小于**「评级费」大标题（${fontSizeProbe.link}px < ${fontSizeProbe.title}px）`);
    // ★ 只要求"普通字号（= 第二行字段的 12px）、且小于大标题"；不比圆角标签更小
    //   （标签字号 0.68rem 是刻意的"角标"尺寸，链接没必要跟着缩到那么小）。
    ok(fontSizeProbe.mainAlign === 'baseline',
        `第一行按基线对齐（align-items=${fontSizeProbe.mainAlign}），大小字号混排不会突兀地上浮/下沉`);

    // ⑫-5 与藏品按日期混排：日期分组头整体有序，且评级费夹在藏品日期流里
    const dateOrder = await evaluate(`[...document.querySelectorAll('.timeline-date-label')].map(e=>e.textContent.replace(/\\u00A0/g,' ').trim())`);
    // 页面上的日期分组头是「2025年12月17日」这种写法，统一成 yyyy-mm-dd 再比对。
    // （早先用一串 replace 归一化，单数字月份/日期会被切错 —— 2026年10月1日 会被写成
    //   "2026-1-01"，于是误判成 6 个命中、还误报两条相邻。）
    const toIso = (s) => {
        const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (!m) return String(s);
        return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    };
    const isoOrder = (dateOrder || []).map(toIso);
    const nums = isoOrder.map(s => { const m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0; });
    ok(nums.length > ENTRY_DATES.length && nums.every((v, i) => i === 0 || nums[i - 1] <= v),
        `整条时间轴按日期升序（${nums.length} 个日期分组，逆序 0 处）`);

    const wantIdx = ENTRY_DATES.map(d => isoOrder.indexOf(d)).filter(i => i >= 0);
    // 每个付款日期都必须在分组头里出现。★ 付款日期上**可能恰好也有藏品**（实测有：
    // 2026-01-29 / 2026-04-01 / 2026-10-01 三天都有），此时评级费与当天藏品合并进**同一个**
    // 分组头，命中数仍是"付款日期个数"（因为合并的是"条目"不是"日期"）。若命中数更少，
    // 说明台账的日期键与藏品的写法不一致了（会冒出两个同名分组头），立刻红出来。
    ok(wantIdx.length === ENTRY_DATES.length,
        `${ENTRY_DATES.length} 个付款日期都出现在日期分组头里（实际 ${wantIdx.length} 个：${wantIdx.join(', ')}）`);
    ok(wantIdx.every(p => p > 0 && p < isoOrder.length - 1),
        `它们都夹在藏品日期之间、没有被单独排到某一段（位置 ${wantIdx.join(', ')} / 共 ${isoOrder.length} 组）`);

    // ★ 同名分组头去重：这 5 个日期上如果一个"评级费组"和一个"藏品组"并排出现，
    //   页面上就会看到两个一样的日期标题。分组键必须和藏品那侧完全一致，这里把它钉住。
    const dupHeaders = isoOrder.filter((d, i) => isoOrder.indexOf(d) !== i);
    ok(dupHeaders.length === 0, `没有重复的日期分组头（重复：${[...new Set(dupHeaders)].join(', ') || '无'}）`);

    // 「与藏品混排」的核心证据：这些条目不是被单独插在开头或结尾的一段，
    // 而是各自落在藏品日期流中间 —— 前后都有其他（藏品）日期分组。
    const hasBefore = wantIdx.filter(p => p > 0).length;
    const hasAfter = wantIdx.filter(p => p < isoOrder.length - 1).length;
    ok(hasBefore === ENTRY_DATES.length && hasAfter === ENTRY_DATES.length,
        `${ENTRY_DATES.length} 条的前后都有藏品日期分组（前面有内容 ${hasBefore}/${ENTRY_DATES.length}，后面有内容 ${hasAfter}/${ENTRY_DATES.length}）`);

    // ★ 与同日藏品"同组"的确认：在 5 个付款日期里，凡是当天也有藏品的，
    //   那一天的组里必须同时有评级费条目和藏品条目（证明是合并成一组、而不是并列两组）。
    const sameDay = await evaluate(`(()=>{
        const out = {};
        for (const h of document.querySelectorAll('.timeline-date-header')) {
            const label = (h.querySelector('.timeline-date-label')||{}).textContent.replace(/\\u00A0/g,' ').trim();
            let n = 0, fee = 0, sib = h.nextElementSibling;
            while (sib && !sib.classList.contains('timeline-date-header')) {
                if (sib.classList.contains('timeline-item')) {
                    n++;
                    // ★ 费用条目靠 data-type 认，不再靠 meta 文案（重新设计后 meta 节点已不存在）
                    if (sib.dataset.type === 'fee') fee++;
                }
                sib = sib.nextElementSibling;
            }
            out[label] = { n, fee };
        }
        return JSON.stringify(out);
    })()`).then(v => JSON.parse(v || '{}'));
    const feeLabelOf = (iso) => { const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[1]}年${+m[2]}月${+m[3]}日` : iso; };
    let mixedDays = 0, soloDays = 0; const badMix = [];
    for (const iso of ENTRY_DATES) {
        const g = sameDay[feeLabelOf(iso)];
        if (!g) { badMix.push(iso + ':分组缺失'); continue; }
        if (g.fee !== 1) { badMix.push(iso + ':评级费条目数=' + g.fee); continue; }
        if (g.n > 1) mixedDays++; else soloDays++;
    }
    ok(badMix.length === 0, `每个付款日期的分组里都恰好有 1 条评级费（异常：${badMix.join(' / ') || '无'}）`);
    ok(mixedDays + soloDays === ENTRY_DATES.length,
        `其中 ${mixedDays} 天与当天藏品同组、${soloDays} 天只有评级费（合计 ${ENTRY_DATES.length} 天）`);
    if (mixedDays === 0) skip(`没有任何一个付款日期当天也有藏品 ⇒ "同日合组"在本数据集中无断言值（${soloDays} 天只有评级费）`);
    else ok(mixedDays >= 1,
        `其中 ${mixedDays} 天是"与当天藏品同组"的混排（g.n > 1 ⇒ 同一个分组头里既有费用条目又有藏品条目），${soloDays} 天只有评级费`);

    // ⑫-6 藏品口径没被污染：时间轴的条目增量**正好等于 5 条评级费**。
    //   这里不硬编码时间轴基线（有的藏品没填 purchaseDate，基线并不是 396），
    //   而是按页面上那份遍历逻辑自己数一遍"如果没有台账会有多少条"，
    //   于是"多出来的正好是台账那 5 条"就成了机制性证明。
    const baseline = await evaluate(`(()=>{
        let n = 0;
        const maps = [window.DATA_MAP || {}, window.COIN_DATA_MAP || {}, window.FUN_DATA_MAP || {}];
        for (const m of maps) for (const k of Object.keys(m)) {
            const d = m[k]; if (!d || !d.series) continue;
            for (const s of d.series) {
                const cs = [];
                if (s.varieties) { for (const v of s.varieties) for (const c of (v.copies || [])) cs.push(c); }
                else if (s.copies) { for (const c of s.copies) cs.push(c); }
                for (const c of cs) if (c && c.purchaseDate) n++;
            }
        }
        return n;
    })()`);
    const topCount = await evaluate(`(document.querySelector('.timeline-top-count')||{}).textContent || ''`);
    const topN = NUM(topCount);
    ok(topN === baseline + ENTRY_DATES.length,
        `时间轴条目数 = 藏品（填了购入日期的）${baseline} + 评级费 ${ENTRY_DATES.length} = ${baseline + ENTRY_DATES.length}（实际「${topCount}」）`);
    ok(topN !== copyCount, `评级费是**独立的一份条目数据**、没有混进 collectAllCopies()（藏品口径 ${copyCount} ≠ 时间轴 ${topN}）`);

    // ⑫-7 「我的」页在真实页面上也没被改：资金投入还是两行、且不含评级费
    await evaluate(`(()=>{ if (typeof onTabClick==='function') onTabClick('settings'); return true; })()`);
    await sleep(1200);
    const moneyLabels = await evaluate(`[...document.querySelectorAll('.money-label')].map(e=>e.textContent.trim())`);
    ok(JSON.stringify(moneyLabels) === JSON.stringify(['藏品总投入', '藏品均价']),
        `「我的」页资金投入仍是原来两行（实际 ${JSON.stringify(moneyLabels)}）`);
    const moneyValues = await evaluate(`[...document.querySelectorAll('.money-value')].map(e=>e.textContent.trim())`);
    ok(!moneyValues.some(v => /评级费/.test(v)) && !new RegExp(String(SHEET_PAID).replace('.', '\\.')).test(moneyValues.join(' ')),
        `资金投入里没有评级费（实际 ${JSON.stringify(moneyValues)}）`);
    ok(await evaluate(`!document.querySelector('.money-sub')`), '「我的」页没有 .money-sub 那层（样式已删干净）');

    // ⑫-8 深色模式 + 手机宽度下这 5 条不炸（沿用既有实现，用户明确要求过）
    // 上一步去了「我的」页，这里先回到「币海拾年」再测。
    await evaluate(`(()=>{
        const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
        const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'years');
        if (hit && typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
        return true;
    })()`);
    for (let i = 0; i < 40; i++) {
        const ready = await evaluate(`!!document.querySelector('.timeline-header') && !!document.getElementById('timelineYearFilter')`).catch(() => false);
        if (ready) break;
        await sleep(300);
    }
    await evaluate(`(()=>{ const ys=document.getElementById('timelineYearFilter'), ms=document.getElementById('timelineMonthFilter');
        if (ys) ys.value='全部'; if (ms) ms.value='全部'; if (typeof setTimelineOrder==='function') setTimelineOrder('asc'); return true; })()`);
    await sleep(800);
    // ★ 站内的视图容器是复用的：切页时旧容器只被 display:none，DOM 仍留在文档里，
    //   于是 page 级 querySelectorAll('.timeline-item') 会同时数到隐藏容器里的旧条目
    //   （实测数出 10 条 = 两份）。所以下面一律**只数可见的**（getBoundingClientRect 非零）。
    //   明暗模式由 theme.js 的 applyColorScheme() 写在 <html data-color-scheme="dark"> 上，
    //   入口是 setColorSchemeMode('dark')（setTheme 只管主题色，不管明暗）。
    const themeOn = await evaluate(`(()=>{
        if (typeof setColorSchemeMode === 'function') { setColorSchemeMode('dark'); return true; }
        return false;
    })()`);
    await sleep(700);
    const darkFee = await evaluate(`(()=>{
        const rows = [];
        for (const it of document.querySelectorAll('.timeline-item')) {
            if (it.dataset.type !== 'fee') continue;
            const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
            const r = card.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;   // 隐藏容器里的旧副本
            const cs = getComputedStyle(card);
            rows.push({ w: Math.round(r.width), h: Math.round(r.height),
                        overflow: card.scrollWidth > card.clientWidth + 2,
                        bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius });
        }
        return JSON.stringify({ n: rows.length, rows, scheme: document.documentElement.getAttribute('data-color-scheme') });
    })()`).then(v => JSON.parse(v || '{}'));
    ok(themeOn === true && darkFee.scheme === 'dark' && darkFee.n === ENTRY_DATES.length,
        `深色模式：${ENTRY_DATES.length} 条评级费仍在（data-color-scheme=${darkFee.scheme}，可见条数=${darkFee.n}）`);
    ok((darkFee.rows || []).every(r => r.overflow === false), '深色模式：条目没有横向溢出');
    ok((darkFee.rows || []).every(r => r.h > 0 && r.w > 0), '深色模式：条目都有实际尺寸（没有被压成 0 高）');
    ok((darkFee.rows || []).every(r => r.radius && r.radius !== '0px'), '深色模式：卡片仍带圆角（样式没被主题覆盖掉）');

    // 手机宽度（375px）
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: true });
    await sleep(1500);
    const mobFee = await evaluate(`(()=>{
        const rows = [];
        for (const it of document.querySelectorAll('.timeline-item')) {
            if (it.dataset.type !== 'fee') continue;
            const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
            const r = card.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const main = card.querySelector('.timeline-fee-main');
            const mr = main ? main.getBoundingClientRect() : null;
            rows.push({ w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right),
                        overflow: card.scrollWidth > card.clientWidth + 2,
                        mainOverflow: main ? main.scrollWidth > main.clientWidth + 2 : null,
                        mainW: mr ? Math.round(mr.width) : 0 });
        }
        return JSON.stringify({ n: rows.length, rows, vw: window.innerWidth, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2 });
    })()`).then(v => JSON.parse(v || '{}'));
    ok(mobFee.n === ENTRY_DATES.length, `手机宽度 375px：${ENTRY_DATES.length} 条评级费仍在（可见条数=${mobFee.n}，视口 ${mobFee.vw}px）`);
    ok((mobFee.rows || []).every(r => r.right <= 375 + 2), '手机宽度：条目没有超出右边（不横向滚动）');
    ok((mobFee.rows || []).every(r => r.overflow === false && r.h > 0), '手机宽度：条目没有溢出、也没有被压成 0 高');
    ok((mobFee.rows || []).every(r => r.mainOverflow === false), '手机宽度：主行（标签+标题+金额）没有被挤到换行/溢出');
    ok(mobFee.docOverflow === false, '手机宽度：整页没有横向滚动条');
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(400);
    // 恢复成跟随系统，免得影响同进程里后续的检查
    await evaluate(`(()=>{ if (typeof setColorSchemeMode === 'function') setColorSchemeMode('system'); return true; })()`);

    // ⑫-9 ★ 费用条目**不可点开大图**：它没有图片，点击/回车都不该触发灯箱，也不该报错
    //   （既有的藏品条目点图仍要能打开灯箱 —— 两条一起验，免得"一刀切禁掉点击"。）
    const clickProbe = await evaluate(`(()=>{
        const out = { feeHits: 0, feeModal: 0, feeAlt: 0, collectibleHits: 0, collectibleModal: 0, collectibleImgs: 0, hasModal: false };
        const orig = (typeof window.openModal === 'function') ? window.openModal : null;
        out.hasModal = !!orig;
        let calls = 0;
        if (orig) window.openModal = function(){ calls++; };
        try {
            // 费用条目：点卡片本体、标签、标题、第二行各字段 —— 都不该开灯箱
            // ★ 刻意**不点「查看清单」那个 <a>**：那是真链接，点它会开新窗口（会被弹窗拦截），
            //   与本检查无关；下面的回车探测避免命中链接本身。
            for (const it of document.querySelectorAll('.timeline-item')) {
                if (it.dataset.type !== 'fee') continue;
                const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
                const r = card.getBoundingClientRect(); if (r.width < 1) continue;
                out.feeHits++;
                const targets = [card, card.querySelector('.timeline-fee-title'), card.querySelector('.timeline-fee-tag')]
                    .concat([...card.querySelectorAll('.timeline-fee-sub .fee-f')]);
                for (const el of targets) { if (el) el.click(); }
                // 回车：费用条目不该有 tabindex / role=button
                if (it.tabIndex >= 0 || card.tabIndex >= 0) out.feeAlt++;
            }
            out.feeModal = calls;
            // 藏品条目：找一个真的有图的，点它的图 —— 必须仍能开灯箱
            const before = calls;
            for (const img of document.querySelectorAll('.timeline-item:not([data-type="fee"]) .timeline-img')) {
                const r = img.getBoundingClientRect();
                out.collectibleImgs++;
                if (r.width < 1) continue;
                img.click();
                out.collectibleHits++;
                break;
            }
            out.collectibleModal = calls - before;
        } finally {
            if (orig) window.openModal = orig;
        }
        return JSON.stringify(out);
    })()`).then(v => JSON.parse(v || '{}'));
    ok(clickProbe.feeHits === ENTRY_DATES.length, `点到了 ${ENTRY_DATES.length} 条费用条目（实际 ${clickProbe.feeHits}）`);
    ok(clickProbe.feeModal === 0, `点费用条目（卡片/标题/金额/标签）**不开灯箱**（openModal 调用 ${clickProbe.feeModal} 次）`);
    ok(clickProbe.feeAlt === 0, '费用条目没有 tabindex/role=button（键盘回车也不会"打开"它）');
    ok(clickProbe.collectibleImgs > 0, `页面上仍有带图的藏品条目（${clickProbe.collectibleImgs} 个）—— 灯箱行为有东西可验`);
    ok(clickProbe.hasModal === true && clickProbe.collectibleModal >= 1,
        `既有藏品条目点图**仍然打开灯箱**（openModal 调用 ${clickProbe.collectibleModal} 次）—— 没被一刀切禁掉`);
    // 键盘回车：派发到费用条目上，同样不该开灯箱
    const enterProbe = await evaluate(`(()=>{
        const orig = (typeof window.openModal === 'function') ? window.openModal : null;
        let calls = 0; if (orig) window.openModal = function(){ calls++; };
        try {
            for (const it of document.querySelectorAll('.timeline-item')) {
                if (it.dataset.type !== 'fee') continue;
                const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
                const r = card.getBoundingClientRect(); if (r.width < 1) continue;
                for (const el of [card, it]) {
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                }
            }
        } finally { if (orig) window.openModal = orig; }
        return calls;
    })()`);
    ok(enterProbe === 0, `费用条目上按回车**不开灯箱**（openModal 调用 ${enterProbe} 次）`);

    // ⑫-10 ★ 「图片离左边那条竖线太远」：向左拉近后重新量一遍间距。
    //   竖线画在 .timeline-left::after 上，与 .timeline-dot 共用同一条 50% 轴线
    //   （点宽 12、left:50%、translateX(-50%)，中心 = 轴；::after 同样居中），
    //   所以这里用**点的中心 x** 代表竖线轴，是真实元素的实测值，不依赖伪元素读取。
    //   改动前 竖线轴=69 → 图片左=125；改动后 → 图片左=77，轴→图 56px 收成 8px。
    const LAYOUT_PROBE = `(()=>{
        const r1 = n => Math.round(n * 10) / 10;
        const o = { vw: window.innerWidth, mq600: matchMedia('(max-width: 600px)').matches };
        for (const it of document.querySelectorAll('.timeline-item')) {
            const left = it.querySelector('.timeline-left'), dot = it.querySelector('.timeline-dot');
            if (!left) continue;
            const lr = left.getBoundingClientRect(); if (lr.width < 1) continue;
            const dr = dot ? dot.getBoundingClientRect() : null;
            const cs = getComputedStyle(left), af = getComputedStyle(left, '::after');
            o.left = { x: r1(lr.left), w: r1(lr.width), dir: cs.flexDirection };
            o.afterDisplay = af.display;
            o.afterLeft = af.left; o.afterW = r1(parseFloat(af.width) || 0);
            if (dr) o.dot = { cx: r1(dr.left + dr.width / 2), w: r1(dr.width) };
            break;
        }
        for (const it of document.querySelectorAll('.timeline-item')) {
            if (it.dataset.type === 'fee') continue;
            const box = it.querySelector('.timeline-images'); if (!box) continue;
            const br = box.getBoundingClientRect(); if (br.width < 1) continue;
            const cr = it.querySelector('.timeline-card').getBoundingClientRect();
            o.col = { imgLeft: r1(br.left), cardLeft: r1(cr.left), cardRight: r1(cr.right) };
            break;
        }
        for (const it of document.querySelectorAll('.timeline-item')) {
            if (it.dataset.type !== 'fee') continue;
            const card = it.querySelector('.timeline-card--fee'); if (!card) continue;
            const cr = card.getBoundingClientRect(); if (cr.width < 1) continue;
            const sub = card.querySelector('.timeline-fee-sub');
            o.fee = { cardLeft: r1(cr.left), cardRight: r1(cr.right),
                      tagLeft: r1(card.querySelector('.timeline-fee-tag').getBoundingClientRect().left),
                      subLeft: sub ? r1(sub.getBoundingClientRect().left) : null };
            o.pull = getComputedStyle(card).marginLeft;
            o.subFontSize = sub ? getComputedStyle(sub).fontSize : null;
            break;
        }
        o.aligned = (o.col && o.fee) ? (o.col.cardLeft === o.fee.cardLeft) : null;
        o.overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
        if (o.dot && o.col) o.gap = r1(o.col.imgLeft - o.dot.cx);
        if (o.dot && o.fee) o.gapFee = r1(o.fee.tagLeft - o.dot.cx);
        return JSON.stringify(o);
    })()`;
    const BASE_CSS = `.timeline-card{margin-left:0 !important;}`;
    const CLAMP_PATCH = `(()=>{
        let s = document.getElementById('__tlpull');
        if (!s) { s = document.createElement('style'); s.id = '__tlpull'; document.head.appendChild(s); }
        // 与 layout.css 里那条 @media (min-width:601px) 的公式保持一致（48px 下限 601px 处为 1px）
        s.textContent = '.timeline-card{--tl-card-pull: clamp(0px, calc(100vw - 454px), 48px);}';
        return true;
    })()`;

    // ① 现状（已应用向左拉）
    const lay = JSON.parse(await evaluate(LAYOUT_PROBE));
    // ② 临时钉住 0，量"改动前"的间距作为对照，同时确认竖线轴没变
    await evaluate(`(()=>{ const s=document.createElement('style'); s.id='__tlbase'; s.textContent=${JSON.stringify(BASE_CSS)}; document.head.appendChild(s); return true; })()`);
    await sleep(500);
    const layBase = JSON.parse(await evaluate(LAYOUT_PROBE));
    // ③ 还原成真实状态
    await evaluate(`(()=>{ const s=document.getElementById('__tlbase'); if(s) s.remove(); const p=document.getElementById('__tlpull'); if(p) p.remove(); return true; })()`);
    await sleep(500);
    const layBack = JSON.parse(await evaluate(LAYOUT_PROBE));

    ok(lay.mq600 === false, `桌面宽度量测（视口 ${lay.vw}px，(max-width:600px) 未命中）`);
    ok(layBase.gap === 56 && lay.gap === 8,
        `★ 竖线轴→图片左边缘：改动前 ${layBase.gap}px → 改动后 ${lay.gap}px（收窄 ${layBase.gap - lay.gap}px）`);
    // 竖线位置没动：同一视口下改前/改后轴完全一致，且仍是 .timeline-left 的中心
    ok(lay.dot.cx === layBase.dot.cx && lay.dot.cx === layBack.dot.cx,
        `★ 竖线轴位置未变（改前/改后都是 x=${lay.dot.cx}）—— 只移内容、没移竖线`);
    ok(Math.abs(lay.dot.cx - (lay.left.x + lay.left.w / 2)) <= 0.5,
        `竖线轴=左列中心（${lay.dot.cx} = ${lay.left.x} + ${lay.left.w}/2）—— 几何自洽`);
    ok(lay.gap === 8 && lay.gap >= 6 && lay.gap <= 10,
        `间距落在"紧凑但不相贴"的区间（${lay.gap}px ∈ [6,10]）`);
    ok(lay.gap > 0 && lay.gap > lay.afterW,
        `图片左边缘在竖线**右侧**、不重叠（间距 ${lay.gap}px > 竖线宽 ${lay.afterW}px）`);
    ok(lay.pull === '-48px' && layBase.pull === '0px',
        `左拉量由 --tl-card-pull 控制（实际 ${lay.pull}，钉住 0 后为 ${layBase.pull}）`);
    ok(lay.col.cardRight === layBase.col.cardRight,
        `卡片右边缘没变（${lay.col.cardRight}）—— 只往左拉，没把卡片撑宽`);
    ok(lay.aligned === true && layBack.aligned === true,
        `★ 费用条目与藏品条目左边缘对齐（都是 ${lay.fee.cardLeft}）`);
    ok(lay.col.cardLeft - lay.col.imgLeft <= 0.5,
        `藏品卡片的图片左边缘 = 卡片左边缘（${lay.col.imgLeft} / ${lay.col.cardLeft}）—— 图片是卡片最左侧内容`);
    ok(lay.overflow === false && layBase.overflow === false, '桌面宽度下没有横向溢出');
    ok(lay.subFontSize === '12px' || parseFloat(lay.subFontSize) <= 13,
        `第二行是灰色小字（font-size=${lay.subFontSize}）`);

    // 手机端：向左拉必须关掉，否则会把内容推出屏幕左边
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: true });
    await sleep(1400);
    const layM = JSON.parse(await evaluate(LAYOUT_PROBE));
    await evaluate(`(()=>{ const s=document.createElement('style'); s.id='__tlbase2'; s.textContent=${JSON.stringify(BASE_CSS)}; document.head.appendChild(s); return true; })()`);
    await sleep(500);
    const layMBase = JSON.parse(await evaluate(LAYOUT_PROBE));
    await evaluate(`(()=>{ const s=document.getElementById('__tlbase2'); if(s) s.remove(); return true; })()`);
    // 再验一下公式在断点附近的自洽：601px 处应≈1px、640px 处 48px 已封顶
    await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 720, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    const lay640 = JSON.parse(await evaluate(LAYOUT_PROBE));
    await send('Emulation.setDeviceMetricsOverride', { width: 601, height: 720, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    await evaluate(CLAMP_PATCH);
    await sleep(400);
    const lay601 = JSON.parse(await evaluate(LAYOUT_PROBE));
    await evaluate(`(()=>{ const p=document.getElementById('__tlpull'); if(p) p.remove(); return true; })()`);
    await sleep(300);

    ok(layM.mq600 === true && layM.vw === 375, `手机 375px：(max-width:600px) 命中=${layM.mq600}，实测视口 ${layM.vw}px`);
    ok(layM.pull === '0px' && layMBase.pull === '0px',
        `手机端向左拉被关掉（--tl-card-pull 生效值 ${layM.pull}）—— 不会把内容推出屏幕`);
    ok(layM.aligned === true, `手机端费用条目与藏品条目左边缘仍对齐（都是 ${layM.fee.cardLeft}）`);
    ok(layM.col.cardLeft >= 20 && layM.col.imgLeft === layM.col.cardLeft,
        `手机端卡片/图片左边缘仍在布局左边（${layM.col.imgLeft} ≥ 20px），没有被拉成负数`);
    ok(layM.overflow === false, '手机端没有横向溢出');
    ok(layM.afterDisplay === 'none' || layM.left.dir === 'row',
        `手机端竖线本就隐藏（::after display=${layM.afterDisplay}，左列 direction=${layM.left.dir}）—— 因此"间距"在手机端不适用`);
    ok(lay640.mq600 === false && lay640.overflow === false && lay640.gap === 8,
        `640px：仍是同排布局、间距 ${lay640.gap}px、无溢出`);
    ok(lay601.mq600 === false && lay601.overflow === false && lay601.col.cardLeft > lay601.dot.cx,
        `601px（断点边界）：卡片仍在竖线右侧（卡片左 ${lay601.col.cardLeft} > 竖线轴 ${lay601.dot.cx}），无溢出`);
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(400);

    // ⑫-11 ★「手机端 CSS 真的生效了吗」：layout.css 一旦多/少一个花括号，
    //   浏览器会把后面所有规则吞掉（手机端整块失效），而文件字面量照样"看起来没问题"。
    //   这里直接读**计算后的样式**（不是读文件文本），所以能真的抓到那种被吞掉的情形。
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: true });
    await sleep(1400);
    const cssReach = JSON.parse(await evaluate(`(()=>{
        const o = { vw: window.innerWidth };
        // ★ 只认**布局中真的占位**的那一条：前面去过「我的」页，隐藏容器里还留着旧副本，
        //   它们的 .timeline-left 计算宽是 auto、rect 宽是 0，会误判成"媒体查询没生效"。
        const it = [...document.querySelectorAll('.timeline-item')].find(e => e.offsetParent && e.getBoundingClientRect().width > 1);
        if (it) {
            const left = it.querySelector('.timeline-left');
            const cs = getComputedStyle(left);
            o.leftWidth = cs.width;
            o.leftDir = cs.flexDirection;
            o.afterDisplay = getComputedStyle(left, '::after').display;
            o.itemDir = getComputedStyle(it).flexDirection;
            o.leftColW = Math.round(left.getBoundingClientRect().width);
            o.cardTop = Math.round(it.querySelector('.timeline-card').getBoundingClientRect().top);
            o.dotBottom = Math.round(it.querySelector('.timeline-dot').getBoundingClientRect().bottom);
        }
        const fee = [...document.querySelectorAll('.timeline-card--fee')].find(e => e.offsetParent && e.getBoundingClientRect().width > 1);
        if (fee) o.feePadTop = getComputedStyle(fee).paddingTop;
        return JSON.stringify(o);
    })()`));
    ok(cssReach.vw === 375 && !!cssReach.leftWidth, `手机端 CSS 生效性检查（视口 ${cssReach.vw}px，找到布局中的时间轴条目）`);
    ok(cssReach.leftColW > cssReach.vw * 0.8 && cssReach.leftDir === 'row',
        `600px 那块媒体查询确实生效：.timeline-left 变成整行（宽 ${cssReach.leftColW} / 视口 ${cssReach.vw}，direction=${cssReach.leftDir}）`);
    ok(cssReach.afterDisplay === 'none',
        `手机端竖线按规则隐藏（::after display=${cssReach.afterDisplay}）—— 若 layout.css 括号失衡，这条会先红`);
    ok(cssReach.itemDir === 'column' && cssReach.cardTop >= cssReach.dotBottom - 40,
        `手机端条目改为上下排（item direction=${cssReach.itemDir}）`);
    ok(cssReach.feePadTop === '8px',
        `手机端费用卡片收紧后的内边距生效（padding-top=${cssReach.feePadTop}，桌面是 10px）`);
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(400);

    // ⑫-12 ★★ 「裸币」显示口径（用户裁定 2026-10）：
    //   录入价**含评级费** ⇒ 自己送评且非换壳的那一枚显示「购入价格：裸币{N}元」，
    //   N = 录入价 − 该枚评级费；换壳行与直接买来的现货一律**原样显示**（不加"裸币"）。
    //   同时「一共花了 X 元」= Σ 藏品 price（裸币价之和），不再额外加评级费。
    {
        // 服务端（Node）独立算出每一枚的裸币价，作为对账基准
        const numOf = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
        const feeOfCert = {};
        for (const b of G.batches) for (const it of (b.items || [])) {
            if (!it || !it.cert || feeOfCert[it.cert] !== undefined) continue;
            feeOfCert[it.cert] = it.reholder ? 0 : numOf(it.paidFee);
        }
        const expectedNaked = {};           // cert → 裸币价
        const expectedRaw = {};             // cert → 录入价
        let sumRaw = 0, sumNaked = 0, matchedNonRh = 0, matchedRh = 0;
        for (const cert of colCopyIds) {
            const raw = numOf(colIdx[cert].price);
            if (!(raw > 0)) continue;
            const f = feeOfCert[cert] || 0;
            const naked = raw - f;
            sumRaw += raw;
            sumNaked += naked;
            expectedRaw[cert] = raw;
            expectedNaked[cert] = naked;
            if (cert === shellCert) matchedRh++;
            else if (feeOfCert[cert] !== undefined) matchedNonRh++;
        }
        console.log(`      裸币口径基准：${matchedNonRh} 枚自送评非换壳（要减费）、${matchedRh} 枚换壳（原价）`);
        console.log(`      Σ 录入价 = ${R1(sumRaw)} 元 / Σ 裸币价 = ${R1(sumNaked)} 元（差 = 评级费 ${R1(sumRaw - sumNaked)}）`);
        // ★ 页面侧自校准：逼页面自己把"Σ 录入价 / Σ 裸币价"报出来。
        //   ★★ 注意 collectAllCopies() 返回的是**包装对象**（{copy, seriesName, type, dataKey}），
        //   价格在 c.copy.price 里 —— 写成 c.price 会得到"0 件有价"，把断言带偏。
        const pageBase = JSON.parse(await evaluate(`(()=>{
            const num = (v) => { const n = parseFloat(String(v==null?'':v).replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; };
            const fee = (window.DATA_MAP && DATA_MAP['gradingFeeData']) || null;
            const fIdx = {};
            if (fee && Array.isArray(fee.batches)) for (const b of fee.batches) for (const it of (b.items||[])) {
                if (!it || !it.cert || fIdx[it.cert] !== undefined) continue;
                fIdx[it.cert] = it.reholder ? 0 : num(it.paidFee);
            }
            let raw = 0, naked = 0, cnt = 0, withFee = 0;
            const all = (typeof collectAllCopies === 'function') ? collectAllCopies() : [];
            const byCert = {};
            for (const w of all) {
                const c = w.copy || w;
                const p = num(c.price); if (!(p > 0)) continue;
                cnt++; raw += p;
                const f = (c.copyId && fIdx[c.copyId] != null) ? fIdx[c.copyId] : 0;
                if (c.copyId && fIdx[c.copyId] > 0) withFee++;
                naked += (p - f);
                if (c.copyId) byCert[String(c.copyId)] = p;
            }
            return JSON.stringify({ cnt, raw: Math.round(raw*100)/100, naked: Math.round(naked*100)/100, withFee, all: all.length, byCert: byCert });
        })()`));
        console.log(`      页面 collectAllCopies()：${pageBase.cnt} 件有价 / 共 ${pageBase.all} 件 · Σ 录入价 ${pageBase.raw} · Σ 裸币价 ${pageBase.naked}（其中 ${pageBase.withFee} 件要减费）`);
        // ★ 以**页面口径**为准重建基准（Node 侧按 copyId 去重的扫描会漏掉没写 copyId 的藏品）
        for (const cert of Object.keys(pageBase.byCert)) {
            const raw = pageBase.byCert[cert];
            const f = feeOfCert[cert] || 0;
            expectedRaw[cert] = raw;
            expectedNaked[cert] = raw - f;
        }
        const pageSumNaked = pageBase.naked;
        // ★★ 用户原话举的例子：KP04057（cert 26626154）。
        //   ★ 实测它录入 **925元**、台账该枚 **18元**（不是用户记忆里的 880/45）
        //     ⇒ 正确显示是「裸币907元」。这里按**数据实际值**断言，并在日志里写明偏差，
        //     免得把"用户记错了数字"误判成代码 bug。
        //   ★ 认证码**现算**：优先用户点名的 26626154，它不在数据里（比如整批被删）就退化成
        //     "页面上第一枚带评级费的藏品" —— 不让一条内容型例子把整份用例钉死。
        const feeCands = Object.keys(feeOfCert).filter(c => (feeOfCert[c] || 0) > 0 && pageBase.byCert[c] > 0);
        if (feeCands.length === 0) skip('页面上没有任何"既有录入价又在台账里"的藏品 ⇒ 裸币价抽样在本数据集中无断言值');
        const KP_CERT = feeCands.includes('26626154') ? '26626154' : feeCands[0];
        const kpFee = feeOfCert[KP_CERT];
        const kpRaw = pageBase.byCert[KP_CERT];
        console.log(`      ★ 抽样藏品 cert=${KP_CERT}：录入 ${kpRaw}元 / 费 ${kpFee}元 ⇒ 裸币 ${R1(kpRaw - kpFee)}元（用户举例的 KP04057 记的是 880/45 ⇒ 835）`);
        ok(kpRaw > 0 && kpFee > 0,
            `抽样藏品（cert ${KP_CERT}）确实在台账里、且要减费（录入 ${kpRaw}元 / 费 ${kpFee}元）`);
        ok(R1(kpRaw - kpFee) === R1(expectedNaked[KP_CERT]),
            `★ cert ${KP_CERT} 的裸币价 = 录入 − 费（${kpRaw} − ${kpFee} = ${R1(kpRaw - kpFee)}）`);
        if (KP_CERT !== '26626154') {
            skip('台账里没有用户举例的 KP04057（cert 26626154）—— 多半是被数据编辑删掉了 ⇒ 该 DOM 断言无断言值');
        } else {
            const kpShown = await evaluate(`(()=>{
                for (const it of document.querySelectorAll('.timeline-item')) {
                    if (!it.offsetParent || it.dataset.type === 'fee') continue;
                    if (!/KP04057/.test(it.textContent)) continue;
                    const m = it.textContent.replace(/\\u00A0/g,' ').match(/购入价格：([^\\s]{0,24})/);
                    if (m) return m[1];
                }
                return null;
            })()`);
            ok(kpShown === '裸币' + R1(kpRaw - kpFee) + '元',
                `★ 页面上 KP04057 确实渲染成「购入价格：${kpShown}」（应为 裸币${R1(kpRaw - kpFee)}元）`);
        }
        // ★ 先钉一组"机制性"事实：抽样一枚，把 原价/费/裸币价 三个数报出来
        const sampleCert = feeCands.includes('26011874') ? '26011874' : feeCands[feeCands.length - 1];
        ok(expectedRaw[sampleCert] > 0 && feeOfCert[sampleCert] > 0,
            `样例 ${sampleCert}：录入 ${expectedRaw[sampleCert]}元 / 该枚评级费 ${feeOfCert[sampleCert]}元 ⇒ 裸币 ${R1(expectedNaked[sampleCert])}元`);
        ok(R1(expectedRaw[sampleCert] - feeOfCert[sampleCert]) === R1(expectedNaked[sampleCert]),
            `样例 ${sampleCert} 的裸币价 = 录入 − 费（${expectedRaw[sampleCert]} − ${feeOfCert[sampleCert]} = ${R1(expectedNaked[sampleCert])}）`);

        // 页面：抓时间轴里所有藏品条目的「购入价格」文本 + 它属于哪一枚（靠冠字号不稳，
        //   改用 title/内部数据？没有 data-copyid，于是按"该条目 HTML 里出现的冠字号"配对；
        //   更可靠的是直接读 DOM 顺序不必要 —— 这里只做两类抽样断言 + 全量总和断言。）
        const nakedProbe = JSON.parse(await evaluate(`(()=>{
            const out = { naked: [], raw: [], hasNaked: 0, total: 0, slogan: '' };
            const items = [...document.querySelectorAll('.timeline-item')].filter(e => e.offsetParent && e.dataset.type !== 'fee');
            let feeShown = 0;   // 5 条评级费条目上写的「评级收费：xx元」之和（也要加回总额）
            for (const it of document.querySelectorAll('.timeline-item[data-type="fee"]')) {
                if (!it.offsetParent) continue;
                for (const f of it.querySelectorAll('.timeline-fee-sub .fee-f')) {
                    const mm = f.textContent.match(/^评级收费：([0-9.]+)元$/);
                    if (mm) feeShown += +mm[1];
                }
            }
            for (const it of items) {
                const meta = it.querySelector('.timeline-meta') || it.querySelector('.timeline-card');
                const txt = (meta || it).textContent.replace(/\\u00A0/g, ' ').replace(/\\s+/g, ' ');
                const m = txt.match(/购入价格：(裸币)?([0-9.]+)元/);
                if (!m) continue;
                out.total++;
                if (m[1]) { out.hasNaked++; out.naked.push(+m[2]); } else out.raw.push(+m[2]);
                out[m[1] ? 'sampleNaked' : 'sampleRaw'] = (out[m[1] ? 'sampleNaked' : 'sampleRaw'] || []).concat(txt.slice(0, 90));
            }
            out.slogan = ((document.querySelector('.timeline-slogan') || {}).textContent || '').trim();
            out.feeShown = feeShown;
            return JSON.stringify(out);
        })()`));
        ok(nakedProbe.hasNaked === pageBase.withFee,
            `★ 页面上带「裸币」字样的藏品条目 = 自送评非换壳的枚数（页面 ${nakedProbe.hasNaked} vs 基准 ${pageBase.withFee}）`);
        const shownTotal = R1(nakedProbe.naked.reduce((s, v) => s + v, 0) + nakedProbe.raw.reduce((s, v) => s + v, 0) + nakedProbe.feeShown);
        ok(R1(nakedProbe.naked.reduce((s, v) => s + v, 0) + nakedProbe.raw.reduce((s, v) => s + v, 0)) === R1(pageSumNaked),
            `★ 页面上逐条藏品「购入价格」之和 = Σ 裸币价（${R1(nakedProbe.naked.reduce((s, v) => s + v, 0) + nakedProbe.raw.reduce((s, v) => s + v, 0))} vs ${R1(pageSumNaked)}）`);
        ok(nakedProbe.feeShown === KEPT_PAID,
            `★ 页面上 ${ENTRY_DATES.length} 条评级费条目写的「评级收费」之和 = ${KEPT_PAID}（实际 ${nakedProbe.feeShown}）`);
        ok(R1(shownTotal) === R1(pageBase.raw),
            `★★ 界面上**所有**金额相加（裸币价 + 评级收费）= 标语总额（${shownTotal} vs Σ 录入价 ${pageBase.raw}）`);
        // ★ 换壳行：显示原价、且**没有**"裸币"（现算挑出来的那一条）
        if (!shellCert) skip('台账里没有换壳行 ⇒ "换壳行显示原价、不折裸币" 在本数据集中无断言值');
        else {
            ok(nakedProbe.raw.indexOf(expectedRaw[shellCert]) >= 0,
                `★ 换壳行（cert=${shellCert}）显示的是原价 ${expectedRaw[shellCert]}元（在"不带裸币"的那批里）`);
            ok(!nakedProbe.naked.some(v => v === expectedNaked[shellCert]),
                `换壳行**没有**被折成裸币价（${R1(expectedNaked[shellCert])} 不在裸币那一批里）`);
        }
        // ★ 标语 = Σ 藏品 price（不再额外加评级费）
        const sloganNum = parseInt((nakedProbe.slogan.match(/一共花了\s*(\d+)\s*元/) || [])[1], 10);
        // ★★ 最终口径（用户裁定 2026-10）：**总花费 = Σ裸币价 + 评级费支出**，
        //   数学上恒等于 **Σ 藏品 price**（录入价 = 裸币价 + 该枚评级费）。
        //   上一版把评级费从总额里漏掉了（页面出现 44699），用户反馈"又少算了评级费"。
        //   ★ 先按**未取整**的原始和验恒等式，再看取整后的标语 —— 页面是 toFixed(0)，
        //     四舍五入的先后顺序会造成 ±0.5 的差，拿原始和验才严谨。
        ok(R1(pageSumNaked + KEPT_PAID) === R1(pageBase.raw),
            `★ Σ裸币价 ${pageSumNaked} + 评级费支出 ${KEPT_PAID} = Σ录入价 ${pageBase.raw}（未取整的原始和，恒等式成立）`);
        ok(R1(pageSumNaked) === R1(pageBase.raw - KEPT_PAID),
            `★ 自洽：Σ裸币价 ${pageSumNaked} == Σ录入价 ${pageBase.raw} − 评级费 ${KEPT_PAID}`);
        ok(sloganNum === Math.round(pageBase.raw),
            `★ 标语「一共花了 ${sloganNum} 元」= Σ 藏品 price（页面独立复算 ${pageBase.raw} ⇒ ${Math.round(pageBase.raw)}）`);
        ok(sloganNum !== Math.round(pageSumNaked),
            `★ 标语**不是**只算裸币价（那样会是 ${Math.round(pageSumNaked)}，就是用户看到的"又少算了评级费"）`);
    }

    ok(pageErrors.length === 0, `全程无未捕获异常（${pageErrors.length} 条${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' | ') : ''}）`);
} catch (e) {
    ok(false, '浏览器段异常：' + e.message);
} finally {
    try { ws.close(); } catch { }
    try { child.kill(); } catch { }
    server.close();
}

console.log('\n──────── 通过 ' + pass + ' / 失败 ' + fail + ' / 跳过 ' + skipped + ' ────────');
process.exit(fail === 0 ? 0 : 1);
