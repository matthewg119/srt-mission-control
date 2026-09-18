// Publishing a page: the two rails, in order, in ONE place.
//
// ‼️ WHY THIS MODULE EXISTS, AND WHAT IT IS CAREFUL NOT TO BREAK.
//
// CLAUDE.md records that an Approve control was dropped on Matthew's call, and that
// `page_publish_request` in the Slack actions route "DOES NOT PUBLISH, AND IT MUST NOT BE CHANGED
// TO", because "a second publisher here would be a second place to get the ordering wrong, on a
// surface with no session behind it".
//
// That objection is about ORDERING BEING DUPLICATED, not about which process presses the button.
// Matthew asked for an Approve press in the drafting channel (2026-09-22), so the fix is the one
// the objection itself points at: the ordering now lives in exactly one function, and both the
// board and Slack call it. There is still only one implementation to get wrong.
//
// ‼️ THE TWO HOLE CHECKS STILL HOLD, AND THEY ARE THE WHOLE POINT. Both greps (see the header of
// page-gate.ts and the bottom of day-zero.ts) must return exactly ONE caller each, and both of
// those callers are in this file.
//
// Before this module they were satisfied inside the route. They are satisfied here instead, and
// the route calls publishPage(). Nothing gained a second path to publishing: the number of places
// that can flip client_pages.status is still one.
//
// ‼️ AND DO NOT WRITE EITHER CALL OUT IN FULL IN A COMMENT ANYWHERE. The checks grep the source as
// TEXT, so a comment quoting the call verbatim counts as a second call site and fails the check it
// was trying to document. That happened while this file was being written. test-onboarding-
// artifacts.ts records the mirror-image failure: a strip that ate the real call and made the check
// report ZERO, which fails OPEN and is worse.
//
// ‼️ NO FOURTH client_pages.status VALUE, AND THAT REFUSAL IS UNCHANGED. Approval is not a state a
// page moves through. It is a recorded gate verdict plus somebody pressing publish, exactly as it
// has been since 2026-08-26. An "approved" status would be a second hard rail with no verdict
// behind it, and the gate already is the rail.

import { supabaseAdmin } from "@/lib/db";
import { setPublished } from "@/lib/hub/pages";
import { assertGatePassed, isGateError } from "@/lib/hub/page-gate";
import { assertDay0Archived, isDay0Error, DAY_ZERO_STEP_KEY } from "@/lib/clients/day-zero";
import { autoCompleteStep, stepByKey } from "@/lib/clients/delivery-checklist";
import { capturePage } from "@/lib/clients/page-dataset";
import { subdomainLabel } from "@/lib/clients/normalize";
import type { GateCheck } from "@/lib/hub/page-gate";

export type PublishRefusal =
  | { blockedBy: "day_0"; error: string; stepKey: string; waivable: true }
  | { blockedBy: "quality_gate"; error: string; gateReason: string; checks: GateCheck[]; waivable: boolean }
  | { blockedBy: "not_found"; error: string; waivable: false };

export type PublishResult =
  | { ok: true; slug: string; pageUrl: string | null }
  | { ok: false; refusal: PublishRefusal };

/**
 * Publish or unpublish one page, through both rails, in the order that matters.
 *
 *   assertDay0Archived  ->  assertGatePassed  ->  setPublished  ->  capturePage  ->  autoCompleteStep
 *
 * ‼️ THE ORDERING IS THE WHOLE POINT OF BOTH RAILS AND IT MUST NOT MOVE. Publishing is not one
 * write: it flips client_pages.status, ticks a delivery step, refreshes the Slack checklist, posts
 * a thread reply and INSERTS a client_messages row telling the client their page is live. A check
 * placed after any of that has already said something that should not have been said.
 *
 * Day 0 comes FIRST because it is the more fundamental refusal: telling somebody their page is
 * generic when the real problem is that publishing destroys the measurement baseline sends them to
 * fix the wrong thing.
 *
 * ‼️ UNPUBLISHING IS NEVER GATED. Taking a page down is the remedy, not the harm.
 */
export async function publishPage(args: {
  clientId: string;
  pageId: string;
  publish: boolean;
  /** Recorded on the capture and on the checklist tick. An email from the board, a Slack name from the card. */
  by: string;
}): Promise<PublishResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, domain, subdomain")
    .eq("id", args.clientId)
    .maybeSingle();

  if (!client) {
    return { ok: false, refusal: { blockedBy: "not_found", error: "That client does not exist.", waivable: false } };
  }

  if (args.publish) {
    try {
      await assertDay0Archived(
        args.clientId,
        (client.dba_name as string | null) ?? (client.legal_name as string),
        // Quote the checklist row back in its own words, so the error names the thing to go and
        // tick rather than a paraphrase of it.
        stepByKey(DAY_ZERO_STEP_KEY)?.label
      );
    } catch (e) {
      if (!isDay0Error(e)) throw e;
      return { ok: false, refusal: { blockedBy: "day_0", error: e.message, stepKey: e.stepKey, waivable: true } };
    }

    try {
      await assertGatePassed(args.clientId, args.pageId);
    } catch (e) {
      if (!isGateError(e)) throw e;
      return {
        ok: false,
        refusal: {
          blockedBy: "quality_gate",
          error: e.message,
          gateReason: e.reason,
          checks: e.checks ?? [],
          // A never-run or stale gate is not waivable: the answer is to press Check, and offering
          // a waiver there would train people to skip the cheap fix. Only a real refusal is waivable.
          waivable: e.reason === "blocked",
        },
      };
    }
  }

  const result = await setPublished(args.clientId, args.pageId, args.publish);
  if (!result.ok) {
    return { ok: false, refusal: { blockedBy: "not_found", error: result.error, waivable: false } };
  }

  // ‼️ THE SNAPSHOT OF WHAT SHIPPED, AND IT IS THE MOST VALUABLE ROW IN THE DATASET. Every other
  // capture is a draft; this one is the version that went on somebody's domain, after whatever
  // editing happened in between. Fire and forget: losing a research row must never fail a publish
  // that has already passed both rails.
  //
  // ‼️ planRowId IS RESOLVED FIRST. Without it the most valuable row in the corpus is the one that
  // knows least: capturePage reads the angle, narrative, indoctrination, audience, offer, magnet
  // candidates and every keyword field through the plan row.
  if (args.publish) {
    const { planRowForPage } = await import("@/lib/clients/page-plan");
    const publishedPlanRow = await planRowForPage(args.clientId, args.pageId);
    void capturePage({
      clientId: args.clientId,
      pageId: args.pageId,
      planRowId: publishedPlanRow?.id ?? null,
      reason: "published",
    });
  }

  let pageUrl: string | null = null;
  if (args.publish && client.domain) {
    const label = subdomainLabel(client.subdomain as string | null, client.domain as string);
    pageUrl = `https://${label}.${client.domain}/${result.slug}`;

    // Ticking first_page is what posts the notify_first_page draft, and it now has a real URL
    // behind it. autoCompleteStep is reused rather than reimplemented: it owns the tick, the
    // checklist refresh and the draft in one place.
    await autoCompleteStep(args.clientId, "first_page", `Published ${pageUrl} by ${args.by}`).catch((e) => {
      console.error("[publish-page] first_page tick failed:", (e as Error).message);
    });
  }

  return { ok: true, slug: result.slug, pageUrl };
}
