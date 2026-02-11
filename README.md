# sentry

signal without the noise. scans twitter accounts for trading signals using claude.

## architecture

```
app/           vanilla js frontend (no build step)
  js/          app.js, engine.js, ui.js, api.js, auth.js, config.js
  css/         styles.css
api/           cloudflare worker backend
  worker.js    all api endpoints
  schema.sql   supabase database schema
  wrangler.jsonc
worker.js      cors proxy (root-level, separate worker)
index.html     entry point
manifest.json  pwa manifest
```

the frontend is plain html/css/js with es6 modules. no bundler, no npm, no build step.

the backend is a single cloudflare worker that proxies twitter + anthropic apis, manages auth via supabase, handles billing via stripe, and runs scheduled scans via cron.

## local development

### frontend only (byok mode)

serve the root directory with any http server:

```bash
npx live-server
# or
python3 -m http.server 8000
```

open `http://localhost:8000`, go to settings, enter your own twitter api key (twitterapi.io) and anthropic api key. no backend needed.

### full stack

1. set up supabase — create a project and run `api/schema.sql` in the sql editor
2. deploy the api worker (see below)
3. update `app/js/config.js` if your urls differ:
   - `API_BASE` — your worker url
   - `CORS_PROXY` — your cors proxy url
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` — your supabase project

### running the api worker locally

```bash
cd api
npx wrangler dev
```

this starts the worker at `http://localhost:8787`. you'll need secrets set (see below).

## deployment

### api worker

```bash
cd api
npx wrangler deploy
```

deployed to: `api.sentry.is` (custom domain configured in `api/wrangler.jsonc`)

### cors proxy

```bash
npx wrangler deploy
```

deployed to: `proxy.sentry.is` (configured in root `wrangler.jsonc`)

### frontend

static files — deploy `index.html`, `app/`, and `manifest.json` to any static host (cloudflare pages, netlify, vercel, etc).

## secrets

set via `wrangler secret put <NAME>` in the `api/` directory:

| secret | source |
|---|---|
| `SUPABASE_URL` | supabase project settings |
| `SUPABASE_SERVICE_KEY` | supabase service role key |
| `SUPABASE_ANON_KEY` | supabase anon/public key |
| `TWITTER_API_KEY` | twitterapi.io |
| `ANTHROPIC_API_KEY` | anthropic console |
| `STRIPE_SECRET_KEY` | stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | stripe webhook settings |

env vars (non-secret, in `api/wrangler.jsonc`): stripe price ids, `CORS_ORIGIN`, `ENVIRONMENT`.

## database

supabase (postgres). run `api/schema.sql` to create all tables:

- `profiles` — user accounts, credit balance, stripe ids
- `user_settings` — theme, font, model preference
- `presets` — saved account lists
- `analysts` — custom signal extraction prompts
- `scans` — scan history with extracted signals
- `scheduled_scans` — recurring scans (time, presets, accounts)
- `credit_transactions` — billing audit trail
- `tweet_cache` — shared tweet cache (auto-expires)
- `analysis_cache` — shared analysis cache (prompt hash + tweet url)

migrations are manual — run alter statements in supabase sql editor.

## commands

```bash
# --- development ---
npx live-server                        # serve frontend locally
cd api && npx wrangler dev             # run api worker locally
cd api && npx wrangler tail            # stream live worker logs

# --- deployment ---
cd api && npx wrangler deploy          # deploy api worker
npx wrangler deploy                    # deploy cors proxy (from root)

# --- secrets ---
cd api && npx wrangler secret put SUPABASE_SERVICE_KEY
cd api && npx wrangler secret put TWITTER_API_KEY
cd api && npx wrangler secret put ANTHROPIC_API_KEY
cd api && npx wrangler secret put STRIPE_SECRET_KEY
cd api && npx wrangler secret put STRIPE_WEBHOOK_SECRET

# --- useful ---
cd api && npx wrangler secret list     # list configured secrets
cd api && npx wrangler kv key list --binding TWEET_CACHE  # inspect kv cache
```
