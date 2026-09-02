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
import { readSkinFromImages } from "@/lib/hub/skin-vision";
import type { ClaudeImageInput } from "@/lib/claude-calls";

/**
 * The steps where a design conversation belongs.
 *
 * 15 builds the hub and asks for the confirmation; 16 is the review tool, which shares the same
 * theme and skin objects, so "make it look like this" typed in either thread means the same
 * thing. Anywhere else the words fall through to the ordinary assistant, which is correct: a
 * sentence containing "template" in the intake thread is a sentence, not a command.
 */
const SKIN_STEPS = new Set(["hub_preview", "review_tool_preview"]);

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

function menuMessage(current: StoredSkin, clientId: string): string {
  return [
    `:art: ${skinLine(current)}`,
    "",
    "*Type one of these in this thread:*",
    templateMenu(),
    "",
    "Or paste a screenshot of a page whose look you want and I will read the colours, the " +
      "corner radius, the column width and the text size off it, and pick the closest template. " +
      "`skin reset` puts it back to Document with no overrides.",
    ...previewLines(clientId),
  ].join("\n");
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

  // Bare `template`, `skin` or `design`: show what it is on and what it could be on.
  if (/^(template|templates|skin|design)$/i.test(text)) {
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

  for (const f of picked) {
    try {
      const buf = await slack.downloadFile(f.url_private_download as string);
      payload.push({ media_type: (f.mimetype as string).toLowerCase(), data: buf.toString("base64") });
    } catch (e) {
      // One unreadable file must not lose the others. Named rather than swallowed.
      console.error("[clients/hub-skin] reference download failed:", (e as Error).message);
    }
  }

  if (payload.length === 0) {
    return {
      message:
        ":warning: I could not download those images from Slack, so nothing was read. " +
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

  const next: StoredSkin = {
    ...EMPTY_SKIN,
    template: read.template,
    bg: read.bg,
    fg: read.fg,
    muted: read.muted,
    faint: read.faint,
    rule: read.rule,
    card: read.card,
    band: read.band,
    bandFg: read.bandFg,
    headingFamily: read.headingFamily,
    radius: read.radius,
    measure: read.measure,
    baseSize: read.baseSize,
    source: "screenshot",
    sourceNote: read.reading,
  };

  const res = await writeSkin(input.clientId, next, input.by);
  if (!res.ok) return { message: `:warning: Read the reference but could not save it: ${res.error}` };

  // ‼️ REPORT WHAT WAS STORED, NOT WHAT THE MODEL SAID. readSkin() drops anything that failed
  // validation, so printing `read` would list values that are not on the page. This is the same
  // reason ThemeForm's confirm label reads the SAVED theme and never the input state.
  const stored = res.skin as StoredSkin;
  const info = templateInfo(stored.template);

  const lines = [
    `:art: Read that reference. Closest template is *${info.name}*.`,
    `_${stored.sourceNote ?? "no reading returned"}_`,
    "",
    skinLine(stored),
  ];

  if (payload.length < images.length) {
    lines.push(
      `_Read the first ${payload.length} of ${images.length} images. More than that averages ` +
        `into a muddy skin rather than a sharper one._`
    );
  }

  // The accent is REPORTED and never written. See skin-vision.ts: the accent is the client's
  // brand and its whole value is that it came off their own homepage.
  if (read.accentSuggestion) {
    lines.push(
      "",
      `The reference's own accent looks like \`${read.accentSuggestion}\`. It was NOT applied: ` +
        "the accent is the client's brand colour and it lives in the Theme panel, where it is " +
        "recorded as read off their site. Paste it there if you want it.",
    );
  }

  lines.push(...previewLines(input.clientId));
  return { message: lines.join("\n") };
}
