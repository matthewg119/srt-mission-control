// Saving one step of the intake funnel.
//
// The token is the authorization AND the identity: nothing in the request body says
// which client this is, so a caller cannot write to someone else's row by editing a
// hidden field. The clientId comes only from the verified HMAC.
//
// NO checkRateLimit() HERE, deliberately. That helper allows 5 requests per 10 minutes,
// and a six-step funnel makes six saves: applying it would block real clients on their
// last step, which is the worst possible place to fail. The token is the gate, the
// honeypot catches the lazy case, and there is no public entry point to spam anyway.
//
// NOTHING PRICED. This route reads and writes intake answers and consent. It touches no
// billing column and imports no price constant.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { verifyOnboardingToken } from "@/lib/clients/token";
import { slack } from "@/lib/slack-bot";
import { postToClientChannel } from "@/lib/clients/client-channel";
import {
  INTAKE_STEPS,
  TOTAL_STEPS,
  CONSENT_VALUE_BY_LABEL,
  LANGUAGE_VALUE_BY_LABEL,
} from "@/config/client-intake";
import { clean } from "@/lib/medspa/validate";
import { normalizeAddress, normalizeState } from "@/lib/clients/normalize";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Step 1 writes real columns; every other step writes its jsonb bag. */
const STEP_1_COLUMNS = new Set([
  "legal_name",
  "dba_name",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "phone",
  "email",
  "website",
  "hours",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // Honeypot. Pretend success so a bot does not adapt, and write nothing.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true });
  }

  const verified = verifyOnboardingToken(body.token as string | undefined);
  if (!verified.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          verified.reason === "expired"
            ? "This link has expired. Reply to the welcome email for a new one."
            : "This link is not valid.",
      },
      { status: 401 }
    );
  }

  const step = Number(body.step);
  if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) {
    return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
  }

  const def = INTAKE_STEPS[step - 1];
  const submitted = (body.values ?? {}) as Record<string, unknown>;

  // Only keys the step actually defines are read. An extra key in the body is ignored
  // rather than merged, so the request body can never reach a column this step does not
  // own (billing_status, tier_scope, pilot dates, the token hash).
  const answers: Record<string, unknown> = {};
  for (const field of def.fields) {
    const raw = submitted[field.key];
    if (field.kind === "multiselect") {
      answers[field.key] = Array.isArray(raw) ? raw.map((v) => clean(v, 200)).filter(Boolean) : [];
    } else {
      answers[field.key] = clean(raw, 4000);
    }
  }

  for (const field of def.fields) {
    const value = answers[field.key];
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (field.required && empty) {
      return NextResponse.json(
        { ok: false, error: `${field.label} is needed.` },
        { status: 400 }
      );
    }
  }

  // The client must still exist and its link must not have been retired mid-session.
  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("id, intake_step, onboarding_token_hash, slack_channel_id, legal_name, dba_name")
    .eq("id", verified.clientId)
    .maybeSingle();

  if (!existing || !existing.onboarding_token_hash) {
    return NextResponse.json({ ok: false, error: "This link is not valid." }, { status: 401 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (step === 1) {
    for (const [key, value] of Object.entries(answers)) {
      if (!STEP_1_COLUMNS.has(key)) continue;
      patch[key] =
        key === "state"
          ? normalizeState(value as string)
          : key.startsWith("address_")
            ? normalizeAddress(value as string)
            : value;
    }
  } else if (def.bag) {
    patch[def.bag] = answers;
  }

  if (step === 4) {
    // Either yes is a conversation on the call, and per PILOT §6 it stops there. The
    // flag exists so that conversation cannot be forgotten between now and the call.
    patch.review_incentive_flag =
      answers.incentive === "Yes" || answers.lobby_tablet === "Yes";
    patch.booking_software = answers.booking_software ?? null;
    const destinations = (answers.destinations as string[]) ?? [];
    patch.review_destination_primary = destinations.includes("Google")
      ? "google"
      : (destinations[0]?.toLowerCase() ?? "google");
    patch.review_destination_secondary =
      destinations.find((d) => d !== "Google")?.toLowerCase() ?? null;
  }

  if (step === 6) {
    // §16.4. Anonymized is the default and named is a separate, explicit yes (D-P6).
    // An unrecognized label falls back to anonymized rather than to named: the safe
    // failure for a consent field is always the more private one.
    patch.consent_results = CONSENT_VALUE_BY_LABEL[answers.consent_results as string] ?? "anonymized";
    patch.language = LANGUAGE_VALUE_BY_LABEL[answers.language as string] ?? "en";
    patch.consent_recorded_at = new Date().toISOString();
    patch.intake_completed_at = new Date().toISOString();
    patch.onboarding_status = "intake_complete";
  } else {
    patch.onboarding_status = "intake_started";
  }

  // Highest step reached, never a decrement: going Back and re-saving step 2 must not
  // throw away the fact that step 5 was already answered.
  patch.intake_step = Math.max((existing.intake_step as number) ?? 0, step);

  const { error } = await supabaseAdmin
    .from("clients")
    .update(patch)
    .eq("id", verified.clientId);

  if (error) {
    console.error("[onboarding/save] update failed:", error.message);
    return NextResponse.json({ ok: false, error: "That did not save." }, { status: 500 });
  }

  if (step === TOTAL_STEPS) {
    await onIntakeComplete({
      clientId: verified.clientId,
      name: (existing.dba_name as string) || (existing.legal_name as string),
      channelId: (existing.slack_channel_id as string) ?? null,
      incentiveFlag: Boolean(patch.review_incentive_flag),
    }).catch((e) =>
      console.error("[onboarding/save] completion work failed:", (e as Error).message)
    );
  }

  return NextResponse.json({ ok: true });
}

async function onIntakeComplete(args: {
  clientId: string;
  name: string;
  channelId: string | null;
  incentiveFlag: boolean;
}): Promise<void> {
  await supabaseAdmin
    .from("client_onboarding_steps")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("client_id", args.clientId)
    .eq("stage", "intake");

  // Photograph I fires here once the baseline runner exists. It does not today: the
  // engine layer is OpenAI only and the spec's four-engine baseline cannot be run, so
  // nothing is kicked off rather than something misleading being labelled a baseline.

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const lines = [
    `:white_check_mark: *${args.name}* finished onboarding intake.`,
    `${appUrl}/dashboard/clients/${args.clientId}`,
  ];
  if (args.incentiveFlag) {
    lines.push(
      `:warning: They offer something for reviews, or have a lobby tablet or QR. That is a conversation on the call before anything gets built.`
    );
  }
  const text = lines.join("\n");

  const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (onboardingChannel) await slack.postMessage(onboardingChannel, text);

  // The client channel may be in a different workspace, so it needs the hub-aware
  // poster rather than slack.postMessage.
  if (args.channelId) {
    await postToClientChannel(args.channelId, ":white_check_mark: Intake received. Thank you.");
  }
}
