import { supabaseAdmin } from "@/lib/db";

const TRADER_BASE = "https://api.schwabapi.com/trader/v1";
const MARKET_BASE = "https://api.schwabapi.com/marketdata/v1";

export interface SchwabBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number; // unix ms
}

export interface SchwabToken {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number; // unix seconds (float)
  scope: string;
}

let _cachedToken: SchwabToken | null = null;

async function getToken(): Promise<SchwabToken> {
  // 1. Try in-memory cache
  if (_cachedToken && _cachedToken.expires_at > Date.now() / 1000 + 60) {
    return _cachedToken;
  }

  // 2. Load from bot_config (may have been refreshed by a previous invocation)
  const { data: row } = await supabaseAdmin
    .from("bot_config")
    .select("value")
    .eq("key", "schwab_token_json")
    .single();

  let token: SchwabToken | null = null;

  if (row?.value) {
    token = JSON.parse(row.value) as SchwabToken;
  } else {
    // 3. Fall back to env var (initial bootstrap)
    const raw = process.env.SCHWAB_TOKEN_JSON;
    if (!raw) throw new Error("SCHWAB_TOKEN_JSON not configured");
    token = JSON.parse(raw) as SchwabToken;
  }

  // 4. Refresh if expired
  if (token.expires_at <= Date.now() / 1000 + 60) {
    token = await refreshToken(token.refresh_token);
  }

  _cachedToken = token;
  return token;
}

async function refreshToken(refreshToken: string): Promise<SchwabToken> {
  const apiKey = process.env.SCHWAB_API_KEY!;
  const appSecret = process.env.SCHWAB_APP_SECRET!;
  const credentials = Buffer.from(`${apiKey}:${appSecret}`).toString("base64");

  const res = await fetch("https://api.schwabapi.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Schwab token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const token: SchwabToken = {
    ...data,
    expires_at: Date.now() / 1000 + (data.expires_in ?? 1800),
  };

  // Persist refreshed token to bot_config so next invocation picks it up
  await supabaseAdmin.from("bot_config").upsert({
    key: "schwab_token_json",
    value: JSON.stringify(token),
    updated_at: new Date().toISOString(),
  });

  return token;
}

async function authHeader(): Promise<string> {
  const token = await getToken();
  return `Bearer ${token.access_token}`;
}

async function traderFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${TRADER_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Schwab Trader API error ${res.status}: ${text}`);
  }
  return res;
}

async function marketFetch(path: string): Promise<Response> {
  const res = await fetch(`${MARKET_BASE}${path}`, {
    headers: { Authorization: await authHeader() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Schwab Market API error ${res.status}: ${text}`);
  }
  return res;
}

export const schwab = {
  async getAccountHash(): Promise<string> {
    const envHash = process.env.SCHWAB_ACCOUNT_HASH;
    if (envHash) return envHash;
    const res = await traderFetch("/accounts");
    const accounts = await res.json();
    return accounts[0]?.hashValue ?? "";
  },

  async getPriceHistory(
    symbol: string,
    frequencyType: "minute" = "minute",
    frequency: 1 | 3 | 5 | 10 | 15 | 30 = 5,
    period = 2
  ): Promise<SchwabBar[]> {
    const params = new URLSearchParams({
      symbol,
      periodType: "day",
      period: String(period),
      frequencyType,
      frequency: String(frequency),
      needExtendedHoursData: "false",
    });
    const res = await marketFetch(`/pricehistory?${params}`);
    const data = await res.json();
    return (data.candles ?? []) as SchwabBar[];
  },

  async getOptionsChain(
    symbol: string,
    contractType: "CALL" | "PUT",
    fromDate: string,
    toDate: string,
    strikeCount = 10
  ): Promise<unknown> {
    const params = new URLSearchParams({
      symbol,
      contractType,
      strikeCount: String(strikeCount),
      includeUnderlyingQuote: "true",
      fromDate,
      toDate,
    });
    const res = await marketFetch(`/chains?${params}`);
    return res.json();
  },

  async getQuote(symbol: string): Promise<Record<string, unknown>> {
    const res = await marketFetch(`/quotes?symbols=${encodeURIComponent(symbol)}`);
    const data = await res.json();
    return (data[symbol] ?? {}) as Record<string, unknown>;
  },

  async placeOrder(accountHash: string, order: Record<string, unknown>): Promise<string> {
    const res = await traderFetch(`/accounts/${accountHash}/orders`, {
      method: "POST",
      body: JSON.stringify(order),
    });
    // Order ID is in the Location header
    const location = res.headers.get("Location") ?? "";
    return location.split("/").pop() ?? "";
  },

  async getOpenPositions(accountHash: string): Promise<unknown[]> {
    const res = await traderFetch(`/accounts/${accountHash}?fields=positions`);
    const data = await res.json();
    return data?.securitiesAccount?.positions ?? [];
  },

  async getPreviousClose(symbol: string): Promise<number> {
    const bars = await this.getPriceHistory(symbol, "minute", 30, 1);
    return bars[bars.length - 1]?.close ?? 0;
  },
};

export function buildOptionSymbol(
  underlying: string,
  expiration: Date,
  type: "C" | "P",
  strike: number
): string {
  const yy = String(expiration.getFullYear()).slice(2);
  const mm = String(expiration.getMonth() + 1).padStart(2, "0");
  const dd = String(expiration.getDate()).padStart(2, "0");
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${underlying.padEnd(6)}${yy}${mm}${dd}${type}${strikeStr}`;
}

export function buildBuyToOpenLimit(
  optionSymbol: string,
  quantity: number,
  limitPrice: number
): Record<string, unknown> {
  return {
    orderType: "LIMIT",
    session: "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    price: limitPrice.toFixed(2),
    orderLegCollection: [
      {
        instruction: "BUY_TO_OPEN",
        quantity,
        instrument: { symbol: optionSymbol, assetType: "OPTION" },
      },
    ],
  };
}

export function buildSellToCloseMarket(
  optionSymbol: string,
  quantity: number
): Record<string, unknown> {
  return {
    orderType: "MARKET",
    session: "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: "SELL_TO_CLOSE",
        quantity,
        instrument: { symbol: optionSymbol, assetType: "OPTION" },
      },
    ],
  };
}
