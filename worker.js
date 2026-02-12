const ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const ALLOWED_HOSTS = new Set([
  'api.twitterapi.io',
  'query1.finance.yahoo.com',
  'api.coingecko.com',
]);
const MAX_RESPONSE_BYTES = 2_000_000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Accept',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function isAllowedTarget(targetUrl) {
  if (targetUrl.protocol !== 'https:') return false;
  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) return false;
  if (targetUrl.username || targetUrl.password) return false;
  return true;
}

function buildForwardHeaders(request) {
  const headers = new Headers();
  const allow = ['accept', 'content-type', 'x-api-key'];
  for (const name of allow) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (!ALLOWED_METHODS.includes(request.method)) {
      return jsonError('Method not allowed', 405);
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return jsonError('Missing ?url= parameter', 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return jsonError('Invalid URL', 400);
    }
    if (!isAllowedTarget(targetUrl)) {
      return jsonError('Host not allowed', 403);
    }
    targetUrl.hash = '';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: buildForwardHeaders(request),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_RESPONSE_BYTES) {
        return jsonError('Response too large', 502);
      }

      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders()).forEach(([k, v]) => responseHeaders.set(k, v));
      responseHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=60');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch {
      return jsonError('Upstream request failed', 502);
    }
  },
};
