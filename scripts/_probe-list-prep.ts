// Does the list-prep pipeline refuse to spend money before somebody has looked?
//
//   bun run --env-file=.env.local scripts/_probe-list-prep.ts
//
// ‼️ THE CHECK THAT MATTERS IS THE ORDER. Qualification runs BEFORE enrichment, with no skip path,
// and that single reorder is what the whole build is for: roughly half of a raw pull was always
// going to be dropped, and today we pay to enrich it first. Everything else here is detail.
//
// Writes are done inside a transaction that is rolled back, for the reason the page-datasets probe
// gives: only a real insert proves the shape is accepted, and PostgREST returns column errors
// rather than throwing them, so a swallowed one leaves a table silently empty forever.

import { SQL } from "bun";
import { readFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";
import {
  verdictFaults,
  verticalVocabularyFaults,
  DROP_ANSWER,
  groupDrops,
  normalizeReason,
  dropReviewLines,
  QUALIFY_CHUNK,
} from "@/lib/scraper/qualify";
import {
  normalizeDomain,
  normalizeEmail,
  domainOfEmail,
  suppressionLines,
  checkSuppression,
} from "@/lib/outreach/suppression";
import { configuredProviders, estimateCost, enrichLines, summarize, permutations, PROVIDERS } from "@/lib/scraper/enrich";
import { funnelLines, extractInstagram, fromOutscraper, storeRawLeads } from "@/lib/scraper/pull";
import {
  DEFAULT_VERTICAL,
  DENTIST_ICP,
  ICP_BY_VERTICAL,
  MED_SPA_ICP,
  icpFor,
  knownVerticals,
  resolveVertical,
} from "@/lib/scraper/icp";
import {
  campaignFor,
  categoriesFor,
  judgedVerticalsFor,
  tierOf,
  verticalDef,
  verticalSlugs,
} from "@/lib/scraper/verticals";
import { freeVerdict, isAggregatorDomain, reviewBand, routeForTier } from "@/lib/scraper/tiering";

type Row = Record<string, unknown>;
interface TxSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  begin<T>(fn: (tx: TxSQL) => Promise<T>): Promise<T>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
const normalize = (s: string) => s.replace(/\r\n/g, "\n");

/**
 * Assert that a statement is REFUSED, without poisoning the transaction.
 *
 * ‼️ A SAVEPOINT PER EXPECTED FAILURE, AND WITHOUT ONE THESE CHECKS PASS FOR THE WRONG REASON.
 * Postgres aborts a whole transaction on the first error: every statement after it throws
 * "current transaction is aborted", so a second `try { ... } catch { refused = true }` reports a
 * constraint working when what it actually caught was the previous failure. The savepoint restores
 * the transaction, and the second assertion below rejects that specific message so the trap cannot
 * come back.
 */
async function refuses(tx: TxSQL, label: string, fn: () => Promise<unknown>): Promise<void> {
  await tx.unsafe("savepoint probe_sp");
  let refused = false;
  let why = "";
  try {
    await fn();
  } catch (e) {
    refused = true;
    why = (e as Error).message;
  }
  await tx.unsafe("rollback to savepoint probe_sp");
  check(label, refused, "it was accepted");
  if (refused && /current transaction is aborted/i.test(why)) {
    check(`${label}: refused for the right reason`, false, why);
  }
}

// ── 0. The Maps door travels the listprep road under its OWN workflow name ──────────────────────
// ‼️ THREE BRANCHES TESTED `workflow === "listprep"` AND A MAPS PULL IS NOT THAT. A batch created by
// the 4 door keeps workflow "mapspull" for its whole life, because that name is how mapsPullHistory
// finds it; but from `qualifying` onward it owns a list_pipeline_run and no scraper_rows, exactly
// like a dropped CSV. Measured on the first 500-lead Dallas pull, 2026-09-28:
//
//   advanceBatch's `verifying` arm  -> pollVerification (the scraper_rows path) -> THREW
//     "batch is verifying with no mv_file_id", and the run died with 64 addresses already found.
//   reportStatus                    -> printed rows 0, clean 0, junk 0 for a live 500-lead run.
//
// Both went unseen because no Maps pull had ever reached the MillionVerifier stage: the only earlier
// one sat unreleased on its drop-review card for 26 hours. Grepped rather than executed, the same way
// _probe-scraper.ts pins the dispatch the compiler cannot check.
{
  const lane = readFileSync("src/lib/scraper/lane.ts", "utf8");
  // Whitespace flattened, so a check can span a line break without a regex carrying a real newline.
  const flat = lane.replace(/\s+/g, " ");

  // ‼️ ANCHORED TO THE POLLER CALL, NOT JUST THE CONDITION TEXT. reportStatus carries the same
  // condition, so the first version of this check matched THAT and stayed green when only the
  // verifying arm was reverted. Caught by reverting each fix one at a time and requiring each to be
  // caught: a check that cannot fail is not a check.
  check("the verifying arm routes a mapspull batch to the listprep poller",
    /listprep" \|\| batch\.workflow === "mapspull"\) \{ await pollListPrepVerification/.test(flat));
  check("and no branch sends it to the scraper_rows poller by testing listprep alone",
    !/if \(batch\.workflow === "listprep"\) \{/.test(lane));
  check("reportStatus reads the funnel for a mapspull batch too",
    /\(batch\.workflow === "listprep" \|\| batch\.workflow === "mapspull"\) && batch\.list_run_id/.test(lane));

  // ‼️ AND THE CARD MUST STORE ITS ts, OR THE CHECK MARK RESOLVES TO NOTHING. batchByGateTs matches a
  // reaction's ts against the gate columns; a card whose ts was never written is unreactable, and the
  // ✅ is read, matched against nothing, and silently ignored. It looks like a card waiting for a
  // human who has already clicked it.
  check("the MillionVerifier card stores its ts as the mv_approval gate",
    /mv_approval_ts: mvTs/.test(lane));
}

async function main() {
  // ── 1. The schema the code names by hand ──────────────────────────────────
  console.log("\n1. the tables, and every column the code names");

  const COLUMNS: Record<string, string[]> = {
    raw_leads: [
      "run_id", "source", "source_query", "source_metro", "place_id", "business_name", "domain",
      "website", "phone", "phone_normalized", "vertical_slug", "business_type", "avatar_slug",
      "found_in_sources", "qualify_keep", "qualify_reason", "qualify_model", "qualified_at",
      "enriched_at", "enrich_attempts",
    ],
    list_pipeline_runs: [
      "batch_id", "label", "source", "source_queries", "icp_text", "stage", "raw_count",
      "qualified_count", "enriched_count", "verified_count", "sendable_count", "provider_spend",
      "cost_usd", "spend_approved_at", "drop_review_ts",
      // Were missing from this map while the code already named them, so nothing checked them.
      "spend_approved_by", "slack_channel_id", "slack_thread_ts", "vertical_slug",
      // The Maps door: the poll's terminal marker, the request id, and the spend gate.
      "pull_request_id", "pull_finished_at", "pull_approval_ts",
    ],
    sendable_leads: [
      "run_id", "raw_lead_id", "email", "first_name", "last_name", "title", "provider",
      "provider_cost_usd", "attempts", "email_status", "catchall_rechecked_at", "suppressed_reason",
      "suppressed_at", "sent_at",
    ],
    // ‼️ THE ATTRIBUTION COLUMN, AND THE ONLY THING IN THIS BUILD THAT CANNOT BE BACKFILLED. A run
    // mailed without it can never be traced to the list that produced it.
    outreach_prospects: ["run_id", "email", "website", "source", "campaign", "confirmed"],
  };

  for (const [table, cols] of Object.entries(COLUMNS)) {
    const { error } = await supabaseAdmin.from(table).select(cols.join(", ")).limit(1);
    check(
      `${table}: ${cols.length} columns readable`,
      !error,
      error ? `${error.message}. docs/2026-09-17-list-prep-pipeline.sql has not been run.` : ""
    );
  }


  // ── 2. The stage machine, and the order that is the whole point ───────────
  console.log("\n2. the stages, and that qualifying comes before enriching");

  const sql = new SQL(process.env.DATABASE_URL!) as unknown as TxSQL;
  // ── 1b. raw_leads can actually be WRITTEN, which is not what the column check proves ──────
  // ‼️ THIS WHOLE BLOCK EXISTS BECAUSE THE SCHEMA CHECKS ABOVE PASSED WHILE EVERY INSERT FAILED.
  // raw_leads_run_place was a PARTIAL unique index (where place_id is not null), and Postgres will
  // not use a partial index for ON CONFLICT unless the statement repeats the predicate, which
  // PostgREST's on_conflict parameter cannot express. So storeRawLeads returned "no unique or
  // exclusion constraint matching the ON CONFLICT specification" on every call and inserted nothing,
  // for BOTH the CSV arm and the Maps webhook. Reading the columns back could never have caught it.
  {
    const [idx] = await sql`select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'raw_leads' and indexname = 'raw_leads_run_place'`;
    const def = String(idx?.indexdef ?? "");
    check("the idempotency index exists", def.length > 0);
    check(
      "and is NOT partial, or ON CONFLICT cannot target it",
      def.length > 0 && !/where/i.test(def),
      def
    );

    // The behavioural half: go through storeRawLeads itself, the way both arms do.
    const { data: made } = await supabaseAdmin
      .from("list_pipeline_runs")
      .insert({ label: "_probe write path", source: "outscraper", icp_text: "probe", stage: "pulling", vertical_slug: "medspa" })
      .select("id")
      .single();
    const probeRunId = (made as { id: string } | null)?.id ?? null;
    check("a probe run could be opened", Boolean(probeRunId));
    if (probeRunId) {
      const one = fromOutscraper(
        { name: "Probe Write Path Spa", site: "https://probewritepath.example", place_id: "probe_write_1" },
        { runId: probeRunId, sourceQuery: "probe", sourceMetro: "Nowhere", verticalSlug: "medspa" }
      );
      check("fromOutscraper maps a record", Boolean(one));
      if (one) {
        const first = await storeRawLeads([one]);
        check("storeRawLeads INSERTS, rather than erroring on ON CONFLICT", first.inserted === 1, JSON.stringify(first));
        const again = await storeRawLeads([one]);
        check("and the same place twice is skipped, not duplicated", again.inserted === 0, JSON.stringify(again));

        // A record with no place_id must still be idempotent, or a re-driven pull duplicates it.
        const placeless = fromOutscraper(
          { name: "Probe Placeless Spa", site: "https://probeplaceless.example" },
          { runId: probeRunId, sourceQuery: "probe", sourceMetro: "Nowhere", verticalSlug: "medspa" }
        );
        check("a placeless record gets a synthetic id", Boolean(placeless?.placeId), String(placeless?.placeId));
        if (placeless) {
          await storeRawLeads([placeless]);
          const twice = await storeRawLeads([placeless]);
          check("so a re-driven pull does not duplicate it", twice.inserted === 0, JSON.stringify(twice));
        }
      }
      await supabaseAdmin.from("raw_leads").delete().eq("run_id", probeRunId);
      await supabaseAdmin.from("list_pipeline_runs").delete().eq("id", probeRunId);
      const { count } = await supabaseAdmin
        .from("raw_leads")
        .select("id", { count: "exact", head: true })
        .eq("run_id", probeRunId);
      check("the probe cleaned up after itself", (count ?? 0) === 0);
    }
  }
  const [cons] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'scraper_batches_status_check'`;
  const def = String(cons?.def ?? "");
  for (const stage of [
    "pulling", "qualifying", "qualified", "enriching", "catchall_recheck", "suppressing",
    // The 4️⃣ door's spend gate. Postgres refuses the status until the constraint is widened, which
    // is the trap that has already cost this lane one session.
    "awaiting_pull_approval",
  ]) {
    check(`${stage} is a legal stage`, def.includes(`'${stage}'`));
  }

  const [wfCons] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'scraper_batches_workflow_check'`;
  const wfDef = String(wfCons?.def ?? "");
  for (const arm of ["filter", "score", "listprep", "mapspull"]) {
    check(`${arm} is a legal workflow`, wfDef.includes(`'${arm}'`), "widened, never narrowed");
  }
  for (const old of ["awaiting_workflow", "parsing", "mx", "filtered", "verifying", "done", "error", "scoring", "scored"]) {
    check(`${old} still legal, widened not narrowed`, def.includes(`'${old}'`), "an in-flight batch would fail its own check");
  }
  check(
    "qualifying is listed before enriching",
    def.indexOf("'qualifying'") < def.indexOf("'enriching'"),
    "the order in the constraint is documentation, and it should read as the pipeline runs"
  );

  const runsDef = await sql`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.list_pipeline_runs'::regclass and contype = 'c'`;
  const stages = runsDef.map((r) => String(r.def)).join(" ");
  check("a run cannot reach enriching without a qualified stage existing", stages.includes("'qualified'"));

  // ── 3. Nothing spends before a person looks ───────────────────────────────
  console.log("\n3. the spend gate");

  const qsrc = normalize(readFileSync("src/lib/scraper/qualify.ts", "utf8"));
  const esrc = normalize(readFileSync("src/lib/scraper/enrich.ts", "utf8"));
  check("there is no skip path in qualify", /THERE IS NO SKIP PATH/.test(qsrc));
  check("enrich says it runs on the kept file only", /KEPT FILE ONLY/.test(esrc));
  check("the drop review asks for a reaction before the spend", /React :white_check_mark: to release/.test(qsrc));
  check("the run carries the ICP it judged against", /icp_text/.test(readFileSync("src/lib/scraper/pull.ts", "utf8")));

  const est = estimateCost(1000);
  check("a spend estimate exists before the gate", typeof est.usd === "number");

  // ‼️ THESE THREE CHECKS ASSERTED THE UN-WIRED STATE AND HAD TO CHANGE WHEN IT WAS WIRED. Worth
  // noting that the old "PROVIDERS is empty and honest about it" was
  // `PROVIDERS.length === 0 || configuredProviders().live.length >= 0`, whose right half is
  // vacuously true, so it would have gone on passing whatever landed in the array. Replaced with
  // assertions that can actually fail.
  const live = configuredProviders().live;
  const dark = configuredProviders().dark;
  check("the waterfall has at least one live rung", live.length > 0, `live=${live.length}`);
  check(
    "every free rung is live and none of them is dark",
    PROVIDERS.filter((p) => p.gate.kind === "free").every((p) => live.includes(p)) &&
      dark.every((p) => p.gate.kind === "env"),
    `dark=${dark.map((p) => p.key).join(",")}`
  );
  check(
    "a free waterfall estimates zero even with rungs live",
    est.live > 0 && est.usd === 0,
    `live=${est.live} usd=${est.usd}`
  );

  // ‼️ THE ROLE-ADDRESS RULE IS A PROPERTY OF THE SOURCE, AND IT IS THE HIGHEST-SEVERITY SILENT
  // BUG AVAILABLE HERE. `pickBestEmail` ranks a same-domain role address FIRST, so a crawl rung
  // that treated one as a miss would report "0 found, N role address" on a list it actually
  // solved, and the obvious reading is that the crawler is broken.
  check(
    "the site-crawl rung accepts a role address",
    PROVIDERS.find((p) => p.key === "site-scrape")?.acceptsRole === true
  );
  // The gate is still there and still defaults to rejecting: `acceptsRole` is opt-in, so a paid
  // database added later inherits the strict behaviour without anybody remembering to ask for it.
  check(
    "a rung must opt in; the role gate still guards the ones that have not",
    /ROLE_PATTERN\.test\(hit\.email\) && !p\.acceptsRole/.test(esrc),
    "enrichOne no longer gates role addresses at all"
  );

  const providerLines = enrichLines(summarize([]));
  check(
    "a configured waterfall reports coverage rather than claiming nothing is configured",
    !providerLines.some((l) => /No enrichment provider is configured/.test(l)),
    providerLines.join(" ")
  );
  check(
    "no rung is ever reported dark for want of a key it does not have",
    !providerLines.some((l) => /undefined/.test(l)),
    providerLines.join(" ")
  );


  // ── 3b. The free pre-filter, which is where the MillionVerifier money actually is ──────────
  // MV bills per address UPLOADED, so rejecting junk for $0 first is the saving. These checks exist
  // because the filter has two ways to be silently worthless.
  {
    const lsrc = normalize(readFileSync("src/lib/scraper/lane.ts", "utf8"));
    const lpsrc2 = normalize(readFileSync("src/lib/scraper/listprep.ts", "utf8"));

    check("a free pre-filter runs in the lane", /async function freeRejects\(/.test(lsrc));
    check(
      "it runs BEFORE the upload, not after",
      lsrc.indexOf("await freeRejects(") < lsrc.indexOf("await uploadEmails("),
      "freeRejects must precede uploadEmails"
    );
    check("and its verdicts are written down", /await applyFreeRejects\(runId, rejects\)/.test(lsrc));

    // ‼️ WITHOUT THE WRITE THE FILTER SAVES NOTHING. unverifiedEmails selects on
    // `verified_at is null`, so an unwritten reject is re-read next tick and uploaded then.
    check(
      "the worklist reader is still the thing the write has to satisfy",
      /is\("verified_at", null\)/.test(lpsrc2)
    );
    check("so a reject stamps verified_at", /email_status: "invalid", verified_at: now/.test(lpsrc2));

    // ‼️ A DUPLICATE IS NOT AN INVALID ADDRESS. Writing invalid there puts a working address into
    // held-back.csv labelled undeliverable.
    check(
      "a duplicate is suppressed, not marked invalid",
      /suppressed_reason: "duplicate_in_run", suppressed_at: now, verified_at: now/.test(lpsrc2)
    );

    // ‼️ AN UNDETERMINED MX VERDICT MUST BE UPLOADED, NOT DROPPED. After this filter a false
    // no-MX does not mislabel a row, it drops a deliverable address.
    check(
      "only a definite no-MX is rejected",
      /verdicts\.get\(k\.domain\) === false/.test(lsrc),
      "an undetermined MX verdict must not reject"
    );
    check("the card reports counts, not rates", /rejected for free/.test(lsrc));
  }


  // ── 3c. MX routing, and the two rungs it decides between ───────────────────────────────────
  {
    const msrc = normalize(readFileSync("src/lib/scraper/mx.ts", "utf8"));

    // ‼️ THE CACHE KIND MUST BE VERSIONED. Old entries under `dns.mx` are bare booleans; reading one
    // back as an object yields undefined, so every cached domain would answer "no MX" for 14 days,
    // and after the free pre-filter a false no-MX DROPS the address rather than mislabelling it.
    check("the exchanges cache uses a new kind, not the boolean one", /kind: "dns\.mx\.v2"/.test(msrc));
    check("nothing still writes the old boolean kind", !/kind: "dns\.mx"/.test(msrc));
    check("hasMx is derived from the records, not stored twice", /const records = await mxRecords\(domain\)/.test(msrc));
    check("the one classifier in the repo is reused", /import \{ detectMailProvider \}/.test(msrc));

    const e2 = normalize(readFileSync("src/lib/scraper/enrich.ts", "utf8"));
    check("routing is asked before the call, not inside it", /const fit = p\.appliesTo\?\.\(target\)/.test(e2));
    check(
      "and the role gate it sits next to is untouched",
      /ROLE_PATTERN\.test\(hit\.email\) && !p\.acceptsRole/.test(e2)
    );

    const lpsrcPerm = normalize(readFileSync("src/lib/scraper/listprep.ts", "utf8"));
    // ‼️ SIX CANDIDATE ROWS PER COMPANY UNTIL A VERIFIER RULES. Without the resolver a guessed lead
    // would be counted six times in the funnel and mailed six times.
    check("runners-up are written as their own rows", /for \(const alt of args\.hit\.alternates/.test(lpsrcPerm));
    check("and a resolver exists to cut them back to one", /export async function resolvePermutations/.test(lpsrcPerm));
    check("which suppresses rather than deletes", /suppressed_reason: "lost_permutation"/.test(lpsrcPerm));
    check(
      "the resolver runs after verification, not before",
      (() => {
        const lane = normalize(readFileSync("src/lib/scraper/lane.ts", "utf8"));
        return lane.indexOf("await applyVerification(") < lane.indexOf("await resolvePermutations(");
      })()
    );
    check("six patterns are offered", permutations("Marina Musalyants", "clinic.com").length === 6);

    // ‼️ A GUESS MUST BE PROVEN, AND CATCH-ALL IS NOT PROOF. catch_all says the SERVER accepts every
    // address; it says nothing about the mailbox. For an address the crawl found that is fine, the
    // page published it. For one the permutation rung invented it is the whole question, and sending
    // it is mailing a mailbox nobody has evidence exists. The bounce is charged to the sending
    // domain, not to the guess.
    check("the send list knows which rungs guess", /GUESSING_PROVIDERS/.test(lpsrcPerm));
    check("and requires a guessed address to be valid, not merely catch_all",
      /GUESSING_PROVIDERS\.has[\s\S]{0,120}=== "valid"/.test(lpsrcPerm));
    check("while a found address may still be catch_all",
      /in\("email_status", \["valid", "catch_all"\]\)/.test(lpsrcPerm));
    check("and the paid rung inherits the same rule when it gets a key",
      /GUESSING_PROVIDERS = new Set\(\["permute-guess", "domain-people"\]\)/.test(lpsrcPerm));

    const guess = PROVIDERS.find((p) => p.key === "permute-guess");
    const paid = PROVIDERS.find((p) => p.key === "domain-people");
    check("a guessing rung exists and is free", guess?.gate.kind === "free");
    check("a guess is never allowed to be a role address", guess?.acceptsRole !== true);
    check("the paid rung is gated on a key", paid?.gate.kind === "env");
    check("and inherits the strict role default", paid?.acceptsRole !== true);
    check("the paid rung is dark, so no vendor was signed", configuredProviders().dark.some((p) => p.key === "domain-people"));

    const target = {
      id: "x", businessName: "A Clinic", domain: "clinic.com",
      ownerName: "Marina Musalyants", city: null, state: null,
    };
    // The measured reason for the whole split: Workspace is catch-all half the time, and
    // sendableRows admits catch_all, so a wrong guess there SHIPS.
    check(
      "a guess is refused on Google Workspace",
      guess?.appliesTo?.({ ...target, mailProvider: "Google Workspace" }).ok === false
    );
    check(
      "and allowed on Microsoft 365, where 93% of answers are decisive",
      guess?.appliesTo?.({ ...target, mailProvider: "Microsoft 365" }).ok === true
    );
    check("a guess needs a name", guess?.appliesTo?.({ ...target, ownerName: null }).ok === false);
    check(
      "the paid rung is the mirror image: only where a guess cannot be disproved",
      paid?.appliesTo?.({ ...target, mailProvider: "Microsoft 365" }).ok === false &&
        paid?.appliesTo?.({ ...target, mailProvider: "Google Workspace" }).ok === true
    );

    // One candidate, not three. Three would upload three addresses per lead to buy one answer.
    const hit = await guess?.find({ ...target, mailProvider: "Microsoft 365" });
    check("the guess is one address built from the first name", hit?.email === "marina@clinic.com", String(hit?.email));
  }

  // ── 4. Verdicts ───────────────────────────────────────────────────────────
  // ── 4. The vertical, decided once and carried ─────────────────────────────
  console.log("\n4. the vertical, resolved from the caption and carried on the run");

  check("the med spa profile is registered", icpFor("medspa") === MED_SPA_ICP);
  check("the dentist profile is registered", icpFor("dentist") === DENTIST_ICP);

  // ‼️ THE CHECK THAT WOULD HAVE CAUGHT THE OLD BEHAVIOUR. icpFor used to return MED_SPA_ICP for
  // any unknown key, so a typo in a caption alias silently judged the list against the wrong buyer
  // and the drop reasons read like a bad list. Four separate `?? "medspa"` defaults have shipped in
  // this codebase; this is the assertion that stops a fifth landing here.
  check("an unknown vertical has no profile rather than the med spa one", icpFor("plumber") === null);
  check("a blank vertical has no profile", icpFor(null) === null && icpFor("") === null);

  check("a caption naming dentists resolves to dentist", resolveVertical("Dallas dentists batch 3").slug === "dentist");
  check("a caption naming med spas resolves to medspa", resolveVertical("Phoenix med spa pull").slug === "medspa");
  check("case and punctuation do not matter", resolveVertical("  MED-SPA / Tampa ").slug === "medspa");

  // The longest alias wins, so a two word alias cannot be beaten by a one word alias that happens
  // to appear later in the object. Insertion order is not a contract anybody should have to hold.
  check("the longest alias wins", resolveVertical("cosmetic dentistry, Austin").slug === "dentist");

  // An unmatched caption still yields a vertical so a drop never dead ends, but `matched` has to
  // come back false or the card cannot warn and the default becomes invisible.
  const unnamed = resolveVertical("Dallas batch 3");
  check("an unnamed caption falls back to the default", unnamed.slug === DEFAULT_VERTICAL);
  check("and says it did not match", unnamed.matched === false);
  check("a named caption says it matched", resolveVertical("dentist list").matched === true);
  check("a missing caption does not throw", resolveVertical(null).slug === DEFAULT_VERTICAL);

  check(
    "every registered vertical is reachable from some caption alias",
    knownVerticals().every((v) => ICP_BY_VERTICAL[v] !== undefined),
    knownVerticals().join(",")
  );

  // The run has to carry it, or sweepPull re-derives it a tick later from an editable alias table.
  const listprepSrc = readFileSync("src/lib/scraper/listprep.ts", "utf8");
  check("the run row carries the vertical", /vertical_slug/.test(listprepSrc));
  check(
    "and RUN_COLUMNS asks for it, or it reads as undefined on every row",
    /RUN_COLUMNS[\s\S]{0,400}vertical_slug/.test(listprepSrc)
  );

  console.log("\n4b. a vendor 500 parks the pull instead of killing it");

  // ‼️ THESE ARE STRUCTURAL CHECKS OVER THE SOURCE, AND THAT IS THE ONLY WAY TO TEST THIS ONE
  // WITHOUT A VENDOR OUTAGE. The bug was not a wrong value, it was a STATUS: fail() writes
  // status 'error', 'error' is not in ACTIVE_STATUSES, and the cron therefore never looks at the
  // batch again. Measured on batch 7a472c40-0ef8-40ce-ac57-88950642a8df: one HTTP 500, cost_usd 0,
  // raw_count 0, and an approved pull of a whole metro gone. A unit test over a pure function
  // cannot see that; a grep for the shape can.
  const laneSrc = readFileSync("src/lib/scraper/lane.ts", "utf8");
  const storeSrc = readFileSync("src/lib/scraper/store.ts", "utf8");

  check(
    "a vendor error routes to parkOrRefusePull rather than straight to fail()",
    /if \(pageError\) \{[\s\S]{0,200}parkOrRefusePull/.test(laneSrc)
  );
  check(
    "and the park path puts the batch back in `pulling`",
    /parkOrRefusePull[\s\S]{0,2600}updateBatch\(batch\.id, \{ status: "pulling" \}\)/.test(laneSrc)
  );
  // ‼️ THE CHECK THAT ACTUALLY MATTERS: `pulling` HAS TO BE A STATUS THE CRON LOOKS AT. If
  // somebody later removes it from ACTIVE_STATUSES the retry silently becomes unreachable again, and
  // every other check in this section would still pass.
  //
  // ‼️ AND THE COMMENTS ARE STRIPPED BEFORE THE ARRAY IS READ, BECAUSE THE FIRST VERSION OF THIS
  // CHECK WAS DECORATION. ACTIVE_STATUSES has a four line comment INSIDE it that mentions the
  // statuses by name, so a plain search for the quoted string matched `// "pulling",` just as
  // happily as `"pulling",`. Commenting the entry out is the likeliest way somebody disables it, so
  // that was the one mutation the check could not see. Proved by mutating the source and asserting
  // the regex goes false.
  const activeStatuses = (() => {
    const body = storeSrc.match(/const ACTIVE_STATUSES: BatchStatus\[\] = \[([\s\S]*?)\];/)?.[1] ?? "";
    return body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("//"))
      .join(" ");
  })();
  check(
    "ACTIVE_STATUSES was found at all, or the check below is vacuous",
    activeStatuses.length > 0
  );
  check(
    "`pulling` is in ACTIVE_STATUSES, or parking is the same bug in a new coat",
    /"pulling"/.test(activeStatuses),
    activeStatuses
  );
  check(
    "the attempt counter is raised BEFORE the vendor is called",
    // The window is 3000 rather than a few hundred because the comment between the two is long.
    // Deliberately only a little wider than the 2446 characters measured today: a window wide
    // enough to span the whole function would match whatever the order was.
    /pull_attempts: attempt[\s\S]{0,3000}searchListings\(\{/.test(laneSrc)
  );
  check(
    "there is a terminal refusal, and it names the attempts used",
    /function pullRefusalLine[\s\S]{0,600}attempts \+ " attempt"/.test(laneSrc)
  );
  check(
    "the cap is checked before the count is raised, so a capped run cannot be re-driven",
    /if \(attempt > PULL_MAX_ATTEMPTS\)[\s\S]{0,200}pullRefusalLine/.test(laneSrc)
  );
  check(
    "the park path does NOT write run.error, which sweepPullMaps would fail on",
    !/await updateRun\(runId, \{ cost_usd: spent, error:/.test(laneSrc)
  );
  check(
    "the cron re-drives a DataForSEO pull only when an approval is already on file",
    /if \(!run\.spend_approved_at\) return false;[\s\S]{0,300}pullFromDataForSeo/.test(laneSrc)
  );
  check(
    "and it tells the two vendor doors apart by NAME, not by a null column",
    /reparsed\.command\.source === "dataforseo"/.test(laneSrc)
  );
  check(
    "a retried pull adds its cost rather than overwriting it",
    /cost_usd: Number\(before\?\.cost_usd \?\? 0\) \+ found\.costUsd/.test(laneSrc)
  );
  check(
    "the circle's own size is stored, so `remaining` is a measurement",
    /metro_total_count: Math\.max\(found\.totalCount/.test(laneSrc)
  );
  check(
    "and RUN_COLUMNS asks for the new columns, or every guard on them reads undefined",
    /RUN_COLUMNS[\s\S]{0,500}pull_attempts/.test(listprepSrc) &&
      /RUN_COLUMNS[\s\S]{0,500}metro_total_count/.test(listprepSrc)
  );

  console.log("\n5. the qualify verdicts");

  const ids = ["a", "b"];
  // The vocabulary the model is given, out of the registry rather than typed here: a probe that
  // asserted against its own hand-written list would pass while the prompt and the mapper disagreed.
  const vocab = judgedVerticalsFor("medspa");
  const faults = (v: unknown) => verdictFaults(v, ids, vocab);

  const good = {
    verdicts: [
      { id: "a", vertical: "med spa", reason: "owner operated med spa" },
      { id: "b", vertical: "drop", reason: "national chain" },
    ],
  };
  check("a good batch passes", faults(good).length === 0, faults(good).join(" "));
  check("a missing verdict is refused", faults({ verdicts: [good.verdicts[0]] }).some((f) => /were not judged/.test(f)));
  check("an invented id is refused", faults({ verdicts: [...good.verdicts, { id: "zz", vertical: "med spa", reason: "x" }] }).some((f) => /not in the batch/.test(f)));
  check("a duplicate verdict is refused", faults({ verdicts: [good.verdicts[0], good.verdicts[0], good.verdicts[1]] }).some((f) => /judged twice/.test(f)));
  check("a missing reason is refused", faults({ verdicts: [{ id: "a", vertical: "med spa", reason: "" }, good.verdicts[1]] }).some((f) => /reason is required/.test(f)));
  check("an em dash in a reason is refused", faults({ verdicts: [{ id: "a", vertical: "med spa", reason: "fine — good" }, good.verdicts[1]] }).some((f) => /em dash/.test(f)));
  check("a missing vertical is refused", faults({ verdicts: [{ id: "a", reason: "x" }, good.verdicts[1]] }).some((f) => /vertical is required/.test(f)));
  check("nothing at all is refused", faults({ verdicts: [] }).length > 0);
  check("the chunk size is sane", QUALIFY_CHUNK >= 5 && QUALIFY_CHUNK <= 50, String(QUALIFY_CHUNK));

  // ‼️ THE CHECK THAT MATTERS MOST, AND IT IS AN EXPENSIVE MISTAKE MADE CHEAP. A vertical the model
  // invented stores fine, tiers as null, and silently leaves the lead out of every Tier A count: no
  // error anywhere and a supply plan built on a wrong number. Refused at the door, callClaudeJSON
  // re-asks the batch instead.
  check(
    "a vertical outside the vocabulary is refused rather than stored untiered",
    faults({ verdicts: [{ id: "a", vertical: "medical aesthetics spa", reason: "x" }, good.verdicts[1]] })
      .some((f) => /not one of the verticals/.test(f))
  );
  check(
    "and the refusal lists what was allowed, so the retry can succeed",
    faults({ verdicts: [{ id: "a", vertical: "nope", reason: "x" }, good.verdicts[1]] })
      .some((f) => /Use exactly one of/.test(f))
  );

  // ‼️ EVERY REGISTERED VERTICAL'S VOCABULARY IS CHECKED, not just medspa's. A band listing the
  // literal word "drop" would turn every business in it into a drop, and one string in two bands
  // would make tierOf depend on array order. Both are silent.
  for (const v of knownVerticals()) {
    const vf = verticalVocabularyFaults(judgedVerticalsFor(v));
    check("`" + v + "` has a usable tier vocabulary", vf.length === 0, vf.join(" "));
    check("`" + v + "` tiers every word it offers the model", judgedVerticalsFor(v).every((w) => tierOf(v, w) !== null));
  }
  check("an unknown answer tiers as null rather than as C", tierOf("medspa", "hairdresser") === null);
  check("the drop sentinel is not a vertical", !judgedVerticalsFor("medspa").includes(DROP_ANSWER));

  // ‼️ THE REGISTRY AND THE ICP TABLE MUST NAME THE SAME VERTICALS. verticals.ts references icp.ts
  // by import, so a vertical added to one and not the other COMPILES: verticalDef answers and
  // icpFor returns null, and startRun then refuses a pull for a vertical the territory page lists.
  check(
    "the registry and the ICP table agree on which verticals exist",
    verticalSlugs().join(",") === knownVerticals().join(","),
    verticalSlugs().join(",") + "  vs  " + knownVerticals().join(",")
  );
  for (const v of verticalSlugs()) {
    check("`" + v + "` references the same ICP text the judge is handed", verticalDef(v)?.icp === icpFor(v));
    check("`" + v + "` has DataForSEO categories, or a pull searches for nothing", categoriesFor(v).length > 0);
    check("`" + v + "` has a campaign name, so a handoff is not labelled with a raw command", Boolean(campaignFor(v)));
    check("`" + v + "` has at least one search string for the plan view", verticalDef(v)!.searchQueries.length > 0);
  }

  console.log("\n5b. the free rules, which decide before the model is paid");

  // ‼️ THE MEASURED TRAP, AS A CHECK. 15 of the 47 same-domain rows on the Dallas 500 were
  // instagram.com (9), vagaro.com (4) and facebook.com (2). A naive "same domain means chain" rule
  // deletes nine unrelated businesses as one franchise, so the aggregator rule has to fire FIRST.
  const insta = freeVerdict({ website: "https://instagram.com/kosmikstudiodallas", domain: "instagram.com", reviewCount: 40, sameDomainCount: 8 });
  check("an Instagram-only row goes to the call list, not the chain bin", insta?.route === "call", JSON.stringify(insta));
  const vagaro = freeVerdict({ website: "http://vagaro.com/nuvoskin", domain: "vagaro.com", reviewCount: 12, sameDomainCount: 3 });
  check("a Vagaro-only row goes to the call list", vagaro?.route === "call", JSON.stringify(vagaro));
  const chain = freeVerdict({ website: "https://usdermatologypartners.com/plano", domain: "usdermatologypartners.com", reviewCount: 200, sameDomainCount: 5 });
  check("a real multi-site domain is dropped as a chain", chain?.route === "drop", JSON.stringify(chain));
  const pair = freeVerdict({ website: "https://twositeclinic.com", domain: "twositeclinic.com", reviewCount: 90, sameDomainCount: 1 });
  check("a two-site local group is left for the model, not dropped", pair === null, JSON.stringify(pair));
  const siteless = freeVerdict({ website: null, domain: null, reviewCount: 3, sameDomainCount: 0 });
  check("no website goes to the call list", siteless?.route === "call", JSON.stringify(siteless));
  const ordinary = freeVerdict({ website: "https://realclinic.com", domain: "realclinic.com", reviewCount: 60, sameDomainCount: 0 });
  check("an ordinary row is left for the model", ordinary === null, JSON.stringify(ordinary));
  check("a real domain is not called an aggregator", !isAggregatorDomain("https://usdermatologypartners.com/plano"));
  check("a subdomain of a real business is not an aggregator", !isAggregatorDomain("https://locations.massageenvy.com/texas"));
  check("a blank website is not called an aggregator either", !isAggregatorDomain(null) && !isAggregatorDomain(""));

  // WW THE BOUNDARIES, NOT THE MIDDLES, BECAUSE AN OFF-BY-ONE HERE IS INVISIBLE. The band is shown
  // to the model beside the raw count, so a wrong edge does not break anything: it quietly describes
  // a 99 review clinic as large and a 100 review one as mid, and the verdicts drift.
  check("no reviews is its own band, not the smallest one", reviewBand(0) === "none" && reviewBand(null) === "none");
  check("1 to 24 is small", reviewBand(1) === "small" && reviewBand(24) === "small");
  check("25 to 99 is mid", reviewBand(25) === "mid" && reviewBand(99) === "mid");
  check("100 to 299 is large", reviewBand(100) === "large" && reviewBand(299) === "large");
  check("300 and over is huge", reviewBand(300) === "huge" && reviewBand(4000) === "huge");
  // WW THE BANDS MUST PARTITION THE MEASURED DISTRIBUTION, or a documented count has nowhere to go.
  // The 48 sendable rows split 0 / 9 / 22 / 13 / 4 across these five bands and they have to sum.
  check(
    "the five bands cover every count with no gap and no overlap",
    [0, 1, 24, 25, 99, 100, 299, 300].every((n) => reviewBand(n).length > 0) &&
      new Set([reviewBand(24), reviewBand(25)]).size === 2 &&
      new Set([reviewBand(99), reviewBand(100)]).size === 2 &&
      new Set([reviewBand(299), reviewBand(300)]).size === 2
  );

  // ‼️ TIER C NEVER ROUTES TO 'drop'. The operator's own standing rule in one assertion: do not
  // throw away leads without an email. A nail bar has a front desk and a phone number.
  check("Tier C is called, never dropped", routeForTier("C", true) === "call");
  check("Tier A and B are emailed", routeForTier("A", true) === "email" && routeForTier("B", true) === "email");
  check("an untiered keep is still emailable", routeForTier(null, true) === "email");
  check("a model drop is dropped whatever the tier", routeForTier("A", false) === "drop");

  // ── 5. Drop reasons group on meaning, not on wording ──────────────────────
  console.log("\n6. the bulk drop review, which is the human checkpoint");

  const drops = [
    { id: "1", keep: false as const, reason: "chain, not owner operated", businessName: "Ideal Image" },
    { id: "2", keep: false as const, reason: "a chain rather than owner operated", businessName: "Milan Laser" },
    { id: "3", keep: false as const, reason: "no website found", businessName: "Some Spa" },
    { id: "4", keep: true as const, reason: "owner operated", businessName: "A Clinic" },
    { id: "5", keep: null, reason: "not judged: timeout", businessName: "B Clinic" },
  ];
  const groups = groupDrops(drops);
  check("two wordings of one reason group together", groups[0]?.count === 2, JSON.stringify(groups.map((g) => g.count)));
  check("a different reason stays its own group", groups.length === 2, String(groups.length));
  check("a kept row is not a drop", !groups.some((g) => /owner operated$/.test(g.reason) && g.count > 2));
  check("an unjudged row is NOT counted as a drop", groups.reduce((n, g) => n + g.count, 0) === 3);
  check("normalizeReason is order insensitive", normalizeReason("chain not owner operated") === normalizeReason("operated owner chain"));
  check("groups are biggest first", groups[0].count >= (groups[1]?.count ?? 0));

  const review = dropReviewLines({ raw: 100, kept: 40, unjudged: 5, groups: [{ reason: "national chain", count: 50, examples: [] }, { reason: "no website", count: 5, examples: [] }] });
  check("the review names the unjudged separately from the drops", review.some((l) => /are not drops/.test(l)));
  check("a dominant drop reason is flagged as an ICP problem", review.some((l) => /the ICP or the/.test(l)));
  check("it asks for the reaction", review.some((l) => /React :white_check_mark:/.test(l)));

  // ── 6. Suppression ────────────────────────────────────────────────────────
  console.log("\n7. suppression, by domain as well as by email");

  check("www is stripped", normalizeDomain("https://www.Clinic.com/about?x=1") === "clinic.com");
  check("a co.uk is kept whole", normalizeDomain("clinic.co.uk") === "clinic.co.uk");
  check("a bare word is not a domain", normalizeDomain("clinic") === null);
  check("an email yields its domain", domainOfEmail("Matthew@Clinic.com") === "clinic.com");
  check("a non-email is not an email", normalizeEmail("matthew") === null);
  check("an email is lowercased", normalizeEmail(" Matthew@Clinic.com ") === "matthew@clinic.com");

  const ssrc = normalize(readFileSync("src/lib/outreach/suppression.ts", "utf8"));
  check("it checks contacts.do_not_contact", /do_not_contact/.test(ssrc));
  check("it checks clients", /from\("clients"\)/.test(ssrc));
  check("it checks outreach_prospects", /outreach_prospects/.test(ssrc));
  check("it matches on website as well as email", /website\.ilike/.test(ssrc));
  check("it lives outside scraper/, so the sequencer can use it", ssrc.length > 0);

  const lines = suppressionLines({ checked: 100, suppressed: 12, byReason: { opted_out: 2, domain_contacted: 10 } });
  check("the summary reports counts, not rates", lines[0].includes("88 of 100"));
  check("an opt-out is named before a stale touch", lines.findIndex((l) => /not to be contacted/.test(l)) < lines.findIndex((l) => /mailed before/.test(l)));

  // ‼️ THE BRANCH THAT USED TO BE BACKWARDS. It read `state.includes("CLOSED")` and reported it as
  // "an open conversation (CLOSED)", so the one state that is definitively not open was the only
  // one it caught, and the four that ARE open fell through. The row was still suppressed, which is
  // why nothing looked broken; but the card read as nonsense, and deleting the branch to tidy that
  // up would have un-suppressed every opt-out that reached us by email.
  // ‼️ ASSERTED AS CODE SHAPE, NOT AS THE ABSENCE OF A STRING. The obvious check here is
  // `!/includes\("CLOSED"\)/`, and it fails: the comment in suppression.ts quotes the old broken
  // test on purpose so nobody reinstates it. `normalize` only fixes CRLF, it does not strip
  // comments, so an absence check over a commented file tests the prose and not the program.
  check("CLOSED is matched exactly, not by substring", /state === "CLOSED"/.test(ssrc));
  check(
    "and active_deal is reached only from the open states",
    /REPLIED_INTERESTED[\s\S]{0,200}found\.set\("active_deal"/.test(ssrc)
  );
  check("an opt-out close outranks a plain close", /OPT_OUT_CLOSE/.test(ssrc));
  check("and closed_reason is actually selected", /closed_reason/.test(ssrc));

  // The writer that makes contacts.do_not_contact more than a read. It was a gate nothing but the
  // CRM stage picker ever set, so an emailed opt-out stopped one ladder and no others.
  const osrc = normalize(readFileSync("src/lib/outreach/opt-out.ts", "utf8"));
  check("an opt-out writes the flag suppression reads", /do_not_contact: true/.test(osrc));
  check("it only ever flips rows that are currently false", /eq\("do_not_contact", false\)/.test(osrc));
  check("it never unsets the flag", !/do_not_contact: false/.test(osrc));
  check(
    "the reply sweep calls it when somebody asks out",
    /wantsOut[\s\S]{0,200}markDoNotContact/.test(
      normalize(readFileSync("src/lib/followup-operator/reply-sweep.ts", "utf8"))
    )
  );

  // The handoff record. Without it `already_contacted` can never fire, because the only thing that
  // has ever minted an outreach_prospects row for a ReachInbox lead is a REPLY.
  const lpsrc = normalize(readFileSync("src/lib/scraper/listprep.ts", "utf8"));
  check("publishing records the handoff", /export async function recordHandoff/.test(lpsrc));
  check("it writes the board suppression reads", /from\("outreach_prospects"\)[\s\S]{0,200}insert/.test(lpsrc));
  check(
    "it carries a website, or domain_contacted silently narrows to exact address",
    /website: r\.website/.test(lpsrc)
  );
  // ‼️ THE ONE THAT MATTERS MOST. outreach_prospects_due_idx is
  // `where state <> 'CLOSED' and paused = false and confirmed = true`, and it is the worklist the
  // Graph nudge sender drains. Confirming these would enrol every handed-off address in a SECOND
  // sequence out of matthew@srtagency.com, from the tenant that carries client mail.
  check("it does NOT confirm the prospect into the Graph sender's worklist", !/confirmed: true/.test(lpsrc));
  // ‼️ THE CHECK ABOVE READS UN-STRIPPED SOURCE, DELIBERATELY, so no comment in listprep.ts may
  // quote that literal. The run_id comment says "confirmed is left false" in words for that reason.
  check("the handoff carries the run, so a send can be attributed to the list that made it",
    /run_id: runId,/.test(lpsrc));

  check(
    "the lane records the handoff before it calls the batch done",
    /recordHandoff[\s\S]{0,400}status: "done"/.test(normalize(readFileSync("src/lib/scraper/lane.ts", "utf8")))
  );

  // A real lookup against production, read only. An unknown address must not be suppressed.
  const none = await checkSuppression({ email: "nobody-abc123@example-not-real-domain.test" });
  check("an address we have never touched is not suppressed", none === null, JSON.stringify(none));

  // ── 7. The pull maps a Maps record ────────────────────────────────────────
  console.log("\n8. the raw pull");

  const rec = { name: "A Clinic", site: "https://www.aclinic.com", phone: "(336) 331-8066", city: "Austin", us_state: "TX", rating: "4.8", reviews: "212", place_id: "p1", instagram: "https://instagram.com/aclinic" };
  const mapped = fromOutscraper(rec, { runId: "r1", sourceQuery: "med spa 78701", sourceMetro: "austin" });
  check("a record maps", Boolean(mapped));
  check("the domain is normalized", mapped?.domain === "aclinic.com", String(mapped?.domain));
  check("the instagram handle is extracted", mapped?.instagramHandle === "aclinic", String(mapped?.instagramHandle));
  check("the state falls back to us_state", mapped?.state === "TX");
  check("numbers are coerced", mapped?.rating === 4.8 && mapped?.reviewCount === 212);
  check("a nameless record is dropped", fromOutscraper({ site: "x.com" }, { runId: "r", sourceQuery: null, sourceMetro: null }) === null);
  check("instagram is read off the site field too", extractInstagram({ website: "https://instagram.com/second" }) === "second");

  check("the funnel prints counts", funnelLines({ raw: 100, qualified: 60, enriched: 50, verified: 48, sendable: 40 }).some((l) => /qualified {2}60 \(60%\)/.test(l)));
  check("0.7 is labelled a planning number", funnelLines({ raw: 1, qualified: 1, enriched: 1, verified: 1, sendable: 1 }).some((l) => /not a promise/.test(l)));

  // ── 8. The writes, rolled back ────────────────────────────────────────────
  console.log("\n9. what the code inserts, actually inserted, then rolled back");

  const before = await sql`select count(*)::int as n from public.raw_leads`;
  try {
    await sql.begin(async (tx: TxSQL) => {
      const [run] = await tx`insert into public.list_pipeline_runs (label, source, source_queries, icp_text, stage)
        values ('probe', 'outscraper', '{"med spa 78701"}', 'owner operated med spas', 'pulling') returning id`;
      check("a run opens", Boolean(run?.id));

      const [lead] = await tx`insert into public.raw_leads (run_id, source, business_name, domain, place_id, qualify_keep, qualify_reason)
        values (${String(run.id)}, 'outscraper', 'A Clinic', 'aclinic.com', 'p1', true, 'owner operated') returning id`;
      check("a raw lead inserts with its verdict", Boolean(lead?.id));

      await refuses(
        tx,
        "the same place twice in one run is refused",
        () => tx`insert into public.raw_leads (run_id, source, business_name, place_id)
                 values (${String(run.id)}, 'outscraper', 'A Clinic again', 'p1')`
      );

      await refuses(
        tx,
        "an invented source is refused",
        () => tx`insert into public.raw_leads (run_id, source, business_name)
                 values (${String(run.id)}, 'some_vendor', 'C Clinic')`
      );

      const [send] = await tx`insert into public.sendable_leads (run_id, raw_lead_id, email, email_status, provider)
        values (${String(run.id)}, ${String(lead.id)}, 'a@aclinic.com', 'catch_all', 'probe') returning id, email_status`;
      check("a sendable row inserts", Boolean(send?.id));
      check("catch_all is a legal status, not coerced", send?.email_status === "catch_all");

      await refuses(
        tx,
        "an invented email_status is refused",
        () => tx`insert into public.sendable_leads (run_id, raw_lead_id, email, email_status)
                 values (${String(run.id)}, ${String(lead.id)}, 'b@aclinic.com', 'probably_fine')`
      );

      await refuses(
        tx,
        "the same address twice in one run is refused",
        () => tx`insert into public.sendable_leads (run_id, raw_lead_id, email)
                 values (${String(run.id)}, ${String(lead.id)}, 'A@AClinic.com')`
      );

      await refuses(
        tx,
        "an invented stage is refused",
        () => tx`update public.list_pipeline_runs set stage = 'whenever' where id = ${String(run.id)}`
      );

      // And the transaction is still usable after all of that, which is what the savepoints buy.
      const [still] = await tx`select count(*)::int as n from public.raw_leads where run_id = ${String(run.id)}`;
      check("the transaction survives every refusal", still?.n === 1, String(still?.n));

      throw new Error("__probe_rollback__");
    });
  } catch (e) {
    if ((e as Error).message !== "__probe_rollback__") throw e;
  }
  const after = await sql`select count(*)::int as n from public.raw_leads`;
  check("nothing survived the rollback", before[0].n === after[0].n, `${before[0].n} -> ${after[0].n}`);

  console.log("\n        raw_leads holds " + after[0].n + " rows.");
  await sql.end();

  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
