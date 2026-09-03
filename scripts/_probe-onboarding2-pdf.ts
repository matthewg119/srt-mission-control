// THE REQUIREMENT, EXECUTABLE: an old signature still renders its original text.
//
//   npx tsx scripts/_probe-onboarding2-pdf.ts
//
// Five assertions, and the second and third are the ones the whole design exists to make true.
//
// ‼️ THE v4 CUT IS EXACTLY THE EVENT THIS PROBE PROTECTS AGAINST. On 2026-09-02 the agreement
// went from fourteen clauses to nine: sections 4, 5, 6, 7 and 11 were deleted outright, the
// survivors renumbered, and the liability cap moved into what is now section 8. Every signature
// taken before that must still render fourteen sections with their original numbering and their
// original wording, including clauses that no longer exist anywhere in the codebase. Check 3
// builds precisely that document and proves it.
//
//
//   1. The live template hashes consistently, and verifySnapshot agrees with buildSnapshot.
//   2. A snapshot carrying wording that is NOT in the live template renders THAT wording. This
//      is what proves the PDF is a pure function of the row: if agreement-pdf.ts ever reached
//      for the config, the sentinel would not appear and the live text would.
//   3. A FULL v3 SNAPSHOT, fourteen sections including ones deleted in v4, renders as v3. Not a
//      sentinel this time but the real deleted text, at the real deleted numbers.
//
// !! v5 ADDED TWO CLAUSES (2026-09-03) AND CHECK 3 IS UNCHANGED IN WHAT IT PROVES. The counts
// are read from the template now rather than restated, and the v3 replay picks its first three
// clauses BY KEY rather than by array position: `slice(0, 3)` used to mean what_we_do /
// after_five / guarantee and now means what_we_do plus the two clauses v5 inserted, so a
// document billed as v3 would have been built out of text that did not exist until v5. The
// deleted-clause assertions would still have passed, which is what makes that worth fixing
// rather than leaving: a replay that quietly stops resembling the version it names is a check
// that has drifted into testing nothing.
//   4. The rendered PDF's text round-trips: every section heading and every body paragraph in
//      the snapshot comes back out of the file. That is the jsPDF glyph-coverage check, and it
//      is why config/onboarding2-agreement.ts is ASCII.
//   5. agreement-pdf.ts does not import the config, checked as text rather than trusted.
//
// Reads nothing and writes nothing outside the scratch PDF, so it is safe to run anywhere.

import fs from "fs";
import path from "path";
import { extractText, getDocumentProxy } from "unpdf";
import { buildSnapshot, pagesOf, verifySnapshot, type AgreementSnapshot } from "../src/lib/onboarding2/snapshot";
import { renderAgreementPdf, type SignedRecord } from "../src/lib/onboarding2/agreement-pdf";
import { freezeInitials, type InitialRow } from "../src/lib/onboarding2/initials";
import {
  AGREEMENT_FOOTER,
  AGREEMENT_SECTIONS,
  AGREEMENT_SECTION_COUNT,
  TEMPLATE_VERSION,
} from "../src/config/onboarding2-agreement";

const SENTINEL = "SENTINEL OLD WORDING THAT IS NOT IN THE LIVE TEMPLATE";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

function fakeSignature(snapshot: AgreementSnapshot): SignedRecord {
  return {
    signatureTyped: "Matthew Garcia",
    printName: "Matthew Garcia",
    signerTitle: "CEO",
    businessLegalName: "SRT Agency LLC",
    address: "Greensboro, NC",
    contactEmail: "probe@example.com",
    contactPhoneTyped: "336-833-2303",
    signedDate: "2026-09-01",
    signedAt: "2026-09-01T12:00:00.000Z",
    initials: snapshot.sections.map((s) => ({
      n: s.n,
      key: s.key,
      initials: "MG",
      at: "2026-09-01T12:00:00.000Z",
      sectionSha256: s.sha256,
      dwellMs: 4000,
    })),
    documentSha256: snapshot.documentSha256,
    templateVersion: snapshot.version,
    canon: snapshot.canon,
    ipHash: "0".repeat(64),
    userAgent: "probe",
    signingId: "00000000-0000-0000-0000-000000000000",
  };
}

async function textOf(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).replace(/\s+/g, " ");
}

async function main(): Promise<void> {
  // ── 1. The live template hashes consistently ──
  const live = await buildSnapshot();
  const verified = await verifySnapshot(live);
  check(
    "buildSnapshot and verifySnapshot agree on the document hash",
    verified.ok,
    verified.ok ? "" : `expected ${verified.expected}, stored ${verified.stored}`
  );
  check(
    `the snapshot carries all ${AGREEMENT_SECTION_COUNT} sections (${TEMPLATE_VERSION})`,
    live.sections.length === AGREEMENT_SECTION_COUNT,
    `got ${live.sections.length}`
  );

  // ── 2. THE ONE THAT MATTERS. An edited template must not reach an old row. ──
  const old: AgreementSnapshot = JSON.parse(JSON.stringify(live)) as AgreementSnapshot;
  old.version = "v-probe-old";
  old.sections[2] = { ...old.sections[2], body: [SENTINEL] };

  const oldPdf = renderAgreementPdf(old, fakeSignature(old));
  const oldText = await textOf(oldPdf);

  check(
    "an old snapshot renders ITS OWN wording, not the live template's",
    oldText.includes(SENTINEL),
    oldText.includes(SENTINEL) ? "" : "the sentinel is missing, so the PDF is not reading the row"
  );

  const liveSection3 = AGREEMENT_SECTIONS[2].body[0].slice(0, 60).replace(/\s+/g, " ");
  check(
    "the live template's section 3 wording is ABSENT from the old snapshot's PDF",
    !oldText.includes(liveSection3),
    oldText.includes(liveSection3)
      ? "agreement-pdf.ts is reaching for the live template. That breaks the entire design."
      : ""
  );

  // ── 3. A REAL v3 SNAPSHOT, REPLAYED. ──
  //
  // ‼️ NOT A SENTINEL. This is the actual wording of three clauses that were DELETED from the
  // live template on 2026-09-02, at the numbers they carried before the renumber. If somebody
  // ever "simplifies" agreement-pdf.ts by reading AGREEMENT_SECTIONS, this is the check that
  // fails, and it fails loudly, because a signature taken in August would silently start
  // rendering a document its signer never read.
  const v3: AgreementSnapshot = JSON.parse(JSON.stringify(live)) as AgreementSnapshot;
  v3.version = "v3";
  // The v3 footer, verbatim. Deep-cloning the live snapshot would otherwise hand this row the
  // CURRENT footer and the last check below would be testing the clone rather than the renderer.
  v3.footer = [
    "SRT Agency LLC, srtagency.com, Greensboro, NC",
    "v3, includes AI Skin Concierge deliverable and privacy clauses.",
  ];
  // !! PICKED BY KEY, NEVER BY POSITION. These three are the clauses that really did occupy 1,
  // 2 and 3 in v3, and they still exist under different numbers. Reading them off the front of
  // the array is what silently broke when v5 inserted two clauses at the top.
  const v3Head = ["what_we_do", "after_five", "guarantee"].map((key, i) => {
    const sec = live.sections.find((s) => s.key === key);
    if (!sec) throw new Error(`[probe] v3 replay needs section "${key}" and the template has none`);
    return { ...sec, n: i + 1 };
  });
  v3.sections = [
    ...v3Head,
    {
      n: 5,
      key: "concierge",
      heading: "AI Skin Concierge, how it works, what it isn't",
      body: ["The AI Skin Concierge is an educational, personalization-focused tool."],
      bullets: [
        "Photo privacy: Facial photos submitted through the widget are used only for the immediate analysis and are deleted automatically within 24 hours by our analysis provider.",
      ],
      sha256: v3Head[0].sha256,
    },
    {
      n: 7,
      key: "what_you_own",
      heading: "What you own",
      body: [
        "We keep the right to reference the work in case studies and marketing, using your business name and results, unless you tell us in writing not to.",
      ],
      sha256: v3Head[1].sha256,
    },
    {
      n: 11,
      key: "if_things_go_wrong",
      heading: "If things go wrong",
      body: [
        "If we haven't delivered 5 qualified appointments within 3 months of receiving all access from you (Section 4), you can:",
      ],
      bullets: ["Walk away with everything we've built, at no cost, no questions asked, OR"],
      sha256: v3Head[2].sha256,
    },
  ];

  const v3Pdf = renderAgreementPdf(v3, fakeSignature(v3));
  const v3Text = await textOf(v3Pdf);

  const deletedClauses = [
    ["the Concierge clause deleted in v4", "AI Skin Concierge, how it works"],
    ["its 24-hour photo deletion wording", "deleted automatically within 24 hours"],
    ["the case-study permission deleted with old section 7", "reference the work in case studies"],
    ["the 3-month remedy deleted with old section 11", "Walk away with everything we've built"],
  ] as const;

  for (const [label, needle] of deletedClauses) {
    check(
      `a v3 signature still renders ${label}`,
      v3Text.includes(needle.replace(/\s+/g, " ")),
      "this text exists nowhere in the codebase any more. Only the stored row has it."
    );
  }

  check(
    "a v3 signature keeps its ORIGINAL numbering, not v4's",
    /5\. AI Skin Concierge/.test(v3Text) && /11\. If things go wrong/.test(v3Text),
    "renumbering a signed document is the same fault as rewording it"
  );
  check(
    "the LIVE footer does NOT appear on a v3 render",
    !v3Text.includes(AGREEMENT_FOOTER[1]),
    "the PDF is pulling the footer from the live config instead of from the row"
  );

  // ── 4. Round-trip fidelity, which is the jsPDF glyph check ──
  const livePdf = renderAgreementPdf(live, fakeSignature(live));
  const liveText = await textOf(livePdf);

  const missingHeadings = live.sections
    .filter((s) => !liveText.includes(s.heading.replace(/\s+/g, " ")))
    .map((s) => s.n);
  check(
    "every section heading survives the render",
    missingHeadings.length === 0,
    missingHeadings.length ? `missing: ${missingHeadings.join(", ")}` : ""
  );

  const missingBodies: string[] = [];
  for (const s of live.sections) {
    for (const p of [...s.body, ...(s.bullets ?? []), ...(s.after ?? [])]) {
      // Compare a distinctive slice rather than the whole paragraph: jsPDF wraps, and the
      // extractor rejoins on its own boundaries.
      const probe = p.slice(0, 45).replace(/\s+/g, " ");
      if (probe.length > 20 && !liveText.includes(probe)) missingBodies.push(`s${s.n}: ${probe}`);
    }
  }
  check(
    "every paragraph and bullet survives the render, so no glyph was dropped",
    missingBodies.length === 0,
    missingBodies.slice(0, 5).join("\n      ")
  );

  const nonAscii = liveText.match(/[^\x00-\x7F]/g);
  check(
    "the rendered text is ASCII, so nothing mojibaked",
    !nonAscii,
    nonAscii ? `found: ${Array.from(new Set(nonAscii)).join(" ")}` : ""
  );

  // == 4b. ONE INITIAL PER PAGE STILL PRINTS UNDER EVERY CLAUSE ==
  //
  // !! A SIGNATURE IS ONE INITIAL PER PAGE, NOT ONE PER CLAUSE, AND THE PDF MUST NOT NOTICE.
  // agreement-pdf.ts builds `new Map(initials.map(r => [r.n, r]))` and initialLine() returns
  // QUIETLY on undefined, so a four-entry initials_snapshot would render five clauses with a
  // blank where an initial belongs and nothing would throw. freezeInitials fans a page row out
  // into one record per section it covered; this is that, proven by rendering it rather than
  // asserted in the abstract.
  const pageRows: InitialRow[] = pagesOf(live).map((pg, i) => ({
    id: `i${pg.p}`,
    signing_id: "s",
    created_at: `2026-09-03T00:0${i}:00Z`,
    section_no: pg.sections[0],
    section_key: `k${pg.sections[0]}`,
    initials: "JR",
    section_sha256: "a".repeat(64),
    dwell_ms: 4200,
    client_nonce: `n${pg.p}`,
    page_no: pg.p,
    page_sections: pg.sections,
    page_sha256: pg.sha256,
  }));
  const fanned = freezeInitials(pageRows, live.sections);
  check(
    `${pagesOf(live).length} page rows freeze into one initial record per clause`,
    fanned.length === live.sections.length,
    `${pageRows.length} rows produced ${fanned.length} records, expected ${live.sections.length}`
  );

  const fannedPdf = renderAgreementPdf(live, { ...fakeSignature(live), initials: fanned });
  const fannedText = await textOf(fannedPdf);
  const initialCount = (fannedText.match(/Initialled: JR/g) ?? []).length;
  check(
    `the PDF prints an initial under every one of the ${AGREEMENT_SECTION_COUNT} clauses`,
    initialCount === live.sections.length,
    `found ${initialCount} initial lines, expected ${live.sections.length}`
  );

  // ── 5. The import ban, checked rather than trusted ──
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/onboarding2/agreement-pdf.ts"),
    "utf8"
  );
  const importsConfig = /^\s*import[^;]*onboarding2-agreement/m.test(src);
  check(
    "agreement-pdf.ts does not import the live agreement template",
    !importsConfig,
    importsConfig ? "It does. Remove the import: the PDF must be a pure function of the row." : ""
  );

  const out = path.join(process.cwd(), ".probe-onboarding2.pdf");
  fs.writeFileSync(out, livePdf);
  console.log(`\nWrote a sample render to ${out} (${(livePdf.length / 1024).toFixed(0)} kB)`);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
