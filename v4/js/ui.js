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
  if (!presets.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:var(--fs);margin-top:8px">No presets yet</p>'; return; }
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
    h += `<span style="color:var(--text-muted);font-size:var(--fs-sm)">~${est} cr</span>`;
  } else if (isAuth && !hasCredits && profile) {
    if (profile.free_scan_available) {
      h += `<span style="color:var(--green);font-size:var(--fs-sm)">1 free scan</span>`;
    } else {
      h += `<span style="color:var(--text-muted);font-size:var(--fs-sm)">free scan used</span>`;
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
  renderRanges();
}

export function setStatus(t, animate = false, showDownload = false) {
  const el = $('tweetCount');
  if (!t) { el.innerHTML = ''; return; }
  const dl = showDownload ? `<button class="dl-btn" id="dlBtn">↓ <span class="hide-mobile">Download</span></button>` : '';
  el.innerHTML = `<div class="tweet-count">${t}${animate ? '<span class="dots"></span>' : ''}${dl}</div>`;
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
    const activeStyle = isActive ? ';outline:1px solid currentColor;outline-offset:1px' : '';
    return `<button class="ticker-item" data-filter-ticker="${esc(t.s)}" data-sym="${esc(sym)}" style="color:${ACT_C[pa]};background:${ACT_BG[pa]}${activeStyle}">${esc(t.s)}${t.n > 1 ? `<span class="ticker-cnt">×${t.n}</span>` : ''}${priceStr}</button>`;
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
  preview.innerHTML = `<iframe src="${src}" style="width:100%;height:100%;border:0;pointer-events:none" loading="lazy"></iframe>`;
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
  if (scan?.rawTweets) {
    scan.rawTweets.forEach(a => (a.tweets || []).forEach(tw => {
      const url = engine.getTweetUrl(tw);
      const date = tw.createdAt ? new Date(tw.createdAt) : null;
      const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      tweetMap[url] = { text: tw.text || '', author: tw.author?.userName || a.account || '', time: timeStr };
    }));
  } else if (scan?.tweetMeta) {
    Object.entries(scan.tweetMeta).forEach(([url, meta]) => {
      const date = meta.time ? new Date(meta.time) : null;
      const timeStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
      tweetMap[url] = { text: meta.text || '', author: meta.author || '', time: timeStr };
    });
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
    <div class="sig-top"><span>${isNew ? '<span class="new-badge">new</span>' : ''}${sourceLink}${time ? ` · ${time}` : ''}${cat ? ` · <span class="sig-cat">${esc(cat)}</span>` : ''}</span><span style="display:flex;gap:12px;align-items:center"><button class="share-btn" data-share-index="${i}" title="Share">share</button>${seePost}</span></div>
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
    h += `<textarea class="analyst-prompt-input" style="height:200px" placeholder="Custom instructions...">${esc(a.prompt)}</textarea>`;
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
    container.innerHTML = `<p style="color:var(--text-muted)">Sign in to use scheduled scans.</p>
      <button class="modal-sm-btn" id="scheduleSignInBtn" style="margin-top:8px">Sign in</button>`;
    return;
  }

  if (schedulesLoading) {
    container.innerHTML = '<p style="color:var(--text-muted)">Loading schedules…</p>';
    return;
  }

  let h = '';

  // Existing schedules
  if (schedules && schedules.length) {
    schedules.forEach(s => {
      const timeStr = engine.formatScheduleTime(s.time);
      const daysLabel = (!s.days || !s.days.length) ? 'Every day'
        : s.days.length === 5 && !s.days.includes(0) && !s.days.includes(6) ? 'Weekdays'
        : s.days.map(d => DAY_LABELS[d]).join(' ');
      const statusIcon = s.last_run_status === 'running' ? '⟳'
        : s.last_run_status === 'success' ? '✓'
        : s.last_run_status === 'error' ? '✕' : '';
      const statusColor = s.last_run_status === 'success' ? 'var(--green)'
        : s.last_run_status === 'error' ? 'var(--red)' : 'var(--text-muted)';

      h += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-light)">`;
      h += `<div style="display:flex;align-items:center;gap:10px">`;
      h += `<input type="checkbox" ${s.enabled ? 'checked' : ''} data-toggle-schedule="${s.id}" style="accent-color:var(--green);width:16px;height:16px;cursor:pointer">`;
      h += `<div>`;
      h += `<span style="color:${s.enabled ? 'var(--text-strong)' : 'var(--text-muted)'}">${esc(timeStr)}</span>`;
      h += `<span style="color:var(--text-muted);font-size:var(--fs-sm);margin-left:8px">${daysLabel}</span>`;
      h += `</div>`;
      h += `</div>`;
      h += `<div style="display:flex;align-items:center;gap:8px">`;
      if (statusIcon) h += `<span style="color:${statusColor}">${statusIcon}</span>`;
      h += `<button data-delete-schedule="${s.id}" style="background:none;border:none;color:var(--text-muted);cursor:pointer">×</button>`;
      h += `</div>`;
      h += `</div>`;
    });
    // Next schedule status
    const nextLabel = engine.getNextScheduleLabel(schedules);
    const anyRunning = schedules.some(s => s.last_run_status === 'running');
    if (anyRunning) {
      h += `<div style="padding:8px 0;color:var(--green);font-size:var(--fs-sm)">⟳ Scan running…</div>`;
    } else if (nextLabel) {
      h += `<div style="padding:8px 0;color:var(--text-muted);font-size:var(--fs-sm)">Next scan ${nextLabel}</div>`;
    }
  } else {
    h += `<p style="color:var(--text-muted);margin-bottom:16px">No scheduled scans yet.</p>`;
  }

  // Add schedule
  h += `<div style="margin-top:16px">`;
  h += `<div style="display:flex;gap:6px;flex-wrap:wrap">`;
  ['07:00', '08:00', '09:00', '12:00', '18:00', '21:00'].forEach(t => {
    h += `<button class="modal-sm-btn" data-quick-schedule="${t}">${engine.formatScheduleTime(t)}</button>`;
  });
  h += `</div>`;
  h += `</div>`;
  h += `<p style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:12px">Pick a time to add a daily scan. Runs automatically on the server.</p>`;
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
      h += `<div style="border:1px solid var(--border);padding:14px;margin-bottom:16px">`;
      h += `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="color:var(--text-muted);font-size:var(--fs-sm);text-transform:uppercase">Credits</span><span style="color:var(--text-strong);font-weight:500">${credits.toLocaleString()}</span></div>`;
      const barPercent = Math.min((credits / 15000) * 100, 100);
      const barColor = credits > 5000 ? 'var(--green)' : credits > 1000 ? 'var(--amber)' : credits > 0 ? 'var(--red)' : 'var(--text-muted)';
      h += `<div style="height:1px;background:var(--bg-alt);margin-bottom:10px"><div style="height:100%;width:${barPercent}%;background:${barColor};transition:width 0.3s"></div></div>`;
      h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">`;
      h += `<span style="font-size:var(--fs-sm);color:var(--text-muted)">Managed API keys active</span>`;
      if (hasSub) h += `<span style="font-size:var(--fs-xs);color:var(--green);background:var(--green-10);padding:1px 5px">Auto-refill</span>`;
      h += `</div>`;
      h += `<button class="scan-btn" style="width:100%" id="acctBuyCreditsBtn">Buy more credits</button>`;
      h += `</div>`;

      h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border)">`;
      h += `<span style="color:var(--text-muted)">API keys</span>`;
      h += `<span style="font-size:var(--fs-sm);color:var(--green)">Managed (included)</span>`;
      h += `</div>`;

      if (hasSub) {
        h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border)">`;
        h += `<span style="color:var(--text-muted)">Subscription</span>`;
        h += `<button class="modal-sm-btn" id="manageBillingBtn3" style="font-size:var(--fs-sm)">Manage →</button>`;
        h += `</div>`;
      }
    } else {
      // ── BYOK MODE ──
      h += `<div style="border:1px solid var(--border);padding:14px;margin-bottom:16px">`;
      h += `<div style="font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase;margin-bottom:10px">API keys (bring your own)</div>`;

      h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-light)">`;
      h += `<span style="color:var(--text)">X/Twitter</span>`;
      h += hasTwKey ? `<span style="color:var(--green);font-size:var(--fs-sm)">✓ configured</span>` : `<span style="color:var(--red);font-size:var(--fs-sm)">missing</span>`;
      h += `</div>`;

      h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">`;
      h += `<span style="color:var(--text)">Anthropic</span>`;
      h += hasAnKey ? `<span style="color:var(--green);font-size:var(--fs-sm)">✓ configured</span>` : `<span style="color:var(--red);font-size:var(--fs-sm)">missing</span>`;
      h += `</div>`;

      if (!hasBothKeys) {
        h += `<button class="modal-sm-btn" style="width:100%;margin-top:10px" data-open-settings="api">Configure keys →</button>`;
      }
      h += `</div>`;

      if (profile) {
        h += `<div style="padding:12px;background:var(--bg-alt);margin-bottom:16px;font-size:var(--fs-sm);line-height:1.6">`;
        if (hasBothKeys) {
          h += `<span style="color:var(--text-strong)">Unlimited scans</span>`;
          h += `<span style="color:var(--text-muted)"> — using your own API keys.</span>`;
        } else {
          h += `<span style="color:var(--text-muted)">Free tier: </span><span style="color:var(--text-strong)">1 scan per day</span><span style="color:var(--text-muted)">, up to 10 accounts.</span>`;
          if (profile.free_scan_available) h += `<br><span style="color:var(--green)">✓ Free scan available today</span>`;
          else h += `<br><span style="color:var(--text-muted)">✗ Free scan used — resets tomorrow</span>`;
        }
        h += `</div>`;
      }

      h += `<div style="border-top:1px solid var(--border);padding-top:12px">`;
      h += `<p style="color:var(--text-muted);font-size:var(--fs-sm);margin-bottom:10px;line-height:1.5">Buy credits for managed API keys — no setup needed, unlimited accounts, scheduled scans.</p>`;
      h += `<button class="scan-btn" style="width:100%" id="acctBuyCreditsBtn">Buy credits</button>`;
      h += `</div>`;
    }

    // Account email + sign out — always at the bottom
    h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:12px;border-top:1px solid var(--border)">`;
    h += `<span style="color:var(--text-muted);font-size:var(--fs-sm)">${esc(auth.getUserEmail())}</span>`;
    h += `<button style="background:none;border:none;color:var(--text-muted);font-size:var(--fs-sm);cursor:pointer" id="acctSignOutBtn">Sign out</button>`;
    h += `</div>`;
  } else {
    // Signed out state
    h += `<div style="padding:16px 0">`;
    h += `<p style="color:var(--text-strong);font-size:var(--fs);margin-bottom:8px">Not signed in</p>`;
    h += `<p style="color:var(--text-muted);font-size:var(--fs-sm);margin-bottom:16px;line-height:1.6">Sign in to sync data across devices, get managed API keys, and purchase credits.</p>`;
    h += `<div style="display:flex;gap:8px">`;
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
    if (hasRunning) h += `<span style="color:var(--green)">⟳ Scanning…</span>`;
    else h += `<span>⏱ ${esc(nextLabel)}</span>`;
    h += `</button>`;
  }

  h += `<button class="live-btn" id="liveBtn" style="display:${engine.isLiveEnabled() ? 'flex' : 'none'}"><span class="live-dot"></span><span>Live</span></button>`;

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
    <div id="authError" style="color:var(--red);font-size:var(--fs);margin-bottom:8px;display:none"></div>
    <div id="authMessage" style="color:var(--green);font-size:var(--fs);margin-bottom:8px;display:none"></div>
    <label>Email</label>
    <input type="email" id="authEmail" placeholder="you@email.com">
    <label>Password</label>
    <input type="password" id="authPassword" placeholder="${isLogin ? '••••••••' : 'Min 6 characters'}">
    <div class="modal-actions">
      <button id="authSubmitBtn">${isLogin ? 'Log in' : 'Create account'}</button>
    </div>
    ${isLogin ? '<button style="background:none;border:none;color:var(--text-muted);font-size:var(--fs);cursor:pointer;margin-top:8px" id="forgotPwBtn">Forgot password?</button>' : ''}
    <div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px">
      <button class="modal-sm-btn" style="width:100%" id="googleSignInBtn">Continue with Google</button>
    </div>
    ${!isLogin ? '<p style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:12px">By signing up, you agree to our Terms of Service.</p>' : ''}
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
  h += `<h3>Credits</h3>`;
  h += `<p>${isAuth && profile ? `${credits.toLocaleString()} credits remaining` : '1 credit = 1 account scanned'}</p>`;
  h += `<div id="pricingError" style="color:var(--red);font-size:var(--fs);margin-bottom:8px;display:none"></div>`;

  CREDIT_PACKS.forEach(pack => {
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd', minimumFractionDigits: 0 }).format(pack.price / 100);
    h += `<button class="pricing-pack${pack.recommended ? ' recommended' : ''}" data-buy-pack="${pack.id}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--bg-alt);border:${pack.recommended ? '1px solid var(--text-muted)' : 'none'};padding:10px;margin-bottom:8px;cursor:pointer;font-size:var(--fs);color:var(--text-strong)">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-weight:500">${pack.name}</span>
          ${pack.savings ? `<span style="font-size:var(--fs-xs);color:var(--text-muted)">-${pack.savings}</span>` : ''}
          ${pack.recommended ? '<span style="font-size:var(--fs-xs);color:var(--green);background:var(--green-10);padding:1px 5px">Popular</span>' : ''}
        </div>
        <div style="font-size:var(--fs-sm);color:var(--text-muted)">${pack.credits.toLocaleString()} credits · ${pack.estimates}</div>
      </div>
      <span style="font-weight:500">${price}</span>
    </button>`;
  });

  // How credits work
  h += `<details style="margin-top:12px"><summary style="font-size:var(--fs-xs);color:var(--text-muted);cursor:pointer">How credits work</summary>`;
  h += `<div style="font-size:var(--fs-xs);color:var(--text-muted);padding:8px 0 0 8px;line-height:1.6">`;
  h += `<p>Credits = accounts × range × model</p>`;
  h += `<p>Range: today ×1 · week ×3</p>`;
  h += `<p>Model: Haiku ×0.25 · Sonnet ×1 · Opus ×5</p>`;
  h += `<p style="opacity:0.6;margin-top:4px">Example: 200 accounts × today × Haiku = 50 credits</p>`;
  h += `</div></details>`;

  h += `<p style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:12px">Free tier: bring your own API keys for unlimited scans.</p>`;

  if (profile?.subscription_status === 'active') {
    h += `<button class="modal-sm-btn" style="width:100%;margin-top:12px" id="manageBillingBtn">Manage subscription</button>`;
  }
  if (!isAuth) {
    h += `<p style="font-size:var(--fs);color:var(--text-muted);margin-top:12px">Sign in to purchase credits.</p>`;
  }
  h += `<p style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:8px">Payments by Stripe. Apple Pay & Google Pay supported.</p>`;

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

  h += `<div style="border:1px solid var(--border);padding:12px;margin-bottom:12px">`;
  h += `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Credits</span><span style="font-weight:500">${credits.toLocaleString()}</span></div>`;
  const barPercent = Math.min((credits / 15000) * 100, 100);
  const barColor = credits > 5000 ? 'var(--green)' : credits > 1000 ? 'var(--amber)' : credits > 0 ? 'var(--red)' : 'var(--text-muted)';
  h += `<div style="height:4px;background:var(--bg-alt);margin-bottom:8px"><div style="height:100%;width:${barPercent}%;background:${barColor}"></div></div>`;
  h += `<div style="font-size:var(--fs-sm);color:var(--text-muted);margin-bottom:10px">${hasCredits ? 'Managed API keys active' : 'No credits — BYOK mode'}${hasSub ? ' · <span style="color:var(--green)">Auto-refill</span>' : ''}</div>`;
  h += `<button class="modal-sm-btn" style="width:100%" id="buyCreditsBtn">${hasCredits ? 'Buy more credits' : 'Buy credits'}</button>`;
  h += `</div>`;

  if (!hasCredits) {
    h += `<div style="padding:10px;background:var(--bg-alt);margin-bottom:12px;font-size:var(--fs-sm);color:var(--text-muted)">`;
    h += `Free tier: <strong>1 scan per day</strong>, up to 10 accounts.`;
    if (profile?.free_scan_available) h += `<br><span style="color:var(--green)">✓ Free scan available today</span>`;
    else h += `<br>✗ Free scan used today — resets tomorrow`;
    h += `</div>`;
  }

  if (hasSub) h += `<button class="modal-sm-btn" style="width:100%;margin-bottom:8px" id="manageBillingBtn2">Manage subscription</button>`;
  h += `<button class="modal-sm-btn" style="width:100%;margin-bottom:8px" data-open-settings="api">API keys</button>`;
  h += `<button class="modal-sm-btn" style="width:100%;margin-bottom:8px" data-open-settings="analyst">Analysts</button>`;
  h += `<button class="modal-sm-btn" style="width:100%;margin-bottom:8px" data-open-settings="display">Display settings</button>`;

  h += `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">`;
  h += `<button style="background:none;border:none;color:var(--red);font-size:var(--fs);cursor:pointer;width:100%" id="signOutBtn">Sign out</button>`;
  h += `</div>`;

  modal.querySelector('.modal').innerHTML = h;
}

// ============================================================================
// DEV TOOLBAR
// ============================================================================

export function renderDevToolbar() {
  let toolbar = $('devToolbar');
  if (!toolbar) return;
  const isAuth = auth.isAuthenticated();
  const profile = api.getCachedProfile();
  const credits = profile?.credits_balance || 0;

  const CREDIT_PRESETS = [0, 100, 1000, 5000, 15000];

  let h = `<span style="font-weight:600;color:#a78bfa;flex-shrink:0">DEV</span>`;
  h += `<span style="width:1px;height:16px;background:#3f3f46"></span>`;

  // Auth state
  h += `<span style="color:#71717a">Auth:</span>`;
  if (isAuth) {
    h += `<span style="color:#4ade80;display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:#4ade80"></span>${esc(auth.getUserEmail())}</span>`;
  } else {
    h += `<span style="color:#71717a">signed out</span>`;
  }

  h += `<span style="width:1px;height:16px;background:#3f3f46"></span>`;

  // Credits switcher
  h += `<span style="color:#71717a">Credits:</span>`;
  CREDIT_PRESETS.forEach(c => {
    const isActive = isAuth && credits === c;
    h += `<button data-dev-credits="${c}" style="padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;border:none;cursor:pointer;${isActive ? 'background:#7c3aed;color:white' : 'background:#27272a;color:#a1a1aa'}">${c === 0 ? 'free' : c.toLocaleString()}</button>`;
  });
  if (isAuth) {
    h += `<button id="devLogout" style="padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;border:none;cursor:pointer;background:#27272a;color:#f87171">logout</button>`;
  }

  h += `<span style="width:1px;height:16px;background:#3f3f46"></span>`;

  // Mock data
  h += `<span style="color:#71717a">Data:</span>`;
  h += `<button id="devMockSignals" style="padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;border:none;cursor:pointer;background:#27272a;color:#fbbf24">Mock signals</button>`;

  h += `<span style="width:1px;height:16px;background:#3f3f46"></span>`;

  // Open dialogs
  h += `<span style="color:#71717a">Open:</span>`;
  h += `<button data-dev-open="auth" style="padding:2px 8px;border-radius:4px;font-size:12px;border:none;cursor:pointer;background:#27272a;color:#d4d4d8">Auth</button>`;
  h += `<button data-dev-open="account" style="padding:2px 8px;border-radius:4px;font-size:12px;border:none;cursor:pointer;background:#27272a;color:#d4d4d8">Account</button>`;
  h += `<button data-dev-open="pricing" style="padding:2px 8px;border-radius:4px;font-size:12px;border:none;cursor:pointer;background:#27272a;color:#d4d4d8">Credits</button>`;
  h += `<button data-dev-open="settings" style="padding:2px 8px;border-radius:4px;font-size:12px;border:none;cursor:pointer;background:#27272a;color:#d4d4d8">Settings</button>`;
  h += `<button data-dev-open="onboarding" style="padding:2px 8px;border-radius:4px;font-size:12px;border:none;cursor:pointer;background:#27272a;color:#d4d4d8">Onboarding</button>`;

  // Collapse
  h += `<button id="devCollapse" style="margin-left:auto;color:#71717a;background:none;border:none;cursor:pointer;font-size:14px">✕</button>`;

  toolbar.innerHTML = h;
  toolbar.style.display = 'flex';
}

export function collapseDevToolbar() {
  const toolbar = $('devToolbar');
  if (toolbar) toolbar.style.display = 'none';
  let fab = $('devFab');
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'devFab';
    fab.textContent = 'DEV';
    fab.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:#7c3aed;color:white;border:none;padding:6px 12px;border-radius:9999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
    fab.addEventListener('click', () => {
      fab.style.display = 'none';
      renderDevToolbar();
    });
    document.body.appendChild(fab);
  }
  fab.style.display = 'block';
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
  let h = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:32px">`;
  STEPS.forEach((_, i) => {
    const w = i === step ? '24px' : '6px';
    const bg = i === step ? 'var(--text-strong)' : i < step ? 'rgba(var(--text-strong-rgb),0.4)' : 'rgba(var(--text-strong-rgb),0.15)';
    h += `<div style="height:6px;width:${w};border-radius:3px;background:${bg};transition:all 0.3s"></div>`;
  });
  h += `</div>`;

  // Step content
  if (step === 0) {
    // Welcome
    h += `<div>`;
    h += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:24px"><div style="width:8px;height:14px;background:var(--text-strong)"></div><span style="font-weight:500">sentry</span></div>`;
    h += `<h1 style="font-size:var(--fs-xl);color:var(--text-strong);margin-bottom:12px">signal without the noise</h1>`;
    h += `<p style="color:var(--text-muted);margin-bottom:24px;line-height:1.6">Sentry scans X/Twitter accounts and uses AI to extract actionable trading signals — tickers, sentiment, and catalysts — from the noise.</p>`;
    h += `<div style="margin-bottom:24px">`;
    ['Sign in or add your own API keys', 'Pick accounts or presets to monitor', 'Hit scan and get structured signals'].forEach((t, i) => {
      h += `<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:8px;font-size:var(--fs)"><div style="width:20px;height:20px;border-radius:50%;background:var(--text-10);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:var(--fs-xs)">${i+1}</div><span style="color:var(--text-muted)">${t}</span></div>`;
    });
    h += `</div>`;
    h += `<button class="scan-btn" data-ob-next>Get started →</button>`;
    h += `</div>`;
  } else if (step === 1) {
    // Setup
    if (isAuth) {
      h += `<div style="padding:16px 0">`;
      h += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><div style="width:28px;height:28px;border-radius:50%;background:var(--green-10);display:flex;align-items:center;justify-content:center;color:var(--green);font-size:14px;flex-shrink:0">✓</div><h2 style="font-size:var(--fs-lg);color:var(--text-strong)">You're signed in</h2></div>`;
      h += `<p style="color:var(--text-muted);margin-bottom:24px">Buy credits for managed API keys, or use your own keys for free.</p>`;
      h += `<div style="display:flex;justify-content:space-between"><button class="modal-sm-btn" data-ob-back>Back</button><button class="scan-btn" data-ob-next>Continue →</button></div>`;
      h += `</div>`;
    } else if (!onStep.path) {
      // Choose path
      h += `<div style="margin-bottom:24px"><h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:8px">How do you want to use Sentry?</h2><p style="color:var(--text-muted)">Sign in for the easiest experience, or bring your own API keys.</p></div>`;
      h += `<button data-ob-path="signin" style="width:100%;text-align:left;padding:12px;border:1px solid var(--green-10);background:var(--green-10);margin-bottom:12px;cursor:pointer;font-size:var(--fs);color:var(--text-strong)"><span style="font-size:var(--fs-xs);color:var(--green);background:var(--green-10);padding:1px 5px;margin-bottom:4px;display:inline-block">Recommended</span><br><strong>Sign in</strong><br><span style="color:var(--text-muted)">Sign in and buy credits for managed API keys. Or use the free tier (1 scan/day, 10 accounts).</span></button>`;
      h += `<button data-ob-path="byok" style="width:100%;text-align:left;padding:12px;border:1px solid var(--border);background:none;cursor:pointer;font-size:var(--fs);color:var(--text-strong)"><strong>Use your own API keys</strong><br><span style="color:var(--text-muted)">Bring your own X/Twitter and Anthropic keys. Unlimited scans.</span></button>`;
      h += `<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="modal-sm-btn" data-ob-back>Back</button></div>`;
    } else if (onStep.path === 'signin') {
      h += `<div style="margin-bottom:16px"><h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:8px">Sign in</h2></div>`;
      h += `<div id="obAuthError" style="color:var(--red);font-size:var(--fs);margin-bottom:8px;display:none"></div>`;
      h += `<div id="obAuthMsg" style="color:var(--green);font-size:var(--fs);margin-bottom:8px;display:none"></div>`;
      h += `<button class="modal-sm-btn" style="width:100%;margin-bottom:12px" id="obGoogleBtn">Continue with Google</button>`;
      h += `<div style="border-top:1px solid var(--border);margin:12px 0;padding-top:12px">`;
      h += `<div style="margin-bottom:12px"><label style="display:block;margin-bottom:6px;font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase">Email</label><input type="email" id="obEmail" placeholder="you@email.com" style="width:100%;background:var(--bg-alt);border:none;color:var(--text-strong);font-family:inherit;font-size:inherit;outline:none"></div>`;
      h += `<div style="margin-bottom:12px"><label style="display:block;margin-bottom:6px;font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase">Password</label><input type="password" id="obPassword" placeholder="••••••••" style="width:100%;background:var(--bg-alt);border:none;color:var(--text-strong);font-family:inherit;font-size:inherit;outline:none"></div>`;
      h += `<div style="display:flex;gap:8px"><button class="scan-btn" style="flex:1" id="obLoginBtn">Log in</button><button class="modal-sm-btn" style="flex:1" id="obSignupBtn">Sign up</button></div>`;
      h += `</div>`;
      h += `<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="modal-sm-btn" data-ob-path="">Back</button><button class="modal-sm-btn" data-ob-next style="color:var(--text-muted)">Skip</button></div>`;
    } else {
      // BYOK
      h += `<div style="margin-bottom:16px"><h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:8px">API keys</h2><p style="color:var(--text-muted)">Your keys are stored on your device and never shared.</p></div>`;
      h += `<div style="margin-bottom:12px"><label style="display:block;margin-bottom:6px;font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase">X/Twitter API key</label><input type="password" id="obTwKey" placeholder="Your twitterapi.io key" value="${esc(engine.getTwKey())}" style="width:100%;background:var(--bg-alt);border:none;color:var(--text-strong);font-family:inherit;font-size:inherit;outline:none"><p style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:6px"><a href="https://twitterapi.io" target="_blank" style="color:var(--blue)">Get one at twitterapi.io →</a></p></div>`;
      h += `<div style="margin-bottom:12px"><label style="display:block;margin-bottom:6px;font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase">Anthropic API key</label><input type="password" id="obAnKey" placeholder="sk-ant-..." value="${esc(engine.getAnKey())}" style="width:100%;background:var(--bg-alt);border:none;color:var(--text-strong);font-family:inherit;font-size:inherit;outline:none"><p style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:6px"><a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--blue)">Get one at console.anthropic.com →</a></p></div>`;
      h += `<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="modal-sm-btn" data-ob-path="">Back</button><div style="display:flex;gap:8px"><button class="modal-sm-btn" data-ob-next style="color:var(--text-muted)">Skip</button><button class="scan-btn" data-ob-next>Continue →</button></div></div>`;
    }
  } else if (step === 2) {
    // Accounts
    h += `<div style="margin-bottom:16px"><h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:8px">Accounts to scan</h2><p style="color:var(--text-muted)">Pick a preset or add individual accounts.</p></div>`;
    h += `<label>Presets</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">`;
    engine.getPresets().filter(p => !p.hidden).forEach(p => {
      const active = appState.loadedPresets.includes(p.name);
      h += `<button data-ob-preset="${esc(p.name)}" style="padding:6px 12px;border:1px solid ${active ? 'var(--text-strong)' : 'var(--border)'};background:${active ? 'var(--text-10)' : 'none'};color:${active ? 'var(--text-strong)' : 'var(--text-muted)'};cursor:pointer;font-size:var(--fs);display:flex;align-items:center;gap:6px">${active ? '✓ ' : ''}${esc(p.name)} <span style="font-size:var(--fs-xs);opacity:0.6">${p.accounts.length}</span></button>`;
    });
    h += `</div>`;
    h += `<label style="display:block;margin-bottom:6px;margin-top:16px;font-size:var(--fs-sm);color:var(--text-muted);text-transform:uppercase">Custom accounts</label>`;
    h += `<div style="display:flex;gap:8px;margin-bottom:8px"><input type="text" id="obAccountInput" placeholder="@username" style="flex:1;background:var(--bg-alt);border:none;color:var(--text-strong);font-family:inherit;font-size:inherit;outline:none"><button class="modal-sm-btn" id="obAddAccountBtn">Add</button></div>`;
    if (appState.customAccounts.length) {
      h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">`;
      appState.customAccounts.forEach(a => {
        h += `<button data-ob-rm-account="${esc(a)}" style="background:var(--text-10);border:none;color:var(--text-muted);font-size:var(--fs);cursor:pointer">@${esc(a)} ×</button>`;
      });
      h += `</div>`;
    }
    const hasAccounts = appState.customAccounts.length > 0 || appState.loadedPresets.length > 0;
    h += `<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="modal-sm-btn" data-ob-back>Back</button><div style="display:flex;gap:8px"><button class="modal-sm-btn" data-ob-next style="color:var(--text-muted)">Skip</button><button class="scan-btn" data-ob-next ${hasAccounts ? '' : 'disabled'}>Continue →</button></div></div>`;
  } else if (step === 3) {
    // Analysts
    h += `<div style="margin-bottom:16px"><h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:8px">Analysts</h2><p style="color:var(--text-muted)">Analysts are AI prompts that tell Sentry what to look for.</p></div>`;
    h += `<div style="border:1px solid var(--border);padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--text-strong)">Default</span><span style="font-size:var(--fs-xs);color:var(--green);background:var(--green-10);padding:1px 5px">active</span></div><p style="color:var(--text-muted);font-size:var(--fs-sm)">Trading signals — directional views, catalysts, technicals, on-chain data, contrarian takes.</p></div>`;
    h += `<label>Add analysts</label>`;
    SUGGESTED_ANALYSTS.forEach(sa => {
      const active = onStep.selectedAnalysts?.has(sa.id);
      h += `<button data-ob-analyst="${sa.id}" style="width:100%;text-align:left;padding:12px;border:1px solid ${active ? 'var(--text-strong)' : 'var(--border)'};background:${active ? 'var(--text-10)' : 'none'};margin-bottom:8px;cursor:pointer;font-size:var(--fs)"><div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border:1px solid ${active ? 'var(--text-strong)' : 'var(--border)'};border-radius:3px;display:flex;align-items:center;justify-content:center;background:${active ? 'var(--text-strong)' : 'none'};color:var(--bg);font-size:10px">${active ? '✓' : ''}</span><span style="color:var(--text-strong)">${esc(sa.name)}</span></div><p style="color:var(--text-muted);font-size:var(--fs-sm);margin-top:4px;padding-left:24px">${esc(sa.description)}</p></button>`;
    });
    h += `<p style="color:var(--text-muted);font-size:var(--fs-sm);margin-top:8px">You can create, edit, or remove analysts anytime in settings.</p>`;
    h += `<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="modal-sm-btn" data-ob-back>Back</button><button class="scan-btn" data-ob-next>Continue →</button></div>`;
  } else if (step === 4) {
    // Ready
    const hasKeys = isAuth || engine.bothKeys();
    const hasAccounts = appState.customAccounts.length > 0 || appState.loadedPresets.length > 0;
    h += `<div>`;
    h += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><div style="width:28px;height:28px;border-radius:50%;background:var(--green-10);display:flex;align-items:center;justify-content:center;color:var(--green);font-size:14px;flex-shrink:0">✓</div><h2 style="font-size:var(--fs-lg);color:var(--text-strong)">You're all set</h2></div>`;
    h += `<p style="color:var(--text-muted);margin-bottom:24px">You can always change your settings later.</p>`;
    h += `</div>`;
    h += `<div style="margin-bottom:24px;font-size:var(--fs)">`;
    h += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">Account</span><span style="color:${isAuth ? 'var(--green)' : 'var(--text-muted)'}">${isAuth ? '✓ signed in' : 'not signed in'}</span></div>`;
    if (!isAuth) {
      h += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">API keys</span><span style="color:${hasKeys ? 'var(--green)' : 'var(--text-muted)'}">${hasKeys ? '✓ configured' : 'skipped'}</span></div>`;
    }
    h += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">Accounts</span><span style="color:${hasAccounts ? 'var(--green)' : 'var(--text-muted)'}">${hasAccounts ? '✓ ' + (appState.loadedPresets.join(', ') || '') + (appState.customAccounts.length ? (appState.loadedPresets.length ? ' + ' : '') + appState.customAccounts.length + ' custom' : '') : 'skipped'}</span></div>`;
    h += `<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="color:var(--text-muted)">Analysts</span><span style="color:var(--green)">✓ ${1 + (onStep.selectedAnalysts?.size || 0)} active</span></div>`;
    h += `</div>`;
    h += `<div style="display:flex;gap:8px;align-items:center"><button class="scan-btn" data-ob-finish>Start using sentry →</button><button class="modal-sm-btn" data-ob-back style="color:var(--text-muted)">Go back</button></div>`;
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
      const header = (author || time) ? `<div style="opacity:.7;margin-bottom:8px">@${esc(author)} · ${esc(time)}</div>` : '';
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
