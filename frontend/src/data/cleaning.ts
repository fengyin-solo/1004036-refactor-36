import type { EntryRow } from '@/data/types'

/**
 * 管道清洗的领域规则：计划日期、实际日期与复查状态只在这里计算一次，
 * 列表、导出、详情、登记表单必须共用同一套结论，禁止各自再算一遍。
 */

export const PLAN_DATE_FIELD = '计划日期'
export const ACTUAL_DATE_FIELD = '实际日期'

export const CLEANING_STATUSES = ['待清洗', '清洗中', '已完成', '需复查'] as const
export type CleaningStatus = (typeof CLEANING_STATUSES)[number]

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 空日期统一保留为空字符串，不回填任何占位值。 */
export function normalizeDate(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const text = String(value).trim()
  return text
}

/** 严格校验 YYYY-MM-DD，拒绝 2026-2-1、2026-13-40 这类非法日期。 */
export function isValidDate(value: unknown): boolean {
  const text = normalizeDate(value)
  if (text === '') {
    return false
  }
  const matched = DATE_PATTERN.exec(text)
  if (!matched) {
    return false
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12) {
    return false
  }
  const daysInMonth = new Date(year, month, 0).getDate()
  return day >= 1 && day <= daysInMonth
}

/** ISO 日期字符串按天比较，避免 new Date('YYYY-MM-DD') 的时区偏移。 */
export function compareDate(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

export type CleaningDerivation = {
  status: CleaningStatus
  /** 复查结论不通过时给出明确原因，列表/详情/导出展示同一句话。 */
  reason: string
  actualBeforePlan: boolean
  hasInvalidDate: boolean
}

/**
 * 复查状态的唯一推导入口（纯函数，不读存储、不写存储）：
 * - 两个日期都为空：待清洗（空日期原样保留）
 * - 只有计划日期：清洗中
 * - 有实际日期且不早于计划日期（含计划为空）：已完成
 * - 实际日期早于计划日期，或日期无法解析：需复查
 */
export function deriveCleaningStatus(row: Pick<EntryRow, string>): CleaningDerivation {
  const planDate = normalizeDate(row[PLAN_DATE_FIELD])
  const actualDate = normalizeDate(row[ACTUAL_DATE_FIELD])

  const planValid = planDate === '' || isValidDate(planDate)
  const actualValid = actualDate === '' || isValidDate(actualDate)
  if (!planValid || !actualValid) {
    return {
      status: '需复查',
      reason: '日期格式无法识别，需复查',
      actualBeforePlan: false,
      hasInvalidDate: true,
    }
  }

  if (actualDate !== '' && planDate !== '' && compareDate(actualDate, planDate) < 0) {
    return {
      status: '需复查',
      reason: `实际日期 ${actualDate} 早于计划日期 ${planDate}，需复查`,
      actualBeforePlan: true,
      hasInvalidDate: false,
    }
  }

  if (actualDate === '' && planDate === '') {
    return { status: '待清洗', reason: '', actualBeforePlan: false, hasInvalidDate: false }
  }
  if (actualDate === '') {
    return { status: '清洗中', reason: '', actualBeforePlan: false, hasInvalidDate: false }
  }
  return { status: '已完成', reason: '', actualBeforePlan: false, hasInvalidDate: false }
}

/**
 * 登记/修改时的日期校验：实际日期早于计划日期必须明确报错，
 * 非空但无法解析的日期同样拒绝；空日期允许保留为空。
 * 返回 null 表示通过，否则返回可直接展示的错误信息。
 */
export function validateCleaningDates(
  planDate: string,
  actualDate: string,
): string | null {
  const plan = normalizeDate(planDate)
  const actual = normalizeDate(actualDate)

  if (plan !== '' && !isValidDate(plan)) {
    return `计划日期「${plan}」不是有效的 YYYY-MM-DD 日期`
  }
  if (actual !== '' && !isValidDate(actual)) {
    return `实际日期「${actual}」不是有效的 YYYY-MM-DD 日期`
  }
  if (actual !== '' && plan !== '' && compareDate(actual, plan) < 0) {
    return `实际日期 ${actual} 早于计划日期 ${plan}，不允许保存`
  }
  return null
}
