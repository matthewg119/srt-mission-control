// Where is the AI Skin Concierge up to, per client, and can the step run yet?
//
// Read-only by default. Run it before and after docs/2026-09-01-concierge.sql:
//
//   bun run scripts/_probe-concierge-step.ts
//
// To backfill the two new step rows onto existing clients and RUN the preview step:
//
//   bun run scripts/_probe-concierge-step.ts --run <client-slug>
//
// ‼️ `--run` POSTS TO SLACK. provisionConcierge calls notifyStep, which is the whole point of
// the step, but it means this is not a dry read. The default has no side effects at all.
//
// ‼️ `concierge_preview` AND `concierge_live` DID NOT EXIST WHEN EXISTING CLIENTS WERE SEEDED,
// so they have no client_delivery_steps rows for them and the steps are INVISIBLE on the board
// until somebody backfills. seedDeliverySteps upserts with ignoreDuplicates, so re-running it
// adds exactly the two missing rows and leaves every existing status alone. That is what --run
// does first, and it is the reason "the step is not showing up" is expected rather than a bug.

import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS } from "@/config/delivery-steps";

const CONCIERGE_STEPS = ["concierge_preview", "concierge_live"] as const;

async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (!error) return true;
  if (/relation|does not exist|schema cache/i.test(error.message)) return false;
  throw new Error(`${table}: ${error.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.includes("--run");
  const slug = args[args.indexOf("--run") + 1];

  console.log(`\nDELIVERY_STEPS carries ${DELIVERY_STEPS.length} steps.`);
  for (const key of CONCIERGE_STEPS) {
    const step = DELIVERY_STEPS.find((s) => s.key === key);
    console.log(
      `  ${step ? "present" : "MISSING"}  ${key}` +
        (step ? `  [${step.phase}] mode=${step.mode} blockedBy=${(step.blockedBy ?? []).join(",")}` : "")
    );
  }

  const hasConfigs = await tableExists("concierge_configs");
  console.log(
    `\nconcierge_configs: ${hasConfigs ? "EXISTS" : "MISSING — docs/2026-09-01-concierge.sql has not been run"}`
  );

  const { data: clients, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, dba_name, legal_name, domain")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(`clients: ${error.message}`);

  console.log(`\n${(clients ?? []).length} client(s), newest first:\n`);
  for (const c of clients ?? []) {
    const { data: steps } = await supabaseAdmin
      .from("client_delivery_steps")
      .select("step_key, status, output_ref")
      .eq("client_id", c.id)
      .in("step_key", [...CONCIERGE_STEPS, "hub_preview"]);

    const byKey = new Map((steps ?? []).map((s) => [s.step_key as string, s]));
    const hub = byKey.get("hub_preview");
    const prev = byKey.get("concierge_preview");
    const live = byKey.get("concierge_live");

    console.log(`  ${c.dba_name || c.legal_name}  (slug: ${c.slug ?? "NONE"}, domain: ${c.domain ?? "none"})`);
    console.log(`      hub_preview        ${hub ? hub.status : "no row"}`);
    console.log(
      `      concierge_preview  ${prev ? `${prev.status}${prev.output_ref ? ` -> ${prev.output_ref}` : ""}` : "no row (needs backfill)"}`
    );
    console.log(`      concierge_live     ${live ? live.status : "no row (needs backfill)"}`);
  }

  if (!run) {
    console.log("\nRead-only. Pass `--run <client-slug>` to backfill the rows and run the preview step.\n");
    return;
  }

  if (!slug || slug.startsWith("--")) {
    console.log("\n--run needs a client slug: --run acme-medspa\n");
    process.exit(1);
  }
  if (!hasConfigs) {
    console.log("\nRefusing to run: concierge_configs does not exist. Run the migration first.\n");
    process.exit(1);
  }

  const target = (clients ?? []).find((c) => c.slug === slug);
  if (!target) {
    console.log(`\nNo client with slug "${slug}" in the 25 most recent.\n`);
    process.exit(1);
  }

  console.log(`\nBackfilling step rows for ${target.dba_name || target.legal_name} ...`);
  const { seedDeliverySteps } = await import("../src/lib/clients/delivery-checklist");
  await seedDeliverySteps(target.id as string);

  console.log("Running concierge_preview ...");
  const { provisionConcierge } = await import("../src/lib/clients/concierge-setup");
  const result = await provisionConcierge(target.id as string);
  console.log(result.ok ? `  ok: ${result.note}` : `  FAILED: ${result.error}`);
  console.log("");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
