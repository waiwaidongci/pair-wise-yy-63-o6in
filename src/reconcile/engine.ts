import type { Token } from '../api';
import type { Deviation, Product, Receipt, ReleaseSnapshot } from './types';
import { buildResolvedMap } from './fingerprint';

/** Token ids whose resolved value changed between two snapshots (any theme). */
export function changedTokenIds(prevTokens: Token[], nextTokens: Token[], themes: string[]): string[] {
  const prev = buildResolvedMap(prevTokens, themes);
  const next = buildResolvedMap(nextTokens, themes);
  const ids = new Set<string>([...Object.keys(prev[themes[0]] ?? {}), ...Object.keys(next[themes[0]] ?? {})]);
  const changed: string[] = [];
  ids.forEach((id) => {
    if (themes.some((theme) => (prev[theme]?.[id] ?? null) !== (next[theme]?.[id] ?? null))) changed.push(id);
  });
  return changed;
}

/**
 * All token ids that (transitively) depend on any of the target ids.
 * Walks ref chains: a component alias depending on a semantic alias that
 * references a changed base token is itself affected.
 */
export function dependentsOf(tokens: Token[], targetIds: Set<string>): Set<string> {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const result = new Set<string>();
  function touches(id: string, seen: Set<string>): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (targetIds.has(id)) return true;
    const ref = byId.get(id)?.ref;
    return !!ref && touches(ref, seen);
  }
  for (const token of tokens) {
    if (touches(token.id, new Set())) result.add(token.id);
  }
  return result;
}

/** Product ids that reference any changed token (directly or via alias chain). */
export function computeAffectedProducts(products: Product[], changedIds: string[], tokens: Token[]): string[] {
  if (!changedIds.length) return [];
  const affectedTokens = dependentsOf(tokens, new Set(changedIds));
  return products.filter((product) => product.tokenIds.some((id) => affectedTokens.has(id))).map((product) => product.id);
}

export type ReconcileResult = {
  deviations: Deviation[];
  matchedReceiptIds: string[];
  coveredProductIds: string[];
};

/**
 * Reconcile receipts against the bound release snapshot.
 *
 * A receipt is matched only when its fingerprint equals the fingerprint of the
 * product's bound release for that theme. Otherwise it becomes a deviation.
 * Invalidated receipts (stale after a snapshot change) are skipped until the
 * product re-submits a receipt for the new snapshot.
 */
export function reconcile(input: {
  receipts: Receipt[];
  products: Product[];
  releases: ReleaseSnapshot[];
  rollbackNumber: number;
}): ReconcileResult {
  const { receipts, products, releases, rollbackNumber } = input;
  const releaseByVersion = new Map(releases.map((release) => [release.version, release]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const deviations: Deviation[] = [];
  const matchedReceiptIds: string[] = [];

  const liveReceipts = receipts.filter((receipt) => !receipt.invalidated);
  for (const receipt of liveReceipts) {
    const product = productById.get(receipt.productId);
    if (!product || !product.boundVersion) continue;
    const release = releaseByVersion.get(product.boundVersion);
    if (!release) continue;
    const expected = release.fingerprints[receipt.theme];
    if (expected && receipt.fingerprint === expected) {
      matchedReceiptIds.push(receipt.id);
      continue;
    }
    let matchedVersion: string | null = null;
    for (const candidate of releases) {
      if (candidate.status === 'terminated') continue;
      if (Object.values(candidate.fingerprints).includes(receipt.fingerprint)) {
        matchedVersion = candidate.version;
        break;
      }
    }
    deviations.push({
      id: `DEV-${receipt.id}`,
      productId: receipt.productId,
      theme: receipt.theme,
      kind: 'fingerprint',
      boundVersion: product.boundVersion,
      expectedFingerprint: expected ?? '(无快照)',
      actualFingerprint: receipt.fingerprint,
      matchedVersion,
      detectedAt: Date.now(),
      status: 'open',
      rollbackNumber,
      detail: matchedVersion
        ? `实际加载的是旧包 ${matchedVersion}，与绑定版本 ${product.boundVersion} 的快照不一致`
        : `包指纹与绑定版本 ${product.boundVersion} 的发布快照不一致`
    });
  }

  const receiptsByProduct = new Map<string, Receipt[]>();
  for (const receipt of liveReceipts) {
    if (!receiptsByProduct.has(receipt.productId)) receiptsByProduct.set(receipt.productId, []);
    receiptsByProduct.get(receipt.productId)!.push(receipt);
  }
  const matchedSet = new Set(matchedReceiptIds);
  const coveredProductIds = [...receiptsByProduct.entries()]
    .filter(([, list]) => list.length > 0 && list.every((receipt) => matchedSet.has(receipt.id)))
    .map(([productId]) => productId);

  return { deviations, matchedReceiptIds, coveredProductIds };
}

/** Whether a release is a long-online old version still bound by products. */
export function isLongOnline(release: ReleaseSnapshot, now: number, thresholdDays: number): boolean {
  if (release.status !== 'superseded') return false;
  const ageDays = (now - release.createdAt) / 86_400_000;
  return ageDays >= thresholdDays;
}
