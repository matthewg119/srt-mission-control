// The client intake funnel. Token gated, public route.
//
// PUBLIC BY DESIGN, and safe because of the token. src/middleware.ts only guards
// /dashboard/*, so nothing here is behind a login: the person filling this in is a
// clinic owner, not a Mission Control user. The HMAC in ?t= is the entire access
// control, which is why it is verified on the server before a single answer is loaded.
//
// The spec puts this at srtagency.com/onboarding. That is the srt-agwb repo, which
// another session owns and this build must not touch, so it lives on
// mission.srtagency.com and the welcome email links here.
//
// NO CAPTCHA. A token gated form does not need one: there is no public entry point to
// spam. A honeypot stays because it is free.

import { verifyOnboardingToken } from "@/lib/clients/token";
import { supabaseAdmin } from "@/lib/db";
import { INTAKE_STEPS } from "@/config/client-intake";
import { OnboardingFunnel } from "./funnel-client";
import type { Metadata } from "next";

// force-dynamic alone does NOT cover the supabase-js data cache. Without
// force-no-store a client who saves step 3 and refreshes can be served step 2 back.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Onboarding",
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

function Problem({ heading, body }: { heading: string; body: string }) {
  return (
    <Shell>
      <div className="rounded-xl bg-white/5 p-8 text-center">
        <h1 className="mb-3 text-xl font-bold">{heading}</h1>
        <p className="text-white/70">{body}</p>
      </div>
    </Shell>
  );
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const verified = verifyOnboardingToken(t);

  if (!verified.ok) {
    // One message for expired, another for everything else. A tampered token and a
    // missing one are the same answer on purpose: there is nothing to learn by probing.
    return verified.reason === "expired" ? (
      <Problem
        heading="This link has expired"
        body="Onboarding links last 30 days. Reply to the welcome email and we will send you a fresh one."
      />
    ) : (
      <Problem
        heading="This link is not valid"
        body="Check that you copied the whole link from the email, or reply to it and we will send a new one."
      />
    );
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select(
      "id, legal_name, dba_name, website, email, phone, address_line1, address_line2, city, state, postal_code, hours, services, ideal_patient, review_workflow, access_inventory, intake_step, intake_completed_at, onboarding_token_hash"
    )
    .eq("id", verified.clientId)
    .maybeSingle();

  if (!client) {
    return (
      <Problem
        heading="This link is not valid"
        body="We could not find the account it belongs to. Reply to the welcome email and we will sort it out."
      />
    );
  }

  // A signature alone is not enough. Clearing onboarding_token_hash revokes a link that
  // was already emailed, without rotating the secret for every other client.
  if (!client.onboarding_token_hash) {
    return (
      <Problem
        heading="This link has been retired"
        body="Reply to the welcome email and we will send you a current one."
      />
    );
  }

  // Prefill from what is already known. Step 1 starts populated from what was typed
  // when the pilot was started, so the first screen is a confirmation rather than a
  // retype, which is also what makes the NAP canonical rather than a second guess.
  const initial: Record<string, unknown> = {
    legal_name: client.legal_name ?? "",
    dba_name: client.dba_name ?? "",
    address_line1: client.address_line1 ?? "",
    address_line2: client.address_line2 ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    postal_code: client.postal_code ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    website: client.website ?? "",
    hours: client.hours ?? "",
  };

  for (const step of INTAKE_STEPS) {
    if (!step.bag) continue;
    const bag = (client[step.bag] as Record<string, unknown> | null) ?? {};
    for (const field of step.fields) {
      initial[field.key] = bag[field.key] ?? (field.kind === "multiselect" ? [] : "");
    }
  }

  // ‼️ "DONE" IS NOW WHAT IS ACTUALLY FILLED IN, NOT clients.intake_completed_at.
  //
  // It used to be `Boolean(client.intake_completed_at)`, which was true while that timestamp had
  // exactly one writer: this form's own final step. /onboarding2 broke that assumption. It sets
  // intake_completed_at from NINE funnel questions, because intake_received's verifier reads
  // that column and nothing else and four delivery steps are blocked behind it. Keying the Done
  // screen off the same timestamp meant every /onboarding2 client hit "you are all set" on this
  // link, and the access inventory it exists to collect could never be collected.
  //
  // Two requirements were in direct conflict: the board must open at the ninth answer, and the
  // GBP login, site backend, registrar, DNS, analytics and prior agencies must stay DEFERRED to
  // this token-gated link after the call. Deriving completeness from the answers satisfies both.
  //
  // For a v1 client who filled this form in properly, nothing changes: every required field has
  // a value, so firstIncomplete is null and they still see Done. For an /onboarding2 client it
  // opens on the first step with something genuinely missing, which is step 1 (`hours` is not
  // collected by the funnel) and then step 5, the access inventory.
  const missingIn = (step: (typeof INTAKE_STEPS)[number]): boolean =>
    step.fields.some((field) => {
      if (!field.required) return false;
      const value = initial[field.key];
      return Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim();
    });

  const firstIncomplete = INTAKE_STEPS.findIndex(missingIn);
  const done = firstIncomplete === -1;

  return (
    <Shell>
      <OnboardingFunnel
        token={t as string}
        businessName={(client.dba_name as string) || (client.legal_name as string)}
        initialValues={initial}
        // ‼️ THE FIRST INCOMPLETE STEP, NOT savedStep + 1. For a v1 client the two are the same
        // number: the form validates every required field before it will advance, so the first
        // step with something missing IS the one after the last one they finished. For an
        // /onboarding2 client they are not: intake_step is 1 while step 1 is still missing
        // `hours`, and resuming forward would skip the only field on that screen we need.
        startStep={done ? 0 : firstIncomplete + 1}
        alreadyComplete={done}
      />
    </Shell>
  );
}
