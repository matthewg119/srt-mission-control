// The "No website" button: a mini visibility check, then one permission-stage email.
//
// A business with a Google Business Profile and nothing else is the best AEO lead SRT has, and
// until now the only way to pitch one was to run the full audit: a classification call plus 40
// engine calls plus five minutes of waiting, for a prospect nobody has spoken to yet. This is the
// cheap version of the same conversation. Three buyer questions, one email, about ninety seconds.
//
// ‼️ IT IS NOT A SECOND EMAIL PIPELINE. Every rule that governs cold email 1 governs this one,
// and they are IMPORTED, not restated: prePitchRules, PARAGRAPH_RULES, VOICE_RULES, STYLE_RULES,
// COMPLIANCE_RULES, the subject style, then noDashes + enforceLinkPolicy + polishBody +
// ensurePermissionClose + ensureSignoff on the way out, and lintDraft gating the whole thing.
// The workflow route's own header says why: a button that assembles its own prompt bypasses the
// linter, the price gate and the no-fabrication rules silently, and the failure looks like
// slightly worse copy rather than like a bug.
//
// ‼️ NEVER CLAIM WORK THAT WAS NOT DONE. The angles below divide into two groups by exactly one
// question: does the sentence assert that we asked an engine something? Those angles are offered
// ONLY when the engine calls actually ran and returned data. When they did not, the drafter falls
// back to the angles that rest solely on research, which is work that definitely happened. This
// is the same rule run-prompts.ts enforces with status:"no_data" and the same one the cold-call
// script enforces with "offer to look, never claim to have looked".

import { callClaudeText, callClaudeJSON } from "@/lib/claude-calls";
import { researchViaClaudeDetailed, isOwnDomain, type BusinessIdentity } from "./claude-research";
import { runOpenAI } from "./run-prompts";
import { buildAliases, isMentioned, isClientName } from "./mention-match";
import { extractRecommendedBatch } from "./extract-recommended";
import {
  prePitchRules,
  PARAGRAPH_RULES,
  VOICE_RULES,
  STYLE_RULES,
  COMPLIANCE_RULES,
  ensureSignoff,
  ensurePermissionClose,
  noWebsiteExample,
  PERMISSION_CLOSE,
  noDashes,
  enforceLinkPolicy,
  stripSignoff,
  type GuardedDraft,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import {
  auditSignatureHtml,
  buildPitchHtml,
  placeOutreachDraft,
  type PlacedDraft,
} from "./lead-pitch";
import { chooseOutreachMailbox, mailboxLine } from "@/lib/followup-operator/mailboxes";
import { toGraphMailbox } from "@/config/outreach-mailboxes";
import { microsoft } from "@/lib/microsoft";
import { draftWithLint, retryInstruction } from "./draft-linter";
import {
  NO_WEBSITE_LINE,
  NOTHING_TO_FIND_LINE,
  NAME_COMPETITORS_IN_COLD_EMAIL,
  type DmRival,
} from "@/config/pitch";

/** How many buyer questions the mini check runs. Three, not twenty: this is a door knock, and
 *  every question is a live engine call in front of a person waiting on a button. */
const MINI_PROMPT_COUNT = 3;

function model(): "claude-opus-4-7" | "claude-sonnet-4-6" {
  return "claude-sonnet-4-6";
}

// ─────────────────────────────────────────────────────────────────────────────
// The mini visibility check
// ─────────────────────────────────────────────────────────────────────────────

export interface MiniPromptResult {
  prompt: string;
  /** Did the engine name this business? Null when the call returned no data at all. */
  appeared: boolean | null;
  /** Businesses the engine named instead, best effort, in the order it gave them. */
  named: string[];
}

export interface MiniCheck {
  /**
   * ‼️ NULL IS A REAL STATE, not a failure to handle. It means research ran and found nothing
   * public that describes this business, which is the premise of the `nothing-to-find` angle.
   * Everything that reads this field must branch rather than defaulting, because a default here
   * would be a made-up fact about a prospect.
   */
  identity: BusinessIdentity | null;
  /** False when identity is null. Gates the three angles that quote research back at them. */
  researched: boolean;
  city: string | null;
  /**
   * ‼️ THE SHORT, BUYER-LANGUAGE TRADE THE PROMPTS WERE ACTUALLY BUILT FROM, and it exists because
   * the alternative was a paragraph in a chat bubble. dmSubjectOf used to read
   * `identity.whatTheyDo` directly, which is a whole sentence off the research call
   * ("Independent automotive repair and maintenance shop serving all makes..."). shortTrade was
   * applied only to the engine prompts and thrown away, so the string a printed line would
   * interpolate was never the string the questions were asked with. Storing what was asked means
   * the message and the measurement can never describe different trades.
   */
  trade: string | null;
  /** Where `trade` came from. "bio" beats "research": the bio is written by them. */
  tradeSource: "bio" | "research" | null;
  results: MiniPromptResult[];
  /** True when at least one engine call actually returned an answer. Gates every angle whose
   *  copy asserts that we asked an engine something. */
  enginesAnswered: boolean;
  /**
   * Businesses an engine named instead, ranked, counted ONCE PER ANSWER.
   *
   * ‼️ SOURCED BY extractRecommendedBatch AND NOTHING ELSE, which is what makes these names
   * printable in front of the person they are about. See the field doc on DmSubject.topRivals.
   */
  topRivals: DmRival[];
  /** The third-party page the engines and research lean on, if there is an obvious one. */
  platform: string | null;
}

/**
 * The three questions, derived mechanically from what research found.
 *
 * ‼️ Deliberately NOT model-written. classify.ts writes 20 questions because an audit is
 * measuring a whole buying journey; this is measuring one thing (do they show up when somebody
 * asks for their category locally), and a template cannot hallucinate a question about a service
 * they do not offer. It also means the question text is stable across runs, so two prospects in
 * the same trade are genuinely comparable.
 */
function miniPrompts(trade: string, city: string | null): string[] {
  const where = city ? ` in ${city}` : "";
  return [
    `Who are the best ${trade}${where}?`,
    `Who should I hire for ${trade}${where}?`,
    `Can you recommend a few ${trade}${where}?`,
  ].slice(0, MINI_PROMPT_COUNT);
}

// ‼️ namesFrom() WAS DELETED HERE, AND MUST NOT COME BACK (2026-08-25).
//
// It was a line-by-line regex over the engine's answer, and its own comment called it crude on the
// grounds that it only ever fed a prompt. That stopped being true: this lane now names rivals in a
// message a stranger reads, with a count attached, and a name good enough to steer a model is not
// good enough to put in front of the person it is about. Both lanes now use
// extractRecommendedBatch, which is the same extractor that fills audit_runs.recommended, so "who
// came back" means the same thing in a DM as it does in a report. See runMiniVisibilityCheck step 4
// and the field doc on DmSubject.topRivals.

/**
 * What a BUYER would type, read off their own Instagram bio.
 *
 * ‼️ THE BIO BEATS RESEARCH, and this exists because of a live run. leahskinmethod has no site and
 * research was handed "Leah" with no city, missed entirely, and produced no trade at all, so the
 * engine loop was skipped and the DM had nothing measured to say. Her bio, meanwhile, is explicit:
 *
 *     Skin Strategist x Laser Layering
 *     Advanced Skin @theplumproom
 *     Sciton Clinical Specialist @sciton
 *     BBL • Moxi • Morpheus • Skin
 *
 * ‼️ AND IT IS USELESS PASTED IN RAW, which is the whole reason this is a model call rather than a
 * substring. "BBL, Moxi and Morpheus" is device branding: it is what the practitioner is proud of
 * and it is not what a patient types. A buyer question has to read like a buyer wrote it, which is
 * shortTrade's job and is preserved here. "laser skin treatments" is the answer; a bullet list of
 * device names in a search query is not.
 *
 * Best-effort only, exactly like extractRecommendedBatch: it never throws, and a null falls through
 * to whatever research found. A wrong trade is a worse question than no question.
 */
async function tradeFromBio(bio: string | null | undefined, businessName: string): Promise<string | null> {
  const text = (bio ?? "").trim();
  if (text.length < 12) return null;

  try {
    const { data } = await callClaudeJSON<{ trade: string | null }>({
      model: "claude-haiku-4-5-20251001",
      system:
        "You are given an Instagram bio. Return the words a BUYER would type into ChatGPT when " +
        "looking for a business like this one, in the buyer's own language.\n" +
        "Rules, all of them hard:\n" +
        "- Two to five words, lowercase, plural where it reads naturally.\n" +
        "- NEVER a device, machine, product or brand name. A customer does not know them and would " +
        "not search for them. Say what the device DOES.\n" +
        "- NEVER the business's own name, a person's name, or an @handle.\n" +
        "- NEVER a job title, a credential, or how they describe themselves professionally.\n" +
        '- Return {"trade": null} when the bio does not say what they actually sell. A wrong guess ' +
        "is worse than nothing.\n" +
        'Example bio: "Sciton Clinical Specialist. BBL - Moxi - Morpheus" -> {"trade": "laser skin treatments"}',
      user: `Business name: ${businessName || "unknown"}\n\nBio:\n"""\n${text.slice(0, 1200)}\n"""`,
      schemaHint: '{ "trade": string | null }',
      maxTokens: 200,
      temperature: 0,
      validate: isUsableTrade,
    });
    return data.trade ? data.trade.trim().toLowerCase() : null;
  } catch (e) {
    console.error("[no-website] trade-from-bio failed:", (e as Error).message);
    return null;
  }
}

/**
 * ‼️ THE RULES ARE CHECKED IN CODE, not just stated in the prompt, because a prose guard is not a
 * guard and this string is interpolated into a sentence a stranger reads. Anything that smells like
 * a handle, a hashtag, a model number or a whole sentence is rejected outright, and rejection means
 * research supplies the trade instead.
 */
function isUsableTrade(v: unknown): v is { trade: string | null } {
  if (typeof v !== "object" || v === null || !("trade" in v)) return false;
  const t = (v as { trade: unknown }).trade;
  if (t === null) return true;
  if (typeof t !== "string") return false;
  const s = t.trim();
  if (s.length < 3 || s.length > 45) return false;
  if (/[@#"'|]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  const words = s.split(/\s+/);
  return words.length >= 2 && words.length <= 5;
}

/**
 * The outcome of a mini check.
 *
 * ‼️ ONLY A FAILED CALL IS `ok: false`. Three of researchViaClaude's four misses — found=false,
 * a profile too thin to classify from, and an answer that cited no sources — all say the same
 * thing about the prospect: nothing public describes this business. That is not an error, it is
 * THE finding, and it is the strongest one this lane can carry. A call that threw or timed out
 * says nothing about anybody and must never be dressed up as one. See ResearchMiss.
 */
export type MiniCheckOutcome =
  | { ok: true; check: MiniCheck }
  | { ok: false; detail: string };

/**
 * Identify the business, then ask three real buyer questions and record who came back.
 *
 * `opts.bioHint` is the prospect's own Instagram bio, threaded down from the extension panel. It
 * takes precedence over research for the trade, and it is what lets the questions run at all on a
 * prospect research could not identify. See tradeFromBio.
 *
 * When the business cannot be identified, this does NOT give up: it returns a check with
 * `identity: null` and `researched: false`, which pickAngle resolves to `nothing-to-find`. The
 * old behaviour — refuse outright, on the grounds that a pitch about a business we could not find
 * is a pitch about a business that might not exist — was right for the AUDIT, where the whole
 * report is built out of the profile. It is wrong here: this business is already a lead in the
 * CRM with a name, a phone number and an email on the row, so its existence is not in question.
 * What is in question is whether anything public describes it, and the answer came back no.
 */
export async function runMiniVisibilityCheck(
  businessName: string,
  city?: string | null,
  opts?: { bioHint?: string | null }
): Promise<MiniCheckOutcome> {
  const { result: found, miss } = await researchViaClaudeDetailed(
    { kind: "name", name: businessName, city: city ?? undefined },
    null
  );

  // The one miss that is about our infrastructure rather than about them.
  if (!found && miss === "call_failed") {
    return { ok: false, detail: "The research call failed before it returned anything." };
  }

  // ‼️ A RESEARCH MISS NO LONGER RETURNS EARLY, and that early return was the whole defect.
  //
  // It used to hand back `results: []` on the grounds that no trade was learned, so there was no
  // buyer question to ask. That reasoning was right about RESEARCH and wrong about the prospect:
  // their own Instagram bio often says exactly what they sell, and it is a better source than
  // research inference because they wrote it. leahskinmethod is the live case - research was given
  // "Leah" with no city, missed, and the DM went out having measured nothing at all.
  //
  // `researched` and `enginesAnswered` are now genuinely independent. Everything downstream must
  // branch on the one it actually needs rather than treating either as a proxy for the other.
  const identity = found?.identity ?? null;
  const resolvedCity =
    city?.trim() ||
    (identity ? [identity.city, identity.state].filter(Boolean).join(", ") : "") ||
    null;

  const bioTrade = await tradeFromBio(opts?.bioHint, businessName);
  const researchTrade = identity?.whatTheyDo ? shortTrade(identity.whatTheyDo) : null;
  const trade = bioTrade ?? researchTrade;
  const tradeSource: MiniCheck["tradeSource"] = bioTrade ? "bio" : researchTrade ? "research" : null;

  const aliases = buildAliases(identity?.tradingName ?? businessName, null);

  // 1. Ask the engines, when there is a real trade to ask about. A question about the wrong trade
  //    is worse than no question, so a null trade still means no questions.
  let raw: Array<{ prompt: string; appeared: boolean | null; text: string }> = [];
  if (trade) {
    const prompts = miniPrompts(trade, resolvedCity);
    raw = await Promise.all(
      prompts.map(async (prompt) => {
        const r = await runOpenAI(prompt, resolvedCity);
        // status:"no_data" is a real answer meaning "we do not know", never "they were absent".
        // Conflating the two would let a dead API key read as a finding about the prospect.
        if (r.status !== "ok" || !r.raw) return { prompt, appeared: null as boolean | null, text: "" };
        // ‼️ AN EMPTY ALIAS SET MEANS "WE COULD NOT LOOK", NEVER "THEY WERE ABSENT". This lane
        // builds aliases off a name alone, with no domain, because there is no site - and
        // buildAliases returns [] for a name it cannot get a usable token out of. isMentioned then
        // returns false, and recording that as `appeared: false` writes a fabricated absence into
        // missCount, which is now a printed claim. Same guard, same reason, as hook-pitch.ts.
        if (aliases.length === 0) return { prompt, appeared: null as boolean | null, text: r.raw };
        return { prompt, appeared: isMentioned(r.raw, aliases), text: r.raw };
      })
    );
  }

  // 2. Who came back instead. ONE Haiku call over the whole batch, the same extractor the real
  //    audit uses to fill audit_runs.recommended. The ids index the FILTERED array, which is why
  //    the read side below walks its own cursor rather than reusing the loop index.
  const extracted = await extractRecommendedBatch(
    raw.filter((r) => r.text).map((r, i) => ({ id: String(i), text: r.text }))
  );

  const results: MiniPromptResult[] = [];
  const rivalCounts = new Map<string, { display: string; count: number }>();
  let cursor = 0;
  for (const r of raw) {
    let named: string[] = [];
    if (r.text) {
      named = (extracted[String(cursor)] ?? [])
        .map((n) => n.trim())
        .filter((n) => n && !isClientName(n, aliases));
      cursor += 1;
      // Count each rival ONCE PER ANSWER, the way report-view.ts ranks mostRecommended, so a count
      // in the DM is a number of answers and never a number of mentions.
      for (const name of new Set(named.map((n) => n.toLowerCase()))) {
        const display = named.find((n) => n.toLowerCase() === name) ?? name;
        const existing = rivalCounts.get(name);
        if (existing) existing.count += 1;
        else rivalCounts.set(name, { display, count: 1 });
      }
    }
    results.push({ prompt: r.prompt, appeared: r.appeared, named });
  }

  const topRivals: DmRival[] = [...rivalCounts.values()]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ name: r.display, count: r.count }));

  const platform =
    identity?.websites.find((w) => !isOwnDomain(w, identity.tradingName ?? businessName)) ?? null;

  return {
    ok: true,
    check: {
      identity,
      researched: Boolean(identity),
      city: resolvedCity,
      trade,
      tradeSource,
      results,
      enginesAnswered: results.some((r) => r.appeared !== null),
      topRivals,
      platform,
    },
  };
}

/** "Independent automotive repair and maintenance shop serving all makes..." -> "auto repair
 *  shops". A whole paragraph in a buyer question reads like a press release. */
function shortTrade(whatTheyDo: string): string {
  const first = whatTheyDo.split(/[.,;]/)[0].trim().toLowerCase();
  return first.length > 60 ? first.slice(0, 60).trim() : first;
}

// ─────────────────────────────────────────────────────────────────────────────
// The angles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ THREE ANGLES, PICKED BY WHAT THE CHECK ACTUALLY FOUND, not by the model's preference.
 *
 * They differ by ANGLE, never by wording — three phrasings of one idea is one option printed
 * three times, and it leaves nothing to fall back on when the first does not land. Same rule the
 * call-script cards are held to.
 *
 * `needsEngines` is the honesty gate described in the file header. An angle that says "I asked
 * ChatGPT" may only be offered when an engine actually answered.
 */
interface Angle {
  id: string;
  needsEngines: boolean;
  needsCompetitor: boolean;
  /**
   * ‼️ THE MIRROR GATE. needsEngines/needsCompetitor say "only offer this when we HAVE something";
   * this one says "only offer this when we have NOTHING". It has to be its own flag rather than
   * the negation of the others, because it is a different claim: an angle can rest on research
   * without touching an engine (written-by-others does), and that angle is a lie when there was
   * no research to rest on.
   */
  needsUnresearched: boolean;
  /** The single finding this email is built around, written as an instruction to the drafter. */
  finding: string;
}

const ANGLES: Angle[] = [
  {
    // Research came back empty. FIRST in the list but reachable only when researched is false,
    // so it can never displace a measured angle — it is the only thing sayable when it fires,
    // and there is nothing weaker to fall through to.
    id: "nothing-to-find",
    needsEngines: false,
    needsCompetitor: false,
    needsUnresearched: true,
    finding:
      "The finding is exactly this and nothing more: " +
      NOTHING_TO_FIND_LINE +
      ". State it as something you did and what it turned up, never as a verdict on them. You " +
      "must NOT say they are invisible, that they do not exist online, that they have no Google " +
      "listing, no reviews and no directory entries, or that nobody can find them. You looked, " +
      "and there was nothing readable to build a description out of. That is the whole finding.",
  },
  {
    // Option 1 in the approved set: absence, proven by a list of names.
    id: "substitute",
    needsEngines: true,
    needsCompetitor: true,
    needsUnresearched: false,
    finding:
      "The finding is that you asked the engine who does this locally, it named other businesses, " +
      "and this prospect was not one of them. State how many names came back and name one of them. " +
      "Then say plainly why: they have no site of their own, so there is nothing of theirs to read.",
  },
  {
    // Option 6: the same absence, aimed at the question with buying intent behind it.
    id: "buying-question",
    needsEngines: true,
    needsCompetitor: false,
    needsUnresearched: false,
    finding:
      "The finding is that somebody asking who to hire has already decided to buy, and the engine " +
      "answered that question without this business in it. State the question you asked and that " +
      "they were not in the answer. Do not list every name that was.",
  },
  {
    // Option 5/10: rests only on research, so it is always sayable.
    id: "written-by-others",
    needsEngines: false,
    needsCompetitor: false,
    needsUnresearched: false,
    finding:
      "The finding is that every description of this business an engine can find was written by " +
      "somebody else: a directory, a review site, a listing. Name the specific page the research " +
      "found if there is one. Nothing describing them was written by them.",
  },
];

/** Pick the strongest angle the evidence actually supports. Order matters: the list is strongest
 *  first, and the first one whose preconditions hold wins. */
export function pickAngle(check: MiniCheck): Angle {
  // Reads topRivals rather than results[].named so the email lane and the DM lane agree on what
  // counts as "a competitor we can name". `?? []` covers rows written before topRivals existed.
  const hasCompetitor = (check.topRivals ?? []).length > 0;
  for (const a of ANGLES) {
    // Both directions, and both are required. An unresearched angle offered to a prospect we DID
    // research throws away everything we learned; a researched angle offered when we learned
    // nothing invents the thing it is built on.
    if (a.needsUnresearched && check.researched) continue;
    if (!a.needsUnresearched && !check.researched) continue;
    if (a.needsEngines && !check.enginesAnswered) continue;
    if (a.needsCompetitor && !(hasCompetitor && NAME_COMPETITORS_IN_COLD_EMAIL)) continue;
    // An "absence" angle is a lie if they actually showed up. Fall through to the research angle,
    // which is true either way.
    if (a.needsEngines && check.results.every((r) => r.appeared === true)) continue;
    return a;
  }
  // The last entry is the research-only angle, which needs research. Reaching here without any is
  // the one case the fallback cannot serve, so name the nothing-to-find angle explicitly rather
  // than letting an index hand a prospect an email about sources that were never found.
  return check.researched ? ANGLES[ANGLES.length - 1] : ANGLES[0];
}

/** Everything the drafter is allowed to treat as fact, rendered for the prompt. Mirrors
 *  reportContext() in email-assistant.ts, which does the same job for an audited prospect. */
export function miniCheckContext(check: MiniCheck, fallbackName?: string): string {
  const id = check.identity;

  // ‼️ The unresearched branch is DELIBERATELY THIN, and the thinness is the guard. The only
  // facts that exist are the ones Matthew typed into the CRM and the fact that a search turned up
  // nothing readable. Handing the model anything more — a guessed trade, a category, a plausible
  // description — would be handing it the exact sentence this angle exists to avoid. Absent beats
  // forbidden, same doctrine as the price gate and the engines-silent branch below.
  if (!id) {
    return [
      `Business: ${(fallbackName ?? "").trim() || "unknown"} (the name as recorded in the CRM)`,
      `City: ${check.city ?? "unknown"}`,
      `They have NO website of their own. ${NO_WEBSITE_LINE}.`,
      "",
      "RESEARCH FOUND NOTHING. A web search for this business returned no public source that " +
        "describes what they do, so there is no profile, no category, no service list and no " +
        "third-party page below. You know their name, their city, and that fact. Everything you " +
        "write must rest on those three things.",
      "",
      // ‼️ THIS USED TO OPEN "NO ENGINE QUESTIONS WERE RUN", AND THAT BECAME A LIE (2026-08-25).
      //
      // A trade read off their own Instagram bio is enough to ask a real buyer question, so this
      // branch can now arrive with measured answers in hand. The PROHIBITION is still exactly
      // right - the angle this branch resolves to is `nothing-to-find`, whose whole finding is
      // that research turned up nothing readable, and an email that also reports an engine result
      // is an email with two findings. So the rule stays and the false statement of fact goes:
      // this says what the drafter may not do, without asserting something about the run that may
      // not be true. The results are withheld rather than shown, which is the same
      // absent-beats-forbidden move the price gate makes.
      "The engine questions, if any ran, are NOT this email's material. You must NOT write that " +
        "you asked ChatGPT anything, that you ran anything, or that you saw who came up instead. " +
        "Everything you write must rest on the fact that nothing readable came back.",
      "",
      "You must NOT state or imply that they have no Google listing, no reviews, no directory " +
        "entry, or no presence anywhere at all. You do not know any of that and they can check it " +
        "in ten seconds. What you know is that nothing readable came back.",
    ].join("\n");
  }

  const lines: string[] = [
    `Business: ${id.tradingName ?? "unknown"}`,
    `What they do: ${id.whatTheyDo ?? "unknown"}`,
    `City: ${check.city ?? "unknown"}`,
    `They have NO website of their own. ${NO_WEBSITE_LINE}.`,
  ];

  if (check.platform) lines.push(`The third-party page describing them: ${check.platform}`);

  lines.push("", ...engineBlock(check));

  return lines.join("\n");
}

/**
 * What the drafter may say about the engine questions, in the one shape both branches share.
 *
 * Absent beats forbidden, the same doctrine as the price gate: a model handed engine results it
 * must not cite will cite them. When there are none, there is nothing to cite. When there ARE some,
 * saying there are none is the mirror error and just as bad.
 */
function engineBlock(check: MiniCheck): string[] {
  if (!check.enginesAnswered) {
    return [
      "NO ENGINE QUESTIONS WERE RUN for this prospect. You must NOT write that you asked ChatGPT " +
        "anything, that you ran anything, or that you saw who came up instead. Everything you say " +
        "must rest on the research above.",
    ];
  }

  const out = [`Questions actually asked of the engine (${check.results.length}):`];
  for (const r of check.results) {
    const verdict =
      r.appeared === null
        ? "no answer came back, so this question proves nothing"
        : r.appeared
          ? "they WERE named"
          : "they were NOT named";
    const named = r.named.length ? ` Named instead: ${r.named.join(", ")}.` : "";
    out.push(`- "${r.prompt}" -> ${verdict}.${named}`);
  }
  return out;
}

/**
 * Put the pitch into Matthew's Outlook drafts, signed the way every other SRT email is.
 *
 * ‼️ THE COMPOSITION IS COPIED FROM ensureOutlookDraft() IN thread-assistant.ts AND MUST STAY
 * IDENTICAL: stripSignoff on the body, auditSignatureHtml() for the block, buildPitchHtml to
 * marry them. That is what makes this email render exactly like the audit-lane one rather than
 * approximately like it.
 *
 * Two pieces of that are easy to get wrong on their own:
 *   - The signature is ATTACHED here, not added by Outlook. A draft created through Graph is
 *     never composed in the client, so nothing auto-inserts a sign-off; without this the draft
 *     opens with the body's bare "Matthew Garcia" and no block under it.
 *   - auditSignatureHtml() supplies the plain pitch block. It is NOT the branded one with the
 *     logo and the CTA button; see the note on that function for why the Outlook lookup it used
 *     to do never worked.
 * stripSignoff then takes the whole plain-text sign-off off the body, name included, because
 * the block carries the name too and the draft would otherwise print it twice.
 *
 * Like email 1 in the audit thread, this goes into whichever mailbox still has send headroom
 * today rather than into a fixed one. It used to be drafted into both mailboxes at once, which
 * spread no volume and left two copies to clean up.
 *
 * Returns [] rather than throwing: a draft that could not be created is worth a line on the
 * timeline note, not a lost pitch. The note carries the full text either way, and mailboxNote
 * carries the reason — see the catch below.
 */
export async function createPitchDraft(
  draft: NoWebsiteDraft,
  to: string | null
): Promise<{ placed: PlacedDraft[]; mailboxNote: string }> {
  if (!draft.body || draft.rejectedFindings.length > 0) return { placed: [], mailboxNote: "" };
  try {
    const { chosen, headroom } = await chooseOutreachMailbox();
    // Every mailbox at its cap: place nothing and report why. The note still carries the full
    // text, so the pitch is not lost, it just does not become a draft today.
    if (!chosen) return { placed: [], mailboxNote: mailboxLine(null, headroom) };

    const html = buildPitchHtml(stripSignoff(draft.body), await auditSignatureHtml());
    const { placed, failed } = await placeOutreachDraft({
      to: to ?? undefined,
      subject: draft.subject,
      html,
      mailboxes: [toGraphMailbox(chosen.address)],
    });
    for (const f of failed) console.warn(`[no-website-pitch] no copy in ${f.mailbox}: ${f.error}`);
    return { placed, mailboxNote: mailboxLine(chosen, headroom) };
  } catch (e) {
    // ‼️ THE REASON GOES IN THE NOTE, not only into a log nobody reads. This used to return an
    // empty mailboxNote, so a Graph outage, an expired token or a signature lookup blowing up all
    // produced a timeline entry saying no draft was placed and nothing about why — which reads as
    // "the button is broken" and is unactionable. Still returns rather than throwing: a draft that
    // could not be created is worth a line on the note, not a lost pitch, and the note carries the
    // full text either way.
    const message = (e as Error).message;
    console.error("[no-website-pitch] Outlook draft failed:", message);
    return { placed: [], mailboxNote: `No draft created: Outlook refused it (${message}). The text is below.` };
  }
}

/**
 * The lead-timeline note. Everything about this run, as plain text.
 *
 * ‼️ IT PRINTS THE QUESTIONS AND THE VERDICTS ABOVE THE DRAFT, not just the draft. The email
 * states one finding as fact, and the only way to know whether that fact is right is to see what
 * it came from. Printing the draft alone would make a wrong finding invisible until the prospect
 * corrects it. Same reason the prompt drop prints all 20 questions.
 *
 * ‼️ THIS WAS A SLACK CARD, AND THE SLACK VERSION IS DELETED RATHER THAN KEPT ALONGSIDE. This
 * lane has no audit and therefore no audit thread, so #ai-visibility-audits was only ever a
 * channel the pitch was dropped into: the timeline note said "the draft lands in
 * #ai-visibility-audits" and then showed nothing but a subject and a body, so the answer to
 * "where is my email" was a channel that exists for audits this lead can never have. Two
 * formatters would drift. There is one, and it renders for the place the work is read.
 *
 * Plain text: no Slack mrkdwn, no <url|label> links, because the timeline renders neither.
 */
export function formatNoWebsitePitchNote(
  businessName: string,
  check: MiniCheck,
  draft: NoWebsiteDraft,
  drafts: PlacedDraft[] = [],
  mailboxNote = ""
): string {
  const lines: string[] = [];

  // ‼️ THE MAILBOX LINE IS FIRST AND PRINTS IN EVERY STATE, including the one where nothing was
  // drafted. "Every mailbox is at its daily cap, tomorrow" is the single most important thing
  // this note can say, and it used to be said only on a Slack card nobody opened.
  if (mailboxNote) lines.push(mailboxNote);
  for (const d of drafts) lines.push(`Open in ${d.mailbox ?? "your inbox"}: ${d.url}`);
  if (lines.length) lines.push("");

  // Research routinely resolves a fuller trading name than the one typed into the CRM, and
  // pitchSubject() uses THAT one, so the subject can read differently from the lead's name for a
  // legitimate reason — or because the research matched the wrong business. Printing it is how
  // the second case gets caught before the send rather than by the recipient.
  const resolved = check.identity?.tradingName?.trim();
  if (resolved && resolved.toLowerCase() !== businessName.trim().toLowerCase()) {
    lines.push(`Researched as: ${resolved}${check.city ? ` · ${check.city}` : ""}`, "");
  }

  if (check.enginesAnswered) {
    lines.push(`Asked the engine ${check.results.length} buyer questions:`);
    for (const r of check.results) {
      const verdict = r.appeared === null ? "no answer" : r.appeared ? "NAMED" : "not named";
      const named = r.named.length ? ` (got: ${r.named.slice(0, 3).join(", ")})` : "";
      lines.push(`- ${r.prompt} — ${verdict}${named}`);
    }
  } else if (!check.researched) {
    // Said out loud, because it is both what the email is built on and what it is forbidden from
    // exceeding. A reader who does not know research came back empty cannot tell this draft from
    // a measured one, and so cannot catch it overclaiming.
    lines.push(
      "Research found no public source describing this business, so no buyer questions were run. " +
        "The draft rests on that alone and claims nothing about what came up."
    );
  } else {
    lines.push(
      "No engine questions ran, so the draft rests on research alone and claims nothing about " +
        "what came up."
    );
  }

  if (check.platform) lines.push("", `Third-party page describing them: ${check.platform}`);
  lines.push(`Angle: ${draft.angle}`);

  if (draft.rejectedFindings.length) {
    lines.push(
      "",
      "THE LINTER REJECTED THIS DRAFT. It is not approved, nothing was placed in Outlook, and it " +
        "must not be sent as is.",
      ...draft.rejectedFindings.map((f) => `- ${f}`)
    );
  }
  if (draft.removedLinks.length) {
    lines.push("", `Links stripped (permission stage carries none): ${draft.removedLinks.join(", ")}`);
  }
  if (draft.formatNote) lines.push("", draft.formatNote);

  lines.push("", `Subject: ${draft.subject}`, "", draft.body);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The draft
// ─────────────────────────────────────────────────────────────────────────────

const PERSONA = [
  "You write cold outreach for SRT Agency, which makes local businesses findable in AI search.",
  "This prospect has no website at all. That is the premise of the email, not a discovery.",
  "They have never heard of you and did not ask for this.",
].join("\n");

/**
 * The subject is a CONSTANT SHAPE, not something the model writes.
 *
 * `Duran Construction + ChatGPT`. Same precedent as PERMISSION_CLOSE and the call script's
 * NOT_SELLING_LINE: a model merely ASKED for this shape produces a different subject every run
 * ("AI search and Michoacana 3mendos Tacos in Charlotte", "who came up instead"), and the point
 * of this one is that it is the same two words every time, so the thread is recognisable in a
 * mailbox at a glance and reads as a note rather than a campaign.
 *
 * The business name comes from RESEARCH first, because the trading name sources actually use is
 * the one the owner recognises; what Matthew typed into the CRM is the fallback.
 */
export function pitchSubject(businessName: string): string {
  return `${businessName.trim()} + ChatGPT`;
}

export function parseSubjectAndBody(text: string): { subject: string; body: string } {
  const m = /^\s*subject:\s*(.+?)\s*\n([\s\S]*)$/i.exec(text.trim());
  if (m) return { subject: m[1].trim(), body: m[2].trim() };
  return { subject: "", body: text.trim() };
}

/**
 * Drop a close the model copied out of its own instructions.
 *
 * ‼️ MEASURED, not theoretical. prePitchRules() tells the model not to write the close by
 * QUOTING both lines at it, and a live draft came back having reproduced them verbatim, in
 * quotation marks, mid-body. ensurePermissionClose then appended the real close underneath, so
 * the email said it twice and carried two question marks, which is itself a linter failure.
 *
 * ensurePermissionClose's own CLOSE_ATTEMPT_RE does not catch this: it anchors on the first word
 * ("i recorded", "want me to"), and a line that opens with a quotation mark never matches. Rather
 * than loosen a regex the whole cold lane depends on, this strips only the exact echo, with or
 * without surrounding quotes, and leaves everything else to the shared guard.
 */
export function stripEchoedClose(body: string): string {
  const escaped = PERMISSION_CLOSE.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const echo = new RegExp(`^\\s*["'“”']*\\s*(?:${escaped.join("|")})\\s*["'“”']*\\s*$`, "i");
  return body
    .split(/\n{2,}/)
    .filter((para) => !echo.test(para.trim()))
    .join("\n\n")
    .trim();
}

/** A salutation line, however the model chose to open. Short by definition: a greeting is a few
 *  words, so the length cap is what stops a real opening sentence being eaten as one. */
const SALUTATION_RE = /^(hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^\n]{0,40}$/i;
/** `Rafael,` — a bare name and a comma, which is what the model wrote before this was in code. */
const BARE_NAME_GREETING_RE = /^[^\n]{1,40},$/;

/**
 * Put the greeting on in CODE.
 *
 * ‼️ SAME PRECEDENT AS PERMISSION_CLOSE, AND FOR THE SAME MEASURED REASON. The prompt told the
 * model the first line was to be exactly "`{name},`" with no "Hi", no "Hello", no "Dear" — and a
 * live draft to New Generation Services opened "Hey Ale," anyway. That one reads better, which is
 * the point: a shape wanted on every single email is not something to ask for once per run and
 * hope for. Asked, it varies. Appended, it does not.
 *
 * Whatever the model wrote is stripped first, in either shape, so the email cannot end up greeting
 * twice. A paragraph is only treated as a greeting when it is short AND ends the way one does; an
 * opening sentence is neither.
 *
 * No first name means NO greeting rather than a guess. "Hey there," is a mail merge on the one
 * line that decides whether the rest is read, and greeting the BUSINESS is worse.
 *
 * ‼️ `fallback` OPTS ONE LANE OUT OF THAT LAST RULE, and it is opt-in for a reason. The hook lane
 * passes "Hello," (Matthew's call, 2026-08-22) because a bare finding with no greeting at all reads
 * as a fragment when it opens on a pretext sentence rather than on the finding itself. "Hello," is
 * not "Hey there,": it claims no familiarity and merges nothing, which is what made "Hey there,"
 * unusable. Every other lane passes nothing and keeps the no-greeting rule above, unchanged.
 */
export function ensureGreeting(
  body: string,
  firstName?: string | null,
  fallback?: string
): string {
  const paras = body.split(/\n{2,}/);
  const first = paras[0]?.trim() ?? "";
  const looksLikeGreeting =
    SALUTATION_RE.test(first) || (BARE_NAME_GREETING_RE.test(first) && first.split(/\s+/).length <= 4);
  if (looksLikeGreeting) paras.shift();

  const rest = paras.join("\n\n").trim();
  const name = firstName?.trim();
  if (name) return `Hey ${name},\n\n${rest}`;
  return fallback ? `${fallback}\n\n${rest}` : rest;
}

/**
 * The no-website permission email.
 *
 * Same shape as draftPermissionEmail: one finding, one ask, no price, no links. The close and the
 * sign-off are appended in CODE rather than written by the model, for the reason PERMISSION_CLOSE
 * documents — asked merely to include a line, a model rewrites it every take, and a hand-edit once
 * shipped two sentences collapsed into one.
 */
export interface NoWebsiteDraft extends GuardedDraft {
  angle: string;
  /** Populated when the linter refused every attempt. The body is then the last REJECTED
   *  attempt, and the caller must post it labelled as rejected, never as an approved draft. */
  rejectedFindings: string[];
}

export async function draftNoWebsitePitch(
  check: MiniCheck,
  fallbackName: string,
  /** The human's first name, for the greeting. Null greets nobody rather than guessing. */
  recipientFirstName?: string | null,
  instructions?: string | null
): Promise<NoWebsiteDraft> {
  const angle = pickAngle(check);
  // Research's trading name first: it is the one the owner's own sources use.
  const subject = pitchSubject(check.identity?.tradingName ?? fallbackName);

  const gated = await draftWithLint(
    async (_attempt, previous) => {
      const { text } = await callClaudeText({
        model: model(),
        system: [
          PERSONA,
          "This is the very first touch. Its only job is to earn a yes to sending the video.",
          `THE ONE FINDING: ${angle.finding}`,
          // No redesign is ever in play on this lane, so the link policy is `none` and the rules
          // are built for the linkless shape.
          prePitchRules(null),
          // ‼️ THE SHAPE, not just the rules. Without a reference email this lane's drafts
          // reworded themselves every run; see the header on NO_WEBSITE_EXAMPLE.
          noWebsiteExample(),
          PARAGRAPH_RULES,
          VOICE_RULES,
          STYLE_RULES,
          // ‼️ SUBJECT_LINE_INSTRUCTION is deliberately NOT here. The subject is fixed by
          // pitchSubject() in code, and a model given both an instruction to write one and a
          // constant that overwrites it spends tokens on a line nobody reads. Told to write no
          // subject at all, it also stops opening the body with a restatement of one.
          "Do NOT write a subject line. A subject is added for you; start with the greeting.",
          // ‼️ The greeting is APPENDED IN CODE by ensureGreeting() and is no longer the model's
          // to write. Told to write one, it wrote a different one every run; told to write none,
          // it also stops opening the body with a restatement of it. Same move as the subject.
          "GREETING: do NOT write one. A greeting is added for you. Start on your first finding " +
            "sentence. Never greet the business by its name.",
          COMPLIANCE_RULES,
        ].join("\n"),
        user: [
          `What is actually known about this prospect. Use only this, invent nothing:\n${miniCheckContext(check, fallbackName)}`,
          instructions
            ? `\nMatthew's instructions for this outreach. These OUTRANK the generic guidance above, follow them literally:\n"""\n${instructions}\n"""`
            : "",
          retryInstruction(previous),
          "\nWrite the email now.",
        ]
          .filter(Boolean)
          .join("\n"),
        maxTokens: 700,
        temperature: 0.6,
      });

      const parsed = parseSubjectAndBody(text);
      return { subject: parsed.subject, body: parsed.body };
    },
    (d) => ({
      body: d.body,
      subject: d.subject,
      stage: "draft-1" as const,
      // Both null, and that is load-bearing rather than lazy. null means "nobody looked at their
      // site", which is exactly true when there is no site, and it is what makes the draft linter
      // reject the "something on your own site" tease with no extra rule. [] would claim we
      // scanned a site and found it clean. Same tri-state contract as a declared audit run.
      siteSignals: null,
      robots: null,
    })
  );

  // ‼️ A refused draft is still returned, labelled. draftWithLint retains the last rejected
  // attempt precisely so a refusal can show its work: three reasons and no text leaves the
  // operator with nothing to act on, which is the failure that made it retain them.
  const chosen = gated.draft ?? gated.lastRejected;
  if (!chosen) {
    return {
      angle: angle.id,
      subject,
      body: "",
      removedLinks: [],
      formatNote: null,
      rejectedFindings: gated.findings.map((f) => `${f.rule}: ${f.detail}`),
    };
  }

  const body = enforceLinkPolicy(noDashes(chosen.body), { mode: "none" });
  const polished = await polishBody(stripEchoedClose(body.text), { allowEmphasis: false });

  return {
    angle: angle.id,
    subject,
    // Greeting first so the close and the sign-off are appended below it, not above it.
    body: ensureSignoff(ensurePermissionClose(ensureGreeting(polished.body, recipientFirstName))),
    removedLinks: body.removed,
    formatNote: polished.note,
    rejectedFindings: gated.draft ? [] : gated.findings.map((f) => `${f.rule}: ${f.detail}`),
  };
}
