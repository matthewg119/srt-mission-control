import {
  EMA,
  RSI,
  MACD,
  BollingerBands,
} from "technicalindicators";
import type { SchwabBar } from "@/lib/schwab";

export interface BotConfig {
  target_delta: number;
  dte_min: number;
  dte_max: number;
  stop_loss_percent: number;
  take_profit_percent: number;
  max_contracts: number;
}

export interface Indicators {
  ema9: number[];
  ema21: number[];
  ema50: number[];
  rsi: number[];
  macdLine: number[];
  macdSignal: number[];
  bbUpper: number[];
  bbLower: number[];
  avgVolume: number;
  closes: number[];
  volumes: number[];
}

export function calculateIndicators(bars: SchwabBar[]): Indicators {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const rsi = RSI.calculate({ period: 14, values: closes });
  const macdResult = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const bbResult = BollingerBands.calculate({
    period: 20,
    stdDev: 2,
    values: closes,
  });

  const macdLine = macdResult.map((r) => r.MACD ?? 0);
  const macdSignal = macdResult.map((r) => r.signal ?? 0);
  const bbUpper = bbResult.map((r) => r.upper);
  const bbLower = bbResult.map((r) => r.lower);

  const avgVolume =
    volumes.length > 0
      ? volumes.reduce((a, b) => a + b, 0) / volumes.length
      : 0;

  return {
    ema9,
    ema21,
    ema50,
    rsi,
    macdLine,
    macdSignal,
    bbUpper,
    bbLower,
    avgVolume,
    closes,
    volumes,
  };
}

export interface SignalResult {
  type: "CALL" | "PUT";
  score: number;
  trigger: string;
  conditions: Record<string, boolean>;
}

export function detectStandardSignal(
  ind: Indicators,
  prevClose: number
): SignalResult | null {
  const n = ind.ema9.length;
  const nm = ind.macdLine.length;
  const nr = ind.rsi.length;
  const nv = ind.volumes.length;

  if (n < 2 || nm < 2 || nr < 1 || nv < 1) return null;

  const curEma9 = ind.ema9[n - 1];
  const prevEma9 = ind.ema9[n - 2];
  const curEma21 = ind.ema21[n - 1];
  const prevEma21 = ind.ema21.length >= 2 ? ind.ema21[n - 2] : curEma21;
  const curEma50 = ind.ema50[ind.ema50.length - 1];

  const curMacd = ind.macdLine[nm - 1];
  const prevMacd = ind.macdLine[nm - 2];
  const curSig = ind.macdSignal[nm - 1];
  const prevSig = ind.macdSignal[nm - 2];

  const curRsi = ind.rsi[nr - 1];
  const curPrice = ind.closes[ind.closes.length - 1];
  const curVol = ind.volumes[nv - 1];

  const emaCrossUp = prevEma9 < prevEma21 && curEma9 > curEma21;
  const emaCrossDown = prevEma9 > prevEma21 && curEma9 < curEma21;
  const macdCrossUp = prevMacd < prevSig && curMacd > curSig;
  const macdCrossDown = prevMacd > prevSig && curMacd < curSig;

  const callConditions = {
    ema_cross_up: emaCrossUp,
    price_above_ema50: curPrice > curEma50,
    rsi_range: curRsi >= 45 && curRsi <= 65,
    macd_cross_up: macdCrossUp,
    volume_surge: curVol > ind.avgVolume * 1.2,
    above_prev_close: curPrice > prevClose,
  };

  const putConditions = {
    ema_cross_down: emaCrossDown,
    price_below_ema50: curPrice < curEma50,
    rsi_range: curRsi >= 35 && curRsi <= 55,
    macd_cross_down: macdCrossDown,
    volume_surge: curVol > ind.avgVolume * 1.2,
    below_prev_close: curPrice < prevClose,
  };

  const callScore = scoreConditions(callConditions);
  const putScore = scoreConditions(putConditions);

  if (callScore >= 70) {
    return { type: "CALL", score: callScore, trigger: "EMA9_cross_above_EMA21", conditions: callConditions };
  }
  if (putScore >= 70) {
    return { type: "PUT", score: putScore, trigger: "EMA9_cross_below_EMA21", conditions: putConditions };
  }
  return null;
}

function scoreConditions(conditions: Record<string, boolean>): number {
  const vals = Object.values(conditions);
  const pts = Math.floor(100 / vals.length);
  return vals.filter(Boolean).length * pts;
}

export function detectBOSSignal(
  bars3m: SchwabBar[],
  bars5m: SchwabBar[],
  bars15m: SchwabBar[]
): SignalResult | null {
  if (bars3m.length < 5 || bars5m.length < 3 || bars15m.length < 3) return null;

  const bos = findBOS(bars3m);
  if (!bos) return null;

  const trend5m = getTrend(bars5m);
  const trend15m = getTrend(bars15m);

  if (bos === "CALL" && trend5m === "UP" && trend15m === "UP") {
    return {
      type: "CALL",
      score: 65,
      trigger: "BOS_3m_trend_aligned",
      conditions: { bos_up: true, trend_5m_up: true, trend_15m_up: true },
    };
  }
  if (bos === "PUT" && trend5m === "DOWN" && trend15m === "DOWN") {
    return {
      type: "PUT",
      score: 65,
      trigger: "BOS_3m_trend_aligned",
      conditions: { bos_down: true, trend_5m_down: true, trend_15m_down: true },
    };
  }
  return null;
}

function findBOS(bars: SchwabBar[]): "CALL" | "PUT" | null {
  const lookback = Math.min(20, bars.length);
  const recent = bars.slice(-lookback);

  let swingHigh = -Infinity;
  let swingLow = Infinity;

  for (let i = 1; i < recent.length - 2; i++) {
    const bar = recent[i];
    const prev = recent[i - 1];
    const next = recent[i + 1];
    if (bar.high > prev.high && bar.high > next.high) {
      swingHigh = Math.max(swingHigh, bar.high);
    }
    if (bar.low < prev.low && bar.low < next.low) {
      swingLow = Math.min(swingLow, bar.low);
    }
  }

  const last = recent[recent.length - 1];
  if (swingHigh > -Infinity && last.close > swingHigh) return "CALL";
  if (swingLow < Infinity && last.close < swingLow) return "PUT";
  return null;
}

function getTrend(bars: SchwabBar[]): "UP" | "DOWN" | "FLAT" {
  const closes = bars.map((b) => b.close);
  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  if (ema9.length < 1 || ema21.length < 1) return "FLAT";
  const last9 = ema9[ema9.length - 1];
  const last21 = ema21[ema21.length - 1];
  if (last9 > last21) return "UP";
  if (last9 < last21) return "DOWN";
  return "FLAT";
}

export function selectBestOption(
  chain: Record<string, unknown>,
  type: "CALL" | "PUT",
  targetDelta: number,
  dteMin: number,
  dteMax: number
): {
  symbol: string;
  strike: number;
  expiration: string;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
} | null {
  const mapKey = type === "CALL" ? "callExpDateMap" : "putExpDateMap";
  const expMap = chain[mapKey] as Record<string, Record<string, unknown[]>> | undefined;
  if (!expMap) return null;

  const today = new Date();
  const candidates: {
    symbol: string;
    strike: number;
    expiration: string;
    delta: number;
    bid: number;
    ask: number;
    mid: number;
    dte: number;
    spreadRatio: number;
    openInterest: number;
  }[] = [];

  for (const [expStr, strikes] of Object.entries(expMap)) {
    const [dateStr] = expStr.split(":");
    const expDate = new Date(dateStr);
    const dte = Math.round((expDate.getTime() - today.getTime()) / 86400000);
    if (dte < dteMin || dte > dteMax) continue;

    for (const contracts of Object.values(strikes)) {
      for (const c of contracts as Record<string, unknown>[]) {
        const bid = Number(c.bid ?? 0);
        const ask = Number(c.ask ?? 0);
        const mid = (bid + ask) / 2;
        const delta = Math.abs(Number(c.delta ?? 0));
        const oi = Number(c.openInterest ?? 0);
        const spread = ask - bid;
        const spreadRatio = mid > 0 ? spread / mid : 1;

        if (spreadRatio > 0.15 || oi < 100) continue;

        candidates.push({
          symbol: String(c.symbol ?? ""),
          strike: Number(c.strikePrice ?? 0),
          expiration: dateStr,
          delta,
          bid,
          ask,
          mid,
          dte,
          spreadRatio,
          openInterest: oi,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the contract closest to target delta
  candidates.sort(
    (a, b) => Math.abs(a.delta - targetDelta) - Math.abs(b.delta - targetDelta)
  );

  return candidates[0];
}
