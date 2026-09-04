// Render the CURRENT agreement as an unsigned counterpart, for wet signature on a call.
//
//   npx tsx scripts/_render-agreement-blank.ts [outPath]
//
// Default out: C:/Users/matth/Desktop/SRT-Onboarding-Agreement-<version>.pdf
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

async function main(): Promise<void> {
  const snapshot = await buildSnapshot();

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
    process.argv[2] ||
    `C:/Users/matth/Desktop/SRT-Onboarding-Agreement-${snapshot.version}.pdf`;
  writeFileSync(out, pdf);

  console.log(`Wrote ${out}`);
  console.log(`  version   ${snapshot.version}`);
  console.log(`  sections  ${snapshot.sections.length}`);
  console.log(`  pages     ${snapshot.pages?.length ?? "(none frozen)"}`);
  console.log(`  sha256    ${snapshot.documentSha256}`);
  console.log(`  bytes     ${pdf.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
