// One spelling for a vertical, applied at the single writer.
//
// ‼️ THIS IS THE FIX audience-presets.ts AND question-sets.ts BOTH SAY IS OWED. Their words:
// "normalising at adoptAuditClassification, the single writer, is the real one and is owed
// separately." Until now each reader carried its own list of spellings a model might have typed,
// which is how question-sets.ts came to test `vertical === "med_spa"` against a snake_case literal
// classify.ts:58 is instructed never to emit. Every real med spa missed all three of its branches
// and both fidelity footers printed "not frozen" for every client that ever onboarded.
//
// ‼️ A FACT ABOUT THE STRING, NEVER A CLAIM ABOUT THE BUSINESS. This is the same line service.ts
// draws and it is the reason this file is twenty lines instead of a synonym table:
//
//     "Squashing punctuation is a fact about the string. Deciding 'medical-aesthetics' and
//      'medspa' are one market is a claim about the business, and if it is wrong this starts
//      naming a day spa's rivals to a med spa as measured fact."
//
// So `Med_Spa` and `MED SPA` both become `med-spa`, because those are the same word typed
// differently. `medspa` and `aesthetics-clinic` are NOT collapsed here even though both mean a med
// spa, because that is a judgement somebody has to sign off on. Those live in PRESET_BY_VERTICAL,
// which is a closed allowlist a person reviews, and in service-synonyms.ts, where every merge
// carries the measurement that justified it.
//
// The practical consequence: an allowlist no longer has to anticipate CASE or SEPARATOR, only
// genuinely different words.

/** The shape classify.ts is told to emit: "short kebab-case, e.g. `trt`, `medical-supply`". */
export function normalizeVerticalSlug(v: string | null | undefined): string | null {
  const s = (v ?? "")
    .trim()
    .toLowerCase()
    // Any run of separator-ish characters becomes one hyphen. Underscores are the spelling that
    // caused the original bug; spaces are what a person types when they set one by hand.
    .replace(/[\s_/\\.]+/g, "-")
    // Anything that is not a kebab character cannot be part of a slug. Dropped rather than
    // hyphenated, so "med spa (clinic)" does not become "med-spa--clinic-".
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length ? s : null;
}

/**
 * The same rule for `business_type`, which is free text rather than a slug.
 *
 * ‼️ NOT SLUGGED. business_type is prose the classifier wrote ("family dental practice") and the
 * BUSINESS_TYPE_LADDER regexes read it as prose. Hyphenating it would break every one of those
 * patterns, which match on words with spaces between them. Only the case and the edge whitespace
 * are touched, because those are the only things that vary without meaning anything.
 */
export function normalizeBusinessType(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return s.length ? s : null;
}
