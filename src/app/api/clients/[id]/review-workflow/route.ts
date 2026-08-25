// How the client asks for reviews, and where those reviews go. Delivery steps 29 and 30.
//
// ‼️ THIS ROUTE EXISTS BECAUSE THREE THINGS HAD READERS AND NO WRITER.
//
//   clients.review_request_mode    read by step 29's verifier and call-sheet.ts
//   clients.review_owner_name      read by step 30's verifier and call-sheet.ts
//   review_workflow.google_url     read by destinationsFor() in the hub's review tool
//   review_workflow.realself_url   same
//
// Exactly the class CLAUDE.md documents for competitor_candidates.selected and
// nap_discrepancies.confirmed_status, and the consequences were the same shape:
//
//  - **Step 29 could never be confirmed by anybody.** Its refusal read "Set it on the client
//    board" and there was no such control, on any panel, for any client.
//  - **The "Post on Google" button has never appeared, for anyone.** destinationsFor() reads
//    review_workflow.google_url; intake step 4 collects `destinations` as a multiselect of
//    display LABELS ("Google", "RealSelf") and save/route.ts writes that bag verbatim, so the
//    URL keys were never populated and every customer got the fallback hint telling her to go
//    and find the review page herself.
//  - Step 30's "(the record says X)" parenthetical never fired.
//
// ‼️ THE BAG IS MERGED, NEVER REPLACED. `review_workflow` is intake step 4's jsonb and it owns
// ten other keys (asks, who, when, tool, booking_software, volume, destinations, incentive,
// lobby_tablet, blockers). save/route.ts assigns the whole bag on every save of that step, so a
// replace here would silently delete the client's own intake answers — the answers the call
// sheet is built from.
//
// ‼️ A URL IS VALIDATED OR REFUSED, NEVER STORED AS TYPED. review-tool.tsx's rule is "absent
// beats wrong, never synthesise a link", because a guessed or fat-fingered review URL sends a
// real customer to somebody else's business to leave a review about this one. A blank clears.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** The two values clients_review_request_mode_check allows. */
const MODES = ["booking_system", "card_only"] as const;
type Mode = (typeof MODES)[number];

/** The destination keys destinationsFor() reads. Adding one here means adding one there. */
const URL_KEYS = ["google_url", "realself_url"] as const;

function textOrNull(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/**
 * A review destination URL, or a reason it was refused.
 *
 * `https` only. A review link is opened by a customer on her own phone from a page on the
 * client's domain, and an `http://` one would be a mixed-content warning at the exact moment we
 * are asking her to trust the thing. `javascript:` and `data:` are the reason this parses rather
 * than pattern-matching.
 */
function reviewUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = textOrNull(raw);
  if (s === undefined) return { ok: true, value: null };
  if (s === null) return { ok: true, value: null };

  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, error: `"${s}" is not a URL. Paste the whole link, including https://.` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: `"${s}" is not https. A review link opens on a customer's phone from the client's own domain.` };
  }
  return { ok: true, value: parsed.toString() };
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
    .select("review_workflow")
    .eq("id", clientId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found." }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // ── The mode. Step 29's whole gate. ──────────────────────────────────────────
  if (body.mode !== undefined) {
    const mode = textOrNull(body.mode);
    if (mode !== null && !MODES.includes(mode as Mode)) {
      return NextResponse.json(
        { ok: false, error: `mode must be ${MODES.join(" or ")}, or empty to clear it.` },
        { status: 400 }
      );
    }
    patch.review_request_mode = mode;
  }

  // ── The named person. Step 30 reads it to check your work. ───────────────────
  if (body.ownerName !== undefined) {
    const owner = textOrNull(body.ownerName);
    // "the front desk" is exactly what step 30's card says this may not be: a role is not a
    // person, and a handover to a role is a handover to nobody. Flagged, not refused — an
    // owner who genuinely has one receptionist is entitled to write what they want.
    patch.review_owner_name = owner;
  }

  // ── The destinations. Merged into the intake bag, never replacing it. ────────
  const workflow = { ...((client.review_workflow ?? {}) as Record<string, unknown>) };
  let touchedWorkflow = false;

  for (const key of URL_KEYS) {
    if (body[key] === undefined) continue;
    const parsed = reviewUrl(body[key]);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    if (parsed.value === null) delete workflow[key];
    else workflow[key] = parsed.value;
    touchedWorkflow = true;
  }

  if (touchedWorkflow) patch.review_workflow = workflow;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", clientId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Deliberately NOT setDeliveryStep. Recording the mode is not the same as having configured
  // the automation, and step 29's verifier says so: `card_only` is system evidence on its own,
  // `booking_system` still wants a screenshot in the thread. Same split the competitors route
  // draws between picking and ticking.
  console.log(`[clients/review-workflow] ${clientId} updated by ${actor}`);

  return NextResponse.json({
    ok: true,
    mode: (patch.review_request_mode as string | null) ?? undefined,
    destinations: URL_KEYS.filter((k) => typeof workflow[k] === "string").length,
  });
}
