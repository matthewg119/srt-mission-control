// What a stored phrase IS, and who said it. Pure, no network, proven by scripts/_probe-phrase-kind.ts.
//
// ‼️ MEASURED BEFORE IT WAS WRITTEN (2026-09-15). SRT's step 13 set filled its "Objection — 24" bucket
// with, verbatim:
//
//   "Request the Governance Risk Audit A structured path to growth."   button text, aestheticbureau.co
//   "Scam agencies break this model immediately."                       legalclarity.org, about talent agencies
//   "### Compliance and Regulatory Risks"                               a heading from the 2026-08-27 research
//   "Compliance and legal risk from aggressive marketing"               another heading
//   "This appears in equipment manufacturer guidance as a ..."          research prose
//
// Every one of them was filed as an objection because harvest.ts's OBJECTION_MARKERS matched ONE WORD
// ("risk", "scam") anywhere in the sentence. None of them is anything a buyer said. Matthew: "I want
// real sale objections not this."
//
// ‼️ AN OBJECTION IS A SHAPE AND A SPEAKER, NEVER A WORD. It is the BUYER hesitating: a question they
// ask, or a sentence in their own voice ("we already pay an agency", "I tried this before"). A
// competitor's page that mentions risk, a research report's heading about compliance, and a vendor's
// slogan are all things somebody else wrote ABOUT the buyer, and they are kept (question_bank is shared
// and is training data) but never counted as objections.

export type PhraseKind = "question" | "objection" | "claim" | "heading" | "vendor_copy" | "research_prose";
export type PhraseSpeaker = "buyer" | "vendor" | "researcher" | "unknown";

export interface PhraseReading {
  kind: PhraseKind;
  speaker: PhraseSpeaker;
  /** The rule that decided it, in words, so a backfill report can say why. */
  reason: string;
}

const QUESTION_START =
  /^(so\s+|and\s+|but\s+)?(how|what|why|when|where|which|who|is|are|does|do|did|can|could|should|would|will|has|have|am|was|were|any(one|body)|has anyone|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|can'?t)\b/i;

/** A buyer's own voice: first person, or a question they are asking. */
const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|im|ive|my|me|mine|myself)\b/i;
const WE_VOICE = /\b(we|we're|we've|our|ours|us)\b/i;

/**
 * What a buyer says when something stops them buying. Written as the hesitation, not as a topic.
 *
 * ‼️ "risk" AND "scam" ARE HERE ONLY INSIDE A BUYER'S SENTENCE. "is this a scam?" and "I'm worried it's
 * a scam" are objections; "Scam agencies break this model" is somebody's essay.
 */
const HESITATION = [
  /\b(worth it|worth the (money|cost|price))\b/i,
  /\bhow (do|would|can) (i|we) (know|trust|tell|be sure)\b/i,
  /\bwhat if\b/i,
  /\b(too )?(expensive|pricey|costly)\b/i,
  /\bcan'?t afford\b|\bafford\b/i,
  // NOT "how much does it cost": that is a price question and a Price page, not a hesitation.
  /\balready (have|pay|use|work with|tried|got|spend)\b/i,
  /\btried\b.*\b(before|already|didn'?t|did not|nothing|never)\b/i,
  /\b(did ?n'?t|does ?n'?t|do ?n'?t|won'?t|will not|did not|does not) (work|help|do anything|make a difference)\b/i,
  /\b(locked in(to)?|long[- ]term contract|contract|cancel|commitment)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bhow long (until|before|does it take|will it take|to see)\b/i,
  /\bdo (patients|people|customers|clients|buyers) (actually|really|even)\b/i,
  /\b(is|are) (this|it|ai|aeo|chatgpt)( search)? (real|legit|a fad|a scam|just hype|hype)\b/i,
  /\b(scam|rip(-|\s)?off|waste of (money|time)|snake oil)\b/i,
  /\b(not sure|skeptical|sceptical|doubt|hesitant|on the fence)\b/i,
  /\b(no time|don'?t have (the )?time|too busy)\b/i,
  /\b(do it|this) (myself|ourselves|in[- ]house)\b/i,
  /\b(hurt|damage|affect|ruin)\b.*\b(google|ranking|seo|reputation|reviews?)\b/i,
  /\b(afraid|scared|nervous|worried|worry|concerned|fear)\b/i,
  /\b(risk(y|s)?|danger(ous)?|safe|side effects?|painful|hurts?|bruis(e|ing)|regret|ruined|unnatural|over ?done|frozen|fake)\b/i,
  /\bwhy (should|would) (i|we)\b|\bwhy not just\b/i,
  /\bwhat'?s the catch\b|\bcatch\b/i,
  /\bjust (seo|marketing|hype|another|a fad)\b/i,
  /\b(have|has) you (ever )?(done|worked|helped|had)\b/i,
  /\b(would|will|do|does|can|could) (i|we|it|this|that) (actually|really|even)\b|\b(actually|really|even) (matter|work)\b/i,
  /\bwait and see\b|\bjust wait\b/i,
  /\b(legal|compliance|compliant|hipaa|lawsuit|liable|liability)\b/i,
];

/** A call to action or a slogan: the vendor talking, from a page's buttons and headings. */
const CTA_START =
  /^(request|book|get|schedule|claim|download|start|learn|contact|call|discover|join|try|sign up|grab|see|explore|find out|unlock|reserve|apply|chat|talk to|let'?s|watch|read|view|visit|subscribe|enroll|register|shop|buy|order)\b/i;

/** A heading written with markdown, numbering or all-caps. */
const MARKUP_HEADING = /^(#{1,6}\s|\d+(\.\d+)*[.)]\s+[A-Z]|[A-Z][A-Z0-9 &/-]{6,}$)/;

/** A statement a report makes about its subject: third person, analytic. */
const REPORT_VOICE =
  /^(this|these|that|those|it|they|there (is|are)|clinics|practices|owners|patients|med spas|businesses|agencies|many|most|some|research|studies|data|according|in (summary|short|practice)|overall|notably|however|additionally|furthermore|for example|the (report|research|data|study|market|industry))\b/i;

/** Common verbs; a short line with none of them is a label, not a sentence. */
const HAS_VERB =
  /\b(is|are|was|were|be|been|being|am|do|does|did|have|has|had|can|could|will|would|should|may|might|must|get|gets|make|makes|work|works|need|needs|want|wants|help|helps|pay|pays|cost|costs|use|uses|find|finds|know|knows|think|thinks|tried|try|see|sees|go|goes|take|takes|say|says|feel|feels|book|books|lose|loses|break|breaks|appear|appears|deliver|delivered|rank|ranks|show|shows|name|names)\b/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function classifyPhrase(raw: string, source?: string | null): PhraseReading {
  const phrase = raw.trim();
  // A question mark, or a question word opening a line that is not a finished statement. "When agencies
  // are not law-literate, clinics inherit the risk." opens on "when" and is prose.
  const asks = phrase.endsWith("?") || (QUESTION_START.test(phrase) && !/[.!]$/.test(phrase) && !phrase.includes(","));
  const firstPerson = FIRST_PERSON.test(phrase);
  const weVoice = WE_VOICE.test(phrase);
  const hesitates = HESITATION.some((r) => r.test(phrase));

  // 0. The research brief's KEYWORDS block is search phrases by definition: "med spa SEO agency
  // Greensboro" has no verb because nobody types one into a search box, and it is not a heading.
  if (source === "keywords") {
    return hesitates
      ? { kind: "objection", speaker: "buyer", reason: "a search phrase that hesitates" }
      : { kind: "question", speaker: "buyer", reason: "a search phrase from the research's keyword block" };
  }

  // 0b. The vendor asking the reader something: a button welded onto a question ("Get a Free Audit Book a
  // Strategy Call Ready to grow your practice?"), "Want to learn more?", or a condition aimed at the
  // reader ("When patients in your city ask ChatGPT ... is your name in the answer?").
  if (
    (CTA_START.test(phrase) && (/\b(your|us|our)\b/i.test(phrase) || /\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b/.test(phrase))) ||
    /^want to (learn|know|see|find|get)\b/i.test(phrase) ||
    (asks && /^(when|if)\b/i.test(phrase) && /\byour\b/i.test(phrase))
  ) {
    return { kind: "vendor_copy", speaker: "vendor", reason: "the vendor asking the reader" };
  }

  // 1. A heading: markdown, numbered, shouting, or a short verbless label.
  if (MARKUP_HEADING.test(phrase)) return { kind: "heading", speaker: "unknown", reason: "markdown, numbered or all-caps heading" };
  if (!asks && !firstPerson && !weVoice && !/[.!]$/.test(phrase) && words(phrase) <= 9 && !HAS_VERB.test(phrase)) {
    return { kind: "heading", speaker: "unknown", reason: "a short label with no verb" };
  }

  // 2. The vendor: a call to action, or "we/our" selling rather than a buyer's "we already pay".
  if (!asks && CTA_START.test(phrase)) return { kind: "vendor_copy", speaker: "vendor", reason: "opens with a call to action" };

  // 3. A buyer hesitating, in a question or their own voice.
  if (hesitates && (asks || firstPerson || (weVoice && /\b(we|our)\b.*\b(already|tried|have|pay|use|can'?t|don'?t|need|afford)\b/i.test(phrase)))) {
    return { kind: "objection", speaker: "buyer", reason: asks ? "a question that hesitates" : "a hesitation in the buyer's own voice" };
  }

  // 4. A question nobody hesitated in.
  if (asks) return { kind: "question", speaker: firstPerson ? "buyer" : "unknown", reason: "a question" };

  // 5. What is left is a statement. Whose?
  if (weVoice || /\byour\b/i.test(phrase)) {
    return { kind: "vendor_copy", speaker: "vendor", reason: "a statement addressed to the reader or about us" };
  }
  if (firstPerson) return { kind: "claim", speaker: "buyer", reason: "a statement in the buyer's voice with no hesitation" };
  if (source === "deep_research" || REPORT_VOICE.test(phrase)) {
    return { kind: "research_prose", speaker: "researcher", reason: "third-person analysis" };
  }
  return { kind: "claim", speaker: "unknown", reason: "a statement with no speaker" };
}

/** The kinds a tracked question set or a keyword may be drawn from at all. */
export function isAskable(kind: PhraseKind): boolean {
  return kind === "question" || kind === "objection";
}

const KINDS: readonly PhraseKind[] = ["question", "objection", "claim", "heading", "vendor_copy", "research_prose"];

/**
 * The kind of a stored question_bank row: the label written by the backfill or the writer when there is
 * one, otherwise read now by the same rule. A row labelled by hand is never second-guessed.
 */
export function kindOfRow(row: { phrase?: unknown; source?: unknown; kind?: unknown }): PhraseKind {
  const stored = typeof row.kind === "string" ? (row.kind as PhraseKind) : null;
  if (stored && KINDS.includes(stored)) return stored;
  return classifyPhrase(String(row.phrase ?? ""), typeof row.source === "string" ? row.source : null).kind;
}
