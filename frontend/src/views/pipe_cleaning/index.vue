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
      <label class="filter-item">
        <span>当前状态</span>
        <input v-model="filters['清洗状态']" placeholder="按当前状态检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
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
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="cleaning-create-title">
        <div class="modal-head">
          <h3 id="cleaning-create-title">登记管道清洗记录</h3>
          <button class="btn ghost" type="button" @click="closeCreate">关闭</button>
        </div>
        <form class="create-form" @submit.prevent="submitCreate">
          <label v-for="field in formFields" :key="field" class="create-item">
            <span>{{ field }}</span>
            <input
              v-model="draft[field]"
              :type="dateFields.includes(field) ? 'date' : 'text'"
              :required="requiredFields.includes(field)"
            />
          </label>
          <p class="form-hint">计划日期、实际日期均可留空；实际日期不能早于计划日期。</p>
          <p v-if="formMessage" class="error-text">{{ formMessage }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit">保存记录</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  createCleaningEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  ACTUAL_DATE_FIELD,
  CLEANING_STATUSES,
  PLAN_DATE_FIELD,
  type CleaningDraft,
} from '@/data/pipe-cleaning'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('pipe_cleaning')
// 清洗状态是推导列，不作为可录入字段；表单只采集原始数据。
const columns = ['清洗编号', '清洗管段', '清洗方式', '清洗设备', PLAN_DATE_FIELD, ACTUAL_DATE_FIELD, '清洗长度', '清洗状态']
const formFields = ['清洗编号', '清洗管段', '清洗方式', '清洗设备', PLAN_DATE_FIELD, ACTUAL_DATE_FIELD, '清洗长度']
const dateFields = [PLAN_DATE_FIELD, ACTUAL_DATE_FIELD]
const requiredFields = ['清洗编号', '清洗管段', '清洗方式', '清洗设备', PLAN_DATE_FIELD]
const actions = ['安排清洗', '开始清洗', '确认完成']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const creating = ref(false)
const formMessage = ref('')
const draft = reactive<Record<string, string>>({
  清洗编号: '',
  清洗管段: '',
  清洗方式: '',
  清洗设备: '',
  计划日期: '',
  实际日期: '',
  清洗长度: '',
})

const statusSummary = computed(() =>
  CLEANING_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待清洗管段', value: countStatus('待清洗') },
  { label: '清洗中管段', value: countStatus('清洗中') },
  { label: '已完成管段', value: countStatus('已完成') },
  { label: '需复查管段', value: countStatus('需复查') },
])

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 空日期（空字符串）保留为空，不用「—」或其它占位符顶替。
function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === null || value === undefined || String(value) === '') {
    return column === PLAN_DATE_FIELD || column === ACTUAL_DATE_FIELD ? '' : '—'
  }
  return String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  formMessage.value = ''
  Object.assign(draft, {
    清洗编号: '',
    清洗管段: '',
    清洗方式: '',
    清洗设备: '',
    计划日期: '',
    实际日期: '',
    清洗长度: '',
  })
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  formMessage.value = ''
  const payload: CleaningDraft = {
    清洗编号: draft.清洗编号,
    清洗管段: draft.清洗管段,
    清洗方式: draft.清洗方式,
    清洗设备: draft.清洗设备,
    计划日期: draft.计划日期,
    实际日期: draft.实际日期,
    清洗长度: draft.清洗长度,
  }
  const result = createCleaningEntry(payload)
  if (!result.ok) {
    // 日期倒挂等校验错误在这里明确提示，且不会写入任何数据。
    formMessage.value = result.message
    return
  }
  creating.value = false
  reload()
}

function openDetail(row: EntryRow) {
  void router.push({ name: 'pipe_cleaning_detail', params: { id: String(row.id) } })
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
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
  background: #fff;
  border-radius: 10px;
  width: 560px;
  max-width: calc(100vw - 32px);
  padding: 16px 18px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.create-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}
.create-item {
  flex: 1 1 240px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.create-item input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.form-hint {
  flex-basis: 100%;
  margin: 2px 0;
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  flex-basis: 100%;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
