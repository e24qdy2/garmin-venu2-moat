/* MoatWatch — Frontend Portfolio Manager, Auto-Swipe Engine, Always-On & License Companion
 * Delegates Virtual Watch Simulator, Normalization & Formatting to window.MoatWatchSimulator
 */

(() => {
  const {
    escapeHtml,
    formatMoney,
    formatSignedMoney,
    formatSignedPct,
    formatDeviceRes,
    getRsiZoneStyle,
    getFearGreedZoneStyle,
    getEffectiveSortPct,
    sortPortfolioItems,
    normalizeServerPayload: rawNormalizeServerPayload,
    renderGarminVenu2Watch: rawRenderGarminVenu2Watch,
    applyWatchModelPreview: rawApplyWatchModelPreview
  } = window.MoatWatchSimulator;

  function generateRandomSyncKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const rand = new Uint8Array(6);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(rand);
      for (let i = 0; i < 6; i++) {
        code += alphabet[rand[i] % alphabet.length];
      }
    } else {
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    }
    return `V2-${code}`;
  }

  function resolveInitialSyncKey() {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlKey = (params.get('key') || params.get('syncKey') || '').trim().toUpperCase();
      if (urlKey) {
        localStorage.setItem('venu2_sync_key', urlKey);
        localStorage.setItem('venu2_sync_key_isolated', '1');
        return urlKey;
      }
    } catch (_) {
      // Ignore URL parsing errors
    }

    const stored = (localStorage.getItem('venu2_sync_key') || '').trim().toUpperCase();
    const isIsolated = localStorage.getItem('venu2_sync_key_isolated') === '1';
    if (stored && (isIsolated || stored !== 'VENU2-88')) {
      localStorage.setItem('venu2_sync_key_isolated', '1');
      return stored;
    }

    const generated = generateRandomSyncKey();
    localStorage.setItem('venu2_sync_key', generated);
    localStorage.setItem('venu2_sync_key_isolated', '1');
    return generated;
  }

  const initialSyncKey = resolveInitialSyncKey();

  const state = {
    syncKey: initialSyncKey,
    selectedWatchModel: localStorage.getItem('garmin_watch_model') || 'garmin',
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
      sortByPctOrder: 'ASC', // 'ASC' (Loss -> Gain) | 'DESC' (Gain -> Loss) | 'NONE' (Manual)
      sortByPctMetric: 'DAY', // 'DAY' (Today's % Change) | 'TOTAL' (Total Return %)
      deviceId: initialSyncKey === 'VENU2-88' ? 'V2-88VENU20' : initialSyncKey,
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

  function normalizeServerPayload(raw) {
    return rawNormalizeServerPayload(raw, state.syncKey);
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
      sortPortfolioItems(port.items, sortOrder, sortMetric);
    });
  }

  function renderGarminVenu2Watch() {
    rawRenderGarminVenu2Watch(state, {
      onSelectSymbol(pickedIdx) {
        state.activeSymbolIndex = pickedIdx;
        state.watchMode = 'detail';
        resetAutoSwipeCountdown();
        renderAll();
      }
    });
  }

  function applyWatchModelPreview() {
    rawApplyWatchModelPreview(state);
  }

  async function loadPortfolio(syncKey = state.syncKey) {
    const cleanKey = String(syncKey || state.syncKey || generateRandomSyncKey()).trim().toUpperCase();
    state.syncKey = cleanKey;
    localStorage.setItem('venu2_sync_key', cleanKey);
    localStorage.setItem('venu2_sync_key_isolated', '1');

    const res = await fetch(`/api/portfolio?key=${encodeURIComponent(cleanKey)}`);
    if (!res.ok) throw new Error('Unable to load portfolio data');
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

  async function savePortfolioState(toastText = 'Portfolio and settings synced to Garmin') {
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
    if (!res.ok) throw new Error('Unable to save portfolio');
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
     AUTO-SWIPE ENGINE FOR GARMIN WATCH SIMULATOR (DEFAULT 5s / CUSTOM SEC)
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
      if (state.activeSymbolIndex + 1 < items.length) {
        state.activeSymbolIndex += 1;
      } else {
        state.activePortfolioIndex = (state.activePortfolioIndex + 1) % portfolios.length;
        state.activeSymbolIndex = 0;
      }
      renderAll();
      return;
    }

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
          sortModeBadge.textContent = `▲ Loss → Gain (${mShort})`;
          sortModeBadge.className = 'text-crimson font-semibold';
        } else if (activeSortOrder === 'DESC') {
          sortModeBadge.textContent = `▼ Gain → Loss (${mShort})`;
          sortModeBadge.className = 'text-emerald font-semibold';
        } else {
          sortModeBadge.textContent = '• Manual Order';
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
          sortTopBottomText.textContent = `Top: ${first.symbol} (${firstPct}) → Bottom: ${last.symbol} (${lastPct})`;
        } else {
          sortTopBottomText.textContent = 'No holdings in this portfolio yet';
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
          expiryText.innerHTML = `Device <strong class="font-mono text-cyan">${escapeHtml(lic.deviceId)}</strong> is permanently unlocked (Lifetime Pro Edition)`;
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
          expiryText.innerHTML = `<span class="text-crimson font-semibold">14-Day Free Trial Expired</span> · Contact app owner for Pro activation at <a href="mailto:${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}" class="font-mono font-bold text-amber underline">${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}</a>`;
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
          expiryText.innerHTML = `14-Day Free Trial (<strong class="font-mono text-emerald">${lic.remainingDays} days remaining</strong>) · For Lifetime Pro contact <strong class="font-mono text-amber">${escapeHtml(lic.ownerEmail || 'saharat.bun@icloud.com')}</strong>`;
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
    const syncKeyInputEl = el('syncKeyInput');
    if (syncKeyInputEl && document.activeElement !== syncKeyInputEl) {
      syncKeyInputEl.value = p.syncKey;
    }
    const personalUrlEl = el('personalProfileUrlLabel');
    if (personalUrlEl) personalUrlEl.textContent = `/?key=${p.syncKey}`;
    const modalWatchEpEl = el('modalWatchEndpointLabel');
    if (modalWatchEpEl) modalWatchEpEl.textContent = `/api/watch?key=${p.syncKey}${didParam}`;
    const reqDidEl = el('requestDeviceIdInput');
    if (reqDidEl && document.activeElement !== reqDidEl) {
      reqDidEl.value = state.license?.deviceId || state.watchSettings.deviceId || p.syncKey;
    }
    const reqKeyEl = el('requestSyncKeyInput');
    if (reqKeyEl && document.activeElement !== reqKeyEl) {
      reqKeyEl.value = p.syncKey;
    }

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

    const fg = p.fearGreed || {};
    const fgStyle = getFearGreedZoneStyle(fg.score ?? 64);
    const fgBadgeEl = el('fearGreedBadge');
    if (fgBadgeEl) {
      fgBadgeEl.textContent = fg.badge || fgStyle.badge;
      fgBadgeEl.className = `px-2 py-0.5 rounded-full font-bold tabular-nums ${fgStyle.badgeClass}`;
    }
    const fgLabelEl = el('fearGreedLabel');
    if (fgLabelEl) {
      fgLabelEl.textContent = `${fg.rating || fgStyle.rating}`;
      fgLabelEl.className = `font-semibold ${fgStyle.textClass}`;
    }
    const fgPrevEl = el('fearGreedPrevText');
    if (fgPrevEl) {
      const diff = Number(fg.change ?? 0);
      const diffSign = diff > 0 ? '+' : '';
      fgPrevEl.textContent = `Prev: ${fg.prevClose ?? fgStyle.score} (${diffSign}${diff})`;
    }
    const fgBarEl = el('fearGreedBarFill');
    if (fgBarEl) {
      fgBarEl.style.width = `${fgStyle.score}%`;
      fgBarEl.style.backgroundColor = fgStyle.barColor;
    }

    const fetchedDate = p.fetchedAt ? new Date(p.fetchedAt) : new Date();
    const hh = String(fetchedDate.getHours()).padStart(2, '0');
    const mm = String(fetchedDate.getMinutes()).padStart(2, '0');
    const ss = String(fetchedDate.getSeconds()).padStart(2, '0');
    el('lastUpdatedBadge').textContent = `Last synced ${hh}:${mm}:${ss}`;

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
    el('portfolioCountSummary').textContent = `${s.portfolioCount || 0} Portfolios · ${s.holdingCount || 0} Assets`;
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
    el('activePortfolioMeta').textContent = `Garmin Watch Label: ${active.shortName || active.name.toUpperCase()} · ${active.items.length} Assets`;
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
          <p class="text-sm font-semibold text-alabaster mb-1">No assets in this portfolio yet</p>
          <p class="text-xs text-slate-400 mb-4">Use the quick search bar above or click "Add Asset" to start building your Garmin portfolio</p>
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
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-emerald/20 ring-1 ring-emerald/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald">▲ Target Hit ${formatMoney(item.targetPrice, item.currency)}</span>`;
      } else if (item.alert?.status === 'STOP_BREACH') {
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-crimson/20 ring-1 ring-crimson/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-crimson">▼ Stop Breach ${formatMoney(item.stopPrice, item.currency)}</span>`;
      } else if (item.alert?.status === 'NEAR_TARGET') {
        alertBadgeHtml = `<span class="inline-flex items-center gap-1 rounded-full bg-amber/20 ring-1 ring-amber/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber">● Near Target (${item.alert.distancePct}%)</span>`;
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
                  ${item.earningsBadge ? `<span class="rounded-full bg-amber/15 text-amber ring-1 ring-amber/30 px-2 py-0.5 font-mono text-[10px] font-semibold" title="Next Earnings Date">${escapeHtml(item.earningsBadge)}</span>` : ''}
                  ${isWatchlistOnly ? '<span class="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-slate-400">WATCHLIST</span>' : ''}
                  ${alertBadgeHtml}
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
                  ${
                    isWatchlistOnly
                      ? `<span>Watchlist Mode (0 shares)</span>`
                      : `<span>Position: <strong class="text-slate-200">${item.shares}</strong> @ Avg ${formatMoney(item.avgCost, item.currency)}</span>
                         <span>·</span>
                         <span>Weight: <strong class="text-cyan">${item.allocationPct}%</strong></span>`
                  }
                  <span>·</span>
                  <span class="text-cyan">SMA20: <strong>${formatMoney(item.sma20, item.currency)}</strong> <span class="${(item.smaPct || 0) >= 0 ? 'text-emerald' : 'text-crimson'}">(${formatSignedPct(item.smaPct, 1)})</span></span>
                  <span>·</span>
                  <span class="${getRsiZoneStyle(item.rsi14).textClass}" title="14-Day RSI (${getRsiZoneStyle(item.rsi14).zoneLabel})">RSI14: <strong>${Number(item.rsi14 ?? 50).toFixed(1)}</strong></span>
                  <span>·</span>
                  <span>Day L: <strong class="text-crimson/90">${formatMoney(item.dayLow ?? item.low, item.currency)}</strong> / H: <strong class="text-emerald/90">${formatMoney(item.dayHigh ?? item.high, item.currency)}</strong></span>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between sm:justify-end gap-5 font-mono text-right">
              <div>
                <div class="text-xs text-slate-400">Market Price</div>
                <div class="text-sm sm:text-base font-bold text-alabaster tabular-nums">
                  ${formatMoney(item.price, item.currency)}
                </div>
                <div class="text-xs font-semibold tabular-nums ${dayPos ? 'text-emerald' : 'text-crimson'}">
                  ${formatSignedMoney(item.change, item.currency)} (${formatSignedPct(item.changePct)})
                </div>
              </div>

              <div class="min-w-[105px]">
                <div class="text-xs text-slate-400">${isWatchlistOnly ? 'Target / Stop' : 'Value / Total P&L'}</div>
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
                title="Edit Shares / Avg Cost / WebMemo Note"
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
                   <span class="text-[10px] font-mono text-slate-500 hidden sm:inline">Click to preview on Garmin →</span>
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
     MODALS, AUTOCOMPLETE SEARCH & INTERACTION HANDLERS
     ========================================================================== */
  function openHoldingModal(existingItem = null) {
    const modal = el('holdingModal');
    const delBtn = el('deleteHoldingBtn');

    if (existingItem) {
      el('holdingModalTitle').textContent = `Edit ${existingItem.symbol} & WebMemo`;
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
      el('holdingModalTitle').textContent = 'Add New Asset to Portfolio';
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
    const urlLabel = el('personalProfileUrlLabel');
    if (urlLabel) {
      urlLabel.textContent = `${window.location.origin}/?key=${state.syncKey}`;
    }
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

  function bindEvents() {
    el('menuToggleBtn').addEventListener('click', () => toggleIslandMenu());
    el('islandMenuOverlay').addEventListener('click', e => {
      if (e.target === el('islandMenuOverlay')) toggleIslandMenu(false);
    });

    // Base Currency Switch
    el('curThbBtn').addEventListener('click', async () => {
      if (!state.profile || state.profile.baseCurrency === 'THB') return;
      state.profile.baseCurrency = 'THB';
      await savePortfolioState('Base currency switched to THB (฿)');
    });
    el('curUsdBtn').addEventListener('click', async () => {
      if (!state.profile || state.profile.baseCurrency === 'USD') return;
      state.profile.baseCurrency = 'USD';
      await savePortfolioState('Base currency switched to USD ($)');
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
          showToast('Market quotes and FX rates refreshed');
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
            ? `Auto-Swipe enabled (every ${state.watchSettings.autoSwipeSec}s)`
            : 'Auto-Swipe disabled'
        );
      });
    }

    document.querySelectorAll('.swipe-preset-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sec = Number(btn.getAttribute('data-swipe-preset')) || 5;
        state.watchSettings.autoSwipeEnabled = true;
        state.watchSettings.autoSwipeSec = sec;
        await savePortfolioState(`Auto-Swipe interval set to ${sec}s`);
      });
    });

    const autoSwipeSecInput = el('autoSwipeSecInput');
    if (autoSwipeSecInput) {
      autoSwipeSecInput.addEventListener('change', async () => {
        const sec = Math.max(2, Math.min(120, Math.round(Number(autoSwipeSecInput.value) || 5)));
        autoSwipeSecInput.value = sec;
        state.watchSettings.autoSwipeSec = sec;
        await savePortfolioState(`Custom Auto-Swipe interval set to ${sec}s`);
      });
    }

    const alwaysOnToggle = el('alwaysOnToggle');
    if (alwaysOnToggle) {
      alwaysOnToggle.addEventListener('change', async () => {
        state.watchSettings.alwaysOnDisplay = alwaysOnToggle.checked;
        await savePortfolioState(
          alwaysOnToggle.checked
            ? 'Always-On Display enabled (screen stays awake while viewing app)'
            : 'Always-On Display disabled (standard battery saver)'
        );
      });
    }

    function getSortOrderLabel(order, metric) {
      const mLabel = metric === 'TOTAL' ? 'Total P&L %' : 'Today % Change';
      if (order === 'ASC') return `Sorted by ${mLabel}: ▲ Loss → Gain (Top-to-Bottom)`;
      if (order === 'DESC') return `Sorted by ${mLabel}: ▼ Gain → Loss (Top-to-Bottom)`;
      return 'Sorted by Manual Order (As Added)';
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
        await savePortfolioState(`Garmin Watch Device ID synced: ${cleanId}`);
      });
    }

    const activateDeviceBtn = el('activateDeviceBtn');
    if (activateDeviceBtn) {
      activateDeviceBtn.addEventListener('click', async () => {
        const devId = (el('watchDeviceIdInput')?.value || state.watchSettings.deviceId || 'V2-88VENU20').trim().toUpperCase();
        const actKey = (el('activationKeyInput')?.value || '').trim().toUpperCase();
        if (!actKey) {
          showToast('Please enter an Activation Key (MOAT-XXXX-XXXX-XXXX)');
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
          showToast(data.error || 'Invalid Activation Key. Please contact saharat.bun@icloud.com');
          return;
        }
        if (data.payload) {
          state.profile = normalizeServerPayload(data.payload);
          state.watchSettings = { ...state.profile.watchSettings };
          state.license = state.profile.license;
          renderAll();
        }
        showToast(data.message || `Device ${devId} activated successfully!`);
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
        if (titleEl) titleEl.textContent = 'Request Free Trial Extension';
        if (msgInput && !msgInput.value.trim()) {
          msgInput.placeholder = 'Please share your reason for requesting a free trial extension for Admin review...';
        }
      } else {
        if (purchaseBtn) {
          purchaseBtn.className = 'req-type-btn rounded-xl bg-cyan/20 ring-1 ring-cyan/50 px-3 py-2.5 text-xs font-bold text-cyan flex items-center justify-center gap-1.5 spring-transition';
        }
        if (trialBtn) {
          trialBtn.className = 'req-type-btn rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2.5 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 spring-transition';
        }
        if (extendDaysWrap) extendDaysWrap.classList.add('opacity-40');
        if (titleEl) titleEl.textContent = 'Purchase Lifetime Pro License';
        if (msgInput && !msgInput.value.trim()) {
          msgInput.placeholder = 'Let us know you would like to purchase a Lifetime Pro Activation Key and your preferred contact time...';
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
          fb.textContent = 'Please complete your Contact Name, Email, and Phone / LINE ID.';
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
          const errMsg = data.error || 'Unable to submit request. Please try again.';
          if (fb) {
            fb.textContent = errMsg;
            fb.className = 'rounded-xl bg-crimson/15 ring-1 ring-crimson/35 px-3.5 py-2.5 text-xs text-crimson font-medium';
          }
          showToast(errMsg);
          return;
        }

        const successMsg = data.message || `Request (${data.request?.id || 'REQ'}) submitted and notified to e24qdy2@gmail.com`;
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
      const name = window.prompt('Enter new portfolio name (e.g. Global ETF, Dividend Moat, Crypto):', 'New Portfolio');
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
      await savePortfolioState(`Created portfolio "${cleanName}"`);
    });

    el('renamePortfolioBtn').addEventListener('click', async () => {
      const active = getActivePortfolio();
      if (!active) return;
      const newName = window.prompt('Rename portfolio:', active.name);
      if (!newName || !newName.trim()) return;
      active.name = newName.trim();
      active.shortName = active.name.slice(0, 10).toUpperCase();
      await savePortfolioState('Portfolio name updated');
    });

    el('deletePortfolioBtn').addEventListener('click', async () => {
      if ((state.profile?.portfolios?.length || 0) <= 1) {
        showToast('At least 1 portfolio must remain');
        return;
      }
      const active = getActivePortfolio();
      if (!window.confirm(`Delete portfolio "${active.name}"?`)) return;
      state.profile.portfolios.splice(state.activePortfolioIndex, 1);
      state.activePortfolioIndex = 0;
      state.activeSymbolIndex = 0;
      state.watchScrollOffset = 0;
      await savePortfolioState(`Deleted portfolio "${active.name}"`);
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
      await savePortfolioState(`Saved ${sym} and synced to Garmin`);
    });

    el('deleteHoldingBtn').addEventListener('click', async () => {
      const active = getActivePortfolio();
      const origSym = el('holdingEditOriginalSymbol').value.trim().toUpperCase();
      if (!active || !origSym) return;
      active.items = active.items.filter(x => x.symbol.toUpperCase() !== origSym);
      state.activeSymbolIndex = 0;
      closeHoldingModal();
      await savePortfolioState(`Removed ${origSym} from portfolio`);
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
        el('searchStatusBadge').textContent = 'Searching...';
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        el('searchStatusBadge').textContent = 'Yahoo Live';
        const results = data.results || [];
        if (results.length === 0) {
          dropdown.innerHTML = `
            <button type="button" data-custom-sym="${escapeHtml(q.toUpperCase())}" class="w-full px-4 py-3 text-left text-xs font-mono text-alabaster hover:bg-white/[0.06] flex items-center justify-between">
              <span>Add ticker <strong class="text-emerald">${escapeHtml(q.toUpperCase())}</strong> directly</span>
              <span class="text-cyan">+ Add to Portfolio</span>
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
                <span class="rounded-full bg-emerald/15 text-emerald px-2 py-0.5">+ Select</span>
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

    // Garmin Watch Interactive Hardware Controls
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
      showToast(`Switched to Sync Key: ${newKey}`);
    });

    el('createNewSyncKeyBtn')?.addEventListener('click', async () => {
      const freshKey = generateRandomSyncKey();
      el('syncKeyInput').value = freshKey;
      await loadPortfolio(freshKey);
      await openSyncPayloadModal();
      showToast(`Created new private Sync Key: ${freshKey}`);
    });

    el('copyProfileUrlBtn')?.addEventListener('click', async () => {
      const url = `${window.location.origin}/?key=${encodeURIComponent(state.syncKey)}`;
      await navigator.clipboard.writeText(url);
      showToast(`Copied personal portfolio link (${state.syncKey})`);
    });

    // Copy Watch API URL
    el('copyWatchApiBtn').addEventListener('click', async () => {
      const didParam = state.watchSettings.deviceId ? `&did=${encodeURIComponent(state.watchSettings.deviceId)}` : '';
      const url = `${window.location.origin}/api/watch?key=${state.syncKey}${didParam}`;
      await navigator.clipboard.writeText(url);
      showToast('Copied Watch API URL to clipboard');
    });

    // Export JSON / CSV & Import JSON
    el('exportJsonBtn').addEventListener('click', () => {
      if (!state.profile) return;
      const blob = new Blob([JSON.stringify(state.profile, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `garminmoat-${state.syncKey.toLowerCase()}.json`;
      a.click();
      showToast('Downloaded JSON backup');
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
      a.download = `garminmoat-${state.syncKey.toLowerCase()}.csv`;
      a.click();
      showToast('Exported CSV holdings table');
    });

    el('importJsonInput').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedPortfolios = parsed.portfolios || parsed.web?.portfolios;
        if (!Array.isArray(importedPortfolios)) {
          throw new Error('Invalid JSON portfolio file structure');
        }
        state.profile = normalizeServerPayload(parsed);
        toggleIslandMenu(false);
        await savePortfolioState('Imported portfolio from JSON file');
      } catch (err) {
        showToast(err.message || 'Unable to parse JSON file');
      }
    });

    // Garmin 2024–2026 Watch Model Selector
    const watchModelSelect = el('watchModelSelect');
    if (watchModelSelect) {
      watchModelSelect.addEventListener('change', () => {
        state.selectedWatchModel = watchModelSelect.value || 'garmin';
        localStorage.setItem('garmin_watch_model', state.selectedWatchModel);
        applyWatchModelPreview();
        const found = state.compatibleDevices.find(d => d.id === state.selectedWatchModel);
        if (found) {
          showToast(`Switched preview to ${found.name} (${formatDeviceRes(found.resolution)} ${found.displayType})`);
        } else {
          showToast('Switched preview to Garmin Watch (Auto-Scale All Models)');
        }
      });
    }
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
          const defaultOpt = `<option value="garmin" ${state.selectedWatchModel === 'garmin' ? 'selected' : ''}>Garmin Watch · Auto-Scale All Models (20 Models 2024–2026)</option>`;
          selectEl.innerHTML =
            defaultOpt +
            data.devices
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
