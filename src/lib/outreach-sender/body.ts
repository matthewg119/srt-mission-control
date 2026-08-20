// The nudge itself.
//
// WHY THERE IS NO SIGN-OFF IN THIS BODY
// The obvious way to write it is to end with "Thanks, / Matthew Garcia" and then call
// stripSignoff() before rendering, the way the audit thread does. That does not work here, and
// it fails in a way that ships a visible bug rather than an error.
//
// stripSignoff() (email-assistant.ts) keys off OUTREACH_SIGNATURE.name and .agency. Its first
// pattern wants "Matthew Garcia\nSearch Retrieval Tactics" at the end; this body has no agency
// line, so it does not match. Its second pattern matches "\nMatthew Garcia" and removes it. What
// survives is a trailing "Thanks," -- and PITCH_SIGNATURE_HTML OPENS with <div>Thanks,</div>.
// The draft would read:
//
//     just reply "send it" and it's on the way.
//     Thanks,
//     Thanks,
//     Matthew Garcia
//
// So the body simply does not contain the sign-off. auditSignatureHtml() supplies
// "Thanks, / Matthew Garcia" and everything under it, which is also what makes this email render
// identically to every other SRT email instead of approximately like one.
//
// stripSignoff is still applied, as a guard against someone later editing a sign-off back in.

import { buildPitchHtml, auditSignatureHtml } from "@/lib/audit-engine/lead-pitch";
import { stripSignoff } from "@/lib/audit-engine/email-assistant";

/**
 * The two lines, exactly as written, including the line break after the comma.
 *
 * buildPitchHtml splits on BLANK lines into paragraphs and turns a single newline into <br>, so
 * this stays one paragraph broken across two lines rather than becoming two paragraphs.
 */
export const NUDGE_LINES = [
  "I have the breakdown ready to go,",
  `just reply "send it" and it's on the way.`,
].join("\n");

/**
 * The greeting is A NAME AND A COMMA, nothing else, and no greeting at all when there is no name.
 *
 * This is the house rule (no-website-pitch.ts:499-505) and the reason is stated there: the model,
 * and a careless template, reach for "Hi," or greet the BUSINESS ("Hello Tito's Taqueria,"), and a
 * cold email addressed to a company reads as a mail merge on the first line, which is the line
 * that decides whether the rest gets read. Greeting nobody beats greeting a company.
 */
export function greetingName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  if (!name) return null;
  // An address is not a name. The sweep enrolls whatever it finds, so this is reachable.
  if (name.includes("@") || /https?:/i.test(name)) return null;
  // A company, not a person. Greeting one of these is the exact failure the rule exists to stop.
  if (/\b(inc|llc|l\.l\.c|corp|corporation|ltd|co|company|services|group|shop|store)\b\.?$/i.test(name)) return null;
  if (/[&/]|\d/.test(name)) return null;
  // First name only. "Jorge Diaz" greets as "Jorge,".
  const first = name.split(/\s+/)[0];
  if (first.length < 2 || first.length > 20) return null;
  return first;
}

/** The plain-text body for a given recipient. */
export function buildNudgeBody(name: string | null | undefined): string {
  const greeting = greetingName(name);
  return greeting ? `${greeting},\n\n${NUDGE_LINES}` : NUDGE_LINES;
}

/** The rendered HTML, signature included. Same builder as every other outbound email. */
export async function buildNudgeHtml(name: string | null | undefined): Promise<string> {
  return buildPitchHtml(stripSignoff(buildNudgeBody(name)), await auditSignatureHtml());
}

/** What --dry-run prints, so what is reviewed on screen is what lands. */
export function nudgeBodyPreview(name: string | null | undefined): string {
  return `${buildNudgeBody(name)}\n\n[signature block supplies: Thanks, / Matthew Garcia / Search Retrieval Tactics / ...]`;
}
