// Live probe: one real business, end to end, through both DataForSEO endpoints.
//
//   bunx tsx --env-file=.env.local scripts/_probe-gbp-live.ts "Skin Bar MedSpa Charlotte"
//
// ‼️ THIS ONE SPENDS MONEY. One SERP at depth 20 ($0.0012) plus one my_business_info lookup
// ($0.0015), so $0.0027 per run. `_probe-gbp-audit.ts` is the offline proof of the weights and the
// denominator; this exists for the half that cannot be proved offline: WHAT THE LIVE RESPONSE
// ACTUALLY LOOKS LIKE. The last three bugs in this lane were all invisible to the offline probes
// and were found by a live call: task_post answering 20100, google_reviews carrying the rating in a
// separate block, and an unverified account killing a batch.
//
// It PRINTS THE RESOLVED cid AND THE PROFILE IT MATCHED, so the lookup can be eyeballed. Matching a
// profile by name would silently score somebody else's business and nothing would error, so seeing
// the matched title and address next to the business asked for is the only real check there is.

import {
  getGbpInfoTask,
  getTask,
  isConfigured,
  postGbpInfoTasks,
  postTasks,
} from "../src/lib/scraper/dataforseo";
import {
  buildProfileKeyword,
  extractFirstH1,
  extractGbpSerpFacts,
  OPTIMIZATION_KEY_ORDER,
  readAdditionalCategories,
  readDescription,
  readPrimaryCategory,
  readProfileUrl,
  readServices,
  readTotalPhotos,
  scoreOptimization,
  type GbpProfile,
  type LandingPageFacts,
} from "../src/lib/scraper/gbp-audit";
import { scoreSerp } from "../src/lib/scraper/score";
import { researchWebsite, SiteFetchError } from "../src/lib/audit-engine/site-research";

const COMPANY = process.argv[2] || "Skin Bar MedSpa Charlotte";
const CITY = process.argv[3] || "Charlotte, NC";

/**
 * Reuse a SERP task already bought instead of buying another.
 *
 *   --serp-task 08282311-2400-0066-0000-4e88e0946e07
 *
 * task_get is free and a result stays fetchable for 30 days, so re-running this against a stored id
 * costs nothing. Without it, every re-run of a diagnostic buys a SERP it already has.
 */
const REUSE_SERP = (() => {
  const i = process.argv.indexOf("--serp-task");
  return i > -1 ? process.argv[i + 1] ?? null : null;
})();

/** Same, for a profile task already bought. */
const REUSE_GBP = (() => {
  const i = process.argv.indexOf("--gbp-task");
  return i > -1 ? process.argv[i + 1] ?? null : null;
})();

const POLL_EVERY_MS = 20_000;
const GIVE_UP_AFTER_MS = 8 * 60_000;

function line(title: string): void {
  console.log("\n" + "=".repeat(78) + "\n" + title + "\n" + "=".repeat(78));
}

async function pollFor<T>(
  what: string,
  once: () => Promise<{ state: "ready" | "pending" | "failed"; error: string | null; value: T | null }>
): Promise<T | null> {
  const until = Date.now() + GIVE_UP_AFTER_MS;
  for (;;) {
    const res = await once();
    if (res.state === "ready") return res.value;
    if (res.state === "failed") {
      console.log("  " + what + " FAILED: " + res.error);
      return null;
    }
    if (Date.now() > until) {
      console.log("  " + what + " still queued after 8 minutes. task_get is free for 30 days.");
      return null;
    }
    console.log("  " + what + " still queued, asking again in 20s" + (res.error ? " (" + res.error + ")" : ""));
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
  }
}

async function main(): Promise<void> {
  if (!isConfigured()) {
    console.log("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. Nothing to do, nothing spent.");
    process.exit(1);
  }

  line("1. SERP, the call the dominance score already pays for");
  console.log("  query: " + COMPANY + " " + CITY);

  let serpTaskId: string | null = REUSE_SERP;
  if (serpTaskId) {
    console.log("  reusing task " + serpTaskId + ", which is free to collect. Nothing spent here.");
  } else {
    const serpPosted = await postTasks([
      { tag: "live-probe", keyword: COMPANY + " " + CITY, locationName: null },
    ]);
    console.log("  task_post ->", JSON.stringify(serpPosted[0]));
    serpTaskId = serpPosted[0].taskId;
  }
  if (!serpTaskId) {
    console.log("  no task id came back, so nothing can be collected. Stopping.");
    process.exit(1);
  }

  const serpPayload = await pollFor("SERP", async () => {
    const r = await getTask(serpTaskId as string);
    return { state: r.state, error: r.error, value: r.payload };
  });
  if (!serpPayload) process.exit(1);

  const dominance = scoreSerp(serpPayload, { company: COMPANY, website: null });
  console.log("  dominance_score: " + dominance.score + " (" + dominance.measured + ")");

  line("2. The THREE FREE components, read off that same SERP");
  const facts = extractGbpSerpFacts(serpPayload, { company: COMPANY, city: CITY });
  console.log(JSON.stringify(facts, null, 2));
  console.log(
    "\n  block types on this SERP: " +
      [...new Set((serpPayload.items ?? []).map((i) => i.type ?? "?"))].join(", ")
  );

  const keyword = buildProfileKeyword(facts);
  if (!keyword) {
    console.log("\n  ‼️ NO cid AND NO place_id ON THIS SERP, so NO PROFILE TASK IS POSTED and");
    console.log("     nothing is spent on the second call. The three profile components stay");
    console.log("     unmeasured. This is the correct behaviour, not a failure: looking the");
    console.log("     business up by name would match a different one and never say so.");
    process.exit(0);
  }

  line("3. my_business_info, looked up BY cid and never by name");
  console.log("  keyword: " + keyword);

  let gbpTaskId: string | null = REUSE_GBP;
  if (gbpTaskId) {
    console.log("  reusing task " + gbpTaskId + ", free to collect. Nothing spent here.");
  } else {
    const gbpPosted = await postGbpInfoTasks([{ tag: "live-probe", keyword }]);
    console.log("  task_post ->", JSON.stringify(gbpPosted[0]));
    gbpTaskId = gbpPosted[0].taskId;
  }
  if (!gbpTaskId) {
    console.log("  no task id came back. Stopping.");
    process.exit(1);
  }

  const profile = await pollFor<GbpProfile>("profile", async () => {
    const r = await getGbpInfoTask(gbpTaskId as string);
    return { state: r.state, error: r.error, value: r.payload };
  });

  line("4. THE PROFILE IT MATCHED. Eyeball this against the business asked for.");
  if (!profile) {
    console.log("  no profile came back.");
  } else {
    console.log("  asked for : " + COMPANY + "  |  " + CITY);
    console.log("  cid       : " + facts.cid);
    console.log("  matched   : " + JSON.stringify(profile.title ?? profile.name ?? null));
    console.log("  address   : " + JSON.stringify(profile.address ?? profile.address_info ?? null));
    console.log("  place_id  : " + JSON.stringify(profile.place_id ?? null));
    console.log("  cid back  : " + JSON.stringify(profile.cid ?? null));

    line("5. Do the guessed field names actually exist");
    console.log("  readPrimaryCategory       -> " + JSON.stringify(readPrimaryCategory(profile)));
    console.log("  readAdditionalCategories  -> " + JSON.stringify(readAdditionalCategories(profile)));
    console.log("  readDescription           -> " + JSON.stringify(readDescription(profile)));
    console.log("  readTotalPhotos           -> " + JSON.stringify(readTotalPhotos(profile)));
    console.log("  readServices              -> " + JSON.stringify(readServices(profile)));
    console.log("  readProfileUrl            -> " + JSON.stringify(readProfileUrl(profile)));
    console.log("\n  every top-level key on the profile, so a miss above can be traced:");
    console.log("  " + Object.keys(profile).sort().join(", "));
  }

  line("6. The landing page, crawled from the profile's own url");
  const url = readProfileUrl(profile) ?? facts.url;
  let page: LandingPageFacts | null = null;
  if (!url) {
    console.log("  no url on the profile or the knowledge graph, so the check is unmeasured.");
  } else {
    console.log("  crawling " + url);
    try {
      const research = await researchWebsite(url);
      page = { crawled: true, title: research.title, h1: extractFirstH1(research.homepageHtml) };
      console.log("  title: " + JSON.stringify(page.title));
      console.log("  h1   : " + JSON.stringify(page.h1));
    } catch (e) {
      page = { crawled: false, title: null, h1: null };
      const why = e instanceof SiteFetchError ? e.message : (e as Error).message;
      console.log("  refused the crawl, so the component is UNMEASURED, never failed: " + why);
    }
  }

  line("7. optimization_score");
  const result = scoreOptimization({ serp: facts, profile, page, fallbackCity: CITY });
  console.log("  " + COMPANY + ": " + (result.score ?? "not measured") + "  (" + result.measured + ")");
  console.log("");
  for (const key of OPTIMIZATION_KEY_ORDER) {
    const c = result.components[key];
    const verdict = c.attempted ? c.earned + "/" + c.weight : "-";
    console.log("  " + key.padEnd(24) + verdict.padStart(7) + "   " + c.note);
  }

  line("8. Raw profile JSON, for the field names");
  console.log(JSON.stringify(profile, null, 2).slice(0, 6000));

  console.log("\nSpent about $0.0027 on this run.");
}

main();
