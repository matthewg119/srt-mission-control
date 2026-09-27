// The link in the welcome email that reopens the conversation.
//
// Somebody who will not book on the spot is asked to watch the video, and the email gives them both ways
// back: a time on the calendar, or this. It reopens the page they were on with the widget already open
// and the walk continuing from where they stopped.
//
// ‼️ IT IS NOT concierge_sessions.session_token, AND THAT IS THE WHOLE DESIGN. That column is a WRITE
// bearer: it is what /api/concierge/turn, /action and /booked accept to append to a conversation. It is
// unique, it has NO expiry column anywhere in the schema, and loadConciergeSession compares it with a
// plain .eq() rather than the constant-time compare onboarding2's own loader uses. A bearer with those
// three properties, put in an email, sits in a mailbox for years, gets forwarded, and is read by every
// scanner between us and them. So the email carries a signed, short-lived, single-purpose token instead,
// and the route exchanges it server side for the session.
//
// ‼️ IT RESTORES POSITION AND FIRST NAME, NOT THE TRANSCRIPT. A link in an email gets forwarded, and the
// question is what the person who receives it by accident can see. With the transcript, that is somebody
// else's conversation: what they said about their business, what they were offered, their email. With a
// position and a first name it is a step number and a name that was already in the email's To line.
// The conversation continues from the right place either way, because the walk is a step array and the
// step index is all it needs.
//
// ‼️ AND IT NEVER TOUCHES photo_delete_after. purge.ts is the only thing in this repo that makes the
// consent copy ("deleted within 24 hours") true, and it is watched. A resume that extended the deadline
// so a returning visitor could see their photo again would quietly turn that promise into a lie. Nothing
// here reads storage or writes that column: after 24 hours the photo is gone and the resumed conversation
// says nothing about it.

import { signOnboardingToken, verifyOnboardingToken } from "@/lib/clients/token";

/** The query parameter the resume link travels in. Read by embed.js off the page URL. */
export const RESUME_PARAM = "srtc";

/**
 * Three days.
 *
 * ‼️ SHORTER THAN EVERY OTHER LINK IN THIS REPO, AND DELIBERATELY SO. Preview and onboarding links live
 * fourteen days because a client is walked through them on a call that might slip a week. This one is
 * sent the moment somebody stops half way through a form, and the whole point is that they come back
 * soon. Three days is long enough to survive a weekend and short enough that a forwarded email in a
 * fortnight opens nothing.
 */
export const RESUME_TTL_DAYS = 3;

/** A signed resume token for one concierge session. */
export function mintResumeToken(sessionId: string): { token: string; expiresAt: Date } {
  return signOnboardingToken(sessionId, RESUME_TTL_DAYS, "resume");
}

/**
 * The session id inside a resume token, or null.
 *
 * Null for a missing token, a forged one, an expired one, and one minted for a different scope. All four
 * are the same answer, for the reason middleware.ts gives for never distinguishing 401 from 404: a
 * different answer per reason is a way to learn what exists.
 */
export function sessionIdFromResumeToken(token: string | null | undefined): string | null {
  const res = verifyOnboardingToken(token, "resume");
  return res.ok ? res.clientId : null;
}

/**
 * The link itself: the page they were on, with the token on it.
 *
 * ‼️ THE PAGE COMES FROM THE SESSION ROW, NOT FROM A CONSTANT. concierge_sessions records entry_host and
 * entry_path when the widget opens, so this reopens the page that earned the conversation rather than a
 * generic landing page. That matters most for a client's own site, where a generic link would send their
 * prospect to us.
 *
 * ‼️ AND IT RETURNS NULL RATHER THAN GUESSING A HOST. A session with no entry_host is one the widget
 * opened before those columns were written, or one from a lane that does not record them. A resume link
 * pointing at the wrong domain is worse than an email with one fewer link in it, and the email is written
 * to read correctly without this one.
 */
export function resumeUrl(session: { id: string; entryHost?: string | null; entryPath?: string | null }): string | null {
  const host = (session.entryHost ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host || !host.includes(".")) return null;

  const path = (session.entryPath ?? "/").trim();
  const safe = path.startsWith("/") ? path : `/${path}`;
  const { token } = mintResumeToken(session.id);
  const url = new URL(`https://${host}${safe}`);
  url.searchParams.set(RESUME_PARAM, token);
  return url.toString();
}
