// The DNS records for one client: set a value, say it was added, or re-check.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*. Same pattern as the
// delivery-step and draft routes beside it.
//
// A human may set a VALUE and may say a record was ADDED. Only the resolver may say
// VERIFIED. That split is the whole point of the panel: "I typed it in" and "it resolves"
// are different facts, and a build stalls in the gap between them.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import {
  dnsRecordByKey,
  loadDnsRows,
  recheckDnsRecords,
  resolveDnsProvider,
  seedDnsRecords,
} from "@/lib/clients/dns-records";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, domain, subdomain")
    .eq("id", id)
    .maybeSingle();

  if (!client) return NextResponse.json({ ok: false, error: "No such client." }, { status: 404 });

  const domain = (client.domain as string) || "";
  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "That client has no domain yet, so there is nothing to point at." },
      { status: 400 }
    );
  }

  const action = typeof body.action === "string" ? body.action : "";

  // ── Seed, and work out whose registrar we are talking them through ──
  if (action === "seed") {
    await seedDnsRecords(id, (client.subdomain as string) || "learn");

    // Resolved rather than asked. "Who is your domain with" is a question plenty of
    // owners cannot answer; their nameservers answer it for them, and the call checklist
    // can then name one registrar's screens instead of listing five.
    const found = await resolveDnsProvider(domain);
    await supabaseAdmin
      .from("clients")
      .update({
        dns_provider: found.provider,
        dns_nameservers: found.nameservers,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, rows: await loadDnsRows(id), ...found });
  }

  // ── Re-check ──
  if (action === "check") {
    return NextResponse.json({ ok: true, rows: await recheckDnsRecords(id, domain) });
  }

  // ── Set a value, or mark one added ──
  const recordKey = typeof body.recordKey === "string" ? body.recordKey : "";
  if (!dnsRecordByKey(recordKey)) {
    return NextResponse.json({ ok: false, error: "Unknown record." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (action === "value") {
    const value = typeof body.value === "string" ? body.value.trim().slice(0, 2000) : "";
    patch.value = value || null;
    // A changed value invalidates any previous verification: it was verified against the
    // OLD string, and leaving the green tick up would be asserting something nobody
    // checked.
    patch.status = value ? "ready" : "pending";
    patch.verified_at = null;
    patch.observed = null;
  } else if (action === "added") {
    // What a human is allowed to assert. Not verified, deliberately.
    patch.status = "added";
  } else {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("client_dns_records")
    .update(patch)
    .eq("client_id", id)
    .eq("record_key", recordKey);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, rows: await loadDnsRows(id) });
}
