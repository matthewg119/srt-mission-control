// The friend's claim: the third and last API route reachable on a client-controlled hostname.
//
// ‼️ READ src/app/api/hub/reviews/submit/route.ts FIRST. Same security model, deliberately:
// `x-hub-host` is the ONLY statement of which client this belongs to, the header is set by
// middleware for external hosts and STRIPPED on the internal one so it cannot be forged, and
// x-forwarded-for is never read.
//
// ‼️ THE CODE IS RESOLVED WITHIN THE RESOLVED CLIENT AND THAT IS THE WHOLE SECURITY MODEL.
// `.eq("client_id", clientId).eq("code", code)` means a code minted by one clinic cannot be
// claimed on another clinic's hostname, however it was obtained. Widening this to a global lookup
// on `code` alone would turn six readable characters into a cross-tenant handle.
//
// ‼️ THIS IS THE ONE PLACE A PERSON GIVES US THEIR OWN DETAILS, which is why the page in front of
// it exists at all. Everywhere else in this lane a contact arrives second hand, from a patient
// typing her friend's number at a counter. Here the friend types their own, on the clinic's
// domain, having been told what it is for.
//
// ‼️ IT WRITES ONE ROW AND CREATES NOTHING ELSE. No lead table, no CRM record, no notification
// fan-out. The invite row IS the lead: the clinic reads it on the Review handover panel. Keeping
// it to one row is what makes "what happens to my details" answerable in one sentence on the form.
//
// NO MODEL IN THIS PATH. Nothing here imports the Anthropic SDK and nothing may.

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/db";
import { resolveHost } from "@/lib/hub/resolve";
import { normaliseCode } from "@/lib/hub/referral-invite";

export const dynamic = "force-dynamic";

/** Guards the columns, not the person. */
const MAX_FIELD = 200;

/** Generous, per client per day. Same doctrine as the other two: never an IP bucket. */
const DAILY_CAP = 500;

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value.slice(0, max) : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const hubHost = req.headers.get("x-hub-host");
  if (!hubHost) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  let body: { code?: unknown; name?: unknown; contact?: unknown; service?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const code = normaliseCode(text(body.code, 32) ?? "");
  const name = text(body.name, MAX_FIELD);
  const contact = text(body.contact, MAX_FIELD);

  if (!code || !name || !contact) {
    return NextResponse.json({ ok: false, error: "We need a name and a way to reach you." }, { status: 400 });
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabaseAdmin
    .from("referral_invites")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("claimed_at", since);

  if ((count ?? 0) >= DAILY_CAP) {
    console.error(`[hub/reviews/claim] daily cap hit for client ${clientId}`);
    return NextResponse.json({ ok: false, error: "Please give us a call instead." }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin
    .from("referral_invites")
    .select("id, expires_at, claimed_at")
    .eq("client_id", clientId)
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[hub/reviews/claim] read failed:", error.message);
    return NextResponse.json({ ok: false, error: "Please give us a call instead." }, { status: 503 });
  }

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;

  // ‼️ ONE ANSWER FOR EVERY REFUSAL, AND IT NAMES NO CAUSE. Unknown code, another clinic's code,
  // expired and already claimed are indistinguishable from out here, because telling them apart
  // tells somebody enumerating six characters which guesses were real.
  const expired = typeof row?.expires_at === "string" && new Date(row.expires_at) < new Date();
  if (!row || expired || row.claimed_at) {
    return NextResponse.json({ ok: false, error: "This link is not open any more." }, { status: 404 });
  }

  const { error: writeError } = await supabaseAdmin
    .from("referral_invites")
    .update({
      claimed_name: name,
      claimed_contact: contact,
      claimed_service: text(body.service, MAX_FIELD),
      claimed_at: new Date().toISOString(),
    })
    .eq("id", row.id as string)
    // Scoped again on the way in, so an id cannot be used across tenants even if one leaked.
    .eq("client_id", clientId)
    // ‼️ AND ONLY IF IT IS STILL UNCLAIMED. Two friends tapping the same link at once would
    // otherwise both write, and the second would overwrite the first person's details with no
    // trace that they had ever been there.
    .is("claimed_at", null);

  if (writeError) {
    console.error("[hub/reviews/claim] write failed:", writeError.message);
    return NextResponse.json({ ok: false, error: "Please give us a call instead." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
