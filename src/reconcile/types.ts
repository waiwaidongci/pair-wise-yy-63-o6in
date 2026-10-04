import type { Token } from '../api';

export type ActorRole = 'admin' | 'maintainer';

export type Actor = { id: string; name: string; role: ActorRole };

export type ReleaseStatus = 'active' | 'superseded' | 'terminated';

export type ReleaseSnapshot = {
  version: string;
  label: string;
  createdAt: number;
  status: ReleaseStatus;
  fingerprints: Record<string, string>;
  tokenCount: number;
  tokens: Token[];
  basedOn: string | null;
};

export type Product = {
  id: string;
  name: string;
  owner: string;
  usage: number;
  boundVersion: string | null;
  tokenIds: string[];
};

export type Receipt = {
  id: string;
  productId: string;
  theme: string;
  fingerprint: string;
  claimedVersion: string | null;
  receivedAt: number;
  rollbackNumber: number;
  invalidated: boolean;
};

export type Deviation = {
  id: string;
  productId: string;
  theme: string;
  kind: 'fingerprint' | 'zero-binding';
  boundVersion: string;
  expectedFingerprint: string;
  actualFingerprint: string;
  matchedVersion: string | null;
  detectedAt: number;
  status: 'open' | 'resolved';
  rollbackNumber: number;
  detail: string;
};

export type RollbackStatus = 'applied' | 'conflict' | 'interrupted';

export type RollbackRecord = {
  rollbackNumber: number;
  targetVersion: string;
  requestedBy: string;
  requestedAt: number;
  status: RollbackStatus;
};

export type ConflictRecord = {
  id: string;
  rollbackNumber: number;
  targetVersion: string;
  requestedBy: string;
  requestedAt: number;
  reason: string;
  winnerRollbackNumber: number;
  content: string;
};

export type TerminateAttempt = {
  id: string;
  version: string;
  actor: string;
  role: ActorRole;
  at: number;
  allowed: boolean;
  reason: string;
  rollbackNumber: number;
};

export type JournalEntry =
  | { rollbackNumber: number; type: 'release'; at: number; payload: { version: string; label: string; tokens: Token[]; basedOn: string | null } }
  | { rollbackNumber: number; type: 'receipt'; at: number; payload: { id: string; productId: string; theme: string; fingerprint: string; claimedVersion: string | null } }
  | { rollbackNumber: number; type: 'rollback'; at: number; payload: { targetVersion: string; requestedBy: string } }
  | { rollbackNumber: number; type: 'terminate'; at: number; payload: { version: string; actor: string; role: ActorRole; allowed: boolean; reason: string } }
  | { rollbackNumber: number; type: 'usage'; at: number; payload: { productId: string; usage: number } }
  | { rollbackNumber: number; type: 'bind'; at: number; payload: { productId: string; version: string | null } };

export type ReconcileState = {
  releases: ReleaseSnapshot[];
  products: Product[];
  receipts: Receipt[];
  deviations: Deviation[];
  rollbacks: RollbackRecord[];
  conflicts: ConflictRecord[];
  terminateAttempts: TerminateAttempt[];
  journal: JournalEntry[];
  durableUpTo: number;
  appliedUpTo: number;
  nextRollbackNumber: number;
  currentActor: Actor;
  lastAffectedProductIds: string[];
  lastRecoveredAt: number;
};
