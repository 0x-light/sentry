import type { Preset } from './types'

export const DEFAULT_PRESETS: Preset[] = [
  { name: 'tradfi', accounts: [
    'abcampbell', 'apralky', 'ayz_yzyz', 'citrini7', 'jukan05', 'MartinShkreli', 'nicholastreece', 'zephyr_z9',
    // Macro & geopolitics
    'biancoresearch', 'LynAldenContact', 'LizAnnSonders', 'charliebilello', 'NorthmanTrader', 'globalmacro',
    'MacroCharts', 'DTAPCAP', 'BobEUnlimited', 'MacroAlf', 'elerianm', 'zerohedge',
    'RayDalio', 'IanBremmer', 'PeterZeihan', 'Brad_Setser', 'RobinBrooksII', 'BaldingsWorld', 'GeorgeGammon',
    'KobeissiLetter', 'Nouriel', 'paulkrugman', 'adam_tooze', 'minxinpei', 'KoriSchake', 'EurasiaGroup',
    'CFR_org', 'BrookingsInst', 'carnegieendow', 'stratfor', 'MichaelEvery', 'SentimenTrader', 'hedgeye',
    'RealVision',
  ] },
  { name: 'crypto', accounts: ['0xaporia', '0xGeeGee', '0xkinnif', '0xkyle__', '0xNairolf', '0xSisyphus', '0xsmac', '0xWangarian', '0x_Kun', '33b345', '__bleeker', 'abetrade', 'AggrNews', 'ahboyash', 'awawat', 'BambouClub', 'based16z', 'bit_hedge', 'blknoiz06', 'Bluntz_Capital', 'BobLoukas', 'burstingbagel', 'c0xswain', 'Cbb0fe', 'Cheshire_Cap', 'choffstein', 'chortly', 'chrisgrx_', 'CL207', 'cobie', 'cryptoluffyy', 'Cryptopathic', 'cuntycakes123', 'danny_xbt', 'deaftrader1', 'defi_monk', 'DeFiyst', 'definalist', 'DefiSquared', 'DegenPing', 'delucinator', 'Dogetoshi', 'DonAlt', 'Evan_ss6', 'fejau_inc', 'FoftyPawlow', 'gametheorizing', 'gammichan', 'GCRClassic', 'goodalexander', 'hansolar21', 'HsakaTrades', 'HumaCapital', 'Husslin_', 'ieaturfoods', 'insiliconot', 'inversebrah', 'jeff_w1098', 'jimcattu', 'jimtalbot', 'kwaker_oats_', 'lBattleRhino', 'lightcrypto', 'LSDinmycoffee', 'LuckyXBT__', 'maruushae', 'mert', 'MisakaTrades', 'mlmabc', 'NachoTrades', 'NyuuRoe', 'paoloardoino', 'PaperFlow8', 'pet3rpan_', 'PineAnalytics', 'pk79z', 'QwQiao', 'redphonecrypto', 'riddle245', 'rodeo_crypro', 'RunnerXBT', 'saliencexbt', 'salveboccaccio', 'sershokunin', 'SMtrades_', 'TangTrades', 'Techno_Revenant', 'tetra_gamma', 'TheCryptoNexus', 'TheOtherParker_', 'thiccyth0t', 'ThinkingUSD', 'tier10k', 'timelessbeing', 'TraderMercury', 'trading_axe', 'TreeNewsFeed', 'trippingvols', 'tzedonn', 'uttamsangwan', 'velo_xyz', 'xmgnr', 'ZeMirch', 'zoomerfied'] },
  { name: 'tech', accounts: [
    // AI leaders & labs
    'sama', 'karpathy', 'ylecun', 'AndrewYNg', 'gdb', 'kaifulee', 'demishassabis', 'JeffDean',
    'arthurmensch', 'ID_AA_Carmack',
    // AI news & commentary
    'rowancheung', 'lexfridman', 'emollick', 'goodside', 'swyx', 'mattshumer_', 'alliekmiller',
    // Builder community
    'simonw', 'natfriedman', 'levelsio', 'steipete', 'bindureddy',
    // Tech media & shows
    'tbpn', 'johncoogan', 'jordihays',
    // Startup & VC
    'paulg', 'balajis', 'pmarca', 'cdixon', 'a16z',
    // Orgs & labs
    'HuggingFace', 'lmsysorg', 'AnthropicAI', 'StabilityAI', 'techreview',
    // Dev tools
    'Aider',
  ] },
];

export const MAX_RECENTS = 10;

export const RANGES = [
  { label: 'Today', days: 1 },
  { label: 'Week', days: 7 },
  { label: 'Month', days: 30 },
];

export const CATEGORIES = ['Trade', 'Tool', 'Insight', 'Resource'] as const;

export const CAT_MIGRATE: Record<string, string> = { 'Investment Idea': 'Trade', 'Tool / Product': 'Tool' };
export function normCat(c: string) { return CAT_MIGRATE[c] || c; }

export const ACT_COLORS: Record<string, { text: string; bg: string }> = {
  buy: { text: 'text-signal-green', bg: 'bg-signal-green-bg' },
  sell: { text: 'text-signal-red', bg: 'bg-signal-red-bg' },
  hold: { text: 'text-signal-amber', bg: 'bg-signal-amber-bg' },
  watch: { text: 'text-signal-blue', bg: 'bg-signal-blue-bg' },
  mixed: { text: 'text-signal-purple', bg: 'bg-signal-purple-bg' },
};

export const CAT_COLORS: Record<string, { text: string; bg: string }> = {
  Trade: { text: 'text-signal-green', bg: 'bg-signal-green-bg' },
  Tool: { text: 'text-signal-blue', bg: 'bg-signal-blue-bg' },
  Insight: { text: 'text-signal-purple', bg: 'bg-signal-purple-bg' },
  Resource: { text: 'text-signal-amber', bg: 'bg-signal-amber-bg' },
};

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
export const LS_ICON_SET = 'signal_icon_set';
export const LS_RECENTS = 'signal_recent_accounts';
export const LS_ANALYSIS_CACHE = 'signal_analysis_cache';
export const LS_PENDING_SCAN = 'signal_pending_scan';
export const LS_LIVE_MODE = 'signal_live_mode';
export const LS_LIVE_ENABLED = 'signal_live_enabled';
export const LS_MODEL = 'signal_model';
export const LS_ONBOARDING_DONE = 'signal_onboarding_done';

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

export const CORS_PROXY = 'https://sentry.tomaspalmeirim.workers.dev/?url=';

export const CRYPTO_SLUGS: Record<string, string> = {
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
export const TV_SYMBOL_OVERRIDES: Record<string, string> = {
  // Crypto
  HYPE: 'PYTH:HYPEUSD',
  // Commodities
  XAU: 'TVC:GOLD',
  XAG: 'TVC:SILVER',
  // Indices
  SPX: 'SP:SPX',
  SP500: 'SP:SPX',
  NDX: 'NASDAQ:NDX',
  NASDAQ: 'NASDAQ:IXIC',
  COMPQ: 'NASDAQ:IXIC',
  DJI: 'DJ:DJI',
  DJIA: 'DJ:DJI',
  DOW: 'DJ:DJI',
  RUT: 'TVC:RUT',
  VIX: 'TVC:VIX',
  TNX: 'TVC:TNX',
  DXY: 'TVC:DXY',
};

export const INDEX_MAP: Record<string, string> = {
  'SPX': '^GSPC', 'SP500': '^GSPC', 'SPY': 'SPY',
  'NDX': '^NDX', 'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'COMPQ': '^IXIC',
  'DJI': '^DJI', 'DJIA': '^DJI', 'DOW': '^DJI', 'DIA': 'DIA',
  'RUT': '^RUT', 'IWM': 'IWM',
  'VIX': '^VIX', 'UVXY': 'UVXY', 'VXX': 'VXX',
  'TNX': '^TNX', 'TLT': 'TLT', 'TBT': 'TBT',
  'DXY': 'DX-Y.NYB', 'UUP': 'UUP',
  'XAU': 'GC=F', 'GLD': 'GLD', 'XAG': 'SI=F', 'SLV': 'SLV', 'USO': 'USO', 'UNG': 'UNG',
};

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'opus': { input: 15, output: 75 },
  'sonnet': { input: 3, output: 15 },
  'haiku': { input: 0.80, output: 4 },
};
