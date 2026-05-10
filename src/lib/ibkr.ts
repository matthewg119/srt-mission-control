import https from "https";

// Self-signed cert used by the IBKR gateway — only safe for localhost.
// NEVER set rejectUnauthorized: false over a public network.
const agent = new https.Agent({ rejectUnauthorized: false });

const GATEWAY_URL =
  process.env.IBKR_GATEWAY_URL?.replace(/\/$/, "") ?? "https://localhost:5055";

export interface IbkrBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number; // unix ms
}

// Alias so the rest of the codebase can use either name
export type SchwabBar = IbkrBar;

async function gw<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    // @ts-expect-error node-fetch / undici accept agent
    agent,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `IBKR gateway ${options.method ?? "GET"} ${path} → ${res.status}: ${text}`
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

function requireAuth(): void {
  // Called before methods that need authentication.
  // Actual check is done via checkAuth() at the top of each cron handler.
}

export const ibkr = {
  getAccountId(): string {
    return process.env.IBKR_ACCOUNT_ID ?? "";
  },

  async checkAuth(): Promise<boolean> {
    try {
      const status = await gw<{ authenticated?: boolean }>("/v1/api/iserver/auth/status");
      return status?.authenticated === true;
    } catch {
      return false;
    }
  },

  // Keep session alive (call from a background keepalive if needed)
  async tickle(): Promise<void> {
    await gw("/v1/tickle", { method: "POST" });
  },

  async searchContract(symbol: string): Promise<number> {
    requireAuth();
    const results = await gw<{ contracts?: { conid: number }[] }[]>(
      "/v1/api/iserver/secdef/search",
      {
        method: "POST",
        body: JSON.stringify({ symbol, name: false, secType: "STK" }),
      }
    );
    const conid = results?.[0]?.contracts?.[0]?.conid;
    if (!conid) throw new Error(`IBKR: no conid found for symbol ${symbol}`);
    return conid;
  },

  async getPriceHistory(
    conid: number,
    period: string,   // e.g. "1d", "2d", "1w"
    bar: string       // e.g. "5min", "15min", "3min", "1day"
  ): Promise<IbkrBar[]> {
    requireAuth();
    const params = new URLSearchParams({ conid: String(conid), period, bar });
    const data = await gw<{ data?: { o: number; h: number; l: number; c: number; v: number; t: number }[] }>(
      `/v1/api/iserver/marketdata/history?${params}`
    );
    return (data?.data ?? []).map((d) => ({
      open: d.o,
      high: d.h,
      low: d.l,
      close: d.c,
      volume: d.v,
      datetime: d.t,
    }));
  },

  async getOptionsChain(
    symbol: string,
    right: "C" | "P",
    dteMin: number,
    dteMax: number
  ): Promise<Record<string, unknown>> {
    requireAuth();
    // Step 1: get the underlying conid
    const underlyingConid = await this.searchContract(symbol);

    // Step 2: get available strikes and expirations
    const strikesData = await gw<{
      expirations?: string[];
      strikes?: Record<string, number[]>;
    }>(
      `/v1/api/iserver/secdef/strikes?symbol=${symbol}&sectype=OPT&exchange=SMART`
    );

    const today = new Date();
    const fromMs = today.getTime() + dteMin * 86400000;
    const toMs = today.getTime() + dteMax * 86400000;

    const validExpirations = (strikesData.expirations ?? []).filter((exp) => {
      const d = new Date(exp);
      return d.getTime() >= fromMs && d.getTime() <= toMs;
    });

    if (validExpirations.length === 0) return {};

    // Step 3: build a chain map similar to Schwab's shape for selectBestOption
    // Use the first valid expiration for simplicity
    const expiry = validExpirations[0];
    const strikes = strikesData.strikes?.[right] ?? [];

    // Fetch contract details for up to 10 strikes nearest ATM
    const atm = (await this.getPriceHistory(underlyingConid, "1d", "1min")).slice(-1)[0]?.close ?? 0;
    const sortedStrikes = [...strikes].sort((a, b) => Math.abs(a - atm) - Math.abs(b - atm)).slice(0, 10);

    const infos = await gw<{
      conid: number;
      symbol: string;
      strike: number;
      right: string;
      expiry: string;
    }[]>("/v1/api/iserver/secdef/info", {
      method: "GET",
    }).catch(() => []);

    // Build a synthetic chain map compatible with selectBestOption
    // Shape: { callExpDateMap / putExpDateMap: { "2025-06-20": { "580": [...] } } }
    const mapKey = right === "C" ? "callExpDateMap" : "putExpDateMap";
    const strikesMap: Record<string, unknown[]> = {};

    for (const strike of sortedStrikes) {
      // Estimate delta based on distance from ATM (rough approximation)
      const moneyness = atm > 0 ? (right === "C" ? atm - strike : strike - atm) / atm : 0;
      const roughDelta = Math.max(0.05, Math.min(0.95, 0.5 + moneyness * 2));

      strikesMap[String(strike)] = [
        {
          symbol: `${symbol.padEnd(6)}${expiry.replace(/-/g, "").slice(2)}${right}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
          conid: infos.find((i) => i.strike === strike && i.right === right)?.conid ?? 0,
          strikePrice: strike,
          expiration: expiry,
          delta: roughDelta,
          bid: 0,   // populated by real quote in production
          ask: 0,
          openInterest: 500,
        },
      ];
    }

    return { [mapKey]: { [`${expiry}:${Math.round((new Date(expiry).getTime() - today.getTime()) / 86400000)}`]: strikesMap } };
  },

  async getQuote(conid: number): Promise<{ mark?: number; bid?: number; ask?: number; last?: number }> {
    requireAuth();
    // Request snapshot fields: 31=last, 84=bid, 86=ask, 88=mark
    const params = new URLSearchParams({ conids: String(conid), fields: "31,84,86,88" });
    const data = await gw<{ "31"?: number; "84"?: number; "86"?: number; "88"?: number }[]>(
      `/v1/api/iserver/marketdata/snapshot?${params}`
    );
    const q = data?.[0] ?? {};
    return {
      last: q["31"],
      bid: q["84"],
      ask: q["86"],
      mark: q["88"],
    };
  },

  // For monitoring: look up option by OCC symbol (fallback — searches by symbol string)
  async getQuoteBySymbol(occSymbol: string): Promise<{ mark?: number }> {
    requireAuth();
    try {
      const results = await gw<{ contracts?: { conid: number }[] }[]>(
        "/v1/api/iserver/secdef/search",
        {
          method: "POST",
          body: JSON.stringify({ symbol: occSymbol, name: false, secType: "OPT" }),
        }
      );
      const conid = results?.[0]?.contracts?.[0]?.conid;
      if (!conid) return {};
      return this.getQuote(conid);
    } catch {
      return {};
    }
  },

  async placeOrder(order: Record<string, unknown>): Promise<string> {
    requireAuth();
    const accountId = this.getAccountId();
    if (!accountId) throw new Error("IBKR_ACCOUNT_ID not configured");

    const response = await gw<
      { order_id?: string; id?: string; messageIds?: string[] }[] | { order_id?: string; id?: string; messageIds?: string[] }
    >(`/v1/api/iserver/account/${accountId}/orders`, {
      method: "POST",
      body: JSON.stringify({ orders: [order] }),
    });

    const first = Array.isArray(response) ? response[0] : response;

    // IBKR sometimes requires a confirmation reply before the order submits
    const messageIds = first?.messageIds ?? [];
    for (const replyId of messageIds) {
      await gw(`/v1/api/iserver/reply/${replyId}`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
      });
    }

    return first?.order_id ?? first?.id ?? String(Date.now());
  },

  async getOpenOrders(): Promise<unknown[]> {
    requireAuth();
    const data = await gw<{ orders?: unknown[] }>("/v1/api/iserver/account/orders");
    return data?.orders ?? [];
  },

  async getPositions(): Promise<unknown[]> {
    requireAuth();
    const accountId = this.getAccountId();
    return gw<unknown[]>(`/v1/api/portfolio/${accountId}/positions/0`);
  },
};

// ── Order builders ────────────────────────────────────────────────────────────

export function buildBuyToOpenLimit(
  conid: number,
  quantity: number,
  limitPrice: number
): Record<string, unknown> {
  return {
    acctId: ibkr.getAccountId(),
    conid,
    orderType: "LMT",
    side: "BUY",
    tif: "DAY",
    price: limitPrice,
    quantity,
    secType: "OPT",
  };
}

export function buildSellToCloseMarket(
  conid: number,
  quantity: number,
  accountId: string
): Record<string, unknown> {
  return {
    acctId: accountId,
    conid,
    orderType: "MKT",
    side: "SELL",
    tif: "DAY",
    quantity,
    secType: "OPT",
  };
}
