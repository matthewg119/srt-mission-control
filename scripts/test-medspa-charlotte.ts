// Synchronous Charlotte test for the med-spa pipeline — run this BEFORE the full
// 10-city batch. It submits Charlotte's 7 search terms to Outscraper, POLLS the
// results endpoint until the job finishes (no webhook / deploy needed), runs the
// exact same map -> filter -> dedupe -> score logic the webhook uses, optionally
// enriches Instagram by fetching each spa's website, and prints a summary table.
//
//   bun run medspa:test              # dry-run (default): nothing written
//   bun run medspa:test -- --write   # actually insert into med_spa_leads
//   bun run medspa:test -- --no-enrich   # skip the website Instagram fetch
//
// Needs OUTSCRAPER_API_KEY (+ Supabase envs for --write / dedupe lookups).

import { createClient } from "@supabase/supabase-js";
import { toGroups, OutscraperRecord } from "../src/lib/outscraper";
import {
  SEARCH_TERMS,
  buildQuery,
  processCityResults,
  insertMedSpaLeads,
  scoreLead,
  MedSpaLeadRow,
} from "../src/lib/medspa";

const CITY = "Charlotte";
const STATE = "NC";
const BASE = "https://api.outscraper.com";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const ENRICH = !argv.includes("--no-enrich");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Submit an async Google Maps search (no webhook) and return Outscraper's request id. */
async function submitAsync(queries: string[], limit: number): Promise<string> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error("OUTSCRAPER_API_KEY not set");
  const params = new URLSearchParams();
  for (const q of queries) params.append("query", q);
  params.set("limit", String(limit));
  params.set("async", "true");
  params.set("region", "US");
  params.set("language", "en");
  const res = await fetch(`${BASE}/maps/search-v3?${params.toString()}`, {
    headers: { "X-API-KEY": apiKey },
  });
  const json = (await res.json()) as { id?: string; error?: string; message?: string };
  if (!res.ok || !json.id) throw new Error(json.error || json.message || `http_${res.status}`);
  return json.id;
}

/** Poll the request until it finishes; returns the raw `data` payload. */
async function pollResults(requestId: string, maxTries = 60, everyMs = 5000): Promise<unknown> {
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

/** Fetch a website homepage and pull the first real instagram handle out of the HTML. */
async function instagramFromSite(website: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const url = website.startsWith("http") ? website : `https://${website}`;
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (m && m[1] && !["p", "reel", "explore", "stories", "accounts"].includes(m[1].toLowerCase())) {
      return `@${m[1].replace(/\/$/, "")}`;
    }
  } catch {
    /* timeout / DNS / TLS — just skip */
  }
  return null;
}

/** Back-fill instagram_handle for rows that lack it, bounded concurrency, then re-score. */
async function enrichInstagram(rows: MedSpaLeadRow[]): Promise<number> {
  const targets = rows.filter((r) => !r.instagram_handle && r.website);
  let found = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const handle = await instagramFromSite(row.website as string);
        if (handle) {
          row.instagram_handle = handle;
          row.lead_score = scoreLead(row);
          found++;
        }
      })
    );
    process.stdout.write(`\r   enriching Instagram… ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}   `);
  }
  if (targets.length) process.stdout.write("\n");
  return found;
}

async function main() {
  const limit = Math.max(1, Number(process.env.MEDSPA_LIMIT_PER_QUERY) || 20);
  const queries = SEARCH_TERMS.map((t) => buildQuery(t, CITY, STATE));

  console.log(`\n🧪 Med-spa test — ${CITY}, ${STATE}  (${WRITE ? "WRITE" : "dry-run"}${ENRICH ? ", +IG enrich" : ""})`);
  console.log(`   queries: ${queries.join(" | ")}`);

  console.log("▶️  submitting async Outscraper job…");
  const requestId = await submitAsync(queries, limit);
  console.log(`   request id: ${requestId}`);

  const data = await pollResults(requestId);
  const groups = toGroups(data) as OutscraperRecord[][];
  const rawCount = groups.reduce((n, g) => n + (Array.isArray(g) ? g.length : 0), 0);
  console.log(`\n✅ results in — ${rawCount} raw records across ${groups.length} term groups`);

  // Same map -> filter -> dedupe -> score as the webhook (write=false here).
  const result = await processCityResults(supabase, groups, CITY, STATE, { write: false });

  if (ENRICH) {
    const found = await enrichInstagram(result.inserted);
    console.log(`   Instagram back-filled from websites: +${found}`);
  }

  // Summary.
  const rows = result.inserted;
  const withInsta = rows.filter((r) => r.instagram_handle).length;
  const avg = rows.length ? (rows.reduce((a, r) => a + (r.lead_score ?? 0), 0) / rows.length).toFixed(1) : "0";
  const high = rows.filter((r) => (r.lead_score ?? 0) >= 8).length;

  console.log("\n────────────────────────────────────────────");
  console.log(`Raw records:      ${rawCount}`);
  console.log(`Filtered out:     ${result.filteredOut}  (derm / plastic surgeon / hospital)`);
  console.log(`Duplicates:       ${result.duplicates}  (across 7 terms + already in DB)`);
  console.log(`New leads:        ${result.newLeads}`);
  console.log(`With Instagram:   ${withInsta}`);
  console.log(`Avg score / 8+:   ${avg} / ${high}`);
  console.log("────────────────────────────────────────────");

  const top = [...rows].sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0)).slice(0, 15);
  console.log("\nTop leads by score:");
  for (const r of top) {
    const bits = [
      `[${r.lead_score}]`.padStart(4),
      (r.business_name || "").slice(0, 34).padEnd(34),
      `★${r.rating ?? "-"} (${r.review_count ?? 0})`.padEnd(14),
      (r.instagram_handle || "-").padEnd(20),
      r.photo_count != null ? `${r.photo_count}📷` : "",
    ];
    console.log("  " + bits.join(" "));
  }

  if (WRITE) {
    console.log(`\n💾 writing ${rows.length} rows to med_spa_leads…`);
    await insertMedSpaLeads(supabase, rows);
    console.log("   done.");
  } else {
    console.log("\n(dry-run — nothing written. Re-run with `-- --write` to insert.)");
  }
}

main().catch((err) => {
  console.error("\n❌ medspa:test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
