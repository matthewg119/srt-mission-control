// One prompt for one lead: everything we hold, and everything we still need.
//
// ‼️ WHAT THIS IS FOR, IN MATTHEW'S WORDS, 2026-09-18: "it will make a final prompt based on
// everything, all of the information that that specific lead is missing for the profile to be
// completed and our AI engine can actually do its job correctly. I want our onboarding processer
// to ask for everything it needs whenever it makes a final prompt for deep research about a
// specific avatar/offer, even if it's missing stuff from any PDF that I could have submitted and
// maybe we still need more data about that avatar to make a decision. I want it to have all of
// the context possible."
//
// Two halves, and both were broken before this file existed.
//
// ‼️ HALF ONE: IT ASKS FOR THE WHOLE PROFILE, NOT ONE STEP'S SLICE. gap-prompts.ts is fed
// StepGaps from gapsFrom(ctx, stepKey), which filters the 71 declared fields through
// STEP_NEEDS[stepKey]. Even step 11, the widest, declares 56 of them: it cannot see the seven
// audience fields or the six offer fields written by a command. So the prompt handed over at
// step 11 could never ask for a field that step 11 does not itself need, however badly the pages
// three steps later need it. This reads ctx.gaps directly, which is evaluateDatasets across
// EVERY audience, primary first.
//
// ‼️ HALF TWO: IT CARRIES WHAT WE ALREADY OWN. Measured before writing this: three of the four
// existing gap prompts carry zero client context. The avatar sheet and short offer prompts hand
// over a BLANK template, not even the avatar's label, and the beliefs prompt is two constants. The
// research prompt carries a ResearchContext, which holds identity, the offer and the intake
// free-text and deliberately holds no documents at all. Meanwhile lead-context.ts loads the full
// `content` of every document and the whole of avatar.research, and lead-brief.ts, the one thing
// that turns a LeadContext into prompt text, throws it away and prints "on file".
//
// So somebody answering the old prompt was asked, every time, for things they had already written
// down. The templates below are pre-filled from what is stored and blank only where it is not.
//
// ─── THE RULES THIS FILE IS HELD TO ───────────────────────────────────────────────────────────
//
// PURE. It takes a LeadContext and returns text. No database, no model, no Slack. Same enforcement
// suggestions.ts has, and for the same reason: everything it claims has to come from a row
// somebody can go and look at.
//
// IT NEVER ASKS FOR WHAT IS ON FILE. The ask list is derived from the gap list, and the gap list
// is by definition what is not there. A probe asserts the other direction too, because that is
// the half that rots: a field that becomes present must leave the ask.
//
// EVERY CLIP IS DECLARED. A reader who cannot tell a whole document from most of one assumes the
// missing part was never there.
//
// IT REFUSES RATHER THAN DEGRADING. Unreadable datasets mean we do not know what is missing, and
// "research everything" on the strength of a failed select is the same lie as asking for it. No
// confirmed avatar means no prompt at all: research filed under the wrong avatar goes into a
// corpus every client in the vertical reads from, and there is no per-client key to unpick it.

import type { TemplateSection } from "@/config/avatar-framework";
import type { LeadContext } from "./lead-context";
import { isHeld } from "./lead-context";
import type { DocText } from "./doc-text";
import type { ResearchContext } from "./artifacts/deep-research-run";
import type { FieldGap } from "./dataset-spec";
// ‼️ THE "WHAT WE HOLD" BLOCKS LIVE IN ONE PLACE AND ARE IMPORTED, NEVER COPIED. They were private
// to this file until 2026-09-25, when the keyword step needed the same context. Two copies would
// keep working and quietly stop agreeing about what the offer is.
import {
  value,
  identityBlock,
  audienceBlock,
  offerBlock,
  documentBlock,
  beliefsAndLadderBlock,
  measuredBlock,
  ownerWordsBlock,
  uploadedBlock,
} from "./context-blocks";

/** One numbered section of the research report, as the caller knows it. */
export interface ResearchSectionRef {
  /** Its position in the FULL list, which is the number the paste parser files it under. */
  number: number;
  key: string;
  heading: string;
  scriptOnly: boolean;
}

export interface FinalPromptInput {
  ctx: LeadContext;
  /** Identity, offer and the owner's own intake words. Null when no avatar is confirmed. */
  research: ResearchContext | null;
  /** The text of every readable document filed against this client. */
  docs: readonly DocText[];
  /** Every research section, in order. Passed in so this file stays free of the PDF kit. */
  sections: readonly ResearchSectionRef[];
  avatarSheet: readonly TemplateSection[];
  shortOffer: readonly TemplateSection[];
  beliefOpening: string;
  maxBeliefs: number;
}

export interface FinalPrompt {
  /** The whole thing, ready to paste into a chat. */
  body: string;
  /** Declared fields on file, and declared fields in total, across every audience. */
  held: number;
  total: number;
  /** How many of the missing fields this prompt asks somebody else for. */
  asks: number;
  /** Research section numbers it asks for, in report order. */
  sectionNumbers: number[];
  /** Missing fields no researcher can answer: they are Matthew's, on the board. */
  mine: string[];
  /** What was shortened, named. Empty when nothing was. */
  clipped: string[];
}

export type FinalPromptResult = { ok: true; prompt: FinalPrompt } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Half two: what is still missing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A template with the answers already given filled in, and blanks only where there are none.
 *
 * ‼️ THE HEADINGS ARE REPRODUCED EXACTLY, because the parser pairs answers to THESE headings. A
 * reworded heading is a section the paste-back silently files nowhere. That is also why the whole
 * template is reproduced rather than only its gaps: readTemplateDocument refuses a paste that
 * matches fewer than half the headings, so handing back four of twenty sections would produce an
 * answer the system then rejects.
 */
function prefilledTemplate(
  template: readonly TemplateSection[],
  parsed: Record<string, unknown> | null
): { text: string; filled: number } {
  const sections = (parsed?.sections ?? {}) as Record<string, string>;
  const subs = (parsed?.subs ?? {}) as Record<string, string>;
  let filled = 0;

  const rendered = template.map((s) => {
    const lines: string[] = [`${s.emoji} ${s.heading}:`];

    if (s.subLabels.length) {
      const answered = s.subLabels
        .map((sub) => ({ sub, answer: (subs[`${s.key}.${sub.key}`] ?? "").trim() }))
        .filter((x) => x.answer);

      // ‼️ A SECTION CAN BE ANSWERED WITHOUT ITS SUB-LABELS, AND THAT ANSWER STILL COUNTS.
      // parseTemplateDocument fills `subs` only for lines that begin with a recognised label, and
      // `sections[key]` with the whole body either way. Somebody who wrote three sentences under
      // "Goals and Aspirations" without typing "Short-term goals:" has answered it, dataset-spec
      // scores it answered, and rendering empty labels here would ask for it again while the gap
      // list says it is on file. Sub-labels when there are any, the body when there are none.
      if (!answered.length) {
        const body = (sections[s.key] ?? "").trim();
        if (body) {
          filled++;
          lines.push(body);
          return lines.join("\n");
        }
        lines.push(...s.placeholder);
        return lines.join("\n");
      }

      for (const sub of s.subLabels) {
        const answer = (subs[`${s.key}.${sub.key}`] ?? "").trim();
        if (answer) {
          filled++;
          lines.push(`${sub.label}: ${answer}`);
        } else {
          lines.push(`${sub.label}:`);
        }
      }
      return lines.join("\n");
    }

    const answer = (sections[s.key] ?? "").trim();
    if (answer) {
      filled++;
      lines.push(answer);
    } else {
      lines.push(...s.placeholder);
    }
    return lines.join("\n");
  });

  return { text: rendered.join("\n\n"), filled };
}

function researchAsks(gaps: readonly FieldGap[], sections: readonly ResearchSectionRef[]): ResearchSectionRef[] {
  const wanted = new Set<string>();
  for (const gap of gaps) {
    const f = gap.field.filledBy;
    if (f.kind !== "research" || !f.asked || !f.sectionKey) continue;
    wanted.add(f.sectionKey);
  }
  // ‼️ REPORT ORDER AND REPORT NUMBERS, NEVER RENUMBERED FROM ONE. The paste parser reads a
  // numbered heading and files it under that number, so handing back sections 4, 9 and 12 as
  // "1, 2, 3" files section 12's answer under section 1, silently and permanently.
  return sections.filter((s) => wanted.has(s.key));
}

function documentGapCount(gaps: readonly FieldGap[], doc: string): number {
  return gaps.filter((g) => g.field.filledBy.kind === "document" && g.field.filledBy.doc === doc).length;
}

/** Fields nobody outside this business can answer: they are written by a command on the board. */
function minesOwn(gaps: readonly FieldGap[]): string[] {
  const out: string[] = [];
  for (const gap of gaps) {
    const f = gap.field.filledBy;
    if (f.kind !== "step") continue;
    out.push(`${gap.field.label}: ${f.how}${f.built ? "" : " (not built yet)"}`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The prompt
// ─────────────────────────────────────────────────────────────────────────────

export function buildFinalPrompt(input: FinalPromptInput): FinalPromptResult {
  const { ctx, research, docs, sections } = input;

  // ‼️ UNREADABLE IS NOT EMPTY. gapsFrom and promptsFromGaps both refuse on this and so does
  // this: if the datasets could not be evaluated, what is missing is UNKNOWN, and a prompt
  // asking for everything would be built on a failed select rather than on an absence.
  if (!isHeld(ctx.gaps)) {
    return {
      ok: false,
      error: "the datasets could not be read, so what is missing is unknown rather than empty.",
    };
  }

  // No confirmed avatar, no prompt. buildContext refuses for this reason and the refusal has to
  // survive: phrases from research about "the business" are filed under an avatar slug into
  // question_bank, which is keyed by vertical and shared by every client in it, with no
  // per-client key to unpick them by afterwards.
  if (!research) {
    return {
      ok: false,
      error:
        "no avatar is confirmed for this client yet, and research filed under the wrong avatar goes into a corpus every client in the vertical reads from. Confirm the avatar at step 7 first.",
    };
  }

  const reports = ctx.gaps.value;
  const allGaps = reports.flatMap((r) => r.gaps);
  const total = reports.reduce((n, r) => n + r.total, 0);
  const held = reports.reduce((n, r) => n + r.present, 0);

  const clipped: string[] = [];
  const lines: string[] = [];

  lines.push(`# Deep research for ${research.clinicName}: ${research.avatarLabel}`);
  lines.push("");
  lines.push(
    `This is one brief for one buyer. ${held} of ${total} things we track about this avatar and this offer are already answered, and they are all reproduced below so you do not ask for them again. What is still missing is at the bottom, and that is what I need from you.`
  );
  lines.push("");
  lines.push("Never invent a quote, a number or a source. If something cannot be found, say so in that section and move on: a gap I can see is worth more than a sentence that reads well.");

  // ── Everything we hold ────────────────────────────────────────────────────
  lines.push("", "---", "");
  lines.push("# WHAT WE ALREADY KNOW");
  lines.push(...identityBlock(ctx, research));
  lines.push(...audienceBlock(ctx, research));
  lines.push(...offerBlock(ctx));
  lines.push(...ownerWordsBlock(research));
  lines.push(...beliefsAndLadderBlock(ctx));
  lines.push(...measuredBlock(ctx, research));
  lines.push(...documentBlock(ctx, clipped));
  lines.push(...uploadedBlock(docs, clipped));

  // ── Everything we do not ──────────────────────────────────────────────────
  const wantedSections = researchAsks(allGaps, sections);
  const sheetGaps = documentGapCount(allGaps, "avatar_sheet");
  const offerGaps = documentGapCount(allGaps, "short_offer");
  const beliefGaps = allGaps.filter((g) => g.field.filledBy.kind === "document" && g.field.filledBy.doc === "necessary_beliefs").length;
  const mine = minesOwn(allGaps);

  lines.push("", "---", "");
  lines.push("# WHAT I NEED FROM YOU");

  let part = 0;

  if (wantedSections.length) {
    part++;
    lines.push("", `## ${part}. The research sections nothing has answered`, "");
    lines.push(
      "Answer each one under its own numbered heading, exactly as written below. The numbers are not sequential on purpose: they are the positions in the full report, and the parser that reads your answer files each section under the number you give it.",
      ""
    );
    for (const s of wantedSections) lines.push(`${s.number}. ${s.heading}`);
  }

  if (sheetGaps) {
    part++;
    const sheet = prefilledTemplate(input.avatarSheet, value(ctx.documents.avatar_sheet)?.parsed ?? null);
    lines.push("", `## ${part}. The avatar sheet`, "");
    lines.push(
      sheet.filled
        ? `${sheet.filled} of these are already answered and are filled in below. Fill in the rest and send the whole thing back: the parser matches on the headings, so keep every one of them.`
        : "Nothing has been filled in yet. Answer under each heading and keep the headings exactly as they are.",
      ""
    );
    lines.push("```");
    lines.push(sheet.text);
    lines.push("```");
  }

  if (offerGaps) {
    part++;
    const short = prefilledTemplate(input.shortOffer, value(ctx.documents.short_offer)?.parsed ?? null);
    lines.push("", `## ${part}. The short offer`, "");
    lines.push(
      short.filled
        ? `${short.filled} of these are already answered and are filled in below. Fill in the rest and send the whole thing back, headings and all.`
        : "Nothing has been filled in yet. Answer under each heading and keep the headings exactly as they are.",
      ""
    );
    lines.push("```");
    lines.push(short.text);
    lines.push("```");
  }

  if (beliefGaps) {
    part++;
    lines.push("", `## ${part}. The necessary beliefs`, "");
    lines.push(
      `Write up to ${input.maxBeliefs} beliefs this buyer has to hold before the offer is presented, in the order they have to believe them.`,
      `Each one starts with "${input.beliefOpening}" and is one sentence.`,
      "",
      "They are not features and not benefits. Each is something the reader must believe is TRUE about the world before the offer can land."
    );
  }

  const asks = allGaps.filter((g) => {
    const f = g.field.filledBy;
    if (f.kind === "research") return Boolean(f.asked && f.sectionKey);
    return f.kind === "document";
  }).length;

  if (!part) {
    lines.push("", "Nothing. Every field this prompt can ask another person for is already answered.", "");
  }

  // ── What no researcher can answer ─────────────────────────────────────────
  if (mine.length) {
    lines.push("", "---", "");
    lines.push("# NOT FOR YOU: THESE ARE MINE TO ANSWER", "");
    lines.push(
      "Listed so you can see the whole picture and so nobody researches them by mistake. They are written by a command on the onboarding board, not by research.",
      ""
    );
    for (const m of mine) lines.push(`- ${m}`);
  }

  // ── How it comes back ─────────────────────────────────────────────────────
  lines.push("", "---", "");
  lines.push("# HOW TO SEND IT BACK", "");
  lines.push("Paste each part into the step 11 thread in Slack as its own message, with its prefix:", "");
  if (wantedSections.length) lines.push("- the research: `research:` then the whole answer");
  if (sheetGaps) lines.push("- the avatar sheet: `avatar sheet:` then the filled template");
  if (offerGaps) lines.push("- the short offer: `short offer:` then the filled template");
  if (beliefGaps) lines.push("- the beliefs: `beliefs:` then one per line");

  if (clipped.length) {
    lines.push("", "---", "");
    lines.push("# WHAT WAS SHORTENED TO FIT", "");
    lines.push("Named rather than hidden, so nothing below reads as absent when it is only long:", "");
    for (const c of clipped) lines.push(`- ${c}`);
  }

  return {
    ok: true,
    prompt: {
      body: lines.join("\n"),
      held,
      total,
      asks,
      sectionNumbers: wantedSections.map((s) => s.number),
      mine,
      clipped,
    },
  };
}

/** The short Slack message that goes with the uploaded file. */
export function finalPromptSummary(p: FinalPrompt): string {
  const bits = [
    `*The final prompt for this lead is attached.*`,
    `${p.held} of ${p.total} tracked fields are already answered and are written into it, so it asks for none of them again.`,
  ];
  if (p.asks) {
    bits.push(
      `It asks for ${p.asks} still missing${p.sectionNumbers.length ? `, including research sections ${p.sectionNumbers.join(", ")}` : ""}.`
    );
  } else {
    bits.push("Nothing is left that another person could answer.");
  }
  if (p.mine.length) bits.push(`${p.mine.length} more are yours to answer on the board, and it says so rather than asking for them.`);
  if (p.clipped.length) bits.push(`${p.clipped.length} long source${p.clipped.length === 1 ? " was" : "s were"} shortened, named at the end of the file.`);
  bits.push("Run it, then paste each answer back into step 11's thread with its prefix.");
  return bits.join(" ");
}
