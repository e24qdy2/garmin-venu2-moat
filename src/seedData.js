/**
 * Production Seed Data for Venu2Moat Cloudflare Worker & D1/KV Store
 * Ensures zero data loss on initial cold start or before D1/KV migration completes.
 */

const INITIAL_PORTFOLIOS_STORE = {
  "VENU2-88": {
    syncKey: "VENU2-88",
    baseCurrency: "THB",
    updatedAt: "2026-10-20T17:47:02.808Z",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: true,
      sortByPctOrder: "ASC",
      sortByPctMetric: "DAY",
      deviceId: "V2-88VENU20",
      watchModel: "venu2",
      activationKey: "MOAT-K8Y6-X9GU-R6WK"
    },
    portfolios: [
      {
        id: "us-moat",
        name: "US Core & AI Moat",
        currency: "USD",
        holdings: [
          { symbol: "NVDA", name: "NVIDIA Corp.", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "Blackwell rack ramp Q4. Trim 10 sh > $155, hold core." },
          { symbol: "MSFT", name: "Microsoft Corp.", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "Azure AI moat | Accumulate < $410." },
          { symbol: "AAPL", name: "Apple Inc.", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "Services margin expansion + cycle upgrade. Core compounder." },
          { symbol: "GOOGL", name: "Alphabet Inc", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "TSM", name: "Taiwan Semiconductor", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "AMZN", name: "Amazon.com Inc", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "META", name: "Meta Platforms", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "TSLA", name: "Tesla Inc", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "BTC-USD", name: "Bitcoin USD", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "AVGO", name: "Broadcom Inc", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "ASML", name: "ASML", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "AMD", name: "AMD", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "NFLX", name: "NFLX", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "ORCL", name: "ORCL", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "PLTR", name: "PLTR", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "LLY", name: "LLY", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "ASTS", name: "ASTS", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "BABA", name: "BABA", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "CEG", name: "CEG", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "CIFR", name: "CIFR", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "CRWV", name: "CRWV", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "EOSE", name: "EOSE", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "IREN", name: "IREN", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "LITE", name: "LITE", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "LRCX", name: "LRCX", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "MELI", name: "MELI", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "NBIS", name: "NBIS", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "NET", name: "NET", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "NVO", name: "NVO", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "OKLO", name: "OKLO", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "ONDS", name: "ONDS", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "PANW", name: "PANW", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "PL", name: "PL", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "RKLB", name: "RKLB", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "SOFI", name: "SOFI", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "SPCX", name: "SPCX", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "SPGI", name: "SPGI", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "TEM", name: "TEM", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "TMDX", name: "TMDX", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" },
          { symbol: "WDC", name: "WDC", currency: "USD", shares: 0, avgCost: 0, targetPrice: 0, stopPrice: 0, alertDir: "ABOVE", memo: "" }
        ]
      }
    ]
  }
};

const INITIAL_LICENSES_STORE = {
  ownerEmail: "saharat.bun@icloud.com",
  notifyEmail: "e24qdy2@gmail.com",
  trialDays: 14,
  adminAuth: {
    salt: "8afc87357768566c22f9d55428097c5e",
    passwordHash: "6bc377e4ee79f520056be39c161efd03b0d2b20aed9fa717342465653d8239ad3b77561bc7dd10b43638b7e16f19a855d73c613dedf5609bc10a086afbc75450",
    updatedAt: "2026-10-20T17:47:34.414Z",
    isDefaultPassword: true
  },
  devices: {
    "V2-88VENU20": {
      deviceId: "V2-88VENU20",
      label: "Garmin Watch (Primary USB Watch)",
      syncKey: "VENU2-88",
      status: "ACTIVE",
      firstSeenAt: "2026-10-20T15:32:31.129Z",
      lastSeenAt: "2026-10-20T17:59:38.388Z",
      trialStartMs: 1792513710060,
      trialExpiresMs: 1792515499371,
      activatedKey: "MOAT-K8Y6-X9GU-R6WK",
      activatedAt: "2026-10-20T17:00:07.027Z",
      issuedKey: "MOAT-K8Y6-X9GU-R6WK",
      notes: "PRO Activated (Primary Garmin Watch)"
    }
  },
  customerRequests: [
    {
      id: "REQ-61916C",
      requestType: "PURCHASE_LICENSE",
      status: "APPROVED",
      deviceId: "V2-88VENU20",
      syncKey: "VENU2-88",
      contactName: "คุณสหรัฐ (Primary Watch Owner)",
      contactEmail: "saharat.bun@icloud.com",
      contactPhone: "LINE: @moatwatch",
      requestedExtendDays: 0,
      message: "Activated PRO License for Garmin Watch (V2-88VENU20)",
      createdAt: "2026-10-20T16:21:13.727Z",
      resolvedAt: "2026-10-20T16:25:32.096Z",
      resolvedBy: "saharat.bun@icloud.com",
      resolutionNote: "Approved Purchase & Activated PRO (MOAT-K8Y6-X9GU-R6WK)"
    }
  ],
  emailLogs: [],
  auditLogs: [
    {
      id: "AUD-CF-INIT",
      timestamp: "2026-10-20T18:00:00.000Z",
      actor: "system",
      action: "CLOUDFLARE_EDGE_INIT",
      deviceId: "V2-88VENU20",
      detail: "Initialized MoatWatch Serverless Edge Store on Cloudflare"
    }
  ],
  smtpConfig: {
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPass: "",
    fromEmail: "saharat.bun@icloud.com",
    recipientEmail: "e24qdy2@gmail.com",
    enableSystemMailFallback: true,
    updatedAt: "2026-10-20T16:50:19.363Z"
  }
};

module.exports = {
  INITIAL_PORTFOLIOS_STORE,
  INITIAL_LICENSES_STORE
};
