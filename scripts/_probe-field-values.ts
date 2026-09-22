// W0 + W2b, offline. Proves the round trip the prompt demands and the guards that keep the
// corpus clean.
//
// ‼️ THE ROUND TRIP IS THE ONE THAT MATTERS. The 2026-09-23 prompt states it: "Whatever numbering
// it emits, the parser that reads the file back must map every answer to the same key the asker
// used, and the probe should prove one round trip." That risk got sharper when Matthew decided the
// twenty-page prompt REPLACES the per-batch one, because the asker's numbering then changes
// wholesale rather than being appended to. A subset renumbered from 1 files section twelve's
// answer under section one, silently and permanently.
//
//   bun run scripts/_probe-field-values.ts        (offline: no DB, no key, no network)

import { parseResearchSections, sectionAnswered } from "../src/lib/clients/avatar-profile";
import { DATASET_FIELDS, NOTHING_ON_FILE, evaluateDatasets, formatDatasetReport } from "../src/lib/clients/dataset-spec";
import { RESEARCH_SECTION_KEYS } from "../src/lib/clients/artifacts/deep-research-run";
import { evidenceRowsFor, formatProposalCard, type OpenProposal } from "../src/lib/clients/field-proposal";
import { readExtraction, looksUnverified } from "../src/lib/clients/field-extraction";
import { refuseValues, formatValuesCard } from "../src/lib/clients/field-values";
import { evidenceForPage, isFirstParty, type PageSource, type SourceType } from "../src/lib/clients/page-evidence";
import { readFileSync } from "fs";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
}

const src = (p: string) => readFileSync(p, "utf8");

// ─── 1. The round trip ────────────────────────────────────────────────────────
console.log("\n1. the asker's numbering survives the parser");

// A report whose sections are NOT 1..n, which is the case that breaks a naive parser: the
// twenty-page prompt emits a subset, and buildGapPrompt keeps each section's ORIGINAL number.
const REPORT = [
  "## 3. Who buys",
  "x".repeat(200),
  "",
  "## 7. What they fear",
  "y".repeat(200),
  "",
  "## 12. What they already pay for",
  "z".repeat(200),
].join("\n");

const parsed = parseResearchSections(REPORT);
check("three sections parse", parsed.length === 3, String(parsed.length));
check(
  "and they keep the numbers the asker used, not 1 2 3",
  parsed.map((s) => s.number).join(",") === "3,7,12",
  parsed.map((s) => s.number).join(",")
);

// This is the assertion. The document the extractor hands the model is rebuilt from the parsed
// sections, so if the rebuild renumbered, an answer citing "section 3" would come back pointing at
// a different section than the one it was read from.
const rebuilt = parsed.map((s) => `## ${s.number}. ${s.title}\n${s.body}`).join("\n\n");
const reparsed = parseResearchSections(rebuilt);
check(
  "‼️ a full round trip maps every answer to the same key the asker used",
  reparsed.map((s) => s.number).join(",") === parsed.map((s) => s.number).join(","),
  `${parsed.map((s) => s.number)} -> ${reparsed.map((s) => s.number)}`
);
check(
  "and the bodies survive it too",
  reparsed.every((s, i) => s.body.trim() === parsed[i].body.trim())
);

// ─── 2. What "present" used to mean, and what it means now ────────────────────
console.log("\n2. present() stops being a character count");

check(
  "a 150-character section still counts, so nothing pasted before this reads as missing",
  sectionAnswered({ number: 1, title: "t", body: "a".repeat(150) })
);
check("a stub does not", !sectionAnswered({ number: 1, title: "t", body: "short" }));
check(
  "and a section that only says it could not verify is an honest non-answer",
  !sectionAnswered({ number: 1, title: "t", body: "could not verify. ".repeat(20) })
);

const empty = evaluateDatasets(NOTHING_ON_FILE, RESEARCH_SECTION_KEYS);
check("with nothing on file, nothing is backed by a value", empty.every((r) => r.backedByValue === 0));

// ‼️ THE CHECK THAT PROVES THE FIX. A confirmed value makes a field present with no research at
// all, which is what "present means a value exists" has to mean.
const withValue = evaluateDatasets(
  { ...NOTHING_ON_FILE, fieldValues: ["who_buys", "beliefs"] },
  RESEARCH_SECTION_KEYS
);
const avatar = withValue.find((r) => r.dataset === "avatar");
check("a confirmed value makes a field present with no research at all", (avatar?.backedByValue ?? 0) === 2, String(avatar?.backedByValue));
check(
  "and it is counted as present, not just as backed",
  (avatar?.present ?? 0) >= 2 && !avatar?.gaps.some((g) => g.field.key === "who_buys")
);

const card = formatDatasetReport("Test", true, withValue, true).join("\n");
check("the card says how many are backed by a confirmed value", /backed by a confirmed value/.test(card), card.slice(0, 160));
// ‼️ NOT "a character count". Only a research-filled field's present() is a character count; an
// audit-filled or step-filled one is present for a reason that has nothing to do with length, and
// the first version of this card called those character counts too.
check("and does not claim everything unbacked is a character count", !/character count/.test(card));
check(
  "a dataset where the two numbers agree says nothing, so a clean client is not nagged",
  !/backed by a confirmed value/.test(
    formatDatasetReport(
      "Test",
      true,
      [{ dataset: "avatar", total: 2, present: 2, backedByValue: 2, gaps: [] }],
      true
    ).join("\n")
  )
);

// ─── 3. The guards that keep the corpus clean ─────────────────────────────────
//
// ‼️ THESE RUN THE CODE. They used to read this file's own source with a regex, which proves a
// string is present and nothing else: every one of them would have passed just as happily with the
// matched text sitting in a comment, and none of them would have noticed the guard being deleted
// from the branch it protects. readExtraction and refuseValues are pure for exactly this.
console.log("\n3. an absence and a guess are different facts");

const SPECS = DATASET_FIELDS.slice(0, 4);
const [F_HIGH, F_LOW, F_UNSURE, F_UNVERIFIED] = SPECS;

const graded = readExtraction(
  {
    fields: [
      { field_key: F_HIGH.key, status: "answered", value: "a real answer", section: 3, confidence: "high" },
      { field_key: F_LOW.key, status: "answered", value: "a shaky answer", section: 4, confidence: "low" },
      { field_key: F_UNSURE.key, status: "unsure", question: "which is it?", because: "two readings" },
      { field_key: "not_a_declared_field", status: "answered", value: "invented", confidence: "high" },
    ],
  },
  SPECS
);

check("a high-confidence answer becomes a value", graded.proposed.some((p) => p.fieldKey === F_HIGH.key));
check(
  "‼️ a low-confidence answer becomes a QUESTION and never a value",
  graded.questions.some((q) => q.fieldKey === F_LOW.key) &&
    !graded.proposed.some((p) => p.fieldKey === F_LOW.key)
);
check("an explicit 'unsure' becomes a question too", graded.questions.some((q) => q.fieldKey === F_UNSURE.key));
check(
  "no proposed value ever carries low confidence",
  graded.proposed.every((p) => p.confidence !== "low")
);
check(
  "a key nobody asked for is dropped rather than proposed",
  !graded.proposed.some((p) => p.fieldKey === "not_a_declared_field") &&
    !graded.questions.some((q) => q.fieldKey === "not_a_declared_field")
);
check("a field the model never mentioned is reported unanswered", graded.unanswered.includes(F_UNVERIFIED.key));

// ‼️ THE REPORT'S OWN "I COULD NOT CHECK THIS" MARKER. Both halves: the model saying so with
// verified:false, and the inline tag the model may have copied through without noticing.
const unver = readExtraction(
  {
    fields: [
      { field_key: F_HIGH.key, status: "answered", value: "84 to 89 percent of buyers", section: 2, confidence: "high", verified: false },
      { field_key: F_LOW.key, status: "answered", value: "[UNVERIFIED] owners pay monthly", section: 3, confidence: "high" },
      { field_key: F_UNSURE.key, status: "answered", value: "SIN VERIFICAR: nadie confirmo esto", section: 4, confidence: "high" },
      { field_key: F_UNVERIFIED.key, status: "answered", value: "owners are probably price sensitive", section: 5, confidence: "high" },
    ],
  },
  SPECS
);
check(
  "‼️ a claim the model marks unverified is a question, not a value",
  unver.questions.some((q) => q.fieldKey === F_HIGH.key) && !unver.proposed.some((p) => p.fieldKey === F_HIGH.key)
);
check(
  "‼️ an inline [UNVERIFIED] tag is caught even when the model forgot the flag",
  unver.questions.some((q) => q.fieldKey === F_LOW.key) && !unver.proposed.some((p) => p.fieldKey === F_LOW.key)
);
check("a SIN VERIFICAR line is caught too, because the research is written in Spanish", unver.questions.some((q) => q.fieldKey === F_UNSURE.key));
check(
  "and ordinary hedged prose is still a value, because this is not a hedge detector",
  unver.proposed.some((p) => p.fieldKey === F_UNVERIFIED.key),
  "'probably' must not turn a finding into a question"
);
check(
  "the unverified question says the REPORT could not verify it, not that the model was unsure",
  unver.questions.every((q) => /could not verify/i.test(q.because))
);

// ‼️ CITATIONS: the URL rule and the unverified rule, both driven rather than grepped.
const cited = readExtraction(
  {
    fields: [],
    citations: [
      { claim: "a real sourced claim", source_url: "https://example.com/a", section: 2 },
      { claim: "no url at all", source_url: "", section: 2 },
      { claim: "not a url", source_url: "example.com/b", section: 2 },
      { claim: "", source_url: "https://example.com/c", section: 2 },
      { claim: "[UNVERIFIED] a sourced claim the report disowns", source_url: "https://example.com/d", section: 2 },
    ],
  },
  SPECS
);
check("‼️ exactly one citation survives: the one with a real http URL and a claim", cited.citations.length === 1, JSON.stringify(cited.citations));
check("and it is the sourced one", cited.citations[0]?.sourceUrl === "https://example.com/a");
check(
  "‼️ a URL does not rescue a claim the report says it could not verify",
  !cited.citations.some((c) => /UNVERIFIED/i.test(c.content))
);

check("looksUnverified refuses plain confident prose", !looksUnverified("owners want more patients"));
check("looksUnverified catches [INFERRED]", looksUnverified("[INFERRED] they book on Instagram"));

// ‼️ THE LAST GUARD BEFORE THE ONE WRITE THAT CAN POISON EVERY PAGE. Driven, not grepped.
check(
  "refuseValues turns away an undeclared field key",
  Boolean(refuseValues([{ fieldKey: "not_a_declared_field", dataset: "avatar", value: "x", sourceSection: 1, confidence: "high" }]))
);
check(
  "refuseValues turns away a low-confidence value, as a second guard",
  Boolean(refuseValues([{ fieldKey: F_HIGH.key, dataset: F_HIGH.dataset, value: "x", sourceSection: 1, confidence: "low" }]))
);
check(
  "and it passes a declared, confident value",
  refuseValues([{ fieldKey: F_HIGH.key, dataset: F_HIGH.dataset, value: "x", sourceSection: 1, confidence: "high" }]) === null
);

const vals = src("src/lib/clients/field-values.ts");
check(
  "‼️ the write goes through the RPC, because a confirmation is two statements",
  /rpc\("commit_field_values"/.test(vals)
);
check(
  "and it says which migration is missing rather than failing opaquely",
  /2026-09-24-commit-field-values-fn\.sql/.test(vals)
);

// ─── 4. W2b: the research reaches the gate, on the confirm ────────────────────
console.log("\n4. the same press files the evidence");

const withCites: OpenProposal = {
  id: "p1",
  clientId: "c1",
  audienceId: "a1",
  sourceDocumentId: "d1",
  proposed: [],
  questions: [],
  unanswered: [],
  citations: [
    { content: "a sourced claim", sourceUrl: "https://example.com/a", section: 2 },
    { content: "another sourced claim", sourceUrl: "https://example.com/b", section: 5 },
    { content: "unsourced", sourceUrl: "", section: 7 },
  ],
};
const filed = evidenceRowsFor(withCites, "U123");

check("the confirm files sources as EXTERNAL_RESEARCH", filed.rows.every((r) => r.sourceType === "EXTERNAL_RESEARCH"));
check("into the client library pool, not onto one page", filed.rows.every((r) => r.pageId === null));
check(
  "‼️ and therefore NOT counted as first party, which is what keeps first_party_ratio meaningful",
  filed.rows.every((r) => isFirstParty(r.sourceType) === false),
  "isFirstParty must keep excluding EXTERNAL_RESEARCH"
);
check("a claim with no source URL is refused, and counted so the card can say so", filed.rows.length === 2 && filed.dropped === 1);
check(
  "‼️ citations come off the proposal row, not from the caller",
  evidenceRowsFor.length === 2,
  "a third parameter would let a confirm file evidence from another document"
);
check("the person who pressed it is recorded", filed.rows.every((r) => r.collectedBy === "U123"));

const prop = src("src/lib/clients/field-proposal.ts");
check(
  "a failed evidence write does not undo the confirmed values",
  /A FAILURE TO FILE EVIDENCE DOES NOT UNDO THE VALUES/.test(prop)
);
check(
  "the paste itself does NOT file evidence, the confirm does",
  !/recordSource/.test(src("src/lib/clients/research-intake.ts"))
);

// ‼️ ONE POOLED ANSWER BACKS EVERY PAGE, EXACTLY ONCE EACH. This is what page_id null buys, and it
// is the reason W2b files to the library rather than onto whichever page happened to be open.
const mk = (id: string, pageId: string | null, t: SourceType): PageSource => ({
  id,
  clientId: "c1",
  pageId,
  sourceType: t,
  sourceContent: id,
  topic: null,
  sourceUrl: null,
  sourceDate: null,
  collectedBy: null,
  collectedVia: null,
  slackTs: null,
  verifiedBy: null,
  verifiedAt: null,
  createdAt: "2026-09-22T00:00:00Z",
});
const pool = [mk("library", null, "EXTERNAL_RESEARCH"), mk("onA", "pA", "CLIENT_VOICE"), mk("onB", "pB", "CLIENT_VOICE")];
const forA = evidenceForPage(pool, "pA");
const forB = evidenceForPage(pool, "pB");

check("the pooled research reaches page A", forA.some((s) => s.id === "library"));
check("and page B, from the same single row", forB.some((s) => s.id === "library"));
check(
  "‼️ exactly once on each, never duplicated",
  forA.filter((s) => s.id === "library").length === 1 && forB.filter((s) => s.id === "library").length === 1
);
check("another page's own source stays on that page", !forA.some((s) => s.id === "onB") && !forB.some((s) => s.id === "onA"));

// ‼️ NOTHING PER-CLIENT MAY REACH THE SHARED BANKS. question_bank and avatar_briefs have no
// client_id, so a wrong write there is not correctable. Comments are stripped first, so this now
// passes ONLY if the name appears in prose: the old version passed either way.
// ‼️ THE \r GOES FIRST OR THIS STRIPS NOTHING ON WINDOWS. core.autocrlf is true on this machine, so
// every line arrives ending in \r. In a JS regex `.` does not match \r and `$` does not sit before
// it, so `//.*$` cannot match a line comment in a CRLF file: the strip silently does nothing and
// every name in a comment reads as live code. Same class of bug as sameText in _step-wiring.ts.
const stripComments = (s: string) =>
  s
    .split(CR)
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
const CR = String.fromCharCode(13);

for (const f of [
  "src/lib/clients/field-extraction.ts",
  "src/lib/clients/field-values.ts",
  "src/lib/clients/field-proposal.ts",
]) {
  const code = stripComments(src(f));
  check(`${f.split("/").pop()} never names question_bank`, !/question_bank/.test(code));
  check(`${f.split("/").pop()} never names avatar_briefs`, !/avatar_briefs/.test(code));
  // The positive half: a NEW table appearing in these three files fails here by name.
  const tables = [...code.matchAll(/\.(?:from|rpc)\("([^"]+)"\)/g)].map((m) => m[1]);
  const allowed = new Set(["client_field_values", "client_field_proposals", "commit_field_values"]);
  const strangers = tables.filter((t) => !allowed.has(t));
  check(`${f.split("/").pop()} touches only its own tables`, strangers.length === 0, strangers.join(", "));
}

// ─── 5. The card cannot exceed Slack's body limit ─────────────────────────────
console.log("\n5. a long card is several messages, never a truncated one");

const many: OpenProposal = {
  id: "p1",
  clientId: "c1",
  audienceId: "a1",
  sourceDocumentId: null,
  proposed: DATASET_FIELDS.slice(0, 20).map((f) => ({
    fieldKey: f.key,
    dataset: f.dataset,
    value: "v".repeat(300),
    sourceSection: 3,
    confidence: "high" as const,
  })),
  questions: [],
  unanswered: [],
  citations: [],
};
const chunks = formatProposalCard(many);
check("twenty long values split into more than one message", chunks.length > 1, String(chunks.length));
check("and every message is under the 3,000 character limit", chunks.every((c) => c.length < 3000), JSON.stringify(chunks.map((c) => c.length)));
check("nothing is cut mid-line", chunks.every((c) => !c.endsWith("…")));
check(
  "the confirm instruction survives the split",
  chunks.some((c) => /React :white_check_mark:/.test(c))
);

// ‼️ ONE VALUE LONGER THAN THE WHOLE LIMIT. The split used to emit such a line whole, because the
// `&& buf` guard that stops an infinite loop also lets an over-long first line through. Wrapped, not
// truncated: every character has to still be there, because a cut value on a confirmation card is
// somebody approving one thing while another is written.
const HUGE = "w".repeat(5000);
const huge = formatProposalCard({
  ...many,
  proposed: [{ fieldKey: DATASET_FIELDS[0].key, dataset: DATASET_FIELDS[0].dataset, value: HUGE, sourceSection: 1, confidence: "high" as const }],
});
check("a single 5,000 character value still splits", huge.every((c) => c.length < 3000), JSON.stringify(huge.map((c) => c.length)));
check(
  "‼️ and every character of it survives the wrap",
  huge.join("\n").replace(/\s+/g, "").includes(HUGE),
  "the value was truncated rather than wrapped"
);

// ─── 6. The confirmed value has a reader ──────────────────────────────────────
//
// ‼️ THE COUNT WAS NEVER THE COMPLAINT. field-values.ts states it: the card could report `fears` as
// filled while nobody could say what the fears were. A value stored and never shown leaves that
// exactly as true, with one more table.
console.log("\n6. the card says what the fields actually say");

const stored = [
  { id: "v1", fieldKey: DATASET_FIELDS[0].key, audienceId: "a1", dataset: DATASET_FIELDS[0].dataset, value: "  they fear   looking done  ", sourceSection: 4, sourceDocumentId: "d1", confirmedBy: "U1", confirmedAt: "2026-09-22T00:00:00Z" },
  { id: "v2", fieldKey: DATASET_FIELDS[1].key, audienceId: "a1", dataset: DATASET_FIELDS[1].dataset, value: "L".repeat(400), sourceSection: null, sourceDocumentId: null, confirmedBy: "U1", confirmedAt: "2026-09-22T00:00:00Z" },
];
const valueCard = formatValuesCard(stored);

check("it prints the value, not a tick", valueCard.some((l) => /they fear looking done/.test(l)));
check(
  "whitespace is collapsed so a pasted value reads as one line",
  valueCard.some((l) => l.includes("they fear looking done")) && !valueCard.some((l) => l.includes("  they")),
  valueCard.join(" | ")
);
check("a long value is clipped rather than flooding the card", valueCard.some((l) => /L{200}\.\.\./.test(l)));
check("it says where each value came from", valueCard.some((l) => /section 4/.test(l)));
check("and says so honestly when the section was not cited", valueCard.some((l) => /section not cited/.test(l)));
check("no values means no card at all, rather than an empty heading", formatValuesCard([]).length === 0);
check("no em dash", !valueCard.join("\n").includes("—"));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
