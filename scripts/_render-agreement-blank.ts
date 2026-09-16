// Render the CURRENT agreements as unsigned counterparts, for wet signature on a call.
//
//   npx tsx scripts/_render-agreement-blank.ts                  all three
//   npx tsx scripts/_render-agreement-blank.ts year_3300        just one
//   npx tsx scripts/_render-agreement-blank.ts year_3300 out.pdf
//
// Default out: C:/Users/matth/Desktop/SRT-Onboarding-Agreement-<version>.pdf
//
// ‼️ THREE DOCUMENTS SINCE 2026-09-16, AND RUNNING IT BARE WRITES ALL OF THEM. The offer is
// picked in the funnel and decides which agreement a client signs, so a counterpart carried to a
// call has to be the right one of three. Writing all three by default is the safe shape: the
// failure mode of printing a spare is a wasted sheet, and the failure mode of printing the wrong
// one is a client signing terms nobody quoted them.
//
// ‼️ review_free IS RENDERED TOO, AND IT IS NOT A CONTRACT. It is the one page of service terms
// the free plan freezes so onboarding2_signings.agreement_snapshot has something honest in it.
// Nobody signs it and nobody is shown it. It is rendered here only so the terms can be read by a
// human who wants to know what that row contains.
// Forward slashes on purpose: node accepts them on Windows, and a backslash in a TS template
// literal is an escape sequence that silently eats the separator.
//
// ‼️ IT GOES THROUGH buildSnapshot(), NOT THROUGH THE TEMPLATE DIRECTLY, and that is deliberate.
// buildSnapshot() is the only sanctioned reader of config/onboarding2-agreement.ts, and it is
// what stamps the version, the canonical form and the document SHA-256. Reading the template
// here instead would produce a PDF whose footer hash was computed by a second, parallel path
// that could drift from the one every real signing uses.
//
// ‼️ THIS DOES NOT CREATE A SIGNING ROW AND MUST NOT. A signature taken on paper from this
// counterpart has no session token, no page initials, no hashed IP and no server timestamp. It
// is a paper contract, and the PDF says so on its last page. If e-signature comes back, it comes
// back through /api/onboarding2/sign, not through a scan of this.

import { writeFileSync } from "node:fs";
import { renderAgreementPdf, type SignedRecord } from "../src/lib/onboarding2/agreement-pdf";
import { buildSnapshot } from "../src/lib/onboarding2/snapshot";
import { OFFER_KEYS, isOfferKey, type OfferKey } from "../src/config/pitch";

async function render(offer: OfferKey, outPath?: string): Promise<void> {
  const snapshot = await buildSnapshot(offer);

  // Every field empty, and `initials: []` so initialLine() returns early on every section.
  // The three provenance fields are still passed through because the footer prints the version
  // and the hash on every page: a blank counterpart is traceable to the template it came from
  // even though it is traceable to no signing.
  const blankRecord: SignedRecord = {
    signatureTyped: "",
    printName: "",
    signerTitle: null,
    businessLegalName: "",
    address: "",
    contactEmail: "",
    contactPhoneTyped: null,
    signedDate: null,
    signedAt: null,
    initials: [],
    documentSha256: snapshot.documentSha256,
    templateVersion: snapshot.version,
    canon: snapshot.canon,
    ipHash: null,
    userAgent: null,
    signingId: "",
  };

  const pdf = renderAgreementPdf(snapshot, blankRecord, { blank: true });

  const out =
    outPath || `C:/Users/matth/Desktop/SRT-Onboarding-Agreement-${snapshot.version}.pdf`;
  writeFileSync(out, pdf);

  console.log(`Wrote ${out}`);
  console.log(`  offer     ${offer}`);
  console.log(`  version   ${snapshot.version}`);
  console.log(`  sections  ${snapshot.sections.length}`);
  console.log(`  pages     ${snapshot.pages?.length ?? "(none frozen)"}`);
  console.log(`  sha256    ${snapshot.documentSha256}`);
  console.log(`  bytes     ${pdf.length}`);
}

async function main(): Promise<void> {
  const first = process.argv[2];

  // ‼️ AN UNRECOGNISED FIRST ARGUMENT IS AN ERROR, NOT AN OUTPUT PATH. Treating it as a path
  // would mean `_render-agreement-blank.ts yearly` (a plausible typo for year_3300) silently
  // writing all three documents to a file called "yearly", and the operator carrying whichever
  // one landed last to a call.
  if (first && !isOfferKey(first)) {
    console.error(`Unknown offer "${first}". One of: ${OFFER_KEYS.join(", ")}`);
    process.exit(1);
  }

  if (first) {
    await render(first as OfferKey, process.argv[3]);
    return;
  }

  for (const offer of OFFER_KEYS) await render(offer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
