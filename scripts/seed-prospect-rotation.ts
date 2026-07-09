// Seed the ZIP-by-ZIP rotation for the pest-control prospecting pipeline.
// Populates prospect_rotation with every US ZIP (~33k rows), Sun Belt first, so
// Route A works through the whole country ZIP by ZIP, state by state.
//
// Run once (safe to re-run — upserts on zip):  bun run seed:prospects
//
// The ZIP dataset is fetched from a public JSON source at run time (this is a
// one-time manual seed, so a 30k-row SQL paste is impractical). Override the
// source with ZIP_DATASET_URL if needed. Expected item shape:
//   { zip_code: number|string, city: string, state: string }

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lzxgdmfkekansixvetgh.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const DATASET_URL =
  process.env.ZIP_DATASET_URL ||
  "https://raw.githubusercontent.com/millbj92/US-Zip-Codes-JSON/master/USCities.json";

const QUERY = process.env.PROSPECT_QUERY || "pest control";

// Lower number = pulled first. Sun Belt leads (that's where pest control
// concentrates); everything else defaults to 100.
const STATE_PRIORITY: Record<string, number> = {
  TX: 1, FL: 2, AZ: 3, GA: 4, NC: 5, SC: 6, TN: 7, NV: 8, CA: 9, LA: 10,
  AL: 11, MS: 12, AR: 13, OK: 14, NM: 15, "": 99,
};

interface RawZip {
  zip_code?: number | string;
  zip?: number | string;
  city?: string;
  state?: string;
  state_abbr?: string;
}

function pad5(z: number | string): string {
  return String(z).replace(/[^0-9]/g, "").padStart(5, "0").slice(0, 5);
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (set it in .env.local).");
  }

  console.log(`⬇️  Fetching ZIP dataset: ${DATASET_URL}`);
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`Dataset fetch failed: HTTP ${res.status}`);
  const raw = (await res.json()) as RawZip[];
  console.log(`   got ${raw.length} raw rows`);

  // De-dupe by ZIP, build rows.
  const byZip = new Map<string, { zip: string; city: string | null; state: string | null }>();
  for (const r of raw) {
    const zip = pad5(r.zip_code ?? r.zip ?? "");
    if (zip.length !== 5) continue;
    const state = (r.state ?? r.state_abbr ?? "").toString().trim().toUpperCase() || null;
    if (!byZip.has(zip)) byZip.set(zip, { zip, city: (r.city ?? "").toString().trim() || null, state });
  }

  const rows = Array.from(byZip.values()).map((r) => ({
    zip: r.zip,
    city: r.city,
    state: r.state,
    state_priority: r.state ? STATE_PRIORITY[r.state] ?? 100 : 99,
    query: QUERY,
  }));

  console.log(`⬆️  Upserting ${rows.length} unique ZIP rows into prospect_rotation...`);
  let done = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await supabase
      .from("prospect_rotation")
      .upsert(chunk, { onConflict: "zip", ignoreDuplicates: true });
    if (error) throw error;
    done += chunk.length;
    process.stdout.write(`\r   ${done}/${rows.length}`);
  }
  process.stdout.write("\n");

  const { count } = await supabase
    .from("prospect_rotation")
    .select("*", { count: "exact", head: true });
  console.log(`✅ prospect_rotation now has ${count ?? "?"} ZIP rows. Sun Belt (TX/FL/AZ/GA/...) will pull first.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
