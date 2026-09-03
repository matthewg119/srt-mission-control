// Every tunable number and env name for /onboarding2, in one place.
//
// ‼️ THIS FILE EXISTS BECAUSE A route.ts MAY ONLY EXPORT HTTP METHODS AND NEXT'S OWN CONFIG.
// Next validates route module exports against a fixed list, so `export const SIGN_RATE_LIMIT`
// inside a route file fails `next build` with a type error rather than at runtime.
// src/lib/chatgpt-ads/setup.ts and src/lib/onboarding-free/log.ts were carved out for the same
// reason and both say so in their headers.

/** Storage bucket. The same private one every other generated artifact lands in. */
export const BUCKET = "onboarding";

/** Where a signing's PDF lives. Keyed on the signing, not the client, because a signature is
 *  durable before provisioning has run and may outlive the client row entirely. */
export function pdfKeyFor(signingId: string): string {
  return `onboarding2/${signingId}/agreement.pdf`;
}

// ── Guards ──────────────────────────────────────────────────────────────────
//
// Read at call time, never at module load, so a value can be changed in the Vercel dashboard
// without a redeploy.

/** New signing sessions per IP per 24h. Generous: this is a page load, not a conversion. */
export const startLimit = () => Number(process.env.ONBOARDING2_START_LIMIT || 5);
/** Completed signatures per IP per 24h. Tight: signing three contracts in a day is a story. */
export const signLimit = () => Number(process.env.ONBOARDING2_SIGN_LIMIT || 3);
/** User chat turns per IP per hour, across every signing they hold. */
export const chatIpLimit = () => Number(process.env.ONBOARDING2_CHAT_IP_LIMIT || 120);

/**
 * Per-signing turn caps, counted separately per mode.
 *
 * ‼️ THIS IS THE CAP THAT BOUNDS SPEND IF A SESSION TOKEN LEAKS. Every other limit here keys on
 * IP, and somebody holding a stolen token arrives from wherever they like. Counted per mode so a
 * session that signs cannot re-spend the budget it already used reading the agreement.
 */
export const maxTurnsPre = () => Number(process.env.ONBOARDING2_MAX_TURNS_PRE || 40);
export const maxTurnsPost = () => Number(process.env.ONBOARDING2_MAX_TURNS_POST || 60);

/** Nobody reads a screen and types in under two seconds. */
export const MIN_FILL_SECONDS = 2;
/** A user turn arriving faster than this is a script; the model has not finished the last one. */
export const MIN_TURN_GAP_MS = 1000;
/** Longest thing a visitor may send the assistant. */
export const MAX_MESSAGE_CHARS = 2000;
export const RATE_WINDOW_HOURS = 24;

/**
 * The assistant is off unless this is set.
 *
 * ‼️ UNSET IS A HANDLED STATE, NOT A THROW. The bubble renders and says the assistant is
 * unavailable. A public page that 500s because an env var has not landed yet is the failure mode
 * every other funnel in this repo was written to avoid.
 */
export const chatEnabled = () => process.env.ONBOARDING2_CHAT_ENABLED === "true";

/**
 * ‼️ 'pilot', NOT 'active'. A signature starts the free period the agreement promises, and
 * nothing is charged until five qualified appointments land. Passing 'active' here would set
 * pilot_started_at to null and quietly tell every board in Mission Control that this client is
 * billing, which contradicts the document they just signed.
 */
export const BILLING_STATUS = "pilot" as const;

/** Where the signature card goes. #onboarding-srt-aeo, so pre-call onboarding starts there. */
export const onboardingChannel = () => process.env.SLACK_CLIENT_ONBOARDING_CHANNEL || "";

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** The public face of the funnel, for links we put in an email a client reads. */
export function publicUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://srtagency.com";
}
