// Read-only: what columns does `contacts` ACTUALLY have?
//
// `contacts` was created in the Supabase console and has drifted from every
// assumption in the code (docs/2026-08-19-contacts-drift-repair.sql found ten
// columns being selected that do not exist). PostgREST fails the WHOLE query on
// one unknown column, so a single bad name in a select list does not degrade,
// it hard-errors the entire lane.
//
// Run this before committing any new column list.
//   bun run scripts/_probe-contacts-columns.ts
//   bun run scripts/_probe-contacts-columns.ts id first_name phone_last10

import { supabaseAdmin } from "@/lib/db";

// The columns resolveLead() wants. Checked by name so a typo fails here, loudly,
// instead of in production as a bare 400.
const WANTED = [
  "id",
  "first_name",
  "last_name",
  "business_name",
  "email",
  "phone",
  "mobile_phone",
  "phone_last10",
  "mobile_last10",
  "website",
  "application_stage",
  "do_not_contact",
  "zoho_lead_id",
  "working_state",
  "source",
];

async function main() {
  // One row is enough: PostgREST hands back every column on select("*"), so the
  // key set IS the live schema. information_schema is not exposed over the REST
  // API, and this needs no extra grant.
  const { data, error } = await supabaseAdmin.from("contacts").select("*").limit(1);
  if (error) {
    console.error("could not read contacts:", error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.error("contacts is empty — cannot infer columns this way");
    process.exit(1);
  }

  const live = new Set(Object.keys(data[0]));
  const asked = process.argv.slice(2);
  const toCheck = asked.length ? asked : WANTED;

  console.log(`contacts has ${live.size} columns\n`);

  let missing = 0;
  console.log("-- columns resolveLead() needs --");
  for (const c of toCheck) {
    const ok = live.has(c);
    if (!ok) missing++;
    console.log(`  ${ok ? "OK     " : "MISSING"} ${c}`);
  }

  if (!asked.length) {
    const extra = [...live].filter((c) => !WANTED.includes(c)).sort();
    console.log(`\n-- the other ${extra.length} columns --`);
    console.log("  " + extra.join(", "));
  }

  console.log(
    missing === 0
      ? "\nALL PRESENT — safe to use this list in a select()"
      : `\n${missing} MISSING — fix the list before using it`
  );
  process.exit(missing ? 1 : 0);
}

main();
