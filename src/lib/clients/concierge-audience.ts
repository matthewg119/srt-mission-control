// Somebody says who the widget is talking to, and the record of them saying it.
//
// ‼️ THE HALF OF "THE TOOL PROPOSES, A PERSON CONFIRMS" THAT WAS MISSING.
// concierge-setup.ts now seeds `audience` from proposeAudience(), which is a guess made from a
// classifier's free text. This is the other half: the button that turns that guess into a decision,
// and the two columns that let anybody afterwards tell the two apart. It is the same shape as
// confirmAvatar() in avatars.ts, which exists for exactly the same reason.
//
// ‼️ IT WRITES THE AUDIENCE TOO, NOT JUST THE STAMP. Pressing the button for the lane that is
// already seeded is a ratification; pressing the other one is a correction. Both are one act to
// the person doing it, and making the correction take two clicks would mean somebody could stamp
// `patient` as confirmed while meaning to change it.

import { supabaseAdmin } from "@/lib/db";
import { isAudience, type Audience } from "@/lib/concierge/magnets";
import { conciergeLaneName, conciergeLaneBlurb } from "@/lib/concierge/lane-name";

export type ConfirmAudienceResult =
  | { ok: true; audience: Audience; changed: boolean; previous: Audience | null; line: string }
  | { ok: false; error: string };

/**
 * Record that a person chose this lane for this client.
 *
 * Refuses when there is no config row rather than creating one: the row is provisioning's job, and
 * a row minted here would carry no origins, so the widget would frame nowhere and the card would
 * still say it was ready.
 */
export async function confirmConciergeAudience(args: {
  clientId: string;
  audience: string;
  by: string;
}): Promise<ConfirmAudienceResult> {
  if (!isAudience(args.audience)) {
    return { ok: false, error: `\`${args.audience}\` is not one of the two lanes.` };
  }

  const { data: existing, error: readError } = await supabaseAdmin
    .from("concierge_configs")
    .select("audience, enabled")
    .eq("client_id", args.clientId)
    .maybeSingle();

  if (readError) {
    return {
      ok: false,
      error: /relation|does not exist|schema cache/i.test(readError.message)
        ? `\`concierge_configs\` could not be read: ${readError.message}. docs/2026-09-01-concierge.sql has not been run.`
        : readError.message,
    };
  }

  if (!existing) {
    return {
      ok: false,
      error:
        "This client has no concierge config row yet, so there is nothing to confirm. " +
        "Un-tick `concierge_preview` to re-run provisioning, which creates it.",
    };
  }

  const previous = isAudience(existing.audience) ? existing.audience : null;
  const changed = previous !== args.audience;

  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({
      audience: args.audience,
      audience_confirmed_at: new Date().toISOString(),
      audience_confirmed_by: args.by,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", args.clientId);

  if (error) {
    return {
      ok: false,
      error: /audience_confirmed/i.test(error.message)
        ? `${error.message}. docs/2026-09-04-magnet-lane.sql has not been run.`
        : error.message,
    };
  }

  const lane = conciergeLaneName(args.audience);
  const lines = [
    `:white_check_mark: Audience confirmed: *${args.audience}*, by ${args.by}. This client runs the ${lane}.`,
    conciergeLaneBlurb(args.audience),
  ];

  if (changed && previous) {
    // ‼️ SAID OUT LOUD, BECAUSE THE MAGNET CATALOGUE JUST CHANGED UNDERNEATH THIS CLIENT.
    // candidatesFor() filters on audience, so every offer the picker showed a minute ago is now
    // invisible and a different set has taken its place. Anything already drafted toward the old
    // lane will refuse to mint, which is the firewall working, but it reads as a bug if nobody
    // was told the lane moved.
    lines.push(
      `It was *${previous}*, so the lead magnet catalogue for this client has changed. Any offers ` +
        `already drafted for a page will refuse to be approved until they are drafted again.`
    );
  }

  if (existing.enabled === true) {
    // The widget is already answering on their domain, so this was not a preparation, it was a
    // live change to what a stranger is being told.
    lines.push(
      `:warning: This widget is *already live* on their site, so the change took effect immediately.`
    );
  }

  return { ok: true, audience: args.audience, changed, previous, line: lines.join("\n") };
}
