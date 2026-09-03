// The "start me myself" handoff. Token gated, public route.
//
// PUBLIC BY DESIGN AND SAFE BECAUSE OF THE TOKEN. src/middleware.ts only guards /dashboard/*,
// so nothing here is behind a login: the person filling this in is a clinic owner, not a
// Mission Control user. The HMAC in ?t= is the entire access control, which is why it is
// verified on the server before a single field is rendered.
//
// ‼️ SCOPE `chatgpt_ads`, NOT `onboarding`, and verifyOnboardingToken fails closed in both
// directions. An onboarding link cannot open this page and a lead link cannot open
// /onboarding, which holds a real client's business data. The two surfaces cannot be crossed
// by pasting a URL, which is the entire reason the scope exists.
//
// A TAMPERED TOKEN AND A MISSING ONE GIVE THE SAME ANSWER. Only "expired" is distinguished,
// because that one has a useful next step and telling somebody their forged token was
// well-formed does not.

import type { Metadata } from "next";
import { verifyOnboardingToken } from "@/lib/clients/token";
import { supabaseAdmin } from "@/lib/db";
import { SETUP_COPY } from "@/lib/chatgpt-ads/setup";
import { SetupForm } from "./setup-client";

// force-dynamic alone does NOT cover the supabase-js data cache, which is what serves a
// stale row to somebody who submits and then refreshes.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Your setup",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 text-center text-lg font-bold tracking-wide">SRT Agency</div>
        {children}
      </div>
    </main>
  );
}

function Problem({ body }: { body: string }) {
  return (
    <Shell>
      <div className="rounded-xl bg-white/5 p-8 text-center">
        <p className="text-white/70">{body}</p>
      </div>
    </Shell>
  );
}

export default async function ChatgptAdsSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const verified = verifyOnboardingToken(t, "chatgpt_ads");

  if (!verified.ok) {
    return <Problem body={verified.reason === "expired" ? SETUP_COPY.expired : SETUP_COPY.broken} />;
  }

  const { data } = await supabaseAdmin
    .from("chatgpt_ads_leads")
    .select("id, email, business_name")
    .eq("id", verified.clientId)
    .maybeSingle();

  const row = data as { id: string; email: string; business_name: string | null } | null;
  // A validly signed token for a row that no longer exists is the same dead end as a broken
  // one, and it is what a deleted lead looks like.
  if (!row) return <Problem body={SETUP_COPY.broken} />;

  return (
    <Shell>
      <SetupForm leadId={row.id} businessName={row.business_name} />
    </Shell>
  );
}
