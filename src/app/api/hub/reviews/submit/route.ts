// The review tool's only write, and the only API route reachable on a client-controlled
// hostname.
//
// THIS ROUTE MUST NOT READ x-forwarded-for. Not to store it, not to hash it, not to rate
// limit on it. SRT-Review-Tool-BUILD-SPEC-v2.md forbids holding anything that could
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
  QUESTION_SET_VERSION,
  REVIEW_QUESTIONS,
  assembleBullet,
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
    /** "I am a real customer and these are my own words." */
    attested?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // ── The second call: she tapped a destination on a submission already stored ──
  if (body.submissionId) {
    const destination = typeof body.postedDestination === "string" ? body.postedDestination.slice(0, 40) : null;
    if (destination) {
      await supabaseAdmin
        .from("review_tool_submissions")
        .update({ posted_destination: destination })
        .eq("id", body.submissionId)
        // Scoped to the resolving client, so an id from one hub cannot label a row on
        // another.
        .eq("client_id", clientId);
    }
    return NextResponse.json({ id: body.submissionId });
  }

  // ── The first call: store what she wrote ──
  // Stored whether or not she goes on to post. The objection language is the asset either
  // way, and a review that never gets posted still says what a future customer is afraid of.
  const answers: ReviewAnswers = {};
  let any = false;
  for (const question of REVIEW_QUESTIONS) {
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
      question_set_version: QUESTION_SET_VERSION,
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
      attested_at: body.attested === true ? new Date().toISOString() : null,
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
