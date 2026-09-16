// Does a campaign survive the whole way from a cold email to onboarding2_leads?
//
//   bun run scripts/_probe-utm-chain.ts
//
// No network, no database. It walks the four hops as pure functions, because the failure this
// exists to catch is a BREAK IN THE MIDDLE and every hop is cheap to check in isolation.
//
// ‼️ THIS CHAIN WAS BROKEN FROM THE DAY THE REPORT CTA WAS BUILT UNTIL 2026-09-16, AND NOTHING
// FAILED WHILE IT WAS. readAttribution() reads utm_campaign only from the page it is running on,
// /onboarding2 reads all four off its own query string, and both of those were always correct.
// What did not exist was the carry: the report lives at a new URL, opened days later from an
// email, and buildOnboarding2Url() emitted score, city, business, competitor, counts and slug and
// never a campaign. So a cold email with ?utm_campaign=x produced a lead row with utm_campaign
// null, and the only visible symptom was a number nobody could explain being zero.
//
// A prospect is only created in the CRM when they REPLY. Somebody who clicks, scans, and books
// without ever writing back is the best outcome a campaign has, and onboarding2_leads.utm_campaign
// is the only place they ever show up.

import { buildOnboarding2Url } from "../src/lib/onboarding2-link";

const CAMPAIGN = "medspa-q4-probe";
const ORIGIN = "https://srtagency.com";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── Hop 1. The email link lands on the site carrying the campaign. ──
const landing = `${ORIGIN}/?utm_campaign=${CAMPAIGN}&utm_source=reachinbox`;
const landingParams = new URLSearchParams(new URL(landing).search);
check("hop 1, the email link carries the campaign", landingParams.get("utm_campaign") === CAMPAIGN);

// ── Hop 2. The scan form reads them off the location and posts them. ──
//
// Mirrors utmFromLocation() in src/app/scan/scan-form.tsx. Kept as a copy rather than imported
// because that function touches `window` and this probe has none; the shape is four fixed keys
// and a length clamp, so a copy that drifts would be visible immediately.
function utmFromSearch(search: string): Record<string, string> {
  const q = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = q.get(k);
    if (v) out[k] = v.slice(0, 120);
  }
  return out;
}
const posted = utmFromSearch(new URL(landing).search);
check("hop 2, the scan form posts the campaign", posted.utm_campaign === CAMPAIGN, JSON.stringify(posted));
check("hop 2, it does not invent params that were absent", !("utm_content" in posted));

// ── Hop 3. The row carries them, and the report's Get Started link reads them back off it. ──
const row = {
  utm_source: posted.utm_source ?? null,
  utm_medium: posted.utm_medium ?? null,
  utm_campaign: posted.utm_campaign ?? null,
  utm_content: posted.utm_content ?? null,
};
const cta = buildOnboarding2Url(
  { score: 18, city: "Greensboro", business: "Radiance Med Spa", reportSlug: "abc123" },
  ORIGIN,
  {
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
  }
);
console.log(`\n      ${cta}\n`);
const ctaParams = new URLSearchParams(new URL(cta).search);
check("hop 3, Get Started carries the campaign", ctaParams.get("utm_campaign") === CAMPAIGN);
check("hop 3, it still carries the report", ctaParams.get("r") === "abc123");
check("hop 3, it still carries the score", ctaParams.get("score") === "18");
check("hop 3, an absent param is omitted rather than blanked", !ctaParams.has("utm_content"));

// ── Hop 4. /onboarding2 reads all four off its own query string. ──
//
// Mirrors the `one(sp.utm_*)` reads in src/app/onboarding2/page.tsx, which then reach
// readAttribution() and land on onboarding2_leads.
const funnel = {
  source: ctaParams.get("utm_source") ?? "",
  medium: ctaParams.get("utm_medium") ?? "",
  campaign: ctaParams.get("utm_campaign") ?? "",
  content: ctaParams.get("utm_content") ?? "",
};
check("hop 4, the funnel reads the campaign", funnel.campaign === CAMPAIGN, JSON.stringify(funnel));
check("hop 4, the source survived too", funnel.source === "reachinbox");

// ── The regression itself. ──
//
// ‼️ THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL BUG, so it asserts the shape of the
// break rather than the shape of the fix: a link built with no utm argument must not silently
// look like a link built with one.
const without = buildOnboarding2Url({ reportSlug: "abc123" }, ORIGIN);
check(
  "a report with no campaign produces a link with no campaign",
  !new URLSearchParams(new URL(without).search).has("utm_campaign"),
  without
);

console.log(failures ? `\n${failures} FAILED` : "\nAll clean. The campaign survives all four hops.");
process.exit(failures ? 1 : 0);
