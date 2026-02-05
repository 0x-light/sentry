// ============================================================================
// SENTRY - Trading Signal Scanner
// ============================================================================

// --- Config ---
const DEFAULT_PRESETS = [
  { name: 'tradfi', accounts: ['abcampbell', 'apralky', 'ayz_yzyz', 'citrini7', 'jukan05', 'MartinShkreli', 'nicholastreece', 'zephyr_z9'] },
  { name: 'crypto', accounts: ['0xaporia', '0xGeeGee', '0xkinnif', '0xkyle__', '0xNairolf', '0xsmac', '0xWangarian', '0x_Kun', '33b345', '__bleeker', 'abetrade', 'AggrNews', 'ahboyash', 'awawat', 'BambouClub', 'based16z', 'bit_hedge', 'blknoiz06', 'Bluntz_Capital', 'BobLoukas', 'burstingbagel', 'c0xswain', 'Cbb0fe', 'Cheshire_Cap', 'choffstein', 'chortly', 'chrisgrx_', 'CL207', 'cobie', 'cryptoluffyy', 'Cryptopathic', 'cuntycakes123', 'danny_xbt', 'deaftrader1', 'defi_monk', 'DeFiyst', 'definalist', 'DefiSquared', 'DegenPing', 'delucinator', 'Dogetoshi', 'DonAlt', 'Evan_ss6', 'fejau_inc', 'FoftyPawlow', 'gametheorizing', 'gammichan', 'GCRClassic', 'goodalexander', 'hansolar21', 'HsakaTrades', 'HumaCapital', 'Husslin_', 'ieaturfoods', 'insiliconot', 'inversebrah', 'jeff_w1098', 'jimcattu', 'kwaker_oats_', 'lBattleRhino', 'lightcrypto', 'LSDinmycoffee', 'LuckyXBT__', 'maruushae', 'mert', 'MisakaTrades', 'mlmabc', 'NachoTrades', 'NyuuRoe', 'paoloardoino', 'PaperFlow8', 'pet3rpan_', 'PineAnalytics', 'pk79z', 'QwQiao', 'redphonecrypto', 'riddle245', 'rodeo_crypro', 'RunnerXBT', 'saliencexbt', 'salveboccaccio', 'sershokunin', 'SMtrades_', 'TangTrades', 'Techno_Revenant', 'tetra_gamma', 'TheCryptoNexus', 'thiccyth0t', 'ThinkingUSD', 'tier10k', 'timelessbeing', 'TraderMercury', 'trading_axe', 'TreeNewsFeed', 'trippingvols', 'tzedonn', 'uttamsangwan', 'velo_xyz', 'xmgnr', 'ZeMirch', 'zoomerfied'] },
];
const MAX_RECENTS = 10;
const RANGES = [
  { label: 'Today', days: 1 },
  { label: 'Week', days: 7 },
  { label: 'Month', days: 30 },
];
const CATEGORIES = ['Trade', 'Tool', 'Insight', 'Resource'];
const CAT_C = { Trade: 'var(--green)', Tool: 'var(--blue)', Insight: 'var(--purple)', Resource: 'var(--amber)' };
const CAT_MIGRATE = { 'Investment Idea': 'Trade', 'Tool / Product': 'Tool' };
function normCat(c) { return CAT_MIGRATE[c] || c; }
const ACT_C = { buy: 'var(--green)', sell: 'var(--red)', hold: 'var(--amber)', watch: 'var(--blue)', mixed: 'var(--purple)' };
const ACT_BG = { buy: 'var(--green-10)', sell: 'var(--red-10)', hold: 'var(--amber-10)', watch: 'var(--blue-10)', mixed: 'var(--purple-10)' };
const LS_TW = 'signal_twitter_key';
const LS_AN = 'signal_anthropic_key';
const LS_SCANS = 'signal_scan_history';
const LS_CURRENT = 'signal_current_scan';
const LS_PROMPT = 'signal_custom_prompt'; // legacy, migrated to analysts
const LS_ANALYSTS = 'signal_analysts';
const LS_ACTIVE_ANALYST = 'signal_active_analyst';
const LS_DEFAULT_PROMPT_HASH = 'signal_default_prompt_hash';
const DEFAULT_ANALYST_ID = 'default';
const DEFAULT_PROMPT = `You are an elite financial intelligence analyst. Extract actionable trading signals from these tweets with the precision of a portfolio manager deploying real capital.

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
  • Commodity → ETF (Gold → $GLD, Oil → $USO, Silver → $SLV, Natgas → $UNG)
  Yahoo Finance format: US = symbol ($AAPL), Taiwan = .TW, HK = .HK, Japan = .T, Korea = .KS, crypto = symbol only. NEVER skip a tradeable asset. When in doubt, include it.
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned (articles, substacks, dashboards). Empty array if none.

Return ONLY valid JSON array. No markdown, no explanation.`;
const LS_ACCOUNTS = 'signal_accounts';
const LS_LOADED_PRESETS = 'signal_loaded_presets';
const LS_PRESETS = 'signal_presets';
const LS_THEME = 'signal_theme';
const LS_FINANCE = 'signal_finance_provider';
const LS_FONT = 'signal_font';
const LS_FONT_SIZE = 'signal_font_size';
const LS_CASE = 'signal_case';
const LS_RECENTS = 'signal_recent_accounts';
const LS_ANALYSIS_CACHE = 'signal_analysis_cache';
const LS_PENDING_SCAN = 'signal_pending_scan';
const LS_LIVE_MODE = 'signal_live_mode';
const LS_LIVE_ENABLED = 'signal_live_enabled';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const LS_MODEL = 'signal_model';
function getModel() { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; }

// Live feed config
const LIVE_POLL_INTERVAL = 120000; // 2 minutes
const LIVE_ACCOUNTS_PER_POLL = 8; // Only check this many accounts per poll (rotate through)
const LIVE_LOOKBACK_MINUTES = 30; // Only fetch tweets from last 30 minutes
const LIVE_ACCOUNT_COOLDOWN = 300000; // Don't re-check an account for 5 minutes if no new tweets
const CORS_PROXY = 'https://sentry.tomaspalmeirim.workers.dev/?url=';

let customAccounts = [];
let loadedPresets = [];
let range = 1;
let lastScanResult = null;
let busy = false;
let logs = [];
let filters = { category: null };

// Live feed state
let isLiveMode = false;
let liveInterval = null;
let livePollAbort = null;
let seenTweetUrls = new Set();
let lastLiveCheck = null;
let liveAccountIndex = 0; // For rotating through accounts
let liveAccountLastCheck = {}; // Track when each account was last checked and if it had content

function getAllAccounts() {
  const all = [...customAccounts];
  const presets = getPresets();
  for (const name of loadedPresets) {
    const p = presets.find(p => p.name === name);
    if (p) all.push(...p.accounts);
  }
  return [...new Set(all)];
}

function hasAnyAccounts() {
  return customAccounts.length > 0 || loadedPresets.length > 0;
}

// --- DOM ---
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

// --- Theme ---
function getTheme() { return localStorage.getItem(LS_THEME) || 'light'; }
function setTheme(t) {
  localStorage.setItem(LS_THEME, t);
  document.documentElement.setAttribute('data-theme', t);
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

// --- Presets ---
function getPresets() {
  const stored = localStorage.getItem(LS_PRESETS);
  if (!stored) {
    localStorage.setItem(LS_PRESETS, JSON.stringify(DEFAULT_PRESETS));
    return DEFAULT_PRESETS;
  }
  return JSON.parse(stored);
}
function savePresetsData(p) { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); }
function loadPreset(name) {
  const preset = getPresets().find(p => p.name === name);
  if (!preset) return;
  if (loadedPresets.includes(name)) {
    loadedPresets = loadedPresets.filter(n => n !== name);
  } else {
    loadedPresets.push(name);
  }
  saveLoadedPresets();
  render();
}

function deletePreset(name) {
  savePresetsData(getPresets().filter(p => p.name !== name));
  renderPresets();
  renderPresetList();
}
function renderPresets() {
  const el = $('presetsRow');
  const presets = getPresets();
  let h = '';
  presets.forEach(p => {
    const selected = loadedPresets.includes(p.name) ? ' selected' : '';
    h += `<button class="preset-chip${selected}" onclick="loadPreset('${esc(p.name)}')">${esc(p.name)} <span class="count">(${p.accounts.length})</span></button>`;
  });
  customAccounts.forEach(a => {
    h += `<button class="preset-chip selected" onclick="rmCustom('${esc(a)}')">${esc(a)}</button>`;
  });
  h += `<button class="preset-manage" onclick="openPresetModal()">+</button>`;
  if (loadedPresets.length > 0 || customAccounts.length > 0) {
    h += `<button class="clear-btn" onclick="clearAllAccounts()">×</button>`;
  }
  el.innerHTML = h;
}
let editingPresetName = null;

function openPresetModal() {
  editingPresetName = null;
  $('presetNameInput').value = '';
  $('presetAccountsInput').value = getAllAccounts().join(', ');
  renderPresetList();
  $('presetModal').classList.add('open');
  document.body.classList.add('modal-open');
  $('presetNameInput').focus();
}
function closePresetModal() {
  editingPresetName = null;
  $('presetModal').classList.remove('open');
  document.body.classList.remove('modal-open');
}
function editPreset(name) {
  const preset = getPresets().find(p => p.name === name);
  if (!preset) return;
  editingPresetName = name;
  $('presetNameInput').value = preset.name;
  $('presetAccountsInput').value = preset.accounts.join(', ');
  $('presetNameInput').focus();
  renderPresetList();
}
function savePreset() {
  const name = $('presetNameInput').value.trim();
  const accountsStr = $('presetAccountsInput').value;
  const accts = accountsStr.split(',').map(a => a.trim().replace(/^@/, '').toLowerCase()).filter(a => a);
  if (!name || !accts.length) return;
  let presets = getPresets();
  if (editingPresetName) {
    presets = presets.filter(p => p.name !== editingPresetName);
  }
  presets = presets.filter(p => p.name !== name);
  presets.push({ name, accounts: accts });
  savePresetsData(presets);
  if (editingPresetName && editingPresetName !== name && loadedPresets.includes(editingPresetName)) {
    loadedPresets = loadedPresets.map(n => n === editingPresetName ? name : n);
    saveLoadedPresets();
  }
  editingPresetName = null;
  renderPresets();
  renderPresetList();
  render();
  $('presetNameInput').value = '';
  $('presetAccountsInput').value = '';
}
function renderPresetList() {
  const el = $('presetList');
  const presets = getPresets();
  if (!presets.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:var(--fs);margin-top:8px">No presets yet</p>'; return; }
  el.innerHTML = presets.map(p => {
    const isEditing = editingPresetName === p.name;
    return `
    <div class="preset-list-item${isEditing ? ' editing' : ''}">
      <span>${esc(p.name)}<small>${p.accounts.length} accounts</small></span>
      <div class="preset-list-actions">
        <button onclick="editPreset('${esc(p.name)}')">${isEditing ? 'Editing' : 'Edit'}</button>
        <button class="danger" onclick="deletePreset('${esc(p.name)}')">Delete</button>
      </div>
    </div>
  `}).join('');
}

// --- Account Persistence ---
function saveAccounts() { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(customAccounts)); }
function loadAccountsData() {
  const saved = localStorage.getItem(LS_ACCOUNTS);
  if (saved) customAccounts = JSON.parse(saved);
}
function saveLoadedPresets() { localStorage.setItem(LS_LOADED_PRESETS, JSON.stringify(loadedPresets)); }
function loadLoadedPresets() {
  const saved = localStorage.getItem(LS_LOADED_PRESETS);
  if (saved) loadedPresets = JSON.parse(saved);
}

// --- Recent Accounts ---
function getRecents() {
  return JSON.parse(localStorage.getItem(LS_RECENTS) || '[]');
}
function addToRecents(accounts) {
  let recents = getRecents();
  accounts.forEach(a => {
    recents = recents.filter(r => r !== a);
    recents.unshift(a);
  });
  recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem(LS_RECENTS, JSON.stringify(recents));
}
function clearRecents() {
  localStorage.removeItem(LS_RECENTS);
  renderSuggested();
}

// ============================================================================
// API KEYS & SETTINGS
// ============================================================================

function getTwKey() { return localStorage.getItem(LS_TW) || ''; }
function getAnKey() { return localStorage.getItem(LS_AN) || ''; }

function bothKeys() {
  const tw = getTwKey();
  const an = getAnKey();
  return tw.length >= 20 && an.length >= 20;
}

function validateApiKey(key, type) {
  if (!key || typeof key !== 'string') return false;
  key = key.trim();
  if (key.length < 20) return false;
  if (type === 'anthropic' && !key.startsWith('sk-ant-')) return false;
  return true;
}

// --- Model Selection ---
// Pricing per million tokens (input/output) — used for relative cost labels
const MODEL_PRICING = {
  'opus':    { input: 15, output: 75 },
  'sonnet':  { input: 3,  output: 15 },
  'haiku':   { input: 0.80, output: 4 },
};

function getModelPricing(modelId) {
  const id = modelId.toLowerCase();
  for (const [family, pricing] of Object.entries(MODEL_PRICING)) {
    if (id.includes(family)) return pricing;
  }
  return null;
}

function formatModelCost(modelId) {
  const p = getModelPricing(modelId);
  if (!p) return '';
  return `$${p.input}/$${p.output} per MTok`;
}

function modelCostLabel(modelId) {
  const p = getModelPricing(modelId);
  if (!p) return '';
  if (p.input <= 1) return '· $';
  if (p.input <= 5) return '· $$';
  return '· $$$';
}

let cachedModels = null;
async function fetchAvailableModels(apiKey) {
  if (!apiKey || apiKey.length < 20) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data) return null;
    // Filter to chat models only (claude-*), sort by version desc then tier (opus > sonnet > haiku)
    const TIER_ORDER = { opus: 0, sonnet: 1, haiku: 2 };
    function extractModelVersion(id) {
      // IDs like: claude-sonnet-4-5-20250514, claude-opus-4-20250514, claude-3-haiku-20240307
      // Remove date suffix (8+ digit segment at end)
      const parts = id.replace(/claude-/, '').split('-').filter(p => !/^\d{8,}$/.test(p));
      // Extract numeric version segments
      const nums = parts.filter(p => /^\d+$/.test(p));
      if (nums.length >= 2) return parseFloat(nums[0] + '.' + nums[1]);
      if (nums.length === 1) return parseFloat(nums[0]);
      return 0;
    }
    return data.data
      .filter(m => m.id.startsWith('claude-') && !m.id.includes('embed'))
      .map(m => ({ id: m.id, name: m.display_name || m.id }))
      .sort((a, b) => {
        const verA = extractModelVersion(a.id), verB = extractModelVersion(b.id);
        if (verA !== verB) return verB - verA; // higher version first
        // Same version: sort by tier
        const tierA = Object.keys(TIER_ORDER).find(t => a.id.includes(t));
        const tierB = Object.keys(TIER_ORDER).find(t => b.id.includes(t));
        return (TIER_ORDER[tierA] ?? 9) - (TIER_ORDER[tierB] ?? 9);
      });
  } catch (e) {
    console.warn('Failed to fetch models:', e.message);
    return null;
  }
}

function populateModelSelector(models, selectedId) {
  const sel = $('modelProvider');
  const current = selectedId || getModel();
  sel.innerHTML = '';
  if (models && models.length) {
    cachedModels = models;
    let hasSelected = false;
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const cost = modelCostLabel(m.id);
      opt.textContent = cost ? `${m.name} ${cost}` : m.name;
      if (m.id === current) { opt.selected = true; hasSelected = true; }
      sel.appendChild(opt);
    });
    // If saved model not in list, add it at top
    if (!hasSelected) {
      const opt = document.createElement('option');
      opt.value = current;
      const cost = modelCostLabel(current);
      opt.textContent = cost ? `${current} ${cost}` : current;
      opt.selected = true;
      sel.prepend(opt);
    }
  } else {
    // Fallback: show saved model
    const opt = document.createElement('option');
    opt.value = current;
    const cost = modelCostLabel(current);
    opt.textContent = cost ? `${current} ${cost}` : current;
    sel.appendChild(opt);
  }
  sel.disabled = false;
  updateModelCostHint();
}

function updateModelCostHint() {
  let hint = $('modelCostHint');
  if (!hint) return;
  const sel = $('modelProvider');
  const cost = formatModelCost(sel.value);
  hint.textContent = cost;
}

async function refreshModelList() {
  const sel = $('modelProvider');
  const key = $('keyInput').value.trim();
  if (!key || key.length < 20) return;
  sel.disabled = true;
  sel.innerHTML = '<option>Loading models…</option>';
  const models = await fetchAvailableModels(key);
  populateModelSelector(models, getModel());
}

function getFinanceProvider() { return localStorage.getItem(LS_FINANCE) || 'tradingview'; }
function getFont() { return localStorage.getItem(LS_FONT) || 'mono'; }
function setFont(f) {
  localStorage.setItem(LS_FONT, f);
  document.documentElement.setAttribute('data-font', f);
}
function getFontSize() { return localStorage.getItem(LS_FONT_SIZE) || 'medium'; }
function setFontSize(s) {
  localStorage.setItem(LS_FONT_SIZE, s);
  document.documentElement.setAttribute('data-font-size', s);
}
function getCase() { return localStorage.getItem(LS_CASE) || 'lower'; }
function setCase(c) {
  localStorage.setItem(LS_CASE, c);
  document.documentElement.setAttribute('data-case', c);
}
// --- Analyst Management ---
function generateAnalystId() { return 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function getAnalysts() {
  try {
    const raw = localStorage.getItem(LS_ANALYSTS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveAnalysts(analysts) {
  localStorage.setItem(LS_ANALYSTS, JSON.stringify(analysts));
}

function getActiveAnalystId() {
  return localStorage.getItem(LS_ACTIVE_ANALYST) || DEFAULT_ANALYST_ID;
}

function setActiveAnalystId(id) {
  localStorage.setItem(LS_ACTIVE_ANALYST, id);
}

function initAnalysts() {
  let analysts = getAnalysts();
  const currentDefaultHash = hashString(DEFAULT_PROMPT);
  const storedDefaultHash = localStorage.getItem(LS_DEFAULT_PROMPT_HASH);

  if (!analysts) {
    // First run or migration from old system
    const oldPrompt = localStorage.getItem(LS_PROMPT);
    const userHadCustomPrompt = oldPrompt && oldPrompt !== DEFAULT_PROMPT;

    analysts = [{
      id: DEFAULT_ANALYST_ID,
      name: 'Default',
      prompt: DEFAULT_PROMPT,
      isDefault: true
    }];

    if (userHadCustomPrompt) {
      // Preserve user's old custom prompt as a separate analyst
      const customAnalyst = {
        id: generateAnalystId(),
        name: 'My Analyst',
        prompt: oldPrompt,
        isDefault: false
      };
      analysts.push(customAnalyst);
      setActiveAnalystId(customAnalyst.id);
    }

    // Clean up legacy key
    localStorage.removeItem(LS_PROMPT);
    saveAnalysts(analysts);
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, currentDefaultHash);
    return;
  }

  // Check if DEFAULT_PROMPT has been updated by developer
  if (storedDefaultHash !== currentDefaultHash) {
    const defaultAnalyst = analysts.find(a => a.id === DEFAULT_ANALYST_ID);
    if (defaultAnalyst) {
      // Only auto-update if user hasn't manually edited the default analyst
      const userEditedDefault = storedDefaultHash && hashString(defaultAnalyst.prompt) !== storedDefaultHash;
      if (!userEditedDefault) {
        defaultAnalyst.prompt = DEFAULT_PROMPT;
        saveAnalysts(analysts);
      }
    }
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, currentDefaultHash);
  }
}

function getActiveAnalyst() {
  const analysts = getAnalysts() || [];
  const activeId = getActiveAnalystId();
  return analysts.find(a => a.id === activeId) || analysts.find(a => a.id === DEFAULT_ANALYST_ID) || { id: DEFAULT_ANALYST_ID, name: 'Default', prompt: DEFAULT_PROMPT, isDefault: true };
}

function getPrompt() { return getActiveAnalyst().prompt; }

function setPrompt(p) {
  const analysts = getAnalysts() || [];
  const activeId = getActiveAnalystId();
  const analyst = analysts.find(a => a.id === activeId);
  if (analyst) {
    analyst.prompt = p;
    saveAnalysts(analysts);
  }
}

function createAnalyst(name, prompt) {
  const analysts = getAnalysts() || [];
  const newAnalyst = {
    id: generateAnalystId(),
    name: name || 'New Analyst',
    prompt: prompt || DEFAULT_PROMPT,
    isDefault: false
  };
  analysts.push(newAnalyst);
  saveAnalysts(analysts);
  return newAnalyst;
}

function deleteAnalyst(id) {
  if (id === DEFAULT_ANALYST_ID) return false;
  let analysts = getAnalysts() || [];
  analysts = analysts.filter(a => a.id !== id);
  saveAnalysts(analysts);
  if (getActiveAnalystId() === id) {
    setActiveAnalystId(DEFAULT_ANALYST_ID);
  }
  return true;
}

function duplicateAnalyst(id) {
  const analysts = getAnalysts() || [];
  const source = analysts.find(a => a.id === id);
  if (!source) return null;
  return createAnalyst(source.name + ' (copy)', source.prompt);
}

function renameAnalyst(id, newName) {
  const analysts = getAnalysts() || [];
  const analyst = analysts.find(a => a.id === id);
  if (analyst) {
    analyst.name = newName;
    saveAnalysts(analysts);
  }
}

function resetAnalystPrompt(id) {
  if (id !== DEFAULT_ANALYST_ID) return;
  const analysts = getAnalysts() || [];
  const defaultAnalyst = analysts.find(a => a.id === DEFAULT_ANALYST_ID);
  if (defaultAnalyst) {
    defaultAnalyst.prompt = DEFAULT_PROMPT;
    saveAnalysts(analysts);
    localStorage.setItem(LS_DEFAULT_PROMPT_HASH, hashString(DEFAULT_PROMPT));
  }
  renderAnalystList();
}

// Save all analyst edits from the rendered cards back to localStorage
function saveAnalystsFromUI() {
  const analysts = getAnalysts() || [];
  document.querySelectorAll('.analyst-item').forEach(el => {
    const id = el.dataset.analystId;
    const analyst = analysts.find(a => a.id === id);
    if (!analyst) return;
    const nameInput = el.querySelector('.analyst-name-input');
    const promptInput = el.querySelector('.analyst-prompt-input');
    if (nameInput && !analyst.isDefault) {
      const n = nameInput.value.trim();
      if (n) analyst.name = n;
    }
    if (promptInput) {
      analyst.prompt = promptInput.value.trim() || DEFAULT_PROMPT;
    }
  });
  saveAnalysts(analysts);
}

function renderAnalystList() {
  const container = $('analystList');
  if (!container) return;
  const analysts = getAnalysts() || [];
  const activeId = getActiveAnalystId();
  // Remember which items were open
  const openIds = new Set();
  container.querySelectorAll('.analyst-item.open').forEach(el => openIds.add(el.dataset.analystId));
  // If first render, open the active one
  if (!container.children.length) openIds.add(activeId);

  let h = '';
  analysts.forEach(a => {
    const isActive = a.id === activeId;
    const isOpen = openIds.has(a.id);
    const isDefault = a.id === DEFAULT_ANALYST_ID;
    h += `<div class="analyst-item${isOpen ? ' open' : ''}" data-analyst-id="${a.id}">`;
    h += `<div class="analyst-header" onclick="toggleAnalystCard('${a.id}')">`;
    h += `<span class="analyst-name">${esc(a.name)}${isActive ? ' <span class="analyst-active-tag">active</span>' : ''}</span>`;
    h += `<div class="analyst-actions">`;
    if (!isActive) h += `<button onclick="event.stopPropagation();useAnalyst('${a.id}')">use</button>`;
    h += `<button onclick="event.stopPropagation();duplicateAnalystUI('${a.id}')">duplicate</button>`;
    if (!isDefault) h += `<button class="danger" onclick="event.stopPropagation();deleteAnalystUI('${a.id}')">delete</button>`;
    h += `</div></div>`;
    h += `<div class="analyst-body">`;
    if (!isDefault) {
      h += `<label>Name</label>`;
      h += `<input type="text" class="analyst-name-input" value="${esc(a.name)}" placeholder="Analyst name">`;
    }
    h += `<label>Prompt${isDefault ? ' <button type="button" class="modal-sm-btn reset-prompt" onclick="resetAnalystPrompt(\'default\')">reset</button>' : ''}</label>`;
    h += `<textarea class="analyst-prompt-input" style="height:200px" placeholder="Custom instructions for the AI analyst...">${esc(a.prompt)}</textarea>`;
    h += `</div></div>`;
  });
  h += `<button class="analyst-add" onclick="newAnalystUI()">+ Create new analyst</button>`;
  container.innerHTML = h;
}

function toggleAnalystCard(id) {
  saveAnalystsFromUI();
  const item = document.querySelector(`.analyst-item[data-analyst-id="${id}"]`);
  if (item) item.classList.toggle('open');
}

function useAnalyst(id) {
  saveAnalystsFromUI();
  setActiveAnalystId(id);
  renderAnalystList();
}

function duplicateAnalystUI(id) {
  saveAnalystsFromUI();
  const dup = duplicateAnalyst(id);
  if (dup) {
    renderAnalystList();
    // Open the new one
    const item = document.querySelector(`.analyst-item[data-analyst-id="${dup.id}"]`);
    if (item) {
      item.classList.add('open');
      const nameInput = item.querySelector('.analyst-name-input');
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
  }
}

function deleteAnalystUI(id) {
  if (id === DEFAULT_ANALYST_ID) return;
  const analysts = getAnalysts() || [];
  const analyst = analysts.find(a => a.id === id);
  if (!analyst) return;
  if (!confirm(`Delete "${analyst.name}"?`)) return;
  deleteAnalyst(id);
  renderAnalystList();
}

function newAnalystUI() {
  saveAnalystsFromUI();
  const newA = createAnalyst('New Analyst', DEFAULT_PROMPT);
  renderAnalystList();
  // Open the new one
  const item = document.querySelector(`.analyst-item[data-analyst-id="${newA.id}"]`);
  if (item) {
    item.classList.add('open');
    const nameInput = item.querySelector('.analyst-name-input');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  }
}
function isLiveEnabled() { return localStorage.getItem(LS_LIVE_ENABLED) === 'true'; }
function setLiveEnabled(v) {
  if (v) {
    localStorage.setItem(LS_LIVE_ENABLED, 'true');
  } else {
    localStorage.removeItem(LS_LIVE_ENABLED);
    stopLiveFeed();
  }
  updateLiveButton();
}
function updateLiveButton() {
  const btn = $('liveBtn');
  if (btn) btn.style.display = isLiveEnabled() ? 'flex' : 'none';
}

// --- Analysis Cache ---
const MAX_CACHE_ENTRIES = 2000;
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}
function getPromptHash() {
  return hashString(`${getModel()}\n${getPrompt()}`);
}
function loadAnalysisCache() {
  try {
    const raw = localStorage.getItem(LS_ANALYSIS_CACHE);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.entries) return parsed;
  } catch {}
  return { v: 1, entries: {} };
}
function saveAnalysisCache(cache) {
  try {
    localStorage.setItem(LS_ANALYSIS_CACHE, JSON.stringify(cache));
  } catch (e) {
    console.warn('Failed to save analysis cache:', e.message);
  }
}
function cacheKey(promptHash, tweetUrl) {
  return `${promptHash}:${tweetUrl}`;
}
function getCachedSignals(cache, promptHash, tweetUrl) {
  if (!tweetUrl) return null;
  const entry = cache.entries[cacheKey(promptHash, tweetUrl)];
  return entry ? entry.signals || [] : null;
}
function setCachedSignals(cache, promptHash, tweetUrl, signals) {
  if (!tweetUrl) return;
  cache.entries[cacheKey(promptHash, tweetUrl)] = { signals: signals || [], ts: Date.now() };
}
function pruneCache(cache) {
  const keys = Object.keys(cache.entries);
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  keys.sort((a, b) => (cache.entries[a]?.ts || 0) - (cache.entries[b]?.ts || 0));
  const removeCount = keys.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    delete cache.entries[keys[i]];
  }
}

const tweetCache = new Map();

function cleanupCache() {
  const now = Date.now();
  const twoHoursAgo = Math.floor(now / 3600000) - 2;
  for (const [key] of tweetCache) {
    const keyHour = parseInt(key.split(':')[2]);
    if (keyHour < twoHoursAgo) {
      tweetCache.delete(key);
    }
  }
}

let originalSettings = {};
let lastSettingsTab = 'api';

function switchTab(name) {
  lastSettingsTab = name;
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.textContent.toLowerCase() === name));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
}

function openModal(tab) {
  originalSettings = {
    font: getFont(),
    fontSize: getFontSize(),
    textCase: getCase(),
  };
  $('twKeyInput').value = getTwKey();
  $('keyInput').value = getAnKey();
  $('financeProvider').value = getFinanceProvider();
  $('fontProvider').value = originalSettings.font;
  $('fontSizeProvider').value = originalSettings.fontSize;
  $('caseProvider').value = originalSettings.textCase;
  $('liveEnabledToggle').checked = isLiveEnabled();
  renderAnalystList();
  // Populate model selector
  if (cachedModels) {
    populateModelSelector(cachedModels, getModel());
  } else {
    populateModelSelector(null, getModel());
    if (getAnKey()) refreshModelList();
  }
  updateCacheSizeDisplay();
  switchTab(tab || lastSettingsTab);
  $('modal').classList.add('open');
  document.body.classList.add('modal-open');
  $('clearKeyBtn').style.display = (getTwKey() || getAnKey()) ? '' : 'none';
  if ((tab || lastSettingsTab) === 'api') setTimeout(() => $('twKeyInput').focus(), 50);
}

function updateCacheSizeDisplay() {
  const cache = loadAnalysisCache();
  const count = Object.keys(cache.entries || {}).length;
  $('cacheSize').textContent = count ? `${count} tweets cached` : 'empty';
}

function clearCache() {
  if (!confirm('Clear all cached analysis results?')) return;
  localStorage.removeItem(LS_ANALYSIS_CACHE);
  clearPendingScan();
  updateCacheSizeDisplay();
}
function closeModal() {
  if (originalSettings.font) setFont(originalSettings.font);
  if (originalSettings.fontSize) setFontSize(originalSettings.fontSize);
  if (originalSettings.textCase) setCase(originalSettings.textCase);
  $('modal').classList.remove('open');
  document.body.classList.remove('modal-open');
}
function saveKeys() {
  const tw = $('twKeyInput').value.trim();
  const an = $('keyInput').value.trim();
  const fp = $('financeProvider').value;
  const model = $('modelProvider').value;
  const font = $('fontProvider').value;
  const fontSize = $('fontSizeProvider').value;
  const textCase = $('caseProvider').value;
  const liveEnabled = $('liveEnabledToggle').checked;
  if (tw) localStorage.setItem(LS_TW, tw); else localStorage.removeItem(LS_TW);
  if (an) localStorage.setItem(LS_AN, an); else localStorage.removeItem(LS_AN);
  localStorage.setItem(LS_FINANCE, fp);
  if (model) localStorage.setItem(LS_MODEL, model);
  originalSettings = { font, fontSize, textCase };
  setFont(font);
  setFontSize(fontSize);
  setCase(textCase);
  setLiveEnabled(liveEnabled);
  saveAnalystsFromUI();
  updateKeyBtn();
  $('modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  if (lastScanResult && lastScanResult.signals) {
    renderTickers(lastScanResult.signals);
    renderSignals(lastScanResult.signals);
  }
}
function clearKeys() {
  localStorage.removeItem(LS_TW);
  localStorage.removeItem(LS_AN);
  localStorage.removeItem(LS_MODEL);
  cachedModels = null;
  $('twKeyInput').value = '';
  $('keyInput').value = '';
  populateModelSelector(null, DEFAULT_MODEL);
  updateKeyBtn();
  closeModal();
}
function encodeBackup(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function decodeBackup(str) {
  return decodeURIComponent(escape(atob(str)));
}
async function exportData(btn) {
  const data = {
    v: 1,
    settings: {
      theme: getTheme(),
      font: getFont(),
      fontSize: getFontSize(),
      textCase: getCase(),
      financeProvider: getFinanceProvider(),
      model: getModel(),
      prompt: getPrompt(),
    },
    keys: { twitter: getTwKey(), anthropic: getAnKey() },
    presets: getPresets(),
    analysts: getAnalysts(),
    activeAnalyst: getActiveAnalystId(),
    accounts: customAccounts,
    loadedPresets: loadedPresets,
    recents: getRecents(),
  };
  const encoded = encodeBackup(JSON.stringify(data));
  await navigator.clipboard.writeText(encoded);
  if (btn) {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Export'; }, 1500);
  }
}
async function importData(btn) {
  try {
    const encoded = await navigator.clipboard.readText();
    const json = decodeBackup(encoded.trim());
    const data = JSON.parse(json);
    if (!data.v && !data.version) throw new Error('Invalid backup format');
    if (data.settings) {
      if (data.settings.theme) setTheme(data.settings.theme);
      if (data.settings.font) setFont(data.settings.font);
      if (data.settings.fontSize) setFontSize(data.settings.fontSize);
      if (data.settings.textCase) setCase(data.settings.textCase);
      if (data.settings.financeProvider) localStorage.setItem(LS_FINANCE, data.settings.financeProvider);
      if (data.settings.model) localStorage.setItem(LS_MODEL, data.settings.model);
      if (data.settings.prompt && !data.analysts) setPrompt(data.settings.prompt);
    }
    if (data.analysts) {
      saveAnalysts(data.analysts);
      if (data.activeAnalyst) setActiveAnalystId(data.activeAnalyst);
    }
    if (data.keys) {
      if (data.keys.twitter) localStorage.setItem(LS_TW, data.keys.twitter);
      if (data.keys.anthropic) localStorage.setItem(LS_AN, data.keys.anthropic);
    }
    if (data.presets) savePresetsData(data.presets);
    if (data.accounts) { customAccounts = data.accounts; saveAccounts(); }
    if (data.loadedPresets) { loadedPresets = data.loadedPresets; saveLoadedPresets(); }
    if (data.recents) localStorage.setItem(LS_RECENTS, JSON.stringify(data.recents));
    $('twKeyInput').value = getTwKey();
    $('keyInput').value = getAnKey();
    $('financeProvider').value = getFinanceProvider();
    $('fontProvider').value = getFont();
    $('fontSizeProvider').value = getFontSize();
    $('caseProvider').value = getCase();
    renderAnalystList();
    updateKeyBtn();
    render();
    if (btn) {
      btn.textContent = 'Success';
      btn.style.color = 'var(--green)';
      setTimeout(() => { btn.textContent = 'Import'; btn.style.color = ''; }, 1500);
    }
  } catch (err) {
    console.warn('Import failed:', err);
    if (btn) {
      const msg = err.message.includes('clipboard') ? 'Clipboard error' : 'Invalid backup';
      btn.textContent = msg;
      btn.style.color = 'var(--red)';
      setTimeout(() => { btn.textContent = 'Import'; btn.style.color = ''; }, 2000);
    }
  }
}
function updateKeyBtn() {
  const ok = bothKeys();
  $('keyBtn').classList.toggle('warn', !ok);
  $('keyBtn').textContent = 'Settings';
}

// --- Accounts ---
function add(h) {
  const c = h.trim().replace(/^@/, '').toLowerCase();
  if (c && !customAccounts.includes(c)) customAccounts.push(c);
  $('acctInput').value = '';
  $('addBtn').classList.remove('vis');
  saveAccounts();
  render();
  $('acctInput').focus();
}
function rmCustom(h) {
  customAccounts = customAccounts.filter(a => a !== h);
  saveAccounts();
  render();
}

// --- Render helpers ---
function render() { renderPresets(); renderSuggested(); renderRanges(); }

function renderSuggested() {
  const el = $('suggested');
  const recents = getRecents();
  if (!recents.length) { el.innerHTML = ''; return; }
  const allAccounts = getAllAccounts();
  el.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'sug-label';
  label.textContent = 'recents ·';
  el.appendChild(label);
  recents.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug' + (allAccounts.includes(s) ? ' used' : '');
    b.textContent = s;
    if (!allAccounts.includes(s)) b.addEventListener('click', () => add(s));
    el.appendChild(b);
  });
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.textContent = '×';
  clearBtn.addEventListener('click', clearRecents);
  el.appendChild(clearBtn);
}

function renderRanges() {
  const row = $('rangesRow');
  let h = '';
  RANGES.forEach((r, i) => {
    const on = range === i ? ' on' : '';
    h += `<button class="rng${on}" onclick="range=${i};renderRanges();">${r.label}</button>`;
  });
  h += `<div class="scan-btns">`;
  if (busy) {
    h += `<button class="cancel-btn" onclick="abortCurrentScan(); setLoading(false); setStatus('Scan cancelled');">Cancel</button>`;
  }
  h += `<button class="scan-btn"${busy ? ' disabled' : ''} onclick="run()">${busy ? 'Scanning...' : 'Scan'}</button>`;
  h += `</div>`;
  row.innerHTML = h;
}

function clearAllAccounts() {
  customAccounts = [];
  loadedPresets = [];
  saveAccounts();
  saveLoadedPresets();
  render();
}

function setLoading(v) {
  busy = v;
  $('dot').classList.toggle('loading', v);
  renderRanges();
}
function setStatus(t, animate = false, showDownload = false) {
  const el = $('tweetCount');
  if (!t) { el.innerHTML = ''; return; }
  const dl = showDownload ? `<button class="dl-btn" onclick="downloadLastScan()">↓ <span class="hide-mobile">Download</span></button>` : '';
  el.innerHTML = `<div class="tweet-count">${t}${animate ? '<span class="dots"></span>' : ''}${dl}</div>`;
}

// ============================================================================
// TWITTER API
// ============================================================================

function getCacheKey(account, days) {
  const hour = Math.floor(Date.now() / 3600000);
  return `${account}:${days}:${hour}`;
}

async function fetchTweetsWithRetry(account, days, maxRetries = 3, signal = null) {
  const cacheKey = getCacheKey(account, days);
  if (tweetCache.has(cacheKey)) {
    console.log(`[${account}] Using cached tweets`);
    return tweetCache.get(cacheKey);
  }
  const key = getTwKey();
  if (!key) throw new Error('No Twitter API key configured. Add it in Settings.');
  const cutoff = new Date(Date.now() - days * 86400000);
  console.log(`[${account}] Fetching tweets since ${cutoff.toISOString()} (${days} days)`);
  const allTweets = [];
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 5;
  let consecutiveErrors = 0;
  while (pages < MAX_PAGES) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const params = new URLSearchParams({ userName: account });
    if (cursor) params.set('cursor', cursor);
    const targetUrl = `https://api.twitterapi.io/twitter/user/last_tweets?${params}`;
    const fetchUrl = CORS_PROXY + encodeURIComponent(targetUrl);
    let res, data;
    let pageRetries = 0;
    while (pageRetries <= maxRetries) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      try {
        res = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'X-API-Key': key, 'Accept': 'application/json' },
          signal,
        });
        if (res.status === 401 || res.status === 403) {
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API auth error: ${body.slice(0, 100) || 'invalid key'}`);
        }
        if (res.status === 429) {
          const waitMs = backoffDelay(pageRetries, 5000, 30000);
          console.log(`[${account}] Rate limited, waiting ${Math.ceil(waitMs/1000)}s...`);
          await new Promise(r => setTimeout(r, waitMs));
          pageRetries++;
          continue;
        }
        if (!res.ok) {
          if (pageRetries < maxRetries) {
            await new Promise(r => setTimeout(r, backoffDelay(pageRetries, 1000, 10000)));
            pageRetries++;
            continue;
          }
          const body = await res.text().catch(() => '');
          throw new Error(`Twitter API error ${res.status}: ${body.slice(0, 100) || res.statusText}`);
        }
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn(`[${account}] Invalid JSON response, retrying...`);
          if (pageRetries < maxRetries) { pageRetries++; continue; }
          throw new Error('Invalid JSON from Twitter API');
        }
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (e.message.includes('auth error') || e.message.includes('No Twitter API')) throw e;
        if (pageRetries >= maxRetries) throw e;
        console.warn(`[${account}] Fetch error, retrying:`, e.message);
        await new Promise(r => setTimeout(r, backoffDelay(pageRetries, 1000, 10000)));
        pageRetries++;
      }
    }
    const apiData = data.data || data;
    if (data.status === 'error' || (data.status !== 'success' && data.message)) {
      consecutiveErrors++;
      if (consecutiveErrors >= 2) { console.warn(`[${account}] Multiple consecutive errors, stopping`); break; }
      continue;
    }
    consecutiveErrors = 0;
    const tweets = apiData.tweets || [];
    if (!tweets.length) { console.log(`[${account}] No more tweets`); break; }
    let hitCutoff = false;
    for (const tw of tweets) {
      const created = new Date(tw.createdAt);
      if (created < cutoff) { hitCutoff = true; break; }
      allTweets.push(tw);
    }
    if (hitCutoff) break;
    if (!apiData.has_next_page || !apiData.next_cursor) break;
    cursor = apiData.next_cursor;
    pages++;
    await new Promise(r => setTimeout(r, 100));
  }
  if (allTweets.length > 0) {
    tweetCache.set(cacheKey, allTweets);
    console.log(`[${account}] Cached ${allTweets.length} tweets`);
  }
  return allTweets;
}

async function fetchTweets(account, days) {
  return fetchTweetsWithRetry(account, days);
}

// ============================================================================
// TEXT SANITIZATION & JSON PARSING
// ============================================================================

function sanitizeText(str) {
  if (!str) return '';
  if (typeof str !== 'string') return String(str);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x08) || code === 0x0B || code === 0x0C || 
        (code >= 0x0E && code <= 0x1F) || code === 0x7F || code === 0xFFFD) continue;
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { result += str[i] + str[i + 1]; i++; }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      continue;
    } else {
      result += str[i];
    }
  }
  return result;
}

function safeParseSignals(text) {
  if (!text) return [];
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrayMatch) { console.warn('No JSON array found in response'); return []; }
  let jsonStr = arrayMatch[0];
  try {
    const result = JSON.parse(jsonStr);
    if (Array.isArray(result)) return result;
  } catch (e) { console.warn('Direct JSON parse failed, attempting fixes...'); }
  try {
    jsonStr = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/([^\\])\\n(?=")/g, '$1\\\\n');
    const result = JSON.parse(jsonStr);
    if (Array.isArray(result)) return result;
  } catch (e) { console.warn('Fixed JSON parse failed:', e.message); }
  try {
    jsonStr = sanitizeText(jsonStr);
    const result = JSON.parse(jsonStr);
    if (Array.isArray(result)) return result;
  } catch (e) { console.error('All JSON parse attempts failed:', e.message); }
  return [];
}

function getTweetUrl(tw) {
  return tw.url || `https://x.com/i/status/${tw.id}`;
}

function getTweetImageUrl(tw) {
  const media = tw.extendedEntities?.media || tw.entities?.media || tw.media || [];
  for (const m of media) {
    if (m.type === 'photo' || m.type === 'image') {
      return m.media_url_https || m.url || null;
    }
  }
  return null;
}

function formatTweetForAnalysis(tw) {
  const date = new Date(tw.createdAt).toISOString().slice(0, 16).replace('T', ' ');
  const engagement = `${tw.likeCount || 0}♥ ${tw.retweetCount || 0}↻ ${tw.viewCount || 0}👁`;
  const url = getTweetUrl(tw);
  let text = sanitizeText(tw.text || '');
  const externalLinks = [];
  if (tw.entities?.urls) {
    for (const u of tw.entities.urls) {
      if (u.url && u.expanded_url) {
        const expandedUrl = sanitizeText(u.expanded_url);
        text = text.replace(u.url, expandedUrl);
        if (!expandedUrl.match(/^https?:\/\/(twitter\.com|x\.com|t\.co)\//)) {
          externalLinks.push(expandedUrl);
        }
      }
    }
  }
  const parts = [`[${date}] ${text}`, `engagement: ${engagement}`, `tweet_url: ${url}`];
  if (externalLinks.length) parts.push(`external_links: ${externalLinks.join(', ')}`);
  if (tw.isReply) parts.push(`(reply to @${tw.inReplyToUsername || 'unknown'})`);
  if (tw.quoted_tweet) {
    const quotedText = sanitizeText(tw.quoted_tweet.text || '');
    const quotedAuthor = tw.quoted_tweet.author?.userName || 'unknown';
    parts.push(`--- QUOTED TWEET from @${quotedAuthor} ---\n${quotedText}\n--- END QUOTED TWEET ---`);
  }
  return parts.join('\n');
}

// ============================================================================
// ANTHROPIC API
// ============================================================================

const API_CONFIG = {
  anthropic: { baseUrl: 'https://api.anthropic.com/v1/messages', maxRetries: 5, baseDelay: 2000, maxDelay: 120000, jitterFactor: 0.3 }
};

function backoffDelay(attempt, baseDelay = 2000, maxDelay = 60000, jitter = 0.3) {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitterAmount = exponentialDelay * jitter * Math.random();
  return exponentialDelay + jitterAmount;
}

function updateStatus(msg, animate = false) {
  const el = document.getElementById('tweetCount');
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="tweet-count">${msg}${animate ? '<span class="dots"></span>' : ''}</div>`;
}

function categorizeError(error, status) {
  if (status === 429 || status === 529) return 'rate_limit';
  if (error?.type === 'overloaded_error') return 'overloaded';
  if (error?.type === 'rate_limit_error') return 'rate_limit';
  if (error?.message?.includes('credit balance')) return 'billing';
  if (error?.message?.includes('billing')) return 'billing';
  if (error?.message?.includes('quota')) return 'quota';
  if (error?.message?.includes('rate')) return 'rate_limit';
  if (error?.message?.includes('limit')) return 'rate_limit';
  if (error?.message?.includes('prompt is too long')) return 'input_too_large';
  if (error?.type === 'not_found_error') return 'model_not_found';
  if (error?.type === 'authentication_error') return 'auth_error';
  if (error?.type === 'invalid_request_error') return 'invalid_request';
  return 'unknown';
}

async function anthropicCall(body, maxRetries = API_CONFIG.anthropic.maxRetries, signal = null) {
  const key = getAnKey();
  if (!key) throw new Error('No Anthropic API key configured. Add it in Settings.');
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    try {
      const res = await fetch(API_CONFIG.anthropic.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal,
      });
      const data = await res.json();
      if (!data.error) {
        if (attempt > 0) console.log(`✓ Anthropic succeeded on attempt ${attempt + 1}`);
        return data;
      }
      const errorType = categorizeError(data.error, res.status);
      console.warn(`Anthropic error (attempt ${attempt + 1}/${maxRetries + 1}):`, errorType, data.error?.message);
      if (['input_too_large', 'model_not_found', 'auth_error', 'invalid_request', 'billing'].includes(errorType)) {
        const messages = {
          input_too_large: 'Input too large. Try fewer accounts or a shorter time range.',
          model_not_found: 'Model not available. Your API key may not have access to this model.',
          auth_error: 'Invalid API key. Please check your Anthropic API key in Settings.',
          invalid_request: data.error?.message || 'Invalid request to Anthropic API.',
          billing: 'Credit balance too low. <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener noreferrer">Add credits →</a>',
        };
        throw new Error(messages[errorType] || data.error?.message);
      }
      if (['rate_limit', 'overloaded', 'quota'].includes(errorType)) {
        if (attempt >= maxRetries) {
          throw new Error(`API rate limited after ${maxRetries + 1} attempts. Please wait a few minutes and try again.`);
        }
        const baseWait = errorType === 'quota' ? 45000 : 15000;
        const waitMs = backoffDelay(attempt, baseWait, API_CONFIG.anthropic.maxDelay);
        const waitSecs = Math.ceil(waitMs / 1000);
        updateStatus(`Rate limited · Retry ${attempt + 2}/${maxRetries + 1} in ${waitSecs}s`, true);
        console.log(`Waiting ${waitSecs}s before retry...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      lastError = data.error;
      if (attempt < maxRetries) {
        const waitMs = backoffDelay(attempt, 2000, 30000);
        await new Promise(r => setTimeout(r, waitMs));
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.message.includes('No Anthropic') || e.message.includes('Invalid API') || 
          e.message.includes('Input too large') || e.message.includes('Model not available')) {
        throw e;
      }
      lastError = e;
      console.warn(`Anthropic fetch error (attempt ${attempt + 1}):`, e.message);
      if (attempt < maxRetries) {
        const waitMs = backoffDelay(attempt, 3000, 30000);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw new Error(lastError?.message || 'Failed to connect to Anthropic API after multiple attempts.');
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
}

// ============================================================================
// SCAN ENGINE
// ============================================================================

let currentScanAbort = null;

function abortCurrentScan() {
  if (currentScanAbort) {
    currentScanAbort.abort();
    currentScanAbort = null;
  }
}

async function fetchAllTweets(accounts, days, onProgress, signal) {
  const BATCH_SIZE = 3;
  const accountTweets = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const batch = accounts.slice(i, i + BATCH_SIZE);
    onProgress?.(`Fetching ${i + 1}-${Math.min(i + batch.length, accounts.length)} of ${accounts.length}`);
    const results = await Promise.all(batch.map(async (account) => {
      if (signal?.aborted) return { account, tweets: [], error: 'Cancelled' };
      try {
        const tweets = await fetchTweetsWithRetry(account, days, 3, signal);
        return { account, tweets, error: null };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn(`[${account}] Fetch failed:`, e.message);
        return { account, tweets: [], error: e.message };
      }
    }));
    accountTweets.push(...results);
    if (i + BATCH_SIZE < accounts.length) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  return accountTweets;
}

const ANALYSIS_CONCURRENCY = 3;
const MAX_BATCH_CHARS = 640000;
const MAX_BATCH_CHARS_WITH_IMAGES = 400000;
const MAX_IMAGES_PER_BATCH = 5;
const BATCH_SEPARATOR = '\n\n======\n\n';

function buildBatches(accountData, promptChars) {
  const items = accountData.map(a => {
    const header = `=== @${a.account} (${a.tweets.length} tweets) ===`;
    const body = a.tweets.map(formatTweetForAnalysis).join('\n---\n');
    const accountText = `${header}\n${body}`;
    const tweetUrls = a.tweets.map(getTweetUrl).filter(Boolean);
    const imageUrls = a.tweets.map(getTweetImageUrl).filter(Boolean);
    return { account: a.account, text: accountText, size: accountText.length, tweetUrls, imageUrls };
  });
  const hasAnyImages = items.some(i => i.imageUrls.length > 0);
  const maxChars = hasAnyImages ? MAX_BATCH_CHARS_WITH_IMAGES : MAX_BATCH_CHARS;
  items.sort((a, b) => b.size - a.size);
  const batches = [];
  items.forEach(item => {
    let placed = false;
    for (const batch of batches) {
      const extra = (batch.items.length ? BATCH_SEPARATOR.length : 0) + item.size;
      if (batch.size + extra <= maxChars) {
        batch.items.push(item);
        batch.size += extra;
        batch.tweetUrls.push(...item.tweetUrls);
        batch.imageUrls.push(...item.imageUrls);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push({ items: [item], size: promptChars + item.size, tweetUrls: [...item.tweetUrls], imageUrls: [...item.imageUrls] });
    }
  });
  return batches.map(b => ({
    text: b.items.map(i => i.text).join(BATCH_SEPARATOR),
    tweetUrls: [...new Set(b.tweetUrls)],
    imageUrls: [...new Set(b.imageUrls)].slice(0, MAX_IMAGES_PER_BATCH),
    accounts: b.items.map(i => i.account),
    size: b.size,
  }));
}

function groupSignalsByTweet(signals) {
  const map = new Map();
  signals.forEach(s => {
    const url = s.tweet_url;
    if (!url) return;
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(s);
  });
  return map;
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter(s => {
    // Primary key: tweet_url (uniquely identifies a tweet)
    // Fallback: title+summary for signals without tweet_url
    const key = s.tweet_url || `${s.title || ''}|${s.summary || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function analyzeWithBatching(accountData, totalTweets, onProgress, promptHash, cache, signal = null) {
  const prompt = getPrompt();
  const promptChars = prompt.length;
  const batches = buildBatches(accountData, promptChars);
  console.log(`Analysis batches: ${batches.length} (${accountData.length} accounts)`);
  if (!batches.length) return [];
  const allSignals = [];
  const results = [];
  let nextIndex = 0;
  const concurrency = Math.min(ANALYSIS_CONCURRENCY, batches.length);
  async function runBatchWorker() {
    while (true) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const i = nextIndex++;
      if (i >= batches.length) break;
      const batch = batches[i];
      const batchNum = i + 1;
      if (batches.length > 1) {
        onProgress?.(`Analyzing batch ${batchNum}/${batches.length}`);
      } else {
        onProgress?.(`${totalTweets} tweets fetched · Analyzing`);
      }
      const textContent = sanitizeText(`${prompt}\n\n${batch.text}`);
      let messageContent;
      if (batch.imageUrls && batch.imageUrls.length > 0) {
        messageContent = [
          { type: 'text', text: textContent },
          ...batch.imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } }))
        ];
      } else {
        messageContent = textContent;
      }
      try {
        const data = await anthropicCall({ model: getModel(), max_tokens: 16384, messages: [{ role: 'user', content: messageContent }] }, 5, signal);
        const txt = extractText(data.content);
        logs.push({ a: `_batch${batchNum}`, len: txt.length, pre: txt.slice(0, 400) });
        const batchSignals = safeParseSignals(txt);
        if (batchSignals.length > 0) {
          console.log(`Batch ${batchNum}: ${batchSignals.length} signals parsed`);
        } else {
          console.warn(`Batch ${batchNum}: No signals extracted`);
          logs.push({ a: `_parse_warn_${batchNum}`, len: 0, pre: 'No signals extracted from response' });
        }
        results.push({ i, signals: batchSignals, tweetUrls: batch.tweetUrls });
        // Cache this batch's results immediately so progress survives a refresh
        const grouped = groupSignalsByTweet(batchSignals);
        batch.tweetUrls.forEach(url => {
          setCachedSignals(cache, promptHash, url, grouped.get(url) || []);
        });
        saveAnalysisCache(cache);
      } catch (e) {
        console.error(`Batch ${batchNum} analysis error:`, e);
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runBatchWorker()));
  results.sort((a, b) => a.i - b.i);
  results.forEach(res => {
    allSignals.push(...res.signals);
    const grouped = groupSignalsByTweet(res.signals);
    res.tweetUrls.forEach(url => {
      setCachedSignals(cache, promptHash, url, grouped.get(url) || []);
    });
  });
  // Persist cache incrementally so partial progress survives a page refresh
  saveAnalysisCache(cache);
  return allSignals;
}

let lastRunTime = 0;
async function run() {
  const now = Date.now();
  if (now - lastRunTime < 1000) return;
  lastRunTime = now;
  const accounts = getAllAccounts();
  if (!accounts.length || busy) return;
  if (!bothKeys()) { openModal(); return; }
  abortCurrentScan();
  currentScanAbort = new AbortController();
  setLoading(true);
  $('notices').innerHTML = '';
  $('tweetCount').innerHTML = '';
  $('tickerBar').innerHTML = '';
  $('scanActions').innerHTML = '';
  $('filterBar').innerHTML = '';
  $('results').innerHTML = '';
  logs = [];
  if (customAccounts.length) {
    addToRecents(customAccounts);
    renderSuggested();
  }
  const days = RANGES[range].days;
  const signal = currentScanAbort?.signal;
  try {
    const accountTweets = await fetchAllTweets(accounts, days, (msg) => setStatus(msg, true), signal);
    const totalTweets = accountTweets.reduce((s, a) => s + a.tweets.length, 0);
    const fails = accountTweets.filter(a => a.error);
    for (const a of accountTweets) {
      logs.push({
        a: a.account,
        len: a.tweets.length,
        pre: a.error ? `ERROR: ${a.error}` : a.tweets.slice(0, 3).map(t => t.text?.slice(0, 100)).join(' | ') || '(no tweets in range)',
      });
    }
    if (totalTweets === 0) {
      let msg = 'no tweets found for this time range';
      if (fails.length) msg += ` — errors: ${fails.map(f => `${f.account} (${f.error})`).join(', ')}`;
      $('notices').innerHTML = `<div class="notice err">${esc(msg)}</div>`;
      setLoading(false); setStatus(''); renderDebug(); return;
    }
    const parts = [];
    if (fails.length) parts.push(`<span style="color:var(--red)">errors: ${esc(fails.map(f => f.account).join(', '))}</span>`);
    if (parts.length) $('notices').innerHTML = `<div class="notice warn">${parts.join(' · ')}</div>`;
    const accountData = accountTweets.filter(a => a.tweets.length);
    // Save pending scan so we can resume if page refreshes during analysis
    savePendingScan(accounts, days, accountTweets);
    const promptHash = getPromptHash();
    const analysisCache = loadAnalysisCache();
    let cachedSignals = [];
    let cachedTweetCount = 0;
    const uncachedAccountData = accountData.map(a => {
      const uncachedTweets = [];
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        const cached = getCachedSignals(analysisCache, promptHash, url);
        if (cached) {
          cachedTweetCount++;
          cachedSignals.push(...cached);
        } else {
          uncachedTweets.push(tw);
        }
      });
      return { account: a.account, tweets: uncachedTweets };
    }).filter(a => a.tweets.length);
    let signals = [];
    if (uncachedAccountData.length) {
      const newSignals = await analyzeWithBatching(uncachedAccountData, totalTweets, (msg) => setStatus(msg, true), promptHash, analysisCache, signal);
      signals = dedupeSignals([...cachedSignals, ...newSignals]);
    } else {
      setStatus(`${totalTweets} tweets fetched · Using cache`, false, true);
      signals = dedupeSignals(cachedSignals);
    }
    pruneCache(analysisCache);
    saveAnalysisCache(analysisCache);
    lastScanResult = {
      date: new Date().toISOString(),
      range: RANGES[range].label,
      days: RANGES[range].days,
      accounts: [...accounts],
      totalTweets,
      signals,
      rawTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets })),
    };
    saveScan(lastScanResult);
    clearPendingScan();
    
    // Update seenTweetUrls for live mode
    accountTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        seenTweetUrls.add(getTweetUrl(tw));
      });
    });
    const d = new Date();
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    setStatus(`${dateStr} · <span class="hide-mobile">${accounts.length} accounts · ${totalTweets} tweets · </span>${signals.length} signals`, false, true);
    renderTickers(signals);
    renderSignals(signals);
    renderDebug();
  } catch (e) {
    if (e.name === 'AbortError') {
      clearPendingScan();
      setStatus('Scan cancelled');
    } else {
      // Non-cancel errors: keep pending scan so user can resume after refresh
      setStatus('');
      const isTrustedHtml = e.message.includes('platform.claude.com');
      $('notices').innerHTML = `<div class="notice err">${isTrustedHtml ? e.message : esc(e.message)}</div>`;
    }
    renderDebug();
  } finally {
    setLoading(false);
    currentScanAbort = null;
  }
}

// --- Scan Storage ---
function createStorableScan(scan) {
  const tweetMeta = {};
  if (scan.rawTweets) {
    scan.rawTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        tweetMeta[url] = { text: (tw.text || '').slice(0, 500), author: a.account, time: tw.createdAt };
      });
    });
  }
  return { date: scan.date, range: scan.range, days: scan.days, accounts: scan.accounts, totalTweets: scan.totalTweets, signals: scan.signals, tweetMeta };
}

function saveScan(scan, skipHistory = false) {
  try {
    const storable = createStorableScan(scan);
    localStorage.setItem(LS_CURRENT, JSON.stringify(storable));
    if (skipHistory) return;
    const history = JSON.parse(localStorage.getItem(LS_SCANS) || '[]');
    const tweetTimes = {};
    if (scan.rawTweets) {
      scan.rawTweets.forEach(a => {
        (a.tweets || []).forEach(tw => {
          const url = getTweetUrl(tw);
          if (tw.createdAt) tweetTimes[url] = tw.createdAt;
        });
      });
    }
    const historyEntry = {
      date: scan.date,
      range: scan.range,
      accounts: scan.accounts.length,
      totalTweets: scan.totalTweets,
      signalCount: scan.signals.length,
      signals: scan.signals.map(s => ({ ...s, tweet_time: tweetTimes[s.tweet_url] || null }))
    };
    // Replace the most recent entry if it's from the same scan session (within 2 minutes)
    if (history.length > 0) {
      const prev = new Date(history[0].date).getTime();
      const curr = new Date(scan.date).getTime();
      if (Math.abs(curr - prev) < 120000) {
        history[0] = historyEntry;
      } else {
        history.unshift(historyEntry);
      }
    } else {
      history.unshift(historyEntry);
    }
    if (history.length > 5) history.pop();
    localStorage.setItem(LS_SCANS, JSON.stringify(history));
    renderHistory();
  } catch (e) {
    console.warn('Failed to save scan to localStorage:', e.message);
    try {
      localStorage.removeItem(LS_SCANS);
      localStorage.setItem(LS_CURRENT, JSON.stringify(createStorableScan(scan)));
    } catch (e2) {
      console.error('Storage quota exceeded, clearing storage');
      localStorage.removeItem(LS_CURRENT);
      localStorage.removeItem(LS_SCANS);
    }
  }
}

function loadCurrentScan() {
  const saved = localStorage.getItem(LS_CURRENT);
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return null; }
}

// --- Pending Scan (resume after refresh) ---
function savePendingScan(accounts, days, accountTweets) {
  try {
    const pending = {
      date: new Date().toISOString(),
      accounts: [...accounts],
      days,
      rangeLabel: RANGES[range].label,
      accountTweets: accountTweets.map(a => ({
        account: a.account,
        tweets: a.tweets,
        error: a.error || null,
      })),
    };
    localStorage.setItem(LS_PENDING_SCAN, JSON.stringify(pending));
  } catch (e) {
    console.warn('Failed to save pending scan:', e.message);
  }
}

function clearPendingScan() {
  localStorage.removeItem(LS_PENDING_SCAN);
}

function loadPendingScan() {
  const raw = localStorage.getItem(LS_PENDING_SCAN);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    // Expire after 1 hour — tweets would be stale
    if (Date.now() - new Date(pending.date).getTime() > 3600000) {
      clearPendingScan();
      return null;
    }
    return pending;
  } catch { clearPendingScan(); return null; }
}

async function resumeScan() {
  const pending = loadPendingScan();
  if (!pending || busy) return;
  clearPendingScan();
  $('notices').innerHTML = '';
  // Dismiss the resume banner
  const banner = document.querySelector('.resume-banner');
  if (banner) banner.remove();

  if (!bothKeys()) { openModal(); return; }
  abortCurrentScan();
  currentScanAbort = new AbortController();
  setLoading(true);
  $('tweetCount').innerHTML = '';
  $('tickerBar').innerHTML = '';
  $('scanActions').innerHTML = '';
  $('filterBar').innerHTML = '';
  $('results').innerHTML = '';
  logs = [];

  const accounts = pending.accounts;
  const accountTweets = pending.accountTweets;
  const signal = currentScanAbort?.signal;

  try {
    const totalTweets = accountTweets.reduce((s, a) => s + a.tweets.length, 0);
    const fails = accountTweets.filter(a => a.error);
    for (const a of accountTweets) {
      logs.push({
        a: a.account,
        len: a.tweets.length,
        pre: a.error ? `ERROR: ${a.error}` : a.tweets.slice(0, 3).map(t => t.text?.slice(0, 100)).join(' | ') || '(no tweets in range)',
      });
    }
    if (totalTweets === 0) {
      let msg = 'no tweets found for this time range';
      if (fails.length) msg += ` — errors: ${fails.map(f => `${f.account} (${f.error})`).join(', ')}`;
      $('notices').innerHTML = `<div class="notice err">${esc(msg)}</div>`;
      setLoading(false); setStatus(''); renderDebug(); return;
    }
    const parts = [];
    if (fails.length) parts.push(`<span style="color:var(--red)">errors: ${esc(fails.map(f => f.account).join(', '))}</span>`);
    if (parts.length) $('notices').innerHTML = `<div class="notice warn">${parts.join(' · ')}</div>`;
    const accountData = accountTweets.filter(a => a.tweets.length);
    // Save pending again in case analysis gets interrupted a second time
    savePendingScan(accounts, pending.days, accountTweets);
    const promptHash = getPromptHash();
    const analysisCache = loadAnalysisCache();
    let cachedSignals = [];
    let cachedTweetCount = 0;
    const uncachedAccountData = accountData.map(a => {
      const uncachedTweets = [];
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        const cached = getCachedSignals(analysisCache, promptHash, url);
        if (cached) {
          cachedTweetCount++;
          cachedSignals.push(...cached);
        } else {
          uncachedTweets.push(tw);
        }
      });
      return { account: a.account, tweets: uncachedTweets };
    }).filter(a => a.tweets.length);

    setStatus(`Resuming · ${totalTweets} tweets · ${cachedTweetCount} cached`, true);

    let signals = [];
    if (uncachedAccountData.length) {
      const newSignals = await analyzeWithBatching(uncachedAccountData, totalTweets, (msg) => setStatus(msg, true), promptHash, analysisCache, signal);
      signals = dedupeSignals([...cachedSignals, ...newSignals]);
    } else {
      setStatus(`${totalTweets} tweets · Using cache`, false, true);
      signals = dedupeSignals(cachedSignals);
    }
    pruneCache(analysisCache);
    saveAnalysisCache(analysisCache);
    lastScanResult = {
      date: new Date().toISOString(),
      range: pending.rangeLabel,
      days: pending.days,
      accounts: [...accounts],
      totalTweets,
      signals,
      rawTweets: accountTweets.map(a => ({ account: a.account, tweets: a.tweets })),
    };
    saveScan(lastScanResult);
    clearPendingScan();

    // Update seenTweetUrls for live mode
    accountTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        seenTweetUrls.add(getTweetUrl(tw));
      });
    });
    const d = new Date();
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    setStatus(`${dateStr} · <span class="hide-mobile">${accounts.length} accounts · ${totalTweets} tweets · </span>${signals.length} signals`, false, true);
    renderTickers(signals);
    renderSignals(signals);
    renderDebug();
  } catch (e) {
    if (e.name === 'AbortError') {
      clearPendingScan();
      setStatus('Scan cancelled');
    } else {
      setStatus('');
      const isTrustedHtml = e.message.includes('platform.claude.com');
      $('notices').innerHTML = `<div class="notice err">${isTrustedHtml ? e.message : esc(e.message)}</div>`;
    }
    renderDebug();
  } finally {
    setLoading(false);
    currentScanAbort = null;
  }
}

function dismissResumeBanner() {
  clearPendingScan();
  const banner = document.querySelector('.resume-banner');
  if (banner) banner.remove();
}

function getScanHistory() {
  return JSON.parse(localStorage.getItem(LS_SCANS) || '[]');
}

function downloadLastScan() {
  if (!lastScanResult) return;
  const tweetText = {};
  if (lastScanResult.rawTweets) {
    lastScanResult.rawTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        tweetText[url] = tw.text || '';
      });
    });
  } else if (lastScanResult.tweetMeta) {
    Object.entries(lastScanResult.tweetMeta).forEach(([url, meta]) => {
      tweetText[url] = meta.text || '';
    });
  }
  const d = new Date(lastScanResult.date);
  const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  let md = `# Trading Signals\n\n`;
  md += `**Date:** ${dateStr}\n`;
  md += `**Range:** ${lastScanResult.range}\n`;
  md += `**Accounts:** ${lastScanResult.accounts.length}\n`;
  md += `**Signals:** ${lastScanResult.signals.length}\n\n---\n\n`;
  lastScanResult.signals.forEach((s, i) => {
    const cat = normCat(s.category);
    const tickers = (s.tickers || []).map(t => `${t.symbol} (${t.action})`).join(', ');
    const tweet = tweetText[s.tweet_url] || '';
    const links = (s.links || []).length ? s.links.join(', ') : '';
    md += `## ${s.title}\n\n`;
    md += `${s.summary}\n\n`;
    if (tickers) md += `**Tickers:** ${tickers}\n`;
    md += `**Category:** ${cat}\n`;
    md += `**Source:** @${s.source}\n`;
    if (tweet) md += `**Tweet:** "${tweet}"\n`;
    if (links) md += `**Links:** ${links}\n`;
    if (i < lastScanResult.signals.length - 1) md += `\n---\n\n`;
  });
  const date = new Date(lastScanResult.date).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sentry-${date}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// PRICE FETCHING
// ============================================================================

const CRYPTO_SLUGS = {
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

const priceCache = {};
const PRICE_CACHE_TTL = 60000;

// Map common index names to Yahoo Finance symbols
const INDEX_MAP = {
  'SPX': '^GSPC', 'SP500': '^GSPC', 'SPY': 'SPY',
  'NDX': '^NDX', 'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'COMPQ': '^IXIC',
  'DJI': '^DJI', 'DJIA': '^DJI', 'DOW': '^DJI', 'DIA': 'DIA',
  'RUT': '^RUT', 'IWM': 'IWM',
  'VIX': '^VIX', 'UVXY': 'UVXY', 'VXX': 'VXX',
  'TNX': '^TNX', 'TLT': 'TLT', 'TBT': 'TBT',
  'DXY': 'DX-Y.NYB', 'UUP': 'UUP',
  'GLD': 'GLD', 'SLV': 'SLV', 'USO': 'USO', 'UNG': 'UNG',
  'XLF': 'XLF', 'XLE': 'XLE', 'XLK': 'XLK', 'XLV': 'XLV', 'XLI': 'XLI', 'XLP': 'XLP', 'XLU': 'XLU', 'XLY': 'XLY', 'XLB': 'XLB', 'XLRE': 'XLRE',
  'ARKK': 'ARKK', 'ARKG': 'ARKG', 'ARKW': 'ARKW', 'ARKF': 'ARKF',
  'SMH': 'SMH', 'SOXX': 'SOXX', 'XBI': 'XBI', 'IBB': 'IBB',
};

function normalizeSymbol(sym) {
  const clean = sym.replace(/^\$/, '').toUpperCase();
  return INDEX_MAP[clean] || clean;
}

function isCrypto(sym) {
  return !!CRYPTO_SLUGS[sym.replace(/^\$/, '').toUpperCase()];
}

function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toPrecision(3);
}

function formatChange(change) {
  const sign = change >= 0 ? '+' : '';
  return sign + change.toFixed(2) + '%';
}

function priceHtml(data) {
  if (!data || data.price == null) return '';
  const cls = data.change > 0.01 ? 'pos' : data.change < -0.01 ? 'neg' : 'neutral';
  return `<span class="ticker-change ${cls}">${formatChange(data.change)}</span>`;
}

async function fetchCryptoPrices(symbols) {
  const now = Date.now();
  const needed = symbols.filter(s => {
    const cached = priceCache[s];
    return !cached || (now - cached.ts > PRICE_CACHE_TTL);
  });
  if (!needed.length) return;
  const ids = needed.map(s => CRYPTO_SLUGS[s]).filter(Boolean);
  if (!ids.length) return;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    needed.forEach(sym => {
      const slug = CRYPTO_SLUGS[sym];
      if (data[slug]) {
        priceCache[sym] = { price: data[slug].usd, change: data[slug].usd_24h_change || 0, ts: now };
      }
    });
  } catch (e) { /* silent fail */ }
}

async function fetchStockPrice(sym, originalSym = null) {
  const cacheKey = originalSym || sym;
  const now = Date.now();
  const cached = priceCache[cacheKey];
  if (cached && (now - cached.ts < PRICE_CACHE_TTL)) return;
  try {
    const yahooSym = normalizeSymbol(sym);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2d`;
    const url = `https://proxy.sentry.is/?url=${encodeURIComponent(yahooUrl)}`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return;
    const price = result.meta?.regularMarketPrice;
    const prevClose = result.meta?.chartPreviousClose || result.meta?.previousClose;
    if (price == null) return;
    const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    priceCache[cacheKey] = { price, change, ts: now };
  } catch (e) { /* silent fail */ }
}

async function fetchAllPrices(symbols) {
  const cryptoSyms = [];
  const stockSyms = [];
  symbols.forEach(s => {
    const clean = s.replace(/^\$/, '').toUpperCase();
    if (CRYPTO_SLUGS[clean]) cryptoSyms.push(clean);
    else stockSyms.push(clean);
  });
  const promises = [];
  if (cryptoSyms.length) promises.push(fetchCryptoPrices(cryptoSyms));
  stockSyms.forEach(s => promises.push(fetchStockPrice(s, s)));
  await Promise.all(promises);
}

function tickerUrl(sym) {
  const s = sym.replace(/^\$/, '').toUpperCase();
  const provider = getFinanceProvider();
  if (provider === 'tradingview') {
    if (CRYPTO_SLUGS[s]) return `https://www.tradingview.com/chart/?symbol=${s}USDT`;
  }
  if (CRYPTO_SLUGS[s]) {
    return `https://www.coingecko.com/en/coins/${CRYPTO_SLUGS[s]}`;
  }
  if (provider === 'tradingview') {
    if (s.endsWith('.TW')) return `https://www.tradingview.com/chart/?symbol=TWSE:${s.replace('.TW', '')}`;
    if (s.endsWith('.HK')) return `https://www.tradingview.com/chart/?symbol=HKEX:${s.replace('.HK', '')}`;
    if (s.endsWith('.T')) return `https://www.tradingview.com/chart/?symbol=TSE:${s.replace('.T', '')}`;
    if (s.endsWith('.KS')) return `https://www.tradingview.com/chart/?symbol=KRX:${s.replace('.KS', '')}`;
    return `https://www.tradingview.com/chart/?symbol=${s}`;
  }
  if (provider === 'google') {
    if (s.endsWith('.TW')) return `https://www.google.com/finance/quote/${s.replace('.TW', '')}:TPE?window=6M`;
    if (s.endsWith('.HK')) return `https://www.google.com/finance/quote/${s.replace('.HK', '')}:HKG?window=6M`;
    if (s.endsWith('.T')) return `https://www.google.com/finance/quote/${s.replace('.T', '')}:TYO?window=6M`;
    if (s.endsWith('.KS')) return `https://www.google.com/finance/quote/${s.replace('.KS', '')}:KRX?window=6M`;
    return `https://www.google.com/finance/quote/${s}?window=6M`;
  }
  return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`;
}

// ============================================================================
// RENDERERS
// ============================================================================

function renderTickers(signals) {
  const map = {};
  signals.forEach(r => (r.tickers || []).forEach(t => {
    const k = (t.symbol || '').toUpperCase();
    if (!k) return;
    if (!map[k]) map[k] = { s: k, acts: new Set(), n: 0 };
    map[k].acts.add(t.action); map[k].n++;
  }));
  const list = Object.values(map).sort((a, b) => b.n - a.n);
  const el = $('tickerBar');
  if (!list.length) { el.innerHTML = ''; el.className = ''; return; }
  el.className = 'ticker-bar';
  el.innerHTML = list.map(t => {
    const hasBuy = t.acts.has('buy');
    const hasSell = t.acts.has('sell');
    const pa = (hasBuy && hasSell) ? 'mixed' : ['sell', 'buy', 'hold', 'watch'].find(a => t.acts.has(a)) || 'watch';
    const url = tickerUrl(t.s);
    const sym = t.s.replace(/^\$/, '');
    const cached = priceCache[sym];
    const priceStr = cached ? priceHtml(cached) : '';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-item" data-sym="${esc(sym)}" style="color:${ACT_C[pa]};background:${ACT_BG[pa]}">${esc(t.s)}${t.n > 1 ? `<span class="ticker-cnt">×${t.n}</span>` : ''}${priceStr}</a>`;
  }).join('');
  const symbols = list.map(t => t.s.replace(/^\$/, ''));
  fetchAllPrices(symbols).then(() => updateTickerPrices());
}

function updateTickerPrices() {
  document.querySelectorAll('.ticker-item[data-sym], .ticker-tag[data-sym]').forEach(el => {
    const sym = el.dataset.sym;
    const cached = priceCache[sym];
    if (!cached) return;
    if (el.querySelector('.ticker-change')) return;
    el.insertAdjacentHTML('beforeend', priceHtml(cached));
  });
}

function renderScanActions() {
  $('scanActions').innerHTML = '';
}

function renderSignals(signals) {
  const el = $('results');
  filters = { category: null };
  if (!signals.length) { el.innerHTML = '<div class="empty-state">No signals extracted</div>'; renderScanActions(); renderFilters(); $('footer').innerHTML = ''; return; }
  const tweetMap = {};
  if (lastScanResult?.rawTweets) {
    lastScanResult.rawTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        const url = getTweetUrl(tw);
        const date = tw.createdAt ? new Date(tw.createdAt) : null;
        const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        tweetMap[url] = { text: tw.text || '', author: tw.author?.userName || a.account || '', time: timeStr };
      });
    });
  } else if (lastScanResult?.tweetMeta) {
    Object.entries(lastScanResult.tweetMeta).forEach(([url, meta]) => {
      const date = meta.time ? new Date(meta.time) : null;
      const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      tweetMap[url] = { text: meta.text || '', author: meta.author || '', time: timeStr };
    });
  }
  let h = '';
  signals.forEach((item, i) => {
    const cat = normCat(item.category);
    const tweetInfo = item.tweet_url ? (tweetMap[item.tweet_url] || {}) : {};
    const source = (item.source || '').replace(/^@/, '');
    const time = tweetInfo.time || '';
    const tickers = (item.tickers && item.tickers.length)
      ? item.tickers.map(t => {
          const url = tickerUrl(t.symbol || '');
          const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
          const cached = priceCache[sym];
          const priceStr = cached ? priceHtml(cached) : '';
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}${priceStr}</a>`;
        }).join('')
      : '';
    const extLinks = (item.links && item.links.length)
      ? item.links.map(l => {
          try {
            const hostname = new URL(l).hostname.replace('www.','');
            return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(hostname)}</a>`;
          } catch { return ''; }
        }).filter(Boolean).join(' ')
      : '';
    const sourceLink = item.tweet_url 
      ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}">@${esc(source)}</a>`
      : `@${esc(source)}`;
    const seePost = item.tweet_url
      ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" class="see-post" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}"><span class="text">See post</span><span class="arrow">↗</span></a>`
      : '';
    const tweetExpandId = `tweet-expand-${i}`;
    const tweetExpand = tweetInfo.text ? `
      <div class="tweet-expand">
        <button class="tweet-expand-btn" onclick="toggleTweetExpand('${tweetExpandId}', this)">show tweet ▸</button>
        <div class="tweet-expand-content" id="${tweetExpandId}">
          <div class="tweet-expand-author">@${esc(source)}${time ? ` · ${time}` : ''}</div>
          ${esc(tweetInfo.text)}
        </div>
      </div>` : '';
    h += `<div class="signal" data-category="${esc(cat || '')}" data-index="${i}">
      <div class="sig-top"><span>${sourceLink}${time ? ` · ${time}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span><span style="display:flex;gap:12px;align-items:center"><button class="share-btn" onclick="shareSignal(${i})" title="Share">share</button>${seePost}</span></div>
      ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
      <div class="sig-title">${esc(item.title || '')}</div>
      <div class="sig-summary">${esc(item.summary || '')}</div>
      ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
      ${tweetExpand}
    </div>`;
  });
  el.innerHTML = h;
  renderScanActions();
  renderFilters();
  $('footer').innerHTML = 'Not financial advice';
  setupTweetTooltips();
  const allSymbols = new Set();
  signals.forEach(s => (s.tickers || []).forEach(t => {
    const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
    if (sym) allSymbols.add(sym);
  }));
  if (allSymbols.size) fetchAllPrices([...allSymbols]).then(() => updateTickerPrices());
}

function toggleTweetExpand(id, btn) {
  const content = document.getElementById(id);
  if (!content) return;
  const isOpen = content.classList.toggle('open');
  btn.textContent = isOpen ? 'hide tweet ▾' : 'show tweet ▸';
}

function setupTweetTooltips() {
  const tooltip = $('tweetTooltip');
  document.querySelectorAll('.see-post[data-tweet]').forEach(link => {
    link.addEventListener('mouseenter', e => {
      const text = link.dataset.tweet;
      if (!text) return;
      const author = link.dataset.author || '';
      const time = link.dataset.time || '';
      const header = (author || time) ? `<div style="opacity:.7;margin-bottom:8px">@${esc(author)} · ${esc(time)}</div>` : '';
      tooltip.innerHTML = header + esc(text);
      tooltip.classList.add('vis');
    });
    link.addEventListener('mousemove', e => {
      const x = e.clientX + 12;
      const y = e.clientY + 12;
      const rect = tooltip.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 20;
      const maxY = window.innerHeight - rect.height - 20;
      tooltip.style.left = Math.min(x, maxX) + 'px';
      tooltip.style.top = Math.min(y, maxY) + 'px';
    });
    link.addEventListener('mouseleave', () => {
      tooltip.classList.remove('vis');
    });
  });
}

function renderHistory() {
  const el = $('historySection');
  const history = getScanHistory();
  if (!history.length) { el.innerHTML = ''; return; }
  let h = '<div class="history">';
  history.forEach((scan, i) => {
    const d = new Date(scan.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const label = `Scan ${dateStr}`;
    const range = scan.range || '—';
    const accounts = Number.isFinite(scan.accounts) ? scan.accounts : '—';
    const tweets = Number.isFinite(scan.totalTweets) ? scan.totalTweets : '—';
    const signals = Number.isFinite(scan.signalCount) ? scan.signalCount : '—';
    const details = `Range: ${esc(range)} · Accounts: ${accounts} · Tweets: ${tweets} · Signals: ${signals}`;
    const cards = (scan.signals && scan.signals.length)
      ? scan.signals.map(item => {
          const cat = normCat(item.category);
          const tickers = (item.tickers && item.tickers.length)
            ? item.tickers.map(t => {
                const url = tickerUrl(t.symbol || '');
                const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
                const cached = priceCache[sym];
                const priceStr = cached ? priceHtml(cached) : '';
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}${priceStr}</a>`;
              }).join('')
            : '';
          const source = (item.source || '').replace(/^@/, '');
          const sourceLink = item.tweet_url
            ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer">@${esc(source)}</a>`
            : `@${esc(source)}`;
          const tweetTime = item.tweet_time ? new Date(item.tweet_time) : null;
          const timeStr = tweetTime ? tweetTime.toLocaleDateString() + ' ' + tweetTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
          const extLinks = (item.links && item.links.length)
            ? item.links.map(l => {
                try {
                  const hostname = new URL(l).hostname.replace('www.','');
                  return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(hostname)}</a>`;
                } catch { return ''; }
              }).filter(Boolean).join(' ')
            : '';
          return `<div class="signal" data-category="${esc(cat || '')}">
            <div class="sig-top"><span>${sourceLink}${timeStr ? ` · ${timeStr}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span></div>
            ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
            <div class="sig-title">${esc(item.title || '')}</div>
            <div class="sig-summary">${esc(item.summary || '')}</div>
            ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
          </div>`;
        }).join('')
      : '<div class="empty-state">No signals in this scan</div>';
    h += `<div class="hist-item" data-index="${i}">
      <div class="hist-header">
        <button class="hist-toggle" data-label="${esc(label)}">▸ ${esc(label)}</button>
        <div class="hist-actions">
          <button class="delete" title="Delete">×</button>
          <button class="download" title="Download">↓</button>
        </div>
      </div>
      <div class="hist-body"><div class="hist-meta">${details}</div><div class="hist-cards">${cards}</div></div>
    </div>`;
  });
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll('.hist-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.hist-item');
      const open = item.classList.toggle('open');
      const label = btn.dataset.label || btn.textContent.replace(/^▸\s|^▾\s/, '');
      btn.textContent = (open ? '▾ ' : '▸ ') + label;
    });
  });
  el.querySelectorAll('.hist-actions .download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.closest('.hist-item').dataset.index);
      downloadHistoryScan(index);
    });
  });
  el.querySelectorAll('.hist-actions .delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.closest('.hist-item').dataset.index);
      deleteHistoryScan(index);
    });
  });
  const allSymbols = new Set();
  history.forEach(scan => (scan.signals || []).forEach(s => (s.tickers || []).forEach(t => {
    const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
    if (sym) allSymbols.add(sym);
  })));
  if (allSymbols.size) fetchAllPrices([...allSymbols]).then(() => updateTickerPrices());
}

function downloadHistoryScan(index) {
  const history = getScanHistory();
  const scan = history[index];
  if (!scan) return;
  const d = new Date(scan.date);
  const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  let md = `# Trading Signals\n\n`;
  md += `**Date:** ${dateStr}\n`;
  md += `**Range:** ${scan.range || '—'}\n`;
  md += `**Accounts:** ${scan.accounts || '—'}\n`;
  md += `**Signals:** ${scan.signalCount || (scan.signals?.length || 0)}\n\n---\n\n`;
  (scan.signals || []).forEach((s, i) => {
    const cat = normCat(s.category);
    const tickers = (s.tickers || []).map(t => `${t.symbol} (${t.action})`).join(', ');
    const links = (s.links || []).length ? s.links.join(', ') : '';
    md += `## ${s.title}\n\n`;
    md += `${s.summary}\n\n`;
    if (tickers) md += `**Tickers:** ${tickers}\n`;
    md += `**Category:** ${cat}\n`;
    md += `**Source:** @${s.source}\n`;
    if (links) md += `**Links:** ${links}\n`;
    if (i < scan.signals.length - 1) md += `\n---\n\n`;
  });
  const date = new Date(scan.date).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sentry-${date}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function deleteHistoryScan(index) {
  const history = getScanHistory();
  if (index < 0 || index >= history.length) return;
  history.splice(index, 1);
  localStorage.setItem(LS_SCANS, JSON.stringify(history));
  renderHistory();
}

function renderDebug() {}

// --- Filters ---
function setFilter(type, value) {
  filters[type] = filters[type] === value ? null : value;
  applyFilters();
  renderFilters();
}

function applyFilters() {
  const rows = document.querySelectorAll('#results .signal');
  rows.forEach(row => {
    const cat = row.dataset.category;
    const catMatch = !filters.category || cat === filters.category;
    row.classList.toggle('hidden', !catMatch);
  });
}

function renderFilters() {
  const el = $('filterBar');
  if (!lastScanResult || !lastScanResult.signals.length) { el.innerHTML = ''; return; }
  let h = '<div class="filter-bar">';
  CATEGORIES.forEach(c => {
    const on = filters.category === c ? ' on' : '';
    h += `<button class="rng${on}" onclick="setFilter('category','${c}')">${c}</button>`;
  });
  h += '</div>';
  el.innerHTML = h;
}

// ============================================================================
// SHARING
// ============================================================================

function encodeSignal(signal) {
  const compact = {
    t: signal.title || '',
    s: signal.summary || '',
    c: signal.category || '',
    src: (signal.source || '').replace(/^@/, ''),
    tk: (signal.tickers || []).map(t => ({ s: t.symbol, a: t.action })),
    u: signal.tweet_url || '',
  };
  if (signal.links?.length) compact.ln = signal.links;
  const json = JSON.stringify(compact);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSignal(encoded) {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const compact = JSON.parse(json);
    return {
      title: compact.t || '',
      summary: compact.s || '',
      category: compact.c || '',
      source: compact.src || '',
      tickers: (compact.tk || []).map(t => ({ symbol: t.s, action: t.a })),
      tweet_url: compact.u || '',
      links: compact.ln || [],
    };
  } catch (e) {
    console.warn('Failed to decode shared signal:', e);
    return null;
  }
}

function shareSignal(index) {
  if (!lastScanResult?.signals?.[index]) return;
  const signal = lastScanResult.signals[index];
  const encoded = encodeSignal(signal);
  const url = `${location.origin}${location.pathname}#s=${encoded}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector(`.signal[data-index="${index}"] .share-btn`);
    if (btn) {
      btn.classList.add('copied');
      btn.textContent = 'copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = 'share';
      }, 1500);
    }
  }).catch(err => {
    console.warn('Failed to copy:', err);
  });
}

function checkSharedSignal() {
  const hash = location.hash;
  if (!hash.startsWith('#s=')) return false;
  const encoded = hash.slice(3);
  const signal = decodeSignal(encoded);
  if (!signal) return false;
  document.body.setAttribute('data-shared', '');
  $('sharedBanner').innerHTML = `
    <div class="shared-banner">
      <span class="shared-banner-text">shared signal</span>
      <a href="${location.pathname}">← back to sentry</a>
    </div>
  `;
  document.querySelector('.controls').style.display = 'none';
  renderSharedSignal(signal);
  return true;
}

function renderSharedSignal(signal) {
  const cat = normCat(signal.category)?.toLowerCase();
  const source = (signal.source || '').replace(/^@/, '');
  const tickers = (signal.tickers?.length)
    ? signal.tickers.map(t => {
        const url = tickerUrl(t.symbol || '');
        const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
        const cached = priceCache[sym];
        const priceStr = cached ? priceHtml(cached) : '';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}${priceStr}</a>`;
      }).join('')
    : '';
  const extLinks = (signal.links?.length)
    ? signal.links.map(l => {
        try {
          const hostname = new URL(l).hostname.replace('www.','').toLowerCase();
          return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(hostname)}</a>`;
        } catch { return ''; }
      }).filter(Boolean).join(' ')
    : '';
  const sourceLink = signal.tweet_url 
    ? `<a href="${esc(signal.tweet_url)}" target="_blank" rel="noopener noreferrer">@${esc(source)}</a>`
    : `@${esc(source)}`;
  const tooltipText = signal.summary || signal.title || '';
  const seePost = signal.tweet_url
    ? `<a href="${esc(signal.tweet_url)}" target="_blank" rel="noopener noreferrer" class="see-post" data-tweet="${esc(tooltipText)}" data-author="${esc(source)}"><span class="text">see post</span><span class="arrow">↗</span></a>`
    : '';
  const tweetExpand = tooltipText ? `
    <div class="tweet-expand">
      <button class="tweet-expand-btn" onclick="toggleTweetExpand('shared-tweet-expand', this)">show tweet ▸</button>
      <div class="tweet-expand-content" id="shared-tweet-expand">
        <div class="tweet-expand-author">@${esc(source)}</div>
        ${esc(tooltipText)}
      </div>
    </div>` : '';
  const h = `<div class="signal">
    <div class="sig-top"><span>${sourceLink}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span>${seePost}</div>
    ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
    <div class="sig-title">${esc(signal.title || '')}</div>
    <div class="sig-summary">${esc(signal.summary || '')}</div>
    ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
    ${tweetExpand}
  </div>`;
  $('results').innerHTML = h;
  $('footer').innerHTML = 'shared from <a href="' + location.pathname + '">sentry</a> · not financial advice';
  setupTweetTooltips();
  const allSymbols = (signal.tickers || []).map(t => (t.symbol || '').replace(/^\$/, '').toUpperCase()).filter(Boolean);
  if (allSymbols.length) fetchAllPrices(allSymbols).then(() => updateTickerPrices());
}

// ============================================================================
// LIVE FEED
// ============================================================================

function toggleLive() {
  if (!isLiveEnabled()) {
    openModal('data');
    return;
  }
  if (isLiveMode) {
    stopLiveFeed();
  } else {
    startLiveFeed();
  }
}

function startLiveFeed() {
  if (!hasAnyAccounts()) {
    $('notices').innerHTML = `<div class="notice warn">Add accounts to enable live mode</div>`;
    return;
  }
  if (!bothKeys()) {
    openModal();
    return;
  }
  
  isLiveMode = true;
  localStorage.setItem(LS_LIVE_MODE, 'true');
  $('liveBtn').classList.add('active');
  
  // Reset rotation state
  liveAccountIndex = 0;
  liveAccountLastCheck = {};
  
  // Initialize seen tweets from current scan and signals
  if (lastScanResult?.rawTweets) {
    lastScanResult.rawTweets.forEach(a => {
      (a.tweets || []).forEach(tw => {
        seenTweetUrls.add(getTweetUrl(tw));
      });
    });
  }
  if (lastScanResult?.signals) {
    lastScanResult.signals.forEach(s => {
      if (s.tweet_url) seenTweetUrls.add(s.tweet_url);
    });
  }
  if (lastScanResult?.tweetMeta) {
    Object.keys(lastScanResult.tweetMeta).forEach(url => {
      seenTweetUrls.add(url);
    });
  }
  
  // Cap seen URLs to prevent memory bloat
  if (seenTweetUrls.size > 2000) {
    const arr = [...seenTweetUrls];
    seenTweetUrls = new Set(arr.slice(-1000));
  }
  
  lastLiveCheck = Date.now();
  
  // Start polling
  pollForNewTweets();
  liveInterval = setInterval(pollForNewTweets, LIVE_POLL_INTERVAL);
  
  // Pause when tab is hidden
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  console.log('✓ Live feed started');
}

function stopLiveFeed() {
  isLiveMode = false;
  localStorage.removeItem(LS_LIVE_MODE);
  $('liveBtn').classList.remove('active');
  
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
  
  if (livePollAbort) {
    livePollAbort.abort();
    livePollAbort = null;
  }
  
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  
  console.log('✓ Live feed stopped');
}

function handleVisibilityChange() {
  if (!isLiveMode) return;
  
  if (document.hidden) {
    // Pause polling when tab is hidden
    if (liveInterval) {
      clearInterval(liveInterval);
      liveInterval = null;
    }
    console.log('Live feed paused (tab hidden)');
  } else {
    // Resume polling when tab is visible
    if (!liveInterval) {
      pollForNewTweets();
      liveInterval = setInterval(pollForNewTweets, LIVE_POLL_INTERVAL);
      console.log('Live feed resumed');
    }
  }
}


async function pollForNewTweets() {
  if (!isLiveMode || busy) return;
  
  const allAccounts = getAllAccounts();
  if (!allAccounts.length) {
    stopLiveFeed();
    return;
  }
  
  livePollAbort = new AbortController();
  const signal = livePollAbort.signal;
  
  try {
    const now = Date.now();
    const lookbackDays = LIVE_LOOKBACK_MINUTES / 1440; // Convert minutes to days
    const cutoff = new Date(now - LIVE_LOOKBACK_MINUTES * 60000);
    
    // Select accounts to check this poll (rotate through + prioritize active ones)
    const accountsToCheck = selectAccountsForPoll(allAccounts, now);
    
    if (!accountsToCheck.length) {
      console.log('[Live] All accounts on cooldown, skipping poll');
      return;
    }
    
    console.log(`[Live] Checking ${accountsToCheck.length}/${allAccounts.length} accounts`);
    
    const allNewTweets = [];
    
    // Fetch accounts sequentially to minimize API pressure
    for (const account of accountsToCheck) {
      if (signal?.aborted || !isLiveMode) break;
      
      try {
        const tweets = await fetchTweetsWithRetry(account, lookbackDays, 2, signal);
        
        // Filter to only truly new tweets
        const newTweets = tweets.filter(tw => {
          const url = getTweetUrl(tw);
          const created = new Date(tw.createdAt);
          return created >= cutoff && !seenTweetUrls.has(url);
        }).map(tw => ({ ...tw, _account: account }));
        
        // Track this account's activity for smart rotation
        liveAccountLastCheck[account] = {
          time: now,
          hadContent: newTweets.length > 0
        };
        
        allNewTweets.push(...newTweets);
        
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn(`[Live] Error fetching @${account}:`, e.message);
      }
      
      // Small delay between accounts
      if (!signal?.aborted) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    lastLiveCheck = now;
    
    // Remove "new" badges from previous poll
    document.querySelectorAll('.signal .new-badge').forEach(el => el.remove());
    
    if (allNewTweets.length === 0) {
      console.log('[Live] No new tweets');
      return;
    }
    
    console.log(`[Live] Found ${allNewTweets.length} new tweets`);
    
    // Mark these tweets as seen
    allNewTweets.forEach(tw => seenTweetUrls.add(getTweetUrl(tw)));
    
    // Analyze the new tweets
    const newSignals = await analyzeLiveTweets(allNewTweets, signal);
    
    if (newSignals.length > 0) {
      console.log(`[Live] ${newSignals.length} new signals extracted`);
      prependSignals(newSignals, allNewTweets);
    }
    
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('[Live] Poll cancelled');
    } else {
      console.error('[Live] Poll error:', e);
    }
  } finally {
    livePollAbort = null;
  }
}

function selectAccountsForPoll(allAccounts, now) {
  // Prioritize accounts that:
  // 1. Haven't been checked recently
  // 2. Had content last time they were checked
  
  const scored = allAccounts.map(account => {
    const last = liveAccountLastCheck[account];
    if (!last) {
      // Never checked - high priority
      return { account, score: 1000 };
    }
    
    const timeSince = now - last.time;
    
    // If account had no content and was checked recently, skip it (cooldown)
    if (!last.hadContent && timeSince < LIVE_ACCOUNT_COOLDOWN) {
      return { account, score: -1 };
    }
    
    // Score based on time since last check (higher = longer ago = more priority)
    // Accounts that had content get a bonus
    let score = timeSince / 1000;
    if (last.hadContent) score += 500;
    
    return { account, score };
  });
  
  // Filter out accounts on cooldown, sort by score, take top N
  return scored
    .filter(s => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIVE_ACCOUNTS_PER_POLL)
    .map(s => s.account);
}

async function analyzeLiveTweets(tweets, signal) {
  if (!tweets.length) return [];
  
  const prompt = getPrompt();
  const promptHash = getPromptHash();
  const cache = loadAnalysisCache();
  
  // Group tweets by account for analysis
  const byAccount = {};
  tweets.forEach(tw => {
    const acc = tw._account || tw.author?.userName || 'unknown';
    if (!byAccount[acc]) byAccount[acc] = [];
    byAccount[acc].push(tw);
  });
  
  // Check cache first
  const cachedSignals = [];
  const uncachedTweets = [];
  
  tweets.forEach(tw => {
    const url = getTweetUrl(tw);
    const cached = getCachedSignals(cache, promptHash, url);
    if (cached) {
      cachedSignals.push(...cached);
    } else {
      uncachedTweets.push(tw);
    }
  });
  
  if (!uncachedTweets.length) {
    return cachedSignals;
  }
  
  // Build a small batch for analysis
  const accountData = Object.entries(byAccount)
    .filter(([_, tweets]) => tweets.some(tw => !getCachedSignals(cache, promptHash, getTweetUrl(tw))))
    .map(([account, tweets]) => ({
      account,
      tweets: tweets.filter(tw => !getCachedSignals(cache, promptHash, getTweetUrl(tw)))
    }))
    .filter(a => a.tweets.length > 0);
  
  if (!accountData.length) return cachedSignals;
  
  try {
    // Build the text content
    const textParts = accountData.map(a => {
      const header = `=== @${a.account} (${a.tweets.length} tweets) ===`;
      const body = a.tweets.map(formatTweetForAnalysis).join('\n---\n');
      return `${header}\n${body}`;
    });
    
    const fullText = `${prompt}\n\n${textParts.join('\n\n======\n\n')}`;
    const tweetUrls = accountData.flatMap(a => a.tweets.map(getTweetUrl));
    
    // Get images if any
    const imageUrls = accountData.flatMap(a => a.tweets.map(getTweetImageUrl)).filter(Boolean).slice(0, 3);
    
    let messageContent;
    if (imageUrls.length > 0) {
      messageContent = [
        { type: 'text', text: sanitizeText(fullText) },
        ...imageUrls.map(url => ({ type: 'image', source: { type: 'url', url } }))
      ];
    } else {
      messageContent = sanitizeText(fullText);
    }
    
    const data = await anthropicCall(
      { model: getModel(), max_tokens: 8192, messages: [{ role: 'user', content: messageContent }] },
      3,
      signal
    );
    
    const txt = extractText(data.content);
    const newSignals = safeParseSignals(txt);
    
    // Cache the results
    const grouped = groupSignalsByTweet(newSignals);
    tweetUrls.forEach(url => {
      setCachedSignals(cache, promptHash, url, grouped.get(url) || []);
    });
    saveAnalysisCache(cache);
    
    return [...cachedSignals, ...newSignals];
    
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.error('[Live] Analysis error:', e);
    return cachedSignals;
  }
}

function prependSignals(newSignals, newTweets) {
  if (!newSignals.length) return;
  
  // Dedupe against existing signals
  const knownUrls = new Set();
  const knownKeys = new Set();
  if (lastScanResult?.signals) {
    lastScanResult.signals.forEach(s => {
      if (s.tweet_url) knownUrls.add(s.tweet_url);
      knownKeys.add(`${s.tweet_url || ''}|${s.title || ''}|${s.summary || ''}`);
    });
  }
  
  newSignals = newSignals.filter(s => {
    const key = `${s.tweet_url || ''}|${s.title || ''}|${s.summary || ''}`;
    if (knownKeys.has(key)) return false;
    if (s.tweet_url && knownUrls.has(s.tweet_url)) return false;
    knownKeys.add(key);
    return true;
  });
  
  if (!newSignals.length) {
    console.log('[Live] All signals were duplicates, skipping');
    return;
  }
  
  // Build tweet map for the new tweets
  const tweetMap = {};
  newTweets.forEach(tw => {
    const url = getTweetUrl(tw);
    const date = tw.createdAt ? new Date(tw.createdAt) : null;
    const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
    tweetMap[url] = { text: tw.text || '', author: tw._account || tw.author?.userName || '', time: timeStr };
  });
  
  // Filter out duplicates (signals for tweets we already have)
  const existingUrls = new Set((lastScanResult?.signals || []).map(s => s.tweet_url).filter(Boolean));
  const uniqueNewSignals = newSignals.filter(s => !s.tweet_url || !existingUrls.has(s.tweet_url));
  if (!uniqueNewSignals.length) return;
  
  // Update lastScanResult
  if (lastScanResult) {
    lastScanResult.signals = dedupeSignals([...uniqueNewSignals, ...lastScanResult.signals]);
    lastScanResult.totalTweets += newTweets.length;
    
    // Add to rawTweets
    newTweets.forEach(tw => {
      const account = tw._account || tw.author?.userName || 'unknown';
      let found = lastScanResult.rawTweets?.find(a => a.account === account);
      if (found) {
        found.tweets = [tw, ...found.tweets];
      } else if (lastScanResult.rawTweets) {
        lastScanResult.rawTweets.push({ account, tweets: [tw] });
      }
    });
    
    // Update tweetMeta
    if (!lastScanResult.tweetMeta) lastScanResult.tweetMeta = {};
    Object.assign(lastScanResult.tweetMeta, tweetMap);
    
    // Save but don't add to history (live updates shouldn't create new history entries)
    saveScan(lastScanResult, true);
  }
  
  // Prepend to the UI
  const resultsEl = $('results');
  const startIndex = lastScanResult ? lastScanResult.signals.indexOf(uniqueNewSignals[0]) : 0;
  
  uniqueNewSignals.forEach((item, i) => {
    const index = startIndex + i;
    const cat = normCat(item.category);
    const tweetInfo = item.tweet_url ? (tweetMap[item.tweet_url] || lastScanResult?.tweetMeta?.[item.tweet_url] || {}) : {};
    const source = (item.source || '').replace(/^@/, '');
    const time = tweetInfo.time || '';
    
    const tickers = (item.tickers && item.tickers.length)
      ? item.tickers.map(t => {
          const url = tickerUrl(t.symbol || '');
          const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
          const cached = priceCache[sym];
          const priceStr = cached ? priceHtml(cached) : '';
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}${priceStr}</a>`;
        }).join('')
      : '';
    
    const extLinks = (item.links && item.links.length)
      ? item.links.map(l => {
          try {
            const hostname = new URL(l).hostname.replace('www.','');
            return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(hostname)}</a>`;
          } catch { return ''; }
        }).filter(Boolean).join(' ')
      : '';
    
    const sourceLink = item.tweet_url 
      ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}">@${esc(source)}</a>`
      : `@${esc(source)}`;
    
    const seePost = item.tweet_url
      ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" class="see-post" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}"><span class="text">See post</span><span class="arrow">↗</span></a>`
      : '';
    
    const tweetExpandId = `tweet-expand-live-${Date.now()}-${i}`;
    const tweetExpand = tweetInfo.text ? `
      <div class="tweet-expand">
        <button class="tweet-expand-btn" onclick="toggleTweetExpand('${tweetExpandId}', this)">show tweet ▸</button>
        <div class="tweet-expand-content" id="${tweetExpandId}">
          <div class="tweet-expand-author">@${esc(source)}${time ? ` · ${time}` : ''}</div>
          ${esc(tweetInfo.text)}
        </div>
      </div>` : '';
    
    const html = `<div class="signal new" data-category="${esc(cat || '')}" data-index="${index}">
      <div class="sig-top"><span><span class="new-badge">new</span>${sourceLink}${time ? ` · ${time}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span><span style="display:flex;gap:12px;align-items:center"><button class="share-btn" onclick="shareSignal(${index})" title="Share">share</button>${seePost}</span></div>
      ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
      <div class="sig-title">${esc(item.title || '')}</div>
      <div class="sig-summary">${esc(item.summary || '')}</div>
      ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
      ${tweetExpand}
    </div>`;
    
    resultsEl.insertAdjacentHTML('afterbegin', html);
  });
  
  // Update ticker bar with new tickers
  if (lastScanResult?.signals) {
    renderTickers(lastScanResult.signals);
  }
  
  // Update status line
  if (lastScanResult) {
    const d = new Date();
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    setStatus(`${dateStr} · <span class="hide-mobile">${lastScanResult.accounts.length} accounts · ${lastScanResult.totalTweets} tweets · </span>${lastScanResult.signals.length} signals`, false, true);
  }
  
  // Setup tooltips for new elements
  setupTweetTooltips();
  
  // Fetch prices for new tickers
  const newSymbols = new Set();
  newSignals.forEach(s => (s.tickers || []).forEach(t => {
    const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
    if (sym) newSymbols.add(sym);
  }));
  if (newSymbols.size) fetchAllPrices([...newSymbols]).then(() => updateTickerPrices());
  
  // Remove the "new" class after animation
  setTimeout(() => {
    document.querySelectorAll('.signal.new').forEach(el => {
      el.classList.remove('new');
    });
  }, 3000);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initEventListeners() {
  // Preset modal events
  let presetModalMouseDownTarget = null;
  $('presetModal').addEventListener('mousedown', e => { presetModalMouseDownTarget = e.target; });
  $('presetModal').addEventListener('click', e => {
    if (e.target === $('presetModal') && presetModalMouseDownTarget === $('presetModal')) closePresetModal();
    presetModalMouseDownTarget = null;
  });
  $('presetNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('presetAccountsInput').focus(); });
  $('presetAccountsInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePreset(); } });

  // Settings modal events
  let modalMouseDownTarget = null;
  $('modal').addEventListener('mousedown', e => { modalMouseDownTarget = e.target; });
  $('modal').addEventListener('click', e => {
    if (e.target === $('modal') && modalMouseDownTarget === $('modal')) closeModal();
    modalMouseDownTarget = null;
  });
  $('twKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('keyInput').focus(); });
  $('keyInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveKeys(); });
  // Refresh model list when API key changes
  let modelFetchTimer = null;
  $('keyInput').addEventListener('input', () => {
    clearTimeout(modelFetchTimer);
    modelFetchTimer = setTimeout(() => refreshModelList(), 600);
  });
  $('modelProvider').addEventListener('change', () => updateModelCostHint());
  $('fontProvider').addEventListener('change', e => setFont(e.target.value));
  $('fontSizeProvider').addEventListener('change', e => setFontSize(e.target.value));
  $('caseProvider').addEventListener('change', e => setCase(e.target.value));

  // Account input events
  $('acctInput').addEventListener('input', function() {
    this.value = this.value.replace(/^@/, '');
    $('addBtn').classList.toggle('vis', this.value.trim().length > 0);
  });
  $('acctInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('acctInput').value.trim()) { e.preventDefault(); add($('acctInput').value); }
  });
  $('addBtn').addEventListener('click', () => { if ($('acctInput').value.trim()) add($('acctInput').value); });
}

(function init() {
  // Initialize analyst system (must be before anything that calls getPrompt)
  initAnalysts();
  
  // Apply settings
  setTheme(getTheme());
  setFont(getFont());
  setFontSize(getFontSize());
  setCase(getCase());
  
  // Check for shared signal in URL first
  if (checkSharedSignal()) {
    console.log('✓ Sentry initialized (shared view)');
    return;
  }
  
  // Load user data
  loadAccountsData();
  loadLoadedPresets();
  
  // Initialize event listeners
  initEventListeners();
  
  // Cleanup old cache entries
  cleanupCache();
  
  // Update key button state
  updateKeyBtn();
  
  // Render UI
  render();
  renderHistory();

  // Load previous scan on refresh
  const savedScan = loadCurrentScan();
  if (savedScan) {
    lastScanResult = savedScan;
    const d = new Date(savedScan.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    setStatus(`${dateStr} · <span class="hide-mobile">${savedScan.accounts.length} accounts · ${savedScan.totalTweets} tweets · </span>${savedScan.signals.length} signals`, false, true);
    renderTickers(savedScan.signals);
    renderSignals(savedScan.signals);
  }

  // Check for interrupted scan and offer to resume
  const pendingScan = loadPendingScan();
  if (pendingScan) {
    const totalTweets = pendingScan.accountTweets.reduce((s, a) => s + a.tweets.length, 0);
    const ago = Math.round((Date.now() - new Date(pendingScan.date).getTime()) / 60000);
    const agoText = ago < 1 ? 'just now' : `${ago}m ago`;
    $('notices').innerHTML = `<div class="notice resume-banner">
      <span>Interrupted scan detected (${pendingScan.accounts.length} accounts · ${totalTweets} tweets · ${agoText})</span>
      <span style="display:flex;gap:6px;margin-left:auto">
        <button class="resume-btn" onclick="resumeScan()">Resume</button>
        <button class="dismiss-btn" onclick="dismissResumeBanner()">✕</button>
      </span>
    </div>`;
  }
  
  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  
  // Update live button visibility
  updateLiveButton();
  
  // Restore live mode if it was active and feature is enabled
  if (isLiveEnabled() && localStorage.getItem(LS_LIVE_MODE) === 'true' && savedScan) {
    setTimeout(() => {
      startLiveFeed();
    }, 1000);
  }
  
  console.log('✓ Sentry initialized');
})();
