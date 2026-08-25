// The presence sweep, confirmed by a person. Delivery steps 4, 5 and 25.
//
// ‼️ THIS ROUTE EXISTS BECAUSE NOTHING WROTE nap_discrepancies.confirmed_status.
// effectiveStatus() is `confirmed_status ?? "not_checked"` and citation-cleanup.ts, findings.ts,
// call-sheet.ts and presence-pdf.ts have all read it since they shipped. Nothing ever wrote it,
// so every consumer saw eighteen rows of "not checked" forever, and citation_cleanup's verifier
// dodged that by counting the SEED column instead and returning a green tick reading "no
// listings remain at mismatch" for a client where nothing had been looked at.
//
// ‼️ IT NEVER WRITES `status`. `status` is what the seed wrote; `confirmed_status` is what a
// person says after looking at the screenshot. Runner v3 section 6: "NEVER auto-mark a listing
// verified. The tool proposes; I confirm." Nothing here may copy proposed_status into
// confirmed_status either, for the same reason: a remediation list built from a string
// comparison sends somebody to edit a client's live Google listing.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// The five values the CHECK constraint allows, plus the option to take a confirmation back.
const STATUSES = ["match", "mismatch", "duplicate", "missing", "not_checked"] as const;

function textOrNull(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
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

  if (body.action !== "confirm") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const rowId = typeof body.rowId === "string" ? body.rowId : "";
  if (!rowId) {
    return NextResponse.json({ ok: false, error: "No row given." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // "" means take the confirmation back: the row returns to unconfirmed, which effectiveStatus
  // reads as not_checked. That is a real thing to want after realising you read the wrong
  // listing, and it must not be spelled by writing 'not_checked' into confirmed_status, which
  // would be a person asserting they looked and found nothing.
  if (body.confirmedStatus !== undefined) {
    const raw = body.confirmedStatus === null ? "" : String(body.confirmedStatus);
    if (raw === "") {
      patch.confirmed_status = null;
      patch.checked_by = null;
      patch.checked_at = null;
    } else if ((STATUSES as readonly string[]).includes(raw)) {
      patch.confirmed_status = raw;
      patch.checked_by = actor;
      patch.checked_at = new Date().toISOString();
    } else {
      return NextResponse.json({ ok: false, error: "Unknown status." }, { status: 400 });
    }
  }

  for (const [field, column] of [
    ["rawName", "raw_name"],
    ["rawAddress", "raw_address"],
    ["rawPhone", "raw_phone"],
    ["listingUrl", "listing_url"],
    ["skipReason", "skip_reason"],
  ] as const) {
    const v = textOrNull(body[field]);
    if (v !== undefined) patch[column] = v;
  }

  if (typeof body.claimed === "boolean") patch.claimed = body.claimed;

  const { data: written, error } = await supabaseAdmin
    .from("nap_discrepancies")
    .update(patch)
    .eq("id", rowId)
    // Scoped by client: a valid uuid from another client's sweep must not be writable here.
    .eq("client_id", clientId)
    .select("id");

  if (error) {
    // 23505 here means the listing_url just typed collides with another row for the same
    // platform, which is the unique key doing its job: that IS the same listing twice.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Another row for this platform already carries that listing URL. A genuine second " +
            "listing needs its own URL, which is what makes it a duplicate rather than a copy.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!written?.length) {
    return NextResponse.json(
      { ok: false, error: "No such presence row for this client." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
