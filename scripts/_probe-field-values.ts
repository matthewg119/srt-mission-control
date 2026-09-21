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
import { formatProposalCard, type OpenProposal } from "../src/lib/clients/field-proposal";
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
console.log("\n3. an absence and a guess are different facts");

const ext = src("src/lib/clients/field-extraction.ts");
check("low confidence becomes a question at the extraction boundary", /confidence === "low"/.test(ext));
check("the prompt tells the model to ask rather than guess", /WHEN YOU ARE NOT SURE, ASK/.test(ext));
check("a key nobody asked for is dropped rather than proposed", /if \(!spec \|\| seen\.has\(key\)\) continue;/.test(ext));
check("a citation with no URL is dropped", /\^https\?:/.test(ext));

const vals = src("src/lib/clients/field-values.ts");
check("commitValues refuses an undeclared field key", /are not declared fields/.test(vals));
check("commitValues refuses a low-confidence value too, as a second guard", /must be answered rather than saved/.test(vals));
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

const prop = src("src/lib/clients/field-proposal.ts");
check("the confirm files sources as EXTERNAL_RESEARCH", /sourceType: "EXTERNAL_RESEARCH"/.test(prop));
check(
  "into the client library pool, not onto one page",
  /pageId: null/.test(prop)
);
check(
  "‼️ citations come off the proposal row, not from the caller",
  /p\.citations\.filter/.test(prop)
);
check(
  "a failed evidence write does not undo the confirmed values",
  /A FAILURE TO FILE EVIDENCE DOES NOT UNDO THE VALUES/.test(prop)
);
check(
  "the paste itself does NOT file evidence, the confirm does",
  !/recordSource/.test(src("src/lib/clients/research-intake.ts"))
);

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

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
