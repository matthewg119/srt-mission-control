// Poll-based TRT runner — the local "get me leads now" driver AND the manual
// test. Because the nightly webhook is async (needs a public callback URL), this
// script instead SUBMITS + POLLS Outscraper synchronously, then runs the exact
// shared pipeline: filter -> flag chains -> dedupe -> verify phones -> insert
// trt_leads -> scrape owner names -> post the Slack report ->
// stamp rotation coverage + activate expansion queries.
//
//   bun run trt:run                     # 15 queries (Sun Belt first)
//   bun run trt:run -- --queries 5      # smaller batch
//   bun run trt:run -- --metro dfw      # one metro only (metro_key or label)
//   bun run trt:run -- --dry-run        # no writes / Slack
//   flags: --limit N  --no-owners  --no-slack
//
// Needs OUTSCRAPER_API_KEY, Supabase and Slack envs (pull from Vercel).

import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { toGroups, OutscraperRecord } from "@/lib/outscraper";
import { processQueryResults, activateExpansionForMetros, TrtJob, METROS } from "@/lib/trt";
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
const DO_SLACK = !DRY && !flag("no-slack");
const QUERY_COUNT = opt("queries", Math.max(1, Number(process.env.TRT_QUERIES_PER_RUN) || 15));
const LIMIT = opt("limit", Math.max(1, Number(process.env.TRT_LIMIT_PER_QUERY) || 40));
const METRO = optStr("metro");

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

async function pickRows(): Promise<{ id: number; metro_key: string; query: string }[]> {
  let q = supabaseAdmin
    .from("trt_rotation")
    .select("id, metro_key, metro_label, query")
    .eq("active", true)
    .eq("exhausted", false)
    .order("metro_priority", { ascending: true })
    .order("tier", { ascending: true })
    .order("id", { ascending: true })
    .limit(QUERY_COUNT);
  if (METRO) q = q.or(`metro_key.eq.${METRO},metro_label.ilike.%${METRO}%`);
  const { data, error } = await q;
  if (error) throw new Error(`rotation pick failed: ${error.message}`);
  return (data ?? []) as { id: number; metro_key: string; query: string }[];
}

async function main() {
  console.log(`\n💉 TRT run — ${QUERY_COUNT} queries × ${LIMIT}${METRO ? ` · metro~"${METRO}"` : ""} ${DRY ? "(DRY-RUN)" : ""}`);

  const picked = await pickRows();
  if (!picked.length) {
    console.log("No queries to pull (rotation empty/exhausted — did you run `bun run seed:trt`?).");
    return;
  }
  const jobs: TrtJob[] = picked.map((p) => ({ rotationId: p.id, query: p.query, metroKey: p.metro_key }));
  const queries = jobs.map((j) => j.query);
  const metros = Array.from(new Set(jobs.map((j) => j.metroKey)));
  console.log(`   queries:\n     ${queries.join("\n     ")}`);

  // Audit run row.
  const { data: runRow } = await supabaseAdmin
    .from("trt_runs")
    .insert({ metros, queries, rotation_ids: picked.map((p) => p.id), status: "submitted" })
    .select("id")
    .single();

  console.log("▶️  submitting async Outscraper job…");
  const requestId = await submitAsync(queries);
  console.log(`   request id: ${requestId}`);
  await supabaseAdmin.from("trt_runs").update({ outscraper_request_id: requestId }).eq("id", runRow?.id);

  const data = await pollResults(requestId);
  const groups = toGroups(data) as OutscraperRecord[][];
  const rawCount = groups.reduce((n, g) => n + (Array.isArray(g) ? g.length : 0), 0);
  console.log(`\n✅ results in — ${rawCount} raw records`);

  const result = await processQueryResults(supabaseAdmin, groups, jobs, { write: !DRY });

  // Owner scrape (best-effort) on the new leads, then persist.
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
          .map((r) => supabaseAdmin.from("trt_leads").update({ owner_name: r.owner_name }).eq("id", r.id as string))
      );
    }
  }


  // Stamp rotation coverage + activate expansion for drained metros.
  let activatedLabels: string[] = [];
  if (!DRY) {
    await Promise.all(
      jobs.map(async (job) => {
        const cnt = result.perQueryCount[job.query] ?? 0;
        const { data: cur } = await supabaseAdmin.from("trt_rotation").select("times_pulled, consecutive_empty").eq("id", job.rotationId).single();
        await supabaseAdmin
          .from("trt_rotation")
          .update({
            exhausted: cnt < LIMIT,
            times_pulled: ((cur?.times_pulled as number) ?? 0) + 1,
            consecutive_empty: cnt === 0 ? ((cur?.consecutive_empty as number) ?? 0) + 1 : 0,
            last_pulled_at: new Date().toISOString(),
          })
          .eq("id", job.rotationId);
      })
    );
    const activated = await activateExpansionForMetros(supabaseAdmin, metros);
    activatedLabels = activated.map((k) => METROS.find((m) => m.key === k)?.label ?? k);
    await supabaseAdmin
      .from("trt_runs")
      .update({
        status: "completed",
        requested: result.requested,
        new_leads: result.newLeads,
        duplicates: result.duplicates,
        filtered_out: result.filteredOut,
        invalid_phone: result.invalidPhone,
        flagged_chains: result.flaggedChains,
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
  console.log(`Filtered out:   ${result.filteredOut}  (hospital / pharmacy / big groups / telehealth)`);
  console.log(`Duplicates:     ${result.duplicates}`);
  console.log(`New leads:      ${result.newLeads}`);
  console.log(`Callable phone: ${result.withPhone}  (${result.invalidPhone} failed verification)`);
  console.log(`Chains flagged: ${result.flaggedChains}  (kept, multi_location_flag)`);
  console.log(`With website:   ${result.withWebsite}`);
  console.log(`With owner:     ${withOwner}`);
  console.log(`Avg score:      ${avg}`);
  if (activatedLabels.length) console.log(`Expansion on:   ${activatedLabels.join(", ")}`);
  console.log("────────────────────────────────────────────");

  // Slack report (same shape as the nightly webhook).
  const followups = process.env.SLACK_TRT_CHANNEL || process.env.SLACK_FOLLOWUPS_CHANNEL || "";
  if (DO_SLACK && followups) {
    const { count: runningTotal } = await supabaseAdmin.from("trt_leads").select("*", { count: "exact", head: true });
    const blocks: SlackBlock[] = [
      { type: "header", text: { type: "plain_text", text: "💉 TRT Clinic Prospects", emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*📍 Metros:*\n${metros.join(", ")} (${queries.length} queries)` },
          { type: "mrkdwn", text: `*✅ New / ♻️ Dupes:*\n${result.newLeads} / ${result.duplicates}` },
          { type: "mrkdwn", text: `*📞 Callable / 🌐 Site:*\n${result.withPhone} / ${result.withWebsite}` },
          { type: "mrkdwn", text: `*🏢 Chains / ⭐ Avg:*\n${result.flaggedChains} / ${avg}` },
          { type: "mrkdwn", text: `*📊 Total in DB:*\n${runningTotal ?? 0}` },
        ],
      },
    ];
    await slack.postMessage(followups, `💉 TRT clinic prospects — ${result.newLeads} new`, blocks);
    console.log("📨 posted report to Slack.");
  } else if (DRY) {
    console.log("(dry-run — no writes, no Slack.)");
  }
}

main().catch((err) => {
  console.error("\n❌ trt:run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
