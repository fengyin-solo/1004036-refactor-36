<template>
  <section class="page" data-module="pipe_cleaning_detail">
    <header class="page-head">
      <div>
        <h2>管道清洗记录详情</h2>
        <p class="page-desc">详情与列表、导出使用同一套状态口径，复查结论以计划日期与实际日期的比对为准。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <template v-else-if="row">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">复查状态</span>
          <strong class="stat-value" :class="{ 'status-bad': summary.needsReview }">
            {{ summary.needsReview ? '需复查' : '无需复查' }}
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td :class="{ 'status-bad': field === '清洗状态' && summary.needsReview }">
              {{ displayCell(row, field) }}
            </td>
          </tr>
          <tr>
            <th>复查结论说明</th>
            <td :class="{ 'status-bad': summary.needsReview }">{{ summary.reviewNote }}</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>重复打开或从列表返回本页不会改变状态，也不会改写原始日期数据。</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getEntry, moduleMeta } from '@/api/local-service'
import {
  ACTUAL_DATE_FIELD,
  PLAN_DATE_FIELD,
  describeCleaning,
} from '@/data/pipe-cleaning'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()
const meta = moduleMeta('pipe_cleaning')
const fields = meta.fields

const row = ref<EntryRow | null>(null)
const errorMessage = ref('')

// 复查说明直接取自唯一口径，保证与列表的当前状态是同一结论。
const summary = computed(() =>
  row.value ? describeCleaning(row.value) : describeCleaning({ status: '待清洗' }),
)

function displayCell(current: EntryRow, field: string): string {
  const value = current[field]
  if (value === null || value === undefined || String(value) === '') {
    return field === PLAN_DATE_FIELD || field === ACTUAL_DATE_FIELD ? '' : '—'
  }
  return String(value)
}

function goBack() {
  void router.push({ name: 'pipe_cleaning' })
}

function loadDetail() {
  errorMessage.value = ''
  const id = Number(route.params.id)
  if (!Number.isFinite(id)) {
    errorMessage.value = '管道清洗记录编号不正确'
    row.value = null
    return
  }
  const found = getEntry(meta.key, id)
  if (!found) {
    errorMessage.value = `没有找到编号为 ${id} 的管道清洗记录`
    row.value = null
    return
  }
  // 只读渲染，不调用任何保存动作；重复进入页面得到的结果完全一致。
  row.value = found
}

onMounted(loadDetail)
</script>

<style scoped>
.detail-table {
  max-width: 720px;
}
.detail-table th {
  width: 160px;
  background: #f8fafc;
}
.status-bad {
  color: #b42318;
  font-weight: 600;
}
</style>
