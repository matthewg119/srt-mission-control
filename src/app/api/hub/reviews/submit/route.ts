// The AI Referral Engine's only write, and the only API route reachable on a client-controlled
// hostname.
//
// THIS ROUTE MUST NOT READ x-forwarded-for. Not to store it, not to hash it, not to rate
// limit on it. SRT-Referral-Engine-BUILD-SPEC-v2.md forbids holding anything that could
// identify her, and "we never hold customer contacts" is true here because there is
// nowhere to put one — review_tool_submissions has no column for a name, an email, a
// phone, an IP, a user agent or a session id. Rate limiting is therefore a per-client
// daily count read back from the table, never an IP bucket.
//
// NO MODEL IN THIS PATH. Nothing here imports @/lib/claude-calls or the Anthropic SDK, and
// nothing may. See src/lib/hub/review-assemble.ts.
//
// ‼️ `rating`, `private_note` AND `attested_at` (2026-09-04) DO NOT BREAK THE NO-PII RULE ABOVE.
// None of the three can identify her: a number 1 to 5, free text she chose to write, and a
// timestamp. The rule is about holding a name, a contact or a device, and it still holds — this
// route still refuses x-forwarded-for and still rate limits on a per-client daily count.
//
// The rating is STORED AND NEVER READ HERE. There is no branch in this file that behaves
// differently for a 1 than for a 5, and there must not be one: routing by rating is review
// gating. See the header of review-assemble.ts.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveHost } from "@/lib/hub/resolve";
import {
  ALL_REVIEW_QUESTIONS,
  assembleBullet,
  readQuestionSetVersion,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";

export const dynamic = "force-dynamic";

/** Generous, and per client per day. A busy clinic sees dozens; nobody sees thousands. */
const DAILY_CAP = 500;

/** One answer cannot be longer than a long answer. Guards the column, not the person. */
const MAX_ANSWER = 4000;

/**
 * 1 to 5, or null. Anything else becomes null rather than an error.
 *
 * A rating that decides nothing is not worth failing a request over, and the CHECK constraint
 * on the column would reject a bad value anyway — which would lose her words along with it,
 * because the insert is what stores them.
 */
function readRating(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= 5 ? raw : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  // Set by middleware for external hosts and STRIPPED by middleware on the internal host,
  // so it cannot be forged. It is the only statement of which client this write belongs to;
  // the body's clientId is never trusted for that.
  const hubHost = req.headers.get("x-hub-host");
  if (!hubHost) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let resolved;
  try {
    resolved = await resolveHost(hubHost);
  } catch {
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
  if (resolved.status !== "ok" || resolved.kind !== "reviews") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const clientId = resolved.client.id;

  let body: {
    answers?: ReviewAnswers;
    submissionId?: string | null;
    postedDestination?: string | null;
    /**
     * 1 to 5, and it decides NOTHING on the way in or on the way out. Stored for the client's
     * own reporting. This route has no branch that reads it, and adding one would make the
     * rating a router, which is the gating pattern the whole tool refuses.
     */
    rating?: unknown;
    /** Optional, offered to every rating, never posted anywhere. */
    privateNote?: unknown;
    /** "I am a real customer of this business and I approve these words as my own." */
    attested?: unknown;
    /**
     * The funnel fields, 2026-10-13. Counted, never routed.
     *
     * ‼️ NONE OF THESE IS A BRANCH, HERE OR ANYWHERE. They exist so somebody can answer "where
     * does the walk lose people" without a session id on this table, which its own migration
     * forbids in capitals. No code path reads them back to decide anything about what she is
     * shown, and the two read functions in docs/2026-10-13-review-funnel.sql cannot be reached
     * from a client-facing surface at all: they are granted to service_role only.
     */
    lastStep?: unknown;
    completed?: unknown;
    copiedEdited?: unknown;
    regenerateCount?: unknown;
    /**
     * Which question set she walked. Narrowed by readQuestionSetVersion, never trusted: it lands
     * in a not-null text column that every later reader keys off.
     *
     * A client that sends nothing is v1, which stamps "v3". Nothing migrates and nothing is
     * rewritten: the assemblers iterate the questions, so a row contributes no bullet for a key
     * that set no longer asks.
     */
    questionSetVersion?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // ── Every later call on a submission already stored ──
  //
  // ‼️ THIS BRANCH USED TO WRITE ONE COLUMN AND SILENTLY DROP EVERYTHING ELSE, AND THAT WAS TWO
  // LIVE DEFECTS RATHER THAN A LIMITATION. It read:
  //
  //     const destination = ...postedDestination...;
  //     if (destination) { update({ posted_destination: destination }) }
  //     return NextResponse.json({ id: body.submissionId });
  //
  //   1. attested_at COULD NEVER BE NON-NULL FROM THE WALK. The checkbox only renders after she
  //      reveals her review, so `attested` is still false at the INSERT, and every later call
  //      carries a submissionId and landed here, where `attested` was not read. The column the
  //      migration was written for was null on every row ever stored. We told patients they had
  //      attested and recorded nothing, on the one field whose entire job is to be the evidence.
  //
  //   2. A PRIVATE NOTE WAS THROWN AWAY. "Send privately" calls with a submissionId and no
  //      destination, so `destination` was null, the `if` did not fire, NO WRITE HAPPENED AT ALL,
  //      and the route returned `{ id }`. The patient sees no error, by design, and her complaint
  //      to the clinic went nowhere.
  //
  // Both are fixed by the branch being a patch over the fields a later call can legitimately
  // carry, rather than one column with everything else unreachable behind it.
  if (body.submissionId) {
    const patch: Record<string, unknown> = {};

    const destination =
      typeof body.postedDestination === "string" ? body.postedDestination.slice(0, 40) : null;
    if (destination) patch.posted_destination = destination;

    // ‼️ THE TIMESTAMP, NOT THE BOOLEAN, AND ONLY EVER SET. "She ticked it" and "she ticked it at
    // 14:02 on the 4th" are different evidence. Never cleared: unticking the box does not unmake
    // the fact that she ticked it, and a path that erased an attestation would be a path that
    // erased evidence.
    if (body.attested === true) patch.attested_at = new Date().toISOString();

    if (typeof body.privateNote === "string" && body.privateNote.trim()) {
      patch.private_note = body.privateNote.trim().slice(0, MAX_ANSWER);
    }

    // ── The funnel fields, added 2026-10-13 ──
    //
    // ‼️ last_step ONLY EVER MOVES FORWARD, AND THE ORDER IS NOT KNOWN HERE. The client sends the
    // step she has reached and this writes it; REVIEW_SCRIPT's order lives in one place and a
    // route comparing step ids would be a second copy of it. The client never walks backwards
    // except at the invite's "did you copy it" beat, which is not a review step.
    if (typeof body.lastStep === "string" && body.lastStep.trim()) {
      patch.last_step = body.lastStep.trim().slice(0, 60);
    }
    // Set once, like attested_at: reaching her finished review a second time does not make it a
    // second review.
    if (body.completed === true) patch.completed_at = new Date().toISOString();
    if (body.copiedEdited === true) patch.copied_edited = true;
    if (typeof body.regenerateCount === "number" && Number.isFinite(body.regenerateCount)) {
      // Clamped to smallint and to sanity. A patient cannot press a button 40,000 times, so a
      // number that large is a bug or a forgery and either way it is not evidence.
      patch.regenerate_count = Math.max(0, Math.min(999, Math.trunc(body.regenerateCount)));
    }

    // ‼️ AN EMPTY PATCH WRITES NOTHING, WHICH IS NOT THE SAME BUG AS THE ONE ABOVE. There it was
    // a call carrying real data that went nowhere. Here there is nothing to write, and issuing an
    // empty update would be a round trip to say so.
    if (Object.keys(patch).length > 0) {
      const { error: patchError } = await supabaseAdmin
        .from("review_tool_submissions")
        .update(patch)
        .eq("id", body.submissionId)
        // Scoped to the resolving client, so an id from one hub cannot label a row on
        // another.
        .eq("client_id", clientId);
      // Logged and swallowed. Storing is for SRT's benefit and must never stand between her and
      // her own words, which is the same rule the insert below follows.
      if (patchError) console.error("[hub/reviews] patch failed:", patchError.message);
    }
    return NextResponse.json({ id: body.submissionId });
  }

  // ── The first call: store what she wrote ──
  // Stored whether or not she goes on to post. The objection language is the asset either
  // way, and a review that never gets posted still says what a future customer is afraid of.
  const answers: ReviewAnswers = {};
  let any = false;
  // ‼️ BOTH SETS, AND MISSING THIS IS SILENT. If this iterated only the v3 four, a v4 walk would
  // store nothing, `any` would stay false, and the 400 below is swallowed by the client on
  // purpose. She would see a working flow and the row would never exist.
  //
  // A gate answer cannot arrive here even if one were posted: the yes/no steps live in
  // review-script.ts and have no key in ReviewQuestion, so there is no iteration that reaches
  // them and no column they could land in. That is what keeps "Yes" out of page-review.ts, which
  // reads Object.values() off this bag for quotable review lines.
  for (const question of ALL_REVIEW_QUESTIONS) {
    const raw = body.answers?.[question.key];
    if (typeof raw !== "string") continue;
    // Stored assembled, exactly as she saw it. Storing the raw string and assembling later
    // would let the two drift.
    const bullet = assembleBullet(raw.slice(0, MAX_ANSWER));
    if (bullet) {
      answers[question.key] = bullet;
      any = true;
    }
  }
  if (!any) return NextResponse.json({ error: "Nothing to store" }, { status: 400 });

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabaseAdmin
    .from("review_tool_submissions")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", since);

  if ((count ?? 0) >= DAILY_CAP) {
    // 200, not 429. She has done nothing wrong and there is nothing for her to retry; her
    // words are still on her screen and still hers to copy. The cap protects the table.
    console.error(`[hub/reviews] daily cap hit for client ${clientId}`);
    return NextResponse.json({ id: null });
  }

  const { data, error } = await supabaseAdmin
    .from("review_tool_submissions")
    .insert({
      client_id: clientId,
      question_set_version: readQuestionSetVersion(body.questionSetVersion),
      answers,
      posted_destination:
        typeof body.postedDestination === "string" ? body.postedDestination.slice(0, 40) : null,
      rating: readRating(body.rating),
      private_note:
        typeof body.privateNote === "string" && body.privateNote.trim()
          ? body.privateNote.trim().slice(0, MAX_ANSWER)
          : null,
      // The timestamp, not the boolean. "She ticked it" and "she ticked it at 14:02 on the
      // 4th" are different evidence, and the column costs the same either way.
      //
      // ‼️ IN PRACTICE THIS IS ALWAYS NULL AT INSERT AND THAT IS NOT THE BUG IT LOOKS LIKE. The
      // checkbox is downstream of the insert: the row exists from her first answer, and she ticks
      // the box at the end. The update branch above is what actually records it, and before
      // 2026-10-13 it did not, which left the column null on every row ever written.
      attested_at: body.attested === true ? new Date().toISOString() : null,
      // ‼️ THE ROW NOW EXISTS FROM HER FIRST ANSWER, SO IT USUALLY STARTS MID-WALK. Without a
      // first step on the insert, an abandonment at the very next question would be a row with a
      // null last_step, indistinguishable from a row written before this column existed.
      last_step: typeof body.lastStep === "string" ? body.lastStep.trim().slice(0, 60) : null,
      completed_at: body.completed === true ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[hub/reviews] insert failed:", error.message);
    // Still 200. Storing is for SRT's benefit; failing it must never stand between her and
    // copying her own words.
    return NextResponse.json({ id: null });
  }

  return NextResponse.json({ id: (data?.id as string | undefined) ?? null });
}
