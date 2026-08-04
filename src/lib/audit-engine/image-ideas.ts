// The six image ideas offered in the `loom` wizard, after the avatar is picked.
//
// WHY SIX AND WHY THESE SIX: the divergence axis is *where the inquiry physically lands*, not
// what it looks like. Six variations on "a phone with a notification" are six renders of the
// same idea and the picker becomes decoration. A form in an inbox, a card in a CRM and a text
// thread are three genuinely different stories about how this owner gets work, and picking
// between them is a real decision about the pitch.
//
// This file only writes the MENU. Picking an entry hands the preset straight to
// buildDreamLeadPrompt() in dream-lead.ts, so every honesty guard lives in exactly one place:
// the business name is never invented, no dollar figure is ever rendered, no competitor who
// failed them is ever named, and the linter rejects a surviving {placeholder}.

import { callClaudeJSON } from "@/lib/claude-calls";
import { choosePreset, type Preset } from "./dream-lead";
import type { BestAvatar } from "./niche-avatars";
import type { AuditReportRow } from "./types";

export interface ImageIdea {
  preset: Preset;
  /** Short name for the card, e.g. "Phone alert". */
  label: string;
  /** One line of what would be on screen, adapted to the chosen avatar. */
  line: string;
  /** True for the preset choosePreset() would have picked for this trade. */
  natural: boolean;
}

/**
 * The menu, in a fixed order.
 *
 * Fixed rather than ranked because the number IS the command: `4` has to mean the same thing on
 * every audit, or a habit built on one recording misfires on the next. `natural` marks the fit
 * instead of reordering.
 *
 * `fallback` is what the line reads when the adaptation call fails. It is generic on purpose,
 * since a wrong specific is worse than an honest general one.
 */
const IDEA_SPECS: Array<{ preset: Preset; label: string; fallback: string; surface: string }> = [
  {
    preset: "PHONE_ALERT",
    label: "Phone alert",
    fallback: "the inquiry arriving as a notification on the owner's phone, out on a job",
    surface: "a new-inquiry notification on the owner's phone, held in one hand, out in the field",
  },
  {
    preset: "INBOX_FORM",
    label: "Inbox form",
    fallback: "the website form submission open in the owner's email inbox",
    surface: "a website contact-form submission open in a desktop email inbox",
  },
  {
    preset: "SPLIT_SCREEN",
    label: "Form + phone",
    fallback: "the filled-out lead form on the left, the same lead hitting the phone on the right",
    surface: "a split screen: the filled lead form on the left, the same lead arriving as a phone notification on the right",
  },
  {
    preset: "BOOKING_ALERT",
    label: "Booking alert",
    fallback: "a booking or estimate landing on the calendar with the date and job on it",
    surface: "a booking or scheduled-estimate alert showing the date and the job",
  },
  {
    preset: "CRM_CARD",
    label: "CRM card",
    fallback: "the lead sitting as a card in a jobs dashboard with the qualifying details filled in",
    surface: "the lead open as a card in a simple jobs dashboard or CRM, qualifying fields filled in",
  },
  {
    preset: "TEXT_THREAD",
    label: "Text thread",
    fallback: "the customer texting the inquiry in, with a reply already underneath",
    surface: "a text message thread where the customer typed the inquiry in themselves",
  },
];

interface AdaptedLines {
  lines: string[];
}

function isAdapted(v: unknown): v is AdaptedLines {
  const o = v as AdaptedLines;
  return !!o && Array.isArray(o.lines) && o.lines.length === IDEA_SPECS.length && o.lines.every((l) => typeof l === "string" && l.length > 0);
}

/**
 * Build the six-idea menu for one chosen avatar.
 *
 * ONE Claude call adapts all six lines together rather than six calls of one, which is both
 * faster and the only way the model can see the other five and keep them distinct. A failed call
 * falls back to the generic lines instead of failing the wizard: the menu is a description of
 * something not yet generated, so a generic line still picks correctly.
 */
export async function buildImageIdeas(report: AuditReportRow, avatar: BestAvatar): Promise<ImageIdea[]> {
  const natural = choosePreset(report).preset;

  let lines: string[] = IDEA_SPECS.map((s) => s.fallback);
  try {
    const { data } = await callClaudeJSON<AdaptedLines>({
      model: "claude-sonnet-4-6",
      system: [
        "You write one-line descriptions of marketing images for a sales video, one per surface you are given.",
        "",
        `Each line describes the SAME single customer inquiry arriving on a different surface. Say what would be on screen and one concrete detail from that customer, in at most 18 words.`,
        "Lowercase start, no trailing period, no marketing adjectives, no dollar amounts, no invented business names.",
        "Write plainly. Do not use dashes as punctuation.",
        "Keep the six lines clearly distinct from each other. If two would read the same, change the detail, not the surface.",
        `Return {"lines": [...]} with exactly ${IDEA_SPECS.length} strings, in the order the surfaces were given.`,
      ].join("\n"),
      user: [
        `Trade: ${report.business_type ?? "local service"}`,
        report.city ? `Market: ${report.city}` : "",
        `The customer: ${avatar.label}`,
        `What that job is worth: ${avatar.ticket}`,
        `What they type into AI: ${avatar.aiQuestion}`,
        "",
        "Surfaces, in order:",
        ...IDEA_SPECS.map((s, i) => `${i + 1}. ${s.surface}`),
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 700,
      temperature: 0.7,
      validate: isAdapted,
    });
    lines = data.lines;
  } catch (e) {
    console.error("[image-ideas] adaptation failed, using generic lines:", (e as Error).message);
  }

  return IDEA_SPECS.map((spec, i) => ({
    preset: spec.preset,
    label: spec.label,
    line: (lines[i] ?? spec.fallback).replace(/\s*[—–]\s*/g, ", ").trim(),
    natural: spec.preset === natural,
  }));
}

/**
 * The Slack card. Numbered, because the number is the command.
 *
 * `avatarIndex` is null when the niche set failed to build and the customer was derived from the
 * audit instead. There was no menu, so there is no number to name, and claiming "customer #1"
 * would imply a choice that never happened.
 */
export function formatIdeasCard(ideas: ImageIdea[], avatar: BestAvatar, avatarIndex: number | null): string {
  return [
    `:framed_picture: *The picture · for ${avatarIndex ? `customer #${avatarIndex}, ` : ""}${avatar.label}*`,
    `_They ask AI: "${avatar.aiQuestion}"_`,
    "",
    "Six ways the same inquiry lands. Pick the one that looks like how this owner actually gets work.",
    "",
    ...ideas.map((idea, i) => `*${i + 1}. ${idea.label}*${idea.natural ? "  :dart: _natural fit for this trade_" : ""}\n    ${idea.line}`),
    "",
    "Reply *1* to *6* and I'll write the paste-ready prompt plus the full script for the recording.",
  ].join("\n");
}
