import Dexie from 'dexie'

// Dexie v4 正确用法
export const db = new Dexie('squat-coach-db', {
  // v4 构造函数需要传入第二个参数定义 schema
})

// 定义表 schema（v4 推荐方式）
db.version(1).stores({
  // ++id = 自增主键
  records: '++id, createdAt, totalCount, poseScore, poseRating',
})

// 如果之前 schema 有变更，加新 version 做迁移
// db.version(2).stores({ ... })

export async function saveRecord(record) {
  record.createdAt = record.createdAt || Date.now()
  // 防止重复保存（同一个 session 内结果可能会尝试多次写入）
  return await db.records.add(record)
}

export async function getAllRecords() {
  return await db.records.orderBy('createdAt').reverse().toArray()
}

export async function deleteRecord(id) {
  return await db.records.delete(id)
}

export async function clearAllRecords() {
  return await db.records.clear()
}

export async function importRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return 0
  // 批量添加，不覆盖已存在的（避免 import 冲突）
  const keys = await db.records.bulkAdd(records, { allKeys: true })
  return keys.length
}

export async function exportAllRecords() {
  const records = await getAllRecords()
  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    records,
  }
}

// 用于修复旧版本残留数据库的 helper
export async function resetDb() {
  await db.delete()
  await db.open()
}
