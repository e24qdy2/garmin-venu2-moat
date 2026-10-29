/* ============================================================================
 * MoatWatchSimulator — Deep Module for Garmin Watch (AMOLED & MIP)
 * Virtual Watch Simulator, Data Normalization, Sorting & Technical Sparkline
 * ============================================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MoatWatchSimulator = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function el(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  function formatDeviceRes(res) {
    if (!res) return '416×416';
    if (typeof res === 'object' && res.width && res.height) {
      return `${res.width}×${res.height}`;
    }
    return String(res);
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

  function getFearGreedZoneStyle(rawScore) {
    const score = Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(rawScore)) ? Number(rawScore) : 64)));
    if (score <= 24) {
      return {
        score,
        code: 'EF',
        rating: 'Extreme Fear',
        ratingTh: 'Extreme Fear',
        badge: `FG:${score}EF`,
        textClass: 'text-crimson',
        badgeClass: 'bg-crimson/15 text-crimson ring-1 ring-crimson/35',
        barColor: '#F43F5E'
      };
    }
    if (score <= 44) {
      return {
        score,
        code: 'F',
        rating: 'Fear',
        ratingTh: 'Fear',
        badge: `FG:${score}F`,
        textClass: 'text-amber',
        badgeClass: 'bg-amber/15 text-amber ring-1 ring-amber/35',
        barColor: '#F59E0B'
      };
    }
    if (score <= 55) {
      return {
        score,
        code: 'N',
        rating: 'Neutral',
        ratingTh: 'Neutral',
        badge: `FG:${score}N`,
        textClass: 'text-cyan',
        badgeClass: 'bg-cyan/15 text-cyan ring-1 ring-cyan/35',
        barColor: '#38BDF8'
      };
    }
    if (score <= 74) {
      return {
        score,
        code: 'G',
        rating: 'Greed',
        ratingTh: 'Greed',
        badge: `FG:${score}G`,
        textClass: 'text-emerald',
        badgeClass: 'bg-emerald/15 text-emerald ring-1 ring-emerald/35',
        barColor: '#34D399'
      };
    }
    return {
      score,
      code: 'EG',
      rating: 'Extreme Greed',
      ratingTh: 'Extreme Greed',
      badge: `FG:${score}EG`,
      textClass: 'text-emerald font-extrabold',
      badgeClass: 'bg-emerald/25 text-emerald ring-1 ring-emerald/50 font-extrabold',
      barColor: '#10B981'
    };
  }

  function getEffectiveSortPct(item, sortMetric) {
    const metric = String(sortMetric || 'DAY').toUpperCase();
    if (metric === 'TOTAL' && Number(item?.shares || 0) > 0) {
      return Number(item.unrealizedPnlPct ?? item.changePct ?? 0);
    }
    return Number(item?.changePct ?? 0);
  }

  function sortPortfolioItems(items, sortOrder = 'ASC', sortMetric = 'DAY') {
    if (!Array.isArray(items)) return [];
    const cleanOrder = String(sortOrder || 'ASC').toUpperCase();
    const cleanMetric = String(sortMetric || 'DAY').toUpperCase();
    return items.sort((a, b) => {
      if (cleanOrder === 'NONE') {
        return (a.origIdx ?? 0) - (b.origIdx ?? 0);
      }
      const valA = getEffectiveSortPct(a, cleanMetric);
      const valB = getEffectiveSortPct(b, cleanMetric);
      if (valA === valB) return (a.origIdx ?? 0) - (b.origIdx ?? 0);
      return cleanOrder === 'ASC' ? valA - valB : valB - valA;
    });
  }

  /**
   * Normalizes server payload ({ web, watch }) into the unified UI profile model
   */
  function normalizeServerPayload(raw, fallbackSyncKey = 'VENU2-88') {
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
        const spark =
          Array.isArray(h.sparkline) && h.sparkline.length > 0
            ? h.sparkline
            : [h.prevClose || 100, h.price || 100];
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

    const effectiveSyncKey = String(web.syncKey || fallbackSyncKey || 'VENU2-88').trim().toUpperCase();
    const fallbackDid = effectiveSyncKey === 'VENU2-88' ? 'V2-88VENU20' : effectiveSyncKey;
    const rawSortOrder = String(web.watchSettings?.sortByPctOrder || 'ASC').toUpperCase();
    const rawSortMetric = String(web.watchSettings?.sortByPctMetric || 'DAY').toUpperCase();
    const watchSettings = {
      autoSwipeEnabled: Boolean(web.watchSettings?.autoSwipeEnabled ?? true),
      autoSwipeSec: Math.max(2, Math.min(120, Number(web.watchSettings?.autoSwipeSec || 5))),
      alwaysOnDisplay: Boolean(web.watchSettings?.alwaysOnDisplay ?? false),
      sortByPctOrder: ['ASC', 'DESC', 'NONE'].includes(rawSortOrder) ? rawSortOrder : 'ASC',
      sortByPctMetric: ['DAY', 'TOTAL'].includes(rawSortMetric) ? rawSortMetric : 'DAY',
      deviceId: web.watchSettings?.deviceId || fallbackDid,
      activationKey: web.watchSettings?.activationKey || ''
    };

    const rawFg = web.fearGreed || raw?.watch?.fg || {};
    const fgZone = getFearGreedZoneStyle(rawFg.score ?? rawFg.s ?? 64);
    const fgPrevClose = Number.isFinite(Number(rawFg.prevClose)) ? Math.round(Number(rawFg.prevClose)) : fgZone.score;
    const fearGreed = {
      score: fgZone.score,
      prevClose: fgPrevClose,
      change: Number.isFinite(Number(rawFg.change)) ? Math.round(Number(rawFg.change)) : fgZone.score - fgPrevClose,
      code: rawFg.code || rawFg.c || fgZone.code,
      rating: rawFg.rating || fgZone.rating,
      ratingTh: rawFg.ratingTh || fgZone.ratingTh,
      badge: rawFg.badge || rawFg.b || fgZone.badge,
      source: rawFg.source || 'US_MARKET'
    };

    return {
      syncKey: effectiveSyncKey,
      baseCurrency: web.baseCurrency || 'THB',
      usdThbRate: Number(web.usdThbRate || 34.45),
      fetchedAt: web.updatedAt || new Date().toISOString(),
      watchSettings,
      license: web.license || null,
      fearGreed,
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

  function buildWatchHoldingRowHtml(it, idx, activeSymbolIndex = 0) {
    const symShort = String(it.symbol || '').replace('.BK', '');
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
          idx === activeSymbolIndex
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
  }

  function drawWatchSparkline(item, showBb = true, customCanvas = null) {
    const canvas = customCanvas || el('watchSparklineCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const series =
      item.sparkline && item.sparkline.length > 1
        ? item.sparkline
        : [item.prevClose || 100, item.price || 100];
    const sma = item.smaSeries && item.smaSeries.length === series.length ? item.smaSeries : [];
    const bbU = item.bbUpperSeries && item.bbUpperSeries.length === series.length ? item.bbUpperSeries : [];
    const bbL = item.bbLowerSeries && item.bbLowerSeries.length === series.length ? item.bbLowerSeries : [];

    const allVals = [...series, ...sma];
    if (item.dayLow > 0) allVals.push(item.dayLow);
    if (item.dayHigh > 0) allVals.push(item.dayHigh);
    if (showBb) {
      allVals.push(...bbU, ...bbL);
    }
    if (item.targetPrice > 0) allVals.push(item.targetPrice);

    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    const span = maxVal - minVal || 1;
    const padY = 6;

    const toX = idx => (idx / (series.length - 1)) * (w - 8) + 4;
    const toY = val => h - padY - ((val - minVal) / span) * (h - padY * 2);

    if (showBb && bbU.length === series.length && bbL.length === series.length) {
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

  function renderGarminVenu2Watch(state, callbacks = {}) {
    const p = state?.profile;
    if (!p || typeof document === 'undefined') return;

    const baseCur = p.baseCurrency || 'THB';
    const now = new Date();
    const clockStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (el('watchGlanceClock')) el('watchGlanceClock').textContent = clockStr;
    if (el('watchListClock')) el('watchListClock').textContent = clockStr;
    if (el('watchListSyncKey')) el('watchListSyncKey').textContent = p.syncKey;

    const isTrialExpired = Boolean(state.license?.isExpired);
    const expiredView = el('watchViewExpired');
    const expDid = el('watchExpiredDeviceId');
    if (expDid) {
      expDid.textContent = state.license?.deviceId || state.watchSettings?.deviceId || p.syncKey;
    }
    const expEmail = el('watchExpiredOwnerEmail');
    if (expEmail) {
      expEmail.textContent = state.license?.ownerEmail || 'saharat.bun@icloud.com';
    }

    if (isTrialExpired && expiredView) {
      el('watchViewGlance')?.classList.add('hidden');
      el('watchViewList')?.classList.add('hidden');
      el('watchViewDetail')?.classList.add('hidden');
      expiredView.classList.remove('hidden');
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

    el('watchViewGlance')?.classList.toggle('hidden', state.watchMode !== 'glance');
    el('watchViewList')?.classList.toggle('hidden', state.watchMode !== 'list');
    el('watchViewDetail')?.classList.toggle('hidden', state.watchMode !== 'detail');

    // 1. Render Glance Widget View
    const s = p.summary || {};
    if (el('glanceNetWorth')) el('glanceNetWorth').textContent = formatMoney(s.totalValueBase, baseCur);
    const gDayPos = (s.dayPnlBase || 0) >= 0;
    if (el('glanceDayPnl')) {
      el('glanceDayPnl').textContent = formatSignedMoney(s.dayPnlBase, baseCur, true);
      el('glanceDayPnl').className = `text-xs font-bold tabular-nums ${gDayPos ? 'text-emerald' : 'text-crimson'}`;
    }
    if (el('glanceDayPct')) {
      el('glanceDayPct').textContent = formatSignedPct(s.dayPnlPct);
      el('glanceDayPct').className = `text-[11px] tabular-nums ${gDayPos ? 'text-emerald/80' : 'text-crimson/80'}`;
    }
    el('glanceAlertDot')?.classList.toggle('hidden', !(s.activeAlertCount > 0));

    // 2. Render Main Portfolio & Holdings List View
    const list = p.portfolios || [];
    const activePort = list[state.activePortfolioIndex] || list[0] || null;
    if (!activePort) return;

    if (el('watchPortShortName')) {
      el('watchPortShortName').textContent = activePort.shortName || activePort.name.toUpperCase();
    }
    if (el('watchPortTotalVal')) {
      el('watchPortTotalVal').textContent = formatMoney(activePort.totalValueBase, baseCur);
    }

    const showingDay = state.watchPnlMode === 'day';
    const deltaVal = showingDay ? activePort.dayPnlBase : activePort.unrealizedPnlBase;
    const deltaPct = showingDay ? activePort.dayPnlPct : activePort.unrealizedPnlPct;
    const deltaPos = (deltaVal || 0) >= 0;

    if (el('watchPortPnlModeLabel')) {
      el('watchPortPnlModeLabel').textContent = showingDay ? 'DAY:' : 'TOTAL:';
    }
    if (el('watchPortDeltaText')) {
      el('watchPortDeltaText').textContent = `${formatSignedMoney(deltaVal, baseCur, true)} (${formatSignedPct(deltaPct)})`;
      el('watchPortDeltaText').className = `font-semibold tabular-nums ${deltaPos ? 'text-emerald' : 'text-crimson'}`;
    }
    const fgStyle = getFearGreedZoneStyle(p.fearGreed?.score ?? 64);
    if (el('watchPortFgBadge')) {
      el('watchPortFgBadge').textContent = p.fearGreed?.badge || fgStyle.badge;
      el('watchPortFgBadge').className = `font-bold tabular-nums ${fgStyle.textClass}`;
    }

    const watchListEl = el('watchHoldingsList');
    if (watchListEl) {
      watchListEl.innerHTML = (activePort.items || [])
        .map((it, idx) => buildWatchHoldingRowHtml(it, idx, state.activeSymbolIndex))
        .join('');

      watchListEl.querySelectorAll('.watch-holding-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const pickedIdx = Number(btn.getAttribute('data-watch-item-idx'));
          if (typeof callbacks.onSelectSymbol === 'function') {
            callbacks.onSelectSymbol(pickedIdx);
          }
        });
      });
    }

    // Portfolio carousel dots
    if (el('watchPortDots')) {
      el('watchPortDots').innerHTML = (p.portfolios || [])
        .map(
          (_, idx) => `
          <span class="h-1.5 rounded-full transition-all ${
            idx === state.activePortfolioIndex ? 'w-4 bg-cyan' : 'w-1.5 bg-white/20'
          }"></span>
        `
        )
        .join('');
    }

    // 3. Render Symbol Detail + Sparkline + SMA/Bollinger + WebMemo View
    const items = activePort.items || [];
    if (items.length === 0) return;
    const item = items[state.activeSymbolIndex] || items[0];
    if (!item) return;

    if (el('watchDetailSymbol')) el('watchDetailSymbol').textContent = item.symbol.replace('.BK', '');
    if (el('watchDetailPrice')) el('watchDetailPrice').textContent = formatMoney(item.price, item.currency);

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
    if (el('watchDetailChange')) {
      el('watchDetailChange').textContent = `${formatSignedMoney(item.change, item.currency)} (${formatSignedPct(item.changePct)})`;
      el('watchDetailChange').className = `text-xs font-semibold tabular-nums ${dPos ? 'text-emerald' : 'text-crimson'}`;
    }

    const badge = el('watchDetailAlertBadge');
    if (badge) {
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
    }

    if (el('watchChartLowLabel')) {
      el('watchChartLowLabel').textContent = `Day L: ${formatMoney(item.dayLow ?? item.low, item.currency)}`;
    }
    if (el('watchChartHighLabel')) {
      el('watchChartHighLabel').textContent = `Day H: ${formatMoney(item.dayHigh ?? item.high, item.currency)}`;
    }
    const itemSmaPct = Number(item.smaPct ?? (item.sma20 > 0 ? ((item.price - item.sma20) / item.sma20) * 100 : 0));
    if (el('watchToggleBbBtn')) {
      el('watchToggleBbBtn').textContent = `SMA20: ${formatCompactPrice(item.sma20 || item.price, item.currency)} (${formatSignedPct(itemSmaPct, 1)}) · RSI14: ${Math.round(item.rsi14 ?? 50)}${state.watchShowBb ? ' · BB' : ''}`;
    }

    if (item.shares > 0) {
      if (el('watchDetailPos')) el('watchDetailPos').textContent = `${item.shares} @ ${formatMoney(item.avgCost, item.currency)}`;
      const uPos = (item.unrealizedPnlPct || 0) >= 0;
      if (el('watchDetailPnl')) {
        el('watchDetailPnl').textContent = `${formatSignedPct(item.unrealizedPnlPct)}`;
        el('watchDetailPnl').className = `font-semibold ml-1 ${uPos ? 'text-emerald' : 'text-crimson'}`;
      }
    } else {
      if (el('watchDetailPos')) el('watchDetailPos').textContent = 'Watchlist';
      if (el('watchDetailPnl')) {
        el('watchDetailPnl').textContent = '-';
        el('watchDetailPnl').className = 'text-slate-400 ml-1';
      }
    }

    if (el('watchDetailTarget')) {
      el('watchDetailTarget').textContent = item.targetPrice > 0 ? formatMoney(item.targetPrice, item.currency) : '-';
    }
    if (el('watchDetailStop')) {
      el('watchDetailStop').textContent = item.stopPrice > 0 ? formatMoney(item.stopPrice, item.currency) : '-';
    }
    if (el('watchDetailMemo')) {
      el('watchDetailMemo').textContent =
        item.note || 'No WebMemo for this asset (Click Edit on web to add a memo)';
    }

    drawWatchSparkline(item, state.watchShowBb);
  }

  function applyWatchModelPreview(state) {
    if (typeof document === 'undefined') return;
    const found =
      (state.compatibleDevices || []).find(d => d.id === state.selectedWatchModel) || {
        id: state.selectedWatchModel || 'venu2',
        name: 'Garmin Watch',
        resolution: '416×416',
        displayType: 'AMOLED',
        releaseYear: '2021–2026'
      };

    const resStr = formatDeviceRes(found.resolution);
    const titleEl = el('watchHardwareTitle');
    if (titleEl) {
      titleEl.textContent = 'Garmin Watch Hardware Preview';
    }
    const specEl = el('watchHardwareSpecLabel');
    if (specEl) {
      specEl.textContent = `${resStr} Round ${found.displayType} · Supports 20 Popular Garmin Models (2024–2026)`;
    }
    const cmdEl = el('sideloadCommandHint');
    if (cmdEl) {
      cmdEl.textContent = '.\\build-and-sideload.ps1';
    }
    const screenEl = el('venuScreenViewport');
    if (screenEl) {
      screenEl.setAttribute(
        'aria-label',
        `Virtual Garmin Watch Screen (${resStr}px ${found.displayType})`
      );
      if (String(found.displayType).includes('MIP')) {
        screenEl.style.filter = 'contrast(0.95) saturate(0.82)';
      } else {
        screenEl.style.filter = '';
      }
    }
  }

  return {
    escapeHtml,
    formatMoney,
    formatSignedMoney,
    formatSignedPct,
    formatCompactPrice,
    formatDeviceRes,
    getRsiZoneStyle,
    getFearGreedZoneStyle,
    getEffectiveSortPct,
    sortPortfolioItems,
    normalizeServerPayload,
    buildWatchHoldingRowHtml,
    drawWatchSparkline,
    renderGarminVenu2Watch,
    applyWatchModelPreview
  };
});
