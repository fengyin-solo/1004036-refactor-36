import { deriveCleaningStatus } from './cleaning'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

/**
 * 模块级状态归一化：状态只允许由领域规则推导，禁止各页面各写各的。
 * 历史数据在首次读取时也走这里，保证老记录和新记录结论一致。
 */
const STATUS_NORMALIZERS: Record<string, (row: EntryRow) => EntryRow> = {
  pipe_cleaning: (row) => {
    const derived = deriveCleaningStatus(row)
    return {
      ...row,
      status: derived.status,
      pending: derived.status === '待清洗' || derived.status === '清洗中',
      abnormal: derived.status === '需复查',
    }
  },
}

function normalizeRow(key: string, row: EntryRow): { row: EntryRow; changed: boolean } {
  const normalizer = STATUS_NORMALIZERS[key]
  if (!normalizer) {
    return { row, changed: false }
  }
  const normalized = normalizer(row)
  const changed =
    normalized.status !== row.status ||
    normalized.pending !== row.pending ||
    normalized.abnormal !== row.abnormal
  return { row: normalized, changed }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * 按 id 去重：同一 id 只保留第一次出现的记录，后续重复记录只用来补齐
 * 前面缺失（空）的字段，任何已有的原始值都不会被覆盖或丢弃。
 * 返回去重后的数组以及是否真的发生过合并。
 */
function dedupeRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  const byId = new Map<number, EntryRow>()
  let changed = false
  for (const row of rows) {
    const id = Number(row.id)
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, { ...row, id })
      continue
    }
    changed = true
    const merged = { ...existing }
    for (const [field, value] of Object.entries(row)) {
      if (field === 'id' || !isEmptyValue(merged[field]) || isEmptyValue(value)) {
        continue
      }
      merged[field] = value
    }
    byId.set(id, merged)
  }
  return { rows: [...byId.values()], changed }
}

/**
 * 读取归一化：状态统一由领域规则推导 + 按 id 去重。只在结果与已存数据
 * 不一致时落盘一次，之后重复打开、返回、导出都只是读取，不改状态。
 */
function normalizeStorage(raw: Record<string, EntryRow[]>): {
  data: Record<string, EntryRow[]>
  changed: boolean
} {
  let changed = false
  const data: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(raw)) {
    const result = dedupeRows(rows)
    const normalized = result.rows.map((row) => {
      const outcome = normalizeRow(key, row)
      if (outcome.changed) {
        changed = true
      }
      return outcome.row
    })
    data[key] = normalized
    changed = changed || result.changed
  }
  return { data, changed }
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeStorage(fallback).data
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = normalizeStorage(fallback).data
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const result = normalizeStorage(merged)
    // 只在首次发现重复时落盘一次，之后打开、返回、导出都不再写数据。
    if (result.changed) {
      persist(result.data)
    }
    return result.data
  } catch {
    const seeded = normalizeStorage(fallback).data
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 写入同样走归一化：任何入口保存的管道清洗记录，状态都由领域规则决定，
  // 同时顺手去重，避免重复保存制造出重复记录。
  const normalizedRows = dedupeRows(rows).rows.map((row) => normalizeRow(key, row).row)
  const next = { ...allRows(), [key]: normalizedRows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
