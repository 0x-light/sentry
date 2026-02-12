// ============================================================================
// SENTRY — Shared Client-Side Validation Helpers
// ============================================================================

const TWITTER_ACCOUNT_RE = /^[a-zA-Z0-9_]{1,15}$/;

export function normalizeAccountHandle(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/^@/, '').toLowerCase();
  if (!TWITTER_ACCOUNT_RE.test(cleaned)) return null;
  return cleaned;
}

export function normalizeAccountList(values, { max = Infinity } = {}) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const valid = [];
  let invalidCount = 0;

  for (const raw of source) {
    const normalized = normalizeAccountHandle(raw);
    if (!normalized) {
      invalidCount++;
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
  }

  const truncated = valid.length > max;
  return {
    accounts: truncated ? valid.slice(0, max) : valid,
    invalidCount,
    truncated,
  };
}
