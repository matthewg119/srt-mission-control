// The referral claim form: what the friend opens when a patient texts them a link.
//
// Matthew, 2026-10-05: "lets just make sure we send a link with a form they can complete so the
// customer receives the lead." This is that form. The code travels in the URL, the friend says
// who they are, and the clinic has a lead the moment it is submitted rather than whenever
// somebody happens to walk in quoting a code.
//
// ‼️ IT IS A PUBLIC PAGE ON EVERY CLIENT HOSTNAME, so what it can do is deliberately tiny.
//
//   - The code is resolved WITHIN the host's own client (`.eq("client_id", client.id)`), so a code
//     minted by one clinic cannot be claimed on another clinic's domain. That scoping is the
//     whole security model of the page and must not be relaxed to a global lookup.
//   - It reads one row and renders two strings off it. It is not a session, grants nothing, and
//     carries no link to anything else on the hub.
//   - Every failure is the SAME page. An expired code, a code for another clinic and a code that
//     never existed all render "this link is not open", because the alternative distinguishes a
//     real code from a guessed one for anybody enumerating six characters.
//
// ‼️ IT DOES NOT SHOW THE REFERRER'S NAME TO THE FRIEND, and that is not an oversight. The
// patient's name is on the row and it would make warmer copy, but she typed her friend's details
// into a tool at a counter and was not asked whether her own name could be shown to them on a web
// page. The message she sent already said who it was from, in her own words, from her own number.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveHost } from "@/lib/hub/resolve";
import { supabaseAdmin } from "@/lib/db";
import { normaliseCode } from "@/lib/hub/referral-invite";
import { referralEmailConfig } from "@/lib/hub/referral-config";
import { revSerif } from "../../reviews/rev-font";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

interface Props {
  params: { host: string; code: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolveHost(decodeURIComponent(params.host)).catch(() => null);
  const name = resolved?.status === "ok" ? resolved.client.displayName : null;
  return {
    title: name ? `Your offer at ${name}` : "Your offer",
    // ‼️ NEVER INDEXED. It is one person's link, it expires, and a search result for a referral
    // code is a code anybody can claim.
    robots: { index: false, follow: false },
  };
}

export default async function ClaimPage({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const code = normaliseCode(params.code);

  const resolved = await resolveHost(host).catch(() => null);
  // The claim link is minted on the reviews host, so that is the only kind that answers here.
  if (!resolved || resolved.status !== "ok" || resolved.kind !== "reviews") notFound();

  const { client } = resolved;
  const emailConfig = referralEmailConfig(client);

  let offer: string | null = null;
  let open = false;

  if (code) {
    const { data, error } = await supabaseAdmin
      .from("referral_invites")
      .select("offer_snapshot, expires_at, claimed_at")
      .eq("client_id", client.id)
      .eq("code", code)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      // Logged, never shown. A broken read renders the closed page, which is the same thing the
      // friend sees for an expired code, so nothing about our internals reaches them.
      console.error("[hub/claim] read failed:", error.message);
    } else {
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (row) {
        const snapshot = (row.offer_snapshot ?? {}) as Record<string, unknown>;
        const text = typeof snapshot.offerText === "string" ? snapshot.offerText.trim() : "";
        const expired = typeof row.expires_at === "string" && new Date(row.expires_at) < new Date();
        // ‼️ ALREADY CLAIMED IS CLOSED, NOT AN ERROR. A friend who submits the form and then taps
        // the same link again should be told it is done, not invited to send a second lead.
        const claimed = Boolean(row.claimed_at);
        if (text && !expired && !claimed) {
          offer = text;
          open = true;
        }
      }
    }
  }

  const where = [client.city, client.state].filter(Boolean).join(", ") || null;

  return (
    <main className="hub-wrap">
      {/*
        ‼️ THE SAME SECTION THE WALK OPENS IN, AND THAT IS THE POINT (2026-10-07). This page used
        to be a bare hub masthead over a tinted offer line, so the patient met a designed card at
        the counter and the friend she texted met a document. One frame, one lockup and one type
        scale means the thing she recommended looks like the thing they opened.

        Matthew, on the walk: "ideally i want it to stay in the same section." It applies here for
        the same reason it applied there: nothing on this page is a second container.
      */}
      <div className={`rev-frame ${revSerif.variable}`}>
        <header className="rev-open-id">
          <span className="rev-open-mark" aria-hidden="true">
            {client.displayName.trim().charAt(0).toUpperCase()}
          </span>
          <span className="rev-open-who">
            <span className="rev-open-name">{client.displayName}</span>
            {where ? <span className="rev-open-where">{where}</span> : null}
          </span>
        </header>

        <div className="rev-open">
          {open ? (
            <>
              {/*
                ‼️ THE EYEBROW SAYS A PATIENT SENT IT AND NEVER WHICH ONE. The referrer's name is
                on the row and would make warmer copy; she was never asked whether it could be
                shown on a web page to the person she texted. See this file's header.
              */}
              <p className="rev-open-eyebrow">A patient sent you this</p>
              <h1 className="rev-open-title">You have been recommended</h1>
              <p className="rev-open-lede">
                A patient of ours thought you would like this. Here is what they set aside for you.
              </p>
            </>
          ) : (
            <>
              <p className="rev-open-eyebrow">This link is closed</p>
              <h1 className="rev-open-title">It is not open any more</h1>
              <p className="rev-open-lede">
                It may have already been used, or it may have run out. Give us a call and we will
                sort it out.
              </p>
            </>
          )}

          {open && offer ? (
            <>
              <p className="rev-offer">{offer}</p>
              {/* The email field exists only when this clinic actually sends the confirmation. See
                  the prop's own comment in claim-form.tsx. */}
              <ClaimForm
                code={code}
                businessName={client.displayName}
                askEmail={emailConfig.enabled && emailConfig.emailFriend}
              />
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
