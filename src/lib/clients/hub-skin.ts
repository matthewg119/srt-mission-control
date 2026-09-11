// Changing how a client's hub LOOKS, from the thread the hub was built in.
//
// Step 15 posts a preview link and asks for a theme confirmation. Until now the only answer to
// "I do not like how that looks" was the four-field Theme panel on the client board, which
// moves the logo, the accent and the font and cannot move the FORMAT. This is the format.
//
// Two ways in, and they land on one object:
//   `template clinic`   names one of the four shipped layouts. No model call, nothing to
//                       validate, nothing that can come back wrong. The common path.
//   a pasted screenshot reads a reference into the same tokens. For when none of the four is
//                       close enough.
//
// ‼️ EVERY CHANGE UN-CONFIRMS THE LOOK, AND THAT IS THE WHOLE LOOP.
// `hub_preview` already refuses [Done] until the theme is confirmed, so clearing `confirmedAt`
// on every write puts the step back in front of a person. Change it, look at it, change it
// again, and Confirm is what ends the conversation. Nothing an unconfirmed skin does reaches
// the client's own domain or the tokenised preview link — activeSkin() gates both on the same
// column — so the iteration is free.
//
// ‼️ THE LINK POSTED BACK IS THE DASHBOARD PREVIEW, NOT THE SHAREABLE ONE.
// /preview/{token} renders the CONFIRMED look, because it is the link shown to a client on a
// call. A skin that has just been set is by definition unconfirmed, so posting that link would
// answer "here is your new design" with a page showing the old one. The dashboard preview
// passes `pending: true` and is the only surface that renders what was just chosen.
//
// ‼️ IT WRITES TOKENS AND A TEMPLATE NAME. IT DOES NOT ACCEPT MARKUP, CSS OR COPY.
// See the headers of skin.ts and skin-vision.ts. The short version: the hub is sold on being
// crawled and quoted, the JSON-LD and heading order in hub-bodies.tsx are what make that true,
// and a lane that could paste HTML onto a client's own domain could delete that silently.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { readTheme } from "@/lib/hub/theme";
import { revalidateClientHub } from "@/lib/hub/resolve";
import {
  readSkin,
  isTemplate,
  templateInfo,
  templateMenu,
  skinLine,
  EMPTY_SKIN,
  type StoredSkin,
  type HubTemplate,
} from "@/lib/hub/skin";
import { stepNumber } from "@/config/delivery-steps";
import { readSkinFromImages } from "@/lib/hub/skin-vision";
import {
  brandFromReference,
  candidateAt,
  readCandidateSet,
  skinVariants,
  themeFromPick,
  type SkinCandidate,
  type SkinCandidateSet,
} from "@/lib/hub/skin-variants";
import type { ClaudeImageInput } from "@/lib/claude-calls";
import { faceName, type HubFace } from "@/lib/hub/faces";
import type { ReferenceProvenance } from "@/lib/hub/theme";

/**
 * The steps where a design conversation belongs.
 *
 * 15 builds the hub and asks for the confirmation; 16 is the review tool, which shares the same
 * theme and skin objects, so "make it look like this" typed in either thread means the same
 * thing. Anywhere else the words fall through to the ordinary assistant, which is correct: a
 * sentence containing "template" in the intake thread is a sentence, not a command.
 *
 * ‼️ 18 `site_replica` JOINED THEM 2026-09-08, AND IT IS WHERE A SCREENSHOT OF THEIR REAL SITE
 * BELONGS. That step already fetches their homepage, reads their nav and rebuilds every section,
 * so it is the one thread where "make it look like their site" is the literal subject. Before
 * this, a screenshot dropped there fell through to the ordinary upload capture and was filed as
 * a document nobody would look at again.
 */
const SKIN_STEPS = new Set(["hub_preview", "review_tool_preview", "site_replica"]);

/**
 * The shape the Slack events route already hands every other file handler.
 *
 * Structural rather than imported: `slack-bot.ts` exports no file type, and onboarding-docs.ts
 * declares its own for the same reason. A wider type here would let a caller pass something the
 * download cannot use.
 */
export interface SkinReferenceFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
}

export function isSkinStep(stepKey: string | null | undefined): boolean {
  return Boolean(stepKey && SKIN_STEPS.has(stepKey));
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/**
 * The INTERNAL preview, which is the only one that renders an unconfirmed look.
 *
 * `?kind=reviews` shows the review tool through the same skin, so both surfaces can be checked
 * without leaving the thread.
 */
export function designPreviewUrl(clientId: string, kind: "hub" | "reviews" = "hub"): string {
  return `${appUrl()}/dashboard/clients/${clientId}/preview${kind === "reviews" ? "?kind=reviews" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export async function loadSkin(clientId: string): Promise<StoredSkin> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("hub_skin")
    .eq("id", clientId)
    .maybeSingle();
  return readSkin((data as { hub_skin?: unknown } | null)?.hub_skin);
}

/**
 * Write a skin and un-confirm the look.
 *
 * ‼️ THE TWO WRITES ARE ONE DECISION AND MUST NOT BE SPLIT. A stored skin with a stale
 * `confirmedAt` is a design nobody signed off rendering on a client's own domain, which is
 * exactly what activeSkin()'s gate exists to prevent — and the gate reads the theme's column,
 * so a skin write that left it alone would walk straight past it.
 *
 * The theme's four fields are untouched. Somebody's logo and brand colour survive a template
 * change; only the signature comes off.
 *
 * ‼️ AND IT CLEARS THE CANDIDATES, FOR THE SAME REASON IT CLEARS THE CONFIRMATION. Three designs
 * on offer are an unanswered question about a skin, and this call answers it a different way.
 * Leaving them behind made the step card lie: designSection() reads candidates FIRST, so
 * `template bold` after a screenshot re-rendered step 16 as ":art: Three designs off that
 * reference. Nothing has changed yet." over a row where the design had just changed, and a bare
 * `template` re-printed three options that no longer described anything. Same rule as the
 * confirmation: the stored design and what the card says about it must not disagree.
 *
 * confirmSkinPick() clears them too, by taking one. This clears them by superseding them.
 */
export async function writeSkin(
  clientId: string,
  next: StoredSkin,
  by: string
): Promise<{ ok: boolean; error?: string; skin?: StoredSkin }> {
  const { data: row, error: readErr } = await supabaseAdmin
    .from("clients")
    .select("theme")
    .eq("id", clientId)
    .maybeSingle();

  if (readErr) return { ok: false, error: `could not read the client: ${readErr.message}` };
  if (!row) return { ok: false, error: "no client row" };

  const theme = readTheme((row as { theme?: unknown }).theme);
  const skin: StoredSkin = {
    ...next,
    sourceNote: next.sourceNote ? next.sourceNote.slice(0, 300) : null,
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      hub_skin: skin,
      hub_skin_candidates: null,
      theme: { ...theme, confirmedAt: null, confirmedBy: null },
    })
    .eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  // The live host caches its client row for five minutes and carries the skin in it. Guarded
  // because revalidateTag throws outside a request context, and failing to bust a cache that
  // expires on its own must never undo a write that already succeeded.
  revalidateClientHub();

  return { ok: true, skin };
}

/** The three on offer, or null when no reference has been read for this client. */
export async function loadCandidates(clientId: string): Promise<SkinCandidateSet | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("hub_skin_candidates")
    .eq("id", clientId)
    .maybeSingle();
  return readCandidateSet((data as { hub_skin_candidates?: unknown } | null)?.hub_skin_candidates);
}

/**
 * Put three on the table.
 *
 * ‼️ IT DOES NOT TOUCH hub_skin, AND THAT IS THE WHOLE CHANGE. A screenshot used to overwrite the
 * client's stored skin outright, so the only way to compare a reference against what they already
 * had was to look at one, remember it, and drop the other. Offering three and changing nothing
 * until somebody picks is the "tool proposes, a person confirms" rule applied to a design, which
 * is the same rule every proposed_* column in this repo already follows.
 */
async function offerCandidates(
  clientId: string,
  set: SkinCandidateSet
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ hub_skin_candidates: set })
    .eq("id", clientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Take one, clear the rest, and CONFIRM the theme in the same write.
 *
 * ‼️ THIS IS THE ONE SKIN WRITE THAT SETS theme.confirmedAt RATHER THAN CLEARING IT, AND IT IS A
 * DELIBERATE REVERSAL OF writeSkin()'s RULE. Read this before making anything else do it.
 *
 * writeSkin() un-confirms on every write because changing a look must not leave a signature on a
 * design nobody has seen, and activeSkin()'s gate is what keeps an unconfirmed skin off a
 * client's own domain. That still holds for `template <name>`, for `skin reset` and for the
 * screenshot read itself, all of which change what a preview would show without anybody having
 * looked at the result.
 *
 * A pick is the opposite. Three previews were rendered and a person chose one of them by number.
 * hub-setup.ts defines confirmed as "a person looked at it and said yes", and that is exactly
 * what just happened. Requiring them to then open the board and press Confirm on the design they
 * had just chosen would be a second signature on one decision, which is the kind people click
 * through without reading.
 *
 * ONE update, both columns, for the same reason writeSkin gives: a skin stored without its
 * confirmation, or a confirmation stored without its skin, is a state where the gate and the
 * design disagree.
 */
export async function confirmSkinPick(
  clientId: string,
  slot: number,
  by: string
): Promise<{
  ok: boolean;
  error?: string;
  skin?: StoredSkin;
  blurb?: string;
  /** What the pick wrote into the theme, or null when the reference read no accent or face. */
  reference?: ReferenceProvenance | null;
  bodyFace?: HubFace | null;
}> {
  const { data: row, error: readErr } = await supabaseAdmin
    .from("clients")
    .select("theme, hub_skin_candidates")
    .eq("id", clientId)
    .maybeSingle();

  if (readErr) return { ok: false, error: `could not read the client: ${readErr.message}` };
  if (!row) return { ok: false, error: "no client row" };

  const set = readCandidateSet((row as { hub_skin_candidates?: unknown }).hub_skin_candidates);
  const picked: SkinCandidate | null = candidateAt(set, slot);
  if (!picked) {
    return {
      ok: false,
      error: set
        ? `there is no design ${slot} on offer. The numbers are 1 to ${set.candidates.length}.`
        : "there are no designs on offer for this client. Paste a reference screenshot first.",
    };
  }

  const theme = readTheme((row as { theme?: unknown }).theme);
  const now = new Date().toISOString();

  // The candidate's own slot and blurb are card furniture, not part of the skin. readSkin()
  // rebuilds the object field by field, so hub_skin holds exactly its shape and nothing extra,
  // and a field added to HubSkin later cannot be forgotten in a hand-written copy here.
  const skin: StoredSkin = {
    ...readSkin(picked),
    source: "screenshot",
    sourceNote: picked.sourceNote ? picked.sourceNote.slice(0, 300) : null,
    updatedAt: now,
    updatedBy: by,
  };

  // ‼️ AND THE REFERENCE'S ACCENT AND BODY FACE GO INTO THE THEME, IN THIS SAME UPDATE.
  // Their one home is the theme, not the skin, and this is the one place that writes a value
  // there that did not come off the client's own site. It may because a pick is a person looking
  // at a rendered reference and saying "make it look like that", which is a different claim from
  // "this is their brand", and it is recorded as that claim in theme.fromReference, with what it
  // replaced. The preview rendered exactly these values through the same brandFromReference(),
  // so what is stored is what was seen. The reasoning is the header of skin-vision.ts.
  const brand = brandFromReference(set as SkinCandidateSet, skin);
  const nextTheme = themeFromPick(theme, brand, slot, by, now);

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      hub_skin: skin,
      hub_skin_candidates: null,
      theme: { ...nextTheme, confirmedAt: now, confirmedBy: by },
    })
    .eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  revalidateClientHub();
  return {
    ok: true,
    skin,
    blurb: picked.blurb,
    reference: nextTheme === theme ? null : nextTheme.fromReference,
    bodyFace: set?.bodyFace ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The words
// ─────────────────────────────────────────────────────────────────────────────

/** The block every reply ends with, so the two links are described identically everywhere. */
function previewLines(clientId: string): string[] {
  return [
    "",
    `*Look at it:* ${designPreviewUrl(clientId)}`,
    `*The review tool, same skin:* ${designPreviewUrl(clientId, "reviews")}`,
    "",
    "This preview needs a login and shows the design before it is confirmed, which the " +
      "shareable client link deliberately does not. Change it as many times as you like. " +
      "Confirm the theme on the client board when you are happy, and that is what lets [Done] " +
      "through.",
  ];
}

/** One candidate's preview link. `candidate` is validated on the way in, never interpolated raw. */
export function candidatePreviewUrl(clientId: string, slot: number, kind: "hub" | "reviews" = "hub"): string {
  const base = designPreviewUrl(clientId, kind);
  return `${base}${base.includes("?") ? "&" : "?"}candidate=${slot}`;
}

/**
 * The three, side by side, with what each one IS and a link to look at it.
 *
 * ‼️ IT ENDS BY SAYING WHAT TO TYPE. Matthew's acceptance criterion is that anything which
 * completes offers its next step, and a card showing three designs and no way to choose one is
 * the exact bug that criterion names. The pick is also what closes the step, so this is the only
 * place the two are joined.
 */
/**
 * What was read off the reference that all three share, said once.
 *
 * The faces and the accent are the same in every candidate by construction (skin-variants.ts),
 * so repeating them per candidate would be three lines saying one thing.
 */
function readOffLine(set: SkinCandidateSet): string | null {
  const first = set.candidates[0];
  const parts: string[] = [];
  if (set.accentSuggestion) parts.push(`accent \`${set.accentSuggestion}\``);
  if (first?.headingFace) parts.push(`headlines in ${faceName(first.headingFace)}`);
  if (first?.subheadingFace && first.subheadingFace !== first.headingFace) {
    parts.push(`subheadings in ${faceName(first.subheadingFace)}`);
  }
  if (first?.labelFace) parts.push(`labels in ${faceName(first.labelFace)}`);
  if (set.bodyFace) parts.push(`body in ${faceName(set.bodyFace)}`);
  return parts.length ? `*Read off it:* ${parts.join(", ")}.` : null;
}

function candidateLines(clientId: string, set: SkinCandidateSet): string[] {
  const lines: string[] = [
    ":art: *Three designs off that reference.* Nothing has changed yet.",
  ];

  if (set.reading) lines.push(`_${set.reading}_`);
  const readOff = readOffLine(set);
  if (readOff) lines.push(readOff);
  lines.push("");

  for (const candidate of set.candidates) {
    lines.push(`*${candidate.slot}. ${templateInfo(candidate.template).name}:* ${candidate.blurb}`);
    lines.push(`    ${skinLine(candidate)}`);
    lines.push(`    Hub: ${candidatePreviewUrl(clientId, candidate.slot)}`);
    lines.push(`    Reviews: ${candidatePreviewUrl(clientId, candidate.slot, "reviews")}`);
  }

  // ‼️ IT SAYS BEFORE THE PICK THAT THE PICK WRITES THE THEME. Every other skin write in this
  // file leaves the accent alone, so a pick quietly changing it would be a surprise found later on
  // the board. Said here, where the choice is made, and again in the reply that confirms it.
  const brand = brandFromReference(set, set.candidates[0] ?? EMPTY_SKIN);
  const brandNote =
    brand.accent || brand.fontFamily
      ? ` It also writes the ${[brand.accent ? "accent" : "", brand.fontFamily ? "body font" : ""]
          .filter(Boolean)
          .join(" and ")} read off this reference into the Theme panel, which the previews ` +
        "above already show."
      : "";

  lines.push(
    "",
    "*Type `pick 1`, `pick 2` or `pick 3` in this thread.* That stores the design AND confirms " +
      "the theme, which is what [Done] is waiting on. Every page drafted for this client after " +
      `that is rendered in it.${brandNote}`,
    "",
    "Or paste another reference to replace these three, or name one of the four by hand:",
    templateMenu(),
  );

  return lines;
}

/**
 * The pick reply's account of what it wrote into the theme, and why a pick may.
 *
 * ‼️ OUT LOUD, WITH THE OLD VALUE. The Theme panel's accent is normally a fact read off the
 * client's own site and nothing else writes it. Somebody reading this thread next week needs to
 * see that a pick did, why, and what to type to put it back.
 */
function referenceBrandLines(ref: ReferenceProvenance | null, bodyFace: HubFace | null): string[] {
  if (!ref) return [];
  const lines: string[] = [];
  if (ref.accent) {
    lines.push(
      `*Accent:* \`${ref.accent}\`${ref.replacedAccent ? `, replacing \`${ref.replacedAccent}\`` : ""}.`
    );
  }
  if (ref.fontFamily) {
    lines.push(
      `*Body font:* ${bodyFace ? faceName(bodyFace) : "the reference's"}` +
        `${ref.replacedFontFamily ? `, replacing \`${ref.replacedFontFamily}\`` : ""}.`
    );
  }
  if (lines.length === 0) return [];
  lines.push(
    `${lines.length > 1 ? "Both are" : "That is"} in the Theme panel now. That panel is normally ` +
      "filled from the client's own site and nothing else writes it. A pick is different: you " +
      "looked at a rendered reference and said make it look like that, so the pick wrote it and " +
      "recorded where it came from. To undo it, type the old value back in the Theme panel."
  );
  return lines;
}

function menuMessage(current: StoredSkin, clientId: string): string {
  return [
    `:art: ${skinLine(current)}`,
    "",
    "*Type one of these in this thread:*",
    templateMenu(),
    "",
    "Or paste a screenshot of a page whose look you want and I will read the colours, the " +
      "accent, the fonts, the corner radius, the column width and the text size off it, and " +
      "offer three versions of it. `skin reset` puts it back to Document with no overrides.",
    ...previewLines(clientId),
  ].join("\n");
}

/**
 * The design half of a step card, written once and printed by every step that owns one.
 *
 * ‼️ IT IS ONE FUNCTION BECAUSE THE ALTERNATIVE ALREADY WENT WRONG ONCE. The template menu used
 * to be spelled out in step 15's arm and re-spelled in the wrong-name refusal and again in the
 * failed-read fallback, and templateMenu() exists precisely so those three cannot drift. The
 * candidate lane has the same shape and more moving parts, so the same rule applies from the
 * start: 15 and 18 print this, and there is nowhere for a fourth version to appear.
 *
 * Two states, and they are genuinely different instructions:
 *   - three on offer  -> compare them and type `pick n`, which is also what closes the step
 *   - nothing on offer -> paste a reference, or name one of the four
 */
export async function designSection(clientId: string): Promise<string[]> {
  const set = await loadCandidates(clientId);
  if (set) return candidateLines(clientId, set);

  const skin = await loadSkin(clientId);
  return [
    skinLine(skin),
    "*Do not like how it looks?* Reply in this thread:",
    templateMenu(),
    "Or paste a screenshot of a page whose look you want. I will read the colours, the accent, " +
      "the fonts, the corner radius, the column width and the text size off it and offer THREE " +
      "versions of it. Nothing is applied until you type `pick 1`, `pick 2` or `pick 3`.",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Text replies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `template`, `template <name>`, `skin` and `skin reset`, typed in a design step's thread.
 *
 * Returns null when the message is not one of those, so the caller falls through to whatever it
 * would have done. The prefixes are EXACT for the same reason `isResearchPaste` refuses to
 * sniff: free text in a step thread is answered by a model otherwise, and a sentence that
 * merely mentions a template is a sentence.
 */
export async function handleSkinThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string } | null> {
  if (!isSkinStep(input.stepKey)) return null;

  const text = input.text.trim();

  // Bare `template`, `skin` or `design`: show what it is on and what it could be on. If three
  // are already on the table, show THOSE: an unanswered question outranks a fresh menu.
  if (/^(template|templates|skin|design)$/i.test(text)) {
    const set = await loadCandidates(input.clientId);
    if (set) return { message: candidateLines(input.clientId, set).join("\n") };
    return { message: menuMessage(await loadSkin(input.clientId), input.clientId) };
  }

  if (/^(skin|design|template)\s+reset$/i.test(text)) {
    const res = await writeSkin(
      input.clientId,
      { ...EMPTY_SKIN, source: "template", sourceNote: "reset to defaults" },
      input.by
    );
    if (!res.ok) return { message: `:warning: Could not reset the skin: ${res.error}` };
    return {
      message: [
        ":leftwards_arrow_with_hook: Back to *Document* with no overrides, and the theme is " +
          "un-confirmed again.",
        ...previewLines(input.clientId),
      ].join("\n"),
    };
  }

  // ‼️ `pick 2` BEFORE THE TEMPLATE MATCHER, AND IT IS ANCHORED AND NUMERIC SO THE TWO CANNOT
  // COLLIDE. A bare number in one of these threads means nothing else; the page studio's digit
  // branch is a different channel entirely.
  const picked = text.match(/^pick\s+([0-9])$/i);
  if (picked) {
    const slot = Number(picked[1]);
    const res = await confirmSkinPick(input.clientId, slot, input.by);
    if (!res.ok) {
      const set = await loadCandidates(input.clientId);
      return {
        message: [
          `:warning: Could not pick that: ${res.error}`,
          ...(set ? ["", ...candidateLines(input.clientId, set)] : []),
        ].join("\n"),
      };
    }
    const stored = res.skin as StoredSkin;
    return {
      message: [
        `:white_check_mark: *Design ${slot} it is:* ${res.blurb ?? ""}`.trimEnd() + ".",
        skinLine(stored),
        "",
        ...referenceBrandLines(res.reference ?? null, res.bodyFace ?? null),
        ...(res.reference ? [""] : []),
        // ‼️ IT SAYS WHAT THE PICK DID TO THE CONFIRMATION, OUT LOUD. Every other skin write in
        // this file UN-confirms the theme, and somebody reading this thread a week later needs to
        // know why this one did the opposite. The reasoning is in confirmSkinPick's header and in
        // docs/2026-09-08-skin-candidates.sql.
        "The theme is confirmed, because choosing one of three rendered previews is a person " +
          `looking at it and saying yes. That is what step ${stepNumber("hub_preview")}'s [Done] ` +
          "was waiting on.",
        "",
        "*Next:*",
        `  • Press [Done] on this step.`,
        `  • Every page drafted for this client from now on renders in this design.`,
        `  • Changed your mind? Paste another reference, or \`template <name>\` to start over.`,
        ...previewLines(input.clientId),
      ].join("\n"),
    };
  }

  // A bare `pick`, or `pick` with something that is not a number, is somebody halfway there.
  if (/^pick\b/i.test(text)) {
    const set = await loadCandidates(input.clientId);
    return {
      message: set
        ? candidateLines(input.clientId, set).join("\n")
        : ":warning: There is nothing on offer to pick from yet. Paste a screenshot of the page " +
          "you want it to look like, or name one of the four templates:\n" + templateMenu(),
    };
  }

  const named = text.match(/^(?:template|skin|design)\s+([a-z]+)$/i);
  if (!named) return null;

  const wanted = named[1].toLowerCase();
  if (!isTemplate(wanted)) {
    return {
      message: [
        `:warning: There is no template called \`${wanted}\`. The four that exist:`,
        templateMenu(),
      ].join("\n"),
    };
  }

  return { message: await applyTemplate(input.clientId, wanted, input.by) };
}

/**
 * Switch template and DROP the per-client overrides.
 *
 * ‼️ NOT A MERGE, AND THE ALTERNATIVE IS WORSE THAN IT LOOKS. Carrying a warm off-white
 * background from Clinic into Bold leaves a dark header band sitting on cream, which is neither
 * template and looks like a bug rather than a choice. Naming a template is asking for that
 * template. A screenshot read is the way to get a template PLUS adjustments.
 */
async function applyTemplate(
  clientId: string,
  template: HubTemplate,
  by: string
): Promise<string> {
  const current = await loadSkin(clientId);
  const res = await writeSkin(
    clientId,
    { ...EMPTY_SKIN, template, source: "template", sourceNote: null },
    by
  );
  if (!res.ok) return `:warning: Could not set the template: ${res.error}`;

  const info = templateInfo(template);

  return [
    `:art: Switched to *${info.name}*. ${info.blurb}`,
    current.source === "screenshot"
      ? "_The adjustments read off your reference image were dropped: naming a template asks for " +
        "that template as designed. Paste the reference again to re-apply them on top of this one._"
      : "",
    ...previewLines(clientId),
  ]
    .filter(Boolean)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshots
// ─────────────────────────────────────────────────────────────────────────────

/** Slack gives us mimetype and a private URL; Claude wants base64 and a media type. */
const VISION_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Is there anything here a skin could be read off?
 *
 * ‼️ THE CALLER MUST ASK THIS BEFORE IT ACKNOWLEDGES. The Slack route posts "reading the
 * design out of that" and then does the work in waitUntil, so a message whose attachments are
 * a PDF and a .docx would get that acknowledgement followed by nothing at all — the worst
 * shape a background task can fail in, because it reads as success. Gating the ack on the same
 * predicate the handler gates on means the two cannot disagree.
 */
export function hasSkinReference(files: SkinReferenceFile[]): boolean {
  return files.some(
    (f) => VISION_TYPES.has((f.mimetype ?? "").toLowerCase()) && Boolean(f.url_private_download)
  );
}

/**
 * How many reference images one message may spend a vision call on.
 *
 * A design reference is one or two pictures. Somebody dropping a folder of twelve is filing
 * evidence, not asking for a design, and the cap keeps that from becoming a large request whose
 * answer averages twelve unrelated pages into one muddy skin.
 */
const MAX_REFERENCE_IMAGES = 3;

/**
 * How large one reference image may be before it is skipped.
 *
 * ‼️ THIS LANE WAS THE ONLY VISION READER IN THE REPO WITHOUT A CAP, AND THAT IS A HARD FAILURE
 * RATHER THAN A SLOW ONE. onboarding-docs.ts, page-review.ts, page-studio.ts, listing-read.ts and
 * review-audit.ts all stop at the same 6 MB. Here a full-page retina PNG went straight into a
 * base64 payload, and Anthropic answers an oversized request with a 413 — which
 * isTransientStatus() correctly declines to retry, so the whole read dies on the first attempt
 * and the person gets a raw `Anthropic API error (413)` string back in the thread.
 *
 * Declared here rather than imported, the same way VISION_TYPES already is, so the hub lane does
 * not take a dependency on the page lane for a number.
 */
const MAX_VISION_BYTES = 6 * 1024 * 1024;

/**
 * A screenshot dropped in a design step's thread becomes a skin.
 *
 * Returns null when there is nothing here to read, so the caller falls through to the ordinary
 * onboarding upload capture — which is what a presence-sweep screenshot in some other thread
 * still needs to hit.
 */
export async function handleSkinScreenshot(input: {
  clientId: string;
  stepKey: string | null;
  files: SkinReferenceFile[];
  text: string;
  by: string;
}): Promise<{ message: string } | null> {
  if (!isSkinStep(input.stepKey)) return null;

  if (!hasSkinReference(input.files)) return null;
  const images = input.files.filter(
    (f) => VISION_TYPES.has((f.mimetype ?? "").toLowerCase()) && f.url_private_download
  );

  const picked = images.slice(0, MAX_REFERENCE_IMAGES);
  const payload: ClaudeImageInput[] = [];
  let oversize = 0;

  for (const f of picked) {
    try {
      const buf = await slack.downloadFile(f.url_private_download as string);
      // ‼️ MEASURED AFTER THE DOWNLOAD, BECAUSE SLACK'S `size` IS NOT ON THE EVENT WE GET.
      // SkinReferenceFile carries id, name, mimetype and the private URL and nothing else, so
      // widening it would mean widening the route's SlackEventFile too. The bytes are cheap
      // next to the vision call this is protecting, and page-studio.ts measures the same way.
      if (buf.byteLength > MAX_VISION_BYTES) {
        oversize += 1;
        console.error(
          `[clients/hub-skin] reference too large to read: ${f.name ?? f.id} (${buf.byteLength} bytes)`
        );
        continue;
      }
      payload.push({ media_type: (f.mimetype as string).toLowerCase(), data: buf.toString("base64") });
    } catch (e) {
      // One unreadable file must not lose the others. Named rather than swallowed.
      console.error("[clients/hub-skin] reference download failed:", (e as Error).message);
    }
  }

  if (payload.length === 0) {
    // ‼️ TOO BIG AND COULD NOT BE FETCHED ARE DIFFERENT ANSWERS AND ONLY ONE OF THEM IS FIXED BY
    // POSTING IT AGAIN. Telling somebody to re-post a 20 MB screenshot sends them round the same
    // loop; telling them the limit is something they can act on.
    return {
      message: oversize
        ? [
            `:warning: ${oversize === 1 ? "That image is" : `All ${oversize} of those images are`} ` +
              `too large to read. The limit is ${MAX_VISION_BYTES / (1024 * 1024)} MB each.`,
            "",
            "Nothing was changed. Post a smaller screenshot, or name one of the four by hand:",
            templateMenu(),
          ].join("\n")
        : ":warning: I could not download those images from Slack, so nothing was read. " +
          "Try posting them again.",
    };
  }

  let read;
  try {
    read = await readSkinFromImages(payload, input.text);
  } catch (e) {
    // ‼️ A FAILED READ LEAVES THE CLIENT ON THE SKIN THEY ALREADY HAD. There is no partial
    // write and no best guess: a design assembled out of a failed read is worse than the plain
    // one it replaced, and the four templates are right there to be named by hand.
    return {
      message: [
        `:warning: I could not read a design out of that: ${(e as Error).message}`,
        "",
        "Nothing was changed. You can still name one of the four by hand:",
        templateMenu(),
      ].join("\n"),
    };
  }

  // ‼️ THREE CANDIDATES, AND NOTHING IS APPLIED. This used to build one StoredSkin and write it
  // straight to hub_skin, so a reference dropped to ask "what would this look like" REPLACED the
  // client's design before anybody had seen the answer, and the only way to compare was to
  // remember the old one. Now the read becomes three token sets, they sit in
  // hub_skin_candidates, and a person picks by number. Same rule as every proposed_* column
  // here: the tool proposes and a person confirms.
  //
  // Two of the three cost nothing: variant 1 is the read taken literally and the other two are
  // arithmetic on it. See src/lib/hub/skin-variants.ts for why that beats three vision calls.
  const candidates = skinVariants(read, input.by);

  const set: SkinCandidateSet = {
    generatedAt: new Date().toISOString(),
    generatedBy: input.by,
    reading: read.reading ?? null,
    accentSuggestion: read.accentSuggestion ?? null,
    bodyFace: read.bodyFace ?? null,
    candidates,
  };

  const offered = await offerCandidates(input.clientId, set);
  if (!offered.ok) {
    return {
      message:
        `:warning: Read the reference but could not save the options: ${offered.error}\n` +
        "Nothing was changed. You can still name one of the four by hand:\n" +
        templateMenu(),
    };
  }

  const lines = candidateLines(input.clientId, set);

  // ‼️ TWO REASONS A FILE DID NOT MAKE IT, AND THEY MUST NOT SHARE A SENTENCE. This compared
  // payload.length against images.length and blamed everything on the three-image cap, so a
  // screenshot skipped for being 20 MB would have been explained as "more than that averages
  // into a muddy skin" — a confident wrong answer about why the person's picture was ignored.
  // The cap is measured against `picked`; the size skips are counted separately.
  if (picked.length < images.length) {
    lines.push(
      "",
      `_Read the first ${picked.length} of ${images.length} images. More than that averages ` +
        `into a muddy skin rather than a sharper one._`
    );
  }

  if (oversize > 0) {
    lines.push(
      "",
      `_${oversize === 1 ? "One image was" : `${oversize} images were`} skipped for being over ` +
        `${MAX_VISION_BYTES / (1024 * 1024)} MB. The designs above were read off the rest._`
    );
  }

  // The accent and body face used to be REPORTED here and written nowhere. They are now shown in
  // all three previews and written by the pick, and candidateLines() says so above the choice.
  // See skin-vision.ts's header for why a pick may write into the theme and nothing else here does.

  return { message: lines.join("\n") };
}
