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
  max_accounts: 10,
  scans_per_day: 1,
};

const MAX_ACCOUNTS_PER_SCAN = 1000; // hard server-side cap

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

  async fetch(request, env, ctx) {
    // Resolve CORS origin: reflect request origin if it's in our allow-list
    const reqOrigin = request.headers.get('Origin') || '';
    if (ALLOWED_ORIGINS.has(reqOrigin)) {
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
      if (path === '/api/proxy' && method === 'GET') {
        return handleProxy(request, env, ctx);
      }
      if (path === '/api/health') {
        return corsJson({ status: 'ok', version: 'v3' }, 200, env);
      }
      if (path === '/api/admin/monitoring' && method === 'GET') {
        return handleAdminMonitoring(request, env);
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
      console.error('Unhandled error:', e.message, e.stack);
      return corsJson({ error: 'Internal server error' }, 500, env);
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

/**
 * Run a single scheduled scan server-side.
 */
async function executeScheduledScan(env, ctx, schedule) {
  const userId = schedule.user_id;
  const SCAN_TIMEOUT_MS = 8 * 60_000; // 8 minute hard timeout (large account lists need time)

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

  // 1. Resolve accounts — schedule > preset > user's presets
  let accounts = Array.isArray(schedule.accounts) ? [...schedule.accounts] : [];
  let accountSource = 'schedule';

  if (schedule.preset_id && !accounts.length) {
    try {
      const rows = await supabaseQuery(env, `presets?id=eq.${schedule.preset_id}&user_id=eq.${userId}&select=accounts`);
      if (rows?.[0]?.accounts?.length) { accounts = rows[0].accounts; accountSource = 'preset'; }
      else log('Preset not found or empty, trying fallbacks');
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
    await setStatus('error', 'No accounts — add lists/accounts to this schedule');
    return;
  }

  log(`${accounts.length} accounts (from ${accountSource})`);

  // 2. Get analyst prompt
  let prompt = DEFAULT_ANALYST_PROMPT;
  try {
    const analysts = await supabaseQuery(env, `analysts?user_id=eq.${userId}&is_active=eq.true&select=prompt&limit=1`);
    if (analysts?.[0]?.prompt) prompt = analysts[0].prompt;
  } catch { /* use default */ }

  // 3. Get model preference
  let model = 'claude-sonnet-4-20250514';
  try {
    const settings = await supabaseQuery(env, `user_settings?user_id=eq.${userId}&select=model`);
    if (settings?.[0]?.model) model = settings[0].model;
  } catch { /* use default */ }

  // 4. Check credits
  const days = Math.max(1, Math.min(30, schedule.range_days || 1));
  const creditsNeeded = calculateScanCredits(accounts.length, days, model);
  const profile = await getProfile(env, userId);

  if (!profile || profile.credits_balance < creditsNeeded) {
    await setStatus('error', `Insufficient credits (need ${creditsNeeded}, have ${profile?.credits_balance || 0})`);
    return;
  }

  // 5. Check cross-user scan cache
  const promptHash = djb2Hash(`${model}\n${prompt}`);
  const scanKey = hashScanKey(accounts, days, promptHash);
  if (env.TWEET_CACHE) {
    try {
      const cached = await env.TWEET_CACHE.get(scanKey, 'json');
      if (cached?.signals?.length) {
        await saveScanToDb(env, ctx, userId, { accounts, days, model, promptHash, creditsNeeded, signals: cached.signals, totalTweets: cached.total_tweets || 0, label: schedule.label });
        await setStatus('success', `${cached.signals.length} signals (cached)`);
        log('Served from scan cache');
        return;
      }
    } catch (e) { log(`Scan cache check failed: ${e.message}`); }
  }

  // 6. Fetch tweets (concurrency-limited, with error tracking)
  const CONCURRENCY = 10; // higher concurrency — most calls hit KV cache
  const PER_ACCOUNT_TIMEOUT = 30_000; // 30s max per account fetch
  const accountData = [];
  const failedAccounts = [];
  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const chunk = accounts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (account) => {
        const fetchPromise = fetchTweetsCoalesced(account, days, env, ctx);
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Account fetch timed out')), PER_ACCOUNT_TIMEOUT)
        );
        const { tweets } = await Promise.race([fetchPromise, timeout]);
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
  if (failedAccounts.length) log(`Failed to fetch: ${failedAccounts.join(', ')}`);

  if (totalTweets === 0) {
    const detail = failedAccounts.length
      ? `No tweets (${failedAccounts.length}/${accounts.length} accounts failed to fetch)`
      : `No tweets found for ${accounts.length} accounts in the last ${days === 1 ? 'day' : days + ' days'}`;
    await setStatus('error', detail);
    return;
  }

  log(`${totalTweets} tweets from ${accountData.filter(a => a.tweets.length > 0).length}/${accounts.length} accounts`);

  // 7. Check per-tweet analysis cache (with safe URL encoding)
  let cachedSignals = [];
  let uncachedAccountData = accountData;
  try {
    const allTweetUrls = [];
    accountData.forEach(a => {
      a.tweets.forEach(tw => {
        if (!tw.id) return; // skip tweets without an ID
        const author = tw.author?.userName || a.account;
        allTweetUrls.push(`https://x.com/${author}/status/${tw.id}`);
      });
    });

    if (allTweetUrls.length > 0) {
      // Batch in groups of 100 (safe for URL length limits)
      const CACHE_BATCH = 100;
      const cachedUrlSet = new Set();
      for (let i = 0; i < allTweetUrls.length; i += CACHE_BATCH) {
        const batch = allTweetUrls.slice(i, i + CACHE_BATCH);
        // Escape any double-quotes in URLs for PostgREST in() filter
        const urlList = batch.map(u => `"${u.replace(/"/g, '\\"')}"`).join(',');
        const rows = await supabaseQuery(env,
          `analysis_cache?prompt_hash=eq.${encodeURIComponent(promptHash)}&tweet_url=in.(${urlList})&select=tweet_url,signals`
        );
        if (rows?.length) {
          rows.forEach(r => {
            cachedUrlSet.add(r.tweet_url);
            if (r.signals?.length) cachedSignals.push(...r.signals);
          });
        }
      }

      if (cachedUrlSet.size > 0) {
        log(`${cachedUrlSet.size}/${allTweetUrls.length} tweets cached`);
        uncachedAccountData = accountData.map(a => ({
          account: a.account,
          tweets: a.tweets.filter(tw => {
            if (!tw.id) return false;
            const author = tw.author?.userName || a.account;
            return !cachedUrlSet.has(`https://x.com/${author}/status/${tw.id}`);
          }),
        })).filter(a => a.tweets.length > 0);
      }
    }
  } catch (e) {
    log(`Cache check failed (will analyze all): ${e.message}`);
    uncachedAccountData = accountData; // fall back to analyzing everything
  }

  // 8. Call Claude for uncached tweets
  let newSignals = [];
  let batchesFailed = 0;
  let batchesTotal = 0;
  if (uncachedAccountData.length > 0) {
    let resolvedModel = model;
    try {
      const modelInfo = await resolveAnthropicModel(env, model);
      if (modelInfo?.resolved) resolvedModel = modelInfo.resolved;
    } catch { /* use original */ }

    const batches = buildAnalysisBatches(uncachedAccountData, prompt.length || 0);
    batchesTotal = batches.length;

    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }

    for (const batch of batches) {
      try {
        const anthropicBody = {
          model: resolvedModel,
          max_tokens: 16384,
          system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: batch.text }],
        };

        let data = null;
        const MAX_RETRIES = 1;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(anthropicBody),
          });

          // Handle rate limiting with longer backoff
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 15_000)));
              continue;
            }
            throw new Error('Anthropic rate limited');
          }

          data = await res.json();
          if (data.error) {
            if (attempt < MAX_RETRIES && res.status >= 500) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            throw new Error(data.error.message || `Anthropic error (${res.status})`);
          }
          break;
        }

        if (data?.content) {
          const text = extractText(data.content);
          const batchSignals = safeParseSignals(text);
          newSignals.push(...batchSignals);

          if (promptHash && batch.tweetUrls?.length) {
            ctx.waitUntil(cacheAnalysis(env, promptHash, batch.tweetUrls, text, resolvedModel));
          }

          const inputTokens = data.usage?.input_tokens || 0;
          const outputTokens = data.usage?.output_tokens || 0;
          ctx.waitUntil(logUsage(env, userId, 'scheduled_scan_analyze', {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_anthropic: estimateAnthropicCost(resolvedModel, inputTokens, outputTokens),
            accounts_count: batch.accounts.length,
          }));
        }
      } catch (e) {
        batchesFailed++;
        console.error(`[sched:${sid.slice(0, 8)}] Batch failed:`, e.message);
      }
    }
  }

  // 9. Combine, dedup, save
  const allSignals = [...cachedSignals, ...newSignals];
  const seen = new Set();
  const dedupedSignals = allSignals.filter(s => {
    const key = `${s.tweet_url || ''}::${s.title || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // If ALL batches failed and we have no signals at all, report error
  if (dedupedSignals.length === 0 && batchesFailed > 0) {
    throw new Error(`Analysis failed (${batchesFailed}/${batchesTotal} batches failed)`);
  }

  await saveScanToDb(env, ctx, userId, {
    accounts, days, model, promptHash, creditsNeeded,
    signals: dedupedSignals, totalTweets, label: schedule.label,
  });

  // 10. Success
  const parts = [`${dedupedSignals.length} signals from ${totalTweets} tweets`];
  if (batchesFailed) parts.push(`(${batchesFailed} batch${batchesFailed > 1 ? 'es' : ''} failed)`);
  if (failedAccounts.length) parts.push(`(${failedAccounts.length} account${failedAccounts.length > 1 ? 's' : ''} unreachable)`);
  await setStatus('success', parts.join(' '));
  log('Complete: ' + parts[0]);
}

/**
 * Save a completed scan to the scans table and deduct credits.
 * Order: save scan first (so results aren't lost), then deduct credits.
 */
async function saveScanToDb(env, ctx, userId, { accounts, days, model, promptHash, creditsNeeded, signals, totalTweets, label }) {
  const rangeLabel = days <= 1 ? 'Today' : days <= 7 ? 'Week' : 'Month';

  // Build tweet meta from signals
  const tweetMeta = {};
  signals.forEach(s => {
    if (s.tweet_url) {
      tweetMeta[s.tweet_url] = { text: (s.summary || '').slice(0, 500), author: s.source || '' };
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
    credits_used: creditsNeeded,
    scheduled: true,
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
 */
async function runDueScheduledScans(env, ctx) {
  try {
    // Reset stale "running" scans (stuck for > 10 min = worker timed out/crashed)
    // Only reset if last_run_at is old — avoids race with scans that just completed
    try {
      const staleThreshold = new Date(Date.now() - 10 * 60_000).toISOString();
      const stale = await supabaseQuery(env,
        `scheduled_scans?last_run_status=eq.running&last_run_at=lt.${staleThreshold}&select=id,label`
      );
      if (stale?.length) {
        console.log(`[cron] Resetting ${stale.length} stale running scan(s)`);
        for (const s of stale) {
          // Only update if status is STILL 'running' (another cron tick or the scan itself may have fixed it)
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

    if (!schedules?.length) {
      return;
    }

    console.log(`[cron] Checking ${schedules.length} enabled schedules`);

    // Filter to due schedules
    const dueSchedules = schedules.filter(isScheduleDue);
    if (!dueSchedules.length) {
      return;
    }

    console.log(`[cron] Found ${dueSchedules.length} due scheduled scans:`,
      dueSchedules.map(s => `${s.label}@${s.time} (tz=${s.timezone}, accounts=${(s.accounts||[]).length})`).join(', '));

    // Execute up to 5 concurrent scheduled scans
    const MAX_CONCURRENT = 5;
    for (let i = 0; i < dueSchedules.length; i += MAX_CONCURRENT) {
      const batch = dueSchedules.slice(i, i + MAX_CONCURRENT);
      await Promise.allSettled(
        batch.map(schedule => executeScheduledScan(env, ctx, schedule))
      );
    }
  } catch (e) {
    console.error('runDueScheduledScans error:', e.message, e.stack);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

// Allowed origins for CORS (production + local dev)
const ALLOWED_ORIGINS = new Set([
  'https://sentry.is',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:8888',
]);

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

// Tweet cache uses 4-hour buckets for better hit rates across users.
// Stale-while-revalidate: return the previous bucket instantly + refresh in bg.
const TWEET_CACHE_HOURS = 4;

function tweetCacheKey(account, days) {
  const bucket = Math.floor(Date.now() / (TWEET_CACHE_HOURS * 3600000));
  return `tweets:${account.toLowerCase()}:${days}:${bucket}`;
}

function tweetCacheKeyStale(account, days) {
  const bucket = Math.floor(Date.now() / (TWEET_CACHE_HOURS * 3600000));
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
  const { account, days } = await request.json();
  if (!account || !days) {
    return corsJson({ error: 'Missing account or days' }, 400, env);
  }
  // Validate account: alphanumeric/underscores, 1-15 chars (Twitter username rules)
  if (typeof account !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(account)) {
    return corsJson({ error: 'Invalid account name' }, 400, env);
  }
  // Validate days: positive integer, max 30
  const daysNum = parseInt(days);
  if (!Number.isFinite(daysNum) || daysNum < 1 || daysNum > 30) {
    return corsJson({ error: 'Days must be between 1 and 30' }, 400, env);
  }

  // Credits > 0 = managed keys; no credits = BYOK
  const profile = await getProfile(env, user.id);
  if (!profile || profile.credits_balance <= 0) {
    return corsJson({ error: 'No credits remaining. Buy a credit pack or use your own API keys.', code: 'NO_CREDITS' }, 403, env);
  }

  const result = await fetchTweetsCoalesced(account, days, env, ctx);

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
  const { accounts, days } = await request.json();
  if (!accounts?.length || !days) {
    return corsJson({ error: 'Missing accounts or days' }, 400, env);
  }
  // Validate days: positive integer, max 30
  const daysNum = parseInt(days);
  if (!Number.isFinite(daysNum) || daysNum < 1 || daysNum > 30) {
    return corsJson({ error: 'Days must be between 1 and 30' }, 400, env);
  }
  // Validate all account names
  if (!Array.isArray(accounts) || accounts.some(a => typeof a !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(a))) {
    return corsJson({ error: 'Invalid account name(s)' }, 400, env);
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
  const body = await request.json();
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
  const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens) || 16384, 256), 32768);

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
        throw new Error(`Anthropic returned non-JSON response (status ${res.status})`);
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
  const { prompt_hash, tweet_urls } = await request.json();
  if (!prompt_hash || !tweet_urls?.length) {
    return corsJson({ cached: {}, missing: tweet_urls || [] }, 200, env);
  }

  // Cap batch size to prevent abuse
  const urls = tweet_urls.slice(0, 500);

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

  // Validate field types and values
  const VALID_THEMES = ['light', 'dark', 'auto'];
  const VALID_TEXT_CASES = ['normal', 'uppercase', 'lowercase'];
  const validators = {
    theme: v => typeof v === 'string' && VALID_THEMES.includes(v),
    font: v => typeof v === 'string' && v.length <= 100,
    font_size: v => typeof v === 'number' && v >= 8 && v <= 32,
    text_case: v => typeof v === 'string' && VALID_TEXT_CASES.includes(v),
    finance_provider: v => typeof v === 'string' && v.length <= 50,
    model: v => typeof v === 'string' && v.length <= 100,
    live_enabled: v => typeof v === 'boolean',
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
  const body = await request.json();
  const { id, name, accounts, is_public, sort_order } = body;
  if (!name || !accounts?.length) {
    return corsJson({ error: 'Name and accounts required' }, 400, env);
  }
  if (typeof name !== 'string' || name.length > 100) {
    return corsJson({ error: 'Name must be a string under 100 characters' }, 400, env);
  }
  if (!Array.isArray(accounts) || accounts.length > 200) {
    return corsJson({ error: 'Accounts must be an array with at most 200 entries' }, 400, env);
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
  if (!name || typeof name !== 'string') return corsJson({ error: 'Name required' }, 400, env);
  if (name.length > 100) return corsJson({ error: 'Name must be under 100 characters' }, 400, env);
  if (prompt && typeof prompt === 'string' && prompt.length > 50_000) {
    return corsJson({ error: 'Prompt must be under 50,000 characters' }, 400, env);
  }

  const data = {
    id: id || 'a_' + crypto.randomUUID(),
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
  const body = await request.json();
  const { id, label, time, timezone, days, range_days, preset_id, accounts, enabled } = body;

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
    ? [...new Set(days.filter(d => typeof d === 'number' && d >= 0 && d <= 6))].sort()
    : [];
  // 7 selected days = every day = empty array
  const normalizedDays = validDays.length === 7 ? [] : validDays;

  // Validate range_days
  const validRangeDays = [1, 7, 30].includes(range_days) ? range_days : 1;

  // Sanitize accounts (lowercase, trimmed, deduped)
  const validAccounts = Array.isArray(accounts)
    ? [...new Set(accounts.map(a => String(a).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]
    : [];

  // Sanitize label
  const validLabel = String(label || 'Scan').trim().slice(0, 100);

  const data = {
    user_id: user.id,
    label: validLabel,
    time: normalizedTime,
    timezone: validTz,
    days: normalizedDays,
    range_days: validRangeDays,
    preset_id: preset_id || null,
    accounts: validAccounts,
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    // Update existing — ensure user owns it
    const existing = await supabaseQuery(env,
      `scheduled_scans?id=eq.${id}&user_id=eq.${user.id}&select=id`
    );
    if (!existing?.length) return corsJson({ error: 'Schedule not found' }, 404, env);

    await supabaseQuery(env, `scheduled_scans?id=eq.${id}&user_id=eq.${user.id}`, {
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
  const { id } = await request.json();
  if (!id) return corsJson({ error: 'Missing id' }, 400, env);
  await supabaseQuery(env, `scheduled_scans?id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE' });
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
  const body = await request.json();
  const { accounts, range_label, range_days, total_tweets, signal_count, signals, tweet_meta, prompt_hash, byok, reservation_id, model } = body;

  // Validate inputs
  if (signals && (!Array.isArray(signals) || signals.length > 5000)) {
    return corsJson({ error: 'Invalid signals data' }, 400, env);
  }
  if (accounts && (!Array.isArray(accounts) || accounts.length > 200)) {
    return corsJson({ error: 'Invalid accounts data' }, 400, env);
  }

  const accountCount = accounts?.length || 0;
  const days = Math.max(1, Math.min(parseInt(range_days) || 1, 30));
  const creditsUsed = byok ? 0 : calculateScanCredits(accountCount, days, model);

  // Save the scan FIRST — user should always get their results
  const data = {
    user_id: user.id,
    accounts: accounts || [],
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
    return corsJson({ error: 'Failed to save scan results' }, 500, env);
  }

  // Deduct credits AFTER saving — user always gets results even if billing fails
  const profile = await getProfile(env, user.id);
  let newBalance = profile?.credits_balance || 0;

  if (!byok && profile && profile.credits_balance > 0 && creditsUsed > 0) {
    // Consume the credit reservation if one was provided
    if (reservation_id) {
      const reservation = creditReservations.get(reservation_id);
      if (!reservation || reservation.userId !== user.id) {
        console.warn(`Reservation ${reservation_id} not found or mismatched, falling back to direct deduct`);
      } else {
        creditReservations.delete(reservation_id);
      }
    }

    try {
      const result = await supabaseRpc(env, 'deduct_credits', {
        p_user_id: user.id,
        p_amount: creditsUsed,
        p_description: `Scan: ${accountCount} accounts × ${days}d`,
        p_metadata: { accounts_count: accountCount, range_days: days, reservation_id: reservation_id || null },
      });
      if (result === -1) {
        // Insufficient credits — scan already saved, just warn
        console.warn(`Insufficient credits for user ${user.id} (needed ${creditsUsed}, has ${profile.credits_balance})`);
      } else {
        newBalance = result;
      }
    } catch (e) {
      console.error(`[BILLING] Failed to deduct ${creditsUsed} credits for user ${user.id}:`, e.message);
      // Don't fail the request — scan was already saved
    }
  }

  // Also save to cross-user whole-scan cache
  if (prompt_hash && signals?.length) {
    cacheScanResult(env, ctx, accounts, days, prompt_hash, signals, total_tweets);

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

// ---------------------------------------------------------------------------
// CREDIT RESERVATION — pre-check and lock credits before a scan starts
// Prevents API drain: users can't consume expensive API calls without
// having enough credits. The reservation is stored in-memory (per-isolate)
// and committed when the scan is saved, or released if the scan fails.
// ---------------------------------------------------------------------------
const creditReservations = new Map(); // reservationId -> { userId, credits, ts }

// Clean up stale reservations (older than 10 minutes)
function cleanupReservations() {
  const cutoff = Date.now() - 600000;
  for (const [id, r] of creditReservations) {
    if (r.ts < cutoff) creditReservations.delete(id);
  }
}

async function handleReserveCredits(request, env, user) {
  const { accounts_count, range_days, model } = await request.json();
  if (!accounts_count || !range_days) {
    return corsJson({ error: 'Missing accounts_count or range_days' }, 400, env);
  }

  if (accounts_count > MAX_ACCOUNTS_PER_SCAN) {
    return corsJson({ error: `Maximum ${MAX_ACCOUNTS_PER_SCAN} accounts per scan.`, code: 'TOO_MANY_ACCOUNTS' }, 400, env);
  }

  const creditsNeeded = calculateScanCredits(accounts_count, range_days, model);
  const profile = await getProfile(env, user.id);

  if (!profile) {
    return corsJson({ error: 'Profile not found' }, 404, env);
  }

  // Free tier check
  if (profile.credits_balance <= 0) {
    const canFree = await supabaseRpc(env, 'check_free_scan_today', { p_user_id: user.id });
    if (!canFree) {
      return corsJson({
        error: 'Daily free scan used. Buy credits or come back tomorrow.',
        code: 'NO_FREE_SCANS',
      }, 403, env);
    }
    if (accounts_count > FREE_TIER.max_accounts) {
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

  // Create a reservation (in-memory, per isolate)
  cleanupReservations();
  const reservationId = crypto.randomUUID();
  creditReservations.set(reservationId, {
    userId: user.id,
    credits: creditsNeeded,
    ts: Date.now(),
  });

  return corsJson({
    ok: true,
    reservation_id: reservationId,
    credits_needed: creditsNeeded,
    credits_balance: profile.credits_balance,
  }, 200, env);
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
    }), { expirationTtl: 86400 }) // 24 hour TTL — signals rarely change that fast
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

// Validate redirect URL belongs to our domain — prevents open redirect attacks
function isAllowedRedirectUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'sentry.is' || parsed.hostname.endsWith('.sentry.is'));
  } catch {
    return false;
  }
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

  // Sanitize redirect URLs — only allow our own domain
  const safeSuccessUrl = isAllowedRedirectUrl(success_url) ? success_url : 'https://sentry.is/?billing=success';
  const safeCancelUrl = isAllowedRedirectUrl(cancel_url) ? cancel_url : 'https://sentry.is/?billing=cancel';

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

  // Sanitize return URL — only allow our own domain
  const safeReturnUrl = isAllowedRedirectUrl(return_url) ? return_url : 'https://sentry.is/v3/';

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

    // Add credits — but only if the webhook hasn't already processed this session.
    // Check credit_transactions for an existing entry with this stripe_session_id.
    if (credits > 0) {
      try {
        const existing = await supabaseQuery(env,
          `credit_transactions?user_id=eq.${user.id}&metadata->>stripe_session_id=eq.${session.id}&select=id&limit=1`
        );
        if (!existing?.length) {
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
        }
      } catch (e) {
        console.warn('add_credits/dedup check failed:', e.message);
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
    if (e.message.includes('409') || e.message.includes('duplicate') || e.message.includes('23505')) {
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
// ADMIN MONITORING
// ============================================================================

async function handleAdminMonitoring(request, env) {
  // Admin endpoint allows any origin (protected by secret, not CORS)
  const anyOrigin = '*';
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') || request.headers.get('x-admin-secret');
  if (!env.ADMIN_SECRET || !secret || secret !== env.ADMIN_SECRET) {
    return corsJson({ error: 'Unauthorized. Pass ?secret=YOUR_ADMIN_SECRET' }, 401, env, anyOrigin);
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
    return corsJson({ error: 'Failed to fetch monitoring data: ' + e.message }, 500, env, anyOrigin);
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
    const response = await fetch(targetUrl.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    // Limit response size to 1MB
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > 1_000_000) {
      return corsJson({ error: 'Response too large' }, 502, env);
    }

    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(env)).forEach(([k, v]) => headers.set(k, v));
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    const proxied = new Response(response.body, { status: response.status, headers });

    ctx.waitUntil(cache.put(cacheUrl, proxied.clone()));
    return proxied;
  } catch (e) {
    return corsJson({ error: 'Upstream request failed' }, 502, env); // Don't leak internal error details
  }
}
