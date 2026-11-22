#!/usr/bin/env node
/**
 * apply-patch.mjs —— 对 DeepSeek 官方 chat-demo 构建产物做最小化、可复现的补丁。
 *
 * 只做三件事，都是精确字符串替换，替换次数不符即报错退出：
 *   1. 把写死的 API 根地址改成「优先读 localStorage，回退官方地址」，
 *      从而支持在设置面板里自定义 base URL（中转站 / 自建代理 / 本机服务）。
 *   2. 把写死的默认模型改成「优先读 localStorage 里选定的模型」。
 *   3. 在 index.html 里注入 localstore-bridge.js（本地持久化 + 多提供方旁路层）。
 *
 * 幂等：重复运行不会重复打补丁。原文件首次修改前会备份为 *.orig。
 *
 * 用法：
 *   node tools/apply-patch.mjs           # 打补丁
 *   node tools/apply-patch.mjs --check   # 只检查，不写入
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_JS = join(ROOT, 'static', 'js', 'main.6fd9c886.js');
const INDEX_HTML = join(ROOT, 'index.html');
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// 补丁 1：可配置 API 根地址
// ---------------------------------------------------------------------------

// bundle 原文（已通过 grep 确认全库仅此 1 处）：
//   let m="https://api.deepseek.com",g=`${m}/anthropic/v1`;
// m 是**裸主机名**，被用于 /models（`${m}/models`）以及拼出 g。
// g 再被用于 /files、/messages，并作为 `g.SZ` 被语音模块用来拼
// /v1/tools/asr 与 /v1/tools/tts。
//
// 关键点：`m` 里**不含** /anthropic 路径，所以 g 必须自己补上。
// 早先这里把 m 变成「已规范化到 /anthropic 的地址」却仍然写 `${m}/anthropic/v1`，
// 结果 g 变成 `.../anthropic/anthropic/v1` —— 文件上传与语音全线 404，
// 而 /models 因为只用 m 反而是好的（很容易漏掉）。
// 现在统一：m 保存**不带 /anthropic 的根地址**，g 用 `${m}/anthropic/v1` 拼。
const API_ORIGINAL = 'let m="https://api.deepseek.com",g=`${m}/anthropic/v1`;';

const API_PATCHED =
  'let m=(()=>{try{let v=localStorage.getItem("chat-demo:api-base");' +
  'if("string"==typeof v&&v.trim())return v.trim().replace(/\\/+$/,"")' +
  '.replace(/\\/anthropic$/i,"")}catch{}' +
  'return window.__CHAT_API_BASE__||"https://api.deepseek.com"})()' +
  ',g=`${m}/anthropic/v1`;';

const API_MARKER = '__CHAT_API_BASE__';

// 旧版补丁留下的形态：URL 规范化只去了尾部斜杠，没有剥掉 /anthropic。
// 保留这两个常量是为了能**就地升级**已打坏的 bundle，而不是要求人工回滚。
const API_LEGACY_SIG =
  'if("string"==typeof v&&v.trim())return v.trim().replace(/\\/+$/,"")}catch{}';
const API_UPGRADED_SIG =
  'if("string"==typeof v&&v.trim())return v.trim().replace(/\\/+$/,"")' +
  '.replace(/\\/anthropic$/i,"")}catch{}';

// ---------------------------------------------------------------------------
// 补丁 2：可配置默认模型
// ---------------------------------------------------------------------------

// bundle 里默认模型是一个常量：let ec="deepseek-flash",ed={level:"high"}
//
// 注意：全库里 "ec" 这个标识符还有 3 处无关出现（React 的 createElement
// 命名空间函数 ec(e){switch(e){case"svg"...}}、Prism 的语言列表数据），
// 所以这里绝不能用正则去全局替换 ec，必须锚定这个唯一的定义点。
//
// 改法分两步：
//   1. 在定义点旁新增取值器 ec0()，读 localStorage 里选定的模型；
//   2. 把三处「使用 ec 取模型」的调用点改成 ec0()。
//
// 为什么不把 ec 本身改成函数：ec 是被当作「值」塞进对象字面量的
// （{model: ec}）以及做 ?? 回退的（t.model ?? ec）。若 ec 变成函数，
// 这两个位置会把函数对象本身当模型名传出去，属于隐蔽的错误。
// 必须让调用点显式调用，语法上才无歧义。
//
// 调用点（全库实测共 3 处）：
//   A. model:ec,thinking:e,search:t,prefix:!0      ← 新建助手消息
//   B. model:t.model??ec                            ← 发请求时
//   C. model:a.model??ec                            ← 重新生成时
const MODEL_STORAGE_KEY = 'chat-demo:model';

// ec 的官方默认值。补丁后的文本里仍然保留 ec 这个常量，
// 所以「原串」必须带上足够多的后续内容做锚点，否则会误判成「还没打补丁」。
const MODEL_EC_LET = 'let ec="deepseek-flash"';

// 官方原文（含紧随其后的 ed / ef 定义，确保唯一且不会与补丁后的文本混淆）
const MODEL_ORIGINAL = MODEL_EC_LET + ',ed={level:"high"},ef=';

// 两个取值器一次插入（同一个替换里完成）：
//   ec0() —— 每次请求时现读模型名
//   k0()  —— 每次请求时现读 API Key
//
// 为什么 k0 也放在这里：单独给它一个「插入到某处」的补丁很难做到幂等
// —— 插入后原来的锚点依然存在，重复运行就会再插一份。
// 合进这个唯一的替换点后，幂等性由模型补丁的 marker 一并保证。
//
// k0 内部的写法要避开 `.getState().apiKey??""` 这个模式，
// 因为那正是「API Key 读取点」补丁要替换的目标；否则 k0 会把自己的函数体改掉。
const KEY_GETTER =
  'k0=function(){' +
  'try{var lv=localStorage.getItem("chat-demo:api-key");' +
  'if(typeof lv==="string"&&lv.trim())return lv.trim()}catch(e){}' +
  'try{var ls=u.t0.getState();if(ls&&ls.apiKey)return ls.apiKey}catch(e){}return ""}' +
  ',';

const MODEL_PATCHED =
  MODEL_EC_LET +
  ',' +
  KEY_GETTER +
  'ec0=function(){' +
  'try{var v=localStorage.getItem(' +
  JSON.stringify(MODEL_STORAGE_KEY) +
  ');if(typeof v==="string"&&v.trim())return v.trim()}catch(e){}' +
  'return ec},ed={level:"high"},ef=';

/** 三处调用点：原串 → 改成显式调用取值器 */
const MODEL_CALL_SITES = [
  ['model:ec,thinking:e,search:t,prefix:!0', 'model:ec0(),thinking:e,search:t,prefix:!0'],
  ['model:t.model??ec', 'model:t.model??ec0()'],
  ['model:a.model??ec', 'model:a.model??ec0()']
];

const MODEL_MARKER = 'chat-demo:model';

// ---------------------------------------------------------------------------
// 补丁 3：注入旁路桥接脚本
// ---------------------------------------------------------------------------

// 注意：标签里带一个内容哈希做缓存击穿。
// 应用的其它产物（main.6fd9c886.js 等）文件名自带哈希，浏览器不会缓存旧的；
// 而 localstore-bridge.js 是固定名，浏览器/服务器一旦缓存就会一直用旧版本 ——
// 表现为「我明明刷新了、代码也改了，但页面行为没变」。
// 每次打补丁都按内容重算哈希，于是改了桥接层就意味着换了 URL。
const BRIDGE_TAG_PREFIX = '<script src="localstore-bridge.js';
const BRIDGE_TAG_SUFFIX = '"></script>';

// 旧的固定形式（用于识别与升级）
const BRIDGE_TAG_PLAIN = '<script src="localstore-bridge.js"></script>';

const HTML_ORIGINAL =
  '<script defer src="static/js/main.6fd9c886.js"></script>';

// ---------------------------------------------------------------------------
// 补丁 4：站点标题
// ---------------------------------------------------------------------------

// 官方标题是「API 使用 demo」，这里换成正式的站点名。
// 用「匹配任意 title 内容」的方式替换，这样即使标题被手工改过也能收敛到目标值，
// 并且从 .orig 重新生成时也会正确打上。
const TITLE_TARGET = 'DeepSeek - 探索未至之境';
const TITLE_RE = /<title>[^<]*<\/title>/;

// ---------------------------------------------------------------------------
// 补丁 5：API Key 改为「每次请求时现读」
// ---------------------------------------------------------------------------
//
// 背景：官方把 API Key 在启动时读进一个 zustand store（`g` 模块里的 t0），
// 之后发消息、传文件、语音转写都从 `t0.getState().apiKey` 取。也就是说
// **启动之后改 Key 不生效**，除非刷新页面。
//
// 这正是「切换提供方要闪一下」的原因：每个提供方有自己的 Key，切过去只能
// 刷新页面让 store 重新初始化。而刷新就丢掉了「当前打开的是哪个对话」
// （除非有深链接）—— 体验上就是闪动 + 回到新对话。
//
// 改法与模型取值器同思路：加一个 k0()，**每次调用时**先看 localStorage
// （切换提供方时桥接层会把 Key 镜像进 chat-demo:api-key），没有再回退到
// store 里的旧值。这样切换提供方就完全不需要刷新了。
//
// 全库 `t0.getState().apiKey` 共 6 处，都是「取当前 Key」的语义，
// 统一替换为 k0()。原始串出现次数必须正好 6，否则报错退出。
const KEY_STORE_READ = '.getState().apiKey??""';

const KEY_READ_ORIGINAL = KEY_STORE_READ;
const KEY_READ_PATCHED = '&&k0()||""';

/** 用来判定「取值器补丁已应用」的标记 */
const KEY_PATCH_MARKER = 'k0=function(){';

// ---------------------------------------------------------------------------
// 补丁 6：输入框占位文案
// ---------------------------------------------------------------------------
//
// 官方原文是「请输入消息」（英文 "Enter a message"），这里统一换成
// 「给 DeepSeek 发送消息」，与网页端的说法一致。
//
// 词条键是 chatInputPlaceholderChat，全库共 2 处（中英各一）。
// 两种语言都要改，否则切到英文界面又会退回旧文案。
const PLACEHOLDER_ORIGINAL_ZH = 'chatInputPlaceholderChat:"请输入消息"';
const PLACEHOLDER_ORIGINAL_EN = 'chatInputPlaceholderChat:"Enter a message"';

const PLACEHOLDER_PATCHED_ZH = 'chatInputPlaceholderChat:"给 DeepSeek 发送消息"';
const PLACEHOLDER_PATCHED_EN = 'chatInputPlaceholderChat:"Message DeepSeek"';

const PLACEHOLDER_MARKER = '给 DeepSeek 发送消息';

// ---------------------------------------------------------------------------

/** 取内容的短哈希，用于给桥接脚本 URL 做缓存击穿 */
function shortHash(s) {
  let h = 0x811c9dc5; // FNV-1a 32 位
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 生成桥接标签的匹配器：把「带哈希的当前形态」与「不带哈希的历史形态」
 * 都认作同一个标签，从而在升级时能把旧标签替换掉而不是又插一份。
 */
function bridgeTagMatcher() {
  const re = new RegExp(
    '<script src="localstore-bridge\\.js(?:\\?v=[0-9a-f]+)?"[^>]*></script>',
    'g'
  );
  return (text) => {
    const found = text.match(re) || [];
    return {
      count: found.length,
      replace: (fn) => text.replace(re, fn)
    };
  };
}

/** 读取文件，首次修改前备份为 .orig */
function readWithBackup(path) {  const backup = path + '.orig';
  const text = readFileSync(path, 'utf8');
  if (!existsSync(backup)) {
    copyFileSync(path, backup);
    console.log(`  备份 → ${backup.slice(ROOT.length + 1)}`);
  }
  return text;
}

/**
 * 对 HTML 做「确保恰好注入一次」的幂等修补。
 *
 * 比单纯的字符串替换更健壮：直接统计目标标签出现次数，
 *   0 次 → 在锚点前插入
 *   1 次 → 已正确，跳过
 *   >1 次 → 说明此前被重复打过补丁，收敛为 1 次（自愈）
 *
 * matchFn 可选：用于把「同一标签的任意历史形态」都算作命中
 * （例如桥接标签从无哈希升级为带哈希）。
 */
function ensureSingleTag(text, anchor, tag, label, matchFn) {
  const matches = matchFn ? matchFn(text) : null;

  if (matches) {
    const { count, replace } = matches;
    if (count === 1 && text.includes(tag)) {
      console.log(`  · ${label}：已注入，跳过`);
      return { text, changed: false };
    }
    if (count >= 1) {
      // 有多处、或形态需要更新（如补上内容哈希）：统一收敛为一份最新标签
      let first = true;
      const collapsed = replace(() => {
        if (first) {
          first = false;
          return tag;
        }
        return '';
      });
      // replace 用的是字符串 split/join，多余的会被替换成空串，正好完成去重
      console.log(
        count > 1
          ? `  ⚠ ${label}：发现 ${count} 处注入，已收敛为 1 处`
          : `  ✓ ${label}：已更新为最新引用`
      );
      return { text: collapsed, changed: true };
    }
  }

  const count = text.split(tag).length - 1;

  if (count === 1) {
    console.log(`  · ${label}：已注入，跳过`);
    return { text, changed: false };
  }

  if (count > 1) {
    let seen = false;
    const deduped = text.split(tag).reduce((acc, part, i) => {
      if (i === 0) return part;
      if (!seen) {
        seen = true;
        return acc + tag + part;
      }
      return acc + part;
    }, '');
    console.log(`  ⚠ ${label}：发现 ${count} 处重复注入，已收敛为 1 处`);
    return { text: deduped, changed: true };
  }

  const anchorCount = text.split(anchor).length - 1;
  if (anchorCount !== 1) {
    throw new Error(
      `【补丁失败】${label}：锚点字符串出现 ${anchorCount} 次，期望恰好 1 次。\n` +
        `  该文件可能已被其他改动破坏。已中止，未写入。`
    );
  }
  console.log(`  ✓ ${label}：已注入（1 处插入）`);
  return { text: text.split(anchor).join(tag + anchor), changed: true };
}

/**
 * 判断一组替换是否已经全部应用过。
 *
 * 不能简单地用 marker 出现次数判断：打上补丁后，marker 本来就会出现多次。
 * 也不能只看「原始串是否还在」——见 below 的边界问题。
 */

/** 正则元字符转义 */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 统计「带标识符边界」的出现次数。
 *
 * 为什么需要边界：像 `model:t.model??ec` 这样的原串，本身就是补丁结果
 * `model:t.model??ec0()` 的前缀。若用朴素的 includes/split 匹配，第二次
 * 运行时会把 `ec0()` 里的 `ec` 再替换一遍，得到 `ec0()0()`，越滚越长。
 *
 * 边界规则（两条都必要，且都只在「可能截断标识符」时才生效）：
 *
 *   前边界：仅当原串以标识符字符开头时才检查，要求它前面不是标识符字符。
 *           例：`ec` 在 `??ec` 里成立；而 `vec` 里的 `ec` 不成立。
 *
 *   后边界：仅当原串以标识符字符结尾时才检查，要求它后面不是标识符字符。
 *           例：`??ec` 后面若是 `0`（属于 ec0）则拒绝。
 *           反例说明为什么不能无条件加后边界：API 原串以 `;` 结尾，
 *           而它后面紧跟着 `class v extends …`，`;` 与 `c` 之间是合法边界，
 *           若无条件要求「后面不是标识符字符」会把这个正确匹配也拒掉。
 */
function boundaryRegex(s, flags) {
  const startsWord = /^[A-Za-z0-9_$]/.test(s);
  const endsWord = /[A-Za-z0-9_$]$/.test(s);
  return new RegExp(
    (startsWord ? '(^|[^A-Za-z0-9_$])' : '') +
      '(' +
      esc(s) +
      ')' +
      (endsWord ? '(?![A-Za-z0-9_$])' : ''),
    flags
  );
}

function countBounded(text, s) {
  const re = boundaryRegex(s, 'g');
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

function replaceBounded(text, from, to) {
  const re = boundaryRegex(from, 'g');
  if (!/^[A-Za-z0-9_$]/.test(from)) {
    // 没有前边界捕获组，直接整体替换
    return text.replace(re, () => to);
  }
  return text.replace(re, (m, pre) => pre + to);
}

/** 替换**所有**出现处（用于同一语义重复多次的补丁） */
function replaceBoundedAll(text, from, to) {
  const re = boundaryRegex(from, 'g');
  if (!/^[A-Za-z0-9_$]/.test(from)) {
    return text.replace(re, () => to);
  }
  return text.replace(re, (m, pre) => pre + to);
}

/**
 * 按顺序施加多条精确替换，并强制每一条的替换次数（带标识符边界）。
 *
 * expect 可以是数字，也可以是数字数组（接受其中任意一个次数）。
 * 后者用于「同一语义出现多次、但历史版本次数不同」的情况：
 * 例如 API Key 读取点本身有 5 处，而早期补丁版本的 k0 函数体内也含这个模式，
 * 于是旧文件里是 6 处 —— 两种都必须能正确收敛。
 *
 * 支持「部分已应用」的中间状态：先逐条替换尚未应用的，再整体确认幂等。
 */
function replaceAllExactly(text, pairs, label, marker, expect = 1) {
  const allowed = Array.isArray(expect) ? expect : [expect, 1];
  let out = text;
  let changed = false;
  let applied = 0;

  // 这个替换点特殊：原串（模板字面量）会出现在「已打过补丁」的文本里，
  // 所以不能只看次数，必须先判断是否已经应用过。
  if (label === '可配置 API 根地址') {
    const already =
      text.includes(API_MARKER) && text.includes('.replace(/\\/anthropic$/i,"")');
    if (already) {
      console.log(`  · ${label}：此前已打过补丁，跳过`);
      return { text, changed: false };
    }
    // 老版本留下的形态：m 已经规范化到 /anthropic，但没有剥掉这段后缀，
    // 于是 g 拼成了 /anthropic/anthropic/v1（文件上传 404）。
    // 这里就地升级，不需要人工回滚重打。
    if (text.includes(API_LEGACY_SIG)) {
      const upgraded = text
        .split(API_LEGACY_SIG)
        .join(API_UPGRADED_SIG);
      console.log(`  ✓ ${label}：已从旧版（双 /anthropic 前缀）升级`);
      return { text: upgraded, changed: true };
    }
  }

  for (const [from, to] of pairs) {
    const count = countBounded(out, from);
    if (allowed.indexOf(count) !== -1) {
      // 全部替换：正则带 g，replaceBounded 本身就会替换所有匹配
      out = replaceBounded(out, from, to);
      changed = true;
      applied++;
    } else if (count > 0) {
      throw new Error(
        `【补丁失败】${label}：目标字符串出现 ${count} 次，期望 ${allowed.join(' 或 ')} 次。\n` +
          `  目标：${from.slice(0, 120)}\n` +
          `  出于安全考虑不进行模糊替换。已中止，未写入任何文件。`
      );
    }
  }

  if (!changed) {
    // 标记在、且原串已不存在 → 说明这条补丁此前已完整应用过
    const stillOriginal = pairs.some(([from]) => countBounded(text, from) > 0);
    if (text.includes(marker) && !stillOriginal) {
      console.log(`  · ${label}：此前已打过补丁，跳过`);
      return { text, changed: false };
    }
    if (!text.includes(marker)) {
      throw new Error(
        `【补丁失败】${label}：未找到任何目标字符串，且标记 "${marker}" 也不存在。\n` +
          `  这通常意味着 bundle 版本已变更（不是 v0.1.2），或补丁已被手工改坏。\n` +
          `  已中止，未写入任何文件。`
      );
    }
    throw new Error(
      `【补丁失败】${label}：标记 "${marker}" 存在，但部分原串仍在（半应用状态）。\n` +
        `  bundle 可能被手工改过。已中止，未写入任何文件。`
    );
  }

  console.log(`  ✓ ${label}：已应用（${applied}/${pairs.length} 处）`);
  return { text: out, changed: true };
}

/**
 * 幂等地把 <title> 设为目标标题。
 * 官方标题可能被改过（这里就是故意改的），所以不锚定原文，直接整段替换。
 */
function ensureTitle(text, target, label) {
  const m = text.match(TITLE_RE);
  if (!m) {
    if (text.includes(target)) {
      console.log(`  · ${label}：已设置，跳过`);
      return { text, changed: false };
    }
    throw new Error(
      `【补丁失败】${label}：index.html 里找不到 <title> 标签。已中止，未写入。`
    );
  }
  if (m[0] === `<title>${target}</title>`) {
    console.log(`  · ${label}：已设置，跳过`);
    return { text, changed: false };
  }
  console.log(`  ✓ ${label}：${m[0]} → <title>${target}</title>`);
  return { text: text.replace(TITLE_RE, `<title>${target}</title>`), changed: true };
}

function main() {
  console.log(`\n=== chat-demo 补丁 ${CHECK_ONLY ? '(check only)' : ''} ===\n`);

  // --- main.js ---
  console.log('main.6fd9c886.js');
  const jsText = readWithBackup(MAIN_JS);

  const api = replaceAllExactly(
    jsText,
    [[API_ORIGINAL, API_PATCHED]],
    '可配置 API 根地址',
    API_MARKER
  );

  const model = replaceAllExactly(
    api.text,
    [[MODEL_ORIGINAL, MODEL_PATCHED]].concat(MODEL_CALL_SITES),
    '可配置默认模型',
    MODEL_MARKER
  );

  // 补丁 5：把 5 处「从启动时快照里读 Key」改成调用 k0() 现读。
  // k0 本身由补丁 2 一并插入（见 MODEL_PATCHED）。
  const keyReads = replaceAllExactly(
    model.text,
    [[KEY_READ_ORIGINAL, KEY_READ_PATCHED]],
    'API Key 读取点',
    KEY_READ_PATCHED,
    [5, 6]
  );

  // 补丁 6：中英两处占位文案都换掉
  const placeholder = replaceAllExactly(
    keyReads.text,
    [
      [PLACEHOLDER_ORIGINAL_ZH, PLACEHOLDER_PATCHED_ZH],
      [PLACEHOLDER_ORIGINAL_EN, PLACEHOLDER_PATCHED_EN]
    ],
    '输入框占位文案',
    PLACEHOLDER_MARKER
  );

  // --- 桥接脚本必须存在，否则注入等于埋雷 ---
  const bridgePath = join(ROOT, 'localstore-bridge.js');
  if (!existsSync(bridgePath)) {
    throw new Error(
      `【补丁失败】找不到 localstore-bridge.js（期望位于 ${bridgePath}）。\n` +
        `  index.html 会引用它，缺失将导致页面 404 但功能静默失效。已中止。`
    );
  }
  const bridgeSourceRaw = readFileSync(bridgePath, 'utf8');

  /**
   * 把功能扩展层的内容哈希写进桥接层。
   *
   * ★ 为什么必须这么做 ★
   *
   * 桥接层加载功能扩展层时用的是 `?v=' + BRIDGE_VERSION`，而 BRIDGE_VERSION
   * 是**手写常量**（1.2.0）。于是只改 localstore-features.js / .css 的话，
   * 两个文件的 URL 一个字都不变 → 浏览器继续用缓存里的旧文件 →
   * 「我改了代码、也刷新了，但页面行为没变」。
   * 这个坑真的踩到了：菜单跳左上角的修复只改 features.js，推上线等于没推。
   *
   * 修法：把两个文件的内容哈希注入桥接层，再**把注入后的桥接层内容**拿去
   * 算指纹。于是「改 features」⇒「桥接层指纹变」⇒「index.html 里的 ?v 变」
   * ⇒「桥接层 URL 变」⇒ 浏览器必然重新拉取，并拿到新的 features URL。
   * 一处改，整条链都跟着换，不需要任何人记得手写版本号。
   */
  const FEATURES_FILES = ['localstore-features.js', 'localstore-features.css'];
  const featuresHashes = {};
  for (const name of FEATURES_FILES) {
    const p = join(ROOT, name);
    featuresHashes[name] = existsSync(p) ? shortHash(readFileSync(p, 'utf8')) : 'missing';
  }
  const FEATURES_JS_HASH = featuresHashes['localstore-features.js'];
  const FEATURES_CSS_HASH = featuresHashes['localstore-features.css'];

  // 与桥接层里 `var FEATURES_JS_VERSION = '...';` 这一行一一对应
  const FEATURES_VER_RE = /var FEATURES_JS_VERSION = '[^']*';\s*\n\s*var FEATURES_CSS_VERSION = '[^']*';/;
  const FEATURES_VER_STMT =
    `var FEATURES_JS_VERSION = '${FEATURES_JS_HASH}';\n` +
    `var FEATURES_CSS_VERSION = '${FEATURES_CSS_HASH}';`;
  if (!FEATURES_VER_RE.test(bridgeSourceRaw)) {
    throw new Error(
      '【补丁失败】在 localstore-bridge.js 里找不到 FEATURES_JS_VERSION / ' +
        'FEATURES_CSS_VERSION 声明。\n  这两个常量用于给功能扩展层做缓存击穿，' +
        '缺了会导致「改了 features 却不生效」。已中止。'
    );
  }
  const bridgeSource = bridgeSourceRaw.replace(FEATURES_VER_RE, FEATURES_VER_STMT);

  const bridgeVersion = (bridgeSource.match(/BRIDGE_VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
  const bridgeHash = shortHash(bridgeSource);
  console.log(
    `  ✓ localstore-bridge.js 存在（v${bridgeVersion}，指纹 ${bridgeHash}）`
  );
  console.log(`  ✓ 功能扩展层指纹：js=${FEATURES_JS_HASH} css=${FEATURES_CSS_HASH}`);
  const BRIDGE_TAG =
    BRIDGE_TAG_PREFIX + '?v=' + bridgeHash + BRIDGE_TAG_SUFFIX;
  console.log(
    `  ✓ localstore-bridge.js 存在（v${bridgeVersion}，指纹 ${bridgeHash}）`
  );

  // --- index.html ---
  console.log('index.html');
  const htmlText = readWithBackup(INDEX_HTML);
  const titled = ensureTitle(htmlText, TITLE_TARGET, '站点标题');
  const html = ensureSingleTag(
    titled.text,
    HTML_ORIGINAL,
    BRIDGE_TAG,
    '注入 localstore-bridge.js',
    bridgeTagMatcher()
  );

  // --- 写入 ---
  if (CHECK_ONLY) {
    console.log('\n（--check 模式，未写入任何文件）\n');
    return;
  }

  const jsChanged = model.changed || keyReads.changed || placeholder.changed;
  const jsFinal = placeholder.text;
  // 功能扩展层指纹变了就要把桥接层写回去（否则 URL 不换，修复推不出去）
  const bridgeChanged = bridgeSource !== bridgeSourceRaw;

  if (jsChanged) writeFileSync(MAIN_JS, jsFinal);
  if (bridgeChanged) writeFileSync(bridgePath, bridgeSource);
  if (html.changed) writeFileSync(INDEX_HTML, html.text);

  const touched = [
    jsChanged && 'main.6fd9c886.js',
    bridgeChanged && 'localstore-bridge.js',
    html.changed && 'index.html'
  ]
    .filter(Boolean)
    .join(', ');

  console.log(`\n完成。已写入：${touched || '（无需改动）'}`);
  console.log('回滚方式：把同名 .orig 文件覆盖回去即可。\n');
}

try {
  main();
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
