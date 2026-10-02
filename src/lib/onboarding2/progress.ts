// The funnel reports progress from the phone answer onward, and an abandoner gets chased.
//
// ‼️ WHY THE PHONE AND NOT THE WEBSITE. Matthew asked for the lead "after the website" and then
// settled on the phone when the cost was named, which is this: after the website answer we hold a
// name and a URL and no way to reach anybody. A card fired there cannot be acted on, so every
// abandoner before the phone would arrive as a row nobody can do anything with. The phone is the
// first moment a stranger becomes somebody we can call, which is the definition this file uses for
// a lead.
//
// ‼️ IT DOES NOT AUTO-DIAL, AND THAT IS DELIBERATE. ingestLead's speedToLead rings Matthew's phone
// and starts a RingOut. Firing that on somebody who has typed seven digits and not yet chosen
// anything turns every half-finished form into a phone call. The card posts immediately so it is
// VISIBLE, and the five-minute nudge below is what says "this one stalled, go and get them". The
// completed path keeps its existing speedToLead in /start, untouched.
//
// ‼️ THE THREAD REPLIES ARE NOT A NEW MECHANISM. lead-intake.ts already posts a thread reply when a
// contact it has seen before comes back through ingestLead, keyed on contacts.slack_thread_ts. So
// "a reply per answer" is calling the same door again with the new answer as the headline. Writing
// a second Slack poster here would be a second answer to "where does this lead's history go".

import { supabaseAdmin } from "@/lib/db";
import { ingestLead } from "@/lib/lead-intake";

/**
 * How far somebody got. Ordered, and the order is what `furthest` means: a later step never
 * regresses to an earlier one, so a back button cannot make a finished lead look abandoned.
 */
export const PROGRESS_STEPS = ["phone", "reactivation", "email", "offer"] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

export function isProgressStep(v: string): v is ProgressStep {
  return (PROGRESS_STEPS as readonly string[]).includes(v);
}

function rank(step: ProgressStep): number {
  return PROGRESS_STEPS.indexOf(step);
}

export interface ProgressInput {
  step: ProgressStep;
  name: string;
  phone: string;
  website?: string | null;
  email?: string | null;
  /** The gold add-on, when it has been answered. */
  wantsReactivation?: boolean | null;
  sourcePage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

/** What the thread reply says for each step. The first one opens the card; the rest reply to it. */
function headlineFor(input: ProgressInput): { headline: string; details: string[] } {
  switch (input.step) {
    case "phone":
      return {
        headline: "Started the onboarding and left a number.",
        details: [
          `Phone: ${input.phone}`,
          `Website: ${input.website?.trim() || "none given"}`,
          "Has not chosen an offer yet.",
        ],
      };
    case "reactivation":
      return {
        headline:
          input.wantsReactivation === true
            ? "Said yes to the complimentary reactivation campaign."
            : "Declined the reactivation campaign.",
        details:
          input.wantsReactivation === true
            ? ["ADD-ON: complimentary reactivation campaign, reviews inside 7 days."]
            : [],
      };
    case "email":
      return { headline: `Gave an email: ${input.email ?? ""}`, details: [] };
    case "offer":
      return { headline: "Reached the offer screen.", details: [] };
  }
}

/**
 * Record one answer, and open or extend the lead's thread.
 *
 * ‼️ ingestLead IS CALLED EVERY TIME, NOT ONLY THE FIRST. That is what produces the replies: it
 * finds the contact by phone, updates whatever is newly known, and posts the headline into the
 * existing thread. Guarding it to "first call only" would give one card and no history, which is
 * the thing being fixed.
 */
export async function recordProgress(
  input: ProgressInput
): Promise<{ ok: true; contactId: string | null } | { ok: false; error: string }> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (!name || !phone) return { ok: false, error: "A name and a phone are needed to open a lead." };

  const parts = name.split(/\s+/);
  const { headline, details } = headlineFor(input);

  let contactId: string | null = null;
  try {
    const res = await ingestLead({
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      email: input.email ?? undefined,
      phone,
      website: input.website ?? undefined,
      source: "onboarding2",
      sourcePage: input.sourcePage,
      noteTitle: "Onboarding progress",
      headline,
      detailLines: details,
      // See the header. The nudge is the contact trigger for an abandoner, not an instant dial.
      speedToLead: false,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
    });
    contactId = res.contactId;
  } catch (e) {
    // ‼️ A FAILED CARD MUST NOT FAIL THE FUNNEL. The visitor is mid-question; losing their answer
    // because Slack was slow would cost the thing the card exists to record.
    console.error("[onboarding2/progress] lead failed:", (e as Error).message);
  }

  // ‼️ THE ROW IS WRITTEN EVEN WHEN THE CARD FAILED, because the nudge reads this and not Slack.
  // An outage that loses the card must not also lose the only record that somebody stalled.
  try {
    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("onboarding2_progress")
      .select("id, furthest_step")
      .eq("phone", phone)
      .maybeSingle();

    const furthest =
      existing && isProgressStep(String(existing.furthest_step)) &&
      rank(existing.furthest_step as ProgressStep) > rank(input.step)
        ? (existing.furthest_step as ProgressStep)
        : input.step;

    const row = {
      contact_id: contactId,
      name,
      phone,
      website: input.website?.trim() || null,
      email: input.email?.trim() || null,
      furthest_step: furthest,
      updated_at: now,
    };

    if (existing?.id) {
      await supabaseAdmin.from("onboarding2_progress").update(row).eq("id", existing.id as string);
    } else {
      await supabaseAdmin.from("onboarding2_progress").insert(row);
    }
  } catch (e) {
    console.error("[onboarding2/progress] row failed:", (e as Error).message);
  }

  return { ok: true, contactId };
}

/**
 * Mark this phone as finished, so the nudge never chases somebody who completed.
 *
 * Called from /start once an offer is actually chosen. Separate from recordProgress because
 * "reached the offer screen" and "picked one" are different claims and only the second one closes
 * the loop.
 */
export async function markProgressComplete(phone: string): Promise<void> {
  const p = phone.trim();
  if (!p) return;
  try {
    await supabaseAdmin
      .from("onboarding2_progress")
      .update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("phone", p)
      .is("completed_at", null);
  } catch (e) {
    console.error("[onboarding2/progress] complete failed:", (e as Error).message);
  }
}
