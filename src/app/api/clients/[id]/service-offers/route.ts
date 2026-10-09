// The per-service referral deals, written from the Review handover panel and the step thread.
//
// ‼️ A TABLE RATHER THAN MORE review_workflow KEYS, and the reasoning is in
// src/lib/hub/referral-config.ts. Short version: the panel edits one service at a time, the grid
// is orderable, both boards can write it, and "excluded from referrals" is a real state with a
// real reason. The CLINIC-WIDE fallback stays in the bag because that one genuinely is one value.
//
// ‼️ THE WHOLE GRID IS SENT AND THE WHOLE GRID IS REPLACED, which is the opposite of the rule the
// review-workflow route follows for the bag beside it, so the difference is worth stating. That
// bag is shared with intake step 4 and a replace there silently deletes a client's own answers.
// This table holds nothing but these rows, the panel always renders every row it is about to
// send, and a clinic dropping a service has to be able to remove its line. A merge would make
// deletion impossible without a second verb.
//
// ‼️ NOTHING HERE CARRIES A FIGURE. "80% off the first month, then $299" is one clinic's example.
// Every number is typed by a human on the call, because a default percentage in our code is a
// discount SRT invented turning up in a message a patient sends to her friend.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Guards the columns, not the person. A service name and a deal are both short. */
const MAX_LABEL = 200;
const MAX_OFFER = 600;
/** More services than any clinic has listed, and few enough that one page can render them. */
const MAX_ROWS = 60;

interface IncomingRow {
  serviceLabel?: unknown;
  priceLabel?: unknown;
  offerText?: unknown;
  /** What the patient who refers gets. Optional: plenty of clinics reward only the friend. */
  referrerOfferText?: unknown;
  excluded?: unknown;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value.slice(0, max) : null;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const clientId = params.id;

  let body: { rows?: unknown };
  try {
    body = (await req.json()) as { rows?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ ok: false, error: "Expected a list of services." }, { status: 400 });
  }
  if (body.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { ok: false, error: `That is more than ${MAX_ROWS} services.` },
      { status: 400 }
    );
  }

  // ‼️ A ROW WITH NO SERVICE NAME IS DROPPED, NOT REFUSED. The panel renders blank rows to type
  // into, so a half-filled grid is the normal state of the form rather than a mistake. Refusing
  // the save would mean the operator has to tidy the page before anything is kept.
  const seen = new Set<string>();
  const rows: Array<{
    client_id: string;
    service_label: string;
    price_label: string | null;
    offer_text: string | null;
    referrer_offer_text: string | null;
    excluded: boolean;
    sort_order: number;
  }> = [];

  for (const raw of body.rows as IncomingRow[]) {
    const serviceLabel = text(raw?.serviceLabel, MAX_LABEL);
    if (!serviceLabel) continue;

    // The unique index is on lower(service_label), so a duplicate typed twice in the grid would
    // fail the whole insert. The first one wins, which is what the operator sees at the top.
    const key = serviceLabel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      client_id: clientId,
      service_label: serviceLabel,
      price_label: text(raw?.priceLabel, MAX_LABEL),
      offer_text: text(raw?.offerText, MAX_OFFER),
      referrer_offer_text: text(raw?.referrerOfferText, MAX_OFFER),
      excluded: raw?.excluded === true,
      sort_order: rows.length,
    });
  }

  // Replace, in two statements. There is no transaction available through PostgREST, so the
  // delete is scoped to this client and the insert follows immediately; a failure between them
  // leaves the grid empty, which the panel shows plainly and the operator can re-save. That is a
  // better failure than a merge that cannot delete.
  const { error: clearError } = await supabaseAdmin
    .from("client_service_offers")
    .delete()
    .eq("client_id", clientId);

  if (clearError) {
    // ‼️ 42P01 MEANS THE MIGRATION HAS NOT RUN, and saying so beats "relation does not exist" on
    // a panel. docs/2026-10-05-referral-invites.sql creates this table.
    const missing = clearError.code === "42P01";
    return NextResponse.json(
      {
        ok: false,
        error: missing
          ? "The service offers table does not exist yet. Run docs/2026-10-05-referral-invites.sql."
          : clearError.message,
      },
      { status: missing ? 503 : 500 }
    );
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("client_service_offers").insert(rows);
    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}
