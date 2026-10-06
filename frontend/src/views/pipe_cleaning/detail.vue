<template>
  <section class="page" data-module="pipe_cleaning-detail">
    <header class="page-head">
      <div>
        <h2>管道清洗记录详情</h2>
        <p class="page-desc">展示单条管道清洗记录的原始登记数据与复查结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <div v-if="errorMessage" class="detail-error">
      <p class="error-text">{{ errorMessage }}</p>
      <RouterLink class="link" to="/pipe_cleaning">返回管道清洗列表</RouterLink>
    </div>

    <template v-else-if="detail">
      <article class="detail-status" :class="statusClass">
        <span class="stat-label">复查状态</span>
        <strong class="stat-value">{{ detail.status }}</strong>
        <p v-if="detail.reason" class="status-reason">{{ detail.reason }}</p>
      </article>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ displayCell(field) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { cleaningDetail } from '@/api/local-service'
import { ACTUAL_DATE_FIELD, PLAN_DATE_FIELD } from '@/data/cleaning'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()

// 详情页字段顺序与模块配置保持一致，但不单独再算状态。
const fields = [
  '清洗编号',
  '清洗管段',
  '清洗方式',
  '清洗设备',
  PLAN_DATE_FIELD,
  ACTUAL_DATE_FIELD,
  '清洗长度',
]

const detail = ref<{ row: EntryRow; status: string; reason: string } | null>(null)
const errorMessage = ref('')

const statusClass = computed(() => {
  if (!detail.value) {
    return ''
  }
  return {
    待清洗: 'is-pending',
    清洗中: 'is-doing',
    已完成: 'is-done',
    需复查: 'is-review',
  }[detail.value.status]
})

function displayCell(field: string): string {
  if (!detail.value) {
    return ''
  }
  const value = detail.value.row[field]
  // 空日期（及其他空字段）保留为空，不补占位文字。
  if (field === PLAN_DATE_FIELD || field === ACTUAL_DATE_FIELD) {
    return value === undefined || value === null ? '' : String(value)
  }
  return value === undefined || value === null ? '' : String(value)
}

function goBack() {
  // 返回列表是纯读操作，不会改动任何状态或原始数据。
  router.push('/pipe_cleaning')
}

function load() {
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    errorMessage.value = '记录编号无效'
    detail.value = null
    return
  }
  const result = cleaningDetail(id)
  if (!result) {
    errorMessage.value = `没有找到编号为 ${id} 的管道清洗记录`
    detail.value = null
    return
  }
  errorMessage.value = ''
  detail.value = result
}

onMounted(load)
</script>

<style scoped>
.detail-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.detail-status {
  background: #fff;
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.detail-status.is-pending {
  border-left-color: #98a2b3;
}
.detail-status.is-doing {
  border-left-color: #f79009;
}
.detail-status.is-done {
  border-left-color: #12b76a;
}
.detail-status.is-review {
  border-left-color: #f04438;
}
.status-reason {
  margin: 6px 0 0;
  font-size: 13px;
  color: #b42318;
}
.detail-table th {
  width: 160px;
}
</style>
