// Supabase for `scraper_cells`: the receipts for every circle this lane has paid to count.
//
// A third file rather than more of store.ts, which owns batches and rows, or listprep.ts, which owns
// the three pipeline tables. This table has its own lifecycle (it outlives every batch, and a row is
// never deleted) so it gets its own reader.
//
// ‼️ NOTHING HERE DECIDES ANYTHING. The walk is in coverage.ts and it is pure; this file only loads
// rows for it and writes down what was measured. Keeping the decision out of the file that talks to
// the database is what lets the whole campaign be proven offline.

import { supabaseAdmin } from "@/lib/db";
import { cellKey, type Cell } from "./cells";
import type { CellRow } from "./coverage";

/**
 * ‼️ A COLUMN MISSING FROM THIS STRING IS SILENTLY `undefined`, NOT AN ERROR, the same trap
 * BATCH_COLUMNS and RUN_COLUMNS both carry a warning about. Here the specific cost is that
 * `total_count` reading undefined becomes 0, and a cell measured at 50,000 would look empty and be
 * marked finished without a single record ever being bought.
 */
const CELL_COLUMNS =
  "id, vertical_slug, categories_key, cell_key, lat, lon, radius_km, total_count, " +
  "state_name, parent_key, depth, cost_usd, probed_at";

function toRow(raw: Record<string, unknown>): CellRow {
  return {
    key: String(raw.cell_key ?? ""),
    verticalSlug: String(raw.vertical_slug ?? ""),
    categoriesKey: String(raw.categories_key ?? ""),
    // numeric() comes back from PostgREST as a string often enough that Number() is not optional.
    lat: Number(raw.lat),
    lon: Number(raw.lon),
    radiusKm: Number(raw.radius_km),
    totalCount: Number(raw.total_count ?? 0),
    stateName: (raw.state_name as string | null) ?? null,
    parentKey: (raw.parent_key as string | null) ?? null,
    depth: Number(raw.depth ?? 0),
  };
}

/**
 * Every measured cell for one vertical and one category list.
 *
 * ‼️ IT THROWS RATHER THAN RETURNING EMPTY, AND THAT IS LOAD-BEARING ON DEPLOY DAY. Code reaches
 * production before the migration is run. If a missing `scraper_cells` table read as "no cells
 * measured", the walk would conclude the country is unmeasured and ask to re-probe all of it, which is
 * real money against a table that already holds the answers. A thrown error fails the batch with a
 * message naming the migration, which is the outcome every other table in this lane produces too.
 */
export async function cellRows(vertical: string, categoriesKey: string): Promise<CellRow[]> {
  const out: CellRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_cells")
      .select(CELL_COLUMNS)
      .eq("vertical_slug", vertical)
      .eq("categories_key", categoriesKey)
      .order("radius_km", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(
        "cellRows: " + error.message +
        ". If that names scraper_cells, docs/2026-09-28-national-coverage-cells.sql has not been run " +
        "on this database."
      );
    }
    const rows = data ?? [];
    // The double cast is this lane's convention for a hand-written column list: supabase-js cannot
    // type a select it did not generate, so it infers GenericStringError.
    for (const r of rows) out.push(toRow(r as unknown as Record<string, unknown>));
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface MeasuredCell {
  cell: Cell;
  verticalSlug: string;
  categoriesKey: string;
  totalCount: number;
  parentKey: string | null;
  depth: number;
  costUsd: number;
}

/**
 * Write down what a probe measured.
 *
 * ‼️ ignoreDuplicates, SO A RE-DRIVEN PROBE STEP STORES NOTHING TWICE. The unique index is
 * (vertical_slug, categories_key, cell_key). A step that died half way through sixteen circles is
 * re-run by hand, and the ones already paid for must not become second rows with a second cost.
 */
export async function insertCells(rows: readonly MeasuredCell[]): Promise<{ inserted: number; error?: string }> {
  if (!rows.length) return { inserted: 0 };

  const payload = rows.map((r) => ({
    vertical_slug: r.verticalSlug,
    categories_key: r.categoriesKey,
    cell_key: cellKey(r.cell),
    lat: r.cell.lat,
    lon: r.cell.lon,
    radius_km: r.cell.radiusKm,
    total_count: r.totalCount,
    parent_key: r.parentKey,
    depth: r.depth,
    cost_usd: r.costUsd,
  }));

  const { data, error } = await supabaseAdmin
    .from("scraper_cells")
    .upsert(payload, { onConflict: "vertical_slug,categories_key,cell_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return {
      inserted: 0,
      error:
        error.message +
        ". If that names scraper_cells, docs/2026-09-28-national-coverage-cells.sql has not been run.",
    };
  }
  return { inserted: data?.length ?? 0 };
}

/**
 * Raise a cell's measurement if this observation is higher.
 *
 * ‼️ A MAXIMUM, NEVER AN OVERWRITE, AND THE INDEX BEING LIVE IS WHY. `total_count` read 159,075 and
 * then 159,074 seconds apart on 2026-09-28. Every record pull returns the number again for free, so
 * these observations keep arriving. Taking the maximum means an upward drift is followed, so no row is
 * lost; and it means a downward drift can never lower the number a finished cell was finished
 * against, so nothing already done comes undone and gets re-paged.
 *
 * Read-then-write rather than a SQL `greatest()`, because PostgREST cannot express one. The race that
 * would matter needs two pulls of the same cell at once, which `activeMapsPull` already forbids.
 */
export async function bumpCellTotal(args: {
  verticalSlug: string;
  categoriesKey: string;
  cellKey: string;
  observed: number;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("scraper_cells")
    .select("id, total_count")
    .eq("vertical_slug", args.verticalSlug)
    .eq("categories_key", args.categoriesKey)
    .eq("cell_key", args.cellKey)
    .maybeSingle();
  // A pull of a cell with no row is possible: somebody named a coordinate by hand. Nothing to raise.
  if (error || !data) return;

  const current = Number((data as { total_count?: unknown }).total_count ?? 0);
  if (args.observed <= current) return;

  await supabaseAdmin
    .from("scraper_cells")
    .update({ total_count: args.observed })
    .eq("id", (data as { id: string }).id);
}

/**
 * Cells whose centre has never been placed in a state.
 *
 * The nullability of `state_name` IS the worklist, the same shape `pendingQualify` and
 * `cellsMissingState`'s siblings across this lane use. A failed reverse geocode leaves the row here to
 * be tried again for free rather than writing a guess.
 */
export async function cellsMissingState(vertical: string, limit: number): Promise<Array<{ id: string; lat: number; lon: number }>> {
  const { data, error } = await supabaseAdmin
    .from("scraper_cells")
    .select("id, lat, lon")
    .eq("vertical_slug", vertical)
    .is("state_name", null)
    // Smallest circles first: their centre label is the most nearly exact, and they are where the
    // records are, so they are the rows a progress card most needs placed.
    .order("radius_km", { ascending: true })
    .limit(limit);
  if (error) throw new Error("cellsMissingState: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return { id: String(row.id), lat: Number(row.lat), lon: Number(row.lon) };
  });
}

export async function setCellState(id: string, stateName: string): Promise<void> {
  const { error } = await supabaseAdmin.from("scraper_cells").update({ state_name: stateName }).eq("id", id);
  if (error) throw new Error("setCellState: " + error.message);
}
