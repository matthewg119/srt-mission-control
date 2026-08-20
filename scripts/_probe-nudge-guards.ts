// Read-only. Two questions: does the greeting refuse the things it should, and would the
// cold-only guard actually exclude someone who has replied.

import { greetingName, buildNudgeBody } from "@/lib/outreach-sender/body";
import { supabaseAdmin } from "@/lib/db";

const CASES: Array<[string | null, string]> = [
  ["Jonathan", "plain first name"],
  ["Jorge Diaz", "full name, first only"],
  ["  tina  ", "whitespace"],
  [null, "no name at all"],
  ["", "empty"],
  ["info@mercadosmeat.com", "an email address"],
  ["Tito's Taqueria & Bar", "a company with an ampersand"],
  ["Duran Construction, Inc.", "a company ending Inc."],
  ["Velasquez Gutierrez Electrical Service Corp", "a company ending Corp"],
  ["Silent Solutions LLC", "a company ending LLC"],
  ["4 Seasons Tree Care", "starts with a digit"],
  ["https://example.com", "a URL"],
  ["A", "one letter"],
];

async function main() {
  console.log("\nGREETING GUARD\n");
  for (const [input, why] of CASES) {
    const got = greetingName(input);
    const shown = got ? `"${got},"` : "(no greeting line)";
    console.log(`  ${String(JSON.stringify(input)).padEnd(46)} -> ${shown.padEnd(20)} ${why}`);
  }

  console.log("\nBODY WITH NO NAME (opens on the first line, no 'Hi there'):");
  console.log("-".repeat(70));
  console.log(buildNudgeBody(null));
  console.log("-".repeat(70));

  console.log("\nCOLD-ONLY GUARD: inbound count per prospect, the query the selector runs\n");
  const { data: replied } = await supabaseAdmin
    .from("outreach_prospects").select("id, email, confirmed").not("last_reply_at", "is", null).limit(3);
  const { data: cold } = await supabaseAdmin
    .from("outreach_prospects").select("id, email, confirmed").eq("confirmed", true).eq("step", 1).is("last_reply_at", null).limit(3);

  for (const p of [...(replied ?? []), ...(cold ?? [])]) {
    const { count } = await supabaseAdmin
      .from("outreach_touches").select("id", { count: "exact", head: true })
      .eq("prospect_id", p.id).eq("direction", "inbound");
    const verdict = count ? "EXCLUDED (conversation in progress)" : "eligible";
    console.log(`  ${String(p.email).padEnd(42)} inbound=${String(count ?? 0).padEnd(3)} ${verdict}`);
  }
  console.log("");
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
