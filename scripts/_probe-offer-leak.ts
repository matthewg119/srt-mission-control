// Do the three agreements say only their own terms?
//
//   bun run scripts/_probe-offer-leak.ts
//
// No network, no env, no database. It resolves the three variants and reads their text, so it
// runs in CI and on a cold checkout.
//
// ‼️ THE FAILURE THIS EXISTS TO CATCH IS A CLAUSE LANDING IN THE WRONG DOCUMENT. v6 split one
// agreement into three by listing section keys per variant, and the cost of that shape is that
// adding a key to the wrong array is a one-character mistake with no type error behind it. A
// monthly client whose contract mentions a refund has been promised one.
//
// ‼️ IT ASSERTS ABSENCE, WHICH IS THE ASSERTION THAT ROTS SILENTLY. A test that checks a string
// is present fails loudly when the string moves. A test that checks a string is absent passes
// forever if the thing it was watching gets renamed. So the figures below are IMPORTED from
// config/pitch.ts rather than typed here: rename a price and this probe follows it, instead of
// quietly guarding a number nobody uses any more.

import { agreementFor, type ResolvedAgreement } from "../src/config/onboarding2-agreement";
import {
  GUARANTEE_WINDOW,
  OFFER_KEYS,
  PRICE_CONCIERGE_AMOUNT,
  PRICE_MONTH_AMOUNT,
  PRICE_YEAR_AMOUNT,
  PRICE_YEAR_ANCHOR,
  PRICE_YEAR_EQUIV_AMOUNT,
  REFUND_AMOUNT,
} from "../src/config/pitch";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Every visitor-visible string in one document, lowercased. */
function textOf(doc: ResolvedAgreement): string {
  const parts: string[] = [doc.title, ...doc.preamble, doc.promise, ...doc.closing, ...doc.footer];
  for (const s of doc.sections) {
    parts.push(s.heading, ...s.body, ...(s.bullets ?? []), ...(s.after ?? []));
  }
  return parts.join("\n").toLowerCase();
}

const has = (t: string, needle: string): boolean => t.includes(needle.toLowerCase());

for (const offer of OFFER_KEYS) {
  const doc = agreementFor(offer);
  const t = textOf(doc);
  console.log(`\n--- ${offer}  ${doc.templateVersion}  ${doc.sectionCount} sections, ${doc.pageCount} pages`);

  // ── Structure, true of every variant ──
  const keys = doc.sections.map((s) => s.key);
  check("section keys are unique", new Set(keys).size === keys.length, keys.join(", "));
  check("clause numbers run 1..N with no gap", doc.sections.every((s, i) => s.n === i + 1));
  check("pages run 1..P with no gap", doc.pages.every((p, i) => p.p === i + 1));
  check(
    "every clause sits on the page its layout put it on",
    doc.pages.every((p) => p.sections.every((s) => s.page === p.p))
  );
  check("no clause is orphaned off a page", doc.pages.flatMap((p) => p.sections).length === doc.sectionCount);

  // ── The photo disclosure, wherever the widget is described ──
  //
  // ‼️ THIS IS THE ONLY SENTENCE IN THE DOCUMENT THAT SAYS WHAT HAPPENS TO A PHOTOGRAPH OF
  // SOMEBODY'S FACE. It lived in a section that was deleted in v4 and survived by moving into a
  // bullet. If a variant describes the Concierge at all, it says this too.
  const describesWidget = has(t, "ai skin concierge");
  if (describesWidget) {
    check("the Concierge photo disclosure is present", has(t, "deleted within 24 hours"));
  }

  if (offer === "year_3300") {
    for (const fig of [PRICE_YEAR_AMOUNT, PRICE_YEAR_EQUIV_AMOUNT, REFUND_AMOUNT, GUARANTEE_WINDOW]) {
      check(`yearly states ${fig}`, has(t, fig));
    }
    check("yearly states the qualified-appointment test", has(t, "qualified appointment"));
    check("yearly promises the refund", has(t, "first 3 months back"));
    check(`yearly never quotes the monthly price ${PRICE_MONTH_AMOUNT}`, !has(t, PRICE_MONTH_AMOUNT));
  }

  if (offer === "month_349") {
    check(`monthly states ${PRICE_MONTH_AMOUNT}`, has(t, PRICE_MONTH_AMOUNT));
    check(
      `monthly prices the Concierge separately at ${PRICE_CONCIERGE_AMOUNT}`,
      has(t, PRICE_CONCIERGE_AMOUNT)
    );

    // ‼️ THE CORE ASSERTION OF THIS FILE. Every one of these belongs to the yearly plan and none
    // of them may appear in a document that carries no guarantee.
    for (const fig of [PRICE_YEAR_AMOUNT, PRICE_YEAR_ANCHOR, PRICE_YEAR_EQUIV_AMOUNT, REFUND_AMOUNT]) {
      check(`monthly never mentions ${fig}`, !has(t, fig));
    }
    check(`monthly never mentions the ${GUARANTEE_WINDOW} window`, !has(t, GUARANTEE_WINDOW));
    check("monthly never mentions a qualified appointment", !has(t, "qualified appointment"));
    check("monthly never promises months back", !has(t, "months back"));

    // ‼️ "guarantee" and "refund" DO appear, and they have to. The monthly plan states its own
    // absence out loud rather than leaving a buyer to notice it after signing, so the assertion
    // is about WHAT IS SAID, not about the word being missing. Checking for the bare word would
    // fail on the honest sentence and pass on silence, which is backwards.
    check(
      "monthly states it has no guarantee and no refunds",
      has(t, "no performance guarantee and no refunds")
    );
    check("monthly never promises a guarantee", !/\bwe (will|guarantee)\b.*\bguarantee\b/.test(t));
  }

  if (offer === "review_free") {
    check("free is one page", doc.pageCount === 1 && doc.sectionCount === 1);
    for (const fig of [PRICE_YEAR_AMOUNT, PRICE_MONTH_AMOUNT, REFUND_AMOUNT, PRICE_CONCIERGE_AMOUNT]) {
      check(`free quotes no price, so never ${fig}`, !has(t, fig));
    }
    check("free says there is no guarantee attached", has(t, "no guarantee attached"));
    check("free says either side can stop", has(t, "stop at any time"));
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nAll clean.");
process.exit(failures ? 1 : 0);
