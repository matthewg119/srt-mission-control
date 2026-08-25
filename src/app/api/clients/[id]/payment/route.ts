// Record that payment is arranged. What unlocks delivery step 21.
//
// ‼️ IT RECORDS AN ASSERTION. IT DOES NOT TAKE, VERIFY OR OBSERVE A PAYMENT.
// Matthew's chosen mechanism, stated: he ticks it, with a note. No Stripe, no webhook, no card
// number, and this route must never grow one — the moment it did, `payment_recorded_at` would
// mean two different things on two different rows and nothing could tell them apart.
//
// Same distinction `day_0_source` draws between 'photograph_2' and 'manual_step'. See
// src/lib/clients/payment.ts and docs/2026-08-25-lane-3-payment.sql.
//
// ‼️ DELIBERATELY NOT setDeliveryStep. Recording the payment is not completing a step: it
// UNBLOCKS step 21, and step 21 still wants its own evidence (a screenshot of the GBP invite,
// Search Console and Analytics) before anybody ticks it. Same split the competitors route draws
// between picking and ticking.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { paymentFrom, paymentLine } from "@/lib/clients/payment";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Long enough to be a statement of what was agreed rather than a shrug. */
const MIN_TERMS = 4;

function textOrNull(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/**
 * The recorded date.
 *
 * ‼️ A TYPED DATE IS ACCEPTED AND A FUTURE ONE IS NOT. Payment is often agreed on the call and
 * recorded that evening, so forcing `now()` would put the wrong day on the board — and the day
 * is half of the sentence every card prints. A date in the future is not a record of something
 * that happened, so it is refused rather than quietly clamped.
 */
function recordedAt(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = textOrNull(raw);
  if (!s) return { ok: true, value: new Date().toISOString() };

  const parsed = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `"${s}" is not a date. Use YYYY-MM-DD.` };
  }
  if (parsed.getTime() > Date.now() + 60_000) {
    return {
      ok: false,
      error: "That date is in the future. This records something that has already happened.",
    };
  }
  return { ok: true, value: parsed.toISOString() };
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
  const actor = session.user.name || session.user.email || "someone";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  const { data: client, error: readError } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found." }, { status: 404 });
  }

  // ── Clearing. All four together, or the row keeps a date with no terms behind it. ──
  if (body.clear === true) {
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        payment_recorded_at: null,
        payment_recorded_by: null,
        payment_terms: null,
        payment_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    console.log(`[clients/payment] ${clientId} payment record CLEARED by ${actor}`);
    return NextResponse.json({ ok: true, cleared: true });
  }

  // ── Recording ────────────────────────────────────────────────────────────────
  const terms = textOrNull(body.terms);
  if (!terms || terms.length < MIN_TERMS) {
    // ‼️ TERMS ARE REQUIRED AND THAT IS THE WHOLE DESIGN. Without them this is a tick, and a tick
    // is what the two evidence tiers exist to refuse. The board reads this sentence back on
    // every card that mentions the payment, so it has to say something.
    return NextResponse.json(
      {
        ok: false,
        error:
          "Say what was agreed. A recorded payment with no terms is a tick, and the next person " +
          "reading this board has no way to know what was actually arranged.",
      },
      { status: 400 }
    );
  }

  const when = recordedAt(body.recordedAt);
  if (!when.ok) {
    return NextResponse.json({ ok: false, error: when.error }, { status: 400 });
  }

  const note = textOrNull(body.note);

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      payment_recorded_at: when.value,
      // ‼️ FROM THE SESSION, NEVER FROM THE BODY. It is the attribution half of an assertion,
      // and an assertion somebody could sign with anybody's name is not an attribution.
      payment_recorded_by: actor,
      payment_terms: terms,
      payment_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .select("id");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const line = paymentLine(
    paymentFrom({
      payment_recorded_at: when.value,
      payment_recorded_by: actor,
      payment_terms: terms,
      payment_note: note,
    })
  );

  console.log(`[clients/payment] ${clientId}: ${line}`);

  return NextResponse.json({ ok: true, line });
}
