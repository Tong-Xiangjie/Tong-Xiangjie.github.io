// ==================== verify-grading-fee.mjs ====================
// 评级费台账（notecollection/data/grading_fee.js）的验证。分两段：
//
// 【静态段】数据本身 + 口径 + 加载/导航边界。快、不受时序影响，而且把页面里**真正在跑**
//   的那几个函数（special.js 里解析台账并转成时间轴条目）直接拿来跑一遍 —— 不是抄一份
//   期望值硬编码。用户裁定过的口径逐条钉住：
//     ① **匹配不到 copyId 的行 = 已售出 ⇒ 不计入支出、不进时间轴**（本文件最重要的一条）；
//     ② 支出取**折后价**（实际费用 = 原价 × 0.9），不是原价；
//     ③ 按【付款日期】计入（5 档日期逐一对齐），不是送评日期；
//     ④ 批次 4（PJ20260615262532）= 1615.5 元（汇总块字面"1,615元"是显示舍入）；
//     ⑤ 重复编码 26626187 只算第一次（批次 3 计 27元、批次 4 计 0元）；
//     ⑥ 换壳行 FJ772552（原价 15元 / 折后 13.5元）**照录入计**（它匹配得上 copyId，未售出）；
//     ⑦ 每批同时有"表格实收（留档）"与"未售出部分（支出）"两套合计，两者都断言；
//     ⑧ 台账只精简存 cert + 两个金额，展示文字**从藏品记录按 copyId 取**；
//     ⑨ 评级费不是藏品：藏品总数仍 396 件，均价/评级/年代统计/价格清单都不受影响；
//     ⑩ 台账分类**不进导航**，但数据照常加载、统计照常可用。
//
// 【浏览器段】把"评级费出现在币海拾年时间轴里、与同期藏品按日期混排"这件事在真实页面上验一遍
//   （静态段只能证明数据与函数对，证明不了它们真的被渲染出来）。
//
// 退出码：0 = 通过；1 = 有断言失败；2 = 找不到 Chrome（环境问题）。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label); }
}
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

// ★ 每批：pj / 送评 / 付款 / 未售出行数 / 未售出原价 / **支出** / 表格行数 / 表格原价 / 表格实收 / 已售出行数 / 已售出金额
//   注意"未售出原价"与"支出"不是同一个数：原价是折前的口径（279 元支出对应 310 元原价），
//   表格原价是含已售出行的（330 元）。
const EXPECT = [
    ['PJ20251125235158', '2025-11-25', '2025-12-17', 11, '310元', '279元', 12, '330元', '297元', 1, '18元'],
    ['PJ20260125243493', '2026-01-25', '2026-01-29', 14, '470元', '423元', 15, '550元', '495元', 1, '72元'],
    ['PJ20260310253570', '2026-03-10', '2026-04-01', 33, '1010元', '909元', 34, '1040元', '936元', 1, '27元'],
    ['PJ20260615262532', '2026-06-15', '2026-07-01', 35, '1795元', '1615.5元', 35, '1795元', '1615.5元', 0, '0元'],
    ['PJ20260906266166', '2026-09-06', '2026-10-01', 26, '900元', '810元', 27, '950元', '855元', 1, '45元'],
];
// ★ 4 个已售出（匹配不到 copyId）的编码 —— 用户裁定：判据就是"匹配不到 copyId"
const SOLD_CERTS = ['26011872', '26288328', '26626174', '27104088'];
const KEPT_ROWS = EXPECT.reduce((s, e) => s + e[3], 0);           // 119
const KEPT_PAID = R1(EXPECT.reduce((s, e) => s + NUM(e[5]), 0)); // 4036.5
const SHEET_ROWS = EXPECT.reduce((s, e) => s + e[6], 0);          // 123
const SHEET_PAID = R1(EXPECT.reduce((s, e) => s + NUM(e[8]), 0)); // 4198.5
const SOLD_ROWS = EXPECT.reduce((s, e) => s + e[9], 0);           // 4
const SOLD_PAID = R1(EXPECT.reduce((s, e) => s + NUM(e[10]), 0)); // 162
const KEPT_ITEMS = G.batches.flatMap(b => b.items || []);
const WANT_DATES = EXPECT.map(e => e[2]);

ok(G.batches.length === 5, `一共 5 个批次（实际 ${G.batches.length}）`);
ok(KEPT_ITEMS.length === KEPT_ROWS, `items 里共 ${KEPT_ROWS} 行明细（已剔除 ${SOLD_ROWS} 行已售出；实际 ${KEPT_ITEMS.length}）`);
ok(G.totals.itemCount === KEPT_ROWS, `totals.itemCount = ${KEPT_ROWS}（支出侧行数；实际 ${G.totals.itemCount}）`);
ok(G.totals.paidFee === KEPT_PAID + '元', `totals.paidFee = "${KEPT_PAID}元"（支出合计；实际 "${G.totals.paidFee}"）`);
ok(G.totals.sheetPaidFee === SHEET_PAID + '元', `totals.sheetPaidFee = "${SHEET_PAID}元"（表格实收留档；实际 "${G.totals.sheetPaidFee}"）`);
ok(G.totals.sheetItemCount === SHEET_ROWS, `totals.sheetItemCount = ${SHEET_ROWS}（表格留档行数；实际 ${G.totals.sheetItemCount}）`);
ok(G.totals.soldCount === SOLD_ROWS && G.totals.soldPaidFee === SOLD_PAID + '元',
    `totals 记着已售出 ${SOLD_ROWS} 行 / ${SOLD_PAID}元（实际 ${G.totals.soldCount} 行 / ${G.totals.soldPaidFee}）`);
ok(R1(NUM(G.totals.paidFee) + NUM(G.totals.soldPaidFee)) === NUM(G.totals.sheetPaidFee),
    `支出 ${G.totals.paidFee} + 已售出 ${G.totals.soldPaidFee} = 留档实收 ${G.totals.sheetPaidFee}`);
ok(KEPT_PAID !== SHEET_PAID, `支出合计 ${KEPT_PAID}元 与留档实收 ${SHEET_PAID}元 **不是**同一个数（差额 ${R1(SHEET_PAID - KEPT_PAID)}元）`);

// ★ 精简后的字段清单：明细**只**留 cert + listFee + paidFee（+ 换壳标记），
//   名称/冠号/分数/EPQ/版别/尺寸/数量一律不存 —— 展示时按 cert 去藏品记录取。
const itemFields = [...new Set(KEPT_ITEMS.flatMap(i => Object.keys(i)))].sort();
ok((() => {
    const want = ['cert', 'listFee', 'paidFee', 'reholder'];
    return itemFields.length === want.length && want.every(f => itemFields.includes(f));
})(), `明细字段就这 4 个（cert / listFee / paidFee / reholder；实际 ${itemFields.join(', ')}）`);
for (const gone of ['name', 'version', 'condition', 'epq', 'variety', 'qty', 'seq', 'size', 'dimension', 'krause', 'batch']) {
    ok(!KEPT_ITEMS.some(i => gone in i), `明细里没有冗余字段 ${gone}（不再抄表格的全字段）`);
}
ok(KEPT_ITEMS.every(i => typeof i.cert === 'string' && /^\d+$/.test(i.cert)), '每行的 cert 都是纯数字字符串（= 藏品 copyId）');
ok(KEPT_ITEMS.every(i => typeof i.listFee === 'string' && /元$/.test(i.listFee) && typeof i.paidFee === 'string' && /元$/.test(i.paidFee)),
    'listFee / paidFee 都是带"元"的人类可读字符串（与藏品 price: "18元" 风格一致）');

// 4 个已售出的编码：从 items 里彻底移除，但**注释里留档**可追溯（用户要求）
ok(!SOLD_CERTS.some(c => KEPT_ITEMS.some(i => i.cert === c)),
    `4 个已售出编码都不在 items 里（${SOLD_CERTS.join(', ')}）`);
ok(SOLD_CERTS.every(c => dataSrc.includes(c)), '4 个已售出编码仍在文件注释里留档（可追溯，不是悄悄删掉）');
ok(/已售出/.test(dataSrc) && /匹配不到|找不到匹配/.test(dataSrc), '文件注释写明了"匹配不到 copyId = 已售出"这条判据');
ok(/付款日期/.test(dataSrc), '文件注释写明了按付款日期计入支出');
ok(/复用藏品数据|去藏品记录取/.test(dataSrc), '文件注释写明了展示文字复用藏品数据（不抄第二份）');

// ══════════════════════════════════════════════════════════════
section('② 支出取折后价，且折后 = 原价 × 0.9');
// ══════════════════════════════════════════════════════════════
const badDisc = [];
for (const b of G.batches) for (const i of (b.items || [])) {
    if (Math.abs(NUM(i.paidFee) - R1(NUM(i.listFee) * 0.9)) > 1e-9) badDisc.push(`${b.pj}/${i.cert} ${i.listFee}→${i.paidFee}`);
}
ok(badDisc.length === 0, `留下的 ${KEPT_ROWS} 行逐行满足 paidFee = listFee × 0.9（异常：${badDisc.join(', ') || '无'}）`);

const mismatch = [];
for (const e of EXPECT) {
    const b = G.batches.find(x => x.pj === e[0]);
    const mine = (b && b.items) || [];
    const sl = R1(mine.reduce((s, i) => s + NUM(i.listFee), 0));
    const sp = R1(mine.reduce((s, i) => s + NUM(i.paidFee), 0));
    if (!b || mine.length !== e[3] || sl !== NUM(e[4]) || sp !== NUM(e[5])) {        mismatch.push(`${e[0]}: 行${mine.length}/${sl}/${sp} vs 期望 ${e[3]}/${e[4]}/${e[5]}`);
    }
}
ok(mismatch.length === 0, `每批"匹配上的明细之和 = 该批支出"（原价与折后都核过；异常：${mismatch.join(' | ') || '无'}）`);
ok(R1(G.batches.reduce((s, b) => s + NUM(b.paidFee), 0)) === KEPT_PAID, `逐批支出之和 = ${KEPT_PAID}元（= 新总计）`);
ok(R1(G.batches.reduce((s, b) => s + NUM(b.sheetPaidFee), 0)) === SHEET_PAID, `逐批留档实收之和 = ${SHEET_PAID}元（= 表格上的实收，未受影响）`);
ok(G.batches.every(b => R1(NUM(b.sheetPaidFee) - NUM(b.paidFee)) === NUM(b.soldPaidFee)),
    '每批：留档实收 - 支出 = 该批已售出金额（两个合计自洽）');

// ══════════════════════════════════════════════════════════════
section('③ 按【付款日期】计入，不是送评日期');
// ══════════════════════════════════════════════════════════════
for (const e of EXPECT) {
    const b = G.batches.find(x => x.pj === e[0]);
    ok(!!b && b.sentDate === e[1] && b.paidDate === e[2]
        && b.itemCount === e[3] && NUM(b.listFee) === NUM(e[4]) && NUM(b.paidFee) === NUM(e[5])
        && b.sheetItemCount === e[6] && NUM(b.sheetListFee) === NUM(e[7]) && NUM(b.sheetPaidFee) === NUM(e[8])
        && b.soldCount === e[9] && NUM(b.soldPaidFee) === NUM(e[10]),
        `批次 ${e[0]}：送评 ${b && b.sentDate} / 付款 ${b && b.paidDate} · 支出 ${e[5]}（留档 ${e[8]}，已售出 ${e[9]} 行 ${e[10]}）`);
}
ok(G.batches.every(b => b.paidDate && b.paidDate !== b.sentDate), '每批的付款日期都不等于送评日期');
ok(G.batches.every(b => /^\d{4}-\d{2}-\d{2}$/.test(b.paidDate)), '付款日期都是 ISO 写法');
ok(new Set(G.batches.map(b => b.paidDate)).size === 5, '5 个付款日期互不相同（按付款日期计入时不会被合并）');
ok(G.batches.slice().sort((a, b) => a.paidDate.localeCompare(b.paidDate)).map(b => b.paidDate).join(',') === WANT_DATES.join(','),
    `5 个付款日期按升序 = ${WANT_DATES.join(' → ')}`);

// ══════════════════════════════════════════════════════════════
section('④ 批次 4 = 1615.5（不是字面的 1,615）');
// ══════════════════════════════════════════════════════════════
const B4 = 'PJ20260615262532';
const b4 = G.batches.find(x => x.pj === B4);
ok(!!b4, `批次 4（${B4}）存在`);
ok(b4 && NUM(b4.paidFee) === 1615.5, `批次 4 支出 = 1615.5元（实际 ${b4 && b4.paidFee}）`);
ok(b4 && NUM(b4.sheetPaidFee) === 1615.5, '批次 4 留档实收 = 1615.5元（该批无已售出行，两者相同）');
ok(b4 && b4.soldCount === 0 && NUM(b4.soldPaidFee) === 0, '批次 4 没有已售出行（所以 35 行全在 items 里）');
ok(b4 && NUM(b4.listFee) === 1795 && R1(NUM(b4.listFee) * 0.9) === 1615.5, '批次 4 原价 1795 → 折后 1615.5（9 折）');
ok(b4 && (b4.items || []).length === 35, `批次 4 明细 35 行（实际 ${b4 && (b4.items || []).length}）`);

// ══════════════════════════════════════════════════════════════
section('⑤ 重复编码 26626187 只算第一次');
// ══════════════════════════════════════════════════════════════
const dup = KEPT_ITEMS.filter(i => i.cert === '26626187');
ok(dup.length === 2, `26626187 在 items 里出现 2 次（批次 3 与批次 4；实际 ${dup.length}）`);
{
    const b3 = G.batches.find(x => x.pj === 'PJ20260310253570');
    const r3 = (b3.items || []).find(i => i.cert === '26626187');
    const r4 = ((b4 && b4.items) || []).find(i => i.cert === '26626187');
    ok(!!r3 && NUM(r3.paidFee) === 27 && NUM(r3.listFee) === 30, `批次 3 那一行计 30/27 元（实际 ${r3 && r3.listFee}/${r3 && r3.paidFee}）`);
    ok(!!r4 && NUM(r4.paidFee) === 0 && NUM(r4.listFee) === 0, `批次 4 那一行计 0/0 元（只算第一次；实际 ${r4 && r4.listFee}/${r4 && r4.paidFee}）`);
}
ok(R1(dup.reduce((s, i) => s + NUM(i.paidFee), 0)) === 27, '26626187 这一枚在总支出里只贡献 27元（没有被算两次）');
ok(KEPT_PAID !== 4009.5, `总支出 ${KEPT_PAID}元 —— 若把这枚重复计一次会变成 4009.5，说明"只算一次"生效`);

// ══════════════════════════════════════════════════════════════
section('⑥ 换壳行 FJ772552（15 → 13.5）照录入计');
// ══════════════════════════════════════════════════════════════
// ★ 该行（批次 4 的 cert 19006336）**匹配得上 copyId ⇒ 未售出 ⇒ 计入**。
//   （如果哪天它被卖掉、从藏品里移除了，那它会匹配不上而被剔除 —— 下一条断言盯着这个。）
const shellCert = '19006336';
const shell = KEPT_ITEMS.find(i => i.cert === shellCert);
ok(!!shell, `换壳行（cert=${shellCert}）仍在 items 里（匹配得上 copyId ⇒ 未售出 ⇒ 计入）`);
ok(shell && shell.reholder === true, '换壳行带 reholder: true 标记');
ok(shell && shell.listFee === '15元' && shell.paidFee === '13.5元', `原价 15元 / 折后 13.5元（实际 ${shell && shell.listFee} / ${shell && shell.paidFee}）`);
ok(shell && NUM(shell.listFee) === 15 && NUM(shell.paidFee) === 13.5, '半价换壳的原价 15 = 常规 30 的一半，折后 13.5 = 15 × 0.9');
ok(KEPT_ITEMS.filter(i => i.reholder === true).length === 1, '全台账只有这一行带换壳标记（不会误标）');
ok(SOLD_CERTS.indexOf(shellCert) < 0, '换壳行不在已售出名单里（判据是"匹配不到 copyId"，它匹配得上）');
ok(b4 && Math.abs(R1((b4.items || []).reduce((s, i) => s + NUM(i.paidFee), 0)) - 1615.5) < 1e-9,
    '换壳行 13.5 已含在批次 4 的 1615.5元支出里');

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
                if (c && c.copyId && !idx[c.copyId]) idx[c.copyId] = { name: pair[1], version: c.version || '', condition: c.condition || c.grade || '' };
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
// ⑦-2 那 4 个编码确实匹配不上真实藏品（证明"已售出"不是拍脑袋：数据里真没它们）
const reallySold = SOLD_CERTS.filter(c => !colIdx[c]);
ok(reallySold.length === 4, `4 个已售出编码在真实藏品里确实都找不到（${reallySold.join(', ')}）——判据站得住`);
// ⑦-3 反面：随便挑一个**在册**的编码，它不会落在已售出名单里（判据不会乱杀）
ok(colCopyIds.filter(c => SOLD_CERTS.includes(c)).length === 0, '已售出名单里的编码一个都不在藏品的 396 件里');
ok(!!colIdx[shellCert], `换壳行 ${shellCert} 在藏品里存在（所以未售出、计入）`);
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
const FEE_FNS = ['timelinePriceOf', 'feeAmountOf', 'formatTimelineDate', 'gradingCopyIndex', 'gradingFeeEntries', 'gradingFeeTotal'];
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
ok(entries.length === 5, `gradingFeeEntries() 产出 5 条时间轴条目（实际 ${entries.length}）`);

const entryByPj = new Map(entries.map(e => [e.copy.condition, e]));
for (const e of EXPECT) {
    const en = entryByPj.get(e[0]);
    if (!en) { ok(false, `时间轴条目里有批次 ${e[0]}`); continue; }
    ok(en.dateStr === cnDate(e[2]) && en.itemCount === e[3] && NUM(en.copy.price) === NUM(e[5]) && en.copy.version === e[0],
        `条目 ${e[0]}：落位 ${en.dateStr}（付款日 ${e[2]}，送评是 ${e[1]}）· ${e[3]} 件 · ${en.copy.price}（支出，不是留档 ${e[8]}）`);
}
ok(entries.every(e => e.type === 'fee'), '5 条都打了 type="fee" 标记（渲染时走台账分支，不会被当成藏品）');
ok(R1(entries.reduce((s, e) => s + NUM(e.copy.price), 0)) === KEPT_PAID,
    `5 条金额之和 = ${KEPT_PAID}（${entries.map(e => NUM(e.copy.price)).join(' + ')}）`);
ok(entries.every(e => cnDate(e.copy.purchaseDate) === e.dateStr),
    '条目自带的 purchaseDate（ISO，来自台账）与分组日期（中文写法）指同一天（混排/分组都靠它）');
ok(entries.every(e => !e.copy.img1 && !e.copy.img2), '台账条目没有图片字段（渲染时根本不生成图片位）');
ok(entries.map(e => e.dateStr).join(',') === WANT_DATES.map(cnDate).join(','), `条目按付款日期升序：${entries.map(e => e.dateStr).join(' → ')}`);

// ⑧-1b ★ 公司名 / 清单地址都只是**数据字段的搬运工**（条目上能直接读到，渲染端不另起名字）
ok(entries.every((e, i) => e.grader === G.batches[i].grader),
    `条目上的 grader 就是数据里的 grader（${entries.map(e => e.grader).join(' / ')}）`);
ok(entries.every((e, i) => e.listUrl === G.batches[i].listUrl),
    '条目上的 listUrl 就是数据里的 listUrl（渲染端不拼也不猜）');
{
    // ★ 把数据里的公司名换成 PMG、并且**去掉** listUrl ⇒ 条目必须跟着变（没有写死、也没默认成别家）
    //   注意：一定还要给一份**真实的 copyId 索引**，否则按"匹配不到=已售出"的口径一个条目都不会出。
    const swapped = JSON.parse(JSON.stringify(G));
    swapped.batches = [swapped.batches[4]];
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
    ok(!!e0 && NUM(e0.copy.price) === 810, `改公司名/删链接都不影响金额口径（实际 ${e0 && e0.copy.price}）`);
}
{
    // grader 缺失 ⇒ 空串（渲染端据此回退成中性的「评级费」，不会变成某家公司）
    const noGrader = JSON.parse(JSON.stringify(G));
    noGrader.batches = [noGrader.batches[0]];
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
    ok(!!e0 && NUM(e0.copy.price) === 279, `grader 缺失也不影响金额（实际 ${e0 && e0.copy.price}）`);
}

// ⑧-2 「复用藏品数据」这条路：台账里**没存任何名称**，展示所需的一切都按 cert 去藏品记录取
{
    const fakeSeries = [{ seriesName: 'S1', varieties: [{ varietyName: 'V1', copies: [
        { copyId: KEPT_ITEMS[0].cert, version: 'AAAA', price: '7元' }
    ] }] }];
    const one = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({ gradingFeeData: { ...G, batches: [G.batches[0]] }, fake: { series: fakeSeries } }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__idx = JSON.stringify(gradingCopyIndex());',
        'window.__e = JSON.stringify(gradingFeeEntries());'
    ]);
    const idx = JSON.parse(one.__idx);
    const rec = idx[KEPT_ITEMS[0].cert];
    ok(!!rec && rec.seriesName.indexOf('S1') >= 0 && rec.seriesName.indexOf('V1') >= 0,
        `gradingCopyIndex() 按 cert 解析出了藏品记录（seriesName="${rec && rec.seriesName}"）—— 台账里并没有这个名字`);
    ok(!!rec && rec.copy.version === 'AAAA', '解析出来的那份记录还能取到藏品的冠字号码（AAAA）—— 复用藏品数据这条路是通的');
    ok(!!rec && rec.copy.price === '7元', '价格也来自藏品侧（7元），台账只贡献 listFee/paidFee 两个费用字段');
    const e1 = JSON.parse(one.__e)[0];
    // ★ 这份 fixture 只喂了 1 个藏品（第一个 cert），所以"未售出部分"就只有那一行 = 18元。
    //   这恰好也是"支出按留下的行重算"的又一次旁证。
    ok(!!e1 && e1.type === 'fee' && e1.itemCount === 1 && NUM(e1.copy.price) === 18,
        `条目按"未售出部分"口径（这份 fixture 只有 1 行匹配上 ⇒ 1 行 / 18元；实际 ${e1 && e1.itemCount} 行 / ${e1 && e1.copy.price}）`);
    ok(!!e1 && e1.sentDate === EXPECT[0][1] && e1.paidDate === EXPECT[0][2] && e1.dateStr === cnDate(EXPECT[0][2]),
        `条目同时带着送评日期（${e1 && e1.sentDate}）与付款日期（${e1 && e1.paidDate} → ${e1 && e1.dateStr}），两者不同天`);
}
// ⑧-2b 台账明细里没有名称/冠号/分数可供渲染 —— 必须靠藏品记录
ok(KEPT_ITEMS.every(i => !('name' in i) && !('version' in i) && !('condition' in i)),
    '台账明细里没有 name/version/condition（渲染所需信息全部按 cert 去藏品记录取）');

// ⑧-3 ★ 注入式 fixture：验证"匹配不到 copyId 的行不计入支出 / 不进时间轴"这条**逻辑**。
//   数据里那 4 行已经被剔除了，所以只能靠注入一份"只匹配得上一部分"的台账来验逻辑。
//   fixture ①：批次 4 的 35 行里只有 1 行的 cert 能在藏品里找到 ⇒ 该批支出塌成 13.5，条目仍在；
//   fixture ②：批次 5 的 26 行一个都匹配不上 ⇒ 该批支出为 0，**整批不出现在时间轴上**。
{
    const onlyShell = { ...G, batches: [G.batches[3]], totals: G.totals };
    const f1 = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({
            gradingFeeData: onlyShell,
            fake: { series: [{ seriesName: 'S', varieties: [{ varietyName: 'V', copies: [{ copyId: shellCert, version: 'FJ772552' }] }] }] }
        }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries()); window.__t = gradingFeeTotal();'
    ]);
    const e1 = JSON.parse(f1.__e);
    ok(e1.length === 1 && NUM(e1[0].copy.price) === 13.5,
        `fixture①：只匹配得上 1 行时，该批条目金额塌成 13.5（只算匹配上的那行；实际 ${e1[0] && e1[0].copy.price}）`);
    ok(Math.abs(f1.__t - 13.5) < 1e-9, `fixture①：gradingFeeTotal() = 13.5（实际 ${f1.__t}）`);
    ok(e1[0].itemCount === 1, `fixture①：件数也跟着变成 1（实际 ${e1[0].itemCount}）`);
}
{
    const onlyB5 = { ...G, batches: [G.batches[4]], totals: G.totals };
    const f2 = makeFeeCtx([
        'window.DATA_MAP = ' + JSON.stringify({ gradingFeeData: onlyB5 }) + ';',
        'window.getCategoryPath = function(){ return ""; };',
        'window.__e = JSON.stringify(gradingFeeEntries()); window.__t = gradingFeeTotal();'
    ]);
    ok(JSON.parse(f2.__e).length === 0 && f2.__t === 0,
        'fixture②：整批都匹配不上 copyId（支出 0）⇒ 该批**不出现在时间轴上**，gradingFeeTotal() = 0');
}
// ⑧-4 那 4 个已售出的编码永远不该出现在时间轴条目里
ok(!SOLD_CERTS.some(c => JSON.stringify(entries).includes(c)), '4 个已售出编码没有出现在任何时间轴条目里');
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
const GRADERS = G.batches.map(b => b.grader);
ok(GRADERS.every(x => typeof x === 'string' && x.trim() !== ''),
    `每个批次都带 grader 评级公司（实际 ${JSON.stringify(GRADERS)}）`);
ok(GRADERS.every(x => x === GRADERS[0]), `当前 5 批是同一家公司（${GRADERS[0]}）—— 但渲染只认这个字段，不认公司名本身`);
ok(!/爱藏/.test(readFileSync(join(COL, 'special.js'), 'utf8')),
    '★ 渲染文件（special.js）里**没有**「爱藏」二字 —— 公司名完全由数据驱动，没有写死');

// ⑨-3 ★ listUrl 指向的清单文件确实存在（相对路径从 collection/ 页面出发 ⇒ 相对仓库根就是去掉开头的 ../）
const LIST_FILES = G.batches.map(b => ({
    pj: b.pj,
    url: b.listUrl,
    // 页面在 collection/ 下，href="../notecollection/..." 解析后落在仓库根
    disk: b.listUrl ? b.listUrl.replace(/^\.\.\//, '') : null
}));
ok(LIST_FILES.every(f => typeof f.url === 'string' && f.url.trim() !== ''),
    `每个批次都带 listUrl（实际 ${LIST_FILES.map(f => f.url).join(' | ')}）`);
ok(LIST_FILES.every(f => f.url.startsWith('../notecollection/readmes/image/grading_fee/')),
    'listUrl 是从 collection/ 出发的相对路径（../notecollection/readmes/image/grading_fee/…）');
ok(LIST_FILES.every(f => f.url.endsWith(f.pj + '.xlsx')),
    'listUrl 的文件名就是该批次的 PJ 编号 .xlsx');
ok(LIST_FILES.every(f => existsSync(f.disk)),
    `5 个清单文件在磁盘上都存在（${LIST_FILES.filter(f => !existsSync(f.disk)).map(f => f.disk).join(', ') || '缺失 0 个'}）`);

// ★ 那 5 个 xlsx 是用户自己处理好的最终版本，本用例**只读**它们：
//   校验存在性 + 逐字节指纹（证明没有被任何脚本改写），再解析内容与台账对账。
const XLSX_SHA = {
    PJ20251125235158: '8ba5bc26947b35c097c5e6d2e3370a01c5b40bae0b9f3a74dc2697778673e606',
    PJ20260125243493: 'acbf2c18deec790605ec249a28a2879aef7592b79eab191d38854a3d955adfff',
    PJ20260310253570: '17518b32aae336b63158a200294783e080c7635929d1df8da854b7dd625980bd',
    PJ20260615262532: '03b5e0901f17f0bf4f99380e7f55fb2e442d66c640e1dbefd0840fb05d581073',
    PJ20260906266166: 'f032a3f0fcc31cd95043323cdcd012f115e13aaa0f5b5cdd5b7c2adccc1eeb09'
};
for (const f of LIST_FILES) {
    const sha = createHash('sha256').update(readFileSync(f.disk)).digest('hex');
    ok(sha === XLSX_SHA[f.pj], `${f.pj}.xlsx 逐字节未改动（sha256 ${sha.slice(0, 16)}…）`);
}

// ── xlsx 只读解析（零依赖：手写 zip + zlib inflate）—— 用于与台账对账 ──
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
            const vm = (cm[2] || '').match(/<v>([\s\S]*?)<\/v>/);
            const v = vm ? xmlUnesc(vm[1]) : '';
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
    const num = (v) => Number(String(v ?? '').replace(/[,\s]/g, ''));
    return {
        detailRows: details.length,
        feeTotal: num(total[cPaid]),
        listTotal: num(total[cList]),
        listPerRow: R1(details.reduce((s, c) => s + (Number(c[cList]) || 0), 0)),
        paidPerRow: R1(details.reduce((s, c) => s + (Number(c[cPaid]) || 0), 0))
    };
}
// 每个 xlsx 的明细行数 / 实收合计（用户给的期望值）
const SHEET_EXPECT = {
    PJ20251125235158: { rows: 12, paid: 297 },
    PJ20260125243493: { rows: 15, paid: 495 },
    PJ20260310253570: { rows: 34, paid: 936 },
    PJ20260615262532: { rows: 35, paid: 1615.5 },
    PJ20260906266166: { rows: 27, paid: 855 }
};
for (const f of LIST_FILES) {
    const b = G.batches.find(x => x.pj === f.pj);
    const s = parseFeeSheet(f.disk);
    const want = SHEET_EXPECT[f.pj];
    ok(s.detailRows === want.rows,
        `${f.pj} 明细 ${s.detailRows} 行（期望 ${want.rows}）`);
    ok(s.feeTotal === want.paid,
        `${f.pj} 清单「实际费用」合计 ${s.feeTotal}（期望 ${want.paid}）`);
    // 逐行求和也要等于合计（合计行不是手改的数，是明细加出来的）
    ok(s.paidPerRow === s.feeTotal, `${f.pj} 逐行实收之和 ${s.paidPerRow} = 合计行 ${s.feeTotal}`);
    // 与台账对账：清单的实收合计 == 台账的 sheetPaidFee（留档口径）
    ok(NUM(b.sheetPaidFee) === s.feeTotal,
        `${f.pj} 清单实收 ${s.feeTotal} = 台账留档 sheetPaidFee ${b.sheetPaidFee}`);
    // 原价合计 - 折扣 = 实收（数据文件里记的"代理折扣9折"）
    ok(R1(s.listTotal * 0.9) === R1(s.feeTotal),
        `${f.pj} 原价合计 ${s.listTotal} × 0.9 = ${R1(s.listTotal * 0.9)} = 实收 ${s.feeTotal}`);
}
ok(R1(Object.values(SHEET_EXPECT).reduce((s, v) => s + v.paid, 0)) === SHEET_PAID,
    `5 份清单实收合计 = ${SHEET_PAID}（与台账留档总合计一致）`);
ok(Object.values(SHEET_EXPECT).reduce((s, v) => s + v.rows, 0) === SHEET_ROWS,
    `5 份清单明细行数合计 = ${SHEET_ROWS} 行（与台账留档行数一致）`);

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
ok(nav.all.indexOf('gradingFeeData') === nav.all.length - 1, '它仍是最后一个 dataKey（顺序没变）');
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
    console.log('\n──────── 通过 ' + pass + ' / 失败 ' + fail + '（浏览器段未跑） ────────');
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

const WANT_AMTS = EXPECT.map(e => NUM(e[5]));   // [279, 423, 909, 1615.5, 810]
const WANT_COUNTS = EXPECT.map(e => e[3]);      // [11, 14, 33, 35, 26]

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
    ok(await evaluate(`typeof DATA_MAP!=='undefined' && !!DATA_MAP['gradingFeeData'] && DATA_MAP['gradingFeeData'].batches.length===5`),
        '真实页面：window.DATA_MAP["gradingFeeData"] 仍然加载成功（5 个批次）');
    const pageTotal = await evaluate(`typeof gradingFeeTotal==='function' ? gradingFeeTotal() : -1`);
    ok(Math.abs(pageTotal - KEPT_PAID) < 1e-9, `真实页面：gradingFeeTotal() = ${KEPT_PAID}（支出；实际 ${pageTotal}）`);
    ok(await evaluate(`typeof getCategoryTree==='function' && !getCategoryTree().some(c=>c.id==='grading_fee')`),
        '真实页面：getCategoryTree() 里没有 grading_fee');

    // ⑫-2 藏品口径没被污染
    const copyCount = await evaluate(`typeof collectAllCopies==='function' ? collectAllCopies().length : -1`);
    ok(copyCount === 396, `藏品总数仍是 396 件（实际 ${copyCount}）`);

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
            const a = card.querySelector('a');
            // ★ 第二行用**字段**量：各字段是独立 <span class="fee-f">，分隔符由 CSS ::before 画，
            //   所以这里显式按字段取，不依赖分隔符是否进了 innerText。
            const fields = [...card.querySelectorAll('.timeline-fee-sub .fee-f')].map(e => e.textContent.trim());
            out.push({
                date: d.replace(/\\u00A0/g,' ').trim(),
                tag: ((card.querySelector('.timeline-fee-tag')||{}).textContent||'').trim(),
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
                linkColor: a ? getComputedStyle(a).color : null
            });
        }
        return out;
    })()`);
    ok(Array.isArray(feeRows) && feeRows.length === 5, `时间轴里正好 5 条评级费条目（实际 ${Array.isArray(feeRows) ? feeRows.length : feeRows}）`);

    const feeDates = (feeRows || []).map(r => r.date);
    const wantDateLabels = WANT_DATES.map(cnDate);
    ok(JSON.stringify(feeDates) === JSON.stringify(wantDateLabels),
        `5 条的日期就是 5 个**付款日期**、且顺序一致：${feeDates.join(' / ')}`);

    // ⑫-4a ★ 第一行 = 标签 + 评级公司（公司名来自数据字段）
    ok((feeRows || []).every(r => r.tag === '评级费'), `每条左侧都有小标签「评级费」（实际 ${JSON.stringify((feeRows || []).map(r => r.tag))}）`);
    ok((feeRows || []).every(r => r.title === '评级公司：' + GRADERS[0]),
        `★ 第一行是「评级公司：${GRADERS[0]}」，公司名来自数据字段（实际 ${JSON.stringify((feeRows || []).map(r => r.title))}）`);
    ok((feeRows || []).every(r => r.itemClass.includes('timeline-item--fee') || r.cardClass.includes('timeline-card--fee')),
        '费用条目带专属 class（timeline-item--fee / timeline-card--fee），与藏品条目可区分');

    // ⑫-4b ★ 完全不占图片位：没有「暂无图片」、没有任何 <img>、没有图片容器/占位节点
    ok((feeRows || []).every(r => r.noImgTxt === false), '费用条目里**没有**「暂无图片」字样');
    ok((feeRows || []).every(r => r.imgs === 0), `费用条目里**一个 <img> 都没有**（实际 ${JSON.stringify((feeRows || []).map(r => r.imgs))}）`);
    ok((feeRows || []).every(r => r.imagesBox === 0), '费用条目里没有 .timeline-images 图片容器（整行根本不生成图片列）');
    ok((feeRows || []).every(r => r.noImgBox === 0), '费用条目里没有 .timeline-no-img 占位节点');
    ok((feeRows || []).every(r => !/<img|timeline-no-img|timeline-images/.test(r.html)),
        '整段 HTML 里不含 <img>／.timeline-no-img／.timeline-images');

    // ⑫-4c ★ 第二行：字段与顺序 = 送评日期 / 单号 / 评级收费 / 查看清单
    ok((feeRows || []).every(r => r.feeFieldCount === 4),
        `第二行正好 4 个字段（实际 ${JSON.stringify((feeRows || []).map(r => r.feeFieldCount))}）`);
    ok((feeRows || []).every((r, i) => r.fields[0] === '送评日期：' + cnDate(EXPECT[i][1])),
        `第 1 个字段 = 「送评日期：…」（是送评日期，不是付款日期；实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[0])}）`);
    ok((feeRows || []).every(r => !WANT_DATES.some(d => r.fields[0].includes(cnDate(d)))),
        '第 1 个字段里**没有**付款日期（付款日期只出现在日期分组头）');
    ok((feeRows || []).every((r, i) => r.fields[1] === '单号：' + EXPECT[i][0]),
        `第 2 个字段 = 「单号：PJ…」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[1])}）`);
    ok((feeRows || []).every(r => /^评级收费：[\d.]+元$/.test(r.fields[2])),
        `第 3 个字段 = 「评级收费：xx元」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[2])}）`);
    ok((feeRows || []).every(r => r.fields[3] === '查看清单'),
        `第 4 个字段 = 「查看清单」（实际 ${JSON.stringify((feeRows || [])[0] && (feeRows || [])[0].fields[3])}）`);
    ok((feeRows || []).every(r => /送评日期[\s\S]*单号[\s\S]*评级收费[\s\S]*查看清单/.test(r.html)),
        'HTML 里的先后顺序也是 送评日期 → 单号 → 评级收费 → 查看清单');
    ok((feeRows || []).every(r => !/购入价格/.test(r.text)), '不出现「购入价格」字样（那是藏品的说法，费用条目不沿用）');
    ok((feeRows || []).every(r => !/批次[\s\S]*PJ/.test(r.text) && !/（\d+ 项）/.test(r.text)),
        '不出现「批次 …（N 项）」这种标题');
    ok((feeRows || []).every(r => !/\d+\s*件/.test(r.text)), '第二行里不再列件数（用户给的版式里没有件数）');
    ok((feeRows || []).every(r => /爱藏/.test(r.text)), '页面上的公司名确实渲染出来了（来自数据，不是渲染里写死）');
    ok((feeRows || []).every((r, i) => (r.text.match(new RegExp(EXPECT[i][0], 'g')) || []).length === 1),
        `每条里 PJ 编号只出现**一次**（实际 ${JSON.stringify((feeRows || []).map((r, i) => (r.text.match(new RegExp(EXPECT[i][0], 'g')) || []).length))}）`);
    ok((feeRows || []).every(r => r.date && r.date.length > 0), '每条都落在某个日期分组头下（分组没坏）');
    ok((feeRows || []).every(r => !SOLD_CERTS.some(c => r.text.includes(c))), '已售出的 4 个编码没有出现在卡片里');

    // ⑫-4d 金额：第二行里的「评级收费」= 该批支出（不是留档那侧）
    const feeAmts = (feeRows || []).map(r => NUM(r.fields[2]));
    ok(JSON.stringify(feeAmts) === JSON.stringify(WANT_AMTS),
        `「评级收费」= ${WANT_AMTS.join(' / ')}（支出侧；实际 ${feeAmts.join(' / ')}）`);
    ok(R1(feeAmts.reduce((s, v) => s + v, 0)) === KEPT_PAID,
        `5 笔金额之和 = ${KEPT_PAID}（实际 ${R1(feeAmts.reduce((s, v) => s + v, 0))}）`);
    ok((feeRows || []).every((r, i) => r.fields[2] === '评级收费：' + WANT_AMTS[i] + '元'),
        `金额逐条逐字正确（${WANT_AMTS.map(v => v + '元').join(' / ')}）`);
    ok(feeAmts.every(v => v !== 297 && v !== 495 && v !== 855),
        '已售出行被排除后的金额（279/423/810）与旧值（297/495/855）确实不同 —— 页面上真的按新口径显示');
    ok((feeRows || []).every(r => !/timeline-fee-amount/.test(r.html)),
        '不再有独立的右侧金额节点（金额改成第二行里的「评级收费」，按用户给的版式走）');

    // ⑫-4e ★「查看清单」链接：数据给了 listUrl，就必须是能打开的真链接
    ok((feeRows || []).every(r => r.linkText === '查看清单'), '每条都渲染出了「查看清单」链接');
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
        `★「查看清单」与正文行内链接同色（都是 ${artLinkColor}）`);
    const linkStatus = JSON.parse(await evaluate(`(async()=>{
        const out = [];
        for (const a of document.querySelectorAll('.timeline-item[data-type="fee"] .timeline-fee-link')) {
            const r = await fetch(a.href, { method: 'HEAD' });
            out.push([a.getAttribute('href'), r.status]);
        }
        return JSON.stringify(out);
    })()`));
    ok(linkStatus.length === 5, `页面上有 5 个清单链接（实际 ${linkStatus.length}）`);
    ok(linkStatus.every(([, s]) => s === 200), `5 个链接 HEAD 全部 200、不是 404（实际 ${linkStatus.map(([, s]) => s).join(' / ')}）`);
    ok(linkStatus.every(([h]) => h.includes('grading_fee/') && h.endsWith('.xlsx')), '打开的确实是 grading_fee 目录下的 .xlsx');

    // ⑫-4f ★ listUrl 缺失时**不渲染链接**（不留空占位、不出死链）
    //   渲染分支已经由 ⑧-1b 用"删掉 listUrl 的数据"验过了（条目上 listUrl 为空串）；
    //   这里在真实 DOM 上按同一条判据（有 listUrl 才有 <a>）复核一遍页面形状。
    const linkShape = JSON.parse(await evaluate(`(()=>{
        const cards = [...document.querySelectorAll('.timeline-card--fee')].filter(c => c.getBoundingClientRect().width > 1);
        const withLink = cards.filter(c => c.querySelector('.timeline-fee-link')).length;
        const cardsNoLink = cards.filter(c => c.querySelector('.timeline-fee-sub .fee-f:last-child') &&
                                             /查看清单/.test(c.querySelector('.timeline-fee-sub .fee-f:last-child').textContent) &&
                                             !c.querySelector('.timeline-fee-link')).length;
        const emptyAnchors = [...document.querySelectorAll('.timeline-card--fee a')].filter(a => !a.getAttribute('href') || !a.textContent.trim()).length;
        return JSON.stringify({ cards: cards.length, withLink, cardsNoLink, emptyAnchors,
                                lastFieldTexts: cards.map(c => (c.querySelector('.timeline-fee-sub .fee-f:last-child')||{}).textContent || '') });
    })()`));
    ok(linkShape.cards === 5 && linkShape.withLink === 5,
        `5 张卡都有 listUrl ⇒ 5 个链接（实际 ${linkShape.withLink}/${linkShape.cards}）`);
    ok(linkShape.cardsNoLink === 0, '没有"写着查看清单却没有链接"的卡片（不留空占位）');
    ok(linkShape.emptyAnchors === 0, '没有 href 为空或文字为空的 <a>（不出死链）');
    ok(linkShape.lastFieldTexts.every(t => t === '查看清单'),
        `最后一项就是「查看清单」（实际 ${JSON.stringify(linkShape.lastFieldTexts)}）`);

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
    ok(nums.length > 5 && nums.every((v, i) => i === 0 || nums[i - 1] <= v),
        `整条时间轴按日期升序（${nums.length} 个日期分组，逆序 0 处）`);

    const wantIdx = WANT_DATES.map(d => isoOrder.indexOf(d)).filter(i => i >= 0);
    // 每个付款日期都必须在分组头里出现。★ 付款日期上**可能恰好也有藏品**（实测有：
    // 2026-01-29 / 2026-04-01 / 2026-10-01 三天都有），此时评级费与当天藏品合并进**同一个**
    // 分组头，命中数仍是 5（因为合并的是"条目"不是"日期"）。若哪天命中数 < 5，
    // 说明台账的日期键与藏品的写法不一致了（会冒出两个同名分组头），立刻红出来。
    ok(wantIdx.length === 5, `5 个付款日期都出现在日期分组头里（实际 ${wantIdx.length} 个：${wantIdx.join(', ')}）`);
    ok(wantIdx.every(p => p > 0 && p < isoOrder.length - 1),
        `它们都夹在藏品日期之间、没有被单独排到某一段（位置 ${wantIdx.join(', ')} / 共 ${isoOrder.length} 组）`);

    // ★ 同名分组头去重：这 5 个日期上如果一个"评级费组"和一个"藏品组"并排出现，
    //   页面上就会看到两个一样的日期标题。分组键必须和藏品那侧完全一致，这里把它钉住。
    const dupHeaders = isoOrder.filter((d, i) => isoOrder.indexOf(d) !== i);
    ok(dupHeaders.length === 0, `没有重复的日期分组头（重复：${[...new Set(dupHeaders)].join(', ') || '无'}）`);

    // 「与藏品混排」的核心证据：这 5 条不是被单独插在开头或结尾的一段，
    // 而是各自落在藏品日期流中间 —— 前后都有其他（藏品）日期分组。
    const hasBefore = wantIdx.filter(p => p > 0).length;
    const hasAfter = wantIdx.filter(p => p < isoOrder.length - 1).length;
    ok(hasBefore === 5 && hasAfter === 5,
        `5 条的前后都有藏品日期分组（前面有内容 ${hasBefore}/5，后面有内容 ${hasAfter}/5）`);

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
    for (const iso of WANT_DATES) {
        const g = sameDay[feeLabelOf(iso)];
        if (!g) { badMix.push(iso + ':分组缺失'); continue; }
        if (g.fee !== 1) { badMix.push(iso + ':评级费条目数=' + g.fee); continue; }
        if (g.n > 1) mixedDays++; else soloDays++;
    }
    ok(badMix.length === 0, `每个付款日期的分组里都恰好有 1 条评级费（异常：${badMix.join(' / ') || '无'}）`);
    ok(mixedDays + soloDays === 5, `其中 ${mixedDays} 天与当天藏品同组、${soloDays} 天只有评级费（合计 5 天）`);
    ok(mixedDays >= 3, `至少有 3 天是"与藏品同一天、合并进同一个分组头"的混排（实际 ${mixedDays} 天）`);

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
    ok(topN === baseline + 5, `时间轴条目数 = 藏品（填了购入日期的）${baseline} + 评级费 5 = ${baseline + 5}（实际「${topCount}」）`);
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
    ok(themeOn === true && darkFee.scheme === 'dark' && darkFee.n === 5,
        `深色模式：5 条评级费仍在（data-color-scheme=${darkFee.scheme}，可见条数=${darkFee.n}）`);
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
    ok(mobFee.n === 5, `手机宽度 375px：5 条评级费仍在（可见条数=${mobFee.n}，视口 ${mobFee.vw}px）`);
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
    ok(clickProbe.feeHits === 5, `点到了 5 条费用条目（实际 ${clickProbe.feeHits}）`);
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

    ok(pageErrors.length === 0, `全程无未捕获异常（${pageErrors.length} 条${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' | ') : ''}）`);
} catch (e) {
    ok(false, '浏览器段异常：' + e.message);
} finally {
    try { ws.close(); } catch { }
    try { child.kill(); } catch { }
    server.close();
}

console.log('\n──────── 通过 ' + pass + ' / 失败 ' + fail + ' ────────');
process.exit(fail === 0 ? 0 : 1);
