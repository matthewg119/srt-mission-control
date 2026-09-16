// Where the widget answers from.
//
// ‼️ ONE DEFINITION, BECAUSE TWO WOULD DISAGREE SILENTLY. The loader tag on a client's page, the
// frame it opens, and the tracked booking link inside that frame must all name the same host: a
// mismatch means the frame loads from one origin and posts to another, which fails the frame's own
// same-origin fetch and reads as "the widget is broken" rather than as a config error.
//
// ‼️ NOT IMPORTED FROM clients/concierge-setup.ts, WHICH ALSO HOLDS A COPY. That module is a
// provisioner and pulls a large subtree behind it; this function is called during a public client
// hub page render, where dragging the provisioning tree into the graph took the reachable file
// count from 69 to 153. host-classify.ts keeps its own copy for the same reason. The default string
// is identical in all three, and if it ever needs to differ that is a sign it belongs in a shared
// constant rather than that this should import a provisioner.

/**
 * The concierge hostname, lowercased, no scheme.
 *
 * ‼️ OFF PRODUCTION IT IS THIS DEPLOYMENT, NOT THE CONSTANT, AND THAT IS NOT A CONVENIENCE.
 * `concierge.srtagency.com` is a real hostname only on the production project. On a preview or a
 * branch deployment the constant resolves to nothing, so the tracked booking link built by
 * engine.ts would point at a host that does not exist: the pill opens, the conversation runs, and
 * the one button that matters is dead. That is the exact failure a preview is built to catch and
 * the exact failure it would instead cause.
 *
 * Production is unchanged. `VERCEL_ENV` is set by the platform and is `production` only on the
 * production deployment, so an explicit CONCIERGE_HOST still wins everywhere and nothing here can
 * make a live client's page point at a preview.
 */
export function conciergeHostname(): string {
  const explicit = (process.env.CONCIERGE_HOST || "").trim().toLowerCase();
  if (explicit) return explicit;

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    const deployment = (process.env.VERCEL_URL || "").trim().toLowerCase();
    if (deployment) return deployment;
  }

  return "concierge.srtagency.com";
}

/** The concierge origin, scheme included. */
export function conciergeOrigin(): string {
  return `https://${conciergeHostname()}`;
}

/**
 * Where a PREVIEW of the widget answers from: Mission Control's own origin.
 *
 * ‼️ A PREVIEW NEEDS NO DNS, AND NAMING THE CONCIERGE HOST MADE IT NEED SOME. On 2026-09-11
 * `concierge.srtagency.com` was still NXDOMAIN, so every preview loader tag, and the demo link
 * step 20 posts, pointed at nothing. The internal host already serves /embed.js, /w/{slug} and
 * /api/concierge/*, and a signed preview token opens a switched-off widget there, so a preview
 * that loads from here works before anybody has touched a registrar. Live client pages still use
 * conciergeOrigin() above and nothing about them changes.
 *
 * ‼️ THE HEADER'S "ALL THREE MUST AGREE" STILL HOLDS, AND IT HOLDS BY DERIVATION, NOT BY A SECOND
 * CONSTANT. embed.js builds the frame URL and the config fetch from its own script src, the frame's
 * /start and /turn are relative, and engine.ts builds the booking hop from the frame origin /start
 * recorded. Only the loader tag names this function; everything after it follows.
 *
 * ‼️ THE ENV READ IS INLINED RATHER THAN BORROWED FROM config.ts OR review-preview.ts, for the
 * reason at the top of this file: both of those pull the database client in behind them.
 */
export function previewOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // A malformed value falls through to the production default, same as host-classify.ts.
    }
  }
  return "https://mission.srtagency.com";
}
