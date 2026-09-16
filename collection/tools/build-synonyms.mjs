#!/usr/bin/env node
// ==================== 构建期生成文章搜索的同义词表 ====================
//
// 为什么需要它：文章板块要支持「央行 → 中国人民银行」「荷花钞 → 莲花」这类模糊
// 搜索。实测过在浏览器里跑语义模型（bge-small / bge-large），小模型不具备这类
// 世界知识，大模型要下 312 MB 且被语料同质性淹没。所以把这件事挪到**构建期**：
// 用 LLM 把同义关系离线算好，写成一张小表，运行期只做纯词法匹配 + 查表扩展。
//
// 用法：
//   node collection/tools/build-synonyms.mjs --dry-run   只统计候选词，不调 API
//   node collection/tools/build-synonyms.mjs --full      全量重建（忽略已有表）
//   node collection/tools/build-synonyms.mjs             增量（只处理新/改文章里的术语）
//   node collection/tools/build-synonyms.mjs --limit 60 --out /tmp/x.json   小规模试跑
//
// ★ 增量是怎么判定的（重要）：
//   表里存了 corpus: { "文章相对路径": "内容指纹" }。每次运行先算一遍指纹，
//   只有**内容变了或新增的**文章才参与本次生成 —— 语料没变就一个 API 调用都不发。
//   早先的做法是"凡是表里没有的候选词都发"，结果被 LLM 丢掉的 2.8 万个碎片片段
//   每次都会被重发一遍，增量退化成了全量。按文章指纹判断才是真增量。
//   注意判据是**文章**而不是"词"：某个词可能因为新文章出现而首次达到 df>=2
//   门槛，而它必然出现在新文章里，所以"新文章里的所有候选词"覆盖了这种情况。
//
// ★ 安全：本脚本**绝不**打印 API key，也不把它写进任何输出文件。
//   出错时只报 HTTP 状态码，不回显请求头或响应体。

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TABLE_PATH = path.join(ROOT, 'collection', 'data', 'synonyms.json');
const VERSION_PATH = path.join(ROOT, 'collection', 'data', 'synonyms-version.js');

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const BATCH_SIZE = 60;          // 每批喂给 LLM 的候选词个数
const CONCURRENCY = 4;          // 并发请求数
const MAX_RETRY = 3;
const MAX_SYNONYMS_PER_TERM = 6;
const MIN_DF = 2;               // 候选词至少要出现在 2 篇文章里
const MIN_LEN = 2;
const MAX_LEN = 6;

// ★ 种子白名单：这些条目是人工逐条验证过的（见 verify-article-fuzzy.mjs），
//   LLM 生成的结果**不允许覆盖**它们。用户在验收里明确要求保留这一层。
const VERIFIED = {
  '奥运': ['奥林匹克', '奥运会', '奥林匹克运动会', '奥运钞', '北京奥运'],
  '号码': ['冠号', '冠字号', '编号', '流水号', '字号', '号段'],
  '生肖钞': ['生肖', '贺岁', '贺岁钞', '生肖纪念钞', '贺岁纪念钞', '生肖贺岁'],
  '央行': ['中国人民银行', '人民银行', '中央银行', '人行'],
  '荷花钞': ['荷花', '莲花', '中国银行成立一百周年', '中银百年', '百年行庆'],
  '储备': ['中央储备银行', '中储券', '储备银行']
};

const HAN_RUN = /[\u4e00-\u9fa5]+/g;

// ---------- 收集语料 ----------
function walkTxt(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkTxt(full, out);
    else if (name.toLowerCase().endsWith('.txt')) out.push(full);
  }
  return out;
}

function stripHtmlLike(text) {
  // 与前端 article.js 的 stripHtml() 口径保持一致
  return text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function collectCorpus() {
  const files = [];
  for (const base of ['notecollection', 'coincollection', 'funcollection']) {
    walkTxt(path.join(ROOT, base, 'readmes'), files);
  }
  return files.map(f => {
    let raw = '';
    try { raw = readFileSync(f, 'utf8'); } catch { }
    const text = stripHtmlLike(raw);
    return {
      file: path.relative(ROOT, f).replace(/\\/g, '/'),
      text,
      // 指纹用**原文**算：只要文件字节变了就算"改过"
      hash: createHash('sha1').update(raw).digest('hex').slice(0, 16)
    };
  }).filter(a => a.text.trim());
}

// 把一段文本里所有 2~6 字纯汉字 n-gram 收集进 set（用于"这篇文章贡献了哪些候选词"）
function ngramsInto(text, set) {
  const runs = text.match(HAN_RUN) || [];
  for (const run of runs) {
    for (let n = MIN_LEN; n <= MAX_LEN; n++) {
      for (let i = 0; i + n <= run.length; i++) set.add(run.substr(i, n));
    }
  }
}

// ---------- 抽候选术语 ----------
// ★ 宽口径：纯汉字 n-gram（2~6 字），只要在 >= MIN_DF 篇文章里出现就进候选。
//   之前吃过亏：按"词频前 N"截断把低频词「储备」切掉了，导致整条查询无法扩展。
//   所以这里**不按频次截断**，把"哪些是真术语"的判断交给 LLM（它擅长这个）。
function extractCandidates(articles) {
  const df = new Map();
  for (const a of articles) {
    const seen = new Set();
    ngramsInto(a.text, seen);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const out = [];
  for (const [t, c] of df) if (c >= MIN_DF) out.push(t);
  // ★ 按文档频次降序：真实术语（高频）排在前面，成串的碎片排在后面。
  //   两个好处：① 每批里"真术语/碎片"的混杂度更自然，LLM 判断更稳；
  //   ② 万一任务中断，已经处理完的是更重要的词（低频词「储备」仍会被处理，
  //      只是排在后面 —— 注意这里是**排序**不是**截断**，一个都不丢）。
  out.sort((a, b) => (df.get(b) - df.get(a)) || (a.length - b.length) || (a < b ? -1 : 1));
  return { terms: out, df };
}

// ---------- 调 LLM ----------
const SYSTEM_PROMPT = [
  '你是中文钱币收藏领域的术语助手。用户会给你一批从纪念钞、纸币、硬币文章库里统计出来的候选词（其中混有大量无意义的片段）。',
  '',
  '请完成两件事：',
  '1. 挑出其中**真正有意义的中文术语**（人名、机构名、钞币名、收藏行话、专业名词等），丢掉无意义的字串片段（例如「国银行行」「的号码」「号查看」这种切碎的片段）。',
  '2. 对每个保留的术语，列出用户在搜索时可能输入的**同义词、别称、俗称、缩写、正式全称**。',
  '',
  '严格要求（务必遵守）：',
  'A. 同义词必须是**特异**的词。严禁输出「银行」「中国」「纪念」「纸币」「钞票」「收藏」「发行」「人民币」「国家」「图案」「正面」「背面」这类宽泛词——它们在语料里几乎每篇都有，放进搜索会淹没结果。宁可少给，也不要给泛词。',
  'B. 允许同义词与原词**共用汉字**，这是正常的，不要因为字形重叠就排除。例如「号码」→「冠字号」「编号」；「储备」→「中央储备银行」；「生肖钞」→「贺岁纪念钞」。',
  'C. 每个术语最多给 6 个同义词；确实没有合适的就给空数组。',
  'D. 只输出 JSON，不要任何解释文字，不要 markdown 代码块。',
  '',
  '输出格式（严格，键是术语本身，值是同义词数组）：',
  '{"央行":["中国人民银行","人民银行","中央银行"],"号码":["冠号","冠字号"]}'
].join('\n');

async function callLLM(terms, apiKey) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '候选词列表：\n' + terms.join('\n') }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 4096,
    stream: false
  };

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          // ★ key 只在这里出现，不进任何日志
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        // ★ 只报状态码，不回显响应体（可能含回显内容），更不回显请求头
        lastErr = 'HTTP ' + res.status;
        if (res.status === 401 || res.status === 402 || res.status === 400) break;
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('返回不是对象');
      return { ok: true, data: parsed, usage: json.usage || {} };
    } catch (e) {
      // ★ 只保留错误类型，绝不拼接可能含密钥的上下文
      lastErr = (e && e.name === 'SyntaxError') ? '返回的不是合法 JSON' : ((e && e.message) || '未知错误');
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return { ok: false, error: lastErr };
}

// ---------- 清洗 LLM 输出 ----------
// 泛词黑名单：即使提示词里禁了，仍要兜一道，防止 LLM 偶尔不听话。
// 这些词在语料里几乎每篇都有，放进扩展表会把结果冲垮（这是实测踩过的坑）。
const STOPWORDS = new Set([
  '银行', '中国', '纪念', '纸币', '钞票', '收藏', '发行', '人民币', '国家', '图案',
  '正面', '背面', '设计', '面值', '年份', '数量', '规格', '材质', '价格', '市场',
  '特点', '特征', '介绍', '概况', '历史', '文化', '价值', '意义', '相关', '以及',
  '进行', '通过', '由于', '因此', '但是', '而且', '我们', '他们', '可以', '这个',
  '那个', '一个', '什么', '怎么', '已经', '还有', '就是', '不是', '这些', '那些'
]);

function sanitize(term, list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set([term]);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    if (t === term || seen.has(t)) continue;
    if (STOPWORDS.has(t)) continue;                       // 泛词直接丢
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(t)) continue;    // 必须是词，不是标点
    if (t.length > 12) continue;                          // 太长的多半是句子
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SYNONYMS_PER_TERM) break;
  }
  return out;
}

// ★ 对称化：把 "语料术语 → 它的别称" 反过来也建一条 "别称 → 语料术语"。
//
//   为什么必须有这一步：候选词只能从**语料里出现过的字串**里抽，但用户真正会敲的
//   往往是语料里根本没有的俗称 —— 实测「生肖钞」「荷花钞」「中央储备银行」
//   「中储券」在这 60 篇文章里一次都没出现过（df=0），所以它们永远进不了候选表，
//   也就永远成不了查询键。
//   而 LLM 的回答里天然带着这些俗称（问它"生肖贺岁钞的别称"，它会答"生肖钞"）。
//   把每条 "A → [B,C]" 反向补成 "B → [A,C]"、"C → [A,B]"，俗称就有了键，
//   查「生肖钞」才能扩展出「生肖贺岁钞」并命中文章。
//
//   样例：{"生肖贺岁钞":["生肖钞","贺岁纪念钞"]}
//     → 补出 {"生肖钞":["生肖贺岁钞","贺岁纪念钞"]}
//            {"贺岁纪念钞":["生肖贺岁钞","生肖钞"]}
//   ★ 必须迭代到**不动点**，只跑一遍是错的。
//   这个变换不只是"补反向边"：它把 term 的**全部同义词**并进每个同义词的桶里
//   （bucket 里 for a of [term].concat(list)），这等于**新增了边**。
//   于是只跑一遍时，下一次运行会把新增的边再展开一轮，桶里继续长 ——
//   实测重跑一遍有 38 个条目的值会变（如「动效」从 5 项涨到 6 项，直到顶到
//   MAX_SYNONYMS_PER_TERM）。后果是每次增量运行都会改动 synonyms.json，
//   每次提交都刷新 generatedAt，而它是前端取表的 URL 版本号 ——
//   所有访客的缓存被无谓地冲掉、重下 400KB。
//   迭代到 F(Y)=Y 之后，重复运行的结果逐字相同。
function symmetrize(merged) {
  const out = Object.assign({}, merged);
  const MAX_PASSES = 12;   // 桶上限是 6，实际 2~3 轮就停了，12 只是兜底
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    // 先拍快照再遍历：下面会往 out[*] 里 push，直接遍历 out 有改到正在迭代的数组之虞
    const snapshot = Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]);
    for (const [term, list] of snapshot) {
      if (!Array.isArray(list) || !list.length) continue;
      for (const syn of list) {
        if (STOPWORDS.has(syn)) continue;
        if (!Array.isArray(out[syn])) out[syn] = [];
        const bucket = out[syn];
        for (const a of [term].concat(list)) {
          if (a === syn) continue;
          if (STOPWORDS.has(a)) continue;
          if (bucket.includes(a)) continue;
          if (bucket.length >= MAX_SYNONYMS_PER_TERM) break;
          bucket.push(a);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return out;
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const full = args.includes('--full');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? path.resolve(ROOT, args[outIdx + 1]) : TABLE_PATH;
  // --backfill-corpus：只把当前语料的内容指纹写进表，不调用 LLM。
  //   用途：老版本生成的表里没有 corpus 字段，直接跑增量会因为"所有文章都算改过"
  //   而重发全部候选词。回填一次之后，后续增量才是真增量。
  const backfill = args.includes('--backfill-corpus');

  console.log('[1/5] 收集语料…');
  const articles = collectCorpus();
  console.log(`      ${articles.length} 篇文章，去标签后共 ${articles.reduce((s, a) => s + a.text.length, 0).toLocaleString()} 字`);

  console.log('[2/5] 抽候选术语（宽口径：2~6 字纯汉字 n-gram，出现在 >=2 篇文章）…');
  const { terms: candidates } = extractCandidates(articles);
  console.log(`      候选 ${candidates.length.toLocaleString()} 个`);

  // 已有表
  let existing = { generatedAt: '', source: '', terms: {}, corpus: {} };
  if (existsSync(TABLE_PATH)) {
    try {
      const j = JSON.parse(readFileSync(TABLE_PATH, 'utf8'));
      if (j && j.terms && typeof j.terms === 'object') {
        existing = { generatedAt: j.generatedAt || '', source: j.source || '', terms: j.terms, corpus: j.corpus || {} };
      }
    } catch { }
  }

  if (backfill) {
    const corpus = {};
    for (const a of articles) corpus[a.file] = a.hash;
    const t = Object.assign({}, existing, { corpus });
    t.note = '由 collection/tools/build-synonyms.mjs 自动生成，请勿手改。种子白名单条目在脚本的 VERIFIED 常量里。corpus 是文章内容指纹，仅用于判断增量，前端不读。';
    writeFileSync(outPath, JSON.stringify(t, null, 2) + '\n', 'utf8');
    console.log(`[backfill] 已把 ${articles.length} 篇文章的内容指纹写入 ${path.relative(ROOT, outPath)}，未调用 LLM。`);
    return;
  }

  // ★ 增量判定：按**文章内容指纹**找出新增/修改的文章。
  //   语料没变 → changed 为空 → 一个 API 调用都不发（真增量）。
  const prevCorpus = existing.corpus || {};
  const changed = articles.filter(a => prevCorpus[a.file] !== a.hash);
  const removed = Object.keys(prevCorpus).filter(f => !articles.some(a => a.file === f));

  console.log(`[3/5] 已有表 ${Object.keys(existing.terms).length} 条；语料变化：新增/修改 ${changed.length} 篇，删除 ${removed.length} 篇`);
  if (removed.length) removed.slice(0, 10).forEach(f => console.log(`      已移除：${f}`));

  let todo;
  if (full) {
    todo = candidates.slice();
    console.log(`      全量模式：处理全部 ${todo.length.toLocaleString()} 个候选`);
  } else if (!changed.length && !removed.length) {
    todo = [];
    console.log('      语料没有变化，无需调用 LLM。');
  } else {
    // 只处理"出现在新增/改过的文章里"的候选词。
    // 这覆盖了两种需要更新的情况：① 全新术语；② 老术语因为新文章而变热/含义变化。
    const inChanged = new Set();
    for (const a of changed) ngramsInto(a.text, inChanged);
    todo = candidates.filter(t => inChanged.has(t));
    console.log(`      增量模式：只需处理新/改文章涉及的 ${todo.length.toLocaleString()} 个候选`);
  }
  if (limit > 0) { todo = todo.slice(0, limit); console.log(`      --limit ${limit}：截断到 ${todo.length} 个`); }

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));
  console.log(`      分成 ${batches.length} 批，每批 ${BATCH_SIZE} 个，并发 ${CONCURRENCY}`);
  const estIn = todo.length * 3 + batches.length * 260;
  const estOut = todo.length * 2;
  console.log(`      预估用量：输入约 ${estIn.toLocaleString()} tokens，输出约 ${estOut.toLocaleString()} tokens`);

  if (dryRun) {
    console.log('\n--dry-run 指定：不调用 API，到此为止。');
    // ★ 关键自检：低频但重要的术语必须留在候选里。
    //   之前按"词频前 N"截断把「储备」切掉了，整条查询就再也无法扩展。
    const must = ['储备', '央行', '号码', '生肖钞', '荷花钞', '奥运', '冠号', '莲花',
      '中国人民银行', '中央储备银行', '中储券', '贺岁', '奥林匹克', '国库券'];
    const cand = new Set(candidates);
    console.log('\n关键术语在**候选全表**里的情况（与本次 todo 无关，只看抽取口径）：');
    const missing = must.filter(t => !cand.has(t));
    for (const t of must) console.log(`  ${cand.has(t) ? '✓' : '✗'} ${t}`);
    if (missing.length) {
      console.log(`  ⚠ 缺失 ${missing.length} 个：${missing.join(' ')}`);
      console.log('    （语料里不存在的俗称靠对称化补键，不靠候选表）');
    }
    return;
  }

  let merged = Object.assign({}, existing.terms);
  let okBatches = 0, failBatches = 0, totalIn = 0, totalOut = 0;

  if (batches.length) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('\n✗ 环境变量 DEEPSEEK_API_KEY 未设置。');
      process.exit(1);
    }
    console.log(`      API key 已读取（长度 ${apiKey.length}，不显示内容）`);
    console.log('[4/5] 调用 LLM…');

    let cursor = 0;
    async function worker() {
      while (cursor < batches.length) {
        const my = cursor++;
        const batch = batches[my];
        const r = await callLLM(batch, apiKey);
        if (!r.ok) {
          failBatches++;
          console.log(`      批 ${my + 1}/${batches.length} 失败（${r.error}），跳过`);
          continue;
        }
        okBatches++;
        totalIn += r.usage.prompt_tokens || 0;
        totalOut += r.usage.completion_tokens || 0;
        for (const [term, list] of Object.entries(r.data)) {
          if (typeof term !== 'string' || !term) continue;
          // 只接受本来就属于这批候选的词，防止 LLM 编出新键
          if (!batch.includes(term)) continue;
          merged[term] = sanitize(term, list);
        }
        if ((okBatches + failBatches) % 20 === 0) {
          console.log(`      进度 ${okBatches + failBatches}/${batches.length} 批（成功 ${okBatches}）`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));

    console.log(`      完成：成功 ${okBatches} 批，失败 ${failBatches} 批`);
    if (totalIn || totalOut) console.log(`      实际用量：输入 ${totalIn.toLocaleString()}，输出 ${totalOut.toLocaleString()} tokens`);
  } else {
    console.log('[4/5] 无需调用 LLM。');
  }

  // ★ 种子白名单：人工验证过的条目永远优先（用户明确要求 LLM 不得覆盖）
  let whitelisted = 0;
  for (const [term, list] of Object.entries(VERIFIED)) {
    merged[term] = list.slice();
    whitelisted++;
  }

  // ★ 对称化：让语料里不存在的俗称也能当查询键（见函数上方注释）
  const before = Object.keys(merged).length;
  const symmetric = symmetrize(merged);
  const added = Object.keys(symmetric).length - before;

  // ★ 再覆盖一次白名单：对称化可能给白名单键补进额外项，白名单必须保持逐字不变
  for (const [term, list] of Object.entries(VERIFIED)) {
    symmetric[term] = list.slice();
  }

  console.log(`[5/5] 种子白名单覆盖 ${whitelisted} 条（LLM 结果不得改这些）`);
  console.log(`      对称化新增查询键 ${added} 个（语料里没出现过的俗称由此获得键）`);

  const withSyn = Object.entries(symmetric).filter(([, v]) => Array.isArray(v) && v.length > 0);
  console.log(`      表内术语 ${Object.keys(symmetric).length} 个，其中有同义词的 ${withSyn.length} 个`);

  // 关键自检：用户会敲、但语料里不存在的俗称，必须都成为键
  const mustKeys = ['生肖钞', '荷花钞', '央行', '储备', '号码', '奥运'];
  const keySet = new Set(Object.keys(symmetric));
  console.log(`      关键查询键自检：${mustKeys.map(t => (keySet.has(t) && symmetric[t].length ? '✓' : '✗') + t).join(' ')}`);

  merged = symmetric;

  // ★ 内容没变就**不要写文件**。
  //   否则每次运行都会刷新 generatedAt，而它是前端取表的 URL 版本号（?v=...）：
  //   版本一变，所有访客的缓存立即失效、重下 400KB 的表；workflow 还会为此产生
  //   一次其实什么都没改的提交。而"语料没变"时（增量跑出 todo=0）本来就没有
  //   任何新信息可写 —— 只有 generatedAt 自己变了，纯属自扰。
  //
  //   注意这里比的是**除 generatedAt 以外的全部内容**（含 corpus 指纹）：
  //   改了种子白名单 / 换了模型，payload 就会不同，照常写出去，不会被这道闸挡住。
  const corpus = {};
  for (const a of articles) corpus[a.file] = a.hash;
  const payload = {
    source: 'llm:' + MODEL,
    model: MODEL,
    corpus,
    terms: merged
  };
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'));
    const prevPayload = {
      source: prev.source,
      model: prev.model,
      corpus: prev.corpus || {},
      terms: prev.terms || {}
    };
    if (JSON.stringify(prevPayload) === JSON.stringify(payload)) {
      console.log(`\n⏸ 表内容与已有文件逐字一致（语料、模型、种子白名单都没变），跳过写入。`);
      console.log(`   generatedAt 保持 ${prev.generatedAt}，前端缓存不会被无谓地冲掉。`);
      return;
    }
  } catch (e) {
    // 旧表不存在 / 读不动 / 不是合法 JSON → 当作"必须写"，继续往下走
  }

  // 写文件。corpus 指纹一起存进去，供下次判断增量。
  const generatedAt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const table = {
    generatedAt,
    source: payload.source,
    model: payload.model,
    note: '由 collection/tools/build-synonyms.mjs 自动生成，请勿手改。种子白名单条目在脚本的 VERIFIED 常量里。corpus 是文章内容指纹，仅用于判断增量，前端不读。',
    corpus: payload.corpus,
    terms: payload.terms
  };
  writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n', 'utf8');
  if (outPath === TABLE_PATH) {
    writeFileSync(VERSION_PATH,
      '// 由 collection/tools/build-synonyms.mjs 自动生成，请勿手改。\n' +
      '// 用途：给 data/synonyms.json 提供 URL 版本号（?v=...），避免 CDN/浏览器缓存旧表。\n' +
      'window.__SYNONYMS_VERSION = ' + JSON.stringify(generatedAt) + ';\n', 'utf8');
  }

  console.log(`\n✅ 已写出 ${path.relative(ROOT, outPath)}（generatedAt=${generatedAt}）`);
  if (outPath === TABLE_PATH) console.log(`✅ 已写出 ${path.relative(ROOT, VERSION_PATH)}`);
  else console.log('（--out 指定，未改动 synonyms-version.js）');
}

main().catch(e => { console.error('✗ 失败：', (e && e.message) || e); process.exit(1); });
