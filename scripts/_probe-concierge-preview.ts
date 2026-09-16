/**
 * Probe: a client's AI Concierge demo opens BEFORE any DNS exists.
 *
 *   bunx tsx --env-file=<prod env> scripts/_probe-concierge-preview.ts <slug>
 *
 * ‼️ THE WHOLE POINT IS THE HOST. concierge.srtagency.com is NXDOMAIN and always has been, so a
 * link on that host cannot open for anybody, on the call or otherwise. The demo runs on Mission
 * Control's own origin, which already serves /w/{slug}, and a signed preview token is what opens a
 * tenant whose widget is still switched off (which, before concierge_live, is all of them).
 *
 * D5, 2026-09-11: "Previews first, DNS later. Hub, review tool and concierge must all be viewable
 * before the call with no DNS."
 *
 * It prints what it asked for and what came back, and nothing else: no writes, no Slack, no step.
 */
import { supabaseAdmin } from "../src/lib/db";

const SLUG = process.argv[2] ?? "srt-agency-llc";

async function main() {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name, domain")
    .eq("slug", SLUG)
    .maybeSingle();

  if (!client) throw new Error(`no clients row with slug "${SLUG}"`);

  const clientId = client.id as string;
  const name = ((client.dba_name || client.legal_name) as string) ?? SLUG;
  console.log(`${name}  (${SLUG})\n`);

  const { data: cfg } = await supabaseAdmin
    .from("concierge_configs")
    .select("audience, audience_confirmed_at, enabled, allowed_origins")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!cfg) {
    console.log("  concierge_configs: NO ROW. Step concierge_preview has not run for this client.");
    return;
  }

  console.log(`  audience        ${cfg.audience}${cfg.audience_confirmed_at ? " (confirmed)" : " (not confirmed)"}`);
  console.log(`  enabled         ${cfg.enabled} ${cfg.enabled ? "" : "(correct before concierge_live)"}`);
  console.log(`  embed origins   ${((cfg.allowed_origins as string[] | null) ?? []).length}`);

  const { data: step } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status, output_ref")
    .eq("client_id", clientId)
    .eq("step_key", "concierge_preview")
    .maybeSingle();

  const stored = (step?.output_ref as string | null) ?? null;
  console.log(`\n  step status     ${step?.status ?? "no row"}`);
  console.log(`  stored link     ${stored ?? "none"}`);

  if (stored && stored.includes("concierge.srtagency.com")) {
    console.log("  ‼️ THE STORED LINK IS ON THE DEAD HOST. It was written before 2026-09-11 and");
    console.log("     re-running this step replaces it with one that opens.");
  }

  // The link as the card would mint it TODAY.
  const { conciergePreviewUrl } = await import("../src/lib/clients/concierge-setup");
  const fresh = conciergePreviewUrl(clientId, SLUG);

  if (!fresh) {
    console.log("\n  ‼️ No link could be minted: CLIENT_LINK_SECRET is not set in this environment.");
    return;
  }

  const url = new URL(fresh);
  console.log(`\n  minting on      ${url.host}${url.pathname}  (token withheld from this line)`);

  const started = Date.now();
  try {
    const res = await fetch(fresh, { redirect: "manual" });
    const ms = Date.now() - started;
    console.log(`  answered        ${res.status} ${res.statusText} in ${ms}ms`);
    if (res.status >= 200 && res.status < 300) {
      console.log("\n  ✅ The demo opens with no DNS. This is the link to walk on the call:");
      console.log(`\n  ${fresh}\n`);
    } else {
      console.log("\n  ❌ It did not answer 200, so the card would withhold it rather than post a dead link.");
    }
  } catch (e) {
    console.log(`  ❌ the request failed: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
