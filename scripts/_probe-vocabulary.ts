// Proves the med-spa vocabulary stays out of the files that have been cut over, and tracks the
// ones that have not.
//
// Run: bunx tsx scripts/_probe-vocabulary.ts
//
// ‼️ NO MODEL CALL, NO DATABASE, NO WRITES. It reads source files and greps them.
//
// classify.ts opens with the rule this probe mechanises for the vocabulary half: "there must never
// be an `if (vertical === "...")` branch anywhere in this file or its callers". That rule was
// enforced by review alone and did not survive contact: question-sets.ts has three
// `vertical === "med_spa"` branches testing a snake_case literal classify.ts is instructed never to
// emit, so a real med spa misses all three.
//
// ‼️ TWO LISTS, AND THE SECOND ONE IS THE POINT. CUT_OVER files must be clean and FAIL the probe if
// they are not. PENDING files are known to still carry the literals and are REPORTED, never failed,
// each with the cutover step that will clear it. A probe that failed on all of them from day one
// would have been switched off on day two, and the cutover is ten steps long.
//
// ‼️ COMMENTS ARE STRIPPED BEFORE SCANNING. Every one of these words is legitimate in prose: this
// file's own header says "med spa" four times. What is banned is the word reaching a model or a
// customer, which means string literals and identifiers, not explanations.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

/**
 * The words that are med-spa PRESET DATA, not universal English.
 *
 * ‼️ "patient" IS ON THE LIST AND stance IS NOT A VIOLATION. The stored stance values stay
 * 'patient' and 'owner' on purpose, because widening that CHECK would split rungOf()'s magnet
 * firewall. What this catches is the word used as a NOUN FOR A HUMAN in copy, which is what the
 * vocabulary columns replace.
 */
const BANNED = [
  "patient",
  "patients",
  "clinic",
  "clinics",
  "treatment",
  "treatments",
  "injector",
  "consultation",
] as const;

/** Files that have completed the cutover. Adding one here is how a step is finished. */
const CUT_OVER: ReadonlyArray<{ path: string; step: string }> = [
  { path: "src/lib/clients/client-headlines.ts", step: "4 (the headline lane)" },
  { path: "src/lib/concierge/config.ts", step: "5 (the concierge)" },
  { path: "src/lib/concierge/tools.ts", step: "5 (the concierge)" },
  { path: "src/lib/concierge/engine.ts", step: "5 (the concierge)" },
  { path: "src/lib/concierge/for-client.ts", step: "5 (the concierge)" },
  { path: "src/lib/concierge/lane-name.ts", step: "5 (the concierge)" },
];

/** Known to still carry the vocabulary. Reported, never failed, with the step that clears it. */
const PENDING: ReadonlyArray<{ path: string; step: string }> = [
  // ‼️ STEP 6 IS DONE AND THIS FILE STILL SAYS "lip filler" THIRTY TIMES, WHICH IS CORRECT.
  // What remains is the PATIENT table itself: ten categories of lip filler with /per syringe/ in
  // its price match. That is Matthew's own seed list and it is preset DATA, not leakage, and this
  // probe's own header says a preset data file may name its own trade.
  //
  // What step 6 removed was the Record<Audience, ...> that made those two tables the only two
  // possible answers, in a file whose header claimed "a third audience is a third table rather
  // than a third function" while the type made a third table impossible. categoriesFor() keys on
  // the PRESET now, and derives a set from the audience's own nouns when no preset names one.
  { path: "src/lib/clients/keyword-expansion.ts", step: "6 (DONE: what remains is preset data)" },
  { path: "src/config/presence-platforms.ts", step: "8 (the presence sweep)" },
];

/**
 * Source with comments and import lines removed.
 *
 * Deliberately crude and deliberately conservative: it strips block comments, line comments and
 * imports, and leaves everything else. A false positive here costs one line of thought; a false
 * negative ships "your patients" onto a taco shop's website.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .filter((l) => !l.trim().startsWith("import "))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

/**
 * A PROPERTY NAME IS SCHEMA. A WORD IN A STRING IS COPY. Only the second one reaches a person.
 *
 * ‼️ `offer.treatment` IS ITSELF MED-SPA VOCABULARY AND IS EXEMPT HERE ON PURPOSE. It is the
 * key of the clients.offer jsonb column (docs/2026-09-08-client-offer.sql), so every reader in the
 * repo writes `offer.treatment` whatever the client actually sells. Renaming a stored jsonb key is
 * its own migration with its own backfill, and doing it inside the audience cutover would put two
 * unrelated risks in one deploy. Exempting it is a DEBT, not an absolution: until that rename, a
 * taco shop stores what it sells under a key called `treatment`.
 */
function stripPropertyNames(code: string): string {
  return code
    .replace(/\.[A-Za-z_$][\w$]*/g, ".")
    .replace(/\b[A-Za-z_$][\w$]*\s*\?\s*:/g, ":")
    .replace(/\b[A-Za-z_$][\w$]*\s*:/g, ":");
}

function hits(code: string): Map<string, number> {
  const scannable = stripPropertyNames(code);
  const found = new Map<string, number>();
  for (const word of BANNED) {
    const m = scannable.match(new RegExp(`\\b${word}\\b`, "gi"));
    if (m?.length) found.set(word, m.length);
  }
  return found;
}

function read(path: string): string | null {
  try {
    return readFileSync(join(process.cwd(), path), "utf8");
  } catch {
    return null;
  }
}

function cutOver(): void {
  console.log("\n1. Files that have been cut over carry no med-spa vocabulary");

  for (const { path, step } of CUT_OVER) {
    const text = read(path);
    if (text === null) {
      check(`${path} exists`, false, "file not found, so the cutover list is stale");
      continue;
    }
    const found = hits(codeOnly(text));
    check(
      `${path} (step ${step})`,
      found.size === 0,
      found.size ? `still says: ${[...found].map(([w, n]) => `${w} x${n}`).join(", ")}` : ""
    );

    // The cut is not just about words. It is about which module owns the answer.
    check(
      `${path} no longer imports @/config/verticals`,
      !/^import[^\n]*@\/config\/verticals/m.test(text),
      "DEFAULT_VERTICAL_ID can reach a client surface again through this import"
    );
  }
}

function pending(): void {
  console.log("\n2. Still to cut over, and what each is waiting on");

  let total = 0;
  for (const { path, step } of PENDING) {
    const text = read(path);
    if (text === null) {
      console.log(`  --    ${path} (not found, list may be stale)`);
      continue;
    }
    const found = hits(codeOnly(text));
    const n = [...found.values()].reduce((a, b) => a + b, 0);
    total += n;
    console.log(
      `  --    ${path.padEnd(44)} ${String(n).padStart(4)} occurrence(s), clears at step ${step}`
    );
  }
  console.log(`        ${total} in total. This number going down is the cutover making progress.`);
}

function presets(): void {
  console.log("\n3. The presets themselves are coherent");

  // Imported lazily so section 1 still runs if the config file has a problem.
  const { AUDIENCE_PRESETS, PRESET_BY_VERTICAL, proposePreset, GENERIC_PRESET_KEY } =
    require("../src/config/audience-presets") as typeof import("../src/config/audience-presets");

  for (const [key, preset] of Object.entries(AUDIENCE_PRESETS)) {
    const missing = [
      !preset.buyer[0] && "buyer singular",
      !preset.buyer[1] && "buyer plural",
      !preset.offer[0] && "offer singular",
      !preset.offer[1] && "offer plural",
      !preset.business && "business",
      !preset.visit && "visit",
    ].filter(Boolean);
    check(`${key} names every noun a generator interpolates`, missing.length === 0, missing.join(", "));
    check(`${key} has a stance`, preset.stance === "patient" || preset.stance === "owner");
  }

  // ‼️ THE THING THAT MAKES SRT NOT A CLINIC.
  check(
    "the agency preset calls the business an agency, not a clinic",
    AUDIENCE_PRESETS.aeo_agency_owner.business === "agency"
  );
  check(
    "and it carries none of the clinical hard lines",
    AUDIENCE_PRESETS.aeo_agency_owner.hardLines.length === 0
  );
  check(
    "the med spa preset carries all three clinical hard lines",
    AUDIENCE_PRESETS.med_spa_patient.hardLines.length === 3
  );
  check(
    "a diner and a patient are the SAME stance, because both buy from the client",
    AUDIENCE_PRESETS.restaurant_diner.stance === AUDIENCE_PRESETS.med_spa_patient.stance
  );
  check(
    "but they do not share a single noun",
    AUDIENCE_PRESETS.restaurant_diner.buyer[0] !== AUDIENCE_PRESETS.med_spa_patient.buyer[0] &&
      AUDIENCE_PRESETS.restaurant_diner.offer[0] !== AUDIENCE_PRESETS.med_spa_patient.offer[0] &&
      AUDIENCE_PRESETS.restaurant_diner.business !== AUDIENCE_PRESETS.med_spa_patient.business
  );
  check(
    "the restaurant is not swept against RealSelf",
    !AUDIENCE_PRESETS.restaurant_diner.presence.includes("realself")
  );
  check(
    "nor is the agency",
    !AUDIENCE_PRESETS.aeo_agency_owner.presence.includes("realself")
  );

  console.log("\n4. proposePreset proposes. It does not decide.");

  const agency = proposePreset("aeo-agency-med-spa");
  check("a mapped vertical resolves unambiguously", agency.unambiguous && agency.presetKey === "aeo_agency_owner");

  // ‼️ THE OWNER_VERTICALS RULE: a closed allowlist, never a substring match.
  const loose = proposePreset("some-other-agency");
  check(
    "a vertical merely CONTAINING 'agency' is not claimed",
    loose.presetKey === GENERIC_PRESET_KEY && !loose.unambiguous,
    `got ${loose.presetKey}`
  );

  const medspa = proposePreset("med-spa");
  check(
    "a real med spa now has a preset, which is the gap this whole table exists to close",
    medspa.unambiguous && medspa.presetKey === "med_spa_patient"
  );
  check(
    "and so does every spelling classify.ts actually emits",
    ["medspa", "medical-spa", "aesthetics-clinic"].every(
      (v) => proposePreset(v).presetKey === "med_spa_patient"
    )
  );

  const casita = proposePreset(null, "taco restaurant and pupuseria");
  check(
    "a business_type reaches the restaurant preset when no vertical is set",
    casita.presetKey === "restaurant_diner"
  );
  check(
    "but NOT unambiguously, so a person still has to press the button",
    !casita.unambiguous
  );

  const nothing = proposePreset(null, null);
  check("an unclassified client decides nothing", nothing.presetKey === GENERIC_PRESET_KEY);
  check("and its reason names the repair", /baseline scan|which buyer/i.test(nothing.reason), nothing.reason);
  check("no preset is returned for GENERIC, so nothing can seed from it", nothing.preset === null);

  console.log("\n5. House rules");
  const presetSrc = read("src/config/audience-presets.ts") ?? "";
  const audiencesSrc = read("src/lib/clients/audiences.ts") ?? "";
  check("no em dash in the presets", !/[—–―]/.test(presetSrc));
  check("no em dash in the reader", !/[—–―]/.test(audiencesSrc));
  check(
    "seedClientAudience is the only thing that imports the presets outside config",
    !new RegExp("audience-presets").test(read("src/lib/clients/client-headlines.ts") ?? ""),
    "a request-time reader importing a preset is how this design becomes verticals.ts again"
  );
}

function main(): void {
  cutOver();
  pending();
  presets();

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
