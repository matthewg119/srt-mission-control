// The one-time offer, reached only from a token minted by a successful $39 purchase.
//
// Server component, so the decision about WHICH offer to show is made where the
// secrets are and never shipped to the browser as a flag it could flip.
//
// Founding ($299, first five) requires ALL of: a valid signature, an unexpired
// token, an unspent token, a paid order with a saved card, and a free seat. Anything
// short of that falls through to Standard ($499).

import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/db";
import { verifyOtoToken, hashToken, foundingSeatsLeft } from "@/lib/medspa/oto";
import { isCheckoutEnabled } from "@/lib/medspa/stripe";
import { OtoClient } from "./oto-client";
import { FUNNEL_BASE } from "@/config/medspa-funnel";

export const dynamic = "force-dynamic";
// supabase-js uses the global fetch, which Next patches into the DATA cache. On this
// page a stale read decides whether someone is offered a scarce founding seat.
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "One time offer | SRT Agency",
  alternates: { canonical: `${FUNNEL_BASE}/oto` },
  robots: { index: false, follow: false },
};

export type OtoMode = "founding" | "standard_sold_out" | "standard_expired" | "invalid";

export default async function OtoPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token ?? "");

  // Signature and expiry first: a forged or stale token costs zero database reads.
  const verdict = verifyOtoToken(token);

  let mode: OtoMode = "invalid";
  let orderId: string | null = null;
  let seatsLeft = 0;

  if (verdict.ok) {
    const { data: order } = await supabaseAdmin
      .from("medspa_orders")
      .select("id, status, stripe_payment_method_id, audit_report_id")
      .eq("id", verdict.orderId)
      .maybeSingle();

    if (order && order.status === "paid") {
      orderId = order.id as string;

      const { data: tokenRow } = await supabaseAdmin
        .from("medspa_oto_tokens")
        .select("used_at")
        .eq("token_hash", hashToken(token))
        .maybeSingle();

      seatsLeft = await foundingSeatsLeft();

      const spent = Boolean(tokenRow?.used_at);
      const hasCard = Boolean(order.stripe_payment_method_id);

      if (spent) mode = "standard_expired";
      else if (seatsLeft <= 0) mode = "standard_sold_out";
      else if (!hasCard) mode = "standard_expired";
      else mode = "founding";
    }
  } else if (verdict.reason === "expired") {
    // A correctly signed but stale token still identifies a real buyer, so they get
    // the standard offer rather than a dead end. A forged one does not.
    mode = "standard_expired";
  }

  return (
    <main className="medspa-main">
      <div className="medspa-brand">
        <span className="medspa-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>SRT Agency</span>
      </div>

      <OtoClient
        mode={mode}
        token={token}
        orderId={orderId}
        seatsLeft={seatsLeft}
        checkoutEnabled={isCheckoutEnabled()}
      />

      <footer className="medspa-footer">
        <p>SRT Agency LLC, Search Retrieval Tactics</p>
        <p>Upstream of PHI. Nothing here is medical advice.</p>
      </footer>
    </main>
  );
}
