// ============================================================================
// SENTRY — Configuration & Constants
// ============================================================================

function readRuntimeConfig() {
  if (typeof window === 'undefined') return {};
  const runtime = window.__SENTRY_CONFIG__;
  if (!runtime || typeof runtime !== 'object') return {};
  return runtime;
}

function configValue(key, fallback) {
  const runtime = readRuntimeConfig();
  const value = runtime[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function trimTrailingSlash(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\/+$/, '');
}

// --- Default presets (matches v3) ---
export const DEFAULT_PRESETS = [
  { name: 'tradfi', accounts: [
    'abcampbell', 'apralky', 'ayz_yzyz', 'citrini7', 'jukan05', 'martinshkreli', 'nicholastreece', 'zephyr_z9',
    'biancoresearch', 'lynaldencontact', 'lizannsonders', 'charliebilello', 'northmantrader', 'globalmacro',
    'macrocharts', 'dtapcap', 'bobeunlimited', 'macroalf', 'elerianm', 'zerohedge',
    'raydalio', 'ianbremmer', 'peterzeihan', 'brad_setser', 'robinbrooksii', 'baldingsworld', 'georgegammon',
    'kobeissiletter', 'nouriel', 'paulkrugman', 'adam_tooze', 'minxinpei', 'korischake', 'eurasiagroup',
    'cfr_org', 'brookingsinst', 'carnegieendow', 'stratfor', 'michaelevery', 'sentimentrader', 'hedgeye', 'realvision',
  ] },
  { name: 'crypto', accounts: ['0xaporia', '0xgeegee', '0xkinnif', '0xkyle__', '0xnairolf', '0xsisyphus', '0xsmac', '0xwangarian', '0x_kun', '33b345', '__bleeker', 'abetrade', 'aggrnews', 'ahboyash', 'awawat', 'bambouclub', 'based16z', 'bit_hedge', 'blknoiz06', 'bluntz_capital', 'bobloukas', 'burstingbagel', 'c0xswain', 'cbb0fe', 'cheshire_cap', 'choffstein', 'chortly', 'chrisgrx_', 'cl207', 'cobie', 'cryptoluffyy', 'cryptopathic', 'cuntycakes123', 'danny_xbt', 'deaftrader1', 'defi_monk', 'defiyst', 'definalist', 'defisquared', 'degenping', 'delucinator', 'dogetoshi', 'donalt', 'evan_ss6', 'fejau_inc', 'foftypawlow', 'gametheorizing', 'gammichan', 'gcrclassic', 'goodalexander', 'hansolar21', 'hsakatrades', 'humacapital', 'husslin_', 'ieaturfoods', 'insiliconot', 'inversebrah', 'jeff_w1098', 'jimcattu', 'jimtalbot', 'kwaker_oats_', 'lbattlerhino', 'lightcrypto', 'lsdinmycoffee', 'luckyxbt__', 'maruushae', 'mert', 'misakatrades', 'mlmabc', 'nachotrades', 'nyuuroe', 'paoloardoino', 'paperflow8', 'pet3rpan_', 'pineanalytics', 'pk79z', 'qwqiao', 'redphonecrypto', 'riddle245', 'rodeo_crypro', 'runnerxbt', 'saliencexbt', 'salveboccaccio', 'sershokunin', 'smtrades_', 'tangtrades', 'techno_revenant', 'tetra_gamma', 'thecryptonexus', 'theotherparker_', 'thiccyth0t', 'thinkingusd', 'tier10k', 'timelessbeing', 'tradermercury', 'trading_axe', 'treenewsfeed', 'trippingvols', 'tzedonn', 'uttamsangwan', 'velo_xyz', 'xmgnr', 'zemirch', 'zoomerfied', 'rewkang'] },
  { name: 'tech', accounts: [
    'sama', 'karpathy', 'ylecun', 'andrewynng', 'gdb', 'kaifulee', 'demishassabis', 'jeffdean', 'arthurmensch', 'id_aa_carmack',
    'rowancheung', 'lexfridman', 'emollick', 'goodside', 'swyx', 'mattshumer_', 'alliekmiller',
    'simonw', 'natfriedman', 'levelsio', 'steipete', 'bindureddy',
    'tbpn', 'johncoogan', 'jordihays',
    'paulg', 'balajis', 'pmarca', 'cdixon', 'a16z',
    'huggingface', 'lmsysorg', 'anthropicai', 'stabilityai', 'techreview', 'aider',
  ] },
];

export const MAX_RECENTS = 10;

// Ranges (matches v3 — Today + Week only)
export const RANGES = [
  { label: 'Today', days: 1 },
  { label: 'Week', days: 7 },
];

export const CATEGORIES = ['Trade', 'Tool', 'Insight', 'Resource'];
export const CAT_C = { Trade: 'var(--green)', Tool: 'var(--blue)', Insight: 'var(--purple)', Resource: 'var(--amber)' };
export const CAT_MIGRATE = { 'Investment Idea': 'Trade', 'Tool / Product': 'Tool' };
export const ACT_C = { buy: 'var(--green)', sell: 'var(--red)', hold: 'var(--amber)', watch: 'var(--blue)', mixed: 'var(--purple)' };
export const ACT_BG = { buy: 'var(--green-10)', sell: 'var(--red-10)', hold: 'var(--amber-10)', watch: 'var(--blue-10)', mixed: 'var(--purple-10)' };

// localStorage keys
export const LS_TW = 'signal_twitter_key';
export const LS_AN = 'signal_anthropic_key';
export const LS_SCANS = 'signal_scan_history';
export const LS_CURRENT = 'signal_current_scan';
export const LS_ANALYSTS = 'signal_analysts';
export const LS_ACTIVE_ANALYST = 'signal_active_analyst';
export const LS_DEFAULT_PROMPT_HASH = 'signal_default_prompt_hash';
export const LS_ACCOUNTS = 'signal_accounts';
export const LS_LOADED_PRESETS = 'signal_loaded_presets';
export const LS_PRESETS = 'signal_presets';
export const LS_THEME = 'signal_theme';
export const LS_FINANCE = 'signal_finance_provider';
export const LS_FONT = 'signal_font';
export const LS_FONT_SIZE = 'signal_font_size';
export const LS_CASE = 'signal_case';
export const LS_RECENTS = 'signal_recent_accounts';
export const LS_ANALYSIS_CACHE = 'signal_analysis_cache';
export const LS_PENDING_SCAN = 'signal_pending_scan';
export const LS_LIVE_MODE = 'signal_live_mode';
export const LS_LIVE_ENABLED = 'signal_live_enabled';
export const LS_MODEL = 'signal_model';
export const LS_ONBOARDING_DONE = 'signal_onboarding_done';
export const LS_SHOW_TICKER_PRICE = 'signal_show_ticker_price';
export const LS_ICON_SET = 'signal_icon_set';
export const LS_LAST_SCHEDULED_NOTICE = 'signal_last_scheduled_notice';
export const LS_PENDING_SCHEDULED_SCAN = 'signal_pending_scheduled_scan';

export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_ANALYST_ID = 'default';

export const DEFAULT_PROMPT = `You are an elite financial intelligence analyst. Extract actionable trading signals from these tweets with the precision of a portfolio manager deploying real capital.

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
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch", type: "crypto"|"stock"}]
  type: "crypto" for any cryptocurrency, token, or DeFi protocol. "stock" for equities, ETFs, indices, commodities, forex.
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

// API endpoints
export const API_BASE = trimTrailingSlash(configValue('API_BASE', 'https://api.sentry.is'));
export const CORS_PROXY = configValue('CORS_PROXY', `${API_BASE || ''}/api/proxy?url=`);

// Supabase config
export const SUPABASE_URL = trimTrailingSlash(configValue('SUPABASE_URL', 'https://mfbnbfpfjeetaejibvjy.supabase.co'));
export const SUPABASE_ANON_KEY = configValue('SUPABASE_ANON_KEY', 'sb_publishable_aXJZySxABS2lOW_WQS-OOQ_RNSymyfn');

// Model pricing (per million tokens)
export const MODEL_PRICING = {
  'opus':   { input: 15, output: 75 },
  'sonnet': { input: 3,  output: 15 },
  'haiku':  { input: 0.80, output: 4 },
};

// Live feed config
export const LIVE_POLL_INTERVAL = 120000;
export const LIVE_ACCOUNTS_PER_POLL = 8;
export const LIVE_LOOKBACK_MINUTES = 30;
export const LIVE_ACCOUNT_COOLDOWN = 300000;

// Analysis config
export const ANALYSIS_CONCURRENCY = 3;
export const ANALYSIS_CONCURRENCY_SLOW = 2;
export const MAX_BATCH_CHARS = 640000;
export const MAX_BATCH_CHARS_WITH_IMAGES = 400000;
export const MAX_IMAGES_PER_BATCH = 5;
export const MAX_CACHE_ENTRIES = 2000;
export const BATCH_SEPARATOR = '\n\n======\n\n';

// Crypto slug map (CoinGecko)
export const CRYPTO_SLUGS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin', XRP: 'ripple',
  ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network', POL: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', ATOM: 'cosmos', LTC: 'litecoin', BCH: 'bitcoin-cash',
  XLM: 'stellar', ALGO: 'algorand', VET: 'vechain', FIL: 'filecoin', ICP: 'internet-computer',
  NEAR: 'near', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui',
  SEI: 'sei-network', INJ: 'injective-protocol', TIA: 'celestia', PEPE: 'pepe', WIF: 'dogwifcoin',
  BONK: 'bonk', SHIB: 'shiba-inu', FTM: 'fantom', SAND: 'the-sandbox', MANA: 'decentraland',
  APE: 'apecoin', CRV: 'curve-dao-token', AAVE: 'aave', MKR: 'maker', SNX: 'havven',
  COMP: 'compound-governance-token', LDO: 'lido-dao', RPL: 'rocket-pool', GMX: 'gmx',
  DYDX: 'dydx', JUP: 'jupiter-exchange-solana', JTO: 'jito-governance-token', PYTH: 'pyth-network',
  WLD: 'worldcoin-wld', RENDER: 'render-token', RNDR: 'render-token', FET: 'fetch-ai', AGIX: 'singularitynet',
  TAO: 'bittensor', GALA: 'gala', IMX: 'immutable-x', BLUR: 'blur', ENS: 'ethereum-name-service',
  STX: 'blockstack', RUNE: 'thorchain', OSMO: 'osmosis', KAVA: 'kava', ROSE: 'oasis-network',
  ZEC: 'zcash', EOS: 'eos', XMR: 'monero', EGLD: 'elrond-erd-2', HBAR: 'hedera-hashgraph',
  QNT: 'quant-network', THETA: 'theta-token', XTZ: 'tezos', FLOW: 'flow', NEO: 'neo',
  KAS: 'kaspa', TON: 'the-open-network', TRX: 'tron', USDT: 'tether', USDC: 'usd-coin',
  DAI: 'dai', BUSD: 'binance-usd', TUSD: 'true-usd', FRAX: 'frax', LUSD: 'liquity-usd',
  HYPE: 'hyperliquid',
};

// TradingView symbol overrides — maps tickers to their correct TV symbol
// when the raw ticker would resolve to the wrong instrument.
// Crypto default is BINANCE:<SYM>USDT; non-crypto default is the raw symbol.
export const TV_SYMBOL_OVERRIDES = {
  HYPE: 'PYTH:HYPEUSD',
  '000660.KS': 'KRX:000660',
  XAU: 'TVC:GOLD',
  XAG: 'TVC:SILVER',
  SPX: 'SP:SPX', SP500: 'SP:SPX',
  NDX: 'NASDAQ:NDX', NASDAQ: 'NASDAQ:IXIC', COMPQ: 'NASDAQ:IXIC',
  DJI: 'DJ:DJI', DJIA: 'DJ:DJI', DOW: 'DJ:DJI',
  RUT: 'TVC:RUT',
  VIX: 'TVC:VIX',
  TNX: 'TVC:TNX',
  DXY: 'TVC:DXY',
};

// Ticker symbol aliases — canonical mappings for signal normalization
export const TICKER_SYMBOL_ALIASES = {
  RNDR: 'RENDER',
  AGIX: 'FET',
  POL: 'MATIC',
};

// Yahoo Finance index map
export const INDEX_MAP = {
  'SPX': '^GSPC', 'SP500': '^GSPC', 'SPY': 'SPY',
  'NDX': '^NDX', 'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'COMPQ': '^IXIC',
  'DJI': '^DJI', 'DJIA': '^DJI', 'DOW': '^DJI', 'DIA': 'DIA',
  'RUT': '^RUT', 'IWM': 'IWM',
  'VIX': '^VIX', 'UVXY': 'UVXY', 'VXX': 'VXX',
  'TNX': '^TNX', 'TLT': 'TLT', 'TBT': 'TBT',
  'DXY': 'DX-Y.NYB', 'UUP': 'UUP',
  'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'AUDUSD': 'AUDUSD=X', 'NZDUSD': 'NZDUSD=X',
  'USDJPY': 'JPY=X', 'USDCHF': 'CHF=X', 'USDCAD': 'CAD=X',
  'XAU': 'GC=F', 'GLD': 'GLD', 'XAG': 'SI=F', 'SLV': 'SLV', 'USO': 'USO', 'UNG': 'UNG',
  'XLF': 'XLF', 'XLE': 'XLE', 'XLK': 'XLK', 'XLV': 'XLV', 'XLI': 'XLI', 'XLP': 'XLP', 'XLU': 'XLU', 'XLY': 'XLY', 'XLB': 'XLB', 'XLRE': 'XLRE',
  'ARKK': 'ARKK', 'ARKG': 'ARKG', 'ARKW': 'ARKW', 'ARKF': 'ARKF',
  'SMH': 'SMH', 'SOXX': 'SOXX', 'XBI': 'XBI', 'IBB': 'IBB',
};

// Credit packs — matches backend CREDIT_PACKS
export const CREDIT_PACKS = [
  { id: 'starter',  name: 'Starter',  credits: 1000,  price: 900,   perCredit: 0.009,  estimates: '~20 scans' },
  { id: 'standard', name: 'Standard', credits: 5000,  price: 3900,  perCredit: 0.0078, savings: '13%', recommended: true, estimates: '~100 scans' },
  { id: 'pro',      name: 'Pro',      credits: 15000, price: 9900,  perCredit: 0.0066, savings: '27%', estimates: '~300 scans' },
  { id: 'max',      name: 'Max',      credits: 40000, price: 19900, perCredit: 0.005,  savings: '45%', estimates: '~800 scans' },
];

// Range multipliers for credit estimation
const RANGE_MULTIPLIERS = { 1: 1, 3: 2, 7: 3, 14: 5, 30: 8 };
const MODEL_MULTIPLIERS = { haiku: 0.25, sonnet: 1, opus: 5 };

/**
 * Estimate scan credit cost.
 * Credits = accounts × rangeMultiplier × modelMultiplier
 */
export function calculateScanCredits(accountsCount, rangeDays, modelId) {
  const rangeMul = RANGE_MULTIPLIERS[rangeDays] || Math.ceil(rangeDays / 3);
  let modelMul = 1;
  const id = (modelId || '').toLowerCase();
  for (const [family, mul] of Object.entries(MODEL_MULTIPLIERS)) {
    if (id.includes(family)) { modelMul = mul; break; }
  }
  return Math.ceil(accountsCount * rangeMul * modelMul);
}

// Day-of-week labels
export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
