// W0: read the research and propose a VALUE for each field it can answer.
//
// Matthew, 2026-09-20: "once we paste the deep research the intelligence from my onboarding should
// read the data and fill all of the datasets it has missing as much as possible and for what is not
// sure simply ask the question, before locking it in, it should give me the datasets that is looking
// to save so i can confirm the fears are ok, the offer etc".
//
// ‼️ LIVE CODE, NEVER STORED. The extraction is recomputed from the document every time it is run.
// harvest.ts states the rule this follows: "What the page SAID is a fact and keeps; what we make of
// it is recomputed every run." The document already lives in `audience_documents`; a stored
// extraction would freeze the answers to whichever ruleset was current that day, and the ruleset is
// DATASET_FIELDS, which changes.
//
// ‼️ MISSING FIELDS ONLY. step-gaps.ts's "if we already hold it, do not ask for it" is the contract,
// and it applies to FILLING as much as to asking. Re-extracting a field that already has a
// confirmed value would put a model's reading up against a person's decision, and there is no
// version of that card where the right answer is obvious.
//
// ‼️ NOTHING HERE WRITES. It proposes. The only writer is commitValues(), behind a confirmation.

import { callClaudeJSON } from "@/lib/claude-calls";
import { DATASET_FIELDS, type DatasetKey } from "./dataset-spec";
import type { ProposedValue } from "./field-values";
import type { ResearchSection } from "./avatar-profile";

/** A field the extraction could not answer confidently. Shown as a question, never as a value. */
export interface FieldQuestion {
  fieldKey: string;
  dataset: DatasetKey;
  /** What to ask, in words, so the card can print it unchanged. */
  question: string;
  /** Why it could not answer: the section was thin, absent, or said something ambiguous. */
  because: string;
}

/** A claim the report makes AND cites. W2b files these so the page gate can see the research. */
export interface ResearchCitation {
  content: string;
  sourceUrl: string;
  section: number | null;
}

export interface ExtractionResult {
  proposed: ProposedValue[];
  questions: FieldQuestion[];
  /** Field keys that were asked about and simply had nothing in the document. */
  unanswered: string[];
  /**
   * Cited claims, for evidence filing.
   *
   * ‼️ ONLY ONES CARRYING A URL. A claim with no source_url is not evidence: filing a model's
   * unsourced assertion as a source launders an invention into a citation. Asked for in the SAME
   * call as the values, because the prompt's rule is one model call per paste and a second pass
   * over the same document to collect URLs would be a second bill for the same reading.
   */
  citations: ResearchCitation[];
  /**
   * Things the report keeps returning to that no declared field covers.
   *
   * ‼️ A PROPOSAL, NEVER A DECLARATION. dataset-spec.ts stays the only authority on which fields
   * exist; these go to `dataset_suggestions`, which by its own migration comment "is an argument,
   * never a declaration" and must name what it counted. A model that could add fields to the
   * registry would quietly reshape what every client is measured against.
   */
  suggestions: FieldSuggestion[];
}

/** A field the report wanted and the registry does not have. */
export interface FieldSuggestion {
  proposedKey: string;
  label: string;
  dataset: DatasetKey;
  /** What was counted, in words. A suggestion with no basis is an opinion. */
  basis: string;
}

const SYSTEM = `You read a completed buyer-research report and pull out the specific answer to each
named field. You are filling a structured dataset, not summarising.

RULES, and the third one is the one that matters most.

1. Answer ONLY from the report. Never use general knowledge about the industry, the city, or what
   businesses like this usually do. If the report does not say it, you do not know it.
2. Quote or tightly paraphrase what the report actually says. A value is something a person could
   check against the section you cite.
3. ‼️ WHEN YOU ARE NOT SURE, ASK. Return the field as a question rather than as a value. A field
   filled with a plausible invention is worse than an empty one, because every page this business
   publishes afterwards will argue from it and nobody downstream can tell it was never really
   answered. "confidence": "low" means it becomes a question and is never saved.
4. Cite the section NUMBER you read it from, exactly as the report numbers it. Do not renumber.
5. A field the report does not address at all is "unanswered". That is a normal, useful answer and
   is different from a low-confidence guess.
6. Separately, list the report's CITED claims: a factual statement the report makes AND gives a
   source URL for. ‼️ Only ones with a real URL from the report. Never invent a URL, never attach
   one you think is probably right, and never list a claim the report asserted without citing. An
   unsourced assertion filed as a source turns an invention into a citation.
7. Finally, if the report keeps returning to something important that none of the fields above
   covers, suggest it as a new field: a key, a label, which dataset it belongs to, and WHAT YOU
   COUNTED that justifies it. Suggest at most three, and only for things the report actually
   dwells on. A suggestion with no basis is an opinion.
8. No em dashes anywhere in your output.

Confidence:
  high    the report states this directly
  medium  the report clearly implies it and one reading is much better than the others
  low     you would be guessing, or two readings are equally good. This becomes a question.`;

interface RawCite {
  claim?: unknown;
  source_url?: unknown;
  section?: unknown;
}

interface RawItem {
  field_key?: unknown;
  value?: unknown;
  section?: unknown;
  confidence?: unknown;
  question?: unknown;
  because?: unknown;
  status?: unknown;
}

interface RawSuggestion {
  proposed_key?: unknown;
  label?: unknown;
  dataset?: unknown;
  basis?: unknown;
}

function isRawShape(
  v: unknown
): v is { fields: RawItem[]; citations?: RawCite[]; suggestions?: RawSuggestion[] } {
  return Array.isArray((v as { fields?: unknown } | null)?.fields);
}

/**
 * Propose values for the fields this client is missing.
 *
 * `missingKeys` comes from the completeness report, so the "already held" contract is enforced by
 * the caller rather than re-derived here.
 */
export async function extractFieldValues(args: {
  sections: readonly ResearchSection[];
  missingKeys: readonly string[];
}): Promise<ExtractionResult> {
  const wanted = DATASET_FIELDS.filter((f) => args.missingKeys.includes(f.key));
  if (!wanted.length || !args.sections.length) {
    return { proposed: [], questions: [], unanswered: [], citations: [], suggestions: [] };
  }

  // ‼️ THE SECTION NUMBER IS THE ASKER'S NUMBER AND IS SHOWN AS SUCH. buildGapPrompt keeps each
  // section's ORIGINAL number for the same reason: a subset renumbered from 1 files section
  // twelve's answer under section one, silently and permanently. The model is given the numbers
  // the document carries and told not to renumber, and the round-trip probe proves what comes back
  // maps to the same key.
  const doc = args.sections
    .map((s) => `## ${s.number}. ${s.title}\n${s.body}`)
    .join("\n\n");

  const fieldList = wanted
    .map((f) => `- ${f.key} (${f.dataset}): ${f.label}. Used for: ${f.usedFor}`)
    .join("\n");

  const res = await callClaudeJSON<{
    fields: RawItem[];
    citations?: RawCite[];
    suggestions?: RawSuggestion[];
  }>({
    model: "claude-sonnet-4-6",
    system: SYSTEM,
    user: `FIELDS TO FILL:\n${fieldList}\n\nTHE REPORT:\n\n${doc}`,
    maxTokens: 8000,
    temperature: 0,
    schemaHint:
      '{ "fields": [ { "field_key": "who_buys", "status": "answered", "value": "...", ' +
      '"section": 1, "confidence": "high" }, { "field_key": "beliefs", "status": "unsure", ' +
      '"question": "...", "because": "..." }, { "field_key": "price", "status": "unanswered" } ], ' +
      '"citations": [ { "claim": "...", "source_url": "https://...", "section": 3 } ], ' +
      '"suggestions": [ { "proposed_key": "budget_band", "label": "what they can spend", ' +
      '"dataset": "avatar", "basis": "sections 2, 4 and 7 all name a price ceiling" } ] }',
    validate: isRawShape,
    describeInvalid: () =>
      'Return { "fields": [ ... ] } with one entry per field you were given, each carrying a "status" of answered, unsure or unanswered.',
    timeoutMs: 180_000,
  });

  const byKey = new Map(wanted.map((f) => [f.key, f]));
  const proposed: ProposedValue[] = [];
  const questions: FieldQuestion[] = [];
  const unanswered: string[] = [];
  const seen = new Set<string>();

  for (const item of res.data.fields) {
    const key = typeof item.field_key === "string" ? item.field_key.trim() : "";
    const spec = byKey.get(key);
    // ‼️ A KEY WE DID NOT ASK FOR IS DROPPED, NOT STORED. The model can invent a field name as
    // easily as a value, and commitValues would refuse it anyway; dropping it here keeps it off
    // the card so nobody confirms something that cannot be written.
    if (!spec || seen.has(key)) continue;
    seen.add(key);

    const confidence = String(item.confidence ?? "").toLowerCase();
    const value = typeof item.value === "string" ? item.value.trim() : "";
    const status = String(item.status ?? "").toLowerCase();

    if (status === "unanswered" || (!value && status !== "unsure")) {
      unanswered.push(key);
      continue;
    }

    // ‼️ LOW CONFIDENCE BECOMES A QUESTION HERE, NOT LATER. This is the single decision that keeps
    // the corpus clean, so it is made at the boundary rather than trusted to the card or to
    // commitValues. Both of those refuse it too; none of the three is the only guard.
    if (status === "unsure" || confidence === "low" || !value) {
      questions.push({
        fieldKey: key,
        dataset: spec.dataset,
        question:
          typeof item.question === "string" && item.question.trim()
            ? item.question.trim()
            : `What should ${spec.label} be?`,
        because:
          typeof item.because === "string" && item.because.trim()
            ? item.because.trim()
            : "the report does not say this clearly enough to save it",
      });
      continue;
    }

    const section = Number(item.section);
    proposed.push({
      fieldKey: key,
      dataset: spec.dataset,
      value,
      sourceSection: Number.isFinite(section) && section > 0 ? section : null,
      confidence: confidence === "high" ? "high" : "medium",
    });
  }

  // A field the model never mentioned is unanswered, not silently dropped. Otherwise the card
  // would report on fewer fields than it asked about and nobody would notice which went missing.
  for (const f of wanted) {
    if (!seen.has(f.key)) unanswered.push(f.key);
  }

  // ‼️ NO URL, NOT A CITATION. Dropped here rather than filtered at filing time, so the count on
  // the card is the count of things that could actually be filed. recordSource would happily store
  // a null source_url and the gate would then be reading an unsourced assertion as evidence.
  const citations: ResearchCitation[] = [];
  for (const c of res.data.citations ?? []) {
    const content = typeof c.claim === "string" ? c.claim.trim() : "";
    const url = typeof c.source_url === "string" ? c.source_url.trim() : "";
    if (!content || !/^https?:\/\//i.test(url)) continue;
    const n = Number(c.section);
    citations.push({ content, sourceUrl: url, section: Number.isFinite(n) && n > 0 ? n : null });
  }

  const DATASETS: readonly DatasetKey[] = ["avatar", "audience", "offer"];
  const declared = new Set(DATASET_FIELDS.map((f) => f.key));
  const suggestions: FieldSuggestion[] = [];
  for (const g of (res.data.suggestions ?? []).slice(0, 3)) {
    const key = typeof g.proposed_key === "string" ? g.proposed_key.trim().toLowerCase() : "";
    const label = typeof g.label === "string" ? g.label.trim() : "";
    const basis = typeof g.basis === "string" ? g.basis.trim() : "";
    const dataset = DATASETS.find((d) => d === g.dataset);
    // A suggestion for a field that already exists is noise, and one with no basis is an opinion.
    if (!key || !label || !basis || !dataset || declared.has(key)) continue;
    suggestions.push({ proposedKey: key, label, dataset, basis });
  }

  return { proposed, questions, unanswered, citations, suggestions };
}
