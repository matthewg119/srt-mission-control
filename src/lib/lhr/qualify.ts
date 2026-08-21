// The /LHR qualifier: does this person own the kind of business the training is for.
//
// PURE AND ISOMORPHIC, the same contract as src/lib/medspa/validate.ts. The modal
// imports it to decide whether to show the submit button, and the route imports it to
// decide whether to accept the post, so the two cannot drift apart. Nothing here may
// import a node: builtin or anything server-side: one top-level `import ... from
// "crypto"` fails the browser bundle, and tsc does not catch it because a bundler
// boundary is not a type error.
//
// ‼️ THE SERVER RE-CHECKS. The modal removing its own submit button is a courtesy to a
// real person, not a gate. This endpoint is public and unauthenticated, and the answer
// decides whether we dial someone via Speed-to-Lead, so the browser does not get to be
// the thing that decides it.

import { OWNS_YES } from "@/config/lhr-funnel";

/**
 * True only for the exact affirmative option we offered.
 *
 * Matched against the exported constant rather than a literal, and it is a strict
 * equality rather than a "not the No option" test. Those differ on everything that is
 * neither: an empty string, a hand-crafted post, or a third option added later all read
 * as NOT qualified, which is the safe direction. Defaulting the unknown case to
 * qualified would mean a malformed payload dials a stranger.
 */
export function ownsQualifyingClinic(answer: unknown): boolean {
  return typeof answer === "string" && answer.trim() === OWNS_YES;
}
