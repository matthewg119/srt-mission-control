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
//     Just reply "send it" and it's on the way.
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

/** Three lines. The sign-off comes from the signature block, deliberately. */
export const NUDGE_BODY = [
  "Hello,",
  "Still happy to put the breakdown together for you.",
  `Just reply "send it" and it's on the way.`,
].join("\n\n");

/** The rendered HTML, signature included. Same builder as every other outbound email. */
export async function buildNudgeHtml(): Promise<string> {
  return buildPitchHtml(stripSignoff(NUDGE_BODY), await auditSignatureHtml());
}

/** What --dry-run prints, so what is reviewed on screen is what lands. */
export function nudgeBodyPreview(): string {
  return `${NUDGE_BODY}\n\n[signature block supplies: Thanks, / Matthew Garcia / Search Retrieval Tactics / ...]`;
}
