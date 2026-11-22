#!/usr/bin/env node
/**
 * 合成一个最小但完全符合官方 export_format_version 3 的 ZIP。
 *
 * 目的：既然 mini-3（裁自官方原包）都被拒，而官方原包本身状态未定，
 * 就造一个"结构最简单、每个字段都由我按官方格式手写"的包。
 * 如果它能过，说明格式要求已掌握，问题在具体数据；
 * 如果它也过不了，说明格式还有我没看懂的地方，而且和我的数据无关。
 *
 * 用法: node tools/make-synthetic-archive.mjs <输出ZIP> [变体名]
 */

import { writeZip } from './zip-writer.mjs';

const out = process.argv[2];
if (!out) { console.error('用法: node tools/make-synthetic-archive.mjs <输出ZIP>'); process.exit(1); }

const SID = '11111111-2222-3333-4444-555555555555';
const now = '2026-11-22T08:00:00.000Z';

/**
 * 一条消息。严格按照用户真实导出里的字段写：
 *   USER      : { content(字符串), createdAt, files, id, parentId, role, selectedChildId, thinkingEnabled, searchEnabled, tokens }
 *   ASSISTANT : { blocks(数组), createdAt, id, latestReminder, model, parentId, prefix, role, search, status, thinking }
 */
function userMsg(id, parentId, text) {
  return {
    content: text,
    createdAt: now,
    files: [],
    id: String(id),
    parentId: parentId == null ? null : String(parentId),
    role: 'USER',
    selectedChildId: String(id + 1),
    thinkingEnabled: false,
    searchEnabled: false,
    tokens: 5
  };
}
function assistantMsg(id, parentId, text) {
  return {
    blocks: [{ type: 'text', content: text }],
    createdAt: now,
    id: String(id),
    latestReminder: null,
    model: 'deepseek-chat',
    parentId: String(parentId),
    prefix: false,
    role: 'ASSISTANT',
    search: false,
    status: 'done',
    thinking: null
  };
}

export function buildSynthetic(overrides = {}) {
  const messages = [
    userMsg(1, null, '你好，这是一条测试消息。'),
    assistantMsg(2, 1, '你好！这是助手的回复。')
  ];
  const session = {
    id: SID,
    title: '合成测试对话',
    pinned: false,
    current_message_id: '2',
    inserted_at: now,
    updated_at: now,
    messages,
    ...overrides.session
  };
  const index = [{
    id: SID,
    title: '合成测试对话',
    pinned: false,
    message_count: 2,
    inserted_at: now,
    updated_at: now,
    ...overrides.index
  }];
  const manifest = { export_format_version: 3, ...overrides.manifest };
  const user = { id: 'u-1', name: '测试用户', ...overrides.user };
  return { manifest, user, index, session };
}

const data = buildSynthetic();
const entries = [
  { name: 'manifest.json', data: JSON.stringify(data.manifest) },
  { name: 'user.json', data: JSON.stringify(data.user) },
  { name: 'chat_session_index.json', data: JSON.stringify(data.index) },
  { name: `chat_sessions/${SID}.json`, data: JSON.stringify(data.session) }
];
const info = writeZip(out, entries, { versionNeeded: 20 });
console.log('写出: ' + out);
console.log('  条目: ' + info.list.join(', '));
console.log('  大小: ' + info.bytes + ' 字节');
console.log('  manifest: ' + JSON.stringify(data.manifest));
