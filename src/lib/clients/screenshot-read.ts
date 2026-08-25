// Reading the Chrome address bar off a presence-sweep screenshot.
//
// Matthew screenshots from Chrome with the address bar in shot. The URL is in the picture and
// he is being asked to retype what it already says: he filed five, was told twice that they
// "name no platform I recognise", and had to re-post with the platform typed in.
//
// ‼️ TEXT FIRST, VISION ONLY ON A MISS, AND THE ORDER IS THE WHOLE RISK CONTROL.
//
// src/lib/call-coach/resolve-target.ts already records the doctrine for this exact shape:
// "The Chrome tab URL is tried FIRST and skips the vision call entirely. A URL cannot be
// misread; a screenshot can." resolvePlatformsFromText stays first and stays unchanged, so a
// message that named the platform never reaches this file. That ordering also bounds the cost:
// eighteen screenshots per client is eighteen model calls if this fires unconditionally, and
// most of them are already answered by a word somebody typed.
//
// ‼️ IT TRANSCRIBES. IT DOES NOT IDENTIFY.
// It returns the characters in the address bar and nothing else. Deciding WHICH PLATFORM those
// characters name is resolvePlatformFromUrl in @/config/presence-platforms, which is pure and
// testable without a model. A model that returned a platform key directly would be a model
// with an opinion about the answer; this one only reads.
//
// ‼️ A URL IT IS UNSURE OF IS ZERO MATCHES, NEVER A WEAK YES.
// Same rule the text resolver carries and the same rule run-prompts.ts carries as
// status:"no_data". Half a hostname resolves to a platform nobody looked at, and that lands as
// a green tick on a sweep that was never done.
//
// The bytes come from client_docs.storage_ref in the private `onboarding` bucket, never from
// re-fetching the Slack file: the file is already downloaded and stored, and Slack's private
// URLs need the bot token every time.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";

/** Haiku, temperature 0. Transcription, not judgement. Same model identify-lead.ts uses. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface ScreenshotRead {
  /** The address bar, character for character, or null when it is not legible. */
  urlText: string | null;
  /**
   * How clearly an address bar is ON SCREEN. NOT how confident it is about the business.
   *
   * Exactly as identify-lead.ts defines its `confidence`, and for the same reason: a number
   * that mixes legibility with certainty cannot be thresholded, because the two move
   * independently and only one of them is a fact about the picture.
   */
  legible: number;
  /** One short phrase naming WHERE it read from, or what is on screen instead. */
  evidence: string;
}

const EMPTY: ScreenshotRead = { urlText: null, legible: 0, evidence: "nothing readable" };

export async function readAddressBar(image: ClaudeImageInput): Promise<ScreenshotRead> {
  try {
    const { data } = await callClaudeJSON<ScreenshotRead>({
      model: MODEL,
      system: [
        "You are looking at a screenshot of a browser. Somewhere near the top is the address bar. Your only job is to read what it says.",
        "",
        "TRANSCRIBE, DO NOT INFER:",
        "- Copy the characters exactly as they appear. Never complete a truncated URL, never add a scheme that is not shown, never correct a spelling, never expand a shortened path.",
        "- Chrome hides 'https://www.' on many URLs. Transcribe what is VISIBLE. Do not add back what you believe is there.",
        "- If the address bar is covered, cut off, scrolled away, too small to read, or the browser is in full screen with no chrome visible, return null for urlText and say so in evidence. A half-read hostname is worse than no hostname, because it will be filed against a platform nobody looked at.",
        "",
        "‼️ THE ADDRESS BAR ONLY. A page full of links is not the address bar. A URL printed in the page body, in a search result, in a bookmark bar, in a screenshot-within-the-screenshot or in an open tab that is NOT the active one is a different page from the one on screen. If the only URL you can see is one of those, return null and name what you saw in evidence.",
        "",
        "legible is 0 to 1 and measures how clearly the ACTIVE TAB'S address bar is readable on this screen. A crisp full-width browser window is 0.9; a small window with a compressed URL is 0.5; a page with no browser chrome in shot is 0.",
        "evidence is one short phrase naming where you read it from, or what is on screen instead: 'address bar', 'address bar, truncated', 'no browser chrome visible', 'bookmark bar only', 'a link in the page body'.",
      ].join("\n"),
      user:
        "Read the active tab's address bar on this screen and return it verbatim. If you cannot read it, return null rather than a partial or reconstructed URL.",
      images: [image],
      maxTokens: 400,
      temperature: 0,
      schemaHint: '{ "urlText": string|null, "legible": number, "evidence": string }',
      coerce: camelizeKeys,
      validate: (v: unknown): v is ScreenshotRead => {
        const o = v as ScreenshotRead;
        return !!o && typeof o === "object" && typeof o.legible === "number";
      },
      describeInvalid: () =>
        "Return the object with every key present, urlText null when the address bar is not legible, and a numeric legible between 0 and 1.",
    });

    const urlText = blankToNull(data.urlText);

    return {
      urlText,
      legible: Number.isFinite(data.legible) ? data.legible : 0,
      evidence: data.evidence?.trim() || "not stated",
    };
  } catch (e) {
    // Non-fatal, deliberately. A failed read leaves the file filed and unattributed, which is
    // exactly the state it was already in, and the thread says which one could not be read.
    // Throwing here would take a whole batch of screenshots down with one bad picture.
    console.error("[clients/screenshot-read] vision read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `read failed: ${(e as Error).message}` };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Is this read clear enough to attribute a platform from?
 *
 * ‼️ THE THRESHOLD IS ON LEGIBILITY, NOT ON THE URL LOOKING PLAUSIBLE. A model that squinted at
 * a compressed address bar and produced something well-formed is the failure this catches, and
 * a well-formed hostname is precisely what it produces when it guesses.
 *
 * Below this, the read is treated as zero matches: filed, kept, not counted, and said out loud
 * in the thread so it is fixable in one message.
 */
export const MIN_LEGIBLE = 0.5;

export function isUsableRead(read: ScreenshotRead): boolean {
  return read.urlText !== null && read.legible >= MIN_LEGIBLE;
}
