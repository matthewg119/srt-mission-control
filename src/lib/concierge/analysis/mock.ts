// The default analysis provider. Spends nothing, calls nobody, and is honest about it.
//
// ‼️ THIS IS THE DEFAULT ON PURPOSE, SO THAT NOT HAVING CHOSEN A VENDOR BLOCKS NOTHING.
// The frame, the results view, the concierge conversation, the magnet routing and the lead
// handoff are all built and regression-tested against this. Buying DermIQ or Perfect Corp later
// changes one column value.
//
// Scale direction: not applicable. It emits the canonical convention directly (higher is
// better), because it has no vendor to disagree with.
//
// ‼️ DETERMINISTIC, AND THAT IS THE FEATURE. The same photo always produces the same scores, so
// "the results view renders a low firmness score correctly" is a test somebody can actually
// write. A Math.random() here would make every screenshot in review a different conversation.
//
// ‼️ IT MUST STAY OBVIOUSLY SYNTHETIC. Every result is stamped `synthetic` in the ledger, and
// skin age is deliberately never returned: a made-up number next to the words "your skin age"
// is the one output of this lane that a patient would repeat to somebody as if it were a
// measurement. Absent is honest. Invented is not.

import {
  CANONICAL_METRICS,
  fingerprint,
  type AnalysisProvider,
  type ScanInput,
  type ScanResult,
  type SkinScores,
} from "./provider";

/** Two hex characters per metric, mapped into a plausible-but-unmistakably-generated band. */
function scoresFrom(hash: string): SkinScores {
  const scores: SkinScores = {};
  CANONICAL_METRICS.forEach((metric, i) => {
    const byte = parseInt(hash.slice(i * 2, i * 2 + 2) || "80", 16);
    // 45-90. Never below 45: the mock must not hand the concierge a crisis to talk about,
    // because somebody will eventually demo it to a real prospect with their own face.
    scores[metric] = 45 + Math.round((byte / 255) * 45);
  });
  return scores;
}

export const mockProvider: AnalysisProvider = {
  name: "mock",

  async analyse(input: ScanInput): Promise<ScanResult> {
    const started = Date.now();

    // The one real check worth keeping, because the upload route's magic-byte guard is the
    // thing this stands in for during development. An empty buffer is a bug worth surfacing
    // before it reaches a paid vendor and costs a credit to learn the same thing.
    if (!input.bytes?.length) {
      return {
        ok: false,
        error: "synthetic: empty image buffer",
        latencyMs: Date.now() - started,
        httpStatus: null,
        costUsd: 0,
      };
    }

    return {
      ok: true,
      scores: scoresFrom(fingerprint(input.bytes)),
      // See the header. Never fabricated.
      skinAge: null,
      maskCount: 0,
      costUsd: 0,
      latencyMs: Date.now() - started,
      httpStatus: null,
    };
  },
};
