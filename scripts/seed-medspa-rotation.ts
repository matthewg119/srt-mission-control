// Seed the ZIP-by-ZIP rotation for the med-spa prospecting pipeline. Populates
// med_spa_rotation with every US ZIP (~33k rows), highest med-spa-density states
// first, so Route A works through the whole country ZIP by ZIP.
//
// Run once (safe to re-run — upserts on zip):  bun run seed:medspa
//
// The ZIP dataset is fetched from a public JSON source at run time. Override with
// ZIP_DATASET_URL if needed. Expected item shape: { zip_code, city, state }.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lzxgdmfkekansixvetgh.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const DATASET_URL =
  process.env.ZIP_DATASET_URL ||
  "https://raw.githubusercontent.com/millbj92/US-Zip-Codes-JSON/master/USCities.json";

const QUERY = process.env.MEDSPA_QUERY || "med spa";

// Lower number = pulled first. Med spas concentrate in the Sun Belt + affluent
// metros (Matthew's target markets: FL, TX, AZ, NC, GA, TN, plus CA/NV/CO).
const STATE_PRIORITY: Record<string, number> = {
  FL: 1, TX: 2, AZ: 3, CA: 4, NC: 5, GA: 6, TN: 7, NV: 8, CO: 9, NY: 10,
  NJ: 11, IL: 12, WA: 13, VA: 14, SC: 15, "": 99,
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

  console.log(`⬆️  Upserting ${rows.length} unique ZIP rows into med_spa_rotation...`);
  let done = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await supabase.from("med_spa_rotation").upsert(chunk, { onConflict: "zip", ignoreDuplicates: true });
    if (error) throw error;
    done += chunk.length;
    process.stdout.write(`\r   ${done}/${rows.length}`);
  }
  process.stdout.write("\n");

  const { count } = await supabase.from("med_spa_rotation").select("*", { count: "exact", head: true });
  console.log(`✅ med_spa_rotation now has ${count ?? "?"} ZIP rows. FL/TX/AZ/CA/NC/GA/TN pull first.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
