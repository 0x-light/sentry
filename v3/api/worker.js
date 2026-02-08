// ============================================================================
// SENTRY v3 — Backend API (Cloudflare Worker)
// ============================================================================
//
// Routes:
//   POST /api/tweets/fetch       - Fetch tweets for an account (proxied)
//   POST /api/tweets/fetch-batch - Fetch tweets for multiple accounts (batched)
//   POST /api/analyze            - Analyze tweets with Claude (proxied)
//   GET  /api/user               - Get user profile + plan
//   PUT  /api/user/settings      - Update settings
//   GET  /api/user/presets       - Get presets
//   POST /api/user/presets       - Create/update preset
//   DELETE /api/user/presets     - Delete preset
//   GET  /api/user/analysts      - Get analysts
//   POST /api/user/analysts      - Create/update analyst
//   DELETE /api/user/analysts    - Delete analyst
//   GET  /api/scans              - Get scan history
//   POST /api/scans              - Save a scan
//   DELETE /api/scans            - Delete a scan
//   POST /api/scans/check-cache  - Check if a scan result is cached
//   POST /api/billing/checkout   - Create Stripe checkout (credit packs)
//   POST /api/billing/portal     - Stripe billing portal
//   GET  /api/billing/status     - Billing & credit status
//   POST /api/billing/webhook    - Stripe webhook (credit fulfillment)
//   GET  /api/proxy              - CORS proxy (for Yahoo Finance etc.)
// ============================================================================

// ---------------------------------------------------------------------------
// MODULE-LEVEL STATE (shared within a single CF Worker isolate)
// Used for request coalescing – if 50 users request the same tweets at the
// same millisecond, only one Twitter API call is made.
// ---------------------------------------------------------------------------
const inflight = new Map();

// ---------------------------------------------------------------------------
// CREDIT SYSTEM CONSTANTS
// ---------------------------------------------------------------------------
const CREDIT_PACKS = {
  starter:  { id: 'starter',  name: 'Starter',  credits: 1000,  price_cents: 900 },
  standard: { id: 'standard', name: 'Standard', credits: 5000,  price_cents: 3900 },
  pro:      { id: 'pro',      name: 'Pro',      credits: 15000, price_cents: 9900 },
  max:      { id: 'max',      name: 'Max',      credits: 40000, price_cents: 19900 },
};

const FREE_TIER = {
  max_accounts: 10,
  scans_per_day: 1,
};

const MAX_ACCOUNTS_PER_SCAN = 1000; // hard server-side cap

function calculateScanCredits(accountsCount, rangeDays) {
  let multiplier;
  if (rangeDays <= 1) multiplier = 1;
  else if (rangeDays <= 3) multiplier = 2;
  else if (rangeDays <= 7) multiplier = 3;
  else if (rangeDays <= 14) multiplier = 5;
  else if (rangeDays <= 30) multiplier = 8;
  else multiplier = 10;
  return accountsCount * multiplier;
}

function getStripePriceId(env, packId, recurring) {
  // Env vars: STRIPE_PRICE_STARTER, STRIPE_PRICE_STANDARD, etc.
  // For recurring: STRIPE_PRICE_STARTER_RECURRING, etc.
  const suffix = recurring ? '_RECURRING' : '';
  return env[`STRIPE_PRICE_${packId.toUpperCase()}${suffix}`];
}

function packFromPriceId(env, priceId) {
  for (const pack of Object.values(CREDIT_PACKS)) {
    if (env[`STRIPE_PRICE_${pack.id.toUpperCase()}`] === priceId) return pack;
    if (env[`STRIPE_PRICE_${pack.id.toUpperCase()}_RECURRING`] === priceId) return pack;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // --- Public routes (no auth required) ---
      if (path === '/api/billing/webhook' && method === 'POST') {
        return handleStripeWebhook(request, env);
      }
      if (path === '/api/proxy' && method === 'GET') {
        return handleProxy(request, env, ctx);
      }
      if (path === '/api/health') {
        return corsJson({ status: 'ok', version: 'v3' }, 200, env);
      }

      // --- Auth required routes ---
      const user = await authenticate(request, env);
      if (!user) {
        return corsJson({ error: 'Unauthorized' }, 401, env);
      }

      // Tweet fetching
      if (path === '/api/tweets/fetch' && method === 'POST') {
        return handleFetchTweets(request, env, user, ctx);
      }
      if (path === '/api/tweets/fetch-batch' && method === 'POST') {
        return handleFetchTweetsBatch(request, env, user, ctx);
      }

      // Claude analysis
      if (path === '/api/analyze' && method === 'POST') {
        return handleAnalyze(request, env, user);
      }

      // User profile
      if (path === '/api/user' && method === 'GET') {
        return handleGetUser(env, user);
      }

      // Settings
      if (path === '/api/user/settings' && method === 'GET') {
        return handleGetSettings(env, user);
      }
      if (path === '/api/user/settings' && method === 'PUT') {
        return handleUpdateSettings(request, env, user);
      }

      // Presets
      if (path === '/api/user/presets' && method === 'GET') {
        return handleGetPresets(env, user);
      }
      if (path === '/api/user/presets' && method === 'POST') {
        return handleSavePreset(request, env, user);
      }
      if (path === '/api/user/presets' && method === 'DELETE') {
        return handleDeletePreset(request, env, user);
      }

      // Analysts
      if (path === '/api/user/analysts' && method === 'GET') {
        return handleGetAnalysts(env, user);
      }
      if (path === '/api/user/analysts' && method === 'POST') {
        return handleSaveAnalyst(request, env, user);
      }
      if (path === '/api/user/analysts' && method === 'DELETE') {
        return handleDeleteAnalyst(request, env, user);
      }

      // Scan history
      if (path === '/api/scans' && method === 'GET') {
        return handleGetScans(env, user);
      }
      if (path === '/api/scans' && method === 'POST') {
        return handleSaveScan(request, env, user, ctx);
      }
      if (path === '/api/scans' && method === 'DELETE') {
        return handleDeleteScan(request, env, user);
      }
      if (path === '/api/scans/check-cache' && method === 'POST') {
        return handleCheckScanCache(request, env, user);
      }

      // Billing
      if (path === '/api/billing/checkout' && method === 'POST') {
        return handleCheckout(request, env, user);
      }
      if (path === '/api/billing/portal' && method === 'POST') {
        return handleBillingPortal(request, env, user);
      }
      if (path === '/api/billing/status' && method === 'GET') {
        return handleBillingStatus(env, user);
      }
      if (path === '/api/billing/verify' && method === 'POST') {
        return handleVerifyCheckout(request, env, user);
      }

      return corsJson({ error: 'Not found' }, 404, env);

    } catch (e) {
      console.error('Unhandled error:', e.message, e.stack);
      return corsJson({ error: 'Internal server error' }, 500, env);
    }
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function corsHeaders(env) {
  const origin = env?.CORS_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(body, status, env) {
  return new Response(body, { status, headers: corsHeaders(env) });
}

function corsJson(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// ============================================================================
// AUTH — Verify Supabase JWT
// ============================================================================

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!token) return null;

  try {
    // Verify token with Supabase Auth API
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': env.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;
    return { id: user.id, email: user.email, token };
  } catch (e) {
    console.error('Auth verification failed:', e.message);
    return null;
  }
}

// ============================================================================
// SUPABASE DB HELPERS
// ============================================================================

async function supabaseQuery(env, path, options = {}) {
  const { method = 'GET', body, headers: extraHeaders = {}, token } = options;
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${token || env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...extraHeaders,
  };
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase ${method} ${path} error:`, res.status, err);
    throw new Error(`Database error: ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseRpc(env, fn, args = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase RPC ${fn} error:`, res.status, err);
    throw new Error(`RPC ${fn}: ${res.status} - ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ============================================================================
// TWEET FETCHING (proxied through server)
// — Request coalescing: concurrent identical requests share one Twitter call
// — Stale-while-revalidate: return stale cache instantly, refresh in background
// ============================================================================

function tweetCacheKey(account, days) {
  const hourBucket = Math.floor(Date.now() / 3600000);
  return `tweets:${account.toLowerCase()}:${days}:${hourBucket}`;
}

function tweetCacheKeyStale(account, days) {
  const hourBucket = Math.floor(Date.now() / 3600000);
  return `tweets:${account.toLowerCase()}:${days}:${hourBucket - 1}`;
}

// Shared fetch function with coalescing + stale-while-revalidate
async function fetchTweetsCoalesced(account, days, env, ctx) {
  const key = tweetCacheKey(account, days);

  // 1. Check fresh KV cache
  if (env.TWEET_CACHE) {
    const cached = await env.TWEET_CACHE.get(key, 'json');
    if (cached) return { tweets: cached, cached: true };
  }

  // 2. Check stale cache (previous hour) — return immediately + refresh in bg
  if (env.TWEET_CACHE) {
    const staleKey = tweetCacheKeyStale(account, days);
    const stale = await env.TWEET_CACHE.get(staleKey, 'json');
    if (stale) {
      // Refresh in background (non-blocking)
      ctx.waitUntil((async () => {
        try {
          const fresh = await fetchTwitterTweetsRaw(env, account, days);
          if (fresh.length > 0) {
            await env.TWEET_CACHE.put(key, JSON.stringify(fresh), { expirationTtl: 3600 });
          }
        } catch (e) { console.warn('Background refresh failed:', e.message); }
      })());
      return { tweets: stale, cached: true, stale: true };
    }
  }

  // 3. Coalesce concurrent requests for the same key
  if (inflight.has(key)) {
    const tweets = await inflight.get(key);
    return { tweets, cached: false, coalesced: true };
  }

  const promise = fetchTwitterTweetsRaw(env, account, days);
  inflight.set(key, promise);

  try {
    const tweets = await promise;
    // Cache in KV (TTL: 1 hour)
    if (env.TWEET_CACHE && tweets.length > 0) {
      // Don't await KV write — fire and continue
      ctx.waitUntil(
        env.TWEET_CACHE.put(key, JSON.stringify(tweets), { expirationTtl: 3600 })
      );
    }
    return { tweets, cached: false };
  } finally {
    inflight.delete(key);
  }
}

async function handleFetchTweets(request, env, user, ctx) {
  const { account, days } = await request.json();
  if (!account || !days) {
    return corsJson({ error: 'Missing account or days' }, 400, env);
  }

  // Credits > 0 = managed keys; no credits = BYOK
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({ error: 'No credits remaining. Buy a credit pack or use your own API keys.', code: 'NO_CREDITS' }, 403, env);
  }

  const result = await fetchTweetsCoalesced(account, days, env, ctx);
  return corsJson(result, 200, env);
}

// ---------------------------------------------------------------------------
// BATCH TWEET FETCH — fetch multiple accounts in one request
// Reduces round-trips from N sequential fetches to 1 batched request
// ---------------------------------------------------------------------------
async function handleFetchTweetsBatch(request, env, user, ctx) {
  const { accounts, days } = await request.json();
  if (!accounts?.length || !days) {
    return corsJson({ error: 'Missing accounts or days' }, 400, env);
  }

  // Credits > 0 = managed keys
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({ error: 'No credits remaining. Buy a credit pack or use your own API keys.', code: 'NO_CREDITS' }, 403, env);
  }

  // Hard cap on accounts per scan
  if (accounts.length > MAX_ACCOUNTS_PER_SCAN) {
    return corsJson({ error: `Maximum ${MAX_ACCOUNTS_PER_SCAN} accounts per scan.`, code: 'TOO_MANY_ACCOUNTS' }, 400, env);
  }

  // Limit batch size
  const maxBatch = 25;
  const batch = accounts.slice(0, maxBatch);

  // Fetch all accounts concurrently with coalescing
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (account) => {
        try {
          const { tweets, cached, stale, coalesced } = await fetchTweetsCoalesced(account, days, env, ctx);
          return { account, tweets, cached: cached || false, error: null };
        } catch (e) {
          return { account, tweets: [], cached: false, error: e.message };
        }
      })
    );
    results.push(...chunkResults);
  }

  return corsJson({ results }, 200, env);
}

async function fetchTwitterTweetsRaw(env, account, days) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const allTweets = [];
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 5;

  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);
    const url = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;

    let data;
    let retries = 0;
    while (retries <= 3) {
      try {
        const res = await fetch(url, {
          headers: { 'X-API-Key': env.TWITTER_API_KEY, 'Accept': 'application/json' },
        });
        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, retries), 30000);
          await new Promise(r => setTimeout(r, wait));
          retries++;
          continue;
        }
        if (!res.ok) {
          if (retries < 3) { retries++; await new Promise(r => setTimeout(r, 1000)); continue; }
          throw new Error(`Twitter API error ${res.status}`);
        }
        data = await res.json();
        break;
      } catch (e) {
        if (retries >= 3) throw e;
        retries++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const apiData = data.data || data;
    if (data.status === 'error') break;

    const tweets = apiData.tweets || [];
    if (!tweets.length) break;

    let hitCutoff = false;
    for (const tw of tweets) {
      if (new Date(tw.createdAt) < cutoff) { hitCutoff = true; break; }
      allTweets.push(tw);
    }
    if (hitCutoff) break;
    if (!apiData.has_next_page || !apiData.next_cursor) break;
    cursor = apiData.next_cursor;
    pages++;
    await new Promise(r => setTimeout(r, 100));
  }

  return allTweets;
}

// ============================================================================
// CLAUDE ANALYSIS (proxied through server)
// ============================================================================

async function handleAnalyze(request, env, user) {
  const body = await request.json();
  const { model, max_tokens, messages, prompt_hash, tweet_urls } = body;

  if (!messages) {
    return corsJson({ error: 'Missing messages' }, 400, env);
  }

  // Credits > 0 = managed keys; no credits = BYOK
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({
      error: 'No credits remaining. Buy a credit pack or use your own API keys.',
      code: 'NO_CREDITS',
      credits_balance: profile?.credits_balance || 0,
    }, 403, env);
  }

  // Check analysis cache
  if (prompt_hash && tweet_urls?.length) {
    const cached = await checkAnalysisCache(env, prompt_hash, tweet_urls);
    if (cached) {
      return corsJson({ content: [{ type: 'text', text: JSON.stringify(cached) }], cached: true }, 200, env);
    }
  }

  // Call Anthropic API — with prompt caching
  // If the caller sends a `system` field, we add cache_control to enable
  // Anthropic's prompt caching (90%+ of the system prompt is identical
  // across calls, so subsequent calls get ~90% input token discount).
  const systemPrompt = body.system;
  const anthropicBody = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: max_tokens || 16384,
    messages,
    ...(systemPrompt ? {
      system: (Array.isArray(systemPrompt) ? systemPrompt : [{ type: 'text', text: systemPrompt }])
        .map((block, i) => i === 0 ? { ...block, cache_control: { type: 'ephemeral' } } : block)
    } : {}),
  };

  let lastError = null;
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      const data = await res.json();
      if (data.error) {
        const errType = data.error.type;
        // Non-retryable errors
        if (['authentication_error', 'invalid_request_error', 'not_found_error'].includes(errType)) {
          return corsJson({ error: data.error.message || 'Anthropic API error' }, res.status, env);
        }
        // Retryable errors (rate limit, overloaded)
        if (attempt < 5) {
          const wait = Math.min(2000 * Math.pow(2, attempt), 60000);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return corsJson({ error: 'API rate limited. Please try again.' }, 429, env);
      }

      // Cache the analysis result
      if (prompt_hash && tweet_urls?.length) {
        const text = extractText(data.content);
        await cacheAnalysis(env, prompt_hash, tweet_urls, text, model);
      }

      // Track usage
      const inputTokens = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;
      await logUsage(env, user.id, 'analyze', {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_anthropic: estimateAnthropicCost(model, inputTokens, outputTokens),
      });

      return corsJson(data, 200, env);

    } catch (e) {
      lastError = e;
      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
      }
    }
  }

  return corsJson({ error: lastError?.message || 'Anthropic API failed' }, 502, env);
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
}

function estimateAnthropicCost(model, inputTokens, outputTokens) {
  const id = (model || '').toLowerCase();
  let inputRate = 3, outputRate = 15; // Sonnet defaults (per million)
  if (id.includes('opus')) { inputRate = 15; outputRate = 75; }
  else if (id.includes('haiku')) { inputRate = 0.80; outputRate = 4; }
  return (inputTokens * inputRate / 1000000) + (outputTokens * outputRate / 1000000);
}

async function checkAnalysisCache(env, promptHash, tweetUrls) {
  try {
    const urlList = tweetUrls.map(u => `"${u}"`).join(',');
    const rows = await supabaseQuery(env,
      `analysis_cache?prompt_hash=eq.${promptHash}&tweet_url=in.(${urlList})&select=tweet_url,signals`
    );
    if (!rows || rows.length < tweetUrls.length) return null;
    // All tweet URLs are cached
    const allSignals = [];
    rows.forEach(r => {
      if (r.signals) allSignals.push(...r.signals);
    });
    return allSignals;
  } catch {
    return null;
  }
}

async function cacheAnalysis(env, promptHash, tweetUrls, responseText, model) {
  try {
    const signals = safeParseSignals(responseText);
    const grouped = new Map();
    signals.forEach(s => {
      const url = s.tweet_url;
      if (!url) return;
      if (!grouped.has(url)) grouped.set(url, []);
      grouped.get(url).push(s);
    });
    const rows = tweetUrls.map(url => ({
      prompt_hash: promptHash,
      tweet_url: url,
      signals: grouped.get(url) || [],
      model: model || 'claude-sonnet-4-20250514',
    }));
    if (rows.length) {
      await supabaseQuery(env, 'analysis_cache', {
        method: 'POST',
        body: rows,
        headers: { 'Prefer': 'resolution=merge-duplicates' },
      });
    }
  } catch (e) {
    console.warn('Cache write failed:', e.message);
  }
}

function safeParseSignals(text) {
  if (!text) return [];
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const result = JSON.parse(match[0]);
    return Array.isArray(result) ? result.filter(s => s && (s.title || s.summary)) : [];
  } catch {
    try {
      const fixed = match[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
      const result = JSON.parse(fixed);
      return Array.isArray(result) ? result.filter(s => s && (s.title || s.summary)) : [];
    } catch { return []; }
  }
}

// ============================================================================
// USER PROFILE
// ============================================================================

async function getProfile(env, userId) {
  const rows = await supabaseQuery(env, `profiles?id=eq.${userId}&select=*`);
  return rows?.[0] || null;
}

async function handleGetUser(env, user) {
  const profile = await getProfile(env, user.id);
  if (!profile) {
    return corsJson({ error: 'Profile not found' }, 404, env);
  }

  // Check free tier daily scan count
  const canFreeScanToday = profile.credits_balance <= 0
    ? await supabaseRpc(env, 'check_free_scan_today', { p_user_id: user.id })
    : true;

  return corsJson({
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatar_url: profile.avatar_url,
    credits_balance: profile.credits_balance,
    has_credits: profile.credits_balance > 0,
    free_scan_available: canFreeScanToday,
    subscription_status: profile.subscription_status,
  }, 200, env);
}

// ============================================================================
// SETTINGS
// ============================================================================

async function handleGetSettings(env, user) {
  const rows = await supabaseQuery(env, `user_settings?user_id=eq.${user.id}&select=*`);
  return corsJson(rows?.[0] || {}, 200, env);
}

async function handleUpdateSettings(request, env, user) {
  const body = await request.json();
  const allowed = ['theme', 'font', 'font_size', 'text_case', 'finance_provider', 'model', 'live_enabled'];
  const update = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  update.updated_at = new Date().toISOString();

  await supabaseQuery(env, `user_settings?user_id=eq.${user.id}`, {
    method: 'PATCH',
    body: update,
  });
  return corsJson({ ok: true }, 200, env);
}

// ============================================================================
// PRESETS
// ============================================================================

async function handleGetPresets(env, user) {
  const rows = await supabaseQuery(env,
    `presets?user_id=eq.${user.id}&select=*&order=sort_order.asc,created_at.asc`
  );
  return corsJson(rows || [], 200, env);
}

async function handleSavePreset(request, env, user) {
  const body = await request.json();
  const { id, name, accounts, is_public, sort_order } = body;
  if (!name || !accounts?.length) {
    return corsJson({ error: 'Name and accounts required' }, 400, env);
  }

  const data = {
    user_id: user.id,
    name,
    accounts,
    is_public: is_public || false,
    sort_order: sort_order || 0,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    // Update existing
    await supabaseQuery(env, `presets?id=eq.${id}&user_id=eq.${user.id}`, {
      method: 'PATCH',
      body: data,
    });
  } else {
    // Insert new
    data.id = crypto.randomUUID();
    await supabaseQuery(env, 'presets', { method: 'POST', body: data });
  }
  return corsJson({ ok: true, id: id || data.id }, 200, env);
}

async function handleDeletePreset(request, env, user) {
  const { id } = await request.json();
  if (!id) return corsJson({ error: 'Missing id' }, 400, env);
  await supabaseQuery(env, `presets?id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ============================================================================
// ANALYSTS
// ============================================================================

async function handleGetAnalysts(env, user) {
  const rows = await supabaseQuery(env,
    `analysts?user_id=eq.${user.id}&select=*&order=sort_order.asc,created_at.asc`
  );
  return corsJson(rows || [], 200, env);
}

async function handleSaveAnalyst(request, env, user) {
  const body = await request.json();
  const { id, name, prompt, is_active } = body;
  if (!name) return corsJson({ error: 'Name required' }, 400, env);

  const data = {
    id: id || 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    user_id: user.id,
    name,
    prompt: prompt || '',
    is_active: is_active || false,
    updated_at: new Date().toISOString(),
  };

  // Upsert
  await supabaseQuery(env, 'analysts', {
    method: 'POST',
    body: data,
    headers: { 'Prefer': 'resolution=merge-duplicates' },
  });

  // If setting as active, deactivate others
  if (is_active) {
    await supabaseQuery(env,
      `analysts?user_id=eq.${user.id}&id=neq.${data.id}`, {
        method: 'PATCH',
        body: { is_active: false },
      }
    );
  }

  return corsJson({ ok: true, id: data.id }, 200, env);
}

async function handleDeleteAnalyst(request, env, user) {
  const { id } = await request.json();
  if (!id || id === 'default') return corsJson({ error: 'Cannot delete default analyst' }, 400, env);
  await supabaseQuery(env, `analysts?id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ============================================================================
// SCAN HISTORY
// ============================================================================

async function handleGetScans(env, user) {
  const rows = await supabaseQuery(env,
    `scans?user_id=eq.${user.id}&select=id,accounts,range_label,range_days,total_tweets,signal_count,signals,created_at&order=created_at.desc&limit=20`
  );
  return corsJson(rows || [], 200, env);
}

async function handleSaveScan(request, env, user, ctx) {
  const body = await request.json();
  const { accounts, range_label, range_days, total_tweets, signal_count, signals, tweet_meta, prompt_hash } = body;

  const accountCount = accounts?.length || 0;
  const days = range_days || 1;
  const creditsUsed = calculateScanCredits(accountCount, days);

  // Deduct credits if user has them
  const profile = await getProfile(env, user.id);
  let newBalance = profile?.credits_balance || 0;

  if (profile && profile.credits_balance > 0 && creditsUsed > 0) {
    const result = await supabaseRpc(env, 'deduct_credits', {
      p_user_id: user.id,
      p_amount: creditsUsed,
      p_description: `Scan: ${accountCount} accounts × ${days}d`,
      p_metadata: { accounts_count: accountCount, range_days: days },
    });
    if (result === -1) {
      return corsJson({
        error: 'Insufficient credits for this scan.',
        code: 'INSUFFICIENT_CREDITS',
        credits_needed: creditsUsed,
        credits_balance: profile.credits_balance,
      }, 403, env);
    }
    newBalance = result;
  }

  const data = {
    user_id: user.id,
    accounts: accounts || [],
    range_label: range_label || '',
    range_days: days,
    total_tweets: total_tweets || 0,
    signal_count: signal_count || signals?.length || 0,
    signals: signals || [],
    tweet_meta: tweet_meta || {},
    credits_used: creditsUsed,
  };

  const rows = await supabaseQuery(env, 'scans', { method: 'POST', body: data });

  // Also save to cross-user whole-scan cache
  if (prompt_hash && signals?.length) {
    cacheScanResult(env, ctx, accounts, days, prompt_hash, signals, total_tweets);
  }

  return corsJson({ ok: true, id: rows?.[0]?.id, credits_used: creditsUsed, credits_balance: newBalance }, 200, env);
}

async function handleDeleteScan(request, env, user) {
  const { id } = await request.json();
  if (!id) return corsJson({ error: 'Missing id' }, 400, env);
  await supabaseQuery(env, `scans?id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ---------------------------------------------------------------------------
// WHOLE-SCAN RESULT CACHE
// If another user already scanned the same accounts + days + prompt, return
// their signals instantly (analyst-agnostic hash = same prompt text).
// ---------------------------------------------------------------------------
function hashScanKey(accounts, days, promptHash) {
  // Simple hash: sorted accounts + days + prompt hash
  const sorted = [...accounts].map(a => a.toLowerCase()).sort().join(',');
  const raw = `${sorted}:${days}:${promptHash}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) + raw.charCodeAt(i);
    h |= 0;
  }
  return 'scan:' + (h >>> 0).toString(16);
}

async function handleCheckScanCache(request, env, user) {
  const { accounts, days, prompt_hash } = await request.json();
  if (!accounts?.length || !days || !prompt_hash) {
    return corsJson({ cached: false }, 200, env);
  }

  const scanKey = hashScanKey(accounts, days, prompt_hash);

  if (env.TWEET_CACHE) {
    const cached = await env.TWEET_CACHE.get(scanKey, 'json');
    if (cached && cached.signals) {
      return corsJson({
        cached: true,
        signals: cached.signals,
        total_tweets: cached.total_tweets || 0,
        ts: cached.ts,
      }, 200, env);
    }
  }

  return corsJson({ cached: false }, 200, env);
}

// Save scan result to cross-user cache (called after successful scan save)
async function cacheScanResult(env, ctx, accounts, days, promptHash, signals, totalTweets) {
  if (!env.TWEET_CACHE || !promptHash) return;
  const scanKey = hashScanKey(accounts, days, promptHash);
  ctx.waitUntil(
    env.TWEET_CACHE.put(scanKey, JSON.stringify({
      signals,
      total_tweets: totalTweets,
      ts: Date.now(),
    }), { expirationTtl: 3600 }) // 1 hour TTL
  );
}

// ============================================================================
// BILLING — Stripe
// ============================================================================

async function stripeRequest(env, path, params = {}) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  return res.json();
}

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

async function getOrCreateStripeCustomer(env, user) {
  const profile = await getProfile(env, user.id);
  if (profile.stripe_customer_id) return profile.stripe_customer_id;

  // Create Stripe customer
  const customer = await stripeRequest(env, '/customers', {
    email: user.email,
    'metadata[user_id]': user.id,
  });

  // Save to profile
  await supabaseQuery(env, `profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    body: { stripe_customer_id: customer.id },
  });

  return customer.id;
}

async function handleCheckout(request, env, user) {
  const { pack_id, recurring, success_url, cancel_url } = await request.json();

  const pack = CREDIT_PACKS[pack_id];
  if (!pack) {
    return corsJson({ error: 'Invalid credit pack' }, 400, env);
  }

  const customerId = await getOrCreateStripeCustomer(env, user);
  const priceId = getStripePriceId(env, pack_id, recurring);

  if (!priceId) {
    return corsJson({ error: 'Price not configured for this pack' }, 500, env);
  }

  const mode = recurring ? 'subscription' : 'payment';

  const params = {
    'customer': customerId,
    'mode': mode,
    'payment_method_types[0]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': (success_url || 'https://sentry.is/?billing=success') + '&session_id={CHECKOUT_SESSION_ID}',
    'cancel_url': cancel_url || 'https://sentry.is/?billing=cancel',
    'allow_promotion_codes': 'true',
    'metadata[pack_id]': pack.id,
    'metadata[credits]': pack.credits.toString(),
    'metadata[user_id]': user.id,
  };

  // For subscriptions, also add metadata to the subscription itself
  if (recurring) {
    params['subscription_data[metadata][pack_id]'] = pack.id;
    params['subscription_data[metadata][credits]'] = pack.credits.toString();
    params['subscription_data[metadata][user_id]'] = user.id;
  }

  const session = await stripeRequest(env, '/checkout/sessions', params);

  if (session.error) {
    console.error('Stripe checkout error:', session.error);
    return corsJson({ error: session.error.message || 'Failed to create checkout session' }, 400, env);
  }

  if (!session.url) {
    console.error('Stripe checkout: no URL returned', JSON.stringify(session));
    return corsJson({ error: 'Checkout session created but no redirect URL was returned' }, 500, env);
  }

  return corsJson({ url: session.url, id: session.id }, 200, env);
}

async function handleBillingPortal(request, env, user) {
  const customerId = await getOrCreateStripeCustomer(env, user);
  const { return_url } = await request.json();

  const session = await stripeRequest(env, '/billing_portal/sessions', {
    'customer': customerId,
    'return_url': return_url || 'https://sentry.is/v3/',
  });

  if (session.error) {
    console.error('Stripe portal error:', session.error);
    return corsJson({ error: session.error.message || 'Failed to create billing portal session' }, 400, env);
  }

  if (!session.url) {
    console.error('Stripe portal: no URL returned', JSON.stringify(session));
    return corsJson({ error: 'Portal session created but no redirect URL was returned' }, 500, env);
  }

  return corsJson({ url: session.url }, 200, env);
}

async function handleBillingStatus(env, user) {
  const profile = await getProfile(env, user.id);

  // Get recent credit transactions
  let recentTransactions = [];
  try {
    recentTransactions = await supabaseQuery(env,
      `credit_transactions?user_id=eq.${user.id}&select=type,amount,balance_after,description,created_at&order=created_at.desc&limit=10`
    );
  } catch (e) { /* ignore */ }

  return corsJson({
    credits_balance: profile?.credits_balance || 0,
    has_credits: (profile?.credits_balance || 0) > 0,
    subscription_status: profile?.subscription_status,
    recent_transactions: recentTransactions || [],
  }, 200, env);
}

// Verify a checkout session directly with Stripe (fallback for missed webhooks)
async function handleVerifyCheckout(request, env, user) {
  try {
    const body = await request.json().catch(() => ({}));
    const session_id = body.session_id;
    if (!session_id) {
      return corsJson({ error: 'Missing session_id' }, 400, env);
    }

    // Fetch the session from Stripe
    const session = await stripeGet(env, `/checkout/sessions/${session_id}`);
    if (session.error || !session.id) {
      console.error('Stripe session fetch failed:', JSON.stringify(session.error || session));
      return corsJson({ error: 'Invalid session' }, 400, env);
    }

    // Security: only allow the user who created the session to verify it
    if (session.metadata?.user_id !== user.id) {
      return corsJson({ error: 'Session does not belong to this user' }, 403, env);
    }

    // Only process completed sessions
    if (session.payment_status !== 'paid') {
      return corsJson({ status: 'pending', payment_status: session.payment_status }, 200, env);
    }

    const metadata = session.metadata || {};
    const credits = parseInt(metadata.credits) || 0;
    const packId = metadata.pack_id || 'unknown';

    // Add credits
    if (credits > 0) {
      try {
        const pack = CREDIT_PACKS[packId];
        const desc = pack ? `${pack.name} pack (${credits.toLocaleString()} credits)` : `${credits.toLocaleString()} credits`;
        const txType = session.mode === 'subscription' ? 'recurring' : 'purchase';
        await supabaseRpc(env, 'add_credits', {
          p_user_id: user.id,
          p_amount: credits,
          p_type: txType,
          p_description: desc,
          p_metadata: { stripe_session_id: session.id, pack_id: packId },
        });
      } catch (e) {
        // Credits may already have been added by webhook — that's OK
        console.warn('add_credits failed (may be duplicate):', e.message);
      }
    }

    // If subscription, ensure subscription ID is saved
    if (session.mode === 'subscription' && session.subscription) {
      try {
        const customerId = session.customer;
        await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
          method: 'PATCH',
          body: {
            stripe_subscription_id: session.subscription,
            subscription_status: 'active',
          },
        });
      } catch (e) {
        console.warn('Subscription update failed:', e.message);
      }
    }

    // Return fresh profile
    const updatedProfile = await getProfile(env, user.id);
    return corsJson({
      status: 'fulfilled',
      credits_balance: updatedProfile?.credits_balance || 0,
      has_credits: (updatedProfile?.credits_balance || 0) > 0,
      subscription_status: updatedProfile?.subscription_status,
    }, 200, env);

  } catch (e) {
    console.error('handleVerifyCheckout error:', e.message, e.stack);
    return corsJson({ error: 'Verification failed: ' + (e.message || 'unknown error') }, 500, env);
  }
}

async function handleStripeWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();

  // Verify webhook signature
  if (!await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return corsJson({ error: 'Invalid signature' }, 400, env);
  }

  const event = JSON.parse(body);

  // Log the event
  try {
    await supabaseQuery(env, 'billing_events', {
      method: 'POST',
      body: { stripe_event_id: event.id, type: event.type, data: event.data },
    });
  } catch (e) {
    // Duplicate event, ignore
    if (!e.message.includes('duplicate')) console.warn('Webhook log failed:', e.message);
  }

  const obj = event.data.object;

  switch (event.type) {
    // One-time or first-time subscription checkout completed
    case 'checkout.session.completed': {
      const customerId = obj.customer;
      const metadata = obj.metadata || {};
      const credits = parseInt(metadata.credits) || 0;
      const packId = metadata.pack_id || 'unknown';
      const userId = metadata.user_id;

      if (credits > 0 && userId) {
        // Add credits to user
        const pack = CREDIT_PACKS[packId];
        const desc = pack ? `${pack.name} pack (${credits.toLocaleString()} credits)` : `${credits.toLocaleString()} credits`;
        const txType = obj.mode === 'subscription' ? 'recurring' : 'purchase';
        await supabaseRpc(env, 'add_credits', {
          p_user_id: userId,
          p_amount: credits,
          p_type: txType,
          p_description: desc,
          p_metadata: { stripe_session_id: obj.id, pack_id: packId },
        });
      }

      // If subscription, save the subscription ID
      if (obj.mode === 'subscription' && obj.subscription) {
        await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
          method: 'PATCH',
          body: {
            stripe_subscription_id: obj.subscription,
            subscription_status: 'active',
          },
        });
      }
      break;
    }

    // Recurring subscription renewal (invoice paid)
    case 'invoice.paid': {
      // Only process recurring renewals, not the first payment (handled by checkout.session.completed)
      if (obj.billing_reason === 'subscription_cycle') {
        const subscriptionId = obj.subscription;
        if (subscriptionId) {
          const sub = await stripeGet(env, `/subscriptions/${subscriptionId}`);
          const metadata = sub.metadata || {};
          const credits = parseInt(metadata.credits) || 0;
          const packId = metadata.pack_id || 'unknown';
          const userId = metadata.user_id;

          if (credits > 0 && userId) {
            const pack = CREDIT_PACKS[packId];
            const desc = pack ? `${pack.name} pack renewal (${credits.toLocaleString()} credits)` : `${credits.toLocaleString()} credits (renewal)`;
            await supabaseRpc(env, 'add_credits', {
              p_user_id: userId,
              p_amount: credits,
              p_type: 'recurring',
              p_description: desc,
              p_metadata: { stripe_invoice_id: obj.id, pack_id: packId },
            });
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const customerId = obj.customer;
      await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
        method: 'PATCH',
        body: {
          subscription_status: obj.status,
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const customerId = obj.customer;
      await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
        method: 'PATCH',
        body: {
          stripe_subscription_id: null,
          subscription_status: 'canceled',
        },
      });
      break;
    }

    case 'invoice.payment_failed': {
      const customerId = obj.customer;
      await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
        method: 'PATCH',
        body: { subscription_status: 'past_due' },
      });
      break;
    }
  }

  return corsJson({ received: true }, 200, env);
}

// Stripe signature verification (HMAC-SHA256)
async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  try {
    const parts = {};
    header.split(',').forEach(pair => {
      const [k, v] = pair.split('=');
      parts[k] = v;
    });
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    // Check timestamp is within 5 minutes
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (age > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === signature;
  } catch {
    return false;
  }
}

// ============================================================================
// USAGE TRACKING
// ============================================================================

async function logUsage(env, userId, action, data = {}) {
  try {
    await supabaseQuery(env, 'usage_log', {
      method: 'POST',
      body: {
        user_id: userId,
        action,
        input_tokens: data.input_tokens || 0,
        output_tokens: data.output_tokens || 0,
        cost_anthropic: data.cost_anthropic || 0,
        cost_twitter: data.cost_twitter || 0,
        cost_total: (data.cost_anthropic || 0) + (data.cost_twitter || 0),
        accounts_count: data.accounts_count || 0,
        tweets_count: data.tweets_count || 0,
        signals_count: data.signals_count || 0,
      },
      prefer: 'return=minimal',
    });
  } catch (e) {
    console.warn('Usage log failed:', e.message);
  }
}

// ============================================================================
// CORS PROXY (for Yahoo Finance, CoinGecko, etc.)
// ============================================================================

async function handleProxy(request, env, ctx) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return corsJson({ error: 'Missing ?url= parameter' }, 400, env);
  }

  let targetUrl;
  try {
    targetUrl = new URL(decodeURIComponent(target));
  } catch {
    return corsJson({ error: 'Invalid URL' }, 400, env);
  }

  // Only allow specific hosts
  const allowed = ['query1.finance.yahoo.com', 'api.coingecko.com'];
  if (!allowed.some(h => targetUrl.hostname.endsWith(h))) {
    return corsJson({ error: 'Host not allowed' }, 403, env);
  }

  try {
    // Use CF cache for proxy responses (prices don't change every second)
    const cacheUrl = new URL(request.url);
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheUrl);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(targetUrl.toString());
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(env)).forEach(([k, v]) => headers.set(k, v));
    // Cache price data for 60s at the edge
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    const proxied = new Response(response.body, {
      status: response.status,
      headers,
    });

    // Store in CF cache (non-blocking)
    ctx.waitUntil(cache.put(cacheUrl, proxied.clone()));
    return proxied;
  } catch (e) {
    return corsJson({ error: e.message }, 502, env);
  }
}
