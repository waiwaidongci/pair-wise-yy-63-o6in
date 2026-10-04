import type { Token } from '../api';

/**
 * Stable 64-bit-ish string hash (cyrb53). Used to turn a canonical token
 * snapshot into a short package fingerprint.
 */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ 0x9e3779b9;
  let h2 = 0x41c6ce57 ^ 0x85ebca6b;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2246822519);
    h2 = Math.imul(h2 ^ ch, 3266489917);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822519) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489917);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822519) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489917);
  const high = (h2 >>> 0).toString(16).padStart(8, '0');
  const low = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${high}${low}`;
}

const REF_PATTERN = /^\{([^{}]+)\}$/;

/** Resolve a token to its concrete value for a theme, following alias chains. */
export function resolveTokenValue(tokens: Token[], id: string, theme: string, seen = new Set<string>()): string {
  if (seen.has(id)) return '';
  seen.add(id);
  const token = tokens.find((item) => item.id === id);
  if (!token) return '';
  const raw = token.themes?.[theme] ?? token.value;
  const match = REF_PATTERN.exec(raw);
  if (match) return resolveTokenValue(tokens, match[1], theme, seen);
  return raw;
}

/** Build the fully-resolved token map per theme for a snapshot. */
export function buildResolvedMap(tokens: Token[], themes: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const theme of themes) {
    const map: Record<string, string> = {};
    for (const token of tokens) map[token.id] = resolveTokenValue(tokens, token.id, theme);
    out[theme] = map;
  }
  return out;
}

/** Fingerprint a resolved map per theme. */
export function fingerprintResolved(resolved: Record<string, Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const theme of Object.keys(resolved).sort()) {
    const map = resolved[theme];
    const canonical = Object.keys(map).sort().map((id) => `${id}=${map[id]}`).join('\n');
    out[theme] = `fp-${hashString(canonical).slice(0, 12)}`;
  }
  return out;
}

/** Compute per-theme fingerprints for a token set. */
export function snapshotFingerprints(tokens: Token[], themes: string[]): Record<string, string> {
  return fingerprintResolved(buildResolvedMap(tokens, themes));
}
