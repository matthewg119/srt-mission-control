// What the widget teaches while the audit runs.
//
// The scan takes about three minutes, and until now that wait was one bubble and a progress bar. This
// fills it with the three things the report is about to score, so somebody who waits it out understands
// what they are about to read.
//
// ‼️ IT TEACHES AND IT DOES NOT SELL. The sell comes after the report, where there is a finding to sell
// against. A pitch in the wait is a pitch made before we know anything about them, which is the one
// thing this lane has no business doing: three minutes earlier we were handed a domain and nothing else.
//
// ‼️ DETERMINISTIC, IN ONE PLACE, AND NOT GENERATED. Same rule as the opener in engine.ts and the walk in
// referral-script.ts. A model call per audit is a bill per visitor for words nobody read first, and this
// is the part of the conversation where the model knows least: the scan has not finished.
//
// ‼️ THESE ARE NOT THE LOOM'S PILLARS, AND THEY MUST NOT BE COPIED FROM THERE. loomPillars() in
// audit-engine/loom-script.ts is four-beat sales copy with a named competitor and a customer story in
// it, written to be spoken over a finished report by a person who has read it. These are two sentences
// each, in front of a stranger, before anything is known. The ideas are the same three; the job is not.
//
// ‼️ AND FINDABLE, FAMILIAR AND FRESH ARE NOT SCORES. They exist nowhere in the data: audit_reports
// carries one aggregate `score`, and the only per-dimension breakdown that exists is the audit BLOCK
// (MARCA / SERVICIO / INFO / COMPARATIVO). So nothing here may promise a number per pillar, because the
// report will not contain one. Naming what is about to be measured is fine; implying a scorecard shape
// the report does not have would be a lie the report itself exposes ninety seconds later.

import { guard } from "@/lib/copy-guard";

export interface WaitCard {
  /** The pillar's name, as the report and the call both say it. */
  title: string;
  /** One or two sentences. Plain, no jargon, no pitch. */
  body: string;
}

/**
 * The three cards, in the order the report thinks about them.
 *
 * Findable first because it is the one people think they already have from Google, and the surprise is
 * the hook that makes the other two land.
 */
export const AUDIT_WAIT_CARDS: WaitCard[] = [
  {
    title: guard("wait findable title", "Findable"),
    body: guard(
      "wait findable",
      "Google shows twenty results and lets you pick. An assistant names about three and stops, so " +
        "being first on Google and being named by an assistant are different problems."
    ),
  },
  {
    title: guard("wait familiar title", "Familiar"),
    body: guard(
      "wait familiar",
      "Assistants lean on what other people say about you more than on what you say about yourself. " +
        "Reviews, directories and mentions are what they read to decide whether you are a safe answer."
    ),
  },
  {
    title: guard("wait fresh title", "Fresh"),
    body: guard(
      "wait fresh",
      "A page written last year answers last year's question. Assistants prefer the source that " +
        "answers the exact thing that was asked, in the words it was asked in."
    ),
  },
];

/**
 * How long each card stays up, in milliseconds.
 *
 * ‼️ THIRTY SECONDS, WHICH IS LONG ENOUGH TO READ TWICE AND SHORT ENOUGH TO NOTICE IT CHANGED. The scan
 * runs about three minutes, so three cards fill roughly half of it and the last one stays up for the
 * rest rather than looping. A visitor who has read all three does not need them again; a rotation that
 * came back round would read as a carousel, which is furniture rather than teaching.
 */
export const WAIT_CARD_MS = 30_000;

/** How long after the progress bar appears the first card does. Long enough not to arrive on top of it. */
export const WAIT_FIRST_MS = 2_500;
