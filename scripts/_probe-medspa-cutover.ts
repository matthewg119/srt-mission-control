// Probe: did the med spa cutover actually land in prod?
//   bun run scripts/_probe-medspa-cutover.ts
// Read-only. Checks the row rename, the leftovers, the new tables, and the shot-grammar
// columns. Prints PASS/FAIL per check and exits non-zero if anything is not ready.

import { supabaseAdmin } from "../src/lib/db";

let failed = 0;
function report(ok: boolean, label: string, detail = ""): void {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

async function tableExists(name: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(name).select("*", { count: "exact", head: true });
  return !error;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select(column).limit(1);
  return !error;
}

async function main() {
  console.log("--- the avatar row ---");
  const { data: rows, error } = await supabaseAdmin
    .from("verticals")
    .select("id,name,drop_mode,slack_drop_channel_id,owner_vertical_id,workflow_vertical_id,sales_letter_examples")
    .in("id", ["medspa_owner_ai", "trt_clinic_ai"]);
  if (error) {
    report(false, "read verticals", error.message);
    process.exit(1);
  }
  const med = (rows ?? []).find((r) => r.id === "medspa_owner_ai");
  const trt = (rows ?? []).find((r) => r.id === "trt_clinic_ai");
  report(Boolean(med), "medspa_owner_ai row exists");
  report(!trt, "trt_clinic_ai row is gone");
  if (med) {
    report(med.name === "Med Spa Owner AI Visibility (B2B)", "name updated", `got "${med.name}"`);
    report(med.drop_mode === "broll_suggestions", "drop_mode", `got "${med.drop_mode}"`);
    report(Boolean(med.slack_drop_channel_id), "drop channel wired", String(med.slack_drop_channel_id));
    report(med.owner_vertical_id === "medspa_owner_ai", "owner_vertical_id", String(med.owner_vertical_id));
    report(med.workflow_vertical_id === "pest_control", "workflow library", String(med.workflow_vertical_id));
    const letters = String(med.sales_letter_examples ?? "");
    report(letters.includes("caption voice anchor"), "letters replaced");
    report(!/TRT|telehealth|\$99\/month/i.test(letters), "no TRT copy left in the letters");
    report(!letters.includes("—"), "no em dashes in the letters");
    report((letters.match(/^--- LETTER/gm) ?? []).length === 5, "five letters", `${(letters.match(/^--- LETTER/gm) ?? []).length} found`);
  }

  console.log("\n--- leftovers under the old id ---");
  for (const t of ["content_examples", "style_rules", "content_jobs", "workflows", "reference_asks"]) {
    if (!(await tableExists(t))) {
      report(false, `${t} exists`);
      continue;
    }
    const { count } = await supabaseAdmin
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("vertical_id", "trt_clinic_ai");
    report((count ?? 0) === 0, `${t} has no trt_clinic_ai rows`, `count=${count ?? 0}`);
  }

  console.log("\n--- new tables ---");
  for (const t of ["reference_asks", "broll_voiceovers", "style_rules", "broll_drops"]) {
    report(await tableExists(t), `${t} exists`);
  }

  console.log("\n--- shot-grammar ledger columns ---");
  for (const c of ["subject_key", "capture_key", "light_key", "grade_key", "framing_key", "presence_key", "lane"]) {
    report(await columnExists("broll_drops", c), `broll_drops.${c}`);
  }

  console.log("\n--------------------");
  console.log(failed === 0 ? "READY" : `NOT READY: ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
