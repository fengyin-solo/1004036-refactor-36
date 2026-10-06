import type { EntryRow } from './types'

// 管道清洗模块的唯一状态口径。
// 列表、详情、导出、看板的状态与复查结论都必须从这里推导，不允许在各页面各算一遍，
// 也不允许把推导结果写回存储：存储只保留原始字段（计划日期/实际日期等），推导永远是纯函数。

export const PIPE_CLEANING_KEY = 'pipe_cleaning'

export const PLAN_DATE_FIELD = '计划日期'
export const ACTUAL_DATE_FIELD = '实际日期'
export const CLEANING_STATUS_FIELD = '清洗状态'

export const CLEANING_PENDING = '待清洗'
export const CLEANING_RUNNING = '清洗中'
export const CLEANING_DONE = '已完成'
export const CLEANING_REVIEW = '需复查'

export const CLEANING_STATUSES = [
  CLEANING_PENDING,
  CLEANING_RUNNING,
  CLEANING_DONE,
  CLEANING_REVIEW,
] as const

export type CleaningStatus = (typeof CLEANING_STATUSES)[number]

export type CleaningSummary = {
  /** 归一化后的计划日期（空值保留为空字符串）。 */
  planDate: string
  /** 归一化后的实际日期（空值保留为空字符串）。 */
  actualDate: string
  /** 唯一结论状态：任何入口看到的状态都来自这里。 */
  status: CleaningStatus
  /** 复查状态：实际日期早于计划日期时为 true。 */
  needsReview: boolean
  /** 给详情页用的复查说明。 */
  reviewNote: string
  pending: boolean
  abnormal: boolean
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 取日期文本：只做 trim，空日期一律保留为空字符串，不用占位符顶替。 */
export function dateText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

/** 校验 yyyy-MM-dd 且必须是真实存在的日期（拒绝 2026-02-31 这类值）。 */
export function isValidDateText(value: string): boolean {
  const matched = DATE_PATTERN.exec(value)
  if (!matched) {
    return false
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1) {
    return false
  }
  const probe = new Date(year, month - 1, day)
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  )
}

/**
 * 比较两个 yyyy-MM-dd 日期：
 * 左早于右返回 -1，相等返回 0，左晚于右返回 1；任一为空或格式非法返回 null。
 */
export function compareDateText(left: string, right: string): number | null {
  if (!left || !right || !isValidDateText(left) || !isValidDateText(right)) {
    return null
  }
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

/**
 * 由原始数据推导唯一结论。规则固定如下，历史记录和新增记录走完全相同的判断：
 * - 实际日期早于计划日期：需复查（异常，优先级最高）；
 * - 已填写实际日期且不存在日期倒挂：已完成；
 * - 实际日期为空：沿用流转中的「清洗中」，否则为「待清洗」；
 * - 空日期始终保留为空，不会被填成今天或任何占位值。
 */
export function describeCleaning(input: {
  [field: string]: string | number | boolean
}): CleaningSummary {
  const planDate = dateText(input[PLAN_DATE_FIELD])
  const actualDate = dateText(input[ACTUAL_DATE_FIELD])

  let status: CleaningStatus
  if (actualDate && planDate) {
    const cmp = compareDateText(actualDate, planDate)
    status = cmp !== null && cmp < 0 ? CLEANING_REVIEW : CLEANING_DONE
  } else if (actualDate) {
    // 有实际日期、计划日期为空时不存在倒挂可能。
    status = CLEANING_DONE
  } else {
    const stored = dateText(input.status)
    status =
      stored === CLEANING_RUNNING || stored === CLEANING_PENDING
        ? (stored as CleaningStatus)
        : CLEANING_PENDING
  }

  const needsReview = status === CLEANING_REVIEW
  const reviewNote = needsReview
    ? '实际日期早于计划日期，数据倒挂，必须安排复查'
    : actualDate
      ? '实际日期不早于计划日期，复查通过'
      : '尚未录入实际日期，暂不涉及复查'

  return {
    planDate,
    actualDate,
    status,
    needsReview,
    reviewNote,
    pending: status === CLEANING_PENDING || status === CLEANING_RUNNING,
    abnormal: needsReview,
  }
}

/**
 * 用唯一口径装饰一行记录：返回新对象，绝不修改入参、绝不写回存储。
 * 「当前状态」与字段「清洗状态」取自同一结论，列表和详情不会再显示成两个结果。
 */
export function decorateCleaningRow(row: EntryRow): EntryRow {
  const summary = describeCleaning(row)
  return {
    ...row,
    status: summary.status,
    pending: summary.pending,
    abnormal: summary.abnormal,
    [PLAN_DATE_FIELD]: summary.planDate,
    [ACTUAL_DATE_FIELD]: summary.actualDate,
    [CLEANING_STATUS_FIELD]: summary.status,
  }
}

export type CleaningDraft = {
  清洗编号: string
  清洗管段: string
  清洗方式: string
  清洗设备: string
  计划日期: string
  实际日期: string
  清洗长度: string
}

/**
 * 登记前校验。返回错误消息；没有问题返回 null。
 * 实际日期早于计划日期必须在此明确报错，禁止倒挂数据进入系统。
 */
export function validateCleaningDraft(
  draft: CleaningDraft,
  existing: EntryRow[],
): string | null {
  const code = draft.清洗编号.trim()
  if (!code) {
    return '清洗编号不能为空'
  }
  if (existing.some((row) => dateText(row.清洗编号) === code)) {
    return `清洗编号 ${code} 已存在，不能重复登记`
  }

  const planDate = dateText(draft.计划日期)
  const actualDate = dateText(draft.实际日期)
  if (planDate && !isValidDateText(planDate)) {
    return '计划日期格式不正确，需为 yyyy-MM-dd 的真实日期'
  }
  if (actualDate && !isValidDateText(actualDate)) {
    return '实际日期格式不正确，需为 yyyy-MM-dd 的真实日期'
  }
  if (planDate && actualDate) {
    const cmp = compareDateText(actualDate, planDate)
    if (cmp !== null && cmp < 0) {
      return `实际日期（${actualDate}）不能早于计划日期（${planDate}），请核对后重新登记`
    }
  }
  return null
}
