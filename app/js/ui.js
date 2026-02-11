// ============================================================================
// SENTRY — UI Rendering
// ============================================================================
//
// All DOM rendering functions. Reads state from app.js via getters.
// No state management here — just pure rendering.
//

import { RANGES, CATEGORIES, CAT_C, ACT_C, ACT_BG, CREDIT_PACKS, DEFAULT_PROMPT, DEFAULT_ANALYST_ID, DAY_LABELS, calculateScanCredits } from './config.js';
import * as engine from './engine.js';
import * as auth from './auth.js';
import * as api from './api.js';

const $ = id => document.getElementById(id);
const esc = engine.esc;
const PACK_SIZES = CREDIT_PACKS.map(p => p.credits).sort((a, b) => a - b);
function creditBarMax(credits) { return PACK_SIZES.find(s => s >= credits) || credits; }

// App state reference, set by app.js during init
let appState = null;
export function setAppState(state) { appState = state; }

// ============================================================================
// PRESETS & ACCOUNTS
// ============================================================================

export function renderPresets() {
  const el = $('presetsRow');
  const presets = engine.getPresets();
  const { customAccounts, loadedPresets } = appState;
  let h = '';
  presets.forEach(p => {
    if (p.hidden) return;
    const selected = loadedPresets.includes(p.name) ? ' selected' : '';
    h += `<button class="preset-chip${selected}" data-preset="${esc(p.name)}">${esc(p.name)} <span class="count">(${p.accounts.length})</span></button>`;
  });
  customAccounts.forEach(a => {
    h += `<button class="preset-chip selected" data-rm-account="${esc(a)}">${esc(a)}</button>`;
  });
  h += `<button class="preset-manage" id="openPresetBtn">+</button>`;
  if (loadedPresets.length > 0 || customAccounts.length > 0) {
    h += `<button class="clear-btn" id="clearAllBtn">×</button>`;
  }
  el.innerHTML = h;
}

export function renderPresetList() {
  const el = $('presetList');
  const presets = engine.getPresets();
  const editingName = appState.editingPresetName;
  if (!presets.length) { el.innerHTML = '<p class="preset-empty">No presets yet</p>'; return; }
  el.innerHTML = presets.map(p => {
    const isEditing = editingName === p.name;
    return `<div class="preset-list-item${isEditing ? ' editing' : ''}">
      <span>${esc(p.name)}<small>${p.accounts.length} accounts</small></span>
      <div class="preset-list-actions">
        <button data-edit-preset="${esc(p.name)}">${isEditing ? 'Editing' : 'Edit'}</button>
        <button class="danger" data-delete-preset="${esc(p.name)}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

export function renderSuggested() {
  const el = $('suggested');
  const recents = engine.getRecents();
  if (!recents.length) { el.innerHTML = ''; return; }
  const allAccounts = appState.getAllAccounts();
  el.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'sug-label';
  label.textContent = 'recents ·';
  el.appendChild(label);
  recents.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug' + (allAccounts.includes(s) ? ' used' : '');
    b.textContent = s;
    if (!allAccounts.includes(s)) b.addEventListener('click', () => appState.addAccount(s));
    el.appendChild(b);
  });
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.textContent = '×';
  clearBtn.addEventListener('click', () => { engine.clearRecents(); renderSuggested(); });
  el.appendChild(clearBtn);
}

export function renderRanges() {
  const row = $('rangesRow');
  const { range, busy } = appState;
  let h = '';
  RANGES.forEach((r, i) => {
    h += `<button class="rng${range === i ? ' on' : ''}" data-range="${i}">${r.label}</button>`;
  });

  // Credit estimate / free scan indicator
  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const hasCredits = api.hasCredits();
  const totalAccounts = appState.getAllAccounts().length;
  if (isAuth && hasCredits && totalAccounts > 0) {
    const est = calculateScanCredits(totalAccounts, RANGES[range].days, engine.getModel());
    h += `<span class="text-muted">~${est} cr</span>`;
  } else if (isAuth && !hasCredits && profile) {
    if (profile.free_scan_available) {
      h += `<span class="range-hint green">1 free scan</span>`;
    } else {
      h += `<span class="text-muted">free scan used</span>`;
    }
  }

  h += `<div class="scan-btns">`;
  if (busy) h += `<button class="cancel-btn" id="cancelScanBtn">Cancel</button>`;
  h += `<button class="scan-btn"${busy ? ' disabled' : ''} id="scanBtn">${busy ? 'Scanning...' : 'Scan'}</button>`;
  h += `</div>`;
  row.innerHTML = h;
}

export function render() { renderPresets(); renderSuggested(); renderRanges(); }

// ============================================================================
// STATUS & NOTICES
// ============================================================================

export function setLoading(v) {
  $('dot').classList.toggle('loading', v);
  const logo = document.querySelector('.logo-text');
  if (logo) logo.textContent = v ? 'Scanning…' : 'Sentry';
  renderRanges();
}

export function setStatus(t, animate = false, showDownload = false) {
  const el = $('tweetCount');
  if (!t) { el.innerHTML = ''; return; }
  const isAuth = auth.isAuthenticated();
  const share = (showDownload && isAuth) ? `<button class="dl-btn" id="shareScanBtn">Share</button>` : '';
  const dl = showDownload ? `<button class="dl-btn" id="dlBtn"><span class="hide-mobile">Download</span><span class="show-mobile">↓</span></button>` : '';
  const actions = (dl || share) ? `<span class="status-actions">${dl}${share}</span>` : '';
  el.innerHTML = `<div class="tweet-count">${t}${animate ? '<span class="dots"></span>' : ''}${actions}</div>`;
}

// ============================================================================
// TICKERS (with click-to-filter and conditional price display)
// ============================================================================

export function renderTickers(signals) {
  const showPrice = engine.getShowTickerPrice();
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
  const activeTicker = appState.filters.ticker;
  el.innerHTML = list.map(t => {
    const hasBuy = t.acts.has('buy');
    const hasSell = t.acts.has('sell');
    const pa = (hasBuy && hasSell) ? 'mixed' : ['sell', 'buy', 'hold', 'watch'].find(a => t.acts.has(a)) || 'watch';
    const sym = t.s.replace(/^\$/, '');
    const cached = engine.priceCache[sym];
    const priceStr = (showPrice && cached) ? engine.priceHtml(cached) : '';
    const isActive = activeTicker === t.s;
    const dimStyle = (activeTicker && !isActive) ? ';opacity:0.3' : '';
    return `<button class="ticker-item" data-filter-ticker="${esc(t.s)}" data-sym="${esc(sym)}" style="color:${ACT_C[pa]};background:${ACT_BG[pa]}${dimStyle}">${esc(t.s)}${t.n > 1 ? `<span class="ticker-cnt">×${t.n}</span>` : ''}${priceStr}</button>`;
  }).join('');
  if (activeTicker) {
    el.innerHTML += `<button class="clear-btn" data-clear-ticker-filter>×</button>`;
  }
  const symbols = list.map(t => t.s.replace(/^\$/, ''));
  engine.fetchAllPrices(symbols).then(() => updateTickerPrices());
}

export function updateTickerPrices() {
  if (!engine.getShowTickerPrice()) return;
  document.querySelectorAll('.ticker-item[data-sym], .ticker-tag[data-sym]').forEach(el => {
    const sym = el.dataset.sym;
    const cached = engine.priceCache[sym];
    if (!cached || el.querySelector('.ticker-change')) return;
    el.insertAdjacentHTML('beforeend', engine.priceHtml(cached));
  });
}

// ============================================================================
// CHART PREVIEW (TradingView mini widget on ticker hover)
// ============================================================================

let chartPreviewTimer = null;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 200;

export function initChartPreview() {
  const preview = $('chartPreview');
  if (!preview) return;

  // Delegate hover events on ticker elements
  document.addEventListener('mouseover', (e) => {
    const ticker = e.target.closest('.ticker-item[data-sym], .ticker-tag[data-sym]');
    if (!ticker) return;
    // Don't show on mobile
    if (window.innerWidth < 700) return;
    const sym = ticker.dataset.sym;
    if (!sym) return;
    clearTimeout(chartPreviewTimer);
    showChartPreview(sym, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', (e) => {
    const ticker = e.target.closest('.ticker-item[data-sym], .ticker-tag[data-sym]');
    if (ticker && preview.style.display === 'block') {
      positionChartPreview(e.clientX, e.clientY);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const ticker = e.target.closest('.ticker-item[data-sym], .ticker-tag[data-sym]');
    if (ticker) {
      clearTimeout(chartPreviewTimer);
      hideChartPreview();
    }
  });
}

function showChartPreview(sym, x, y) {
  const preview = $('chartPreview');
  if (!preview) return;
  const tvSymbol = engine.getTvSymbol(sym);
  const colorTheme = engine.getTheme() === 'dark' ? 'dark' : 'light';
  const config = JSON.stringify({
    symbol: tvSymbol, width: CHART_WIDTH, height: CHART_HEIGHT,
    dateRange: '1M', colorTheme, isTransparent: true, autosize: false, largeChartUrl: '',
  });
  const src = `https://s.tradingview.com/embed-widget/mini-symbol-overview/?locale=en#${encodeURIComponent(config)}`;
  preview.innerHTML = `<iframe src="${src}" loading="lazy"></iframe>`;
  preview.style.display = 'block';
  positionChartPreview(x, y);
}

function positionChartPreview(x, y) {
  const preview = $('chartPreview');
  if (!preview) return;
  const left = Math.min(x + 16, window.innerWidth - CHART_WIDTH - 16);
  const top = Math.min(Math.max(y - CHART_HEIGHT / 2, 16), window.innerHeight - CHART_HEIGHT - 16);
  preview.style.left = left + 'px';
  preview.style.top = top + 'px';
}

function hideChartPreview() {
  const preview = $('chartPreview');
  if (preview) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
}

// ============================================================================
// SIGNALS
// ============================================================================

export function renderSignals(signals) {
  const el = $('results');
  appState.filters = { category: null, ticker: null };
  if (!signals.length) { el.innerHTML = '<div class="empty-state">No signals extracted</div>'; renderFilters(); $('footer').innerHTML = ''; return; }

  const tweetMap = buildTweetMap();
  let h = '';

  // Scheduled scan indicator
  if (appState.lastScanResult?.scheduled) {
    const d = new Date(appState.lastScanResult.date);
    const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    h += `<div class="scheduled-label">Scheduled scan · ${timeStr}</div>`;
  }

  signals.forEach((item, i) => {
    h += renderSignalCard(item, i, tweetMap);
  });
  el.innerHTML = h;
  renderFilters();
  $('footer').innerHTML = 'Not financial advice';
  setupTweetTooltips();

  const allSymbols = new Set();
  signals.forEach(s => (s.tickers || []).forEach(t => {
    const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
    if (sym) allSymbols.add(sym);
  }));
  if (allSymbols.size) engine.fetchAllPrices([...allSymbols]).then(() => updateTickerPrices());
}

function buildTweetMap() {
  const tweetMap = {};
  const scan = appState.lastScanResult;
  // Layer 1: tweetMeta (from localStorage / server)
  if (scan?.tweetMeta) {
    Object.entries(scan.tweetMeta).forEach(([url, meta]) => {
      const date = meta.time ? new Date(meta.time) : null;
      const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      tweetMap[url] = { text: meta.text || '', author: meta.author || '', time: timeStr };
    });
  }
  // Layer 2: rawTweets (from fresh scan — overwrites with full data)
  if (scan?.rawTweets) {
    scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => {
      const url = engine.getTweetUrl(tw);
      const date = tw.createdAt ? new Date(tw.createdAt) : null;
      const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      tweetMap[url] = { text: tw.text || '', author: tw.author?.userName || a.account || '', time: timeStr };
    }));
  }
  return tweetMap;
}

export function renderSignalCard(item, i, tweetMap, isNew = false) {
  const showPrice = engine.getShowTickerPrice();
  const cat = engine.normCat(item.category);
  const tweetInfo = item.tweet_url ? (tweetMap[item.tweet_url] || {}) : {};
  const source = (item.source || '').replace(/^@/, '');
  const time = tweetInfo.time || '';
  const tickers = (item.tickers && item.tickers.length)
    ? item.tickers.map(t => {
        const url = engine.tickerUrl(t.symbol || '');
        const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
        const cached = engine.priceCache[sym];
        const priceStr = (showPrice && cached) ? engine.priceHtml(cached) : '';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}${priceStr}</a>`;
      }).join('') : '';
  const extLinks = (item.links && item.links.length)
    ? item.links.map(l => {
        try {
          const hostname = new URL(l).hostname.replace('www.','');
          return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(hostname)}</a>`;
        } catch { return ''; }
      }).filter(Boolean).join(' ') : '';
  const sourceLink = item.tweet_url
    ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}">@${esc(source)}</a>`
    : `@${esc(source)}`;
  const seePost = item.tweet_url
    ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer" class="see-post" data-tweet="${esc(tweetInfo.text || '')}" data-author="${esc(source)}" data-time="${esc(time)}"><span class="text">See post</span><span class="arrow">↗</span></a>` : '';
  const tweetExpandId = `tweet-expand-${i}`;
  const tweetExpand = tweetInfo.text ? `
    <div class="tweet-expand">
      <button class="tweet-expand-btn" data-expand-id="${tweetExpandId}">show tweet ▸</button>
      <div class="tweet-expand-content" id="${tweetExpandId}">
        <div class="tweet-expand-author">@${esc(source)}${time ? ` · ${time}` : ''}</div>
        ${esc(tweetInfo.text)}
      </div>
    </div>` : '';

  // Build data-tickers attribute for ticker filtering
  const tickerSymbols = (item.tickers || []).map(t => (t.symbol || '').toUpperCase()).join(',');

  return `<div class="signal${isNew ? ' new' : ''}" data-category="${esc(cat || '')}" data-tickers="${esc(tickerSymbols)}" data-index="${i}">
    <div class="sig-top"><span>${isNew ? '<span class="new-badge">new</span>' : ''}${sourceLink}${time ? ` · ${time}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span><span class="sig-top-actions"><button class="share-btn" data-share-index="${i}" title="Share">share</button>${seePost}</span></div>
    ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
    <div class="sig-title">${esc(item.title || '')}</div>
    <div class="sig-summary">${esc(item.summary || '')}</div>
    ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
    ${tweetExpand}
  </div>`;
}

// ============================================================================
// FILTERS (category + ticker)
// ============================================================================

export function renderFilters() {
  const el = $('filterBar');
  if (!appState.lastScanResult || !appState.lastScanResult.signals.length) { el.innerHTML = ''; return; }
  let h = '<div class="filter-bar">';
  CATEGORIES.forEach(c => {
    const on = appState.filters.category === c ? ' on' : '';
    h += `<button class="rng${on}" data-filter-cat="${c}">${c}</button>`;
  });
  if (appState.filters.category || appState.filters.ticker) {
    h += `<button class="clear-btn" data-clear-all-filters>×</button>`;
  }
  h += '</div>';
  el.innerHTML = h;
}

export function applyFilters() {
  const { category, ticker } = appState.filters;
  document.querySelectorAll('#results .signal').forEach(row => {
    const cat = row.dataset.category;
    const tickers = row.dataset.tickers || '';
    const catMatch = !category || cat === category;
    const tickerMatch = !ticker || tickers.includes(ticker);
    row.classList.toggle('hidden', !(catMatch && tickerMatch));
  });
}

// ============================================================================
// HISTORY
// ============================================================================

export function renderHistory(scanHistory) {
  const el = $('historySection');
  const history = scanHistory || engine.getScanHistory();
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
          const cat = engine.normCat(item.category);
          const tickers = (item.tickers && item.tickers.length)
            ? item.tickers.map(t => {
                const url = engine.tickerUrl(t.symbol || '');
                const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}</a>`;
              }).join('') : '';
          const source = (item.source || '').replace(/^@/, '');
          const sourceLink = item.tweet_url
            ? `<a href="${esc(item.tweet_url)}" target="_blank" rel="noopener noreferrer">@${esc(source)}</a>`
            : `@${esc(source)}`;
          const tweetTime = item.tweet_time ? new Date(item.tweet_time) : null;
          const timeStr = tweetTime ? tweetTime.toLocaleDateString() + ' ' + tweetTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
          return `<div class="signal" data-category="${esc(cat || '')}">
            <div class="sig-top"><span>${sourceLink}${timeStr ? ` · ${timeStr}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span></div>
            ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
            <div class="sig-title">${esc(item.title || '')}</div>
            <div class="sig-summary">${esc(item.summary || '')}</div>
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
      btn.textContent = (open ? '▾ ' : '▸ ') + btn.dataset.label;
    });
  });
  el.querySelectorAll('.hist-actions .download').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); appState.downloadHistoryScan(parseInt(btn.closest('.hist-item').dataset.index)); });
  });
  el.querySelectorAll('.hist-actions .delete').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); appState.deleteHistoryScan(parseInt(btn.closest('.hist-item').dataset.index)); });
  });
}

// ============================================================================
// SHARED SIGNAL VIEW
// ============================================================================

export function renderSharedSignal(signal) {
  const cat = engine.normCat(signal.category)?.toLowerCase();
  const source = (signal.source || '').replace(/^@/, '');
  const tickers = (signal.tickers?.length)
    ? signal.tickers.map(t => {
        const url = engine.tickerUrl(t.symbol || '');
        const sym = (t.symbol || '').replace(/^\$/, '').toUpperCase();
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ticker-tag" data-sym="${esc(sym)}" style="color:${ACT_C[t.action] || 'var(--text-muted)'};background:${ACT_BG[t.action] || 'var(--text-10)'}">${esc(t.symbol)}</a>`;
      }).join('') : '';
  const extLinks = (signal.links?.length)
    ? signal.links.map(l => {
        try { return `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="ext-link">${esc(new URL(l).hostname.replace('www.',''))}</a>`; }
        catch { return ''; }
      }).filter(Boolean).join(' ') : '';
  const sourceLink = signal.tweet_url
    ? `<a href="${esc(signal.tweet_url)}" target="_blank" rel="noopener noreferrer">@${esc(source)}</a>`
    : `@${esc(source)}`;
  const seePost = signal.tweet_url
    ? `<a href="${esc(signal.tweet_url)}" target="_blank" rel="noopener noreferrer" class="see-post"><span class="text">see post</span><span class="arrow">↗</span></a>` : '';

  $('results').innerHTML = `<div class="signal">
    <div class="sig-top"><span>${sourceLink}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span>${seePost}</div>
    ${tickers ? `<div class="sig-tickers">${tickers}</div>` : ''}
    <div class="sig-title">${esc(signal.title || '')}</div>
    <div class="sig-summary">${esc(signal.summary || '')}</div>
    ${extLinks ? `<div class="sig-links">${extLinks}</div>` : ''}
  </div>`;
  $('footer').innerHTML = 'shared from <a href="' + location.pathname + '">sentry</a> · not financial advice';
}

// ============================================================================
// ANALYST LIST (Settings modal)
// ============================================================================

export function renderAnalystList() {
  const container = $('analystList');
  if (!container) return;
  const analysts = engine.getAnalysts() || [];
  const activeId = engine.getActiveAnalystId();
  const openIds = new Set();
  container.querySelectorAll('.analyst-item.open').forEach(el => openIds.add(el.dataset.analystId));
  if (!container.children.length) openIds.add(activeId);

  let h = '';
  analysts.forEach(a => {
    const isActive = a.id === activeId;
    const isOpen = openIds.has(a.id);
    const isDefault = a.id === DEFAULT_ANALYST_ID;
    h += `<div class="analyst-item${isOpen ? ' open' : ''}" data-analyst-id="${a.id}">`;
    h += `<div class="analyst-header" data-toggle-analyst="${a.id}">`;
    h += `<span class="analyst-name">${esc(a.name)}${isActive ? ' <span class="analyst-active-tag">active</span>' : ''}</span>`;
    h += `<div class="analyst-actions">`;
    if (!isActive) h += `<button data-use-analyst="${a.id}">use</button>`;
    h += `<button data-dup-analyst="${a.id}">duplicate</button>`;
    if (!isDefault) h += `<button class="danger" data-del-analyst="${a.id}">delete</button>`;
    h += `</div></div>`;
    h += `<div class="analyst-body">`;
    if (!isDefault) h += `<label>Name</label><input type="text" class="analyst-name-input" value="${esc(a.name)}" placeholder="Analyst name">`;
    h += `<label>Prompt${isDefault ? ' <button type="button" class="modal-sm-btn reset-prompt" data-reset-prompt="default">reset</button>' : ''}</label>`;
    h += `<textarea class="analyst-prompt-input" placeholder="Custom instructions...">${esc(a.prompt)}</textarea>`;
    h += `</div></div>`;
  });
  h += `<button class="analyst-add" id="newAnalystBtn">+ Create new analyst</button>`;
  container.innerHTML = h;
}

export function saveAnalystsFromUI() {
  const analysts = engine.getAnalysts() || [];
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
    if (promptInput) analyst.prompt = promptInput.value.trim() || DEFAULT_PROMPT;
  });
  engine.saveAnalysts(analysts);
}

// ============================================================================
// SCHEDULE TAB (Settings modal)
// ============================================================================

export function renderScheduleTab(schedules, schedulesLoading) {
  const container = $('scheduleList');
  if (!container) return;
  const isAuth = auth.isAuthenticated();

  if (!isAuth) {
    container.innerHTML = `<p class="text-muted">Sign in to use scheduled scans.</p>
      <button class="modal-sm-btn" id="scheduleSignInBtn">Sign in</button>`;
    return;
  }

  if (schedulesLoading) {
    container.innerHTML = '<p class="text-muted">Loading…</p>';
    return;
  }

  const presets = engine.getPresets().filter(p => !p.hidden && p.accounts.length > 0);

  let h = '';

  // Existing schedules
  if (schedules && schedules.length) {
    schedules.forEach(s => {
      const timeStr = engine.formatScheduleTime(s.time);
      const statusText = s.last_run_status === 'running' ? 'running'
        : s.last_run_status === 'success' ? 'done'
        : s.last_run_status === 'error' ? 'failed' : '';
      const statusColor = s.last_run_status === 'success' ? 'var(--green)'
        : s.last_run_status === 'error' ? 'var(--red)'
        : s.last_run_status === 'running' ? 'var(--green)' : '';

      const schedAccounts = new Set(s.accounts || []);
      const accountCount = schedAccounts.size;

      h += `<div class="sched-item">`;
      // Top row: checkbox, time, status, delete
      h += `<div class="sched-row">`;
      h += `<div class="flex-row">`;
      h += `<input type="checkbox" ${s.enabled ? 'checked' : ''} data-toggle-schedule="${s.id}" class="sched-check">`;
      h += `<span class="sched-time${s.enabled ? ' enabled' : ''}">${esc(timeStr)}</span>`;
      if (statusText) {
        const statusCls = s.last_run_status === 'success' ? 'success' : s.last_run_status === 'error' ? 'error' : 'running';
        h += `<span class="sched-status-label ${statusCls}">${statusText}</span>`;
      }
      h += `</div>`;
      h += `<button data-delete-schedule="${s.id}" class="btn-ghost">delete</button>`;
      h += `</div>`;
      // Preset chips row
      h += `<div class="sched-presets">`;
      const selectedNames = new Set(s.preset_names || []);
      const coveredAccounts = new Set();
      presets.forEach(p => {
        const presetAccountsLower = p.accounts.map(a => a.toLowerCase());
        // Use stored preset_names if available, otherwise fall back to account matching
        const isSelected = selectedNames.size > 0
          ? selectedNames.has(p.name)
          : presetAccountsLower.every(a => schedAccounts.has(a));
        if (isSelected) presetAccountsLower.forEach(a => coveredAccounts.add(a));
        h += `<button data-schedule-preset="${s.id}:${p.name}" class="sched-chip${isSelected ? ' selected' : ''}">${esc(p.name)} (${p.accounts.length})</button>`;
      });
      const extraCount = [...schedAccounts].filter(a => !coveredAccounts.has(a.toLowerCase())).length;
      if (extraCount > 0) h += `<span class="text-muted" style="margin-left:2px">+${extraCount}</span>`;
      h += `</div>`;
      h += `</div>`;
    });

    const nextLabel = engine.getNextScheduleLabel(schedules);
    if (nextLabel) {
      h += `<p class="sched-status next">Next: ${nextLabel}</p>`;
    }

    h += `<div class="mt-12">`;
  } else {
    h += `<div>`;
  }

  // Hour grid — active hours are highlighted, tap to toggle
  const activeHours = new Set((schedules || []).filter(s => s.enabled).map(s => {
    const [hh] = (s.time || '').split(':');
    return parseInt(hh);
  }).filter(n => !isNaN(n)));

  h += `<div class="hour-grid">`;
  for (let hr = 0; hr <= 23; hr++) {
    const isActive = activeHours.has(hr);
    const label = `${String(hr).padStart(2, '0')}h`;
    const padded = `${String(hr).padStart(2, '0')}:00`;
    h += `<button data-quick-schedule="${padded}" class="hour-btn${isActive ? ' active' : ''}">${label}</button>`;
  }
  h += `</div>`;
  h += `</div>`;

  container.innerHTML = h;
}

// ============================================================================
// ACCOUNT TAB (Settings modal)
// ============================================================================

export function renderAccountTab() {
  const container = $('accountTabContent');
  if (!container) return;
  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const credits = profile?.credits_balance || 0;
  const hasCredits = credits > 0;
  const hasSub = profile?.subscription_status === 'active';

  const hasBothKeys = engine.bothKeys();
  const hasTwKey = engine.getTwKey().length >= 20;
  const hasAnKey = engine.getAnKey().length >= 20;

  let h = '';
  if (isAuth) {
    if (hasCredits) {
      // ── CREDITS MODE ──
      h += `<div class="acct-section">`;
      h += `<div class="acct-credit-row"><span class="section-label">Credits</span><span class="text-strong-bold">${credits.toLocaleString()}</span></div>`;
      const barMax = creditBarMax(credits);
      const barPercent = Math.min((credits / barMax) * 100, 100);
      const barColor = barPercent > 50 ? 'var(--green)' : barPercent > 20 ? 'var(--amber)' : credits > 0 ? 'var(--red)' : 'var(--text-muted)';
      h += `<div class="progress-track sm"><div class="progress-fill" style="width:${barPercent}%;background:${barColor}"></div></div>`;
      if (hasSub) h += `<div class="flex-between mb-12"><span class="badge-green">Auto-refill</span></div>`;
      h += `<button class="scan-btn" id="acctBuyCreditsBtn">Buy more credits</button>`;
      h += `</div>`;

      if (hasSub) {
        h += `<div class="acct-divider-row">`;
        h += `<span class="text-muted">Subscription</span>`;
        h += `<button class="modal-sm-btn" id="manageBillingBtn3">Manage →</button>`;
        h += `</div>`;
      }
    } else {
      // ── BYOK MODE ──
      h += `<div class="acct-byok-label">API keys (bring your own)</div>`;

      h += `<div class="acct-key-row">`;
      h += `<span>X/Twitter</span>`;
      h += hasTwKey ? `<span class="key-status-ok">✓ configured</span>` : `<span class="key-status-missing">missing</span>`;
      h += `</div>`;

      h += `<div class="acct-key-row">`;
      h += `<span>Anthropic</span>`;
      h += hasAnKey ? `<span class="key-status-ok">✓ configured</span>` : `<span class="key-status-missing">missing</span>`;
      h += `</div>`;

      if (!hasBothKeys) {
        h += `<button class="modal-sm-btn mt-8 mb-16" data-open-settings="api">Configure keys →</button>`;
      }

      if (profile) {
        h += `<div class="info-box mb-16">`;
        if (hasBothKeys) {
          h += `<span class="text-strong-bold">Unlimited scans</span>`;
          h += `<span class="text-muted"> — using your own API keys.</span>`;
        } else {
          h += `<span class="text-muted">Free tier: </span><span class="text-strong-bold">1 scan per day</span><span class="text-muted">, up to 10 accounts.</span>`;
          if (profile.free_scan_available) h += `<br><span class="status-green">✓ Free scan available today</span>`;
          else h += `<br><span class="text-muted">✗ Free scan used — resets tomorrow</span>`;
        }
        h += `</div>`;
      }

      h += `<div class="acct-promo">`;
      h += `<p class="text-muted mb-10">Buy credits for managed API keys — no setup needed, unlimited accounts, scheduled scans.</p>`;
      h += `<button class="scan-btn" id="acctBuyCreditsBtn">Buy credits</button>`;
      h += `</div>`;
    }

    // Account email + sign out — always at the bottom
    h += `<div class="acct-footer">`;
    h += `<span class="text-muted">${esc(auth.getUserEmail())}</span>`;
    h += `<button class="btn-ghost" id="acctSignOutBtn">Sign out</button>`;
    h += `</div>`;
  } else {
    // Signed out state
    h += `<div class="acct-signed-out">`;
    h += `<p class="heading-lg">Not signed in</p>`;
    h += `<p class="text-muted mb-16">Sign in to sync data across devices, get managed API keys, and purchase credits.</p>`;
    h += `<div class="flex-row">`;
    h += `<button class="scan-btn" id="acctSignInBtn">Sign in</button>`;
    h += `<button class="modal-sm-btn" id="acctBuyCreditsBtn2">Buy credits</button>`;
    h += `</div>`;
    h += `</div>`;
  }
  container.innerHTML = h;
}

// ============================================================================
// TOPBAR — Auth-aware with schedule indicator
// ============================================================================

export function renderTopbar() {
  const topRight = $('topbarRight');
  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();

  let h = '';

  // Schedule indicator (desktop only)
  const nextLabel = appState.nextScheduleLabel || '';
  const hasRunning = (appState.schedules || []).some(s => s.last_run_status === 'running');
  if (nextLabel || hasRunning) {
    h += `<button class="top-btn hide-mobile" id="scheduleIndicatorBtn" title="Scheduled scans">`;
    if (hasRunning) h += `<span class="schedule-running">Scanning…</span>`;
    else h += `<span>next scan ${esc(nextLabel)}</span>`;
    h += `</button>`;
  }

  h += `<button class="live-btn" id="liveBtn" style="display:${engine.isLiveEnabled() ? 'flex' : 'none'}"><span class="live-dot"></span>Live</button>`;

  if (isAuth) {
    const credits = profile?.credits_balance || 0;
    h += `<button class="top-btn" id="userMenuBtn">${credits > 0 ? `${credits.toLocaleString()}c` : 'Account'}</button>`;
  } else {
    h += `<button class="top-btn" id="signInBtn">Sign in</button>`;
  }

  h += `<button class="top-btn" id="themeBtn">Theme</button>`;
  h += `<button class="top-btn" id="keyBtn">Settings</button>`;
  topRight.innerHTML = h;
}

// ============================================================================
// AUTH MODAL
// ============================================================================

export function renderAuthModal(tab = 'login') {
  const modal = $('authModal');
  const isLogin = tab === 'login';
  modal.querySelector('.modal').innerHTML = `
    <button class="modal-close" id="closeAuthBtn">✕</button>
    <h3>Welcome to Sentry</h3>
    <p>Sign in to sync your data, unlock managed scans, and buy credits.</p>
    <div class="modal-tabs">
      <button class="modal-tab${isLogin ? ' active' : ''}" data-auth-tab="login">Log in</button>
      <button class="modal-tab${!isLogin ? ' active' : ''}" data-auth-tab="signup">Sign up</button>
    </div>
    <div id="authError" class="msg-error"></div>
    <div id="authMessage" class="msg-success"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@email.com">
    <label>Password</label>
    <input type="password" id="authPassword" placeholder="${isLogin ? '••••••••' : 'Min 6 characters'}">
    <div class="modal-actions">
      <button id="authSubmitBtn">${isLogin ? 'Log in' : 'Create account'}</button>
    </div>
    ${isLogin ? '<button class="auth-text-btn" id="forgotPwBtn">Forgot password?</button>' : ''}
    <div class="auth-divider">
      <button class="modal-sm-btn" id="googleSignInBtn">Continue with Google</button>
    </div>
    ${!isLogin ? '<p class="auth-footnote">By signing up, you agree to our Terms of Service.</p>' : ''}
  `;
}

// ============================================================================
// PRICING MODAL
// ============================================================================

export function renderPricingModal() {
  const modal = $('pricingModal');
  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const credits = profile?.credits_balance || 0;

  let h = `<button class="modal-close" id="closePricingBtn">✕</button>`;
  h += `<h3>Buy credits</h3>`;
  h += `<p>${isAuth && profile ? `${credits.toLocaleString()} credits remaining` : '1 credit = 1 account scanned'}</p>`;
  h += `<div id="pricingError" class="msg-error"></div>`;

  CREDIT_PACKS.forEach(pack => {
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd', minimumFractionDigits: 0 }).format(pack.price / 100);
    h += `<button class="pricing-pack${pack.recommended ? ' recommended' : ''}" data-buy-pack="${pack.id}">
      <div class="flex-1">
        <div class="pricing-pack-name">
          <span class="text-strong-bold">${pack.name}</span>
          ${pack.savings ? `<span class="pricing-savings">-${pack.savings}</span>` : ''}
          ${pack.recommended ? '<span class="badge-green">Popular</span>' : ''}
        </div>
        <div class="pricing-pack-details">${pack.credits.toLocaleString()} credits · ${pack.estimates}</div>
      </div>
      <span class="text-strong-bold">${price}</span>
    </button>`;
  });

  // How credits work
  h += `<details class="pricing-details"><summary>How credits work</summary>`;
  h += `<div class="pricing-details-body">`;
  h += `<p>Credits = accounts × range × model</p>`;
  h += `<p>Range: today ×1 · week ×3</p>`;
  h += `<p>Model: Haiku ×0.25 · Sonnet ×1 · Opus ×5</p>`;
  h += `<p class="example">Example: 200 accounts × today × Haiku = 50 credits</p>`;
  h += `</div></details>`;

  h += `<p class="pricing-footnote">Free tier: bring your own API keys for unlimited scans.</p>`;

  if (profile?.subscription_status === 'active') {
    h += `<button class="modal-sm-btn mt-12" id="manageBillingBtn">Manage subscription</button>`;
  }
  if (!isAuth) {
    h += `<p class="pricing-sign-in">Sign in to purchase credits.</p>`;
  }
  h += `<p class="pricing-footnote mt-8">Payments by Stripe. Apple Pay & Google Pay supported.</p>`;

  modal.querySelector('.modal').innerHTML = h;
}

// ============================================================================
// USER MENU MODAL
// ============================================================================

export function renderUserMenuModal() {
  const modal = $('userMenuModal');
  const profile = api.getCachedProfile();
  const user = auth.getUser();
  const credits = profile?.credits_balance || 0;
  const hasCredits = credits > 0;
  const hasSub = profile?.subscription_status === 'active';

  let h = `<button class="modal-close" id="closeUserMenuBtn">✕</button>`;
  h += `<h3>Account</h3>`;
  h += `<p>${user?.email || ''}</p>`;

  h += `<div class="user-credits-card">`;
  h += `<div class="user-credits-header"><span class="text-muted">Credits</span><span class="text-strong-bold">${credits.toLocaleString()}</span></div>`;
  const barMax = creditBarMax(credits);
  const barPercent = Math.min((credits / barMax) * 100, 100);
  const barColor = barPercent > 50 ? 'var(--green)' : barPercent > 20 ? 'var(--amber)' : credits > 0 ? 'var(--red)' : 'var(--text-muted)';
  h += `<div class="progress-track md"><div class="progress-fill" style="width:${barPercent}%;background:${barColor}"></div></div>`;
  h += `<div class="user-credits-detail">${hasCredits ? '' : 'No credits — BYOK mode'}${hasSub ? '<span class="status-green">Auto-refill</span>' : ''}</div>`;
  h += `<button class="modal-sm-btn" id="buyCreditsBtn">${hasCredits ? 'Buy more credits' : 'Buy credits'}</button>`;
  h += `</div>`;

  if (!hasCredits) {
    h += `<div class="user-free-tier">`;
    h += `Free tier: <strong>1 scan per day</strong>, up to 10 accounts.`;
    if (profile?.free_scan_available) h += `<br><span class="status-green">✓ Free scan available today</span>`;
    else h += `<br>✗ Free scan used today — resets tomorrow`;
    h += `</div>`;
  }

  if (hasSub) h += `<button class="modal-sm-btn mb-8" id="manageBillingBtn2">Manage subscription</button>`;

  h += `<div class="user-signout-section">`;
  h += `<button class="btn-ghost-danger" id="signOutBtn">Sign out</button>`;
  h += `</div>`;

  modal.querySelector('.modal').innerHTML = h;
}

// ============================================================================
// ONBOARDING
// ============================================================================

const SUGGESTED_ANALYSTS = [
  {
    id: 'macro', name: 'Macro & Geopolitics',
    description: 'Central bank policy, geopolitical risk, sovereign debt, FX, and global macro positioning.',
    prompt: `You are a macro-geopolitical intelligence analyst. Extract signals about global macro themes, central bank policy, geopolitics, and their market implications from these tweets.

FOCUS ON:
- Central bank policy signals: rate decisions, QE/QT, forward guidance shifts, liquidity changes
- Geopolitical events: conflicts, sanctions, trade policy, elections, regime changes
- Sovereign risk: debt dynamics, fiscal policy, credit rating implications
- Currency & FX flows: dollar strength/weakness, carry trades, emerging market stress
- Commodity macro: energy policy, supply chain disruptions, strategic reserves
- Cross-asset implications: how macro events flow through to equities, bonds, commodities, crypto
- Contrarian macro views that challenge consensus narratives

Return a JSON array. Each signal:
- "title": headline, lead with theme or $TICKER when relevant
- "summary": 1-2 sentences — the macro view and implied positioning
- "category": "Trade" | "Insight" | "Tool" | "Resource"
- "source": twitter handle (no @)
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch"}]
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned. Empty array if none.
Return ONLY valid JSON array.`,
  },
  {
    id: 'tech', name: 'Tech & Builders',
    description: 'AI models, dev tools, open source, startup launches, infrastructure, and products.',
    prompt: `You are a technology intelligence analyst focused on the builder ecosystem. Extract signals about AI, developer tools, infrastructure, and tech products from these tweets.

FOCUS ON:
- AI developments: new models, benchmarks, capabilities, research breakthroughs, API launches
- Developer tools & infrastructure: new frameworks, SDKs, platforms, databases, cloud services
- Open source: notable releases, major version updates, project milestones, ecosystem shifts
- Startup launches & products: new products, pivots, shutdowns, notable demos
- Platform shifts: API changes, pricing model changes, ecosystem moves by major players

Return a JSON array. Each signal:
- "title": headline, lead with product/company name
- "summary": 1-2 sentences — what's new and why it matters
- "category": "Trade" | "Insight" | "Tool" | "Resource"
- "source": twitter handle (no @)
- "tickers": [{symbol: "$TICKER", action: "buy"|"sell"|"hold"|"watch"}]
- "tweet_url": exact tweet_url from data
- "links": external URLs mentioned. Empty array if none.
Return ONLY valid JSON array.`,
  },
];

export function renderOnboarding(onStep, onComplete, onAction) {
  const container = $('onboarding');
  if (!container) return;
  container.style.display = 'flex';

  const step = onStep.current;
  const isAuth = auth.isAuthenticated();
  const STEPS = ['Welcome', 'Setup', 'Accounts', 'Analysts', 'Ready'];

  // Progress dots
  let h = `<div class="ob-progress">`;
  STEPS.forEach((_, i) => {
    const cls = i === step ? ' current' : i < step ? ' done' : '';
    h += `<div class="ob-dot${cls}"></div>`;
  });
  h += `</div>`;

  // Step content
  if (step === 0) {
    // Welcome
    h += `<div>`;
    h += `<div class="ob-logo"><div class="ob-logo-mark"></div><span class="text-strong-bold">sentry</span></div>`;
    h += `<h1 class="heading-xl">signal without the noise</h1>`;
    h += `<p class="ob-body">Sentry scans X/Twitter accounts and uses AI to extract actionable trading signals — tickers, sentiment, and catalysts — from the noise.</p>`;
    h += `<div class="mb-24">`;
    ['Sign in or add your own API keys', 'Pick accounts or presets to monitor', 'Hit scan and get structured signals'].forEach((t, i) => {
      h += `<div class="ob-step-item"><div class="ob-step-num">${i+1}</div><span class="text-muted">${t}</span></div>`;
    });
    h += `</div>`;
    h += `<button class="scan-btn" data-ob-next>Get started →</button>`;
    h += `</div>`;
  } else if (step === 1) {
    // Setup
    if (isAuth) {
      h += `<div class="acct-signed-out">`;
      h += `<div class="flex-row-lg mb-16"><div class="ob-check-badge">✓</div><h2 class="heading-lg" style="margin-bottom:0">You're signed in</h2></div>`;
      h += `<p class="ob-body">Buy credits for managed API keys, or use your own keys for free.</p>`;
      h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-back>Back</button><button class="scan-btn" data-ob-next>Continue →</button></div>`;
      h += `</div>`;
    } else if (!onStep.path) {
      // Choose path
      h += `<div class="mb-24"><h2 class="heading-lg">How do you want to use Sentry?</h2><p class="text-muted">Sign in for the easiest experience, or bring your own API keys.</p></div>`;
      h += `<button data-ob-path="signin" class="ob-choice recommended"><span class="badge-green mb-4" style="display:inline-block">Recommended</span><br><strong>Sign in</strong><br><span class="text-muted">Sign in and buy credits for managed API keys. Or use the free tier (1 scan/day, 10 accounts).</span></button>`;
      h += `<button data-ob-path="byok" class="ob-choice"><strong>Use your own API keys</strong><br><span class="text-muted">Bring your own X/Twitter and Anthropic keys. Unlimited scans.</span></button>`;
      h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-back>Back</button></div>`;
    } else if (onStep.path === 'signin') {
      h += `<div class="mb-16"><h2 class="heading-lg">Sign in</h2></div>`;
      h += `<div id="obAuthError" class="msg-error"></div>`;
      h += `<div id="obAuthMsg" class="msg-success"></div>`;
      h += `<button class="modal-sm-btn mb-12" id="obGoogleBtn">Continue with Google</button>`;
      h += `<div class="auth-divider" style="margin:12px 0;padding-top:12px">`;
      h += `<div class="ob-field"><label>Email</label><input type="email" id="obEmail" placeholder="you@email.com" class="ob-input"></div>`;
      h += `<div class="ob-field"><label>Password</label><input type="password" id="obPassword" placeholder="••••••••" class="ob-input"></div>`;
      h += `<div class="flex-row"><button class="scan-btn flex-1" id="obLoginBtn">Log in</button><button class="modal-sm-btn flex-1" id="obSignupBtn">Sign up</button></div>`;
      h += `</div>`;
      h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-path="">Back</button><button class="modal-sm-btn text-muted" data-ob-next>Skip</button></div>`;
    } else {
      // BYOK
      h += `<div class="mb-16"><h2 class="heading-lg">API keys</h2><p class="text-muted">Your keys are stored on your device and never shared.</p></div>`;
      h += `<div class="ob-field"><label>X/Twitter API key</label><input type="password" id="obTwKey" placeholder="Your twitterapi.io key" value="${esc(engine.getTwKey())}" class="ob-input"><p><a href="https://twitterapi.io" target="_blank">Get one at twitterapi.io →</a></p></div>`;
      h += `<div class="ob-field"><label>Anthropic API key</label><input type="password" id="obAnKey" placeholder="sk-ant-..." value="${esc(engine.getAnKey())}" class="ob-input"><p><a href="https://console.anthropic.com/settings/keys" target="_blank">Get one at console.anthropic.com →</a></p></div>`;
      h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-path="">Back</button><div class="flex-row"><button class="modal-sm-btn text-muted" data-ob-next>Skip</button><button class="scan-btn" data-ob-next>Continue →</button></div></div>`;
    }
  } else if (step === 2) {
    // Accounts
    h += `<div class="mb-16"><h2 class="heading-lg">Accounts to scan</h2><p class="text-muted">Pick a preset or add individual accounts.</p></div>`;
    h += `<label>Presets</label><div class="flex-wrap mb-16">`;
    engine.getPresets().filter(p => !p.hidden).forEach(p => {
      const active = appState.loadedPresets.includes(p.name);
      h += `<button data-ob-preset="${esc(p.name)}" class="ob-preset${active ? ' selected' : ''}">${active ? '✓ ' : ''}${esc(p.name)} <span class="text-muted-xs" style="opacity:0.6">${p.accounts.length}</span></button>`;
    });
    h += `</div>`;
    h += `<label class="mt-16">Custom accounts</label>`;
    h += `<div class="flex-row mb-8"><input type="text" id="obAccountInput" placeholder="@username" class="ob-input flex-1"><button class="modal-sm-btn" id="obAddAccountBtn">Add</button></div>`;
    if (appState.customAccounts.length) {
      h += `<div class="flex-wrap-sm mb-12">`;
      appState.customAccounts.forEach(a => {
        h += `<button data-ob-rm-account="${esc(a)}" class="ob-account-chip">@${esc(a)} ×</button>`;
      });
      h += `</div>`;
    }
    const hasAccounts = appState.customAccounts.length > 0 || appState.loadedPresets.length > 0;
    h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-back>Back</button><div class="flex-row"><button class="modal-sm-btn text-muted" data-ob-next>Skip</button><button class="scan-btn" data-ob-next ${hasAccounts ? '' : 'disabled'}>Continue →</button></div></div>`;
  } else if (step === 3) {
    // Analysts
    h += `<div class="mb-16"><h2 class="heading-lg">Analysts</h2><p class="text-muted">Analysts are AI prompts that tell Sentry what to look for.</p></div>`;
    h += `<div class="user-credits-card"><div class="flex-between mb-4"><span class="text-strong-bold">Default</span><span class="badge-green">active</span></div><p class="text-muted">Trading signals — directional views, catalysts, technicals, on-chain data, contrarian takes.</p></div>`;
    h += `<label>Add analysts</label>`;
    SUGGESTED_ANALYSTS.forEach(sa => {
      const active = onStep.selectedAnalysts?.has(sa.id);
      h += `<button data-ob-analyst="${sa.id}" class="ob-analyst${active ? ' selected' : ''}"><div class="flex-row"><span class="ob-analyst-check">${active ? '✓' : ''}</span><span class="text-strong-bold">${esc(sa.name)}</span></div><p class="text-muted" style="margin-top:4px;padding-left:24px">${esc(sa.description)}</p></button>`;
    });
    h += `<p class="text-muted mt-8">You can create, edit, or remove analysts anytime in settings.</p>`;
    h += `<div class="ob-nav"><button class="modal-sm-btn" data-ob-back>Back</button><button class="scan-btn" data-ob-next>Continue →</button></div>`;
  } else if (step === 4) {
    // Ready
    const hasKeys = isAuth || engine.bothKeys();
    const hasAccounts = appState.customAccounts.length > 0 || appState.loadedPresets.length > 0;
    h += `<div>`;
    h += `<div class="flex-row-lg mb-16"><div class="ob-check-badge">✓</div><h2 class="heading-lg" style="margin-bottom:0">You're all set</h2></div>`;
    h += `<p class="ob-body">You can always change your settings later.</p>`;
    h += `</div>`;
    h += `<div class="mb-24">`;
    h += `<div class="ob-summary-row"><span class="text-muted">Account</span><span class="${isAuth ? 'status-green' : 'text-muted'}">${isAuth ? '✓ signed in' : 'not signed in'}</span></div>`;
    if (!isAuth) {
      h += `<div class="ob-summary-row"><span class="text-muted">API keys</span><span class="${hasKeys ? 'status-green' : 'text-muted'}">${hasKeys ? '✓ configured' : 'skipped'}</span></div>`;
    }
    h += `<div class="ob-summary-row"><span class="text-muted">Accounts</span><span class="${hasAccounts ? 'status-green' : 'text-muted'}">${hasAccounts ? '✓ ' + (appState.loadedPresets.join(', ') || '') + (appState.customAccounts.length ? (appState.loadedPresets.length ? ' + ' : '') + appState.customAccounts.length + ' custom' : '') : 'skipped'}</span></div>`;
    h += `<div class="ob-summary-row"><span class="text-muted">Analysts</span><span class="status-green">✓ ${1 + (onStep.selectedAnalysts?.size || 0)} active</span></div>`;
    h += `</div>`;
    h += `<div class="flex-row"><button class="scan-btn" data-ob-finish>Start using sentry →</button><button class="modal-sm-btn text-muted" data-ob-back>Go back</button></div>`;
  }

  container.querySelector('.onboarding-content').innerHTML = h;
}

export function hideOnboarding() {
  const container = $('onboarding');
  if (container) container.style.display = 'none';
}

export { SUGGESTED_ANALYSTS };

// ============================================================================
// TOOLTIP
// ============================================================================

export function setupTweetTooltips() {
  const tooltip = $('tweetTooltip');
  document.querySelectorAll('.see-post[data-tweet]').forEach(link => {
    link.addEventListener('mouseenter', () => {
      const text = link.dataset.tweet;
      if (!text) return;
      const author = link.dataset.author || '';
      const time = link.dataset.time || '';
      const header = (author || time) ? `<div class="tooltip-header">@${esc(author)} · ${esc(time)}</div>` : '';
      tooltip.innerHTML = header + esc(text);
      tooltip.classList.add('vis');
    });
    link.addEventListener('mousemove', e => {
      const x = e.clientX + 12;
      const y = e.clientY + 12;
      const rect = tooltip.getBoundingClientRect();
      tooltip.style.left = Math.min(x, window.innerWidth - rect.width - 20) + 'px';
      tooltip.style.top = Math.min(y, window.innerHeight - rect.height - 20) + 'px';
    });
    link.addEventListener('mouseleave', () => tooltip.classList.remove('vis'));
  });
}
