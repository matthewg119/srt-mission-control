// Poll-based med-spa runner — the local "get me leads now" driver AND the manual
// test. Because the daily webhook is async (needs a public callback URL), this
// script instead SUBMITS + POLLS Outscraper synchronously, then runs the exact
// shared pipeline: filter -> dedupe -> score -> insert med_spa_leads -> scrape
// owner names -> sync Zoho -> post the Slack report -> mark ZIP coverage.
//
//   bun run medspa:run                 # 25 ZIPs (density-first), ~500 leads
//   bun run medspa:run -- --zips 10    # smaller batch
//   bun run medspa:run -- --city Charlotte
//   bun run medspa:run -- --dry-run    # no writes / Zoho / Slack
//   flags: --limit N  --no-owners  --no-zoho  --no-slack
//
// Needs OUTSCRAPER_API_KEY, Supabase, Zoho, and Slack envs (pull from Vercel).

import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { toGroups, OutscraperRecord } from "@/lib/outscraper";
import { buildQuery, processZipResults } from "@/lib/medspa";
import { syncMedSpaRows, MedSpaZohoRow } from "@/lib/medspa-zoho-sync";
import { enrichOwners } from "@/lib/medspa-owner-scrape";

const BASE = "https://api.outscraper.com";
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, def: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const optStr = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const DRY = flag("dry-run");
const DO_OWNERS = !flag("no-owners");
const DO_ZOHO = !DRY && !flag("no-zoho");
const DO_SLACK = !DRY && !flag("no-slack");
const ZIP_COUNT = opt("zips", Math.max(1, Number(process.env.MEDSPA_ZIPS_PER_RUN) || 25));
const LIMIT = opt("limit", Math.max(1, Number(process.env.MEDSPA_LIMIT_PER_ZIP) || 20));
const CITY = optStr("city");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function submitAsync(queries: string[]): Promise<string> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("OUTSCRAPER_API_KEY not set (pull it from Vercel into .env.local)");
  const params = new URLSearchParams();
  for (const q of queries) params.append("query", q);
  params.set("limit", String(LIMIT));
  params.set("async", "true");
  params.set("region", "US");
  params.set("language", "en");
  const res = await fetch(`${BASE}/maps/search-v3?${params.toString()}`, { headers: { "X-API-KEY": apiKey } });
  const json = (await res.json()) as { id?: string; error?: string; message?: string };
  if (!res.ok || !json.id) throw new Error(json.error || json.message || `http_${res.status}`);
  return json.id;
}

async function pollResults(requestId: string, maxTries = 90, everyMs = 5000): Promise<unknown> {
  const apiKey = process.env.OUTSCRAPER_API_KEY as string;
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(`${BASE}/requests/${requestId}`, { headers: { "X-API-KEY": apiKey } });
    const json = (await res.json()) as { status?: string; data?: unknown };
    const status = (json.status || "").toLowerCase();
    if (status === "success" || status === "finished") return json.data ?? null;
    process.stdout.write(`\r   polling… ${i + 1}/${maxTries} (${json.status || "pending"})   `);
    await sleep(everyMs);
  }
  process.stdout.write("\n");
  throw new Error("timed out waiting for Outscraper results");
}

async function pickZips(): Promise<{ id: number; zip: string; state: string | null }[]> {
  let q = supabaseAdmin
    .from("med_spa_rotation")
    .select("id, zip, state, city")
    .eq("active", true)
    .eq("exhausted", false)
    .order("state_priority", { ascending: true })
    .order("zip", { ascending: true })
    .limit(ZIP_COUNT);
  if (CITY) q = q.ilike("city", `%${CITY}%`);
  const { data, error } = await q;
  if (error) throw new Error(`rotation pick failed: ${error.message}`);
  return (data ?? []) as { id: number; zip: string; state: string | null }[];
}

async function main() {
  console.log(`\n💆 Med-spa run — ${ZIP_COUNT} ZIPs × ${LIMIT}${CITY ? ` · city~"${CITY}"` : ""} ${DRY ? "(DRY-RUN)" : ""}`);

  const picked = await pickZips();
  if (!picked.length) {
    console.log("No ZIPs to pull (rotation empty/exhausted — did you run `bun run seed:medspa`?).");
    return;
  }
  const zips = picked.map((p) => p.zip);
  const states = Array.from(new Set(picked.map((p) => p.state).filter(Boolean))) as string[];
  const queries = zips.map((z) => buildQuery(z));
  console.log(`   ZIPs: ${zips.join(", ")}`);

  // Audit run row.
  const { data: runRow } = await supabaseAdmin
    .from("med_spa_runs")
    .insert({ zips_covered: zips, states, queries, status: "submitted" })
    .select("id")
    .single();

  console.log("▶️  submitting async Outscraper job…");
  const requestId = await submitAsync(queries);
  console.log(`   request id: ${requestId}`);
  await supabaseAdmin.from("med_spa_runs").update({ outscraper_request_id: requestId }).eq("id", runRow?.id);

  const data = await pollResults(requestId);
  const groups = toGroups(data) as OutscraperRecord[][];
  const rawCount = groups.reduce((n, g) => n + (Array.isArray(g) ? g.length : 0), 0);
  console.log(`\n✅ results in — ${rawCount} raw records`);

  const result = await processZipResults(supabaseAdmin, groups, zips, { write: !DRY });

  // Owner scrape (best-effort) on the new leads, then persist + it flows to Zoho.
  if (DO_OWNERS && result.inserted.length) {
    const found = await enrichOwners(result.inserted, {
      onProgress: (d, t) => process.stdout.write(`\r   scraping owners… ${d}/${t}   `),
    });
    if (result.inserted.length) process.stdout.write("\n");
    console.log(`   owner names found: ${found}`);
    if (!DRY) {
      await Promise.all(
        result.inserted
          .filter((r) => r.owner_name && r.id)
          .map((r) => supabaseAdmin.from("med_spa_leads").update({ owner_name: r.owner_name }).eq("id", r.id as string))
      );
    }
  }

  // Zoho sync.
  let zohoLine = "skipped";
  if (DO_ZOHO && result.inserted.length) {
    const zoho = await syncMedSpaRows(result.inserted as MedSpaZohoRow[]);
    zohoLine = zoho.disabled ? "disabled" : `${zoho.ok} added, ${zoho.failed} failed`;
    console.log(`   Zoho: ${zohoLine}`);
    if (zoho.errors.length) console.log("   Zoho errors:", zoho.errors.join("; "));
  }

  // Mark ZIP coverage (exhausted when a ZIP returned fewer than the cap).
  if (!DRY) {
    await Promise.all(
      picked.map(async (p) => {
        const cnt = result.perZipCount[p.zip] ?? 0;
        const { data: cur } = await supabaseAdmin.from("med_spa_rotation").select("times_pulled").eq("id", p.id).single();
        await supabaseAdmin
          .from("med_spa_rotation")
          .update({ exhausted: cnt < LIMIT, times_pulled: ((cur?.times_pulled as number) ?? 0) + 1, last_pulled_at: new Date().toISOString() })
          .eq("id", p.id);
      })
    );
    await supabaseAdmin
      .from("med_spa_runs")
      .update({
        status: "completed",
        requested: result.requested,
        new_leads: result.newLeads,
        duplicates: result.duplicates,
        filtered_out: result.filteredOut,
        with_phone: result.withPhone,
        with_website: result.withWebsite,
        with_owner: result.inserted.filter((r) => r.owner_name).length,
      })
      .eq("id", runRow?.id);
  }

  const avg = result.inserted.length
    ? (result.inserted.reduce((a, r) => a + (r.lead_score ?? 0), 0) / result.inserted.length).toFixed(1)
    : "0";
  const withOwner = result.inserted.filter((r) => r.owner_name).length;

  console.log("\n────────────────────────────────────────────");
  console.log(`Raw records:    ${rawCount}`);
  console.log(`Filtered out:   ${result.filteredOut}  (derm / plastic surgeon / hospital)`);
  console.log(`Duplicates:     ${result.duplicates}`);
  console.log(`New leads:      ${result.newLeads}`);
  console.log(`With phone:     ${result.withPhone}`);
  console.log(`With website:   ${result.withWebsite}`);
  console.log(`With owner:     ${withOwner}`);
  console.log(`Avg score:      ${avg}`);
  console.log(`Zoho:           ${zohoLine}`);
  console.log("────────────────────────────────────────────");

  // Slack report (same shape as the daily webhook).
  const followups = process.env.SLACK_MEDSPA_CHANNEL || process.env.SLACK_FOLLOWUPS_CHANNEL || "";
  if (DO_SLACK && followups) {
    const { count: runningTotal } = await supabaseAdmin.from("med_spa_leads").select("*", { count: "exact", head: true });
    const blocks: SlackBlock[] = [
      { type: "header", text: { type: "plain_text", text: "💆 Med Spa Prospects", emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*📍 Area:*\n${zips.length} ZIPs · ${states.join(", ") || "USA"}` },
          { type: "mrkdwn", text: `*✅ New / ♻️ Dupes:*\n${result.newLeads} / ${result.duplicates}` },
          { type: "mrkdwn", text: `*📞 Phone / 🌐 Site:*\n${result.withPhone} / ${result.withWebsite}` },
          { type: "mrkdwn", text: `*👤 Owner / ⭐ Avg:*\n${withOwner} / ${avg}` },
          { type: "mrkdwn", text: `*📊 Total in DB:*\n${runningTotal ?? 0}` },
          { type: "mrkdwn", text: `*🗂️ Zoho:*\n${zohoLine}` },
        ],
      },
    ];
    await slack.postMessage(followups, `💆 Med spa prospects — ${result.newLeads} new`, blocks);
    console.log("📨 posted report to Slack.");
  } else if (DRY) {
    console.log("(dry-run — no writes, no Zoho, no Slack.)");
  }
}

main().catch((err) => {
  console.error("\n❌ medspa:run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
