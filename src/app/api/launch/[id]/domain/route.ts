// Search for a domain, buy one, and attach it.
//
// ‼️ THREE SEPARATE ACTIONS, AND search IS THE ONLY ONE THAT IS FREE.
// `buy` charges a card. It is never reachable by a GET, never retried automatically, and never
// called without a price the caller was shown. See the header of src/lib/launch/domain.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { searchDomains, buyDomain, attachSiteHosts, registrantContact } from "@/lib/launch/domain";
import { setLaunchStepOutput } from "@/lib/launch/steps";
import { revalidateClientHub } from "@/lib/hub/resolve";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const actor = session.user.name ?? session.user.email ?? "the dashboard";

  let body: { action?: unknown; domains?: unknown; domain?: unknown; expectedPriceCents?: unknown; years?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // ── search ────────────────────────────────────────────────────────────────
  if (body.action === "search") {
    const domains = Array.isArray(body.domains) ? body.domains.filter((d) => typeof d === "string") : [];
    if (domains.length === 0) {
      return NextResponse.json({ ok: false, error: "Give it some names to check." }, { status: 400 });
    }
    const result = await searchDomains(domains as string[]);

    // Said here rather than at buy time, so the person finds out the purchase path is
    // unconfigured while they are still choosing, not after they have picked one.
    const contact = registrantContact();
    return NextResponse.json({
      ...result,
      buyable: contact.ok,
      buyableNote: contact.ok ? null : contact.error,
    });
  }

  // ── buy ───────────────────────────────────────────────────────────────────
  if (body.action === "buy") {
    const domain = typeof body.domain === "string" ? body.domain : "";
    const expectedPriceCents = typeof body.expectedPriceCents === "number" ? body.expectedPriceCents : 0;

    if (!domain) return NextResponse.json({ ok: false, error: "Which domain?" }, { status: 400 });
    if (!Number.isInteger(expectedPriceCents) || expectedPriceCents <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No price was supplied. A domain is only ever bought at a price somebody was shown, " +
            "so search again and buy from those results.",
        },
        { status: 400 }
      );
    }

    const bought = await buyDomain({
      clientId: id,
      domain,
      expectedPriceCents,
      years: typeof body.years === "number" ? body.years : 1,
      by: actor,
    });
    if (!bought.ok) return NextResponse.json(bought, { status: 400 });

    // Attaching immediately, because a bought domain that is not attached serves nothing and the
    // step would sit refusing with the money already spent.
    const attached = await attachSiteHosts({ clientId: id, domain: bought.domain });
    if (attached.ok) await revalidateClientHub();
    await setLaunchStepOutput(id, "domain_bought", bought.domain);

    return NextResponse.json({ ...bought, attach: attached });
  }

  // ── attach ────────────────────────────────────────────────────────────────
  // For a domain already bought, where only the attach half failed. It does not buy anything.
  if (body.action === "attach") {
    const { data: order } = await supabaseAdmin
      .from("client_domain_orders")
      .select("domain")
      .eq("client_id", id)
      .eq("status", "bought")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const domain = (order?.domain as string | null) ?? (typeof body.domain === "string" ? body.domain : "");
    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "No bought domain is on file for this client." },
        { status: 400 }
      );
    }

    const attached = await attachSiteHosts({ clientId: id, domain });
    if (attached.ok) await revalidateClientHub();
    return NextResponse.json(attached, { status: attached.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "`action` must be search, buy or attach." }, { status: 400 });
}
