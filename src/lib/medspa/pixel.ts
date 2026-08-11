// Browser-side Meta pixel helpers for /webflow-Aivisibility.
//
// CLIENT-SAFE. No imports, no node: builtins.
//
// THE ATTRIBUTION RULE (src/lib/metaAttribution.ts states the server half): an event
// fires only when the visitor came from a real Meta ad click, meaning the `_fbc`
// cookie exists OR `fbclid` was on the landing URL. `_fbp` alone does NOT count,
// because the pixel sets it on every visitor including direct traffic, and counting
// it inflates Ads Manager with people who never saw an ad.
//
// Standard events only, never custom parameters. That is the convention on every
// srtagency funnel and the ad sets are built on it.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = (document.cookie || "").split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

export interface Attribution {
  fbc: string;
  fbp: string;
  fbclid: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

export function readAttribution(): Attribution {
  if (typeof window === "undefined") {
    return { fbc: "", fbp: "", fbclid: "", utmSource: "", utmMedium: "", utmCampaign: "" };
  }
  const qs = new URLSearchParams(window.location.search);
  return {
    fbc: readCookie("_fbc"),
    fbp: readCookie("_fbp"),
    fbclid: qs.get("fbclid") || "",
    utmSource: qs.get("utm_source") || "",
    utmMedium: qs.get("utm_medium") || "",
    utmCampaign: qs.get("utm_campaign") || "",
  };
}

/** The gate. `_fbp` deliberately does not appear in this function. */
export function hasMetaAttribution(a: Attribution = readAttribution()): boolean {
  return Boolean(a.fbc || a.fbclid);
}

/**
 * Fire a standard event, once, if and only if the visitor is ad-attributed.
 *
 * The try/catch is the house pattern: an ad blocker leaves `fbq` undefined and a
 * throw here would take the whole funnel down with it.
 */
const fired = new Set<string>();

export function track(event: string): void {
  if (fired.has(event)) return;
  fired.add(event);
  if (!hasMetaAttribution()) return;
  try {
    if (typeof window !== "undefined" && typeof window.fbq === "function") {
      window.fbq("track", event);
    }
  } catch {
    /* blocked, offline, or no pixel. Never a reason to break the page. */
  }
}
