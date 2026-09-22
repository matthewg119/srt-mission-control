// Matthew's avatar and offer framework: the step 11 script, and the parsers for the four documents it
// brings back. Pure: no database, no network, so the probe can prove every rule offline.
//
// Desktop\SRT-Avatar-Offer-Framework-Prompt.md sections 4 and 5. The content (templates, method,
// transcript) lives in src/config/avatar-framework.ts; this file renders it and reads it back.
//
// ‼️ THE SAME HEADINGS WRITE THE SCRIPT AND READ THE PASTE. Messages 4 and 5 tell the chat to keep every
// heading exactly as written, and the parsers below find sections by those headings. Nothing here restates
// a heading; it is always read off the config.
//
// ‼️ SLACK MAY SEND AN EMOJI AS A :shortcode:, AND A CHAT MAY PUT A HEADING IN BOLD OR ON THE SAME LINE AS
// ITS CONTENT. A heading is matched on its letters and digits only, after both are stripped.

import {
  AVATAR_SHEET,
  BELIEF_OPENING,
  BELIEFS_TRANSCRIPT,
  MAX_NECESSARY_BELIEFS,
  RESEARCH_METHOD,
  SHORT_OFFER,
  renderTemplate,
  type TemplateSection,
} from "@/config/avatar-framework";

// ─────────────────────────────────────────────────────────────────────────────
// Reading a template document back
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedTemplate {
  /** Section key to its body, for every heading found. */
  sections: Record<string, string>;
  /** "section.sub" to its body, for every labelled line found inside a section. */
  subs: Record<string, string>;
  /** Keys (sections and "section.sub") whose body says something real. */
  answered: string[];
  /** Headings the paste did not contain at all, in template order. */
  missingHeadings: string[];
}

/** Letters and digits only, lowercased. What a heading is compared on. */
function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** A line with markdown, emoji, Slack shortcodes and list markers removed. */
function cleanLine(line: string): string {
  return line
    .replace(/:[a-z0-9_+'-]+:/gi, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, " ")
    .replace(/^[\s>*_#`~-]*(?:\d+[.)]\s*)?/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this line open a section (or a labelled line)? Returns what follows the heading on the same line.
 *
 * Accepts the label with or without its parenthetical ("Unique Mechanism of the Problem" for
 * "Unique Mechanism of the Problem (UMP)"), with or without a colon, and with content after the colon.
 */
function matchLabel(line: string, label: string): string | null {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;
  const variants = [label, label.replace(/\s*\([^)]*\)\s*$/, "")].map(alnum);
  const colon = cleaned.indexOf(":");
  const head = colon >= 0 ? cleaned.slice(0, colon) : cleaned;
  if (!variants.includes(alnum(head))) return null;
  return colon >= 0 ? cleaned.slice(colon + 1).trim() : "";
}

/** Template placeholders and honest "nothing here" answers are not content. */
function isPlaceholder(line: string): boolean {
  const t = cleanLine(line).replace(/^["']|["']$/g, "").trim();
  if (!t) return true;
  if (/^\[[^\]]*\]$/.test(t)) return true;
  if (/^low\s*\/\s*high$/i.test(t)) return true;
  if (/^not found in the research\.?$/i.test(t)) return true;
  return false;
}

/** Does a body say something real? */
function hasContent(body: string): boolean {
  return body.split(/\r?\n/).some((l) => !isPlaceholder(l));
}

/**
 * Read a pasted template document into its sections, by heading.
 *
 * ‼️ "none yet" IS AN ANSWER. The short offer's discovery story and authority figure must be real or say
 * "none yet", and that sentence is the honest one, so it counts as answered. "not found in the research"
 * on the avatar sheet means the research had nothing, so it does not.
 */
export function parseTemplateDocument(text: string, template: readonly TemplateSection[]): ParsedTemplate {
  const lines = text.split(/\r?\n/);
  const bodies = new Map<string, string[]>();
  let current: TemplateSection | null = null;

  for (const line of lines) {
    let opened: TemplateSection | null = null;
    let inline = "";
    for (const section of template) {
      // ‼️ A HEADING OPENS ITS SECTION ONCE. A line inside "Other Notes" that starts "Product:" is a note,
      // not the Product section reopening and swallowing everything after it.
      if (bodies.has(section.key)) continue;
      const rest = matchLabel(line, section.heading);
      if (rest !== null) {
        opened = section;
        inline = rest;
        break;
      }
    }
    if (opened) {
      current = opened;
      if (!bodies.has(opened.key)) bodies.set(opened.key, []);
      if (inline) bodies.get(opened.key)!.push(inline);
      continue;
    }
    if (current) bodies.get(current.key)!.push(line);
  }

  const sections: Record<string, string> = {};
  const subs: Record<string, string> = {};
  const answered: string[] = [];

  for (const section of template) {
    const body = bodies.get(section.key);
    if (!body) continue;
    const joined = body.join("\n").trim();
    sections[section.key] = joined;
    // ‼️ A LABEL IS NOT AN ANSWER. "Age range: [Specify the age range]" has letters in it, so a section
    // is judged on what follows its labels: an untouched template must read as answering nothing.
    const answers = body.map((line) => {
      for (const s of section.subLabels) {
        const rest = matchLabel(line, s.label);
        if (rest !== null) return rest;
      }
      return line;
    });
    if (hasContent(answers.join("\n"))) answered.push(section.key);

    if (!section.subLabels.length) continue;
    let sub: string | null = null;
    const subBodies = new Map<string, string[]>();
    for (const line of body) {
      let hit: string | null = null;
      let inline = "";
      for (const s of section.subLabels) {
        const rest = matchLabel(line, s.label);
        if (rest !== null) {
          hit = s.key;
          inline = rest;
          break;
        }
      }
      if (hit) {
        sub = hit;
        subBodies.set(hit, inline ? [inline] : []);
        continue;
      }
      if (sub) subBodies.get(sub)!.push(line);
    }
    for (const s of section.subLabels) {
      const b = subBodies.get(s.key);
      if (!b) continue;
      const key = `${section.key}.${s.key}`;
      subs[key] = b.join("\n").trim();
      if (hasContent(subs[key])) answered.push(key);
    }
  }

  return {
    sections,
    subs,
    answered,
    missingHeadings: template.filter((s) => !(s.key in sections)).map((s) => s.heading),
  };
}

export type DocumentRead =
  | { ok: true; parsed: ParsedTemplate }
  | { ok: false; error: string };

/**
 * A template document, or why it cannot be stored.
 *
 * ‼️ A DOCUMENT MISSING MOST OF ITS HEADINGS IS REFUSED, NEVER STORED HALF-READ. Half a sheet stored as
 * the sheet would mark every missing field as "the research did not answer this", which is untrue: the
 * paste lost the headings. The refusal lists exactly which, so the fix is one message.
 */
export function readTemplateDocument(text: string, template: readonly TemplateSection[], name: string): DocumentRead {
  const parsed = parseTemplateDocument(text, template);
  const found = template.length - parsed.missingHeadings.length;
  if (found < Math.ceil(template.length / 2)) {
    return {
      ok: false,
      error:
        `only ${found} of the ${template.length} ${name} headings are in that paste, so it was not stored. ` +
        `Missing: ${parsed.missingHeadings.join("; ")}. Ask the chat to keep every heading exactly as written and paste it again.`,
    };
  }
  return { ok: true, parsed };
}

export const readAvatarSheet = (text: string) => readTemplateDocument(text, AVATAR_SHEET, "avatar sheet");
export const readShortOffer = (text: string) => readTemplateDocument(text, SHORT_OFFER, "short offer");

/** "Belief 3 — The Mechanism Displaces Her Mental Model": the heading a WRITTEN belief chain puts
 * above each statement. Its presence is what separates the two shapes readBeliefs accepts. */
const BELIEF_HEADING = /^belief\s*\d+\b/i;
/** "I believe ..." opens a statement. The prompt asks for "I believe that", and five of the six
 * beliefs in the 2026-09-22 document dropped the "that". It is the same statement. */
const BELIEF_START = /^i\s+believe\b/i;
/** The statement has closed. A closing quote or bracket may follow the full stop. */
const SENTENCE_END = /[.!?]["'”’)\]]?$/;

/**
 * The necessary beliefs: 1 to 6 statements, each beginning "I believe that".
 *
 * A list marker, a number or bold around a line is formatting and is removed. A line ending in a colon
 * is a heading the chat added and is skipped. Anything else that is not a belief is refused by name,
 * because a sentence of commentary stored as belief 4 would be installed in every page.
 *
 * ‼️ TWO SHAPES, AND THE DOCUMENT DECIDES WHICH. The rule above is the shape of a list pasted into
 * Slack. A belief chain WRITTEN as a document is a title, an intro, and then per belief a heading, the
 * statement wrapped over two or three lines, and commentary about it. Measured on srt-agency-llc
 * 2026-09-22: AI_Referral_Engine_Belief_Chain.pdf is the second shape, 116 lines of which 6 are
 * beliefs, and the list rule refused it on its own title. It could not be stored at all.
 *
 * `Belief N` headings switch the reading. With them, only the statements are read and the prose
 * between them is ignored. Without them nothing changes, so the shape that already worked is
 * untouched and a commentary sentence still cannot be stored as a belief.
 *
 * ‼️ THE HEADINGS ARE ALSO THE COUNT, WHICH IS WHAT MAKES IGNORING PROSE SAFE. A document saying
 * "Belief 5" whose fifth statement was written "She must believe ..." would otherwise store four and
 * say nothing about the one it dropped. The two counts have to agree or nothing is stored.
 */
export function readBeliefs(text: string): { ok: true; beliefs: string[] } | { ok: false; error: string } {
  const opening = alnum(BELIEF_OPENING);
  const lines = text.split(/\r?\n/).map(cleanLine);
  const headings = lines.filter((line) => BELIEF_HEADING.test(line)).length;
  const beliefs: string[] = [];
  const stray: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (headings && BELIEF_HEADING.test(line)) continue;

    if (!(headings ? BELIEF_START.test(line) : alnum(line).startsWith(opening))) {
      if (!headings && !/:$/.test(line)) stray.push(line);
      continue;
    }

    // A statement is ONE sentence and a PDF wraps it over two or three lines, so join forward until
    // it closes. The cap and the two stop conditions mean a statement written without a full stop
    // takes its own line and nothing else, rather than swallowing the commentary underneath it.
    const parts = [line];
    while (headings && !SENTENCE_END.test(parts[parts.length - 1]) && parts.length < 5) {
      const next = lines[i + 1];
      if (!next || BELIEF_START.test(next) || BELIEF_HEADING.test(next)) break;
      parts.push(next);
      i += 1;
    }
    beliefs.push(parts.join(" ").replace(/\s+/g, " ").trim());
  }

  if (stray.length) {
    return {
      ok: false,
      error: `every belief has to start "${BELIEF_OPENING}", and ${stray.length === 1 ? "this line does" : "these lines do"} not: ${stray
        .slice(0, 3)
        .map((s) => `"${s.slice(0, 80)}"`)
        .join("; ")}. Nothing was stored.`,
    };
  }
  if (!beliefs.length) return { ok: false, error: `no line starts "${BELIEF_OPENING}", so there were no beliefs to store.` };
  if (headings && headings !== beliefs.length) {
    return {
      ok: false,
      error:
        `this document has ${headings} belief heading${headings === 1 ? "" : "s"} but ${beliefs.length} statement${beliefs.length === 1 ? "" : "s"} starting "I believe". ` +
        "One belief is written some other way, and storing the rest would drop it without saying so. Nothing was stored.",
    };
  }
  if (beliefs.length > MAX_NECESSARY_BELIEFS) {
    return {
      ok: false,
      error: `that is ${beliefs.length} beliefs and the framework allows ${MAX_NECESSARY_BELIEFS} at most: the few absolutely necessary ones. Nothing was stored.`,
    };
  }
  return { ok: true, beliefs };
}

// ─────────────────────────────────────────────────────────────────────────────
// The step 11 script
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameworkScriptInput {
  clientName: string;
  offer: string;
  terms: readonly string[];
  outcome: string | null;
  audienceLabel: string;
  city: string | null;
  /** The approved sales letter, pasted inline into message 1. */
  letter: string;
  /** The research heading contract, from researchHeadingContract() in deep-research-run.ts. */
  headingContract: readonly string[];
}

/**
 * The whole script: every message to paste, in order, into ONE conversation.
 *
 * Deterministic: same input, same bytes. No placeholder survives: a `{` left in the output is a bug the
 * probe fails on.
 */
export function buildFrameworkScript(input: FrameworkScriptInput): string {
  const where = input.city ? ` in ${input.city}` : "";
  const outcome = input.outcome ? `, promising ${input.outcome}` : "";
  const terms = input.terms.length ? ` (their customers call it: ${input.terms.join(", ")})` : "";

  const message = (n: string, title: string, body: string[]) =>
    [`==================== MESSAGE ${n}: ${title} ====================`, "", ...body, ""].join("\n");

  return [
    `AVATAR AND OFFER FRAMEWORK: ${input.clientName}, ${input.audienceLabel}`,
    "",
    "Paste each message below, in order, into ONE conversation in claude.com (or ChatGPT). Wait for each",
    "answer before pasting the next. Turn deep research ON for message 3b only.",
    "",
    "Bring back four answers into this Slack thread, each as its own message with its prefix:",
    "  research:       the deep research from message 3b",
    "  avatar sheet:   the answer to message 4",
    "  short offer:    the answer to message 5",
    "  beliefs:        the answer to message 7",
    "A long answer can be dropped in as a file instead: put the prefix on its first line.",
    "",
    message("1", "the sales letter", [
      `You are my expert direct-response copywriter. You write highly persuasive copy for ${input.clientName}, which sells ${input.offer}${terms} to ${input.audienceLabel}${where}${outcome}. Below is the current sales letter for this offer. Analyse it and give me your comments. No em dashes.`,
      "",
      input.letter,
    ]),
    message("2", "the research method", [
      "Excellent work. Below is a method for doing deep research on a product so that highly persuasive copy can be written from it. Analyse it and tell me your comments. No em dashes.",
      "",
      RESEARCH_METHOD,
    ]),
    message("3a", "write the deep research prompt", [
      `Now that you understand how to do this research properly, write a complete prompt for a deep research tool to carry out this research for ${input.offer}, sold by ${input.clientName} to ${input.audienceLabel}. Be as specific as possible so the research comes back at the highest quality. The prompt must tell the tool to compile everything it finds into one document of at least 6 pages.`,
      "",
      "The prompt you write MUST require the report to use these numbered headings, exactly as written, in this order:",
      "",
      ...input.headingContract,
      "",
      "It must also require: a source URL for every claim, \"could not verify\" instead of any invented quote, review or number, quotes kept word for word with typos, forums and reviews preferred over marketing pages, and no em dashes.",
    ]),
    message("3b", "run it", ["Turn deep research ON, and paste the prompt you got from message 3a."]),
    message("4", "the avatar sheet", [
      `Incredible work. Now that the research is done, fill in this avatar sheet for ${input.audienceLabel} from it. Keep every heading exactly as written. Every quote must be a real quote from the research, with its link. Where the research has nothing for a line, write "not found in the research" instead of inventing one. No em dashes.`,
      "",
      renderTemplate(AVATAR_SHEET),
    ]),
    message("5", "the short offer", [
      `Excellent work. Now fill in this short offer template for ${input.offer}. Keep every heading exactly as written. This is an internal strategy document: a discovery story, an authority figure or a mechanism must be real and drawn from the research or from what ${input.clientName} told us. Otherwise write "none yet". No em dashes.`,
      "",
      renderTemplate(SHORT_OFFER),
    ]),
    message("6", "the argument, not the words", ["Excellent work. Analyse this transcript and tell me your conclusions:", "", BELIEFS_TRANSCRIPT]),
    message("7", "the necessary beliefs", [
      `Excellent work. Now that you understand that marketing, at its core, is simply transforming a customer's current beliefs into the beliefs that empower them to buy, use the avatar sheet, the short offer and the research above to write the few absolutely necessary beliefs a prospect must hold before buying ${input.offer}. There must be a maximum of ${MAX_NECESSARY_BELIEFS}, each written as a statement beginning "${BELIEF_OPENING}...". No em dashes.`,
    ]),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The paste-back prefixes
// ─────────────────────────────────────────────────────────────────────────────

export type FrameworkDocumentKind = "avatar_sheet" | "short_offer" | "necessary_beliefs";

const PASTE_PREFIXES: ReadonlyArray<readonly [FrameworkDocumentKind, RegExp]> = [
  ["avatar_sheet", /^\s*avatar\s+sheet\s*:\s*/i],
  ["short_offer", /^\s*short\s+offer\s*:\s*/i],
  ["necessary_beliefs", /^\s*beliefs\s*:\s*/i],
];

/**
 * Which document a message (or a dropped file) is, by its FIRST line, and the document under it.
 *
 * ‼️ A DOCUMENT-CARRYING PREFIX NEVER GETS THE SECOND-LINE CHECK. An avatar sheet is full of labelled lines
 * and a short offer carries "Price" and "Product" headings: refusing either as "two commands" would make
 * the one prefix that exists to take a document unable to take one.
 */
export function readFrameworkPaste(text: string): { kind: FrameworkDocumentKind; body: string } | null {
  const trimmed = text.replace(/^\s+/, "");
  for (const [kind, prefix] of PASTE_PREFIXES) {
    const m = prefix.exec(trimmed);
    if (m) return { kind, body: stripFence(trimmed.slice(m[0].length)).trim() };
  }
  return null;
}

/**
 * The names these three documents actually arrive under, for the FILENAME signal only.
 *
 * ‼️ NOT DERIVED FROM PASTE_PREFIXES, AND THE BELIEF CHAIN IS WHY. The typed prefix is `beliefs:`,
 * but the file Matthew dropped on 2026-09-22 was a BELIEF CHAIN pdf, which is also what the draft
 * gate calls it ("the belief chain"). Matching filenames against the prefix table alone would miss
 * the exact document that caused the misfiling this exists to stop.
 *
 * ‼️ COMPOUND PHRASES ONLY, NEVER A BARE GENERIC WORD. `offer.pdf`, `avatar.docx` and `belief.txt`
 * must fall through. This is the weakest of the three routing signals, and a confident wrong route
 * files a document as a kind nobody chose, which is worse than not routing it at all.
 */
const FILENAME_ALIASES: ReadonlyArray<readonly [FrameworkDocumentKind, readonly string[]]> = [
  ["avatar_sheet", ["avatarsheet"]],
  ["short_offer", ["shortoffer", "offersummary"]],
  ["necessary_beliefs", ["beliefchain", "necessarybeliefs", "beliefs"]],
];

/**
 * Which document a dropped FILE is, by its filename. The WEAKEST of the three signals, and the last
 * one consulted: a typed prefix is a person saying what the file is, a first line is the document
 * saying so itself, and a filename is only the name somebody saved it under.
 *
 * ‼️ IT CANNOT RETURN `deep_research`, AND THAT IS FREE RATHER THAN A RULE TO ENFORCE.
 * FrameworkDocumentKind is exactly the three framework documents, so a file called `research.pdf`
 * cannot match anything here and keeps the fall-through to ingestResearchFile it already has.
 * test-onboarding-artifacts.ts asserts that `research:` is not a framework document.
 */
export function kindFromFilename(
  filename: string,
  body: string
): { kind: FrameworkDocumentKind; body: string } | null {
  const stem = alnum(filename.replace(/\.[a-z0-9]{1,8}$/i, ""));
  if (!stem) return null;

  const hits = new Set<FrameworkDocumentKind>();
  for (const [kind, aliases] of FILENAME_ALIASES) {
    if (aliases.some((alias) => stem.includes(alias))) hits.add(kind);
  }

  // ‼️ TWO KINDS IN ONE NAME IS A REFUSAL, NOT FIRST-MATCH-WINS. "short offer and beliefs.pdf"
  // names two documents, and on the weakest signal there is nothing to break the tie with. Falling
  // through asks the person which it is; guessing files it as the one that happened to be listed
  // first, and nothing downstream could tell that had happened.
  if (hits.size !== 1) return null;
  return { kind: [...hits][0], body };
}

function stripFence(text: string): string {
  const m = /^```[a-z]*\n?([\s\S]*?)\n?```\s*$/i.exec(text.trim());
  return m ? m[1] : text;
}
