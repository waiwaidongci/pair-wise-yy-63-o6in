<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { collectDependents, LONG_ONLINE_DAYS, useReconcileStore, type Release } from '../reconcile';
import { useTokenStore } from '../store';

const store = useReconcileStore();
const tokenStore = useTokenStore();
const operator = '顾清 · Core DS';

const selectedTokenId = ref('');
const rollbackNoInput = ref('');
const rollbackTarget = ref('');
const rollbackTerminal = ref('终端 A');
const rollbackNote = ref('');
const simulateCrash = ref(false);

onMounted(() => {
  const recovered = store.recover();
  if (recovered > 0) MessagePlugin.success(`检测到写入中断，已按回滚号恢复 ${recovered} 条记录`);
});

const coverage = computed(() => store.currentCoverage);
const releases = computed(() => store.sortedReleases);
const bindings = computed(() => store.bindingList);
const deviations = computed(() => store.deviations);
const receipts = computed(() => [...store.receipts].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 8));
const journal = computed(() => [...store.journal].sort((a, b) => b.createdAt - a.createdAt));
const invalidations = computed(() => [...store.invalidations].reverse());
const audits = computed(() => [...store.audits].reverse().slice(0, 10));
const currentRelease = computed(() => store.releases.find((release) => release.version === store.currentVersion));

const tokenOptions = computed(() => tokenStore.tokens
  .filter((token) => token.category === 'component' || !token.ref)
  .map((token) => ({ label: `${token.name} · ${token.id}`, value: token.id })));

const affectedPreview = computed(() => selectedTokenId.value
  ? [selectedTokenId.value, ...collectDependents(tokenStore.tokens, selectedTokenId.value)]
  : []);

const releaseOptions = computed(() => releases.value.map((release) => ({ label: `DS ${release.version}`, value: release.version })));

const stateTag = { matched: '已匹配', deviation: '偏差', invalidated: '失效待重算', unbound: '已解绑' } as const;
const stateTheme = { matched: 'success', deviation: 'danger', invalidated: 'warning', unbound: 'default' } as const;
const verdictTag = { matched: '匹配', deviation: '偏差', duplicate: '重复' } as const;
const verdictTheme = { matched: 'success', deviation: 'danger', duplicate: 'default' } as const;
const rollbackTag = { applied: '已生效', conflict: '冲突留存', pending: '待恢复' } as const;
const rollbackTheme = { applied: 'success', conflict: 'danger', pending: 'warning' } as const;

function fmt(ts: number) {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ageDays(ts: number) {
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function expectedFingerprint(version: string) {
  return store.releases.find((release) => release.version === version)?.fingerprint ?? '未知版本';
}

function releaseStatus(release: Release): { label: string; theme: 'default' | 'primary' | 'warning' | 'danger' } {
  if (release.status === 'force-ended') return { label: '已强制结束', theme: 'danger' };
  if (release.status === 'rolled-back') return { label: '已回滚', theme: 'default' };
  if (release.version === store.currentVersion) return { label: '当前发布', theme: 'primary' };
  return { label: '旧版在线', theme: 'warning' };
}

function onRoleChange(value: string | number | boolean) {
  store.setRole(value === 'admin' ? 'admin' : 'maintainer');
}

function inbound() {
  const result = store.simulateInbound();
  MessagePlugin.success(`接收 ${result.total} 条回执：匹配 ${result.matched} · 偏差 ${result.deviation}`);
}

function replay() {
  const verdict = store.replayLastReceipt();
  if (verdict === 'duplicate') MessagePlugin.info('重复回执已忽略，未重复计数');
  else if (verdict === 'none') MessagePlugin.warning('暂无可重放的回执');
}

function runInvalidation() {
  const token = tokenStore.tokens.find((item) => item.id === selectedTokenId.value);
  if (!token) return;
  tokenStore.notifyTokenChange(token);
  const event = store.invalidations[store.invalidations.length - 1];
  if (event) MessagePlugin.success(`失效重算完成：${event.invalidated.length} 个产品待按新快照重报，${event.unbound.length} 个产品引用归零解绑`);
}

function submitRollback() {
  const rollbackNo = Number.parseInt(rollbackNoInput.value, 10) || store.nextRollbackNo;
  if (!rollbackTarget.value) {
    MessagePlugin.warning('请选择回滚目标版本');
    return;
  }
  const result = store.submitRollback({
    rollbackNo,
    targetVersion: rollbackTarget.value,
    note: rollbackNote.value || '手动回滚',
    terminal: rollbackTerminal.value,
    actor: operator,
    crash: simulateCrash.value
  });
  if (result === 'conflict') MessagePlugin.warning(`回滚号 ${rollbackNo} 已被先到的提交占用，本次内容留作冲突`);
  else if (result === 'pending') MessagePlugin.warning(`回滚号 ${rollbackNo} 写入中断，日志已保存，可按回滚号恢复`);
  else MessagePlugin.success(`回滚号 ${rollbackNo} 已生效，当前发布回退到 DS ${rollbackTarget.value}`);
  rollbackNoInput.value = '';
  rollbackNote.value = '';
}

function simulateConcurrent() {
  if (!rollbackTarget.value) {
    MessagePlugin.warning('请先选择回滚目标版本');
    return;
  }
  const rollbackNo = store.nextRollbackNo;
  const first = store.submitRollback({ rollbackNo, targetVersion: rollbackTarget.value, note: '终端 A 提交的回滚', terminal: '终端 A', actor: '值班维护员 · 终端 A', crash: simulateCrash.value });
  const second = store.submitRollback({ rollbackNo, targetVersion: rollbackTarget.value, note: '终端 B 提交的同一回滚（内容留作冲突）', terminal: '终端 B', actor: '值班维护员 · 终端 B', crash: simulateCrash.value });
  const firstLabel = first === 'applied' ? '已生效' : first === 'pending' ? '写入中断待恢复' : '冲突留存';
  MessagePlugin.info(`回滚号 ${rollbackNo}：终端 A ${firstLabel}，终端 B ${second === 'conflict' ? '内容留作冲突' : second}`);
}

function recoverNow() {
  const count = store.recover();
  if (count > 0) MessagePlugin.success(`已按回滚号恢复 ${count} 条中断写入`);
  else MessagePlugin.info('没有待恢复的中断写入');
}

async function forceEnd(release: Release) {
  const result = await store.forceEnd(release.version, operator);
  if (result.ok) MessagePlugin.success(`DS ${release.version} 已强制结束，绑定产品转入失效重算`);
  else MessagePlugin.error(result.reason);
}
</script>

<template>
  <div class="rc-page">
    <div class="panel rc-toolbar">
      <div class="rc-role">
        <span class="rc-label">当前角色</span>
        <t-radio-group :model-value="store.role" variant="default-filled" @change="onRoleChange">
          <t-radio-button value="maintainer">设计系统维护员</t-radio-button>
          <t-radio-button value="admin">设计系统管理员</t-radio-button>
        </t-radio-group>
      </div>
      <div class="rc-current">
        <span class="rc-label">当前发布</span>
        <div><strong>DS {{ store.currentVersion }}</strong><code>{{ currentRelease?.fingerprint }}</code></div>
      </div>
      <div class="rc-coverage">
        <span class="rc-label">新版本覆盖（{{ coverage.matched }}/{{ coverage.total }} 产品 · 回执推导）</span>
        <div class="rc-coverage-bar">
          <t-progress :percentage="coverage.pct" :theme="coverage.covered ? 'success' : 'warning'" />
          <t-tag :theme="coverage.covered ? 'success' : 'warning'" variant="light">{{ coverage.covered ? '已覆盖' : '覆盖中' }}</t-tag>
        </div>
      </div>
      <p class="rc-hint">覆盖状态由产品回执与发布快照对账推导，不能手动把版本标成已覆盖。</p>
    </div>

    <div class="panel rc-releases">
      <div class="panel-head"><div><strong>发布版本对账</strong><span>发布快照指纹 × 产品回执指纹</span></div><t-tag variant="light">{{ releases.length }} 个版本</t-tag></div>
      <table class="rc-table">
        <thead><tr><th>版本</th><th>包指纹</th><th>发布时间</th><th>在线</th><th>绑定产品</th><th>匹配</th><th>偏差</th><th>待重算</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="release in releases" :key="release.version">
            <td><strong>DS {{ release.version }}</strong></td>
            <td><code>{{ release.fingerprint }}</code></td>
            <td>{{ fmt(release.publishedAt) }}</td>
            <td>{{ ageDays(release.publishedAt) }} 天</td>
            <td>{{ store.statsOf(release.version).bound }}</td>
            <td class="rc-ok">{{ store.statsOf(release.version).matched }}</td>
            <td :class="{ 'rc-bad': store.statsOf(release.version).deviation > 0 }">{{ store.statsOf(release.version).deviation }}</td>
            <td :class="{ 'rc-warn': store.statsOf(release.version).invalidated > 0 }">{{ store.statsOf(release.version).invalidated }}</td>
            <td><t-tag size="small" :theme="releaseStatus(release).theme" variant="light">{{ releaseStatus(release).label }}</t-tag></td>
            <td>
              <t-button v-if="store.isForceEndEligible(release)" size="small" theme="danger" variant="outline" @click="forceEnd(release)">强制结束</t-button>
              <span v-else class="rc-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="rc-hint rc-hint-pad">仅设计系统管理员可强制结束长期在线（≥ {{ LONG_ONLINE_DAYS }} 天）的旧版本，越权提交将被拒绝并记入审计。</p>
    </div>

    <div class="rc-grid">
      <div class="panel">
        <div class="panel-head"><div><strong>产品绑定清单</strong><span>回执对账后的有效绑定</span></div><t-tag variant="light">{{ bindings.length }} 个绑定</t-tag></div>
        <div class="rc-binding" v-for="binding in bindings" :key="`${binding.product}-${binding.theme}`">
          <div class="rc-binding-main"><strong>{{ binding.product }}</strong><span>{{ binding.theme }} · 更新 {{ fmt(binding.updatedAt) }}</span></div>
          <div class="rc-binding-ver"><t-tag size="small" variant="light">DS {{ binding.version }}</t-tag><code>{{ binding.fingerprint }}</code></div>
          <div class="rc-binding-state"><t-tag size="small" :theme="stateTheme[binding.state]" variant="light">{{ stateTag[binding.state] }}</t-tag><span>{{ binding.note }}</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><strong>产品回执流</strong><span>回执携带产品 · 主题 · 包指纹</span></div>
          <div class="rc-actions">
            <t-button size="small" theme="primary" @click="inbound">模拟接收回执</t-button>
            <t-button size="small" variant="outline" @click="replay">重放最近回执</t-button>
          </div>
        </div>
        <div class="rc-receipt-stats">
          <span>有效回执 <strong>{{ store.receipts.length - store.duplicateCount }}</strong></span>
          <span>重复回执 <strong>{{ store.duplicateCount }}</strong>（未重复计数）</span>
        </div>
        <div class="rc-receipt" v-for="receipt in receipts" :key="`${receipt.id}-${receipt.receivedAt}`">
          <t-tag size="small" :theme="verdictTheme[receipt.verdict]" variant="light">{{ verdictTag[receipt.verdict] }}</t-tag>
          <div><strong>{{ receipt.id }}</strong><span>{{ receipt.product }} · {{ receipt.theme }} · DS {{ receipt.version }}</span></div>
          <code>{{ receipt.fingerprint }}</code>
          <span class="rc-muted">{{ receipt.terminal }} · {{ fmt(receipt.receivedAt) }}</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><strong>偏差清单</strong><span>回执指纹与发布快照不一致</span></div><t-badge :count="deviations.length" /></div>
        <p v-if="!deviations.length" class="empty">暂无偏差，所有绑定与发布快照一致。</p>
        <div class="rc-deviation" v-for="binding in deviations" :key="`dev-${binding.product}-${binding.theme}`">
          <div class="rc-deviation-head"><strong>{{ binding.product }} · {{ binding.theme }}</strong><t-tag size="small" variant="light">DS {{ binding.version }}</t-tag></div>
          <div class="rc-fp-compare"><span>期望 <code>{{ expectedFingerprint(binding.version) }}</code></span><span>实际 <code>{{ binding.fingerprint }}</code></span></div>
          <p>{{ binding.note }}</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><strong>失效重算</strong><span>基础令牌或组件别名改动后，受影响产品按新快照重算</span></div></div>
        <div class="rc-invalidate-form">
          <t-select v-model="selectedTokenId" placeholder="选择改动的令牌（基础令牌 / 组件别名）" :options="tokenOptions" filterable />
          <t-button theme="primary" :disabled="!selectedTokenId" @click="runInvalidation">执行失效重算</t-button>
        </div>
        <div class="rc-affected" v-if="affectedPreview.length">
          <span>影响链</span>
          <t-tag v-for="id in affectedPreview" :key="id" size="small" variant="light">{{ id }}</t-tag>
        </div>
        <p v-if="!invalidations.length" class="empty">暂无失效事件。接受变更评审或在此选择令牌触发重算。</p>
        <div class="rc-event" v-for="event in invalidations" :key="event.id">
          <div><t-tag size="small">{{ event.id }}</t-tag><strong>{{ event.tokenId }}</strong><span class="rc-muted">{{ fmt(event.createdAt) }}</span></div>
          <p>待重报：{{ event.invalidated.join('、') || '无' }} · 引用归零解绑：{{ event.unbound.join('、') || '无' }}</p>
        </div>
      </div>

      <div class="panel rc-span-2">
        <div class="panel-head">
          <div><strong>回滚与冲突</strong><span>同一回滚号先到生效，后到内容留作冲突；中断按回滚号恢复</span></div>
          <t-button size="small" variant="outline" @click="recoverNow">按回滚号恢复</t-button>
        </div>
        <div class="rc-rollback-form">
          <t-input v-model="rollbackNoInput" :placeholder="`回滚号（下一个 ${store.nextRollbackNo}）`" />
          <t-select v-model="rollbackTarget" placeholder="目标版本" :options="releaseOptions" />
          <t-select v-model="rollbackTerminal" :options="[{ label: '终端 A', value: '终端 A' }, { label: '终端 B', value: '终端 B' }]" />
          <t-input v-model="rollbackNote" placeholder="回滚说明" />
          <label class="rc-crash"><t-checkbox v-model="simulateCrash">模拟写入中断</t-checkbox></label>
          <div class="rc-actions">
            <t-button theme="primary" @click="submitRollback">提交回滚</t-button>
            <t-button variant="outline" @click="simulateConcurrent">模拟双终端并发</t-button>
          </div>
        </div>
        <table class="rc-table">
          <thead><tr><th>回滚号</th><th>目标版本</th><th>终端</th><th>提交人</th><th>状态</th><th>说明</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="entry in journal" :key="`${entry.rollbackNo}-${entry.terminal}-${entry.createdAt}`">
              <td>#{{ entry.rollbackNo }}</td>
              <td>DS {{ entry.targetVersion }}</td>
              <td>{{ entry.terminal }}</td>
              <td>{{ entry.actor }}</td>
              <td><t-tag size="small" :theme="rollbackTheme[entry.status]" variant="light">{{ rollbackTag[entry.status] }}</t-tag></td>
              <td>{{ entry.note }}</td>
              <td>{{ fmt(entry.createdAt) }}</td>
            </tr>
            <tr v-if="!journal.length"><td colspan="7" class="rc-muted">暂无回滚记录。</td></tr>
          </tbody>
        </table>
      </div>

      <div class="panel rc-span-2">
        <div class="panel-head"><div><strong>操作审计</strong><span>发布、回滚与强制结束记录，含越权拒绝</span></div></div>
        <p v-if="!audits.length" class="empty">暂无审计记录。</p>
        <div class="rc-audit" v-for="record in audits" :key="record.id">
          <t-tag size="small" :theme="record.result === 'accepted' ? 'success' : 'danger'" variant="light">{{ record.result === 'accepted' ? '已接受' : '已拒绝' }}</t-tag>
          <div><strong>{{ record.action }} · {{ record.actor }}</strong><span>{{ record.detail }}</span></div>
          <span class="rc-muted">{{ fmt(record.createdAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
