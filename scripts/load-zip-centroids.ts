/**
 * Load public.zip_centroids from the US Census ZCTA Gazetteer.
 *
 *   bun run scripts/load-zip-centroids.ts
 *   bun run scripts/load-zip-centroids.ts --file=/path/to/2024_Gaz_zcta_national.txt
 *   bun run scripts/load-zip-centroids.ts --dry
 *
 * WHY THIS EXISTS. A2 D-P13's checkout check needs a ZIP to become a point, and the Census
 * GEOCODER cannot do that — measured 2026-08-18, it matches street addresses only:
 *
 *   "27403"                                  -> NO MATCH
 *   "27403, NC"                              -> NO MATCH
 *   "Greensboro, NC 27403"                   -> NO MATCH
 *   "1200 W Market St, Greensboro, NC 27403" -> 36.0734, -79.8069
 *
 * That is why A2 §2 offers a second option: "a static ZIP-centroid dataset". This is it.
 * The Gazetteer is public domain, needs no key and no vendor, and the columns we want are
 * GEOID (the ZCTA, which is the ZIP), INTPTLAT and INTPTLONG.
 *
 * ‼️ UNTIL THIS HAS RUN, EVERY MED-SPA CHECKOUT PASSES THE MARKET CHECK UNCHECKED and posts
 * a Slack alert saying so. It fails open on purpose — a missing dataset must not stop
 * somebody paying us — but it is never silent, because a market check that always passes
 * quietly is worse than no market check at all.
 *
 * Re-runnable: upserts on the primary key. Re-run it when the Census publishes a new
 * vintage; ZCTAs do change.
 */

import { readFileSync } from "node:fs";
import { supabaseAdmin } from "@/lib/db";

const SOURCE =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip";

interface Row {
  zip: string;
  lat: number;
  lng: number;
}

function parse(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split("\t").map((h) => h.trim());
  if (!header) throw new Error("empty file");

  const iZip = header.indexOf("GEOID");
  const iLat = header.indexOf("INTPTLAT");
  const iLng = header.indexOf("INTPTLONG");

  if (iZip < 0 || iLat < 0 || iLng < 0) {
    throw new Error(`unexpected columns: ${header.join(", ")}`);
  }

  const out: Row[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // The Gazetteer pads INTPTLONG with trailing spaces. Trim every cell, not just that one.
    const cells = line.split("\t").map((c) => c.trim());
    const zip = cells[iZip];
    const lat = Number(cells[iLat]);
    const lng = Number(cells[iLng]);

    // Skip rather than guess. A ZCTA we cannot place is one we must not pretend to know:
    // the whole point of this table is answering "is this point inside a held market".
    if (!/^\d{5}$/.test(zip ?? "")) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    out.push({ zip, lat, lng });
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);

  if (!fileArg) {
    console.error(
      `No --file given.\n\n` +
        `  1. Download ${SOURCE}\n` +
        `  2. Unzip it\n` +
        `  3. bun run scripts/load-zip-centroids.ts --file=./2024_Gaz_zcta_national.txt\n`
    );
    process.exit(1);
  }

  const rows = parse(readFileSync(fileArg, "utf8"));
  console.log(`Parsed ${rows.length} ZCTAs from ${fileArg}`);

  // A spot check that would catch a lat/lng swap, which is the one mistake here that looks
  // fine and puts every American ZIP in the Indian Ocean.
  const gso = rows.find((r) => r.zip === "27403");
  console.log(`27403 -> ${gso ? `${gso.lat}, ${gso.lng}` : "MISSING"}`);
  if (gso && (gso.lat < 25 || gso.lat > 50 || gso.lng > -60 || gso.lng < -130)) {
    throw new Error("27403 is not in the continental US. Columns are probably swapped.");
  }

  if (dry) {
    console.log("--dry, nothing written.");
    return;
  }

  const BATCH = 1000;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabaseAdmin
      .from("zip_centroids")
      .upsert(chunk, { onConflict: "zip" });

    if (error) throw new Error(`batch at ${i} failed: ${error.message}`);
    written += chunk.length;
    if (i % 5000 === 0) console.log(`  ${written}/${rows.length}`);
  }

  const { count } = await supabaseAdmin
    .from("zip_centroids")
    .select("zip", { count: "exact", head: true });

  console.log(`Done. ${written} upserted, ${count} rows in the table.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
