// Turning a signature plus six answers into a running delivery board.
//
// ‼️ THIS IS THE HALF THAT WAS MISSING. provisionFromSigning() creates the clients row, routes
// through ingestLead and posts the signed card. That is where /onboarding2 stopped, and the
// 35-step delivery board never opened, because the ONLY thing that has ever opened one is
// api/onboarding/save finishing the v1 intake form. A signed client sat in Slack with nothing
// seeded and nothing running.
//
// ‼️ TWO ENTRY POINTS, AT TWO DIFFERENT MOMENTS, AND THE SPLIT IS DELIBERATE (Matthew, 2026-09-02).
//
//   openOpsThread()  at SIGNATURE. The client exists, so it gets a thread.
//   startDelivery()  at the LAST ANSWER. The intake is genuinely complete, so the board opens.
//
// Opening the board at signature instead would look tidier and would be wrong: intake_received's
// verifier (step-verify.ts:239) requires clients.intake_completed_at, and baseline_scan,
// site_dns_intel, nap_sweep and hub_preview are all blockedBy intake_received. Somebody who
// signs and then abandons the chat would get a board stalled on step 1 with four steps behind it.
//
// ‼️ NOTHING HERE MAY COST THE SIGNATURE OR AN ANSWER. Both are committed before either function
// runs. Every step is caught, collected as a warning and returned. Nothing throws to a caller.
//
// ‼️ EVERY CLAIM IS A CONDITIONAL UPDATE, so a retry collides instead of doing the work twice.
// ops_thread_ts claims on `.is("ops_thread_ts", null)`; the cascade claims on
// `.is("intake_completed_at", null)`. Neither needs a column of its own, which is why the only
// migration this feature shipped is one text column for the signer's name.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { normalizeTarget } from "@/lib/scan/normalize";
import { normalizeAddress, normalizeState } from "@/lib/clients/normalize";
import { QUALIFYING_QUESTIONS } from "@/config/onboarding2";
import { appUrl, onboardingChannel } from "./constants";
import type { Onboarding2LeadRow, Onboarding2SigningRow } from "./types";

/**
 * The six answers, keyed.
 *
 * Missing is normal, not an error: this is called on the completion path, but a lead row can be
 * read at any point and every consumer below handles an absent value by writing nothing.
 */
function answers(lead: Onboarding2LeadRow | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of lead?.qualifying ?? []) {
    const value = (a.answer ?? "").trim();
    if (value) out[a.key] = value;
  }
  return out;
}

/** Set a key only when there is something to set. Keeps empty strings out of the jsonb bags. */
function put(bag: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value && value.trim()) bag[key] = value.trim();
}

export interface IntakePatch {
  patch: Record<string, unknown>;
  /** Derived from the screen-one website, or null when they typed something unreadable. */
  domain: string | null;
}

/**
 * The signature block and the six answers, mapped onto the columns and jsonb bags that
 * api/onboarding/save writes. PURE, so _probe-onboarding2-chat.ts can assert the mapping
 * without a database.
 *
 * ‼️ TWO KEYS THIS USED TO WRITE ARE GONE, AND THE READERS THAT WANTED THEM NOW GET NOTHING.
 * The questions behind them were deleted on 2026-09-03 (Matthew: the six that remain are the six
 * worth asking on a funnel). Recorded here rather than quietly dropped, because every one of
 * these is a reader with no writer, which is the exact fault this file was written to avoid, and
 * a later lane replaces the supply from our own audit data:
 *
 *   top_competitor  fed services.competitors. competitors.ts:141 reads it and splits it, and
 *                   question-sets.ts:264 reads it for the named-rival question. The
 *                   competitor_shortlist step still runs, on rivals the baseline scan discovered,
 *                   without the name the owner would have given us.
 *   top_objection   fed ideal_patient.objections AND ideal_patient.objection_1. harvest.ts:406
 *                   seeds avatar_harvest phrase discovery from `objections`, deep-research-run.ts
 *                   prints it as an owner fact, and ownerPhrases() in custom-question-set.ts:121
 *                   reads `objection_1`. custom_question_set now draws only on the harvested
 *                   phrase bank, and avatar_harvest seeds from highest_margin and the city alone.
 *
 * ‼️ website NO LONGER COMES FROM AN ANSWER. It is collected on screen one and lives on the
 * SIGNING row. That is load-bearing rather than cosmetic: see the domain block below.
 *
 * ‼️ highest_margin_service GOES IN TWO PLACES, and that is not a bug.
 * `ideal_patient.highest_margin` is the winner of the `[treatment]` substitution chain in
 * substitutionsWithProvenance(), which the call sheet, the custom question set and the page
 * candidates all read. `services.services_list` is the fallback in that same chain. Filling
 * both means the substitution resolves whichever way a later reader asks for it.
 */
export function intakePatchFrom(
  signed: Onboarding2SigningRow,
  lead: Onboarding2LeadRow | null
): IntakePatch {
  const a = answers(lead);
  const now = new Date().toISOString();

  const services: Record<string, unknown> = {};
  put(services, "services_list", a.highest_margin_service);
  // ‼️ THE KEY deep-research-run.ts HAS ALWAYS READ AND NOTHING HAS EVER WRITTEN. Without this
  // line the research prompt says "Sells: not recorded" and asks who buys "this", on every
  // client, forever. It is a separate answer from highest_margin on purpose: the most profitable
  // service and the one they want more of are usually different, and this is the one the pages,
  // the posts and the free offer are aimed at.
  put(services, "primary_treatment", a.primary_treatment);

  const idealPatient: Record<string, unknown> = {};
  put(idealPatient, "highest_margin", a.highest_margin_service);
  put(idealPatient, "avg_patient_value", a.avg_patient_value);
  put(idealPatient, "new_patients_monthly", a.new_patients_monthly);
  put(idealPatient, "monthly_revenue", a.monthly_revenue);

  const reviewWorkflow: Record<string, unknown> = {};
  put(reviewWorkflow, "booking_software", a.booking_software);

  // ‼️ THE PLATFORM NAME, AND DELIBERATELY NOT A URL. `review_destination` is one of six names
  // the funnel offers, and it decides the ORDER of the buttons in the review tool plus which URL
  // field the Review handover panel needs filled. destinationsFor() in
  // app/hub/[host]/reviews/review-tool.tsx renders a destination only where a HUMAN pasted the
  // real URL, and that stays true: "absent beats wrong", because a link built from a business
  // name sends a real patient to somebody else's profile.
  //
  // Written in both shapes because both already have readers: `destinations` is the array intake
  // step 4 writes into this same bag, and review_destination_primary is the column call-sheet.ts,
  // hub/resolve.ts and hub/page-preview.ts read. Lowercased to match the column's 'google'
  // default and the PLATFORMS keys.
  const destination = a.review_destination ? a.review_destination.trim().toLowerCase() : "";
  if (destination) reviewWorkflow.destinations = [a.review_destination];

  // ‼️ PARTIAL, AND IT SAYS SO. The rest of the access inventory (GBP login, site backend,
  // registrar and DNS, analytics, prior agencies) stays deferred to the token-gated /onboarding
  // link after the call, which is the correct place for it. Recording `source` stops a later
  // reader mistaking one yes/no for a completed inventory.
  const accessInventory: Record<string, unknown> = {};
  put(accessInventory, "gbp", a.has_gbp);
  if (Object.keys(accessInventory).length) accessInventory.source = "onboarding2_funnel_partial";

  const patch: Record<string, unknown> = {
    updated_at: now,
    // ‼️ THE COLUMN THE WHOLE CASCADE TURNS ON. intake_received's verifier reads this and
    // nothing else, and four steps are blockedBy it.
    intake_completed_at: now,
    onboarding_status: "intake_complete",
    // ‼️ THE BUSINESS NAME NOW COMES FROM THE QUESTIONS, WITH THE SIGNING ROW AS A FALLBACK, AND
    // THE ORDER MATTERS. `business_legal_name` was typed into a signature block that no longer
    // exists, so on every session since 2026-09-04 it is null and `a.business_name` is the only
    // source. Rows from the form era have the column and no answer, so both are read, answer
    // first. Without this, startPilot falls back to the email address and every board in Mission
    // Control shows "someone@clinic.com" where a company name belongs.
    ...(a.business_name || signed.business_legal_name
      ? { legal_name: a.business_name || signed.business_legal_name }
      : {}),
    ...(signed.address_line1 ? { address_line1: normalizeAddress(signed.address_line1) } : {}),
    ...(signed.address_city ? { city: signed.address_city } : {}),
    ...(signed.address_state ? { state: normalizeState(signed.address_state) } : {}),
    ...(signed.address_postal ? { postal_code: signed.address_postal } : {}),
    // Already E.164 on the signing row: the email route normalises with normalizeLeadPhone and
    // keeps the typed string separately. Re-normalising here would be a second opinion.
    ...(signed.contact_phone ? { phone: signed.contact_phone } : {}),
    ...(signed.contact_email ? { email: signed.contact_email } : {}),
  };

  // dba_name is the public-facing name. The person's own name is the best thing we have until
  // somebody corrects it on the call, and it beats leaving the boards labelled with a legal
  // entity nobody says out loud.
  const dba = (signed.contact_name || signed.print_name || "").trim();
  if (dba) patch.dba_name = dba;

  // ‼️ THE WEBSITE WRITES `domain` AS WELL AS `website`, AND SKIPPING THAT IS THE TRAP THAT COST
  // V1 EIGHT STEPS. api/onboarding/save's own comment records it: hostsFor(), seedDnsRecords()
  // and the entire hub lane are built from `domain`, so hub_preview fails with "No domain on
  // file" and takes review_tool_preview, review_card_pdf, concierge_preview, dns_records,
  // subdomain_live, first_page and review_tool_handed down with it.
  //
  // ‼️ IT COMES OFF THE SIGNING ROW NOW, NOT OFF AN ANSWER (2026-09-03). The website moved to
  // screen one when the question set went from nine to six, and this line moved with it. Reading
  // `a.website` here after that move would have compiled, run, and quietly left `domain` null on
  // every client this funnel produces, which is the same eight-step stall in a new coat.
  let domain: string | null = null;
  const typedWebsite = (signed.website ?? "").trim();
  if (typedWebsite) {
    const normalized = normalizeTarget(typedWebsite);
    if (normalized.ok) {
      patch.website = normalized.target.website;
      patch.domain = normalized.target.domain;
      domain = normalized.target.domain;
    } else {
      // Unreadable is not fatal. Keep what they typed and let the hub lane refuse loudly later
      // rather than dropping the answer on the floor.
      patch.website = typedWebsite;
    }
  }

  if (Object.keys(services).length) patch.services = services;
  if (Object.keys(idealPatient).length) patch.ideal_patient = idealPatient;
  if (Object.keys(reviewWorkflow).length) patch.review_workflow = reviewWorkflow;
  if (Object.keys(accessInventory).length) patch.access_inventory = accessInventory;
  // Mirrors the v1 column api/onboarding/save writes at its step 4. The call sheet reads it.
  if (a.booking_software) patch.booking_software = a.booking_software;
  // The column, alongside the bag above. Both already have readers; see the note by
  // reviewWorkflow.destinations for why this is a name and never a link.
  if (destination) patch.review_destination_primary = destination;

  // ‼️ 1, NOT TOTAL_STEPS, AND THE DIFFERENCE IS NOT COSMETIC. This funnel never rendered the
  // v1 form, so claiming step 6 would be a lie told to the resume logic. Screen one plus the
  // signature block cover step 1 apart from `hours`, so 1 is the honest high-water mark.
  // /onboarding decides where to reopen from what is actually MISSING, not from this number.
  patch.intake_step = 1;

  return { patch, domain };
}

/**
 * Open the internal ops thread for a freshly provisioned client, and claim its ts.
 *
 * ‼️ THIS IS A SECOND, SEPARATE SLACK MESSAGE, AND REUSING THE SIGNED CARD INSTEAD IS A TRAP
 * THAT LOOKS LIKE A CLEANUP. Both land in the same channel, so the card looks like the natural
 * anchor. But postDeliveryChecklist() calls refreshHeader(), which does
 * `slack.updateMessage(channel, opsThreadTs, headerText(...))` (step-board.ts:521). It
 * OVERWRITES the message. Pointing ops_thread_ts at the signed card would erase that card, its
 * PDF link and its "SIGNED BUT NOT PROVISIONED" warning the instant the board opened.
 *
 * The signed card keeps its own ts in onboarding2_signings.slack_thread_ts and is never touched.
 * The qualifying summary still threads under it.
 */
export async function openOpsThread(args: {
  clientId: string;
  name: string;
}): Promise<{ ts: string | null; warning: string | null }> {
  const channel = onboardingChannel();
  if (!channel) {
    return {
      ts: null,
      warning:
        "SLACK_CLIENT_ONBOARDING_CHANNEL is unset, so no ops thread was opened and the delivery board cannot be posted.",
    };
  }

  const lines = [
    `:white_check_mark: *${args.name}* signed the onboarding agreement.`,
    `${appUrl()}/dashboard/clients/${args.clientId}`,
  ];

  const posted = (await slack.postMessage(channel, lines.join("\n")).catch((e) => {
    console.error("[onboarding2/delivery] ops thread post failed:", (e as Error).message);
    return null;
  })) as { ok?: boolean; ts?: string } | null;

  if (!posted?.ok || !posted.ts) {
    return { ts: null, warning: "Slack refused the ops thread post, so the board cannot open." };
  }

  // Conditional on null, so two completions racing cannot produce two threads. Same pattern
  // lead-thread.ts and api/onboarding/save both use.
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ ops_thread_ts: posted.ts, updated_at: new Date().toISOString() })
    .eq("id", args.clientId)
    .is("ops_thread_ts", null);

  if (error) {
    return { ts: posted.ts, warning: `ops_thread_ts could not be stored: ${error.message}` };
  }
  return { ts: posted.ts, warning: null };
}

export interface DeliveryResult {
  started: boolean;
  /** False when another request already ran the cascade for this client. */
  claimed: boolean;
  warnings: string[];
}

/**
 * The ninth answer landed. Complete the intake and open the board.
 *
 * ORDER IS LOAD-BEARING. The domain and the subdomain have to exist before
 * postDeliveryChecklist runs, because that function runs the ready auto steps and hub_preview
 * attaches hostnames built from exactly those two columns.
 */
export async function startDelivery(
  signed: Onboarding2SigningRow,
  lead: Onboarding2LeadRow | null
): Promise<DeliveryResult> {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    console.error(`[onboarding2/delivery] ${msg}`);
    warnings.push(msg);
  };

  const clientId = signed.client_id;
  if (!clientId) {
    // The seat cap deletes the row startPilot inserted, so this is a real and expected state.
    // The signature stands; there is simply nothing to open a board against.
    return {
      started: false,
      claimed: false,
      warnings: ["No client row for this signing, so no delivery board was opened."],
    };
  }

  // ‼️ DEMO MODE. A preview walk-through must not seed a board or fire a baseline scan.
  if (signed.is_demo) {
    console.info(
      `[onboarding2 DEMO] intake complete for signing ${signed.id}. No board, no scan, no Slack.`
    );
    return { started: false, claimed: false, warnings: [] };
  }

  const { patch, domain } = intakePatchFrom(signed, lead);

  // ── 1. The claim. Whoever sets intake_completed_at first runs the rest. ──
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("clients")
    .update(patch)
    .eq("id", clientId)
    .is("intake_completed_at", null)
    .select("id, domain, subdomain")
    .maybeSingle();

  if (claimErr) {
    warn(`intake write failed: ${claimErr.message}`);
    return { started: false, claimed: false, warnings };
  }
  if (!claimed) {
    // Already complete. Another request won, or this client finished their v1 intake first.
    return { started: false, claimed: false, warnings };
  }

  // ── 2. The subdomain. Needs the domain that step 1 just wrote. ──
  // Skipped without one, because a DNS lookup of "learn.null" is not a check worth running, and
  // guarded on a still-null subdomain so a re-run cannot flip a convention somebody has already
  // read down a phone.
  if (domain && !claimed.subdomain) {
    const { chooseSubdomain } = await import("@/lib/clients/provision");
    await chooseSubdomain(clientId, domain).catch((e) =>
      warn(`subdomain choice failed: ${(e as Error).message}`)
    );
  }

  // ── 3. The hub caches the canonical NAP for five minutes. We just wrote it. ──
  try {
    const { revalidateClientHub } = await import("@/lib/hub/resolve");
    revalidateClientHub();
  } catch (e) {
    warn(`hub revalidate failed: ${(e as Error).message}`);
  }

  // ── 4. The eight-stage record, so the client board reads right. ──
  await supabaseAdmin
    .from("client_onboarding_steps")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("stage", "intake")
    .then(({ error }) => {
      if (error) warn(`intake stage update failed: ${error.message}`);
    });

  // ── 5. The board. Each piece caught separately, exactly as api/onboarding/save does it. ──
  const { seedDeliverySteps, autoCompleteStep, postDeliveryChecklist } = await import(
    "@/lib/clients/delivery-checklist"
  );

  await seedDeliverySteps(clientId).catch((e) =>
    warn(`seeding the delivery steps failed: ${(e as Error).message}`)
  );
  await autoCompleteStep(clientId, "intake_received").catch((e) =>
    warn(`intake_received could not be ticked: ${(e as Error).message}`)
  );
  await postDeliveryChecklist(clientId).catch((e) =>
    warn(`the delivery board did not post: ${(e as Error).message}`)
  );

  // ── 6. Photograph I. ──
  // ‼️ NOT OPTIONAL AND NOT COVERED BY THE LINE ABOVE. postDeliveryChecklist runs the ready auto
  // steps, but api/onboarding/save calls this explicitly as well, and baseline_scan gates
  // competitor_shortlist, avatar_confirmed and avatar_harvest. Skipping it stalls the board at
  // step 2. NOT awaited into the caller: runAuditPipeline takes minutes.
  try {
    const { startBaselineScan } = await import("@/lib/clients/baseline-scan");
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      startBaselineScan(clientId).catch((e) =>
        console.error("[onboarding2/delivery] baseline scan failed:", (e as Error).message)
      )
    );
  } catch (e) {
    warn(`baseline scan could not be started: ${(e as Error).message}`);
  }

  return { started: true, claimed: true, warnings };
}

/** How many of the six are answered. Used by the chat route to decide whether to start. */
export function answeredCount(lead: Onboarding2LeadRow | null): number {
  return Object.keys(answers(lead)).length;
}

/** The six question keys, for probes and for the outstanding list. */
export const QUALIFYING_KEYS = QUALIFYING_QUESTIONS.map((q) => q.key);
