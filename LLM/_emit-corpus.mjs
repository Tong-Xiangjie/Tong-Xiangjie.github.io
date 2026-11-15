// 把 corpus 源文件里的文本抽出来，生成 index-v2.html 用的内联数据（构建脚本，可保留）
import { readFileSync, writeFileSync } from 'node:fs';
import { CLASSIC, PLAIN } from './corpus.js';
import { CLASSIC_EXTRA, PLAIN_EXTRA } from './corpus-extra.js';

const parts = { CLASSIC, PLAIN, CLASSIC_EXTRA, PLAIN_EXTRA };
const text = CLASSIC + '\n' + PLAIN + '\n' + CLASSIC_EXTRA + '\n' + PLAIN_EXTRA;
// 校验：不能包含反引号、${、反斜杠，否则不能直接塞进模板字符串
for (const [name, v] of Object.entries(parts)) {
  for (const bad of ['`', '${', '\\']) {
    if (v.includes(bad)) throw new Error(`${name} 含有不能在模板字符串里出现的字符: ${JSON.stringify(bad)}`);
  }
}
writeFileSync(new URL('./_corpus-inline.txt', import.meta.url), text, 'utf8');
console.log('已写出 _corpus-inline.txt，长度', text.length, '字（含换行）');
