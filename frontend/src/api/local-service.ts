import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CLEANING_DONE,
  PIPE_CLEANING_KEY,
  decorateCleaningRow,
  describeCleaning,
  validateCleaningDraft,
  type CleaningDraft,
} from '@/data/pipe-cleaning'
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

/**
 * 读取时的统一口径：管道清洗的任何入口（列表/详情/导出/看板）都先经过同一纯函数装饰，
 * 得到的状态与复查结论必然一致；装饰只产生新对象，不改存储里的原始数据。
 */
function presentRow(key: string, row: EntryRow): EntryRow {
  return key === PIPE_CLEANING_KEY ? decorateCleaningRow(row) : row
}

export function presentRows(key: string, rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => presentRow(key, row))
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
  const matched = filterRows(presentRows(key, listRows(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 详情入口：与列表完全相同的口径，避免详情和列表显示成两个结果。 */
export function getEntry(key: string, id: number): EntryRow | null {
  const row = listRows(key).find((item) => Number(item.id) === id)
  return row ? presentRow(key, row) : null
}

/** 登记一条管道清洗记录；校验（含日期倒挂）不通过时返回错误，不写任何数据。 */
export function createCleaningEntry(draft: CleaningDraft): ActionResult {
  const rows = listRows(PIPE_CLEANING_KEY)
  const message = validateCleaningDraft(draft, rows)
  if (message) {
    return { ok: false, message }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = {
    id: nextId,
    status: initialCleaningStatus(draft),
    pending: !draft.实际日期.trim(),
    abnormal: false,
    清洗编号: draft.清洗编号.trim(),
    清洗管段: draft.清洗管段.trim(),
    清洗方式: draft.清洗方式.trim(),
    清洗设备: draft.清洗设备.trim(),
    计划日期: draft.计划日期.trim(),
    实际日期: draft.实际日期.trim(),
    清洗长度: draft.清洗长度.trim(),
    清洗状态: '',
  }
  // 存储后再用统一口径呈现，保证列表/详情/导出立即得到同一结论。
  saveRows(PIPE_CLEANING_KEY, [...rows, created])
  const presented = decorateCleaningRow(created)
  return { ok: true, message: `管道清洗记录已登记，当前状态「${presented.status}」` }
}

// 新增记录入库时的初始流转状态只由日期决定：有实际日期即已完成，否则待清洗。
// 「需复查」永远由日期倒挂在读取时推导，且倒挂数据在登记时已被拦截，不会被写入。
function initialCleaningStatus(draft: CleaningDraft): string {
  return draft.实际日期.trim() ? CLEANING_DONE : '待清洗'
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

  if (key === PIPE_CLEANING_KEY) {
    return runCleaningAction(meta, rows, index, action, target)
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

// 管道清洗的流转同样以日期推导的唯一状态为准，防止「已是 X 不用重复操作」与页面显示打架。
// 只改流转状态字段，原始计划/实际日期一律不动；日期倒挂记录的结论始终是「需复查」。
function runCleaningAction(
  meta: ModuleMeta,
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
): ActionResult {
  const raw = rows[index]
  const summary = describeCleaning(raw)

  if (summary.status === '需复查') {
    return {
      ok: false,
      message: '该记录实际日期早于计划日期，需先复查并修正日期，不能继续状态流转',
    }
  }
  if (target === CLEANING_DONE && !summary.actualDate) {
    return {
      ok: false,
      message: '尚未录入实际日期，不能确认完成；请先补录不早于计划日期的实际日期',
    }
  }
  if (summary.status === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const next = [...rows]
  next[index] = { ...raw, status: target }
  saveRows(PIPE_CLEANING_KEY, next)
  const shown = describeCleaning(next[index]).status
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${shown}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// CSV 单元格转义：含逗号、引号、换行的值用双引号包起来；管道清洗的状态列同样走统一口径。
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of presentRows(key, listRows(key))) {
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
    const presented = presentRows(meta.key, entries)
    return {
      name: meta.name,
      created: entries.length,
      pending: presented.filter((row) => row.pending).length,
      abnormal: presented.filter((row) => row.abnormal).length,
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
