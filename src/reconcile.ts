import { defineStore } from 'pinia';
import { postForceEnd } from './api';

export type Role = 'admin' | 'maintainer';
export type BindingState = 'matched' | 'deviation' | 'invalidated' | 'unbound';
export type ReceiptVerdict = 'matched' | 'deviation' | 'duplicate';
export type RollbackStatus = 'pending' | 'applied' | 'conflict';

export type Release = {
  version: string;
  publishedAt: number;
  fingerprint: string;
  snapshot: Record<string, string>;
  status: 'online' | 'rolled-back' | 'force-ended';
};

export type Binding = {
  product: string;
  theme: string;
  version: string;
  fingerprint: string;
  usage: Record<string, number>;
  state: BindingState;
  note: string;
  updatedAt: number;
};

export type ReceiptRecord = {
  id: string;
  product: string;
  theme: string;
  version: string;
  fingerprint: string;
  usage: Record<string, number>;
  terminal: string;
  receivedAt: number;
  verdict: ReceiptVerdict;
};

export type RollbackEntry = {
  rollbackNo: number;
  targetVersion: string;
  note: string;
  terminal: string;
  actor: string;
  status: RollbackStatus;
  createdAt: number;
};

export type InvalidationEvent = {
  id: string;
  tokenId: string;
  affectedTokens: string[];
  expectedFingerprint: string;
  invalidated: string[];
  unbound: string[];
  createdAt: number;
};

export type AuditRecord = {
  id: string;
  action: string;
  actor: string;
  detail: string;
  result: 'accepted' | 'rejected';
  createdAt: number;
};

const DAY = 24 * 60 * 60 * 1000;
export const LONG_ONLINE_DAYS = 30;

// 包指纹：对发布快照做规范化（按键排序）后取 FNV-1a 哈希。
// 产品回执携带同一算法算出的指纹，与发布快照不一致即入偏差清单。
export function fingerprintOf(snapshot: Record<string, string>): string {
  const canonical = Object.keys(snapshot).sort().map((key) => `${key}=${snapshot[key]}`).join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// 沿 ref 引用链收集下游依赖者（语义令牌、组件别名）。
export function collectDependents(tokens: { id: string; ref?: string }[], rootId: string): string[] {
  const byRef = new Map<string, string[]>();
  tokens.forEach((token) => {
    if (!token.ref) return;
    byRef.set(token.ref, [...(byRef.get(token.ref) ?? []), token.id]);
  });
  const affected: string[] = [];
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    (byRef.get(current) ?? []).forEach((dependent) => {
      if (!affected.includes(dependent)) {
        affected.push(dependent);
        queue.push(dependent);
      }
    });
  }
  return affected;
}

const baseSnapshot: Record<string, string> = {
  'color.base.blue.600': '#2864dc',
  'color.semantic.primary': '{color.base.blue.600}',
  'color.base.blue.400': '#6f96ff',
  'color.base.blue.800': '#0b4dba',
  'color.base.green.600': '#24786a',
  'color.text.primary': '#17202b',
  'color.text.secondary': '#667582',
  'color.surface.canvas': '#f2f5f7',
  'font.family.sans': '"Noto Sans SC", sans-serif',
  'font.size.body': '14px',
  'spacing.base.2': '8px',
  'radius.control': '6px',
  'shadow.raised': '0 8px 28px rgba(22,35,48,.14)',
  'component.button.primary.bg': '{color.semantic.primary}',
  'component.button.primary.text': '#ffffff'
};

const seedUsage = {
  lib: { 'color.base.blue.600': 184, 'color.semantic.primary': 126, 'component.button.primary.bg': 98, 'radius.control': 60, 'font.size.body': 255 },
  ops: { 'color.base.green.600': 67, 'color.semantic.primary': 88, 'radius.control': 40 },
  mobile: { 'color.base.blue.600': 42, 'font.size.body': 90, 'shadow.raised': 12 },
  data: { 'color.text.primary': 120, 'spacing.base.2': 300, 'radius.control': 0 },
  open: { 'color.base.blue.600': 18, 'component.button.primary.bg': 22 }
};

function makeRelease(version: string, daysAgo: number, overrides: Record<string, string>): Release {
  const snapshot = { ...baseSnapshot, ...overrides };
  return { version, publishedAt: Date.now() - daysAgo * DAY, snapshot, fingerprint: fingerprintOf(snapshot), status: 'online' };
}

function seedState() {
  const releases = [
    makeRelease('4.5.0', 84, { 'radius.control': '8px', 'color.base.blue.600': '#2456c8' }),
    makeRelease('4.5.1', 37, { 'radius.control': '8px' }),
    makeRelease('4.5.2', 22, {})
  ];
  const byVersion = Object.fromEntries(releases.map((release) => [release.version, release]));
  const tampered = (release: Release) => fingerprintOf({ ...release.snapshot, 'radius.control': '13px' });
  const now = Date.now();
  const seeds: [string, string, string, string, Record<string, number>, BindingState, string][] = [
    ['组件库 Web', 'light', '4.5.2', byVersion['4.5.2'].fingerprint, seedUsage.lib, 'matched', '回执与发布快照一致'],
    ['运营后台', 'light', '4.5.1', byVersion['4.5.1'].fingerprint, seedUsage.ops, 'matched', '回执与发布快照一致'],
    ['运营后台', 'ops', '4.5.1', tampered(byVersion['4.5.1']), seedUsage.ops, 'deviation', '指纹与发布快照不一致'],
    ['移动端组件', 'dark', '4.5.0', byVersion['4.5.0'].fingerprint, seedUsage.mobile, 'matched', '回执与发布快照一致'],
    ['数据平台', 'light', '4.5.2', tampered(byVersion['4.5.2']), seedUsage.data, 'deviation', '指纹与发布快照不一致'],
    ['开放平台', 'light', '4.5.0', byVersion['4.5.0'].fingerprint, seedUsage.open, 'matched', '回执与发布快照一致']
  ];
  const bindings: Record<string, Binding> = {};
  const receipts: ReceiptRecord[] = [];
  seeds.forEach(([product, theme, version, fingerprint, usage, state, note], index) => {
    const receivedAt = now - (seeds.length - index) * 3600000;
    bindings[`${product}::${theme}`] = { product, theme, version, fingerprint, usage, state, note, updatedAt: receivedAt };
    receipts.push({ id: `RC-000${index + 1}`, product, theme, version, fingerprint, usage, terminal: '网关-1', receivedAt, verdict: state === 'matched' ? 'matched' : 'deviation' });
  });
  return {
    releases,
    bindings,
    receipts,
    journal: [] as RollbackEntry[],
    invalidations: [] as InvalidationEvent[],
    audits: [] as AuditRecord[],
    currentVersion: '4.5.2',
    role: 'maintainer' as Role,
    receiptSeq: seeds.length
  };
}

const storageKey = 'yy63-reconcile-v1';

export const useReconcileStore = defineStore('reconcile', {
  state: () => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    if (raw) {
      try {
        return JSON.parse(raw) as ReturnType<typeof seedState>;
      } catch {
        // 落盘数据损坏时退回种子数据。
      }
    }
    return seedState();
  },
  getters: {
    sortedReleases(state): Release[] {
      return [...state.releases].sort((a, b) => b.publishedAt - a.publishedAt);
    },
    bindingList(state): Binding[] {
      return Object.values(state.bindings).sort((a, b) => a.product.localeCompare(b.product, 'zh-CN') || a.theme.localeCompare(b.theme));
    },
    deviations(): Binding[] {
      return this.bindingList.filter((binding) => binding.state === 'deviation');
    },
    duplicateCount(state): number {
      return state.receipts.filter((receipt) => receipt.verdict === 'duplicate').length;
    },
    nextRollbackNo(state): number {
      return state.journal.reduce((max, entry) => Math.max(max, entry.rollbackNo), 0) + 1;
    },
    // 覆盖率只能由回执对账推导：所有活跃绑定都对当前发布匹配才算已覆盖。
    currentCoverage(state): { matched: number; total: number; pct: number; covered: boolean } {
      const active = Object.values(state.bindings).filter((binding) => binding.state !== 'unbound');
      const matched = active.filter((binding) => binding.version === state.currentVersion && binding.state === 'matched');
      const pct = active.length ? Math.round((matched.length / active.length) * 100) : 0;
      return { matched: matched.length, total: active.length, pct, covered: active.length > 0 && matched.length === active.length };
    }
  },
  actions: {
    statsOf(version: string) {
      const bound = this.bindingList.filter((binding) => binding.version === version && binding.state !== 'unbound');
      return {
        bound: bound.length,
        matched: bound.filter((binding) => binding.state === 'matched').length,
        deviation: bound.filter((binding) => binding.state === 'deviation').length,
        invalidated: bound.filter((binding) => binding.state === 'invalidated').length
      };
    },
    isForceEndEligible(release: Release): boolean {
      return release.status === 'online' && release.version !== this.currentVersion && Date.now() - release.publishedAt >= LONG_ONLINE_DAYS * DAY;
    },
    setRole(role: Role) {
      this.role = role;
      this.persist();
    },
    audit(action: string, actor: string, detail: string, result: 'accepted' | 'rejected') {
      this.audits.push({ id: `AUD-${String(this.audits.length + 1).padStart(3, '0')}`, action, actor, detail, result, createdAt: Date.now() });
    },
    // 回执入账：按回执号幂等，重复回执只登记流水、不参与计数。
    ingestReceipt(receipt: Omit<ReceiptRecord, 'verdict'>): ReceiptVerdict {
      const exists = this.receipts.some((record) => record.id === receipt.id && record.verdict !== 'duplicate');
      if (exists) {
        this.receipts.push({ ...receipt, verdict: 'duplicate' });
        this.persist();
        return 'duplicate';
      }
      const release = this.releases.find((item) => item.version === receipt.version);
      const matched = !!release && release.status === 'online' && release.fingerprint === receipt.fingerprint;
      const verdict: ReceiptVerdict = matched ? 'matched' : 'deviation';
      const note = matched
        ? '回执与发布快照一致'
        : !release
          ? '回执指向未知版本'
          : release.status !== 'online'
            ? '所属版本已结束，需迁移到当前发布'
            : '指纹与发布快照不一致';
      this.receipts.push({ ...receipt, verdict });
      this.bindings[`${receipt.product}::${receipt.theme}`] = {
        product: receipt.product,
        theme: receipt.theme,
        version: receipt.version,
        fingerprint: receipt.fingerprint,
        usage: receipt.usage,
        state: verdict,
        note,
        updatedAt: receipt.receivedAt
      };
      this.persist();
      return verdict;
    },
    // 模拟一批产品回执：多数按当前发布匹配上报，运营后台带篡改指纹，移动端组件留在旧版本。
    simulateInbound() {
      const current = this.releases.find((item) => item.version === this.currentVersion && item.status === 'online')
        ?? this.sortedReleases.find((item) => item.status === 'online');
      if (!current) return { total: 0, matched: 0, deviation: 0 };
      const now = Date.now();
      const tampered = fingerprintOf({ ...current.snapshot, 'radius.control': '13px' });
      const nextId = () => `RC-${String(this.receiptSeq += 1).padStart(4, '0')}`;
      const mobileBinding = this.bindings['移动端组件::dark'];
      const mobileRelease = this.releases.find((item) => item.version === mobileBinding?.version);
      const mobileTarget = mobileRelease && mobileRelease.status === 'online' ? mobileRelease : current;
      const plan: Omit<ReceiptRecord, 'verdict' | 'id' | 'receivedAt'>[] = [
        { product: '组件库 Web', theme: 'light', version: current.version, fingerprint: current.fingerprint, usage: { ...seedUsage.lib }, terminal: '网关-1' },
        { product: '运营后台', theme: 'light', version: current.version, fingerprint: current.fingerprint, usage: { ...seedUsage.ops }, terminal: '网关-2' },
        { product: '运营后台', theme: 'ops', version: current.version, fingerprint: tampered, usage: { ...seedUsage.ops }, terminal: '网关-2' },
        { product: '移动端组件', theme: 'dark', version: mobileTarget.version, fingerprint: mobileTarget.fingerprint, usage: { ...seedUsage.mobile }, terminal: '网关-1' },
        { product: '数据平台', theme: 'light', version: current.version, fingerprint: current.fingerprint, usage: { ...seedUsage.data }, terminal: '网关-3' },
        { product: '开放平台', theme: 'light', version: current.version, fingerprint: current.fingerprint, usage: { ...seedUsage.open }, terminal: '网关-3' }
      ];
      let matched = 0;
      let deviation = 0;
      plan.forEach((item, index) => {
        const verdict = this.ingestReceipt({ ...item, id: nextId(), receivedAt: now + index });
        if (verdict === 'matched') matched += 1;
        if (verdict === 'deviation') deviation += 1;
      });
      return { total: plan.length, matched, deviation };
    },
    replayLastReceipt(): ReceiptVerdict | 'none' {
      const last = [...this.receipts].reverse().find((record) => record.verdict !== 'duplicate');
      if (!last) return 'none';
      const { verdict, ...receipt } = last;
      return this.ingestReceipt({ ...receipt, receivedAt: Date.now() });
    },
    // 基础令牌或组件别名改动：受影响产品按新快照失效重算；
    // 受影响引用已降到零的产品解除旧版本绑定，不再占用旧版本名额。
    registerTokenChange(tokenId: string, affectedTokens: string[], snapshot: Record<string, string>) {
      const expectedFingerprint = fingerprintOf(snapshot);
      const invalidated: string[] = [];
      const unbound: string[] = [];
      Object.values(this.bindings).forEach((binding) => {
        if (binding.state === 'unbound') return;
        const affectedUsage = affectedTokens.reduce((sum, id) => sum + (binding.usage[id] ?? 0), 0);
        if (affectedUsage === 0) {
          binding.state = 'unbound';
          binding.note = '受影响引用已降为零，不得继续绑定旧版本';
          unbound.push(binding.product);
        } else {
          binding.state = 'invalidated';
          binding.note = `按新快照失效重算 · 受影响引用 ${affectedUsage} 处`;
          invalidated.push(binding.product);
        }
        binding.updatedAt = Date.now();
      });
      this.invalidations.push({
        id: `INV-${String(this.invalidations.length + 1).padStart(3, '0')}`,
        tokenId,
        affectedTokens,
        expectedFingerprint,
        invalidated,
        unbound,
        createdAt: Date.now()
      });
      this.persist();
    },
    publishRelease(version: string, snapshot: Record<string, string>) {
      if (this.releases.some((item) => item.version === version)) return;
      const fingerprint = fingerprintOf(snapshot);
      this.releases.push({ version, publishedAt: Date.now(), snapshot, fingerprint, status: 'online' });
      this.currentVersion = version;
      this.audit('发布版本', '设计系统维护员', `DS ${version} 快照指纹 ${fingerprint}`, 'accepted');
      this.persist();
    },
    // 同一回滚号先到生效；后到的提交不覆盖，内容留作冲突。
    submitRollback(payload: { rollbackNo: number; targetVersion: string; note: string; terminal: string; actor: string; crash?: boolean }): RollbackStatus {
      const existing = this.journal.find((entry) => entry.rollbackNo === payload.rollbackNo && entry.status !== 'conflict');
      if (existing) {
        this.journal.push({ rollbackNo: payload.rollbackNo, targetVersion: payload.targetVersion, note: payload.note, terminal: payload.terminal, actor: payload.actor, status: 'conflict', createdAt: Date.now() });
        this.audit('回滚冲突', payload.actor, `回滚号 ${payload.rollbackNo} 已被 ${existing.terminal} 占用，本次内容留作冲突`, 'accepted');
        this.persist();
        return 'conflict';
      }
      const entry: RollbackEntry = { rollbackNo: payload.rollbackNo, targetVersion: payload.targetVersion, note: payload.note, terminal: payload.terminal, actor: payload.actor, status: 'pending', createdAt: Date.now() };
      this.journal.push(entry);
      this.persist(); // 先落回滚日志再应用；此处中断可凭回滚号恢复。
      if (payload.crash) return 'pending';
      this.applyRollback(entry);
      return 'applied';
    },
    applyRollback(entry: RollbackEntry) {
      if (entry.status === 'applied') return;
      const target = this.releases.find((item) => item.version === entry.targetVersion);
      if (!target || target.status === 'force-ended') {
        entry.status = 'conflict';
        this.audit('回滚失败', entry.actor, `回滚号 ${entry.rollbackNo} 目标版本不可用`, 'rejected');
        this.persist();
        return;
      }
      target.status = 'online';
      this.currentVersion = target.version;
      this.releases.forEach((release) => {
        if (release.version !== target.version && release.status === 'online' && release.publishedAt > target.publishedAt) {
          release.status = 'rolled-back';
        }
      });
      Object.values(this.bindings).forEach((binding) => {
        const release = this.releases.find((item) => item.version === binding.version);
        if (release && release.status === 'rolled-back' && binding.state !== 'unbound') {
          binding.state = 'invalidated';
          binding.note = '所属版本已回滚，按回滚目标快照重算';
          binding.updatedAt = Date.now();
        }
      });
      entry.status = 'applied';
      this.audit('回滚生效', entry.actor, `回滚号 ${entry.rollbackNo} → DS ${entry.targetVersion}`, 'accepted');
      this.persist();
    },
    // 写入中断后的恢复：按回滚号升序补完未应用的日志，幂等。
    recover(): number {
      const pending = this.journal.filter((entry) => entry.status === 'pending').sort((a, b) => a.rollbackNo - b.rollbackNo);
      pending.forEach((entry) => this.applyRollback(entry));
      if (pending.length) {
        this.audit('断点恢复', '系统', `按回滚号恢复 ${pending.map((entry) => entry.rollbackNo).join('、')}`, 'accepted');
        this.persist();
      }
      return pending.length;
    },
    async forceEnd(version: string, actor: string): Promise<{ ok: boolean; reason: string }> {
      const release = this.releases.find((item) => item.version === version);
      if (!release) return { ok: false, reason: '版本不存在' };
      if (release.version === this.currentVersion) return { ok: false, reason: '当前发布不能强制结束' };
      if (release.status !== 'online') return { ok: false, reason: '仅在线旧版本可强制结束' };
      if (Date.now() - release.publishedAt < LONG_ONLINE_DAYS * DAY) return { ok: false, reason: `在线不足 ${LONG_ONLINE_DAYS} 天，不属于长期在线旧版本` };
      try {
        await postForceEnd({ version, actor, role: this.role });
      } catch {
        this.audit('强制结束', actor, `DS ${version} 越权提交被拒绝`, 'rejected');
        this.persist();
        return { ok: false, reason: '提交被拒绝（403）：仅设计系统管理员可强制结束旧版本' };
      }
      release.status = 'force-ended';
      Object.values(this.bindings).forEach((binding) => {
        if (binding.version === version && binding.state !== 'unbound') {
          binding.state = 'invalidated';
          binding.note = '所属版本被强制结束，需迁移到当前发布';
          binding.updatedAt = Date.now();
        }
      });
      this.audit('强制结束', actor, `DS ${version} 已强制结束`, 'accepted');
      this.persist();
      return { ok: true, reason: '' };
    },
    persist() {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(storageKey, JSON.stringify({
        releases: this.releases,
        bindings: this.bindings,
        receipts: this.receipts,
        journal: this.journal,
        invalidations: this.invalidations,
        audits: this.audits,
        currentVersion: this.currentVersion,
        role: this.role,
        receiptSeq: this.receiptSeq
      }));
    }
  }
});
