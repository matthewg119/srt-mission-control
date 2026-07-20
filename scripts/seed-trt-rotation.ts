// Seed the metro x query rotation for the TRT-clinic prospecting pipeline.
// Populates trt_rotation with one row per (metro anchor city x query): 18 anchors
// x 10 core queries (active) + 18 x 7 expansion queries (inactive) = 306 rows.
// Expansion rows activate per metro when that metro's core queries exhaust
// (see activateExpansionForMetros in src/lib/trt.ts).
//
// Run once (safe to re-run — upserts on query, never reactivates/un-exhausts):
//   bun run seed:trt

import { createClient } from "@supabase/supabase-js";
import { METROS, CORE_QUERIES, EXPANSION_QUERIES, buildQuery } from "@/lib/trt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lzxgdmfkekansixvetgh.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (set it in .env.local).");
  }

  const rows: Record<string, unknown>[] = [];
  for (const metro of METROS) {
    for (const anchor of metro.anchors) {
      for (const { queries, tier } of [
        { queries: CORE_QUERIES, tier: "core" },
        { queries: EXPANSION_QUERIES, tier: "expansion" },
      ]) {
        for (const base of queries) {
          rows.push({
            metro_key: metro.key,
            metro_label: metro.label,
            anchor_city: anchor.city,
            state: anchor.state,
            metro_priority: metro.priority,
            base_query: base,
            query: buildQuery(base, anchor.city, anchor.state),
            tier,
            active: tier === "core",
          });
        }
      }
    }
  }

  const core = rows.filter((r) => r.tier === "core").length;
  console.log(`⬆️  Upserting ${rows.length} rotation rows (${core} core active, ${rows.length - core} expansion inactive)...`);

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("trt_rotation").upsert(chunk, { onConflict: "query", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { count } = await supabase.from("trt_rotation").select("*", { count: "exact", head: true });
  console.log(`✅ trt_rotation now has ${count ?? "?"} rows. DFW/Houston/Phoenix pull first.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
