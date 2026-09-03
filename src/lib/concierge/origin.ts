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
