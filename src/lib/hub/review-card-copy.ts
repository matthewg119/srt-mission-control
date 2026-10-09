// What a QR card says. ONE COPY OF IT, READ BY THE PRINTER AND BY THE PREVIEW.
//
// ‼️ THESE STRINGS USED TO LIVE AS LITERALS INSIDE jsPDF CALLS IN
// src/lib/clients/artifacts/review-card.ts, WHICH WAS FINE WHILE EXACTLY ONE THING DREW A CARD.
// /cards/p now draws the same card on screen so a clinic can look at it before it is printed, and
// a screen that says something slightly different from the card stock is worse than no screen at
// all: they approve one object and a different one arrives in the post.
//
// ‼️ THE RULE THIS FILE SERVES IS review-card.ts's, VERBATIM: "VISUAL THEME PER CLIENT. COPY
// IDENTICAL FOR EVERY CLIENT. FOREVER." There is no per-client wording hook here and there must
// not be one. The three designs in src/config/card-designs.ts change the palette and the layout
// and read every word from this file.
//
// ‼️ IT IMPORTS NOTHING BUT review-script AND copy-guard, SO IT IS SAFE IN A BROWSER BUNDLE.
// That is the whole reason it is here and not in artifacts/, which reaches supabaseAdmin and
// jspdf. review-script.ts imports one TYPE and nothing else, by its own design.
//
// WHAT IS DELIBERATELY ABSENT, each one a rule rather than an omission: no "if you loved your
// visit", no sentiment pre-screen, no stars, no staff names, no incentive, no gift. EVERY PATIENT
// GETS THE SAME CARD, and that is the sentence the others all serve.

import { guard } from "@/lib/copy-guard";
import { CARD_QUESTIONS, QUESTION_COUNT_WORD } from "./review-script";

/**
 * How many questions the card promises, as a word.
 *
 * ‼️ DERIVED, BECAUSE THE CARD IS PRINTED AND THE WALK IS NOT. A hardcoded number is a stack of
 * card stock in a clinic promising something the page does not do, and card stock cannot be
 * redeployed. review-card.ts kept its own COUNT_WORDS list for this; two derivations of one fact
 * is one derivation too many, so it reads this now. The only value that ever differed between the
 * two lists was index 0, and a card with no questions on it is not a state that exists.
 */
export const CARD_QUESTION_COUNT = QUESTION_COUNT_WORD;

/** How many there actually are, for anything that needs the integer rather than the word. */
export const CARD_QUESTION_TOTAL = CARD_QUESTIONS.length;

export const REVIEW_CARD_COPY = {
  /** Under the clinic's name, in the accent. The whole promise of the card, in three facts. */
  promise: guard(
    "card promise",
    `${CARD_QUESTION_COUNT} questions. Ninety seconds. Your words.`
  ),
  /**
   * Under the code.
   *
   * ‼️ "when you are home" IS LOAD BEARING AND IS NOT A TONE CHOICE. A card answered at the
   * counter, in front of the person who treated her, is a review given under observation. The
   * whole design of this tool is that she scans it later, on her own phone, with nobody watching.
   */
  scanLine: guard("card scan line", "Scan when you are home."),
  /** The heading over the questions on the back. */
  backHeading: guard("card back heading", `${CARD_QUESTION_COUNT} questions`),
  /** The two lines that close the back, in order. */
  ownWords: guard("card own words", "Answer in your own words."),
  notPosted: guard("card not posted", "Nothing is posted unless you post it."),
} as const;
