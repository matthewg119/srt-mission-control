// The review tool preview — delivery step 16, Runner v3 5f/5g.
//
// ‼️ THIS STEP GENERATES NOTHING, AND THAT IS THE FINDING.
//
// The themed review tool preview already exists and already works. It is rendered by
// src/app/dashboard/clients/[id]/preview/[[...slug]]/page.tsx at ?kind=reviews, inside a
// .hub-root carrying themeStyle(client.theme), and that page's own header documents the
// discard guarantee it inherits from middleware. There was never a document to build here.
//
// So this runner is a VERIFIER, and its entire value is REFUSING TO TICK when the things the
// step claims are not true. "Review tool preview live, themed to match" is two assertions. The
// first is structural and always true once a client exists. The second is not: activeTheme()
// returns null until a human confirms, and an unconfirmed theme renders as the SRT default —
// at which point "themed to match" is a sentence on a checklist describing a page that is not
// themed at all.
//
// ‼️ ZERO MODEL CALLS. NOT FOR THE THREAD NOTE, NOT FOR ANYTHING.
// src/lib/hub/review-assemble.ts imports nothing, on purpose: FTC 16 CFR Part 465 regulates a
// tool that GENERATES review content its user did not write. This file sits one step away from
// that path and carries the same rule, because the reflex in this codebase is to add a Claude
// call to anything that produces prose. There is no prose here to produce.
//
// ‼️ IT WRITES output_ref DIRECTLY RATHER THAN GOING THROUGH deliverArtifact.
// That is the one place this file departs from the house pattern in artifacts/. deliverArtifact
// requires a Buffer, and there are no bytes: what this step produces is a URL somebody opens on
// a call. The pointer still lands in the same column every other step's output lands in.

import { supabaseAdmin } from "@/lib/db";
import { readTheme, activeTheme } from "@/lib/hub/theme";
import { hostsFor } from "@/lib/hub/vercel-domains";
import { notifyStep } from "./step-board";
import type { AutoResult } from "./artifacts/registry";

/**
 * 5g, verbatim, as constants.
 *
 * Both are rules about what happens on the call itself, so they belong in the message that
 * announces the preview rather than in a document nobody opens mid-conversation. Constants
 * rather than inline strings for the same reason PERMISSION_CLOSE is one: a rule that gets
 * reworded each time it is printed stops being a rule.
 */
export const PREVIEW_DEMO_RULE =
  "Demo text typed live on the call is fine. NEVER ship pre-filled sample patient answers.";

export const PREVIEW_DISCARD_RULE =
  "Any submission from the preview host is DISCARDED. The submit route takes the client identity " +
  "only from x-hub-host, and middleware strips that header on internal hosts, so a preview " +
  "submission has no client to write against and is refused.";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export function reviewPreviewUrl(clientId: string): string {
  return `${appUrl()}/dashboard/clients/${clientId}/preview?kind=reviews`;
}

export async function verifyReviewToolPreview(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, theme, subdomain, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  // ── The check that can actually fail ──────────────────────────────────────
  //
  // ‼️ IT GATES ON confirmedAt, NOT ON activeTheme, AND THAT IS THE SECOND HALF OF THE THEME
  // DEADLOCK. activeTheme returns null both when nothing is confirmed AND when nothing is
  // overridden, so a client who confirmed the SRT defaults on purpose would get "the theme has
  // not been confirmed" here, which is a false statement, and this step would land in a terminal
  // error one line after step 15 finally passed. Confirmed is confirmedAt; overrides are a
  // separate question, answered below only so the message can say which state it is in.
  const stored = readTheme(client.theme);
  if (!stored.confirmedAt) {
    return {
      ok: false,
      error:
        "The theme has not been confirmed, so the review tool would render in SRT's default " +
        "colours rather than the client's. Confirm the theme on the client board (that is the " +
        "manual half of the hub preview step) and this runs itself. Confirming with nothing set " +
        "is allowed and means keeping SRT's defaults deliberately.",
    };
  }
  const theme = activeTheme(stored);
  const themeNote = theme
    ? ""
    : " The theme is confirmed with no overrides, so the review tool renders SRT's defaults on " +
      "the client's own domain. That is a recorded decision, not an unfinished step.";

  // ── The check that only warns ─────────────────────────────────────────────
  //
  // The preview COMPOSES its hostname from the client record rather than resolving it from
  // client_hosts, which is why it works before any domain is attached. So a missing reviews
  // row does not stop the preview and must not fail this step. It does matter to a sibling:
  // review-card.ts prints a QR pointing at the derived reviews host, and that QR goes on
  // printed cards. Worth saying once, here, while somebody is looking.
  const reviewsHost = hostsFor({
    subdomain: (client.subdomain as string | null) ?? null,
    domain: (client.domain as string | null) ?? null,
  }).find((h) => h.kind === "reviews");

  let hostWarning = "";
  if (reviewsHost) {
    const { data: hostRow } = await supabaseAdmin
      .from("client_hosts")
      .select("id")
      .eq("client_id", clientId)
      .eq("kind", "reviews")
      .maybeSingle();

    if (!hostRow) {
      hostWarning =
        `\n:warning: No \`client_hosts\` row for \`${reviewsHost.host}\` yet. The preview does ` +
        `not need one, but the QR code on the printed review cards points at that hostname, so ` +
        `attach the domain before the cards go to print.`;
    }
  }

  const url = reviewPreviewUrl(clientId);
  const name = (client.dba_name || client.legal_name || "this client") as string;

  // The durable pointer. output_ref is free text by design — the step-engine migration calls
  // it "a PDF, a report id, a URL" — so a URL is a first-class value here, not a workaround.
  await supabaseAdmin
    .from("client_delivery_steps")
    .update({ output_ref: url, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("step_key", "review_tool_preview");

  await notifyStep(
    clientId,
    "review_tool_preview",
    [
      `*Review tool preview — ${name}*`,
      theme ? `Themed and live: ${url}` : `Live: ${url}`,
      "",
      `• ${PREVIEW_DEMO_RULE}`,
      `• ${PREVIEW_DISCARD_RULE}`,
      themeNote.trim(),
      hostWarning,
    ]
      .filter(Boolean)
      .join("\n")
  );

  // ‼️ NO `note`, DELIBERATELY. runReadyAutoSteps posts a runner's note itself, so
  // returning one here put the same fact in the thread twice, one message apart. This step
  // writes its own card above because it has more to say than one line, and the tick that
  // follows is written from the verifier's evidence rather than from the runner's opinion.
  return { ok: true };
}
