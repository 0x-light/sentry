// ============================================================================
// SENTRY — Dev Dashboard
// ============================================================================
//
// Comprehensive dev panel for simulating all UI states.
// Loaded dynamically via import() only when ?dev=1 is in the URL.
//
// Usage: dev.init(state, callbacks)
//

import * as engine from './engine.js';
import * as ui from './ui.js';
import * as auth from './auth.js';
import * as api from './api.js';
import { CATEGORIES } from './config.js';

const $ = id => document.getElementById(id);
const esc = engine.esc;

let state, callbacks;

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_SIGNALS = [
  { title: 'BTC breaks above $100k resistance with strong volume', summary: 'Bitcoin surged past $100,000, driven by institutional inflows and ETF demand. Multiple analysts raising year-end targets.', category: 'Trade', source: 'CryptoCapo_', tickers: [{ symbol: '$BTC', action: 'buy' }, { symbol: '$ETH', action: 'watch' }], tweet_url: 'https://x.com/CryptoCapo_/status/mock1', links: [], tweet_time: new Date(Date.now() - 15 * 60000).toISOString() },
  { title: 'NVIDIA announces next-gen AI chip, stock gaps up 8%', summary: 'NVIDIA unveiled Blackwell Ultra at GTC with 3x inference throughput. Supply constraints expected through Q3.', category: 'Trade', source: 'unusual_whales', tickers: [{ symbol: '$NVDA', action: 'buy' }, { symbol: '$AMD', action: 'buy' }, { symbol: '$INTC', action: 'sell' }], tweet_url: 'https://x.com/unusual_whales/status/mock2', links: ['https://nvidia.com/gtc'], tweet_time: new Date(Date.now() - 45 * 60000).toISOString() },
  { title: 'Fed signals potential rate cut in March meeting minutes', summary: 'FOMC minutes reveal growing consensus for easing. Bond yields falling, growth stocks rally. 85% probability of 25bp cut.', category: 'Insight', source: 'MacroAlf', tickers: [{ symbol: '$SPY', action: 'hold' }, { symbol: '$TLT', action: 'buy' }, { symbol: '$QQQ', action: 'buy' }], tweet_url: 'https://x.com/MacroAlf/status/mock3', links: [], tweet_time: new Date(Date.now() - 2 * 3600000).toISOString() },
  { title: 'Solana DeFi TVL hits new ATH as memecoin season heats up', summary: 'Total value locked in Solana DeFi surpassed $20B. Raydium and Jupiter seeing record volumes.', category: 'Insight', source: 'DefiIgnas', tickers: [{ symbol: '$SOL', action: 'buy' }, { symbol: '$JUP', action: 'hold' }], tweet_url: 'https://x.com/DefiIgnas/status/mock4', links: ['https://defillama.com/chain/Solana'], tweet_time: new Date(Date.now() - 5 * 3600000).toISOString() },
  { title: 'New on-chain analytics tool for tracking whale wallets', summary: 'Arkham Intelligence launched real-time whale tracking dashboard with alert capabilities. Free tier available.', category: 'Tool', source: 'lookonchain', tickers: [{ symbol: '$BTC', action: 'watch' }], tweet_url: 'https://x.com/lookonchain/status/mock5', links: ['https://arkham.com/whale-tracker'], tweet_time: new Date(Date.now() - 12 * 3600000).toISOString() },
  { title: 'Comprehensive guide to options Greeks explained', summary: 'Educational thread breaking down delta, gamma, theta, and vega with practical examples for retail traders.', category: 'Resource', source: 'thetagang', tickers: [], tweet_url: 'https://x.com/thetagang/status/mock6', links: ['https://optionsguide.com/greeks'], tweet_time: new Date(Date.now() - 24 * 3600000).toISOString() },
  { title: 'Pair trade: Long NVDA, short AMD on AI chip cycle', summary: 'Diverging supply chain positioning favors NVIDIA in H2. AMD losing enterprise design wins.', category: 'Trade', source: 'hedgeye', tickers: [{ symbol: '$NVDA', action: 'buy' }, { symbol: '$AMD', action: 'sell' }], tweet_url: 'https://x.com/hedgeye/status/mock7', links: [], tweet_time: new Date(Date.now() - 1 * 3600000).toISOString() },
  { title: 'TSLA earnings beat expectations, robotaxi timeline moved up', summary: 'Tesla Q4 earnings above consensus with improved margins. Musk confirmed robotaxi launch in Austin by Q2.', category: 'Trade', source: 'gaborGurbacs', tickers: [{ symbol: '$TSLA', action: 'buy' }, { symbol: '$UBER', action: 'sell' }], tweet_url: 'https://x.com/gaborGurbacs/status/mock8', links: [], tweet_time: new Date(Date.now() - 30 * 60000).toISOString() },
];

function createMockTweetMeta(signals) {
  const meta = {};
  signals.forEach(s => {
    if (s.tweet_url) {
      meta[s.tweet_url] = {
        text: `Mock tweet for: ${s.title}. This is the original tweet content that would appear when expanded. It contains the full context of the signal.`,
        author: s.source,
        time: s.tweet_time || new Date().toISOString(),
      };
    }
  });
  return meta;
}

function createMockScanResult(count = 7) {
  const now = new Date();
  const signals = MOCK_SIGNALS.slice(0, count);
  return {
    date: now.toISOString(),
    range: 'Today',
    days: 1,
    accounts: [...new Set(signals.map(s => s.source))],
    totalTweets: count * 6,
    signals,
    tweetMeta: createMockTweetMeta(signals),
    scheduled: false,
  };
}

function createMockHistory(count = 3) {
  const history = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.now() - (i + 1) * 86400000);
    const sigs = MOCK_SIGNALS.slice(0, 4 + i).map(s => ({
      ...s,
      tweet_time: new Date(d.getTime() - Math.random() * 3600000).toISOString(),
    }));
    history.push({
      date: d.toISOString(),
      range: i % 2 === 0 ? 'Today' : 'Week',
      accounts: 6,
      totalTweets: 30 + i * 10,
      signalCount: sigs.length,
      signals: sigs,
    });
  }
  return history;
}

function createMockSchedules(status = 'success') {
  return [{
    id: 'mock-sched-1',
    label: 'Scan at 9:00 AM',
    time: '09:00',
    range_days: 1,
    accounts: ['CryptoCapo_', 'unusual_whales', 'MacroAlf'],
    preset_names: ['crypto'],
    timezone: 'America/New_York',
    days: [],
    enabled: true,
    last_run_status: status === 'none' ? null : status,
    last_run_at: status !== 'none' ? new Date(Date.now() - 3600000).toISOString() : null,
  }];
}

function injectMockPrices() {
  Object.assign(engine.priceCache, {
    BTC: { price: 101234.56, change: 3.42, ts: Date.now() },
    ETH: { price: 3891.23, change: -1.15, ts: Date.now() },
    NVDA: { price: 892.45, change: 5.67, ts: Date.now() },
    SPY: { price: 512.33, change: 0.23, ts: Date.now() },
    SOL: { price: 198.76, change: 8.12, ts: Date.now() },
    TLT: { price: 98.45, change: -0.34, ts: Date.now() },
    AMD: { price: 178.90, change: -2.45, ts: Date.now() },
    INTC: { price: 42.13, change: -4.56, ts: Date.now() },
    QQQ: { price: 445.67, change: 1.89, ts: Date.now() },
    JUP: { price: 1.23, change: 12.34, ts: Date.now() },
    TSLA: { price: 342.10, change: 7.23, ts: Date.now() },
    UBER: { price: 78.90, change: -3.12, ts: Date.now() },
    AAPL: { price: 234.56, change: 1.23, ts: Date.now() },
    MSFT: { price: 456.78, change: 0.45, ts: Date.now() },
  });
}

// ============================================================================
// STATE MANIPULATION
// ============================================================================

function mockAuth(credits) {
  auth._mockSignIn('dev@sentry.is');
  api._setMockProfile({
    _mock: true,
    id: 'dev-user', email: 'dev@sentry.is', name: 'Dev User',
    credits_balance: credits, has_credits: credits > 0,
    free_scan_available: credits === 0, subscription_status: credits > 0 ? 'active' : null,
  });
  setTimeout(() => { ui.renderTopbar(); renderPanel(); }, 10);
}

function mockLogout() {
  auth._mockSignOut();
  api._setMockProfile(null);
  ui.renderTopbar();
  renderPanel();
}

function loadMockSignals(count) {
  const scan = createMockScanResult(count);
  state.lastScanResult = scan;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ui.setStatus(`${now.toLocaleDateString()} ${timeStr} · ${scan.accounts.length} accounts · ${scan.totalTweets} tweets · ${scan.signals.length} signals`, false, true);
  ui.renderTickers(scan.signals);
  ui.renderSignals(scan.signals);
}

function loadMockScheduledSignals() {
  const scan = createMockScanResult(7);
  scan.scheduled = true;
  scan.range = 'Today (scheduled)';
  state.lastScanResult = scan;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ui.setStatus(`${now.toLocaleDateString()} ${timeStr} · ${scan.accounts.length} accounts · ${scan.totalTweets} tweets · ${scan.signals.length} signals (scheduled)`, false, true);
  ui.renderTickers(scan.signals);
  ui.renderSignals(scan.signals);
}

function clearAll() {
  state.busy = false;
  state.lastScanResult = null;
  state.filters = { category: null, ticker: null };
  state.isLiveMode = false;
  state.schedules = [];
  state.nextScheduleLabel = '';
  mockLogout();
  ui.setLoading(false);
  ui.setStatus('');
  ui.hideOnboarding();
  $('notices').innerHTML = '';
  $('tickerBar').innerHTML = '';
  $('filterBar').innerHTML = '';
  $('results').innerHTML = '';
  $('historySection').innerHTML = '';
  $('footer').innerHTML = '';
  document.body.removeAttribute('data-shared');
  $('sharedBanner').innerHTML = '';
  document.querySelector('.controls').style.display = '';
  ui.renderTopbar();
  ui.render();
}

// ============================================================================
// PANEL SECTIONS
// ============================================================================

const SECTIONS = [
  { id: 'auth', label: 'Auth & Credits' },
  { id: 'scan', label: 'Scan State' },
  { id: 'data', label: 'Data' },
  { id: 'display', label: 'Display' },
  { id: 'modals', label: 'Modals' },
  { id: 'notices', label: 'Notices' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'live', label: 'Live Feed' },
  { id: 'presets', label: 'Presets' },
  { id: 'shared', label: 'Shared View' },
  { id: 'onboarding', label: 'Onboarding' },
];

function getOpenSections() {
  try { return JSON.parse(sessionStorage.getItem('dev_open_sections') || '["auth","data"]'); }
  catch { return ['auth', 'data']; }
}
function saveOpenSections(open) {
  sessionStorage.setItem('dev_open_sections', JSON.stringify(open));
}

function getPanelHidden() {
  return sessionStorage.getItem('dev_panel_hidden') === 'true';
}
function setPanelHidden(v) {
  sessionStorage.setItem('dev_panel_hidden', String(v));
}

// ============================================================================
// RENDER PANEL
// ============================================================================

function renderPanel() {
  let panel = $('devPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'devPanel';
    panel.className = 'dev-panel';
    document.body.appendChild(panel);
  }

  if (getPanelHidden()) {
    panel.style.display = 'none';
    showFab();
    return;
  }

  panel.style.display = '';
  hideFab();

  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const credits = profile?.credits_balance || 0;
  const open = getOpenSections();

  let h = '';

  // Header
  h += `<div class="dev-panel-header">`;
  h += `<span class="dev-brand">DEV</span>`;
  h += `<div class="dev-header-actions">`;
  h += `<button class="dev-header-btn" id="devResetAll" title="Reset all">Reset</button>`;
  h += `<button class="dev-header-btn" id="devMinimize" title="Minimize">_</button>`;
  h += `</div></div>`;

  // --- Auth section ---
  h += section('auth', open, () => {
    let s = `<div class="dev-row"><span class="dev-row-label">State</span>`;
    s += `<div class="dev-toggle-group">`;
    s += btn('devLogout', 'Signed out', !isAuth);
    s += btn('devCredits0', 'Free', isAuth && credits === 0);
    s += btn('devCredits100', '100', isAuth && credits === 100);
    s += btn('devCredits1000', '1k', isAuth && credits === 1000);
    s += btn('devCredits5000', '5k', isAuth && credits === 5000);
    s += btn('devCredits15000', '15k', isAuth && credits === 15000);
    s += `</div></div>`;
    return s;
  });

  // --- Scan section ---
  h += section('scan', open, () => {
    let s = `<div class="dev-row"><span class="dev-row-label">State</span>`;
    s += `<div class="dev-toggle-group">`;
    s += btn('devScanIdle', 'Idle', !state.busy && !state.lastScanResult);
    s += btn('devScanBusy', 'Scanning', state.busy);
    s += btn('devScanResults', 'Results', !state.busy && state.lastScanResult?.signals?.length > 0);
    s += `</div></div>`;
    return s;
  });

  // --- Data section ---
  h += section('data', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devMockSignals', 'Mock signals');
    s += btn('devMockScheduled', 'Scheduled');
    s += btn('devMockFiltered', 'Filtered');
    s += btn('devMockHistory', 'History');
    s += `</div></div>`;
    s += `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devTickersWithPrices', 'Tickers + prices');
    s += btn('devTickersNoPrices', 'Tickers only');
    s += btn('devClearTickers', 'Clear tickers');
    s += `</div></div>`;
    return s;
  });

  // --- Display section ---
  h += section('display', open, () => {
    const theme = engine.getTheme();
    const font = engine.getFont();
    const size = engine.getFontSize();
    const textCase = engine.getCase();
    const prices = engine.getShowTickerPrice();
    let s = `<div class="dev-row"><span class="dev-row-label">Theme</span><div class="dev-toggle-group">`;
    s += btn('devThemeLight', 'Light', theme === 'light');
    s += btn('devThemeDark', 'Dark', theme === 'dark');
    s += `</div></div>`;
    s += `<div class="dev-row"><span class="dev-row-label">Font</span><div class="dev-toggle-group">`;
    s += btn('devFontMono', 'Mono', font === 'mono');
    s += btn('devFontSystem', 'System', font === 'system');
    s += `</div></div>`;
    s += `<div class="dev-row"><span class="dev-row-label">Size</span><div class="dev-toggle-group">`;
    ['xsmall', 'small', 'medium', 'large', 'xlarge'].forEach(sz => {
      const label = { xsmall: 'XS', small: 'S', medium: 'M', large: 'L', xlarge: 'XL' }[sz];
      s += btn(`devSize_${sz}`, label, size === sz);
    });
    s += `</div></div>`;
    s += `<div class="dev-row"><span class="dev-row-label">Case</span><div class="dev-toggle-group">`;
    s += btn('devCaseLower', 'lower', textCase === 'lower');
    s += btn('devCaseSentence', 'Sentence', textCase === 'sentence');
    s += `</div></div>`;
    s += `<div class="dev-row"><span class="dev-row-label">Prices</span><div class="dev-toggle-group">`;
    s += btn('devPricesOn', 'On', prices);
    s += btn('devPricesOff', 'Off', !prices);
    s += `</div></div>`;
    return s;
  });

  // --- Modals section ---
  h += section('modals', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devOpenAuth', 'Auth');
    s += btn('devOpenPricing', 'Pricing');
    s += btn('devOpenPresets', 'Presets');
    s += `</div></div>`;
    s += `<div class="dev-row"><span class="dev-row-label">Settings</span><div class="dev-toggle-group">`;
    ['account', 'api', 'schedule', 'analyst', 'display', 'data'].forEach(tab => {
      s += btn(`devSettings_${tab}`, tab);
    });
    s += `</div></div>`;
    return s;
  });

  // --- Notices section ---
  h += section('notices', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devNoticeError', 'Error');
    s += btn('devNoticeWarn', 'Warning');
    s += btn('devNoticeLowCredits', 'Low credits');
    s += btn('devNoticeResume', 'Resume');
    s += btn('devNoticeScheduled', 'Scheduled');
    s += `</div></div>`;
    s += `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devClearNotices', 'Clear notices');
    s += `</div></div>`;
    return s;
  });

  // --- Schedules section ---
  h += section('schedules', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devSchedNone', 'None');
    s += btn('devSchedEnabled', 'Enabled');
    s += btn('devSchedRunning', 'Running');
    s += btn('devSchedSuccess', 'Success');
    s += btn('devSchedError', 'Error');
    s += `</div></div>`;
    return s;
  });

  // --- Live feed section ---
  h += section('live', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devLiveDisabled', 'Disabled', !engine.isLiveEnabled());
    s += btn('devLiveStopped', 'Stopped', engine.isLiveEnabled() && !state.isLiveMode);
    s += btn('devLiveRunning', 'Running', state.isLiveMode);
    s += `</div></div>`;
    return s;
  });

  // --- Presets section ---
  h += section('presets', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devPresetNone', 'None');
    s += btn('devPresetTradfi', 'tradfi', state.loadedPresets.includes('tradfi'));
    s += btn('devPresetCrypto', 'crypto', state.loadedPresets.includes('crypto'));
    s += btn('devPresetTech', 'tech', state.loadedPresets.includes('tech'));
    s += btn('devPresetCustom', '+ Custom');
    s += `</div></div>`;
    return s;
  });

  // --- Shared section ---
  h += section('shared', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devSharedShow', 'Show');
    s += btn('devSharedReset', 'Reset');
    s += `</div></div>`;
    return s;
  });

  // --- Onboarding section ---
  h += section('onboarding', open, () => {
    let s = `<div class="dev-row"><div class="dev-toggle-group">`;
    s += btn('devOnboardingStart', 'Start');
    s += btn('devOnboardingHide', 'Hide');
    s += `</div></div>`;
    return s;
  });

  panel.innerHTML = h;
}

function section(id, openSections, contentFn) {
  const isOpen = openSections.includes(id);
  const label = SECTIONS.find(s => s.id === id)?.label || id;
  let h = `<div class="dev-section${isOpen ? ' open' : ''}">`;
  h += `<div class="dev-section-header" data-dev-section="${id}"><span>${esc(label)}</span><span>${isOpen ? '▾' : '▸'}</span></div>`;
  h += `<div class="dev-section-body">${isOpen ? contentFn() : ''}</div>`;
  h += `</div>`;
  return h;
}

function btn(id, label, active = false) {
  return `<button id="${id}" class="dev-btn${active ? ' active' : ''}">${esc(label)}</button>`;
}

function showFab() {
  let fab = $('devFab');
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'devFab';
    fab.textContent = 'DEV';
    fab.className = 'dev-fab';
    fab.addEventListener('click', () => {
      setPanelHidden(false);
      renderPanel();
    });
    document.body.appendChild(fab);
  }
  fab.style.display = 'block';
}

function hideFab() {
  const fab = $('devFab');
  if (fab) fab.style.display = 'none';
}

// ============================================================================
// EVENT HANDLING
// ============================================================================

function handleClick(e) {
  const target = e.target.closest('[id]');
  if (!target) return;
  const id = target.id;

  // Section toggle
  const sectionHeader = e.target.closest('[data-dev-section]');
  if (sectionHeader) {
    const sectionId = sectionHeader.dataset.devSection;
    const open = getOpenSections();
    const idx = open.indexOf(sectionId);
    if (idx >= 0) open.splice(idx, 1);
    else open.push(sectionId);
    saveOpenSections(open);
    renderPanel();
    return;
  }

  switch (id) {
    // --- Header ---
    case 'devResetAll': clearAll(); renderPanel(); break;
    case 'devMinimize': setPanelHidden(true); renderPanel(); break;

    // --- Auth ---
    case 'devLogout': mockLogout(); renderPanel(); break;
    case 'devCredits0': mockAuth(0); break;
    case 'devCredits100': mockAuth(100); break;
    case 'devCredits1000': mockAuth(1000); break;
    case 'devCredits5000': mockAuth(5000); break;
    case 'devCredits15000': mockAuth(15000); break;

    // --- Scan ---
    case 'devScanIdle':
      state.busy = false;
      state.lastScanResult = null;
      ui.setLoading(false);
      ui.setStatus('');
      $('results').innerHTML = '';
      $('tickerBar').innerHTML = '';
      $('filterBar').innerHTML = '';
      $('footer').innerHTML = '';
      ui.renderRanges();
      renderPanel();
      break;
    case 'devScanBusy':
      state.busy = true;
      ui.setLoading(true);
      ui.setStatus('Analyzing 3/6 accounts · 12s', true);
      ui.renderRanges();
      renderPanel();
      break;
    case 'devScanResults':
      state.busy = false;
      ui.setLoading(false);
      loadMockSignals(7);
      ui.renderRanges();
      renderPanel();
      break;

    // --- Data ---
    case 'devMockSignals': loadMockSignals(7); break;
    case 'devMockScheduled': loadMockScheduledSignals(); break;
    case 'devMockFiltered':
      if (!state.lastScanResult) loadMockSignals(7);
      state.filters = { category: 'Trade', ticker: null };
      ui.applyFilters();
      ui.renderFilters();
      break;
    case 'devMockHistory':
      ui.renderHistory(createMockHistory(3));
      break;
    case 'devTickersWithPrices':
      if (!state.lastScanResult) loadMockSignals(7);
      injectMockPrices();
      engine.setShowTickerPrice(true);
      ui.renderTickers(state.lastScanResult.signals);
      ui.renderSignals(state.lastScanResult.signals);
      break;
    case 'devTickersNoPrices':
      if (!state.lastScanResult) loadMockSignals(7);
      engine.setShowTickerPrice(false);
      ui.renderTickers(state.lastScanResult.signals);
      ui.renderSignals(state.lastScanResult.signals);
      break;
    case 'devClearTickers':
      $('tickerBar').innerHTML = '';
      $('tickerBar').className = '';
      break;

    // --- Display ---
    case 'devThemeLight': engine.setTheme('light'); renderPanel(); break;
    case 'devThemeDark': engine.setTheme('dark'); renderPanel(); break;
    case 'devFontMono': engine.setFont('mono'); renderPanel(); break;
    case 'devFontSystem': engine.setFont('system'); renderPanel(); break;
    case 'devCaseLower': engine.setCase('lower'); renderPanel(); break;
    case 'devCaseSentence': engine.setCase('sentence'); renderPanel(); break;
    case 'devPricesOn':
      engine.setShowTickerPrice(true);
      if (state.lastScanResult?.signals) { injectMockPrices(); ui.renderTickers(state.lastScanResult.signals); ui.renderSignals(state.lastScanResult.signals); }
      renderPanel();
      break;
    case 'devPricesOff':
      engine.setShowTickerPrice(false);
      if (state.lastScanResult?.signals) { ui.renderTickers(state.lastScanResult.signals); ui.renderSignals(state.lastScanResult.signals); }
      renderPanel();
      break;

    // --- Modals ---
    case 'devOpenAuth': ui.hideOnboarding(); callbacks.openAuthModal(); break;
    case 'devOpenPricing': ui.hideOnboarding(); callbacks.openPricingModal(); break;
    case 'devOpenPresets': ui.hideOnboarding(); callbacks.openModal('presetModal'); break;

    // --- Notices ---
    case 'devNoticeError':
      $('notices').innerHTML += `<div class="notice err">Twitter API error 429: Rate limit exceeded. Please try again later.</div>`;
      break;
    case 'devNoticeWarn':
      $('notices').innerHTML += `<div class="notice warn">Errors: CryptoCapo_ (timeout), unusual_whales (rate limited)</div>`;
      break;
    case 'devNoticeLowCredits':
      $('notices').innerHTML += `<div class="notice warn">Low credits: ~50 will remain after this scan.</div>`;
      break;
    case 'devNoticeResume':
      $('notices').innerHTML = `<div class="notice resume-banner">
        <span>Interrupted scan detected (6 accounts · 42 tweets · 3m ago)</span>
        <span style="display:flex;gap:6px;margin-left:auto">
          <button class="resume-btn">Resume</button>
          <button class="dismiss-btn" onclick="this.closest('.notice').remove()">✕</button>
        </span>
      </div>`;
      break;
    case 'devNoticeScheduled': {
      if (!state.lastScanResult) loadMockSignals(7);
      const scan = state.lastScanResult;
      if (scan) scan.scheduled = true;
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $('notices').innerHTML = `<div class="notice sched-banner">
        <span>Scheduled scan complete · ${scan ? scan.signals.length : 0} signals · ${timeStr}</span>
        <span style="display:flex;gap:6px">
          <button class="resume-btn" onclick="document.querySelector('#notices').innerHTML=''">View results</button>
          <button class="dismiss-btn" onclick="this.closest('.notice').remove()">Dismiss</button>
        </span>
      </div>`;
      if (scan) ui.renderSignals(scan.signals);
      break;
    }
    case 'devClearNotices':
      $('notices').innerHTML = '';
      break;

    // --- Schedules ---
    case 'devSchedNone':
      state.schedules = [];
      state.nextScheduleLabel = '';
      ui.renderTopbar();
      renderPanel();
      break;
    case 'devSchedEnabled':
      state.schedules = createMockSchedules('none');
      state.nextScheduleLabel = engine.getNextScheduleLabel(state.schedules);
      ui.renderTopbar();
      renderPanel();
      break;
    case 'devSchedRunning':
      state.schedules = createMockSchedules('running');
      state.nextScheduleLabel = '';
      ui.renderTopbar();
      renderPanel();
      break;
    case 'devSchedSuccess':
      state.schedules = createMockSchedules('success');
      state.nextScheduleLabel = engine.getNextScheduleLabel(state.schedules);
      ui.renderTopbar();
      renderPanel();
      break;
    case 'devSchedError':
      state.schedules = createMockSchedules('error');
      state.nextScheduleLabel = engine.getNextScheduleLabel(state.schedules);
      ui.renderTopbar();
      renderPanel();
      break;

    // --- Live feed ---
    case 'devLiveDisabled':
      engine.setLiveEnabled(false);
      state.isLiveMode = false;
      $('liveBtn')?.classList.remove('active');
      $('liveBtn') && ($('liveBtn').style.display = 'none');
      renderPanel();
      break;
    case 'devLiveStopped':
      engine.setLiveEnabled(true);
      state.isLiveMode = false;
      $('liveBtn')?.classList.remove('active');
      $('liveBtn') && ($('liveBtn').style.display = 'flex');
      renderPanel();
      break;
    case 'devLiveRunning':
      engine.setLiveEnabled(true);
      state.isLiveMode = true;
      $('liveBtn') && ($('liveBtn').style.display = 'flex');
      $('liveBtn')?.classList.add('active');
      renderPanel();
      break;

    // --- Presets ---
    case 'devPresetNone':
      state.loadedPresets = [];
      state.customAccounts = [];
      engine.saveLoadedPresets([]);
      engine.saveAccounts([]);
      ui.render();
      renderPanel();
      break;
    case 'devPresetTradfi':
    case 'devPresetCrypto':
    case 'devPresetTech': {
      const name = id.replace('devPreset', '').toLowerCase();
      if (state.loadedPresets.includes(name)) {
        state.loadedPresets = state.loadedPresets.filter(n => n !== name);
      } else {
        state.loadedPresets.push(name);
      }
      engine.saveLoadedPresets(state.loadedPresets);
      ui.render();
      renderPanel();
      break;
    }
    case 'devPresetCustom':
      if (!state.customAccounts.includes('testuser1')) {
        state.customAccounts.push('testuser1', 'testuser2', 'testuser3');
        engine.saveAccounts(state.customAccounts);
      }
      ui.render();
      renderPanel();
      break;

    // --- Shared ---
    case 'devSharedShow': {
      const sig = MOCK_SIGNALS[0];
      document.body.setAttribute('data-shared', '');
      $('sharedBanner').innerHTML = `<div class="shared-banner"><span class="shared-banner-text">shared signal</span><a href="${location.pathname}">← back to sentry</a></div>`;
      document.querySelector('.controls').style.display = 'none';
      ui.renderSharedSignal(sig);
      break;
    }
    case 'devSharedReset':
      document.body.removeAttribute('data-shared');
      $('sharedBanner').innerHTML = '';
      document.querySelector('.controls').style.display = '';
      $('results').innerHTML = '';
      $('footer').innerHTML = '';
      break;

    // --- Onboarding ---
    case 'devOnboardingStart': callbacks.startOnboarding(); break;
    case 'devOnboardingHide': ui.hideOnboarding(); break;

    default:
      // Font size buttons
      if (id.startsWith('devSize_')) {
        const sz = id.replace('devSize_', '');
        engine.setFontSize(sz);
        renderPanel();
      }
      // Settings tab buttons
      if (id.startsWith('devSettings_')) {
        const tab = id.replace('devSettings_', '');
        ui.hideOnboarding();
        callbacks.openSettingsModal(tab);
      }
      break;
  }
}

// ============================================================================
// KEYBOARD SHORTCUT
// ============================================================================

function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    const hidden = getPanelHidden();
    setPanelHidden(!hidden);
    renderPanel();
  }
}

// ============================================================================
// INIT
// ============================================================================

export function init(appState, cbs) {
  state = appState;
  callbacks = cbs;

  // Hide old dev toolbar if still present
  const oldToolbar = $('devToolbar');
  if (oldToolbar) oldToolbar.style.display = 'none';

  // Inject CSS
  if (!$('devPanelStyles')) {
    const style = document.createElement('style');
    style.id = 'devPanelStyles';
    style.textContent = DEV_CSS;
    document.head.appendChild(style);
  }

  renderPanel();
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
}

// ============================================================================
// CSS (injected at runtime, never loaded in production)
// ============================================================================

const DEV_CSS = `
.dev-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 300px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  z-index: 10000;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  font-size: 12px;
  color: #d4d4d8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.dev-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #3f3f46;
  user-select: none;
}
.dev-header-actions {
  display: flex;
  gap: 8px;
}
.dev-header-btn {
  background: #27272a;
  border: none;
  color: #a1a1aa;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.dev-header-btn:hover {
  color: #d4d4d8;
  background: #3f3f46;
}
.dev-section {
  border-bottom: 1px solid #27272a;
}
.dev-section:last-child {
  border-bottom: none;
}
.dev-section-header {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  color: #71717a;
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
.dev-section-header:hover {
  color: #a1a1aa;
  background: #1f1f23;
}
.dev-section-body {
  display: none;
  padding: 4px 12px 10px;
}
.dev-section.open .dev-section-body {
  display: block;
}
.dev-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.dev-row:last-child {
  margin-bottom: 0;
}
.dev-row-label {
  color: #71717a;
  font-size: 11px;
  min-width: 40px;
  flex-shrink: 0;
}
.dev-toggle-group {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  flex: 1;
}
.dev-panel .dev-btn {
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  background: #27272a;
  color: #a1a1aa;
  white-space: nowrap;
}
.dev-panel .dev-btn:hover {
  background: #3f3f46;
  color: #d4d4d8;
}
.dev-panel .dev-btn.active {
  background: #7c3aed;
  color: white;
}
.dev-panel .dev-brand {
  font-weight: 600;
  color: #a78bfa;
}
`;
