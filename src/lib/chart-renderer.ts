import type { SchwabBar } from "@/lib/schwab";
import type { Indicators } from "@/lib/ta-analysis";

// Renders chart images via QuickChart.io — zero native dependencies, works on Vercel.
// Returns a public URL that Telegram's sendPhoto API can fetch directly.

const QUICKCHART_BASE = "https://quickchart.io/chart";
const CHART_WIDTH = 800;
const CHART_HEIGHT = 380;
const BG_COLOR = "%230B1426"; // URL-encoded #0B1426

export function buildChartUrl(
  bars: SchwabBar[],
  ind: Indicators,
  timeframe: string,
  signalType: "CALL" | "PUT"
): string {
  // Take last 40 bars for readability
  const slice = bars.slice(-40);
  const indSlice = {
    ema9: ind.ema9.slice(-40),
    ema21: ind.ema21.slice(-40),
    ema50: ind.ema50.slice(-40),
  };

  const labels = slice.map((b) => {
    const d = new Date(b.datetime);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const closes = slice.map((b) => b.close);

  // Pad shorter indicator arrays with null to align with closes
  function pad(arr: number[], targetLen: number): (number | null)[] {
    const diff = targetLen - arr.length;
    return [...Array(diff).fill(null), ...arr];
  }

  const ema9 = pad(indSlice.ema9, slice.length);
  const ema21 = pad(indSlice.ema21, slice.length);
  const ema50 = pad(indSlice.ema50, slice.length);

  const signalColor = signalType === "CALL" ? "#00C9A7" : "#FF6B6B";

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Price",
          data: closes,
          borderColor: "#ffffff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
          fill: false,
        },
        {
          label: "EMA9",
          data: ema9,
          borderColor: signalColor,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.1,
          fill: false,
        },
        {
          label: "EMA21",
          data: ema21,
          borderColor: "#1B65A7",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.1,
          fill: false,
        },
        {
          label: "EMA50",
          data: ema50,
          borderColor: "#FFD700",
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [5, 5],
          tension: 0.1,
          fill: false,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          labels: { color: "#aaaaaa", font: { size: 11 } },
        },
        title: {
          display: true,
          text: `${timeframe} Chart — ${signalType} Signal`,
          color: "#ffffff",
          font: { size: 14 },
        },
      },
      scales: {
        x: {
          ticks: { color: "#aaaaaa", maxTicksLimit: 10, font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          ticks: { color: "#aaaaaa", font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.07)" },
          position: "right",
        },
      },
      backgroundColor: "#0B1426",
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `${QUICKCHART_BASE}?c=${encoded}&w=${CHART_WIDTH}&h=${CHART_HEIGHT}&bkg=${BG_COLOR}`;
}
