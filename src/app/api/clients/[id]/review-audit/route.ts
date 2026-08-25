// The review counts, typed in by a person. Delivery step 8.
//
// ‼️ THIS ROUTE EXISTS BECAUSE NOTHING WROTE review_audit_rows.review_count.
// seedReviewAudit() has created the capture grid since it shipped, findings.ts has read the
// numbers, and the step 8 verifier refused with "N rows seeded, 0 measured" and a todo saying
// "Fill them in on the client board". There was no control on the client board. No platform
// here has an API (every entry in presence-platforms.ts carries api:false), so a person reading
// the listing and typing what they see is not a fallback, it is the only path there is.
//
// ‼️ review_count STAYS NULL UNTIL SOMEBODY TYPES A NUMBER, AND THE COERCION IS THE TRAP.
// Zero reviews and un-checked are opposite claims about a business. `Number("")` is 0, so an
// empty input coerced without a guard silently asserts a business has no reviews. Every numeric
// field here goes through numOrNull(), which returns null for an empty string and undefined for
// anything that is not a number, and undefined means "not in this request, leave it alone".
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * "" -> null (a real answer: not recorded).
 * a number in range -> that number.
 * absent from the body -> undefined, so the column is not written at all and saving one row
 * cannot blank a field somebody filled in on another pass.
 */
function numOrNull(
  raw: unknown,
  opts: { min: number; max: number; integer?: boolean }
): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  if (opts.integer && !Number.isInteger(n)) return undefined;
  if (n < opts.min || n > opts.max) return undefined;
  return n;
}

function dateOrNull(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const actor = session.user.name ?? session.user.email ?? null;
  const clientId = params.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  if (body.action !== "measure") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const rowId = typeof body.rowId === "string" ? body.rowId : "";
  if (!rowId) {
    return NextResponse.json({ ok: false, error: "No row given." }, { status: 400 });
  }

  const reviewCount = numOrNull(body.reviewCount, { min: 0, max: 10_000_000, integer: true });
  const averageRating = numOrNull(body.averageRating, { min: 0, max: 5 });
  // "how many of the last 10 did the owner answer", which is what the step 8 card asks for.
  const ownerResponseRate = numOrNull(body.ownerResponseRate, { min: 0, max: 10, integer: true });
  const mostRecentReviewAt = dateOrNull(body.mostRecentReviewAt);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (reviewCount !== undefined) patch.review_count = reviewCount;
  if (averageRating !== undefined) patch.average_rating = averageRating;
  if (ownerResponseRate !== undefined) patch.owner_response_rate = ownerResponseRate;
  if (mostRecentReviewAt !== undefined) patch.most_recent_review_at = mostRecentReviewAt;

  if (typeof body.negativeThemes === "string") {
    const themes = body.negativeThemes
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    patch.negative_themes = themes.length ? themes : null;
  }

  // ‼️ checked_at and checked_by ARE STAMPED ONLY ALONGSIDE A REAL COUNT, because isRecorded()
  // requires both and stamping one without the other makes that predicate disagree with itself:
  // a row would read as checked while still carrying "not recorded" in the column findings
  // section 3 prints. Clearing the count clears the stamp for the same reason.
  if (reviewCount !== undefined) {
    patch.checked_at = reviewCount === null ? null : new Date().toISOString();
    patch.checked_by = reviewCount === null ? null : actor;
  }

  const { data: written, error } = await supabaseAdmin
    .from("review_audit_rows")
    .update(patch)
    .eq("id", rowId)
    // Scoped by client too: a valid uuid from another client's grid must not be writable here.
    .eq("client_id", clientId)
    .select("id");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  // An update that matched nothing is not success. Same trap setDeliveryStep documents.
  if (!written?.length) {
    return NextResponse.json(
      { ok: false, error: "No such review audit row for this client." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
