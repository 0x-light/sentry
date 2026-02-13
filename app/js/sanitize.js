// ============================================================================
// SENTRY — URL and path sanitization helpers
// ============================================================================

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

export function sanitizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sanitizePathname(pathname) {
  if (typeof pathname !== 'string') return '/';
  const raw = pathname.trim();
  if (!raw.startsWith('/')) return '/';
  return raw.replace(/[\u0000-\u001f"'<>`\\]/g, '') || '/';
}
