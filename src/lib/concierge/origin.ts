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

/** The concierge hostname, lowercased, no scheme. */
export function conciergeHostname(): string {
  return (process.env.CONCIERGE_HOST || "concierge.srtagency.com").trim().toLowerCase();
}

/** The concierge origin, scheme included. */
export function conciergeOrigin(): string {
  return `https://${conciergeHostname()}`;
}
