/* Venu2Moat — Frontend Portfolio Manager, Auto-Swipe Engine, Always-On & License Companion */

(() => {
  const state = {
    syncKey: localStorage.getItem('venu2_sync_key') || 'VENU2-88',
    selectedWatchModel: localStorage.getItem('venu2_watch_model') || 'venu2',
    compatibleDevices: [],
    profile: null,
    activePortfolioIndex: 0,
    activeSymbolIndex: 0,
    watchScrollOffset: 0,
    watchMode: 'list', // 'glance' | 'list' | 'detail'
    watchPnlMode: 'day', // 'day' | 'total'
    watchShowBb: true,
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: false,
      sortByPctOrder: 'ASC', // 'ASC' (ติดลบ -> กำไร) | 'DESC' (กำไร -> ติดลบ) | 'NONE' (ปกติ)
      sortByPctMetric: 'DAY', // 'DAY' (% Change วันนี้) | 'TOTAL' (% กำไรรวม)
      deviceId: 'V2-88VENU20',
      activationKey: ''
    },
    license: null,
    autoSwipeRemainingSec: 5,
    autoSwipeIntervalId: null,
    quoteRefreshIntervalId: null,
    menuOpen: false,
    searchTimer: null
  };

  const el = id => document.getElementById(id);

  function formatMoney(amount, currency = 'THB', compact = false) {
    const val = Number(amount || 0);
    const sym = currency === 'USD' ? '$' : '฿';
    const abs = Math.abs(val);
    if (compact && abs >= 1_000_000) {
      return `${val < 0 ? '-' : ''}${sym}${(abs / 1_000_000).toFixed(2)}M`;
    }
    const decimals = compact && abs >= 1000 ? 0 : 2;
    return `${val < 0 ? '-' : ''}${sym}${abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}`;
  }

  function formatSignedMoney(amount, currency = 'THB', compact = false) {
    const val = Number(amount || 0);
    const sign = val > 0 ? '+' : '';
    return `${sign}${formatMoney(val, currency, compact)}`;
  }

  function formatSignedPct(pct, decimals = 2) {
    const val = Number(pct || 0);
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(decimals)}%`;
  }

  function formatCompactPrice(amount, currency = 'USD') {
    const val = Number(amount || 0);
    const sym = currency === 'USD' ? '$' : '฿';
    const abs = Math.abs(val);
    const decimals = abs >= 100 ? 0 : abs < 10 && abs > 0 ? 2 : 1;
    return `${val < 0 ? '-' : ''}${sym}${abs.toFixed(decimals)}`;
  }

  function getRsiZoneStyle(rsiVal) {
    const r = Number(rsiVal ?? 50);
    if (r <= 30) {
      return {
        textClass: 'text-emerald',
        badgeClass: 'bg-emerald/15 text-emerald ring-1 ring-emerald/30',
        zoneLabel: 'Oversold <=30'
      };
    }
    if (r >= 70) {
      return {
        textClass: 'text-crimson',
        badgeClass: 'bg-crimson/15 text-crimson ring-1 ring-crimson/30',
        zoneLabel: 'Overbought >=70'
      };
    }
    return {
      textClass: 'text-purple-400',
      badgeClass: 'bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30',
      zoneLabel: 'Neutral 31-69'
    };
  }

  function showToast(msg) {
    const banner = el('toastBanner');
    const text = el('toastMessage');
    if (!banner || !text) return;
    text.textContent = msg;
    banner.classList.remove('translate-y-20', 'opacity-0');
    banner.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      banner.classList.add('translate-y-20', 'opacity-0');
      banner.classList.remove('translate-y-0', 'opacity-100');
    }, 3000);
  }

  /**
   * Normalizes server payload ({ web, watch }) into the unified UI profile model
   */
  function normalizeServerPayload(raw) {
    const web = raw?.web || raw || {};
    const totals = web.totals || web.summary || {};
    const rawPortfolios = web.portfolios || [];

    let totalHoldings = 0;
    let totalAlerts = 0;

    const normalizedPortfolios = rawPortfolios.map(p => {
      const pSum = p.summary || {};
      const rawHoldings = p.holdings || p.items || [];
      const pVal = Number(pSum.marketValueBase ?? p.totalValueBase ?? 0);

      const items = rawHoldings.map((h, hIdx) => {
        const spark = Array.isArray(h.sparkline) && h.sparkline.length > 0 ? h.sparkline : [h.prevClose || 100, h.price || 100];
        const minSpark = Math.min(...spark);
        const maxSpark = Math.max(...spark);
        const alloc = pVal > 0 ? Number(((Number(h.marketValueBase || 0) / pVal) * 100).toFixed(1)) : 0;

        let alertStatus = 'NONE';
        let distancePct = 0;
        if (h.alertTriggered) {
          alertStatus = h.alertDir === 'BELOW' ? 'STOP_BREACH' : 'TARGET_HIT';
        } else if (h.targetPrice > 0 && h.price > 0) {
          const dist = Math.abs((h.targetPrice - h.price) / h.price) * 100;
          if (dist <= 5) {
            alertStatus = 'NEAR_TARGET';
            distancePct = Number(dist.toFixed(1));
          }
        }
        if (alertStatus === 'TARGET_HIT' || alertStatus === 'STOP_BREACH') {
          totalAlerts++;
        }

        const smaSeries = spark.map(() => Number(h.sma20 || h.price || 100));
        const bbUpperSeries = spark.map(() => Number(h.upperBB || (h.price || 100) * 1.03));
        const bbLowerSeries = spark.map(() => Number(h.lowerBB || (h.price || 100) * 0.97));

        const dayLowVal = Number((h.dayLow ?? Math.min(h.price || minSpark, h.prevClose || minSpark)).toFixed(2));
        const dayHighVal = Number((h.dayHigh ?? Math.max(h.price || maxSpark, h.prevClose || maxSpark)).toFixed(2));
        const priceVal = Number(h.price ?? 0);
        const sma20Val = Number((h.sma20 ?? priceVal ?? 100).toFixed(2));
        const smaPctVal = Number(
          (
            h.smaPct !== undefined
              ? Number(h.smaPct)
              : sma20Val > 0
              ? ((priceVal - sma20Val) / sma20Val) * 100
              : 0
          ).toFixed(2)
        );
        const rsi14Val = Number(Number(h.rsi14 ?? h.rsi ?? 50).toFixed(1));
        const rawEd = String(h.earningsDate || h.earningsBadge || h.ed || '')
          .trim()
          .replace(/^e-/i, '')
          .trim();
        const earningsBadge = rawEd ? `e-${rawEd}` : '';

        return {
          origIdx: h.origIdx !== undefined ? Number(h.origIdx) : hIdx,
          symbol: h.symbol,
          name: h.name || h.symbol,
          currency: h.currency || p.currency || 'USD',
          shares: Number(h.shares ?? 0),
          avgCost: Number(h.avgCost ?? 0),
          price: priceVal,
          prevClose: Number(h.prevClose ?? h.price ?? 0),
          change: Number(h.change ?? 0),
          changePct: Number(h.changePct ?? 0),
          dayLow: dayLowVal,
          dayHigh: dayHighVal,
          low: dayLowVal,
          high: dayHighVal,
          marketValueNative: Number(h.marketValue ?? (h.shares || 0) * (h.price || 0)),
          marketValueBase: Number(h.marketValueBase ?? 0),
          unrealizedPnlNative: Number(h.totalPnl ?? 0),
          unrealizedPnlPct: Number(h.totalPnlPct ?? 0),
          allocationPct: alloc,
          targetPrice: Number(h.targetPrice ?? 0),
          stopPrice: h.alertDir === 'BELOW' ? Number(h.targetPrice ?? 0) : Number(h.stopPrice ?? 0),
          alertDir: h.alertDir || 'ABOVE',
          earningsDate: rawEd,
          earningsBadge,
          note: h.memo !== undefined ? h.memo : h.note || '',
          memo: h.memo !== undefined ? h.memo : h.note || '',
          sparkline: spark,
          sma20: sma20Val,
          smaPct: smaPctVal,
          rsi14: rsi14Val,
          upperBB: h.upperBB,
          lowerBB: h.lowerBB,
          smaSeries,
          bbUpperSeries,
          bbLowerSeries,
          alert: {
            status: alertStatus,
            distancePct
          }
        };
      });

      totalHoldings += items.length;

      return {
        id: p.id,
        name: p.name,
        shortName: (p.shortName || p.name || 'PORT').slice(0, 12).toUpperCase(),
        currency: p.currency || 'USD',
        totalValueBase: Number(pSum.marketValueBase ?? p.totalValueBase ?? 0),
        dayPnlBase: Number(pSum.dayPnlBase ?? p.dayPnlBase ?? 0),
        dayPnlPct: Number(pSum.dayPnlPct ?? p.dayPnlPct ?? 0),
        unrealizedPnlBase: Number(pSum.totalPnlBase ?? p.unrealizedPnlBase ?? 0),
        unrealizedPnlPct: Number(pSum.totalPnlPct ?? p.unrealizedPnlPct ?? 0),
        items
      };
    });

    const rawSortOrder = String(web.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
    const rawSortMetric = String(web.watchSettings?.sortByPctMetric || 'DAY').toUpperCase();
    const watchSettings = {
      autoSwipeEnabled: Boolean(web.watchSettings?.autoSwipeEnabled ?? true),
      autoSwipeSec: Math.max(2, Math.min(120, Number(web.watchSettings?.autoSwipeSec || 5))),
      alwaysOnDisplay: Boolean(web.watchSettings?.alwaysOnDisplay ?? false),
      sortByPctOrder: ['ASC', 'DESC', 'NONE'].includes(rawSortOrder) ? rawSortOrder : 'ASC',
      sortByPctMetric: ['DAY', 'TOTAL'].includes(rawSortMetric) ? rawSortMetric : 'DAY',
      deviceId: web.watchSettings?.deviceId || 'V2-88VENU20',
      activationKey: web.watchSettings?.activationKey || ''
    };

    return {
      syncKey: web.syncKey || state.syncKey,
      baseCurrency: web.baseCurrency || 'THB',
      usdThbRate: Number(web.usdThbRate || 34.45),
      fetchedAt: web.updatedAt || new Date().toISOString(),
      watchSettings,
      license: web.license || null,
      summary: {
        totalValueBase: Number(totals.marketValueBase ?? totals.totalValueBase ?? 0),
        totalCostBase: Number(totals.costBasisBase ?? totals.totalCostBase ?? 0),
        dayPnlBase: Number(totals.dayPnlBase ?? 0),
        dayPnlPct: Number(totals.dayPnlPct ?? 0),
        unrealizedPnlBase: Number(totals.totalPnlBase ?? totals.unrealizedPnlBase ?? 0),
        unrealizedPnlPct: Number(totals.totalPnlPct ?? totals.unrealizedPnlPct ?? 0),
        activeAlertCount: totalAlerts,
        portfolioCount: normalizedPortfolios.length,
        holdingCount: totalHoldings
      },
      portfolios: normalizedPortfolios
    };
  }

  function getEffectiveSortPct(item, sortMetric) {
    const metric = String(sortMetric || 'DAY').toUpperCase();
    if (metric === 'TOTAL' && Number(item.shares || 0) > 0) {
      return Number(item.unrealizedPnlPct ?? item.changePct ?? 0);
    }
    return Number(item.changePct ?? 0);
  }

  function applyClientSideSort() {
    if (!state.profile || !Array.isArray(state.profile.portfolios)) return;
    const sortOrder = String(state.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
    const sortMetric = String(state.watchSettings?.sortByPctMetric || 'DAY').toUpperCase();
    if (state.profile.watchSettings) {
      state.profile.watchSettings.sortByPctOrder = sortOrder;
      state.profile.watchSettings.sortByPctMetric = sortMetric;
    }

    state.profile.portfolios.forEach(port => {
      if (!Array.isArray(port.items)) return;
      port.items.sort((a, b) => {
        if (sortOrder === 'NONE') {
          return (a.origIdx ?? 0) - (b.origIdx ?? 0);
        }
        const valA = getEffectiveSortPct(a, sortMetric);
        const valB = getEffectiveSortPct(b, sortMetric);
        if (valA === valB) return (a.origIdx ?? 0) - (b.origIdx ?? 0);
        return sortOrder === 'ASC' ? valA - valB : valB - valA;
      });
    });
  }

  async function loadPortfolio(syncKey = state.syncKey) {
    const cleanKey = String(syncKey || 'VENU2-88').trim().toUpperCase();
    state.syncKey = cleanKey;
    localStorage.setItem('venu2_sync_key', cleanKey);

    const res = await fetch(`/api/portfolio?key=${encodeURIComponent(cleanKey)}`);
    if (!res.ok) throw new Error('ไม่สามารถโหลดข้อมูลพอร์ตได้');
    const raw = await res.json();
    state.profile = normalizeServerPayload(raw);
    state.watchSettings = { ...state.profile.watchSettings };
    state.license = state.profile.license;
    state.autoSwipeRemainingSec = state.watchSettings.autoSwipeSec;
    applyClientSideSort();

    if (state.activePortfolioIndex >= (state.profile.portfolios?.length || 0)) {
      state.activePortfolioIndex = 0;
    }
    renderAll();
    restartAutoSwipeTimer();
  }

  async function savePortfolioState(toastText = 'ซิงก์ข้อมูลและการตั้งค่าเข้า Garmin Venu 2 แล้ว') {
    if (!state.profile) return;
    const payload = {
      syncKey: state.syncKey,
      baseCurrency: state.profile.baseCurrency,
      watchSettings: state.watchSettings,
      portfolios: state.profile.portfolios.map(p => ({
        id: p.id,
        name: p.name,
        currency: p.currency || 'USD',
        holdings: [...p.items]
          .sort((a, b) => (a.origIdx ?? 9999) - (b.origIdx ?? 9999))
          .map(it => ({
            symbol: it.symbol,
            name: it.name,
            currency: it.currency,
            shares: Number(it.shares || 0),
            avgCost: Number(it.avgCost || 0),
            targetPrice: Number(it.targetPrice || it.stopPrice || 0),
            alertDir: it.stopPrice > 0 && !it.targetPrice ? 'BELOW' : 'ABOVE',
            earningsDate: it.earningsDate || '',
            memo: it.note || it.memo || ''
          }))
      }))
    };

    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('ไม่สามารถบันทึกพอร์ตได้');
    const raw = await res.json();
    state.profile = normalizeServerPayload(raw);
    state.watchSettings = { ...state.profile.watchSettings };
    state.license = state.profile.license;
    state.autoSwipeRemainingSec = state.watchSettings.autoSwipeSec;
    renderAll();
    restartAutoSwipeTimer();
    if (toastText) showToast(toastText);
  }

  /* ==========================================================================
     AUTO-SWIPE ENGINE FOR GARMIN VENU 2 SIMULATOR (DEFAULT 5s / CUSTOM SEC)
     ========================================================================== */
  function resetAutoSwipeCountdown() {
    state.autoSwipeRemainingSec = Math.max(2, Number(state.watchSettings.autoSwipeSec || 5));
    updateAutoSwipeBadges();
  }

  function stepAutoSwipeWatchScreen() {
    if (!state.profile || state.license?.isExpired) return;
    const portfolios = state.profile.portfolios || [];
    if (portfolios.length === 0) return;

    if (state.watchMode === 'glance') {
      state.watchMode = 'list';
      state.watchScrollOffset = 0;
      renderGarminVenu2Watch();
      return;
    }

    const activePort = getActivePortfolio();
    const items = activePort?.items || [];

    if (state.watchMode === 'detail') {
      // Advance to next symbol detail, or next portfolio
      if (state.activeSymbolIndex + 1 < items.length) {
        state.activeSymbolIndex += 1;
      } else {
        state.activePortfolioIndex = (state.activePortfolioIndex + 1) % portfolios.length;
        state.activeSymbolIndex = 0;
      }
      renderAll();
      return;
    }

    // In 'list' mode: scroll through 4-row pages, then advance to next portfolio
    const pageSize = 4;
    if (state.watchScrollOffset + pageSize < items.length) {
      state.watchScrollOffset += pageSize;
      state.activeSymbolIndex = Math.min(items.length - 1, state.watchScrollOffset);
    } else {
      state.watchScrollOffset = 0;
      state.activeSymbolIndex = 0;
      state.activePortfolioIndex = (state.activePortfolioIndex + 1) % portfolios.length;
    }
    renderAll();

    // Smooth scroll the watch holdings container inside 416x416 circle
    const watchListEl = el('watchHoldingsList');
    if (watchListEl) {
      const rowHeight = 36;
      watchListEl.scrollTo({
        top: state.watchScrollOffset * rowHeight,
        behavior: 'smooth'
      });
    }
  }

  function updateAutoSwipeBadges() {
    const enabled = Boolean(state.watchSettings.autoSwipeEnabled);
    const sec = Number(state.watchSettings.autoSwipeSec || 5);
    const aon = Boolean(state.watchSettings.alwaysOnDisplay);

    const topBadge = el('autoSwipeCountdownBadge');
    if (topBadge) {
      if (enabled) {
        topBadge.textContent = `Auto ${state.autoSwipeRemainingSec}s / ${sec}s`;
        topBadge.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-cyan/15 text-cyan ring-1 ring-cyan/30';
      } else {
        topBadge.textContent = 'Auto-Swipe: OFF';
        topBadge.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] text-slate-400 ring-1 ring-white/10';
      }
    }

    const watchSwipeBadge = el('watchBadgeAutoSwipe');
    if (watchSwipeBadge) {
      if (enabled) {
        watchSwipeBadge.textContent = `AUTO ${state.autoSwipeRemainingSec}s`;
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
      const srt = String(state.watchSettings.sortByPctOrder || 'ASC').toUpperCase();
      if (srt === 'ASC') {
        watchSortBadge.textContent = '▲ -%→+%';
        watchSortBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-crimson/20 text-crimson ring-1 ring-crimson/35 cursor-pointer hover:bg-crimson/30 transition';
      } else if (srt === 'DESC') {
        watchSortBadge.textContent = '▼ +%→-%';
        watchSortBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald/20 text-emerald ring-1 ring-emerald/35 cursor-pointer hover:bg-emerald/30 transition';
      } else {
        watchSortBadge.textContent = '• MANUAL';
        watchSortBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-slate-300 ring-1 ring-white/15 cursor-pointer hover:bg-white/20 transition';
      }
    }
  }

  function restartAutoSwipeTimer() {
    if (state.autoSwipeIntervalId) {
      clearInterval(state.autoSwipeIntervalId);
      state.autoSwipeIntervalId = null;
    }
    updateAutoSwipeBadges();
    if (!state.watchSettings.autoSwipeEnabled) return;

    state.autoSwipeIntervalId = setInterval(() => {
      if (!state.watchSettings.autoSwipeEnabled || state.license?.isExpired) return;
      state.autoSwipeRemainingSec -= 1;
      if (state.autoSwipeRemainingSec <= 0) {
        stepAutoSwipeWatchScreen();
        state.autoSwipeRemainingSec = Math.max(2, Number(state.watchSettings.autoSwipeSec || 5));
      }
      updateAutoSwipeBadges();
    }, 1000);
  }

  function getActivePortfolio() {
    const list = state.profile?.portfolios || [];
    return list[state.activePortfolioIndex] || list[0] || null;
  }

  function getActiveSymbolItem() {
    const port = getActivePortfolio();
    if (!port || !port.items || port.items.length === 0) return null;
    if (state.activeSymbolIndex >= port.items.length) {
      state.activeSymbolIndex = 0;
    }
    return port.items[state.activeSymbolIndex] || port.items[0];
  }

  function renderAll() {
    if (!state.profile) return;
    renderNavbarAndHero();
    renderWatchSettingsAndLicense();
    renderPortfolioTabs();
    renderHoldingsLedger();
    renderGarminVenu2Watch();
  }

  function renderWatchSettingsAndLicense() {
    const ws = state.watchSettings;
    const lic = state.license;

    const autoToggle = el('autoSwipeToggle');
    if (autoToggle) autoToggle.checked = Boolean(ws.autoSwipeEnabled);

    const secInput = el('autoSwipeSecInput');
    if (secInput && document.activeElement !== secInput) {
      secInput.value = ws.autoSwipeSec;
    }

    document.querySelectorAll('.swipe-preset-btn').forEach(btn => {
      const preset = Number(btn.getAttribute('data-swipe-preset'));
      const active = ws.autoSwipeEnabled && preset === Number(ws.autoSwipeSec);
      btn.className = active
        ? 'swipe-preset-btn px-2 py-0.5 rounded-lg bg-cyan/20 ring-1 ring-cyan/40 text-[11px] font-mono text-cyan font-semibold'
        : 'swipe-preset-btn px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-[11px] font-mono text-slate-300';
    });

    const aonToggle = el('alwaysOnToggle');
    if (aonToggle) aonToggle.checked = Boolean(ws.alwaysOnDisplay);

    const activeSortOrder = String(ws.sortByPctOrder || 'ASC').toUpperCase();
    document.querySelectorAll('.sort-order-btn').forEach(btn => {
      const order = String(btn.getAttribute('data-sort-order') || 'ASC').toUpperCase();
      const isQuickPill = btn.classList.contains('rounded-full');
      const isActive = order === activeSortOrder;
      let activeColorCls = 'bg-cyan/20 text-cyan ring-1 ring-cyan/40 font-semibold';
      if (order === 'ASC') {
        activeColorCls = 'bg-crimson/20 text-crimson ring-1 ring-crimson/40 font-semibold';
      } else if (order === 'DESC') {
        activeColorCls = 'bg-emerald/20 text-emerald ring-1 ring-emerald/40 font-semibold';
      }

      if (isQuickPill) {
        btn.className = isActive
          ? `sort-order-btn px-2.5 py-1 rounded-full spring-transition ${activeColorCls}`
          : 'sort-order-btn px-2.5 py-1 rounded-full text-slate-400 hover:text-alabaster spring-transition';
      } else {
        btn.className = isActive
          ? `sort-order-btn rounded-xl px-3 py-2 text-xs font-mono flex items-center justify-center gap-1.5 spring-transition ${activeColorCls}`
          : 'sort-order-btn rounded-xl px-3 py-2 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 spring-transition bg-white/[0.04] hover:bg-white/[0.1] text-slate-300 ring-1 ring-white/10';
      }
    });

    const activeSortMetric = String(ws.sortByPctMetric || 'DAY').toUpperCase();
    document.querySelectorAll('.sort-metric-btn').forEach(btn => {
      const metric = String(btn.getAttribute('data-sort-metric') || 'DAY').toUpperCase();
      const isActive = metric === activeSortMetric;
      btn.className = isActive
        ? 'sort-metric-btn px-2.5 py-1 rounded-lg bg-cyan/20 text-cyan ring-1 ring-cyan/35 font-semibold spring-transition cursor-pointer'
        : 'sort-metric-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-alabaster spring-transition cursor-pointer';
    });

    const sortModeBadge = el('sortLiveModeBadge');
    const sortTopBottomText = el('sortLiveTopBottomText');
    if (sortModeBadge || sortTopBottomText) {
      const mShort = activeSortMetric === 'TOTAL' ? 'Total %' : 'Day %';
      if (sortModeBadge) {
        if (activeSortOrder === 'ASC') {
          sortModeBadge.textContent = `▲ ติดลบ → กำไร (${mShort})`;
          sortModeBadge.className = 'text-crimson font-semibold';
        } else if (activeSortOrder === 'DESC') {
          sortModeBadge.textContent = `▼ กำไร → ติดลบ (${mShort})`;
          sortModeBadge.className = 'text-emerald font-semibold';
        } else {
          sortModeBadge.textContent = '• ลำดับปกติ (Manual)';
          sortModeBadge.className = 'text-cyan font-semibold';
        }
      }
      if (sortTopBottomText) {
        const activePort = getActivePortfolio();
        const items = activePort?.items || [];
        if (items.length > 0) {
          const first = items[0];
          const last = items[items.length - 1];
          const firstPct = formatSignedPct(getEffectiveSortPct(first, activeSortMetric));
          const lastPct = formatSignedPct(getEffectiveSortPct(last, activeSortMetric));
          sortTopBottomText.textContent = `บนสุด: ${first.symbol} (${firstPct}) → ล่างสุด: ${last.symbol} (${lastPct})`;
        } else {
          sortTopBottomText.textContent = 'ยังไม่มีรายการหุ้นในพอร์ต';
        }
      }
    }

    const devIdInput = el('watchDeviceIdInput');
    if (devIdInput && document.activeElement !== devIdInput) {
      devIdInput.value = lic?.deviceId || ws.deviceId || 'V2-88VENU20';
    }

    const pill = el('licenseStatusPill');
    const navBadge = el('navLicenseBadge');
    const navText = el('navLicenseText');
    const expiryText = el('licenseExpiryText');
    const keyInput = el('activationKeyInput');

    if (lic) {
      if (lic.isActivated || lic.status === 'ACTIVE') {
        if (pill) {
          pill.textContent = 'PRO ACTIVATED';
          pill.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-cyan/20 text-cyan ring-1 ring-cyan/40 font-bold';
        }
        if (navBadge && navText) {
          navText.textContent = `PRO · ${lic.deviceId}`;
          navBadge.className = 'hidden md:flex items-center gap-1.5 rounded-full bg-cyan/15 ring-1 ring-cyan/30 px-3 py-1 text-[11px] font-mono text-cyan spring-transition';
        }
        if (expiryText) {
          expiryText.innerHTML = `เครื่อง <strong class="font-mono text-cyan">${escapeHtml(lic.deviceId)}</strong> เปิดใช้งานเวอร์ชันเต็ม (Lifetime Paid Version) เรียบร้อยแล้ว`;
        }
        if (keyInput && lic.activatedKey && !keyInput.value) {
          keyInput.value = lic.activatedKey;
        }
      } else if (lic.isExpired || lic.status === 'EXPIRED') {
        if (pill) {
          pill.textContent = 'TRIAL 14D EXPIRED';
          pill.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-crimson/20 text-crimson ring-1 ring-crimson/40 font-bold';
        }
        if (navBadge && navText) {
          navText.textContent = 'TRIAL EXPIRED';
          navBadge.className = 'hidden md:flex items-center gap-1.5 rounded-full bg-crimson/20 ring-1 ring-crimson/40 px-3 py-1 text-[11px] font-mono text-crimson spring-transition';
        }
        if (expiryText) {
          expiryText.innerHTML = `<span class="text-crimson font-semibold">หมดเวลาทดลองใช้ 14 วันแล้ว</span> · กรุณาติดต่อเจ้าของแอปสำหรับ Paid Version ที่ <a href="mailto:${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}" class="font-mono font-bold text-amber underline">${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}</a>`;
        }
      } else {
        if (pill) {
          pill.textContent = `TRIAL · ${lic.remainingDays}d left`;
          pill.className = 'font-mono text-[11px] px-2.5 py-1 rounded-full bg-emerald/15 text-emerald ring-1 ring-emerald/30 font-semibold';
        }
        if (navBadge && navText) {
          navText.textContent = `TRIAL ${lic.remainingDays}D`;
          navBadge.className = 'hidden md:flex items-center gap-1.5 rounded-full bg-emerald/15 ring-1 ring-emerald/30 px-3 py-1 text-[11px] font-mono text-emerald spring-transition';
        }
        if (expiryText) {
          expiryText.innerHTML = `สิทธิ์ทดลองใช้ฟรี 14 วัน (คงเหลือ <strong class="font-mono text-emerald">${lic.remainingDays} วัน</strong>) · เมื่อครบกำหนดติดต่อ Paid Version ที่ <strong class="font-mono text-amber">${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}</strong>`;
        }
      }
    }

    updateAutoSwipeBadges();
  }

  function renderNavbarAndHero() {
    const p = state.profile;
    const baseCur = p.baseCurrency || 'THB';

    el('navSyncKeyDisplay').textContent = p.syncKey;
    const didParam = state.watchSettings.deviceId ? `&did=${encodeURIComponent(state.watchSettings.deviceId)}` : '';
    el('watchEndpointUrlBox').textContent = `${window.location.origin}/api/watch?key=${p.syncKey}${didParam}`;

    const thbBtn = el('curThbBtn');
    const usdBtn = el('curUsdBtn');
    if (baseCur === 'THB') {
      thbBtn.className = 'px-2.5 py-1 rounded-full spring-transition font-semibold bg-emerald/20 text-emerald';
      usdBtn.className = 'px-2.5 py-1 rounded-full spring-transition text-slate-400 hover:text-alabaster';
    } else {
      usdBtn.className = 'px-2.5 py-1 rounded-full spring-transition font-semibold bg-emerald/20 text-emerald';
      thbBtn.className = 'px-2.5 py-1 rounded-full spring-transition text-slate-400 hover:text-alabaster';
    }

    const s = p.summary || {};
    el('grandTotalValue').textContent = formatMoney(s.totalValueBase, baseCur);
    el('grandTotalCost').textContent = formatMoney(s.totalCostBase, baseCur);
    el('fxRateReadout').textContent = Number(p.usdThbRate || 34.45).toFixed(2);

    const fetchedDate = p.fetchedAt ? new Date(p.fetchedAt) : new Date();
    const hh = String(fetchedDate.getHours()).padStart(2, '0');
    const mm = String(fetchedDate.getMinutes()).padStart(2, '0');
    const ss = String(fetchedDate.getSeconds()).padStart(2, '0');
    el('lastUpdatedBadge').textContent = `ซิงก์ล่าสุด ${hh}:${mm}:${ss}`;

    const dayPos = (s.dayPnlBase || 0) >= 0;
    el('grandDayPnl').textContent = formatSignedMoney(s.dayPnlBase, baseCur);
    el('grandDayPnl').className = `font-mono text-lg font-bold tabular-nums ${dayPos ? 'text-emerald' : 'text-crimson'}`;
    el('grandDayPct').textContent = formatSignedPct(s.dayPnlPct);
    el('grandDayPct').className = `font-mono text-xs tabular-nums mt-0.5 ${dayPos ? 'text-emerald/80' : 'text-crimson/80'}`;

    const totPos = (s.unrealizedPnlBase || 0) >= 0;
    el('grandTotalPnl').textContent = formatSignedMoney(s.unrealizedPnlBase, baseCur);
    el('grandTotalPnl').className = `font-mono text-lg font-bold tabular-nums ${totPos ? 'text-emerald' : 'text-crimson'}`;
    el('grandTotalPct').textContent = formatSignedPct(s.unrealizedPnlPct);
    el('grandTotalPct').className = `font-mono text-xs tabular-nums mt-0.5 ${totPos ? 'text-emerald/80' : 'text-crimson/80'}`;

    el('activeAlertCount').textContent = String(s.activeAlertCount || 0);
    el('portfolioCountSummary').textContent = `${s.portfolioCount || 0} พอร์ต · ${s.holdingCount || 0} สินทรัพย์`;
  }

  function renderPortfolioTabs() {
    const container = el('portfolioTabsContainer');
    const portfolios = state.profile?.portfolios || [];
    const baseCur = state.profile?.baseCurrency || 'THB';

    container.innerHTML = portfolios.map((port, idx) => {
      const isActive = idx === state.activePortfolioIndex;
      const dayPos = (port.dayPnlBase || 0) >= 0;
      return `
        <button
          type="button"
          data-port-idx="${idx}"
          class="port-tab-btn rounded-full px-4 py-2 text-xs font-semibold flex items-center gap-2 spring-transition active:scale-[0.98] ${
            isActive
              ? 'bg-alabaster text-void shadow-md'
              : 'bg-white/[0.04] hover:bg-white/[0.09] text-slate-300 ring-1 ring-white/10'
          }"
        >
          <span>${escapeHtml(port.name)}</span>
          <span class="font-mono text-[11px] px-1.5 py-0.5 rounded-full ${
            isActive
              ? dayPos ? 'bg-emerald/20 text-void font-bold' : 'bg-crimson/20 text-void font-bold'
              : dayPos ? 'text-emerald' : 'text-crimson'
          }">${formatSignedPct(port.dayPnlPct)}</span>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.port-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activePortfolioIndex = Number(btn.getAttribute('data-port-idx'));
        state.activeSymbolIndex = 0;
        state.watchScrollOffset = 0;
        resetAutoSwipeCountdown();
        renderAll();
      });
    });

    const active = getActivePortfolio();
    if (!active) return;

    el('activePortfolioTitle').textContent = active.name;
    el('activePortfolioMeta').textContent = `ชื่อย่อบนนาฬิกา Venu 2: ${active.shortName || active.name.toUpperCase()} · ${active.items.length} รายการ`;
    el('activePortValue').textContent = formatMoney(active.totalValueBase, baseCur);

    const dayPos = (active.dayPnlBase || 0) >= 0;
    el('activePortDayPnl').textContent = `${formatSignedMoney(active.dayPnlBase, baseCur, true)} (${formatSignedPct(active.dayPnlPct)})`;
    el('activePortDayPnl').className = `text-sm font-semibold tabular-nums ${dayPos ? 'text-emerald' : 'text-crimson'}`;

    const totPos = (active.unrealizedPnlBase || 0) >= 0;
    el('activePortTotalPnl').textContent = `${formatSignedMoney(active.unrealizedPnlBase, baseCur, true)} (${formatSignedPct(active.unrealizedPnlPct)})`;
    el('activePortTotalPnl').className = `text-sm font-semibold tabular-nums ${totPos ? 'text-emerald' : 'text-crimson'}`;
  }

  function renderHoldingsLedger() {
    const container = el('holdingsListContainer');
    const activePort = getActivePortfolio();

    if (!activePort || !activePort.items || activePort.items.length === 0) {
      container.innerHTML = `
        <div class="rounded-2xl bg-void/60 ring-1 ring-white/[0.06] p-8 text-center">
          <p class="text-sm font-semibold text-alabaster mb-1">ยังไม่มีสินทรัพย์ในพอร์ตนี้</p>
          <p class="text-xs text-slate-400 mb-4">พิมพ์ค้นหาชื่อหุ้นในช่องด้านบน หรือกดปุ่ม "เพิ่มรายการใหม่" เพื่อเริ่มสร้างพอร์ตเข้า Garmin Venu 2</p>
        </div>
      `;
      return;
    }

    container.innerHTML = activePort.items.map((item, idx) => {
      const isSelectedOnWatch = idx === state.activeSymbolIndex;
      const dayPos = (item.change || 0) >= 0;
      const pnlPos = (item.unrealizedPnlNative || 0) >= 0;
      const isWatchlistOnly = Number(item.shares || 0) <= 0;

      let alertBadgeHtml = '';
      if (item.alert?.status === 'TARGET_HIT') {
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-emerald/20 ring-1 ring-emerald/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald">▲ ถึงเป้าหมาย ${formatMoney(item.targetPrice, item.currency)}</span>`;
      } else if (item.alert?.status === 'STOP_BREACH') {
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-crimson/20 ring-1 ring-crimson/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-crimson">▼ หลุดแนวรับ ${formatMoney(item.stopPrice, item.currency)}</span>`;
      } else if (item.alert?.status === 'NEAR_TARGET') {
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-amber/20 ring-1 ring-amber/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber">● ใกล้เป้า (${item.alert.distancePct}%)</span>`;
      }

      return `
        <div
          data-holding-idx="${idx}"
          class="holding-row group rounded-2xl p-4 sm:p-5 spring-transition cursor-pointer ${
            isSelectedOnWatch
              ? 'bg-white/[0.065] ring-1 ring-cyan/50 shadow-lg'
              : 'bg-void/65 hover:bg-white/[0.04] ring-1 ring-white/[0.06]'
          }"
        >
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-2xl flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
                dayPos
                  ? 'bg-emerald/15 text-emerald ring-1 ring-emerald/30'
                  : 'bg-crimson/15 text-crimson ring-1 ring-crimson/30'
              }">
                ${escapeHtml(item.symbol.replace('.BK', '').slice(0, 4))}
              </div>
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono font-bold text-sm sm:text-base text-alabaster">${escapeHtml(item.symbol)}</span>
                  <span class="text-xs text-slate-400">${escapeHtml(item.name)}</span>
                  ${item.earningsBadge ? `<span class="rounded-full bg-amber/15 text-amber ring-1 ring-amber/30 px-2 py-0.5 font-mono text-[10px] font-semibold" title="วันประกาศงบถัดไป (Next Earnings Date)">${escapeHtml(item.earningsBadge)}</span>` : ''}
                  ${isWatchlistOnly ? '<span class="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-slate-400">WATCHLIST</span>' : ''}
                  ${alertBadgeHtml}
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
                  ${
                    isWatchlistOnly
                      ? `<span>โหมดเฝ้าดูราคา (ไม่ได้ระบุจำนวนหุ้น)</span>`
                      : `<span>ถือครอง: <strong class="text-slate-200">${item.shares}</strong> @ ทุน ${formatMoney(item.avgCost, item.currency)}</span>
                         <span>·</span>
                         <span>สัดส่วน: <strong class="text-cyan">${item.allocationPct}%</strong></span>`
                  }
                  <span>·</span>
                  <span class="text-cyan">SMA20: <strong>${formatMoney(item.sma20, item.currency)}</strong> <span class="${(item.smaPct || 0) >= 0 ? 'text-emerald' : 'text-crimson'}">(${formatSignedPct(item.smaPct, 1)})</span></span>
                  <span>·</span>
                  <span class="${getRsiZoneStyle(item.rsi14).textClass}" title="RSI 14 วัน (${getRsiZoneStyle(item.rsi14).zoneLabel})">RSI14: <strong>${Number(item.rsi14 ?? 50).toFixed(1)}</strong></span>
                  <span>·</span>
                  <span>Day L: <strong class="text-crimson/90">${formatMoney(item.dayLow ?? item.low, item.currency)}</strong> / H: <strong class="text-emerald/90">${formatMoney(item.dayHigh ?? item.high, item.currency)}</strong></span>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between sm:justify-end gap-5 font-mono text-right">
              <div>
                <div class="text-xs text-slate-400">ราคาตลาด</div>
                <div class="text-sm sm:text-base font-bold text-alabaster tabular-nums">
                  ${formatMoney(item.price, item.currency)}
                </div>
                <div class="text-xs font-semibold tabular-nums ${dayPos ? 'text-emerald' : 'text-crimson'}">
                  ${formatSignedMoney(item.change, item.currency)} (${formatSignedPct(item.changePct)})
                </div>
              </div>

              <div class="min-w-[105px]">
                <div class="text-xs text-slate-400">${isWatchlistOnly ? 'กรอบเป้า/รับ' : 'มูลค่า / กำไรรวม'}</div>
                ${
                  isWatchlistOnly
                    ? `<div class="text-xs text-emerald tabular-nums">▲ ${item.targetPrice ? formatMoney(item.targetPrice, item.currency) : '-'}</div>
                       <div class="text-xs text-crimson tabular-nums">▼ ${item.stopPrice ? formatMoney(item.stopPrice, item.currency) : '-'}</div>`
                    : `<div class="text-sm font-bold text-alabaster tabular-nums">${formatMoney(item.marketValueNative, item.currency)}</div>
                       <div class="text-xs font-semibold tabular-nums ${pnlPos ? 'text-emerald' : 'text-crimson'}">
                         ${formatSignedMoney(item.unrealizedPnlNative, item.currency, true)} (${formatSignedPct(item.unrealizedPnlPct)})
                       </div>`
                }
              </div>

              <button
                type="button"
                data-edit-idx="${idx}"
                class="edit-holding-btn w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.14] ring-1 ring-white/10 flex items-center justify-center text-slate-300 hover:text-alabaster spring-transition"
                title="แก้ไขจำนวนหุ้น / ราคาทุน / โน้ต WebMemo"
              >
                <i class="ph-light ph-sliders-horizontal text-sm"></i>
              </button>
            </div>
          </div>

          ${
            item.note
              ? `<div class="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-xs">
                   <div class="flex items-center gap-2 text-slate-300">
                     <i class="ph-light ph-note-pencil text-cyan shrink-0"></i>
                     <span class="font-mono text-[11px] text-cyan shrink-0">WebMemo:</span>
                     <span class="text-slate-300">${escapeHtml(item.note)}</span>
                   </div>
                   <span class="text-[10px] font-mono text-slate-500 hidden sm:inline">แตะเพื่อดูบนจอ Venu 2 →</span>
                 </div>`
              : ''
          }
        </div>
      `;
    }).join('');

    container.querySelectorAll('.holding-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.edit-holding-btn')) return;
        state.activeSymbolIndex = Number(row.getAttribute('data-holding-idx'));
        state.watchMode = 'detail';
        resetAutoSwipeCountdown();
        renderAll();
      });
    });

    container.querySelectorAll('.edit-holding-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-edit-idx'));
        state.activeSymbolIndex = idx;
        openHoldingModal(activePort.items[idx]);
      });
    });
  }

  /* ==========================================================================
     GARMIN VENU 2 (416x416 AMOLED) INTERACTIVE SIMULATOR RENDERER
     ========================================================================== */
  function renderGarminVenu2Watch() {
    const p = state.profile;
    if (!p) return;

    const baseCur = p.baseCurrency || 'THB';
    const now = new Date();
    const clockStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    el('watchGlanceClock').textContent = clockStr;
    el('watchListClock').textContent = clockStr;
    el('watchListSyncKey').textContent = p.syncKey;

    const isTrialExpired = Boolean(state.license?.isExpired);
    const expiredView = el('watchViewExpired');

    if (isTrialExpired && expiredView) {
      el('watchViewGlance').classList.add('hidden');
      el('watchViewList').classList.add('hidden');
      el('watchViewDetail').classList.add('hidden');
      expiredView.classList.remove('hidden');
      const expDid = el('watchExpiredDeviceId');
      if (expDid) expDid.textContent = state.license.deviceId || state.watchSettings.deviceId;
      const expEmail = el('watchExpiredOwnerEmail');
      if (expEmail) expEmail.textContent = state.license.ownerEmail || 'saharat.bun@icloud.com';
      return;
    }

    if (expiredView) expiredView.classList.add('hidden');

    document.querySelectorAll('.watch-mode-btn').forEach(btn => {
      const m = btn.getAttribute('data-watch-mode');
      if (m === state.watchMode) {
        btn.className = 'watch-mode-btn px-2.5 py-1 rounded-full bg-cyan/20 text-cyan font-semibold spring-transition';
      } else {
        btn.className = 'watch-mode-btn px-2.5 py-1 rounded-full text-slate-400 hover:text-alabaster spring-transition';
      }
    });

    el('watchViewGlance').classList.toggle('hidden', state.watchMode !== 'glance');
    el('watchViewList').classList.toggle('hidden', state.watchMode !== 'list');
    el('watchViewDetail').classList.toggle('hidden', state.watchMode !== 'detail');

    // 1. Render Glance Widget View
    const s = p.summary || {};
    el('glanceNetWorth').textContent = formatMoney(s.totalValueBase, baseCur);
    const gDayPos = (s.dayPnlBase || 0) >= 0;
    el('glanceDayPnl').textContent = formatSignedMoney(s.dayPnlBase, baseCur, true);
    el('glanceDayPnl').className = `text-xs font-bold tabular-nums ${gDayPos ? 'text-emerald' : 'text-crimson'}`;
    el('glanceDayPct').textContent = formatSignedPct(s.dayPnlPct);
    el('glanceDayPct').className = `text-[11px] tabular-nums ${gDayPos ? 'text-emerald/80' : 'text-crimson/80'}`;
    el('glanceAlertDot').classList.toggle('hidden', !(s.activeAlertCount > 0));

    // 2. Render Main Portfolio & Holdings List View
    const activePort = getActivePortfolio();
    if (!activePort) return;

    el('watchPortShortName').textContent = activePort.shortName || activePort.name.toUpperCase();
    el('watchPortTotalVal').textContent = formatMoney(activePort.totalValueBase, baseCur);

    const showingDay = state.watchPnlMode === 'day';
    const deltaVal = showingDay ? activePort.dayPnlBase : activePort.unrealizedPnlBase;
    const deltaPct = showingDay ? activePort.dayPnlPct : activePort.unrealizedPnlPct;
    const deltaPos = (deltaVal || 0) >= 0;

    el('watchPortPnlModeLabel').textContent = showingDay ? 'DAY:' : 'TOTAL:';
    el('watchPortDeltaText').textContent = `${formatSignedMoney(deltaVal, baseCur, true)} (${formatSignedPct(deltaPct)})`;
    el('watchPortDeltaText').className = `font-semibold tabular-nums ${deltaPos ? 'text-emerald' : 'text-crimson'}`;

    const watchListEl = el('watchHoldingsList');
    watchListEl.innerHTML = activePort.items.map((it, idx) => {
      const symShort = it.symbol.replace('.BK', '');
      const lastPct = Number(it.changePct || 0);
      const rowPos = lastPct >= 0;
      const smaPct = Number(it.smaPct ?? (it.sma20 > 0 ? ((it.price - it.sma20) / it.sma20) * 100 : 0));

      let alertDot = '';
      if (it.alert?.status === 'TARGET_HIT') {
        alertDot = '<span class="w-1.5 h-1.5 rounded-full bg-emerald inline-block shrink-0"></span>';
      } else if (it.alert?.status === 'STOP_BREACH') {
        alertDot = '<span class="w-1.5 h-1.5 rounded-full bg-crimson inline-block shrink-0"></span>';
      } else if (it.alert?.status === 'NEAR_TARGET') {
        alertDot = '<span class="w-1.5 h-1.5 rounded-full bg-amber inline-block shrink-0"></span>';
      }

      const earningsHtml = it.earningsBadge
        ? `<span class="text-[8px] text-amber/95 font-normal tracking-tighter">${escapeHtml(it.earningsBadge)}</span>`
        : '';

      return `
        <button
          type="button"
          data-watch-item-idx="${idx}"
          class="watch-holding-item w-full rounded-xl px-2 py-1 flex flex-col gap-0.5 font-mono text-[10px] leading-tight transition ${
            idx === state.activeSymbolIndex
              ? 'bg-white/[0.11] ring-1 ring-cyan/40'
              : 'bg-white/[0.035] hover:bg-white/[0.08]'
          }"
        >
          <div class="w-full flex items-center justify-between gap-1">
            <div class="flex items-center gap-1 text-left min-w-0 truncate">
              ${alertDot}
              <span class="font-bold text-alabaster text-[11px]">${escapeHtml(symShort)}</span>
              ${earningsHtml}
              ${it.note ? '<i class="ph-light ph-note text-[9px] text-cyan shrink-0"></i>' : ''}
            </div>
            <div class="flex items-center gap-1.5 tabular-nums shrink-0">
              <span class="text-slate-100 font-semibold text-[10px]">${formatMoney(it.price, it.currency)}</span>
              <span class="font-semibold text-[10px] min-w-[44px] text-right ${rowPos ? 'text-emerald' : 'text-crimson'}">
                ${formatSignedPct(lastPct)}
              </span>
            </div>
          </div>
          <div class="w-full flex items-center justify-between text-[8.5px] tabular-nums text-slate-400">
            <div class="flex items-center gap-1 min-w-0 truncate">
              <span class="text-cyan/95">SMA:${formatCompactPrice(it.sma20, it.currency)}(${formatSignedPct(smaPct, 1)})</span>
              <span class="${getRsiZoneStyle(it.rsi14).textClass} font-bold">R:${Math.round(it.rsi14 ?? 50)}</span>
            </div>
            <span class="shrink-0">L${formatCompactPrice(it.dayLow ?? it.low, it.currency)} H${formatCompactPrice(it.dayHigh ?? it.high, it.currency)}</span>
          </div>
        </button>
      `;
    }).join('');

    watchListEl.querySelectorAll('.watch-holding-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeSymbolIndex = Number(btn.getAttribute('data-watch-item-idx'));
        state.watchMode = 'detail';
        resetAutoSwipeCountdown();
        renderAll();
      });
    });

    // Portfolio carousel dots
    el('watchPortDots').innerHTML = (p.portfolios || []).map((_, idx) => `
      <span class="h-1.5 rounded-full transition-all ${
        idx === state.activePortfolioIndex ? 'w-4 bg-cyan' : 'w-1.5 bg-white/20'
      }"></span>
    `).join('');

    // 3. Render Symbol Detail + Sparkline + SMA/Bollinger + WebMemo View
    const item = getActiveSymbolItem();
    if (!item) return;

    el('watchDetailSymbol').textContent = item.symbol.replace('.BK', '');
    el('watchDetailPrice').textContent = formatMoney(item.price, item.currency);

    const edBadgeEl = el('watchDetailEarningsBadge');
    if (edBadgeEl) {
      if (item.earningsBadge) {
        edBadgeEl.textContent = item.earningsBadge;
        edBadgeEl.classList.remove('hidden');
      } else {
        edBadgeEl.classList.add('hidden');
      }
    }

    const dPos = (item.changePct || 0) >= 0;
    el('watchDetailChange').textContent = `${formatSignedMoney(item.change, item.currency)} (${formatSignedPct(item.changePct)})`;
    el('watchDetailChange').className = `text-xs font-semibold tabular-nums ${dPos ? 'text-emerald' : 'text-crimson'}`;

    const badge = el('watchDetailAlertBadge');
    if (item.alert?.status === 'TARGET_HIT') {
      badge.textContent = '▲ TARGET HIT';
      badge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-emerald/25 text-emerald font-bold';
    } else if (item.alert?.status === 'STOP_BREACH') {
      badge.textContent = '▼ STOP BREACH';
      badge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-crimson/25 text-crimson font-bold';
    } else if (item.alert?.status === 'NEAR_TARGET') {
      badge.textContent = '● NEAR TARGET';
      badge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber/25 text-amber font-bold';
    } else {
      badge.textContent = item.currency;
      badge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white/10 text-slate-300';
    }

    el('watchChartLowLabel').textContent = `Day L: ${formatMoney(item.dayLow ?? item.low, item.currency)}`;
    el('watchChartHighLabel').textContent = `Day H: ${formatMoney(item.dayHigh ?? item.high, item.currency)}`;
    const itemSmaPct = Number(item.smaPct ?? (item.sma20 > 0 ? ((item.price - item.sma20) / item.sma20) * 100 : 0));
    el('watchToggleBbBtn').textContent = `SMA20: ${formatCompactPrice(item.sma20 || item.price, item.currency)} (${formatSignedPct(itemSmaPct, 1)}) · RSI14: ${Math.round(item.rsi14 ?? 50)}${state.watchShowBb ? ' · BB' : ''}`;

    if (item.shares > 0) {
      el('watchDetailPos').textContent = `${item.shares} @ ${formatMoney(item.avgCost, item.currency)}`;
      const uPos = (item.unrealizedPnlPct || 0) >= 0;
      el('watchDetailPnl').textContent = `${formatSignedPct(item.unrealizedPnlPct)}`;
      el('watchDetailPnl').className = `font-semibold ml-1 ${uPos ? 'text-emerald' : 'text-crimson'}`;
    } else {
      el('watchDetailPos').textContent = 'Watchlist';
      el('watchDetailPnl').textContent = '-';
      el('watchDetailPnl').className = 'text-slate-400 ml-1';
    }

    el('watchDetailTarget').textContent = item.targetPrice > 0 ? formatMoney(item.targetPrice, item.currency) : '-';
    el('watchDetailStop').textContent = item.stopPrice > 0 ? formatMoney(item.stopPrice, item.currency) : '-';
    el('watchDetailMemo').textContent = item.note || 'ไม่มีโน้ตสำหรับสินทรัพย์นี้ (คลิกปุ่มแก้ไขบนเว็บเพื่อเพิ่ม WebMemo)';

    drawWatchSparkline(item);
  }

  function drawWatchSparkline(item) {
    const canvas = el('watchSparklineCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const series = item.sparkline && item.sparkline.length > 1 ? item.sparkline : [item.prevClose || 100, item.price || 100];
    const sma = item.smaSeries && item.smaSeries.length === series.length ? item.smaSeries : [];
    const bbU = item.bbUpperSeries && item.bbUpperSeries.length === series.length ? item.bbUpperSeries : [];
    const bbL = item.bbLowerSeries && item.bbLowerSeries.length === series.length ? item.bbLowerSeries : [];

    const allVals = [...series, ...sma];
    if (item.dayLow > 0) allVals.push(item.dayLow);
    if (item.dayHigh > 0) allVals.push(item.dayHigh);
    if (state.watchShowBb) {
      allVals.push(...bbU, ...bbL);
    }
    if (item.targetPrice > 0) allVals.push(item.targetPrice);

    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    const span = maxVal - minVal || 1;
    const padY = 6;

    const toX = idx => (idx / (series.length - 1)) * (w - 8) + 4;
    const toY = val => h - padY - ((val - minVal) / span) * (h - padY * 2);

    if (state.watchShowBb && bbU.length === series.length && bbL.length === series.length) {
      ctx.beginPath();
      bbU.forEach((v, i) => {
        const x = toX(i);
        const y = toY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = bbL.length - 1; i >= 0; i--) {
        ctx.lineTo(toX(i), toY(bbL[i]));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(6, 182, 212, 0.11)';
      ctx.fill();
    }

    if (sma.length === series.length) {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      sma.forEach((v, i) => {
        const x = toX(i);
        const y = toY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const isUp = (item.change || 0) >= 0;
    const mainColor = isUp ? '#10B981' : '#F43F5E';

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
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const lastX = toX(series.length - 1);
    const lastY = toY(series[series.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#F2F5F8';
    ctx.fill();
  }

  /* ==========================================================================
     MODALS, AUTOCOMPLETE SEARCH & INTERACTION HANDLERS
     ========================================================================== */
  function openHoldingModal(existingItem = null) {
    const modal = el('holdingModal');
    const delBtn = el('deleteHoldingBtn');

    if (existingItem) {
      el('holdingModalTitle').textContent = `แก้ไข ${existingItem.symbol} & WebMemo`;
      el('holdingEditOriginalSymbol').value = existingItem.symbol;
      el('holdingSymbolInput').value = existingItem.symbol;
      el('holdingNameInput').value = existingItem.name || '';
      el('holdingCurrencySelect').value = existingItem.currency || 'USD';
      el('holdingSharesInput').value = existingItem.shares ?? 0;
      el('holdingAvgCostInput').value = existingItem.avgCost ?? 0;
      el('holdingTargetInput').value = existingItem.targetPrice || '';
      el('holdingStopInput').value = existingItem.stopPrice || '';
      if (el('holdingEarningsDateInput')) {
        el('holdingEarningsDateInput').value = existingItem.earningsDate || '';
      }
      el('holdingNoteInput').value = existingItem.note || '';
      delBtn.classList.remove('hidden');
    } else {
      el('holdingModalTitle').textContent = 'เพิ่มสินทรัพย์ใหม่เข้าพอร์ต';
      el('holdingEditOriginalSymbol').value = '';
      el('holdingSymbolInput').value = '';
      el('holdingNameInput').value = '';
      el('holdingCurrencySelect').value = state.activePortfolioIndex === 1 ? 'THB' : 'USD';
      el('holdingSharesInput').value = 10;
      el('holdingAvgCostInput').value = 0;
      el('holdingTargetInput').value = '';
      el('holdingStopInput').value = '';
      if (el('holdingEarningsDateInput')) {
        el('holdingEarningsDateInput').value = '';
      }
      el('holdingNoteInput').value = '';
      delBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    el('holdingSymbolInput').focus();
  }

  function closeHoldingModal() {
    const modal = el('holdingModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async function openSyncPayloadModal() {
    const modal = el('syncModal');
    el('syncKeyInput').value = state.syncKey;
    const didParam = state.watchSettings.deviceId ? `&did=${encodeURIComponent(state.watchSettings.deviceId)}` : '';
    el('modalWatchEndpointLabel').textContent = `/api/watch?key=${state.syncKey}${didParam}`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const res = await fetch(`/api/watch?key=${encodeURIComponent(state.syncKey)}${didParam}`);
    const data = await res.json();
    const formatted = JSON.stringify(data, null, 2);
    el('watchJsonPreview').textContent = formatted;
    el('payloadByteSizeLabel').textContent = `${new Blob([JSON.stringify(data)]).size.toLocaleString()} bytes (Garmin CIQ Ready)`;
  }

  function toggleIslandMenu(forceState) {
    state.menuOpen = forceState !== undefined ? forceState : !state.menuOpen;
    const btn = el('menuToggleBtn');
    const overlay = el('islandMenuOverlay');
    const cards = overlay.querySelectorAll('.menu-reveal-item');

    btn.classList.toggle('menu-open', state.menuOpen);
    btn.setAttribute('aria-expanded', String(state.menuOpen));

    if (state.menuOpen) {
      overlay.classList.remove('opacity-0', 'pointer-events-none');
      overlay.classList.add('opacity-100', 'pointer-events-auto');
      cards.forEach(c => {
        c.classList.remove('translate-y-12', 'opacity-0');
        c.classList.add('translate-y-0', 'opacity-100');
      });
    } else {
      overlay.classList.add('opacity-0', 'pointer-events-none');
      overlay.classList.remove('opacity-100', 'pointer-events-auto');
      cards.forEach(c => {
        c.classList.add('translate-y-12', 'opacity-0');
        c.classList.remove('translate-y-0', 'opacity-100');
      });
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindEvents() {
    el('menuToggleBtn').addEventListener('click', () => toggleIslandMenu());
    el('islandMenuOverlay').addEventListener('click', e => {
      if (e.target === el('islandMenuOverlay')) toggleIslandMenu(false);
    });

    // Base Currency Switch
    el('curThbBtn').addEventListener('click', async () => {
      if (!state.profile || state.profile.baseCurrency === 'THB') return;
      state.profile.baseCurrency = 'THB';
      await savePortfolioState('เปลี่ยนสกุลเงินหลักเป็น THB (฿)');
    });
    el('curUsdBtn').addEventListener('click', async () => {
      if (!state.profile || state.profile.baseCurrency === 'USD') return;
      state.profile.baseCurrency = 'USD';
      await savePortfolioState('เปลี่ยนสกุลเงินหลักเป็น USD ($)');
    });

    // Refresh Quotes
    el('refreshQuotesBtn').addEventListener('click', async () => {
      const icon = el('refreshSpinnerIcon');
      icon.classList.add('animate-spin');
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
          renderAll();
          showToast('อัปเดตราคาหุ้นและอัตราแลกเปลี่ยนล่าสุดแล้ว');
        }
      } finally {
        setTimeout(() => icon.classList.remove('animate-spin'), 450);
      }
    });

    // =========================================================================
    // WATCH DISPLAY SETTINGS (AUTO-SWIPE & ALWAYS-ON) & DEVICE ACTIVATION
    // =========================================================================
    const autoSwipeToggle = el('autoSwipeToggle');
    if (autoSwipeToggle) {
      autoSwipeToggle.addEventListener('change', async () => {
        state.watchSettings.autoSwipeEnabled = autoSwipeToggle.checked;
        await savePortfolioState(
          autoSwipeToggle.checked
            ? `เปิด Auto-Swipe หน้าจอนาฬิกาทุก ${state.watchSettings.autoSwipeSec} วินาที`
            : 'ปิด Auto-Swipe หน้าจอนาฬิกาแล้ว'
        );
      });
    }

    document.querySelectorAll('.swipe-preset-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sec = Number(btn.getAttribute('data-swipe-preset')) || 5;
        state.watchSettings.autoSwipeEnabled = true;
        state.watchSettings.autoSwipeSec = sec;
        await savePortfolioState(`ตั้งเวลา Auto-Swipe หน้าจอนาฬิกาเป็นทุก ${sec} วินาที`);
      });
    });

    const autoSwipeSecInput = el('autoSwipeSecInput');
    if (autoSwipeSecInput) {
      autoSwipeSecInput.addEventListener('change', async () => {
        const sec = Math.max(2, Math.min(120, Math.round(Number(autoSwipeSecInput.value) || 5)));
        autoSwipeSecInput.value = sec;
        state.watchSettings.autoSwipeSec = sec;
        await savePortfolioState(`ตั้งเวลา Auto-Swipe กำหนดเองเป็นทุก ${sec} วินาที`);
      });
    }

    const alwaysOnToggle = el('alwaysOnToggle');
    if (alwaysOnToggle) {
      alwaysOnToggle.addEventListener('change', async () => {
        state.watchSettings.alwaysOnDisplay = alwaysOnToggle.checked;
        await savePortfolioState(
          alwaysOnToggle.checked
            ? 'เปิดโหมด Always-On Screen (หน้าจอนาฬิกาไม่ดับขณะเปิดแอป)'
            : 'ปิดโหมด Always-On Screen (ประหยัดแบตเตอรี่ตามค่าปกติ)'
        );
      });
    }

    function getSortOrderLabel(order, metric) {
      const mLabel = metric === 'TOTAL' ? '% กำไรรวม' : '% Change วันนี้';
      if (order === 'ASC') return `เรียง ${mLabel}: ▲ ติดลบ → กำไร (บนลงล่าง)`;
      if (order === 'DESC') return `เรียง ${mLabel}: ▼ กำไร → ติดลบ (บนลงล่าง)`;
      return 'เรียงตามลำดับปกติที่เพิ่มเข้าพอร์ต (Manual)';
    }

    async function applyAndSyncSortSettings(newOrder, newMetric) {
      if (newOrder !== undefined) {
        const cleanOrder = String(newOrder || 'ASC').toUpperCase();
        state.watchSettings.sortByPctOrder = ['ASC', 'DESC', 'NONE'].includes(cleanOrder) ? cleanOrder : 'ASC';
      }
      if (newMetric !== undefined) {
        const cleanMetric = String(newMetric || 'DAY').toUpperCase();
        state.watchSettings.sortByPctMetric = cleanMetric === 'TOTAL' ? 'TOTAL' : 'DAY';
        if (state.watchSettings.sortByPctOrder === 'NONE') {
          state.watchSettings.sortByPctOrder = 'ASC';
        }
        state.watchPnlMode = state.watchSettings.sortByPctMetric === 'TOTAL' ? 'total' : 'day';
      }

      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      applyClientSideSort();
      resetAutoSwipeCountdown();
      renderAll();

      const watchListEl = el('watchHoldingsList');
      if (watchListEl) {
        watchListEl.scrollTo({ top: 0, behavior: 'smooth' });
      }

      const label = getSortOrderLabel(state.watchSettings.sortByPctOrder, state.watchSettings.sortByPctMetric);
      showToast(label);

      try {
        await savePortfolioState(null);
      } catch (err) {
        console.error('Failed to sync sort setting:', err);
      }
    }

    document.querySelectorAll('.sort-order-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const order = String(btn.getAttribute('data-sort-order') || 'ASC').toUpperCase();
        applyAndSyncSortSettings(order, undefined);
      });
    });

    document.querySelectorAll('.sort-metric-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const metric = String(btn.getAttribute('data-sort-metric') || 'DAY').toUpperCase();
        applyAndSyncSortSettings(undefined, metric);
      });
    });

    const toggleSortDirection = e => {
      if (e) e.preventDefault();
      const cur = String(state.watchSettings.sortByPctOrder || 'ASC').toUpperCase();
      const nextOrder = cur === 'ASC' ? 'DESC' : 'ASC';
      applyAndSyncSortSettings(nextOrder, undefined);
    };

    el('flipSortDirectionBtn')?.addEventListener('click', toggleSortDirection);
    el('watchBadgeSortOrder')?.addEventListener('click', toggleSortDirection);

    const watchDeviceIdInput = el('watchDeviceIdInput');
    if (watchDeviceIdInput) {
      watchDeviceIdInput.addEventListener('change', async () => {
        const cleanId = watchDeviceIdInput.value.trim().toUpperCase();
        if (!cleanId) return;
        state.watchSettings.deviceId = cleanId;
        await savePortfolioState(`ซิงก์รหัสเครื่อง Garmin Venu 2: ${cleanId}`);
      });
    }

    const activateDeviceBtn = el('activateDeviceBtn');
    if (activateDeviceBtn) {
      activateDeviceBtn.addEventListener('click', async () => {
        const devId = (el('watchDeviceIdInput')?.value || state.watchSettings.deviceId || 'V2-88VENU20').trim().toUpperCase();
        const actKey = (el('activationKeyInput')?.value || '').trim().toUpperCase();
        if (!actKey) {
          showToast('กรุณากรอกรหัส Activate (MOAT-XXXX-XXXX-XXXX)');
          return;
        }
        const res = await fetch('/api/device/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncKey: state.syncKey,
            deviceId: devId,
            activationKey: actKey
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast(data.error || 'รหัส Activate ไม่ถูกต้อง กรุณาติดต่อ saharat.bun@icloud.com');
          return;
        }
        if (data.payload) {
          state.profile = normalizeServerPayload(data.payload);
          state.watchSettings = { ...state.profile.watchSettings };
          state.license = state.profile.license;
          renderAll();
        }
        showToast(data.message || `Activate เครื่อง ${devId} สำเร็จ!`);
      });
    }

    // Customer Self-Service: Request Trial Key Extend & Purchase License Form Modal
    function setLicenseRequestTypeUI(reqType) {
      const normalized = reqType === 'TRIAL_EXTEND' ? 'TRIAL_EXTEND' : 'PURCHASE_LICENSE';
      const typeInput = el('requestTypeInput');
      if (typeInput) typeInput.value = normalized;

      const purchaseBtn = el('reqTypePurchaseBtn');
      const trialBtn = el('reqTypeTrialExtendBtn');
      const extendDaysWrap = el('requestExtendDaysWrapper');
      const titleEl = el('licenseRequestModalTitle');
      const msgInput = el('requestMessageInput');

      if (normalized === 'TRIAL_EXTEND') {
        if (trialBtn) {
          trialBtn.className = 'req-type-btn rounded-xl bg-amber/20 ring-1 ring-amber/50 px-3 py-2.5 text-xs font-bold text-amber flex items-center justify-center gap-1.5 spring-transition';
        }
        if (purchaseBtn) {
          purchaseBtn.className = 'req-type-btn rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2.5 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 spring-transition';
        }
        if (extendDaysWrap) extendDaysWrap.classList.remove('opacity-40');
        if (titleEl) titleEl.textContent = 'ขอต่ออายุสิทธิ์ทดลองใช้ฟรี (Request Trial Key Extend)';
        if (msgInput && !msgInput.value.trim()) {
          msgInput.placeholder = 'ระบุเหตุผลหรือความประสงค์ในการขอต่ออายุทดลองใช้ (Trial Key Extend) เพื่อให้ผู้ดูแลระบบพิจารณาอนุมัติ...';
        }
      } else {
        if (purchaseBtn) {
          purchaseBtn.className = 'req-type-btn rounded-xl bg-cyan/20 ring-1 ring-cyan/50 px-3 py-2.5 text-xs font-bold text-cyan flex items-center justify-center gap-1.5 spring-transition';
        }
        if (trialBtn) {
          trialBtn.className = 'req-type-btn rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2.5 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 spring-transition';
        }
        if (extendDaysWrap) extendDaysWrap.classList.add('opacity-40');
        if (titleEl) titleEl.textContent = 'แบบฟอร์มขอซื้อ License ถาวร (Purchase Request Form)';
        if (msgInput && !msgInput.value.trim()) {
          msgInput.placeholder = 'ระบุความประสงค์ต้องการซื้อรหัส Activate ถาวร (PRO Lifetime) และช่วงเวลาที่สะดวกให้ติดต่อกลับ...';
        }
      }
    }

    function openLicenseRequestModal(reqType = 'PURCHASE_LICENSE') {
      const modal = el('licenseRequestModal');
      if (!modal) return;
      const devId = (el('watchDeviceIdInput')?.value || state.watchSettings.deviceId || 'V2-88VENU20').trim().toUpperCase();
      if (el('requestDeviceIdInput')) el('requestDeviceIdInput').value = devId;
      if (el('requestSyncKeyInput')) el('requestSyncKeyInput').value = state.syncKey || 'VENU2-88';
      const fb = el('licenseRequestFeedbackBox');
      if (fb) fb.classList.add('hidden');
      setLicenseRequestTypeUI(reqType);
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeLicenseRequestModal() {
      const modal = el('licenseRequestModal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    el('openTrialExtendModalBtn')?.addEventListener('click', () => openLicenseRequestModal('TRIAL_EXTEND'));
    el('openPurchaseFormModalBtn')?.addEventListener('click', () => openLicenseRequestModal('PURCHASE_LICENSE'));
    el('watchExpiredOpenRequestBtn')?.addEventListener('click', () => openLicenseRequestModal('PURCHASE_LICENSE'));
    el('closeLicenseRequestModalBtn')?.addEventListener('click', closeLicenseRequestModal);
    el('cancelLicenseRequestModalBtn')?.addEventListener('click', closeLicenseRequestModal);

    el('reqTypePurchaseBtn')?.addEventListener('click', () => setLicenseRequestTypeUI('PURCHASE_LICENSE'));
    el('reqTypeTrialExtendBtn')?.addEventListener('click', () => setLicenseRequestTypeUI('TRIAL_EXTEND'));

    el('licenseRequestForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const requestType = el('requestTypeInput')?.value || 'PURCHASE_LICENSE';
      const deviceId = (el('requestDeviceIdInput')?.value || state.watchSettings.deviceId || 'V2-88VENU20').trim().toUpperCase();
      const syncKey = (el('requestSyncKeyInput')?.value || state.syncKey || 'VENU2-88').trim().toUpperCase();
      const requestedExtendDays = Number(el('requestExtendDaysSelect')?.value || 14);
      const contactName = (el('requestContactNameInput')?.value || '').trim();
      const contactEmail = (el('requestContactEmailInput')?.value || '').trim();
      const contactPhone = (el('requestContactPhoneInput')?.value || '').trim();
      const message = (el('requestMessageInput')?.value || '').trim();
      const fb = el('licenseRequestFeedbackBox');
      const submitBtn = el('submitLicenseRequestBtn');

      if (!contactName || !contactEmail || !contactPhone) {
        if (fb) {
          fb.textContent = 'กรุณากรอกชื่อผู้ติดต่อ, อีเมล และเบอร์โทร/LINE ID ให้ครบถ้วน';
          fb.className = 'rounded-xl bg-crimson/15 ring-1 ring-crimson/35 px-3.5 py-2.5 text-xs text-crimson font-medium';
        }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch('/api/license/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType,
            deviceId,
            syncKey,
            requestedExtendDays,
            contactName,
            contactEmail,
            contactPhone,
            message
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          const errMsg = data.error || 'ไม่สามารถส่งคำขอได้ กรุณาลองอีกครั้ง';
          if (fb) {
            fb.textContent = errMsg;
            fb.className = 'rounded-xl bg-crimson/15 ring-1 ring-crimson/35 px-3.5 py-2.5 text-xs text-crimson font-medium';
          }
          showToast(errMsg);
          return;
        }

        const successMsg = data.message || `ส่งคำขอ (${data.request?.id || 'REQ'}) สำเร็จ และแจ้งเตือนไปที่ e24qdy2@gmail.com แล้ว`;
        if (fb) {
          fb.innerHTML = `✓ <strong>${escapeHtml(successMsg)}</strong><br/><span class="text-[11px] font-mono">Request ID: ${escapeHtml(data.request?.id || '')} · Email Delivery: ${escapeHtml(data.emailDelivery?.deliveryMethod || 'QUEUED')}</span>`;
          fb.className = 'rounded-xl bg-emerald/15 ring-1 ring-emerald/35 px-3.5 py-2.5 text-xs text-emerald font-medium';
        }
        showToast(successMsg);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    // Portfolio Management (Create / Rename / Delete)
    el('addPortfolioBtn').addEventListener('click', async () => {
      const name = window.prompt('ตั้งชื่อพอร์ตใหม่ (เช่น Global ETF, หุ้นปันผล, เก็งกำไร):', 'New Portfolio');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      const shortName = cleanName.slice(0, 10).toUpperCase();
      state.profile.portfolios.push({
        id: `port-${Date.now()}`,
        name: cleanName,
        shortName,
        currency: 'USD',
        items: []
      });
      state.activePortfolioIndex = state.profile.portfolios.length - 1;
      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      await savePortfolioState(`สร้างพอร์ต "${cleanName}" เรียบร้อย`);
    });

    el('renamePortfolioBtn').addEventListener('click', async () => {
      const active = getActivePortfolio();
      if (!active) return;
      const newName = window.prompt('แก้ไขชื่อพอร์ต:', active.name);
      if (!newName || !newName.trim()) return;
      active.name = newName.trim();
      active.shortName = active.name.slice(0, 10).toUpperCase();
      await savePortfolioState('อัปเดตชื่อพอร์ตเรียบร้อย');
    });

    el('deletePortfolioBtn').addEventListener('click', async () => {
      if ((state.profile?.portfolios?.length || 0) <= 1) {
        showToast('ต้องมีอย่างน้อย 1 พอร์ตในระบบ');
        return;
      }
      const active = getActivePortfolio();
      if (!window.confirm(`ยืนยันการลบพอร์ต "${active.name}" ?`)) return;
      state.profile.portfolios.splice(state.activePortfolioIndex, 1);
      state.activePortfolioIndex = 0;
      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      await savePortfolioState(`ลบพอร์ต "${active.name}" แล้ว`);
    });

    // Holding Modal Events
    el('openAddModalBtn').addEventListener('click', () => openHoldingModal(null));
    el('closeHoldingModalBtn').addEventListener('click', closeHoldingModal);
    el('cancelHoldingModalBtn').addEventListener('click', closeHoldingModal);

    el('holdingSymbolInput').addEventListener('input', e => {
      const val = e.target.value.toUpperCase();
      if (val.endsWith('.BK')) {
        el('holdingCurrencySelect').value = 'THB';
      }
    });

    el('holdingForm').addEventListener('submit', async e => {
      e.preventDefault();
      const active = getActivePortfolio();
      if (!active) return;

      const origSym = el('holdingEditOriginalSymbol').value.trim().toUpperCase();
      const sym = el('holdingSymbolInput').value.trim().toUpperCase();
      if (!sym) return;

      const newItem = {
        symbol: sym,
        name: el('holdingNameInput').value.trim(),
        currency: el('holdingCurrencySelect').value,
        shares: Number(el('holdingSharesInput').value || 0),
        avgCost: Number(el('holdingAvgCostInput').value || 0),
        targetPrice: Number(el('holdingTargetInput').value || 0),
        stopPrice: Number(el('holdingStopInput').value || 0),
        earningsDate: (el('holdingEarningsDateInput')?.value || '').trim().replace(/^e-/i, ''),
        note: el('holdingNoteInput').value.trim()
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
      await savePortfolioState(`บันทึก ${sym} เข้าพอร์ตและซิงก์ Venu 2 แล้ว`);
    });

    el('deleteHoldingBtn').addEventListener('click', async () => {
      const active = getActivePortfolio();
      const origSym = el('holdingEditOriginalSymbol').value.trim().toUpperCase();
      if (!active || !origSym) return;
      active.items = active.items.filter(x => x.symbol.toUpperCase() !== origSym);
      state.activeSymbolIndex = 0;
      closeHoldingModal();
      await savePortfolioState(`ลบ ${origSym} ออกจากพอร์ตแล้ว`);
    });

    // Live Autocomplete Search
    const searchInput = el('quickSearchInput');
    const dropdown = el('searchDropdown');

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearTimeout(state.searchTimer);
      if (!q) {
        dropdown.classList.add('hidden');
        return;
      }
      state.searchTimer = setTimeout(async () => {
        el('searchStatusBadge').textContent = 'กำลังค้นหา...';
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        el('searchStatusBadge').textContent = 'Yahoo Live';
        const results = data.results || [];
        if (results.length === 0) {
          dropdown.innerHTML = `
            <button type="button" data-custom-sym="${escapeHtml(q.toUpperCase())}" class="w-full px-4 py-3 text-left text-xs font-mono text-alabaster hover:bg-white/[0.06] flex items-center justify-between">
              <span>เพิ่มรหัสหุ้น <strong class="text-emerald">${escapeHtml(q.toUpperCase())}</strong> โดยตรง</span>
              <span class="text-cyan">+ เพิ่มลงพอร์ต</span>
            </button>
          `;
        } else {
          dropdown.innerHTML = results.map(r => `
            <button
              type="button"
              data-pick-sym="${escapeHtml(r.symbol)}"
              data-pick-name="${escapeHtml(r.name)}"
              data-pick-cur="${escapeHtml(r.currency)}"
              class="w-full px-4 py-3 text-left hover:bg-white/[0.06] flex items-center justify-between transition"
            >
              <div>
                <span class="font-mono font-bold text-sm text-alabaster">${escapeHtml(r.symbol)}</span>
                <span class="text-xs text-slate-400 ml-2">${escapeHtml(r.name)}</span>
              </div>
              <div class="flex items-center gap-2 font-mono text-[11px]">
                <span class="text-slate-400">${escapeHtml(r.exchange)}</span>
                <span class="rounded-full bg-emerald/15 text-emerald px-2 py-0.5">+ เลือก</span>
              </div>
            </button>
          `).join('');
        }
        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('[data-pick-sym], [data-custom-sym]').forEach(btn => {
          btn.addEventListener('click', () => {
            const sym = btn.getAttribute('data-pick-sym') || btn.getAttribute('data-custom-sym');
            const name = btn.getAttribute('data-pick-name') || '';
            const cur = btn.getAttribute('data-pick-cur') || (sym.endsWith('.BK') ? 'THB' : 'USD');
            dropdown.classList.add('hidden');
            searchInput.value = '';
            openHoldingModal({
              symbol: sym,
              name,
              currency: cur,
              shares: 10,
              avgCost: 0,
              targetPrice: 0,
              stopPrice: 0,
              note: ''
            });
            el('holdingEditOriginalSymbol').value = '';
            el('deleteHoldingBtn').classList.add('hidden');
          });
        });
      }, 220);
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#quickSearchInput') && !e.target.closest('#searchDropdown')) {
        dropdown.classList.add('hidden');
      }
    });

    // Garmin Venu 2 Interactive Hardware Controls
    document.querySelectorAll('.watch-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.watchMode = btn.getAttribute('data-watch-mode');
        resetAutoSwipeCountdown();
        renderGarminVenu2Watch();
      });
    });

    el('glanceLaunchBtn').addEventListener('click', () => {
      state.watchMode = 'list';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchPrevPortBtn').addEventListener('click', () => {
      const len = state.profile?.portfolios?.length || 1;
      state.activePortfolioIndex = (state.activePortfolioIndex - 1 + len) % len;
      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      resetAutoSwipeCountdown();
      renderAll();
    });

    el('watchNextPortBtn').addEventListener('click', () => {
      const len = state.profile?.portfolios?.length || 1;
      state.activePortfolioIndex = (state.activePortfolioIndex + 1) % len;
      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      resetAutoSwipeCountdown();
      renderAll();
    });

    el('watchTogglePnlModeBtn').addEventListener('click', () => {
      state.watchPnlMode = state.watchPnlMode === 'day' ? 'total' : 'day';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchBackToListBtn').addEventListener('click', () => {
      state.watchMode = 'list';
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    el('watchToggleBbBtn').addEventListener('click', () => {
      state.watchShowBb = !state.watchShowBb;
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    // Physical Top-Right Pusher (Button A: Select / Action)
    el('venuBtnTop').addEventListener('click', () => {
      if (state.watchMode === 'glance') {
        state.watchMode = 'list';
      } else if (state.watchMode === 'list') {
        state.watchPnlMode = state.watchPnlMode === 'day' ? 'total' : 'day';
      } else if (state.watchMode === 'detail') {
        state.watchShowBb = !state.watchShowBb;
      }
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    // Physical Bottom-Right Pusher (Button B: Back)
    el('venuBtnBottom').addEventListener('click', () => {
      if (state.watchMode === 'detail') {
        state.watchMode = 'list';
      } else if (state.watchMode === 'list') {
        state.watchMode = 'glance';
      } else {
        state.watchMode = 'list';
      }
      resetAutoSwipeCountdown();
      renderGarminVenu2Watch();
    });

    // Sync Key & Payload Inspector Modal
    el('openSyncModalBtn').addEventListener('click', openSyncPayloadModal);
    el('inspectPayloadBtn').addEventListener('click', () => {
      toggleIslandMenu(false);
      openSyncPayloadModal();
    });
    el('openPayloadModalFromBentoBtn').addEventListener('click', openSyncPayloadModal);
    el('closeSyncModalBtn').addEventListener('click', () => {
      el('syncModal').classList.add('hidden');
      el('syncModal').classList.remove('flex');
    });

    el('applySyncKeyBtn').addEventListener('click', async () => {
      const newKey = el('syncKeyInput').value.trim().toUpperCase();
      if (!newKey) return;
      await loadPortfolio(newKey);
      await openSyncPayloadModal();
      showToast(`สลับไปยัง Sync Key: ${newKey}`);
    });

    // Copy Watch API URL
    el('copyWatchApiBtn').addEventListener('click', async () => {
      const didParam = state.watchSettings.deviceId ? `&did=${encodeURIComponent(state.watchSettings.deviceId)}` : '';
      const url = `${window.location.origin}/api/watch?key=${state.syncKey}${didParam}`;
      await navigator.clipboard.writeText(url);
      showToast('คัดลอก Watch API URL เรียบร้อยแล้ว');
    });

    // Export JSON / CSV & Import JSON
    el('exportJsonBtn').addEventListener('click', () => {
      if (!state.profile) return;
      const blob = new Blob([JSON.stringify(state.profile, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `venu2moat-${state.syncKey.toLowerCase()}.json`;
      a.click();
      showToast('ดาวน์โหลดไฟล์ JSON สำเร็จ');
    });

    el('exportCsvBtn').addEventListener('click', () => {
      if (!state.profile) return;
      const rows = [['Portfolio', 'Symbol', 'Name', 'Currency', 'Shares', 'AvgCost', 'CurrentPrice', 'TargetPrice', 'StopPrice', 'WebMemo']];
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
            `"${(it.note || '').replace(/"/g, '""')}"`
          ]);
        }
      }
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `venu2moat-${state.syncKey.toLowerCase()}.csv`;
      a.click();
      showToast('ส่งออกตาราง CSV สำเร็จ');
    });

    el('importJsonInput').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedPortfolios = parsed.portfolios || parsed.web?.portfolios;
        if (!Array.isArray(importedPortfolios)) {
          throw new Error('โครงสร้างไฟล์ JSON ไม่ถูกต้อง');
        }
        state.profile = normalizeServerPayload(parsed);
        toggleIslandMenu(false);
        await savePortfolioState('นำเข้าพอร์ตจากไฟล์ JSON สำเร็จ');
      } catch (err) {
        showToast(err.message || 'ไม่สามารถอ่านไฟล์ JSON ได้');
      }
    });

    // Garmin 2024–2026 Watch Model Selector
    const watchModelSelect = el('watchModelSelect');
    if (watchModelSelect) {
      watchModelSelect.addEventListener('change', () => {
        state.selectedWatchModel = watchModelSelect.value || 'venu2';
        localStorage.setItem('venu2_watch_model', state.selectedWatchModel);
        applyWatchModelPreview();
        const found = state.compatibleDevices.find(d => d.id === state.selectedWatchModel);
        if (found) {
          showToast(`สลับจำลองหน้าจอเป็น ${found.name} (${formatDeviceRes(found.resolution)} ${found.displayType})`);
        }
      });
    }
  }

  function formatDeviceRes(res) {
    if (!res) return '416×416';
    if (typeof res === 'object' && res.width && res.height) {
      return `${res.width}×${res.height}`;
    }
    return String(res);
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
                `<option value="${escapeHtml(d.id)}" ${d.id === state.selectedWatchModel ? 'selected' : ''}>${escapeHtml(d.name)} (${escapeHtml(formatDeviceRes(d.resolution))} ${escapeHtml(d.displayType)})</option>`
            )
            .join('');
        }
        applyWatchModelPreview();
      }
    } catch (_) {
      applyWatchModelPreview();
    }
  }

  function applyWatchModelPreview() {
    const found =
      state.compatibleDevices.find(d => d.id === state.selectedWatchModel) || {
        id: state.selectedWatchModel || 'venu2',
        name: 'Garmin Venu 2',
        resolution: '416×416',
        displayType: 'AMOLED',
        releaseYear: '2021–2026'
      };

    const resStr = formatDeviceRes(found.resolution);
    const titleEl = el('watchHardwareTitle');
    if (titleEl) {
      titleEl.textContent = `${found.name} Hardware Preview`;
    }
    const specEl = el('watchHardwareSpecLabel');
    if (specEl) {
      specEl.textContent = `${resStr} Round ${found.displayType} · รองรับ 20 รุ่นยอดนิยม (2024–2026)`;
    }
    const cmdEl = el('sideloadCommandHint');
    if (cmdEl) {
      cmdEl.textContent = `.\\build-and-sideload.ps1 -Device ${found.id}`;
    }
    const screenEl = el('venuScreenViewport');
    if (screenEl) {
      screenEl.setAttribute(
        'aria-label',
        `หน้าจอจำลอง ${found.name} ขนาด ${resStr} พิกเซล (${found.displayType})`
      );
      if (String(found.displayType).includes('MIP')) {
        screenEl.style.filter = 'contrast(0.95) saturate(0.82)';
      } else {
        screenEl.style.filter = '';
      }
    }
  }

  function initScrollReveal() {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    document.querySelectorAll('.reveal-on-scroll').forEach(node => observer.observe(node));
  }

  function startAutoQuoteRefreshTimer() {
    if (state.quoteRefreshIntervalId) {
      clearInterval(state.quoteRefreshIntervalId);
      state.quoteRefreshIntervalId = null;
    }
    // Auto-refresh live quotes & technicals (SMA20 / RSI14) every 60 seconds
    state.quoteRefreshIntervalId = setInterval(async () => {
      if (document.hidden) return;
      const holdingModalOpen = el('holdingModal') && !el('holdingModal').classList.contains('hidden');
      const portfolioModalOpen = el('portfolioModal') && !el('portfolioModal').classList.contains('hidden');
      if (holdingModalOpen || portfolioModalOpen) return;
      try {
        await loadPortfolio(state.syncKey);
      } catch (_) {
        // Ignore transient network errors during background poll
      }
    }, 60_000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initScrollReveal();
    bindEvents();
    await loadCompatibleGarminDevices();
    await loadPortfolio(state.syncKey);
    startAutoQuoteRefreshTimer();
  });
})();
