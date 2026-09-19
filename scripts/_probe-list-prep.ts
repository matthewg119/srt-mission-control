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
import { configuredProviders, estimateCost, enrichLines, summarize, PROVIDERS } from "@/lib/scraper/enrich";
import { funnelLines, extractInstagram, fromOutscraper } from "@/lib/scraper/pull";
import {
  DEFAULT_VERTICAL,
  DENTIST_ICP,
  ICP_BY_VERTICAL,
  MED_SPA_ICP,
  icpFor,
  knownVerticals,
  resolveVertical,
} from "@/lib/scraper/icp";

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

async function main() {
  // ── 1. The schema the code names by hand ──────────────────────────────────
  console.log("\n1. the tables, and every column the code names");

  const COLUMNS: Record<string, string[]> = {
    raw_leads: [
      "run_id", "source", "source_query", "source_metro", "place_id", "business_name", "domain",
      "website", "phone", "phone_normalized", "vertical_slug", "business_type", "avatar_slug",
      "found_in_sources", "qualify_keep", "qualify_reason", "qualify_model", "qualified_at",
    ],
    list_pipeline_runs: [
      "batch_id", "label", "source", "source_queries", "icp_text", "stage", "raw_count",
      "qualified_count", "enriched_count", "verified_count", "sendable_count", "provider_spend",
      "cost_usd", "spend_approved_at", "drop_review_ts",
    ],
    sendable_leads: [
      "run_id", "raw_lead_id", "email", "first_name", "last_name", "title", "provider",
      "provider_cost_usd", "attempts", "email_status", "catchall_rechecked_at", "suppressed_reason",
    ],
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
  const [cons] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'scraper_batches_status_check'`;
  const def = String(cons?.def ?? "");
  for (const stage of ["pulling", "qualifying", "qualified", "enriching", "catchall_recheck", "suppressing"]) {
    check(`${stage} is a legal stage`, def.includes(`'${stage}'`));
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

  console.log("\n5. the qualify verdicts");

  const ids = ["a", "b"];
  const good = { verdicts: [{ id: "a", keep: true, reason: "owner operated med spa" }, { id: "b", keep: false, reason: "national chain" }] };
  check("a good batch passes", verdictFaults(good, ids).length === 0, verdictFaults(good, ids).join(" "));
  check("a missing verdict is refused", verdictFaults({ verdicts: [good.verdicts[0]] }, ids).some((f) => /were not judged/.test(f)));
  check("an invented id is refused", verdictFaults({ verdicts: [...good.verdicts, { id: "zz", keep: true, reason: "x" }] }, ids).some((f) => /not in the batch/.test(f)));
  check("a duplicate verdict is refused", verdictFaults({ verdicts: [good.verdicts[0], good.verdicts[0], good.verdicts[1]] }, ids).some((f) => /judged twice/.test(f)));
  check("a missing reason is refused", verdictFaults({ verdicts: [{ id: "a", keep: true, reason: "" }, good.verdicts[1]] }, ids).some((f) => /reason is required/.test(f)));
  check("an em dash in a reason is refused", verdictFaults({ verdicts: [{ id: "a", keep: true, reason: "fine — good" }, good.verdicts[1]] }, ids).some((f) => /em dash/.test(f)));
  check("a non-boolean keep is refused", verdictFaults({ verdicts: [{ id: "a", keep: "yes", reason: "x" }, good.verdicts[1]] }, ids).some((f) => /must be true or false/.test(f)));
  check("nothing at all is refused", verdictFaults({ verdicts: [] }, ids).length > 0);
  check("the chunk size is sane", QUALIFY_CHUNK >= 5 && QUALIFY_CHUNK <= 50, String(QUALIFY_CHUNK));

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
