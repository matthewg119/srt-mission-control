// Does a page record what it was made FROM, and does a rerun add to the record rather than erase it?
//
//   bun run --env-file=.env.local scripts/_probe-page-datasets.ts
//
// ‼️ IT WRITES, AND THEN ROLLS BACK. The failure this exists to catch is an insert that names a
// column the database does not have: PostgREST fails the WHOLE statement and supabase-js RETURNS
// the error instead of throwing, so capturePage's try/catch never fires and the corpus silently
// stays empty. Only a real insert proves the shape is accepted. So it opens a transaction, inserts
// exactly what the code inserts, reads it back, and ROLLS BACK: nothing survives, and the training
// corpus is not polluted with probe rows.
//
// Run with `bun run`, not tsx: it uses Bun's SQL client for the transaction, the same one
// scripts/db.ts uses for migrations.

import { SQL } from "bun";
import { readFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";

type Row = Record<string, unknown>;

/**
 * The slice of Bun's SQL client this probe uses, declared locally.
 *
 * ‼️ `begin()` RATHER THAN sql.unsafe("BEGIN"), AND THAT IS A SAFETY DECISION, NOT A STYLE ONE.
 * The client pools connections, so a bare BEGIN and the INSERT after it can land on DIFFERENT
 * connections: the transaction would be empty, the insert would COMMIT, and this probe would
 * quietly write rows into the training corpus on every run. begin() holds one connection for the
 * callback, which is the only thing that makes the rollback real.
 *
 * Declared here because the repo's tsconfig does not pull in bun-types, so the template-tag call
 * signature is invisible to tsc. scripts/db.ts sidesteps this by only ever calling unsafe().
 */
interface TxSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  begin<T>(fn: (tx: TxSQL) => Promise<T>): Promise<T>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

/**
 * ‼️ CRLF TOLERANT, AND EVERY SOURCE READ GOES THROUGH IT. git may hand a file back with \r\n, and
 * a literal "\n" in a needle then matches nothing: the probe reports the code as wrong rather than
 * reporting that it could not look. The loader probe was bitten by exactly this on 2026-09-15.
 */
function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** The columns 2026-09-17 added, per table. Every one is named by code that runs on a draft. */
const NEW_COLUMNS: Record<string, string[]> = {
  page_dataset: [
    "audience_id", "offer_id", "angle_id", "angle", "narrative", "indoctrination",
    "awareness_entry", "awareness_target", "lead_magnet_key", "magnet_candidates",
    "variant_no", "rerun_of",
  ],
  page_plan: ["audience_id", "offer_id", "angle_id"],
  page_magnet_candidates: ["plan_id", "angle_id"],
  page_angles: [
    "client_id", "plan_id", "audience_id", "offer_id", "idea", "promise", "narrative",
    "indoctrination", "awareness_entry", "awareness_target", "proof_needed", "status",
  ],
  page_plan_runs: [
    "client_id", "reason", "offer_id", "audience_id", "rows_snapshot", "angles_snapshot",
    "row_count", "kept_count", "replaced_count",
  ],
};

async function main() {
  // ── 1. Every new column is selectable through PostgREST ───────────────────
  console.log("\n1. the columns the app names by hand");

  for (const [table, cols] of Object.entries(NEW_COLUMNS)) {
    // ‼️ ALL OF THEM IN ONE SELECT, DELIBERATELY. One unknown column fails the whole select, which
    // is exactly the production failure mode; asking one at a time would pass where the app fails.
    const { error } = await supabaseAdmin.from(table).select(cols.join(", ")).limit(1);
    check(
      `${table}: ${cols.length} columns readable`,
      !error,
      error ? `${error.message}. docs/2026-09-17-page-datasets-and-angles.sql has not been run.` : ""
    );
  }

  // ── 2. The write shape is accepted, then rolled back ──────────────────────
  console.log("\n2. what the code inserts, actually inserted, then rolled back");

  const sql = new SQL(process.env.DATABASE_URL!) as unknown as TxSQL;
  const [srt] = await sql`select id from public.clients where slug = 'srt-agency-llc' limit 1`;
  if (!srt) {
    check("srt-agency-llc resolves", false, "resolve by slug, never a pinned id");
  } else {
    check("srt-agency-llc resolves", true);
    const clientId = String(srt.id);

    const before = await sql`select count(*)::int as n from public.page_dataset`;
    const beforeRuns = await sql`select count(*)::int as n from public.page_plan_runs`;

    try {
      await sql.begin(async (tx: TxSQL) => {
        const [run] = await tx`
          insert into public.page_plan_runs (client_id, reason, rows_snapshot, angles_snapshot, row_count, kept_count, replaced_count, notes, created_by)
          values (${clientId}, 'rerun', '[]'::jsonb, '[]'::jsonb, 0, 0, 0, '{}', 'probe')
          returning id`;
        check("a plan snapshot inserts", Boolean(run?.id));

        const [cap] = await tx`
          insert into public.page_dataset
            (client_id, captured_reason, angle, narrative, indoctrination,
             awareness_entry, awareness_target, lead_magnet_key, magnet_candidates, variant_no)
          values (${clientId}, 'drafted', 'the probe angle', 'the probe narrative', 'the probe belief',
             4, 2, 'probe_magnet', '[{"title":"a","chosen":true}]'::jsonb, 3)
          returning id, variant_no, awareness_entry, awareness_target`;
        check("a capture carrying every new dataset inserts", Boolean(cap?.id));
        check("variant_no round trips", cap?.variant_no === 3, String(cap?.variant_no));
        check("awareness entry and target round trip", cap?.awareness_entry === 4 && cap?.awareness_target === 2);

        // The check constraints must actually refuse what they claim to.
        let refused = false;
        try {
          await tx`insert into public.page_dataset (client_id, captured_reason) values (${clientId}, 'invented')`;
        } catch {
          refused = true;
        }
        check("an unknown captured_reason is refused", refused, "the check constraint is not there");

        let awarenessRefused = false;
        try {
          await tx`insert into public.page_angles (client_id, plan_id, idea, awareness_entry)
                   values (${clientId}, gen_random_uuid(), 'x', 9)`;
        } catch {
          awarenessRefused = true;
        }
        check("an awareness stage outside 1..5 is refused", awarenessRefused);

        // ‼️ THE ROLLBACK. Throwing is how Bun's sql.begin aborts; the catch below swallows it.
        throw new Error("__probe_rollback__");
      });
    } catch (e) {
      if ((e as Error).message !== "__probe_rollback__") throw e;
    }

    const after = await sql`select count(*)::int as n from public.page_dataset`;
    const afterRuns = await sql`select count(*)::int as n from public.page_plan_runs`;
    check("nothing survived the rollback in page_dataset", before[0].n === after[0].n, `${before[0].n} -> ${after[0].n}`);
    check("nothing survived the rollback in page_plan_runs", beforeRuns[0].n === afterRuns[0].n, `${beforeRuns[0].n} -> ${afterRuns[0].n}`);
  }

  // ── 3. The order that makes the snapshot mean anything ────────────────────
  console.log("\n3. the snapshot is taken before the delete");

  const src = normalize(readFileSync("src/lib/clients/pre-call-pages.ts", "utf8"));
  const snapAt = src.indexOf("snapshotPlan({");
  const delAt = src.search(/\.delete\(\)\s*\n\s*\.eq\("client_id", clientId\)/);
  check("both are in proposePreCallPlan", snapAt > 0 && delAt > 0);
  check(
    "the snapshot comes first",
    snapAt > 0 && delAt > 0 && snapAt < delAt,
    "reading after the delete records the plan that replaced the one being asked about"
  );

  const runs = normalize(readFileSync("src/lib/clients/page-plan-runs.ts", "utf8"));
  check("a failed snapshot never fails the run", /catch \(e\)/.test(runs) && /snapshot threw/.test(runs));
  check("it names the migration when the table is missing", /2026-09-17-page-datasets-and-angles\.sql/.test(runs));

  const ds = normalize(readFileSync("src/lib/clients/page-dataset.ts", "utf8"));
  check("the capture stays append-only", !/from\("page_dataset"\)\s*\.update/.test(ds) || /research_prompt/.test(ds));
  check("rejected magnets are kept, not only the winner", /THE REJECTS ARE THE POINT/.test(ds));
  check("the capture records the angle it was written from", /angle_id: angle\?\.id/.test(ds));

  // ── 4. The embed the headline brief depends on ────────────────────────────
  console.log("\n4. the join that carries the picked idea into the headline brief");

  // ‼️ AN EMBED THAT DOES NOT RESOLVE RETURNS AN ERROR, AND pickedAnglesFor SWALLOWS IT AND RETURNS
  // []. That degrade is correct (headlines must not die because angles are unreadable) and it is
  // also exactly how this would fail silently forever: the brief would quietly go back to being
  // about a phrase. So the relationship is asserted here rather than trusted.
  const { error: embedErr } = await supabaseAdmin
    .from("page_angles")
    .select("idea, indoctrination, plan_id, page_plan!page_angles_plan_id_fkey!inner(target_keyword, rank)")
    .eq("status", "approved")
    .limit(1);
  check(
    "page_angles embeds page_plan",
    !embedErr,
    embedErr ? `${embedErr.message}. The headline brief would silently lose the picked idea.` : ""
  );

  // ── 5. Where the corpus actually stands ───────────────────────────────────
  console.log("\n5. the corpus today");

  for (const t of ["page_dataset", "page_plan_runs", "page_angles", "page_plan", "client_pages"]) {
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.${t}`);
    console.log(`        ${t.padEnd(18)} ${n} rows`);
  }
  await sql.end();

  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
