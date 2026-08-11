// /get-named, where the subscription is sold.
//
// Reached from /training. It is NOT tokenized in the single-use sense: anyone who
// gets here can buy, and revisiting shows the same thing. The `?k=` it carries is the
// same signed opt-in id /training uses, and its only job is IDENTITY: it tells the
// server who this is, so the $39 credit can be applied without asking them to prove
// they bought the audit.
//
// No `k` is a soft state, not a wall: the page still sells, it just collects an email
// in the form and runs the no-saved-card path.

import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/db";
import { verifyAccess } from "@/lib/medspa/links";
import { isCheckoutEnabled } from "@/lib/medspa/stripe";
import { GetNamedClient } from "./get-named-client";
import { FUNNEL_BASE } from "@/config/medspa-funnel";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Get named by the engines your patients ask | SRT Agency",
  alternates: { canonical: `${FUNNEL_BASE}/get-named` },
  robots: { index: false, follow: false },
};

export default async function GetNamedPage({
  searchParams,
}: {
  searchParams: { k?: string };
}) {
  const access = verifyAccess(searchParams.k);

  let email = "";
  let firstName = "";
  let city = "";
  let zip = "";
  let hasAuditCredit = false;

  if (access.ok) {
    const { data: optin } = await supabaseAdmin
      .from("medspa_optins")
      .select("email, name, city, zip")
      .eq("id", access.optinId)
      .maybeSingle();

    if (optin) {
      email = (optin.email as string) ?? "";
      firstName = ((optin.name as string) ?? "").split(/\s+/)[0] ?? "";
      city = (optin.city as string) ?? "";
      zip = (optin.zip as string) ?? "";

      // The credit is decided HERE, from a paid order, not from anything the browser
      // sends. The subscribe route re-derives it the same way before charging, so a
      // tampered client cannot conjure a discount.
      const { data: paid } = await supabaseAdmin
        .from("medspa_orders")
        .select("id, city, zip")
        .eq("email", email)
        .eq("status", "paid")
        .limit(1)
        .maybeSingle();

      if (paid) {
        hasAuditCredit = true;
        city = city || ((paid.city as string) ?? "");
        zip = zip || ((paid.zip as string) ?? "");
      }
    }
  }

  return (
    <main className="medspa-main">
      {/* A div, never a link. The funnel has no exit. */}
      <div className="medspa-brand">
        <span className="medspa-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>SRT Agency</span>
      </div>

      <GetNamedClient
        email={email}
        firstName={firstName}
        city={city}
        zip={zip}
        hasAuditCredit={hasAuditCredit}
        checkoutEnabled={isCheckoutEnabled()}
      />

      <footer className="medspa-footer">
        <p>SRT Agency LLC, Search Retrieval Tactics</p>
        <p>Upstream of PHI. Nothing here is medical advice.</p>
      </footer>
    </main>
  );
}
