/**
 * Give every seat-holding client a market centre.
 *
 *   bun run scripts/backfill-market-centers.ts --dry
 *   bun run scripts/backfill-market-centers.ts
 *
 * WHY THIS EXISTS. A2 D-P13 says a market is a ten-mile circle on the canonical address, and
 * provisioning now geocodes that on the way in. Clients provisioned BEFORE that have
 * market_center_lat NULL — and a centre-less row is skipped by the market check entirely,
 * so the exclusivity promise silently stops being enforced for them. Silently is the problem.
 *
 * Street address first, ZIP centroid second (see resolveMarketCenter). Never overwrites a
 * centre that already exists: a hand-entered pin is somebody looking at a map, and that
 * beats an address-file match.
 *
 * ‼️ IT DOES NOT TOUCH market_radius_mi. D-P13: "Changing a radius is an admin action,
 * logged, and only ever follows the agreement. The number is not a dial and it is not a
 * negotiating chip." A row set to something other than 10 is REPORTED here and left alone.
 */

import { supabaseAdmin } from "@/lib/db";
import { resolveMarketCenter } from "@/lib/clients/geocode";
import { DEFAULT_MARKET_RADIUS_MI } from "@/lib/clients/normalize";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");

  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, legal_name, dba_name, address_line1, city, state, postal_code, " +
        "market_center_lat, market_center_lng, market_radius_mi"
    )
    .in("billing_status", ["pilot", "active"]);

  if (error) throw new Error(error.message);

  // The multi-line select string defeats supabase-js's type inference, so the row shape is
  // asserted once here rather than cast at every field.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  for (const c of rows) {
    const name = (c.dba_name as string | null) || (c.legal_name as string);
    const radius = (c.market_radius_mi as number | null) ?? DEFAULT_MARKET_RADIUS_MI;

    if (radius !== DEFAULT_MARKET_RADIUS_MI) {
      console.log(
        `!  ${name}: radius is ${radius} mi, not ${DEFAULT_MARKET_RADIUS_MI}. ` +
          `Left alone — changing it is an admin action that follows the agreement.`
      );
    }

    if (c.market_center_lat !== null && c.market_center_lng !== null) {
      console.log(`.  ${name}: already has a centre, skipped.`);
      continue;
    }

    const point = await resolveMarketCenter({
      addressLine1: c.address_line1 as string | null,
      city: c.city as string | null,
      state: c.state as string | null,
      postalCode: c.postal_code as string | null,
    });

    if (!point) {
      console.log(
        `X  ${name}: no address match and no ZIP centroid. HOLDS NO MARKET. ` +
          `Set market_center_lat/lng by hand.`
      );
      continue;
    }

    console.log(
      `+  ${name}: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)} ` +
        `(${point.precision})${point.precision === "zip" ? "  <- ZIP centroid, not the street address" : ""}`
    );

    if (dry) continue;

    const { error: upErr } = await supabaseAdmin
      .from("clients")
      .update({
        market_center_lat: point.lat,
        market_center_lng: point.lng,
        market_locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id as string)
      .is("market_center_lat", null);

    if (upErr) console.error(`   write failed: ${upErr.message}`);
  }

  if (dry) console.log("\n--dry, nothing written.");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
