// The words the mascot lane answers to, and the shapes it files art under. Pure.
//
// ‼️ SPLIT OUT OF mascot-studio.ts SO IT CAN BE PROBED. The studio imports the mascot registry, which is
// a set of static image imports only Next's bundler can resolve, so nothing that reaches it is loadable
// from a tsx script. The grammar is the part most worth testing and none of it needs an image, a row or
// a network call, so it lives here and _probe-mascot.ts checks it directly. Same pure/impure split as
// offer-ladder.ts against anchor-ladder.ts.

/** How many characters one run proposes. Matthew asked for six every time. */
export const CONCEPT_COUNT = 6;

/** How many may be shortlisted for the call. Matthew asked for three preview links. */
export const SHORTLIST = 3;

/** The only step whose thread answers to any of this. */
export const MASCOT_STEP = "concierge_preview";

/**
 * The four corners the launcher may rest in.
 *
 * ‼️ NOT FREE COORDINATES, AND THE PANEL IS WHY. It is 580px tall and opens on the far side of the
 * launcher from the nearest edge, so a corner picks a layout rather than an offset. Storing pixels would
 * let somebody park a widget half off the bottom of a phone.
 */
export const LAUNCHER_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type LauncherCorner = (typeof LAUNCHER_CORNERS)[number];

export function isLauncherCorner(v: unknown): v is LauncherCorner {
  return typeof v === "string" && (LAUNCHER_CORNERS as readonly string[]).includes(v);
}

/** The states art may be filed under. `flourish` is any gesture; `easter` is the rare one. */
export const MASCOT_STATES = ["idle", "talk", "still", "flourish", "easter"] as const;

const MENU = /^mascots?$/i;
const CONCEPTS = /^mascots?\s+concepts?$/i;
const PICK = /^mascots?\s+pick\s+(.+)$/i;
const SKIP = /^mascots?\s+(skip|default)$/i;
const CORNER = /^mascots?\s+corner\s+(top|bottom)[-\s]?(left|right)$/i;
const KEEP = /^mascots?\s+([a-z0-9][a-z0-9-]{1,38})$/i;

export const MASCOT_GRAMMAR = { MENU, CONCEPTS, PICK, SKIP, CORNER, KEEP } as const;

export function cleanCommand(text: string): string {
  return text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
}

/** True when the text is one of this lane's commands, for step-commands.ts's wrong-thread pointer. */
export function isMascotCommand(text: string): boolean {
  const t = cleanCommand(text);
  return MENU.test(t) || CONCEPTS.test(t) || PICK.test(t) || SKIP.test(t) || CORNER.test(t) || KEEP.test(t);
}

/**
 * Which character and which state a message with an attachment is about.
 *
 * ‼️ THE KEY IS REQUIRED AND IS NEVER GUESSED. A client can have six proposed characters at once, and
 * filing art against the wrong one is only discovered when somebody opens a preview link and sees the
 * wrong animal. A message with no key returns null, the upload falls through to the ordinary onboarding
 * capture that files everything anyway, and nothing is lost.
 */
export function readMascotIntent(text: string): { key: string; state: string } | null {
  const m = /\bmascot\s+([a-z0-9][a-z0-9-]{1,38})(?:\s+([a-z]+))?/i.exec(text || "");
  if (!m) return null;
  const key = m[1].toLowerCase();
  // "mascot idle" names a state, not a character. Reading it as a key would answer "there is no
  // character called idle" to somebody who simply did not name one.
  if ((MASCOT_STATES as readonly string[]).includes(key)) return null;
  const state = (m[2] ?? "idle").toLowerCase();
  return { key, state: (MASCOT_STATES as readonly string[]).includes(state) ? state : "idle" };
}
