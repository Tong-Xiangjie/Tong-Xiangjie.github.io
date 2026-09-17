// ==================== 生成文章搜索的「同义扩展」表 ====================
//
// 这张表让用户在文章板块里用俗称/简称也能搜到正式名称的文章，例如
//   央行   → 中央银行
//   号码   → 编号 / 数码
//   荷花   → 莲花 / 芙蓉
//
// ★ 数据源：哈工大《同义词词林扩展版》（人工编纂、带编码层级），直接查表。
//   早期版本是构建期调 DeepSeek 现编同义词，产量大但质量不可控 ——
//   实测产出里混着「息图」（从"全息图案"切出来的残片）这种根本不是词的碎片。
//   改用词林后不存在这类垃圾，而且完全离线、确定性、无 API Key、无费用。
//
// 相似度算法见 ./cilin.mjs（田久乐 2010），本脚本只负责：
//   ① 从语料里取"哪些词真的出现在文章里"；
//   ② 按阈值把词林里的相关词收敛成扩展表；
//   ③ 用「内容没变就不重写文件」防止白刷 generatedAt 把用户缓存全冲掉。
//
// 用法：
//   node collection/tools/build-synonyms.mjs                # 生成
//   node collection/tools/build-synonyms.mjs --dry-run      # 只看统计，不写文件
//   node collection/tools/build-synonyms.mjs --threshold 1  # 只保留真同义（同原子词群）
//   node collection/tools/build-synonyms.mjs --out x.json   # 写到别处

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCilin, simByCode } from './cilin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CILIN_PATH = path.join(__dirname, 'cilin_ex.txt');
const TABLE_PATH = path.join(ROOT, 'collection', 'data', 'synonyms.json');
const VERSION_PATH = path.join(ROOT, 'collection', 'data', 'synonyms-version.js');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = (name) => argv.includes('--' + name);

// 相似度阈值。词林里：
//   1.0  = 同一原子词群且标记 '='  → 真同义词
//   ~0.9 = 同一词群（第 4 层相同）→ 近义词
//   0.5  = 同一原子词群但标记 '#'  → "同类词"，组可以大到上百个（奥运 那组有 119 个
//          「…会」，全是会议名），放进来会把结果冲垮，所以阈值 0.9 正好把它们挡在外面
//
// ★ 默认取 1.0（纯同义词），这是**发布口径**，别再改回 0.9：
//   CI 跑的就是本脚本的默认值（workflow 不传 --threshold），默认值一旦和生产口径
//   不一致，机器人就会把另一版表提交上去 —— 这坑真踩过一次（2026-09-17：
//   默认 0.9 而仓库里放的是 1.0，workflow 一跑就把表换成了 0.9 那版）。
//   实测 0.9 与 1.0 在五用例上的结果**完全相同**，但 0.9 多 10,300 条约 229 KB、
//   且带回「大会」「生命线」这类词群兄弟的噪音，所以 1.0 更划算。
const THRESHOLD = parseFloat(flag('threshold', '1'));
const MAX_SYNONYMS_PER_TERM = parseInt(flag('max', '8'), 10);
const MIN_LEN = 2;
const MAX_LEN = 8;              // 词林里最长的是「奥林匹克运动会」这类，8 字足够

// 泛词黑名单：这些词在语料里几乎每篇都有，作为扩展词放进来会把结果冲垮。
// 词林不会产生"假词"，但会把"真词但太泛"的词带进来（纪念币 → 纪念 之类），所以这层仍然要。
const STOPWORDS = new Set([
  '银行', '中国', '纪念', '纸币', '钞票', '收藏', '发行', '人民币', '国家', '图案',
  '正面', '背面', '设计', '面值', '年份', '数量', '规格', '材质', '价格', '市场',
  '特点', '特征', '介绍', '概况', '历史', '文化', '价值', '意义', '相关', '以及',
  '进行', '通过', '由于', '因此', '但是', '而且', '我们', '他们', '可以', '这个',
  '那个', '一个', '什么', '怎么', '已经', '还有', '就是', '不是', '这些', '那些'
]);

const HAN_RUN = /[\u4e00-\u9fa5]+/g;

// ---------- 语料 ----------
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
      // ★ 指纹算在"真正决定词表的文本"上（去 HTML 标签后的正文、去掉全部空白），
      //   **不是**原始字节。原因是原始字节在不同平台/不同检出配置下根本不一致：
      //   本仓库里一部分 readme 以 CRLF 存、一部分以 LF 存，而 Windows 的
      //   core.autocrlf 又会在检出时把 LF 那批转成 CRLF。于是
      //     · 仓库存 CRLF 的文件：工作区字节 == 仓库字节
      //     · 仓库存 LF   的文件：工作区字节 == 仓库字节再转 CRLF
      //   任何"单一换行归一"都无法同时对上这两种情况（实测过：CRLF→LF 归一
      //   后本地仍得到 ccb28ab1…，而 CI 是 138e627e…）。
      //   这个指纹参与"内容逐字没变就不重写文件"的比较（见下面 strip()），
      //   跨平台不一致会让 CI **每一次**都认为表变了 → 重写表 → 刷新 generatedAt
      //   → 把全部访客的缓存冲掉，机器人还会反复提交、来回换表。
      //   去掉空白后换行差异消失，且词表本来就是从"纯汉字 n-gram"抽的，
      //   空白对结果毫无影响 —— 所以这才是与产物真正对应的指纹。
      hash: createHash('sha1').update(text.replace(/\s+/g, '')).digest('hex').slice(0, 16)
    };
  }).filter(a => a.text.trim());
}

function ngramsInto(text, set) {
  const runs = text.match(HAN_RUN) || [];
  for (const run of runs) {
    for (let n = MIN_LEN; n <= MAX_LEN; n++) {
      for (let i = 0; i + n <= run.length; i++) set.add(run.substr(i, n));
    }
  }
}

// ---------- 主流程 ----------
function main() {
  const t0 = Date.now();

  const articles = collectCorpus();
  if (!articles.length) {
    console.error('✗ 没找到任何语料，检查 notecollection/coincollection/funcollection 下的 readmes');
    process.exit(1);
  }
  const corpusHash = createHash('sha1')
    .update(articles.map(a => `${a.file}:${a.hash}`).join('\n')).digest('hex').slice(0, 16);

  // 词表 = 语料里真实出现过的 2~8 字汉字串；df 用于给扩展词排序（语料里越常见越有用）
  const df = new Map();
  for (const a of articles) {
    const seen = new Set();
    ngramsInto(a.text, seen);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const vocab = df;   // 有键即"出现过"

  const tool = loadCilin(readFileSync(CILIN_PATH, 'utf8'));
  console.log(`语料 ${articles.length} 篇 / 词表 ${vocab.size} 条 / 词林 ${tool.codes.size} 词（${Date.now() - t0} ms）`);
  if (tool.duplicateLines) {
    console.log(`  · 词林里有 ${tool.duplicateLines} 行同码重复（词典自身的数据错误），已用合成编码隔离`);
  }

  // ① 编码 → 相关编码（相似度 >= 阈值），按第 4 层前缀分桶以免两两全比
  const byL4 = new Map();
  for (const code of tool.groups.keys()) {
    if (tool.isolated.has(code)) continue;
    const k = code.slice(0, 5);
    const arr = byL4.get(k);
    if (arr) arr.push(code); else byL4.set(k, [code]);
  }
  const related = new Map();
  for (const codes of byL4.values()) {
    for (const a of codes) {
      const out = [a];
      for (const b of codes) if (a !== b && simByCode(a, b, tool.tree) >= THRESHOLD) out.push(b);
      related.set(a, out);
    }
  }

  // 组内相似度：'=' 表同义（1.0），'#' 表同类（0.5，低于阈值即自动被排除）
  const ownSim = (code) => code.endsWith('=') ? 1 : (code.endsWith('#') ? 0.5 : 0.1);

  // ② 逐词收敛
  const terms = {};
  let kept = 0, droppedByVocab = 0, droppedByStop = 0;
  for (const [w, codeList] of tool.codes) {
    if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
    if (STOPWORDS.has(w)) continue;

    const scored = new Map();   // 扩展词 → 最高相似度
    for (const c of codeList) {
      const bucket = tool.isolated.has(c) ? [c] : (related.get(c) || [c]);
      for (const c2 of bucket) {
        const s = (c2 === c) ? ownSim(c) : simByCode(c, c2, tool.tree);
        if (s < THRESHOLD) continue;
        for (const w2 of tool.groups.get(c2) || []) {
          if (w2 === w || STOPWORDS.has(w2)) { if (w2 !== w) droppedByStop++; continue; }
          if (w2.length < MIN_LEN || w2.length > MAX_LEN) continue;
          if (!vocab.has(w2)) { droppedByVocab++; continue; }
          const prev = scored.get(w2);
          if (prev === undefined || s > prev) scored.set(w2, s);
        }
      }
    }
    if (!scored.size) continue;

    const list = [...scored.entries()]
      .sort((a, b) => (b[1] - a[1])                                  // 相似度高的在前
        || ((df.get(b[0]) || 0) - (df.get(a[0]) || 0))               // 语料里常见的在前
        || (a[0].length - b[0].length)
        || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_SYNONYMS_PER_TERM)
      .map(x => x[0]);
    terms[w] = list;
    kept++;
  }

  const payload = {
    generatedAt: new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z'),
    source: `cilin:WordSimilarity2010@${THRESHOLD}`,
    corpus: { articles: articles.length, hash: corpusHash, vocab: vocab.size },
    dropped: { notInCorpus: droppedByVocab, stopword: droppedByStop },
    terms
  };

  const totalLinks = Object.values(terms).reduce((n, l) => n + l.length, 0);
  console.log(`阈值 ${THRESHOLD}：${kept} 个查询词有扩展，共 ${totalLinks} 条映射`
    + `（平均 ${(totalLinks / Math.max(1, kept)).toFixed(2)} 条/词）`);
  console.log(`  被丢弃：不在语料里 ${droppedByVocab} 次 / 泛词 ${droppedByStop} 次`);

  const json = JSON.stringify(payload);
  console.log(`  体积 ${(Buffer.byteLength(json, 'utf8') / 1024).toFixed(1)} KB（${Date.now() - t0} ms）`);

  if (has('dry-run')) {
    console.log('  --dry-run：不写文件');
    show(terms);
    return;
  }

  // ★ 内容没变就不重写：generatedAt 是前端的缓存版本号（?v=…），
  //   白写一次会让所有访客重下整张表。所以先逐字比对（含 generatedAt 之外的全部字段）。
  const strip = (o) => JSON.stringify({ source: o.source, corpus: o.corpus, dropped: o.dropped, terms: o.terms });
  if (existsSync(TABLE_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(TABLE_PATH, 'utf8'));
      if (strip(prev) === strip(payload)) {
        console.log('⏸ 表内容与已有文件逐字一致，跳过写入（保留原 generatedAt，避免刷掉访客缓存）');
        show(terms);
        return;
      }
    } catch { /* 旧文件坏了就正常重写 */ }
  }

  writeFileSync(TABLE_PATH, json, 'utf8');
  writeFileSync(VERSION_PATH,
    `// 自动生成，请勿手改。构建脚本：collection/tools/build-synonyms.mjs\n`
    + `// 前端的取表地址带 ?v=<这个值>，用来在表更新后让访客拿到新表。\n`
    + `window.__SYNONYMS_VERSION = '${payload.generatedAt}';\n`, 'utf8');
  console.log(`✓ 已写入 ${path.relative(ROOT, TABLE_PATH)} 与 ${path.relative(ROOT, VERSION_PATH)}`);
  show(terms);
}

function show(terms) {
  const samples = ['央行', '号码', '荷花', '生肖', '奥运', '银元', '水印', '纪念币', '储备'];
  console.log('\n  抽样：');
  for (const s of samples) {
    console.log(`    ${s} → ${terms[s] ? terms[s].join(' / ') : '（无扩展）'}`);
  }
}

main();
