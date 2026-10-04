<script setup lang="ts">
import { computed, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  ErrorCircleIcon,
  HistoryIcon,
  InfoCircleIcon,
  LockOnIcon,
  RefreshIcon,
  SwapIcon,
  TimeIcon
} from 'tdesign-icons-vue-next';
import { useReconcileStore } from '../reconcile/store';
import { useTokenStore } from '../store';
import type { Receipt, ReleaseSnapshot } from '../reconcile/types';

const store = useReconcileStore();
const tokenStore = useTokenStore();

const releases = computed(() => store.releases);
const products = computed(() => store.products);
const receipts = computed(() => store.receipts);
const deviations = computed(() => store.openDeviations);
const zeroBindings = computed(() => store.zeroBindingDeviations);
const rollbacks = computed(() => store.rollbacks);
const conflicts = computed(() => store.conflicts);
const attempts = computed(() => store.terminateAttempts);
const stats = computed(() => store.stats);
const activeVersion = computed(() => store.activeVersion);
const longOnline = computed(() => store.longOnlineReleases);
const pendingEntries = computed(() => store.pendingRecoverEntries);
const currentActor = computed(() => store.currentActor);
const interrupted = computed(() => store.interrupted);

const receiptForm = ref<{ productId: string; theme: string; fingerprint: string }>({ productId: '', theme: 'light', fingerprint: '' });
const rollbackForm = ref<{ targetVersion: string; rollbackNumber: number }>({ targetVersion: 'DS 4.5.2', rollbackNumber: 1010 });
const interruptForm = ref<{ kind: 'rollback' | 'receipt' | 'usage'; targetVersion: string; productId: string; usage: number }>({ kind: 'rollback', targetVersion: 'DS 4.5.2', productId: '', usage: 0 });

const themes = ['light', 'dark', 'ops', 'contrast'];
const themeLabels: Record<string, string> = { light: '明亮', dark: '暗色', ops: '运营', contrast: '高对比' };

function ageLabel(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days > 0) return `${days} 天前`;
  const hours = Math.floor((Date.now() - ts) / 3_600_000);
  if (hours > 0) return `${hours} 小时前`;
  return '刚刚';
}

function statusTheme(status: ReleaseSnapshot['status']): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'active') return 'success';
  if (status === 'superseded') return 'warning';
  if (status === 'terminated') return 'danger';
  return 'default';
}
function statusLabel(status: ReleaseSnapshot['status']): string {
  return status === 'active' ? '当前版本' : status === 'superseded' ? '已被取代' : '已强制结束';
}

function receiptMatch(receipt: Receipt): { matched: boolean; pending: boolean; label: string } {
  const product = products.value.find((item) => item.id === receipt.productId);
  if (!product || !product.boundVersion) return { matched: false, pending: false, label: '未绑定' };
  if (receipt.invalidated) return { matched: false, pending: true, label: '待重算' };
  const release = releases.value.find((item) => item.version === product.boundVersion);
  if (!release) return { matched: false, pending: false, label: '未知版本' };
  const expected = release.fingerprints[receipt.theme];
  if (expected && receipt.fingerprint === expected) return { matched: true, pending: false, label: '已覆盖' };
  return { matched: false, pending: false, label: '偏差' };
}

function productName(id: string): string {
  return products.value.find((item) => item.id === id)?.name ?? id;
}

function fillCurrentFingerprint() {
  const release = store.activeRelease;
  if (release) receiptForm.value.fingerprint = release.fingerprints[receiptForm.value.theme] ?? '';
}
function fillLegacyFingerprint() {
  const legacy = releases.value.find((item) => item.status === 'superseded');
  if (legacy) receiptForm.value.fingerprint = legacy.fingerprints[receiptForm.value.theme] ?? '';
}

function submitReceipt() {
  if (!receiptForm.value.productId || !receiptForm.value.fingerprint) {
    MessagePlugin.warning('请选择产品并填写包指纹');
    return;
  }
  const result = store.submitReceipt({
    productId: receiptForm.value.productId,
    theme: receiptForm.value.theme,
    fingerprint: receiptForm.value.fingerprint,
    claimedVersion: activeVersion.value
  });
  MessagePlugin.success(`回执已写入（回滚号 ${result.rollbackNumber}），重复回执不重复计数`);
  receiptForm.value = { productId: '', theme: 'light', fingerprint: '' };
}

function publishSnapshot() {
  const version = `DS ${tokenStore.releaseVersion}`;
  store.publishSnapshot(version, tokenStore.tokens, '品牌主题 · 明暗与高对比');
  MessagePlugin.success(`已按当前令牌生成 ${version} 发布快照，受影响产品回执失效重算`);
}

function simulateTwoTerminalRollback() {
  const target = rollbackForm.value.targetVersion || 'DS 4.5.2';
  const rn = rollbackForm.value.rollbackNumber || 1010;
  const a = store.submitRollback({ rollbackNumber: rn, targetVersion: target, requestedBy: '终端 A · 发布流水线' });
  const b = store.submitRollback({ rollbackNumber: rn, targetVersion: target, requestedBy: '终端 B · 发布流水线' });
  if (a.ok && b.conflict) MessagePlugin.warning(`回滚号 ${rn}：终端 A 先到生效，终端 B 内容已留作冲突`);
  else if (!a.ok) MessagePlugin.error(`终端 A 回滚被拒绝：${a.message}`);
  else MessagePlugin.info('两终端回滚已提交');
}

function recover() {
  const result = store.recover();
  if (result.recovered) MessagePlugin.success(`已按回滚号恢复 ${result.recovered} 条中断写入：${result.entries.join('、')}`);
  else MessagePlugin.info('没有待恢复的中断写入');
}

function simulateInterrupt() {
  const payload: { targetVersion?: string; productId?: string; usage?: number } = {};
  if (interruptForm.value.kind === 'rollback') payload.targetVersion = interruptForm.value.targetVersion;
  if (interruptForm.value.kind === 'receipt') payload.productId = interruptForm.value.productId || products.value[0]?.id;
  if (interruptForm.value.kind === 'usage') {
    payload.productId = interruptForm.value.productId || products.value[0]?.id;
    payload.usage = interruptForm.value.usage;
  }
  const result = store.simulateInterruption(interruptForm.value.kind, payload);
  MessagePlugin.warning(`已模拟中断写入（回滚号 ${result.rollbackNumber}），内容已落盘但未生效，可按回滚号恢复`);
}

function forceTerminate(version: string) {
  const result = store.forceTerminate(version);
  if (result.ok) MessagePlugin.success(`已强制结束 ${version}，绑定该版本的产品已解绑`);
  else MessagePlugin.error(`越权提交返回拒绝：${result.reason}`);
}

function changeUsage(productId: string, delta: number) {
  const product = products.value.find((item) => item.id === productId);
  if (!product) return;
  const next = Math.max(0, product.usage + delta);
  store.setUsage(productId, next);
  if (next === 0) MessagePlugin.warning('产品用量已降到 0，不能继续绑旧版本');
}

function bindProduct(productId: string, version: string) {
  const result = store.bindProduct(productId, version || null);
  if (!result.ok) MessagePlugin.error(`绑定被拒绝：${result.reason}`);
  else MessagePlugin.success('绑定已更新');
}

function setRole(role: 'admin' | 'maintainer') {
  store.setActor(role);
  MessagePlugin.info(`当前身份切换为${role === 'admin' ? '设计系统管理员' : '设计系统维护员'}`);
}

const statsCards = computed(() => [
  { label: '偏差清单', value: stats.value.openDeviations, tone: stats.value.openDeviations ? 'bad' : 'ok', icon: ErrorCircleIcon },
  { label: '零用量违规', value: stats.value.zeroBindings, tone: stats.value.zeroBindings ? 'bad' : 'ok', icon: InfoCircleIcon },
  { label: '待重算回执', value: stats.value.pendingAffected, tone: stats.value.pendingAffected ? 'warn' : 'ok', icon: RefreshIcon },
  { label: '长期在线版本', value: stats.value.longOnline, tone: stats.value.longOnline ? 'warn' : 'ok', icon: TimeIcon },
  { label: '未决冲突', value: stats.value.conflicts, tone: stats.value.conflicts ? 'warn' : 'ok', icon: SwapIcon },
  { label: '中断写入', value: stats.value.interrupted ? '待恢复' : '正常', tone: stats.value.interrupted ? 'bad' : 'ok', icon: HistoryIcon }
]);
</script>

<template>
  <div class="reconcile-page">
    <header class="page-heading">
      <div>
        <small>RECONCILIATION LEDGER / 对账台</small>
        <h1>发布版本 · 产品回执 · 令牌依赖</h1>
        <p>回执带产品、主题与包指纹，指纹与发布快照不一致即进入偏差清单；受影响产品按新快照失效重算，零用量产品不得继续绑旧版本。</p>
      </div>
      <div class="heading-actions">
        <t-tag :theme="currentActor.role === 'admin' ? 'danger' : 'primary'" variant="light" shape="round">
          <t-icon name="user" /> {{ currentActor.name }} · {{ currentActor.role === 'admin' ? '设计系统管理员' : '设计系统维护员' }}
        </t-tag>
        <t-button size="small" variant="outline" @click="setRole(currentActor.role === 'admin' ? 'maintainer' : 'admin')">
          切换{{ currentActor.role === 'admin' ? '维护员' : '管理员' }}身份
        </t-button>
        <t-button variant="outline" :icon="RefreshIcon" @click="publishSnapshot">按当前令牌重算快照</t-button>
        <t-button theme="primary" :icon="HistoryIcon" :disabled="!interrupted" @click="recover">按回滚号恢复</t-button>
      </div>
    </header>

    <section class="stats-row">
      <div v-for="card in statsCards" :key="card.label" class="stat-card" :class="card.tone">
        <component :is="card.icon" class="stat-icon" />
        <div><span>{{ card.label }}</span><strong>{{ card.value }}</strong></div>
      </div>
    </section>

    <div class="reconcile-grid">
      <div class="column main-col">
        <section class="panel">
          <div class="panel-head">
            <div><strong>发布快照</strong><span>版本指纹与覆盖状态 · 不能直接标记已覆盖</span></div>
            <t-tag theme="success" variant="light">{{ releases.length }} 个版本</t-tag>
          </div>
          <div class="table">
            <div class="t-row t-head">
              <span>版本</span><span>包指纹（按主题）</span><span>覆盖</span><span>状态</span><span class="t-actions">操作</span>
            </div>
            <div v-for="release in releases" :key="release.version" class="t-row">
              <div class="t-cell">
                <strong>{{ release.version }}</strong>
                <small>{{ release.label }} · {{ ageLabel(release.createdAt) }}</small>
              </div>
              <div class="t-cell fingerprints">
                <span v-for="theme in themes" :key="theme" class="fp" :title="`${themeLabels[theme]} · ${release.fingerprints[theme]}`">
                  <i :class="theme" />{{ release.fingerprints[theme] }}
                </span>
              </div>
              <div class="t-cell">
                <span class="coverage">{{ store.releaseCoverage(release.version).covered }}/{{ store.releaseCoverage(release.version).products }} 产品</span>
                <small>{{ store.releaseCoverage(release.version).matched }}/{{ store.releaseCoverage(release.version).receipts }} 回执匹配</small>
              </div>
              <div class="t-cell"><t-tag :theme="statusTheme(release.status)" variant="light">{{ statusLabel(release.status) }}</t-tag></div>
              <div class="t-cell t-actions">
                <t-button
                  v-if="release.status === 'superseded' && longOnline.some((item) => item.version === release.version)"
                  size="small"
                  theme="danger"
                  variant="outline"
                  :icon="LockOnIcon"
                  @click="forceTerminate(release.version)"
                >强制结束</t-button>
                <span v-else class="muted">—</span>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><strong>产品回执</strong><span>回执带产品、主题与包指纹 · 重复回执不重复计数</span></div>
            <t-tag variant="light">{{ receipts.length }} 条</t-tag>
          </div>
          <div class="table">
            <div class="t-row t-head"><span>回执号</span><span>产品 / 主题</span><span>包指纹</span><span>绑定版本</span><span>状态</span></div>
            <div v-for="receipt in receipts" :key="receipt.id" class="t-row">
              <div class="t-cell"><code>{{ receipt.id }}</code><small>回滚号 {{ receipt.rollbackNumber }}</small></div>
              <div class="t-cell"><strong>{{ productName(receipt.productId) }}</strong><small>{{ themeLabels[receipt.theme] }}</small></div>
              <div class="t-cell"><code class="fp">{{ receipt.fingerprint }}</code></div>
              <div class="t-cell"><small>{{ products.find((p) => p.id === receipt.productId)?.boundVersion ?? '—' }}</small></div>
              <div class="t-cell">
                <t-tag v-if="receiptMatch(receipt).pending" theme="warning" variant="light">待重算</t-tag>
                <t-tag v-else-if="receiptMatch(receipt).matched" theme="success" variant="light">已覆盖</t-tag>
                <t-tag v-else theme="danger" variant="light">偏差</t-tag>
              </div>
            </div>
          </div>
          <div class="receipt-form">
            <t-select v-model="receiptForm.productId" placeholder="选择产品" :options="products.map((p) => ({ label: p.name, value: p.id }))" style="width: 150px" />
            <t-select v-model="receiptForm.theme" :options="themes.map((t) => ({ label: themeLabels[t], value: t }))" style="width: 110px" />
            <t-input v-model="receiptForm.fingerprint" placeholder="包指纹 fp-xxxx" style="flex: 1; min-width: 180px" />
            <t-button size="small" variant="text" @click="fillCurrentFingerprint">当前快照</t-button>
            <t-button size="small" variant="text" @click="fillLegacyFingerprint">旧包快照</t-button>
            <t-button theme="primary" @click="submitReceipt">录入回执</t-button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><strong>偏差清单</strong><span>指纹与发布快照不一致 · 不能直接标已覆盖</span></div>
            <t-tag theme="danger" variant="light">{{ deviations.length + zeroBindings.length }} 项</t-tag>
          </div>
          <div v-if="!deviations.length && !zeroBindings.length" class="empty">
            <t-icon name="check-circle" size="22px" theme="success" /><span>暂无偏差，所有在绑产品回执均与发布快照一致。</span>
          </div>
          <div v-for="dev in deviations" :key="dev.id" class="deviation-row">
            <t-icon name="error-circle" class="ico-danger" />
            <div class="dev-body">
              <strong>{{ productName(dev.productId) }} · {{ themeLabels[dev.theme] }}</strong>
              <span>{{ dev.detail }}</span>
              <div class="dev-fp"><span>期望 <code>{{ dev.expectedFingerprint }}</code></span><span>实际 <code>{{ dev.actualFingerprint }}</code></span></div>
            </div>
            <t-tag theme="danger" variant="light">偏差</t-tag>
          </div>
          <div v-for="dev in zeroBindings" :key="dev.id" class="deviation-row zero">
            <t-icon name="info-circle" class="ico-warning" />
            <div class="dev-body">
              <strong>{{ productName(dev.productId) }} · 用量已归零</strong>
              <span>{{ dev.detail }}</span>
            </div>
            <t-tag theme="warning" variant="light">违规</t-tag>
          </div>
        </section>
      </div>

      <div class="column side-col">
        <section class="panel">
          <div class="panel-head"><div><strong>产品绑定</strong><span>用量归零不得继续绑旧版本</span></div></div>
          <div v-for="product in products" :key="product.id" class="product-row">
            <div class="product-info">
              <strong>{{ product.name }}</strong>
              <small>{{ product.owner }} · {{ product.tokenIds.length }} 个令牌引用</small>
            </div>
            <div class="product-usage">
              <span>用量</span>
              <div class="stepper">
                <t-button size="small" variant="outline" @click="changeUsage(product.id, -1)">−</t-button>
                <strong :class="{ zero: product.usage === 0 }">{{ product.usage }}</strong>
                <t-button size="small" variant="outline" @click="changeUsage(product.id, 1)">＋</t-button>
              </div>
            </div>
            <t-select
              :model-value="product.boundVersion"
              :options="releases.map((r) => ({ label: r.version, value: r.version }))"
              style="width: 150px"
              @change="(val: string) => bindProduct(product.id, val)"
            />
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><strong>回滚与冲突</strong><span>先到生效，后到内容留作冲突</span></div></div>
          <div class="rollback-form">
            <t-select v-model="rollbackForm.targetVersion" :options="releases.map((r) => ({ label: r.version, value: r.version }))" style="flex: 1" />
            <t-input v-model="rollbackForm.rollbackNumber" type="number" style="width: 110px" />
            <t-button size="small" variant="outline" :icon="SwapIcon" @click="simulateTwoTerminalRollback">两终端同时回滚</t-button>
          </div>
          <div class="table">
            <div class="t-row t-head"><span>回滚号</span><span>目标版本</span><span>发起方</span><span>状态</span></div>
            <div v-for="rb in rollbacks" :key="rb.rollbackNumber" class="t-row">
              <div class="t-cell"><code>{{ rb.rollbackNumber }}</code></div>
              <div class="t-cell"><small>{{ rb.targetVersion }}</small></div>
              <div class="t-cell"><small>{{ rb.requestedBy }}</small></div>
              <div class="t-cell">
                <t-tag v-if="rb.status === 'applied'" theme="success" variant="light">已生效</t-tag>
                <t-tag v-else theme="warning" variant="light">已中断</t-tag>
              </div>
            </div>
          </div>
          <div v-if="conflicts.length" class="conflict-list">
            <div v-for="cf in conflicts" :key="cf.id" class="conflict-row">
              <t-icon name="error-circle" class="ico-warning" />
              <div><strong>冲突 · 回滚号 {{ cf.rollbackNumber }}</strong><span>{{ cf.reason }}</span><code>{{ cf.content }}</code></div>
            </div>
          </div>
          <div class="interrupt-box">
            <div class="interrupt-head"><t-icon name="time" /><strong>中断恢复演练</strong></div>
            <p>写入中途失败时，内容已落盘但未生效；按回滚号重放即可恢复，重复回执不重复计数。</p>
            <div class="interrupt-form">
              <t-select v-model="interruptForm.kind" :options="[{label:'回滚中断',value:'rollback'},{label:'回执中断',value:'receipt'},{label:'用量中断',value:'usage'}]" style="width: 120px" />
              <t-select v-if="interruptForm.kind === 'rollback'" v-model="interruptForm.targetVersion" :options="releases.map((r) => ({ label: r.version, value: r.version }))" style="flex: 1" />
              <t-select v-else v-model="interruptForm.productId" :options="products.map((p) => ({ label: p.name, value: p.id }))" placeholder="产品" style="flex: 1" />
              <t-button size="small" variant="outline" @click="simulateInterrupt">模拟中断写入</t-button>
            </div>
            <div v-if="pendingEntries.length" class="pending-list">
              <span>待恢复回滚号：</span>
              <t-tag v-for="e in pendingEntries" :key="e.rollbackNumber" theme="warning" variant="light" shape="round">{{ e.rollbackNumber }} · {{ e.type }}</t-tag>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><strong>越权记录</strong><span>只有管理员可强制结束旧版本</span></div><t-icon name="shield-error" class="ico-warning" /></div>
          <div v-if="!attempts.length" class="empty"><span>暂无越权提交。</span></div>
          <div v-for="attempt in attempts" :key="attempt.id" class="attempt-row" :class="{ denied: !attempt.allowed }">
            <t-icon :name="attempt.allowed ? 'check-circle' : 'error-circle'" :class="attempt.allowed ? 'ico-success' : 'ico-danger'" />
            <div><strong>{{ attempt.actor }} · {{ attempt.version }}</strong><span>{{ attempt.reason }}</span><small>回滚号 {{ attempt.rollbackNumber }} · {{ ageLabel(attempt.at) }}</small></div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ico-danger { color: #b94343; }
.ico-warning { color: #a5681a; }
.ico-success { color: #2b8f6d; }
.reconcile-page { display: flex; flex-direction: column; gap: 14px; }
.page-heading { display: flex; align-items: end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.page-heading small { color: #6e7e8c; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.page-heading h1 { margin: 5px 0; font-size: 24px; letter-spacing: -.02em; }
.page-heading p { margin: 0; color: var(--muted, #71808d); font-size: 12px; max-width: 640px; }
.heading-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.heading-actions .t-tag { display: inline-flex; align-items: center; gap: 5px; }

.stats-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.stat-card { background: white; border: 1px solid var(--line, #dce2e7); border-radius: 6px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; }
.stat-card .stat-icon { font-size: 22px; color: #8b9aa5; }
.stat-card span, .stat-card strong { display: block; }
.stat-card span { color: var(--muted, #71808d); font-size: 10px; }
.stat-card strong { font-size: 20px; margin-top: 2px; }
.stat-card.bad { border-color: #e7b6b6; background: #fdf3f2; }
.stat-card.bad .stat-icon { color: #b94343; }
.stat-card.bad strong { color: #b94343; }
.stat-card.warn { border-color: #ecd9b0; background: #fdf8ec; }
.stat-card.warn .stat-icon { color: #a5681a; }
.stat-card.warn strong { color: #a5681a; }
.stat-card.ok .stat-icon { color: #2b8f6d; }

.reconcile-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(360px, 1fr); gap: 13px; align-items: start; }
.column { display: flex; flex-direction: column; gap: 13px; min-width: 0; }

.table { display: flex; flex-direction: column; }
.t-row { display: grid; grid-template-columns: 1.2fr 1.6fr .9fr .7fr .7fr; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #edf1f3; }
.t-row:last-child { border-bottom: 0; }
.t-row.t-head { font-size: 9px; color: var(--muted, #71808d); text-transform: uppercase; letter-spacing: .05em; background: #fafcfd; }
.t-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.t-cell strong { font-size: 12px; }
.t-cell small { color: var(--muted, #71808d); font-size: 9px; }
.t-cell code { font-family: ui-monospace, monospace; font-size: 10px; background: #f0f4f7; padding: 2px 6px; border-radius: 3px; width: fit-content; }
.t-cell.fingerprints { gap: 4px; }
.fp { display: inline-flex; align-items: center; gap: 5px; font-family: ui-monospace, monospace; font-size: 9px; color: #4b5b68; }
.fp i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.fp i.light { background: #f2c14e; }
.fp i.dark { background: #3a4a63; }
.fp i.ops { background: #24786a; }
.fp i.contrast { background: #111; }
.coverage { font-size: 12px; font-weight: 700; }
.t-actions { justify-self: end; }
.muted { color: #b6c0c8; font-size: 10px; }

.receipt-form { display: flex; gap: 8px; align-items: center; padding: 12px 14px; border-top: 1px solid var(--line, #dce2e7); flex-wrap: wrap; }

.empty { display: flex; align-items: center; gap: 8px; padding: 18px; color: var(--muted, #71808d); font-size: 11px; }
.deviation-row { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-bottom: 1px solid #edf1f3; }
.deviation-row:last-child { border-bottom: 0; }
.deviation-row .t-icon { font-size: 18px; margin-top: 2px; }
.deviation-row.zero { background: #fdfaf0; }
.dev-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.dev-body strong { font-size: 12px; }
.dev-body span { color: var(--muted, #71808d); font-size: 10px; }
.dev-fp { display: flex; gap: 14px; margin-top: 4px; flex-wrap: wrap; }
.dev-fp span { font-size: 9px; color: #4b5b68; }
.dev-fp code { font-family: ui-monospace, monospace; background: #f0f4f7; padding: 1px 5px; border-radius: 3px; }

.product-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 11px 14px; border-bottom: 1px solid #edf1f3; }
.product-row:last-child { border-bottom: 0; }
.product-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.product-info strong { font-size: 12px; }
.product-info small { color: var(--muted, #71808d); font-size: 9px; }
.product-usage { display: flex; flex-direction: column; gap: 3px; align-items: center; }
.product-usage > span { color: var(--muted, #71808d); font-size: 8px; }
.stepper { display: flex; align-items: center; gap: 6px; }
.stepper strong { font-size: 14px; min-width: 24px; text-align: center; }
.stepper strong.zero { color: #b94343; }

.rollback-form { display: flex; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line, #dce2e7); }
.conflict-list { border-top: 1px solid #edf1f3; }
.conflict-row { display: flex; gap: 9px; align-items: flex-start; padding: 11px 14px; background: #fdf8ec; border-bottom: 1px solid #f3e9cf; }
.conflict-row .t-icon { font-size: 17px; margin-top: 2px; }
.conflict-row div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.conflict-row strong { font-size: 11px; color: #8a5a17; }
.conflict-row span { font-size: 10px; color: #6b5a3a; }
.conflict-row code { font-family: ui-monospace, monospace; font-size: 9px; color: #7a6a4a; background: #f6ecd4; padding: 2px 6px; border-radius: 3px; margin-top: 3px; word-break: break-all; }

.interrupt-box { margin: 12px 14px; padding: 12px; border: 1px dashed #d8c9a8; border-radius: 6px; background: #fdfaf0; }
.interrupt-head { display: flex; align-items: center; gap: 6px; color: #8a5a17; }
.interrupt-head strong { font-size: 11px; }
.interrupt-box p { margin: 7px 0 10px; color: #6b5a3a; font-size: 10px; line-height: 1.5; }
.interrupt-form { display: flex; gap: 7px; flex-wrap: wrap; }
.pending-list { display: flex; gap: 6px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.pending-list > span { font-size: 9px; color: #8a5a17; }

.attempt-row { display: flex; gap: 9px; align-items: flex-start; padding: 11px 14px; border-bottom: 1px solid #edf1f3; }
.attempt-row:last-child { border-bottom: 0; }
.attempt-row .t-icon { font-size: 17px; margin-top: 2px; }
.attempt-row div { display: flex; flex-direction: column; gap: 2px; }
.attempt-row strong { font-size: 11px; }
.attempt-row span { font-size: 10px; color: #6b5a3a; }
.attempt-row small { font-size: 9px; color: var(--muted, #71808d); }
.attempt-row.denied { background: #fdf3f2; }
.attempt-row.denied span { color: #a34a48; }

@media (max-width: 1250px) {
  .stats-row { grid-template-columns: repeat(3, 1fr); }
  .reconcile-grid { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .stats-row { grid-template-columns: repeat(2, 1fr); }
  .t-row { grid-template-columns: 1fr 1fr; }
  .t-head { display: none; }
}
</style>
