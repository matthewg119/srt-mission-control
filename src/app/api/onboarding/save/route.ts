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
import { revalidateClientHub } from "@/lib/hub/resolve";
import {
  seedDeliverySteps,
  postDeliveryChecklist,
  autoCompleteStep,
} from "@/lib/clients/delivery-checklist";
import { postDraft } from "@/lib/clients/client-drafts";
import { startBaselineScan } from "@/lib/clients/baseline-scan";
import { waitUntil } from "@vercel/functions";
import {
  INTAKE_STEPS,
  TOTAL_STEPS,
  CONSENT_VALUE_BY_LABEL,
  LANGUAGE_VALUE_BY_LABEL,
} from "@/config/client-intake";
import { clean, normalizePhone } from "@/lib/medspa/validate";
import { normalizeTarget } from "@/lib/scan/normalize";
import { normalizeAddress, normalizeState } from "@/lib/clients/normalize";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// The final step kicks off a scan in waitUntil. The response returns in milliseconds, but
// the function has to stay alive long enough for that background work to get going.
export const maxDuration = 300;

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
  // whatsapp_number is deliberately NOT here. It is derived from two fields rather than
  // copied from one, and it is stored normalized, so it is set explicitly below. Adding
  // it to this set would write the raw typed string first and then overwrite it.
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
          : key === "phone"
            ? // E.164, never the typed string. The form shows "(336) 833-2303" and the
              // database stores "+13368332303", so the same human typing their number
              // three ways produces one value instead of three. See the note on
              // formatPhoneUS in src/lib/clients/normalize.ts for what that used to cost.
              //
              // The `?? value` fallback cannot normally fire, since the client rejects an
              // unparseable phone before it gets here, but a direct POST is not obliged to
              // be a browser. Keeping the raw string beats writing null over a number
              // somebody really did give us.
              (normalizePhone(value as string) ?? value)
            : key.startsWith("address_")
              ? normalizeAddress(value as string)
              : value;
    }

    // ‼️ DERIVE clients.domain HERE, BECAUSE NOTHING ELSE EVER DID.
    //
    // startPilot() derives it from `input.website`, but /api/clients/start provisions from the
    // Stripe thank-you page with an email and NOTHING ELSE, so `website` is null there and the
    // derivation is skipped. Intake step 1 is where the website finally arrives, and it wrote
    // the `website` column and stopped — leaving `domain` null forever for every self-serve
    // client. provision.ts:327 already documents the same hole for `subdomain`: "this comment
    // used to claim intake step 1 decided it; nothing did".
    //
    // The cost is not cosmetic. `domain` is what hostsFor(), seedDnsRecords() and the whole
    // hub lane are built from, so hub_preview fails with "No domain on file" and takes
    // review_tool_preview, review_card_pdf, dns_records, subdomain_live, first_page and
    // review_tool_handed down with it. Eight steps of a 33-step runner were unreachable for
    // anyone who signed up through /start. Confirmed on the live re-run of srtagency.com.
    const typedWebsite = typeof answers.website === "string" ? answers.website.trim() : "";
    if (typedWebsite) {
      const normalized = normalizeTarget(typedWebsite);
      if (normalized.ok) {
        patch.website = normalized.target.website;
        patch.domain = normalized.target.domain;
      }
      // An unreadable website is NOT fatal here, unlike in startPilot. The client is already
      // provisioned and mid-form; refusing step 1 would strand them on a screen they cannot
      // get past. The raw string is kept in `website` by the loop above and `domain` stays
      // null, which is the state this branch already handled before today.
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

  // The hub renders the canonical NAP, and resolveHost caches it for five minutes. Step 1
  // is the only intake step that writes those fields, so it is the only one that has to
  // tell the cache. Without this a corrected address kept serving — in the LocalBusiness
  // schema, on the client's own domain — until the TTL happened to roll.
  if (step === 1) revalidateClientHub();

  if (step === TOTAL_STEPS) {
    await onIntakeComplete({
      clientId: verified.clientId,
      name: (existing.dba_name as string) || (existing.legal_name as string),
      incentiveFlag: Boolean(patch.review_incentive_flag),
    }).catch((e) =>
      console.error("[onboarding/save] completion work failed:", (e as Error).message)
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * Everything that happens when the form is finished.
 *
 * This is the hinge of the whole flow: the intake card it posts becomes the anchor thread
 * for every internal message about this client, the checklist hangs under it, and the
 * baseline scan starts. Each piece is caught separately so a Slack outage cannot stop the
 * scan and a scan failure cannot stop the checklist.
 */
async function onIntakeComplete(args: {
  clientId: string;
  name: string;
  incentiveFlag: boolean;
}): Promise<void> {
  await supabaseAdmin
    .from("client_onboarding_steps")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("client_id", args.clientId)
    .eq("stage", "intake");

  // ‼️ PICK THE SUBDOMAIN NOW, FOR THE SAME REASON `domain` IS DERIVED AT STEP 1.
  //
  // startPilot() calls chooseSubdomain only `if (domain)`, and a /start client has no domain
  // at that point, so `clients.subdomain` stayed NULL forever. It is a DNS lookup of
  // learn.{domain} to decide between the `learn` and `guide` conventions, so it cannot run
  // until a domain exists, and this is the first moment one does.
  //
  // It runs BEFORE the delivery cascade below, because hub_preview attaches hostnames built
  // from exactly these two columns. Guarded on a still-null subdomain so a re-submitted final
  // step cannot re-run the lookup and flip a convention somebody has already read down a phone.
  const { data: forHost } = await supabaseAdmin
    .from("clients")
    .select("domain, subdomain")
    .eq("id", args.clientId)
    .maybeSingle();

  if (forHost?.domain && !forHost.subdomain) {
    const { chooseSubdomain } = await import("@/lib/clients/provision");
    await chooseSubdomain(args.clientId, forHost.domain as string).catch((e) =>
      console.error("[onboarding/save] subdomain choice failed:", (e as Error).message)
    );
  }

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

  // ── The anchor message ──
  // Its ts is claimed with a conditional UPDATE guarded on `is null`, so two concurrent
  // completions cannot produce two threads. Same pattern as lead-thread.ts.
  const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (onboardingChannel) {
    const res = (await slack.postMessage(onboardingChannel, lines.join("\n"))) as {
      ok?: boolean;
      ts?: string;
    };
    if (res?.ok && res.ts) {
      await supabaseAdmin
        .from("clients")
        .update({ ops_thread_ts: res.ts, updated_at: new Date().toISOString() })
        .eq("id", args.clientId)
        .is("ops_thread_ts", null);
    }
  }

  // ── The internal delivery checklist ──
  await seedDeliverySteps(args.clientId);
  await autoCompleteStep(args.clientId, "intake_received").catch(() => {});
  await postDeliveryChecklist(args.clientId).catch((e) =>
    console.error("[onboarding/save] checklist post failed:", (e as Error).message)
  );

  // ── The intro draft ──
  // Posted for a human to send, never sent. It goes AFTER the checklist so the thread
  // reads in the order the work happens, and it is caught separately so a copy problem
  // cannot stop the baseline scan below.
  await postDraft(args.clientId, "intro").catch((e) =>
    console.error("[onboarding/save] intro draft failed:", (e as Error).message)
  );

  // ── The baseline scan ──
  // NOT awaited. runAuditPipeline does not return until the ENTIRE audit is finished,
  // which is minutes: awaiting it here would hang the client on the Finish button and
  // then blow the function's time limit. waitUntil lets the response go back immediately
  // while the scan keeps running.
  waitUntil(
    startBaselineScan(args.clientId).catch((e) =>
      console.error("[onboarding/save] baseline scan failed:", (e as Error).message)
    )
  );
}

