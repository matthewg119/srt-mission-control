// The INSTAGRAM DM lane: the same measured door knock as the email hook, in a chat bubble.
//
// Why it exists. hook-pitch.ts already runs four real buyer questions and drafts one email off
// what came back, but its only door is a button on a CRM lead page and it needs a lead that
// already has a website and an email address on the row. Prospecting does not happen there. It
// happens on an Instagram profile, where there is no lead yet, no email address, and a DM box
// already open. This lane is that same scan, reached from that page, written for that box.
//
// ‼️ IT IS A SEPARATE FILE FROM hook-pitch.ts, AND IT IS NOT A FLAG ON IT. The scan is shared and
// is imported, never re-run differently; what differs is everything about the SURFACE. An email
// carries a subject, a greeting, an appended PERMISSION_CLOSE and a two-line sign-off, and all
// four of those read as an email pasted into a DM when they land in Instagram. A boolean on
// draftHookPitch would have had to branch around each of them and the two lanes would have
// drifted inside one function.
//
// What IS imported wholesale, because it is what keeps the message honest:
//
//   - The scan. HookCheck comes from runHookCheck(), MiniCheck from runMiniVisibilityCheck().
//     Nothing here calls an engine or re-derives a fact.
//   - The angle gates. pickDmAngle mirrors pickHookAngle's structure exactly: an absence angle is
//     refused to a business that showed up everywhere, and a rival may be named only when the
//     extractor actually returned one. Those gates are the reason a stranger can reproduce the
//     claim from his phone, which is the whole reason the message lands.
//   - The linter. Every variant goes through lintDraft() under the `dm` stage, so the banned
//     jargon, the banned absolutes, the unfilled-placeholder scan and the site-tease rule apply
//     here identically. See the comment on LintInput.stage for why `dm` is a stage rather than a
//     second linter.
//
// ‼️ THE VARIANTS DIFFER IN WORDING AND NEVER IN CLAIM. Matthew asked for variations because three
// identical DMs read as a bot. The angle is still picked ONCE, from what the scan measured, and
// all three variants state that one finding: only one thing was measured, so a variant that
// reached for a different claim to sound fresh would be inventing it. The axis of variation is
// DM_OPENERS and nothing else.

import type { HookCheck } from "./hook-pitch";
import type { MiniCheck } from "./no-website-pitch";
import { callClaudeText } from "@/lib/claude-calls";
import {
  PERMISSION_PERSONA,
  PARAGRAPH_RULES,
  VOICE_RULES,
  STYLE_RULES,
  COMPLIANCE_RULES,
  noDashes,
  enforceLinkPolicy,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import { lintDraft, retryInstruction, type LintFinding } from "./draft-linter";
import {
  DM_ASK_LINE,
  DM_CLOSE_LINE,
  DM_MAX_SENTENCES,
  DM_OPENERS,
  NAME_COMPETITORS_IN_COLD_EMAIL,
  NO_WEBSITE_LINE,
  dmAbsenceLine,
  dmPresentLine,
  dmRivalLine,
  type DmOpenerId,
} from "@/config/pitch";

function model(): "claude-opus-4-7" | "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts, from either lane
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which scan produced these facts.
 *
 * A discriminated union rather than one widened shape, because the two lanes know genuinely
 * different things and the difference must stay visible at every read site. A MiniCheck has no
 * site, no trade read off real pages and no trustworthy rival name; collapsing it into a HookCheck
 * with nulls would let a `?? ""` somewhere downstream turn "we never looked" into "we looked and
 * found nothing", which is the exact defect documented at the top of hook-pitch.ts.
 */
export type DmFacts =
  | { kind: "hook"; check: HookCheck }
  | { kind: "nowebsite"; check: MiniCheck; businessName: string };

/** What every angle needs, normalized out of whichever check we were handed. */
export interface DmSubject {
  businessName: string;
  /** What they sell, in buyer words. Null on the no-website lane when research found nothing. */
  trade: string | null;
  buyerPersona: string | null;
  city: string | null;
  /** Measured questions that came back at all. THE DENOMINATOR, never the number asked. */
  measuredCount: number;
  /** Measured questions in which they were named. */
  appearedCount: number;
  /** Measured questions in which they were NOT named. */
  missCount: number;
  /**
   * ‼️ NULL ON THE NO-WEBSITE LANE, ALWAYS, EVEN WHEN THAT CHECK CARRIES NAMES.
   *
   * runMiniVisibilityCheck fills MiniPromptResult.named via namesFrom(), whose own comment in
   * no-website-pitch.ts calls it crude on the grounds that it only ever feeds a prompt. This
   * message PRINTS the name it is given and attaches a claim to it, so the only acceptable source
   * is extractRecommendedBatch, which is what the hook lane already uses and what fills
   * audit_runs.recommended. A name good enough to steer a model is not good enough to put in
   * front of the person it is about. Same reasoning as hook-pitch.ts line 251.
   */
  topRival: { name: string; count: number } | null;
  questions: Array<{ prompt: string; appeared: boolean | null; named: string[] }>;
}

export function dmSubjectOf(facts: DmFacts): DmSubject {
  if (facts.kind === "hook") {
    const c = facts.check;
    return {
      businessName: c.businessName,
      trade: c.trade,
      buyerPersona: c.buyerPersona,
      city: c.city,
      measuredCount: c.measuredCount,
      appearedCount: c.appearedCount,
      missCount: c.results.filter((r) => r.appeared === false).length,
      topRival: c.topRival,
      questions: c.results.map((r) => ({ prompt: r.prompt, appeared: r.appeared, named: r.named })),
    };
  }

  const c = facts.check;
  const measured = c.results.filter((r) => r.appeared !== null);
  return {
    businessName: facts.businessName,
    trade: c.identity?.whatTheyDo?.trim() || null,
    buyerPersona: null,
    city: c.city,
    measuredCount: measured.length,
    appearedCount: measured.filter((r) => r.appeared === true).length,
    missCount: measured.filter((r) => r.appeared === false).length,
    topRival: null, // see the field doc. Not "none found": not sourced well enough to print.
    questions: c.results.map((r) => ({ prompt: r.prompt, appeared: r.appeared, named: r.named })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The angles
// ─────────────────────────────────────────────────────────────────────────────

export interface DmAngle {
  id: "rival-substitute" | "buying-question" | "present-but-thin" | "no-site";
  /** Requires at least one measured question they did NOT appear in. */
  needsMiss: boolean;
  /** Requires a rival an engine actually named, via the batch extractor. */
  needsRival: boolean;
  /** Requires that they appeared in every measured question. The mirror gate. */
  needsCleanSweep: boolean;
  /** Requires at least one question to have come back at all. */
  needsMeasured: boolean;
  /** The one sentence that carries the claim, from config/pitch.ts. */
  finding: (s: DmSubject) => string;
  /** What the drafter may and may not do with it. */
  instruction: string;
}

/**
 * ‼️ GATED IN BOTH DIRECTIONS, exactly like HOOK_ANGLES.
 *
 * An absence angle handed to a business that showed up everywhere is a lie the prospect disproves
 * from his phone in thirty seconds, and on Instagram he disproves it in the same thread he is
 * reading it in. The mirror matters as much: `present-but-thin` handed to a business that was
 * missing everywhere would congratulate someone on a result they did not get.
 */
const DM_ANGLES: DmAngle[] = [
  {
    // The reference message. Absence, proven by the name that took the slot.
    id: "rival-substitute",
    needsMiss: true,
    needsRival: true,
    needsCleanSweep: false,
    needsMeasured: true,
    finding: (s) =>
      dmRivalLine(s.trade ?? "a business like theirs", s.city, s.topRival!.name, s.businessName),
    instruction:
      "The finding is that a real buying question was put to ChatGPT, it answered with a list of " +
      "businesses, and this one was not on it while the named rival was. Report it and stop. Do " +
      "NOT editorialise about the rival, do not say it is better, do not suggest it let anyone " +
      "down, and do not say how many of the questions it came back in. You are reporting what an " +
      "engine returned, which they can reproduce themselves.",
  },
  {
    id: "buying-question",
    needsMiss: true,
    needsRival: false,
    needsCleanSweep: false,
    needsMeasured: true,
    finding: (s) => dmAbsenceLine(s.trade ?? "a business like theirs", s.city, s.businessName),
    instruction:
      "The finding is that somebody asking who to hire has already decided to buy, and the engine " +
      "answered that question without this business in it. Do NOT name any of the businesses that " +
      "did come back: none of them are cleared for this message.",
  },
  {
    id: "present-but-thin",
    needsMiss: false,
    needsRival: false,
    needsCleanSweep: true,
    needsMeasured: true,
    finding: (s) => dmPresentLine(s.trade ?? "a business like theirs", s.city, s.businessName),
    instruction:
      "The finding is that they DID come back, and this message must say so plainly and without " +
      "hedging. You must NOT tell them they are invisible, missing, or losing anything, and " +
      "nothing here may read as bad news about their visibility. What is true, and all you may " +
      "say, is that the words the engine used to describe them were written by somebody else, so " +
      "the description is not theirs and is not under their control.",
  },
  {
    // The floor. No site to read, or nothing came back at all.
    id: "no-site",
    needsMiss: false,
    needsRival: false,
    needsCleanSweep: false,
    needsMeasured: false,
    finding: (s) =>
      `I went looking for ${s.businessName} the way an AI engine would, and ${NO_WEBSITE_LINE}.`,
    instruction:
      "The finding is that there is nothing of theirs for an engine to cite. State it as the " +
      "situation it is, not as a failure of theirs. Do NOT claim you asked an engine a question " +
      "and watched them not come back, because on this lane that may not have happened.",
  },
];

export function pickDmAngle(facts: DmFacts): DmAngle {
  const s = dmSubjectOf(facts);
  const hasRival = Boolean(s.topRival) && NAME_COMPETITORS_IN_COLD_EMAIL;
  const cleanSweep = s.measuredCount > 0 && s.missCount === 0;

  for (const a of DM_ANGLES) {
    // The no-website lane may only ever reach the last angle. It has no site read, so the trade in
    // the three lines above it would be a research guess rather than something read off their
    // pages, and it has no rival name this file is allowed to print. See DmSubject.topRival.
    if (facts.kind === "nowebsite" && a.id !== "no-site") continue;
    if (a.needsMeasured && s.measuredCount === 0) continue;
    if (a.needsMiss && s.missCount === 0) continue;
    if (a.needsRival && !hasRival) continue;
    if (a.needsCleanSweep && !cleanSweep) continue;
    return a;
  }
  return DM_ANGLES[DM_ANGLES.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts block
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the drafter may treat as fact. Sibling of hookCheckContext() and miniCheckContext().
 *
 * ‼️ THE FINDING SENTENCE IS COMPUTED HERE AND HANDED OVER FINISHED, for the same reason
 * hookCheckContext hands over its fraction as a finished phrase: left to assemble it, a model
 * reaches for an adjective, drops the business name, or counts the questions it can see rather
 * than the ones that were answered. Handing over the sentence is the same discipline as appending
 * PERMISSION_CLOSE in code.
 */
export function dmContext(facts: DmFacts, angle: DmAngle): string {
  const s = dmSubjectOf(facts);
  const lines: string[] = [
    `Business: ${s.businessName}`,
    `What they do: ${s.trade ?? "not established, so never name their trade in the message"}`,
    `Who buys from them: ${s.buyerPersona ?? "unknown, so do not name a buyer type rather than inventing one"}`,
    `City: ${s.city ?? "unknown"}`,
    "",
    s.questions.length
      ? `Questions actually put to ChatGPT (${s.questions.length}):`
      : "No buyer questions were put to an engine on this lane.",
  ];

  for (const q of s.questions) {
    const verdict =
      q.appeared === null
        ? "NO ANSWER came back, so this question proves nothing and must not be counted or quoted"
        : q.appeared
          ? "they WERE named"
          : "they were NOT named";
    // Names are shown to the drafter as context on BOTH lanes, but are only ever printable through
    // the finding sentence, which is built in code and only ever carries a rival on the hook lane.
    const named = q.named.length ? ` Named instead: ${q.named.join(", ")}.` : "";
    lines.push(`- "${q.prompt}" -> ${verdict}.${named}`);
  }

  lines.push(
    "",
    "‼️ THIS SENTENCE IS FIXED. Reproduce it VERBATIM, word for word, as its own paragraph. Do not " +
      "reword it, do not customise it, do not add an adjective, do not add a number anywhere in " +
      "the message, and do not split it across two paragraphs:",
    angle.finding(s),
    "",
    "‼️ THE MESSAGE ENDS ON THESE TWO SENTENCES, in this order, VERBATIM, as the final paragraph. " +
      "Do not reword them, do not add anything after them, and do not write a sign-off, a name, an " +
      "agency, or a signature of any kind:",
    DM_ASK_LINE,
    DM_CLOSE_LINE
  );

  if (s.topRival && NAME_COMPETITORS_IN_COLD_EMAIL && angle.needsRival) {
    lines.push(
      "",
      `The one rival you may name: ${s.topRival.name}, and it is already written into the fixed ` +
        "sentence above. Do not mention it a second time, and do not mention any other name that " +
        "appears in this brief. Every other name here is context for you alone."
    );
  } else {
    lines.push("", "You may NOT name any competitor in this message.");
  }

  // ‼️ The site tease is not offered on this lane at all. It is the email's move: it works there
  // because an email has room to withhold something and still explain why it matters. In four
  // sentences it is a tease with no substance under it, so the rule here is simply "no".
  lines.push(
    "",
    "You must NOT say there is something on their own website working against them, and must not " +
      "tease any site finding. That belongs to the email lane and there is no room for it here."
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The draft
// ─────────────────────────────────────────────────────────────────────────────

export interface DmVariant {
  opener: DmOpenerId;
  body: string;
  /** False when the linter refused it. The caller MUST label it, never present it as sendable. */
  lintOk: boolean;
  findings: string[];
  /** Set when the model paraphrased the fixed finding line instead of reproducing it. */
  findingWarning: string | null;
  /** URLs the link policy stripped. A DM carries none. */
  removedLinks: string[];
}

export interface DmDraftSet {
  angle: DmAngle["id"];
  lane: DmFacts["kind"];
  variants: DmVariant[];
  /** True when NOT ONE variant survived the linter. The panel shows the set as rejected. */
  allRejected: boolean;
}

const VARIANT_DELIMITER = "===VARIANT===";

/**
 * Write the DM, in `count` variants.
 *
 * ONE model call produces all of them, rather than one call per variant. Three separate calls at
 * the same temperature converge on the same phrasing surprisingly often, since each drafts blind
 * to the others; asking for three in one pass lets the model see what it has already written and
 * move away from it, which is the actual requirement. It is also a third of the latency in front
 * of somebody sitting on a profile page waiting for a panel to fill in.
 *
 * Each variant is then linted INDIVIDUALLY. A set is not all-or-nothing: two good variants and one
 * that ran long is a useful result, and discarding the two would be worse than showing the third
 * as rejected. Only if every variant fails does the whole set retry, once, with the findings fed
 * back, which is the same budget draftWithLint gives the email lane.
 */
export async function draftDmVariants(
  facts: DmFacts,
  recipientFirstName?: string | null,
  count = 3,
  instructions?: string | null
): Promise<DmDraftSet> {
  const angle = pickDmAngle(facts);
  const s = dmSubjectOf(facts);
  const openers = DM_OPENERS.slice(0, Math.max(1, Math.min(count, DM_OPENERS.length)));
  const greeting = recipientFirstName?.trim()
    ? `Open the message with "Hey ${recipientFirstName.trim()}," on its own line.`
    : "Do not write a greeting at all: no first name was established, and 'Hey there' reads as a " +
      "blast. Start on the first sentence.";

  const system = [
    PERMISSION_PERSONA,
    // ‼️ CORRECTS THE PERSONA'S OPENING LINE, which says an audit was run. The same correction
    // hook-pitch.ts makes, for the same reason: four questions is not an audit, and a model that
    // believes otherwise writes "I ran your report" about a scan that produced no report.
    "SCOPE, and it is narrower than the line above implies: what was actually run is a handful of " +
      "buyer questions put to ChatGPT with web search on. You may say you ran a quick check on " +
      "what comes back. You may NOT call it an audit, a report, a full analysis, or a score of " +
      "theirs, because none of those were produced.",
    "SURFACE: this is an INSTAGRAM DIRECT MESSAGE, not an email. It is read in a narrow bubble on " +
      "a phone, from an account they do not follow, in about two seconds.",
    `THE ONE FINDING: ${angle.instruction}`,
    greeting,
    [
      "HARD CONSTRAINTS, these override every other instruction:",
      `1. Under ${DM_MAX_SENTENCES} sentences. Shorter is better. The reference message is four.`,
      "2. NO URLs, links, or attachments of any kind. Not one.",
      "3. NO price, no package, no monthly figure, no mention of what anything costs.",
      "4. NO subject line, NO sign-off, NO name at the end, NO agency name, NO signature block. " +
        "It is a chat message. It ends on the fixed closing sentences and nothing follows them.",
      "5. Exactly ONE question mark in the whole message, and it is the fixed ask.",
      "6. Exactly ONE finding, the one given to you. Do not list two facts.",
      "7. No emoji.",
    ].join("\n"),
    PARAGRAPH_RULES,
    VOICE_RULES,
    // ‼️ VOICE_RULES says "the finding is a number, state it once". True of the email and false
    // here: this lane deliberately carries no number, for the reason written above the DM block in
    // config/pitch.ts. Stated as an explicit override rather than left to be inferred, because a
    // rule and its exception in one breath is heard as the rule.
    "OVERRIDE of the voice rule about the finding being a number: this message contains NO number, " +
      "no fraction, no percentage and no count. The finding is the fixed sentence you were given.",
    STYLE_RULES,
    COMPLIANCE_RULES,
  ].join("\n");

  const build = (previous: LintFinding[]) =>
    [
      `What is actually known about this prospect. Use only this, invent nothing:\n${dmContext(facts, angle)}`,
      "",
      `Write ${openers.length} versions of this message. Every version states the SAME finding and ` +
        "reproduces the SAME fixed sentences verbatim. They differ ONLY in how they open. Do not " +
        "give different versions different findings.",
      ...openers.map((o, i) => `Version ${i + 1} (${o.id}): ${o.instruction}`),
      "",
      `Separate the versions with a line containing exactly ${VARIANT_DELIMITER} and nothing else. ` +
        "Do not number them in the output, do not label them, and write nothing before the first " +
        "version or after the last.",
      instructions
        ? `\nMatthew's instructions, verbatim. These OUTRANK the generic guidance above, follow them literally:\n"""\n${instructions}\n"""`
        : "",
      retryInstruction(previous),
    ]
      .filter(Boolean)
      .join("\n");

  const first = await produce(system, build([]), openers.length);
  let variants = await Promise.all(first.map((body, i) => finish(body, openers[i].id, angle, s)));

  // ONE retry, and only when nothing at all survived. A partial set is a usable result.
  if (variants.length > 0 && variants.every((v) => !v.lintOk)) {
    const previous: LintFinding[] = variants.flatMap((v) =>
      v.findings.map((detail) => ({ rule: "dm-length" as const, detail }))
    );
    const second = await produce(system, build(previous), openers.length);
    const retried = await Promise.all(
      second.map((body, i) => finish(body, openers[i]?.id ?? openers[0].id, angle, s))
    );
    if (retried.some((v) => v.lintOk)) variants = retried;
  }

  return {
    angle: angle.id,
    lane: facts.kind,
    variants,
    allRejected: variants.length === 0 || variants.every((v) => !v.lintOk),
  };
}

/** One model call, split on the delimiter, trimmed to the number of openers asked for. */
async function produce(system: string, user: string, want: number): Promise<string[]> {
  const { text } = await callClaudeText({
    model: model(),
    system,
    user,
    maxTokens: 900,
    // Higher than the email lane's 0.6 on purpose: the point of this call is materially different
    // openings. The claim itself is pinned in code, so temperature cannot move it.
    temperature: 0.9,
  });

  const parts = text
    .split(VARIANT_DELIMITER)
    .map((p) => p.trim())
    .filter(Boolean);

  // A model that ignored the delimiter returns one blob. One real variant beats three fabricated
  // splits, so this does not try to guess where the boundaries would have been.
  return parts.slice(0, want);
}

/** Guards, polish, and the lint verdict for one variant. */
async function finish(
  raw: string,
  opener: DmOpenerId,
  angle: DmAngle,
  s: DmSubject
): Promise<DmVariant> {
  const linked = enforceLinkPolicy(noDashes(stripVariantLabel(raw)), { mode: "none" });
  const polished = await polishBody(linked.text, { allowEmphasis: false });
  const body = polished.body.trim();

  const result = lintDraft({
    body,
    stage: "dm",
    // ‼️ BOTH DECLARED, so the tease rule does its job rather than sitting inert. This lane forbids
    // the site tease in the prompt; declaring a clean scan here means that if the model writes one
    // anyway, `robots-tease` rejects it rather than letting an unbacked claim through.
    siteSignals: [],
    robots: null,
  });

  return {
    opener,
    body,
    lintOk: result.ok,
    findings: result.findings.map((f) => `${f.rule}: ${f.detail}`),
    findingWarning: findingWarningFor(body, angle.finding(s)),
    removedLinks: linked.removed,
  };
}

/**
 * A "Version 2 (pretext):" header the model wrote despite being told not to.
 *
 * Stripped rather than rejected: it is a formatting slip in text that is otherwise fine, and
 * failing an entire good variant over a label the reader would never have seen is the wrong trade.
 * Narrow on purpose, so it can never eat a real first sentence.
 */
export function stripVariantLabel(s: string): string {
  return s.replace(/^\s*(?:version|variant|option)\s*\d*\s*(?:\([^)]*\))?\s*[:.-]\s*/i, "").trim();
}

/**
 * Did the draft actually keep the fixed finding line?
 *
 * ‼️ CHECKED IN CODE, because asking is not a guarantee, and NOT REPAIRED, because there is no safe
 * way to find and replace a sentence that was reworded. Identical reasoning to resultWarningFor()
 * in hook-pitch.ts: a bad splice is worse than a flagged one. It rides the Slack card, the timeline
 * note and the panel, so a reworded claim is visible before anybody presses send.
 *
 * Punctuation-tolerant, including the curly apostrophe: the fixed line contains "doesn't", and
 * format-guard is entitled to normalise that quote either way.
 */
export function findingWarningFor(body: string, want: string): string | null {
  const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/['’.,]/g, "").toLowerCase();
  if (normalize(body).includes(normalize(want))) return null;
  return `The fixed finding line was reworded. It must read exactly: "${want}". Check before sending.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Slack card.
 *
 * ‼️ IT PRINTS THE QUESTIONS AND THE VERDICTS ABOVE THE DRAFTS, for the reason formatHookCard
 * states: the message asserts one finding as fact, and the only way to know whether that fact is
 * right is to see what it came from. That matters MORE here than in the email lane, not less: an
 * email sits in Outlook until somebody presses send, and a DM goes out from a phone in four
 * seconds.
 */
export function formatDmCard(
  facts: DmFacts,
  set: DmDraftSet,
  profileUrl: string,
  leadUrl: string | null
): string {
  const s = dmSubjectOf(facts);
  const lines: string[] = [];

  lines.push(
    set.allRejected
      ? `:warning: *Instagram DM REJECTED by the linter* - *${s.businessName}*`
      : `:speech_balloon: *Instagram DM drafted* - *${s.businessName}*`
  );
  lines.push(`<${profileUrl}|Instagram profile>${leadUrl ? ` · <${leadUrl}|Open lead in CRM>` : ""}`);
  lines.push(
    s.measuredCount > 0
      ? `Appeared in ${s.appearedCount} of ${s.measuredCount} measured${
          s.questions.length !== s.measuredCount
            ? ` (${s.questions.length - s.measuredCount} question(s) got no answer)`
            : ""
        } · angle \`${set.angle}\` · lane \`${set.lane}\``
      : `No questions came back · angle \`${set.angle}\` · lane \`${set.lane}\``
  );

  if (s.questions.length) {
    lines.push("", "*Questions asked:*");
    for (const q of s.questions) {
      const verdict = q.appeared === null ? "no answer" : q.appeared ? "named" : "NOT named";
      const named = q.named.length ? ` · instead: ${q.named.join(", ")}` : "";
      lines.push(`• "${q.prompt}" → ${verdict}${named}`);
    }
  }

  if (s.topRival) lines.push("", `*Top rival:* ${s.topRival.name} (${s.topRival.count}x)`);

  for (const v of set.variants) {
    lines.push("", `*${v.opener}*${v.lintOk ? "" : "  :no_entry: REJECTED, do not send"}`);
    for (const f of v.findings) lines.push(`• ${f}`);
    if (v.findingWarning) lines.push(`:warning: ${v.findingWarning}`);
    if (v.removedLinks.length) lines.push(`Links stripped: ${v.removedLinks.join(", ")}`);
    lines.push(v.body);
  }

  return lines.join("\n");
}

/** The lead-timeline note. Plain text: the timeline renders no mrkdwn and no <url|label> links. */
export function formatDmNote(
  facts: DmFacts,
  set: DmDraftSet,
  profileUrl: string,
  slackUrl: string | null
): string {
  const s = dmSubjectOf(facts);
  const lines: string[] = [`Instagram profile: ${profileUrl}`];
  if (slackUrl) lines.push(`Card in Slack: ${slackUrl}`);

  lines.push(
    "",
    s.measuredCount > 0
      ? `Appeared in ${s.appearedCount} of ${s.measuredCount} measured questions. Angle: ${set.angle}. Lane: ${set.lane}.`
      : `No questions came back. Angle: ${set.angle}. Lane: ${set.lane}.`
  );

  for (const q of s.questions) {
    const verdict = q.appeared === null ? "no answer" : q.appeared ? "named" : "NOT named";
    const named = q.named.length ? ` Instead: ${q.named.join(", ")}.` : "";
    lines.push(`- "${q.prompt}" -> ${verdict}.${named}`);
  }

  if (s.topRival) lines.push("", `Top rival: ${s.topRival.name} (${s.topRival.count}x)`);

  for (const v of set.variants) {
    lines.push("", `[${v.opener}]${v.lintOk ? "" : " REJECTED BY THE LINTER, do not send:"}`);
    for (const f of v.findings) lines.push(`- ${f}`);
    if (v.findingWarning) lines.push(v.findingWarning);
    lines.push(v.body);
  }

  return lines.join("\n");
}
