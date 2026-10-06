import { MODULE_BY_KEY } from '@/data/modules'
import {
  ACTUAL_DATE_FIELD,
  PLAN_DATE_FIELD,
  deriveCleaningStatus,
  validateCleaningDates,
} from '@/data/cleaning'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function getEntry(key: string, id: number): EntryRow | null {
  const rows = listRows(key)
  return rows.find((row) => Number(row.id) === id) ?? null
}

export type CreateOutcome = ActionResult & { id?: number }

/**
 * 通用登记入口：各模块的字段合法性校验在这里集中处理。
 * 管道清洗只校验日期规则（空日期保留、实际日期不得早于计划日期）。
 */
export function createEntry(key: string, input: Record<string, string>): CreateOutcome {
  const meta = moduleMeta(key)
  const fields: Record<string, string> = {}
  for (const field of meta.fields) {
    const value = (input[field] ?? '').trim()
    fields[field] = value
  }

  if (key === 'pipe_cleaning') {
    const dateError = validateCleaningDates(fields[PLAN_DATE_FIELD], fields[ACTUAL_DATE_FIELD])
    if (dateError) {
      return { ok: false, message: dateError }
    }
  }

  const codeField = meta.fields[0]
  if (fields[codeField] === '') {
    return { ok: false, message: `${meta.fields[0]}不能为空` }
  }
  const rows = listRows(key)
  if (rows.some((row) => String(row[codeField] ?? '') === fields[codeField])) {
    return { ok: false, message: `${meta.fields[0]}「${fields[codeField]}」已存在，不能重复登记` }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = { id, status: '', pending: false, abnormal: false, ...fields }
  saveRows(key, [...rows, created])
  // saveRows 已按领域规则归一化状态，回读一次拿到最终结论，保证与列表/详情一致。
  const stored = getEntry(key, id)
  return {
    ok: true,
    id,
    message: `${meta.entity}已登记，当前状态「${stored ? deriveCleaningStatus(stored).status : ''}」`,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** 管道清洗详情：状态与原因和列表、导出使用同一个推导结果。 */
export function cleaningDetail(
  id: number,
): { row: EntryRow; status: string; reason: string } | null {
  const row = getEntry('pipe_cleaning', id)
  if (!row) {
    return null
  }
  const derived = deriveCleaningStatus(row)
  return { row, status: derived.status, reason: derived.reason }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const isCleaning = key === 'pipe_cleaning'
  // 导出不再直接带上原始的「清洗状态」自由文本，
  // 改为与列表、详情一致的推导结论「复查状态」，并附上复查说明。
  const header = isCleaning
    ? ['编号', ...meta.fields.filter((field) => field !== '清洗状态'), '复查状态', '复查说明']
    : ['编号', ...meta.fields, '当前状态']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const row of listRows(key)) {
    if (isCleaning) {
      const derived = deriveCleaningStatus(row)
      const cells = [
        row.id,
        ...meta.fields
          .filter((field) => field !== '清洗状态')
          .map((field) => row[field] ?? ''),
        derived.status,
        derived.reason,
      ]
      lines.push(cells.map(csvCell).join(','))
      continue
    }
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
