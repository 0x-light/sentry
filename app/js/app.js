// ============================================================================
// SENTRY — Main Application Entry Point
// ============================================================================
//
// State management, event wiring, initialization.
// Imports all modules and orchestrates the app.
//

import {
  RANGES, DEFAULT_PROMPT, DEFAULT_ANALYST_ID, LS_TW, LS_AN, LS_FINANCE, LS_MODEL, LS_LIVE_MODE,
  LS_LAST_SCHEDULED_NOTICE, LS_PENDING_SCHEDULED_SCAN,
} from './config.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as engine from './engine.js';
import * as ui from './ui.js';
import { normalizeAccountHandle, normalizeAccountList } from './validation.js';

const $ = id => document.getElementById(id);

function renderNotice(message, type = 'error') {
  const cls = type === 'warning' ? 'warn' : 'err';
  $('notices').innerHTML = `<div class="notice ${cls}">${engine.esc(message)}</div>`;
}

function loadScheduledNoticeKey() {
  try {
    return localStorage.getItem(LS_LAST_SCHEDULED_NOTICE) || '';
  } catch {
    return '';
  }
}

function saveScheduledNoticeKey(key) {
  try { localStorage.setItem(LS_LAST_SCHEDULED_NOTICE, key || ''); } catch {}
}

function loadPendingScheduledScanKey() {
  try {
    return localStorage.getItem(LS_PENDING_SCHEDULED_SCAN) || '';
  } catch {
    return '';
  }
}

function savePendingScheduledScanKey(key) {
  try {
    if (key) localStorage.setItem(LS_PENDING_SCHEDULED_SCAN, key);
    else localStorage.removeItem(LS_PENDING_SCHEDULED_SCAN);
  } catch {}
}

function isScheduledScan(scan) {
  if (!scan) return false;
  if (scan.scheduled === true) return true;
  const label = String(scan.range_label || scan.range || '').toLowerCase();
  return label.includes('scheduled');
}

function getScanNoticeKey(scan) {
  if (!scan) return '';
  return String(scan.id || scan.created_at || scan.date || '');
}

function markScheduledNoticeSeen(key) {
  if (!key) return;
  state.lastScheduledNoticeKey = key;
  saveScheduledNoticeKey(key);
  if (auth.isAuthenticated()) {
    api.saveSettings({ scheduled_last_viewed_scan_key: key }).catch((e) => {
      console.warn('Failed to sync scheduled notice state:', e.message);
    });
  }
}

function pushCurrentScanIntoHistory(exceptScanKey = '') {
  const prev = state.lastScanResult;
  if (!prev?.signals?.length) return;

  const prevKey = getScanNoticeKey(prev);
  if (exceptScanKey && prevKey && prevKey === exceptScanKey) return;

  const prevEntry = {
    id: prev.id || null,
    date: prev.date || new Date().toISOString(),
    range: prev.range || '',
    accounts: Array.isArray(prev.accounts) ? prev.accounts.length : 0,
    totalTweets: prev.totalTweets || 0,
    signalCount: prev.signals.length,
    signals: prev.signals,
  };

  const history = Array.isArray(state._serverHistory) ? state._serverHistory : engine.getScanHistory();
  const alreadyInHistory = history.some((scan) => {
    if (prevEntry.id && scan?.id) return scan.id === prevEntry.id;
    return scan?.date === prevEntry.date;
  });
  if (alreadyInHistory) return;

  state._serverHistory = [prevEntry, ...history];
  ui.renderHistory(state._serverHistory);
}

function renderScanResult(scan) {
  if (!scan) return;
  state.lastScanResult = scan;
  if (scan.range) {
    const idx = RANGES.findIndex(r => r.label === scan.range);
    if (idx !== -1) { state.range = idx; ui.renderRanges(); }
  }
  const d = new Date(scan.date || Date.now());
  const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const accountsCount = Array.isArray(scan.accounts) ? scan.accounts.length : (parseInt(scan.accounts, 10) || 0);
  const totalTweets = parseInt(scan.totalTweets, 10) || 0;
  const signals = engine.normalizeSignals(Array.isArray(scan.signals) ? scan.signals : []);
  ui.setStatus(`${dateStr} · <span class="hide-mobile">${accountsCount} accounts · ${totalTweets} tweets · </span>${signals.length} signals`, false, true);
  ui.renderTickers(signals);
  ui.renderSignals(signals);
}

function clearPendingScheduledScan() {
  state.pendingScheduledScanKey = '';
  savePendingScheduledScanKey('');
}

function queuePendingScheduledScan(scan) {
  const key = getScanNoticeKey(scan);
  if (!key) return;
  state.pendingScheduledScanKey = key;
  savePendingScheduledScanKey(key);
}

function showScheduledScanNotice(scan) {
  const key = getScanNoticeKey(scan);
  if (!key) return;
  if (state.lastScheduledNoticeKey === key && state.pendingScheduledScanKey !== key) return;

  const notices = $('notices');
  if (!notices) return;

  const signalCount = Array.isArray(scan.signals) ? scan.signals.length : (parseInt(scan.signal_count, 10) || 0);
  const d = new Date(scan.created_at || scan.date || Date.now());
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msg = `Scheduled scan complete · ${signalCount} signals · ${timeStr}`;

  const banner = document.createElement('div');
  banner.className = 'notice sched-banner';
  banner.innerHTML = `<span>${engine.esc(msg)}</span>
    <span style="display:flex;gap:6px;margin-left:auto">
      <button class="resume-btn" type="button">View results</button>
    </span>`;

  banner.querySelector('.resume-btn')?.addEventListener('click', () => {
    pushCurrentScanIntoHistory(key);
    markScheduledNoticeSeen(key);
    clearPendingScheduledScan();
    renderScanResult(scan);
    banner.remove();
    const resultsEl = $('results');
    if (!resultsEl) return;
    const top = Math.max(resultsEl.getBoundingClientRect().top + window.scrollY - 12, 0);
    window.scrollTo({ top, behavior: 'smooth' });
  });

  notices.querySelector('.notice.sched-banner')?.remove();
  notices.prepend(banner);
}

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
  lastScheduledNoticeKey: loadScheduledNoticeKey(),
  pendingScheduledScanKey: loadPendingScheduledScanKey(),

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
    const c = normalizeAccountHandle(h);
    if (!c) {
      renderNotice('Invalid account name. Use Twitter handles only (letters, numbers, underscore, max 15).');
      return;
    }
    if (!state.customAccounts.includes(c)) state.customAccounts.push(c);
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

function openSettingsModal(tab) {
  $('twKeyInput').value = engine.getTwKey();
  $('keyInput').value = engine.getAnKey();
  $('financeProvider').value = engine.getFinanceProvider();
  $('fontProvider').value = engine.getFont();
  $('fontSizeProvider').value = engine.getFontSize();
  $('caseProvider').value = engine.getCase();
  $('liveEnabledToggle').checked = engine.isLiveEnabled();
  const stp = $('showTickerPriceToggle');
  if (stp) stp.checked = engine.getShowTickerPrice();
  ui.renderAnalystList();
  ui.renderAccountTab();
  ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });

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
      $('notices').innerHTML = `<div class="notice err">Weekly free scan used. Come back next week or <button class="notice-btn" data-open-pricing>Get credits</button></div>`;
      return;
    }
    if (!hasCredits && accounts.length > 150) {
      openPricingModal();
      $('notices').innerHTML = `<div class="notice err">Free tier allows up to 150 accounts. Buy credits for more.</div>`;
      return;
    }
  }

  const hasBYOK = engine.bothKeys();
  if (!hasBYOK && !hasCredits) { openSettingsModal('api'); return; }

  if (currentScanAbort) currentScanAbort.abort();
  currentScanAbort = new AbortController();

  // Fold current scan into history before clearing
  pushCurrentScanIntoHistory();

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
          $('notices').innerHTML += `<div class="notice warn">~${remaining.toLocaleString()} credits will remain after this scan. <button class="notice-btn" data-open-pricing>Top up</button></div>`;
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

      // Update seen tweet URLs for live mode (bounded to prevent unbounded growth)
      if (result.rawTweets) {
        result.rawTweets.forEach(a => (a.tweets || []).forEach(tw => state.seenTweetUrls.add(engine.getTweetUrl(tw))));
        // Cap seenTweetUrls to prevent memory leaks during long-running live sessions
        if (state.seenTweetUrls.size > 50000) {
          const arr = [...state.seenTweetUrls];
          state.seenTweetUrls = new Set(arr.slice(-25000));
        }
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
              $('notices').innerHTML += `<div class="notice err">Credits depleted. <button class="notice-btn" data-open-pricing>Get credits</button></div>`;
            } else if (bal < 500) {
              $('notices').innerHTML += `<div class="notice warn">${bal.toLocaleString()} credits remaining. <button class="notice-btn" data-open-pricing>Top up</button></div>`;
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
// SHARE SCAN
// ============================================================================

async function shareScan() {
  const scan = state.lastScanResult;
  if (!scan || !scan.signals?.length) return;
  if (!auth.isAuthenticated()) return;

  const btn = $('shareScanBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const result = await api.shareScan({
      signals: scan.signals,
      range_label: scan.range || '',
      range_days: scan.days || 1,
      accounts_count: Array.isArray(scan.accounts) ? scan.accounts.length : 0,
      total_tweets: scan.totalTweets || 0,
      signal_count: scan.signals.length,
      tweet_meta: scan.tweetMeta || {},
    });
    if (result?.id) {
      const url = `${location.origin}${location.pathname}#scan=${result.id}`;
      await navigator.clipboard.writeText(url);
      btn.innerHTML = '✓ <span class="hide-mobile">Copied</span>';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = '↑ <span class="hide-mobile">Share</span>';
        btn.classList.remove('copied');
        btn.disabled = false;
      }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Error';
    setTimeout(() => {
      btn.innerHTML = '↑ <span class="hide-mobile">Share</span>';
      btn.disabled = false;
    }, 2000);
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

    // Show latest server scan if it's newer than local, or if no local scan exists
    if (serverScans[0]) {
      const latest = serverScans[0];
      const localScan = engine.loadCurrentScan();
      const serverDate = new Date(latest.created_at).getTime();
      const localDate = localScan ? new Date(localScan.date).getTime() : 0;

      if (serverDate > localDate) {
        const signals = engine.normalizeSignals(Array.isArray(latest.signals) ? latest.signals : []);
        const isScheduled = isScheduledScan(latest);
        const loadedScan = {
          id: latest.id || null,
          date: latest.created_at || new Date().toISOString(),
          range: latest.range_label || '',
          days: parseInt(latest.range_days) || 1,
          accounts: Array.isArray(latest.accounts) ? latest.accounts : [],
          totalTweets: parseInt(latest.total_tweets) || 0,
          signals,
          tweetMeta: (latest.tweet_meta && typeof latest.tweet_meta === 'object') ? latest.tweet_meta : {},
          scheduled: isScheduled,
        };
        engine.saveScanToStorage(loadedScan, true);
        const scanKey = getScanNoticeKey(loadedScan);
        if (isScheduled && scanKey && scanKey !== state.lastScheduledNoticeKey) {
          queuePendingScheduledScan(loadedScan);
          showScheduledScanNotice(loadedScan);
          return;
        }
        clearPendingScheduledScan();
        renderScanResult(loadedScan);
      }
    }
  } catch (e) {
    console.warn('Failed to load server history:', e);
  }
}

function mapServerTextCase(value) {
  if (value === 'lower' || value === 'sentence') return value;
  if (value === 'lowercase') return 'lower';
  return 'sentence';
}

async function syncSettingsFromServer() {
  if (!auth.isAuthenticated()) return;
  try {
    const settings = await api.getSettings();
    if (!settings || typeof settings !== 'object') return;

    if (typeof settings.theme === 'string') engine.setTheme(settings.theme);
    if (typeof settings.font === 'string') engine.setFont(settings.font);
    if (typeof settings.font_size === 'string') engine.setFontSize(settings.font_size);
    if (typeof settings.text_case === 'string') engine.setCase(mapServerTextCase(settings.text_case));
    if (typeof settings.finance_provider === 'string') localStorage.setItem(LS_FINANCE, settings.finance_provider);
    if (typeof settings.model === 'string') localStorage.setItem(LS_MODEL, settings.model);
    if (typeof settings.live_enabled === 'boolean') engine.setLiveEnabled(settings.live_enabled);
    if (typeof settings.scheduled_last_viewed_scan_key === 'string') {
      state.lastScheduledNoticeKey = settings.scheduled_last_viewed_scan_key.trim();
      saveScheduledNoticeKey(state.lastScheduledNoticeKey);
    }
  } catch (e) {
    console.warn('Failed to load server settings:', e.message);
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
    const allPresets = engine.getPresets().filter(p => !p.hidden && p.accounts.length > 0);
    state.schedules = (data || []).map(s => {
      if (s.last_run_status === 'running' && s.last_run_at) {
        if (now - new Date(s.last_run_at).getTime() > STALE_MS) {
          s = { ...s, last_run_status: 'error', last_run_message: 'Scan timed out' };
        }
      }
      // Backfill preset_names for legacy schedules and rebuild accounts from presets
      if (!s.preset_names || !s.preset_names.length) {
        const schedAccounts = new Set((s.accounts || []).map(a => a.toLowerCase()));
        const inferred = allPresets
          .filter(p => p.accounts.length > 0 && p.accounts.every(a => schedAccounts.has(a.toLowerCase())))
          .map(p => p.name);
        if (inferred.length > 0) {
          // Rebuild accounts from matched presets only
          const rebuilt = new Set();
          allPresets.filter(p => inferred.includes(p.name)).forEach(p => p.accounts.forEach(a => rebuilt.add(a.toLowerCase())));
          s = { ...s, preset_names: inferred, accounts: [...rebuilt] };
          api.saveSchedule({ ...s }).catch(() => {});
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

function stopSchedulePolling() {
  if (state.scheduleInterval) {
    clearInterval(state.scheduleInterval);
    state.scheduleInterval = null;
  }
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
}

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
        ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
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

async function addSchedule(time, { presetOverride } = {}) {
  if (!auth.isAuthenticated()) {
    console.warn('Cannot add schedule: not authenticated');
    openAuthModal();
    return;
  }
  const presetNames = presetOverride ? [...presetOverride] : [...state.loadedPresets];
  // Build accounts from the preset list
  const allPresets = engine.getPresets();
  const accountSet = new Set();
  for (const name of presetNames) {
    const p = allPresets.find(pr => pr.name === name);
    if (p) p.accounts.forEach(a => accountSet.add(a));
  }
  if (!presetOverride) {
    state.customAccounts.forEach(a => accountSet.add(a));
  }
  if (!accountSet.size) {
    console.warn('Cannot add schedule: no accounts selected');
    $('notices').innerHTML = '<div class="notice warn">Select at least one account or preset before scheduling.</div>';
    return;
  }
  try {
    await api.saveSchedule({
      label: `Scan at ${engine.formatScheduleTime(time)}`,
      time,
      range_days: RANGES[state.range].days,
      accounts: [...accountSet],
      preset_names: presetNames,
      timezone: engine.getBrowserTimezone(),
      days: [],
      enabled: true,
    });
    await loadSchedules();
    updateNextScheduleLabel();
    ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
    ui.renderTopbar();
  } catch (e) {
    console.warn('Failed to add schedule:', e.message);
  }
}

async function deleteScheduleById(id) {
  if (!auth.isAuthenticated()) return;
  state.schedules = state.schedules.filter(s => s.id !== id);
  ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  try {
    await api.deleteSchedule(id);
  } catch (e) {
    console.warn('Failed to delete schedule:', e.message);
    await loadSchedules();
    ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  }
  updateNextScheduleLabel();
  ui.renderTopbar();
}

async function toggleScheduleEnabled(id) {
  const schedule = state.schedules.find(s => s.id === id);
  if (!schedule) return;
  const enabled = !schedule.enabled;
  schedule.enabled = enabled;
  ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  try {
    await api.saveSchedule({ ...schedule, enabled });
  } catch (e) {
    schedule.enabled = !enabled;
    ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  }
  updateNextScheduleLabel();
  ui.renderTopbar();
}

async function toggleSchedulePreset(scheduleId, presetName) {
  const schedule = state.schedules.find(s => s.id === scheduleId);
  if (!schedule) return;
  const allPresets = engine.getPresets().filter(p => !p.hidden && p.accounts.length > 0);
  const preset = allPresets.find(p => p.name === presetName);
  if (!preset || !preset.accounts.length) return;

  const prevAccounts = [...(schedule.accounts || [])];
  const prevPresetNames = [...(schedule.preset_names || [])];

  // Toggle the preset name
  const selectedNames = new Set(schedule.preset_names || []);
  if (selectedNames.has(presetName)) {
    selectedNames.delete(presetName);
  } else {
    selectedNames.add(presetName);
  }

  // Rebuild accounts from selected presets
  const newAccounts = new Set();
  allPresets.forEach(p => {
    if (selectedNames.has(p.name)) p.accounts.forEach(a => newAccounts.add(a.toLowerCase()));
  });

  schedule.preset_names = [...selectedNames];
  schedule.accounts = [...newAccounts];

  ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  try {
    await api.saveSchedule({ ...schedule });
  } catch (e) {
    schedule.accounts = prevAccounts;
    schedule.preset_names = prevPresetNames;
    ui.renderScheduleTab(state.schedules, state.schedulesLoading, { devMode: IS_DEV });
  }
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
    const a = e.target.closest('.ticker-tag[data-sym]');
    if (!a || engine.getFinanceProvider() !== 'tradingview') return;
    const sym = a.dataset.sym;
    if (!sym) return;
    e.preventDefault();
    const webUrl = a.href || engine.tickerUrl('$' + sym);
    const tvSym = engine.getTvSymbol(sym);
    const deepUrl = `tradingview://chart/?symbol=${encodeURIComponent(tvSym)}`;
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
    const useAnalyst = e.target.closest('[data-use-analyst]');
    if (useAnalyst) { e.stopPropagation(); ui.saveAnalystsFromUI(); engine.setActiveAnalystId(useAnalyst.dataset.useAnalyst); ui.renderAnalystList(); return; }
    const dupAnalyst = e.target.closest('[data-dup-analyst]');
    if (dupAnalyst) { e.stopPropagation(); ui.saveAnalystsFromUI(); const src = (engine.getAnalysts() || []).find(a => a.id === dupAnalyst.dataset.dupAnalyst); if (src) { const all = [...(engine.getAnalysts() || []), { id: engine.generateAnalystId(), name: src.name + ' (copy)', prompt: src.prompt, isDefault: false }]; engine.saveAnalysts(all); ui.renderAnalystList(); } return; }
    const delAnalyst = e.target.closest('[data-del-analyst]');
    if (delAnalyst) { e.stopPropagation(); const id = delAnalyst.dataset.delAnalyst; if (id === DEFAULT_ANALYST_ID) return; if (!confirm('Delete this analyst?')) return; engine.saveAnalysts((engine.getAnalysts() || []).filter(a => a.id !== id)); if (engine.getActiveAnalystId() === id) engine.setActiveAnalystId(DEFAULT_ANALYST_ID); ui.renderAnalystList(); return; }
    const toggleAnalyst = e.target.closest('[data-toggle-analyst]');
    if (toggleAnalyst) { e.preventDefault(); ui.saveAnalystsFromUI(); const item = document.querySelector(`.analyst-item[data-analyst-id="${toggleAnalyst.dataset.toggleAnalyst}"]`); if (item) item.classList.toggle('open'); return; }
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

    // Open pricing modal from anywhere
    const openPricing = e.target.closest('[data-open-pricing]');
    if (openPricing) { e.preventDefault(); openPricingModal(); return; }

    // Schedule — tap hour to toggle (add or remove)
    const quickSchedule = e.target.closest('[data-quick-schedule]');
    if (quickSchedule) {
      const time = quickSchedule.dataset.quickSchedule;
      // Check if a schedule already exists at this hour
      const existing = (state.schedules || []).find(s => s.time === time && s.enabled);
      if (existing) {
        deleteScheduleById(existing.id);
      } else {
        addSchedule(time);
      }
      return;
    }
    const schedPreset = e.target.closest('[data-schedule-preset]');
    if (schedPreset) {
      const val = schedPreset.dataset.schedulePreset;
      const idx = val.indexOf(':');
      const scheduleId = val.slice(0, idx);
      const presetName = val.slice(idx + 1);
      toggleSchedulePreset(scheduleId, presetName);
      return;
    }
    const toggleSchedule = e.target.closest('[data-toggle-schedule]');
    if (toggleSchedule) { toggleScheduleEnabled(toggleSchedule.dataset.toggleSchedule); return; }
    const delSchedule = e.target.closest('[data-delete-schedule]');
    if (delSchedule) { deleteScheduleById(delSchedule.dataset.deleteSchedule); return; }

    // Dev mode — add schedule at exact HH:MM
    if (e.target.id === 'devScheduleAdd') {
      const input = document.getElementById('devScheduleTime');
      if (input?.value) { addSchedule(input.value); }
      return;
    }
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
      case 'shareScanBtn': shareScan(); break;
      case 'scheduleIndicatorBtn': openSettingsModal('schedule'); break;

      // Settings modal
      case 'closeSettingsBtn': case 'cancelSettingsBtn': closeModal('modal'); break;
      case 'clearKeyBtn': localStorage.removeItem(LS_TW); localStorage.removeItem(LS_AN); localStorage.removeItem(LS_MODEL); $('twKeyInput').value = ''; $('keyInput').value = ''; populateModelSelector(null, engine.getModel()); closeModal('modal'); break;
      case 'saveKeysBtn': saveSettings(); break;

      // Preset modal
      case 'closePresetBtn': case 'cancelPresetBtn': closeModal('presetModal'); break;
      case 'savePresetBtn': savePreset(); break;

      // Auth modal
      case 'closeAuthBtn': closeModal('authModal'); auth.clearPendingRecovery(); break;
      case 'authSubmitBtn': handleAuthSubmit(); break;
      case 'forgotPwBtn': handleForgotPassword(); break;
      case 'googleSignInBtn': auth.signInGoogle(); break;
      case 'resetPasswordBtn': handlePasswordReset(); break;

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

      // (custom schedule time handled via initInputListeners)

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
  if (name.length > 100) {
    renderNotice('Preset name must be 100 characters or fewer.');
    return;
  }
  const rawAccounts = $('presetAccountsInput').value.split(',');
  const { accounts: accts, invalidCount, truncated } = normalizeAccountList(rawAccounts, { max: 200 });
  if (!name || !accts.length) {
    renderNotice('Preset name and at least one valid account are required.');
    return;
  }
  if (invalidCount) {
    $('notices').innerHTML += `<div class="notice warn">${invalidCount} invalid account${invalidCount > 1 ? 's were' : ' was'} skipped.</div>`;
  }
  if (truncated) {
    $('notices').innerHTML += `<div class="notice warn">Preset capped at 200 accounts.</div>`;
  }
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

function syncDisplaySettings() {
  if (auth.isAuthenticated()) {
    api.saveSettings({
      theme: engine.getTheme(),
      font: engine.getFont(),
      font_size: engine.getFontSize(),
      text_case: engine.getCase(),
      finance_provider: engine.getFinanceProvider(),
    }).catch((e) => console.warn('Failed to sync display settings:', e.message));
  }
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

  try {
    if (tw) localStorage.setItem(LS_TW, tw); else localStorage.removeItem(LS_TW);
    if (an) localStorage.setItem(LS_AN, an); else localStorage.removeItem(LS_AN);
    localStorage.setItem(LS_FINANCE, fp);
    if (model) localStorage.setItem(LS_MODEL, model);
  } catch (e) {
    console.warn('localStorage save failed (quota may be exceeded):', e.message);
  }
  engine.setFont(font);
  engine.setFontSize(fontSize);
  engine.setCase(textCase);
  engine.setLiveEnabled(liveEnabled);
  ui.saveAnalystsFromUI();
  if (auth.isAuthenticated()) {
    api.saveSettings({
      theme: engine.getTheme(),
      font,
      font_size: fontSize,
      text_case: textCase,
      finance_provider: fp,
      model,
      live_enabled: liveEnabled,
    }).catch((e) => console.warn('Failed to sync settings:', e.message));
  }
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
    const msg = e.message || 'Failed to send reset email';
    const secMatch = msg.match(/after\s+(\d+)\s+second/);
    let countdown = secMatch ? parseInt(secMatch[1], 10) : (e.retryAfter || 0);
    if (countdown > 0) {
      const errEl = $('authError');
      errEl.style.display = 'block';
      errEl.textContent = `Try again in ${countdown}s`;
      const iv = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(iv);
          errEl.style.display = 'none';
        } else {
          errEl.textContent = `Try again in ${countdown}s`;
        }
      }, 1000);
    } else {
      $('authError').textContent = msg;
      $('authError').style.display = 'block';
    }
  }
}

async function handlePasswordReset() {
  const pw = $('newPassword').value;
  const confirm = $('confirmPassword').value;
  const errEl = $('authError');
  const msgEl = $('authMessage');
  errEl.style.display = 'none';
  msgEl.style.display = 'none';
  if (pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; return; }
  if (pw !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  const btn = $('resetPasswordBtn');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    await auth.updatePassword(pw);
    msgEl.textContent = 'Password updated!';
    msgEl.style.display = 'block';
    setTimeout(() => closeModal('authModal'), 1500);
  } catch (e) {
    errEl.textContent = e.message || 'Failed to update password';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update password';
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
  $('showTickerPriceToggle')?.addEventListener('change', (e) => {
    engine.setShowTickerPrice(e.target.checked);
    if (state.lastScanResult?.signals) {
      ui.renderTickers(state.lastScanResult.signals);
      ui.renderSignals(state.lastScanResult.signals);
    }
    syncDisplaySettings();
  });
  $('financeProvider').addEventListener('change', e => {
    localStorage.setItem(LS_FINANCE, e.target.value);
    syncDisplaySettings();
  });
  $('fontProvider').addEventListener('change', e => { engine.setFont(e.target.value); syncDisplaySettings(); });
  $('fontSizeProvider').addEventListener('change', e => { engine.setFontSize(e.target.value); syncDisplaySettings(); });
  $('caseProvider').addEventListener('change', e => { engine.setCase(e.target.value); syncDisplaySettings(); });

  // Modal backdrop clicks
  ['modal', 'presetModal', 'authModal', 'pricingModal', 'userMenuModal'].forEach(id => {
    let mouseDownTarget = null;
    $(id).addEventListener('mousedown', e => { mouseDownTarget = e.target; });
    $(id).addEventListener('click', e => {
      if (e.target === $(id) && mouseDownTarget === $(id)) {
        closeModal(id);
        if (id === 'authModal') auth.clearPendingRecovery();
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
      if (data.accounts) {
        const normalized = normalizeAccountList(data.accounts, { max: 500 });
        state.customAccounts = normalized.accounts;
        engine.saveAccounts(normalized.accounts);
      }
      if (data.loadedPresets) {
        const safeLoaded = Array.isArray(data.loadedPresets)
          ? [...new Set(data.loadedPresets.filter(v => typeof v === 'string'))]
          : [];
        state.loadedPresets = safeLoaded;
        engine.saveLoadedPresets(safeLoaded);
      }
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

  $('showOnboardingBtn')?.addEventListener('click', () => {
    closeModal('modal');
    startOnboarding();
  });
}

// ============================================================================
// SHARED SIGNAL CHECK
// ============================================================================

function checkSharedSignal() {
  const hash = location.hash;

  function setupSharedView(bannerText) {
    document.body.setAttribute('data-shared', '');
    $('sharedBanner').innerHTML = `<div class="shared-banner"><span class="shared-banner-text">${bannerText}</span><a href="${location.pathname}">← back to sentry</a></div>`;
    document.querySelector('.controls').style.display = 'none';
  }

  // Shared single signal: #s=<base64>
  if (hash.startsWith('#s=')) {
    const signal = engine.decodeSignal(hash.slice(3));
    if (!signal) return false;
    setupSharedView('shared signal');
    ui.renderSharedSignal(signal);
    return true;
  }

  // Shared full scan: #scan=<id>
  if (hash.startsWith('#scan=')) {
    const shareId = hash.slice(6);
    if (!shareId || shareId.length !== 8) return false;
    setupSharedView('shared scan');
    ui.setStatus('Loading shared scan…', true);
    loadSharedScan(shareId);
    return true;
  }

  return false;
}

async function loadSharedScan(shareId) {
  try {
    const scan = await api.getSharedScan(shareId);
    if (!scan || !scan.signals?.length) {
      ui.setStatus('');
      $('results').innerHTML = '<div class="empty-state">Shared scan not found</div>';
      return;
    }
    const signals = engine.normalizeSignals(scan.signals);
    state.lastScanResult = {
      date: scan.created_at || new Date().toISOString(),
      range: scan.range_label || '',
      days: scan.range_days || 1,
      accounts: [],
      totalTweets: scan.total_tweets || 0,
      signals,
      tweetMeta: scan.tweet_meta || {},
    };
    const d = new Date(scan.created_at);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    ui.setStatus(`${dateStr} · ${scan.accounts_count || 0} accounts · ${scan.total_tweets || 0} tweets · ${signals.length} signals`);
    ui.renderTickers(signals);
    ui.renderSignals(signals);
    $('footer').innerHTML = 'shared from <a href="' + location.pathname + '">sentry</a> · not financial advice';
  } catch (e) {
    ui.setStatus('');
    $('results').innerHTML = '<div class="empty-state">Failed to load shared scan</div>';
  }
}

// ============================================================================
// DEV MODE (activated with ?dev=1 in URL)
// ============================================================================

const IS_DEV = new URLSearchParams(window.location.search).has('dev');

async function initDevToolbar() {
  if (!IS_DEV) return;
  const dev = await import('./dev.js');
  dev.init(state, {
    openSettingsModal, openAuthModal, openPricingModal,
    openUserMenuModal, startOnboarding, openModal, closeModal,
  });
}

// ============================================================================
// ONBOARDING FLOW
// ============================================================================

const onboardingState = {
  current: 0,
  path: null,
  selectedAnalysts: new Set(),
  scheduledTimes: [],
  schedulePresets: null,
  completing: false,
};

function startOnboarding() {
  onboardingState.current = 0;
  onboardingState.path = null;
  onboardingState.selectedAnalysts = new Set();
  onboardingState.scheduledTimes = [];
  onboardingState.schedulePresets = null;
  onboardingState.completing = false;
  ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
  initOnboardingListeners();
}

async function completeOnboarding() {
  if (onboardingState.completing) return;
  onboardingState.completing = true;
  try {
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
    // Create scheduled scans with the presets chosen on the schedule step
    if (onboardingState.scheduledTimes.length && auth.isAuthenticated()) {
      const schedPresets = onboardingState.schedulePresets?.length ? onboardingState.schedulePresets : undefined;
      for (const time of onboardingState.scheduledTimes) {
        try { await addSchedule(time, { presetOverride: schedPresets }); } catch (e) { console.warn('Failed to create onboarding schedule:', e); }
      }
    }
    engine.setOnboardingDone(true);
    ui.hideOnboarding();
    ui.renderTopbar();
    ui.render();
  } finally {
    onboardingState.completing = false;
  }
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
      if (onboardingState.current < 5) {
        onboardingState.current++;
        // Initialize schedule presets from accounts step selection on first entry
        if (onboardingState.current === 4 && onboardingState.schedulePresets === null) {
          onboardingState.schedulePresets = [...state.loadedPresets];
        }
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
      if (onboardingState.completing) return;
      await completeOnboarding();
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
    const schedPresetBtn = e.target.closest('[data-ob-sched-preset]');
    if (schedPresetBtn) {
      const name = schedPresetBtn.dataset.obSchedPreset;
      const presets = onboardingState.schedulePresets || [];
      const idx = presets.indexOf(name);
      if (idx >= 0) {
        presets.splice(idx, 1);
      } else {
        presets.push(name);
      }
      onboardingState.schedulePresets = presets;
      ui.renderOnboarding(onboardingState, completeOnboarding, onboardingAction);
      return;
    }
    const schedBtn = e.target.closest('[data-ob-schedule]');
    if (schedBtn) {
      const time = schedBtn.dataset.obSchedule;
      const idx = onboardingState.scheduledTimes.indexOf(time);
      if (idx >= 0) {
        onboardingState.scheduledTimes.splice(idx, 1);
      } else {
        onboardingState.scheduledTimes.push(time);
      }
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
      const val = normalizeAccountHandle(input?.value || '');
      if (!val) {
        renderNotice('Invalid account name. Use Twitter handles only.');
        return;
      }
      if (!state.customAccounts.includes(val)) {
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

  // Register auth change callback BEFORE init (so we don't miss the initial event)
  auth.onAuthChange(async ({ authenticated }) => {
    if (authenticated) {
      await api.init();
      await syncSettingsFromServer();
      loadServerHistory();
      loadSchedules().then(() => {
        updateNextScheduleLabel();
        startSchedulePolling();
        ui.renderTopbar();
      });
    } else {
      stopSchedulePolling();
      state.schedules = [];
    }
    ui.renderTopbar();
  });

  // Initialize auth (may fire onAuthChange synchronously if session exists)
  await auth.init();

  // If already authenticated after init (session was restored), ensure API is ready
  if (auth.isAuthenticated()) {
    await api.init();
    await syncSettingsFromServer();
  }

  // Password recovery flow
  if (auth.isPendingRecovery()) {
    ui.renderPasswordReset();
    openModal('authModal');
  }

  await handleBillingCallback();

  const isShared = checkSharedSignal();

  state.customAccounts = engine.loadStoredAccounts();
  state.loadedPresets = engine.loadStoredLoadedPresets();

  engine.cleanupTweetCache();

  initEventDelegation();
  initInputListeners();
  ui.initChartPreview();
  initMobileDeepLinks();
  if (!isShared) await initDevToolbar();

  ui.renderTopbar();
  if (!isShared) {
    ui.render();
    ui.renderHistory();
  }

  // Show onboarding for new users
  if (!isShared && !engine.isOnboardingDone()) {
    startOnboarding();
  }

  if (isShared) {
    console.log('Sentry initialized (shared view)');
    return;
  }

  const savedScan = engine.loadCurrentScan();
  if (savedScan) {
    const savedIsScheduled = isScheduledScan(savedScan);
    if (savedIsScheduled && savedScan.scheduled !== true) {
      savedScan.scheduled = true;
      engine.saveScanToStorage(savedScan, true);
    }
    const savedKey = getScanNoticeKey(savedScan);
    const isPendingScheduled = savedIsScheduled && savedKey && state.pendingScheduledScanKey === savedKey;
    if (isPendingScheduled) {
      showScheduledScanNotice(savedScan);
    } else {
      if (state.pendingScheduledScanKey && state.pendingScheduledScanKey !== savedKey) {
        clearPendingScheduledScan();
      }
      renderScanResult(savedScan);
    }
  }

  const pendingScan = engine.loadPendingScan();
  if (pendingScan) {
    const totalTweets = pendingScan.accountTweets.reduce((s, a) => s + a.tweets.length, 0);
    const ago = Math.round((Date.now() - new Date(pendingScan.date).getTime()) / 60000);
    const notices = $('notices');
    notices.querySelector('.notice.resume-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'notice resume-banner';
    banner.innerHTML = `<span>Interrupted scan detected (${pendingScan.accounts.length} accounts · ${totalTweets} tweets · ${ago < 1 ? 'just now' : ago + 'm ago'})</span>
      <span style="display:flex;gap:6px;margin-left:auto">
        <button class="resume-btn" type="button">Resume</button>
        <button class="dismiss-btn" type="button">Dismiss</button>
      </span>`;
    banner.querySelector('.resume-btn')?.addEventListener('click', () => {
      banner.remove();
      resumeScan();
    });
    banner.querySelector('.dismiss-btn')?.addEventListener('click', () => {
      engine.clearPendingScan();
      banner.remove();
    });
    notices.prepend(banner);
  }

  // Unregister any old service workers that may be caching stale files
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }

  if (engine.isLiveEnabled() && localStorage.getItem(LS_LIVE_MODE) === 'true' && savedScan) {
    setTimeout(toggleLive, 1000);
  }

  console.log('Sentry initialized' + (IS_DEV ? ' (dev mode)' : ''));
}

init();
