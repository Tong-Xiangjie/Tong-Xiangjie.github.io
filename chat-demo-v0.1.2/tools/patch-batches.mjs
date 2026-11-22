#!/usr/bin/env node
/**
 * 修补已有的分批包：补上两个转换器漏掉的、而应用**无条件读取**的字段。
 *
 * 背景（"随便点一个对话就黑屏"的根因）：
 *
 *   1. 用户消息缺 `files`
 *      应用里直接写 `n.files.length`，undefined 时抛
 *      `TypeError: Cannot read properties of undefined (reading 'length')`。
 *      页面没有错误边界 → 整棵 React 树被卸载 → body 只剩空 div#root，
 *      连侧栏都消失，就是用户看到的"黑屏"。
 *      官方导出里 39/39 条用户消息都有 files（其中 33 条是空数组）。
 *
 *   2. 助手消息缺 `latestReminder`
 *      官方导出里 62/62 条助手消息都有，形如
 *      "2026-11-20,星期五,,Web,中文"（日期,星期,城市,平台,语言）。
 *
 * 修法是**就地更新**，不是重新生成，所以：
 *   · 会话 id、消息 id 一律不动 → 已经导进去的数据重新导入时会被按
 *     id+updatedAt 幂等跳过或更新，不会产生重复
 *   · 附件 base64 原样保留，不重新编码
 *
 * 用法:
 *   node tools/patch-batches.mjs <官方导出目录> <批包目录>          # 先试运行
 *   node tools/patch-batches.mjs <官方导出目录> <批包目录> --write  # 真正写入
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const srcDir = process.argv[2];
const outDir = process.argv[3];
const doWrite = process.argv.includes('--write');
if (!srcDir || !outDir) {
  console.error('用法: node tools/patch-batches.mjs <官方导出目录> <批包目录> [--write]');
  process.exit(1);
}

const sessDir = join(srcDir, 'chat_sessions');
if (!existsSync(sessDir)) { console.error('找不到 ' + sessDir); process.exit(1); }

// ---------------------------------------------------------------------------
// 官方源会话：建 消息id → 原始消息 的索引，用来取「应用真正期望的字段形状」
// ---------------------------------------------------------------------------
console.log('建立官方源索引…');
const srcByMsgId = new Map();
{
  const idx = JSON.parse(readFileSync(join(srcDir, 'chat_session_index.json'), 'utf8'));
  let n = 0;
  for (const meta of idx) {
    const jf = join(sessDir, `${meta.id}.json`);
    if (!existsSync(jf)) continue;
    let s;
    try { s = JSON.parse(readFileSync(jf, 'utf8')); } catch (e) { continue; }
    for (const m of (s.messages || [])) {
      if (m && m.id != null) srcByMsgId.set(String(m.id), m);
    }
    n++;
  }
  console.log(`  读了 ${n} 个会话，消息索引 ${srcByMsgId.size} 条`);
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
function buildReminder(millis) {
  const d = millis == null ? new Date() : new Date(millis);
  if (!Number.isFinite(d.getTime())) return '';
  const p2 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())},${WEEKDAYS[d.getDay()]},,Web,中文`;
}

// ---------------------------------------------------------------------------
// 逐个批包修补
// ---------------------------------------------------------------------------
const batchFiles = readdirSync(outDir).filter((f) => /^part-\d+\.json$/.test(f)).sort();
if (!batchFiles.length) { console.error('批包目录里没找到 part-NN.json'); process.exit(1); }

let totFiles = 0, totSess = 0, totMsg = 0;
let addFiles = 0, addReminder = 0, untouched = 0, noSrc = 0;
const changed = [];

for (const f of batchFiles) {
  const p = join(outDir, f);
  let raw = readFileSync(p, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  if (hasBom) raw = raw.slice(1);
  const b = JSON.parse(raw);

  let changedThis = false;
  for (const s of (b.sessions || [])) {
    totSess++;
    for (const m of (s.messages || [])) {
      totMsg++;
      const src = srcByMsgId.get(String(m.id));
      if (!src) { noSrc++; continue; }

      if (m.role === 'user') {
        // ① 用户消息必须有 files
        const want = Array.isArray(m.files) ? m.files
          : (Array.isArray(src.files) ? src.files : []);
        if (!Array.isArray(m.files)) {
          m.files = want;
          addFiles++;
          changedThis = true;
        }
      } else {
        // ② 助手消息必须有 latestReminder
        if (m.latestReminder === undefined) {
          const v = typeof src.latestReminder === 'string' && src.latestReminder
            ? src.latestReminder
            : buildReminder(typeof m.createdAt === 'number' ? m.createdAt : null);
          if (v) {
            m.latestReminder = v;
            addReminder++;
            changedThis = true;
          }
        }
      }
    }
  }

  if (changedThis) {
    if (doWrite) {
      // 保留原格式：2 空格缩进（转换器写出去就是这个）
      writeFileSync(p, JSON.stringify(b, null, 2), 'utf8');
    }
    changed.push(f);
  } else {
    untouched++;
  }
  totFiles++;
}

console.log('');
console.log('================ 修补结果 ================');
console.log(`  批包          : ${totFiles} 个`);
console.log(`  会话          : ${totSess}`);
console.log(`  消息          : ${totMsg}`);
console.log(`  补 files      : ${addFiles} 条（用户消息）`);
console.log(`  补 latestReminder: ${addReminder} 条（助手消息）`);
console.log(`  源里找不到的  : ${noSrc} 条（可能索引区间对不上，下面会列出来）`);
console.log(`  有改动的包    : ${changed.length} 个`);
console.log(`  无需改动的包  : ${untouched} 个`);
console.log('');
console.log(doWrite ? '★ 已写入磁盘' : '★ 试运行（没写盘），加 --write 才真正写入');
if (changed.length && changed.length <= 20) console.log('  改动清单: ' + changed.join(', '));
if (noSrc) {
  console.log('');
  console.log('⚠ 有消息在官方源里找不到 —— 说明批包与源索引区间可能错位，值为空可能不准。');
}
