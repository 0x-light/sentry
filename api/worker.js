// ============================================================================
// SENTRY v3 — Backend API (Cloudflare Worker)
// ============================================================================
//
// Routes:
//   POST /api/tweets/fetch       - Fetch tweets for an account (proxied)
//   POST /api/tweets/fetch-batch - Fetch tweets for multiple accounts (batched)
//   POST /api/analyze            - Analyze tweets with Claude (proxied)
//   POST /api/analysis/check-cache - Check per-tweet analysis cache (cross-user)
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
//   POST /api/scans/reserve      - Pre-check & reserve credits before scan
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
// KV-BASED RATE LIMITER
// Uses TWEET_CACHE KV (with short TTL) to track request counts per key.
// Returns { ok, remaining, retryAfter } where ok=false means rate-limited.
// ---------------------------------------------------------------------------
async function checkRateLimit(env, key, maxRequests, windowSecs) {
  if (!env.TWEET_CACHE) return { ok: true, remaining: maxRequests };
  const kvKey = `rl:${key}`;
  try {
    const existing = await env.TWEET_CACHE.get(kvKey, 'json');
    const now = Date.now();
    if (existing && (now - existing.ts) < windowSecs * 1000) {
      if (existing.count >= maxRequests) {
        const retryAfter = Math.ceil((existing.ts + windowSecs * 1000 - now) / 1000);
        return { ok: false, remaining: 0, retryAfter };
      }
      // Optimistic increment — KV is eventually consistent so this isn't perfect,
      // but we add a small random jitter to the count to reduce collision impact.
      // For strict rate limiting, use Durable Objects or an external store.
      const newCount = existing.count + 1;
      await env.TWEET_CACHE.put(kvKey, JSON.stringify({ ts: existing.ts, count: newCount }), { expirationTtl: windowSecs });
      return { ok: true, remaining: maxRequests - newCount };
    }
    // New window — write immediately to minimize the TOCTOU gap
    await env.TWEET_CACHE.put(kvKey, JSON.stringify({ ts: now, count: 1 }), { expirationTtl: windowSecs });
    return { ok: true, remaining: maxRequests - 1 };
  } catch {
    return { ok: true, remaining: maxRequests }; // fail open
  }
}

// ---------------------------------------------------------------------------
// ANTHROPIC MODELS CACHE (per isolate)
// ---------------------------------------------------------------------------
// We occasionally see model IDs change/deprecate. Use the Models API to
// resolve requested models to an actually-available model ID for our key.
// Docs: https://platform.claude.com/docs/en/api/overview (Models API: GET /v1/models)
const ANTHROPIC_MODELS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let anthropicModelsCache = { ts: 0, models: null };

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
  max_accounts: 150,
  scans_per_week: 1,
};

const MAX_ACCOUNTS_PER_SCAN = 1000; // hard server-side cap
const MAX_BATCH_FETCH_ACCOUNTS = 100;
const TWITTER_USERNAME_RE = /^[a-zA-Z0-9_]{1,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY'];
let baseEnvValidated = false;

function ensureBaseEnv(env) {
  if (baseEnvValidated) return;
  const missing = BASE_REQUIRED_ENV.filter((k) => !env?.[k]);
  if (missing.length) {
    throw Object.assign(new Error(`Server misconfigured: missing ${missing.join(', ')}`), { status: 500 });
  }
  try {
    new URL(env.SUPABASE_URL);
  } catch {
    throw Object.assign(new Error('Server misconfigured: SUPABASE_URL is invalid'), { status: 500 });
  }
  baseEnvValidated = true;
}

function parseIntegerInRange(value, _fieldName, min, max) {
  const num = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  if (!Number.isInteger(num) || num < min || num > max) return null;
  return num;
}

function normalizeTwitterAccount(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@/, '').toLowerCase();
  if (!TWITTER_USERNAME_RE.test(normalized)) return null;
  return normalized;
}

function normalizeTwitterAccountList(values, { min = 1, max = MAX_ACCOUNTS_PER_SCAN } = {}) {
  if (!Array.isArray(values)) return null;
  const seen = new Set();
  const normalized = [];
  for (const raw of values) {
    const account = normalizeTwitterAccount(raw);
    if (!account) return null;
    if (!seen.has(account)) {
      seen.add(account);
      normalized.push(account);
    }
  }
  if (normalized.length < min || normalized.length > max) return null;
  return normalized;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isSafeAnalystId(value) {
  return typeof value === 'string' && /^a_[a-zA-Z0-9-]{6,100}$/.test(value);
}

// Model credit multipliers (relative to Sonnet = 1.0)
// Haiku is ~4× cheaper, Opus is ~5× more expensive
const MODEL_CREDIT_MULTIPLIER = { haiku: 0.25, sonnet: 1, opus: 5 };

function getModelCreditMultiplier(model) {
  const id = (model || '').toLowerCase();
  for (const [tier, mult] of Object.entries(MODEL_CREDIT_MULTIPLIER)) {
    if (id.includes(tier)) return mult;
  }
  return 1; // default to Sonnet baseline
}

function calculateScanCredits(accountsCount, rangeDays, model) {
  let rangeMultiplier;
  if (rangeDays <= 1) rangeMultiplier = 1;
  else if (rangeDays <= 3) rangeMultiplier = 2;
  else if (rangeDays <= 7) rangeMultiplier = 3;
  else if (rangeDays <= 14) rangeMultiplier = 5;
  else if (rangeDays <= 30) rangeMultiplier = 8;
  else rangeMultiplier = 10;
  return Math.ceil(accountsCount * rangeMultiplier * getModelCreditMultiplier(model));
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
  // ── Cron trigger: runs scheduled scans server-side ─────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDueScheduledScans(env, ctx));
  },

  // ── Queue consumer: processes scan chunks in parallel ──────────────────
  // Each message gets its own fresh 1000 subrequest budget
  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        await handleQueueMessage(msg.body, env, ctx);
        msg.ack();
      } catch (e) {
        console.error('[queue] Message failed:', e.message, e.stack);
        msg.retry();
      }
    }
  },

  async fetch(request, env, ctx) {
    // Resolve CORS origin: reflect request origin if it's in our allow-list
    const reqOrigin = request.headers.get('Origin') || '';
    if (getAllowedOrigins().has(reqOrigin)) {
      env._cors_origin = reqOrigin;
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      // Admin endpoints allow any origin (protected by secret, not CORS)
      const prefUrl = new URL(request.url);
      const prefPath = prefUrl.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      if (prefPath.startsWith('/api/admin/')) {
        return corsResponse(null, 204, env, '*');
      }
      return corsResponse(null, 204, env);
    }

    const url = new URL(request.url);
    // Normalize path so route matching isn't sensitive to accidental `//` or trailing `/`.
    // (Some clients may send `//api/...` if their base URL ends with `/`.)
    const rawPath = url.pathname;
    const path = rawPath.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const method = request.method;

    try {
      // --- Public routes (no auth required) ---
      if (path === '/api/billing/webhook' && method === 'POST') {
        return handleStripeWebhook(request, env);
      }
      // CORS proxy — public (hostname allowlist prevents abuse)
      if (path === '/api/proxy' && method === 'GET') {
        return handleProxy(request, env, ctx);
      }
      if (path === '/api/health') {
        return corsJson({ status: 'ok', version: 'v3' }, 200, env);
      }
      ensureBaseEnv(env);
      if (path === '/api/admin/monitoring' && method === 'GET') {
        return handleAdminMonitoring(request, env);
      }
      if (path.startsWith('/api/shared/') && method === 'GET') {
        const shareId = path.slice('/api/shared/'.length);
        return handleGetSharedScan(env, shareId);
      }

      // --- Auth required routes ---
      const user = await authenticate(request, env);
      if (!user) {
        return corsJson({ error: 'Unauthorized' }, 401, env);
      }

      // Per-user rate limit: 120 requests per minute (generous but prevents abuse)
      const userRl = await checkRateLimit(env, `user:${user.id}`, 120, 60);
      if (!userRl.ok) {
        return corsJson({ error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }, 429, env);
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
      if (path === '/api/analysis/check-cache' && method === 'POST') {
        return handleCheckAnalysisCache(request, env, user);
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
      if (path === '/api/scans/reserve' && method === 'POST') {
        return handleReserveCredits(request, env, user);
      }
      if (path === '/api/scans/share' && method === 'POST') {
        return handleShareScan(request, env, user);
      }

      // Scheduled scans
      if (path === '/api/user/schedules' && method === 'GET') {
        return handleGetSchedules(env, user);
      }
      if (path === '/api/user/schedules' && method === 'POST') {
        return handleSaveSchedule(request, env, user);
      }
      if (path === '/api/user/schedules' && method === 'DELETE') {
        return handleDeleteSchedule(request, env, user);
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
      const status = e.status || 500;
      if (status >= 500) {
        console.error('Unhandled error:', e.message, e.stack);
        return corsJson({ error: 'Internal server error' }, status, env);
      }
      return corsJson({ error: e.message || 'Request failed' }, status, env);
    }
  },
};

// ============================================================================
// SCHEDULED SCAN EXECUTION (Cron Trigger)
// ============================================================================

// Default analyst prompt (same as frontend DEFAULT_PROMPT)
const DEFAULT_ANALYST_PROMPT = `You are an elite financial intelligence analyst. Extract actionable trading signals from these tweets with the precision of a portfolio manager deploying real capital.

CORE DIRECTIVE: Be ruthlessly selective. Most tweets are noise. Only extract signals where there is a genuine directional opinion, thesis, or actionable insight.

INCLUDE:
- Directional views on specific assets (bullish/bearish with reasoning)
- Macro theses that imply positioning (e.g. "inflation returning" → bonds, gold, dollar implications)
- Catalysts: earnings, protocol upgrades, regulatory events, product launches
- Technical analysis with specific levels, targets, or pattern recognition
- On-chain/flow data indicating smart money movement or unusual activity
- Contrarian takes that challenge prevailing consensus (particularly valuable)
- Fund/whale positioning changes or portfolio shifts

SKIP:
- Pure memes without an underlying market thesis (but note: alpha can hide in humor — if there's a real opinion beneath the joke, extract it)
- Vague hype, engagement bait, motivational trading quotes
- Personal updates unrelated to markets
- Restated common knowledge with no new angle or timing element
- Promotional content without substantive analysis

ACCURACY:
- Ground every claim in the specific tweet at the given tweet_url. Never mix facts across tweets.
- Inference is allowed but flag it: "implies", "suggests", "appears to".
- Vague tweet → vague signal. Never fabricate specifics (products, events, metrics, partnerships).
- Quote tweets/replies: the author's opinion is the signal; clearly distinguish from quoted content.
- Threads (sequential tweets, same author, short timeframe): synthesize into one coherent signal.

IMAGES: Analyze charts for key levels, patterns, and annotations. Extract data from screenshots (order books, dashboards, news). Skip purely comedic images unless they encode a real market opinion.

WRITING:
- Titles: max 12 words, scannable in 2 seconds, lead with $TICKER when relevant. Signal inference when present.
- Summaries: 1-2 sentences answering: what's the view, why, and what's the implied trade? Quote key phrases from the tweet when they add punch.
- Plain language for a smart generalist. Clarify jargon briefly if used (e.g. "TVL (total value locked)").
- Be precise about which price/level belongs to which asset when multiple are mentioned.

Return a JSON array. Each signal:
- "title": headline, lead with $TICKER when relevant
- "summary": 1-2 sentences — opinion, reasoning, implied positioning
- "category": "Trade" (direct position idea with clear direction) | "Insight" (macro thesis, market structure, analytical observation) | "Tool" (product, platform, or technology for trading/research) | "Resource" (educational content, data source, reference)
- "source": twitter handle (no @)
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch"}]
  Extract ALL tradeable assets. Convert:
  • Company → stock (Nvidia → $NVDA, Apple → $AAPL, Samsung → $005930.KS, TSMC → $TSM)
  • Index → ETF (S&P/SPX → $SPY, Nasdaq → $QQQ, Dow → $DIA, Russell → $IWM, VIX → $VIX)
  • Crypto name or abbreviation → ticker with $ (Bitcoin/BTC → $BTC, Ethereum/ETH → $ETH, Solana/SOL → $SOL, Hyperliquid/HYPE → $HYPE)
  • Protocol → token (Uniswap → $UNI, Aave → $AAVE, Chainlink → $LINK, Jupiter → $JUP)
  • Commodity → standard ticker (Gold → $XAU, Silver → $XAG, Oil → $USO, Natgas → $UNG)
  Yahoo Finance format: US = symbol ($AAPL), Taiwan = .TW, HK = .HK, Japan = .T, Korea = .KS, crypto = symbol only. NEVER skip a tradeable asset. When in doubt, include it.
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned (articles, substacks, dashboards). Empty array if none.

Return ONLY valid JSON array. No markdown, no explanation.`;

/**
 * Check if a schedule is due to run right now.
 * Accounts for the schedule's timezone.
 */
/**
 * Safely get current time in a given IANA timezone.
 * Returns { hour: 0-23, minute: 0-59, weekday: 0-6 (Sun-Sat) }.
 */
function getNowInTimezone(tz) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    const rawHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const rawMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value || '';
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      hour: Math.max(0, Math.min(23, rawHour)),     // clamp to 0-23 (handles "24" edge)
      minute: Math.max(0, Math.min(59, rawMinute)),
      weekday: dayMap[weekdayStr] ?? new Date().getUTCDay(),
    };
  } catch {
    const d = new Date();
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
  }
}

/**
 * Check if a schedule is due to run right now.
 * - Validates schedule data before checking.
 * - Uses timezone-aware time comparison.
 * - 3-minute window to tolerate cron jitter.
 * - Prevents double-runs within 55 minutes.
 */
function isScheduleDue(schedule) {
  // Validate required fields
  if (!schedule?.id || !schedule?.user_id || !schedule?.time) return false;

  const tz = schedule.timezone || 'UTC';
  const now = getNowInTimezone(tz);

  // Check day-of-week filter (empty array or missing = every day)
  const days = Array.isArray(schedule.days) ? schedule.days.filter(d => d >= 0 && d <= 6) : [];
  if (days.length > 0 && !days.includes(now.weekday)) return false;

  // Parse and validate schedule time
  const match = (schedule.time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const schedH = Math.max(0, Math.min(23, parseInt(match[1], 10)));
  const schedM = Math.max(0, Math.min(59, parseInt(match[2], 10)));

  const scheduleMinutes = schedH * 60 + schedM;
  const currentMinutes = now.hour * 60 + now.minute;

  // Must be within a 3-minute window (cron runs every 1 min; allows for jitter/delay)
  const diff = currentMinutes - scheduleMinutes;
  // Handle midnight wrap: schedule at 23:59, current at 00:01 → diff = -1438, but should be 2
  const wrappedDiff = diff < -720 ? diff + 1440 : diff > 720 ? diff - 1440 : diff;
  if (wrappedDiff < 0 || wrappedDiff > 2) return false;

  // Prevent double-runs: skip if last run was within 55 minutes
  if (schedule.last_run_at) {
    const msSinceLastRun = Date.now() - new Date(schedule.last_run_at).getTime();
    if (msSinceLastRun < 55 * 60_000) return false;
  }

  return true;
}

/**
 * Format a single tweet for Claude analysis (server-side version of client's formatTweetForAnalysis).
 */
function formatTweetForAnalysisServer(tw, account) {
  if (!tw) return null;

  // Safe date parsing
  let date = 'unknown';
  try {
    if (tw.createdAt) date = new Date(tw.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  } catch { /* keep 'unknown' */ }

  const engagement = `${tw.likeCount || 0}♥ ${tw.retweetCount || 0}↻ ${tw.viewCount || 0}👁`;
  const tweetId = tw.id || '';
  const author = tw.author?.userName || account || 'unknown';
  const url = tweetId ? `https://x.com/${author}/status/${tweetId}` : '';

  // Remove control characters but preserve unicode
  let text = (tw.text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  const externalLinks = [];

  if (Array.isArray(tw.entities?.urls)) {
    for (const u of tw.entities.urls) {
      if (u.url && u.expanded_url) {
        // Replace all occurrences of shortened URL
        text = text.split(u.url).join(u.expanded_url);
        if (!u.expanded_url.match(/^https?:\/\/(twitter\.com|x\.com|t\.co)\//)) {
          externalLinks.push(u.expanded_url);
        }
      }
    }
  }

  const parts = [`[${date}] ${text}`, `engagement: ${engagement}`];
  if (url) parts.push(`tweet_url: ${url}`);
  if (externalLinks.length) parts.push(`external_links: ${externalLinks.join(', ')}`);
  if (tw.isReply) parts.push(`(reply to @${tw.inReplyToUsername || 'unknown'})`);
  if (tw.quoted_tweet?.text) {
    const quotedText = tw.quoted_tweet.text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 2000);
    const quotedAuthor = tw.quoted_tweet.author?.userName || 'unknown';
    parts.push(`--- QUOTED @${quotedAuthor} ---\n${quotedText}\n--- END QUOTE ---`);
  }

  return { text: parts.join('\n'), url };
}

/**
 * Build analysis batches from account tweet data (server-side version).
 */
function buildAnalysisBatches(accountData, promptLength) {
  const MAX_BATCH_CHARS = 100000; // conservative limit (Anthropic context varies by model)
  const SEPARATOR = '\n\n';
  const safePromptLen = Math.max(0, promptLength || 0);

  // Filter out accounts with no tweets and format
  const items = accountData
    .filter(a => a.tweets?.length > 0)
    .map(a => {
      const header = `=== @${a.account} (${a.tweets.length} tweets) ===`;
      const formatted = a.tweets.map(tw => formatTweetForAnalysisServer(tw, a.account)).filter(Boolean);
      const body = formatted.map(f => f.text).join('\n---\n');
      const tweetUrls = formatted.map(f => f.url).filter(Boolean);
      return {
        account: a.account,
        text: `${header}\n${body}`,
        size: header.length + body.length,
        tweetUrls,
      };
    })
    .filter(item => item.size > 0);

  if (!items.length) return [];

  // Sort largest first for better bin-packing
  items.sort((a, b) => b.size - a.size);

  const batches = [];
  for (const item of items) {
    let placed = false;
    for (const batch of batches) {
      const extra = (batch.items.length ? SEPARATOR.length : 0) + item.size;
      if (batch.size + extra <= MAX_BATCH_CHARS) {
        batch.items.push(item);
        batch.size += extra;
        batch.tweetUrls.push(...item.tweetUrls);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push({ items: [item], size: safePromptLen + item.size, tweetUrls: [...item.tweetUrls] });
    }
  }

  return batches.map(b => ({
    text: b.items.map(i => i.text).join(SEPARATOR),
    tweetUrls: [...new Set(b.tweetUrls)],
    accounts: b.items.map(i => i.account),
  }));
}

/**
 * Simple djb2 hash (same as client-side hashString).
 */
function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

// ============================================================================
// QUEUE-BASED SCHEDULED SCANS
// ============================================================================
// Each queue message gets its own fresh 1000-subrequest budget, allowing
// scans to handle any number of accounts by splitting work into chunks.

const QUEUE_CHUNK_SIZE = 30; // accounts per fetch-chunk message

/**
 * Route incoming queue messages to the appropriate handler.
 */
async function handleQueueMessage(body, env, ctx) {
  switch (body.type) {
    case 'fetch-chunk':
      return handleFetchChunkMessage(body, env, ctx);
    case 'analyze':
      return handleAnalyzeMessage(body, env, ctx);
    default:
      console.error(`[queue] Unknown message type: ${body.type}`);
  }
}

/**
 * Queue handler: Fetch tweets for a chunk of ~30 accounts.
 * Each invocation gets a fresh 1000-subrequest budget.
 */
async function handleFetchChunkMessage({ scanId, chunkIndex, accounts, days }, env, ctx) {
  const log = (msg) => console.log(`[queue:fetch-chunk:${scanId.slice(0, 8)}:${chunkIndex}] ${msg}`);
  log(`Fetching ${accounts.length} accounts (days=${days})`);

  // Verify scan is still active
  const metaKey = `scan:${scanId}:meta`;
  const meta = await env.TWEET_CACHE.get(metaKey, 'json');
  if (!meta) {
    log('Scan meta not found — scan may have been cancelled');
    return;
  }

  // Fetch tweets with generous budget (this message has its own 1000 limit)
  const budget = { used: 3, limit: 900 };
  const accountData = [];
  const failedAccounts = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const remaining = budget.limit - budget.used;
    if (remaining < CONCURRENCY * 2) {
      log(`Budget low (${remaining} left) — stopping at ${i}/${accounts.length}`);
      break;
    }
    const chunk = accounts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (account) => {
        const tweets = await fetchTweetsLean(account, days, env, budget);
        return { account, tweets: tweets || [] };
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        accountData.push(results[j].value);
      } else {
        failedAccounts.push(chunk[j]);
        accountData.push({ account: chunk[j], tweets: [] });
      }
    }
  }

  const totalTweets = accountData.reduce((s, a) => s + a.tweets.length, 0);
  log(`Done: ${totalTweets} tweets from ${accountData.filter(a => a.tweets.length).length}/${accounts.length} accounts (${budget.used} subreqs)`);

  // Store chunk results in KV (expires in 2 hours)
  const chunkKey = `scan:${scanId}:chunk:${chunkIndex}`;
  await env.TWEET_CACHE.put(chunkKey, JSON.stringify({
    accountData,
    failedAccounts,
    totalTweets,
  }), { expirationTtl: 7200 });

  log(`Chunk ${chunkIndex} stored`);
}

/**
 * Queue handler: Once all fetch-chunks are done, analyze tweets and save results.
 * Re-queues itself with delay if chunks aren't ready yet.
 */
async function handleAnalyzeMessage({ scanId, attempt }, env, ctx) {
  const log = (msg) => console.log(`[queue:analyze:${scanId.slice(0, 8)}] ${msg}`);
  attempt = attempt || 1;
  log(`Attempt ${attempt}`);

  const metaKey = `scan:${scanId}:meta`;
  const meta = await env.TWEET_CACHE.get(metaKey, 'json');
  if (!meta) {
    log('Scan meta not found — scan may have been cancelled or expired');
    return;
  }

  const { totalChunks, scheduleId, userId, accounts, days,
          model, prompt, promptHash, creditsNeeded, label } = meta;

  // Check if all chunks are done by probing each chunk key (no counter race condition)
  let completedChunks = 0;
  for (let i = 0; i < totalChunks; i++) {
    const exists = await env.TWEET_CACHE.get(`scan:${scanId}:chunk:${i}`, 'json');
    if (exists) completedChunks++;
  }

  if (completedChunks < totalChunks) {
    if (attempt >= 20) {
      log(`Giving up after ${attempt} attempts (${completedChunks}/${totalChunks} chunks complete)`);
      await supabaseQuery(env, `scheduled_scans?id=eq.${scheduleId}`, {
        method: 'PATCH',
        body: { last_run_status: 'error', last_run_message: `Timed out waiting for tweet fetching (${completedChunks}/${totalChunks} chunks)` },
      });
      await cleanupScanKV(env, scanId, totalChunks);
      return;
    }
    log(`Waiting for chunks: ${completedChunks}/${totalChunks} complete — re-queuing (attempt ${attempt})`);
    await env.SCAN_QUEUE.send(
      { type: 'analyze', scanId, attempt: attempt + 1 },
      { delaySeconds: 15 }
    );
    return;
  }

  log(`All ${totalChunks} chunks complete — reading results`);

  // Read all chunk data from KV
  const allAccountData = [];
  const allFailedAccounts = [];
  let totalTweets = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkKey = `scan:${scanId}:chunk:${i}`;
    const chunkData = await env.TWEET_CACHE.get(chunkKey, 'json');
    if (chunkData) {
      allAccountData.push(...chunkData.accountData);
      allFailedAccounts.push(...chunkData.failedAccounts);
      totalTweets += chunkData.totalTweets;
    } else {
      log(`Warning: chunk ${i} data missing from KV`);
    }
  }

  log(`Merged: ${totalTweets} tweets from ${allAccountData.filter(a => a.tweets.length > 0).length}/${accounts.length} accounts`);

  if (totalTweets === 0) {
    const detail = allFailedAccounts.length
      ? `No tweets (${allFailedAccounts.length}/${accounts.length} accounts failed)`
      : `No tweets found for ${accounts.length} accounts in the last ${days === 1 ? 'day' : days + ' days'}`;
    await supabaseQuery(env, `scheduled_scans?id=eq.${scheduleId}`, {
      method: 'PATCH',
      body: { last_run_status: 'error', last_run_message: detail },
    });
    await cleanupScanKV(env, scanId, totalChunks);
    return;
  }

  // Call Anthropic API — this message has its own fresh subrequest budget
  let newSignals = [];
  let batchesFailed = 0;
  let batchesTotal = 0;
  const resolvedModel = normalizeModelId(model) || model;

  if (allAccountData.some(a => a.tweets.length > 0)) {
    const batches = buildAnalysisBatches(allAccountData, prompt.length || 0);
    batchesTotal = batches.length;
    log(`Analyzing ${totalTweets} tweets in ${batchesTotal} batch${batchesTotal !== 1 ? 'es' : ''}`);

    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }

    let batchIdx = 0;
    for (const batch of batches) {
      batchIdx++;
      try {
        log(`Batch ${batchIdx}/${batchesTotal} (${batch.accounts.length} accounts, ~${(batch.text.length / 1000).toFixed(0)}KB)`);

        const anthropicBody = {
          model: resolvedModel,
          max_tokens: 16384,
          system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: batch.text }],
        };

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(anthropicBody),
          signal: AbortSignal.timeout(120_000),
        });

        if (res.status === 429) throw new Error('Anthropic rate limited');
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || `Anthropic error (${res.status})`);

        if (data?.content) {
          const text = extractText(data.content);
          const batchSignals = safeParseSignals(text);
          newSignals.push(...batchSignals);
        }
      } catch (e) {
        batchesFailed++;
        console.error(`[queue:analyze:${scanId.slice(0, 8)}] Batch ${batchIdx} failed:`, e.message);
      }
    }
  }

  // Dedup signals
  const seen = new Set();
  const dedupedSignals = newSignals.filter(s => {
    const key = `${s.tweet_url || ''}::${s.title || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (dedupedSignals.length === 0 && batchesFailed > 0) {
    await supabaseQuery(env, `scheduled_scans?id=eq.${scheduleId}`, {
      method: 'PATCH',
      body: { last_run_status: 'error', last_run_message: `Analysis failed (${batchesFailed}/${batchesTotal} batches failed)` },
    });
    await cleanupScanKV(env, scanId, totalChunks);
    throw new Error(`Analysis failed (${batchesFailed}/${batchesTotal} batches failed)`);
  }

  // Enrich signals with tweet_time and expand t.co links
  const enrichedSignals = enrichSignals(dedupedSignals, allAccountData);

  // Save scan to DB + deduct credits
  await saveScanToDb(env, ctx, userId, {
    accounts, days, model, promptHash, creditsNeeded,
    signals: enrichedSignals, totalTweets, label, accountData: allAccountData,
  });

  // Update schedule status
  const parts = [`${dedupedSignals.length} signals from ${totalTweets} tweets`];
  if (batchesFailed) parts.push(`(${batchesFailed} batch${batchesFailed > 1 ? 'es' : ''} failed)`);
  if (allFailedAccounts.length) parts.push(`(${allFailedAccounts.length} unreachable)`);
  await supabaseQuery(env, `scheduled_scans?id=eq.${scheduleId}`, {
    method: 'PATCH',
    body: { last_run_status: 'success', last_run_message: parts.join(' ') },
  });

  log(`Complete: ${parts[0]}`);

  // Cleanup KV
  await cleanupScanKV(env, scanId, totalChunks);
}

/**
 * Enrich signals with tweet_time and expand t.co links.
 * The frontend expects tweet_time for relative time display (e.g. "5m", "3h").
 * Also resolves any t.co short links in the links array to full URLs.
 */
function enrichSignals(signals, accountData) {
  // Build tweet_url → createdAt map
  const tweetTimes = {};
  // Build t.co → expanded URL map from tweet entities
  const tcoMap = {};

  for (const a of accountData) {
    const author = a.account || '';
    for (const tw of (a.tweets || [])) {
      const tweetId = tw.id || '';
      const tweetAuthor = tw.author?.userName || author;
      const url = tweetId ? `https://x.com/${tweetAuthor}/status/${tweetId}` : '';
      if (url && tw.createdAt) tweetTimes[url] = tw.createdAt;

      // Collect t.co → expanded mappings from entities
      if (Array.isArray(tw.entities?.urls)) {
        for (const u of tw.entities.urls) {
          if (u.url && u.expanded_url) {
            tcoMap[u.url] = u.expanded_url;
          }
        }
      }
    }
  }

  return signals.map(s => {
    const enriched = { ...s };

    // Add tweet_time
    if (s.tweet_url && tweetTimes[s.tweet_url]) {
      enriched.tweet_time = tweetTimes[s.tweet_url];
    }

    // Expand t.co links in the links array
    if (Array.isArray(s.links)) {
      enriched.links = s.links.map(link => {
        if (link.includes('t.co/')) return tcoMap[link] || link;
        return link;
      });
    }

    return enriched;
  });
}

/**
 * Clean up temporary KV keys for a completed/failed scan.
 */
async function cleanupScanKV(env, scanId, totalChunks) {
  try {
    const deletes = [`scan:${scanId}:meta`];
    for (let i = 0; i < totalChunks; i++) {
      deletes.push(`scan:${scanId}:chunk:${i}`);
    }
    // KV deletes are fire-and-forget (best effort)
    await Promise.allSettled(deletes.map(k => env.TWEET_CACHE.delete(k)));
  } catch (e) {
    console.warn(`[cleanup] Failed to clean KV for scan ${scanId}:`, e.message);
  }
}

/**
 * Dispatch a scheduled scan via queue — splits accounts into chunks.
 * Called from cron handler when SCAN_QUEUE is available.
 */
async function dispatchScheduledScanViaQueue(env, ctx, schedule) {
  const sid = schedule.id;
  const userId = schedule.user_id;
  const log = (msg) => console.log(`[cron:dispatch:${sid.slice(0, 8)}] ${msg}`);

  // Mark as running
  await supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
    method: 'PATCH',
    body: { last_run_status: 'running', last_run_at: new Date().toISOString() },
  });

  try {
    // 1. Resolve accounts (same logic as executeScheduledScanInner)
    let accounts = Array.isArray(schedule.accounts) ? [...schedule.accounts] : [];
    let accountSource = 'schedule';

    if (schedule.preset_id && !accounts.length) {
      try {
        const rows = await supabaseQuery(env, `presets?id=eq.${schedule.preset_id}&user_id=eq.${userId}&select=accounts`);
        if (rows?.[0]?.accounts?.length) { accounts = rows[0].accounts; accountSource = 'preset'; }
      } catch (e) { log(`Preset lookup failed: ${e.message}`); }
    }

    if (!accounts.length) {
      try {
        const userPresets = await supabaseQuery(env, `presets?user_id=eq.${userId}&select=accounts&order=updated_at.desc&limit=5`);
        if (userPresets?.length) {
          const all = new Set();
          userPresets.forEach(p => (p.accounts || []).forEach(a => all.add(a)));
          accounts = [...all];
          accountSource = 'user_presets';
        }
      } catch (e) { log(`User presets lookup failed: ${e.message}`); }
    }

    if (!accounts.length) {
      await supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
        method: 'PATCH',
        body: { last_run_status: 'error', last_run_message: 'No accounts — add lists/accounts to this schedule' },
      });
      return;
    }

    log(`${accounts.length} accounts (from ${accountSource})`);

    // 2. Get analyst prompt + model
    let prompt = DEFAULT_ANALYST_PROMPT;
    let model = 'claude-sonnet-4-20250514';
    try {
      const [analysts, settings] = await Promise.all([
        supabaseQuery(env, `analysts?user_id=eq.${userId}&is_active=eq.true&select=prompt&limit=1`),
        supabaseQuery(env, `user_settings?user_id=eq.${userId}&select=model`),
      ]);
      if (analysts?.[0]?.prompt) prompt = analysts[0].prompt;
      if (settings?.[0]?.model) model = settings[0].model;
    } catch { /* use defaults */ }

    // 3. Check credits
    const days = Math.max(1, Math.min(30, schedule.range_days || 1));
    const creditsNeeded = calculateScanCredits(accounts.length, days, model);
    const profile = await getProfile(env, userId);

    if (!profile || profile.credits_balance < creditsNeeded) {
      await supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
        method: 'PATCH',
        body: { last_run_status: 'error', last_run_message: `Insufficient credits (need ${creditsNeeded}, have ${profile?.credits_balance || 0})` },
      });
      return;
    }

    // 4. Check cross-user scan cache
    const promptHash = djb2Hash(`${model}\n${prompt}`);
    const scanKey = await hashScanKey(accounts, days, promptHash);
    if (env.TWEET_CACHE) {
      try {
        const cached = await env.TWEET_CACHE.get(scanKey, 'json');
        if (cached?.signals?.length) {
          await saveScanToDb(env, ctx, userId, { accounts, days, model, promptHash, creditsNeeded, signals: cached.signals, totalTweets: cached.total_tweets || 0, label: schedule.label });
          await supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
            method: 'PATCH',
            body: { last_run_status: 'success', last_run_message: `${cached.signals.length} signals (cached)` },
          });
          log('Served from scan cache');
          return;
        }
      } catch (e) { log(`Scan cache check failed: ${e.message}`); }
    }

    // 5. Generate scan ID and split into chunks
    const scanId = crypto.randomUUID();
    const chunks = [];
    for (let i = 0; i < accounts.length; i += QUEUE_CHUNK_SIZE) {
      chunks.push(accounts.slice(i, i + QUEUE_CHUNK_SIZE));
    }

    // 6. Store scan metadata in KV
    const metaKey = `scan:${scanId}:meta`;
    await env.TWEET_CACHE.put(metaKey, JSON.stringify({
      totalChunks: chunks.length,
      completedChunks: 0,
      scheduleId: sid,
      userId,
      accounts,
      days,
      model,
      prompt,
      promptHash,
      creditsNeeded,
      label: schedule.label,
    }), { expirationTtl: 7200 });

    // 7. Send fetch-chunk messages (processed in parallel by queue)
    const messages = chunks.map((chunkAccounts, idx) => ({
      body: { type: 'fetch-chunk', scanId, chunkIndex: idx, accounts: chunkAccounts, days },
    }));

    // Queue.sendBatch supports up to 100 messages per call
    for (let i = 0; i < messages.length; i += 100) {
      await env.SCAN_QUEUE.sendBatch(messages.slice(i, i + 100));
    }

    // 8. Send analyze message with delay (gives fetch-chunks time to complete)
    const delaySeconds = Math.min(90, Math.max(20, chunks.length * 10));
    await env.SCAN_QUEUE.send(
      { type: 'analyze', scanId, attempt: 1 },
      { delaySeconds }
    );

    log(`Dispatched: ${chunks.length} fetch-chunks + 1 analyze (delay=${delaySeconds}s) for ${accounts.length} accounts`);

  } catch (e) {
    console.error(`[cron:dispatch:${sid.slice(0, 8)}] Failed:`, e.message, e.stack);
    await supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
      method: 'PATCH',
      body: { last_run_status: 'error', last_run_message: e.message?.slice(0, 200) || 'Dispatch failed' },
    });
  }
}

/**
 * Run a single scheduled scan server-side (LEGACY — inline execution).
 * Used as fallback when SCAN_QUEUE is not configured.
 * Optimized to stay under the 1000 subrequest limit per Worker invocation.
 */
async function executeScheduledScan(env, ctx, schedule) {
  const userId = schedule.user_id;
  const SCAN_TIMEOUT_MS = 8 * 60_000; // 8 minute hard timeout

  // Mark as running
  await supabaseQuery(env, `scheduled_scans?id=eq.${schedule.id}`, {
    method: 'PATCH',
    body: { last_run_status: 'running', last_run_at: new Date().toISOString() },
  });

  // Wrap entire scan in a timeout so we always update status
  const scanPromise = executeScheduledScanInner(env, ctx, schedule, userId);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Scan timed out')), SCAN_TIMEOUT_MS)
  );

  try {
    await Promise.race([scanPromise, timeoutPromise]);
  } catch (e) {
    console.error(`Scheduled scan failed for schedule ${schedule.id}:`, e.message, e.stack);
    // Retry status update up to 3 times — critical that we don't leave status as 'running'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await supabaseQuery(env, `scheduled_scans?id=eq.${schedule.id}`, {
          method: 'PATCH',
          body: { last_run_status: 'error', last_run_message: e.message?.slice(0, 200) || 'Unknown error' },
        });
        break;
      } catch (statusErr) {
        console.warn(`[sched:${schedule.id.slice(0,8)}] Status update attempt ${attempt + 1} failed:`, statusErr.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
}

async function executeScheduledScanInner(env, ctx, schedule, userId) {
  const sid = schedule.id;
  const log = (msg) => console.log(`[sched:${sid.slice(0, 8)}] ${msg}`);
  const setStatus = (status, message) =>
    supabaseQuery(env, `scheduled_scans?id=eq.${sid}`, {
      method: 'PATCH',
      body: { last_run_status: status, last_run_message: message?.slice(0, 250) },
    }).catch(e => console.error(`[sched:${sid.slice(0, 8)}] Failed to set status:`, e.message));

  // ── SUBREQUEST BUDGET ──────────────────────────────────────────────────
  // Cloudflare Workers limit: 1000 per invocation. Everything counts: KV, Supabase, Twitter, Anthropic.
  // Cloudflare counts more internally than we track (TLS, chunked reads, etc).
  // The Anthropic API call alone can use 200-400+ internal subrequests.
  // So we cap fetching at ~500 to leave plenty of room for analysis + save.
  const budget = { used: 5, limit: 500 };

  // 1. Resolve accounts — schedule > preset > user's presets
  let accounts = Array.isArray(schedule.accounts) ? [...schedule.accounts] : [];
  let accountSource = 'schedule';

  if (schedule.preset_id && !accounts.length) {
    try {
      budget.used++;
      const rows = await supabaseQuery(env, `presets?id=eq.${schedule.preset_id}&user_id=eq.${userId}&select=accounts`);
      if (rows?.[0]?.accounts?.length) { accounts = rows[0].accounts; accountSource = 'preset'; }
      else log('Preset not found or empty, trying fallbacks');
    } catch (e) { log(`Preset lookup failed: ${e.message}`); }
  }

  if (!accounts.length) {
    try {
      budget.used++;
      const userPresets = await supabaseQuery(env, `presets?user_id=eq.${userId}&select=accounts&order=updated_at.desc&limit=5`);
      if (userPresets?.length) {
        const all = new Set();
        userPresets.forEach(p => (p.accounts || []).forEach(a => all.add(a)));
        accounts = [...all];
        accountSource = 'user_presets';
      }
    } catch (e) { log(`User presets lookup failed: ${e.message}`); }
  }

  if (!accounts.length) {
    await setStatus('error', 'No accounts — add lists/accounts to this schedule');
    return;
  }

  log(`${accounts.length} accounts (from ${accountSource})`);

  // 2. Get analyst prompt + model in ONE parallel batch (save subrequests)
  let prompt = DEFAULT_ANALYST_PROMPT;
  let model = 'claude-sonnet-4-20250514';
  try {
    budget.used += 2;
    const [analysts, settings] = await Promise.all([
      supabaseQuery(env, `analysts?user_id=eq.${userId}&is_active=eq.true&select=prompt&limit=1`),
      supabaseQuery(env, `user_settings?user_id=eq.${userId}&select=model`),
    ]);
    if (analysts?.[0]?.prompt) prompt = analysts[0].prompt;
    if (settings?.[0]?.model) model = settings[0].model;
  } catch { /* use defaults */ }

  // 3. Check credits
  const days = Math.max(1, Math.min(30, schedule.range_days || 1));
  const creditsNeeded = calculateScanCredits(accounts.length, days, model);
  budget.used++;
  const profile = await getProfile(env, userId);

  if (!profile || profile.credits_balance < creditsNeeded) {
    await setStatus('error', `Insufficient credits (need ${creditsNeeded}, have ${profile?.credits_balance || 0})`);
    return;
  }

  // 4. Check cross-user scan cache (1 KV read)
  const promptHash = djb2Hash(`${model}\n${prompt}`);
  const scanKey = await hashScanKey(accounts, days, promptHash);
  if (env.TWEET_CACHE) {
    try {
      budget.used++;
      const cached = await env.TWEET_CACHE.get(scanKey, 'json');
      if (cached?.signals?.length) {
        budget.used += 3; // saveScanToDb uses ~3 subrequests
        await saveScanToDb(env, ctx, userId, { accounts, days, model, promptHash, creditsNeeded, signals: cached.signals, totalTweets: cached.total_tweets || 0, label: schedule.label });
        await setStatus('success', `${cached.signals.length} signals (cached)`);
        log('Served from scan cache');
        return;
      }
    } catch (e) { log(`Scan cache check failed: ${e.message}`); }
  }

  // ── 5. FETCH TWEETS (budget-aware) ─────────────────────────────────────
  // Key optimizations vs regular fetchTweetsCoalesced:
  //   - Only 1 KV read per account (skip stale cache check)
  //   - Max 1 retry on Twitter API (not 3)
  //   - Max 3 pages per account (not 5)
  //   - Stop fetching when subrequest budget is low
  //   - Lower concurrency to avoid thundering-herd retries
  const CONCURRENCY = 5;
  const accountData = [];
  const failedAccounts = [];
  const skippedAccounts = [];
  const fetchStart = Date.now();
  log(`Fetch budget: ~${budget.limit - budget.used} subrequests (used ${budget.used} so far)`);

  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    // Check if we still have budget for fetching
    const remaining = budget.limit - budget.used;
    if (remaining < CONCURRENCY * 2) {
      const skipped = accounts.slice(i);
      skippedAccounts.push(...skipped);
      log(`Budget low (${remaining} left) — skipping ${skipped.length} accounts`);
      break;
    }

    const chunk = accounts.slice(i, i + CONCURRENCY);
    // Pass budget object by reference — fetchTweetsLean mutates budget.used
    const results = await Promise.allSettled(
      chunk.map(async (account) => {
        const tweets = await fetchTweetsLean(account, days, env, budget);
        return { account, tweets: tweets || [] };
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        accountData.push(results[j].value);
      } else {
        failedAccounts.push(chunk[j]);
        accountData.push({ account: chunk[j], tweets: [] });
      }
    }
    log(`Fetched ${Math.min(i + CONCURRENCY, accounts.length)}/${accounts.length} accounts (${((Date.now() - fetchStart) / 1000).toFixed(1)}s, ${budget.used} subreqs)`);
  }

  const totalTweets = accountData.reduce((s, a) => s + a.tweets.length, 0);
  if (failedAccounts.length) log(`Failed: ${failedAccounts.length} accounts`);
  if (skippedAccounts.length) log(`Skipped (budget): ${skippedAccounts.length} accounts`);

  if (totalTweets === 0) {
    const detail = failedAccounts.length
      ? `No tweets (${failedAccounts.length}/${accounts.length} accounts failed)`
      : `No tweets found for ${accounts.length} accounts in the last ${days === 1 ? 'day' : days + ' days'}`;
    await setStatus('error', detail);
    return;
  }

  log(`${totalTweets} tweets from ${accountData.filter(a => a.tweets.length > 0).length}/${accounts.length} accounts`);

  // ── 6. SKIP per-tweet analysis cache ───────────────────────────────────
  // This saves 2-5 Supabase subrequests. We analyze everything fresh.
  // The cross-user SCAN cache (step 4) already handles full-scan dedup.

  // ── 7. CALL CLAUDE (skip model resolution to save 1 subrequest) ────────
  let newSignals = [];
  let batchesFailed = 0;
  let batchesTotal = 0;
  const resolvedModel = normalizeModelId(model) || model; // normalize locally, no API call

  if (accountData.some(a => a.tweets.length > 0)) {
    const batches = buildAnalysisBatches(accountData, prompt.length || 0);
    batchesTotal = batches.length;
    log(`Analyzing ${totalTweets} tweets in ${batchesTotal} batch${batchesTotal !== 1 ? 'es' : ''} (${budget.used} subreqs used)`);

    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }

    let batchIdx = 0;
    for (const batch of batches) {
      batchIdx++;
      // Budget check before each Anthropic call
      if (budget.used >= 940) {
        log(`Budget exhausted before batch ${batchIdx} — stopping analysis`);
        batchesFailed += (batchesTotal - batchIdx + 1);
        break;
      }
      try {
        log(`Batch ${batchIdx}/${batchesTotal} (${batch.accounts.length} accounts, ~${(batch.text.length / 1000).toFixed(0)}KB)`);

        const anthropicBody = {
          model: resolvedModel,
          max_tokens: 16384,
          system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: batch.text }],
        };

        let data = null;
        // Single attempt — no retries (save subrequests)
        budget.used++;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(anthropicBody),
          signal: AbortSignal.timeout(120_000),
        });

        if (res.status === 429) throw new Error('Anthropic rate limited');
        data = await res.json();
        if (data.error) throw new Error(data.error.message || `Anthropic error (${res.status})`);

        if (data?.content) {
          const text = extractText(data.content);
          const batchSignals = safeParseSignals(text);
          newSignals.push(...batchSignals);
        }
      } catch (e) {
        batchesFailed++;
        console.error(`[sched:${sid.slice(0, 8)}] Batch ${batchIdx} failed:`, e.message);
      }
    }
  }

  // ── 8. Combine, dedup, save ────────────────────────────────────────────
  const seen = new Set();
  const dedupedSignals = newSignals.filter(s => {
    const key = `${s.tweet_url || ''}::${s.title || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (dedupedSignals.length === 0 && batchesFailed > 0) {
    throw new Error(`Analysis failed (${batchesFailed}/${batchesTotal} batches failed)`);
  }

  // Enrich signals with tweet_time and expand t.co links
  const enrichedSignals = enrichSignals(dedupedSignals, accountData);

  budget.used += 3; // saveScanToDb: 1 Supabase POST + 1 RPC + 1 KV cache write
  await saveScanToDb(env, ctx, userId, {
    accounts, days, model, promptHash, creditsNeeded,
    signals: enrichedSignals, totalTweets, label: schedule.label, accountData,
  });

  // ── 9. Success ─────────────────────────────────────────────────────────
  const parts = [`${dedupedSignals.length} signals from ${totalTweets} tweets`];
  if (batchesFailed) parts.push(`(${batchesFailed} batch${batchesFailed > 1 ? 'es' : ''} failed)`);
  if (failedAccounts.length) parts.push(`(${failedAccounts.length} unreachable)`);
  if (skippedAccounts.length) parts.push(`(${skippedAccounts.length} skipped, budget limit)`);
  budget.used++;
  await setStatus('success', parts.join(' '));
  log(`Complete: ${parts[0]} | ${budget.used} total subrequests`);
}

/**
 * Lean tweet fetcher for scheduled scans — optimized for subrequest budget.
 *
 * Key differences from fetchTweetsCoalesced:
 *   1. Single KV cache read (no stale-while-revalidate)
 *   2. Max 1 retry on Twitter API errors
 *   3. Max 3 pages of tweets
 *   4. Budget-aware: checks global counter before each API call
 *   5. No background refresh or coalescing (cron is single-threaded)
 */
async function fetchTweetsLean(account, days, env, budget) {
  if (!env.TWITTER_API_KEY) throw new Error('Twitter API key not configured');
  const key = tweetCacheKey(account, days);

  // 1. KV cache check (1 subrequest each)
  if (env.TWEET_CACHE) {
    budget.used++;
    const cached = await env.TWEET_CACHE.get(key, 'json');
    if (cached) return cached;

    // Also try stale key — saves a Twitter API call if found
    if (budget.used < budget.limit - 5) {
      budget.used++;
      const staleKey = tweetCacheKeyStale(account, days);
      const stale = await env.TWEET_CACHE.get(staleKey, 'json');
      if (stale) return stale;
    }
  }

  // 2. Budget check before hitting Twitter API
  if (budget.used >= budget.limit - 3) return [];

  // 3. Fetch from Twitter API (lean: max 3 pages, max 1 retry)
  const FETCH_TIMEOUT = 15_000;
  const cutoff = new Date(Date.now() - days * 86400000);
  const allTweets = [];
  let cursor = null;
  const MAX_PAGES = 3;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (budget.used >= budget.limit - 2) break;

    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);
    const url = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;

    let data = null;
    let retries = 0;
    const MAX_RETRIES = 1;
    while (retries <= MAX_RETRIES) {
      try {
        budget.used++;
        const res = await fetch(url, {
          headers: { 'X-API-Key': env.TWITTER_API_KEY, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (res.status === 429) {
          if (retries < MAX_RETRIES) { retries++; await new Promise(r => setTimeout(r, 3000)); continue; }
          break;
        }
        if (!res.ok) {
          if (retries < MAX_RETRIES) { retries++; await new Promise(r => setTimeout(r, 1000)); continue; }
          break;
        }
        data = await res.json();
        break;
      } catch (e) {
        if (retries >= MAX_RETRIES) break;
        retries++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!data) break;
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
    await new Promise(r => setTimeout(r, 50));
  }

  // 4. Cache result in KV
  if (env.TWEET_CACHE && allTweets.length > 0) {
    try {
      budget.used++;
      await env.TWEET_CACHE.put(key, JSON.stringify(allTweets), { expirationTtl: TWEET_CACHE_HOURS * 3600 });
    } catch { /* non-critical */ }
  }

  return allTweets;
}

/**
 * Save a completed scan to the scans table and deduct credits.
 * Order: save scan first (so results aren't lost), then deduct credits.
 */
async function saveScanToDb(env, ctx, userId, { accounts, days, model, promptHash, creditsNeeded, signals, totalTweets, label, accountData }) {
  const rangeLabel = days <= 1 ? 'Today' : days <= 7 ? 'Week' : 'Month';

  // Build tweet meta — prefer original tweet text from accountData over analysis summary
  const tweetMeta = {};
  const tweetLookup = {};
  if (accountData) {
    for (const a of accountData) {
      for (const tw of (a.tweets || [])) {
        const tweetId = tw.id || '';
        const author = tw.author?.userName || a.account || '';
        const url = tweetId ? `https://x.com/${author}/status/${tweetId}` : '';
        if (url) tweetLookup[url] = { text: (tw.text || '').slice(0, 500), author, time: tw.createdAt || '' };
      }
    }
  }
  signals.forEach(s => {
    if (s.tweet_url) {
      const orig = tweetLookup[s.tweet_url];
      tweetMeta[s.tweet_url] = {
        text: (orig?.text || s.summary || '').slice(0, 500),
        author: orig?.author || s.source || '',
        time: orig?.time || s.tweet_time || '',
      };
    }
  });

  // Save scan FIRST (so results aren't lost if credit deduction fails)
  const scanData = {
    user_id: userId,
    accounts: accounts,
    range_label: `${rangeLabel} (scheduled: ${label})`,
    range_days: days,
    total_tweets: totalTweets,
    signal_count: signals.length,
    signals: signals,
    tweet_meta: tweetMeta,
  };
  await supabaseQuery(env, 'scans', { method: 'POST', body: scanData });

  // Then deduct credits (scan is already saved, user has results either way)
  try {
    const result = await supabaseRpc(env, 'deduct_credits', {
      p_user_id: userId,
      p_amount: creditsNeeded,
      p_description: `Scheduled scan "${label}": ${accounts.length} accounts × ${days}d`,
      p_metadata: { accounts_count: accounts.length, range_days: days, scheduled: true },
    });
    if (result === -1) {
      console.warn(`[saveScanToDb] Credit deduction returned -1 for user ${userId} (scan already saved)`);
    }
  } catch (e) {
    console.error(`[saveScanToDb] Credit deduction failed for user ${userId}: ${e.message} (scan already saved)`);
  }

  // Cache the whole scan result (best-effort)
  try {
    cacheScanResult(env, ctx, accounts, days, promptHash, signals, totalTweets);
  } catch { /* non-critical */ }
}

/**
 * Main cron handler: find and execute all due scheduled scans.
 * Runs everything inline — the scan is optimized to stay under
 * the 1000-subrequest limit per Cloudflare Worker invocation.
 */
async function runDueScheduledScans(env, ctx) {
  try {
    // Reset stale "running" scans (stuck for > 10 min)
    try {
      const staleThreshold = new Date(Date.now() - 10 * 60_000).toISOString();
      const stale = await supabaseQuery(env,
        `scheduled_scans?last_run_status=eq.running&last_run_at=lt.${staleThreshold}&select=id,label`
      );
      if (stale?.length) {
        console.log(`[cron] Resetting ${stale.length} stale running scan(s)`);
        for (const s of stale) {
          await supabaseQuery(env,
            `scheduled_scans?id=eq.${s.id}&last_run_status=eq.running&last_run_at=lt.${staleThreshold}`, {
              method: 'PATCH',
              body: { last_run_status: 'error', last_run_message: 'Scan timed out — will retry at next scheduled time' },
            }
          );
        }
      }
    } catch (e) {
      console.warn('[cron] Failed to reset stale scans:', e.message);
    }

    // Query all enabled schedules
    const schedules = await supabaseQuery(env,
      `scheduled_scans?enabled=eq.true&select=*`
    );
    if (!schedules?.length) return;

    console.log(`[cron] Checking ${schedules.length} enabled schedules`);

    const dueSchedules = schedules.filter(isScheduleDue);
    if (!dueSchedules.length) return;

    console.log(`[cron] Found ${dueSchedules.length} due scheduled scan(s):`,
      dueSchedules.map(s => `${s.label}@${s.time} (tz=${s.timezone}, accounts=${(s.accounts||[]).length})`).join(', '));

    // Dispatch scans — use queue if available, otherwise fall back to inline
    if (env.SCAN_QUEUE) {
      console.log(`[cron] Using queue dispatch for ${dueSchedules.length} scan(s)`);
      for (const schedule of dueSchedules) {
        await dispatchScheduledScanViaQueue(env, ctx, schedule);
      }
    } else {
      // Legacy: execute inline (limited by 1000 subrequest budget)
      for (const schedule of dueSchedules) {
        await executeScheduledScan(env, ctx, schedule);
      }
    }
  } catch (e) {
    console.error('runDueScheduledScans error:', e.message, e.stack);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

// Allowed origins for CORS
// Localhost origins are safe to allow in production — they resolve to the user's
// own machine so an attacker cannot exploit them remotely.
// Hoist allowed origins to module scope (avoids creating a new Set per request)
const ALLOWED_ORIGINS = new Set([
  'https://sentry.is',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:8000',
  'http://localhost:8888',
]);

function getAllowedOrigins() {
  return ALLOWED_ORIGINS;
}

function corsHeaders(env, originOverride) {
  const origin = originOverride || env?._cors_origin || env?.CORS_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Admin-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(body, status, env, originOverride) {
  return new Response(body, { status, headers: corsHeaders(env, originOverride) });
}

function corsJson(data, status, env, originOverride) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env, originOverride) },
  });
}

// ============================================================================
// ANTHROPIC MODEL RESOLUTION
// ============================================================================

function normalizeModelId(model) {
  if (!model) return model;

  // Fix legacy/typoed IDs from older clients: `claude-haiku-3-5-20241022` → `claude-3-5-haiku-20241022`
  // (Also covers similarly swapped Sonnet/Opus v3.5 IDs if they ever appear.)
  const m = String(model).match(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)-(\d{8})$/);
  if (m) return `claude-${m[2]}-${m[3]}-${m[1]}-${m[4]}`;

  return model;
}

function modelTierFromId(modelId) {
  const id = (modelId || '').toLowerCase();
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  return null;
}

function extractModelVersion(id) {
  // Similar to frontend: ignore date-like segments; parse numeric parts.
  const parts = String(id || '')
    .replace(/^claude-/, '')
    .split('-')
    .filter(p => !/^\d{8,}$/.test(p));
  const nums = parts.filter(p => /^\d+$/.test(p));
  if (nums.length >= 2) return parseFloat(nums[0] + '.' + nums[1]);
  if (nums.length === 1) return parseFloat(nums[0]);
  return 0;
}

function pickBestModelForTier(models, tier) {
  const filtered = (models || [])
    .map(m => (typeof m === 'string' ? { id: m } : m))
    .filter(m => m?.id && m.id.startsWith('claude-') && !m.id.includes('embed'))
    .filter(m => !tier || modelTierFromId(m.id) === tier);

  if (!filtered.length) return null;

  // Prefer higher version. If equal, prefer ids with a date suffix (usually more specific).
  filtered.sort((a, b) => {
    const va = extractModelVersion(a.id);
    const vb = extractModelVersion(b.id);
    if (va !== vb) return vb - va;
    const hasDateA = /\d{8}$/.test(a.id) ? 1 : 0;
    const hasDateB = /\d{8}$/.test(b.id) ? 1 : 0;
    if (hasDateA !== hasDateB) return hasDateB - hasDateA;
    return a.id.localeCompare(b.id);
  });

  return filtered[0].id;
}

async function fetchAnthropicModels(env) {
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`Anthropic models list failed: ${msg}`);
  }
  return Array.isArray(data?.data) ? data.data : [];
}

async function getAnthropicModels(env, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && anthropicModelsCache.models && (now - anthropicModelsCache.ts) < ANTHROPIC_MODELS_CACHE_TTL_MS) {
    return anthropicModelsCache.models;
  }
  const models = await fetchAnthropicModels(env);
  anthropicModelsCache = { ts: now, models };
  return models;
}

async function resolveAnthropicModel(env, requestedModel) {
  const normalized = normalizeModelId(requestedModel);
  const desiredTier = modelTierFromId(normalized) || 'sonnet';

  let models = null;
  try {
    models = await getAnthropicModels(env);
  } catch (e) {
    // If model listing fails, fall back to requested (best effort).
    console.warn('Model list fetch failed; using requested model:', e.message);
    return { requested: requestedModel, normalized, resolved: normalized, tier: desiredTier, from_cache: false };
  }

  const ids = models.map(m => m?.id).filter(Boolean);
  if (normalized && ids.includes(normalized)) {
    return { requested: requestedModel, normalized, resolved: normalized, tier: desiredTier, from_cache: true };
  }

  const bestSameTier = pickBestModelForTier(models, desiredTier);
  if (bestSameTier) {
    return { requested: requestedModel, normalized, resolved: bestSameTier, tier: desiredTier, from_cache: true };
  }

  // Don't silently switch tiers — that would desync billing expectations.
  const availableTiers = Array.from(new Set(ids.map(modelTierFromId).filter(Boolean)));
  const err = new Error(`No available ${desiredTier} model for this API key.`);
  err.code = 'MODEL_TIER_UNAVAILABLE';
  err.meta = { desiredTier, availableTiers };
  throw err;
}

// ============================================================================
// AUTH — Verify Supabase JWT
// ============================================================================

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  try {
    // Verify token with Supabase Auth API
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': env.SUPABASE_ANON_KEY,
      },
      signal: AbortSignal.timeout(10_000),
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

/**
 * Safely parse request JSON body. Returns parsed object or throws a clean 400 error.
 */
async function safeJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('Invalid JSON in request body'), { status: 400 });
  }
}

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
    signal: AbortSignal.timeout(15_000), // 15s timeout for DB calls
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Supabase ${method} ${path} error:`, res.status, errText);
    // Propagate status code and error details so callers can handle specific cases (e.g. 409 duplicate)
    const err = new Error(`Database error: ${res.status}`);
    err.status = res.status;
    err.detail = errText;
    throw err;
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase RPC ${fn} error:`, res.status, err);
    throw new Error('Database operation failed');
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ============================================================================
// TWEET FETCHING (proxied through server)
// — Request coalescing: concurrent identical requests share one Twitter call
// — Stale-while-revalidate: return stale cache instantly, refresh in background
// ============================================================================

// Tweet cache uses 8-hour buckets for better hit rates across users.
// Stale-while-revalidate: return the previous bucket instantly + refresh in bg.
const TWEET_CACHE_HOURS = 8;
const TWEET_CACHE_BUCKET_MS = TWEET_CACHE_HOURS * 3600000;

function tweetCacheKey(account, days) {
  const bucket = Math.floor(Date.now() / TWEET_CACHE_BUCKET_MS);
  return `tweets:${account.toLowerCase()}:${days}:${bucket}`;
}

function tweetCacheKeyStale(account, days) {
  const bucket = Math.floor(Date.now() / TWEET_CACHE_BUCKET_MS);
  return `tweets:${account.toLowerCase()}:${days}:${bucket - 1}`;
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
            await env.TWEET_CACHE.put(key, JSON.stringify(fresh), { expirationTtl: TWEET_CACHE_HOURS * 3600 });
          }
        } catch (e) { console.warn('Background refresh failed:', e.message); }
      })());
      return { tweets: stale, cached: true, stale: true };
    }
  }

  // 3. Coalesce concurrent requests for the same key
  if (inflight.has(key)) {
    try {
      const tweets = await inflight.get(key);
      return { tweets, cached: false, coalesced: true };
    } catch (e) {
      // The original fetch failed — the caller that initiated it handles cleanup
      throw e;
    }
  }

  const promise = fetchTwitterTweetsRaw(env, account, days);
  inflight.set(key, promise);

  // Safety: auto-cleanup after 60s to prevent permanent leaks if something goes wrong
  const safetyCleanup = setTimeout(() => inflight.delete(key), 60_000);

  try {
    const tweets = await promise;
    // Cache in KV (TTL: 4 hours — matches bucket size)
    if (env.TWEET_CACHE && tweets.length > 0) {
      ctx.waitUntil(
        env.TWEET_CACHE.put(key, JSON.stringify(tweets), { expirationTtl: TWEET_CACHE_HOURS * 3600 })
      );
    }
    return { tweets, cached: false };
  } finally {
    clearTimeout(safetyCleanup);
    inflight.delete(key);
  }
}

async function handleFetchTweets(request, env, user, ctx) {
  const { account, days } = await safeJsonBody(request);
  if (!env.TWITTER_API_KEY) {
    return corsJson({ error: 'Twitter API key is not configured on the server.' }, 500, env);
  }

  const normalizedAccount = normalizeTwitterAccount(account);
  const daysNum = parseIntegerInRange(days, 'days', 1, 30);

  if (!normalizedAccount || daysNum == null) {
    return corsJson({ error: 'Invalid account or days' }, 400, env);
  }

  // Credits > 0 = managed keys; no credits = BYOK
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({ error: 'No credits remaining. Buy a credit pack or use your own API keys.', code: 'NO_CREDITS' }, 403, env);
  }

  const result = await fetchTweetsCoalesced(normalizedAccount, daysNum, env, ctx);

  // Non-blocking usage log (only for non-cached calls that hit the Twitter API)
  if (!result.cached) {
    ctx.waitUntil(logUsage(env, user.id, 'tweet_fetch', {
      accounts_count: 1,
      tweets_count: result.tweets?.length || 0,
      cost_twitter: 0.0035, // ~$0.0035 per account fetch
    }));
  }

  return corsJson(result, 200, env);
}

// ---------------------------------------------------------------------------
// BATCH TWEET FETCH — fetch multiple accounts in one request
// Reduces round-trips from N sequential fetches to 1 batched request
// ---------------------------------------------------------------------------
async function handleFetchTweetsBatch(request, env, user, ctx) {
  const { accounts, days } = await safeJsonBody(request);
  if (!env.TWITTER_API_KEY) {
    return corsJson({ error: 'Twitter API key is not configured on the server.' }, 500, env);
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return corsJson({ error: 'Missing accounts or days' }, 400, env);
  }
  if (accounts.length > MAX_BATCH_FETCH_ACCOUNTS) {
    return corsJson({
      error: `Maximum ${MAX_BATCH_FETCH_ACCOUNTS} accounts per batch request.`,
      code: 'BATCH_LIMIT_EXCEEDED',
    }, 400, env);
  }

  const normalizedAccounts = normalizeTwitterAccountList(accounts, {
    min: 1,
    max: MAX_BATCH_FETCH_ACCOUNTS,
  });
  const daysNum = parseIntegerInRange(days, 'days', 1, 30);

  if (!normalizedAccounts || daysNum == null) {
    return corsJson({ error: 'Invalid accounts or days' }, 400, env);
  }

  // Credits > 0 = managed keys
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({ error: 'No credits remaining. Buy a credit pack or use your own API keys.', code: 'NO_CREDITS' }, 403, env);
  }

  // Hard cap on accounts per scan
  if (normalizedAccounts.length > MAX_ACCOUNTS_PER_SCAN) {
    return corsJson({ error: `Maximum ${MAX_ACCOUNTS_PER_SCAN} accounts per scan.`, code: 'TOO_MANY_ACCOUNTS' }, 400, env);
  }

  // Fetch all accounts concurrently with coalescing
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < normalizedAccounts.length; i += CONCURRENCY) {
    const chunk = normalizedAccounts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (account) => {
        try {
          const { tweets, cached } = await fetchTweetsCoalesced(account, daysNum, env, ctx);
          return { account, tweets, cached: cached || false, error: null };
        } catch (e) {
          return { account, tweets: [], cached: false, error: e.message };
        }
      })
    );
    results.push(...chunkResults);
  }

  // Non-blocking usage log for the whole batch
  const uncachedCount = results.filter(r => !r.cached).length;
  if (uncachedCount > 0) {
    const totalTweets = results.reduce((sum, r) => sum + (r.tweets?.length || 0), 0);
    ctx.waitUntil(logUsage(env, user.id, 'tweet_fetch_batch', {
      accounts_count: results.length,
      tweets_count: totalTweets,
      cost_twitter: uncachedCount * 0.0035, // ~$0.0035 per uncached account
    }));
  }

  return corsJson({ results }, 200, env);
}

async function fetchTwitterTweetsRaw(env, account, days) {
  if (!env.TWITTER_API_KEY) throw new Error('Twitter API key not configured');
  const FETCH_TIMEOUT = 15_000; // 15s per HTTP request
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
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (res.status === 429) {
          const wait = Math.min(2000 * Math.pow(2, retries), 15000);
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

    if (!data) break; // All retries exhausted without a response
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
  if (!env.ANTHROPIC_API_KEY) {
    return corsJson({ error: 'Anthropic API key is not configured on the server.' }, 500, env);
  }
  // Reject oversized payloads (2MB limit — prevents abuse with huge message arrays)
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2_000_000) {
    return corsJson({ error: 'Request body too large' }, 413, env);
  }

  const body = await safeJsonBody(request);
  const { model, max_tokens, messages, prompt_hash, tweet_urls } = body;
  let resolvedModelInfo;
  try {
    resolvedModelInfo = await resolveAnthropicModel(env, model);
  } catch (e) {
    if (e.code === 'MODEL_TIER_UNAVAILABLE') {
      return corsJson({
        error: e.message,
        code: e.code,
        ...e.meta,
      }, 400, env);
    }
    throw e;
  }
  const resolvedModel = resolvedModelInfo?.resolved || normalizeModelId(model);

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return corsJson({ error: 'Missing or invalid messages' }, 400, env);
  }
  // Cap max_tokens to prevent abuse
  const safeMaxTokens = parseIntegerInRange(max_tokens, 'max_tokens', 256, 32768) ?? 16384;

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
    model: resolvedModel || 'claude-sonnet-4-20250514',
    max_tokens: safeMaxTokens,
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

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('Analysis API returned an invalid response');
      }
      if (data.error) {
        const errType = data.error.type;
        // If the requested model was invalid/deprecated, refresh model list and retry once with the best match.
        if (errType === 'not_found_error' && data.error.message?.toLowerCase?.().includes('model')) {
          try {
            // Force refresh and resolve again.
            await getAnthropicModels(env, { forceRefresh: true });
            const retryInfo = await resolveAnthropicModel(env, model);
            const retryModel = retryInfo?.resolved;
            if (retryModel && retryModel !== resolvedModel) {
              const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': env.ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({ ...anthropicBody, model: retryModel }),
              });
              const retryData = await retryRes.json();
              if (!retryData?.error) {
                // Cache the analysis result
                if (prompt_hash && tweet_urls?.length) {
                  const text = extractText(retryData.content);
                  await cacheAnalysis(env, prompt_hash, tweet_urls, text, retryModel);
                }
                // Track usage
                const inputTokens = retryData.usage?.input_tokens || 0;
                const outputTokens = retryData.usage?.output_tokens || 0;
                await logUsage(env, user.id, 'analyze', {
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  cost_anthropic: estimateAnthropicCost(retryModel, inputTokens, outputTokens),
                });
                return corsJson(retryData, 200, env);
              }
            }
          } catch (e) {
            console.warn('Model retry failed:', e.message);
          }
        }
        // Non-retryable errors
        if (['authentication_error', 'invalid_request_error', 'not_found_error'].includes(errType)) {
          return corsJson({ error: 'Analysis API error' }, res.status, env);
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
        await cacheAnalysis(env, prompt_hash, tweet_urls, text, resolvedModel);
      }

      // Track usage
      const inputTokens = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;
      await logUsage(env, user.id, 'analyze', {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_anthropic: estimateAnthropicCost(resolvedModel, inputTokens, outputTokens),
      });

      // Deduct credits for the analysis call (1 credit per call)
      try {
        await supabaseRpc(env, 'deduct_credits', {
          p_user_id: user.id,
          p_amount: 1,
          p_description: 'Analysis call',
          p_metadata: { model: resolvedModel, input_tokens: inputTokens, output_tokens: outputTokens },
        });
      } catch (e) {
        console.error(`[BILLING] Failed to deduct credit for analysis (user ${user.id}):`, e.message);
      }

      return corsJson(data, 200, env);

    } catch (e) {
      lastError = e;
      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
      }
    }
  }

  console.error('Analysis exhausted retries:', lastError?.message);
  return corsJson({ error: 'Analysis failed — please try again' }, 502, env);
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

// Escape a string for use inside PostgREST in.() filter — prevents injection
function escapeForPostgrestIn(s) {
  // PostgREST expects quoted strings in in.("val1","val2")
  // We need to escape backslashes and double-quotes within the value
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function checkAnalysisCache(env, promptHash, tweetUrls) {
  try {
    // Batch URLs to prevent excessively long query strings
    const BATCH = 100;
    const allSignals = [];
    let totalFound = 0;
    for (let i = 0; i < tweetUrls.length; i += BATCH) {
      const batch = tweetUrls.slice(i, i + BATCH);
      const urlList = batch.map(escapeForPostgrestIn).join(',');
      const rows = await supabaseQuery(env,
        `analysis_cache?prompt_hash=eq.${encodeURIComponent(promptHash)}&tweet_url=in.(${urlList})&select=tweet_url,signals`
      );
      if (rows?.length) {
        totalFound += rows.length;
        rows.forEach(r => { if (r.signals) allSignals.push(...r.signals); });
      }
    }
    if (totalFound < tweetUrls.length) return null;
    return allSignals;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PER-TWEET ANALYSIS CACHE CHECK — returns partial results
// Allows clients to skip re-analyzing tweets that were already analyzed
// by ANY user with the same prompt. Returns cached signals + list of missing URLs.
// ---------------------------------------------------------------------------
async function handleCheckAnalysisCache(request, env, user) {
  const { prompt_hash, tweet_urls } = await safeJsonBody(request);
  if (typeof prompt_hash !== 'string' || !Array.isArray(tweet_urls) || tweet_urls.length === 0) {
    return corsJson({ cached: {}, missing: tweet_urls || [] }, 200, env);
  }

  // Cap batch size to prevent abuse
  const urls = tweet_urls
    .filter((u) => typeof u === 'string' && u.length <= 2048)
    .slice(0, 500);
  if (!urls.length) return corsJson({ cached: {}, missing: [] }, 200, env);

  try {
    // Batch to prevent URL length issues; escape for PostgREST
    const BATCH = 100;
    let rows = [];
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const urlList = batch.map(escapeForPostgrestIn).join(',');
      const batchRows = await supabaseQuery(env,
        `analysis_cache?prompt_hash=eq.${encodeURIComponent(prompt_hash)}&tweet_url=in.(${urlList})&select=tweet_url,signals`
      );
      if (batchRows?.length) rows = rows.concat(batchRows);
    }

    const cached = {};
    const foundUrls = new Set();
    if (rows?.length) {
      rows.forEach(r => {
        cached[r.tweet_url] = r.signals || [];
        foundUrls.add(r.tweet_url);
      });
    }

    const missing = urls.filter(u => !foundUrls.has(u));

    return corsJson({ cached, missing }, 200, env);
  } catch (e) {
    console.warn('Analysis cache check failed:', e.message);
    return corsJson({ cached: {}, missing: urls }, 200, env);
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

  // Check free tier weekly scan count
  const canFreeScanThisWeek = profile.credits_balance <= 0
    ? await supabaseRpc(env, 'check_free_scan_this_week', { p_user_id: user.id })
    : true;

  return corsJson({
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatar_url: profile.avatar_url,
    credits_balance: profile.credits_balance,
    has_credits: profile.credits_balance > 0,
    free_scan_available: canFreeScanThisWeek,
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
  const body = await safeJsonBody(request);
  const allowed = [
    'theme',
    'font',
    'font_size',
    'text_case',
    'finance_provider',
    'model',
    'live_enabled',
    'scheduled_last_viewed_scan_key',
  ];

  // Validate field types and values
  const VALID_THEMES = ['light', 'dark', 'auto'];
  const VALID_TEXT_CASES = ['normal', 'uppercase', 'lowercase', 'lower', 'sentence'];
  const VALID_FONT_SIZES = ['xsmall', 'small', 'medium', 'large', 'xlarge'];
  const validators = {
    theme: v => typeof v === 'string' && VALID_THEMES.includes(v),
    font: v => typeof v === 'string' && v.length <= 100,
    font_size: v => (
      (typeof v === 'number' && v >= 8 && v <= 32)
      || (typeof v === 'string' && VALID_FONT_SIZES.includes(v))
    ),
    text_case: v => typeof v === 'string' && VALID_TEXT_CASES.includes(v),
    finance_provider: v => typeof v === 'string' && v.length <= 50,
    model: v => typeof v === 'string' && v.length <= 100,
    live_enabled: v => typeof v === 'boolean',
    scheduled_last_viewed_scan_key: v => typeof v === 'string' && v.length <= 120,
  };

  const update = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (validators[key] && !validators[key](body[key])) {
        return corsJson({ error: `Invalid value for ${key}` }, 400, env);
      }
      update[key] = body[key];
    }
  }
  if (Object.keys(update).length === 0) {
    return corsJson({ error: 'No valid fields to update' }, 400, env);
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
  const body = await safeJsonBody(request);
  const { id, name, accounts, is_public, sort_order } = body;
  if (!name || !accounts?.length) {
    return corsJson({ error: 'Name and accounts required' }, 400, env);
  }
  if (typeof name !== 'string' || name.length > 100) {
    return corsJson({ error: 'Name must be a string under 100 characters' }, 400, env);
  }
  const normalizedAccounts = normalizeTwitterAccountList(accounts, { min: 1, max: 200 });
  if (!normalizedAccounts) {
    return corsJson({ error: 'Invalid account name(s) — use Twitter usernames only' }, 400, env);
  }
  const safeSortOrder = parseIntegerInRange(sort_order ?? 0, 'sort_order', -9999, 9999) ?? 0;
  const cleanName = name.replace(/[\x00-\x1f]/g, '').trim();
  if (!cleanName) return corsJson({ error: 'Name cannot be empty' }, 400, env);

  const data = {
    user_id: user.id,
    name: cleanName,
    accounts: normalizedAccounts,
    is_public: Boolean(is_public),
    sort_order: safeSortOrder,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    if (!isUuid(id)) return corsJson({ error: 'Invalid preset id' }, 400, env);
    const encodedId = encodeURIComponent(id);
    // Update existing
    await supabaseQuery(env, `presets?id=eq.${encodedId}&user_id=eq.${user.id}`, {
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
  const { id } = await safeJsonBody(request);
  if (!id || !isUuid(id)) return corsJson({ error: 'Invalid id' }, 400, env);
  await supabaseQuery(env, `presets?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, { method: 'DELETE' });
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
  const body = await safeJsonBody(request);
  const { id, name, prompt, is_active } = body;
  if (!name || typeof name !== 'string') return corsJson({ error: 'Name required' }, 400, env);
  if (name.length > 100) return corsJson({ error: 'Name must be under 100 characters' }, 400, env);
  if (id && !isSafeAnalystId(id)) return corsJson({ error: 'Invalid analyst id' }, 400, env);
  if (prompt && typeof prompt === 'string' && prompt.length > 50_000) {
    return corsJson({ error: 'Prompt must be under 50,000 characters' }, 400, env);
  }

  const cleanName = name.replace(/[\x00-\x1f]/g, '').trim();
  if (!cleanName) return corsJson({ error: 'Name required' }, 400, env);

  const data = {
    id: id || 'a_' + crypto.randomUUID(),
    user_id: user.id,
    name: cleanName,
    prompt: prompt ? prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') : '',
    is_active: is_active === true,
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
      `analysts?user_id=eq.${user.id}&id=neq.${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        body: { is_active: false },
      }
    );
  }

  return corsJson({ ok: true, id: data.id }, 200, env);
}

async function handleDeleteAnalyst(request, env, user) {
  const { id } = await safeJsonBody(request);
  if (!id || id === 'default' || !isSafeAnalystId(id)) return corsJson({ error: 'Cannot delete this analyst' }, 400, env);
  await supabaseQuery(env, `analysts?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ============================================================================
// SCHEDULED SCANS
// ============================================================================

async function handleGetSchedules(env, user) {
  try {
    const rows = await supabaseQuery(env,
      `scheduled_scans?user_id=eq.${user.id}&select=*&order=time.asc`
    );
    return corsJson(rows || [], 200, env);
  } catch (e) {
    console.error('handleGetSchedules error:', e.message);
    return corsJson([], 200, env); // graceful degradation — return empty, don't break UI
  }
}

async function handleSaveSchedule(request, env, user) {
  const body = await safeJsonBody(request);
  const { id, label, time, timezone, days, range_days, preset_id, accounts, preset_names, enabled } = body;

  if (!time || !label) {
    return corsJson({ error: 'Time and label required' }, 400, env);
  }

  // Validate time format and range
  const timeMatch = (time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return corsJson({ error: 'Time must be HH:MM' }, 400, env);
  const h = parseInt(timeMatch[1], 10), m = parseInt(timeMatch[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return corsJson({ error: 'Invalid time value' }, 400, env);
  const normalizedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Validate timezone — only accept valid IANA timezones
  let validTz = 'UTC';
  if (timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone }); // throws if invalid
      validTz = timezone;
    } catch {
      // Invalid timezone — default to UTC silently
    }
  }

  // Validate and sanitize days array (0-6 only, deduplicated)
  const validDays = Array.isArray(days)
    ? [...new Set(days
      .map((d) => parseIntegerInRange(d, 'days[]', 0, 6))
      .filter((d) => d !== null))].sort()
    : [];
  // 7 selected days = every day = empty array
  const normalizedDays = validDays.length === 7 ? [] : validDays;

  // Validate range_days
  const parsedRangeDays = parseIntegerInRange(range_days, 'range_days', 1, 30);
  const validRangeDays = [1, 7, 30].includes(parsedRangeDays) ? parsedRangeDays : 1;

  // Sanitize accounts (lowercase, trimmed, deduped, valid Twitter usernames only)
  const hasProvidedAccounts = Array.isArray(accounts) && accounts.length > 0;
  const normalizedAccounts = normalizeTwitterAccountList(accounts || [], {
    min: 0,
    max: MAX_ACCOUNTS_PER_SCAN,
  });
  if (hasProvidedAccounts && !normalizedAccounts) {
    return corsJson({ error: 'Invalid account list' }, 400, env);
  }
  const validAccounts = normalizedAccounts || [];

  // Sanitize label
  const validLabel = String(label || 'Scan').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
  if (!validLabel) return corsJson({ error: 'Label cannot be empty' }, 400, env);

  // Sanitize preset_names (array of short strings, max 20)
  const validPresetNames = Array.isArray(preset_names)
    ? [...new Set(preset_names.map(n => String(n).trim().toLowerCase().replace(/[\x00-\x1f]/g, '')).filter(n => n.length > 0 && n.length <= 50))].slice(0, 20)
    : [];

  const data = {
    user_id: user.id,
    label: validLabel,
    time: normalizedTime,
    timezone: validTz,
    days: normalizedDays,
    range_days: validRangeDays,
    preset_id: preset_id || null,
    accounts: validAccounts,
    preset_names: validPresetNames,
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    if (!isUuid(id)) return corsJson({ error: 'Invalid schedule id' }, 400, env);
    const encodedId = encodeURIComponent(id);
    // Update existing — ensure user owns it
    const existing = await supabaseQuery(env,
      `scheduled_scans?id=eq.${encodedId}&user_id=eq.${user.id}&select=id`
    );
    if (!existing?.length) return corsJson({ error: 'Schedule not found' }, 404, env);

    await supabaseQuery(env, `scheduled_scans?id=eq.${encodedId}&user_id=eq.${user.id}`, {
      method: 'PATCH',
      body: data,
    });
    return corsJson({ ok: true, id }, 200, env);
  } else {
    // Limit max schedules per user
    const count = await supabaseQuery(env,
      `scheduled_scans?user_id=eq.${user.id}&select=id`
    );
    if (count?.length >= 20) return corsJson({ error: 'Maximum 20 schedules allowed' }, 400, env);

    const rows = await supabaseQuery(env, 'scheduled_scans', {
      method: 'POST',
      body: data,
    });
    return corsJson({ ok: true, id: rows?.[0]?.id }, 200, env);
  }
}

async function handleDeleteSchedule(request, env, user) {
  const { id } = await safeJsonBody(request);
  if (!id || !isUuid(id)) return corsJson({ error: 'Invalid id' }, 400, env);
  await supabaseQuery(env, `scheduled_scans?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ============================================================================
// SCAN HISTORY
// ============================================================================

async function handleGetScans(env, user) {
  const rows = await supabaseQuery(env,
    `scans?user_id=eq.${user.id}&select=id,accounts,range_label,range_days,total_tweets,signal_count,signals,tweet_meta,created_at&order=created_at.desc&limit=20`
  );
  return corsJson(rows || [], 200, env);
}

async function handleSaveScan(request, env, user, ctx) {
  const body = await safeJsonBody(request);
  const { accounts, range_label, range_days, total_tweets, signal_count, signals, tweet_meta, prompt_hash, byok, reservation_id, model } = body;

  // Validate inputs
  if (signals && (!Array.isArray(signals) || signals.length > 5000)) {
    return corsJson({ error: 'Invalid signals data' }, 400, env);
  }
  if (accounts && (!Array.isArray(accounts) || accounts.length > 200)) {
    return corsJson({ error: 'Invalid accounts data' }, 400, env);
  }
  const safeAccounts = normalizeTwitterAccountList(accounts || [], { min: 0, max: 200 });
  if (safeAccounts == null) {
    return corsJson({ error: 'Invalid account name(s)' }, 400, env);
  }

  const accountCount = safeAccounts.length;
  const days = parseIntegerInRange(range_days, 'range_days', 1, 30) || 1;
  const creditsUsed = byok ? 0 : calculateScanCredits(accountCount, days, model);

  // Deduct credits BEFORE saving — prevents free scans via repeated save attempts
  let newBalance = 0;
  if (!byok && creditsUsed > 0) {
    try {
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
        }, 403, env);
      }
      newBalance = result;
    } catch (e) {
      console.error(`[BILLING] Failed to deduct ${creditsUsed} credits for user ${user.id}:`, e.message);
      return corsJson({ error: 'Billing error — please try again' }, 500, env);
    }
  }

  // Save the scan
  const data = {
    user_id: user.id,
    accounts: safeAccounts,
    range_label: typeof range_label === 'string' ? range_label.slice(0, 200) : '',
    range_days: days,
    total_tweets: Math.max(0, parseInt(total_tweets) || 0),
    signal_count: signal_count || signals?.length || 0,
    signals: signals || [],
    tweet_meta: tweet_meta || {},
    credits_used: creditsUsed,
  };

  let rows;
  try {
    rows = await supabaseQuery(env, 'scans', { method: 'POST', body: data });
  } catch (e) {
    console.error('Failed to save scan:', e.message);
    // Scan save failed — refund the credits we just deducted
    if (!byok && creditsUsed > 0) {
      try {
        await supabaseRpc(env, 'add_credits', {
          p_user_id: user.id,
          p_amount: creditsUsed,
          p_type: 'refund',
          p_description: 'Refund: scan save failed',
          p_metadata: { accounts_count: accountCount, range_days: days },
        });
      } catch (refundErr) {
        console.error(`[BILLING CRITICAL] Refund failed for user ${user.id} (${creditsUsed} credits):`, refundErr.message);
      }
    }
    return corsJson({ error: 'Failed to save scan results' }, 500, env);
  }

  // Also save to cross-user whole-scan cache
  if (prompt_hash && signals?.length) {
    cacheScanResult(env, ctx, safeAccounts, days, prompt_hash, signals, total_tweets);

    // Populate per-tweet analysis cache from the scan signals (benefits cross-user cache).
    // This is especially important for BYOK users whose analysis doesn't go through /api/analyze.
    ctx.waitUntil((async () => {
      try {
        const grouped = new Map();
        signals.forEach(s => {
          const url = s.tweet_url;
          if (!url) return;
          if (!grouped.has(url)) grouped.set(url, []);
          grouped.get(url).push(s);
        });
        const rows = [];
        for (const [url, sigs] of grouped) {
          rows.push({
            prompt_hash,
            tweet_url: url,
            signals: sigs,
            model: 'unknown', // BYOK users may use different models
          });
        }
        if (rows.length) {
          await supabaseQuery(env, 'analysis_cache', {
            method: 'POST',
            body: rows,
            headers: { 'Prefer': 'resolution=merge-duplicates' },
          });
        }
      } catch (e) {
        console.warn('Analysis cache backfill failed:', e.message);
      }
    })());
  }

  return corsJson({ ok: true, id: rows?.[0]?.id, credits_used: creditsUsed, credits_balance: newBalance }, 200, env);
}

async function handleDeleteScan(request, env, user) {
  const { id } = await safeJsonBody(request);
  if (!id || !isUuid(id)) return corsJson({ error: 'Invalid id' }, 400, env);
  await supabaseQuery(env, `scans?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, { method: 'DELETE' });
  return corsJson({ ok: true }, 200, env);
}

// ---------------------------------------------------------------------------
// SHARED SCANS (public shareable links)
// ---------------------------------------------------------------------------

function generateShareId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  // Use rejection sampling to eliminate modulo bias (256 % 36 = 4, so 0-3 would be slightly overrepresented)
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // extra bytes for rejection
  let bi = 0;
  while (id.length < 8) {
    if (bi >= bytes.length) break; // fallback (shouldn't happen with 16 bytes for 8 chars)
    const val = bytes[bi++];
    if (val < 252) { // 252 = 36 * 7, largest multiple of 36 ≤ 256
      id += chars[val % chars.length];
    }
  }
  return id;
}

async function handleShareScan(request, env, user) {
  const body = await safeJsonBody(request);
  const { signals, range_label, range_days, accounts_count, total_tweets, signal_count, tweet_meta } = body;

  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return corsJson({ error: 'No signals to share' }, 400, env);
  }
  if (signals.length > 5000) {
    return corsJson({ error: 'Too many signals' }, 400, env);
  }

  const id = generateShareId();

  const data = {
    id,
    user_id: user.id,
    range_label: typeof range_label === 'string' ? range_label.slice(0, 200) : '',
    range_days: Math.max(1, Math.min(parseInt(range_days) || 1, 30)),
    accounts_count: Math.max(0, parseInt(accounts_count) || 0),
    total_tweets: Math.max(0, parseInt(total_tweets) || 0),
    signal_count: signal_count || signals.length,
    signals,
    tweet_meta: tweet_meta || {},
  };

  await supabaseQuery(env, 'shared_scans', { method: 'POST', body: data });

  return corsJson({ id }, 200, env);
}

async function handleGetSharedScan(env, shareId) {
  if (!shareId || shareId.length !== 8 || !/^[a-z0-9]+$/.test(shareId)) {
    return corsJson({ error: 'Invalid share ID' }, 400, env);
  }

  const rows = await supabaseQuery(env,
    `shared_scans?id=eq.${shareId}&select=id,range_label,range_days,accounts_count,total_tweets,signal_count,signals,tweet_meta,created_at&limit=1`
  );

  if (!rows || !rows.length) {
    return corsJson({ error: 'Shared scan not found' }, 404, env);
  }

  return corsJson(rows[0], 200, env);
}

// ---------------------------------------------------------------------------
// WHOLE-SCAN RESULT CACHE
// If another user already scanned the same accounts + days + prompt, return
// their signals instantly (analyst-agnostic hash = same prompt text).
// ---------------------------------------------------------------------------
async function hashScanKey(accounts, days, promptHash) {
  // Use SHA-256 for collision resistance (replaces 32-bit DJB2)
  const sorted = [...accounts].map(a => a.toLowerCase()).sort().join(',');
  const raw = `${sorted}:${days}:${promptHash}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'scan:' + hex.slice(0, 16); // 64-bit prefix — effectively zero collision risk for this use case
}

async function handleCheckScanCache(request, env, user) {
  const { accounts, days, prompt_hash } = await safeJsonBody(request);
  const normalizedAccounts = normalizeTwitterAccountList(accounts || [], {
    min: 1,
    max: MAX_ACCOUNTS_PER_SCAN,
  });
  const safeDays = parseIntegerInRange(days, 'days', 1, 30);
  if (!normalizedAccounts || safeDays == null || typeof prompt_hash !== 'string' || prompt_hash.length > 128) {
    return corsJson({ cached: false }, 200, env);
  }

  const scanKey = await hashScanKey(normalizedAccounts, safeDays, prompt_hash);

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

// ---------------------------------------------------------------------------
// CREDIT RESERVATION — pre-check credits before a scan starts
// Prevents API drain: users can't start scans without enough credits.
// Note: We only do a DB-level balance check here (no in-memory state).
// Actual deduction happens atomically when the scan is saved.
// ---------------------------------------------------------------------------

async function handleReserveCredits(request, env, user) {
  const { accounts_count, range_days, model } = await safeJsonBody(request);
  const accountsCount = parseIntegerInRange(accounts_count, 'accounts_count', 1, MAX_ACCOUNTS_PER_SCAN);
  const rangeDays = parseIntegerInRange(range_days, 'range_days', 1, 30);
  if (accountsCount == null || rangeDays == null) {
    return corsJson({ error: 'Invalid accounts_count or range_days' }, 400, env);
  }
  if (typeof model !== 'undefined' && typeof model !== 'string') {
    return corsJson({ error: 'Invalid model' }, 400, env);
  }

  const creditsNeeded = calculateScanCredits(accountsCount, rangeDays, model);
  const profile = await getProfile(env, user.id);

  if (!profile) {
    return corsJson({ error: 'Profile not found' }, 404, env);
  }

  // Free tier check
  if (profile.credits_balance <= 0) {
    const canFree = await supabaseRpc(env, 'check_free_scan_this_week', { p_user_id: user.id });
    if (!canFree) {
      return corsJson({
        error: 'Weekly free scan used. Buy credits or come back next week.',
        code: 'NO_FREE_SCANS',
      }, 403, env);
    }
    if (accountsCount > FREE_TIER.max_accounts) {
      return corsJson({
        error: `Free tier allows up to ${FREE_TIER.max_accounts} accounts. Buy credits for more.`,
        code: 'FREE_TIER_LIMIT',
      }, 403, env);
    }
    // Free tier — no credit reservation needed
    return corsJson({ ok: true, credits_needed: 0, free_tier: true }, 200, env);
  }

  // Paid user — check they have enough credits
  if (profile.credits_balance < creditsNeeded) {
    return corsJson({
      error: `Not enough credits. Need ${creditsNeeded}, have ${profile.credits_balance}.`,
      code: 'INSUFFICIENT_CREDITS',
      credits_needed: creditsNeeded,
      credits_balance: profile.credits_balance,
    }, 403, env);
  }

  // Balance check passed — return confirmation (actual deduction at scan save time)
  return corsJson({
    ok: true,
    credits_needed: creditsNeeded,
    credits_balance: profile.credits_balance,
  }, 200, env);
}

// Save scan result to cross-user cache (called after successful scan save)
async function cacheScanResult(env, ctx, accounts, days, promptHash, signals, totalTweets) {
  if (!env.TWEET_CACHE || !promptHash) return;
  const scanKey = await hashScanKey(accounts, days, promptHash);
  ctx.waitUntil(
    env.TWEET_CACHE.put(scanKey, JSON.stringify({
      signals,
      total_tweets: totalTweets,
      ts: Date.now(),
    }), { expirationTtl: 86400 }) // 24 hour TTL — signals rarely change that fast
  );
}

// ============================================================================
// BILLING — Stripe
// ============================================================================

async function stripeRequest(env, path, params = {}) {
  if (!env.STRIPE_SECRET_KEY) {
    return { error: { message: 'Stripe is not configured on the server.' } };
  }
  const body = new URLSearchParams(params);
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!data) return { error: { message: `Stripe API returned invalid JSON (${res.status})` } };
    if (!res.ok && !data.error) data.error = { message: `Stripe API error (${res.status})` };
    return data;
  } catch (e) {
    return { error: { message: `Stripe request failed: ${e.message}` } };
  }
}

async function stripeGet(env, path) {
  if (!env.STRIPE_SECRET_KEY) {
    return { error: { message: 'Stripe is not configured on the server.' } };
  }
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!data) return { error: { message: `Stripe API returned invalid JSON (${res.status})` } };
    if (!res.ok && !data.error) data.error = { message: `Stripe API error (${res.status})` };
    return data;
  } catch (e) {
    return { error: { message: `Stripe request failed: ${e.message}` } };
  }
}

async function getOrCreateStripeCustomer(env, user) {
  const profile = await getProfile(env, user.id);
  if (profile.stripe_customer_id) return profile.stripe_customer_id;

  // Create Stripe customer
  const customer = await stripeRequest(env, '/customers', {
    email: user.email,
    'metadata[user_id]': user.id,
  });
  if (customer.error || !customer.id) {
    throw Object.assign(new Error(customer.error?.message || 'Failed to create Stripe customer'), { status: 502 });
  }

  // Save to profile
  await supabaseQuery(env, `profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    body: { stripe_customer_id: customer.id },
  });

  return customer.id;
}

// Validate redirect URL belongs to our domain — prevents open redirect attacks
function isAllowedRedirectUrl(url, env) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'sentry.is' || parsed.hostname.endsWith('.sentry.is')) {
      return parsed.protocol === 'https:';
    }
    const isProd = (env.ENVIRONMENT || '').toLowerCase() === 'production';
    if (!isProd && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }
    return false;
  } catch {
    return false;
  }
}

async function handleCheckout(request, env, user) {
  const { pack_id, recurring, success_url, cancel_url } = await safeJsonBody(request);
  const isRecurring = recurring === true;

  const pack = CREDIT_PACKS[pack_id];
  if (!pack) {
    return corsJson({ error: 'Invalid credit pack' }, 400, env);
  }

  const customerId = await getOrCreateStripeCustomer(env, user);
  const priceId = getStripePriceId(env, pack_id, isRecurring);

  if (!priceId) {
    return corsJson({ error: 'Price not configured for this pack' }, 500, env);
  }

  const mode = isRecurring ? 'subscription' : 'payment';

  // Sanitize redirect URLs — only allow our own domain
  const safeSuccessUrl = isAllowedRedirectUrl(success_url, env) ? success_url : 'https://sentry.is/?billing=success';
  const safeCancelUrl = isAllowedRedirectUrl(cancel_url, env) ? cancel_url : 'https://sentry.is/?billing=cancel';

  const params = {
    'customer': customerId,
    'mode': mode,
    'payment_method_types[0]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': safeSuccessUrl + (safeSuccessUrl.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}',
    'cancel_url': safeCancelUrl,
    'allow_promotion_codes': 'true',
    'metadata[pack_id]': pack.id,
    'metadata[credits]': pack.credits.toString(),
    'metadata[user_id]': user.id,
  };

  // For subscriptions, also add metadata to the subscription itself
  if (isRecurring) {
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
  const { return_url } = await safeJsonBody(request);

  // Sanitize return URL — only allow our own domain
  const safeReturnUrl = isAllowedRedirectUrl(return_url, env) ? return_url : 'https://sentry.is/v3/';

  const session = await stripeRequest(env, '/billing_portal/sessions', {
    'customer': customerId,
    'return_url': safeReturnUrl,
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
    const session = await stripeGet(env, `/checkout/sessions/${encodeURIComponent(session_id)}`);
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

    // Add credits — but only if the webhook hasn't already processed this session.
    // Use billing_events table (UNIQUE on stripe_event_id) as a lock to prevent
    // double-crediting between webhook and verify endpoint.
    if (credits > 0) {
      try {
        // Attempt to insert a billing_events row for this session (acts as a lock).
        // If the webhook already processed it, this will 409 and we skip credit grant.
        await supabaseQuery(env, 'billing_events', {
          method: 'POST',
          body: { stripe_event_id: `verify:${session.id}`, type: 'checkout.session.verified', data: { session_id: session.id } },
        });

        // If we got here, the event was not yet processed — add credits
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
        // 409 = already processed (by webhook or previous verify call) — safe to skip
        if (e.status !== 409) {
          console.warn('add_credits/dedup check failed:', e.message);
        }
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
    console.error('Billing verify error:', e.message);
    return corsJson({ error: 'Verification failed' }, 500, env);
  }
}

async function handleStripeWebhook(request, env) {
  ensureBaseEnv(env);
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return corsJson({ error: 'Stripe webhook is not configured on the server.' }, 500, env);
  }
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();

  // Verify webhook signature
  if (!await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return corsJson({ error: 'Invalid signature' }, 400, env);
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return corsJson({ error: 'Invalid webhook payload' }, 400, env);
  }

  // Log the event — billing_events has a UNIQUE constraint on stripe_event_id,
  // so a duplicate insert returns 409. If we've already processed this event,
  // return immediately to prevent double-crediting.
  try {
    await supabaseQuery(env, 'billing_events', {
      method: 'POST',
      body: { stripe_event_id: event.id, type: event.type, data: event.data },
    });
  } catch (e) {
    // 409 = unique constraint violation → duplicate event, already processed
    if (e.status === 409) {
      return corsJson({ received: true }, 200, env);
    }
    console.warn('Webhook log failed:', e.message);
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
        try {
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
        } catch (e) {
          // Credit fulfillment failed — this is critical. Log prominently.
          // The billing_events row already exists, so retries of this webhook will
          // be caught as duplicates. We return 500 so Stripe retries the event.
          console.error(`[BILLING CRITICAL] Failed to add ${credits} credits for user ${userId} (session ${obj.id}):`, e.message);
          return corsJson({ error: 'Credit fulfillment failed, please retry' }, 500, env);
        }
      }

      // If subscription, save the subscription ID
      if (obj.mode === 'subscription' && obj.subscription) {
        try {
          await supabaseQuery(env, `profiles?stripe_customer_id=eq.${customerId}`, {
            method: 'PATCH',
            body: {
              stripe_subscription_id: obj.subscription,
              subscription_status: 'active',
            },
          });
        } catch (e) {
          console.error(`[BILLING] Failed to save subscription ID for customer ${customerId}:`, e.message);
        }
      }
      break;
    }

    // Recurring subscription renewal (invoice paid)
    case 'invoice.paid': {
      // Only process recurring renewals, not the first payment (handled by checkout.session.completed)
      if (obj.billing_reason === 'subscription_cycle') {
        const subscriptionId = obj.subscription;
        if (subscriptionId) {
          try {
            const sub = await stripeGet(env, `/subscriptions/${subscriptionId}`);
            const metadata = sub?.metadata || {};
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
          } catch (e) {
            console.error(`[BILLING CRITICAL] Failed to fulfill invoice.paid renewal (invoice ${obj.id}):`, e.message);
            return corsJson({ error: 'Renewal fulfillment failed, please retry' }, 500, env);
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

    // Check timestamp is within 5 minutes (reject both stale and future-dated)
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (Math.abs(age) > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    // Use crypto.subtle.verify for constant-time comparison (prevents timing attacks)
    const sigBytes = new Uint8Array(signature.match(/.{2}/g).map(b => parseInt(b, 16)));
    return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signedPayload));
  } catch {
    return false;
  }
}

// ============================================================================
// ADMIN MONITORING
// ============================================================================

async function handleAdminMonitoring(request, env) {
  // Admin endpoint allows any origin (protected by secret, not CORS)
  const anyOrigin = '*';

  // Rate limit: 10 requests per minute per IP (before auth check to prevent brute-force)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = await checkRateLimit(env, `admin:${ip}`, 10, 60);
  if (!rl.ok) {
    return corsJson({ error: 'Too many requests' }, 429, env, anyOrigin);
  }

  const secret = request.headers.get('x-admin-secret');
  if (!env.ADMIN_SECRET || !secret || secret !== env.ADMIN_SECRET) {
    return corsJson({ error: 'Unauthorized. Pass x-admin-secret header.' }, 401, env, anyOrigin);
  }

  try {
    // Fetch all data in parallel (service key bypasses RLS)
    // Each query is wrapped so a single table failure doesn't break everything
    const safeQuery = async (path) => {
      try { return await supabaseQuery(env, path); }
      catch (e) { console.warn('Monitoring query failed:', path.split('?')[0], e.message); return []; }
    };
    const [profiles, scans, usageLogs, creditTxs, modelSettings] = await Promise.all([
      safeQuery('profiles?select=id,email,name,credits_balance,stripe_customer_id,subscription_status,created_at&order=created_at.desc&limit=5000'),
      safeQuery('scans?select=id,user_id,accounts,range_label,range_days,total_tweets,signal_count,credits_used,created_at&order=created_at.desc&limit=2000'),
      safeQuery('usage_log?select=id,user_id,action,accounts_count,tweets_count,signals_count,input_tokens,output_tokens,cost_twitter,cost_anthropic,cost_total,created_at&order=created_at.desc&limit=5000'),
      safeQuery('credit_transactions?select=id,user_id,type,amount,balance_after,description,metadata,created_at&order=created_at.desc&limit=2000'),
      safeQuery('user_settings?select=user_id,model'),
    ]);

    // Time boundaries
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const isToday = (d) => new Date(d) >= todayStart;
    const isThisWeek = (d) => new Date(d) >= weekAgo;
    const isThisMonth = (d) => new Date(d) >= monthAgo;

    // Build email lookup
    const emailMap = {};
    (profiles || []).forEach(p => { emailMap[p.id] = p.email; });

    // --- USERS ---
    const allProfiles = profiles || [];
    const users = {
      total: allProfiles.length,
      today: allProfiles.filter(p => isToday(p.created_at)).length,
      this_week: allProfiles.filter(p => isThisWeek(p.created_at)).length,
      this_month: allProfiles.filter(p => isThisMonth(p.created_at)).length,
      paying: allProfiles.filter(p => p.credits_balance > 0 || p.stripe_customer_id).length,
      total_credits_outstanding: allProfiles.reduce((s, p) => s + (p.credits_balance || 0), 0),
      recent: allProfiles.slice(0, 30).map(p => ({
        email: p.email,
        name: p.name,
        credits: p.credits_balance,
        subscription: p.subscription_status,
        has_stripe: !!p.stripe_customer_id,
        created_at: p.created_at,
      })),
    };

    // --- SCANS ---
    const allScans = scans || [];
    const accountCounts = {};
    allScans.forEach(s => {
      (s.accounts || []).forEach(a => {
        const key = a.toLowerCase();
        accountCounts[key] = (accountCounts[key] || 0) + 1;
      });
    });
    const topAccounts = Object.entries(accountCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([account, count]) => ({ account, count }));

    const scansData = {
      total: allScans.length,
      today: allScans.filter(s => isToday(s.created_at)).length,
      this_week: allScans.filter(s => isThisWeek(s.created_at)).length,
      this_month: allScans.filter(s => isThisMonth(s.created_at)).length,
      total_tweets: allScans.reduce((s, sc) => s + (sc.total_tweets || 0), 0),
      total_signals: allScans.reduce((s, sc) => s + (sc.signal_count || 0), 0),
      total_credits_used: allScans.reduce((s, sc) => s + (sc.credits_used || 0), 0),
      unique_accounts: Object.keys(accountCounts).length,
      top_accounts: topAccounts,
      recent: allScans.slice(0, 30).map(s => ({
        user_email: emailMap[s.user_id] || s.user_id,
        accounts_count: s.accounts?.length || 0,
        accounts_list: (s.accounts || []).slice(0, 5),
        range: s.range_label,
        range_days: s.range_days,
        tweets: s.total_tweets,
        signals: s.signal_count,
        credits: s.credits_used,
        created_at: s.created_at,
      })),
    };

    // --- COSTS ---
    const allUsage = usageLogs || [];
    const sumCosts = (items) => ({
      twitter: items.reduce((s, u) => s + parseFloat(u.cost_twitter || 0), 0),
      anthropic: items.reduce((s, u) => s + parseFloat(u.cost_anthropic || 0), 0),
      total: items.reduce((s, u) => s + parseFloat(u.cost_total || 0), 0),
      input_tokens: items.reduce((s, u) => s + (u.input_tokens || 0), 0),
      output_tokens: items.reduce((s, u) => s + (u.output_tokens || 0), 0),
      api_calls: items.length,
    });

    const costs = {
      all_time: sumCosts(allUsage),
      today: sumCosts(allUsage.filter(u => isToday(u.created_at))),
      this_week: sumCosts(allUsage.filter(u => isThisWeek(u.created_at))),
      this_month: sumCosts(allUsage.filter(u => isThisMonth(u.created_at))),
    };

    // --- USAGE BY ACTION ---
    const actionBreakdown = {};
    allUsage.forEach(u => {
      if (!actionBreakdown[u.action]) actionBreakdown[u.action] = { count: 0, twitter: 0, anthropic: 0, total: 0, input_tokens: 0, output_tokens: 0 };
      const ab = actionBreakdown[u.action];
      ab.count++;
      ab.twitter += parseFloat(u.cost_twitter || 0);
      ab.anthropic += parseFloat(u.cost_anthropic || 0);
      ab.total += parseFloat(u.cost_total || 0);
      ab.input_tokens += u.input_tokens || 0;
      ab.output_tokens += u.output_tokens || 0;
    });

    // --- REVENUE ---
    const allTx = creditTxs || [];
    const purchases = allTx.filter(t => t.type === 'purchase' || t.type === 'recurring');
    const revenue = {
      total_purchases: purchases.length,
      today: purchases.filter(t => isToday(t.created_at)).length,
      this_week: purchases.filter(t => isThisWeek(t.created_at)).length,
      this_month: purchases.filter(t => isThisMonth(t.created_at)).length,
      total_credits_sold: purchases.reduce((s, t) => s + Math.abs(t.amount || 0), 0),
      recent: purchases.slice(0, 30).map(t => ({
        user_email: emailMap[t.user_id] || t.user_id,
        type: t.type,
        credits: t.amount,
        description: t.description,
        created_at: t.created_at,
      })),
    };

    // --- MODELS ---
    const modelDist = {};
    (modelSettings || []).forEach(s => {
      const m = s.model || 'unknown';
      modelDist[m] = (modelDist[m] || 0) + 1;
    });

    // --- RECENT USAGE LOG ---
    const recentUsage = allUsage.slice(0, 50).map(u => ({
      user_email: emailMap[u.user_id] || u.user_id,
      action: u.action,
      accounts: u.accounts_count,
      tweets: u.tweets_count,
      signals: u.signals_count,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cost_twitter: parseFloat(u.cost_twitter || 0),
      cost_anthropic: parseFloat(u.cost_anthropic || 0),
      cost_total: parseFloat(u.cost_total || 0),
      created_at: u.created_at,
    }));

    // --- DAILY BREAKDOWN (last 30 days) ---
    const dailyMap = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { date: key, users: 0, scans: 0, cost_twitter: 0, cost_anthropic: 0, cost_total: 0, credits_sold: 0 };
    }
    allProfiles.forEach(p => {
      const key = new Date(p.created_at).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key].users++;
    });
    allScans.forEach(s => {
      const key = new Date(s.created_at).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key].scans++;
    });
    allUsage.forEach(u => {
      const key = new Date(u.created_at).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].cost_twitter += parseFloat(u.cost_twitter || 0);
        dailyMap[key].cost_anthropic += parseFloat(u.cost_anthropic || 0);
        dailyMap[key].cost_total += parseFloat(u.cost_total || 0);
      }
    });
    purchases.forEach(t => {
      const key = new Date(t.created_at).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key].credits_sold += Math.abs(t.amount || 0);
    });
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return corsJson({
      generated_at: now.toISOString(),
      users,
      scans: scansData,
      revenue,
      costs,
      action_breakdown: actionBreakdown,
      models: modelDist,
      recent_usage: recentUsage,
      daily,
    }, 200, env, anyOrigin);

  } catch (e) {
    console.error('Admin monitoring error:', e.message, e.stack);
    return corsJson({ error: 'Failed to fetch monitoring data' }, 500, env, anyOrigin);
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
    targetUrl = new URL(target); // Don't double-decode — URL constructor handles encoding
  } catch {
    return corsJson({ error: 'Invalid URL' }, 400, env);
  }

  // Enforce HTTPS only
  if (targetUrl.protocol !== 'https:') {
    return corsJson({ error: 'Only HTTPS URLs allowed' }, 403, env);
  }

  // Strict hostname allowlist — exact match only (prevents subdomain bypass like evil.query1.finance.yahoo.com)
  const ALLOWED_HOSTS = new Set(['query1.finance.yahoo.com', 'api.coingecko.com']);
  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return corsJson({ error: 'Host not allowed' }, 403, env);
  }

  // Strip credentials/fragments
  targetUrl.username = '';
  targetUrl.password = '';
  targetUrl.hash = '';

  try {
    const cacheUrl = new URL(request.url);
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheUrl);
    if (cachedResponse) return cachedResponse;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout
    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SentryApp/1.0)' },
    });
    clearTimeout(timeout);

    // Limit response size to 1MB
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > 1_000_000) {
      return corsJson({ error: 'Response too large' }, 502, env);
    }

    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(env)).forEach(([k, v]) => headers.set(k, v));

    if (response.ok) {
      headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
      const proxied = new Response(response.body, { status: response.status, headers });
      ctx.waitUntil(cache.put(cacheUrl, proxied.clone()));
      return proxied;
    }
    // Don't cache error responses (429, 5xx, etc.)
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  } catch (e) {
    return corsJson({ error: 'Upstream request failed' }, 502, env); // Don't leak internal error details
  }
}
