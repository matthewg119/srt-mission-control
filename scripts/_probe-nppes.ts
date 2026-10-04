// Probe: the NPI registry owner lookup, offline.
//
//   bunx tsx scripts/_probe-nppes.ts     pure checks, no network, no DB, no key
//
// ‼️ THIS RUNG DECIDES WHOSE NAME GOES IN A COLD EMAIL'S GREETING, which is the most publicly
// embarrassing thing this pipeline can get wrong. A wrong owner name is not a missing lead: it is
// permuted into six addresses, uploaded to MillionVerifier, and any that verify get mailed to a real
// stranger addressed as somebody else. So the question here is not "does it find owners" but "can it
// ever attach a name to the wrong clinic".
//
// Three rails carry that and all three are asserted by name:
//
//   1. Containment needs eight characters. Without a floor, "spa" is inside every clinic in America
//      and every lookup returns the first stranger in the city.
//   2. A legal suffix is not identity. Google carries "Glow Bar Med Spa" and the registry carries
//      "GLOW BAR MED SPA LLC"; comparing those raw misses a business that matched perfectly.
//   3. An individual NPI has no organisation name, so it cannot be matched against a business at all
//      and must be skipped rather than guessed at.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS, the same rule every other
// probe here states: checks written below them never run.

import {
  matchConfidence,
  normalizeOrgName,
  pickOwner,
  titleCaseName,
} from "../src/lib/scraper/nppes";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

// ── 1. Normalising a business name ───────────────────────────────────────────
{
  eq("case and punctuation come off", normalizeOrgName("Glow Bar Med-Spa, LLC"), "glow bar med spa");
  eq("an ampersand becomes a word so it cannot split one", normalizeOrgName("Skin & Tonic"), "skin and tonic");
  eq("legal form is not identity", normalizeOrgName("RENEW BEAUTY MED SPA LLC"), "renew beauty med spa");
  eq("nor is Inc", normalizeOrgName("Bare Skin Bar Inc."), "bare skin bar");
  eq("nor PLLC", normalizeOrgName("Ayana Dermatology PLLC"), "ayana dermatology");
  eq("a leading 'The' is dropped", normalizeOrgName("The Nook Spa"), "nook spa");
  eq("whitespace collapses", normalizeOrgName("  Mod   Facial  "), "mod facial");
  eq("an empty name normalises to empty", normalizeOrgName("   "), "");
}

// ── 2. The match rule, which is the one that can misattribute a person ───────
{
  eq("identical names are exact", matchConfidence("Glow Bar Med Spa", "Glow Bar Med Spa"), "exact");
  eq("a legal suffix still reads exact", matchConfidence("Glow Bar Med Spa", "GLOW BAR MED SPA LLC"), "exact");
  eq("punctuation does not break exact", matchConfidence("Skin & Tonic", "Skin and Tonic, LLC"), "exact");

  // The real shape this rung exists for: the registered name carries extra words.
  eq(
    "the trading name inside a longer registered name is strong",
    matchConfidence("Renew Beauty Med Spa", "RENEW BEAUTY MED SPA AND WELLNESS CENTER"),
    "strong"
  );

  // ‼️ RAIL 1. Each of these would attach a stranger's name to a clinic.
  eq("a bare 'spa' matches nothing", matchConfidence("Spa", "DALLAS PREMIER SPA LLC"), "weak");
  eq("'med spa' is too short to carry a match", matchConfidence("Med Spa", "UPTOWN MED SPA LLC"), "weak");
  eq("'the spa' is too short", matchConfidence("The Spa", "THE SPA AT LEGACY WEST"), "weak");
  eq("two unrelated clinics are weak", matchConfidence("Glow Bar", "Derma Luxe Aesthetics"), "weak");
  eq("an empty side is weak, never exact", matchConfidence("", "GLOW BAR LLC"), "weak");
  eq("and the other way round", matchConfidence("Glow Bar", ""), "weak");

  // Exactly on the boundary, asserted so a future edit to the bound is deliberate.
  //
  // ‼️ THE NORMALISED LENGTH IS ASSERTED ALONGSIDE, BECAUSE THE FIRST VERSION OF THIS TEST DID NOT
  // TEST WHAT IT SAID. It used "Skin Co", which normalises to "skin" (four characters) because `co`
  // is a stripped legal suffix, so it passed for the wrong reason and would have kept passing if the
  // bound moved from 8 to 6. Spelling out the length makes the case checkable by reading it.
  eq("the seven-character case really is seven characters", normalizeOrgName("Skin La").length, 7);
  check("seven characters is not enough to contain-match", matchConfidence("Skin La", "SKIN LAB OF DALLAS LLC") === "weak");
  eq("the eight-character case really is eight", normalizeOrgName("Skin Lab").length, 8);
  check("eight characters is", matchConfidence("Skin Lab", "SKIN LAB OF DALLAS LLC") === "strong");
}

// ── 3. Title casing, because the registry shouts ─────────────────────────────
{
  eq("a shouted name is title cased", titleCaseName("MARIA GONZALEZ"), "Maria Gonzalez");
  eq("a lowercase name is too", titleCaseName("john burns"), "John Burns");
  eq("extra whitespace does not survive", titleCaseName("  ANNA   LEE "), "Anna Lee");
}

// ── 4. Picking an owner out of a registry response ───────────────────────────
const org = (name: string, first: string, last: string, extra: Record<string, unknown> = {}) => ({
  number: "1234567890",
  basic: {
    organization_name: name,
    authorized_official_first_name: first,
    authorized_official_last_name: last,
    ...extra,
  },
});

{
  const hit = pickOwner([org("GLOW BAR MED SPA LLC", "MARIA", "GONZALEZ")], "Glow Bar Med Spa");
  eq("an exact organisation match yields its officer", hit?.firstName + " " + hit?.lastName, "Maria Gonzalez");
  eq("and records how it matched", hit?.confidence, "exact");
  eq("and carries the NPI for the card", hit?.npi, "1234567890");

  const cred = pickOwner(
    [org("AYANA DERMATOLOGY AND AESTHETICS PLLC", "ADIR", "MILLER", { authorized_official_credential: "MD" })],
    "Ayana Dermatology & Aesthetics"
  );
  eq("a credential is carried when the registry has one", cred?.credential, "MD");

  // ‼️ RAIL 3. An individual NPI has no organisation name to match against.
  const individual = [{ number: "999", basic: { first_name: "JANE", last_name: "DOE", credential: "NP" } }];
  eq("an individual NPI is skipped, not guessed at", pickOwner(individual, "Glow Bar Med Spa"), null);

  // An organisation with no named officer is also nothing this rung can use.
  eq("an organisation with no officer is skipped", pickOwner([org("GLOW BAR MED SPA LLC", "", "")], "Glow Bar Med Spa"), null);

  // The weak ones must never be returned, however many there are.
  const strangers = [
    org("DALLAS PREMIER SPA LLC", "BOB", "SMITH"),
    org("UPTOWN WELLNESS SPA LLC", "ANN", "JONES"),
  ];
  eq("a city full of strangers yields nobody", pickOwner(strangers, "Glow Bar"), null);

  // ‼️ AN EXACT MATCH OUTRANKS A STRONG ONE WHEREVER IT SITS IN THE LIST. The registry does not
  // order by relevance, so taking the first acceptable result would prefer whichever row came back
  // first rather than the one that actually names this clinic.
  const mixed = [
    org("RENEW BEAUTY MED SPA AND WELLNESS CENTER", "WRONG", "PERSON"),
    org("RENEW BEAUTY MED SPA LLC", "RIGHT", "PERSON"),
  ];
  const picked = pickOwner(mixed, "Renew Beauty Med Spa");
  eq("the exact match wins even when a strong one came first", picked?.firstName, "Right");

  eq("an empty response is a refusal", pickOwner([], "Glow Bar Med Spa"), null);
}

// ‼️ The summary and the exit stay the last two statements. Nothing below them runs.
console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
