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

import { callClaudeText } from "@/lib/claude-calls";
import { researchViaClaude, isOwnDomain, type BusinessIdentity } from "./claude-research";
import { runOpenAI } from "./run-prompts";
import { buildAliases, isMentioned } from "./mention-match";
import {
  prePitchRules,
  PARAGRAPH_RULES,
  VOICE_RULES,
  STYLE_RULES,
  COMPLIANCE_RULES,
  SUBJECT_LINE_INSTRUCTION,
  ensureSignoff,
  ensurePermissionClose,
  PERMISSION_CLOSE,
  noDashes,
  enforceLinkPolicy,
  type GuardedDraft,
} from "./email-assistant";
import { polishBody } from "./format-guard";
import { draftWithLint, retryInstruction } from "./draft-linter";
import { NO_WEBSITE_LINE, NAME_COMPETITORS_IN_COLD_EMAIL } from "@/config/pitch";

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
  identity: BusinessIdentity;
  city: string | null;
  results: MiniPromptResult[];
  /** True when at least one engine call actually returned an answer. Gates every angle whose
   *  copy asserts that we asked an engine something. */
  enginesAnswered: boolean;
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

/** Pull the business names an engine listed. Crude on purpose: it feeds a prompt, never a claim
 *  with a number attached, and a parser that guessed harder would be a parser that guessed. */
function namesFrom(raw: string, aliases: string[]): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    // Numbered or bulleted list items are where recommendations live.
    const m = /^\s*(?:\d+[.)]|[-*•])\s*(?:\*\*)?([^*\n:(]{3,60}?)(?:\*\*)?\s*(?::|$|\()/.exec(line);
    if (!m) continue;
    const name = m[1].trim().replace(/[.,;]$/, "");
    if (!name || isMentioned(name, aliases)) continue;
    if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 5);
}

/**
 * Identify the business, then ask three real buyer questions and record who came back.
 *
 * Returns null only when the business cannot be identified at all — the same refusal
 * researchViaClaude makes, for the same reason. A pitch written about a business we could not
 * find is a pitch about a business that might not exist.
 */
export async function runMiniVisibilityCheck(
  businessName: string,
  city?: string | null
): Promise<MiniCheck | null> {
  const found = await researchViaClaude({ kind: "name", name: businessName, city: city ?? undefined }, null);
  if (!found) return null;

  const identity = found.identity;
  const resolvedCity =
    city?.trim() || [identity.city, identity.state].filter(Boolean).join(", ") || null;

  const trade = identity.whatTheyDo ? shortTrade(identity.whatTheyDo) : null;
  const aliases = buildAliases(identity.tradingName ?? businessName, null);

  let results: MiniPromptResult[] = [];
  if (trade) {
    const prompts = miniPrompts(trade, resolvedCity);
    results = await Promise.all(
      prompts.map(async (prompt): Promise<MiniPromptResult> => {
        const r = await runOpenAI(prompt, resolvedCity);
        // status:"no_data" is a real answer meaning "we do not know", never "they were absent".
        // Conflating the two would let a dead API key read as a finding about the prospect.
        if (r.status !== "ok" || !r.raw) return { prompt, appeared: null, named: [] };
        return { prompt, appeared: isMentioned(r.raw, aliases), named: namesFrom(r.raw, aliases) };
      })
    );
  }

  const platform =
    identity.websites.find((w) => !isOwnDomain(w, identity.tradingName ?? businessName)) ?? null;

  return {
    identity,
    city: resolvedCity,
    results,
    enginesAnswered: results.some((r) => r.appeared !== null),
    platform,
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
  /** The single finding this email is built around, written as an instruction to the drafter. */
  finding: string;
}

const ANGLES: Angle[] = [
  {
    // Option 1 in the approved set: absence, proven by a list of names.
    id: "substitute",
    needsEngines: true,
    needsCompetitor: true,
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
    finding:
      "The finding is that every description of this business an engine can find was written by " +
      "somebody else: a directory, a review site, a listing. Name the specific page the research " +
      "found if there is one. Nothing describing them was written by them.",
  },
];

/** Pick the strongest angle the evidence actually supports. Order matters: the list is strongest
 *  first, and the first one whose preconditions hold wins. */
export function pickAngle(check: MiniCheck): Angle {
  const hasCompetitor = check.results.some((r) => r.named.length > 0);
  for (const a of ANGLES) {
    if (a.needsEngines && !check.enginesAnswered) continue;
    if (a.needsCompetitor && !(hasCompetitor && NAME_COMPETITORS_IN_COLD_EMAIL)) continue;
    // An "absence" angle is a lie if they actually showed up. Fall through to the research angle,
    // which is true either way.
    if (a.needsEngines && check.results.every((r) => r.appeared === true)) continue;
    return a;
  }
  return ANGLES[ANGLES.length - 1];
}

/** Everything the drafter is allowed to treat as fact, rendered for the prompt. Mirrors
 *  reportContext() in email-assistant.ts, which does the same job for an audited prospect. */
export function miniCheckContext(check: MiniCheck): string {
  const id = check.identity;
  const lines: string[] = [
    `Business: ${id.tradingName ?? "unknown"}`,
    `What they do: ${id.whatTheyDo ?? "unknown"}`,
    `City: ${check.city ?? "unknown"}`,
    `They have NO website of their own. ${NO_WEBSITE_LINE}.`,
  ];

  if (check.platform) lines.push(`The third-party page describing them: ${check.platform}`);

  if (check.enginesAnswered) {
    lines.push("", `Questions actually asked of the engine (${check.results.length}):`);
    for (const r of check.results) {
      const verdict =
        r.appeared === null
          ? "no answer came back, so this question proves nothing"
          : r.appeared
            ? "they WERE named"
            : "they were NOT named";
      const named = r.named.length ? ` Named instead: ${r.named.join(", ")}.` : "";
      lines.push(`- "${r.prompt}" -> ${verdict}.${named}`);
    }
  } else {
    // Absent beats forbidden, the same doctrine as the price gate: a model handed engine results
    // it must not cite will cite them. There are none here, so it cannot.
    lines.push(
      "",
      "NO ENGINE QUESTIONS WERE RUN for this prospect. You must NOT write that you asked ChatGPT " +
        "anything, that you ran anything, or that you saw who came up instead. Everything you say " +
        "must rest on the research above."
    );
  }

  return lines.join("\n");
}

/**
 * The Slack card.
 *
 * ‼️ It prints the QUESTIONS AND THE VERDICTS above the draft, not just the draft. The email
 * states one finding as fact, and the only way to know whether that fact is right is to see the
 * three questions it came from. Posting the draft alone would make a wrong finding invisible
 * until the prospect corrects it. Same reason the prompt drop prints all 20 questions.
 */
export function formatNoWebsitePitchCard(
  businessName: string,
  check: MiniCheck,
  draft: NoWebsiteDraft
): string {
  const lines: string[] = [
    `📭 No-website pitch for *${check.identity.tradingName ?? businessName}*${check.city ? ` · ${check.city}` : ""}`,
  ];

  if (check.enginesAnswered) {
    lines.push("", `Asked the engine ${check.results.length} buyer questions:`);
    for (const r of check.results) {
      const verdict = r.appeared === null ? "no answer" : r.appeared ? "✅ named" : "❌ not named";
      lines.push(`• ${r.prompt} — ${verdict}${r.named.length ? ` (got: ${r.named.slice(0, 3).join(", ")})` : ""}`);
    }
  } else {
    // Said out loud, because it changes what the email is allowed to claim. Silence here would
    // let a research-only draft be mistaken for a measured one.
    lines.push("", "⚠️ No engine questions ran, so the draft rests on research alone and claims nothing about what came up.");
  }

  if (check.platform) lines.push("", `Third-party page describing them: ${check.platform}`);
  lines.push(`Angle: \`${draft.angle}\``);

  if (draft.rejectedFindings.length) {
    lines.push(
      "",
      "🚫 *The linter REJECTED this draft. It is not approved and must not be sent as is.*",
      ...draft.rejectedFindings.map((f) => `• ${f}`)
    );
  }
  if (draft.removedLinks.length) {
    lines.push("", `🔗 Links stripped (permission stage carries none): ${draft.removedLinks.join(", ")}`);
  }
  if (draft.formatNote) lines.push("", `📝 ${draft.formatNote}`);

  lines.push("", `*Subject:* ${draft.subject}`, "", draft.body);
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

function parseSubjectAndBody(text: string): { subject: string; body: string } {
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
function stripEchoedClose(body: string): string {
  const escaped = PERMISSION_CLOSE.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const echo = new RegExp(`^\\s*["'“”']*\\s*(?:${escaped.join("|")})\\s*["'“”']*\\s*$`, "i");
  return body
    .split(/\n{2,}/)
    .filter((para) => !echo.test(para.trim()))
    .join("\n\n")
    .trim();
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
  instructions?: string | null
): Promise<NoWebsiteDraft> {
  const angle = pickAngle(check);

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
          PARAGRAPH_RULES,
          VOICE_RULES,
          STYLE_RULES,
          SUBJECT_LINE_INSTRUCTION,
          COMPLIANCE_RULES,
        ].join("\n"),
        user: [
          `What is actually known about this prospect. Use only this, invent nothing:\n${miniCheckContext(check)}`,
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
      subject: "",
      body: "",
      removedLinks: [],
      formatNote: null,
      rejectedFindings: gated.findings.map((f) => `${f.rule}: ${f.detail}`),
    };
  }

  const subject = enforceLinkPolicy(noDashes(chosen.subject), { mode: "none" });
  const body = enforceLinkPolicy(noDashes(chosen.body), { mode: "none" });
  const polished = await polishBody(stripEchoedClose(body.text), { allowEmphasis: false });

  return {
    angle: angle.id,
    subject: subject.text,
    body: ensureSignoff(ensurePermissionClose(polished.body)),
    removedLinks: [...subject.removed, ...body.removed],
    formatNote: polished.note,
    rejectedFindings: gated.draft ? [] : gated.findings.map((f) => `${f.rule}: ${f.detail}`),
  };
}
