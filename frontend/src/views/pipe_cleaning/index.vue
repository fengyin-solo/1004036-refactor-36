<template>
  <section class="page" data-module="pipe_cleaning">
    <header class="page-head">
      <div>
        <h2>管道清洗管理</h2>
        <p class="page-desc">维护管道清洗记录，围绕清洗编号、清洗管段、清洗方式、清洗设备做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管道清洗记录</button>
        <button class="btn" type="button" @click="exportRows">导出管道清洗清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>复查状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>
            {{ derive(row).status }}
            <span v-if="derive(row).reason" class="error-text">（{{ derive(row).reason }}）</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/pipe_cleaning/${row.id}`">查看详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管道清洗数据，可先登记管道清洗记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道清洗记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记管道清洗记录</h3>
        <label v-for="field in formFields" :key="field" class="form-item">
          <span>{{ field }}{{ field === '清洗编号' ? ' *' : '' }}</span>
          <input
            v-model="form[field]"
            :type="field === '计划日期' || field === '实际日期' ? 'date' : 'text'"
            :placeholder="`请输入${field}`"
          />
        </label>
        <p class="form-tip">计划日期、实际日期可留空；实际日期早于计划日期时无法保存。</p>
        <span v-if="formError" class="error-text">{{ formError }}</span>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  ACTUAL_DATE_FIELD,
  PLAN_DATE_FIELD,
  deriveCleaningStatus,
  validateCleaningDates,
} from '@/data/cleaning'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('pipe_cleaning')
// 表格不直接展示登记时手填的「清洗状态」自由文本，统一换成推导出来的「复查状态」。
const columns = ["清洗编号", "清洗管段", "清洗方式", "清洗设备", "计划日期", "实际日期", "清洗长度"]
const statuses = ["待清洗", "清洗中", "已完成", "需复查"]
const formFields = [...columns]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 详情、列表、导出共用同一个纯函数，任何视图都不允许自己再算一遍状态。
function derive(row: EntryRow) {
  return deriveCleaningStatus(row)
}

function displayCell(row: EntryRow, field: string): string {
  const value = row[field]
  // 空日期保留为空，不渲染占位符。
  if (field === PLAN_DATE_FIELD || field === ACTUAL_DATE_FIELD) {
    return value === undefined || value === null ? '' : String(value)
  }
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => derive(row).status === status).length,
  })),
)

const stats = computed(() => [
  { label: '待清洗管段', value: statusSummary.value[0].count },
  { label: '清洗中管段', value: statusSummary.value[1].count },
  { label: '已完成管段', value: statusSummary.value[2].count },
])

const creating = ref(false)
const form = reactive<Record<string, string>>(
  Object.fromEntries(formFields.map((field) => [field, ''])),
)
const formError = ref('')

function resetForm() {
  for (const field of formFields) {
    form[field] = ''
  }
  formError.value = ''
}

function openCreate() {
  resetForm()
  creating.value = true
}

function closeCreate() {
  creating.value = false
  formError.value = ''
}

function submitCreate() {
  formError.value =
    validateCleaningDates(form[PLAN_DATE_FIELD] ?? '', form[ACTUAL_DATE_FIELD] ?? '') ?? ''
  if (formError.value) {
    return
  }
  const result = createEntry(meta.key, { ...form, 清洗状态: '' })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = result.message
  reload()
  if (result.id !== undefined) {
    router.push(`/pipe_cleaning/${result.id}`)
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道清洗列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 480px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-card h3 {
  margin: 0 0 4px;
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.form-item input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.form-tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
