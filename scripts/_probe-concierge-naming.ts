/**
 * Probe: what the concierge calls itself, per client.
 *
 *   bun run scripts/_probe-concierge-naming.ts
 *
 * Pure function, no database, no network.
 *
 * WHY IT EXISTS. conciergeLaneName() has now changed direction twice on instruction, and the
 * second reversal is not a simple undo of the first: a client row wins, EXCEPT when it carries
 * one of the retired product names, which every med spa audience seeded before 2026-09-26 still
 * does. Without that exception, a change about naming a dentist's bot would have silently put
 * "AI Skin Concierge" back on live client domains. That rule is one `if` and is exactly the kind
 * of thing a later tidy-up removes as redundant.
 */

import { conciergeLaneName, conciergeLaneBlurb } from "../src/lib/concierge/lane-name";
import { PRODUCT_CONCIERGE } from "../src/config/pitch";
import type { ResolvedAudience } from "../src/lib/clients/audiences";

let failures = 0;

function check(name: string, got: string, want: string): void {
  if (got === want) console.log(`  ok    ${name.padEnd(52)} "${got}"`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name.padEnd(52)} got "${got}", wanted "${want}"`);
  }
}

/** Only the fields conciergeLaneName reads. Cast because the rest is irrelevant to this rule. */
function audience(laneName: string | null, stance: "patient" | "owner" = "patient"): ResolvedAudience {
  return { laneName, stance } as unknown as ResolvedAudience;
}

console.log("\nConcierge naming\n");

console.log("A CLIENT'S OWN NAME WINS");
check("a dentist", conciergeLaneName(audience("AI Dental Concierge")), "AI Dental Concierge");
check("a restaurant", conciergeLaneName(audience("AI Menu Concierge")), "AI Menu Concierge");
check("a roofer", conciergeLaneName(audience("AI Roofing Assistant")), "AI Roofing Assistant");
check("surrounding space is trimmed", conciergeLaneName(audience("  AI Menu Concierge  ")), "AI Menu Concierge");

console.log("\nTHE DEFAULT HOLDS WHEN THE ROW SAYS NOTHING");
check("a null lane name", conciergeLaneName(audience(null)), PRODUCT_CONCIERGE);
check("an empty lane name", conciergeLaneName(audience("")), PRODUCT_CONCIERGE);
check("whitespace only", conciergeLaneName(audience("   ")), PRODUCT_CONCIERGE);
check("a bare stance, no row at all", conciergeLaneName("patient"), PRODUCT_CONCIERGE);
check("a bare owner stance", conciergeLaneName("owner"), PRODUCT_CONCIERGE);

console.log("\nTHE RETIRED NAMES NEVER COME BACK");
check("the med spa name", conciergeLaneName(audience("AI Skin Concierge")), PRODUCT_CONCIERGE);
check("the owner-lane name", conciergeLaneName(audience("AI Visibility Concierge")), PRODUCT_CONCIERGE);
check("case does not smuggle one through", conciergeLaneName(audience("ai skin concierge")), PRODUCT_CONCIERGE);
check("nor does spacing", conciergeLaneName(audience(" AI SKIN CONCIERGE ")), PRODUCT_CONCIERGE);

console.log("\nTHE BLURB NAMES NO TRADE");
{
  const patient = conciergeLaneBlurb("patient");
  const owner = conciergeLaneBlurb("owner");
  for (const [label, text] of [["patient", patient], ["owner", owner]] as const) {
    const leaked = ["skin", "photo", "clinic", "treatment", "patient"].filter((w) =>
      text.toLowerCase().includes(w)
    );
    if (leaked.length === 0) console.log(`  ok    the ${label} blurb names no trade`);
    else {
      failures += 1;
      console.error(`  FAIL  the ${label} blurb leaks: ${leaked.join(", ")} — "${text}"`);
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
