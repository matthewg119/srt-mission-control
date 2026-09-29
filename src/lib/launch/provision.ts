// Opening a Launch Lane client.
//
// ‼️ IT REUSES startPilot() AND DOES NOT REIMPLEMENT IT.
// A second provisioning path would be a second slug-collision retry, a second market-overlap
// check, a second seat count and a second CRM link, drifting apart from the first from the day it
// shipped. The only thing this lane wants differently is the Slack channel, which startPilot now
// takes an option for. Everything else about creating a client is the same job.
//
// The difference from openClientBoard() is what is NOT here: no ops thread, no anchors, no
// per-step Slack messages, no announcement card. This lane is worked on a dashboard page.

import { supabaseAdmin } from "@/lib/db";
import { startPilot } from "@/lib/clients/provision";
import { seedLaunchSteps, autoCompleteLaunchStep } from "./steps";
import { ensureProvisionalAudience } from "./vocabulary";

export interface StartLaunchInput {
  legalName?: string | null;
  dbaName?: string | null;
  email: string;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  /**
   * What this business IS, kebab-case. Written straight to clients.vertical_slug.
   *
   * ‼️ REQUIRED HERE, AND IT IS THE ONE FIELD THIS LANE CANNOT DEFER.
   * In the Slack lane this column is filled by the baseline scan's classification OF THEIR
   * WEBSITE. These clients have no website, so nothing downstream can ever work it out, and
   * verticalFor() refuses outright on an empty value rather than guessing: a harvest filed under
   * a guessed vertical poisons the shared question_bank for every real client in it, and
   * question_bank has no client_id to unpick it by afterwards.
   */
  verticalSlug: string;
  /** Optional. A client who already HAS a site runs the same lane with the site steps skipped. */
  website?: string | null;
  language?: "en" | "es" | "both";
}

export interface StartLaunchResult {
  ok: boolean;
  clientId?: string;
  slug?: string;
  onboardingUrl?: string | null;
  warnings?: string[];
  error?: string;
}

const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function startLaunchClient(input: StartLaunchInput): Promise<StartLaunchResult> {
  const vertical = (input.verticalSlug ?? "").trim().toLowerCase();
  if (!vertical) {
    return {
      ok: false,
      error:
        "Say what this business is before creating it. There is no website for a scan to classify " +
        "in this lane, so nothing downstream can fill it in later.",
    };
  }
  if (!SLUG_SHAPE.test(vertical)) {
    return {
      ok: false,
      error:
        `"${input.verticalSlug}" is not a usable vertical. Lowercase letters, numbers and hyphens, ` +
        "for example roofing-contractor or family-dentist.",
    };
  }

  const started = await startPilot({
    legalName: input.legalName ?? null,
    dbaName: input.dbaName ?? null,
    email: input.email,
    phone: input.phone ?? null,
    website: input.website ?? null,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    language: input.language ?? "en",
    door: "dashboard",
    lane: "launch",
  });

  if (!started.ok) return { ok: false, error: started.error };

  const warnings = [...started.warnings];

  // ‼️ THE LANE AND THE VERTICAL ARE WRITTEN BEFORE THE STEPS ARE SEEDED.
  // launch_intake's verifier reads vertical_slug, and seeding first would mean the very first
  // board render showed step 1 refusing for a client who supplied everything it asked for.
  const { error: markErr } = await supabaseAdmin
    .from("clients")
    .update({
      onboarding_lane: "launch",
      vertical_slug: vertical,
      intake_completed_at: new Date().toISOString(),
      onboarding_status: "intake_complete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", started.clientId);

  if (markErr) {
    // The client EXISTS at this point and is not rolled back: startPilot's provisioning claim is
    // write-once, so deleting and retrying would burn the slug and the CRM link for a failure
    // that a second update fixes. Say so plainly instead.
    return {
      ok: false,
      clientId: started.clientId,
      slug: started.slug,
      error:
        `The client was created but could not be marked as a Launch Lane client: ${markErr.message}. ` +
        "It currently shows on the Slack board. Re-run this to repair it.",
    };
  }

  // ‼️ A PROVISIONAL AUDIENCE EXISTS FROM THE MOMENT THE CLIENT DOES, AND THE ORDER IS FORCED.
  //
  // audience_documents is keyed on (audience, offer, kind), so a document cannot be filed until an
  // audience row exists. But the vocabulary proposal READS those documents. Without a row up
  // front, the two steps deadlock: nothing can be uploaded until the audience is confirmed, and
  // the audience cannot be proposed until something is uploaded.
  //
  // The row is created UNCONFIRMED: confirmed_at and vocabulary_confirmed_at stay null, which is
  // exactly what every reader already gates on, so a provisional audience is inert rather than a
  // half-truth. confirmVocabulary() later updates THIS row in place rather than inserting a
  // second one, which is what keeps the documents attached to it.
  const seeded = await ensureProvisionalAudience({
    clientId: started.clientId,
    vertical,
    businessName: input.dbaName ?? input.legalName ?? null,
  });
  if (!seeded.ok) warnings.push(`provisional audience not created: ${seeded.error}`);

  await seedLaunchSteps(started.clientId);

  // Step 1 is the only one that can be true the moment the client exists. It still goes through
  // the verifier, so a client created from an email alone parks at "not yet" with a todo rather
  // than being ticked on the strength of having been created.
  await autoCompleteLaunchStep(started.clientId, "launch_intake", "Mission Control");

  return {
    ok: true,
    clientId: started.clientId,
    slug: started.slug,
    onboardingUrl: started.onboardingUrl,
    warnings,
  };
}

/**
 * Move an existing client onto the Launch Lane.
 *
 * ‼️ IT REFUSES A CLIENT WHOSE SLACK BOARD HAS ALREADY BEEN WORKED.
 * The two lanes keep separate step rows, so switching does not destroy anything, and that is
 * exactly the problem: a client with sixteen ticked delivery steps would appear on the Launch
 * Lane with nothing done, and the work would be invisible rather than gone. Somebody would then
 * redo it. Moving a fresh client is fine; moving a live one is a decision that needs a person who
 * knows what is already true.
 */
export async function moveClientToLaunchLane(
  clientId: string,
  verticalSlug?: string
): Promise<{ ok: boolean; error?: string }> {
  const { count, error: countErr } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "complete");

  if (countErr) return { ok: false, error: `The Slack board could not be read: ${countErr.message}` };

  // Two is the floor every client reaches on creation: intake_received and baseline_scan are
  // ticked by openClientBoard itself, so anything above that is work somebody did.
  if ((count ?? 0) > 2) {
    return {
      ok: false,
      error:
        `This client has ${count} completed steps on the Slack board. Moving it here would show ` +
        "an empty board next to work that is already done, and somebody would do it twice. " +
        "Finish it where it started, or archive it and open a fresh client.",
    };
  }

  const patch: Record<string, unknown> = {
    onboarding_lane: "launch",
    updated_at: new Date().toISOString(),
  };
  if (verticalSlug?.trim()) patch.vertical_slug = verticalSlug.trim().toLowerCase();

  const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", clientId);
  if (error) return { ok: false, error: error.message };

  await seedLaunchSteps(clientId);
  return { ok: true };
}

/** Is this client worked on the Launch Lane? Null when the client cannot be read. */
export async function isLaunchClient(clientId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("onboarding_lane")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return null;
  return data.onboarding_lane === "launch";
}
