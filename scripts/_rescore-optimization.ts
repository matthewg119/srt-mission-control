// Re-score a finished batch's GBP optimization against the CURRENT weights, spending nothing.
//
//   bunx tsx --env-file=<envfile> scripts/_rescore-optimization.ts <batch-id>          # dry run
//   bunx tsx --env-file=<envfile> scripts/_rescore-optimization.ts <batch-id> --write
//
// The scoring rules changed from pass/fail to graduated on 2026-08-29, and every row already in the
// table carries a number produced by the old rules. `optimization_components` stores `{weight,
// attempted, earned, note}` per component and NOT the raw counts, so the new curves cannot be
// applied to what is stored: nothing there says a profile had 28 photos rather than 6.
//
// ‼️ THE RAW PROFILE IS STILL FETCHABLE AND IT IS FREE. `task_get` costs nothing and a DataForSEO
// result stays collectable for 30 days, so a re-score re-reads the profiles the batch already paid
// for rather than buying them again. That is the same property the SERP backfill leans on, and it
// is the only reason a scoring change can be applied retroactively at all instead of being a
// re-run at full price.
//
// ‼️ THE LANDING PAGE IS RE-CRAWLED, AND THE STORED NOTE IS DELIBERATELY NOT PARSED. The old note
// collapses three different pages into one string: "neither title nor h1 names both" is true of a
// page carrying the category in its title and true of a page carrying nothing at all, and under the
// new four-check rule those score 5 and 0. Mapping the old note onto the new scale would invent the
// difference. Crawling costs our own bandwidth and no money.
//
// Dry run by default; `--write` to act.

import { getGbpInfoTask } from "../src/lib/scraper/dataforseo";
import {
  extractFirstH1,
  presenceScore,
  readProfileUrl,
  scoreOptimization,
  type GbpProfile,
  type GbpSerpFacts,
  type LandingPageFacts,
} from "../src/lib/scraper/gbp-audit";
import { researchWebsite, SiteFetchError } from "../src/lib/audit-engine/site-research";
import { supabaseAdmin } from "../src/lib/db";

const BATCH_ID = process.argv[2];
const WRITE = process.argv.includes("--write");

/** How many landing pages to crawl at once. Their sites, our bandwidth, so keep it neighbourly. */
const CRAWL_CONCURRENCY = 6;

if (!BATCH_ID) {
  console.error("usage: _rescore-optimization.ts <batch-id> [--write]");
  process.exit(1);
}

interface Row {
  id: string;
  company: string | null;
  city: string | null;
  dominance_score: number | null;
  score_components: Record<string, unknown> | null;
  optimization_score: number | null;
  optimization_components: Record<string, unknown> | null;
  gbp_task_id: string | null;
  gbp_cid: string | null;
  gbp_serp: Record<string, unknown> | null;
}

/** Verbatim the lane's reader, so the re-score and the live sweep read one shape. */
function storedSerpFacts(row: Row): GbpSerpFacts | null {
  const raw = row.gbp_serp;
  if (!raw) return null;
  return {
    cid: row.gbp_cid ?? (typeof raw.cid === "string" ? raw.cid : null),
    placeId: typeof raw.placeId === "string" ? raw.placeId : null,
    category: typeof raw.category === "string" ? raw.category : null,
    city: typeof raw.city === "string" ? raw.city : null,
    description: typeof raw.description === "string" ? raw.description : null,
    url: typeof raw.url === "string" ? raw.url : null,
    cidSource:
      raw.cidSource === "knowledge_graph" || raw.cidSource === "local_pack" ? raw.cidSource : null,
  };
}

async function crawl(url: string | null): Promise<LandingPageFacts | null> {
  if (!url) return null;
  try {
    const research = await researchWebsite(url);
    return { crawled: true, title: research.title, h1: extractFirstH1(research.homepageHtml) };
  } catch (e) {
    // ‼️ A SITE THAT WILL NOT LOAD IS UNMEASURED, NEVER FAILED. Same line the lane holds.
    if (!(e instanceof SiteFetchError)) {
      console.error("  crawl threw for", url, (e as Error).message);
    }
    return { crawled: false, title: null, h1: null };
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select(
        "id, company, city, dominance_score, score_components, optimization_score, " +
          "optimization_components, gbp_task_id, gbp_cid, gbp_serp"
      )
      .eq("batch_id", BATCH_ID)
      .order("row_index", { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < 500) break;
  }

  console.log((WRITE ? "WRITE" : "DRY RUN") + "  batch " + BATCH_ID + ", " + rows.length + " rows");

  const withTask = rows.filter((r) => r.gbp_task_id);
  console.log("re-collecting " + withTask.length + " profiles (task_get, free)...");

  const profiles = new Map<string, GbpProfile | null>();
  let collected = 0;
  let gone = 0;
  for (const row of withTask) {
    const res = await getGbpInfoTask(row.gbp_task_id as string);
    if (res.state === "ready" && res.payload) {
      profiles.set(row.id, res.payload as GbpProfile);
      collected++;
    } else {
      // ‼️ PAST 30 DAYS, OR A TASK THAT FAILED. The row KEEPS its existing score rather than being
      // re-scored against a profile nobody could read: a re-score that cannot see the profile is
      // not a lower score, it is no score, and overwriting a real number with one would be the
      // denominator rule failing at the top level.
      gone++;
    }
  }
  console.log("  collected " + collected + ", uncollectable " + gone);

  const targets = rows.filter((r) => profiles.has(r.id) || r.gbp_serp);
  console.log("crawling " + targets.length + " landing pages (our bandwidth, no money)...");
  const pages = await mapLimited(targets, CRAWL_CONCURRENCY, async (row) => {
    const serp = storedSerpFacts(row);
    const profile = profiles.get(row.id) ?? null;
    return crawl(readProfileUrl(profile) ?? serp?.url ?? null);
  });

  let changed = 0;
  let up = 0;
  let down = 0;
  const writes: Array<{ id: string; score: number | null; components: Record<string, unknown> }> = [];
  const moves: Array<{ company: string; before: number | null; after: number | null }> = [];

  targets.forEach((row, i) => {
    const serp = storedSerpFacts(row);
    const profile = profiles.get(row.id) ?? null;
    // A row whose profile could not be re-collected is left exactly as it was.
    if (row.gbp_task_id && !profile) return;

    const result = scoreOptimization({ serp, profile, page: pages[i], fallbackCity: row.city });
    if (result.score !== row.optimization_score) {
      changed++;
      if ((result.score ?? -1) > (row.optimization_score ?? -1)) up++;
      else down++;
      moves.push({
        company: row.company ?? "?",
        before: row.optimization_score,
        after: result.score,
      });
    }
    writes.push({
      id: row.id,
      score: result.score,
      components: { ...result.components, measured: result.measured },
    });
  });

  console.log("");
  console.log("re-scored " + writes.length + " rows, " + changed + " changed (" + up + " up, " + down + " down)");
  console.log("");
  console.log("biggest movers:");
  for (const m of moves
    .sort((a, b) => Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)))
    .slice(0, 12)) {
    console.log(
      "  " + String(m.before ?? "-").padStart(4) + " -> " + String(m.after ?? "-").padStart(4) +
        "   " + m.company
    );
  }

  if (!WRITE) {
    console.log("");
    console.log("Dry run. Nothing was written. Re-run with --write.");
    return;
  }

  for (const w of writes) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      // ‼️ A NULL SCORE IS WRITTEN WITH ITS COMPONENTS, which is the tri-state's middle state: asked,
      // nothing measurable, stop asking. Same shape `markAuditExhausted` writes.
      .update({ optimization_score: w.score, optimization_components: w.components })
      .eq("id", w.id);
    if (error) throw new Error("update: " + error.message);
  }
  console.log("");
  console.log("written. Nothing was bought: task_get is free and the crawl costs bandwidth.");

  const presences = rows
    .map((r) => {
      const w = writes.find((x) => x.id === r.id);
      return presenceScore(r.score_components, w ? w.components : r.optimization_components).score;
    })
    .filter((v): v is number => v !== null);
  console.log(
    "presence now spans " + Math.min(...presences) + " to " + Math.max(...presences) +
      " across " + presences.length + " rows"
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
