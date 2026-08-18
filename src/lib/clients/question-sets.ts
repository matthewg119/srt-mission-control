// universal_v1 and materialization_v1. Amendment A2 D-P15.
//
// ‼️ THESE TWENTY ARE THE 20 QUESTIONS PDF, CHARACTER FOR CHARACTER, AND THAT IS THE POINT.
// A2 §4: "the tracked set must be the questions the public actually received, because Beat 11
// says so on camera — 'the twenty in the PDF are the ones everybody's patients ask'." If the
// shipped PDF's wording ever diverges from this, the SHIPPED wording wins and A2 gets a v2.
//
// ‼️ THE FALLBACK SET IN docs/specs/SRT-Question-Sets-v1.md IS RETIRED. It is keyword-shaped
// ("best med spa in {city}") where these are full natural-language questions, and it uses
// variables materialization_v1 does not define. It is kept in that file only as the diff A2
// anticipated. Nothing may seed universal_v1 from it.
//
// These live in code as the SOURCE, and are frozen into question_set_versions as a ROW at
// first use — A2 §6 is explicit that a code constant alone is not enough, because defending
// a case study in two years means showing the exact text that ran, and a constant in a file
// edited forty times since cannot do that.

import { supabaseAdmin } from "@/lib/db";

export const UNIVERSAL_V1_MED_SPA: readonly string[] = [
  "What's the best med spa near me for [Botox / filler / laser]?",
  "Who does the best lip filler in [city]?",
  "Where should I go for laser hair removal in [city] if I have sensitive skin?",
  "What's a reputable med spa in [city] for a first-timer?",
  "Which med spas in [city] have the best reviews for [treatment]?",
  "Is [treatment] safe, and how do I find a qualified provider near me?",
  "How do I know if a med spa is legit / has licensed injectors?",
  "What should I look for in a med spa before booking?",
  "Has anyone had a bad experience with [treatment], and how do I avoid it?",
  "Which med spas in [city] are run by nurses or doctors?",
  "How much does [Botox / filler / etc.] cost in [city]?",
  "What's the average price for [treatment] near me?",
  "Which med spa in [city] has the best value for [treatment]?",
  "Are there any deals or membership plans for [treatment] in [city]?",
  "Compare [Clinic A] vs [Clinic B] in [city].",
  "Book me a consultation for [treatment] near me.",
  "What med spa in [city] specializes in [specific concern — e.g., melasma, acne scars]?",
  "Who's the best injector for natural-looking results in [city]?",
  "Which med spa near me offers [specific device / brand — e.g., Morpheus8, CoolSculpting]?",
  "I had a bad experience with laser before — who in [city] is gentle and experienced with nervous patients?",
];

/** Questions 7, 8 and 9 carry no location in the text, so materialization prefixes one. */
const NEEDS_LOCATION_PREFIX = new Set([7, 8, 9]);

export interface Substitutions {
  city: string;
  state: string;
  treatmentPrimary: string;
  clientName: string;
  competitorIntake1: string;
  concern: string;
  devicePrimary: string;
}

/** A2 §4's fallbacks, and the fidelity footer has to say when one was used. */
export const MATERIALIZATION_FALLBACKS = {
  concern: "melasma",
  devicePrimary: "Morpheus8",
} as const;

/**
 * materialization_v1: the ONLY things that change per tenant are the bracketed placeholders.
 *
 * Everything else runs verbatim, including "med spa", "injector" and "laser". A2 is explicit
 * about that: the question shapes are the public's, not ours, and rewording one to sound
 * better makes it a different question with its own baseline.
 */
export function materialize(question: string, i: number, s: Substitutions): string {
  const where = `${s.city}, ${s.state}`;

  let out = question
    // Longest patterns first, or "[treatment]" would eat the inside of the compound ones.
    .replace(/\[Botox \/ filler \/ laser\]/g, s.treatmentPrimary)
    .replace(/\[Botox \/ filler \/ etc\.\]/g, s.treatmentPrimary)
    .replace(/\[specific concern — e\.g\., melasma, acne scars\]/g, s.concern)
    .replace(/\[specific device \/ brand — e\.g\., Morpheus8, CoolSculpting\]/g, s.devicePrimary)
    .replace(/\[Clinic A\]/g, s.clientName)
    .replace(/\[Clinic B\]/g, s.competitorIntake1)
    .replace(/\[treatment\]/g, s.treatmentPrimary)
    .replace(/\[city\]/g, where)
    .replace(/near me/g, `near ${where}`);

  if (NEEDS_LOCATION_PREFIX.has(i + 1)) {
    out = `I'm in ${where}. ${out}`;
  }

  return out;
}

export function materializeAll(s: Substitutions): string[] {
  return UNIVERSAL_V1_MED_SPA.map((q, i) => materialize(q, i, s));
}

/**
 * Freeze the set as a row, once.
 *
 * Idempotent on the primary key: a version that exists is never rewritten, because "never
 * edited in place" is the entire contract of a frozen set. A change is a new version.
 */
export async function freezeUniversalV1(): Promise<void> {
  const { error } = await supabaseAdmin.from("question_set_versions").upsert(
    {
      version: "universal_v1@med_spa",
      vertical: "med_spa",
      questions: UNIVERSAL_V1_MED_SPA,
      materialization: "materialization_v1",
      note:
        "The 20 Questions PDF verbatim (A2 D-P15). The fallback set in " +
        "docs/specs/SRT-Question-Sets-v1.md is retired and must not seed this.",
    },
    { onConflict: "version", ignoreDuplicates: true }
  );

  if (error) throw new Error(`freezing universal_v1 failed: ${error.message}`);
}
