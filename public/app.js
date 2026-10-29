/**
 * ============================================================================
 * MoatWatch — Luxury Fintech & Garmin Connect IQ Portfolio Terminal
 * Web Application Controller (Argon Redesign — 100% Real Data & Full Parity)
 * ============================================================================
 */
(() => {
  const Sim = window.MoatWatchSimulator || {};

  function generateRandomSyncKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `V2-${suffix}`;
  }

  function resolveInitialSyncKey() {
    const params = new URLSearchParams(window.location.search);
    const urlKey = (params.get('key') || params.get('syncKey') || '').trim().toUpperCase();
    if (urlKey && /^[A-Z0-9_-]{3,24}$/.test(urlKey)) {
      localStorage.setItem('venu2_sync_key', urlKey);
      localStorage.setItem('garmin_moat_sync_key', urlKey);
      localStorage.setItem('venu2_sync_key_isolated', '1');
      return urlKey;
    }
    const savedKey = (localStorage.getItem('venu2_sync_key') || localStorage.getItem('garmin_moat_sync_key') || '').trim().toUpperCase();
    const isIsolated = localStorage.getItem('venu2_sync_key_isolated') === '1';
    if (savedKey && /^[A-Z0-9_-]{3,24}$/.test(savedKey) && (savedKey !== 'VENU2-88' || isIsolated)) {
      return savedKey;
    }
    const freshKey = generateRandomSyncKey();
    localStorage.setItem('venu2_sync_key', freshKey);
    localStorage.setItem('garmin_moat_sync_key', freshKey);
    localStorage.setItem('venu2_sync_key_isolated', '1');
    return freshKey;
  }

  const state = {
    syncKey: resolveInitialSyncKey(),
    profile: null,
    activePortfolioIndex: 0,
    viewAllPortfolios: false,
    holdingsFilter: 'ALL', // 'ALL' | 'WATCHLIST' | 'ALERTS' | 'MEMO'
    globalSearchQuery: '',
    activeSymbolIndex: 0,
    watchMode: 'list', // 'glance' | 'list' | 'detail'
    watchPnlMode: 'day', // 'day' | 'total'
    watchShowBb: true,
    watchScrollOffset: 0,
    selectedWatchModel: localStorage.getItem('garmin_watch_model') || 'venu2',
    compatibleDevices: [],
    activeDockTab: 'preview', // 'preview' | 'alerts' | 'memo' | 'device'
    privacyMaskBalances: localStorage.getItem('mw_privacy_balances') === '1',
    privacyMaskKeys: localStorage.getItem('mw_privacy_keys') !== '0', // Default true to protect keys in screenshots
    watchMetricsVisibility: {
      dayPnl: true,
      totalReturn: true,
      alerts: true,
      memo: true
    },
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: false,
      sortByPctOrder: 'ASC',
      sortByPctMetric: 'DAY',
      deviceId: 'V2-88VENU20',
      activationKey: ''
    },
    license: null,
    autoSwipeTimerId: null,
    autoSwipeCountdown: 5,
    quoteRefreshIntervalId: null
  };

  const el = id => document.getElementById(id);

  function showToast(msg) {
    const banner = el('toastBanner');
    const text = el('toastMessage');
    if (!banner || !text) return;
    text.textContent = msg;
    banner.classList.remove('opacity-0', 'translate-y-3');
    banner.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      banner.classList.add('opacity-0', 'translate-y-3');
      banner.classList.remove('opacity-100', 'translate-y-0');
    }, 2800);
  }

  const escapeHtml = Sim.escapeHtml || (str => String(str ?? ''));
  const rawFormatMoney = Sim.formatMoney || ((val, cur) => `${cur === 'THB' ? '฿' : '$'}${Number(val || 0).toFixed(2)}`);
  const rawFormatSignedMoney = Sim.formatSignedMoney || ((val, cur) => `${Number(val || 0) >= 0 ? '+' : ''}${rawFormatMoney(val, cur)}`);
  const formatSignedPct = Sim.formatSignedPct || ((val, digits = 2) => `${Number(val || 0) >= 0 ? '+' : ''}${Number(val || 0).toFixed(digits)}%`);
  const formatCompactPrice = Sim.formatCompactPrice || ((val, cur) => rawFormatMoney(val, cur));
  const formatDeviceRes = Sim.formatDeviceRes || (res => String(res || '416×416'));
  const getRsiZoneStyle = Sim.getRsiZoneStyle || (() => ({ textClass: 'text-cyan-300', zoneLabel: 'Neutral' }));
  const getFearGreedZoneStyle = Sim.getFearGreedZoneStyle || (() => ({
    score: 64,
    code: 'G',
    rating: 'Greed',
    badge: 'FG:64G',
    textClass: 'text-emerald-400',
    pillClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    barColor: '#10B981'
  }));
  const sortPortfolioItems = Sim.sortPortfolioItems || (items => items);

  function formatMoney(val, currency = 'USD', compact = false) {
    if (state.privacyMaskBalances) {
      return currency === 'THB' ? '฿••••••' : '$••••••';
    }
    return rawFormatMoney(val, currency, compact);
  }

  function formatSignedMoney(val, currency = 'USD', compact = false) {
    if (state.privacyMaskBalances) {
      const sign = Number(val || 0) >= 0 ? '+' : '-';
      return `${sign}${currency === 'THB' ? '฿••••' : '$••••'}`;
    }
    return rawFormatSignedMoney(val, currency, compact);
  }

  function maskSecretIdentifier(rawValue) {
    const clean = String(rawValue || '').trim();
    if (!clean || !state.privacyMaskKeys) return clean;
    if (clean.length <= 4) return '••••';
    return `${clean.slice(0, 3)}••••${clean.slice(-2)}`;
  }

  function normalizeServerPayload(raw) {
    return Sim.normalizeServerPayload(raw, state.syncKey);
  }

  function getActivePortfolio() {
    if (!state.profile || !Array.isArray(state.profile.portfolios)) return null;
    return state.profile.portfolios[state.activePortfolioIndex] || state.profile.portfolios[0] || null;
  }

  function getAllHoldingsWithPortfolioContext() {
    if (!state.profile || !Array.isArray(state.profile.portfolios)) return [];
    const results = [];
    state.profile.portfolios.forEach((port, pIdx) => {
      (port.items || []).forEach((item, hIdx) => {
        results.push({
          ...item,
          _portfolioIndex: pIdx,
          _holdingIndex: hIdx,
          _portfolioName: port.name,
          _portfolioShortName: port.shortName
        });
      });
    });
    return results;
  }

  function applyClientSideSort() {
    if (!state.profile || !Array.isArray(state.profile.portfolios)) return;
    const sortOrder = String(state.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
    const sortMetric = String(state.watchSettings?.sortByPctMetric || 'DAY').toUpperCase();

    for (const port of state.profile.portfolios) {
      if (!Array.isArray(port.items)) continue;
      if (sortOrder === 'WEIGHT') {
        port.items.sort((a, b) => Number(b.allocationPct || 0) - Number(a.allocationPct || 0));
      } else {
        sortPortfolioItems(port.items, sortOrder, sortMetric);
      }
    }
  }

  /* ==========================================================================
     API DATA FETCHING & PERSISTENCE
     ========================================================================== */
  async function loadPortfolio(syncKey = state.syncKey) {
    try {
      const cleanKey = (syncKey || 'VENU2-88').trim().toUpperCase();
      state.syncKey = cleanKey;
      localStorage.setItem('garmin_moat_sync_key', cleanKey);

      const currentUrl = new URL(window.location.href);
      if (cleanKey !== 'VENU2-88') {
        currentUrl.searchParams.set('key', cleanKey);
      } else {
        currentUrl.searchParams.delete('key');
      }
      window.history.replaceState({}, '', currentUrl.toString());

      const res = await fetch(`/api/portfolio?key=${encodeURIComponent(cleanKey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      state.profile = normalizeServerPayload(raw);
      state.watchSettings = { ...state.profile.watchSettings };
      state.watchPnlMode = state.watchSettings.sortByPctMetric === 'TOTAL' ? 'total' : 'day';
      state.license = state.profile.license;
      applyClientSideSort();
      if (state.activePortfolioIndex >= state.profile.portfolios.length) {
        state.activePortfolioIndex = 0;
      }
      renderAll();
      syncAutoSwipeLoop();
    } catch (err) {
      showToast(`Sync Error: ${err.message}`);
    }
  }

  async function savePortfolioState(toastText = 'Saved & Synced to Garmin Watch') {
    if (!state.profile) return;

    const webFormatPayload = {
      syncKey: state.syncKey,
      baseCurrency: state.profile.baseCurrency,
      watchSettings: state.watchSettings,
      portfolios: state.profile.portfolios.map(p => ({
        id: p.id,
        name: p.name,
        holdings: (p.items || []).map(it => ({
          symbol: it.symbol,
          name: it.name,
          shares: Number(it.shares || 0),
          avgCost: Number(it.avgCost || 0),
          currency: it.currency || 'USD',
          targetPrice: Number(it.targetPrice || 0),
          stopPrice: Number(it.stopPrice || 0),
          alertDir: it.stopPrice > 0 && !it.targetPrice ? 'BELOW' : 'ABOVE',
          earningsDate: String(it.earningsDate || '').replace(/^e-/i, '').trim(),
          memo: it.note || ''
        }))
      }))
    };

    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webFormatPayload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to save portfolio');
    }

    const updatedRaw = await res.json();
    state.profile = normalizeServerPayload(updatedRaw);
    state.watchSettings = { ...state.profile.watchSettings };
    state.watchPnlMode = state.watchSettings.sortByPctMetric === 'TOTAL' ? 'total' : 'day';
    state.license = state.profile.license;
    applyClientSideSort();
    renderAll();
    syncAutoSwipeLoop();
    if (toastText) showToast(toastText);
  }

  /* ==========================================================================
     AUTO-SWIPE CAROUSEL ENGINE
     ========================================================================== */
  function updateWatchStatusBadges() {
    const enabled = Boolean(state.watchSettings?.autoSwipeEnabled);
    const aon = Boolean(state.watchSettings?.alwaysOnDisplay);
    const remSec = Math.max(1, Number(state.autoSwipeCountdown || state.watchSettings?.autoSwipeSec || 5));

    const topBadge = el('autoSwipeCountdownBadge');
    if (topBadge) {
      if (enabled) {
        topBadge.textContent = `Auto-Swipe: ${remSec}s`;
        topBadge.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-cyan/15 text-cyan ring-1 ring-cyan/30';
      } else {
        topBadge.textContent = 'Auto-Swipe: OFF';
        topBadge.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] text-slate-400 ring-1 ring-white/10';
      }
    }

    const watchSwipeBadge = el('watchBadgeAutoSwipe');
    if (watchSwipeBadge) {
      if (enabled) {
        watchSwipeBadge.textContent = `AUTO ${remSec}s`;
        watchSwipeBadge.classList.remove('hidden');
      } else {
        watchSwipeBadge.classList.add('hidden');
      }
    }

    const watchAonBadge = el('watchBadgeAlwaysOn');
    if (watchAonBadge) {
      watchAonBadge.classList.toggle('hidden', !aon);
    }

    const watchSortBadge = el('watchBadgeSortOrder');
    if (watchSortBadge) {
      const srt = String(state.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
      if (srt === 'ASC') {
        watchSortBadge.textContent = '▲ -%→+%';
        watchSortBadge.className =
          'px-1.5 py-0.2 rounded-full bg-crimson/20 text-crimson text-[8px] hover:opacity-80 transition';
      } else if (srt === 'DESC') {
        watchSortBadge.textContent = '▼ +%→-%';
        watchSortBadge.className =
          'px-1.5 py-0.2 rounded-full bg-emerald/20 text-emerald text-[8px] hover:opacity-80 transition';
      } else {
        watchSortBadge.textContent = '• MANUAL';
        watchSortBadge.className =
          'px-1.5 py-0.2 rounded-full bg-white/10 text-slate-300 text-[8px] hover:opacity-80 transition';
      }
    }
  }

  function syncAutoSwipeLoop() {
    if (state.autoSwipeTimerId) {
      clearInterval(state.autoSwipeTimerId);
      state.autoSwipeTimerId = null;
    }

    const enabled = Boolean(state.watchSettings?.autoSwipeEnabled);
    const intervalSec = Math.max(2, Math.min(120, Number(state.watchSettings?.autoSwipeSec || 5)));
    state.autoSwipeCountdown = intervalSec;
    updateWatchStatusBadges();

    if (!enabled || state.license?.isExpired) return;

    state.autoSwipeTimerId = setInterval(() => {
      if (state.license?.isExpired) return;
      state.autoSwipeCountdown -= 1;
      if (state.autoSwipeCountdown <= 0) {
        state.autoSwipeCountdown = intervalSec;
        advanceWatchAutoSwipeStep();
      }
      updateWatchStatusBadges();
    }, 1000);
  }

  function advanceWatchAutoSwipeStep() {
    if (!state.profile || !state.profile.portfolios?.length) return;
    const ports = state.profile.portfolios;

    if (state.watchMode === 'glance' || state.watchMode === 'list') {
      state.activePortfolioIndex = (state.activePortfolioIndex + 1) % ports.length;
      state.activeSymbolIndex = 0;
      renderAll();
    } else if (state.watchMode === 'detail') {
      const activePort = getActivePortfolio();
      const items = activePort?.items || [];
      if (items.length <= 1) {
        state.activePortfolioIndex = (state.activePortfolioIndex + 1) % ports.length;
        state.activeSymbolIndex = 0;
      } else {
        state.activeSymbolIndex = (state.activeSymbolIndex + 1) % items.length;
      }
      renderGarminVenu2Watch();
    }
  }

  function resetAutoSwipeCountdown() {
    state.autoSwipeCountdown = Math.max(2, Math.min(120, Number(state.watchSettings?.autoSwipeSec || 5)));
    updateWatchStatusBadges();
  }

  /* ==========================================================================
     SPARKLINES & KPI MINI CHARTS (100% REAL DATA)
     ========================================================================== */
  function drawInlineSparkline(canvasEl, series, isUp) {
    if (!canvasEl || !Array.isArray(series) || series.length < 2) return;
    const ctx = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const pad = 4;

    const toX = i => (i / (series.length - 1)) * (w - pad * 2) + pad;
    const toY = v => h - pad - ((v - min) / span) * (h - pad * 2);

    const strokeColor = isUp ? '#10B981' : '#F43F5E';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, isUp ? 'rgba(16, 185, 129, 0.28)' : 'rgba(244, 63, 94, 0.28)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.beginPath();
    series.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(toX(series.length - 1), h);
    ctx.lineTo(toX(0), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    series.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const lastX = toX(series.length - 1);
    const lastY = toY(series[series.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();
  }

  function drawKpiDayPnlBarChart(allItems) {
    const canvas = el('kpiDayPnlCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const source = allItems || [];
    if (source.length === 0) return;

    // Sample up to 14 items evenly across sorted holdings so both gainers and losers render
    const maxBars = Math.min(14, source.length);
    const activeItems = [];
    for (let i = 0; i < maxBars; i++) {
      const idx = maxBars === 1 ? 0 : Math.round((i / (maxBars - 1)) * (source.length - 1));
      activeItems.push(source[idx]);
    }

    const vals = activeItems.map(it => Number(it.changePct || 0));
    const maxAbs = Math.max(0.8, ...vals.map(v => Math.abs(v)));
    const midY = Math.round(h / 2);

    // Baseline
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const gap = 3;
    const barW = Math.max(4, Math.floor((w - gap * (vals.length - 1)) / vals.length));

    vals.forEach((v, i) => {
      const x = i * (barW + gap);
      const barH = Math.max(2, Math.round((Math.abs(v) / maxAbs) * (midY - 3)));
      const y = v >= 0 ? midY - barH : midY;
      ctx.fillStyle = v >= 0 ? '#10B981' : '#F43F5E';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    });
  }

  function drawKpiTotalReturnCurve(allItems, isPositiveOverall) {
    const canvas = el('kpiTotalReturnCanvas');
    if (!canvas) return;

    // Aggregate weighted 14-point sparkline from real holdings
    const validHoldings = (allItems || []).filter(it => Array.isArray(it.sparkline) && it.sparkline.length > 1);
    if (validHoldings.length === 0) return;

    const len = Math.max(...validHoldings.map(it => it.sparkline.length));
    const composite = Array.from({ length: len }, (_, ptIdx) => {
      let sum = 0;
      validHoldings.forEach(it => {
        const series = it.sparkline;
        const sIdx = Math.min(series.length - 1, Math.floor((ptIdx / (len - 1)) * (series.length - 1)));
        const firstVal = series[0] || 1;
        const norm = (series[sIdx] || firstVal) / firstVal;
        const weight = Math.max(1, Number(it.marketValueBase || 1));
        sum += norm * weight;
      });
      return sum;
    });

    drawInlineSparkline(canvas, composite, isPositiveOverall);
  }

  /* ==========================================================================
     RENDER 1: TOP HEADER & 5-CARD EXECUTIVE KPI STRIP
     ========================================================================== */
  function renderHeaderAndKpiRow() {
    const p = state.profile;
    if (!p) return;

    const s = p.summary || {};
    const baseCur = p.baseCurrency || 'THB';
    const fxRate = Number(p.usdThbRate || 34.45);

    // Header Controls
    if (el('currentSyncKeyLabel')) {
      el('currentSyncKeyLabel').textContent = maskSecretIdentifier(p.syncKey);
    }
    if (el('toggleKeyMaskIcon')) {
      el('toggleKeyMaskIcon').className = state.privacyMaskKeys ? 'ph-bold ph-eye-slash' : 'ph-bold ph-eye';
    }
    if (el('togglePrivacyIcon')) {
      el('togglePrivacyIcon').className = state.privacyMaskBalances ? 'ph-bold ph-eye-slash text-cyan-300' : 'ph-bold ph-eye';
    }
    if (el('baseCurrencySelect')) {
      el('baseCurrencySelect').value = baseCur;
    }
    if (el('fxRateReadout')) {
      el('fxRateReadout').textContent = fxRate.toFixed(2);
    }

    const dt = new Date(p.fetchedAt || Date.now());
    const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (el('lastUpdatedBadge')) {
      el('lastUpdatedBadge').textContent = `Live · ${timeStr}`;
    }

    // Card 1: Total Portfolio Value (Primary + Secondary Converted Equivalent)
    const allHoldings = getAllHoldingsWithPortfolioContext();
    const totalBase = Number(s.totalValueBase || 0);
    const isWatchlistMode = totalBase === 0 && allHoldings.length > 0;

    if (el('grandTotalValue')) {
      el('grandTotalValue').textContent = formatMoney(totalBase, baseCur);
    }
    if (el('grandTotalSecondaryValue')) {
      if (isWatchlistMode) {
        el('grandTotalSecondaryValue').textContent = `Watchlist Mode · ${allHoldings.length} Tickers (0 sh)`;
      } else if (baseCur === 'THB') {
        const usdEq = fxRate > 0 ? totalBase / fxRate : 0;
        el('grandTotalSecondaryValue').textContent = `≈ ${formatMoney(usdEq, 'USD')} USD`;
      } else {
        const thbEq = totalBase * fxRate;
        el('grandTotalSecondaryValue').textContent = `≈ ${formatMoney(thbEq, 'THB')} THB`;
      }
    }
    if (el('grandTotalCost')) {
      el('grandTotalCost').textContent = formatMoney(s.totalCostBase, baseCur);
    }
    if (el('portfolioCountSummary')) {
      el('portfolioCountSummary').textContent = `${s.portfolioCount || 0} Portfolios · ${s.holdingCount || 0} Assets`;
    }

    // Card 2: Today's P&L
    const avgWatchlistDayPct =
      allHoldings.length > 0
        ? allHoldings.reduce((acc, h) => acc + Number(h.changePct || 0), 0) / allHoldings.length
        : 0;
    const effectiveDayPct = isWatchlistMode ? avgWatchlistDayPct : Number(s.dayPnlPct || 0);
    const dayPos = isWatchlistMode ? effectiveDayPct >= 0 : Number(s.dayPnlBase || 0) >= 0;
    if (el('grandDayPnl')) {
      el('grandDayPnl').textContent = formatSignedMoney(s.dayPnlBase, baseCur);
      el('grandDayPnl').className = `mw-kpi-value ${dayPos ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (el('grandDayPct')) {
      el('grandDayPct').textContent = isWatchlistMode
        ? `Avg ${formatSignedPct(effectiveDayPct)}`
        : formatSignedPct(effectiveDayPct);
      el('grandDayPct').className = dayPos ? 'mw-badge-up mt-0.5' : 'mw-badge-down mt-0.5';
    }

    const upCount = allHoldings.filter(h => Number(h.changePct || 0) > 0).length;
    const downCount = allHoldings.filter(h => Number(h.changePct || 0) < 0).length;
    if (el('kpiDayBreadthText')) {
      el('kpiDayBreadthText').textContent = `${upCount} Up · ${downCount} Down`;
    }
    drawKpiDayPnlBarChart(allHoldings);

    // Card 3: Total Return (Unrealized P&L)
    const totPos = isWatchlistMode ? effectiveDayPct >= 0 : Number(s.unrealizedPnlBase || 0) >= 0;
    if (el('grandTotalPnl')) {
      el('grandTotalPnl').textContent = formatSignedMoney(s.unrealizedPnlBase, baseCur);
      el('grandTotalPnl').className = `mw-kpi-value ${totPos ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (el('grandTotalPct')) {
      el('grandTotalPct').textContent = formatSignedPct(s.unrealizedPnlPct);
      el('grandTotalPct').className = totPos ? 'mw-badge-up mt-0.5' : 'mw-badge-down mt-0.5';
    }
    drawKpiTotalReturnCurve(allHoldings, totPos);

    // Card 4: Market Sentiment (US Fear & Greed Circular Gauge + Bar)
    const fg = p.fearGreed || {};
    const fgStyle = getFearGreedZoneStyle(fg.score ?? 64);
    if (el('fearGreedBadge')) {
      el('fearGreedBadge').textContent = fg.badge || fgStyle.badge;
      el('fearGreedBadge').className = `px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${fgStyle.pillClass}`;
    }
    if (el('fearGreedScoreReadout')) {
      el('fearGreedScoreReadout').textContent = String(fgStyle.score);
    }
    if (el('fearGreedGaugeArc')) {
      el('fearGreedGaugeArc').setAttribute('stroke-dasharray', `${fgStyle.score} 100`);
    }
    if (el('fearGreedLabel')) {
      el('fearGreedLabel').textContent = `${fgStyle.rating} (${fgStyle.code})`;
      el('fearGreedLabel').className = `text-xs font-bold truncate ${fgStyle.textClass}`;
    }
    if (el('fearGreedPrevText')) {
      const chg = Number(fg.change || 0);
      const chgStr = chg > 0 ? `+${chg}` : `${chg}`;
      el('fearGreedPrevText').textContent = `Prev: ${fg.prevClose ?? fgStyle.score} (${chgStr})`;
    }
    if (el('fearGreedBarFill')) {
      el('fearGreedBarFill').style.width = `${fgStyle.score}%`;
    }

    // Card 5: Portfolio & Market Pulse Breakdown (100% Real Portfolios + Top Live Movers)
    const configuredAlertsCount = allHoldings.filter(
      h => h.targetPrice > 0 || h.stopPrice > 0 || (h.alert && h.alert.status !== 'NONE')
    ).length;
    if (el('activeAlertCount')) {
      el('activeAlertCount').textContent = `${configuredAlertsCount} Alerts`;
    }
    if (el('headerAlertBadge')) {
      el('headerAlertBadge').textContent = String(configuredAlertsCount);
    }

    const pulseListEl = el('kpiMarketPulseList');
    if (pulseListEl) {
      const ports = (p.portfolios || []).slice(0, 3);
      const portRowsHtml = ports
        .map((port, idx) => {
          const portItems = port.items || [];
          const avgPortPct =
            portItems.length > 0
              ? portItems.reduce((a, b) => a + Number(b.changePct || 0), 0) / portItems.length
              : 0;
          const pctToDisplay = Number(port.totalValueBase || 0) === 0 ? avgPortPct : Number(port.dayPnlPct || 0);
          const isUp = pctToDisplay >= 0;
          return `
            <button
              type="button"
              data-pulse-port-idx="${idx}"
              class="w-full flex items-center justify-between gap-2 text-xs px-2 py-1 rounded-lg bg-[#060B13]/80 hover:bg-[#132135] border border-slate-800/80 transition"
            >
              <span class="font-semibold text-slate-200 truncate text-[11px]">${escapeHtml(port.name)}</span>
              <div class="flex items-center gap-2 font-mono shrink-0">
                <span class="text-[10px] text-slate-400">${
                  Number(port.totalValueBase || 0) > 0
                    ? formatMoney(port.totalValueBase, baseCur, true)
                    : `${portItems.length} tkrs`
                }</span>
                <span class="text-[10px] font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}">
                  ${formatSignedPct(pctToDisplay)}
                </span>
              </div>
            </button>
          `;
        })
        .join('');

      // If fewer than 3 portfolios, fill remaining slots with top real tickers & mini SVG sparkline
      const extraSlots = Math.max(0, 3 - ports.length);
      const topMovers = [...allHoldings]
        .sort((a, b) => Math.abs(Number(b.changePct || 0)) - Math.abs(Number(a.changePct || 0)))
        .slice(0, extraSlots);

      const moverRowsHtml = topMovers
        .map(item => {
          const isUp = Number(item.changePct || 0) >= 0;
          return `
            <button
              type="button"
              data-pulse-port-idx="${item._portfolioIndex}"
              data-pulse-hold-idx="${item._holdingIndex}"
              class="w-full flex items-center justify-between gap-2 text-xs px-2 py-1 rounded-lg bg-[#060B13]/60 hover:bg-[#132135] border border-slate-800/60 transition"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono font-bold text-white text-[11px]">${escapeHtml(item.symbol)}</span>
                <span class="text-[10px] text-slate-400 truncate">${escapeHtml(item.name)}</span>
              </div>
              <div class="flex items-center gap-2 font-mono shrink-0">
                <span class="text-[10px] text-slate-300">${formatMoney(item.price, item.currency)}</span>
                <span class="text-[10px] font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}">
                  ${formatSignedPct(item.changePct)}
                </span>
              </div>
            </button>
          `;
        })
        .join('');

      pulseListEl.innerHTML = portRowsHtml + moverRowsHtml;

      pulseListEl.querySelectorAll('[data-pulse-port-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.viewAllPortfolios = false;
          state.activePortfolioIndex = Number(btn.getAttribute('data-pulse-port-idx'));
          const hAttr = btn.getAttribute('data-pulse-hold-idx');
          state.activeSymbolIndex = hAttr !== null ? Number(hAttr) : 0;
          if (hAttr !== null) state.watchMode = 'detail';
          renderAll();
        });
      });
    }
  }

  /* ==========================================================================
     RENDER 2: PORTFOLIO SWITCHER TABS & HIGH-DENSITY HOLDINGS TABLE
     ========================================================================== */
  function renderPortfolioTabsAndRibbon() {
    const p = state.profile;
    if (!p) return;

    const allBtn = el('viewAllPortfoliosBtn');
    if (allBtn) {
      allBtn.className = `mw-portfolio-tab ${state.viewAllPortfolios ? 'active' : ''}`;
    }

    const container = el('portfolioTabsContainer');
    if (container) {
      container.innerHTML = (p.portfolios || [])
        .map((port, idx) => {
          const isActive = !state.viewAllPortfolios && idx === state.activePortfolioIndex;
          const pos = Number(port.dayPnlPct || 0) >= 0;
          return `
            <button
              type="button"
              data-port-idx="${idx}"
              class="mw-portfolio-tab ${isActive ? 'active' : ''}"
            >
              <span>${escapeHtml(port.name)}</span>
              <span class="font-mono text-[10px] px-1.5 py-0.2 rounded ${
                pos ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
              }">
                ${formatSignedPct(port.dayPnlPct, 1)}
              </span>
            </button>
          `;
        })
        .join('');

      container.querySelectorAll('[data-port-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.viewAllPortfolios = false;
          state.activePortfolioIndex = Number(btn.getAttribute('data-port-idx'));
          state.activeSymbolIndex = 0;
          resetAutoSwipeCountdown();
          renderAll();
        });
      });
    }

    // Filter Pills Active State
    document.querySelectorAll('#holdingsFilterPills [data-filter]').forEach(btn => {
      const f = btn.getAttribute('data-filter');
      btn.className = `mw-filter-pill ${state.holdingsFilter === f ? 'active' : ''}`;
    });

    // Sort Select Sync
    const sortSelect = el('sortHoldingsSelect');
    if (sortSelect && state.watchSettings?.sortByPctOrder) {
      sortSelect.value = state.watchSettings.sortByPctOrder;
    }

    // Active Portfolio Summary Ribbon
    const baseCur = p.baseCurrency || 'THB';
    if (state.viewAllPortfolios) {
      const s = p.summary || {};
      if (el('activePortfolioTitle')) el('activePortfolioTitle').textContent = 'All Portfolios Combined';
      if (el('activePortfolioMeta')) {
        el('activePortfolioMeta').textContent = `${s.portfolioCount || 0} Portfolios · ${s.holdingCount || 0} Total Assets`;
      }
      if (el('activePortValue')) el('activePortValue').textContent = formatMoney(s.totalValueBase, baseCur);
      if (el('activePortDayPnl')) {
        const dPos = Number(s.dayPnlBase || 0) >= 0;
        el('activePortDayPnl').textContent = `${formatSignedMoney(s.dayPnlBase, baseCur, true)} (${formatSignedPct(s.dayPnlPct)})`;
        el('activePortDayPnl').className = `font-mono font-bold ${dPos ? 'text-emerald-400' : 'text-rose-400'}`;
      }
      if (el('activePortTotalPnl')) {
        const tPos = Number(s.unrealizedPnlBase || 0) >= 0;
        el('activePortTotalPnl').textContent = `${formatSignedMoney(s.unrealizedPnlBase, baseCur, true)} (${formatSignedPct(s.unrealizedPnlPct)})`;
        el('activePortTotalPnl').className = `font-mono font-bold ${tPos ? 'text-emerald-400' : 'text-rose-400'}`;
      }
    } else {
      const activePort = getActivePortfolio();
      if (!activePort) return;
      if (el('activePortfolioTitle')) el('activePortfolioTitle').textContent = activePort.name;
      if (el('activePortfolioMeta')) {
        el('activePortfolioMeta').textContent = `${(activePort.items || []).length} Assets · Synced with Garmin Watch Slot #${state.activePortfolioIndex + 1}`;
      }
      if (el('activePortValue')) el('activePortValue').textContent = formatMoney(activePort.totalValueBase, baseCur);
      if (el('activePortDayPnl')) {
        const dPos = Number(activePort.dayPnlBase || 0) >= 0;
        el('activePortDayPnl').textContent = `${formatSignedMoney(activePort.dayPnlBase, baseCur, true)} (${formatSignedPct(activePort.dayPnlPct)})`;
        el('activePortDayPnl').className = `font-mono font-bold ${dPos ? 'text-emerald-400' : 'text-rose-400'}`;
      }
      if (el('activePortTotalPnl')) {
        const tPos = Number(activePort.unrealizedPnlBase || 0) >= 0;
        el('activePortTotalPnl').textContent = `${formatSignedMoney(activePort.unrealizedPnlBase, baseCur, true)} (${formatSignedPct(activePort.unrealizedPnlPct)})`;
        el('activePortTotalPnl').className = `font-mono font-bold ${tPos ? 'text-emerald-400' : 'text-rose-400'}`;
      }
    }
  }

  function renderHoldingsTable() {
    const container = el('holdingsListContainer');
    if (!container || !state.profile) return;

    const rawItems = state.viewAllPortfolios
      ? getAllHoldingsWithPortfolioContext()
      : (getActivePortfolio()?.items || []).map((it, idx) => ({
          ...it,
          _portfolioIndex: state.activePortfolioIndex,
          _holdingIndex: idx,
          _portfolioName: getActivePortfolio()?.name || ''
        }));

    // Filter by pill + global search query
    const q = state.globalSearchQuery.trim().toLowerCase();
    const filtered = rawItems.filter(item => {
      if (state.holdingsFilter === 'WATCHLIST' && Number(item.shares || 0) > 0) return false;
      if (
        state.holdingsFilter === 'ALERTS' &&
        !(item.targetPrice > 0 || item.stopPrice > 0 || (item.alert && item.alert.status !== 'NONE'))
      ) {
        return false;
      }
      if (state.holdingsFilter === 'MEMO' && !item.note) return false;

      if (q) {
        const hay = `${item.symbol} ${item.name} ${item.note || ''} ${item._portfolioName || ''} ${item.earningsBadge || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Update Footer Stats
    const alertTotal = rawItems.filter(it => it.targetPrice > 0 || it.stopPrice > 0).length;
    const memoTotal = rawItems.filter(it => Boolean(it.note)).length;
    if (el('tableShowingCount')) {
      el('tableShowingCount').textContent = `Showing ${filtered.length} of ${rawItems.length} assets`;
    }
    if (el('tableAlertsSummary')) {
      el('tableAlertsSummary').textContent = `${alertTotal} Active Alerts`;
    }
    if (el('tableMemosSummary')) {
      el('tableMemosSummary').textContent = `${memoTotal} WebMemos`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="p-10 text-center space-y-2">
          <i class="ph-duotone ph-magnifying-glass text-3xl text-cyan-400"></i>
          <p class="text-sm font-bold text-white">No matching holdings in this view</p>
          <p class="text-xs text-slate-400">Try clearing the filter or click "+ Add Asset" to add a ticker.</p>
        </div>
      `;
      return;
    }

    const rowsHtml = filtered
      .map((item, renderIdx) => {
        const isSelected =
          item._portfolioIndex === state.activePortfolioIndex && item._holdingIndex === state.activeSymbolIndex;
        const dayPos = Number(item.changePct || 0) >= 0;
        const pnlPos = Number(item.unrealizedPnlNative || 0) >= 0;
        const isWatchlist = Number(item.shares || 0) === 0;
        const tickerShort = String(item.symbol || '').replace('.BK', '').slice(0, 4);
        const rsiStyle = getRsiZoneStyle(item.rsi14);

        let signalBadges = '';
        if (item.alert?.status === 'TARGET_HIT') {
          signalBadges += `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">▲ TARGET HIT</span>`;
        } else if (item.alert?.status === 'STOP_BREACH') {
          signalBadges += `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">▼ STOP BREACH</span>`;
        } else if (item.targetPrice > 0) {
          signalBadges += `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">▲ ${formatCompactPrice(item.targetPrice, item.currency)}</span>`;
        }
        if (item.stopPrice > 0) {
          signalBadges += `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono bg-rose-500/10 text-rose-300 border border-rose-500/25">▼ ${formatCompactPrice(item.stopPrice, item.currency)}</span>`;
        }
        if (item.earningsBadge) {
          signalBadges += `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">${escapeHtml(item.earningsBadge)}</span>`;
        }

        return `
          <tr
            class="holding-row cursor-pointer ${isSelected ? 'mw-row-selected' : ''}"
            data-port-idx="${item._portfolioIndex}"
            data-holding-idx="${item._holdingIndex}"
          >
            <!-- 1. Asset Ticker & Name -->
            <td>
              <div class="flex items-center gap-2 min-w-[138px]">
                <div class="mw-ticker-avatar ${dayPos ? 'up' : 'down'}">
                  ${escapeHtml(tickerShort)}
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-1">
                    <span class="font-mono font-extrabold text-xs text-white">${escapeHtml(item.symbol)}</span>
                    <span class="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">${escapeHtml(item.currency)}</span>
                    ${
                      isWatchlist
                        ? '<span class="text-[8px] font-mono px-1 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">WATCH</span>'
                        : ''
                    }
                  </div>
                  <p class="text-[10px] text-slate-400 truncate max-w-[125px]">
                    ${escapeHtml(item.name)}
                    ${state.viewAllPortfolios ? `<span class="text-cyan-400/80"> · ${escapeHtml(item._portfolioShortName)}</span>` : ''}
                  </p>
                </div>
              </div>
            </td>

            <!-- 2. Market Price & Intraday Range -->
            <td class="font-mono tabular-nums whitespace-nowrap">
              <div class="text-xs font-bold text-white">${formatMoney(item.price, item.currency)}</div>
              <div class="text-[10px] text-slate-400">
                L:${formatCompactPrice(item.dayLow ?? item.low, item.currency)} · H:${formatCompactPrice(item.dayHigh ?? item.high, item.currency)}
              </div>
            </td>

            <!-- 3. 24h Day Change -->
            <td class="font-mono tabular-nums whitespace-nowrap">
              <span class="${dayPos ? 'mw-badge-up' : 'mw-badge-down'}">
                ${formatSignedPct(item.changePct)}
              </span>
              <div class="text-[10px] mt-0.5 ${dayPos ? 'text-emerald-400/90' : 'text-rose-400/90'}">
                ${formatSignedMoney(item.change, item.currency)}
              </div>
            </td>

            <!-- 4. 14D Sparkline & SMA20 / RSI14 -->
            <td class="whitespace-nowrap">
              <div class="flex items-center gap-2">
                <canvas
                  id="spark-canvas-${renderIdx}"
                  width="76"
                  height="26"
                  class="w-[76px] h-[26px] shrink-0"
                ></canvas>
                <div class="font-mono text-[10px] leading-tight">
                  <div class="text-cyan-300">
                    SMA20 <span class="${(item.smaPct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatSignedPct(item.smaPct, 1)}</span>
                  </div>
                  <div class="${rsiStyle.textClass} font-semibold">
                    RSI14: ${Number(item.rsi14 ?? 50).toFixed(0)}
                  </div>
                </div>
              </div>
            </td>

            <!-- 5. Position Value & Shares / Weight -->
            <td class="font-mono tabular-nums whitespace-nowrap">
              ${
                isWatchlist
                  ? `<span class="text-[11px] text-slate-500">0 sh (Watch)</span>`
                  : `<div class="text-xs font-bold text-white">${formatMoney(item.marketValueNative, item.currency)}</div>
                     <div class="text-[10px] text-slate-400">
                       ${item.shares} sh @ ${formatCompactPrice(item.avgCost, item.currency)} · <span class="text-cyan-300">${item.allocationPct}%</span>
                     </div>`
              }
            </td>

            <!-- 6. Total Return (Unrealized P&L) -->
            <td class="font-mono tabular-nums whitespace-nowrap">
              ${
                isWatchlist
                  ? `<span class="text-[11px] text-slate-500">—</span>`
                  : `<div class="text-xs font-bold ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}">
                       ${formatSignedMoney(item.unrealizedPnlNative, item.currency, true)}
                     </div>
                     <div class="text-[10px] font-semibold ${pnlPos ? 'text-emerald-400/80' : 'text-rose-400/80'}">
                       ${formatSignedPct(item.unrealizedPnlPct)}
                     </div>`
              }
            </td>

            <!-- 7. Catalysts, Alerts & WebMemo -->
            <td class="min-w-[140px] max-w-[180px]">
              <div class="flex flex-wrap items-center gap-1">
                ${signalBadges || '<span class="text-[10px] font-mono text-slate-500">No Alert</span>'}
              </div>
              ${
                item.note
                  ? `<div class="mt-1 flex items-center gap-1 text-[11px] text-amber-200/90 truncate" title="${escapeHtml(item.note)}">
                       <i class="ph-fill ph-note text-amber-400 text-xs shrink-0"></i>
                       <span class="truncate">${escapeHtml(item.note)}</span>
                     </div>`
                  : ''
              }
            </td>

            <!-- 8. Actions -->
            <td class="text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <button
                  type="button"
                  class="mw-action-icon-btn preview-watch-btn"
                  data-port-idx="${item._portfolioIndex}"
                  data-holding-idx="${item._holdingIndex}"
                  title="Preview chart & WebMemo on Garmin Watch"
                >
                  <i class="ph-bold ph-watch text-xs"></i>
                </button>
                <button
                  type="button"
                  class="mw-action-icon-btn edit-holding-btn"
                  data-port-idx="${item._portfolioIndex}"
                  data-edit-idx="${item._holdingIndex}"
                  title="Edit holding, target/stop alerts, or WebMemo"
                >
                  <i class="ph-bold ph-sliders-horizontal text-xs"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    container.innerHTML = `
      <table class="mw-holdings-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Last Price</th>
            <th>24h Chg</th>
            <th>14D Trend &amp; Tech</th>
            <th>Position</th>
            <th>Total P&amp;L</th>
            <th>Signals &amp; Memo</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    // Draw 14-day sparklines on each row canvas
    filtered.forEach((item, renderIdx) => {
      const c = el(`spark-canvas-${renderIdx}`);
      if (c) {
        drawInlineSparkline(c, item.sparkline, Number(item.changePct || 0) >= 0);
      }
    });

    // Row click -> preview on Garmin Watch Detail screen
    container.querySelectorAll('.holding-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.edit-holding-btn')) return;
        state.activePortfolioIndex = Number(row.getAttribute('data-port-idx'));
        state.activeSymbolIndex = Number(row.getAttribute('data-holding-idx'));
        state.watchMode = 'detail';
        switchDockTab('preview');
        resetAutoSwipeCountdown();
        renderAll();
      });
    });

    // Edit button -> open Holding Modal
    container.querySelectorAll('.edit-holding-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        state.activePortfolioIndex = Number(btn.getAttribute('data-port-idx'));
        state.activeSymbolIndex = Number(btn.getAttribute('data-edit-idx'));
        const port = getActivePortfolio();
        if (port && port.items[state.activeSymbolIndex]) {
          openHoldingModal(port.items[state.activeSymbolIndex]);
        }
      });
    });
  }

  /* ==========================================================================
     RENDER 3: BOTTOM 3-COLUMN FINANCIAL INTELLIGENCE MODULES + DOCK LISTS
     ========================================================================== */
  function renderIntelligenceModulesAndDockLists() {
    const allHoldings = getAllHoldingsWithPortfolioContext();

    // 1. WebMemo & Thesis Notes Module
    const memoHoldings = allHoldings.filter(h => Boolean(h.note));
    if (el('memoModuleCount')) {
      el('memoModuleCount').textContent = `${memoHoldings.length} Notes`;
    }

    const memoHtml = (memoHoldings.length > 0 ? memoHoldings : allHoldings.slice(0, 5))
      .map(item => {
        const dayPos = Number(item.changePct || 0) >= 0;
        return `
          <div
            class="mw-intel-item cursor-pointer"
            data-intel-port="${item._portfolioIndex}"
            data-intel-idx="${item._holdingIndex}"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="font-mono font-extrabold text-xs text-white">${escapeHtml(item.symbol)}</span>
                <span class="text-[10px] text-slate-400 truncate max-w-[130px]">${escapeHtml(item._portfolioName)}</span>
              </div>
              <div class="flex items-center gap-1.5 font-mono text-[11px]">
                <span class="text-white font-semibold">${formatMoney(item.price, item.currency)}</span>
                <span class="${dayPos ? 'text-emerald-400' : 'text-rose-400'}">${formatSignedPct(item.changePct, 1)}</span>
              </div>
            </div>
            <p class="mt-1 text-xs ${item.note ? 'text-amber-200/95' : 'text-slate-500 italic'}">
              ${item.note ? `"${escapeHtml(item.note)}"` : 'Click to add an investment thesis WebMemo for your Garmin watch...'}
            </p>
            <div class="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>SMA20: ${formatSignedPct(item.smaPct, 1)} · RSI: ${Math.round(item.rsi14 ?? 50)}</span>
              <button
                type="button"
                class="text-cyan-400 hover:underline intel-edit-btn"
                data-intel-port="${item._portfolioIndex}"
                data-intel-idx="${item._holdingIndex}"
              >
                Edit Memo →
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    if (el('memoModuleList')) el('memoModuleList').innerHTML = memoHtml;
    if (el('dockMemoQuickList')) el('dockMemoQuickList').innerHTML = memoHtml;

    // 2. Earnings & Catalysts Calendar Module (e-dd/mm/yy)
    const earningsHoldings = allHoldings.filter(h => Boolean(h.earningsBadge));
    if (el('earningsModuleCount')) {
      el('earningsModuleCount').textContent = `${earningsHoldings.length} Tracked`;
    }
    if (el('dockEarningsCountReadout')) {
      el('dockEarningsCountReadout').textContent = `${earningsHoldings.length} Earnings`;
    }

    const earningsHtml =
      earningsHoldings.length > 0
        ? earningsHoldings
            .map(item => {
              const dayPos = Number(item.changePct || 0) >= 0;
              return `
                <div
                  class="mw-intel-item cursor-pointer flex items-center justify-between gap-3"
                  data-intel-port="${item._portfolioIndex}"
                  data-intel-idx="${item._holdingIndex}"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="px-2 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 font-mono text-[10px] font-bold text-cyan-300 shrink-0">
                      ${escapeHtml(item.earningsBadge)}
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="font-mono font-extrabold text-xs text-white">${escapeHtml(item.symbol)}</span>
                        <span class="text-[10px] text-slate-400 truncate">${escapeHtml(item.name)}</span>
                      </div>
                      <p class="text-[10px] font-mono text-slate-400 mt-0.5">
                        SMA20: ${formatCompactPrice(item.sma20, item.currency)} (${formatSignedPct(item.smaPct, 1)})
                      </p>
                    </div>
                  </div>
                  <div class="text-right font-mono shrink-0">
                    <div class="text-xs font-bold text-white">${formatMoney(item.price, item.currency)}</div>
                    <div class="text-[10px] ${dayPos ? 'text-emerald-400' : 'text-rose-400'}">${formatSignedPct(item.changePct)}</div>
                  </div>
                </div>
              `;
            })
            .join('')
        : `<div class="p-6 text-center text-xs text-slate-400">No upcoming equity earnings dates configured.</div>`;

    if (el('earningsModuleList')) el('earningsModuleList').innerHTML = earningsHtml;

    // 3. Active Price Alerts & RSI Signals Module
    const alertHoldings = allHoldings.filter(
      h =>
        h.targetPrice > 0 ||
        h.stopPrice > 0 ||
        (h.alert && h.alert.status !== 'NONE') ||
        Number(h.rsi14 || 50) <= 35 ||
        Number(h.rsi14 || 50) >= 68
    );

    if (el('alertsModuleCount')) {
      el('alertsModuleCount').textContent = `${alertHoldings.length} Signals`;
    }
    if (el('dockActiveAlertsReadout')) {
      el('dockActiveAlertsReadout').textContent = `${alertHoldings.length} Signals`;
    }

    const alertsHtml = (alertHoldings.length > 0 ? alertHoldings : allHoldings.slice(0, 5))
      .map(item => {
        let statusTag = '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">MONITORING</span>';
        if (item.alert?.status === 'TARGET_HIT') {
          statusTag = '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">▲ TARGET HIT</span>';
        } else if (item.alert?.status === 'STOP_BREACH') {
          statusTag = '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">▼ STOP BREACH</span>';
        } else if (Number(item.rsi14 || 50) >= 68) {
          statusTag = `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300">RSI ${Math.round(item.rsi14)} OVERBOUGHT</span>`;
        } else if (Number(item.rsi14 || 50) <= 35) {
          statusTag = `<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300">RSI ${Math.round(item.rsi14)} OVERSOLD</span>`;
        }

        return `
          <div
            class="mw-intel-item cursor-pointer"
            data-intel-port="${item._portfolioIndex}"
            data-intel-idx="${item._holdingIndex}"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="font-mono font-extrabold text-xs text-white">${escapeHtml(item.symbol)}</span>
                <span class="font-mono text-xs text-cyan-300">${formatMoney(item.price, item.currency)}</span>
              </div>
              ${statusTag}
            </div>
            <div class="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>▲ Target: <strong class="text-emerald-400">${item.targetPrice > 0 ? formatMoney(item.targetPrice, item.currency) : '—'}</strong></span>
              <span>▼ Stop: <strong class="text-rose-400">${item.stopPrice > 0 ? formatMoney(item.stopPrice, item.currency) : '—'}</strong></span>
              <button
                type="button"
                class="text-cyan-400 hover:underline intel-edit-btn"
                data-intel-port="${item._portfolioIndex}"
                data-intel-idx="${item._holdingIndex}"
              >
                Tune →
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    if (el('alertsModuleList')) el('alertsModuleList').innerHTML = alertsHtml;
    if (el('dockAlertsQuickList')) el('dockAlertsQuickList').innerHTML = alertsHtml;

    // Bind click listeners on intelligence cards
    document.querySelectorAll('[data-intel-port]').forEach(card => {
      card.addEventListener('click', e => {
        const pIdx = Number(card.getAttribute('data-intel-port'));
        const hIdx = Number(card.getAttribute('data-intel-idx'));
        state.activePortfolioIndex = pIdx;
        state.activeSymbolIndex = hIdx;

        if (e.target.closest('.intel-edit-btn')) {
          e.stopPropagation();
          const port = state.profile?.portfolios?.[pIdx];
          if (port && port.items[hIdx]) {
            openHoldingModal(port.items[hIdx]);
          }
          return;
        }

        state.watchMode = 'detail';
        switchDockTab('preview');
        renderAll();
      });
    });
  }

  /* ==========================================================================
     RENDER 4: GARMIN WATCH SETTINGS, LICENSE & ENDPOINT SUMMARY
     ========================================================================== */
  function renderWatchSettingsAndLicense() {
    const ws = state.watchSettings || {};
    const lic = state.license || {
      deviceId: ws.deviceId || 'V2-88VENU20',
      status: 'TRIAL',
      daysRemaining: 14,
      isExpired: false,
      ownerEmail: 'saharat.bun@icloud.com'
    };

    if (el('autoSwipeToggle')) el('autoSwipeToggle').checked = Boolean(ws.autoSwipeEnabled);
    if (el('autoSwipeSecInput')) el('autoSwipeSecInput').value = ws.autoSwipeSec || 5;
    if (el('alwaysOnToggle')) el('alwaysOnToggle').checked = Boolean(ws.alwaysOnDisplay);

    const sortOrder = String(ws.sortByPctOrder || 'ASC').toUpperCase();
    const sortMetric = String(ws.sortByPctMetric || 'DAY').toUpperCase();
    document.querySelectorAll('input[name="sortByPctOrder"]').forEach(r => {
      r.checked = r.value === sortOrder;
    });
    document.querySelectorAll('input[name="sortByPctMetric"]').forEach(r => {
      r.checked = r.value === sortMetric;
    });

    if (el('watchDeviceIdInput') && document.activeElement !== el('watchDeviceIdInput')) {
      el('watchDeviceIdInput').value = state.privacyMaskKeys
        ? maskSecretIdentifier(lic.deviceId || ws.deviceId)
        : lic.deviceId || ws.deviceId || 'V2-88VENU20';
    }

    // Dock Footer Telemetry Strip
    if (el('dockSyncKeyReadout')) {
      el('dockSyncKeyReadout').textContent = maskSecretIdentifier(state.syncKey);
    }
    if (el('dockWatchModeReadout')) {
      el('dockWatchModeReadout').textContent = ws.autoSwipeEnabled
        ? `Auto ${ws.autoSwipeSec || 5}s · ${sortOrder}`
        : `Manual · ${sortOrder}`;
    }

    // License Badges
    const badgeEl = el('licenseStatusBadge');
    const headerBadgeText = el('headerLicenseBadgeText');
    const statusTextEl = el('licenseStatusText');
    const daysTextEl = el('licenseDaysRemainingText');
    const barEl = el('licenseCountdownBar');

    if (lic.status === 'ACTIVE') {
      if (badgeEl) {
        badgeEl.textContent = 'PRO ACTIVE · UNLIMITED';
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
      }
      if (headerBadgeText) headerBadgeText.textContent = 'PRO ACTIVE';
      if (statusTextEl) statusTextEl.textContent = `Device ${maskSecretIdentifier(lic.deviceId)} is permanently unlocked.`;
      if (daysTextEl) daysTextEl.textContent = 'Lifetime Pro License';
      if (barEl) barEl.style.width = '100%';
    } else if (lic.isExpired || lic.status === 'EXPIRED') {
      if (badgeEl) {
        badgeEl.textContent = 'TRIAL EXPIRED';
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40';
      }
      if (headerBadgeText) headerBadgeText.textContent = 'TRIAL EXPIRED';
      if (statusTextEl) statusTextEl.textContent = `14-day free trial for ${maskSecretIdentifier(lic.deviceId)} has expired.`;
      if (daysTextEl) daysTextEl.textContent = '0 days remaining';
      if (barEl) barEl.style.width = '0%';
    } else {
      const rem = Number(lic.daysRemaining ?? 14);
      const pct = Math.max(8, Math.min(100, Math.round((rem / 14) * 100)));
      if (badgeEl) {
        badgeEl.textContent = `FREE TRIAL · ${rem}D LEFT`;
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
      }
      if (headerBadgeText) headerBadgeText.textContent = `TRIAL · ${rem}D`;
      if (statusTextEl) statusTextEl.textContent = `14-Day Free Trial active on ${maskSecretIdentifier(lic.deviceId)}.`;
      if (daysTextEl) daysTextEl.textContent = `${rem} days remaining`;
      if (barEl) barEl.style.width = `${pct}%`;
    }

    // Endpoint URL
    if (el('watchEndpointUrl')) {
      const displayKey = maskSecretIdentifier(state.syncKey);
      el('watchEndpointUrl').textContent = `${window.location.origin}/api/watch?key=${displayKey}`;
    }
  }

  function renderGarminVenu2Watch() {
    Sim.renderGarminVenu2Watch(state, {
      onSelectSymbol(pickedIdx) {
        state.activeSymbolIndex = pickedIdx;
        state.watchMode = 'detail';
        resetAutoSwipeCountdown();
        renderAll();
      }
    });
    updateWatchStatusBadges();

    // Apply Watch Metric Layer Checkboxes to Watch Preview elements
    const vis = state.watchMetricsVisibility;
    if (el('watchTogglePnlModeBtn')) {
      el('watchTogglePnlModeBtn').classList.toggle('hidden', !vis.dayPnl);
    }
    if (el('watchDetailPnl')) {
      el('watchDetailPnl').classList.toggle('hidden', !vis.totalReturn);
    }
    if (el('watchDetailAlertBadge')) {
      el('watchDetailAlertBadge').classList.toggle('hidden', !vis.alerts);
    }
    if (el('watchDetailMemo')) {
      el('watchDetailMemo').classList.toggle('hidden', !vis.memo);
    }
  }

  function applyWatchModelPreview() {
    Sim.applyWatchModelPreview(state);
    const found =
      (state.compatibleDevices || []).find(d => d.id === state.selectedWatchModel) || {
        id: state.selectedWatchModel || 'venu2',
        name: 'Garmin Watch',
        resolution: '416×416',
        displayType: 'AMOLED'
      };
    const resStr = formatDeviceRes(found.resolution);
    if (el('watchDeviceSpecsSubtitle')) {
      el('watchDeviceSpecsSubtitle').textContent = `${found.name} · ${resStr} ${found.displayType}`;
    }
    if (el('heroWatchModelBadge')) {
      el('heroWatchModelBadge').textContent = `${found.name} Ready`;
    }
    if (el('watchSpecResolution')) {
      el('watchSpecResolution').textContent = `${resStr} px`;
    }
    if (el('watchSpecDisplay')) {
      el('watchSpecDisplay').textContent = `Round ${found.displayType}`;
    }
    if (el('watchSpecTouch')) {
      el('watchSpecTouch').textContent = String(found.displayType).includes('MIP') ? '5-Button + Touch' : 'Touch + 2B/5B';
    }
    if (el('watchSpecMemory')) {
      el('watchSpecMemory').textContent = '< 64 KB CIQ';
    }
  }

  function switchDockTab(tabName) {
    state.activeDockTab = tabName;
    document.querySelectorAll('[data-dock-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-dock-tab') === tabName);
    });
    el('dockTabPreview')?.classList.toggle('hidden', tabName !== 'preview');
    el('dockTabAlerts')?.classList.toggle('hidden', tabName !== 'alerts');
    el('dockTabMemo')?.classList.toggle('hidden', tabName !== 'memo');
    el('dockTabDevice')?.classList.toggle('hidden', tabName !== 'device');
  }

  function renderAll() {
    renderHeaderAndKpiRow();
    renderPortfolioTabsAndRibbon();
    renderHoldingsTable();
    renderIntelligenceModulesAndDockLists();
    renderWatchSettingsAndLicense();
    renderGarminVenu2Watch();
  }

  /* ==========================================================================
     MODALS & EVENT HANDLERS
     ========================================================================== */
  function openHoldingModal(existingItem = null) {
    const modal = el('holdingModal');
    const delBtn = el('deleteHoldingBtn');
    if (!modal) return;

    if (existingItem) {
      el('holdingModalTitle').textContent = `Edit ${existingItem.symbol} & WebMemo`;
      if (el('holdingEditOriginalSymbol')) el('holdingEditOriginalSymbol').value = existingItem.symbol;
      el('holdingSymbolInput').value = existingItem.symbol;
      el('holdingNameInput').value = existingItem.name || '';
      if (el('holdingCurrencySelect')) el('holdingCurrencySelect').value = existingItem.currency || 'USD';
      el('holdingSharesInput').value = existingItem.shares ?? 0;
      el('holdingAvgCostInput').value = existingItem.avgCost ?? 0;
      el('holdingTargetInput').value = existingItem.targetPrice || '';
      el('holdingStopInput').value = existingItem.stopPrice || '';
      if (el('holdingEarningsDateInput')) el('holdingEarningsDateInput').value = existingItem.earningsDate || '';
      if (el('holdingNoteInput')) el('holdingNoteInput').value = existingItem.note || '';
      delBtn?.classList.remove('hidden');
    } else {
      el('holdingModalTitle').textContent = 'Add New Asset to Portfolio';
      if (el('holdingEditOriginalSymbol')) el('holdingEditOriginalSymbol').value = '';
      el('holdingSymbolInput').value = '';
      el('holdingNameInput').value = '';
      if (el('holdingCurrencySelect')) {
        el('holdingCurrencySelect').value = state.activePortfolioIndex === 1 ? 'THB' : 'USD';
      }
      el('holdingSharesInput').value = 10;
      el('holdingAvgCostInput').value = 0;
      el('holdingTargetInput').value = '';
      el('holdingStopInput').value = '';
      if (el('holdingEarningsDateInput')) el('holdingEarningsDateInput').value = '';
      if (el('holdingNoteInput')) el('holdingNoteInput').value = '';
      delBtn?.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    el('holdingSymbolInput')?.focus();
  }

  function closeHoldingModal() {
    const modal = el('holdingModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async function openSyncPayloadModal() {
    const modal = el('syncModal');
    if (!modal) return;
    if (el('syncKeyInput')) el('syncKeyInput').value = state.syncKey;
    const didParam = state.watchSettings.deviceId ? `&did=${encodeURIComponent(state.watchSettings.deviceId)}` : '';
    if (el('modalWatchEndpointLabel')) {
      el('modalWatchEndpointLabel').textContent = `/api/watch?key=${maskSecretIdentifier(state.syncKey)}`;
    }
    if (el('personalProfileUrlLabel')) {
      el('personalProfileUrlLabel').textContent = `${window.location.origin}/?key=${maskSecretIdentifier(state.syncKey)}`;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
      const res = await fetch(`/api/watch?key=${encodeURIComponent(state.syncKey)}${didParam}`);
      const data = await res.json();
      const formatted = JSON.stringify(data, null, 2);
      if (el('watchJsonPreview')) el('watchJsonPreview').textContent = formatted;
      if (el('payloadByteSizeLabel')) {
        el('payloadByteSizeLabel').textContent = `${new Blob([JSON.stringify(data)]).size.toLocaleString()} bytes (Garmin CIQ Ready)`;
      }
    } catch (_) {
      // Ignore preview error
    }
  }

  function bindEvents() {
    // 1. Top Navigation Bar Smooth Scroll & Section Switching
    document.querySelectorAll('.mw-nav-btn[data-nav-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mw-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-nav-target');
        const targetEl = el(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    // 2. Global Search Input
    const searchInput = el('globalSearchInput');
    const clearSearchBtn = el('clearGlobalSearchBtn');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.globalSearchQuery = searchInput.value;
        clearSearchBtn?.classList.toggle('hidden', !state.globalSearchQuery);
        renderHoldingsTable();
      });
    }
    clearSearchBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.globalSearchQuery = '';
      clearSearchBtn.classList.add('hidden');
      renderHoldingsTable();
    });

    // Keyboard shortcut '/' to focus search
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
        e.preventDefault();
        searchInput?.focus();
      }
    });

    // 3. Privacy Mask Toggles (Balances & Sync Keys)
    el('togglePrivacyBtn')?.addEventListener('click', () => {
      state.privacyMaskBalances = !state.privacyMaskBalances;
      localStorage.setItem('mw_privacy_balances', state.privacyMaskBalances ? '1' : '0');
      renderAll();
      showToast(state.privacyMaskBalances ? 'Monetary balances masked' : 'Monetary balances visible');
    });

    el('toggleKeyMaskBtn')?.addEventListener('click', () => {
      state.privacyMaskKeys = !state.privacyMaskKeys;
      localStorage.setItem('mw_privacy_keys', state.privacyMaskKeys ? '1' : '0');
      renderAll();
      showToast(state.privacyMaskKeys ? 'Sync Key & Device ID masked' : 'Sync Key & Device ID revealed');
    });

    // 4. Base Currency Select
    el('baseCurrencySelect')?.addEventListener('change', async e => {
      const nextCur = e.target.value === 'USD' ? 'USD' : 'THB';
      if (!state.profile || state.profile.baseCurrency === nextCur) return;
      state.profile.baseCurrency = nextCur;
      await savePortfolioState(`Base currency switched to ${nextCur}`);
    });

    // 5. Refresh Live Quotes Button
    el('refreshLiveBtn')?.addEventListener('click', async () => {
      const icon = el('refreshSpinIcon');
      icon?.classList.add('animate-spin');
      try {
        const res = await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncKey: state.syncKey })
        });
        if (res.ok) {
          const raw = await res.json();
          state.profile = normalizeServerPayload(raw);
          state.watchSettings = { ...state.profile.watchSettings };
          state.license = state.profile.license;
          applyClientSideSort();
          renderAll();
          showToast('Live Yahoo Finance quotes & Fear/Greed refreshed');
        }
      } finally {
        setTimeout(() => icon?.classList.remove('animate-spin'), 450);
      }
    });

    // Header Alert Bell & License Badge Shortcuts
    el('headerAlertBellBtn')?.addEventListener('click', () => {
      el('section-intelligence-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    el('headerLicenseBadge')?.addEventListener('click', () => {
      switchDockTab('device');
      el('section-garmin-dock')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // 6. Portfolio Tabs, All Portfolios Toggle, Filter Pills & Sort Dropdown
    el('viewAllPortfoliosBtn')?.addEventListener('click', () => {
      state.viewAllPortfolios = true;
      renderAll();
    });

    el('toggleTableExpandBtn')?.addEventListener('click', () => {
      const box = el('holdingsListContainer');
      const btn = el('toggleTableExpandBtn');
      if (!box || !btn) return;
      const expanded = box.classList.toggle('expanded');
      btn.textContent = expanded ? 'Compact Scroll' : 'Expand All Rows';
    });

    document.querySelectorAll('#holdingsFilterPills [data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.holdingsFilter = btn.getAttribute('data-filter') || 'ALL';
        renderPortfolioTabsAndRibbon();
        renderHoldingsTable();
      });
    });

    el('sortHoldingsSelect')?.addEventListener('change', async e => {
      const nextOrder = e.target.value || 'ASC';
      state.watchSettings.sortByPctOrder = nextOrder;
      applyClientSideSort();
      renderAll();
      if (['ASC', 'DESC', 'NONE'].includes(nextOrder)) {
        await savePortfolioState(`Sorted holdings: ${nextOrder}`);
      }
    });

    // 7. Portfolio Create / Rename / Delete
    el('openAddPortfolioModalBtn')?.addEventListener('click', () => {
      const modal = el('portfolioModal');
      if (!modal) return;
      el('portfolioModalTitle').textContent = 'Create New Portfolio';
      el('portfolioEditMode').value = 'create';
      el('portfolioNameInput').value = '';
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      el('portfolioNameInput').focus();
    });

    el('renamePortfolioBtn')?.addEventListener('click', () => {
      const active = getActivePortfolio();
      const modal = el('portfolioModal');
      if (!active || !modal) return;
      el('portfolioModalTitle').textContent = 'Rename Portfolio';
      el('portfolioEditMode').value = 'rename';
      el('portfolioNameInput').value = active.name;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      el('portfolioNameInput').focus();
    });

    el('closePortfolioModalBtn')?.addEventListener('click', () => {
      el('portfolioModal')?.classList.add('hidden');
      el('portfolioModal')?.classList.remove('flex');
    });

    el('portfolioForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const name = (el('portfolioNameInput')?.value || '').trim();
      if (!name) return;
      const mode = el('portfolioEditMode')?.value || 'create';

      if (mode === 'rename') {
        const active = getActivePortfolio();
        if (active) {
          active.name = name;
          active.shortName = name.slice(0, 12).toUpperCase();
        }
      } else {
        state.profile.portfolios.push({
          id: `port-${Date.now()}`,
          name,
          shortName: name.slice(0, 12).toUpperCase(),
          currency: 'USD',
          items: []
        });
        state.viewAllPortfolios = false;
        state.activePortfolioIndex = state.profile.portfolios.length - 1;
      }

      el('portfolioModal')?.classList.add('hidden');
      el('portfolioModal')?.classList.remove('flex');
      await savePortfolioState(mode === 'rename' ? 'Portfolio renamed' : `Created portfolio "${name}"`);
    });

    el('deletePortfolioBtn')?.addEventListener('click', async () => {
      if ((state.profile?.portfolios?.length || 0) <= 1) {
        showToast('At least 1 portfolio must remain');
        return;
      }
      const active = getActivePortfolio();
      if (!active || !window.confirm(`Delete portfolio "${active.name}"?`)) return;
      state.profile.portfolios.splice(state.activePortfolioIndex, 1);
      state.activePortfolioIndex = 0;
      await savePortfolioState(`Deleted portfolio "${active.name}"`);
    });

    // 8. Holding Modal CRUD
    el('openAddHoldingModalBtn')?.addEventListener('click', () => openHoldingModal(null));
    el('heroQuickAddBtn')?.addEventListener('click', () => openHoldingModal(null));
    el('closeHoldingModalBtn')?.addEventListener('click', closeHoldingModal);
    el('cancelHoldingModalBtn')?.addEventListener('click', closeHoldingModal);

    el('holdingSymbolInput')?.addEventListener('input', e => {
      const val = e.target.value.toUpperCase();
      if (val.endsWith('.BK') && el('holdingCurrencySelect')) {
        el('holdingCurrencySelect').value = 'THB';
      }
    });

    el('holdingForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const active = getActivePortfolio();
      if (!active) return;

      const origSym = (el('holdingEditOriginalSymbol')?.value || '').trim().toUpperCase();
      const sym = (el('holdingSymbolInput')?.value || '').trim().toUpperCase();
      if (!sym) return;

      const newItem = {
        symbol: sym,
        name: (el('holdingNameInput')?.value || '').trim(),
        currency: el('holdingCurrencySelect')?.value || 'USD',
        shares: Number(el('holdingSharesInput')?.value || 0),
        avgCost: Number(el('holdingAvgCostInput')?.value || 0),
        targetPrice: Number(el('holdingTargetInput')?.value || 0),
        stopPrice: Number(el('holdingStopInput')?.value || 0),
        earningsDate: (el('holdingEarningsDateInput')?.value || '').trim().replace(/^e-/i, ''),
        note: (el('holdingNoteInput')?.value || '').trim()
      };

      if (origSym) {
        const idx = active.items.findIndex(x => x.symbol.toUpperCase() === origSym);
        if (idx >= 0) active.items[idx] = newItem;
        else active.items.push(newItem);
      } else {
        const existingIdx = active.items.findIndex(x => x.symbol.toUpperCase() === sym);
        if (existingIdx >= 0) active.items[existingIdx] = newItem;
        else active.items.push(newItem);
      }

      closeHoldingModal();
      await savePortfolioState(`Saved ${sym} & synced to Garmin Watch`);
    });

    el('deleteHoldingBtn')?.addEventListener('click', async () => {
      const active = getActivePortfolio();
      const origSym = (el('holdingEditOriginalSymbol')?.value || '').trim().toUpperCase();
      if (!active || !origSym) return;
      active.items = active.items.filter(x => x.symbol.toUpperCase() !== origSym);
      state.activeSymbolIndex = 0;
      closeHoldingModal();
      await savePortfolioState(`Removed ${origSym} from portfolio`);
    });

    // 9. Garmin Dock Internal Tabs & Watch Metric Layer Checkboxes
    document.querySelectorAll('[data-dock-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchDockTab(btn.getAttribute('data-dock-tab') || 'preview');
      });
    });

    document.querySelectorAll('[data-open-dock-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchDockTab(btn.getAttribute('data-open-dock-tab') || 'device');
      });
    });

    const bindMetricCheck = (id, key) => {
      el(id)?.addEventListener('change', e => {
        state.watchMetricsVisibility[key] = Boolean(e.target.checked);
        renderGarminVenu2Watch();
      });
    };
    bindMetricCheck('watchMetricDayPnl', 'dayPnl');
    bindMetricCheck('watchMetricTotalReturn', 'totalReturn');
    bindMetricCheck('watchMetricAlerts', 'alerts');
    bindMetricCheck('watchMetricMemo', 'memo');

    // 10. Garmin Watch Interactive Screen & Pushers
    document.querySelectorAll('.watch-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.watchMode = btn.getAttribute('data-watch-mode') || 'list';
        resetAutoSwipeCountdown();
        renderGarminVenu2Watch();
      });
    });

    el('glanceLaunchBtn')?.addEventListener('click', () => {
      state.watchMode = 'list';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchPrevPortBtn')?.addEventListener('click', () => {
      const len = state.profile?.portfolios?.length || 1;
      state.activePortfolioIndex = (state.activePortfolioIndex - 1 + len) % len;
      state.activeSymbolIndex = 0;
      resetAutoSwipeCountdown();
      renderAll();
    });

    el('watchNextPortBtn')?.addEventListener('click', () => {
      const len = state.profile?.portfolios?.length || 1;
      state.activePortfolioIndex = (state.activePortfolioIndex + 1) % len;
      state.activeSymbolIndex = 0;
      resetAutoSwipeCountdown();
      renderAll();
    });

    el('watchTogglePnlModeBtn')?.addEventListener('click', () => {
      state.watchPnlMode = state.watchPnlMode === 'day' ? 'total' : 'day';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchBadgeSortOrder')?.addEventListener('click', async () => {
      const cur = String(state.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
      const nextOrder = cur === 'ASC' ? 'DESC' : 'ASC';
      state.watchSettings.sortByPctOrder = nextOrder;
      applyClientSideSort();
      resetAutoSwipeCountdown();
      renderAll();
      await savePortfolioState(`Sort order switched to ${nextOrder === 'ASC' ? 'Loss → Gain' : 'Gain → Loss'}`);
    });

    el('watchBackToListBtn')?.addEventListener('click', () => {
      state.watchMode = 'list';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchToggleBbBtn')?.addEventListener('click', () => {
      state.watchShowBb = !state.watchShowBb;
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('venuBtnTop')?.addEventListener('click', () => {
      if (state.watchMode === 'glance') state.watchMode = 'list';
      else if (state.watchMode === 'list') state.watchPnlMode = state.watchPnlMode === 'day' ? 'total' : 'day';
      else if (state.watchMode === 'detail') state.watchShowBb = !state.watchShowBb;
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('venuBtnBottom')?.addEventListener('click', () => {
      if (state.watchMode === 'detail') state.watchMode = 'list';
      else if (state.watchMode === 'list') state.watchMode = 'glance';
      else state.watchMode = 'list';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    // 11. Watch Display Settings & Device License Activation
    el('saveWatchSettingsBtn')?.addEventListener('click', async () => {
      state.watchSettings.autoSwipeEnabled = Boolean(el('autoSwipeToggle')?.checked);
      state.watchSettings.autoSwipeSec = Math.max(2, Math.min(120, Number(el('autoSwipeSecInput')?.value || 5)));
      state.watchSettings.alwaysOnDisplay = Boolean(el('alwaysOnToggle')?.checked);

      const pickedOrder = document.querySelector('input[name="sortByPctOrder"]:checked')?.value || 'ASC';
      const pickedMetric = document.querySelector('input[name="sortByPctMetric"]:checked')?.value || 'DAY';
      state.watchSettings.sortByPctOrder = pickedOrder;
      state.watchSettings.sortByPctMetric = pickedMetric;

      await savePortfolioState('Garmin Watch display & sort settings synced');
    });

    el('copyDeviceIdBtn')?.addEventListener('click', async () => {
      const rawDid = state.license?.deviceId || state.watchSettings?.deviceId || 'V2-88VENU20';
      await navigator.clipboard.writeText(rawDid);
      showToast(`Copied Garmin Device ID: ${rawDid}`);
    });

    el('activateDeviceBtn')?.addEventListener('click', async () => {
      const rawDid = state.license?.deviceId || state.watchSettings?.deviceId || 'V2-88VENU20';
      const actKey = (el('activationKeyInput')?.value || '').trim().toUpperCase();
      if (!actKey) {
        showToast('Enter an Activation Key (MOAT-XXXX-XXXX-XXXX)');
        return;
      }
      const res = await fetch('/api/device/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncKey: state.syncKey,
          deviceId: rawDid,
          activationKey: actKey
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error || 'Invalid Activation Key');
        return;
      }
      if (data.payload) {
        state.profile = normalizeServerPayload(data.payload);
        state.watchSettings = { ...state.profile.watchSettings };
        state.license = state.profile.license;
        renderAll();
      }
      showToast(data.message || `Device ${rawDid} unlocked!`);
    });

    // 12. License Request Modal (Trial Extend & Pro Purchase)
    const openLicenseReq = reqType => {
      const modal = el('licenseRequestModal');
      if (!modal) return;
      const rawDid = state.license?.deviceId || state.watchSettings?.deviceId || 'V2-88VENU20';
      if (el('requestTypeInput')) el('requestTypeInput').value = reqType;
      if (el('requestDeviceIdInput')) el('requestDeviceIdInput').value = rawDid;
      if (el('requestSyncKeyInput')) el('requestSyncKeyInput').value = state.syncKey;
      el('licenseRequestFeedbackBox')?.classList.add('hidden');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    };

    el('openTrialExtendModalBtn')?.addEventListener('click', () => openLicenseReq('TRIAL_EXTEND'));
    el('openPurchaseFormModalBtn')?.addEventListener('click', () => openLicenseReq('PURCHASE_LICENSE'));
    el('watchExpiredOpenRequestBtn')?.addEventListener('click', () => openLicenseReq('PURCHASE_LICENSE'));
    el('closeLicenseRequestModalBtn')?.addEventListener('click', () => {
      el('licenseRequestModal')?.classList.add('hidden');
      el('licenseRequestModal')?.classList.remove('flex');
    });
    el('cancelLicenseRequestModalBtn')?.addEventListener('click', () => {
      el('licenseRequestModal')?.classList.add('hidden');
      el('licenseRequestModal')?.classList.remove('flex');
    });

    el('licenseRequestForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const requestType = el('requestTypeInput')?.value || 'TRIAL_EXTEND';
      const deviceId = state.license?.deviceId || state.watchSettings?.deviceId || 'V2-88VENU20';
      const requestedExtendDays = Number(el('requestExtendDaysSelect')?.value || 14);
      const contactName = (el('requestContactNameInput')?.value || '').trim();
      const contactEmail = (el('requestContactEmailInput')?.value || '').trim();
      const contactPhone = (el('requestContactPhoneInput')?.value || '').trim();
      const message = (el('requestMessageInput')?.value || '').trim();
      const fb = el('licenseRequestFeedbackBox');

      const res = await fetch('/api/license/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType,
          deviceId,
          syncKey: state.syncKey,
          requestedExtendDays,
          contactName,
          contactEmail,
          contactPhone,
          message
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (fb) {
          fb.textContent = data.error || 'Failed to submit request';
          fb.className = 'p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-300 text-xs';
        }
        return;
      }
      if (fb) {
        fb.textContent = data.message || 'Request submitted to Admin!';
        fb.className = 'p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-xs';
      }
      showToast('License request sent to MoatWatch Admin');
    });

    // 13. Sync Key Modal & Utilities
    el('openSyncModalBtn')?.addEventListener('click', openSyncPayloadModal);
    el('inspectPayloadBtn')?.addEventListener('click', openSyncPayloadModal);
    el('closeSyncModalBtn')?.addEventListener('click', () => {
      el('syncModal')?.classList.add('hidden');
      el('syncModal')?.classList.remove('flex');
    });

    el('applySyncKeyBtn')?.addEventListener('click', async () => {
      const nextKey = (el('syncKeyInput')?.value || '').trim().toUpperCase();
      if (!nextKey) return;
      await loadPortfolio(nextKey);
      el('syncModal')?.classList.add('hidden');
      el('syncModal')?.classList.remove('flex');
      showToast(`Switched to profile: ${nextKey}`);
    });

    el('createNewSyncKeyBtn')?.addEventListener('click', async () => {
      const freshKey = generateRandomSyncKey();
      if (el('syncKeyInput')) el('syncKeyInput').value = freshKey;
      await loadPortfolio(freshKey);
      showToast(`Created isolated profile: ${freshKey}`);
    });

    el('copyProfileUrlBtn')?.addEventListener('click', async () => {
      const url = `${window.location.origin}/?key=${encodeURIComponent(state.syncKey)}`;
      await navigator.clipboard.writeText(url);
      showToast('Copied personal portfolio URL');
    });

    el('copyEndpointBtn')?.addEventListener('click', async () => {
      const url = `${window.location.origin}/api/watch?key=${encodeURIComponent(state.syncKey)}`;
      await navigator.clipboard.writeText(url);
      showToast('Copied Garmin Connect IQ Watch Endpoint URL');
    });

    // 14. Export JSON / CSV & Import JSON
    el('exportJsonBtn')?.addEventListener('click', () => {
      if (!state.profile) return;
      const blob = new Blob([JSON.stringify(state.profile, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `moatwatch-${state.syncKey.toLowerCase()}.json`;
      a.click();
      showToast('Exported JSON portfolio backup');
    });

    el('exportCsvBtn')?.addEventListener('click', () => {
      if (!state.profile) return;
      const rows = [['Portfolio', 'Symbol', 'Name', 'Currency', 'Shares', 'AvgCost', 'CurrentPrice', 'TargetPrice', 'StopPrice', 'Earnings', 'WebMemo']];
      for (const p of state.profile.portfolios || []) {
        for (const it of p.items || []) {
          rows.push([
            `"${(p.name || '').replace(/"/g, '""')}"`,
            it.symbol,
            `"${(it.name || '').replace(/"/g, '""')}"`,
            it.currency,
            it.shares,
            it.avgCost,
            it.price,
            it.targetPrice,
            it.stopPrice,
            it.earningsBadge || '',
            `"${(it.note || '').replace(/"/g, '""')}"`
          ]);
        }
      }
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `moatwatch-${state.syncKey.toLowerCase()}.csv`;
      a.click();
      showToast('Exported CSV holdings table');
    });

    el('importJsonInput')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedPortfolios = parsed.portfolios || parsed.web?.portfolios;
        if (!Array.isArray(importedPortfolios)) {
          throw new Error('Invalid JSON backup file');
        }
        state.profile = normalizeServerPayload(parsed);
        await savePortfolioState('Imported portfolio backup');
      } catch (err) {
        showToast(err.message || 'Failed to import JSON');
      }
    });

    // 15. Garmin Watch Model Selector (20 Compatible 2024–2026 Models)
    el('watchModelSelect')?.addEventListener('change', e => {
      state.selectedWatchModel = e.target.value || 'venu2';
      localStorage.setItem('garmin_watch_model', state.selectedWatchModel);
      applyWatchModelPreview();
    });
  }

  async function loadCompatibleGarminDevices() {
    try {
      const res = await fetch('/api/devices/compatible');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.devices) && data.devices.length > 0) {
        state.compatibleDevices = data.devices;
        const selectEl = el('watchModelSelect');
        if (selectEl) {
          selectEl.innerHTML = data.devices
            .map(
              d =>
                `<option value="${escapeHtml(d.id)}" ${d.id === state.selectedWatchModel ? 'selected' : ''} class="bg-slate-900">${escapeHtml(d.name)} (${escapeHtml(formatDeviceRes(d.resolution))})</option>`
            )
            .join('');
        }
        applyWatchModelPreview();
      }
    } catch (_) {
      applyWatchModelPreview();
    }
  }

  function startAutoQuoteRefreshTimer() {
    if (state.quoteRefreshIntervalId) clearInterval(state.quoteRefreshIntervalId);
    state.quoteRefreshIntervalId = setInterval(async () => {
      if (document.hidden) return;
      const modalOpen =
        !el('holdingModal')?.classList.contains('hidden') || !el('portfolioModal')?.classList.contains('hidden');
      if (modalOpen) return;
      try {
        await loadPortfolio(state.syncKey);
      } catch (_) {
        // Ignore background refresh error
      }
    }, 60_000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await loadCompatibleGarminDevices();
    await loadPortfolio(state.syncKey);
    startAutoQuoteRefreshTimer();
  });
})();
