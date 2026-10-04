import { defineStore } from 'pinia';
import type { Token } from '../api';
import { initialTokens } from '../store';
import { snapshotFingerprints } from './fingerprint';
import { changedTokenIds, computeAffectedProducts, isLongOnline, reconcile } from './engine';
import type {
  Actor,
  ConflictRecord,
  Deviation,
  JournalEntry,
  Product,
  Receipt,
  ReconcileState,
  ReleaseSnapshot,
  RollbackRecord,
  TerminateAttempt
} from './types';

const STORAGE_KEY = 'yy63-reconciliation';
const THEMES = ['light', 'dark', 'ops', 'contrast'];
const LONG_ONLINE_DAYS = 30;

const ADMIN: Actor = { id: 'u-admin', name: '沈砚', role: 'admin' };
const MAINTAINER: Actor = { id: 'u-maintainer', name: '顾清', role: 'maintainer' };

function legacyTokens452(): Token[] {
  return initialTokens.map((token) =>
    token.id === 'color.base.blue.600'
      ? { ...token, value: '#1f4fd1', themes: { ...token.themes, light: '#1f4fd1', dark: '#5f86e8' } }
      : token
  );
}

function legacyTokens451(): Token[] {
  return initialTokens.map((token) =>
    token.id === 'radius.control'
      ? { ...token, value: '8px', themes: { ...token.themes, light: '8px', dark: '8px', ops: '6px', contrast: '6px' } }
      : token
  );
}

function buildSeedState(): ReconcileState {
  const now = Date.now();
  const fp460 = snapshotFingerprints(initialTokens, THEMES);
  const fp452 = snapshotFingerprints(legacyTokens452(), THEMES);
  const fp451 = snapshotFingerprints(legacyTokens451(), THEMES);

  const releases: ReleaseSnapshot[] = [
    { version: 'DS 4.6.0-rc.2', label: '品牌主题 · 明暗与高对比', createdAt: now - 2 * 3_600_000, status: 'active', fingerprints: fp460, tokenCount: initialTokens.length, tokens: initialTokens, basedOn: 'DS 4.5.2' },
    { version: 'DS 4.5.2', label: '旧版品牌蓝', createdAt: now - 45 * 86_400_000, status: 'superseded', fingerprints: fp452, tokenCount: legacyTokens452().length, tokens: legacyTokens452(), basedOn: 'DS 4.5.1' },
    { version: 'DS 4.5.1', label: '旧版圆角基线', createdAt: now - 76 * 86_400_000, status: 'superseded', fingerprints: fp451, tokenCount: legacyTokens451().length, tokens: legacyTokens451(), basedOn: null }
  ];

  const products: Product[] = [
    { id: 'p-lib', name: '组件库', owner: '组件维护组', usage: 12, boundVersion: 'DS 4.6.0-rc.2', tokenIds: ['component.button.primary.bg', 'color.semantic.primary', 'color.base.blue.600', 'radius.control', 'font.size.body'] },
    { id: 'p-ops', name: '运营后台', owner: '运营设计组', usage: 34, boundVersion: 'DS 4.6.0-rc.2', tokenIds: ['color.semantic.primary', 'color.base.blue.600', 'color.text.primary', 'color.surface.canvas'] },
    { id: 'p-mobile', name: '移动端组件', owner: '移动平台组', usage: 0, boundVersion: 'DS 4.5.2', tokenIds: ['component.button.primary.bg', 'color.semantic.primary'] },
    { id: 'p-data', name: '数据平台', owner: '数据平台组', usage: 8, boundVersion: 'DS 4.6.0-rc.2', tokenIds: ['color.text.primary', 'color.text.secondary', 'font.family.sans'] }
  ];

  const receipts: Receipt[] = [
    { id: 'RCP-LIB-001', productId: 'p-lib', theme: 'light', fingerprint: fp460.light, claimedVersion: 'DS 4.6.0-rc.2', receivedAt: now - 3_600_000, rollbackNumber: 1001, invalidated: false },
    { id: 'RCP-OPS-001', productId: 'p-ops', theme: 'light', fingerprint: fp452.light, claimedVersion: 'DS 4.6.0-rc.2', receivedAt: now - 3_500_000, rollbackNumber: 1001, invalidated: false },
    { id: 'RCP-DATA-001', productId: 'p-data', theme: 'light', fingerprint: fp460.light, claimedVersion: 'DS 4.6.0-rc.2', receivedAt: now - 3_400_000, rollbackNumber: 1001, invalidated: false },
    { id: 'RCP-MOB-001', productId: 'p-mobile', theme: 'light', fingerprint: fp452.light, claimedVersion: 'DS 4.5.2', receivedAt: now - 3_300_000, rollbackNumber: 1001, invalidated: false }
  ];

  const journal: JournalEntry[] = [
    { rollbackNumber: 1001, type: 'release', at: now - 76 * 86_400_000, payload: { version: 'DS 4.5.1', label: '旧版圆角基线', tokens: legacyTokens451(), basedOn: null } },
    { rollbackNumber: 1002, type: 'rollback', at: now - 46 * 86_400_000, payload: { targetVersion: 'DS 4.5.2', requestedBy: '终端 A · 发布流水线' } },
    { rollbackNumber: 1003, type: 'release', at: now - 2 * 3_600_000, payload: { version: 'DS 4.6.0-rc.2', label: '品牌主题 · 明暗与高对比', tokens: initialTokens, basedOn: 'DS 4.5.2' } },
    { rollbackNumber: 1004, type: 'terminate', at: now - 86_400_000, payload: { version: 'DS 4.5.2', actor: '顾清', role: 'maintainer', allowed: false, reason: '越权拒绝：仅设计系统管理员可强制结束长期在线旧版本，当前身份 顾清（维护员）' } },
    { rollbackNumber: 1005, type: 'rollback', at: now - 1_800_000, payload: { targetVersion: 'DS 4.5.2', requestedBy: '终端 A · 发布流水线' } }
  ];

  const conflicts: ConflictRecord[] = [
    { id: 'CF-1002-B', rollbackNumber: 1002, targetVersion: 'DS 4.5.2', requestedBy: '终端 B · 发布流水线', requestedAt: now - 46 * 86_400_000 + 1200, reason: '回滚号 1002 已由先到请求生效，本请求内容留作冲突', winnerRollbackNumber: 1002, content: JSON.stringify({ targetVersion: 'DS 4.5.2', requestedBy: '终端 B · 发布流水线' }) }
  ];

  const rollbacks: RollbackRecord[] = [
    { rollbackNumber: 1002, targetVersion: 'DS 4.5.2', requestedBy: '终端 A · 发布流水线', requestedAt: now - 46 * 86_400_000, status: 'applied' },
    { rollbackNumber: 1005, targetVersion: 'DS 4.5.2', requestedBy: '终端 A · 发布流水线', requestedAt: now - 1_800_000, status: 'interrupted' }
  ];

  const terminateAttempts: TerminateAttempt[] = [
    { id: 'TA-1004', version: 'DS 4.5.2', actor: '顾清', role: 'maintainer', at: now - 86_400_000, allowed: false, reason: '越权拒绝：仅设计系统管理员可强制结束长期在线旧版本，当前身份 顾清（维护员）', rollbackNumber: 1004 }
  ];

  const activeVersion = releases.find((release) => release.status === 'active')!.version;
  const rec = reconcile({ receipts, products, releases, rollbackNumber: 1003 });
  const deviations: Deviation[] = [...rec.deviations];
  for (const product of products) {
    if (product.usage === 0 && product.boundVersion && product.boundVersion !== activeVersion) {
      deviations.push({
        id: `DEV-ZB-${product.id}`,
        productId: product.id,
        theme: '-',
        kind: 'zero-binding',
        boundVersion: product.boundVersion,
        expectedFingerprint: '-',
        actualFingerprint: '-',
        matchedVersion: null,
        detectedAt: now,
        status: 'open',
        rollbackNumber: 1003,
        detail: `产品用量已降到 0，不能继续绑定旧版本 ${product.boundVersion}，请迁移到当前版本或解绑`
      });
    }
  }

  return {
    releases,
    products,
    receipts,
    deviations,
    rollbacks,
    conflicts,
    terminateAttempts,
    journal,
    durableUpTo: 1005,
    appliedUpTo: 1004,
    nextRollbackNumber: 1006,
    currentActor: MAINTAINER,
    lastAffectedProductIds: [],
    lastRecoveredAt: 0
  };
}

function loadState(): ReconcileState | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReconcileState>;
    return { ...buildSeedState(), ...parsed } as ReconcileState;
  } catch {
    return null;
  }
}

export const useReconcileStore = defineStore('reconcile', {
  state: (): ReconcileState => loadState() ?? buildSeedState(),
  getters: {
    activeVersion(state): string {
      return state.releases.find((release) => release.status === 'active')?.version ?? '';
    },
    activeRelease(state): ReleaseSnapshot | undefined {
      return state.releases.find((release) => release.status === 'active');
    },
    releaseCoverage(state) {
      return (version: string) => {
        const bound = state.products.filter((product) => product.boundVersion === version);
        const boundIds = new Set(bound.map((product) => product.id));
        const receipts = state.receipts.filter((receipt) => boundIds.has(receipt.productId) && !receipt.invalidated);
        const release = state.releases.find((item) => item.version === version);
        const fingerprint = release?.fingerprints;
        let matched = 0;
        for (const receipt of receipts) {
          if (fingerprint && fingerprint[receipt.theme] === receipt.fingerprint) matched += 1;
        }
        const covered = bound.filter((product) => {
          const list = receipts.filter((receipt) => receipt.productId === product.id);
          return list.length > 0 && list.every((receipt) => fingerprint && fingerprint[receipt.theme] === receipt.fingerprint);
        }).length;
        return { products: bound.length, receipts: receipts.length, matched, covered };
      };
    },
    openDeviations(state): Deviation[] {
      return state.deviations.filter((deviation) => deviation.status === 'open' && deviation.kind === 'fingerprint');
    },
    zeroBindingDeviations(state): Deviation[] {
      return state.deviations.filter((deviation) => deviation.kind === 'zero-binding');
    },
    longOnlineReleases(state): ReleaseSnapshot[] {
      return state.releases.filter((release) => isLongOnline(release, Date.now(), LONG_ONLINE_DAYS));
    },
    interrupted(state): boolean {
      return state.durableUpTo > state.appliedUpTo;
    },
    pendingRecoverEntries(state): JournalEntry[] {
      return state.journal.filter((entry) => entry.rollbackNumber > state.appliedUpTo && entry.rollbackNumber <= state.durableUpTo);
    },
    stats(state) {
      const openDeviations = state.deviations.filter((deviation) => deviation.status === 'open' && deviation.kind === 'fingerprint').length;
      const zeroBindings = state.deviations.filter((deviation) => deviation.kind === 'zero-binding').length;
      const longOnline = state.releases.filter((release) => isLongOnline(release, Date.now(), LONG_ONLINE_DAYS)).length;
      const conflicts = state.conflicts.length;
      const pendingAffected = state.receipts.filter((receipt) => receipt.invalidated).length;
      return { openDeviations, zeroBindings, longOnline, conflicts, interrupted: state.durableUpTo > state.appliedUpTo, pendingAffected };
    },
    coveredProductIds(state): string[] {
      const result = reconcile({ receipts: state.receipts, products: state.products, releases: state.releases, rollbackNumber: state.appliedUpTo });
      return result.coveredProductIds;
    }
  },
  actions: {
    persist() {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        releases: this.releases,
        products: this.products,
        receipts: this.receipts,
        deviations: this.deviations,
        rollbacks: this.rollbacks,
        conflicts: this.conflicts,
        terminateAttempts: this.terminateAttempts,
        journal: this.journal,
        durableUpTo: this.durableUpTo,
        appliedUpTo: this.appliedUpTo,
        nextRollbackNumber: this.nextRollbackNumber,
        currentActor: this.currentActor,
        lastAffectedProductIds: this.lastAffectedProductIds,
        lastRecoveredAt: this.lastRecoveredAt
      }));
    },
    recompute() {
      const result = reconcile({ receipts: this.receipts, products: this.products, releases: this.releases, rollbackNumber: this.appliedUpTo });
      const deviations: Deviation[] = [...result.deviations];
      for (const product of this.products) {
        if (product.usage === 0 && product.boundVersion && product.boundVersion !== this.activeVersion) {
          deviations.push({
            id: `DEV-ZB-${product.id}`,
            productId: product.id,
            theme: '-',
            kind: 'zero-binding',
            boundVersion: product.boundVersion,
            expectedFingerprint: '-',
            actualFingerprint: '-',
            matchedVersion: null,
            detectedAt: Date.now(),
            status: 'open',
            rollbackNumber: this.appliedUpTo,
            detail: `产品用量已降到 0，不能继续绑定旧版本 ${product.boundVersion}，请迁移到当前版本或解绑`
          });
        }
      }
      this.deviations = deviations;
    },
    invalidateAffected(prevTokens: Token[], nextTokens: Token[]) {
      const changed = changedTokenIds(prevTokens, nextTokens, THEMES);
      const affected = computeAffectedProducts(this.products, changed, nextTokens);
      this.lastAffectedProductIds = affected;
      const affectedSet = new Set(affected);
      this.receipts.forEach((receipt) => { if (affectedSet.has(receipt.productId)) receipt.invalidated = true; });
    },
    applyEntry(entry: JournalEntry) {
      switch (entry.type) {
        case 'release': {
          const { version, label, tokens, basedOn } = entry.payload;
          const prev = this.releases.find((release) => release.status === 'active');
          const fingerprints = snapshotFingerprints(tokens, THEMES);
          const existing = this.releases.find((release) => release.version === version);
          if (existing && existing.status === 'active') {
            const prevTokens = existing.tokens;
            existing.fingerprints = fingerprints;
            existing.tokens = tokens;
            existing.tokenCount = tokens.length;
            if (label) existing.label = label;
            this.invalidateAffected(prevTokens, tokens);
          } else {
            this.releases.forEach((release) => { if (release.status === 'active') release.status = 'superseded'; });
            this.releases.push({
              version,
              label,
              createdAt: entry.at,
              status: 'active',
              fingerprints,
              tokenCount: tokens.length,
              tokens,
              basedOn: basedOn ?? prev?.version ?? null
            });
            if (prev) this.invalidateAffected(prev.tokens, tokens);
          }
          this.recompute();
          break;
        }
        case 'receipt': {
          const payload = entry.payload;
          if (this.receipts.some((receipt) => receipt.id === payload.id)) break;
          this.receipts = this.receipts.filter((receipt) => !(receipt.productId === payload.productId && receipt.theme === payload.theme));
          this.receipts.push({
            id: payload.id,
            productId: payload.productId,
            theme: payload.theme,
            fingerprint: payload.fingerprint,
            claimedVersion: payload.claimedVersion,
            receivedAt: entry.at,
            rollbackNumber: entry.rollbackNumber,
            invalidated: false
          });
          this.recompute();
          break;
        }
        case 'rollback': {
          const { targetVersion, requestedBy } = entry.payload;
          const existing = this.rollbacks.find((rollback) => rollback.rollbackNumber === entry.rollbackNumber);
          if (existing) {
            if (existing.status === 'interrupted') {
              this.releases.forEach((release) => {
                if (release.version === targetVersion) release.status = 'active';
                else if (release.status === 'active') release.status = 'superseded';
              });
              existing.status = 'applied';
              this.recompute();
              break;
            }
            this.conflicts.push({
              id: `CF-${entry.rollbackNumber}-${this.conflicts.length + 1}`,
              rollbackNumber: entry.rollbackNumber,
              targetVersion,
              requestedBy,
              requestedAt: entry.at,
              reason: `回滚号 ${entry.rollbackNumber} 已由先到请求生效，本请求内容留作冲突`,
              winnerRollbackNumber: entry.rollbackNumber,
              content: JSON.stringify(entry.payload)
            });
            break;
          }
          this.releases.forEach((release) => {
            if (release.version === targetVersion) release.status = 'active';
            else if (release.status === 'active') release.status = 'superseded';
          });
          this.rollbacks.push({
            rollbackNumber: entry.rollbackNumber,
            targetVersion,
            requestedBy,
            requestedAt: entry.at,
            status: 'applied'
          });
          this.recompute();
          break;
        }
        case 'terminate': {
          const { version, actor, role, allowed, reason } = entry.payload;
          this.terminateAttempts.push({
            id: `TA-${entry.rollbackNumber}`,
            version,
            actor,
            role,
            at: entry.at,
            allowed,
            reason,
            rollbackNumber: entry.rollbackNumber
          });
          if (allowed) {
            const release = this.releases.find((item) => item.version === version);
            if (release) release.status = 'terminated';
            this.products.forEach((product) => { if (product.boundVersion === version) product.boundVersion = null; });
            this.recompute();
          }
          break;
        }
        case 'usage': {
          const product = this.products.find((item) => item.id === entry.payload.productId);
          if (product) product.usage = entry.payload.usage;
          this.recompute();
          break;
        }
        case 'bind': {
          const product = this.products.find((item) => item.id === entry.payload.productId);
          if (product) product.boundVersion = entry.payload.version;
          this.recompute();
          break;
        }
      }
    },
    nextRollback(): number {
      const rn = this.nextRollbackNumber;
      this.nextRollbackNumber += 1;
      return rn;
    },
    publishSnapshot(version: string, tokens: Token[], label?: string) {
      const rn = this.nextRollback();
      const entry: JournalEntry = {
        rollbackNumber: rn,
        type: 'release',
        at: Date.now(),
        payload: { version, label: label ?? version, tokens, basedOn: this.activeVersion || null }
      };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
      return { rollbackNumber: rn };
    },
    submitReceipt(input: { id?: string; productId: string; theme: string; fingerprint: string; claimedVersion?: string | null }) {
      const rn = this.nextRollback();
      const id = input.id ?? `RCP-${rn}-${Date.now().toString().slice(-4)}`;
      const entry: JournalEntry = {
        rollbackNumber: rn,
        type: 'receipt',
        at: Date.now(),
        payload: { id, productId: input.productId, theme: input.theme, fingerprint: input.fingerprint, claimedVersion: input.claimedVersion ?? null }
      };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
      return { rollbackNumber: rn, id };
    },
    submitRollback(input: { rollbackNumber?: number; targetVersion: string; requestedBy: string }) {
      const rn = input.rollbackNumber ?? this.nextRollback();
      if (input.rollbackNumber !== undefined && input.rollbackNumber >= this.nextRollbackNumber) {
        this.nextRollbackNumber = input.rollbackNumber + 1;
      }
      const target = this.releases.find((release) => release.version === input.targetVersion);
      if (!target) return { ok: false as const, error: 'NOT_FOUND', message: '目标版本不存在', rollbackNumber: rn };
      if (target.status === 'terminated') return { ok: false as const, error: 'TERMINATED', message: '目标版本已强制结束，不能回滚', rollbackNumber: rn };
      const before = this.conflicts.length;
      const entry: JournalEntry = {
        rollbackNumber: rn,
        type: 'rollback',
        at: Date.now(),
        payload: { targetVersion: input.targetVersion, requestedBy: input.requestedBy }
      };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
      const conflict = this.conflicts.length > before ? this.conflicts[this.conflicts.length - 1] : null;
      return { ok: !conflict, conflict, rollbackNumber: rn };
    },
    recover() {
      const pending = this.journal
        .filter((entry) => entry.rollbackNumber > this.appliedUpTo && entry.rollbackNumber <= this.durableUpTo)
        .sort((a, b) => a.rollbackNumber - b.rollbackNumber);
      for (const entry of pending) this.applyEntry(entry);
      this.appliedUpTo = this.durableUpTo;
      this.lastRecoveredAt = Date.now();
      this.persist();
      return { recovered: pending.length, entries: pending.map((entry) => entry.rollbackNumber) };
    },
    simulateInterruption(kind: 'rollback' | 'receipt' | 'usage', payload: { targetVersion?: string; requestedBy?: string; productId?: string; theme?: string; fingerprint?: string; usage?: number }) {
      const rn = this.nextRollback();
      let entry: JournalEntry;
      if (kind === 'rollback') {
        entry = { rollbackNumber: rn, type: 'rollback', at: Date.now(), payload: { targetVersion: payload.targetVersion ?? this.activeVersion, requestedBy: payload.requestedBy ?? '终端 A · 发布流水线' } };
      } else if (kind === 'receipt') {
        entry = { rollbackNumber: rn, type: 'receipt', at: Date.now(), payload: { id: `RCP-${rn}-INT`, productId: payload.productId ?? this.products[0]?.id ?? '', theme: payload.theme ?? 'light', fingerprint: payload.fingerprint ?? '', claimedVersion: null } };
      } else {
        entry = { rollbackNumber: rn, type: 'usage', at: Date.now(), payload: { productId: payload.productId ?? this.products[0]?.id ?? '', usage: payload.usage ?? 0 } };
      }
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.persist();
      return { rollbackNumber: rn, interrupted: true as const };
    },
    forceTerminate(version: string) {
      const actor = this.currentActor;
      const rn = this.nextRollback();
      const release = this.releases.find((item) => item.version === version);
      let allowed = false;
      let reason = '';
      if (actor.role !== 'admin') {
        reason = `越权拒绝：仅设计系统管理员可强制结束长期在线旧版本，当前身份 ${actor.name}（${actor.role === 'maintainer' ? '维护员' : '管理员'}）`;
      } else if (!release) {
        reason = '目标版本不存在';
      } else if (release.status === 'terminated') {
        reason = '该版本已结束';
      } else if (release.status !== 'superseded') {
        reason = '仅长期在线的旧版本可强制结束';
      } else if (!isLongOnline(release, Date.now(), LONG_ONLINE_DAYS)) {
        reason = '该版本尚未达到长期在线阈值';
      } else {
        allowed = true;
        reason = '管理员强制结束长期在线旧版本';
      }
      const entry: JournalEntry = {
        rollbackNumber: rn,
        type: 'terminate',
        at: Date.now(),
        payload: { version, actor: actor.name, role: actor.role, allowed, reason }
      };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
      return { ok: allowed, reason, rollbackNumber: rn };
    },
    setUsage(productId: string, usage: number) {
      const rn = this.nextRollback();
      const entry: JournalEntry = { rollbackNumber: rn, type: 'usage', at: Date.now(), payload: { productId, usage } };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
    },
    bindProduct(productId: string, version: string | null) {
      const product = this.products.find((item) => item.id === productId);
      if (!product) return { ok: false as const, reason: '产品不存在' };
      if (version && version !== this.activeVersion && product.usage === 0) {
        return { ok: false as const, reason: '产品用量已降到 0，不能继续绑定旧版本，请迁移到当前版本或解绑' };
      }
      const rn = this.nextRollback();
      const entry: JournalEntry = { rollbackNumber: rn, type: 'bind', at: Date.now(), payload: { productId, version } };
      this.journal.push(entry);
      this.durableUpTo = rn;
      this.applyEntry(entry);
      this.appliedUpTo = rn;
      this.persist();
      return { ok: true as const };
    },
    setActor(role: 'admin' | 'maintainer') {
      this.currentActor = role === 'admin' ? { ...ADMIN } : { ...MAINTAINER };
      this.persist();
    }
  }
});
