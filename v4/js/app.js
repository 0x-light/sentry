// ============================================================================
// SENTRY — Main Application Entry Point
// ============================================================================
//
// State management, event wiring, initialization.
// Imports all modules and orchestrates the app.
//

import { RANGES, DEFAULT_PROMPT, DEFAULT_ANALYST_ID, LS_TW, LS_AN, LS_FINANCE, LS_MODEL, LS_LIVE_MODE } from './config.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as engine from './engine.js';
import * as ui from './ui.js';

const $ = id => document.getElementById(id);

// ============================================================================
// APP STATE
// ============================================================================

const state = {
  customAccounts: [],
  loadedPresets: [],
  range: 0,
  busy: false,
  lastScanResult: null,
  filters: { category: null, ticker: null },
  editingPresetName: null,
  isLiveMode: false,
  liveInterval: null,
  seenTweetUrls: new Set(),
  // Schedules
  schedules: [],
  schedulesLoading: false,
  nextScheduleLabel: '',
  scheduleInterval: null,
  wasRunning: false,

  getAllAccounts() {
    const all = [...state.customAccounts];
    const presets = engine.getPresets();
    for (const name of state.loadedPresets) {
      const p = presets.find(p => p.name === name);
      if (p) all.push(...p.accounts);
    }
    return [...new Set(all)];
  },

  addAccount(h) {
    const c = h.trim().replace(/^@/, '').toLowerCase();
    if (c && !state.customAccounts.includes(c)) state.customAccounts.push(c);
    $('acctInput').value = '';
    $('addBtn').classList.remove('vis');
    engine.saveAccounts(state.customAccounts);
    ui.render();
    $('acctInput').focus();
  },

  deleteHistoryScan(index) {
    const history = state._serverHistory || engine.getScanHistory();
    const entry = history[index];
    if (entry?.id && auth.isAuthenticated()) {
      api.deleteScan(entry.id).catch(e => console.warn('Failed to delete from server:', e));
    }
    engine.deleteHistoryScan(index);
    if (auth.isAuthenticated()) loadServerHistory();
    else ui.renderHistory();
  },

  downloadHistoryScan(index) {
    const history = state._serverHistory || engine.getScanHistory();
    const scan = history[index];
    if (!scan) return;
    engine.downloadScanAsMarkdown({
      ...scan,
      accounts: Array.isArray(scan.accounts) ? scan.accounts : [],
      totalTweets: scan.totalTweets || 0,
    });
  },

  _serverHistory: null,
};

// Give UI access to state
ui.setAppState(state);

// ============================================================================
// MODAL HELPERS
// ============================================================================

function openModal(id) {
  $(id).classList.add('open');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  $(id).classList.remove('open');
  document.body.classList.remove('modal-open');
}

let lastSettingsTab = 'account';
let originalSettings = {};

function openSettingsModal(tab) {
  originalSettings = { font: engine.getFont(), fontSize: engine.getFontSize(), textCase: engine.getCase() };
  $('twKeyInput').value = engine.getTwKey();
  $('keyInput').value = engine.getAnKey();
  $('financeProvider').value = engine.getFinanceProvider();
  $('fontProvider').value = originalSettings.font;
  $('fontSizeProvider').value = originalSettings.fontSize;
  $('caseProvider').value = originalSettings.textCase;
  $('liveEnabledToggle').checked = engine.isLiveEnabled();
  const stp = $('showTickerPriceToggle');
  if (stp) stp.checked = engine.getShowTickerPrice();
  ui.renderAnalystList();
  ui.renderAccountTab();
  ui.renderScheduleTab(state.schedules, state.schedulesLoading);

  const models = engine.getCachedModels();
  populateModelSelector(models, engine.getModel());
  if (!models && engine.getAnKey()) refreshModelList();
  updateCacheSizeDisplay();
  switchTab(tab || lastSettingsTab);
  openModal('modal');
}

function switchTab(name) {
  lastSettingsTab = name;
  document.querySelectorAll('#settingsTabs .modal-tab').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === name));
  document.querySelectorAll('#modal .tab-content').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
}

function populateModelSelector(models, selectedId) {
  const sel = $('modelProvider');
  const current = selectedId || engine.getModel();
  sel.innerHTML = '';
  if (models && models.length) {
    let hasSelected = false;
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const cost = engine.modelCostLabel(m.id);
      opt.textContent = cost ? `${m.name} ${cost}` : m.name;
      if (m.id === current) { opt.selected = true; hasSelected = true; }
      sel.appendChild(opt);
    });
    if (!hasSelected) {
      const opt = document.createElement('option');
      opt.value = current; opt.textContent = current; opt.selected = true;
      sel.prepend(opt);
    }
  } else {
    const opt = document.createElement('option');
    opt.value = current; opt.textContent = current;
    sel.appendChild(opt);
  }
  updateModelCostHint();
}

function updateModelCostHint() {
  const hint = $('modelCostHint');
  if (hint) hint.textContent = engine.formatModelCost($('modelProvider').value);
}

async function refreshModelList() {
  const sel = $('modelProvider');
  const key = $('keyInput').value.trim();
  if (!key || key.length < 20) return;
  sel.disabled = true;
  sel.innerHTML = '<option>Loading models…</option>';
  const models = await engine.fetchAvailableModels(key);
  populateModelSelector(models, engine.getModel());
  sel.disabled = false;
}

function updateCacheSizeDisplay() {
  const cache = engine.loadAnalysisCache();
  const count = Object.keys(cache.entries || {}).length;
  $('cacheSize').textContent = count ? `${count} tweets cached` : 'empty';
}

// ============================================================================
// SCAN — Uses engine.runScan() orchestrator with 3-layer cache
// ============================================================================

let currentScanAbort = null;
let lastRunTime = 0;

async function run() {
  const now = Date.now();
  if (now - lastRunTime < 1000) return;
  lastRunTime = now;

  const accounts = state.getAllAccounts();
  if (!accounts.length || state.busy) return;

  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const hasCredits = api.hasCredits();

  // Credit-based access control
  if (isAuth && profile) {
    if (!hasCredits && !profile.free_scan_available) {
      openPricingModal();
      $('notices').innerHTML = `<div class="notice err">Daily free scan used. Buy credits or come back tomorrow.</div>`;
      return;
    }
    if (!hasCredits && accounts.length > 10) {
      openPricingModal();
      $('notices').innerHTML = `<div class="notice err">Free tier allows up to 10 accounts. Buy credits for more.</div>`;
      return;
    }
  }

  const hasBYOK = engine.bothKeys();
  if (!hasBYOK && !hasCredits) { openSettingsModal('api'); return; }

  if (currentScanAbort) currentScanAbort.abort();
  currentScanAbort = new AbortController();

  state.busy = true;
  ui.setLoading(true);
  $('notices').innerHTML = '';
  $('tickerBar').innerHTML = '';
  $('filterBar').innerHTML = '';
  $('results').innerHTML = '';

  if (state.customAccounts.length) {
    engine.addToRecents(state.customAccounts);
    ui.renderSuggested();
  }

  const days = RANGES[state.range].days;
  const useManaged = !!hasCredits && !hasBYOK;
  const signal = currentScanAbort.signal;

  // Pre-scan credit reservation for managed-key users
  let reservationId;
  if (useManaged && isAuth) {
    try {
      ui.setStatus('Checking credits…', true);
      const reservation = await api.reserveCredits(accounts.length, days, engine.getModel());
      if (!reservation.ok) {
        state.busy = false; ui.setLoading(false);
        openPricingModal();
        $('notices').innerHTML = `<div class="notice err">${engine.esc(reservation.error || 'Not enough credits.')}</div>`;
        ui.setStatus('');
        return;
      }
      reservationId = reservation.reservation_id;

      // Low credit warning (<20% remaining after this scan)
      if (reservation.credits_balance && reservation.credits_needed) {
        const remaining = reservation.credits_balance - reservation.credits_needed;
        if (remaining > 0 && remaining < reservation.credits_balance * 0.2) {
          $('notices').innerHTML += `<div class="notice warn">Low credits: ~${remaining.toLocaleString()} will remain after this scan.</div>`;
        }
      }
    } catch (e) {
      state.busy = false; ui.setLoading(false);
      if (e.message?.includes('credits') || e.message?.includes('free scan')) openPricingModal();
      $('notices').innerHTML = `<div class="notice err">${engine.esc(e.message || 'Failed to reserve credits.')}</div>`;
      ui.setStatus('');
      return;
    }
  }

  try {
    // Use the runScan orchestrator (3-layer cache: scan cache → local cache → server analysis cache → analyze)
    const result = await engine.runScan(
      accounts, days, signal,
      (text, animate) => ui.setStatus(text, !!animate),
      (type, msg) => { $('notices').innerHTML += `<div class="notice ${type === 'error' ? 'err' : 'warn'}">${engine.esc(msg)}</div>`; },
    );

    if (result) {
      result.range = RANGES[state.range].label;
      engine.saveScanToStorage(result);
      state.lastScanResult = engine.loadCurrentScan() || result;
      engine.clearPendingScan();

      // Update seen tweet URLs for live mode
      if (result.rawTweets) {
        result.rawTweets.forEach(a => (a.tweets || []).forEach(tw => state.seenTweetUrls.add(engine.getTweetUrl(tw))));
      }

      const d = new Date();
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      ui.setStatus(`${dateStr} · <span class="hide-mobile">${accounts.length} accounts · ${result.totalTweets} tweets · </span>${result.signals.length} signals`, false, true);
      ui.renderTickers(result.signals);
      ui.renderSignals(result.signals);

      // Save to server and refresh profile
      if (isAuth) {
        api.saveScan({
          accounts,
          range_label: RANGES[state.range].label,
          range_days: days,
          total_tweets: result.totalTweets,
          signal_count: result.signals.length,
          signals: result.signals,
          tweet_meta: engine.loadCurrentScan()?.tweetMeta || {},
          prompt_hash: engine.getPromptHash(),
          byok: !useManaged,
          reservation_id: reservationId,
          model: engine.getModel(),
        }).then((saveResult) => {
          api.refreshProfile().then(() => ui.renderTopbar());
          loadServerHistory();
          // Post-scan credit balance feedback
          if (useManaged && saveResult?.credits_balance !== undefined) {
            const bal = saveResult.credits_balance;
            if (bal <= 0) {
              $('notices').innerHTML += `<div class="notice err">Credits depleted. Buy more to keep scanning.</div>`;
            } else if (bal < 500) {
              $('notices').innerHTML += `<div class="notice warn">${bal.toLocaleString()} credits remaining. Consider topping up.</div>`;
            }
          }
        }).catch(e => console.warn('Failed to save scan to server:', e));
      }
      ui.renderHistory();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      engine.clearPendingScan();
      ui.setStatus('Scan cancelled');
    } else {
      ui.setStatus('');
      $('notices').innerHTML = `<div class="notice err">${engine.esc(e.message)}</div>`;
    }
  } finally {
    state.busy = false;
    ui.setLoading(false);
    currentScanAbort = null;
  }
}

async function resumeScan() {
  const pending = engine.loadPendingScan();
  if (!pending || state.busy) return;
  engine.clearPendingScan();
  $('notices').innerHTML = '';
  if (!engine.bothKeys() && !api.hasCredits()) { openSettingsModal('api'); return; }

  if (currentScanAbort) currentScanAbort.abort();
  currentScanAbort = new AbortController();
  state.busy = true;
  ui.setLoading(true);

  try {
    const result = await engine.runScan(
      pending.accounts, pending.days, currentScanAbort.signal,
      (text, animate) => ui.setStatus(text, !!animate),
      (type, msg) => { $('notices').innerHTML += `<div class="notice ${type === 'error' ? 'err' : 'warn'}">${engine.esc(msg)}</div>`; },
      pending.accountTweets,
    );

    if (result) {
      result.range = pending.rangeLabel || RANGES[state.range].label;
      engine.saveScanToStorage(result);
      state.lastScanResult = engine.loadCurrentScan() || result;
      engine.clearPendingScan();

      const d = new Date();
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      ui.setStatus(`${dateStr} · <span class="hide-mobile">${result.accounts.length} accounts · ${result.totalTweets} tweets · </span>${result.signals.length} signals`, false, true);
      ui.renderTickers(result.signals);
      ui.renderSignals(result.signals);
      ui.renderHistory();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      engine.clearPendingScan();
      ui.setStatus('Scan cancelled');
    } else {
      ui.setStatus('');
      $('notices').innerHTML = `<div class="notice err">${engine.esc(e.message)}</div>`;
    }
  } finally {
    state.busy = false;
    ui.setLoading(false);
    currentScanAbort = null;
  }
}

// ============================================================================
// SERVER HISTORY SYNC (with scan restoration)
// ============================================================================

async function loadServerHistory() {
  if (!auth.isAuthenticated()) return;
  try {
    const serverScans = await api.getScans();
    if (!Array.isArray(serverScans) || !serverScans.length) return;
    const serverHistory = serverScans.filter(s => s && s.created_at).map(s => ({
      id: s.id, date: s.created_at, range: s.range_label || '',
      accounts: Array.isArray(s.accounts) ? s.accounts.length : (parseInt(s.accounts) || 0),
      totalTweets: parseInt(s.total_tweets) || 0, signalCount: parseInt(s.signal_count) || 0,
      signals: engine.normalizeSignals(Array.isArray(s.signals) ? s.signals : []),
    }));
    state._serverHistory = serverHistory;
    ui.renderHistory(serverHistory);

    // Auto-restore latest scan if no current scan in localStorage
    if (!engine.loadCurrentScan() && serverScans[0]) {
      const latest = serverScans[0];
      const signals = engine.normalizeSignals(Array.isArray(latest.signals) ? latest.signals : []);
      state.lastScanResult = {
        date: latest.created_at || new Date().toISOString(),
        range: latest.range_label || '',
        days: parseInt(latest.range_days) || 1,
        accounts: Array.isArray(latest.accounts) ? latest.accounts : [],
        totalTweets: parseInt(latest.total_tweets) || 0,
        signals,
        tweetMeta: (latest.tweet_meta && typeof latest.tweet_meta === 'object') ? latest.tweet_meta : {},
      };
      const idx = RANGES.findIndex(r => r.label === latest.range_label);
      if (idx !== -1) { state.range = idx; ui.renderRanges(); }
      const d = new Date(state.lastScanResult.date);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      ui.setStatus(`${dateStr} · ${signals.length} signals (synced)`, false, true);
      ui.renderTickers(signals);
      ui.renderSignals(signals);
    }
  } catch (e) {
    console.warn('Failed to load server history:', e);
  }
}

// ============================================================================
// SCHEDULE MANAGEMENT
// ============================================================================

async function loadSchedules() {
  if (!auth.isAuthenticated()) { state.schedules = []; return; }
  state.schedulesLoading = true;
  try {
    const data = await api.getSchedules();
    const STALE_MS = 5 * 60000;
    const now = Date.now();
    state.schedules = (data || []).map(s => {
      if (s.last_run_status === 'running' && s.last_run_at) {
        if (now - new Date(s.last_run_at).getTime() > STALE_MS) {
          return { ...s, last_run_status: 'error', last_run_message: 'Scan timed out' };
        }
      }
      return s;
    });
  } catch (e) {
    console.warn('Failed to load schedules:', e);
  } finally {
    state.schedulesLoading = false;
  }
}

function updateNextScheduleLabel() {
  state.nextScheduleLabel = engine.getNextScheduleLabel(state.schedules);
}

let _visibilityHandler = null;

function startSchedulePolling() {
  if (state.scheduleInterval) clearInterval(state.scheduleInterval);

  const hasRunning = state.schedules.some(s => s.last_run_status === 'running');
  const hasActive = state.schedules.some(s => s.enabled);
  const next = engine.getNextScheduleTime(state.schedules);
  const isImminent = next ? (next.date.getTime() - Date.now() < 3 * 60000) : false;

  const pollMs = hasRunning ? 5000 : isImminent ? 15000 : hasActive ? 60000 : 60000;

  state.scheduleInterval = setInterval(async () => {
    updateNextScheduleLabel();
    if (hasActive || hasRunning) {
      const wasRunning = state.schedules.some(s => s.last_run_status === 'running');
      await loadSchedules();
      const nowRunning = state.schedules.some(s => s.last_run_status === 'running');
      if (wasRunning && !nowRunning) loadServerHistory();
      ui.renderTopbar();
      if ($('modal').classList.contains('open')) {
        ui.renderScheduleTab(state.schedules, state.schedulesLoading);
      }
    }
  }, pollMs);

  // Remove previous listener before adding a new one
  if (_visibilityHandler) document.removeEventListener('visibilitychange', _visibilityHandler);
  _visibilityHandler = () => {
    if (document.visibilityState === 'visible' && auth.isAuthenticated()) {
      updateNextScheduleLabel();
      loadSchedules().then(() => { ui.renderTopbar(); loadServerHistory(); });
    }
  };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

async function addSchedule(time) {
  if (!auth.isAuthenticated()) return;
  const accounts = state.getAllAccounts();
  if (!accounts.length) {
    console.warn('No accounts selected for schedule');
    return;
  }
  try {
    await api.saveSchedule({
      label: `Scan at ${engine.formatScheduleTime(time)}`,
      time,
      range_days: RANGES[state.range].days,
      accounts,
      timezone: engine.getBrowserTimezone(),
      days: [],
      enabled: true,
    });
    await loadSchedules();
    updateNextScheduleLabel();
    ui.renderScheduleTab(state.schedules, state.schedulesLoading);
    ui.renderTopbar();
  } catch (e) {
    console.warn('Failed to add schedule:', e.message);
  }
}

async function deleteScheduleById(id) {
  if (!auth.isAuthenticated()) return;
  state.schedules = state.schedules.filter(s => s.id !== id);
  ui.renderScheduleTab(state.schedules, state.schedulesLoading);
  try {
    await api.deleteSchedule(id);
  } catch (e) {
    console.warn('Failed to delete schedule:', e.message);
    await loadSchedules();
    ui.renderScheduleTab(state.schedules, state.schedulesLoading);
  }
  updateNextScheduleLabel();
  ui.renderTopbar();
}

async function toggleScheduleEnabled(id) {
  const schedule = state.schedules.find(s => s.id === id);
  if (!schedule) return;
  const enabled = !schedule.enabled;
  schedule.enabled = enabled;
  ui.renderScheduleTab(state.schedules, state.schedulesLoading);
  try {
    await api.saveSchedule({ ...schedule, enabled });
  } catch (e) {
    schedule.enabled = !enabled;
    ui.renderScheduleTab(state.schedules, state.schedulesLoading);
  }
  updateNextScheduleLabel();
  ui.renderTopbar();
}

// ============================================================================
// AUTH & PRICING MODAL HELPERS
// ============================================================================

function openAuthModal(tab = 'login') {
  ui.renderAuthModal(tab);
  openModal('authModal');
  setTimeout(() => $('authEmail')?.focus(), 50);
}

function openPricingModal() {
  ui.renderPricingModal();
  openModal('pricingModal');
}

function openUserMenuModal() {
  ui.renderUserMenuModal();
  openModal('userMenuModal');
}

// ============================================================================
// LIVE FEED
// ============================================================================

function toggleLive() {
  if (!engine.isLiveEnabled()) { openSettingsModal('data'); return; }
  if (state.isLiveMode) {
    stopLiveFeed();
  } else {
    if (!engine.canMakeApiCalls()) { openSettingsModal('api'); return; }
    state.isLiveMode = true;
    localStorage.setItem(LS_LIVE_MODE, 'true');
    $('liveBtn')?.classList.add('active');
    state.seenTweetUrls.clear();
    if (state.lastScanResult?.rawTweets) {
      state.lastScanResult.rawTweets.forEach(a => a.tweets.forEach(tw => state.seenTweetUrls.add(engine.getTweetUrl(tw))));
    }
    state.liveInterval = setInterval(pollForNewTweets, 90000);
    pollForNewTweets();
  }
}

function stopLiveFeed() {
  state.isLiveMode = false;
  localStorage.removeItem(LS_LIVE_MODE);
  $('liveBtn')?.classList.remove('active');
  if (state.liveInterval) { clearInterval(state.liveInterval); state.liveInterval = null; }
}

async function pollForNewTweets() {
  if (!state.isLiveMode || state.busy) return;
  const accounts = state.lastScanResult?.accounts || state.getAllAccounts();
  if (!accounts.length) { stopLiveFeed(); return; }
  try {
    const fresh = await engine.fetchAllTweets(accounts, 1/48, () => {}, null);
    const newTweets = [];
    for (const acct of fresh) {
      const unseen = acct.tweets.filter(tw => !state.seenTweetUrls.has(engine.getTweetUrl(tw)));
      if (unseen.length) {
        unseen.forEach(tw => state.seenTweetUrls.add(engine.getTweetUrl(tw)));
        newTweets.push({ account: acct.account, tweets: unseen });
      }
    }
    if (!newTweets.length) return;
    const cache = engine.loadAnalysisCache();
    const promptHash = engine.getPromptHash();
    const newSignals = await engine.analyzeWithBatching(
      newTweets, newTweets.reduce((s, a) => s + a.tweets.length, 0),
      () => {}, promptHash, cache, null
    );
    if (newSignals.length && state.lastScanResult) {
      state.lastScanResult.signals = [...engine.normalizeSignals(newSignals), ...state.lastScanResult.signals];
      state.lastScanResult.totalTweets += newTweets.reduce((s, a) => s + a.tweets.length, 0);
      ui.renderTickers(state.lastScanResult.signals);
      ui.renderSignals(state.lastScanResult.signals);
    }
  } catch (e) { console.warn('Live poll error:', e); }
}

// ============================================================================
// BILLING CALLBACK
// ============================================================================

async function handleBillingCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('billing') === 'success') {
    const sessionId = params.get('session_id');
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (sessionId) {
      try {
        const result = await api.verifyCheckout(sessionId);
        if (result.status === 'fulfilled') {
          await api.refreshProfile();
          ui.renderTopbar();
          $('notices').innerHTML = '<div class="notice" style="color:var(--green);background:var(--green-10)">Credits added! You\'re ready to scan.</div>';
          return;
        }
      } catch {}
    }
    // Fallback: poll for credits (with cleanup)
    let attempts = 0;
    if (state._billingPoll) clearInterval(state._billingPoll);
    state._billingPoll = setInterval(async () => {
      attempts++;
      try {
        const p = await api.refreshProfile();
        if (p && (p.credits_balance > 0 || p.subscription_status === 'active')) {
          clearInterval(state._billingPoll); state._billingPoll = null;
          ui.renderTopbar();
          $('notices').innerHTML = '<div class="notice" style="color:var(--green);background:var(--green-10)">Credits added! You\'re ready to scan.</div>';
        }
      } catch {}
      if (attempts >= 10) { clearInterval(state._billingPoll); state._billingPoll = null; }
    }, 2000);
  }
  if (params.get('billing') === 'cancel') {
    history.replaceState(null, '', window.location.pathname);
  }
}

// ============================================================================
// MOBILE TRADINGVIEW DEEP LINKS
// ============================================================================

function initMobileDeepLinks() {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) return;
  document.addEventListener('click', e => {
    const a = e.target.closest('.ticker-tag[data-sym], .ticker-item[data-sym]');
    if (!a || engine.getFinanceProvider() !== 'tradingview') return;
    const sym = a.dataset.sym;
    if (!sym) return;
    e.preventDefault();
    const webUrl = a.href || engine.tickerUrl('$' + sym);
    const tvSym = engine.getTvSymbol(sym);
    const deepUrl = `tradingview://chart?symbol=${tvSym}`;
    const t0 = Date.now();
    window.location.href = deepUrl;
    setTimeout(() => {
      if (document.hidden || Date.now() - t0 > 2000) return;
      window.open(webUrl, '_blank');
    }, 1500);
  });
}

// ============================================================================
// EVENT DELEGATION
// ============================================================================

function initEventDelegation() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-preset]');
    if (target) { loadPreset(target.dataset.preset); return; }

    const rmAcct = e.target.closest('[data-rm-account]');
    if (rmAcct) {
      state.customAccounts = state.customAccounts.filter(a => a !== rmAcct.dataset.rmAccount);
      engine.saveAccounts(state.customAccounts);
      ui.render();
      return;
    }

    const rangeBtn = e.target.closest('[data-range]');
    if (rangeBtn) { state.range = parseInt(rangeBtn.dataset.range); ui.renderRanges(); return; }

    // Category filter
    const filterBtn = e.target.closest('[data-filter-cat]');
    if (filterBtn) {
      const cat = filterBtn.dataset.filterCat;
      state.filters.category = state.filters.category === cat ? null : cat;
      ui.applyFilters(); ui.renderFilters();
      return;
    }

    // Ticker filter (click ticker in bar to filter signals)
    const tickerFilter = e.target.closest('[data-filter-ticker]');
    if (tickerFilter) {
      const ticker = tickerFilter.dataset.filterTicker;
      state.filters.ticker = state.filters.ticker === ticker ? null : ticker;
      ui.applyFilters(); ui.renderFilters();
      ui.renderTickers(state.lastScanResult?.signals || []);
      return;
    }

    // Clear ticker filter
    if (e.target.closest('[data-clear-ticker-filter]')) {
      state.filters.ticker = null;
      ui.applyFilters(); ui.renderFilters();
      ui.renderTickers(state.lastScanResult?.signals || []);
      return;
    }

    // Clear all filters
    if (e.target.closest('[data-clear-all-filters]')) {
      state.filters = { category: null, ticker: null };
      ui.applyFilters(); ui.renderFilters();
      ui.renderTickers(state.lastScanResult?.signals || []);
      return;
    }

    const shareBtn = e.target.closest('[data-share-index]');
    if (shareBtn) {
      const index = parseInt(shareBtn.dataset.shareIndex);
      const sig = state.lastScanResult?.signals?.[index];
      if (!sig) return;
      const encoded = engine.encodeSignal(sig);
      const url = `${location.origin}${location.pathname}#s=${encoded}`;
      navigator.clipboard.writeText(url).then(() => {
        shareBtn.classList.add('copied'); shareBtn.textContent = 'copied';
        setTimeout(() => { shareBtn.classList.remove('copied'); shareBtn.textContent = 'share'; }, 1500);
      }).catch(() => {});
      return;
    }

    const expandBtn = e.target.closest('[data-expand-id]');
    if (expandBtn) {
      const content = document.getElementById(expandBtn.dataset.expandId);
      if (content) {
        const isOpen = content.classList.toggle('open');
        expandBtn.textContent = isOpen ? 'hide tweet ▾' : 'show tweet ▸';
      }
      return;
    }

    // Presets modal
    const editPreset = e.target.closest('[data-edit-preset]');
    if (editPreset) { editPresetUI(editPreset.dataset.editPreset); return; }
    const deletePreset = e.target.closest('[data-delete-preset]');
    if (deletePreset) {
      engine.savePresetsData(engine.getPresets().filter(p => p.name !== deletePreset.dataset.deletePreset));
      ui.renderPresets(); ui.renderPresetList();
      return;
    }

    // Analyst actions
    const toggleAnalyst = e.target.closest('[data-toggle-analyst]');
    if (toggleAnalyst) { e.preventDefault(); ui.saveAnalystsFromUI(); const item = document.querySelector(`.analyst-item[data-analyst-id="${toggleAnalyst.dataset.toggleAnalyst}"]`); if (item) item.classList.toggle('open'); return; }
    const useAnalyst = e.target.closest('[data-use-analyst]');
    if (useAnalyst) { e.stopPropagation(); ui.saveAnalystsFromUI(); engine.setActiveAnalystId(useAnalyst.dataset.useAnalyst); ui.renderAnalystList(); return; }
    const dupAnalyst = e.target.closest('[data-dup-analyst]');
    if (dupAnalyst) { e.stopPropagation(); ui.saveAnalystsFromUI(); const src = (engine.getAnalysts() || []).find(a => a.id === dupAnalyst.dataset.dupAnalyst); if (src) { const all = [...(engine.getAnalysts() || []), { id: engine.generateAnalystId(), name: src.name + ' (copy)', prompt: src.prompt, isDefault: false }]; engine.saveAnalysts(all); ui.renderAnalystList(); } return; }
    const delAnalyst = e.target.closest('[data-del-analyst]');
    if (delAnalyst) { e.stopPropagation(); const id = delAnalyst.dataset.delAnalyst; if (id === DEFAULT_ANALYST_ID) return; if (!confirm('Delete this analyst?')) return; engine.saveAnalysts((engine.getAnalysts() || []).filter(a => a.id !== id)); if (engine.getActiveAnalystId() === id) engine.setActiveAnalystId(DEFAULT_ANALYST_ID); ui.renderAnalystList(); return; }
    const resetPrompt = e.target.closest('[data-reset-prompt]');
    if (resetPrompt) { const analysts = engine.getAnalysts() || []; const def = analysts.find(a => a.id === DEFAULT_ANALYST_ID); if (def) { def.prompt = DEFAULT_PROMPT; engine.saveAnalysts(analysts); } ui.renderAnalystList(); return; }

    // Settings tab switch
    const settingsTab = e.target.closest('[data-settings-tab]');
    if (settingsTab) { switchTab(settingsTab.dataset.settingsTab); return; }

    // Auth modal tab switch
    const authTab = e.target.closest('[data-auth-tab]');
    if (authTab) { ui.renderAuthModal(authTab.dataset.authTab); return; }

    // Buy credits
    const buyPack = e.target.closest('[data-buy-pack]');
    if (buyPack) {
      if (!auth.isAuthenticated()) { closeModal('pricingModal'); openAuthModal('signup'); return; }
      buyPack.disabled = true; buyPack.style.opacity = '0.5';
      api.buyCredits({ packId: buyPack.dataset.buyPack }).then(data => {
        if (data.url) window.location.href = data.url;
      }).catch(err => {
        const errorEl = $('pricingError');
        if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        buyPack.disabled = false; buyPack.style.opacity = '1';
      });
      return;
    }

    // Open settings from user menu / account tab
    const openSettings = e.target.closest('[data-open-settings]');
    if (openSettings) { closeModal('userMenuModal'); openSettingsModal(openSettings.dataset.openSettings); return; }

    // Schedule actions — quick-pick sets the time inputs
    const setTime = e.target.closest('[data-set-schedule-time]');
    if (setTime) {
      const [h, m] = setTime.dataset.setScheduleTime.split(':');
      const hInput = $('scheduleHourInput');
      const mInput = $('scheduleMinInput');
      if (hInput) hInput.value = h;
      if (mInput) mInput.value = m;
      return;
    }
    const toggleSchedule = e.target.closest('[data-toggle-schedule]');
    if (toggleSchedule) { toggleScheduleEnabled(toggleSchedule.dataset.toggleSchedule); return; }
    const delSchedule = e.target.closest('[data-delete-schedule]');
    if (delSchedule) { deleteScheduleById(delSchedule.dataset.deleteSchedule); return; }
  });

  // ID-based click handlers
  document.addEventListener('click', (e) => {
    const id = e.target.id || e.target.closest('[id]')?.id;
    switch (id) {
      case 'scanBtn': run(); break;
      case 'cancelScanBtn': if (currentScanAbort) { currentScanAbort.abort(); state.busy = false; ui.setLoading(false); ui.setStatus('Scan cancelled'); } break;
      case 'clearAllBtn': state.customAccounts = []; state.loadedPresets = []; engine.saveAccounts([]); engine.saveLoadedPresets([]); ui.render(); break;
      case 'openPresetBtn': state.editingPresetName = null; $('presetNameInput').value = ''; $('presetAccountsInput').value = state.getAllAccounts().join(', '); ui.renderPresetList(); openModal('presetModal'); break;
      case 'themeBtn': engine.setTheme(engine.getTheme() === 'dark' ? 'light' : 'dark'); break;
      case 'keyBtn': openSettingsModal(); break;
      case 'liveBtn': toggleLive(); break;
      case 'signInBtn': openAuthModal(); break;
      case 'userMenuBtn': openSettingsModal('account'); break;
      case 'dlBtn': if (state.lastScanResult) engine.downloadScanAsMarkdown(state.lastScanResult); break;
      case 'scheduleIndicatorBtn': openSettingsModal('schedule'); break;

      // Settings modal
      case 'closeSettingsBtn': case 'cancelSettingsBtn': closeModal('modal'); if (originalSettings.font) engine.setFont(originalSettings.font); if (originalSettings.fontSize) engine.setFontSize(originalSettings.fontSize); if (originalSettings.textCase) engine.setCase(originalSettings.textCase); break;
      case 'clearKeyBtn': localStorage.removeItem(LS_TW); localStorage.removeItem(LS_AN); localStorage.removeItem(LS_MODEL); $('twKeyInput').value = ''; $('keyInput').value = ''; populateModelSelector(null, engine.getModel()); closeModal('modal'); break;
      case 'saveKeysBtn': saveSettings(); break;

      // Preset modal
      case 'closePresetBtn': case 'cancelPresetBtn': closeModal('presetModal'); break;
      case 'savePresetBtn': savePreset(); break;

      // Auth modal
      case 'closeAuthBtn': closeModal('authModal'); break;
      case 'authSubmitBtn': handleAuthSubmit(); break;
      case 'forgotPwBtn': handleForgotPassword(); break;
      case 'googleSignInBtn': auth.signInGoogle(); break;

      // Pricing modal
      case 'closePricingBtn': closeModal('pricingModal'); break;
      case 'manageBillingBtn': case 'manageBillingBtn2': case 'manageBillingBtn3': api.getBillingPortalUrl().then(data => { if (data.url) window.location.href = data.url; }).catch(e => console.error(e)); break;

      // User menu
      case 'closeUserMenuBtn': closeModal('userMenuModal'); break;
      case 'buyCreditsBtn': closeModal('userMenuModal'); closeModal('modal'); openPricingModal(); break;
      case 'signOutBtn': auth.signOut().then(() => { closeModal('userMenuModal'); closeModal('modal'); state.schedules = []; ui.renderTopbar(); }); break;

      // Account tab actions
      case 'acctSignInBtn': case 'scheduleSignInBtn': closeModal('modal'); openAuthModal(); break;
      case 'acctSignOutBtn': auth.signOut().then(() => { state.schedules = []; ui.renderAccountTab(); ui.renderTopbar(); }); break;
      case 'acctBuyCreditsBtn': case 'acctBuyCreditsBtn2': closeModal('modal'); openPricingModal(); break;

      // Schedule add
      case 'addScheduleBtn': {
        const h = ($('scheduleHourInput')?.value || '').padStart(2, '0');
        const m = ($('scheduleMinInput')?.value || '').padStart(2, '0');
        const time = `${h}:${m}`;
        if (/^\d{2}:\d{2}$/.test(time)) addSchedule(time);
        break;
      }

      // Analyst
      case 'newAnalystBtn': ui.saveAnalystsFromUI(); {
        const newA = { id: engine.generateAnalystId(), name: 'New Analyst', prompt: DEFAULT_PROMPT, isDefault: false };
        const all = [...(engine.getAnalysts() || []), newA];
        engine.saveAnalysts(all);
        ui.renderAnalystList();
        const item = document.querySelector(`.analyst-item[data-analyst-id="${newA.id}"]`);
        if (item) { item.classList.add('open'); const ni = item.querySelector('.analyst-name-input'); if (ni) { ni.focus(); ni.select(); } }
      } break;
    }
  });
}

function loadPreset(name) {
  if (state.loadedPresets.includes(name)) {
    state.loadedPresets = state.loadedPresets.filter(n => n !== name);
  } else {
    state.loadedPresets.push(name);
  }
  engine.saveLoadedPresets(state.loadedPresets);
  ui.render();
}

function editPresetUI(name) {
  const preset = engine.getPresets().find(p => p.name === name);
  if (!preset) return;
  state.editingPresetName = name;
  $('presetNameInput').value = preset.name;
  $('presetAccountsInput').value = preset.accounts.join(', ');
  $('presetNameInput').focus();
  ui.renderPresetList();
}

function savePreset() {
  const name = $('presetNameInput').value.trim();
  const accts = $('presetAccountsInput').value.split(',').map(a => a.trim().replace(/^@/, '').toLowerCase()).filter(a => a);
  if (!name || !accts.length) return;
  let presets = engine.getPresets();
  if (state.editingPresetName) presets = presets.filter(p => p.name !== state.editingPresetName);
  presets = presets.filter(p => p.name !== name);
  presets.push({ name, accounts: accts });
  engine.savePresetsData(presets);
  if (state.editingPresetName && state.editingPresetName !== name && state.loadedPresets.includes(state.editingPresetName)) {
    state.loadedPresets = state.loadedPresets.map(n => n === state.editingPresetName ? name : n);
    engine.saveLoadedPresets(state.loadedPresets);
  }
  state.editingPresetName = null;
  ui.renderPresets(); ui.renderPresetList(); ui.render();
  $('presetNameInput').value = '';
  $('presetAccountsInput').value = '';
}

function saveSettings() {
  const tw = $('twKeyInput').value.trim();
  const an = $('keyInput').value.trim();
  const fp = $('financeProvider').value;
  const model = $('modelProvider').value;
  const font = $('fontProvider').value;
  const fontSize = $('fontSizeProvider').value;
  const textCase = $('caseProvider').value;
  const liveEnabled = $('liveEnabledToggle').checked;
  const stp = $('showTickerPriceToggle');
  if (stp) engine.setShowTickerPrice(stp.checked);

  if (tw) localStorage.setItem(LS_TW, tw); else localStorage.removeItem(LS_TW);
  if (an) localStorage.setItem(LS_AN, an); else localStorage.removeItem(LS_AN);
  localStorage.setItem(LS_FINANCE, fp);
  if (model) localStorage.setItem(LS_MODEL, model);
  originalSettings = { font, fontSize, textCase };
  engine.setFont(font);
  engine.setFontSize(fontSize);
  engine.setCase(textCase);
  engine.setLiveEnabled(liveEnabled);
  ui.saveAnalystsFromUI();
  closeModal('modal');
  $('liveBtn').style.display = liveEnabled ? 'flex' : 'none';
  if (state.lastScanResult?.signals) {
    ui.renderTickers(state.lastScanResult.signals);
    ui.renderSignals(state.lastScanResult.signals);
  }
}

async function handleAuthSubmit() {
  const tab = document.querySelector('[data-auth-tab].active')?.dataset?.authTab
    || document.querySelector('#authModal .modal-tab.active')?.dataset?.authTab
    || 'login';
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value.trim();
  const errorEl = $('authError');
  const msgEl = $('authMessage');

  if (!email || !password) { errorEl.textContent = 'Please enter your email and password'; errorEl.style.display = 'block'; return; }
  if (tab === 'signup' && password.length < 6) { errorEl.textContent = 'Password must be at least 6 characters'; errorEl.style.display = 'block'; return; }

  errorEl.style.display = 'none';
  msgEl.style.display = 'none';
  const btn = $('authSubmitBtn');
  btn.disabled = true; btn.textContent = '...';

  try {
    if (tab === 'login') {
      await auth.signInEmail(email, password);
      closeModal('authModal');
    } else {
      const result = await auth.signUp(email, password);
      if (result.access_token) {
        closeModal('authModal');
      } else {
        msgEl.textContent = 'Check your email for a confirmation link!';
        msgEl.style.display = 'block';
      }
    }
  } catch (e) {
    errorEl.textContent = e.message || 'Authentication failed';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = tab === 'login' ? 'Log in' : 'Create account';
  }
}

async function handleForgotPassword() {
  const email = $('authEmail').value.trim();
  if (!email) { $('authError').textContent = 'Please enter your email first'; $('authError').style.display = 'block'; return; }
  try {
    await auth.resetPassword(email);
    $('authMessage').textContent = 'Password reset email sent!';
    $('authMessage').style.display = 'block';
    $('authError').style.display = 'none';
  } catch (e) {
    $('authError').textContent = e.message || 'Failed to send reset email';
    $('authError').style.display = 'block';
  }
}

// ============================================================================
// INIT EVENT LISTENERS
// ============================================================================

function initInputListeners() {
  $('acctInput').addEventListener('input', function() {
    this.value = this.value.replace(/^@/, '');
    $('addBtn').classList.toggle('vis', this.value.trim().length > 0);
  });
  $('acctInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('acctInput').value.trim()) { e.preventDefault(); state.addAccount($('acctInput').value); }
  });
  $('addBtn').addEventListener('click', () => { if ($('acctInput').value.trim()) state.addAccount($('acctInput').value); });

  $('presetNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('presetAccountsInput').focus(); });
  $('presetAccountsInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePreset(); } });

  $('twKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('keyInput').focus(); });
  $('keyInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveSettings(); });
  let modelFetchTimer = null;
  $('keyInput').addEventListener('input', () => { clearTimeout(modelFetchTimer); modelFetchTimer = setTimeout(() => refreshModelList(), 600); });
  $('modelProvider').addEventListener('change', () => updateModelCostHint());
  $('fontProvider').addEventListener('change', e => engine.setFont(e.target.value));
  $('fontSizeProvider').addEventListener('change', e => engine.setFontSize(e.target.value));
  $('caseProvider').addEventListener('change', e => engine.setCase(e.target.value));

  // Modal backdrop clicks
  ['modal', 'presetModal', 'authModal', 'pricingModal', 'userMenuModal'].forEach(id => {
    let mouseDownTarget = null;
    $(id).addEventListener('mousedown', e => { mouseDownTarget = e.target; });
    $(id).addEventListener('click', e => {
      if (e.target === $(id) && mouseDownTarget === $(id)) {
        closeModal(id);
        if (id === 'modal') {
          if (originalSettings.font) engine.setFont(originalSettings.font);
          if (originalSettings.fontSize) engine.setFontSize(originalSettings.fontSize);
          if (originalSettings.textCase) engine.setCase(originalSettings.textCase);
        }
      }
      mouseDownTarget = null;
    });
  });

  $('clearCacheBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all cached analysis results?')) return;
    localStorage.removeItem('signal_analysis_cache');
    engine.clearPendingScan();
    updateCacheSizeDisplay();
  });

  $('exportBtn')?.addEventListener('click', async function() {
    const encoded = engine.exportDataToString(state.customAccounts, state.loadedPresets);
    await navigator.clipboard.writeText(encoded);
    this.textContent = 'Copied';
    setTimeout(() => { this.textContent = 'Export'; }, 1500);
  });
  $('importBtn')?.addEventListener('click', async function() {
    try {
      const encoded = await navigator.clipboard.readText();
      const json = engine.decodeBackup(encoded.trim());
      const data = JSON.parse(json);
      if (!data.v && !data.version) throw new Error('Invalid backup format');
      if (data.settings) {
        if (data.settings.theme) engine.setTheme(data.settings.theme);
        if (data.settings.font) engine.setFont(data.settings.font);
        if (data.settings.fontSize) engine.setFontSize(data.settings.fontSize);
        if (data.settings.textCase) engine.setCase(data.settings.textCase);
        if (data.settings.financeProvider) localStorage.setItem('signal_finance_provider', data.settings.financeProvider);
        if (data.settings.model) localStorage.setItem('signal_model', data.settings.model);
      }
      if (data.analysts) { engine.saveAnalysts(data.analysts); if (data.activeAnalyst) engine.setActiveAnalystId(data.activeAnalyst); }
      if (data.keys) { if (data.keys.twitter) localStorage.setItem('signal_twitter_key', data.keys.twitter); if (data.keys.anthropic) localStorage.setItem('signal_anthropic_key', data.keys.anthropic); }
      if (data.presets) engine.savePresetsData(data.presets);
      if (data.accounts) { state.customAccounts = data.accounts; engine.saveAccounts(data.accounts); }
      if (data.loadedPresets) { state.loadedPresets = data.loadedPresets; engine.saveLoadedPresets(data.loadedPresets); }
      if (data.recents) localStorage.setItem('signal_recent_accounts', JSON.stringify(data.recents));
      ui.render();
      this.textContent = 'Success'; this.style.color = 'var(--green)';
      setTimeout(() => { this.textContent = 'Import'; this.style.color = ''; }, 1500);
    } catch (err) {
      this.textContent = err.message.includes('clipboard') ? 'Clipboard error' : 'Invalid backup';
      this.style.color = 'var(--red)';
      setTimeout(() => { this.textContent = 'Import'; this.style.color = ''; }, 2000);
    }
  });
}

// ============================================================================
// SHARED SIGNAL CHECK
// ============================================================================

function checkSharedSignal() {
  const hash = location.hash;
  if (!hash.startsWith('#s=')) return false;
  const signal = engine.decodeSignal(hash.slice(3));
  if (!signal) return false;
  document.body.setAttribute('data-shared', '');
  $('sharedBanner').innerHTML = `<div class="shared-banner"><span class="shared-banner-text">shared signal</span><a href="${location.pathname}">← back to sentry</a></div>`;
  document.querySelector('.controls').style.display = 'none';
  ui.renderSharedSignal(signal);
  return true;
}

// ============================================================================
// DEV MODE (activated with ?dev=1 in URL)
// ============================================================================

const IS_DEV = new URLSearchParams(window.location.search).has('dev');

function loadMockSignals() {
  const now = new Date();
  const mockSignals = [
    { title: 'BTC breaks above $100k resistance with strong volume', summary: 'Bitcoin surged past $100,000, driven by institutional inflows and ETF demand. Multiple analysts raising year-end targets.', category: 'Trade', source: 'CryptoCapo_', tickers: [{ symbol: '$BTC', action: 'buy' }, { symbol: '$ETH', action: 'watch' }], tweet_url: 'https://x.com/CryptoCapo_/status/1234567890', links: [], tweet_time: new Date(now.getTime() - 15 * 60000).toISOString() },
    { title: 'NVIDIA announces next-gen AI chip, stock gaps up 8%', summary: 'NVIDIA unveiled Blackwell Ultra at GTC with 3x inference throughput. Supply constraints expected through Q3.', category: 'Trade', source: 'unusual_whales', tickers: [{ symbol: '$NVDA', action: 'buy' }, { symbol: '$AMD', action: 'buy' }, { symbol: '$INTC', action: 'sell' }], tweet_url: 'https://x.com/unusual_whales/status/1234567891', links: ['https://nvidia.com/gtc'], tweet_time: new Date(now.getTime() - 45 * 60000).toISOString() },
    { title: 'Fed signals potential rate cut in March meeting minutes', summary: 'FOMC minutes reveal growing consensus for easing. Bond yields falling, growth stocks rally. 85% probability of 25bp cut.', category: 'Insight', source: 'zaborowskigz', tickers: [{ symbol: '$SPY', action: 'watch' }, { symbol: '$TLT', action: 'buy' }, { symbol: '$QQQ', action: 'buy' }], tweet_url: 'https://x.com/zaborowskigz/status/1234567892', links: [], tweet_time: new Date(now.getTime() - 2 * 3600000).toISOString() },
    { title: 'Solana DeFi TVL hits new ATH as memecoin season heats up', summary: 'Total value locked in Solana DeFi surpassed $20B. Raydium and Jupiter seeing record volumes.', category: 'Insight', source: 'DefiIgnas', tickers: [{ symbol: '$SOL', action: 'buy' }, { symbol: '$JUP', action: 'hold' }], tweet_url: 'https://x.com/DefiIgnas/status/1234567893', links: ['https://defillama.com/chain/Solana'], tweet_time: new Date(now.getTime() - 5 * 3600000).toISOString() },
    { title: 'Apple reportedly in talks to acquire AI startup for $6B', summary: 'Sources say Apple is negotiating to buy an enterprise AI company to bolster on-device ML capabilities.', category: 'Trade', source: 'gaborGurbacs', tickers: [{ symbol: '$AAPL', action: 'buy' }, { symbol: '$MSFT', action: 'hold' }], tweet_url: 'https://x.com/gaborGurbacs/status/1234567894', links: ['https://bloomberg.com/apple-ai-acquisition'], tweet_time: new Date(now.getTime() - 8 * 3600000).toISOString() },
    { title: 'New on-chain analytics tool for tracking whale wallets', summary: 'Arkham Intelligence launched real-time whale tracking dashboard with alert capabilities. Free tier available.', category: 'Tool', source: 'lookonchain', tickers: [{ symbol: '$BTC', action: 'watch' }], tweet_url: 'https://x.com/lookonchain/status/1234567895', links: ['https://arkham.com/whale-tracker'], tweet_time: new Date(now.getTime() - 12 * 3600000).toISOString() },
    { title: 'TSLA earnings beat expectations, robotaxi timeline moved up', summary: 'Tesla Q4 earnings above consensus with improved margins. Musk confirmed robotaxi launch in Austin by Q2.', category: 'Trade', source: 'gaborGurbacs', tickers: [{ symbol: '$TSLA', action: 'buy' }, { symbol: '$UBER', action: 'sell' }], tweet_url: 'https://x.com/gaborGurbacs/status/1234567897', links: [], tweet_time: new Date(now.getTime() - 30 * 60000).toISOString() },
  ];
  state.lastScanResult = {
    date: now.toISOString(), range: 'Today', days: 1,
    accounts: ['CryptoCapo_', 'unusual_whales', 'zaborowskigz', 'DefiIgnas', 'gaborGurbacs', 'lookonchain'],
    totalTweets: 42, signals: mockSignals, tweetMeta: {},
  };
  ui.setStatus(`Mock data · 6 accounts · 42 tweets · ${mockSignals.length} signals`, false, true);
  ui.renderTickers(mockSignals);
  ui.renderSignals(mockSignals);
}

function initDevToolbar() {
  if (!IS_DEV) return;
  ui.renderDevToolbar();

  document.addEventListener('click', (e) => {
    // Credits switcher — mocks full auth + profile locally
    const creditsBtn = e.target.closest('[data-dev-credits]');
    if (creditsBtn) {
      const credits = parseInt(creditsBtn.dataset.devCredits);
      // Mock sign-in first (sets user + token), then set profile
      // _mockSignIn fires notifyAuthChange which is async, so we set profile
      // and re-render synchronously after
      auth._mockSignIn('dev@sentry.is');
      api._setMockProfile({
        _mock: true,
        id: 'dev-user', email: 'dev@sentry.is', name: 'Dev User',
        credits_balance: credits, has_credits: credits > 0,
        free_scan_available: credits === 0, subscription_status: credits > 0 ? 'active' : null,
      });
      // Re-render everything after mock state is set
      setTimeout(() => {
        ui.renderDevToolbar();
        ui.renderTopbar();
      }, 10);
      return;
    }

    // Dialog openers
    const openBtn = e.target.closest('[data-dev-open]');
    if (openBtn) {
      const target = openBtn.dataset.devOpen;
      // Hide onboarding when opening dev dialogs (except onboarding itself)
      if (target !== 'onboarding') ui.hideOnboarding();
      if (target === 'auth') openAuthModal();
      else if (target === 'account') openSettingsModal('account');
      else if (target === 'pricing') openPricingModal();
      else if (target === 'settings') openSettingsModal('api');
      else if (target === 'onboarding') startOnboarding();
      return;
    }

    if (e.target.id === 'devLogout') {
      auth._mockSignOut();
      api._setMockProfile(null);
      ui.renderDevToolbar();
      ui.renderTopbar();
      return;
    }
    if (e.target.id === 'devMockSignals') { loadMockSignals(); return; }
    if (e.target.id === 'devCollapse') { ui.collapseDevToolbar(); return; }
  });
}

// api._setMockProfile is exported from api.js for dev mode

// ============================================================================
// ONBOARDING FLOW
// ============================================================================

const onboardingState = { current: 0, path: null, selectedAnalysts: new Set() };

function startOnboarding() {
  onboardingState.current = 0;
  onboardingState.path = null;
  onboardingState.selectedAnalysts = new Set();
  ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
  initOnboardingListeners();
}

function completeOnboarding() {
  // Create selected analysts
  for (const sa of ui.SUGGESTED_ANALYSTS) {
    if (onboardingState.selectedAnalysts.has(sa.id)) {
      const existing = (engine.getAnalysts() || []).find(a => a.name === sa.name);
      if (!existing) {
        const all = [...(engine.getAnalysts() || []), { id: engine.generateAnalystId(), name: sa.name, prompt: sa.prompt, isDefault: false }];
        engine.saveAnalysts(all);
      }
    }
  }
  engine.setOnboardingDone(true);
  ui.hideOnboarding();
  ui.renderTopbar();
  ui.render();
}

function onboardingAction(action, data) {
  // Placeholder for advanced onboarding actions
}

function initOnboardingListeners() {
  // Use event delegation on the onboarding container
  const container = $('onboarding');
  if (!container) return;

  // Remove old listener if any
  container._obHandler && container.removeEventListener('click', container._obHandler);

  const handler = async (e) => {
    if (e.target.closest('[data-ob-next]')) {
      // Save BYOK keys if on that path
      if (onboardingState.current === 1 && onboardingState.path === 'byok') {
        const tw = $('obTwKey')?.value?.trim();
        const an = $('obAnKey')?.value?.trim();
        if (tw) localStorage.setItem('signal_twitter_key', tw);
        if (an) localStorage.setItem('signal_anthropic_key', an);
      }
      if (onboardingState.current < 4) {
        onboardingState.current++;
        ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      }
      return;
    }
    if (e.target.closest('[data-ob-back]')) {
      if (onboardingState.current === 1) onboardingState.path = null;
      if (onboardingState.current > 0) {
        onboardingState.current--;
        ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      }
      return;
    }
    if (e.target.closest('[data-ob-finish]')) {
      completeOnboarding();
      return;
    }
    const pathBtn = e.target.closest('[data-ob-path]');
    if (pathBtn) {
      onboardingState.path = pathBtn.dataset.obPath || null;
      ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      return;
    }
    const presetBtn = e.target.closest('[data-ob-preset]');
    if (presetBtn) {
      const name = presetBtn.dataset.obPreset;
      if (state.loadedPresets.includes(name)) {
        state.loadedPresets = state.loadedPresets.filter(n => n !== name);
      } else {
        state.loadedPresets.push(name);
      }
      engine.saveLoadedPresets(state.loadedPresets);
      ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      return;
    }
    const analystBtn = e.target.closest('[data-ob-analyst]');
    if (analystBtn) {
      const id = analystBtn.dataset.obAnalyst;
      if (onboardingState.selectedAnalysts.has(id)) onboardingState.selectedAnalysts.delete(id);
      else onboardingState.selectedAnalysts.add(id);
      ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      return;
    }
    const rmAccount = e.target.closest('[data-ob-rm-account]');
    if (rmAccount) {
      state.customAccounts = state.customAccounts.filter(a => a !== rmAccount.dataset.obRmAccount);
      engine.saveAccounts(state.customAccounts);
      ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      return;
    }
    if (e.target.id === 'obAddAccountBtn') {
      const input = $('obAccountInput');
      const val = input?.value?.trim()?.replace(/^@/, '')?.toLowerCase();
      if (val && !state.customAccounts.includes(val)) {
        state.customAccounts.push(val);
        engine.saveAccounts(state.customAccounts);
        input.value = '';
        ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      }
      return;
    }
    if (e.target.id === 'obGoogleBtn') {
      auth.signInGoogle();
      return;
    }
    if (e.target.id === 'obLoginBtn' || e.target.id === 'obSignupBtn') {
      const email = $('obEmail')?.value?.trim();
      const password = $('obPassword')?.value?.trim();
      const errorEl = $('obAuthError');
      const msgEl = $('obAuthMsg');
      if (!email || !password) { if (errorEl) { errorEl.textContent = 'Enter email and password'; errorEl.style.display = 'block'; } return; }
      if (e.target.id === 'obSignupBtn' && password.length < 6) { if (errorEl) { errorEl.textContent = 'Password must be at least 6 characters'; errorEl.style.display = 'block'; } return; }
      if (errorEl) errorEl.style.display = 'none';
      if (msgEl) msgEl.style.display = 'none';
      try {
        if (e.target.id === 'obLoginBtn') {
          await auth.signInEmail(email, password);
          // Auth change callback will handle the rest
          onboardingState.current++;
          ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
        } else {
          const result = await auth.signUp(email, password);
          if (result.access_token) {
            onboardingState.current++;
            ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
          } else if (msgEl) {
            msgEl.textContent = 'Check your email for a confirmation link!';
            msgEl.style.display = 'block';
          }
        }
      } catch (err) {
        if (errorEl) { errorEl.textContent = err.message || 'Auth failed'; errorEl.style.display = 'block'; }
      }
      return;
    }
  };

  container.addEventListener('click', handler);
  container._obHandler = handler;

  // Enter key for account input
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'obAccountInput') {
      e.preventDefault();
      $('obAddAccountBtn')?.click();
    }
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  engine.initAnalysts();

  engine.setTheme(engine.getTheme());
  engine.setFont(engine.getFont());
  engine.setFontSize(engine.getFontSize());
  engine.setCase(engine.getCase());

  // Initialize auth
  await auth.init();

  auth.onAuthChange(async ({ authenticated }) => {
    if (authenticated) {
      await api.init();
      loadServerHistory();
      loadSchedules().then(() => {
        updateNextScheduleLabel();
        startSchedulePolling();
        ui.renderTopbar();
      });
    } else {
      state.schedules = [];
    }
    ui.renderTopbar();
    if (IS_DEV) ui.renderDevToolbar();
  });

  if (auth.isAuthenticated()) {
    await api.init();
  }

  await handleBillingCallback();

  if (checkSharedSignal()) {
    console.log('Sentry initialized (shared view)');
    return;
  }

  state.customAccounts = engine.loadStoredAccounts();
  state.loadedPresets = engine.loadStoredLoadedPresets();

  engine.cleanupTweetCache();

  initEventDelegation();
  initInputListeners();
  ui.initChartPreview();
  initMobileDeepLinks();
  initDevToolbar();

  ui.renderTopbar();
  ui.render();
  ui.renderHistory();

  // Show onboarding for new users
  if (!engine.isOnboardingDone()) {
    startOnboarding();
  }

  const savedScan = engine.loadCurrentScan();
  if (savedScan) {
    state.lastScanResult = savedScan;
    if (savedScan.range) {
      const idx = RANGES.findIndex(r => r.label === savedScan.range);
      if (idx !== -1) { state.range = idx; ui.renderRanges(); }
    }
    const d = new Date(savedScan.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    ui.setStatus(`${dateStr} · <span class="hide-mobile">${savedScan.accounts.length} accounts · ${savedScan.totalTweets} tweets · </span>${savedScan.signals.length} signals`, false, true);
    ui.renderTickers(savedScan.signals);
    ui.renderSignals(savedScan.signals);
  }

  const pendingScan = engine.loadPendingScan();
  if (pendingScan) {
    const totalTweets = pendingScan.accountTweets.reduce((s, a) => s + a.tweets.length, 0);
    const ago = Math.round((Date.now() - new Date(pendingScan.date).getTime()) / 60000);
    $('notices').innerHTML = `<div class="notice resume-banner">
      <span>Interrupted scan detected (${pendingScan.accounts.length} accounts · ${totalTweets} tweets · ${ago < 1 ? 'just now' : ago + 'm ago'})</span>
      <span style="display:flex;gap:6px;margin-left:auto">
        <button class="resume-btn" id="resumeBtn">Resume</button>
        <button class="dismiss-btn" id="dismissBtn">✕</button>
      </span>
    </div>`;
    $('resumeBtn')?.addEventListener('click', resumeScan);
    $('dismissBtn')?.addEventListener('click', () => { engine.clearPendingScan(); $('notices').innerHTML = ''; });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (engine.isLiveEnabled() && localStorage.getItem(LS_LIVE_MODE) === 'true' && savedScan) {
    setTimeout(toggleLive, 1000);
  }

  if (auth.isAuthenticated()) {
    loadServerHistory();
    loadSchedules().then(() => {
      updateNextScheduleLabel();
      startSchedulePolling();
      ui.renderTopbar();
    });
  }

  console.log('Sentry initialized' + (IS_DEV ? ' (dev mode)' : ''));
}

init();
