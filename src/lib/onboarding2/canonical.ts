// The canonical string, and the hash over it. ISOMORPHIC, AND IT IMPORTS NOTHING.
//
// The browser and the server both hash the agreement, and they have to agree byte for byte or
// every signature 409s. That rules out importing anything: a `node:crypto` import here would
// drag this module into the client bundle and break the build, and a supabase import would drag
// the whole data layer. Same split scan/steps.ts made away from scan/session.ts, same reason.
//
// ‼️ THE CLIENT HASHES THE STRING THE API RETURNED, NEVER THE DOM. element.innerText collapses
// whitespace, resolves non-breaking spaces, and inserts breaks that depend on the font and the
// viewport, so two phones would produce two hashes for one contract. The browser hashes the JSON
// it was served and renders that same JSON. The hash proves the bytes the server stored are the
// bytes that were painted. It cannot prove anything about pixels.
//
// ‼️ THE ECHO IS A CONSISTENCY CHECK, NOT A TRUST BOUNDARY. The trust boundary is that the text
// came from the server in the first place. A client that could POST its own agreement prose could
// store any terms it liked under a real signature and the row would look genuine. So the server
// never reads contract text out of a request body. It only ever compares a hash.

/** Unit separator. Cannot occur in the copy, so no section body can forge a field break. */
const FIELD = "\u001f";
/** Record separator, between sections. Same reasoning. */
const RECORD = "\u001e";

/**
 * ‼️ STAMPED INTO EVERY SNAPSHOT, AND IT IS NOT DECORATION.
 *
 * If the joining rule below ever changes, every stored hash silently stops verifying and there is
 * no way to tell "the text was tampered with" from "the rule moved". A row carrying the canon it
 * was written under can be checked with the rule that was in force at the time. Bump it and keep
 * the old branch rather than editing the rule in place.
 */
export const CANON = "srt-onb2-c1";

export interface CanonicalSection {
  n: number;
  key: string;
  heading: string;
  body: string[];
  bullets?: string[];
  after?: string[];
}

/** One section, flattened. Arrays join on newline so an empty trailing element cannot vanish. */
export function canonicalSection(s: CanonicalSection): string {
  return [
    String(s.n),
    s.key,
    s.heading,
    (s.body ?? []).join("\n"),
    (s.bullets ?? []).join("\n"),
    (s.after ?? []).join("\n"),
  ].join(FIELD);
}

/**
 * One PAGE, which is a run of consecutive sections rendered on one sheet.
 *
 * ‼️ THIS IS THE HASH AN INITIAL NOW ATTESTS TO, AND IT IS NOT A WEAKER CLAIM THAN NINE SECTION
 * HASHES WERE. It covers exactly the same characters, in the same order, joined on the same
 * RECORD separator canonicalDocument() already uses between sections. Four page hashes over
 * {1} {2,3} {4,5,6} {7,8,9} and nine section hashes attest to the identical text; what fell is
 * how many times a person types two letters. It is also strictly harder to forge selectively,
 * because a page hash cannot be matched while altering any one clause on that page.
 *
 * ‼️ ADDITIVE ON PURPOSE. canonicalSection and canonicalDocument are not touched by a single
 * byte, so documentSha256 is unchanged for every row ever written and CANON does not move. A new
 * function is the cheap version of the "bump it and keep the old branch" rule above.
 */
export function canonicalPage(sections: CanonicalSection[]): string {
  return sections.map(canonicalSection).join(RECORD);
}

/**
 * The whole document, in the order it is read.
 *
 * Preamble, promise, sections, closing and footer are ALL included. The footer is not signed
 * text, but it names the version and carries the attorney-review line, and leaving it out would
 * mean two documents differing only in their footer hashed identically.
 */
export function canonicalDocument(args: {
  title: string;
  preamble: string[];
  promise: string;
  sections: CanonicalSection[];
  closing: string[];
  footer: string[];
}): string {
  return [
    CANON,
    args.title,
    args.preamble.join("\n"),
    args.promise,
    ...args.sections.map(canonicalSection),
    args.closing.join("\n"),
    args.footer.join("\n"),
  ].join(RECORD);
}

/**
 * SHA-256, lowercase hex, on either side of the wire.
 *
 * WebCrypto on the client and WebCrypto on the server too. Node has exposed
 * globalThis.crypto.subtle since 18 and this project runs the nodejs runtime on 20, so there is
 * one code path rather than a require() a bundler has to be told to leave alone.
 *
 * NFC first. A composed and a decomposed accent are the same text and must not be two hashes.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.normalize("NFC"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string compare, for the session token and the two hash echoes.
 *
 * Isomorphic, so it cannot use node's timingSafeEqual. Length is compared first and leaks only
 * the length, which is fixed for both callers anyway.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
