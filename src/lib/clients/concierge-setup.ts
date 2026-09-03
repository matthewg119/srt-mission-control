// Steps 16 and 35: provisioning the AI Skin Concierge for one client.
//
// `concierge_preview` (before the call) creates the config row and hands back a link that
// works, so the Concierge can be DEMOED LIVE on the call. That demo is the reason the offer's
// value stack moves; a screenshot of it is not the same thing.
//
// `concierge_live` (after the call) is where somebody flips `enabled`. It is manual and it
// stays manual: turning a camera on over a clinic's patients is a decision a person makes.
//
// ‼️ RE-RUNNING THIS STEP MUST NEVER TURN A LIVE WIDGET OFF, AND MUST NEVER CLOBBER THE
// BOOKING CONFIG. The step is auto_then_manual, so it genuinely does get re-run — by the ready
// sweep, by somebody unticking and reticking it, by a retry after an error. The upsert below
// therefore writes only the SEEDED fields and lists them explicitly. `enabled`, `booking_mode`,
// `booking_url`, `booking_phone`, `analysis_provider`, `daily_scan_cap` and `consent_version`
// are absent from that list on purpose: they are decisions made after this step, and a re-run
// that reset them would silently take a live client's widget down or point their bookings at
// nothing. If you add a column to concierge_configs, decide which list it belongs in.

import { supabaseAdmin } from "@/lib/db";
import { notifyStep } from "./step-board";
import type { AutoResult } from "./artifacts/registry";

/** Where the widget answers. Matches CONCIERGE_HOST in src/lib/hub/host-classify.ts. */
export function conciergeHost(): string {
  return (process.env.CONCIERGE_HOST || "concierge.srtagency.com").trim().toLowerCase();
}

export function conciergeFrameUrl(slug: string): string {
  return `https://${conciergeHost()}/w/${slug}`;
}

/**
 * The origins allowed to frame this client's widget.
 *
 * ‼️ THIS BECOMES A frame-ancestors CSP, WHICH MEANS A MISSING ORIGIN IS A BLANK BOX ON THE
 * CLIENT'S WEBSITE AND AN EXTRA ONE IS A COMPETITOR HARVESTING THEIR LEADS. Both apex and www
 * are seeded because a clinic that redirects one to the other still frames from whichever the
 * visitor typed, and getting that wrong looks like the widget is broken rather than blocked.
 *
 * Their hub hosts are included so the same frame works on learn.{domain} with no second config.
 */
export function seedOrigins(domain: string | null, hosts: string[]): string[] {
  const out = new Set<string>();
  const add = (h: string | null | undefined) => {
    const clean = (h ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (clean) out.add(`https://${clean}`);
  };

  if (domain) {
    const bare = domain.trim().toLowerCase().replace(/^www\./, "");
    add(bare);
    add(`www.${bare}`);
  }
  for (const h of hosts) add(h);

  return [...out].sort();
}

/**
 * Step 16, `concierge_preview`. Creates the config row and posts the demo link.
 *
 * Idempotent by construction: a second run re-seeds the origins (a client who adds a hostname
 * next month wants that) and touches nothing else.
 */
export async function provisionConcierge(clientId: string): Promise<AutoResult> {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, domain, dba_name, legal_name, vertical_slug")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: `clients lookup failed: ${error.message}` };
  if (!client) return { ok: false, error: "no client row" };

  // ‼️ THE SLUG IS THE WIDGET'S PUBLIC ADDRESS. Without one there is no /w/{slug} to hand
  // anybody, and inventing one here would create a second source of truth for a column that
  // already carries a unique constraint. Refuse and say what is missing.
  const slug = (client.slug as string | null)?.trim();
  if (!slug) {
    return {
      ok: false,
      error: "this client has no slug, so there is no /w/{slug} address for the widget",
    };
  }

  const { data: hostRows, error: hostError } = await supabaseAdmin
    .from("client_hosts")
    .select("host")
    .eq("client_id", clientId)
    .eq("enabled", true);

  // A host lookup failure is not fatal: the widget's own hostname does not depend on it, and
  // the origins can be re-seeded by re-running the step. But it must be SAID, not swallowed,
  // because the consequence is a blank box on their website.
  const hosts = (hostRows ?? []).map((h) => h.host as string);
  const hostWarning = hostError
    ? `\n:warning: Could not read \`client_hosts\` (${hostError.message}), so the hub hostnames ` +
      `are missing from the embed allowlist. Re-run this step once that query works.`
    : "";

  const origins = seedOrigins(client.domain as string | null, hosts);
  const url = conciergeFrameUrl(slug);
  const name = (client.dba_name || client.legal_name || "this client") as string;

  // See the header: seeded fields only.
  const { error: upsertError } = await supabaseAdmin.from("concierge_configs").upsert(
    {
      client_id: clientId,
      vertical: (client.vertical_slug as string | null) || "medspa",
      allowed_origins: origins,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" }
  );

  if (upsertError) {
    // The table is created by docs/2026-09-01-concierge.sql. Saying so here saves somebody
    // reading a PostgREST error and assuming the feature is broken.
    return {
      ok: false,
      error:
        `concierge_configs upsert failed: ${upsertError.message}. ` +
        `If this says the relation does not exist, docs/2026-09-01-concierge.sql has not been run.`,
    };
  }

  // output_ref is free text by design — the step-engine migration calls it "a PDF, a report id,
  // a URL" — so the frame URL is a first-class value here, the same as review_tool_preview.
  await supabaseAdmin
    .from("client_delivery_steps")
    .update({ output_ref: url, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("step_key", "concierge_preview");

  await notifyStep(
    clientId,
    "concierge_preview",
    [
      `*AI Skin Concierge — ${name}*`,
      `Preview: ${url}`,
      "",
      ":lock: Not live on their site. `enabled` is false until the `concierge_live` step, so " +
        "this link is for the call and nothing is running on their domain yet.",
      "",
      origins.length
        ? `Embed allowlist seeded with ${origins.length}: ${origins.join(", ")}`
        : ":warning: No embed origins could be seeded. The widget will only frame on its own " +
          "hostname until this client has a `domain` or an attached hub host.",
      "",
      "• Walk it on the call. The scan is the demo, not the slide.",
      // ‼️ THE BOOKING-BOT ASK IS PINNED TO THE MOMENT THE SCAN FINISHES, and this post is the
      // one that hands over the link, so it is where the reminder belongs. Their answer sets the
      // terms of the engagement, and it is the only condition on the five-patient guarantee.
      "• *The moment the scan finishes, ask whether they want the appointment booking bot.* Yes " +
        "puts them on the guarantee, no makes it $499/month flat. Wording is on the `call_held` " +
        "card, and write the answer in your call notes.",
      "• The analysis provider is `mock` until a vendor is chosen, so the scores are synthetic " +
        "and the skin age is deliberately blank. Do not read them out as measurements.",
      hostWarning,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return {
    ok: true,
    note: `Concierge preview ready at ${url}, ${origins.length} embed origin(s) seeded`,
  };
}
