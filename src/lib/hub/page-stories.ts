// Stories in every page: three hero's journey ideas per skeleton, one or more told in the draft.
//
// Matthew, 2026-09-15: "in the drafting process we always get 3 stories installing beliefs (starting
// from the headline and bullet points as skeleton of the story's idea, using the hero's journey
// framework) ... at least one story per page overall (wherever it fits best)."
//
// Pure: no database, no network, so every rule here is proven offline by test-onboarding-artifacts.ts.
// draft-page.ts calls it from the skeleton and the draft, page-gate.ts from the verdict.
//
// ‼️ A STORY INSTALLS A BELIEF, IT DOES NOT CLAIM A RESULT. The journey's "reward" beat, written as what
// this business did for somebody, is an outcome promise the gate blocks (page-gate.ts unbacked_claims).
// So the last beat is what she now understands, which is what the belief needs, and never what she got.
//
// ‼️ NO STORY PRETENDS TO BE REAL (F9). It is drawn from a real source on file (a review, an answered
// gap, a research quote) or it opens "Picture a ..." and names nobody. There is no third kind.
//
// ‼️ NO EM DASHES ANYWHERE IN THIS FILE, including in the text handed to the model.

import { hasBannedDash } from "@/lib/copy-guard";
import type { OutlineStory, OutlineStorySource, PageOutline } from "@/lib/hub/pages";

export const STORY_LIMITS = {
  /** Every skeleton proposes exactly this many (F10). */
  count: 3,
  /** The journey in four beats. */
  beats: 4,
  /**
   * ‼️ THE PROMPT ASKS FOR UNDER askBeatChars AND THE CODE ENFORCES maxBeatChars, AND THE GAP IS DELIBERATE.
   * First live run, 2026-09-15: told only "short notes", Sonnet wrote 200 to 300 character beats and one
   * correction retry left three still over, which failed the WHOLE skeleton over a story note. Asked for a
   * number with headroom under the limit, an overrun lands inside it.
   */
  askBeatChars: 140,
  maxBeatChars: 240,
  maxTitleChars: 90,
} as const;

/** The four beats, in order, as the model is told them and the card prints them. */
export const STORY_BEATS = [
  "where she is: her ordinary day and the problem, in her words",
  "what she tried: the call to act and the attempts that failed her",
  "the turn: what she learned, or who showed her, that changed how she sees it",
  "what she now understands: the new belief, never a result this business delivered",
] as const;

/** The belief a story may install, as numbered for this offer. */
export interface StoryBelief {
  id: string;
  text: string;
}

/** What the skeleton and the draft know about the buyer the stories are about. */
export interface StoryContext {
  audienceLabel: string | null;
  /** "patient", "owner": what the buyer is called. An illustrative story opens "Picture a <buyer>". */
  buyer: string | null;
  offer: string | null;
  beliefs: StoryBelief[];
  /** Short lines from the avatar sheet: pains, fears, goals, the emotional journey. */
  avatarNotes: string[];
}

export const EMPTY_STORY_CONTEXT: StoryContext = { audienceLabel: null, buyer: null, offer: null, beliefs: [], avatarNotes: [] };

/**
 * The avatar sheet lines a story is tuned with, from a parsed sheet (avatar-framework.ts), in the order a
 * journey uses them. Trimmed, because this goes into every skeleton prompt.
 */
export function avatarNotesFrom(parsed: { sections?: Record<string, string>; subs?: Record<string, string> } | null): string[] {
  if (!parsed) return [];
  const sections = parsed.sections ?? {};
  const subs = parsed.subs ?? {};
  const pick: Array<[string, string | undefined]> = [
    ["Pain point 1", subs["challenges.pain_point_1"]],
    ["Pain point 2", subs["challenges.pain_point_2"]],
    ["Pain point 3", subs["challenges.pain_point_3"]],
    ["Fears", sections.fears],
    ["What drives her", sections.emotional_drivers],
    ["Short-term goals", subs["goals.short_term_goals"]],
    ["Long-term aspirations", subs["goals.long_term_aspirations"]],
    ["Frustration stage", subs["emotional_journey.journey_frustration"]],
    ["Relief stage", subs["emotional_journey.journey_relief"]],
    ["Mindset phrases", sections.mindset_phrases],
  ];
  const out: string[] = [];
  for (const [label, body] of pick) {
    const text = (body ?? "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^[\s*_>•-]+/, "").trim())
      .filter((l) => l && !/^\[[^\]]*\]$/.test(l) && !/^not found in the research\.?$/i.test(l))
      .join("; ");
    if (text) out.push(`${label}: ${text.slice(0, 280)}`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The skeleton
// ─────────────────────────────────────────────────────────────────────────────

/** Rule 8 of OUTLINE_SYSTEM. Static: the beliefs and the buyer arrive in the user prompt. */
export const OUTLINE_STORY_RULE = `8. EXACTLY ${STORY_LIMITS.count} STORIES. Return "stories": three story ideas for this page, each a hero's
   journey about the buyer, built from this page's headline and bullets. Each has:
   - "id": T1, T2, T3, and a short "title".
   - "beats": exactly ${STORY_LIMITS.beats} notes, each ONE sentence under ${STORY_LIMITS.askBeatChars} characters, in this order:
${STORY_BEATS.map((b, i) => `       ${i + 1}) ${b}`).join("\n")}
   - "installs": the ids of the NECESSARY BELIEFS it moves the reader toward (one story can install
     several). Use only ids from the list you were given. An empty list when none were given.
   - "heading": the EXACT heading of the section it is told in, copied from your sections, or null
     for an idea kept for later. AT LEAST ONE story sits under a heading, and no two share one.
     A story sits where it fits best, not in the first section: that one answers the question.
   - "source": where its truth comes from, one of:
       { "kind": "evidence", "ref": "S3" } when it is drawn from that source (a real review, a
         case the business told us, a research quote),
       { "kind": "gap", "gapId": "G2" } when it needs a case only the business can tell, asked
         as that gap,
       { "kind": "illustrative" } when it is a typical case. Its first beat then starts
         "Picture a" and it names nobody and contains no digits.
   A story never presents an invented person as a real customer, and its last beat is what she
   now understands, never a result, a number or a promise about this business.`;

/** The buyer, the headline and the beliefs, for the skeleton's user prompt. */
export function outlineStoryLines(ctx: StoryContext, headline: string | null): string[] {
  const lines: string[] = ["", "FOR THE STORIES (rule 8):"];
  if (headline) lines.push(`The page's headline, which every story starts from: ${headline}`);
  if (ctx.audienceLabel) {
    const noun = ctx.buyer && ctx.buyer.toLowerCase() !== ctx.audienceLabel.toLowerCase() ? ` (a ${ctx.buyer})` : "";
    lines.push(`The buyer every story is about: ${ctx.audienceLabel}${noun}`);
  }
  if (ctx.offer) lines.push(`What is sold to her: ${ctx.offer}`);
  if (ctx.avatarNotes.length) {
    lines.push("What her avatar sheet says she lives with. Tune the beats to this, in her words:");
    for (const note of ctx.avatarNotes) lines.push(`  - ${note}`);
  }
  if (ctx.beliefs.length) {
    lines.push("THE NECESSARY BELIEFS. Every story installs at least one, by id:");
    for (const b of ctx.beliefs) lines.push(`  ${b.id}: ${b.text}`);
  } else {
    lines.push('No necessary beliefs are on file for this offer yet, so "installs" is an empty list.');
  }
  return lines;
}

/** A story as the model returns it: the source cites an S# ref, resolved to a sourceId afterwards. */
interface DraftedStory {
  id?: unknown;
  title?: unknown;
  beats?: unknown;
  installs?: unknown;
  heading?: unknown;
  source?: { kind?: unknown; ref?: unknown; gapId?: unknown } | null;
}

export interface StoryFaultArgs {
  /** The ref each evidence source was printed with, to its sourceId (null for the audit's virtual rows). */
  refs: ReadonlyMap<string, string | null>;
  beliefIds: readonly string[];
  /** Everything a figure may be drawn from. */
  numberHaystack: string;
}

function orphanNumbers(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/**
 * Everything wrong with a skeleton's stories, in words, for the correction retry.
 *
 * ‼️ SEPARATE FROM outlineFaults ON PURPOSE. Its signature and its results are pinned by
 * scripts/_probe-page-plan.ts, and a skeleton written before stories existed must still read as valid.
 * draftOutline asks for both.
 */
export function storyFaults(v: unknown, args: StoryFaultArgs): string[] {
  const d = v as { sections?: Array<{ heading?: unknown }>; gaps?: Array<{ id?: unknown }>; stories?: unknown };
  if (!Array.isArray(d?.stories)) return [`"stories" is missing. Return exactly ${STORY_LIMITS.count} story ideas (rule 8).`];
  const stories = d.stories as DraftedStory[];
  const out: string[] = [];

  if (stories.length !== STORY_LIMITS.count) out.push(`There are ${stories.length} stories. Write exactly ${STORY_LIMITS.count}.`);

  const headings = new Map(
    (Array.isArray(d.sections) ? d.sections : [])
      .map((s) => (typeof s?.heading === "string" ? s.heading.trim() : ""))
      .filter(Boolean)
      .map((h) => [h.toLowerCase(), h] as const)
  );
  const gapIds = new Set((Array.isArray(d.gaps) ? d.gaps : []).map((g) => (typeof g?.id === "string" ? g.id.trim() : "")).filter(Boolean));
  const beliefIds = new Set(args.beliefIds);
  const ids = new Set<string>();
  const placedOn = new Map<string, string>();

  stories.forEach((s, i) => {
    const id = typeof s?.id === "string" ? s.id.trim() : "";
    const name = id || `story ${i + 1}`;
    if (!/^T[1-3]$/.test(id)) out.push(`story ${i + 1} has id "${id}". Use T1, T2 and T3.`);
    else if (ids.has(id)) out.push(`story id ${id} is used twice.`);
    else ids.add(id);

    const title = typeof s?.title === "string" ? s.title.trim() : "";
    if (!title) out.push(`${name} has no title.`);
    if (title.length > STORY_LIMITS.maxTitleChars) out.push(`${name}'s title is over ${STORY_LIMITS.maxTitleChars} characters.`);

    const beats = Array.isArray(s?.beats) ? s.beats : [];
    if (beats.length !== STORY_LIMITS.beats) out.push(`${name} has ${beats.length} beats. Write exactly ${STORY_LIMITS.beats}, in the order rule 8 gives.`);
    const beatText = beats.map((b) => (typeof b === "string" ? b.trim() : ""));
    beatText.forEach((b, j) => {
      if (!b) out.push(`${name} beat ${j + 1} is empty.`);
      if (b.length > STORY_LIMITS.maxBeatChars) out.push(`${name} beat ${j + 1} is over ${STORY_LIMITS.maxBeatChars} characters. It is a note, not copy.`);
      if (/\]\(|https?:\/\//i.test(b)) out.push(`${name} beat ${j + 1} contains a link.`);
    });
    const all = [title, ...beatText].join(" ");
    if (hasBannedDash(all)) out.push(`${name} contains a dash.`);

    const installs = Array.isArray(s?.installs) ? s.installs.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : null;
    if (!installs) out.push(`${name} has no "installs" list. Give the belief ids it installs, or [] when none were given.`);
    else if (beliefIds.size) {
      if (!installs.length) out.push(`${name} installs no belief. Every story installs at least one of: ${[...beliefIds].join(", ")}.`);
      for (const b of installs) if (!beliefIds.has(b)) out.push(`${name} installs ${b}, which is not one of the necessary beliefs.`);
    }

    // The heading is compared without case, then stored as the section spells it.
    if (s?.heading !== null && s?.heading !== undefined) {
      const h = typeof s.heading === "string" ? s.heading.trim() : "";
      if (!h) out.push(`${name}'s heading is empty. Use a section's exact heading, or null.`);
      else if (!headings.has(h.toLowerCase())) out.push(`${name} sits under "${h}", which is not one of your section headings. Copy it exactly, or use null.`);
      else {
        const other = placedOn.get(h.toLowerCase());
        if (other) out.push(`${other} and ${name} both sit under "${h}". A story is its whole section, so one story per heading.`);
        else placedOn.set(h.toLowerCase(), name);
      }
    }

    const kind = s?.source?.kind;
    if (kind === "evidence") {
      const ref = typeof s.source?.ref === "string" ? s.source.ref.trim() : "";
      if (!args.refs.has(ref)) out.push(`${name} cites "${ref}", which is not one of the evidence refs.`);
      else if (args.refs.get(ref) === null) {
        out.push(`${name} cites ${ref}, which is a summary of the audit rather than a real case. Cite a review or an answer, ask a gap, or make it illustrative.`);
      }
      for (const n of orphanNumbers(all, args.numberHaystack)) out.push(`${name} states ${n}, which no source contains.`);
    } else if (kind === "gap") {
      const gap = typeof s.source?.gapId === "string" ? s.source.gapId.trim() : "";
      if (!gapIds.has(gap)) out.push(`${name} is sourced from gap "${gap}", which is not one of your gaps.`);
      for (const n of orphanNumbers(all, args.numberHaystack)) out.push(`${name} states ${n}, which no source contains.`);
    } else if (kind === "illustrative") {
      if (!/^picture an?\b/i.test(beatText[0] ?? "")) out.push(`${name} is illustrative, so its first beat starts "Picture a".`);
      if (/\d/.test(all)) out.push(`${name} is illustrative and contains a digit. An illustrative story has no figures.`);
    } else {
      out.push(`${name} has no source. Use { "kind": "evidence", "ref": "S#" }, { "kind": "gap", "gapId": "G#" } or { "kind": "illustrative" }.`);
    }
  });

  if (stories.length && placedOn.size === 0) out.push("No story sits under a heading. At least one has to be told on this page.");
  return out;
}

/** The validated model output, with S# refs resolved to source ids and headings spelled as the sections are. */
export function resolveStories(v: unknown, refs: ReadonlyMap<string, string | null>, beliefIds: readonly string[]): OutlineStory[] {
  const d = v as { sections?: Array<{ heading?: string }>; stories?: DraftedStory[] };
  const headings = new Map((d.sections ?? []).map((s) => [String(s.heading ?? "").trim().toLowerCase(), String(s.heading ?? "").trim()] as const));
  return (d.stories ?? []).map((s) => {
    const kind = s.source?.kind;
    const source: OutlineStorySource =
      kind === "evidence"
        ? { kind: "evidence", sourceId: refs.get(String(s.source?.ref ?? "").trim()) ?? "" }
        : kind === "gap"
          ? { kind: "gap", gapId: String(s.source?.gapId ?? "").trim() }
          : { kind: "illustrative" };
    const heading = typeof s.heading === "string" ? headings.get(s.heading.trim().toLowerCase()) ?? null : null;
    return {
      id: String(s.id).trim(),
      title: String(s.title).trim(),
      beats: (s.beats as string[]).map((b) => b.trim()),
      installs: beliefIds.length ? (s.installs as string[]).map((b) => b.trim()) : [],
      heading,
      source,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The draft
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The story lines printed under a heading in the draft prompt, or nothing when no story sits there.
 *
 * `sourceRefs` maps a sourceId to the S# it carries in THIS draft's evidence block, since that is what the
 * drafter cites. A source that is no longer on file makes the story unusable, and it says so.
 */
export function draftStoryLines(
  story: OutlineStory,
  ctx: StoryContext,
  sourceRefs: ReadonlyMap<string, string>
): string[] {
  const beliefs = story.installs
    .map((id) => ctx.beliefs.find((b) => b.id === id))
    .filter((b): b is StoryBelief => Boolean(b));
  const lines = [`     STORY ${story.id}, and this whole section IS this story: ${story.title}`];
  story.beats.forEach((b, i) => lines.push(`       ${i + 1}) ${b}`));
  if (beliefs.length) lines.push(`       It installs: ${beliefs.map((b) => b.text).join(" / ")}`);
  if (story.source.kind === "evidence") {
    const ref = sourceRefs.get(story.source.sourceId);
    lines.push(
      ref
        ? `       Drawn from [${ref}]. Cite it, and keep what the source says: add no detail it does not carry.`
        : "       Its source is no longer on file, so tell this section as an ordinary section and drop the story."
    );
  } else if (story.source.kind === "gap") {
    lines.push(
      `       Needs the business's answer to ${story.source.gapId} (a topic beginning "Gap ${story.source.gapId}" in the EVIDENCE). ` +
        "Without that answer, drop the story and write the section without it."
    );
  } else {
    lines.push(
      `       Illustrative. Open with "Picture a ${ctx.buyer ?? "person"}", name nobody, use no digits, and say nothing about what this business did.`
    );
  }
  return lines;
}

/** The rules the draft prompt adds when the outline carries placed stories. */
export const DRAFT_STORY_RULES = [
  "  - A section marked STORY is that story and nothing else, told in its beats' order inside the",
  "    same character limit as every section. It ends on what she now understands, the belief it",
  "    installs, and never on a result, a number or a promise about this business.",
  "  - A story drawn from a source is never dropped for length: shorten the other sections first.",
  "    An illustrative or gap story you cannot tell honestly is dropped like any thin section.",
];

// ─────────────────────────────────────────────────────────────────────────────
// After drafting: the gate's warning, and the cards
// ─────────────────────────────────────────────────────────────────────────────

/** Headings compared the way a person reads them: case, punctuation and spacing ignored. */
function sameHeading(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b);
}

/**
 * Did at least one planned story survive into the body? A WARNING, never a block (page-gate.ts): a page
 * with no story still answers its question, and evidence is the only thing that blocks.
 */
export function storyPlacement(
  outline: PageOutline | null,
  sections: ReadonlyArray<{ heading: string; body: string }>
): { status: "pass" | "fail" | "skip"; detail: string } {
  const placed = (outline?.stories ?? []).filter((s) => s.heading);
  if (!placed.length) {
    return { status: "skip", detail: "This page was not outlined with stories, so there is nothing to place." };
  }

  const told = placed
    .map((story) => ({ story, section: sections.find((sec) => sameHeading(sec.heading, story.heading!)) }))
    .filter((x): x is { story: OutlineStory; section: { heading: string; body: string } } => Boolean(x.section));

  if (!told.length) {
    return {
      status: "fail",
      detail:
        `None of the ${placed.length} placed ${placed.length === 1 ? "story" : "stories"} survived drafting ` +
        `(${placed.map((s) => `${s.id} under "${s.heading}"`).join("; ")}). A page with no story installs no belief. ` +
        "Draft again, or tell one of the stories under its heading.",
    };
  }

  // An illustrative story that does not read as one is the F9 failure: an invented case told as real.
  const unframed = told.filter(
    (t) => t.story.source.kind === "illustrative" && (!/picture an?\b/i.test(t.section.body.slice(0, 200)) || /\d/.test(t.section.body))
  );
  if (unframed.length) {
    return {
      status: "fail",
      detail:
        `${unframed.map((t) => `${t.story.id} under "${t.section.heading}"`).join("; ")} is illustrative but does not open "Picture a" ` +
        "or carries a figure, so it can read as a real customer. Reframe it.",
    };
  }

  return {
    status: "pass",
    detail: `${told.map((t) => `${t.story.id} "${t.story.title}" is told under "${t.section.heading}"`).join("; ")}.`,
  };
}

function sourceLabel(source: OutlineStorySource): string {
  return source.kind === "evidence" ? "from a source on file" : source.kind === "gap" ? `needs ${source.gapId}` : "illustrative";
}

/** The story lines for a skeleton card, one per idea. Empty for an outline written before stories. */
export function storyCardLines(outline: PageOutline, indent = "  "): string[] {
  const stories = outline.stories ?? [];
  if (!stories.length) return [];
  const covered = new Set(stories.flatMap((s) => s.installs));
  return [
    `${indent}_Stories:_`,
    ...stories.map(
      (s) =>
        `${indent}  ${s.id} ${s.title}${s.installs.length ? ` (${s.installs.join(", ")})` : ""}, ` +
        `${s.heading ? `told under "${s.heading}"` : "kept for later"}, ${sourceLabel(s.source)}`
    ),
    ...(covered.size ? [`${indent}  _installs ${[...covered].sort().join(", ")}_`] : []),
  ];
}
